#!/bin/bash
# Откат Этапа 1: вернуть код/страницы из бэкапа, сделанного stage1-deploy.sh.
# Конфиг форм (oko-order-config.json) НЕ откатывается автоматически —
# токены/выключенные старые адреса старый код просто игнорирует (он не знает
# этих полей), и старые ?venue= ссылки снова заработают. Если нужно вернуть
# и конфиг: cp "$BK/oko-order-config.json" в data/ (заказы — не трогать,
# в oko-orders.json уже могут быть новые заказы).
set -euo pipefail
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
BK=${1:-$(cat /root/kitchendesk/backend/.oko-order-stage1-last-backup)}
echo "Откат из $BK"
cp -p "$BK/oko-order-api.js" "$BK/oko-order-store.js" $SRC/
cp -p "$BK/frontend/index.html" $FRONT/index.html
cp -p "$BK/frontend/admin/index.html" $FRONT/admin/index.html
pm2 restart kitchendesk --update-env >/dev/null
sleep 3
echo "/items?venue=oblako -> $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3004/api/oko-order/items?venue=oblako')"
echo "ВНИМАНИЕ: если переключение уже было — закреплённые новые кнопки ведут на ?f=..., старый код их не понимает."
echo "Закрепите старые кнопки: админка → «Отправить и закрепить кнопку в теме» (старый код шлёт ?venue=)."
