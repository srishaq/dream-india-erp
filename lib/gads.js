// Google Ads into Marketing: every campaign with its spend, clicks and conversions, day by day for 40 days and month by
// month for 12 months, next to Meta Ads (campaigns of source 'google', ext_id 'gads:<id>').
// Needs, in Vercel:
//   GOOGLE_ADS_DEVELOPER_TOKEN  Google Ads → Tools → API Center (needs a manager account; Google approves it)
//   GOOGLE_ADS_CUSTOMER_ID      the ad account number, e.g. 123-456-7890
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  the manager account number, when the ad account sits under one (optional)
//   GOOGLE_ADS_API_VERSION      optional (default below)
// The sign-in reuses the ERP's Google sign-in (GOOGLE_OAUTH_CLIENT_ID / SECRET) with the Google Ads permission; the way
// back is /oauth/google with a state starting "ga." (api/custdocs.js sends it here).
const crypto = require('crypto');
const db = require('./db');

const err = (status, message) => Object.assign(new Error(message), { status });
const VER = () => process.env.GOOGLE_ADS_API_VERSION || 'v21';
const API = () => (process.env.GOOGLE_ADS_API || 'https://googleads.googleapis.com').replace(/\/+$/, '');
const TOKEN = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const cid = () => String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
const configured = () => !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && cid() && process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const key = () => crypto.createHash('sha256').update('erp-gads:' + (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '')).digest();
const seal = (t) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const x = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return [iv, c.getAuthTag(), x].map((b) => b.toString('base64url')).join('.'); };
const unseal = (s) => { const [iv, tag, x] = String(s).split('.').map((b) => Buffer.from(b, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(x), d.final()]).toString('utf8'); };
async function get() { return (await db.one("select value from settings where key = 'gads'"))?.value || {}; }
async function put(v) { await db.q("insert into settings (key, value) values ('gads', $1) on conflict (key) do update set value = excluded.value", [v]); }
const host = (req) => { const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]; return `${/^localhost|^127\./.test(req.headers.host || '') ? 'http' : proto}://${req.headers.host}`; };

