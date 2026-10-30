// WhatsApp Business, through Click Connect (Click Connect Media, our WhatsApp provider) or Meta's Cloud API directly.
// Click Connect (used when CCM_API_KEY is set in Vercel):
//   CCM_API_KEY   the API key from the Click Connect panel (typed into Vercel by the Admin, never into the ERP)
//   CCM_SENDER    the business WhatsApp number, e.g. 9198XXXXXXXX
//   Templates are sent by their Click Connect template ID (Letter settings), with the {{1}}, {{2}}… values.
//   Webhook (Click Connect → ERP): set from Set-up → Inbox ("Connect the WhatsApp webhook"); the address carries
//   a secret key worked out from the API key, because Click Connect does not sign its calls.
// Meta directly (only when CCM_API_KEY is not set): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.
// A free-text message can be sent only within 24 hours of the buyer's last message; outside that window WhatsApp
// allows only an approved template.
const crypto = require('crypto');
const db = require('./db');
const comms = require('./comms');

const API = () => process.env.WHATSAPP_API || 'https://graph.facebook.com/v21.0';
// Click Connect's API host: the one in their Dream India API sheet first, then the one in their general documentation.
const CCM_HOSTS = () => (process.env.CCM_API ? [process.env.CCM_API] : ['https://api.clickconnectmedia.in', 'https://app.clickconnectmedia.in']).map((h) => h.replace(/\/+$/, ''));
let ccmHost = null; // the host that last answered
const ccm = () => !!(process.env.CCM_API_KEY && process.env.CCM_SENDER);
const meta = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const configured = () => ccm() || meta();
const provider = () => (ccm() ? 'Click Connect' : meta() ? 'Meta' : null);
const err = (status, message) => Object.assign(new Error(message), { status });
const to91 = (p) => { const d = comms.mobile(p); return d ? '91' + d : null; };
const host = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');

// Secrets worked out from the Click Connect API key: the webhook key, and links to a letter PDF that WhatsApp fetches.
const hmac = (what) => crypto.createHmac('sha256', String(process.env.CCM_API_KEY || process.env.WHATSAPP_APP_SECRET || '')).update(what).digest('hex');
const hookKey = () => hmac('erp-whatsapp-webhook').slice(0, 32);
const hookUrl = () => `${host()}/api/whatsapp?k=${hookKey()}`;
function fileLink(kind, id, days = 7) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  return `${host()}/api/letters?wa=${kind}.${id}.${exp}.${hmac(`erp-file:${kind}:${id}:${exp}`).slice(0, 32)}`;
}
function checkLink(tok) {
  const [kind, id, exp, sig] = String(tok || '').split('.');
  if (!kind || !id || !exp || !sig || +exp < Date.now() / 1000) return null;
  const want = hmac(`erp-file:${kind}:${id}:${exp}`).slice(0, 32);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? { kind, id: +id } : null;
}

async function ccmCall(path, body, method = 'POST') {
  const hosts = CCM_HOSTS(); if (ccmHost && hosts.includes(ccmHost)) hosts.unshift(...hosts.splice(hosts.indexOf(ccmHost), 1));
  let last = null;
  for (const host of hosts) {
    const url = `${host}/${path.replace(/^\//, '')}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(process.env.CCM_API_KEY)}`;
    let r, j;
    try { r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { last = err(502, `WhatsApp (Click Connect): could not reach ${host.replace(/^https:\/\//, '')}`); continue; } // nothing was sent: try the other host
    j = await r.json().catch(() => null);
    if (!j && (r.status === 404 || r.status === 405 || r.status >= 500 || r.ok)) { last = err(502, `WhatsApp (Click Connect): error ${r.status}`); continue; } // not the API: try the other host
    j = j || {};
    if (!r.ok || j.success === false) {
      const e = (j.errors && j.errors[0]) || {};
      throw err(502, `WhatsApp (Click Connect): ${e.message || e.codeMsg || j.message || 'error ' + r.status}`);
    }
    ccmHost = host;
    return j;
  }
  throw last;
}
// Click Connect: point its webhook at the ERP (Admin presses the button once the key is in Vercel).
async function connectWebhook() {
  if (!ccm()) throw err(409, 'Add CCM_API_KEY and CCM_SENDER in Vercel first.');
  await ccmCall('api/v1/webhook', { webhook_url: hookUrl() });
  const g = await ccmCall('api/v1/webhook', null, 'GET').catch(() => ({}));
  return { ok: true, webhook: g.webhook || hookUrl() };
}
async function templates() {
  if (!ccm()) return [];
  const j = await ccmCall('api/v1/template?page=1&limit=100', null, 'GET');
  return (j.templates || []).map((t) => ({ id: t.id, name: t.name, status: t.status, category: t.category, type: t.temptype, vars: (t.placeholder && t.placeholder.bodyvar) || 0 }));
}

async function windowOpen(bookingId) {
  const r = await db.one("select max(sent_at) as at from communications where booking_id = $1 and channel = 'whatsapp' and direction = 'in'", [bookingId]);
  return !!(r && r.at && Date.now() - new Date(r.at).getTime() < 24 * 3600e3);
}

// A PDF uploaded to WhatsApp once, to go in a template's document header. Returns the media id.
async function upload(buf, filename) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename);
  const r = await fetch(`${API()}/${process.env.WHATSAPP_PHONE_ID}/media`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw err(502, `WhatsApp upload: ${j.error?.message || r.status}`);
  return j.id;
}

