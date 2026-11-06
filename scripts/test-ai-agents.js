// The three AI agents of 7 Nov 2026: the website chat assistant, AI Meta ad plans (built in Meta paused, then live), and
// AI conversation calls through Bolna (transcript read into an outcome). Facebook and Bolna are stand-ins on a local port.
// DATABASE_URL=postgres://... ERP_TEST_OTP=246810 node scripts/test-ai-agents.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
const http = require('http');
process.env.PORT = process.env.PORT || '3993';
const calls = [];
const fake = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), q = u.searchParams, P = u.pathname;
  if (req.method === 'POST' && P.startsWith('/graph')) for (const [k, v] of new URLSearchParams(body)) q.set(k, v);
  calls.push(req.method + ' ' + P + (P === '/bolna/call' ? ' ' + body : ''));
  const J = (o, st = 200) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (P === '/bolna/call') { if (req.headers.authorization !== 'Bearer BK') return J({ message: 'unauthorised' }, 401); return J({ message: 'done', status: 'queued', execution_id: 'exec-' + calls.length }); }
  const g = P.slice(6);
  if (g === '/oauth/access_token') return J(q.get('fb_exchange_token') ? { access_token: 'LONG', expires_in: 5184000 } : { access_token: 'SHORT' });
  if (g === '/me') return J({ id: 'u1', name: 'Rafi' });
  if (g === '/me/accounts') return J({ data: [{ id: 'p1', name: 'Dream India Realty', access_token: 'PAGE', instagram_business_account: { id: 'ig1', username: 'dreamindiarealty' } }] });
  if (g === '/me/adaccounts') return J({ data: [{ id: 'act_9', name: 'Dream India Ads', currency: 'INR', account_status: 1 }] });
  if (g === '/search') return J(q.get('type') === 'adgeolocation' ? { data: q.get('q') === 'Nowhere' ? [] : [{ key: '2295424', type: 'city', name: 'Mumbai' }] } : { data: [{ id: '6003' + q.get('q').length, name: q.get('q') }] });
  if (g === '/act_9/campaigns' && req.method === 'POST') { assert.equal(q.get('status'), 'PAUSED'); assert.equal(q.get('objective'), 'OUTCOME_LEADS'); return J({ id: 'C1' }); }
  if (g === '/p1/leadgen_forms' && req.method === 'POST') { assert.equal(q.get('access_token'), 'PAGE'); return J({ id: 'F1' }); }
  if (g === '/act_9/adsets' && req.method === 'POST') { global.adset = q; return J({ id: 'AS1' }); }
  if (g === '/act_9/adimages') return J({ images: { d: { hash: 'H1' } } });
  if (g === '/act_9/adcreatives') { global.creative = JSON.parse(q.get('object_story_spec')); return J({ id: 'CR' + calls.length }); }
  if (g === '/act_9/ads') { assert.equal(q.get('status'), 'PAUSED'); return J({ id: 'AD' + calls.length }); }
  if (req.method === 'POST' && /^\/(C1|AS1|AD\d+)$/.test(g)) { global.live = (global.live || []).concat(g + ':' + q.get('status')); return J({ success: true }); }
  return J({ data: [] });
}).listen(2541);
Object.assign(process.env, { META_GRAPH: 'http://127.0.0.1:2541/graph', META_DIALOG: 'http://127.0.0.1:2541/dialog', META_APP_ID: 'app1', META_APP_SECRET: 'appsecret',
  BOT_FAKE: '1', ADPLAN_FAKE: '1', TM_FAKE_PROVIDER: '1', BOLNA_API: 'http://127.0.0.1:2541/bolna', BOLNA_API_KEY: 'BK' });
