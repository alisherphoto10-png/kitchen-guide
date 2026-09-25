-- iiko: выбор папок номенклатуры для импорта и ежедневное автообновление.

-- id групп iiko (products.parent), из которых импортируются техкарты.
-- NULL — владелец ещё не выбирал: импортируется всё (в дереве всё отмечено).
-- Прямое совпадение с parent товара, без подъёма по иерархии.
ALTER TABLE tenant_iiko ADD COLUMN group_ids JSONB;

-- Автообновление: когда последний раз запускалось (не чаще раза в сутки),
-- когда последний раз прошло успешно, и ошибка последнего неудачного запуска.
ALTER TABLE tenant_iiko ADD COLUMN auto_attempt_at TIMESTAMPTZ;
ALTER TABLE tenant_iiko ADD COLUMN auto_ok_at TIMESTAMPTZ;
ALTER TABLE tenant_iiko ADD COLUMN auto_error TEXT;
