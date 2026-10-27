// Collections follow-ups. GET ?project=ID → the shared work queue of buyers who owe money, with their last
// follow-up, promise to pay and next follow-up date. GET ?booking=ID → that buyer's history.
// POST {action:'add'} → log a call, WhatsApp, email, visit or note (CRM).
// POST {action:'email', bookingId, subject, message, nextDate?} → email the buyer from the ERP and log it as a follow-up.
//   Until the ERP is live (ERP_LIVE=1) the email goes ONLY to the test address in Letter settings.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { today } = require('../lib/demands');
const { toPaise, rupees } = require('../lib/money');
const { route, fail, str, intOr } = require('../lib/http');
const mailer = require('../lib/mailer');
const live = () => process.env.ERP_LIVE === '1';
const emails = (v) => String(v || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');

const KINDS = ['Call', 'WhatsApp', 'Email', 'Visit', 'Note'];
const OUTCOMES = ['Email sent', 'Promised to pay', 'Paid – proof to share', 'Loan disbursement pending', 'Asked to call later', 'Not reachable', 'Query / dispute', 'Other'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const mobile = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : null; };

// The email to a buyer: the dues as on today, then the CRM's own message. Logged as an Email follow-up.
async function draft(bk) {
  const bb = await db.one('select * from booking_balances where booking_id = $1', [bk.id]);
  const ap = await db.q('select y.name, y.email from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [bk.id]);
  const name = ap.map((a) => a.name).filter(Boolean).join(' & ') || 'Customer';
  const p = await db.one('select name from projects where id = $1', [bk.project_id]);
  const subject = `${p ? p.name : 'Your flat'} ${bk.unit_no}: payment due`;
  const message = `Dear ${name},\n\nAs per our records, ${inr(bb.overdue)} is overdue on your flat ${bk.unit_no}${Number(bb.gst_outstanding) > 1000 ? `, with GST of ${inr(bb.gst_outstanding)} still to be paid` : ''}. We request you to clear it at the earliest. If you have already paid, please reply with the payment details so we can update your account.\n\nFor any query, please reply to this email or call the CRM team.\n\nRegards,\nCRM Team`;
  return { to: [...new Set(ap.flatMap((a) => emails(a.email)))], name, subject, message, overdue: Number(bb.overdue), gst: Number(bb.gst_outstanding) };
}
async function sendEmail(u, b, res) {
  const bk = await bookingFor(u, intOr(b.bookingId));
  const d = await draft(bk);
  if (b.preview) return res.json({ ...d, to: d.to.map((e) => (has(u, 'buyer.kyc') ? e : e.replace(/^(.).*(@.*)$/, '$1•••$2'))), live: live(), configured: mailer.configured() });
  const subject = str(b.subject, 200) || d.subject, message = str(b.message, 5000) || d.message;
  const nextDate = DATE.test(b.nextDate || '') ? b.nextDate : null;
  if (nextDate && nextDate < today()) throw fail(400, 'The next follow-up date cannot be in the past.');
  if (!mailer.configured()) throw fail(409, 'Email is not set up yet (SMTP app password in Vercel), so nothing was sent.');
  let to = d.to, cc = [];
  const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  if (!live()) { to = emails(set.testEmail).slice(0, 1); if (!to.length) throw fail(409, 'This is the test version: set a test email address in Letter settings (Demand letters page). Emails go only there until the ERP is live.'); }
  else { if (!to.length) throw fail(400, `${bk.unit_no}: no email address on this booking. Add it on the booking first.`); cc = emails(set.cc); }
  const html = message.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const conn = await mailer.connect();
  try { await conn.send({ to, cc, subject: (live() ? '' : '[TEST] ') + subject, text: message, html }); } finally { await conn.close().catch(() => {}); }
  await db.tx(async (t) => {
    const r = await t.one("insert into follow_ups (booking_id, kind, outcome, note, next_date, created_by) values ($1, 'Email', 'Email sent', $2, $3, $4) returning id",
      [bk.id, `${live() ? '' : '[TEST to ' + to.join(', ') + '] '}${subject}`.slice(0, 1000), nextDate, u.id]);
    await audit.record(t.q, { user: u, action: 'email', entity: 'follow-up', entityId: r.id, projectId: bk.project_id, after: { unit: bk.unit_no, to: live() ? to : ['test'], subject } });
  });
  return res.json({ ok: true, to, test: !live() });
}

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
              (select string_agg(y.email, ',') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id and coalesce(y.email, '') <> '') as emails,
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
      r.hasEmail = emails(r.emails).length > 0;
      delete r.phone; delete r.emails;
    }
    const summary = { total: rows.length, due: rows.filter((r) => r.due).length, broken: rows.filter((r) => r.broken).length, never: rows.filter((r) => !r.count).length };
    return res.json({ rows, summary, kinds: KINDS, outcomes: OUTCOMES, asOf: now, mail: { configured: mailer.configured(), live: live() } });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'demand.raise'); if (!u) return;
    if (b.action === 'email') return sendEmail(u, b, res);
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
