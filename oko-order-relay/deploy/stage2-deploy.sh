#!/bin/bash
# oko-order Этап 2 — новая форма клиента по макету 02 + фон/логотип/фото/единицы.
# Кнопки и ссылки клиентов НЕ меняются (те же ?f=...), конфиг не переписывается:
# старые позиции без единицы = «шт.», сообщения/тикеты для них не меняются.
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"
STAGE1=/root/kitchendesk/release-oko-order-stage1/oko-order-relay
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
TS=$(date +%Y%m%d-%H%M%S)
BK=$SRC/data/backup-oko-order-$TS-stage2-predeploy

echo "1) Проверка: на проде ровно код Этапа 1 (никто не менял после 30.09 19:51)"
drift=0
for pair in "backend/oko-order-api.js:$SRC/oko-order-api.js" "backend/oko-order-store.js:$SRC/oko-order-store.js" \
            "frontend/order/index.html:$FRONT/index.html" "frontend/admin/index.html:$FRONT/admin/index.html"; do
  rel=${pair%%:*}; live=${pair#*:}
  if ! cmp -s "$STAGE1/$rel" "$live"; then echo "   ИЗМЕНЁН: $live"; drift=1; fi
done
[ $drift = 0 ] || { echo "СТОП: живые файлы отличаются от Этапа 1 — сначала разобраться, не затирать."; exit 1; }

echo "2) Бэкап -> $BK"
mkdir -p "$BK/frontend/admin"
cp -p $SRC/oko-order-api.js $SRC/oko-order-store.js $SRC/data/oko-order-config.json $SRC/data/oko-orders.json "$BK/"
cp -p $FRONT/index.html "$BK/frontend/"; cp -p $FRONT/admin/index.html "$BK/frontend/admin/"
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage2-last-backup

echo "3) Проверка синтаксиса и sharp"
node --check "$REL/backend/oko-order-api.js"
(cd /root/kitchendesk/backend && node -e 'require("sharp")') || { echo "СТОП: нет sharp в backend/node_modules"; exit 1; }

echo "4) Копирование"
cp "$REL/backend/oko-order-api.js" $SRC/
cp "$REL/frontend/order/index.html" $FRONT/index.html
cp "$REL/frontend/admin/index.html" $FRONT/admin/index.html

echo "5) Перезапуск kitchendesk"
pm2 restart kitchendesk --update-env >/dev/null
TOK=$(python3 -c "import json;print(json.load(open('$SRC/data/oko-order-config.json'))['oblako']['token'])")
code=000
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" || true)
  [ "$code" = 200 ] && break; sleep 1
done
echo "   /items?f=<Облако>      -> $code"
units=$(curl -s "http://127.0.0.1:3004/api/oko-order/items?f=$TOK" | python3 -c "import json,sys;d=json.load(sys.stdin);print(set(i['unit'] for i in d['items']), 'coverUrl' in d)")
echo "   единицы/поле фона      -> $units (ждём {'шт.'} True)"
echo "   старый ?venue=oblako   -> $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3004/api/oko-order/items?venue=oblako') (ждём 410)"
echo "   страница формы         -> $(curl -s -o /dev/null -w '%{http_code}' "https://kitchendesk.chefplan.ru/oko-order/?f=$TOK")"
echo "   новая форма на месте   -> $(curl -s "https://kitchendesk.chefplan.ru/oko-order/?f=$TOK" | grep -c 'scr-review')"
if [ "$code" != 200 ]; then echo "ПРОБЛЕМА: форма не отвечает — откат: stage2-rollback.sh"; exit 1; fi
echo "ГОТОВО: Этап 2 на проде. Ссылки/кнопки клиентов те же."
