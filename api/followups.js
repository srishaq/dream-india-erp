// Collections follow-ups. GET ?project=ID → the shared work queue of buyers who owe money, with their last
// follow-up, promise to pay and next follow-up date. GET ?booking=ID → that buyer's history.
// POST {action:'add'} → log a call, WhatsApp, email, visit or note (CRM).
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { today } = require('../lib/demands');
const { toPaise, rupees } = require('../lib/money');
const { route, fail, str, intOr } = require('../lib/http');

const KINDS = ['Call', 'WhatsApp', 'Email', 'Visit', 'Note'];
const OUTCOMES = ['Promised to pay', 'Paid – proof to share', 'Loan disbursement pending', 'Asked to call later', 'Not reachable', 'Query / dispute', 'Other'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const mobile = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : null; };

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ledger.view'); if (!u) return;
    const fullPhone = has(u, 'buyer.kyc');
    if (req.query.booking) {
      await bookingFor(u, intOr(req.query.booking));
      const rows = await db.q('select f.*, x.name as by_name from follow_ups f left join users x on x.id = f.created_by where f.booking_id = $1 order by f.created_at desc', [intOr(req.query.booking)]);
      return res.json({ rows, kinds: KINDS, outcomes: OUTCOMES });
    }
    const projectId = needProject(u, intOr(req.query.project));
    const now = today();
    const rows = await db.q(
      `select b.id as booking_id, u.unit_no, bb.outstanding, bb.overdue, bb.gst_outstanding, bb.last_receipt,
              (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers,
              (select y.phone from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as phone,
              f.kind, f.outcome, f.note, f.created_at as last_at, f.next_date, f.promise_date, f.promise_amount, x.name as last_by,
              (select count(*)::int from follow_ups z where z.booking_id = b.id) as count,
              (select max(l.sent_at) from demand_letters l where l.booking_id = b.id) as last_letter
         from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
         left join lateral (select * from follow_ups z where z.booking_id = b.id order by z.created_at desc limit 1) f on true
         left join users x on x.id = f.created_by
        where u.project_id = $1 and b.status = 'active' and bb.overdue + bb.gst_outstanding > 0
        order by bb.overdue desc`, [projectId]);
    for (const r of rows) {
      // A promise is broken when its date has passed and nothing was received after the follow-up that recorded it.
      r.broken = !!(r.promise_date && r.promise_date < now && (!r.last_receipt || r.last_receipt < r.last_at.slice(0, 10)));
      r.due = !r.next_date || r.next_date <= now;
      const m = mobile(r.phone);
      r.mobile = m ? (fullPhone ? m : '•••••' + m.slice(-4)) : null;
      r.wa = m && fullPhone ? `https://wa.me/91${m}` : null;
      delete r.phone;
    }
    const summary = { total: rows.length, due: rows.filter((r) => r.due).length, broken: rows.filter((r) => r.broken).length, never: rows.filter((r) => !r.count).length };
    return res.json({ rows, summary, kinds: KINDS, outcomes: OUTCOMES, asOf: now });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'demand.raise'); if (!u) return;
    if (b.action !== 'add') throw fail(400, 'Unknown action.');
    const bk = await bookingFor(u, intOr(b.bookingId));
    const kind = KINDS.includes(b.kind) ? b.kind : null; if (!kind) throw fail(400, 'Choose call, WhatsApp, email, visit or note.');
    const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : null; if (!outcome) throw fail(400, 'Choose the outcome.');
    const now = today();
    const promiseDate = DATE.test(b.promiseDate || '') ? b.promiseDate : null;
    const nextDate = DATE.test(b.nextDate || '') ? b.nextDate : null;
    if (outcome === 'Promised to pay' && !promiseDate) throw fail(400, 'Enter the date they promised to pay.');
    if (promiseDate && promiseDate < now) throw fail(400, 'The promise date cannot be in the past.');
    if (nextDate && nextDate < now) throw fail(400, 'The next follow-up date cannot be in the past.');
    const amt = b.promiseAmount === '' || b.promiseAmount == null ? null : toPaise(b.promiseAmount);
    if (amt !== null && !(amt > 0)) throw fail(400, 'The promised amount looks wrong.');
    await db.tx(async (t) => {
      const r = await t.one('insert into follow_ups (booking_id, kind, outcome, note, promise_date, promise_amount, next_date, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [bk.id, kind, outcome, str(b.note, 1000) || null, promiseDate, amt === null ? null : rupees(amt), nextDate, u.id]);
      await audit.record(t.q, { user: u, action: 'create', entity: 'follow-up', entityId: r.id, projectId: bk.project_id, after: { unit: bk.unit_no, kind, outcome, promiseDate, nextDate } });
    });
    return res.json({ ok: true });
  },
});
