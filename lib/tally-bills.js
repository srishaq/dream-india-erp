// Vendor bills from Tally (23 Nov 2026): the Purchase Register (material) and the Journal Register (services, rent,
// commission, contractors) give each bill with its expense, GST and TDS; the Payment Register gives what was paid.
//   bills(registers)      → [{ party, date, type, no, ref, invNo, invDate, taxable, gst, tds, tdsSec, tdsRate, total, net, narr }]
//   payments(registers)   → [{ party, date, no, bank, amount, narr }]
//   match(bills, pays)    → each payment with the bill(s) it paid: the same party, the amount = the bill's net (total − TDS),
//                           or 2–4 open bills of that party adding up to it, paid on or after the bill (30 days' grace)
// A bill: the party credited (not a flat, not TDS), the expense lines debited, GST debited, TDS credited.
const xlsx = require('./xlsx');
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? 0 : Number(String(v).replace(/[,\s]/g, '')) || 0);
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dateOf = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return xlsx.serialToText(v).slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) { const mo = MON.indexOf(m[2].toLowerCase()) + 1; if (mo) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const clean = (s) => String(s ?? '').replace(/_x000D_/g, '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/\b(m\/s\.?|messrs\.?)\s*/g, '').replace(/[^a-z0-9]/g, '');
const U = /^\s*([AB])\s*[-/. ]?\s*(\d{3,4})(?!\d)/i;
const isFlat = (s) => U.test(s || '');
// TDS ledgers: "TDS on Contract 194C" (Signature), "194C @ 1.00%", "TDS PAYABLE", "Buildwell Construction - TDS"
// (Aspire, 24 Nov 2026); not a buyer's own TDS ledger such as "403-Shahab Ahmed Khan (TDS)"
const TDS = { test: (s) => { s = String(s || '').trim(); return !/\(tds\)\s*$|\(a\.?y\.?/i.test(s) && (/^tds\b/i.test(s) || /^194[a-z-]*\s*@/i.test(s) || /^tds\s+payable\b/i.test(s) || /\s-\s*tds$/i.test(s)); } };
const GST = /^(input\s+)?(c|s|i|u)gst\b|^(c|s|i)gst\s*-|^gst\s+(input|on)/i;
const ROUND = /^round(ing)?\s*off|^rounded\s*off|^short\s*&?\s*excess/i;
const BANKISH = /bank|cash|\bhdfc\b|\byes\b|fixed deposit|current a\/c/i;
const secOf = (s) => { const m = String(s || '').replace(/\s+/g, '').match(/194-?(IA|IB|C|H|I|J|Q|A|O|R|S|T)/i); return m ? '194' + (m[1].toUpperCase() === 'I' ? '-I' : m[1].toUpperCase() === 'IA' ? '-IA' : m[1].toUpperCase()) : (/^tds.*salary|\b192\b/i.test(s) ? '192' : ''); };
const fixDate = (d) => { const m = String(d || '').match(/^(\d{1,2})[\/.-](\d{1,3})[\/.-](\d{2,4})$/); if (!m) return null; const mo = +m[2] > 12 ? +String(m[2]).slice(-2) : +m[2]; const y = m[3].length === 2 ? '20' + m[3] : m[3]; if (mo < 1 || mo > 12 || +m[1] < 1 || +m[1] > 31) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; };

// One register sheet → vouchers with their ledger lines, bill references and narration
function read(buf, file) {
  const out = [];
  const xls = require('./xls'); // Dream Aspire's Tally exports come as old .xls (24 Nov 2026)
  for (const sh of (xls.isXls(buf) ? xls.read(buf) : xlsx.read(buf))) {
    const rows = sh.rows;
    const h = rows.findIndex((r, i) => i < 15 && r && clean(r[0]) === 'Date' && /particulars/i.test(clean(r[1])));
    if (h < 0) continue;
    const H = rows[h].map((x) => clean(x).toLowerCase());
    const cT = H.indexOf('vch type'), cN = H.indexOf('vch no.'), cD = H.indexOf('debit'), cC = H.indexOf('credit');
    const title = rows.slice(0, h).map((r) => (r || []).find((x) => x)).filter(Boolean).join(' · ');
    let cur = null;
    for (let i = h + 2; i < rows.length; i++) {
      const r = rows[i] || [];
      if (/^(grand\s+)?total:?$/i.test(clean(r[0]))) break;
      const d = dateOf(r[0]);
      if (d) { cur = { file, title, date: d, no: clean(r[cN]), type: clean(r[cT]), lines: [], refs: [], narr: [], inst: [] }; out.push(cur); }
      if (!cur) continue;
      const name = clean(r[1]);
      if (d || clean(r[0]) === '') {
        if (name && (num(r[cD]) || num(r[cC]))) { cur.lines.push({ ledger: name, dr: num(r[cD]), cr: num(r[cC]) }); continue; }
        if (!name && /^(new ref|agst ref|advance|on account)$/i.test(clean(r[1]))) continue;
      }
      if (/^(new ref|agst ref|advance|on account)$/i.test(name)) { cur.refs.push({ kind: name, ref: clean(r[2]), amt: num(r[4]) }); continue; }
      if (name && !num(r[cD]) && !num(r[cC])) { if (d) cur.lines.push({ ledger: name, dr: 0, cr: 0 }); else cur.narr.push(name); continue; }
      if (!name && clean(r[2]) && dateOf(r[4])) { cur.inst.push({ how: clean(r[2]), date: dateOf(r[4]), amt: num(r[5]) }); continue; }
      if (clean(r[0]) && !d) cur.narr.push(clean(r[0])); // the party name under a cheque line
    }
  }
  return out;
}

function bills(vouchers) {
  const out = [];
  for (const v of vouchers) {
    if (!/purchase|journal/i.test(v.type)) continue;
    const L = v.lines.filter((l) => l.dr || l.cr);
    if (L.some((l) => BANKISH.test(l.ledger) && !TDS.test(l.ledger))) continue;
    const tdsL = L.filter((l) => TDS.test(l.ledger) && l.cr > 0);
    const gstL = L.filter((l) => GST.test(l.ledger) && l.dr > 0);
    const credits = L.filter((l) => l.cr > 0 && !TDS.test(l.ledger) && !ROUND.test(l.ledger) && !GST.test(l.ledger));
    const debits = L.filter((l) => l.dr > 0 && !GST.test(l.ledger) && !ROUND.test(l.ledger) && !TDS.test(l.ledger));
    if (credits.length !== 1 || !debits.length) continue;
    const party = credits[0];
    if (isFlat(party.ledger) || debits.some((d) => isFlat(d.ledger))) continue; // a buyer's entry, not a bill
    const round = L.filter((l) => ROUND.test(l.ledger)).reduce((a, l) => a + l.dr - l.cr, 0);
    const taxable = r2(debits.reduce((a, l) => a + l.dr, 0)), gst = r2(gstL.reduce((a, l) => a + l.dr, 0)), tds = r2(tdsL.reduce((a, l) => a + l.cr, 0));
    const narr = v.narr.join(' ');
    const im = narr.match(/inv(?:oice)?\.?\s*(?:no\.?|number)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\/\-_.]*)/i);
    const dm = narr.match(/\bdt\.?\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,3}[\/.\-]\d{2,4})/i);
    const ref = (v.refs.find((x) => /new ref/i.test(x.kind)) || v.refs[0] || {}).ref || '';
    const sec = tdsL.map((l) => secOf(l.ledger)).find(Boolean) || secOf(narr) || '';
    out.push({ party: party.ledger, key: norm(party.ledger), date: v.date, type: v.type, no: v.no, file: v.file, ref, invNo: ref || (im ? im[1].replace(/[.,]$/, '') : ''), invDate: dm ? fixDate(dm[1]) : null,
      expense: debits.map((d) => d.ledger), taxable, gst, tds, tdsSec: sec, tdsRate: tds && taxable ? r2(tds / taxable * 100) / 100 : 0,
      total: r2(taxable + gst + round), net: r2(party.cr), narr });
  }
  return out;
}

