// Стенд: заглушка middleware/auth KitchenDesk (без Postgres). Токены:
// kd-oko-admin (админ ОКО), kd-other-admin (админ другого заведения),
// kd-oko-cook (повар ОКО), kd-super (суперадмин), остальное — 401.
const USERS = {
  "kd-oko-admin": { login: "a1", role: "admin", restaurant_id: 1 },
  "kd-other-admin": { login: "a2", role: "admin", restaurant_id: 2 },
  "kd-oko-cook": { login: "c1", role: "cook", restaurant_id: 1 },
  "kd-oko-sushef": { login: "s1", role: "sushef", restaurant_id: 1 },
  "kd-super": { login: "sa", role: "superadmin", is_superadmin: true, restaurant_id: 1 },
};
async function authMiddleware(req, res, next) {
  const header = req.headers["authorization"] || "";
  const user = header.startsWith("Bearer ") ? USERS[header.slice(7)] : null;
  if (!user) return res.status(401).json({ error: "Невалидный токен" });
  req.user = { ...user };
  const xRid = parseInt(req.headers["x-restaurant-id"] || "");
  if (user.is_superadmin && !isNaN(xRid)) req.user.restaurant_id = xRid;
  next();
}
module.exports = { authMiddleware };
