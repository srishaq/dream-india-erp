// Every lead, from every source, into one list, and followed up fast.
//   add()        one phone number = one lead: a number that comes again (any source, any time) is the same lead, with
//                the new source added and a note; a lost lead that comes back is opened again.
//   route()      a new lead is given to a sales person: by project, in turn (Set-up → Lead follow-up).
//   welcome()    the new lead gets an instant WhatsApp (an approved Click Connect template, or a free text when they
//                messaged us first); the sales person is told by email (and WhatsApp when a template is set).
//   contact()    "Called" on a lead: the first call is timed (response time on the Overview).
//   overdue()    every 5 minutes: a new lead nobody has called after 2 hours goes to the sales person and Management
//                (once; outside 9 am–9 pm it waits for the morning).
//   portalMail() 99acres / MagicBricks / Housing.com lead emails, read from the leads mailbox.
//   whatsappIn() a WhatsApp message from a number that is not a buyer, staff or partner: a lead (source WhatsApp).
//   stages to Meta (Conversions API for CRM): see capi().
// Safety: until the ERP is live (ERP_LIVE=1) WhatsApps go only to the test mobile and emails to the test address.
const crypto = require('crypto');
const db = require('./db');

const live = () => process.env.ERP_LIVE === '1';
const phone10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
const e = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');
const istHour = () => new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
const SRCNAME = { ivr: 'IVR call', instagram: 'Instagram', facebook: 'Facebook', meta_ads: 'Meta ads', google_ads: 'Google ads', youtube: 'YouTube', website: 'Website', whatsapp: 'WhatsApp', '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', walk_in: 'Walk-in', referral: 'Referral', channel_partner: 'Channel partner', telecalling: 'Telecalling', hoarding: 'Hoarding', event: 'Event', other: 'Other' };

