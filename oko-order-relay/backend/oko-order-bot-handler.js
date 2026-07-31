const { readConfig } = require("./oko-order-api");

/**
 * @param {import('node-telegram-bot-api')} bot existing bot instance
 */
function registerOkoOrderHandler(bot) {
  bot.on("message", (msg) => {
    if (!msg.web_app_data) return;

    let order;
    try {
      order = JSON.parse(msg.web_app_data.data);
    } catch {
      return;
    }

    const config = readConfig();
    const venueConfig = config[order.venue];
    if (!venueConfig) return;

    const submittedBy = msg.from.first_name || "Неизвестно";
    const itemsText = (order.items || [])
      .map((item) => `• ${item.name} — ${item.qty} шт.`)
      .join("\n");

    const text = [
      `Новый заказ: ${venueConfig.label}`,
      `📅 На дату: ${order.date}`,
      "",
      itemsText,
      order.comment ? `\n💬 ${order.comment}` : "",
      "",
      `Отправил: ${submittedBy}`,
    ]
      .filter(Boolean)
      .join("\n");

    const sendOptions = {};
    if (venueConfig.kitchenThreadId) {
      sendOptions.message_thread_id = Number(venueConfig.kitchenThreadId);
    }

    bot.sendMessage(venueConfig.kitchenGroupChatId, text, sendOptions);
  });
}

module.exports = { registerOkoOrderHandler };
