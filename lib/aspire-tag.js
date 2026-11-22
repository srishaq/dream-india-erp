// Dream Aspire's books: the bank credits that are buyers' payments get their flat, from the CRM's payments (the
// "transaction details" sheet, each with its transaction ID). A credit is a buyer's payment when
//   1. its narration or reference holds the payment's transaction ID (6+ characters) and the amount is the same, or
//   2. the amount is the same, it is within 3 days of the payment, and no other payment fits.
// The credit gets the flat, the buyer, "Receipts From Customers" and AV / GST / TDS from the payment; the CRM payment
// is linked to the bank line (bank_acc_id), as the cheque matcher does for Signature. Credits already given a head are
// left alone. Run after Aspire's statements come in.
const audit = require('./audit');
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const days = (a, b) => Math.abs(Date.parse(iso(a)) - Date.parse(iso(b))) / 864e5;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cents = (v) => Math.round((Number(v) || 0) * 100);
const HEAD = { av: 'AV', gst: 'GST', tds: 'TDS' };

async function run(t, { user = null, apply = true } = {}) {
  const P = await t.one("select id from projects where code = 'ASPIRE'");
  if (!P) return { skipped: 'No Dream Aspire project.' };
  const crm = await t.q(`select r.id, r.received_on, r.amount, r.instrument_no, r.bank_acc_id, u.unit_no,
      (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = k.id) as buyer,
      (select s.head from receipt_splits s where s.receipt_id = r.id order by s.amount desc limit 1) as head
    from receipts r join bookings k on k.id = r.booking_id join units u on u.id = k.unit_id
    where r.project_id = $1 and r.status = 'approved' and coalesce(r.mode, '') <> 'tds' and r.bank_acc_id is null`, [P.id]);
  const lines = await t.q(`select id, ref_id, txn_date, amount, description, reference from acc_receipts
    where book = 'aspire' and head is null and coalesce(cheque_status, '') !~* 'bounce|return' order by txn_date, id`);
  const byAmt = new Map();
  for (const c of crm) { const k = cents(c.amount); (byAmt.get(k) || byAmt.set(k, []).get(k)).push(c); }
  const used = new Set(); const done = [];
  // pass 1: the transaction ID is on the bank line
  for (const l of lines) {
    const text = norm(l.description) + ' ' + norm(l.reference);
    const c = (byAmt.get(cents(l.amount)) || []).find((x) => !used.has(x.id) && norm(x.instrument_no).replace(/^0+/, '').length >= 6 && text.includes(norm(x.instrument_no).replace(/^0+/, '')) && days(x.received_on, l.txn_date) <= 45);
    if (c) { used.add(c.id); done.push({ l, c, how: 'transaction ID and amount' }); }
  }
  // pass 2: same amount, within 3 days, only one payment fits
  const left = lines.filter((l) => !done.some((d) => d.l.id === l.id));
  for (const l of left) {
    const fits = (byAmt.get(cents(l.amount)) || []).filter((x) => !used.has(x.id) && days(x.received_on, l.txn_date) <= 3);
    if (fits.length === 1) { used.add(fits[0].id); done.push({ l, c: fits[0], how: 'amount and date' }); }
  }
  if (apply) {
    for (const { l, c, how } of done) {
      await t.q(`update acc_receipts set unit_no = $2, head = 'Receipts From Customers', payment_head = $3, payer_name = $4, payer_type = 'Current buyer',
          remark = concat_ws(' ', nullif(remark, ''), $5::text) where id = $1`,
        [l.id, c.unit_no, HEAD[c.head] || 'AV', `${c.unit_no} ${c.buyer || ''}`.trim(), `Flat from the CRM payment (${how}).`]);
      await t.q("update receipts set bank_acc_id = $2, bank_ref = $3, bank_on = $4, bank_match = $5, bank_status = coalesce(bank_status, 'cleared') where id = $1", [c.id, l.id, l.ref_id, iso(l.txn_date), how]);
    }
    if (done.length) await audit.record(t.q, { user, action: 'aspire-tag', entity: 'accounts', entityId: 'aspire', after: { tagged: done.length } });
  }
  const amt = (a) => Math.round(a.reduce((s, x) => s + Number(x.l ? x.l.amount : x.amount), 0));
  return { credits: lines.length, tagged: done.length, taggedAmount: amt(done), byId: done.filter((d) => d.how !== 'amount and date').length, crmPayments: crm.length, crmNotFound: crm.length - used.size };
}
module.exports = { run };
