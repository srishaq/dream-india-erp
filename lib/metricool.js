// Metricool: the social media figures (Instagram, Facebook, YouTube, LinkedIn …) for the Marketing page, pulled every
// night into mkt_stats. Metricool connects to the networks; the ERP only reads from Metricool.
// Env: METRICOOL_TOKEN (Metricool → Account settings → API; the API is on Metricool's Advanced plan),
//      METRICOOL_USER_ID and METRICOOL_BLOG_ID (in the browser address when a brand is open in Metricool:
//      …?blogId=…&userId=…). For tests: METRICOOL_API.
const db = require('./db');

const API = () => (process.env.METRICOOL_API || 'https://app.metricool.com/api').replace(/\/+$/, '');
const USER = () => process.env.METRICOOL_USER_ID || '5503038';  // Dream India Group's Metricool account
const BLOG = () => process.env.METRICOOL_BLOG_ID || '7118271';  // brand "Dream India Group"
const configured = () => !!process.env.METRICOOL_TOKEN;

// Our names for each network's figures, and Metricool's metric for each.
const METRICS = {
  instagram: { followers: 'followers', views: 'views', reach: 'reach', posts: 'postsCount', interactions: 'postsInteractions', gained: 'followersGained' },
  facebook: { followers: 'fbFollowers', views: 'pageMediaView', reach: 'pageViews', posts: 'postsCount', interactions: 'postsInteractions', gained: 'followersAcquired' },
  youtube: { followers: 'subscribers', views: 'videoViews', posts: 'videos', gained: 'gained' },
  linkedin: { followers: 'followers', views: 'impressions', posts: 'posts', interactions: 'engagement' },
};
const LAST = ['followers']; // the rest are daily counts

async function call(path, params = {}) {
  const q = new URLSearchParams({ userId: USER(), blogId: BLOG(), ...params });
  const r = await fetch(`${API()}${path}?${q}`, { headers: { 'X-Mc-Auth': process.env.METRICOOL_TOKEN, Accept: 'application/json' } });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw Object.assign(new Error(`Metricool ${r.status}: ${(j && (j.message || j.error)) || text.slice(0, 160) || 'no answer'}`), { status: r.status });
  return j;
}

// Any shape of timeline Metricool sends back → [[YYYY-MM-DD, value], …]
function points(j) {
  const out = [];
  const day = (v) => { const s = String(v); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const n = +v; if (n > 1e11) return new Date(n).toISOString().slice(0, 10); if (n > 1e9) return new Date(n * 1000).toISOString().slice(0, 10); return null; };
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) {
      if (x.length === 2 && (typeof x[0] === 'string' || typeof x[0] === 'number') && !Array.isArray(x[1]) && typeof x[1] !== 'object') { const d = day(x[0]); if (d && x[1] != null && !isNaN(+x[1])) out.push([d, +x[1]]); return; }
      x.forEach(walk); return;
    }
    if (typeof x === 'object') {
      const d = x.dateTime || x.date || x.day || x.timestamp;
      if (d != null && x.value != null && !isNaN(+x.value)) { const dd = day(d); if (dd) out.push([dd, +x.value]); return; }
      Object.values(x).forEach(walk);
    }
  };
  walk(j);
  return out;
}

// Which networks the brand has connected (the brand list says, e.g. instagramData: "dreamindiarealty").
async function connected() {
  const j = await call('/admin/simpleProfiles');
  const list = Array.isArray(j) ? j : (j && j.data) || [];
  const b = list.find((x) => String(x.id) === String(BLOG())) || list[0] || {};
  const nets = {};
  for (const n of Object.keys(METRICS)) { const v = b[n] || b[n + 'Data'] || (b.networksData && (b.networksData[n] || b.networksData[n + 'Data'])); if (v) nets[n] = typeof v === 'string' ? v : v.username || v.name || true; }
  return { brand: b.label || b.title || 'Metricool brand', networks: nets };
}

// Pull the last `days` days of every figure of every connected network into mkt_stats.
async function sync({ days = 35 } = {}) {
  if (!configured()) return { skipped: 'Metricool is not connected: add METRICOOL_TOKEN in Vercel.' };
  const to = new Date(Date.now() + 5.5 * 3600e3), from = new Date(to.getTime() - days * 864e5);
  const f = (d, end) => d.toISOString().slice(0, 10) + (end ? 'T23:59:59' : 'T00:00:00');
  let nets;
  try { nets = (await connected()).networks; } catch (e) { nets = { instagram: true }; }
  const out = { networks: Object.keys(nets), rows: 0, errors: [] };
  for (const n of Object.keys(nets)) {
    const byDay = {};
    for (const [ours, theirs] of Object.entries(METRICS[n])) {
      try {
        const j = await call('/v2/analytics/timelines', { from: f(from), to: f(to, true), timezone: 'Asia/Kolkata', metric: theirs, network: n, subject: 'account' });
        for (const [d, v] of points(j)) (byDay[d] = byDay[d] || {})[ours] = v;
      } catch (e) { out.errors.push(`${n} ${ours}: ${e.message}`); if (e.status === 401 || e.status === 403) return { ...out, error: e.message }; }
    }
    for (const [d, m] of Object.entries(byDay)) {
      await db.q(`insert into mkt_stats (network, day, metrics, source) values ($1, $2, $3, 'metricool')
        on conflict (network, day) do update set metrics = mkt_stats.metrics || excluded.metrics, source = 'metricool', updated_at = now()`, [n, d, m]);
      out.rows++;
    }
  }
  await db.q("insert into job_marks (key, info) values ('metricool-sync', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [out]);
  return out;
}

module.exports = { configured, sync, connected, points, METRICS, LAST };
