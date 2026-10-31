// Marketing & social media, company-wide or by project.
// GET  ?scope=company|<projectId> → channels (figures from Instagram, Facebook, YouTube directly), posts, campaigns, leads, tasks, settings
//      ?report=<scope> → the 12-month report: every network month by month, every ad campaign with spend and leads, top posts
//      ?connect=meta|youtube → off to Facebook / Google to connect;  /oauth/meta (and /oauth/google for YouTube) → the way back
//      ?img=<network>:<postId> → a post's picture (pictures stay on our own address)
//      ?library=company|<projectId> → the design library from that project's Google Drive folder
//      ?thumb=<driveFileId> → a file's preview picture
// POST {action}: post.save | post.status | post.delete | campaign.save | campaign.delete | lead.save | lead.delete |
//      task.save | task.done | task.delete | stats.save (typed figures) | settings | sync (pull now) | disconnect
// POST ?lead=<key> (from the website form, Meta lead ads through a connector, a portal…): a new lead, no login.
// Rupali (role Marketing) works here; Management sees everything and approves posts sent for review.
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');

const NETWORKS = ['instagram', 'facebook', 'youtube', 'linkedin', 'website', 'whatsapp', 'google'];
const SOURCES = ['instagram', 'facebook', 'meta_ads', 'google_ads', 'youtube', 'website', 'whatsapp', 'ivr', '99acres', 'magicbricks', 'housing', 'walk_in', 'referral', 'channel_partner', 'telecalling', 'hoarding', 'event', 'other'];
const KINDS = ['post', 'reel', 'story', 'video', 'carousel', 'ad', 'brochure', 'email', 'other'];
const STATUSES = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published'];
const LEAD_ST = ['new', 'contacted', 'visit', 'booked', 'lost'];
const SPEND_KINDS = ['hoarding', 'newspaper', 'portal', 'event', 'agency', 'shoot', 'influencer', 'print', 'radio', 'digital', 'site', 'other'];
const SPEND_SOURCE = { hoarding: 'hoarding', event: 'event' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URLX = /^https?:\/\/[^\s]{3,500}$/i;
const num = (v) => { const n = Number(String(v ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? n : null; };
const url = (v) => { const s = str(v, 500); return s && URLX.test(s) ? s : null; };
const phone10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d || null; };
const pid = (v) => (v === 'company' || v == null || v === '' ? null : intOr(v));

async function settings() {
  const r = await db.one("select value from settings where key = 'marketing'");
  const v = r ? r.value : {};
  let changed = false;
  if (!v.leadKey) { v.leadKey = crypto.randomBytes(12).toString('hex'); changed = true; }
  // the channels Dream India has today (company-wide; a channel can also belong to one project)
  if (!Array.isArray(v.channels)) { v.channels = [{ network: 'instagram', handle: 'dreamindiarealty', url: 'https://www.instagram.com/dreamindiarealty/', projectId: null }]; changed = true; }
  if (changed) await saveSettings(v);
  return { channels: [], drive: {}, needApproval: false, ...v };
}
async function saveSettings(v) { await db.q("insert into settings (key, value) values ('marketing', $1) on conflict (key) do update set value = excluded.value", [v]); }
const canView = (u) => has(u, 'marketing.view');
const canEdit = (u) => has(u, 'marketing.edit') || u.role === 'admin';
const canApprove = (u) => has(u, 'marketing.approve');

// The figures for one network over the last 60 days: latest followers, and sums for the last 30 days and the 30 before.
const dstr = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10);
async function channelFigures(network) {
  const rows = await db.q("select day, metrics from mkt_stats where network = $1 and day > current_date - 62 order by day", [network]);
  const d30 = new Date(Date.now() + 5.5 * 3600e3 - 30 * 864e5).toISOString().slice(0, 10);
  const sum = (k, a) => a.reduce((s, r) => s + (+r.metrics[k] || 0), 0);
  const cur = rows.filter((r) => dstr(r.day) > d30), prev = rows.filter((r) => dstr(r.day) <= d30);
  const lastF = [...rows].reverse().find((r) => r.metrics.followers != null);
  const f30 = [...prev].reverse().find((r) => r.metrics.followers != null);
  const out = { followers: lastF ? +lastF.metrics.followers : null, followersBefore: f30 ? +f30.metrics.followers : null, spark: cur.map((r) => +r.metrics.views || +r.metrics.reach || 0), followerSpark: rows.filter((r) => r.metrics.followers != null).map((r) => +r.metrics.followers), updated: rows.length ? dstr(rows[rows.length - 1].day) : null };
  // the 30 days before are compared only when they were pulled too (the first pull brings day-by-day figures for about 5 weeks)
  for (const k of ['views', 'reach', 'posts', 'interactions', 'gained']) { out[k] = sum(k, cur); const pd = prev.filter((r) => r.metrics[k] != null).length; out[k + 'Before'] = pd >= 25 || k === 'posts' && prev.length >= 25 ? sum(k, prev) : null; }
  return out;
}

// The two rows of boxes on the Overview: the last 30 days, and this financial year (from 1 April).
const fyStart = () => { const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1; return `${y}-04-01`; };
async function periods(projectId, nets) {
  const fy = fyStart(), pj = (col) => (projectId ? `and ${col} = ${+projectId}` : '');
  const num = (v) => Number(v) || 0;
  // 30 days: day-by-day figures
  const d = await db.one(`select coalesce(sum((metrics->>'views')::numeric), 0) as views, coalesce(sum((metrics->>'reach')::numeric), 0) as reach, coalesce(sum((metrics->>'posts')::numeric), 0) as posts
     from mkt_stats where network = any($1) and day > current_date - 30`, [nets]);
  const nowBy = Object.fromEntries((await db.q(`select distinct on (network) network, (metrics->>'followers')::numeric as f from mkt_stats where network = any($1) and metrics ? 'followers' order by network, day desc`, [nets])).map((r) => [r.network, +r.f]));
  const fNow = { f: Object.values(nowBy).reduce((a, v) => a + v, 0) };
  // compared over the same channels only (a channel connected lately has no figure from 30 days ago)
  const was = await db.q(`select distinct on (network) network, (metrics->>'followers')::numeric as f from mkt_stats where network = any($1) and metrics ? 'followers' and day <= current_date - 30 order by network, day desc`, [nets]);
  const f30 = { f: was.reduce((a, r) => a + +r.f, 0), n: was.length, now: was.reduce((a, r) => a + (nowBy[r.network] || 0), 0) };
  const ad30 = await db.one(`select coalesce(sum(cd.spend), 0) as spend, coalesce(sum(cd.leads), 0)::int as leads, coalesce(sum(cd.messages), 0)::int as chats from mkt_campaign_days cd join mkt_campaigns c on c.id = cd.campaign_id where cd.day > current_date - 30 ${pj('c.project_id')}`);
  const man30 = await db.one(`select coalesce(sum(spent), 0) as spent from mkt_campaigns c where source = 'manual' and coalesce(start_on, created_at::date) > current_date - 30 ${pj('c.project_id')}`);
  const l30 = await db.one(`select count(*)::int as n from mkt_leads where created_at > now() - interval '30 days' ${pj('project_id')}`);
  // the financial year: month-by-month figures
  const y = await db.one(`select coalesce(sum((metrics->>'views')::numeric), 0) as views, coalesce(sum((metrics->>'reach')::numeric), 0) as reach, coalesce(sum((metrics->>'posts')::numeric), 0) as posts
     from mkt_stats_month where network = any($1) and month >= $2::date`, [nets, fy]);
  const wasY = await db.q(`select distinct on (network) network, (metrics->>'followers')::numeric as f from mkt_stats_month where network = any($1) and metrics ? 'followers' and month >= $2::date order by network, month`, [nets, fy]);
  const fFy = { f: wasY.reduce((a, r) => a + +r.f, 0), n: wasY.length, now: wasY.reduce((a, r) => a + (nowBy[r.network] || 0), 0) };
  const adY = await db.one(`select coalesce(sum(m.spend), 0) as spend, coalesce(sum(m.leads), 0)::int as leads, coalesce(sum(m.messages), 0)::int as chats from mkt_campaign_months m join mkt_campaigns c on c.id = m.campaign_id where m.month >= $1::date ${pj('c.project_id')}`, [fy]);
  const manY = await db.one(`select coalesce(sum(spent), 0) as spent from mkt_campaigns c where source = 'manual' and coalesce(start_on, created_at::date) >= $1::date ${pj('c.project_id')}`, [fy]);
  const lY = await db.one(`select count(*)::int as n from mkt_leads where created_at >= $1::date ${pj('project_id')}`, [fy]);
  const mk = (v, fb, ad, man, leads) => { const spend = num(ad.spend) + num(man.spent), best = Math.max(leads.n, ad.leads);
    return { views: num(v.views), reach: num(v.reach), posts: num(v.posts), followers: num(fNow.f), followersBefore: fb.n ? fb.f : null, followersCmp: fb.n ? fb.now : null, leads: leads.n, adLeads: ad.leads, chats: ad.chats, spend, cpl: best ? spend / best : null }; };
  return { fy, d30: mk(d, f30, ad30, man30, l30), ytd: mk(y, fFy, adY, manY, lY) };
}

async function overview(u, scope, req) {
  const set = await settings();
  const projectId = pid(scope);
  const inScope = (col = 'project_id') => (projectId ? `${col} = ${+projectId}` : 'true');
  const chans = set.channels.filter((c) => !projectId || !c.projectId || +c.projectId === projectId);
  const channels = [];
  for (const c of chans) if (c.network !== 'whatsapp') channels.push({ ...c, ...(await channelFigures(c.network)) });
  // WhatsApp, next to Facebook: chats started from click-to-WhatsApp ads, and the leads that came in on WhatsApp
  const wa = await db.one(`select coalesce(sum(m.messages) filter (where m.month >= date_trunc('month', current_date)), 0)::int as this_month,
      coalesce(sum(m.messages) filter (where m.month = date_trunc('month', current_date) - interval '1 month'), 0)::int as last_month,
      coalesce(sum(m.messages), 0)::int as year, coalesce(sum(m.spend) filter (where m.messages > 0), 0) as spend
    from mkt_campaign_months m join mkt_campaigns c on c.id = m.campaign_id where m.month > current_date - interval '12 months' ${projectId ? 'and c.project_id = ' + +projectId : ''}`);
  const wl = await db.one(`select count(*) filter (where created_at > now() - interval '30 days')::int as d30, count(*)::int as total from mkt_leads where source = 'whatsapp' ${projectId ? 'and project_id = ' + +projectId : ''}`);
  const waCh = chans.find((c) => c.network === 'whatsapp') || { network: 'whatsapp', handle: '', url: null, projectId: null };
  const fbAt = channels.findIndex((c) => c.network === 'facebook');
  channels.splice(fbAt >= 0 ? fbAt + 1 : channels.length, 0, { ...waCh, wa: { ...wa, spend: +wa.spend, leads30: wl.d30, leads: wl.total } });
  const iv = await db.one(`select count(*) filter (where called_at > now() - interval '30 days')::int as calls30, count(distinct caller) filter (where called_at > now() - interval '30 days')::int as callers30,
      count(*) filter (where called_at > now() - interval '30 days' and (status ~* 'miss|no.?answer|busy|fail|incomplete|call-attempt' or coalesce(duration, 0) = 0))::int as missed30,
      count(*)::int as total, max(called_at) as last from mkt_ivr_calls ${projectId ? 'where project_id = ' + +projectId : ''}`);
  const ivl = await db.one(`select count(*) filter (where created_at > now() - interval '30 days')::int as d30 from mkt_leads where source = 'ivr' ${projectId ? 'and project_id = ' + +projectId : ''}`);
  channels.splice(channels.findIndex((c) => c.wa) + 1, 0, { network: 'ivr', handle: '', ivr: { ...iv, leads30: ivl.d30 } });
  // the website, once its tracker sends visits (or when a website channel is set up)
  { const wf = await webFigures(30); const at = channels.findIndex((c) => c.network === 'website'); const wl = await db.one("select count(*) filter (where created_at > now() - interval '30 days')::int as d30 from mkt_leads where source = 'website' or 'website' = any(sources)");
    if (wf.ever || at >= 0) { const base = at >= 0 ? channels.splice(at, 1)[0] : { network: 'website', handle: 'dreamindiarealty.com', url: 'https://dreamindiarealty.com', projectId: null }; channels.push({ ...base, web: { ...wf, leads30: wl.d30 } }); } }
  const posts = await db.q(`select p.*, array_to_json(p.channels) as channels, c.name as created_name, a.name as approved_name,
       (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size) order by f.id), '[]') from mkt_post_files f where f.post_id = p.id) as files
     from mkt_posts p left join users c on c.id = p.created_by left join users a on a.id = p.approved_by
     where ${inScope('p.project_id')} and (p.publish_at is null or p.publish_at > now() - interval '120 days') order by p.publish_at nulls first, p.id`);
  const campaigns = await db.q(`select c.*, array_to_json(c.channels) as channels, dz.name as designs_ok_name, bz.name as budget_ok_name, sb.name as submitted_name,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id) as leads,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status = 'visit') as visit_leads,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status = 'booked') as booked
     from mkt_campaigns c left join users dz on dz.id = c.designs_ok_by left join users bz on bz.id = c.budget_ok_by left join users sb on sb.id = c.submitted_by
     where ${inScope('c.project_id')} order by (c.source = 'manual') desc, (c.status = 'done'), c.start_on desc nulls last, c.id desc`);
  const leads = await db.q(`select l.*, array_to_json(l.sources) as sources, a.name as assigned_name, c.name as campaign_name,
       exists (select 1 from buyers y join booking_applicants ba on ba.buyer_id = y.id join bookings b on b.id = ba.booking_id join units un on un.id = b.unit_id
               where right(regexp_replace(coalesce(y.phone, ''), '\\D', '', 'g'), 10) = l.phone and b.status in ('active', 'pending') and (l.project_id is null or un.project_id = l.project_id)) as is_buyer
     from mkt_leads l left join users a on a.id = l.assigned_to left join mkt_campaigns c on c.id = l.campaign_id
     where ${inScope('l.project_id')} order by l.created_at desc limit 1000`);
  const tasks = await db.q(`select t.*, a.name as assigned_name from mkt_tasks t left join users a on a.id = t.assigned_to where ${inScope('t.project_id')} and (t.done_at is null or t.done_at > now() - interval '14 days') order by t.done_at nulls first, t.due nulls last, t.id`);
  const projects = await db.q('select id, name, code from projects where active order by id');
  const team = await db.q("select id, name, role from users where not disabled and role in ('marketing', 'admin', 'management', 'sales', 'crm', 'head_crm') order by name");
  const social = await require('../lib/social').status();
  const top = await db.q(`select network, ext_id, account, posted_at, kind, caption, permalink, thumb is not null as has_thumb, likes, comments, shares, saves, views, reach,
       coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0) + coalesce(saves, 0) as engagement
     from mkt_media where posted_at > now() - interval '30 days' order by coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0) + coalesce(saves, 0) desc, views desc nulls last limit 8`);
  const per = await periods(projectId, channels.filter((c) => !c.wa && !c.ivr).map((c) => c.network));
  return { periods: per, top, scope: projectId || 'company', projects, team, channels, posts, campaigns, leads, tasks,
    settings: { channels: set.channels, drive: set.drive, needApproval: !!set.needApproval, share: (() => { try { return require('../lib/sheets').serviceEmail(); } catch { return null; } })(), leadUrl: canEdit(u) ? `/api/marketing?lead=${set.leadKey}` : null, ivrUrl: canEdit(u) ? `/api/marketing?ivr=${set.leadKey}` : null, exotel: await require('../lib/exotel').status(),
      follow: require('../lib/mkt-leads').follow(set), competitors: (set.competitors || []).map((c) => ({ ...c, ads: require('../lib/mkt-tools').adLibrary(c.name) })),
      canva: await require('../lib/mkt-tools').canvaStatus(), gads: await require('../lib/gads').status(), capi: await require('../lib/mkt-leads').capiStatus(), ai: require('../lib/mkt-tools').aiOn(),
      whatsapp: (() => { try { return require('../lib/whatsapp').provider(); } catch { return null; } })() },
    social: { ...social, metaRedirect: canEdit(u) ? require('../lib/social').metaRedirect(req) : null },
    can: { edit: canEdit(u), approve: canApprove(u), admin: u.role === 'admin' }, lists: { networks: NETWORKS, sources: SOURCES, kinds: KINDS, statuses: STATUSES, leadStatuses: LEAD_ST } };
}

// The 12-month report: organic figures per network by month, ad campaigns (month by month and in total), leads by
// source by month, and the best posts.
async function report(scope) {
  const projectId = pid(scope);
  const months = []; { const t = new Date(Date.now() + 5.5 * 3600e3); for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1)).toISOString().slice(0, 10)); }
  const from = months[0];
  const organic = await db.q("select network, to_char(month, 'YYYY-MM-DD') as month, metrics from mkt_stats_month where month >= $1 order by network, month", [from]);
  const where = projectId ? `and c.project_id = ${+projectId}` : '';
  const camps = await db.q(`select c.id, c.name, c.project_id, c.channel, c.source, c.objective, c.ext_status, c.status, c.account, c.start_on, c.end_on, c.budget,
       coalesce(sum(m.spend), case when c.source = 'manual' then c.spent end, 0) as spend, coalesce(sum(m.impressions), c.impressions, 0) as impressions, coalesce(c.reach, sum(m.reach), 0) as reach,
       coalesce(sum(m.clicks), c.clicks, 0) as clicks, coalesce(sum(m.leads), c.ad_leads, 0) as ad_leads, coalesce(sum(m.messages), c.messages, 0) as messages, coalesce(sum(m.video_views), 0) as video_views,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id) as crm_leads,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status in ('visit', 'booked')) as visits,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status = 'booked') as booked
     from mkt_campaigns c left join mkt_campaign_months m on m.campaign_id = c.id and m.month >= $1
     where (c.source = 'manual' and (c.end_on is null or c.end_on >= $1) or m.campaign_id is not null) ${where}
     group by c.id order by spend desc nulls last`, [from]);
  const adMonths = await db.q(`select to_char(m.month, 'YYYY-MM-DD') as month, sum(m.spend) as spend, sum(m.impressions) as impressions, sum(m.reach) as reach, sum(m.clicks) as clicks, sum(m.leads) as leads, sum(m.messages) as messages, sum(m.video_views) as video_views
     from mkt_campaign_months m join mkt_campaigns c on c.id = m.campaign_id where m.month >= $1 ${where} group by m.month order by m.month`, [from]);
  const leadMonths = await db.q(`select to_char(date_trunc('month', created_at + interval '330 minutes'), 'YYYY-MM-DD') as month, source, count(*)::int as n,
       count(*) filter (where status in ('visit', 'booked'))::int as visits, count(*) filter (where status = 'booked')::int as booked
     from mkt_leads where created_at >= $1 ${projectId ? `and project_id = ${+projectId}` : ''} group by 1, 2 order by 1`, [from]);
  const top = await db.q(`select network, ext_id, account, posted_at, kind, caption, permalink, thumb is not null as has_thumb, likes, comments, shares, saves, views, reach,
       coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0) + coalesce(saves, 0) as engagement
     from mkt_media where posted_at >= $1 order by coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0) + coalesce(saves, 0) desc, views desc nulls last limit 24`, [from]);
  const media = await db.q(`select network, to_char(date_trunc('month', posted_at + interval '330 minutes'), 'YYYY-MM-DD') as month, kind, count(*)::int as n, sum(views) as views, sum(coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0) + coalesce(saves, 0)) as engagement
     from mkt_media where posted_at >= $1 group by 1, 2, 3 order by 2`, [from]);
  return { months, organic, campaigns: camps, adMonths, leadMonths, top, media };
}
// The email to Management when a post is sent for approval (test address only until the ERP is live).
async function approvalMail(p, by, req) {
  const mailer = require('../lib/mailer');
  if (!mailer.configured()) return { skipped: 'The sending email account is not connected.' };
  const { ROLES } = require('../lib/roles');
  const roles = Object.entries(ROLES).filter(([, r]) => (r.perms || []).includes('marketing.approve')).map(([k]) => k);
  const ok = (e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e);
  const people = (await db.q('select email from users where not disabled and role = any($1) and coalesce(email, \'\') <> \'\'', [roles])).flatMap((x) => String(x.email).split(/[,;\s]+/)).filter(ok);
  const live = process.env.ERP_LIVE === '1';
  const letters = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  const to = live ? [...new Set(people)] : String(letters.testEmail || '').split(/[\/,;\s]+/).filter(ok).slice(0, 1);
  if (!to.length) return { skipped: live ? 'No Management login has an email address.' : 'No test email address in Letter settings.' };
  const host = (process.env.ERP_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
  const files = await db.q('select id, name, mime from mkt_post_files where post_id = $1 order by id', [p.id]);
  const e = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = p.publish_at ? new Date(p.publish_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'no date yet';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#10114e">${live ? '' : '<p style="font-size:12px;color:#B54708">Test version: once the ERP is live this goes to Management.</p>'}
    <p>${e(by.name)} has sent a post for your approval.</p><p><b>${e(p.title)}</b><br>${e((p.channels || []).join(', '))} · goes out ${e(when)}</p>
    ${p.caption ? `<p style="white-space:pre-wrap;background:#F7F7FB;padding:10px;border-radius:8px">${e(String(p.caption).slice(0, 1500))}</p>` : ''}
    <p>${files.length ? `${files.length} design file${files.length > 1 ? 's' : ''} attached in the ERP.` : 'No design file attached.'}${p.canva_url ? ` <a href="${e(p.canva_url)}">Open the design in Canva</a>.` : ''}</p>
    <p><a href="${host}/#/marketing" style="display:inline-block;background:#140C59;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Marketing to approve</a></p></div>`;
  const conn = await mailer.connect();
  try { await conn.send({ to, subject: (live ? '' : '[TEST] ') + `For your approval: ${p.title}`, html, text: `${by.name} has sent "${p.title}" for your approval. Open ${host}/#/marketing`, fromName: 'Dream India ERP' }); }
  finally { await conn.close().catch(() => {}); }
  return { to, test: !live };
}

// Active campaigns: everything running now and what it is spending (Meta Ads by day and month, the rest as typed in).
async function activeCampaigns(scope) {
  const projectId = pid(scope), fy = fyStart();
  const rows = await db.q(`select c.id, c.name, c.source, c.ext_status, c.status, c.plan_status, p.name as project, c.start_on, c.end_on, c.daily_budget, c.monthly_budget, c.budget, c.account,
       array_to_json(c.channels) as channels,
       coalesce((select sum(d.spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 30), 0) as spend30,
       coalesce((select sum(d.spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 7), 0) as spend7,
       coalesce((select sum(d.spend) from mkt_campaign_days d where d.campaign_id = c.id and d.day = current_date - 1), 0) as yesterday,
       coalesce((select sum(m.spend) from mkt_campaign_months m where m.campaign_id = c.id and m.month = date_trunc('month', current_date)), 0) as month,
       coalesce((select sum(m.spend) from mkt_campaign_months m where m.campaign_id = c.id and m.month >= $1::date), 0) as fy,
       coalesce((select sum(d.leads) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 30), 0)::int as leads30,
       coalesce((select sum(d.messages) from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 30), 0)::int as chats30,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.created_at > now() - interval '30 days') as crm30,
       coalesce(c.spent, 0) as spent
     from mkt_campaigns c left join projects p on p.id = c.project_id
     where (upper(coalesce(c.ext_status, '')) = 'ACTIVE' or (c.source not in ('meta', 'google') and (c.status = 'active' or c.plan_status = 'approved') and (c.end_on is null or c.end_on >= current_date))
            or exists (select 1 from mkt_campaign_days d where d.campaign_id = c.id and d.day > current_date - 7 and d.spend > 0)) ${projectId ? 'and c.project_id = ' + +projectId : ''}
     order by spend30 desc, c.name`, [fy]);
  const n = (v) => Number(v) || 0;
  const list = rows.map((r) => { const meta = ['meta', 'google'].includes(r.source), s30 = meta ? n(r.spend30) : n(r.spent), l = Math.max(r.leads30, r.crm30);
    return { ...r, spend30: s30, spend7: n(r.spend7), yesterday: n(r.yesterday), month: meta ? n(r.month) : null, fy: meta ? n(r.fy) : n(r.spent), daily_budget: r.daily_budget == null ? null : n(r.daily_budget), monthly_budget: r.monthly_budget == null ? null : n(r.monthly_budget),
      leads30: l, cpl30: l ? s30 / l : null, pace: r.monthly_budget && meta ? n(r.month) / n(r.monthly_budget) : null }; });
  const sum = (k) => list.reduce((a, r) => a + (n(r[k]) || 0), 0);
  return { rows: list, totals: { campaigns: list.length, spend30: sum('spend30'), yesterday: sum('yesterday'), month: sum('month'), fy: sum('fy'), leads30: sum('leads30'), chats30: sum('chats30'), daily: sum('daily_budget') } };
}

// The rows behind a box on the Overview: followers, views, reach, content, leads, cost per lead (last 30 days).
async function mdrill(key, scope, period) {
  const projectId = pid(scope), set = await settings(), ytd = period === 'ytd', fy = fyStart(), pj = (col) => (projectId ? `and ${col} = ${+projectId}` : '');
  const FYT = `since 1 Apr ${fy.slice(0, 4)}`;
  const nets = [...new Set(set.channels.filter((c) => !projectId || !c.projectId || +c.projectId === projectId).map((c) => c.network))];
  const NAME = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', website: 'Website', whatsapp: 'WhatsApp', google: 'Google' };
  const since = "current_date - 30";
  if (key === 'followers') {
    const rows = [];
    for (const n of nets) {
      const f = await channelFigures(n);
      const months = await db.q("select to_char(month, 'Mon YYYY') as m, metrics->>'followers' as f from mkt_stats_month where network = $1 and metrics ? 'followers' order by month", [n]);
      rows.push({ channel: NAME[n] || n, now: f.followers, before: f.followersBefore, change: f.followers != null && f.followersBefore != null ? f.followers - f.followersBefore : null, history: months.map((x) => `${x.m}: ${Number(x.f).toLocaleString('en-IN')}`).join(' · ') });
    }
    return { title: 'Followers by channel', columns: [['channel', 'Channel'], ['now', 'Followers now', 'n'], ['before', '30 days ago', 'n'], ['change', 'Change', 'n'], ['history', 'Month by month']], rows };
  }
  if ((key === 'views' || key === 'reach' || key === 'posts_month') && ytd) {
    const rows = await db.q(`select to_char(month, 'Mon YYYY') as month, network, (metrics->>'views')::numeric as views, (metrics->>'reach')::numeric as reach, (metrics->>'interactions')::numeric as interactions,
        (metrics->>'posts')::numeric as posts, (metrics->>'followers')::numeric as followers from mkt_stats_month where month >= $2::date and network = any($1) order by month desc, network`, [nets, fy]);
    return { title: `${key === 'reach' ? 'Reach' : 'Views'} month by month (${FYT})`, columns: [['month', 'Month'], ['network', 'Channel'], ['views', 'Views', 'n'], ['reach', 'Reach', 'n'], ['interactions', 'Interactions', 'n'], ['posts', 'Posts', 'n'], ['followers', 'Followers', 'n']], rows: rows.map((r) => ({ ...r, network: NAME[r.network] || r.network })) };
  }
  if (key === 'spend') {
    const rows = ytd
      ? await db.q(`select c.name, p.name as project, c.ext_status, c.source, coalesce(sum(m.spend), 0) as spend, coalesce(sum(m.leads), 0)::int as leads, coalesce(sum(m.messages), 0)::int as chats, coalesce(sum(m.impressions), 0) as seen, coalesce(sum(m.clicks), 0) as clicks
          from mkt_campaigns c left join projects p on p.id = c.project_id join mkt_campaign_months m on m.campaign_id = c.id and m.month >= $1::date where true ${pj('c.project_id')} group by c.id, p.name
          union all select c.name, p.name, 'typed in', c.source, coalesce(c.spent, 0), 0, 0, 0, 0 from mkt_campaigns c left join projects p on p.id = c.project_id where c.source = 'manual' and coalesce(c.start_on, c.created_at::date) >= $1::date ${pj('c.project_id')}
          order by 5 desc`, [fy])
      : await db.q(`select c.name, p.name as project, c.ext_status, c.source, coalesce(sum(d.spend), 0) as spend, coalesce(sum(d.leads), 0)::int as leads, coalesce(sum(d.messages), 0)::int as chats, coalesce(sum(d.impressions), 0) as seen, coalesce(sum(d.clicks), 0) as clicks
          from mkt_campaigns c left join projects p on p.id = c.project_id join mkt_campaign_days d on d.campaign_id = c.id and d.day > current_date - 30 where true ${pj('c.project_id')} group by c.id, p.name
          union all select c.name, p.name, 'typed in', c.source, coalesce(c.spent, 0), 0, 0, 0, 0 from mkt_campaigns c left join projects p on p.id = c.project_id where c.source = 'manual' and coalesce(c.start_on, c.created_at::date) > current_date - 30 ${pj('c.project_id')}
          order by 5 desc`);
    return { title: `Amount spent by campaign (${ytd ? FYT : 'last 30 days'})`, columns: [['name', 'Campaign'], ['project', 'For'], ['ext_status', 'Status'], ['spend', 'Spent', 'inr'], ['seen', 'Seen', 'n'], ['clicks', 'Clicks', 'n'], ['leads', 'Leads (Meta)', 'n'], ['chats', 'Chats', 'n'], ['cpl', 'Per lead', 'inr']],
      rows: rows.map((r) => ({ ...r, ext_status: r.ext_status ? String(r.ext_status).replace(/_/g, ' ').toLowerCase() : '', cpl: +r.leads ? Math.round(+r.spend / +r.leads) : null })) };
  }
  if (key === 'views' || key === 'reach') {
    const rows = await db.q(`select to_char(day, 'YYYY-MM-DD') as day, network, (metrics->>'views')::numeric as views, (metrics->>'reach')::numeric as reach, (metrics->>'interactions')::numeric as interactions,
        (metrics->>'posts')::numeric as posts, (metrics->>'followers')::numeric as followers from mkt_stats where day > ${since} and network = any($1) order by day desc, network`, [nets]);
    return { title: key === 'views' ? 'Views, day by day (last 30 days)' : 'Reach, day by day (last 30 days)',
      columns: [['day', 'Date', 'date'], ['network', 'Channel'], ['views', 'Views', 'n'], ['reach', 'Reach', 'n'], ['interactions', 'Interactions', 'n'], ['posts', 'Posts', 'n'], ['followers', 'Followers', 'n']], rows: rows.map((r) => ({ ...r, network: NAME[r.network] || r.network })) };
  }
  if (key === 'posts') {
    const rows = await db.q(`select to_char(posted_at + interval '330 minutes', 'YYYY-MM-DD') as day, network, kind, caption, views, reach, likes, comments, shares, saves, permalink
       from mkt_media where posted_at > ${ytd ? "$2::date" : "now() - interval '30 days'"} and network = any($1) order by posted_at desc`, ytd ? [nets, fy] : [nets]);
    return { title: `Content published, ${ytd ? FYT : 'last 30 days'}`, columns: [['day', 'Date', 'date'], ['network', 'Channel'], ['kind', 'Type'], ['caption', 'Caption'], ['views', 'Views', 'n'], ['reach', 'Reach', 'n'], ['likes', 'Likes', 'n'], ['comments', 'Comments', 'n'], ['shares', 'Shares', 'n'], ['permalink', 'Link', 'link']],
      rows: rows.map((r) => ({ ...r, network: NAME[r.network] || r.network, caption: String(r.caption || '').slice(0, 140) })) };
  }
  if (key === 'leads') {
    const rows = await db.q(`select to_char(l.created_at + interval '330 minutes', 'YYYY-MM-DD') as day, l.name, l.phone, l.source, c.name as campaign, l.status, p.name as project, l.note
       from mkt_leads l left join mkt_campaigns c on c.id = l.campaign_id left join projects p on p.id = l.project_id where l.created_at > ${ytd ? `'${fy}'::date` : "now() - interval '30 days'"} ${projectId ? 'and l.project_id = ' + +projectId : ''} order by l.created_at desc`);
    return { title: `Leads, ${ytd ? FYT : 'last 30 days'}`, columns: [['day', 'Date', 'date'], ['name', 'Name'], ['phone', 'Phone'], ['source', 'Source'], ['campaign', 'Campaign'], ['status', 'Status'], ['project', 'Project'], ['note', 'Note']], rows };
  }
  if (key === 'campaign') {
    const c = await db.one('select name from mkt_campaigns where id = $1', [intOr(String(period).replace(/^c/, ''))]);
    const rows = await db.q(`select to_char(day, 'YYYY-MM-DD') as day, spend, impressions, clicks, leads, messages from mkt_campaign_days where campaign_id = $1 order by day desc`, [intOr(String(period).replace(/^c/, ''))]);
    return { title: `${c ? c.name : 'Campaign'}: spend day by day`, columns: [['day', 'Date', 'date'], ['spend', 'Spent', 'inr'], ['impressions', 'Seen', 'n'], ['clicks', 'Clicks', 'n'], ['leads', 'Leads', 'n'], ['messages', 'Chats', 'n']], rows };
  }
  if (key === 'wachats') {
    const rows = await db.q(`select to_char(m.month, 'Mon YYYY') as month, c.name, m.messages, m.spend, m.leads from mkt_campaign_months m join mkt_campaigns c on c.id = m.campaign_id
       where m.messages > 0 and m.month > current_date - interval '12 months' ${projectId ? 'and c.project_id = ' + +projectId : ''} order by m.month desc, m.messages desc`);
    return { title: 'WhatsApp / Messenger chats from ads, month by month', columns: [['month', 'Month'], ['name', 'Campaign'], ['messages', 'Chats', 'n'], ['spend', 'Spend', 'inr'], ['per', 'Per chat', 'inr'], ['leads', 'Form leads', 'n']], rows: rows.map((r) => ({ ...r, per: r.messages ? Math.round(+r.spend / r.messages) : null })) };
  }
  if (key === 'waleads') {
    const rows = await db.q(`select to_char(l.created_at + interval '330 minutes', 'YYYY-MM-DD') as day, l.name, l.phone, c.name as campaign, l.status, p.name as project, l.note
       from mkt_leads l left join mkt_campaigns c on c.id = l.campaign_id left join projects p on p.id = l.project_id where l.source = 'whatsapp' ${projectId ? 'and l.project_id = ' + +projectId : ''} order by l.created_at desc`);
    return { title: 'Leads that came in on WhatsApp', columns: [['day', 'Date', 'date'], ['name', 'Name'], ['phone', 'Phone'], ['campaign', 'Campaign'], ['status', 'Status'], ['project', 'Project'], ['note', 'Note']], rows };
  }
  if (key === 'ivrcalls' || key === 'ivrmissed') {
    const rows = await db.q(`select to_char(c.called_at + interval '330 minutes', 'YYYY-MM-DD HH24:MI') as at, c.caller, c.ivr_number, c.status, c.duration, c.digits, c.recording_url, l.status as lead_status, l.name
       from mkt_ivr_calls c left join mkt_leads l on l.id = c.lead_id where c.called_at > now() - interval '30 days' ${projectId ? 'and c.project_id = ' + +projectId : ''}
       ${key === 'ivrmissed' ? "and (c.status ~* 'miss|no.?answer|busy|fail|incomplete|call-attempt' or coalesce(c.duration, 0) = 0)" : ''} order by c.called_at desc`);
    return { title: key === 'ivrmissed' ? 'Missed IVR calls, last 30 days: call these back' : 'IVR calls, last 30 days', columns: [['at', 'When'], ['caller', 'Caller'], ['name', 'Name'], ['ivr_number', 'IVR number'], ['status', 'Status'], ['duration', 'Seconds', 'n'], ['digits', 'Pressed'], ['lead_status', 'Lead'], ['recording_url', 'Recording', 'link']], rows };
  }
  if (key === 'ivrleads') {
    const rows = await db.q(`select to_char(l.created_at + interval '330 minutes', 'YYYY-MM-DD') as day, l.name, l.phone, l.status, p.name as project, l.note from mkt_leads l left join projects p on p.id = l.project_id
       where l.source = 'ivr' and l.created_at > now() - interval '30 days' ${projectId ? 'and l.project_id = ' + +projectId : ''} order by l.created_at desc`);
    return { title: 'Leads from the IVR, last 30 days', columns: [['day', 'Date', 'date'], ['name', 'Name'], ['phone', 'Phone'], ['status', 'Status'], ['project', 'Project'], ['note', 'Note']], rows };
  }
  if (key === 'webdays') {
    const rows = await db.q(`select (at + interval '330 minutes')::date as day, count(distinct visitor) filter (where kind = 'view')::int as visitors, count(distinct session) filter (where kind = 'view')::int as visits, count(*) filter (where kind = 'view')::int as views,
        count(*) filter (where kind = 'call')::int as calls, count(*) filter (where kind = 'whatsapp')::int as whatsapp, count(*) filter (where kind = 'enquiry')::int as enquiries from mkt_web_hits where at > now() - interval '30 days' group by 1 order by 1 desc`);
    return { title: 'Website, day by day (last 30 days)', columns: [['day', 'Date', 'date'], ['visitors', 'Visitors', 'n'], ['visits', 'Visits', 'n'], ['views', 'Pages seen', 'n'], ['calls', 'Call clicks', 'n'], ['whatsapp', 'WhatsApp clicks', 'n'], ['enquiries', 'Enquiry forms', 'n']], rows };
  }
  if (key === 'websources') {
    const rows = await db.q(`select channel, count(distinct visitor) filter (where kind = 'view')::int as visitors, count(distinct session) filter (where kind = 'view')::int as visits, count(*) filter (where kind = 'view')::int as views,
        count(*) filter (where kind in ('call', 'whatsapp'))::int as clicks, count(*) filter (where kind = 'enquiry')::int as enquiries,
        string_agg(distinct campaign, ', ') filter (where campaign is not null) as campaigns from mkt_web_hits where at > now() - interval '30 days' group by 1 order by 3 desc, 4 desc`);
    return { title: 'Where website visitors came from (last 30 days)', columns: [['channel', 'From'], ['visitors', 'Visitors', 'n'], ['visits', 'Visits', 'n'], ['views', 'Pages seen', 'n'], ['clicks', 'Call / WhatsApp clicks', 'n'], ['enquiries', 'Enquiry forms', 'n'], ['campaigns', 'Campaigns (utm)']], rows };
  }
  if (key === 'webpages') {
    const rows = await db.q(`select path, max(title) as title, count(*)::int as views, count(distinct visitor)::int as visitors from mkt_web_hits where kind = 'view' and at > now() - interval '30 days' group by 1 order by 3 desc limit 200`);
    return { title: 'Pages seen most (last 30 days)', columns: [['path', 'Page'], ['title', 'Title'], ['views', 'Views', 'n'], ['visitors', 'Visitors', 'n']], rows };
  }
  if (key === 'webclicks') {
    const rows = await db.q(`select to_char(at + interval '330 minutes', 'YYYY-MM-DD HH24:MI') as at, kind, label, path, channel, device from mkt_web_hits where kind <> 'view' and at > now() - interval '30 days' order by id desc limit 500`);
    return { title: 'Calls, WhatsApp, brochure and enquiry clicks on the website (last 30 days)', columns: [['at', 'When'], ['kind', 'What'], ['label', 'Number / link'], ['path', 'On page'], ['channel', 'Came from'], ['device', 'Device']], rows };
  }
  if (key === 'cpl') {
    const rows = await db.q(`select c.name, c.source, c.ext_status, p.name as project, coalesce(c.spent, 0) as spent, coalesce(c.ad_leads, 0) as ad_leads,
        (select count(*)::int from mkt_leads l where l.campaign_id = c.id) as crm_leads, coalesce(c.messages, 0) as chats
       from mkt_campaigns c left join projects p on p.id = c.project_id ${projectId ? 'where c.project_id = ' + +projectId : ''} order by coalesce(c.spent, 0) desc`);
    return { title: 'Cost per lead, by campaign', columns: [['name', 'Campaign'], ['project', 'For'], ['ext_status', 'Status'], ['spent', 'Spent', 'inr'], ['ad_leads', 'Leads (Meta)', 'n'], ['crm_leads', 'Leads in our list', 'n'], ['chats', 'Chats', 'n'], ['cpl', 'Per lead', 'inr']],
      rows: rows.map((r) => { const l = Math.max(+r.ad_leads, r.crm_leads); return { ...r, ext_status: r.ext_status ? String(r.ext_status).toLowerCase() : r.source === 'manual' ? 'typed in' : '', cpl: l ? Math.round(+r.spent / l) : null }; }) };
  }
  throw fail(400, 'Unknown figure.');
}

// A lead from outside (website form, Meta lead ads via a connector, a property portal): checked by the key in the link.
async function leadHook(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST a lead as JSON.' });
  const set = await settings();
  const k = String(req.query.lead || '');
  if (k.length !== set.leadKey.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(set.leadKey))) return res.status(403).json({ error: 'Wrong key.' });
  let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8'); if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = Object.fromEntries(new URLSearchParams(b)); } }
  b = b || {};
  const name = str(b.name || b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' '), 120), phone = phone10(b.phone || b.phone_number || b.mobile), email = str(b.email, 160);
  if (!phone && !email) return res.status(400).json({ error: 'A lead needs a phone number or an email.' });
  const projects = await db.q('select id, name, code from projects where active');
  const said = `${b.project || ''} ${b.page || ''}`.toLowerCase();
  const words = (n) => String(n).toLowerCase().replace(/^dream\s+(india\s+)?/, '').split(/\W+/).filter((w) => w.length > 3);
  const pj = projects.find((p) => String(p.id) === String(b.project)) || projects.find((p) => b.project && new RegExp(String(b.project).replace(/[^a-z0-9 ]/gi, ''), 'i').test(p.name))
    || projects.find((p) => words(p.name).length && words(p.name).every((w) => said.includes(w))) || projects.find((p) => p.code === 'SIGNATURE') || null;
  const source = SOURCES.includes(String(b.source || '').toLowerCase()) ? String(b.source).toLowerCase() : 'website';
  const ext = str(b.id || b.leadgen_id, 120) || null;
  // the website form sends where the visitor came from (utm_… from the ad link): kept, and the campaign found by its name
  const utm = {}; for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'page', 'referrer']) { const v = str(b[k], 300); if (v) utm[k] = v; }
  const vid = str(b.vid, 60);
  if (vid) { // the visit that brought them (first page of their first visit), from the website tracker
    const first = await db.one("select source, medium, campaign, channel, path, referrer from mkt_web_hits where visitor = $1 and kind = 'view' order by at limit 1", [vid]);
    if (first) { utm.visitor = vid; utm.first_channel = first.channel; utm.landing = first.path; if (!utm.utm_source && first.source) utm.utm_source = first.source; if (!utm.utm_campaign && first.campaign) utm.utm_campaign = first.campaign; if (!utm.utm_medium && first.medium) utm.utm_medium = first.medium; if (!utm.referrer && first.referrer) utm.referrer = first.referrer; }
  }
  const camp = utm.utm_campaign ? await db.one("select id, project_id, source from mkt_campaigns where lower(name) = lower($1) or ext_id = $2 or ext_id = $3 order by id desc limit 1", [utm.utm_campaign, 'meta:' + utm.utm_campaign, 'gads:' + utm.utm_campaign]) : null;
  const paid = /cpc|paid|ads?$|ppc|display/i.test(utm.utm_medium || '') || utm.gclid || utm.first_channel === 'Google Ads' || utm.first_channel === 'Meta Ads';
  const src = source === 'website' && camp && camp.source === 'meta' ? 'meta_ads' : source === 'website' && camp && camp.source === 'google' ? 'google_ads' : source === 'website' && (utm.gclid || (/google/i.test(utm.utm_source || '') && paid)) ? 'google_ads' : source === 'website' && /facebook|instagram|meta|fb|ig/i.test(utm.utm_source || '') && (paid || utm.fbclid) ? 'meta_ads' : source;
  const r = await require('../lib/mkt-leads').add({ name, phone, email, source: src, projectId: (camp && camp.project_id) || (pj && pj.id), campaignId: camp && camp.id, note: str(b.message || b.note, 1000) || null, ext, utm: Object.keys(utm).length ? utm : null });
  return res.json({ ok: true, id: r.id, duplicate: !!r.duplicate });
}