async function mset() { const r = await db.one("select value from settings where key = 'marketing'"); return (r && r.value) || {}; }
const follow = (s) => ({ alertHours: 2, welcome: true, ...(s.follow || {}) });
const fmtAt = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// ---------- one lead in ----------
async function add({ name, phone, email, source = 'other', projectId = null, campaignId = null, note = null, ext = null, utm = null, at = null, adName = null, by = null, welcome = true, status = 'new', visit = false }) {
  phone = phone10(phone); email = email ? String(email).trim().slice(0, 160) : null;
  if (!phone && !email) throw Object.assign(new Error('A lead needs a phone number or an email.'), { status: 400 });
  if (ext) { const x = await db.one('select id from mkt_leads where ext_id = $1', [ext]); if (x) return { id: x.id, duplicate: true }; }
  const dup = phone ? await db.one('select id, status, sources from mkt_leads where phone = $1 order by id limit 1', [phone])
    : await db.one('select id, status, sources from mkt_leads where lower(email) = lower($1) order by id limit 1', [email]);
  const when = at ? new Date(at) : new Date();
  if (dup) {
    const reopen = dup.status === 'lost';
    await db.q(`update mkt_leads set sources = case when $2 = any(sources) then sources else array_append(sources, $2) end,
        note = concat_ws(E'\\n', note, $3::text), name = coalesce(name, $4), email = coalesce(email, $5), campaign_id = coalesce(campaign_id, $6), project_id = coalesce(project_id, $7),
        status = case when $8 then 'new' else (case when $9 and status in ('new', 'contacted') then 'visit' else status end) end,
        visit_at = case when $9 then coalesce(visit_at, now()) else visit_at end,
        alerted_at = case when $8 then null else alerted_at end, updated_at = now() where id = $1`,
      [dup.id, source, `Came again from ${SRCNAME[source] || source} on ${fmtAt(when)}${note ? ': ' + String(note).slice(0, 300) : ''}${ext ? ' [' + ext + ']' : ''}`, name || null, email || null, campaignId, projectId, reopen, !!visit]);
    if (reopen) await route(dup.id).catch(() => {});
    return { id: dup.id, duplicate: true, reopened: reopen };
  }
  const r = await db.one(`insert into mkt_leads (project_id, name, phone, email, source, sources, campaign_id, note, ext_id, utm, created_at, ad_name, created_by, status, visit_at, first_contact_at)
     values ($1, $2, $3, $4, $5, array[$5], $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [projectId, name || null, phone, email, source, campaignId, note, ext, utm, when, adName, by, status, visit ? when : null, visit || status !== 'new' ? when : null]);
  await route(r.id).catch((x) => console.error('route lead', x.message));
  // a lead from long ago (history pulled in) is not welcomed or chased
  if (welcome && Date.now() - when.getTime() < 6 * 3600e3) await greet(r.id).catch((x) => console.error('welcome lead', x.message));
  return { id: r.id };
}

// ---------- given to a sales person, in turn, by project ----------
async function route(id) {
  const l = await db.one('select id, project_id, assigned_to from mkt_leads where id = $1', [id]); if (!l || l.assigned_to) return null;
  const f = follow(await mset());
  const list = ((f.people || {})[l.project_id ? String(l.project_id) : 'company'] || (f.people || {}).company || []).map(Number).filter(Boolean);
  if (!list.length) return null;
  const ok = (await db.q('select id from users where id = any($1) and not disabled', [list])).map((x) => x.id);
  if (!ok.length) return null;
  // the one who was given a lead longest ago
  const last = Object.fromEntries((await db.q('select assigned_to, max(created_at) as t from mkt_leads where assigned_to = any($1) group by assigned_to', [ok])).map((x) => [x.assigned_to, Date.parse(x.t)]));
  const pick = ok.slice().sort((a, b) => (last[a] || 0) - (last[b] || 0) || ok.indexOf(a) - ok.indexOf(b))[0];
  await db.q('update mkt_leads set assigned_to = $2 where id = $1 and assigned_to is null', [id, pick]);
  return pick;
}

async function testMobile() { return ((await db.one("select value from settings where key = 'letters'")) || {}).value?.testMobile || null; }
async function testEmail() { return String((((await db.one("select value from settings where key = 'letters'")) || {}).value || {}).testEmail || '').split(/[\/,;\s]+/).filter((x) => /@/.test(x)).slice(0, 1); }
async function mail(to, subject, html) {
  const mailer = require('./mailer'); if (!mailer.configured()) return { skipped: 'no mail account' };
  const list = live() ? [...new Set(to.filter((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x || '')))] : await testEmail();
  if (!list.length) return { skipped: 'no address' };
  const conn = await mailer.connect();
  try { await conn.send({ to: list, subject: (live() ? '' : '[TEST] ') + subject, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#10114e;max-width:640px">${live() ? '' : '<p style="font-size:12px;color:#B54708">Test version: once the ERP is live this goes to ' + e(to.join(', ')) + '.</p>'}${html}</div>`, text: subject, fromName: 'Dream India ERP' }); }
  finally { await conn.close().catch(() => {}); }
  return { to: list };
}
async function wa(phone, { template, params = [], text }) {
  const w = require('./whatsapp'); if (!w.configured()) return { skipped: 'WhatsApp not connected' };
  const to = live() ? phone : await testMobile(); if (!to) return { skipped: 'no test mobile' };
  return w.sendStaff({ phone: to, template, params, text });
}

