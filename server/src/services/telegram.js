// Минимальный клиент Bot API. Токен живёт только в памяти на время вызова
// и никогда не попадает в тексты ошибок или логи.
const config = require('../config');
const { HttpError } = require('../utils/http');

// Формат токена @BotFather: "<числовой id>:<35 символов>".
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/;

class TelegramError extends Error {
  constructor(method, code, description) {
    super(`Telegram ${method}: ${description || 'ошибка'}`);
    this.code = code;
    this.description = description;
  }
}

async function call(token, method, params = {}) {
  let res;
  try {
    res = await fetch(`${config.telegramApiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new TelegramError(method, 0, e.name === 'TimeoutError' ? 'Telegram не ответил за 10 секунд' : 'нет связи с Telegram');
  }
  const body = await res.json().catch(() => null);
  if (!body?.ok) throw new TelegramError(method, body?.error_code || res.status, body?.description);
  return body.result;
}

function assertTokenFormat(token) {
  if (!TOKEN_RE.test(String(token || '').trim())) {
    throw new HttpError(400, 'Это не похоже на токен от @BotFather — он выглядит как 123456789:AA…');
  }
  return String(token).trim();
}

module.exports = { call, assertTokenFormat, TelegramError };
