// The sum behind a PDC cheque (27 Nov 2026, Rafi Sir): GST is added to the bill amount, TDS is taken on the bill amount
// only (never on the GST), and the cheque is the invoice total less the TDS.
//   bill 50,862.50 + CGST 9% 4,577.63 + SGST 9% 4,577.63 = 60,017.75; TDS 194Q 0.1% = 50.86; cheque 59,966.89
// Used by the PDC form (filled as they type), the Excel upload and the register's "Amount check".
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const rateOf = (s) => { const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(s || '')); return m ? Number(m[1]) / 100 : /^no\b/i.test(String(s || '')) ? 0 : null; };
const igstOf = (type) => /igst|other state/i.test(String(type || ''));
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[₹,\s]/g, '')));

// what the row should be, from the bill amount, the GST rate and type, and the TDS section (null where it cannot tell)
function calc(r) {
  const base = num(r.invoice_amount); if (!(base > 0)) return null;
  const g = rateOf(r.gst_rate), t = rateOf(r.tds_section);
  const out = { base };
  if (g != null) { if (igstOf(r.gst_type)) { out.igst = r2(base * g); out.cgst = 0; out.sgst = 0; } else { out.cgst = r2((base * g) / 2); out.sgst = out.cgst; out.igst = 0; } }
  if (t != null) out.tds = r2(base * t);
  // the total and the cheque from what is on the row (typed or filled), so a figure changed by hand is followed
  const gst = (num(r.cgst) ?? out.cgst ?? 0) + (num(r.sgst) ?? out.sgst ?? 0) + (num(r.igst) ?? out.igst ?? 0);
  out.total = r2(base + gst);
  out.cheque = r2(out.total - (num(r.tds_amount) ?? out.tds ?? 0));
  return out;
}
// "OK", or what does not add up
function check(r) {
  const c = calc(r); if (!c) return '';
  const inr = (x) => '₹' + r2(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out = [];
  if (c.tds != null && r.tds_amount != null && r.tds_amount !== '' && Math.abs(num(r.tds_amount) - c.tds) > 1) out.push(`TDS should be ${inr(c.tds)} (${r.tds_section})`);
  const gstNow = (num(r.cgst) || 0) + (num(r.sgst) || 0) + (num(r.igst) || 0), gstWant = c.cgst != null ? c.cgst + c.sgst + c.igst : null;
  if (gstWant != null && Math.abs(gstNow - gstWant) > 1) out.push(`GST should be ${inr(gstWant)} (${r.gst_rate})`);
  if (r.amount != null && r.amount !== '' && Math.abs(num(r.amount) - c.cheque) > 1) out.push(`cheque should be ${inr(c.cheque)} (bill + GST − TDS), it is ${inr(r.amount)}`);
  return out.length ? out.join('; ').replace(/^./, (x) => x.toUpperCase()) : 'OK';
}
// fills what is left empty (GST, TDS, cheque amount); figures typed by hand are kept
function fill(r) {
  const c = calc(r); if (!c) return r;
  const empty = (k) => r[k] == null || r[k] === '';
  if (c.cgst != null) { if (empty('cgst') && empty('sgst') && empty('igst')) { r.cgst = c.cgst || null; r.sgst = c.sgst || null; r.igst = c.igst || null; } }
  if (c.tds != null && empty('tds_amount')) r.tds_amount = c.tds;
  if (empty('amount')) r.amount = calc(r).cheque;
  return r;
}
const api = { calc, check, fill, rateOf };
if (typeof module !== 'undefined') module.exports = api; else window.PdcMath = api;
