// Уведомления о новых обращениях в Telegram-группу/тему администратора платформы,
// чтобы не держать сайт открытым. Шлёт отдельный бот платформы (не бот заведения):
// его добавляют в группу, группу/тему находим по его getUpdates — без ручного
// поиска chat_id. Токен хранится так же, как токены ботов заведений (AES-GCM).
const config = require('../config');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const secretBox = require('../utils/secretBox');
const tg = require('./telegram');

const KEY = 'support_notify';

async function load() {
  const { rows: [r] } = await pool.query('SELECT value FROM platform_settings WHERE key = $1', [KEY]);
  return r ? r.value : null;
}

async function save(value) {
  await pool.query(
    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [KEY, value]
  );
}

function publicSettings(s) {
  if (!s) return { configured: false, bot_username: null };
  return {
    configured: !!(s.token_encrypted && s.chat_id),
    bot_username: s.bot_username,
    token_last4: s.token_last4,
    chat_id: s.chat_id || null,
    thread_id: s.thread_id || null,
    chat_title: s.chat_title || null,
    last_error: s.last_error || null,
    last_error_at: s.last_error_at || null,
    last_ok_at: s.last_ok_at || null,
  };
}

async function get() {
  return publicSettings(await load());
}

function telegramFail(e) {
  if (e instanceof tg.TelegramError) {
    if (e.code === 401 || e.code === 404) return new HttpError(400, 'Telegram не принял токен — проверьте его в @BotFather');
    return new HttpError(400, `Telegram ответил: ${e.description || e.message}`);
  }
  return e;
}

// Бот для уведомлений. Бот заведения сюда не годится: getUpdates требует снять
// вебхук, и бот заведения перестал бы отвечать сотрудникам.
async function setBot(rawToken) {
  const token = tg.assertTokenFormat(rawToken);
  let me;
  try { me = await tg.call(token, 'getMe'); } catch (e) { throw telegramFail(e); }
  if (!me?.is_bot) throw new HttpError(400, 'Токен принадлежит не боту');
  const { rows: [taken] } = await pool.query(
    'SELECT t.name FROM tenant_bots b JOIN tenants t ON t.id = b.tenant_id WHERE b.bot_id = $1', [me.id]
  );
  if (taken) throw new HttpError(409, `@${me.username} — бот заведения «${taken.name}». Для уведомлений создайте отдельного бота.`);
  try { await tg.call(token, 'deleteWebhook', {}); } catch (e) { throw telegramFail(e); }

  const prev = (await load()) || {};
  const sameBot = String(prev.bot_id) === String(me.id);
  await save({
    token_encrypted: secretBox.encrypt(token),
    token_last4: token.slice(-4),
    bot_id: me.id,
    bot_username: me.username,
    // Другой бот может не состоять в прежней группе — чат выбираем заново.
    ...(sameBot && { chat_id: prev.chat_id, thread_id: prev.thread_id, chat_title: prev.chat_title }),
  });
  return get();
}

async function tokenOrFail() {
  const s = await load();
  if (!s?.token_encrypted) throw new HttpError(400, 'Сначала подключите бота для уведомлений');
  return { s, token: secretBox.decrypt(s.token_encrypted) };
}

// Чаты и темы, где бот недавно видел сообщения (/start@бот в нужной теме, или
// просто личка с ботом). Telegram хранит такие апдейты до 24 часов.
async function discoverChats() {
  const { token } = await tokenOrFail();
  let updates;
  try {
    updates = await tg.call(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'my_chat_member'] });
  } catch (e) { throw telegramFail(e); }

  const found = new Map();
  for (const u of updates.reverse()) {
    const m = u.message || u.my_chat_member;
    const chat = m?.chat;
    if (!chat) continue;
    const threadId = u.message?.is_topic_message ? u.message.message_thread_id : null;
    const key = `${chat.id}:${threadId || ''}`;
    if (found.has(key)) continue;
    const topicName = u.message?.reply_to_message?.forum_topic_created?.name || null;
    found.set(key, {
      chat_id: chat.id,
      thread_id: threadId,
      type: chat.type,
      title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id),
      topic: threadId ? (topicName || `тема #${threadId}`) : null,
    });
  }
  return [...found.values()];
}

