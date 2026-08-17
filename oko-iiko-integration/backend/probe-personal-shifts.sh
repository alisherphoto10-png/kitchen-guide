#!/usr/bin/env bash
# Разведка Части 12: есть ли у iiko read-доступ (HTTP, не терминал/плагин)
# к моменту открытия личной смены сотрудника. Ничего не предполагаем —
# пробуем кандидатов, смотрим на реальный код ответа и тело.
#
# Запускать в сессии, у которой есть сетевой доступ до iiko (не эта сессия
# в kitchen-guide — там egress заблокирован, см. Часть 9/10).
#
# Использование:
#   IIKO_BASE_URL=https://XXX.iiko.it IIKO_LOGIN=... IIKO_PASSWORD=... \
#     ./probe-personal-shifts.sh
#
# Креды — те же, что у API-пользователя (B_VN+B_PER+B_EN), не личный
# админский логин: если что-то из проверяемого ниже потребует более
# широких прав, это будет видно по коду ответа (403), а не тихо.

set -euo pipefail

BASE_URL="${IIKO_BASE_URL:?Задай IIKO_BASE_URL}"
LOGIN="${IIKO_LOGIN:?Задай IIKO_LOGIN}"
PASSWORD="${IIKO_PASSWORD:?Задай IIKO_PASSWORD}"

echo "== Авторизация =="
TOKEN=$(curl -sS -k "${BASE_URL}/resto/api/auth?login=${LOGIN}&pass=${PASSWORD}")
if [[ "$TOKEN" == *"<html"* || -z "$TOKEN" ]]; then
  echo "Авторизация не удалась, ответ: $TOKEN"
  exit 1
fi
echo "Токен получен: ${TOKEN:0:8}..."
echo

probe() {
  local desc="$1"; local url="$2"
  echo "---- $desc"
  echo "GET $url"
  local resp
  resp=$(curl -sS -k -w "\nHTTP_CODE:%{http_code}" "$url")
  local code
  code=$(echo "$resp" | grep -o 'HTTP_CODE:[0-9]*' | cut -d: -f2)
  local body
  body=$(echo "$resp" | sed '$d')
  echo "код: $code"
  echo "тело (первые 400 символов): ${body:0:400}"
  echo
}

echo "== Кандидат 1: employees.jsp — смотрим, есть ли вообще поля про смену/явку =="
probe "employees.jsp" "${BASE_URL}/resto/api/employees.jsp?key=${TOKEN}"

echo "== Кандидат 2: generic entities list — та же механика, что уже подтверждена для MeasureUnit (Часть 5) =="
for rootType in PersonalShift Attendance EmployeeAttendance Session PersonalSession; do
  probe "entities/list?rootType=${rootType}" "${BASE_URL}/resto/api/v2/entities/list?rootType=${rootType}&key=${TOKEN}"
done

echo "== Кандидат 3: OLAP-отчёты — сначала baseline (известно рабочий тип SALES), потом кандидаты на явку =="
for reportType in SALES ATTENDANCE EMPLOYEE_ATTENDANCE PERSONAL_SHIFTS TRANSACTIONS; do
  probe "reports/olap/columns?reportType=${reportType}" "${BASE_URL}/resto/api/v2/reports/olap/columns?reportType=${reportType}&key=${TOKEN}"
done

echo "== Готово. =="
echo "Что смотреть в результате:"
echo "- 200 + осмысленное тело (не пустой список/не HTML с ошибкой) — рабочий кандидат, копать дальше."
echo "- 403 Permission denied — эндпоинт существует, но не хватает прав; записать точный код права из ошибки (не гадать, как раньше с B_EN)."
echo "- 404/400 — такого эндпоинта/типа нет, кандидат отпадает."
echo "- SALES из кандидата 3 — используется как контроль: если и он вернул не 200, значит сама OLAP-часть API недоступна вообще, дальше там смысла нет копать."
