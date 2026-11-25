// Dream Aspire's TDS working and challan summary onto the payments (lib/tds-working.js). No database: the payments
// are given to plan() directly.   node scripts/test-tds-working.js
const assert = require('assert/strict');
const T = require('../lib/tds-working');
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

const pays = [
  { id: 1, ref_id: 'PO-1', date: '2023-10-18', payee: 'Anarock Property Consultants', amount: 196000 },          // 200000 less 2% TDS
  { id: 2, ref_id: 'PO-2', date: '2023-10-20', payee: 'Aspect Property Consultants', amount: 617500 },           // 650000 less 5%
  { id: 3, ref_id: 'PO-3', date: '2024-01-05', payee: 'Aspect Property Consultants', amount: 12000 },            // no TDS row: gets the PAN only
  { id: 4, ref_id: 'PO-4', date: '2025-05-10', payee: 'Rudra Security', amount: 99000, vendor_pan: 'XXXXX1111X' }, // PAN already there: kept
  { id: 5, ref_id: 'PO-5', date: '2025-06-02', payee: 'Someone Else', amount: 50000 },
];
const work = [
  { party: 'Anarock Property Consultants', key: 'anarockpropertyconsultants', pan: 'AACCJ6158P', date: '2023-10-17', sec: '194C', amt: 200000, rate: 0.02, tds: 4000 },
  { party: 'Aspect Property Consultants', key: 'aspectpropertyconsultants', pan: 'ACDFA2885Q', date: '2023-10-17', sec: '194H', amt: 650000, rate: 0.05, tds: 32500 },
  { party: 'Rudra Security', key: 'rudrasecurity', pan: 'AJPPB5133R', date: '2025-05-09', sec: '194C', amt: 100000, rate: 0.01, tds: 1000 },
  { party: 'Not Paid Yet Ltd', key: 'notpaidyetltd', pan: 'ABCDE1234F', date: '2025-06-01', sec: '194J', amt: 10000, rate: 0.1, tds: 1000 },
];
const chal = [
  { date: '2024-07-22', fy: '2023-24', no: '34214', amount: 36500, interest: 2700, late: 0, total: 39200 },  // 2023-24's TDS, paid late
  { date: '2025-06-07', fy: '2025-26', no: '11111', amount: 500, interest: 0, late: 0, total: 500 },       // only part of 2025-26's
];
const q = async () => pays.map((p) => ({ ...p }));

(async () => {
  const p = await T.plan(q, { work, chal });
  const f = (id) => (p.fills.find((x) => x.id === id) || { set: {} }).set;
  await step('Each TDS row goes onto the payment that paid it (amount less TDS, near the date)', async () => {
    assert.equal(f(1).tds_deducted, 4000); assert.equal(f(1).vendor_pan, 'AACCJ6158P'); assert.equal(f(1).tds_section, '194C');
    assert.equal(f(2).tds_deducted, 32500); assert.equal(f(2).tds_rate, 0.05);
    assert.equal(p.unmatched.length, 1); assert.equal(p.unmatched[0].party, 'Not Paid Yet Ltd');
  });
  await step('The party\'s PAN goes on its other payments; a PAN already there is not changed', async () => {
    assert.equal(f(3).vendor_pan, 'ACDFA2885Q'); assert.equal(f(3).tds_deducted, undefined);
    assert.equal(f(4).vendor_pan, undefined, 'kept'); assert.equal(f(4).tds_deducted, 1000);
    assert.deepEqual(f(5), {});
  });
  await step('Challans go on the TDS of their own year; late and missing deposits are counted', async () => {
    assert.equal(f(1).tds_challan, '34214'); assert.equal(f(1).tds_deposited_on, '2024-07-22');
    assert.equal(f(2).tds_challan, '34214');
    assert.equal(f(4).tds_challan, '11111');
    assert.equal(p.lateDeposits, 2, '2023-24 paid in July 2024');
    const s = Object.fromEntries(p.summary.map((y) => [y.fy, y]));
    assert.equal(s['2023-24'].gap, 0); assert.equal(s['2023-24'].interest, 2700);
    assert.equal(s['2025-26'].gap, 1500, '2025-26: 2000 deducted, 500 deposited');
  });
  console.log(`\n${n} checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
