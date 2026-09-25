-- Интеграция с iiko (платный модуль `iiko`, см. src/modules.js).
-- Подключение — своё у каждого заведения: заводит владелец, не платформа.
CREATE TABLE tenant_iiko (
  tenant_id           INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Адрес iikoServer с суффиксом /resto: https://<хост>.iiko.it/resto
  base_url            TEXT NOT NULL,
  login               TEXT NOT NULL,
  -- Пароль — только зашифрованным (тот же secretBox, что у токенов ботов).
  -- Наружу не отдаётся никогда.
  password_encrypted  TEXT NOT NULL,
  last_test_ok_at     TIMESTAMPTZ,
  last_error          TEXT,
  last_import_at      TIMESTAMPTZ,
  last_import_result  JSONB,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Карта пришла из iiko: id продукта iiko (для повторного импорта без дублей)
-- и когда последний раз синхронизирована. Пока модуль включён, состав/выход/
-- название/тип такой карты вручную не правятся — только повторным импортом.
ALTER TABLE recipes ADD COLUMN iiko_product_id TEXT;
ALTER TABLE recipes ADD COLUMN iiko_managed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX recipes_tenant_iiko_uq ON recipes (tenant_id, iiko_product_id) WHERE iiko_product_id IS NOT NULL;
