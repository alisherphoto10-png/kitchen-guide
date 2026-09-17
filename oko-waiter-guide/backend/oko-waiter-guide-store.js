const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "data");
const SECTIONS_PATH = path.join(DATA_DIR, "sections.json");
const DISHES_PATH = path.join(DATA_DIR, "dishes.json");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const FEEDBACK_PATH = path.join(DATA_DIR, "feedback.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const ACTIVITY_PATH = path.join(DATA_DIR, "activity.json");
const STATUSES_PATH = path.join(DATA_DIR, "statuses.json");
const GUIDE_VIEWS_PATH = path.join(DATA_DIR, "guide-views.json");
const ANNOUNCEMENT_PATH = path.join(DATA_DIR, "announcement.json");
const FRONTEND_DIR = "/home/kitchendesk/frontend/waiter-guide";

// Список статусов ("Хит", "Популярное", ...) — управляемый, не зашит в код.
// При первом обращении, если файла ещё нет, заводим эти два с ФИКСИРОВАННЫМИ
// id "hit"/"popular" — именно эти строки уже могли осесть в поле
// dish.status у блюд, заведённых до того, как статусы стали редактируемыми,
// так что старые блюда продолжают находить свой статус без миграции.
const DEFAULT_STATUSES = [
  { id: "hit", emoji: "🔥", label: "Хит", order: 1 },
  { id: "popular", emoji: "🌟", label: "Популярное", order: 2 },
];

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

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- slugs ----------
// Не хранятся в файле — вычисляются на лету из имени + id при каждом чтении.
// Так надёжнее: слаг НИКОГДА не может рассинхронизироваться с данными
// (переименовали блюдо — слаг в тот же момент пересчитался везде разом),
// а стабильность (один и тот же URL у блюда между запросами) обеспечивает
// то, что вход — само имя плюс неизменный id, и порядок обработки списка
// всегда один и тот же (по id).
const CYR_TO_LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function translit(str) {
  return String(str || "")
    .toLowerCase()
    .split("")
    .map((ch) => (CYR_TO_LAT[ch] !== undefined ? CYR_TO_LAT[ch] : ch))
    .join("");
}
function slugBase(name) {
  const s = translit(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}
// reserved: слаги, которые нельзя отдать блюду/разделу, потому что заняты
// служебным маршрутом (например "all" — псевдораздел «Все блюда»).
function assignSlugs(items, reserved) {
  const taken = new Set(reserved || []);
  const sorted = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bySlug = new Map();
  for (const item of sorted) {
    const base = slugBase(item.name);
    let candidate = base;
    if (taken.has(candidate)) candidate = `${base}-${String(item.id).slice(-4)}`;
    if (taken.has(candidate)) candidate = `${base}-${item.id}`;
    taken.add(candidate);
    bySlug.set(item.id, candidate);
  }
  return bySlug;
}

function readSections() {
  return readJson(SECTIONS_PATH, []);
}
function writeSections(sections) {
  writeJson(SECTIONS_PATH, sections);
}
function readDishes() {
  return readJson(DISHES_PATH, []);
}
function writeDishes(dishes) {
  writeJson(DISHES_PATH, dishes);
}

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
    // already gone
  }
}

// Приводит загруженное изображение (в любом размере/ориентации) к рабочему
// виду — автоповорот по EXIF, разумный размер, пережатие в JPEG. Даёт
// владельцу "загрузил и всё" — не нужно самому обрезать/сжимать фото.
async function processImageBuffer(dataUri, { maxDim, quality = 82, flattenBlack = false }) {
  if (!dataUri) return null;
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUri);
  if (!match) return null;
  let img = sharp(Buffer.from(match[2], "base64")).rotate();
  if (flattenBlack) img = img.flatten({ background: "#000000" });
  img = img.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
  return img.jpeg({ quality }).toBuffer();
}

async function saveProcessedPhoto(dataUri, opts) {
  const buf = await processImageBuffer(dataUri, opts);
  if (!buf) return null;
  ensureDirs();
  const filename = `${makeId()}.jpg`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), buf);
  return filename;
}

function saveStaticImage(buffer, absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);
}
function photoPath(filename) {
  return path.join(PHOTOS_DIR, filename);
}

