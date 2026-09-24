// Содержимое страницы гида (web/public/guide/index.html), которое администратор
// платформы меняет сам, без правки файла и пересборки: свои фото вместо заглушек
// блюд (по слотам data-guide-slot) и список «Частые вопросы». Страница забирает
// всё одним публичным GET /api/guide/content.
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');

// Слоты — ровно те data-guide-slot, что размечены в index.html. default — встроенная
// заглушка (для превью в админке). cutout — на странице это «тарелка» без фона:
// лучше PNG/WebP с прозрачным фоном, иначе будет видно прямоугольник.
const SLOTS = [
  { slot: 'hero-carbonara', label: 'Обложка — фото в карточке блюда', default: '/guide/img/photo-carbonara.jpg', cutout: false },
  { slot: 'hero-caesar', label: 'Обложка — тарелка справа сверху', default: '/guide/img/bowl-caesar.png', cutout: true },
  { slot: 'hero-cake', label: 'Обложка — десерт слева снизу', default: '/guide/img/plate-cheesecake.png', cutout: true },
  { slot: 'list-caesar', label: 'Список ТТК — 1-я строка (Цезарь)', default: '/guide/img/th1.jpg', cutout: false },
  { slot: 'list-tomyum', label: 'Список ТТК — 2-я строка (Том Ям)', default: '/guide/img/th2.jpg', cutout: false },
  { slot: 'list-carbonara', label: 'Список ТТК — 3-я строка (Карбонара)', default: '/guide/img/th3.jpg', cutout: false },
  { slot: 'final-salmon', label: 'Концовка — большая тарелка', default: '/guide/img/bowl-salmon.png', cutout: true },
  { slot: 'final-tomyum', label: 'Концовка — маленькая тарелка', default: '/guide/img/bowl-tomyum.png', cutout: true },
];
const SLOT_SET = new Set(SLOTS.map(s => s.slot));

function assertSlot(slot) {
  if (!SLOT_SET.has(slot)) throw new HttpError(400, 'Неизвестное место для фото');
  return slot;
}

// ---- для страницы гида ----

async function publicContent() {
  const [{ rows: photos }, { rows: faq }] = await Promise.all([
    pool.query('SELECT slot, url FROM guide_photos'),
    pool.query('SELECT question, answer FROM guide_faq ORDER BY sort_order, id'),
  ]);
  return {
    photos: Object.fromEntries(photos.filter(p => SLOT_SET.has(p.slot)).map(p => [p.slot, p.url])),
    faq,
  };
}

// ---- фото ----

async function photos() {
  const { rows } = await pool.query('SELECT slot, url, updated_at FROM guide_photos');
  const bySlot = Object.fromEntries(rows.map(r => [r.slot, r]));
  return SLOTS.map(s => ({ ...s, url: bySlot[s.slot]?.url || null, updated_at: bySlot[s.slot]?.updated_at || null }));
}

// Возвращает прежний файл — его удаляет вызывающий (как у фото ТТК).
async function setPhoto(slot, url) {
  assertSlot(slot);
  const { rows: [old] } = await pool.query('SELECT url FROM guide_photos WHERE slot = $1', [slot]);
  if (url) {
    await pool.query(
      `INSERT INTO guide_photos (slot, url) VALUES ($1, $2)
       ON CONFLICT (slot) DO UPDATE SET url = $2, updated_at = NOW()`, [slot, url]);
  } else {
    await pool.query('DELETE FROM guide_photos WHERE slot = $1', [slot]);
  }
  return old?.url || null;
}

// ---- частые вопросы ----

function cleanFaq(body) {
  const question = String(body?.question ?? '').trim();
  const answer = String(body?.answer ?? '').trim();
  if (!question) throw new HttpError(400, 'Впишите вопрос');
  if (!answer) throw new HttpError(400, 'Впишите ответ');
  if (question.length > 300) throw new HttpError(400, 'Вопрос длиннее 300 символов');
  if (answer.length > 4000) throw new HttpError(400, 'Ответ длиннее 4000 символов');
  return { question, answer };
}

async function faqList() {
  const { rows } = await pool.query('SELECT id, question, answer, sort_order, updated_at FROM guide_faq ORDER BY sort_order, id');
  return rows;
}

async function faqCreate(body) {
  const { question, answer } = cleanFaq(body);
  const { rows: [row] } = await pool.query(
    `INSERT INTO guide_faq (question, answer, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM guide_faq))
     RETURNING id, question, answer, sort_order, updated_at`, [question, answer]);
  return row;
}

async function faqUpdate(id, body) {
  const { question, answer } = cleanFaq(body);
  const { rows: [row] } = await pool.query(
    `UPDATE guide_faq SET question = $2, answer = $3, updated_at = NOW() WHERE id = $1
     RETURNING id, question, answer, sort_order, updated_at`, [id, question, answer]);
  if (!row) throw new HttpError(404, 'Вопрос не найден');
  return row;
}

async function faqRemove(id) {
  const { rowCount } = await pool.query('DELETE FROM guide_faq WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Вопрос не найден');
}

// Поднять/опустить вопрос на одну позицию. Порядок пересчитывается целиком —
// так не бывает двух вопросов с одинаковым sort_order.
async function faqMove(id, dir) {
  const list = await faqList();
  const i = list.findIndex(f => f.id === id);
  if (i < 0) throw new HttpError(404, 'Вопрос не найден');
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    await pool.query(
      'UPDATE guide_faq f SET sort_order = o.pos FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos) WHERE f.id = o.id',
      [list.map(f => f.id)]);
  }
  return faqList();
}

module.exports = { SLOTS, publicContent, photos, setPhoto, faqList, faqCreate, faqUpdate, faqRemove, faqMove };
