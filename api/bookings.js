// Bookings. GET ?project=ID (list) or ?id=ID (one booking with its demands and receipts).
// POST {action}: create, approve, reject, register, cancel-request, cancel-approve, cancel-reject.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor, notOwn } = require('../lib/access');
const { raise, daysToPay, addDays, today } = require('../lib/demands');
const { toPaise, rupees } = require('../lib/money');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const dateOr = (v) => (DATE.test(String(v || '')) ? String(v) : null);
const mask = (s, keep = 4) => (s ? '•'.repeat(Math.max(String(s).length - keep, 0)) + String(s).slice(-keep) : s);

async function list(projectId) {
  return db.q(
    `select b.id, b.status, b.booking_date, b.agreement_value, b.registration_date, b.cancel_reason, b.cancel_requested_at, b.sample,
            u.unit_no, u.id as unit_id, bl.code as building, c.name as created_by_name, b.created_by, a.name as approved_by_name,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers,
            bb.demanded, bb.credit_av, bb.outstanding, bb.overdue
       from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
       left join users c on c.id = b.created_by left join users a on a.id = b.approved_by
       left join booking_balances bb on bb.booking_id = b.id
      where u.project_id = $1 order by (b.status = 'pending') desc, b.cancel_requested_at is null, u.unit_no`, [projectId]);
}

async function detail(u, id) {
  const b = await bookingFor(u, id);
  const kyc = has(u, 'buyer.kyc');
  const applicants = (await db.q('select ap.seq, y.* from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = $1 order by ap.seq', [id]))
    .map((a) => (kyc ? a : { ...a, pan: mask(a.pan), aadhaar: mask(a.aadhaar), phone: mask(a.phone), email: a.email ? '(hidden)' : null, address: a.address ? '(hidden)' : null }));
  const demands = await db.q('select id, stage_name, pct, demand_date, due_date, amount, gst, status, opening from demands where booking_id = $1 order by demand_date, id', [id]);
  const receipts = await db.q(
    `select r.id, r.received_on, r.amount, r.mode, r.bank, r.instrument_no, r.status, r.note, r.reverse_reason, r.opening,
            coalesce(json_object_agg(s.head, s.amount) filter (where s.head is not null), '{}') as splits
       from receipts r left join receipt_splits s on s.receipt_id = r.id where r.booking_id = $1 group by r.id order by r.received_on, r.id`, [id]);
  const balance = await db.one('select * from booking_balances where booking_id = $1', [id]);
  const plan = await db.q('select seq, name, pct, construction_linked from plan_stages where plan_id = $1 order by seq', [b.plan_id]);
  const cancellation = b.status === 'cancelled' || b.cancel_requested_at ? await db.one(`select c.id, c.cancel_date, c.received, c.deduction, c.refund_due, c.refund_rtgs, c.refund_white, c.refund_status, x.name as cancelled_by_name
      from bookings bk left join acc_cancellations c on c.booking_id = bk.id left join users x on x.id = bk.cancelled_by where bk.id = $1`, [id]) : null;
  const earlier = await db.q(`select b2.id, b2.booking_date, b2.cancel_date, b2.cancelled_at, (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b2.id) as buyers,
      c.refund_status from bookings b2 left join acc_cancellations c on c.booking_id = b2.id where b2.unit_id = $1 and b2.id <> $2 and b2.status = 'cancelled' order by b2.cancelled_at`, [b.unit_id, id]);
  const unit = await db.one('select u.id, u.status, u.unit_no, u.floor, u.typology, u.carpet_sqft, bl.name as building, p.name as project, c.name as company from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id join companies c on c.id = p.company_id where u.id = $1', [b.unit_id]);
  const current = b.status === 'cancelled' ? await db.one(`select b2.id, (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b2.id) as buyers, b2.status
      from bookings b2 where b2.unit_id = $1 and b2.status in ('active', 'pending') limit 1`, [b.unit_id]) : null;
  return { booking: b, unit, applicants, demands, receipts, balance, plan, cancellation, earlier, current };
}

