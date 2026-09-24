// Ссылка на гид для владельцев «Как это работает» (и «Частые вопросы»).
// Хранится в одном месте — platform_settings, меняет администратор платформы на
// сайте («Поддержка» → «Гид»). Пустая ссылка = гид скрыт везде: на странице
// входа, в меню сайта, в профиле мини-аппа и команда /guide у ботов заведений.
const config = require('../config');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http');
const tg = require('./telegram');

const KEY = 'guide_url';
// По умолчанию — своя страница гида (web/public/guide, отдаётся на /guide/).
const DEFAULT_URL = config.publicBaseUrl ? `${config.publicBaseUrl}/guide/` : '';

// Нет строки в настройках = ссылка по умолчанию; строка с '' = гид выключен.
async function getUrl() {
  const { rows: [r] } = await pool.query('SELECT value FROM platform_settings WHERE key = $1', [KEY]);
  return r ? String(r.value?.url || '') : DEFAULT_URL;
}

function normalize(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  let u;
  try { u = new URL(url); } catch { u = null; }
  if (!u || !['https:', 'http:'].includes(u.protocol) || url.length > 1000) {
    throw new HttpError(400, 'Нужна ссылка вида https://… (или пустое поле, чтобы скрыть гид)');
  }
  return url;
}

async function setUrl(raw) {
  const url = normalize(raw);
  await pool.query(
    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [KEY, { url }]
  );
  return url;
}

// ---- Команда /guide в меню ботов заведений ----

const GUIDE_COMMAND = { command: 'guide', description: 'Гид и частые вопросы' };

function isGuideCommand(text) {
  const t = String(text || '').trim();
  return t === '/guide' || t.startsWith('/guide@') || t.startsWith('/guide ');
}

// Меню команд бота = то, что уже есть у бота (getMyCommands — не затираем чужие,
// например заданные в @BotFather) + наши базовые + /guide, если гид включён.
// setMyCommands вызывается, только если список действительно меняется.
async function syncCommands(token, baseCommands, guideUrl) {
  const current = await tg.call(token, 'getMyCommands');
  const ours = [...baseCommands, ...(guideUrl ? [GUIDE_COMMAND] : [])];
  const ourNames = new Set([...baseCommands.map(c => c.command), GUIDE_COMMAND.command]);
  const next = [...ours, ...(current || []).filter(c => !ourNames.has(c.command))];
  const same = next.length === (current || []).length
    && next.every((c, i) => c.command === current[i].command && c.description === current[i].description);
  if (!same) await tg.call(token, 'setMyCommands', { commands: next });
  return !same;
}

module.exports = { DEFAULT_URL, getUrl, setUrl, syncCommands, isGuideCommand, GUIDE_COMMAND };
