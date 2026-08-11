pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS converted BOOLEAN DEFAULT false`)
  .catch(e => console.error('[DB] demo_sessions.converted:', e.message));

// Метка "это блюдо синхронизируется с iiko" (см. iiko-integration-real-import) —
// проставляется в ttk-import при каждом created/updated, NULL = обычное ручное блюдо.
// Используется, чтобы заблокировать ручное редактирование состава в UI и на бэкенде
// (см. src/api/admin.js PUT /ttk/:id) — состав такого блюда правится только через
// повторный импорт из iiko, не руками.
pool.query(`ALTER TABLE ttk ADD COLUMN IF NOT EXISTS iiko_managed_at TIMESTAMP NULL DEFAULT NULL`)
  .catch(e => console.error('[DB] ttk.iiko_managed_at migration:', e.message));
