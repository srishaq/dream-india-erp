// Dream Aspire's bank entries filled from Accounts' "Dream Aspire Cash Flow" workbook (sheets ASPIRE_EXPENSES and
// ASPIRE_COLLECTION): Cash Flow Head, payee, payer and flat. Synthetic data only.
// DATABASE_URL=postgres://... node scripts/test-aspire-cashflow.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-')), 'Dream Aspire Cash Flow.xlsx');
process.env.IMPORT_ASPIRE_CF_FIXTURE = file;
process.env.PORT = process.env.PORT || '3993';
const server = require('./dev-server');
const db = require('../lib/db');
const { write } = require('../lib/xlsx-write');
const A = require('../lib/aspire-cashflow');
const BASE = `http://localhost:${process.env.PORT}`;
function client() { let cookie = ''; return async (p, body) => { const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; }; }
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  try {
    fs.writeFileSync(file, write([
      { name: 'ASPIRE_EXPENSES', rows: [[null, null, null, null, 1], ['Month', 'Date', 'Particulars', 'Mode ', 'Amount ', 'Remarks', 'Cash Flow Head'],
        ['Nov-26', '2026-11-21', 'CHQ PAID-CTS S5-MUMB-TEST TENANT ONE', 'HDFC CA 7044 (30%)', 18000, 'Tenant Rent', 'Tenant Rent'],
        ['Nov-26', '2026-11-21', 'CHQ PAID-CTS S6-MUMB-TEST TENANT TWO', 'HDFC CA 7044 (30%)', 18000, 'Tenant Rent', 'Tenant Rent'],
        ['Nov-26', '2026-11-21', 'FT - DR - 1234 - DREAM ASPIRE GST', 'HDFC CA 7044 (30%)', 50000, 'Amount Transfer', 'Internal Transfer'],
        ['Nov-26', '2026-11-21', 'UPI-TEST AGENCY-TEST@HDFCBANK-HDFC0000001-1-UPI', 'HDFC CA 7044 (30%)', 7000, 'Hoarding', 'Site Expense'],
        ['Nov-26', '22/11/26', 'NEFT DR-HDFC0000001-TEST PARTNER-OSHIWARA-HDFCN1', 'HDFC CA 7044 (30%)', 200000, 'Rafi Sir Partner Withdrawal', 'PARTNERS WITHDRAW'],
        ['Nov-26', '22/11/26', 'UPI-TEST TRUST-TRUST@OKSBI-SBIN0000001-2-UPI', 'HDFC CA 7044 (30%)', 5100, 'Charity', 'Charity'],
        ['Nov-26', '22/11/26', 'NEFT DR-HDFC0000001-NOT IN ERP-OSHIWARA-HDFCN9', 'HDFC CA 7044 (30%)', 99999, 'Test', 'Office Expense'],
        ['Nov-26', '22/11/26', 'UPI-NO HEAD-X@Y-Z-3-UPI', 'HDFC CA 7044 (30%)', 300, null, null]] },
      { name: 'ASPIRE_COLLECTION', rows: [[null, null, 'Particulars', 'Amount '], [], ['COLLECTIONS'], ['MONTH', 'DATE', 'PARTICULARS', 'BANK', 'DEPOSIT AMT', 'ALLOCATION OF EXPENSES', 'Flat No.', 'REMARK', 'CASH FLOW HEAD'],
        ['Nov-26', '2026-11-20', 'NEFT CR-SBIN0000001-TEST BUYER-DREAM ASPIRE', 'MCA', 400000, 'Flat', '1001', 'Test Buyer', 'Cash Receipts From Customers'],
        ['Nov-26', '2026-11-20', 'FD CLOSURE PROCEEDS', 'HDFC CA', 1000000, 'Other', null, null, 'FIXED DEPOSIT']] },
    ]));
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
    await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE'");
    const asp = (await admin('/api/masters')).projects.find((p) => p.code === 'ASPIRE');
    const bld = await db.one("insert into buildings (project_id, code, name) values ($1, 'A', 'Wing A') returning id", [asp.id]);
    await db.q("insert into units (project_id, building_id, unit_no, floor) values ($1, $2, 'A-1001', 10)", [asp.id, bld.id]);
    for (const [side, name] of [['payment', 'Tenant Rent'], ['payment', 'Internal transfer'], ['payment', 'Marketing'], ['payment', 'Partner Withdrawal-Rafi Sir'], ['receipt', 'Receipts From Customers'], ['receipt', 'Fixed Deposit'], ['receipt', 'Internal transfer']]) {
      await db.q("insert into acc_heads (book, side, name, section) values ('aspire', $1, $2, 'Operating') on conflict do nothing", [side, name]);
    }
    const B = 'Aspire HDFC 30% (7044)';
    const pay = (ref, d, amt, desc, head = null) => db.q("insert into acc_payments (book, ref_id, txn_date, bank, amount, description, head, source) values ('aspire', $1, $2, $3, $4, $5, $6, 'statement')", [ref, d, B, amt, desc, head]);
    await pay('PO1', '2026-11-21', 18000, 'CHQ PAID-CTS S6-MUMB-TEST TENANT TWO'); // the two cheques of the same amount, in the other order
    await pay('PO2', '2026-11-21', 18000, 'CHQ PAID-CTS S5-MUMB-TEST TENANT ONE');
    await pay('PO3', '2026-11-21', 50000, 'FT - DR - 1234 - DREAM ASPIRE GST', 'Internal transfer');
    await pay('PO4', '2026-11-21', 7000, 'UPI-TEST AGENCY-TEST@HDFCBANK-HDFC0000001-1-UPI', 'Marketing'); // already given another head
    await pay('PO5', '2026-11-21', 200000, 'NEFT DR-HDFC0000001-TEST PARTNER-OSHIWARA-HDFCN1'); // a day before the sheet's date
    await pay('PO6', '2026-11-22', 5100, 'UPI-TEST TRUST-TRUST@OKSBI-SBIN0000001-2-UPI');
    await pay('PO7', '2026-11-22', 640, 'UPI-UNRELATED-A@B-C-4-UPI'); // not on the sheet
    const rec = (ref, d, bank, amt, desc) => db.q("insert into acc_receipts (book, ref_id, txn_date, bank, amount, description, source) values ('aspire', $1, $2, $3, $4, $5, 'statement')", [ref, d, bank, amt, desc]);
    await rec('BL1', '2026-11-20', 'Aspire HDFC 100% (6462)', 400000, 'NEFT CR-SBIN0000001-TEST BUYER-DREAM ASPIRE');
    await rec('BL2', '2026-11-20', B, 1000000, 'FD CLOSURE PROCEEDS');

    await step('the sheet reads: dates typed as dd/mm/yy, banks by account, lines without a head listed', async () => {
      const p = A.parse(require('../lib/xlsx').read(fs.readFileSync(file)));
      assert.equal(p.pays.length, 7); assert.equal(p.recs.length, 2); assert.equal(p.issues.length, 1);
      assert.equal(p.pays[4].date, '2026-11-22'); assert.equal(p.pays[0].bank, '7044'); assert.equal(p.recs[0].bank, '6462');
    });
    await step('preview: each line found by amount, date and narration; nothing saved', async () => {
      const p = await admin('/api/import', { action: 'aspire-cashflow-preview', projectId: asp.id });
      assert.equal(p.status, 200, p.error);
      assert.deepEqual(p.matched, { payments: 6, receipts: 2 });
      assert.equal(p.notInErp.payments, 1); assert.equal(p.notInErp.sample[0].amount, 99999);
      assert.equal(p.differ, 1); assert.deepEqual([p.differTop[0].erp, p.differTop[0].sheet], ['Marketing', 'Site Expense']);
      assert.deepEqual(p.newHeads.map((h) => h.name), ['Charity']);
      assert.equal(p.erpNoHeadLeft.payments, 1);
      assert.equal((await db.one("select count(*)::int as n from acc_payments where head is not null")).n, 2);
    });
    await step('commit: heads, payees, the partner\'s own head, the buyer\'s flat; other heads and edit times left alone', async () => {
      const r = await admin('/api/import', { action: 'aspire-cashflow-commit', projectId: asp.id });
      assert.equal(r.ok, true, r.error);
      const P = Object.fromEntries((await db.q("select ref_id, head, payee, updated_at from acc_payments where book = 'aspire'")).map((x) => [x.ref_id, x]));
      assert.deepEqual([P.PO1.head, P.PO1.payee], ['Tenant Rent', 'Test Tenant Two']);
      assert.deepEqual([P.PO2.head, P.PO2.payee], ['Tenant Rent', 'Test Tenant One']);
      assert.equal(P.PO3.head, 'Internal transfer');
      assert.deepEqual([P.PO4.head, P.PO4.payee], ['Marketing', 'Test Agency']);
      assert.deepEqual([P.PO5.head, P.PO5.payee], ['Partner Withdrawal-Rafi Sir', 'Test Partner']);
      assert.equal(P.PO6.head, 'Charity'); assert.equal(P.PO7.head, null);
      assert.ok(Object.values(P).every((x) => x.updated_at == null), 'edit times untouched');
      assert.equal((await db.one("select section from acc_heads where book = 'aspire' and side = 'payment' and name = 'Charity'")).section, 'Operating');
      const R = Object.fromEntries((await db.q("select ref_id, head, unit_no, payment_head, payer_name from acc_receipts where book = 'aspire'")).map((x) => [x.ref_id, x]));
      assert.deepEqual([R.BL1.head, R.BL1.unit_no, R.BL1.payment_head, R.BL1.payer_name], ['Receipts From Customers', 'A-1001', 'AV', 'Test Buyer']);
      assert.deepEqual([R.BL2.head, R.BL2.unit_no], ['Fixed Deposit', null]);
      assert.equal((await db.one("select count(*)::int as n from audit_log where action = 'aspire-cashflow'")).n, 1);
    });
    await step('run again: nothing more to fill', async () => {
      const p = await admin('/api/import', { action: 'aspire-cashflow-preview', projectId: asp.id });
      assert.equal(p.paymentHeads + p.payees + p.receiptHeads + p.payers + p.units, 0);
    });
    await step('only for Dream Aspire', async () => {
      const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
      assert.equal((await admin('/api/import', { action: 'aspire-cashflow-preview', projectId: sig.id })).status, 400);
    });
    console.log(`\nAspire cash flow import: ${n} checks passed`);
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  server.close(); db.reset(); process.exit(process.exitCode || 0);
})();
