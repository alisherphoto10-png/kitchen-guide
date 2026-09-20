const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ITEMS_PATH = path.join(DATA_DIR, "oko-shelf-life-items.json");
const PRINT_JOBS_PATH = path.join(DATA_DIR, "oko-shelf-life-print-jobs.json");

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

function createPrintJob({ itemId, action, by }) {
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

function listPendingPrintJobs() {
  return readPrintJobs()
    .filter((j) => j.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);
}

function markPrintJobDone(id) {
  const jobs = readPrintJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
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

module.exports = {
  readItems,
  addItem,
  updateItem,
  deleteItem,
  parseShelfLifeHours,
  createPrintJob,
  listPendingPrintJobs,
  markPrintJobDone,
  listRecentPrintJobs,
  ITEMS_PATH,
  PRINT_JOBS_PATH,
};
