// Клиент к iikoServer REST API (classic, /resto/api/...). Логика та же, что в
// интеграции KitchenDesk (services/iiko.js там), но код свой.
//
// connection — { base_url, login, password } с уже расшифрованным паролем;
// base_url включает суффикс /resto (normalizeBaseUrl приводит к нему).
//
// TLS — с обычной проверкой сертификата (в KitchenDesk на демо-стенде её когда-то
// отключали; здесь не отключаем). Адрес вводит владелец заведения, а запрос
// делает наш сервер — поэтому только https и только публичные адреса, иначе
// форма подключения превратилась бы в способ стучаться во внутреннюю сеть.
// IIKO_ALLOW_LOCAL=1 снимает оба ограничения — только для тестов с фейковым iiko.
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { HttpError } = require('../utils/http');

const TIMEOUT_MS = 30000;
const allowLocal = process.env.IIKO_ALLOW_LOCAL === '1';

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, p, 'ipv4');
// Правила ::ffff:0:0/96 здесь быть не должно: BlockList сверяет IPv4 и с ним
// (как IPv4-mapped) — и блокировал бы вообще любой адрес. Mapped-адреса
// (::ffff:10.0.0.1) BlockList и так сверяет с IPv4-правилами выше.
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]]) blocked.addSubnet(a, p, 'ipv6');

const sha1 = text => crypto.createHash('sha1').update(String(text), 'utf8').digest('hex');

// "542-903-605.iiko.it", "https://x.iiko.it/", "https://x.iiko.it/resto/api" → "https://x.iiko.it/resto"
function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new HttpError(400, 'Укажите адрес iiko');
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'Адрес iiko указан неверно'); }
  if (u.protocol !== 'https:' && !(allowLocal && u.protocol === 'http:')) throw new HttpError(400, 'Адрес iiko должен начинаться с https://');
  if (u.username || u.password) throw new HttpError(400, 'Адрес iiko указан неверно');
  const path = u.pathname.replace(/\/+$/, '').replace(/\/api(\/.*)?$/, '');
  const base = path.endsWith('/resto') ? path : path + '/resto';
  return `${u.protocol}//${u.host}${base}`;
}

async function assertPublicHost(url) {
  if (allowLocal) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  } catch {
    throw new HttpError(502, `Сервер iiko не найден: ${host}`);
  }
  if (addrs.some(a => blocked.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) {
    throw new HttpError(400, 'Адрес iiko указывает во внутреннюю сеть — нужен внешний адрес сервера iiko');
  }
}

// Ошибки сети/iiko — 502: «не получилось поговорить с iiko», а не наша поломка.
async function request(connection, path, params = {}) {
  const url = `${connection.base_url}${path}?${new URLSearchParams(params)}`;
  await assertPublicHost(url);
  let res;
  try {
    res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message || e.name;
    if (e.name === 'TimeoutError') throw new HttpError(502, 'iiko не ответил за 30 секунд');
    if (/CERT|SSL|TLS|SELF_SIGNED/i.test(String(cause))) throw new HttpError(502, `Сертификат сервера iiko не прошёл проверку (${cause})`);
    throw new HttpError(502, `Не удалось подключиться к iiko (${cause})`);
  }
  const body = await res.text();
  return { status: res.status, body };
}

async function requestJson(connection, path, params) {
  const { status, body } = await request(connection, path, params);
  if (status === 401 || status === 403) throw new HttpError(502, `iiko отказал в доступе (${status}) к ${path} — проверьте права пользователя iiko`);
  if (status < 200 || status >= 300) throw new HttpError(502, `iiko ответил ошибкой ${status} на ${path}`);
  try { return JSON.parse(body); } catch { throw new HttpError(502, `iiko прислал не JSON на ${path}`); }
}

// GET /resto/api/auth?login=..&pass=<sha1> → токен (UUID) текстом в теле.
// Токен занимает лицензию iiko — после работы обязательно logout().
async function login(connection) {
  const { status, body } = await request(connection, '/api/auth', { login: connection.login, pass: sha1(connection.password) });
  const token = body.trim();
  if (status >= 200 && status < 300 && /^[0-9a-f-]{20,}$/i.test(token)) return token;
  if (status === 401 || status === 403) throw new HttpError(502, 'iiko: неверный логин или пароль');
  throw new HttpError(502, `iiko не выдал ключ доступа (${status}${body ? ': ' + body.trim().slice(0, 150) : ''})`);
}

async function logout(connection, token) {
  await request(connection, '/api/logout', { key: token }).catch(() => {});
}

// Выполняет fn(token) в одной сессии iiko и всегда освобождает лицензию.
async function withSession(connection, fn) {
  const token = await login(connection);
  try { return await fn(token); } finally { await logout(connection, token); }
}

// Всё, что нужно для импорта ТТК, одним заходом.
// assemblyCharts — все версии карт с dateFrom (год назад — с запасом);
// products — блюда, товары и полуфабрикаты (тип — поле type: DISH/GOODS/PREPARED/…);
// measureUnits — справочник единиц (id → «кг»/«л»/«шт»/«порц»).
async function fetchCatalog(connection) {
  return withSession(connection, async key => {
    const dateFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const [charts, products, units] = await Promise.all([
      requestJson(connection, '/api/v2/assemblyCharts/getAll', { key, dateFrom }),
      requestJson(connection, '/api/v2/entities/products/list', { key }),
      requestJson(connection, '/api/v2/entities/list', { key, rootType: 'MeasureUnit' }),
    ]);
    return {
      charts: Array.isArray(charts?.assemblyCharts) ? charts.assemblyCharts : [],
      products: Array.isArray(products) ? products : [],
      units: Array.isArray(units) ? units : [],
    };
  });
}

// Актуальная версия карты: из неистёкших (dateTo нет или ещё не наступил) —
// с самым поздним dateFrom. dateFrom <= сегодня НЕ требуем: на демо-стенде
// KitchenDesk свежая карта с составом была датирована позже «сейчас», а
// неистёкшая старая была пустышкой — наивный выбор давал не ту карту.
function pickCurrentChart(charts, asOf = new Date()) {
  const now = asOf.getTime();
  const alive = charts.filter(c => now < (c.dateTo ? new Date(c.dateTo).getTime() : Infinity));
  if (!alive.length) return null;
  return alive.reduce((best, c) => (new Date(c.dateFrom) > new Date(best.dateFrom) ? c : best));
}

// assembledProductId → актуальная карта.
function currentCharts(charts, asOf = new Date()) {
  const byProduct = new Map();
  for (const c of charts) {
    if (!c?.assembledProductId) continue;
    if (!byProduct.has(c.assembledProductId)) byProduct.set(c.assembledProductId, []);
    byProduct.get(c.assembledProductId).push(c);
  }
  const out = new Map();
  for (const [id, list] of byProduct) {
    const cur = pickCurrentChart(list, asOf);
    if (cur) out.set(id, cur);
  }
  return out;
}

module.exports = { sha1, normalizeBaseUrl, withSession, fetchCatalog, pickCurrentChart, currentCharts };
