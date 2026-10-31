// Partner & Telemarketing: partner registration with OTP and CP ID, approval, uploads with duplicate and owner checks,
// privacy between partners, earlier numbers, call sheets and outcomes, lookup, password reset, who may see what.
// DATABASE_URL=postgres://... node scripts/test-tm.js   (an empty database)
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
process.env.TM_TEST_OTP = '424242';
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
const firm = (i, extra = {}) => ({ username: 'partner' + i, password: 'secret12' + i, firm: `Test Realty ${i}`, rera: 'A5180001234' + i, address: 'Shop 1, Link Road', area: 'Andheri West', callers: 3,
  contact: `Contact ${i}`, designation: 'Proprietor', mobile: '98765000' + String(i).padStart(2, '0'), email: `cp${i}@example.com`, agree: true, ...extra });

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
  const mk = async (u, role) => { await db.q('insert into users (username, name, role, password_hash, all_projects) values ($1, $1, $2, $3, true)', [u, role, auth.hashPassword('pass-word-123')]); const c = client(); await c('/api/session', { action: 'login', username: u, password: 'pass-word-123' }); return c; };
  const entry = await mk('caller1', 'telecalling'), crm = await mk('crm1', 'crm');
  const buyer = await db.one("select right(regexp_replace(y.phone, '\\D', '', 'g'), 10) as p from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id where b.status = 'active' and coalesce(y.phone, '') <> '' limit 1");
  const A = client(), B = client();

  await step('A partner registers: details checked, a code is sent, the right code creates the firm with a CP ID (pending)', async () => {
    assert.equal((await A('/api/cp-portal?me=1')).signedIn, false);
    assert.equal((await A('/api/cp-portal', { action: 'register-start', ...firm(1, { rera: '12345' }) })).status, 400);
    assert.equal((await A('/api/cp-portal', { action: 'register-start', ...firm(1, { password: 'short' }) })).status, 400);
    const s = await A('/api/cp-portal', { action: 'register-start', ...firm(1) });
    assert.ok(s.token, s.error);
    assert.equal((await A('/api/cp-portal', { action: 'register-verify', token: s.token, otp: '000000' })).status, 400);
    const v = await A('/api/cp-portal', { action: 'register-verify', token: s.token, otp: '424242' });
    assert.equal(v.cpCode, 'DI-CP-0001', v.error); assert.equal(v.approved, false);
    assert.equal((await A('/api/cp-portal', { action: 'register-verify', token: s.token, otp: '424242' })).status, 400); // code used up
    const me = await A('/api/cp-portal?me=1');
    assert.equal(me.signedIn, true); assert.equal(me.profile.mobile, '98XXXXXX01'); assert.equal(me.profile.approved, false);
    assert.equal((await B('/api/cp-portal', { action: 'register-start', ...firm(9, { username: 'partner1' }) })).status, 409);
    assert.equal((await B('/api/cp-portal', { action: 'register-start', ...firm(9, { mobile: '9876500001' }) })).status, 409);
  });

  let launch, hist;
  await step('Management opens a launch, imports earlier numbers, approves the partner; uploads wait for approval', async () => {
    assert.equal((await A('/api/cp-portal', { action: 'upload', projectId: 1, rows: [{ mobile: '9000000001' }], consent: true })).status, 403);
    launch = (await admin('/api/tm', { action: 'project-save', name: 'Jogeshwari West launch', location: 'Jogeshwari West', status: 'open' })).id;
    hist = (await db.one('select id from tm_projects where history')).id;
    const im = await admin('/api/tm', { action: 'import', projectId: hist, rows: [{ mobile: '9111100001', name: 'Old lead', remark: 'Interested 2BHK' }, { mobile: '9111100001' }, { mobile: '123' }] });
    assert.deepEqual(im, { status: 200, added: 1, invalid: 1, alreadyThere: 1 });
    // a wrong import can be taken out and done again
    await admin('/api/tm', { action: 'import', projectId: hist, rows: [{ mobile: '9111100002' }, { mobile: '9111100003' }] });
    const cl = await admin('/api/tm', { action: 'import-clear', projectId: hist });
    assert.equal(cl.removed, 3); assert.equal(cl.left, 0);
    assert.equal((await crm('/api/tm', { action: 'import-clear', projectId: hist })).status, 403);
    assert.equal((await admin('/api/tm', { action: 'import', projectId: hist, rows: [{ mobile: '9111100001', name: 'Old lead', remark: 'Interested 2BHK' }] })).added, 1);
    const p = await admin('/api/tm?partners=1');
    assert.equal(p.rows.length, 1); assert.equal(p.rows[0].portal_status, 'pending');
    assert.equal((await crm('/api/tm?partners=1')).status, 403);
    // papers first: PAN, GST, MahaRERA certificate and the agreement
    const no = await admin('/api/tm', { action: 'partner-status', id: p.rows[0].id, status: 'approved' }); assert.equal(no.status, 400); assert.match(no.error, /PAN card, GST certificate, MahaRERA agent certificate, Partner agreement/);
    const pdf = Buffer.from('%PDF-1.4 x').toString('base64');
    assert.equal((await A('/api/cp-portal', { action: 'doc-upload', kind: 'pan', number: 'abcde1234', file: { name: 'pan.pdf', mime: 'application/pdf', data: pdf } })).status, 400);
    assert.equal((await A('/api/cp-portal', { action: 'doc-upload', kind: 'pan', number: 'abcde1234f', file: { name: 'pan.pdf', mime: 'application/pdf', data: pdf } })).complete, false);
    await A('/api/cp-portal', { action: 'doc-upload', kind: 'gst', number: '27ABCDE1234F1Z5', file: { name: 'gst.pdf', mime: 'application/pdf', data: pdf } });
    await A('/api/cp-portal', { action: 'doc-upload', kind: 'rera', file: { name: 'rera.jpg', mime: 'image/jpeg', data: pdf } });
    assert.equal((await A('/api/cp-portal', { action: 'agreement-sign', name: 'A', agree: true })).status, 400);
    const sg = await A('/api/cp-portal', { action: 'agreement-sign', name: 'Arun Mehta', agree: true }); assert.equal(sg.complete, true);
    const dd = await admin('/api/tm?docs=' + p.rows[0].id); assert.equal(dd.docs.find((x) => x.kind === 'agreement').signedName, 'Arun Mehta'); assert.equal(dd.docs.find((x) => x.kind === 'pan').number, 'ABCDE1234F');
    assert.equal((await fetch(BASE + '/api/tm?cpdoc=' + dd.docs[0].id)).status, 401);
    // only the person named approves (Mubeen)
    const mub = await db.one("insert into users (username, name, role, password_hash, all_projects) values ('mubeen', 'Mubeen', 'management', $1, true) returning id", [require('../lib/auth').hashPassword('pass-word-123')]);
    assert.ok((await require('../lib/cp-docs').approvers()).includes(mub.id)); // found by name until someone is chosen in Settings
    const nope = await admin('/api/tm', { action: 'partner-status', id: p.rows[0].id, status: 'approved' }); assert.equal(nope.status, 403); assert.match(nope.error, /approved by Mubeen/);
    await db.q("insert into settings (key, value) values ('tm', jsonb_build_object('approvers', jsonb_build_array($1::int))) on conflict (key) do update set value = settings.value || excluded.value", [(await db.one("select id from users where username = 'admin'")).id]);
    assert.equal((await admin('/api/tm', { action: 'partner-status', id: p.rows[0].id, status: 'approved' })).ok, true);
    const h = await A('/api/cp-portal?home=1');
    assert.equal(h.profile.approved, true); assert.equal(h.projects.length, 1); assert.equal(h.projects[0].id, launch);
  });

  let upA;
  await step('An upload: fresh numbers registered; invalid, repeated, earlier, existing-customer numbers refused with reasons', async () => {
    const parsed = await A('/api/cp-portal', { action: 'parse', name: 'clients.csv', file: Buffer.from('Mobile,Name\n+91 90000 00001,Asha\n9000000002,Ravi\n').toString('base64') });
    assert.deepEqual(parsed.rows, [['Mobile', 'Name'], ['+91 90000 00001', 'Asha'], ['9000000002', 'Ravi']]);
    const rows = [{ mobile: '+91 90000 00001', name: 'Asha' }, { mobile: '9000000002', name: 'Ravi' }, { mobile: '09000000003', name: 'Neha', config: '2 BHK' }, { mobile: '9000000001', name: 'Asha again' },
      { mobile: '12345', name: 'Bad' }, { mobile: '9111100001', name: 'Old lead' }, ...(buyer ? [{ mobile: buyer.p, name: 'Buyer' }] : [])];
    assert.equal((await A('/api/cp-portal', { action: 'upload', projectId: launch, rows })).status, 400); // no consent
    const r = await A('/api/cp-portal', { action: 'upload', projectId: launch, rows, consent: true, fileName: 'clients.csv' });
    assert.equal(r.accepted, 3, r.error); assert.equal(r.received, rows.length); upA = r.uploadId;
    const c = Object.fromEntries(r.issues.map((x) => [x.reason, x.count]));
    assert.equal(c['Repeated in file'], 1); assert.equal(c['Invalid number'], 1); assert.equal(c['In Dream India database'], 1);
    if (buyer) assert.equal(c['Existing customer'], 1);
    assert.ok(r.rows.every((x) => !/^\d{10}$/.test(x.mobile)), 'masked');
    const again = await A('/api/cp-portal', { action: 'upload', projectId: launch, rows: [{ mobile: '9000000002' }], consent: true });
    assert.equal(again.issues.find((x) => x.reason === 'Already uploaded by you').count, 1);
  });

  await step('A second partner cannot take the first one\'s clients, and never sees them', async () => {
    const s = await B('/api/cp-portal', { action: 'register-start', ...firm(2) });
    const v = await B('/api/cp-portal', { action: 'register-verify', token: s.token, otp: '424242' });
    assert.equal(v.cpCode, 'DI-CP-0002');
    const id = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0002'")).id;
    for (const k of ['pan', 'gst', 'rera', 'agreement']) await db.q("insert into cp_docs (cp_id, kind, how) values ($1, $2, 'test')", [id, k]);
    assert.equal((await admin('/api/tm', { action: 'partner-status', id, status: 'approved' })).ok, true);
    const r = await B('/api/cp-portal', { action: 'upload', projectId: launch, rows: [{ mobile: '9000000001', name: 'Asha' }, { mobile: '9000000009', name: 'Own' }], consent: true });
    assert.equal(r.accepted, 1); assert.equal(r.issues.find((x) => x.reason === 'Registered with another partner').count, 1);
    const lb = await B('/api/cp-portal?leads=1');
    assert.deepEqual(lb.rows.map((x) => x.mobile), ['90XXXXXX09']);
    assert.equal((await B('/api/cp-portal?issues=' + upA)).rows.length, 0);
    const la = await A('/api/cp-portal?leads=1');
    assert.equal(la.rows.length, 3); assert.ok(la.rows.every((x) => x.mobile.includes('XXXXXX')));
    assert.equal((await A('/api/cp-portal?leads=1&q=0003')).rows.length, 1);
  });

  let sheetId, leadAsha;
  await step('Call sheets: callers added, sheets made without giving a number twice, outcomes typed back', async () => {
    const c1 = (await admin('/api/tm', { action: 'caller-save', name: 'Priya', mobile: '9822200001', dailyRate: 1000 })).id;
    const c2 = (await admin('/api/tm', { action: 'caller-save', name: 'Sunil', dailyRate: 900 })).id;
    assert.equal((await entry('/api/tm', { action: 'sheets-make', projectId: launch, callerIds: [c1], perCaller: 10 })).status, 403);
    const m = await admin('/api/tm', { action: 'sheets-make', projectId: launch, callerIds: [c1, c2], perCaller: 2 });
    assert.equal(m.sheets.length, 2, m.error); assert.equal(m.assigned, 4);
    assert.equal((await admin('/api/tm', { action: 'sheets-make', projectId: launch, callerIds: [c1], perCaller: 2 })).status, 400); // nothing left
    const list = await entry('/api/tm?sheets=1');
    assert.equal(list.rows.length, 2);
    assert.equal((await entry('/api/tm?overview=1')).status, 403);
    const sh = await entry('/api/tm?sheet=' + m.sheets[0]);
    assert.equal(sh.leads.length, 2); assert.match(sh.leads[0].mobile, /^\d{10}$/);
    sheetId = m.sheets[0];
    const all = [...sh.leads, ...(await admin('/api/tm?sheet=' + m.sheets[1])).leads];
    leadAsha = all.find((l) => l.mobile === '9000000001');
    const s2 = all.find((l) => l.mobile === '9000000001') ? m.sheets[sh.leads.some((l) => l.mobile === '9000000001') ? 0 : 1] : null;
    const target = await admin('/api/tm?sheet=' + s2);
    const entries = target.leads.map((l) => ({ leadId: l.id, code: l.mobile === '9000000001' ? 2 : 5, remark: l.mobile === '9000000001' ? 'Visit Sunday' : '' }));
    const r = await entry('/api/tm', { action: 'outcomes-save', sheetId: s2, entries });
    assert.equal(r.saved, 2, r.error);
    assert.equal((await entry('/api/tm', { action: 'outcomes-save', sheetId: s2, entries })).status, 409);
    const other = m.sheets.find((x) => x !== s2);
    assert.equal((await admin('/api/tm', { action: 'sheet-cancel', id: other })).ok, true);
    const own = await db.one("select owner_until, status from tm_leads where mobile = '9000000001' and cp_id is not null");
    assert.equal(own.status, 'visit');
  });

  await step('The overview, the partner\'s own view and the lookup all show the site visit and the owner', async () => {
    const o = await admin('/api/tm?overview=1&project=' + launch);
    assert.equal(o.calls, 2); assert.equal(o.visits, 1); assert.equal(o.received, 10);
    const pr = o.partnerRows.find((x) => x.cpCode === 'DI-CP-0001'); assert.equal(pr.visits, 1); assert.equal(pr.accepted, 3);
    assert.ok(o.callers.length >= 1 && o.spend > 0);
    assert.equal((await A('/api/cp-portal?home=1')).stats.status['Site visit booked'], 1);
    const l = await admin('/api/tm?lookup=9000000001');
    assert.equal(l.owner.cpCode, 'DI-CP-0001'); assert.equal(l.leads.length, 1);
    assert.equal((await crm('/api/tm?lookup=9000000001')).status, 403);
  });

  await step('Sign in by username, CP ID or mobile; wrong passwords lock; reset by code; blocked partners are signed out', async () => {
    const C = client();
    assert.equal((await C('/api/cp-portal', { action: 'login', username: 'partner1', password: 'wrong-pass1' })).status, 401);
    assert.equal((await C('/api/cp-portal', { action: 'login', username: 'DI-CP-0001', password: 'secret121' })).ok, true);
    assert.equal((await C('/api/cp-portal', { action: 'login', username: '9876500001', password: 'secret121' })).ok, true);
    const f = await C('/api/cp-portal', { action: 'forgot-start', username: 'partner1' });
    assert.ok(f.token);
    assert.equal((await C('/api/cp-portal', { action: 'forgot-verify', token: f.token, otp: '424242', password: 'newpass123' })).ok, true);
    assert.equal((await A('/api/cp-portal?home=1')).status, 401); // old sessions ended
    assert.equal((await A('/api/cp-portal', { action: 'login', username: 'partner1', password: 'newpass123' })).ok, true);
    const id = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0002'")).id;
    await admin('/api/tm', { action: 'partner-status', id, status: 'blocked' });
    assert.equal((await B('/api/cp-portal?home=1')).status, 401);
    assert.equal((await B('/api/cp-portal', { action: 'login', username: 'partner2', password: 'secret122' })).status, 403);
    for (let i = 0; i < 8; i++) await C('/api/cp-portal', { action: 'login', username: 'partner1', password: 'bad-pass-' + i });
    assert.equal((await C('/api/cp-portal', { action: 'login', username: 'partner1', password: 'newpass123' })).status, 429);
  });

  await step('Reports: a launch reports from its entered calls; a finished campaign\'s sheet is loaded and every figure opens to its rows; buyers matched', async () => {
    const live = await admin(`/api/tm?results=${launch}`);
    assert.equal(live.status, 200, live.error); assert.equal(live.source, 'calls'); assert.ok(live.report.kpis[0].rows >= 1);
    assert.equal((await crm(`/api/tm?results=${launch}`)).status, 403);
    const buyer = await db.one("select y.name, right(regexp_replace(y.phone, '\\D', '', 'g'), 10) as p, b.booking_date from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id where b.status = 'active' and y.phone is not null order by b.booking_date limit 1");
    const before = new Date(Date.parse(buyer.booking_date) - 20 * 864e5).toISOString().slice(0, 10);
    const rows = [
      { day: before, caller: 'Asha', cp_firm: 'Bricks Bazaar', sm: 'Haider', client: buyer.name, mobile: buyer.p, config: '2 BHK', status: 'Hot', remark: 'Visit Sunday' },
      { day: before, caller: 'Asha', cp_firm: 'SK Realtors', client: 'Ravi', mobile: '98XXXXXX12', config: '1 BHK', status: 'Warm', remark: '.' },
      { day: 46000, caller: 'Bilal', cp_firm: 'SK Realtors', client: 'Meena', mobile: '+91 98200 11111', config: '1 BHK', status: 'cold', remark: 'busy' },
      { day: '12/05/2025', caller: 'Bilal', cp_firm: 'Bricks Bazaar', client: 'Meena', mobile: '9820011111', config: '1 BHK', status: 'Warm', remark: 'call later' },
    ];
    assert.equal((await admin('/api/tm', { action: 'rows-load', projectId: hist, rows: rows.slice(0, 2), first: true })).total, 2);
    assert.equal((await admin('/api/tm', { action: 'rows-load', projectId: hist, rows: rows.slice(2), first: false, offset: 2 })).total, 4);
    const r = await admin(`/api/tm?results=${hist}`);
    assert.equal(r.source, 'sheet'); assert.equal(r.loaded, 4);
    const k = r.report.kpis[0];
    assert.equal(k.rows, 4); assert.equal(k.unique_people, 3); assert.equal(k.unique_full, 2); assert.equal(k.masked_rows, 1); assert.equal(k.callers, 2); assert.equal(k.phones_multi_cp, 1); assert.equal(k.caller_days, 3); assert.equal(k.cost, 3000);
    assert.equal(r.report.bk_kpis[0].before, 1); assert.equal(r.report.bk_kpis[0].cp_diff + r.report.bk_kpis[0].cp_same <= 1, true);
    const d = await admin(`/api/tm?drill=buyers&project=${hist}`); assert.equal(d.total, 1); assert.equal(d.rows[0].days, 20);
    assert.equal((await admin(`/api/tm?drill=leads&project=${hist}&q=meena`)).total, 2);
    assert.equal((await admin(`/api/tm?drill=caller&val=Asha&project=${hist}`)).total, 2);
    assert.equal((await admin(`/api/tm?drill=repeat&project=${hist}`)).total, 1);
    for (const key of ['people', 'messageable', 'masked', 'junk', 'callers', 'callerdays', 'perday', 'cost', 'cps', 'sms', 'buyers_all', 'buyers_after', 'buyers_none', 'buyers_name', 'buyers_diffcp'])
      assert.equal((await admin(`/api/tm?drill=${key}&project=${hist}`)).status, 200, key);
    assert.equal((await admin(`/api/tm?drill=month&val=2025-12&project=${hist}`)).total, 1); // 46000 = 9 Dec 2025
    assert.ok((await admin(`/api/tm?drill=leads&project=${hist}&page=-1`)).all.length === 4);
  });

  await step('Settings saved within limits; a staff page for Partner & Telemarketing loads', async () => {
    const s = await admin('/api/tm', { action: 'settings-save', settings: { ownershipDays: 1000, historyPolicy: 'accept', autoApprove: true, maxAttempts: 4, gapDays: 3 } });
    assert.equal(s.settings.ownershipDays, 365); assert.equal(s.settings.autoApprove, false); assert.deepEqual(s.settings.approvers.length, 1); // partners are approved by hand once their papers are in; approvers kept
    const page = await fetch(BASE + '/partner.html'); assert.equal(page.status, 200);
    assert.equal((await fetch(BASE + '/telemarketing.js')).status, 200);
  });

  console.log(`\nPartner & Telemarketing: ${n} checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
