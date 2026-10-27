// Communication with buyers: every email and WhatsApp in and out, against the booking.
// GET  ?booking=ID          → that buyer's messages, newest first
// GET  ?inbox=1&f=new|unmatched|all → the Communication inbox
// GET  ?status=1            → is the mailbox read (last run, error), is WhatsApp connected
// POST {action:'link', id, bookingId} | {action:'dismiss', id} | {action:'read', ids} | {action:'sync'} (read the mailbox now)
//      {action:'whatsapp', bookingId, text} | {action:'whatsapp', bookingId, template, params}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

const COLS = `c.id, c.booking_id, c.channel, c.direction, c.from_addr, c.to_addr, c.subject, c.body, c.sent_at, c.status, c.matched_by, c.delivery, c.attachments, c.kind, c.read_at,
  s.name as sent_by_name, r.name as read_by_name, u.unit_no`;
const FROM = 'communications c left join users s on s.id = c.sent_by left join users r on r.id = c.read_by left join bookings b on b.id = c.booking_id left join units u on u.id = b.unit_id';
const see = (u) => has(u, 'ledger.view');
const act = (u) => has(u, 'demand.raise') || has(u, 'booking.create');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!see(u)) throw fail(403, 'Your role does not see buyer communication.');
    const q = req.query || {};
    if (q.status) {
      const ms = require('../lib/mail-sync'), st = await ms.state();
      return res.json({ mail: { configured: ms.configured(), lastRun: st.lastRun || null, error: st.lastError || null, last: st.lastResult || null, mailbox: process.env.SMTP_USER || null },
        whatsapp: { configured: require('../lib/whatsapp').configured() }, canAct: act(u), canSync: has(u, 'users.manage') || has(u, 'booking.approve') });
    }
    if (q.booking) {
      await bookingFor(u, intOr(q.booking));
      const rows = await db.q(`select ${COLS} from ${FROM} where c.booking_id = $1 and c.status <> 'dismissed' order by c.sent_at desc, c.id desc limit 300`, [intOr(q.booking)]);
      const wa = require('../lib/whatsapp');
      return res.json({ rows, whatsapp: { configured: wa.configured(), window: wa.configured() ? await wa.windowOpen(intOr(q.booking)) : false }, canAct: act(u) });
    }
    if (q.inbox) {
      const f = ['new', 'unmatched', 'all'].includes(q.f) ? q.f : 'new';
      const where = f === 'unmatched' ? "c.status = 'unmatched'" : f === 'new' ? "c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null" : "c.direction = 'in' and c.status <> 'dismissed'";
      const rows = await db.q(`select ${COLS} from ${FROM} where ${where} and (c.booking_id is null or u.project_id = any($1)) order by c.sent_at desc limit 300`, [u.projects]);
      const counts = await db.one(`select count(*) filter (where c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null)::int as new, count(*) filter (where c.status = 'unmatched')::int as unmatched
        from ${FROM} where c.booking_id is null or u.project_id = any($1)`, [u.projects]);
      return res.json({ rows, counts, f, canAct: act(u) });
    }
    throw fail(400, 'Nothing asked for.');
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (b.action === 'sync') {
      if (!(has(u, 'users.manage') || has(u, 'booking.approve'))) throw fail(403, 'Only Head CRM or the Admin can read the mailbox now.');
      return res.json(await require('../lib/mail-sync').sync({ trigger: 'manual' }));
    }
    if (!act(u)) throw fail(403, 'Your role cannot change buyer communication.');
    if (b.action === 'read') {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map((x) => intOr(x)).filter(Boolean).slice(0, 500);
      await db.q('update communications set read_by = $2, read_at = now() where id = any($1) and read_at is null', [ids, u.id]);
      return res.json({ ok: true });
    }
    if (b.action === 'link') {
      const c = await db.one('select * from communications where id = $1', [intOr(b.id)]); if (!c) throw fail(404, 'That message is not there.');
      const bk = await bookingFor(u, intOr(b.bookingId));
      await db.q("update communications set booking_id = $2, status = 'matched', matched_by = 'linked by ' || $3, linked_by = $4 where id = $1", [c.id, bk.id, u.name || 'CRM', u.id]);
      await audit.record(db.q, { user: u, action: 'link', entity: 'communication', entityId: c.id, projectId: bk.project_id, after: { unit: bk.unit_no } });
      return res.json({ ok: true });
    }
    if (b.action === 'dismiss') {
      const c = await db.one("select id from communications where id = $1 and direction = 'in'", [intOr(b.id)]); if (!c) throw fail(404, 'That message is not there.');
      await db.q("update communications set status = 'dismissed', read_by = $2, read_at = coalesce(read_at, now()) where id = $1", [c.id, u.id]);
      await audit.record(db.q, { user: u, action: 'dismiss', entity: 'communication', entityId: c.id });
      return res.json({ ok: true });
    }
    if (b.action === 'whatsapp') {
      const bk = await bookingFor(u, intOr(b.bookingId));
      const ph = await db.one('select y.phone from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq limit 1', [bk.id]);
      const params = Array.isArray(b.params) ? b.params.map((p) => str(p, 200)).slice(0, 10) : [];
      const r = await require('../lib/whatsapp').send({ bookingId: bk.id, phone: ph && ph.phone, text: str(b.text, 4000), template: str(b.template, 100) || null, params, lang: str(b.lang, 10) || 'en', userId: u.id });
      await audit.record(db.q, { user: u, action: 'whatsapp', entity: 'booking', entityId: bk.id, projectId: bk.project_id, after: { template: b.template || null } });
      return res.json({ ok: true, ...r });
    }
    throw fail(400, 'Unknown action.');
  },
});
