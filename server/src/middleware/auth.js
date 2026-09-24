const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');

const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };

function signToken(user) {
  return jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '30d' });
}

// Пользователь перечитывается из БД на каждый запрос — отключение сотрудника
// или клиента срабатывает сразу, а не когда истечёт токен.
//
// req.user     — кто пришёл;
// req.tenantId — чьи данные читаем/пишем. Для сотрудника это всегда его клиент;
//               администратор платформы выбирает клиента заголовком X-Tenant-Id.
// req.role     — роль в этом клиенте (администратор платформы — как owner).
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Нужно войти');
    let payload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Сессия истекла, войдите заново');
    }

    const { rows: [user] } = await pool.query(
      `SELECT u.id, u.tenant_id, u.login, u.name, u.role, u.is_platform_admin, u.is_active, u.tg_id, u.tg_username,
              t.is_active AS tenant_active
         FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1`,
      [payload.uid]
    );
    if (!user || !user.is_active) throw new HttpError(401, 'Доступ закрыт');

    if (user.is_platform_admin) {
      const xTenant = parseInt(req.headers['x-tenant-id'] || '', 10);
      req.tenantId = null;
      if (Number.isInteger(xTenant)) {
        const { rows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [xTenant]);
        if (!rows.length) throw new HttpError(404, 'Заведение не найдено');
        req.tenantId = xTenant;
      }
      req.role = 'owner';
    } else {
      if (!user.tenant_active) throw new HttpError(403, 'Доступ для заведения приостановлен');
      req.tenantId = user.tenant_id;
      req.role = user.role;
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

// Роуты с данными клиента: без выбранного клиента дальше не пускаем.
function requireTenant(req, res, next) {
  if (!req.tenantId) return next(new HttpError(400, 'Не выбрано заведение'));
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if ((ROLE_RANK[req.role] || 0) < ROLE_RANK[minRole]) return next(new HttpError(403, 'Недостаточно прав'));
    next();
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) return next(new HttpError(403, 'Только для администратора платформы'));
  next();
}

module.exports = { signToken, authenticate, requireTenant, requireRole, requirePlatformAdmin, ROLE_RANK };
