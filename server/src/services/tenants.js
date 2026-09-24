// Клиенты платформы — заводит и отключает только администратор платформы.
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db/pool');
const { HttpError } = require('../utils/http');
const users = require('./users');

async function list() {
  const { rows } = await pool.query(
    `SELECT t.*,
            (SELECT COUNT(*)::int FROM recipes r WHERE r.tenant_id = t.id AND r.status = 'active') AS recipe_count,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.is_active) AS user_count,
            (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_activity_at,
            b.username AS bot_username, b.is_active AS bot_active, b.last_error AS bot_error
       FROM tenants t LEFT JOIN tenant_bots b ON b.tenant_id = t.id ORDER BY t.created_at DESC`
  );
  return rows;
}

async function get(id) {
  const { rows: [t] } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
  if (!t) throw new HttpError(404, 'Заведение не найдено');
  return t;
}

function cleanSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)) throw new HttpError(400, 'Идентификатор: латиница, цифры и дефис, 2–41 символ');
  return s;
}

// Заведение + его первый владелец одним действием. Пароль владельца
// возвращается один раз — передать клиенту.
async function create({ name, slug, ownerLogin, ownerName }) {
  const cleanName = String(name || '').trim().slice(0, 200);
  if (!cleanName) throw new HttpError(400, 'Укажите название заведения');
  const s = cleanSlug(slug);
  const login = users.cleanLogin(ownerLogin);
  const password = users.generatePassword();
  try {
    return await withTransaction(async db => {
      const { rows: [tenant] } = await db.query('INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *', [cleanName, s]);
      await db.query(
        `INSERT INTO users (tenant_id, login, password_hash, name, role) VALUES ($1,$2,$3,$4,'owner')`,
        [tenant.id, login, await bcrypt.hash(password, 10), String(ownerName || '').trim().slice(0, 100)]
      );
      return { tenant, owner: { login, password } };
    });
  } catch (e) {
    if (e.code === '23505') {
      throw new HttpError(409, /slug/.test(e.constraint || e.detail || '') ? 'Такой идентификатор уже занят' : 'Такой логин уже занят');
    }
    throw e;
  }
}

async function update(id, { name, is_active }) {
  const t = await get(id);
  const { rows: [row] } = await pool.query(
    'UPDATE tenants SET name = $2, is_active = $3 WHERE id = $1 RETURNING *',
    [id, name !== undefined ? String(name).trim().slice(0, 200) || t.name : t.name, is_active !== undefined ? !!is_active : t.is_active]
  );
  return row;
}

module.exports = { list, get, create, update };
