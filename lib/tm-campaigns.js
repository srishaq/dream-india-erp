// Telemarketing campaigns (6 Nov 2026): an SMS to every number partners uploaded for a project, and an AI voice call
// that introduces Dream India and the project and asks: press 1 if interested, press 2 if not. Press 1 puts the number
// at the top of the next call sheets for the telecallers; press 2 marks it not interested for that project.
//
// Who is contacted: only numbers a partner uploaded with the consent declaration (tm_uploads.consent), never anyone on
// the do-not-contact list, never an existing customer, and never the same number twice for the same kind of campaign
// in 30 days. Uploads from before the full declaration (6 Nov 2026) are left out unless the campaign includes them.
// A campaign is made by Telemarketing (tm.manage), approved by Syed Rafi Ishaq or Syed Sameer Ishaq, then started.
// It sends only between the hours in settings (10 am to 7 pm by default) and at most daily_cap a day; the 5-minute job
// sends the next batch (lib/tm-campaigns tick, from api/cron.js job=mail).
//
// Provider: Exotel (the same account as the IVR). Secrets in Vercel: EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN
// (optional EXOTEL_SUBDOMAIN). The rest is in Telemarketing → Settings: the SMS sender name (DLT header), the DLT entity
// ID, the 140-series caller number and the Exotel call flow (app) ID. Exotel calls back to /api/tm?hook=... with the
// secret hook key (settings.tm.hookKey).
const db = require('./db');
const TM = require('./tm');

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
const KINDS = { sms: 'SMS', call: 'AI call', agent: 'AI conversation' };
const DEFAULT_STATUSES = { sms: ['fresh', 'not_reachable', 'callback', 'interested'], call: ['fresh', 'not_reachable'], agent: ['fresh', 'not_reachable', 'ai_interested'] };
const ALLOWED_STATUSES = ['fresh', 'not_reachable', 'callback', 'interested', 'history', 'ai_interested'];
const TARGET = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', dnd: 'On DND (not sent by the operator)',
  calling: 'Calling', pressed1: 'Pressed 1: interested', pressed2: 'Pressed 2: not interested', no_input: 'Answered, pressed nothing', no_answer: 'No answer / busy', skipped: 'Skipped (now do-not-contact or booked)',
  visit_booked: 'Site visit booked by the AI', interested: 'Interested: telecaller to follow up', callback: 'Asked to be called back', not_interested: 'Not interested', dnc: 'Asked never to be called', talked: 'Talked, no clear answer' };
const FINAL = ['sent', 'delivered', 'failed', 'dnd', 'pressed1', 'pressed2', 'no_input', 'no_answer', 'skipped', 'visit_booked', 'interested', 'callback', 'not_interested', 'dnc', 'talked'];
const bolna = () => fake() || !!process.env.BOLNA_API_KEY;

const fake = () => process.env.TM_FAKE_PROVIDER === '1' && process.env.VERCEL !== '1'; // tests only
const exotel = () => fake() || !!(process.env.EXOTEL_SID && process.env.EXOTEL_API_KEY && process.env.EXOTEL_API_TOKEN);
const base = () => (process.env.EXOTEL_API || `https://${process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'}`).replace(/\/+$/, '');
const site = () => process.env.ERP_URL || 'https://erp.dreamindiarealty.com';
const istHour = () => new Date(Date.now() + 330 * 60000).getUTCHours();

