# OKO Order Relay — инструкция по деплою

Модуль для двух заведений OKO (Облако, Мясо): постоянная кнопка в теме группы →
форма заказа → автоматическое сообщение в поварскую группу. Плюс админка для
редактирования списка позиций и ID групп/тем без правки кода.

Это временная папка-склад в репозитории `kitchen-guide` — сюда код попал только
для передачи на сервер. К самому лендингу (`web/`) отношения не имеет, после
деплоя эту папку из репозитория можно удалить.

## Структура

```
backend/
  oko-order-api.js            — Express-роутер (items, admin/config, admin/pin-button)
  oko-order-bot-handler.js     — обработчик message.web_app_data → сообщение в поварскую группу
  data/oko-order-config.example.json — образец конфига (скопировать в oko-order-config.json и заполнить)
frontend/
  order/index.html             — форма заказа (открывается кнопкой web_app в теме)
  admin/index.html              — админка (пароль, список позиций, ID групп/тем, кнопка pin)
```

## Шаги деплоя

### 1. Backend

Скопировать `backend/oko-order-api.js` и `backend/oko-order-bot-handler.js` в
папку существующего бэкенда бота (туда же, где `bot.js`).

Создать рабочий конфиг рядом с `oko-order-api.js`:
```
mkdir -p data
cp data/oko-order-config.example.json data/oko-order-config.json
```
(Файл `oko-order-config.json` — реальные данные, в git его класть не нужно.)

В `.env` бэкенда добавить:
```
OKO_ADMIN_PASSWORD=<придумать пароль для админки>
OKO_ORDER_FORM_URL=https://kitchendesk.chefplan.ru/oko-order/
```

В точке входа бэкенда (там, где создаётся `bot` и монтируется express-app),
подключить:
```js
const { createOkoOrderRouter } = require("./oko-order-api");
const { registerOkoOrderHandler } = require("./oko-order-bot-handler");

app.use("/api/oko-order", createOkoOrderRouter(bot));
registerOkoOrderHandler(bot);
```
(Порядок регистрации `bot.on('message', ...)` относительно других обработчиков
сообщений не важен — обработчик сам выходит через `return`, если это не
`web_app_data`.)

Перезапустить процесс бота через pm2.

### 2. Frontend (статика, без сборки)

Скопировать файлы так, чтобы получилось:
```
/home/kitchendesk/frontend/oko-order/index.html         <- frontend/order/index.html
/home/kitchendesk/frontend/oko-order/admin/index.html    <- frontend/admin/index.html
```

Отдельный nginx-блок не нужен — путь `/oko-order/...` уже покрывается
существующим общим `location /` (тем же, что отдаёт `/web/`, `/web-login/`,
`/manual/` через `try_files ... $uri/ ...`).

Проверить:
```
curl -I https://kitchendesk.chefplan.ru/oko-order/
curl -I https://kitchendesk.chefplan.ru/oko-order/admin/
```
Оба должны быть 200.

### 3. Первичная настройка через админку

1. Открыть `https://kitchendesk.chefplan.ru/oko-order/admin/`, ввести пароль
   из `OKO_ADMIN_PASSWORD`.
2. Заполнить для каждого заведения: ID исходной группы, ID темы (thread_id),
   ID поварской группы, (опционально) ID темы в поварской группе.
3. Добавить позиции меню для Облака и для Мяса.
4. Нажать «Сохранить все изменения».
5. Нажать «Отправить и закрепить кнопку в теме» для каждого заведения —
   бот один раз отправит и закрепит сообщение с кнопкой «📝 Заполнить заказ»
   в соответствующей теме. Повторно нажимать не нужно, только если тема/группа
   поменялась.

### Как узнать ID группы/темы

Переслать любое сообщение из нужной темы боту `@RawDataBot` — в ответе будет
`chat.id` (ID группы) и `message_thread_id` (ID темы). Либо форвардить в
любой чат, где сам бот-бэкенд логирует `getUpdates`.

### Тестирование

Рекомендуется сначала завести тестовую группу с темами Облако/Мясо и
тестовую поварскую группу, прогнать полный цикл там, и только потом вписать
в админку настоящие ID вместо тестовых — код трогать не нужно, только поля
в админке.

## Безопасность

`OKO_ADMIN_PASSWORD` — единственная защита админки, никак не связана с
основной системой входа в кабинет. Держать пароль в секрете, передавать
только тем, кто должен редактировать позиции/ID.
