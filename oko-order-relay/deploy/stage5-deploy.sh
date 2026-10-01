#!/bin/bash
# oko-order Этап 5 — «Распечатать чек с QR» для уже существующего заказа
# (раздел «Заказы» мастера) + быстрый доступ к темам на главном экране мастера
# (плоский список с поиском, прямая ссылка #topic=<ключ>). Форма клиента и
# данные не меняются.
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/root/kitchendesk/release-oko-order-stage4/oko-order-relay
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
WEB=/home/kitchendesk/frontend
OUT=/home/oko-kitchen/oko-kitchen/oko-frontend/out
BK=$SRC/data/backup-oko-order-$(date +%Y%m%d-%H%M%S)-stage5-predeploy
echo "1) Проверка: на проде ровно код Этапа 4"
drift=0
for pair in "backend/oko-order-api.js:$SRC/oko-order-api.js" "backend/oko-order-store.js:$SRC/oko-order-store.js" "frontend/order/index.html:$FRONT/index.html"; do
  cmp -s "$BASE/${pair%%:*}" "${pair#*:}" || { echo "   ИЗМЕНЁН: ${pair#*:}"; drift=1; }
done
[ $drift = 0 ] || { echo "СТОП: живые файлы отличаются от Этапа 4."; exit 1; }
grep -q "QuickTopics\|Быстрый переход к нужной теме" "$OUT"/_next/static/chunks/app/web/oko-order/*.js 2>/dev/null || grep -rlq "Быстрый переход к нужной теме" "$OUT/_next/static" || { echo "СТОП: в out/ нет сборки Этапа 5"; exit 1; }
del=$(rsync -a --delete --dry-run --itemize-changes "$OUT/" "$WEB/" | grep '^\*deleting' | grep -v ' _next/' | awk '{print $2}' | cut -d/ -f1 | sort -u | grep -vxE 'client-oko-logo.jpg|inventory|oko-order|print-admin|shelf-life|waiter-guide' || true)
[ -z "$del" ] || { echo "СТОП: rsync удалил бы неизвестное: $del"; exit 1; }
echo "2) Бэкап -> $BK"
mkdir -p "$BK"
cp -p $SRC/oko-order-api.js $SRC/oko-order-store.js $SRC/data/oko-order-config.json $SRC/data/oko-orders.json "$BK/"
tar -C "$WEB" -czf "$BK/frontend-web.tgz" --exclude=./oko-order --exclude=./waiter-guide --exclude=./inventory --exclude=./shelf-life --exclude=./print-admin .
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage5-last-backup
node --check "$REL/backend/oko-order-api.js"; node --check "$REL/backend/oko-order-store.js"
echo "3) Бэкенд"
cp "$REL/backend/oko-order-api.js" "$REL/backend/oko-order-store.js" $SRC/
pm2 restart kitchendesk --update-env >/dev/null
for k in oblako myaso; do
  TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['$k']['token'])")
  code=000
  for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true); [ "$code" = 200 ] && break; sleep 1; done
  echo "   $k: /items -> $code"
  [ "$code" = 200 ] || { echo "ПРОБЛЕМА — откат: stage5-rollback.sh"; exit 1; }
done
echo "   /admin/orders/print-qr без пароля -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3004/api/oko-order/admin/orders/print-qr) (ждём 401)"
echo "4) Фронт /web"
rsync -a --delete --exclude=/client-oko-logo.jpg --exclude=/inventory/ --exclude=/oko-order/ --exclude=/print-admin/ --exclude=/shelf-life/ --exclude=/waiter-guide/ "$OUT/" "$WEB/"
echo "   /web/oko-order/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/oko-order/), /web/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/)"
echo "ГОТОВО."
