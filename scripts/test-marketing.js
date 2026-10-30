// Marketing & social media: who sees it, posts and approval, leads (typed, duplicate, from the website link, matched to a
// booking), campaigns, tasks, figures typed in and pulled from Metricool (a fake Metricool on a local port).
// DATABASE_URL=postgres://... node scripts/test-marketing.js   (an empty database)
const assert = require('assert/strict');
const http = require('http');
process.env.PORT = process.env.PORT || '3995';
const calls = [];
const fake = http.createServer((req, res) => {
  calls.push(req.url); res.setHeader('Content-Type', 'application/json');
  if (req.headers['x-mc-auth'] !== 'tok') { res.statusCode = 401; return res.end('{"message":"bad token"}'); }
  if (req.url.startsWith('/api/admin/simpleProfiles')) return res.end(JSON.stringify([{ id: 7118271, label: 'Dream India Group', instagram: 'dreamindiarealty', facebook: 'Dream India Realty' }]));
  const u = new URL(req.url, 'http://x'), m = u.searchParams.get('metric');
  const day = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10) + 'T00:00:00';
  const val = { followers: 2000, fbFollowers: 500, views: 1000, pageMediaView: 300 }[m] ?? 7;
  return res.end(JSON.stringify({ data: [{ metric: m, values: [0, 1, 2].map((k) => ({ dateTime: day(k), value: val + k })) }] }));
}).listen(2539);
Object.assign(process.env, { METRICOOL_API: 'http://127.0.0.1:2539/api', METRICOOL_TOKEN: 'tok' });
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, noOrigin) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', ...(noOrigin ? {} : { Origin: BASE }) } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
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
    assert.equal(g.channels.length, 1); assert.equal(g.channels[0].handle, 'dreamindiarealty');
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

  await step('Tasks and figures typed by hand', async () => {
    assert.equal((await M(rupali, 'task.save', { title: 'Shoot sample flat', due: '2026-11-02' })).ok, true);
    const t = (await rupali('/api/marketing?scope=company')).tasks[0]; assert.equal((await M(rupali, 'task.done', { id: t.id })).ok, true);
    assert.equal((await M(rupali, 'stats.save', { network: 'youtube', day: new Date().toISOString().slice(0, 10), followers: '120', views: '5,000' })).ok, true);
    assert.equal((await M(rupali, 'settings', { channels: [{ network: 'instagram', handle: 'dreamindiarealty' }, { network: 'youtube', handle: 'DreamIndiaRealty' }] })).ok, true);
    const yt = (await rupali('/api/marketing?scope=company')).channels.find((c) => c.network === 'youtube'); assert.equal(yt.followers, 120); assert.equal(yt.views, 5000);
  });

  await step('Metricool: every figure of the connected networks pulled into the daily figures, again without doubling', async () => {
    const r = await M(rupali, 'sync');
    assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.networks.sort(), ['facebook', 'instagram']); assert.equal(r.errors.length, 0);
    assert.ok(calls.some((c) => c.includes('/v2/analytics/timelines') && c.includes('metric=followers') && c.includes('network=instagram') && c.includes('blogId=7118271')));
    const ig = await db.one("select metrics from mkt_stats where network = 'instagram' order by day desc limit 1");
    assert.equal(ig.metrics.followers, 2000); assert.equal(ig.metrics.views, 1000);
    await M(rupali, 'sync');
    assert.equal((await db.one("select count(*)::int as n from mkt_stats where network = 'instagram'")).n, 3);
    const g = await rupali('/api/marketing?scope=company'); assert.equal(g.channels.find((c) => c.network === 'instagram').followers, 2000);
    assert.ok(g.metricool.lastSync);
  });

  await step('The design library says when no Drive folder is linked, and keeps a pasted folder link as its ID', async () => {
    assert.equal((await rupali(`/api/marketing?library=${sig.id}`)).folder, null);
    await M(rupali, 'settings', { drive: { [sig.id]: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing' } });
    const s = (await rupali('/api/marketing?scope=company')).settings; assert.equal(s.drive[sig.id], '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  });

  console.log(`\n${n} marketing checks passed.`);
  fake.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
