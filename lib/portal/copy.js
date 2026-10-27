// Copy from the staff portal's database (Upstash Redis, connected to this project in Vercel → Storage) into the ERP:
// the logins (same usernames and passwords), HR & Admin, Purchase and Construction. Read only: the portal is never changed.
// GET  /api/portal?copy=1            → is the portal database connected, and what it holds
// POST /api/portal?copy=1 {go:true}  → copy now (Admin only). Running it again replaces the ERP copy with a fresh one.
const auth = require('./auth');
const kv = require('./kv');
const users = require('./users-map');
const db = require('../db');
const audit = require('../audit');
const { body, noStore } = require('./http');

// Vercel names the variables with the prefix chosen when the store was connected (KV_… by default).
function conn() {
  const env = process.env;
  const urlKey = Object.keys(env).find((k) => /(^|_)REST_API_URL$/.test(k) && env[k]) || (env.UPSTASH_REDIS_REST_URL && 'UPSTASH_REDIS_REST_URL');
  if (!urlKey) return null;
  const base = urlKey.replace(/REST_API_URL$|URL$/, '');
  const token = env[base + 'REST_API_READ_ONLY_TOKEN'] || env[base + 'REST_API_TOKEN'] || env.UPSTASH_REDIS_REST_TOKEN;
  return token ? { url: env[urlKey], token, readOnly: !!env[base + 'REST_API_READ_ONLY_TOKEN'] } : null;
}
async function redis(c, cmds) {
  const r = await fetch(`${c.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error(`The portal database answered ${r.status}.`);
  const out = await r.json();
  for (const o of out) if (o.error) throw new Error(`The portal database: ${o.error}`);
  return out.map((o) => o.result);
}
async function keys(c, match) {
  const all = new Set(); let cur = '0', n = 0;
  do { const [[next, ks]] = await redis(c, [['SCAN', cur, 'MATCH', match, 'COUNT', '1000']]); cur = next; ks.forEach((k) => all.add(k)); } while (cur !== '0' && ++n < 200);
  return [...all];
}
const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };
async function hash(c, key) {
  const [flat] = await redis(c, [['HGETALL', key]]); const o = {};
  for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = parse(flat[i + 1]);
  return o;
}
// The portal keeps its keys under a prefix (ds: unless KV_PREFIX was set there).
async function prefixOf(c) {
  for (const p of [process.env.PORTAL_KV_PREFIX, 'ds:', '']) { if (p == null) continue; const [n] = await redis(c, [['HLEN', p + 'users']]); if (n > 0) return p; }
  return null;
}
const SECTIONS = [['hr:', 'HR & Admin'], ['po:', 'Purchase'], ['site:', 'Construction']];

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, null); if (!u) return;
  const erp = await require('../auth').session(req);
  if (!erp || erp.role !== 'admin') return res.status(403).json({ error: 'Only the Admin can copy from the portal.' });
  const c = conn();
  if (!c) return res.status(200).json({ connected: false, hint: 'Connect the portal\'s database to dream-india-erp in Vercel → Storage, then publish the ERP again.' });
  try {
    const p = await prefixOf(c);
    if (p == null) return res.status(200).json({ connected: true, found: false, error: 'Connected, but the portal\'s logins were not found in this database.' });
    const list = {};
    for (const [pre] of SECTIONS) list[pre] = (await keys(c, p + pre + '*')).map((k) => k.slice(p.length));
    const portalUsers = await hash(c, p + 'users');
    const summary = { connected: true, readOnly: c.readOnly, prefix: p, users: Object.keys(portalUsers).length, sections: Object.fromEntries(SECTIONS.map(([pre, label]) => [label, list[pre].length])) };
    if (req.method === 'GET') return res.status(200).json(summary);
    if (!body(req).go) return res.status(400).json({ error: 'Send go: true to copy.' });
    // logins: same username, same password (the portal and the ERP use the same password scrambling)
    const done = { added: 0, updated: 0, skipped: [] };
    const before = new Set((await db.q('select username from users')).map((r) => r.username));
    for (const [name, rec] of Object.entries(portalUsers)) {
      const un = String(name).trim().toLowerCase();
      if (!/^[a-z0-9._@-]{3,60}$/.test(un)) { done.skipped.push(`${name} (username has characters the ERP does not allow)`); continue; }
      if (rec.legacy) continue;
      try { await users.saveUser(un, rec); before.has(un) ? done.updated++ : done.added++; } catch (e) { done.skipped.push(`${name} (${e.message})`); }
    }
    // HR, Purchase and Construction: the ERP copy is replaced by the portal's records
    const copied = {};
    for (const [pre, label] of SECTIONS) {
      let n = 0;
      await db.q("delete from portal_kv where key like $1", [pre + '%']);
      for (const k of list[pre]) { const h = await hash(c, p + k); for (const [f, v] of Object.entries(h)) { await kv.hset(k, f, v); n++; } }
      copied[label] = n;
    }
    await audit.record(db.q, { user: erp, action: 'portal-copy', entity: 'portal', after: { users: done, copied } });
    return res.status(200).json({ ...summary, ok: true, users: done, copied });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
