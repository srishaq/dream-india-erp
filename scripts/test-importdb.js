// Import end-to-end against an EMPTY database, using the sheet slice in scripts/fixtures.
// DATABASE_URL=postgres://... node scripts/test-importdb.js
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3997';
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const num = Number;
(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  await step('sample data with a letter and a follow-up is loaded first', async () => {
    assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
    const l = await admin(`/api/ledger?project=${sig.id}`);
    const bid = l.rows.find((r) => num(r.outstanding) > 0).booking_id;
    await admin('/api/letters', { action: 'prepare', projectId: sig.id, bookingIds: [bid], letterType: 'Demand Letter' });
    await admin('/api/followups', { action: 'add', bookingId: bid, kind: 'Call', outcome: 'Other' });
  });
  let pv;
  await step('preview reads the sheet and suggests stage dates; nothing is saved', async () => {
    pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
    assert.equal(pv.summary.bookings, 6); assert.equal(pv.summary.units, 8);
    assert.equal(pv.stageDates['B|On Completion of Plinth'], '2026-05-25');
    assert.equal(pv.stageDates['B|On Completion of Excavation'], null); // no B buyer is exactly at excavation: user must enter it
    const s = await admin(`/api/import?project=${sig.id}`); assert.ok(s.counts.sample > 0); assert.equal(s.counts.real, 0);
  });
  await step('import refuses until every stage date is given', async () => {
    const r = await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: {} });
    assert.equal(r.status, 400); assert.match(r.error, /B wing: On Completion of Excavation/);
  });
  await step('import replaces the sample data and brings in bookings, receipts and items to verify', async () => {
    const r = await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } });
    assert.equal(r.ok, true, r.error); assert.equal(r.bookings, 6); assert.ok(r.receipts > 10); assert.ok(r.issues > 5);
    const s = await admin(`/api/import?project=${sig.id}`); assert.equal(s.counts.sample, 0); assert.equal(s.counts.real, 8);
  });
  await step('A-1001 ledger matches the CRM sheet: AV fully paid, TDS ahead', async () => {
    const l = await admin(`/api/ledger?project=${sig.id}`);
    const a = l.rows.find((r) => r.unit_no === 'A-1001');
    assert.equal(num(a.demanded), 1943000); assert.equal(num(a.received_av), 1943000); assert.equal(num(a.received_tds), 4858); assert.equal(num(a.outstanding), 0); assert.equal(num(a.gst_outstanding), 0);
    const b = l.rows.find((r) => r.unit_no === 'B-1001'); assert.equal(num(b.demanded), 3521621.7); // 30% of 1,17,38,739
  });
  await step('stages demanded are recorded, so new bookings are charged them', async () => {
    const d = await admin(`/api/demands?project=${sig.id}`);
    const names = d.done.map((x) => x.stage_name); assert.ok(names.includes('On Completion of Excavation') && names.includes('On Completion of Plinth'));
  });
  await step('the CRM remark comes in as a follow-up note', async () => {
    const bid = (await admin(`/api/ledger?project=${sig.id}`)).rows.find((r) => r.unit_no === 'A-1001').booking_id;
    const f = await admin(`/api/followups?booking=${bid}`); assert.match(f.rows[0].note, /^Remark from CRM sheet: 29\.08\.26/);
  });
  await step('Data to verify lists the items; they can be closed with a note and reopened', async () => {
    const v = await admin(`/api/verify?project=${sig.id}`);
    assert.ok(v.counts.open > 5 && v.counts.money > 0);
    const shared = v.rows.find((r) => r.kind === 'shared-instrument' && r.unit_no === 'A-1007'); assert.ok(shared && shared.booking_id);
    assert.equal((await admin('/api/verify', { action: 'resolve', id: shared.id })).status, 400);
    assert.equal((await admin('/api/verify', { action: 'resolve', id: shared.id, resolution: 'One cheque covered both A-1007 and A-1008 (same family); split confirmed with Accounts.' })).ok, true);
    const after = await admin(`/api/verify?project=${sig.id}`); assert.equal(after.counts.resolved, 1);
    const per = await admin(`/api/verify?booking=${shared.booking_id}`); assert.equal(per.rows.find((x) => x.id === shared.id).status, 'resolved');
  });
  await step('the import cannot run a second time', async () => {
    const r = await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } });
    assert.equal(r.status, 409);
  });
  await step('the dashboard works from ERP records: totals, follow-up status, daily collections, schedule', async () => {
    const m = await admin(`/api/dashboard?project=${sig.id}`);
    assert.equal(m.totals.booked, 6); assert.equal(m.totals.units, 8);
    const a1 = m.units.find((u) => u.unit === 'A-1001'); assert.equal(a1.followStatus, 'No Due'); assert.equal(a1.receivedAV, 1943000); assert.equal(a1.tds, 97150); assert.equal(a1.tdsPaid, 4858);
    assert.equal(m.units.find((u) => u.unit === 'A-1105').followStatus, 'Defaulter');
    assert.equal(m.units.find((u) => u.unit === 'A-1006').inventory, 'Aslam/Management');
    assert.equal(m.actions.defaulters.length, 1);
    const day = m.daily.find((d) => d.date === '2026-01-01'); assert.equal(day.receipts, 594772); assert.equal(day.crm, 544772); assert.equal(day.sales, 50000);
    assert.equal(m.daily.find((d) => d.date === '2026-01-02').returns, 50000); assert.ok(!m.daily.some((d) => d.date === '2026-01-03')); // internal transfer left out
    assert.equal(m.daily.find((d) => d.date === '2026-01-01').items.find((i) => i.unit === 'A-1006').mode, 'Cheque');
    const t = m.paymentSchedule.total; assert.ok(Math.abs(t.due - m.totals.agreementValue) < 1); assert.ok(Math.abs(t.received - (m.totals.receivedAV + m.totals.receivedTDS)) < 1);
    assert.ok(m.checks.open > 5);
  });
  await step('the dashboard is closed to roles without access to dues', async () => {
    const c = await admin('/api/users', { action: 'create', name: 'Sales One', username: 'sales1', role: 'sales', projects: [sig.id] });
    const s = client(); await s('/api/session', { action: 'login', username: 'sales1', password: c.tempPassword });
    await s('/api/session', { action: 'password', current: c.tempPassword, next: 'sales-password-1' });
    const r = await s(`/api/dashboard?project=${sig.id}`); assert.equal(r.status, 403); assert.match(r.error, /role/);
  });
  await step('test version: the import can be cleared and run again', async () => {
    assert.equal((await admin('/api/import', { action: 'reset', projectId: sig.id, confirm: 'nope' })).status, 400);
    const r = await admin('/api/import', { action: 'reset', projectId: sig.id, confirm: 'CLEAR' }); assert.equal(r.ok, true, r.error); assert.equal(r.removedUnits, 8);
    const s = await admin(`/api/import?project=${sig.id}`); assert.equal(s.counts.real, 0); assert.equal(s.last, null);
    const again = await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } });
    assert.equal(again.ok, true, again.error); assert.equal(again.bookings, 6);
    process.env.ERP_LIVE = '1';
    assert.equal((await admin('/api/import', { action: 'reset', projectId: sig.id, confirm: 'CLEAR' })).status, 403);
    delete process.env.ERP_LIVE;
  });
  console.log(`\nAll ${n} import checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
