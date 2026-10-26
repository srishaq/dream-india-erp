// Cancelled flats: the accounts team's refund list ("Unit Refund" tab of the refund sheet). When a flat is cancelled the
// CRM drops the old booking (the flat goes back to Available or gets the new buyer), but the old buyer's money stays in
// the books under the flat's ledger until it is refunded. This list says whose money it is and whether it is refunded.
const db = require('./db');
const xlsx = require('./xlsx');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

// Names are matched on their distinctive words (common words such as Mohd, Shaikh, Khan are left out).
const STOP = new Set(['mohd', 'mohammed', 'mohammad', 'mohamed', 'muhammad', 'md', 'shaikh', 'sheikh', 'shaik', 'khan', 'syed', 'sayed', 'sayyed', 'ali', 'ahmed', 'ahmad', 'bhai', 'mr', 'mrs', 'ms', 'and', 'the', 'cancel', 'flat', 'eoi', 'refund', 'bano', 'banu', 'begum', 'abdul', 'bin']);
const words = (s) => String(s || '').toLowerCase().replace(/\b[ab]\s*[-/.]?\s*\d{3,4}\b/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
// Two spellings of the same name word: Qureshi / Kureshi, Zaheen / Zahin, Shoib / Shoeb, Quadri / Qudari.
const sound = (w) => w.replace(/q/g, 'k').replace(/ee|ea/g, 'i').replace(/oo|ou/g, 'u').replace(/z/g, 'j').replace(/ph/g, 'f').replace(/(.)\1/g, '$1');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function near(a, b) {
  if (a === b) return true;
  const x = sound(a), y = sound(b);
  if (x === y) return true;
  const m = Math.min(x.length, y.length);
  return m >= 4 && lev(x, y) <= (m >= 6 ? 2 : 1);
}
function sameName(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  const a2 = A.filter((w) => !STOP.has(w)), b2 = B.filter((w) => !STOP.has(w));
  if (!a2.length || !b2.length) return A.join(' ') === B.join(' ');
  // the same person: two distinctive words in common; one is enough only when a name has just one (a short bank
  // narration). A shared surname or first name alone is not: "Shoeb Ahmed Ansari" and "Saad Imam Ansari" differ.
  const common = a2.filter((w) => b2.some((v) => near(w, v)));
  if (common.length >= 2) return true;
  return (a2.length === 1 || b2.length === 1) && common.some((w) => w.length >= 4);
}

const dateOf = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return xlsx.serialToText(v).slice(0, 10);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = String(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (d) return `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return null;
};
const money = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, '')) || null);
const H = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Reads the refund sheet. Uses the tab whose heading row has "Cancellation Date" and "Unit" ("Unit Refund").
function parse(buf, fileName) {
  const sheets = xlsx.read(buf);
  for (const sh of sheets) {
    const h = sh.rows.findIndex((r, i) => i < 10 && r && r.map(H).includes('cancellationdate') && r.map(H).includes('unit') && r.map(H).includes('refundstatus'));
    if (h < 0) continue;
    const head = sh.rows[h].map(H), col = (k) => head.indexOf(k);
    const out = [], skipped = [];
    for (let i = h + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i] || [];
      const unit = String(r[col('unit')] || '').toUpperCase().replace(/\s+/g, '');
      if (!unit) continue;
      if (!/^[AB]-\d{3,4}$/.test(unit)) { skipped.push({ row: i + 1, unit }); continue; }
      out.push({ cancel_date: dateOf(r[col('cancellationdate')]), booking_date: dateOf(r[col('bookingdate')]), unit_no: unit, client: String(r[col('clientname')] || '').trim() || null,
        typology: String(r[col('typo')] ?? '').trim() || null, area: money(r[col('area')]), cp: String(r[col('cpfirmname')] || '').trim() || null,
        closing_manager: String(r[col('finalclosingmanagername')] || '').trim() || null, final_av: money(r[col('finalav')]), received: money(r[col('cleared')]),
        refund_rtgs: money(r[col('rtgs')]), refund_white: money(r[col('white')]), refund_status: String(r[col('refundstatus')] || '').trim() || null });
    }
    return { file: fileName, sheet: sh.name, rows: out, skipped };
  }
  throw Object.assign(new Error('This file has no tab with the headings "Cancellation Date", "Unit" and "Refund Status" (the "Unit Refund" tab).'), { status: 400 });
}

async function commit(t, p, { user }) {
  const removed = (await t.q('delete from acc_cancellations where book = $1 and imported returning 1 as x', [BOOK])).length;
  const cols = ['cancel_date', 'booking_date', 'unit_no', 'client', 'typology', 'area', 'cp', 'closing_manager', 'final_av', 'received', 'refund_rtgs', 'refund_white', 'refund_status'];
  const types = { cancel_date: 'date', booking_date: 'date', area: 'numeric', final_av: 'numeric', received: 'numeric', refund_rtgs: 'numeric', refund_white: 'numeric' };
  await t.q(`insert into acc_cancellations (book, imported, created_by, ${cols.join(', ')}) select $1, true, $2, ${cols.map((c) => 'x.' + c).join(', ')}
             from json_to_recordset($3::json) as x(${cols.map((c) => `${c} ${types[c] || 'text'}`).join(', ')})`, [BOOK, user.id, JSON.stringify(p.rows)]);
  return { removed, added: p.rows.length };
}

const refunded = (s) => /^done/i.test(String(s || '').trim());

// The money of cancelled buyers in the books: receipts on that flat whose ledger / payer name is the cancelled buyer's,
// and payments to that flat whose name is theirs (refunds). Returns per cancellation row, and the receipt ids taken.
async function inBooks(rows) {
  const units = [...new Set(rows.map((r) => r.unit_no))];
  if (!units.length) return { byRow: {}, receiptIds: new Set() };
  const rec = await db.q(`select id, unit_no, txn_date, amount, payer_name, description, cheque_status from acc_receipts where book = $1 and unit_no = any($2) and coalesce(head, '') <> 'Internal transfer'`, [BOOK, units]);
  const pay = await db.q('select id, unit_no, txn_date, amount, payee, description, head from acc_payments where book = $1 and unit_no = any($2)', [BOOK, units]);
  const byRow = {}, receiptIds = new Set(), payIds = new Set();
  for (const c of rows) {
    if (!c.client) continue;
    const mine = rec.filter((r) => r.unit_no === c.unit_no && !receiptIds.has(r.id) && r.cheque_status !== 'Bounced' && sameName(c.client, r.payer_name || r.description));
    const back = pay.filter((p) => p.unit_no === c.unit_no && !payIds.has(p.id) && p.head !== 'SDR' && sameName(c.client, p.payee || p.description));
    // a cheque that came back (deposit and return, same amount, up to 30 days apart) is not money held
    const usedP = new Set(), returned = new Set();
    for (const r of mine) { const p = back.find((q) => !usedP.has(q.id) && Math.abs(n(q.amount) - n(r.amount)) < 1 && dayDiff(iso(q.txn_date), iso(r.txn_date)) >= 0 && dayDiff(iso(q.txn_date), iso(r.txn_date)) <= 30); if (p) { usedP.add(p.id); returned.add(r.id); } }
    mine.forEach((r) => receiptIds.add(r.id)); back.forEach((p) => payIds.add(p.id));
    byRow[c.id] = { received: mine.filter((r) => !returned.has(r.id)).reduce((a, r) => a + n(r.amount), 0), nReceived: mine.length - returned.size,
      refunded: back.filter((p) => !usedP.has(p.id)).reduce((a, p) => a + n(p.amount), 0), nRefunded: back.length - usedP.size };
  }
  return { byRow, receiptIds };
}

// The green columns of the Cancelled flats register.
async function calc(rows) {
  if (!rows.length) return rows;
  const units = [...new Set(rows.map((r) => r.unit_no).filter(Boolean))];
  const crm = await db.q(`select u.unit_no, u.status as ustatus, b.status as bstatus,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer
    from units u join projects p on p.id = u.project_id left join bookings b on b.unit_id = u.id and b.status in ('active', 'pending')
    where p.code = 'SIGNATURE' and u.unit_no = any($1)`, [units]);
  const C = Object.fromEntries(crm.map((x) => [x.unit_no, x]));
  // books figures are worked out over every cancellation of the flats shown, so a receipt is given to one cancellation only
  const all = await db.q('select * from acc_cancellations where book = $1 and unit_no = any($2) order by cancel_date nulls last, id', [BOOK, units]);
  const { byRow } = await inBooks(all);
  for (const r of rows) {
    const c = C[r.unit_no], b = byRow[r.id] || { received: 0, refunded: 0 };
    r.crm_now = !c ? 'Flat not in the ERP' : !c.buyer ? `No booking (flat ${c.ustatus})` : sameName(r.client, c.buyer) ? `Still booked to ${c.buyer} — CRM not cancelled` : `Re-booked to ${c.buyer}`;
    r.books_received = Math.round(b.received);
    r.books_refunded = Math.round(b.refunded);
    r.to_refund = refunded(r.refund_status) ? 0 : Math.max(0, Math.round(n(r.received) - b.refunded));
    r.books_check = !b.received && n(r.received) ? 'Not found in the books under this name' : Math.abs(b.received - n(r.received)) <= 1000 ? 'Agrees with the books' : `Books ₹${Math.round(b.received).toLocaleString('en-IN')}`;
  }
  return rows;
}

async function summary() {
  const rows = await calc(await db.q('select * from acc_cancellations where book = $1 order by cancel_date nulls last, id', [BOOK]));
  const pend = rows.filter((r) => !refunded(r.refund_status));
  const by = {}; for (const r of pend) { const k = r.refund_status || '(blank)'; const x = (by[k] ||= { n: 0, received: 0 }); x.n++; x.received += n(r.received); }
  return { n: rows.length, pending: pend.length, pendingAmount: pend.reduce((a, r) => a + n(r.received), 0), toRefund: pend.reduce((a, r) => a + r.to_refund, 0), byStatus: by,
    stillInCrm: rows.filter((r) => /CRM not cancelled/.test(r.crm_now)).length, notInBooks: rows.filter((r) => /^Not found/.test(r.books_check)).length };
}

module.exports = { parse, commit, calc, inBooks, sameName, summary, refunded };
