// Partner & Telemarketing: partner registration with OTP and CP ID, approval, uploads with duplicate and owner checks,
// privacy between partners, earlier numbers, call sheets and outcomes, lookup, password reset, who may see what.
// DATABASE_URL=postgres://... node scripts/test-tm.js   (an empty database)
require('./login-code-helper'); // staff sign-in: password, then the code (ERP_TEST_OTP)
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
    // the partner is not told that a number is ours (database or customer) or another partner's: "Not registered"
    assert.equal(c['Repeated in file'], 1); assert.equal(c['Invalid number'], 1); assert.equal(c['Not registered'], buyer ? 2 : 1);
    for (const k of ['In Dream India database', 'Existing customer', 'Registered with another partner']) { assert.equal(c[k], undefined); assert.ok(!r.rows.some((x) => x.reason === k)); }
    const is = await A('/api/cp-portal?issues=' + upA); assert.ok(is.rows.some((x) => x.reason === 'Not registered')); assert.ok(!is.rows.some((x) => /database|customer/i.test(x.reason)));
    // staff still see why
    const staff = await db.q('select reason from tm_upload_issues where upload_id = $1', [upA]); assert.ok(staff.some((x) => x.reason === 'In Dream India database'));
    if (buyer) assert.ok(staff.some((x) => x.reason === 'Existing customer'));
    assert.equal((await admin('/api/tm?overview=1')).issues['In Dream India database'], 1);
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
    assert.equal(r.accepted, 1); assert.equal(r.issues.find((x) => x.reason === 'Not registered').count, 1); assert.ok(!r.issues.some((x) => x.reason === 'Registered with another partner'));
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

  await step('Limits: partner uploads per day, verification codes per email, address and in all; a self-registered firm never takes over a firm already in the ERP', async () => {
    // uploads: at most so many rows a day per partner
    await db.q("insert into settings (key, value) values ('tm', '{\"partnerDailyRows\": 12}') on conflict (key) do update set value = settings.value || excluded.value");
    const cpA = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0001'")).id;
    const done = (await db.one("select coalesce(sum(received), 0)::int as n from tm_uploads where cp_id = $1 and (created_at + interval '330 minutes')::date = (now() + interval '330 minutes')::date", [cpA])).n;
    const left = 12 - done, rows = (k) => Array.from({ length: k }, (_, i) => ({ mobile: '93' + String(10000000 + i + done * 100).padStart(8, '0'), name: 'Cap ' + i }));
    if (left > 0) assert.equal((await A('/api/cp-portal', { action: 'upload', projectId: launch, rows: rows(left), consent: true })).received, left);
    const over = await A('/api/cp-portal', { action: 'upload', projectId: launch, rows: rows(1), consent: true }); assert.equal(over.status, 429); assert.match(over.error, /up to 12 rows a day/);
    assert.equal((await A('/api/cp-portal?home=1')).maxRows, 12);
    await db.q("update settings set value = value - 'partnerDailyRows' where key = 'tm'");
    // codes: 5 an hour for one email address, even from different mobiles
    await db.q('delete from mkt_rate');
    const X = client();
    for (let i = 0; i < 5; i++) assert.ok((await X('/api/cp-portal', { action: 'register-start', ...firm(30 + i, { email: 'same@example.com', rera: 'A5180000' + String(30 + i).padStart(4, '0') }) })).token);
    const e6 = await X('/api/cp-portal', { action: 'register-start', ...firm(40, { email: 'same@example.com', rera: 'A51800000040' }) }); assert.equal(e6.status, 429); assert.match(e6.error, /email/);
    // 10 an hour from one internet address
    await db.q('delete from mkt_rate');
    for (let i = 0; i < 10; i++) assert.ok((await X('/api/cp-portal', { action: 'register-start', ...firm(50 + i, { rera: 'A5180000' + String(50 + i).padStart(4, '0') }) })).token);
    const i11 = await X('/api/cp-portal', { action: 'register-start', ...firm(70, { rera: 'A51800000070' }) }); assert.equal(i11.status, 429); assert.match(i11.error, /internet connection/);
    // and a cap for the whole portal
    await db.q('delete from mkt_rate');
    await db.q("insert into mkt_rate (key, win, n) values ($1, date_trunc('hour', now()), 200)", ['otp-all:' + require('../lib/mkt-rate').hash('portal')]);
    const g = await X('/api/cp-portal', { action: 'register-start', ...firm(71, { rera: 'A51800000071' }) }); assert.equal(g.status, 429); assert.match(g.error, /busy/);
    await db.q('delete from mkt_rate');
    // a firm already in the ERP (from bookings) under the same name: the registration is a new pending firm, flagged
    const old = await db.one("insert into channel_partners (name, name_key, phone) values ('Shree Estates', 'shree estates', '9822233344') returning id");
    await db.q("update bookings set cp_id = $1 where id = (select id from bookings order by id limit 1)", [old.id]);
    const Y = client(), s = await Y('/api/cp-portal', { action: 'register-start', ...firm(80, { firm: 'Shree Estates', rera: 'A51800000080' }) }); assert.ok(s.token, s.error);
    const v = await Y('/api/cp-portal', { action: 'register-verify', token: s.token, otp: '424242' }); assert.ok(v.cpCode, v.error);
    const mine = await db.one('select id, name, note, portal_status, username from channel_partners where cp_code = $1', [v.cpCode]);
    assert.notEqual(mine.id, old.id); assert.equal(mine.portal_status, 'pending'); assert.equal(mine.name, 'Shree Estates'); assert.match(mine.note, new RegExp(`Possible match: "Shree Estates" \\(partner #${old.id}\\)`));
    const o2 = await db.one('select username, pw_hash, portal_status from channel_partners where id = $1', [old.id]); assert.equal(o2.username, null); assert.equal(o2.pw_hash, null); assert.equal(o2.portal_status, null);
    assert.equal((await Y('/api/cp-portal?home=1')).stats.bookings, 0); // the old firm's bookings are not shown to the new login
    assert.ok((await admin('/api/tm?partners=1')).rows.find((x) => x.id === mine.id).note);
  });

  await step('Launch figures: bookings are those of the launch\'s project; a caller-day shared by two launches is split; one default rate', async () => {
    const TM = require('../lib/tm');
    const cpA = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0001'")).id;
    await db.q("update bookings set cp_id = $1 where id = (select b.id from bookings b join units u on u.id = b.unit_id where b.status = 'active' and u.project_id = $2 order by b.id desc limit 1)", [cpA, sig.id]);
    const other = await db.one("insert into projects (code, name, company_id) select 'TMOTHER', 'Other Heights', company_id from projects where id = $1 returning id", [sig.id]);
    const lSig = await db.one("insert into tm_projects (name, project_id, status) values ('Sig launch', $1, 'open') returning id", [sig.id]);
    const lOth = await db.one("insert into tm_projects (name, project_id, status) values ('Other launch', $1, 'open') returning id", [other.id]);
    assert.ok((await TM.analytics(lSig.id)).bookings >= 1);
    assert.equal((await TM.analytics(lOth.id)).bookings, 0);
    // one caller, one day, 3 calls for one launch and 1 for the other: the day is split 3:1
    const c = await db.one("insert into tm_callers (name, daily_rate) values ('Split caller', 1200) returning id");
    const tl = await db.one("insert into tm_leads (mobile, tm_project_id, source) values ('9333300001', $1, 'history') returning id", [lSig.id]);
    await db.q("insert into tm_outcomes (lead_id, caller_id, tm_project_id, call_date, code) values ($1, $2, $3, current_date, 5), ($1, $2, $3, current_date, 5), ($1, $2, $3, current_date, 4), ($1, $2, $4, current_date, 5)", [tl.id, c.id, lSig.id, lOth.id]);
    assert.equal((await TM.analytics(lSig.id)).callers.find((x) => x.name === 'Split caller').cost, 900);
    assert.equal((await TM.analytics(lOth.id)).callers.find((x) => x.name === 'Split caller').cost, 300);
    assert.equal((await require('../lib/tm-results').summary(lSig.id)).kpis[0].cost, 900);
    // no rate (0): the one default
    await db.q('update tm_callers set daily_rate = 0 where id = $1', [c.id]);
    assert.equal((await TM.analytics(lSig.id)).callers.find((x) => x.name === 'Split caller').cost, TM.DEFAULT_RATE * 3 / 4);
    assert.equal((await require('../lib/tm-results').summary(lOth.id)).kpis[0].cost, TM.DEFAULT_RATE / 4);
    await db.q('update projects set active = false where id = $1', [other.id]);
  });

  // ---------- existing firms on the portal: duplicates, merges (asked by Accounts, approved by Mubeen), invitations ----------
  const CP = require('../lib/cp');
  const headacc = await mk('headacc', 'head_accounts'), accEntry = await mk('acc1', 'accounts');
  const mubeenId = (await db.one("select id from users where username = 'mubeen'")).id, headaccId = (await db.one("select id from users where username = 'headacc'")).id;
  const mub = client(); await mub('/api/session', { action: 'login', username: 'mubeen', password: 'pass-word-123' });
  await db.q("update settings set value = jsonb_set(value, '{approvers}', $1::jsonb) where key = 'tm'", [JSON.stringify([mubeenId, headaccId])]);
  // firms from the accounts sheet, with real (not sample) bookings and brokerage
  const mkFirm = async (name, extra = {}) => (await db.one('insert into channel_partners (name, name_key, phone, email) values ($1, $2, $3, $4) returning id', [name, CP.keyOf(name), extra.phone || null, extra.email || null])).id;
  const tohfa1 = await mkFirm('Tohfa Property'), tohfa2 = await mkFirm('Tohfa Properties'), sk1 = await mkFirm('S.K Realtors'), sk2 = await mkFirm('S K Realtors');
  const arsh = await mkFirm('Arsh Rehmani (Just Deal Properties)'), jd = await mkFirm('Just Deal'), ref = await mkFirm('Direct Reference Walkin');
  const freeBk = await db.q("select b.id from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'active' and b.cp_id is null order by b.id limit 6", [sig.id]);
  assert.ok(freeBk.length >= 6, 'enough sample bookings');
  const own = [[freeBk[0].id, tohfa1], [freeBk[1].id, tohfa1], [freeBk[2].id, tohfa2], [freeBk[3].id, sk1], [freeBk[4].id, sk2], [freeBk[5].id, jd]];
  for (const [bid, cp] of own) await db.q("update bookings set cp_id = $2, sample = false, brokerage_pct = 2, brokerage = round(agreement_value * 0.02, 2), registration_date = coalesce(registration_date, booking_date) where id = $1", [bid, cp]);
  const payEntry = await db.one("insert into brokerage_entries (booking_id, cp_id, kind, entry_date, amount, reference, created_by, verified_by, verified_at) values ($1, $2, 'payment', current_date, 1000, 'UTR-T2', $3, $3, now()) returning id", [freeBk[2].id, tohfa2, mubeenId]);
  await db.q("insert into brokerage_entries (booking_id, cp_id, kind, entry_date, amount, reference, created_by) values ($1, $2, 'payment', current_date, 500, 'UTR-UNVER', $3)", [freeBk[0].id, tohfa1, mubeenId]);

  await step('Accounts sees the firms not on the portal and the possible duplicates (spacing, punctuation, plurals, the firm in brackets)', async () => {
    const p = await headacc('/api/partners?portal=1');
    assert.equal(p.status, 200, p.error); assert.equal(p.can.request, true); assert.equal(p.can.invite, true);
    const row = p.notOnPortal.find((x) => x.id === tohfa1); assert.equal(row.bookings, 2); assert.deepEqual(row.duplicates.map((x) => x.id), [tohfa2]);
    const grp = (id) => p.duplicates.find((g) => g.firms.some((f) => f.id === id));
    assert.deepEqual(grp(sk1).firms.map((f) => f.id).sort(), [sk1, sk2].sort());
    assert.deepEqual(grp(jd).firms.map((f) => f.id).sort(), [arsh, jd].sort());
    assert.ok(!p.notOnPortal.some((x) => x.username));
    assert.equal((await crm('/api/partners?portal=1')).status, 403);
    const a2 = await accEntry('/api/partners?portal=1'); assert.equal(a2.status, 200); assert.equal(a2.can.request, false);
  });

  await step('A merge: Head Accounts asks, cannot approve it himself; Mubeen approves and every booking and entry moves; old spellings map to the kept firm', async () => {
    assert.equal((await accEntry('/api/partners', { action: 'merge-request', intoId: tohfa1, fromIds: [tohfa2], keepName: 'Tohfa Properties' })).status, 403);
    const r = await headacc('/api/partners', { action: 'merge-request', intoId: tohfa1, fromIds: [tohfa2], keepName: 'Tohfa Properties' });
    assert.ok(r.id, r.error);
    assert.equal((await headacc('/api/partners', { action: 'merge-request', intoId: tohfa2, fromIds: [tohfa1], keepName: 'Tohfa' })).status, 409); // already in a request
    const inv = await accEntry('/api/partners', { action: 'invite', id: tohfa1, mobile: '9822200077', email: 'tohfa@example.com' }); assert.equal(inv.status, 409); assert.match(inv.error, /merge waiting/);
    const self = await headacc('/api/partners', { action: 'merge-decide', id: r.id, approve: true }); assert.equal(self.status, 403); assert.match(self.error, /someone else/);
    assert.equal((await crm('/api/partners', { action: 'merge-decide', id: r.id, approve: true })).status, 403);
    assert.equal((await mub('/api/partners?merges=1&status=pending')).rows.length, 1);
    const ok = await mub('/api/partners', { action: 'merge-decide', id: r.id, approve: true });
    assert.equal(ok.status, 'approved', ok.error); assert.equal(ok.result.moved['bookings.cp_id'], 1); assert.equal(ok.result.moved['brokerage_entries.cp_id'], 1);
    assert.equal((await db.one('select cp_id from bookings where id = $1', [freeBk[2].id])).cp_id, tohfa1);
    assert.equal((await db.one('select cp_id from brokerage_entries where id = $1', [payEntry.id])).cp_id, tohfa1);
    const m = await db.one('select merged_into, active from channel_partners where id = $1', [tohfa2]); assert.equal(m.merged_into, tohfa1); assert.equal(m.active, false);
    assert.equal((await db.one('select name from channel_partners where id = $1', [tohfa1])).name, 'Tohfa Properties');
    assert.equal((await CP.firmFor(db, { cpName: 'Tohfa Property' })).id, tohfa1); // both old spellings
    assert.equal((await CP.firmFor(db, { cpName: 'tohfa properties.' })).id, tohfa1);
    assert.ok(await db.one("select 1 as x from audit_log where action = 'partner-merge' and entity_id = $1", [String(tohfa1)]));
    assert.equal((await mub('/api/partners', { action: 'merge-decide', id: r.id, approve: false, reason: 'x' })).status, 409);
    // a merge never joins two firms that each have a portal login
    const cpA = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0001'")).id, cpB = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0002'")).id;
    const two = await headacc('/api/partners', { action: 'merge-request', intoId: cpA, fromIds: [cpB], keepName: 'Test Realty' }); assert.equal(two.status, 409); assert.match(two.error, /portal login/);
  });

  const SHEET_H = ['ERP ID', 'Name in ERP', 'Flats', 'Agreement value (Rs)', 'Brokerage earned (Rs)', 'Paid so far (Rs)', 'Duplicate group', 'Suggested correct name', 'Check this', 'Correct firm name', 'Keep separate (Y)', 'Contact person', 'Mobile', 'Email', 'RERA no', 'GSTIN', 'Notes'];
  await step('The clean-up sheet: downloaded in the Accounts layout, filled in Excel, uploaded: a preview, then one batch Mubeen approves', async () => {
    const dl = await headacc('/api/partners?cleanup=1');
    assert.equal(dl.status, 200, dl.error);
    const wb = require('../lib/xlsx').read(Buffer.from(dl.data, 'base64'));
    assert.deepEqual(wb.map((s) => s.name), ['How to clean', 'Clean-up', 'Summary']);
    const cu = wb[1].rows; assert.deepEqual(cu[0].map(String), SHEET_H);
    const skRow = cu.find((r) => String(r[0]) === String(sk1)); assert.ok(skRow[6], 'duplicate group filled');
    assert.equal(String(cu[cu.length - 1][1]), 'Totals');
    const cpA = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0001'")).id, cpB = (await db.one("select id from channel_partners where cp_code = 'DI-CP-0002'")).id;
    const row = (id, correct, x = {}) => SHEET_H.map((h) => ({ 'ERP ID': id, 'Correct firm name': correct, 'Keep separate (Y)': x.sep || '', 'Contact person': x.contact || '', Mobile: x.mobile || '', Email: x.email || '', 'RERA no': x.rera || '', GSTIN: x.gstin || '' })[h] ?? '');
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [SHEET_H, row(sk1, 'S K Realtors'), row(sk2, 's.k. realtors', { mobile: '98111 22233', email: 'sk@example.com', contact: 'Sunil K' }), row(arsh, 'Just Deal Properties', { email: 'not-an-email' }),
      row(jd, 'Just Deal Properties'), row(ref, 'reference'), row(cpA, 'Test Realty'), row(cpB, 'Test Realty'), row(tohfa1, ''), row(99999, 'Nobody'), ['', 'Totals', '6', '', '', '', '', '', '', '', '', '', '', '', '', '', '']];
    const csv = Buffer.from(rows.map((r) => r.map(q).join(',')).join('\n')).toString('base64');
    assert.equal((await accEntry('/api/partners', { action: 'cleanup-preview', file: csv, name: 'clean.csv' })).status, 403);
    const pv = await headacc('/api/partners', { action: 'cleanup-preview', file: csv, name: 'clean.csv' });
    assert.equal(pv.status, 200, pv.error);
    assert.equal(pv.merges, 2, JSON.stringify(pv)); assert.equal(pv.references.length, 1); assert.equal(pv.references[0].id, ref);
    const skp = pv.plan.find((p) => p.keepName === 'S K Realtors'); assert.ok(skp, JSON.stringify(pv.plan)); assert.equal(skp.merge.length, 1); assert.equal(skp.contacts.mobile, '9811122233'); assert.equal(skp.contacts.contact, 'Sunil K');
    const jdp = pv.plan.find((p) => p.keepName === 'Just Deal Properties'); assert.equal(jdp.keep.id, jd); assert.deepEqual(jdp.merge.map((x) => x.id), [arsh]); // the one with more flats is kept
    assert.ok(pv.refused.some((x) => /each have a portal login/.test(x.reason)));
    assert.ok(pv.refused.some((x) => /not-an-email/.test(x.reason)));
    assert.ok(pv.refused.some((x) => /No firm with this ERP ID/.test(x.reason)));
    assert.ok(!pv.plan.some((p) => p.keep.id === tohfa1)); // empty correct name: unchanged
    // the same sheet as .xlsx with the "How to clean" sheet first: the Clean-up sheet is the one read
    const xl = require('../lib/xlsx-write').write([{ name: 'How to clean', rows: [['Read me']] }, { name: 'Clean-up', rows }, { name: 'Summary', rows: [['x', 1]] }]).toString('base64');
    const pv2 = await headacc('/api/partners', { action: 'cleanup-preview', file: xl, name: 'clean.xlsx' }); assert.equal(pv2.merges, 2, pv2.error); assert.equal(pv2.references.length, 1);
    const sub = await headacc('/api/partners', { action: 'cleanup-submit', file: csv, name: 'clean.csv' });
    assert.equal(sub.requests.length, 3, JSON.stringify(sub)); assert.ok(sub.batch);
    assert.equal((await headacc('/api/partners', { action: 'merge-batch', batch: sub.batch, approve: true })).status, 403); // not his own
    const ap = await mub('/api/partners', { action: 'merge-batch', batch: sub.batch, approve: true });
    assert.equal(ap.done.length, 3, JSON.stringify(ap));
    const k = await db.one('select name, phone, email, contact_person from channel_partners where id = $1', [sk1]); // the first row had the most... equal flats: lower id kept
    assert.equal(k.name, 'S K Realtors'); assert.equal(k.phone, '9811122233'); assert.equal(k.email, 'sk@example.com'); assert.equal(k.contact_person, 'Sunil K');
    assert.equal((await db.one('select cp_id from bookings where id = $1', [freeBk[4].id])).cp_id, sk1);
    assert.equal((await db.one('select merged_into from channel_partners where id = $1', [arsh])).merged_into, jd);
    assert.equal((await db.one('select is_reference from channel_partners where id = $1', [ref])).is_reference, true);
    const p = await headacc('/api/partners?portal=1'); assert.ok(!p.notOnPortal.some((x) => x.id === ref || x.id === arsh || x.id === sk2));
    const ri = await headacc('/api/partners', { action: 'invite', id: ref, email: 'ref@example.com' }); assert.equal(ri.status, 409); assert.match(ri.error, /reference/);
  });

  let P, tohfaBuyers;
  await step('An existing firm is invited: one-time link, code to the mobile and email on file, own login; pending until papers and approval', async () => {
    assert.equal((await crm('/api/partners', { action: 'invite', id: tohfa1, email: 'tohfa@example.com' })).status, 403);
    assert.equal((await accEntry('/api/partners', { action: 'invite', id: tohfa1, mobile: '123', email: 'tohfa@example.com' })).status, 400);
    const old = await accEntry('/api/partners', { action: 'invite', id: tohfa1, mobile: '9822200077', email: 'tohfa@example.com' }); assert.ok(old.link, old.error);
    const inv = await accEntry('/api/partners', { action: 'invite', id: tohfa1, mobile: '98222 00077', email: 'Tohfa@Example.com' });
    assert.match(inv.link, /^https:\/\/partners\.dreamindiarealty\.com\/\?invite=[A-Za-z0-9_-]{30,}$/);
    const tok = inv.link.split('invite=')[1], oldTok = old.link.split('invite=')[1];
    const f = await db.one('select phone, email from channel_partners where id = $1', [tohfa1]); assert.equal(f.phone, '9822200077'); assert.equal(f.email, 'tohfa@example.com');
    assert.equal((await db.one('select count(*)::int as c from cp_invites where cp_id = $1 and token_hash = $2', [tohfa1, tok])).c, 0, 'only the hash is kept');
    P = client();
    assert.equal((await P('/api/cp-portal?invite=' + oldTok)).status, 404); // the earlier link stops working
    const info = await P('/api/cp-portal?invite=' + tok);
    assert.equal(info.firm, 'Tohfa Properties'); assert.equal(info.mobile, '98XXXXXX77');
    const det = { invite: tok, username: 'tohfa', password: 'tohfa-pass1', contact: 'Imran Tohfa', address: 'Shop 4, Jogeshwari', area: 'Jogeshwari West', rera: 'A51800099901', agree: true };
    assert.equal((await P('/api/cp-portal', { action: 'invite-start', ...det, username: 'partner1' })).status, 409);
    assert.equal((await P('/api/cp-portal', { action: 'invite-start', ...det, rera: 'X1' })).status, 400);
    const s = await P('/api/cp-portal', { action: 'invite-start', ...det }); assert.ok(s.token, s.error);
    assert.equal((await P('/api/cp-portal', { action: 'invite-verify', token: s.token, otp: '111111' })).status, 400);
    const v = await P('/api/cp-portal', { action: 'invite-verify', token: s.token, otp: '424242' });
    assert.match(v.cpCode || '', /^DI-CP-\d{4}$/, v.error); assert.equal(v.approved, false);
    const me = await db.one('select id, username, portal_status, cp_code from channel_partners where username = $1', ['tohfa']);
    assert.equal(me.id, tohfa1); assert.equal(me.portal_status, 'pending'); // the same firm, with its bookings
    assert.equal((await P('/api/cp-portal?invite=' + tok)).status, 404); // used once
    assert.equal((await client()('/api/cp-portal', { action: 'invite-start', ...det, username: 'tohfa2' })).status, 404);
    assert.equal((await P('/api/cp-portal?home=1')).stats.bookings, 3);
    assert.equal((await P('/api/cp-portal?bookings=1')).status, 403); // approved partners only
    assert.equal((await P('/api/cp-portal?bills=1')).status, 403);
    assert.equal((await P('/api/cp-portal', { action: 'bill-start', billNo: 'X' })).status, 403);
    assert.equal((await headacc('/api/partners', { action: 'invite', id: tohfa1, email: 'tohfa@example.com' })).status, 409); // on the portal now
    // papers, then Mubeen approves as usual
    assert.equal((await mub('/api/tm', { action: 'partner-status', id: tohfa1, status: 'approved' })).status, 400);
    for (const kd of ['pan', 'gst', 'rera', 'agreement']) await db.q("insert into cp_docs (cp_id, kind, how) values ($1, $2, 'test')", [tohfa1, kd]);
    assert.equal((await mub('/api/tm', { action: 'partner-status', id: tohfa1, status: 'approved' })).ok, true);
    tohfaBuyers = await db.q(`select y.name, y.phone, y.email from buyers y join booking_applicants a on a.buyer_id = y.id where a.booking_id = any($1::int[])`, [[freeBk[0].id, freeBk[1].id, freeBk[2].id]]);
    assert.ok(tohfaBuyers.length >= 3);
  });

  await step('My bookings & brokerage: the ledger\'s own figures across projects, verified payments only, and no buyer data at all', async () => {
    const r = await P('/api/cp-portal?bookings=1');
    assert.equal(r.status, 200, r.error);
    assert.equal(r.totals.flats, 3); assert.equal(r.projects.length, 1); assert.equal(r.projects[0].bookings.length, 3);
    const staff = await admin(`/api/partners?project=${sig.id}&cp=${tohfa1}`);
    assert.equal(r.totals.brokerage, staff.firm.brokerage); assert.equal(r.totals.balance, staff.firm.balance); assert.equal(r.totals.dueNow, staff.firm.dueNow);
    assert.equal(r.totals.paid, 1000); // the 500 not verified yet is not shown as paid
    const b2 = r.projects[0].bookings.find((x) => x.bookingId === freeBk[2].id); assert.equal(b2.paid, 1000); assert.ok(['Due', 'Not yet due', 'Paid'].includes(b2.state));
    const json = JSON.stringify(r);
    for (const y of tohfaBuyers) {
      assert.ok(!json.includes(y.name), 'buyer name leaked');
      const d = String(y.phone || '').replace(/\D/g, '').slice(-10); if (d) assert.ok(!json.includes(d), 'buyer phone leaked');
      if (y.email) assert.ok(!json.toLowerCase().includes(String(y.email).toLowerCase()), 'buyer email leaked');
    }
    assert.ok(!/buyer|applicant|"received"/i.test(json));
    // another partner never sees these
    const other = await A('/api/cp-portal?bookings=1'); assert.ok(!other.projects.some((p) => p.bookings.some((x) => [freeBk[0].id, freeBk[1].id, freeBk[2].id].includes(x.bookingId))));
  });

  await step('Bills: an approved partner sends a tax invoice (in parts), Accounts is told, opens it, checks or rejects it; the partner sees the status', async () => {
    const CB = require('../lib/cp-bills');
    const send = async (cli, meta, buf) => {
      const s = await cli('/api/cp-portal', { action: 'bill-start', ...meta, file: { name: 'bill.pdf', mime: meta.mime || 'application/pdf', size: buf.length } });
      if (!s.id) return s;
      for (let i = 0; i < s.parts; i++) { const p = await cli('/api/cp-portal', { action: 'bill-part', id: s.id, i, data: buf.subarray(i * s.part, (i + 1) * s.part).toString('base64') }); if (!p.ok) return p; }
      return cli('/api/cp-portal', { action: 'bill-finish', id: s.id });
    };
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(CB.PART + 5000, 32)]);
    const fl = (await P('/api/cp-portal?bills=1')).flats; assert.equal(fl.length, 3);
    const r = await send(P, { billNo: 'TP/26/001', billDate: '2026-10-20', amount: '20,000', gst: 3600, bookingIds: [freeBk[0].id] }, big);
    assert.equal(r.ok, true, r.error);
    assert.equal((await send(P, { billNo: 'tp/26/001', billDate: '2026-10-20', amount: 100, gst: 0 }, Buffer.from('%PDF-1.4 x'))).status, 409); // same number again
    assert.equal((await P('/api/cp-portal', { action: 'bill-start', billNo: 'TP2', billDate: '2026-10-20', amount: 100, gst: 0, file: { name: 'a.exe', mime: 'application/x-msdownload', size: 10 } })).status, 400);
    assert.equal((await P('/api/cp-portal', { action: 'bill-start', billNo: 'TP2', billDate: '2026-10-20', amount: 100, gst: 0, file: { name: 'a.pdf', mime: 'application/pdf', size: 6 * 1024 * 1024 } })).status, 400);
    assert.equal((await P('/api/cp-portal', { action: 'bill-start', billNo: 'TP2', billDate: '2099-01-01', amount: 100, gst: 0, file: { name: 'a.pdf', mime: 'application/pdf', size: 10 } })).status, 400);
    assert.equal((await P('/api/cp-portal', { action: 'bill-start', billNo: 'TP2', billDate: '2026-10-20', amount: 100, gst: 0, bookingIds: [freeBk[3].id], file: { name: 'a.pdf', mime: 'application/pdf', size: 10 } })).status, 400); // not their flat
    assert.equal((await send(P, { billNo: 'TP-FAKE', billDate: '2026-10-20', amount: 100, gst: 0 }, Buffer.from('MZ not a pdf'))).status, 400);
    const mine = await P('/api/cp-portal?bills=1'); assert.equal(mine.bills.length, 1); assert.equal(mine.bills[0].status, 'submitted'); assert.equal(mine.bills[0].total, 23600);
    assert.equal((await A('/api/cp-portal?bills=1')).bills.length, 0); // another firm sees none
    // Accounts is told: Dream Chat, the To-Do
    assert.ok(await db.one("select 1 as x from team_messages where to_team = 'accounts' and needs_action and body like '%TP/26/001%'"));
    assert.ok(await db.one("select 1 as x from daily_tasks where dept = 'accounts' and key = 'cp-bills' and count = 1"));
    assert.equal((await CB.finding()).count, 1); // and on the morning audit's list
    // staff open the bill and check it
    assert.equal((await crm('/api/partners?bills=1')).status, 200); // brokerage.bill
    assert.equal((await entry('/api/partners?bills=1')).status, 403);
    const L = await accEntry('/api/partners?bills=1&status=submitted'); const bill = L.rows.find((x) => x.bill_no === 'TP/26/001'); assert.ok(bill); assert.equal(L.canCheck, true);
    const parts = []; let f0;
    for (let i = 0; ; i++) { const p = await accEntry(`/api/partners?billfile=${bill.id}&part=${i}`); f0 = p; parts.push(Buffer.from(p.data, 'base64')); if (i >= p.parts - 1) break; }
    assert.ok(Buffer.concat(parts).equals(big)); assert.equal(f0.mime, 'application/pdf');
    assert.equal((await accEntry('/api/partners', { action: 'cp-bill-check', id: bill.id, decision: 'rejected' })).status, 400); // reason needed
    const ck = await accEntry('/api/partners', { action: 'cp-bill-check', id: bill.id, decision: 'checked' }); assert.ok(ck.entryId, ck.error);
    assert.equal((await accEntry('/api/partners', { action: 'cp-bill-check', id: bill.id, decision: 'checked' })).status, 409);
    const led = await admin(`/api/partners?project=${sig.id}&cp=${tohfa1}`); assert.equal(led.firm.billed, 20000);
    assert.equal((await P('/api/cp-portal?bills=1')).bills[0].status, 'checked');
    // a second bill, rejected with a reason the partner sees; the number can then be sent again
    const r2 = await send(P, { billNo: 'TP/26/002', billDate: '2026-10-21', amount: 5000, gst: 900 }, Buffer.from('%PDF-1.4 y')); assert.ok(r2.ok, r2.error);
    const b2 = (await accEntry('/api/partners?bills=1&status=submitted')).rows.find((x) => x.bill_no === 'TP/26/002');
    assert.ok((await accEntry('/api/partners', { action: 'cp-bill-check', id: b2.id, decision: 'rejected', reason: 'GSTIN missing on the bill' })).ok);
    const mb = (await P('/api/cp-portal?bills=1')).bills.find((x) => x.billNo === 'TP/26/002'); assert.equal(mb.status, 'rejected'); assert.equal(mb.reason, 'GSTIN missing on the bill');
    assert.ok((await send(P, { billNo: 'TP/26/002', billDate: '2026-10-21', amount: 5000, gst: 900 }, Buffer.from('%PDF-1.4 z'))).ok);
    // at most 20 a day
    await db.q("insert into cp_bills (cp_id, bill_no, bill_date, amount, status) select $1, 'RL-' || g, current_date, 1, 'rejected' from generate_series(1, 20) g", [tohfa1]);
    const lim = await P('/api/cp-portal', { action: 'bill-start', billNo: 'TP-LIM', billDate: '2026-10-21', amount: 100, gst: 0, file: { name: 'a.pdf', mime: 'application/pdf', size: 10 } }); assert.equal(lim.status, 429);
  });

  await step('The partners site answers only the partner portal API (the staff partner calls are not reachable there)', async () => {
    const { route } = require('../lib/http');
    let code = 0; const res = { setHeader() {}, status(c) { code = c; return { json() {} }; } };
    await route({ GET: async () => { code = 200; } })({ method: 'GET', url: '/api/partners?portal=1', headers: { host: 'partners.dreamindiarealty.com' } }, res); assert.equal(code, 404);
    await route({ GET: async () => { code = 200; } })({ method: 'GET', url: '/api/cp-portal?bookings=1', headers: { host: 'partners.dreamindiarealty.com' } }, res); assert.equal(code, 200);
    for (const f of ['/partner.js', '/partner.css']) assert.equal((await fetch(BASE + f)).status, 200);
  });

  console.log(`\nPartner & Telemarketing: ${n} checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
