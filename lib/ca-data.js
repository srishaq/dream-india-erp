// The CA page reads the same model as the live portal's CA page (lib/ca-model.js, unchanged), but fed from the ERP:
// each "tab" the model expects is rebuilt as a grid with the sheet's own headings from the ERP's tables.
const db = require('./db');
const { buildCaModel } = require('./ca-model');

const BOOK = 'signature';
const D = (v) => (v ? new Date(String(v instanceof Date ? v.toISOString() : v).slice(0, 10) + 'T00:00:00Z') : null);
const N = (v) => (v == null || v === '' ? null : Number(v));

async function tabs() {
  const S = Object.fromEntries((await db.q("select key, value from acc_settings where book = $1 and key like 'ca\\_%'", [BOOK])).map((r) => [r.key, r.value]));
  const heads = await db.q('select * from acc_heads where book = $1 and active is not false order by side, name', [BOOK]);
  const caSettings = [
    ['GST rate on customer consideration', N(S.ca_gst_rate) ?? 0.05],
    ['Customer TDS rate', N(S.ca_customer_tds_rate) ?? 0.01],
    ['RERA collection account', S.ca_rera_account || 'Yes RERA Collection 100% (0700)'],
    ['RERA collection account opened on', D(S.ca_rera_opened || '2026-01-22')],
    ['Customer refund head', S.ca_refund_head || 'Flat - Cancelled Refunded'],
    [],
    ['Side', 'Cash Flow Head', 'Cash Flow Section', 'Indirect Method Line', 'TDS Section', 'TDS Rate', 'Non-Revenue Category', 'Note'],
    ...heads.map((h) => [h.side === 'receipt' ? 'Receipt' : 'Payment', h.name, h.section || '', h.indirect_line || '', h.tds_section || '', N(h.tds_rate), h.category || '', h.note || '']),
  ];

  const rec = await db.q('select * from acc_receipts where book = $1 order by txn_date nulls last, id', [BOOK]);
  const receipts = [['Receipt ID', 'Date', 'Bank Account', 'Description', 'Reference', 'Amount', 'Cash Flow Head', 'Payment Head', 'Unit', 'Payer Name', 'Payer Type', 'Cheque Status', 'Remark'],
    ...rec.map((r) => [r.ref_id || `#${r.id}`, D(r.txn_date), r.bank, r.description, r.reference, N(r.amount), r.head, r.payment_head, r.unit_no, r.payer_name, r.payer_type, r.cheque_status, r.remark])];

  const pay = await db.q('select * from acc_payments where book = $1 order by txn_date nulls last, id', [BOOK]);
  const payments = [['Payment ID', 'Date', 'Bank Account', 'Description', 'Reference', 'Amount', 'Cash Flow Head', 'Unit', 'Remark'],
    ...pay.map((p) => [p.ref_id || `#${p.id}`, D(p.txn_date), p.bank, p.description, p.reference, N(p.amount), p.head, p.unit_no, p.remark])];

  const bk = await db.q(`select u.unit_no, bl.code as wing, u.typology, u.carpet_sqft, b.crm_status, b.agreement_value, b.booking_date, b.registration_date, b.registration_status,
      (select by.name from booking_applicants ba join buyers by on by.id = ba.buyer_id where ba.booking_id = b.id order by ba.seq limit 1) as applicant
    from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id
    where p.code = 'SIGNATURE' and b.status in ('pending', 'active') and not b.sample order by u.unit_no`);
  const bookings = [['Unit', 'Wing', 'Typology', 'Carpet (sq.ft)', 'CRM Status', 'Applicant 1', 'Agreement Value', 'Allotment Date', 'Registration Date', 'Registration Status'],
    ...bk.map((b) => [b.unit_no, b.wing, b.typology, N(b.carpet_sqft), b.crm_status, b.applicant, N(b.agreement_value), D(b.booking_date), D(b.registration_date), b.registration_status])];

  // TDS Tracker: the per-unit summary (Unit … TDS Due in column E, TDS Paid in F) and, on the same rows, the entries block from "Entry ID".
  const rate = N(S.ca_customer_tds_rate) ?? 0.01;
  const tds = await db.q('select * from acc_tds_entries where book = $1 order by paid_on nulls last, id', [BOOK]);
  const paidBy = {}; for (const e of tds) paidBy[e.unit_no] = (paidBy[e.unit_no] || 0) + (N(e.tds_amount) || 0);
  const summary = bk.map((b) => [b.unit_no, b.applicant, N(b.agreement_value), null, Math.round((N(b.agreement_value) || 0) * rate), Math.round(paidBy[b.unit_no] || 0), null]);
  const entries = tds.map((e) => [e.ref_id || `#${e.id}`, D(e.paid_on), e.unit_no, e.customer, e.demand, N(e.demand_amount), N(e.tds_amount), e.challan_no, e.paid_from, e.form16b, e.source, e.remark, e.cert_link]);
  const tracker = [['Unit', 'Applicant', 'Agreement Value', '', 'TDS Due (1% of AV)', 'TDS Paid', '', 'Entry ID', 'TDS Paid On', 'Unit', 'Customer', 'Demand / Instalment', 'Demand Amount', 'TDS Amount', 'Challan / Acknowledgement No.', 'Paid From (Bank)', 'Form 16B Received?', 'Source', 'Remark', 'Form 16B Certificate (link)']];
  for (let i = 0; i < Math.max(summary.length, entries.length); i++) tracker.push([...(summary[i] || [null, null, null, null, null, null, null]), ...(entries[i] || [])]);

  // Vendor Bills: in the ERP the bill is kept on its payment (the bill columns of Payments Out).
  const bills = pay.filter((p) => p.bill_no || p.bill_date || N(p.total_bill) || N(p.taxable_value));
  const vendor = [['Bill ID', 'Bill Date', 'Vendor Name', 'Vendor PAN', 'Cash Flow Head', 'TDS Section', 'Bill No.', 'Taxable Value', 'GST on Bill', 'Total Bill', 'TDS Rate', 'TDS Deducted', 'Paid Amount', 'Payment ID(s)', 'TDS Challan No.', 'TDS Deposited On', 'Remark'],
    ...bills.map((p) => [p.bill_ids || p.ref_id, D(p.bill_date || p.txn_date), p.payee, p.vendor_pan, p.head, p.tds_section, p.bill_no, N(p.taxable_value), N(p.gst_on_bill), N(p.total_bill), N(p.tds_rate), N(p.tds_deducted), N(p.amount), p.ref_id, p.tds_challan, D(p.tds_deposited_on), p.bill_note])];

  const cc = await db.q('select * from acc_compliance where book = $1 order by due_date nulls last, id', [BOOK]);
  const compliance = [['Compliance', 'Law', 'Period', 'Due Date', 'Status', 'Date Complied', 'Acknowledgement / Challan No.', 'Responsible', 'Remark'],
    ...cc.map((c) => [c.compliance, c.law, c.period, D(c.due_date), c.status, D(c.date_complied), c.ack, c.responsible, c.remark])];

  return { 'Receipts': receipts, 'Payments Out': payments, 'Bookings': bookings, 'TDS Tracker': tracker, 'CA Settings': caSettings, 'Vendor Bills': vendor, 'Compliance Calendar': compliance };
}

async function model() {
  const t = await tabs();
  const m = buildCaModel(t, new Date(Date.now() + 5.5 * 3600000));
  // The ERP keeps these in its own tables, so the "tab missing" warnings never apply.
  m.summary.tabs = { settings: true, vb: true, cc: true };
  return m;
}

module.exports = { tabs, model };
