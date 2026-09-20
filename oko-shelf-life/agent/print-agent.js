// Локальный агент печати этикеток — крутится на моноблоке (Windows),
// который постоянно в одной сети с принтером. Сервер KitchenDesk — в
// облаке, до принтера напрямую не достаёт, поэтому этот агент раз в
// несколько секунд спрашивает у сервера "есть что печатать?", и если
// есть — сам шлёт данные принтеру по сети (порт 9100, ESC/POS).
//
// Запуск: node print-agent.js
// Проверка кодовой страницы (кириллица) — см. ниже, раздел "ТЕСТ КОДОВОЙ
// СТРАНИЦЫ", если на первом реальном чеке кириллица напечаталась крякозябрами.
//
// Только встроенные модули Node — ничего дополнительно ставить (npm install)
// не нужно, специально для простого запуска на моноблоке.

const http = require("http");
const https = require("https");
const net = require("net");

// ---------------- НАСТРОЙКИ — поправить под себя ----------------
const CONFIG = {
  BACKEND_URL: "https://kitchendesk.chefplan.ru", // адрес KitchenDesk
  AGENT_TOKEN: "CHANGE_ME", // тот же секрет, что в OKO_SHELF_LIFE_AGENT_TOKEN на сервере
  PRINTER_IP: "192.168.0.122", // IP принтера (см. тестовую печать с самого принтера)
  PRINTER_PORT: 9100,
  POLL_INTERVAL_MS: 4000,
  // Кодовая страница для кириллицы (ESC t n). У разных прошивок разный
  // номер — 17 (CP866) самый частый на клонах, но не гарантия. Если на
  // чеке кириллица напечаталась абракадаброй — запустите
  // "node print-agent.js --codepage-test" (см. ниже) и впишите сюда номер,
  // при котором русский текст на бумаге читается нормально.
  CYRILLIC_CODEPAGE: 17,
};
// ------------------------------------------------------------------

function httpJson(urlStr, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(
      url,
      {
        method,
        headers: {
          ...headers,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sendToPrinter(buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: CONFIG.PRINTER_IP, port: CONFIG.PRINTER_PORT }, () => {
      socket.write(buffer, () => socket.end());
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("Таймаут соединения с принтером"));
    });
    socket.on("close", resolve);
    socket.on("error", reject);
  });
}

const ESC = 0x1b;
const GS = 0x1d;

// Кириллица через кодовую страницу принтера, не UTF-8 (ESC/POS-принтеры
// почти никогда не понимают UTF-8 напрямую) — CP866 (та же, что в
// старом MS-DOS) конвертируется вручную, без внешних библиотек: таблица
// только для А-Я/а-я/Ёё, этого достаточно для наших этикеток.
const CP866_MAP = (() => {
  const map = {};
  const upperStart = 0x80; // А-Пп... в CP866 заглавные А-Я идут с 0x80
  const ruUpper = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
  const ruLower = "абвгдежзийклмнопрстуфхцчшщъыьэюя";
  for (let i = 0; i < ruUpper.length; i++) map[ruUpper[i]] = upperStart + i;
  const lowerStart = 0xa0; // а-п идут с 0xA0
  for (let i = 0; i < 16; i++) map[ruLower[i]] = lowerStart + i; // а..п
  const lowerStart2 = 0xe0; // р-я идут с 0xE0
  for (let i = 16; i < ruLower.length; i++) map[ruLower[i]] = lowerStart2 + (i - 16);
  map["Ё"] = 0xf0;
  map["ё"] = 0xf1;
  return map;
})();

function textToCp866(text) {
  const bytes = [];
  for (const ch of text) {
    if (CP866_MAP[ch] !== undefined) bytes.push(CP866_MAP[ch]);
    else if (ch.charCodeAt(0) < 128) bytes.push(ch.charCodeAt(0));
    else bytes.push(0x3f); // "?" — символ вне таблицы (не должно случаться на наших этикетках)
  }
  return Buffer.from(bytes);
}

// GS ( k — печать QR-кода, стандартная для ESC/POS-принтеров с
// поддержкой 2D-штрихкодов (у нашего подтверждено самотестом принтера:
// "Barcode 2D Support: QRCODE..."). Данные — просто строка (ссылка,
// id чек-листа, что угодно), сам принтер рисует код, агенту не нужна
// библиотека рисования QR.
function qrCodeCommand(data) {
  const dataBytes = Buffer.from(data, "utf8"); // QR сам по себе кодирует байты как есть, не через CP866
  const storeLen = dataBytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // модель QR — модель 2
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]), // размер модуля — 6 (крупнее/мельче: 1-16)
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]), // коррекция ошибок — уровень M
    Buffer.from([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]), // сохранить данные в буфер QR
    dataBytes,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // напечатать сохранённый QR
  ]);
}

