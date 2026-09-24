const { Pool, types } = require('pg');
const config = require('../config');

// NUMERIC приходит из pg строкой — для ТТК это всегда небольшие дроби
// (граммы, проценты), точности double хватает с запасом.
types.setTypeParser(types.builtins.NUMERIC, v => (v === null ? null : parseFloat(v)));

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
