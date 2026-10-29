// Accounts: import from the Master Accounts sheet layout, registers, Daily Bank Balance, To Do, reports, Tally.
// DATABASE_URL=postgres://... node scripts/test-accounts.js
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3995';
process.env.ACC_FIXTURE = path.join(__dirname, 'fixtures/accounts-sample.js');
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, raw) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return { status: r.status, text: await r.text() };
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
  assert.equal((await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } })).ok, true);

  await step('import reads every typed tab, the lists and the head map', async () => {
    const p = await admin('/api/accounts', { action: 'import-preview', projectId: sig.id });
    assert.equal(p.summary.receipts, 6); assert.equal(p.summary.payments, 5); assert.equal(p.summary.dailyBanks, 12); assert.equal(p.summary.tenants, 2);
    const r = await admin('/api/accounts', { action: 'import', projectId: sig.id });
    assert.equal(r.ok, true, r.error); assert.equal(r.counts.receipts, 6); assert.equal(r.cp, 1);
    const L = await admin('/api/accounts?view=lists');
    assert.ok(L.lists.bank.includes('Yes RERA Collection 100% (0700)')); assert.ok(L.lists.paymentHead2.includes('RMC'));
    const rmc = L.heads.find((h) => h.side === 'payment' && h.name === 'RMC'); assert.equal(rmc.needs_bill, true); assert.equal(rmc.tds_section, '194Q'); assert.equal(Number(rmc.tds_rate), 0.001);
  });
  await step('Daily Bank Balance: brought forward plus every entry before the date, receipts and payments of the day', async () => {
    const b = await admin('/api/accounts?view=balances&date=2026-10-25');
    const h = b.rows.find((x) => x.bank === 'PRIME HDFC');
    assert.equal(h.receipts, 0); assert.equal(h.payments, 152); assert.equal(h.opening, h.bf + 1000 - 500); assert.equal(h.closing, h.opening - 152);
    assert.equal(b.groups.length, 2);
    assert.equal((await admin('/api/accounts', { action: 'stated', bankId: h.id, date: '2026-10-25', balance: h.closing + 5 })).ok, true);
    const b2 = await admin('/api/accounts?view=balances&date=2026-10-25'); assert.equal(b2.rows.find((x) => x.bank === 'PRIME HDFC').difference, 5);
  });
  let newId;
  await step('a receipt is entered with the next Receipt ID; unit format and heads are checked', async () => {
    const base = { txn_date: '2026-10-25', bank: 'Yes RERA Collection 100% (0700)', amount: '2,00,000', head: 'Receipts From Customers', payment_head: 'AV', unit_no: 'a-1002', payer_type: 'Current buyer', cheque_status: 'Cleared' };
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { ...base, unit_no: 'A1002' } })).status, 400);
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { ...base, head: 'Something New' } })).status, 400);
    const r = await admin('/api/accounts', { action: 'save', reg: 'receipts', data: base });
    assert.equal(r.ok, true, r.error); assert.equal(r.ref_id, 'BL00007'); newId = r.id;
    const l = await admin('/api/accounts?reg=receipts&q=BL00007'); assert.equal(l.rows[0].unit_no, 'A-1002'); assert.equal(Number(l.rows[0].amount), 200000);
  });
  await step('a bounced cheque is marked, never deleted', async () => {
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'receipts', id: newId, data: { cheque_status: 'Bounced' } })).ok, true);
    assert.equal((await admin('/api/accounts', { action: 'delete', reg: 'receipts', id: newId, reason: 'x' })).status, 400);
    const b = await admin('/api/accounts?reg=receipts&filter=bounced'); assert.equal(b.rows.length, 2);
  });
  await step('To Do counts what is missing; payments needing bill details are listed', async () => {
    const t = await admin('/api/accounts?view=todo');
    const item = (s) => t.items.find((x) => x.task.startsWith(s));
    assert.equal(item('Payments still needing bill details').n, 1); assert.equal(t.needBill[0].ref_id, 'PO00003'); assert.match(t.needBill[0].needs, /PAN/);
    assert.equal(item('Bank items not yet matched').n, 1); const bal = await admin('/api/accounts?view=balances&date=' + t.today); // the count matches the Daily Bank Balance page on the same day
    assert.equal(item('Banks whose balance does not agree').n, bal.rows.filter((r) => r.difference != null && Math.abs(r.difference) > 1).length);
  });
  await step('SRA tenants: rent by year, payments from Tenant Rent Links, balance and position', async () => {
    const t = await admin('/api/accounts?reg=tenants');
    const a = t.rows.find((r) => Number(r.survey_no) === 8), b = t.rows.find((r) => Number(r.survey_no) === 29);
    assert.equal(a.rent_2025, 330000); assert.equal(a.rent_2026, 363000); assert.equal(a.paid_2025, 330000); assert.equal(a.position, 'Short paid');
    assert.equal(b.rent_2025, 865000); // agreed yearly rent kept from the sheet
    const l = await admin('/api/accounts?reg=rentLinks'); assert.equal(l.rows[0].counted, 330000); assert.equal(l.rows[0].year_counted, 2025);
  });
  await step('reports: GST and SDR from the bank registers; bounced cheques and TDS in their registers; payees; Tally export', async () => {
    const g = await admin(`/api/accounts?view=report&name=gst&project=${sig.id}`); const a = g.rows.find((r) => r.unit === 'A-1001');
    assert.equal(a.avReceived, 485700); assert.equal(a.gstReceived, 24288);
    const s = await admin(`/api/accounts?view=report&name=sdr&project=${sig.id}`); const sa = s.rows.find((r) => r.unit === 'A-1001');
    assert.equal(sa.received, 515800); assert.equal(sa.paidOut, 515812); assert.equal(sa.held, -12);
    const u = await admin('/api/accounts?reg=receipts&filter=bounced'); assert.equal(u.rows.filter((r) => r.unit_no === 'A-1002').reduce((a, r) => a + Number(r.amount), 0), 350000);
    const p = await admin('/api/accounts?view=report&name=payees'); assert.equal(p.rows.find((r) => r.payee === 'Skyway').paid, 155354);
    const t = await admin('/api/accounts?reg=tds'); assert.equal(t.rows.reduce((a, r) => a + Number(r.tds_amount), 0), 4858);
    const x = await admin('/api/accounts?view=tally&from=2026-01-01&to=2026-12-31', null, true); assert.match(x.text, /<VOUCHER VCHTYPE="Receipt"/); assert.match(x.text, /<LEDGERNAME>RMC<\/LEDGERNAME>/);
    assert.ok(!/BL00004/.test(x.text)); // bounced cheque left out
    const c = await admin('/api/accounts?view=tally&from=2026-01-01&to=2026-12-31&format=csv', null, true); assert.match(c.text, /^﻿?Date,Voucher Type/);
  });
  await step('CP Commissions: brokerage released comes in as paid on the booking', async () => {
    const p = await admin(`/api/partners?project=${sig.id}`); const r = p.rows.find((x) => x.unit_no === 'A-1001');
    assert.equal(Number(r.paid), 97150); assert.equal(Number(r.brokerage), 97150); assert.equal(r.state, 'Paid');
  });
  await step('importing again replaces the earlier import and keeps rows entered in the ERP', async () => {
    assert.equal((await admin('/api/accounts', { action: 'import', projectId: sig.id })).ok, true);
    const l = await admin('/api/accounts?reg=receipts'); assert.equal(l.total, 7); assert.ok(l.rows.some((r) => r.ref_id === 'BL00007'));
    const p = await admin(`/api/partners?project=${sig.id}`); assert.equal(Number(p.rows.find((x) => x.unit_no === 'A-1001').paid), 97150);
  });
  await step('roles: Sales has no accounts access; heads can only be set up by Accounts admin', async () => {
    const c = await admin('/api/users', { action: 'create', name: 'Acc One', username: 'acc1', role: 'accounts', projects: [sig.id] });
    const s = client(); await s('/api/session', { action: 'login', username: 'acc1', password: c.tempPassword }); await s('/api/session', { action: 'password', current: c.tempPassword, next: 'accounts-password-1' });
    assert.equal((await s('/api/accounts?view=todo')).status, 200);
    assert.equal((await s('/api/accounts', { action: 'head', side: 'payment', name: 'New head' })).status, 403);
    assert.equal((await s('/api/accounts', { action: 'import', projectId: sig.id })).status, 403);
    const c2 = await admin('/api/users', { action: 'create', name: 'Sales Two', username: 'sales2', role: 'sales', projects: [sig.id] });
    const x = client(); await x('/api/session', { action: 'login', username: 'sales2', password: c2.tempPassword }); await x('/api/session', { action: 'password', current: c2.tempPassword, next: 'sales-password-2' });
    assert.equal((await x('/api/accounts?view=todo')).status, 403);
  });
  await step('once live, the sheet is not imported again', async () => {
    process.env.ERP_LIVE = '1';
    assert.equal((await admin('/api/accounts', { action: 'import', projectId: sig.id })).status, 403);
    delete process.env.ERP_LIVE;
  });
  await step('Payments Out: TDS section and rate come from the head; TDS worked out on the taxable value', async () => {
    const r = await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-10-26', bank: 'Yes RERA Collection 100% (0700)', amount: '99,900', head: 'RMC', payee: 'RMC Co', taxable_value: '1,00,000', total_bill: '1,00,000' } });
    assert.equal(r.ok, true, r.error);
    const l = await admin('/api/accounts?reg=payments&q=' + r.ref_id); const p = l.rows[0];
    assert.equal(p.tds_section, '194Q'); assert.equal(Number(p.tds_rate), 0.001); assert.equal(Number(p.tds_deducted), 100);
  });
  await step('an approved purchase bill is paid from Payments Out and marked Paid', async () => {
    const kv = require('../lib/portal/kv');
    await kv.hset('po:orders', 'PO123456', { id: 'PO123456', material: 'RMC', line: 'A wing|5th slab', status: 'accounts_ok', order: { vendor: 'Concrete Ltd', amount: 250000, billNo: 'B-77', billDate: '2026-10-20' }, accounts: { by: 'hacc', at: '2026-10-21T10:00:00Z', payable: 250000 }, history: [] });
    const B = await admin('/api/accounts?view=bills'); const b = B.bills.find((x) => x.id === 'PO123456');
    assert.ok(b); assert.equal(b.amount, 250000); assert.equal(b.head, 'RMC'); assert.equal(B.tds.RMC.sec, '194Q');
    const r = await admin('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO123456', data: { txn_date: '2026-10-27', bank: 'Yes RERA Collection 100% (0700)', amount: '250000', head: 'RMC', payee: 'Concrete Ltd', reference: 'UTR999' } });
    assert.equal(r.billPaid, true, r.billError);
    const o = await kv.hget('po:orders', 'PO123456'); assert.equal(o.status, 'paid'); assert.equal(o.payment.ref, 'UTR999'); assert.equal(o.payment.erpPayment, r.ref_id);
    assert.equal((await admin('/api/accounts?view=bills')).bills.length, 0);
  });
  await step('Today: last month\'s TDS to deposit by the 7th, and the closing balances to confirm', async () => {
    const dt = require('../lib/daily-tasks');
    await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-09-15', bank: 'Yes RERA Collection 100% (0700)', amount: '1000', head: 'RMC', payee: 'X', tds_deducted: '20' } });
    const r = await dt.run('accounts', { today: '2026-10-03', mail: false });
    const t = r.found.find((x) => x.key === 'tds-deposit-2026-09'); assert.ok(t, r.found.map((x) => x.key).join()); assert.match(t.title, /by the 7th/);
    const late = (await dt.run('accounts', { today: '2026-10-09', mail: false })).found.find((x) => x.key === 'tds-deposit-2026-09'); assert.match(late.title, /late/);
    const c = (await dt.run('accounts', { today: '2026-10-26', mail: false })).found.find((x) => x.key === 'daily-confirm'); assert.ok(c); assert.match(c.title, /25-Oct-2026/);
  });
  await step('closing balances: a bank that does not agree needs a note to confirm', async () => {
    assert.equal((await admin('/api/accounts', { action: 'confirm-day', date: '2026-10-25' })).status, 400); // PRIME HDFC differs by 5
    assert.equal((await admin('/api/accounts', { action: 'confirm-day', date: '2026-10-25', note: 'Bank charge of Rs 5 to enter' })).ok, true);
    const b = await admin('/api/accounts?view=balances&date=2026-10-25'); assert.equal(b.confirmed.by, 'Admin');
    const c = (await require('../lib/daily-tasks').run('accounts', { today: '2026-10-26', mail: false })).found.find((x) => x.key === 'daily-confirm'); assert.equal(c, undefined);
  });
  await step('month close: entries in a closed month need Head Accounts and a reason, kept in the audit log', async () => {
    const s = client(); await s('/api/session', { action: 'login', username: 'acc1', password: 'accounts-password-1' });
    assert.equal((await s('/api/accounts', { action: 'close-month', month: '2026-09' })).status, 403);
    assert.equal((await admin('/api/accounts', { action: 'close-month', month: '2026-10' })).status, 400); // not ended yet
    assert.equal((await admin('/api/accounts', { action: 'close-month', month: '2026-09' })).ok, true);
    const row = { txn_date: '2026-09-20', bank: 'Yes RERA Collection 100% (0700)', amount: '500', head: 'RMC', payee: 'Y' };
    assert.equal((await s('/api/accounts', { action: 'save', reg: 'payments', data: row })).status, 403);
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'payments', data: row })).status, 400);
    const ok = await admin('/api/accounts', { action: 'save', reg: 'payments', data: row, reason: 'Bank charge found late' }); assert.equal(ok.ok, true);
    assert.equal((await s('/api/accounts', { action: 'save', reg: 'payments', data: { ...row, txn_date: '2026-10-02' } })).ok, true); // an open month is as before
    const a = await admin('/api/audit?limit=50'); assert.ok(a.rows.some((x) => x.action === 'create-closed-month' && /Bank charge found late/.test(x.note || '')));
    assert.equal((await admin('/api/accounts?view=checks')).closed.date, '2026-09-30');
  });
  await step('the CA pack: a summary and the month\'s registers in one Excel file, sent once a month to the test address', async () => {
    const P = require('../lib/ca-pack');
    const p = await P.build('2026-10');
    const wb = require('../lib/xlsx').read(p.file);
    const names = wb.map((x) => x.name); assert.ok(wb[0].rows.length > 10); assert.ok(names.includes('Summary'), names.join()); assert.ok(names.some((x) => /Payments Out/.test(x)));
    const dl = await admin('/api/accounts?view=capack&download=2026-10', null, true); assert.equal(dl.status, 200);
    const r = await P.morning('2026-11-03'); assert.equal(r.skipped, 'not yet');
    const r2 = await P.morning('2026-11-05'); assert.ok(r2.skipped, 'mail not set up here: skipped with a reason'); // no SMTP in this test
  });
  console.log(`\nAll ${n} accounts checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
