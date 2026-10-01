#!/bin/bash
# oko-order Этап 4 — статусы заказа: QR «Отправляется» на чеке, фото-чек
# ответом на «Заказ отправлен» → «Доставлено», история в форме клиента и
# раздел «Заказы» в мастере /web/oko-order. Ссылки/кнопки клиентов не меняются.
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/root/kitchendesk/release-oko-order-stage3b/oko-order-relay
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
WEB=/home/kitchendesk/frontend
OUT=/home/oko-kitchen/oko-kitchen/oko-frontend/out
BK=$SRC/data/backup-oko-order-$(date +%Y%m%d-%H%M%S)-stage4-predeploy
echo "1) Проверка: на проде ровно код Этапа 3b"
drift=0
for pair in "backend/oko-order-api.js:$SRC/oko-order-api.js" "backend/oko-order-store.js:$SRC/oko-order-store.js" "frontend/order/index.html:$FRONT/index.html"; do
  cmp -s "$BASE/${pair%%:*}" "${pair#*:}" || { echo "   ИЗМЕНЁН: ${pair#*:}"; drift=1; }
done
[ $drift = 0 ] || { echo "СТОП: живые файлы отличаются от Этапа 3b."; exit 1; }
[ -f "$OUT/web/oko-order/index.html" ] || { echo "СТОП: нет сборки out/"; exit 1; }
del=$(rsync -a --delete --dry-run --itemize-changes "$OUT/" "$WEB/" | grep '^\*deleting' | grep -v ' _next/' | awk '{print $2}' | cut -d/ -f1 | sort -u | grep -vxE 'client-oko-logo.jpg|inventory|oko-order|print-admin|shelf-life|waiter-guide' || true)
[ -z "$del" ] || { echo "СТОП: rsync удалил бы неизвестное: $del"; exit 1; }
echo "2) Бэкап -> $BK"
mkdir -p "$BK/frontend"
cp -p $SRC/oko-order-api.js $SRC/oko-order-store.js $SRC/data/oko-order-config.json $SRC/data/oko-orders.json "$BK/"
cp -p $FRONT/index.html "$BK/frontend/"
tar -C "$WEB" -czf "$BK/frontend-web.tgz" --exclude=./oko-order --exclude=./waiter-guide --exclude=./inventory --exclude=./shelf-life --exclude=./print-admin .
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage4-last-backup
node --check "$REL/backend/oko-order-api.js"; node --check "$REL/backend/oko-order-store.js"
echo "3) Бэкенд + форма клиента"
cp "$REL/backend/oko-order-api.js" "$REL/backend/oko-order-store.js" $SRC/
cp "$REL/frontend/order/index.html" $FRONT/index.html
pm2 restart kitchendesk --update-env >/dev/null
for k in oblako myaso; do
  TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['$k']['token'])")
  code=000
  for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true); [ "$code" = 200 ] && break; sleep 1; done
  h=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/history?f=$TOK")
  echo "   $k: /items -> $code, /history -> $h"
  [ "$code" = 200 ] && [ "$h" = 200 ] || { echo "ПРОБЛЕМА — откат: stage4-rollback.sh"; exit 1; }
done
echo "   /ship/<чужой> -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/api/oko-order/ship/AAAAAAAAAAAAAAAAAAAAAAAA) (ждём 404)"
echo "   /admin/orders без пароля -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/api/oko-order/admin/orders) (ждём 401)"
echo "   форма с историей: $(curl -s https://kitchendesk.chefplan.ru/oko-order/ | grep -c 'scr-history')"
echo "4) Фронт /web"
rsync -a --delete --exclude=/client-oko-logo.jpg --exclude=/inventory/ --exclude=/oko-order/ --exclude=/print-admin/ --exclude=/shelf-life/ --exclude=/waiter-guide/ "$OUT/" "$WEB/"
echo "   /web/oko-order/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/oko-order/), /web/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/)"
echo "ГОТОВО."
