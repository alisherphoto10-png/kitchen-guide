const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { migrate } = require('./db/migrate');
const { HttpError, ah } = require('./utils/http');
const { authenticate, requireTenant } = require('./middleware/auth');
const guide = require('./services/guide');
const guideContent = require('./services/guideContent');
const bots = require('./services/bots');

const app = express();
app.disable('x-powered-by');
// Когда появится домен, перед приложением встанет nginx на этой же машине.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '5mb' }));

fs.mkdirSync(config.uploadsDir, { recursive: true });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
// Ссылка на гид — публично: нужна и на странице входа.
app.get('/api/guide', ah(async (req, res) => res.json({ url: await guide.getUrl() })));
// Своё содержимое страницы гида (фото вместо заглушек, «Частые вопросы») — тоже
// публично: /guide/ открывают и без входа. Без кеша — правка в админке видна сразу.
app.get('/api/guide/content', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await guideContent.publicContent());
}));
app.use('/api/platform/support', authenticate, require('./routes/support').admin);
app.use('/api/platform', authenticate, require('./routes/platform'));
app.use('/api/support', authenticate, require('./routes/support').mine);
app.use('/api/recipes', authenticate, requireTenant, require('./routes/recipes'));
app.use('/api/categories', authenticate, requireTenant, require('./routes/categories'));
app.use('/api/team', authenticate, requireTenant, require('./routes/team'));
app.use('/api/iiko', authenticate, requireTenant, require('./routes/iiko'));
app.use('/tg', require('./routes/webhook'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, fallthrough: false }));

// Собранный фронтенд (web/dist): SPA — любые не-API пути отдают index.html.
if (fs.existsSync(config.webDist)) {
  // Гид для владельцев (web/public/guide) — отдельная статическая страница:
  // /guide/ отдаёт её index.html (у общей статики index выключен — там SPA).
  app.use('/guide', express.static(path.join(config.webDist, 'guide'), { maxAge: '1h' }));
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/uploads|\/tg\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    // code/module — чтобы фронтенд отличал «модуль не оплачен» от прочих 403.
    return res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code, module: err.module }) });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 8 МБ' : 'Ошибка загрузки файла' });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.status === 404) return res.status(404).json({ error: 'Не найдено' });
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

migrate()
  .then(() => app.listen(config.port, '127.0.0.1', () => {
    console.log(`zhiguli: http://127.0.0.1:${config.port}`);
    // Уже подключённые боты получают /guide в меню (setMyCommands — только если меню отличается).
    bots.syncAllCommands()
      .then(r => r.total && console.log(`Меню команд ботов: ${r.total} всего, обновлено ${r.changed}, ошибок ${r.failed}`))
      .catch(e => console.error('Меню команд ботов не обновилось:', e.message));
  }))
  .catch(e => { console.error('Миграции не применились:', e.message); process.exit(1); });
