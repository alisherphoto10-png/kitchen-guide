// Привязка Telegram-аккаунта к сотруднику и вход в мини-апп.
const crypto = require('crypto');
const { pool, withTransaction } = require('../db/pool');
const { HttpError } = require('../utils/http');
const bots = require('./bots');

const LINK_TTL_HOURS = 24;

// Одноразовая ссылка t.me/<бот>?start=link_<код> для конкретного сотрудника.
// Новая ссылка отменяет прежние ссылки этого сотрудника.
async function createLink(tenantId, userId) {
  const bot = await bots.summary(tenantId);
  if (!bot) throw new HttpError(409, 'У заведения ещё нет бота — его подключает администратор платформы');
  if (!bot.is_active) throw new HttpError(409, 'Бот заведения отключён');
  const { rows: [u] } = await pool.query('SELECT id, is_active FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (!u.is_active) throw new HttpError(409, 'Сотрудник отключён');

  const code = crypto.randomBytes(15).toString('base64url');
  await pool.query('DELETE FROM tg_link_codes WHERE user_id = $1', [userId]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO tg_link_codes (code, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${LINK_TTL_HOURS} hours') RETURNING expires_at`,
    [code, userId]
  );
  return { url: `https://t.me/${bot.username}?start=link_${code}`, expires_at: row.expires_at };
}

async function unlink(tenantId, userId) {
  const { rowCount } = await pool.query(
    'UPDATE users SET tg_id = NULL, tg_username = NULL WHERE id = $1 AND tenant_id = $2', [userId, tenantId]
  );
  if (!rowCount) throw new HttpError(404, 'Сотрудник не найден');
  await pool.query('DELETE FROM tg_link_codes WHERE user_id = $1', [userId]);
}

// Вызывается ботом на /start link_<код>. Код годится только в боте своего заведения.
// Возвращает сотрудника или null (код неверный/просрочен/чужой).
async function consumeLink(tenantId, code, tgUser) {
  return withTransaction(async db => {
    const { rows: [u] } = await db.query(
      `SELECT u.* FROM tg_link_codes c JOIN users u ON u.id = c.user_id
        WHERE c.code = $1 AND c.expires_at > NOW() AND u.tenant_id = $2 AND u.is_active
        FOR UPDATE OF c`,
      [code, tenantId]
    );
    if (!u) return null;
    // Один Telegram — один сотрудник внутри заведения: снимаем с прежнего.
    await db.query('UPDATE users SET tg_id = NULL, tg_username = NULL WHERE tenant_id = $1 AND tg_id = $2 AND id <> $3', [tenantId, tgUser.id, u.id]);
    await db.query('UPDATE users SET tg_id = $2, tg_username = $3 WHERE id = $1', [u.id, tgUser.id, tgUser.username || null]);
    await db.query('DELETE FROM tg_link_codes WHERE user_id = $1', [u.id]);
    return u;
  });
}

async function findLinkedUser(tenantId, tgId) {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE tenant_id = $1 AND tg_id = $2', [tenantId, tgId]);
  return u || null;
}

// Проверка initData мини-аппа по документации Telegram:
// secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string).
// Подпись проверяется токеном бота ИМЕННО этого клиента — чужой бот не подделает вход.
function verifyInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  const params = new URLSearchParams(String(initData || ''));
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user?.id ? { user, startParam: params.get('start_param') } : null;
  } catch {
    return null;
  }
}

module.exports = { createLink, unlink, consumeLink, findLinkedUser, verifyInitData, LINK_TTL_HOURS };
