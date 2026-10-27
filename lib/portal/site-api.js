// Construction data: slab schedule and progress, DPRs, hindrances, materials, floor-wise works.
// GET returns everything the site pages need; POST writes one document. The role decides what
// may be written: "write" adds and updates entries, "admin" also deletes and changes planned dates.
const auth = require('./auth');
const kv = require('./kv');
const { body, noStore } = require('./http');
const seed = require('./site-seed.json');

const COLS = ['towers', 'progress', 'dpr', 'hindrances', 'materials', 'works'];
const ID = /^[A-Za-z0-9_.:@+-]{1,120}$/;
const MAX_BYTES = 250 * 1024;

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

async function ensureSeed() {
  if ((await kv.hlen('site:towers')) > 0) return;
  for (const [id, doc] of Object.entries(seed.towers)) await kv.hset('site:towers', id, doc);
  for (const [id, doc] of Object.entries(seed.progress || {})) if (!(await kv.hget('site:progress', id))) await kv.hset('site:progress', id, doc);
}

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, 'site');
  if (!u) return;
  const level = auth.siteLevel(u); // "admin" | "write" | null
  try {
    if (req.method === 'GET') {
      await ensureSeed();
      const [users, ...cols] = await kv.hgetallMany(['users', ...COLS.map((c) => 'site:' + c)]);
      const out = { me: auth.publicUser(u), people: {} };
      COLS.forEach((c, i) => (out[c] = cols[i]));
      for (const x of Object.values(users)) out.people[x.username] = x.name || x.username;
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
    if (!level) return res.status(403).json({ error: 'View only.' });

    const b = body(req);
    if (JSON.stringify(b).length > MAX_BYTES) return res.status(413).json({ error: 'That entry is too large.' });
    const { op, col } = b;
    let id = b.id;
    if (!COLS.includes(col)) return res.status(400).json({ error: 'Unknown section.' });
    if (op === 'add') id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!ID.test(String(id || ''))) return res.status(400).json({ error: 'Bad id.' });
    if ((col === 'towers' || op === 'delete') && level !== 'admin') {
      return res.status(403).json({ error: col === 'towers' ? 'Only the Site Head or Management can change planned dates.' : 'Only the Site Head or Management can delete entries.' });
    }
    const key = 'site:' + col;
    if (op === 'delete') { await kv.hdel(key, id); return res.status(200).json({ ok: true }); }

    const data = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : null;
    if (!data) return res.status(400).json({ error: 'Nothing to save.' });
    let doc;
    if (op === 'set' || op === 'add') doc = { ...data };
    else if (op === 'update') {
      const cur = await kv.hget(key, id);
      if (!cur) return res.status(404).json({ error: 'That entry no longer exists.' });
      doc = merge(cur, data);
    } else return res.status(400).json({ error: 'Unknown operation.' });

    // Stamp who changed it from the session, never from the browser.
    const now = new Date().toISOString();
    if (col === 'towers') { doc.revisedBy = u.username; doc.revisedAt = now; }
    else { doc.updatedBy = u.username; doc.updatedAt = now; }
    if (col === 'dpr') { doc.submittedBy = doc.submittedBy || u.username; doc.submittedAt = doc.submittedAt || now; }
    if (col === 'hindrances' && op === 'add') { doc.createdBy = u.username; doc.createdAt = now; }
    await kv.hset(key, id, doc);
    res.status(200).json({ ok: true, id, doc });
  } catch (e) {
    res.status(503).json({ error: 'The site database is not reachable. Try again in a moment.' });
  }
};
