const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const { MODULES, LOCKED_MESSAGE } = require('../modules');

// { recalc: false, ... } — все модули реестра, с учётом значений по умолчанию.
async function forTenant(tenantId) {
  const { rows } = await pool.query('SELECT module_key, enabled FROM tenant_modules WHERE tenant_id = $1', [tenantId]);
  const set = new Map(rows.map(r => [r.module_key, r.enabled]));
  return Object.fromEntries(Object.entries(MODULES).map(([key, m]) => [key, set.has(key) ? set.get(key) : m.defaultEnabled]));
}

async function isEnabled(tenantId, key) {
  return !!(await forTenant(tenantId))[key];
}

// Для панели администратора платформы: модули с описанием и кто/когда переключил.
async function detailed(tenantId) {
  const { rows } = await pool.query(
    `SELECT m.module_key, m.enabled, m.changed_at, u.name AS changed_by_name, u.login AS changed_by_login
       FROM tenant_modules m LEFT JOIN users u ON u.id = m.changed_by WHERE m.tenant_id = $1`,
    [tenantId]
  );
  const byKey = new Map(rows.map(r => [r.module_key, r]));
  return Object.entries(MODULES).map(([key, m]) => {
    const r = byKey.get(key);
    return {
      key, title: m.title, description: m.description,
      enabled: r ? r.enabled : m.defaultEnabled,
      changed_at: r?.changed_at || null,
      changed_by: r ? (r.changed_by_name || r.changed_by_login || null) : null,
    };
  });
}

async function set(tenantId, key, enabled, userId) {
  if (!MODULES[key]) throw new HttpError(404, 'Неизвестный модуль');
  await pool.query(
    `INSERT INTO tenant_modules (tenant_id, module_key, enabled, changed_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = $3, changed_by = $4, changed_at = NOW()`,
    [tenantId, key, !!enabled, userId]
  );
  return detailed(tenantId);
}

// Список включённых модулей по всем заведениям — одним запросом для таблицы «Заведения».
async function allTenants() {
  const { rows } = await pool.query('SELECT tenant_id, module_key, enabled FROM tenant_modules');
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.tenant_id)) out.set(r.tenant_id, {});
    out.get(r.tenant_id)[r.module_key] = r.enabled;
  }
  return tenantId => Object.fromEntries(Object.entries(MODULES).map(([key, m]) => [key, out.get(tenantId)?.[key] ?? m.defaultEnabled]));
}

class ModuleLockedError extends HttpError {
  constructor(key) {
    super(403, LOCKED_MESSAGE);
    this.code = 'module_locked';
    this.module = key;
  }
}

// Защита API-функции модулем: requireModule('recalc').
function requireModule(key) {
  if (!MODULES[key]) throw new Error(`Неизвестный модуль ${key}`);
  return async (req, res, next) => {
    try {
      if (!(await isEnabled(req.tenantId, key))) return next(new ModuleLockedError(key));
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { forTenant, isEnabled, detailed, set, allTenants, requireModule, ModuleLockedError };
