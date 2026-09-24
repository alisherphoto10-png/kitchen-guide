-- Техподдержка: обращения (тикеты) сотрудников. Сотрудник пишет боту своего
-- заведения, администратор платформы отвечает на сайте — ответ уходит в тот же чат.

CREATE TABLE support_tickets (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Кто написал последним: 'user' — обращение ждёт ответа.
  last_author  TEXT NOT NULL DEFAULT 'user' CHECK (last_author IN ('user', 'admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  closed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
-- Пока обращение открыто, новые сообщения сотрудника идут в него: открытое — одно.
CREATE UNIQUE INDEX support_tickets_one_open ON support_tickets (user_id) WHERE status = 'open';
CREATE INDEX support_tickets_updated_idx ON support_tickets (updated_at DESC);

CREATE TABLE support_messages (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author          TEXT NOT NULL CHECK (author IN ('user', 'admin')),
  author_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, id);

-- Сотрудник нажал «Техподдержка» — следующее его сообщение боту станет обращением.
ALTER TABLE users ADD COLUMN support_requested_at TIMESTAMPTZ;

-- Настройки платформы (ключ → JSON). Первая — куда слать уведомления о тикетах.
CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
