const router = require('express').Router();
const { ah, toId } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const categories = require('../services/categories');

router.get('/', ah(async (req, res) => res.json(await categories.list(req.tenantId))));

router.post('/', requireRole('editor'), ah(async (req, res) => {
  res.status(201).json(await categories.create(req.tenantId, req.body || {}));
}));

router.put('/order', requireRole('editor'), ah(async (req, res) => {
  await categories.reorder(req.tenantId, (req.body || {}).ids);
  res.json({ ok: true });
}));

router.put('/:id', requireRole('editor'), ah(async (req, res) => {
  await categories.rename(req.tenantId, toId(req.params.id), req.body || {});
  res.json({ ok: true });
}));

router.delete('/:id', requireRole('editor'), ah(async (req, res) => {
  await categories.remove(req.tenantId, toId(req.params.id));
  res.json({ ok: true });
}));

module.exports = router;
