// PDC register in the accounts team's format: types and purposes, one cheque for many invoices (cleared together, one
// reminder), invoices whose cheque is not given yet, and the Excel upload. Synthetic data only.
// DATABASE_URL=postgres://... node scripts/test-pdc.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3994';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'X-Book': 'signature', ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const day = (k) => new Date(Date.now() + 5.5 * 3600e3 + k * 864e5).toISOString().slice(0, 10);

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const db = require('../lib/db');
  await db.q("insert into acc_banks (book, name) values ('signature', 'Test Bank 8650'), ('signature', 'Other Bank 1111') on conflict do nothing");

  await step('a PDC row needs its type and purpose; the purpose is a dropdown', async () => {
    const base = { issued_to: 'Test Steel Co', amount: 1000, due_date: day(10) };
    assert.match((await api('/api/accounts', { action: 'save', reg: 'pdc', data: base })).error, /Type is required/);
    assert.match((await api('/api/accounts', { action: 'save', reg: 'pdc', data: { ...base, pdc_type: 'Purchase', purpose: 'Snacks' } })).error, /not on the list/);
    const r = await api('/api/accounts', { action: 'save', reg: 'pdc', data: { ...base, pdc_type: 'Purchase', purpose: 'Steel / TMT bars', invoice_no: 'T-1', tds_section: '194Q (0.1%)' } });
    assert.equal(r.status, 200, r.error);
  });

  await step('one cheque for three invoices: cleared together by its total, one reminder email', async () => {
    for (const [inv, amt] of [['A-1', 100000], ['A-2', 50000], ['A-3', 25000]])
      await api('/api/accounts', { action: 'save', reg: 'pdc', data: { pdc_type: 'Purchase', purpose: 'RMC (ready-mix concrete)', issued_to: 'Test RMC LLP', invoice_no: inv, amount: amt, bank: 'Test Bank 8650', cheque_no: '012345', due_date: day(2) } });
    const due = await require('../lib/book').run('signature', () => require('../lib/pdc-mail').due(day(0)));
    const mine = due.filter((x) => x.row.issued_to === 'Test RMC LLP');
    assert.equal(mine.length, 1); assert.equal(mine[0].ids.length, 3); assert.equal(Number(mine[0].row.amount), 175000);
    assert.match(require('../lib/pdc-mail').message('48h', mine[0].row).subject, /1,75,000/);
    let r = await api('/api/accounts?reg=pdc&filter=');
    const rows = r.rows.filter((x) => x.issued_to === 'Test RMC LLP'); assert.equal(rows.length, 3); assert.ok(rows.every((x) => Number(x.cheque_total) === 175000));
    assert.ok(!rows.some((x) => x.state === 'Duplicate?'));
    // the bank debit of the whole cheque clears all three invoices
    await db.q("insert into acc_payments (book, ref_id, txn_date, bank, amount, reference, description) values ('signature', 'PAY-T1', $1, 'Test Bank 8650', 175000, 'CHQ 012345', 'Test RMC LLP')", [day(2)]);
    r = await api('/api/accounts?reg=pdc&filter=pdcCleared');
    assert.equal(r.rows.filter((x) => x.issued_to === 'Test RMC LLP').length, 3);
  });

  await step('the accounts team\'s PDC Excel is read: purchase, SRA and not-yet-issued, banks by their last digits, nothing added twice', async () => {
    const W = require('../lib/xlsx-write');
    const buf = W.write([
      { name: 'PRIME PDC Details', rows: [['PURCHASE PDC'], [null, null, null, null, 1000], ['SR. No.', 'Particulars', 'Invoice Dt.', 'Invoice No.', 'AMOUNT INCLUDING TDS', 'CGST', 'SGST', 'TDS AMOUNT', 'TDS SECTION', 'PAID AMOUNT AFTER DEDUCTING TDS', 'Cheque Dt.', 'Cheque No.', 'DESCRIPTION'],
        [1, 'TEST CONCRETE PVT LTD', day(-5), 'TC/1', 1000, 90, 90, 1, '194Q(0.10%)', 1179, day(5), '055241', 'RMC - M-45'], [2, 'TEST CONCRETE PVT LTD', day(-5), 'TC/2', 500, 45, 45, 10, '194C(2%)', 580, day(5), 817906, 'Pumping Charges']] },
      { name: 'SRA  PDC', rows: [['SR.NO.', 'PARTICULARS', 'PDC DATE', 'CHEQUE NUMBER', 'AMOUNT', 'BANK NAME'], [1, 'SRA Charges', day(20), '000917', 70000, 'TEST 8650'], [2, 'SRA Charges', day(30), ' 065863', 4000, 'OTHER-1111'], [null]] },
      { name: 'Upcoming PDC', rows: [[], ['SR. No.', 'Particulars', 'Invoice Dt.', 'PDC', 'Invoice No.', 'Invoice Amt', 'Description'], [1, 'TEST STEEL ENTERPRISES LLP', day(-30), day(3), 'TS/9', 250000, 'TMT BARS'], [null, null, null, null, null, 250000], ['SR. No.', 'Particulars', 'Invoice Dt.', 'PDC', 'Invoice No.', 'Invoice Amt'], [1, 'TEST STEEL ENTERPRISES LLP', day(-20), null, 'TS/10', 1000]] },
    ]).toString('base64');
    const p = await api('/api/accounts', { action: 'pdc-import-preview', file: buf }); assert.equal(p.status, 200, p.error);
    assert.equal(p.summary.purchase, 2); assert.equal(p.summary.sra, 2); assert.equal(p.summary.notIssued, 1); assert.equal(p.problems.length, 1);
    const r = await api('/api/accounts', { action: 'pdc-import', file: buf }); assert.equal(r.added, 5);
    const rows = await db.q("select * from acc_pdc where imported order by id");
    const sra = rows.filter((x) => x.pdc_type === 'SRA'); assert.deepEqual(sra.map((x) => x.bank), ['Test Bank 8650', 'Other Bank 1111']);
    assert.equal(sra[1].cheque_no, '065863');
    const pump = rows.find((x) => x.invoice_no === 'TC/2'); assert.equal(pump.purpose, 'Pumping charges'); assert.equal(pump.tds_section, '194C (1% / 2%)'); assert.equal(pump.cheque_no, '817906');
    assert.equal(rows.find((x) => x.invoice_no === 'TC/1').purpose, 'RMC (ready-mix concrete)');
    const up = rows.find((x) => x.invoice_no === 'TS/9'); assert.equal(up.cheque_status, 'Not issued yet'); assert.equal(up.purpose, 'Steel / TMT bars');
    const again = await api('/api/accounts', { action: 'pdc-import-preview', file: buf }); assert.equal(again.summary.rows, 0); assert.equal(again.already, 5);
    // not issued yet: no reminder, not in Pending, shown as such
    const due = await require('../lib/book').run('signature', () => require('../lib/pdc-mail').due(day(1)));
    assert.ok(!due.some((x) => x.row.issued_to === 'TEST STEEL ENTERPRISES LLP'));
    const ni = await api('/api/accounts?reg=pdc&filter=pdcNotIssued'); assert.equal(ni.rows.length, 1); assert.equal(ni.rows[0].state, 'Cheque not given yet');
    const pend = await api('/api/accounts?reg=pdc&filter=pdcPending'); assert.ok(!pend.rows.some((x) => x.cheque_status === 'Not issued yet'));
    const sraF = await api('/api/accounts?reg=pdc&filter=pdcSra'); assert.equal(sraF.rows.length, 2);
    const t = await api('/api/accounts', { action: 'pdc-template' }); assert.ok(t.data);
  });

  console.log(`PDC: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
