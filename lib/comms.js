// The communication record of every buyer: emails the ERP sends, buyers' replies (lib/mail-sync.js) and WhatsApp
// (lib/whatsapp.js), saved against the booking. Matching: the buyer's email address or mobile number; when one
// person has more than one live booking, the flat number in the subject or message (A-1203) decides.
const db = require('./db');

const UNIT = /\b([AB])\s*[-/ ]?\s*(\d{3,4})\b/i;
const unitIn = (s) => { const m = String(s || '').match(UNIT); return m ? `${m[1].toUpperCase()}-${m[2]}` : null; };
const mobile = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
const emailOf = (s) => { const m = String(s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); return m ? m[0].toLowerCase() : null; };

// Live bookings of a buyer found by email or mobile; the flat in the text picks one when there are several.
async function findBooking({ email, phone, text }) {
  let rows = [];
  if (email) rows = (await db.q(`select b.id, u.unit_no, b.status, y.email from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
    where strpos(lower(y.email), $1) > 0 and b.status in ('active', 'pending', 'cancelled') order by (b.status = 'active') desc, b.id desc`, [email]))
    .filter((r) => (String(r.email).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).includes(email));
  if (!rows.length && phone) rows = await db.q(`select b.id, u.unit_no, b.status from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
    where right(regexp_replace(coalesce(y.phone, ''), '[^0-9]', '', 'g'), 10) = $1 and b.status in ('active', 'pending', 'cancelled') order by (b.status = 'active') desc, b.id desc`, [phone]);
  rows = rows.filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);
  const unit = unitIn(text);
  if (rows.length) {
    const byUnit = unit && rows.find((r) => r.unit_no === unit);
    return { bookingId: (byUnit || rows[0]).id, by: email && rows.length ? 'email' : 'mobile', several: rows.length > 1 && !byUnit };
  }
  if (unit) {
    const r = await db.one("select b.id from bookings b join units u on u.id = b.unit_id where u.unit_no = $1 and b.status = 'active' order by b.id desc limit 1", [unit]);
    if (r) return { bookingId: r.id, by: 'flat in subject', weak: true };
  }
  return null;
}

// Saves one message; a message seen before (same Message-ID or WhatsApp id) is not saved twice.
async function record(m) {
  const r = await db.one(`insert into communications (booking_id, tenant_id, channel, direction, from_addr, to_addr, subject, body, message_id, in_reply_to, provider_id, sent_at, status, matched_by, delivery, attachments, kind, sent_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now()), $13, $14, $15, $16, $17, $18)
    on conflict do nothing returning id`,
  [m.bookingId || null, m.tenantId || null, m.channel, m.direction, m.from || null, m.to || null, m.subject ? String(m.subject).slice(0, 500) : null, m.body ? String(m.body).slice(0, 20000) : null,
    m.messageId || null, m.inReplyTo || null, m.providerId || null, m.at || null, m.status || (m.bookingId || m.tenantId ? 'matched' : 'unmatched'), m.matchedBy || null, m.delivery || null,
    JSON.stringify(m.attachments || []), m.kind || null, m.userId || null]);
  return r ? r.id : null;
}
// What the ERP sent: logged against the booking (never fails the send itself).
async function logSent({ bookingId, to, subject, body, sent, kind, userId, test }) {
  try {
    await record({ bookingId, channel: 'email', direction: 'out', from: sent && sent.from, to: [].concat(to || []).join(', '), subject, body: (test ? '[Test version: sent to the test address only]\n\n' : '') + (body || ''),
      messageId: sent && sent.messageId, kind, userId, matchedBy: 'sent from the ERP' });
  } catch (e) { console.error('comms.logSent', e.message); }
}

// A reply's own text, without the quoted earlier message underneath.
function fresh(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lines) {
    if (/^On .{4,200}wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) || /^From: .+/.test(l) && out.length > 2) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { findBooking, record, logSent, fresh, unitIn, mobile, emailOf };
