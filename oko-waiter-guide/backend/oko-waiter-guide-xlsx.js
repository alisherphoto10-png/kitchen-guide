// Экспорт/импорт блюд через Excel — формат подобран под реальный файл
// редактора (ттк): одна строка на ингредиент, название и остальные поля
// блюда — объединённая ячейка на весь блок его строк. Порядок и подписи
// колонок здесь и на публикуемом шаблоне должны совпадать буквально —
// если меняете один список, меняйте оба.
const ExcelJS = require("exceljs");

const SHEET_NAME = "ттк";

// index — 1-based номер колонки (совпадает с тем, что реально в файле
// редактора). key — во что превращается на выходе parseDishesWorkbook.
// multiline — списочные поля (одна запись на строку внутри ячейки,
// Alt+Enter в Excel). group — какие колонки объединяются в одну ячейку
// на весь блок блюда (всё, кроме самих ингредиентных B/C/D).
const COLUMNS = [
  { index: 1, header: "наименование", key: "name", group: true },
  { index: 2, header: "ингредиент", key: "ingredientName" },
  { index: 3, header: "ед. измерения", key: "ingredientUnit" },
  { index: 4, header: "кол-во", key: "ingredientAmount" },
  { index: 5, header: "подзаголовок", key: "subtitle", group: true },
  { index: 6, header: "описание", key: "description", group: true },
  { index: 7, header: "история", key: "history", group: true },
  { index: 8, header: "как подать гостю", key: "waiterPhrase", group: true },
  { index: 9, header: "раздел", key: "sectionName", group: true },
  { index: 10, header: "подраздел", key: "subsectionName", group: true },
  { index: 11, header: "статус", key: "statusLabel", group: true },
  { index: 12, header: "скрыто", key: "hiddenFlag", group: true },
  { index: 13, header: "цитата-факт", key: "historyQuote", group: true },
  { index: 14, header: "шаги подачи", key: "servingSteps", group: true, multiline: true },
  { index: 15, header: "аллергены", key: "allergens", group: true, multiline: true },
  { index: 16, header: "особенности", key: "features", group: true, multiline: true },
  { index: 17, header: "рекомендации", key: "recommendations", group: true, multiline: true },
  { index: 18, header: "предупреждение", key: "warning", group: true },
  { index: 19, header: "faq", key: "faqText", group: true, multiline: true },
  { index: 20, header: "id", key: "id", group: true },
];
const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c.index]));
const GROUP_COLS = COLUMNS.filter((c) => c.group).map((c) => c.index);
const MULTILINE_COLS = new Set(COLUMNS.filter((c) => c.multiline).map((c) => c.index));

const INSTRUCTION_LINES = [
  'Как заполнять новые колонки (после "как подать гостю"):',
  "",
  "раздел / подраздел — точные названия как в пособии официанта. Если такого раздела ещё нет — создастся сам при загрузке. Подраздел — необязательно.",
  'статус — например "Хит" или "Популярное". Если такого статуса ещё нет — создастся сам (можно будет добавить эмодзи потом в редакторе).',
  'скрыто — "да", если блюдо НЕ должно показываться официантам сразу. Пусто — показывается как обычно.',
  "цитата-факт — короткая цитата во вкладке «История», отдельной карточкой. Необязательно.",
  "шаги подачи / аллергены / особенности / рекомендации — по одному пункту на строку внутри ячейки (Alt+Enter между строками).",
  "предупреждение — одна строка, короткое предупреждение (если нужно).",
  "faq — вопрос и ответ друг под другом (Alt+Enter), пустая строка между разными вопросами.",
  "Несколько таблиц состава на одно блюдо (например «основа» + «гарнир» отдельно) — в колонке «ингредиент» строка-заголовок в квадратных скобках, например [Гарнир], без ед./кол-во — дальше идут её ингредиенты как обычно.",
  "id — служебная колонка, не трогать руками. Пусто = новое блюдо при загрузке, заполнено = обновление существующего блюда с этим id.",
  "",
  "ВАЖНО про обновление существующих блюд (когда id заполнен): при загрузке поле принимает ровно то, что написано в ячейке — пустая ячейка сотрёт значение поля. Два исключения ради безопасности: пустой «раздел» не переносит блюдо в «Без раздела» (раздел просто не меняется), и если у блюда в файле вообще нет ни одной строки ингредиента — состав тоже не трогается. Оба поля — только если реально хотите их поменять.",
  "",
  "Все текстовые поля блюда указываются ОДИН РАЗ на блюдо — ячейка объединена на весь блок его ингредиентов.",
];

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value.richText) {
    return value.richText.map((r) => r.text).join("");
  }
  return String(value).replace(/\r\n/g, "\n").trim();
}
function linesOf(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- построение faq/calc текста для ячейки и разбор обратно ----------

function faqToCell(faq) {
  return (faq || []).map((f) => `${f.question || ""}\n${f.answer || ""}`).join("\n\n");
}
function faqFromCell(text) {
  const blocks = String(text || "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split("\n");
    return { question: (lines[0] || "").trim(), answer: lines.slice(1).join("\n").trim() };
  }).filter((f) => f.question);
}

