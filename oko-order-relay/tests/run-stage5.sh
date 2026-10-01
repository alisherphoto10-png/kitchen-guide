#!/bin/bash
# Стенд oko-order Этапа 5: код из ../backend и ../frontend, копия живых данных,
# бот-заглушка и заглушка принтера. Порт 3099.
cd "$(dirname "$0")"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null; sleep 0.5
rm -rf src frontend && mkdir -p src/data src/middleware frontend/oko-order/admin
cp ../backend/*.js src/
cp stub-oko-shelf-life-store.js src/oko-shelf-life-store.js
cp stub-auth.js src/middleware/auth.js
cp ../frontend/order/index.html frontend/oko-order/index.html
cp ../frontend/admin/index.html frontend/oko-order/admin/index.html
cp /root/kitchendesk/backend/src/data/{oko-order-config.json,oko-orders.json,oko-known-chats.json} src/data/
cp /root/kitchendesk/backend/src/data/oko-order-groups.json src/data/ 2>/dev/null || true
cp -r /root/kitchendesk/backend/src/data/oko-order-media src/data/ 2>/dev/null || true
export NODE_PATH=/root/kitchendesk/backend/node_modules
PORT=3099 node server.js > server.log 2>&1 &
echo $! > server.pid
sleep 1.5
