const fs = require("fs");
const path = require("path");

const ORDERS_PATH = path.join(__dirname, "data", "oko-orders.json");

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2), "utf8");
}

function createOrderId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function saveOrder(orderId, record) {
  const orders = readOrders();
  orders[orderId] = record;
  writeOrders(orders);
}

function getOrder(orderId) {
  return readOrders()[orderId] || null;
}

/**
 * Records who accepted an order and when. A no-op (returns the existing
 * record unchanged) if the order was already accepted — first tap wins, so
 * two cooks pressing "Принято" around the same time don't overwrite each
 * other's name.
 */
function markAccepted(orderId, accepted) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return null;
  if (order.accepted) return order;
  order.accepted = accepted;
  writeOrders(orders);
  return order;
}

/**
 * Same first-tap-wins rule as markAccepted(), but scoped to one category
 * within the order's per-category breakdown (order.categories[catIndex]).
 */
function markCategoryAccepted(orderId, catIndex, accepted) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order || !order.categories || !order.categories[catIndex]) return null;
  if (order.categories[catIndex].accepted) return order;
  order.categories[catIndex].accepted = accepted;
  writeOrders(orders);
  return order;
}

/**
 * Marks that the "all categories accepted" final message was already sent
 * to the source group, so a race between near-simultaneous last-category
 * taps can't send it twice.
 */
function markFinalNotified(orderId) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return null;
  order.finalNotified = true;
  writeOrders(orders);
  return order;
}

/**
 * "Отправлено в доставку" — вторая стадия на ТОЙ ЖЕ кнопке (не новая кнопка):
 * первое нажатие — повар принимает, второе, тем же callback_data, но только
 * от назначенного в конфиге заведения человека — отмечает доставку. Общий
 * случай (нет категорий, один "✅ Принято" на весь заказ).
 */
function markDelivery(orderId, delivered) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return null;
  if (order.delivered) return order;
  order.delivered = delivered;
  writeOrders(orders);
  return order;
}

/**
 * То же самое, но для одной категории — второе нажатие на конкретную
 * "✅ Категория" кнопку, уже принятую поваром.
 */
function markCategoryDelivered(orderId, catIndex, delivered) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order || !order.categories || !order.categories[catIndex]) return null;
  if (order.categories[catIndex].delivered) return order;
  order.categories[catIndex].delivered = delivered;
  writeOrders(orders);
  return order;
}

/**
 * Отдельный от finalNotified флаг — "все категории доставлены" сообщение в
 * исходную группу шлём один раз, тем же принципом защиты от гонки.
 */
function markDeliveryFinalNotified(orderId) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return null;
  order.deliveryFinalNotified = true;
  writeOrders(orders);
  return order;
}

/**
 * Защита от двойной отправки формы: ищет уже сохранённый заказ этой формы с
 * тем же clientOrderId (его генерирует страница формы), созданный не раньше
 * sinceMs. Старые заказы (до Этапа 1) clientOrderId не имеют — не мешают.
 */
function findOrderByClientId(venue, clientOrderId, sinceMs) {
  if (!clientOrderId) return null;
  const orders = readOrders();
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.venue === venue && order.clientOrderId === clientOrderId && (order.createdAt || 0) >= sinceMs) {
      return { orderId, order };
    }
  }
  return null;
}

// ── Этап 4 (2026-10-01): статусы заказа ──────────────────────────────
// 🕐 Новый → 👨‍🍳 Готовится (первое «Принято») → 🚚 Отправляется (скан QR на
// печатном чеке или прежняя кнопка доставщика) → ✅ Доставлено (клиент
// прислал фото чека ОТВЕТОМ на сообщение бота об отправке). Старые заказы
// (до Этапа 4) статуса не хранят — он выводится из accepted/delivered.
const STATUS_LABELS = { new: "Новый", cooking: "Готовится", shipping: "Отправляется", delivered: "Доставлено" };

