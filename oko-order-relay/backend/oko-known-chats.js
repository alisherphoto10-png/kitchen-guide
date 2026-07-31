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

module.exports = { readKnownChats, recordChat, recordTopic, registerChatDiscovery, KNOWN_CHATS_PATH };
