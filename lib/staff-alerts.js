// Messages to our own staff (not buyers):
//  1. Purchase approvals: every new purchase request goes to Management (Sameer, a partner) by email with a one-tap approval
//     link, and on WhatsApp once Click Connect is connected and the approval template is set. Sameer can also reply
//     on WhatsApp "APPROVE PR-0012" or "REJECT PR-0012 reason". A request still waiting after 24 hours gets a
//     "waiting 24h+" reminder to Management. Rafi Sir (Admin) is not sent site approvals: Sameer, a partner, approves.
//     Only if there is no Management login at all do approvals fall back to the Admin, so nothing waits unseen.
//  2. The 10 am summary to Admin and Management: only what needs attention, and the cash needed in the next 14 days.
// Until the ERP is live (ERP_LIVE=1) everything goes only to the test email and test mobile in Letter settings.
// Settings (key 'staff_alerts', from the Management dashboard → 10 am message): approvalTemplate, summaryTemplate
// (Click Connect template IDs), summaryOff.
const crypto = require('crypto');
const db = require('./db');
const mailer = require('./mailer');
const kv = require('./portal/kv');
const { FROM_ERP } = require('./portal/users-map');

const live = () => process.env.ERP_LIVE === '1';
const host = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const istToday = () => istNow().toISOString().slice(0, 10);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtD = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MN[+m - 1]} ${y}`; };
const q3 = (n) => (Math.round(+n * 1000) / 1000).toLocaleString('en-IN');
const cr = (v) => { const a = Math.abs(+v || 0); return a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${Math.round(a).toLocaleString('en-IN')}`; };
const digits10 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };

const DEFAULTS = { approvalTemplate: '', summaryTemplate: '', summaryOff: false };
async function settings() { const r = await db.one("select value from settings where key = 'staff_alerts'").catch(() => null); return { ...DEFAULTS, ...((r && r.value) || {}) }; }
async function saveSettings(v) {
  const cur = await settings();
  const out = { approvalTemplate: String(v.approvalTemplate ?? cur.approvalTemplate).trim().slice(0, 80), summaryTemplate: String(v.summaryTemplate ?? cur.summaryTemplate).trim().slice(0, 80), summaryOff: v.summaryOff == null ? cur.summaryOff : !!v.summaryOff };
  await db.q("insert into settings (key, value) values ('staff_alerts', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(out)]);
  return out;
}
const letterSet = async () => require('./letters').settings();

// ---------- people ----------
async function staff() {
  const rows = await db.q('select username, name, role, portal_role, phone, email, disabled from users where not disabled order by id');
  return rows.map((u) => ({ ...u, as: u.portal_role || FROM_ERP[u.role] || 'staff' }));
}
async function approvers() { const s = await staff(); const m = s.filter((u) => u.as === 'management'); return m.length ? m : s.filter((u) => u.as === 'admin'); }
async function admins() { return (await staff()).filter((u) => u.as === 'admin'); }
async function bosses() { return (await staff()).filter((u) => u.as === 'admin' || u.as === 'management'); }

// ---------- the signed approval link (72 hours; names the approver) ----------
async function key() {
  const r = await db.one("select value from settings where key = 'session_secret'");
  return String((r && r.value) || process.env.SESSION_SECRET || 'erp-approvals');
}
async function token(id, username, hours = 72) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const body = `${id}.${Buffer.from(username).toString('base64url')}.${exp}`;
  return `${body}.${crypto.createHmac('sha256', await key()).update('approve:' + body).digest('base64url').slice(0, 32)}`;
}
async function checkToken(t) {
  const [id, u, exp, sig] = String(t || '').split('.');
  if (!id || !u || !exp || !sig || !/^\d+$/.test(exp) || +exp < Date.now() / 1000) return null;
  const want = crypto.createHmac('sha256', await key()).update(`approve:${id}.${u}.${exp}`).digest('base64url').slice(0, 32);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return { id, user: Buffer.from(u, 'base64url').toString('utf8') };
}
const linkFor = async (o, username) => `${host()}/approve?t=${await token(o.id, username)}`;

