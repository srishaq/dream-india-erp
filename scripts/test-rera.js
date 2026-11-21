// MahaRERA filings (CA / Tax → RERA): Form 3 working, Table C, RERA bank, Word drafts, sending to the CA.
// DATABASE_URL=postgres://... node scripts/test-rera.js   (an empty database; synthetic data only)
require('./login-code-helper');
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3996';
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
const server = require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, raw) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return { status: r.status, type: r.headers.get('content-type'), name: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) };
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  try {
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
    const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
    assert.equal((await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } })).ok, true);
    const pay = (d, bank, amt, head) => db.q("insert into acc_payments (book, ref_id, txn_date, bank, amount, head, source) values ('signature', $1, $2, $3, $4, $5, 'test')", ['T' + Math.floor(Math.random() * 1e7), d, bank, amt, head]);
    const rec = (d, bank, amt, unit, ph = 'AV') => db.q("insert into acc_receipts (book, ref_id, txn_date, bank, amount, unit_no, payment_head, source) values ('signature', $1, $2, $3, $4, $5, $6, 'test')", ['T' + Math.floor(Math.random() * 1e7), d, bank, amt, unit, ph]);
    await pay('2026-03-10', 'Prime HDFC (8650)', 999999, 'Test Steel Pvt Ltd');      // before the last Form 3: already in its figures
    await pay('2026-07-10', 'Prime HDFC (8650)', 1000000, 'Test Steel Pvt Ltd');     // construction (by name)
    await pay('2026-08-10', 'Prime HDFC (8650)', 200000, 'SLUM REHABILITATION AUTHORITY'); // premium
    await pay('2026-08-11', 'Prime HDFC (8650)', 50000, '12 Test Tenant Name');       // rehab rent
    await pay('2026-08-12', 'Prime HDFC (8650)', 7000000, 'Internal transfer');       // not a cost
    await pay('2026-08-13', 'Prime HDFC (8650)', 30000, 'Mystery Vendor');            // not on a line yet
    await pay('2026-09-01', 'Yes RERA Collection 70% (0800)', 400000, 'Test Steel Pvt Ltd'); // withdrawn from the designated account
    await rec('2026-07-15', 'Yes RERA Collection 70% (0800)', 2500000, 'A-101');
    await rec('2026-07-16', 'Yes RERA Collection 100% (0700)', 900000, 'A-101');
    await rec('2026-08-20', 'Prime HDFC (8650)', 120000, 'A-102');                   // buyer money outside the RERA accounts
    let S;

    await step('Form 3: the last certified figures plus the payments after it, each head on a Form 3 line', async () => {
      S = await admin('/api/ca?rera=2026-09-30');
      assert.equal(S.status, 200, JSON.stringify(S)); assert.equal(S.qe, '2026-09-30'); assert.equal(S.can.edit, true);
      assert.equal(S.F3.estTotal, 5184500000);
      assert.equal(S.incurred.constr, 326275800 + 1000000 + 400000);
      assert.equal(S.incurred.land_premium, 202555583 + 200000);
      assert.equal(S.incurred.rehab_clearance, 94452737 + 50000);
      assert.equal(S.F3.incTotal, 684640340 + 1650000);
      assert.equal(S.F3.withdrawn, 400000); assert.equal(S.F3.net, S.F3.withdrawable - 400000);
      const h = Object.fromEntries(S.heads.map((x) => [x.head, x]));
      assert.equal(h['Internal transfer'].line, 'exclude'); assert.equal(h['Mystery Vendor'].state, 'open'); assert.equal(h['Test Steel Pvt Ltd'].state, 'suggested');
      assert.ok(S.checks.some((c) => /not yet put on a Form 3 line/.test(c)));
    });
    await step('Accounts puts a head on a line; it counts from then on', async () => {
      assert.equal((await admin('/api/ca', { action: 'rera-heads', heads: { 'Mystery Vendor': 'dev_other', 'Test Steel Pvt Ltd': 'constr' } })).ok, true);
      const S2 = await admin('/api/ca?rera=2026-09-30');
      assert.equal(S2.incurred.dev_other, 61356220 + 30000);
      assert.equal(S2.heads.find((x) => x.head === 'Test Steel Pvt Ltd').state, 'confirmed');
    });
    await step('Table C: sold, booked and unsold units; Table D and the RERA bank accounts', async () => {
      const S3 = await admin('/api/ca?rera=2026-09-30');
      assert.ok(S3.units.sold + S3.units.booked > 0); assert.ok(S3.units.unsold > 0);
      assert.ok(S3.F3.tableD.unsoldValue > 0); assert.equal(S3.F3.tableD.balCost, S3.F3.estTotal - S3.F3.incTotal);
      const des = S3.bank.find((a) => a.role === 'designated'); assert.equal(des.deposits, 2500000); assert.equal(des.withdrawals, 400000);
      assert.equal(S3.outside, 1); assert.equal(S3.outsideAmt, 120000);
      assert.equal(S3.F3.tableE.closing, 2100000);
    });
    await step('the Excel working and the Word drafts of Forms 1, 2 and 3 download', async () => {
      const x = await admin('/api/ca?rera=2026-09-30&file=xlsx', null, true);
      assert.equal(x.status, 200); assert.match(x.type, /spreadsheet/); assert.equal(x.buf.slice(0, 2).toString(), 'PK'); assert.match(x.name, /working 2026-09-30\.xlsx/);
      for (const f of ['form1', 'form2', 'form3']) {
        const w = await admin(`/api/ca?rera=2026-09-30&file=${f}`, null, true);
        assert.equal(w.status, 200, f); assert.match(w.type, /wordprocessing/); assert.equal(w.buf.slice(0, 2).toString(), 'PK');
        const doc = require('zlib');
        assert.ok(w.buf.length > 2000, f);
      }
    });
    await step('settings: estimated cost and consultants change; only Head Accounts or Admin', async () => {
      assert.equal((await admin('/api/ca', { action: 'rera-settings', settings: { rrPerSqm: '2,80,000', architect: { name: 'Test Architect', license: 'CA/1', email: '' }, estimate: { constr: '3,10,00,00,000', land_premium: 464500000, rehab_construction: 1120000000, rehab_clearance: 100000000, dev_other: 500000000 } } })).ok, true);
      const S4 = await admin('/api/ca?rera=2026-09-30');
      assert.equal(S4.settings.rrPerSqm, 280000); assert.equal(S4.settings.architect.name, 'Test Architect'); assert.equal(S4.F3.estTotal, 5184500000 + 100000000);
      const h = await admin('/api/users', { action: 'create', name: 'Mgmt', username: 'mg1', role: 'management', projects: [sig.id] });
      const m = client(); await m('/api/session', { action: 'login', username: 'mg1', password: h.tempPassword }); await m('/api/session', { action: 'password', current: h.tempPassword, next: 'mgmt-password-12' });
      assert.equal((await m('/api/ca?rera=2026-09-30')).status, 200);
      assert.equal((await m('/api/ca', { action: 'rera-settings', settings: { rrPerSqm: 1 } })).status, 403);
    });
    await step('the quarterly email goes once, from the 3rd of the month after the quarter', async () => {
      const R = require('../lib/rera');
      assert.equal((await R.morning('2026-11-05')).skipped, 'not a quarter month');
      const r = await R.morning('2026-10-03'); assert.ok(r.skipped || r.sent); // no mail account in tests
    });
    console.log(`\nRERA filings: ${n} checks passed`);
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  server.close(); db.reset(); process.exit(process.exitCode || 0);
})();
