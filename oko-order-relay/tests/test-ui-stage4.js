// Браузер, Этап 4: история в форме клиента, страница QR, раздел «Заказы»
// мастера. Запуск после ./run.sh: PW=... NODE_PATH=... node test-ui-stage4.js
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
const post = (u, b) => fetch(STAND + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  const cfg = readJson("oko-order-config.json");
  const tok = cfg.oblako.token, src = Number(cfg.oblako.sourceGroupChatId);
  // демо: три заказа в разных статусах
  const mk = async (items) => { await post("/api/oko-order/submit", { f: tok, clientOrderId: "u" + Math.random().toString(36).slice(2, 12), name: "Техподдержка KitchenDesk", date: tomorrow, items }); const o = readJson("oko-orders.json"); return Object.entries(o).sort((a, b) => b[1].createdAt - a[1].createdAt)[0]; };
  const [idA, oA] = await mk([{ name: "Медовик целый", qty: 2 }, { name: "Бургер булочка 100 гр", qty: 20 }]);
  await post("/__callback", { id: "x", data: `oko_accept:${idA}:${oA.categories.findIndex((c) => c.name === "Мучное")}`, from: { id: 1074197573, first_name: "Камиль" } });
  await fetch(`${STAND}/api/oko-order/ship/${oA.shipToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "trackUrl=" + encodeURIComponent("https://track.example/AB12") });
  const shipMsg = readJson("oko-orders.json")[idA].shipping.messageId;
  await post("/__message", { message_id: 5, chat: { id: src, type: "supergroup" }, from: { id: 9, first_name: "Облако" }, reply_to_message: { message_id: shipMsg }, photo: [{ file_id: "P" }] });
  const [idB, oB] = await mk([{ name: "Шоколадный торт с вишней", qty: 1 }]);
  await fetch(`${STAND}/api/oko-order/ship/${oB.shipToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "trackUrl=" });
  const [idC, oC] = await mk([{ name: "Медовик целый", qty: 1 }]);

  const app = express();
  app.use("/api", async (req, res) => { const r = await fetch(STAND + "/api" + req.url); res.status(r.status).type(r.headers.get("content-type") || "application/octet-stream").send(Buffer.from(await r.arrayBuffer())); });
  app.use("/oko-order", express.static(path.join(__dirname, "frontend", "oko-order")));
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

  console.log("1. Форма клиента → История заказов");
  let p = await page({ width: 390, height: 844 });
  await p.goto(`http://127.0.0.1:3098/oko-order/?f=${tok}`);
  await p.getByRole("button", { name: "История заказов" }).click();
  await p.locator(".h-card").first().waitFor({ timeout: 10000 });
  const chips = await p.locator(".h-card .chip").allTextContents();
  ok(chips[0].includes("Новый") && chips[1].includes("Отправляется") && chips[2].includes("Доставлено"), `статусы по порядку: ${chips.slice(0, 3).join(" | ")}`);
  ok(await p.locator(".h-card").nth(2).locator(".h-step.done").count() === 4, "у доставленного все 4 шага с временем");
  ok(await p.locator(".h-card").nth(2).getByRole("link", { name: "трек" }).getAttribute("href") === "https://track.example/AB12", "ссылка на трек");
  await p.screenshot({ path: path.join(SHOTS, "s4-01-history-phone.png"), fullPage: true });
  await p.goBack();
  await p.locator("#scr-home.active").waitFor();
  ok(true, "«Назад» возвращает в каталог");
  await p.context().close();

  console.log("2. Страница QR (телефон)");
  p = await page({ width: 390, height: 844 });
  await p.goto(`${STAND}/api/oko-order/ship/${oC.shipToken}`);
  ok(await p.getByRole("button", { name: "🚚 Отправляется" }).isVisible(), "кнопка «Отправляется»");
  await p.screenshot({ path: path.join(SHOTS, "s4-02-qr-page.png"), fullPage: true });
  await p.fill("#t", "https://track.example/C1");
  await p.getByRole("button", { name: "🚚 Отправляется" }).click();
  await p.getByText("клиенту ушло сообщение").waitFor();
  ok(readJson("oko-orders.json")[idC].shipping.trackUrl === "https://track.example/C1", "отмечено с треком из браузера");
  await p.screenshot({ path: path.join(SHOTS, "s4-03-qr-done.png"), fullPage: true });
  await p.goto(`${STAND}/api/oko-order/ship/${oB.shipToken}`);
  ok(await p.getByText("Добавить ссылку отслеживания").isVisible(), "без трека — можно добавить потом");
  await p.context().close();

  console.log("3. Мастер → Заказы");
  p = await page({ width: 1440, height: 900 });
  await p.goto("http://127.0.0.1:3098/web/oko-order/");
  await p.getByPlaceholder("Пароль").fill("staging-pass");
  await p.getByRole("button", { name: "Войти" }).click();
  await p.getByRole("button", { name: "Заказы" }).first().click();
  await p.getByRole("heading", { name: "Заказы" }).waitFor();
  await p.getByText("на " + tomorrow).first().waitFor();
  ok(await p.locator("span", { hasText: "✅ Доставлено" }).first().isVisible() && await p.getByText("фото чека в группе").first().isVisible(), "доставленный заказ с отметкой фото чека");
  ok(await p.getByText("по QR").first().isVisible(), "видно, что отправлен по QR");
  await p.screenshot({ path: path.join(SHOTS, "s4-04-orders-desktop.png") });
  await p.getByLabel("Статус").selectOption("delivered");
  const st = await p.locator("span", { hasText: /^(🕐|👨‍🍳|🚚|✅) / }).allTextContents();
  ok(st.length > 0 && st.every((t) => t.includes("Доставлено")), "фильтр по статусу");
  await p.getByLabel("Форма").selectOption("myaso");
  await p.waitForTimeout(500);
  ok(!(await p.getByText("Облако · на").count()), "фильтр по форме");
  await p.context().close();
  p = await page({ width: 390, height: 844 });
  await p.goto("http://127.0.0.1:3098/web/oko-order/");
  await p.getByPlaceholder("Пароль").fill("staging-pass");
  await p.getByRole("button", { name: "Войти" }).click();
  await p.getByRole("button", { name: "Заказы", exact: true }).click();
  await p.getByText("на " + tomorrow).first().waitFor();
  await p.screenshot({ path: path.join(SHOTS, "s4-05-orders-phone.png") });
  ok(true, "Заказы на телефоне");

  ok(errors.length === 0, `JS-ошибок нет ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