// ---------- the instant reply to the lead, and the sales person told ----------
async function greet(id) {
  const l = await db.one(`select l.*, p.name as project, u.name as rep, u.email as rep_email, u.phone as rep_phone from mkt_leads l left join projects p on p.id = l.project_id
     left join users u on u.id = l.assigned_to where l.id = $1`, [id]);
  if (!l) return null;
  const f = follow(await mset()), out = {};
  const proj = (f.projects || {})[String(l.project_id)] || {};
  if (f.welcome && l.phone && !l.welcomed_at) {
    const first = (l.name || '').split(/\s+/)[0] || 'there';
    try {
      if (l.source === 'whatsapp' && (proj.text || f.text)) out.lead = await wa(l.phone, { text: String(proj.text || f.text).replace(/\{name\}/g, first).replace(/\{project\}/g, l.project || 'Dream India').replace(/\{brochure\}/g, proj.brochure || '') });
      else if (f.template) out.lead = await wa(l.phone, { template: proj.template || f.template, params: [first, l.project || 'Dream India', proj.brochure || f.brochure || host()] });
      if (out.lead && !out.lead.skipped) await db.q('update mkt_leads set welcomed_at = now() where id = $1', [id]);
    } catch (x) { out.leadError = x.message; }
  }
  if (l.assigned_to) {
    const html = `<p>A new lead for you${l.project ? ' for <b>' + e(l.project) + '</b>' : ''}: <b>${e(l.name || 'no name')}</b>, ${e(l.phone || l.email)} (${e(SRCNAME[l.source] || l.source)}).</p>
      ${l.note ? `<p style="background:#F7F7FB;padding:10px;border-radius:8px;white-space:pre-wrap">${e(String(l.note).slice(0, 600))}</p>` : ''}<p>Please call within 15 minutes, then mark it "Called" in the ERP.</p><p><a href="${host()}/#/marketing">Open Leads</a></p>`;
    out.rep = await mail([l.rep_email], `New lead: ${l.name || l.phone}`, html).catch((x) => ({ error: x.message }));
    if (f.repTemplate && l.rep_phone) out.repWa = await wa(l.rep_phone, { template: f.repTemplate, params: [l.rep || '', l.name || 'no name', l.phone || '', SRCNAME[l.source] || l.source] }).catch((x) => ({ error: x.message }));
  }
  return out;
}

// ---------- "Called" ----------
async function contact(id, user, { outcome = 'contacted', note = null } = {}) {
  const st = ['contacted', 'visit', 'lost'].includes(outcome) ? outcome : 'contacted';
  const r = await db.one(`update mkt_leads set first_contact_at = coalesce(first_contact_at, now()), status = case when status in ('booked') then status when $2 = 'contacted' and status = 'visit' then status else $2 end,
      visit_at = case when $2 = 'visit' then coalesce(visit_at, now()) else visit_at end, note = concat_ws(E'\\n', note, $3::text), updated_at = now() where id = $1 returning id, status`,
    [id, st, `${fmtAt(new Date())} ${user.name}: ${st === 'contacted' ? 'called' : st === 'visit' ? 'site visit' : 'lost'}${note ? ' — ' + String(note).slice(0, 500) : ''}`]);
  if (r) await queueStage(id, r.status).catch(() => {});
  return r;
}
// when a lead's status changes in the form
async function statusChanged(id, from, to) {
  if (from === to) return;
  await db.q(`update mkt_leads set first_contact_at = case when $2 <> 'new' then coalesce(first_contact_at, now()) else first_contact_at end,
      visit_at = case when $2 in ('visit', 'booked') then coalesce(visit_at, now()) else visit_at end, booked_at = case when $2 = 'booked' then coalesce(booked_at, now()) else booked_at end where id = $1`, [id, to]);
  await queueStage(id, to).catch(() => {});
}

// ---------- nobody called after 2 hours ----------
async function overdue({ limit = 20 } = {}) {
  const f = follow(await mset()), h = istHour();
  if (h < 9 || h >= 21) return { waiting: 'outside 9 am – 9 pm' };
  const rows = await db.q(`select l.id, l.name, l.phone, l.source, l.created_at, p.name as project, u.name as rep, u.email as rep_email from mkt_leads l left join projects p on p.id = l.project_id left join users u on u.id = l.assigned_to
     where l.status = 'new' and l.first_contact_at is null and l.alerted_at is null and l.created_at < now() - ($1 || ' hours')::interval and l.created_at > now() - interval '3 days' order by l.created_at limit $2`, [String(f.alertHours || 2), limit]);
  if (!rows.length) return { sent: 0 };
  const mgmt = (await require('./mkt-flow').approvers()).map((x) => x.email);
  const byRep = {}; for (const r of rows) (byRep[r.rep_email || ''] = byRep[r.rep_email || ''] || []).push(r);
  for (const [rep, list] of Object.entries(byRep)) {
    const html = `<p>${list.length} new lead${list.length > 1 ? 's have' : ' has'} not been called for more than ${f.alertHours || 2} hours:</p><table cellpadding="6" style="border-collapse:collapse">${list.map((r) => `<tr><td><b>${e(r.name || 'no name')}</b></td><td>${e(r.phone || '')}</td><td>${e(SRCNAME[r.source] || r.source)}</td><td>${e(r.project || '')}</td><td>${e(r.rep || 'nobody')}</td><td>came in ${e(fmtAt(r.created_at))}</td></tr>`).join('')}</table><p><a href="${host()}/#/marketing">Open Leads</a></p>`;
    await mail([rep, ...mgmt].filter(Boolean), `Not called yet: ${list.length} lead${list.length > 1 ? 's' : ''}`, html).catch((x) => console.error('overdue mail', x.message));
  }
  await db.q('update mkt_leads set alerted_at = now() where id = any($1)', [rows.map((r) => r.id)]);
  return { sent: rows.length };
}

