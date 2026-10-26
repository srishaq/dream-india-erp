// Books against the CRM, flat by flat: what the accounts registers (Tally or the Master Accounts sheet) show as received
// from each buyer, against the receipts in the CRM ledger. Bounced cheques are left out on both sides; TDS is shown
// apart (it never comes through the bank).
const db = require('./db');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const r0 = (x) => Math.round(n(x));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const TOL = 1000; // a flat agrees when the totals are within ₹1,000

async function bookings(projectId) {
  return db.q(`select b.id, u.unit_no, b.agreement_value, b.crm_status,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
      coalesce(bb.received_av, 0) as av, coalesce(bb.received_gst, 0) as gst, coalesce(bb.received_sdr, 0) as sdr, coalesce(bb.received_tds, 0) as tds
    from bookings b join units u on u.id = b.unit_id left join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.status = 'active' and not b.sample order by u.unit_no`, [projectId]);
}

async function booksByUnit() {
  const rec = await db.q(`select unit_no, coalesce(payment_head, 'Unclassified') as ph, payer_type, sum(amount) as amt, count(*)::int as k from acc_receipts
    where book = $1 and coalesce(unit_no, '') <> '' and coalesce(cheque_status, '') <> 'Bounced' and coalesce(head, '') <> 'Internal transfer' group by 1, 2, 3`, [BOOK]);
  const pay = await db.q(`select unit_no, head, sum(amount) as amt from acc_payments where book = $1 and coalesce(unit_no, '') <> '' group by 1, 2`, [BOOK]);
  const tds = await db.q('select unit_no, sum(tds_amount) as amt from acc_tds_entries where book = $1 group by 1', [BOOK]);
  const M = {};
  const u = (k) => (M[k] ||= { av: 0, gst: 0, sdr: 0, un: 0, other: 0, k: 0, back: 0, sdrPaid: 0, refund: 0, tds: 0 });
  for (const r of rec) {
    const x = u(r.unit_no);
    if (r.payer_type === 'Other / earlier buyer') { x.other += n(r.amt); continue; }
    x.k += r.k; x[{ AV: 'av', GST: 'gst', SDR: 'sdr' }[r.ph] || 'un'] += n(r.amt);
  }
  for (const p of pay) {
    const x = u(p.unit_no);
    if (p.head === 'SDR') x.sdrPaid += n(p.amt);
    else if (p.head === 'Flat - Cancelled Refunded') x.refund += n(p.amt);
    else x.back += n(p.amt); // returned cheques and other money paid to the flat's ledger
  }
  for (const t of tds) u(t.unit_no).tds += n(t.amt);
  return M;
}

async function summary(projectId) {
  const [bk, M] = await Promise.all([bookings(projectId), booksByUnit()]);
  const seen = new Set();
  const rows = bk.map((b) => {
    seen.add(b.unit_no);
    const m = M[b.unit_no] || {};
    const books = r0((m.av || 0) + (m.gst || 0) + (m.sdr || 0) + (m.un || 0));
    const crm = r0(n(b.av) + n(b.gst) + n(b.sdr));
    const diff = books - crm;
    const state = !books && !crm ? 'Nothing received' : !books ? 'Only in the CRM' : !crm ? 'Only in the books' : Math.abs(diff) <= TOL ? 'Agrees' : diff > 0 ? 'More in the books' : 'More in the CRM';
    return { unit: b.unit_no, buyer: b.buyer || '', status: b.crm_status || '', av: r0(b.agreement_value),
      booksAv: r0(m.av), booksGst: r0(m.gst), booksSdr: r0(m.sdr), booksUn: r0(m.un), books, crmAv: r0(b.av), crmGst: r0(b.gst), crmSdr: r0(b.sdr), crm, diff,
      paidBack: r0(m.back), refund: r0(m.refund), other: r0(m.other), booksTds: r0(m.tds), crmTds: r0(b.tds), state };
  });
  // flats with money in the books but no live booking in the CRM
  for (const [unit, m] of Object.entries(M)) {
    if (seen.has(unit)) continue;
    const books = r0(m.av + m.gst + m.sdr + m.un);
    if (!books && !m.other && !m.back) continue;
    rows.push({ unit, buyer: '', status: 'No booking in the CRM', av: 0, booksAv: r0(m.av), booksGst: r0(m.gst), booksSdr: r0(m.sdr), booksUn: r0(m.un), books, crmAv: 0, crmGst: 0, crmSdr: 0, crm: 0,
      diff: books, paidBack: r0(m.back), refund: r0(m.refund), other: r0(m.other), booksTds: r0(m.tds), crmTds: 0, state: 'No booking in the CRM' });
  }
  const noUnit = await db.one(`select count(*)::int as k, coalesce(sum(amount), 0) as amt from acc_receipts where book = $1 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = '' and coalesce(cheque_status, '') <> 'Bounced'`, [BOOK]);
  const src = await db.one("select source, count(*)::int as k from acc_receipts where book = $1 group by 1 order by 2 desc limit 1", [BOOK]);
  const tot = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const by = {}; for (const r of rows) { const x = (by[r.state] ||= { n: 0, diff: 0 }); x.n++; x.diff += r.diff; }
  return { rows: rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), totals: { books: tot('books'), crm: tot('crm'), booksAv: tot('booksAv'), crmAv: tot('crmAv'), booksGst: tot('booksGst'), crmGst: tot('crmGst'),
    booksSdr: tot('booksSdr'), crmSdr: tot('crmSdr'), booksUn: tot('booksUn'), paidBack: tot('paidBack'), refund: tot('refund'), other: tot('other'), booksTds: tot('booksTds'), crmTds: tot('crmTds') },
  byState: by, noUnit: { k: noUnit.k, amt: r0(noUnit.amt) }, source: src ? src.source : null };
}

