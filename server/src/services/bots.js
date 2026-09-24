// Боты клиентов: подключение по токену из панели, свой вебхук на каждого
// клиента, включение/выключение. Токен — секрет: хранится зашифрованным,
// из этого модуля наружу уходит только token_last4.
const crypto = require('crypto');
const config = require('../config');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const secretBox = require('../utils/secretBox');
const tg = require('./telegram');

function webhookUrl(botRowId) {
  return `${config.publicBaseUrl}/tg/${botRowId}`;
}

// Мини-апп — один фронтенд на всех; клиент определяется параметром t=<slug>.
function miniAppUrl(slug) {
  return `${config.publicBaseUrl}/tg-app?t=${encodeURIComponent(slug)}`;
}

function publicBot(row, slug) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    username: row.username,
    token_last4: row.token_last4,
    is_active: row.is_active,
    last_error: row.last_error,
    last_update_at: row.last_update_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    bot_link: `https://t.me/${row.username}`,
    mini_app_link: slug ? `https://t.me/${row.username}?startapp=${encodeURIComponent(slug)}` : null,
  };
}

function tokenOf(row) {
  return secretBox.decrypt(row.token_encrypted);
}

async function getRow(tenantId) {
  const { rows: [row] } = await pool.query('SELECT * FROM tenant_bots WHERE tenant_id = $1', [tenantId]);
  return row || null;
}

async function tenantSlug(tenantId) {
  const { rows: [t] } = await pool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
  if (!t) throw new HttpError(404, 'Заведение не найдено');
  return t.slug;
}

const BOT_COMMANDS = [
  { command: 'start', description: 'Открыть технологические карты' },
  { command: 'support', description: 'Написать в техподдержку' },
];

// Вебхук + кнопка меню «ТТК» (открывает мини-апп этого клиента) + команда /start.
async function configureTelegram(token, row, slug) {
  if (!/^https:\/\//.test(config.publicBaseUrl)) {
    throw new HttpError(500, 'PUBLIC_BASE_URL в server/.env должен быть https-адресом сайта');
  }
  await tg.call(token, 'setWebhook', {
    url: webhookUrl(row.id),
    secret_token: row.webhook_secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  await tg.call(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'ТТК', web_app: { url: miniAppUrl(slug) } },
  });
  await tg.call(token, 'setMyCommands', { commands: BOT_COMMANDS });
}

// Снять вебхук и кнопку — «по возможности»: если токен уже отозван в @BotFather,
// Telegram ответит ошибкой, а локально бот всё равно должен выключиться.
async function unconfigureTelegram(token) {
  const errors = [];
  for (const [method, params] of [['deleteWebhook', { drop_pending_updates: true }], ['setChatMenuButton', { menu_button: { type: 'default' } }]]) {
    try { await tg.call(token, method, params); } catch (e) { errors.push(e.description || e.message); }
  }
  return errors;
}

function telegramFail(e) {
  if (e instanceof tg.TelegramError) {
    if (e.code === 401 || e.code === 404) return new HttpError(400, 'Telegram не принял токен — проверьте его в @BotFather (возможно, он был перевыпущен)');
    return new HttpError(502, `Telegram ответил ошибкой: ${e.description || e.message}`);
  }
  return e;
}