// ---------- property portals by email (99acres, MagicBricks, Housing.com) ----------
// Reads a lead email's text: the portal from the sender, then name, phone, email and the project asked about.
function parsePortal({ from = '', subject = '', text = '' }) {
  const f = String(from).toLowerCase(), all = `${subject}\n${text}`;
  const head = `${f} ${subject} ${String(text).slice(0, 3000)}`.toLowerCase();
  const leadish = /lead|enquir|inquir|interest|response|contact|callback|query/i.test(subject + ' ' + String(text).slice(0, 1500));
  const portal = /99acres/.test(f) || (leadish && /99acres/.test(head)) ? '99acres' : /magicbricks/.test(f) || (leadish && /magicbricks/.test(head)) ? 'magicbricks' : /housing\.com/.test(f) || (leadish && /housing\.com/.test(head)) ? 'housing' : null;
  if (!portal) return null;
  const grab = (re) => { const m = all.match(re); return m ? m[1].trim() : null; };
  const phone = phone10(grab(/(?:mobile|phone|contact(?: no\.?| number)?|ph)\s*(?:no\.?|number)?\s*[:\-]?\s*(\+?[\d\s-]{10,16})/i) || (all.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/) || [])[0]);
  const email = grab(/(?:e-?mail(?: id)?)\s*[:\-]\s*([^\s<>]+@[^\s<>]+\.[a-z]{2,})/i);
  const name = grab(/(?:^|\n)\s*(?:name|buyer name|contact name|customer name)\s*[:\-]\s*([^\n]{2,60})/i) || grab(/^(?:dear [^,\n]+,\s*)?([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}) (?:is interested|has shown interest|wants|enquired|responded)/m);
  const project = grab(/(?:project|property|for)\s*[:\-]\s*([^\n]{3,80})/i);
  const message = grab(/(?:message|query|requirement|comments?)\s*[:\-]\s*([^\n]{2,300})/i);
  if (!phone && !email) return null;
  return { portal, name, phone, email, project, message };
}
async function portalLead(msg) {
  const p = parsePortal(msg); if (!p) return null;
  const projects = await db.q('select id, name from projects where active');
  const words = (s) => String(s || '').toLowerCase().replace(/^dream\s+/, '').split(/\W+/).filter((w) => w.length > 3);
  const pj = projects.find((x) => words(x.name).some((w) => new RegExp('\\b' + w + '\\b', 'i').test(`${p.project || ''} ${msg.subject || ''} ${msg.text || ''}`))) || null;
  return add({ name: p.name, phone: p.phone, email: p.email, source: p.portal, projectId: pj && pj.id, note: [p.project && `Asked about: ${p.project}`, p.message].filter(Boolean).join(' · ') || null, ext: msg.id ? 'mail:' + String(msg.id).slice(0, 100) : null });
}

