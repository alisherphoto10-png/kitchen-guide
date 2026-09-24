// Администрирование платформы: клиенты (заведение, приостановка) и их боты.
const router = require('express').Router();
const { ah, toId, HttpError } = require('../utils/http');
const { imageUpload, unlinkUpload } = require('../utils/uploads');
const { requirePlatformAdmin } = require('../middleware/auth');
const tenants = require('../services/tenants');
const bots = require('../services/bots');
const modules = require('../services/modules');
const guide = require('../services/guide');
const guideContent = require('../services/guideContent');

router.use(requirePlatformAdmin);

router.get('/tenants', ah(async (req, res) => {
  const [list, modulesOf] = await Promise.all([tenants.list(), modules.allTenants()]);
  res.json(list.map(t => ({ ...t, modules: modulesOf(t.id) })));
}));

// Платные модули заведения: включаются вручную после оплаты.
router.get('/tenants/:id/modules', ah(async (req, res) => {
  const id = toId(req.params.id);
  await tenants.get(id);
  res.json(await modules.detailed(id));
}));

router.put('/tenants/:id/modules/:key', ah(async (req, res) => {
  const id = toId(req.params.id);
  await tenants.get(id);
  res.json(await modules.set(id, req.params.key, !!(req.body || {}).enabled, req.user.id));
}));

// «Название заведения + токен от @BotFather» одной формой: токен необязателен.
// Если бот не подключился, заведение всё равно создано — ошибка бота уходит
// отдельным полем, подключить можно позже из карточки заведения.
router.post('/tenants', ah(async (req, res) => {
  const body = req.body || {};
  const created = await tenants.create(body);
  if (body.botToken) {
    try {
      created.bot = await bots.connect(created.tenant.id, body.botToken);
    } catch (e) {
      created.bot_error = e.message;
    }
  }
  res.status(201).json(created);
}));

router.get('/tenants/:id/bot', ah(async (req, res) => {
  const id = toId(req.params.id);
  await tenants.get(id);
  res.json(await bots.status(id));
}));

router.put('/tenants/:id/bot', ah(async (req, res) => {
  res.json(await bots.connect(toId(req.params.id), (req.body || {}).token));
}));

router.post('/tenants/:id/bot/deactivate', ah(async (req, res) => {
  res.json(await bots.setActive(toId(req.params.id), false));
}));

router.post('/tenants/:id/bot/activate', ah(async (req, res) => {
  res.json(await bots.setActive(toId(req.params.id), true));
}));

router.delete('/tenants/:id/bot', ah(async (req, res) => {
  await bots.remove(toId(req.params.id));
  res.json({ ok: true });
}));

router.put('/tenants/:id', ah(async (req, res) => {
  res.json(await tenants.update(toId(req.params.id), req.body || {}));
}));

// Ссылка на гид для владельцев. После смены — меню команд ботов (/guide есть/нет).
router.get('/guide', ah(async (req, res) => {
  res.json({ url: await guide.getUrl(), default_url: guide.DEFAULT_URL });
}));

router.put('/guide', ah(async (req, res) => {
  const url = await guide.setUrl((req.body || {}).url);
  const bots_sync = await bots.syncAllCommands();
  res.json({ url, default_url: guide.DEFAULT_URL, bots_sync });
}));

// Содержимое страницы гида: фото по слотам (data-guide-slot) и «Частые вопросы».
router.get('/guide/photos', ah(async (req, res) => res.json(await guideContent.photos())));

const guideUpload = imageUpload(() => 'guide');
router.post('/guide/photos/:slot', ah(async (req, res, next) => {
  // Слот проверяем до приёма файла, чтобы не писать на диск лишнее.
  if (!guideContent.SLOTS.some(s => s.slot === req.params.slot)) throw new HttpError(400, 'Неизвестное место для фото');
  next();
}), guideUpload.single('photo'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Нет файла');
  const publicPath = '/uploads/' + req.file.filename;
  try {
    unlinkUpload(await guideContent.setPhoto(req.params.slot, publicPath));
  } catch (e) {
    unlinkUpload(publicPath);
    throw e;
  }
  res.json(await guideContent.photos());
}));

router.delete('/guide/photos/:slot', ah(async (req, res) => {
  unlinkUpload(await guideContent.setPhoto(req.params.slot, null));
  res.json(await guideContent.photos());
}));

router.get('/guide/faq', ah(async (req, res) => res.json(await guideContent.faqList())));
router.post('/guide/faq', ah(async (req, res) => res.status(201).json(await guideContent.faqCreate(req.body))));
router.put('/guide/faq/:id', ah(async (req, res) => res.json(await guideContent.faqUpdate(toId(req.params.id), req.body))));
router.delete('/guide/faq/:id', ah(async (req, res) => {
  await guideContent.faqRemove(toId(req.params.id));
  res.json({ ok: true });
}));
router.post('/guide/faq/:id/move', ah(async (req, res) => {
  res.json(await guideContent.faqMove(toId(req.params.id), (req.body || {}).dir === 'up' ? 'up' : 'down'));
}));

module.exports = router;