// Старые блюда/разделы (до этого обновления) хранят фото в одиночном поле
// `photo` и фразу подачи в `howToServe` — эти геттеры читают оба варианта,
// не трогая файл на диске, так что ничего не нужно мигрировать разово.
function dishPhotos(dish) {
  if (Array.isArray(dish.photos) && dish.photos.length) return dish.photos;
  return dish.photo ? [dish.photo] : [];
}
function dishWaiterPhrase(dish) {
  return dish.waiterPhrase !== undefined ? dish.waiterPhrase : dish.howToServe || "";
}

// ---------- sections ----------

// "group" разделяет разделы по цеху (кухня/бар) для ограниченного доступа
// бар-аккаунта — отсутствие поля у старых разделов трактуется как "kitchen"
// (sectionGroup() ниже), так что существующие данные ничего не потеряли.
//
// Один уровень вложенности: раздел (parentId: null) может содержать
// подразделы (parentId: <id раздела>). Подраздел не может сам иметь
// подразделы — при создании подраздела parentId родителя игнорируется (см.
// ниже). Блюдо может быть заведено и прямо в раздел с подразделами (просто
// не попадёт ни в один из них), и в сам подраздел — оба варианта равноправны.
function addSection({ name, icon, group, parentId, note }) {
  const sections = readSections();
  // Подраздел у подраздела не бывает — если parentId указывает на что-то,
  // что само уже подраздел, кладём на верхний уровень его родителя.
  let resolvedParentId = parentId || null;
  if (resolvedParentId) {
    const parent = sections.find((s) => s.id === resolvedParentId);
    if (!parent) resolvedParentId = null;
    else if (parent.parentId) resolvedParentId = parent.parentId;
  }
  const siblings = sections.filter((s) => (s.parentId || null) === resolvedParentId);
  const nextOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0) + 1;
  const section = {
    id: makeId(),
    parentId: resolvedParentId,
    name: (name || "").trim(),
    icon: icon || "",
    order: nextOrder,
    group: group === "bar" ? "bar" : "kitchen",
    // Текстовый блок-объявление — показывается официанту наверху списка,
    // когда он открывает именно этот раздел/подраздел. Пусто — ничего не
    // показывается, никакой заглушки (например: "эти блюда уже утверждены,
    // но меню ещё не запущено — можно изучать заранее").
    note: (note || "").trim(),
  };
  sections.push(section);
  writeSections(sections);
  return section;
}

async function updateSection(id, patch) {
  const sections = readSections();
  const section = sections.find((s) => s.id === id);
  if (!section) return null;
  if (patch.name !== undefined) section.name = patch.name.trim();
  if (patch.icon !== undefined) section.icon = patch.icon;
  if (patch.order !== undefined) section.order = patch.order;
  if (patch.group !== undefined) section.group = patch.group === "bar" ? "bar" : "kitchen";
  if (patch.note !== undefined) section.note = patch.note.trim();
  if (patch.removePhoto) {
    deletePhoto(section.photo);
    section.photo = "";
  } else if (patch.photo !== undefined) {
    const filename = await saveProcessedPhoto(patch.photo, { maxDim: 900 });
    if (filename) {
      deletePhoto(section.photo);
      section.photo = filename;
    }
  }
  writeSections(sections);
  return section;
}

function sectionGroup(section) {
  return section && section.group === "bar" ? "bar" : "kitchen";
}

function deleteSection(id) {
  const sections = readSections();
  const section = sections.find((s) => s.id === id);
  if (!section) return false;
  // Подразделы удаляемого раздела не удаляются — становятся разделами
  // верхнего уровня сами по себе (проще и безопаснее, чем каскадно
  // удалять их блюда).
  sections.forEach((s) => { if (s.parentId === id) s.parentId = null; });
  writeSections(sections.filter((s) => s.id !== id));
  // Dishes in a deleted section become orphaned rather than silently
  // vanishing — the admin page surfaces them under "Без раздела" so nothing
  // is lost, just needs re-filing.
  return true;
}

// orderedIds может быть ЧАСТЬЮ всех разделов (например, бар-доступ
// переставляет только свои барные разделы) — вместо того чтобы просто
// пронумеровать переданный список 1..N (что перемешало бы его с чужими
// разделами кухни, которые делят с ним одно общее поле order), сохраняем
// позиции, которые эти разделы УЖЕ занимали в общем списке, и просто
// переставляем сами разделы внутри этих позиций в новом порядке — разделы,
// не упомянутые в orderedIds, остаются на своих местах как были.
function reorderSections(orderedIds) {
  const sections = readSections().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const idSet = new Set(orderedIds);
  const slots = [];
  sections.forEach((s, i) => { if (idSet.has(s.id)) slots.push(i); });
  const byId = new Map(sections.map((s) => [s.id, s]));
  slots.forEach((slotIndex, k) => {
    const id = orderedIds[k];
    if (id !== undefined && byId.has(id)) sections[slotIndex] = byId.get(id);
  });
  sections.forEach((s, i) => { s.order = i + 1; });
  writeSections(sections);
}

