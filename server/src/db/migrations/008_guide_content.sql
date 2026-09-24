-- Содержимое страницы гида (/guide/), которое администратор платформы меняет
-- без правки файла: свои фото вместо заглушек блюд и список «Частые вопросы».
CREATE TABLE guide_photos (
  slot        TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guide_faq (
  id          SERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