// ---------- a WhatsApp message from a new number ----------
async function whatsappIn({ phone, name, text, at }) {
  const p = phone10(phone); if (!p) return null;
  // not a buyer, not our staff, not a channel partner
  if (await db.one(`select 1 as x from users where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 union all
      select 1 from channel_partners where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 union all
      select 1 from buyers where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 limit 1`, [p])) return null;
  const projects = await db.q('select id, name from projects where active');
  const pj = projects.find((x) => String(x.name).toLowerCase().replace(/^dream\s+/, '').split(/\W+/).filter((w) => w.length > 3).some((w) => new RegExp('\\b' + w + '\\b', 'i').test(text || ''))) || null;
  return add({ phone: p, name, source: 'whatsapp', projectId: pj && pj.id, note: text ? 'WhatsApp: ' + String(text).slice(0, 400) : null, at });
}

// ---------- the lead's stage back to Meta (Conversions API for CRM) ----------
// Meta then looks for more people like those who came for a visit or booked, not just anyone who fills a form.
// Needs, in Vercel: META_DATASET_ID (Events Manager → the CRM dataset) and META_CAPI_TOKEN (its access token).
const capiOn = () => !!(process.env.META_DATASET_ID && process.env.META_CAPI_TOKEN);
const STAGE_EVENT = { contacted: 'Contacted', visit: 'Site visit', booked: 'Booked', lost: 'Lost' };
async function queueStage(id, status) {
  if (!STAGE_EVENT[status]) return;
  const l = await db.one("select ext_id from mkt_leads where id = $1", [id]);
  if (!l || !/^meta:\d+$/.test(l.ext_id || '')) return; // only leads from Meta lead forms carry Meta's lead id
  await db.q('insert into mkt_capi (lead_id, stage) values ($1, $2) on conflict (lead_id, stage) do nothing', [id, status]);
}
const sha = (x) => crypto.createHash('sha256').update(String(x).trim().toLowerCase()).digest('hex');
async function capi({ limit = 50 } = {}) {
  if (!capiOn()) return { skipped: 'META_DATASET_ID and META_CAPI_TOKEN are not set' };
  const q = await db.q(`select q.id, q.stage, q.created_at, l.ext_id, l.phone, l.email from mkt_capi q join mkt_leads l on l.id = q.lead_id where q.sent_at is null and q.tries < 5 order by q.id limit $1`, [limit]);
  if (!q.length) return { sent: 0 };
  const data = q.map((r) => ({ event_name: STAGE_EVENT[r.stage], event_time: Math.floor(Date.parse(r.created_at) / 1000), action_source: 'system_generated',
    user_data: { lead_id: Number(r.ext_id.slice(5)), ...(r.phone ? { ph: [sha('91' + r.phone)] } : {}), ...(r.email ? { em: [sha(r.email)] } : {}) },
    custom_data: { event_source: 'crm', lead_event_source: 'Dream India ERP' } }));
  const G = (process.env.META_GRAPH || 'https://graph.facebook.com/v23.0').replace(/\/+$/, '');
  const r = await fetch(`${G}/${encodeURIComponent(process.env.META_DATASET_ID)}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, access_token: process.env.META_CAPI_TOKEN, ...(process.env.META_CAPI_TEST ? { test_event_code: process.env.META_CAPI_TEST } : {}) }), signal: AbortSignal.timeout(20000) }).catch((x) => ({ ok: false, json: async () => ({ error: { message: x.message } }) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { await db.q('update mkt_capi set tries = tries + 1, error = $2 where id = any($1)', [q.map((x) => x.id), String((j.error && j.error.message) || r.status).slice(0, 300)]); return { error: (j.error && j.error.message) || r.status }; }
  await db.q('update mkt_capi set sent_at = now(), error = null where id = any($1)', [q.map((x) => x.id)]);
  return { sent: q.length };
}
async function capiStatus() {
  const s = await db.one("select count(*) filter (where sent_at is not null)::int as sent, count(*) filter (where sent_at is null and tries < 5)::int as waiting, max(sent_at) as last, (select error from mkt_capi where error is not null order by id desc limit 1) as error from mkt_capi");
  return { on: capiOn(), ...s };
}

module.exports = { add, route, greet, contact, statusChanged, overdue, parsePortal, portalLead, whatsappIn, queueStage, capi, capiStatus, capiOn, follow, SRCNAME };