function payments(vouchers) {
  const out = [];
  for (const v of vouchers) {
    if (!/payment/i.test(v.type)) continue;
    const L = v.lines.filter((l) => l.dr || l.cr);
    const bank = L.filter((l) => l.cr > 0 && (BANKISH.test(l.ledger) || /^cash$/i.test(l.ledger)));
    if (!bank.length) continue;
    for (const p of L.filter((l) => l.dr > 0 && !BANKISH.test(l.ledger))) {
      out.push({ party: p.ledger, key: norm(p.ledger), date: v.date, no: v.no, file: v.file, bank: bank.map((b) => b.ledger).join(', '), amount: r2(p.dr), tdsOnPay: r2(L.filter((l) => TDS.test(l.ledger) && l.cr > 0).reduce((a, l) => a + l.cr, 0)), narr: v.narr.join(' ') });
    }
  }
  return out;
}

// a voucher's key: type, year and number; Aspire's journals often have no number (24 Nov 2026), so then the date,
// party, amount and invoice tell them apart
const billKey = (b) => (b.no ? `${b.type}|${fy(b.date)}|${b.no}` : `${b.type}|${b.date}|${norm(b.party)}|${b.total}|${b.invNo || ''}`);
const fy = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
// pays: [{ key, date, amount, id? }], bl: bills → [{ pay, bills: [...], how }]
function match(bl, pays, { grace = 30, window = 400 } = {}) {
  const byParty = new Map();
  for (const b of bl) (byParty.get(b.key) || byParty.set(b.key, []).get(b.key)).push({ ...b, open: true });
  for (const list of byParty.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  const res = [];
  const sorted = [...pays].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  for (const p of sorted) {
    const list = (byParty.get(p.key) || []).filter((b) => b.open && days(p.date, b.date) >= -grace && days(p.date, b.date) <= window);
    let hit = list.find((b) => Math.abs(b.net - p.amount) <= 1);
    if (hit) { hit.open = false; res.push({ pay: p, bills: [hit], how: 'amount' }); continue; }
    // 2 to 4 bills in a row adding up to the payment
    let found = null;
    for (let i = 0; i < list.length && !found; i++) { let s = 0; for (let j = i; j < Math.min(list.length, i + 4); j++) { s += list[j].net; if (j > i && Math.abs(s - p.amount) <= 1) { found = list.slice(i, j + 1); break; } if (s > p.amount + 1) break; } }
    if (found) { found.forEach((b) => (b.open = false)); res.push({ pay: p, bills: found, how: 'bills together' }); continue; }
    res.push({ pay: p, bills: [], how: null });
  }
  const open = [...byParty.values()].flat().filter((b) => b.open);
  return { res, open };
}


// ---------- the TDS workings (the accounts team's monthly sheets): PAN, section and invoice no. per party ----------
function workings(buf, file) {
  const out = [];
  for (const sh of (require('./xls').isXls(buf) ? require('./xls').read(buf) : xlsx.read(buf))) {
    if (/summary|working$|transfer/i.test(sh.name)) continue;
    const h = sh.rows.findIndex((r) => r && r.some((c) => /^particulars$/i.test(clean(c))) && r.some((c) => /tds amount/i.test(clean(c))));
    if (h < 0) continue;
    const H = sh.rows[h].map((c) => clean(c).toLowerCase()); const ci = (k) => H.findIndex((x) => x.startsWith(k));
    const C = { p: ci('particulars'), pan: ci('pan'), inv: ci('inv'), d: ci('relevant'), sec: ci('section'), amt: ci('amount paid'), rate: ci('tds rate'), tds: ci('tds amount') };
    for (const r of sh.rows.slice(h + 1)) {
      if (!r || !clean(r[C.p]) || /total/i.test(clean(r[C.p]))) continue;
      const tds = Number(r[C.tds]); if (!Number.isFinite(tds) || !clean(r[C.sec])) continue;
      const pan = C.pan >= 0 ? clean(r[C.pan]).toUpperCase().replace(/\s/g, '') : '';
      out.push({ file, sheet: sh.name, party: clean(r[C.p]), key: norm(r[C.p]), pan: /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : '', inv: C.inv >= 0 ? clean(r[C.inv]) : '', date: dateOf(r[C.d]) || fixDate(clean(r[C.d])), sec: secOf(r[C.sec]) || clean(r[C.sec]), amount: Number(r[C.amt]) || 0, rate: Number(r[C.rate]) || 0, tds });
    }
  }
  return out;
}

// ---------- into the ERP ----------
// The bills go to acc_vendor_bills (one row per Tally voucher, replaced on each import of the same voucher). Each
// Payments Out row whose payee is the bill's party and whose amount is the bill's net (or several bills' together) gets
// the bill columns filled, where they are empty; the vendor's PAN comes from the TDS workings.
const BILL_COLS = ['bill_no', 'bill_date', 'taxable_value', 'gst_on_bill', 'total_bill', 'tds_section', 'tds_rate', 'tds_deducted', 'net_payable', 'bill_ids', 'vendor_pan'];
async function plan(q, { bills: bl, pans, tpays }, { book = 'signature' } = {}) {
  const pays = await q(`select id, ref_id, txn_date::text as date, payee, amount, ${BILL_COLS.join(', ')} from acc_payments
     where book = $1 and payee is not null and amount > 0 order by txn_date, id`, [book]);
  const parties = new Set(bl.map((b) => b.key));
  // the party of an ERP payment: its payee when that is the Tally ledger, else the Tally payment voucher of the same
  // amount within 3 days (only one such voucher), whose party it then takes
  const TP = (tpays || []).filter((x) => parties.has(x.key));
  const P = pays.map((p) => {
    const a = Number(p.amount), k = norm(p.payee);
    if (parties.has(k)) return { ...p, key: k, amount: a, by: 'payee' };
    const c = TP.filter((x) => Math.abs(x.amount - a) <= 1 && Math.abs(days(x.date, p.date)) <= 3);
    const ks = [...new Set(c.map((x) => x.key))];
    return ks.length === 1 ? { ...p, key: ks[0], amount: a, by: 'Tally payment' } : null;
  }).filter(Boolean);
  const { res, open } = match(bl, P);
  const fills = [];
  for (const r of res) {
    if (!r.bills.length) continue;
    const p = r.pay, b = r.bills, one = b.length === 1 ? b[0] : null;
    const sum = (k) => r2(b.reduce((a, x) => a + x[k], 0));
    const tds = sum('tds'), taxable = sum('taxable');
    const v = { bill_no: b.map((x) => x.invNo).filter(Boolean).join(', ') || null, bill_date: (one ? one.invDate || one.date : b[b.length - 1].date), taxable_value: taxable, gst_on_bill: sum('gst'), total_bill: sum('total'),
      tds_section: b.map((x) => x.tdsSec).find(Boolean) || null, tds_rate: tds && taxable ? Math.round(tds / taxable * 10000) / 10000 : null, tds_deducted: tds, net_payable: sum('net'),
      bill_ids: b.map((x) => `Tally ${x.type} ${x.no} (${x.date})`).join(', '), vendor_pan: pans[p.key] || null };
    const set = {};
    for (const k of BILL_COLS) if ((p[k] == null || p[k] === '') && v[k] != null && v[k] !== '') set[k] = v[k];
    const differ = ['total_bill', 'tds_deducted'].filter((k) => p[k] != null && Math.abs(Number(p[k]) - Number(v[k])) > 1).map((k) => ({ what: k, erp: Number(p[k]), tally: v[k] }));
    fills.push({ id: p.id, ref: p.ref_id, date: p.date, payee: p.payee, amount: p.amount, bills: b.length, how: r.how, set, v, differ });
  }
  const unmatched = res.filter((r) => !r.bills.length).map((r) => ({ ref: r.pay.ref_id, date: r.pay.date, payee: r.pay.payee, amount: r.pay.amount }));
  return { bills: bl.length, payments: P.length, matched: fills.length, fills: fills.filter((f) => Object.keys(f.set).length), differ: fills.filter((f) => f.differ.length), unmatched, openBills: open.length };
}

async function commit(t, data, { book = 'signature', user = null, source = '' } = {}) {
  const bl = data.bills;
  const seen = new Map(), keys = bl.map((b) => { const k = billKey(b), n = (seen.get(k) || 0) + 1; seen.set(k, n); return n > 1 ? `${k}#${n}` : k; });
  await t.q(`insert into acc_vendor_bills (book, tally_key, party, bill_date, vch_type, vch_no, inv_no, inv_date, expense, taxable, gst, total, tds_section, tds_rate, tds, net, pan, narration, source)
     select $1, x.k, x.party, x.date::date, x.type, x.no, nullif(x.inv, ''), x.invdate::date, x.expense, x.taxable, x.gst, x.total, nullif(x.sec, ''), x.rate, x.tds, x.net, x.pan, nullif(x.narr, ''), $3
       from json_to_recordset($2::json) as x(k text, party text, date text, type text, no text, inv text, invdate text, expense text, taxable numeric, gst numeric, total numeric, sec text, rate numeric, tds numeric, net numeric, pan text, narr text)
     on conflict (book, tally_key) do update set party = excluded.party, bill_date = excluded.bill_date, inv_no = excluded.inv_no, inv_date = excluded.inv_date, expense = excluded.expense, taxable = excluded.taxable,
       gst = excluded.gst, total = excluded.total, tds_section = excluded.tds_section, tds_rate = excluded.tds_rate, tds = excluded.tds, net = excluded.net, pan = coalesce(excluded.pan, acc_vendor_bills.pan),
       narration = excluded.narration, source = excluded.source, updated_at = now()`,
  [book, JSON.stringify(bl.map((b, i) => ({ k: keys[i], party: b.party, date: b.date, type: b.type, no: b.no, inv: b.invNo, invdate: b.invDate, expense: b.expense.join(', '),
    taxable: b.taxable, gst: b.gst, total: b.total, sec: b.tdsSec, rate: b.tdsRate || null, tds: b.tds, net: b.net, pan: data.pans[b.key] || null, narr: b.narr.slice(0, 1000) }))), source]);
  const p = await plan(t.q, data, { book });
  // one statement for all the payments: each column is filled only where it is empty
  const TXT = ['bill_no', 'tds_section', 'bill_ids', 'vendor_pan'];
  const sets = BILL_COLS.map((k) => (TXT.includes(k) ? `${k} = coalesce(nullif(p.${k}, ''), x.${k})` : `${k} = coalesce(p.${k}, x.${k})`)).join(', ');
  // updated_at is left alone: the bill columns do not change the voucher Tally has, so nothing is sent to Tally again
  if (p.fills.length) await t.q(`update acc_payments p set ${sets}, updated_by = $2,
      bill_note = concat_ws(' · ', nullif(p.bill_note, ''), 'Bill details from Tally (' || x.how || ')')
    from json_to_recordset($1::json) as x(id int, how text, bill_no text, bill_date date, taxable_value numeric, gst_on_bill numeric, total_bill numeric, tds_section text, tds_rate numeric, tds_deducted numeric, net_payable numeric, bill_ids text, vendor_pan text)
    where p.id = x.id`, [JSON.stringify(p.fills.map((f) => ({ id: f.id, how: f.how, ...f.v }))), user ? user.id : null]);
  await require('./audit').record(t.q, { user, action: 'tally-bills', entity: 'accounts', entityId: book, after: { bills: bl.length, filled: p.fills.length, differ: p.differ.length, unmatched: p.unmatched.length }, note: `Vendor bills from Tally: ${source}`.slice(0, 500) });
  return p;
}

module.exports = { read, bills, payments, match, norm, secOf, isFlat, workings, plan, commit, BILL_COLS };
