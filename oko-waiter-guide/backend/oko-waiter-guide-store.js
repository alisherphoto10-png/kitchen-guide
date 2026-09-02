const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SECTIONS_PATH = path.join(DATA_DIR, "sections.json");
const DISHES_PATH = path.join(DATA_DIR, "dishes.json");
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

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

// ---------- sections ----------

function addSection({ name }) {
  const sections = readSections();
  const nextOrder = sections.reduce((max, s) => Math.max(max, s.order || 0), 0) + 1;
  const section = { id: makeId(), name: (name || "").trim(), order: nextOrder };
  sections.push(section);
  writeSections(sections);
  return section;
}

function updateSection(id, patch) {
  const sections = readSections();
  const section = sections.find((s) => s.id === id);
  if (!section) return null;
  if (patch.name !== undefined) section.name = patch.name.trim();
  if (patch.order !== undefined) section.order = patch.order;
  writeSections(sections);
  return section;
}

function deleteSection(id) {
  const sections = readSections();
  const section = sections.find((s) => s.id === id);
  if (!section) return false;
  writeSections(sections.filter((s) => s.id !== id));
  // Dishes in a deleted section become orphaned rather than silently
  // vanishing — the admin page surfaces them under "Без раздела" so nothing
  // is lost, just needs re-filing.
  return true;
}

function reorderSections(orderedIds) {
  const sections = readSections();
  orderedIds.forEach((id, i) => {
    const s = sections.find((x) => x.id === id);
    if (s) s.order = i + 1;
  });
  writeSections(sections);
}

// ---------- dishes ----------

/**
 * calcTables: array of { label, rows: [{ name, unit, amount }] } — a dish
 * can have more than one table (e.g. a base component plus a side/sauce
 * table), matching how the original handbook laid out composite dishes.
 */
function addDish({ sectionId, name, subtitle, description, history, howToServe, calcTables, photo }) {
  const dishes = readDishes();
  const siblings = dishes.filter((d) => d.sectionId === sectionId);
  const nextOrder = siblings.reduce((max, d) => Math.max(max, d.order || 0), 0) + 1;
  const dish = {
    id: makeId(),
    sectionId: sectionId || null,
    order: nextOrder,
    name: (name || "").trim(),
    subtitle: (subtitle || "").trim(),
    description: (description || "").trim(),
    history: (history || "").trim(),
    howToServe: (howToServe || "").trim(),
    calcTables: Array.isArray(calcTables) ? calcTables : [],
    photo: savePhoto(photo),
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
  if (patch.howToServe !== undefined) dish.howToServe = patch.howToServe.trim();
  if (patch.calcTables !== undefined) dish.calcTables = patch.calcTables;
  if (patch.order !== undefined) dish.order = patch.order;
  if (patch.photo) {
    deletePhoto(dish.photo);
    dish.photo = savePhoto(patch.photo);
  }
  if (patch.removePhoto) {
    deletePhoto(dish.photo);
    dish.photo = null;
  }
  writeDishes(dishes);
  return dish;
}

function deleteDish(id) {
  const dishes = readDishes();
  const dish = dishes.find((d) => d.id === id);
  if (!dish) return false;
  deletePhoto(dish.photo);
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

// Full structured guide — sections in order, each with its dishes in
// order. Used both by the admin page and the public read-only page.
function getGuide() {
  const sections = readSections().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const dishes = readDishes();
  return sections.map((section) => ({
    ...section,
    dishes: dishes
      .filter((d) => d.sectionId === section.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
  }));
}

function getOrphanDishes() {
  const sectionIds = new Set(readSections().map((s) => s.id));
  return readDishes().filter((d) => !d.sectionId || !sectionIds.has(d.sectionId));
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
  getOrphanDishes,
  photoPath,
  PHOTOS_DIR,
  SECTIONS_PATH,
  DISHES_PATH,
};
