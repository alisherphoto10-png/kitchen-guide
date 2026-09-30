#!/bin/bash
# oko-order Этап 1 — ПЕРЕКЛЮЧЕНИЕ клиентов на секретные ссылки (делать при
# пользователе). Для каждой формы: новый токен → бот отправляет и закрепляет
# новую кнопку в теме клиента → только после успеха старый ?venue= выключается.
# Запуск: stage1-cutover.sh oblako   (по одной форме)  или  stage1-cutover.sh oblako myaso
set -euo pipefail
PASS=$(grep -m1 '^OKO_ADMIN_PASSWORD=' /root/kitchendesk/backend/.env | cut -d= -f2-)
API=http://127.0.0.1:3004/api/oko-order
[ $# -ge 1 ] || { echo "Укажите формы: oblako myaso"; exit 1; }
for v in "$@"; do
  echo "=== $v"
  resp=$(curl -s -H 'Content-Type: application/json' -H "X-Admin-Password: $PASS" -d "{\"venue\":\"$v\"}" $API/admin/rotate-link)
  echo "   rotate-link: $resp"
  echo "   старый адрес ?venue=$v -> $(curl -s -o /dev/null -w '%{http_code}' "$API/items?venue=$v") (ждём 410)"
  tok=$(python3 -c "import json;print(json.load(open('/root/kitchendesk/backend/src/data/oko-order-config.json'))['$v'].get('token',''))")
  echo "   новая ссылка ?f=...      -> $(curl -s -o /dev/null -w '%{http_code}' "$API/items?f=$tok") (ждём 200)"
done