// One IVR call into the ERP (from the live link or the Exotel call history); the caller becomes a lead.
async function recordIvrCall({ sid, caller, ivrNo, at, status, duration, rec, digits, raw }, set, { backfill = false } = {}) {
  set = set || await settings();
  const proj = (set.ivrProjects || {})[ivrNo] || (await db.one("select id from projects where code = 'SIGNATURE'") || {}).id || null;
  const call = await db.one(`insert into mkt_ivr_calls (sid, caller, ivr_number, called_at, status, duration, recording_url, digits, project_id, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (sid) do update set status = coalesce(excluded.status, mkt_ivr_calls.status), duration = coalesce(excluded.duration, mkt_ivr_calls.duration),
       recording_url = coalesce(excluded.recording_url, mkt_ivr_calls.recording_url), raw = excluded.raw returning id, lead_id, (xmax = 0) as fresh`,
  [sid || `ivr-${caller}-${at.getTime()}`, caller, ivrNo, at, status, duration, rec, digits, proj, raw || {}]);
  if (!call.lead_id) {
    const when = at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dup = await db.one(`select id from mkt_leads where phone = $1 ${backfill ? '' : "and created_at > now() - interval '30 days'"} order by id desc limit 1`, [caller]);
    let leadId;
    if (dup) { leadId = dup.id; await db.q("update mkt_leads set note = concat_ws(E'\\n', note, $2::text), updated_at = now() where id = $1", [dup.id, `Called the IVR again on ${when}`]); }
    else leadId = (await db.one("insert into mkt_leads (project_id, phone, source, note, ext_id, created_at) values ($1, $2, 'ivr', $3, $4, $5) on conflict (ext_id) where ext_id is not null do update set updated_at = now() returning id", [proj, caller, `Called the IVR${ivrNo ? ' (' + ivrNo + ')' : ''} on ${when}`, 'ivr:' + (sid || caller + at.getTime()), at])).id;
    await db.q('update mkt_ivr_calls set lead_id = $2 where id = $1', [call.id, leadId]);
  }
  return call.id;
}

