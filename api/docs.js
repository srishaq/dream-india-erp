// Booking documents. GET ?booking=ID&doc=costsheet|allotment|form → printable page; doc=welcome → the email text.
// POST {action:'welcome', bookingId} → emails the welcome message (test version: only to the test address).
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const mailer = require('../lib/mailer');
const docs = require('../lib/docs');
const { has } = require('../lib/roles');
const { bookingFor } = require('../lib/access');
const { bookingContext } = require('../lib/sales-context');
const { today } = require('../lib/demands');
const { route, fail, intOr } = require('../lib/http');

const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const live = () => process.env.ERP_LIVE === '1';

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    const q = req.query || {};
    const bk = await bookingFor(u, intOr(q.booking));
    const doc = String(q.doc || '');
    if (!['costsheet', 'allotment', 'form', 'welcome'].includes(doc)) throw fail(400, 'Unknown document.');
    if (doc === 'costsheet' ? !has(u, 'inventory.view') : !has(u, 'buyer.kyc')) throw fail(403, 'Your role does not allow this document (it shows buyer details).');
    const d = await bookingContext(bk.id);
    d.date = today();
    if (doc === 'welcome') return res.json({ ...docs.welcomeEmail(d), to: d.applicants.flatMap((a) => emails(a.email)), sentAt: bk.welcome_sent_at, live: live() });
    const title = { costsheet: 'Cost sheet', allotment: 'Allotment letter', form: 'Booking form' }[doc] + ' ' + d.unit.unit_no;
    const body = doc === 'costsheet' ? docs.costSheetHtml(d.cost, { unit: d.unit, project: d.project, rera: d.rera, date: d.date, buyer: d.applicants.map((a) => a.name).join(' & ') })
      : doc === 'allotment' ? docs.allotmentHtml(d) : docs.bookingFormHtml(d);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(docs.page(title, [body], { draft: doc !== 'costsheet' }));
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'booking.create'); if (!u) return;
    if (b.action !== 'welcome') throw fail(400, 'Unknown action.');
    const bk = await bookingFor(u, intOr(b.bookingId));
    if (bk.status !== 'active') throw fail(409, 'The welcome email goes out once the booking is approved.');
    if (!mailer.configured()) throw fail(400, 'The sending email account is not connected to the ERP yet.');
    const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
    const d = await bookingContext(bk.id);
    const real = d.applicants.flatMap((a) => emails(a.email));
    if (live() && !real.length) throw fail(400, 'This buyer has no email address.');
    if (!live() && !set.testEmail) throw fail(400, 'This is the test version: set a test email address in Letter settings (Demand letters page) first. Emails go only there until the ERP is live.');
    const to = live() && !bk.sample ? real : [set.testEmail];
    const m = docs.welcomeEmail(d);
    const conn = await mailer.connect();
    try { await conn.send({ to, cc: live() && set.cc ? emails(set.cc) : [], subject: m.subject + (live() ? '' : ' [TEST]'), text: m.text }); } finally { await conn.close(); }
    await db.tx(async (t) => {
      await t.q('update bookings set welcome_sent_at = now() where id = $1', [bk.id]);
      await audit.record(t.q, { user: u, action: 'send-welcome', entity: 'booking', entityId: bk.id, projectId: bk.project_id, after: { to: to.join(', '), test: !live() } });
    });
    return res.json({ ok: true, to: to.join(', ') });
  },
});
