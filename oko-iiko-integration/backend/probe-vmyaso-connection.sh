#!/usr/bin/env bash
# Точечная разведка для vmyaso-co-tash: смотрим сырой ответ ровно того
# запроса, который реально делает KitchenDesk при "Проверить" — не
# полагаемся на баннер ошибки в приложении (он может быть обобщённым, не
# дословным ответом от iiko).
#
# Запускать в сессии с реальным сетевым доступом до iiko (не в этой
# сессии kitchen-guide — там egress заблокирован).
#
# Использование:
#   ./probe-vmyaso-connection.sh <логин> <пароль>

set -euo pipefail

LOGIN="${1:?Использование: ./probe-vmyaso-connection.sh <логин> <пароль>}"
PASSWORD="${2:?Использование: ./probe-vmyaso-connection.sh <логин> <пароль>}"
BASE_URL="https://vmyaso-co-tash.iiko.it"

echo "== 1. Сырой ответ на /resto/api/auth (ровно то, что делает 'Проверить' в KitchenDesk) =="
curl -sS -k -i "${BASE_URL}/resto/api/auth?login=${LOGIN}&pass=${PASSWORD}" | head -40
echo
echo "---"
echo

echo "== 2. Заголовки ответа отдельно (что за сервер вообще отвечает — Server:, X-Powered-By: и т.п.) =="
curl -sS -k -D - -o /dev/null "${BASE_URL}/resto/api/auth?login=${LOGIN}&pass=${PASSWORD}"
echo

echo "== 3. Для сравнения — тот же путь на заведомо рабочем демо-стенде =="
echo "(если есть под рукой домен демо-стенда — сравнить формат ответа/заголовков вручную)"

echo
echo "== Готово =="
echo "Смотреть: код ответа (200/401/403/404/подключение не удалось вообще —"
echo "это разные вещи), заголовок Server: (говорит, что за софт вообще"
echo "ответил — реальный iikoRMS обычно себя обозначает, а не безликий 404"
echo "от неизвестного веб-сервера/прокси), и есть ли в теле хоть что-то"
echo "похожее на XML/токен, а не просто текст 'page not found'."
