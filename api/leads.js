// Pre-sales & Sales (/leads): the middle of the journey, from a lead coming in to a booking in the CRM.
// Every lead (IVR, website, Facebook/Instagram, WhatsApp, portals, walk-ins) lands with the pre-sales caller, who calls it,
// notes each call, asks the qualifying questions and hands a qualified buyer to a sales person with the site-visit date.
// The sales person sees only the leads handed to them, records the visit and follow-ups, and closes it as booked or lost.
// GET  → the lists for this login (?id= → one lead with every call)
// POST {action}: log | handover | add | assign
//   log      {id, outcome, note?, nextDate?, visitDate?, qualify?, name?, email?, projectId?, lostReason?}
//   handover {id, to, visitDate?, note?}            add {name?, phone, email?, projectId?, source?, note?}
//   assign   {id, to}  (leads.all: give a lead to someone else)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const canAll = (u) => has(u, 'leads.all');
const canWork = (u) => has(u, 'leads.work') || canAll(u);
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
        (select count(*)::int from mkt_lead_events e where e.lead_id = l.id and e.kind = 'call') as calls,
        (select e.note from mkt_lead_events e where e.lead_id = l.id and e.note is not null and e.kind <> 'assign' order by e.at desc limit 1) as last_note,
        exists (select 1 from bookings b join booking_applicants ba on ba.booking_id = b.id join buyers y on y.id = ba.buyer_id
                where right(regexp_replace(coalesce(y.phone, ''), '\\D', '', 'g'), 10) = l.phone and b.status in ('active', 'pending')) as is_buyer
      from mkt_leads l left join projects p on p.id = l.project_id left join users a on a.id = l.assigned_to left join users h on h.id = l.handed_to
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
      count(*) filter (where booked_at is not null)::int as booked
    from mkt_leads where created_at > now() - interval '30 days'`);
  const bySource = await db.q(`select source, count(*)::int as leads, count(*) filter (where visit_at is not null)::int as visits, count(*) filter (where booked_at is not null)::int as booked
    from mkt_leads where created_at > now() - interval '30 days' group by source order by 2 desc`);
  return { ...r, bySource };
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
    if (!canWork(u)) throw fail(403, 'Your login does not open Pre-sales & Sales.');
    const q = req.query || {};
    if (q.id) {
      const l = await lead(u, intOr(q.id)); if (!l) throw fail(404, 'That lead is not there, or it is not yours.');
      const events = await db.q('select e.at, e.kind, e.outcome, e.note, e.data, us.name as who from mkt_lead_events e left join users us on us.id = e.user_id where e.lead_id = $1 order by e.at desc', [l.id]);
      const calls = await db.q("select called_at, status, duration, recording_url from mkt_ivr_calls where caller = $1 order by called_at desc limit 20", [l.phone]).catch(() => []);
      return res.json({ lead: l, events, ivr: calls });
    }
    const projects = (await db.q('select id, name from projects where active order by name')).filter((p) => u.projects.includes(p.id));
    const people = await db.q("select id, name, role from users where not disabled and role in ('presales', 'sales') order by name");
    return res.json({ me: { id: u.id, name: u.name, all: canAll(u), role: u.role }, today: istToday(), leads: await list(u), summary: await summary(u), projects, people, outcomes: OUTCOMES });
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
      const to = await db.one("select id, name, email, phone from users where id = $1 and not disabled and role in ('sales', 'presales', 'management', 'admin')", [intOr(d.to)]);
      if (!to) throw fail(400, 'Choose the sales person.');
      const visitDate = DATE.test(d.visitDate || '') ? d.visitDate : l.visit_date ? new Date(l.visit_date).toISOString().slice(0, 10) : null;
      const note = str(d.note, 1000) || null;
      await db.q(`update mkt_leads set handed_to = $2, handed_at = now(), handed_by = $3, assigned_to = $2, visit_date = coalesce($4, visit_date),
          next_date = coalesce($4, next_date), first_contact_at = coalesce(first_contact_at, now()), status = case when status = 'new' then 'contacted' else status end,
          note = concat_ws(E'\\n', note, $5::text), updated_at = now() where id = $1`,
        [l.id, to.id, u.id, visitDate, `${fmtAt(new Date())} ${u.name}: handed over to ${to.name}${visitDate ? ', site visit ' + visitDate : ''}${note ? ' — ' + note : ''}`]);
      if (l.status === 'new') await L.statusChanged(l.id, 'new', 'contacted').catch(() => {});
      await event(l.id, u, 'handover', { note, data: { to: to.id, toName: to.name, visitDate } });
      // the sales person hears about it at once (email; the ERP's test address until it is live)
      const q = l.qualify || {};
      const rows = [['Name', l.name], ['Mobile', l.phone], ['Project', l.project], ['Budget', q.budget], ['Home', q.bhk], ['Buying for', q.purpose], ['When', q.timeline], ['Lives in', q.area], ['Site visit', visitDate], ['Note', note]].filter(([, v]) => v);
      const html = `<p>${u.name} handed you a lead${visitDate ? ' with a site visit on ' + visitDate : ''}.</p><table>${rows.map(([k, v]) => `<tr><td style="color:#666;padding:2px 12px 2px 0">${k}</td><td><b>${String(v).replace(/[<>&]/g, '')}</b></td></tr>`).join('')}</table><p>Open Pre-sales &amp; Sales in the ERP to see every call so far.</p>`;
      const sent = await require('../lib/mkt-flow').send([to.email], `New lead for you: ${l.name || l.phone}${visitDate ? ' · visit ' + visitDate : ''}`, html, { text: 'New lead', skipped: 'no email on the login' }).catch((e) => ({ skipped: e.message }));
      await log('lead-handover', l.id, { to: to.id, visitDate });
      return res.json({ ok: true, to: to.name, emailed: !(sent && sent.skipped) });
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
