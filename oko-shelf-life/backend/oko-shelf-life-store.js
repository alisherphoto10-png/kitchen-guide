const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const ITEMS_PATH = path.join(DATA_DIR, "oko-shelf-life-items.json");
const PRINT_JOBS_PATH = path.join(DATA_DIR, "oko-shelf-life-print-jobs.json");
const AGENT_REPORTS_PATH = path.join(DATA_DIR, "oko-shelf-life-agent-reports.json");
const RESTAURANTS_PATH = path.join(DATA_DIR, "oko-shelf-life-restaurants.json");
// Легаси-заведение — единственное, что было до многозаведенческой поддержки.
// Реальный агент на моноблоке ОКО уже работает с секретом из переменной
// окружения OKO_SHELF_LIFE_AGENT_TOKEN (не из этого файла) — чтобы его не
// пришлось перенастраивать, findRestaurantByToken (см. ниже) продолжает
// понимать этот старый токен и подставляет вместо настоящей записи вот это.
// Список принтеров у него пуст — IP/порт для него по-прежнему держит сам
// агент локально (agent-config.json), сервер этим заведением не управляет.
const LEGACY_RESTAURANT_ID = "default";

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

// ---------- заведения и их принтеры ----------
// Одна запись = одно заведение: свой секретный токен (агент на его
// моноблоке использует именно его — так задания разных заведений не
// пересекаются в общей очереди) и список принтеров (по имени — "Раздача",
// "Горячий цех" и т.п. — задание на печать помечается printerTarget,
// сервер сам подставляет нужный IP/порт при выдаче агенту, см. ниже).
// Список принтеров живёт ЗДЕСЬ, не в agent-config.json на моноблоке —
// специально, чтобы владелец мог всё настраивать из панели, не трогая
// каждый моноблок лично.
function readRestaurants() {
  return readJson(RESTAURANTS_PATH, []);
}
function writeRestaurants(list) {
  writeJson(RESTAURANTS_PATH, list);
}

function slugify(name) {
  const base = (name || "")
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return base || "zavedenie";
}

// customId — необязательно, но важно для заведений, которых уже знают
// ДРУГИЕ модули под своим именем (например, oko-order-relay зовёт заведения
// "oblako"/"myaso" в своём конфиге, латиницей — не так, как они называются
// по-русски в этой панели). Если печать тикетов заказа должна прийти на
// принтер именно этого заведения — id здесь ДОЛЖЕН совпадать с тем, как
// заведение называется в том, другом, модуле, иначе задания будут просто
// молча копиться в очереди, никем не забираемые (см. printOrderTicket в
// oko-order-relay/backend/oko-order-api.js).
function addRestaurant({ name, id: customId }) {
  if (!name || !name.trim()) throw new Error("Укажите название заведения");
  const list = readRestaurants();
  let id = (customId && customId.trim()) || slugify(name);
  if (customId && customId.trim()) {
    if (list.some((r) => r.id === id) || id === LEGACY_RESTAURANT_ID) {
      throw new Error(`ID "${id}" уже занят`);
    }
  } else {
    let suffix = 1;
    while (list.some((r) => r.id === id) || id === LEGACY_RESTAURANT_ID) {
      suffix += 1;
      id = `${slugify(name)}-${suffix}`;
    }
  }
  const restaurant = {
    id,
    name: name.trim(),
    agentToken: makeToken(),
    printers: [],
    createdAt: Date.now(),
  };
  list.push(restaurant);
  writeRestaurants(list);
  return restaurant;
}

function updateRestaurant(id, patch) {
  const list = readRestaurants();
  const restaurant = list.find((r) => r.id === id);
  if (!restaurant) return null;
  if (patch.name !== undefined && patch.name.trim()) restaurant.name = patch.name.trim();
  writeRestaurants(list);
  return restaurant;
}

function deleteRestaurant(id) {
  const list = readRestaurants();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  writeRestaurants(next);
  return true;
}

function regenerateRestaurantToken(id) {
  const list = readRestaurants();
  const restaurant = list.find((r) => r.id === id);
  if (!restaurant) return null;
  restaurant.agentToken = makeToken();
  writeRestaurants(list);
  return restaurant;
}

function listRestaurants() {
  return readRestaurants();
}

function getRestaurant(id) {
  return readRestaurants().find((r) => r.id === id) || null;
}

