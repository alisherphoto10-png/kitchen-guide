// Интеграция с iiko (модуль `iiko`): подключение заведения и импорт ТТК.
// Учётные данные iiko — свои у каждого заведения, заводит владелец; платформа
// только включает/выключает модуль. Сетевой клиент — services/iikoApi.js.
//
// Импорт кладёт актуальные карты iiko в recipes/recipe_ingredients:
// - полуфабрикат iiko (products.type = PREPARED) → kind='semi', остальное → 'dish';
// - брутто = нетто = amountIn, % потерь = 0: iiko отдаёт по строке один вес
//   (проверено на живой карте KitchenDesk «Сливочно-творожный крем»);
// - строка, которая сама импортированный полуфабрикат, связывается с его картой;
// - повторный импорт обновляет карты по iiko_product_id, а не плодит новые.
// Карта с iiko_managed_at — «управляется iiko»: пока модуль включён, название,
// тип, выход и состав вручную не правятся (см. recipes.update).

const { pool, withTransaction } = require('../db/pool');
const { HttpError } = require('../utils/http');
const secretBox = require('../utils/secretBox');
const iikoApi = require('./iikoApi');
const recipes = require('./recipes');

// ── подключение ──────────────────────────────────────────────────────

function view(row) {
  if (!row) return null;
  return {
    base_url: row.base_url,
    login: row.login,
    last_test_ok_at: row.last_test_ok_at,
    last_error: row.last_error,
    last_import_at: row.last_import_at,
    last_import_result: row.last_import_result,
    group_ids: row.group_ids,
    auto_attempt_at: row.auto_attempt_at,
    auto_ok_at: row.auto_ok_at,
    auto_error: row.auto_error,
    updated_at: row.updated_at,
  };
}

async function getRow(tenantId) {
  const { rows: [row] } = await pool.query('SELECT * FROM tenant_iiko WHERE tenant_id = $1', [tenantId]);
  return row || null;
}

async function get(tenantId) {
  return view(await getRow(tenantId));
}

async function connectionOf(tenantId) {
  const row = await getRow(tenantId);
  if (!row) throw new HttpError(404, 'Подключение к iiko не настроено');
  return { base_url: row.base_url, login: row.login, password: secretBox.decrypt(row.password_encrypted), group_ids: row.group_ids };
}

// Сохраняет подключение только если iiko его принял — неверные данные не
// хранятся. Пустой пароль при уже настроенном подключении = оставить прежний.
async function save(tenantId, userId, { base_url, login, password } = {}) {
  const baseUrl = iikoApi.normalizeBaseUrl(base_url);
  const loginStr = String(login || '').trim().slice(0, 200);
  if (!loginStr) throw new HttpError(400, 'Укажите логин iiko');
  let pass = String(password || '');
  if (pass.length > 500) throw new HttpError(400, 'Слишком длинный пароль');
  if (!pass) {
    const old = await getRow(tenantId);
    if (!old) throw new HttpError(400, 'Укажите пароль iiko');
    pass = secretBox.decrypt(old.password_encrypted);
  }
  await iikoApi.withSession({ base_url: baseUrl, login: loginStr, password: pass }, async () => {});
  await pool.query(
    `INSERT INTO tenant_iiko (tenant_id, base_url, login, password_encrypted, last_test_ok_at, last_error, updated_by)
     VALUES ($1, $2, $3, $4, NOW(), NULL, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET base_url = $2, login = $3, password_encrypted = $4,
       last_test_ok_at = NOW(), last_error = NULL, updated_by = $5, updated_at = NOW()`,
    [tenantId, baseUrl, loginStr, secretBox.encrypt(pass), userId]
  );
  return get(tenantId);
}

// Ошибку iiko запоминаем в подключении — владелец увидит её и после перезагрузки.
async function remember(tenantId, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.status === 502) {
      await pool.query('UPDATE tenant_iiko SET last_error = $2 WHERE tenant_id = $1', [tenantId, e.message]);
    }
    throw e;
  }
}

