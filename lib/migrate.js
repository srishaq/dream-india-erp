// Applies pending migrations in one transaction, under an advisory lock so two
// requests arriving together never run them twice. Also creates the session secret.
const crypto = require('crypto');
const pg = require('./pg');
const migrations = require('./migrations');

async function status() {
  return pg.exclusive(async (c) => {
    const t = await c.query("select to_regclass('public.schema_migrations') is not null as ok");
    if (!t.rows[0].ok) return { applied: [], pending: migrations.map((m) => m.id) };
    const done = (await c.query('select id from schema_migrations')).rows.map((r) => r.id);
    return { applied: done, pending: migrations.map((m) => m.id).filter((id) => !done.includes(id)) };
  });
}

async function migrate() {
  return pg.exclusive(async (c) => {
    await c.script('begin');
    try {
      await c.query('select pg_advisory_xact_lock(7316001)');
      await c.script('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
      const done = new Set((await c.query('select id from schema_migrations')).rows.map((r) => r.id));
      const ran = [];
      for (const m of migrations) {
        if (done.has(m.id)) continue;
        await c.script(m.sql);
        await c.query('insert into schema_migrations (id) values ($1)', [m.id]);
        ran.push(m.id);
      }
      await c.query("insert into settings (key, value) values ('session_secret', $1) on conflict (key) do nothing",
        [JSON.stringify(crypto.randomBytes(48).toString('base64url'))]);
      await c.script('commit');
      return ran;
    } catch (e) {
      try { await c.script('rollback'); } catch {}
      throw e;
    }
  });
}

module.exports = { migrate, status };
