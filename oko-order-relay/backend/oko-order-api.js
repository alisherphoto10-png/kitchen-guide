const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { readKnownChats, renameTopic } = require("./oko-known-chats");
const {
  createOrderId,
  saveOrder,
  getOrder,
  markAccepted,
  markCategoryAccepted,
  markFinalNotified,
  markDelivery,
  markCategoryDelivered,
  markDeliveryFinalNotified,
  findOrderByClientId,
} = require("./oko-order-store");

const ACCEPT_CALLBACK_PREFIX = "oko_accept:";

// ── Этап 2 (2026-09-30): единицы измерения, фото позиций, фон и логотип ──
// Всё необязательное и обратно совместимое: у старых позиций единицы нет →
// «шт.», поэтому сообщения в Telegram и тикеты для них не меняются ни на
// символ. Картинки загружаются только через админку (POST /admin/media),
// пережимаются сервером в webp и отдаются с этого же роутера — ссылка в
// конфиге принимается ТОЛЬКО на наш /media/ (не произвольный адрес).
const DEFAULT_UNIT = "шт.";
const UNIT_MAX_LEN = 12;
const ITEM_NAME_MAX_LEN = 120;
const CATEGORY_MAX_LEN = 60;
const MEDIA_URL_PREFIX = "/api/oko-order/media/";
const MEDIA_NAME_RE = /^[a-f0-9]{24}\.webp$/;
const MEDIA_DIR = path.join(__dirname, "data", "oko-order-media");
const MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// Максимальная сторона после пережатия: фон — на всю ширину телефона с
// запасом под retina, логотип и фото позиций — маленькие миниатюры.
const MEDIA_KINDS = { cover: 1600, logo: 512, item: 640 };
const MEDIA_GC_AGE_MS = 24 * 60 * 60 * 1000;

function cleanMediaUrl(value) {
  if (typeof value !== "string" || !value.startsWith(MEDIA_URL_PREFIX)) return null;
  const name = value.slice(MEDIA_URL_PREFIX.length);
  return MEDIA_NAME_RE.test(name) ? MEDIA_URL_PREFIX + name : null;
}

function itemUnit(item) {
  const unit = item && typeof item.unit === "string" ? item.unit.trim().slice(0, UNIT_MAX_LEN) : "";
  return unit || DEFAULT_UNIT;
}

// Определяет формат картинки по первым байтам (а не по тому, что прислал
// браузер): принимаем только JPEG/PNG/WebP. SVG и прочее — нет.
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function referencedMedia(config) {
  const names = new Set();
  const add = (url) => {
    const clean = cleanMediaUrl(url);
    if (clean) names.add(clean.slice(MEDIA_URL_PREFIX.length));
  };
  Object.values(config).forEach((form) => {
    add(form.coverUrl);
    add(form.logoUrl);
    (form.items || []).forEach((item) => item && typeof item === "object" && add(item.photoUrl));
  });
  return names;
}

// Удаляет картинки, на которые больше не ссылается ни одна форма. Только
// старше суток — чтобы не снести файл, который только что загрузили в
// админке, но ещё не нажали «Сохранить».
function collectUnusedMedia(config) {
  try {
    if (!fs.existsSync(MEDIA_DIR)) return;
    const used = referencedMedia(config);
    const now = Date.now();
    fs.readdirSync(MEDIA_DIR).forEach((name) => {
      if (!MEDIA_NAME_RE.test(name) || used.has(name)) return;
      const file = path.join(MEDIA_DIR, name);
      if (now - fs.statSync(file).mtimeMs > MEDIA_GC_AGE_MS) fs.unlinkSync(file);
    });
  } catch (err) {
    console.error("[oko-order] уборка картинок (не критично):", err.message);
  }
}

// Печать тикета заказа на кухонный принтер — переиспользует уже
// существующую очередь печати (oko-shelf-life-print) и агента на моноблоке,
// ничего нового не заводим. createRawPrintJob ничего не знает про заказы,
// просто кладёт в очередь произвольные строки текста — то же самое, чем уже
// пользуется печать чек-листа смены (см. oko-checklist-print/README.md и
// print-agent/README.md в этом репозитории). Require — ЛЕНИВЫЙ (внутри
// функции, не в начале файла): путь до oko-shelf-life-store.js на сервере
// нужно проверить/поправить при деплое (см. заметку в README этого модуля) —
// если сделать require наверху файла и путь окажется неверным, это уронит
// вообще весь приём заказов при старте процесса, а не только печать.
function buildOrderPrintLines(order, venueConfig) {
  const lines = ["KitchenDesk", "------------------------------", `Заказ — ${venueConfig.label}`, order.date || "", "------------------------------"];
  (order.items || []).forEach((item) => {
    lines.push(`${item.name} — ${item.qty} ${item.unit || DEFAULT_UNIT}`);
  });
  if (order.comment) {
    lines.push("------------------------------", "Комментарий:", order.comment);
  }
  if (order.name) {
    lines.push("------------------------------", `Отправил: ${order.name}`);
  }
  lines.push("------------------------------");
  return lines;
}

// "Облако" и "Мясо" (order.venue, ключи ИЗ ЭТОГО КОНФИГА — см.
// data/oko-order-config.json) — это формы ВНЕШНИХ КЛИЕНТОВ ОКО (ОКО для них
// кухня-поставщик), НЕ заведения KitchenDesk: в таблице restaurants их нет и
// не будет. Каждая форма принадлежит заведению-кухне (form.restaurantId) —
// на его принтере печатается тикет. Сейчас все формы принадлежат ОКО: "1" —
// настоящий id ОКО Гастробар в таблице restaurants (см. print-agent/README.md,
// п.14). Поле у формы не заполнено (формы до Этапа 1) → считается ОКО.
const DEFAULT_RESTAURANT_ID = "1";

function formRestaurantId(form) {
  return String((form && form.restaurantId) || DEFAULT_RESTAURANT_ID);
}

