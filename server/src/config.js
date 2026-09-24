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
};
