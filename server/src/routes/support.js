// Техподдержка. mine — сотрудник (мини-апп): попросить бота принять обращение,
// история своих обращений. admin — администратор платформы: инбокс по всем
// заведениям, ответы, закрытие, настройка уведомлений в Telegram.
const express = require('express');
const { ah, toId } = require('../utils/http');
const { requirePlatformAdmin } = require('../middleware/auth');
const support = require('../services/support');
const notifier = require('../services/supportNotify');

const mine = express.Router();

mine.post('/request', ah(async (req, res) => res.json(await support.request(req.user))));
mine.get('/my', ah(async (req, res) => res.json(await support.myList(req.user.id))));
mine.get('/my/:id', ah(async (req, res) => res.json(await support.myGet(req.user.id, toId(req.params.id)))));

const admin = express.Router();
admin.use(requirePlatformAdmin);

admin.get('/summary', ah(async (req, res) => res.json(await support.summary())));
admin.get('/tickets', ah(async (req, res) => res.json(await support.list({ status: req.query.status }))));
admin.get('/tickets/:id', ah(async (req, res) => res.json(await support.get(toId(req.params.id)))));
admin.post('/tickets/:id/reply', ah(async (req, res) => res.json(await support.reply(toId(req.params.id), req.user, (req.body || {}).text))));
admin.post('/tickets/:id/close', ah(async (req, res) => res.json(await support.close(toId(req.params.id), req.user))));
admin.post('/tickets/:id/reopen', ah(async (req, res) => res.json(await support.reopen(toId(req.params.id)))));

admin.get('/notify', ah(async (req, res) => res.json(await notifier.get())));
admin.put('/notify/bot', ah(async (req, res) => res.json(await notifier.setBot((req.body || {}).token))));
admin.get('/notify/chats', ah(async (req, res) => res.json(await notifier.discoverChats())));
admin.put('/notify/chat', ah(async (req, res) => res.json(await notifier.setChat(req.body || {}))));
admin.delete('/notify', ah(async (req, res) => { await notifier.remove(); res.json(await notifier.get()); }));

module.exports = { mine, admin };
