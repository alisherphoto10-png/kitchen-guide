// Стенд oko-order: тот же роутер, что пойдёт в прод, но бот — заглушка
// (или настоящий бот без polling при REAL_BOT=1), данные — копия.
process.env.OKO_ADMIN_PASSWORD = "staging-pass";
process.env.OKO_ORDER_FORM_URL = process.env.FORM_URL || "https://kitchendesk.chefplan.ru/oko-order/";
const express = require("express");
const path = require("path");
const fs = require("fs");
const { createOkoOrderRouter, registerOrderAcceptHandler } = require("./src/oko-order-api");

function makeStubBot() {
  let nextId = 1000;
  const calls = [];
  const handlers = {};
  const failures = {};
  const bot = {
    calls, handlers, failures,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  };
  for (const m of ["sendMessage", "sendPhoto", "sendDocument", "pinChatMessage", "editMessageReplyMarkup", "editMessageText", "answerCallbackQuery"]) {
    bot[m] = async (...args) => {
      calls.push({ m, args });
      if (failures[m] > 0) { failures[m] -= 1; throw new Error(`stub ${m} failure`); }
      return m === "sendMessage" ? { message_id: nextId++ } : true;
    };
  }
  return bot;
}

let bot;
if (process.env.REAL_BOT === "1") {
  require("dotenv").config({ path: "/root/kitchendesk/backend/.env" });
  process.env.OKO_ADMIN_PASSWORD = "staging-pass";
  const TelegramBot = require("node-telegram-bot-api");
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
} else {
  bot = makeStubBot();
}

const app = express();
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "10mb" }));
app.use("/api/oko-order", createOkoOrderRouter(bot));
registerOrderAcceptHandler(bot);
app.use(express.static(path.join(__dirname, "frontend")));
// тестовые ручки стенда
app.get("/__calls", (req, res) => res.json(bot.calls || []));
app.post("/__fail", (req, res) => { Object.assign(bot.failures, req.body); res.json({ ok: true }); });
app.post("/__message", async (req, res) => { for (const h of bot.handlers.message || []) await h(req.body); res.json({ ok: true }); });
app.post("/__callback", async (req, res) => { for (const h of bot.handlers.callback_query || []) await h(req.body); res.json({ ok: true }); });
const port = Number(process.env.PORT || 3099);
app.listen(port, "127.0.0.1", () => console.log("staging on", port));
module.exports = { app, bot };