// A call to the IVR number (Exotel Passthru / status callback, or any IVR that can call a link): GET or POST, checked by the
// key in the link. Every call is kept; a new number becomes a lead (source IVR), a number already a lead in the last
// 30 days gets a note. Answers plain 200 "OK" at once, as Exotel expects.
async function ivrHook(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const set = await settings();
  const k = String((req.query || {}).ivr || '');
  if (k.length !== set.leadKey.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(set.leadKey))) return res.status(403).end('Wrong key');
  let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8'); if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = Object.fromEntries(new URLSearchParams(b)); } }
  const P = { ...(req.query || {}), ...(b && typeof b === 'object' ? b : {}) };
  const g = (...names) => { for (const n of names) for (const key of Object.keys(P)) if (key.toLowerCase() === n.toLowerCase() && P[key] != null && P[key] !== '') return String(P[key]); return ''; };
  const caller = phone10(g('CallFrom', 'From', 'caller', 'caller_number', 'callerid', 'mobile', 'phone', 'customer_number'));
  if (!caller) { res.statusCode = 200; return res.end('OK'); }
  const sid = str(g('CallSid', 'call_sid', 'sid', 'call_id', 'uuid'), 120) || null;
  const ivrNo = phone10(g('CallTo', 'To', 'did', 'virtual_number', 'ivr_number', 'called_number')) || str(g('CallTo', 'To'), 20) || null;
  const at = (() => { const t = g('StartTime', 'start_time', 'Created', 'time'); const d = t ? new Date(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + '+05:30') : new Date(); return isNaN(d) ? new Date() : d; })();
  const status = str(g('DialCallStatus', 'CallStatus', 'Status', 'CallType', 'call_status'), 40) || null;
  const duration = intOr(g('DialCallDuration', 'Duration', 'ConversationDuration', 'duration')) || null;
  const rec = url(g('RecordingUrl', 'recording_url', 'recording'));
  const digits = str(g('digits', 'Digits', 'dtmf'), 20) || null;
  await recordIvrCall({ sid, caller, ivrNo, at, status, duration, rec, digits, raw: Object.fromEntries(Object.entries(P).filter(([x]) => x !== 'ivr')) }, set);
  res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end('OK');
}

