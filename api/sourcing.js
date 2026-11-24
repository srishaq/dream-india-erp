// Sourcing (/leads → Sourcing tab): the sourcing team's visits to channel partner offices.
// A visit is logged from the phone at the partner's office: the location proves it. The first visit to a partner saves
// the office's location (and needs a photo of the office board or a visiting card); every later visit is checked against
// it and counts as verified within 150 m. The person met, why we went, notes and the next follow-up are kept.
// GET  → my visits, the partners, and (sourcing.all) the team's days, unverified visits and each partner's results
// GET ?photo=<visit id> → the photo of that visit
// POST {action}: visit | office.reset
//   visit {cpId | newName, lat, lng, accuracy, photo?, personName, personPhone?, personRole?, purpose, notes?, nextDate?, projectId?}
//   office.reset {cpId}   (sourcing.all: the partner moved office; the next visit saves the new place)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');
const { keyOf } = require('../lib/cp');

const RADIUS = 150; // metres from the saved office
const PURPOSES = {
  new_partner: 'New partner (first meeting)',
  launch: 'Project / launch briefing',
  collateral: 'Brochures and collateral',
  client: 'Client follow-up',
  payout: 'Brokerage / payout',
  other: 'Other',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const canAll = (u) => has(u, 'sourcing.all');
const canWork = (u) => has(u, 'sourcing.work') || canAll(u);

// metres between two points on the earth
function metres(a, b, c, d) {
  const R = 6371e3, r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const num = (x) => (x === '' || x == null || !isFinite(Number(x)) ? null : Number(x));

async function settings() {
  const s = ((await db.one("select value from settings where key = 'sourcing'")) || {}).value || {};
  return { target: Number(s.target) > 0 ? Number(s.target) : 6, radius: RADIUS };
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canWork(u)) throw fail(403, 'Your login does not open Sourcing.');
    const q = req.query || {};
    if (q.photo) {
      const v = await db.one('select user_id, photo from cp_visits where id = $1', [intOr(q.photo)]);
      if (!v || !v.photo || (!canAll(u) && v.user_id !== u.id)) throw fail(404, 'No photo.');
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(v.photo); if (!m) throw fail(404, 'No photo.');
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(Buffer.from(m[2], 'base64'));
    }
    const set = await settings();
    const visitCols = `v.id, v.at, v.cp_id, c.name as partner, v.lat, v.lng, v.accuracy, v.distance_m, v.verified, v.first_visit, (v.photo is not null) as has_photo,
      v.person_name, v.person_phone, v.person_role, v.purpose, v.notes, v.next_date, v.user_id, us.name as who, p.name as project`;
    const visitFrom = 'cp_visits v join channel_partners c on c.id = v.cp_id join users us on us.id = v.user_id left join projects p on p.id = v.project_id';
    const mine = await db.q(`select ${visitCols} from ${visitFrom} where v.user_id = $1 and v.at > now() - interval '30 days' order by v.at desc`, [u.id]);
    // the partners to pick from, with when we last went and whether the office is saved
    const partners = await db.q(`select c.id, c.name, c.contact_person, c.phone, (c.office_lat is not null) as office_saved,
        (select max(at) from cp_visits v where v.cp_id = c.id) as last_visit,
        (select max(at) from cp_visits v where v.cp_id = c.id and v.user_id = $1) as my_last_visit,
        (select min(next_date) from cp_visits v where v.cp_id = c.id and v.next_date >= (now() + interval '330 minutes')::date) as next_date
      from channel_partners c where c.merged_into is null and not c.is_reference and c.active order by c.name`, [u.id]);
    const out = { me: { id: u.id, name: u.name, all: canAll(u) }, purposes: PURPOSES, settings: set, visits: mine, partners };
    if (canAll(u)) {
      const projs = u.projects.map(Number).filter(Boolean);
      // each person's visits per day, last 14 days
      out.team = await db.q(`select us.id as user_id, us.name, ((v.at + interval '330 minutes')::date)::text as day, count(*)::int as visits,
          count(*) filter (where v.verified)::int as verified, count(distinct v.cp_id)::int as partners
        from cp_visits v join users us on us.id = v.user_id where v.at > now() - interval '14 days' group by 1, 2, 3 order by 3 desc, 2`);
      out.unverified = await db.q(`select ${visitCols} from ${visitFrom} where not v.verified and v.at > now() - interval '30 days' order by v.at desc limit 200`);
      out.recent = await db.q(`select ${visitCols} from ${visitFrom} where v.at > now() - interval '7 days' order by v.at desc limit 300`);
      // what each partner gave us: visits, leads they registered, site visits, bookings (90 days)
      out.byPartner = await db.q(`select c.id, c.name, (select count(*)::int from cp_visits v where v.cp_id = c.id and v.at > now() - interval '90 days') as visits,
          (select max(at) from cp_visits v where v.cp_id = c.id) as last_visit,
          (select count(*)::int from mkt_leads l where l.owner_cp_id = c.id and l.created_at > now() - interval '90 days') as leads,
          (select count(*)::int from mkt_leads l where l.owner_cp_id = c.id and l.visit_at > now() - interval '90 days') as site_visits,
          (select count(*)::int from bookings b join units un on un.id = b.unit_id where b.cp_id = c.id and b.status in ('pending', 'active')
             and b.booking_date > (now() - interval '90 days')::date and un.project_id = any($1::int[])) as bookings
        from channel_partners c where c.merged_into is null and not c.is_reference and c.active`, [projs.length ? projs : [0]]);
      out.byPartner.sort((a, b) => b.bookings - a.bookings || b.site_visits - a.site_visits || b.leads - a.leads || b.visits - a.visits || a.name.localeCompare(b.name));
    }
    return res.json(out);
  },

  POST: async (req, res, d) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canWork(u)) throw fail(403, 'Your login does not open Sourcing.');
    const a = d.action;

    if (a === 'visit') {
      const purpose = PURPOSES[d.purpose] ? d.purpose : null; if (!purpose) throw fail(400, 'Choose why you went.');
      const personName = str(d.personName, 120); if (!personName) throw fail(400, 'Write the name of the person you met.');
      const lat = num(d.lat), lng = num(d.lng), accuracy = num(d.accuracy);
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail(400, 'Your location did not come through. Allow location for the ERP on your phone and try again at the office.');
      const photo = typeof d.photo === 'string' && d.photo ? d.photo : null;
      if (photo && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 1.5e6)) throw fail(400, 'The photo did not come through. Take it again.');
      const projectId = intOr(d.projectId) || null;
      if (projectId && !u.projects.includes(projectId)) throw fail(403, 'That project is not on your login.');
      const nextDate = DATE.test(d.nextDate || '') ? d.nextDate : null;

      const r = await db.tx(async (t) => {
        // the partner: one from the list, or a new firm typed in (kept as a channel partner from now on)
        let cp;
        if (intOr(d.cpId)) cp = await t.one('select id, name, office_lat, office_lng from channel_partners where id = $1 and merged_into is null for update', [intOr(d.cpId)]);
        else {
          const name = str(d.newName, 160); if (!name) throw fail(400, 'Choose the partner, or type the new partner\'s firm name.');
          cp = await t.one('select id, name, office_lat, office_lng, merged_into from channel_partners where name_key = $1 for update', [keyOf(name)]);
          if (cp && cp.merged_into) cp = await t.one('select id, name, office_lat, office_lng from channel_partners where id = $1 for update', [cp.merged_into]);
          if (!cp) cp = await t.one(`insert into channel_partners (name, name_key, contact_person, phone, created_by, note) values ($1, $2, $3, $4, $5, $6)
              returning id, name, office_lat, office_lng`, [name, keyOf(name), personName, str(d.personPhone, 20) || null, u.id, `Added by ${u.name} on a sourcing visit`]);
        }
        if (!cp) throw fail(404, 'That partner is not there.');
        const before = await t.one('select count(*)::int as n from cp_visits where cp_id = $1', [cp.id]);
        const first = !before.n;
        if (first && !photo) throw fail(400, 'First visit to this partner: take a photo of the office board or a visiting card.');
        let distance = null, verified = false, savedOffice = false;
        if (cp.office_lat == null) {
          // the first visit (or the first after the office moved) saves the office where you are standing
          await t.q('update channel_partners set office_lat = $2, office_lng = $3, office_set_at = now(), office_set_by = $4 where id = $1', [cp.id, lat, lng, u.id]);
          savedOffice = true; verified = accuracy == null || accuracy <= RADIUS;
        } else {
          distance = metres(Number(cp.office_lat), Number(cp.office_lng), lat, lng);
          verified = distance <= RADIUS;
        }
        const v = await t.one(`insert into cp_visits (user_id, cp_id, lat, lng, accuracy, distance_m, verified, first_visit, photo, person_name, person_phone, person_role, purpose, notes, next_date, project_id)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
          [u.id, cp.id, lat, lng, accuracy == null ? null : Math.round(accuracy), distance, verified, first, photo, personName, str(d.personPhone, 20) || null, str(d.personRole, 60) || null,
            purpose, str(d.notes, 1000) || null, nextDate, projectId]);
        return { id: v.id, cp, distance, verified, savedOffice, first };
      });
      await audit.record(db.q, { user: u, action: 'cp-visit', entity: 'cp-visit', entityId: r.id, after: { cp: r.cp.id, verified: r.verified, distance: r.distance, purpose } });
      return res.json({ ok: true, id: r.id, partner: r.cp.name, cpId: r.cp.id, verified: r.verified, distance: r.distance, savedOffice: r.savedOffice, first: r.first, radius: RADIUS });
    }

    if (a === 'office.reset') {
      if (!canAll(u)) throw fail(403, 'Only the sourcing manager resets a partner\'s office.');
      const cp = await db.one('select id, name, office_lat, office_lng from channel_partners where id = $1', [intOr(d.cpId)]); if (!cp) throw fail(404, 'That partner is not there.');
      await db.q('update channel_partners set office_lat = null, office_lng = null, office_set_at = null, office_set_by = null where id = $1', [cp.id]);
      await audit.record(db.q, { user: u, action: 'cp-office-reset', entity: 'channel-partner', entityId: cp.id, before: { lat: cp.office_lat, lng: cp.office_lng } });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
module.exports.metres = metres;
