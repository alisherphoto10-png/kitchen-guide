// Привязка Telegram-аккаунта к сотруднику и вход в мини-апп.
//
// Схема: у бота одна общая ссылка (её можно кинуть в общий чат). Непривязанному
// Telegram бот предлагает войти логином и паролем, которые владелец задал
// сотруднику в «Команде». При совпадении tg_id записывается в сотрудника навсегда;
// сменить привязку может только владелец (сброс в «Команде»).
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const bcrypt = require('bcryptjs');
const users = require('./users');

const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const MAX_FAILED = 5;          // неудачных попыток подряд…
const LOCK_MINUTES = 15;       // …и Telegram блокируется на столько минут
const SESSION_MINUTES = 10;    // незаконченный диалог входа забывается

async function unlink(tenantId, userId) {
  const { rowCount } = await pool.query(
    'UPDATE users SET tg_id = NULL, tg_username = NULL WHERE id = $1 AND tenant_id = $2', [userId, tenantId]
  );
  if (!rowCount) throw new HttpError(404, 'Сотрудник не найден');
}

async function findLinkedUser(tenantId, tgId) {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE tenant_id = $1 AND tg_id = $2', [tenantId, tgId]);
  return u || null;
}

// ── диалог входа в боте ──────────────────────────────────────────────

async function getSession(tenantId, tgId) {
  const { rows: [s] } = await pool.query(
    `SELECT *, (updated_at < NOW() - INTERVAL '${SESSION_MINUTES} minutes') AS stale,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
       FROM tg_auth_sessions WHERE tenant_id = $1 AND tg_id = $2`,
    [tenantId, tgId]
  );
  return s || null;
}

// Начать (или начать заново) ввод: ждём логин. Счётчик ошибок не сбрасывается.
async function askLogin(tenantId, tgId) {
  await pool.query(
    `INSERT INTO tg_auth_sessions (tenant_id, tg_id, step, login) VALUES ($1, $2, 'login', NULL)
     ON CONFLICT (tenant_id, tg_id) DO UPDATE SET step = 'login', login = NULL, updated_at = NOW()`,
    [tenantId, tgId]
  );
}

async function rememberLogin(tenantId, tgId, login) {
  await pool.query(
    "UPDATE tg_auth_sessions SET step = 'password', login = $3, updated_at = NOW() WHERE tenant_id = $1 AND tg_id = $2",
    [tenantId, tgId, String(login).trim().slice(0, 100)]
  );
}

// Возвращает { status }:
//   'linked'   — привязан, user в ответе;
//   'invalid'  — неверный логин/пароль (или сотрудник отключён) — одинаковый ответ, чтобы не подсказывать;
//   'taken'    — пароль верный, но сотрудник уже привязан к другому Telegram;
//   'locked'   — слишком много неудачных попыток (lockedMinutes).
async function tryLink(tenantId, tgUser, password) {
  const session = await getSession(tenantId, tgUser.id);
  if (session?.locked) return { status: 'locked', lockedMinutes: LOCK_MINUTES };
  const login = session?.login || '';

  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE tenant_id = $1 AND LOWER(login) = LOWER($2)', [tenantId, login]);
  // Нет такого логина — всё равно гоняем bcrypt по пустышке, чтобы по времени
  // ответа нельзя было отличить «нет логина» от «не тот пароль».
  const passwordOk = await users.checkPassword(u || { password_hash: DUMMY_HASH }, password) && !!u;

  if (!u || !passwordOk || !u.is_active) {
    const { rows: [s] } = await pool.query(
      `UPDATE tg_auth_sessions SET step = 'login', login = NULL, updated_at = NOW(),
              failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= $3 THEN NOW() + INTERVAL '${LOCK_MINUTES} minutes' ELSE locked_until END
        WHERE tenant_id = $1 AND tg_id = $2 RETURNING failed_attempts, locked_until`,
      [tenantId, tgUser.id, MAX_FAILED]
    );
    if (s && s.failed_attempts >= MAX_FAILED) {
      // Блокировка выставлена — со следующего окна считаем заново.
      await pool.query('UPDATE tg_auth_sessions SET failed_attempts = 0 WHERE tenant_id = $1 AND tg_id = $2', [tenantId, tgUser.id]);
      return { status: 'locked', lockedMinutes: LOCK_MINUTES };
    }
    return { status: 'invalid', attemptsLeft: MAX_FAILED - (s?.failed_attempts || 0) };
  }

  // Привязка только к ещё не привязанной записи — условие прямо в UPDATE, чтобы
  // два Telegram не могли одновременно занять одного сотрудника.
  const { rows: [linked] } = await pool.query(
    'UPDATE users SET tg_id = $2, tg_username = $3 WHERE id = $1 AND tg_id IS NULL RETURNING *',
    [u.id, tgUser.id, tgUser.username || null]
  );
  await pool.query('DELETE FROM tg_auth_sessions WHERE tenant_id = $1 AND tg_id = $2', [tenantId, tgUser.id]);
  if (!linked) return { status: 'taken' };
  return { status: 'linked', user: linked };
}

// ── мини-апп ─────────────────────────────────────────────────────────

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

module.exports = {
  unlink, findLinkedUser, getSession, askLogin, rememberLogin, tryLink, verifyInitData,
  MAX_FAILED, LOCK_MINUTES,
};
