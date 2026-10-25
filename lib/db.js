// Database access for the API. q/one run a single statement; tx runs a function inside
// BEGIN … COMMIT on the same connection (ROLLBACK on any error).
const pg = require('./pg');

const configured = () => !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);

const q = (text, params) => pg.exclusive(async (c) => (await c.query(text, params)).rows);
const one = async (text, params) => (await q(text, params))[0] || null;
const script = (text) => pg.exclusive((c) => c.script(text));

function tx(fn) {
  return pg.exclusive(async (c) => {
    await c.query('BEGIN');
    const api = {
      q: async (t, p) => (await c.query(t, p)).rows,
      one: async (t, p) => (await c.query(t, p)).rows[0] || null,
    };
    try {
      const out = await fn(api);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch {}
      throw e;
    }
  });
}

module.exports = { configured, q, one, tx, script, reset: pg.reset };
