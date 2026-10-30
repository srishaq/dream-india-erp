// Marketing & social media, company-wide or by project.
// GET  ?scope=company|<projectId> → channels (figures from Metricool), posts, campaigns, leads, tasks, settings
//      ?library=company|<projectId> → the design library from that project's Google Drive folder
//      ?thumb=<driveFileId> → a file's preview picture
// POST {action}: post.save | post.status | post.delete | campaign.save | campaign.delete | lead.save | lead.delete |
//      task.save | task.done | task.delete | stats.save (typed figures) | settings | sync (Metricool now)
// POST ?lead=<key> (from the website form, Meta lead ads through a connector, a portal…): a new lead, no login.
// Rupali (role Marketing) works here; Management sees everything and approves posts sent for review.
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');

const NETWORKS = ['instagram', 'facebook', 'youtube', 'linkedin', 'website', 'whatsapp', 'google'];
const SOURCES = ['instagram', 'facebook', 'meta_ads', 'google_ads', 'youtube', 'website', 'whatsapp', '99acres', 'magicbricks', 'housing', 'walk_in', 'referral', 'channel_partner', 'telecalling', 'hoarding', 'event', 'other'];
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
  for (const k of ['views', 'reach', 'posts', 'interactions', 'gained']) { out[k] = sum(k, cur); out[k + 'Before'] = sum(k, prev); }
  return out;
}

async function overview(u, scope) {
  const set = await settings();
  const projectId = pid(scope);
  const inScope = (col = 'project_id') => (projectId ? `${col} = ${+projectId}` : 'true');
  const chans = set.channels.filter((c) => !projectId || !c.projectId || +c.projectId === projectId);
  const channels = [];
  for (const c of chans) channels.push({ ...c, ...(await channelFigures(c.network)) });
  const posts = await db.q(`select p.*, array_to_json(p.channels) as channels, c.name as created_name, a.name as approved_name from mkt_posts p left join users c on c.id = p.created_by left join users a on a.id = p.approved_by
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
  const sync = await db.one("select done_at, info from job_marks where key = 'metricool-sync'");
  return { scope: projectId || 'company', projects, team, channels, posts, campaigns, leads, tasks,
    settings: { channels: set.channels, drive: set.drive, needApproval: !!set.needApproval, share: (() => { try { return require('../lib/sheets').serviceEmail(); } catch { return null; } })(), leadUrl: canEdit(u) ? `/api/marketing?lead=${set.leadKey}` : null },
    metricool: { configured: require('../lib/metricool').configured(), lastSync: sync ? { at: sync.done_at, ...sync.info } : null },
    can: { edit: canEdit(u), approve: canApprove(u), admin: u.role === 'admin' }, lists: { networks: NETWORKS, sources: SOURCES, kinds: KINDS, statuses: STATUSES, leadStatuses: LEAD_ST } };
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

const handler = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canView(u)) throw fail(403, 'Your login does not open Marketing.');
    const q = req.query || {};
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
    return res.json(await overview(u, q.scope));
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
      if (st === 'approved') { if (!canApprove(u)) throw fail(403, 'Management approves posts.'); await db.q("update mkt_posts set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() where id = $1", [id, u.id]); }
      else { editOnly(); await db.q('update mkt_posts set status = $2, post_url = coalesce($3, post_url), updated_by = $4, updated_at = now() where id = $1', [id, st, url(d.postUrl), u.id]); }
      await log('status', 'mkt-post', id, { status: st });
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

    // figures typed in by hand for a network Metricool does not cover (or before it is connected): one day's numbers
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
    if (a === 'sync') { editOnly(); return res.json({ ok: true, ...(await require('../lib/metricool').sync({})) }); }
    throw fail(400, 'Unknown action.');
  },
});

module.exports = (req, res) => ((req.query || {}).lead ? leadHook(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Could not save the lead.' }); }) : handler(req, res));
module.exports.settings = settings;
