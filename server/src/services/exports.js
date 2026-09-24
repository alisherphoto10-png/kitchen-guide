// Выгрузка ТТК в PDF и Excel. Делается на сервере (а не в браузере, как в
// KitchenDesk), чтобы тот же файл мог отдать и будущий Telegram-бот.
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const config = require('../config');

const FONT = path.join(config.fontsDir, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(config.fontsDir, 'DejaVuSans-Bold.ttf');

function fmt(n) {
  if (n == null) return '';
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function yieldText(r) {
  const parts = [];
  if (r.yield_weight != null) parts.push(`${fmt(r.yield_weight)} ${r.yield_unit || 'кг'}`);
  if (r.yield_count != null) parts.push(`${fmt(r.yield_count)} порц.`);
  return parts.join(' · ') || '—';
}

function kbjuLines(r) {
  return [
    ['Калории', r.calories, 'ккал'], ['Белки', r.protein, 'г'], ['Жиры', r.fat, 'г'], ['Углеводы', r.carbs, 'г'],
  ].filter(([, v]) => v != null);
}

function fileBase(r) {
  return (r.name || 'ttk').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ttk';
}

function photoPath(r) {
  if (!r.photo) return null;
  const p = path.join(config.uploadsDir, path.basename(r.photo));
  return /\.(jpe?g|png)$/i.test(p) && fs.existsSync(p) ? p : null;
}

// ── PDF ──────────────────────────────────────────────────────────────

function pdf(recipe, { tenantName }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: recipe.name } });
  doc.registerFont('r', FONT);
  doc.registerFont('b', FONT_BOLD);
  const W = doc.page.width - 96;
  const INK = '#1c1a17', MUTED = '#7a746b', LINE = '#ddd6cb', ACCENT = '#b4471f';

  doc.font('r').fontSize(9).fillColor(MUTED).text(`Технологическая карта · ${tenantName}`, { width: W });
  doc.moveDown(0.3);
  doc.font('b').fontSize(20).fillColor(INK).text(recipe.name, { width: W });
  const meta = [recipe.kind === 'semi' ? 'Полуфабрикат' : 'Блюдо', recipe.category_name].filter(Boolean).join(' · ');
  doc.font('r').fontSize(10).fillColor(MUTED).text(meta, { width: W });
  if (recipe.scale_factor) {
    doc.moveDown(0.3).font('b').fontSize(10).fillColor(ACCENT).text(`Пересчитано ×${fmt(recipe.scale_factor)}`);
  }

  const photo = photoPath(recipe);
  if (photo) {
    doc.moveDown(0.6);
    try { doc.image(photo, { fit: [W, 180], align: 'left' }); doc.moveDown(0.4); } catch { /* битое фото — без него */ }
  }

  doc.moveDown(0.6);
  doc.font('b').fontSize(10).fillColor(INK).text('Выход: ', { continued: true }).font('r').text(yieldText(recipe));
  doc.moveDown(0.8);

  // Таблица состава
  const cols = [
    { h: '№', w: 24, a: 'left' }, { h: 'Ингредиент', w: W - 24 - 60 * 3 - 44, a: 'left' },
    { h: 'Ед.', w: 44, a: 'left' }, { h: 'Брутто', w: 60, a: 'right' },
    { h: 'Нетто', w: 60, a: 'right' }, { h: '% потерь', w: 60, a: 'right' },
  ];
  const drawRow = (cells, bold) => {
    const y = doc.y;
    doc.font(bold ? 'b' : 'r').fontSize(9).fillColor(bold ? MUTED : INK);
    const heights = cells.map((c, i) => doc.heightOfString(c, { width: cols[i].w - 6 }));
    const h = Math.max(...heights) + 8;
    if (y + h > doc.page.height - 60) { doc.addPage(); return drawRow(cells, bold); }
    let x = 48;
    cells.forEach((c, i) => { doc.text(c, x + 3, y + 4, { width: cols[i].w - 6, align: cols[i].a }); x += cols[i].w; });
    doc.moveTo(48, y + h).lineTo(48 + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.x = 48; doc.y = y + h;
  };
  drawRow(cols.map(c => c.h), true);
  recipe.ingredients.forEach((i, n) => drawRow([
    String(n + 1), i.name + (i.linked_recipe_id ? ' (п/ф)' : ''), i.unit || '',
    fmt(i.brutto), fmt(i.netto), i.loss_percent != null ? fmt(i.loss_percent) : '',
  ]));
  if (!recipe.ingredients.length) doc.font('r').fontSize(9).fillColor(MUTED).text('Состав не заполнен', 51, doc.y + 4);

  const kbju = kbjuLines(recipe);
  if (kbju.length) {
    doc.moveDown(1).font('b').fontSize(11).fillColor(INK).text('КБЖУ на выход', 48, doc.y, { width: W });
    doc.font('r').fontSize(10).text(kbju.map(([l, v, u]) => `${l}: ${fmt(v)} ${u}`).join('   '), { width: W });
  }
  if (recipe.cooking.trim()) {
    doc.moveDown(1).font('b').fontSize(11).fillColor(INK).text('Технология приготовления', 48, doc.y, { width: W });
    doc.moveDown(0.2).font('r').fontSize(10).text(recipe.cooking.trim(), { width: W, lineGap: 2 });
  }
  if (recipe.note.trim()) {
    doc.moveDown(1).font('b').fontSize(11).fillColor(INK).text('Примечание', 48, doc.y, { width: W });
    doc.moveDown(0.2).font('r').fontSize(10).text(recipe.note.trim(), { width: W });
  }

  const stamp = new Date().toLocaleDateString('ru-RU');
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    // Колонтитул стоит ниже нижнего поля — без обнуления поля pdfkit начал бы новую страницу.
    doc.page.margins.bottom = 0;
    doc.font('r').fontSize(8).fillColor(MUTED)
      .text(`${tenantName} · ${stamp} · стр. ${p + 1} из ${range.count}`, 48, doc.page.height - 36, { width: W, align: 'right', lineBreak: false });
  }
  return { doc, filename: fileBase(recipe) + '.pdf' };
}