async function test(tenantId) {
  const connection = await connectionOf(tenantId);
  await remember(tenantId, () => iikoApi.withSession(connection, async () => {}));
  await pool.query('UPDATE tenant_iiko SET last_test_ok_at = NOW(), last_error = NULL WHERE tenant_id = $1', [tenantId]);
  return get(tenantId);
}

// Удаляет только подключение. Импортированные карты остаются как есть.
async function remove(tenantId) {
  const { rowCount } = await pool.query('DELETE FROM tenant_iiko WHERE tenant_id = $1', [tenantId]);
  if (!rowCount) throw new HttpError(404, 'Подключение к iiko не настроено');
}

// ── папки (что импортировать) ────────────────────────────────────────
// Схема — как в KitchenDesk (oko-iiko-integration/PART-13): дерево групп iiko
// с галочками, сохраняется набор id, импорт берёт карту, только если parent
// её товара в наборе. Отличие: пока владелец ничего не выбирал (group_ids
// NULL), импортируется всё — в дереве по умолчанию всё отмечено.

// Товары вне любой группы (parent пустой или указывает на неизвестную группу).
// В KitchenDesk такие просто пропускались, но на демо-стенде iiko групп нет
// вообще — все блюда там без папки, и любой сохранённый выбор отрезал бы всё.
// Поэтому «Без папки» — отдельный пункт дерева со своей галочкой.
const NO_GROUP = 'no-group';

function groupKey(product, groupIds) {
  return product?.parent && groupIds.has(product.parent) ? product.parent : NO_GROUP;
}

async function groupsTree(tenantId) {
  const connection = await connectionOf(tenantId);
  const { groups, charts, products } = await remember(tenantId, () => iikoApi.fetchGroups(connection));
  const live = groups.filter(g => g?.id && !g.deleted);
  const ids = new Set(live.map(g => g.id));
  const productById = new Map(products.map(p => [p.id, p]));

  // Сколько актуальных техкарт лежит прямо в каждой папке.
  const count = new Map();
  for (const productId of iikoApi.currentCharts(charts).keys()) {
    const p = productById.get(productId);
    if (!p || p.deleted) continue;
    const k = groupKey(p, ids);
    count.set(k, (count.get(k) || 0) + 1);
  }

  const nodes = new Map(live.map(g => [g.id, { id: g.id, name: String(g.name || '').trim() || 'Без названия', count: count.get(g.id) || 0, children: [] }]));
  const roots = [];
  for (const g of live) {
    const parent = g.parent && g.parent !== g.id ? nodes.get(g.parent) : null;
    (parent ? parent.children : roots).push(nodes.get(g.id));
  }
  // total — карт во всей ветке: папки без техкарт можно показать бледнее.
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  const seen = new Set();
  const finish = n => {
    if (seen.has(n.id)) return 0; // защита от цикла в данных iiko
    seen.add(n.id);
    n.children.sort(byName);
    n.total = n.count + n.children.reduce((s, c) => s + finish(c), 0);
    return n.total;
  };
  roots.sort(byName).forEach(finish);
  if (count.get(NO_GROUP)) roots.push({ id: NO_GROUP, name: 'Без папки', count: count.get(NO_GROUP), total: count.get(NO_GROUP), children: [] });

  return { tree: roots, selected: Array.isArray(connection.group_ids) ? connection.group_ids : null };
}

async function saveGroups(tenantId, groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length > 10000 || groupIds.some(id => typeof id !== 'string' || !id || id.length > 100)) {
    throw new HttpError(400, 'Некорректный список папок');
  }
  const { rowCount } = await pool.query('UPDATE tenant_iiko SET group_ids = $2, updated_at = NOW() WHERE tenant_id = $1', [tenantId, JSON.stringify([...new Set(groupIds)])]);
  if (!rowCount) throw new HttpError(404, 'Подключение к iiko не настроено');
  return get(tenantId);
}

// ── импорт ───────────────────────────────────────────────────────────

