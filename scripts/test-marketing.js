// Marketing & social media: who sees it, posts and approval, leads (typed, duplicate, from the website link, matched to a
// booking), campaigns, tasks, figures typed in, and Facebook / Instagram / Meta Ads / YouTube connected directly (stand-ins
// on a local port).
// DATABASE_URL=postgres://... node scripts/test-marketing.js   (an empty database)
const assert = require('assert/strict');
const http = require('http');
process.env.PORT = process.env.PORT || '3995';
const calls = [];
// A stand-in for Facebook / Instagram / Meta Ads (/graph), Google sign-in (/gtoken) and YouTube (/yt, /yta).
const iso = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
const mon = (k) => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1)).toISOString().slice(0, 10); };
const fake = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  calls.push(req.method + ' ' + req.url); const u = new URL(req.url, 'http://x'), q = u.searchParams, P = u.pathname;
  if (req.method === 'POST' && P.startsWith('/graph')) for (const [k, v] of new URLSearchParams(body)) q.set(k, v);
  const J = (o, st = 200) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (P.startsWith('/exo/v1/Accounts/ACC1/Calls.json')) {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('k1:t1').toString('base64')) return J({ RestException: { Message: 'Authentication failed' } }, 401);
    if (q.get('page') === '2') return J({ Metadata: {}, Calls: [{ Sid: 'x3', From: '09111122222', To: '02261234567', Direction: 'inbound', Status: 'no-answer', StartTime: '2026-06-02 09:00:00', Duration: '0' }] });
    return J({ Metadata: { NextPageUri: '/exo/v1/Accounts/ACC1/Calls.json?page=2' }, Calls: [
      { Sid: 'x1', From: '09111122222', To: '02261234567', Direction: 'inbound', Status: 'completed', StartTime: '2026-06-01 10:00:00', Duration: '65', RecordingUrl: 'https://rec/x1.mp3' },
      { Sid: 'x2', From: '02261234567', To: '09111133333', Direction: 'outbound-api', Status: 'completed', StartTime: '2026-06-01 11:00:00', Duration: '20' }] });
  }
  if (P === '/pic.jpg') { res.setHeader('Content-Type', 'image/jpeg'); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
  if (P === '/gtoken') { const f = new URLSearchParams(body); return J(f.get('grant_type') === 'authorization_code' ? { access_token: 'YT', refresh_token: 'R1', expires_in: 3600 } : { access_token: 'YT2', expires_in: 3600 }); }
  if (P.startsWith('/yt/')) {
    if (req.headers.authorization !== 'Bearer YT' && req.headers.authorization !== 'Bearer YT2') return J({ error: { message: 'no' } }, 401);
    if (P === '/yt/channels') return J({ items: [{ id: 'UC1', snippet: { title: 'Dream India Realty', customUrl: '@dreamindiarealty' }, statistics: { subscriberCount: '800' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
    if (P === '/yt/playlistItems') return J({ items: [{ contentDetails: { videoId: 'v1', videoPublishedAt: iso(3) + 'T10:00:00Z' } }] });
    if (P === '/yt/videos') return J({ items: [{ id: 'v1', snippet: { title: 'Sample flat walkthrough', publishedAt: iso(3) + 'T10:00:00Z', thumbnails: { medium: { url: 'http://127.0.0.1:2539/pic.jpg' } } }, statistics: { viewCount: '1200', likeCount: '30', commentCount: '3' }, contentDetails: { duration: 'PT45S' } }] });
  }
  if (P === '/yta/reports') {
    const h = ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
    if (q.get('dimensions') === 'day') return J({ columnHeaders: [{ name: 'day' }, ...h.map((name) => ({ name }))], rows: [2, 1, 0].map((k) => [iso(k), 100, 300, 5, 1, 10, 2, 1]) });
    return J({ columnHeaders: [{ name: 'month' }, ...h.map((name) => ({ name }))], rows: [2, 1, 0].map((k) => [mon(k).slice(0, 7), 3000, 9000, 40, 4, 200, 20, 10]) });
  }
  if (!P.startsWith('/graph')) return J({ error: { message: 'unknown' } }, 404);
  const g = P.slice(6), tok = q.get('access_token');
  if (g === '/oauth/access_token') return J(q.get('fb_exchange_token') ? { access_token: 'LONG', expires_in: 5184000 } : q.get('code') === 'good' ? { access_token: 'SHORT' } : { error: { message: 'bad code' } }, q.get('fb_exchange_token') || q.get('code') === 'good' ? 200 : 400);
  if (!tok || !q.get('appsecret_proof')) return J({ error: { message: 'token missing' } }, 400);
  const series = (val) => { const out = []; for (let d = q.get('since'); d < q.get('until'); d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) out.push({ value: val, end_time: new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10) + 'T07:00:00+0000' }); return out; };
  if (g === '/me') return J({ id: 'u1', name: 'Rafi' });
  if (req.method === 'POST' && g === '/p1/photos') { global.posted = (global.posted || []).concat([{ fb: q.get('url'), caption: q.get('caption') }]); return J({ id: 'ph1', post_id: 'p1_99' }); }
  if (req.method === 'POST' && g === '/ig1/media') { global.posted = (global.posted || []).concat([{ ig: q.get('image_url') }]); return J({ id: 'cont1' }); }
  if (req.method === 'POST' && g === '/ig1/media_publish') return J({ id: 'igm9' });
  if (g === '/igm9') return J({ permalink: 'https://www.instagram.com/p/igm9/' });
  if (g === '/me/accounts' && global.noIg && /instagram_business_account/.test(q.get('fields'))) return J({ error: { message: '(#100) Tried accessing nonexisting field (instagram_business_account)', code: 100 } }, 400);
  if (g === '/me/accounts') return J({ data: [{ id: 'p1', name: 'Dream India Realty', link: 'https://www.facebook.com/dreamindiarealty', access_token: 'PAGE', ...(global.noIg ? {} : { instagram_business_account: { id: 'ig1', username: 'dreamindiarealty' } }) }] });
  if (g === '/me/adaccounts') return J({ data: [{ id: 'act_9', name: 'Dream India Ads', currency: 'INR', account_status: 1 }] });
  if (g === '/p1') return J({ followers_count: 1500 });
  if (g === '/p1/insights') { const m = q.get('metric'); if (m === 'page_media_view') return J({ error: { message: 'metric not available', code: 100 } }, 400); return J({ data: [{ name: m, values: series({ page_impressions: 300, page_impressions_unique: 200, page_post_engagements: 20, page_daily_follows_unique: 2, page_follows: 1500 }[m] || 0) }] }); }
  if (g === '/p1/posts') return J({ data: [{ id: 'p1_1', message: 'Diwali greetings from Dream Signature', created_time: iso(10) + 'T09:00:00+0000', permalink_url: 'https://facebook.com/p1_1', full_picture: 'http://127.0.0.1:2539/pic.jpg', reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }] });
  if (g === '/ig1') return J({ followers_count: 2040, media_count: 300, username: 'dreamindiarealty' });
  if (g === '/ig1/insights') { if (q.get('metric') === 'follower_count') return J({ data: [{ name: 'follower_count', values: series(3) }] }); return J({ data: q.get('metric').split(',').map((name) => ({ name, total_value: { value: { views: 1000, reach: 400, total_interactions: 60 }[name] ?? 5 } })) }); }
  if (g === '/ig1/media') return J({ data: [{ id: 'm1', caption: 'Rooftop pool reel', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/p/m1', thumbnail_url: 'http://127.0.0.1:2539/pic.jpg', timestamp: iso(5) + 'T12:00:00+0000', like_count: 50, comments_count: 4 }] });
  if (g === '/m1/insights') return J({ data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'reach', values: [{ value: 700 }] }, { name: 'saved', values: [{ value: 6 }] }, { name: 'shares', values: [{ value: 3 }] }] });
  if (g === '/act_9/campaigns') return J({ data: [{ id: 'c1', name: 'Dream Signature 2BHK leads', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', start_time: mon(2) + 'T00:00:00+0530' }] });
  if (g === '/act_9/insights') {
    if (q.get('time_increment') === '1') return J({ data: [1, 2, 40].map((k) => ({ campaign_id: 'c1', spend: '1000', impressions: '5000', clicks: '80', actions: [{ action_type: 'lead', value: '4' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' }], date_start: iso(k) })) });
    if (q.get('time_increment') === 'monthly') return J({ data: [2, 1, 0].map((k) => ({ campaign_id: 'c1', campaign_name: 'Dream Signature 2BHK leads', spend: '10000.50', impressions: '50000', reach: '20000', clicks: '800', actions: [{ action_type: 'lead', value: '40' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' }], date_start: mon(k) })) });
    return J({ data: [{ campaign_id: 'c1', reach: '45000' }] });
  }
  if (g === '/p1/leadgen_forms') return J({ data: [{ id: 'f1', name: 'Signature enquiry' }] });
  if (g === '/f1/leads') return J({ data: [{ id: 'L1', created_time: iso(2) + 'T08:00:00+0000', campaign_id: 'c1', ad_name: '2BHK ad', field_data: [{ name: 'full_name', values: ['Asha Patil'] }, { name: 'phone_number', values: ['+919876500001'] }, { name: 'which_flat?', values: ['2BHK'] }] }, { id: 'L2', created_time: iso(1) + 'T08:00:00+0000', campaign_id: 'c1', field_data: [{ name: 'full_name', values: ['Rahul'] }, { name: 'phone_number', values: ['9820000001'] }] }] });
  return J({ error: { message: 'unknown ' + g } }, 404);
}).listen(2539);
Object.assign(process.env, { META_GRAPH: 'http://127.0.0.1:2539/graph', META_DIALOG: 'http://127.0.0.1:2539/dialog', META_APP_ID: 'app1', META_APP_SECRET: 'appsecret', YT_API: 'http://127.0.0.1:2539/yt', YTA_API: 'http://127.0.0.1:2539/yta', GOOGLE_OAUTH_TOKEN_URL: 'http://127.0.0.1:2539/gtoken', GOOGLE_OAUTH_AUTH_URL: 'http://127.0.0.1:2539/gauth', GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret' });
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, noOrigin) => {
    const r = await fetch(BASE + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', ...(noOrigin ? {} : { Origin: BASE }) } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, location: r.headers.get('location'), ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
  const mk = async (u, role) => { await db.q('insert into users (username, name, role, password_hash, all_projects) values ($1, $1, $2, $3, true)', [u, role, auth.hashPassword('pass-word-123')]); const c = client(); await c('/api/session', { action: 'login', username: u, password: 'pass-word-123' }); return c; };
  const rupali = await mk('rupali', 'marketing'), sameer = await mk('sameer', 'management'), crm = await mk('crm1', 'crm');
  const M = (c, action, data) => c('/api/marketing', { action, data });

  await step('Marketing opens for the marketing role, Management and Admin; not for the CRM team', async () => {
    const g = await rupali('/api/marketing?scope=company');
    assert.equal(g.status, 200, g.error); assert.equal(g.can.edit, true); assert.equal(g.can.approve, false);
    assert.equal(g.channels.filter((c) => !c.wa && !c.ivr).length, 1); assert.equal(g.channels[2].network, 'ivr'); assert.equal(g.channels[0].handle, 'dreamindiarealty'); assert.equal(g.channels[1].network, 'whatsapp');
    assert.equal((await sameer('/api/marketing?scope=company')).can.approve, true);
    assert.equal((await crm('/api/marketing?scope=company')).status, 403);
    assert.equal((await M(sameer, 'post.save', { title: 'x' })).status, 403); // Management approves, the marketing team plans
  });

  let postId;
  await step('A post planned for Dream Signature; with approvals on, it waits for Management, who approves it', async () => {
    assert.equal((await M(admin, 'settings', { needApproval: true })).ok, true);
    const r = await M(rupali, 'post.save', { title: 'Amenities reel', channels: ['instagram', 'facebook', 'tiktok'], kind: 'reel', status: 'scheduled', projectId: sig.id, publishAt: new Date(Date.now() + 864e5).toISOString(), canvaUrl: 'https://www.canva.com/design/DAF1/view' });
    assert.equal(r.ok, true); assert.equal(r.status, 'review'); postId = r.id;
    const g = await rupali(`/api/marketing?scope=${sig.id}`);
    const p = g.posts.find((x) => x.id === postId); assert.deepEqual(p.channels, ['instagram', 'facebook']); assert.equal(p.canva_url, 'https://www.canva.com/design/DAF1/view');
    assert.equal((await M(rupali, 'post.status', { id: postId, status: 'approved' })).status, 403);
    assert.equal((await M(sameer, 'post.status', { id: postId, status: 'approved' })).ok, true);
    assert.equal((await M(rupali, 'post.save', { id: postId, title: 'Amenities reel', channels: ['instagram'], status: 'scheduled', projectId: sig.id })).status, 'scheduled');
    assert.equal((await rupali('/api/marketing?scope=company')).posts.length, 1);
  });

  await step('Designs: the Canva export is attached to the post, sent for approval, sent back with a comment, then approved', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
    assert.equal((await M(rupali, 'post.file', { postId, name: 'reel.png', mime: 'image/png', data: png })).ok, true);
    assert.equal((await M(rupali, 'post.file', { postId, name: 'x.exe', mime: 'application/x-msdownload', data: png })).status, 400);
    assert.equal((await M(sameer, 'post.file', { postId, name: 'a.png', mime: 'image/png', data: png })).status, 403);
    const p = (await rupali('/api/marketing?scope=company')).posts.find((x) => x.id === postId);
    assert.equal(p.files.length, 1); assert.equal(p.files[0].mime, 'image/png');
    const img = await fetch(BASE + '/api/marketing?pfile=' + p.files[0].id); assert.equal(img.status, 401); // only signed in
    const sent = await M(rupali, 'post.send', { id: postId }); assert.equal(sent.ok, true); assert.ok(sent.mail.skipped);
    assert.equal((await M(rupali, 'post.sendback', { id: postId, note: 'Bigger logo' })).status, 403);
    assert.equal((await M(sameer, 'post.sendback', { id: postId, note: 'Bigger logo' })).ok, true);
    const b = (await rupali('/api/marketing?scope=company')).posts.find((x) => x.id === postId); assert.equal(b.status, 'draft'); assert.match(b.review_note, /Bigger logo/);
    await M(rupali, 'post.send', { id: postId }); assert.equal((await M(sameer, 'post.status', { id: postId, status: 'approved' })).ok, true);
    const c = (await rupali('/api/marketing?scope=company')).posts.find((x) => x.id === postId); assert.equal(c.status, 'approved'); assert.equal(c.review_note, null);
  });

  await step('Leads: typed in, a duplicate number warned, tagged to a campaign; a buyer in the CRM is recognised', async () => {
    const c = await M(rupali, 'campaign.save', { name: 'Diwali drive', channel: 'instagram', budget: '1,50,000', spent: '90000', projectId: sig.id });
    assert.equal(c.ok, true);
    const buyer = await db.one("select right(regexp_replace(y.phone, '\\D', '', 'g'), 10) as p from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id where b.status = 'active' and y.phone is not null limit 1");
    assert.equal((await M(rupali, 'lead.save', { name: 'Rahul', phone: '+91 98200 00001', source: 'meta_ads', projectId: sig.id, campaignId: c.id })).ok, true);
    const d = await M(rupali, 'lead.save', { name: 'Rahul again', phone: '9820000001' }); assert.equal(d.status, 409); assert.ok(d.duplicate);
    if (buyer) assert.equal((await M(rupali, 'lead.save', { name: 'Existing buyer', phone: buyer.p, source: 'referral', projectId: sig.id })).ok, true);
    const g = await rupali(`/api/marketing?scope=${sig.id}`);
    assert.equal(g.leads.find((l) => l.name === 'Rahul').phone, '9820000001');
    if (buyer) assert.equal(g.leads.find((l) => l.name === 'Existing buyer').is_buyer, true);
    const camp = g.campaigns.find((x) => x.name === 'Diwali drive'); assert.equal(camp.leads, 1); assert.equal(+camp.budget, 150000);
  });

  await step('The website link adds a lead without a login, only with the right key, once per number in 30 days', async () => {
    const g = await admin('/api/marketing?scope=company'); assert.ok(g.settings.leadUrl);
    const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dreamindiarealty.com' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    assert.equal((await post('/api/marketing?lead=wrongkeywrongkeywrongkey', { phone: '9000000001' })).status, 403);
    const a = await post(g.settings.leadUrl, { name: 'Web Enquiry', phone: '9000000001', message: '2BHK price?', project: 'Dream Signature' });
    assert.equal(a.ok, true);
    const b = await post(g.settings.leadUrl, { name: 'Web Enquiry', phone: '9000000001' }); assert.equal(b.duplicate, true);
    const l = await db.one("select * from mkt_leads where phone = '9000000001'"); assert.equal(l.source, 'website'); assert.equal(l.project_id, sig.id); assert.match(l.note, /Came again/);
  });

  await step('IVR: each call (Exotel Passthru, GET) is kept, a new caller becomes a lead, a repeat caller gets a note, a missed call is listed', async () => {
    const g = await admin('/api/marketing?scope=company'); const link = g.settings.ivrUrl; assert.ok(link);
    const hit = (qs) => fetch(BASE + link + '&' + qs).then(async (r) => ({ status: r.status, text: await r.text() }));
    assert.equal((await fetch(BASE + '/api/marketing?ivr=wrongkeywrongkeywrongkey&CallFrom=09876543210')).status, 403);
    const a = await hit('CallSid=s1&CallFrom=09876543210&CallTo=02261234567&StartTime=2026-10-30%2011:05:00&CallType=completed&DialCallDuration=42&RecordingUrl=https%3A%2F%2Frec.example%2F1.mp3');
    assert.equal(a.status, 200); assert.equal(a.text, 'OK');
    await hit('CallSid=s1&CallFrom=09876543210&CallType=completed&DialCallDuration=42'); // the same call again: not doubled
    await hit('CallSid=s2&CallFrom=09876543210&CallTo=02261234567&CallType=call-attempt&DialCallDuration=0'); // the same caller, missed
    const l = await db.q("select * from mkt_leads where phone = '9876543210'"); assert.equal(l.length, 1); assert.equal(l[0].source, 'ivr'); assert.match(l[0].note, /Called the IVR again/);
    assert.equal((await db.one('select count(*)::int as n from mkt_ivr_calls')).n, 2);
    const o = await rupali('/api/marketing?scope=company'); const iv = o.channels.find((c) => c.ivr).ivr;
    assert.equal(iv.calls30, 2); assert.equal(iv.callers30, 1); assert.equal(iv.missed30, 1); assert.equal(iv.leads30, 1);
    assert.equal((await rupali('/api/marketing?mdrill=ivrmissed&scope=company')).rows.length, 1);
    assert.equal((await rupali('/api/marketing?mdrill=ivrcalls&scope=company')).rows[1].recording_url, 'https://rec.example/1.mp3');
    await db.q("delete from mkt_ivr_calls"); await db.q("delete from mkt_leads where phone = '9876543210'");
    // the Exotel call history (12 months, page by page): inbound calls kept, outbound left out, one lead per caller
    assert.ok((await M(rupali, 'ivr.sync')).skipped);
    Object.assign(process.env, { EXOTEL_SID: 'ACC1', EXOTEL_API_KEY: 'k1', EXOTEL_API_TOKEN: 't1', EXOTEL_API: 'http://127.0.0.1:2539/exo' });
    const x = await M(rupali, 'ivr.sync'); assert.equal(x.ok, true, JSON.stringify(x) + calls.filter((c) => /exo/.test(c)).join(' ')); assert.equal(x.read, 3); assert.equal(x.kept, 2);
    const leads = await db.q("select * from mkt_leads where phone = '9111122222'"); assert.equal(leads.length, 1); assert.equal(leads[0].source, 'ivr'); assert.equal(String(leads[0].created_at.toISOString ? leads[0].created_at.toISOString() : leads[0].created_at).slice(0, 10), '2026-06-01');
    await M(rupali, 'ivr.sync', { full: true }); assert.equal((await db.one('select count(*)::int as n from mkt_ivr_calls')).n, 2); // not doubled
    await db.q("delete from mkt_ivr_calls"); await db.q("delete from mkt_leads where phone = '9111122222'");
    for (const k of ['EXOTEL_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_API']) delete process.env[k];
  });

  await step('Tasks and figures typed by hand', async () => {
    assert.equal((await M(rupali, 'task.save', { title: 'Shoot sample flat', due: '2026-11-02' })).ok, true);
    const t = (await rupali('/api/marketing?scope=company')).tasks[0]; assert.equal((await M(rupali, 'task.done', { id: t.id })).ok, true);
    assert.equal((await M(rupali, 'stats.save', { network: 'youtube', day: new Date().toISOString().slice(0, 10), followers: '120', views: '5,000' })).ok, true);
    assert.equal((await M(rupali, 'settings', { channels: [{ network: 'instagram', handle: 'dreamindiarealty' }, { network: 'youtube', handle: 'DreamIndiaRealty' }] })).ok, true);
    const yt = (await rupali('/api/marketing?scope=company')).channels.find((c) => c.network === 'youtube'); assert.equal(yt.followers, 120); assert.equal(yt.views, 5000);
  });

  await step('Facebook, Instagram and Meta Ads connect with one sign-in; the tokens are kept sealed; channels appear', async () => {
    assert.equal((await crm('/api/marketing?connect=meta')).status, 403);
    const go = await rupali('/api/marketing?connect=meta');
    assert.equal(go.status, 302); const to = new URL(go.location); assert.equal(to.origin + to.pathname, 'http://127.0.0.1:2539/dialog');
    assert.match(to.searchParams.get('scope'), /ads_read/); assert.match(to.searchParams.get('scope'), /leads_retrieval/); assert.equal(to.searchParams.get('redirect_uri'), BASE + '/oauth/meta');
    const bad = await rupali(`/oauth/meta?code=good&state=wrong`); assert.match(decodeURIComponent(bad.location), /expired/);
    const go2 = await rupali('/api/marketing?connect=meta'), st = new URL(go2.location).searchParams.get('state');
    const back = await rupali(`/oauth/meta?code=good&state=${encodeURIComponent(st)}`);
    assert.equal(back.status, 302); assert.match(decodeURIComponent(back.location), /Connected: 1 Facebook page\(s\), 1 Instagram, 1 ad account/);
    const raw = JSON.stringify((await db.one("select value from settings where key = 'social'")).value); assert.ok(!raw.includes('LONG') && !raw.includes('PAGE'), 'tokens are sealed');
    const g = await rupali('/api/marketing?scope=company');
    assert.equal(g.social.meta.connected, true); assert.equal(g.social.meta.pages[0].instagram, 'dreamindiarealty');
    assert.ok(['facebook', 'instagram'].every((n) => g.channels.some((c) => c.network === n)));
  });

  await step('YouTube connects through the Google sign-in the ERP already has', async () => {
    const go = await rupali('/api/marketing?connect=youtube'); const to = new URL(go.location);
    assert.match(to.searchParams.get('scope'), /yt-analytics.readonly/); assert.equal(to.searchParams.get('redirect_uri'), BASE + '/oauth/google');
    const back = await rupali(`/oauth/google?code=x&state=${encodeURIComponent(to.searchParams.get('state'))}`);
    assert.match(decodeURIComponent(back.location), /YouTube connected: Dream India Realty/);
    assert.ok((await rupali('/api/marketing?scope=company')).channels.some((c) => c.network === 'youtube' && /^dreamindiarealty$/i.test(c.handle) && c.url));
  });

  await step('The 12-month pull, part by part: page, Instagram, ad campaigns month by month, lead-form leads, YouTube', async () => {
    for (const part of ['facebook', 'instagram', 'ads', 'leads', 'youtube']) { const r = await M(rupali, 'sync', { part, full: true }); assert.equal(r.ok, true); assert.deepEqual(r.errors, [], part + ': ' + JSON.stringify(r.errors)); }
    assert.ok(calls.some((c) => c.includes('/p1/insights') && c.includes('page_impressions')), 'falls back from page_media_view');
    const g = await rupali('/api/marketing?scope=company');
    const ig = g.channels.find((c) => c.network === 'instagram'), fb = g.channels.find((c) => c.network === 'facebook'), yt = g.channels.find((c) => c.network === 'youtube');
    assert.equal(ig.followers, 2040); assert.ok(ig.views >= 1000); assert.equal(fb.followers, 1500); assert.ok(fb.views > 0); assert.equal(yt.followers, 800); assert.ok(yt.views >= 300);
    assert.ok(g.top.some((m) => m.ext_id === 'm1' && +m.views === 900 && m.has_thumb));
    const camp = await db.one("select * from mkt_campaigns where ext_id = 'meta:c1'");
    assert.equal(camp.project_id, sig.id); assert.equal(+camp.spent, 30001.5); assert.equal(camp.ad_leads, 120); assert.equal(camp.messages, 36); assert.equal(+camp.reach, 45000);
    assert.equal((await db.one('select count(*)::int as n from mkt_campaign_months where campaign_id = $1', [camp.id])).n, 3);
    const asha = await db.one("select * from mkt_leads where phone = '9876500001'"); assert.equal(asha.source, 'meta_ads'); assert.equal(asha.campaign_id, camp.id); assert.match(asha.note, /which flat\?: 2BHK/);
    assert.match((await db.one("select note from mkt_leads where phone = '9820000001' and name = 'Rahul'")).note, /Came again from Meta lead form/);
    // again: nothing doubles
    await M(rupali, 'sync', { part: 'ads' }); await M(rupali, 'sync', { part: 'leads' });
    assert.equal((await db.one("select count(*)::int as n from mkt_campaigns where ext_id = 'meta:c1'")).n, 1);
    assert.equal((await db.one("select count(*)::int as n from mkt_leads where phone = '9876500001'")).n, 1);
    assert.equal(((await db.one("select note from mkt_leads where phone = '9820000001' and name = 'Rahul'")).note.match(/Came again from Meta/g) || []).length, 1);
  });

  await step('The 12-month report: months, organic figures per network, campaigns with spend and per-lead cost; pictures through our own address', async () => {
    const r = await rupali('/api/marketing?report=company');
    assert.equal(r.months.length, 12);
    assert.ok(r.organic.some((x) => x.network === 'youtube' && +x.metrics.views === 3000));
    assert.ok(r.organic.some((x) => x.network === 'instagram' && x.metrics.views > 0));
    const c = r.campaigns.find((x) => x.name === 'Dream Signature 2BHK leads'); assert.equal(+c.spend, 30001.5); assert.equal(+c.ad_leads, 120); assert.equal(c.crm_leads, 1);
    assert.equal(r.adMonths.length, 3);
    const p = await fetch(BASE + '/api/marketing?img=instagram:m1', { headers: { Cookie: (await (async () => { const x = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ action: 'login', username: 'rupali', password: 'pass-word-123' }) }); return x.headers.get('set-cookie').split(';')[0]; })()) } });
    assert.equal(p.status, 200); assert.equal(p.headers.get('content-type'), 'image/jpeg');
    assert.equal((await rupali('/api/marketing?img=instagram:../etc')).status, 404);
  });

  await step('Connecting without the Instagram permissions still connects the page and ads; a failed try is shown in Set-up', async () => {
    global.noIg = true;
    const st = new URL((await rupali('/api/marketing?connect=meta')).location).searchParams.get('state');
    const back = await rupali(`/oauth/meta?code=good&state=${encodeURIComponent(st)}`);
    assert.match(decodeURIComponent(back.location), /Connected: 1 Facebook page\(s\), 0 Instagram, 1 ad account/);
    global.noIg = false;
    const st2 = new URL((await rupali('/api/marketing?connect=meta')).location).searchParams.get('state');
    const bad = await rupali(`/oauth/meta?code=wrong&state=${encodeURIComponent(st2)}`);
    assert.match(decodeURIComponent(bad.location), /bad code/);
    const g = await rupali('/api/marketing?scope=company');
    assert.equal(g.social.meta.connected, true); assert.match(g.social.meta.lastFail.message, /bad code/);
  });

  await step('Every box on the Overview opens its rows: followers, views, reach, content, leads, cost per lead', async () => {
    for (const per of ['d30', 'ytd']) for (const k of ['followers', 'views', 'reach', 'posts', 'leads', 'spend', 'cpl']) { const r = await rupali(`/api/marketing?mdrill=${k}&scope=company&period=${per}`); assert.equal(r.status, 200, k + ' ' + r.error); assert.ok(r.columns.length && Array.isArray(r.rows), k); }
    const P = (await rupali('/api/marketing?scope=company')).periods;
    assert.equal(P.d30.spend, 92000); // 2 days of Meta spend + the Diwali drive typed in assert.equal(P.d30.adLeads, 8); assert.equal(P.d30.chats, 2); // the day 40 days ago is outside
    assert.ok(P.ytd.spend >= P.d30.spend); assert.ok(P.ytd.views > 0);
    const sp = await rupali('/api/marketing?mdrill=spend&scope=company&period=d30'); assert.equal(+sp.rows.find((r) => r.name === 'Dream Signature 2BHK leads').spend, 2000);
    assert.ok((await rupali('/api/marketing?mdrill=posts&scope=company')).rows.some((x) => x.caption === 'Rooftop pool reel'));
    assert.ok((await rupali('/api/marketing?mdrill=cpl&scope=company')).rows.some((x) => x.name === 'Dream Signature 2BHK leads' && x.cpl === 250));
    const g = await rupali('/api/marketing?scope=company'); assert.equal(g.channels.find((c) => c.network === 'instagram').viewsBefore, null); // no 30 days before to compare with
    const ix = g.channels.findIndex((c) => c.network === 'facebook'); assert.equal(g.channels[ix + 1].network, 'whatsapp'); assert.equal(g.channels[ix + 1].wa.year, 36);
    for (const k of ['wachats', 'waleads']) assert.equal((await rupali(`/api/marketing?mdrill=${k}&scope=company`)).status, 200);
  });

  await step('A campaign: brief, designs and budget; sent for approval; approved from the email link; designs scheduled and posted to Instagram and Facebook', async () => {
    // (Facebook and Instagram are connected again for this step)
    const st = new URL((await rupali('/api/marketing?connect=meta')).location).searchParams.get('state'); await rupali(`/oauth/meta?code=good&state=${encodeURIComponent(st)}`);
    const c = await M(rupali, 'campaign.save', { name: 'Diwali site visits', brief: 'Site visits this weekend, 2 BHK offer', projectId: sig.id, channels: ['instagram', 'facebook', 'linkedin'], startOn: '2026-11-01', endOn: '2026-11-15', dailyBudget: '2,000', monthlyBudget: '60000' });
    assert.equal(c.ok, true);
    assert.equal((await M(rupali, 'campaign.submit', { id: c.id })).status, 400); // no design yet
    const p = await M(rupali, 'post.save', { title: 'Diwali offer', channels: ['instagram', 'facebook', 'linkedin'], status: 'draft', projectId: sig.id, campaignId: c.id, caption: 'Visit Dream Signature', publishAt: new Date(Date.now() - 60000).toISOString() });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    await M(rupali, 'post.file', { postId: p.id, name: 'offer.png', mime: 'image/png', data: png });
    assert.equal((await M(rupali, 'campaign.submit', { id: c.id })).ok, true);
    let g = await rupali('/api/marketing?scope=company'); assert.equal(g.campaigns.find((x) => x.id === c.id).plan_status, 'submitted'); assert.equal(g.posts.find((x) => x.id === p.id).status, 'review');
    assert.equal((await M(rupali, 'campaign.approve', { id: c.id, kind: 'both' })).status, 403);
    // the email's link: opening it shows a page and changes nothing; Confirm approves
    const F = require('../lib/mkt-flow'), sam = await db.one("select id from users where username = 'sameer'");
    const tok = await F.sign({ c: c.id, k: 'designs', u: sam.id, e: Date.now() + 864e5 });
    const view = await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(tok)); assert.equal(view.status, 200); assert.match(await view.text(), /Approve the designs/);
    assert.equal((await db.one('select designs_ok_at from mkt_campaigns where id = $1', [c.id])).designs_ok_at, null);
    const ok = await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(tok), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: '' });
    assert.match(await ok.text(), /Approved/);
    assert.match(await (await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(tok.slice(0, -2) + 'xx'))).text(), /expired/);
    g = await rupali('/api/marketing?scope=company'); assert.equal(g.campaigns.find((x) => x.id === c.id).plan_status, 'partly');
    // nothing is posted until the budget is approved too
    assert.equal((await F.publishDue()).posted, 0);
    assert.equal((await M(sameer, 'campaign.approve', { id: c.id, kind: 'budget' })).ok, true);
    g = await rupali('/api/marketing?scope=company'); assert.equal(g.campaigns.find((x) => x.id === c.id).plan_status, 'approved'); assert.equal(g.posts.find((x) => x.id === p.id).status, 'scheduled');
    global.posted = [];
    const r = await F.publishDue(); assert.equal(r.posted, 1);
    const after = await db.one('select status, post_url, publish_log from mkt_posts where id = $1', [p.id]);
    assert.equal(after.status, 'published'); assert.equal(after.publish_log.instagram.id, 'igm9'); assert.equal(after.publish_log.facebook.id, 'p1_99'); assert.equal(after.publish_log.linkedin.manual, true);
    assert.equal(global.posted.length, 2); assert.match(global.posted[0].fb || global.posted[1].fb, /api\/marketing\?pub=/);
    const pubUrl = new URL(global.posted.find((x) => x.ig).ig); const img = await fetch(BASE + pubUrl.pathname + pubUrl.search); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await F.publishDue()).posted, 0); // not twice
    // a changed budget goes back for approval
    await M(rupali, 'campaign.save', { id: c.id, name: 'Diwali site visits', projectId: sig.id, channels: ['instagram'], dailyBudget: '3000', monthlyBudget: '60000' });
    assert.equal((await db.one('select plan_status, budget_ok_at from mkt_campaigns where id = $1', [c.id])).budget_ok_at, null);
    assert.equal((await M(sameer, 'campaign.sendback', { id: c.id, note: 'Too costly' })).ok, true);
    const A = await rupali('/api/marketing?active=1&scope=company');
    const m = A.rows.find((x) => x.name === 'Dream Signature 2BHK leads'); assert.equal(m.spend30, 2000); assert.equal(m.yesterday, 1000); assert.ok(A.totals.spend30 >= 2000);
    assert.equal((await rupali(`/api/marketing?mdrill=campaign&period=c${m.id}&scope=company`)).rows.length, 3);
  });

  await step('Disconnecting keeps the figures already pulled; each part remembers its 12-month pull', async () => {
    const c = (await db.one("select value from settings where key = 'social'")).value;
    assert.equal((await M(rupali, 'disconnect', { net: 'meta' })).ok, true);
    const g = await rupali('/api/marketing?scope=company'); assert.equal(g.social.meta.connected, false); assert.equal(g.channels.find((x) => x.network === 'instagram').followers, 2040);
    assert.ok(c.youtube.backfilled.youtube); assert.equal(c.meta.backfilled, null); // a new connection pulls its 12 months again
  });

  await step('The design library says when no Drive folder is linked, and keeps a pasted folder link as its ID', async () => {
    assert.equal((await rupali(`/api/marketing?library=${sig.id}`)).folder, null);
    await M(rupali, 'settings', { drive: { [sig.id]: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing' } });
    const s = (await rupali('/api/marketing?scope=company')).settings; assert.equal(s.drive[sig.id], '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  });

  console.log(`\n${n} marketing checks passed.`);
  fake.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
