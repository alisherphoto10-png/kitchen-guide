#!/bin/bash
# oko-order Этап 3b — вход в мастер /web/oko-order тем же паролем, что /oko-order/admin/
# Бэкенд: /admin/* снова только по паролю OKO_ADMIN_PASSWORD (вход логином
# KitchenDesk убран); группы и выключатель группы — как в Этапе 3. Фронт:
# мастер сам спрашивает пароль (sessionStorage, ключ как у старой админки).
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/root/kitchendesk/release-oko-order-stage3/oko-order-relay
SRC=/root/kitchendesk/backend/src
WEB=/home/kitchendesk/frontend
OUT=/home/oko-kitchen/oko-kitchen/oko-frontend/out
BK=$SRC/data/backup-oko-order-$(date +%Y%m%d-%H%M%S)-stage3b-predeploy
echo "1) Проверка: на проде ровно код Этапа 3"
cmp -s "$BASE/backend/oko-order-api.js" "$SRC/oko-order-api.js" || { echo "СТОП: живой oko-order-api.js отличается от Этапа 3"; exit 1; }
[ -f "$OUT/web/oko-order/index.html" ] || { echo "СТОП: нет сборки out/web/oko-order"; exit 1; }
del=$(rsync -a --delete --dry-run --itemize-changes "$OUT/" "$WEB/" | grep '^\*deleting' | grep -v ' _next/' | awk '{print $2}' | cut -d/ -f1 | sort -u | grep -vxE 'client-oko-logo.jpg|inventory|oko-order|print-admin|shelf-life|waiter-guide' || true)
[ -z "$del" ] || { echo "СТОП: rsync удалил бы неизвестное: $del"; exit 1; }
echo "2) Бэкап -> $BK"
mkdir -p "$BK"
cp -p $SRC/oko-order-api.js $SRC/data/oko-order-config.json "$BK/"
tar -C "$WEB" -czf "$BK/frontend-web.tgz" --exclude=./oko-order --exclude=./waiter-guide --exclude=./inventory --exclude=./shelf-life --exclude=./print-admin .
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage3b-last-backup
node --check "$REL/backend/oko-order-api.js"
echo "3) Бэкенд"
cp "$REL/backend/oko-order-api.js" $SRC/
pm2 restart kitchendesk --update-env >/dev/null
for k in oblako myaso; do
  TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['$k']['token'])")
  code=000
  for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true); [ "$code" = 200 ] && break; sleep 1; done
  echo "   $k: /items -> $code"
  [ "$code" = 200 ] || { echo "ПРОБЛЕМА — откат: stage3b-rollback.sh"; exit 1; }
done
echo "   /admin/config без входа -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/api/oko-order/admin/config) (ждём 401)"
P=$(grep -E '^OKO_ADMIN_PASSWORD=' /root/kitchendesk/backend/.env | cut -d= -f2- | tr -d '"')
echo "   /admin/groups с паролем -> $(curl -s -o /dev/null -w '%{http_code}' -H "X-Admin-Password: $P" http://127.0.0.1:3004/api/oko-order/admin/groups) (ждём 200)"
echo "4) Фронт /web"
rsync -a --delete --exclude=/client-oko-logo.jpg --exclude=/inventory/ --exclude=/oko-order/ --exclude=/print-admin/ --exclude=/shelf-life/ --exclude=/waiter-guide/ "$OUT/" "$WEB/"
echo "   /web/oko-order/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/oko-order/)"
echo "   /web/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/)"
echo "   /oko-order/admin/ (старая) -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/oko-order/admin/)"
echo "ГОТОВО."