async function conf() {
  const S = await TM.settings(), c = S.campaigns || {};
  return { smsSender: c.smsSender || '', dltEntityId: c.dltEntityId || '', callerId: c.callerId || '', callAppId: c.callAppId || '',
    fromHour: Number.isInteger(c.fromHour) ? c.fromHour : 10, toHour: Number.isInteger(c.toHour) ? c.toHour : 19, hookKey: S.hookKey || '',
    agentId: c.agentId || '', agentFrom: c.agentFrom || '' };
}
// What is still missing before a kind of campaign can send.
async function readiness() {
  const c = await conf(), miss = { sms: [], call: [], agent: [] };
  if (!bolna()) miss.agent.push('the Bolna key in Vercel (BOLNA_API_KEY)');
  if (!c.agentId) miss.agent.push('the Bolna agent ID (the AI caller set up in Bolna with Exotel)');
  if (!exotel()) { miss.sms.push('Exotel keys in Vercel (EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN)'); miss.call.push('Exotel keys in Vercel (EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN)'); }
  if (!c.smsSender) miss.sms.push('the SMS sender name (DLT header, e.g. DREAMI)');
  if (!c.dltEntityId) miss.sms.push('the DLT entity ID of Dream India Realty');
  if (!c.callerId) miss.call.push('the 140-series number calls go out from (declared to the telecom operator)');
  if (!c.callAppId) miss.call.push('the Exotel call flow (app) ID with the greeting and the press 1 / press 2 step');
  if (!c.hookKey) for (const k of ['sms', 'call', 'agent']) miss[k].push('the hook key (save Settings once)');
  return { sms: miss.sms, call: miss.call, agent: miss.agent, conf: c, hooks: c.hookKey ? { agent: `${site()}/api/tm?hook=agent&k=${c.hookKey}`,
    sms: `${site()}/api/tm?hook=sms&k=${c.hookKey}`, call: `${site()}/api/tm?hook=call&k=${c.hookKey}`,
    digits: `${site()}/api/tm?hook=digits&k=${c.hookKey}`, say: `${site()}/api/tm?hook=say&k=${c.hookKey}` } : null };
}

// ---------- who would be contacted ----------
function filtersOf(kind, f = {}) {
  const st = (Array.isArray(f.statuses) ? f.statuses : DEFAULT_STATUSES[kind]).filter((x) => ALLOWED_STATUSES.includes(x));
  return { statuses: st.length ? st : DEFAULT_STATUSES[kind], cpIds: (Array.isArray(f.cpIds) ? f.cpIds : []).map(Number).filter(Boolean), includeLegacy: !!f.includeLegacy };
}
async function eligibleRows(q, projectId, kind, f) {
  return q(`select distinct on (l.mobile) l.id, l.mobile from tm_leads l join tm_uploads u on u.id = l.upload_id
    where l.tm_project_id = $1 and l.source = 'partner' and u.consent is not null and ($4 or not (u.consent ? 'legacy'))
      and l.status = any($2::text[]) and (cardinality($3::int[]) = 0 or l.cp_id = any($3::int[]))
      and not exists (select 1 from tm_dnc d where d.mobile = l.mobile)
      and not exists (select 1 from tm_leads b where b.mobile = l.mobile and b.status = 'booked')
      and not exists (select 1 from tm_campaign_targets t join tm_campaigns c on c.id = t.campaign_id
                       where t.mobile = l.mobile and c.kind = $5 and c.status <> 'cancelled' and t.updated_at > now() - interval '30 days')
    order by l.mobile, l.id`, [projectId, f.statuses, f.cpIds, f.includeLegacy, kind]);
}
async function preview({ projectId, kind, filters }) {
  if (!KINDS[kind]) throw err(400, 'Choose SMS or AI call.');
  const f = filtersOf(kind, filters);
  const rows = await eligibleRows(db.q, projectId, kind, f);
  const customers = await TM.customerMobiles();
  const ok = rows.filter((r) => !customers.has(r.mobile));
  const all = await db.one(`select count(distinct l.mobile)::int as n, count(distinct l.mobile) filter (where u.consent ? 'legacy')::int as legacy,
      count(distinct l.mobile) filter (where l.upload_id is null)::int as nodecl from tm_leads l left join tm_uploads u on u.id = l.upload_id where l.tm_project_id = $1 and l.source = 'partner'`, [projectId]);
  return { count: ok.length, customersLeftOut: rows.length - ok.length, partnerNumbers: all.n, legacy: all.legacy, noDeclaration: all.nodecl, filters: f };
}