const WEIGHT_UNITS = ['кг', 'л'];
const COUNT_UNITS = ['шт', 'порц'];
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round4 = v => (v == null ? null : Math.round(v * 10000) / 10000);

// Каталог iiko → список карт для записи (ещё без id наших рецептов).
// groupIds — выбранные папки (null — все). Карта из невыбранной папки не
// импортируется и попадает в skippedGroup.
function buildCards(catalog, groupIds = null) {
  const productById = new Map(catalog.products.map(p => [p.id, p]));
  const unitName = new Map(catalog.units.map(u => [u.id, String(u.name || '').trim()]));
  const selected = Array.isArray(groupIds) ? new Set(groupIds) : null;
  if (selected && !catalog.groups) throw new HttpError(502, 'iiko не отдал список папок — импорт по выбранным папкам невозможен, проверьте права пользователя iiko');
  const liveGroups = new Set((catalog.groups || []).filter(g => g?.id && !g.deleted).map(g => g.id));
  const cards = [];
  const skipped = [];
  const skippedGroup = [];
  let skippedRows = 0;

  for (const [productId, chart] of iikoApi.currentCharts(catalog.charts)) {
    const product = productById.get(productId);
    const name = String(product?.name || '').trim().slice(0, 300);
    if (!product || !name) { skipped.push(`id ${productId} — нет в номенклатуре iiko`); continue; }
    if (product.deleted) { skipped.push(`${name} — удалён в iiko`); continue; }
    if (selected && !selected.has(groupKey(product, liveGroups))) { skippedGroup.push(name); continue; }

    const mainUnit = unitName.get(product.mainUnit) || null;
    const amount = num(chart.assembledAmount);
    const card = {
      iiko_product_id: productId,
      name,
      kind: product.type === 'PREPARED' ? 'semi' : 'dish',
      yield_weight: null, yield_unit: null, yield_count: null,
      rows: [],
    };
    if (amount != null && WEIGHT_UNITS.includes(mainUnit)) { card.yield_weight = round4(amount); card.yield_unit = mainUnit; }
    else if (amount != null && COUNT_UNITS.includes(mainUnit)) card.yield_count = round4(amount);

    for (const item of chart.items || []) {
      const ing = productById.get(item.productId);
      const ingName = String(ing?.name || '').trim().slice(0, 300);
      if (!ingName) { skippedRows++; continue; }
      const weight = round4(num(item.amountIn));
      card.rows.push({
        iiko_product_id: item.productId,
        name: ingName,
        brutto: weight, netto: weight, loss_percent: weight == null ? null : 0,
        unit: (unitName.get(ing.mainUnit) || '').slice(0, 20) || null,
        linked_recipe_id: null,
      });
    }
    cards.push(card);
  }
  return { cards, skipped, skippedGroup, skippedRows };
}

const rowsSig = rows => JSON.stringify(rows.map(r => [r.name, r.brutto, r.netto, r.loss_percent, r.unit, r.linked_recipe_id]));