function addPrinter(restaurantId, { name, ip, port }) {
  if (!name || !name.trim()) throw new Error("Укажите название принтера");
  if (!ip || !ip.trim()) throw new Error("Укажите IP принтера");
  const list = readRestaurants();
  const restaurant = list.find((r) => r.id === restaurantId);
  if (!restaurant) throw new Error("Заведение не найдено");
  const printer = { id: makeId(), name: name.trim(), ip: ip.trim(), port: Number(port) || 9100 };
  restaurant.printers.push(printer);
  writeRestaurants(list);
  return printer;
}

function updatePrinter(restaurantId, printerId, patch) {
  const list = readRestaurants();
  const restaurant = list.find((r) => r.id === restaurantId);
  if (!restaurant) return null;
  const printer = restaurant.printers.find((p) => p.id === printerId);
  if (!printer) return null;
  if (patch.name !== undefined && patch.name.trim()) printer.name = patch.name.trim();
  if (patch.ip !== undefined && patch.ip.trim()) printer.ip = patch.ip.trim();
  if (patch.port !== undefined) printer.port = Number(patch.port) || printer.port;
  writeRestaurants(list);
  return printer;
}

function deletePrinter(restaurantId, printerId) {
  const list = readRestaurants();
  const restaurant = list.find((r) => r.id === restaurantId);
  if (!restaurant) return false;
  const next = restaurant.printers.filter((p) => p.id !== printerId);
  if (next.length === restaurant.printers.length) return false;
  restaurant.printers = next;
  writeRestaurants(list);
  return true;
}

// Токен агента -> заведение. Поддерживает и новые заведения (из панели), и
// старый единственный токен из переменной окружения (легаси, см. коммент у
// LEGACY_RESTAURANT_ID выше) — чтобы уже работающий на реальном моноблоке
// агент не сломался при переходе на многозаведенческую схему.
function findRestaurantByToken(token) {
  if (!token) return null;
  const match = readRestaurants().find((r) => r.agentToken === token);
  if (match) return match;
  const legacyToken = process.env.OKO_SHELF_LIFE_AGENT_TOKEN;
  if (legacyToken && token === legacyToken) {
    return { id: LEGACY_RESTAURANT_ID, name: "ОКО (легаси)", agentToken: legacyToken, printers: [] };
  }
  return null;
}

function readItems() {
  return readJson(ITEMS_PATH, []);
}
function writeItems(items) {
  writeJson(ITEMS_PATH, items);
}

// "72 часа (3 суток)" -> 72, "3 суток" -> 72, "2 недели" -> 336 — берём
// первое число+единицу в строке, скобки с пересчётом в других единицах
// (если есть) игнорируем, они для человека, не для парсинга.
function parseShelfLifeHours(text) {
  if (!text) return null;
  // "сут" — не "сутк": родительный падеж множественного числа "сутки"
  // неправильный ("5 суток", а не "5 сутков"), "сутк" в это слово не
  // входит подстрокой ни разу. Ловили баг на реальном импорте — из 185
  // позиций 34 не распознались именно из-за этого.
  const match = /(\d+)\s*(час|сут|недел)/i.exec(String(text).trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "час") return n;
  if (unit === "сут") return n * 24;
  if (unit === "недел") return n * 24 * 7;
  return null;
}

/**
 * `shelfLifeText` — как ввёл человек ("72 часа (3 суток)", "2 недели") —
 * показываем в админке как есть. `shelfLifeHours` — распарсенное число для
 * расчётов (когда дойдём до печати этикеток: дата разморозки + это число
 * часов = когда списывать). Если распарсить не вышло (нестандартная
 * формулировка) — `shelfLifeHours` будет null, элемент всё равно
 * сохраняется (текст на этикетке важнее, чем автоматический расчёт evrywhere).
 */
function addItem({ name, storageCondition, shelfLifeText, note, categoryHint }) {
  const items = readItems();
  const nextNumber = items.reduce((max, it) => Math.max(max, it.number || 0), 0) + 1;
  const item = {
    id: makeId(),
    number: nextNumber,
    name: (name || "").trim(),
    storageCondition: (storageCondition || "").trim(),
    shelfLifeText: (shelfLifeText || "").trim(),
    shelfLifeHours: parseShelfLifeHours(shelfLifeText),
    note: (note || "").trim(),
    categoryHint: (categoryHint || "").trim(),
    archived: false,
    createdAt: Date.now(),
  };
  items.push(item);
  writeItems(items);
  return item;
}

