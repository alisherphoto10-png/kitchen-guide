#!/bin/bash
# Откат Этапа 4: код/форма/статика Этапа 3b. oko-orders.json НЕ возвращаем
# (там могли появиться новые заказы) — новые поля (shipToken, shipping,
# received, items…) код 3b просто игнорирует.
set -euo pipefail
BK=$(cat /root/kitchendesk/backend/.oko-order-stage4-last-backup)
SRC=/root/kitchendesk/backend/src
WEB=/home/kitchendesk/frontend
cp "$BK/oko-order-api.js" "$BK/oko-order-store.js" $SRC/
cp "$BK/frontend/index.html" $WEB/oko-order/index.html
pm2 restart kitchendesk --update-env >/dev/null
rm -rf "$WEB/_next"
tar -C "$WEB" -xzf "$BK/frontend-web.tgz"
echo "Откачено из $BK"
