// Social media connected to the ERP directly: Instagram, Facebook pages, Meta Ads (campaigns, spend, leads) and Meta
// lead forms through one "Connect with Facebook", and YouTube through one "Connect YouTube" (Google).
// Every night (and on "Pull now") the ERP reads:
//   Facebook pages  → followers, views, reach, interactions, new follows (day by day), every post with its figures
//   Instagram       → followers, views, reach, interactions (day by day and month by month), every post/reel with figures
//   Meta Ads        → every campaign of every ad account, month by month: spend, impressions, reach, clicks, leads,
//                     WhatsApp/Messenger conversations, video views
//   Meta lead forms → each lead (name, phone, email, answers) into Leads, tagged to its campaign (Meta keeps 90 days)
//   YouTube         → subscribers, views, watch time, likes/comments/shares (by day and month), every video with figures
// The first pull after connecting goes back 12 months.
// Env: META_APP_ID, META_APP_SECRET (a Meta app at developers.facebook.com; redirect URI https://<erp host>/oauth/meta),
//      optional META_CONFIG_ID (Facebook Login for Business configuration). YouTube uses the Google sign-in the ERP already
//      has (GOOGLE_OAUTH_CLIENT_ID / _SECRET, redirect /oauth/google) with the YouTube Data and YouTube Analytics APIs on.
// Tests: META_GRAPH, META_DIALOG, YT_API, YTA_API, GOOGLE_OAUTH_TOKEN_URL, GOOGLE_OAUTH_AUTH_URL.
// Tokens are kept sealed (AES-GCM) in the settings table; the key comes from the app secrets in Vercel.
const crypto = require('crypto');
const db = require('./db');

const GRAPH = () => (process.env.META_GRAPH || 'https://graph.facebook.com/v23.0').replace(/\/+$/, '');
const DIALOG = () => process.env.META_DIALOG || 'https://www.facebook.com/v23.0/dialog/oauth';
const YT = () => (process.env.YT_API || 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
const YTA = () => (process.env.YTA_API || 'https://youtubeanalytics.googleapis.com/v2').replace(/\/+$/, '');
const G_TOKEN = () => process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const G_AUTH = () => process.env.GOOGLE_OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const META_SCOPES = 'pages_show_list,pages_read_engagement,read_insights,instagram_basic,instagram_manage_insights,ads_read,leads_retrieval,pages_manage_ads,business_management';
const YT_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
const metaOn = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
const googleOn = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const err = (status, message) => Object.assign(new Error(message), { status });

// ---------- sealed tokens ----------
const keyFor = (net) => crypto.createHash('sha256').update(net === 'meta' ? 'erp-social-meta:' + (process.env.META_APP_SECRET || '') : 'erp-social-yt:' + (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '')).digest();
function seal(net, text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyFor(net), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function unseal(net, sealed) {
  const [iv, tag, enc] = String(sealed || '').split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(net), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
async function conn() { return (await db.one("select value from settings where key = 'social'"))?.value || {}; }
async function saveConn(v) { await db.q("insert into settings (key, value) values ('social', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(v)]); }

// ---------- dates (India) ----------
const ist = () => new Date(Date.now() + 5.5 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const monthOf = (s) => String(s).slice(0, 7) + '-01';
function lastMonths(n) { const t = ist(), out = []; for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1)))); return out; }
const nextMonth = (m) => { const d = new Date(m + 'T00:00:00Z'); return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))); };
const n0 = (v) => (v == null || v === '' || isNaN(+v) ? 0 : +v);

async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- signing in ----------
function host(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${/^localhost|^127\./.test(req.headers.host || '') ? 'http' : proto}://${req.headers.host}`;
}
const metaRedirect = (req) => host(req) + '/oauth/meta';
async function newState(net, userId) {
  const state = (net === 'youtube' ? 'yt.' : 'fb.') + crypto.randomBytes(18).toString('base64url');
  await db.q("insert into settings (key, value) values ('social_state', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ state, net, user: userId, exp: Date.now() + 15 * 60000 })]);
  return state;
}
async function takeState(q, net, userId) {
  const st = (await db.one("select value from settings where key = 'social_state'"))?.value;
  await db.q("delete from settings where key = 'social_state'");
  if (!st || st.state !== q.state || st.net !== net || st.user !== userId || Date.now() > st.exp) throw err(400, 'The sign-in link has expired. Press Connect again.');
  if (q.error) throw err(400, q.error === 'access_denied' ? 'Not connected: permission was not given.' : String(q.error_description || q.error).slice(0, 200));
}

async function metaAuthUrl(req, userId) {
  if (!metaOn()) throw err(409, 'Add META_APP_ID and META_APP_SECRET in Vercel first (Set-up shows how).');
  const q = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: metaRedirect(req), state: await newState('meta', userId), response_type: 'code' });
  if (process.env.META_CONFIG_ID) q.set('config_id', process.env.META_CONFIG_ID); else q.set('scope', META_SCOPES);
  return `${DIALOG()}?${q}`;
}
async function ytAuthUrl(req, userId) {
  if (!googleOn()) throw err(409, 'Google sign-in is not set up: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are missing in Vercel.');
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: host(req) + '/oauth/google', response_type: 'code', scope: YT_SCOPES, access_type: 'offline', prompt: 'consent', state: await newState('youtube', userId) });
  return `${G_AUTH()}?${q}`;
}