function updateItem(id, patch) {
  const items = readItems();
  const item = items.find((it) => it.id === id);
  if (!item) return null;
  if (patch.name !== undefined) item.name = patch.name.trim();
  if (patch.storageCondition !== undefined) item.storageCondition = patch.storageCondition.trim();
  if (patch.shelfLifeText !== undefined) {
    item.shelfLifeText = patch.shelfLifeText.trim();
    item.shelfLifeHours = parseShelfLifeHours(patch.shelfLifeText);
  }
  if (patch.note !== undefined) item.note = patch.note.trim();
  if (patch.archived !== undefined) item.archived = !!patch.archived;
  writeItems(items);
  return item;
}

function deleteItem(id) {
  const items = readItems();
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return false;
  writeItems(next);
  return true;
}

// ---------- печать этикеток разморозки/заморозки ----------
// Задание кладёт повар (со страницы без пароля админки), забирает и
// печатает локальный агент на моноблоке (сервер до принтера в сети
// заведения не достаёт — см. README). Очередь — просто список заданий,
// не более пары десятков за смену, файла на диске достаточно, отдельная
// БД не нужна.
function readPrintJobs() {
  return readJson(PRINT_JOBS_PATH, []);
}
function writePrintJobs(jobs) {
  writeJson(PRINT_JOBS_PATH, jobs);
}

function formatDateTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Текст этикетки строится ЗДЕСЬ, не в агенте на моноблоке — так правки
// дизайна чека (порядок строк, формулировки, новые поля) остаются
// только на сервере, агент просто печатает присланные строки как есть.
// Раньше (первая версия) текст собирался в print-agent.js — при любой
// правке дизайна пришлось бы заново раздавать файл на моноблок.
function buildPrintLines(job, item) {
  const actionLabel = job.action === "заморозка" ? "Заморожено" : "Разморожено";
  const lines = ["KitchenDesk", "------------------------------", item.name, `${actionLabel}: ${formatDateTime(job.createdAt)}`];
  lines.push(job.expiresAt ? `Годен до: ${formatDateTime(job.expiresAt)}` : "Годен до: _______________ (впишите)");
  lines.push(`Кто: ${job.by}`);
  lines.push("------------------------------");
  return lines;
}

function createPrintJob({ itemId, action, by, restaurantId, printerTarget }) {
  if (action !== "разморозка" && action !== "заморозка") {
    throw new Error("action должен быть 'разморозка' или 'заморозка'");
  }
  const item = readItems().find((it) => it.id === itemId);
  if (!item) throw new Error("Позиция не найдена в справочнике");

  const now = Date.now();
  const expiresAt = item.shelfLifeHours != null ? now + item.shelfLifeHours * 3600 * 1000 : null;

  const jobs = readPrintJobs();
  const job = {
    id: makeId(),
    restaurantId: restaurantId || LEGACY_RESTAURANT_ID,
    printerTarget: printerTarget || null,
    itemId: item.id,
    itemName: item.name,
    shelfLifeText: item.shelfLifeText,
    action,
    by: (by || "").trim() || "Без имени",
    createdAt: now,
    expiresAt,
    status: "pending",
    printedAt: null,
  };
  job.printLines = buildPrintLines(job, item);
  jobs.push(job);
  writePrintJobs(jobs);
  return job;
}

// Произвольное задание печати — не привязано к позиции справочника.
// Для чек-листа смены (kitchen2026-план -> QR-завершение) и тикетов
// заказа (oko-order-relay): изначально задумывался отдельный HTTP-роут с
// секретом между "двумя серверами" (см. oko-checklist-print/README.md),
// но оказалось, что оба модуля живут в одном процессе
// (/root/kitchendesk/backend) — вызывается напрямую как функция, без HTTP
// и без отдельного токена.
//
// restaurantId — какое заведение печатает (по умолчанию легаси-заведение,
// см. LEGACY_RESTAURANT_ID — так старые вызовы без этого параметра не
// ломаются). printerTarget — название принтера ИЗ СПИСКА этого заведения
// ("Раздача", "Горячий цех" и т.п.), не обязателен — если не указан или не
// найден, берётся первый принтер заведения (см. resolvePrinterForJob).
function createRawPrintJob({ printLines, qrData, itemName, by, restaurantId, printerTarget }) {
  if (!Array.isArray(printLines) || printLines.length === 0) {
    throw new Error("printLines обязателен и должен быть непустым массивом строк");
  }
  const jobs = readPrintJobs();
  const job = {
    id: makeId(),
    restaurantId: restaurantId || LEGACY_RESTAURANT_ID,
    printerTarget: printerTarget || null,
    itemId: null,
    itemName: itemName || "Печать",
    shelfLifeText: null,
    action: "raw",
    by: (by || "").trim(),
    createdAt: Date.now(),
    expiresAt: null,
    status: "pending",
    printedAt: null,
    printLines,
    qrData: qrData || null,
  };
  jobs.push(job);
  writePrintJobs(jobs);
  return job;
}

