// Vendor bills from Tally (Journal / Purchase / Payment Registers, TDS workings) into Payments Out. Synthetic data only.
// DATABASE_URL=postgres://... node scripts/test-tally-bills.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-'));
process.env.TALLY_BILLS_FIXTURE_DIR = dir;
process.env.PORT = process.env.PORT || '3994';
const server = require('./dev-server');
const db = require('../lib/db');
const { write } = require('../lib/xlsx-write');
const BASE = `http://localhost:${process.env.PORT}`;
function client() { let cookie = ''; return async (p, body) => { const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; }; }
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const head = (t) => [['M/S. TEST REALTORS'], ['Maharashtra,India'], [t], ['1-Apr-26 to 31-Mar-27'], ['Date', 'Particulars', '', '', '', '', 'Vch Type', 'Vch No.', 'Debit', 'Credit'], ['', '', '', '', '', '', '', '', 'Amount', 'Amount']];
(async () => {
  try {
    fs.writeFileSync(path.join(dir, 'JOURNAL REGISTER 1-Apr-26 to 31-Mar-27.xlsx'), write([{ name: 'Sheet1', rows: [...head('Journal Register'),
      ['2026-05-02', 'Rent for Office', '', '', '', '', 'Journal', '7', 100000, null], ['', 'CGST', '', '', '', '', '', '', 9000, null], ['', 'SGST', '', '', '', '', '', '', 9000, null],
      ['', 'Test Landlord', '', '', '', '', '', '', null, 108000], ['', 'TDS on Rent 194I', '', '', '', '', '', '', null, 10000], [null, 'Rent May Vide Inv.No.R-55 dt.01/05/26'],
      ['2026-05-03', 'A-1001-Some Buyer', '', '', '', '', 'Journal', '8', 500, null], ['', 'A-1001-Some Buyer-GST', '', '', '', '', '', '', null, 500]] }]));
    fs.writeFileSync(path.join(dir, 'PAYMENT REGISTER 1-Apr-26 to 31-Mar-27.xlsx'), write([{ name: 'Sheet1', rows: [...head('Payment Register'),
      ['2026-05-05', 'Test Landlord', '', '', '', '', 'Payment', '3', 108000, null], ['', 'Yes Bank Ltd RERA 092872400000501 - 30%', '', '', '', '', '', '', null, 108000]] }]));
    fs.writeFileSync(path.join(dir, 'Master TDS Working.xlsx'), write([{ name: 'May-26', rows: [[], ['SR. NO.', 'MONTH', 'PARTICULARS', 'PAN', 'RELEVANT DATE', 'SECTION', 'AMOUNT PAID', 'TDS RATE', 'TDS AMOUNT'], [1, 'May', 'Test Landlord', 'ABCPT1234Q', '2026-05-02', '194I', 100000, 0.1, 10000]] }]));
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
    // the statement's payment row (payee from the bank narration) and one already filled by hand
    await db.q("insert into acc_payments (book, ref_id, txn_date, bank, amount, payee, source) values ('signature', 'PO90001', '2026-05-06', 'Yes RERA 30% (0501)', 108000, 'NEFT DR-TEST LANDLO', 'statement')");
    await step('preview: the bill, its GST and TDS, matched to the payment by amount and date; nothing saved', async () => {
      const p = await admin('/api/import', { action: 'tally-bills-preview', projectId: sig.id });
      assert.equal(p.status, 200, p.error);
      assert.equal(p.bills, 1); assert.equal(p.matched, 1); assert.equal(p.filled, 1); assert.equal(p.pan, 1);
      assert.equal((await db.one('select count(*)::int as n from acc_vendor_bills')).n, 0);
    });
    await step('commit: the bill kept, the payment filled (total = taxable + GST, paid = total − TDS), the PAN from the workings', async () => {
      const r = await admin('/api/import', { action: 'tally-bills-commit', projectId: sig.id });
      assert.equal(r.ok, true, r.error);
      const v = await db.one('select party, tds_section, taxable, gst, total, tds, net, inv_no, inv_date::text as d from acc_vendor_bills');
      assert.deepEqual([v.party, v.tds_section, +v.taxable, +v.gst, +v.total, +v.tds, +v.net, v.inv_no, v.d], ['Test Landlord', '194-I', 100000, 18000, 118000, 10000, 108000, 'R-55', '2026-05-01']);
      const p = await db.one("select bill_no, taxable_value, gst_on_bill, total_bill, tds_deducted, tds_section, vendor_pan from acc_payments where ref_id = 'PO90001'");
      assert.deepEqual([p.bill_no, +p.taxable_value, +p.gst_on_bill, +p.total_bill, +p.tds_deducted, p.tds_section, p.vendor_pan], ['R-55', 100000, 18000, 118000, 10000, '194-I', 'ABCPT1234Q']);
      const again = await admin('/api/import', { action: 'tally-bills-commit', projectId: sig.id });
      assert.equal(again.filled, 0); assert.equal((await db.one('select count(*)::int as n from acc_vendor_bills')).n, 1);
    });
    console.log(`\nTally bills: ${n} checks passed`);
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  server.close(); db.reset(); process.exit(process.exitCode || 0);
})();
