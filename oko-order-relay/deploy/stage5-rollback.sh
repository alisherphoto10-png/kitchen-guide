#!/bin/bash
# Откат Этапа 5: код и статика /web Этапа 4. oko-orders.json НЕ возвращаем —
# выданные старым заказам shipToken код Этапа 4 понимает (QR продолжит работать).
set -euo pipefail
BK=$(cat /root/kitchendesk/backend/.oko-order-stage5-last-backup)
SRC=/root/kitchendesk/backend/src
WEB=/home/kitchendesk/frontend
cp "$BK/oko-order-api.js" "$BK/oko-order-store.js" $SRC/
pm2 restart kitchendesk --update-env >/dev/null
rm -rf "$WEB/_next"
tar -C "$WEB" -xzf "$BK/frontend-web.tgz"
echo "Откачено из $BK"
