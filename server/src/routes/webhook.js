// POST /tg/:id — вебхук бота клиента. У каждого бота свой путь и свой секрет;
// апдейт без правильного X-Telegram-Bot-Api-Secret-Token отбрасывается.
const crypto = require('crypto');
const router = require('express').Router();
const bots = require('../services/bots');
const botUpdates = require('../services/botUpdates');

function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

router.post('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const bot = Number.isInteger(id) ? await bots.getById(id).catch(() => null) : null;
  if (!bot || !sameSecret(req.get('X-Telegram-Bot-Api-Secret-Token'), bot.webhook_secret)) {
    return res.sendStatus(401);
  }
  // Отвечаем Telegram сразу: иначе при медленной обработке он пришлёт апдейт повторно.
  res.sendStatus(200);
  if (!bot.is_active) return;
  try {
    await bots.touch(bot.id);
    await botUpdates.handle(bot, req.body || {});
  } catch (e) {
    // Текст ошибки Telegram не содержит токена (см. services/telegram.js).
    console.error(`[bot ${bot.id} @${bot.username}]`, e.message);
  }
});

module.exports = router;
