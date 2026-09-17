const fs = require("fs");
const path = require("path");
const store = require("./oko-inventory-store");

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "oko-inventory-telegram-config.json");

// Тот же приём, что и в oko-waiter-guide-api.js — угаданное название позиции
// уже пришло из каталога (админ вводил вручную), но экранируем на всякий
// случай: спецсимволы Markdown там теоретически возможны.
function escapeMd(value) {
  return String(value).replace(/([_*`[])/g, "\\$1");
}
const DIVIDER = "━━━━━━━━━━━━━━";

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { chatId: null, threadId: null };
  }
}

function writeConfig({ chatId, threadId }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ chatId: chatId || null, threadId: threadId || null }, null, 2), "utf8");
}

// Ключевые слова определяют тип движения по подписи — тема по умолчанию про
// списания (так сказал владелец), поэтому "приход" ищем явно, а не наоборот.
// Подстроки специально без границ слова — так одно "куп" ловит и "купили",
// и "куплено", и "закупили" разом, не думая про русские окончания.
const ARRIVAL_KEYWORDS = ["пришл", "принес", "принёс", "куп", "закуп", "приход", "доставил", "получил", "получили"];
const WRITEOFF_KEYWORDS = ["разби", "слома", "потеря", "потерял", "спис", "минус", "пропал", "порва", "утеря", "выброс", "испорт"];

function parseMessage(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();

  const numMatch = lower.match(/\d+([.,]\d+)?/);
  const qty = numMatch ? parseFloat(numMatch[0].replace(",", ".")) : null;

  const direction = ARRIVAL_KEYWORDS.some((k) => lower.includes(k)) ? "приход" : "списание";

  // Угадываем название позиции: вычищаем из подписи число и все ключевые
  // слова направления — то, что осталось, обычно и есть название вещи
  // ("тарелка", "разбили 2 тарелки" -> "тарелки" после чистки).
  let nameGuess = raw;
  if (numMatch) nameGuess = nameGuess.replace(numMatch[0], " ");
  nameGuess = nameGuess.replace(/[-–—+]/g, " ").replace(/\bшт\.?\b/gi, " ");
  [...ARRIVAL_KEYWORDS, ...WRITEOFF_KEYWORDS].forEach((k) => {
    nameGuess = nameGuess.replace(new RegExp(k, "gi"), " ");
  });
  // Огрызки слов после вырезания ключевого корня (например, "пришл" вырезано
  // из "пришла" — остаётся висячая "а") только мешают: matchCandidates() их
  // и так игнорирует (слова короче 3 букв), а тут это ещё и подпись для
  // формы "создать новую позицию" — чистим для красоты, не только для матчинга.
  nameGuess = nameGuess
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .join(" ")
    .trim();

  return { qty, direction, nameGuess };
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Сравниваем не фразу целиком, а слово-к-слову: подпись повара почти никогда
// не совпадает дословно с названием в каталоге (падеж, порядок слов, лишние
// слова вроде "повар уронил") — отдельные существительные обычно ближе.
function bestWordDistance(queryWords, nameWords) {
  let best = Infinity;
  queryWords.forEach((qw) => {
    nameWords.forEach((nw) => {
      const dist = levenshtein(qw, nw) / Math.max(qw.length, nw.length, 1);
      if (dist < best) best = dist;
    });
  });
  return best;
}

// Топ-N похожих позиций с процентом уверенности (100% = точное вхождение,
// дальше по относительному расстоянию Левенштейна между словами) — то, что
// админка показывает как "Найдено N похожих позиций" при разборе черновика.
// Порог мягче, чем у matchItem() ниже: тут не "верю/не верю", а просто
// ранжируем варианты, финальный выбор всё равно за человеком.
function matchCandidates(nameGuess, items, limit) {
  const q = (nameGuess || "").toLowerCase().trim();
  if (!q || !items.length) return [];
  const qWords = q.split(/\s+/).filter((w) => w.length > 2);
  if (!qWords.length) return [];

  const scored = items
    .map((it) => {
      const name = it.name.toLowerCase();
      let score;
      if (q.includes(name) || name.includes(q)) {
        score = 0;
      } else {
        const nameWords = name.split(/\s+/).filter((w) => w.length > 2);
        score = nameWords.length ? bestWordDistance(qWords, nameWords) : 1;
      }
      return { item: it, score };
    })
    .filter((s) => s.score <= 0.6)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit || 3);

  return scored.map((s) => ({ item: s.item, confidence: Math.round((1 - s.score) * 100) }));
}

// Единственный "угаданный" вариант для авто-подстановки и текста ответа в
// Telegram — строже matchCandidates (60%+), чтобы не подставлять в подписи
// боту то, в чём он сам не уверен.
function matchItem(nameGuess, items) {
  const candidates = matchCandidates(nameGuess, items, 1);
  return candidates.length && candidates[0].confidence >= 60 ? candidates[0].item : null;
}

/**
 * Повар кидает фото + короткую подпись в настроенную тему списаний — бот НЕ
 * применяет движение сразу (свободный текст ненадёжен для реальных цифр
 * склада), а готовит черновик: угадывает позицию по каталогу и количество
 * из подписи, скачивает и сохраняет фото. Подтверждение — один клик в
 * админке (POST /drafts/:id/confirm), она же даёт поправить угаданное
 * перед тем, как черновик станет настоящим движением.
 *
 * Реагирует только на фото — без фото в этой теме может быть что угодно
 * (обычный чат), а не сигнал для склада.
 */
function registerInventoryDraftListener(bot) {
  bot.on("photo", async (msg) => {
    try {
      const config = readConfig();
      if (!config.chatId) return;
      if (String(msg.chat.id) !== String(config.chatId)) return;
      if (config.threadId && String(msg.message_thread_id || "") !== String(config.threadId)) return;

      const caption = msg.caption || "";
      const parsed = parseMessage(caption);
      const items = store.readItems().filter((it) => !it.archived);
      const candidates = matchCandidates(parsed.nameGuess, items, 3);
      const guess = candidates.length && candidates[0].confidence >= 60 ? candidates[0].item : null;

      const sizes = msg.photo || [];
      const largest = sizes[sizes.length - 1];
      let photoFilename = null;
      if (largest) {
        try {
          const fileUrl = await bot.getFileLink(largest.file_id);
          const resp = await fetch(fileUrl);
          const buffer = Buffer.from(await resp.arrayBuffer());
          const extGuess = (fileUrl.split(".").pop() || "jpg").split("?")[0].toLowerCase();
          const ext = ["jpg", "jpeg", "png", "webp"].includes(extGuess) ? extGuess : "jpg";
          photoFilename = store.savePhotoBuffer(buffer, ext);
        } catch (e) {
          console.error("[oko-inventory] telegram photo download failed:", e.message);
        }
      }

      const fromName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || "Повар";

      store.addDraft({
        chatId: msg.chat.id,
        threadId: msg.message_thread_id || null,
        messageId: msg.message_id,
        fromName,
        rawText: caption,
        photo: photoFilename,
        direction: parsed.direction,
        qty: parsed.qty,
        guessedItemId: guess ? guess.id : null,
        guessedItemName: guess ? guess.name : null,
        candidates: candidates.map((c) => ({ itemId: c.item.id, name: c.item.name, confidence: c.confidence })),
        nameGuess: parsed.nameGuess,
      });

      const topCandidate = candidates[0];
      const lines = ["📝 *Принято в обработку*", DIVIDER];
      lines.push(
        guess
          ? `Похоже на: *${escapeMd(guess.name)}*${topCandidate ? ` (${topCandidate.confidence}%)` : ""}`
          : "Позицию не нашёл — выберу вручную.",
      );
      lines.push(parsed.qty ? `Количество: *${parsed.qty}*` : "Количество не распознано — впишу вручную.");
      lines.push(`Тип: *${parsed.direction}*`);
      lines.push("");
      lines.push("Подтвердите в админке инвентаризации.");

      bot
        .sendMessage(msg.chat.id, lines.join("\n"), {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
          message_thread_id: msg.message_thread_id,
        })
        .catch(() => {});
    } catch (e) {
      console.error("[oko-inventory] telegram draft failed:", e.message);
    }
  });
}

module.exports = {
  readConfig,
  writeConfig,
  parseMessage,
  matchItem,
  matchCandidates,
  registerInventoryDraftListener,
};
