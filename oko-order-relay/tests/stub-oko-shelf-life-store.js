// Заглушка очереди печати для стенда: пишет задания в файл, на принтер не шлёт.
const fs = require("fs"); const path = require("path");
const P = path.join(__dirname, "data", "print-jobs.json");
function createRawPrintJob(job) { const a = fs.existsSync(P) ? JSON.parse(fs.readFileSync(P, "utf8")) : []; a.push(job); fs.writeFileSync(P, JSON.stringify(a, null, 2)); }
module.exports = { createRawPrintJob };
