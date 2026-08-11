
// PUT /api/admin/ttk/:id
router.put('/ttk/:id', requireRole('admin', 'chef', 'sushef'), async (req, res) => {
  try {
    const rid = req.user.restaurant_id;
    const { rows: [old] } = await db.pool.query(
      'SELECT * FROM ttk WHERE id=$1 AND ($2::integer IS NULL OR restaurant_id=$2)',
      [req.params.id, rid]
    );
    // Состав iiko-блюда (iiko_managed_at IS NOT NULL) правится только повторным импортом
    // из iiko, не руками — см. iiko-integration-real-import, Часть 4. Игнорируем
    // присланный ingredients независимо от того, что реально отправил клиент (защита
    // не только в UI, но и на случай прямого запроса к API в обход формы).
    if (old?.iiko_managed_at) {
      req.body = { ...req.body, ingredients: old.ingredients };
    }
    const ok = await db.updateTtk(req.params.id, req.body);
    if (req.body.calories_total !== undefined || req.body.protein_total !== undefined ||
        req.body.fat_total !== undefined || req.body.carbs_total !== undefined) {
      await db.pool.query(
        'UPDATE ttk SET calories_total=$1, protein_total=$2, fat_total=$3, carbs_total=$4 WHERE id=$5',
        [req.body.calories_total || null, req.body.protein_total || null, req.body.fat_total || null, req.body.carbs_total || null, req.params.id]
      );
    }
    ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Не найдено' });

    if (old) {
      const norm = v => (v || '').trim();
      const changed = [];
      if (norm(req.body.ingredients) !== norm(old.ingredients)) changed.push('• Состав');
      if (norm(req.body.cooking) !== norm(old.cooking)) changed.push('• Способ приготовления');
      if (norm(req.body.yield) !== norm(old.yield)) changed.push('• Выход блюда');

      if (changed.length > 0 && await isNotificationEnabled(rid, 'ttk_updated')) {
        const ttkName = req.body.name || old.name;
        const text = `📋 *ТТК обновлена*\n\n*${ttkName}*\n\nОбновлено:\n${changed.join('\n')}`;
        const { rows: cooks } = await db.pool.query(
          "SELECT * FROM users WHERE role='cook' AND tg_id IS NOT NULL AND ($1::integer IS NULL OR restaurant_id=$1)",
