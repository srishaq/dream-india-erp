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
  const posts = await db.q(`select p.*, array_to_json(p.channels) as channels, c.name as created_name, a.name as approved_name,
       (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size) order by f.id), '[]') from mkt_post_files f where f.post_id = p.id) as files
     from mkt_posts p left join users c on c.id = p.created_by left join users a on a.id = p.approved_by
     where ${inScope('p.project_id')} and (p.publish_at is null or p.publish_at > now() - interval '120 days') order by p.publish_at nulls first, p.id`);
  const campaigns = await db.q(`select c.*, (select count(*)::int from mkt_leads l where l.campaign_id = c.id) as leads,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status = 'visit') as visit_leads,
       (select count(*)::int from mkt_leads l where l.campaign_id = c.id and l.status = 'booked') as booked
     from mkt_campaigns c where ${inScope('c.project_id')} order by (c.status = 'done'), c.start_on desc nulls last, c.id desc`);
  const leads = await db.q(`select l.*, a.name as assigned_name, c.name as campaign_name,
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
  return { top, scope: projectId || 'company', projects, team, channels, posts, campaigns, leads, tasks,
    settings: { channels: set.channels, drive: set.drive, needApproval: !!set.needApproval, share: (() => { try { return require('../lib/sheets').serviceEmail(); } catch { return null; } })(), leadUrl: canEdit(u) ? `/api/marketing?lead=${set.leadKey}` : null, ivrUrl: canEdit(u) ? `/api/marketing?ivr=${set.leadKey}` : null },
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

// The rows behind a box on the Overview: followers, views, reach, content, leads, cost per lead (last 30 days).
async function mdrill(key, scope) {
  const projectId = pid(scope), set = await settings();
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
  if (key === 'views' || key === 'reach') {
    const rows = await db.q(`select to_char(day, 'YYYY-MM-DD') as day, network, (metrics->>'views')::numeric as views, (metrics->>'reach')::numeric as reach, (metrics->>'interactions')::numeric as interactions,
        (metrics->>'posts')::numeric as posts, (metrics->>'followers')::numeric as followers from mkt_stats where day > ${since} and network = any($1) order by day desc, network`, [nets]);
    return { title: key === 'views' ? 'Views, day by day (last 30 days)' : 'Reach, day by day (last 30 days)',
      columns: [['day', 'Date', 'date'], ['network', 'Channel'], ['views', 'Views', 'n'], ['reach', 'Reach', 'n'], ['interactions', 'Interactions', 'n'], ['posts', 'Posts', 'n'], ['followers', 'Followers', 'n']], rows: rows.map((r) => ({ ...r, network: NAME[r.network] || r.network })) };
  }
  if (key === 'posts') {
    const rows = await db.q(`select to_char(posted_at + interval '330 minutes', 'YYYY-MM-DD') as day, network, kind, caption, views, reach, likes, comments, shares, saves, permalink
       from mkt_media where posted_at > now() - interval '30 days' and network = any($1) order by posted_at desc`, [nets]);
    return { title: 'Content published, last 30 days', columns: [['day', 'Date', 'date'], ['network', 'Channel'], ['kind', 'Type'], ['caption', 'Caption'], ['views', 'Views', 'n'], ['reach', 'Reach', 'n'], ['likes', 'Likes', 'n'], ['comments', 'Comments', 'n'], ['shares', 'Shares', 'n'], ['permalink', 'Link', 'link']],
      rows: rows.map((r) => ({ ...r, network: NAME[r.network] || r.network, caption: String(r.caption || '').slice(0, 140) })) };
  }
  if (key === 'leads') {
    const rows = await db.q(`select to_char(l.created_at + interval '330 minutes', 'YYYY-MM-DD') as day, l.name, l.phone, l.source, c.name as campaign, l.status, p.name as project, l.note
       from mkt_leads l left join mkt_campaigns c on c.id = l.campaign_id left join projects p on p.id = l.project_id where l.created_at > now() - interval '30 days' ${projectId ? 'and l.project_id = ' + +projectId : ''} order by l.created_at desc`);
    return { title: 'Leads, last 30 days', columns: [['day', 'Date', 'date'], ['name', 'Name'], ['phone', 'Phone'], ['source', 'Source'], ['campaign', 'Campaign'], ['status', 'Status'], ['project', 'Project'], ['note', 'Note']], rows };
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
  const pj = projects.find((p) => String(p.id) === String(b.project) || (b.project && new RegExp(String(b.project).replace(/[^a-z0-9 ]/gi, ''), 'i').test(p.name))) || projects.find((p) => p.code === 'SIGNATURE') || null;
  const source = SOURCES.includes(String(b.source || '').toLowerCase()) ? String(b.source).toLowerCase() : 'website';
  const ext = str(b.id || b.leadgen_id, 120) || null;
  const dup = phone ? await db.one("select id from mkt_leads where phone = $1 and created_at > now() - interval '30 days'", [phone]) : null;
  if (dup) { await db.q("update mkt_leads set note = concat_ws(E'\\n', note, $2::text), updated_at = now() where id = $1", [dup.id, `Came again from ${source} on ${new Date().toISOString().slice(0, 10)}`]); return res.json({ ok: true, id: dup.id, duplicate: true }); }
  const r = await db.one(`insert into mkt_leads (project_id, name, phone, email, source, note, ext_id) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (ext_id) where ext_id is not null do update set updated_at = now() returning id`, [pj && pj.id, name || null, phone, email || null, source, str(b.message || b.note, 1000) || null, ext]);
  return res.json({ ok: true, id: r.id });
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
  const proj = (set.ivrProjects || {})[ivrNo] || (await db.one("select id from projects where code = 'SIGNATURE'") || {}).id || null;
  const call = await db.one(`insert into mkt_ivr_calls (sid, caller, ivr_number, called_at, status, duration, recording_url, digits, project_id, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (sid) do update set status = coalesce(excluded.status, mkt_ivr_calls.status), duration = coalesce(excluded.duration, mkt_ivr_calls.duration),
       recording_url = coalesce(excluded.recording_url, mkt_ivr_calls.recording_url), raw = excluded.raw returning id, lead_id, (xmax = 0) as fresh`,
  [sid || `ivr-${caller}-${at.getTime()}`, caller, ivrNo, at, status, duration, rec, digits, proj, P]);
  if (!call.lead_id) {
    const when = at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dup = await db.one("select id from mkt_leads where phone = $1 and created_at > now() - interval '30 days' order by id desc limit 1", [caller]);
    let leadId;
    if (dup) { leadId = dup.id; await db.q("update mkt_leads set note = concat_ws(E'\\n', note, $2::text), updated_at = now() where id = $1", [dup.id, `Called the IVR again on ${when}`]); }
    else leadId = (await db.one("insert into mkt_leads (project_id, phone, source, note, ext_id) values ($1, $2, 'ivr', $3, $4) returning id", [proj, caller, `Called the IVR${ivrNo ? ' (' + ivrNo + ')' : ''} on ${when}`, 'ivr:' + (sid || caller + at.getTime())])).id;
    await db.q('update mkt_ivr_calls set lead_id = $2 where id = $1', [call.id, leadId]);
  }
  res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end('OK');
}

const handler = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open Marketing.');
    const q = req.query || {};
    const social = require('../lib/social');
    if (q.connect) {
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
    if (q.report != null) return res.json(await report(q.report));
    if (q.mdrill) return res.json(await mdrill(String(q.mdrill), q.scope));
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
      const v = [await projectOf(d.projectId), name, str(d.channel, 40) || null, d.startOn || null, d.endOn || null, num(d.budget), num(d.spent), num(d.visits), str(d.note, 1000) || null, ['planned', 'active', 'done'].includes(d.status) ? d.status : 'active'];
      let id;
      if (d.id) { id = intOr(d.id); await db.q('update mkt_campaigns set project_id=$1, name=$2, channel=$3, start_on=$4, end_on=$5, budget=$6, spent=$7, visits=$8, note=$9, status=$10, updated_at=now() where id=$11', [...v, id]); }
      else id = (await db.one('insert into mkt_campaigns (project_id, name, channel, start_on, end_on, budget, spent, visits, note, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id', [...v, u.id])).id;
      await log(d.id ? 'update' : 'create', 'mkt-campaign', id, { name, spent: v[6] });
      return res.json({ ok: true, id });
    }
    if (a === 'campaign.delete') { editOnly(); await db.q('update mkt_leads set campaign_id = null where campaign_id = $1', [intOr(d.id)]); await db.q('delete from mkt_campaigns where id = $1', [intOr(d.id)]); return res.json({ ok: true }); }

    if (a === 'lead.save') {
      if (!canEdit(u) && !has(u, 'booking.create')) throw fail(403, 'Your login cannot change leads.');
      const phone = phone10(d.phone), email = str(d.email, 160);
      if (!d.id && !phone && !email) throw fail(400, 'Enter the phone number or email.');
      if (d.nextDate && !DATE.test(d.nextDate)) throw fail(400, 'The follow-up date looks wrong.');
      const v = [await projectOf(d.projectId), str(d.name, 120) || null, phone, email || null, SOURCES.includes(d.source) ? d.source : 'other', intOr(d.campaignId) || null, LEAD_ST.includes(d.status) ? d.status : 'new', intOr(d.assignedTo) || null, d.nextDate || null, str(d.note, 2000) || null];
      let id;
      if (d.id) { id = intOr(d.id); await db.q('update mkt_leads set project_id=$1, name=$2, phone=$3, email=$4, source=$5, campaign_id=$6, status=$7, assigned_to=$8, next_date=$9, note=$10, updated_at=now() where id=$11', [...v, id]); }
      else {
        const dup = phone ? await db.one('select id, name from mkt_leads where phone = $1', [phone]) : null;
        if (dup && !d.force) throw Object.assign(fail(409, `This number is already a lead${dup.name ? ' (' + dup.name + ')' : ''}.`), { duplicate: dup.id });
        id = (await db.one('insert into mkt_leads (project_id, name, phone, email, source, campaign_id, status, assigned_to, next_date, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id', [...v, u.id])).id;
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
    throw fail(400, 'Unknown action.');
  },
});

module.exports = (req, res) => ((req.query || {}).ivr ? ivrHook(req, res).catch((e) => { console.error(e); res.statusCode = 200; res.end('OK'); })
  : (req.query || {}).lead ? leadHook(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Could not save the lead.' }); }) : handler(req, res));
module.exports.settings = settings;