// A picture from Meta or Canva, served from our own address (the page allows pictures only from the ERP).
async function proxyImg(res, src, okHost) {
  let h = null; try { const x = new URL(src); h = x.protocol === 'https:' || (!process.env.VERCEL && x.hostname === '127.0.0.1') ? x.hostname : null; } catch { h = null; }
  if (!h || !(okHost(h) || (!process.env.VERCEL && h === '127.0.0.1'))) return res.status(404).json({ error: 'No picture.' });
  const r = await fetch(src, { redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch(() => null);
  const type = r && r.headers.get('content-type');
  if (!r || !r.ok || !/^image\//.test(type || '')) return res.status(404).json({ error: 'No picture.' });
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 6e6) return res.status(404).json({ error: 'Too big.' });
  res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'private, max-age=86400'); return res.end(buf);
}
// The ads (designs) of one Meta campaign: last 7 and 30 days, cost per lead, and whether the ad is tiring.
async function adsOf(campaignId) {
  const rows = await db.q(`select a.id, a.name, a.adset, a.status, a.body, a.thumb is not null as has_thumb,
      coalesce(sum(d.spend) filter (where d.day > current_date - 30), 0) as spend30, coalesce(sum(d.leads + d.messages) filter (where d.day > current_date - 30), 0)::int as leads30,
      coalesce(sum(d.impressions) filter (where d.day > current_date - 30), 0) as imp30, coalesce(sum(d.clicks) filter (where d.day > current_date - 30), 0) as clk30,
      coalesce(sum(d.spend) filter (where d.day > current_date - 7), 0) as spend7, coalesce(sum(d.leads + d.messages) filter (where d.day > current_date - 7), 0)::int as leads7,
      max(d.frequency) filter (where d.day > current_date - 7) as freq7
    from mkt_ads a left join mkt_ad_days d on d.ad_id = a.id where a.campaign_id = $1 group by a.id order by spend30 desc`, [campaignId]);
  const tired = Object.fromEntries((await require('../lib/mkt-money').tiring(campaignId)).map((t) => [t.id, t.why]));
  const crm = Object.fromEntries((await db.q("select ad_name, count(*)::int as n, count(*) filter (where status in ('visit', 'booked') or visit_at is not null)::int as v, count(*) filter (where status = 'booked')::int as b from mkt_leads where campaign_id = $1 and ad_name is not null group by ad_name", [campaignId])).map((r) => [r.ad_name, r]));
  return { ads: rows.map((r) => ({ ...r, spend30: +r.spend30, spend7: +r.spend7, imp30: +r.imp30, clk30: +r.clk30, ctr30: +r.imp30 ? (+r.clk30 / +r.imp30) * 100 : null, cpl30: r.leads30 ? +r.spend30 / r.leads30 : null, freq7: r.freq7 == null ? null : +r.freq7,
    tiring: tired[r.id] || null, visits: (crm[r.name] || {}).v || 0, booked: (crm[r.name] || {}).b || 0 })) };
}
// Comments on our posts (last 30 days), newest first: answered or not.
async function inbox() {
  const rows = await db.q(`select c.network, c.ext_id, c.permalink, c.author, c.text, c.at, c.reply, c.replied_at, c.done, c.lead_id, u.name as replied_name, m.caption as post
      from mkt_comments c left join users u on u.id = c.replied_by left join mkt_media m on m.network = c.network and m.ext_id = c.media_ext where c.at > now() - interval '30 days' or (not c.done and c.reply is null) order by c.at desc nulls last limit 300`);
  const ask = /price|rate|cost|details?|info|interested|call|contact|whats ?app|number|location|site visit|visit|available|bhk|booking|brochure|kitna|kya|plz|please/i;
  return { rows: rows.map((r) => ({ ...r, post: String(r.post || '').slice(0, 80), hot: ask.test(r.text || '') })), connected: !!(await require('../lib/social').status()).meta.connected };
}
// Best times to post: average engagement of our posts by day of the week and time of day (last 12 months, IST).
async function postingTimes() {
  const rows = await db.q(`select extract(dow from posted_at + interval '330 minutes')::int as dow, (extract(hour from posted_at + interval '330 minutes')::int / 3) as slot, count(*)::int as n,
      avg(coalesce(likes, 0) + coalesce(comments, 0) * 2 + coalesce(shares, 0) * 3 + coalesce(saves, 0) * 3) as eng, avg(views) as views
    from mkt_media where posted_at > now() - interval '12 months' and network in ('instagram', 'facebook') group by 1, 2`);
  const kinds = await db.q(`select network, kind, count(*)::int as n, avg(coalesce(likes, 0) + coalesce(comments, 0) * 2 + coalesce(shares, 0) * 3 + coalesce(saves, 0) * 3) as eng, avg(views) as views, avg(reach) as reach
    from mkt_media where posted_at > now() - interval '12 months' group by 1, 2 having count(*) >= 2 order by eng desc`);
  return { cells: rows.map((r) => ({ ...r, eng: +r.eng, views: r.views == null ? null : +r.views })), kinds: kinds.map((r) => ({ ...r, eng: +r.eng, views: r.views == null ? null : +r.views, reach: r.reach == null ? null : +r.reach })) };
}

// ---------- the website (visits sent by /t.js on dreamindiarealty.com) ----------
// Where a visit came from, in plain words.
function webChannel({ source, medium, referrer, gclid, fbclid }) {
  const s = String(source || '').toLowerCase(), m = String(medium || '').toLowerCase(), r = String(referrer || '').toLowerCase();
  if (gclid || (/google/.test(s) && /cpc|paid|ppc|ads/.test(m))) return 'Google Ads';
  if (/facebook|instagram|meta|fb|ig/.test(s) && /cpc|paid|ads|ppc/.test(m)) return 'Meta Ads';
  if (fbclid && !s) return /instagram/.test(r) ? 'Instagram' : 'Facebook';
  if (/whatsapp|wa\.me/.test(s + r)) return 'WhatsApp';
  if (/instagram/.test(s + r)) return 'Instagram';
  if (/facebook|fb\.com/.test(s + r)) return 'Facebook';
  if (/youtube|youtu\.be/.test(s + r)) return 'YouTube';
  if (/linkedin|lnkd/.test(s + r)) return 'LinkedIn';
  if (/99acres|magicbricks|housing\.com|nobroker|squareyards/.test(s + r)) return 'Property portals';
  if (s) return 'Campaign: ' + s.slice(0, 40);
  if (/google\.|bing\.|yahoo\.|duckduckgo|search/.test(r)) return 'Google search';
  if (r) { try { return 'Link from ' + new URL(r).hostname.replace(/^www\./, ''); } catch { return 'Other sites'; } }
  return 'Typed in / direct';
}
async function hitHook(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const set = await settings(), k = String((req.query || {}).hit || '');
  if (k.length !== set.leadKey.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(set.leadKey))) { res.statusCode = 403; return res.end(); }
  let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8'); if (typeof b === 'string') { if (b.length > 6000) { res.statusCode = 413; return res.end(); } try { b = JSON.parse(b); } catch { b = {}; } }
  b = b && typeof b === 'object' ? b : {};
  if (/bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i.test(String(req.headers['user-agent'] || ''))) { res.statusCode = 204; return res.end(); }
  const kind = ['view', 'call', 'whatsapp', 'brochure', 'enquiry'].includes(b.k) ? b.k : 'view';
  const f = { source: str(b.utm_source, 80), medium: str(b.utm_medium, 80), campaign: str(b.utm_campaign, 150), content: str(b.utm_content, 150), term: str(b.utm_term, 150), referrer: str(b.referrer, 300), gclid: !!b.gclid, fbclid: !!b.fbclid };
  await db.q(`insert into mkt_web_hits (visitor, session, kind, host, path, title, referrer, source, medium, campaign, content, term, channel, device, label) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [str(b.v, 60), str(b.s, 60), kind, str(b.h, 120), str(b.p, 300) || '/', str(b.t, 150), f.referrer, f.source, f.medium, f.campaign, f.content, f.term, webChannel(f), +b.w && +b.w < 768 ? 'mobile' : 'desktop', str(b.l, 120)]);
  res.statusCode = 204; return res.end();
}
async function webFigures(days = 30) {
  const w = await db.one(`select count(distinct visitor) filter (where kind = 'view')::int as visitors, count(distinct session) filter (where kind = 'view')::int as visits, count(*) filter (where kind = 'view')::int as views,
      count(*) filter (where kind = 'call')::int as calls, count(*) filter (where kind = 'whatsapp')::int as whatsapp, count(*) filter (where kind = 'enquiry')::int as enquiries,
      count(distinct visitor) filter (where kind = 'view' and device = 'mobile')::int as mobile, max(at) as last
    from mkt_web_hits where at > now() - ($1 || ' days')::interval`, [String(days)]);
  const was = await db.one(`select count(distinct visitor) filter (where kind = 'view')::int as visitors from mkt_web_hits where at <= now() - ($1 || ' days')::interval and at > now() - ($1 || ' days')::interval * 2`, [String(days)]);
  const top = await db.q(`select channel, count(distinct session)::int as n from mkt_web_hits where kind = 'view' and at > now() - ($1 || ' days')::interval group by 1 order by 2 desc limit 3`, [String(days)]);
  const spark = (await db.q(`select (at + interval '330 minutes')::date as d, count(distinct visitor)::int as n from mkt_web_hits where kind = 'view' and at > now() - interval '30 days' group by 1 order by 1`)).map((r) => r.n);
  const any = await db.one('select max(at) as at from mkt_web_hits');
  return { ...w, visitorsBefore: was.visitors || null, top, spark, ever: any && any.at };
}
// each morning: yesterday (and the days before, if missed) into the daily and monthly figures, so the website sits in the
// 30-day boxes and the 12-month report like the other channels; visits older than 13 months are deleted.
async function webAggregate() {
  const days = await db.q(`select (at + interval '330 minutes')::date as d, count(distinct visitor) filter (where kind = 'view')::int as reach, count(*) filter (where kind = 'view')::int as views,
      count(distinct session) filter (where kind = 'view')::int as sessions, count(*) filter (where kind <> 'view')::int as interactions
    from mkt_web_hits where at > now() - interval '8 days' group by 1`);
  for (const r of days) await db.q("insert into mkt_stats (network, day, metrics, source) values ('website', $1, $2, 'direct') on conflict (network, day) do update set metrics = excluded.metrics, updated_at = now()", [r.d, { views: r.views, reach: r.reach, sessions: r.sessions, interactions: r.interactions }]);
  const months = await db.q(`select date_trunc('month', at + interval '330 minutes')::date as m, count(distinct visitor) filter (where kind = 'view')::int as reach, count(*) filter (where kind = 'view')::int as views,
      count(distinct session) filter (where kind = 'view')::int as sessions, count(*) filter (where kind <> 'view')::int as interactions
    from mkt_web_hits where at >= date_trunc('month', now()) - interval '1 month' group by 1`);
  for (const r of months) await db.q("insert into mkt_stats_month (network, month, metrics) values ('website', $1, $2) on conflict (network, month) do update set metrics = excluded.metrics, updated_at = now()", [r.m, { views: r.views, reach: r.reach, sessions: r.sessions, interactions: r.interactions }]);
  await db.q("delete from mkt_web_hits where at < now() - interval '13 months'");
  return { days: days.length };
}

// Set-up checklist: what the marketing team has done of the set-up, worked out from the ERP itself.
async function checklist() {
  const social = require('../lib/social'), SO = await social.status(), out = [];
  const need = { 'Meta form leads': ['leads_retrieval', 'pages_manage_ads'], 'Auto-posting': ['pages_manage_posts', 'instagram_content_publish'], 'Pause / budget changes': ['ads_management'], 'Comments inbox': ['instagram_manage_comments', 'pages_read_user_content', 'pages_manage_engagement'], 'Insights': ['read_insights', 'instagram_manage_insights'] };
  let granted = null, permErr = null;
  if (SO.meta.connected) granted = await social.permissions().catch((e) => { permErr = e.message; return null; });
  const missing = granted ? [...new Set(Object.values(need).flat())].filter((p) => !granted.includes(p)) : null;
  out.push({ key: 'meta', task: 'Facebook permissions, then Connect again', done: !!(SO.meta.connected && missing && !missing.length),
    detail: !SO.meta.connected ? 'Facebook is not connected.' : permErr ? 'Could not read the permissions: ' + permErr : missing.length ? `Connected on ${String(SO.meta.at || '').slice(0, 10)}, but still missing: ${missing.join(', ')}. Not working yet: ${Object.entries(need).filter(([, ps]) => ps.some((p) => missing.includes(p))).map(([k]) => k).join(', ')}.` : `All permissions given (connected ${String(SO.meta.at || '').slice(0, 10)}).` });
  const capi = await require('../lib/mkt-leads').capiStatus();
  out.push({ key: 'capi', task: 'Lead quality to Meta: CRM dataset and token', done: capi.on, detail: capi.on ? `On. ${capi.sent} stages sent.` : `Not set up: META_DATASET_ID and META_CAPI_TOKEN are not in Vercel yet. ${capi.waiting} stages waiting.` });
  const cv = await require('../lib/mkt-tools').canvaStatus();
  out.push({ key: 'canva', task: 'Canva integration', done: cv.connected, detail: cv.connected ? `Connected${cv.name ? ' (' + cv.name + ')' : ''}.` : cv.configured ? 'Keys are in; press Connect Canva in Set-up.' : 'CANVA_CLIENT_ID and CANVA_CLIENT_SECRET are not in Vercel yet.' });
  out.push({ key: 'youtube', task: 'YouTube APIs, "In production", Connect YouTube', done: SO.youtube.connected && !SO.youtube.error, detail: SO.youtube.connected ? (SO.youtube.error ? 'Connected but failing: ' + SO.youtube.error : `Connected: ${SO.youtube.title || ''}.`) : 'Not connected.' });
  const ga = await require('../lib/gads').status();
  out.push({ key: 'gads', task: 'Google Ads developer token', done: ga.connected, detail: ga.connected ? 'Connected.' : ga.configured ? 'Keys are in; press Connect Google Ads.' : 'No developer token in Vercel yet.' });
  const portal = await db.one("select count(*)::int as n, max(created_at) as last from mkt_leads where source in ('99acres', 'magicbricks', 'housing') or sources && array['99acres', 'magicbricks', 'housing']");
  out.push({ key: 'portals', task: 'Portal lead emails to the ERP mailbox', done: portal.n > 0, detail: portal.n ? `${portal.n} portal leads in, last ${String(portal.last.toISOString ? portal.last.toISOString() : portal.last).slice(0, 10)}.` : 'No portal lead has come in yet.' });
  const sp = await db.one('select count(*)::int as n, coalesce(sum(amount), 0) as a, count(*) filter (where file_data is not null)::int as inv from mkt_spend');
  out.push({ key: 'spend', task: 'Past spend entered, with invoices', done: sp.n > 0, detail: sp.n ? `${sp.n} entries, ₹${Math.round(+sp.a).toLocaleString('en-IN')}, ${sp.inv} with an invoice.` : 'Nothing entered yet.' });
  const set = await settings();
  out.push({ key: 'competitors', task: 'Competitors added', done: (set.competitors || []).length > 0, detail: (set.competitors || []).length ? (set.competitors || []).map((c) => c.name).join(', ') : 'None yet.' });
  const rera = await db.one("select count(*) filter (where status in ('review', 'approved', 'scheduled', 'published'))::int as n from mkt_posts where updated_at > now() - interval '7 days'");
  out.push({ key: 'rera', task: 'MahaRERA number on every post', done: null, detail: 'Checked by the ERP on every post sent for approval or posting.' + (rera.n ? ` ${rera.n} posts went through in the last 7 days.` : '') });
  out.push({ key: 'captions', task: 'Caption drafts tried', done: require('../lib/mkt-tools').aiOn() ? null : false, detail: require('../lib/mkt-tools').aiOn() ? 'Available.' : 'Not available: ANTHROPIC_API_KEY is not in Vercel.' });
  const L = await db.one("select count(*)::int as n, count(*) filter (where first_contact_at is not null)::int as called, count(*) filter (where first_contact_at - created_at <= interval '15 minutes')::int as fast from mkt_leads where created_at > now() - interval '7 days'");
  const routed = Object.values((set.follow || {}).people || {}).some((x) => (x || []).length);
  out.push({ key: 'leads', task: 'Leads called within 15 minutes and marked Called', done: L.n ? L.fast / L.n >= 0.8 : null, detail: `${L.n} leads in the last 7 days: ${L.called} marked called, ${L.fast} within 15 minutes.${routed ? '' : ' Nobody is set to receive new leads yet (Set-up → Lead follow-up).'}` });
  const web = await db.one('select count(*)::int as n, max(at) as last from mkt_web_hits');
  out.push({ key: 'website', task: 'Website tracker line on dreamindiarealty.com', done: web.n > 0, detail: web.n ? `Counting: ${web.n} hits, last ${new Date(web.last).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : 'No visit has come in yet.' });
  const ex = await require('../lib/exotel').status();
  out.push({ key: 'ivr', task: 'Exotel IVR', done: !!(ex.configured || (await db.one('select count(*)::int as n from mkt_ivr_calls')).n), detail: ex.configured ? 'History connected.' : 'Exotel keys not in Vercel yet.' });
  return { at: new Date().toISOString(), items: out };
}

