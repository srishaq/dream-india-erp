// Grids with the Master Accounts sheet's own headings, rebuilt from the ERP's tables. The portal's page models
// (CA page, Accounts page) read these exactly as they read the sheet's tabs.
const db = require('./db');

const BOOK = 'signature';
const D = (v) => (v ? new Date(String(v instanceof Date ? v.toISOString() : v).slice(0, 10) + 'T00:00:00Z') : null);
const N = (v) => (v == null || v === '' ? null : Number(v));

async function receipts() {
  const rec = await db.q('select * from acc_receipts where book = $1 order by txn_date nulls last, id', [BOOK]);
  return [['Receipt ID', 'Date', 'Bank Account', 'Description', 'Reference', 'Amount', 'Cash Flow Head', 'Payment Head', 'Unit', 'Payer Name', 'Payer Type', 'Cheque Status', 'Remark'],
    ...rec.map((r) => [r.ref_id || `#${r.id}`, D(r.txn_date), r.bank, r.description, r.reference, N(r.amount), r.head, r.payment_head, r.unit_no, r.payer_name, r.payer_type, r.cheque_status, r.remark])];
}
async function payments(rows) {
  const pay = rows || await db.q('select * from acc_payments where book = $1 order by txn_date nulls last, id', [BOOK]);
  return [['Payment ID', 'Date', 'Bank Account', 'Description', 'Reference', 'Amount', 'Cash Flow Head', 'Unit', 'Remark', 'Payee'],
    ...pay.map((p) => [p.ref_id || `#${p.id}`, D(p.txn_date), p.bank, p.description, p.reference, N(p.amount), p.head, p.unit_no, p.remark, p.payee])];
}

// TDS Tracker: per flat on the left (Unit, Applicant, Status, AV, TDS Due, TDS Paid, Balance, -, Entries, Last paid, State),
// one row per challan / Form 16B from "Entry ID" on the right, as on the sheet.
async function tdsTracker() {
  const S = Object.fromEntries((await db.q("select key, value from acc_settings where book = $1 and key = 'ca_customer_tds_rate'", [BOOK])).map((r) => [r.key, r.value]));
  const rate = N(S.ca_customer_tds_rate) ?? 0.01;
  const bk = await db.q(`select u.unit_no, b.agreement_value, b.crm_status,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as applicant
    from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id
    where p.code = 'SIGNATURE' and b.status in ('pending', 'active') and not b.sample order by u.unit_no`);
  const tds = await db.q('select * from acc_tds_entries where book = $1 order by paid_on nulls last, id', [BOOK]);
  const by = {};
  for (const e of tds) { const x = (by[e.unit_no] ||= { paid: 0, k: 0, last: null }); x.paid += N(e.tds_amount) || 0; x.k++; if (e.paid_on && (!x.last || String(e.paid_on) > String(x.last))) x.last = e.paid_on; }
  const flats = bk.map((b) => {
    const av = N(b.agreement_value) || 0, due = Math.round(av * rate), x = by[b.unit_no] || { paid: 0, k: 0, last: null }, paid = Math.round(x.paid);
    return [b.unit_no, b.applicant, b.crm_status, av, due, paid, due - paid, null, x.k, D(x.last), !paid ? 'Not paid' : paid >= due - 10 ? 'Fully paid' : 'Part paid'];
  });
  const entries = tds.map((e) => [e.ref_id || `#${e.id}`, D(e.paid_on), e.unit_no, e.customer, e.demand, N(e.demand_amount), N(e.tds_amount), e.challan_no, e.paid_from, e.form16b, e.source, e.remark, e.cert_link]);
  const head = ['Unit', 'Applicant', 'Status', 'Agreement Value', 'TDS Due (1% of AV)', 'TDS Paid', 'Balance', '', 'Entries', 'Last paid', 'State', '',
    'Entry ID', 'TDS Paid On', 'Unit', 'Customer', 'Demand / Instalment', 'Demand Amount', 'TDS Amount', 'Challan / Acknowledgement No.', 'Paid From (Bank)', 'Form 16B Received?', 'Source', 'Remark', 'Form 16B Certificate (link)'];
  const out = [head];
  for (let i = 0; i < Math.max(flats.length, entries.length); i++) out.push([...(flats[i] || Array(11).fill(null)), null, ...(entries[i] || [])]);
  return out;
}

module.exports = { D, N, receipts, payments, tdsTracker };
