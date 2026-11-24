// A cheque that bounced is booked in Tally as the receipt and then a payment voucher of the same amount back to the
// buyer's ledger, from the same bank (the "cheque return"). In the ERP that payment is a Payments Out row on the flat;
// the receipt stayed Cleared, so the flat's receipts counted the bounced cheque (18 Nov 2026, Head Accounts: A-2602
// showed ₹55.8 L paid where Tally's net was ₹31.2 L, three ₹8.2 L cheques having bounced).
// Each such payment is paired with the receipt it reverses (same flat, bank and amount, on or up to 60 days before);
// the receipt is marked Bounced (so totals leave it out) and the payment's head becomes "Cheque returned (bounce)".
// Pairs are kept by Receipt / Payment ID, so a Sync with Tally keeps them, and running it again changes nothing.
const db = require('./db');
// the books on the picker (Signature or Aspire), not always Signature's (24 Nov 2026)
const bk = () => require('./book').cur();
const HEAD = 'Cheque returned (bounce)';
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d || '').slice(0, 10));

async function run(t = db) {
  const pays = await t.q(`select id, ref_id, txn_date, bank, amount, unit_no from acc_payments where book = $1 and unit_no is not null and amount > 0
      and (head in ('Flat payment (check)', 'SDR', $2) or head is null) and coalesce(bounce_of, '') = '' order by txn_date, id`, [bk(), HEAD]);
  if (!pays.length) return { paired: 0 };
  const recs = await t.q(`select id, ref_id, txn_date, bank, amount, unit_no, cheque_status, bounced_by from acc_receipts
      where book = $1 and unit_no = any($2) and amount > 0 order by txn_date desc, id desc`, [bk(), [...new Set(pays.map((p) => p.unit_no))]]);
  const used = new Set(recs.filter((r) => r.bounced_by).map((r) => r.id));
  const out = [];
  for (const p of pays) {
    const d = iso(p.txn_date), from = new Date(Date.parse(d) - 60 * 864e5).toISOString().slice(0, 10);
    const fit = (r) => !used.has(r.id) && r.unit_no === p.unit_no && r.bank === p.bank && Math.abs(Number(r.amount) - Number(p.amount)) < 0.01 && iso(r.txn_date) <= d && iso(r.txn_date) >= from;
    // a receipt staff already marked Bounced first, then the latest receipt before the return
    const r = recs.find((x) => fit(x) && x.cheque_status === 'Bounced') || recs.find(fit);
    if (!r) continue;
    used.add(r.id);
    await t.q(`update acc_receipts set cheque_status = 'Bounced', bounced_by = $2, remark = concat_ws(' · ', nullif(remark, ''), $3::text) where id = $1`,
      [r.id, p.ref_id, `Bounced: returned by ${p.ref_id} on ${d}`]);
    await t.q(`update acc_payments set head = $2, bounce_of = $3, remark = concat_ws(' · ', nullif(remark, ''), $4::text) where id = $1`,
      [p.id, HEAD, r.ref_id, `Cheque return of ${r.ref_id} (${iso(r.txn_date)})`]);
    out.push({ receipt: r.ref_id, payment: p.ref_id, unit: p.unit_no, amount: Number(p.amount) });
  }
  if (out.length) await t.q("insert into acc_heads (book, side, name, note) values ($1, 'payment', $2, 'A bounced cheque paid back in Tally') on conflict (book, side, name) do nothing", [bk(), HEAD]);
  return { paired: out.length, pairs: out.slice(0, 200) };
}

module.exports = { run, HEAD };