const handler = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open Marketing.');
    const q = req.query || {};
    const social = require('../lib/social');
    if (q.connect && !['canva', 'gads'].includes(q.connect)) {
      if (!canEdit(u)) throw fail(403, 'Only the marketing team connects the channels.');
      res.statusCode = 302; res.setHeader('Location', q.connect === 'youtube' ? await social.ytAuthUrl(req, u.id) : await social.metaAuthUrl(req, u.id)); return res.end();
    }
    if (q.oauth === 'meta') {
      if (!canEdit(u)) throw fail(403, 'Only the marketing team connects the channels.');
      let back;
      try { const r = await social.metaCallback(req, u.id); await audit.record(db.q, { user: u, action: 'connect', entity: 'meta', after: r }); back = `/?social=${encodeURIComponent(`Connected: ${r.pages} Facebook page(s), ${r.instagram} Instagram, ${r.ads} ad account(s). Pulling the last 12 months…`)}#/marketing`; }
      catch (e) { back = '/?social=' + encodeURIComponent(e.message) + '#/marketing'; }
      res.statusCode = 302; res.setHeader('Location', back); return res.end();
    }
    if (q.img) {
      const m = String(q.img).match(/^(instagram|facebook|youtube):([A-Za-z0-9_.-]{1,80})$/);
      const row = m ? await db.one('select thumb from mkt_media where network = $1 and ext_id = $2', [m[1], m[2]]) : null;
      const okHost = (t) => { try { const h = new URL(t); return (h.protocol === 'https:' && /(^|\.)(fbcdn\.net|cdninstagram\.com|facebook\.com|ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(h.hostname)) || (!process.env.VERCEL && h.hostname === '127.0.0.1'); } catch { return false; } };
      if (!row || !row.thumb || !okHost(row.thumb)) return res.status(404).json({ error: 'No picture.' }); // only the networks' own picture servers
      const r = await fetch(row.thumb, { redirect: 'error' }).catch(() => null);
      const type = r && r.headers.get('content-type');
      if (!r || !r.ok || !/^image\//.test(type || '')) return res.status(404).json({ error: 'No picture.' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4e6) return res.status(404).json({ error: 'Too big.' });
      res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(buf);
    }
    if (q.pfile) {
      const f = await db.one('select name, mime, data from mkt_post_files where id = $1', [intOr(q.pfile)]);
      if (!f) return res.status(404).json({ error: 'That file is not there any more.' });
      res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Disposition', `${q.dl ? 'attachment' : 'inline'}; filename="${String(f.name).replace(/[^\w.\- ]+/g, '_')}"`);
      return res.end(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
    }
    if (q.connect === 'canva') { if (!canEdit(u)) throw fail(403, 'Only the marketing team connects Canva.'); res.statusCode = 302; res.setHeader('Location', await require('../lib/mkt-tools').canvaAuthUrl(req, u.id)); return res.end(); }
    if (q.connect === 'gads') { if (!canEdit(u)) throw fail(403, 'Only the marketing team connects Google Ads.'); res.statusCode = 302; res.setHeader('Location', await require('../lib/gads').authUrl(req, u.id)); return res.end(); }
    if (q.oauth === 'canva') {
      let back; try { const r = await require('../lib/mkt-tools').canvaCallback(req, u.id); back = '/?social=' + encodeURIComponent(`Canva connected${r.name ? ': ' + r.name : ''}. "Pick from Canva" is in every post now.`) + '#/marketing'; } catch (e) { back = '/?social=' + encodeURIComponent(e.message) + '#/marketing'; }
      res.statusCode = 302; res.setHeader('Location', back); return res.end();
    }
    if (q.results != null) return res.json(await require('../lib/mkt-results').results(q.results, String(q.period || 'fy')));
    if (q.rdrill) return res.json(await require('../lib/mkt-results').drill(String(q.rdrill), q.scope, String(q.period || 'fy')));
    if (q.ads) return res.json(await adsOf(intOr(q.ads)));
    if (q.adimg) {
      const a = await db.one('select thumb from mkt_ads where id = $1', [intOr(q.adimg)]);
      return proxyImg(res, a && a.thumb, (h) => /(^|\.)(fbcdn\.net|facebook\.com|cdninstagram\.com)$/.test(h));
    }
    if (q.cimg) return proxyImg(res, String(q.cimg), (h) => require('../lib/mkt-tools').okCanvaImg('https://' + h + '/'));
    if (q.spendfile) {
      const f = await db.one('select file_name, file_mime, file_data from mkt_spend where id = $1 and file_data is not null', [intOr(q.spendfile)]);
      if (!f) return res.status(404).json({ error: 'No invoice attached.' });
      res.setHeader('Content-Type', f.file_mime); res.setHeader('Content-Disposition', `inline; filename="${String(f.file_name).replace(/[^\w.\- ]+/g, '_')}"`);
      return res.end(Buffer.isBuffer(f.file_data) ? f.file_data : Buffer.from(f.file_data));
    }
    if (q.canva != null) { if (!canEdit(u)) throw fail(403, 'Only the marketing team picks designs.'); return res.json(await require('../lib/mkt-tools').canvaDesigns({ query: str(q.q, 100), continuation: str(q.next, 500) })); }
    if (q.checklist != null) return res.json(await checklist());
    if (q.inbox != null) return res.json(await inbox());
    if (q.times != null) return res.json(await postingTimes());
    if (q.controls != null) return res.json({ changes: await require('../lib/mkt-money').pending(), tiring: await require('../lib/mkt-money').tiring() });
    if (q.report != null) return res.json(await report(q.report));
    if (q.active != null) return res.json(await activeCampaigns(q.scope));
    if (q.mdrill) return res.json(await mdrill(String(q.mdrill), q.scope, String(q.period || 'd30')));
    if (q.thumb) {
      const t = /^[A-Za-z0-9_-]{10,80}$/.test(q.thumb) ? await require('../lib/drive').thumbnail(q.thumb).catch(() => null) : null;
      if (!t) return res.status(404).json({ error: 'No preview.' });
      res.setHeader('Content-Type', t.type); res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(t.data);
    }
    if (q.library != null) {
      const set = await settings(), key = pid(q.library) ? String(pid(q.library)) : 'company';
      const folder = set.drive[key];
      if (!folder) return res.json({ folder: null, files: [] });
      try { return res.json({ folder, files: await require('../lib/drive').library(folder) }); }
      catch (e) { return res.json({ folder, files: [], error: e.message, share: require('../lib/sheets').serviceEmail() }); }
    }
    return res.json(await overview(u, q.scope, req));
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open Marketing.');
    const a = b.action, d = b.data || {};
    const editOnly = () => { if (!canEdit(u)) throw fail(403, 'Only the marketing team changes this.'); };
    const log = (action, entity, id, after) => audit.record(db.q, { user: u, action, entity, entityId: id, after });
    const projectOf = async (v) => { const p = pid(v); if (p && !(await db.one('select 1 as x from projects where id = $1', [p]))) throw fail(400, 'Choose the project.'); return p; };

    if (a === 'post.save') {
      editOnly();
      const title = str(d.title, 200); if (!title) throw fail(400, 'Give the post a title.');
      const channels = (Array.isArray(d.channels) ? d.channels : []).filter((c) => NETWORKS.includes(c));
      const when = d.publishAt ? new Date(d.publishAt) : null; if (when && isNaN(when)) throw fail(400, 'The date looks wrong.');
      let status = STATUSES.includes(d.status) ? d.status : 'draft';
      const set = await settings();
      if (set.needApproval && ['approved', 'scheduled', 'published'].includes(status) && !canApprove(u)) {
        const cur = d.id ? await db.one('select approved_at from mkt_posts where id = $1', [intOr(d.id)]) : null;
        if (!cur || !cur.approved_at) status = 'review';
      }
      const v = [await projectOf(d.projectId), title, KINDS.includes(d.kind) ? d.kind : 'post', channels, when, status, str(d.caption, 5000) || null, url(d.canvaUrl), url(d.assetUrl), url(d.postUrl), str(d.note, 1000) || null, intOr(d.campaignId) || null, u.id];
      let id;
      if (d.id) { id = intOr(d.id); const r = await db.one('update mkt_posts set project_id=$1, title=$2, kind=$3, channels=$4, publish_at=$5, status=$6, caption=$7, canva_url=$8, asset_url=$9, post_url=$10, note=$11, campaign_id=$12, updated_by=$13, updated_at=now() where id=$14 returning id', [...v, id]); if (!r) throw fail(404, 'That post is not there any more.'); }
      else id = (await db.one('insert into mkt_posts (project_id, title, kind, channels, publish_at, status, caption, canva_url, asset_url, post_url, note, campaign_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id', v)).id;
      if (d.reraOnDesign != null) await db.q('update mkt_posts set rera_on_design = $2 where id = $1', [id, !!d.reraOnDesign]);
      await log(d.id ? 'update' : 'create', 'mkt-post', id, { title, status });
      return res.json({ ok: true, id, status });
    }
    if (a === 'post.status') {
      const id = intOr(d.id), st = d.status;
      if (!STATUSES.includes(st)) throw fail(400, 'Unknown status.');
      if (st === 'approved') { if (!canApprove(u)) throw fail(403, 'Management approves posts.'); await db.q("update mkt_posts set status = 'approved', approved_by = $2, approved_at = now(), review_note = null, updated_at = now() where id = $1", [id, u.id]); }
      else { editOnly(); await db.q('update mkt_posts set status = $2, post_url = coalesce($3, post_url), updated_by = $4, updated_at = now() where id = $1', [id, st, url(d.postUrl), u.id]); }
      await log('status', 'mkt-post', id, { status: st });
      return res.json({ ok: true });
    }
    // the finished design: an image, PDF or short video exported from Canva (up to 3 MB; a longer video goes as a Drive link)
    if (a === 'post.file') {
      editOnly();
      const post = await db.one('select id from mkt_posts where id = $1', [intOr(d.postId)]); if (!post) throw fail(404, 'Save the post first.');
      const mime = String(d.mime || ''), buf = Buffer.from(String(d.data || ''), 'base64');
      if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf|video\/mp4)$/.test(mime)) throw fail(400, 'Attach a PNG, JPG, WEBP, GIF, PDF or MP4 file (in Canva: Share → Download).');
      if (!buf.length || buf.length > 3 * 1024 * 1024) throw fail(400, 'The file must be under 3 MB. For a longer video, put its Google Drive link in "File or video link".');
      const r = await db.one('insert into mkt_post_files (post_id, name, mime, size, data, created_by) values ($1, $2, $3, $4, $5, $6) returning id', [post.id, str(d.name, 120) || 'design', mime, buf.length, buf, u.id]);
      await log('attach', 'mkt-post', post.id, { file: str(d.name, 120) });
      return res.json({ ok: true, id: r.id });
    }
    if (a === 'post.file.delete') { editOnly(); await db.q('delete from mkt_post_files where id = $1', [intOr(d.id)]); return res.json({ ok: true }); }
    // Rupali sends a post for approval: Management is emailed with the design
    if (a === 'post.send') {
      editOnly();
      { const cur = await db.one('select id, title, caption, project_id, rera_on_design from mkt_posts where id = $1', [intOr(d.id)]); const m = await require('../lib/mkt-tools').reraMissing(cur); if (m) throw fail(400, m); }
      const p = await db.one("update mkt_posts set status = 'review', sent_at = now(), sent_by = $2, review_note = null, updated_at = now() where id = $1 and status <> 'published' returning *", [intOr(d.id), u.id]);
      if (!p) throw fail(404, 'That post is not there any more.');
      await log('send-for-approval', 'mkt-post', p.id, { title: p.title });
      const mail = await approvalMail(p, u, req).catch((e) => ({ error: e.message }));
      return res.json({ ok: true, mail });
    }
    // Management sends it back with a comment
    if (a === 'post.sendback') {
      if (!canApprove(u)) throw fail(403, 'Management approves posts.');
      const note = str(d.note, 1000); if (!note) throw fail(400, 'Write what should change.');
      const p = await db.one("update mkt_posts set status = 'draft', review_note = $2, approved_by = null, approved_at = null, updated_at = now() where id = $1 returning id, title", [intOr(d.id), `${u.name}: ${note}`]);
      if (!p) throw fail(404, 'That post is not there any more.');
      await log('send-back', 'mkt-post', p.id, { note });
      return res.json({ ok: true });
    }
    if (a === 'post.delete') { editOnly(); await db.q('delete from mkt_posts where id = $1', [intOr(d.id)]); await log('delete', 'mkt-post', d.id); return res.json({ ok: true }); }

    if (a === 'campaign.save') {
      editOnly();
      const name = str(d.name, 160); if (!name) throw fail(400, 'Name the campaign.');
      for (const k of ['startOn', 'endOn']) if (d[k] && !DATE.test(d[k])) throw fail(400, 'A date looks wrong.');
      const chans = (Array.isArray(d.channels) ? d.channels : []).filter((c) => NETWORKS.includes(c));
      const cur = d.id ? await db.one('select id, source, daily_budget, monthly_budget, budget, plan_status from mkt_campaigns where id = $1', [intOr(d.id)]) : null;
      if (d.id && !cur) throw fail(404, 'That campaign is not there any more.');
      const P = [await projectOf(d.projectId), str(d.brief, 4000) || null, chans, num(d.dailyBudget), num(d.monthlyBudget), str(d.note, 1000) || null];
      let id;
      if (cur && ['meta', 'google'].includes(cur.source)) { // a campaign from Meta / Google Ads: its figures come from Meta; only the plan is ours
        id = cur.id; await db.q('update mkt_campaigns set project_id=$1, brief=$2, channels=$3, daily_budget=$4, monthly_budget=$5, note=$6, updated_at=now() where id=$7', [...P, id]);
      } else {
        const v = [name, chans[0] || str(d.channel, 40) || null, d.startOn || null, d.endOn || null, num(d.budget), num(d.spent), num(d.visits), ['planned', 'active', 'done'].includes(d.status) ? d.status : 'planned'];
        if (cur) { id = cur.id; await db.q('update mkt_campaigns set project_id=$1, brief=$2, channels=$3, daily_budget=$4, monthly_budget=$5, note=$6, name=$7, channel=$8, start_on=$9, end_on=$10, budget=$11, spent=$12, visits=$13, status=$14, updated_at=now() where id=$15', [...P, ...v, id]); }
        else id = (await db.one('insert into mkt_campaigns (project_id, brief, channels, daily_budget, monthly_budget, note, name, channel, start_on, end_on, budget, spent, visits, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id', [...P, ...v, u.id])).id;
      }
      // a budget changed after it was approved needs approving again
      if (cur && ['submitted', 'partly', 'approved'].includes(cur.plan_status) && (num(d.dailyBudget) !== (cur.daily_budget == null ? null : +cur.daily_budget) || num(d.monthlyBudget) !== (cur.monthly_budget == null ? null : +cur.monthly_budget))) {
        await db.q("update mkt_campaigns set budget_ok_at = null, budget_ok_by = null, plan_status = case when designs_ok_at is not null then 'partly' else 'submitted' end where id = $1", [id]);
      }
      await log(d.id ? 'update' : 'create', 'mkt-campaign', id, { name, daily: P[3], monthly: P[4] });
      return res.json({ ok: true, id });
    }
    if (a === 'campaign.submit') { editOnly(); { const m = await require('../lib/mkt-tools').reraCampaign(intOr(d.id)); if (m) throw fail(400, m); } const r = await require('../lib/mkt-flow').submit(intOr(d.id), u); await log('send-for-approval', 'mkt-campaign', intOr(d.id), {}); return res.json(r); }
    if (a === 'campaign.approve') {
      if (!canApprove(u)) throw fail(403, 'Management approves campaigns.');
      if (!['designs', 'budget', 'both'].includes(d.kind)) throw fail(400, 'Approve what?');
      const r = await require('../lib/mkt-flow').approve(intOr(d.id), d.kind, u); await log('approve-' + d.kind, 'mkt-campaign', intOr(d.id), r); return res.json(r);
    }
    if (a === 'campaign.sendback') {
      if (!canApprove(u)) throw fail(403, 'Management approves campaigns.');
      if (!str(d.note, 1000)) throw fail(400, 'Write what should change.');
      const r = await require('../lib/mkt-flow').sendBack(intOr(d.id), str(d.note, 1000), u); await log('send-back', 'mkt-campaign', intOr(d.id), { note: str(d.note, 300) }); return res.json(r);
    }
    if (a === 'ivr.sync') { editOnly(); return res.json({ ok: true, ...(await require('../lib/exotel').sync({ full: !!d.full })) }); }
    if (a === 'post.publish') { editOnly(); return res.json(await require('../lib/mkt-flow').publishDue({ limit: 5 })); }
    if (a === 'campaign.delete') { editOnly(); await db.q('update mkt_leads set campaign_id = null where campaign_id = $1', [intOr(d.id)]); await db.q('delete from mkt_campaigns where id = $1', [intOr(d.id)]); return res.json({ ok: true }); }

    if (a === 'lead.save') {
      if (!canEdit(u) && !has(u, 'booking.create')) throw fail(403, 'Your login cannot change leads.');
      const phone = phone10(d.phone), email = str(d.email, 160);
      if (!d.id && !phone && !email) throw fail(400, 'Enter the phone number or email.');
      if (d.nextDate && !DATE.test(d.nextDate)) throw fail(400, 'The follow-up date looks wrong.');
      const v = [await projectOf(d.projectId), str(d.name, 120) || null, phone, email || null, SOURCES.includes(d.source) ? d.source : 'other', intOr(d.campaignId) || null, LEAD_ST.includes(d.status) ? d.status : 'new', intOr(d.assignedTo) || null, d.nextDate || null, str(d.note, 2000) || null];
      let id;
      const L = require('../lib/mkt-leads');
      if (d.id) { id = intOr(d.id); const was = await db.one('select status from mkt_leads where id = $1', [id]); await db.q('update mkt_leads set project_id=$1, name=$2, phone=$3, email=$4, source=$5, campaign_id=$6, status=$7, assigned_to=$8, next_date=$9, note=$10, updated_at=now() where id=$11', [...v, id]);
        if (was) await L.statusChanged(id, was.status, v[6]);
        if (d.bookingId !== undefined) await db.q('update mkt_leads set booking_id = $2 where id = $1', [id, intOr(d.bookingId) || null]); }
      else {
        const dup = phone ? await db.one('select id, name from mkt_leads where phone = $1', [phone]) : null;
        if (dup && !d.force) throw Object.assign(fail(409, `This number is already a lead${dup.name ? ' (' + dup.name + ')' : ''}.`), { duplicate: dup.id });
        id = (await db.one('insert into mkt_leads (project_id, name, phone, email, source, sources, campaign_id, status, assigned_to, next_date, note, created_by) values ($1,$2,$3,$4,$5,array[$5],$6,$7,$8,$9,$10,$11) returning id', [...v, u.id])).id;
        await L.statusChanged(id, 'new', v[6]);
        if (!v[7]) await L.route(id).catch(() => {});
        if (v[6] === 'new' && d.welcome !== false) await L.greet(id).catch(() => {});
      }
      await log(d.id ? 'update' : 'create', 'mkt-lead', id, { source: v[4], status: v[6] });
      return res.json({ ok: true, id });
    }
    if (a === 'lead.delete') { editOnly(); await db.q('delete from mkt_leads where id = $1', [intOr(d.id)]); await log('delete', 'mkt-lead', d.id); return res.json({ ok: true }); }

    if (a === 'task.save') {
      editOnly();
      const title = str(d.title, 200); if (!title) throw fail(400, 'Write the task.');
      if (d.due && !DATE.test(d.due)) throw fail(400, 'The date looks wrong.');
      const r = await db.one('insert into mkt_tasks (project_id, title, due, assigned_to, created_by) values ($1, $2, $3, $4, $5) returning id', [await projectOf(d.projectId), title, d.due || null, intOr(d.assignedTo) || null, u.id]);
      return res.json({ ok: true, id: r.id });
    }
    if (a === 'task.done') { editOnly(); await db.q(d.undo ? 'update mkt_tasks set done_at = null, done_by = null where id = $1' : 'update mkt_tasks set done_at = now(), done_by = $2 where id = $1', d.undo ? [intOr(d.id)] : [intOr(d.id), u.id]); return res.json({ ok: true }); }
    if (a === 'task.delete') { editOnly(); await db.q('delete from mkt_tasks where id = $1', [intOr(d.id)]); return res.json({ ok: true }); }

    // figures typed in by hand for a network not connected (LinkedIn, Google Business Profile): one day's numbers
    if (a === 'stats.save') {
      editOnly();
      if (!NETWORKS.includes(d.network) || !DATE.test(d.day || '')) throw fail(400, 'Choose the network and the date.');
      const m = {}; for (const k of ['followers', 'views', 'reach', 'posts', 'interactions', 'gained']) { const x = num(d[k]); if (x != null) m[k] = x; }
      await db.q("insert into mkt_stats (network, day, metrics, source) values ($1, $2, $3, 'manual') on conflict (network, day) do update set metrics = mkt_stats.metrics || excluded.metrics, updated_at = now()", [d.network, d.day, m]);
      return res.json({ ok: true });
    }
    if (a === 'settings') {
      if (!canEdit(u) && u.role !== 'admin') throw fail(403, 'Only the marketing team sets this up.');
      const v = await settings();
      if (Array.isArray(d.channels)) v.channels = d.channels.slice(0, 20).map((c) => ({ network: NETWORKS.includes(c.network) ? c.network : 'website', handle: str(c.handle, 80), url: url(c.url), projectId: pid(c.projectId) })).filter((c) => c.handle || c.url);
      if (d.drive && typeof d.drive === 'object') { v.drive = {}; for (const [k, f] of Object.entries(d.drive)) { const m = String(f || '').match(/(?:folders\/|id=)?([A-Za-z0-9_-]{20,80})/); if (m && (k === 'company' || intOr(k))) v.drive[k] = m[1]; } }
      if (d.needApproval != null) v.needApproval = !!d.needApproval;
      if (d.newLeadKey && u.role === 'admin') v.leadKey = crypto.randomBytes(12).toString('hex');
      await saveSettings(v); await log('update', 'settings', 'marketing', { channels: v.channels.length, drive: Object.keys(v.drive) });
      return res.json({ ok: true });
    }
    if (a === 'sync') { editOnly(); return res.json({ ok: true, ...(await require('../lib/social').sync({ full: !!d.full, only: require('../lib/social').PARTS.includes(d.part) ? d.part : null })) }); }
    if (a === 'disconnect') { editOnly(); if (!['meta', 'youtube'].includes(d.net)) throw fail(400, 'Which one?'); await require('../lib/social').disconnect(d.net); await log('disconnect', 'social', d.net); return res.json({ ok: true }); }

    // ---------- spend (other than ads), budgets ----------
    if (a === 'spend.save') {
      editOnly();
      const amount = num(d.amount); if (!(amount >= 0) || amount == null) throw fail(400, 'Enter the amount.');
      if (!DATE.test(d.spentOn || '')) throw fail(400, 'Enter the date (or the first day it ran).');
      if (d.until && !DATE.test(d.until)) throw fail(400, 'The end date looks wrong.');
      const kind = SPEND_KINDS.includes(d.kind) ? d.kind : 'other', source = SOURCES.includes(d.source) ? d.source : (SPEND_SOURCE[kind] || null);
      const v = [await projectOf(d.projectId), intOr(d.campaignId) || null, kind, source, str(d.vendor, 160) || null, amount, d.spentOn, d.until || null, str(d.note, 1000) || null];
      let id;
      if (d.id) { id = intOr(d.id); const r = await db.one('update mkt_spend set project_id=$1, campaign_id=$2, kind=$3, source=$4, vendor=$5, amount=$6, spent_on=$7, until=$8, note=$9, updated_at=now() where id=$10 returning id', [...v, id]); if (!r) throw fail(404, 'That entry is not there any more.'); }
      else id = (await db.one('insert into mkt_spend (project_id, campaign_id, kind, source, vendor, amount, spent_on, until, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [...v, u.id])).id;
      if (d.file && d.file.data) {
        const mime = String(d.file.mime || ''), buf = Buffer.from(String(d.file.data), 'base64');
        if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(mime)) throw fail(400, 'Attach the invoice as a PDF, PNG or JPG.');
        if (buf.length > 3 * 1024 * 1024) throw fail(400, 'The invoice must be under 3 MB.');
        await db.q('update mkt_spend set file_name = $2, file_mime = $3, file_data = $4 where id = $1', [id, str(d.file.name, 120) || 'invoice', mime, buf]);
      }
      await log(d.id ? 'update' : 'create', 'mkt-spend', id, { kind, amount });
      return res.json({ ok: true, id });
    }
    if (a === 'spend.delete') { editOnly(); await db.q('delete from mkt_spend where id = $1', [intOr(d.id)]); await log('delete', 'mkt-spend', d.id); return res.json({ ok: true }); }
    if (a === 'budgets.save') {
      if (!canApprove(u)) throw fail(403, 'Management sets the marketing budgets.');
      const R = require('../lib/mkt-results'); const fy = DATE.test(d.fy || '') ? d.fy : R.fyStart();
      const b2 = await R.saveBudgets(fy, d.budgets || {}); await log('update', 'mkt-budgets', fy, b2); return res.json({ ok: true, budgets: b2 });
    }
    // ---------- following up leads ----------
    if (a === 'lead.contact') {
      if (!canEdit(u) && !has(u, 'booking.create')) throw fail(403, 'Your login cannot change leads.');
      const r = await require('../lib/mkt-leads').contact(intOr(d.id), u, { outcome: d.outcome, note: str(d.note, 500) });
      if (!r) throw fail(404, 'That lead is not there any more.'); return res.json({ ok: true, status: r.status });
    }
    if (a === 'follow.save') {
      editOnly();
      const v = await settings(), f = {};
      const ids = (x) => (Array.isArray(x) ? x.map(intOr).filter(Boolean).slice(0, 20) : []);
      f.people = {}; for (const [k, x] of Object.entries(d.people || {})) if (k === 'company' || intOr(k)) f.people[k] = ids(x);
      f.projects = {}; for (const [k, x] of Object.entries(d.projects || {})) if (intOr(k) && x) f.projects[k] = { brochure: url(x.brochure), template: str(x.template, 80) || null, text: str(x.text, 1000) || null };
      f.template = str(d.template, 80) || null; f.repTemplate = str(d.repTemplate, 80) || null; f.text = str(d.text, 1000) || null; f.brochure = url(d.brochure);
      f.alertHours = Math.min(24, Math.max(1, intOr(d.alertHours) || 2)); f.welcome = d.welcome !== false;
      v.follow = f; await saveSettings(v); await log('update', 'settings', 'marketing-follow', { people: Object.keys(f.people).length });
      return res.json({ ok: true });
    }
    if (a === 'lead.greet') { editOnly(); return res.json({ ok: true, ...(await require('../lib/mkt-leads').greet(intOr(d.id))) }); }
    // ---------- money controls ----------
    if (a === 'change.request') { if (!canEdit(u) && !canApprove(u)) throw fail(403, 'Only the marketing team asks for changes.'); const r = await require('../lib/mkt-money').request(u, { campaignId: intOr(d.campaignId), kind: d.kind, value: d.value, reason: str(d.reason, 500) }, { canApprove: canApprove(u) }); await log('change-' + d.kind, 'mkt-campaign', intOr(d.campaignId), r); return res.json(r); }
    if (a === 'change.decide') { if (!canApprove(u)) throw fail(403, 'Management approves changes.'); const r = await require('../lib/mkt-money').decide(intOr(d.id), !!d.approve, u); await log(d.approve ? 'approve-change' : 'reject-change', 'mkt-change', intOr(d.id), r); return res.json(r); }
    if (a === 'alerts.run') { if (!canApprove(u) && u.role !== 'admin') throw fail(403, 'Management only.'); return res.json({ ok: true, ...(await require('../lib/mkt-money').alerts({ force: true })) }); }
    if (a === 'digest.send') { if (!canApprove(u) && u.role !== 'admin') throw fail(403, 'Management only.'); return res.json({ ok: true, ...(await require('../lib/mkt-money').digest({ force: true })) }); }
    if (a === 'capi.run') { editOnly(); return res.json({ ok: true, ...(await require('../lib/mkt-leads').capi({})) }); }
    // ---------- the Inbox (comments) ----------
    if (a === 'comment.reply') {
      editOnly(); const text = str(d.text, 1000); if (!text) throw fail(400, 'Write the reply.');
      const c = await db.one('select network, ext_id from mkt_comments where network = $1 and ext_id = $2', [d.network, String(d.extId || '')]); if (!c) throw fail(404, 'That comment is not there any more.');
      await require('../lib/social').replyComment(c.network, c.ext_id, text);
      await db.q('update mkt_comments set reply = $3, replied_at = now(), replied_by = $4, done = true where network = $1 and ext_id = $2', [c.network, c.ext_id, text, u.id]);
      return res.json({ ok: true });
    }
    if (a === 'comment.done') { editOnly(); await db.q('update mkt_comments set done = $3 where network = $1 and ext_id = $2', [d.network, String(d.extId || ''), d.done !== false]); return res.json({ ok: true }); }
    if (a === 'comment.lead') {
      editOnly(); const c = await db.one('select * from mkt_comments where network = $1 and ext_id = $2', [d.network, String(d.extId || '')]); if (!c) throw fail(404, 'That comment is not there any more.');
      const phone = phone10(d.phone || (String(c.text).match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/) || [])[0]); if (!phone) throw fail(400, 'Enter their phone number (ask for it in the reply).');
      const r = await require('../lib/mkt-leads').add({ name: str(d.name, 120) || c.author, phone, source: c.network, projectId: pid(d.projectId), note: `Comment on ${c.network}: ${String(c.text).slice(0, 300)}`, by: u.id });
      await db.q('update mkt_comments set lead_id = $3, done = true where network = $1 and ext_id = $2', [c.network, c.ext_id, r.id]);
      return res.json({ ok: true, id: r.id, duplicate: !!r.duplicate });
    }
    // ---------- Canva, captions, competitors, Google Ads ----------
    if (a === 'canva.import') {
      editOnly();
      const post = await db.one('select id from mkt_posts where id = $1', [intOr(d.postId)]); if (!post) throw fail(404, 'Save the post first.');
      const files = await require('../lib/mkt-tools').canvaExport(str(d.designId, 60), ['png', 'jpg', 'pdf', 'mp4'].includes(d.type) ? d.type : 'png');
      if (!files.length) throw fail(502, 'Canva gave no file back.');
      let added = 0;
      for (const f of files) { if (f.data.length > 3 * 1024 * 1024) continue; await db.q('insert into mkt_post_files (post_id, name, mime, size, data, created_by) values ($1, $2, $3, $4, $5, $6)', [post.id, f.name, f.mime, f.data.length, f.data, u.id]); added++; }
      if (d.editUrl && url(d.editUrl)) await db.q('update mkt_posts set canva_url = coalesce(canva_url, $2) where id = $1', [post.id, url(d.editUrl)]);
      if (!added) throw fail(400, 'The export is over 3 MB. Export a smaller size, or put the Drive link in "File or video link".');
      await log('attach-canva', 'mkt-post', post.id, { design: d.designId, files: added });
      return res.json({ ok: true, added, skipped: files.length - added });
    }
    if (a === 'canva.disconnect') { editOnly(); await require('../lib/mkt-tools').canvaDisconnect(); return res.json({ ok: true }); }
    if (a === 'caption.draft') { editOnly(); return res.json(await require('../lib/mkt-tools').captions({ title: str(d.title, 200), brief: str(d.brief, 2000), projectId: pid(d.projectId), kind: str(d.kind, 20), channels: Array.isArray(d.channels) ? d.channels.slice(0, 6) : [], language: str(d.language, 10) })); }
    if (a === 'competitors.save') { editOnly(); const v = await settings(); v.competitors = (Array.isArray(d.list) ? d.list : []).map((c) => ({ name: str(c.name, 80), page: url(c.page) })).filter((c) => c.name).slice(0, 20); await saveSettings(v); return res.json({ ok: true }); }
    if (a === 'gads.sync') { editOnly(); return res.json({ ok: true, ...(await require('../lib/gads').sync({ full: !!d.full })) }); }
    if (a === 'gads.disconnect') { editOnly(); await require('../lib/gads').disconnect(); return res.json({ ok: true }); }
    throw fail(400, 'Unknown action.');
  },
});

