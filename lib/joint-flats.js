// Jodi (joint) flats: one buyer family owns two flats side by side and pays for both together (Rafi Sir, 28 Nov 2026,
// Dream Aspire: 802-803, 1004-1005, 1405-1406, 2005-2006, 2101-2102). The ERP keeps a booking per flat, so
//  - one payment is entered once and split across the flats (in proportion to what each flat owes now, else to its
//    agreement value), one receipt per flat with the same UTR / cheque, which the bank statement matches on the total;
//  - Tally, which often keeps one ledger for both, is compared with the CRM on the pair together (Tally vs CRM).
const db = require('./db');

const r2 = (x) => Math.round(Number(x) * 100) / 100;

// the pairs of a project: [{ id, label, units: ['A-802', 'A-803'] }]
async function groups(projectId) {
  return db.q(`select g.id, g.label, array(select u.unit_no from joint_flat_units j join units u on u.id = j.unit_id where j.group_id = g.id order by u.unit_no) as units
    from joint_flats g where g.project_id = $1 order by g.id`, [projectId]).then((rows) => rows.map((r) => ({ ...r, units: arr(r.units) })));
}
const arr = (v) => (Array.isArray(v) ? v : String(v || '').replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '').trim()).filter(Boolean));

// the flats paid together with this booking's flat (itself included), with what each owes now; null when it is not a jodi flat
async function ofBooking(bookingId) {
  const g = await db.one(`select g.id, g.label from joint_flats g join joint_flat_units j on j.group_id = g.id join bookings b on b.unit_id = j.unit_id where b.id = $1`, [bookingId]);
  if (!g) return null;
  const flats = await db.q(`select b.id as booking_id, u.unit_no, b.agreement_value, b.gst_rate,
      (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyer,
      greatest(0, coalesce(bb.demanded, 0) + coalesce(bb.demanded_gst, 0) - coalesce(bb.received_av, 0) - coalesce(bb.received_gst, 0) - coalesce(bb.received_tds, 0)) as due
    from joint_flat_units j join units u on u.id = j.unit_id join bookings b on b.unit_id = u.id and b.status in ('active', 'pending')
    left join booking_balances bb on bb.booking_id = b.id where j.group_id = $1 order by u.unit_no`, [g.id]);
  return { id: g.id, label: g.label, flats: flats.map((f) => ({ bookingId: f.booking_id, unit: f.unit_no, buyer: f.buyer || '', av: Number(f.agreement_value) || 0, gstRate: Number(f.gst_rate) || 5, due: r2(f.due) })) };
}

// a total split over the flats: by what each owes now, else by agreement value; to the paisa, the last flat takes the rest
function split(total, flats) {
  total = r2(total);
  const dueSum = flats.reduce((a, f) => a + (f.due || 0), 0), avSum = flats.reduce((a, f) => a + (f.av || 0), 0);
  const w = (f) => (dueSum > 0 ? (f.due || 0) / dueSum : avSum > 0 ? (f.av || 0) / avSum : 1 / flats.length);
  let left = total;
  return flats.map((f, i) => { const amt = i === flats.length - 1 ? r2(left) : r2(total * w(f)); left = r2(left - amt); return { ...f, amount: amt }; });
}
// AV and GST inside one flat's part, at its GST rate
function avGst(amount, gstRate) { const av = r2(amount / (1 + (gstRate || 5) / 100)); return { av, gst: r2(amount - av) }; }

// two bookings in the same pair
async function samePair(bookingA, bookingB) {
  const r = await db.one(`select 1 as ok from joint_flat_units ja join bookings a on a.unit_id = ja.unit_id join joint_flat_units jb on jb.group_id = ja.group_id join bookings b on b.unit_id = jb.unit_id
    where a.id = $1 and b.id = $2`, [bookingA, bookingB]);
  return !!r;
}

module.exports = { groups, ofBooking, split, avGst, samePair };
