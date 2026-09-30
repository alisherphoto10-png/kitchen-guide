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

module.exports = {
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