function printOrderTicket(order, venueConfig) {
  try {
    // Путь проверен при деплое 2026-09-20: oko-shelf-life-store.js лежит в
    // том же каталоге, что и oko-order-api.js (/root/kitchendesk/backend/src/).
    const { createRawPrintJob } = require("./oko-shelf-life-store");
    createRawPrintJob({
      printLines: buildOrderPrintLines(order, venueConfig),
      itemName: `Заказ — ${venueConfig.label}`,
      by: order.name || "",
      restaurantId: formRestaurantId(venueConfig),
    });
  } catch (err) {
    // Не критично — сам заказ уже ушёл в Telegram, печать тикета
    // дополнительная, не блокирующая.
    console.error("[oko-order] не удалось поставить тикет на печать (не критично):", err.message);
  }
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

const CONFIG_PATH = path.join(__dirname, "data", "oko-order-config.json");

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// ── Доступ к форме внешнего клиента (вариант «А + Г», 2026-09-30) ────────
// Клиенты (Облако, Мясо, ...) не имеют учёток KitchenDesk, поэтому форма
// открывается по секретной ссылке `?f=<token>` вместо угадываемого
// `?venue=<slug>`. Старый адрес `?venue=` работает, пока у формы не
// выключен legacySlug (формы до Этапа 1 — поле не задано → работает; после
// «Выпустить новую ссылку» — false навсегда). Новые формы из админки сразу
// создаются только с токеном.
//
// Поля формы, которые задаёт ТОЛЬКО сервер (POST /admin/config их не
// перезаписывает — иначе открытая до перевыпуска вкладка админки вернула
// бы старый токен/включила старую ссылку обратно при сохранении).
const SERVER_FORM_FIELDS = ["token", "legacySlug", "restaurantId", "active", "pinned"];
const FORM_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function generateFormToken() {
  return crypto.randomBytes(18).toString("base64url"); // 24 символа
}

function isLegacySlugAllowed(form) {
  return form.legacySlug !== false;
}

function isFormActive(form) {
  return form.active !== false;
}

function formUrl(form) {
  if (!form.token) return null;
  return `${process.env.OKO_ORDER_FORM_URL}?f=${form.token}`;
}

function tokensEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Находит форму по ?f=<token> (приоритет) или по старому ?venue=<slug>.
// Возвращает { key, form, via } или { status, body } для ответа с ошибкой.
function resolveForm(config, { f, venue }) {
  if (f) {
    if (typeof f === "string" && FORM_TOKEN_RE.test(f)) {
      const key = Object.keys(config).find((k) => config[k].token && tokensEqual(config[k].token, f));
      if (key) return { key, form: config[key], via: "token" };
    }
    return { status: 404, body: { error: "Ссылка на форму заказа недействительна. Нажмите кнопку «Заполнить заказ» в вашей теме Telegram ещё раз." } };
  }
  if (venue && typeof venue === "string" && Object.prototype.hasOwnProperty.call(config, venue)) {
    const form = config[venue];
    if (isLegacySlugAllowed(form)) return { key: venue, form, via: "legacy" };
    return {
      status: 410,
      body: { error: "Эта ссылка устарела. Нажмите новую закреплённую кнопку «Заполнить заказ» в вашей теме Telegram.", expired: true },
    };
  }
  return { status: 404, body: { error: "Неизвестная форма заказа" } };
}

const MAX_ORDER_LINES = 100;
const MAX_QTY = 999;
const MAX_COMMENT_LEN = 1000;
const MAX_NAME_LEN = 80;
const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Серверная проверка заказа (вариант «Г»): только позиции из каталога этой
// формы, разумное количество, длины полей. Возвращает { order } с очищенными
// данными (имена позиций — ровно как в каталоге) или { error }.
function validateOrder(body, form) {
  const catalog = new Map((form.items || []).map((raw) => {
    const item = normalizeItem(raw);
    return [item.name, item];
  }));
  if (!Array.isArray(body.items) || !body.items.length) {
    return { error: "Добавьте хотя бы одну позицию" };
  }
  if (body.items.length > MAX_ORDER_LINES) {
    return { error: "Слишком много позиций в одном заказе" };
  }
  const seen = new Set();
  const items = [];
  for (const line of body.items) {
    const name = line && typeof line.name === "string" ? line.name.trim() : "";
    if (!name || !catalog.has(name)) {
      return { error: `Позиции «${name.slice(0, 60)}» нет в меню этой формы. Обновите страницу и соберите заказ заново.` };
    }
    if (seen.has(name)) {
      return { error: `Позиция «${name}» указана дважды` };
    }
    seen.add(name);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      return { error: `Некорректное количество у «${name}» (от 1 до ${MAX_QTY})` };
    }
    items.push({ name, qty: Math.round(qty * 100) / 100, unit: catalog.get(name).unit });
  }
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!DATE_RE.test(date)) {
    return { error: "Укажите дату заказа" };
  }
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > MAX_COMMENT_LEN) {
    return { error: `Комментарий слишком длинный (до ${MAX_COMMENT_LEN} символов)` };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length > MAX_NAME_LEN) {
    return { error: `Имя слишком длинное (до ${MAX_NAME_LEN} символов)` };
  }
  let clientOrderId = null;
  if (body.clientOrderId !== undefined && body.clientOrderId !== null && body.clientOrderId !== "") {
    if (typeof body.clientOrderId !== "string" || !CLIENT_ORDER_ID_RE.test(body.clientOrderId)) {
      return { error: "Некорректный идентификатор заказа, обновите страницу" };
    }
    clientOrderId = body.clientOrderId;
  }
  return { order: { items, date, comment, name, clientOrderId } };
}

