// Сценарии Этапа 3 (мастер в /web/) против стенда: вход только паролем (логин KitchenDesk не пускает),
// группы (метаданные, выключатель на всю группу), фото группы не убирается
// уборкой, старый пароль работает как раньше. node test-api-stage3.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const BASE = "http://127.0.0.1:3099";
const PASS = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const kd = (t, extra = {}) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...extra });
const DATA = path.join(__dirname, "src", "data");
let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); } }
async function j(method, url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const cid = () => "t" + Math.random().toString(36).slice(2, 14);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  const cfg0 = readJson("oko-order-config.json");
  const G = String(cfg0.oblako.sourceGroupChatId);
  const tokO = cfg0.oblako.token, tokM = cfg0.myaso.token;

  console.log("1. Вход только паролем (логин KitchenDesk больше не пускает)");
  for (const t of ["kd-oko-admin", "kd-super"]) {
    ok((await j("GET", "/api/oko-order/admin/config", null, kd(t))).status === 401, `Bearer ${t} без пароля — 401`);
  }
  ok((await j("GET", "/api/oko-order/admin/config", null, PASS)).status === 200, "пароль — 200");
  ok((await j("GET", "/api/oko-order/admin/config", null, { ...PASS, Authorization: "Bearer kd-oko-cook" })).status === 200, "пароль + посторонний Authorization — 200 (решает только пароль)");
  ok((await j("GET", "/api/oko-order/admin/config", null, { "X-Admin-Password": "nope" })).status === 401, "неверный пароль — 401");
  const view = (await j("GET", "/api/oko-order/admin/config", null, PASS)).data;
  ok(view.oblako.groupActive === true && view.myaso.groupActive === true, "в админ-конфиге groupActive=true (групп ещё нет)");

  console.log("2. Группы: создание, валидация");
  ok((await j("POST", "/api/oko-order/admin/groups", { chatId: "abc", title: "X" }, PASS)).status === 400, "плохой chatId — 400");
  ok((await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "  " }, PASS)).status === 400, "без названия — 400");
  ok((await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "X", active: "no" }, PASS)).status === 400, "active не boolean — 400");
  
  let r = await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "Перемещения", description: "d".repeat(500), photoUrl: "https://evil.example/x.png", active: true }, PASS);
  ok(r.status === 200, "группа создана");
  let groups = readJson("oko-order-groups.json");
  ok(groups[G].description.length === 300, "описание обрезано до 300");
  ok(!groups[G].photoUrl, "чужая ссылка на фото не сохраняется");
  ok(typeof groups[G].createdAt === "number", "createdAt проставлен");
  const created = groups[G].createdAt;
  r = await j("GET", "/api/oko-order/admin/groups", null, PASS);
  ok(r.status === 200 && r.data[G].title === "Перемещения" && r.data[G].active === true, "GET /admin/groups");
  const cfgAfter = readJson("oko-order-config.json");
  ok(JSON.stringify(cfgAfter) === JSON.stringify(cfg0), "конфиг форм не тронут созданием группы");

  console.log("3. Выключатель группы закрывает все её формы");
  await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "Перемещения", active: false }, PASS);
  ok(readJson("oko-order-groups.json")[G].createdAt === created, "createdAt не меняется при обновлении");
  r = await j("GET", `/api/oko-order/items?f=${tokO}`);
  ok(r.status === 403 && r.data.closed === true, "Облако: items — 403 «приём закрыт»");
  r = await j("GET", `/api/oko-order/items?f=${tokM}`);
  ok(r.status === 403, "ВМЯСО: items — 403");
  r = await j("POST", "/api/oko-order/submit", { f: tokO, clientOrderId: cid(), name: "Техподдержка KitchenDesk", date: tomorrow, items: [{ name: "Медовик целый", qty: 1 }] });
  ok(r.status === 403, "submit в выключенной группе — 403");
  ok(readJson("oko-order-config.json").oblako.active === undefined, "собственный active формы не тронут");
  ok((await j("GET", "/api/oko-order/admin/config", null, PASS)).data.oblako.groupActive === false, "в админке groupActive=false");
  await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "Перемещения", active: true }, PASS);
  ok((await j("GET", `/api/oko-order/items?f=${tokO}`)).status === 200, "группа включена — форма снова открыта");
  await j("POST", "/api/oko-order/admin/set-active", { venue: "oblako", active: false }, PASS);
  ok((await j("GET", `/api/oko-order/items?f=${tokO}`)).status === 403, "выключенная форма закрыта при активной группе");
  ok((await j("GET", `/api/oko-order/items?f=${tokM}`)).status === 200, "соседняя форма работает");
  await j("POST", "/api/oko-order/admin/set-active", { venue: "oblako", active: true }, PASS);

  console.log("4. Сохранение конфига из мастера (с вычисляемыми полями)");
  const v = (await j("GET", "/api/oko-order/admin/config", null, PASS)).data;
  v.oblako.label = "Облако";
  r = await j("POST", "/api/oko-order/admin/config", v, PASS);
  ok(r.status === 200, "POST /admin/config логином KD");
  const saved = readJson("oko-order-config.json");
  ok(!("groupActive" in saved.oblako) && !("formUrl" in saved.oblako), "groupActive/formUrl не записались в конфиг");
  ok(saved.oblako.token === tokO && saved.myaso.token === tokM, "токены не изменились");
  ok(JSON.stringify(saved.oblako.pinned) === JSON.stringify(cfg0.oblako.pinned), "pinned не изменился");
  const nv = JSON.parse(JSON.stringify(v));
  nv.novaya_tema = { label: "Новая тема", sourceGroupChatId: G, sourceThreadId: "5", kitchenGroupChatId: cfg0.oblako.kitchenGroupChatId, kitchenThreadId: "8", items: [{ name: "Эклер", category: "Десерты", unit: "шт." }], cookMentions: [{ label: "Камиль", userId: 1074197573, category: "Десерты" }], token: "hack", restaurantId: "9" };
  r = await j("POST", "/api/oko-order/admin/config", nv, PASS);
  ok(r.status === 200, "новая тема создана");
  const s2 = readJson("oko-order-config.json");
  ok(s2.novaya_tema.token !== "hack" && /^[A-Za-z0-9_-]{24}$/.test(s2.novaya_tema.token), "новой теме выдан свой токен, присланный игнорируется");
  ok(s2.novaya_tema.restaurantId === "1" && s2.novaya_tema.legacySlug === false, "restaurantId=1, legacySlug=false");
  ok((await j("GET", `/api/oko-order/items?f=${s2.novaya_tema.token}`)).status === 200, "новая форма открывается по своей ссылке");

  console.log("5. Удаление группы");
  ok((await j("POST", "/api/oko-order/admin/groups/delete", { chatId: G }, PASS)).status === 409, "группу с темами удалить нельзя — 409");
  await j("POST", "/api/oko-order/admin/groups", { chatId: "-100555", title: "Пустая" }, PASS);
  ok((await j("POST", "/api/oko-order/admin/groups/delete", { chatId: "-100555" }, PASS)).status === 200, "пустую группу удалить можно");
  ok(!readJson("oko-order-groups.json")["-100555"], "удалена из файла");
  ok((await j("POST", "/api/oko-order/admin/groups/delete", { chatId: "-100555" }, PASS)).status === 404, "повторно — 404");

  console.log("6. Фото группы: загрузка и защита от уборки");
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#884422" } }).png().toBuffer();
  r = await j("POST", "/api/oko-order/admin/media", { kind: "group", data: `data:image/png;base64,${png.toString("base64")}` }, PASS);
  ok(r.status === 200 && /\.webp$/.test(r.data.url), "kind=group принимается");
  await j("POST", "/api/oko-order/admin/groups", { chatId: G, title: "Перемещения", photoUrl: r.data.url, active: true }, PASS);
  const name = r.data.url.split("/").pop();
  const file = path.join(DATA, "oko-order-media", name);
  const old = new Date(Date.now() - 3 * 86400000);
  fs.utimesSync(file, old, old);
  await j("POST", "/api/oko-order/admin/config", (await j("GET", "/api/oko-order/admin/config", null, PASS)).data, PASS);
  ok(fs.existsSync(file), "старое фото группы не удалено уборкой при сохранении конфига");
  ok(readJson("oko-order-groups.json")[G].photoUrl === r.data.url, "фото группы сохранено");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
