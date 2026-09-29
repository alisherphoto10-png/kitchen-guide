const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = '/home/oko-kitchen/oko-kitchen/oko-frontend/out', S = __dirname, MOCK = path.join(S, 'mock'), VID = path.join(S, 'vid');
fs.mkdirSync(VID, { recursive: true });
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(OUT, u);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8767);
const PH = n => `https://kitchendesk.chefplan.ru/photos/${n}`;
const F = (g, n, parts, w) => [{ name: 'Брутто (грязный вес)', value: g, unit: 'кг', role: 'gross' }, { name: 'Нетто (чистый вес)', value: n, unit: 'кг', role: 'net' }, ...parts.map(([a, b]) => ({ name: a, value: b, unit: 'кг', role: 'part' })), { name: 'Отход', value: w, unit: 'кг', role: 'waste' }];
function mkActs(created) {
  const acts = [
    [295, 'Тунец', 'Камиль', 'Пицца', '29.09.2026', 'pending', F('1', '0.63', [], '0.370')], [294, 'Форель', 'Шухрат', 'Горячий цех', '29.09.2026', 'approved', F('2', '1.6', [], '0.400')],
    [293, 'Форель', 'Шухрат', 'Горячий цех', '29.09.2026', 'approved', F('1', '0.86', [], '0.140')], [292, 'Шпинат', 'Камиль', 'Пицца', '29.09.2026', 'pending', F('1', '0.63', [], '0.370')],
    [291, 'Сибас', 'Шухрат', 'Горячий цех', '28.09.2026', 'rejected', F('5.1', '4', [], '1.100')], [290, 'Романо', 'Алишер', 'Холодный цех', '28.09.2026', 'approved', F('1', '0.8', [], '0.200')],
    [289, 'Тунец', 'Шухрат', 'Горячий цех', '27.09.2026', 'approved', F('1', '0.63', [], '0.370')], [288, 'Бон филе', 'Шухрат', 'Горячий цех', '27.09.2026', 'approved', F('20', '12', [['Уши', '6'], ['Стафф', '1.2'], ['Обрезки', '0']], '0.800')],
  ].map(([id, type, cook, section, date, status, fields]) => ({ id, type, cook_name: cook, cook_tg_id: '555', section, date, status, fields, note: '', restaurant_id: 1, cutting_type: type === 'Бон филе' ? 'Филетовка' : '', source_doc: '', created_at: '2026-09-29T10:12:00Z', approved_by: status === 'approved' ? 'Алишер' : null, approved_at: status === 'approved' ? '29.09.2026, 17:45:57' : null }));
  acts.push({ id: 284, type: 'Бон филе', cook_name: 'Шухрат', cook_tg_id: '555', section: 'Горячий цех', date: '29.09.2026', status: 'approved', approved_by: 'Алишер', approved_at: '29.09.2026, 17:45:57',
    fields: F('21.85', '12.90', [['Уши', '6.91'], ['Стафф', '1.28'], ['Обрезки', '0']], '0.760'), note: '', restaurant_id: 1, cutting_type: 'Филетовка', source_doc: '1456', created_at: '2026-09-29T10:12:00Z' });
  if (created) acts.unshift({ id: 296, type: 'Бон филе', cook_name: 'Шухрат', cook_tg_id: '555', section: 'Горячий цех', date: '29.09.2026', status: 'pending', fields: F('21.85', '12.90', [['Уши', '6.91'], ['Стафф', '1.28'], ['Обрезки', '0']], '0.760'), note: '', restaurant_id: 1, cutting_type: 'Филетовка', source_doc: '', created_at: '2026-09-29T15:12:00Z' });
  return acts.sort((a, b) => b.id - a.id);
}
const extra = { photos: [{ id: 1, url: PH('p1.jpg'), author_name: 'Шухрат', created_at: '2026-09-29T10:12:00Z' }, { id: 2, url: PH('p2.jpg'), author_name: 'Шухрат', created_at: '2026-09-29T10:12:00Z' }, { id: 3, url: PH('p3.jpg'), author_name: 'Шухрат', created_at: '2026-09-29T10:12:00Z' }],
  comments: [{ id: 1, author_name: 'Шухрат', text: 'Сырьё свежее, обрезков минимум.', created_at: '2026-09-29T10:12:00Z' }, { id: 2, author_name: 'Алишер', text: 'Разделка выполнена корректно.\nВыход в норме.', created_at: '2026-09-29T12:46:00Z' }],
  history: [{ id: 1, action: 'created', actor_name: 'Шухрат', created_at: '2026-09-29T10:12:00Z' }, { id: 2, action: 'comment', actor_name: 'Алишер', created_at: '2026-09-29T12:46:00Z' }, { id: 3, action: 'approved', actor_name: 'Алишер', created_at: '2026-09-29T12:45:57Z' }] };
