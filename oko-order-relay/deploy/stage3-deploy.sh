#!/bin/bash
# oko-order Этап 3 — мастер настройки групп/тем в /web/oko-order (макет 01).
# Бэкенд: вход в /admin/* логином KitchenDesk (админ ОКО / суперадмин),
# группы (data/oko-order-groups.json), выключатель группы. Формы клиентов,
# ссылки и закреплённые кнопки не меняются. Фронт: сборка Next (out/).
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/root/kitchendesk/release-oko-order-stage2b/oko-order-relay
SRC=/root/kitchendesk/backend/src
WEB=/home/kitchendesk/frontend
OUT=/home/oko-kitchen/oko-kitchen/oko-frontend/out
BK=$SRC/data/backup-oko-order-$(date +%Y%m%d-%H%M%S)-stage3-predeploy
echo "1) Проверка: на проде ровно код Этапа 2b"
cmp -s "$BASE/backend/oko-order-api.js" "$SRC/oko-order-api.js" || { echo "СТОП: живой oko-order-api.js отличается от 2b"; exit 1; }
[ -f "$OUT/web/oko-order/index.html" ] || { echo "СТОП: нет сборки out/web/oko-order"; exit 1; }
del=$(rsync -a --delete --dry-run --itemize-changes "$OUT/" "$WEB/" | grep '^\*deleting' | grep -v ' _next/' | awk '{print $2}' | cut -d/ -f1 | sort -u | grep -vxE 'client-oko-logo.jpg|inventory|oko-order|print-admin|shelf-life|waiter-guide' || true)
[ -z "$del" ] || { echo "СТОП: rsync удалил бы неизвестное: $del"; exit 1; }
echo "2) Бэкап -> $BK"
mkdir -p "$BK"
cp -p $SRC/oko-order-api.js $SRC/data/oko-order-config.json "$BK/"
tar -C "$WEB" -czf "$BK/frontend-web.tgz" --exclude=./oko-order --exclude=./waiter-guide --exclude=./inventory --exclude=./shelf-life --exclude=./print-admin .
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage3-last-backup
node --check "$REL/backend/oko-order-api.js"
echo "3) Бэкенд"
cp "$REL/backend/oko-order-api.js" $SRC/
pm2 restart kitchendesk --update-env >/dev/null
for k in oblako myaso; do
  TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['$k']['token'])")
  code=000
  for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true); [ "$code" = 200 ] && break; sleep 1; done
  echo "   $k: /items -> $code"
  [ "$code" = 200 ] || { echo "ПРОБЛЕМА — откат: stage3-rollback.sh"; exit 1; }
done
echo "   /admin/config без входа -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/api/oko-order/admin/config) (ждём 401)"
echo "   /admin/groups с чужим Bearer -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer x' http://127.0.0.1:3004/api/oko-order/admin/groups) (ждём 401)"
echo "4) Фронт /web"
rsync -a --delete --exclude=/client-oko-logo.jpg --exclude=/inventory/ --exclude=/oko-order/ --exclude=/print-admin/ --exclude=/shelf-life/ --exclude=/waiter-guide/ "$OUT/" "$WEB/"
echo "   /web/oko-order/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/oko-order/)"
echo "   /web/ -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/web/)"
echo "   /oko-order/admin/ (старая) -> $(curl -s -o /dev/null -w '%{http_code}' https://kitchendesk.chefplan.ru/oko-order/admin/)"
echo "ГОТОВО."
