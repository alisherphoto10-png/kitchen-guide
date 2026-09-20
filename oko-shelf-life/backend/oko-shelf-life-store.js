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

// ---------- настоящий реестр заведений KitchenDesk (источник истины) ----------
// Раньше эта панель сама была источником истины — заведение заводилось
// просто вводом названия (и опционально ID) в форме. Пользователь (реальный
// владелец KitchenDesk) явно потребовал так не делать: "в print агенте не
// должно быть других заведений, которые нету, которые не подключены к
// kitchen desk" — то есть список ЗАВЕДЕНИЙ, доступных для настройки печати,
// должен читаться из настоящей таблицы KitchenDesk, а не вводиться руками
// здесь. Эта функция читает её напрямую (тот же процесс, тот же принцип, что
// и у createRawPrintJob — без HTTP между "серверами", их и не два).
//
// ПРОВЕРИТЬ при деплое: путь до db-модуля и сигнатуру db.getAllRestaurants().
// Предположение (по аналогии с api/admin.js:92, который уже дёргает эту же
// функцию для существующей /api/admin/restaurants) — oko-shelf-life-store.js
// лежит в корне backend/, на одном уровне с db/, значит "../db/postgres" от
// него — это db/postgres от корня backend/. Если раскладка на сервере другая
// (например, если этот файл в подпапке) — поправить путь здесь. Таблица
// restaurants: активные — deleted_at IS NULL; здесь фильтруем именно так,
// но на случай, если getAllRestaurants() уже сама фильтрует и деплойный
// deleted_at отсутствует в возвращаемых полях — проверка "!r.deleted_at"
// в этом случае просто всегда true, лишним не будет.
async function listKitchenDeskTenants() {
  const db = require("../db/postgres");
  const rows = await db.getAllRestaurants();
  return rows
    .filter((r) => !r.deleted_at)
    .map((r) => ({ id: String(r.id), name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Печать для заведения "включена" здесь = у него есть локальная запись
// (токен агента + принтеры). "Выключена" = заведение реальное и активное в
// KitchenDesk, но печать для него ещё не настраивали — не то же самое, что
// "заведения не существует". listRestaurantsWithStatus (ниже) — то, что
// реально показывает панель: полный список настоящих заведений KitchenDesk,
// с пометкой, у кого уже настроена печать.
async function listRestaurantsWithStatus() {
  const tenants = await listKitchenDeskTenants();
  const local = readRestaurants();
  return tenants.map((t) => {
    const cfg = local.find((r) => r.id === t.id);
    return {
      id: t.id,
      name: t.name,
      enabled: !!cfg,
      agentToken: cfg ? cfg.agentToken : null,
      printers: cfg ? cfg.printers : [],
    };
  });
}

// Включить печать для настоящего заведения KitchenDesk (id — реальный id из
// таблицы restaurants, не придуманный). Имя всегда берётся из живого списка
// KitchenDesk, а не то, что ввели в форме — панель больше не даёт завести
// заведение, которого нет в KitchenDesk.
//
// opts.agentToken — необязательно, ТОЛЬКО для переноса уже работающего
// агента на новую схему без его переконфигурации (например, миграция ОКО:
// если задать здесь тот же секрет, что уже лежит в переменной окружения
// OKO_SHELF_LIFE_AGENT_TOKEN на моноблоке, физический агент продолжит
// работать без единой правки на своей стороне — просто найдётся через эту
// новую запись вместо старой легаси-заглушки в findRestaurantByToken). Для
// обычного нового заведения этот параметр не передают — токен генерируется.
async function enableRestaurant(tenantId, opts = {}) {
  const tenants = await listKitchenDeskTenants();
  const tenant = tenants.find((t) => t.id === String(tenantId));
  if (!tenant) throw new Error("Заведение не найдено среди активных клиентов KitchenDesk");
  const list = readRestaurants();
  if (list.some((r) => r.id === tenant.id)) throw new Error("Печать для этого заведения уже настроена");
  const restaurant = {
    id: tenant.id,
    name: tenant.name,
    agentToken: (opts.agentToken && opts.agentToken.trim()) || makeToken(),
    printers: Array.isArray(opts.printers) ? opts.printers : [],
    createdAt: Date.now(),
  };
  list.push(restaurant);
  writeRestaurants(list);
  return restaurant;
}

// Выключить печать для заведения — убирает только локальную запись (токен +
// принтеры этой панели). Само заведение в KitchenDesk этим не трогается,
// удалить его отсюда нельзя (и не должно быть можно) — это просто "больше
// не печатаем туда", а не "такого заведения не существует".
function disableRestaurant(id) {
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

function getRestaurant(id) {
  return readRestaurants().find((r) => r.id === id) || null;
}

// ВАЖНО (найден и исправлен реальный баг 2026-09-20): если вызывающий код
// передаёт restaurantId, которого ещё нет в списке заведений (например,
// order.venue = "oblako" до того, как это заведение завели в панели) —
// задание раньше сохранялось с этим restaurantId буквально и становилось
// НЕВИДИМЫМ ВООБЩЕ ДЛЯ ЛЮБОГО ТОКЕНА, включая легаси (listPendingPrintJobs
// фильтрует строго по совпадению restaurantId, а "заведения-сироты" не
// существует и опросить его нечем). Это НЕ то же самое, что "restaurantId
// не передан вообще" (тот случай действительно уходит в легаси через
// `restaurantId || LEGACY_RESTAURANT_ID` при создании) — спутал одно с
// другим в первой версии, реальные тикеты заказов несколько минут молча
// терялись в проде, пока это не поймали и не откатили руками.
// createPrintJob/createRawPrintJob теперь всегда прогоняют restaurantId
// через эту функцию — неизвестное заведение тихо (с логом) уходит в
// легаси-очередь вместо того, чтобы стать сиротой без единого читателя.
function resolveRestaurantId(restaurantId) {
  if (!restaurantId || restaurantId === LEGACY_RESTAURANT_ID) return LEGACY_RESTAURANT_ID;
  if (getRestaurant(restaurantId)) return restaurantId;
  console.error(
    `[печать] заведение "${restaurantId}" не найдено в панели /print-admin/ — задание уходит в очередь по умолчанию (default), чтобы не потеряться. Заведите это заведение в панели, если оно должно печататься отдельно.`,
  );
  return LEGACY_RESTAURANT_ID;
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

// Токен агента -> заведение. Сначала ищем среди настоящих заведений с
// включённой печатью (см. enableRestaurant) — после миграции ОКО (см.
// print-agent/README.md, п.14) она тоже находится здесь, как обычная
// запись с id="1", а не через отдельную ветку ниже.
//
// Ветка с переменной окружения OKO_SHELF_LIFE_AGENT_TOKEN — переходная
// подстраховка, не постоянная часть схемы: пока на сервере не выполнена
// миграция (POST /restaurants/1/enable с agentToken = значение этой
// переменной), уже работающий на реальном моноблоке агент продолжает
// находиться через неё, чтобы ничего не сломалось между деплоем кода и
// выполнением миграционного шага. После миграции эта ветка больше не
// участвует (токен находится в основном списке первым), но и не мешает —
// можно оставить как есть, а не вырезать отдельным деплоем.
function findRestaurantByToken(token) {
  if (!token) return null;
  const match = readRestaurants().find((r) => r.agentToken === token);
  if (match) return match;
  const legacyToken = process.env.OKO_SHELF_LIFE_AGENT_TOKEN;
  if (legacyToken && token === legacyToken) {
    return { id: LEGACY_RESTAURANT_ID, name: "ОКО (легаси, до миграции)", agentToken: legacyToken, printers: [] };
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
    restaurantId: resolveRestaurantId(restaurantId),
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
    restaurantId: resolveRestaurantId(restaurantId),
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
  const saved = { id: makeId(), receivedAt: Date.now(), restaurantId: resolveRestaurantId(restaurantId), ...report };
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
  listKitchenDeskTenants,
  listRestaurantsWithStatus,
  getRestaurant,
  enableRestaurant,
  disableRestaurant,
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
