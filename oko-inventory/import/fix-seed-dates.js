// One-off fix for the 2026-09-02 import: the "начальный остаток" movements
// were dated "today" instead of being backdated, so any period export
// starting before the import date showed 0 as the opening balance and
// counted the whole opening stock as "приход" within the period instead.
//
// This patches ONLY movements with note === "начальный остаток" and
// date === "2026-09-02" (the day of that import) — sets their date to
// SEED_DATE. Everything else (items, photos, any real приход/списание
// entered since going live) is left untouched.
//
// Run from the same directory as oko-inventory-store.js:
//   cp fix-seed-dates.js <backend src dir>/
//   cd <backend src dir>
//   node fix-seed-dates.js

const fs = require("fs");
const store = require("./oko-inventory-store");

const SEED_DATE = "2026-07-31";
const WRONG_DATE = "2026-09-02";

function main() {
  const movements = JSON.parse(fs.readFileSync(store.MOVEMENTS_PATH, "utf8"));
  let patched = 0;
  for (const m of movements) {
    if (m.note === "начальный остаток" && m.date === WRONG_DATE) {
      m.date = SEED_DATE;
      patched += 1;
    }
  }
  fs.writeFileSync(store.MOVEMENTS_PATH, JSON.stringify(movements, null, 2), "utf8");
  console.log(`Готово: у ${patched} движений дата исправлена на ${SEED_DATE}.`);
  if (patched === 0) {
    console.log(
      `Ничего не поправлено — либо уже поправлено раньше, либо WRONG_DATE в скрипте не совпадает с реальной датой импорта.`,
    );
  }
}

main();