// Лимит отправок с одного IP на одну форму: 20 заказов за 10 минут — с
// большим запасом для живой работы (обычно 1–3 заказа в день), но режет
// спам/скрипты. Отдельный лимит на неудачные поиски формы (перебор
// токенов/адресов) — успешные запросы его не расходуют.
const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String((req.body && (req.body.f || req.body.venue)) || "").slice(0, 64)}`,
  message: { error: "Слишком много заказов подряд, попробуйте через несколько минут" },
});
const formLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Считаем только «форма не найдена / ссылка устарела» — ошибки в самом
  // заказе (400) и закрытая форма (403) сюда не относятся.
  requestWasSuccessful: (req, res) => res.statusCode !== 404 && res.statusCode !== 410,
  message: { error: "Слишком много неверных ссылок, попробуйте позже" },
});

// Защита от двойной отправки: одинаковый clientOrderId (его генерирует
// страница формы один раз на заказ) в пределах суток — второй запрос не
// создаёт второй заказ. Пока первый ещё отправляется в Telegram, повторный
// ждёт его результата (inFlight), после — находится в сохранённых заказах.
const inFlightSubmits = new Map();

function relayFailure(err) {
  console.error("[oko-order] ошибка при отправке заказа:", err && err.message);
  return { status: 500, body: { error: "Не удалось отправить заказ, попробуйте ещё раз" } };
}
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

// 5 неудачных попыток за 15 минут с одного IP — дальше 429, пока окно не
// истечёт. Считается только неверный пароль (401): ошибки самой работы в
// админке (не тот файл картинки, дубль позиции при сохранении) лимит не
// расходуют — иначе после пяти таких ошибок админка блокировалась бы на
// 15 минут (найдено на тестах Этапа 2).
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: { error: "Слишком много попыток входа, попробуйте позже" },
});

function requireAdmin(req, res, next) {
  const password = req.header("X-Admin-Password") || "";
  const expected = process.env.OKO_ADMIN_PASSWORD || "";
  const passwordBuf = Buffer.from(password);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual требует буферы одной длины — иначе исключение. Разная
  // длина сама по себе означает «неверный пароль», без 500-й ошибки.
  const isValid =
    expected.length > 0 &&
    passwordBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(passwordBuf, expectedBuf);
  if (!isValid) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  next();
}

// Menu items can be a plain string (legacy, no category) or an
// { name, category } object — normalized here so the order form always gets
// a consistent shape regardless of which one is stored in the config.
function normalizeItem(item) {
  if (typeof item === "string") return { name: item, category: null, unit: DEFAULT_UNIT, photoUrl: null };
  return { name: item.name, category: item.category || null, unit: itemUnit(item), photoUrl: cleanMediaUrl(item.photoUrl) };
}

// Позиция из админки → то, что хранится в конфиге. Имя обязательно, всё
// остальное необязательное; единица «шт.» не записывается (это значение по
// умолчанию), ссылки на фото — только на наши /media/.
function sanitizeItem(raw) {
  const item = typeof raw === "string" ? { name: raw } : raw && typeof raw === "object" ? raw : {};
  const name = typeof item.name === "string" ? item.name.trim().slice(0, ITEM_NAME_MAX_LEN) : "";
  if (!name) return null;
  const out = { name };
  const category = typeof item.category === "string" ? item.category.trim().slice(0, CATEGORY_MAX_LEN) : "";
  if (category) out.category = category;
  const unit = itemUnit(item);
  if (unit !== DEFAULT_UNIT) out.unit = unit;
  const photoUrl = cleanMediaUrl(item.photoUrl);
  if (photoUrl) out.photoUrl = photoUrl;
  return out;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Telegram HTML parse_mode: venue name and the date are shown in a fixed-width
// <code> span, comment gets its own <code> block. Every value that can come
// from user input (comment, submitter name, item name) is HTML-escaped —
// otherwise someone typing "<b>" into the form could break the message
// formatting or inject tags.
function buildOrderMessage(order, venueConfig) {
  const itemsText = (order.items || [])
    .map((item) => `• ${escapeHtml(item.name)} — ${escapeHtml(item.qty)} ${escapeHtml(item.unit || DEFAULT_UNIT)}`)
    .join("\n");

  const lines = [
    `<b>Новый заказ — <code>${escapeHtml(venueConfig.label)}</code></b>`,
    "",
    `📅 Дата: <code>${escapeHtml(order.date)}</code>`,
    "",
    "Позиции:",
    itemsText,
  ];

  if (order.comment) {
    lines.push("", "", `💬 Комментарий:`, `<code>${escapeHtml(order.comment)}</code>`);
  }

  if (order.name) {
    lines.push("", `Отправил: ${escapeHtml(order.name)}`);
  }

  return lines.join("\n");
}

// Which categories does this particular order actually touch? Cross-references
// the ordered item names against the venue's menu (where categories live) —
// the order payload itself only carries {name, qty}, not category.
function getOrderCategories(order, venueConfig) {
  const categoryByName = {};
  (venueConfig.items || []).forEach((raw) => {
    const item = normalizeItem(raw);
    categoryByName[item.name] = item.category;
  });
  const categories = new Set();
  (order.items || []).forEach((orderItem) => {
    const category = categoryByName[orderItem.name];
    if (category) categories.add(category);
  });
  return categories;
}

// @username mentions work as plain text; people without a public username
// are tagged via a tg://user text-mention link instead, which needs their
// numeric id (captured earlier by recordPerson()).
function formatMention(cook) {
  return cook.username
    ? `@${cook.username}`
    : `<a href="tg://user?id=${cook.userId}">${escapeHtml(cook.label || "Повар")}</a>`;
}

// "Поварам: ..." line for the kitchen copy only — only cooks whose category
// actually appears in this order (plus cooks with no category, who are
// tagged on every order). Returns null when nobody qualifies, so callers can
// skip the line entirely instead of appending "Поварам: " with nothing after it.
function buildCookMentionsLine(order, venueConfig) {
  if (!venueConfig.cookMentions || !venueConfig.cookMentions.length) return null;
  const presentCategories = getOrderCategories(order, venueConfig);
  const relevant = venueConfig.cookMentions.filter((m) => !m.category || presentCategories.has(m.category));
  if (!relevant.length) return null;
  return `Поварам: ${relevant.map(formatMention).join(" ")}`;
}

// Groups this order's category-specific cook mentions by category, only for
// categories actually present in the order — each group becomes its own
// "✅ <категория>" accept button, tappable only by its assigned cook(s).
// Cooks with no category (tagged on every order) don't get their own button
// — they're a notification-only "Поварам:" mention, not a per-category gate.
function getCategoryCookGroups(order, venueConfig) {
  if (!venueConfig.cookMentions || !venueConfig.cookMentions.length) return [];
  const presentCategories = getOrderCategories(order, venueConfig);
  const categoryOrder = [];
  const byCategory = {};
  venueConfig.cookMentions.forEach((m) => {
    if (!m.category || !presentCategories.has(m.category)) return;
    if (!byCategory[m.category]) {
      byCategory[m.category] = [];
      categoryOrder.push(m.category);
    }
    byCategory[m.category].push(m);
  });
  return categoryOrder.map((category) => ({ category, cooks: byCategory[category] }));
}

function mentionMatchesUser(cook, from) {
  if (cook.userId && String(cook.userId) === String(from.id)) return true;
  if (cook.username && from.username && cook.username.toLowerCase() === from.username.toLowerCase()) return true;
  return false;
}

/**
 * @param {import('node-telegram-bot-api')} bot existing bot instance, used to
 *   (re)send and pin the "Заполнить заказ" button, and to relay submitted
 *   orders into the kitchen group.
 */
function createOkoOrderRouter(bot) {
  const router = express.Router();

  // Public — the order form reads the current item list for a form
  // (?f=<secret token>, or legacy ?venue=<slug> while still allowed).
  router.get("/items", formLookupLimiter, (req, res) => {
    const config = readConfig();
    const found = resolveForm(config, { f: req.query.f, venue: req.query.venue });
    if (!found.form) return res.status(found.status).json(found.body);
    if (!isFormActive(found.form)) {
      return res.status(403).json({ error: "Приём заказов через эту форму сейчас закрыт", closed: true, label: found.form.label });
    }
    res.json({
      label: found.form.label,
      coverUrl: cleanMediaUrl(found.form.coverUrl),
      logoUrl: cleanMediaUrl(found.form.logoUrl),
      items: (found.form.items || []).map(normalizeItem),
    });
  });

  // Публичная раздача картинок форм (фон, логотип, фото позиций). Имена
  // случайные и файл после загрузки не меняется — можно кешировать надолго.
  router.get("/media/:name", (req, res) => {
    const name = req.params.name;
    if (!MEDIA_NAME_RE.test(name)) return res.status(404).end();
    const file = path.join(MEDIA_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    res.sendFile(file);
  });

  // Public — the order form submits here directly. Telegram only allows
  // web_app buttons (and their sendData() bridge) in private chats, not in
  // groups, so a group-posted button can't rely on that path — the form
  // instead POSTs straight to the backend, which relays into the kitchen
  // group itself.
  router.post("/submit", formLookupLimiter, submitLimiter, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const config = readConfig();
    const found = resolveForm(config, { f: body.f, venue: body.venue });
    if (!found.form) return res.status(found.status).json(found.body);
    const { key: venueKey, form: venueConfig } = found;
    if (!isFormActive(venueConfig)) {
      return res.status(403).json({ error: "Приём заказов через эту форму сейчас закрыт", closed: true });
    }
    const checked = validateOrder(body, venueConfig);
    if (checked.error) return res.status(400).json({ error: checked.error });
    if (!venueConfig.kitchenGroupChatId) {
      return res.status(400).json({ error: "Для этой формы не настроена поварская группа" });
    }
    const order = { venue: venueKey, ...checked.order };
    const meta = {
      ip: req.ip || null,
      userAgent: String(req.get("user-agent") || "").slice(0, 200),
      via: found.via,
    };

    if (!order.clientOrderId) {
      const result = await relayOrder(order, venueConfig, meta).catch(relayFailure);
      return res.status(result.status).json(result.body);
    }
    const dupKey = `${venueKey}:${order.clientOrderId}`;
    if (inFlightSubmits.has(dupKey)) {
      const result = await inFlightSubmits.get(dupKey);
      return res.status(result.status).json(result.status === 200 ? { ok: true, duplicate: true } : result.body);
    }
    if (findOrderByClientId(venueKey, order.clientOrderId, Date.now() - DUPLICATE_WINDOW_MS)) {
      return res.json({ ok: true, duplicate: true });
    }
    const pending = relayOrder(order, venueConfig, meta).catch(relayFailure);
    inFlightSubmits.set(dupKey, pending);
    try {
      const result = await pending;
      return res.status(result.status).json(result.body);
    } finally {
      inFlightSubmits.delete(dupKey);
    }
  });

  // Отправка уже проверенного заказа: кухня (+кнопки «Принято»), тикет на
  // принтер, подтверждение в тему-источник, запись в oko-orders.json.
  // Логика та же, что была внутри /submit до Этапа 1 — вынесена, чтобы её
  // можно было обернуть защитой от двойной отправки.
  async function relayOrder(order, venueConfig, meta) {
      // coreMessage is what the source group sees (in the "Заказ отправлен"
      // confirmation) — cook mentions are deliberately NOT part of it, they're
      // only relevant to whoever is in the kitchen group.
      const coreMessage = buildOrderMessage(order, venueConfig);
      const mentionsLine = buildCookMentionsLine(order, venueConfig);
      const kitchenMessage = coreMessage + (mentionsLine ? `\n\n${mentionsLine}` : "");
      const categoryGroups = getCategoryCookGroups(order, venueConfig);
      const orderId = createOrderId();

      // Two modes: if any category in this order has an assigned cook, each
      // gets its own accept button (gated to that cook). Otherwise fall back
      // to a single "✅ Принято" button anyone in the kitchen group can press —
      // same behaviour as before category-based tagging existed.
      let inlineKeyboard;
      let categoriesRecord = null;
      if (categoryGroups.length) {
        inlineKeyboard = categoryGroups.map((g, i) => [
          { text: `✅ ${g.category}`, callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}:${i}` },
        ]);
        categoriesRecord = categoryGroups.map((g) => ({
          name: g.category,
          cooks: g.cooks.map((c) => ({ label: c.label, username: c.username || null, userId: c.userId || null })),
          accepted: null,
        }));
      } else {
        inlineKeyboard = [[{ text: "✅ Принято", callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}` }]];
      }

      let kitchenSent;
      try {
        const kitchenOptions = { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } };
        if (venueConfig.kitchenThreadId) {
          kitchenOptions.message_thread_id = Number(venueConfig.kitchenThreadId);
        }
        kitchenSent = await bot.sendMessage(venueConfig.kitchenGroupChatId, kitchenMessage, kitchenOptions);
      } catch (err) {
        return { status: 500, body: { error: err.message } };
      }

      // Печатаем бумажный тикет заказа сразу же, тем же временем, что и
      // Telegram-сообщение — best-effort, ошибка печати не должна ронять
      // приём заказа (сообщение в группу уже ушло, это важнее).
      printOrderTicket(order, venueConfig);

      // Best-effort confirmation back in the topic the order was placed from —
      // a failure here shouldn't fail the request, the order already reached
      // the kitchen group.
      let sourceSent = null;
      if (venueConfig.sourceGroupChatId) {
        try {
          const sourceOptions = { parse_mode: "HTML" };
          if (venueConfig.sourceThreadId) {
            sourceOptions.message_thread_id = Number(venueConfig.sourceThreadId);
          }
          sourceSent = await bot.sendMessage(
            venueConfig.sourceGroupChatId,
            `Заказ отправлен\n\n<blockquote>${coreMessage}</blockquote>`,
            sourceOptions,
          );
        } catch {
          // ignore — the order itself already went through
        }
      }

      // Persisted so the "✅ Принято" button(s) (pressed later, from the
      // kitchen group) know which two messages to update, and — in category
      // mode — who's actually allowed to press which button.
      saveOrder(orderId, {
        venue: order.venue,
        restaurantId: formRestaurantId(venueConfig),
        clientOrderId: order.clientOrderId || null,
        // Для разбора спорных случаев (вариант «Г»): откуда пришёл заказ.
        meta: meta,
        venueLabel: venueConfig.label,
        coreMessage,
        kitchenChatId: venueConfig.kitchenGroupChatId,
        kitchenMessageId: kitchenSent.message_id,
        sourceChatId: venueConfig.sourceGroupChatId || null,
        sourceMessageId: sourceSent ? sourceSent.message_id : null,
        categories: categoriesRecord,
        accepted: null,
        finalNotified: false,
        // Захватываем на момент заказа, а не читаем venueConfig заново при
        // нажатии — тот же принцип, что и у cookMentions → categoriesRecord
        // (кто был назначен при отправке заказа, тот и остаётся назначенным,
        // даже если конфиг заведения потом поменяют).
        deliveryPerson: venueConfig.deliveryPerson || null,
        delivered: null,
        createdAt: Date.now(),
      });

    return { status: 200, body: { ok: true } };
  }

  // Admin — full config (routing IDs + items) for every configured venue.
  router.get("/admin/config", adminLoginLimiter, requireAdmin, (req, res) => {
    // formUrl / legacySlugAllowed — вычисляемые, только для показа в админке
    // (обратно при сохранении сервер их игнорирует, см. SERVER_FORM_FIELDS).
    const config = readConfig();
    const view = {};
    for (const [key, form] of Object.entries(config)) {
      view[key] = { ...form, formUrl: formUrl(form), legacySlugAllowed: isLegacySlugAllowed(form), active: isFormActive(form) };
    }
    res.json(view);
  });

  // Admin — groups/topics the bot has seen activity in (for the dropdown
  // pickers). Telegram has no "list my chats" API, so this is only ever as
  // complete as whatever activity has happened since discovery was deployed.
  router.get("/admin/known-chats", adminLoginLimiter, requireAdmin, (req, res) => {
    res.json(readKnownChats());
  });

  // Admin — manually label a topic Telegram never gave us a name for
  // (it only reports a topic's name at creation time).
  router.post("/admin/known-chats/rename-topic", adminLoginLimiter, requireAdmin, (req, res) => {
    const { chatId, threadId, name } = req.body || {};
    if (!chatId || !threadId || !name) {
      return res.status(400).json({ error: "Нужны chatId, threadId и name" });
    }
    renameTopic(chatId, threadId, name);
    res.json({ ok: true });
  });

  // Admin — send a visible test message into a specific chat/topic so the
  // admin can look in Telegram and see exactly which real topic a numeric
  // thread_id belongs to, instead of guessing from a bare number.
  router.post("/admin/test-ping", adminLoginLimiter, requireAdmin, async (req, res) => {
    const { chatId, threadId } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ error: "Нужен chatId" });
    }
    try {
      const options = {};
      if (threadId) options.message_thread_id = Number(threadId);
      const label = threadId ? `теме с ID ${threadId}` : "этой группе (без темы)";
      await bot.sendMessage(chatId, `🔎 Тест-пинг из админки OKO — если видите это сообщение здесь, значит вы смотрите на ${label}.`, options);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Venue keys are plain object keys (also used as the "?venue=" URL slug
  // and as a config filename-adjacent identifier) — restricted to
  // lowercase latin/digits/underscore so they stay URL-safe and match the
  // slug the admin frontend generates (transliterated from whatever name
  // the admin typed).
  const VENUE_KEY_RE = /^[a-z0-9_]+$/;

  router.post("/admin/config", adminLoginLimiter, requireAdmin, (req, res) => {
    const next = req.body;
    if (!next || typeof next !== "object" || Array.isArray(next) || !Object.keys(next).length) {
      return res.status(400).json({ error: "Некорректный формат конфига" });
    }
    for (const [venueKey, venueConfig] of Object.entries(next)) {
      if (!VENUE_KEY_RE.test(venueKey)) {
        return res.status(400).json({ error: `Недопустимый идентификатор заведения: "${venueKey}"` });
      }
      if (!venueConfig || typeof venueConfig.label !== "string" || !venueConfig.label.trim()) {
        return res.status(400).json({ error: `У заведения "${venueKey}" не указано название` });
      }
      if (!Array.isArray(venueConfig.items)) {
        return res.status(400).json({ error: `У заведения "${venueKey}" некорректный список позиций` });
      }
      const seenNames = new Set();
      for (const raw of venueConfig.items) {
        const item = sanitizeItem(raw);
        if (!item) return res.status(400).json({ error: `У заведения "${venueConfig.label}" есть позиция без названия` });
        if (seenNames.has(item.name)) {
          return res.status(400).json({ error: `У заведения "${venueConfig.label}" позиция «${item.name}» указана дважды` });
        }
        seenNames.add(item.name);
      }
    }
    // Серверные поля (токен, старая ссылка, заведение, «Активна», id
    // закреплённой кнопки) берутся с диска, а не из присланного — новая
    // форма сразу получает секретную ссылку и без старого ?venue= адреса.
    const current = readConfig();
    const merged = {};
    for (const [venueKey, venueConfig] of Object.entries(next)) {
      const form = { ...venueConfig, items: venueConfig.items.map(sanitizeItem) };
      ["coverUrl", "logoUrl"].forEach((field) => {
        const clean = cleanMediaUrl(form[field]);
        if (clean) form[field] = clean;
        else delete form[field];
      });
      delete form.formUrl;
      delete form.legacySlugAllowed;
      SERVER_FORM_FIELDS.forEach((field) => delete form[field]);
      const existing = current[venueKey];
      if (existing) {
        SERVER_FORM_FIELDS.forEach((field) => {
          if (existing[field] !== undefined) form[field] = existing[field];
        });
      } else {
        form.token = generateFormToken();
        form.legacySlug = false;
        form.restaurantId = DEFAULT_RESTAURANT_ID;
      }
      merged[venueKey] = form;
    }
    writeConfig(merged);
    collectUnusedMedia(merged);
    res.json({ ok: true });
  });

  // Admin — загрузка картинки для формы: фон (cover), логотип (logo) или фото
  // позиции (item). Браузер присылает data:-URL (JSON, лимит express.json
  // 10 МБ); сервер проверяет формат по байтам, поворачивает по EXIF, уменьшает
  // и пережимает в webp — заодно вырезаются все метаданные (геометки
  // телефона и т. п.). В конфиг ссылка попадает только после «Сохранить».
  router.post("/admin/media", adminLoginLimiter, requireAdmin, async (req, res) => {
    const { data, kind } = req.body || {};
    const maxSide = MEDIA_KINDS[kind];
    if (!maxSide) return res.status(400).json({ error: "Неизвестный тип картинки" });
    const match = typeof data === "string" ? /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(data) : null;
    if (!match) return res.status(400).json({ error: "Пришлите картинку JPG, PNG или WebP" });
    const buf = Buffer.from(match[1], "base64");
    if (buf.length > MEDIA_MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Картинка слишком большая (до 8 МБ)" });
    if (!sniffImage(buf)) return res.status(400).json({ error: "Поддерживаются только JPG, PNG и WebP" });
    try {
      const sharp = require("sharp");
      const out = await sharp(buf, { limitInputPixels: 40e6 })
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .webp({ quality: kind === "logo" ? 90 : 80 })
        .toBuffer();
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const name = `${crypto.randomBytes(12).toString("hex")}.webp`;
      fs.writeFileSync(path.join(MEDIA_DIR, name), out);
      res.json({ ok: true, url: MEDIA_URL_PREFIX + name });
    } catch (err) {
      console.error("[oko-order] не удалось обработать картинку:", err.message);
      res.status(400).json({ error: "Не удалось прочитать картинку — попробуйте другой файл" });
    }
  });

  // Admin — after wiring up a venue's source/kitchen IDs, post a visible
  // confirmation into each so there's no doubt setup actually took.
  router.post("/admin/confirm-connection", adminLoginLimiter, requireAdmin, async (req, res) => {
    const { venue } = req.body || {};
    const config = readConfig();
    const venueConfig = config[venue];
    if (!venueConfig) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }

    const notified = [];
    try {
      if (venueConfig.sourceGroupChatId) {
        const opts = {};
        if (venueConfig.sourceThreadId) opts.message_thread_id = Number(venueConfig.sourceThreadId);
        await bot.sendMessage(
          venueConfig.sourceGroupChatId,
          `✅ Эта тема подключена в системе OKO как источник заказов для «${venueConfig.label}».`,
          opts,
        );
        notified.push("source");
      }
      if (venueConfig.kitchenGroupChatId) {
        const opts = {};
        if (venueConfig.kitchenThreadId) opts.message_thread_id = Number(venueConfig.kitchenThreadId);
        await bot.sendMessage(
          venueConfig.kitchenGroupChatId,
          `✅ Эта группа/тема подключена в системе OKO — сюда будут приходить заказы для «${venueConfig.label}».`,
          opts,
        );
        notified.push("kitchen");
      }
      if (!notified.length) {
        return res.status(400).json({ error: "Не заполнены ни исходная, ни поварская группа" });
      }
      res.json({ ok: true, notified });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin — включить/выключить приём заказов через форму (вариант «Г»).
  // Выключенная форма показывает клиенту «приём закрыт», /submit отвечает 403.
  router.post("/admin/set-active", adminLoginLimiter, requireAdmin, (req, res) => {
    const { venue, active } = req.body || {};
    const config = readConfig();
    if (!venue || !Object.prototype.hasOwnProperty.call(config, venue)) {
      return res.status(404).json({ error: "Неизвестная форма" });
    }
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "Нужно active: true/false" });
    }
    config[venue].active = active;
    writeConfig(config);
    res.json({ ok: true, active });
  });

  // Admin — (re)send and pin the order-form button in a venue's source topic.
  // Must be a plain `url` button, not `web_app` — Telegram rejects web_app
  // buttons outside private chats (BUTTON_TYPE_INVALID). Кнопка всегда ведёт
  // на секретную ссылку ?f=<token> (токен выпускается, если его ещё нет;
  // старый ?venue= адрес при этом НЕ выключается — это делает rotate-link).
  router.post("/admin/pin-button", adminLoginLimiter, requireAdmin, async (req, res) => {
    const { venue } = req.body || {};
    const config = readConfig();
    if (!venue || !Object.prototype.hasOwnProperty.call(config, venue)) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }
    if (!config[venue].sourceGroupChatId) {
      return res.status(400).json({ error: "Не указан ID исходной группы для этого заведения" });
    }
    if (!config[venue].token) {
      config[venue].token = generateFormToken();
      writeConfig(config);
    }
    try {
      const pinned = await sendAndPinFormButton(config[venue]);
      const fresh = readConfig();
      if (fresh[venue]) {
        fresh[venue].pinned = pinned;
        writeConfig(fresh);
      }
      res.json({ ok: true, messageId: pinned.messageId, formUrl: formUrl(config[venue]) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin — «Выпустить новую ссылку»: новый секретный токен, старый токен и
  // старый ?venue= адрес перестают работать сразу. Кнопка в теме клиента
  // обновляется сама: если бот знает свою закреплённую кнопку (pinned) — у
  // неё просто меняется адрес (то же сообщение, клиенты ничего не
  // замечают); если не знает или правка не удалась — отправляет и
  // закрепляет новую кнопку. Именно этим эндпоинтом делается переключение
  // Облака/Мяса со старых адресов на секретные.
  router.post("/admin/rotate-link", adminLoginLimiter, requireAdmin, async (req, res) => {
    const { venue } = req.body || {};
    const config = readConfig();
    if (!venue || !Object.prototype.hasOwnProperty.call(config, venue)) {
      return res.status(404).json({ error: "Неизвестная форма" });
    }
    const form = config[venue];
    // Сначала новый токен (новая кнопка должна открываться сразу), а старый
    // ?venue= адрес выключаем только ПОСЛЕ того, как кнопка в теме успешно
    // обновлена — если Telegram откажет, клиенты не останутся без рабочей
    // кнопки (старая закреплённая по-прежнему работает).
    form.token = generateFormToken();
    writeConfig(config);

    if (!form.sourceGroupChatId) {
      disableLegacySlug(venue);
      return res.json({ ok: true, formUrl: formUrl(form), button: "none", note: "Тема-источник не задана — кнопку закреплять некуда, ссылку можно передать клиенту вручную" });
    }

    let button = null;
    let pinned = form.pinned || null;
    if (pinned && String(pinned.chatId) === String(form.sourceGroupChatId) && String(pinned.threadId || "") === String(form.sourceThreadId || "")) {
      try {
        await bot.editMessageReplyMarkup(formButtonMarkup(form), { chat_id: pinned.chatId, message_id: pinned.messageId });
        button = "edited";
      } catch (err) {
        console.error("[oko-order] не удалось обновить закреплённую кнопку, отправляю новую:", err.message);
      }
    }
    if (!button) {
      try {
        pinned = await sendAndPinFormButton(form);
        button = "repinned";
      } catch (err) {
        return res.status(500).json({ error: `Кнопку в теме обновить не удалось: ${err.message}. Старая кнопка пока продолжает работать — попробуйте ещё раз.`, formUrl: formUrl(form) });
      }
    }
    const fresh = readConfig();
    if (fresh[venue]) {
      fresh[venue].pinned = pinned;
      fresh[venue].legacySlug = false;
      writeConfig(fresh);
    }
    res.json({ ok: true, formUrl: formUrl(form), button, messageId: pinned.messageId });
  });

  function disableLegacySlug(venue) {
    const fresh = readConfig();
    if (fresh[venue]) {
      fresh[venue].legacySlug = false;
      writeConfig(fresh);
    }
  }

  function formButtonMarkup(form) {
    return { inline_keyboard: [[{ text: "📝 Заполнить заказ", url: formUrl(form) }]] };
  }

  async function sendAndPinFormButton(form) {
    const sendOptions = { reply_markup: formButtonMarkup(form) };
    if (form.sourceThreadId) {
      sendOptions.message_thread_id = Number(form.sourceThreadId);
    }
    const sent = await bot.sendMessage(form.sourceGroupChatId, "Заполните заказ на нужную дату 👇", sendOptions);
    await bot.pinChatMessage(form.sourceGroupChatId, sent.message_id);
    return {
      chatId: String(form.sourceGroupChatId),
      threadId: form.sourceThreadId ? String(form.sourceThreadId) : null,
      messageId: sent.message_id,
    };
  }

  return router;
}

/**
 * Handles taps on the "✅ Принято" button(s) attached to each order message
 * in the kitchen group. Two modes, depending on how the order was saved:
 *
 * - Generic (no category-specific cooks configured): one button, anyone in
 *   the kitchen group can tap it — same as before category tagging existed.
 * - Category mode: one button per category present in the order that has an
 *   assigned cook. Only that cook (matched by Telegram id or username) can
 *   accept it — anyone else gets a private "not for you" alert and nothing
 *   changes. Once every category button in the order has been accepted, a
 *   single final confirmation (with a per-category breakdown) is sent to the
 *   source group — not one message per category, per explicit request.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
function registerOrderAcceptHandler(bot) {
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith(ACCEPT_CALLBACK_PREFIX)) return;

    const rest = data.slice(ACCEPT_CALLBACK_PREFIX.length);
    const [orderId, catIndexStr] = rest.split(":");
    const order = getOrder(orderId);
    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Заказ не найден (возможно, устарел)", show_alert: true }).catch(() => {});
    }

    if (catIndexStr === undefined) {
      await handleGenericAccept(bot, orderId, order, query);
      return;
    }
    await handleCategoryAccept(bot, orderId, order, Number(catIndexStr), query);
  });
}

async function handleGenericAccept(bot, orderId, order, query) {
  // Вторая стадия — та же самая кнопка, второе нажатие, но только от того,
  // кто назначен отправлять доставку (venueConfig.deliveryPerson на момент
  // заказа, см. форму в oko-order/admin). Не новая кнопка — callback_data
  // тот же, просто состояние заказа уже другое к этому моменту.
  if (order.accepted && !order.delivered) {
    if (!order.deliveryPerson || !mentionMatchesUser(order.deliveryPerson, query.from)) {
      const note = `Уже принято: ${order.accepted.name}, ${formatTime(order.accepted.at)}`;
      return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
    }

    const deliveredByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
    const deliveredAt = Date.now();
    const updated = markDelivery(orderId, { name: deliveredByName, at: deliveredAt });
    const noteTime = formatTime(deliveredAt);

    try {
      await bot.editMessageText(
        `${order.coreMessage}\n\n✅ <b>Принято:</b> ${escapeHtml(order.accepted.name)}, ${formatTime(order.accepted.at)}\n🚚 <b>В доставке:</b> ${escapeHtml(updated.delivered.name)}, ${noteTime}`,
        { chat_id: order.kitchenChatId, message_id: order.kitchenMessageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } },
      );
    } catch {
      // best effort — the delivered state is already persisted either way
    }

    if (order.sourceChatId && order.sourceMessageId) {
      try {
        await bot.editMessageText(
          `✅ Заказ принят кухней (${formatTime(order.accepted.at)})\n🚚 В процессе доставки (${noteTime})\n\n<blockquote>${order.coreMessage}</blockquote>`,
          { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
        );
      } catch {
        // best effort
      }
    }

    await bot.answerCallbackQuery(query.id, { text: "Отправлено в доставку!" }).catch(() => {});
    return;
  }

  if (order.delivered) {
    const note = `Уже отправлено в доставку: ${order.delivered.name}, ${formatTime(order.delivered.at)}`;
    return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
  }

  // Первое нажатие — обычная приёмка (как раньше).
  const acceptedByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
  const acceptedAt = Date.now();
  const updated = markAccepted(orderId, { name: acceptedByName, at: acceptedAt });
  const noteTime = formatTime(acceptedAt);

  try {
    await bot.editMessageText(
      `${order.coreMessage}\n\n✅ <b>Принято:</b> ${escapeHtml(updated.accepted.name)}, ${noteTime}`,
      {
        chat_id: order.kitchenChatId,
        message_id: order.kitchenMessageId,
        parse_mode: "HTML",
        // Кнопка не убирается, если для заведения назначен отправитель
        // доставки — та же кнопка, второе нажатие (от него) переводит заказ
        // в доставку, см. ветку выше. Без deliveryPerson — как раньше.
        reply_markup: { inline_keyboard: updated.deliveryPerson ? [[{ text: "✅ Принято", callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}` }]] : [] },
      },
    );
  } catch {
    // best effort — the accepted state is already persisted either way
  }

  if (order.sourceChatId && order.sourceMessageId) {
    try {
      await bot.editMessageText(
        `✅ Заказ принят кухней (${noteTime})\n\n<blockquote>${order.coreMessage}</blockquote>`,
        { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
      );
    } catch {
      // best effort
    }
  }

  await bot.answerCallbackQuery(query.id, { text: "Принято!" }).catch(() => {});
}

