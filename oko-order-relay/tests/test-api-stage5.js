// Этап 5: «Распечатать чек с QR» для уже существующего заказа. node test-api-stage5.js
const fs = require("fs");
const path = require("path");
const BASE = "http://127.0.0.1:3099";
const PASS = { "Content-Type": "application/json", "X-Admin-Password": "staging-pass" };
const DATA = path.join(__dirname, "src", "data");
let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); } }
async function j(method, url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text };
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const jobs = () => (fs.existsSync(path.join(DATA, "print-jobs.json")) ? readJson("print-jobs.json") : []);

(async () => {
  let orders = readJson("oko-orders.json");
  const legacy = Object.entries(orders).filter(([, o]) => !o.shipToken && !o.shipping && !o.received);
  const [id, o] = legacy.find(([, o]) => o.venue === "myaso" && /Комментарий/.test(o.coreMessage)) || legacy[0];

  console.log("1. Доступ");
  ok((await j("POST", "/api/oko-order/admin/orders/print-qr", { id })).status === 401, "без пароля — 401");
  ok((await j("POST", "/api/oko-order/admin/orders/print-qr", { id: "nope" }, PASS)).status === 404, "чужой id — 404");
  ok((await j("POST", "/api/oko-order/admin/orders/print-qr", {}, PASS)).status === 404, "без id — 404");

  console.log("2. Список заказов: флаги");
  let r = await j("GET", "/api/oko-order/admin/orders?limit=300", null, PASS);
  const view = r.data.orders.find((x) => x.id === id);
  ok(view.canPrintQr === true && view.hasQr === false, "старый заказ: можно печатать, QR ещё не было");

  console.log("3. Печать старого заказа");
  const before = jobs().length;
  r = await j("POST", "/api/oko-order/admin/orders/print-qr", { id }, PASS);
  ok(r.status === 200 && r.data.ok, "ответ ok");
  const tok = readJson("oko-orders.json")[id].shipToken;
  ok(/^[A-Za-z0-9_-]{24}$/.test(tok), "заказу выдан токен QR");
  const job = jobs()[jobs().length - 1];
  ok(jobs().length === before + 1, "одно задание в очереди");
  ok(job.qrData === `https://kitchendesk.chefplan.ru/api/oko-order/ship/${tok}`, "qrData = ссылка отправки");
  ok(job.restaurantId === "1", "принтер ОКО");
  console.log(job.printLines.map((l) => "      | " + l).join("\n"));
  ok(job.printLines.includes("При отправке отсканируйте QR:"), "подпись к QR");
  ok(job.printLines.some((l) => /^Оформлен: /.test(l)), "время оформления");
  ok(job.printLines.filter((l) => / — \d/.test(l) && !/^Заказ/.test(l)).length > 0, "позиции разобраны");
  ok(!job.printLines.some((l) => /<|&lt;/.test(l)), "без HTML");

  console.log("4. Повторная печать — тот же QR");
  r = await j("POST", "/api/oko-order/admin/orders/print-qr", { id }, PASS);
  ok(r.status === 200 && readJson("oko-orders.json")[id].shipToken === tok && jobs()[jobs().length - 1].qrData.endsWith(tok), "токен не сменился");
  r = await j("GET", "/api/oko-order/admin/orders?limit=300", null, PASS);
  ok(r.data.orders.find((x) => x.id === id).hasQr === true, "hasQr = true");

  console.log("5. Скан → «Отправляется» как у новых");
  r = await j("GET", `/api/oko-order/ship/${tok}`);
  ok(r.status === 200, "страница по QR открывается");
  const res = await fetch(`${BASE}/api/oko-order/ship/${tok}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "trackUrl=" });
  ok(res.status === 200, "отметка отправки");
  const shipped = readJson("oko-orders.json")[id];
  ok(shipped.shipping && shipped.shipping.via === "qr" && shipped.shipping.messageId, "shipping по QR, сообщение клиенту ушло");
  r = await j("POST", "/__message", { chat: { id: Number(shipped.sourceChatId), type: "supergroup" }, reply_to_message: { message_id: shipped.shipping.messageId }, photo: [{ file_id: "PH1" }], from: { id: 1, first_name: "Клиент" }, message_id: 9 });
  ok(!!readJson("oko-orders.json")[id].received, "фото-чек ответом → «Доставлено»");

  console.log("6. После отправки печать не нужна");
  ok((await j("POST", "/api/oko-order/admin/orders/print-qr", { id }, PASS)).status === 409, "409");
  r = await j("GET", "/api/oko-order/admin/orders?limit=300", null, PASS);
  ok(r.data.orders.find((x) => x.id === id).canPrintQr === false, "canPrintQr = false");

  console.log("7. Все старые заказы печатаются без ошибок (строки)");
  let bad = 0;
  for (const [oid] of legacy.filter(([k]) => k !== id)) {
    const rr = await j("POST", "/api/oko-order/admin/orders/print-qr", { id: oid }, PASS);
    const jl = jobs()[jobs().length - 1];
    if (rr.status !== 200 || !jl.printLines.length || jl.printLines.some((l) => typeof l !== "string")) bad++;
  }
  ok(bad === 0, `все ${legacy.length - 1} старых заказов дали корректный чек`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