// ---------- экспорт ----------

function buildDishesWorkbook(guideAll, statuses, orphanDishes) {
  const wb = new ExcelJS.Workbook();

  const instr = wb.addWorksheet("Инструкция");
  instr.columns = [{ width: 100 }];
  INSTRUCTION_LINES.forEach((text, i) => {
    const cell = instr.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
  });

  const sheet = wb.addWorksheet(SHEET_NAME);
  sheet.views = [{ state: "frozen", ySplit: 2 }];

  sheet.mergeCells(1, 1, 2, 1);
  sheet.getCell(1, 1).value = "наименование";
  sheet.mergeCells(1, 2, 1, 4);
  sheet.getCell(1, 2).value = "ттк";
  sheet.mergeCells(1, 5, 1, 8);
  sheet.getCell(1, 5).value = "карточка блюда";
  sheet.mergeCells(1, 9, 1, 20);
  sheet.getCell(1, 9).value = "дополнительно";
  COLUMNS.forEach((c) => {
    if (c.index === 1) return;
    sheet.getCell(2, c.index).value = c.header;
  });
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: "center" };
  sheet.getRow(2).alignment = { horizontal: "center", wrapText: true };

  const widths = [22, 22, 10, 8, 20, 30, 30, 30, 14, 14, 12, 9, 22, 22, 22, 22, 22, 20, 30, 10];
  sheet.columns.forEach((col, i) => { col.width = widths[i] || 16; });

  const statusLabel = (id) => {
    const s = (statuses || []).find((x) => x.id === id);
    return s ? [s.emoji, s.label].filter(Boolean).join(" ") : "";
  };

  const sectionsById = Object.fromEntries(guideAll.map((s) => [s.id, s]));

  let row = 3;
  for (const section of guideAll) {
    const parent = section.parentId ? sectionsById[section.parentId] : null;
    const sectionName = parent ? parent.name : section.name;
    const subsectionName = parent ? section.name : "";
    for (const dish of section.dishes) {
      row = writeDishRow(sheet, row, dish, sectionName, subsectionName, statusLabel(dish.status));
    }
  }

  // Блюда без раздела ("Без раздела" в админке) — тоже не должны потеряться
  // из экспорта, просто с пустыми раздел/подраздел.
  if (orphanDishes && orphanDishes.length) {
    for (const dish of orphanDishes) {
      row = writeDishRow(sheet, row, dish, "", "", statusLabel(dish.status));
    }
  }

  return wb;
}

function writeDishRow(sheet, startRow, dish, sectionName, subsectionName, statusText) {
  const lines = [];
  (dish.calcTables || []).forEach((t) => {
    if (t.label) lines.push({ label: t.label });
    (t.rows || []).forEach((r) => lines.push({ ingredient: r.name, unit: r.unit, amount: r.amount }));
  });
  const rowCount = Math.max(lines.length, 1);
  const endRow = startRow + rowCount - 1;

  lines.forEach((line, i) => {
    const rr = startRow + i;
    if (line.label) {
      sheet.getCell(rr, COL.ingredientName).value = `[${line.label}]`;
    } else if (line.ingredient !== undefined) {
      sheet.getCell(rr, COL.ingredientName).value = line.ingredient;
      sheet.getCell(rr, COL.ingredientUnit).value = line.unit;
      sheet.getCell(rr, COL.ingredientAmount).value = line.amount;
    }
  });

  if (endRow > startRow) GROUP_COLS.forEach((c) => sheet.mergeCells(startRow, c, endRow, c));
  sheet.getCell(startRow, COL.name).value = dish.name;
  sheet.getCell(startRow, COL.subtitle).value = dish.subtitle || "";
  sheet.getCell(startRow, COL.description).value = dish.description || "";
  sheet.getCell(startRow, COL.history).value = dish.history || "";
  sheet.getCell(startRow, COL.waiterPhrase).value = dish.waiterPhrase || "";
  sheet.getCell(startRow, COL.sectionName).value = sectionName;
  sheet.getCell(startRow, COL.subsectionName).value = subsectionName;
  sheet.getCell(startRow, COL.statusLabel).value = statusText;
  sheet.getCell(startRow, COL.hiddenFlag).value = dish.hidden ? "да" : "";
  sheet.getCell(startRow, COL.historyQuote).value = dish.historyQuote || "";
  sheet.getCell(startRow, COL.servingSteps).value = (dish.servingSteps || []).join("\n");
  sheet.getCell(startRow, COL.allergens).value = (dish.allergens || []).join("\n");
  sheet.getCell(startRow, COL.features).value = (dish.features || []).join("\n");
  sheet.getCell(startRow, COL.recommendations).value = (dish.recommendations || []).join("\n");
  sheet.getCell(startRow, COL.warning).value = dish.warning || "";
  sheet.getCell(startRow, COL.faqText).value = faqToCell(dish.faq);
  sheet.getCell(startRow, COL.id).value = dish.id;
  GROUP_COLS.forEach((c) => {
    sheet.getCell(startRow, c).alignment = { wrapText: MULTILINE_COLS.has(c), vertical: "top" };
  });
  return endRow + 1;
}

