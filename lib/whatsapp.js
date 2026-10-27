// WhatsApp Business (Meta WhatsApp Cloud API). Off until the number is connected in Vercel:
//   WHATSAPP_TOKEN          permanent access token of the WhatsApp Business app (System User)
//   WHATSAPP_PHONE_ID       the phone number ID of the business number
//   WHATSAPP_VERIFY_TOKEN   any secret word, typed again in Meta when the webhook is set up
//   WHATSAPP_APP_SECRET     the app secret, to check that messages really come from Meta
// Webhook (Meta → ERP): https://erp.dreamindiarealty.com/api/whatsapp   (messages and delivery ticks)
// A free-text message can be sent only within 24 hours of the buyer's last message; outside that window WhatsApp
// allows only an approved template (sent by its name, with the {{1}}, {{2}}… values).
const crypto = require('crypto');
const db = require('./db');
const comms = require('./comms');

const API = () => process.env.WHATSAPP_API || 'https://graph.facebook.com/v21.0';
const configured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const err = (status, message) => Object.assign(new Error(message), { status });
const to91 = (p) => { const d = comms.mobile(p); return d ? '91' + d : null; };

async function windowOpen(bookingId) {
  const r = await db.one("select max(sent_at) as at from communications where booking_id = $1 and channel = 'whatsapp' and direction = 'in'", [bookingId]);
  return !!(r && r.at && Date.now() - new Date(r.at).getTime() < 24 * 3600e3);
}

async function send({ bookingId, phone, text, template, params = [], lang = 'en', userId }) {
  if (!configured()) throw err(409, 'WhatsApp is not connected yet. It switches on once the WhatsApp Business number is set up.');
  const to = to91(phone); if (!to) throw err(400, 'This buyer has no valid mobile number.');
  let payload, body;
  if (template) {
    payload = { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: lang }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }] } : {}) } };
    body = `[Template ${template}] ${params.join(' · ')}`;
  } else {
    if (!(await windowOpen(bookingId))) throw err(409, 'The buyer has not messaged in the last 24 hours, so WhatsApp allows only an approved template. Choose a template.');
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 4000) } };
    body = String(text);
  }
  const r = await fetch(`${API()}/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, `WhatsApp: ${j.error?.error_user_msg || j.error?.message || r.status}`);
  const id = j.messages && j.messages[0] && j.messages[0].id;
  await comms.record({ bookingId, channel: 'whatsapp', direction: 'out', to: '+' + to, body, providerId: id, delivery: 'sent', kind: template ? 'template' : 'text', userId, matchedBy: 'sent from the ERP' });
  return { id };
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
  for (const e of body.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
    for (const m of v.messages || []) {
      const text = m.type === 'text' ? m.text.body : m.type === 'button' ? m.button.text : m.type === 'interactive' ? JSON.stringify(m.interactive[m.interactive.type] || {}).slice(0, 500)
        : `[${m.type}${m[m.type] && m[m.type].caption ? ': ' + m[m.type].caption : ''}${m[m.type] && m[m.type].filename ? ' · ' + m[m.type].filename : ''}]`;
      const f = await comms.findBooking({ phone: comms.mobile(m.from), text });
      const id = await comms.record({ bookingId: f && !f.weak ? f.bookingId : null, channel: 'whatsapp', direction: 'in', from: `+${m.from}${names[m.from] ? ' (' + names[m.from] + ')' : ''}`,
        body: text, providerId: m.id, at: m.timestamp ? new Date(+m.timestamp * 1000).toISOString() : null, matchedBy: f ? (f.weak ? null : 'mobile number') : null,
        status: f && !f.weak ? 'matched' : 'unmatched', kind: m.type, attachments: m.type !== 'text' && m[m.type] && m[m.type].id ? [{ name: m[m.type].filename || m.type, mime: m[m.type].mime_type, whatsappMedia: m[m.type].id }] : [] });
      if (id) { saved++; if (f && !f.weak) await require('./comms-notify').notify(id).catch((e) => console.error('notify', e.message)); }
    }
    for (const s of v.statuses || []) await db.q("update communications set delivery = $2 where channel = 'whatsapp' and provider_id = $1 and (delivery is null or delivery <> 'read')", [s.id, s.status]);
  }
  return { saved };
}

module.exports = { configured, send, webhook, signed, windowOpen };
