const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ah, HttpError } = require('../utils/http');
const { signToken, authenticate } = require('../middleware/auth');
const users = require('../services/users');
const tenants = require('../services/tenants');
const bots = require('../services/bots');
const telegramLink = require('../services/telegramLink');
const modules = require('../services/modules');

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

// Вход из мини-аппа. tenant — slug из ссылки (?t= или startapp); по нему
// находим бота клиента и его токеном проверяем подпись initData.
router.post('/telegram', loginLimiter, ah(async (req, res) => {
  const { initData, tenant } = req.body || {};
  const bot = await bots.getActiveBySlug(tenant);
  if (!bot) throw new HttpError(404, 'Бот заведения не найден или отключён');
  const data = telegramLink.verifyInitData(initData, bots.tokenOf(bot));
  if (!data) throw new HttpError(401, 'Не удалось подтвердить вход через Telegram — откройте приложение заново из бота');
  if (!bot.tenant_active) throw new HttpError(403, 'Доступ для заведения приостановлен');
  const user = await telegramLink.findLinkedUser(bot.tenant_id, data.user.id);
  if (!user) throw new HttpError(403, 'Ваш Telegram ещё не привязан. Откройте чат с ботом, нажмите «Старт» и войдите логином и паролем от владельца.');
  if (!user.is_active) throw new HttpError(403, 'Доступ отключён — обратитесь к владельцу заведения');
  await users.touchLogin(user.id);
  res.json({ token: signToken(user, 'telegram'), user: users.publicUser(user) });
}));

// Кто я и в каком заведении — фронтенд берёт роль отсюда, а не из localStorage.
router.get('/me', authenticate, ah(async (req, res) => {
  const tenant = req.tenantId ? await tenants.get(req.tenantId) : null;
  res.json({
    user: users.publicUser(req.user),
    role: req.role,
    via: req.authVia,
    tenant: tenant && {
      id: tenant.id, name: tenant.name, slug: tenant.slug,
      bot: await bots.summary(tenant.id),
      modules: await modules.forTenant(tenant.id),
    },
  });
}));

router.post('/password', authenticate, ah(async (req, res) => {
  const { current, next } = req.body || {};
  await users.changeOwnPassword(req.user.id, current, next);
  res.json({ ok: true });
}));

module.exports = router;
