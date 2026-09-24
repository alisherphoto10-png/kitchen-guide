// Техподдержка: обращения (тикеты) сотрудников.
//
// Сценарий: «Техподдержка» в профиле мини-аппа (или /support в боте) → бот просит
// написать обращение → следующее сообщение сотрудника создаёт тикет. Пока тикет
// открыт, всё, что сотрудник пишет боту, добавляется в него. Администратор платформы
// отвечает на сайте — ответ уходит в тот же чат с ботом заведения. Тикет закрывает
// администратор; следующий вопрос — уже новый тикет. Историю своих обращений
// сотрудник видит в мини-аппе.
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const tg = require('./telegram');
const bots = require('./bots');
const notifier = require('./supportNotify');

const REQUEST_HOURS = 24;       // «Техподдержка» нажата — ждём текст обращения столько
const MAX_TEXT = 4000;
const ROLE = { owner: 'владелец', editor: 'технолог', viewer: 'повар' };

const no = id => `№${id}`;

function cleanText(t) {
  const s = String(t || '').trim();
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s;
}

async function openTicketOf(userId) {
  const { rows: [t] } = await pool.query("SELECT * FROM support_tickets WHERE user_id = $1 AND status = 'open'", [userId]);
  return t || null;
}

// Написать сотруднику от имени бота его заведения.
async function sendToUser(tenantId, tgId, text) {
  if (!tgId) throw new HttpError(409, 'Сотрудник отвязан от Telegram — ответ не доставить');
  const bot = await bots.activeForTenant(tenantId);
  if (!bot) throw new HttpError(409, 'Бот заведения отключён — ответ не доставить');
  try {
    return await tg.call(bots.tokenOf(bot), 'sendMessage', { chat_id: tgId, text });
  } catch (e) {
    if (e instanceof tg.TelegramError) {
      throw new HttpError(502, e.code === 403
        ? 'Сотрудник заблокировал бота — Telegram не принимает сообщение'
        : `Telegram не принял сообщение: ${e.description || e.message}`);
    }
    throw e;
  }
}

async function tenantName(tenantId) {
  const { rows: [t] } = await pool.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
  return t?.name || '';
}

function who(user) {
  const name = user.name || user.login;
  return `${name}${user.tg_username ? ` (@${user.tg_username})` : ''} · ${ROLE[user.role] || user.role}`;
}

// ── сторона сотрудника ───────────────────────────────────────────────

// Кнопка «Техподдержка» в мини-аппе или /support в боте: бот пишет в чат,
// что ждёт обращение. Если тикет уже открыт — напоминает, что можно просто писать.
async function request(user) {
  if (!user.tenant_id) throw new HttpError(400, 'Техподдержка — для сотрудников заведения');
  if (!user.tg_id) throw new HttpError(400, 'Telegram не привязан — откройте приложение из бота заведения');
  const open = await openTicketOf(user.id);
  if (!open) await pool.query('UPDATE users SET support_requested_at = NOW() WHERE id = $1', [user.id]);
  await sendToUser(user.tenant_id, user.tg_id, open
    ? `Ваше обращение ${no(open.id)} ещё открыто — просто напишите сюда, сообщение добавится в него.`
    : 'Напишите своё обращение одним сообщением и отправьте — оно уйдёт в техподдержку. Ответ придёт сюда же, в этот чат.');
  return { open_ticket_id: open?.id || null };
}

async function addMessage(ticketId, author, authorUserId, text) {
  await pool.query(
    'INSERT INTO support_messages (ticket_id, author, author_user_id, text) VALUES ($1, $2, $3, $4)',
    [ticketId, author, authorUserId, text]
  );
  await pool.query('UPDATE support_tickets SET last_author = $2, updated_at = NOW() WHERE id = $1', [ticketId, author]);
}

