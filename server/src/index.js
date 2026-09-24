const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { migrate } = require('./db/migrate');
const { HttpError } = require('./utils/http');
const { authenticate, requireTenant } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
// Когда появится домен, перед приложением встанет nginx на этой же машине.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '5mb' }));

fs.mkdirSync(config.uploadsDir, { recursive: true });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/platform', authenticate, require('./routes/platform'));
app.use('/api/recipes', authenticate, requireTenant, require('./routes/recipes'));
app.use('/api/categories', authenticate, requireTenant, require('./routes/categories'));
app.use('/api/team', authenticate, requireTenant, require('./routes/team'));
app.use('/tg', require('./routes/webhook'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, fallthrough: false }));

// Собранный фронтенд (web/dist): SPA — любые не-API пути отдают index.html.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/uploads|\/tg\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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
  .then(() => app.listen(config.port, '127.0.0.1', () => console.log(`zhiguli: http://127.0.0.1:${config.port}`)))
  .catch(e => { console.error('Миграции не применились:', e.message); process.exit(1); });
