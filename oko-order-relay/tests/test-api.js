// Прогон сценариев Этапа 1 против стенда (бот-заглушка). node test-api.js
const fs = require("fs");
const path = require("path");
const BASE = "http://127.0.0.1:3099";
const ADMIN = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const DATA = path.join(__dirname, "src", "data");
let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); }
}
async function j(method, url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const calls = async () => (await j("GET", "/__calls")).data;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const cid = () => "t" + Math.random().toString(36).slice(2, 14);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  console.log("1. Старый адрес ?venue= до переключения работает как раньше");
  let r = await j("GET", "/api/oko-order/items?venue=oblako");
  ok(r.status === 200 && r.data.label === "Облако" && r.data.items.length === 3, "items по ?venue=oblako");
  const ordersBefore = Object.keys(readJson("oko-orders.json")).length;
  // старая страница (из кеша браузера) шлёт без clientOrderId — должно пройти
  r = await j("POST", "/api/oko-order/submit", { venue: "oblako", name: "Тест", date: tomorrow, comment: "<b>x</b>", items: [{ name: "Медовик целый", qty: 2 }, { name: "Бургер булочка 100 гр", qty: 30 }] });
  ok(r.status === 200 && r.data.ok, "submit старой страницей без clientOrderId");
  let c = await calls();
  const kitchen = c.find((x) => x.m === "sendMessage" && x.args[0] === "-1003787606132");
  ok(kitchen && kitchen.args[2].message_thread_id === 8, "заказ ушёл в кухонную группу ОКО, тема 8");
  ok(kitchen && kitchen.args[1].includes("&lt;b&gt;x&lt;/b&gt;"), "комментарий экранирован");
  ok(kitchen && kitchen.args[2].reply_markup.inline_keyboard.length === 2, "две кнопки категорий (Десерты, Мучное)");
  const source = c.find((x) => x.m === "sendMessage" && x.args[0] === "-1003294979946");
  ok(source && source.args[2].message_thread_id === 3, "подтверждение в тему-источник Облака (3)");
  const jobs = readJson("print-jobs.json");
  ok(jobs.length === 1 && jobs[0].restaurantId === "1", "тикет печати в restaurantId 1 (ОКО)");
  let orders = readJson("oko-orders.json");
  ok(Object.keys(orders).length === ordersBefore + 1, "заказ сохранён, старые заказы на месте");
  const saved = Object.values(orders).sort((a, b) => b.createdAt - a.createdAt)[0];
  ok(saved.restaurantId === "1" && saved.meta && saved.meta.via === "legacy" && saved.meta.ip, "в заказе restaurantId, ip, via=legacy");

  console.log("2. Проверки варианта Г");
  const bad = [
    [{ items: [] }, "пустой заказ"],
    [{ items: [{ name: "Чизкейк", qty: 1 }] }, "позиции нет в каталоге"],
    [{ items: [{ name: "Медовик целый", qty: 0 }] }, "qty 0"],
    [{ items: [{ name: "Медовик целый", qty: -3 }] }, "qty < 0"],
    [{ items: [{ name: "Медовик целый", qty: 1000 }] }, "qty > 999"],
    [{ items: [{ name: "Медовик целый", qty: "abc" }] }, "qty не число"],
    [{ items: [{ name: "Медовик целый", qty: 1 }, { name: "Медовик целый", qty: 1 }] }, "дубль позиции"],
    [{ items: [{ name: "Медовик целый", qty: 1 }], date: "" }, "нет даты"],
    [{ items: [{ name: "Медовик целый", qty: 1 }], comment: "x".repeat(1001) }, "длинный комментарий"],
    [{ items: [{ name: "Медовик целый", qty: 1 }], clientOrderId: "../../etc" }, "кривой clientOrderId"],
    [{ items: "nope" }, "items не массив"],
  ];
  const sendsBefore = (await calls()).filter((x) => x.m === "sendMessage").length;
  for (const [patch, label] of bad) {
    r = await j("POST", "/api/oko-order/submit", { venue: "myaso", name: "T", date: tomorrow, ...patch });
    ok(r.status === 400, `отклонено: ${label} → ${r.status} ${r.data && r.data.error}`);
  }
  ok((await calls()).filter((x) => x.m === "sendMessage").length === sendsBefore, "ни одно плохое сообщение не ушло в Telegram");
  r = await j("POST", "/api/oko-order/submit", { venue: "nope", items: [] });
  ok(r.status === 404, "неизвестная форма → 404");

  console.log("3. Защита от двойной отправки");
  const id = cid();
  const payload = { venue: "myaso", clientOrderId: id, name: "Двойной", date: tomorrow, items: [{ name: "Медовик целый", qty: 1 }] };
  const [a, b] = await Promise.all([j("POST", "/api/oko-order/submit", payload), j("POST", "/api/oko-order/submit", payload)]);
  ok(a.status === 200 && b.status === 200, "оба параллельных запроса получили ok");
  ok([a.data.duplicate, b.data.duplicate].filter(Boolean).length === 1, "один из них помечен duplicate");
  r = await j("POST", "/api/oko-order/submit", payload);
  ok(r.status === 200 && r.data.duplicate, "повтор позже → duplicate, без нового заказа");
  const withId = Object.values(readJson("oko-orders.json")).filter((o) => o.clientOrderId === id);
  ok(withId.length === 1, "в хранилище ровно один заказ с этим clientOrderId");
  const kitchenDouble = (await calls()).filter((x) => x.m === "sendMessage" && x.args[1].includes("Двойной"));
  ok(kitchenDouble.length === 2, "в Telegram ушло одно сообщение на кухню + одно подтверждение (2 всего)");

  console.log("4. Переключатель «Активна»");
  r = await j("POST", "/api/oko-order/admin/set-active", { venue: "myaso", active: false }, ADMIN);
  ok(r.status === 200, "выключили myaso");
  r = await j("GET", "/api/oko-order/items?venue=myaso");
  ok(r.status === 403 && r.data.closed, "items → 403 closed");
  r = await j("POST", "/api/oko-order/submit", { ...payload, clientOrderId: cid() });
  ok(r.status === 403 && r.data.closed, "submit → 403 closed");
  r = await j("POST", "/api/oko-order/admin/set-active", { venue: "myaso", active: true }, ADMIN);
  r = await j("GET", "/api/oko-order/items?venue=myaso");
  ok(r.status === 200, "включили обратно — работает");

  console.log("5. Админка: конфиг и серверные поля");
  r = await j("GET", "/api/oko-order/admin/config", null, { "X-Admin-Password": "wrong" });
  ok(r.status === 401, "неверный пароль → 401");
  r = await j("GET", "/api/oko-order/admin/config", null, ADMIN);
  ok(r.data.oblako.formUrl === null && r.data.oblako.legacySlugAllowed === true, "у Облака ещё нет токена, старый адрес разрешён");
  const stale = r.data;
  stale.oblako.token = "hackerhackerhackerhacker";
  stale.oblako.legacySlug = true;
  stale.oblako.restaurantId = "6";
  stale.newclient = { label: "Новый клиент", items: [{ name: "Эклер", category: "Десерты" }], token: "x".repeat(24), legacySlug: true, sourceGroupChatId: null, kitchenGroupChatId: "-1003787606132", kitchenThreadId: "8", cookMentions: [] };
  r = await j("POST", "/api/oko-order/admin/config", stale, ADMIN);
  ok(r.status === 200, "сохранение конфига");
  let cfg = readJson("oko-order-config.json");
  ok(!cfg.oblako.token && cfg.oblako.restaurantId === undefined && cfg.oblako.legacySlug === undefined, "подделанные token/legacySlug/restaurantId у Облака проигнорированы");
  ok(cfg.newclient.token && cfg.newclient.token !== "x".repeat(24) && cfg.newclient.legacySlug === false && cfg.newclient.restaurantId === "1", "новая форма: свой токен, без старого адреса, restaurantId 1");
  ok(!("formUrl" in cfg.oblako) && !("legacySlugAllowed" in cfg.oblako), "вычисляемые поля не записаны на диск");
  ok(cfg.oblako.cookMentions.length === 2 && cfg.oblako.deliveryPerson && cfg.oblako.deliveryPerson.userId === 5593095944, "повара и доставщик Облака сохранились");
  r = await j("GET", "/api/oko-order/items?venue=newclient");
  ok(r.status === 410 && r.data.expired, "новая форма по ?venue= → 410");
  r = await j("GET", `/api/oko-order/items?f=${cfg.newclient.token}`);
  ok(r.status === 200 && r.data.label === "Новый клиент", "новая форма по ?f=token");

  console.log("6. Переключение Облака: rotate-link (кнопки не было → новая + закрепление)");
  const callsBefore = (await calls()).length;
  r = await j("POST", "/api/oko-order/admin/rotate-link", { venue: "oblako" }, ADMIN);
  ok(r.status === 200 && r.data.button === "repinned", "rotate-link → repinned");
  c = (await calls()).slice(callsBefore);
  const pinMsg = c.find((x) => x.m === "sendMessage");
  ok(pinMsg && pinMsg.args[0] === "-1003294979946" && pinMsg.args[2].message_thread_id === 3, "кнопка отправлена в тему Облака");
  cfg = readJson("oko-order-config.json");
  const url = pinMsg.args[2].reply_markup.inline_keyboard[0][0].url;
  ok(url === `https://kitchendesk.chefplan.ru/oko-order/?f=${cfg.oblako.token}`, "в кнопке секретная ссылка");
  ok(c.some((x) => x.m === "pinChatMessage" && x.args[1] === pinMsg.args[2] ? true : x.m === "pinChatMessage"), "закреплено");
  ok(cfg.oblako.legacySlug === false && cfg.oblako.pinned && cfg.oblako.pinned.threadId === "3", "старый адрес выключен, pinned запомнен");
  r = await j("GET", "/api/oko-order/items?venue=oblako");
  ok(r.status === 410 && r.data.expired, "?venue=oblako → 410 «ссылка устарела»");
  r = await j("POST", "/api/oko-order/submit", { venue: "oblako", date: tomorrow, items: [{ name: "Медовик целый", qty: 1 }] });
  ok(r.status === 410, "submit по старому адресу → 410");
  r = await j("GET", "/api/oko-order/items?venue=myaso");
  ok(r.status === 200, "Мясо не затронуто — старый адрес Мяса ещё работает");
  const tok1 = cfg.oblako.token;
  r = await j("POST", "/api/oko-order/submit", { f: tok1, clientOrderId: cid(), name: "По токену", date: tomorrow, items: [{ name: "Медовик целый", qty: 3 }] });
  ok(r.status === 200, "заказ по секретной ссылке");
  orders = readJson("oko-orders.json");
  const tokOrder = Object.entries(orders).find(([, o]) => (o.coreMessage || "").includes("По токену"));
  ok(tokOrder && tokOrder[1].venue === "oblako" && tokOrder[1].meta.via === "token", "заказ записан как oblako, via=token");

  console.log("7. Приёмка по кнопкам для нового заказа (формат хранилища не сломан)");
  const [orderId, ord] = tokOrder;
  const dessertIdx = ord.categories.findIndex((x) => x.name === "Десерты");
  await j("POST", "/__callback", { id: "q1", data: `oko_accept:${orderId}:${dessertIdx}`, from: { id: 42, first_name: "Чужой" } });
  c = await calls();
  ok(c[c.length - 1].m === "answerCallbackQuery" && c[c.length - 1].args[1].text === "Эта кнопка не для вас", "чужой не может принять");
  await j("POST", "/__callback", { id: "q2", data: `oko_accept:${orderId}:${dessertIdx}`, from: { id: 1, username: "uu_o09", first_name: "Повар" } });
  orders = readJson("oko-orders.json");
  ok(orders[orderId].categories[dessertIdx].accepted && orders[orderId].categories[dessertIdx].accepted.name === "Повар", "назначенный повар принял Десерты");
  await j("POST", "/__callback", { id: "q3", data: `oko_accept:${orderId}:${dessertIdx}`, from: { id: 5593095944, first_name: "Алишер" } });
  orders = readJson("oko-orders.json");
  ok(orders[orderId].categories[dessertIdx].delivered && orders[orderId].categories[dessertIdx].delivered.name === "Алишер", "доставщик отметил доставку (вторая стадия)");
  const oldOrderId = Object.keys(orders).find((k) => !orders[k].clientOrderId && !orders[k].meta && orders[k].categories && orders[k].categories.some((x) => !x.accepted));
  if (oldOrderId) {
    const old = orders[oldOrderId];
    const idx = old.categories.findIndex((x) => !x.accepted);
    const cook = old.categories[idx].cooks[0];
    await j("POST", "/__callback", { id: "q4", data: `oko_accept:${oldOrderId}:${idx}`, from: { id: cook.userId || 7, username: cook.username || undefined, first_name: "Старый" } });
    ok(readJson("oko-orders.json")[oldOrderId].categories[idx].accepted, "старый заказ (до Этапа 1) по-прежнему принимается");
  } else {
    ok(true, "(незакрытых старых заказов нет — пропуск)");
  }

  console.log("8. Повторный rotate-link: правка той же кнопки, старый токен мёртв");
  const before8 = (await calls()).length;
  r = await j("POST", "/api/oko-order/admin/rotate-link", { venue: "oblako" }, ADMIN);
  ok(r.status === 200 && r.data.button === "edited", "rotate-link → edited (без нового сообщения)");
  c = (await calls()).slice(before8);
  ok(!c.some((x) => x.m === "sendMessage") && c.some((x) => x.m === "editMessageReplyMarkup"), "новое сообщение не отправлялось");
  r = await j("GET", `/api/oko-order/items?f=${tok1}`);
  ok(r.status === 404, "старый токен → 404");
  cfg = readJson("oko-order-config.json");
  r = await j("GET", `/api/oko-order/items?f=${cfg.oblako.token}`);
  ok(r.status === 200, "новый токен работает");

  console.log("9. Сбой Telegram при переключении Мяса — старая кнопка остаётся рабочей");
  await j("POST", "/__fail", { sendMessage: 1 });
  r = await j("POST", "/api/oko-order/admin/rotate-link", { venue: "myaso" }, ADMIN);
  ok(r.status === 500, `rotate-link → 500 (${r.data.error})`);
  r = await j("GET", "/api/oko-order/items?venue=myaso");
  ok(r.status === 200, "старый адрес Мяса всё ещё работает после сбоя");
  r = await j("POST", "/api/oko-order/admin/rotate-link", { venue: "myaso" }, ADMIN);
  ok(r.status === 200 && r.data.button === "repinned", "повтор rotate-link успешен");
  r = await j("GET", "/api/oko-order/items?venue=myaso");
  ok(r.status === 410, "теперь старый адрес Мяса выключен");
  cfg = readJson("oko-order-config.json");
  ok(cfg.myaso.pinned.threadId === "4", "кнопка Мяса в теме 4");

  console.log("10. pin-button использует секретную ссылку");
  const before10 = (await calls()).length;
  r = await j("POST", "/api/oko-order/admin/pin-button", { venue: "myaso" }, ADMIN);
  c = (await calls()).slice(before10);
  const pm = c.find((x) => x.m === "sendMessage");
  ok(r.status === 200 && pm.args[2].reply_markup.inline_keyboard[0][0].url.endsWith(`?f=${cfg.myaso.token}`), "pin-button → ссылка с токеном");

  console.log("11. Лимиты");
  let got429 = false;
  for (let i = 0; i < 32; i++) {
    const rr = await j("GET", `/api/oko-order/items?f=${"z".repeat(24)}${i}`);
    if (rr.status === 429) { got429 = true; break; }
  }
  ok(got429, "перебор ссылок упирается в 429");
  console.log(`\nИТОГО: ${passed} ок, ${failed} провалов`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
