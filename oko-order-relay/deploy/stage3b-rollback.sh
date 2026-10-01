#!/bin/bash
# Откат 3b: код и статика Этапа 3 (вход логином KitchenDesk).
# data/oko-order-groups.json остаётся (код 2b его просто не читает).
set -euo pipefail
BK=$(cat /root/kitchendesk/backend/.oko-order-stage3b-last-backup)
SRC=/root/kitchendesk/backend/src
WEB=/home/kitchendesk/frontend
cp "$BK/oko-order-api.js" $SRC/oko-order-api.js
pm2 restart kitchendesk --update-env >/dev/null
rm -rf "$WEB/_next" "$WEB/web/oko-order"
tar -C "$WEB" -xzf "$BK/frontend-web.tgz"
echo "Откачено из $BK"