// ---------- make, approve, start ----------
async function save(user, b) {
  const kind = b.kind, pid = parseInt(b.projectId, 10);
  if (!KINDS[kind]) throw err(400, 'Choose SMS or AI call.');
  const p = await db.one('select id, name, history from tm_projects where id = $1', [pid]);
  if (!p || p.history) throw err(400, 'Choose the project.');
  const name = clean(b.name, 100) || `${KINDS[kind]} · ${p.name}`;
  const message = kind === 'sms' ? clean(b.message, 1000) : null, template = kind === 'sms' ? clean(b.templateId, 40) : null, script = kind !== 'sms' ? clean(b.script, 3000) : null;
  if (kind === 'sms' && !message) throw err(400, 'Write the SMS. It must be word for word the template approved on DLT.');
  if (kind === 'sms' && message.length > 480) throw err(400, 'Keep the SMS under 480 characters (3 SMS).');
  if (kind === 'call' && !script) throw err(400, 'Write what the AI voice says, ending with: press 1 if interested, press 2 if not.');
  if (kind === 'agent' && !script) throw err(400, 'Write the briefing for the AI caller: what to say about the project and what to find out.');
  const cap = Math.min(Math.max(parseInt(b.dailyCap, 10) || 500, 50), 20000);
  const f = filtersOf(kind, b.filters);
  if (b.id) {
    const cur = await db.one('select * from tm_campaigns where id = $1', [b.id]);
    if (!cur) throw err(404, 'Campaign not found.');
    if (cur.status !== 'draft') throw err(409, 'Only a draft can be changed. Approved campaigns are fixed; make a new one.');
    await db.q('update tm_campaigns set tm_project_id = $2, kind = $3, name = $4, message = $5, template_id = $6, script = $7, filters = $8, daily_cap = $9 where id = $1', [b.id, pid, kind, name, message, template, script, f, cap]);
    return { id: b.id };
  }
  const r = await db.one('insert into tm_campaigns (tm_project_id, kind, name, message, template_id, script, filters, daily_cap, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id', [pid, kind, name, message, template, script, f, cap, user.id]);
  return { id: r.id };
}

// Approval freezes the list: the numbers that qualify now are the ones it will go to.
async function approve(user, id) {
  const ch = require('./changes');
  if (!ch.isApprover(user)) throw err(403, 'Campaigns are approved by Syed Rafi Ishaq or Syed Sameer Ishaq.');
  const customers = await TM.customerMobiles();
  return db.tx(async (t) => {
    const c = await t.one('select * from tm_campaigns where id = $1 for update', [id]);
    if (!c) throw err(404, 'Campaign not found.');
    if (c.status !== 'draft') throw err(409, `Already ${c.status}.`);
    const rows = (await eligibleRows(t.q, c.tm_project_id, c.kind, filtersOf(c.kind, c.filters))).filter((r) => !customers.has(r.mobile));
    if (!rows.length) throw err(400, 'No number qualifies for this campaign now.');
    for (let i = 0; i < rows.length; i += 2000) {
      const part = rows.slice(i, i + 2000);
      await t.q('insert into tm_campaign_targets (campaign_id, lead_id, mobile) select $1, l, m from unnest($2::bigint[], $3::text[]) as u(l, m) on conflict do nothing', [id, part.map((r) => r.id), part.map((r) => r.mobile)]);
    }
    await t.q("update tm_campaigns set status = 'approved', approved_by = $2, approved_at = now(), targets = $3 where id = $1", [id, user.id, rows.length]);
    return { ok: true, targets: rows.length };
  });
}

