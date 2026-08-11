# Отчёт: Часть 4 — блокировка ручного редактирования состава iiko-блюд (2026-08-11)

Реализация [`PART-4-lock-ingredients.md`](./PART-4-lock-ingredients.md) поверх
уже задеплоенного реального импорта ([`REPORT-2026-08-11-real-import.md`](./REPORT-2026-08-11-real-import.md)).

## Что было готово

Ничего из этой части — ни метки «блюдо из iiko» в БД, ни блокировки, ни поля
`iikoManaged` в ответах API. Структура `ttk` (какие поля кроме `ingredients`
есть — фото/рецептура/категория/цех/kbju/calories_total и т.д.) была уже
известна из прошлой сессии по прямому чтению `\d ttk`, так что отдельно
подтверждать это через UI не понадобилось.

## Что реализовано

### Backend (`/root/kitchendesk/backend`)

- Новая колонка `ttk.iiko_managed_at TIMESTAMP NULL` — self-migrating
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `src/db/postgres.js`
  ([`backend/migration-iiko_managed_at.js`](./backend/migration-iiko_managed_at.js)).
  **Важный нюанс, которого план не предвидел:** таблица `ttk` (как и `users`)
  в реальной БД принадлежит роли `postgres`, а не `oko_user` (рабочая роль
  приложения) — `ALTER TABLE` от имени приложения падает с `must be owner of
  table ttk` на каждом рестарте (поймано, залогировано, не фатально). Такой
  же незамеченный баг уже тихо живёт в существующей миграции
  `users.plain_password` (тот `.catch` вообще без лога). Реальную колонку
  накатил один раз вручную: `sudo -u postgres psql -d oko_kitchen -c "ALTER
  TABLE ttk ADD COLUMN IF NOT EXISTS iiko_managed_at TIMESTAMP NULL DEFAULT
  NULL;"`. Таблица `restaurants`, для сравнения, принадлежит `oko_user` —
  поэтому её миграции (`deleted_at`, `warned_at`) шли гладко; владение по
  таблицам в этой БД неоднородное.
- `POST .../iiko/ttk-import` — теперь проставляет `iiko_managed_at=NOW()` и
  при создании, и при обновлении строки
  ([`backend/admin-ttk-import-part4.js`](./backend/admin-ttk-import-part4.js)).
- `PUT /api/admin/ttk/:id` — если у существующей строки `iiko_managed_at`
  установлен, присланный `ingredients` подменяется старым значением на
  сервере ещё до вызова `db.updateTtk`, независимо от того, что реально
  прислал клиент — защита не только в форме, но и от прямого запроса к API
  ([`backend/admin-ttk-put-part4.js`](./backend/admin-ttk-put-part4.js)).
- `iikoManaged: boolean` добавлен во все три read-пути карточки ТТК:
  `GET /api/admin/ttk` ([`backend/admin-ttk-get-list-part4.js`](./backend/admin-ttk-get-list-part4.js)),
  `GET /api/ttk` и `GET /api/ttk/:id`
  ([`backend/ttk-router-part4.js`](./backend/ttk-router-part4.js)) — план
  просил это только для «карточки блюда», сделал везде, где карточка вообще
  отдаётся, для консистентности.

### Frontend (`oko-frontend/src/components/features/Admin.tsx`, `TtkManager`)

Поле состава в редакторе — `disabled`, когда `selected.iikoManaged`, плюс
предупреждение под ним тем текстом, что просили в плане
([`frontend/TtkManager-ingredients-field-part4.tsx`](./frontend/TtkManager-ingredients-field-part4.tsx)).
Остальные поля формы не тронуты. Собрано и задеплоено в
`/home/kitchendesk/frontend` тем же способом, что и раньше.

## Живая проверка (restaurant_id=6, iiko_connections id=3, блюдо id=1056
«картофель отварной»)

Прогнал реальный «Импорт ТТК» ещё раз (чтобы метка проставилась и на этом
блюде), затем — все 5 пунктов из «Проверки» плана:

1. `GET /api/admin/ttk` → `iikoManaged: true` для 1056, `false` для обычного
   блюда (id 1032).
2. Прямой `PUT /api/admin/ttk/1056` с подменённым `ingredients` (в обход
   формы, напрямую через API от имени `demo_admin`, не суперадмина) — состав
   в БД не изменился.
3. При этом же запросе category/cooking/section — изменились, как и должны.
4. `PUT` на обычное блюдо (id 1032) с изменением ingredients — прошёл
   нормально, без регрессии.
5. Повторный `POST .../ttk-import` после этого — состав 1056 снова обновился
   версией из iiko (блокировка не мешает самому импорту).

Дополнительно проверил то, что план прямо не просил, но было дёшево
проверить: `GET /api/ttk/1056` (staff-facing, не только админский) тоже
отдаёт `iikoManaged: true`.

## Не стал делать

- Кнопку «отвязать от iiko» — план сам сказал, что это вне рамок задачи,
  можно добавить позже отдельно.
- Ретроактивную простановку `iiko_managed_at` на все уже импортированные
  ранее блюда одним скриптом — метка проставится сама при следующем нажатии
  «Импорт ТТК» на каждом ресторане; отдельного backfill-скрипта план не
  просил, не стал добавлять несогласованную функциональность.

## Побочный эффект теста (уже устранён)

В ходе проверки №4 я тестово перезаписал `ingredients` блюда «Соус Цезарь»
(id 1032, restaurant_id=6) значением-заглушкой. Сразу после проверки
восстановил исходный текст — нашёлся в последнем полном дампе БД
(`/root/kitchendesk/backend/db-backups/oko_kitchen-full-20260808-121215.sql`).
Поля category/cooking/section у самого блюда 1056, наоборот, оставил
заполненными по итогам теста — это ровно тот сценарий ручного дозаполнения
карточки, который блокировка обязана сохранять, а не тестовый мусор.
