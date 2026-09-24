-- Платные модули заведения. Список модулей — в коде (src/modules.js);
-- здесь только включения. Нет строки = значение по умолчанию из реестра
-- (для платных — выключено).
CREATE TABLE tenant_modules (
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, module_key)
);
