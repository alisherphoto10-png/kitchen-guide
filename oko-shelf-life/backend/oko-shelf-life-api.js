const express = require("express");
const store = require("./oko-shelf-life-store");

function requireAdmin(req, res, next) {
  const password = req.header("X-Admin-Password");
  const expected = process.env.OKO_ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  next();
}

// Справочник сроков хранения заготовок (ПФ) — общий пароль с остальными
// oko-модулями (OKO_ADMIN_PASSWORD), один владелец на все инструменты.
function createOkoShelfLifeRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  router.get("/items", (req, res) => {
    res.json(store.readItems());
  });

  router.post("/items", (req, res) => {
    const { name, storageCondition, shelfLifeText, note, categoryHint } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Укажите название заготовки" });
    }
    const item = store.addItem({ name, storageCondition, shelfLifeText, note, categoryHint });
    res.json(item);
  });

  router.patch("/items/:id", (req, res) => {
    const item = store.updateItem(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: "Позиция не найдена" });
    res.json(item);
  });

  router.delete("/items/:id", (req, res) => {
    const ok = store.deleteItem(req.params.id);
    if (!ok) return res.status(404).json({ error: "Позиция не найдена" });
    res.json({ ok: true });
  });

  // Владельцу — что вообще печаталось (и что ещё не забрал агент), без
  // отдельного пароля агента.
  router.get("/print-jobs", (req, res) => {
    res.json(store.listRecentPrintJobs(Number(req.query.limit) || 50));
  });

  return router;
}

function requireAgent(req, res, next) {
  const token = req.header("X-Agent-Token");
  const expected = process.env.OKO_SHELF_LIFE_AGENT_TOKEN;
  if (!expected || token !== expected) {
    return res.status(401).json({ error: "Неверный токен агента" });
  }
  next();
}

// Отдельный роутер БЕЗ пароля админки — им пользуются повара напрямую
// (пароль от справочника/инвентаризации им ни к чему), плюс локальный
// агент на моноблоке (свой отдельный секрет — OKO_SHELF_LIFE_AGENT_TOKEN,
// НЕ общий OKO_ADMIN_PASSWORD, чтобы у агента не было прав редактировать
// справочник, только читать очередь печати). Тот же принцип, что и
// публичный роутер повара для пересчёта утвари (oko-inventory-count) —
// проще отдельный роутер, чем разбирать авторизацию по каждому урлу.
function createOkoShelfLifePrintRouter() {
  const router = express.Router();

  // Лёгкий список для поиска/выбора — без storageCondition/note, поварам
  // это не нужно на экране печати, только название и распознанный срок
  // (чтобы можно было сразу показать "годен до ...", ещё до печати).
  router.get("/items", (req, res) => {
    const items = store.readItems().map((it) => ({
      id: it.id,
      name: it.name,
      shelfLifeText: it.shelfLifeText,
      shelfLifeHours: it.shelfLifeHours,
    }));
    res.json(items);
  });

  router.post("/jobs", (req, res) => {
    const { itemId, action, by } = req.body || {};
    try {
      const job = store.createPrintJob({ itemId, action, by });
      res.json(job);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/jobs/pending", requireAgent, (req, res) => {
    res.json(store.listPendingPrintJobs());
  });

  router.post("/jobs/:id/done", requireAgent, (req, res) => {
    const job = store.markPrintJobDone(req.params.id);
    if (!job) return res.status(404).json({ error: "Задание не найдено" });
    res.json(job);
  });

  return router;
}

module.exports = { createOkoShelfLifeRouter, createOkoShelfLifePrintRouter };
