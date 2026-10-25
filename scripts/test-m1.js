// Module 1 end-to-end: booking → approval → demands → receipts → ledger, with maker-and-checker rules.
// DATABASE_URL=postgres://... (EMPTY database) node scripts/test-m1.js
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3998';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;

function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
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
  await step('Everything is in the audit log', async () => {
    const a = await admin('/api/audit?limit=500');
    const k = new Set(a.rows.map((r) => `${r.action}:${r.entity}`));
    for (const x of ['generate:units', 'create:booking', 'approve:booking', 'register:booking', 'stage-complete:stage', 'create:demand-run', 'approve:demand-run', 'create:receipt', 'approve:receipt', 'bounce:receipt', 'cancel-request:booking', 'cancel:booking']) assert.ok(k.has(x), x);
  });
  await step('Sample data refuses a project that already has units', async () => {
    assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).status, 409);
    assert.equal((await admin('/api/sample', { action: 'clear', projectId: sig.id })).status, 409); // real (non-sample) data present
  });
  console.log(`\nAll ${passed} Module 1 checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