// One flat: every receipt on both sides, paired by amount (dates up to 7 days apart, then up to 45 days as "date differs").
async function detail(projectId, unit) {
  const b = (await bookings(projectId)).find((x) => x.unit_no === unit) || null;
  const books = (await db.q(`select id, ref_id, txn_date, bank, amount, payment_head, payer_name, payer_type, cheque_status, description, remark, source from acc_receipts
    where book = $1 and unit_no = $2 and coalesce(head, '') <> 'Internal transfer' order by txn_date, id`, [BOOK, unit]))
    .map((r) => ({ id: r.id, ref: r.ref_id, date: iso(r.txn_date), bank: r.bank, amount: n(r.amount), head: r.payment_head || 'Unclassified', payer: r.payer_name, other: r.payer_type === 'Other / earlier buyer', bounced: r.cheque_status === 'Bounced', desc: r.description, remark: r.remark }));
  const paid = (await db.q('select ref_id, txn_date, bank, amount, head, description, remark from acc_payments where book = $1 and unit_no = $2 order by txn_date, id', [BOOK, unit]))
    .map((p) => ({ ref: p.ref_id, date: iso(p.txn_date), bank: p.bank, amount: n(p.amount), head: p.head, desc: p.description, remark: p.remark }));
  const crm = b ? (await db.q(`select r.id, r.received_on, r.amount, r.mode, r.bank, r.instrument_no, r.status, r.note,
      coalesce((select sum(s.amount) from receipt_splits s where s.receipt_id = r.id and s.head = 'tds'), 0) as tds,
      (select string_agg(s.head || ' ' || s.amount::text, ', ' order by s.head) from receipt_splits s where s.receipt_id = r.id and s.amount > 0) as split
    from receipts r where r.booking_id = $1 order by r.received_on, r.id`, [b.id]))
    .map((r) => ({ id: r.id, date: iso(r.received_on), amount: n(r.amount) - n(r.tds), tds: n(r.tds), mode: r.mode, bank: r.bank, ref: r.instrument_no, status: r.status, split: r.split, note: r.note })) : [];
  // pair
  const L = books.filter((x) => !x.bounced && !x.other), C = crm.filter((x) => x.status === 'approved' && x.amount > 0);
  const usedC = new Set();
  for (const tol of [7, 45]) for (const x of L) {
    if (x.pair) continue;
    const hit = C.filter((c) => !usedC.has(c.id) && Math.abs(c.amount - x.amount) < 1 && Math.abs(dayDiff(c.date, x.date)) <= tol).sort((p, q) => Math.abs(dayDiff(p.date, x.date)) - Math.abs(dayDiff(q.date, x.date)))[0];
    if (hit) { usedC.add(hit.id); x.pair = hit.id; hit.pair = x.id; x.days = hit.days = dayDiff(hit.date, x.date); }
  }
  return { booking: b ? { unit, buyer: b.buyer, av: r0(b.agreement_value), status: b.crm_status } : { unit, buyer: '', av: 0, status: 'No booking in the CRM' }, books, paid, crm,
    unmatched: { books: L.filter((x) => !x.pair).length, crm: C.filter((c) => !c.pair).length } };
}

module.exports = { summary, detail };