const templates = [['Тунец', 'Рыба', 't_tuna.jpg'], ['Форель', 'Рыба', 't_forel.jpg'], ['Бон филе', 'Мясо', 'prod.jpg'], ['Лосось', 'Рыба', 't_salmon.jpg'], ['Шпинат', 'Овощи', 't_spinach.jpg']]
  .map(([name, category, ph], i) => ({ id: 100 + i, name, category, photo_url: PH(ph), cutting_type: name === 'Бон филе' ? 'Филетовка' : '', fields: name === 'Бон филе' ? ['Приход (грязный вес)', 'Чистый вес', 'Уши', 'Стафф', 'Обрезки', 'Отход'] : ['Общий вес', 'Чистый вес', 'Отход'] }));

const TAP_JS = `window.__tap=(x,y)=>{const d=document.createElement('div');d.style.cssText='position:fixed;z-index:99999;pointer-events:none;left:'+(x-22)+'px;top:'+(y-22)+'px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.9);transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .6s ease-out';document.body.appendChild(d);requestAnimationFrame(()=>{d.style.transform='scale(1.1)';d.style.opacity='0'});setTimeout(()=>d.remove(),700)}`;

async function part(b, role, name, run) {
  let created = false
  const user = { id: 1, login: 'u', name: role === 'cook' ? 'Шухрат' : 'Алишер', role, restaurant_id: 1, section: 'Горячий цех', tg_id: role === 'cook' ? '555' : '111', onboarding_completed: true };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, recordVideo: { dir: VID, size: { width: 780, height: 1688 } } });
  await ctx.addInitScript(u => { localStorage.setItem('web_token', 'x'); localStorage.setItem('web_user', JSON.stringify(u)) }, user);
  await ctx.addInitScript(TAP_JS);
  await ctx.route('https://kitchendesk.chefplan.ru/**', r => {
    const u = r.request().url(), m = r.request().method();
    if (u.includes('/photos/')) return r.fulfill({ path: path.join(MOCK, path.basename(u.split('?')[0])) });
    let body;
    if (u.includes('/api/profile') && !/profile\//.test(u)) body = user;
    else if (/\/api\/acts\/\d+\/extra/.test(u)) body = extra;
    else if (u.includes('/api/acts/photos')) body = { ok: true, url: PH('p1.jpg') };
    else if (u.includes('/api/act-templates')) body = templates;
    else if (/\/api\/acts(\?|$)/.test(u) && m === 'GET') body = mkActs(created);
    else if (u.includes('/api/acts') && m === 'POST') { created = true; body = { ok: true, id: 296 } }
    else if (/profile\/(restaurant|avatar)|admin\/overview/.test(u)) body = {};
    else body = [];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage(); p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,300)) }); p.on('pageerror', e => console.log('PAGEERR', e.message));
  const t0 = Date.now();
  const caps = [];
  let cur = null;
  const cap = async (title, text) => { const t = (Date.now() - t0) / 1000; if (cur) cur.end = t; cur = { start: t, title, text }; caps.push(cur); await p.waitForTimeout(1300) };
  const wait = ms => p.waitForTimeout(ms);
  const tap = async (loc, after = 700) => {
    await loc.scrollIntoViewIfNeeded(); const bb = await loc.boundingBox();
    if (bb) { await p.evaluate(([x, y]) => window.__tap(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]); await wait(350) }
    await loc.click(); await wait(after);
  };
  const type = async (loc, text) => { await tap(loc, 200); for (const ch of text) { await p.keyboard.type(ch); await wait(110) } await wait(300) };
  const scroll = async (dy, ms = 900) => { const steps = 12; for (let i = 0; i < steps; i++) { await p.evaluate(d => document.querySelector('main')?.scrollBy(0, d), dy / steps); await wait(ms / steps) } };
  await p.goto('http://localhost:8767/web/'); await wait(1800);
  try { await run({ p, tap, type, wait, cap, scroll }); } catch (e) { await p.screenshot({ path: path.join(VID, name + '_fail.png') }); throw e }
  if (cur) cur.end = (Date.now() - t0) / 1000;
  const v = p.video(); await ctx.close();
  const vp = path.join(VID, name + '.webm'); await v.saveAs(vp);
  fs.writeFileSync(path.join(VID, name + '.json'), JSON.stringify(caps, null, 1));
  console.log('recorded', name, caps.length, 'captions');
}

