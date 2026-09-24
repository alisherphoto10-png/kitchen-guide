// node scripts/create-platform-admin.js <login> [name]
// Создаёт администратора платформы (или сбрасывает ему пароль, если уже есть)
// и печатает пароль один раз.
require('../src/config');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db/pool');
const users = require('../src/services/users');

(async () => {
  const login = users.cleanLogin(process.argv[2]);
  const name = process.argv[3] || 'Администратор';
  const password = users.generatePassword(12);
  const hash = await bcrypt.hash(password, 10);
  const { rows: [existing] } = await pool.query('SELECT id, is_platform_admin FROM users WHERE LOWER(login) = $1', [login]);
  if (existing && !existing.is_platform_admin) throw new Error('Логин занят сотрудником заведения');
  if (existing) {
    await pool.query('UPDATE users SET password_hash = $2, is_active = TRUE WHERE id = $1', [existing.id, hash]);
  } else {
    await pool.query(
      'INSERT INTO users (tenant_id, login, password_hash, name, role, is_platform_admin) VALUES (NULL, $1, $2, $3, \'owner\', TRUE)',
      [login, hash, name]
    );
  }
  console.log(`${existing ? 'Пароль сброшен' : 'Создан'}: ${login} / ${password}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
