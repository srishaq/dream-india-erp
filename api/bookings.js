// Bookings. GET ?project=ID (list) or ?id=ID (one booking with its demands and receipts).
// POST {action}: create, approve, reject, register, edit (Head CRM), cancel-request, cancel-approve, cancel-reject,
//   transfer-request, transfer-approve, transfer-reject (a buyer moving to another flat; Head CRM approves).
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
    `select b.id, b.status, b.booking_date, b.agreement_value, b.registration_date, b.cancel_reason, b.cancel_requested_at, b.transfer_requested_at, b.sample,
            u.unit_no, u.id as unit_id, bl.code as building, b.crm_user_id, c.name as created_by_name, b.created_by, a.name as approved_by_name,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers,
            bb.demanded, bb.credit_av, bb.outstanding, bb.overdue, ${REG_NEXT}
       from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
       left join users c on c.id = b.created_by left join users a on a.id = b.approved_by
       left join booking_balances bb on bb.booking_id = b.id
      where u.project_id = $1 order by (b.status = 'pending') desc, (b.cancel_requested_at is null and b.transfer_requested_at is null), u.unit_no`, [projectId]);
}

// The registration checklist, in order. Challans come from the SDR register (Stamp duty page); "papers ready" is ticked
// by the CRM; the appointment and the registration date are on the booking.
const SDR_HAS = (kinds) => `exists (select 1 from sdr_challans s where (s.booking_id = b.id or (s.booking_id is null and s.project_id = u.project_id and upper(s.unit_no) = upper(u.unit_no)))
  and s.kind in (${kinds}) and s.status not in ('cancelled', 'refund_claimed'))`;
const REG_COLS = `${SDR_HAS("'stamp_duty', 'both'")} as reg_stamp, ${SDR_HAS("'registration', 'both'")} as reg_fee`;
const REG_NEXT = `case when b.registration_date is not null then null
  when not ${SDR_HAS("'stamp_duty', 'both'")} then 'Stamp duty challan'
  when not ${SDR_HAS("'registration', 'both'")} then 'Registration fee challan'
  when b.reg_papers_at is null then 'Papers ready'
  when b.registration_appointment is null then 'Book the appointment'
  else 'Register on the appointment day' end as reg_next`;
