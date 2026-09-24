// ТТК: вся бизнес-логика здесь, без привязки к Express — чтобы тот же код
// потом вызывал Telegram-бот/мини-апп. Каждая функция принимает tenantId
// первым аргументом и никогда не выходит за пределы этого клиента.
//
// Отправная точка — модуль ТТК KitchenDesk (построчный состав брутто/нетто/%
// потерь, полуфабрикаты ссылкой на свою ТТК, калькулятор пересчёта), но схема
// и правила свои: полуфабрикат — это явный вид ТТК (kind='semi'), а не
// префикс «ПФ» в названии; циклы в составе запрещены.

const { pool, withTransaction } = require('../db/pool');
const { HttpError, toNum } = require('../utils/http');

const YIELD_UNITS = ['кг', 'г', 'л', 'мл'];
const MAX_INGREDIENTS = 200;

// ── чтение ───────────────────────────────────────────────────────────

async function list(tenantId, { q = '', categoryId = null, status = 'active', kind = null } = {}) {
  const params = [tenantId, status === 'archived' ? 'archived' : 'active'];
  const where = ['r.tenant_id = $1', 'r.status = $2'];
  if (q.trim()) {
    params.push('%' + q.trim().toLowerCase() + '%');
    where.push(`(LOWER(r.name) LIKE $${params.length} OR EXISTS (
      SELECT 1 FROM recipe_ingredients i WHERE i.recipe_id = r.id AND LOWER(i.name) LIKE $${params.length}))`);
  }
  if (categoryId === 'none') where.push('r.category_id IS NULL');
  else if (categoryId) { params.push(categoryId); where.push(`r.category_id = $${params.length}`); }
  if (kind === 'dish' || kind === 'semi') { params.push(kind); where.push(`r.kind = $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.kind, r.category_id, c.name AS category_name, r.photo, r.status,
            r.yield_weight, r.yield_unit, r.yield_count, r.updated_at,
            (SELECT COUNT(*)::int FROM recipe_ingredients i WHERE i.recipe_id = r.id) AS ingredient_count
       FROM recipes r LEFT JOIN categories c ON c.id = r.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY LOWER(r.name)`,
    params
  );
  return rows;
}

async function get(tenantId, id) {
  const { rows: [recipe] } = await pool.query(
    `SELECT r.*, c.name AS category_name
       FROM recipes r LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.id = $1 AND r.tenant_id = $2`,
    [id, tenantId]
  );
  if (!recipe) throw new HttpError(404, 'ТТК не найдена');

  const { rows: ingredients } = await pool.query(
    `SELECT i.id, i.name, i.brutto, i.netto, i.loss_percent, i.unit, i.linked_recipe_id,
            l.name AS linked_recipe_name
       FROM recipe_ingredients i LEFT JOIN recipes l ON l.id = i.linked_recipe_id
      WHERE i.recipe_id = $1
      ORDER BY i.sort_order, i.id`,
    [id]
  );
  // Где этот полуфабрикат используется — чтобы видеть последствия правки.
  const { rows: usedIn } = await pool.query(
    `SELECT DISTINCT r.id, r.name FROM recipe_ingredients i JOIN recipes r ON r.id = i.recipe_id
      WHERE i.linked_recipe_id = $1 AND r.tenant_id = $2 ORDER BY r.name`,
    [id, tenantId]
  );
  return { ...recipe, ingredients, used_in: usedIn };
}

// ── запись ───────────────────────────────────────────────────────────

// Из двух известных величин (брутто, нетто, % потерь) досчитывает третью.
// Ничего не перетирает: если заданы все три — остаются как есть.
function completeIngredient(row) {
  let { brutto, netto, loss_percent: loss } = row;
  const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  if (brutto != null && netto != null && loss == null && brutto > 0) {
    loss = round((1 - netto / brutto) * 100, 2);
  } else if (brutto != null && loss != null && netto == null) {
    netto = round(brutto * (1 - loss / 100), 4);
  } else if (netto != null && loss != null && brutto == null && loss < 100) {
    brutto = round(netto / (1 - loss / 100), 4);
  }
  return { ...row, brutto, netto, loss_percent: loss };
}

function normalizeIngredients(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_INGREDIENTS) throw new HttpError(400, `Не больше ${MAX_INGREDIENTS} строк состава`);
  return input
    .map(r => ({
      name: String(r?.name || '').trim().slice(0, 300),
      brutto: toNum(r?.brutto, 'Брутто'),
      netto: toNum(r?.netto, 'Нетто'),
      loss_percent: toNum(r?.loss_percent, '% потерь'),
      unit: String(r?.unit || '').trim().slice(0, 20) || null,
      linked_recipe_id: r?.linked_recipe_id ? parseInt(r.linked_recipe_id, 10) || null : null,
    }))
    .filter(r => r.name)
    .map(r => {
      for (const f of ['brutto', 'netto']) {
        if (r[f] != null && r[f] < 0) throw new HttpError(400, `«${r.name}»: отрицательное количество`);
      }
      if (r.loss_percent != null && (r.loss_percent < 0 || r.loss_percent >= 100)) {
        throw new HttpError(400, `«${r.name}»: % потерь должен быть от 0 до 99`);
      }
      return completeIngredient(r);
    });
}

