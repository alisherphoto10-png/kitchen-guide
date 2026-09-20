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
const path = require("path");
const fs = require("fs");

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

// Печатается один раз при каждом запуске агента (в том числе — при
// автозагрузке молча в фоне) — просто физическое подтверждение "агент
// жив", чтобы не гадать, поднялся ли он после включения моноблока.
// Ошибку принтера в этот момент не считаем сбоем всего агента — просто
// сообщаем в консоль и идём дальше к обычному опросу заданий.
function startupTimeText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function printStartupConfirmation() {
  const job = {
    printLines: ["KitchenDesk", "------------------------------", "Агент печати запущен", startupTimeText(), "------------------------------"],
  };
  try {
    await sendToPrinter(buildLabel(job));
    console.log("[старт] подтверждение запуска отправлено на принтер.");
  } catch (err) {
    console.error("[старт] не удалось напечатать подтверждение запуска (принтер недоступен?):", err.message);
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

// ---------------- АВТОЗАГРУЗКА ----------------
// node print-agent.js --install-autostart
// Сам кладёт файл запуска в папку автозагрузки Windows — руками искать
// "shell:startup" и делать ярлык не нужно.
//
// Запускается БЕЗ видимого окна консоли: в папку автозагрузки кладётся
// не сам .bat, а маленький .vbs-скрипт, который запускает .bat через
// WScript.Shell.Run с окном "0" (скрытое) — это стандартный способ на
// Windows запустить консольную программу вообще без чёрного окна.
// Подтверждение, что агент поднялся, — тестовый чек на принтере при
// каждом старте (см. printStartupConfirmation выше), окно на экране не
// нужно и не появляется.
function installAutostart() {
  const appData = process.env.APPDATA; // на Windows всегда задана, кроме как в testing-окружениях
  if (!appData) {
    console.error("Не нашёл папку автозагрузки (переменная APPDATA пустая) — это точно Windows?");
    return;
  }
  const startupDir = path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const scriptDir = __dirname;
  // .bat лежит рядом со скриптом (не в автозагрузке) — его запускает .vbs
  const batPath = path.join(scriptDir, "KitchenDeskPrintAgentLauncher.bat");
  const batContent = `@echo off\r\ncd /d "${scriptDir}"\r\nnode print-agent.js\r\n`;
  const vbsName = "KitchenDeskPrintAgent.vbs";
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run Chr(34) & "${batPath}" & Chr(34), 0, False\r\n`;
  const startupVbsPath = path.join(startupDir, vbsName);
  const localVbsPath = path.join(scriptDir, vbsName); // копия рядом со скриптом — чтобы запустить прямо сейчас, не дожидаясь перезагрузки

  try {
    fs.mkdirSync(startupDir, { recursive: true }); // на реальном Windows папка уже есть, это просто подстраховка
    fs.writeFileSync(batPath, batContent, "utf8");
    fs.writeFileSync(startupVbsPath, vbsContent, "utf8");
    fs.writeFileSync(localVbsPath, vbsContent, "utf8");

    // старая версия клала видимый .bat прямо в автозагрузку под тем же
    // именем — если он остался с прошлого раза, при входе в систему
    // запустятся ОБА (старый видимый + новый скрытый) и агент задвоится.
    const oldVisibleBatPath = path.join(startupDir, "KitchenDeskPrintAgent.bat");
    try {
      fs.unlinkSync(oldVisibleBatPath);
    } catch {
      // не было — и хорошо
    }

    console.log("Готово! Агент добавлен в автозагрузку — БЕЗ видимого окна на экране.");
    console.log("При каждом включении компьютера он будет запускаться сам в фоне, тихо.");
    console.log("Подтверждение, что он поднялся, — тестовый чек на принтере при каждом запуске.");
    console.log("");
    console.log(`Запустить прямо сейчас (тоже без окна) — дважды кликните файл "${vbsName}" рядом со print-agent.js,`);
    console.log(`либо командой: wscript "${localVbsPath}"`);
  } catch (err) {
    console.error("Не получилось создать файлы автозагрузки:", err.message);
  }
}

// ---------------- запуск ----------------
if (process.argv.includes("--codepage-test")) {
  codepageTest().catch((err) => console.error("Ошибка теста:", err.message));
} else if (process.argv.includes("--install-autostart")) {
  installAutostart();
} else {
  console.log(`Агент печати KitchenDesk запущен. Опрашиваю ${CONFIG.BACKEND_URL} каждые ${CONFIG.POLL_INTERVAL_MS / 1000} сек.`);
  printStartupConfirmation();
  setInterval(pollOnce, CONFIG.POLL_INTERVAL_MS);
  pollOnce();
}
