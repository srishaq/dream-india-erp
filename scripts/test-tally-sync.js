// Sync with Tally: the ERP brought in line with Tally's four registers without losing what staff filled.
// DATABASE_URL=postgres://... node scripts/test-tally-sync.js   (a fresh database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3994';
const server = require('./dev-server');
const db = require('../lib/db');
const XW = require('../lib/xlsx-write');
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
const R30 = 'Yes Bank Ltd RERA 092872400000501 - 30%', HD = 'HDFC Bank A/c No. 99907178678650', RAFI = 'Syed Rafi Ishaq - Current A/c', MUB = 'Mubeen Sir – Reimbursement';
const reg = (title, vouchers, period = '1-Oct-26 to 31-Oct-26') => XW.write([{ name: 'Sheet1', rows: [['M/S. PRIME REALTORS'], ['Maharashtra,India'], [title], [period],
  ['Date', 'Particulars', '', '', 'Vch Type', 'Vch No.', 'Debit', 'Credit'], ['', '', '', '', '', '', 'Amount', 'Amount'], ...vouchers.flat(), ['Total:', null, null, null, null, null, null, 1]] }]);
const V = (date, type, no, lines) => lines.map(([ledger, dr, cr], i) => (i === 0 ? [date, ledger, '', '', type, String(no), dr, cr] : ['', ledger, '', '', '', '', dr, cr]));
const b64 = (b) => b.toString('base64');

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const files = (R, P, C, J) => [['Receipts.xlsx', R], ['Payments.xlsx', P], ['Contra.xlsx', C], ...(J ? [['Journal.xlsx', J]] : [])].map(([name, x]) => ({ name, data: b64(x) }));
  // what the ERP had: the first Tally import (October)
  const R1 = reg('Receipt Register', [V('2026-10-03', 'Receipt', 6, [[RAFI, null, 1000000], [HD, 1000000, null]])]);
  const P1 = reg('Payment Register', [
    V('2026-10-05', 'Payment', 1734, [['SKYWAY RMC PLANTS PVT LTD', 400000, null], [R30, null, 400000]]),
    V('2026-10-06', 'Payment', 1509, [[RAFI, 300000, null], ['Mubeen Sir', 200000, null], [R30, null, 500000]]),
    V('2026-10-07', 'Payment', 1510, [['Old Vendor', 25000, null], [R30, null, 25000]]),
    V('2026-10-08', 'Payment', 1511, [['Cement Co', 90000, null], [R30, null, 90000]]),
  ]);
  const C1 = reg('Contra Register', [V('2026-10-09', 'Contra', 12, [[R30, 100000, null], [HD, null, 100000]])]);
  let pay;
  await step('the first import (before Sync existed): a voucher with two ledgers is now one row per ledger', async () => {
    const im = await admin('/api/accounts', { action: 'tally-import', files: files(R1, P1, C1) });
    assert.equal(im.ok, true, im.error);
    pay = (await admin('/api/accounts?reg=payments&limit=100')).rows;
    const v = pay.filter((r) => /^P2627-1509\//.test(r.ref_id)).sort((a, b) => a.ref_id.localeCompare(b.ref_id));
    assert.deepEqual(v.map((r) => [r.payee, Number(r.amount)]), [[RAFI, 300000], ['Mubeen Sir', 200000]]);
    assert.equal(v[0]._split.total, 500000);
  });
  await step('the ERP as it was on the live site: old single rows, staff work, ERP entries', async () => {
    const u = (await db.one("select id from users where username = 'admin'")).id;
    // the old import kept a two-ledger voucher as one row under its biggest ledger
    await db.q("delete from acc_payments where ref_id like 'P2627-1509/%'");
    await db.q("insert into acc_payments (book, imported, source, ref_id, txn_date, bank, amount, head, payee, remark, created_by) values ('signature', true, 'Tally', 'P2627-1509', '2026-10-06', 'Yes RERA 30% (0501)', 500000, $1, $1, 'Tally Payment 1509 · several ledgers in one voucher', $2)", [RAFI, u]);
    // the old import gave a voucher Tally keeps without a number the ID R2627-
    const rb = await db.one("select bank from acc_receipts where ref_id = 'R2627-6'");
    await db.q("insert into acc_receipts (book, imported, source, ref_id, txn_date, bank, amount, head, payer_name, created_by) values ('signature', true, 'Tally', 'R2627-', '2026-10-26', $1, 1861000, 'Loan', 'Partner Loan A/c', $2)", [rb.bank, u]);
    // staff split Skyway's payment with invoice numbers, and filled a bill on Cement Co
    const sky = pay.find((r) => r.ref_id === 'P2627-1734');
    const s = await admin('/api/accounts', { action: 'split-row', reg: 'payments', id: sky.id, parts: [{ head: 'RMC', amount: 150000, bill_no: 'INV-1' }, { head: 'RMC', amount: 250000, bill_no: 'INV-2' }] });
    assert.equal(s.ok, true, s.error);
    await db.q("update acc_payments set head = 'Cement', bill_no = 'CB-77', vendor_pan = 'AAAPC1234C' where ref_id = 'P2627-1511'");
    // two entries made in the ERP: one Tally later took (a day later), one it has not
    for (const [d, a, p] of [['2026-10-20', 70000, 'Electric Co'], ['2026-10-21', 12000, 'Tea Stall']]) {
      const r = await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: d, bank: 'Yes RERA 30% (0501)', amount: a, payee: p } });
      assert.ok(r.ok || r.id || r.row, JSON.stringify(r).slice(0, 200));
    }
  });
  // Tally now: 1510 deleted, 1511 changed, 1512 new, 1520 = the ERP's Electric Co entry, and a journal
  const P2 = reg('Payment Register', [
    V('2026-10-05', 'Payment', 1734, [['SKYWAY RMC PLANTS PVT LTD', 400000, null], [R30, null, 400000]]),
    V('2026-10-06', 'Payment', 1509, [[RAFI, 300000, null], ['Mubeen Sir', 200000, null], [R30, null, 500000]]),
    V('2026-10-08', 'Payment', 1511, [['Cement Co', 95000, null], [R30, null, 95000]]),
    V('2026-10-12', 'Payment', 1512, [['Steel Co', 60000, null], ['TDS on Contract', null, 1200], [R30, null, 58800]]),
    V('2026-10-21', 'Payment', 1520, [['Electric Co', 70000, null], [R30, null, 70000]]),
    V('2026-10-22', 'Payment (HDFC)', 1511, [['Courier Co', 3000, null], [HD, null, 3000]]), // a second voucher type numbered alike
  ]);
  const R2 = reg('Receipt Register', [V('2026-10-03', 'Receipt', 6, [[RAFI, null, 1000000], [HD, 1000000, null]]),
    V('2026-10-26', 'Receipt', '', [['Partner Loan A/c', null, 1861000], [HD, 1861000, null]]), V('2026-10-27', 'Receipt', '', [['Partner Loan A/c', null, 5000], [HD, 5000, null]])]);
  const J2 = reg('Journal Register', [V('2026-10-16', 'Journal', 314, [[RAFI, 50000, null], [MUB, null, 50000]])]);
  let pv;
  await step('check against Tally: nothing changes, and it says what would', async () => {
    pv = await admin('/api/accounts', { action: 'tally-sync-preview', files: files(R2, P2, C1, J2) });
    assert.equal(pv.status, 200, pv.error);
    assert.deepEqual(pv.period, { from: '2026-10-01', to: '2026-10-31', sameForAll: true });
    const p = pv.payments; if (process.env.DBG) console.log(JSON.stringify(p, null, 1));
    assert.equal(p.same, 2); // Skyway (split by staff, same ledger total) and the contra
    assert.equal(p.replace, 3); // 1509 (old single row), 1511 (amount changed), Electric Co (the ERP's entry, a day off in Tally) assert.equal(p.add, 1); assert.equal(p.remove, 1); assert.equal(p.erpOnly, 1);
    assert.equal(p.erpOnlyRows[0].who, 'Tea Stall');
    assert.equal(pv.journals.now, 1);
    assert.deepEqual([pv.receipts.same, pv.receipts.add, pv.receipts.remove], [3, 1, 0]); // receipt 6, the contra, the numberless voucher found as R2627-; the new numberless one added
    assert.equal((await admin('/api/accounts?reg=payments&q=Steel')).total, 0);
  });
  await step('sync: the ERP follows Tally, staff work stays, every ledger matches but the ERP-only entry', async () => {
    // the files go up in parts first, as the page sends them
    const parts = [];
    for (const f of files(R2, P2, C1, J2)) { const id = 'x' + Math.random().toString(36).slice(2, 10); const half = Math.ceil(f.data.length / 2);
      for (let i = 0; i < 2; i++) assert.equal((await admin('/api/accounts', { action: 'file-part', id, part: i, of: 2, data: f.data.slice(i * half, (i + 1) * half) })).ok, true);
      parts.push({ name: f.name, fileId: id }); }
    const r = await admin('/api/accounts', { action: 'tally-sync', files: parts });
    assert.equal(r.ok, true, r.error);
    const rows = (await admin('/api/accounts?reg=payments&limit=200')).rows, by = (re) => rows.filter((x) => re.test(x.ref_id || '')).sort((a, b) => a.ref_id.localeCompare(b.ref_id));
    assert.deepEqual(by(/^P2627-1734\//).map((x) => x.bill_no), ['INV-1', 'INV-2']); // staff split untouched
    assert.deepEqual(by(/^P2627-1509/).map((x) => [x.ref_id, x.payee, Number(x.amount)]), [['P2627-1509/1', RAFI, 300000], ['P2627-1509/2', 'Mubeen Sir', 200000]]);
    assert.equal(by(/^P2627-1510/).length, 0);
    const c = by(/^P2627-1511$/)[0]; assert.equal(Number(c.amount), 95000); assert.equal(c.head, 'Cement'); assert.equal(c.bill_no, 'CB-77'); assert.equal(c.vendor_pan, 'AAAPC1234C');
    assert.deepEqual(by(/^P2627-1512\//).map((x) => [x.payee, Number(x.amount)]), [['Steel Co', 60000], ['TDS on Contract', -1200]]);
    assert.equal(rows.find((x) => x.payee === 'Courier Co').ref_id, 'P2627-1511.2'); // numbered alike in Tally: still its own row
    const el = rows.filter((x) => x.payee === 'Electric Co'); assert.equal(el.length, 1); // not added twice
    assert.equal(el[0].ref_id, 'PO00001'); assert.equal(el[0].txn_date.slice(0, 10), '2026-10-21'); // its ERP ID kept, Tally's date
    assert.ok((await db.one("select tally_at from acc_payments where ref_id = 'PO00001'")).tally_at); // never sent to Tally again
    const j = (await admin('/api/accounts?reg=journals')).rows; assert.equal(j.length, 2); assert.ok(j.every((x) => x.ref_id === 'J2627-314'));
    assert.deepEqual(r.check.different.map((x) => x.ledger), ['Tea Stall']);
    const rafiT = (r.check.different.find((x) => x.ledger === RAFI)); assert.equal(rafiT, undefined);
    // a second sync with the same registers changes nothing
    const again = await admin('/api/accounts', { action: 'tally-sync-preview', files: files(R2, P2, C1, J2) });
    assert.equal(again.payments.replace + again.payments.add + again.payments.remove, 0); assert.equal(again.receipts.replace + again.receipts.add + again.receipts.remove, 0);
    const rr = (await admin('/api/accounts?reg=receipts&limit=50')).rows.map((x) => x.ref_id).sort();
    assert.ok(rr.includes('R2627-N2026102701'), rr.join(','));
    const page = await admin('/api/accounts?view=import'); assert.equal(page.lastSync.after.period.from, '2026-10-01');
  });
  await step('journals are read only in the ERP', async () => {
    const j = (await admin('/api/accounts?reg=journals')).rows[0];
    const r = await admin('/api/accounts', { action: 'save', reg: 'journals', id: j.id, data: { ledger: 'X' } }); assert.equal(r.status, 400);
    assert.equal((await admin('/api/accounts?reg=journals')).can.enter, false);
  });
  console.log(`Sync with Tally: ${n} checks passed`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
