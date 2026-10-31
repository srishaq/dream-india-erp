// From rupees to bookings: what marketing cost and what it brought, by campaign, by project and by lead source.
//   Spend   = Meta / Google Ads (day by day or month by month as pulled) + campaigns typed in + every other spend entry
//             (hoardings, newspaper, portals, events, agency, shoots…) + channel partner brokerage on bookings (shown apart).
//   Results = the leads that came in in the period, and what became of them: first call, site visit, booking (a lead is
//             booked when the CRM has a booking for that phone number in that project, made after the enquiry, or when
//             sales linked the booking to the lead), and the booking's agreement value.
// Periods: d30 (last 30 days), fy (this financial year, from 1 April), all.
const db = require('./db');

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const fyStart = () => { const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1; return `${y}-04-01`; };
function range(period) {
  if (period === 'd30') return { from: new Date(Date.parse(istToday()) - 29 * 864e5).toISOString().slice(0, 10), days: true, label: 'Last 30 days' };
  if (period === 'all') return { from: '2000-01-01', days: false, label: 'All time' };
  const f = fyStart(); return { from: f, days: false, label: `This financial year (since 1 Apr ${f.slice(0, 4)})` };
}
const n = (v) => Number(v) || 0;
const per = (a, b) => (b ? a / b : null);

// Each lead of the period with its booking (if any). Used here and by the rows behind the boxes.
const LEADS_SQL = (where) => `
  select l.id, l.name, l.phone, l.campaign_id, l.project_id, case when l.owner_cp_id is not null then 'channel_partner' else l.source end as source, l.owner_cp_id, l.status, l.created_at, l.first_contact_at, l.visit_at, l.assigned_to,
         bk.id as booking_id, bk.agreement_value as value, bk.booking_date, bk.unit
    from mkt_leads l
    left join lateral (
      select b.id, b.agreement_value, b.booking_date, un.unit_no as unit from bookings b join units un on un.id = b.unit_id
       where b.status in ('active', 'pending') and (l.project_id is null or un.project_id = l.project_id)
         and (b.id = l.booking_id or (l.booking_id is null and b.booking_date >= (l.created_at + interval '330 minutes')::date - 3
              and exists (select 1 from booking_applicants ba join buyers y on y.id = ba.buyer_id
                           where ba.booking_id = b.id and right(regexp_replace(coalesce(y.phone, ''), '\\D', '', 'g'), 10) = l.phone)))
       order by (b.id = l.booking_id) desc, b.booking_date limit 1) bk on true
   where ${where}`;

async function leadsOf(from, projectId) {
  return db.q(LEADS_SQL(`l.created_at >= $1::date - interval '330 minutes' ${projectId ? 'and l.project_id = ' + +projectId : ''}`) + ' order by l.created_at desc', [from]);
}
const stage = (rows) => {
  const leads = rows.length, contacted = rows.filter((r) => r.first_contact_at || r.status !== 'new').length;
  const visits = rows.filter((r) => r.visit_at || ['visit', 'booked'].includes(r.status) || r.booking_id).length;
  const bk = rows.filter((r) => r.booking_id || r.status === 'booked'), value = bk.reduce((a, r) => a + n(r.value), 0);
  return { leads, contacted, visits, bookings: bk.length, value };
};
const kpis = (spend, s) => ({ ...s, spend, cpl: per(spend, s.leads), cpv: per(spend, s.visits), cpb: per(spend, s.bookings), roi: per(s.value, spend) });

