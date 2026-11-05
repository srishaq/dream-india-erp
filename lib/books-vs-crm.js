// Books against the CRM, flat by flat: what the accounts registers (Tally or the Master Accounts sheet) show as received
// from each buyer, against the receipts in the CRM ledger. Bounced cheques are left out on both sides; TDS is shown
// apart (it never comes through the bank).
const db = require('./db');
const cancellations = require('./cancellations');
const { RECEIVED_SQL, received, needBookProject } = require('./accounts');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const r0 = (x) => Math.round(n(x));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const TOL = 1000;
// What the buyer paid before the bank or UPI charges taken off the credit (Tally books those to a charges ledger in the
// same voucher; the CRM credits the buyer the full amount). TDS is not added: the CRM leaves it out of the receipt too.
function grossOf(r) {
  const rm = String(r.remark || '');
  const part = rm.match(/\(₹([\d,.]+) before charges\)/);
  if (part) return Number(part[1].replace(/,/g, ''));
  let add = 0; for (const m of rm.matchAll(/(?:Bank Charges|UPI\/Transaction Charges) ₹([\d,.]+)/gi)) add += Number(m[1].replace(/,/g, ''));
  return n(r.amount) + add;
}
// The flat's ledger in Tally carries the buyer's name. Money from a ledger whose name is not one of the present buyers,
// and that was also paid back to that person, is an earlier buyer's (as with cancelled flats): the CRM never has it.
const stripUnit = (s) => String(s || '').replace(/^\s*[AB]\s*[-/. ]?\s*\d{3,4}\s*[-–]?\s*/i, '').replace(/\s*₹.*$/, ''); // a flat agrees when the totals are within ₹1,000

async function bookings(projectId) {
  return db.q(`select b.id, u.unit_no, b.agreement_value, b.crm_status,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
      coalesce(bb.received_av, 0) as av, coalesce(bb.received_gst, 0) as gst, coalesce(bb.received_sdr, 0) as sdr, coalesce(bb.received_tds, 0) as tds
    from bookings b join units u on u.id = b.unit_id left join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.status = 'active' and not b.sample order by u.unit_no`, [projectId]);
}

// A cheque that came back: the books have the deposit as a receipt and the return as a payment to the same flat's
// ledger (same amount, up to 30 days later). The CRM leaves bounced cheques out, so the pair is set aside on the books side.
const RETN = /chq\s*ret(n|urn)\b(?!\s*(chgs|chr|charges))|cheque\s*return(?!\s*(chgs|chr|charges))|bounce/i;
// An earlier buyer's ledger: the flat has more than one buyer ledger in Tally, this one is not a present applicant, and at
// least half of what came from it was paid back to it (a refund, not stamp duty paid or a cheque that came back).
const key = (s) => stripUnit(s).toUpperCase().replace(/[^A-Z]/g, '');
function earlierLedgers(recs, current, pays) {
  const by = {};
  for (const r of recs) { const k = key(r.payer); if (k) (by[k] ||= { name: stripUnit(r.payer), got: 0 }).got += r.amount; }
  if (Object.keys(by).length < 2) return new Set();
  const out = new Set();
  for (const [k, v] of Object.entries(by)) {
    if (current.some((c) => cancellations.sameName(v.name, c))) continue;
    const back = pays.filter((p) => key(p.payee || p.desc) === k && !/\bSDR\b/i.test(p.desc || '') && !RETN.test(p.desc || '')).reduce((a, p) => a + p.amount, 0);
    if (back >= 0.5 * v.got) out.add(k);
  }
  return out;
}
function pairReturns(recs, pays) {
  const used = new Set(), returned = new Set();
  for (const r of recs.slice().sort((x, y) => x.date.localeCompare(y.date))) {
    // a payment Tally marks as a cheque return ("CHQ RETN - FUNDS INSUFFICIENT") is one whatever its head (on the
    // 111 / SDR account every payment to a flat is headed SDR); otherwise SDR paid and refunds are not returns
    const p = pays.find((q) => !used.has(q.key) && (RETN.test(q.desc || '') || (q.head !== 'SDR' && q.head !== 'Flat - Cancelled Refunded')) && Math.abs(q.amount - r.amount) < 1 && dayDiff(q.date, r.date) >= (RETN.test(q.desc || "") ? -3 : 0) && dayDiff(q.date, r.date) <= 30);
    if (p) { used.add(p.key); returned.add(r.key); r.returnedOn = p.date; p.returnOf = r.key; }
  }
  return { used, returned };
}

