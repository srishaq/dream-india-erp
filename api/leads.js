// Pre-sales & Sales (/leads): the middle of the journey, from a lead coming in to a booking in the CRM.
// Every lead (IVR, website, Facebook/Instagram, WhatsApp, portals, walk-ins) lands with the pre-sales caller, who calls it,
// notes each call, asks the qualifying questions and hands a qualified buyer to a sales person with the site-visit date.
// The sales person sees only the leads handed to them, records the visit and follow-ups, and closes it as booked or lost.
// GET  → the lists for this login (?id= → one lead with every call)
// POST {action}: log | handover | add | assign
//   log      {id, outcome, note?, nextDate?, visitDate?, qualify?, name?, email?, projectId?, lostReason?}
//   handover {id, to, visitDate?, note?}            add {name?, phone, email?, projectId?, source?, note?}
//   assign   {id, to}  (leads.all: give a lead to someone else)
//   handover {..., to: 'auto' (the sales person whose turn it is), reason: visit | info | costsheet}
//   walkin   {name, phone, email?, projectId?, note?, qualify?, to?}  a walk-in goes straight to the sales person who met them
//   sendback {id, note}   sales gives a lead back to pre-sales        offer.email {id, offerId}  the cost sheet to the customer
// Three tabs on the page: Pre-sales, Sales and Sourcing (api/sourcing.js); each login opens on its own.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');
const O = require('../lib/mkt-offers');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const canAll = (u) => has(u, 'leads.all');
const canWork = (u) => has(u, 'leads.work') || canAll(u);
const sourcing = (u) => has(u, 'sourcing.work') || has(u, 'sourcing.all');
// why pre-sales passes a lead on; a cost sheet is given at the site, so it is no longer a reason (old leads keep the label)
const REASONS = { visit: 'Qualified: site visit', info: 'Wants more information before visiting' };
// the tabs a login sees: the caller Pre-sales, the sales person Sales, the sourcing team Sourcing; managers all three
function tabsFor(u) {
  const t = [];
  if (u.role === 'presales') t.push('presales');
  else if (canAll(u)) t.push('presales', 'sales');
  else if (canWork(u)) t.push('sales');
  if (sourcing(u)) t.push('sourcing');
  return t;
}
// the sales person whose turn it is: of the sales logins that open the lead's project, the one handed a lead longest ago
async function nextSales(projectId) {
  const rows = await db.q(`select us.id, us.name, us.email, us.phone, (select max(handed_at) from mkt_leads l where l.handed_to = us.id) as last
      from users us where not us.disabled and us.role = 'sales'
        and ($1::int is null or us.all_projects or exists (select 1 from user_projects up where up.user_id = us.id and up.project_id = $1))
      order by last nulls first, us.id limit 1`, [projectId || null]);
  return rows[0] || null;
}
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtAt = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// what each call can end with; who may use it (sales closes, pre-sales qualifies; either may do both)
const OUTCOMES = {
  no_answer: 'No answer / busy',
  spoke: 'Spoke, follow up',
  visit_booked: 'Site visit booked',
  visit_done: 'Site visit done',
  booked: 'Booked',
  not_interested: 'Not interested',
};
const QUALIFY = { budget: 120, bhk: 40, purpose: 40, timeline: 60, area: 120, project: 80 };

// a lead this login may see: everyone with leads.all; others only what is theirs (assigned or handed to them)
const mine = (u, n) => (canAll(u) ? 'true' : `(l.assigned_to = $${n} or l.handed_to = $${n})`);
const projOk = (u) => `(l.project_id is null or l.project_id = any(array[${u.projects.map(Number).filter(Boolean).join(',') || 0}]::int[]))`;

