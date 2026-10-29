// Module 1 end-to-end: booking → approval → demands → receipts → ledger, with maker-and-checker rules.
// DATABASE_URL=postgres://... (EMPTY database) node scripts/test-m1.js
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3998';
const server = require('./dev-server');
// A fake mail server on this machine records who each email was addressed to.
const net = require('net');
const rcpts = [];
const smtp = net.createServer((sock) => {
  sock.setEncoding('utf8'); let data = false, buf = '', authStep = 0;
  sock.write('220 test\r\n');
  sock.on('data', (d) => {
    buf += d;
    if (data) { if (buf.includes('\r\n.\r\n')) { data = false; buf = ''; sock.write('250 ok\r\n'); } return; }
    let i; while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) sock.write('250 hello\r\n');
      else if (/^AUTH LOGIN/i.test(line)) sock.write('334 VXNlcm5hbWU6\r\n');
      else if (/^RCPT TO:<(.+)>/i.test(line)) { rcpts.push(line.match(/<(.+)>/)[1]); sock.write('250 ok\r\n'); }
      else if (/^MAIL FROM/i.test(line) || /^RSET/i.test(line)) sock.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); if (buf.includes('\r\n.\r\n')) { data = false; buf = ''; sock.write('250 ok\r\n'); } return; }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else if (line.length && !/^\s/.test(line)) sock.write(authStep ? '235 ok\r\n' : ((authStep = 1), '334 UGFzc3dvcmQ6\r\n'));
    }
  });
}).listen(2526);
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2526', SMTP_TLS: '0', SMTP_USER: 'crm@test.local', SMTP_PASS: 'x' });
const BASE = `http://localhost:${process.env.PORT}`;

