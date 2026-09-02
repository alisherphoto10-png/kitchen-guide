const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ITEMS_PATH = path.join(DATA_DIR, "oko-inventory-items.json");
const MOVEMENTS_PATH = path.join(DATA_DIR, "oko-inventory-movements.json");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
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

function readItems() {
  return readJson(ITEMS_PATH, []);
}

function writeItems(items) {
  writeJson(ITEMS_PATH, items);
}

function readMovements() {
  return readJson(MOVEMENTS_PATH, []);
}

function writeMovements(movements) {
  writeJson(MOVEMENTS_PATH, movements);
}

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Photos are saved as plain files on disk (not inlined in the JSON record) —
// keeps oko-inventory-items.json small and readable even with 200+ items.
// dataUri looks like "data:image/jpeg;base64,...."; returns the filename to
// store on the item record (or null if no photo was given).
function savePhoto(dataUri) {
  if (!dataUri) return null;
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUri);
  if (!match) return null;
  ensureDirs();
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const filename = `${makeId()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(match[2], "base64"));
  return filename;
}

function deletePhoto(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(PHOTOS_DIR, filename));
  } catch {
    // already gone — fine
  }
}

function photoPath(filename) {
  return path.join(PHOTOS_DIR, filename);
}

/**
 * Adds a new catalog item. `initialQty` (if > 0) becomes the item's opening
 * balance — recorded as an ordinary "приход" movement dated today, not a
 * special field on the item — so the running balance is always just
 * "sum of this item's movements", with no separate bookkeeping path.
 */
function addItem({ name, size, unit, note, photo, initialQty }) {
  const items = readItems();
  const nextNumber = items.reduce((max, it) => Math.max(max, it.number || 0), 0) + 1;
  const item = {
    id: makeId(),
    number: nextNumber,
    name: (name || "").trim(),
    size: (size || "").trim(),
    unit: (unit || "шт").trim(),
    note: (note || "").trim(),
    photo: savePhoto(photo),
    archived: false,
    createdAt: Date.now(),
  };
  items.push(item);
  writeItems(items);

  const qty = Number(initialQty);
  if (qty > 0) {
    addMovement({
      itemId: item.id,
      type: "приход",
      qty,
      date: new Date().toISOString().slice(0, 10),
      note: "начальный остаток",
    });
  }
  return item;
}

function updateItem(id, patch) {
  const items = readItems();
  const item = items.find((it) => it.id === id);
  if (!item) return null;
  if (patch.name !== undefined) item.name = patch.name.trim();
  if (patch.size !== undefined) item.size = patch.size.trim();
  if (patch.unit !== undefined) item.unit = patch.unit.trim();
  if (patch.note !== undefined) item.note = patch.note.trim();
  if (patch.archived !== undefined) item.archived = !!patch.archived;
  if (patch.photo) {
    deletePhoto(item.photo);
    item.photo = savePhoto(patch.photo);
  }
  writeItems(items);
  return item;
}

function deleteItem(id) {
  const items = readItems();
  const item = items.find((it) => it.id === id);
  if (!item) return false;
  deletePhoto(item.photo);
  writeItems(items.filter((it) => it.id !== id));
  const movements = readMovements();
  writeMovements(movements.filter((m) => m.itemId !== id));
  return true;
}

function addMovement({ itemId, type, qty, date, note }) {
  if (type !== "приход" && type !== "списание") {
    throw new Error("type должен быть 'приход' или 'списание'");
  }
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Количество должно быть положительным числом");
  }
  const movements = readMovements();
  const movement = {
    id: makeId(),
    itemId,
    type,
    qty: n,
    date: date || new Date().toISOString().slice(0, 10),
    note: (note || "").trim(),
    createdAt: Date.now(),
  };
  movements.push(movement);
  writeMovements(movements);
  return movement;
}

function deleteMovement(id) {
  const movements = readMovements();
  const next = movements.filter((m) => m.id !== id);
  if (next.length === movements.length) return false;
  writeMovements(next);
  return true;
}

// Signed sum of an item's movements up to and including `onOrBeforeDate`
// (YYYY-MM-DD, inclusive) — приход adds, списание subtracts. Used both for
// "current balance" (no date limit) and for period exports (balance as of
// the day before a period started / the last day of a period).
function balanceAsOf(itemMovements, onOrBeforeDate) {
  return itemMovements.reduce((sum, m) => {
    if (onOrBeforeDate && m.date > onOrBeforeDate) return sum;
    return sum + (m.type === "приход" ? m.qty : -m.qty);
  }, 0);
}

function movementsByItem() {
  const byItem = {};
  readMovements().forEach((m) => {
    if (!byItem[m.itemId]) byItem[m.itemId] = [];
    byItem[m.itemId].push(m);
  });
  return byItem;
}

/**
 * Items with their current running balance and recent movement history —
 * what the admin page's list renders.
 */
function listItemsWithBalance() {
  const byItem = movementsByItem();
  return readItems().map((item) => {
    const movements = (byItem[item.id] || []).sort((a, b) => (a.date < b.date ? 1 : -1));
    return { ...item, balance: balanceAsOf(movements, null), movements };
  });
}

/**
 * Per-item breakdown for a date range [from, to] (both YYYY-MM-DD,
 * inclusive) — exactly the columns the original spreadsheet tracked:
 * remainder at the start of the period, приход/списание within it, and the
 * remainder at the end.
 */
function reportForPeriod(from, to) {
  const byItem = movementsByItem();
  const dayBeforeFrom = new Date(from);
  dayBeforeFrom.setDate(dayBeforeFrom.getDate() - 1);
  const dayBeforeFromStr = dayBeforeFrom.toISOString().slice(0, 10);

  return readItems().map((item) => {
    const movements = byItem[item.id] || [];
    const startBalance = balanceAsOf(movements, dayBeforeFromStr);
    const inRange = movements.filter((m) => m.date >= from && m.date <= to);
    const income = inRange.filter((m) => m.type === "приход").reduce((s, m) => s + m.qty, 0);
    const writeOff = inRange.filter((m) => m.type === "списание").reduce((s, m) => s + m.qty, 0);
    return {
      item,
      startBalance,
      income,
      writeOff,
      endBalance: startBalance + income - writeOff,
    };
  });
}

module.exports = {
  readItems,
  addItem,
  updateItem,
  deleteItem,
  addMovement,
  deleteMovement,
  listItemsWithBalance,
  reportForPeriod,
  photoPath,
  PHOTOS_DIR,
  ITEMS_PATH,
  MOVEMENTS_PATH,
};