async function setStatus(user, id, action) {
  const c = await db.one('select * from tm_campaigns where id = $1', [id]);
  if (!c) throw err(404, 'Campaign not found.');
  if (action === 'start') {
    if (!['approved', 'paused'].includes(c.status)) throw err(409, c.status === 'draft' ? 'The campaign must be approved first.' : `It is ${c.status}.`);
    const R = await readiness(); if (R[c.kind].length) throw err(409, `Not ready to send yet: ${R[c.kind].join('; ')}. See Settings.`);
    if (c.kind === 'sms' && !c.template_id) throw err(409, 'Add the DLT template ID of this SMS before starting.');
    await db.q("update tm_campaigns set status = 'running', started_at = coalesce(started_at, now()) where id = $1", [id]);
  } else if (action === 'pause') {
    if (c.status !== 'running') throw err(409, 'Only a running campaign can be paused.');
    await db.q("update tm_campaigns set status = 'paused' where id = $1", [id]);
  } else if (action === 'cancel') {
    if (['done', 'cancelled'].includes(c.status)) throw err(409, `Already ${c.status}.`);
    await db.q("update tm_campaigns set status = 'cancelled', finished_at = now() where id = $1", [id]);
    await db.q("delete from tm_campaign_targets where campaign_id = $1 and status = 'queued'", [id]);
  } else throw err(400, 'Unknown action.');
  return { ok: true };
}