// source: 'manual' (кнопка) или 'auto' (ночное автообновление, userId = null).
async function runImport(tenantId, userId, { source = 'manual' } = {}) {
  const connection = await connectionOf(tenantId);
  const catalog = await remember(tenantId, () => iikoApi.fetchCatalog(connection));
  const { cards, skipped, skippedGroup, skippedRows } = buildCards(catalog, connection.group_ids);

  return withTransaction(async db => {
    // Двойное нажатие «Импорт» не должно создать карты дважды.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('zhiguli-iiko-import'), $1)", [tenantId]);

    const created = [], updated = [], unchanged = [];
    const idByIiko = new Map();
    const before = new Map();

    // 1. Карты: находим по iiko_product_id; если такой ещё нет — берём ручную
    //    карту с тем же названием (без iiko-метки), чтобы не было двух одинаковых.
    for (const c of cards) {
      let { rows: [old] } = await db.query(
        'SELECT id, name, kind, yield_weight, yield_unit, yield_count FROM recipes WHERE tenant_id = $1 AND iiko_product_id = $2',
        [tenantId, c.iiko_product_id]
      );
      if (!old) {
        ({ rows: [old] } = await db.query(
          `SELECT id, name, kind, yield_weight, yield_unit, yield_count FROM recipes
            WHERE tenant_id = $1 AND iiko_product_id IS NULL AND LOWER(name) = LOWER($2) ORDER BY status, id LIMIT 1`,
          [tenantId, c.name]
        ));
      }
      if (old) {
        const { rows: oldRows } = await db.query(
          'SELECT name, brutto, netto, loss_percent, unit, linked_recipe_id FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order, id',
          [old.id]
        );
        before.set(old.id, JSON.stringify([old.name, old.kind, old.yield_weight, old.yield_unit, old.yield_count]) + rowsSig(oldRows));
        await db.query(
          `UPDATE recipes SET iiko_product_id = $3, iiko_managed_at = NOW(), name = $4, kind = $5,
                  yield_weight = $6, yield_unit = $7, yield_count = $8, updated_by = $9, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2`,
          [old.id, tenantId, c.iiko_product_id, c.name, c.kind, c.yield_weight, c.yield_unit, c.yield_count, userId]
        );
        c.id = old.id;
      } else {
        const { rows: [{ id }] } = await db.query(
          `INSERT INTO recipes (tenant_id, name, kind, yield_weight, yield_unit, yield_count,
                                iiko_product_id, iiko_managed_at, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$8) RETURNING id`,
          [tenantId, c.name, c.kind, c.yield_weight, c.yield_unit, c.yield_count, c.iiko_product_id, userId]
        );
        c.id = id;
        created.push(c.name);
      }
      idByIiko.set(c.iiko_product_id, c.id);
    }

    // 2. Состав — после всех карт, чтобы полуфабрикат из этого же импорта нашёлся.
    //    Связь: сначала по id iiko (импортированный п/ф), иначе — по точному
    //    названию уже существующего полуфабриката, как при ручном вводе.
    const { rows: semis } = await db.query(
      "SELECT id, LOWER(name) AS lname FROM recipes WHERE tenant_id = $1 AND kind = 'semi' AND status = 'active'",
      [tenantId]
    );
    const semiByName = new Map(semis.map(s => [s.lname, s.id]));
    let linked = 0;
    for (const c of cards) {
      for (const r of c.rows) {
        const target = idByIiko.get(r.iiko_product_id) ?? semiByName.get(r.name.toLowerCase()) ?? null;
        r.linked_recipe_id = target && target !== c.id ? target : null;
        if (r.linked_recipe_id) linked++;
      }
      await recipes.writeIngredients(db, c.id, c.rows);
      if (before.has(c.id)) {
        const now = JSON.stringify([c.name, c.kind, c.yield_weight, c.yield_unit, c.yield_count]) + rowsSig(c.rows);
        (now === before.get(c.id) ? unchanged : updated).push(c.name);
      }
    }

    // 3. Ручные карты, где в составе есть строка с названием импортированного п/ф, —
    //    подвязываем к нему (то же правило, что при создании полуфабриката руками).
    for (const c of cards) {
      if (c.kind === 'semi') await recipes.linkExistingRows(db, tenantId, c.id, c.name);
    }

    const summary = {
      total: cards.length,
      created: created.length, updated: updated.length, unchanged: unchanged.length,
      skipped: skipped.length, skipped_group: skippedGroup.length, skipped_rows: skippedRows, linked,
      created_names: created, updated_names: updated, skipped_names: skipped, skipped_group_names: skippedGroup,
      source, at: new Date().toISOString(),
    };
    await db.query(
      `UPDATE tenant_iiko SET last_import_at = NOW(), last_import_result = $2, last_test_ok_at = NOW(), last_error = NULL
        WHERE tenant_id = $1`,
      [tenantId, JSON.stringify(summary)]
    );
    return summary;
  });
}

module.exports = { get, save, test, remove, groupsTree, saveGroups, runImport, buildCards, NO_GROUP };
