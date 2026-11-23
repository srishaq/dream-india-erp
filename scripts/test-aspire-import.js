// Dream Aspire CRM workbook import, end to end, on synthetic data (scripts/fixtures/aspire-sample.js).
// DATABASE_URL=postgres://... node scripts/test-aspire-import.js
require('./login-code-helper');
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3996';
process.env.IMPORT_ASPIRE_FIXTURE = process.env.IMPORT_ASPIRE_FIXTURE || path.join(__dirname, 'fixtures/aspire-sample.js');
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
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  // the live ERP has Dream Aspire with building A and its unsold flats (migration 072); set the same up here
  if (!(await db.one("select id from projects where code = 'ASPIRE'"))) {
    await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE'");
    const m = require('../lib/migrations').find((x) => x.id === '072_aspire_inventory');
    for (const st of m.sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await db.q(st);
  }
  const asp = (await admin('/api/masters')).projects.find((p) => p.code === 'ASPIRE');
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const real = !/aspire-sample/.test(process.env.IMPORT_ASPIRE_FIXTURE);
  let pv;
  await step('preview reads the workbook and saves nothing', async () => {
    pv = await admin('/api/import', { action: 'aspire-preview', projectId: asp.id });
    assert.equal(pv.status, 200, pv.error);
    console.log('   ', JSON.stringify(pv.summary));
    if (!real) {
      assert.equal(pv.summary.bookings, 4); assert.equal(pv.summary.asOf, '2026-11-17');
      assert.equal(pv.summary.refuge, 1); assert.equal(pv.summary.available >= 1, true);
      assert.ok(pv.issues.some((i) => i.kind === 'other-amount' && i.unit === 'A-202'));
      assert.ok(pv.issues.some((i) => i.kind === 'no-agreement-value' && i.unit === 'A-302'));
      assert.deepEqual(pv.plans.filter((p) => p.offered).map((p) => p.name), ['Construction-linked (CLP)']);
    }
    const b = await db.one("select count(*)::int as n from bookings b join units u on u.id = b.unit_id where u.project_id = $1", [asp.id]);
    assert.equal(b.n, 0);
  });
  await step('only for Dream Aspire', async () => {
    const r = await admin('/api/import', { action: 'aspire-preview', projectId: sig.id });
    assert.equal(r.status, 400);
  });
  let out;
  await step('import: units by owner, bookings, demands, opening receipts', async () => {
    out = await admin('/api/import', { action: 'aspire-commit', projectId: asp.id });
    assert.equal(out.status, 200, out.error);
    console.log('   ', JSON.stringify(out));
    const u = Object.fromEntries((await db.q('select unit_no, status, hold_note, category from units where project_id = $1', [asp.id])).map((x) => [x.unit_no, x]));
    const dup = await db.one("select count(*)::int as n from (select unit_no from units where project_id = $1 group by 1 having count(*) > 1) x", [asp.id]);
    assert.equal(dup.n, 0);
    if (!real) {
      assert.equal(u['A-201'].status, 'registered'); assert.equal(u['A-203'].status, 'booked');
      assert.equal(u['A-204'].status, 'held'); assert.match(u['A-204'].hold_note, /Contractor's flat: sold to Test Contractor Buyer/);
      assert.equal(u['A-206'].status, 'refuge'); assert.equal(u['A-205'].status, 'available');
      assert.equal(u['A-SHOP 1'].category, 'commercial'); assert.equal(u['A-SHOP 1'].status, 'held');
      assert.equal(u['A-302'].status, 'held');
      // A-201: CLP from Jun 2024, all stages up to sanitary demanded; AV 1 Cr incl parking
      const b = await db.one("select b.id, b.agreement_value, b.parking from bookings b join units u on u.id = b.unit_id where u.unit_no = 'A-201' and u.project_id = $1", [asp.id]);
      assert.equal(Number(b.agreement_value), 10000000); assert.equal(b.parking, 1);
      const d = await db.q('select stage_name, pct, demand_date::text as d from demands where booking_id = $1 order by demand_date, id', [b.id]);
      assert.equal(d.length, 13); assert.equal(d.reduce((a, x) => a + Number(x.pct), 0), 79);
      const two = await db.q('select a.seq, y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by seq', [b.id]);
      assert.deepEqual(two.map((x) => x.name), ['Test Buyer One', 'Test Buyer Two']);
      const r = await db.q("select r.mode, r.amount, r.opening, (select json_object_agg(head, amount) from receipt_splits s where s.receipt_id = r.id) as sp from receipts r where booking_id = $1 order by mode", [b.id]);
      assert.equal(r.length, 2); assert.ok(r.every((x) => x.opening));
      assert.equal(Number(r[0].sp.av), 6500000); assert.equal(Number(r[0].sp.gst), 325000);
      assert.equal(Number(r[1].sp.tds), Math.round(100000 * 6500000 / 9900000 * 100) / 100);
      // A-203: special plan, unregistered, booked Jan 2026 → booking 30% and sanitary 35% (Sep 2026)
      const s = await db.q("select d.stage_name, d.pct from demands d join bookings b on b.id = d.booking_id join units u on u.id = b.unit_id where u.unit_no = 'A-203' and u.project_id = $1 order by d.demand_date", [asp.id]);
      assert.deepEqual(s.map((x) => Number(x.pct)), [30, 35]);
      const plans = await db.q('select name, active from payment_plans where project_id = $1 order by id', [asp.id]);
      assert.ok(plans.find((p) => p.name === 'Construction-linked (CLP)').active);
      assert.ok(plans.find((p) => /Special plan for A-203/.test(p.name)).active === false);
    }
    const sc = await db.q("select stage_name from stage_completions sc join buildings b on b.id = sc.building_id where b.project_id = $1", [asp.id]);
    assert.equal(sc.length, 11);
  });
  await step('the ledger shows the flats with what is due', async () => {
    const l = await admin(`/api/ledger?project=${asp.id}`);
    assert.equal(l.status, 200, l.error);
    assert.equal(l.rows.length, out.bookings);
    if (!real) {
      const r = l.rows.find((x) => x.unit_no === 'A-201');
      console.log('    A-201 ledger:', JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => /due|out|demand|recei|paid|bal/i.test(k)))));
    } else {
      const tot = l.rows.reduce((a, x) => a + Number(x.outstanding || 0), 0);
      console.log('    total outstanding in the ERP ledger:', Math.round(tot));
    }
  });
  await step("contractor's flats: bookings at the flat rate, no demands, no messages, their own list", async () => {
    const r = await admin('/api/import', { action: 'aspire-contractor', projectId: asp.id, rate: 22800 });
    assert.equal(r.status, 200, r.error);
    console.log('   ', JSON.stringify(r));
    if (!real) {
      assert.equal(r.flats, 1); assert.equal(r.total, 459 * 22800); assert.equal(r.resold, 1);
      const b = await db.one("select b.id, b.sale_type, b.agreement_value, (select count(*)::int from demands d where d.booking_id = b.id) as d, u.status from bookings b join units u on u.id = b.unit_id where u.unit_no = 'A-204' and u.project_id = $1", [asp.id]);
      assert.equal(b.sale_type, 'contractor'); assert.equal(b.d, 0); assert.equal(b.status, 'registered');
      // a bill adjustment entered as a receipt sends nothing to the buyer
      const rm = require('../lib/receipt-mail');
      const rc = await db.one("insert into receipts (project_id, booking_id, received_on, amount, mode, status, approved_at, note) values ($1, $2, '2026-11-20', 500000, 'other', 'approved', now(), 'Adjusted against RA bill 12') returning id", [asp.id, b.id]);
      await db.q("insert into receipt_splits (receipt_id, head, amount) values ($1, 'av', 500000)", [rc.id]);
      assert.deepEqual(await rm.autoSend(rc.id, 'final'), { skipped: "contractor's flat" });
      const l = await admin(`/api/bookings?project=${asp.id}`);
      const row = l.rows.find((x) => x.unit_no === 'A-204');
      assert.equal(row.sale_type, 'contractor'); assert.equal(Number(row.credit_av), 500000); assert.equal(Number(row.overdue || 0), 0);
    }
    const again = await admin('/api/import', { action: 'aspire-contractor', projectId: asp.id, rate: 22800 });
    assert.equal(again.status, 409);
  });
  await step('a second run is refused', async () => {
    const r = await admin('/api/import', { action: 'aspire-commit', projectId: asp.id });
    assert.equal(r.status, 409);
  });
  await step("buyers' contact details from the CRM's collection report: filled where empty, a missing co-buyer added, a different name only listed", async () => {
    if (real) return;
    const H = ['SR.NO.', 'FLAT NO.', 'OWNED BY', 'SQ.FT', 'PARTICULARS', ...Array(24).fill(null), 'CONTACT NUMBER', 'EMAIL ID', 'ADDRESS for 1 st applicant ', 'ADDRESS for 2nd  applicant ', 'ADDRESS for 3rd   applicant ', '1st applicant  Pan card', '2nd applicant pan card ', '3nd applicant pan card '];
    const row = (no, names, ph, em, a1, a2, p1, p2) => [1, no, 'DIB', 459, names, ...Array(24).fill(null), ph, em, a1, a2, null, p1, p2, null];
    const rows = [[], [], H,
      row(201, 'Test Buyer One/Test Buyer Two', '98200 11111', 'one@example.com;two@example.com', 'Flat 1, Test Road', 'Same as above', 'ABCDE1234F', 'ABCDE1234G'),
      row(202, 'Test Buyer Three Fullname/Test Co Buyer', '+44 7700 900123', 'three@example.com', 'Flat 2, Test Road', 'Flat 3, Test Road', 'XYZAB1234C', 'bad'),
      row(203, 'Someone Else', '9000000000', null, 'Flat 4', null, null, null),
      row(305, 'Assigned to Adani', null, null, null, null, null, null)];
    const fileB64 = require('../lib/xlsx-write').write([{ name: 'DATA', rows }]).toString('base64');
    const pv = await admin('/api/import', { action: 'aspire-contacts-preview', projectId: asp.id, fileB64 });
    assert.equal(pv.status, 200, pv.error);
    assert.deepEqual(pv.added, [{ unit: 'A-202', name: 'Test Co Buyer' }]);
    assert.ok(pv.differ.some((d) => d.unit === 'A-203' && d.what === 'name'));
    assert.ok(pv.issues.some((i) => i.unit === 'A-202' && i.kind === 'pan'));
    const r = await admin('/api/import', { action: 'aspire-contacts-commit', projectId: asp.id, fileB64 });
    assert.equal(r.ok, true, r.error);
    const who = async (u) => db.q('select a.seq, y.name, y.phone, y.email, y.address, y.pan from booking_applicants a join buyers y on y.id = a.buyer_id join bookings b on b.id = a.booking_id join units u on u.id = b.unit_id where u.unit_no = $1 and u.project_id = $2 order by a.seq', [u, asp.id]);
    const a = await who('A-201');
    assert.deepEqual(a.map((x) => [x.phone, x.email, x.pan]), [['9820011111', 'one@example.com', 'ABCDE1234F'], [null, 'two@example.com', 'ABCDE1234G']]);
    assert.equal(a[1].address, 'Flat 1, Test Road');
    const b = await who('A-202');
    assert.equal(b[0].name, 'Test Buyer Three Fullname'); assert.equal(b[0].phone, '+447700900123');
    assert.equal(b[1].name, 'Test Co Buyer'); assert.equal(b[1].address, 'Flat 3, Test Road'); assert.equal(b[1].pan, null);
    const c = await who('A-203');
    assert.equal(c[0].name, 'Test Buyer Four'); assert.equal(c[0].address, null); // a different person: only the flat's number
    assert.equal(c[0].phone, '9000000000');
  });
  console.log(`${n} passed`);
  server.close?.(); await db.end?.(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