// ---------- statuses ----------

function readStatuses() {
  if (!fs.existsSync(STATUSES_PATH)) {
    writeJson(STATUSES_PATH, DEFAULT_STATUSES);
    return DEFAULT_STATUSES.slice();
  }
  return readJson(STATUSES_PATH, DEFAULT_STATUSES.slice());
}
function writeStatuses(statuses) {
  writeJson(STATUSES_PATH, statuses);
}

function addStatus({ emoji, label }) {
  const statuses = readStatuses();
  const nextOrder = statuses.reduce((max, s) => Math.max(max, s.order || 0), 0) + 1;
  const status = { id: makeId(), emoji: (emoji || "").trim(), label: (label || "").trim(), order: nextOrder };
  statuses.push(status);
  writeStatuses(statuses);
  return status;
}

function updateStatus(id, patch) {
  const statuses = readStatuses();
  const status = statuses.find((s) => s.id === id);
  if (!status) return null;
  if (patch.emoji !== undefined) status.emoji = patch.emoji.trim();
  if (patch.label !== undefined) status.label = patch.label.trim();
  writeStatuses(statuses);
  return status;
}

function deleteStatus(id) {
  const statuses = readStatuses();
  const status = statuses.find((s) => s.id === id);
  if (!status) return false;
  writeStatuses(statuses.filter((s) => s.id !== id));
  // Блюда, у которых был именно этот статус, не остаются со ссылкой в
  // никуда — статус у них просто снимается (как «— нет статуса —»).
  const dishes = readDishes();
  let touched = false;
  dishes.forEach((d) => { if (d.status === id) { d.status = ""; touched = true; } });
  if (touched) writeDishes(dishes);
  return true;
}

function reorderStatuses(orderedIds) {
  const statuses = readStatuses();
  orderedIds.forEach((id, i) => {
    const s = statuses.find((x) => x.id === id);
    if (s) s.order = i + 1;
  });
  writeStatuses(statuses);
}

// ---------- dishes ----------

/**
 * calcTables: array of { label, rows: [{ name, unit, amount }] } — a dish
 * can have more than one table (e.g. a base component plus a side/sauce
 * table), matching how the original handbook laid out composite dishes.
 * Doubles as the "Состав" tab's ingredient groups from the ТЗ.
 */
function addDish(input) {
  const dishes = readDishes();
  const siblings = dishes.filter((d) => d.sectionId === input.sectionId);
  const nextOrder = siblings.reduce((max, d) => Math.max(max, d.order || 0), 0) + 1;
  const dish = {
    id: makeId(),
    sectionId: input.sectionId || null,
    order: nextOrder,
    name: (input.name || "").trim(),
    subtitle: (input.subtitle || "").trim(),
    description: (input.description || "").trim(),
    history: (input.history || "").trim(),
    historyQuote: (input.historyQuote || "").trim(),
    status: input.status || "",
    servingSteps: Array.isArray(input.servingSteps) ? input.servingSteps.filter(Boolean) : [],
    waiterPhrase: (input.waiterPhrase || input.howToServe || "").trim(),
    calcTables: Array.isArray(input.calcTables) ? input.calcTables : [],
    photos: input.photo ? [savePhoto(input.photo)].filter(Boolean) : [],
    allergens: Array.isArray(input.allergens) ? input.allergens.filter(Boolean) : [],
    features: Array.isArray(input.features) ? input.features.filter(Boolean) : [],
    recommendations: Array.isArray(input.recommendations) ? input.recommendations.filter(Boolean) : [],
    warning: (input.warning || "").trim(),
    faq: Array.isArray(input.faq) ? input.faq.filter((f) => f && f.question) : [],
    hidden: Boolean(input.hidden),
    createdAt: Date.now(),
  };
  dishes.push(dish);
  writeDishes(dishes);
  return dish;
}

