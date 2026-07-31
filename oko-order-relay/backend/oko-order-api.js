const express = require("express");
const fs = require("fs");
const path = require("path");
const { readKnownChats, renameTopic } = require("./oko-known-chats");

const CONFIG_PATH = path.join(__dirname, "data", "oko-order-config.json");

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function requireAdmin(req, res, next) {
  const password = req.header("X-Admin-Password");
  const expected = process.env.OKO_ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  next();
}

function buildOrderMessage(order, venueConfig) {
  const itemsText = (order.items || [])
    .map((item) => `• ${item.name} — ${item.qty} шт.`)
    .join("\n");

  return [
    `Новый заказ: ${venueConfig.label}`,
    `📅 На дату: ${order.date}`,
    "",
    itemsText,
    order.comment ? `\n💬 ${order.comment}` : "",
    "",
    order.name ? `Отправил: ${order.name}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {import('node-telegram-bot-api')} bot existing bot instance, used to
 *   (re)send and pin the "Заполнить заказ" button, and to relay submitted
 *   orders into the kitchen group.
 */
function createOkoOrderRouter(bot) {
  const router = express.Router();

  // Public — the order form reads the current item list for a venue.
  router.get("/items", (req, res) => {
    const venue = req.query.venue;
    const config = readConfig();
    if (!config[venue]) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }
    res.json({ label: config[venue].label, items: config[venue].items });
  });

  // Public — the order form submits here directly. Telegram only allows
  // web_app buttons (and their sendData() bridge) in private chats, not in
  // groups, so a group-posted button can't rely on that path — the form
  // instead POSTs straight to the backend, which relays into the kitchen
  // group itself.
  router.post("/submit", async (req, res) => {
    const order = req.body;
    const config = readConfig();
    const venueConfig = config[order && order.venue];
    if (!venueConfig) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }
    if (!Array.isArray(order.items) || !order.items.length) {
      return res.status(400).json({ error: "Добавьте хотя бы одну позицию" });
    }
    if (!venueConfig.kitchenGroupChatId) {
      return res.status(400).json({ error: "Для этого заведения не настроена поварская группа" });
    }

    try {
      const sendOptions = {};
      if (venueConfig.kitchenThreadId) {
        sendOptions.message_thread_id = Number(venueConfig.kitchenThreadId);
      }
      await bot.sendMessage(venueConfig.kitchenGroupChatId, buildOrderMessage(order, venueConfig), sendOptions);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin — full config (routing IDs + items) for both venues.
  router.get("/admin/config", requireAdmin, (req, res) => {
    res.json(readConfig());
  });

  // Admin — groups/topics the bot has seen activity in (for the dropdown
  // pickers). Telegram has no "list my chats" API, so this is only ever as
  // complete as whatever activity has happened since discovery was deployed.
  router.get("/admin/known-chats", requireAdmin, (req, res) => {
    res.json(readKnownChats());
  });

  // Admin — manually label a topic Telegram never gave us a name for
  // (it only reports a topic's name at creation time).
  router.post("/admin/known-chats/rename-topic", requireAdmin, (req, res) => {
    const { chatId, threadId, name } = req.body || {};
    if (!chatId || !threadId || !name) {
      return res.status(400).json({ error: "Нужны chatId, threadId и name" });
    }
    renameTopic(chatId, threadId, name);
    res.json({ ok: true });
  });

  router.post("/admin/config", requireAdmin, (req, res) => {
    const next = req.body;
    if (!next || !next.oblako || !next.myaso) {
      return res.status(400).json({ error: "Некорректный формат конфига" });
    }
    writeConfig(next);
    res.json({ ok: true });
  });

  // Admin — (re)send and pin the order-form button in a venue's source topic.
  // Must be a plain `url` button, not `web_app` — Telegram rejects web_app
  // buttons outside private chats (BUTTON_TYPE_INVALID).
  router.post("/admin/pin-button", requireAdmin, async (req, res) => {
    const { venue } = req.body;
    const config = readConfig();
    const venueConfig = config[venue];
    if (!venueConfig) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }
    if (!venueConfig.sourceGroupChatId) {
      return res.status(400).json({ error: "Не указан ID исходной группы для этого заведения" });
    }

    try {
      const sendOptions = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📝 Заполнить заказ",
                url: `${process.env.OKO_ORDER_FORM_URL}?venue=${venue}`,
              },
            ],
          ],
        },
      };
      if (venueConfig.sourceThreadId) {
        sendOptions.message_thread_id = Number(venueConfig.sourceThreadId);
      }

      const sent = await bot.sendMessage(
        venueConfig.sourceGroupChatId,
        "Заполните заказ на нужную дату 👇",
        sendOptions,
      );
      await bot.pinChatMessage(venueConfig.sourceGroupChatId, sent.message_id);
      res.json({ ok: true, messageId: sent.message_id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createOkoOrderRouter, readConfig, writeConfig, CONFIG_PATH };