function cleanApplicants(list) {
  if (!Array.isArray(list) || !list.length || list.length > 3) throw fail(400, 'Enter one to three applicants.');
  return list.map((a, i) => {
    const v = { name: str(a.name, 120), pan: str(a.pan, 10).toUpperCase() || null, aadhaar: str(a.aadhaar, 14).replace(/\s/g, '') || null, phone: str(a.phone, 20) || null, email: str(a.email, 120) || null, address: str(a.address, 400) || null };
    if (!v.name) throw fail(400, `Applicant ${i + 1}: enter the name.`);
    if (v.pan && !PAN.test(v.pan)) throw fail(400, `Applicant ${i + 1}: PAN should look like ABCDE1234F.`);
    if (v.aadhaar && !/^\d{12}$/.test(v.aadhaar)) throw fail(400, `Applicant ${i + 1}: Aadhaar should be 12 digits.`);
    return v;
  });
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'inventory.view') && !has(u, 'ledger.view')) return res.status(403).json({ error: 'Your role does not allow this.' });
    if (req.query.id) return res.json(await detail(u, intOr(req.query.id)));
    return res.json({ rows: await list(needProject(u, intOr(req.query.project))) });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };

    if (b.action === 'create') {
      need('booking.create');
      const unit = await db.one('select id, project_id, status, unit_no from units where id = $1', [intOr(b.unitId)]);
      if (!unit) throw fail(404, 'Unit not found.');
      needProject(u, unit.project_id);
      const av = toPaise(b.agreementValue);
      if (!(av > 0)) throw fail(400, 'Enter the agreement value in rupees.');
      const bookingDate = dateOr(b.bookingDate); if (!bookingDate) throw fail(400, 'Enter the booking date.');
      if (bookingDate > today()) throw fail(400, 'The booking date cannot be in the future.');
      const plan = await db.one('select id from payment_plans where project_id = $1 and active and ($2::int is null or id = $2) order by id limit 1', [unit.project_id, intOr(b.planId)]);
      if (!plan) throw fail(400, 'This project has no active payment plan.');
      const gstRate = b.gstRate === '' || b.gstRate == null ? 5 : Number(b.gstRate);
      if (!(gstRate >= 0 && gstRate <= 28)) throw fail(400, 'GST rate looks wrong.');
      const people = cleanApplicants(b.applicants);
      const brokerage = b.brokerage === '' || b.brokerage == null ? null : toPaise(b.brokerage);
      if (brokerage !== null && !(brokerage >= 0)) throw fail(400, 'Brokerage looks wrong.');
      const id = await db.tx(async (t) => {
        const cur = await t.one('select status from units where id = $1 for update', [unit.id]);
        if (!['available', 'blocked'].includes(cur.status)) throw fail(409, `Unit ${unit.unit_no} is not available (${cur.status}).`);
        const row = await t.one(
          `insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, parking, funding, loan_bank, source, cp_name, brokerage, rm_name, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
          [unit.id, plan.id, bookingDate, rupees(av), gstRate, Math.max(intOr(b.parking, 0), 0), ['self', 'loan'].includes(b.funding) ? b.funding : null,
            str(b.loanBank, 80) || null, str(b.source, 80) || null, str(b.cpName, 120) || null, brokerage === null ? null : rupees(brokerage), str(b.rmName, 80) || null, u.id]);
        for (let i = 0; i < people.length; i++) {
          const y = await t.one('insert into buyers (name, pan, aadhaar, phone, email, address) values ($1, $2, $3, $4, $5, $6) returning id', Object.values(people[i]));
          await t.q('insert into booking_applicants (booking_id, seq, buyer_id) values ($1, $2, $3)', [row.id, i + 1, y.id]);
        }
        await t.q("update units set status = 'blocked' where id = $1", [unit.id]);
        await audit.record(t.q, { user: u, action: 'create', entity: 'booking', entityId: row.id, projectId: unit.project_id, after: { unit: unit.unit_no, agreementValue: rupees(av), bookingDate, buyers: people.map((p) => p.name) } });
        return row.id;
      });
      return res.json({ ok: true, id });
    }

    const bk = await bookingFor(u, intOr(b.id));
    const log = (t, action, after, note) => audit.record(t.q, { user: u, action, entity: 'booking', entityId: bk.id, projectId: bk.project_id, before: { status: bk.status }, after, note });

    if (b.action === 'approve' || b.action === 'reject') {
      need('booking.approve');
      if (bk.status !== 'pending') throw fail(409, 'This booking is not waiting for approval.');
      notOwn(u, bk.created_by);
      await db.tx(async (t) => {
        if (b.action === 'approve') {
          await t.q("update bookings set status = 'active', approved_by = $2, approved_at = now() where id = $1", [bk.id, u.id]);
          await t.q("update units set status = 'booked' where id = $1", [bk.unit_id]);
          const first = await t.one('select name from plan_stages where plan_id = $1 order by seq limit 1', [bk.plan_id]);
          const days = await daysToPay(t);
          const d = await raise(t, { bookingId: bk.id, stageName: first.name, demandDate: bk.booking_date, dueDate: addDays(bk.booking_date, days) });
          // A late booking also owes every construction stage already completed in its building.
          const done = await t.q(
            `select s.name from stage_completions c join plan_stages s on s.name = c.stage_name and s.plan_id = $2
              where c.building_id = $1 and s.construction_linked order by s.seq`, [bk.building_id, bk.plan_id]);
          const now = today();
          for (const s of done) await raise(t, { bookingId: bk.id, stageName: s.name, demandDate: now, dueDate: addDays(now, days) });
          await log(t, 'approve', { status: 'active', demand: d, catchUp: done.map((s) => s.name) });
        } else {
          await t.q("update bookings set status = 'rejected', approved_by = $2, approved_at = now() where id = $1", [bk.id, u.id]);
          await t.q("update units set status = 'available' where id = $1", [bk.unit_id]);
          await log(t, 'reject', { status: 'rejected' }, str(b.reason, 300) || null);
        }
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }

    if (b.action === 'register') {
      need('booking.create');
      if (bk.status !== 'active') throw fail(409, 'Only an approved booking can be registered.');
      const agreementDate = dateOr(b.agreementDate), registrationDate = dateOr(b.registrationDate);
      if (!registrationDate) throw fail(400, 'Enter the registration date.');
      if (registrationDate > today()) throw fail(400, 'The registration date cannot be in the future.');
      const sd = b.stampDuty === '' || b.stampDuty == null ? null : toPaise(b.stampDuty), rf = b.registrationFee === '' || b.registrationFee == null ? null : toPaise(b.registrationFee);
      if ((sd !== null && !(sd >= 0)) || (rf !== null && !(rf >= 0))) throw fail(400, 'Stamp duty or registration fee looks wrong.');
      await db.tx(async (t) => {
        await t.q('update bookings set agreement_date = coalesce($2, agreement_date), registration_date = $3, stamp_duty = $4, registration_fee = $5 where id = $1',
          [bk.id, agreementDate, registrationDate, sd === null ? null : rupees(sd), rf === null ? null : rupees(rf)]);
        await t.q("update units set status = 'registered' where id = $1", [bk.unit_id]);
        const second = await t.one('select name from plan_stages where plan_id = $1 and not construction_linked order by seq offset 1 limit 1', [bk.plan_id]);
        const d = second ? await raise(t, { bookingId: bk.id, stageName: second.name, demandDate: registrationDate, dueDate: addDays(registrationDate, await daysToPay(t)) }) : null;
        await log(t, 'register', { agreementDate, registrationDate, demand: d });
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }

    if (b.action === 'dates') {
      if (!has(u, 'booking.create') && !has(u, 'demand.raise')) throw fail(403, 'Your role does not allow this.');
      const FIELDS = { registrationAppointment: 'registration_appointment', possessionDate: 'possession_date', bookingFormDate: 'booking_form_date', bankNocDate: 'bank_noc_date' };
      const set = {}, before = {};
      for (const [k, col] of Object.entries(FIELDS)) if (k in b) { if (b[k] && !DATE.test(b[k])) throw fail(400, 'A date looks wrong.'); set[col] = b[k] || null; before[col] = bk[col]; }
      if ('registrationStatus' in b) { set.registration_status = str(b.registrationStatus, 60) || null; before.registration_status = bk.registration_status; }
      if ('crmStatus' in b) { set.crm_status = str(b.crmStatus, 60) || null; before.crm_status = bk.crm_status; }
      const cols = Object.keys(set);
      if (!cols.length) throw fail(400, 'Nothing to change.');
      await db.tx(async (t) => {
        await t.q(`update bookings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [bk.id, ...cols.map((c) => set[c])]);
        await log(t, 'dates', set);
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }

    if (b.action === 'cancel-request') {
      need('booking.create');
      if (bk.status !== 'active') throw fail(409, 'Only an active booking can be cancelled.');
      if (bk.cancel_requested_at) throw fail(409, 'A cancellation is already waiting for approval.');
      const reason = str(b.reason, 400); if (!reason) throw fail(400, 'Give the reason for cancelling.');
      const cdate = dateOr(b.cancelDate) || today();
      if (cdate < String(bk.booking_date).slice(0, 10)) throw fail(400, 'The cancellation date is before the booking date.');
      const charges = b.charges === '' || b.charges == null ? 0 : Number(String(b.charges).replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(charges) || charges < 0) throw fail(400, 'Cancellation charges must be a number, or 0.');
      await db.tx(async (t) => {
        await t.q('update bookings set cancel_reason = $2, cancel_requested_by = $3, cancel_requested_at = now(), cancel_date = $4, cancel_charges = $5 where id = $1', [bk.id, reason, u.id, cdate, charges]);
        await log(t, 'cancel-request', { reason, cancelDate: cdate, charges });
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }
    if (b.action === 'cancel-approve' || b.action === 'cancel-reject') {
      need('cancellation.approve');
      if (!bk.cancel_requested_at || bk.status !== 'active') throw fail(409, 'No cancellation is waiting for approval.');
      notOwn(u, bk.cancel_requested_by);
      await db.tx(async (t) => {
        if (b.action === 'cancel-approve') {
          await t.q("update bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now() where id = $1", [bk.id, u.id]);
          await t.q("update demands set status = 'cancelled' where booking_id = $1 and status = 'raised'", [bk.id]);
          await t.q("update units set status = 'available' where id = $1", [bk.unit_id]);
          // the old buyer and their money stay on record: one row in Accounts' Cancelled flats register, linked to this booking
          const x = await t.one(`select u.unit_no, u.typology, u.carpet_sqft, b.booking_date, b.agreement_value, b.cp_name, b.rm_name,
              (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as client,
              (select coalesce(sum(r.amount), 0) from receipts r where r.booking_id = b.id and r.status = 'approved') as received
            from bookings b join units u on u.id = b.unit_id where b.id = $1`, [bk.id]);
          const charges = Number(bk.cancel_charges) || 0, received = Number(x.received) || 0;
          await t.q(`insert into acc_cancellations (booking_id, cancel_date, booking_date, unit_no, client, typology, area, cp, closing_manager, final_av, received, deduction, refund_due, refund_status, remark, created_by)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (booking_id) where booking_id is not null do nothing`,
          [bk.id, bk.cancel_date || today(), x.booking_date, x.unit_no, x.client, x.typology, x.carpet_sqft, x.cp_name, x.rm_name, x.agreement_value, received, charges, Math.max(0, received - charges),
            received - charges > 0 ? 'Pending' : 'Nothing to refund', `Cancelled in the ERP: ${bk.cancel_reason || ''}`.slice(0, 400), u.id]);
          await log(t, 'cancel', { status: 'cancelled', reason: bk.cancel_reason, received, charges, refundDue: Math.max(0, received - charges) }, 'Buyer and receipts stay on record; written to the Cancelled flats register for the refund');
        } else {
          await t.q('update bookings set cancel_reason = null, cancel_requested_by = null, cancel_requested_at = null where id = $1', [bk.id]);
          await log(t, 'cancel-reject', { reason: bk.cancel_reason });
        }
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }
    throw fail(400, 'Unknown action.');
  },
});