// Сами строки этикетки (что печатать и в каком порядке) присылает
// сервер в job.printLines — агент их не сочиняет, только кодирует и
// шлёт байты. Так любая правка дизайна чека — только на сервере, этот
// файл на моноблоке трогать больше не придётся (см. README). Помимо
// текста задание может нести job.qrData (строка) — тогда после текста
// печатается QR-код с этими данными (например, для будущей идеи:
// отсканировать QR и закрыть чек-лист смены).
function buildLabel(job) {
  const lines = job.printLines || [job.itemName || "(пустая этикетка)"];
  const chunks = [];
  chunks.push(Buffer.from([ESC, 0x40])); // ESC @ — сброс
  chunks.push(Buffer.from([ESC, 0x74, CONFIG.CYRILLIC_CODEPAGE])); // ESC t n — кодовая страница
  lines.forEach((line) => {
    chunks.push(textToCp866(line));
    chunks.push(Buffer.from([0x0a]));
  });
  if (job.qrData) {
    chunks.push(Buffer.from([ESC, 0x61, 0x01])); // ESC a 1 — по центру, только для QR
    chunks.push(qrCodeCommand(job.qrData));
    chunks.push(Buffer.from([0x0a]));
    chunks.push(Buffer.from([ESC, 0x61, 0x00])); // обратно по левому краю
  }
  chunks.push(Buffer.from([0x0a, 0x0a, 0x0a]));
  chunks.push(Buffer.from([GS, 0x56, 0x00])); // GS V 0 — обрезка
  return Buffer.concat(chunks);
}

async function printJob(job) {
  console.log(`[печать] ${job.itemName} — ${job.action} (${job.by})`);
  const buffer = buildLabel(job);
  await sendToPrinter(buffer);
  await httpJson(`${CONFIG.BACKEND_URL}/api/oko-shelf-life-print/jobs/${job.id}/done`, {
    method: "POST",
    headers: { "X-Agent-Token": CONFIG.AGENT_TOKEN },
  });
  console.log(`[готово] ${job.itemName} напечатано и отмечено в KitchenDesk`);
}

async function pollOnce() {
  let jobs;
  try {
    jobs = await httpJson(`${CONFIG.BACKEND_URL}/api/oko-shelf-life-print/jobs/pending`, {
      headers: { "X-Agent-Token": CONFIG.AGENT_TOKEN },
    });
  } catch (err) {
    console.error("[ошибка] не удалось получить задания:", err.message);
    return;
  }
  for (const job of jobs) {
    try {
      await printJob(job);
    } catch (err) {
      console.error(`[ошибка печати] ${job.itemName}:`, err.message);
      // не отмечаем как done — заберём и попробуем снова на следующем опросе
    }
  }
}

// ---------------- ТЕСТ КОДОВОЙ СТРАНИЦЫ ----------------
// node print-agent.js --codepage-test
// Печатает одну и ту же русскую фразу под разными номерами кодовой
// страницы подряд — на бумаге найдите строку, где текст читается
// нормально, номер слева впишите в CONFIG.CYRILLIC_CODEPAGE выше.
async function codepageTest() {
  const sample = "Проверка кириллицы — Крем ОКО";
  const candidates = [17, 18, 19, 6, 7, 34, 255];
  const chunks = [Buffer.from([ESC, 0x40])];
  for (const cp of candidates) {
    chunks.push(Buffer.from([ESC, 0x74, cp]));
    chunks.push(Buffer.from(`CP${cp}: `, "ascii"));
    chunks.push(textToCp866(sample));
    chunks.push(Buffer.from([0x0a]));
  }
  chunks.push(Buffer.from([0x0a, 0x0a, 0x0a]));
  chunks.push(Buffer.from([GS, 0x56, 0x00]));
  console.log(`Отправляю тест кодовых страниц на ${CONFIG.PRINTER_IP}:${CONFIG.PRINTER_PORT}...`);
  await sendToPrinter(Buffer.concat(chunks));
  console.log("Готово — посмотрите на чек, какая строка читается нормально, впишите этот номер в CYRILLIC_CODEPAGE.");
}

// ---------------- запуск ----------------
if (process.argv.includes("--codepage-test")) {
  codepageTest().catch((err) => console.error("Ошибка теста:", err.message));
} else {
  console.log(`Агент печати KitchenDesk запущен. Опрашиваю ${CONFIG.BACKEND_URL} каждые ${CONFIG.POLL_INTERVAL_MS / 1000} сек.`);
  setInterval(pollOnce, CONFIG.POLL_INTERVAL_MS);
  pollOnce();
}
