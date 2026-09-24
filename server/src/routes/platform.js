// Администрирование платформы: список клиентов, заведение новых, отключение.
// Сюда же во втором шаге добавятся боты клиентов.
const router = require('express').Router();
const { ah, toId } = require('../utils/http');
const { requirePlatformAdmin } = require('../middleware/auth');
const tenants = require('../services/tenants');

router.use(requirePlatformAdmin);

router.get('/tenants', ah(async (req, res) => res.json(await tenants.list())));

router.post('/tenants', ah(async (req, res) => {
  res.status(201).json(await tenants.create(req.body || {}));
}));

router.put('/tenants/:id', ah(async (req, res) => {
  res.json(await tenants.update(toId(req.params.id), req.body || {}));
}));

module.exports = router;
