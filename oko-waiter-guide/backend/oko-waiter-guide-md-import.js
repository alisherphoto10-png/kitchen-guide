// Разбор .md-файла с блюдами для «Пособия официанта» — формат подобран так,
// чтобы редактор мог отдать шефу/копирайтеру шаблон полей в том же порядке,
// что и форма в админке, а потом просто загрузить получившийся файл вместо
// того, чтобы вручную перебивать каждое блюдо.
//
// Ожидаемый формат (см. пример — присланный файл с суши и роллами):
//
//   Раздел везде один: **Название раздела**
//   ---
//   ## 1. Название блюда
//
//   **Подзаголовок:** текст (необязательно)
//
//   **Описание:**
//   текст
//
//   **История:**
//   текст (необязательно)
//
//   **Как подать гостю:**
//   «текст» (необязательно, кавычки-«ёлочки» по краям снимаются —
//   страница официанта сама оборачивает подачу в кавычки)
//
//   **Раздел:** Другой раздел (необязательно — переопределяет раздел
//   только для этого блюда, если он отличается от общего)
//
//   **Калькуляция:**
//   | Ингредиент | Ед. изм. | Кол-во |
//   |---|---|---|
//   | ... | ... | ... |
//
//   ---
//
// Блюда разделяются строкой ровно из "---" и должны начинаться с "## N. ".
// Любой другой блок между "---" (преамбула, примечания в конце файла вроде
// "Не включены" / "Полуфабрикаты") в текущей версии не разбирается —
// возвращается в skipped, чтобы редактор увидел, что это не забыто, а
// осознанно пропущено.

const FIELD_LABELS = ["Подзаголовок", "Описание", "История", "Как подать гостю", "Раздел"];

function stripQuotes(text) {
  // Кавычки-«ёлочки» вокруг фразы подачи снимаются — страница официанта сама
  // оборачивает её в кавычки. Закрывающая может идти перед точкой/восклицанием
  // ("...лишнего»."), поэтому не привязываемся строго к концу строки.
  return text.replace(/^[«"]\s*/, "").replace(/[»"]([.!]?)\s*$/, "$1");
}

function extractField(block, label) {
  // Останавливаемся на следующей строке "**Метка:**" из известного набора,
  // на начале таблицы калькуляции, или на конце блока.
  const otherLabels = FIELD_LABELS.filter((l) => l !== label)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(
    `\\*\\*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}:\\*\\*[ \\t]*\\n?([\\s\\S]*?)` +
      `(?=\\n\\*\\*(?:${otherLabels}|Калькуляция):\\*\\*|\\n\\|.*Ингредиент|\\n---|$)`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return "";
  return m[1].trim();
}

function parseCalcTable(block) {
  const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return null;
  const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  // startsWith, не includes — "ингредиент" сам содержит подстроку "ед"
  // (...гр-ед-иент), из-за чего includes("ед") ошибочно попадал бы в ту же
  // колонку, что и название.
  const nameIdx = header.findIndex((h) => h.startsWith("ингредиент"));
  const unitIdx = header.findIndex((h) => h.startsWith("ед"));
  const amountIdx = header.findIndex((h) => h.startsWith("кол"));
  if (nameIdx === -1) return null;
  const rows = [];
  for (const line of lines.slice(1)) {
    const row = cells(line);
    if (row.every((c) => /^:?-+:?$/.test(c))) continue; // разделитель |---|---|
    if (!row[nameIdx]) continue;
    rows.push({
      name: row[nameIdx] || "",
      unit: unitIdx !== -1 ? row[unitIdx] || "" : "",
      amount: amountIdx !== -1 ? row[amountIdx] || "" : "",
    });
  }
  return rows.length ? { label: "", rows } : null;
}

function parseDishBlock(block) {
  const headingMatch = /^##\s*(?:\d+\.\s*)?(.+?)\s*$/m.exec(block);
  if (!headingMatch) return null;
  const name = headingMatch[1].trim();
  if (!name) return null;

  const subtitle = extractField(block, "Подзаголовок");
  const description = extractField(block, "Описание");
  const history = extractField(block, "История");
  const howToServe = stripQuotes(extractField(block, "Как подать гостю"));
  const sectionOverride = extractField(block, "Раздел") || null;

  const calcTables = [];
  const calcIdx = block.search(/\*\*Калькуляция:\*\*/i);
  if (calcIdx !== -1) {
    const table = parseCalcTable(block.slice(calcIdx));
    if (table) calcTables.push(table);
  }

  return { name, subtitle, description, history, howToServe, sectionOverride, calcTables };
}

/**
 * @returns {{ defaultSection: string|null, dishes: object[], skipped: string[] }}
 */
function parseWaiterGuideMarkdown(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");

  const sectionMatch = /Раздел[^\n]*?:\s*\*\*(.+?)\*\*/i.exec(text);
  const defaultSection = sectionMatch ? sectionMatch[1].trim() : null;

  const blocks = text.split(/\n-{3,}\n/);
  const dishes = [];
  const skipped = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (!/^##\s/m.test(block.split("\n")[0] || "")) {
      // Преамбула в начале файла или примечания в конце ("Не включены",
      // "Полуфабрикаты") — не блюдо, осознанно пропускаем.
      const firstLine = block.split("\n")[0].slice(0, 60);
      if (firstLine) skipped.push(firstLine);
      continue;
    }
    const dish = parseDishBlock(block);
    if (dish) dishes.push(dish);
  }

  return { defaultSection, dishes, skipped };
}

module.exports = { parseWaiterGuideMarkdown };
