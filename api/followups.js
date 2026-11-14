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

// The standard email to a buyer (lib/buyer-mail.js): greeting with each buyer's salutation, the chosen template's
// text (editable), the sender's fixed signature. Logged in the buyer's Communication record and as an Email follow-up.
// What can go with it as PDFs (14 Nov 2026): the flat's demand letters and its approved payment receipts.
async function attachables(bookingId) {
  const letters = await db.q("select id, letter_type, letter_date, due_date, figures->>'total' as total from demand_letters where booking_id = $1 order by letter_date desc, id desc limit 12", [bookingId]);
  const receipts = await db.q("select id, received_on, amount, receipt_no, instrument_no from receipts where booking_id = $1 and status = 'approved' order by received_on, id", [bookingId]);
  return { letters, receipts };
}
async function attachFiles(u, bookingId, letterIds, receiptIds) {
  const ids = (x) => (Array.isArray(x) ? x : []).map((v) => intOr(v)).filter(Boolean).slice(0, 40);
  const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  const { buildLetter, buildReceipt } = require('../lib/demand-letter');
  const out = [];
  for (const l of await db.q('select id, letter_type, figures from demand_letters where booking_id = $1 and id = any($2::int[]) order by letter_date, id', [bookingId, ids(letterIds)]))
    out.push({ filename: safe(`${l.figures.unit}_${l.letter_type}_${l.id}.pdf`), type: 'application/pdf', content: buildLetter(l.figures) });
  const rm = require('../lib/receipt-mail');
  for (const r of await db.q("select id from receipts where booking_id = $1 and status = 'approved' and id = any($2::int[]) order by received_on, id", [bookingId, ids(receiptIds)])) {
    const f = await rm.receiptFigures(u, r.id);
    out.push({ filename: safe(`Receipt_${f.doc.receiptNo}_${f.doc.unit}.pdf`), type: 'application/pdf', content: buildReceipt(f.doc) });
  }
  return out;
}

async function sendEmail(u, b, res) {
  const bm = require('../lib/buyer-mail');
  const bk = await bookingFor(u, intOr(b.bookingId));
  const x = await bm.context(bk.id);
  const sig = await bm.signature(u);
  const toAll = [...new Set(x.people.flatMap((p) => emails(p.email)))];
  if (b.preview) return res.json({ people: x.people.map((p) => ({ id: p.id, name: p.name, salutation: p.salutation })), salutations: bm.SALUTATIONS, templates: bm.templates(x), signature: sig,
    to: toAll.map((e) => (has(u, 'buyer.kyc') ? e : e.replace(/^(.).*(@.*)$/, '$1•••$2'))), live: live(), configured: mailer.configured(), unit: x.unit, ...(await attachables(bk.id)) });
  // the salutation chosen for each buyer is kept for next time
  const sal = b.salutations && typeof b.salutations === 'object' ? b.salutations : {};
  for (const p of x.people) {
    const v = bm.SALUTATIONS.includes(sal[p.id]) ? sal[p.id] : sal[p.id] === '' ? null : undefined;
    if (v !== undefined && v !== p.salutation) { await db.q('update buyers set salutation = $2 where id = $1', [p.id, v]); p.salutation = v; }
  }
  const tpl = bm.templates(x).find((t) => t.key === b.template) || bm.templates(x)[0];
  const subject = str(b.subject, 200) || tpl.subject;
  const body = str(b.body ?? b.message, 5000) || tpl.body;
  const message = bm.compose({ people: x.people, body, sig });
  const d = { to: toAll };
  const nextDate = DATE.test(b.nextDate || '') ? b.nextDate : null;
  if (nextDate && nextDate < today()) throw fail(400, 'The next follow-up date cannot be in the past.');
  if (!mailer.configured()) throw fail(409, 'Email is not set up yet (SMTP app password in Vercel), so nothing was sent.');
  let to = d.to, cc = [];
  const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  if (!live()) { to = emails(set.testEmail).slice(0, 1); if (!to.length) throw fail(409, 'This is the test version: set a test email address in Letter settings (Demand letters page). Emails go only there until the ERP is live.'); }
  else { if (!to.length) throw fail(400, `${bk.unit_no}: no email address on this booking. Add it on the booking first.`); cc = emails(set.cc); }
  const attachments = await attachFiles(u, bk.id, b.letterIds, b.receiptIds);
  const html = message.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const conn = await mailer.connect();
  const ref = b.replyTo ? await db.one("select message_id from communications where id = $1 and booking_id = $2 and channel = 'email'", [intOr(b.replyTo), bk.id]) : null;
  let sent;
  try { sent = await conn.send({ to, cc, subject: (live() ? '' : '[TEST] ') + subject, text: message, html, attachments, inReplyTo: ref && ref.message_id || undefined }); } finally { await conn.close().catch(() => {}); }
  await require('../lib/comms').logSent({ bookingId: bk.id, to, subject, body: message, sent, kind: ref ? 'reply' : 'follow-up', userId: u.id, test: !live() });
  await db.tx(async (t) => {
    const r = await t.one("insert into follow_ups (booking_id, kind, outcome, note, next_date, created_by) values ($1, 'Email', 'Email sent', $2, $3, $4) returning id",
      [bk.id, `${live() ? '' : '[TEST to ' + to.join(', ') + '] '}${subject}`.slice(0, 1000), nextDate, u.id]);
    await audit.record(t.q, { user: u, action: 'email', entity: 'follow-up', entityId: r.id, projectId: bk.project_id, after: { unit: bk.unit_no, to: live() ? to : ['test'], subject, attached: attachments.map((a) => a.filename) } });
  });
  return res.json({ ok: true, to, test: !live(), attached: attachments.length });
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
