-- Шаг 2: у каждого клиента свой Telegram-бот, подключается из панели без правки кода.

CREATE TABLE tenant_bots (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- Токен от @BotFather — только в зашифрованном виде (AES-256-GCM, ключ
  -- BOT_TOKEN_KEY в server/.env). Наружу не отдаётся никогда, только last4.
  token_encrypted  TEXT NOT NULL,
  token_last4      TEXT NOT NULL,
  -- Числовой id бота из getMe: один и тот же бот не может обслуживать двух клиентов.
  bot_id           BIGINT NOT NULL UNIQUE,
  username         TEXT NOT NULL,
  -- Секрет вебхука: Telegram присылает его в X-Telegram-Bot-Api-Secret-Token.
  webhook_secret   TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_error       TEXT,
  last_update_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Одноразовые ссылки-приглашения: привязать Telegram-аккаунт к сотруднику.
CREATE TABLE tg_link_codes (
  code        TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tg_link_codes_user_idx ON tg_link_codes (user_id);

ALTER TABLE users ADD COLUMN tg_username TEXT;