(async () => {
  const b = await chromium.launch();
  // Часть 1 — повар создаёт акт
  if (!process.env.ONLY2) await part(b, 'cook', 'part1', async ({ p, tap, type, wait, cap, scroll }) => {
    await cap('Акты разделки', 'Раздел «Акты» в нижнем меню')
    await tap(p.locator('button.kd-nav-item', { hasText: 'Акты' }), 1500)
    await cap('Список актов', 'Номер, продукт, повар, цех, дата и статус.\nПовар видит только свои акты')
    await wait(2500)
    await cap('Новый акт', 'Кнопка «+ Новый акт» — создание в 5 шагов')
    await tap(p.getByText('Новый акт', { exact: true }), 1200)
    await cap('Шаг 1. Выбор продукта', 'Поиск или категории: Рыба, Мясо, Овощи…')
    await tap(p.getByRole('button', { name: 'Мясо', exact: true }), 900)
    await tap(p.getByRole('button', { name: 'Все', exact: true }), 700)
    await tap(p.getByText('Бон филе', { exact: true }).first(), 1000)
    await tap(p.getByText('Выбрать', { exact: true }), 1200)
    await cap('Шаг 2. Веса', 'Брутто — грязный вес сырья.\nНетто — чистый вес после разделки')
    const inputs = p.locator('input[inputmode=decimal]');
    await type(inputs.nth(0), '21,85'); await type(inputs.nth(1), '12,90')
    await cap('Шаг 2. Дополнительные части', 'Уши, стафф, обрезки — из шаблона продукта.\nПрочий отход считается сам')
    await scroll(260)
    await type(inputs.nth(2), '6,91'); await type(inputs.nth(3), '1,28'); await type(inputs.nth(4), '0')
    await scroll(250)
    await cap('Шаг 2. Итого', 'Отход и процент отхода пересчитываются сразу')
    await wait(2600)
    await tap(p.getByText('Далее', { exact: true }), 1000)
    await cap('Шаг 3. Фото', 'Фото готового продукта и отходов —\nпо желанию, до 12 штук')
    const add = p.getByText('Добавить фото', { exact: true }); const bb = await add.boundingBox(); await p.evaluate(([x, y]) => window.__tap(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]); await wait(400)
    await p.setInputFiles('input[type=file]', [path.join(MOCK, 'p1.jpg')]); await wait(1800)
    await tap(p.getByText('Далее', { exact: true }), 1000)
    await cap('Шаг 4. Проверка', 'Сверьте веса, при желании оставьте комментарий')
    await wait(1500)
    await type(p.locator('textarea'), 'Сырьё свежее, обрезков минимум.')
    await tap(p.getByText('Отправить акт', { exact: true }), 3000)
    await cap('Шаг 5. Отправлено', 'Акт ушёл на проверку. Руководителю придёт\nуведомление, вам — когда акт проверят')
    await wait(2500)
    await tap(p.getByText('Вернуться к актам', { exact: true }), 1200)
    await cap('Новый акт в списке', 'Статус «Ожидает подтверждения»')
    await wait(2200)
  });
  // Часть 2 — руководитель
  await part(b, 'admin', 'part2', async ({ p, tap, wait, cap, scroll }) => {
    await tap(p.locator('button.kd-nav-item', { hasText: 'Акты' }), 1300)
    await cap('Для руководителя: поиск и фильтры', 'Цех, тип разделки, повар, статус.\n«Показать (N)» — сразу видно, сколько найдётся')
    await tap(p.getByRole('button', { name: /^Фильтры/ }), 1200)
    await tap(p.getByRole('button', { name: 'Согласовано' }).last(), 1300)
    await tap(p.getByRole('button', { name: /Показать/ }), 1500)
    await tap(p.getByRole('button', { name: /^Фильтры/ }), 900)
    await tap(p.getByText('Сбросить', { exact: true }), 1200)
    await cap('Карточка акта', 'Нажмите на акт в списке')
    await tap(p.getByText('№ 284'), 1500)
    await cap('Итоги разделки', 'Брутто, нетто, отход, процент отхода, выход —\nсчитаются автоматически')
    await wait(2800)
    await cap('Состав отхода', 'Дополнительные части и прочий отход')
    await scroll(420, 1400); await wait(1800)
    await cap('Дополнительная информация', 'Реквизиты, фото, комментарии, история')
    await tap(p.getByText('Дополнительная информация'), 1500)
    await scroll(500, 1600); await wait(1000)
    await cap('История, фото, комментарии', 'Кто и когда создал, проверил, прокомментировал')
    await tap(p.getByRole('button', { name: 'История', exact: true }), 1800)
    await tap(p.getByRole('button', { name: 'Фото', exact: true }), 1800)
    await tap(p.getByRole('button', { name: 'Комментарии', exact: true }), 1800)
    await tap(p.getByLabel('Назад').first(), 1000)
    await cap('Экспорт', 'PDF, Excel или картинка PNG.\nГалочками — что включить в документ')
    await p.evaluate(() => document.querySelector('main')?.scrollTo({ top: 0 })); await wait(600)
    await tap(p.getByText('Экспорт', { exact: true }), 1500)
    await tap(p.getByText('Excel (.xlsx)', { exact: true }), 900)
    await tap(p.getByText('PDF (рекомендуется)', { exact: true }), 900)
    await tap(p.getByRole('button', { name: /История изменений/ }), 700)
    await tap(p.getByRole('button', { name: /История изменений/ }), 900)
    await cap('Предпросмотр', 'Скачать, поделиться, печать.\nФото в PDF и Excel — ссылками')
    await tap(p.getByText('Предпросмотр', { exact: true }), 1500)
    await scroll(500, 1800); await wait(2200)
  });
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
