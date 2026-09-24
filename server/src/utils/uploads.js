// Загрузка картинок (multer) в config.uploadsDir и удаление старых файлов.
// Раздаются без авторизации через /uploads (<img> не шлёт токен), поэтому
// имя файла случайное — ссылку нельзя угадать перебором.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { HttpError } = require('./http');

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// prefix(req) — начало имени файла (чей это файл), дальше случайная часть.
function imageUpload(prefix) {
  return multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (req, file, cb) => cb(null, `${prefix(req)}_${crypto.randomBytes(12).toString('hex')}${IMAGE_EXT[file.mimetype]}`),
    }),
    fileFilter: (req, file, cb) => cb(IMAGE_EXT[file.mimetype] ? null : new HttpError(400, 'Нужна картинка JPG, PNG или WebP'), !!IMAGE_EXT[file.mimetype]),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
}

function unlinkUpload(publicPath) {
  if (!publicPath) return;
  fs.unlink(path.join(config.uploadsDir, path.basename(publicPath)), () => {});
}

module.exports = { imageUpload, unlinkUpload };
