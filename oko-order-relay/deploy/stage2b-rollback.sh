#!/bin/bash
# Откат правки дизайна: вернуть код/страницы Этапа 2. Конфиг не трогаем
# (categoryPhotos код Этапа 2 просто не знает).
set -euo pipefail
SRC=/root/kitchendesk/backend/src; FRONT=/home/kitchendesk/frontend/oko-order
BK=${1:-$(cat /root/kitchendesk/backend/.oko-order-stage2b-last-backup)}
cp -p "$BK/oko-order-api.js" $SRC/
cp -p "$BK/frontend/index.html" $FRONT/index.html
cp -p "$BK/frontend/admin/index.html" $FRONT/admin/index.html
pm2 restart kitchendesk --update-env >/dev/null; echo "откат из $BK выполнен"
