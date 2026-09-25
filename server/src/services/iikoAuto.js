// Ежедневное автообновление ТТК из iiko: тот же импорт, что по кнопке
// (с учётом выбранных папок), для каждого заведения с включённым модулем
// iiko и настроенным подключением.
//
// Не cron в точное время, а проверка раз в 10 минут: «сегодня (по Ташкенту)
// уже запускали?» — если нет и время уже после AUTO_HOUR, запускаем. Так
// пропущенный из-за перезапуска сервера прогон догоняется, а не теряется
// до следующей ночи. Заведение «занимается» атомарным UPDATE auto_attempt_at —
// даже два экземпляра сервера на одной базе не запустят его дважды за сутки.
// IIKO_AUTO_IMPORT=0 выключает планировщик (тестовые экземпляры на прод-базе).
const { pool } = require('../db/pool');
const modules = require('./modules');
const iiko = require('./iiko');

const TZ = 'Asia/Tashkent';
const AUTO_HOUR = 4; // 04:00 по Ташкенту — заведения закрыты, кухня ещё не начала
const TICK_MS = 10 * 60 * 1000;

const NOT_TODAY = `(auto_attempt_at IS NULL OR (auto_attempt_at AT TIME ZONE '${TZ}')::date < (NOW() AT TIME ZONE '${TZ}')::date)`;

function localHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

// Один проход по всем подходящим заведениям. Ошибка одного не останавливает
// остальные — пишется в его auto_error и в лог. only — ограничить список (тесты).
async function runAll({ only = null } = {}) {
  const { rows } = await pool.query(
    `SELECT i.tenant_id FROM tenant_iiko i JOIN tenants t ON t.id = i.tenant_id
      WHERE t.is_active AND ${NOT_TODAY} ${only ? 'AND i.tenant_id = ANY($1)' : ''} ORDER BY i.tenant_id`,
    only ? [only] : []
  );
  const result = { total: 0, ok: 0, failed: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      if (!(await modules.isEnabled(tenantId, 'iiko'))) continue;
      const { rowCount } = await pool.query(`UPDATE tenant_iiko SET auto_attempt_at = NOW() WHERE tenant_id = $1 AND ${NOT_TODAY}`, [tenantId]);
      if (!rowCount) continue; // уже взял другой экземпляр
      result.total++;
      const r = await iiko.runImport(tenantId, null, { source: 'auto' });
      await pool.query('UPDATE tenant_iiko SET auto_ok_at = NOW(), auto_error = NULL WHERE tenant_id = $1', [tenantId]);
      result.ok++;
      console.log(`[iiko auto] заведение ${tenantId}: новых ${r.created}, обновлено ${r.updated}, без изменений ${r.unchanged}, вне выбранных папок ${r.skipped_group}`);
    } catch (e) {
      result.failed++;
      await pool.query('UPDATE tenant_iiko SET auto_error = $2 WHERE tenant_id = $1', [tenantId, String(e.message || e).slice(0, 500)]).catch(() => {});
      console.error(`[iiko auto] заведение ${tenantId}: ошибка — ${e.message}`);
    }
  }
  return result;
}

let running = false;
async function tick() {
  if (running || localHour() < AUTO_HOUR) return;
  running = true;
  try {
    const r = await runAll();
    if (r.total) console.log(`[iiko auto] прогон: ${r.total} заведений, успешно ${r.ok}, с ошибкой ${r.failed}`);
  } catch (e) {
    console.error('[iiko auto] прогон не выполнился:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (process.env.IIKO_AUTO_IMPORT === '0') return;
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
}

module.exports = { start, runAll, localHour, AUTO_HOUR, TZ };