function updateDish(id, patch) {
  const dishes = readDishes();
  const dish = dishes.find((d) => d.id === id);
  if (!dish) return null;
  if (patch.sectionId !== undefined) dish.sectionId = patch.sectionId;
  if (patch.name !== undefined) dish.name = patch.name.trim();
  if (patch.subtitle !== undefined) dish.subtitle = patch.subtitle.trim();
  if (patch.description !== undefined) dish.description = patch.description.trim();
  if (patch.history !== undefined) dish.history = patch.history.trim();
  if (patch.historyQuote !== undefined) dish.historyQuote = patch.historyQuote.trim();
  if (patch.status !== undefined) dish.status = patch.status;
  if (patch.servingSteps !== undefined) dish.servingSteps = patch.servingSteps.filter(Boolean);
  if (patch.waiterPhrase !== undefined) dish.waiterPhrase = patch.waiterPhrase.trim();
  else if (patch.howToServe !== undefined) dish.waiterPhrase = patch.howToServe.trim();
  if (patch.calcTables !== undefined) dish.calcTables = patch.calcTables;
  if (patch.allergens !== undefined) dish.allergens = patch.allergens.filter(Boolean);
  if (patch.features !== undefined) dish.features = patch.features.filter(Boolean);
  if (patch.recommendations !== undefined) dish.recommendations = patch.recommendations.filter(Boolean);
  if (patch.warning !== undefined) dish.warning = patch.warning.trim();
  if (patch.faq !== undefined) dish.faq = patch.faq.filter((f) => f && f.question);
  if (patch.hidden !== undefined) dish.hidden = Boolean(patch.hidden);
  if (patch.order !== undefined) dish.order = patch.order;

  // Фото — теперь массив (несколько на блюдо). Одно сохранение формы может
  // добавить одно новое фото и/или удалить одно по индексу — этого хватает
  // для формы админки (кладём файлы по одному, как и раньше).
  if (!Array.isArray(dish.photos)) dish.photos = dish.photo ? [dish.photo] : [];
  if (patch.removePhotoIndex !== undefined && patch.removePhotoIndex !== null) {
    const idx = Number(patch.removePhotoIndex);
    if (dish.photos[idx]) {
      deletePhoto(dish.photos[idx]);
      dish.photos.splice(idx, 1);
    }
  }
  if (patch.addPhoto) {
    const filename = savePhoto(patch.addPhoto);
    if (filename) dish.photos.push(filename);
  }
  // Обратная совместимость со старой формой (одно фото на блюдо).
  if (patch.photo) {
    dish.photos.forEach(deletePhoto);
    dish.photos = [savePhoto(patch.photo)].filter(Boolean);
  }
  if (patch.removePhoto) {
    dish.photos.forEach(deletePhoto);
    dish.photos = [];
  }
  // Переупорядочивание (в т.ч. "сделать главным" = переставить на индекс 0 —
  // отдельного флага для главного фото нет, весь код уже читает photos[0]
  // как основное). Принимаем только перестановку УЖЕ существующего набора
  // файлов — никакие новые имена через этот путь не появляются и не исчезают.
  if (Array.isArray(patch.photosOrder)) {
    const current = new Set(dish.photos);
    const requested = patch.photosOrder.filter((name) => current.has(name));
    const isSameSet = requested.length === dish.photos.length && new Set(requested).size === current.size;
    if (isSameSet) dish.photos = requested;
  }
  delete dish.photo; // поле больше не используется отдельно от массива

  writeDishes(dishes);
  return dish;
}

function deleteDish(id) {
  const dishes = readDishes();
  const dish = dishes.find((d) => d.id === id);
  if (!dish) return false;
  dishPhotos(dish).forEach(deletePhoto);
  writeDishes(dishes.filter((d) => d.id !== id));
  return true;
}

function reorderDishes(orderedIds) {
  const dishes = readDishes();
  orderedIds.forEach((id, i) => {
    const d = dishes.find((x) => x.id === id);
    if (d) d.order = i + 1;
  });
  writeDishes(dishes);
}

function shapeDish(dish, slug) {
  return {
    id: dish.id,
    slug,
    sectionId: dish.sectionId,
    order: dish.order || 0,
    name: dish.name,
    subtitle: dish.subtitle || "",
    description: dish.description || "",
    history: dish.history || "",
    historyQuote: dish.historyQuote || "",
    status: dish.status || "",
    photos: dishPhotos(dish),
    servingSteps: dish.servingSteps || [],
    waiterPhrase: dishWaiterPhrase(dish),
    calcTables: dish.calcTables || [],
    allergens: dish.allergens || [],
    features: dish.features || [],
    recommendations: dish.recommendations || [],
    warning: dish.warning || "",
    faq: dish.faq || [],
    hidden: Boolean(dish.hidden),
  };
}

