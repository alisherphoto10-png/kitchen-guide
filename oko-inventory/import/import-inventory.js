// One-off import: seeds oko-inventory with the 225 real items from the
// restaurant's original inventory spreadsheet (photos + current quantities).
//
// Run this FROM the same directory as the deployed oko-inventory-store.js
// (it requires it as "./oko-inventory-store") — copy this file and the
// sibling inventory-dataset.json + photos/ folder there before running:
//
//   cp import-inventory.js inventory-dataset.json -r photos <backend src dir>/
//   cd <backend src dir>
//   node import-inventory.js
//
// Safe to inspect before running — it only calls the same addItem() the
// admin page itself uses, once per row. Refuses to run if the catalog
// already has items, so it can't accidentally double-import — pass
// --force to override that (e.g. if you really do want to add a second
// batch on top of an existing catalog).

const fs = require("fs");
const path = require("path");
const store = require("./oko-inventory-store");

const FORCE = process.argv.includes("--force");

function loadDataUri(photoFile) {
  if (!photoFile) return null;
  const p = path.join(__dirname, "photos", photoFile);
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  const buf = fs.readFileSync(p);
  return `data:image/${mime};base64,${buf.toString("base64")}`;
}

function main() {
  const existing = store.readItems();
  if (existing.length && !FORCE) {
    console.error(
      `Каталог уже не пустой (${existing.length} позиций) — ничего не делаю.\n` +
      `Если это осознанно (добавить ещё одну партию поверх существующих), запустите с --force.`,
    );
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "inventory-dataset.json"), "utf8"));

  let imported = 0;
  let withPhoto = 0;
  for (const row of dataset) {
    // Photos were matched to rows automatically from the PDF (row{number}.ext);
    // find whichever extension actually exists for this row.
    let photoFile = null;
    for (const ext of ["jpg", "jpeg", "png"]) {
      const candidate = `row${row.number}.${ext}`;
      if (fs.existsSync(path.join(__dirname, "photos", candidate))) {
        photoFile = candidate;
        break;
      }
    }
    const photo = loadDataUri(photoFile);
    if (photo) withPhoto += 1;

    store.addItem({
      name: row.name,
      size: row.size,
      unit: row.unit,
      note: row.note,
      photo,
      initialQty: row.qty,
    });
    imported += 1;
  }

  console.log(`Готово: импортировано ${imported} позиций, из них с фото — ${withPhoto}.`);
  console.log(`Позиция №102 в исходном файле была без названия — стоит открыть админку и переименовать её во что-то осмысленное.`);
}

main();
