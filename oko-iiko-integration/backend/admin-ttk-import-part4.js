    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });

    const connection = await loadDecryptedConnection(rid);
    const token = await iiko.authenticate(connection);

    const dateFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const [charts, products, units] = await Promise.all([
      iiko.getAssemblyCharts(connection, token, dateFrom),
      iiko.getProducts(connection, token),
      iiko.getMeasureUnits(connection, token).catch(() => []),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const unitNameById = new Map((units || []).map((u) => [u.id, u.name]));
    const current = iiko.currentChartsByProduct(charts);

    let created = 0, updated = 0, skipped = 0;
    for (const [productId, chart] of current) {
      const dish = productById.get(productId);
      const name = dish?.name?.trim();
      if (!name) { skipped++; continue; } // блюдо не резолвится в справочнике products — нечего писать

      const ingredients = (chart.items || [])
        .map((item) => {
          const ing = productById.get(item.productId);
          if (!ing?.name) return null; // ингредиент не резолвится — пропускаем строку, не всю ТТК
          const unit = unitNameById.get(ing.mainUnit);
          const amount = formatIikoAmount(item.amountIn);
          return unit ? `${ing.name} — ${amount} ${unit}` : `${ing.name} — ${amount}`;
        })
        .filter(Boolean)
        .join('\n');

      const { rows: existing } = await db.pool.query(
        'SELECT id FROM ttk WHERE restaurant_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1',
        [rid, name]
      );
      if (existing.length) {
        await db.pool.query(
          'UPDATE ttk SET ingredients=$1, iiko_managed_at=NOW() WHERE id=$2',
          [ingredients, existing[0].id]
        );
        updated++;
      } else {
        const newId = await db.addTtk({
