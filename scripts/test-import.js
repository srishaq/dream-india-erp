// Importer unit test against a slice of the real CRM sheet. node scripts/test-import.js
const assert = require('assert/strict');
const { parse, toDate, toNum } = require('../lib/import-crm');
const tabs = require('./fixtures/crm-sample');
const plan = [['On Booking', 5, false], ['On Registration', 5, false], ['On Completion of Excavation', 10, true], ['On Completion of Plinth', 10, true], ['On Completion of 5th Slab', 5, true]]
  .map(([name, pct, l], i) => ({ seq: i + 1, name, pct, construction_linked: l }));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

ok('dates and amounts in every shape the sheet uses', () => {
  for (const [v, want] of [['14-Mar-2026', '2026-03-14'], ['8-May-26', '2026-05-08'], ['10/08/2025', '2025-08-10'], ['15-July-26', '2026-07-15'], ['Wednesday, June 04, 2025', '2025-06-04'], ['24/8/2026', '2026-08-24'], [46154, '2026-05-12'], [' ', null], ['No Demand', null]]) assert.equal(toDate(v), want, String(v));
  for (const [v, want] of [['₹ 9,715,000', 9715000], ['  24,288.00 ', 24288], ['2,30,000', 230000], ['  -   ', 0], ['  -4,858.00 ', -4858], [117387.39, 117387.39]]) assert.equal(toNum(v), want, String(v));
});
const r = parse(tabs, plan, { A: 1, B: 2 }, { 'B|On Completion of Excavation': '2026-05-15' });
const bk = (u) => r.bookings.find((b) => b.unit_no === u);
const has = (u, kind) => r.issues.some((i) => i.unit === u && i.kind === kind);
ok('units and statuses', () => {
  assert.equal(r.units.length, 8);
  assert.deepEqual(Object.fromEntries(r.units.map((u) => [u.unit_no, u.status])), { 'A-1001': 'registered', 'A-1002': 'registered', 'A-1003': 'available', 'A-1006': 'held', 'A-1007': 'booked', 'A-1008': 'booked', 'A-1105': 'booked', 'B-1001': 'registered' });
});
ok('A-1001: receipts grouped by payment, split by head, matching CRM', () => {
  const b = bk('A-1001');
  assert.equal(b.agreement_value, 9715000); assert.equal(b.applicants[0].pan, 'BUPPK5565A'); assert.equal(b.applicants[0].aadhaar, '630949790029');
  assert.equal(b.applicants.length, 1); // "NA" second applicant ignored
  const mar = b.receipts.find((x) => x.received_on === '2026-03-14');
  assert.deepEqual(mar.splits, { av: 485700, gst: 24288, stamp_duty: 8375 }); assert.equal(mar.amount, 518363);
  assert.ok(!has('A-1001', 'crm-vs-ledger')); assert.ok(!has('A-1001', 'ledger-vs-bank'));
  assert.deepEqual(b.demands.map((d) => [d.stage_name, d.demand_date]), [['On Booking', '2025-08-10'], ['On Registration', '2026-05-08'], ['On Completion of Excavation', '2026-05-12']]);
  assert.equal(b.loan_bank, 'HDFC Bank'); assert.equal(b.funding, 'loan');
});
ok('A-1002: two applicants, two emails, bank shortfall flagged', () => {
  const b = bk('A-1002');
  assert.equal(b.applicants.length, 2); assert.equal(b.applicants[1].email, 'afrojshaikh100@gmail.com');
  assert.ok(has('A-1002', 'ledger-vs-bank'));
});
ok('A-1007 and A-1008 share cheques: flagged on both', () => { assert.ok(has('A-1007', 'shared-instrument')); assert.ok(has('A-1008', 'shared-instrument')); });
ok('A-1105: no email, CRM total differs from ledger', () => { assert.ok(has('A-1105', 'no-email')); assert.ok(has('A-1105', 'crm-vs-ledger')); });
ok('held unit with money in the bank is flagged', () => { assert.ok(has('A-1006', 'held-unit')); assert.ok(has('A-1006', 'money-on-unsold')); });
ok('bank tags that are not units are flagged', () => assert.ok(r.issues.some((i) => i.kind === 'bank-tag' && /SUSPENSE/.test(i.detail))));
ok('B-1001 at 30%: plinth demanded, excavation date taken from what the user gave', () => {
  const b = bk('B-1001');
  assert.deepEqual(b.demands.map((d) => d.stage_name), ['On Booking', 'On Registration', 'On Completion of Excavation', 'On Completion of Plinth']);
  assert.equal(b.demands[2].demand_date, '2026-05-15'); assert.equal(b.demands[3].demand_date, '2026-05-25');
  assert.equal(b.brokerage, 117387.39); assert.equal(b.loan_bank, 'LIC Finance');
});
ok('suggested stage dates per wing', () => {
  assert.equal(r.stageDates['A|On Completion of Excavation'], '2026-07-21'); // most common Demand Date at 20% in this slice; the user confirms it on screen
  assert.equal(r.stageDates['B|On Completion of Plinth'], '2026-05-25');
  assert.equal(r.stageDates['B|On Completion of Excavation'], '2026-05-15');
  assert.ok(!('A|On Completion of Plinth' in r.stageDates)); // A wing has not reached plinth
});
ok('summary totals', () => { assert.equal(r.summary.bookings, 6); assert.ok(r.summary.receivedAv > 0); console.log('    ', JSON.stringify(r.summary.issuesByKind)); });
console.log(`\nAll ${n} importer checks passed.`);
