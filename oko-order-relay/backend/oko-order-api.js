const express = require("express");
const fs = require("fs");
const path = require("path");
const { readKnownChats, renameTopic } = require("./oko-known-chats");
const {
  createOrderId,
  saveOrder,
  getOrder,
  markAccepted,
  markCategoryAccepted,
  markFinalNotified,
} = require("./oko-order-store");

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

// Which categories does this particular order actually touch? Cross-references
// the ordered item names against the venue's menu (where categories live) —
// the order payload itself only carries {name, qty}, not category.
function getOrderCategories(order, venueConfig) {
  const categoryByName = {};
  (venueConfig.items || []).forEach((raw) => {
    const item = normalizeItem(raw);
    categoryByName[item.name] = item.category;
  });
  const categories = new Set();
  (order.items || []).forEach((orderItem) => {
    const category = categoryByName[orderItem.name];
    if (category) categories.add(category);
  });
  return categories;
}

// @username mentions work as plain text; people without a public username
// are tagged via a tg://user text-mention link instead, which needs their
// numeric id (captured earlier by recordPerson()).
function formatMention(cook) {
  return cook.username
    ? `@${cook.username}`
    : `<a href="tg://user?id=${cook.userId}">${escapeHtml(cook.label || "Повар")}</a>`;
}

// "Поварам: ..." line for the kitchen copy only — only cooks whose category
// actually appears in this order (plus cooks with no category, who are
// tagged on every order). Returns null when nobody qualifies, so callers can
// skip the line entirely instead of appending "Поварам: " with nothing after it.
function buildCookMentionsLine(order, venueConfig) {
  if (!venueConfig.cookMentions || !venueConfig.cookMentions.length) return null;
  const presentCategories = getOrderCategories(order, venueConfig);
  const relevant = venueConfig.cookMentions.filter((m) => !m.category || presentCategories.has(m.category));
  if (!relevant.length) return null;
  return `Поварам: ${relevant.map(formatMention).join(" ")}`;
}

// Groups this order's category-specific cook mentions by category, only for
// categories actually present in the order — each group becomes its own
// "✅ <категория>" accept button, tappable only by its assigned cook(s).
// Cooks with no category (tagged on every order) don't get their own button
// — they're a notification-only "Поварам:" mention, not a per-category gate.
function getCategoryCookGroups(order, venueConfig) {
  if (!venueConfig.cookMentions || !venueConfig.cookMentions.length) return [];
  const presentCategories = getOrderCategories(order, venueConfig);
  const categoryOrder = [];
  const byCategory = {};
  venueConfig.cookMentions.forEach((m) => {
    if (!m.category || !presentCategories.has(m.category)) return;
    if (!byCategory[m.category]) {
      byCategory[m.category] = [];
      categoryOrder.push(m.category);
    }
    byCategory[m.category].push(m);
  });
  return categoryOrder.map((category) => ({ category, cooks: byCategory[category] }));
}

function mentionMatchesUser(cook, from) {
  if (cook.userId && String(cook.userId) === String(from.id)) return true;
  if (cook.username && from.username && cook.username.toLowerCase() === from.username.toLowerCase()) return true;
  return false;
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

    // coreMessage is what the source group sees (in the "Заказ отправлен"
    // confirmation) — cook mentions are deliberately NOT part of it, they're
    // only relevant to whoever is in the kitchen group.
    const coreMessage = buildOrderMessage(order, venueConfig);
    const mentionsLine = buildCookMentionsLine(order, venueConfig);
    const kitchenMessage = coreMessage + (mentionsLine ? `\n\n${mentionsLine}` : "");
    const categoryGroups = getCategoryCookGroups(order, venueConfig);
    const orderId = createOrderId();

    // Two modes: if any category in this order has an assigned cook, each
    // gets its own accept button (gated to that cook). Otherwise fall back
    // to a single "✅ Принято" button anyone in the kitchen group can press —
    // same behaviour as before category-based tagging existed.
    let inlineKeyboard;
    let categoriesRecord = null;
    if (categoryGroups.length) {
      inlineKeyboard = categoryGroups.map((g, i) => [
        { text: `✅ ${g.category}`, callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}:${i}` },
      ]);
      categoriesRecord = categoryGroups.map((g) => ({
        name: g.category,
        cooks: g.cooks.map((c) => ({ label: c.label, username: c.username || null, userId: c.userId || null })),
        accepted: null,
      }));
    } else {
      inlineKeyboard = [[{ text: "✅ Принято", callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}` }]];
    }

    let kitchenSent;
    try {
      const kitchenOptions = { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } };
      if (venueConfig.kitchenThreadId) {
        kitchenOptions.message_thread_id = Number(venueConfig.kitchenThreadId);
      }
      kitchenSent = await bot.sendMessage(venueConfig.kitchenGroupChatId, kitchenMessage, kitchenOptions);
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
          `Заказ отправлен\n\n<blockquote>${coreMessage}</blockquote>`,
          sourceOptions,
        );
      } catch {
        // ignore — the order itself already went through
      }
    }

    // Persisted so the "✅ Принято" button(s) (pressed later, from the
    // kitchen group) know which two messages to update, and — in category
    // mode — who's actually allowed to press which button.
    saveOrder(orderId, {
      venue: order.venue,
      venueLabel: venueConfig.label,
      coreMessage,
      kitchenChatId: venueConfig.kitchenGroupChatId,
      kitchenMessageId: kitchenSent.message_id,
      sourceChatId: venueConfig.sourceGroupChatId || null,
      sourceMessageId: sourceSent ? sourceSent.message_id : null,
      categories: categoriesRecord,
      accepted: null,
      finalNotified: false,
      createdAt: Date.now(),
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
 * Handles taps on the "✅ Принято" button(s) attached to each order message
 * in the kitchen group. Two modes, depending on how the order was saved:
 *
 * - Generic (no category-specific cooks configured): one button, anyone in
 *   the kitchen group can tap it — same as before category tagging existed.
 * - Category mode: one button per category present in the order that has an
 *   assigned cook. Only that cook (matched by Telegram id or username) can
 *   accept it — anyone else gets a private "not for you" alert and nothing
 *   changes. Once every category button in the order has been accepted, a
 *   single final confirmation (with a per-category breakdown) is sent to the
 *   source group — not one message per category, per explicit request.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
function registerOrderAcceptHandler(bot) {
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith(ACCEPT_CALLBACK_PREFIX)) return;

    const rest = data.slice(ACCEPT_CALLBACK_PREFIX.length);
    const [orderId, catIndexStr] = rest.split(":");
    const order = getOrder(orderId);
    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Заказ не найден (возможно, устарел)", show_alert: true }).catch(() => {});
    }

    if (catIndexStr === undefined) {
      await handleGenericAccept(bot, orderId, order, query);
      return;
    }
    await handleCategoryAccept(bot, orderId, order, Number(catIndexStr), query);
  });
}

