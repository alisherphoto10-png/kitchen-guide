const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SECTIONS_PATH = path.join(DATA_DIR, "sections.json");
const DISHES_PATH = path.join(DATA_DIR, "dishes.json");
const STATUSES_PATH = path.join(DATA_DIR, "statuses.json");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");

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
// Один уровень вложенности: раздел (parentId: null) может содержать
// подразделы (parentId: <id раздела>). Подраздел не может сам иметь
// подразделы — при создании подраздела parentId родителя игнорируется
// (см. addSection). Блюдо может быть заведено и прямо в раздел с
// подразделами (просто не попадёт ни в один из них), и в сам подраздел —
// оба варианта равноправны.

function addSection({ name, icon, parentId }) {
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
  };
  sections.push(section);
  writeSections(sections);
  return section;
}

function updateSection(id, patch) {
  const sections = readSections();
  const section = sections.find((s) => s.id === id);
  if (!section) return null;
  if (patch.name !== undefined) section.name = patch.name.trim();
  if (patch.icon !== undefined) section.icon = patch.icon;
  if (patch.order !== undefined) section.order = patch.order;
  writeSections(sections);
  return section;
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

// orderedIds — id ОДНОЙ группы «родных» разделов (сиблингов с одним
// parentId) — так вызывает админка (пересобирает список внутри одного
// уровня и шлёт его целиком). Порядок между разными родителями не имеет
// значения, важен только внутри своей группы.
function reorderSections(orderedIds) {
  const sections = readSections();
  orderedIds.forEach((id, i) => {
    const s = sections.find((x) => x.id === id);
    if (s) s.order = i + 1;
  });
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

module.exports = {
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
};
