// One-off import: seeds oko-waiter-guide with the 12 sections / 72 dishes
// transcribed from the restaurant's original waiter's-handbook PDF
// (description / history / how-to-serve / calculation tables — no photos,
// those are added afterward by hand through the admin page, per rows).
//
// Run this FROM the same directory as the deployed oko-waiter-guide-store.js
// (it requires it as "./oko-waiter-guide-store") — copy this file and the
// sibling waiter-guide-dataset.json there before running:
//
//   cp import-waiter-guide.js waiter-guide-dataset.json <backend src dir>/
//   cd <backend src dir>
//   node import-waiter-guide.js
//
// Safe to inspect before running — it only calls the same addSection()/
// addDish() the admin page itself uses. Refuses to run if sections or
// dishes already exist, so it can't accidentally double-import — pass
// --force to override that.
//
// IMPORTANT CAVEAT: the source PDF's calculation tables are themselves
// embedded images, not real text — there was no reliable way to extract
// the numbers programmatically. They were transcribed by reading the
// document directly and spot-checked once against a re-extracted table
// image (exact match). Still — these numbers affect food cost, so it's
// worth a read-through of a few dishes in the admin page after import,
// especially the composite multi-table ones (Тар тар, Ассорти мезе,
// Манго со страчателлой).
//
// 19 dishes had no calculation in the source at all (the file literally
// said "место для калькуляции: вставить после утверждения технологом") —
// those were imported with an empty calcTables, not invented numbers.

const fs = require("fs");
const path = require("path");
const store = require("./oko-waiter-guide-store");

const FORCE = process.argv.includes("--force");

function main() {
  const existingSections = store.readSections();
  const existingDishes = store.readDishes();
  if ((existingSections.length || existingDishes.length) && !FORCE) {
    console.error(
      `Пособие уже не пустое (${existingSections.length} разделов, ${existingDishes.length} блюд) — ничего не делаю.\n` +
      `Если это осознанно (добавить ещё поверх существующего), запустите с --force.`,
    );
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "waiter-guide-dataset.json"), "utf8"));

  const sectionIdByName = {};
  for (const name of dataset.sections) {
    const section = store.addSection({ name });
    sectionIdByName[name] = section.id;
  }

  let imported = 0;
  let withCalc = 0;
  let withoutCalc = [];
  for (const dish of dataset.dishes) {
    const sectionId = sectionIdByName[dish.section];
    if (!sectionId) {
      console.error(`Пропускаю «${dish.name}» — неизвестный раздел «${dish.section}».`);
      continue;
    }
    store.addDish({
      sectionId,
      name: dish.name,
      subtitle: dish.subtitle || "",
      description: dish.description || "",
      history: dish.history || "",
      howToServe: dish.howToServe || "",
      calcTables: Array.isArray(dish.calcTables) ? dish.calcTables : [],
    });
    imported += 1;
    if (dish.calcTables && dish.calcTables.length) withCalc += 1;
    else withoutCalc.push(dish.name);
  }

  console.log(`Готово: ${dataset.sections.length} разделов, импортировано ${imported} блюд.`);
  console.log(`С калькуляцией — ${withCalc}, без (не было в исходнике) — ${withoutCalc.length}:`);
  withoutCalc.forEach((n) => console.log(`  - ${n}`));
  console.log(`Фото не переносились — добавьте их вручную через админку по каждому блюду.`);
}

main();
