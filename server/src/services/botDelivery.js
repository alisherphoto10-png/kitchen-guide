// Написать сотруднику от имени бота его заведения — в личный чат, откуда он
// открывает мини-апп. Используют техподдержка (ответы) и выгрузка ТТК (файлы).
const { HttpError } = require('../utils/http');
const tg = require('./telegram');
const bots = require('./bots');

async function botFor(tenantId, tgId) {
  if (!tgId) throw new HttpError(409, 'Сотрудник отвязан от Telegram — сообщение не доставить');
  const bot = await bots.activeForTenant(tenantId);
  if (!bot) throw new HttpError(409, 'Бот заведения отключён — сообщение не доставить');
  return bots.tokenOf(bot);
}

function deliveryFail(e) {
  if (e instanceof tg.TelegramError) {
    return new HttpError(502, e.code === 403
      ? 'Сотрудник заблокировал бота — Telegram не принимает сообщение'
      : `Telegram не принял сообщение: ${e.description || e.message}`);
  }
  return e;
}

async function sendMessage(tenantId, tgId, text) {
  const token = await botFor(tenantId, tgId);
  try { return await tg.call(token, 'sendMessage', { chat_id: tgId, text }); } catch (e) { throw deliveryFail(e); }
}

async function sendDocument(tenantId, tgId, { buffer, filename, contentType, caption }) {
  const token = await botFor(tenantId, tgId);
  try {
    return await tg.upload(token, 'sendDocument', { chat_id: tgId, caption: caption?.slice(0, 1000) }, 'document', { buffer, filename, contentType });
  } catch (e) { throw deliveryFail(e); }
}

module.exports = { sendMessage, sendDocument };
