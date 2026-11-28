// Customer ledgers. GET ?project=ID → every live booking with what is demanded, received, outstanding and
// overdue (with days overdue, oldest unpaid demand first). GET ?booking=ID → statement of account.
const db = require('../lib/db');
const auth = require('../lib/auth');
const { needProject, bookingFor } = require('../lib/access');
const { today } = require('../lib/demands');
const { toPaise, rupees } = require('../lib/money');
const { route, intOr } = require('../lib/http');

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// Oldest demand not yet covered by AV + TDS received, if it is past its due date.
function oldestUnpaid(demands, creditPaise, now) {
  let left = creditPaise;
  for (const d of demands) {
    const amt = toPaise(d.amount);
    if (left >= amt) { left -= amt; continue; }
    return d.due_date < now ? { since: d.due_date, days: daysBetween(d.due_date, now), stage: d.stage_name } : null;
  }
  return null;
}
const bucket = (days) => (days == null ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ledger.view'); if (!u) return;
    const now = today();
    if (req.query.booking) {
      const bk = await bookingFor(u, intOr(req.query.booking));
      // a jodi flat: one ledger for the pair (Rafi Sir, 28 Nov 2026: "one single entity"), demands of both flats, each
      // payment once
      const jg = await require('../lib/joint-flats').ofBooking(bk.id);
      const ids = jg ? jg.flats.map((f) => f.bookingId) : [bk.id];
      const unitOf = Object.fromEntries((jg ? jg.flats : []).map((f) => [f.bookingId, f.unit]));
      const demands = await db.q("select booking_id, demand_date as date, due_date, stage_name, pct, amount, gst from demands where booking_id = any($1::int[]) and status = 'raised' order by demand_date, id", [ids]);
      const receipts = await db.q(
        `select min(r.received_on) as date, min(r.id) as id, min(r.mode) as mode, min(r.bank) as bank, min(r.instrument_no) as instrument_no,
                coalesce(json_object_agg(s.head, s.amount), '{}') as splits_raw, json_agg(json_build_object('h', s.head, 'a', s.amount)) as sp
           from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = any($1::int[]) and r.status = 'approved'
          group by coalesce(r.joint_key, r.id::text) order by 1, 2`, [ids]);
      for (const r of receipts) { const t = {}; for (const x of r.sp) t[x.h] = rupees(toPaise(t[x.h]) + toPaise(x.a)); r.splits = t; }
      const lines = [
        ...demands.map((d) => ({ date: d.date, kind: 'demand', text: `${jg ? unitOf[d.booking_id] + ': ' : ''}${d.stage_name} (${Number(d.pct)}%)`, due: d.due_date, debit: d.amount, gstDebit: d.gst })),
        ...receipts.map((r) => {
          const s = r.splits, credit = toPaise(s.av) + toPaise(s.tds);
          const parts = [s.av && 'AV', s.tds && 'TDS', s.gst && 'GST', (s.stamp_duty || s.registration) && 'stamp duty / registration'].filter(Boolean).join(', ');
          return { date: r.date, kind: 'receipt', text: `Receipt #${r.id}: ${[r.bank, r.instrument_no].filter(Boolean).join(' ') || r.mode} (${parts})`, credit: rupees(credit), gstCredit: s.gst || '0.00', other: rupees(toPaise(s.stamp_duty) + toPaise(s.registration) + toPaise(s.other)) };
        }),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'demand' ? -1 : 1));
      let bal = 0, gbal = 0;
      for (const l of lines) {
        bal += toPaise(l.debit) - toPaise(l.credit); gbal += toPaise(l.gstDebit) - toPaise(l.gstCredit);
        l.balance = rupees(bal); l.gstBalance = rupees(gbal);
      }
      let balance = await db.one('select * from booking_balances where booking_id = $1', [bk.id]);
      if (jg) { const bs = await db.q('select * from booking_balances where booking_id = any($1::int[])', [ids]); balance = { ...balance }; for (const k of Object.keys(balance)) if (k !== 'booking_id' && bs.every((x) => x[k] == null || !isNaN(Number(x[k])))) balance[k] = rupees(bs.reduce((a, x) => a + toPaise(x[k]), 0)); }
      const head = await db.one(
        `select u.unit_no, u.typology, u.carpet_sqft, bl.name as building, p.name as project, c.name as company, p.rera_no,
                (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = $1) as buyers
           from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id join companies c on c.id = p.company_id where b.id = $1`, [bk.id]);
      const allDemands = await db.q("select due_date, stage_name, amount from demands where booking_id = any($1::int[]) and status = 'raised' order by due_date, id", [ids]);
      if (jg) { head.unit_no = jg.flats.map((f) => f.unit).join(' + '); head.buyers = [...new Set(jg.flats.map((f) => f.buyer).filter(Boolean))].join(' / '); }
      return res.json({ booking: { id: bk.id, status: bk.status, booking_date: bk.booking_date, agreement_value: jg ? rupees(jg.flats.reduce((a, f) => a + toPaise(f.av), 0)) : bk.agreement_value, registration_date: bk.registration_date, jodi: jg ? jg.flats.map((f) => f.unit) : null }, head, lines, balance, oldest: oldestUnpaid(allDemands, toPaise(balance.credit_av), now), asOf: now });
    }

    const projectId = needProject(u, intOr(req.query.project));
    const rows = await db.q(
      `select bb.*, b.booking_date, u.unit_no, bl.code as building, b.sample,
              (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers,
              (select y.phone from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id order by ap.seq limit 1) as phone
         from booking_balances bb join bookings b on b.id = bb.booking_id join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
        where u.project_id = $1 and b.status = 'active' order by u.unit_no`, [projectId]);
    const demands = await db.q(
      `select d.booking_id, d.due_date, d.stage_name, d.amount from demands d join bookings b on b.id = d.booking_id join units u on u.id = b.unit_id
        where u.project_id = $1 and d.status = 'raised' order by d.due_date, d.id`, [projectId]);
    const byBooking = new Map();
    for (const d of demands) { if (!byBooking.has(d.booking_id)) byBooking.set(d.booking_id, []); byBooking.get(d.booking_id).push(d); }
    const ageing = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const totals = { bookings: rows.length, agreementValue: 0, demanded: 0, received: 0, outstanding: 0, overdue: 0, advance: 0, gstOutstanding: 0 };
    for (const r of rows) {
      const o = oldestUnpaid(byBooking.get(r.booking_id) || [], toPaise(r.credit_av), now);
      r.days_overdue = o ? o.days : null;
      r.oldest_stage = o ? o.stage : null;
      r.bucket = toPaise(r.overdue) > 0 ? bucket(r.days_overdue) : 'current';
      ageing[r.bucket] += toPaise(r.overdue);
      totals.agreementValue += toPaise(r.agreement_value); totals.demanded += toPaise(r.demanded); totals.received += toPaise(r.credit_av);
      totals.outstanding += toPaise(r.outstanding); totals.overdue += toPaise(r.overdue); totals.advance += toPaise(r.advance); totals.gstOutstanding += toPaise(r.gst_outstanding);
      r.phone = r.phone ? '•••••' + String(r.phone).slice(-4) : null;
    }
    for (const k of Object.keys(totals)) if (k !== 'bookings') totals[k] = rupees(totals[k]);
    // a jodi pair is one row (one buyer family, one payment): figures added up, the longest overdue kept
    const skip = new Set(['booking_id', 'booking_date', 'unit_no', 'building', 'sample', 'buyers', 'phone', 'days_overdue', 'oldest_stage', 'bucket', 'last_demand', 'last_receipt']);
    const sumK = rows.length ? Object.keys(rows[0]).filter((k) => !skip.has(k) && rows.every((r) => r[k] == null || (typeof r[k] !== 'boolean' && !isNaN(Number(r[k]))))) : [];
    const pre = new Map(rows.map((r) => [r.unit_no, r]));
    let merged = await require('../lib/joint-flats').mergeRows(projectId, rows, { sum: sumK, join: ['buyers'] });
    merged = merged.map((m) => { if (!m.jodi) return m; const ps = m.jodi_units.map((x) => pre.get(x)).filter(Boolean); const w = ps.slice().sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0))[0];
      return { ...m, ...Object.fromEntries(sumK.map((k) => [k, rupees(Math.round(Number(m[k]) * 100))])), days_overdue: w.days_overdue, oldest_stage: w.oldest_stage, bucket: w.bucket }; });
    totals.bookings = merged.length;
    for (const k of Object.keys(ageing)) ageing[k] = rupees(ageing[k]);
    return res.json({ rows: merged, totals, ageing, asOf: now });
  },
});
