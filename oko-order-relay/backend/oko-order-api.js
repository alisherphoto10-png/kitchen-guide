const express = require("express");
const fs = require("fs");
const path = require("path");
const { readKnownChats, renameTopic } = require("./oko-known-chats");
const { createOrderId, saveOrder, getOrder, markAccepted } = require("./oko-order-store");

const ACCEPT_CALLBACK_PREFIX = "oko_accept:";

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

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

// Menu items can be a plain string (legacy, no category) or an
// { name, category } object — normalized here so the order form always gets
// a consistent shape regardless of which one is stored in the config.
function normalizeItem(item) {
  if (typeof item === "string") return { name: item, category: null };
  return { name: item.name, category: item.category || null };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Telegram HTML parse_mode: venue name and the date are shown in a fixed-width
// <code> span, comment gets its own <code> block. Every value that can come
// from user input (comment, submitter name, item name) is HTML-escaped —
// otherwise someone typing "<b>" into the form could break the message
// formatting or inject tags.
function buildOrderMessage(order, venueConfig) {
  const itemsText = (order.items || [])
    .map((item) => `• ${escapeHtml(item.name)} — ${escapeHtml(item.qty)} шт.`)
    .join("\n");

  const lines = [
    `<b>Новый заказ — <code>${escapeHtml(venueConfig.label)}</code></b>`,
    "",
    `📅 Дата: <code>${escapeHtml(order.date)}</code>`,
    "",
    "Позиции:",
    itemsText,
  ];

  if (order.comment) {
    lines.push("", "", `💬 Комментарий:`, `<code>${escapeHtml(order.comment)}</code>`);
  }

  if (order.name) {
    lines.push("", `Отправил: ${escapeHtml(order.name)}`);
  }

  return lines.join("\n");
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
    res.json({ label: config[venue].label, items: config[venue].items.map(normalizeItem) });
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

    const orderMessage = buildOrderMessage(order, venueConfig);
    const orderId = createOrderId();

    let kitchenSent;
    try {
      const kitchenOptions = {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "✅ Принято", callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}` }]],
        },
      };
      if (venueConfig.kitchenThreadId) {
        kitchenOptions.message_thread_id = Number(venueConfig.kitchenThreadId);
      }
      kitchenSent = await bot.sendMessage(venueConfig.kitchenGroupChatId, orderMessage, kitchenOptions);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    // Best-effort confirmation back in the topic the order was placed from —
    // a failure here shouldn't fail the request, the order already reached
    // the kitchen group.
    let sourceSent = null;
    if (venueConfig.sourceGroupChatId) {
      try {
        const sourceOptions = { parse_mode: "HTML" };
        if (venueConfig.sourceThreadId) {
          sourceOptions.message_thread_id = Number(venueConfig.sourceThreadId);
        }
        sourceSent = await bot.sendMessage(
          venueConfig.sourceGroupChatId,
          `Заказ отправлен\n\n<blockquote>${orderMessage}</blockquote>`,
          sourceOptions,
        );
      } catch {
        // ignore — the order itself already went through
      }
    }

    // Persisted so the "✅ Принято" button (pressed later, from the kitchen
    // group) knows which two messages to update.
    saveOrder(orderId, {
      venue: order.venue,
      venueLabel: venueConfig.label,
      orderMessage,
      kitchenChatId: venueConfig.kitchenGroupChatId,
      kitchenMessageId: kitchenSent.message_id,
      sourceChatId: venueConfig.sourceGroupChatId || null,
      sourceMessageId: sourceSent ? sourceSent.message_id : null,
      createdAt: Date.now(),
      accepted: null,
    });

    res.json({ ok: true });
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

  // Admin — send a visible test message into a specific chat/topic so the
  // admin can look in Telegram and see exactly which real topic a numeric
  // thread_id belongs to, instead of guessing from a bare number.
  router.post("/admin/test-ping", requireAdmin, async (req, res) => {
    const { chatId, threadId } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ error: "Нужен chatId" });
    }
    try {
      const options = {};
      if (threadId) options.message_thread_id = Number(threadId);
      const label = threadId ? `теме с ID ${threadId}` : "этой группе (без темы)";
      await bot.sendMessage(chatId, `🔎 Тест-пинг из админки OKO — если видите это сообщение здесь, значит вы смотрите на ${label}.`, options);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/admin/config", requireAdmin, (req, res) => {
    const next = req.body;
    if (!next || !next.oblako || !next.myaso) {
      return res.status(400).json({ error: "Некорректный формат конфига" });
    }
    writeConfig(next);
    res.json({ ok: true });
  });

  // Admin — after wiring up a venue's source/kitchen IDs, post a visible
  // confirmation into each so there's no doubt setup actually took.
  router.post("/admin/confirm-connection", requireAdmin, async (req, res) => {
    const { venue } = req.body || {};
    const config = readConfig();
    const venueConfig = config[venue];
    if (!venueConfig) {
      return res.status(404).json({ error: "Неизвестное заведение" });
    }

    const notified = [];
    try {
      if (venueConfig.sourceGroupChatId) {
        const opts = {};
        if (venueConfig.sourceThreadId) opts.message_thread_id = Number(venueConfig.sourceThreadId);
        await bot.sendMessage(
          venueConfig.sourceGroupChatId,
          `✅ Эта тема подключена в системе OKO как источник заказов для «${venueConfig.label}».`,
          opts,
        );
        notified.push("source");
      }
      if (venueConfig.kitchenGroupChatId) {
        const opts = {};
        if (venueConfig.kitchenThreadId) opts.message_thread_id = Number(venueConfig.kitchenThreadId);
        await bot.sendMessage(
          venueConfig.kitchenGroupChatId,
          `✅ Эта группа/тема подключена в системе OKO — сюда будут приходить заказы для «${venueConfig.label}».`,
          opts,
        );
        notified.push("kitchen");
      }
      if (!notified.length) {
        return res.status(400).json({ error: "Не заполнены ни исходная, ни поварская группа" });
      }
      res.json({ ok: true, notified });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

/**
 * Handles taps on the "✅ Принято" button attached to each order message in
 * the kitchen group. Any member of that group can tap it — access is already
 * implicitly limited to whoever the owner added there, same as with a plain
 * text order today. First tap wins: the kitchen message loses its button and
 * gets an "accepted by/at" note, and the source group's "Заказ отправлен"
 * confirmation is updated the same way, so the source side can see the
 * order wasn't just sent but actually seen.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
function registerOrderAcceptHandler(bot) {
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith(ACCEPT_CALLBACK_PREFIX)) return;

    const orderId = data.slice(ACCEPT_CALLBACK_PREFIX.length);
    const order = getOrder(orderId);
    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Заказ не найден (возможно, устарел)", show_alert: true }).catch(() => {});
    }

    if (order.accepted) {
      const note = `Уже принято: ${order.accepted.name}, ${formatTime(order.accepted.at)}`;
      return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
    }

    const acceptedByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
    const acceptedAt = Date.now();
    const updated = markAccepted(orderId, { name: acceptedByName, at: acceptedAt });
    const noteTime = formatTime(acceptedAt);

    try {
      await bot.editMessageText(
        `${order.orderMessage}\n\n✅ <b>Принято:</b> ${escapeHtml(updated.accepted.name)}, ${noteTime}`,
        {
          chat_id: order.kitchenChatId,
          message_id: order.kitchenMessageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [] },
        },
      );
    } catch {
      // best effort — the accepted state is already persisted either way
    }

    if (order.sourceChatId && order.sourceMessageId) {
      try {
        await bot.editMessageText(
          `✅ Заказ принят кухней (${noteTime})\n\n<blockquote>${order.orderMessage}</blockquote>`,
          { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
        );
      } catch {
        // best effort
      }
    }

    await bot.answerCallbackQuery(query.id, { text: "Принято!" }).catch(() => {});
  });
}

module.exports = { createOkoOrderRouter, registerOrderAcceptHandler, readConfig, writeConfig, CONFIG_PATH };