require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, location: r.headers.get('location'), ...j };
  };
}
const visitor = async (body, origin = BASE) => { const r = await fetch(BASE + '/api/bot', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, cors: r.headers.get('access-control-allow-origin'), ...j }; };
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  await db.q("update projects set rera_no = 'P51800012345', location = 'Oshiwara' where id = $1", [sig.id]);

  await step('Website chat: a visitor chats; the number with consent becomes a website lead with the site visit; other sites are refused', async () => {
    assert.equal((await visitor({ message: 'hi' }, 'https://evil.example')).status, 403);
    process.env.BOT_FAKE_REPLY = JSON.stringify({ reply: 'Happy to help! Which home are you looking for?', capture: { home: '2 BHK' }, chips: ['1 BHK', '2 BHK'] });
    const a = await visitor({ message: 'Tell me about Dream Signature', project: String(sig.id), page: '/dream-signature' });
    assert.equal(a.status, 200, a.error); assert.ok(a.sid); assert.match(a.reply, /Which home/); assert.deepEqual(a.chips, ['1 BHK', '2 BHK']); assert.equal(a.lead, false);
    process.env.BOT_FAKE_REPLY = JSON.stringify({ reply: 'Done! Your site visit is booked for Saturday at 11 am. By sharing your number you agree that Dream India Realty may call, SMS or WhatsApp you about this project.', capture: { name: 'Kiran Rao', mobile: '98200 55511', budget: '1.5 Cr', visit_date: '2026-11-14', visit_time: '11:00', consent: true } });
    const b = await visitor({ sid: a.sid, message: 'Kiran, 9820055511, Saturday 11 am please' });
    assert.equal(b.lead, true, JSON.stringify(b));
    const L = await db.one("select * from mkt_leads where phone = '9820055511'");
    assert.equal(L.source, 'website'); assert.equal(L.project_id, sig.id); assert.equal(L.name, 'Kiran Rao'); assert.match(L.note, /SITE VISIT BOOKED: 2026-11-14 at 11:00/); assert.match(L.note, /2 BHK/); assert.match(L.note, /Agreed to be contacted/);
    assert.equal(String(L.next_date instanceof Date ? L.next_date.toISOString() : L.next_date).slice(0, 10) <= '2026-11-14', true);
    const list = await admin('/api/bot?chats=1'); assert.equal(list.rows.length, 1); assert.equal(list.rows[0].captured.mobile, '9820055511');
    const one = await admin('/api/bot?chat=' + encodeURIComponent(a.sid)); assert.equal(one.messages.length, 4); assert.equal(one.ip_hash, undefined);
    // a number without consent does not become a lead
    process.env.BOT_FAKE_REPLY = JSON.stringify({ reply: 'Thanks.', capture: { mobile: '9820055522' } });
    const c = await visitor({ message: 'my number is 9820055522' }); assert.equal(c.lead, false);
  });

  let plan;
  await step('AI ad plan: drafted with the MahaRERA number in every ad, needs a design, approved by the Chairman, built in Meta paused, then live', async () => {
    process.env.ADPLAN_FAKE_JSON = JSON.stringify({ campaign_name: 'Signature 2 BHK site visits', why: 'Families in the western suburbs upgrading to 2 BHK.',
      audience: { areas: [{ name: 'Andheri', radius_km: 6 }, { name: 'Goregaon', radius_km: 5 }], age_min: 28, age_max: 55, interests: ['Real estate', 'Home loan'], note: 'families' },
      budget: { daily: 2500, days: 10 }, creatives: [{ headline: 'Your 2 BHK in Oshiwara', primary_text: 'Spacious homes near the metro. Book a site visit today.', description: 'Site visits daily', cta: 'SIGN_UP' },
        { headline: 'Upgrade your family home', primary_text: 'Book your visit this weekend.', description: 'Oshiwara', cta: 'WRONG' }],
      lead_form: { intro: 'Get the floor plans', questions: ['Which home are you looking for?'] }, expected: { cpl_low: 400, cpl_high: 900, leads_low: 30, leads_high: 60 } });
    plan = (await admin('/api/adplans', { action: 'generate', projectId: sig.id, brief: { goal: 'site visits', dailyBudget: 2500, days: 10 } })).id;
    assert.ok(plan);
    const d = (await admin('/api/adplans?project=' + sig.id)).rows.find((x) => x.id === plan);
    assert.ok(d.plan.creatives.every((c) => c.primary_text.includes('MahaRERA No. P51800012345')));
    assert.equal(d.plan.creatives[1].cta, 'SIGN_UP'); assert.equal(d.plan.budget.total, 25000);
    assert.equal((await admin('/api/adplans', { action: 'decide', id: plan, approve: true })).status, 409); // no design yet
    assert.equal((await admin('/api/adplans', { action: 'launch', id: plan })).status, 409); // not approved
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.ok((await admin('/api/adplans', { action: 'file', id: plan, name: 'd.png', data: png })).id);
    assert.ok((await admin('/api/adplans', { action: 'decide', id: plan, approve: true })).ok);
    assert.equal((await admin('/api/adplans', { action: 'launch', id: plan })).status, 409); // Meta not connected yet
    const go = await admin('/api/marketing?connect=meta'), st = new URL(go.location).searchParams.get('state');
    await admin(`/oauth/meta?code=good&state=${encodeURIComponent(st)}`);
    const L = await admin('/api/adplans', { action: 'launch', id: plan });
    assert.equal(L.ok, true, L.error); assert.equal(L.meta.campaign, 'C1'); assert.equal(L.meta.form, 'F1'); assert.equal(L.meta.ads.length, 2); assert.match(L.manager, /act=9/);
    const T = JSON.parse(global.adset.get('targeting'));
    assert.equal(T.geo_locations.cities[0].key, '2295424'); assert.equal(T.age_min, 28); assert.equal(T.flexible_spec[0].interests.length, 2);
    assert.equal(global.adset.get('daily_budget'), '250000'); // paise
    assert.equal(global.creative.link_data.call_to_action.value.lead_gen_form_id, 'F1'); assert.equal(global.creative.instagram_user_id, 'ig1');
    assert.equal((await admin('/api/adplans', { action: 'golive', id: plan })).ok, true);
    assert.ok(global.live && global.live.includes('/C1:ACTIVE') && global.live.includes('/AS1:ACTIVE'), JSON.stringify(global.live) + ' ' + JSON.stringify(calls.slice(-8)));
    assert.equal((await db.one('select status from ad_plans where id = $1', [plan])).status, 'live');
  });

  await step('AI ad plan: an area Facebook does not know stops the build with a clear message, and it can be tried again', async () => {
    process.env.ADPLAN_FAKE_JSON = JSON.stringify({ campaign_name: 'X', why: 'x', audience: { areas: [{ name: 'Nowhere', radius_km: 5 }] }, budget: { daily: 500, days: 3 }, creatives: [{ headline: 'H', primary_text: 'T' }], lead_form: {} });
    const id = (await admin('/api/adplans', { action: 'generate', projectId: sig.id, brief: {} })).id;
    await admin('/api/adplans', { action: 'file', id, name: 'd.png', data: 'data:image/png;base64,iVBORw0KGgo=' });
    await admin('/api/adplans', { action: 'decide', id, approve: true });
    const r = await admin('/api/adplans', { action: 'launch', id }); assert.equal(r.status, 409); assert.match(r.error, /did not recognise/);
    const a = await db.one('select status, meta from ad_plans where id = $1', [id]); assert.equal(a.status, 'failed'); assert.equal(a.meta.campaign, 'C1'); // what was made is kept
  });

  await step('AI conversation calls: sent through Bolna with the project and briefing; the transcript becomes a site visit for the telecallers, or do-not-contact', async () => {
    const tp = (await db.one("insert into tm_projects (name, location, rera_no, project_id) values ('Dream Signature', 'Oshiwara', 'P51800012345', $1) returning id", [sig.id])).id;
    const cp = (await db.one("insert into channel_partners (name, name_key, cp_code, portal_status) values ('Shah Realty', 'shah realty', 'DI-CP-0900', 'approved') returning id")).id;
    const up = (await db.one(`insert into tm_uploads (cp_id, tm_project_id, received, accepted, consent) values ($1, $2, 3, 3, '{"version":1,"name":"Rakesh Shah"}') returning id`, [cp, tp])).id;
    for (const [m, nm] of [['9876500001', 'Asha'], ['9876500002', 'Vivek'], ['9876500003', 'Meena']]) await db.q("insert into tm_leads (mobile, name, tm_project_id, cp_id, source, status, upload_id) values ($1, $2, $3, $4, 'partner', 'fresh', $5)", [m, nm, tp, cp, up]);
    const st = await admin('/api/tm?settings=1');
    await admin('/api/tm', { action: 'settings-save', settings: { ...st.settings, campaigns: { agentId: 'agent-uuid-1', agentFrom: '+911401234567', fromHour: 10, toHour: 19 } } });
    const K = await admin('/api/tm?campaigns=1'); assert.deepEqual(K.ready.agent, [], JSON.stringify(K.ready.agent));
    const id = (await admin('/api/tm', { action: 'campaign-save', kind: 'agent', projectId: tp, name: 'Intro conversations', script: 'Project Dream Signature, Oshiwara. Book site visits.', dailyCap: 100 })).id;
    assert.ok(id);
    assert.equal((await admin('/api/tm', { action: 'campaign-approve', id })).targets, 3);
    assert.ok((await admin('/api/tm', { action: 'campaign-start', id })).ok);
    delete process.env.TM_FAKE_PROVIDER; // the real Bolna path, against the stand-in
    const r = await require('../lib/tm-campaigns').tick({ now: new Date('2026-11-07T06:00:00Z') });
    assert.equal(r[id].sent, 3, JSON.stringify(r));
    const sent = calls.filter((c) => c.startsWith('POST /bolna/call')).map((c) => JSON.parse(c.slice(17)));
    assert.equal(sent.length, 3); assert.equal(sent[0].agent_id, 'agent-uuid-1'); assert.equal(sent[0].from_phone_number, '+911401234567'); assert.match(sent[0].recipient_phone_number, /^\+919876500/);
    assert.equal(sent[0].user_data.project, 'Dream Signature'); assert.match(sent[0].user_data.briefing, /site visits/); assert.match(sent[0].user_data.target, /^t:\d+$/);
    const key = (await db.one("select value->>'hookKey' as k from settings where key = 'tm'")).k;
    const T = await db.q('select id, lead_id, mobile, provider_id from tm_campaign_targets where campaign_id = $1 order by id', [id]);
    const post = (o) => fetch(`${BASE}/api/tm?hook=agent&k=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    process.env.TM_FAKE_PROVIDER = '1';
    process.env.AGENT_FAKE_RESULT = JSON.stringify({ outcome: 'visit_booked', visit_date: '2026-11-15', visit_time: '12:00', home: '2 BHK', summary: 'Wants a 2 BHK, coming Sunday noon.' });
    assert.equal((await post({ id: T[0].provider_id, status: 'in-progress' })).status, 200);
    assert.equal((await post({ id: T[0].provider_id, status: 'completed', transcript: 'agent: Namaste, I am calling from Dream India Realty... user: yes I want a 2 BHK, I can come on Sunday at 12', telephony_data: { duration: 95, recording_url: 'https://rec/1.mp3' }, context_details: { recipient_data: { target: 't:' + T[0].id } } })).status, 200);
    process.env.AGENT_FAKE_RESULT = JSON.stringify({ outcome: 'dnc', summary: 'Asked not to be called again.' });
    await post({ id: T[1].provider_id, status: 'completed', transcript: 'agent: Namaste... user: please do not call me again, remove my number from your list' });
    await post({ id: T[2].provider_id, status: 'no-answer', transcript: '' });
    const S = Object.fromEntries((await db.q('select id, status, result from tm_campaign_targets where campaign_id = $1', [id])).map((x) => [x.id, x]));
    assert.equal(S[T[0].id].status, 'visit_booked'); assert.equal(S[T[0].id].result.recording, 'https://rec/1.mp3');
    assert.equal(S[T[1].id].status, 'dnc'); assert.equal(S[T[2].id].status, 'no_answer');
    const l0 = await db.one('select status, remarks from tm_leads where id = $1', [T[0].lead_id]); assert.equal(l0.status, 'ai_interested'); assert.match(l0.remarks, /SITE VISIT 2026-11-15 12:00/);
    assert.ok(await db.one('select 1 as x from tm_dnc where mobile = $1', [T[1].mobile]));
    const d = await admin('/api/tm?campaign=' + id); assert.equal(d.byStatus.visit_booked, 1); assert.equal(d.pressed[0].visit_date, '2026-11-15'); assert.match(d.pressed[0].outcome, /Site visit booked/);
    // the same result twice changes nothing; a wrong key is refused
    process.env.AGENT_FAKE_RESULT = JSON.stringify({ outcome: 'not_interested' });
    await post({ id: T[0].provider_id, status: 'completed', transcript: 'x'.repeat(80), context_details: { recipient_data: { target: 't:' + T[0].id } } });
    assert.equal((await db.one('select status from tm_campaign_targets where id = $1', [T[0].id])).status, 'visit_booked');
    assert.equal((await fetch(`${BASE}/api/tm?hook=agent&k=bad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  });

  console.log(`\nAI agents: ${n} checks passed.`);
  fake.close(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
