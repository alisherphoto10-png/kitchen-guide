const express = require("express");
const fs = require("fs");
const ExcelJS = require("exceljs");
const store = require("./oko-inventory-store");

function requireAdmin(req, res, next) {
  const password = req.header("X-Admin-Password");
  const expected = process.env.OKO_ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  next();
}

function formatRuDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function createOkoInventoryRouter() {
  const router = express.Router();

  // All routes here are admin-only — this tool has a single user (the
  // restaurant owner/admin), unlike oko-order-relay which also has public
  // routes for the order form itself.
  router.use(requireAdmin);

  router.get("/items", (req, res) => {
    res.json(store.listItemsWithBalance());
  });

  router.post("/items", (req, res) => {
    const { name, size, unit, note, photo, initialQty } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Укажите название позиции" });
    }
    const item = store.addItem({ name, size, unit, note, photo, initialQty });
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

  router.post("/items/:id/movement", (req, res) => {
    const { type, qty, date, note } = req.body || {};
    try {
      const movement = store.addMovement({ itemId: req.params.id, type, qty, date, note });
      res.json(movement);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/movements/:id", (req, res) => {
    const ok = store.deleteMovement(req.params.id);
    if (!ok) return res.status(404).json({ error: "Запись не найдена" });
    res.json({ ok: true });
  });

  // Photos: filenames are opaque random ids (see savePhoto in the store),
  // same "not publicized but not password-gated" posture oko-order-relay
  // itself uses for the order form — simplest thing that works for a
  // single-admin internal tool. Still nested under this router, which is
  // otherwise admin-gated by requireAdmin above, so add it *before*
  // router.use(requireAdmin) if you'd rather serve images without the
  // password header — left admin-gated here for now since nothing calls it
  // except the already-authenticated admin page's own <img> tags (fetched
  // as blobs, not plain <img src>, see frontend).
  router.get("/photos/:filename", (req, res) => {
    const filePath = store.photoPath(req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  // Excel export matching the original spreadsheet's columns: №,
  // Наименование, Фото, размер, Остаток на начало, Ед. изм, Примечание,
  // Приход, Списание, Остаток на конец — for an arbitrary [from, to] range.
  router.get("/export", async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Укажите from и to (YYYY-MM-DD)" });
    }

    const report = store.reportForPeriod(from, to);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Инвентаризация");

    sheet.columns = [
      { header: "№", key: "number", width: 6 },
      { header: "Наименование", key: "name", width: 28 },
      { header: "Фото", key: "photo", width: 14 },
      { header: "размер", key: "size", width: 12 },
      { header: `Остаток на начало\n${formatRuDate(from)}`, key: "start", width: 14 },
      { header: "Ед. изм", key: "unit", width: 8 },
      { header: "Примечание", key: "note", width: 20 },
      { header: "Приход", key: "income", width: 10 },
      { header: "Списание", key: "writeOff", width: 10 },
      { header: `Остаток на конец\n${formatRuDate(to)}`, key: "end", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };

    let rowIndex = 2;
    for (const row of report) {
      sheet.addRow({
        number: row.item.number,
        name: row.item.name,
        photo: "",
        size: row.item.size,
        start: row.startBalance,
        unit: row.item.unit,
        note: row.item.note,
        income: row.income || "",
        writeOff: row.writeOff || "",
        end: row.endBalance,
      });
      sheet.getRow(rowIndex).height = 54;

      if (row.item.photo) {
        try {
          const filePath = store.photoPath(row.item.photo);
          const ext = row.item.photo.split(".").pop();
          const imageId = workbook.addImage({
            filename: filePath,
            extension: ext === "jpg" ? "jpeg" : ext,
          });
          sheet.addImage(imageId, {
            tl: { col: 2, row: rowIndex - 1 },
            ext: { width: 60, height: 60 },
          });
        } catch {
          // missing/corrupt photo file — skip the image, keep the row
        }
      }
      rowIndex += 1;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="inventory-${from}_${to}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  });

  return router;
}

module.exports = { createOkoInventoryRouter };
