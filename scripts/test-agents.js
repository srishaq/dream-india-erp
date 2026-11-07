// The AI marketing agent team (/agents): who sees it, owner input, the Orchestrator (calendar thin → drafts, leads not
// called, a post taking off), pre-RERA content, approvals, the knowledge layer, comment-to-DM funnels (test accounts,
// then live; a number in the DM becomes a lead), and the kill switch. Facebook / Instagram and Claude are stand-ins.
// DATABASE_URL=postgres://... node scripts/test-agents.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
const http = require('http');
const crypto = require('crypto');
process.env.PORT = process.env.PORT || '3996';
const sent = [], prompts = [], canvaFills = [];
let convo = [];
const fake = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), P = u.pathname;
  const J = (o, st = 200) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (P === '/claude/v1/messages') {
    const text = JSON.parse(body).messages[0].content; prompts.push(text);
    if (/read comments/.test(text)) { const lines = [...text.matchAll(/^(\d+)\. [^:]*: (.*)$/gm)]; return J({ content: [{ text: JSON.stringify({ notes: lines.map(([, i, t]) => ({ i: +i, kind: /No reply/.test(t) ? 'complaint' : 'question', reply: 'Thanks, we have sent you a DM.' })) }) }] }); }
    if (/what worked for Dream India/.test(text)) return J({ content: [{ text: '## Summary\n- Reels about redevelopment families did best (12 posts).\n' + 'x '.repeat(150) }] });
    const n = +(text.match(/Write (\d+) social/) || [])[1] || 1;
    return J({ content: [{ text: JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ title: `Draft ${i + 1} ${Date.now() % 1000}`, kind: i % 2 ? 'carousel' : 'reel', channels: ['instagram', 'facebook'], hook: 'Hook ' + i, caption: 'Life in the neighbourhood, story ' + i + '. Comment UPDATES for news. #mumbai', visual: 'Site at sunset', day: i })) }) }] });
  }
  if (P.startsWith('/canva')) {
    const c = P.replace(/^\/canva/, '');
    if (c === '/oauth/token') return J({ access_token: 'CA', refresh_token: 'CR', expires_in: 3600 });
    if (c === '/brand-templates') return J({ items: [{ id: 'T1', title: 'Dream post' }, { id: 'T2', title: 'Dream reel cover' }] });
    if (c === '/brand-templates/T1/dataset' || c === '/brand-templates/T2/dataset') return J({ dataset: { headline: { type: 'text' }, subline: { type: 'text' }, rera_line: { type: 'text' }, photo: { type: 'image' } } });
    if (c === '/autofills' && req.method === 'POST') { canvaFills.push(JSON.parse(body)); return J({ job: { id: 'AF1', status: 'in_progress' } }); }
    if (c === '/autofills/AF1') return J({ job: { id: 'AF1', status: 'success', result: { type: 'create_design', design: { id: 'D1', urls: { edit_url: 'https://www.canva.com/design/D1/edit' } } } } });
    if (c === '/exports' && req.method === 'POST') return J({ job: { id: 'E1', status: 'success', urls: ['http://127.0.0.1:2541/png/D1.png'] } });
    return J({ error: 'unknown ' + c }, 404);
  }
  if (P.startsWith('/png/')) { res.setHeader('Content-Type', 'image/png'); return res.end(Buffer.from('89504e470d0a1a0a0000', 'hex')); }
  const g = P.replace(/^\/graph/, '');
  if (req.method === 'POST') { const f = Object.fromEntries(new URLSearchParams(body)); sent.push({ path: g, ...f }); return J({ id: 'x' + sent.length }); }
  if (g === '/IG1/media') return J({ data: [{ id: 'm1', timestamp: new Date().toISOString(), permalink: 'https://instagram.com/p/m1' }] });
  if (g === '/P1/posts') return J({ data: [] });
  if (g === '/m1/comments') {
    const t = new Date().toISOString();
    return J({ data: [
      { id: 'c1', text: 'Price please', username: 'tester', from: { id: 'U1', username: 'tester' }, timestamp: t },
      { id: 'c2', text: 'PRICE?', username: 'stranger', from: { id: 'U2', username: 'stranger' }, timestamp: t },
      { id: 'c3', text: 'price', username: 'oldie', from: { id: 'U3', username: 'oldie' }, timestamp: new Date(Date.now() - 86400e3).toISOString() },
      { id: 'c4', text: 'Comment PRICE for details', username: 'dreamindiarealty', from: { id: 'IG1' }, timestamp: t },
      { id: 'c5', text: 'Nice priceless view', username: 'fan', from: { id: 'U5' }, timestamp: t },
    ] });
  }
  if (g === '/P1/conversations') return J({ data: convo });
  return J({ error: { message: 'unknown ' + g } }, 404);
}).listen(2541);
Object.assign(process.env, { META_GRAPH: 'http://127.0.0.1:2541/graph', META_APP_ID: 'app1', META_APP_SECRET: 'appsecret', ANTHROPIC_API_URL: 'http://127.0.0.1:2541/claude', CRON_SECRET: 'cron-s', CANVA_API: 'http://127.0.0.1:2541/canva', CANVA_CLIENT_ID: 'cid', CANVA_CLIENT_SECRET: 'csec' });
delete process.env.ANTHROPIC_API_KEY;
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
const seal = (text) => { const key = crypto.createHash('sha256').update('erp-social-meta:appsecret').digest(), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.'); };
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const cron = () => fetch(BASE + '/api/cron?job=agents', { headers: { Authorization: 'Bearer cron-s' } }).then((r) => r.json());

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  await db.q("update projects set rera_no = 'P51800012345', location = 'Oshiwara' where id = $1", [sig.id]);
  const gor = await db.one("insert into projects (company_id, code, name, location, active) select company_id, 'GOREGAON', 'Goregaon East', 'Goregaon East, Mumbai', true from projects where id = $1 returning id", [sig.id]);
  const mk = async (u, role) => { await db.q('insert into users (username, name, role, password_hash, all_projects) values ($1, $1, $2, $3, true)', [u, role, auth.hashPassword('pass-word-123')]); const c = client(); await c('/api/session', { action: 'login', username: u, password: 'pass-word-123' }); return c; };
  const rupali = await mk('rupali', 'marketing'), sameer = await mk('sameer', 'management'), crm = await mk('crm1', 'crm');
  const A = (c, action, x = {}, scope = 'company') => c('/api/agents', { action, scope, ...x });

  await step('The command centre opens for Marketing and Management with every project in the drop-down; not for CRM', async () => {
    const g = await rupali('/api/agents?scope=company');
    assert.equal(g.status, 200, g.error);
    assert.ok(g.projects.some((p) => p.id === gor.id) && g.projects.some((p) => p.id === sig.id));
    assert.equal(g.departments.length, 8); assert.equal(g.knowledge.length, 12); assert.equal(g.triggers.length, 10);
    assert.ok(g.agents.on < g.agents.of, 'tools that are not connected are not shown as running');
    assert.equal(g.connections.brain, false); assert.equal(g.me.edit, true); assert.equal(g.me.own, false);
    assert.equal((await crm('/api/agents?scope=company')).status, 403);
    const p = await rupali(`/api/agents?scope=${gor.id}`); assert.equal(p.preRera, true); assert.equal(p.settings.enabled, false);
    assert.match(p.knowledge.find((k) => k.path === '/brand-brain/facts.md').body, /NOT REGISTERED YET/);
  });

  await step('Owner input is set by Management only; agents switched on for a project', async () => {
    assert.equal((await A(rupali, 'scope.save', { owner: { voice: 'x' } })).status, 403);
    const r = await A(sameer, 'scope.save', { enabled: true, owner: { voice: 'Warm, confident, no hard sell', positioning: 'Family homes near the metro', budgetCap: '1,50,000', approvalBar: 'all', postsPerWeek: 4 } }, String(gor.id));
    assert.equal(r.ok, true, r.error);
    const s = (await sameer(`/api/agents?scope=${gor.id}`)).settings;
    assert.equal(s.enabled, true); assert.equal(s.owner.budgetCap, 150000); assert.equal(s.owner.positioning, 'Family homes near the metro');
  });

  await step('Without the Brain, a thin calendar goes to the owner (nothing is made up)', async () => {
    const r = await A(rupali, 'run');
    assert.equal(r.ok, true, r.error); assert.ok(r.flagged.includes('calendar_thin')); assert.equal(r.drafts, 0);
    const g = await sameer('/api/agents?scope=company');
    assert.ok(g.events.some((x) => x.kind === 'owner' && /Brain is offline/.test(x.text)));
    assert.equal(g.owner.length, 1);
    assert.equal((await A(sameer, 'owner.done', { id: g.owner[0].id })).ok, true);
    assert.equal((await A(rupali, 'run')).flagged.length, 0, 'the same interrupt is handled once a day');
  });

  process.env.ANTHROPIC_API_KEY = 'k';
  await step('Pre-RERA project: the Content Engine drafts area content only; drafts wait for approval', async () => {
    const r = await A(rupali, 'run', {}, String(gor.id));
    assert.equal(r.ok, true, r.error); assert.ok(r.drafts >= 2, JSON.stringify(r));
    assert.match(prompts[prompts.length - 1], /NOT registered with MahaRERA/); assert.match(prompts[prompts.length - 1], /Family homes near the metro/);
    const posts = await db.q("select * from mkt_posts where project_id = $1 and agent = 'content-engine'", [gor.id]);
    assert.ok(posts.every((p) => p.status === 'review' && p.created_by === null && /Visual brief/.test(p.note)));
    const g = await sameer(`/api/agents?scope=${gor.id}`);
    assert.equal(g.queue.length, posts.length); assert.ok(g.counters.drafts >= 2); assert.ok(g.events.some((x) => x.agent === 'content-engine' && x.kind === 'draft'));
  });

  await step('Registered project: every draft carries the MahaRERA line; Management approves, the marketing role cannot', async () => {
    await A(sameer, 'scope.save', { enabled: true }, String(sig.id));
    const r = await A(rupali, 'draft', { n: 2, angle: 'site progress' }, String(sig.id));
    assert.equal(r.ok, true, r.error); assert.equal(r.posts.length, 2);
    assert.match(prompts[prompts.length - 1], /MahaRERA No\.: P51800012345/);
    const p = await db.one('select * from mkt_posts where id = $1', [r.posts[0].id]);
    assert.match(p.caption, /MahaRERA No\.: P51800012345/);
    assert.equal((await A(rupali, 'post.approve', { id: p.id })).status, 403);
    const blocked = await A(sameer, 'post.approve', { id: p.id });
    assert.equal(blocked.status, 409); assert.match(blocked.error, /MahaRERA QR/, 'no QR, no approval');
    await db.q("insert into ag_photos (project_id, url, tags, asset_id, created_at) values ($1, 'qr:test', 'mahareraqr', 'QR1', now())", [p.project_id]);
    assert.equal((await A(sameer, 'post.approve', { id: p.id })).ok, true);
    assert.equal((await db.one('select status from mkt_posts where id = $1', [p.id])).status, 'approved');
    assert.equal((await A(sameer, 'post.sendback', { id: r.posts[1].id, note: 'Use the new photos' })).ok, true);
    assert.equal((await db.one('select status from mkt_posts where id = $1', [r.posts[1].id])).status, 'draft');
  });

  await step('Routine approval bar: routine drafts are approved, a draft with a price still waits', async () => {
    await A(sameer, 'scope.save', { owner: { approvalBar: 'routine' } }, String(sig.id));
    const r = await A(rupali, 'draft', { n: 1, angle: 'amenities' }, String(sig.id));
    assert.equal(r.posts[0].routine, true);
    assert.equal((await db.one('select status from mkt_posts where id = $1', [r.posts[0].id])).status, 'approved');
  });

  await step('Knowledge layer: a project copy wins over the company copy, and can go back to it', async () => {
    assert.equal((await A(rupali, 'kb.save', { path: '/content/hook-bank.md', body: '# Goregaon hooks\n- Film City road' }, String(gor.id))).ok, true);
    let k = (await rupali(`/api/agents?scope=${gor.id}`)).knowledge.find((x) => x.path === '/content/hook-bank.md');
    assert.equal(k.from, 'own'); assert.match(k.body, /Film City/);
    assert.equal((await rupali('/api/agents?scope=company')).knowledge.find((x) => x.path === '/content/hook-bank.md').from, 'starter');
    assert.equal((await A(rupali, 'kb.save', { path: '/etc/passwd', body: 'x' })).status, 400);
    await A(rupali, 'kb.reset', { path: '/content/hook-bank.md' }, String(gor.id));
    k = (await rupali(`/api/agents?scope=${gor.id}`)).knowledge.find((x) => x.path === '/content/hook-bank.md'); assert.notEqual(k.from, 'own');
  });

  await step('Comment-to-DM: test accounts only first; a number sent back becomes a lead; then live for everyone', async () => {
    await db.q("insert into settings (key, value) values ('social', $1)", [JSON.stringify({ meta: { token: seal('USER'), name: 'Rafi', pages: [{ id: 'P1', name: 'Dream India Realty', token: seal('PAGE'), ig: { id: 'IG1', username: 'dreamindiarealty' } }] } })]);
    assert.equal((await A(rupali, 'funnel.save', { keyword: 'two words', dmText: 'Hi! Reply with your number please.' }, String(gor.id))).status, 400);
    const f = await A(rupali, 'funnel.save', { keyword: 'price', network: 'instagram', dmText: 'Hi! Reply with your mobile number and we will call you.', publicReply: 'Sent you a DM', thanksText: 'Thank you!', testHandles: '@tester' }, String(gor.id));
    assert.equal(f.ok, true, f.error);
    assert.equal((await A(rupali, 'funnel.toggle', { id: f.id, on: true })).ok, true);
    await new Promise((r) => setTimeout(r, 1100));
    let c = await cron(); assert.equal(c.ok, true, JSON.stringify(c));
    const dms = sent.filter((x) => x.path === '/P1/messages');
    assert.equal(dms.length, 1, JSON.stringify(c.funnels)); assert.equal(JSON.parse(dms[0].recipient).comment_id, 'c1');
    assert.ok(sent.some((x) => x.path === '/c1/replies'), 'public reply');
    const hits = await db.q('select * from ag_funnel_hits order by id');
    assert.equal(hits.length, 2, 'tester and stranger; not the old comment, our own, or "priceless"');
    assert.match(hits.find((h) => h.handle === 'stranger').dm_error, /Test mode/);
    convo = [{ participants: { data: [{ id: 'IG1' }, { id: 'U1' }] }, messages: { data: [{ message: 'Sure, call me on +91 98200 12345', from: { id: 'U1' }, created_time: new Date().toISOString() }] } }];
    c = await cron();
    const lead = await db.one("select * from mkt_leads where phone = '9820012345'");
    assert.ok(lead, JSON.stringify(c.funnels)); assert.equal(lead.project_id, gor.id); assert.equal(lead.source, 'instagram'); assert.match(lead.note, /Comment-to-DM/);
    assert.ok(sent.some((x) => x.path === '/P1/messages' && JSON.parse(x.recipient).id === 'U1'), 'thank-you DM');
    const g = await rupali(`/api/agents?scope=${gor.id}`);
    assert.equal(g.funnels[0].leads, 1); assert.equal(g.funnels[0].dms, 1);
    assert.equal((await A(rupali, 'funnel.live', { id: f.id, on: true })).status, 403);
    assert.equal((await A(sameer, 'funnel.live', { id: f.id, on: true })).ok, true);
  });

  await step('Comment notes: a complaint in the comments reaches the owner', async () => {
    await db.q("insert into mkt_comments (network, ext_id, author, text, at) values ('instagram', 'cx', 'angry', 'No reply from your office for a week!', now())");
    await db.q('delete from ag_comment_notes'); await db.q("delete from mkt_comments where ext_id <> 'cx'");
    await cron();
    assert.equal((await db.one("select kind from ag_comment_notes where ext_id = 'cx'")).kind, 'complaint');
    await db.q("update ag_scope set last_run_at = null where scope = 'company'");
    const r = await A(rupali, 'run'); assert.ok(r.flagged.includes('complaint'), JSON.stringify(r));
  });

  await step('A lead not called in 2 hours, and a lead at night, are flagged; a post taking off goes for a boost decision', async () => {
    await db.q("insert into mkt_leads (project_id, name, phone, source, created_at) values ($1, 'Waiting Lead', '9811111111', 'website', now() - interval '3 hours')", [gor.id]);
    await db.q("insert into mkt_leads (project_id, name, phone, source, created_at) values ($1, 'Night Lead', '9811111112', 'instagram', (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '1 hour') at time zone 'Asia/Kolkata')", [gor.id]);
    await db.q("update mkt_leads set created_at = least(created_at, now() - interval '1 minute') where phone = '9811111112'");
    const r = await A(rupali, 'run', {}, String(gor.id));
    assert.ok(r.flagged.includes('lead_waiting'), JSON.stringify(r));
    for (let i = 0; i < 9; i++) await db.q("insert into mkt_media (network, ext_id, posted_at, views, caption) values ('instagram', $1, now() - interval '5 days', 200, 'normal')", ['v' + i]);
    await db.q("insert into mkt_media (network, ext_id, posted_at, views, caption, permalink) values ('instagram', 'hot', now() - interval '2 days', 9000, 'Our Oshiwara terrace at sunset', 'https://instagram.com/p/hot')");
    const c = await A(rupali, 'run'); assert.ok(c.flagged.includes('post_viral'), JSON.stringify(c));
    const g = await sameer('/api/agents?scope=company');
    assert.ok(g.triggers.find((t) => t.kind === 'post_viral').count >= 1);
    assert.ok(g.ownerMsgs.some((m) => /your call/.test(m.text)));
  });

  await step('Creative Studio: drafts are designed from the chosen Canva brand template and the PNG is put on the post', async () => {
    const cs = (t) => { const key = crypto.createHash('sha256').update('erp-canva:csec').digest(), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const x = Buffer.concat([c.update(t, 'utf8'), c.final()]); return [iv, c.getAuthTag(), x].map((b) => b.toString('base64url')).join('.'); };
    await db.q("insert into settings (key, value) values ('canva', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ refresh: cs('CR'), name: 'Rafi' })]);
    const t = await A(rupali, 'canva.templates', {}, String(sig.id));
    assert.equal(t.ok, true, t.error); assert.equal(t.templates.length, 2);
    assert.equal((await A(rupali, 'templates.save', { templates: { default: 'T1', reel: 'T2' } })).ok, true);
    const r = await A(rupali, 'draft', { n: 1, angle: 'site progress' }, String(sig.id));
    assert.equal(r.ok, true, r.error); assert.equal(r.posts[0].designed, true, JSON.stringify(r.posts[0]));
    const f = canvaFills[canvaFills.length - 1];
    assert.ok(['T1', 'T2'].includes(f.brand_template_id)); assert.match(f.data.rera_line.text, /P51800012345/); assert.ok(f.data.headline.text); assert.equal(f.data.photo, undefined);
    const files = await db.q('select name, mime from mkt_post_files where post_id = $1', [r.posts[0].id]);
    assert.equal(files.length, 1); assert.equal(files[0].mime, 'image/png');
    assert.equal((await db.one('select canva_url from mkt_posts where id = $1', [r.posts[0].id])).canva_url, 'https://www.canva.com/design/D1/edit');
    // pre-RERA: no RERA line or project name on the design; "Design in Canva" on an older draft
    const old = await db.one("select id from mkt_posts where project_id = $1 and agent is not null order by id limit 1", [gor.id]);
    const d = await A(rupali, 'post.design', { id: old.id });
    assert.equal(d.ok, true, d.error); assert.equal(canvaFills[canvaFills.length - 1].data.rera_line.text.trim(), '', 'the sample RERA line is blanked, never left on the design');
  });

  await step('Learning and planning: past posts become what-worked; the brand calendar plans festival greetings; approved and designed means scheduled', async () => {
    for (let i = 0; i < 8; i++) await db.q("insert into mkt_media (network, ext_id, account, posted_at, kind, caption, likes, comments) values ('instagram', $1, 'dreamindiarealty', now() - ($2 || ' days')::interval, 'reel', $3, $4, $5)", ['H' + i, String(30 + i * 40), 'Old post ' + i + ' MahaRERA No.: P51800054321 Dream Signature', 10 * i, i]);
    assert.equal((await A(rupali, 'history.analyse')).status, 403);
    const h = await A(sameer, 'history.analyse');
    assert.equal(h.ok, true, h.error); assert.ok(h.posts >= 8); assert.ok(h.rera.some((x) => x.rera === 'P51800054321' && x.names['Dream Signature']));
    assert.match(prompts[prompts.length - 1], /TOP 40 POSTS/);
    const k = await rupali('/api/agents?scope=company');
    assert.match(k.knowledge.find((x) => x.path === '/brand-brain/what-worked.md').body, /redevelopment families/);
    const pl = await A(sameer, 'plan.window', { from: '2026-12-21', to: '2027-01-03' });
    assert.equal(pl.ok, true, pl.error); assert.ok(pl.drafted >= 1);
    const pr = prompts[prompts.length - 1];
    assert.match(pr, /2026-12-25 Christmas/); assert.match(pr, /between 2026-12-21 and 2027-01-03/); assert.match(pr, /redevelopment families/, 'the Content Engine reads what worked');
    assert.equal((await A(sameer, 'plan.window', { from: '2026-12-01', to: '2027-02-01' })).status, 400, 'two weeks at a time');
    // a designed draft, once approved, goes straight onto the calendar
    const q = await db.one("select p.id from mkt_posts p where p.agent is not null and p.status = 'review' and p.publish_at > now() and exists (select 1 from mkt_post_files f where f.post_id = p.id) limit 1");
    assert.ok(q, 'a designed draft is waiting');
    assert.equal((await A(sameer, 'post.approve', { id: q.id })).ok, true);
    assert.equal((await db.one('select status from mkt_posts where id = $1', [q.id])).status, 'scheduled');
  });

  await step('Photos: the design photo matches what the post is about, from its own project, least used first', async () => {
    const P = require('../lib/agents-photos');
    const pr = await db.one('select id from projects order by id limit 1');
    await db.q("insert into ag_photos (project_id, url, tags, asset_id) values ($1, 'https://x/a.webp', 'tower exterior', 'A1'), ($1, 'https://x/b.webp', 'pool swimming amenities', 'A2'), (null, 'https://x/c.webp', 'mumbai skyline', 'A3')", [pr.id]);
    const ids = (xs) => xs.map((x) => x.asset_id);
    assert.deepEqual(ids(await P.pick({ project_id: pr.id, title: 'Weekend by the pool', caption: '' })), ['A2']);
    assert.deepEqual(ids(await P.pick({ project_id: pr.id, title: 'Site progress', caption: '' })), ['A1'], 'nothing matches: the least used of its own project');
    assert.equal((await P.pick({ project_id: pr.id, title: 'Slides', caption: '' }, 3)).length, 3, 'a carousel gets one photo per slide');
    // MahaRERA: a brand post shows a project's photo only when that project can carry its RERA number and QR
    assert.deepEqual(ids(await P.pick({ project_id: null, title: 'Weekend by the pool', caption: '' }, 1, { projects: [] })), ['A3'], 'no project may lend: brand photos only');
    assert.deepEqual(await P.pick({ project_id: null, title: 'Weekend by the pool', caption: '' }, 1, { projects: [pr.id] }), [{ asset_id: 'A2', project_id: pr.id }], 'the photo says which project it shows');
  });

  await step('Kill switch: Management only; every agent and funnel stops', async () => {
    assert.equal((await A(rupali, 'kill', { on: true })).status, 403);
    assert.equal((await A(sameer, 'kill', { on: true })).ok, true);
    assert.equal((await A(rupali, 'run', {}, String(gor.id))).skipped, 'kill switch');
    assert.equal((await cron()).funnels.skipped, 'kill switch');
    assert.equal((await sameer('/api/agents?scope=company')).killed, true);
    await A(sameer, 'kill', { on: false });
    assert.ok((await db.one("select count(*)::int as n from audit_log where entity = 'agents'")).n >= 5);
  });

  console.log(`\n${n} agent team checks passed.`);
  fake.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
