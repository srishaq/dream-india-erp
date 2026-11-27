// Compliance Calendar → "Add this year's due dates": the standard GST, TDS, income tax and RERA due dates for a
// financial year (April to March), so a new company does not have to type them. Only dates from today on are added,
// and a return already in the calendar for the same period is left alone. The RERA dates follow the company's state
// is MahaRERA's; each RERA row says to check the exact day. From Zuri, 27 Nov 2026. Each set of books (Signature, Aspire) has its own calendar.
const db = require('./db');
const books_ = require('./book');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m is 1-12
const next = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

// every due date of the year fy (fy 2026 = April 2026 to March 2027)
function list(fy) {
  const rera = 'MahaRERA';
  const out = [];
  const add = (compliance, law, period, due, responsible, remark = '') => out.push({ compliance, law, period, due_date: due, responsible, remark });
  for (let i = 0; i < 12; i++) {
    const m = ((i + 3) % 12) + 1, y = i < 9 ? fy : fy + 1, per = `${MON[m - 1]}-${y}`, [ny, nm] = next(y, m);
    add('TDS deposit (deducted by us)', 'Income Tax', per, m === 3 ? ymd(ny, 4, 30) : ymd(ny, nm, 7), 'Accounts', 'Challan 281 for the TDS deducted on payments this month.');
    add('GSTR-1 (sales and demands)', 'GST', per, ymd(ny, nm, 11), 'Accounts', 'Monthly filers. The GST by month report has the figures.');
    add('GSTR-3B and GST payment', 'GST', per, ymd(ny, nm, 20), 'Accounts', 'Monthly filers. The GST by month report has the figures.');
  }
  const Q = [['Q1 Apr-Jun', fy, 6, ymd(fy, 7, 31)], ['Q2 Jul-Sep', fy, 9, ymd(fy, 10, 31)], ['Q3 Oct-Dec', fy, 12, ymd(fy + 1, 1, 31)], ['Q4 Jan-Mar', fy + 1, 3, ymd(fy + 1, 5, 31)]];
  for (const [q, y, endM, tdsDue] of Q) {
    const per = `${q} ${y}`, [ry, rm] = next(y, endM);
    add('TDS return (26Q, and 24Q for salaries)', 'Income Tax', per, tdsDue, 'Accounts / CA');
    add('RERA quarterly progress update', `RERA (${rera})`, per, ymd(ry, rm, 15), 'Accounts / Projects', `Flats booked, money received and withdrawn, and construction progress, on the ${rera} website. Check the exact day MahaRERA sets.`);
  }
  for (const [d, pct] of [[ymd(fy, 6, 15), '15%'], [ymd(fy, 9, 15), '45%'], [ymd(fy, 12, 15), '75%'], [ymd(fy + 1, 3, 15), '100%']]) {
    add('Advance tax', 'Income Tax', `FY ${fy}-${String(fy + 1).slice(2)} (${pct})`, d, 'CA', `Pay up to ${pct} of the year's estimated tax.`);
  }
  const fyl = `FY ${fy}-${String(fy + 1).slice(2)}`;
  add('Tax audit report (Form 3CD)', 'Income Tax', fyl, ymd(fy + 1, 9, 30), 'CA');
  add('RERA annual audited accounts (Form 5)', `RERA (${rera})`, fyl, ymd(fy + 1, 9, 30), 'CA', 'Audited statement of the RERA account for each project. Check the exact day MahaRERA sets.');
  add('Income tax return', 'Income Tax', fyl, ymd(fy + 1, 10, 31), 'CA', 'For companies whose accounts are audited.');
  add('GST annual return (GSTR-9)', 'GST', fyl, ymd(fy + 1, 12, 31), 'CA');
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// adds the year's dates from `from` (today) on; returns how many were added and how many were already there
async function fill(t, u, fy, from) {
  const book = books_.cur();
  const have = new Set((await t.q("select lower(compliance) || '|' || lower(coalesce(period, '')) as k from acc_compliance where book = $1", [book])).map((r) => r.k));
  let added = 0, there = 0;
  for (const r of list(fy)) {
    if (r.due_date < from) continue;
    if (have.has(r.compliance.toLowerCase() + '|' + r.period.toLowerCase())) { there++; continue; }
    await t.q("insert into acc_compliance (book, compliance, law, period, due_date, status, responsible, remark, created_by) values ($8, $1, $2, $3, $4, 'Pending', $5, $6, $7)",
      [r.compliance, r.law, r.period, r.due_date, r.responsible, r.remark || null, u.id, book]);
    added++;
  }
  return { added, there };
}

module.exports = { list, fill };
