const fs = require("fs");
const path = require("path");

const KNOWN_CHATS_PATH = path.join(__dirname, "data", "oko-known-chats.json");

function readKnownChats() {
  try {
    return JSON.parse(fs.readFileSync(KNOWN_CHATS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeKnownChats(chats) {
  fs.writeFileSync(KNOWN_CHATS_PATH, JSON.stringify(chats, null, 2), "utf8");
}

function recordChat(chatId, title, type) {
  const chats = readKnownChats();
  const key = String(chatId);
  const existing = chats[key] || { topics: {} };
  chats[key] = {
    title: title || existing.title || key,
    type: type || existing.type || "unknown",
    topics: existing.topics || {},
  };
  writeKnownChats(chats);
}

function recordTopic(chatId, threadId, name) {
  if (!threadId) return;
  const chats = readKnownChats();
  const key = String(chatId);
  if (!chats[key]) {
    chats[key] = { title: key, type: "unknown", topics: {} };
  }
  const threadKey = String(threadId);
  chats[key].topics[threadKey] = name || chats[key].topics[threadKey] || `Тема #${threadKey}`;
  writeKnownChats(chats);
}

/**
 * Explicit admin override — always overwrites, unlike recordTopic() which
 * only fills in a name when one wasn't already known. Telegram only reports
 * a topic's real name at the moment it's created, so pre-existing topics
 * have no way to be discovered automatically; this lets an admin label them.
 */
function renameTopic(chatId, threadId, customName) {
  const chats = readKnownChats();
  const key = String(chatId);
  if (!chats[key]) {
    chats[key] = { title: key, type: "unknown", topics: {} };
  }
  chats[key].topics[String(threadId)] = customName;
  writeKnownChats(chats);
}

/**
 * Telegram has no "list my chats" API for bots — this is the only way:
 * remember every group/topic the bot has ever seen activity in, going
 * forward. A group/topic only shows up here after at least one message
 * (or the bot being added) happens there post-deploy.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
function registerChatDiscovery(bot) {
  bot.on("my_chat_member", (update) => {
    const chat = update.chat;
    if (chat.type === "group" || chat.type === "supergroup") {
      recordChat(chat.id, chat.title, chat.type);
    }
  });

  bot.on("message", (msg) => {
    if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") return;
    recordChat(msg.chat.id, msg.chat.title, msg.chat.type);
    if (msg.message_thread_id) {
      const topicName = msg.forum_topic_created ? msg.forum_topic_created.name : null;
      recordTopic(msg.chat.id, msg.message_thread_id, topicName);
    }
  });
}

/**
 * /okoid — typed directly in a group/topic, replies with that chat's ID and
 * (if applicable) the current topic's thread_id, so IDs can be read off
 * without ever opening the admin page. Namespaced as "okoid" rather than a
 * bare "/id" to avoid colliding with any existing bot command.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
function registerIdCommand(bot) {
  bot.onText(/^\/okoid/, (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;

    const lines = [`🆔 ID этого чата: ${chatId}`];
    if (threadId) {
      lines.push(`🆔 ID этой темы: ${threadId}`);
    } else {
      lines.push("Это общий поток группы (не отдельная тема).");
    }

    const options = { reply_to_message_id: msg.message_id };
    if (threadId) options.message_thread_id = threadId;

    bot.sendMessage(chatId, lines.join("\n"), options);
  });
}

module.exports = {
  readKnownChats,
  recordChat,
  recordTopic,
  renameTopic,
  registerChatDiscovery,
  registerIdCommand,
  KNOWN_CHATS_PATH,
};
