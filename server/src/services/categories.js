const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');

async function list(tenantId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.sort_order,
            (SELECT COUNT(*)::int FROM recipes r WHERE r.category_id = c.id AND r.status = 'active') AS recipe_count
       FROM categories c WHERE c.tenant_id = $1
      ORDER BY c.sort_order, LOWER(c.name)`,
    [tenantId]
  );
  return rows;
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 100);
  if (!n) throw new HttpError(400, 'Укажите название категории');
  return n;
}

function uniqueViolation(e) {
  if (e.code === '23505') throw new HttpError(409, 'Такая категория уже есть');
  throw e;
}

async function create(tenantId, { name }) {
  const { rows: [{ max }] } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS max FROM categories WHERE tenant_id = $1', [tenantId]);
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO categories (tenant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, sort_order',
      [tenantId, cleanName(name), max + 10]
    );
    return row;
  } catch (e) { uniqueViolation(e); }
}

async function rename(tenantId, id, { name }) {
  try {
    const { rowCount } = await pool.query('UPDATE categories SET name = $3 WHERE id = $1 AND tenant_id = $2', [id, tenantId, cleanName(name)]);
    if (!rowCount) throw new HttpError(404, 'Категория не найдена');
  } catch (e) { uniqueViolation(e); }
}

// ids — новый порядок целиком.
async function reorder(tenantId, ids) {
  if (!Array.isArray(ids)) throw new HttpError(400, 'Нужен список id');
  for (let i = 0; i < ids.length; i++) {
    await pool.query('UPDATE categories SET sort_order = $3 WHERE id = $1 AND tenant_id = $2', [parseInt(ids[i], 10), tenantId, (i + 1) * 10]);
  }
}

// ТТК категории не удаляются — остаются «Без категории».
async function remove(tenantId, id) {
  const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!rowCount) throw new HttpError(404, 'Категория не найдена');
}

module.exports = { list, create, rename, reorder, remove };