async function createTicket(user, text) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query(
      'INSERT INTO support_tickets (tenant_id, user_id) VALUES ($1, $2) RETURNING *', [user.tenant_id, user.id]
    );
    await client.query(
      "INSERT INTO support_messages (ticket_id, author, author_user_id, text) VALUES ($1, 'user', $2, $3)", [t.id, user.id, text]
    );
    await client.query('UPDATE users SET support_requested_at = NULL WHERE id = $1', [user.id]);
    await client.query('COMMIT');
    return t;
  } catch (e) {
    await client.query('ROLLBACK');
    // Два сообщения пришли одновременно — второе попадёт в уже созданный тикет.
    if (e.code === '23505') return null;
    throw e;
  } finally {
    client.release();
  }
}

// Сообщение привязанного сотрудника боту. true — сообщение ушло в техподдержку
// (бот уже ответил), false — к поддержке не относится, пусть бот ответит как обычно.
async function handleBotMessage(token, user, msg) {
  const chatId = msg.chat.id;
  const say = text => tg.call(token, 'sendMessage', { chat_id: chatId, text });
  const raw = String(msg.text ?? msg.caption ?? '').trim();

  if (raw === '/support' || raw.startsWith('/support@') || raw.startsWith('/support ')) {
    await request(user);
    return true;
  }
  // Прочие команды (/start и т. п.) в переписку не попадают.
  if (raw.startsWith('/')) return false;

  let open = await openTicketOf(user.id);
  const requested = !open && user.support_requested_at
    && Date.now() - new Date(user.support_requested_at).getTime() < REQUEST_HOURS * 3600e3;
  if (!open && !requested) return false;

  const attachment = !msg.text && !!(msg.photo || msg.document || msg.video || msg.voice || msg.audio || msg.sticker || msg.video_note);
  if (!raw) {
    await say('Пока в техподдержку передаётся только текст — опишите, пожалуйста, вопрос словами.');
    return true;
  }
  const text = cleanText(raw);
  const tenant = await tenantName(user.tenant_id);

  if (!open) {
    const t = await createTicket(user, text);
    if (t) {
      await say(`Обращение ${no(t.id)} принято. Ответ придёт сюда же.\n\nПока вопрос не закрыт, всё, что вы напишете в этот чат, добавится к обращению.`
        + (attachment ? '\n\nФото и файлы пока не передаются — только текст.' : ''));
      await notifier.notify(`🆕 Обращение ${no(t.id)} · ${tenant}\n${who(user)}\n\n${text}`, t.id);
      return true;
    }
    open = await openTicketOf(user.id);
    if (!open) throw new Error('support: тикет не создан и не найден');
  }

  await addMessage(open.id, 'user', user.id, text);
  // Короткое «принято» реакцией, чтобы не засорять переписку ответами бота.
  tg.call(token, 'setMessageReaction', {
    chat_id: chatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👌' }],
  }).catch(() => {});
  if (attachment) await say('Фото и файлы пока не передаются в техподдержку — только текст сообщения.');
  await notifier.notify(`💬 ${no(open.id)} · ${tenant}\n${who(user)}\n\n${text}`, open.id);
  return true;
}

// История обращений сотрудника (мини-апп): только свои.
async function myList(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.status, t.last_author, t.created_at, t.updated_at, t.closed_at,
            (SELECT text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id LIMIT 1) AS first_text,
            (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t WHERE t.user_id = $1 ORDER BY (t.status = 'open') DESC, t.updated_at DESC`,
    [userId]
  );
  return rows;
}

async function messagesOf(ticketId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.author, m.text, m.created_at, u.name AS author_name, u.login AS author_login
       FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.ticket_id = $1 ORDER BY m.id`,
    [ticketId]
  );
  return rows;
}

async function myGet(userId, ticketId) {
  const { rows: [t] } = await pool.query(
    'SELECT id, status, created_at, updated_at, closed_at FROM support_tickets WHERE id = $1 AND user_id = $2', [ticketId, userId]
  );
  if (!t) throw new HttpError(404, 'Обращение не найдено');
  // Сотруднику не нужно знать, кто именно из поддержки ответил.
  const messages = (await messagesOf(t.id)).map(({ author_name, author_login, ...m }) => m);
  return { ...t, messages };
}

