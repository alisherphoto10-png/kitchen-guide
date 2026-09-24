const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');

const ROLES = ['owner', 'editor', 'viewer'];

// Без похожих символов (0/O, 1/l/I) — пароль диктуют голосом или переписывают с экрана.
function generatePassword(len = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function cleanLogin(login) {
  const l = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(l)) throw new HttpError(400, 'Логин: 3–40 латинских букв, цифр, точка, дефис или подчёркивание');
  return l;
}

function cleanPassword(p) {
  const s = String(p || '');
  if (s.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
  if (s.length > 100) throw new HttpError(400, 'Слишком длинный пароль');
  return s;
}

async function findForLogin(login) {
  const { rows: [u] } = await pool.query(
    `SELECT u.*, t.is_active AS tenant_active FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.login) = LOWER($1)`,
    [String(login || '').trim()]
  );
  return u || null;
}

async function checkPassword(user, password) {
  return bcrypt.compare(String(password || ''), user.password_hash);
}

async function touchLogin(id) {
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [id]);
}

function publicUser(u) {
  return {
    id: u.id, login: u.login, name: u.name, role: u.role, tenant_id: u.tenant_id,
    is_platform_admin: u.is_platform_admin, is_active: u.is_active, last_login_at: u.last_login_at,
  };
}

async function list(tenantId) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE tenant_id = $1 ORDER BY is_active DESC, role, LOWER(name), LOWER(login)',
    [tenantId]
  );
  return rows.map(publicUser);
}

// Возвращает пароль открытым текстом один раз — показать владельцу, в БД только хеш.
async function create(tenantId, { login, name, role, password }) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'Неизвестная роль');
  const plain = password ? cleanPassword(password) : generatePassword();
  try {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (tenant_id, login, password_hash, name, role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tenantId, cleanLogin(login), await bcrypt.hash(plain, 10), String(name || '').trim().slice(0, 100), role]
    );
    return { user: publicUser(u), password: plain };
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Такой логин уже занят');
    throw e;
  }
}

async function getInTenant(tenantId, id) {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  return u;
}

// Последнего активного владельца нельзя понизить или отключить — иначе
// командой клиента больше некому управлять.
async function assertNotLastOwner(tenantId, user, next) {
  if (user.role !== 'owner' || !user.is_active) return;
  if (next.role === 'owner' && next.is_active) return;
  const { rows: [{ n }] } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1 AND role = 'owner' AND is_active AND id <> $2",
    [tenantId, user.id]
  );
  if (n === 0) throw new HttpError(409, 'Это единственный владелец — сначала назначьте другого');
}

async function update(tenantId, id, patch) {
  const u = await getInTenant(tenantId, id);
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim().slice(0, 100) : u.name,
    role: patch.role !== undefined ? patch.role : u.role,
    is_active: patch.is_active !== undefined ? !!patch.is_active : u.is_active,
  };
  if (!ROLES.includes(next.role)) throw new HttpError(400, 'Неизвестная роль');
  await assertNotLastOwner(tenantId, u, next);
  const { rows: [row] } = await pool.query(
    'UPDATE users SET name = $2, role = $3, is_active = $4 WHERE id = $1 RETURNING *',
    [id, next.name, next.role, next.is_active]
  );
  return publicUser(row);
}

async function resetPassword(tenantId, id) {
  await getInTenant(tenantId, id);
  const plain = generatePassword();
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await bcrypt.hash(plain, 10)]);
  return plain;
}

async function changeOwnPassword(userId, current, next) {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!u || !(await checkPassword(u, current))) throw new HttpError(400, 'Текущий пароль неверный');
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await bcrypt.hash(cleanPassword(next), 10)]);
}

module.exports = {
  ROLES, generatePassword, cleanLogin, cleanPassword, findForLogin, checkPassword, touchLogin, publicUser,
  list, create, update, resetPassword, changeOwnPassword,
};
