// The portal's hash store, kept in the ERP database (table portal_kv), with the same calls the portal code uses.
// The hash "users" is not stored here: it is the ERP's own logins, shown in the portal's shape (and a login the
// HR upload creates becomes an ERP login), so there is one set of logins and passwords for everything.
const db = require('../db');
const map = require('./users-map');

const val = (v) => (v == null ? null : v);
async function hgetall(key) {
  if (key === 'users') return map.allUsers();
  const rows = await db.q('select field, value from portal_kv where key = $1', [key]);
  return Object.fromEntries(rows.map((r) => [r.field, r.value]));
}
async function hget(key, field) {
  if (key === 'users') return (await map.allUsers())[field] || null;
  const r = await db.one('select value from portal_kv where key = $1 and field = $2', [key, String(field)]);
  return r ? val(r.value) : null;
}
async function hset(key, field, value) {
  if (key === 'users') return map.saveUser(field, value);
  await db.q('insert into portal_kv (key, field, value) values ($1, $2, $3) on conflict (key, field) do update set value = excluded.value, updated_at = now()', [key, String(field), JSON.stringify(value)]);
}
async function hsetMany(key, entries) { for (const [f, v] of entries) await hset(key, f, v); }
async function hgetallMany(keys) { return Promise.all(keys.map(hgetall)); }
async function hdel(key, field) {
  if (key === 'users') return 0;
  return (await db.q('delete from portal_kv where key = $1 and field = $2 returning 1 as x', [key, String(field)])).length;
}
async function del(key) { if (key === 'users') return 0; return (await db.q('delete from portal_kv where key = $1 returning 1 as x', [key])).length ? 1 : 0; }
async function hlen(key) { if (key === 'users') return Object.keys(await map.allUsers()).length; return (await db.one('select count(*)::int as n from portal_kv where key = $1', [key])).n; }
module.exports = { configured: () => true, hgetall, hget, hset, hsetMany, hgetallMany, hdel, del, hlen };