// ---------- sending ----------
async function email({ to, subject, text, html }) {
  if (!mailer.configured()) return { sent: false, reason: 'Email is not set up yet.' };
  const set = await letterSet();
  const list = live() ? [...new Set(to.filter(Boolean))] : set.testEmail ? [String(set.testEmail).split(/[\/,;\s]+/)[0]] : [];
  if (!list.length) return { sent: false, reason: live() ? 'No email address on these logins (Manage users).' : 'Test version: set a test email in Letter settings.' };
  const conn = await mailer.connect();
  try { await conn.send({ to: list, subject: `${live() ? '' : '[TEST] '}${subject}`, text, html, fromName: 'Dream India ERP' }); } finally { await conn.close(); }
  return { sent: true, to: list };
}
async function whatsapp(people, template, paramsFor) {
  const wa = require('./whatsapp');
  if (!wa.configured()) return { sent: 0, reason: 'WhatsApp is not connected yet.' };
  if (!template) return { sent: 0, reason: 'No WhatsApp template set for this message yet.' };
  const set = await letterSet();
  const targets = live() ? people.filter((p) => digits10(p.phone)) : set.testMobile ? [{ ...people[0], phone: set.testMobile }] : [];
  if (!targets.length) return { sent: 0, reason: live() ? 'No mobile number on these logins.' : 'Test version: set a test mobile in Letter settings.' };
  let sent = 0; const errors = [];
  for (const p of targets) { try { await wa.sendStaff({ phone: p.phone, template, params: await paramsFor(p) }); sent++; } catch (e) { errors.push(e.message); } }
  return { sent, errors };
}

// ---------- purchase approvals ----------
function describe(o) {
  const its = require('./portal/purchase-api').itemsOf(o);
  const what = `${o.material} ${its.length > 1 ? its.map((i) => `${i.spec} ${q3(i.qty)}`).join(', ') + ` (total ${q3(o.qty)} ${o.unit})` : `${o.spec} · ${q3(o.qty)} ${o.unit}`}`;
  const where = `${o.building} · ${o.floor}${o.wing && o.wing !== '—' ? ' · ' + o.wing : ''}${o.element ? ' (' + o.element + ')' : ''}`;
  const b = o.budgetAtRequest || {};
  const budget = b.noBudget || b.budget == null ? 'No BOQ budget line for this item' : b.over ? `OVER BUDGET: ${q3(b.balance)} ${o.unit} left of ${q3(b.budget)} on this line, this takes it to ${q3(b.after)}` : `Within budget: ${q3(b.after)} ${o.unit} left on this line after this`;
  return { what, where, budget };
}
async function names() { const u = await kv.hgetall('users'); return Object.fromEntries(Object.values(u).map((x) => [x.username, x.name || x.username])); }

