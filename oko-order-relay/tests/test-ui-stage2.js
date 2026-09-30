// Браузерная проверка формы Этапа 2 (макет 02) и админки на стенде.
// Запуск после ./run.sh:  PW=<путь к playwright> NODE_PATH=... node test-ui-stage2.js
const { chromium } = require(process.env.PW || "playwright");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const BASE = "http://127.0.0.1:3099";
const ADMIN = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const SHOTS = path.join(__dirname, "shots");
const DATA = path.join(__dirname, "src", "data");
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) { passed++; console.log("  ✓", m); } else { failed++; console.log("  ✗ FAIL:", m); } };
const cfg = () => JSON.parse(fs.readFileSync(path.join(DATA, "oko-order-config.json"), "utf8"));
const orders = () => Object.values(JSON.parse(fs.readFileSync(path.join(DATA, "oko-orders.json"), "utf8")));
const calls = async () => (await fetch(BASE + "/__calls")).json();
const HERO = "/home/kitchendesk/frontend/waiter-guide/hero/hero-1.jpg";
const LOGO = "/home/kitchendesk/frontend/waiter-guide/logo.jpg";

async function upload(kind, buf, mime) {
  const res = await fetch(BASE + "/api/oko-order/admin/media", {
    method: "POST", headers: ADMIN, body: JSON.stringify({ kind, data: `data:${mime};base64,${buf.toString("base64")}` }),
  });
  return (await res.json()).url;
}