function normalizeRecipe(data) {
  const name = String(data?.name || '').trim().slice(0, 300);
  if (!name) throw new HttpError(400, 'Укажите название');
  const yieldUnit = data.yield_unit || null;
  if (yieldUnit && !YIELD_UNITS.includes(yieldUnit)) throw new HttpError(400, 'Неизвестная единица выхода');
  return {
    name,
    kind: data.kind === 'semi' ? 'semi' : 'dish',
    category_id: data.category_id ? parseInt(data.category_id, 10) || null : null,
    cooking: String(data.cooking || '').slice(0, 20000),
    note: String(data.note || '').slice(0, 5000),
    yield_weight: toNum(data.yield_weight, 'Выход'),
    yield_unit: yieldUnit,
    yield_count: toNum(data.yield_count, 'Порций'),
    calories: toNum(data.calories, 'Калории'),
    protein: toNum(data.protein, 'Белки'),
    fat: toNum(data.fat, 'Жиры'),
    carbs: toNum(data.carbs, 'Углеводы'),
  };
}

async function assertCategory(db, tenantId, categoryId) {
  if (!categoryId) return;
  const { rows } = await db.query('SELECT 1 FROM categories WHERE id = $1 AND tenant_id = $2', [categoryId, tenantId]);
  if (!rows.length) throw new HttpError(400, 'Категория не найдена');
}

// Связывает строки состава с ТТК-полуфабрикатами того же клиента:
// - явная ссылка проверяется (свой клиент, не сама на себя, без цикла);
// - строка без ссылки, но с точным названием полуфабриката — связывается сама.
async function resolveLinks(db, tenantId, recipeId, rows) {
  const { rows: semis } = await db.query(
    "SELECT id, LOWER(name) AS lname FROM recipes WHERE tenant_id = $1 AND kind = 'semi' AND status = 'active'",
    [tenantId]
  );
  const byName = new Map(semis.map(s => [s.lname, s.id]));

  for (const r of rows) {
    if (r.linked_recipe_id) {
      const { rows: ok } = await db.query('SELECT 1 FROM recipes WHERE id = $1 AND tenant_id = $2', [r.linked_recipe_id, tenantId]);
      if (!ok.length) r.linked_recipe_id = null;
    } else {
      r.linked_recipe_id = byName.get(r.name.toLowerCase()) || null;
    }
    if (recipeId && r.linked_recipe_id === recipeId) {
      throw new HttpError(400, `«${r.name}»: ТТК не может входить в собственный состав`);
    }
  }

  if (!recipeId) return rows;
  // Цикл: если какой-то из подключаемых полуфабрикатов сам (через любую глубину)
  // содержит эту ТТК, пересчёт и раскрытие состава зациклились бы.
  const linkedIds = [...new Set(rows.map(r => r.linked_recipe_id).filter(Boolean))];
  if (linkedIds.length) {
    const { rows: cyc } = await db.query(
      `WITH RECURSIVE sub(id) AS (
         SELECT unnest($1::int[])
         UNION
         SELECT i.linked_recipe_id FROM recipe_ingredients i JOIN sub ON i.recipe_id = sub.id
          WHERE i.linked_recipe_id IS NOT NULL
       )
       SELECT 1 FROM sub WHERE id = $2 LIMIT 1`,
      [linkedIds, recipeId]
    );
    if (cyc.length) throw new HttpError(400, 'Полуфабрикат уже содержит эту ТТК — получился бы замкнутый круг');
  }
  return rows;
}

