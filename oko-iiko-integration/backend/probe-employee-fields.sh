#!/usr/bin/env bash
# Живая проверка: какие именно поля реально отдаёт iiko в ответе на
# getEmployees (classic REST API: /resto/api/employees.jsp) для
# урезанного API-пользователя (B_VN+B_PER+B_EN). Нужна для честного
# ответа заведению, что именно открывает право B_PER — не только имя,
# как использует KitchenDesk, а то, что реально в схеме iiko.
#
# Запускать в сессии с реальным сетевым доступом до iiko (не эта сессия
# в kitchen-guide — egress туда заблокирован).
#
# Использование:
#   IIKO_BASE_URL=https://XXX.iiko.it IIKO_LOGIN=... IIKO_PASSWORD=... \
#     ./probe-employee-fields.sh

set -euo pipefail

BASE_URL="${IIKO_BASE_URL:?Задай IIKO_BASE_URL}"
LOGIN="${IIKO_LOGIN:?Задай IIKO_LOGIN}"
PASSWORD="${IIKO_PASSWORD:?Задай IIKO_PASSWORD}"
OUT="employees-raw.xml"

echo "== Авторизация =="
TOKEN=$(curl -sS -k "${BASE_URL}/resto/api/auth?login=${LOGIN}&pass=${PASSWORD}")
if [[ "$TOKEN" == *"<html"* || -z "$TOKEN" ]]; then
  echo "Авторизация не удалась, ответ: $TOKEN"
  exit 1
fi
echo "Токен получен: ${TOKEN:0:8}..."
echo

echo "== Запрос списка сотрудников =="
curl -sS -k "${BASE_URL}/resto/api/employees.jsp?key=${TOKEN}" -o "$OUT"
echo "Сохранено в $OUT ($(wc -c < "$OUT") байт)"
echo

echo "== Уникальные поля (теги XML) во всём ответе =="
python3 - "$OUT" <<'EOF'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
tree = ET.parse(path)
root = tree.getroot()

tags = set()
for el in root.iter():
    tags.add(el.tag)

for t in sorted(tags):
    print(f"- {t}")
EOF
echo

echo "== Пример одной записи (первый сотрудник) целиком =="
python3 - "$OUT" <<'EOF'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
tree = ET.parse(path)
root = tree.getroot()

# employees.jsp обычно отдаёт список employee/corporateEmployee-подобных узлов
first = None
for el in root:
    first = el
    break

if first is None:
    print("Не нашёл ни одной записи — список пуст.")
else:
    for child in first:
        value = (child.text or "").strip()
        print(f"{child.tag}: {value if value else '(пусто)'}")
EOF

echo
echo "== Готово =="
echo "Смотреть: 1) полный список тегов выше — это ВСЯ схема, которую в"
echo "принципе может отдать iiko для этого права; 2) пример записи — что"
echo "реально заполнено у ваших сотрудников (пустое поле в схеме не значит"
echo "утечку — значит, что в iiko это поле просто не заведено)."
echo "Файл $OUT можно приложить как доказательство, если понадобится"
echo "показать руководству дословно, что видно через API."