// Full structured guide — sections in order, each with its dishes in
// order, slugs computed. Used both by the admin page and the public
// read-only page (public callers should use getGuide(), which additionally
// drops hidden dishes and empty-after-filtering sections stay — an empty
// section is still shown, it's just an editorial choice, not a bug).
function getGuideAll() {
  const sections = readSections().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const dishes = readDishes();
  const sectionSlugs = assignSlugs(sections, ["all"]);
  const dishSlugs = assignSlugs(dishes, []);
  return sections.map((section) => ({
    ...section,
    slug: sectionSlugs.get(section.id),
    dishes: dishes
      .filter((d) => d.sectionId === section.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((d) => shapeDish(d, dishSlugs.get(d.id))),
  }));
}

function getGuide() {
  return getGuideAll()
    .map((section) => ({ ...section, dishes: section.dishes.filter((d) => !d.hidden) }));
}

// Разделы со слагами — то, что нужно и админке (чтобы показать ссылку на
// категорию), и публичной странице (для маршрутов /category/:slug).
function getSectionsShaped() {
  const sections = readSections().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const sectionSlugs = assignSlugs(sections, ["all"]);
  return sections.map((s) => ({ ...s, slug: sectionSlugs.get(s.id) }));
}

// Все блюда (включая скрытые) со слагами и развёрнутым массивом фото — то,
// что нужно админке для списка/формы редактирования. В отличие от
// getGuide()/getGuideAll(), не группирует по разделам.
function getAllDishesShaped() {
  const dishes = readDishes();
  const dishSlugs = assignSlugs(dishes, []);
  return dishes.map((d) => shapeDish(d, dishSlugs.get(d.id)));
}

function getOrphanDishes() {
  const sectionIds = new Set(readSections().map((s) => s.id));
  const dishes = readDishes();
  const dishSlugs = assignSlugs(dishes, []);
  return dishes.filter((d) => !d.sectionId || !sectionIds.has(d.sectionId)).map((d) => shapeDish(d, dishSlugs.get(d.id)));
}

// ---------- feedback ----------
// Простой append-лог отзывов официантов — страховка на случай, если
// отправка в Telegram не удалась (бот недоступен и т.п.), чтобы отзыв не
// потерялся молча. Не показывается нигде в UI, только файл на диске.
function addFeedback({ message, dishName, name }) {
  const list = readJson(FEEDBACK_PATH, []);
  list.push({ id: makeId(), message, dishName: dishName || "", name: name || "", createdAt: Date.now() });
  writeJson(FEEDBACK_PATH, list);
}

// ---------- users (именованный персонал: кухня/бар/оба) ----------
// Владелец (X-Admin-Password из .env) сюда не входит — это отдельный слой
// НАЗВАННЫХ учёток, которые владелец сам создаёт для персонала.
function readUsers() {
  return readJson(USERS_PATH, []);
}
function writeUsers(users) {
  writeJson(USERS_PATH, users);
}
function normalizeRole(role) {
  return ["kitchen", "bar", "both"].includes(role) ? role : "kitchen";
}
function shapeUser(u) {
  return { id: u.id, name: u.name, login: u.login, role: normalizeRole(u.role), createdAt: u.createdAt };
}
function findUserByLogin(login) {
  return readUsers().find((u) => u.login === login) || null;
}
function addUser({ name, login, password, role }) {
  const users = readUsers();
  if (users.some((u) => u.login === login)) {
    const err = new Error("Логин уже занят");
    err.code = "LOGIN_TAKEN";
    throw err;
  }
  const user = {
    id: makeId(),
    name: (name || "").trim(),
    login: (login || "").trim(),
    passwordHash: bcrypt.hashSync(String(password || ""), 10),
    role: normalizeRole(role),
    createdAt: Date.now(),
  };
  users.push(user);
  writeUsers(users);
  return shapeUser(user);
}
function updateUser(id, patch) {
  const users = readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  if (patch.login !== undefined) {
    const login = String(patch.login).trim();
    if (users.some((u) => u.id !== id && u.login === login)) {
      const err = new Error("Логин уже занят");
      err.code = "LOGIN_TAKEN";
      throw err;
    }
    user.login = login;
  }
  if (patch.name !== undefined) user.name = patch.name.trim();
  if (patch.role !== undefined) user.role = normalizeRole(patch.role);
  if (patch.password) user.passwordHash = bcrypt.hashSync(String(patch.password), 10);
  writeUsers(users);
  return shapeUser(user);
}
function deleteUser(id) {
  const users = readUsers();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) return false;
  writeUsers(next);
  return true;
}
function verifyUserPassword(login, password) {
  const user = findUserByLogin(login);
  if (!user) return null;
  if (!bcrypt.compareSync(String(password || ""), user.passwordHash)) return null;
  return shapeUser(user);
}

