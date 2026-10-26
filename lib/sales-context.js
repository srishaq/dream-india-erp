// What the sales documents need about a booking: unit, project, buyers, receipts and the payment plan.
const db = require('./db');
const costsheet = require('./costsheet');

async function signedFor() {
  const r = await db.one("select value from settings where key = 'letters'");
  return (r && r.value && r.value.signedFor) || 'M/s. PRIME REALTORS';
}

async function bookingContext(bookingId) {
  const b = await db.one('select * from bookings where id = $1', [bookingId]);
  const unit = await db.one(`select u.unit_no, u.floor, u.typology, u.carpet_sqft, u.carpet_sqm, u.project_id, bl.name as building, p.name as project, p.rera_no, c.name as company
                               from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id join companies c on c.id = p.company_id where u.id = $1`, [b.unit_id]);
  const applicants = await db.q('select y.name, y.pan, y.aadhaar, y.phone, y.email, y.address from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [bookingId]);
  const plan = await db.q('select seq, name, pct from plan_stages where plan_id = $1 order by seq', [b.plan_id]);
  const receipts = await db.q("select received_on, amount, bank, instrument_no, mode from receipts where booking_id = $1 and status in ('approved', 'pending') order by received_on, id", [bookingId]);
  const bal = await db.one('select * from booking_balances where booking_id = $1', [bookingId]);
  const demanded = await db.one("select count(*)::int as n from demands where booking_id = $1 and status = 'raised'", [bookingId]);
  return {
    booking: b, unit, applicants, receipts, plan, project: unit.project, rera: unit.rera_no, company: unit.company,
    received: Number(bal ? bal.credit_av : 0), demandedCount: demanded.n, cost: costsheet.fromBooking(b, unit, plan), signedFor: await signedFor(), rmName: b.rm_name,
  };
}

module.exports = { bookingContext, signedFor };
