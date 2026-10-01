// Зонд: «Принято» по категории ПОСЛЕ отправки по QR — что станет с текстом статуса.
const fs = require("fs"), path = require("path");
const B = "http://127.0.0.1:3099", D = path.join(__dirname, "src", "data");
const rj = (f) => JSON.parse(fs.readFileSync(path.join(D, f), "utf8"));
const post = (u, b) => fetch(B + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
(async () => {
  const cfg = rj("oko-order-config.json");
  await post("/api/oko-order/submit", { f: cfg.oblako.token, clientOrderId: "p" + Date.now(), name: "Техподдержка KitchenDesk", date: new Date(Date.now() + 864e5).toISOString().slice(0, 10), items: [{ name: "Медовик целый", qty: 1 }, { name: "Бургер булочка 100 гр", qty: 5 }] });
  const [id, o] = Object.entries(rj("oko-orders.json")).sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
  console.log("категории:", (o.categories || []).map((c) => c.name).join(", ") || "нет (общий режим)");
  await fetch(`${B}/api/oko-order/ship/${o.shipToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "trackUrl=" });
  const n0 = (await (await fetch(B + "/__calls")).json()).length;
  for (let i = 0; i < (o.categories || [1]).length; i++) {
    const cooks = o.categories ? o.categories[i].cooks : [];
    const from = cooks[0] && cooks[0].userId ? { id: cooks[0].userId, first_name: "Повар" } : { id: 1, first_name: "Повар", username: cooks[0] && cooks[0].username };
    await post("/__callback", { id: "c" + i, data: `oko_accept:${id}${o.categories ? ":" + i : ""}`, from });
  }
  const calls = (await (await fetch(B + "/__calls")).json()).slice(n0);
  for (const c of calls.filter((c) => c.m === "editMessageText")) console.log("editMessageText →", String(c.args[1].chat_id) === String(o.sourceChatId) ? "ТЕМА КЛИЕНТА" : "КУХНЯ", ":", c.args[0].split("\n")[0]);
  console.log("статус в данных:", rj("oko-orders.json")[id].shipping ? "shipping есть" : "-");
})();