(async () => {
  // ── демо-данные на стенде: фон, логотип, позиции с единицами и фото ──
  const cover = await upload("cover", fs.readFileSync(HERO), "image/jpeg");
  const logo = await upload("logo", fs.readFileSync(LOGO), "image/jpeg");
  const heroMeta = await sharp(HERO).metadata();
  const crop = async (x, y) => upload("item", await sharp(HERO).extract({
    left: Math.floor(heroMeta.width * x), top: Math.floor(heroMeta.height * y),
    width: Math.floor(heroMeta.width * 0.25), height: Math.floor(heroMeta.width * 0.25),
  }).jpeg().toBuffer(), "image/jpeg");
  const p1 = await crop(0.1, 0.3), p2 = await crop(0.5, 0.4);
  const conf = await (await fetch(BASE + "/api/oko-order/admin/config", { headers: ADMIN })).json();
  conf.oblako.coverUrl = cover;
  conf.oblako.logoUrl = logo;
  conf.oblako.items = [
    { name: "Говядина вырезка", category: "Мясо", unit: "кг", photoUrl: p1 },
    { name: "Фарш говяжий", category: "Мясо", unit: "кг", photoUrl: p2 },
    { name: "Свинина шея", category: "Мясо", unit: "кг" },
    { name: "Фарш куриный", category: "Мясо", unit: "кг" },
    { name: "Помидоры", category: "Овощи", unit: "кг" },
    { name: "Огурцы", category: "Овощи", unit: "кг" },
    ...conf.oblako.items,
    { name: '<img src=x onerror="window.__xss=1">', category: "Прочее" },
  ];
  const saveRes = await fetch(BASE + "/api/oko-order/admin/config", { method: "POST", headers: ADMIN, body: JSON.stringify(conf) });
  ok(saveRes.ok, "демо-данные сохранены на стенде");
  const token = cfg().oblako.token;
  const url = `${BASE}/oko-order/?f=${token}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  console.log("1. Открытие страницы: шапка, фон, логотип, дата, категории");
  await page.goto(url);
  await page.waitForSelector(".cat");
  await page.waitForFunction(() => { const i = document.querySelector("#heroBg img"); return i && i.complete && i.naturalWidth > 0; });
  ok((await page.textContent("#venueLabel")) === "Облако", "название клиента в шапке");
  ok(!(await page.$eval("#heroBg", (e) => e.classList.contains("placeholder"))), "фон формы загружен (размытое фото)");
  ok(await page.$eval("#logoBox img", (i) => i.naturalWidth > 0), "логотип загружен");
  const tomorrow = new Date(Date.now() + 86400000);
  const dd = `${String(tomorrow.getDate()).padStart(2, "0")}.${String(tomorrow.getMonth() + 1).padStart(2, "0")}.${tomorrow.getFullYear()}`;
  ok((await page.textContent("#dateText")) === dd, `дата по умолчанию — завтра (${dd})`);
  const catNames = await page.$$eval(".cat .name", (els) => els.map((e) => e.textContent));
  ok(JSON.stringify(catNames) === JSON.stringify(["Мясо", "Овощи", "Десерты", "Мучное", "Прочее"]), "категории в порядке из админки: " + catNames.join(", "));
  ok((await page.textContent(".cat:first-child .sub")).startsWith("4 позиции"), "«4 позиции» у Мяса");
  ok(await page.evaluate(() => !window.__xss), "HTML в названии позиции не выполняется");
  await shot("01-home");

  console.log("2–3. Список позиций, выбор количества");
  await page.click(".cat >> text=Мясо");
  await page.waitForSelector("#scr-cat.active");
  ok((await page.textContent("#catTitle")) === "Мясо", "экран категории «Мясо»");
  ok((await page.$$("#catItems .item")).length === 4, "4 позиции в категории");
  ok(!(await page.$eval("#dock", (d) => d.classList.contains("show"))), "кнопка «Перейти к заказу» скрыта при пустой корзине");
  await shot("02-category");
  await page.click('[data-row="Говядина вырезка"] .add-btn');
  await page.click('[data-row="Говядина вырезка"] .plus');
  await page.click('[data-row="Фарш говяжий"] .add-btn');
  await page.click('[data-row="Фарш куриный"] .add-btn');
  await page.fill('[data-row="Фарш куриный"] input', "1,5");
  await page.press('[data-row="Фарш куриный"] input', "Enter");
  ok((await page.inputValue('[data-row="Говядина вырезка"] input')) === "2", "+ дважды → 2");
  ok((await page.inputValue('[data-row="Фарш куриный"] input')) === "1,5", "ручной ввод «1,5» принят");
  ok((await page.textContent("#dockCount")) === "3", "«Перейти к заказу (3)»");
  await page.waitForTimeout(300);
  await shot("03-quantities");
  await page.click('[data-row="Фарш говяжий"] .stepper button[data-act=dec]');
  ok(await page.$('[data-row="Фарш говяжий"] .add-btn'), "− с 1 убирает позицию (снова кнопка +)");
  await page.fill("#catQuery", "фарш");
  ok((await page.$$("#catItems .item")).length === 2, "поиск «фарш» в категории — 2 позиции");
  await shot("03b-search");

  console.log("Назад и поиск по всему каталогу");
  await page.goBack();
  await page.waitForSelector("#scr-home.active");
  ok((await page.textContent(".cat:first-child .sub")).includes("2 в заказе"), "у Мяса «2 в заказе», кнопка «назад» телефона работает");
  await page.fill("#homeQuery", "мед");
  await page.waitForSelector('#homeBody [data-row="Медовик целый"]');
  ok((await page.textContent('#homeBody [data-row="Медовик целый"] .cat-note')) === "Десерты", "поиск по каталогу показывает категорию");
  await page.click('#homeBody [data-row="Медовик целый"] .add-btn');
  await page.click('#homeQuery ~ .clear');

  console.log("4. Предпросмотр заказа");
  await page.click("#dock .btn");
  await page.waitForSelector("#scr-review.active");
  ok((await page.$$("#reviewItems .item")).length === 3, "3 позиции в заказе");
  const summary = await page.$$eval("#summary .v", (els) => els.map((e) => e.textContent.trim()));
  ok(summary[0] === "3,5 кг · 1 шт." && summary[1] === "3" && summary[2] === "2 категории", "сводка: " + summary.join(" | "));
  ok((await page.textContent("#reviewDate")) === dd, "дата видна на предпросмотре");
  await page.click('#reviewItems [data-row="Медовик целый"] .plus');
  await page.click('#reviewItems [data-row="Медовик целый"] .remove');
  ok((await page.$$("#reviewItems .item")).length === 2, "× убирает позицию из заказа");
  ok((await page.$eval("#summary", (e) => e.textContent)).includes("Мясо"), "сводка пересчитана (одна категория «Мясо»)");
  await page.fill("#comment", "Только свежая продукция");
  await page.fill("#submitterName", "Техподдержка KitchenDesk");
  await shot("04-review");

  console.log("5–6. Отправка и успех");
  const before = orders().length;
  await page.click("#sendBtn");
  await page.waitForSelector("#scr-sending.active");
  await shot("05-sending");
  await page.waitForSelector("#scr-done.active", { timeout: 5000 });
  await page.waitForTimeout(1000);
  await shot("06-done");
  ok(orders().length === before + 1, "ровно один заказ сохранён");
  const kitchen = (await calls()).filter((x) => x.m === "sendMessage" && x.args[0] === "-1003787606132").pop();
  ok(kitchen.args[1].includes("• Говядина вырезка — 2 кг") && kitchen.args[1].includes("• Фарш куриный — 1.5 кг"), "в Telegram «2 кг», «1.5 кг»");
  ok(kitchen.args[1].includes("Только свежая продукция") && kitchen.args[1].includes("Отправил: Техподдержка KitchenDesk"), "комментарий и имя дошли");
  ok((await page.textContent("#doneReceipt")).includes("3,5 кг"), "на экране успеха — итог заказа");

  console.log("Повторить заказ, очистить, пустая корзина");
  await page.click("text=Повторить этот заказ");
  await page.waitForSelector("#scr-review.active");
  ok((await page.$$("#reviewItems .item")).length === 2, "«Повторить этот заказ» — те же позиции");
  ok((await page.inputValue("#submitterName")) === "Техподдержка KitchenDesk", "имя запомнено");
  await page.click("text=Очистить");
  await page.waitForSelector("#scr-empty.active");
  await shot("07-empty");
  await page.click("text=Перейти к каталогу");
  await page.waitForSelector("#scr-home.active");

  console.log("Черновик переживает перезагрузку, двойное нажатие = один заказ");
  await page.click(".cat >> text=Овощи");
  await page.click('[data-row="Огурцы"] .add-btn');
  await page.reload();
  await page.waitForSelector(".cat");
  ok((await page.textContent("#dockCount")) === "1" && (await page.textContent(".cat:nth-child(2) .sub")).includes("1 в заказе"), "после перезагрузки корзина на месте");
  await page.click("#dock .btn");
  await page.waitForSelector("#scr-review.active");
  const n0 = orders().length;
  await page.evaluate(() => { document.getElementById("sendBtn").click(); document.getElementById("sendBtn").click(); });
  await page.waitForSelector("#scr-done.active", { timeout: 5000 });
  ok(orders().length === n0 + 1, "двойное нажатие «Отправить» — один заказ");
  await page.reload();
  await page.waitForSelector(".cat");
  ok(!(await page.$eval("#dock", (d) => d.classList.contains("show"))), "после отправки черновик очищен");

  console.log("Экраны ошибок");
  await page.goto(`${BASE}/oko-order/?venue=oblako`);
  await page.waitForSelector("#scr-blocked.active");
  ok((await page.textContent("#blockedTitle")) === "Ссылка устарела", "старый ?venue= → «Ссылка устарела»");
  await shot("08-expired");
  await page.goto(`${BASE}/oko-order/?f=AAAAAAAAAAAAAAAAAAAAAAAA`);
  await page.waitForSelector("#scr-blocked.active");
  ok((await page.textContent("#blockedTitle")) === "Ссылка недействительна", "чужой токен → «Ссылка недействительна»");
  await fetch(BASE + "/api/oko-order/admin/set-active", { method: "POST", headers: ADMIN, body: JSON.stringify({ venue: "oblako", active: false }) });
  await page.goto(url);
  await page.waitForSelector("#scr-blocked.active");
  ok((await page.textContent("#blockedTitle")) === "Приём заказов закрыт", "выключенная форма → «Приём заказов закрыт»");
  await fetch(BASE + "/api/oko-order/admin/set-active", { method: "POST", headers: ADMIN, body: JSON.stringify({ venue: "oblako", active: true }) });

  console.log("Форма без фона/логотипа (Мясо) — заглушки");
  await page.goto(`${BASE}/oko-order/?f=${cfg().myaso.token}`);
  await page.waitForSelector(".cat");
  ok(await page.$eval("#heroBg", (e) => e.classList.contains("placeholder")), "без фона — фирменная заглушка");
  ok(await page.$("#logoBox svg"), "без логотипа — значок-заглушка");
  await shot("09-no-branding");

  console.log("Админка: оформление, единицы, фото позиции");
  const admin = await ctx.newPage();
  admin.on("pageerror", (e) => errors.push("admin: " + e.message));
  admin.on("dialog", (d) => d.accept());
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.goto(`${BASE}/oko-order/admin/`);
  await admin.fill("#passwordInput", "staging-pass");
  await admin.click("text=Войти");
  await admin.waitForSelector("#venue-oblako .brand-preview");
  ok(await admin.$("#venue-oblako .brand-preview > img"), "превью фона в админке");
  ok(await admin.$("#venue-myaso .brand-preview .lg svg"), "у Мяса превью с заглушкой логотипа");
  const rowSel = '#venue-myaso .item-row:has-text("Медовик целый")';
  await admin.selectOption(`${rowSel} select`, "кг");
  const [chooser] = await Promise.all([admin.waitForEvent("filechooser"), admin.click(`${rowSel} .ph-thumb`)]);
  await chooser.setFiles(LOGO);
  await admin.waitForSelector(`${rowSel} .ph-thumb img`);
  const [chooser2] = await Promise.all([admin.waitForEvent("filechooser"), admin.click('#venue-myaso button:has-text("Загрузить фон")')]);
  await chooser2.setFiles(HERO);
  await admin.waitForSelector("#venue-myaso .brand-preview > img");
  await admin.fill("#newItem-myaso", "Лук репчатый");
  await admin.selectOption("#newItemUnit-myaso", "кг");
  await admin.fill("#newItemCategory-myaso", "Овощи");
  await admin.click('#venue-myaso .add-item button:has-text("Добавить")');
  await admin.click(".save-bar button");
  await admin.waitForFunction(() => /Сохранено|Ошибка/.test(document.getElementById("saveStatus").innerText));
  console.log("    статус:", await admin.textContent("#saveStatus"));
  const my = cfg().myaso;
  const honey = my.items.find((i) => i.name === "Медовик целый");
  ok(honey.unit === "кг" && /^\/api\/oko-order\/media\//.test(honey.photoUrl), "единица и фото позиции сохранились из админки");
  ok(/^\/api\/oko-order\/media\//.test(my.coverUrl), "фон Мяса сохранился из админки");
  ok(my.items.some((i) => i.name === "Лук репчатый" && i.unit === "кг" && i.category === "Овощи"), "новая позиция с единицей «кг»");
  ok(my.token && my.pinned && my.pinned.messageId, "токен и закреплённая кнопка Мяса не тронуты");
  await admin.$eval("#items-myaso", (e) => e.scrollIntoView());
  await admin.screenshot({ path: path.join(SHOTS, "10-admin.png"), fullPage: false });
  await admin.$eval("#venue-myaso .brand-box", (e) => e.scrollIntoView());
  await admin.screenshot({ path: path.join(SHOTS, "10b-admin-branding.png") });

  console.log("Широкий экран");
  const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await wide.goto(url);
  await wide.waitForSelector(".cat");
  const overflow = await wide.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, "на компьютере без горизонтальной прокрутки");
  await wide.screenshot({ path: path.join(SHOTS, "11-desktop.png") });

  ok(errors.length === 0, "нет JS-ошибок" + (errors.length ? ": " + errors.join("; ") : ""));
  await browser.close();
  console.log(`\nИТОГО: ${passed} ок, ${failed} ошибок`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
