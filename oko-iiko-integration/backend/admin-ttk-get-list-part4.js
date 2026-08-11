router.get('/ttk', requireRole('admin', 'chef', 'sushef'), async (req, res) => {
  try {
    const rid = req.user.restaurant_id;
    const { rows } = await db.pool.query(
      'SELECT * FROM ttk WHERE ($1::integer IS NULL OR restaurant_id=$1) ORDER BY id',
      [rid]
    );
    // iikoManaged — см. iiko-integration-real-import, Часть 4: редактор ТТК на
    // фронтенде блокирует поле состава для таких блюд.
    res.json(rows.map((t) => ({ ...t, iikoManaged: !!t.iiko_managed_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