// Подставляет в задание реальный IP/порт принтера этого заведения — по
// printerTarget (имя принтера), если он есть и найден, иначе первый
// принтер в списке заведения. Легаси-заведение (см. LEGACY_RESTAURANT_ID)
// и заведения без единого настроенного принтера — вернёт задание как
// есть, без printerIp/printerPort: агент в этом случае использует свой
// локальный PRINTER_IP/PORT (agent-config.json) — обратная совместимость.
function resolvePrinterForJob(job, restaurant) {
  if (!restaurant || !restaurant.printers || !restaurant.printers.length) return job;
  const printer = (job.printerTarget && restaurant.printers.find((p) => p.name === job.printerTarget)) || restaurant.printers[0];
  return { ...job, printerIp: printer.ip, printerPort: printer.port };
}

function listPendingPrintJobs(restaurantId) {
  const scopeId = restaurantId || LEGACY_RESTAURANT_ID;
  const restaurant = scopeId === LEGACY_RESTAURANT_ID ? null : getRestaurant(scopeId);
  return readPrintJobs()
    .filter((j) => j.status === "pending" && (j.restaurantId || LEGACY_RESTAURANT_ID) === scopeId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((j) => resolvePrinterForJob(j, restaurant));
}

function markPrintJobDone(id, restaurantId) {
  const jobs = readPrintJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  const scopeId = restaurantId || LEGACY_RESTAURANT_ID;
  if ((job.restaurantId || LEGACY_RESTAURANT_ID) !== scopeId) return null; // чужое задание — не трогаем
  job.status = "printed";
  job.printedAt = Date.now();
  writePrintJobs(jobs);
  return job;
}

// Последние N заданий (любого статуса) — для владельца, чтобы видеть,
// что вообще печаталось, не только то, что ещё в очереди.
function listRecentPrintJobs(limit) {
  return readPrintJobs()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit || 50);
}

// Отчёты от агента (сейчас — разведка установленных в Windows принтеров
// для второго, этикеточного принтера по USB, см. runPrinterRecon в
// print-agent.js). Агент шлёт сюда, владелец (или Claude через этот
// эндпоинт с паролем) читает — без необходимости пересылать вывод команд
// вручную через человека.
function saveAgentReport(report, restaurantId) {
  const reports = readJson(AGENT_REPORTS_PATH, []);
  const saved = { id: makeId(), receivedAt: Date.now(), restaurantId: restaurantId || LEGACY_RESTAURANT_ID, ...report };
  reports.push(saved);
  // держим только последние 20 — это диагностика, не история, которую
  // нужно хранить вечно
  writeJson(AGENT_REPORTS_PATH, reports.slice(-20));
  return saved;
}

function listAgentReports(limit) {
  return readJson(AGENT_REPORTS_PATH, [])
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, limit || 20);
}

module.exports = {
  readItems,
  addItem,
  updateItem,
  deleteItem,
  parseShelfLifeHours,
  createPrintJob,
  createRawPrintJob,
  listPendingPrintJobs,
  markPrintJobDone,
  listRecentPrintJobs,
  saveAgentReport,
  listAgentReports,
  listRestaurants,
  getRestaurant,
  addRestaurant,
  updateRestaurant,
  deleteRestaurant,
  regenerateRestaurantToken,
  addPrinter,
  updatePrinter,
  deletePrinter,
  findRestaurantByToken,
  LEGACY_RESTAURANT_ID,
  ITEMS_PATH,
  PRINT_JOBS_PATH,
  AGENT_REPORTS_PATH,
  RESTAURANTS_PATH,
};
