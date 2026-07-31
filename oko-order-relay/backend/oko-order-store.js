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

module.exports = { createOrderId, saveOrder, getOrder, markAccepted, ORDERS_PATH };
