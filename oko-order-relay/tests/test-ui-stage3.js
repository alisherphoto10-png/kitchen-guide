// Браузерная проверка мастера /web/oko-order (Этап 3) на стенде. Статика —
// собранный Next (out/), запросы к https://kitchendesk.chefplan.ru/api/oko-order/*
// перехватываются и уходят на стенд :3099 (бот-заглушка, копия данных).
// Запуск после ./run.sh: PW=<playwright> NODE_PATH=... node test-ui-stage3.js
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
const cfg = () => JSON.parse(fs.readFileSync(path.join(DATA, "oko-order-config.json"), "utf8"));
const groups = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "oko-order-groups.json"), "utf8")); } catch { return {}; } };
const calls = async () => (await fetch(STAND + "/__calls")).json();

(async () => {
  const app = express();
  app.use("/api", async (req, res) => { const r = await fetch(STAND + "/api" + req.url); res.status(r.status).type(r.headers.get("content-type") || "application/octet-stream").send(Buffer.from(await r.arrayBuffer())); });
  app.use(express.static(OUT, { extensions: ["html"] }));
  const srv = app.listen(3098);
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(token, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.route("https://kitchendesk.chefplan.ru/api/**", async (route) => {
      const req = route.request();
      const url = req.url().replace("https://kitchendesk.chefplan.ru", STAND);
      const res = await fetch(url, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      route.fulfill({ status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await res.arrayBuffer()) });
    });
    await ctx.addInitScript((t) => { localStorage.setItem("web_token", t); localStorage.setItem("web_user", "{}"); }, token);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    return page;
  }
  const c0 = cfg();
  const G = String(c0.oblako.sourceGroupChatId);

  console.log("1. Доступ");
  let p = await newPage("kd-other-admin", { width: 390, height: 844 });
  await p.goto("http://127.0.0.1:3098/web/oko-order/");
  await p.getByText("Нет доступа").waitFor({ timeout: 10000 });
  ok(true, "админ другого заведения видит «Нет доступа»");
  await p.context().close();

  console.log("2. Шаг 1 — список групп (телефон)");
  p = await newPage("kd-oko-admin", { width: 390, height: 844 });
  await p.goto("http://127.0.0.1:3098/web/oko-order/");
  await p.getByRole("heading", { name: "Группы" }).waitFor({ timeout: 10000 });
  ok(await p.getByText("Перемещения между ОКО").first().isVisible(), "группа Облака/ВМЯСО видна (название из Telegram)");
  ok(await p.getByText("2 темы").isVisible(), "у неё 2 темы");
  await p.screenshot({ path: path.join(SHOTS, "s3-01-groups-phone.png"), fullPage: true });

  console.log("3. Шаг 2 — настройки группы");
  await p.getByText("Перемещения между ОКО").first().click();
  await p.getByText("Название группы").waitFor();
  ok(await p.getByText("Облако", { exact: true }).isVisible() && await p.getByText("ВМЯСО", { exact: true }).isVisible(), "темы Облако и ВМЯСО в списке");
  ok(await p.getByText("кнопка закреплена").first().isVisible(), "показано, что кнопка закреплена");
  await p.locator("input").first().fill("ОКО → клиенты");
  await p.locator("textarea").fill("Заказы десертов и выпечки");
  await p.getByRole("button", { name: "Сохранить изменения" }).click();
  await p.getByText("Изменения сохранены").waitFor();
  ok(groups()[G] && groups()[G].title === "ОКО → клиенты" && groups()[G].description === "Заказы десертов и выпечки", "группа сохранена в oko-order-groups.json");
  ok(JSON.stringify(cfg()) === JSON.stringify(c0), "конфиг форм не изменился");
  await p.screenshot({ path: path.join(SHOTS, "s3-02-group-phone.png"), fullPage: true });

  console.log("4. Шаг 3 — существующая тема: правка без потерь");
  await p.getByText("Облако", { exact: true }).click();
  await p.getByText("Тема в Telegram-группе").waitFor();
  ok(await p.getByText("Выбрано: 3").isVisible(), "у Облака выбрано 3 позиции");
  ok(await p.getByText("Повар · Мучное").isVisible() && await p.getByText("Доставка", { exact: true }).isVisible(), "повара и доставщик показаны");
  await p.getByPlaceholder("Поиск по позициям…").fill("булочка 90");
  await p.locator('button[aria-label^="Отметить"]').first().click();
  await p.getByPlaceholder("Поиск по позициям…").fill("");
  await p.screenshot({ path: path.join(SHOTS, "s3-03-topic-phone.png"), fullPage: true });
  await p.getByRole("button", { name: "Сохранить тему" }).click();
  await p.getByText("Тема сохранена").waitFor();
  const c1 = cfg();
  ok(c1.oblako.items.length === 4 && c1.oblako.items.some((i) => i.name === "Бургер булочка 90гр"), "позиция из каталога ВМЯСО добавлена Облаку");
  const strip = (f) => { const x = { ...f }; delete x.items; return x; };
  ok(JSON.stringify(strip(c1.oblako)) === JSON.stringify(strip(c0.oblako)), "все остальные поля Облака (токен, кнопка, фон, повара, группы) не изменились");
  ok(JSON.stringify(c1.myaso) === JSON.stringify(c0.myaso), "ВМЯСО не тронута");
  ok(JSON.stringify(c1.oblako.items.slice(0, 3)) === JSON.stringify(c0.oblako.items), "старые позиции Облака как были");

  console.log("5. Новая тема → Готово → закрепить кнопку");
  await p.getByRole("button", { name: "Добавить тему" }).click();
  await p.getByPlaceholder("Например: Облако").fill("Тестовая тема");
  await p.locator("select").first().selectOption("5");
  ok(await p.locator("select").first().locator('option[value="3"]').evaluate((o) => o.disabled), "занятая тема Telegram (Облако) недоступна");
  await p.getByRole("button", { name: "Добавить позицию" }).click();
  await p.getByPlaceholder("Название, например «Эклер»").fill("Эклер");
  await p.getByPlaceholder("Категория").fill("Десерты");
  await p.getByRole("button", { name: "Добавить", exact: true }).click();
  ok(await p.getByText("Выбрано: 1").isVisible(), "новая позиция сразу отмечена");
  ok(await p.getByText("Повар · Десерты").isVisible(), "повара подставлены из соседней темы");
  await p.getByRole("button", { name: "Добавить пользователя" }).click();
  await p.getByPlaceholder("@username или ID").fill("@test_cook");
  await p.getByPlaceholder("Имя").fill("Иван");
  await p.getByRole("button", { name: "Добавить", exact: true }).click();
  await p.getByRole("button", { name: "Создать тему" }).click();
  await p.getByText("Что настроено:").waitFor();
  const c2 = cfg();
  const key = Object.keys(c2).find((k) => !c0[k]);
  ok(key === "testovaya_tema", "форма создана с ключом testovaya_tema");
  const nf = c2[key];
  ok(nf && nf.sourceGroupChatId === G && nf.sourceThreadId === "5" && nf.kitchenGroupChatId === c0.oblako.kitchenGroupChatId && nf.kitchenThreadId === "8", "группа/тема/получатель как надо");
  ok(nf && /^[A-Za-z0-9_-]{24}$/.test(nf.token) && nf.restaurantId === "1", "токен и restaurantId=1 выданы сервером");
  ok(nf && nf.cookMentions.some((m) => m.username === "test_cook" && m.label === "Иван" && m.category === "Десерты"), "новый повар записан");
  ok(await p.getByText("Кнопка ещё не закреплена в теме").isVisible(), "чеклист: кнопка не закреплена");
  await p.screenshot({ path: path.join(SHOTS, "s3-04-done-phone.png"), fullPage: true });
  await p.getByRole("button", { name: "Закрепить кнопку в теме клиента" }).click();
  await p.getByText("Кнопка «Заполнить заказ» закреплена").waitFor();
  const cl = await calls();
  const sent = cl.filter((x) => x.m === "sendMessage" && String(x.args[0]) === G && x.args[2] && x.args[2].message_thread_id === 5);
  ok(sent.length === 1 && JSON.stringify(sent[0].args[2].reply_markup).includes(nf.token), "кнопка с секретной ссылкой отправлена в тему 5");
  ok(cl.some((x) => x.m === "pinChatMessage"), "и закреплена");
  ok(!!cfg()[key].pinned, "pinned записан");
  const r = await fetch(`${STAND}/api/oko-order/items?f=${nf.token}`);
  ok(r.status === 200, "форма новой темы открывается");

  console.log("6. Выключатель группы со списка");
  await p.getByRole("button", { name: "Все группы" }).click();
  await p.getByRole("switch", { name: "Группа активна" }).first().click();
  await p.getByText("Группа выключена").waitFor();
  ok(groups()[G].active === false, "группа выключена");
  ok((await fetch(`${STAND}/api/oko-order/items?f=${c0.oblako.token}`)).status === 403, "форма Облака закрыта");
  await p.getByRole("switch", { name: "Группа активна" }).first().click();
  await p.getByText("Группа включена").waitFor();
  ok((await fetch(`${STAND}/api/oko-order/items?f=${c0.oblako.token}`)).status === 200, "включили — снова открыта");

  console.log("7. Удаление тестовой темы");
  await p.getByText("ОКО → клиенты").first().click();
  await p.getByText("Тестовая тема").waitFor();
  const row = p.locator("div", { has: p.getByText("Тестовая тема", { exact: true }) }).filter({ has: p.getByRole("button", { name: "Меню" }) }).last();
  await row.getByRole("button", { name: "Меню" }).click();
  await p.getByRole("button", { name: "Удалить тему" }).click();
  await p.getByText("Тема удалена").waitFor();
  ok(!cfg()[key] && cfg().oblako && cfg().myaso, "тестовая тема удалена, Облако и ВМЯСО на месте");
  await p.context().close();

  console.log("8. Компьютер — макет с боковым меню");
  p = await newPage("kd-super", { width: 1440, height: 900 });
  await p.goto("http://127.0.0.1:3098/web/oko-order/");
  await p.getByRole("heading", { name: "Группы" }).waitFor();
  ok(await p.getByText("Заказы клиентов ОКО").isVisible(), "боковое меню модуля на широком экране");
  await p.screenshot({ path: path.join(SHOTS, "s3-05-groups-desktop.png") });
  await p.getByText("ОКО → клиенты").first().click();
  await p.getByText("Название группы").waitFor();
  await p.screenshot({ path: path.join(SHOTS, "s3-06-group-desktop.png"), fullPage: true });
  await p.getByText("ВМЯСО", { exact: true }).click();
  await p.getByText("Тема в Telegram-группе").waitFor();
  await p.mouse.move(900, 500); await p.mouse.wheel(0, 3000); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.getElementById("oko-order-scroll").scrollTop > 300), "страница прокручивается колесом (body overflow:hidden не мешает)");
  ok(await p.getByRole("button", { name: "Сохранить тему" }).isVisible(), "кнопка «Сохранить тему» внизу доступна");
  await p.screenshot({ path: path.join(SHOTS, "s3-07-topic-desktop-bottom.png") });
  await p.evaluate(() => document.getElementById("oko-order-scroll").scrollTo(0, 0));
  await p.screenshot({ path: path.join(SHOTS, "s3-07-topic-desktop.png") });
  await p.getByRole("button", { name: "Назад" }).click();
  await p.getByRole("button", { name: "Назад" }).click();
  await p.getByRole("button", { name: "Подключить группу" }).first().click();
  await p.getByText("Нужной группы нет в списке?").waitFor();
  ok(await p.getByText("ОКО — Кухня").isVisible(), "в выборе группы — группы, которые видел бот");
  await p.screenshot({ path: path.join(SHOTS, "s3-08-connect-desktop.png"), fullPage: true });

  ok(errors.length === 0, `JS-ошибок нет ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
  srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