// ── сторона администратора платформы ─────────────────────────────────

const ADMIN_SELECT = `
  SELECT t.*, tn.name AS tenant_name, u.name AS user_name, u.login AS user_login, u.role AS user_role,
         u.tg_username AS user_tg_username, (u.tg_id IS NOT NULL) AS user_tg_linked,
         cb.name AS closed_by_name,
         (SELECT text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_text,
         (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM support_tickets t
    JOIN tenants tn ON tn.id = t.tenant_id
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users cb ON cb.id = t.closed_by`;

async function list({ status } = {}) {
  const st = ['open', 'closed'].includes(status) ? status : null;
  const { rows } = await pool.query(
    `${ADMIN_SELECT} WHERE ($1::text IS NULL OR t.status = $1)
      ORDER BY (t.status = 'open' AND t.last_author = 'user') DESC, (t.status = 'open') DESC, t.updated_at DESC
      LIMIT 300`,
    [st]
  );
  return rows;
}

async function getRow(ticketId) {
  const { rows: [t] } = await pool.query(`${ADMIN_SELECT} WHERE t.id = $1`, [ticketId]);
  if (!t) throw new HttpError(404, 'Обращение не найдено');
  return t;
}

async function get(ticketId) {
  const t = await getRow(ticketId);
  return { ...t, messages: await messagesOf(t.id) };
}

async function summary() {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
            COUNT(*) FILTER (WHERE status = 'open' AND last_author = 'user')::int AS waiting
       FROM support_tickets`
  );
  return r;
}

async function userOf(ticket) {
  const { rows: [u] } = await pool.query('SELECT id, tenant_id, tg_id FROM users WHERE id = $1', [ticket.user_id]);
  return u;
}

// Ответ сохраняется, только если Telegram его принял: иначе сотрудник его не увидит
// в чате, а администратор думал бы, что ответил.
async function reply(ticketId, admin, rawText) {
  const text = cleanText(rawText);
  if (!text) throw new HttpError(400, 'Пустой ответ');
  const t = await getRow(ticketId);
  if (t.status !== 'open') throw new HttpError(409, 'Обращение закрыто — откройте его снова, чтобы ответить');
  const u = await userOf(t);
  await sendToUser(u.tenant_id, u.tg_id, `💬 Техподдержка · обращение ${no(t.id)}\n\n${text}`);
  await addMessage(t.id, 'admin', admin.id, text);
  return get(t.id);
}

async function close(ticketId, admin) {
  const t = await getRow(ticketId);
  if (t.status === 'closed') return get(t.id);
  await pool.query(
    "UPDATE support_tickets SET status = 'closed', closed_at = NOW(), closed_by = $2, updated_at = NOW() WHERE id = $1",
    [t.id, admin.id]
  );
  const u = await userOf(t);
  // Уведомление — по возможности: закрыть тикет можно и если бот недоступен.
  await sendToUser(u.tenant_id, u.tg_id,
    `✅ Обращение ${no(t.id)} закрыто. Если появится новый вопрос — «Техподдержка» в профиле приложения или команда /support.`
  ).catch(() => {});
  return get(t.id);
}

async function reopen(ticketId) {
  const t = await getRow(ticketId);
  if (t.status === 'open') return get(t.id);
  try {
    await pool.query(
      "UPDATE support_tickets SET status = 'open', closed_at = NULL, closed_by = NULL, updated_at = NOW() WHERE id = $1", [t.id]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'У сотрудника уже есть другое открытое обращение');
    throw e;
  }
  const u = await userOf(t);
  await sendToUser(u.tenant_id, u.tg_id,
    `Обращение ${no(t.id)} снова открыто — можно продолжать писать сюда.`
  ).catch(() => {});
  return get(t.id);
}

module.exports = { request, handleBotMessage, myList, myGet, list, get, summary, reply, close, reopen };
