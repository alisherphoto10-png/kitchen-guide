const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const store = require("./oko-inventory-store");
const inventoryTelegram = require("./oko-inventory-telegram");
const { readKnownChats } = require("./oko-known-chats");

const FONT_REGULAR = path.join(__dirname, "fonts", "DejaVuSans.ttf");

// Тот же приём экранирования, что и в oko-waiter-guide — имя позиции
// вводит администратор свободным текстом, теоретически может содержать
// служебные для Markdown символы (_, *, `, [), которые без экранирования
// либо сломают форматирование сообщения, либо случайно что-то выделят.
function escapeMd(value) {
  return String(value).replace(/([_*`[])/g, "\\$1");
}
const DIVIDER = "━━━━━━━━━━━━━━";
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

function createOkoInventoryRouter(bot) {
  const router = express.Router();

  // All routes here are admin-only — this tool has a single user (the
  // restaurant owner/admin), unlike oko-order-relay which also has public
  // routes for the order form itself.
  router.use(requireAdmin);

  router.get("/items", (req, res) => {
    res.json(store.listItemsWithBalance());
  });

  router.post("/items", (req, res) => {
    const { name, size, unit, note, photo, initialQty, categoryId } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Укажите название позиции" });
    }
    const item = store.addItem({ name, size, unit, note, photo, initialQty, categoryId });
    res.json(item);
  });

  // ---------- категории утвари ----------
  router.get("/categories", (req, res) => {
    res.json(store.readCategories());
  });

  router.post("/categories", (req, res) => {
    try {
      res.json(store.addCategory((req.body || {}).name));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/categories/:id", (req, res) => {
    try {
      const category = store.renameCategory(req.params.id, (req.body || {}).name);
      if (!category) return res.status(404).json({ error: "Категория не найдена" });
      res.json(category);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/categories/:id", (req, res) => {
    const ok = store.deleteCategory(req.params.id);
    if (!ok) return res.status(404).json({ error: "Категория не найдена" });
    res.json({ ok: true });
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

  // ---------- приход/списание из Telegram-темы (черновики на подтверждение) ----------
  router.get("/telegram-config", (req, res) => {
    res.json(inventoryTelegram.readConfig());
  });

  // Сразу шлёт видимое сообщение-подтверждение в саму тему — тот же приём,
  // что и "Подтвердить подключение" в oko-order-relay. Это заодно и
  // диагностика: если сообщение не дошло, значит дело не в подписи повара
  // и не в правах бота, а в том, что бэкенд деплоен без `bot` вообще —
  // отдельная, более базовая проблема (см. bot.sendMessageError в ответе).
  router.post("/telegram-config", async (req, res) => {
    const { chatId, threadId } = req.body || {};
    inventoryTelegram.writeConfig({ chatId, threadId });

    if (!bot || !chatId) {
      return res.json({ ok: true, confirmationSent: false });
    }
    try {
      const text = [
        "✅ *Тема подключена*",
        DIVIDER,
        "Кидайте сюда 📷 фото с короткой подписью, например:",
        "_«разбили 2 тарелки»_ или _«пришло 5 половников»_",
        "",
        "Я подготовлю черновик — подтвердить нужно будет в админке инвентаризации.",
      ].join("\n");
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        ...(threadId ? { message_thread_id: threadId } : {}),
      });
      res.json({ ok: true, confirmationSent: true });
    } catch (err) {
      res.json({ ok: true, confirmationSent: false, sendMessageError: err.message });
    }
  });

  // Список групп/тем, которые бот когда-либо видел — для выпадающего списка
  // в настройках (тот же общий файл, что и у oko-order-relay).
  router.get("/known-chats", (req, res) => {
    res.json(readKnownChats());
  });

  router.get("/drafts", (req, res) => {
    res.json(store.listPendingDrafts());
  });

  router.post("/drafts/:id/confirm", (req, res) => {
    const draft = store.readDrafts().find((d) => d.id === req.params.id);
    if (!draft || draft.status !== "pending") return res.status(404).json({ error: "Черновик не найден или уже обработан" });

    const { itemId, qty, direction, note } = req.body || {};
    const item = store.readItems().find((it) => it.id === itemId);
    if (!item) return res.status(400).json({ error: "Выберите позицию" });

    try {
      const composedNote = [note, draft.rawText, draft.fromName ? `Telegram: ${draft.fromName}` : ""]
        .filter(Boolean)
        .join(" — ");
      const movement = store.addMovement({
        itemId,
        type: direction === "приход" ? "приход" : "списание",
        qty,
        note: composedNote,
        photo: draft.photo,
        // Дата — когда повар прислал фото, а НЕ когда владелец подтвердил
        // черновик (это может случиться и неделю спустя) — иначе экспорт
        // за период показывал бы движение задним числом в чужом периоде.
        date: new Date(draft.createdAt).toISOString().slice(0, 10),
      });
      store.updateDraft(draft.id, { status: "confirmed", movementId: movement.id });

      if (bot && draft.chatId) {
        const sign = movement.type === "приход" ? "➕ Приход" : "➖ Списание";
        const text = [
          "✅ *Записано*",
          DIVIDER,
          `*${escapeMd(item.name)}*`,
          `${sign}: *${movement.qty} ${escapeMd(item.unit)}*`,
        ].join("\n");
        // Правим то же самое "Принято в обработку" на "Записано", а не шлём
        // новое сообщение — владелец разбирает черновики не сразу, иногда
        // раз в неделю, и заваливать тему повторными сообщениями на каждое
        // старое фото не нужно. Если по какой-то причине message_id того
        // сообщения не сохранился (например, отправка тогда не удалась) —
        // отправляем новое, как раньше, чтобы подтверждение не потерялось.
        const editOrSend = draft.botReplyMessageId
          ? bot.editMessageText(text, {
              chat_id: draft.chatId,
              message_id: draft.botReplyMessageId,
              parse_mode: "Markdown",
            })
          : bot.sendMessage(draft.chatId, text, {
              parse_mode: "Markdown",
              reply_to_message_id: draft.messageId,
              message_thread_id: draft.threadId || undefined,
            });
        editOrSend.catch(() => {});
      }
      res.json({ ok: true, movement });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Позиции ещё нет в каталоге (бот не нашёл похожих) — создаёт её прямо из
  // черновика, переиспользуя уже скачанное фото (без повторной загрузки).
  // Черновик остаётся "pending" — админка сама выбирает новую позицию в
  // выпадающем списке и подтверждает как обычно через /drafts/:id/confirm.
  router.post("/drafts/:id/create-item", (req, res) => {
    const draft = store.readDrafts().find((d) => d.id === req.params.id);
    if (!draft || draft.status !== "pending") return res.status(404).json({ error: "Черновик не найден или уже обработан" });

    const { name, categoryId, unit, size } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название позиции" });

    const item = store.addItem({
      name,
      categoryId,
      unit: unit || "шт",
      size,
      photoFilename: draft.photo || null,
    });
    res.json(item);
  });

  router.post("/drafts/:id/reject", (req, res) => {
    const draft = store.readDrafts().find((d) => d.id === req.params.id);
    if (!draft || draft.status !== "pending") return res.status(404).json({ error: "Черновик не найден или уже обработан" });
    store.updateDraft(draft.id, { status: "rejected" });
    res.json({ ok: true });
  });

  // ---------- пересчёт утвари (полная физическая инвентаризация) ----------
  router.get("/recount/eligible-count", (req, res) => {
    const categoryIds = String(req.query.categoryIds || "").split(",").filter(Boolean);
    res.json({ count: store.recountEligibleCount(categoryIds), total: store.readItems().length });
  });

  router.post("/recount", (req, res) => {
    const { categoryIds, validFrom, validUntil } = req.body || {};
    try {
      const session = store.createRecountSession({ categoryIds, validFrom, validUntil });
      res.json(store.recountAdminView(session.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/recount/latest", (req, res) => {
    const session = store.getLatestRecountSession();
    if (!session) return res.json(null);
    res.json(store.recountAdminView(session.id));
  });

  router.post("/recount/:id/close", (req, res) => {
    const session = store.closeRecountSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Сессия не найдена" });
    res.json(store.recountAdminView(session.id));
  });

  router.get("/recount/:id/review", (req, res) => {
    const review = store.recountReview(req.params.id);
    if (!review) return res.status(404).json({ error: "Сессия не найдена" });
    res.json(review);
  });

  router.post("/recount/:id/accept", (req, res) => {
    const { itemId, reason } = req.body || {};
    try {
      const result = store.acceptRecountEntry(req.params.id, itemId, reason);
      if (!result) return res.status(404).json({ error: "Запись не найдена" });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/recount/:id/accept-all-matching", (req, res) => {
    const result = store.acceptAllMatchingRecountEntries(req.params.id);
    if (!result) return res.status(404).json({ error: "Сессия не найдена" });
    res.json(result);
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
  // Табличная вёрстка (выбрана из двух макетов-мокапов) — плотная таблица
  // №/Фото/Наименование/Категория/Было/Приход/Списание/Стало/Примечание со
  // строкой "Итого" внизу, вместо прежнего построчного списка "карточками".
  router.get("/export-pdf", (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Укажите from и to (YYYY-MM-DD)" });
    }

    const report = store.reportForPeriod(from, to);
    const categoriesById = new Map(store.readCategories().map((c) => [c.id, c.name]));
    const categoryName = (id) => categoriesById.get(id) || "";
    // Категория видна отдельной колонкой (не группировкой, как в другом
    // макете) — сортируем по ней, чтобы одинаковые позиции всё равно шли
    // рядом, без категории — в конец.
    const sorted = report.slice().sort((a, b) => {
      const an = categoryName(a.item.categoryId);
      const bn = categoryName(b.item.categoryId);
      if (an !== bn) return an ? (bn ? an.localeCompare(bn, "ru") : -1) : 1;
      return a.item.number - b.item.number;
    });
    const incomeTotal = sorted.reduce((s, r) => s + (r.income || 0), 0);
    const writeOffTotal = sorted.reduce((s, r) => s + (r.writeOff || 0), 0);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-${from}_${to}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
    doc.pipe(res);
    doc.registerFont("body", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    // Колонки — ширины в points, сумма фиксированных = 383, остаток уходит
    // под "Примечание" (самый непредсказуемый по длине текст).
    const colNum = { x: left, w: 22 };
    const colPhoto = { x: colNum.x + colNum.w, w: 30 };
    const colName = { x: colPhoto.x + colPhoto.w, w: 105 };
    const colCategory = { x: colName.x + colName.w, w: 64 };
    const colStart = { x: colCategory.x + colCategory.w, w: 36 };
    const colIncome = { x: colStart.x + colStart.w, w: 40 };
    // "Списание" в заголовке (bold 8pt) само по себе занимает ~44pt —
    // колонка обязана быть шире этого, иначе слово переносится и обрезается
    // линией под шапкой таблицы.
    const colWriteOff = { x: colIncome.x + colIncome.w, w: 50 };
    const colEnd = { x: colWriteOff.x + colWriteOff.w, w: 36 };
    const colNote = { x: colEnd.x + colEnd.w, w: right - (colEnd.x + colEnd.w) };
    const photoBox = 22;

    function drawTableHeader() {
      const y = doc.y;
      doc.font("bold").fontSize(8).fillColor("#666");
      doc.text("№", colNum.x, y, { width: colNum.w });
      doc.text("Наименование", colName.x, y, { width: colName.w });
      doc.text("Категория", colCategory.x, y, { width: colCategory.w });
      doc.text("Было", colStart.x, y, { width: colStart.w - 4, align: "right" });
      doc.text("Приход", colIncome.x, y, { width: colIncome.w - 4, align: "right" });
      doc.text("Списание", colWriteOff.x, y, { width: colWriteOff.w - 4, align: "right" });
      doc.text("Стало", colEnd.x, y, { width: colEnd.w - 4, align: "right" });
      doc.text("Примечание", colNote.x, y, { width: colNote.w });
      doc.y = y + 12;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#1a1a1a").lineWidth(1.2).stroke();
      doc.y += 4;
    }

    doc.font("bold").fontSize(16).fillColor("#1a1a1a")
      .text(`Инвентаризация кухни`);
    doc.font("bold").fontSize(12).fillColor("#1a1a1a")
      .text(`Отчёт по инвентарю — ${formatRuDate(from)} – ${formatRuDate(to)}`);
    doc.font("body").fontSize(8).fillColor("#888")
      .text(`Сформировано ${formatRuDate(new Date().toISOString().slice(0, 10))} · ${sorted.length} ${sorted.length === 1 ? "позиция" : "позиций"}`);
    doc.moveDown(0.8);

    drawTableHeader();

    sorted.forEach((row, i) => {
      const note = buildExportNote(row.item, row.movements);
      doc.font("bold").fontSize(9);
      const nameHeight = doc.heightOfString(row.item.name, { width: colName.w - 4 });
      doc.font("body").fontSize(8.5);
      const catHeight = doc.heightOfString(categoryName(row.item.categoryId) || "—", { width: colCategory.w - 4 });
      const noteHeight = note ? doc.heightOfString(note, { width: colNote.w - 4 }) : 0;
      const rowHeight = Math.max(photoBox, nameHeight, catHeight, noteHeight) + 10;

      if (doc.y + rowHeight > pageBottom) {
        doc.addPage();
        drawTableHeader();
      }

      const y = doc.y;
      if (i % 2 === 0) {
        doc.rect(left, y - 2, right - left, rowHeight).fillColor("#fafaf9").fill();
      }

      if (row.item.photo) {
        try {
          doc.image(store.photoPath(row.item.photo), colPhoto.x, y, { fit: [photoBox, photoBox] });
        } catch {
          // missing/corrupt photo file — skip the image, keep the row
        }
      }

      doc.font("body").fontSize(8.5).fillColor("#888").text(String(row.item.number), colNum.x, y, { width: colNum.w });
      doc.font("bold").fontSize(9).fillColor("#1a1a1a").text(row.item.name, colName.x, y, { width: colName.w - 4 });
      doc.font("body").fontSize(8.5).fillColor("#666").text(categoryName(row.item.categoryId) || "—", colCategory.x, y, { width: colCategory.w - 4 });
      doc.font("body").fontSize(8.5).fillColor("#1a1a1a").text(String(row.startBalance), colStart.x, y, { width: colStart.w - 4, align: "right" });
      doc.font("body").fontSize(8.5).fillColor("#1e7a34").text(row.income ? String(row.income) : "—", colIncome.x, y, { width: colIncome.w - 4, align: "right" });
      doc.font("body").fontSize(8.5).fillColor("#c0392b").text(row.writeOff ? String(row.writeOff) : "—", colWriteOff.x, y, { width: colWriteOff.w - 4, align: "right" });
      doc.font("bold").fontSize(8.5).fillColor("#1a1a1a").text(String(row.endBalance), colEnd.x, y, { width: colEnd.w - 4, align: "right" });
      doc.font("body").fontSize(8.5).fillColor("#888").text(note || "—", colNote.x, y, { width: colNote.w - 4 });

      doc.y = y + rowHeight;
      doc.moveTo(left, doc.y - 3).lineTo(right, doc.y - 3).strokeColor("#e2e2e0").lineWidth(0.5).stroke();
    });

    if (doc.y + 24 > pageBottom) {
      doc.addPage();
      drawTableHeader();
    }
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#1a1a1a").lineWidth(1.2).stroke();
    doc.y += 6;
    doc.font("bold").fontSize(9).fillColor("#1a1a1a")
      .text("Итого за период", colCategory.x, doc.y, { width: colStart.x - colCategory.x, align: "right" });
    doc.font("bold").fontSize(9).fillColor("#1e7a34")
      .text(incomeTotal ? `+${incomeTotal}` : "—", colIncome.x, doc.y, { width: colIncome.w - 4, align: "right" });
    doc.font("bold").fontSize(9).fillColor("#c0392b")
      .text(writeOffTotal ? `−${writeOffTotal}` : "—", colWriteOff.x, doc.y, { width: colWriteOff.w - 4, align: "right" });

    // Подпись бренда на каждой странице — единообразно с другими модулями
    // KitchenDesk (пособие официанта, заказы между заведениями и т.д.),
    // рисуется отдельным проходом по уже готовым страницам (bufferPages),
    // а не по ходу вёрстки — иначе пришлось бы знать итоговое число
    // страниц заранее.
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      // Футер рисуется НИЖЕ обычного нижнего поля (в самом низу листа) — а
      // pdfkit по умолчанию добавляет НОВУЮ страницу для любого text(),
      // который оказался за пределами margins.bottom, даже с явными x/y.
      // Без этой временной обнуления поля вызов ниже сам плодил лишние
      // пустые страницы (было 3 вместо 1 при 5 позициях).
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - 26;
      doc.font("body").fontSize(7.5).fillColor("#aaa")
        .text("Сформировано через KitchenDesk", left, footerY, { width: (right - left) / 2, align: "left", lineBreak: false });
      doc.font("body").fontSize(7.5).fillColor("#aaa")
        .text(`Страница ${i + 1} из ${pageCount}`, left + (right - left) / 2, footerY, { width: (right - left) / 2, align: "right", lineBreak: false });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });

  return router;
}

// Отдельный, не защищённый паролем роутер — для страницы, которую владелец
// скидывает поварам одноразовой ссылкой (см. createRecountSession в
// store). Секрет тут — сам токен в ссылке (криптослучайный, см.
// crypto.randomBytes в store), а не X-Admin-Password: поварам этот пароль
// не выдаём. Держим отдельно от createOkoInventoryRouter(), у которого
// router.use(requireAdmin) навешан на весь роутер целиком — проще завести
// второй роутер, чем разбирать авторизацию по каждому урлу там.
function createOkoInventoryCountRouter() {
  const router = express.Router();

  function loadOpenSession(req, res) {
    const session = store.getRecountByToken(req.params.token);
    if (!session) {
      res.status(404).json({ error: "Ссылка не найдена" });
      return null;
    }
    if (session.closedAt || !store.recountIsOpenForCooks(session)) {
      res.status(410).json({ error: "Пересчёт уже завершён или ссылка больше не действует" });
      return null;
    }
    return session;
  }

  router.get("/:token", (req, res) => {
    const session = loadOpenSession(req, res);
    if (!session) return;
    const categories = store.readCategories().filter((c) => session.categoryIds.includes(c.id));
    res.json({
      validFrom: session.validFrom,
      validUntil: session.validUntil,
      categories,
      items: store.recountCountList(session),
    });
  });

  router.post("/:token/entry", (req, res) => {
    const session = loadOpenSession(req, res);
    if (!session) return;
    const { itemId, qty, name } = req.body || {};
    const item = store.readItems().find((it) => it.id === itemId && session.categoryIds.includes(it.categoryId));
    if (!item) return res.status(400).json({ error: "Позиция не найдена в этом пересчёте" });
    try {
      const entry = store.recordRecountEntry(session.id, itemId, qty, name);
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Тот же принцип, что и /photos/:filename у админки — непубличные, но не
  // защищённые паролем имена файлов; тут вдобавок нужен валидный токен
  // сессии, чтобы просто открыть фотку.
  router.get("/:token/photos/:filename", (req, res) => {
    const session = store.getRecountByToken(req.params.token);
    if (!session) return res.status(404).end();
    const filePath = store.photoPath(req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  return router;
}

module.exports = {
  createOkoInventoryRouter,
  createOkoInventoryCountRouter,
  registerInventoryDraftListener: inventoryTelegram.registerInventoryDraftListener,
};