// ---------- activity log (кто что создал/изменил/удалил) ----------
// Append-only, видит только владелец. Без field-level диффов — только
// "кто, что за действие, над каким блюдом/разделом" — ровно то, что просили.
function logActivity({ userId, userName, action, targetName, sectionName }) {
  try {
    const list = readJson(ACTIVITY_PATH, []);
    list.push({
      id: makeId(), at: Date.now(),
      userId: userId || null, userName: userName || "Владелец",
      action, targetName: targetName || "", sectionName: sectionName || "",
    });
    writeJson(ACTIVITY_PATH, list);
  } catch (e) {
    console.error("[oko-waiter-guide] activity log failed:", e.message);
  }
}
function getActivity(limit) {
  const list = readJson(ACTIVITY_PATH, []);
  return list.slice(-(limit || 200)).reverse();
}

// ---------- открытия пособия (анонимный счётчик, без имён и логина) ----------
// Официанты открывают страницу без логина осознанно (см. README) — значит
// узнать, КТО конкретно открыл, нельзя в принципе, не ломая это. Считаем
// только сколько раз и когда — общий счётчик + разбивка по дням, файл не
// растёт бесконечно (старше 90 дней — не храним, "recent" обрезаем).
function logGuideView(pathName) {
  try {
    const data = readJson(GUIDE_VIEWS_PATH, { totalCount: 0, byDay: {}, recent: [] });
    data.totalCount = (data.totalCount || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    data.byDay = data.byDay || {};
    data.byDay[day] = (data.byDay[day] || 0) + 1;
    const days = Object.keys(data.byDay).sort();
    if (days.length > 90) days.slice(0, days.length - 90).forEach((d) => delete data.byDay[d]);
    data.recent = data.recent || [];
    data.recent.push({ path: pathName || "", at: Date.now() });
    if (data.recent.length > 500) data.recent = data.recent.slice(-500);
    writeJson(GUIDE_VIEWS_PATH, data);
  } catch (e) {
    console.error("[oko-waiter-guide] guide view log failed:", e.message);
  }
}
function getGuideViews() {
  return readJson(GUIDE_VIEWS_PATH, { totalCount: 0, byDay: {}, recent: [] });
}

// ---------- уведомление на главном экране (модалка при заходе) ----------
// Официант заходит без логина, толкнуть push напрямую нельзя — вместо этого
// при заходе показывается модалка с текстом от владельца. "id" меняется при
// каждой публикации — клиент помнит в localStorage последний id, на который
// нажали "Хорошо" (навсегда), и сравнивает с текущим; кнопка "Напомнить
// потом" ничего не запоминает, поэтому модалка снова покажется в другой раз.
function readAnnouncement() {
  return readJson(ANNOUNCEMENT_PATH, null);
}
function writeAnnouncement({ title, text }) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    writeJson(ANNOUNCEMENT_PATH, null);
    return null;
  }
  const value = { id: String(Date.now()), title: String(title || "").trim(), text: cleanText, updatedAt: new Date().toISOString() };
  writeJson(ANNOUNCEMENT_PATH, value);
  return value;
}

module.exports = {
  addFeedback,
  sectionGroup,
  addUser,
  updateUser,
  deleteUser,
  readUsers,
  shapeUser,
  verifyUserPassword,
  logActivity,
  getActivity,
  logGuideView,
  getGuideViews,
  readAnnouncement,
  writeAnnouncement,
  readSections,
  addSection,
  updateSection,
  deleteSection,
  reorderSections,
  readDishes,
  addDish,
  updateDish,
  deleteDish,
  reorderDishes,
  getGuide,
  getGuideAll,
  getSectionsShaped,
  getAllDishesShaped,
  getOrphanDishes,
  readStatuses,
  addStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  photoPath,
  PHOTOS_DIR,
  SECTIONS_PATH,
  DISHES_PATH,
  STATUSES_PATH,
  FRONTEND_DIR,
  processImageBuffer,
  saveProcessedPhoto,
  saveStaticImage,
};