function orderStatus(order) {
  if (order.received) return "delivered";
  if (order.shipping || order.delivered || (order.categories || []).some((c) => c.delivered)) return "shipping";
  if (order.accepted || (order.categories || []).some((c) => c.accepted)) return "cooking";
  return "new";
}

// История с точным временем: создание, первое «Принято», отправка, получение.
function orderTimeline(order) {
  const events = [];
  if (order.createdAt) events.push({ status: "new", at: order.createdAt });
  const accepts = [order.accepted, ...(order.categories || []).map((c) => c.accepted)].filter(Boolean);
  if (accepts.length) {
    const first = accepts.reduce((a, b) => (a.at <= b.at ? a : b));
    events.push({ status: "cooking", at: first.at, by: first.name });
  }
  const shipped = order.shipping
    || order.delivered
    || (order.categories || []).map((c) => c.delivered).filter(Boolean).sort((a, b) => a.at - b.at)[0];
  if (shipped) {
    events.push({ status: "shipping", at: shipped.at, by: shipped.by || shipped.name, via: shipped.via || "button", trackUrl: shipped.trackUrl || null });
  }
  if (order.received) events.push({ status: "delivered", at: order.received.at, by: order.received.by });
  return events;
}

// Отметка «Отправляется» — один раз (первая побеждает: QR и кнопка
// доставщика не перезаписывают друг друга). Возвращает { order, created }.
function markShipping(orderId, shipping) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return { order: null, created: false };
  if (order.shipping) return { order, created: false };
  order.shipping = shipping;
  writeOrders(orders);
  return { order, created: true };
}

// id сообщения «Заказ отправлен» в теме клиента — на него клиент отвечает фото чека.
function setShippingMessage(orderId, messageId) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order || !order.shipping) return null;
  order.shipping.messageId = messageId;
  writeOrders(orders);
  return order;
}

function setTrackUrl(orderId, trackUrl) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order || !order.shipping) return null;
  order.shipping.trackUrl = trackUrl;
  writeOrders(orders);
  return order;
}

function markReceived(orderId, received) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return { order: null, created: false };
  if (order.received) return { order, created: false };
  order.received = received;
  writeOrders(orders);
  return { order, created: true };
}

// Этап 5: чек с QR для уже существующего заказа (старые заказы токена не
// имеют). Токен выдаётся один раз — повторная печать даёт тот же QR, так что
// ранее напечатанный чек остаётся рабочим.
function ensureShipToken(orderId, generate) {
  const orders = readOrders();
  const order = orders[orderId];
  if (!order) return null;
  if (!order.shipToken) {
    order.shipToken = generate();
    writeOrders(orders);
  }
  return order;
}

function findOrderByShipToken(token) {
  if (!token) return null;
  const orders = readOrders();
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.shipToken && order.shipToken === token) return { orderId, order };
  }
  return null;
}

// Фото-чек приходит ответом на сообщение бота об отправке — ищем заказ по
// чату клиента и id этого сообщения.
function findOrderByShippingMessage(chatId, messageId) {
  const orders = readOrders();
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.shipping && order.shipping.messageId === messageId && String(order.sourceChatId) === String(chatId)) {
      return { orderId, order };
    }
  }
  return null;
}

function listOrders({ venue, limit } = {}) {
  return Object.entries(readOrders())
    .filter(([, order]) => !venue || order.venue === venue)
    .sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit || 50);
}

module.exports = {
  STATUS_LABELS,
  orderStatus,
  orderTimeline,
  markShipping,
  setShippingMessage,
  setTrackUrl,
  markReceived,
  findOrderByShipToken,
  findOrderByShippingMessage,
  ensureShipToken,
  listOrders,
  findOrderByClientId,
  createOrderId,
  saveOrder,
  getOrder,
  markAccepted,
  markCategoryAccepted,
  markFinalNotified,
  markDelivery,
  markCategoryDelivered,
  markDeliveryFinalNotified,
  ORDERS_PATH,
};