async function booksByUnit(projectId) {
  const rec = await db.q(`select id, unit_no, coalesce(payment_head, 'Unclassified') as ph, payer_type, payer_name, amount, txn_date, remark from acc_receipts
    where book = $1 and coalesce(unit_no, '') <> '' and ${RECEIVED_SQL} and coalesce(head, '') <> 'Internal transfer'`, [BOOK]);
  const pay = await db.q(`select id, unit_no, head, amount, txn_date, description, payee from acc_payments where book = $1 and coalesce(unit_no, '') <> ''`, [BOOK]);
  const tds = await db.q('select unit_no, sum(tds_amount) as amt from acc_tds_entries where book = $1 group by 1', [BOOK]);
  // money of buyers whose booking was cancelled (Cancelled flats register): not the present buyer's
  // (a cancellation whose buyer the CRM still shows as the buyer of that flat is left in: the CRM has his money too)
  const curRows = await db.q(`select u.unit_no, (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
      (select json_agg(y.name) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as names
    from bookings b join units u on u.id = b.unit_id where b.status = 'active' and u.project_id = $1`, [projectId]);
  const cur = Object.fromEntries(curRows.map((x) => [x.unit_no, x.buyer]));
  const names = Object.fromEntries(curRows.map((x) => [x.unit_no, Array.isArray(x.names) ? x.names : []]));
  const canc = (await db.q('select * from acc_cancellations where book = $1 order by cancel_date nulls last, id', [BOOK])).filter((c) => !(cur[c.unit_no] && cancellations.sameName(c.client, cur[c.unit_no])));
  const { receiptIds: cancelledIds } = await cancellations.inBooks(canc);
  const R = {}, P = {};
  for (const r of rec) (R[r.unit_no] ||= []).push({ key: r.id, ph: r.ph, payer: r.payer_name, other: r.payer_type === 'Other / earlier buyer', amount: grossOf(r), date: iso(r.txn_date) });
  for (const p of pay) (P[p.unit_no] ||= []).push({ key: p.id, head: p.head, desc: p.description, payee: p.payee, amount: n(p.amount), date: iso(p.txn_date) });
  // receipts that are a cancelled buyer's payment (Developer Tracker → Cancellation Payment): set aside like cancelled flats
  const CP = await cancellations.cancelPayments();
  if (CP.length) { const CPo = CP.filter((c) => !(names[c.unit_no] || []).some((nm) => cancellations.sameName(c.name, nm))); const mo = cancellations.matchOld(rec.filter((r) => !cancelledIds.has(r.id)).map((r) => ({ key: r.id, unit: r.unit_no, amount: n(r.amount), gross: grossOf(r), date: iso(r.txn_date) })), CPo); for (const k of mo.keys()) cancelledIds.add(k); }
  for (const [unit, rs] of Object.entries(R)) { const nm = names[unit]; if (!nm || !nm.length) continue; const E = earlierLedgers(rs.filter((r) => !r.other), nm, P[unit] || []); for (const r of rs) if (!r.other && E.has(key(r.payer))) r.other = true; }
  const M = {};
  const u = (k) => (M[k] ||= { av: 0, gst: 0, sdr: 0, un: 0, other: 0, k: 0, back: 0, sdrPaid: 0, refund: 0, tds: 0, returned: 0, nReturned: 0, cancelled: 0, nCancelled: 0 });
  for (const unit of new Set([...Object.keys(R), ...Object.keys(P)])) {
    const x = u(unit), rs = R[unit] || [], ps = P[unit] || [];
    const { used, returned } = pairReturns(rs.filter((r) => !r.other), ps);
    for (const r of rs) {
      if (r.other) { x.other += r.amount; continue; }
      if (returned.has(r.key)) { x.returned += r.amount; x.nReturned++; continue; }
      if (cancelledIds.has(r.key)) { x.cancelled += r.amount; x.nCancelled++; continue; }
      x.k++; x[{ AV: 'av', GST: 'gst', SDR: 'sdr' }[r.ph] || 'un'] += r.amount;
    }
    for (const p of ps) {
      if (used.has(p.key)) continue;
      if (p.head === 'SDR') x.sdrPaid += p.amount;
      else if (p.head === 'Flat - Cancelled Refunded') x.refund += p.amount;
      else x.back += p.amount; // other money paid to the flat's ledger
    }
  }
  for (const t of tds) u(t.unit_no).tds += n(t.amt);
  return M;
}

