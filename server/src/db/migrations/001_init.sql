-- Жигули: базовая схема. Мультиклиентская с первого дня — каждая строка
-- данных принадлежит клиенту (tenant_id), все запросы фильтруются по нему.

CREATE TABLE tenants (
  id          SERIAL PRIMARY KEY,
  -- Короткий латинский идентификатор клиента. Понадобится для мини-аппа
  -- (параметр ссылки startapp=<slug>) и вебхука бота — меняется редко.
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id                 SERIAL PRIMARY KEY,
  -- NULL только у администраторов платформы (они не принадлежат клиенту).
  tenant_id          INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  login              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  -- owner  — управляет командой и всем остальным;
  -- editor — ведёт ТТК и категории;
  -- viewer — только смотрит и пересчитывает (повар).
  role               TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  is_platform_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Привязка к Telegram — для будущего бота/мини-аппа, пока не используется.
  tg_id              BIGINT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (is_platform_admin OR tenant_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_login_uq ON users (LOWER(login));
CREATE UNIQUE INDEX users_tenant_tg_uq ON users (tenant_id, tg_id) WHERE tg_id IS NOT NULL;

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX categories_tenant_name_uq ON categories (tenant_id, LOWER(name));

CREATE TABLE recipes (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  -- dish — блюдо, semi — полуфабрикат (может входить в состав других ТТК).
  kind          TEXT NOT NULL DEFAULT 'dish' CHECK (kind IN ('dish', 'semi')),
  cooking       TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  -- Выход: по весу/объёму и/или поштучно (порций), независимо друг от друга.
  yield_weight  NUMERIC,
  yield_unit    TEXT CHECK (yield_unit IN ('кг', 'г', 'л', 'мл')),
  yield_count   NUMERIC,
  -- КБЖУ на весь выход.
  calories      NUMERIC,
  protein       NUMERIC,
  fat           NUMERIC,
  carbs         NUMERIC,
  photo         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX recipes_tenant_idx ON recipes (tenant_id, status);

CREATE TABLE recipe_ingredients (
  id                SERIAL PRIMARY KEY,
  recipe_id         INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  name              TEXT NOT NULL,
  brutto            NUMERIC,
  netto             NUMERIC,
  loss_percent      NUMERIC,
  unit              TEXT,
  -- Ингредиент-полуфабрикат — ссылка на его собственную ТТК того же клиента.
  linked_recipe_id  INTEGER REFERENCES recipes(id) ON DELETE SET NULL
);
CREATE INDEX recipe_ingredients_recipe_idx ON recipe_ingredients (recipe_id, sort_order);
CREATE INDEX recipe_ingredients_linked_idx ON recipe_ingredients (linked_recipe_id);
