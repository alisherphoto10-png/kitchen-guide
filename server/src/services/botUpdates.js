// Обработка входящих апдейтов бота клиента. Бот минимальный: пустить
// сотрудника (логин + пароль один раз → Telegram привязан навсегда), открыть
// мини-апп с ТТК и принимать обращения в техподдержку (services/support.js).
// Сами ТТК живут в мини-аппе.
const tg = require('./telegram');
const bots = require('./bots');
const link = require('./telegramLink');
const support = require('./support');
const guide = require('./guide');

function openButton(bot) {
  return { inline_keyboard: [[{ text: '📖 Открыть ТТК', web_app: { url: bots.miniAppUrl(bot.slug) } }]] };
}

async function send(token, chatId, text, markup) {
  await tg.call(token, 'sendMessage', { chat_id: chatId, text, ...(markup && { reply_markup: markup }) });
}

const ASK_LOGIN = 'Здравствуйте! Это бот технологических карт заведения.\n\nЧтобы войти, отправьте ваш логин — его выдал владелец заведения.';

// То, что человек сам написал или прислал. Всё остальное — служебные сообщения
// Telegram (например, приходят в чат вместе с документом, который бот отправил
// из мини-аппа); на них бот не отвечает, иначе после каждой выгрузки в чат
// падало бы лишнее приветствие.
const CONTENT_KEYS = ['text', 'caption', 'photo', 'document', 'video', 'voice', 'audio', 'sticker', 'video_note', 'animation', 'contact', 'location'];

function isUserContent(msg) {
  return CONTENT_KEYS.some(k => msg[k] !== undefined);
}

async function handle(bot, update) {
  const msg = update.message;
  // Только личка: в группах бот молчит (там могут быть все — логины туда не просим).
  if (!msg || msg.chat?.type !== 'private' || !msg.from || msg.from.is_bot) return;
  if (!isUserContent(msg)) {
    // Без содержимого сообщения — только названия полей, чтобы понять, что это было.
    console.log(`[bot ${bot.id}] служебное сообщение пропущено: ${Object.keys(msg).filter(k => !['message_id', 'from', 'chat', 'date'].includes(k)).join(',') || '—'}`);
    return;
  }
  const token = bots.tokenOf(bot);
  const chatId = msg.chat.id;
  const tgUser = msg.from;

  if (!bot.tenant_active) {
    await send(token, chatId, 'Доступ для заведения приостановлен.');
    return;
  }

  // /guide — одно сообщение с кнопкой-ссылкой, для всех (и до входа тоже): не
  // сбрасывает диалог входа и не попадает в обращение. Гид выключен — команда
  // ведёт себя как любая другая (её и в меню тогда нет).
  if (guide.isGuideCommand(msg.text)) {
    const url = await guide.getUrl();
    if (url) {
      await send(token, chatId, 'Как устроены «Калькуляции» и ответы на частые вопросы — по кнопке ниже.',
        { inline_keyboard: [[{ text: '📘 Гид и частые вопросы', url }]] });
      return;
    }
  }

  // Уже привязан — логин/пароль больше не нужны.
  const linked = await link.findLinkedUser(bot.tenant_id, tgUser.id);
  if (linked) {
    if (!linked.is_active) {
      await send(token, chatId, 'Ваш доступ отключён. Обратитесь к владельцу заведения.');
      return;
    }
    // Открытое обращение или только что нажата «Техподдержка» — сообщение уходит в поддержку.
    if (await support.handleBotMessage(token, linked, msg)) return;
    await send(token, chatId,
      `${linked.name || linked.login}, технологические карты — по кнопке ниже или «ТТК» в меню.\n\nВопрос или проблема — /support`,
      openButton(bot));
    return;
  }

  const text = String(msg.text || '').trim();
  const session = await link.getSession(bot.tenant_id, tgUser.id);

  if (session?.locked) {
    await send(token, chatId, `Слишком много неверных попыток. Попробуйте через ${link.LOCK_MINUTES} минут.`);
    return;
  }

  // /start, /cancel, любая команда, нет диалога или он устарел — начинаем с логина.
  if (!text || text.startsWith('/') || !session || session.stale) {
    await link.askLogin(bot.tenant_id, tgUser.id);
    await send(token, chatId, text === '/cancel' ? 'Хорошо, начнём заново. Отправьте логин.' : ASK_LOGIN);
    return;
  }

  if (session.step === 'login') {
    await link.rememberLogin(bot.tenant_id, tgUser.id, text);
    await send(token, chatId, 'Теперь отправьте пароль. Сообщение с паролем я сразу удалю из чата.\n\nОшиблись в логине — /cancel');
    return;
  }

  // step === 'password': пароль в истории чата не оставляем.
  tg.call(token, 'deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
  const result = await link.tryLink(bot.tenant_id, tgUser, text);

  switch (result.status) {
    case 'linked':
      await send(token, chatId,
        `Готово, ${result.user.name || result.user.login}! Telegram привязан — дальше пароль не нужен.\nТехнологические карты открываются кнопкой ниже или «ТТК» в меню.`,
        openButton(bot));
      break;
    case 'taken':
      await send(token, chatId, 'Этот сотрудник уже привязан к другому Telegram. Если это ваш аккаунт — попросите владельца заведения сбросить привязку в разделе «Команда».');
      break;
    case 'locked':
      await send(token, chatId, `Неверный логин или пароль. Слишком много попыток — вход заблокирован на ${result.lockedMinutes} минут.`);
      break;
    default:
      await send(token, chatId, `Неверный логин или пароль (осталось попыток: ${result.attemptsLeft}).\n\nОтправьте логин ещё раз.`);
  }
}

module.exports = { handle };
