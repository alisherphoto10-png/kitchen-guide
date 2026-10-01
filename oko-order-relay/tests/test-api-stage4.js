// Сценарии Этапа 4 против стенда: QR «Отправляется» на чеке, страница по QR,
// фото-чек ответом на сообщение об отправке → «Доставлено», история заказов
// (клиент и админ), прежняя кнопка доставщика. node test-api-stage4.js
const fs = require("fs");
const path = require("path");
const BASE = "http://127.0.0.1:3099";
const PASS = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const DATA = path.join(__dirname, "src", "data");
let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); } }
async function j(method, url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text };
}
async function form(url, fields) {
  const res = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  return { status: res.status, text: await res.text() };
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const calls = async () => (await j("GET", "/__calls")).data;
const cid = () => "t" + Math.random().toString(36).slice(2, 14);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  const cfg = readJson("oko-order-config.json");
  const tokO = cfg.oblako.token;
  const srcChat = String(cfg.oblako.sourceGroupChatId);

  console.log("1. Новый заказ: QR на чеке, состав в записи");
  let r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), name: "Техподдержка KitchenDesk", date: tomorrow, items: [{ name: "Медовик целый", qty: 2 }, { name: "Бургер булочка 100 гр", qty: 10 }], comment: "ТЕСТ" });
  ok(r.status === 200, "заказ принят");
  let orders = readJson("oko-orders.json");
  const [id1, o1] = Object.entries(orders).sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
  ok(/^[A-Za-z0-9_-]{24}$/.test(o1.shipToken), "у заказа токен QR");
  ok(o1.date === tomorrow && o1.items.length === 2 && o1.items[0].unit === "шт.", "дата и состав сохранены");
  ok(o1.sourceThreadId === "3" && o1.kitchenThreadId === "8", "темы сохранены");
  const jobs = readJson("print-jobs.json");
  const job = jobs[jobs.length - 1];
  ok(job.qrData === `https://kitchendesk.chefplan.ru/api/oko-order/ship/${o1.shipToken}`, "в задании печати qrData = ссылка на страницу отправки");
  ok(job.printLines.includes("При отправке отсканируйте QR:"), "на чеке подпись к QR");
  ok(job.printLines.some((l) => l === "Медовик целый — 2 шт."), "строки позиций как раньше");

  console.log("2. История клиента");
  r = await j("GET", `/api/oko-order/history?f=${tokO}`);
  ok(r.status === 200 && r.data.orders[0].id === id1 && r.data.orders[0].status === "new", "новый заказ первым, статус «Новый»");
  ok(r.data.orders.every((o) => !("meta" in o) && !("shipToken" in o)), "в истории нет служебных полей (ip, токен QR)");
  ok(r.data.orders.length <= 30, "не больше 30 заказов");
  const myasoIds = Object.entries(orders).filter(([, o]) => o.venue === "myaso").map(([k]) => k);
  ok(!r.data.orders.some((o) => myasoIds.includes(o.id)), "чужая форма в историю не попадает");
  const legacyIds = Object.entries(orders).filter(([, o]) => !o.items && o.coreMessage && o.venue === "oblako").map(([k]) => k);
  const old = r.data.orders.filter((o) => legacyIds.includes(o.id));
  ok(old.length > 0 && old.every((o) => Array.isArray(o.items) && o.items.length && o.items.every((i) => i.name && i.qty > 0)), "старые заказы: позиции разобраны из текста сообщения");
  ok(old.every((o) => o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date)), "старые заказы: дата разобрана");
  ok((await j("GET", "/api/oko-order/history?f=xxxxxxxxxxxxxxxxxxxxxxxxx")).status === 404, "плохая ссылка — 404");

  console.log("3. «Готовится» по первому «Принято»");
  const muchIdx = o1.categories.findIndex((c) => c.name === "Мучное");
  await j("POST", "/__callback", { id: "a1", data: `oko_accept:${id1}:${muchIdx}`, from: { id: 1074197573, first_name: "Камиль" } });
  r = await j("GET", `/api/oko-order/history?f=${tokO}`);
  const h1 = r.data.orders.find((o) => o.id === id1);
  ok(h1.status === "cooking" && h1.timeline.some((e) => e.status === "cooking"), "статус «Готовится», время в истории");

  console.log("4. Страница по QR");
  r = await j("GET", `/api/oko-order/ship/${o1.shipToken}`);
  ok(r.status === 200 && r.text.includes("🚚 Отправляется") && r.text.includes("Медовик целый"), "страница с составом и кнопкой");
  ok(r.text.includes("noindex"), "не индексируется");
  ok((await j("GET", "/api/oko-order/ship/AAAAAAAAAAAAAAAAAAAAAAAA")).status === 404, "чужой токен — 404");
  ok((await j("GET", "/api/oko-order/ship/../config")).status === 404, "мусор вместо токена — 404");
  const before = (await calls()).length;
  r = await form(`/api/oko-order/ship/${o1.shipToken}`, { trackUrl: "javascript:alert(1)" });
  ok(r.status === 400 && !readJson("oko-orders.json")[id1].shipping, "плохая ссылка отслеживания — 400, не отмечено");
  r = await form(`/api/oko-order/ship/${o1.shipToken}`, { trackUrl: "https://track.example/AB 12" });
  ok(r.status === 400, "ссылка с пробелом — 400");

  console.log("5. Скан QR → «Отправляется»");
  r = await form(`/api/oko-order/ship/${o1.shipToken}`, { trackUrl: "https://track.example/AB12?x=1&y=\"2\"" });
  ok(r.status === 200 && r.text.includes("клиенту ушло сообщение"), "страница подтверждает отправку");
  let rec = readJson("oko-orders.json")[id1];
  ok(rec.shipping && rec.shipping.via === "qr" && rec.shipping.trackUrl.startsWith("https://track.example/AB12"), "shipping записан (via qr, трек)");
  let c = (await calls()).slice(before);
  const toClient = c.filter((x) => x.m === "sendMessage" && String(x.args[0]) === srcChat);
  ok(toClient.length === 1, "клиенту одно сообщение");
  const opts = toClient[0] && toClient[0].args[2];
  ok(opts && opts.message_thread_id === 3 && opts.reply_to_message_id === rec.sourceMessageId, "в тему Облака, ответом на «Заказ отправлен»");
  ok(toClient[0].args[1].includes("ответьте на это сообщение") && toClient[0].args[1].includes("%222%22") && !toClient[0].args[1].includes("\"2\""), "просьба ответить фото чека, кавычки в треке закодированы");
  ok(rec.shipping.messageId && rec.shipping.messageId === toClient.messageId || typeof rec.shipping.messageId === "number", "id сообщения об отправке сохранён");
  const toKitchen = c.filter((x) => x.m === "sendMessage" && String(x.args[0]) === String(cfg.oblako.kitchenGroupChatId));
  ok(toKitchen.length === 1 && toKitchen[0].args[1].includes("по QR") && toKitchen[0].args[2].reply_to_message_id === rec.kitchenMessageId, "в кухню пометка ответом на заказ");
  const n = (await calls()).length;
  r = await form(`/api/oko-order/ship/${o1.shipToken}`, { trackUrl: "https://other.example/1" });
  ok((await calls()).length === n && readJson("oko-orders.json")[id1].shipping.trackUrl.startsWith("https://track.example"), "повторный скан ничего не шлёт и не меняет трек");
  r = await j("GET", `/api/oko-order/history?f=${tokO}`);
  ok(r.data.orders.find((o) => o.id === id1).status === "shipping", "в истории «Отправляется»");

  console.log("6. Фото-чек");
  const shipMsg = rec.shipping.messageId;
  let m0 = (await calls()).length;
  await j("POST", "/__message", { message_id: 9001, chat: { id: Number(srcChat), type: "supergroup", title: "t" }, from: { id: 77, first_name: "Облако" }, message_thread_id: 3, is_topic_message: true, photo: [{ file_id: "small" }, { file_id: "BIGPHOTO" }] });
  ok(!readJson("oko-orders.json")[id1].received && (await calls()).length === m0, "фото без ответа — игнор");
  await j("POST", "/__message", { message_id: 9002, chat: { id: Number(srcChat), type: "supergroup", title: "t" }, from: { id: 77, first_name: "Облако" }, reply_to_message: { message_id: shipMsg }, text: "получили" });
  ok(!readJson("oko-orders.json")[id1].received, "текст ответом — не подтверждение");
  await j("POST", "/__message", { message_id: 9003, chat: { id: -100999, type: "supergroup", title: "x" }, from: { id: 77, first_name: "X" }, reply_to_message: { message_id: shipMsg }, photo: [{ file_id: "P" }] });
  ok(!readJson("oko-orders.json")[id1].received, "фото ответом в ДРУГОМ чате — игнор");
  m0 = (await calls()).length;
  await j("POST", "/__message", { message_id: 9004, chat: { id: Number(srcChat), type: "supergroup", title: "t" }, from: { id: 77, first_name: "Облако", last_name: "Бар" }, message_thread_id: 3, is_topic_message: true, reply_to_message: { message_id: shipMsg }, photo: [{ file_id: "small" }, { file_id: "BIGPHOTO" }] });
  rec = readJson("oko-orders.json")[id1];
  ok(rec.received && rec.received.fileId === "BIGPHOTO" && rec.received.by === "Облако Бар", "«Доставлено»: самое большое фото, кто прислал");
  c = (await calls()).slice(m0);
  ok(c.some((x) => x.m === "sendMessage" && String(x.args[0]) === srcChat && x.args[1].includes("Получение подтверждено") && x.args[2].reply_to_message_id === 9004 && x.args[2].message_thread_id === 3), "клиенту «Получение подтверждено» ответом на фото");
  ok(c.some((x) => x.m === "sendPhoto" && String(x.args[0]) === String(cfg.oblako.kitchenGroupChatId) && x.args[1] === "BIGPHOTO" && x.args[2].caption.includes("Доставлено")), "в кухню фото чека с подписью");
  m0 = (await calls()).length;
  await j("POST", "/__message", { message_id: 9005, chat: { id: Number(srcChat), type: "supergroup", title: "t" }, from: { id: 78, first_name: "Ещё" }, reply_to_message: { message_id: shipMsg }, photo: [{ file_id: "SECOND" }] });
  ok((await calls()).length === m0 && readJson("oko-orders.json")[id1].received.fileId === "BIGPHOTO", "второе фото ничего не меняет");
  r = await j("GET", `/api/oko-order/history?f=${tokO}`);
  const h2 = r.data.orders.find((o) => o.id === id1);
  ok(h2.status === "delivered" && h2.timeline.map((e) => e.status).join() === "new,cooking,shipping,delivered", "история: все 4 статуса по порядку");
  ok(h2.timeline.find((e) => e.status === "shipping").trackUrl.startsWith("https://track.example"), "трек в истории");
  r = await j("GET", `/api/oko-order/ship/${o1.shipToken}`);
  ok(r.text.includes("✅ Доставлено") && !r.text.includes("<form"), "страница QR: «Доставлено», без кнопок");

  console.log("7. Прежняя кнопка доставщика тоже переводит в «Отправляется»; трек дописывается потом");
  r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), name: "Техподдержка KitchenDesk", date: tomorrow, items: [{ name: "Медовик целый", qty: 1 }, { name: "Бургер булочка 100 гр", qty: 1 }] });
  orders = readJson("oko-orders.json");
  const [id2, o2] = Object.entries(orders).sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
  const dIdx = o2.categories.findIndex((x) => x.name === "Десерты"), mIdx = o2.categories.findIndex((x) => x.name === "Мучное");
  await j("POST", "/__callback", { id: "b1", data: `oko_accept:${id2}:${dIdx}`, from: { id: 1, username: "uu_o09", first_name: "Повар" } });
  await j("POST", "/__callback", { id: "b2", data: `oko_accept:${id2}:${mIdx}`, from: { id: 1074197573, first_name: "Камиль" } });
  await j("POST", "/__callback", { id: "b3", data: `oko_accept:${id2}:${dIdx}`, from: { id: 5593095944, first_name: "Алишер" } });
  ok(!readJson("oko-orders.json")[id2].shipping, "доставлена одна категория из двух — ещё не «Отправляется»");
  m0 = (await calls()).length;
  await j("POST", "/__callback", { id: "b4", data: `oko_accept:${id2}:${mIdx}`, from: { id: 5593095944, first_name: "Алишер" } });
  rec = readJson("oko-orders.json")[id2];
  ok(rec.shipping && rec.shipping.via === "button" && rec.shipping.by === "Алишер", "все категории доставлены — «Отправляется» (кнопкой)");
  c = (await calls()).slice(m0);
  ok(c.filter((x) => x.m === "sendMessage" && String(x.args[0]) === srcChat && x.args[1].includes("Заказ отправлен")).length === 1, "клиенту сообщение об отправке (одно)");
  ok(c.some((x) => x.m === "editMessageText" && x.args[0].includes("в процессе доставки")), "прежнее редактирование «в процессе доставки» на месте");
  r = await j("GET", `/api/oko-order/ship/${o2.shipToken}`);
  ok(r.text.includes("Добавить ссылку отслеживания"), "по QR после кнопки — можно добавить трек");
  m0 = (await calls()).length;
  await form(`/api/oko-order/ship/${o2.shipToken}`, { trackUrl: "https://track.example/ZZ" });
  rec = readJson("oko-orders.json")[id2];
  c = (await calls()).slice(m0);
  ok(rec.shipping.trackUrl === "https://track.example/ZZ" && rec.shipping.via === "button", "трек дописан, способ отправки не изменился");
  ok(c.length === 1 && c[0].args[1].includes("Ссылка отслеживания") && c[0].args[2].reply_to_message_id === rec.shipping.messageId, "клиенту трек ответом на «Заказ отправлен»");

  console.log("8. Раздел «Заказы» (админ)");
  ok((await j("GET", "/api/oko-order/admin/orders")).status === 401, "без пароля — 401");
  r = await j("GET", "/api/oko-order/admin/orders?limit=500", null, PASS);
  ok(r.status === 200 && r.data.orders.length <= 300, "с паролем — 200, лимит 300");
  const a1 = r.data.orders.find((o) => o.id === id1);
  ok(a1 && a1.status === "delivered" && a1.receiptPhoto === true && a1.venueLabel === "Облако" && a1.comment === "ТЕСТ", "статус, фото чека, форма, комментарий");
  r = await j("GET", "/api/oko-order/admin/orders?venue=myaso", null, PASS);
  ok(r.data.orders.every((o) => o.venue === "myaso"), "фильтр по форме");
  const legacyMy = r.data.orders.filter((o) => !readJson("oko-orders.json")[o.id].items);
  ok(legacyMy.length > 0 && legacyMy.every((o) => ["new", "cooking", "shipping"].includes(o.status)), "старые заказы — статус из прежних отметок");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