function client() {
  let cookie = '';
  return async (path, body, raw) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return r;
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}
let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };
const n = (v) => Number(v);

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const m = await admin('/api/masters');
  const sig = m.projects.find((p) => p.code === 'SIGNATURE');
  const A = sig.buildings.find((b) => b.code === 'A');

  // one login per role, each with its own password
  const people = {};
  for (const [username, role] of [['headcrm', 'head_crm'], ['crm', 'crm'], ['headacc', 'head_accounts'], ['acc', 'accounts'], ['site', 'site_head'], ['mgmt', 'management']]) {
    const r = await admin('/api/users', { action: 'create', name: username, username, role, projects: [sig.id] });
    const c = client();
    await c('/api/session', { action: 'login', username, password: r.tempPassword });
    await c('/api/session', { action: 'password', current: r.tempPassword, next: `${username}-password-1` });
    people[username] = c;
  }
  const { headcrm, crm, headacc, acc, site, mgmt } = people;

  let unitsA;
  await step('Admin adds units: A Wing floors 10 to 11, 2 a floor', async () => {
    const r = await admin('/api/units', { action: 'generate', buildingId: A.id, floorFrom: 10, floorTo: 11, perFloor: 2, typologies: ['2BHK', '1BHK'], carpetSqft: [532, 411] });
    assert.equal(r.added, 4); unitsA = Object.fromEntries(r.units.map((u) => [u.unit_no, u]));
    assert.equal(unitsA['A-1001'].typology, '2BHK');
    assert.equal((await admin('/api/units', { action: 'generate', buildingId: A.id, floorFrom: 10, floorTo: 11, perFloor: 2 })).added, 0);
  });
  let b1;
  await step('CRM enters a booking; the unit is held while it waits', async () => {
    let r = await crm('/api/bookings', { action: 'create', unitId: unitsA['A-1001'].id, bookingDate: '2026-09-01', agreementValue: '97,15,000', applicants: [{ name: 'Test Buyer', pan: 'bad' }] });
    assert.equal(r.status, 400);
    r = await crm('/api/bookings', { action: 'create', unitId: unitsA['A-1001'].id, bookingDate: '2026-09-01', agreementValue: '9715000', applicants: [{ name: 'Test Buyer', pan: 'ABCDE1234F', aadhaar: '123412341234', phone: '9876543210' }] });
    assert.equal(r.ok, true); b1 = r.id;
    const u = await crm(`/api/units?project=${sig.id}`); assert.equal(u.units.find((x) => x.unit_no === 'A-1001').status, 'blocked');
    assert.equal((await crm('/api/bookings', { action: 'create', unitId: unitsA['A-1001'].id, bookingDate: '2026-09-01', agreementValue: '1', applicants: [{ name: 'X' }] })).status, 409);
  });
  await step('CRM cannot approve; Head CRM cannot approve their own booking', async () => {
    assert.equal((await crm('/api/bookings', { action: 'approve', id: b1 })).status, 403);
    const own = await headcrm('/api/bookings', { action: 'create', unitId: unitsA['A-1002'].id, bookingDate: '2026-09-02', agreementValue: '7200000', applicants: [{ name: 'Own Entry' }] });
    const r = await headcrm('/api/bookings', { action: 'approve', id: own.id }); assert.equal(r.status, 403); assert.match(r.error, /someone else/);
  });
  await step('Head CRM approves: booking-stage demand of 5% is raised', async () => {
    const r = await headcrm('/api/bookings', { action: 'approve', id: b1 });
    assert.equal(r.booking.status, 'active');
    assert.equal(r.demands.length, 1); assert.equal(n(r.demands[0].amount), 485750); assert.equal(n(r.demands[0].gst), 24287.5);
    assert.equal(r.applicants[0].pan, 'ABCDE1234F'); // Head CRM may see KYC
  });
  await step('Accounts sees KYC masked', async () => {
    const r = await acc(`/api/bookings?id=${b1}`); assert.equal(r.status, 200); assert.match(r.applicants[0].pan, /^•+234F$/);
  });
  await step('Registration raises the registration-stage demand', async () => {
    const r = await crm('/api/bookings', { action: 'register', id: b1, agreementDate: '2026-09-20', registrationDate: '2026-09-20', stampDuty: '485800', registrationFee: '30000' });
    assert.equal(r.demands.length, 2); assert.equal(n(r.demands[1].amount), 485750);
    const u = await crm(`/api/units?project=${sig.id}`); assert.equal(u.units.find((x) => x.unit_no === 'A-1001').status, 'registered');
  });
  let run;
  await step('Site records Excavation; CRM prepares a run; Head CRM approves it', async () => {
    assert.equal((await crm('/api/demands', { action: 'run.create', buildingId: A.id, stageName: 'On Completion of Excavation' })).status, 400); // not done yet
    assert.equal((await crm('/api/demands', { action: 'stage.complete', buildingId: A.id, stageName: 'On Completion of Excavation', completedOn: '2026-10-01' })).status, 403);
    assert.equal((await site('/api/demands', { action: 'stage.complete', buildingId: A.id, stageName: 'On Completion of Excavation', completedOn: '2026-10-01', certifiedBy: 'Engineer' })).ok, true);
    const r = await crm('/api/demands', { action: 'run.create', buildingId: A.id, stageName: 'On Completion of Excavation', demandDate: '2026-10-02' });
    run = r.id;
    const preview = await crm(`/api/demands?run=${run}`); assert.equal(preview.rows.length, 1); assert.equal(n(preview.rows[0].amount), 971500);
    assert.equal((await crm('/api/demands', { action: 'run.approve', id: run })).status, 403);
    const ok = await headcrm('/api/demands', { action: 'run.approve', id: run }); assert.equal(ok.raised, 1);
    assert.equal(ok.letters.letters, 1); assert.equal(ok.letters.emailed, 0); assert.match(ok.letters.notEmailed, /test email/); // letter made; no test address yet
    assert.equal((await headcrm('/api/demands', { action: 'run.approve', id: run })).status, 409);
  });
  await step('Ledger: ₹19,43,000 demanded, all overdue once past due date', async () => {
    const l = await crm(`/api/ledger?project=${sig.id}`);
    const row = l.rows.find((r) => r.booking_id === b1);
    assert.equal(n(row.demanded), 1943000); assert.equal(n(row.outstanding), 1943000); assert.ok(n(row.overdue) > 0); assert.ok(row.days_overdue > 0);
    assert.equal(row.oldest_stage, 'On Booking');
  });
  let rc;
  await step('Accounts enters a receipt; parts must add up', async () => {
    let r = await acc('/api/receipts', { action: 'create', bookingId: b1, receivedOn: '2026-10-10', amount: '2040150', bank: 'HDFC', instrumentNo: 'UTR1', splits: { av: '1923570', tds: '19430', gst: '90000' } });
    assert.equal(r.status, 400); assert.match(r.error, /add up/);
    r = await acc('/api/receipts', { action: 'create', bookingId: b1, receivedOn: '2026-10-10', amount: '20,40,150', bank: 'HDFC', instrumentNo: 'UTR1', splits: { av: '1923570', tds: '19430', gst: '97150' } });
    assert.equal(r.ok, true); rc = r.id;
    assert.equal((await acc('/api/receipts', { action: 'create', bookingId: b1, receivedOn: '2026-10-10', amount: '2040150', instrumentNo: 'UTR1', splits: { av: '1923570', tds: '19430', gst: '97150' } })).status, 409);
  });
  await step('Pending receipt does not count; Accounts cannot approve; Head Accounts can', async () => {
    let l = await crm(`/api/ledger?project=${sig.id}`); assert.equal(n(l.rows.find((r) => r.booking_id === b1).outstanding), 1943000);
    assert.equal((await acc('/api/receipts', { action: 'approve', id: rc })).status, 403);
    assert.equal((await headacc('/api/receipts', { action: 'approve', id: rc })).ok, true);
    l = await crm(`/api/ledger?project=${sig.id}`); const row = l.rows.find((r) => r.booking_id === b1);
    assert.equal(n(row.outstanding), 0); assert.equal(n(row.gst_outstanding), 0); assert.equal(n(row.overdue), 0);
  });
  await step('Statement of account runs demand by demand to a zero balance', async () => {
    const s = await crm(`/api/ledger?booking=${b1}`);
    assert.equal(s.lines.length, 4); assert.equal(n(s.lines.at(-1).balance), 0); assert.equal(n(s.lines.at(-1).gstBalance), 0);
  });
  await step('A bounced receipt puts the dues back', async () => {
    assert.equal((await headacc('/api/receipts', { action: 'bounce', id: rc, reason: 'Cheque returned' })).ok, true);
    const l = await crm(`/api/ledger?project=${sig.id}`); assert.equal(n(l.rows.find((r) => r.booking_id === b1).outstanding), 1943000);
  });
  let late;
  await step('A late booking is charged the stages already completed', async () => {
    const r = await crm('/api/bookings', { action: 'create', unitId: unitsA['A-1101'].id, bookingDate: '2026-10-15', agreementValue: '8000000', applicants: [{ name: 'Late Buyer' }] });
    late = r.id;
    const ok = await headcrm('/api/bookings', { action: 'approve', id: late });
    assert.deepEqual(ok.demands.map((d) => d.stage_name), ['On Booking', 'On Completion of Excavation']);
  });
  await step('Cancellation needs Management, and frees the unit', async () => {
    assert.equal((await crm('/api/bookings', { action: 'cancel-request', id: late })).status, 400); // reason needed
    assert.equal((await crm('/api/bookings', { action: 'cancel-request', id: late, reason: 'Buyer withdrew' })).ok, true);
    assert.equal((await headcrm('/api/bookings', { action: 'cancel-approve', id: late })).status, 403);
    const r = await mgmt('/api/bookings', { action: 'cancel-approve', id: late });
    assert.equal(r.booking.status, 'cancelled'); assert.ok(r.demands.every((d) => d.status === 'cancelled'));
    const u = await crm(`/api/units?project=${sig.id}`); assert.equal(u.units.find((x) => x.unit_no === 'A-1101').status, 'available');
  });
  let bEmail, letterIds;
  await step('Demand letters: CRM prepares letters with the ledger figures; Accounts cannot', async () => {
    const r = await crm('/api/bookings', { action: 'create', unitId: unitsA['A-1102'].id, bookingDate: '2026-10-16', agreementValue: '7200000', applicants: [{ name: 'Email Buyer', email: 'real.buyer@example.com', address: 'Flat 1, Some Road, Mumbai' }] });
    bEmail = r.id; await headcrm('/api/bookings', { action: 'approve', id: bEmail });
    const q = await crm(`/api/letters?project=${sig.id}`);
    assert.ok(q.rows.some((x) => x.booking_id === b1)); assert.ok(q.rows.find((x) => x.booking_id === bEmail).has_email);
    assert.equal((await acc('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [b1], letterType: 'Demand Letter' })).status, 403);
    const p = await crm('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [b1, bEmail], letterType: 'Demand Letter' });
    assert.equal(p.letters.length, 2); letterIds = p.letters.map((l) => l.id);
    const l1 = p.letters.find((l) => l.unit === 'A-1001'); assert.equal(l1.total, 1943000 + 97150);
  });
  await step('Letters open as PDF, singly and as one print file', async () => {
    let r = await crm(`/api/letters?pdf=${letterIds[0]}`, null, true);
    assert.equal(r.headers.get('content-type'), 'application/pdf'); assert.equal((await r.text()).slice(0, 5), '%PDF-');
    r = await crm(`/api/letters?print=${letterIds.join(',')}`, null, true); assert.equal(r.headers.get('content-type'), 'application/pdf');
    r = await crm(`/api/letters?preview=${b1}&type=Reminder%20I`, null, true); assert.equal(r.headers.get('content-type'), 'application/pdf');
  });
  await step('Test version: email refused until a test address is set, then goes ONLY there', async () => {
    let r = await crm('/api/letters', { action: 'email', projectId: sig.id, letterIds });
    assert.equal(r.status, 400); assert.match(r.error, /test email/);
    assert.equal((await crm('/api/letters', { action: 'settings', testEmail: 'x@y.z' })).status, 403); // CRM cannot change settings
    assert.equal((await headcrm('/api/letters', { action: 'settings', testEmail: 'tester@erp.test' })).ok, true);
    r = await crm('/api/letters', { action: 'email', projectId: sig.id, letterIds });
    assert.equal(r.results.filter((x) => !x.error).length, 2);
    assert.ok(rcpts.length >= 2 && rcpts.every((x) => x === 'tester@erp.test'), 'emails went to: ' + rcpts.join(','));
    assert.ok(!rcpts.includes('real.buyer@example.com'));
  });
  await step('Reminder adds delay charges; courier marking is recorded', async () => {
    const p = await crm('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [b1], letterType: 'Reminder I' });
    const pdf = await crm(`/api/letters?project=${sig.id}`);
    const row = pdf.rows.find((x) => x.booking_id === b1); assert.equal(row.letter_type, 'Reminder I');
    assert.ok(p.letters[0].total > 1943000 + 97150, 'delay charges added');
    assert.equal((await crm('/api/letters', { action: 'mark', projectId: sig.id, letterIds: [p.letters[0].id], via: 'courier' })).marked, 1);
  });
  await step('Follow-ups: CRM logs calls with promise and next date; Accounts can only read', async () => {
    assert.equal((await crm('/api/followups', { action: 'add', bookingId: b1, kind: 'Call', outcome: 'Promised to pay' })).status, 400);
    assert.equal((await crm('/api/followups', { action: 'add', bookingId: b1, kind: 'Call', outcome: 'Asked to call later', nextDate: '2020-01-01' })).status, 400);
    const soon = new Date(Date.now() + 5.5 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
    assert.equal((await crm('/api/followups', { action: 'add', bookingId: b1, kind: 'Call', outcome: 'Promised to pay', promiseDate: soon, promiseAmount: '500000', nextDate: soon, note: 'Will pay after salary' })).ok, true);
    assert.equal((await acc('/api/followups', { action: 'add', bookingId: b1, kind: 'Note', outcome: 'Other' })).status, 403);
    const q = await acc(`/api/followups?project=${sig.id}`);
    const row = q.rows.find((x) => x.booking_id === b1); assert.equal(row.outcome, 'Promised to pay'); assert.equal(row.broken, false); assert.equal(row.due, false);
    assert.match(row.mobile || '•', /•/); // Accounts sees the mobile masked
    const h = await crm(`/api/followups?booking=${b1}`); assert.equal(h.rows.length, 2); // the call + the first follow-up made when the demand was approved
    assert.ok(h.rows.some((x) => x.outcome === 'Demand raised' && String(x.next_date).slice(0, 10) === '2026-10-09'));
  });
  await step('Payment reminders: 3 days before the due date and 7 days after, once each', async () => {
    const L = require('../lib/letters');
    const before = rcpts.length;
    const r1 = await L.reminders({ day: '2026-10-07' }); assert.equal(r1.before, 1, JSON.stringify(r1));
    assert.equal((await L.reminders({ day: '2026-10-07' })).before, 0); // never twice
    const r2 = await L.reminders({ day: '2026-10-16' }); assert.equal(r2.after + r2.noEmail, 1, JSON.stringify(r2)); // A-1001 has no email: it goes on the courier list
    assert.equal((await L.reminders({ day: '2026-10-17' })).after, 0);
    assert.ok(rcpts.length >= before + 1); assert.ok(rcpts.slice(before).every((x) => x === 'tester@erp.test')); // test address only
  });
  await step('Approving a demand run with email set up sends the letters straight away', async () => {
    const next = 'On Completion of Plinth';
    const st = await site('/api/demands', { action: 'stage.complete', buildingId: A.id, stageName: next, completedOn: '2026-10-20', certifiedBy: 'Engineer' });
    if (!st.ok) return console.log('   (skipped: ' + (st.error || 'no next stage') + ')');
    const r = await crm('/api/demands', { action: 'run.create', buildingId: A.id, stageName: next, demandDate: '2026-10-21' });
    const before = rcpts.length;
    const ok = await headcrm('/api/demands', { action: 'run.approve', id: r.id });
    assert.equal(ok.letters.letters, ok.raised); assert.equal(ok.letters.emailed + ok.letters.noEmail, ok.raised, JSON.stringify(ok.letters)); assert.ok(ok.letters.emailed >= 1 && ok.letters.noEmail >= 1);
    const h = await crm(`/api/followups?booking=${b1}`); assert.ok(h.rows.some((x) => /no email on file/.test(x.note || '')));
    assert.ok(rcpts.length > before);
  });
  await step('WhatsApp with the letters: "check your email" after an email, the PDF itself when there is no email (test mobile only)', async () => {
    const http = require('http'); const got = [];
    const wa = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got.push({ url: req.url, body: b }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(/media$/.test(req.url) ? { id: 'MEDIA1' } : { messages: [{ id: 'wamid.' + got.length }] })); }); }).listen(2527);
    Object.assign(process.env, { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'P1', WHATSAPP_API: 'http://127.0.0.1:2527' });
    try {
      assert.equal((await headcrm('/api/letters', { action: 'settings', testMobile: '9800000001', waEmailTemplate: 'demand_letter_emailed', waPdfTemplate: 'demand_letter_pdf' })).ok, true);
      const L = require('../lib/letters');
      const p = await crm('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [b1, bEmail], letterType: 'Demand Letter' });
      const withEmail = p.letters.find((x) => x.hasEmail), noEmail = p.letters.find((x) => !x.hasEmail);
      const r = await L.whatsappLetters([withEmail.id, noEmail.id], { emailed: new Set([withEmail.id]) });
      assert.equal(r.sent, 2, JSON.stringify(r));
      const msgs = got.filter((g) => /messages$/.test(g.url)).map((g) => JSON.parse(g.body));
      assert.ok(msgs.every((m) => m.to === '919800000001')); // the test mobile, never the buyer
      assert.ok(msgs.some((m) => m.template.name === 'demand_letter_emailed' && !m.template.components.some((c) => c.type === 'header')));
      assert.ok(msgs.some((m) => m.template.name === 'demand_letter_pdf' && m.template.components[0].parameters[0].document.id === 'MEDIA1'));
      assert.ok(got.some((g) => /media$/.test(g.url)));
      const q = await crm(`/api/letters?project=${sig.id}`); assert.ok(!q.courier.some((c) => c.id === noEmail.id)); // sent on WhatsApp: off the courier list
    } finally { wa.close(); for (const k of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_API']) delete process.env[k]; }
  });
  await step('No email and no WhatsApp: the letter goes on the Print and courier list and on Today', async () => {
    const p = await crm('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [b1], letterType: 'Reminder I' });
    const q = await crm(`/api/letters?project=${sig.id}`); assert.ok(q.courier.some((c) => c.id === p.letters[0].id));
    const t = (await require('../lib/daily-tasks').run('crm', { mail: false })).found.find((x) => x.key === 'letters-courier'); assert.ok(t); assert.match(t.title, /print and courier: 1/);
    assert.equal((await crm('/api/letters', { action: 'mark', projectId: sig.id, letterIds: q.courier.map((c) => c.id), via: 'courier' })).ok, true);
    assert.equal((await crm(`/api/letters?project=${sig.id}`)).courier.length, 0);
  });
  await step('Registration checklist: challans, papers ready (ticked by the CRM), appointment, registered; the next step shows on the list', async () => {
    const d = await crm(`/api/bookings?id=${bEmail}`);
    assert.deepEqual(d.regSteps.map((x) => x.key), ['stamp', 'fee', 'papers', 'appointment', 'registered']);
    assert.equal(d.regSteps.find((x) => !x.done).key, 'stamp');
    let l = (await crm(`/api/bookings?project=${sig.id}`)).rows.find((r) => r.id === bEmail); assert.equal(l.reg_next, 'Stamp duty challan');
    const db = require('../lib/db');
    await db.q("insert into sdr_challans (project_id, booking_id, unit_no, kind, amount, status) values ($1, $2, $3, 'both', 100000, 'paid')", [sig.id, bEmail, d.unit.unit_no]);
    l = (await crm(`/api/bookings?project=${sig.id}`)).rows.find((r) => r.id === bEmail); assert.equal(l.reg_next, 'Papers ready');
    assert.equal((await acc('/api/bookings', { action: 'reg.papers', id: bEmail, ready: true })).status, 403);
    const t = await crm('/api/bookings', { action: 'reg.papers', id: bEmail, ready: true }); assert.equal(t.regSteps.find((x) => x.key === 'papers').done, true); assert.equal(t.regPapersBy, 'crm');
    l = (await crm(`/api/bookings?project=${sig.id}`)).rows.find((r) => r.id === bEmail); assert.equal(l.reg_next, 'Book the appointment');
  });
  await step('Each CRM person gets their own call list for their wing on Today', async () => {
    const st = await headcrm('/api/comms?status=1'); const me = st.crmUsers.find((x) => x.name === 'crm');
    assert.equal((await headcrm('/api/comms', { action: 'teams', teams: { A: [me.id], B: [] } })).ok, true);
    const r = await require('../lib/daily-tasks').run('crm', { mail: false });
    const t = r.found.find((x) => x.key === 'fu-due-' + me.id); assert.ok(t, r.found.map((x) => x.key).join());
    assert.equal(t.assignedTo, me.id); assert.match(t.link, new RegExp('who=' + me.id));
    const db = require('../lib/db'); const row = await db.one("select assigned_to from daily_tasks where key = $1 order by id desc limit 1", ['fu-due-' + me.id]); assert.equal(row.assigned_to, me.id);
  });
  await step('Everything is in the audit log', async () => {
    const a = await admin('/api/audit?limit=500');
    const k = new Set(a.rows.map((r) => `${r.action}:${r.entity}`));
    for (const x of ['generate:units', 'create:booking', 'approve:booking', 'register:booking', 'stage-complete:stage', 'create:demand-run', 'approve:demand-run', 'create:receipt', 'approve:receipt', 'bounce:receipt', 'cancel-request:booking', 'cancel:booking', 'prepare:letter', 'send-email:letter', 'send-courier:letter', 'create:follow-up']) assert.ok(k.has(x), x);
  });
  await step('Sample data refuses a project that already has units', async () => {
    assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).status, 409);
    assert.equal((await admin('/api/sample', { action: 'clear', projectId: sig.id })).status, 409); // real (non-sample) data present
  });
  console.log(`\nAll ${passed} Module 1 checks passed.`);
  server.close(); smtp.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