async function list(u) {
  const rows = await db.q(`select l.id, l.name, l.phone, l.email, l.project_id, p.name as project, l.source, array_to_json(l.sources) as sources, l.status, l.assigned_to, a.name as assigned_name,
        l.handed_to, h.name as handed_name, l.handed_at, l.next_date, l.visit_date, l.qualify, l.created_at, l.first_contact_at, l.visit_at, l.booked_at, l.lost_reason, l.updated_at,
        l.booking_id, l.hold_until, hu.unit_no as hold_unit, l.handover_reason, l.sent_back_at,
        (select json_build_object('id', o.id, 'status', o.status, 'av', o.av, 'discount_pct', o.discount_pct, 'unit_no', ou.unit_no) from mkt_offers o join units ou on ou.id = o.unit_id
          where o.lead_id = l.id and o.status <> 'void' order by o.id desc limit 1) as offer,
        (select count(*)::int from mkt_lead_events e where e.lead_id = l.id and e.kind = 'call') as calls,
        (select e.note from mkt_lead_events e where e.lead_id = l.id and e.note is not null and e.kind <> 'assign' order by e.at desc limit 1) as last_note,
        exists (select 1 from bookings b join booking_applicants ba on ba.booking_id = b.id join buyers y on y.id = ba.buyer_id
                where right(regexp_replace(coalesce(y.phone, ''), '\\D', '', 'g'), 10) = l.phone and b.status in ('active', 'pending')) as is_buyer
      from mkt_leads l left join projects p on p.id = l.project_id left join users a on a.id = l.assigned_to left join users h on h.id = l.handed_to
        left join units hu on hu.id = l.hold_unit_id and l.hold_until > now()
      where ${mine(u, 1)} and ${projOk(u)}
        and ((l.status in ('new', 'contacted', 'visit') and (l.created_at > now() - interval '60 days' or l.first_contact_at is not null or l.handed_to is not null or l.next_date is not null))
          or (l.status in ('booked', 'lost') and coalesce(l.updated_at, l.created_at) > now() - interval '30 days'))
      order by l.created_at desc limit 1500`, canAll(u) ? [] : [u.id]);
  return rows;
}

async function summary(u) {
  if (!canAll(u)) return null;
  const r = await db.one(`select count(*)::int as leads,
      count(*) filter (where first_contact_at is not null)::int as called,
      count(*) filter (where first_contact_at is not null and first_contact_at <= created_at + interval '15 minutes')::int as fast,
      count(*) filter (where handed_at is not null)::int as handed,
      count(*) filter (where visit_at is not null)::int as visits,
      count(*) filter (where exists (select 1 from mkt_offers o where o.lead_id = mkt_leads.id and o.status <> 'void'))::int as offers,
      count(*) filter (where booked_at is not null)::int as booked
    from mkt_leads where created_at > now() - interval '30 days'`);
  const bySales = await db.q(`select h.name, count(*)::int as handed, count(*) filter (where l.visit_at is not null)::int as visits,
      count(*) filter (where exists (select 1 from mkt_offers o where o.lead_id = l.id and o.status <> 'void'))::int as offers,
      count(*) filter (where l.booked_at is not null)::int as booked, count(*) filter (where l.status = 'lost')::int as lost,
      count(*) filter (where l.status in ('contacted', 'visit') and l.next_date < (now() + interval '330 minutes')::date)::int as overdue
    from mkt_leads l join users h on h.id = l.handed_to where l.handed_at > now() - interval '90 days' group by h.name order by 2 desc`);
  const lost = await db.q(`select coalesce(lost_reason, 'No reason given') as reason, count(*)::int as n from mkt_leads where status = 'lost' and updated_at > now() - interval '90 days' group by 1 order by 2 desc limit 8`);
  const bySource = await db.q(`select source, count(*)::int as leads, count(*) filter (where visit_at is not null)::int as visits, count(*) filter (where booked_at is not null)::int as booked
    from mkt_leads where created_at > now() - interval '30 days' group by source order by 2 desc`);
  return { ...r, bySource, bySales, lost };
}

async function lead(u, id) {
  return db.one(`select l.*, array_to_json(l.sources) as sources, p.name as project, a.name as assigned_name, h.name as handed_name from mkt_leads l left join projects p on p.id = l.project_id
      left join users a on a.id = l.assigned_to left join users h on h.id = l.handed_to where l.id = $1 and ${mine(u, 2)} and ${projOk(u)}`, canAll(u) ? [id] : [id, u.id]);
}

