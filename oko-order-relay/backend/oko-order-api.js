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
  STATUS_LABELS,
  orderStatus,
  orderTimeline,
  markShipping,
  setShippingMessage,
  setShippingKitchenMessage,
  setTrackUrl,
  markReceived,
  findOrderByShipToken,
  findOrderByShippingMessage,
  ensureShipToken,
  listOrders,
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
const MEDIA_KINDS = { cover: 1600, logo: 512, item: 640, category: 800, group: 800 };
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

// Фото категорий (2026-09-30, правка дизайна после Этапа 2): { "Десерты":
// "/api/oko-order/media/…webp" }. Оставляем только категории, которые
// реально есть у позиций формы, и только ссылки на наш /media/.
function cleanCategoryPhotos(raw, items) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const present = new Set((items || []).map((item) => normalizeItem(item).category).filter(Boolean));
  const out = {};
  Object.entries(raw).forEach(([category, url]) => {
    const clean = cleanMediaUrl(url);
    if (clean && present.has(category)) out[category] = clean;
  });
  return Object.keys(out).length ? out : null;
}

function referencedMedia(config) {
  const names = new Set();
  const add = (url) => {
    const clean = cleanMediaUrl(url);
    if (clean) names.add(clean.slice(MEDIA_URL_PREFIX.length));
  };
  Object.values(readGroups()).forEach((group) => add(group && group.photoUrl));
  Object.values(config).forEach((form) => {
    add(form.coverUrl);
    add(form.logoUrl);
    Object.values(form.categoryPhotos || {}).forEach(add);
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
function buildOrderPrintLines(order, venueConfig, withShipQr) {
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
  if (withShipQr) lines.push("При отправке отсканируйте QR:", "отметка «Отправляется»");
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

function printOrderTicket(order, venueConfig, shipToken) {
  try {
    // Путь проверен при деплое 2026-09-20: oko-shelf-life-store.js лежит в
    // том же каталоге, что и oko-order-api.js (/root/kitchendesk/backend/src/).
    const { createRawPrintJob } = require("./oko-shelf-life-store");
    createRawPrintJob({
      printLines: buildOrderPrintLines(order, venueConfig, !!shipToken),
      qrData: shipToken ? shipUrl(shipToken) : null,
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

// ── Этап 4: QR «Отправляется» на чеке заказа ────────────────────────────
// Ссылка ведёт на страницу этого роутера (/api/oko-order/ship/<token>);
// токен случайный на каждый заказ — как QR завершения смены на чек-листе.
const SHIP_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const TRACK_URL_MAX_LEN = 500;

function generateShipToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function shipUrl(token) {
  const origin = new URL(process.env.OKO_ORDER_FORM_URL || "https://kitchendesk.chefplan.ru/oko-order/").origin;
  return `${origin}/api/oko-order/ship/${token}`;
}

// Ссылка отслеживания: только http(s), без пробелов. Пусто → null, плохая → false.
function cleanTrackUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (value.length > TRACK_URL_MAX_LEN || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : false;
  } catch {
    return false;
  }
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ORDER_TIME_ZONE });
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

const CONFIG_PATH = path.join(__dirname, "data", "oko-order-config.json");
// Время в сообщениях/на странице QR — как у остальных сообщений модуля
// (formatTime без зоны = зона процесса); здесь явно, чтобы страница QR и
// история показывали то же самое.
const ORDER_TIME_ZONE = process.env.TZ || undefined;

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

// ── Этап 3 (2026-10-01): «Группы» мастера настройки (макет 01) ──────────
// Группа = Telegram-группа клиента, где закреплены кнопки форм
// (sourceGroupChatId); «Темы» группы = формы с этой группой-источником.
// Сами формы по-прежнему живут в oko-order-config.json (ключи верхнего
// уровня — только формы, туда ничего не добавляем). Здесь — только то, чего
// у формы нет: название/описание/фото группы и выключатель «Активна» на всю
// группу. Группы нет в файле → считается активной, поэтому Облако и Мясо
// работают как раньше, пока группу не выключат явно.
const GROUPS_PATH = path.join(__dirname, "data", "oko-order-groups.json");
const GROUP_CHAT_ID_RE = /^-?\d{1,20}$/;
const GROUP_TITLE_MAX_LEN = 60;
const GROUP_DESCRIPTION_MAX_LEN = 300;

function readGroups() {
  try {
    const groups = JSON.parse(fs.readFileSync(GROUPS_PATH, "utf8"));
    return groups && typeof groups === "object" && !Array.isArray(groups) ? groups : {};
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[oko-order] не удалось прочитать группы:", err.message);
    return {};
  }
}

function writeGroups(groups) {
  fs.writeFileSync(GROUPS_PATH, JSON.stringify(groups, null, 2), "utf8");
}

function isGroupActive(form) {
  const group = form && form.sourceGroupChatId ? readGroups()[String(form.sourceGroupChatId)] : null;
  return !group || group.active !== false;
}

// Принимает ли форма заказы прямо сейчас: выключена сама форма или вся её группа.
function isFormOpen(form) {
  return isFormActive(form) && isGroupActive(form);
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

// Вход в админку и мастер /web/oko-order — один пароль OKO_ADMIN_PASSWORD
// (решение пользователя 2026-10-01: во всех его панелях единый пароль;
// вход логином KitchenDesk, добавленный в Этапе 3, убран).
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
    if (!isFormOpen(found.form)) {
      return res.status(403).json({ error: "Приём заказов через эту форму сейчас закрыт", closed: true, label: found.form.label });
    }
    res.json({
      label: found.form.label,
      coverUrl: cleanMediaUrl(found.form.coverUrl),
      logoUrl: cleanMediaUrl(found.form.logoUrl),
      categoryPhotos: cleanCategoryPhotos(found.form.categoryPhotos, found.form.items) || {},
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
    if (!isFormOpen(venueConfig)) {
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
      const shipToken = generateShipToken();
      printOrderTicket(order, venueConfig, shipToken);

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
        // Этап 4: состав для истории заказов и QR «Отправляется» с чека.
        date: order.date || null,
        items: order.items,
        comment: order.comment || null,
        name: order.name || null,
        sourceThreadId: venueConfig.sourceThreadId ? String(venueConfig.sourceThreadId) : null,
        kitchenThreadId: venueConfig.kitchenThreadId ? String(venueConfig.kitchenThreadId) : null,
        shipToken,
        shipping: null,
        received: null,
        createdAt: Date.now(),
      });

    return { status: 200, body: { ok: true } };
  }

  // ── Этап 4: история заказов формы для клиента (по той же секретной
  // ссылке ?f=). Только то, что клиент и так видит: дата, состав, статусы.
  router.get("/history", formLookupLimiter, (req, res) => {
    const config = readConfig();
    const found = resolveForm(config, { f: req.query.f, venue: req.query.venue });
    if (!found.form) return res.status(found.status).json(found.body);
    const orders = listOrders({ venue: found.key, limit: 30 }).map(([id, order]) => publicOrderView(id, order));
    res.json({ label: found.form.label, orders });
  });

  // Admin — раздел «Заказы» мастера: все формы или одна (?venue=).
  router.get("/admin/orders", adminLoginLimiter, requireAdmin, (req, res) => {
    const venue = typeof req.query.venue === "string" && req.query.venue ? req.query.venue : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
    const orders = listOrders({ venue, limit }).map(([id, order]) => ({
      ...publicOrderView(id, order),
      venue: order.venue,
      venueLabel: order.venueLabel || order.venue,
      comment: order.comment || null,
      name: order.name || null,
      receiptPhoto: !!(order.received && order.received.fileId),
      // Этап 5: можно напечатать чек с QR (ещё не отправлен) и печатался ли он уже.
      canPrintQr: !order.shipping && !order.received,
      hasQr: !!order.shipToken,
    }));
    res.json({ orders, statusLabels: STATUS_LABELS });
  });

  // Этап 5: «Распечатать чек с QR» для уже существующего заказа — старые
  // заказы (до Этапа 4) печатались без QR, и без него их нельзя провести
  // через «Отправляется → Доставлено». Токен QR выдаётся заказу один раз,
  // повторная печать даёт тот же QR. Уже отправленным/доставленным — не нужно.
  router.post("/admin/orders/print-qr", adminLoginLimiter, requireAdmin, (req, res) => {
    const orderId = typeof (req.body && req.body.id) === "string" ? req.body.id : "";
    const existing = orderId ? getOrder(orderId) : null;
    if (!existing) return res.status(404).json({ error: "Заказ не найден" });
    if (existing.shipping || existing.received) {
      return res.status(409).json({ error: "Заказ уже отмечен как отправленный — QR больше не нужен" });
    }
    const order = ensureShipToken(orderId, generateShipToken);
    try {
      const { createRawPrintJob } = require("./oko-shelf-life-store");
      const label = order.venueLabel || order.venue;
      createRawPrintJob({
        printLines: buildReprintLines(order),
        qrData: shipUrl(order.shipToken),
        itemName: `Заказ — ${label} (чек с QR)`,
        by: "Мастер заказов",
        restaurantId: String(order.restaurantId || DEFAULT_RESTAURANT_ID),
      });
    } catch (err) {
      console.error("[oko-order] чек с QR для заказа", orderId, err.message);
      return res.status(500).json({ error: "Не удалось поставить чек в очередь печати" });
    }
    res.json({ ok: true });
  });

  // QR с чека → страница заказа с кнопкой «Отправляется» (как QR
  // завершения смены: токен в ссылке и есть доступ, пароль не нужен).
  router.get("/ship/:token", formLookupLimiter, (req, res) => {
    const found = SHIP_TOKEN_RE.test(req.params.token) ? findOrderByShipToken(req.params.token) : null;
    if (!found) return sendShipPage(res, 404, { title: "QR не найден", text: "Такого заказа нет — проверьте, что сканируете QR с чека заказа." });
    sendShipPage(res, 200, { token: req.params.token, orderId: found.orderId, order: found.order });
  });

  router.post("/ship/:token", formLookupLimiter, express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
    const found = SHIP_TOKEN_RE.test(req.params.token) ? findOrderByShipToken(req.params.token) : null;
    if (!found) return sendShipPage(res, 404, { title: "QR не найден", text: "Такого заказа нет — проверьте, что сканируете QR с чека заказа." });
    const trackUrl = cleanTrackUrl(req.body && req.body.trackUrl);
    if (trackUrl === false) {
      return sendShipPage(res, 400, { token: req.params.token, orderId: found.orderId, order: found.order, error: "Ссылка отслеживания должна начинаться с http:// или https://" });
    }
    try {
      if (found.order.shipping) {
        // Уже отправлен — можно только дописать ссылку, если её не было.
        if (trackUrl && !found.order.shipping.trackUrl) await addTrackUrl(bot, found.orderId, trackUrl);
      } else {
        await shipOrder(bot, found.orderId, { by: "QR с чека", via: "qr", trackUrl });
      }
    } catch (err) {
      console.error("[oko-order] отметка «Отправляется» по QR:", err.message);
    }
    const fresh = getOrder(found.orderId);
    sendShipPage(res, 200, { token: req.params.token, orderId: found.orderId, order: fresh, done: true });
  });

  // Admin — full config (routing IDs + items) for every configured venue.
  router.get("/admin/config", adminLoginLimiter, requireAdmin, (req, res) => {
    // formUrl / legacySlugAllowed — вычисляемые, только для показа в админке
    // (обратно при сохранении сервер их игнорирует, см. SERVER_FORM_FIELDS).
    const config = readConfig();
    const view = {};
    for (const [key, form] of Object.entries(config)) {
      view[key] = { ...form, formUrl: formUrl(form), legacySlugAllowed: isLegacySlugAllowed(form), active: isFormActive(form), groupActive: isGroupActive(form) };
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
      const categoryPhotos = cleanCategoryPhotos(form.categoryPhotos, form.items);
      if (categoryPhotos) form.categoryPhotos = categoryPhotos;
      else delete form.categoryPhotos;
      delete form.formUrl;
      delete form.legacySlugAllowed;
      delete form.groupActive;
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

  // Admin — группы мастера (Этап 3). GET — метаданные всех групп; формы
  // группы фронт берёт из /admin/config по sourceGroupChatId.
  router.get("/admin/groups", adminLoginLimiter, requireAdmin, (req, res) => {
    const groups = readGroups();
    const view = {};
    for (const [chatId, group] of Object.entries(groups)) {
      view[chatId] = { ...group, active: group.active !== false };
    }
    res.json(view);
  });

  // Создать/обновить группу. Присланные поля целиком заменяют старые
  // (кроме createdAt). Фото — только наше /media/.
  router.post("/admin/groups", adminLoginLimiter, requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const chatId = String(body.chatId || "").trim();
    if (!GROUP_CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: "Некорректный ID группы" });
    const title = typeof body.title === "string" ? body.title.trim().slice(0, GROUP_TITLE_MAX_LEN) : "";
    if (!title) return res.status(400).json({ error: "Укажите название группы" });
    if (body.active !== undefined && typeof body.active !== "boolean") {
      return res.status(400).json({ error: "Нужно active: true/false" });
    }
    const description = typeof body.description === "string" ? body.description.trim().slice(0, GROUP_DESCRIPTION_MAX_LEN) : "";
    const groups = readGroups();
    const existing = groups[chatId] || {};
    const group = { title, active: body.active !== false, createdAt: existing.createdAt || Date.now() };
    if (description) group.description = description;
    const photoUrl = cleanMediaUrl(body.photoUrl);
    if (photoUrl) group.photoUrl = photoUrl;
    groups[chatId] = group;
    writeGroups(groups);
    collectUnusedMedia(readConfig());
    res.json({ ok: true, group: { ...group, chatId } });
  });

  // Убрать группу из списка — только если в ней не осталось форм (иначе
  // формы потеряли бы выключатель группы молча).
  router.post("/admin/groups/delete", adminLoginLimiter, requireAdmin, (req, res) => {
    const chatId = String((req.body && req.body.chatId) || "").trim();
    const groups = readGroups();
    if (!Object.prototype.hasOwnProperty.call(groups, chatId)) return res.status(404).json({ error: "Неизвестная группа" });
    const config = readConfig();
    if (Object.values(config).some((form) => String(form.sourceGroupChatId || "") === chatId)) {
      return res.status(409).json({ error: "В группе есть темы — сначала удалите или перенесите их" });
    }
    delete groups[chatId];
    writeGroups(groups);
    collectUnusedMedia(config);
    res.json({ ok: true });
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

// ── Этап 4: статусы, отправка, фото-чек ────────────────────────────────

function stripHtml(html) {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Старые заказы (до Этапа 4) хранят только текст сообщения — достаём из
// него дату («📅 Дата: 2026-10-31») и строки «• Позиция — 2 шт.». Не
// разобралось — отдаём текст как есть (summary).
function parseLegacyMessage(coreMessage) {
  const text = stripHtml(coreMessage);
  const dateMatch = /Дата:\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  const items = [];
  text.split("\n").forEach((line) => {
    const m = /^•\s*(.+?)\s+—\s+(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(line.trim());
    if (m) items.push({ name: m[1], qty: Number(m[2].replace(",", ".")), unit: m[3].trim() || DEFAULT_UNIT });
  });
  return { date: dateMatch ? dateMatch[1] : null, items: items.length ? items : null, text };
}

// Этап 5: строки чека для уже существующего заказа. Новые заказы хранят
// состав; у старых он разбирается из текста сообщения (как в истории), а
// комментарий и отправитель — оттуда же. Не разобралось — печатаем текст.
function buildReprintLines(order) {
  const legacy = Array.isArray(order.items) ? null : parseLegacyMessage(order.coreMessage);
  let comment = order.comment || null;
  let name = order.name || null;
  if (legacy && !legacy.items) {
    comment = null; // весь текст сообщения печатается ниже как есть
  } else if (legacy) {
    const c = /Комментарий:\s*\n([\s\S]*?)(?:\n\s*\nОтправил:|$)/.exec(legacy.text);
    const n = /^Отправил:\s*(.+)$/m.exec(legacy.text);
    comment = c ? c[1].trim() || null : null;
    name = n ? n[1].trim() : null;
  }
  const src = {
    date: order.date || (legacy && legacy.date) || "",
    items: Array.isArray(order.items) ? order.items : (legacy.items || []),
    comment,
    name,
  };
  const lines = buildOrderPrintLines(src, { label: order.venueLabel || order.venue }, true);
  if (order.createdAt) lines.splice(4, 0, `Оформлен: ${formatDateTime(order.createdAt)}`);
  if (legacy && !legacy.items) {
    const body = legacy.text.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
    lines.splice(lines.indexOf("------------------------------", 5) + 1, 0, ...body);
  }
  return lines;
}

// Заказ для истории (клиент и раздел «Заказы»).
function publicOrderView(id, order) {
  const legacy = Array.isArray(order.items) ? null : parseLegacyMessage(order.coreMessage);
  return {
    id,
    createdAt: order.createdAt || null,
    date: order.date || (legacy && legacy.date) || null,
    items: Array.isArray(order.items)
      ? order.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit || DEFAULT_UNIT }))
      : legacy.items,
    summary: legacy && !legacy.items ? legacy.text : null,
    status: orderStatus(order),
    timeline: orderTimeline(order).map((e) => ({ status: e.status, at: e.at, via: e.via || null, trackUrl: e.trackUrl || null })),
  };
}

function orderThreadOptions(threadId, replyTo) {
  const options = { parse_mode: "HTML", disable_web_page_preview: true };
  if (threadId) options.message_thread_id = Number(threadId);
  if (replyTo) {
    options.reply_to_message_id = replyTo;
    options.allow_sending_without_reply = true;
  }
  return options;
}

function orderSourceThread(order) {
  if (order.sourceThreadId) return order.sourceThreadId;
  try {
    const form = readConfig()[order.venue];
    return form && form.sourceThreadId ? String(form.sourceThreadId) : null;
  } catch {
    return null;
  }
}

function orderKitchenThread(order) {
  if (order.kitchenThreadId) return order.kitchenThreadId;
  try {
    const form = readConfig()[order.venue];
    return form && form.kitchenThreadId ? String(form.kitchenThreadId) : null;
  } catch {
    return null;
  }
}

function orderTitle(order) {
  return `«${escapeHtml(order.venueLabel || order.venue)}»${order.date ? ` на ${escapeHtml(order.date)}` : ""}`;
}

/**
 * «Отправляется»: QR с чека (via "qr") или прежняя вторая кнопка доставщика
 * (via "button"). Первая отметка побеждает. В тему клиента уходит сообщение
 * об отправке (с трек-ссылкой, если есть) — на НЕГО клиент отвечает фото
 * чека; в кухню — короткая пометка ответом на сообщение заказа.
 */
async function shipOrder(bot, orderId, { by, via, trackUrl }) {
  const at = Date.now();
  const { order, created } = markShipping(orderId, { at, by: by || null, via, trackUrl: trackUrl || null, messageId: null });
  if (!order || !created) return { order, created: false };

  if (order.sourceChatId) {
    const lines = [
      `🚚 <b>Заказ отправлен</b> — ${orderTitle(order)}`,
      `Время отправки: ${formatTime(at)}`,
    ];
    if (trackUrl) lines.push(`Отслеживание: <a href="${escapeAttr(trackUrl)}">${escapeHtml(trackUrl)}</a>`);
    lines.push("", "📸 Когда получите заказ, <b>ответьте на это сообщение</b> фото чека — так заказ отметится как доставленный.");
    try {
      const sent = await bot.sendMessage(order.sourceChatId, lines.join("\n"), orderThreadOptions(orderSourceThread(order), order.sourceMessageId));
      setShippingMessage(orderId, sent.message_id);
    } catch (err) {
      console.error("[oko-order] сообщение об отправке клиенту не ушло:", err.message);
    }
  }
  if (order.kitchenChatId) {
    const how = via === "qr" ? "по QR с чека" : by ? escapeHtml(by) : "кнопкой";
    const text = `🚚 <b>Отправляется</b> — ${how}, ${formatTime(at)}${trackUrl ? `\nОтслеживание: <a href="${escapeAttr(trackUrl)}">${escapeHtml(trackUrl)}</a>` : ""}`;
    try {
      const sentKitchen = await bot.sendMessage(order.kitchenChatId, text, orderThreadOptions(orderKitchenThread(order), order.kitchenMessageId));
      setShippingKitchenMessage(orderId, sentKitchen.message_id);
    } catch {
      // best effort — статус всё равно сохранён, только копия в кухне не придёт
    }
  }
  return { order: getOrder(orderId), created: true };
}

// Ссылка отслеживания после отправки (заказ уже отмечен без неё).
async function addTrackUrl(bot, orderId, trackUrl) {
  const order = setTrackUrl(orderId, trackUrl);
  if (!order || !order.sourceChatId) return;
  const text = `🔗 Ссылка отслеживания заказа ${orderTitle(order)}: <a href="${escapeAttr(trackUrl)}">${escapeHtml(trackUrl)}</a>\n\n📸 Фото чека при получении — ответом на сообщение «Заказ отправлен» выше.`;
  await bot.sendMessage(order.sourceChatId, text, orderThreadOptions(orderSourceThread(order), order.shipping.messageId || order.sourceMessageId)).catch(() => {});
}

/**
 * «Доставлено»: клиент присылает фото чека ОТВЕТОМ на сообщение бота
 * «Заказ отправлен» (ответы на сообщения бота Telegram доставляет боту даже
 * в режиме приватности). Без ответа фото не трогаем — так нет угадывания,
 * к какому из нескольких заказов оно относится.
 */
function registerReceiptHandler(bot) {
  bot.on("message", async (msg) => {
    try {
      if (!msg.reply_to_message || !msg.chat || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) return;
      const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
      const imageDoc = msg.document && /^image\//.test(msg.document.mime_type || "") ? msg.document : null;
      if (!photo && !imageDoc) return;
      const found = findOrderByShippingMessage(msg.chat.id, msg.reply_to_message.message_id);
      if (!found) return;
      const by = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(" ") || (msg.from && msg.from.username) || "клиент";
      const at = Date.now();
      const fileId = (photo || imageDoc).file_id;
      const { order, created } = markReceived(found.orderId, { at, by, userId: msg.from ? msg.from.id : null, fileId, kind: photo ? "photo" : "document", messageId: msg.message_id });
      if (!created) return;

      // Статус-строка в начале ОБОИХ отправленных ранее сообщений ("Заказ
      // отправлен" в теме клиента, "Отправляется" в поварской группе)
      // меняется на «Доставлено» — не новое сообщение, а правка того же.
      const trackLine = order.shipping && order.shipping.trackUrl
        ? `\nОтслеживание: <a href="${escapeAttr(order.shipping.trackUrl)}">${escapeHtml(order.shipping.trackUrl)}</a>`
        : "";
      if (order.shipping && order.shipping.messageId) {
        const sourceText = `✅ <b>Доставлено</b> — ${orderTitle(order)}${trackLine}\nФото чека получено, ${formatTime(at)}`;
        await bot.editMessageText(sourceText, {
          chat_id: msg.chat.id,
          message_id: order.shipping.messageId,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }).catch(() => {});
      }
      if (order.kitchenChatId && order.shipping && order.shipping.kitchenMessageId) {
        const kitchenText = `✅ <b>Доставлено</b>${trackLine}\nФото чека от ${escapeHtml(by)}, ${formatTime(at)}`;
        await bot.editMessageText(kitchenText, {
          chat_id: order.kitchenChatId,
          message_id: order.shipping.kitchenMessageId,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }).catch(() => {});
      }

      const threadOpts = (replyTo) => {
        const o = { reply_to_message_id: replyTo, allow_sending_without_reply: true };
        if (msg.message_thread_id && msg.is_topic_message) o.message_thread_id = msg.message_thread_id;
        return o;
      };
      await bot.sendMessage(msg.chat.id, `✅ Получение подтверждено (${formatTime(at)}), спасибо! Заказ отмечен как доставленный.`, threadOpts(msg.message_id)).catch(() => {});
      if (order.kitchenChatId) {
        const caption = `✅ <b>Доставлено</b> — ${orderTitle(order)}\nФото чека прислал(а) ${escapeHtml(by)}, ${formatTime(at)}`;
        const opts = { ...orderThreadOptions(orderKitchenThread(order), order.kitchenMessageId), caption };
        const send = photo ? bot.sendPhoto(order.kitchenChatId, fileId, opts) : bot.sendDocument(order.kitchenChatId, fileId, opts);
        await send.catch((err) => console.error("[oko-order] фото-чек в кухню не ушло:", err.message));
      }
    } catch (err) {
      console.error("[oko-order] обработка фото-чека:", err.message);
    }
  });
}

const SHIP_PAGE_STATUS = {
  new: "🕐 Новый",
  cooking: "👨‍🍳 Готовится",
  shipping: "🚚 Отправляется",
  delivered: "✅ Доставлено",
};

// Страница по QR с чека — простая HTML без сборки, как у QR чек-листа.
function sendShipPage(res, status, { token, order, title, text, error, done }) {
  const css = `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#15110f;color:#f3ece6;padding:24px 16px;box-sizing:border-box}
  .card{max-width:440px;margin:0 auto;background:#211a16;border:1px solid #3a2e27;border-radius:18px;padding:22px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#b5a79c;font-size:14px;margin:0 0 16px}
  .st{display:inline-block;padding:6px 12px;border-radius:999px;background:#2e241e;font-size:14px;margin-bottom:14px}
  ul{list-style:none;padding:0;margin:0 0 16px}li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #3a2e27;font-size:15px}
  li:last-child{border-bottom:none}.q{color:#e6a656;white-space:nowrap}
  label{display:block;font-size:14px;color:#b5a79c;margin:6px 0}
  input{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #3a2e27;background:#15110f;color:#f3ece6;font-size:15px}
  button{width:100%;margin-top:14px;padding:15px;border:none;border-radius:14px;background:#e6a656;color:#1b130c;font-size:17px;font-weight:700}
  .err{color:#f08b7a;font-size:14px;margin-top:8px}.ok{color:#9fc690;font-size:15px;margin:10px 0}
  .tl{font-size:14px;color:#b5a79c;margin-top:14px}.tl div{padding:3px 0}a{color:#e6a656;word-break:break-all}`;
  let body;
  if (!order) {
    body = `<h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(text)}</p>`;
  } else {
    const st = orderStatus(order);
    const items = Array.isArray(order.items)
      ? `<ul>${order.items.map((i) => `<li><span>${escapeHtml(i.name)}</span><span class="q">${escapeHtml(i.qty)} ${escapeHtml(i.unit || DEFAULT_UNIT)}</span></li>`).join("")}</ul>`
      : `<p class="sub">${escapeHtml(stripHtml(order.coreMessage))}</p>`;
    const timeline = orderTimeline(order)
      .map((e) => `<div>${SHIP_PAGE_STATUS[e.status]} — ${formatDateTime(e.at)}${e.trackUrl ? ` · <a href="${escapeAttr(e.trackUrl)}">трек</a>` : ""}</div>`)
      .join("");
    let action = "";
    if (!order.shipping && !order.received) {
      action = `<form method="post" action="${escapeAttr(token)}">
        <label for="t">Ссылка отслеживания (необязательно)</label>
        <input id="t" name="trackUrl" type="url" inputmode="url" placeholder="https://…" maxlength="${TRACK_URL_MAX_LEN}">
        ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
        <button type="submit">🚚 Отправляется</button></form>`;
    } else if (order.shipping && !order.shipping.trackUrl && !order.received) {
      action = `${done ? `<div class="ok">Отмечено: заказ отправляется. Клиенту ушло сообщение в Telegram.</div>` : ""}
        <form method="post" action="${escapeAttr(token)}">
        <label for="t">Добавить ссылку отслеживания</label>
        <input id="t" name="trackUrl" type="url" inputmode="url" placeholder="https://…" maxlength="${TRACK_URL_MAX_LEN}" required>
        ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
        <button type="submit">Отправить ссылку клиенту</button></form>`;
    } else if (done) {
      action = `<div class="ok">Готово — клиенту ушло сообщение в Telegram.</div>`;
    }
    body = `<h1>Заказ ${escapeHtml(order.venueLabel || order.venue)}</h1>
      <p class="sub">${order.date ? `на ${escapeHtml(order.date)} · ` : ""}создан ${formatDateTime(order.createdAt)}</p>
      <div class="st">${SHIP_PAGE_STATUS[st]}</div>${items}${action}<div class="tl">${timeline}</div>`;
  }
  res.status(status).set("Cache-Control", "no-store").type("html").send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Заказ — KitchenDesk</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`);
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
  // Этап 4: фото-чек ответом на «Заказ отправлен» → «Доставлено». Регистрируется
  // здесь, чтобы не трогать index.js (он вызывает только эту функцию).
  registerReceiptHandler(bot);
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
    await shipOrder(bot, orderId, { by: deliveredByName, via: "button" }).catch((err) => console.error("[oko-order] shipOrder:", err.message));
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
    if (allDeliveredNow) {
      await shipOrder(bot, orderId, { by: deliveredByName, via: "button" }).catch((err) => console.error("[oko-order] shipOrder:", err.message));
    }
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