async function summary(projectId) {
  await needBookProject(projectId);
  const [bk, M] = await Promise.all([bookings(projectId), booksByUnit(projectId)]);
  const old = await crmOld(projectId);
  const seen = new Set();
  const rows = bk.map((b) => {
    seen.add(b.unit_no);
    const m = M[b.unit_no] || {};
    const books = r0((m.av || 0) + (m.gst || 0) + (m.sdr || 0) + (m.un || 0));
    const crm = r0(n(b.av) + n(b.gst) + n(b.sdr));
    const co = old[b.unit_no];
    const diff = books - crm;
    const state = !books && !crm ? 'Nothing received' : !books ? 'Only in the CRM' : !crm ? 'Only in the books' : Math.abs(diff) <= TOL ? 'Agrees' : diff > 0 ? 'More in the books' : 'More in the CRM';
    return { unit: b.unit_no, buyer: b.buyer || '', status: b.crm_status || '', av: r0(b.agreement_value),
      booksAv: r0(m.av), booksGst: r0(m.gst), booksSdr: r0(m.sdr), booksUn: r0(m.un), books, crmAv: r0(b.av), crmGst: r0(b.gst), crmSdr: r0(b.sdr), crm, diff,
      paidBack: r0(m.back), returned: r0(m.returned), nReturned: m.nReturned || 0, cancelled: r0(m.cancelled), nCancelled: m.nCancelled || 0, refund: r0(m.refund), other: r0(m.other), booksTds: r0(m.tds), crmTds: r0(b.tds), crmOld: co ? r0(co.amount) : 0, crmOldN: co ? co.n : 0, state: co && Math.abs(diff + co.amount) <= TOL && state !== 'Agrees' ? 'CRM has the cancelled buyer\'s money' : state };
  });
  // flats with money in the books but no live booking in the CRM
  for (const [unit, m] of Object.entries(M)) {
    if (seen.has(unit)) continue;
    const books = r0(m.av + m.gst + m.sdr + m.un);
    if (!books && !m.other && !m.back && !m.cancelled) continue;
    rows.push({ unit, buyer: '', status: 'No booking in the CRM', av: 0, booksAv: r0(m.av), booksGst: r0(m.gst), booksSdr: r0(m.sdr), booksUn: r0(m.un), books, crmAv: 0, crmGst: 0, crmSdr: 0, crm: 0,
      diff: books, paidBack: r0(m.back), returned: r0(m.returned), nReturned: m.nReturned || 0, cancelled: r0(m.cancelled), nCancelled: m.nCancelled || 0, refund: r0(m.refund), other: r0(m.other), booksTds: r0(m.tds), crmTds: 0, state: 'No booking in the CRM' });
  }
  const noUnit = await db.one(`select count(*)::int as k, coalesce(sum(amount), 0) as amt from acc_receipts where book = $1 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = '' and ${RECEIVED_SQL}`, [BOOK]);
  const src = await db.one("select source, count(*)::int as k from acc_receipts where book = $1 group by 1 order by 2 desc limit 1", [BOOK]);
  const tot = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const by = {}; for (const r of rows) { const x = (by[r.state] ||= { n: 0, diff: 0 }); x.n++; x.diff += r.diff; }
  return { rows: rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), totals: { books: tot('books'), crm: tot('crm'), booksAv: tot('booksAv'), crmAv: tot('crmAv'), booksGst: tot('booksGst'), crmGst: tot('crmGst'),
    booksSdr: tot('booksSdr'), crmSdr: tot('crmSdr'), booksUn: tot('booksUn'), paidBack: tot('paidBack'), returned: tot('returned'), nReturned: tot('nReturned'), cancelled: tot('cancelled'), nCancelled: tot('nCancelled'), refund: tot('refund'), other: tot('other'), booksTds: tot('booksTds'), crmTds: tot('crmTds') },
  byState: by, noUnit: { k: noUnit.k, amt: r0(noUnit.amt) }, source: src ? src.source : null };
}

