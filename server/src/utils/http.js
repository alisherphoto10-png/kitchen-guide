// Ошибка с HTTP-статусом: сервисы бросают её, роуты не ловят вручную —
// общий обработчик в index.js превращает её в JSON { error }.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Оборачивает async-хендлер, чтобы исключения попадали в next(err).
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// "0,140" / "0.14" / 0.14 / "" → число или null. Мусор → HttpError 400.
function toNum(v, field) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(n)) throw new HttpError(400, `Поле «${field}»: ожидается число`);
  return n;
}

function toId(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Не найдено');
  return n;
}

module.exports = { HttpError, ah, toNum, toId };
