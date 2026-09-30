#!/bin/bash
# oko-order — правка дизайна после Этапа 2 (тёплая палитра, высокая шапка,
# значки/фото категорий, планшет). Ссылки/кнопки/конфиг клиентов не меняются.
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/root/kitchendesk/release-oko-order-stage2/oko-order-relay
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
BK=$SRC/data/backup-oko-order-$(date +%Y%m%d-%H%M%S)-stage2b-predeploy
echo "1) Проверка: на проде ровно код Этапа 2"
drift=0
for pair in "backend/oko-order-api.js:$SRC/oko-order-api.js" "frontend/order/index.html:$FRONT/index.html" "frontend/admin/index.html:$FRONT/admin/index.html"; do
  cmp -s "$BASE/${pair%%:*}" "${pair#*:}" || { echo "   ИЗМЕНЁН: ${pair#*:}"; drift=1; }
done
[ $drift = 0 ] || { echo "СТОП: живые файлы отличаются от Этапа 2."; exit 1; }
echo "2) Бэкап -> $BK"
mkdir -p "$BK/frontend/admin"
cp -p $SRC/oko-order-api.js $SRC/data/oko-order-config.json "$BK/"
cp -p $FRONT/index.html "$BK/frontend/"; cp -p $FRONT/admin/index.html "$BK/frontend/admin/"
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage2b-last-backup
node --check "$REL/backend/oko-order-api.js"
echo "3) Копирование и перезапуск"
cp "$REL/backend/oko-order-api.js" $SRC/
cp "$REL/frontend/order/index.html" $FRONT/index.html
cp "$REL/frontend/admin/index.html" $FRONT/admin/index.html
pm2 restart kitchendesk --update-env >/dev/null
for k in oblako myaso; do
  TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['$k']['token'])")
  code=000
  for i in $(seq 1 20); do code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true); [ "$code" = 200 ] && break; sleep 1; done
  echo "   $k: /items -> $code, categoryPhotos в ответе: $(curl -s "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" | python3 -c 'import json,sys;print("categoryPhotos" in json.load(sys.stdin))'), страница -> $(curl -s -o /dev/null -w '%{http_code}' "https://kitchendesk.chefplan.ru/oko-order/?f=$TOK")"
  [ "$code" = 200 ] || { echo "ПРОБЛЕМА — откат: stage2b-rollback.sh"; exit 1; }
done
echo "   новая форма на месте: $(curl -s https://kitchendesk.chefplan.ru/oko-order/ | grep -c 'date-card')"
echo "ГОТОВО."
