// Шифрование секретов (токенов ботов) для хранения в БД: AES-256-GCM,
// формат "v1:<iv>:<tag>:<ciphertext>" в base64url.
const crypto = require('crypto');
const config = require('../config');

const key = Buffer.from(config.botTokenKey, 'hex');
if (key.length !== 32) throw new Error('BOT_TOKEN_KEY должен быть 32 байта в hex (64 символа)');

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map(x => (typeof x === 'string' ? x : x.toString('base64url'))).join(':');
}

function decrypt(box) {
  const [v, iv, tag, data] = String(box).split(':');
  if (v !== 'v1') throw new Error('Неизвестный формат секрета');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
