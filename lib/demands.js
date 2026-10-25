// Raising a demand: agreement value x stage %, GST at the booking's rate. A stage is demanded
// once per booking (unique index), so repeating a run never charges a buyer twice.
async function raise(t, { bookingId, stageName, demandDate, dueDate, runId = null, opening = false }) {
  const rows = await t.q(
    `insert into demands (booking_id, run_id, stage_name, pct, demand_date, due_date, amount, gst, opening)
     select b.id, $2, s.name, s.pct, $3, $4,
            round(b.agreement_value * s.pct / 100, 2),
            round(round(b.agreement_value * s.pct / 100, 2) * b.gst_rate / 100, 2), $5
       from bookings b join plan_stages s on s.plan_id = b.plan_id and s.name = $6
      where b.id = $1
     on conflict (booking_id, stage_name) do nothing
     returning id, amount, gst`,
    [bookingId, runId, demandDate, dueDate, opening, stageName]);
  return rows[0] || null;
}

async function daysToPay(t) {
  const r = await t.one("select value from settings where key = 'days_to_pay'");
  return r ? Number(r.value) : 15;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date

module.exports = { raise, daysToPay, addDays, today };