// Выбор чата проверяется пробным сообщением: сохраняем, только если оно дошло.
async function setChat({ chat_id, thread_id, chat_title }) {
  const { s, token } = await tokenOrFail();
  const chatId = String(chat_id || '').trim();
  if (!/^-?\d{1,20}$/.test(chatId)) throw new HttpError(400, 'Некорректный id чата');
  const threadId = thread_id ? parseInt(thread_id, 10) : null;
  if (thread_id && !(threadId > 0)) throw new HttpError(400, 'Некорректный id темы');
  try {
    await tg.call(token, 'sendMessage', {
      chat_id: chatId,
      ...(threadId && { message_thread_id: threadId }),
      text: '✅ Сюда будут приходить уведомления о новых обращениях в техподдержку «Калькуляций».',
    });
  } catch (e) { throw telegramFail(e); }
  await save({
    ...s,
    chat_id: chatId,
    thread_id: threadId,
    chat_title: String(chat_title || '').slice(0, 200) || null,
    last_error: null, last_error_at: null, last_ok_at: new Date().toISOString(),
  });
  return get();
}

async function remove() {
  await pool.query('DELETE FROM platform_settings WHERE key = $1', [KEY]);
}

function ticketUrl(ticketId) {
  return `${config.publicBaseUrl}/support/${ticketId}`;
}

// Карточка тикета в группе: одно сообщение на тикет. prev — где оно уже лежит
// ({ chat_id, message_id }); если там же текущий чат уведомлений — редактируем,
// иначе (первое уведомление, чат сменили, сообщение удалили) — шлём новое.
// Возвращает новое местоположение или null (уведомления не настроены / сбой).
// «По возможности»: сбой не должен ронять переписку, ошибка видна в панели.
async function upsert(prev, text, ticketId) {
  const s = await load();
  if (!s?.token_encrypted || !s.chat_id) return null;
  const token = secretBox.decrypt(s.token_encrypted);
  const url = ticketUrl(ticketId);
  const body = {
    text: text.length > 4000 ? text.slice(0, 4000) + '…' : text,
    link_preview_options: { is_disabled: true },
    // Кнопка-ссылка работает только с https-адресом.
    ...(/^https:\/\//.test(url) && { reply_markup: { inline_keyboard: [[{ text: 'Открыть обращение', url }]] } }),
  };
  const ok = async where => {
    if (s.last_error) await save({ ...s, last_error: null, last_error_at: null, last_ok_at: new Date().toISOString() });
    return where;
  };
  try {
    if (prev?.message_id && String(prev.chat_id) === String(s.chat_id)) {
      try {
        await tg.call(token, 'editMessageText', { chat_id: s.chat_id, message_id: prev.message_id, ...body });
        return ok(prev);
      } catch (e) {
        // Текст не изменился — это не ошибка.
        if (/message is not modified/i.test(e.description || '')) return ok(prev);
        // Сообщение удалили в группе и т. п. — пришлём заново.
        if (!(e instanceof tg.TelegramError) || e.code !== 400) throw e;
      }
    }
    const m = await tg.call(token, 'sendMessage', {
      chat_id: s.chat_id, ...(s.thread_id && { message_thread_id: s.thread_id }), ...body,
    });
    return ok({ chat_id: String(s.chat_id), message_id: m.message_id });
  } catch (e) {
    console.error('[support notify]', e.message);
    await save({ ...s, last_error: e.description || e.message, last_error_at: new Date().toISOString() }).catch(() => {});
    return null;
  }
}

module.exports = { get, setBot, discoverChats, setChat, remove, upsert };
