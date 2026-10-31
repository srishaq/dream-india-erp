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
  // Canva, Claude (captions), Google Ads, and Meta's Conversions API
  if (P === '/canva/oauth/token') { const f = new URLSearchParams(body); if (req.headers.authorization !== 'Basic ' + Buffer.from('cv1:cvs').toString('base64')) return J({ error: 'invalid_client' }, 401); return J(f.get('grant_type') === 'authorization_code' && !f.get('code_verifier') ? { error: 'pkce' } : { access_token: 'CA', refresh_token: 'CR', expires_in: 3600 }); }
  if (P.startsWith('/canva/') && req.headers.authorization !== 'Bearer CA') return J({ message: 'unauthorised' }, 401);
  if (P === '/canva/users/me/profile') return J({ profile: { display_name: 'Rupali' } });
  if (P === '/canva/designs') return J({ items: [{ id: 'D1', title: 'Signature Diwali post', thumbnail: { url: 'http://127.0.0.1:2539/pic.jpg' }, urls: { edit_url: 'https://www.canva.com/design/D1/edit' }, updated_at: 1761900000, page_count: 1 }] });
  if (P === '/canva/exports' && req.method === 'POST') { global.canvaExport = JSON.parse(body); return J({ job: { id: 'E1', status: 'in_progress' } }); }
  if (P === '/canva/exports/E1') return J({ job: { id: 'E1', status: 'success', urls: ['http://127.0.0.1:2539/pic.jpg'] } });
  if (P === '/claude/v1/messages') { global.claudeAsk = JSON.parse(body); return J({ content: [{ type: 'text', text: 'Here you go: ' + JSON.stringify({ options: ['Wake up to the skyline. Book a site visit today. MahaRERA No.: P51800012345 | maharera.maharashtra.gov.in', 'Two', 'Three'] }) }] }); }
  if (P.startsWith('/gads/v21/customers/1234567890/googleAds:search')) {
    if (req.headers['developer-token'] !== 'devtok' || req.headers.authorization !== 'Bearer YT2') return J({ error: { message: 'denied' } }, 401);
    return J({ results: [1, 2, 50].map((k) => ({ campaign: { id: '77', name: 'Signature search', status: 'ENABLED', advertisingChannelType: 'SEARCH', startDate: iso(60) }, segments: { date: iso(k) }, metrics: { costMicros: '1500000000', impressions: '1000', clicks: '50', conversions: '3' } })) });
  }
  if (P === '/graph/DS1/events') { global.capi = JSON.parse(body); return J({ events_received: global.capi.data.length }); }
  if (!P.startsWith('/graph')) return J({ error: { message: 'unknown' } }, 404);
  const g = P.slice(6), tok = q.get('access_token');
  if (g === '/oauth/access_token') return J(q.get('fb_exchange_token') ? { access_token: 'LONG', expires_in: 5184000 } : q.get('code') === 'good' ? { access_token: 'SHORT' } : { error: { message: 'bad code' } }, q.get('fb_exchange_token') || q.get('code') === 'good' ? 200 : 400);
  if (!tok || !q.get('appsecret_proof')) return J({ error: { message: 'token missing' } }, 400);
  const series = (val) => { const out = []; for (let d = q.get('since'); d < q.get('until'); d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) out.push({ value: val, end_time: new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10) + 'T07:00:00+0000' }); return out; };
  if (g === '/me/permissions') return J({ data: [{ permission: 'leads_retrieval', status: 'granted' }, { permission: 'pages_manage_ads', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] });
  if (g === '/me') return J({ id: 'u1', name: 'Rafi' });
  if (g === '/act_9/insights' && q.get('level') === 'ad') return J({ data: [1, 2, 3, 4, 5, 6, 10, 12, 14].flatMap((k) => [
    { ad_id: 'a1', ad_name: 'Rooftop pool ad', adset_name: 'Mumbai 25-45', campaign_id: 'c1', spend: '600', impressions: '4000', reach: '900', frequency: k < 7 ? '4.4' : '1.5', clicks: k < 7 ? '8' : '60', actions: [{ action_type: 'lead', value: '1' }], date_start: iso(k) },
    { ad_id: 'a2', ad_name: 'Sample flat ad', adset_name: 'Mumbai 25-45', campaign_id: 'c1', spend: '400', impressions: '2000', reach: '1500', frequency: '1.3', clicks: '40', actions: [{ action_type: 'lead', value: '3' }], date_start: iso(k) }]) });
  if (g === '/' && q.get('ids')) return J(Object.fromEntries(q.get('ids').split(',').map((id) => [id, { id, name: id === 'a1' ? 'Rooftop pool ad' : 'Sample flat ad', effective_status: 'ACTIVE', adset: { name: 'Mumbai 25-45' }, creative: { image_url: 'http://127.0.0.1:2539/pic.jpg', body: 'Live above the clouds' } }])));
  if (g === '/m1/comments') return J({ data: [{ id: 'cm1', text: 'Price for 2 BHK please? 9822211111', username: 'rohan', timestamp: iso(1) + 'T10:00:00+0000' }, { id: 'cm2', text: 'Thank you!', username: 'dreamindiarealty', timestamp: iso(1) + 'T11:00:00+0000' }] });
  if (g === '/p1_1/comments') return J({ data: [{ id: 'fc1', message: 'Nice project', from: { id: 'u9', name: 'Neha' }, created_time: iso(2) + 'T10:00:00+0000' }] });
  if (req.method === 'POST' && g === '/cm1/replies') { global.replied = q.get('message'); return J({ id: 'r1' }); }
  if (g === '/c1' && req.method === 'POST') { global.metaChange = (global.metaChange || []).concat([Object.fromEntries([...q].filter(([k]) => ['status', 'daily_budget'].includes(k)))]); return J({ success: true }); }
  if (g === '/c1') return J({ id: 'c1', daily_budget: '200000' });
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
    assert.match((await db.one("select note from mkt_leads where phone = '9820000001' and name = 'Rahul'")).note, /Came again from Meta ads.*Meta lead form/);
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
    { // "Approve both" from a mail app or app window: it sends Origin: null and no body
      const c2 = await M(rupali, 'campaign.save', { name: 'Both at once', channels: ['instagram'], dailyBudget: '500', monthlyBudget: '15000' });
      const p2 = await M(rupali, 'post.save', { title: 'Both', channels: ['instagram'], status: 'draft', campaignId: c2.id, publishAt: new Date(Date.now() + 864e5).toISOString() });
      await M(rupali, 'post.file', { postId: p2.id, name: 'b.png', mime: 'image/png', data: png });
      assert.equal((await M(rupali, 'campaign.submit', { id: c2.id })).ok, true);
      const t2 = await F.sign({ c: c2.id, k: 'both', u: sam.id, e: Date.now() + 864e5 });
      const r2 = await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(t2), { method: 'POST', headers: { Origin: 'null' } });
      const tx = await r2.text(); assert.equal(r2.status, 200, tx); assert.match(tx, /designs approved ✓ · budget approved ✓/);
      const r3 = await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(t2), { method: 'POST', headers: { Origin: 'https://evil.example' } }); assert.match(await r3.text(), /Not allowed/);
      await M(sameer, 'campaign.delete', { id: c2.id });
    }
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

  await step('Ads one by one come in with their pictures; a tiring ad is flagged; comments come into the Inbox and are answered', async () => {
    assert.equal((await M(rupali, 'sync', { part: 'ads' })).ok, true);
    const camp = await db.one("select id from mkt_campaigns where ext_id = 'meta:c1'");
    const A = await rupali('/api/marketing?ads=' + camp.id);
    assert.equal(A.ads.length, 2); const a1 = A.ads.find((a) => a.name === 'Rooftop pool ad'), a2 = A.ads.find((a) => a.name === 'Sample flat ad');
    assert.ok(a1.has_thumb); assert.ok(a1.tiring && a1.tiring.some((w) => /seen 4\.4 times/.test(w)), JSON.stringify(a1.tiring)); assert.equal(a2.tiring, null);
    assert.ok(a2.cpl30 < a1.cpl30); // the sample flat ad brings cheaper leads
    const pic = await fetch(BASE + '/api/marketing?adimg=' + a1.id, { headers: {} }); assert.equal(pic.status, 401); // signed in only
    const ctl = await rupali('/api/marketing?controls=1'); assert.ok(ctl.tiring.some((t) => t.name === 'Rooftop pool ad'));
    assert.equal((await M(rupali, 'sync', { part: 'comments' })).ok, true);
    const I = await rupali('/api/marketing?inbox=1');
    assert.equal(I.rows.length, 2); assert.ok(!I.rows.some((r) => r.author === 'dreamindiarealty')); // our own replies are left out
    const hot = I.rows.find((r) => r.ext_id === 'cm1'); assert.equal(hot.hot, true);
    assert.equal((await M(rupali, 'comment.reply', { network: 'instagram', extId: 'cm1', text: 'Thank you Rohan, we have sent you a DM.' })).ok, true); assert.match(global.replied, /Rohan/);
    const L = await M(rupali, 'comment.lead', { network: 'instagram', extId: 'cm1', phone: '' }); assert.equal(L.ok, true);
    assert.equal((await db.one('select source, phone from mkt_leads where id = $1', [L.id])).phone, '9822211111');
  });

  await step('A Meta campaign is paused only after Management approves (from the email link); Management changes a budget at once', async () => {
    const camp = await db.one("select id from mkt_campaigns where ext_id = 'meta:c1'");
    assert.equal((await M(crm, 'change.request', { campaignId: camp.id, kind: 'pause' })).status, 403);
    const r = await M(rupali, 'change.request', { campaignId: camp.id, kind: 'pause', reason: 'cost per lead too high' }); assert.equal(r.pending, true);
    assert.equal(global.metaChange, undefined); // nothing on Meta yet
    assert.equal((await rupali('/api/marketing?controls=1')).changes.filter((x) => x.status === 'pending').length, 1);
    const F = require('../lib/mkt-flow'), sam = await db.one("select id from users where username = 'sameer'");
    const tok = await F.sign({ r: r.id, k: 'change', u: sam.id, e: Date.now() + 864e5 });
    assert.match(await (await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(tok))).text(), /Pause Dream Signature 2BHK leads/);
    assert.equal(global.metaChange, undefined);
    const ok = await fetch(BASE + '/api/marketing?approve=' + encodeURIComponent(tok), { method: 'POST', headers: { Origin: 'null' } }); assert.match(await ok.text(), /Done/);
    assert.deepEqual(global.metaChange, [{ status: 'PAUSED' }]);
    assert.equal((await db.one('select ext_status from mkt_campaigns where id = $1', [camp.id])).ext_status, 'PAUSED');
    const b = await M(sameer, 'change.request', { campaignId: camp.id, kind: 'budget', value: '2,500' }); assert.equal(b.status, 'done', JSON.stringify(b));
    assert.deepEqual(global.metaChange[1], { daily_budget: '250000' });
    assert.equal((await M(rupali, 'change.request', { campaignId: camp.id, kind: 'budget', value: '50' })).status, 400);
  });

  await step('Results: every rupee (ads, hoardings, portals) against leads, site visits and bookings, by project, source and campaign', async () => {
    assert.equal((await M(rupali, 'spend.save', { kind: 'hoarding', amount: '50,000', spentOn: iso(5), projectId: sig.id, vendor: 'Bright Outdoor', note: 'Link Road' })).ok, true);
    const png = Buffer.from('%PDF-1.4 test').toString('base64');
    const p2 = await M(rupali, 'spend.save', { kind: 'portal', source: '99acres', amount: '20000', spentOn: iso(3), projectId: sig.id, vendor: '99acres', file: { name: 'inv.pdf', mime: 'application/pdf', data: png } }); assert.equal(p2.ok, true);
    assert.equal((await M(rupali, 'spend.save', { kind: 'hoarding', amount: '1', spentOn: 'soon' })).status, 400);
    assert.equal((await M(crm, 'spend.save', { kind: 'hoarding', amount: '1', spentOn: iso(1) })).status, 403);
    // a buyer who came as a lead before booking
    const b = await db.one("select right(regexp_replace(y.phone, '\\D', '', 'g'), 10) as p, bk.booking_date, bk.agreement_value from buyers y join booking_applicants a on a.buyer_id = y.id join bookings bk on bk.id = a.booking_id where bk.status = 'active' and y.phone is not null order by bk.id limit 1");
    await db.q('delete from mkt_leads where phone = $1', [b.p]);
    await db.q("insert into mkt_leads (project_id, name, phone, source, sources, status, created_at) values ($1, 'Buyer lead', $2, '99acres', '{99acres}', 'contacted', $3::date - 10)", [sig.id, b.p, b.booking_date]);
    const R = await rupali(`/api/marketing?results=company&period=all`);
    assert.ok(R.totals.spend >= 70000 + 30001.5, R.totals.spend); assert.ok(R.totals.bookings >= 1); assert.ok(R.totals.value >= +b.agreement_value);
    const pj = R.byProject.find((x) => x.id === sig.id); assert.ok(pj.spend >= 70000); assert.ok(pj.all_bookings >= 1); assert.ok(pj.cpb > 0);
    const acres = R.bySource.find((x) => x.source === '99acres'); assert.equal(acres.spend, 20000); assert.equal(acres.bookings, 1); assert.equal(acres.cpb, 20000);
    assert.ok(R.campaigns.find((c) => c.name === 'Dream Signature 2BHK leads').spend > 0);
    assert.equal(R.entries.length, 2);
    const D = await rupali(`/api/marketing?rdrill=bookings&scope=company&period=all`); assert.ok(D.rows.some((r) => r.name === 'Buyer lead' && r.value > 0));
    assert.equal((await fetch(BASE + '/api/marketing?spendfile=' + p2.id)).status, 401);
    assert.equal((await M(rupali, 'budgets.save', { budgets: { [sig.id]: '1,00,000' } })).status, 403);
    assert.equal((await M(sameer, 'budgets.save', { budgets: { [sig.id]: '1,00,000' } })).ok, true);
    const Y = await rupali(`/api/marketing?results=${sig.id}&period=fy`); assert.equal(Y.byProject.find((x) => x.id === sig.id).budget, 100000);
  });

  await step('One number, one lead: from any source; given to sales in turn; first call timed; chased after 2 hours; portals and WhatsApp', async () => {
    const s1 = await db.one("insert into users (username, name, role, password_hash, email) values ('s1', 'Sales One', 'sales', 'x', 's1@x.in') returning id");
    const s2 = await db.one("insert into users (username, name, role, password_hash, email) values ('s2', 'Sales Two', 'sales', 'x', 's2@x.in') returning id");
    assert.equal((await M(rupali, 'follow.save', { people: { company: [s1.id, s2.id] }, alertHours: 2, template: 'T1' })).ok, true);
    const key = (await db.one("select value from settings where key = 'marketing'")).value.leadKey;
    const post = (b) => fetch(BASE + '/api/marketing?lead=' + key, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() }).then((r) => r.json());
    const a = await post({ name: 'Web One', phone: '9700000001', utm_source: 'facebook', utm_campaign: 'Dream Signature 2BHK leads', page: 'https://dreamindiarealty.com/signature' });
    const c = await post({ name: 'Web Two', phone: '9700000002' });
    const la = await db.one('select * from mkt_leads where id = $1', [a.id]), lc = await db.one('select * from mkt_leads where id = $1', [c.id]);
    assert.equal(la.source, 'meta_ads'); assert.ok(la.campaign_id); assert.equal(la.utm.utm_source, 'facebook');
    assert.notEqual(la.assigned_to, lc.assigned_to); assert.ok([s1.id, s2.id].includes(la.assigned_to) && [s1.id, s2.id].includes(lc.assigned_to));
    const again = await post({ name: 'Web One', phone: '9700000001', source: 'magicbricks' }); assert.equal(again.duplicate, true); assert.equal(again.id, a.id);
    assert.deepEqual((await db.one('select array_to_json(sources) as s from mkt_leads where id = $1', [a.id])).s, ['meta_ads', 'magicbricks']);
    assert.deepEqual((await rupali('/api/marketing?scope=company')).leads.find((l) => l.id === a.id).sources, ['meta_ads', 'magicbricks']);
    await db.q("update mkt_leads set status = 'lost' where id = $1", [c.id]);
    await post({ phone: '9700000002', source: 'ivr' }); assert.equal((await db.one('select status from mkt_leads where id = $1', [c.id])).status, 'new'); // came back: open again
    assert.equal((await M(rupali, 'lead.contact', { id: a.id, outcome: 'visit', note: 'Sunday visit' })).status, 'visit');
    const ac = await db.one('select first_contact_at, visit_at, note from mkt_leads where id = $1', [a.id]); assert.ok(ac.first_contact_at && ac.visit_at); assert.match(ac.note, /site visit — Sunday visit/);
    await db.q("update mkt_leads set created_at = now() - interval '3 hours', alerted_at = null where id = $1", [c.id]);
    const L = require('../lib/mkt-leads'), h = new Date(Date.now() + 5.5 * 3600e3).getUTCHours(), od = await L.overdue({});
    if (h >= 9 && h < 21) { assert.ok(od.sent >= 1, JSON.stringify(od)); assert.ok((await db.one('select alerted_at from mkt_leads where id = $1', [c.id])).alerted_at); assert.equal((await L.overdue({})).sent, 0); } else assert.ok(od.waiting);
    const P = L.parsePortal({ from: 'leads@99acres.com', subject: 'New response for Dream Signature', text: 'Dear Advertiser,\nName: Kavita Rao\nMobile: +91-98190 12345\nEmail: kavita@example.com\nProject: Dream Signature, Oshiwara\nMessage: Need 2 BHK' });
    assert.deepEqual([P.portal, P.name, P.phone, P.email], ['99acres', 'Kavita Rao', '9819012345', 'kavita@example.com']);
    const pl = await L.portalLead({ from: 'leads@99acres.com', subject: 'New response for Dream Signature', text: 'Name: Kavita Rao\nMobile: 9819012345\nProject: Dream Signature', id: '<m1@99acres>' });
    const kv = await db.one('select source, project_id from mkt_leads where id = $1', [pl.id]); assert.equal(kv.source, '99acres'); assert.equal(kv.project_id, sig.id);
    assert.equal(L.parsePortal({ from: 'friend@gmail.com', subject: 'Lunch?', text: 'Call me 9819012345' }), null);
    const w = await L.whatsappIn({ phone: '919755500001', name: 'Imran', text: 'Hi, details of Signature please' }); assert.ok(w.id);
    assert.equal((await db.one('select source, project_id from mkt_leads where id = $1', [w.id])).source, 'whatsapp');
    const buyer = await db.one("select phone from buyers where phone is not null limit 1"); if (buyer) assert.equal(await L.whatsappIn({ phone: buyer.phone, text: 'about my demand letter' }), null);
    const walk = await M(rupali, 'lead.save', { name: 'Walk-in Mehta', phone: '9700000009', source: 'walk_in', status: 'visit', projectId: sig.id }); assert.equal(walk.ok, true);
    const wk = await db.one('select visit_at, first_contact_at from mkt_leads where id = $1', [walk.id]); assert.ok(wk.visit_at && wk.first_contact_at);
  });

  await step('Lead stages go back to Meta (Conversions API for CRM) once its dataset is set', async () => {
    const L = require('../lib/mkt-leads');
    const r = await L.add({ name: 'Form lead', phone: '9700000011', source: 'meta_ads', ext: 'meta:1234567890', at: new Date(Date.now() - 864e5) });
    await M(rupali, 'lead.contact', { id: r.id }); await M(rupali, 'lead.contact', { id: r.id, outcome: 'visit' });
    assert.equal((await db.one('select count(*)::int as n from mkt_capi where lead_id = $1', [r.id])).n, 2);
    assert.ok((await L.capi({})).skipped); // not set up yet
    Object.assign(process.env, { META_DATASET_ID: 'DS1', META_CAPI_TOKEN: 'capitok' });
    const s = await L.capi({}); assert.equal(s.sent, 2, JSON.stringify(s));
    assert.deepEqual(global.capi.data.map((x) => x.event_name), ['Contacted', 'Site visit']); assert.equal(global.capi.data[0].user_data.lead_id, 1234567890); assert.equal(global.capi.data[0].custom_data.event_source, 'crm'); assert.equal(global.capi.access_token, 'capitok');
    assert.equal(global.capi.data[0].user_data.ph[0].length, 64); // hashed, never the number itself
    assert.equal((await L.capi({})).sent, 0);
    delete process.env.META_DATASET_ID; delete process.env.META_CAPI_TOKEN;
  });

  await step('MahaRERA: a post for a registered project is not sent or posted without the number (or "on the design")', async () => {
    await db.q("update projects set rera_no = 'P51800012345' where id = $1", [sig.id]);
    const p = await M(rupali, 'post.save', { title: 'Sky lounge', channels: ['instagram'], status: 'draft', projectId: sig.id, caption: 'Come home to the skyline' });
    const no = await M(rupali, 'post.send', { id: p.id }); assert.equal(no.status, 400); assert.match(no.error, /MahaRERA number of Dream Signature/);
    await M(rupali, 'post.save', { id: p.id, title: 'Sky lounge', channels: ['instagram'], status: 'draft', projectId: sig.id, caption: 'Come home to the skyline. MahaRERA No. P51800012345' });
    assert.equal((await M(rupali, 'post.send', { id: p.id })).ok, true);
    const q2 = await M(rupali, 'post.save', { title: 'Lobby', channels: ['instagram'], status: 'draft', projectId: sig.id, caption: 'Lobby', reraOnDesign: true });
    assert.equal((await M(rupali, 'post.send', { id: q2.id })).ok, true);
  });

  await step('Canva: connected once, the team\'s designs listed, the chosen one exported and attached; captions drafted with the RERA line', async () => {
    assert.equal((await M(rupali, 'canva.disconnect', {})).ok, true);
    Object.assign(process.env, { CANVA_CLIENT_ID: 'cv1', CANVA_CLIENT_SECRET: 'cvs', CANVA_API: 'http://127.0.0.1:2539/canva', CANVA_AUTH: 'http://127.0.0.1:2539/cauth' });
    const go = await rupali('/api/marketing?connect=canva'); assert.equal(go.status, 302); const to = new URL(go.location);
    assert.equal(to.searchParams.get('code_challenge_method'), 's256', go.location); assert.equal(to.searchParams.get('redirect_uri'), BASE + '/oauth/canva');
    const back = await rupali(`/oauth/canva?code=cc&state=${encodeURIComponent(to.searchParams.get('state'))}`); assert.match(decodeURIComponent(back.location), /Canva connected: Rupali/);
    assert.ok(!JSON.stringify((await db.one("select value from settings where key = 'canva'")).value).includes('CR'), 'sealed');
    const L = await rupali('/api/marketing?canva=1'); assert.equal(L.items[0].title, 'Signature Diwali post');
    const p = await M(rupali, 'post.save', { title: 'Diwali', channels: ['instagram'], status: 'draft', projectId: sig.id });
    const im = await M(rupali, 'canva.import', { postId: p.id, designId: 'D1', type: 'png', editUrl: 'https://www.canva.com/design/D1/edit' }); assert.equal(im.added, 1, JSON.stringify(im));
    assert.deepEqual(global.canvaExport, { design_id: 'D1', format: { type: 'png' } });
    assert.equal((await db.one('select count(*)::int as n from mkt_post_files where post_id = $1', [p.id])).n, 1);
    const th = await rupali('/api/marketing?cimg=' + encodeURIComponent('https://evil.example/x.png')); assert.equal(th.status, 404);
    assert.equal((await M(rupali, 'caption.draft', { title: 'Diwali' })).status, 409);
    Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ANTHROPIC_API_URL: 'http://127.0.0.1:2539/claude' });
    const cp = await M(rupali, 'caption.draft', { title: 'Sky lounge', projectId: sig.id, language: 'hinglish', channels: ['instagram'] });
    assert.equal(cp.options.length, 3); assert.match(global.claudeAsk.messages[0].content, /MahaRERA No\.: P51800012345/); assert.match(global.claudeAsk.messages[0].content, /Hinglish/);
    delete process.env.ANTHROPIC_API_KEY;
  });

  await step('Google Ads: connected with the Google sign-in, its campaigns come in next to Meta', async () => {
    Object.assign(process.env, { GOOGLE_ADS_DEVELOPER_TOKEN: 'devtok', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ADS_API: 'http://127.0.0.1:2539/gads', GOOGLE_TOKEN_URL: 'http://127.0.0.1:2539/gtoken' });
    const go = await rupali('/api/marketing?connect=gads'); const st = new URL(go.location).searchParams.get('state'); assert.match(st, /^ga\./);
    assert.match(new URL(go.location).searchParams.get('scope'), /adwords/);
    const back = await rupali(`/oauth/google?code=g1&state=${encodeURIComponent(st)}`); assert.match(decodeURIComponent(back.location), /Google Ads connected/);
    const r = await M(rupali, 'gads.sync', { full: true }); assert.equal(r.campaigns, 1, JSON.stringify(r));
    const c = await db.one("select id, source, spent, ad_leads from mkt_campaigns where ext_id = 'gads:77'"); assert.equal(c.source, 'google'); assert.equal(+c.spent, 4500); assert.equal(c.ad_leads, 9);
    assert.equal((await db.one('select count(*)::int as n from mkt_campaign_days where campaign_id = $1', [c.id])).n, 2); // the last 40 days, day by day
    const R = await rupali('/api/marketing?results=company&period=all'); assert.ok(R.bySource.some((x) => x.source === 'google_ads' && x.spend === 4500));
  });

  await step('Money alerts and the Monday email are worked out (sent to the test address only)', async () => {
    const X = require('../lib/mkt-money');
    const a = await X.alerts({ force: true }); assert.ok(a.alerts >= 1, JSON.stringify(a)); // the tiring ad at least
    const d = await X.digest({ force: true }); assert.ok(d.mail);
    assert.equal((await M(rupali, 'alerts.run', {})).status, 403);
  });

  await step('Website: visits from the tracker (where from, pages, clicks), counted like a channel; its enquiry form becomes a lead with the ad that brought it', async () => {
    const key = (await db.one("select value from settings where key = 'marketing'")).value.leadKey;
    const hit = (b, ua) => fetch(BASE + '/api/marketing?hit=' + key, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...(ua ? { 'User-Agent': ua } : {}) }, body: JSON.stringify(b) });
    const r = await hit({ k: 'view', v: 'V1', s: 'S1', h: 'dreamindiarealty.com', p: '/dream-signature', t: 'Dream Signature | 2 BHK Oshiwara', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'signature-diwali', fbclid: 'x', w: 390 });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*');
    await hit({ k: 'view', v: 'V1', s: 'S1', p: '/floor-plans', t: 'Floor plans', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'signature-diwali', w: 390 });
    await hit({ k: 'whatsapp', v: 'V1', s: 'S1', p: '/floor-plans', l: 'https://wa.me/919800000000', utm_source: 'facebook', utm_medium: 'paid' });
    await hit({ k: 'view', v: 'V2', s: 'S2', p: '/', referrer: 'https://www.google.com/', w: 1400 });
    await hit({ k: 'view', v: 'V3', s: 'S3', p: '/' }, 'Googlebot/2.1');
    assert.equal((await fetch(BASE + '/api/marketing?hit=wrong', { method: 'POST', body: '{}' })).status, 403);
    const ch = (await db.q('select channel from mkt_web_hits order by id')).map((x) => x.channel);
    assert.deepEqual(ch, ['Meta Ads', 'Meta Ads', 'Meta Ads', 'Google search']); // the bot is not counted
    const lead = await fetch(BASE + '/api/marketing?lead=' + key, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'Site Visitor', phone: '9700000077', source: 'website', vid: 'V1', page: 'https://dreamindiarealty.com/dream-signature', project: 'Dream Signature | 2 BHK Oshiwara' }).toString() }).then((x) => x.json());
    const l = await db.one('select source, utm, project_id from mkt_leads where id = $1', [lead.id]);
    assert.equal(l.source, 'meta_ads'); assert.equal(l.utm.first_channel, 'Meta Ads'); assert.equal(l.utm.landing, '/dream-signature'); assert.equal(l.utm.utm_campaign, 'signature-diwali'); assert.equal(l.project_id, sig.id);
    await require('../api/marketing').webAggregate();
    const g = await rupali('/api/marketing?scope=company'), w = g.channels.find((c) => c.web);
    assert.equal(w.web.visitors, 2); assert.equal(w.web.views, 3); assert.equal(w.web.whatsapp, 1); assert.equal(w.web.mobile, 1);
    assert.ok(g.periods.d30.views >= 3);
    const S = await rupali('/api/marketing?mdrill=websources&scope=company'); const mr = S.rows.find((x) => x.channel === 'Meta Ads'); assert.equal(mr.views, 2); assert.equal(mr.clicks, 1);
    assert.equal((await rupali('/api/marketing?mdrill=webpages&scope=company')).rows.length, 3);
    const js = await fetch(BASE + '/t.js'); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  });

  await step('The set-up checklist shows what is done, from the ERP itself (permissions given, keys in, spend entered, website counting)', async () => {
    const K = await sameer('/api/marketing?checklist=1'), by = Object.fromEntries(K.items.map((x) => [x.key, x]));
    assert.equal(by.meta.done, false); assert.match(by.meta.detail, /ads_management/); assert.match(by.meta.detail, /Pause \/ budget changes/); assert.doesNotMatch(by.meta.detail, /leads_retrieval/);
    assert.equal(by.spend.done, true); assert.equal(by.website.done, true); assert.equal(by.portals.done, true); assert.equal(by.canva.done, true); assert.equal(by.capi.done, false);
  });

  await step('Disconnecting keeps the figures already pulled; each part remembers its 12-month pull', async () => {
    const c = (await db.one("select value from settings where key = 'social'")).value;
    assert.equal((await M(rupali, 'disconnect', { net: 'meta' })).ok, true);
    const g = await rupali('/api/marketing?scope=company'); assert.equal(g.social.meta.connected, false); assert.equal(g.channels.find((x) => x.network === 'instagram').followers, 2040);
    assert.ok(c.youtube.backfilled.youtube); assert.ok(c.meta.backfilled.ads); // each part remembers its first (12-month) pull
  });

  await step('The design library says when no Drive folder is linked, and keeps a pasted folder link as its ID', async () => {
    assert.equal((await rupali(`/api/marketing?library=${sig.id}`)).folder, null);
    await M(rupali, 'settings', { drive: { [sig.id]: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing' } });
    const s = (await rupali('/api/marketing?scope=company')).settings; assert.equal(s.drive[sig.id], '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  });

  console.log(`\n${n} marketing checks passed.`);
  fake.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
