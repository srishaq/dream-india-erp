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
const FROM = 'communications c left join users s on s.id = c.sent_by left join users r on r.id = c.read_by left join bookings b on b.id = c.booking_id left join units u on u.id = b.unit_id left join buildings bl on bl.id = u.building_id';
const see = (u) => has(u, 'ledger.view');
// Messages on flats this login looks after: their own flats, their wing's flats, and (Head CRM) flats with nobody.
async function mineSql(u) {
  const N = require('../lib/comms-notify'), w = await N.wingsOf(u.id), t = await N.teams();
  const noTeam = ['A', 'B'].filter((x) => !(t[x] || []).length);
  const wingList = (a) => a.map((x) => `'${String(x).replace(/[^A-Za-z0-9]/g, '')}'`).join(',');
  const parts = [`b.crm_user_id = ${+u.id}`];
  if (w.length) parts.push(`(b.crm_user_id is null and bl.code in (${wingList(w)}))`);
  if (u.role === 'head_crm') parts.push(`(b.crm_user_id is null and ${noTeam.length ? `bl.code in (${wingList(noTeam)})` : 'false'})`);
  return '(' + parts.join(' or ') + ')';
}
const act = (u) => has(u, 'demand.raise') || has(u, 'booking.create');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!see(u)) throw fail(403, 'Your role does not see buyer communication.');
    const q = req.query || {};
    if (q.status) {
      const ms = require('../lib/mail-sync'), st = await ms.state();
      return res.json({ mail: { configured: ms.configured(), lastRun: st.lastRun || null, error: st.lastError || null, last: st.lastResult || null, mailbox: process.env.SMTP_USER || null },
        whatsapp: { configured: require('../lib/whatsapp').configured(), provider: require('../lib/whatsapp').provider(), ccm: require('../lib/whatsapp').ccm() }, teams: await require('../lib/comms-notify').teams(), crmUsers: await db.q("select id, name, role from users where not disabled and role in ('crm', 'head_crm', 'management', 'admin') order by name"), canTeams: has(u, 'booking.approve') || has(u, 'users.manage'), canAct: act(u), canSync: has(u, 'users.manage') || has(u, 'booking.approve') });
    }
    if (q.badge) {
      const r = await db.one(`select count(*)::int as n from communications c join bookings b on b.id = c.booking_id join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
        where c.direction = 'in' and c.status = 'matched' and c.read_at is null and ${await mineSql(u)}`);
      // the newest unread one, so the page can chime and show who wrote when a new one arrives
      const last = r.n ? await db.one(`select c.id, c.channel, c.subject, c.from_addr, c.booking_id, u.unit_no,
          (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
        from communications c join bookings b on b.id = c.booking_id join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
        where c.direction = 'in' and c.status = 'matched' and c.read_at is null and ${await mineSql(u)} order by c.id desc limit 1`) : null;
      return res.json({ mine: r.n, last });
    }
    if (q.booking) {
      await bookingFor(u, intOr(q.booking));
      const rows = await db.q(`select ${COLS} from ${FROM} where c.booking_id = $1 and c.status <> 'dismissed' order by c.sent_at desc, c.id desc limit 300`, [intOr(q.booking)]);
      const wa = require('../lib/whatsapp');
      const N = require('../lib/comms-notify'), w = await N.whoFor(intOr(q.booking));
      const own = await db.one('select crm_user_id from bookings where id = $1', [intOr(q.booking)]);
      const canTeams = has(u, 'booking.approve') || has(u, 'users.manage');
      return res.json({ rows, whatsapp: { configured: wa.configured(), window: wa.configured() ? await wa.windowOpen(intOr(q.booking)) : false }, canAct: act(u),
        crm: { people: w.people.map((p) => p.name), by: w.allocated, own: own && own.crm_user_id }, canTeams,
        crmUsers: canTeams ? await db.q("select id, name from users where not disabled and role in ('crm', 'head_crm') order by name") : [] });
    }
    if (q.inbox) {
      const f = ['mine', 'new', 'unmatched', 'all', 'waiting'].includes(q.f) ? q.f : 'mine';
      const W = require('../lib/comms').WAITING_SQL('c');
      const where = f === 'unmatched' ? "c.status = 'unmatched'" : f === 'new' ? "c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null"
        : f === 'waiting' ? W
        : f === 'mine' ? `c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null and ${await mineSql(u)}` : "c.direction = 'in' and c.status <> 'dismissed'";
      const rows = await db.q(`select ${COLS}, (${W}) as waiting, round(extract(epoch from now() - c.sent_at) / 3600)::int as age_hours from ${FROM} where ${where} and (c.booking_id is null or u.project_id = any($1)) order by c.sent_at ${f === 'waiting' ? 'asc' : 'desc'} limit 300`, [u.projects]);
      const counts = await db.one(`select count(*) filter (where c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null)::int as new, count(*) filter (where c.status = 'unmatched')::int as unmatched, count(*) filter (where ${W})::int as waiting,
          count(*) filter (where c.direction = 'in' and c.status <> 'dismissed' and c.read_at is null and ${await mineSql(u)})::int as mine
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
    if (b.action === 'noreply' || b.action === 'reopen-reply') {
      const c = await db.one("select id from communications where id = $1 and direction = 'in'", [intOr(b.id)]); if (!c) throw fail(404, 'That message is not there.');
      await db.q(b.action === 'noreply' ? 'update communications set reply_closed_at = now(), reply_closed_by = $2 where id = $1' : 'update communications set reply_closed_at = null, reply_closed_by = null where id = $1', b.action === 'noreply' ? [c.id, u.id] : [c.id]);
      await audit.record(db.q, { user: u, action: b.action, entity: 'communication', entityId: c.id });
      return res.json({ ok: true });
    }
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
      if (c.direction === 'in') await require('../lib/comms-notify').notify(c.id).catch(() => {});
      return res.json({ ok: true });
    }
    if (b.action === 'wa-webhook') {
      if (!has(u, 'users.manage')) throw fail(403, 'Only the Admin connects WhatsApp.');
      const r = await require('../lib/whatsapp').connectWebhook();
      await audit.record(db.q, { user: u, action: 'whatsapp-webhook', entity: 'settings', after: { provider: 'Click Connect' } });
      return res.json(r);
    }
    if (b.action === 'wa-templates') {
      if (!(has(u, 'users.manage') || has(u, 'demand.approve') || has(u, 'booking.approve'))) throw fail(403, 'Your role does not allow this.');
      return res.json({ templates: await require('../lib/whatsapp').templates() });
    }
    if (b.action === 'teams') {
      if (!(has(u, 'booking.approve') || has(u, 'users.manage'))) throw fail(403, 'Only Head CRM or the Admin can set the CRM teams.');
      const ok = new Set((await db.q('select id from users where not disabled')).map((r) => r.id));
      const v = {}; for (const w of ['A', 'B']) v[w] = [...new Set((Array.isArray(b.teams && b.teams[w]) ? b.teams[w] : []).map((x) => intOr(x)).filter((x) => ok.has(x)))];
      await require('../lib/comms-notify').saveTeams(v);
      await audit.record(db.q, { user: u, action: 'crm-teams', entity: 'settings', after: v });
      return res.json({ ok: true, teams: v });
    }
    if (b.action === 'allocate') {
      if (!(has(u, 'booking.approve') || has(u, 'users.manage'))) throw fail(403, 'Only Head CRM or the Admin can allocate flats.');
      const to = b.userId ? await db.one("select id, name from users where id = $1 and not disabled", [intOr(b.userId)]) : null;
      if (b.userId && !to) throw fail(400, 'Pick a CRM login.');
      const ids = (Array.isArray(b.bookingIds) ? b.bookingIds : [b.bookingId]).map((x) => intOr(x)).filter(Boolean).slice(0, 2000);
      const rows = await db.q("update bookings b set crm_user_id = $2 from units u where u.id = b.unit_id and b.id = any($1) and u.project_id = any($3) returning b.id, u.unit_no", [ids, to ? to.id : null, u.projects]);
      await audit.record(db.q, { user: u, action: 'allocate-crm', entity: 'booking', after: { to: to ? to.name : null, flats: rows.map((r) => r.unit_no).slice(0, 300), count: rows.length } });
      return res.json({ ok: true, count: rows.length });
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
