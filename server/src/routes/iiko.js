// Интеграция с iiko: подключение заведения и импорт ТТК. Только владелец и
// только при включённом модуле `iiko` (иначе 403 с LOCKED_MESSAGE).
const router = require('express').Router();
const { ah } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const { requireModule } = require('../services/modules');
const iiko = require('../services/iiko');

router.use(requireRole('owner'), requireModule('iiko'));

router.get('/', ah(async (req, res) => res.json(await iiko.get(req.tenantId))));

router.put('/', ah(async (req, res) => res.json(await iiko.save(req.tenantId, req.user.id, req.body || {}))));

router.post('/test', ah(async (req, res) => res.json(await iiko.test(req.tenantId))));

router.delete('/', ah(async (req, res) => {
  await iiko.remove(req.tenantId);
  res.json({ ok: true });
}));

// Папки номенклатуры iiko деревом + сохранённый выбор (null — ещё не выбирали, всё).
router.get('/groups', ah(async (req, res) => res.json(await iiko.groupsTree(req.tenantId))));

router.put('/groups', ah(async (req, res) => res.json(await iiko.saveGroups(req.tenantId, req.body?.group_ids))));

router.post('/import', ah(async (req, res) => res.json(await iiko.runImport(req.tenantId, req.user.id))));

module.exports = router;
