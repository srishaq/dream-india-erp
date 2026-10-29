// Daily To-Do, the 9 am audit and training progress.
// DATABASE_URL=postgres://... node scripts/test-tasks.js   (an empty database)
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
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
const ist = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
  const mk = async (u, role) => { await db.q('insert into users (username, name, role, password_hash, all_projects) values ($1, $1, $2, $3, true)', [u, role, auth.hashPassword('pass-word-123')]); const c = client(); await c('/api/session', { action: 'login', username: u, password: 'pass-word-123' }); return c; };
  const crm = await mk('crm1', 'crm'), acc = await mk('acc1', 'accounts'), head = await mk('headacc', 'head_accounts'), sales = await mk('sales1', 'sales');
  const t = ist();
  await db.q("insert into acc_pdc (issued_to, amount, bank, due_date, cheque_no) values ('Sample Contractor', 100000, 'Sample Bank', $1, '000777')", [addDays(t, 1)]);
  await db.q("insert into acc_compliance (compliance, period, due_date, status) values ('GSTR-3B', 'Sep-2026', $1, 'Pending'), ('Old return', 'Jan-2026', $2, 'Pending'), ('Filed', 'Aug-2026', $1, 'Complied')", [addDays(t, -2), addDays(t, -200)]);
  const bk = await db.one("select u.unit_no, y.name from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id and a.seq = 1 join buyers y on y.id = a.buyer_id where b.status = 'active' order by u.unit_no limit 1");
  await db.q("insert into acc_cancellations (cancel_date, unit_no, client, received, refund_status, imported) values ($1, $2, $3, 500000, 'Pending', true)", [addDays(t, -30), bk.unit_no, bk.name]);

  let L;
  await step('who sees which list: CRM sees CRM, Accounts sees Accounts, Sales sees neither', async () => {
    assert.equal((await crm('/api/tasks?dept=crm')).status, 200);
    assert.equal((await crm('/api/tasks?dept=accounts')).status, 403);
    assert.equal((await acc('/api/tasks?dept=accounts')).status, 200);
    assert.equal((await sales('/api/tasks?dept=accounts')).status, 403);
    assert.equal((await admin('/api/tasks?dept=nope')).status, 403);
  });
  await step('the Accounts audit: PDC due tomorrow, compliance one by one and old ones as one line, cancelled flat still in the CRM', async () => {
    const r = await head('/api/tasks', { action: 'run', dept: 'accounts' });
    assert.equal(r.ok, true, r.error);
    L = await acc('/api/tasks?dept=accounts');
    const titles = L.rows.map((x) => x.title).join('\n');
    assert.match(titles, /PDC ₹1,00,000 to Sample Contractor is due on/);
    assert.match(titles, /GSTR-3B \(Sep-2026\) was due .*2 days late/);
    assert.match(titles, /Compliance items more than 15 days overdue: 1/);
    assert.doesNotMatch(titles, /Filed/);
    assert.match(titles, /Cancelled flats still booked in the CRM: 1/);
    assert.ok(L.rows.filter((x) => x.priority === 'high').length >= 3);
    assert.equal(L.can.run, false);
  });
  await step('the CRM list: buyers to call, and the cancelled flat to cancel in the CRM', async () => {
    assert.equal((await crm('/api/tasks', { action: 'run', dept: 'crm' })).status, 403); // only the head runs it
    const r = await admin('/api/tasks', { action: 'run', dept: 'crm' }); assert.equal(r.ok, true);
    const c = await crm('/api/tasks?dept=crm');
    const titles = c.rows.map((x) => x.title).join('\n');
    assert.match(titles, /Buyers to call today: \d+/);
    assert.match(titles, new RegExp(`${bk.unit_no}: .* is on the cancelled flats list .* but the CRM still shows the booking`));
  });
  await step('tick with a note, untick, give a line to a person; others cannot touch another team’s line', async () => {
    const line = L.rows.find((x) => x.source === 'audit');
    assert.equal((await acc('/api/tasks', { action: 'done', id: line.id, note: 'Done at the bank' })).ok, true);
    let x = (await acc('/api/tasks?dept=accounts')).rows.find((r) => r.id === line.id);
    assert.ok(x.done_at); assert.equal(x.done_note, 'Done at the bank'); assert.equal(x.done_name, 'acc1');
    assert.equal((await crm('/api/tasks', { action: 'done', id: line.id })).status, 403);
    assert.equal((await acc('/api/tasks', { action: 'undo', id: line.id })).ok, true);
    const accId = (await db.one("select id from users where username = 'acc1'")).id;
    assert.equal((await head('/api/tasks', { action: 'assign', id: line.id, userId: accId })).ok, true);
    assert.equal((await head('/api/tasks', { action: 'assign', id: line.id, userId: (await db.one("select id from users where username = 'sales1'")).id })).status, 400);
    x = (await acc('/api/tasks?dept=accounts')).rows.find((r) => r.id === line.id);
    assert.equal(x.assigned_name, 'acc1');
    assert.equal((await acc('/api/tasks', { action: 'remove', id: line.id })).status, 400); // audit lines are ticked, not removed
  });
  await step('running the audit again keeps what was ticked and clears what was fixed', async () => {
    const pdc = L.rows.find((x) => /^PDC/.test(x.title));
    const comp = L.rows.find((x) => /GSTR-3B/.test(x.title));
    await acc('/api/tasks', { action: 'done', id: comp.id, note: 'Filed' });
    await db.q("update acc_pdc set due_date = $1", [addDays(t, 20)]);
    await head('/api/tasks', { action: 'run', dept: 'accounts' });
    const rows = (await acc('/api/tasks?dept=accounts')).rows;
    const p = rows.find((x) => x.id === pdc.id), c = rows.find((x) => x.id === comp.id);
    assert.equal(p.cleared, true); assert.ok(p.done_at);
    assert.equal(c.cleared, false); assert.equal(c.done_note, 'Filed');
  });
  await step('own tasks: added, carried to the next day until ticked, removed only by the person who added it or the head', async () => {
    const a = await acc('/api/tasks', { action: 'add', dept: 'accounts', title: 'Collect the stamped statement' });
    assert.equal(a.ok, true);
    assert.equal((await acc('/api/tasks', { action: 'add', dept: 'accounts', title: '' })).status, 400);
    assert.equal((await crm('/api/tasks', { action: 'add', dept: 'accounts', title: 'x' })).status, 403);
    await db.q('update daily_tasks set task_date = $2, since = $2 where id = $1', [a.id, addDays(t, -2)]);
    let r = (await acc('/api/tasks?dept=accounts')).rows.find((x) => x.id === a.id);
    assert.ok(r, 'an open task from 2 days ago is on today’s list'); assert.equal(r.since, addDays(t, -2));
    const other = await mk('acc2', 'accounts');
    assert.equal((await other('/api/tasks', { action: 'remove', id: a.id })).status, 403);
    assert.equal((await head('/api/tasks', { action: 'remove', id: a.id })).ok, true);
  });
  await step('an earlier audit line not fixed keeps the date it was first found', async () => {
    await db.q("update daily_tasks set task_date = $1, since = $1, done_at = null, cleared = false where dept = 'accounts' and source = 'audit'", [addDays(t, -1)]);
    await db.q('delete from daily_audit_runs');
    const rows = (await acc('/api/tasks?dept=accounts')).rows; // opening the list runs today's audit if it has not run
    const old = rows.find((x) => /Compliance items more than 15 days/.test(x.title));
    if (new Date(Date.now() + 5.5 * 3600e3).getUTCHours() >= 9) { assert.equal(old.task_date, t); assert.equal(old.since, addDays(t, -1)); }
  });
  await step('the 9 am job: refused without the secret outside its hour', async () => {
    const r = await fetch(BASE + '/api/cron?job=morning');
    if (new Date(Date.now() + 5.5 * 3600e3).getUTCHours() !== 9) assert.equal(r.status, 403);
  });
  await step('cancellation: the buyer and money stay on record, Accounts gets the refund line, the flat can be booked again', async () => {
    const mg = await mk('mgmt1', 'management'), hc = await mk('headcrm1', 'head_crm');
    const bkr = await db.one(`select b.id, b.unit_id, u.unit_no, (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = b.id and r.status = 'approved' and s.head in ('av', 'gst', 'other')) as got
      from bookings b join units u on u.id = b.unit_id where b.status = 'active' and exists (select 1 from receipts r where r.booking_id = b.id and r.status = 'approved') order by u.unit_no desc limit 1`);
    assert.equal((await crm('/api/bookings', { action: 'cancel-request', id: bkr.id, reason: 'Buyer moving abroad', charges: 'abc' })).status, 400);
    const rq = await crm('/api/bookings', { action: 'cancel-request', id: bkr.id, reason: 'Buyer moving abroad', cancelDate: t, charges: '25,000' });
    assert.equal(rq.ok, true, rq.error);
    assert.equal((await crm('/api/bookings', { action: 'cancel-approve', id: bkr.id })).status, 403);
    const ok = await mg('/api/bookings', { action: 'cancel-approve', id: bkr.id }); assert.equal(ok.ok, true, ok.error);
    const row = await db.one('select * from acc_cancellations where booking_id = $1', [bkr.id]);
    assert.ok(row, 'the Cancelled flats register has the line');
    assert.equal(Number(row.received), Number(bkr.got)); assert.equal(Number(row.deduction), 25000);
    assert.equal(Number(row.refund_due), Math.max(0, Number(bkr.got) - 25000)); assert.equal(row.refund_status, 'Pending');
    assert.equal((await db.one('select status from units where id = $1', [bkr.unit_id])).status, 'available');
    assert.equal((await db.one('select count(*)::int as n from receipts where booking_id = $1', [bkr.id])).n > 0, true, 'receipts are kept');
    const old = await crm(`/api/bookings?id=${bkr.id}`);
    assert.equal(old.booking.status, 'cancelled'); assert.ok(old.applicants.length); assert.equal(Number(old.cancellation.refund_due), Number(row.refund_due)); assert.equal(old.current, null);
    const plan = (await db.one('select plan_id from bookings where id = $1', [bkr.id])).plan_id;
    const nb = await crm('/api/bookings', { action: 'create', unitId: bkr.unit_id, planId: plan, bookingDate: t, agreementValue: 9000000, gstRate: 5, parking: 0, funding: 'self', applicants: [{ name: 'New Buyer After Cancel' }] });
    assert.equal(nb.ok, true, nb.error);
    const ap = await hc('/api/bookings', { action: 'approve', id: nb.id }); assert.equal(ap.ok, true, ap.error);
    const now = await crm(`/api/bookings?id=${nb.id}`);
    assert.equal(now.earlier.length, 1); assert.equal(now.earlier[0].id, bkr.id);
    assert.equal((await crm(`/api/bookings?id=${bkr.id}`)).current.id, nb.id);
    // Accounts records the refund; the old booking shows it
    await db.q("update acc_cancellations set refund_rtgs = refund_due, refund_status = 'DONE' where booking_id = $1", [bkr.id]);
    assert.equal((await crm(`/api/bookings?id=${bkr.id}`)).cancellation.refund_status, 'DONE');
    const calc = await require('../lib/cancellations').calc([await db.one('select * from acc_cancellations where booking_id = $1', [bkr.id])]);
    assert.match(calc[0].crm_now, /Cancelled in the ERP; re-booked to New Buyer After Cancel/); assert.equal(calc[0].to_refund, 0);
  });
  await step('training: modules, marking a video watched, and the Admin sees who watched what', async () => {
    const d = await crm('/api/training');
    assert.ok(d.modules.length >= 9); assert.equal(d.team, null);
    assert.equal((await crm('/api/training', { action: 'watched', module: 'start' })).ok, true);
    assert.equal((await crm('/api/training', { action: 'watched', module: 'nope' })).status, 400);
    const a = await admin('/api/training');
    assert.ok(a.team.find((x) => x.name === 'crm1').watched.start);
  });
  console.log(`\n${n} steps passed.`);
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