// Telecallers' pay for the project's partner launches (days on call sheets × daily rate), in the period.
async function teleCost(projectId, from) {
  const r = await db.one(`select coalesce(sum(x.rate), 0) as cost, count(*)::int as days from (
      select distinct o.caller_id, o.call_date, coalesce(c.daily_rate, 0) as rate from tm_outcomes o join tm_projects t on t.id = o.tm_project_id left join tm_callers c on c.id = o.caller_id
       where o.call_date >= $1::date ${projectId ? 'and t.project_id = ' + +projectId : ''}) x`, [from]).catch(() => ({ cost: 0, days: 0 }));
  const v = await db.one(`select count(*)::int as calls, count(*) filter (where o.code = 2)::int as visits from tm_outcomes o join tm_projects t on t.id = o.tm_project_id
       where o.call_date >= $1::date ${projectId ? 'and t.project_id = ' + +projectId : ''}`, [from]).catch(() => ({ calls: 0, visits: 0 }));
  return { cost: n(r.cost), days: r.days, calls: v.calls, visits: v.visits };
}
async function results(scope, period = 'fy') {
  const projectId = scope && scope !== 'company' ? +scope : null, R = range(period), from = R.from;
  const pj = (col) => (projectId ? `and ${col} = ${+projectId}` : '');
  const camps = await db.q(`select c.id, c.name, c.project_id, p.name as project, c.source, c.ext_status, c.status, c.plan_status, c.channel,
      case when c.source in ('meta', 'google') then
        case when $2 then coalesce((select sum(d.spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day >= $1::date), 0)
             else coalesce((select sum(m.spend) from mkt_campaign_months m where m.campaign_id = c.id and m.month >= date_trunc('month', $1::date)), 0) end
      else case when coalesce(c.start_on, c.created_at::date) >= $1::date or (c.end_on is not null and c.end_on >= $1::date) then coalesce(c.spent, 0) else 0 end end as ad_spend,
      case when c.source in ('meta', 'google') then
        case when $2 then coalesce((select sum(d.leads) from mkt_campaign_days d where d.campaign_id = c.id and d.day >= $1::date), 0)
             else coalesce((select sum(m.leads) from mkt_campaign_months m where m.campaign_id = c.id and m.month >= date_trunc('month', $1::date)), 0) end else 0 end as platform_leads,
      coalesce((select sum(s.amount) from mkt_spend s where s.campaign_id = c.id and s.spent_on >= $1::date), 0) as other_spend
    from mkt_campaigns c left join projects p on p.id = c.project_id where true ${pj('c.project_id')}`, [from, R.days]);
  const leads = await leadsOf(from, projectId);
  const byCamp = {}; for (const l of leads) if (l.campaign_id) (byCamp[l.campaign_id] = byCamp[l.campaign_id] || []).push(l);
  const campaigns = camps.map((c) => { const spend = n(c.ad_spend) + n(c.other_spend), s = stage(byCamp[c.id] || []);
    return { id: c.id, name: c.name, project_id: c.project_id, project: c.project, source: c.source, status: c.ext_status || c.status, ...kpis(spend, s), platform_leads: n(c.platform_leads), leads: Math.max(s.leads, 0) }; })
    .filter((c) => c.spend > 0 || c.leads > 0).sort((a, b) => b.spend - a.spend || b.leads - a.leads);

  // spend entries (other than ads), with the ones not tied to a campaign counted for their project
  const entries = await db.q(`select s.id, s.project_id, p.name as project, s.campaign_id, c.name as campaign, s.kind, s.source, s.vendor, s.amount, to_char(s.spent_on, 'YYYY-MM-DD') as spent_on,
      to_char(s.until, 'YYYY-MM-DD') as until, s.note, s.file_name, u.name as created_name from mkt_spend s left join projects p on p.id = s.project_id left join mkt_campaigns c on c.id = s.campaign_id
      left join users u on u.id = s.created_by where s.spent_on >= $1::date ${pj('s.project_id')} order by s.spent_on desc, s.id desc`, [from]);
  // channel partner brokerage on the bookings of the period (counted apart: it is paid per booking, not for leads)
  const bks = await db.q(`select un.project_id, count(*)::int as n, coalesce(sum(b.agreement_value), 0) as value,
      coalesce(sum(case when b.cp_id is not null or coalesce(trim(b.cp_name), '') not in ('', 'na', 'NA', '-') then coalesce(b.brokerage, b.agreement_value * b.brokerage_pct / 100, 0) else 0 end), 0) as cp,
      count(*) filter (where b.cp_id is not null or coalesce(trim(b.cp_name), '') not in ('', 'na', 'NA', '-'))::int as cp_n
    from bookings b join units un on un.id = b.unit_id where b.status in ('active', 'pending') and b.booking_date >= $1::date ${pj('un.project_id')} group by un.project_id`, [from]);
  const projects = await db.q(`select id, name from projects where active ${pj('id')} order by id`);
  const budgets = await budgetsFor(fyStart());
  const byProject = [...projects, { id: null, name: 'Company-wide (no project)' }].map((p) => {
    const cs = campaigns.filter((c) => (c.project_id || null) === p.id), loose = entries.filter((e) => (e.project_id || null) === p.id && !e.campaign_id);
    const spend = cs.reduce((a, c) => a + c.spend, 0) + loose.reduce((a, e) => a + n(e.amount), 0);
    const s = stage(leads.filter((l) => (l.project_id || null) === p.id)), b = bks.find((x) => (x.project_id || null) === p.id) || { n: 0, value: 0, cp: 0, cp_n: 0 };
    const budget = budgets[p.id == null ? 'company' : String(p.id)] || null;
    return { id: p.id, name: p.name, ...kpis(spend, s), cp: n(b.cp), cp_bookings: b.cp_n, all_bookings: b.n, sales_value: n(b.value), total_cost: spend + n(b.cp),
      cost_pct: per(spend + n(b.cp), n(b.value)), budget, budget_used: budget && period === 'fy' ? per(spend, budget) : null };
  }).filter((p) => p.id != null || p.spend > 0 || p.leads > 0);
  // by lead source: leads and what became of them; spend where we know what bought them
  const srcSpend = {};
  for (const c of campaigns) { const k = c.source === 'meta' ? 'meta_ads' : c.source === 'google' ? 'google_ads' : null; if (k) srcSpend[k] = (srcSpend[k] || 0) + c.spend; }
  for (const e of entries) if (e.source && !e.campaign_id) srcSpend[e.source] = (srcSpend[e.source] || 0) + n(e.amount);
  const srcLeads = {}; for (const l of leads) (srcLeads[l.source] = srcLeads[l.source] || []).push(l);
  const bySource = [...new Set([...Object.keys(srcLeads), ...Object.keys(srcSpend)])].map((k) => ({ source: k, ...kpis(srcSpend[k] || 0, stage(srcLeads[k] || [])) })).sort((a, b) => b.leads - a.leads || b.spend - a.spend);
  const adSpend = campaigns.reduce((a, c) => a + c.spend, 0) - entries.filter((e) => e.campaign_id).reduce((a, e) => a + n(e.amount), 0);
  const tele = await teleCost(projectId, from);
  const otherSpend = entries.reduce((a, e) => a + n(e.amount), 0), spend = adSpend + otherSpend + tele.cost, cp = bks.reduce((a, b) => a + n(b.cp), 0);
  if (tele.cost || tele.calls) { const t = bySource.find((x) => x.source === 'telecalling'); if (t) { t.spend += tele.cost; Object.assign(t, kpis(t.spend, t)); } else bySource.push({ source: 'telecalling', ...kpis(tele.cost, { leads: tele.calls, contacted: tele.calls, visits: tele.visits, bookings: 0, value: 0 }), calls: tele.calls }); }
  for (const p of byProject) if (p.id) { const t = await teleCost(p.id, from); if (t.cost) { p.spend += t.cost; p.tele = t.cost; Object.assign(p, kpis(p.spend, p)); p.total_cost = p.spend + p.cp; p.cost_pct = per(p.total_cost, p.sales_value); p.budget_used = p.budget && period === 'fy' ? per(p.spend, p.budget) : null; } }
  const tot = stage(leads);
  // how fast new leads were called
  const timed = leads.filter((l) => l.first_contact_at), mins = timed.map((l) => (Date.parse(l.first_contact_at) - Date.parse(l.created_at)) / 60000).filter((m) => m >= 0).sort((a, b) => a - b);
  const respond = { leads: leads.length, called: timed.length, within15: mins.filter((m) => m <= 15).length, median: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null,
    waiting: leads.filter((l) => !l.first_contact_at && l.status === 'new').length };
  return { period, label: R.label, from, totals: { ...kpis(spend, tot), adSpend, otherSpend, teleSpend: tele.cost, teleDays: tele.days, cp, salesValue: bks.reduce((a, b) => a + n(b.value), 0), allBookings: bks.reduce((a, b) => a + b.n, 0) },
    respond, campaigns, byProject, bySource, entries: entries.map((e) => ({ ...e, amount: n(e.amount) })) };
}

