// Money controls for Marketing.
//   alerts()  each morning: a campaign that spent more than its approved daily budget yesterday, one that will run past
//             its monthly budget at this pace, a cost per lead up by more than 30% on the week before, a project past
//             90% of its marketing budget for the year, and ads that are tiring. Emailed to Management (once per item).
//   digest()  Monday morning: last week in one email — spend, leads, visits, bookings, cost per lead, the best and the
//             worst campaign, how fast leads were called, leads not called.
//   request() / decide(): pausing a Meta campaign, starting it again or changing its daily budget. Asked by the marketing
//             team, done on Meta only when Management approves (in the ERP or from the email); Management can do it at once.
const db = require('./db');
const flow = require('./mkt-flow');

const e = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (n) => (n == null || !isFinite(n) ? '–' : '₹' + Math.round(+n).toLocaleString('en-IN'));
const pct = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x * 100) + '%');
const n = (v) => Number(v) || 0;
const istDay = (d = 0) => new Date(Date.now() + 5.5 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
const once = async (key) => { const r = await db.one("insert into job_marks (key) values ($1) on conflict (key) do nothing returning key", [key]); return !!r; };
const mailMgmt = async (subject, html) => flow.send((await flow.approvers()).map((x) => x.email), subject, html);

// Ads that are tiring: shown too often to the same people (frequency over 3 in 7 days), or clicked much less than at start.
async function tiring(campaignId = null) {
  const rows = await db.q(`select a.id, a.ext_id, a.name, a.status, a.campaign_id, c.name as campaign,
      sum(d.spend) filter (where d.day > current_date - 7) as spend7, sum(d.impressions) filter (where d.day > current_date - 7) as imp7, sum(d.clicks) filter (where d.day > current_date - 7) as clk7,
      sum(d.impressions) filter (where d.day <= current_date - 7) as impB, sum(d.clicks) filter (where d.day <= current_date - 7) as clkB, max(d.frequency) filter (where d.day > current_date - 7) as freq
    from mkt_ads a join mkt_campaigns c on c.id = a.campaign_id join mkt_ad_days d on d.ad_id = a.id where d.day > current_date - 40 ${campaignId ? 'and a.campaign_id = ' + +campaignId : ''}
    group by a.id, c.name having sum(d.spend) filter (where d.day > current_date - 7) > 0`);
  return rows.map((r) => { const ctr7 = n(r.imp7) ? n(r.clk7) / n(r.imp7) : null, ctrB = n(r.impb) ? n(r.clkb) / n(r.impb) : null;
    const why = []; if (n(r.freq) > 3) why.push(`seen ${(+r.freq).toFixed(1)} times per person`); if (ctr7 != null && ctrB && ctr7 < ctrB * 0.7 && n(r.imp7) > 2000) why.push(`clicks down ${Math.round((1 - ctr7 / ctrB) * 100)}% on before`);
    return { ...r, ctr7, ctrB, why }; }).filter((r) => r.why.length);
}

async function alerts({ force = false } = {}) {
  const day = istDay(), items = [];
  const camps = await db.q(`select c.id, c.name, c.daily_budget, c.monthly_budget, c.ext_daily_budget, p.name as project,
      coalesce((select sum(spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day = current_date - 1), 0) as yday,
      coalesce((select sum(spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day >= date_trunc('month', current_date)), 0) as month,
      coalesce((select sum(spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 7), 0) as s7,
      coalesce((select sum(leads + messages) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 7), 0) as l7,
      coalesce((select sum(spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 14 and d.day <= current_date - 7), 0) as s14,
      coalesce((select sum(leads + messages) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 14 and d.day <= current_date - 7), 0) as l14
    from mkt_campaigns c left join projects p on p.id = c.project_id where exists (select 1 from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 3 and d.spend > 0)`);
  const t = new Date(Date.now() + 5.5 * 3600e3), dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(), dayOf = t.getUTCDate();
  for (const c of camps) {
    const daily = n(c.daily_budget) || n(c.ext_daily_budget);
    if (daily && n(c.yday) > daily * 1.1) items.push({ key: `over-day:${c.id}:${day}`, text: `<b>${e(c.name)}</b> spent ${inr(c.yday)} yesterday; the approved daily budget is ${inr(daily)}.` });
    if (n(c.monthly_budget) && dayOf > 3) { const proj = (n(c.month) / Math.max(1, dayOf - 1)) * dim; if (proj > n(c.monthly_budget) * 1.05) items.push({ key: `over-month:${c.id}:${day.slice(0, 7)}`, text: `<b>${e(c.name)}</b> has spent ${inr(c.month)} this month; at this pace it reaches ${inr(proj)} against the approved ${inr(c.monthly_budget)}.` }); }
    const cpl7 = n(c.l7) ? n(c.s7) / n(c.l7) : null, cpl14 = n(c.l14) ? n(c.s14) / n(c.l14) : null;
    if (cpl7 && cpl14 && cpl7 > cpl14 * 1.3 && n(c.s7) > 2000) items.push({ key: `cpl:${c.id}:${day}`, text: `<b>${e(c.name)}</b>: cost per lead ${inr(cpl7)} this week, up ${Math.round((cpl7 / cpl14 - 1) * 100)}% on ${inr(cpl14)} the week before.` });
    if (n(c.s7) > 3000 && !n(c.l7)) items.push({ key: `noleads:${c.id}:${day}`, text: `<b>${e(c.name)}</b> spent ${inr(c.s7)} in 7 days and brought no lead or chat.` });
  }
  // project budgets for the year
  const R = require('./mkt-results'), res = await R.results('company', 'fy');
  for (const p of res.byProject) if (p.budget && p.spend > p.budget * 0.9) items.push({ key: `budget:${p.id || 'company'}:${res.from}:${p.spend > p.budget ? 'over' : '90'}`, text: `<b>${e(p.name)}</b> has used ${pct(p.spend / p.budget)} of its marketing budget for the year (${inr(p.spend)} of ${inr(p.budget)}).` });
  for (const a of await tiring()) items.push({ key: `tired:${a.id}:${day.slice(0, 7)}`, text: `Ad <b>${e(a.name)}</b> (${e(a.campaign)}) is tiring: ${e(a.why.join(', '))}. Time for a new design.` });
  const fresh = []; for (const it of items) if (force || (await once('mkt-alert:' + it.key))) fresh.push(it);
  if (!fresh.length) return { alerts: 0 };
  const mail = await mailMgmt(`Marketing: ${fresh.length} thing${fresh.length > 1 ? 's' : ''} to look at`, `<p>Good morning. From the Marketing tab:</p><ul>${fresh.map((x) => `<li style="margin:0 0 8px">${x.text}</li>`).join('')}</ul><p><a href="${flow.host()}/#/marketing">Open Active campaigns</a></p>`).catch((x) => ({ error: x.message }));
  return { alerts: fresh.length, mail };
}

// The Monday email
async function digest({ force = false } = {}) {
  const t = new Date(Date.now() + 5.5 * 3600e3);
  if (!force && t.getUTCDay() !== 1) return { skipped: 'not Monday' };
  if (!force && !(await once('mkt-digest:' + istDay()))) return { skipped: 'already sent' };
  const W = await db.one(`select coalesce(sum(d.spend), 0) as spend, coalesce(sum(d.leads), 0)::int as leads, coalesce(sum(d.messages), 0)::int as chats from mkt_campaign_days d where d.day between current_date - 7 and current_date - 1`);
  const P = await db.one(`select coalesce(sum(d.spend), 0) as spend, coalesce(sum(d.leads), 0)::int as leads from mkt_campaign_days d where d.day between current_date - 14 and current_date - 8`);
  const other = await db.one("select coalesce(sum(amount), 0) as a from mkt_spend where spent_on between current_date - 7 and current_date - 1");
  const L = await db.one(`select count(*)::int as leads, count(*) filter (where first_contact_at is not null)::int as called,
      count(*) filter (where first_contact_at is not null and first_contact_at - created_at <= interval '15 minutes')::int as fast,
      count(*) filter (where status = 'new' and first_contact_at is null)::int as waiting
    from mkt_leads where created_at >= (current_date - 7)::timestamp - interval '330 minutes' and created_at < current_date::timestamp - interval '330 minutes'`);
  const V = await db.one(`select count(*) filter (where visit_at >= now() - interval '7 days')::int as visits, count(*) filter (where booked_at >= now() - interval '7 days')::int as booked from mkt_leads`);
  const camps = await db.q(`select c.name, sum(d.spend) as spend, sum(d.leads + d.messages)::int as leads from mkt_campaign_days d join mkt_campaigns c on c.id = d.campaign_id where d.day between current_date - 7 and current_date - 1 group by c.id having sum(d.spend) > 500 order by 2 desc`);
  const withCpl = camps.map((c) => ({ ...c, cpl: c.leads ? n(c.spend) / c.leads : null }));
  const ranked = withCpl.filter((c) => c.cpl != null).sort((a, b) => a.cpl - b.cpl), best = ranked[0], worst = ranked.length > 1 ? ranked[ranked.length - 1] : null, zero = withCpl.filter((c) => !c.leads);
  const spend = n(W.spend) + n(other.a), allLeads = Math.max(L.leads, W.leads);
  const row = (k, v, extra = '') => `<tr><td style="padding:6px 12px 6px 0;color:#667085">${k}</td><td style="padding:6px 0"><b>${v}</b> ${extra}</td></tr>`;
  const ch = (a, b) => (b ? ` <span style="color:${a > b ? '#B42318' : '#067647'}">${a > b ? '▲' : '▼'} ${Math.round(Math.abs(a / b - 1) * 100)}% on the week before</span>` : '');
  const html = `<p>Last week in Marketing (Monday to Sunday):</p><table style="border-collapse:collapse;font-size:14px">
    ${row('Spent', inr(spend), `(ads ${inr(W.spend)}${n(other.a) ? ', other ' + inr(other.a) : ''})${ch(n(W.spend), n(P.spend))}`)}
    ${row('Leads', allLeads, W.chats ? `+ ${W.chats} WhatsApp chats from ads` : '')}
    ${row('Cost per lead', inr(allLeads ? spend / allLeads : null), ch(allLeads ? n(W.spend) / allLeads : 0, n(P.leads) ? n(P.spend) / n(P.leads) : 0))}
    ${row('Site visits', V.visits)}${row('Bookings from leads', V.booked)}
    ${row('Called within 15 minutes', L.leads ? `${pct(L.fast / L.leads)}` : '–', `(${L.called} of ${L.leads} called)`)}
    ${row('Still not called', L.waiting)}</table>
    ${best ? `<p>Best campaign: <b>${e(best.name)}</b>, ${inr(best.cpl)} per lead (${best.leads} leads for ${inr(best.spend)}).</p>` : ''}
    ${worst ? `<p>Costliest per lead: <b>${e(worst.name)}</b>, ${inr(worst.cpl)} per lead.</p>` : ''}
    ${zero.length ? `<p style="color:#B42318">No leads at all: ${zero.map((c) => `<b>${e(c.name)}</b> (${inr(c.spend)})`).join(', ')}.</p>` : ''}
    <p><a href="${flow.host()}/#/marketing">Open Marketing</a></p>`;
  return { mail: await mailMgmt(`Marketing last week: ${inr(spend)} spent, ${allLeads} leads, ${V.booked} booked`, html).catch((x) => ({ error: x.message })) };
}

// ---------- pausing a campaign, or changing its budget, with approval ----------
const KIND = { pause: 'Pause', resume: 'Start again', budget: 'Change the daily budget to' };
async function request(user, { campaignId, kind, value, reason }, { canApprove }) {
  if (!KIND[kind]) throw Object.assign(new Error('Pause, start again or change the budget?'), { status: 400 });
  const c = await db.one("select id, name, ext_id, source, ext_daily_budget from mkt_campaigns where id = $1", [campaignId]);
  if (!c || c.source !== 'meta' || !c.ext_id) throw Object.assign(new Error('Only campaigns running on Meta Ads can be changed from here.'), { status: 400 });
  const v = kind === 'budget' ? Number(String(value || '').replace(/[,₹\s]/g, '')) : null;
  if (kind === 'budget' && !(v >= 100)) throw Object.assign(new Error('Enter the new daily budget (at least ₹100).'), { status: 400 });
  const r = await db.one("insert into mkt_changes (campaign_id, kind, value, reason, requested_by) values ($1, $2, $3, $4, $5) returning id", [c.id, kind, v, String(reason || '').slice(0, 500) || null, user.id]);
  if (canApprove) return decide(r.id, true, user);
  // Management is asked by email (signed buttons, like campaign approvals)
  const html = async (to) => `<p>${e(user.name)} asks to <b>${KIND[kind].toLowerCase()}${kind === 'budget' ? ' ' + inr(v) : ''}</b> for the Meta campaign <b>${e(c.name)}</b>${kind === 'budget' && c.ext_daily_budget ? ` (now ${inr(c.ext_daily_budget)} a day)` : ''}.</p>${reason ? `<p style="background:#F7F7FB;padding:10px;border-radius:8px">${e(reason)}</p>` : ''}
    <p><a href="${flow.host()}/api/marketing?approve=${encodeURIComponent(await flow.sign({ r: r.id, k: 'change', u: to.id, e: Date.now() + 7 * 864e5 }))}" style="display:inline-block;background:#140C59;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Approve</a>
    <a href="${flow.host()}/#/marketing" style="margin-left:10px">Open Active campaigns</a></p>`;
  const people = await flow.approvers();
  const sent = [];
  for (const p of people.slice(0, 5)) sent.push(await flow.send([p.email], `Approve: ${KIND[kind].toLowerCase()} ${c.name}`, await html(p)).catch((x) => ({ error: x.message })));
  return { ok: true, id: r.id, pending: true, mail: sent[0] };
}
async function decide(id, approve, user) {
  const r = await db.one("select x.*, c.ext_id, c.name from mkt_changes x join mkt_campaigns c on c.id = x.campaign_id where x.id = $1", [id]);
  if (!r) throw Object.assign(new Error('That request is not there any more.'), { status: 404 });
  if (r.status !== 'pending') return { ok: true, status: r.status, result: r.result, name: r.name, kind: r.kind, value: r.value };
  if (!approve) { await db.q("update mkt_changes set status = 'rejected', decided_by = $2, decided_at = now() where id = $1", [id, user.id]); return { ok: true, status: 'rejected', name: r.name }; }
  try {
    await require('./social').changeCampaign(r.ext_id, { kind: r.kind, value: r.value });
    await db.q("update mkt_changes set status = 'done', decided_by = $2, decided_at = now(), result = 'Done on Meta' where id = $1", [id, user.id]);
    if (r.kind === 'budget') await db.q('update mkt_campaigns set ext_daily_budget = $2, daily_budget = $2 where id = $1', [r.campaign_id, r.value]);
    if (r.kind !== 'budget') await db.q("update mkt_campaigns set ext_status = $2 where id = $1", [r.campaign_id, r.kind === 'pause' ? 'PAUSED' : 'ACTIVE']);
    return { ok: true, status: 'done', name: r.name, kind: r.kind, value: r.value };
  } catch (x) {
    await db.q("update mkt_changes set status = 'failed', decided_by = $2, decided_at = now(), result = $3 where id = $1", [id, user.id, String(x.message).slice(0, 300)]);
    return { ok: false, status: 'failed', error: x.message, name: r.name };
  }
}
async function pending() {
  return db.q(`select x.id, x.campaign_id, x.kind, x.value, x.reason, x.status, x.result, x.requested_at, u.name as requested_name, c.name as campaign from mkt_changes x join mkt_campaigns c on c.id = x.campaign_id
     left join users u on u.id = x.requested_by where x.status = 'pending' or x.requested_at > now() - interval '14 days' order by x.id desc limit 30`);
}

module.exports = { alerts, digest, tiring, request, decide, pending, KIND };