// Подключить бота к клиенту или заменить токен. Сначала getMe (токен живой,
// это бот), потом вебхук. Если Telegram не дал настроить вебхук — ничего не
// сохраняем и возвращаем прежнее состояние.
async function connect(tenantId, rawToken) {
  const token = tg.assertTokenFormat(rawToken);
  const slug = await tenantSlug(tenantId);

  let me;
  try { me = await tg.call(token, 'getMe'); } catch (e) { throw telegramFail(e); }
  if (!me?.is_bot) throw new HttpError(400, 'Токен принадлежит не боту');

  const { rows: [taken] } = await pool.query('SELECT tenant_id FROM tenant_bots WHERE bot_id = $1 AND tenant_id <> $2', [me.id, tenantId]);
  if (taken) throw new HttpError(409, `@${me.username} уже подключён к другому заведению`);

  const previous = await getRow(tenantId);
  const fields = {
    token_encrypted: secretBox.encrypt(token),
    token_last4: token.slice(-4),
    bot_id: me.id,
    username: me.username,
    webhook_secret: crypto.randomBytes(32).toString('hex'),
  };

  let row;
  try {
    if (previous) {
      ({ rows: [row] } = await pool.query(
        `UPDATE tenant_bots SET token_encrypted=$2, token_last4=$3, bot_id=$4, username=$5, webhook_secret=$6,
                is_active=TRUE, last_error=NULL, updated_at=NOW()
          WHERE tenant_id=$1 RETURNING *`,
        [tenantId, fields.token_encrypted, fields.token_last4, fields.bot_id, fields.username, fields.webhook_secret]
      ));
    } else {
      ({ rows: [row] } = await pool.query(
        `INSERT INTO tenant_bots (tenant_id, token_encrypted, token_last4, bot_id, username, webhook_secret)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [tenantId, fields.token_encrypted, fields.token_last4, fields.bot_id, fields.username, fields.webhook_secret]
      ));
    }
  } catch (e) {
    // Тот же бот параллельно подключили к другому заведению.
    if (e.code === '23505') throw new HttpError(409, `@${me.username} уже подключён к другому заведению`);
    throw e;
  }

  try {
    await configureTelegram(token, row, slug);
  } catch (e) {
    if (previous) {
      await pool.query(
        `UPDATE tenant_bots SET token_encrypted=$2, token_last4=$3, bot_id=$4, username=$5, webhook_secret=$6,
                is_active=$7, last_error=$8, updated_at=$9 WHERE tenant_id=$1`,
        [tenantId, previous.token_encrypted, previous.token_last4, previous.bot_id, previous.username,
         previous.webhook_secret, previous.is_active, previous.last_error, previous.updated_at]
      );
    } else {
      await pool.query('DELETE FROM tenant_bots WHERE id = $1', [row.id]);
    }
    throw telegramFail(e);
  }

  // Заменили бота на другого — старому снимаем вебхук, чтобы он замолчал.
  if (previous && String(previous.bot_id) !== String(me.id)) {
    try { await unconfigureTelegram(tokenOf(previous)); } catch { /* старый токен мог быть уже отозван */ }
  }
  return publicBot(row, slug);
}

async function setActive(tenantId, active) {
  const row = await getRow(tenantId);
  if (!row) throw new HttpError(404, 'Бот не подключён');
  const slug = await tenantSlug(tenantId);
  if (active) {
    try {
      await configureTelegram(tokenOf(row), row, slug);
    } catch (e) {
      const err = telegramFail(e);
      await pool.query('UPDATE tenant_bots SET last_error=$2, updated_at=NOW() WHERE id=$1', [row.id, err.message]);
      throw err;
    }
    const { rows: [r] } = await pool.query('UPDATE tenant_bots SET is_active=TRUE, last_error=NULL, updated_at=NOW() WHERE id=$1 RETURNING *', [row.id]);
    return publicBot(r, slug);
  }
  const errors = await unconfigureTelegram(tokenOf(row));
  const { rows: [r] } = await pool.query(
    'UPDATE tenant_bots SET is_active=FALSE, last_error=$2, updated_at=NOW() WHERE id=$1 RETURNING *',
    [row.id, errors.length ? `При отключении Telegram ответил: ${errors.join('; ')}` : null]
  );
  return publicBot(r, slug);
}

async function remove(tenantId) {
  const row = await getRow(tenantId);
  if (!row) throw new HttpError(404, 'Бот не подключён');
  await unconfigureTelegram(tokenOf(row));
  await pool.query('DELETE FROM tenant_bots WHERE id = $1', [row.id]);
}

// Состояние бота + живая сверка с Telegram (вебхук действительно наш, нет ли ошибок доставки).
async function status(tenantId) {
  const row = await getRow(tenantId);
  if (!row) return null;
  const slug = await tenantSlug(tenantId);
  const bot = publicBot(row, slug);
  try {
    const info = await tg.call(tokenOf(row), 'getWebhookInfo');
    bot.telegram = {
      webhook_ok: row.is_active ? info.url === webhookUrl(row.id) : !info.url,
      pending_update_count: info.pending_update_count || 0,
      last_error_message: info.last_error_message || null,
      last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    };
  } catch (e) {
    bot.telegram = { error: telegramFail(e).message };
  }
  return bot;
}

async function summary(tenantId) {
  const row = await getRow(tenantId);
  return row && { username: row.username, is_active: row.is_active };
}

// Для вебхука и мини-аппа.
async function getById(id) {
  const { rows: [row] } = await pool.query(
    `SELECT b.*, t.slug, t.is_active AS tenant_active FROM tenant_bots b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = $1`, [id]
  );
  return row || null;
}

async function getActiveBySlug(slug) {
  const { rows: [row] } = await pool.query(
    `SELECT b.*, t.slug, t.is_active AS tenant_active FROM tenant_bots b JOIN tenants t ON t.id = b.tenant_id
      WHERE t.slug = $1 AND b.is_active`, [String(slug || '').toLowerCase()]
  );
  return row || null;
}

// Для техподдержки: написать сотруднику от имени бота его заведения.
async function activeForTenant(tenantId) {
  const { rows: [row] } = await pool.query('SELECT * FROM tenant_bots WHERE tenant_id = $1 AND is_active', [tenantId]);
  return row || null;
}

async function touch(id) {
  await pool.query('UPDATE tenant_bots SET last_update_at = NOW() WHERE id = $1', [id]);
}

module.exports = {
  connect, setActive, remove, status, summary, getById, getActiveBySlug, activeForTenant, touch,
  tokenOf, miniAppUrl, webhookUrl, publicBot, BOT_COMMANDS,
};