async function writeIngredients(db, recipeId, rows) {
  await db.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);
  let i = 0;
  for (const r of rows) {
    await db.query(
      `INSERT INTO recipe_ingredients (recipe_id, sort_order, name, brutto, netto, loss_percent, unit, linked_recipe_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [recipeId, i++, r.name, r.brutto, r.netto, r.loss_percent, r.unit, r.linked_recipe_id]
    );
  }
}

// Полуфабрикат только что появился (создан, переименован или сменил тип) —
// подвязываем к нему уже существующие строки других карт с тем же названием.
// Пропускаем карты, которые сами входят в этот полуфабрикат (иначе цикл).
async function linkExistingRows(db, tenantId, semiId, name) {
  await db.query(
    `WITH RECURSIVE inside(id) AS (
       SELECT i.linked_recipe_id FROM recipe_ingredients i WHERE i.recipe_id = $1 AND i.linked_recipe_id IS NOT NULL
       UNION
       SELECT i.linked_recipe_id FROM recipe_ingredients i JOIN inside ON i.recipe_id = inside.id
        WHERE i.linked_recipe_id IS NOT NULL
     )
     UPDATE recipe_ingredients ri SET linked_recipe_id = $1
       FROM recipes r
      WHERE r.id = ri.recipe_id AND r.tenant_id = $2 AND ri.recipe_id <> $1
        AND ri.linked_recipe_id IS NULL AND LOWER(ri.name) = LOWER($3)
        AND ri.recipe_id NOT IN (SELECT id FROM inside)`,
    [semiId, tenantId, name]
  );
}

async function create(tenantId, userId, data) {
  const recipe = normalizeRecipe(data);
  const ingredients = normalizeIngredients(data.ingredients);
  const id = await withTransaction(async db => {
    await assertCategory(db, tenantId, recipe.category_id);
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO recipes (tenant_id, category_id, name, kind, cooking, note, yield_weight, yield_unit, yield_count,
                            calories, protein, fat, carbs, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING id`,
      [tenantId, recipe.category_id, recipe.name, recipe.kind, recipe.cooking, recipe.note,
       recipe.yield_weight, recipe.yield_unit, recipe.yield_count,
       recipe.calories, recipe.protein, recipe.fat, recipe.carbs, userId]
    );
    await writeIngredients(db, id, await resolveLinks(db, tenantId, id, ingredients));
    if (recipe.kind === 'semi') await linkExistingRows(db, tenantId, id, recipe.name);
    return id;
  });
  return get(tenantId, id);
}