// A design file for Instagram / Facebook to fetch when posting (a signed link; only designs of approved posts).
async function publicFile(req, res) {
  const t = await require('../lib/mkt-flow').verify((req.query || {}).pub);
  const f = t && t.f ? await db.one("select f.mime, f.data from mkt_post_files f join mkt_posts p on p.id = f.post_id where f.id = $1 and (p.status in ('approved', 'scheduled', 'published') or p.status = 'review')", [t.f]) : null;
  if (!f) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.end(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
}
module.exports = (req, res) => ((req.query || {}).approve ? require('../lib/mkt-flow').linkPage(req, res).catch((e) => { console.error('approval link', e); if (res.headersSent) return; res.statusCode = 500; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dream India ERP</title><body style="font-family:Arial,sans-serif;background:#F7F7FB;padding:24px;color:#10114e"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px"><h2>That did not go through</h2><p>${String(e.message || 'Unknown error').replace(/[<>&]/g, '')}</p><p>Approve it from Marketing in the ERP instead.</p></div></body>`); })
  : (req.query || {}).pub ? publicFile(req, res).catch(() => { res.statusCode = 404; res.end('Not found'); })
  : (req.query || {}).hit ? hitHook(req, res).catch((e) => { console.error('hit', e.message); res.statusCode = 204; res.end(); })
  : (req.query || {}).ivr ? ivrHook(req, res).catch((e) => { console.error(e); res.statusCode = 200; res.end('OK'); })
  : (req.query || {}).lead ? leadHook(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Could not save the lead.' }); }) : handler(req, res));
module.exports.settings = settings;
module.exports.recordIvrCall = recordIvrCall;
module.exports.webAggregate = webAggregate;
module.exports.webChannel = webChannel;
