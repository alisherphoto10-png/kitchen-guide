const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const ITEMS_PATH = path.join(DATA_DIR, "oko-inventory-items.json");
const MOVEMENTS_PATH = path.join(DATA_DIR, "oko-inventory-movements.json");
const DRAFTS_PATH = path.join(DATA_DIR, "oko-inventory-drafts.json");
const CATEGORIES_PATH = path.join(DATA_DIR, "oko-inventory-categories.json");
const RECOUNTS_PATH = path.join(DATA_DIR, "oko-inventory-recounts.json");
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

// Тот же приём, что и savePhoto(), но из уже готового Buffer — используется
// для фото, скачанных из Telegram (там сразу байты, не data-URI из формы).
function savePhotoBuffer(buffer, ext) {
  ensureDirs();
  const filename = `${makeId()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer);
  return filename;
}

function photoPath(filename) {
  return path.join(PHOTOS_DIR, filename);
}

/**
 * Adds a new catalog item. `initialQty` (if > 0) becomes the item's opening
 * balance — recorded as an ordinary "приход" movement, not a special field
 * on the item — so the running balance is always just "sum of this item's
 * movements", with no separate bookkeeping path. Dated today by default
 * (the normal case: adding a brand-new item via the admin page — its stock
 * really did arrive today); pass `initialQtyDate` to backdate it instead
 * (used by the one-off spreadsheet import, where the opening balance is
 * "as of" a past date, not today — otherwise any period export starting
 * before today would wrongly show 0 as the starting balance and count the
 * whole opening stock as "приход" within the period).
 */
// `photoFilename` — уже сохранённый файл в PHOTOS_DIR (например, скачанный
// из Telegram для черновика) — используется вместо `photo` (data-URI из
// формы), когда создаём позицию из черновика: файл уже на диске, повторно
// сохранять/кодировать его не нужно.
function addItem({ name, size, unit, note, photo, photoFilename, initialQty, initialQtyDate, categoryId }) {
  const items = readItems();
  const nextNumber = items.reduce((max, it) => Math.max(max, it.number || 0), 0) + 1;
  const item = {
    id: makeId(),
    number: nextNumber,
    name: (name || "").trim(),
    size: (size || "").trim(),
    unit: (unit || "шт").trim(),
    note: (note || "").trim(),
    photo: photoFilename || savePhoto(photo),
    categoryId: categoryId || null,
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
      date: initialQtyDate || new Date().toISOString().slice(0, 10),
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
  if (patch.categoryId !== undefined) item.categoryId = patch.categoryId || null;
  if (patch.archived !== undefined) item.archived = !!patch.archived;
  if (patch.photo) {
    deletePhoto(item.photo);
    item.photo = savePhoto(patch.photo);
  }
  writeItems(items);
  return item;
}

// ---------- категории утвари ----------
function readCategories() {
  return readJson(CATEGORIES_PATH, []).sort((a, b) => (a.order || 0) - (b.order || 0));
}
function writeCategories(categories) {
  writeJson(CATEGORIES_PATH, categories);
}
function addCategory(name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Укажите название категории");
  const categories = readCategories();
  const nextOrder = categories.reduce((max, c) => Math.max(max, c.order || 0), 0) + 1;
  const category = { id: makeId(), name: clean, order: nextOrder };
  categories.push(category);
  writeCategories(categories);
  return category;
}
function renameCategory(id, name) {
  const categories = readCategories();
  const category = categories.find((c) => c.id === id);
  if (!category) return null;
  const clean = (name || "").trim();
  if (!clean) throw new Error("Укажите название категории");
  category.name = clean;
  writeCategories(categories);
  return category;
}
// Позиции этой категории не удаляются — переходят в "без категории"
// (categoryId: null), тот же подход, что и с фото/остатками: удаление
// категории — не повод терять сами позиции и их историю движений.
function deleteCategory(id) {
  const categories = readCategories();
  const next = categories.filter((c) => c.id !== id);
  if (next.length === categories.length) return false;
  writeCategories(next);
  const items = readItems();
  let changed = false;
  items.forEach((it) => {
    if (it.categoryId === id) { it.categoryId = null; changed = true; }
  });
  if (changed) writeItems(items);
  return true;
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

function addMovement({ itemId, type, qty, date, note, photo }) {
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
    photo: photo || null,
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
      // Individual движения within the period, oldest first — the export
      // uses this to list причины (приход/списание reasons) per item, not
      // just the aggregated sums above.
      movements: inRange.slice().sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });
}

// ---------- черновики списаний/приходов из Telegram ----------
// Повар кидает фото + подпись в тему — бот угадывает позицию и количество и
// кладёт сюда черновиком (status: "pending"), НЕ трогая остатки сразу:
// подпись — свободный текст, доверять ему вслепую рискованно для реальных
// цифр склада. Подтверждение владельцем в админке (см. oko-inventory-api.js
// /drafts/:id/confirm) — только тогда черновик превращается в обычное
// движение через addMovement() выше.
function readDrafts() {
  return readJson(DRAFTS_PATH, []);
}
function writeDrafts(drafts) {
  writeJson(DRAFTS_PATH, drafts);
}
function addDraft(data) {
  const drafts = readDrafts();
  const draft = {
    id: makeId(),
    status: "pending",
    createdAt: Date.now(),
    chatId: data.chatId,
    threadId: data.threadId || null,
    messageId: data.messageId,
    fromName: data.fromName || "",
    rawText: data.rawText || "",
    photo: data.photo || null,
    direction: data.direction === "приход" ? "приход" : "списание",
    qty: data.qty || null,
    guessedItemId: data.guessedItemId || null,
    guessedItemName: data.guessedItemName || null,
    candidates: Array.isArray(data.candidates) ? data.candidates : [],
    nameGuess: data.nameGuess || "",
    botReplyMessageId: null,
  };
  drafts.push(draft);
  writeDrafts(drafts);
  return draft;
}
function updateDraft(id, patch) {
  const drafts = readDrafts();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return null;
  Object.assign(draft, patch);
  writeDrafts(drafts);
  return draft;
}
function listPendingDrafts() {
  return readDrafts()
    .filter((d) => d.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- пересчёт утвари (полная физическая инвентаризация) ----------
// Отдельный флоу от черновиков выше: там повар шлёт единичное фото на одно
// движение, тут — разовая сессия, где несколько поваров обходят кухню и
// вбивают фактическое количество по каждой позиции выбранных категорий,
// а результат владелец сверяет с тем, что должно быть по системе, и сам
// решает, принимать ли расхождение (см. /recount/:id/review в API).
// Доступ у поваров — не по паролю админки, а по непубличной ссылке с
// токеном (см. createOkoInventoryCountRouter в API) — отсюда crypto для
// токена, а не обычный makeId().
function readRecounts() {
  return readJson(RECOUNTS_PATH, []);
}
function writeRecounts(recounts) {
  writeJson(RECOUNTS_PATH, recounts);
}

// Разом активна только одна сессия — второй "Начать пересчёт" молча
// закрывает предыдущую, если её забыли закрыть, вместо того чтобы плодить
// параллельные несовместимые сессии на одних и тех же позициях.
function createRecountSession({ categoryIds, validFrom, validUntil }) {
  const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
  if (!ids.length) throw new Error("Выберите хотя бы одну категорию");
  const recounts = readRecounts();
  recounts.forEach((s) => {
    if (!s.closedAt) s.closedAt = Date.now();
  });
  const today = new Date().toISOString().slice(0, 10);
  const session = {
    id: makeId(),
    token: crypto.randomBytes(16).toString("hex"),
    createdAt: Date.now(),
    categoryIds: ids,
    validFrom: validFrom || today,
    validUntil: validUntil || today,
    closedAt: null,
    entries: {},
  };
  recounts.push(session);
  writeRecounts(recounts);
  return session;
}

function getLatestRecountSession() {
  const recounts = readRecounts();
  return recounts.length ? recounts[recounts.length - 1] : null;
}

function getRecountByToken(token) {
  return readRecounts().find((s) => s.token === token) || null;
}

// Окно действия ссылки для поваров — отдельно от closedAt (владелец может
// закрыть сессию досрочно вручную) и отдельно от "сессия вообще активна
// для админки" (там она видна и после закрытия — пока не сверена).
function recountIsOpenForCooks(session) {
  if (!session || session.closedAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  return today >= session.validFrom && today <= session.validUntil;
}

function recountEligibleCount(categoryIds) {
  const ids = Array.isArray(categoryIds) ? categoryIds : [];
  return readItems().filter((it) => !it.archived && ids.includes(it.categoryId)).length;
}

// Список для экрана повара — сознательно БЕЗ текущего остатка по системе:
// иначе повар просто перепишет "сколько должно быть" вместо того, чтобы
// реально пересчитать. Видно только факт — посчитано или нет, и кем.
function recountCountList(session) {
  const items = readItems().filter((it) => !it.archived && session.categoryIds.includes(it.categoryId));
  return items.map((it) => {
    const entry = session.entries[it.id];
    return {
      id: it.id,
      number: it.number,
      name: it.name,
      photo: it.photo,
      unit: it.unit,
      categoryId: it.categoryId,
      counted: !!entry,
      countedQty: entry ? entry.qty : null,
      countedBy: entry ? entry.by : null,
      countedAt: entry ? entry.at : null,
    };
  });
}

function recordRecountEntry(sessionId, itemId, qty, by) {
  const recounts = readRecounts();
  const session = recounts.find((s) => s.id === sessionId);
  if (!session) return null;
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 0) throw new Error("Количество должно быть неотрицательным числом");
  const entry = { qty: n, by: (by || "").trim() || "Без имени", at: Date.now(), accepted: false, acceptedAt: null };
  session.entries[itemId] = entry;
  writeRecounts(recounts);
  return entry;
}

function closeRecountSession(id) {
  const recounts = readRecounts();
  const session = recounts.find((s) => s.id === id);
  if (!session) return null;
  session.closedAt = Date.now();
  writeRecounts(recounts);
  return session;
}

// Сводка для админки, пока сессия открыта — прогресс по категориям и лента
// последних записей (кто что вбил), тот же общий список позиций, что и
// recountCountList(), просто ещё и с разбивкой по категориям.
function recountAdminView(id) {
  const session = readRecounts().find((s) => s.id === id);
  if (!session) return null;
  const categoriesById = new Map(readCategories().map((c) => [c.id, c]));
  const items = readItems().filter((it) => !it.archived && session.categoryIds.includes(it.categoryId));

  const byCategory = new Map();
  session.categoryIds.forEach((cid) => {
    const cat = categoriesById.get(cid);
    byCategory.set(cid, { id: cid, name: cat ? cat.name : "?", total: 0, counted: 0 });
  });
  items.forEach((it) => {
    const bucket = byCategory.get(it.categoryId);
    if (!bucket) return;
    bucket.total += 1;
    if (session.entries[it.id]) bucket.counted += 1;
  });

  const activity = Object.entries(session.entries)
    .map(([itemId, entry]) => {
      const item = items.find((it) => it.id === itemId);
      return { itemId, itemName: item ? item.name : "(позиция удалена)", qty: entry.qty, by: entry.by, at: entry.at };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);

  return {
    id: session.id,
    token: session.token,
    createdAt: session.createdAt,
    categoryIds: session.categoryIds,
    validFrom: session.validFrom,
    validUntil: session.validUntil,
    closedAt: session.closedAt,
    openForCooks: recountIsOpenForCooks(session),
    totalItems: items.length,
    countedItems: items.filter((it) => session.entries[it.id]).length,
    categories: Array.from(byCategory.values()),
    activity,
  };
}

// Сверка после закрытия сессии — для каждой посчитанной позиции: что
// должно быть по системе сейчас (balanceAsOf по всем движениям, включая
// те, что случились уже после подсчёта — на случай если владелец успел
// что-то провести за это время), что насчитали, и разница.
function recountReview(id) {
  const session = readRecounts().find((s) => s.id === id);
  if (!session) return null;
  const byItem = movementsByItem();
  const itemsById = new Map(readItems().map((it) => [it.id, it]));
  const rows = Object.entries(session.entries)
    .map(([itemId, entry]) => {
      const item = itemsById.get(itemId);
      if (!item) return null; // позицию удалили после подсчёта — пропускаем
      const expected = balanceAsOf(byItem[itemId] || [], null);
      return {
        itemId,
        item: { id: item.id, number: item.number, name: item.name, photo: item.photo, unit: item.unit, categoryId: item.categoryId },
        expected,
        counted: entry.qty,
        diff: entry.qty - expected,
        by: entry.by,
        at: entry.at,
        accepted: entry.accepted,
        acceptedAt: entry.acceptedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.item.number - b.item.number);
  return { session, rows };
}

// Расхождение != 0 становится обычным корректирующим движением (та же
// addMovement(), что и ручной приход/списание в админке) — остаток не
// трогается, пока это не подтверждено явным "Принять", чтобы случайный
// или заведомо неверный подсчёт не испортил остатки молча.
// `qtyOverride` — владелец правит то, что реально вбил повар (опечатка,
// повар написал не то и предупредил и т.п.), прямо перед принятием, без
// отдельного шага "сохранить" — записывается в entry.qty здесь же.
function acceptRecountEntry(sessionId, itemId, reason, qtyOverride) {
  const recounts = readRecounts();
  const session = recounts.find((s) => s.id === sessionId);
  if (!session) return null;
  const entry = session.entries[itemId];
  if (!entry) return null;
  const item = readItems().find((it) => it.id === itemId);
  if (!item) return null;

  if (qtyOverride !== undefined && qtyOverride !== null && qtyOverride !== "") {
    const overrideN = Number(qtyOverride);
    if (!Number.isFinite(overrideN) || overrideN < 0) {
      throw new Error("Количество должно быть неотрицательным числом");
    }
    entry.qty = overrideN;
  }

  const expected = balanceAsOf(movementsByItem()[itemId] || [], null);
  const diff = entry.qty - expected;
  let movement = null;
  if (diff !== 0) {
    movement = addMovement({
      itemId,
      type: diff > 0 ? "приход" : "списание",
      qty: Math.abs(diff),
      note: ["Корректировка по пересчёту", (reason || "").trim()].filter(Boolean).join(" — "),
    });
  }
  entry.accepted = true;
  entry.acceptedAt = Date.now();
  writeRecounts(recounts);
  return { entry, movement };
}

// Массово принять только то, что и так совпало — расхождения по-прежнему
// требуют явного решения по каждой позиции (см. acceptRecountEntry).
function acceptAllMatchingRecountEntries(sessionId) {
  const recounts = readRecounts();
  const session = recounts.find((s) => s.id === sessionId);
  if (!session) return null;
  const byItem = movementsByItem();
  let count = 0;
  Object.entries(session.entries).forEach(([itemId, entry]) => {
    if (entry.accepted) return;
    const expected = balanceAsOf(byItem[itemId] || [], null);
    if (entry.qty === expected) {
      entry.accepted = true;
      entry.acceptedAt = Date.now();
      count += 1;
    }
  });
  writeRecounts(recounts);
  return { count };
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
  savePhotoBuffer,
  readCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  readDrafts,
  addDraft,
  updateDraft,
  listPendingDrafts,
  createRecountSession,
  getLatestRecountSession,
  getRecountByToken,
  recountIsOpenForCooks,
  recountEligibleCount,
  recountCountList,
  recordRecountEntry,
  closeRecountSession,
  recountAdminView,
  recountReview,
  acceptRecountEntry,
  acceptAllMatchingRecountEntries,
  PHOTOS_DIR,
  ITEMS_PATH,
  MOVEMENTS_PATH,
  DRAFTS_PATH,
  RECOUNTS_PATH,
};
