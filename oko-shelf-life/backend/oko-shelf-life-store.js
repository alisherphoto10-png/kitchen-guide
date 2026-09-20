const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ITEMS_PATH = path.join(DATA_DIR, "oko-shelf-life-items.json");

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

module.exports = {
  readItems,
  addItem,
  updateItem,
  deleteItem,
  parseShelfLifeHours,
  ITEMS_PATH,
};
