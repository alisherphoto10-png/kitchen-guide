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

  return router;
}

module.exports = { createOkoShelfLifeRouter };
