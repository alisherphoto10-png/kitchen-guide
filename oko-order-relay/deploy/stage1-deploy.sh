#!/bin/bash
# oko-order Этап 1 — деплой кода (НЕ переключает кнопки клиентов).
# После него всё работает как раньше: старые ?venue=oblako/myaso живы,
# добавляются проверки заказа (вариант Г), секретные ссылки, «Активна».
# Переключение кнопок — отдельно: stage1-cutover.sh.
set -euo pipefail
REL="$(cd "$(dirname "$0")/.." && pwd)"          # папка oko-order-relay релиза
SRC=/root/kitchendesk/backend/src
FRONT=/home/kitchendesk/frontend/oko-order
STAGE0=$SRC/data/backup-oko-order-20260930-stage0
TS=$(date +%Y%m%d-%H%M%S)
BK=$SRC/data/backup-oko-order-$TS-predeploy

echo "1) Проверка: живые файлы не менялись с бэкапа Этапа 0"
drift=0
for pair in "oko-order-api.js:$SRC/oko-order-api.js" "oko-order-store.js:$SRC/oko-order-store.js" \
            "frontend/index.html:$FRONT/index.html" "frontend/admin/index.html:$FRONT/admin/index.html"; do
  rel=${pair%%:*}; live=${pair#*:}
  if ! cmp -s "$STAGE0/$rel" "$live"; then echo "   ИЗМЕНЁН с 30.09 18:12: $live"; drift=1; fi
done
[ $drift = 0 ] || { echo "СТОП: кто-то менял живые файлы после Этапа 0 — сначала разобраться, не затирать."; exit 1; }

echo "2) Бэкап перед деплоем -> $BK"
mkdir -p "$BK/frontend/admin"
cp -p $SRC/oko-order-api.js $SRC/oko-order-store.js $SRC/data/oko-order-config.json $SRC/data/oko-orders.json "$BK/"
cp -p $FRONT/index.html "$BK/frontend/"; cp -p $FRONT/admin/index.html "$BK/frontend/admin/"
echo "$BK" > /root/kitchendesk/backend/.oko-order-stage1-last-backup

echo "3) Проверка синтаксиса релиза"
node --check "$REL/backend/oko-order-api.js"; node --check "$REL/backend/oko-order-store.js"

echo "4) Копирование"
cp "$REL/backend/oko-order-api.js" "$REL/backend/oko-order-store.js" $SRC/
cp "$REL/frontend/order/index.html" $FRONT/index.html
cp "$REL/frontend/admin/index.html" $FRONT/admin/index.html

echo "5) Перезапуск kitchendesk"
pm2 restart kitchendesk --update-env >/dev/null
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?venue=oblako" || true)
  [ "$code" = 200 ] && break; sleep 1
done
echo "   /items?venue=oblako -> $code"
code2=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3004/api/oko-order/items?venue=myaso")
echo "   /items?venue=myaso  -> $code2"
page=$(curl -s -o /dev/null -w '%{http_code}' "https://kitchendesk.chefplan.ru/oko-order/?venue=oblako")
echo "   страница формы       -> $page"
if [ "$code" != 200 ] || [ "$code2" != 200 ]; then
  echo "ПРОБЛЕМА: форма не отвечает — откат: stage1-rollback.sh"; exit 1
fi
echo "ГОТОВО: код Этапа 1 на проде, кнопки клиентов не тронуты (старые ссылки работают)."
