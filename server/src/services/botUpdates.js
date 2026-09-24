// Обработка входящих апдейтов бота клиента. Бот минимальный: его задача —
// привязать сотрудника и открыть мини-апп с ТТК. Сами ТТК живут в мини-аппе.
const tg = require('./telegram');
const bots = require('./bots');
const link = require('./telegramLink');

function openButton(bot) {
  return { inline_keyboard: [[{ text: '📖 Открыть ТТК', web_app: { url: bots.miniAppUrl(bot.slug) } }]] };
}

async function reply(token, chatId, text, bot, withButton = true) {
  await tg.call(token, 'sendMessage', {
    chat_id: chatId, text, ...(withButton && { reply_markup: openButton(bot) }),
  });
}

async function handle(bot, update) {
  const msg = update.message;
  // Только личка: в группах бот молчит.
  if (!msg || msg.chat?.type !== 'private' || !msg.from || msg.from.is_bot) return;
  const token = bots.tokenOf(bot);
  const chatId = msg.chat.id;

  if (!bot.tenant_active) {
    await reply(token, chatId, 'Доступ для заведения приостановлен.', bot, false);
    return;
  }

  const text = String(msg.text || '').trim();
  const m = /^\/start(?:@\w+)?\s+link_([A-Za-z0-9_-]{10,60})$/.exec(text);
  if (m) {
    const user = await link.consumeLink(bot.tenant_id, m[1], msg.from);
    if (!user) {
      await reply(token, chatId, 'Ссылка-приглашение недействительна или устарела. Попросите владельца заведения прислать новую.', bot, false);
      return;
    }
    await reply(token, chatId, `Готово, ${user.name || user.login}! Telegram привязан — технологические карты открываются кнопкой ниже или «ТТК» в меню.`, bot);
    return;
  }

  const user = await link.findLinkedUser(bot.tenant_id, msg.from.id);
  if (user && user.is_active) {
    await reply(token, chatId, 'Технологические карты — по кнопке ниже.', bot);
  } else {
    await reply(token, chatId, 'Здравствуйте! Этот бот — для сотрудников заведения. Чтобы получить доступ, попросите владельца прислать вам персональную ссылку-приглашение.', bot, false);
  }
}

module.exports = { handle };