// CRM receipts on a present booking that are a cancelled buyer's payment (the old buyer's money moved onto the new booking).
async function crmOld(projectId, unit = null) {
  const CP = await cancellations.cancelPayments(); if (!CP.length) return {};
  const rows = await db.q(`select r.id, u.unit_no, r.received_on, r.amount, r.instrument_no,
      (select json_agg(y.name) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as names from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id
     where u.project_id = $1 and b.status = 'active' and r.status = 'approved' ${unit ? 'and u.unit_no = $2' : ''}`, unit ? [projectId, unit] : [projectId]);
  const mo = cancellations.matchOld(rows.map((r) => ({ key: r.id, unit: r.unit_no, amount: n(r.amount), date: iso(r.received_on), ref: r.instrument_no })), CP);
  const out = {};
  // a cancelled buyer who is the present buyer too (moved to this flat, or the flat renumbered) is not an old buyer here
  for (const r of rows) { const c = mo.get(r.id); if (!c || (Array.isArray(r.names) && r.names.some((nm) => cancellations.sameName(c.name, nm)))) continue; const x = (out[r.unit_no] ||= { amount: 0, n: 0, ids: [], list: [] }); x.amount += n(r.amount); x.n++; x.ids.push(r.id); x.list.push({ id: r.id, date: iso(r.received_on), amount: n(r.amount), name: c.name, old: c.old_unit, by: c.by, ref: r.instrument_no, txn: c.txn }); }
  return out;
}

