const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ah, HttpError } = require('../utils/http');
const { signToken, authenticate } = require('../middleware/auth');
const users = require('../services/users');
const tenants = require('../services/tenants');

// 10 неудачных попыток с одного IP за 15 минут. Успешные входы не считаются.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
});

router.post('/login', loginLimiter, ah(async (req, res) => {
  const { login, password } = req.body || {};
  const user = await users.findForLogin(login);
  // Одно и то же сообщение для «нет логина» и «не тот пароль».
  if (!user || !(await users.checkPassword(user, password))) throw new HttpError(401, 'Неверный логин или пароль');
  if (!user.is_active) throw new HttpError(403, 'Доступ отключён — обратитесь к владельцу заведения');
  if (!user.is_platform_admin && !user.tenant_active) throw new HttpError(403, 'Доступ для заведения приостановлен');
  await users.touchLogin(user.id);
  res.json({ token: signToken(user), user: users.publicUser(user) });
}));

// Кто я и в каком заведении — фронтенд берёт роль отсюда, а не из localStorage.
router.get('/me', authenticate, ah(async (req, res) => {
  const tenant = req.tenantId ? await tenants.get(req.tenantId) : null;
  res.json({
    user: users.publicUser(req.user),
    role: req.role,
    tenant: tenant && { id: tenant.id, name: tenant.name, slug: tenant.slug },
  });
}));

router.post('/password', authenticate, ah(async (req, res) => {
  const { current, next } = req.body || {};
  await users.changeOwnPassword(req.user.id, current, next);
  res.json({ ok: true });
}));

module.exports = router;