// ---------- Meta Graph API ----------
const proof = (token) => crypto.createHmac('sha256', process.env.META_APP_SECRET || '').update(token).digest('hex');
async function graph(path, params = {}, token) {
  const u = new URL(/^https?:/.test(path) ? path : GRAPH() + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (token) { u.searchParams.set('access_token', token); u.searchParams.set('appsecret_proof', proof(token)); }
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = err(r.status >= 400 ? r.status : 502, `Facebook: ${(j.error && j.error.message) || r.status}`); e.code190 = j.error && (j.error.code === 190 || j.error.type === 'OAuthException' && /expired|session/i.test(j.error.message || '')); throw e; }
  return j;
}
async function graphAll(path, params, token, cap = 1000) {
  let j = await graph(path, params, token); const out = [...(j.data || [])];
  while (j.paging && j.paging.next && out.length < cap) { j = await graph(j.paging.next, {}, null); out.push(...(j.data || [])); }
  return out.slice(0, cap);
}

// The last failed connection, kept so Set-up can show it (the message on the way back is easy to miss).
async function noteFail(net, userId, e) {
  const c = await conn(); c.lastError = { ...(c.lastError || {}), [net]: { at: new Date().toISOString(), by: userId, message: String(e.message || e).slice(0, 300) } }; await saveConn(c);
}
async function metaCallback(req, userId) {
  try { return await metaCallbackInner(req, userId); } catch (e) { await noteFail('meta', userId, e).catch(() => {}); throw e; }
}
async function metaCallbackInner(req, userId) {
  const q = req.query || {};
  await takeState(q, 'meta', userId);
  const base = { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET };
  const short = await graph('/oauth/access_token', { ...base, redirect_uri: metaRedirect(req), code: String(q.code || '') });
  const long = await graph('/oauth/access_token', { ...base, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token });
  const token = long.access_token || short.access_token;
  const me = await graph('/me', { fields: 'id,name' }, token);
  // Without the Instagram permissions Facebook refuses the whole page list when it is asked for the linked Instagram
  // account, so ask for the pages alone if needed and look for each page's Instagram on its own.
  let pages;
  try { pages = await graphAll('/me/accounts', { fields: 'id,name,link,access_token,instagram_business_account{id,username,name}', limit: 100 }, token, 50); }
  catch (e) {
    pages = await graphAll('/me/accounts', { fields: 'id,name,link,access_token', limit: 100 }, token, 50);
    for (const p of pages) {
      try { const x = await graph(`/${p.id}`, { fields: 'instagram_business_account{id,username,name}' }, p.access_token); if (x.instagram_business_account) p.instagram_business_account = x.instagram_business_account; } catch { /* no Instagram permission yet */ }
    }
  }
  const ads = await graphAll('/me/adaccounts', { fields: 'id,name,currency,account_status', limit: 100 }, token, 50).catch(() => []);
  if (!pages.length && !ads.length) throw err(400, 'Facebook did not share any page or ad account. Connect again and tick the Dream India page, its Instagram and the ad account.');
  const c = await conn();
  c.meta = {
    token: seal('meta', token), exp: Date.now() + (long.expires_in || 60 * 86400) * 1000, at: new Date().toISOString(), by: userId, name: me.name,
    pages: pages.map((p) => ({ id: p.id, name: p.name, link: p.link || `https://www.facebook.com/${p.id}`, token: seal('meta', p.access_token), ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username, name: p.instagram_business_account.name } : null })),
    ads: ads.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status })), backfilled: null, error: null,
  };
  if (c.lastError) delete c.lastError.meta;
  await saveConn(c);
  await addChannels(c);
  return { pages: c.meta.pages.length, instagram: c.meta.pages.filter((p) => p.ig).length, ads: c.meta.ads.length };
}

