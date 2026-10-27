// Cheques followed to the bank, and CRM ↔ Accounts messages.
// DATABASE_URL=postgres://... node scripts/test-cheques.js   (an empty database)
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3994';
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
const server = require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
const day = (k) => new Date(Date.now() + 5.5 * 3600000 + k * 864e5).toISOString().slice(0, 10);
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
  assert.equal((await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } })).ok, true);
  const bks = (await admin(`/api/bookings?project=${sig.id}`)).rows.filter((r) => r.status === 'active');
  const [b1, b2] = bks;
  await db.q("insert into users (username, name, role, password_hash) values ('hcrm', 'Head CRM', 'head_crm', 'x')");
  const acc = (ref, unit, amount, on = day(0), st = 'Cleared') => db.one(`insert into acc_receipts (book, ref_id, txn_date, bank, description, reference, amount, unit_no, on_statement, cheque_status, source)
    values ('signature', $1, $2, 'PRIME HDFC', $3, $4, $5, $6, 'Yes', $7, 'test') returning id`, ['BS' + Math.floor(Math.random() * 1e5), on, `CHQ DEP ${ref || ''} ${unit || ''}`, ref, amount, unit, st]);
  let r1, r2, line1;

  await step('the CRM enters a cheque: "with CRM", then given to Accounts, then deposited', async () => {
    const c = await admin('/api/receipts', { action: 'create', bookingId: b1.id, receivedOn: day(-1), amount: 100000, mode: 'cheque', bank: 'SBI', instrumentNo: '004512', splits: { av: 100000 } });
    assert.equal(c.ok, true, c.error); r1 = c.id;
    let row = (await admin(`/api/receipts?project=${sig.id}`)).rows.find((x) => x.id === r1);
    assert.equal(row.status, 'pending'); assert.equal(row.bank_status, null); assert.equal(row.handed_on, null);
    assert.equal((await admin('/api/receipts', { action: 'handed', id: r1 })).ok, true);
    assert.equal((await admin('/api/receipts', { action: 'deposited', id: r1, on: day(0) })).ok, true);
    assert.equal((await admin('/api/receipts', { action: 'deposited', id: r1, on: day(3) })).status, 400, 'no future date');
    row = (await admin(`/api/receipts?project=${sig.id}`)).rows.find((x) => x.id === r1);
    assert.ok(row.handed_on && row.deposited_on);
  });
  await step('the bank statement line with that cheque number: linked and approved by the bank statement', async () => {
    line1 = (await acc('4512', null, 100000)).id; // leading zeros dropped by the bank
    const o = await admin('/api/receipts', { action: 'bankcheck' });
    assert.equal(o.linked, 1); assert.equal(o.approved, 1);
    const row = (await admin(`/api/receipts?project=${sig.id}`)).rows.find((x) => x.id === r1);
    assert.equal(row.status, 'approved'); assert.equal(row.bank_status, 'cleared'); assert.equal(row.bank_match, 'cheque no. and amount'); assert.match(row.approved_note, /bank statement/);
    assert.equal((await admin('/api/receipts', { action: 'bankcheck' })).linked, 0, 'not linked twice');
    const m = await db.one("select * from team_messages where to_team = 'crm' and receipt_id = $1", [r1]);
    assert.match(m.body, /Cheque cleared/); assert.equal(m.booking_id, b1.id);
    assert.ok(await db.one('select 1 as x from daily_tasks where key like $1', [`clear-${r1}-%`]), 'cleared: a To-Do for the CRM');
  });
  await step('a match on flat and amount alone waits for Head Accounts (and Accounts is told)', async () => {
    const c = await admin('/api/receipts', { action: 'create', bookingId: b2.id, receivedOn: day(-2), amount: 50000, mode: 'cheque', instrumentNo: '777777', splits: { av: 40000, gst: 10000 } });
    r2 = c.id;
    await acc(null, b2.unit_no, 50000);
    const o = await admin('/api/receipts', { action: 'bankcheck' });
    assert.equal(o.linked, 1); assert.equal(o.approved, 0); assert.equal(o.waiting, 1);
    const row = (await admin(`/api/receipts?project=${sig.id}`)).rows.find((x) => x.id === r2);
    assert.equal(row.status, 'pending'); assert.equal(row.bank_status, 'cleared'); assert.equal(row.bank_match, 'flat and amount');
    const m = await db.one("select * from team_messages where to_team = 'accounts' and kind = 'system' order by id desc limit 1");
    assert.ok(m.needs_action); assert.match(m.body, new RegExp(b2.unit_no));
  });
  await step('the cheque comes back: receipt bounced, out of the ledger, the CRM told (message and To-Do)', async () => {
    await db.q("update acc_receipts set cheque_status = 'Bounced' where id = $1", [line1]);
    const o = await admin('/api/receipts', { action: 'bankcheck' });
    assert.equal(o.bounced, 1);
    assert.equal((await db.one("select count(*)::int as n from team_messages where to_team = 'accounts' and kind = 'system'")).n, 1, 'the waiting notice is posted once');
    const row = (await admin(`/api/receipts?project=${sig.id}`)).rows.find((x) => x.id === r1);
    assert.equal(row.status, 'bounced'); assert.equal(row.bank_status, 'returned'); assert.match(row.reverse_reason, /returned/);
    const m = await db.one("select * from team_messages where to_team = 'crm' and kind = 'system' and receipt_id = $1 and body like 'Cheque returned%'", [r1]);
    assert.ok(m && m.needs_action && m.booking_id === b1.id);
    const t = await db.one("select * from daily_tasks where key like $1", [`bounce-${r1}-%`]);
    assert.ok(t, 'a To-Do for the CRM');
    assert.equal((await admin('/api/receipts', { action: 'bankcheck' })).bounced, 0, 'bounced once');
  });
  await step('a cheque not deposited after 2 days is on the 9 am Accounts list', async () => {
    await admin('/api/receipts', { action: 'create', bookingId: b2.id, receivedOn: day(-4), amount: 25000, mode: 'cheque', instrumentNo: '123456', splits: { av: 25000 } });
    const f = await require('../lib/cheque-match').findings(day(0));
    assert.ok(f.find((x) => x.key === 'cheques-not-banked' && x.count === 1));
  });
  await step('a Tally reload renumbers the register: the links are found again, nothing is approved twice', async () => {
    const before = await db.one('select count(*)::int as n from audit_log where action = $1', ['approve']).catch(() => ({ n: 0 }));
    const rows = await db.q("select * from acc_receipts where source = 'test'");
    await db.q("delete from acc_receipts where source = 'test'");
    for (const r of rows) await db.q("insert into acc_receipts (book, ref_id, txn_date, bank, description, reference, amount, unit_no, on_statement, cheque_status, source) values ('signature', $1, $2, $3, $4, $5, $6, $7, 'Yes', $8, 'test')", [r.ref_id, r.txn_date, r.bank, r.description, r.reference, r.amount, r.unit_no, r.cheque_status]);
    const o = await admin('/api/receipts', { action: 'bankcheck' });
    assert.equal(o.linked, 0); assert.equal(o.relinked, 2); assert.equal(o.approved, 0); assert.equal(o.bounced, 0);
    const after = await db.one('select count(*)::int as n from audit_log where action = $1', ['approve']).catch(() => ({ n: 0 }));
    assert.equal(after.n, before.n);
  });
  await step('CRM ↔ Accounts messages: post about a flat, badge, needs an answer, done', async () => {
    const p = await admin('/api/team', { action: 'post', to: 'accounts', unit: b2.unit_no, body: 'Please confirm the cheque is deposited', needsAction: true });
    assert.equal(p.ok, true, p.error);
    assert.equal((await admin('/api/team', { action: 'post', to: 'accounts', unit: 'Z-9999', body: 'x' })).status, 400);
    const list = await admin(`/api/team?booking=${b2.id}`);
    assert.ok(list.rows.some((m) => m.id === p.id && m.unit_no === b2.unit_no));
    assert.ok(list.open.accounts >= 2);
    assert.equal((await admin('/api/team?badge=1')).n, 0, 'read once opened');
    assert.equal((await admin('/api/team', { action: 'done', id: p.id })).ok, true);
    const open = await admin('/api/team?f=open');
    assert.ok(!open.rows.some((m) => m.id === p.id));
  });
  console.log(`\n${n} checks passed`);
  server.close(); await db.end?.(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