async function event(leadId, u, kind, { outcome = null, note = null, data = null } = {}) {
  await db.q('insert into mkt_lead_events (lead_id, user_id, kind, outcome, note, data) values ($1, $2, $3, $4, $5, $6)', [leadId, u.id, kind, outcome, note, data]);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canWork(u)) {
      // the sourcing team opens the same page, on its Sourcing tab alone
      if (sourcing(u)) return res.json({ me: { id: u.id, name: u.name, role: u.role, all: false, tabs: tabsFor(u) }, today: istToday(), leads: [],
        projects: (await db.q('select id, name, code from projects where active order by name')).filter((p) => u.projects.includes(p.id)), people: [], outcomes: OUTCOMES, approvals: [], reasons: REASONS });
      throw fail(403, 'Your login does not open Pre-sales & Sales.');
    }
    const q = req.query || {};
    if (q.id) {
      const l = await lead(u, intOr(q.id)); if (!l) throw fail(404, 'That lead is not there, or it is not yours.');
      const events = await db.q('select e.at, e.kind, e.outcome, e.note, e.data, us.name as who from mkt_lead_events e left join users us on us.id = e.user_id where e.lead_id = $1 order by e.at desc', [l.id]);
      const calls = await db.q("select called_at, status, duration, recording_url from mkt_ivr_calls where caller = $1 order by called_at desc limit 20", [l.phone]).catch(() => []);
      const offers = await db.q(`select o.*, u.unit_no, u.floor, u.typology, bl.code as wing, c.name as by_name, dd.name as decided_name from mkt_offers o join units u on u.id = o.unit_id
          join buildings bl on bl.id = u.building_id left join users c on c.id = o.created_by left join users dd on dd.id = o.decided_by where o.lead_id = $1 order by o.id desc`, [l.id]);
      const hold = l.hold_unit_id && l.hold_until && new Date(l.hold_until) > new Date() ? await db.one('select id, unit_no from units where id = $1', [l.hold_unit_id]) : null;
      return res.json({ lead: l, events, ivr: calls, offers, hold, mayApprove: await O.mayApprove(u) });
    }
    const projects = (await db.q('select id, name, code from projects where active order by name')).filter((p) => u.projects.includes(p.id));
    const people = await db.q("select id, name, role from users where not disabled and role in ('presales', 'sales') order by name");
    const may = await O.mayApprove(u), set = await O.settings();
    const approvals = may ? await db.q(`select o.id, o.lead_id, o.discount, o.discount_pct, o.av, o.client_ask, o.created_at, u.unit_no, p.name as project, l.name as lead_name, l.phone, c.name as by_name
        from mkt_offers o join units u on u.id = o.unit_id join projects p on p.id = u.project_id join mkt_leads l on l.id = o.lead_id left join users c on c.id = o.created_by
        where o.status = 'pending' order by o.id`) : [];
    return res.json({ me: { id: u.id, name: u.name, all: canAll(u), role: u.role, approver: may, sells: has(u, 'booking.create'), tabs: tabsFor(u) }, today: istToday(), leads: await list(u), summary: await summary(u),
      projects, people, outcomes: OUTCOMES, reasons: REASONS, approvals, sales: { limitPct: set.limitPct, holdHours: set.holdHours } });
  },

  POST: async (req, res, d) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canWork(u)) throw fail(403, 'Your login does not open Pre-sales & Sales.');
    const a = d.action;
    const log = (action, id, after) => audit.record(db.q, { user: u, action, entity: 'mkt-lead', entityId: id, after });
    const L = require('../lib/mkt-leads');

    if (a === 'add') {
      const projectId = intOr(d.projectId) || null;
      if (projectId && !u.projects.includes(projectId)) throw fail(403, 'That project is not on your login.');
      const r = await L.add({ name: str(d.name, 120), phone: d.phone, email: str(d.email, 160), source: str(d.source, 30) || 'other', projectId, note: str(d.note, 500), by: u.id, welcome: d.welcome !== false });
      // a lead the caller types in is hers to call
      if (!r.duplicate && !canAll(u)) await db.q('update mkt_leads set assigned_to = $2 where id = $1', [r.id, u.id]);
      await event(r.id, u, 'note', { note: r.duplicate ? 'Came in again (typed in).' : 'Lead typed in.' });
      await log(r.duplicate ? 'lead-again' : 'create', r.id, { source: d.source });
      return res.json({ ok: true, id: r.id, duplicate: !!r.duplicate });
    }

    if (a === 'walkin') {
      // someone walked into the site office: the sales person who met them takes it, the visit already done
      if (!has(u, 'booking.create') && !(canAll(u) && u.role !== 'presales')) throw fail(403, 'Walk-ins are added by sales.');
      const projectId = intOr(d.projectId) || null;
      if (projectId && !u.projects.includes(projectId)) throw fail(403, 'That project is not on your login.');
      let to = { id: u.id, name: u.name };
      if (d.to && intOr(d.to) !== u.id) {
        if (!canAll(u)) throw fail(403, 'A walk-in is yours: you met them.');
        to = await db.one("select id, name from users where id = $1 and not disabled and role in ('sales', 'presales', 'management', 'admin', 'head_crm')", [intOr(d.to)]);
        if (!to) throw fail(400, 'Choose the sales person who met them.');
      }
      const qualify = {};
      for (const [k, max] of Object.entries(QUALIFY)) if (d.qualify && d.qualify[k] != null) { const val = str(d.qualify[k], max); if (val) qualify[k] = val; }
      const note = str(d.note, 500) || null;
      const r = await L.add({ name: str(d.name, 120), phone: d.phone, email: str(d.email, 160), source: 'walk_in', projectId, note, by: u.id, welcome: d.welcome !== false, status: 'visit', visit: true });
      const cur = await db.one('select l.handed_to, h.name as handed_name, l.status from mkt_leads l left join users h on h.id = l.handed_to where l.id = $1', [r.id]);
      // a buyer already with another sales person stays theirs: the visit is noted on the lead
      const keep = cur.handed_to && cur.handed_to !== to.id && cur.status !== 'lost';
      await db.q(`update mkt_leads set status = case when status in ('new', 'contacted', 'lost') then 'visit' else status end, visit_at = coalesce(visit_at, now()),
          visit_date = coalesce(visit_date, $2::date), first_contact_at = coalesce(first_contact_at, now()), qualify = coalesce(qualify, '{}'::jsonb) || $3::jsonb,
          next_date = $4, project_id = coalesce(project_id, $5), updated_at = now(),
          handed_to = case when $6 then handed_to else $7 end, assigned_to = case when $6 then assigned_to else $7 end,
          handed_at = case when $6 then handed_at else now() end, handed_by = case when $6 then handed_by else $8 end,
          handover_reason = case when $6 then handover_reason else 'walkin' end,
          note = concat_ws(E'\\n', note, $9::text) where id = $1`,
        [r.id, istToday(), JSON.stringify(qualify), addDays(istToday(), 1), projectId, !!keep, to.id, u.id, `${fmtAt(new Date())} ${u.name}: walk-in at the site, met ${to.name}${note ? ' — ' + note : ''}`]);
      await event(r.id, u, 'call', { outcome: 'visit_done', note: `Walk-in: met ${to.name}${note ? '. ' + note : ''}`, data: { walkin: true, to: to.id } });
      await log(r.duplicate ? 'walkin-again' : 'walkin', r.id, { to: to.id, keep: !!keep });
      return res.json({ ok: true, id: r.id, duplicate: !!r.duplicate, with: keep ? cur.handed_name : to.name, kept: !!keep });
    }

    const l = await lead(u, intOr(d.id)); if (!l) throw fail(404, 'That lead is not there, or it is not yours.');

    if (a === 'log') {
      const outcome = OUTCOMES[d.outcome] ? d.outcome : null; if (!outcome) throw fail(400, 'Choose how the call went.');
      const note = str(d.note, 1000) || null;
      if (outcome === 'not_interested' && !str(d.lostReason, 200) && !note) throw fail(400, 'Write why they are not interested.');
      // what the caller learnt
      const qualify = { ...(l.qualify || {}) };
      for (const [k, max] of Object.entries(QUALIFY)) if (d.qualify && d.qualify[k] != null) { const val = str(d.qualify[k], max); if (val) qualify[k] = val; else delete qualify[k]; }
      const projectId = d.projectId === undefined ? l.project_id : intOr(d.projectId) || null;
      if (projectId && !u.projects.includes(projectId)) throw fail(403, 'That project is not on your login.');
      const visitDate = DATE.test(d.visitDate || '') ? d.visitDate : null;
      if (outcome === 'visit_booked' && !visitDate) throw fail(400, 'Give the site visit date.');
      const closed = outcome === 'booked' || outcome === 'not_interested';
      let next = DATE.test(d.nextDate || '') ? d.nextDate : null;
      if (!closed && !next) next = outcome === 'no_answer' ? addDays(istToday(), 1) : outcome === 'visit_booked' ? visitDate : addDays(istToday(), 3);
      const to = outcome === 'spoke' ? (l.status === 'new' ? 'contacted' : l.status) : outcome === 'visit_done' ? (l.status === 'booked' ? 'booked' : 'visit')
        : outcome === 'booked' ? 'booked' : outcome === 'not_interested' ? 'lost' : outcome === 'visit_booked' ? (l.status === 'new' ? 'contacted' : l.status) : l.status;
      await db.q(`update mkt_leads set name = coalesce($2, name), email = coalesce($3, email), project_id = $4, qualify = $5, status = $6, next_date = $7,
          visit_date = coalesce($8, visit_date), first_contact_at = coalesce(first_contact_at, now()), lost_reason = case when $6 = 'lost' then $9 else lost_reason end,
          note = concat_ws(E'\\n', note, $10::text), updated_at = now() where id = $1`,
        [l.id, str(d.name, 120) || null, str(d.email, 160) || null, projectId, qualify, to, closed ? null : next, visitDate, str(d.lostReason, 200) || note, `${fmtAt(new Date())} ${u.name}: ${OUTCOMES[outcome]}${note ? ' — ' + note : ''}`]);
      await L.statusChanged(l.id, l.status, to).catch(() => {});
      await event(l.id, u, 'call', { outcome, note, data: { next, visitDate, qualify: Object.keys(d.qualify || {}).length ? qualify : undefined, lostReason: str(d.lostReason, 200) || undefined } });
      await log('lead-' + outcome, l.id, { to, next });
      return res.json({ ok: true, status: to, next });
    }

    if (a === 'handover') {
      const reason = REASONS[d.reason] ? d.reason : 'visit';
      const auto = !d.to || d.to === 'auto';
      const to = auto ? await nextSales(l.project_id)
        : await db.one("select id, name, email, phone from users where id = $1 and not disabled and role in ('sales', 'presales', 'management', 'admin')", [intOr(d.to)]);
      if (!to) throw fail(400, auto ? 'No sales login opens this project yet: choose the sales person.' : 'Choose the sales person.');
      const visitDate = DATE.test(d.visitDate || '') ? d.visitDate : l.visit_date ? new Date(l.visit_date).toISOString().slice(0, 10) : null;
      const note = str(d.note, 1000) || null;
      await db.q(`update mkt_leads set handed_to = $2, handed_at = now(), handed_by = $3, assigned_to = $2, visit_date = coalesce($4, visit_date), handover_reason = $6,
          next_date = coalesce($4, next_date), first_contact_at = coalesce(first_contact_at, now()), status = case when status = 'new' then 'contacted' else status end,
          note = concat_ws(E'\\n', note, $5::text), updated_at = now() where id = $1`,
        [l.id, to.id, u.id, visitDate, `${fmtAt(new Date())} ${u.name}: handed over to ${to.name} (${REASONS[reason]})${visitDate ? ', site visit ' + visitDate : ''}${note ? ' — ' + note : ''}`, reason]);
      if (l.status === 'new') await L.statusChanged(l.id, 'new', 'contacted').catch(() => {});
      await event(l.id, u, 'handover', { note, data: { to: to.id, toName: to.name, visitDate, reason, auto } });
      // the sales person hears about it at once (email; the ERP's test address until it is live)
      const q = l.qualify || {};
      const rows = [['Why', REASONS[reason]], ['Name', l.name], ['Mobile', l.phone], ['Project', l.project], ['Budget', q.budget], ['Home', q.bhk], ['Buying for', q.purpose], ['When', q.timeline], ['Lives in', q.area], ['Site visit', visitDate], ['Note', note]].filter(([, v]) => v);
      const html = `<p>${u.name} handed you a lead${visitDate ? ' with a site visit on ' + visitDate : ''}.</p><table>${rows.map(([k, v]) => `<tr><td style="color:#666;padding:2px 12px 2px 0">${k}</td><td><b>${String(v).replace(/[<>&]/g, '')}</b></td></tr>`).join('')}</table><p>Open Pre-sales &amp; Sales in the ERP to see every call so far.</p>`;
      const sent = await require('../lib/mkt-flow').send([to.email], `New lead for you: ${l.name || l.phone}${visitDate ? ' · visit ' + visitDate : ''}`, html, { text: 'New lead', skipped: 'no email on the login' }).catch((e) => ({ skipped: e.message }));
      await log('lead-handover', l.id, { to: to.id, visitDate, reason, auto });
      return res.json({ ok: true, to: to.name, emailed: !(sent && sent.skipped) });
    }

    // ---------- offers, holds ----------
    if (a === 'offer.price' || a === 'offer.make') {
      // Rafi Sir, 24 Nov 2026: nobody buys on a phone call; the offer is made at the site, after the visit (or a walk-in)
      if (!l.visit_at) throw fail(400, 'The offer is made at the site: mark the site visit done first.');
      const unit = await db.one('select id, project_id, status, unit_no, held_lead_id from units where id = $1', [intOr(d.unitId)]);
      if (!unit) throw fail(404, 'That flat is not there.');
      if (!u.projects.includes(unit.project_id)) throw fail(403, 'That project is not on your login.');
      if (!(unit.status === 'available' || (unit.status === 'held' && unit.held_lead_id === l.id))) throw fail(409, `Flat ${unit.unit_no} is not available (${unit.status}).`);
      const parking = Math.max(0, Math.min(5, intOr(d.parking, 0)));
      const discount = Math.max(0, Number(String(d.discount == null ? '' : d.discount).replace(/[₹,\s]/g, '')) || 0);
      const pr = await O.price(unit.id, { parking, discount });
      const set = await O.settings(), over = pr.discountPct > set.limitPct + 1e-9;
      if (a === 'offer.price') return res.json({ ok: true, ...pr, unit: { id: unit.id, unit_no: unit.unit_no }, pl: undefined, needsApproval: over, limitPct: set.limitPct });
      if (!has(u, 'booking.create') && !canAll(u)) throw fail(403, 'Only sales makes offers.');
      const ask = str(d.clientAsk, 300);
      if (over && !ask) throw fail(400, `A discount above ${set.limitPct}% needs your approver's OK: write what the customer is asking for.`);
      // a newer offer replaces the earlier open ones on this lead
      await db.q("update mkt_offers set status = 'void' where lead_id = $1 and status in ('given', 'pending', 'approved')", [l.id]);
      const o = await db.one(`insert into mkt_offers (lead_id, unit_id, price_list_id, carpet, rate, parking, parking_amt, list_av, discount, discount_pct, av, gst, stamp_duty, registration, other_total, total, list_total, others, client_ask, note, status, created_by, floor_rate)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) returning id`,
        [l.id, unit.id, pr.pl.id, pr.sqft, pr.rate, parking, pr.parkingAmt, pr.listAv, pr.discount, pr.discountPct, pr.av, pr.gst, pr.stampDuty, pr.registration, pr.otherTotal, pr.total, pr.listTotal,
          JSON.stringify(pr.others || []), ask || null, str(d.note, 500) || null, over ? 'pending' : 'given', u.id, pr.floorRate]);
      await db.q(`update mkt_leads set project_id = coalesce(project_id, $2), next_date = coalesce($3, next_date), updated_at = now(), first_contact_at = coalesce(first_contact_at, now()),
          status = case when status = 'new' then 'contacted' else status end where id = $1`, [l.id, unit.project_id, DATE.test(d.nextDate || '') ? d.nextDate : null]);
      await event(l.id, u, 'offer', { outcome: over ? 'pending' : 'given', note: `${O.offerNo(o.id)}: flat ${unit.unit_no}, ${O.inr(pr.av)} agreement value${pr.discount ? `, discount ${O.inr(pr.discount)} (${pr.discountPct.toFixed(2)}%)` : ''}${over ? ', sent for approval' : ''}${ask ? '. Customer asks: ' + ask : ''}`, data: { offer: o.id } });
      let notified = null;
      if (over) notified = await O.notify(o.id).catch((e) => ({ error: e.message }));
      await log('offer', l.id, { offer: o.id, unit: unit.unit_no, discountPct: pr.discountPct, pending: over });
      return res.json({ ok: true, id: o.id, no: O.offerNo(o.id), status: over ? 'pending' : 'given', notified });
    }

    if (a === 'offer.decide') {
      const o = await db.one('select id, lead_id from mkt_offers where id = $1 and lead_id = $2', [intOr(d.offerId), l.id]); if (!o) throw fail(404, 'That offer is not there.');
      const r = await O.decide(o.id, u, !!d.approve, str(d.note, 500));
      await log(d.approve ? 'offer-approve' : 'offer-reject', l.id, { offer: o.id });
      return res.json(r);
    }

    if (a === 'hold') {
      if (!has(u, 'booking.create') && !canAll(u)) throw fail(403, 'Only sales holds a flat.');
      const set = await O.settings();
      const unit = await db.one('select id, project_id, unit_no, status, held_lead_id from units where id = $1', [intOr(d.unitId)]);
      if (!unit) throw fail(404, 'That flat is not there.');
      if (!u.projects.includes(unit.project_id)) throw fail(403, 'That project is not on your login.');
      const until = new Date(Date.now() + set.holdHours * 3600e3);
      const untilTxt = until.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
      const done = await db.tx(async (t) => {
        const cur = await t.one('select status, held_lead_id from units where id = $1 for update', [unit.id]);
        if (!(cur.status === 'available' || (cur.status === 'held' && cur.held_lead_id === l.id))) throw fail(409, `Flat ${unit.unit_no} is not available (${cur.status}).`);
        // one hold per customer: an earlier hold of this lead is let go
        if (l.hold_unit_id && l.hold_unit_id !== unit.id) await t.q("update units set status = 'available', hold_note = null, held_until = null, held_lead_id = null where id = $1 and held_lead_id = $2", [l.hold_unit_id, l.id]);
        await t.q("update units set status = 'held', held_until = $2, held_lead_id = $3, hold_note = $4 where id = $1", [unit.id, until, l.id, `Held by ${u.name} for ${l.name || l.phone} until ${untilTxt}`]);
        await t.q('update mkt_leads set hold_unit_id = $2, hold_until = $3, updated_at = now() where id = $1', [l.id, unit.id, until]);
        return true;
      });
      await event(l.id, u, 'hold', { note: `Flat ${unit.unit_no} held until ${untilTxt}.`, data: { unit: unit.id } });
      await log('hold', l.id, { unit: unit.unit_no, until });
      return res.json({ ok: done, until, unit: unit.unit_no });
    }

    if (a === 'release') {
      if (!l.hold_unit_id) throw fail(400, 'No flat is held for this customer.');
      await db.q("update units set status = 'available', hold_note = null, held_until = null, held_lead_id = null where id = $1 and held_lead_id = $2 and status = 'held'", [l.hold_unit_id, l.id]);
      await db.q('update mkt_leads set hold_unit_id = null, hold_until = null, updated_at = now() where id = $1', [l.id]);
      await event(l.id, u, 'hold', { note: 'Hold let go.' });
      return res.json({ ok: true });
    }

    if (a === 'sendback') {
      if (!l.handed_to) throw fail(400, 'This lead is not with sales.');
      if (!canAll(u) && l.handed_to !== u.id) throw fail(403, 'Only the sales person who has it sends it back.');
      const note = str(d.note, 500); if (!note) throw fail(400, 'Write why it goes back to pre-sales.');
      const back = l.handed_by ? await db.one("select id, name from users where id = $1 and not disabled and role in ('presales', 'management', 'admin')", [l.handed_by]) : null;
      await db.q(`update mkt_leads set handed_to = null, handed_at = null, handover_reason = null, assigned_to = $2, sent_back_at = now(), next_date = $3, updated_at = now(),
          note = concat_ws(E'\\n', note, $4::text) where id = $1`, [l.id, back ? back.id : null, istToday(), `${fmtAt(new Date())} ${u.name}: sent back to pre-sales — ${note}`]);
      if (!back) await L.route(l.id).catch(() => {});
      await event(l.id, u, 'sendback', { note, data: { from: l.handed_to, to: back ? back.id : null } });
      await log('lead-sendback', l.id, { from: l.handed_to });
      return res.json({ ok: true, to: back ? back.name : 'pre-sales' });
    }

    if (a === 'offer.email') {
      const o = await db.one(`select o.*, un.unit_no, un.typology, p.name as project from mkt_offers o join units un on un.id = o.unit_id join projects p on p.id = un.project_id
          where o.id = $1 and o.lead_id = $2`, [intOr(d.offerId), l.id]);
      if (!o) throw fail(404, 'That offer is not there.');
      if (!['given', 'approved'].includes(o.status)) throw fail(400, o.status === 'pending' ? 'The discount is still waiting for approval.' : 'Only an offer that stands goes to the customer.');
      const email = str(d.email, 160) || l.email;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'Write the customer\'s email.');
      const inr = O.inr, cell = (k, v, b) => `<tr><td style="color:#666;padding:4px 16px 4px 0">${k}</td><td style="text-align:right">${b ? '<b>' : ''}${v}${b ? '</b>' : ''}</td></tr>`;
      const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const html = `<p>Dear ${esc(l.name || 'Sir/Madam')},</p><p>Thank you for your interest in ${esc(o.project)}. As discussed, here is the cost sheet for flat ${esc(o.unit_no)}${o.typology ? ' (' + esc(o.typology) + ')' : ''}.</p>
        <table style="border-collapse:collapse;font-size:14px">${cell('Carpet area', Math.round(Number(o.carpet)) + ' sq ft')}${Number(o.parking) ? cell(`Parking (${o.parking})`, inr(o.parking_amt)) : ''}
        ${Number(o.discount) ? cell('Agreement value (list)', inr(o.list_av)) + cell('Discount', '− ' + inr(o.discount)) : ''}${cell('Agreement value', inr(o.av), true)}${cell('GST', inr(o.gst))}
        ${cell('Stamp duty', inr(o.stamp_duty))}${cell('Registration', inr(o.registration))}${Number(o.other_total) ? cell('Other charges', inr(o.other_total)) : ''}${cell('Total', inr(o.total), true)}</table>
        <p style="color:#666;font-size:13px">Offer ${O.offerNo(o.id)}, ${fmtAt(new Date())}. Prices are as on today; the flat is reserved only once it is booked.</p><p>Regards,<br>${esc(u.name)}<br>Dream India Realty</p>`;
      const sent = await require('../lib/mkt-flow').send([email], `Cost sheet: flat ${o.unit_no}, ${o.project}`, html, { text: 'Cost sheet', skipped: 'no email' });
      if (!l.email) await db.q('update mkt_leads set email = $2 where id = $1 and email is null', [l.id, email]);
      await event(l.id, u, 'offer', { outcome: 'emailed', note: `Cost sheet ${O.offerNo(o.id)} emailed to ${email}.`, data: { offer: o.id } });
      await log('offer-email', l.id, { offer: o.id });
      return res.json({ ok: true, to: email, emailed: !(sent && sent.skipped) });
    }

    if (a === 'assign') {
      if (!canAll(u)) throw fail(403, 'Only pre-sales leads and management reassign leads.');
      const to = await db.one('select id, name from users where id = $1 and not disabled', [intOr(d.to)]); if (!to) throw fail(400, 'Choose who takes it.');
      await db.q('update mkt_leads set assigned_to = $2, updated_at = now() where id = $1', [l.id, to.id]);
      await event(l.id, u, 'assign', { note: `Given to ${to.name}.`, data: { to: to.id } });
      await log('lead-assign', l.id, { to: to.id });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});

module.exports.OUTCOMES = OUTCOMES;