// ---------- импорт ----------

// Разбирает загруженный файл в список патчей блюд + список пропущенных
// листов (всё, что не называется "ттк" — например справочные под-рецепты
// вроде листа "соуса") — ничего с ними не делаем, просто сообщаем, чтобы
// не потерялось незамеченным.
async function parseDishesWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const skippedSheets = [];
  let sheet = null;
  wb.eachSheet((s) => {
    if (s.name === SHEET_NAME) sheet = s;
    else if (s.name !== "Инструкция") skippedSheets.push(s.name);
  });
  if (!sheet) return { dishes: [], skippedSheets, error: `Не нашёл лист "${SHEET_NAME}"` };

  // Заголовки читаем из строки 2 по имени, а не по фиксированной позиции —
  // так порядок колонок можно менять, не ломая импорт.
  const headerRow = 2;
  const colByKey = {};
  COLUMNS.forEach((c) => {
    for (let col = 1; col <= sheet.columnCount; col++) {
      if (normalizeCell(sheet.getCell(headerRow, col).value).toLowerCase() === c.header) {
        colByKey[c.key] = col;
        break;
      }
    }
  });
  const get = (row, key) => (colByKey[key] ? normalizeCell(sheet.getCell(row, colByKey[key]).value) : "");

  const dishes = [];
  let r = headerRow + 1;
  while (r <= sheet.rowCount) {
    const name = get(r, "name");
    if (!name) { r++; continue; }

    // Границы блока — по merge-диапазону колонки "наименование", как и на
    // экспорте; если вдруг не смёржено (файл правили руками без merge) —
    // блок из одной строки, тоже нормально обрабатывается.
    const mergeRange = (sheet.model.merges || []).find((m) => {
      const [start] = m.split(":");
      const col = start.match(/[A-Z]+/)[0];
      const rowNum = parseInt(start.match(/\d+/)[0], 10);
      return col === "A" && rowNum === r;
    });
    let endRow = r;
    if (mergeRange) endRow = parseInt(mergeRange.split(":")[1].match(/\d+/)[0], 10);

    const calcTables = [];
    let currentTable = null;
    for (let rr = r; rr <= endRow; rr++) {
      const ing = get(rr, "ingredientName");
      if (!ing) continue;
      const labelMatch = /^\[(.+)\]$/.exec(ing);
      if (labelMatch) {
        currentTable = { label: labelMatch[1].trim(), rows: [] };
        calcTables.push(currentTable);
        continue;
      }
      if (!currentTable) { currentTable = { label: "", rows: [] }; calcTables.push(currentTable); }
      currentTable.rows.push({
        name: ing,
        unit: get(rr, "ingredientUnit"),
        amount: get(rr, "ingredientAmount"),
      });
    }

    dishes.push({
      id: get(r, "id") || null,
      name,
      subtitle: get(r, "subtitle"),
      description: get(r, "description"),
      history: get(r, "history"),
      waiterPhrase: get(r, "waiterPhrase"),
      sectionName: get(r, "sectionName"),
      subsectionName: get(r, "subsectionName"),
      statusLabel: get(r, "statusLabel"),
      hidden: /^да$/i.test(get(r, "hiddenFlag")),
      historyQuote: get(r, "historyQuote"),
      servingSteps: linesOf(get(r, "servingSteps")),
      allergens: linesOf(get(r, "allergens")),
      features: linesOf(get(r, "features")),
      recommendations: linesOf(get(r, "recommendations")),
      warning: get(r, "warning"),
      faq: faqFromCell(get(r, "faqText")),
      // Пустой список строк состава — сигнал "не трогать состав при
      // обновлении", а не "стереть его"; hasCalcRows различает эти случаи.
      hasCalcRows: calcTables.some((t) => t.rows.length),
      calcTables,
    });

    r = endRow + 1;
  }

  return { dishes, skippedSheets };
}

module.exports = { buildDishesWorkbook, parseDishesWorkbook, COLUMNS };
