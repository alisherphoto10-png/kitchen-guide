// Сценарии Этапа 2 против стенда (бот-заглушка): единицы, фото, фон/логотип,
// загрузка картинок, уборка, совместимость старых позиций. node test-api-stage2.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const BASE = "http://127.0.0.1:3099";
const ADMIN = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const DATA = path.join(__dirname, "src", "data");
const MEDIA = path.join(DATA, "oko-order-media");
let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); }
}
async function j(method, url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}
const calls = async () => (await j("GET", "/__calls")).data;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const cid = () => "t" + Math.random().toString(36).slice(2, 14);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString("base64")}`;

(async () => {
  const cfg0 = readJson("oko-order-config.json");
  const tokO = cfg0.oblako.token;
  const tokM = cfg0.myaso.token;

  console.log("1. Старые позиции: форма и сообщения как раньше");
  let r = await j("GET", `/api/oko-order/items?f=${tokO}`);
  ok(r.status === 200 && r.data.items.length === cfg0.oblako.items.length, "items по секретной ссылке");
  ok(r.data.items.every((i) => i.unit === "шт." && i.photoUrl === null), "у старых позиций unit «шт.», фото нет");
  ok(r.data.coverUrl === null && r.data.logoUrl === null, "без фона и логотипа — null (заглушки)");
  r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), name: "Техподдержка KitchenDesk", date: tomorrow, items: [{ name: "Медовик целый", qty: 2 }] });
  ok(r.status === 200, "заказ из старых позиций принят");
  let c = await calls();
  let kitchen = c.filter((x) => x.m === "sendMessage" && x.args[0] === "-1003787606132").pop();
  ok(kitchen && kitchen.args[1].includes("• Медовик целый — 2 шт.\n") || kitchen.args[1].endsWith("• Медовик целый — 2 шт."), "строка позиции в Telegram не изменилась («— 2 шт.»)");
  let jobs = readJson("print-jobs.json");
  ok(jobs.pop().printLines.includes("Медовик целый — 2 шт."), "строка в тикете не изменилась («— 2 шт.»)");
  r = await j("GET", "/api/oko-order/items?venue=oblako");
  ok(r.status === 410 && r.data.expired, "старый ?venue=oblako по-прежнему «устарела» (410)");

  console.log("2. Загрузка картинок в админке");
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#aa3322" } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: "secret-gps-test" } } }).toBuffer();
  r = await j("POST", "/api/oko-order/admin/media", { kind: "cover", data: dataUrl(photo, "image/jpeg") }, { "Content-Type": "application/json" });
  ok(r.status === 401, "без пароля — 401");
  r = await j("POST", "/api/oko-order/admin/media", { kind: "cover", data: dataUrl(photo, "image/jpeg") }, ADMIN);
  ok(r.status === 200 && /^\/api\/oko-order\/media\/[a-f0-9]{24}\.webp$/.test(r.data.url), "фон загружен, ссылка на наш /media/");
  const coverUrl = r.data.url;
  const img = await fetch(BASE + coverUrl);
  const imgBuf = Buffer.from(await img.arrayBuffer());
  ok(img.status === 200 && img.headers.get("content-type") === "image/webp" && img.headers.get("x-content-type-options") === "nosniff", "картинка отдаётся как image/webp + nosniff");
  const meta = await sharp(imgBuf).metadata();
  ok(meta.format === "webp" && Math.max(meta.width, meta.height) === 1600, `фон уменьшен до 1600 по большей стороне (${meta.width}×${meta.height})`);
  ok(!meta.exif && !imgBuf.includes(Buffer.from("secret-gps-test")), "метаданные (EXIF) вырезаны");
  const logo = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  r = await j("POST", "/api/oko-order/admin/media", { kind: "logo", data: dataUrl(logo, "image/png") }, ADMIN);
  ok(r.status === 200, "логотип PNG загружен");
  const logoUrl = r.data.url;
  const logoMeta = await sharp(Buffer.from(await (await fetch(BASE + logoUrl)).arrayBuffer())).metadata();
  ok(logoMeta.hasAlpha && logoMeta.width === 300, "логотип не увеличен и сохранил прозрачность");
  r = await j("POST", "/api/oko-order/admin/media", { kind: "item", data: dataUrl(photo, "image/jpeg") }, ADMIN);
  const itemPhoto = r.data.url;
  ok(r.status === 200, "фото позиции загружено");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  r = await j("POST", "/api/oko-order/admin/media", { kind: "item", data: dataUrl(svg, "image/svg+xml") }, ADMIN);
  ok(r.status === 400, "SVG отклонён");
  r = await j("POST", "/api/oko-order/admin/media", { kind: "item", data: dataUrl(Buffer.from("<html>not an image</html>"), "image/png") }, ADMIN);
  ok(r.status === 400, "текст под видом PNG отклонён (проверка по байтам)");
  r = await j("POST", "/api/oko-order/admin/media", { kind: "avatar", data: dataUrl(logo, "image/png") }, ADMIN);
  ok(r.status === 400, "неизвестный тип картинки отклонён");
  r = await j("POST", "/api/oko-order/admin/media", { kind: "item", data: dataUrl(Buffer.alloc(9 * 1024 * 1024, 0xff), "image/jpeg") }, ADMIN);
  ok(r.status === 413, "больше 8 МБ — 413");
  const bad = await fetch(BASE + "/api/oko-order/media/..%2F..%2Foko-order-config.json");
  ok(bad.status === 404, "обход пути в /media/ — 404");
  const missing = await fetch(BASE + "/api/oko-order/media/" + "0".repeat(24) + ".webp");
  ok(missing.status === 404, "несуществующая картинка — 404");

  console.log("3. Сохранение конфига: фон, логотип, единицы, фото, защита ссылок");
  let cfg = (await j("GET", "/api/oko-order/admin/config", null, ADMIN)).data;
  cfg.oblako.coverUrl = coverUrl;
  cfg.oblako.logoUrl = "https://evil.example/x.png";
  cfg.oblako.items.push({ name: "Говядина вырезка", category: "Мясо", unit: "кг", photoUrl: itemPhoto });
  cfg.oblako.items.push({ name: "Фарш говяжий", category: "Мясо", unit: "кг", photoUrl: "javascript:alert(1)" });
  cfg.oblako.items.push({ name: "Салфетки", unit: "шт." });
  cfg.myaso.logoUrl = logoUrl;
  cfg.oblako.token = "подделка"; // серверное поле — должно игнорироваться
  r = await j("POST", "/api/oko-order/admin/config", cfg, ADMIN);
  ok(r.status === 200, "конфиг сохранён");
  let disk = readJson("oko-order-config.json");
  ok(disk.oblako.token === tokO, "токен не подменить из админки (как в Этапе 1)");
  ok(disk.oblako.coverUrl === coverUrl, "фон сохранён");
  ok(!("logoUrl" in disk.oblako), "внешняя ссылка на логотип отброшена");
  ok(disk.myaso.logoUrl === logoUrl, "логотип Мяса сохранён");
  const beef = disk.oblako.items.find((i) => i.name === "Говядина вырезка");
  const mince = disk.oblako.items.find((i) => i.name === "Фарш говяжий");
  const napkins = disk.oblako.items.find((i) => i.name === "Салфетки");
  ok(beef.unit === "кг" && beef.photoUrl === itemPhoto, "единица «кг» и фото позиции сохранены");
  ok(!("photoUrl" in mince), "javascript:-ссылка на фото отброшена");
  ok(!("unit" in napkins), "«шт.» не записывается (значение по умолчанию)");
  ok(disk.oblako.items.find((i) => i.name === "Медовик целый").category === "Десерты", "старые позиции не потерялись");
  const dup = JSON.parse(JSON.stringify(cfg));
  dup.oblako.items.push({ name: "Медовик целый" });
  r = await j("POST", "/api/oko-order/admin/config", dup, ADMIN);
  ok(r.status === 400 && /дважды/.test(r.data.error), "дубль позиции — 400 с понятной ошибкой");
  const noName = JSON.parse(JSON.stringify(cfg));
  noName.oblako.items.push({ name: "   " });
  r = await j("POST", "/api/oko-order/admin/config", noName, ADMIN);
  ok(r.status === 400, "позиция без названия — 400");

  console.log("4. Форма видит новое, заказ в кг");
  r = await j("GET", `/api/oko-order/items?f=${tokO}`);
  ok(r.data.coverUrl === coverUrl && r.data.logoUrl === null, "items отдаёт фон и логотип формы");
  ok(r.data.items.find((i) => i.name === "Говядина вырезка").unit === "кг", "items отдаёт единицу");
  r = await j("GET", `/api/oko-order/items?f=${tokM}`);
  ok(r.data.logoUrl === logoUrl && r.data.coverUrl === null, "у Мяса свой логотип, фона нет");
  r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), name: "", date: tomorrow, items: [{ name: "Говядина вырезка", qty: 1.5 }, { name: "Медовик целый", qty: 1 }] });
  ok(r.status === 200, "заказ с кг принят");
  c = await calls();
  kitchen = c.filter((x) => x.m === "sendMessage" && x.args[0] === "-1003787606132").pop();
  ok(kitchen.args[1].includes("• Говядина вырезка — 1.5 кг") && kitchen.args[1].includes("• Медовик целый — 1 шт."), "в Telegram «1.5 кг» и «1 шт.»");
  jobs = readJson("print-jobs.json");
  ok(jobs.pop().printLines.includes("Говядина вырезка — 1.5 кг"), "в тикете «1.5 кг»");
  const cats = kitchen.args[2].reply_markup.inline_keyboard.map((row) => row[0].text);
  ok(cats.includes("✅ Десерты"), "кнопки приёмки по категориям работают как раньше");
  r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), date: tomorrow, items: [{ name: "Говядина вырезка", qty: 1000 }] });
  ok(r.status === 400, "лимит количества (999) действует и для кг");

  console.log("5. Уборка неиспользуемых картинок");
  const orphanOld = path.join(MEDIA, "a".repeat(24) + ".webp");
  const orphanNew = path.join(MEDIA, "b".repeat(24) + ".webp");
  fs.writeFileSync(orphanOld, "x");
  fs.writeFileSync(orphanNew, "x");
  const old = new Date(Date.now() - 2 * 86400000);
  fs.utimesSync(orphanOld, old, old);
  cfg = (await j("GET", "/api/oko-order/admin/config", null, ADMIN)).data;
  r = await j("POST", "/api/oko-order/admin/config", cfg, ADMIN);
  ok(!fs.existsSync(orphanOld), "старая неиспользуемая картинка удалена");
  ok(fs.existsSync(orphanNew), "свежая (загружена, но ещё не сохранена) — оставлена");
  ok(fs.existsSync(path.join(MEDIA, coverUrl.split("/").pop())) && fs.existsSync(path.join(MEDIA, itemPhoto.split("/").pop())), "используемые картинки на месте");

  console.log("6. Лимит входа: ошибки работы не блокируют, подбор пароля — блокирует");
  for (let k = 0; k < 6; k++) await j("POST", "/api/oko-order/admin/media", { kind: "nope" }, ADMIN);
  r = await j("GET", "/api/oko-order/admin/config", null, ADMIN);
  ok(r.status === 200, "6 ошибок загрузки подряд — админка не заблокирована");
  const WRONG = { "Content-Type": "application/json", "X-Admin-Password": "wrong" };
  for (let k = 0; k < 5; k++) await j("GET", "/api/oko-order/admin/config", null, WRONG);
  r = await j("GET", "/api/oko-order/admin/config", null, WRONG);
  ok(r.status === 429, "6-й неверный пароль подряд — 429");

  console.log(`\nИТОГО: ${passed} ок, ${failed} ошибок`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
