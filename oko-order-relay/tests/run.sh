#!/bin/bash
# Сброс стенда на свежую копию живых данных и прогон тестов API.
cd "$(dirname "$0")"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null; sleep 0.5
cp /root/kitchendesk/backend/src/data/{oko-order-config.json,oko-orders.json,oko-known-chats.json} src/data/
rm -f src/data/print-jobs.json
PORT=3099 node server.js > server.log 2>&1 &
echo $! > server.pid
sleep 1.5
node test-api.js; rc=$?
echo "--- server.log:"; cat server.log
# перезапуск без сброса данных — сбросить счётчики лимитов перед UI-тестом
kill "$(cat server.pid)"; sleep 0.5
PORT=3099 node server.js >> server.log 2>&1 &
echo $! > server.pid
sleep 1.5
exit $rc
