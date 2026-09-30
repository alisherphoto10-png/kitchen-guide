// Браузерная проверка формы и админки на стенде. Запуск после run.sh
// (стенд уже поднят, у Облака выпущен токен тестами API).
const { chromium } = require(process.env.PW || "playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://127.0.0.1:3099";
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) { passed++; console.log("  ✓", m); } else { failed++; console.log("  ✗ FAIL:", m); } };
const cfg = () => JSON.parse(fs.readFileSync(path.join(__dirname, "src/data/oko-order-config.json"), "utf8"));
const orders = () => Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, "src/data/oko-orders.json"), "utf8")));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  console.log("Форма по секретной ссылке (Облако)");
  const token = cfg().oblako.token;
  await page.goto(`${BASE}/oko-order/?f=${token}`);
  await page.waitForSelector("#item-0");
  ok((await page.textContent("#venueLabel")) === "Облако", "заголовок «Облако»");
  await page.fill("#submitterName", "UI тест");
  await page.click("label[for=check-0]");
  await page.click("#item-0 .qty-btn >> text=+");
  await page.fill("#comment", "из браузера");
  await page.screenshot({ path: path.join(SHOTS, "form-filled.png"), fullPage: true });
  const before = orders().length;
  // двойной клик по «Отправить» — должен получиться один заказ
  // кнопка блокируется после первого нажатия; имитируем «двойной» запрос
  // (как при повторе на плохом интернете) — тот же clientOrderId дважды
  await page.evaluate(() => { submitOrder(); submitOrder(); });
  await page.waitForSelector("#doneScreen", { state: "visible" });
  await page.waitForTimeout(300);
  const after = orders();
  ok(after.length === before + 1, `один заказ после двойного клика (+${after.length - before})`);
  const o = after.sort((a, b) => b.createdAt - a.createdAt)[0];
  ok(o.coreMessage.includes("Медовик целый — 2 шт.") && o.meta.via === "token" && o.clientOrderId, "позиция ×2, via=token, clientOrderId есть");
  await page.screenshot({ path: path.join(SHOTS, "form-done.png") });

  console.log("Старый адрес после переключения");
  await page.goto(`${BASE}/oko-order/?venue=oblako`);
  await page.waitForFunction(() => document.getElementById("itemsList").innerText.includes("устарела"));
  ok(!(await page.isVisible("#submitBtn")), "кнопка «Отправить» скрыта, текст «ссылка устарела»");
  await page.screenshot({ path: path.join(SHOTS, "form-expired.png") });

  console.log("Неверный токен");
  await page.goto(`${BASE}/oko-order/?f=${"q".repeat(24)}`);
  await page.waitForFunction(() => document.getElementById("itemsList").innerText.includes("недействительна"));
  ok(true, "показано «ссылка недействительна»");

  console.log("Закрытая форма");
  await fetch(`${BASE}/api/oko-order/admin/set-active`, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" }, body: JSON.stringify({ venue: "oblako", active: false }) });
  await page.goto(`${BASE}/oko-order/?f=${token}`);
  await page.waitForFunction(() => document.getElementById("itemsList").innerText.includes("закрыт"));
  ok((await page.textContent("#venueLabel")) === "Облако", "показано «приём закрыт» с названием формы");
  await page.screenshot({ path: path.join(SHOTS, "form-closed.png") });

  console.log("Админка");
  const admin = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  admin.on("pageerror", (e) => errors.push("admin: " + e.message));
  const dialogs = [];
  admin.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
  await admin.goto(`${BASE}/oko-order/admin/`);
  await admin.fill("#passwordInput", "staging-pass");
  await admin.click("text=Войти");
  await admin.waitForSelector("#venue-oblako .link-box");
  const oblakoBox = await admin.textContent("#venue-oblako .link-box");
  ok(oblakoBox.includes("отключён"), "у Облака: старый адрес отключён");
  ok(!(await admin.isChecked("#venue-oblako .link-box input[type=checkbox]")), "у Облака снята галочка «Активна»");
  ok((await admin.inputValue("#venue-oblako .link-box input[readonly]")).endsWith(`?f=${token}`), "показана секретная ссылка Облака");
  // включить обратно галочкой
  await admin.click("#venue-oblako .link-box input[type=checkbox]");
  await admin.waitForTimeout(300);
  ok(cfg().oblako.active === true, "галочка «Активна» включила форму");
  await admin.screenshot({ path: path.join(SHOTS, "admin.png"), fullPage: false });
  // перевыпуск ссылки из админки
  const oldTok = cfg().oblako.token;
  await admin.click("#venue-oblako >> text=Выпустить новую ссылку");
  await admin.waitForFunction(() => true);
  await admin.waitForTimeout(800);
  ok(dialogs.some((d) => d.includes("Выпустить новую секретную ссылку")), "спрашивает подтверждение");
  ok(dialogs.some((d) => d.startsWith("Готово: у закреплённой кнопки обновлён адрес")), "сообщает, что кнопка обновлена");
  ok(cfg().oblako.token !== oldTok, "токен сменился");
  ok((await admin.inputValue("#venue-oblako .link-box input[readonly]")).endsWith(`?f=${cfg().oblako.token}`), "админка показывает новую ссылку");
  ok(cfg().oblako.cookMentions.length === 2 && cfg().oblako.items.length === 3, "сохранение из админки не потеряло позиции/поваров");

  ok(errors.length === 0, `нет JS-ошибок на страницах ${errors.join(" | ")}`);
  await browser.close();
  console.log(`\nИТОГО UI: ${passed} ок, ${failed} провалов`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