async function send({ bookingId, phone, text, template, params = [], lang = 'en', userId, document = null, kind = null, status = null }) {
  if (!configured()) throw err(409, 'WhatsApp is not connected yet. It switches on once the WhatsApp Business number is set up.');
  // Test version: every WhatsApp goes to the test mobile in Letter settings, never to a buyer.
  if (process.env.ERP_LIVE !== '1') {
    const tm = ((await db.one("select value from settings where key = 'letters'")) || {}).value?.testMobile;
    if (!tm) throw err(409, 'This is the test version: set a test mobile in Letter settings (Demand letters page). WhatsApps go only there until the ERP is live.');
    phone = tm;
  }
  const to = to91(phone); if (!to) throw err(400, 'This buyer has no valid mobile number.');
  if (ccm()) {
    let j, body;
    if (template) {
      const sample = { bodyvar: params.map(String) };
      if (document) { if (!document.url) throw err(500, 'A document needs a link for Click Connect.'); sample.media = document.url; sample.caption = document.filename; }
      j = await ccmCall('api/v1/whatsapp/single?sval=1', { message_type: 'template', sender: process.env.CCM_SENDER, to, template_id: template, sample });
      body = `[Template ${template}] ${params.join(' · ')}${document ? ' (PDF: ' + document.filename + ')' : ''}`;
    } else {
      if (!(await windowOpen(bookingId))) throw err(409, 'The buyer has not messaged in the last 24 hours, so WhatsApp allows only an approved template. Choose a template.');
      j = await ccmCall('api/v1/whatsapp/agent-reply', { reply: { message: String(text).slice(0, 4000) }, sender: process.env.CCM_SENDER, to: '+' + to, message_type: 'text' });
      body = String(text);
    }
    const id = (j.results && j.results[0] && (j.results[0].transaction_id || j.results[0].id)) || null;
    await comms.record({ bookingId, channel: 'whatsapp', direction: 'out', to: '+' + to, body, providerId: id, delivery: 'sent', kind: kind || (template ? 'template' : 'text'), userId, matchedBy: 'sent from the ERP', status: status || undefined });
    return { id, to: '+' + to };
  }
  let payload, body;
  if (template) {
    const components = [];
    if (document) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: await upload(document.content, document.filename), filename: document.filename } }] });
    if (params.length) components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) });
    payload = { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: lang }, ...(components.length ? { components } : {}) } };
    body = `[Template ${template}] ${params.join(' · ')}${document ? ' (PDF: ' + document.filename + ')' : ''}`;
  } else {
    if (!(await windowOpen(bookingId))) throw err(409, 'The buyer has not messaged in the last 24 hours, so WhatsApp allows only an approved template. Choose a template.');
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 4000) } };
    body = String(text);
  }
  const r = await fetch(`${API()}/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, `WhatsApp: ${j.error?.error_user_msg || j.error?.message || r.status}`);
  const id = j.messages && j.messages[0] && j.messages[0].id;
  await comms.record({ bookingId, channel: 'whatsapp', direction: 'out', to: '+' + to, body, providerId: id, delivery: 'sent', kind: kind || (template ? 'template' : 'text'), userId, matchedBy: 'sent from the ERP' });
  return { id };
}

// A message to one of our own staff (approvals, the 10 am summary): never recorded against a buyer. Outside 24 hours
// of their last message WhatsApp allows only an approved template; a reply to their message can be free text.
async function sendStaff({ phone, template, params = [], text }) {
  if (!configured()) throw err(409, 'WhatsApp is not connected yet.');
  const to = to91(phone); if (!to) throw err(400, 'No valid mobile number.');
  if (ccm()) {
    if (template) return ccmCall('api/v1/whatsapp/single?sval=1', { message_type: 'template', sender: process.env.CCM_SENDER, to, template_id: template, sample: { bodyvar: params.map((p) => String(p).replace(/\s*\n\s*/g, ' ')) } });
    return ccmCall('api/v1/whatsapp/agent-reply', { reply: { message: String(text).slice(0, 4000) }, sender: process.env.CCM_SENDER, to: '+' + to, message_type: 'text' });
  }
  const payload = template ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: 'en' }, components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).replace(/\s*\n\s*/g, ' ') })) }] : [] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 4000) } };
  const r = await fetch(`${API()}/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, `WhatsApp: ${j.error?.error_user_msg || j.error?.message || r.status}`);
  return j;
}

