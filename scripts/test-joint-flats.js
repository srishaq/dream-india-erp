// Jodi flats (lib/joint-flats.js): one payment for two flats entered once and saved as a receipt per flat, the one-cheque
// rule letting the pair share a cheque, and Tally vs CRM comparing the pair together. Synthetic data only.
// DATABASE_URL=postgres://... node scripts/test-joint-flats.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
const server = require('./dev-server');
const db = require('../lib/db');
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
    const JF = require('../lib/joint-flats');
    await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE' on conflict do nothing");
    const P = await db.one("select id from projects where code = 'ASPIRE'");
    const bld = await db.one("insert into buildings (project_id, code, name, kind) values ($1, 'A', 'Wing A', 'sale') returning id", [P.id]);
    const plan = (await db.one("insert into payment_plans (project_id, name) values ($1, 'Test plan') returning id", [P.id])).id;
    const bk = {};
    for (const [no, av] of [['A-802', 10000000], ['A-803', 20000000], ['A-901', 9000000]]) {
      const u = (await db.one("insert into units (project_id, building_id, unit_no, floor, status) values ($1, $2, $3, 8, 'booked') returning id", [P.id, bld.id, no])).id;
      bk[no] = (await db.one("insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, status, created_by) values ($1, $2, '2025-01-10', $3, 5, 'active', 1) returning id", [u, plan, av])).id;
    }
    // the pair, as migration 121 sets it up on the live data
    const M = require('../lib/migrations'); await db.script(M.find((x) => x.id === '121_joint_flats').sql);
    assert.deepEqual((await JF.groups(P.id)).map((x) => [x.label, x.units]), [['Shaheen', ['A-802', 'A-803']]], 'only the pairs whose flats exist are set up');

    await step('the split follows what each flat owes, else its agreement value, to the paisa', async () => {
      const s = JF.split(100000, [{ due: 0, av: 1 }, { due: 0, av: 2 }]); assert.deepEqual(s.map((x) => x.amount), [33333.33, 66666.67]);
      const t = JF.split(500000, [{ due: 100000, av: 9 }, { due: 300000, av: 1 }]); assert.deepEqual(t.map((x) => x.amount), [125000, 375000]);
      assert.deepEqual(JF.avGst(105000, 5), { av: 100000, gst: 5000 });
      assert.equal(await JF.samePair(bk['A-802'], bk['A-803']), true); assert.equal(await JF.samePair(bk['A-802'], bk['A-901']), false);
    });

    await step('one payment for the pair is saved as a receipt per flat, AV + GST each, with the same UTR', async () => {
      const j = await admin('/api/receipts?joint=' + bk['A-802'], null, 'aspire');
      assert.equal(j.status, 200, j.error); assert.deepEqual(j.joint.flats.map((f) => f.unit), ['A-802', 'A-803']);
      assert.equal((await admin('/api/receipts?joint=' + bk['A-901'], null, 'aspire')).joint, null);
      const bad = await admin('/api/receipts', { action: 'create-joint', bookingId: bk['A-802'], amount: '500000', receivedOn: '2026-11-20', mode: 'bank', instrumentNo: 'UTRJODI1', parts: [{ bookingId: bk['A-802'], amount: '100000' }, { bookingId: bk['A-803'], amount: '100000' }] }, 'aspire');
      assert.equal(bad.status, 400); assert.match(bad.error, /add up/);
      const notPair = await admin('/api/receipts', { action: 'create-joint', bookingId: bk['A-802'], amount: '500000', receivedOn: '2026-11-20', mode: 'bank', parts: [{ bookingId: bk['A-802'], amount: '250000' }, { bookingId: bk['A-901'], amount: '250000' }] }, 'aspire');
      assert.equal(notPair.status, 400); assert.match(notPair.error, /jodi flats/);
      const r = await admin('/api/receipts', { action: 'create-joint', bookingId: bk['A-802'], amount: '500000', receivedOn: '2026-11-20', mode: 'bank', bank: 'HDFC Bank', instrumentNo: 'UTRJODI1', parts: [{ bookingId: bk['A-802'], amount: '157500' }, { bookingId: bk['A-803'], amount: '342500' }] }, 'aspire');
      assert.equal(r.status, 200, r.error); assert.equal(r.ids.length, 2);
      const rows = await db.q("select r.booking_id, r.amount, r.instrument_no, r.note, (select json_object_agg(s.head, s.amount) from receipt_splits s where s.receipt_id = r.id) as sp from receipts r where r.instrument_no = 'UTRJODI1' order by r.booking_id");
      assert.deepEqual(rows.map((x) => Number(x.amount)), [157500, 342500]);
      assert.deepEqual(rows[0].sp, { av: 150000, gst: 7500 });
      assert.match(rows[0].note, /Jodi payment ₹5,00,000 for A-802 \+ A-803/);
      const again = await admin('/api/receipts', { action: 'create-joint', bookingId: bk['A-802'], amount: '500000', receivedOn: '2026-11-20', mode: 'bank', instrumentNo: 'UTRJODI1', parts: [{ bookingId: bk['A-802'], amount: '157500' }, { bookingId: bk['A-803'], amount: '342500' }] }, 'aspire');
      assert.equal(again.status, 409); assert.match(again.error, /cannot be entered twice/);
    });

    await step('one entity: entered once with no split by staff, one row in Receipts, one receipt for the buyer, approved together, one ledger', async () => {
      const r = await admin('/api/receipts', { action: 'create-joint', bookingId: bk['A-803'], amount: '210000', receivedOn: '2026-11-21', mode: 'bank', instrumentNo: 'UTRJODI2' }, 'aspire');
      assert.equal(r.status, 200, r.error); assert.equal(r.units, 'A-802 + A-803');
      const parts = await db.q("select booking_id, amount, joint_key from receipts where instrument_no = 'UTRJODI2' order by id");
      assert.equal(parts.length, 2); assert.equal(parts.reduce((a, x) => a + Number(x.amount), 0), 210000); assert.ok(parts[0].joint_key && parts[0].joint_key === parts[1].joint_key);
      assert.deepEqual(parts.map((x) => Number(x.amount)), [70000, 140000], 'by agreement value when nothing is owed yet');
      const L = await admin('/api/receipts?project=' + P.id, null, 'aspire');
      const mine = L.rows.filter((x) => x.instrument_no === 'UTRJODI2'); assert.equal(mine.length, 1, 'one row'); assert.equal(mine[0].unit_no, 'A-802 + A-803'); assert.equal(mine[0].amount, 210000);
      const F = await require('../lib/receipt-mail').receiptFigures(null, r.ids[1].id);
      assert.equal(F.doc.unit, 'A-802 + A-803'); assert.equal(F.doc.amount, 210000); assert.equal(F.r.id, r.ids[0].id);
      assert.equal(Math.round(F.doc.splits.reduce((a, x) => a + x[1], 0)), 210000);
      // approved by hand (an old-dated TDS-like receipt is simplest): both parts at once
      await db.q("update receipts set mode = 'other' where instrument_no = 'UTRJODI2'");
      const other = client(); const h = await admin('/api/users', { action: 'create', name: 'Head Acc', username: 'hacc', role: 'head_accounts', allProjects: true });
      await other('/api/session', { action: 'login', username: 'hacc', password: h.tempPassword }); await other('/api/session', { action: 'password', current: h.tempPassword, next: 'head-accounts-pw-12' });
      const ap = await other('/api/receipts', { action: 'approve', id: r.ids[0].id }, 'aspire');
      assert.equal(ap.status, 200, ap.error);
      assert.deepEqual((await db.q("select status from receipts where instrument_no = 'UTRJODI2'")).map((x) => x.status), ['approved', 'approved']);
      const led = await admin('/api/ledger?project=' + P.id, null, 'aspire');
      assert.ok(led.rows.some((x) => x.unit_no === 'A-802 + A-803'), 'one ledger row'); assert.ok(!led.rows.some((x) => x.unit_no === 'A-802'));
      const one = await admin('/api/ledger?booking=' + bk['A-802'], null, 'aspire');
      assert.equal(one.head.unit_no, 'A-802 + A-803'); assert.equal(one.lines.filter((l) => l.kind === 'receipt').length, 1, 'the payment shows once');
      await db.q("delete from receipt_splits where receipt_id in (select id from receipts where instrument_no = 'UTRJODI2')"); await db.q("delete from receipts where instrument_no = 'UTRJODI2'");
    });

    await step('one demand letter for the pair, with both flats and their figures added up', async () => {
      const plan2 = await db.one('select plan_id from bookings where id = $1', [bk['A-802']]);
      await db.q("insert into plan_stages (plan_id, seq, name, pct, construction_linked) values ($1, 1, 'On booking', 10, false) on conflict do nothing", [plan2.plan_id]).catch(() => {});
      for (const no of ['A-802', 'A-803']) await db.q("insert into demands (booking_id, stage_name, pct, amount, gst, demand_date, due_date, status) select id, 'On booking', 10, agreement_value * 0.1, agreement_value * 0.005, '2026-11-01', '2026-11-15', 'raised' from bookings where id = $1", [bk[no]]);
      const L = require('../lib/letters');
      const d = await L.letterData(bk['A-803'], 'Demand Letter', '2026-11-25', await L.settings());
      assert.equal(d.letter.unit, 'A-802 + A-803'); assert.equal(d.letter.av, 30000000);
      const r = await admin('/api/letters', { action: 'prepare', projectId: P.id, letterType: 'Demand Letter', bookingIds: [bk['A-802'], bk['A-803'], bk['A-901']].slice(0, 2) }, 'aspire');
      assert.equal(r.status, 200, r.error); assert.equal(r.letters.length, 1, 'one letter for the pair'); assert.equal(r.letters[0].unit, 'A-802 + A-803');
    });

    await step('Tally vs CRM compares the pair together, one row for both flats', async () => {
      await db.q("update receipts set status = 'approved' where instrument_no = 'UTRJODI1'");
      // Tally keeps the whole payment on one flat's ledger
      await db.q("insert into acc_receipts (book, ref_id, txn_date, bank, amount, unit_no, payment_head, payer_name, source) values ('aspire', 'T1', '2026-11-20', 'Aspire HDFC', 500000, 'A-802', 'AV', 'Test Buyer', 'Tally')");
      const s = await admin('/api/books-crm?project=' + P.id, null, 'aspire');
      assert.equal(s.status, 200, s.error);
      const pair = s.rows.find((r) => r.unit === 'A-802 + A-803');
      assert.ok(pair, JSON.stringify(s.rows.map((r) => r.unit)));
      assert.equal(pair.books, 500000); assert.equal(pair.crm, 500000); assert.equal(pair.state, 'Agrees');
      assert.ok(!s.rows.some((r) => r.unit === 'A-802'));
      const d = await admin('/api/books-crm?project=' + P.id + '&unit=' + encodeURIComponent('A-802 + A-803'), null, 'aspire');
      assert.equal(d.status, 200, d.error); assert.equal(d.books.length, 1); assert.equal(d.crm.length, 2);
      assert.equal(d.unmatched.books, 0, 'the one Tally entry matches the two CRM receipts together'); assert.equal(d.unmatched.crm, 0);
    });
    console.log(`Jodi flats: ${n} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
})();
