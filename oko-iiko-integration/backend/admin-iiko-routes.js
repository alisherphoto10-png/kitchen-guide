// ── IIKO ИНТЕГРАЦИЯ (Фаза 1, суперадмин) ───────────────────────────────
// Сохранение подключения, тест-логин и превью (без реального импорта в наши
// таблицы ТТК/графика — это отдельный следующий шаг). См. iiko-integration-phase1.

function iikoConnectionView(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    base_url: row.base_url,
    login: row.login,
    last_test_ok_at: row.last_test_ok_at,
  };
}

// POST /api/admin/restaurants/:id/iiko/connection (superadmin only)
// Body: { base_url, login, password } — пароль шифруется (AES-256-GCM), открытым
// текстом в БД не попадает и в ответе никогда не отдаётся.
router.post('/restaurants/:id/iiko/connection', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });
    const restaurant = await db.getRestaurantById(rid);
    if (!restaurant) return res.status(404).json({ error: 'Ресторан не найден' });

    const { base_url, login, password } = req.body || {};
    if (!base_url || !login || !password) {
      return res.status(400).json({ error: 'base_url, login и password обязательны' });
    }

    const password_encrypted = iikoCrypto.encrypt(password);
    const row = await db.saveIikoConnection(rid, { base_url: String(base_url).trim(), login: String(login).trim(), password_encrypted });
    res.json({ ok: true, connection: iikoConnectionView(row) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/restaurants/:id/iiko/connection (superadmin only) — без пароля.
router.get('/restaurants/:id/iiko/connection', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });
    const row = await db.getIikoConnection(rid);
    res.json(iikoConnectionView(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/restaurants/:id/iiko/connection/test (superadmin only) —
// реально авторизуется на iiko (GET /resto/api/auth, пароль как SHA1). Пароль
// расшифровывается только здесь, в момент запроса, и дальше не сохраняется.
router.post('/restaurants/:id/iiko/connection/test', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });
    const row = await db.getIikoConnection(rid);
    if (!row) return res.status(404).json({ error: 'Подключение не найдено' });

    try {
      const password = iikoCrypto.decrypt(row.password_encrypted);
      await iiko.authenticate({ base_url: row.base_url, login: row.login, password });
      await db.markIikoConnectionTestOk(rid);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/restaurants/:id/iiko/connection (superadmin only)
router.delete('/restaurants/:id/iiko/connection', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });
    await db.deleteIikoConnection(rid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Общий кусок для превью: достаёт подключение и расшифрованный пароль, или бросает
// ошибку с понятным сообщением (404 "нет подключения" отличаем от прочих через .status).
async function loadDecryptedConnection(rid) {
  const row = await db.getIikoConnection(rid);
  if (!row) {
    const err = new Error('Подключение к iiko не настроено');
    err.status = 404;
    throw err;
  }
  const password = iikoCrypto.decrypt(row.password_encrypted);
  return { base_url: row.base_url, login: row.login, password };
}

// GET /api/admin/restaurants/:id/iiko/ttk-preview (superadmin only) — тянет
// assemblyCharts + products из iiko и отдаёт список блюд с составом, без импорта
// в нашу таблицу ttk (см. Часть 0 отчёта — формат там другой, свободный текст;
// сопоставление форматов — отдельная следующая задача).
router.get('/restaurants/:id/iiko/ttk-preview', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });

    const connection = await loadDecryptedConnection(rid);
    const token = await iiko.authenticate(connection);

    // Год назад — с запасом, чтобы точно захватить и старые версии карт, и актуальную.
    const dateFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const [charts, products, units] = await Promise.all([
      iiko.getAssemblyCharts(connection, token, dateFrom),
      iiko.getProducts(connection, token),
      iiko.getMeasureUnits(connection, token).catch(() => []), // не критично, если недоступно
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const unitNameById = new Map((units || []).map((u) => [u.id, u.name]));
    const current = iiko.currentChartsByProduct(charts);

    const dishes = [...current.entries()].map(([productId, chart]) => {
      const dish = productById.get(productId);
      return {
        iiko_product_id: productId,
        name: dish?.name || null,
        num: dish?.num || null,
        // Проценты потерь — атрибут карточки блюда, НЕ строк состава (подтверждено
        // на демо-стенде: в assemblyCharts.items amountIn===amountOut, а
        // coldLossPercent/hotLossPercent лежат в products.list у самого блюда).
        cold_loss_percent: dish?.coldLossPercent ?? null,
        hot_loss_percent: dish?.hotLossPercent ?? null,
        chart_date_from: chart.dateFrom,
        chart_date_to: chart.dateTo,
        ingredients: (chart.items || []).map((item) => {
          const ing = productById.get(item.productId);
          return {
            iiko_product_id: item.productId,
            name: ing?.name || null,
            num: ing?.num || null,
            amount: item.amountIn,
            unit: unitNameById.get(ing?.mainUnit) || null,
          };
        }),
      };
    });

    res.json({ dishes });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/admin/restaurants/:id/iiko/schedule-preview?from=...&to=... (superadmin only) —
// тянет смены из iiko и резолвит employeeId/roleId в имя/должность, без импорта
// в нашу таблицу schedules (см. Часть 0 отчёта — формат там другой: is_working
// булев флаг на день, без времени смены/должности).
router.get('/restaurants/:id/iiko/schedule-preview', async (req, res) => {
  try {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Только суперадмин' });
    const rid = parseInt(req.params.id);
    if (isNaN(rid)) return res.status(400).json({ error: 'Некорректный id ресторана' });

    const today = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to = req.query.to || weekAhead;

    const connection = await loadDecryptedConnection(rid);
    const token = await iiko.authenticate(connection);

    const [schedule, employees, roles] = await Promise.all([
      iiko.getSchedule(connection, token, from, to),
      iiko.getEmployees(connection, token),
      iiko.getEmployeeRoles(connection, token),
    ]);

    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

    const shifts = schedule.map((s) => {
      const employee = employeeById.get(s.employeeId);
      return {
        iiko_schedule_id: s.id,
        employee_id: s.employeeId,
        employee_name: employee?.name || null,
        role_id: s.roleId,
        role_name: roleNameById.get(s.roleId) || null,
        date_from: s.dateFrom,
        date_to: s.dateTo,
        schedule_type_code: s.scheduleTypeCode,
        department_name: s.departmentName,
      };
    });

    res.json({ from, to, shifts });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── IIKO ИМПОРТ (реальная запись в наши таблицы, вариант А) ────────────
// См. iiko-integration-phase1 / iiko-integration-real-import: без изменения схемы
