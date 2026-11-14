// Accounts: import from the Master Accounts sheet layout, registers, Daily Bank Balance, To Do, reports, Tally.
// DATABASE_URL=postgres://... node scripts/test-accounts.js
require('./login-code-helper'); // staff sign-in: password, then the code (ERP_TEST_OTP)
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
    // the Tally export: the Tally link's vouchers (REMOTEID), ERP entries only (rows imported from the sheet are in Tally already)
    const tp = await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-10-20', bank: 'Yes RERA Collection 100% (0700)', amount: '1234', head: 'RMC', payee: 'Tally Export Test', vendor_pan: 'AAAAA0000A', bill_no: 'T-1', bill_date: '2026-10-20', taxable_value: '1234', gst_on_bill: '0', tds_deducted: '0', tds_challan: 'NA' } });
    assert.equal(tp.ok, true, tp.error);
    const x = await admin('/api/accounts?view=tally&from=2026-01-01&to=2026-12-31', null, true);
    assert.match(x.text, new RegExp(`<VOUCHER REMOTEID="DIERP-${tp.ref_id}" VCHTYPE="Payment"`)); assert.match(x.text, /<LEDGERNAME>RMC<\/LEDGERNAME>/);
    assert.ok(!/BL00004/.test(x.text)); assert.ok(!/BL00007/.test(x.text)); // imported rows, and a bounced cheque Tally never had, left out
    const c = await admin('/api/accounts?view=tally&from=2026-01-01&to=2026-12-31&format=csv', null, true); assert.match(c.text, /^﻿?Date,Voucher Type/); assert.match(c.text, new RegExp(`DIERP-${tp.ref_id}`));
    // a receipt not found on the bank statement is not money received
    const before = (await admin(`/api/accounts?view=report&name=gst&project=${sig.id}`)).rows.find((r) => r.unit === 'A-1001').avReceived;
    const nf = await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { txn_date: '2026-10-21', bank: 'Yes RERA Collection 100% (0700)', amount: '5000', head: 'Receipts From Customers', payment_head: 'AV', unit_no: 'A-1001', payer_type: 'Current buyer', cheque_status: 'Not found on statement' } });
    assert.equal(nf.ok, true, nf.error);
    assert.equal((await admin(`/api/accounts?view=report&name=gst&project=${sig.id}`)).rows.find((r) => r.unit === 'A-1001').avReceived, before);
    const db = require('../lib/db');
    await db.q('delete from acc_receipts where id = $1', [nf.id]); // so the receipt counts below stay as they were
    // the registers are Dream Signature's book: another project is refused
    const other = await db.one("insert into projects (code, name, company_id) select 'OTHERP', 'Other Project', company_id from projects where id = $1 returning id", [sig.id]);
    const ref = await admin(`/api/accounts?view=report&name=gst&project=${other.id}`); assert.equal(ref.status, 400); assert.match(ref.error, /Dream Signature/);
    assert.equal((await admin(`/api/books-crm?project=${other.id}`)).status, 400);
    await db.q('delete from projects where id = $1', [other.id]);
  });
  await step('CP Commissions: brokerage released comes in on the booking, counted as paid once verified', async () => {
    const p = await admin(`/api/partners?project=${sig.id}&ledger=1`); const r = p.bookings.find((x) => x.unit_no === 'A-1001');
    assert.equal(Number(r.to_verify), 97150, JSON.stringify(r)); assert.equal(Number(r.brokerage), 97150); // the sheet's released brokerage, waiting to be verified on the ledger
    assert.equal((await admin(`/api/partners?project=${sig.id}`)).status, 400); // the old per-booking list is gone
  });
  await step('importing again replaces the earlier import and keeps rows entered in the ERP', async () => {
    assert.equal((await admin('/api/accounts', { action: 'import', projectId: sig.id })).ok, true);
    const l = await admin('/api/accounts?reg=receipts'); assert.equal(l.total, 7); assert.ok(l.rows.some((r) => r.ref_id === 'BL00007'));
    const p = await admin(`/api/partners?project=${sig.id}&ledger=1`); const r = p.bookings.find((x) => x.unit_no === 'A-1001'); assert.equal(Number(r.to_verify), 97150);
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
    // a rate typed as 1% (or 1) is 1%, never 100%; saving the row again keeps it
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'payments', id: p.id, data: { tds_rate: '1%' } })).ok, true);
    assert.equal(Number((await admin('/api/accounts?reg=payments&q=' + r.ref_id)).rows[0].tds_rate), 0.01);
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'payments', id: p.id, data: { tds_rate: '0.1' } })).ok, true);
    assert.equal(Number((await admin('/api/accounts?reg=payments&q=' + r.ref_id)).rows[0].tds_rate), 0.001);
  });
  await step('Payments Out report: filter by head and payee, totals by head and by month, in print and Excel', async () => {
    await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-10-28', bank: 'Yes RERA Collection 100% (0700)', amount: '5,000', head: 'RMC', payee: 'Other RMC' } });
    const all = await admin('/api/accounts?reg=payments&by=head');
    const rmc = all.groups.rows.find((g) => g.name === 'RMC'); assert.ok(rmc && rmc.n >= 2, JSON.stringify(all.groups));
    assert.equal(Math.round(all.groups.rows.reduce((a, g) => a + g.amount, 0)), Math.round(all.amount));
    const f = await admin('/api/accounts?reg=payments&m_head=RMC&m_payee=Other%20RMC');
    assert.equal(f.total, 1); assert.equal(f.amount, 5000);
    const two = await admin('/api/accounts?reg=payments&m_head=RMC|Nothing&by=month');
    assert.equal(two.total, rmc.n); assert.ok(two.groups.rows.some((g) => g.name === '2026-10'));
    // a date range: each head also shows the project till date
    const fy = await admin('/api/accounts?reg=payments&by=head&from=2026-10-28&to=2026-10-28');
    const g = fy.groups.rows.find((x) => x.name === 'RMC'); assert.equal(g.n, 1); assert.equal(g.tdN, rmc.n); assert.equal(Math.round(fy.groups.tillDate.amount), Math.round(all.amount));
    const x = await admin('/api/accounts?reg=payments&by=head&from=2026-10-28&to=2026-10-28&export=xlsx', null, true);
    assert.equal(x.status, 200); assert.ok(x.text.startsWith('PK')); // an Excel file
    // Payments by Head (the sheet's pivot): heads by month, total for the months and the project till date
    const bh = await admin('/api/accounts?view=report&name=byHead&from=2026-10&to=2026-10');
    const pr0 = bh.payments.rows.find((x) => x.head === 'RMC'); assert.ok(pr0 && pr0.months['2026-10'] > 0 && pr0.tillDate >= pr0.total, JSON.stringify(bh.payments));
    assert.equal(Math.round(bh.payments.total.tillDate), Math.round((await admin('/api/accounts?reg=payments')).amount));
    const bx = await admin('/api/accounts?view=report&name=byHead&export=xlsx', null, true); assert.equal(bx.status, 200); assert.ok(bx.text.startsWith('PK'));
    const pr = await admin('/api/accounts?reg=payments&m_head=RMC&by=payee&export=rows');
    assert.equal(pr.rows.length, rmc.n); assert.match(pr.head.filters, /Cash Flow Head: RMC/); assert.equal(pr.groups.by, 'payee');
  });
  await step('an approved purchase bill is paid from Payments Out and marked Paid', async () => {
    const kv = require('../lib/portal/kv');
    await kv.hset('po:orders', 'PO123456', { id: 'PO123456', material: 'RMC', line: 'A wing|5th slab', status: 'accounts_ok', order: { vendor: 'Concrete Ltd', amount: 250000, billNo: 'B-77', billDate: '2026-10-20' }, accounts: { by: 'hacc', at: '2026-10-21T10:00:00Z', payable: 250000 }, history: [] });
    const B = await admin('/api/accounts?view=bills'); const b = B.bills.find((x) => x.id === 'PO123456');
    assert.ok(b); assert.equal(b.amount, 250000); assert.equal(b.head, 'RMC'); assert.equal(B.tds.RMC.sec, '194Q');
    const pay = { txn_date: '2026-10-27', bank: 'Yes RERA Collection 100% (0700)', amount: '250000', head: 'RMC', payee: 'Concrete Ltd', reference: 'UTR999' };
    const count = async () => (await admin('/api/accounts?reg=payments')).total;
    const n0 = await count();
    // the amount must be what Accounts approved (or that less the TDS on the row); nothing is saved otherwise
    const wrong = await admin('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO123456', data: { ...pay, amount: '260000' } });
    assert.equal(wrong.status, 400); assert.match(wrong.error, /approved for ₹2,50,000/); assert.equal(await count(), n0);
    // the one who approved the bill cannot pay it
    const h = await admin('/api/users', { action: 'create', name: 'Head Acc', username: 'hacc', role: 'head_accounts', projects: [sig.id] });
    const hc = client(); await hc('/api/session', { action: 'login', username: 'hacc', password: h.tempPassword }); await hc('/api/session', { action: 'password', current: h.tempPassword, next: 'head-acc-password-1' });
    const own = await hc('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO123456', data: pay }); assert.equal(own.status, 403, JSON.stringify(own)); assert.equal(await count(), n0);
    const r = await admin('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO123456', data: pay });
    assert.equal(r.billPaid, true, r.error);
    const o = await kv.hget('po:orders', 'PO123456'); assert.equal(o.status, 'paid'); assert.equal(o.payment.ref, 'UTR999'); assert.equal(o.payment.erpPayment, r.ref_id);
    assert.equal((await admin('/api/accounts?view=bills')).bills.length, 0);
    // paid once only
    const twice = await admin('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO123456', data: { ...pay, reference: 'UTR1000' } }); assert.equal(twice.status, 409); assert.equal(await count(), n0 + 1);
    // a bill less TDS: approved 1,00,000, paid 99,900 with TDS of 100 on the row
    await kv.hset('po:orders', 'PO654321', { id: 'PO654321', material: 'Steel', line: 'A wing|5th slab', status: 'accounts_ok', order: { vendor: 'Steel Co', amount: 100000 }, accounts: { by: 'hacc', at: '2026-10-21T10:00:00Z', payable: 100000 }, history: [] });
    assert.equal((await admin('/api/accounts', { action: 'save', reg: 'payments', poId: 'PO654321', data: { ...pay, amount: '99900', tds_deducted: '100', payee: 'Steel Co', reference: 'UTR77' } })).billPaid, true);
    // the Purchase page can no longer mark a bill Paid without a Payments Out row
    await kv.hset('po:orders', 'PO777777', { id: 'PO777777', no: 'PR-0777', material: 'Steel', line: 'A wing|5th slab', status: 'accounts_ok', order: { vendor: 'Steel Co', amount: 5000 }, accounts: { by: 'hacc', payable: 5000 }, history: [] });
    const pp = await admin('/api/me?purchase=1', { op: 'paid', id: 'PO777777', data: { amount: 5000, ref: 'X', date: '2026-10-27' } });
    assert.equal(pp.status, 400, JSON.stringify(pp)); assert.match(pp.error, /Payments Out/);
    await kv.hdel('po:orders', 'PO777777');
  });
  await step('Today: last month\'s TDS to deposit by the 7th, and the closing balances to confirm', async () => {
    const dt = require('../lib/daily-tasks');
    await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-09-15', bank: 'Yes RERA Collection 100% (0700)', amount: '1000', head: 'RMC', payee: 'X', tds_deducted: '20' } });
    const r = await dt.run('accounts', { today: '2026-10-03', mail: false });
    const t = r.found.find((x) => x.key === 'tds-deposit-2026-09'); assert.ok(t, r.found.map((x) => x.key).join()); assert.match(t.title, /by the 7th/);
    const late = (await dt.run('accounts', { today: '2026-10-09', mail: false })).found.find((x) => x.key === 'tds-deposit-2026-09'); assert.match(late.title, /late/);
    // older months not deposited are listed too; March's TDS is due by 30 April
    await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-03-15', bank: 'Yes RERA Collection 100% (0700)', amount: '1000', head: 'RMC', payee: 'X', tds_deducted: '30' } });
    const mar = (await dt.run('accounts', { today: '2026-04-20', mail: false })).found.find((x) => x.key === 'tds-deposit-2026-03'); assert.ok(mar); assert.match(mar.title, /by 30 April/);
    const old = (await dt.run('accounts', { today: '2026-10-03', mail: false })).found; assert.ok(old.some((x) => x.key === 'tds-deposit-2026-03' && /late/.test(x.title)) && old.some((x) => x.key === 'tds-deposit-2026-09'));
    const c = (await dt.run('accounts', { today: '2026-10-26', mail: false })).found.find((x) => x.key === 'daily-confirm'); assert.ok(c); assert.match(c.title, /25-Oct-2026/);
  });
  await step('closing balances: a bank that does not agree needs a note to confirm', async () => {
    assert.equal((await admin('/api/accounts', { action: 'confirm-day', date: '2026-10-25' })).status, 400); // PRIME HDFC differs by 5
    assert.equal((await admin('/api/accounts', { action: 'confirm-day', date: '2026-10-25', note: 'Bank charge of Rs 5 to enter' })).ok, true);
    // whoever typed a day's Balance per Bank does not confirm that day (the Admin excepted)
    const a1 = client(); await a1('/api/session', { action: 'login', username: 'acc1', password: 'accounts-password-1' });
    const bk = (await admin('/api/accounts?view=balances&date=2026-10-24')).rows[0];
    assert.equal((await a1('/api/accounts', { action: 'stated', bankId: bk.id, date: '2026-10-24', balance: bk.closing })).ok, true);
    const own = await a1('/api/accounts', { action: 'confirm-day', date: '2026-10-24', note: 'x' }); assert.equal(own.status, 403); assert.match(own.error, /someone else/);
    const b = await admin('/api/accounts?view=balances&date=2026-10-25'); assert.equal(b.confirmed.by, 'Admin');
    const c = (await require('../lib/daily-tasks').run('accounts', { today: '2026-10-26', mail: false })).found.find((x) => x.key === 'daily-confirm'); assert.equal(c, undefined);
  });
  await step('month close: entries in a closed month need Head Accounts and a reason, kept in the audit log', async () => {
    const s = client(); await s('/api/session', { action: 'login', username: 'acc1', password: 'accounts-password-1' });
    assert.equal((await s('/api/accounts', { action: 'close-month', month: '2026-09' })).status, 403);
    assert.equal((await admin('/api/accounts', { action: 'close-month', month: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7) })).status, 400); // this month: not ended yet
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
  await step('the Tally link: Tally fetches new ERP entries with its key, confirms them, and gets changed ones again as Alter', async () => {
    const bad = await fetch(BASE + '/api/accounts?tally=feed', { headers: { 'X-ERP-Key': 'nope' } }); assert.equal(bad.status, 401);
    const k = await admin('/api/accounts', { action: 'tally-link', newKey: true, company: 'Prime Realtors' }); assert.match(k.key, /^tly_/);
    const feed = async (q = '') => { const r = await fetch(BASE + '/api/accounts?tally=feed' + q, { headers: { 'X-ERP-Key': k.key } }); return q.includes('json') ? r.json() : r.text(); };
    assert.equal((await feed('&format=json')).count, 0); // no start date: nothing goes
    await admin('/api/accounts', { action: 'tally-link', start: '2026-10-26' });
    const j = await feed('&format=json');
    assert.ok(j.count >= 1, JSON.stringify(j)); assert.ok(j.vouchers.every((v) => v.date >= '2026-10-26' && v.action === 'Create'));
    const v0 = j.vouchers[0];
    assert.equal((await admin('/api/accounts', { action: 'tally-link', ledgerMap: { [v0.bankLedger]: 'TALLY BANK NAME' } })).ok, true);
    const x = await feed(); assert.match(x, /<SVCURRENTCOMPANY>Prime Realtors<\/SVCURRENTCOMPANY>/); assert.match(x, /REMOTEID="DIERP-/); assert.match(x, /<LEDGERNAME>TALLY BANK NAME<\/LEDGERNAME>/);
    assert.ok((await admin('/api/accounts?view=tallylink')).ledgers.some((l) => l.tally === 'TALLY BANK NAME'));
    const first = j.vouchers[0];
    const ack = await fetch(BASE + '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ERP-Key': k.key }, body: JSON.stringify({ action: 'tally-ack', done: j.vouchers.map((v, i) => ({ id: v.id, result: i === 0 && j.count > 1 ? 'error' : 'ok', note: i === 0 && j.count > 1 ? 'Ledger RMC does not exist' : 'Vch ' + i })) }) }).then((r) => r.json());
    assert.equal(ack.imported + ack.failed, j.count);
    const left = await feed('&format=json'); assert.equal(left.count, ack.failed); // only the failed one is offered again
    const st = await admin('/api/accounts?view=tallylink'); assert.equal(st.hasKey, true); assert.ok(st.lastPull);
    // a confirmed entry that is changed later comes back as Alter
    const done = j.vouchers.find((v, i) => !(i === 0 && j.count > 1)); const reg = done.type === 'Receipt' ? 'receipts' : 'payments';
    const row = (await admin(`/api/accounts?reg=${reg}&q=${done.id}`)).rows[0];
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await admin('/api/accounts', { action: 'save', reg, id: row.id, data: { remark: 'changed after Tally' } })).ok, true);
    const again = await feed('&format=json'); assert.ok(again.vouchers.some((v) => v.id === done.id && v.action === 'Alter'));
    const s = client(); await s('/api/session', { action: 'login', username: 'acc1', password: 'accounts-password-1' });
    assert.equal((await s('/api/accounts', { action: 'tally-link', newKey: true })).status, 403);
  });
  await step('SDR challans: cancelling or bringing one back needs Head Accounts and a reason, and is checked for duplicates', async () => {
    const add = (x) => admin('/api/sdr', { action: 'add', projectId: sig.id, unit: 'A-1001', kind: 'stamp_duty', amount: 500000, challanDate: '2026-10-20', ...x });
    const c1 = await add({ grn: 'GRNT1' }); assert.equal(c1.ok, true, c1.error);
    const up = (k, x) => k('/api/sdr', { action: 'update', projectId: sig.id, id: c1.id, ...x });
    assert.equal((await up(admin, { status: 'cancelled' })).status, 400); // no reason
    const a1 = client(); await a1('/api/session', { action: 'login', username: 'acc1', password: 'accounts-password-1' });
    assert.equal((await up(a1, { status: 'cancelled', reason: 'failed' })).status, 403);
    assert.equal((await up(a1, { note: 'a note is fine' })).ok, true);
    assert.equal((await up(admin, { status: 'cancelled', reason: 'Challan failed at the bank' })).ok, true);
    const c2 = await add({ grn: 'GRNT2' }); assert.equal(c2.ok, true, c2.error); assert.equal(c2.second, false);
    const back = await up(admin, { status: 'paid', reason: 'Entered as cancelled by mistake' }); assert.equal(back.status, 409); assert.ok(back.duplicate);
    assert.equal((await up(admin, { status: 'paid', reason: 'Entered as cancelled by mistake', duplicateReason: 'Both were paid; refund claimed on the second' })).ok, true);
  });
  await step('Payments Out split: each part keeps its own invoice number', async () => {
    const all = await admin('/api/accounts?reg=payments&limit=50'); const p = all.rows.find((r) => Number(r.amount) >= 10 && !/split/.test(r.remark || ''));
    const a = Math.round(Number(p.amount) * 0.4 * 100) / 100, b = Math.round((Number(p.amount) - a) * 100) / 100;
    const r = await admin('/api/accounts', { action: 'split-row', reg: 'payments', id: p.id, parts: [{ head: 'RMC', amount: a, bill_no: 'INV-101' }, { head: 'RMC', amount: b, bill_no: 'INV-102' }] });
    assert.equal(r.ok, true, r.error); assert.equal(r.ids.length, 2);
    const rows = (await admin('/api/accounts?reg=payments&limit=200')).rows.filter((x) => r.ids.includes(x.ref_id));
    assert.deepEqual(rows.map((x) => x.bill_no).sort(), ['INV-101', 'INV-102']);
    assert.ok(rows.every((x) => /part \d of split 2 ways from \S+ \(₹[\d,.]+\)/.test(x.remark)));
    // the list knows the original payment even when the search finds only one part, and print / Excel show it on top
    const one = (await admin('/api/accounts?reg=payments&q=INV-102')).rows[0];
    assert.equal(one._split.total, Number(p.amount)); assert.equal(one._split.n, 2);
    const x = await admin('/api/accounts?reg=payments&export=rows&q=RMC&cols=ref_id,amount,bill_no,remark');
    const h = x.rows.findIndex((r) => r._head && r.ref_id === p.ref_id);
    assert.ok(h >= 0); assert.equal(x.rows[h].amount, Number(p.amount)); assert.deepEqual([x.rows[h + 1].bill_no, x.rows[h + 2].bill_no], ['INV-101', 'INV-102']);
    assert.equal(x.head.amount, (await admin('/api/accounts?reg=payments&q=RMC')).amount); // the total counts the parts once
    const xl = await admin('/api/accounts?reg=payments&export=xlsx&q=RMC', null, true); assert.equal(xl.status, 200);
    // one part for the whole amount: only its invoice no. (and head) are saved, the row is not split
    const part = rows.find((x) => x.bill_no === 'INV-101');
    const single = await admin('/api/accounts', { action: 'split-row', reg: 'payments', id: part.id, parts: [{ head: 'RMC', amount: Number(part.amount), bill_no: 'INV-201' }] });
    assert.equal(single.ok, true, single.error); assert.equal(single.single, true);
    const again = (await admin('/api/accounts?reg=payments&limit=300')).rows.find((x) => x.id === part.id);
    assert.equal(again.bill_no, 'INV-201'); assert.equal(again.ref_id, part.ref_id);
  });
  console.log(`\nAll ${n} accounts checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