// The rows behind a results box.
async function drill(key, scope, period) {
  const projectId = scope && scope !== 'company' ? +scope : null, R = range(period);
  const leads = await leadsOf(R.from, projectId);
  const names = Object.fromEntries((await db.q('select id, name from mkt_campaigns')).map((c) => [c.id, c.name]));
  const pn = Object.fromEntries((await db.q('select id, name from projects')).map((p) => [p.id, p.name]));
  const pick = key === 'visits' ? leads.filter((r) => r.visit_at || ['visit', 'booked'].includes(r.status) || r.booking_id) : key === 'bookings' || key === 'value' ? leads.filter((r) => r.booking_id || r.status === 'booked')
    : key === 'waiting' ? leads.filter((r) => !r.first_contact_at && r.status === 'new') : leads;
  const mins = (r) => (r.first_contact_at ? Math.round((Date.parse(r.first_contact_at) - Date.parse(r.created_at)) / 60000) : null);
  return { title: { visits: 'Leads who came for a site visit', bookings: 'Leads who booked', value: 'Leads who booked', waiting: 'New leads nobody has called yet' }[key] || 'Leads', sub: R.label,
    columns: [['day', 'Came in', 'date'], ['name', 'Name'], ['phone', 'Phone'], ['source', 'Source'], ['campaign', 'Campaign'], ['project', 'Project'], ['status', 'Status'], ['called', 'Called after (min)', 'n'], ['unit', 'Unit'], ['value', 'Booking value', 'inr']],
    rows: pick.map((r) => ({ day: new Date(Date.parse(r.created_at) + 5.5 * 3600e3).toISOString().slice(0, 10), name: r.name, phone: r.phone, source: r.source, campaign: names[r.campaign_id] || '', project: pn[r.project_id] || '',
      status: r.status, called: mins(r), unit: r.unit || '', value: r.value == null ? null : n(r.value) })) };
}

// Marketing budgets per project and financial year (settings 'mkt_budgets': { '<fy>': { company|<projectId>: amount } })
async function budgetsFor(fy) { const v = (await db.one("select value from settings where key = 'mkt_budgets'"))?.value || {}; return v[fy] || {}; }
async function saveBudgets(fy, map) {
  const v = (await db.one("select value from settings where key = 'mkt_budgets'"))?.value || {};
  v[fy] = Object.fromEntries(Object.entries(map || {}).map(([k, a]) => [k, Number(String(a).replace(/[,₹\s]/g, ''))]).filter(([k, a]) => (k === 'company' || /^\d+$/.test(k)) && a > 0));
  await db.q("insert into settings (key, value) values ('mkt_budgets', $1) on conflict (key) do update set value = excluded.value", [v]);
  return v[fy];
}

module.exports = { teleCost, results, drill, range, fyStart, budgetsFor, saveBudgets, LEADS_SQL };