// ── Excel ────────────────────────────────────────────────────────────

async function xlsx(recipe, { tenantName }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = tenantName;
  const ws = wb.addWorksheet('ТТК', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 5 }, { width: 42 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 11 }];

  ws.addRow([`Технологическая карта · ${tenantName}`]).font = { size: 9, color: { argb: 'FF7A746B' } };
  const title = ws.addRow([recipe.name]); title.font = { size: 16, bold: true };
  ws.mergeCells(title.number, 1, title.number, 6);
  ws.addRow([[recipe.kind === 'semi' ? 'Полуфабрикат' : 'Блюдо', recipe.category_name].filter(Boolean).join(' · ')]);
  if (recipe.scale_factor) ws.addRow([`Пересчитано ×${fmt(recipe.scale_factor)}`]).font = { bold: true, color: { argb: 'FFB4471F' } };
  ws.addRow(['Выход', yieldText(recipe)]);
  ws.addRow([]);

  const head = ws.addRow(['№', 'Ингредиент', 'Ед.', 'Брутто', 'Нетто', '% потерь']);
  head.font = { bold: true };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1ECE4' } }; c.border = { bottom: { style: 'thin' } }; });
  recipe.ingredients.forEach((i, n) => {
    const row = ws.addRow([n + 1, i.name + (i.linked_recipe_id ? ' (п/ф)' : ''), i.unit || '', i.brutto, i.netto, i.loss_percent]);
    [4, 5].forEach(c => { row.getCell(c).numFmt = '0.###'; });
    row.getCell(6).numFmt = '0.##';
  });

  const kbju = kbjuLines(recipe);
  if (kbju.length) {
    ws.addRow([]);
    ws.addRow(['', 'КБЖУ на выход']).font = { bold: true };
    kbju.forEach(([l, v, u]) => ws.addRow(['', l, u, v]));
  }
  for (const [label, text] of [['Технология приготовления', recipe.cooking], ['Примечание', recipe.note]]) {
    if (!text.trim()) continue;
    ws.addRow([]);
    ws.addRow(['', label]).font = { bold: true };
    const r = ws.addRow(['', text.trim()]);
    ws.mergeCells(r.number, 2, r.number, 6);
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.height = Math.min(400, 15 * Math.ceil(text.length / 80 + text.split('\n').length));
  }
  return { buffer: await wb.xlsx.writeBuffer(), filename: fileBase(recipe) + '.xlsx' };
}

module.exports = { pdf, xlsx };
