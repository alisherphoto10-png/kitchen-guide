const express = require("express");
const fs = require("fs");
const path = require("path");

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

/**
 * @param {import('node-telegram-bot-api')} bot existing bot instance, used to
 *   (re)send and pin the "Заполнить заказ" button from the admin page.
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

  // Admin — full config (routing IDs + items) for both venues.
  router.get("/admin/config", requireAdmin, (req, res) => {
    res.json(readConfig());
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
                web_app: { url: `${process.env.OKO_ORDER_FORM_URL}?venue=${venue}` },
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