async function update(tenantId, userId, id, data) {
  const recipe = normalizeRecipe(data);
  const ingredients = normalizeIngredients(data.ingredients);
  await withTransaction(async db => {
    const { rows: [old] } = await db.query('SELECT kind FROM recipes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    if (!old) throw new HttpError(404, 'ТТК не найдена');
    if (old.kind === 'semi' && recipe.kind === 'dish') {
      const { rows } = await db.query('SELECT 1 FROM recipe_ingredients WHERE linked_recipe_id = $1 LIMIT 1', [id]);
      if (rows.length) throw new HttpError(409, 'Этот полуфабрикат входит в другие ТТК — сначала уберите его оттуда');
    }
    await assertCategory(db, tenantId, recipe.category_id);
    await db.query(
      `UPDATE recipes SET category_id=$3, name=$4, kind=$5, cooking=$6, note=$7, yield_weight=$8, yield_unit=$9,
              yield_count=$10, calories=$11, protein=$12, fat=$13, carbs=$14, updated_by=$15, updated_at=NOW()
        WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, recipe.category_id, recipe.name, recipe.kind, recipe.cooking, recipe.note,
       recipe.yield_weight, recipe.yield_unit, recipe.yield_count,
       recipe.calories, recipe.protein, recipe.fat, recipe.carbs, userId]
    );
    await writeIngredients(db, id, await resolveLinks(db, tenantId, id, ingredients));
    if (recipe.kind === 'semi') await linkExistingRows(db, tenantId, id, recipe.name);
  });
  return get(tenantId, id);
}

async function setStatus(tenantId, id, status) {
  const { rowCount } = await pool.query(
    'UPDATE recipes SET status = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, tenantId, status]
  );
  if (!rowCount) throw new HttpError(404, 'ТТК не найдена');
}

// Удаление навсегда. Возвращает путь фото, чтобы роут убрал файл.
async function remove(tenantId, id) {
  const { rows: [row] } = await pool.query(
    'DELETE FROM recipes WHERE id = $1 AND tenant_id = $2 RETURNING photo',
    [id, tenantId]
  );
  if (!row) throw new HttpError(404, 'ТТК не найдена');
  return row.photo;
}

// Возвращает предыдущее фото (для удаления файла).
async function setPhoto(tenantId, id, photo) {
  const { rows: [old] } = await pool.query('SELECT photo FROM recipes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!old) throw new HttpError(404, 'ТТК не найдена');
  await pool.query('UPDATE recipes SET photo = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2', [id, tenantId, photo]);
  return old.photo;
}

// Массовый импорт (файл разбирается на клиенте, сюда приходят готовые ТТК).
// Всё или ничего: одна транзакция на весь файл.
async function importMany(tenantId, userId, items, { categoryId = null } = {}) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Нечего импортировать');
  if (items.length > 500) throw new HttpError(400, 'Не больше 500 ТТК за раз');
  const prepared = items.map(it => ({ recipe: normalizeRecipe({ ...it, category_id: it.category_id || categoryId }), ingredients: normalizeIngredients(it.ingredients) }));
  return withTransaction(async db => {
    const ids = [];
    for (const { recipe, ingredients } of prepared) {
      await assertCategory(db, tenantId, recipe.category_id);
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO recipes (tenant_id, category_id, name, kind, yield_weight, yield_unit, yield_count, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [tenantId, recipe.category_id, recipe.name, recipe.kind, recipe.yield_weight, recipe.yield_unit, recipe.yield_count, userId]
      );
      ids.push({ id, ingredients });
    }
    // Связи — после вставки всех: полуфабрикат из этого же файла тоже найдётся.
    for (const { id, ingredients } of ids) {
      await writeIngredients(db, id, await resolveLinks(db, tenantId, id, ingredients));
    }
    return ids.length;
  });
}

// ── пересчёт ─────────────────────────────────────────────────────────

// Масштабирует состав и выход на коэффициент k (порции ×k). % потерь и КБЖУ
// на 100 г не меняются; КБЖУ на весь выход — умножаются.
function scale(recipe, k) {
  if (!(k > 0) || k === 1) return recipe;
  const m = v => (v == null ? null : Math.round(v * k * 10000) / 10000);
  return {
    ...recipe,
    yield_weight: m(recipe.yield_weight),
    yield_count: m(recipe.yield_count),
    calories: m(recipe.calories), protein: m(recipe.protein), fat: m(recipe.fat), carbs: m(recipe.carbs),
    ingredients: recipe.ingredients.map(i => ({ ...i, brutto: m(i.brutto), netto: m(i.netto) })),
    scale_factor: k,
  };
}

module.exports = {
  list, get, create, update, setStatus, remove, setPhoto, importMany, scale,
  completeIngredient, YIELD_UNITS,
};
