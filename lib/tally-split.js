// One Tally receipt voucher often holds several flats (a day's UPI collections, a gateway settlement): Tally keeps one
// bank line and a ledger line per buyer. split(row) turns that one register row into a row per ledger line, so each flat
// gets its money. The parts share the voucher's ref_id plus "/1", "/2"…, and add up to the bank amount: bank charges
// taken off the voucher are spread over the parts in proportion. Returns null when the row is not such a voucher.
const { unitOf, BANKS } = require('./tally-import');

const r2 = (x) => Math.round(Number(x) * 100) / 100;
const RERA_OPENED = '2026-01-22';
const earlier = (name) => /cancel|eoi/i.test(name || '');

function parts(desc) {
  const out = [];
  for (const p of String(desc || '').split(' · ')[0].split('; ')) {
    const m = p.match(/^(.*\S) ₹([\d,]+(?:\.\d+)?)$/);
    if (!m) return null;
    out.push({ ledger: m[1], gross: Number(m[2].replace(/,/g, '')) });
  }
  return out.length > 1 ? out : null;
}

function split(row) {
  if (!row || row.unit_no || row.head === 'Internal transfer' || String(row.ref_id || '').includes('/')) return null;
  const ps = parts(row.description);
  if (!ps || !ps.some((p) => unitOf(p.ledger))) return null;
  const gross = ps.reduce((a, p) => a + p.gross, 0), amount = Number(row.amount);
  if (!(gross > 0) || amount > gross + 1 || amount < gross * 0.9) return null; // the parts must explain the bank line
  const bank = BANKS.find((b) => b.ledger === row.bank) || {};
  let left = r2(amount);
  return ps.map((p, i) => {
    const amt = i === ps.length - 1 ? r2(left) : r2(p.gross * amount / gross);
    left = r2(left - amt);
    const unit = unitOf(p.ledger);
    const ph = unit ? (bank.payHead || (bank.key === '092827000000111' ? (String(row.txn_date).slice(0, 10) < RERA_OPENED ? 'AV' : 'SDR') : 'Unclassified')) : null;
    return { ...row, ref_id: `${row.ref_id}/${i + 1}`, amount: amt, unit_no: unit, payer_name: p.ledger,
      head: unit ? 'Receipts From Customers' : p.ledger, payment_head: ph, payer_type: unit ? (earlier(p.ledger) ? 'Other / earlier buyer' : 'Current buyer') : null,
      remark: [row.remark, `part ${i + 1} of ${ps.length} of one Tally voucher (₹${p.gross.toLocaleString('en-IN')} before charges)`].filter(Boolean).join(' · ') };
  }).filter((r) => r.amount > 0);
}

module.exports = { split, parts };