function regSteps(b, r) {
  const reg = !!b.registration_date; // registered: every step before it is done (older flats have no challan in the ERP)
  return [
    { key: 'stamp', label: 'Stamp duty challan', done: reg || !!r.reg_stamp, how: 'Made on the Stamp duty page (SDR register)' },
    { key: 'fee', label: 'Registration fee challan', done: reg || !!r.reg_fee, how: 'Made on the Stamp duty page (SDR register)' },
    { key: 'papers', label: 'Papers ready', done: reg || !!b.reg_papers_at, at: b.reg_papers_at, manual: true, how: 'Agreement draft, ID copies and photos of every buyer' },
    { key: 'appointment', label: 'Appointment booked', done: reg || !!b.registration_appointment, at: b.registration_appointment, how: 'Set the date under Edit dates' },
    { key: 'registered', label: 'Registered', done: !!b.registration_date, at: b.registration_date, how: 'Enter the registration date and number' },
  ];
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
  const transfer = b.transfer_to_unit_id || b.transferred_to || b.transferred_from ? await db.one(`select (select unit_no from units where id = $1) as to_unit,
      (select u2.unit_no from bookings b2 join units u2 on u2.id = b2.unit_id where b2.id = $2) as to_booking_unit, (select u3.unit_no from bookings b3 join units u3 on u3.id = b3.unit_id where b3.id = $3) as from_unit,
      (select name from users where id = $4) as requested_by`, [b.transfer_to_unit_id, b.transferred_to, b.transferred_from, b.transfer_requested_by]) : null;
  // what happened on this flat, newest first: the booking and its receipts and demands (for the flat file's History tab)
  const history = await db.q(`select a.at, a.action, a.entity, a.note, a.after, x.name as user_name from audit_log a left join users x on x.id = a.user_id
     where (a.entity = 'booking' and a.entity_id = $1::text) or (a.entity = 'receipt' and a.entity_id = any($2::text[])) or (a.entity = 'demand' and a.entity_id = any($3::text[]))
     order by a.at desc, a.id desc limit 150`, [String(b.id), receipts.map((r) => String(r.id)), demands.map((d) => String(d.id))]).catch(() => []);
  const rg = await db.one(`select ${REG_COLS} from bookings b join units u on u.id = b.unit_id where b.id = $1`, [id]).catch(() => ({}));
  const papersBy = b.reg_papers_by ? (await db.one('select name from users where id = $1', [b.reg_papers_by]))?.name : null;
  return { booking: b, unit, applicants, demands, receipts, balance, plan, cancellation, earlier, current, transfer, history, regSteps: regSteps(b, rg || {}), regPapersBy: papersBy };
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
      const pct = b.brokeragePct === '' || b.brokeragePct == null ? null : Number(b.brokeragePct);
      if (pct !== null && !(pct >= 0 && pct <= 20)) throw fail(400, 'Brokerage % looks wrong.');
      const brokerage = pct !== null ? Math.round(av * pct / 100) : b.brokerage === '' || b.brokerage == null ? null : toPaise(b.brokerage);
      if (brokerage !== null && !(brokerage >= 0)) throw fail(400, 'Brokerage looks wrong.');
      const id = await db.tx(async (t) => {
        const cur = await t.one('select status from units where id = $1 for update', [unit.id]);
        if (!['available', 'blocked'].includes(cur.status)) throw fail(409, `Unit ${unit.unit_no} is not available (${cur.status}).`);
        const firm = await require('../lib/cp').firmFor(t, { cpId: intOr(b.cpId), cpName: b.cpName, userId: u.id });
        const row = await t.one(
          `insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, parking, funding, loan_bank, source, cp_name, brokerage, rm_name, created_by, cp_id, brokerage_pct)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
          [unit.id, plan.id, bookingDate, rupees(av), gstRate, Math.max(intOr(b.parking, 0), 0), ['self', 'loan'].includes(b.funding) ? b.funding : null,
            str(b.loanBank, 80) || null, str(b.source, 80) || null, firm ? firm.name : str(b.cpName, 120) || null, brokerage === null ? null : rupees(brokerage), str(b.rmName, 80) || null, u.id,
            firm ? firm.id : null, pct !== null ? pct : brokerage && av ? Math.round((brokerage / av) * 100000) / 1000 : null]);
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
      // whoever changed the booking while it waited cannot also approve that change
      if (b.action === 'approve' && u.role !== 'admin' && await db.one("select 1 as x from audit_log where entity = 'booking' and entity_id = $1 and action = 'edit' and user_id = $2 limit 1", [String(bk.id), u.id]))
        throw fail(403, 'You changed this booking while it was waiting, so someone else must approve it.');
      // money already received on it: cancel it instead, so the refund is on record with Accounts
      if (b.action === 'reject' && await db.one("select 1 as x from receipts where booking_id = $1 and status in ('pending', 'approved') limit 1", [bk.id]))
        throw fail(409, 'Money has been received on this booking. Approve it and then cancel it, so the refund goes to the Cancelled flats register, or reverse the receipts first.');
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
      need('demand.raise'); // the CRM team, not Sales: this changes what the buyer owes
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

    // Changes to a booking after it was entered: only Head CRM (or Management / Admin), with a reason, every field's old
    // and new value in the audit log. A new agreement value or GST rate re-works the demands already raised.
    if (b.action === 'edit') {
      need('booking.approve');
      if (!['active', 'pending'].includes(bk.status)) throw fail(409, 'Only an active or pending booking can be edited.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Give the reason for the change.');
      const cur = await db.one('select * from bookings where id = $1', [bk.id]);
      const set = {};
      const money = (k, col, allowNull = true) => {
        if (!(k in b)) return;
        if ((b[k] === '' || b[k] == null) && allowNull) { set[col] = null; return; }
        const p = toPaise(b[k]); if (!(p >= 0)) throw fail(400, `${k} looks wrong.`); set[col] = rupees(p);
      };
      if ('bookingDate' in b) { const d = dateOr(b.bookingDate); if (!d || d > today()) throw fail(400, 'Booking date looks wrong.'); set.booking_date = d; }
      if ('agreementValue' in b) { const p = toPaise(b.agreementValue); if (!(p > 0)) throw fail(400, 'Enter the agreement value.'); set.agreement_value = rupees(p); }
      if ('gstRate' in b) { const g = Number(b.gstRate); if (!(g >= 0 && g <= 28)) throw fail(400, 'GST rate looks wrong.'); set.gst_rate = g; }
      if ('parking' in b) set.parking = Math.max(intOr(b.parking, 0), 0);
      if ('funding' in b) set.funding = ['self', 'loan'].includes(b.funding) ? b.funding : null;
      for (const [k, col, n] of [['loanBank', 'loan_bank', 80], ['source', 'source', 80], ['cpName', 'cp_name', 120], ['rmName', 'rm_name', 80]]) if (k in b) set[col] = str(b[k], n) || null;
      money('brokerage', 'brokerage'); money('devCharges', 'dev_charges');
      if ('brokeragePct' in b && b.brokeragePct !== '' && b.brokeragePct != null) {
        const pct = Number(b.brokeragePct); if (!(pct >= 0 && pct <= 20)) throw fail(400, 'Brokerage % looks wrong.');
        set.brokerage_pct = pct; set.brokerage = Math.round(Number(set.agreement_value ?? cur.agreement_value) * pct) / 100;
      }
      // a new agreement value keeps the brokerage at the same % (unless the brokerage itself was changed)
      if (set.agreement_value != null && !('brokerage' in b) && !('brokeragePct' in b) && cur.brokerage_pct != null && Number(set.agreement_value) !== Number(cur.agreement_value))
        set.brokerage = Math.round(Number(set.agreement_value) * Number(cur.brokerage_pct)) / 100;
      if ('brokerage' in b && !('brokeragePct' in b) && set.brokerage != null && Number(set.agreement_value ?? cur.agreement_value) > 0)
        set.brokerage_pct = Math.round((Number(set.brokerage) / Number(set.agreement_value ?? cur.agreement_value)) * 100000) / 1000;
      if ('cpId' in b || 'cpName' in b) {
        const f = await require('../lib/cp').firmFor(db, { cpId: intOr(b.cpId), cpName: b.cpName, userId: u.id });
        set.cp_id = f ? f.id : null; set.cp_name = f ? f.name : null;
      }
      const norm = (v) => (v == null || v === '' ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? String(Number(v)) : String(v).slice(0, 10) === String(v) ? String(v) : String(v));
      const changed = Object.keys(set).filter((c) => norm(cur[c]) !== norm(set[c]) && !(c === 'booking_date' && norm(cur[c]).slice(0, 10) === norm(set[c])));
      const people = Array.isArray(b.applicants) ? cleanApplicants(b.applicants) : null;
      if (people && !has(u, 'buyer.kyc')) throw fail(403, 'Your role cannot change buyer details.');
      if (!changed.length && !people) throw fail(400, 'Nothing was changed.');
      const before = Object.fromEntries(changed.map((c) => [c, cur[c]])), after = Object.fromEntries(changed.map((c) => [c, set[c]]));
      let redone = 0;
      await db.tx(async (t) => {
        if (changed.length) await t.q(`update bookings set ${changed.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [bk.id, ...changed.map((c) => set[c])]);
        if (changed.includes('agreement_value') || changed.includes('gst_rate')) {
          redone = (await t.q(`update demands d set amount = round(b.agreement_value * d.pct / 100, 2), gst = round(round(b.agreement_value * d.pct / 100, 2) * b.gst_rate / 100, 2)
            from bookings b where b.id = d.booking_id and d.booking_id = $1 and d.status = 'raised' and not d.opening returning d.id`, [bk.id])).length;
        }
        if (people) {
          const ex = await t.q('select ap.seq, y.* from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = $1 order by ap.seq', [bk.id]);
          before.applicants = ex.map((a) => ({ name: a.name, pan: a.pan, phone: a.phone, email: a.email }));
          for (let i = 0; i < people.length; i++) {
            const v = people[i], e = ex[i];
            if (e) await t.q('update buyers set name = $2, pan = $3, aadhaar = $4, phone = $5, email = $6, address = $7 where id = $1', [e.id, v.name, v.pan, v.aadhaar, v.phone, v.email, v.address]);
            else { const y = await t.one('insert into buyers (name, pan, aadhaar, phone, email, address) values ($1, $2, $3, $4, $5, $6) returning id', Object.values(v)); await t.q('insert into booking_applicants (booking_id, seq, buyer_id) values ($1, $2, $3)', [bk.id, i + 1, y.id]); }
          }
          for (const e of ex.slice(people.length)) await t.q('delete from booking_applicants where booking_id = $1 and seq = $2', [bk.id, e.seq]); // the buyer row stays on record
          after.applicants = people.map((a) => ({ name: a.name, pan: a.pan, phone: a.phone, email: a.email }));
        }
        await audit.record(t.q, { user: u, action: 'edit', entity: 'booking', entityId: bk.id, projectId: bk.project_id, before, after: { ...after, demandsReworked: redone }, note: reason });
      });
      return res.json({ ok: true, changed, demandsReworked: redone, ...(await detail(u, bk.id)) });
    }

    // the registration appointment to the buyer on WhatsApp (registration_appointment template): name, flat, date, time and place
    if (b.action === 'reg-wa') {
      if (!has(u, 'booking.create') && !has(u, 'demand.raise')) throw fail(403, 'Your role does not allow this.');
      if (!bk.registration_appointment) throw fail(400, 'Set the appointment date first (Edit dates).');
      const when = str(b.when, 120); if (!when) throw fail(400, 'Give the time and place.');
      const L = require('../lib/letters');
      const k = await db.one(`select u.unit_no, (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1) as names
          from units u where u.id = $2`, [bk.id, bk.unit_id]);
      const r = await L.waNotice({ bookingId: bk.id, kind: 'reg', userId: u.id, params: [k.names, k.unit_no, L.dmy(bk.registration_appointment), when] });
      if (r.skipped) throw fail(409, 'Not sent: ' + r.skipped + '.');
      await audit.record(db.q, { user: u, action: 'reg-whatsapp', entity: 'booking', entityId: bk.id, projectId: bk.project_id, after: { to: r.to, when } });
      return res.json({ ok: true, to: r.to });
    }

    if (b.action === 'reg.papers') {
      if (!has(u, 'booking.create') && !has(u, 'demand.raise')) throw fail(403, 'Your role does not allow this.');
      const on = !!b.ready;
      await db.tx(async (t) => {
        await t.q('update bookings set reg_papers_at = $2, reg_papers_by = $3 where id = $1', [bk.id, on ? new Date() : null, on ? u.id : null]);
        await log(t, 'reg-papers', { ready: on });
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

    if (b.action === 'transfer-request') {
      need('demand.raise'); // the CRM team, not Sales: this changes what the buyer owes
      if (bk.status !== 'active') throw fail(409, 'Only an active booking can be transferred.');
      if (bk.cancel_requested_at || bk.transfer_requested_at) throw fail(409, 'A cancellation or transfer is already waiting for approval.');
      const to = await db.one('select id, unit_no, status, project_id from units where id = $1', [intOr(b.toUnitId)]);
      if (!to || to.project_id !== bk.project_id) throw fail(400, 'Choose the new flat.');
      if (!['available', 'blocked'].includes(to.status) || to.id === bk.unit_id) throw fail(409, `Flat ${to.unit_no} is not available (${to.status}).`);
      const av = toPaise(b.agreementValue); if (!(av > 0)) throw fail(400, 'Enter the agreement value of the new flat.');
      const reason = str(b.reason, 400); if (!reason) throw fail(400, 'Give the reason for the transfer.');
      const date = dateOr(b.transferDate) || today();
      await db.tx(async (t) => {
        await t.q('update bookings set transfer_to_unit_id = $2, transfer_av = $3, transfer_reason = $4, transfer_date = $5, transfer_requested_by = $6, transfer_requested_at = now(), transfer_move_receipts = $7 where id = $1',
          [bk.id, to.id, rupees(av), reason, date, u.id, b.moveReceipts !== false]);
        await t.q("update units set status = 'blocked' where id = $1 and status = 'available'", [to.id]);
        await log(t, 'transfer-request', { to: to.unit_no, agreementValue: rupees(av), date, moveReceipts: b.moveReceipts !== false }, reason);
      });
      return res.json({ ok: true, ...(await detail(u, bk.id)) });
    }
    if (b.action === 'transfer-approve' || b.action === 'transfer-reject') {
      need('booking.approve');
      if (!bk.transfer_requested_at || bk.status !== 'active') throw fail(409, 'No transfer is waiting for approval.');
      notOwn(u, bk.transfer_requested_by);
      const to = await db.one('select id, unit_no, building_id from units where id = $1', [bk.transfer_to_unit_id]);
      if (b.action === 'transfer-reject') {
        await db.tx(async (t) => {
          await t.q('update bookings set transfer_to_unit_id = null, transfer_av = null, transfer_reason = null, transfer_date = null, transfer_requested_by = null, transfer_requested_at = null where id = $1', [bk.id]);
          await t.q("update units set status = 'available' where id = $1 and status = 'blocked' and not exists (select 1 from bookings x where x.unit_id = $1 and x.status in ('pending', 'active'))", [to.id]);
          await log(t, 'transfer-reject', { to: to.unit_no }, str(b.reason, 300) || null);
        });
        return res.json({ ok: true, ...(await detail(u, bk.id)) });
      }
      let newId, moved = 0;
      await db.tx(async (t) => {
        const cur = await t.one('select status from units where id = $1 for update', [to.id]);
        if (!['available', 'blocked'].includes(cur.status)) throw fail(409, `Flat ${to.unit_no} is no longer free (${cur.status}).`);
        const old = await t.one('select * from bookings where id = $1', [bk.id]);
        const nb = await t.one(`insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, parking, funding, loan_bank, source, cp_name, cp_id, brokerage_pct, brokerage, rm_name,
            status, created_by, approved_by, approved_at, transferred_from, crm_user_id, dev_charges)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $12::numeric is not null then round($4::numeric * $12::numeric / 100, 2) end, $13, 'active', $14, $15, now(), $16, $17, $18) returning id`,
        [to.id, old.plan_id, old.transfer_date || today(), old.transfer_av, old.gst_rate, old.parking, old.funding, old.loan_bank, old.source, old.cp_name, old.cp_id, old.brokerage_pct, old.rm_name,
          old.transfer_requested_by, u.id, old.id, old.crm_user_id, old.dev_charges]);
        newId = nb.id;
        await t.q('insert into booking_applicants (booking_id, seq, buyer_id) select $2, seq, buyer_id from booking_applicants where booking_id = $1', [old.id, newId]);
        // the old booking stays on record, as Transferred
        await t.q("update bookings set status = 'transferred', transferred_to = $2, cancelled_by = $3, cancelled_at = now(), cancel_reason = $4 where id = $1", [old.id, newId, u.id, 'Transferred to ' + to.unit_no + ': ' + (old.transfer_reason || '')]);
        await t.q("update demands set status = 'cancelled' where booking_id = $1 and status = 'raised'", [old.id]);
        await t.q("update units set status = 'available' where id = $1", [old.unit_id]);
        await t.q("update units set status = 'booked' where id = $1", [to.id]);
        if (old.transfer_move_receipts) moved = (await t.q("update receipts set booking_id = $2, moved_from_booking = $1 where booking_id = $1 and status in ('pending', 'approved') returning id", [old.id, newId])).length;
        // demands on the new flat: the booking stage, and every construction stage already completed in its building
        const days = await daysToPay(t), d0 = old.transfer_date || today();
        const first = await t.one('select name from plan_stages where plan_id = $1 order by seq limit 1', [old.plan_id]);
        await raise(t, { bookingId: newId, stageName: first.name, demandDate: d0, dueDate: addDays(d0, days) });
        const done = await t.q(`select s.name from stage_completions c join plan_stages s on s.name = c.stage_name and s.plan_id = $2 where c.building_id = $1 and s.construction_linked order by s.seq`, [to.building_id, old.plan_id]);
        for (const st of done) await raise(t, { bookingId: newId, stageName: st.name, demandDate: today(), dueDate: addDays(today(), days) });
        await log(t, 'transfer', { status: 'transferred', to: to.unit_no, newBooking: newId, receiptsMoved: moved }, old.transfer_reason);
      });
      await require('../lib/team').system('accounts', `Flat transfer approved: ${bk.unit_no} → ${to.unit_no} (same buyers). ${moved} receipt(s) moved to the new booking in the ERP. Please re-tag them to ${to.unit_no} in the Accounts registers and Tally.`, { bookingId: newId, needsAction: true });
      return res.json({ ok: true, newBooking: newId, receiptsMoved: moved, ...(await detail(u, bk.id)) });
    }

    if (b.action === 'cancel-request') {
      need('demand.raise'); // the CRM team, not Sales: this changes what the buyer owes
      if (bk.status !== 'active') throw fail(409, 'Only an active booking can be cancelled.');
      if (bk.cancel_requested_at || bk.transfer_requested_at) throw fail(409, 'A cancellation or transfer is already waiting for approval.');
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
              -- money the company holds: agreement value, GST and other charges. TDS went to the government and stamp duty /
              -- registration were paid for the buyer, so they are shown separately, not in the refund due.
              (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = b.id and r.status = 'approved' and s.head in ('av', 'gst', 'other')) as received,
              (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = b.id and r.status = 'approved' and s.head = 'tds') as tds,
              (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = b.id and r.status = 'approved' and s.head in ('stamp_duty', 'registration')) as sdr
            from bookings b join units u on u.id = b.unit_id where b.id = $1`, [bk.id]);
          const charges = Number(bk.cancel_charges) || 0, received = Number(x.received) || 0;
          const apart = [Number(x.tds) ? `TDS ₹${Number(x.tds).toLocaleString('en-IN')} (with the government)` : '', Number(x.sdr) ? `stamp duty and registration ₹${Number(x.sdr).toLocaleString('en-IN')}` : ''].filter(Boolean).join('; ');
          await t.q(`insert into acc_cancellations (booking_id, cancel_date, booking_date, unit_no, client, typology, area, cp, closing_manager, final_av, received, deduction, refund_due, refund_status, remark, created_by)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (booking_id) where booking_id is not null do nothing`,
          [bk.id, bk.cancel_date || today(), x.booking_date, x.unit_no, x.client, x.typology, x.carpet_sqft, x.cp_name, x.rm_name, x.agreement_value, received, charges, Math.max(0, received - charges),
            received - charges > 0 ? 'Pending' : 'Nothing to refund', `Cancelled in the ERP: ${bk.cancel_reason || ''}${apart ? '. Not in the refund due: ' + apart : ''}`.slice(0, 400), u.id]);
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