async function authUrl(req, userId) {
  if (!configured()) throw err(409, 'Google Ads is not set up yet: GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID are missing in Vercel (Set-up shows how).');
  const state = 'ga.' + crypto.randomBytes(18).toString('base64url');
  const v = await get(); v.pending = { state, user: userId, exp: Date.now() + 15 * 60000 }; await put(v);
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: host(req) + '/oauth/google', response_type: 'code', scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent', state });
  return `${process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'}?${q}`;
}
async function callback(req, userId) {
  const q = req.query || {}, v = await get(), p = v.pending; delete v.pending;
  if (!p || p.state !== q.state || p.user !== userId || Date.now() > p.exp) { await put(v); throw err(400, 'The sign-in link has expired. Press "Connect Google Ads" again.'); }
  if (q.error) { await put(v); throw err(400, 'Google Ads was not connected: ' + String(q.error_description || q.error).slice(0, 200)); }
  const r = await fetch(TOKEN(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(q.code || ''), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri: host(req) + '/oauth/google', grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) { await put(v); throw err(502, `Google did not connect Google Ads (${j.error_description || j.error || r.status}).`); }
  v.refresh = seal(j.refresh_token); v.at = new Date().toISOString(); v.by = userId; v.error = null; v.backfilled = null;
  await put(v);
  return { ok: true };
}
async function access(v) {
  const r = await fetch(TOKEN(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: unseal(v.refresh), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw err(401, `Google Ads: ${j.error_description || j.error || r.status}. Connect Google Ads again.`);
  return j.access_token;
}
async function search(token, query) {
  const headers = { Authorization: 'Bearer ' + token, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json' };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
  const out = []; let pageToken = null, guard = 0;
  do {
    const r = await fetch(`${API()}/${VER()}/customers/${cid()}/googleAds:search`, { method: 'POST', headers, body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const d = j.error && j.error.details && j.error.details[0] && j.error.details[0].errors && j.error.details[0].errors[0]; throw err(502, `Google Ads: ${(d && d.message) || (j.error && j.error.message) || r.status}`); }
    out.push(...(j.results || [])); pageToken = j.nextPageToken || null;
  } while (pageToken && ++guard < 50);
  return out;
}
const ymd = (d) => d.toISOString().slice(0, 10);
async function sync({ full = false } = {}) {
  const v = await get(); if (!configured() || !v.refresh) return { skipped: 'Google Ads is not connected.' };
  const token = await access(v).catch(async (x) => { v.error = x.message; await put(v); throw x; });
  const t = new Date(Date.now() + 5.5 * 3600e3), today = ymd(t);
  const first = full || !v.backfilled, from = first ? ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 12, 1))) : ymd(new Date(t.getTime() - 40 * 864e5));
  const rows = await search(token, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, segments.date,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${today}'`);
  const projects = await db.q('select id, name, code from projects where active order by id');
  const sig = projects.find((p) => p.code === 'SIGNATURE') || projects[0] || null;
  const projectFor = (name) => { const s = String(name || '').toLowerCase(); const hit = projects.find((p) => s.includes(String(p.name).toLowerCase().replace(/^dream\s+/, ''))); return (hit || sig || {}).id || null; };
  const byCamp = {}; for (const r of rows) (byCamp[r.campaign.id] = byCamp[r.campaign.id] || []).push(r);
  const d40 = ymd(new Date(t.getTime() - 40 * 864e5));
  for (const [id, list] of Object.entries(byCamp)) {
    const c = list[0].campaign;
    const row = await db.one(`insert into mkt_campaigns (project_id, name, channel, start_on, end_on, status, ext_id, source, objective, ext_status, account, synced_at)
        values ($1, $2, 'google_ads', $3, $4, $5, $6, 'google', $7, $8, 'Google Ads', now())
      on conflict (ext_id) where ext_id is not null do update set name = excluded.name, start_on = excluded.start_on, end_on = excluded.end_on, status = excluded.status, objective = excluded.objective, ext_status = excluded.ext_status, synced_at = now(), updated_at = now() returning id`,
    [projectFor(c.name), c.name, c.startDate || null, c.endDate && c.endDate < '2037' ? c.endDate : null, c.status === 'ENABLED' ? 'active' : 'done', 'gads:' + id, c.advertisingChannelType || null, c.status === 'ENABLED' ? 'ACTIVE' : c.status]);
    const months = {};
    for (const r of list) {
      const day = r.segments.date, m = r.metrics || {}, spend = Number(m.costMicros || 0) / 1e6, imp = Number(m.impressions || 0), clk = Number(m.clicks || 0), conv = Math.round(Number(m.conversions || 0));
      const mo = day.slice(0, 7) + '-01'; const x = (months[mo] = months[mo] || { spend: 0, imp: 0, clk: 0, conv: 0 }); x.spend += spend; x.imp += imp; x.clk += clk; x.conv += conv;
      if (day >= d40) await db.q(`insert into mkt_campaign_days (campaign_id, day, spend, impressions, clicks, leads, messages) values ($1, $2, $3, $4, $5, $6, 0)
          on conflict (campaign_id, day) do update set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, leads = excluded.leads`, [row.id, day, spend, imp, clk, conv]);
    }
    for (const [mo, x] of Object.entries(months)) {
      // a month only partly pulled (the 40-day pull) is topped up from the days we have
      const whole = first || mo > from.slice(0, 7) + '-01' || from.slice(8) === '01';
      if (!whole) continue;
      await db.q(`insert into mkt_campaign_months (campaign_id, month, spend, impressions, clicks, leads) values ($1, $2, $3, $4, $5, $6)
          on conflict (campaign_id, month) do update set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, leads = excluded.leads`, [row.id, mo, x.spend, x.imp, x.clk, x.conv]);
    }
    await db.q(`update mkt_campaigns c set spent = s.spend, impressions = s.imp, clicks = s.clk, ad_leads = s.leads from (select sum(spend) as spend, sum(impressions) as imp, sum(clicks) as clk, sum(leads) as leads from mkt_campaign_months where campaign_id = $1) s where c.id = $1`, [row.id]);
  }
  if (first) v.backfilled = today; v.error = null; v.last = new Date().toISOString(); await put(v);
  return { campaigns: Object.keys(byCamp).length, rows: rows.length };
}
async function status() { const v = await get(); return { configured: configured(), connected: !!v.refresh, at: v.at || null, last: v.last || null, error: v.error || null }; }
async function disconnect() { const v = await get(); delete v.refresh; v.backfilled = null; await put(v); }

module.exports = { configured, authUrl, callback, sync, status, disconnect };
