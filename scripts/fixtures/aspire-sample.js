// Synthetic slice of the Dream Aspire CRM workbook (made-up names and amounts), for scripts/test-aspire-import.js.
const blank = (n) => Array(n).fill(null);
// stage amounts (less TDS) in the sheet's 16 columns
const CLP = [10, 15, 15, 3, 3, 3, 3, 3, 3, 3, 3, 5, 10, 5, 11, 5];
function row(sr, flat, name, date, plan, av, parking, pcts, received) {
  const total = av + parking, tds = Math.round(total / 100), avx = total - tds;
  const stages = pcts.map((p) => Math.round(avx * p) / 100);
  const recv = blank(16); recv[0] = received;
  return [sr, flat, 'DIB', 459, name, date, plan, av, parking, total, avx, tds, received, received / avx, avx - received, ...stages, avx, ...recv, received, ...blank(17)];
}
module.exports = [
  { name: 'Overall Net Receivables slabwis', rows: [
    blank(66),
    ['SR.NO.', 'FLAT NO.', 'OWNED BY', 'SQ.FT', 'PARTICULARS', 'DATE OF BOOKING', 'PAYMENT PLAN', 'AGREEMENT VALUE', 'PARKING', 'TOTAL AV', 'AGREEMENT VALUE (EXCL TDS)', 'TDS RECEIVABLE', 'RECEIVED', '%', 'BALANCE'],
    row(1, 201, 'Test Buyer One / Test Buyer Two', '2024-06-01', 'CLP', 9000000, 1000000, CLP, 6500000),
    row(2, 202, 'Test Buyer Three', '2025-11-20', 'CLP', 10000000, 0, CLP, 7000000),
    row(3, 203, 'Test Buyer Four', '2026-01-10', 'Special Plan', 12000000, 0, [30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 35, 0, 0, 35], 4000000),
    row(4, 301, 'Test Buyer Five', '2026-02-01', 'CLP', 9500000, 0, CLP, 1000000),
    [5, 302, 'DIB', 459, 'Assigned to Someone', '2024-03-01', null, null, null, 0, 0, 0, 0, null, 0],
    [null, null, null, null, null, null, null, 1, 1, 1, 1, 1, 1, 1, 1],
    [...blank(11), 'OTHER', 'AMOUNT'], [...blank(11), 202, 150000], [...blank(11), 'TOTAL', 150000],
  ] },
  { name: 'Slabwise Expectation', rows: [] },
  { name: 'Payment Plan', rows: [] },
  { name: 'Ragistration Status ', rows: [
    ['SR.NO.', 'Flat No ', 'Carpet Area ', 'REMARK', 'UNIT STATUS', 'PARTICULARS', 'Unit Sub Registration Date'],
    [1, 201, 459, 'DIB', 'Sold', 'Test Buyer One', '2024-07-01'],
    [2, 202, 459, 'DIB', 'Sold', 'Test Buyer Three', '2025-12-10'],
    [3, 203, 713, 'DIB', 'Sold', 'Test Buyer Four', 'Unregistered'],
    [4, 204, 459, 'Contractor', 'Sold', 'Test Contractor Buyer', '2025-08-28'],
    [5, 205, 459, 'DIB', 'Unsold', null, null],
    [6, 206, 459, 'Refuge', 'Refuge', null, null],
    [7, 301, 459, 'DIB', 'Sold', 'Test Buyer Five', '2026-02-20'],
    [8, 302, 459, 'DIB', 'Sold', 'Assigned to Someone', '2024-04-01'],
    ['SR.NO.', 'Flat No ', 'Carpet Area ', 'REMARK'],
    [1, 1, 455, ' Ground Commercial', 'Sold', 'Test Shop Buyer', '2024-11-27'],
  ] },
];