// One flat: every receipt on both sides, paired by amount (dates up to 7 days apart, then up to 45 days as "date differs").
async function detail(projectId, unit) {
  await needBookProject(projectId);
  const b = (await bookings(projectId)).find((x) => x.unit_no === unit) || null;
  const books = (await db.q(`select id, ref_id, txn_date, bank, amount, payment_head, payer_name, payer_type, cheque_status, description, remark, source from acc_receipts
    where book = $1 and unit_no = $2 and coalesce(head, '') <> 'Internal transfer' order by txn_date, id`, [BOOK, unit]))
    .map((r) => ({ id: r.id, ref: r.ref_id, date: iso(r.txn_date), bank: r.bank, amount: n(r.amount), head: r.payment_head || 'Unclassified', payer: r.payer_name, other: r.payer_type === 'Other / earlier buyer', gross: (() => { const g = grossOf(r); return Math.abs(g - n(r.amount)) > 0.009 ? g : null; })(), bounced: !received(r.cheque_status), notFound: r.cheque_status === 'Not found on statement', desc: r.description, remark: r.remark }));
  const paid = (await db.q('select ref_id, txn_date, bank, amount, head, description, remark from acc_payments where book = $1 and unit_no = $2 order by txn_date, id', [BOOK, unit]))
    .map((p) => ({ ref: p.ref_id, date: iso(p.txn_date), bank: p.bank, amount: n(p.amount), head: p.head, desc: p.description, remark: p.remark }));
  if (b) {
    const nm = (await db.q('select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1', [b.id])).map((x) => x.name);
    const pp = (await db.q('select payee, description, amount from acc_payments where book = $1 and unit_no = $2', [BOOK, unit])).map((p) => ({ payee: p.payee, desc: p.description, amount: n(p.amount) }));
    const E = earlierLedgers(books.filter((x) => !x.other && !x.bounced).map((x) => ({ payer: x.payer, amount: x.amount })), nm, pp);
    for (const x of books) if (!x.other && E.has(key(x.payer))) { x.other = true; x.earlier = true; }
  }
  const crm = b ? (await db.q(`select r.id, r.received_on, r.amount, r.mode, r.bank, r.instrument_no, r.status, r.note,
      coalesce((select sum(s.amount) from receipt_splits s where s.receipt_id = r.id and s.head = 'tds'), 0) as tds,
      (select string_agg(s.head || ' ' || s.amount::text, ', ' order by s.head) from receipt_splits s where s.receipt_id = r.id and s.amount > 0) as split
    from receipts r where r.booking_id = $1 order by r.received_on, r.id`, [b.id]))
    .map((r) => ({ id: r.id, date: iso(r.received_on), amount: n(r.amount) - n(r.tds), tds: n(r.tds), mode: r.mode, bank: r.bank, ref: r.instrument_no, status: r.status, split: r.split, note: r.note })) : [];
  // cheques that came back (deposit and return both in the books) are set aside, as the CRM leaves them out
  const rk = books.filter((x) => !x.bounced && !x.other).map((x) => ({ key: x.id, amount: x.amount, date: x.date, ref: x }));
  const pk = paid.map((p, i) => ({ key: 'p' + i, head: p.head, desc: p.desc, amount: p.amount, date: p.date, ref: p }));
  pairReturns(rk, pk);
  for (const r of rk) if (r.returnedOn) r.ref.returnedOn = r.returnedOn;
  const { receiptIds: cIds } = await cancellations.inBooks((await db.q('select * from acc_cancellations where book = $1 and unit_no = $2 order by cancel_date nulls last, id', [BOOK, unit])).filter((c) => !(b && b.buyer && cancellations.sameName(c.client, b.buyer))));
  for (const x of books) if (cIds.has(x.id) && !x.returnedOn) x.cancelledBuyer = true;
  const cancelled = await db.q('select cancel_date, client, received, refund_status from acc_cancellations where book = $1 and unit_no = $2 order by cancel_date nulls last, id', [BOOK, unit]);
  for (const p of pk) if (p.returnOf) p.ref.isReturn = true;
  // pair
  const CPs = await cancellations.cancelPayments();
  if (CPs.length) {
    const nm2 = b ? (await db.q('select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1', [b.id])).map((x) => x.name) : [];
    const mb = cancellations.matchOld(books.filter((x) => !x.cancelledBuyer && !x.bounced).map((x) => ({ key: x.id, unit, amount: x.amount, gross: x.gross, date: x.date })), CPs.filter((c) => !nm2.some((y) => cancellations.sameName(c.name, y))));
    for (const x of books) if (mb.has(x.id)) { x.cancelledBuyer = true; x.oldName = mb.get(x.id).name; }
    const co = (await crmOld(projectId, unit))[unit];
    if (co) for (const c of crm) { const o = co.list.find((y) => y.id === c.id); if (o) { c.oldBuyer = o.name || true; } }
  }
  const L = books.filter((x) => !x.bounced && !x.other && !x.returnedOn && !x.cancelledBuyer), C = crm.filter((x) => x.status === 'approved' && x.amount > 0 && !x.oldBuyer);
  const usedC = new Set();
  for (const tol of [7, 45]) for (const x of L) {
    if (x.pair) continue;
    const hit = C.filter((c) => !usedC.has(c.id) && (Math.abs(c.amount - x.amount) < 1 || (x.gross && Math.abs(c.amount - x.gross) < 1)) && Math.abs(dayDiff(c.date, x.date)) <= tol).sort((p, q) => Math.abs(dayDiff(p.date, x.date)) - Math.abs(dayDiff(q.date, x.date)))[0];
    if (hit) { usedC.add(hit.id); x.pair = hit.id; hit.pair = x.id; x.days = hit.days = dayDiff(hit.date, x.date); }
  }
  // one entry on one side for several on the other (a deposit entered once in Tally, split into AV, GST and SDR in the
  // CRM, or two cheques banked together): up to 6 entries within 7 days that add up, to the rupee or within the charges
  const combo = (one, many, amt) => {
    const cand = many.filter((m) => !m.pair && Math.abs(dayDiff(m.date, one.date)) <= 7 && m.amount < amt(one) + 1).slice(0, 20);
    const want = amt(one), tol = Math.max(1, Math.min(5000, want * 0.01));
    let found = null, steps = 0;
    const dfs = (k, sum, pick) => { if (found || ++steps > 5000) return; if (pick.length > 1 && Math.abs(sum - want) <= tol) { found = pick.slice(); return; } if (k >= cand.length || pick.length >= 6 || sum > want + tol) return; pick.push(cand[k]); dfs(k + 1, sum + cand[k].amount, pick); pick.pop(); dfs(k + 1, sum, pick); };
    dfs(0, 0, []);
    return found;
  };
  for (const x of L) { if (x.pair) continue; const f = combo(x, C, (y) => y.gross || y.amount); if (f) { x.pair = f.map((c) => c.id).join(','); x.split = f.length; for (const c of f) { c.pair = x.id; c.split = f.length; } } }
  for (const c of C) { if (c.pair) continue; const f = combo(c, L, (y) => y.amount); if (f) { c.pair = f.map((x) => x.id).join(','); c.split = f.length; for (const x of f) { x.pair = c.id; x.split = f.length; } } }
  return { cancelled: cancelled.map((c) => ({ ...c, cancel_date: iso(c.cancel_date), received: n(c.received) })), booking: b ? { unit, buyer: b.buyer, av: r0(b.agreement_value), status: b.crm_status } : { unit, buyer: '', av: 0, status: 'No booking in the CRM' }, books, paid, crm,
    unmatched: { books: L.filter((x) => !x.pair).length, crm: C.filter((c) => !c.pair).length } };
}

module.exports = { summary, detail, crmOld };
