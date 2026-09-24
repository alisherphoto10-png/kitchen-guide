// Команда заведения — только владелец.
const router = require('express').Router();
const { ah, toId } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const users = require('../services/users');
const telegramLink = require('../services/telegramLink');

router.use(requireRole('owner'));

router.get('/', ah(async (req, res) => res.json(await users.list(req.tenantId))));

router.post('/', ah(async (req, res) => {
  res.status(201).json(await users.create(req.tenantId, req.body || {}));
}));

router.put('/:id', ah(async (req, res) => {
  res.json(await users.update(req.tenantId, toId(req.params.id), req.body || {}));
}));

router.post('/:id/reset-password', ah(async (req, res) => {
  res.json({ password: await users.resetPassword(req.tenantId, toId(req.params.id), (req.body || {}).password) });
}));

// Сброс привязки Telegram — после этого сотрудник снова входит в боте логином и паролем.
router.delete('/:id/telegram', ah(async (req, res) => {
  await telegramLink.unlink(req.tenantId, toId(req.params.id));
  res.json({ ok: true });
}));

module.exports = router;