// Meta signs each webhook call with the app secret.
function signed(req, raw) {
  const secret = process.env.WHATSAPP_APP_SECRET; if (!secret) return false;
  const sig = String(req.headers['x-hub-signature-256'] || '');
  const want = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

async function webhook(body) {
  let saved = 0;
  // Meta sends entry[].changes[].value; Click Connect sends { value, webhook_type, transaction_id, fileurl } (sometimes Meta's shape)
  const changes = body.entry ? body.entry.flatMap((e) => (e.changes || []).map((c) => ({ ...c, _tx: c.transaction_id || body.transaction_id, _file: c.fileurl || body.fileurl })))
    : body.value ? [{ value: body.value, _tx: body.transaction_id, _file: body.fileurl, _type: body.webhook_type }] : [];
  for (const ch of changes) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
    for (const m of v.messages || []) {
      const text = m.type === 'text' ? m.text.body : m.type === 'button' ? m.button.text : m.type === 'interactive' ? JSON.stringify(m.interactive[m.interactive.type] || {}).slice(0, 500)
        : `[${m.type}${m[m.type] && m[m.type].caption ? ': ' + m[m.type].caption : ''}${m[m.type] && m[m.type].filename ? ' · ' + m[m.type].filename : ''}]`;
      // Management approving a purchase request by reply ("APPROVE PR-0012") is handled here, not filed as a buyer message.
      const btn = m.type === 'button' ? (m.button.payload || m.button.text) : m.type === 'interactive' ? ((m.interactive.button_reply || m.interactive.list_reply || {}).id || '') : text;
      const staff = await require('./staff-alerts').handleReply(m.from, btn).catch((e) => { console.error('approval reply', e.message); return null; });
      if (staff && staff.handled) { saved++; continue; }
      const f = await comms.findBooking({ phone: comms.mobile(m.from), text });
      const id = await comms.record({ bookingId: f && !f.weak ? f.bookingId : null, channel: 'whatsapp', direction: 'in', from: `+${m.from}${names[m.from] ? ' (' + names[m.from] + ')' : ''}`,
        body: text, providerId: m.id, at: m.timestamp ? new Date(+m.timestamp * 1000).toISOString() : null, matchedBy: f ? (f.weak ? null : 'mobile number') : null,
        status: f && !f.weak ? 'matched' : 'unmatched', kind: m.type, attachments: m.type !== 'text' && m[m.type] && m[m.type].id ? [{ name: m[m.type].filename || m.type, mime: m[m.type].mime_type, whatsappMedia: m[m.type].id, ...(ch._file ? { url: ch._file } : {}) }] : [] });
      if (id) { saved++; if (f && !f.weak) await require('./comms-notify').notify(id).catch((e) => console.error('notify', e.message)); }
    }
    // delivery ticks: matched on the message id, or on Click Connect's transaction id given when it was sent
    for (const s of v.statuses || []) await db.q("update communications set delivery = $3 where channel = 'whatsapp' and (provider_id = $1 or provider_id = $2) and (delivery is null or delivery <> 'read')", [s.id, ch._tx || s.id, s.status === 'failed' ? 'failed: ' + ((s.errors && s.errors[0] && s.errors[0].title) || 'not delivered') : s.status]);
  }
  return { saved };
}

module.exports = { configured, provider, ccm, send, sendStaff, webhook, signed, windowOpen, hookKey, hookUrl, connectWebhook, templates, fileLink, checkLink };
