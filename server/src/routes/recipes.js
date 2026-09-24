const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { ah, HttpError, toId } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const recipes = require('../services/recipes');
const exports_ = require('../services/exports');
const tenants = require('../services/tenants');
const modules = require('../services/modules');

// ── чтение: все роли ─────────────────────────────────────────────────

router.get('/', ah(async (req, res) => {
  const { q = '', category = '', status = 'active', kind = '' } = req.query;
  if (status === 'archived' && req.role === 'viewer') throw new HttpError(403, 'Недостаточно прав');
  res.json(await recipes.list(req.tenantId, {
    q: String(q), status: String(status), kind: String(kind),
    categoryId: category === 'none' ? 'none' : (parseInt(category, 10) || null),
  }));
}));

router.get('/:id', ah(async (req, res) => {
  const recipe = await recipes.get(req.tenantId, toId(req.params.id));
  if (recipe.status === 'archived' && req.role === 'viewer') throw new HttpError(404, 'ТТК не найдена');
  res.json(recipe);
}));

// Выгрузка. ?k= — коэффициент пересчёта (как в калькуляторе на экране).
// Повару (viewer) выгрузка закрыта — рецептуры не должны уходить файлами.
// Выгрузка как есть — базовая функция; с пересчётом (k ≠ 1) — модуль «Пересчёт».
async function scaleFromQuery(req) {
  const q = req.query;
  if (q.k === undefined || q.k === '') return 1;
  const k = parseFloat(String(q.k).replace(',', '.'));
  if (!(k > 0) || k > 10000) throw new HttpError(400, 'Некорректный коэффициент');
  if (k !== 1 && !(await modules.isEnabled(req.tenantId, 'recalc'))) throw new modules.ModuleLockedError('recalc');
  return k;
}

function attachment(res, filename) {
  res.setHeader('Content-Disposition', `attachment; filename="ttk"; filename*=UTF-8''${encodeURIComponent(filename)}`);
}

router.get('/:id/export.pdf', requireRole('editor'), ah(async (req, res) => {
  const recipe = recipes.scale(await recipes.get(req.tenantId, toId(req.params.id)), await scaleFromQuery(req));
  const tenant = await tenants.get(req.tenantId);
  const { doc, filename } = exports_.pdf(recipe, { tenantName: tenant.name });
  res.setHeader('Content-Type', 'application/pdf');
  attachment(res, filename);
  doc.pipe(res);
  doc.end();
}));

router.get('/:id/export.xlsx', requireRole('editor'), ah(async (req, res) => {
  const recipe = recipes.scale(await recipes.get(req.tenantId, toId(req.params.id)), await scaleFromQuery(req));
  const tenant = await tenants.get(req.tenantId);
  const { buffer, filename } = await exports_.xlsx(recipe, { tenantName: tenant.name });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  attachment(res, filename);
  res.send(Buffer.from(buffer));
}));

// ── запись: editor и выше ────────────────────────────────────────────

router.post('/', requireRole('editor'), ah(async (req, res) => {
  res.status(201).json(await recipes.create(req.tenantId, req.user.id, req.body || {}));
}));

router.post('/import', requireRole('editor'), ah(async (req, res) => {
  const { items, category_id } = req.body || {};
  const created = await recipes.importMany(req.tenantId, req.user.id, items, { categoryId: parseInt(category_id, 10) || null });
  res.json({ created });
}));

router.put('/:id', requireRole('editor'), ah(async (req, res) => {
  res.json(await recipes.update(req.tenantId, req.user.id, toId(req.params.id), req.body || {}));
}));

router.post('/:id/archive', requireRole('editor'), ah(async (req, res) => {
  await recipes.setStatus(req.tenantId, toId(req.params.id), 'archived');
  res.json({ ok: true });
}));

router.post('/:id/restore', requireRole('editor'), ah(async (req, res) => {
  await recipes.setStatus(req.tenantId, toId(req.params.id), 'active');
  res.json({ ok: true });
}));

function unlinkUpload(publicPath) {
  if (!publicPath) return;
  fs.unlink(path.join(config.uploadsDir, path.basename(publicPath)), () => {});
}

router.delete('/:id', requireRole('editor'), ah(async (req, res) => {
  unlinkUpload(await recipes.remove(req.tenantId, toId(req.params.id)));
  res.json({ ok: true });
}));

// ── фото ─────────────────────────────────────────────────────────────

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    // Имя случайное: файлы раздаются без авторизации (<img> не шлёт токен),
    // поэтому ссылку нельзя угадать перебором.
    filename: (req, file, cb) => cb(null, `r${req.tenantId}_${crypto.randomBytes(12).toString('hex')}${IMAGE_EXT[file.mimetype]}`),
  }),
  fileFilter: (req, file, cb) => cb(IMAGE_EXT[file.mimetype] ? null : new HttpError(400, 'Нужна картинка JPG, PNG или WebP'), !!IMAGE_EXT[file.mimetype]),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

router.post('/:id/photo', requireRole('editor'), upload.single('photo'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Нет файла');
  const publicPath = '/uploads/' + req.file.filename;
  try {
    unlinkUpload(await recipes.setPhoto(req.tenantId, toId(req.params.id), publicPath));
  } catch (e) {
    unlinkUpload(publicPath);
    throw e;
  }
  res.json({ photo: publicPath });
}));

router.delete('/:id/photo', requireRole('editor'), ah(async (req, res) => {
  unlinkUpload(await recipes.setPhoto(req.tenantId, toId(req.params.id), null));
  res.json({ ok: true });
}));

module.exports = router;
