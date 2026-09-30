#!/bin/bash
# Откат Этапа 2: код и страницы из бэкапа stage2-deploy.sh (= Этап 1).
# Конфиг НЕ откатывается: код Этапа 1 просто игнорирует новые поля
# (unit, photoUrl, coverUrl, logoUrl) — позиции в кг снова станут «шт.»
# в сообщениях. Заказы не трогаем. Загруженные картинки остаются в
# data/oko-order-media/ (не мешают).
set -euo pipefail
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
BK=${1:-$(cat /root/kitchendesk/backend/.oko-order-stage2-last-backup)}
echo "Откат из $BK"
cp -p "$BK/oko-order-api.js" "$BK/oko-order-store.js" $SRC/
cp -p "$BK/frontend/index.html" $FRONT/index.html
cp -p "$BK/frontend/admin/index.html" $FRONT/admin/index.html
pm2 restart kitchendesk --update-env >/dev/null
sleep 3
TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['oblako']['token'])")
echo "/items?f=<Облако> -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK")"
