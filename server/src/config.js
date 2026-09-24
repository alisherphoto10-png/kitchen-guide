const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} не задан в server/.env`);
  return v;
}

module.exports = {
  port: parseInt(process.env.PORT || '3008', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'),
  webDist: path.join(__dirname, '..', '..', 'web', 'dist'),
  fontsDir: path.join(__dirname, '..', 'assets', 'fonts'),
  // Публичный адрес сайта: из него строятся URL вебхуков и мини-аппа.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  // 32 байта hex — ключ шифрования токенов ботов. Потеря ключа = токены
  // придётся ввести заново (сами боты и данные не пострадают).
  botTokenKey: required('BOT_TOKEN_KEY'),
  // Переопределяется только в тестах (фейковый Telegram).
  telegramApiBase: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
};