async function handleCategoryAccept(bot, orderId, order, catIndex, query) {
  const category = order.categories && order.categories[catIndex];
  if (!category) {
    return bot.answerCallbackQuery(query.id, { text: "Категория не найдена (возможно, устарела)", show_alert: true }).catch(() => {});
  }

  // Вторая стадия — та же самая кнопка категории, второе нажатие, но только
  // от назначенного отправителя доставки (не ещё раз от повара). Не новая
  // кнопка — callback_data тот же, состояние заказа уже другое.
  if (category.accepted && !category.delivered) {
    if (!order.deliveryPerson || !mentionMatchesUser(order.deliveryPerson, query.from)) {
      const note = `Уже принято: ${category.accepted.name}, ${formatTime(category.accepted.at)}`;
      return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
    }

    const deliveredByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
    const deliveredAt = Date.now();
    const updated = markCategoryDelivered(orderId, catIndex, { name: deliveredByName, at: deliveredAt });
    if (!updated) {
      return bot.answerCallbackQuery(query.id, { text: "Не удалось сохранить, попробуйте ещё раз", show_alert: true }).catch(() => {});
    }

    const inlineKeyboard = updated.categories.map((cat, i) => [
      {
        // Текст меняется, а не копится — доставка заменяет имя повара своим,
        // а не дописывается рядом (было "✅ Категория · Повар", стало
        // "🚚 Категория · Су-шеф", а не "✅ Категория · Повар → Су-шеф").
        text: cat.delivered
          ? `🚚 ${cat.name} · ${cat.delivered.name}`
          : cat.accepted ? `✅ ${cat.name} · ${cat.accepted.name}` : `✅ ${cat.name}`,
        callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}:${i}`,
      },
    ]);
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: inlineKeyboard },
        { chat_id: order.kitchenChatId, message_id: order.kitchenMessageId },
      );
    } catch {
      // best effort — delivered state is already persisted either way
    }

    const allDeliveredNow = updated.categories.every((cat) => cat.delivered);
    if (allDeliveredNow && !updated.deliveryFinalNotified && order.sourceChatId && order.sourceMessageId) {
      const breakdown = updated.categories
        .map((cat) =>
          `${escapeHtml(cat.name)} — принял ${escapeHtml(cat.accepted.name)} (${formatTime(cat.accepted.at)}), ` +
          `доставка: ${escapeHtml(cat.delivered.name)} (${formatTime(cat.delivered.at)})`)
        .join("\n");
      try {
        await bot.editMessageText(
          `🚚 Заказ в процессе доставки:\n${breakdown}\n\n<blockquote>${order.coreMessage}</blockquote>`,
          { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
        );
        markDeliveryFinalNotified(orderId);
      } catch {
        // best effort
      }
    }

    await bot.answerCallbackQuery(query.id, { text: "Отправлено в доставку!" }).catch(() => {});
    return;
  }

  if (category.delivered) {
    const note = `Уже отправлено в доставку: ${category.delivered.name}, ${formatTime(category.delivered.at)}`;
    return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
  }

  // Первое нажатие — обычная приёмка поваром (как раньше).
  const authorized = category.cooks.some((cook) => mentionMatchesUser(cook, query.from));
  if (!authorized) {
    return bot.answerCallbackQuery(query.id, { text: "Эта кнопка не для вас", show_alert: true }).catch(() => {});
  }

  const acceptedByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
  const acceptedAt = Date.now();
  const updated = markCategoryAccepted(orderId, catIndex, { name: acceptedByName, at: acceptedAt });
  if (!updated) {
    return bot.answerCallbackQuery(query.id, { text: "Не удалось сохранить, попробуйте ещё раз", show_alert: true }).catch(() => {});
  }

  // Rebuild the whole keyboard: accepted categories show who/when in the
  // button label, pending ones are untouched — so progress is visible
  // directly on the message without needing to open it.
  const inlineKeyboard = updated.categories.map((cat, i) => [
    {
      text: cat.accepted ? `✅ ${cat.name} · ${cat.accepted.name}` : `✅ ${cat.name}`,
      callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}:${i}`,
    },
  ]);
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: inlineKeyboard },
      { chat_id: order.kitchenChatId, message_id: order.kitchenMessageId },
    );
  } catch {
    // best effort — acceptance is already persisted either way
  }

  const allAcceptedNow = updated.categories.every((cat) => cat.accepted);
  if (allAcceptedNow && !updated.finalNotified && order.sourceChatId && order.sourceMessageId) {
    const breakdown = updated.categories
      .map((cat) => `${escapeHtml(cat.name)} — ${escapeHtml(cat.accepted.name)} (${formatTime(cat.accepted.at)})`)
      .join("\n");
    try {
      await bot.editMessageText(
        `✅ Заказ принят кухней:\n${breakdown}\n\n<blockquote>${order.coreMessage}</blockquote>`,
        { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
      );
      markFinalNotified(orderId);
    } catch {
      // best effort
    }
  }

  await bot.answerCallbackQuery(query.id, { text: "Принято!" }).catch(() => {});
}

module.exports = { createOkoOrderRouter, registerOrderAcceptHandler, readConfig, writeConfig, CONFIG_PATH };