async function handleGenericAccept(bot, orderId, order, query) {
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
      `${order.coreMessage}\n\n✅ <b>Принято:</b> ${escapeHtml(updated.accepted.name)}, ${noteTime}`,
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
        `✅ Заказ принят кухней (${noteTime})\n\n<blockquote>${order.coreMessage}</blockquote>`,
        { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
      );
    } catch {
      // best effort
    }
  }

  await bot.answerCallbackQuery(query.id, { text: "Принято!" }).catch(() => {});
}

async function handleCategoryAccept(bot, orderId, order, catIndex, query) {
  const category = order.categories && order.categories[catIndex];
  if (!category) {
    return bot.answerCallbackQuery(query.id, { text: "Категория не найдена (возможно, устарела)", show_alert: true }).catch(() => {});
  }

  if (category.accepted) {
    const note = `Уже принято: ${category.accepted.name}, ${formatTime(category.accepted.at)}`;
    return bot.answerCallbackQuery(query.id, { text: note, show_alert: true }).catch(() => {});
  }

  const authorized = category.cooks.some((cook) => mentionMatchesUser(cook, query.from));
  if (!authorized) {
    return bot.answerCallbackQuery(query.id, { text: "Эта кнопка не для вас", show_alert: true }).catch(() => {});
  }

  const acceptedByName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
  const acceptedAt = Date.now();
  const updated = markCategoryAccepted(orderId, catIndex, { name: acceptedByName, at: acceptedAt });
  if (!updated) {
    return bot.answerCallbackQuery(query.id, { text: "Не удалось сохранить, попробуйте ещё раз", show_alert: true }).catch(() => {});
  }

  // Rebuild the whole keyboard: accepted categories show who/when in the
  // button label, pending ones are untouched — so progress is visible
  // directly on the message without needing to open it.
  const inlineKeyboard = updated.categories.map((cat, i) => [
    {
      text: cat.accepted ? `✅ ${cat.name} · ${cat.accepted.name}` : `✅ ${cat.name}`,
      callback_data: `${ACCEPT_CALLBACK_PREFIX}${orderId}:${i}`,
    },
  ]);
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: inlineKeyboard },
      { chat_id: order.kitchenChatId, message_id: order.kitchenMessageId },
    );
  } catch {
    // best effort — acceptance is already persisted either way
  }

  const allAccepted = updated.categories.every((cat) => cat.accepted);
  if (allAccepted && !updated.finalNotified && order.sourceChatId && order.sourceMessageId) {
    const breakdown = updated.categories
      .map((cat) => `${escapeHtml(cat.name)} — ${escapeHtml(cat.accepted.name)} (${formatTime(cat.accepted.at)})`)
      .join("\n");
    try {
      await bot.editMessageText(
        `✅ Заказ принят кухней:\n${breakdown}\n\n<blockquote>${order.coreMessage}</blockquote>`,
        { chat_id: order.sourceChatId, message_id: order.sourceMessageId, parse_mode: "HTML" },
      );
      markFinalNotified(orderId);
    } catch {
      // best effort
    }
  }

  await bot.answerCallbackQuery(query.id, { text: "Принято!" }).catch(() => {});
}

module.exports = { createOkoOrderRouter, registerOrderAcceptHandler, readConfig, writeConfig, CONFIG_PATH };