async function sendApproval(o, people, { reminder = false, escalation = false } = {}) {
  const set = await settings(), nm = await names(), d = describe(o);
  const by = nm[o.requestedBy] || o.requestedBy;
  const lead = escalation ? `${o.no} has been waiting for your approval for more than 24 hours. Site is waiting for this material.` : reminder ? `Reminder: ${o.no} is still waiting for your approval.` : `${by} has asked for material. It needs your approval before Purchase can order it.`;
  const out = { email: null, whatsapp: null };
  // one email per approver, each with their own link (the link approves as that person)
  const sends = [];
  for (const p of people) {
    const link = await linkFor(o, p.username);
    const text = `${lead}\n\n${o.no}: ${d.what}\nFor: ${d.where}\nRequested by: ${by}${o.neededBy ? '\nNeeded by: ' + fmtD(o.neededBy) : ''}${o.note ? '\nNote: ' + o.note : ''}\n${d.budget}\n\nApprove or reject (one tap): ${link}\n\nOr reply on WhatsApp: APPROVE ${o.no}  or  REJECT ${o.no} reason`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#140C59;max-width:560px"><p>${esc(lead)}</p>
      <table style="border-collapse:collapse;font-size:14px"><tr><td style="padding:3px 12px 3px 0;color:#666">Request</td><td><b>${esc(o.no)}</b>: ${esc(d.what)}</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#666">For</td><td>${esc(d.where)}</td></tr><tr><td style="padding:3px 12px 3px 0;color:#666">Requested by</td><td>${esc(by)}</td></tr>
      ${o.neededBy ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Needed by</td><td>${esc(fmtD(o.neededBy))}</td></tr>` : ''}${o.note ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Note</td><td>${esc(o.note)}</td></tr>` : ''}</table>
      <p style="padding:10px 12px;border-radius:8px;background:${/^OVER/.test(d.budget) ? '#FBE4E1;color:#B42318' : '#E2F4E8;color:#17663A'}">${esc(d.budget)}</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#140C59;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Approve or reject</a></p>
      <p style="color:#777;font-size:12px">The link works for 3 days and only for you. You can also reply on WhatsApp: APPROVE ${esc(o.no)} or REJECT ${esc(o.no)} with the reason.</p></div>`;
    sends.push(email({ to: [p.email], subject: `${escalation ? 'Waiting 24h+: ' : reminder ? 'Reminder: ' : ''}Approve ${o.no}: ${d.what}`, text, html }).catch((e) => ({ sent: false, reason: e.message })));
    if (!live()) break; // test version: one email to the test address is enough
  }
  out.email = await Promise.all(sends);
  out.whatsapp = await whatsapp(people, set.approvalTemplate, async (p) => [o.no, d.what, d.where, by, d.budget, await linkFor(o, p.username)]).catch((e) => ({ sent: 0, reason: e.message }));
  return out;
}
// Marks a field on the request without overwriting a change made in between (re-read, set, save).
async function mark(id, patch) {
  const KEY = require('./portal/purchase-api').KEY;
  const o = await kv.hget(KEY, id); if (!o) return;
  Object.assign(o, patch); await kv.hset(KEY, id, o);
}
async function notifyRequest(o) {
  const r = await sendApproval(o, await approvers());
  // DreamComm: the request in the Management group, with a one-tap Approve button for the approvers
  try {
    const d = describe(o), nm = await names();
    await require('./chat').system('dept:management', '', { title: `${o.no}: approve material`, tone: /^OVER/.test(d.budget) ? 'bad' : 'warn',
      lines: [d.what, `For ${d.where}`, `Requested by ${nm[o.requestedBy] || o.requestedBy}${o.neededBy ? ' · needed by ' + fmtD(o.neededBy) : ''}`, d.budget].concat(o.note ? [`Note: ${o.note}`] : []),
      act: { type: 'pr', id: o.id, label: 'Approve or reject' } });
  } catch (e) { console.error('chat approval', e.message); }
  await mark(o.id, { notifiedAt: new Date().toISOString(), notified: { email: (r.email || []).some((e) => e.sent), whatsapp: (r.whatsapp && r.whatsapp.sent) || 0 } });
  return r;
}
// Every 5 minutes: a request no one was told about yet, and requests waiting more than 24 hours (once each).
async function runApprovals(now = Date.now()) {
  const P = require('./portal/purchase-api');
  const orders = Object.values(await kv.hgetall(P.KEY)).filter(Boolean);
  const out = { notified: 0, escalated: 0 };
  for (const o of orders) {
    P.tidy(o);
    if (o.status !== 'pending_approval') continue;
    const age = now - Date.parse(o.requestedAt || 0);
    if (!o.notifiedAt && age > 2 * 60e3) { await notifyRequest(o).catch((e) => console.error('approval notice', e.message)); out.notified++; }
    else if (!o.escalatedAt && age > 24 * 3600e3) {
      await sendApproval(o, await approvers(), { escalation: true }).catch((e) => console.error('approval reminder', e.message));
      await mark(o.id, { escalatedAt: new Date(now).toISOString() });
      out.escalated++;
    }
  }
  return out;
}
// A WhatsApp message from an approver's own mobile: "APPROVE PR-0012", "approved 12", "REJECT PR-0012 rate too high".
// Returns null when the message is not an approval reply (it is then treated as an ordinary incoming message).
async function handleReply(from, text) {
  const m = String(text || '').trim().match(/^(approve[ds]?|ok|yes|reject(?:ed)?|no)\b[\s:,-]*(?:pr[\s-]*)?(\d{1,6})\b[\s:,.-]*(.*)$/i);
  if (!m) return null;
  const ph = digits10(from); if (!ph) return null;
  const who = (await staff()).find((u) => digits10(u.phone) === ph);
  if (!who) return null;
  const P = require('./portal/purchase-api');
  const no = `PR-${String(+m[2]).padStart(4, '0')}`;
  const o = Object.values(await kv.hgetall(P.KEY)).find((x) => x && x.no === no);
  const ok = /^(approve|ok|yes)/i.test(m[1]);
  let reply;
  if (!o) reply = `${no} was not found. Check the number and send it again.`;
  else {
    const r = await P.decideById(o.id, who.username, ok, m[3], 'by WhatsApp reply');
    reply = r.error ? `${no}: ${r.error}${!ok && /reason/i.test(r.error) ? ` Send: REJECT ${no} and the reason.` : ''}` : `${no} ${ok ? 'approved. Purchase can now order it.' : 'rejected. The site has been told.'}`;
  }
  await require('./whatsapp').sendStaff({ phone: from, text: reply }).catch((e) => console.error('approval reply', e.message));
  return { handled: true, reply };
}

// ---------- the 10 am summary ----------
async function buildSummary() {
  const mg = await require('./mgmt').build();
  const t = mg.today, D = mg.daily || { top: [], attention: [] };
  const P = require('./portal/purchase-api');
  const orders = Object.values(await kv.hgetall(P.KEY)).filter(Boolean);
  orders.forEach(P.tidy);
  // purchase requests over the BOQ budget, raised in the last 7 days or still waiting
  const week = Date.now() - 7 * 864e5;
  const over = orders.filter((o) => o.budgetAtRequest && o.budgetAtRequest.over && !['rejected', 'cancelled'].includes(o.status) && (o.status === 'pending_approval' || Date.parse(o.requestedAt) > week));
  const attention = D.attention.map((a) => a.text);
  for (const o of over) attention.push(`${o.no} is over the BOQ budget: ${o.material} ${o.spec} for ${o.building} ${o.floor} (${o.status === 'pending_approval' ? 'waiting for approval' : String(o.status).replace(/_/g, ' ')})`);
  // cash needed in the next 14 days: approved purchase bills, bills with Accounts, and the cheques we issued
  const toPay = orders.filter((o) => o.status === 'accounts_ok').reduce((a, o) => a + (+((o.accounts && o.accounts.payable) || (o.order && o.order.amount)) || 0), 0);
  const withAcc = orders.filter((o) => o.status === 'received').reduce((a, o) => a + (+(o.order && o.order.amount) || 0), 0);
  const end = new Date(Date.parse(t) + 14 * 864e5).toISOString().slice(0, 10);
  const pdc = await db.one("select count(*)::int as k, coalesce(sum(amount), 0) as amt from acc_pdc where book = 'signature' and due_date between $1 and $2", [t, end]).catch(() => ({ k: 0, amt: 0 }));
  const ra = Object.values(await kv.hgetall('wo:bills')).filter((b) => b && b.status === 'approved').reduce((a, b) => a + (+(b.totals && b.totals.net) || 0), 0);
  const cash = { toPay, withAcc, ra, pdc: +pdc.amt || 0, pdcK: pdc.k, total: toPay + withAcc + ra + (+pdc.amt || 0) };
  const top = D.top.filter((x) => ['cash', 'collections', 'overdue', 'site'].includes(x.key)).map((x) => `${x.title}: ${x.value}${x.sub ? ' (' + x.sub + ')' : ''}`);
  const day = `${WD[new Date(t + 'T00:00:00Z').getUTCDay()]} ${fmtD(t)}`;
  const link = `${host()}/#/mgmt`;
  const subject = `10 am summary, ${day}: ${attention.length ? attention.length + ' need' + (attention.length === 1 ? 's' : '') + ' attention' : 'all clear'}`;
  const cashLines = [`Approved purchase bills to pay: ${cr(cash.toPay)}`, `Approved contractor RA bills to pay: ${cr(cash.ra)}`, `Bills with Accounts (received at site): ${cr(cash.withAcc)}`, `Our cheques (PDCs) due: ${cash.pdcK} · ${cr(cash.pdc)}`];
  const text = `Good morning. ${mg.project ? mg.project.name + ', ' : ''}${day}.\n\nNEEDS ATTENTION (${attention.length})\n${attention.length ? attention.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'Nothing. All clear today.'}\n\nCASH NEEDED IN THE NEXT 14 DAYS: ${cr(cash.total)}\n${cashLines.map((l) => '- ' + l).join('\n')}\n\nTODAY\n${top.map((l) => '- ' + l).join('\n')}\n\nFull dashboard: ${link}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#140C59;max-width:620px"><p>Good morning. <b>${esc(mg.project ? mg.project.name : '')}</b>, ${esc(day)}.</p>
    <h3 style="margin:18px 0 6px;font-size:16px">Needs attention (${attention.length})</h3>${attention.length ? `<ol style="margin:0;padding-left:20px">${attention.map((a) => `<li style="margin-bottom:6px">${esc(a)}</li>`).join('')}</ol>` : '<p style="color:#17663A">Nothing. All clear today.</p>'}
    <h3 style="margin:18px 0 6px;font-size:16px">Cash needed in the next 14 days: ${esc(cr(cash.total))}</h3><ul style="margin:0;padding-left:20px;color:#333">${cashLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <h3 style="margin:18px 0 6px;font-size:16px">Today</h3><ul style="margin:0;padding-left:20px;color:#333">${top.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <p style="margin-top:18px"><a href="${esc(link)}" style="color:#140C59;font-weight:bold">Open the Management dashboard</a></p></div>`;
  // WhatsApp template values cannot contain line breaks
  const wa = [day, String(attention.length), attention.slice(0, 3).join(' | ').slice(0, 900) || 'All clear', cr(cash.total), link];
  return { today: t, subject, text, html, attention, cash, top, wa };
}
async function sendSummary({ trigger = 'schedule', force = false } = {}) {
  const set = await settings();
  if (set.summaryOff && !force) return { skipped: 'The 10 am message is switched off.' };
  const t = istToday(), mk = `summary:${t}`;
  if (!force && await db.one('select 1 as x from job_marks where key = $1', [mk])) return { skipped: 'Already sent today.' };
  const s = await buildSummary(), people = await bosses();
  const em = await email({ to: people.map((p) => p.email), subject: s.subject, text: s.text, html: s.html }).catch((e) => ({ sent: false, reason: e.message }));
  const wa = await whatsapp(people, set.summaryTemplate, async () => s.wa).catch((e) => ({ sent: 0, reason: e.message }));
  if (!force) await db.q('insert into job_marks (key, info) values ($1, $2) on conflict do nothing', [mk, JSON.stringify({ trigger, email: em, whatsapp: wa })]);
  return { email: em, whatsapp: wa, attention: s.attention.length };
}

// 6 pm: no daily progress report from site today → an email to the site team (Site Head, Engineers, Site Team).
async function dprReminder({ force = false } = {}) {
  const t = istToday(), mk = `dpr-reminder:${t}`;
  if (!force && await db.one('select 1 as x from job_marks where key = $1', [mk])) return { skipped: 'Already reminded today.' };
  if (await kv.hget('site:dpr', t)) return { skipped: "Today's report is in." };
  const site = (await staff()).filter((u) => ['site_head', 'site_engineer', 'site_team'].includes(u.as));
  const day = `${WD[new Date(t + 'T00:00:00Z').getUTCDay()]} ${fmtD(t)}`;
  const link = `${host()}/site`;
  const r = await email({ to: site.map((p) => p.email), subject: `Daily report for ${day} not sent yet`,
    text: `Today's daily progress report has not been sent yet.\n\nOpen Construction on your phone and tap Daily report: workers on site, work done and any problem. It takes two minutes.\n\n${link}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#140C59"><p>Today's daily progress report (${esc(day)}) has not been sent yet.</p><p>Open Construction on your phone and tap <b>Daily report</b>: workers on site, work done and any problem. It takes two minutes.</p><p><a href="${esc(link)}" style="display:inline-block;background:#140C59;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Open Construction</a></p></div>` }).catch((e) => ({ sent: false, reason: e.message }));
  if (!force) await db.q('insert into job_marks (key, info) values ($1, $2) on conflict do nothing', [mk, JSON.stringify(r)]);
  await require('./chat').system('dept:site', '', { title: `Daily report for ${day} not sent yet`, tone: 'warn', lines: ['Open Construction and tap Daily report: workers on site, work done and any problem. It takes two minutes.'], link: { label: 'Open Construction', href: '/site' } });
  return r;
}

module.exports = { dprReminder, email, settings, saveSettings, token, checkToken, notifyRequest, runApprovals, handleReply, buildSummary, sendSummary, describe, approvers, bosses };