// ---------- YouTube ----------
let ytCache = null;
async function ytToken(c) {
  if (ytCache && Date.now() < ytCache.exp - 60000) return ytCache.token;
  const r = await fetch(G_TOKEN(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: unseal('youtube', c.youtube.refresh), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(err(401, `YouTube: ${j.error_description || j.error || r.status}. Connect YouTube again.`), { code190: true });
  ytCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return ytCache.token;
}
async function yt(base, path, params, token) {
  const u = new URL(base + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status, `YouTube: ${(j.error && (j.error.message || j.error)) || r.status}`);
  return j;
}
async function ytCallback(req, userId) {
  try { return await ytCallbackInner(req, userId); } catch (e) { await noteFail('youtube', userId, e).catch(() => {}); throw e; }
}
async function ytCallbackInner(req, userId) {
  const q = req.query || {};
  await takeState(q, 'youtube', userId);
  const r = await fetch(G_TOKEN(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(q.code || ''), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri: host(req) + '/oauth/google', grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw err(502, `Google did not connect YouTube (${j.error_description || j.error || r.status}). Try again.`);
  ytCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  const ch = await yt(YT(), '/channels', { part: 'snippet,statistics,contentDetails', mine: 'true' }, j.access_token);
  const it = (ch.items || [])[0];
  if (!it) throw err(400, 'That Google account has no YouTube channel. Connect with the account that owns the Dream India channel (or choose the channel when Google asks).');
  const c = await conn();
  c.youtube = { refresh: seal('youtube', j.refresh_token), at: new Date().toISOString(), by: userId, channelId: it.id, title: it.snippet.title, handle: (it.snippet.customUrl || '').replace(/^@/, ''), uploads: it.contentDetails && it.contentDetails.relatedPlaylists && it.contentDetails.relatedPlaylists.uploads, backfilled: null, error: null };
  if (c.lastError) delete c.lastError.youtube;
  await saveConn(c);
  await addChannels(c);
  return { channel: it.snippet.title };
}

// The connected accounts appear on the Marketing page as channels (company-wide).
async function addChannels(c) {
  const mk = require('../api/marketing');
  const set = await mk.settings();
  const want = [];
  for (const p of (c.meta && c.meta.pages) || []) {
    want.push({ network: 'facebook', handle: p.name, url: p.link, projectId: null });
    if (p.ig) want.push({ network: 'instagram', handle: p.ig.username, url: `https://www.instagram.com/${p.ig.username}/`, projectId: null });
  }
  if (c.youtube) want.push({ network: 'youtube', handle: c.youtube.handle || c.youtube.title, url: c.youtube.handle ? `https://www.youtube.com/@${c.youtube.handle}` : `https://www.youtube.com/channel/${c.youtube.channelId}`, projectId: null });
  for (const w of want) {
    const same = set.channels.find((x) => x.network === w.network && String(x.handle || '').toLowerCase().replace(/^@/, '') === String(w.handle || '').toLowerCase().replace(/^@/, ''));
    if (same) { if (!same.url) same.url = w.url; } else { const i = set.channels.findIndex((x) => x.network === w.network && !x.url); if (i >= 0) set.channels[i] = w; else set.channels.push(w); }
  }
  await db.q("insert into settings (key, value) values ('marketing', $1) on conflict (key) do update set value = excluded.value", [set]);
}

async function disconnect(net) {
  const c = await conn();
  if (net === 'meta') delete c.meta;
  if (net === 'youtube') { if (c.youtube) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal('youtube', c.youtube.refresh))}`, { method: 'POST' }); } catch { /* best effort */ } } delete c.youtube; ytCache = null; }
  await saveConn(c);
}

async function status() {
  const c = await conn();
  const last = await db.one("select done_at, info from job_marks where key = 'social-sync'");
  return {
    meta: { configured: metaOn(), connected: !!(c.meta && c.meta.token), name: c.meta && c.meta.name, at: c.meta && c.meta.at, expires: c.meta && c.meta.exp ? new Date(c.meta.exp).toISOString() : null,
      pages: ((c.meta && c.meta.pages) || []).map((p) => ({ id: p.id, name: p.name, instagram: p.ig && p.ig.username })), ads: (c.meta && c.meta.ads) || [], error: c.meta && c.meta.error, lastFail: (c.lastError || {}).meta || null },
    youtube: { configured: googleOn(), connected: !!(c.youtube && c.youtube.refresh), title: c.youtube && c.youtube.title, handle: c.youtube && c.youtube.handle, at: c.youtube && c.youtube.at, error: c.youtube && c.youtube.error, lastFail: (c.lastError || {}).youtube || null },
    lastSync: last ? { at: last.done_at, ...last.info } : null,
  };
}

// ---------- saving ----------
async function putDays(network, byDay) {
  let n = 0;
  for (const [d, m] of Object.entries(byDay)) {
    if (!Object.keys(m).length) continue;
    await db.q(`insert into mkt_stats (network, day, metrics, source) values ($1, $2, $3, 'direct')
      on conflict (network, day) do update set metrics = mkt_stats.metrics || excluded.metrics, source = 'direct', updated_at = now()`, [network, d, m]);
    n++;
  }
  return n;
}
async function putMonths(network, byMonth) {
  for (const [m, v] of Object.entries(byMonth)) {
    if (!Object.keys(v).length) continue;
    await db.q(`insert into mkt_stats_month (network, month, metrics) values ($1, $2, $3)
      on conflict (network, month) do update set metrics = mkt_stats_month.metrics || excluded.metrics, updated_at = now()`, [network, m, v]);
  }
}
async function putMedia(network, account, rows) {
  for (const x of rows) {
    await db.q(`insert into mkt_media (network, ext_id, account, posted_at, kind, caption, permalink, thumb, likes, comments, shares, saves, views, reach)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (network, ext_id) do update set posted_at = excluded.posted_at, kind = excluded.kind, caption = excluded.caption, permalink = excluded.permalink,
        thumb = coalesce(excluded.thumb, mkt_media.thumb), likes = excluded.likes, comments = excluded.comments, shares = coalesce(excluded.shares, mkt_media.shares),
        saves = coalesce(excluded.saves, mkt_media.saves), views = coalesce(excluded.views, mkt_media.views), reach = coalesce(excluded.reach, mkt_media.reach), updated_at = now()`,
    [network, String(x.id), account, x.at || null, x.kind || null, x.caption ? String(x.caption).slice(0, 2000) : null, x.link || null, x.thumb || null, x.likes ?? null, x.comments ?? null, x.shares ?? null, x.saves ?? null, x.views ?? null, x.reach ?? null]);
  }
}
const bump = (o, k, f, v) => { (o[k] = o[k] || {})[f] = n0(o[k][f]) + n0(v); };

// ---------- Facebook pages ----------
const FB_METRICS = [['views', ['page_media_view', 'page_impressions']], ['reach', ['page_impressions_unique']], ['interactions', ['page_post_engagements']], ['gained', ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds']], ['followers', ['page_follows', 'page_fans']]];
async function syncFacebook(pages, from, out) {
  const days = {}, months = {}, fbF = {}, today = ymd(ist());
  for (const p of pages) {
    const tok = unseal('meta', p.token);
    const prof = await graph(`/${p.id}`, { fields: 'followers_count,fan_count' }, tok).catch(() => ({}));
    const followersSeries = {};
    for (const [ours, names] of FB_METRICS) {
      let got = false;
      for (const name of names) {
        try {
          for (let s = from; s < today; s = addDays(s, 90)) {
            const until = addDays(s, 90) < today ? addDays(s, 90) : addDays(today, 1);
            const j = await graph(`/${p.id}/insights`, { metric: name, period: 'day', since: s, until }, tok);
            for (const m of j.data || []) for (const v of m.values || []) {
              const d = addDays(String(v.end_time).slice(0, 10), -1), val = typeof v.value === 'object' ? Object.values(v.value || {}).reduce((a, b) => a + n0(b), 0) : n0(v.value);
              if (ours === 'followers') followersSeries[d] = val; else { bump(days, d, ours, val); bump(months, monthOf(d), ours, val); }
            }
          }
          got = true; break;
        } catch (e) { if (e.code190) throw e; /* try the next name for this figure */ }
      }
      if (!got) out.missing.push(`facebook ${ours}`);
    }
    const nowF = n0(prof.followers_count || prof.fan_count);
    if (nowF) followersSeries[today] = nowF;
    for (const [d, v] of Object.entries(followersSeries)) fbF[d] = n0(fbF[d]) + v;
    // posts
    const posts = await graphAll(`/${p.id}/posts`, { fields: 'id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)', since: Math.floor(Date.parse(from + 'T00:00:00Z') / 1000), limit: 100 }, tok, 600).catch((e) => { out.missing.push('facebook posts: ' + e.message); return []; });
    const rows = posts.map((x) => ({ id: x.id, at: x.created_time, kind: 'post', caption: x.message, link: x.permalink_url, thumb: x.full_picture, likes: x.reactions && x.reactions.summary ? x.reactions.summary.total_count : null, comments: x.comments && x.comments.summary ? x.comments.summary.total_count : null, shares: x.shares ? x.shares.count : 0 }));
    for (const x of rows) { const d = ymd(new Date(Date.parse(x.at) + 5.5 * 3600e3)); bump(days, d, 'posts', 1); bump(months, monthOf(d), 'posts', 1); }
    await putMedia('facebook', p.name, rows);
    out.facebook.push({ page: p.name, followers: nowF, posts: rows.length });
  }
  for (const d of Object.keys(fbF).sort()) { (days[d] = days[d] || {}).followers = fbF[d]; (months[monthOf(d)] = months[monthOf(d)] || {}).followers = fbF[d]; }
  const cut = addDays(ymd(ist()), -62);
  out.rows += await putDays('facebook', Object.fromEntries(Object.entries(days).filter(([d]) => d >= cut)));
  await putMonths('facebook', months);
}

// ---------- Instagram ----------
const IG_TOTALS = ['views', 'reach', 'total_interactions', 'likes', 'comments', 'shares', 'saves'];
async function igTotals(ig, tok, since, until) {
  const read = (j) => { const o = {}; for (const m of j.data || []) o[m.name] = n0(m.total_value ? m.total_value.value : (m.values && m.values[0] && m.values[0].value)); return o; };
  try { return read(await graph(`/${ig}/insights`, { metric: IG_TOTALS.join(','), metric_type: 'total_value', period: 'day', since, until }, tok)); }
  catch (e) {
    if (e.code190) throw e;
    const o = {};
    for (const m of IG_TOTALS) { try { Object.assign(o, read(await graph(`/${ig}/insights`, { metric: m, metric_type: 'total_value', period: 'day', since, until }, tok))); } catch (x) { if (x.code190) throw x; } }
    return o;
  }
}
const igMap = (o) => ({ views: o.views, reach: o.reach, interactions: o.total_interactions ?? (n0(o.likes) + n0(o.comments) + n0(o.shares) + n0(o.saves)), likes: o.likes, comments: o.comments, shares: o.shares, saves: o.saves });
async function syncInstagram(pages, from, dayCount, monthList, out) {
  const today = ymd(ist());
  for (const p of pages.filter((x) => x.ig)) {
    const tok = unseal('meta', p.token), ig = p.ig.id, days = {}, months = {};
    const prof = await graph(`/${ig}`, { fields: 'followers_count,media_count,username' }, tok);
    days[today] = { followers: n0(prof.followers_count) };
    // day by day
    const dayList = []; for (let i = dayCount; i >= 0; i--) dayList.push(addDays(today, -i));
    await pool(dayList, 5, async (d) => { const t = igMap(await igTotals(ig, tok, d, addDays(d, 1))); days[d] = { ...(days[d] || {}), ...Object.fromEntries(Object.entries(t).filter(([, v]) => v != null)) }; });
    try {
      const j = await graph(`/${ig}/insights`, { metric: 'follower_count', period: 'day', since: addDays(today, -29), until: today }, tok);
      for (const m of j.data || []) for (const v of m.values || []) { const d = addDays(String(v.end_time).slice(0, 10), -1); days[d] = { ...(days[d] || {}), gained: n0(v.value) }; }
    } catch (e) { if (e.code190) throw e; out.missing.push('instagram new followers'); }
    // month by month (in two halves; Instagram totals cover up to 30 days a call)
    await pool(monthList, 3, async (m) => {
      const end = nextMonth(m) < addDays(today, 1) ? nextMonth(m) : addDays(today, 1), mid = addDays(m, 15) < end ? addDays(m, 15) : end;
      const a = igMap(await igTotals(ig, tok, m, mid)), b = mid < end ? igMap(await igTotals(ig, tok, mid, end)) : {};
      const o = {}; for (const k of Object.keys(a)) if (a[k] != null || b[k] != null) o[k] = n0(a[k]) + n0(b[k]);
      months[m] = o;
    });
    if (months[monthOf(today)]) months[monthOf(today)].followers = n0(prof.followers_count);
    // posts and reels
    const media = await graphAll(`/${ig}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count', limit: 100 }, tok, 600);
    const mine = media.filter((x) => x.timestamp && x.timestamp.slice(0, 10) >= from);
    const rows = mine.map((x) => ({ id: x.id, at: x.timestamp, kind: x.media_product_type === 'REELS' ? 'reel' : x.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : x.media_type === 'VIDEO' ? 'video' : 'post', caption: x.caption, link: x.permalink, thumb: x.thumbnail_url || (x.media_type !== 'VIDEO' ? x.media_url : null), likes: x.like_count, comments: x.comments_count }));
    await pool(rows.slice(0, 40), 5, async (x) => {
      try { const j = await graph(`/${x.id}/insights`, { metric: 'views,reach,saved,shares' }, tok); for (const m of j.data || []) { const v = n0(m.values && m.values[0] && m.values[0].value); if (m.name === 'views') x.views = v; if (m.name === 'reach') x.reach = v; if (m.name === 'saved') x.saves = v; if (m.name === 'shares') x.shares = v; } }
      catch (e) { if (e.code190) throw e; }
    });
    for (const x of rows) { const d = ymd(new Date(Date.parse(x.at) + 5.5 * 3600e3)); days[d] = { ...(days[d] || {}), posts: n0((days[d] || {}).posts) + 1 }; if (months[monthOf(d)]) months[monthOf(d)].posts = n0(months[monthOf(d)].posts) + 1; else months[monthOf(d)] = { posts: 1 }; }
    await putMedia('instagram', p.ig.username, rows);
    out.rows += await putDays('instagram', days);
    await putMonths('instagram', months);
    out.instagram.push({ account: p.ig.username, followers: n0(prof.followers_count), posts: rows.length });
  }
}

// ---------- Meta Ads ----------
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'];
const MSG_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const act = (list, names) => { const a = list || []; for (const n of names) { const x = a.find((y) => y.action_type === n); if (x) return n0(x.value); } return 0; };
async function syncAds(meta, monthList, out) {
  const tok = unseal('meta', meta.token);
  const projects = await db.q('select id, name, code from projects where active order by id');
  const sig = projects.find((p) => p.code === 'SIGNATURE') || projects[0] || null;
  const projectFor = (name) => { const s = String(name || '').toLowerCase(); const hit = projects.find((p) => s.includes(String(p.name).toLowerCase().replace(/^dream\s+/, '')) || (p.code && s.includes(String(p.code).toLowerCase()))); return (hit || sig || {}).id || null; };
  const since = monthList[0], until = ymd(ist());
  for (const a of meta.ads) {
    const acc = a.id.startsWith('act_') ? a.id : 'act_' + a.id;
    const camps = await graphAll(`/${acc}/campaigns`, { fields: 'id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget', limit: 200 }, tok, 2000);
    const rows = await graphAll(`/${acc}/insights`, { level: 'campaign', time_range: { since, until }, time_increment: 'monthly', fields: 'campaign_id,campaign_name,objective,spend,impressions,reach,clicks,actions,date_start', limit: 500 }, tok, 20000);
    const totals = await graphAll(`/${acc}/insights`, { level: 'campaign', time_range: { since, until }, fields: 'campaign_id,reach', limit: 500 }, tok, 5000).catch(() => []);
    const byId = Object.fromEntries(camps.map((c) => [c.id, c]));
    const ids = [...new Set(rows.map((r) => r.campaign_id))];
    for (const cid of ids) {
      const c = byId[cid] || {}, first = rows.find((r) => r.campaign_id === cid);
      const name = c.name || first.campaign_name, eff = c.effective_status || c.status || '';
      const budget = c.lifetime_budget ? n0(c.lifetime_budget) / 100 : null;
      const st = eff === 'ACTIVE' ? 'active' : 'done';
      const r = await db.one(`insert into mkt_campaigns (project_id, name, channel, start_on, end_on, budget, status, ext_id, source, objective, ext_status, account, synced_at)
          values ($1, $2, 'meta_ads', $3, $4, $5, $6, $7, 'meta', $8, $9, $10, now())
        on conflict (ext_id) where ext_id is not null do update set name = excluded.name, start_on = excluded.start_on, end_on = excluded.end_on, budget = coalesce(excluded.budget, mkt_campaigns.budget),
          status = excluded.status, objective = excluded.objective, ext_status = excluded.ext_status, account = excluded.account, synced_at = now(), updated_at = now() returning id`,
      [projectFor(name), name, c.start_time ? c.start_time.slice(0, 10) : first.date_start, c.stop_time ? c.stop_time.slice(0, 10) : null, budget, st, 'meta:' + cid, c.objective || first.objective || null, eff || null, a.name]);
      for (const m of rows.filter((x) => x.campaign_id === cid)) {
        await db.q(`insert into mkt_campaign_months (campaign_id, month, spend, impressions, reach, clicks, leads, messages, video_views) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (campaign_id, month) do update set spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks, leads = excluded.leads, messages = excluded.messages, video_views = excluded.video_views`,
        [r.id, monthOf(m.date_start), n0(m.spend), n0(m.impressions), n0(m.reach), n0(m.clicks), act(m.actions, LEAD_ACTIONS), act(m.actions, MSG_ACTIONS), act(m.actions, ['video_view'])]);
      }
      const t = totals.find((x) => x.campaign_id === cid);
      await db.q(`update mkt_campaigns c set spent = s.spend, impressions = s.imp, clicks = s.clk, ad_leads = s.leads, messages = s.msg, video_views = s.vv, reach = coalesce($2, s.reach)
        from (select sum(spend) as spend, sum(impressions) as imp, sum(clicks) as clk, sum(leads) as leads, sum(messages) as msg, sum(video_views) as vv, sum(reach) as reach from mkt_campaign_months where campaign_id = $1) s where c.id = $1`, [r.id, t ? n0(t.reach) : null]);
    }
    // day by day for the last 40 days (exact "last 30 days" spend and leads)
    const dSince = addDays(ymd(ist()), -40);
    const daily = await graphAll(`/${acc}/insights`, { level: 'campaign', time_range: { since: dSince, until }, time_increment: 1, fields: 'campaign_id,spend,impressions,clicks,actions,date_start', limit: 500 }, tok, 20000).catch((e) => { out.missing.push('ads by day: ' + e.message); return []; });
    for (const x of daily) {
      if (!x.date_start) continue;
      const c = await db.one('select id from mkt_campaigns where ext_id = $1', ['meta:' + x.campaign_id]); if (!c) continue;
      await db.q(`insert into mkt_campaign_days (campaign_id, day, spend, impressions, clicks, leads, messages) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (campaign_id, day) do update set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, leads = excluded.leads, messages = excluded.messages`,
      [c.id, String(x.date_start).slice(0, 10), n0(x.spend), n0(x.impressions), n0(x.clicks), act(x.actions, LEAD_ACTIONS), act(x.actions, MSG_ACTIONS)]);
    }
    out.ads.push({ account: a.name, campaigns: ids.length, spend: Math.round(rows.reduce((s, x) => s + n0(x.spend), 0)), currency: a.currency });
  }
}

// ---------- Meta lead forms → Leads ----------
const phone10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d || null; };
async function syncLeadForms(meta, out) {
  let added = 0, again = 0;
  const sig = await db.one("select id from projects where code = 'SIGNATURE'"); // today's marketing is for Dream Signature
  for (const p of meta.pages) {
    const tok = unseal('meta', p.token);
    const forms = await graphAll(`/${p.id}/leadgen_forms`, { fields: 'id,name,status,leads_count', limit: 100 }, tok, 200).catch((e) => { out.missing.push('lead forms: ' + e.message); return []; });
    for (const f of forms) {
      const leads = await graphAll(`/${f.id}/leads`, { fields: 'id,created_time,field_data,campaign_id,campaign_name,ad_name,form_id', limit: 500 }, tok, 5000).catch(() => []);
      for (const l of leads) {
        const fd = {}; for (const x of l.field_data || []) fd[String(x.name).toLowerCase()] = (x.values || []).join(', ');
        const name = fd.full_name || [fd.first_name, fd.last_name].filter(Boolean).join(' ') || null, phone = phone10(fd.phone_number || fd.phone || fd.mobile), email = fd.email || null;
        const extra = Object.entries(fd).filter(([k]) => !['full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'mobile', 'email'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
        const note = [`Meta lead form "${f.name}"${l.ad_name ? `, ad "${l.ad_name}"` : ''}`, extra].filter(Boolean).join('\n');
        const camp = l.campaign_id ? await db.one('select id, project_id from mkt_campaigns where ext_id = $1', ['meta:' + l.campaign_id]) : null;
        const tag = `[meta:${l.id}]`;
        if (await db.one('select 1 as x from mkt_leads where ext_id = $1 or (phone = $2 and position($3 in coalesce(note, \'\')) > 0)', ['meta:' + l.id, phone, tag])) continue;
        const dup = phone ? await db.one('select id from mkt_leads where phone = $1', [phone]) : null;
        if (dup) { again++; await db.q("update mkt_leads set note = concat_ws(E'\\n', note, $2::text), updated_at = now() where id = $1", [dup.id, `Came again from Meta lead form "${f.name}" on ${String(l.created_time).slice(0, 10)} ${tag}`]); continue; }
        await db.q('insert into mkt_leads (project_id, name, phone, email, source, campaign_id, note, ext_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing',
          [camp ? camp.project_id : sig && sig.id, name, phone, email, 'meta_ads', camp ? camp.id : null, note, 'meta:' + l.id, l.created_time || new Date()]);
        added++;
      }
    }
  }
  out.leads = { added, again };
}

// ---------- YouTube figures ----------
const secs = (iso) => { const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []; return n0(m[1]) * 86400 + n0(m[2]) * 3600 + n0(m[3]) * 60 + n0(m[4]) || 9999; };
async function syncYouTube(c, from, monthList, out) {
  const tok = await ytToken(c), today = ymd(ist());
  const ch = ((await yt(YT(), '/channels', { part: 'statistics,snippet,contentDetails', mine: 'true' }, tok)).items || [])[0];
  if (!ch) throw err(400, 'YouTube: no channel on the connected account.');
  const subs = n0(ch.statistics.subscriberCount);
  const report = async (params) => { const j = await yt(YTA(), '/reports', { ids: 'channel==MINE', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares', ...params }, tok); const h = (j.columnHeaders || []).map((x) => x.name); return (j.rows || []).map((r) => Object.fromEntries(r.map((v, i) => [h[i], v]))); };
  const days = {}, months = {};
  const dr = await report({ startDate: addDays(today, -62), endDate: today, dimensions: 'day', sort: 'day' });
  for (const r of dr) days[r.day] = { views: n0(r.views), watchMinutes: n0(r.estimatedMinutesWatched), gained: n0(r.subscribersGained) - n0(r.subscribersLost), interactions: n0(r.likes) + n0(r.comments) + n0(r.shares), likes: n0(r.likes), comments: n0(r.comments), shares: n0(r.shares) };
  let run = subs; for (const d of Object.keys(days).sort().reverse()) { days[d].followers = run; run -= n0(days[d].gained); }
  days[today] = { ...(days[today] || {}), followers: subs };
  const mr = await report({ startDate: monthList[0], endDate: today, dimensions: 'month', sort: 'month' });
  for (const r of mr) months[r.month + '-01'] = { views: n0(r.views), watchMinutes: n0(r.estimatedMinutesWatched), gained: n0(r.subscribersGained) - n0(r.subscribersLost), interactions: n0(r.likes) + n0(r.comments) + n0(r.shares), likes: n0(r.likes), comments: n0(r.comments), shares: n0(r.shares) };
  run = subs; for (const m of Object.keys(months).sort().reverse()) { months[m].followers = run; run -= n0(months[m].gained); }
  // videos
  const uploads = c.youtube.uploads || (ch.contentDetails && ch.contentDetails.relatedPlaylists.uploads);
  const ids = []; let page = null;
  for (let i = 0; i < 6 && uploads; i++) {
    const j = await yt(YT(), '/playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(page ? { pageToken: page } : {}) }, tok);
    for (const it of j.items || []) if ((it.contentDetails.videoPublishedAt || '').slice(0, 10) >= from) ids.push(it.contentDetails.videoId);
    page = j.nextPageToken; if (!page || (j.items || []).some((it) => (it.contentDetails.videoPublishedAt || '9').slice(0, 10) < from)) break;
  }
  const rows = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt(YT(), '/videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') }, tok);
    for (const v of j.items || []) rows.push({ id: v.id, at: v.snippet.publishedAt, kind: secs(v.contentDetails.duration) <= 180 ? 'short' : 'video', caption: v.snippet.title, link: `https://youtu.be/${v.id}`, thumb: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url, likes: n0(v.statistics.likeCount), comments: n0(v.statistics.commentCount), views: n0(v.statistics.viewCount) });
  }
  for (const x of rows) { const d = ymd(new Date(Date.parse(x.at) + 5.5 * 3600e3)); if (days[d]) days[d].posts = n0(days[d].posts) + 1; const m = monthOf(d); months[m] = { ...(months[m] || {}), posts: n0((months[m] || {}).posts) + 1 }; }
  await putMedia('youtube', c.youtube.title, rows);
  out.rows += await putDays('youtube', days);
  await putMonths('youtube', months);
  out.youtube = { channel: c.youtube.title, subscribers: subs, videos: rows.length };
}

// ---------- the nightly pull ----------
// One part at a time when asked (the page pulls 12 months part by part so each stays within the time a call may take);
// everything when the night job runs. A part's first pull goes back 12 months, later ones the last weeks.
const PARTS = ['facebook', 'instagram', 'ads', 'leads', 'youtube'];
async function sync({ full = false, only = null } = {}) {
  const c = await conn();
  const out = { at: new Date().toISOString(), rows: 0, facebook: [], instagram: [], ads: [], leads: null, youtube: null, errors: [], missing: [] };
  if (!(c.meta && c.meta.token) && !(c.youtube && c.youtube.refresh)) return { skipped: 'No channel connected yet.' };
  const today = ymd(ist()), done = {};
  const parts = only ? [only] : PARTS;
  let expired = false;
  for (const part of parts) {
    const holder = part === 'youtube' ? c.youtube : c.meta;
    if (!holder || (part === 'youtube' ? !holder.refresh : !holder.token) || (expired && part !== 'youtube')) continue;
    const first = full || !(holder.backfilled || {})[part], months = lastMonths(first ? 13 : 2), from = first ? months[0] : addDays(today, -40);
    try {
      if (part === 'facebook') await syncFacebook(c.meta.pages, from, out);
      if (part === 'instagram') await syncInstagram(c.meta.pages, from, first ? 35 : 3, months, out);
      if (part === 'ads') await syncAds(c.meta, first ? months : lastMonths(3), out);
      if (part === 'leads') await syncLeadForms(c.meta, out);
      if (part === 'youtube') await syncYouTube(c, from, months, out);
      done[part] = today;
    } catch (e) {
      out.errors.push(`${part}: ${e.message}`);
      if (e.code190 && part !== 'youtube') expired = true;
      if (part === 'youtube') c.youtube.error = e.code190 ? 'YouTube has signed the ERP out. Press "Connect YouTube" again.' : e.message;
    }
  }
  const fresh = await conn(); // keep anything changed while the pull ran (a new connection)
  for (const [net, cur] of [['meta', c.meta], ['youtube', c.youtube]]) {
    const f = fresh[net]; if (!f || !cur || f.at !== cur.at) continue;
    f.backfilled = { ...(typeof f.backfilled === 'object' && f.backfilled ? f.backfilled : {}) };
    for (const [part, d] of Object.entries(done)) if ((part === 'youtube') === (net === 'youtube') && !f.backfilled[part]) f.backfilled[part] = d;
    if (net === 'meta') { if (expired) f.error = 'Facebook has signed the ERP out. Press "Connect with Facebook" again.'; else if (parts.some((p) => p !== 'youtube') && !out.errors.length) f.error = null; }
    if (net === 'youtube') f.error = done.youtube ? null : cur.error || f.error;
  }
  await saveConn(fresh);
  const info = { ...out, only, missing: out.missing.slice(0, 20) };
  await db.q("insert into job_marks (key, info) values ('social-sync', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [info]);
  return info;
}

module.exports = { PARTS, metaOn, googleOn, metaAuthUrl, metaCallback, ytAuthUrl, ytCallback, disconnect, status, sync, metaRedirect, META_SCOPES };
