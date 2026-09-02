const express = require("express");
const fs = require("fs");
const store = require("./oko-waiter-guide-store");

function requireAdmin(req, res, next) {
  const password = req.header("X-Admin-Password");
  const expected = process.env.OKO_ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  next();
}

function createOkoWaiterGuideRouter() {
  const router = express.Router();

  // ---------- public — the read-only page waiters open, no password ----------
  // (same posture as oko-order-relay's order form: not a secret, just an
  // unlisted link — this is reference material, not sensitive data).
  router.get("/guide", (req, res) => {
    res.json(store.getGuide());
  });

  router.get("/photos/:filename", (req, res) => {
    const filePath = store.photoPath(req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  // ---------- admin — editing, password-gated ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get("/sections", (req, res) => {
    res.json(store.readSections());
  });
  admin.post("/sections", (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название раздела" });
    res.json(store.addSection({ name }));
  });
  admin.patch("/sections/:id", (req, res) => {
    const section = store.updateSection(req.params.id, req.body || {});
    if (!section) return res.status(404).json({ error: "Раздел не найден" });
    res.json(section);
  });
  admin.delete("/sections/:id", (req, res) => {
    const ok = store.deleteSection(req.params.id);
    if (!ok) return res.status(404).json({ error: "Раздел не найден" });
    res.json({ ok: true });
  });
  admin.post("/sections/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "Нужен orderedIds" });
    store.reorderSections(orderedIds);
    res.json({ ok: true });
  });

  admin.get("/dishes", (req, res) => {
    res.json(store.readDishes());
  });
  admin.post("/dishes", (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название блюда" });
    res.json(store.addDish(req.body || {}));
  });
  admin.patch("/dishes/:id", (req, res) => {
    const dish = store.updateDish(req.params.id, req.body || {});
    if (!dish) return res.status(404).json({ error: "Блюдо не найдено" });
    res.json(dish);
  });
  admin.delete("/dishes/:id", (req, res) => {
    const ok = store.deleteDish(req.params.id);
    if (!ok) return res.status(404).json({ error: "Блюдо не найдено" });
    res.json({ ok: true });
  });
  admin.post("/dishes/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "Нужен orderedIds" });
    store.reorderDishes(orderedIds);
    res.json({ ok: true });
  });

  admin.get("/orphan-dishes", (req, res) => {
    res.json(store.getOrphanDishes());
  });

  router.use("/admin", admin);

  return router;
}

module.exports = { createOkoWaiterGuideRouter };
