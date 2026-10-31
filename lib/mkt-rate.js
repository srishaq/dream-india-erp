// Cheap rate limits for the public links (website leads and visits, partner portal codes): one counter row per key and
// hour (or day) in mkt_rate, bumped with a single upsert. Keys never hold an IP address or a number as such, only a
// short hash of it. Old counters are swept now and then.
const crypto = require('crypto');
const db = require('./db');

const h = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex').slice(0, 20);
// The caller's address: Vercel puts the real one first in x-forwarded-for (and in x-real-ip).
function ipOf(req) {
  const hd = (req && req.headers) || {};
  return String(hd['x-real-ip'] || String(hd['x-forwarded-for'] || '').split(',')[0] || (req && req.socket && req.socket.remoteAddress) || '').trim() || 'unknown';
}
// Counts one more for `key` in this hour / day; true while the count is within `max`.
async function allow(kind, value, max, per = 'hour') {
  const win = per === 'day' ? 'day' : 'hour';
  const r = await db.one(`insert into mkt_rate (key, win, n) values ($1, date_trunc('${win}', now()), 1)
     on conflict (key, win) do update set n = mkt_rate.n + 1 returning n`, [`${kind}:${h(value)}`]);
  if (Math.random() < 0.01) db.q("delete from mkt_rate where win < now() - interval '2 days'").catch(() => {});
  return r.n <= max;
}

module.exports = { ipOf, allow, hash: h };
