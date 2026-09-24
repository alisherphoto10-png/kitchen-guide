-- Привязка Telegram по логину/паролю в самом боте вместо персональных ссылок.

DROP TABLE tg_link_codes;

-- Диалог входа в боте: какой шаг (ждём логин / пароль), введённый логин,
-- счётчик неудачных попыток и блокировка от перебора. Одна строка на
-- пару «заведение + Telegram-пользователь».
CREATE TABLE tg_auth_sessions (
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tg_id            BIGINT NOT NULL,
  step             TEXT NOT NULL CHECK (step IN ('login', 'password')),
  login            TEXT,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, tg_id)
);
