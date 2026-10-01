// Браузер, Этап 5: быстрый доступ к темам на главном экране мастера, прямая
// ссылка #topic=, «Распечатать чек с QR» в «Заказах». После ./run-stage5.sh:
// PW=... NODE_PATH=... node test-ui-stage5.js
const { chromium } = require(process.env.PW || "playwright");
const express = require("express");
const fs = require("fs");
const path = require("path");
const OUT = "/home/oko-kitchen/oko-kitchen/oko-frontend/out";
const STAND = "http://127.0.0.1:3099";
const SHOTS = path.join(__dirname, "shots");
const DATA = path.join(__dirname, "src", "data");
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) { passed++; console.log("  ✓", m); } else { failed++; console.log("  ✗ FAIL:", m); } };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const jobs = () => (fs.existsSync(path.join(DATA, "print-jobs.json")) ? readJson("print-jobs.json") : []);

(async () => {
  const cfg = readJson("oko-order-config.json");
  const app = express();
  app.use(express.static(OUT, { extensions: ["html"] }));
  const srv = app.listen(3098);
  const browser = await chromium.launch();
  const errors = [];
  const page = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.route("https://kitchendesk.chefplan.ru/api/**", async (route) => {
      const req = route.request();
      const res = await fetch(req.url().replace("https://kitchendesk.chefplan.ru", STAND), { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      route.fulfill({ status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json" }, body: Buffer.from(await res.arrayBuffer()) });
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  };
  const login = async (p, url = "http://127.0.0.1:3098/web/oko-order/") => {
    await p.goto(url);
    await p.getByPlaceholder("Пароль").fill("staging-pass");
    await p.getByRole("button", { name: "Войти" }).click();
  };

  console.log("1. Главный экран: все темы сразу");
  let p = await page({ width: 390, height: 844 });
  await login(p);
  await p.getByRole("heading", { name: "Темы" }).waitFor();
  for (const [k, f] of Object.entries(cfg)) ok((await p.locator(`[data-topic="${k}"] .font-medium`).textContent()) === f.label, `тема «${f.label}» в быстром доступе`);
  ok(await p.getByRole("heading", { name: "Группы и их настройка" }).isVisible(), "список групп остался ниже");
  await p.screenshot({ path: path.join(SHOTS, "s5-01-home-phone.png"), fullPage: true });

  console.log("2. Один клик — сразу в тему, «Назад» на главный");
  await p.locator("[data-topic=oblako]").click();
  await p.getByText("Все темы").waitFor();
  ok(await p.locator(".text-xl", { hasText: cfg.oblako.label }).isVisible(), "открыта тема Облако");
  ok(p.url().endsWith("#topic=oblako"), "в адресе #topic=oblako");
  await p.screenshot({ path: path.join(SHOTS, "s5-02-topic-phone.png") });
  await p.getByText("Все темы").click();
  await p.getByRole("heading", { name: "Темы" }).waitFor();
  ok(!p.url().includes("#"), "хэш убран на главном");

  console.log("3. Сохранение из быстрого доступа возвращает на главный, конфиг цел");
  const before = JSON.stringify(readJson("oko-order-config.json").oblako.items);
  await p.locator("[data-topic=oblako]").click();
  await p.getByRole("button", { name: /Сохранить/ }).first().click();
  await p.getByText("Тема сохранена").waitFor();
  ok(await p.getByRole("heading", { name: "Темы" }).isVisible(), "после сохранения — главный экран");
  ok(JSON.stringify(readJson("oko-order-config.json").oblako.items) === before, "позиции не изменились");

  console.log("4. Старая цепочка Группа → Тема работает как раньше");
  await p.getByRole("heading", { name: "Группы и их настройка" }).locator("..").locator("button.flex-1").first().click();
  await p.getByRole("button", { name: "Добавить тему" }).waitFor();
  ok(true, "экран группы открылся");
  await p.locator("button.flex-1", { hasText: cfg.myaso.label }).first().click();
  await p.getByText("Назад", { exact: true }).waitFor();
  await p.getByText("Назад", { exact: true }).click();
  ok(await p.getByRole("button", { name: "Добавить тему" }).isVisible(), "«Назад» из темы → экран группы (как раньше)");
  await p.context().close();

  console.log("5. Прямая ссылка #topic=myaso (закладка)");
  p = await page({ width: 1440, height: 900 });
  await login(p, "http://127.0.0.1:3098/web/oko-order/#topic=myaso");
  await p.getByText("Все темы").waitFor();
  ok(await p.locator(".text-xl", { hasText: cfg.myaso.label }).isVisible(), "сразу открылась тема ВМЯСО");
  await p.screenshot({ path: path.join(SHOTS, "s5-03-topic-desktop.png") });
  await p.getByText("Все темы").click();
  await p.screenshot({ path: path.join(SHOTS, "s5-04-home-desktop.png"), fullPage: true });

  console.log("6. Заказы → «Распечатать чек с QR» для старого заказа");
  const old = Object.entries(readJson("oko-orders.json")).filter(([, o]) => !o.shipToken && !o.shipping && !o.received).sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
  await p.getByRole("button", { name: "Заказы" }).first().click();
  await p.getByRole("heading", { name: "Заказы" }).waitFor();
  const btn = p.locator(`[data-print-qr="${old[0]}"]`);
  await btn.waitFor();
  ok((await btn.textContent()).includes("Распечатать чек с QR"), "кнопка у старого заказа");
  await btn.scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "s5-05-orders-print.png") });
  const n = jobs().length;
  await btn.click();
  await p.getByText("Чек с QR отправлен на принтер ОКО").waitFor();
  const tok = readJson("oko-orders.json")[old[0]].shipToken;
  ok(jobs().length === n + 1 && jobs()[n].qrData.endsWith(tok), "задание печати с QR этого заказа");
  ok((await btn.textContent()).includes("ещё раз"), "кнопка стала «ещё раз»");
  const shippedCount = await p.locator("[data-print-qr]").count();
  const total = (await (await fetch(STAND + "/api/oko-order/admin/orders?limit=200", { headers: { "X-Admin-Password": "staging-pass" } })).json()).orders;
  ok(shippedCount === total.filter((o) => o.canPrintQr).length, "кнопки нет у отправленных/доставленных");
  await p.context().close();

  ok(errors.length === 0, `JS-ошибок нет ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
