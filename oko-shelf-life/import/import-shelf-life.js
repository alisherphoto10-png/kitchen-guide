// Разовый импорт справочника сроков хранения заготовок — 185 позиций из
// присланного файла "Сроки хранения ПФ.xlsx". Тот же приём, что и импорт
// 225 позиций утвари в oko-inventory: вызывает тот же addItem(), что и
// сама админка, отказывается запускаться на непустом справочнике (защита
// от случайного повторного импорта) — --force обходит эту проверку.
//
// Запуск (на сервере, рядом с уже задеплоенным oko-shelf-life-store.js):
//   cp shelf-life-dataset.json <BOT_DIR>/
//   cp import-shelf-life.js <BOT_DIR>/
//   cd <BOT_DIR>
//   node import-shelf-life.js
const path = require("path");
const fs = require("fs");
const store = require("./oko-shelf-life-store");

const force = process.argv.includes("--force");

const existing = store.readItems();
if (existing.length > 0 && !force) {
  console.error(
    `Справочник уже не пустой (${existing.length} позиций) — импорт отменён, чтобы не задублировать. ` +
      `Запустите с --force, если это осознанно.`,
  );
  process.exit(1);
}

const datasetPath = path.join(__dirname, "shelf-life-dataset.json");
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

let imported = 0;
let unparsed = [];
for (const row of dataset) {
  const item = store.addItem({
    name: row.name,
    storageCondition: row.storageCondition,
    shelfLifeText: row.shelfLifeText,
    note: row.note,
  });
  imported += 1;
  if (item.shelfLifeHours == null) unparsed.push(item.name);
}

console.log(`Импортировано: ${imported} позиций.`);
if (unparsed.length) {
  console.log(`Не удалось распознать срок как число (сохранено только текстом) — ${unparsed.length}:`);
  unparsed.forEach((n) => console.log(`  - ${n}`));
} else {
  console.log("Срок хранения распознан как число часов у всех позиций.");
}
