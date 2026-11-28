// Corrections in Excel (lib/acc-fixes.js): the rows that still need a head or flat are downloaded, filled in Excel and
// uploaded; the ERP shows the changes first, checks them like the edit window, and saves them. Synthetic data only.
// DATABASE_URL=postgres://... node scripts/test-acc-fixes.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3995';
const server = require('./dev-server');
const db = require('../lib/db');
const X = require('../lib/xlsx'), W = require('../lib/xlsx-write');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, book) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(book ? { 'X-Book': book } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  try {
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    await db.q("insert into acc_heads (book, side, name) values ('signature', 'receipt', 'Test Receipts Head'), ('signature', 'payment', 'Test Office Head')").catch(() => {});
    await db.q("insert into acc_receipts (book, ref_id, txn_date, bank, amount, description, source) values ('signature', 'BSX001', '2026-11-02', 'Prime HDFC (8650)', 500000, 'NEFT CR-TEST BUYER', 'test'), ('signature', 'BSX002', '2026-11-03', 'Prime HDFC (8650)', 1000, 'INTEREST', 'test')");
    await db.q("insert into acc_payments (book, ref_id, txn_date, bank, amount, description, source) values ('signature', 'POX001', '2026-11-04', 'Prime HDFC (8650)', 75000, 'NEFT DR-TEST VENDOR', 'test')");
    let file;
    await step('the sheet lists the rows without a head, biggest first, with the lists to pick from', async () => {
      const r = await admin('/api/accounts', { action: 'fix-sheet' });
      assert.equal(r.status, 200, r.error);
      const wb = X.read(Buffer.from(r.data, 'base64'));
      const rs = wb.find((s) => s.name === 'Receipts').rows;
      assert.equal(rs[0][0], 'ERP ID'); assert.deepEqual(rs.slice(1).map((x) => x[0]), ['BSX001', 'BSX002']);
      assert.match(String(rs[1][rs[0].indexOf('Why it is listed')]), /no head/);
      assert.ok(wb.some((s) => s.name === 'Lists'));
      file = wb;
    });
    await step('filled in Excel and uploaded: the changes are shown first, a wrong head is refused, the rest are saved', async () => {
      const heads = (await admin('/api/accounts?view=lists')).lists;
      const rh = heads.receiptHead[0], ph = heads.paymentHead2.find((h) => !/contract|vendor|consult|rent|cp|commission/i.test(h)) || heads.paymentHead2[0];
      const rs = file.find((s) => s.name === 'Receipts').rows, ps = file.find((s) => s.name === 'Payments Out').rows;
      const H = rs[0], set = (row, label, v) => { row[H.indexOf(label)] = v; };
      set(rs[1], 'Cash Flow Head', rh); set(rs[1], 'Remark', 'Flat to be confirmed');
      set(rs[2], 'Cash Flow Head', 'No such head');
      ps[1][ps[0].indexOf('Cash Flow Head')] = ph;
      const buf = W.write([{ name: 'Receipts', rows: rs }, { name: 'Payments Out', rows: ps }]).toString('base64');
      const p = await admin('/api/accounts', { action: 'fix-preview', file: buf });
      assert.equal(p.status, 200, p.error);
      console.log('    heads on the list:', heads.receiptHead.length, '/', heads.paymentHead2.length, '· problems:', p.problems);
      assert.ok(p.changes.some((c) => c.ref === 'BSX001' && c.changes.head[1] === rh));
      if (heads.receiptHead.length) assert.ok(p.problems.some((x) => /BSX002/.test(x) && /not on the list/.test(x)));
      assert.ok(p.changes.some((c) => c.ref === 'POX001') || p.problems.some((x) => /POX001/.test(x) && /bill/.test(x)), 'a payment is saved, or refused for its missing bill');
      assert.equal((await db.one("select head from acc_receipts where ref_id = 'BSX001'")).head, null, 'nothing saved by the preview');
      const a = await admin('/api/accounts', { action: 'fix-apply', file: buf });
      assert.equal(a.status, 200, a.error); assert.ok(a.saved >= 1);
      const r1 = await db.one("select head, remark, amount from acc_receipts where ref_id = 'BSX001'");
      assert.equal(r1.head, rh); assert.equal(r1.remark, 'Flat to be confirmed'); assert.equal(Number(r1.amount), 500000);
      assert.ok(await db.one("select 1 as x from audit_log where note = 'Corrections sheet (Excel upload)'"));
      const again = await admin('/api/accounts', { action: 'fix-preview', file: buf });
      assert.equal(again.changes.length, 0, 'uploading the same sheet twice changes nothing');
    });
    console.log(`Corrections sheet: ${n} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
})();
