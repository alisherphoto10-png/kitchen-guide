const router = require('express').Router();
const db = require('../db/postgres');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/ttk
router.get('/', async (req, res) => {
  try {
    const rid = req.user.restaurant_id;
    const { q = '', cat = '', section = '' } = req.query;
    const all = await db.getAllTtk(rid);
    let result = all;
    if (cat) result = result.filter(t => (t.category || '').toLowerCase() === cat.toLowerCase());
    if (section) result = result.filter(t => (t.section || '').toLowerCase() === section.toLowerCase());
    if (q) {
      const ql = q.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(ql) ||
        (t.category || '').toLowerCase().includes(ql)
      );
    }
    res.json(result.map((t) => ({ ...t, iikoManaged: !!t.iiko_managed_at })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ttk/categories
router.get('/categories', async (req, res) => {
  try {
    const all = await db.getAllTtk(req.user.restaurant_id);
    const cats = [...new Set(all.map(t => t.category).filter(Boolean))].sort();
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ttk/:id
router.get('/:id', async (req, res) => {
  try {
    const isAdmin = ['admin','chef'].includes(req.user.role);
    const ttk = await db.getTtkById(req.params.id);
    if (!ttk) return res.status(404).json({ error: 'ТТК не найдена' });
    if (ttk.restaurant_id !== req.user.restaurant_id) return res.status(403).json({ error: 'Нет доступа' });
    if (!isAdmin && ttk.status === 'архив') return res.status(403).json({ error: 'Нет доступа' });
    res.json({ ...ttk, iikoManaged: !!ttk.iiko_managed_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
