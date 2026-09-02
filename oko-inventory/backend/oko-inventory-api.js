const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const store = require("./oko-inventory-store");

const FONT_REGULAR = path.join(__dirname, "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "fonts", "DejaVuSans-Bold.ttf");

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

// Combines the item's own static note (e.g. "на складе") with the причина
// of every приход/списание recorded within the exported period — the
// admin page's per-item "История" shows these already, this is what makes
// the Excel carry the same information instead of just the totals.
function buildExportNote(item, movements) {
  const lines = [];
  if (item.note) lines.push(item.note);
  for (const m of movements) {
    if (!m.note) continue;
    const sign = m.type === "приход" ? "+" : "−";
    lines.push(`${sign}${m.qty} (${formatRuDate(m.date)}): ${m.note}`);
  }
  return lines.join("\n");
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
      { header: "Примечание", key: "note", width: 28 },
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
        note: buildExportNote(row.item, row.movements),
        income: row.income || "",
        writeOff: row.writeOff || "",
        end: row.endBalance,
      });
      const noteLines = 1 + row.movements.filter((m) => m.note).length;
      sheet.getRow(rowIndex).height = Math.max(54, noteLines * 14 + 10);
      sheet.getCell(rowIndex, 7).alignment = { wrapText: true, vertical: "top" };

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

  // PDF export — a self-contained alternative to the Excel one. Built
  // because Google Sheets can silently drop floating/embedded images when
  // re-exporting a spreadsheet as PDF (or "send a copy") — a Google-side
  // limitation, not something wrong with the .xlsx this backend produces
  // (its own images are valid; confirmed by unzipping and inspecting the
  // OOXML drawing parts). Generating the PDF here, straight from the same
  // photo files on disk, means photos always come through regardless of
  // what any spreadsheet app's own export pipeline does with them.
  router.get("/export-pdf", (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Укажите from и to (YYYY-MM-DD)" });
    }

    const report = store.reportForPeriod(from, to);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-${from}_${to}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 36 });
    doc.pipe(res);
    doc.registerFont("body", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    doc.font("bold").fontSize(15).fillColor("#000")
      .text(`Инвентаризация — ${formatRuDate(from)} – ${formatRuDate(to)}`);
    doc.moveDown(0.6);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const photoSize = 46;
    const textX = left + photoSize + 12;
    const textWidth = right - textX;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    for (const row of report) {
      const note = buildExportNote(row.item, row.movements);
      const statsLine = `Было: ${row.startBalance}   →   Приход: +${row.income || 0}   Списание: −${row.writeOff || 0}   →   Стало: ${row.endBalance} ${row.item.unit}`;

      // Estimate this row's height before drawing anything, so we can
      // decide to start a fresh page first — pdfkit doesn't auto-paginate
      // text drawn past the bottom margin, it just draws off-page.
      doc.font("bold").fontSize(11);
      const nameHeight = doc.heightOfString(`№${row.item.number} ${row.item.name}`, { width: textWidth });
      doc.font("body").fontSize(9);
      const metaText = [row.item.size, row.item.unit].filter(Boolean).join(" · ");
      const metaHeight = metaText ? doc.heightOfString(metaText, { width: textWidth }) + 2 : 0;
      const statsHeight = doc.heightOfString(statsLine, { width: textWidth }) + 2;
      doc.fontSize(8);
      const noteHeight = note ? doc.heightOfString(note, { width: textWidth }) + 2 : 0;
      const rowHeight = Math.max(photoSize, nameHeight + metaHeight + statsHeight + noteHeight) + 10;

      if (doc.y + rowHeight > pageBottom) {
        doc.addPage();
      }

      const startY = doc.y;
      if (row.item.photo) {
        try {
          doc.image(store.photoPath(row.item.photo), left, startY, { fit: [photoSize, photoSize] });
        } catch {
          // missing/corrupt photo file — skip the image, keep the row
        }
      }

      doc.font("bold").fontSize(11).fillColor("#000")
        .text(`№${row.item.number} ${row.item.name}`, textX, startY, { width: textWidth });
      if (metaText) {
        doc.font("body").fontSize(9).fillColor("#555")
          .text(metaText, textX, doc.y, { width: textWidth });
      }
      doc.font("body").fontSize(9).fillColor("#000")
        .text(statsLine, textX, doc.y, { width: textWidth });
      if (note) {
        doc.font("body").fontSize(8).fillColor("#777")
          .text(note, textX, doc.y, { width: textWidth });
      }

      const consumedHeight = Math.max(photoSize, doc.y - startY);
      doc.y = startY + consumedHeight + 8;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#dddddd").lineWidth(0.5).stroke();
      doc.moveDown(0.5);
    }

    doc.end();
  });

  return router;
}

module.exports = { createOkoInventoryRouter };