// ---------- sending (Exotel) ----------
async function exo(path, form) {
  if (fake()) return { fake: true, Sid: 'fake-' + Math.random().toString(36).slice(2, 12) };
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v != null && v !== '') body.append(k, String(v));
  const r = await fetch(`${base()}/v1/Accounts/${process.env.EXOTEL_SID}${path}`, { method: 'POST', body, signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Basic ' + Buffer.from(`${String(process.env.EXOTEL_API_KEY).trim()}:${String(process.env.EXOTEL_API_TOKEN).trim()}`).toString('base64'), Accept: 'application/json' } });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  if (!r.ok) { const e = j.RestException || {}; throw Object.assign(new Error(`Exotel ${r.status}: ${e.Message || text.replace(/<[^>]+>/g, ' ').trim().slice(0, 160)}`), { status: r.status }); }
  const o = j.SMSMessage || j.Call || {};
  return { Sid: o.Sid, Status: o.Status };
}
async function sendSms(c, cf, mobile) {
  return exo('/Sms/send.json', { From: cf.smsSender, To: '0' + mobile, Body: c.message, DltEntityId: cf.dltEntityId, DltTemplateId: c.template_id, SmsType: 'promotional',
    StatusCallback: `${site()}/api/tm?hook=sms&k=${cf.hookKey}` });
}
async function placeCall(c, cf, mobile, tag) {
  return exo('/Calls/connect.json', { From: '0' + mobile, CallerId: cf.callerId, Url: `http://my.exotel.com/${process.env.EXOTEL_SID || 'test'}/exoml/start_voice/${cf.callAppId}`,
    CallType: 'promo', TimeLimit: 120, TimeOut: 30, CustomField: tag, StatusCallback: `${site()}/api/tm?hook=call&k=${cf.hookKey}`, 'StatusCallbackEvents[0]': 'terminal' });
}

// A conversation call through Bolna (an AI voice agent set up in Bolna, calling through our Exotel number). The
// project, the person's name and the briefing go in as the agent's variables; Bolna sends the transcript back to hook=agent.
async function agentCall(c, cf, mobile, tag, extra = {}) {
  if (fake()) return { Sid: 'fake-exec-' + Math.random().toString(36).slice(2, 10) };
  const p = await db.one('select name, location, rera_no from tm_projects where id = $1', [c.tm_project_id]);
  const r = await fetch((process.env.BOLNA_API || 'https://api.bolna.ai') + '/call', { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + String(process.env.BOLNA_API_KEY).trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: cf.agentId, recipient_phone_number: '+91' + mobile, ...(cf.agentFrom ? { from_phone_number: cf.agentFrom } : {}),
      user_data: { target: tag, name: extra.name || '', project: (p && p.name) || '', location: (p && p.location) || '', rera: (p && p.rera_no) || '', briefing: c.script || '', timezone: 'Asia/Kolkata' } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Bolna ${r.status}: ${clean(j.message || j.error || j.detail || '', 160)}`), { status: r.status });
  return { Sid: j.execution_id || j.id };
}

// One message or call to a staff phone, to check the SMS text or how the call sounds. Not counted in the campaign.
async function test(user, id, mobileIn) {
  const c = await db.one('select * from tm_campaigns where id = $1', [id]); if (!c) throw err(404, 'Campaign not found.');
  const m = TM.mobile(mobileIn); if (!m) throw err(400, 'Type a 10-digit mobile number.');
  const R = await readiness(); if (R[c.kind].length) throw err(409, `Not ready to send yet: ${R[c.kind].join('; ')}.`);
  if (c.kind === 'sms') { if (!c.template_id) throw err(409, 'Add the DLT template ID first.'); const r = await sendSms(c, R.conf, m); return { ok: true, id: r.Sid }; }
  if (c.kind === 'agent') { const r = await agentCall(c, R.conf, m, `test:${c.id}`, { name: user.name }); return { ok: true, id: r.Sid }; }
  const r = await placeCall(c, R.conf, m, `test:${c.id}`); return { ok: true, id: r.Sid };
}

// The 5-minute job: the next batch of every running campaign, within the hours and the daily cap.
async function tick({ now = new Date() } = {}) {
  const cf = await conf(), h = new Date(now.getTime() + 330 * 60000).getUTCHours();
  const running = await db.q("select * from tm_campaigns where status = 'running' order by id");
  if (!running.length) return { running: 0 };
  if (h < cf.fromHour || h >= cf.toHour) return { running: running.length, waiting: `outside ${cf.fromHour}:00–${cf.toHour}:00` };
  const today = TM.istToday(), out = {};
  for (const c of running) {
    const sentToday = (await db.one('select count(*)::int as n from tm_campaign_targets where campaign_id = $1 and sent_on = $2::date', [c.id, today])).n;
    const room = Math.min(c.kind === 'sms' ? 150 : c.kind === 'agent' ? 20 : 40, c.daily_cap - sentToday); // per 5 minutes: 150 SMS, 40 recorded calls or 20 conversations
    if (room <= 0) { out[c.id] = 'daily cap reached'; continue; }
    const batch = await db.q(`update tm_campaign_targets set status = 'sending', updated_at = now() where id in (
        select id from tm_campaign_targets where campaign_id = $1 and status = 'queued' order by id limit $2 for update skip locked) returning id, mobile, lead_id, (select name from tm_leads where id = lead_id) as name`, [c.id, room]);
    if (!batch.length) {
      const left = (await db.one("select count(*)::int as n from tm_campaign_targets where campaign_id = $1 and status in ('queued', 'sending')", [c.id])).n;
      if (!left) await db.q("update tm_campaigns set status = 'done', finished_at = now() where id = $1", [c.id]);
      out[c.id] = 'finished'; continue;
    }
    const dnc = new Set((await db.q('select mobile from tm_dnc where mobile = any($1::text[])', [batch.map((x) => x.mobile)])).map((x) => x.mobile));
    let sent = 0, failed = 0, stop = false;
    for (let i = 0; i < batch.length && !stop; i += 10) {
      await Promise.all(batch.slice(i, i + 10).map(async (x) => {
        if (dnc.has(x.mobile)) return db.q("update tm_campaign_targets set status = 'skipped', updated_at = now() where id = $1", [x.id]);
        try {
          const r = c.kind === 'sms' ? await sendSms(c, cf, x.mobile) : c.kind === 'agent' ? await agentCall(c, cf, x.mobile, `t:${x.id}`, { name: x.name }) : await placeCall(c, cf, x.mobile, `t:${x.id}`);
          await db.q("update tm_campaign_targets set status = $2, provider_id = $3, sent_on = $4::date, updated_at = now() where id = $1", [x.id, c.kind === 'sms' ? 'sent' : 'calling', r.Sid || null, today]);
          sent++;
        } catch (e) {
          await db.q("update tm_campaign_targets set status = 'failed', detail = $2, sent_on = $3::date, updated_at = now() where id = $1", [x.id, String(e.message).slice(0, 200), today]);
          failed++;
          if (e.status === 401 || e.status === 403) throw e; // wrong keys: stop, do not burn the list
        }
      })).catch(async (e) => { stop = true; await db.q("update tm_campaigns set status = 'paused', note = $2 where id = $1", [c.id, 'Paused by itself: ' + e.message]); await db.q("update tm_campaign_targets set status = 'queued' where campaign_id = $1 and status = 'sending'", [c.id]); });
    }
    out[c.id] = { sent, failed };
  }
  return out;
}

// ---------- what Exotel tells us back ----------
async function hook(kind, q) {
  const cf = await conf();
  if (!cf.hookKey || q.k !== cf.hookKey) throw err(403, 'Wrong key.');
  if (kind === 'say') { // the words of the call, for Exotel's greeting (text to speech)
    const t = String(q.CustomField || '').match(/^t:(\d+)$/), tt = String(q.CustomField || '').match(/^test:(\d+)$/);
    const row = t ? await db.one('select c.script from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.id = $1', [t[1]])
      : tt ? await db.one('select script from tm_campaigns where id = $1', [tt[1]])
      : await db.one('select c.script from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.provider_id = $1', [String(q.CallSid || '')]);
    return { text: (row && row.script) || 'Thank you for your time. Goodbye.' };
  }
  if (kind === 'sms') {
    const st = String(q.Status || '').toLowerCase(), sid = String(q.SmsSid || q.Sid || '');
    const map = st === 'failed-dnd' ? 'dnd' : st === 'delivered' ? 'delivered' : st.startsWith('fail') ? 'failed' : st === 'sent' ? 'sent' : null;
    if (sid && map) await db.q('update tm_campaign_targets set status = $2, detail = $3, updated_at = now() where provider_id = $1', [sid, map, clean(q.DetailedStatus || st, 120)]);
    return { ok: true };
  }
  const target = async () => {
    const t = String(q.CustomField || '').match(/^t:(\d+)$/);
    return t ? db.one('select x.*, c.tm_project_id from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.id = $1', [t[1]])
      : db.one('select x.*, c.tm_project_id from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.provider_id = $1', [String(q.CallSid || '')]);
  };
  if (kind === 'digits') {
    const d = String(q.digits || q.Digits || '').replace(/\D/g, '').slice(0, 1), x = await target();
    if (!x) return { ok: true };
    if (d === '1') {
      await db.q("update tm_campaign_targets set status = 'pressed1', digits = '1', updated_at = now() where id = $1", [x.id]);
      // to the top of the telecallers' next sheets (unless a caller already has it further along)
      await db.q(`update tm_leads set status = 'ai_interested', next_call_on = $2::date, remarks = concat_ws(' | ', remarks, $3::text)
        where id = $1 and status not in ('interested', 'visit', 'booked', 'dnc')`, [x.lead_id, TM.istToday(), `${TM.istToday()}: pressed 1 on the AI call`]);
    } else if (d === '2') {
      await db.q("update tm_campaign_targets set status = 'pressed2', digits = '2', updated_at = now() where id = $1", [x.id]);
      await db.q(`update tm_leads set status = 'not_interested', remarks = concat_ws(' | ', remarks, $2::text) where id = $1 and status not in ('interested', 'visit', 'booked')`, [x.lead_id, `${TM.istToday()}: pressed 2 on the AI call`]);
    } else await db.q("update tm_campaign_targets set digits = $2, updated_at = now() where id = $1", [x.id, d || null]);
    return { ok: true };
  }
  if (kind === 'agent') return agentResult(q);
  if (kind === 'call') {
    const x = await target(); if (!x) return { ok: true };
    if (['pressed1', 'pressed2'].includes(x.status)) return { ok: true };
    const st = String(q.Status || q.CallStatus || '').toLowerCase();
    const map = st === 'completed' ? 'no_input' : ['busy', 'no-answer', 'canceled'].includes(st) ? 'no_answer' : st === 'failed' ? 'failed' : null;
    if (map) await db.q('update tm_campaign_targets set status = $2, provider_id = coalesce(provider_id, $3), detail = $4, updated_at = now() where id = $1', [x.id, map, String(q.CallSid || '') || null, clean(st, 60)]);
    return { ok: true };
  }
  throw err(400, 'Unknown hook.');
}

// ---------- what the AI caller found out (Bolna's post-call data) ----------
// The transcript is read by Claude into one outcome: site visit booked (day, time), interested, call back, not interested,
// never call again, no answer. The lead then goes to the telecallers (top of the next sheet) or out of the list.
const DONE = ['completed', 'call-disconnected', 'no-answer', 'busy', 'failed', 'canceled', 'cancelled', 'error', 'balance-low', 'stopped'];
async function classify(transcript, summary) {
  if (fake() && process.env.AGENT_FAKE_RESULT) return JSON.parse(process.env.AGENT_FAKE_RESULT);
  if (!process.env.ANTHROPIC_API_KEY) return { outcome: 'talked', summary: clean(summary || transcript, 300) };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 500, messages: [{ role: 'user', content: `A Dream India Realty AI caller spoke to a person about a real estate project. Read the call and answer with ONE JSON object only:
{"outcome": one of "visit_booked" (agreed a site visit day), "interested", "callback" (asked to be called later), "not_interested", "dnc" (asked never to be called again), "no_answer" (no real conversation, voicemail or wrong person), "talked" (talked but no clear answer),
 "visit_date": "YYYY-MM-DD or empty", "visit_time": "e.g. 11:00 or empty", "callback_date": "YYYY-MM-DD or empty", "home": "what they want, or empty", "budget": "", "timeline": "", "summary": "one short English sentence for the telecaller"}
Today is ${istToday()} (Asia/Kolkata). Summary from the call system: ${clean(summary, 600)}
Transcript:
${String(transcript || '').slice(0, 12000)}` }] }) });
  const j = await r.json().catch(() => ({}));
  const s = (j.content || []).map((c) => c.text || '').join(''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return { outcome: 'talked', summary: clean(summary, 300) }; }
}
const istToday = () => TM.istToday();
async function agentResult(q) {
  const id = String(q.id || q.execution_id || ''), st = String(q.status || '').toLowerCase();
  const tag = String((q.context_details && q.context_details.recipient_data && q.context_details.recipient_data.target) || (q.user_data && q.user_data.target) || '');
  const t = tag.match(/^t:(\d+)$/);
  const x = t ? await db.one('select x.*, c.tm_project_id from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.id = $1', [t[1]])
    : id ? await db.one('select x.*, c.tm_project_id from tm_campaign_targets x join tm_campaigns c on c.id = x.campaign_id where x.provider_id = $1', [id]) : null;
  if (!x) return { ok: true, ignored: true };
  if (!DONE.includes(st)) return { ok: true, waiting: st };
  if (FINAL.includes(x.status) && x.result) return { ok: true, already: true };
  const tr = typeof q.transcript === 'string' ? q.transcript : JSON.stringify(q.transcript || '');
  const talked = tr.replace(/\s+/g, '').length > 40 && !['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(st);
  const R = talked ? await classify(tr, q.summary) : { outcome: st === 'failed' || st === 'error' ? 'failed' : 'no_answer' };
  const outcome = ['visit_booked', 'interested', 'callback', 'not_interested', 'dnc', 'no_answer', 'talked', 'failed'].includes(R.outcome) ? R.outcome : 'talked';
  const result = { ...R, outcome, duration: q.conversation_duration || (q.telephony_data && q.telephony_data.duration) || null, recording: (q.telephony_data && q.telephony_data.recording_url) || null, transcript: tr.slice(0, 20000) };
  await db.q('update tm_campaign_targets set status = $2, result = $3, provider_id = coalesce(provider_id, $4), detail = $5, updated_at = now() where id = $1', [x.id, outcome, result, id || null, clean(R.summary || st, 200)]);
  const note = `${istToday()}: AI call: ${clean(R.summary || outcome, 220)}${R.visit_date ? ` · SITE VISIT ${R.visit_date}${R.visit_time ? ' ' + R.visit_time : ''}` : ''}`;
  if (['visit_booked', 'interested', 'callback'].includes(outcome)) {
    const next = outcome === 'callback' && /^\d{4}-\d{2}-\d{2}$/.test(R.callback_date || '') ? R.callback_date : istToday();
    await db.q(`update tm_leads set status = 'ai_interested', next_call_on = $2::date, remarks = concat_ws(' | ', remarks, $3::text) where id = $1 and status not in ('interested', 'visit', 'booked', 'dnc')`, [x.lead_id, next, note]);
  } else if (outcome === 'not_interested') {
    await db.q(`update tm_leads set status = 'not_interested', remarks = concat_ws(' | ', remarks, $2::text) where id = $1 and status not in ('interested', 'visit', 'booked')`, [x.lead_id, note]);
  } else if (outcome === 'dnc') {
    await db.q("insert into tm_dnc (mobile, reason) values ($1, 'Asked the AI caller never to be called') on conflict do nothing", [x.mobile]);
    await db.q(`update tm_leads set status = 'dnc', remarks = concat_ws(' | ', remarks, $2::text) where mobile = $1 and status <> 'booked'`, [x.mobile, note]);
  } else await db.q(`update tm_leads set remarks = concat_ws(' | ', remarks, $2::text) where id = $1`, [x.lead_id, note]);
  return { ok: true, outcome };
}

// ---------- lists ----------
async function list(projectId) {
  const rows = await db.q(`select c.*, p.name as project, cu.name as created_by_name, au.name as approved_by_name,
      (select json_object_agg(status, n) from (select status, count(*)::int as n from tm_campaign_targets t where t.campaign_id = c.id group by status) s) as by_status
    from tm_campaigns c join tm_projects p on p.id = c.tm_project_id left join users cu on cu.id = c.created_by left join users au on au.id = c.approved_by
    where ($1::int is null or c.tm_project_id = $1) order by c.id desc limit 200`, [parseInt(projectId, 10) || null]);
  return rows;
}
async function detail(id, full) {
  const c = (await db.q(`select c.*, p.name as project from tm_campaigns c join tm_projects p on p.id = c.tm_project_id where c.id = $1`, [id]))[0];
  if (!c) throw err(404, 'Campaign not found.');
  const by = await db.q('select status, count(*)::int as n from tm_campaign_targets where campaign_id = $1 group by status', [id]);
  const days = await db.q(`select sent_on, count(*)::int as n, count(*) filter (where status = 'pressed1')::int as p1, count(*) filter (where status = 'pressed2')::int as p2,
      count(*) filter (where status in ('failed', 'dnd'))::int as bad from tm_campaign_targets where campaign_id = $1 and sent_on is not null group by 1 order by 1 desc`, [id]);
  const pressed = await db.q(`select x.mobile, x.updated_at, x.status as outcome, x.result->>'summary' as summary, x.result->>'visit_date' as visit_date, x.result->>'visit_time' as visit_time, x.result->>'recording' as recording,
      l.name, l.status, f.name as partner from tm_campaign_targets x join tm_leads l on l.id = x.lead_id
      left join channel_partners f on f.id = l.cp_id where x.campaign_id = $1 and x.status in ('pressed1', 'visit_booked', 'interested', 'callback') order by (x.status = 'visit_booked') desc, x.updated_at desc limit 500`, [id]);
  return { campaign: c, byStatus: Object.fromEntries(by.map((r) => [r.status, r.n])), days: days.map((d) => ({ ...d, sent_on: TM.iso(d.sent_on) })),
    pressed: pressed.map((p) => ({ ...p, mobile: full ? p.mobile : TM.mask(p.mobile), status: TM.STATUS[p.status] || p.status, outcome: TARGET[p.outcome] || p.outcome })) };
}

module.exports = { KINDS, TARGET, FINAL, DEFAULT_STATUSES, ALLOWED_STATUSES, conf, readiness, preview, save, approve, setStatus, test, tick, hook, list, detail, istHour };
