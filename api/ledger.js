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
      const demands = await db.q("select demand_date as date, due_date, stage_name, pct, amount, gst from demands where booking_id = $1 and status = 'raised' order by demand_date, id", [bk.id]);
      const receipts = await db.q(
        `select r.received_on as date, r.id, r.mode, r.bank, r.instrument_no, coalesce(json_object_agg(s.head, s.amount), '{}') as splits
           from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = $1 and r.status = 'approved' group by r.id order by r.received_on, r.id`, [bk.id]);
      const lines = [
        ...demands.map((d) => ({ date: d.date, kind: 'demand', text: `${d.stage_name} (${Number(d.pct)}%)`, due: d.due_date, debit: d.amount, gstDebit: d.gst })),
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
      const balance = await db.one('select * from booking_balances where booking_id = $1', [bk.id]);
      const head = await db.one(
        `select u.unit_no, u.typology, u.carpet_sqft, bl.name as building, p.name as project, c.name as company, p.rera_no,
                (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = $1) as buyers
           from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id join companies c on c.id = p.company_id where b.id = $1`, [bk.id]);
      const allDemands = await db.q("select due_date, stage_name, amount from demands where booking_id = $1 and status = 'raised' order by due_date, id", [bk.id]);
      return res.json({ booking: { id: bk.id, status: bk.status, booking_date: bk.booking_date, agreement_value: bk.agreement_value, registration_date: bk.registration_date }, head, lines, balance, oldest: oldestUnpaid(allDemands, toPaise(balance.credit_av), now), asOf: now });
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
    for (const k of Object.keys(ageing)) ageing[k] = rupees(ageing[k]);
    return res.json({ rows, totals, ageing, asOf: now });
  },
});
