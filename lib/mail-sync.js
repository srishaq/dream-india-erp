// Buyers' replies: every 15 minutes (cron job=mail) the ERP reads the inbox of the mailbox it sends from (the same
// login as SMTP_USER / SMTP_PASS; IMAP_HOST if the host is not the SMTP host with imap. in front) and saves:
//   - every reply to an email the ERP sent (In-Reply-To / References), against that email's booking
//   - every message from a buyer's own email address, against their booking (the flat in the subject picks one)
//   - a message naming a flat in its subject from an address the ERP does not know: to the Communication inbox,
//     for CRM to link or dismiss
// Nothing else in the mailbox is read into the ERP. Mail is never marked read, moved or deleted.
// Attachments of matched messages are filed into the buyer's Customer documents (Google Drive), up to 15 MB each.
const db = require('./db');
const imap = require('./imap');
const { parse } = require('./mailparse');
const comms = require('./comms');

const MAX_PER_RUN = 80, MAX_ATTACH = 15 * 1024 * 1024, FIRST_DAYS = 14;
const DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cfg() {
  const e = process.env;
  const user = e.IMAP_USER || e.SMTP_USER || '', pass = (e.IMAP_PASS || e.SMTP_PASS || '').replace(/\s+/g, '');
  const smtp = e.SMTP_HOST || 'smtp.gmail.com';
  const host = e.IMAP_HOST || (/^smtp\./i.test(smtp) ? smtp.replace(/^smtp\./i, 'imap.') : smtp);
  return { user, pass, host, port: +e.IMAP_PORT || 993, secure: e.IMAP_TLS !== '0' };
}
const configured = () => { const c = cfg(); return !!(c.user && c.pass && c.host); };
async function state() { return (await db.one("select value from settings where key = 'mail_sync'"))?.value || {}; }
async function save(v) { await db.q("insert into settings (key, value) values ('mail_sync', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(v)]); }

async function fileAttachments(bookingId, msg, label) {
  const out = [];
  let gd = null;
  for (const a of msg.attachments) {
    const item = { name: a.filename, mime: a.mime, size: a.content.length };
    if (!DOC_TYPES.has(a.mime) || a.content.length > MAX_ATTACH || a.content.length < 200) { item.note = DOC_TYPES.has(a.mime) ? 'too large to file' : 'not filed (type)'; out.push(item); continue; }
    try {
      gd = gd || require('./gdrive');
      if (!(await gd.status()).connected) { item.note = 'not filed: Google Drive not connected'; out.push(item); continue; }
      const L = await db.one(`select b.id, u.unit_no, u.project_id, p.name as project, (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
        from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id where b.id = $1`, [bookingId]);
      const parent = await gd.folder(`booking:${L.id}`, `${L.unit_no} - ${L.buyers || 'buyer'}`, `project:${L.project_id}`, L.project);
      const fileName = String(a.filename || 'attachment').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 160);
      const url = await gd.startUpload({ name: `Letter to or from the buyer - email ${label} - ${fileName}`.slice(0, 200), mime: a.mime, size: a.content.length, parent });
      const PART = 10 * 256 * 1024; let r = null;
      for (let s = 0; s < a.content.length; s += PART) r = await gd.putPart(url, a.content.subarray(s, Math.min(a.content.length, s + PART)), s, a.content.length);
      const d = await db.one(`insert into customer_docs (owner_kind, booking_id, label, kind, title, file_name, mime, size, drive_file_id, received, status, ready_at)
        values ('booking', $1, $2, 'Letter to or from the buyer', $3, $4, $5, $6, $7, $6, 'ready', now()) returning id`, [L.id, L.unit_no, `Email attachment, ${label}`, fileName, a.mime, a.content.length, r && r.id]);
      item.docId = d.id;
    } catch (e) { item.note = 'not filed: ' + e.message.slice(0, 120); }
    out.push(item);
  }
  return out;
}

async function sync({ trigger = 'schedule' } = {}) {
  if (!configured()) return { ok: false, reason: 'The mailbox is not connected (SMTP_USER and SMTP_PASS in Vercel).' };
  const c = cfg(), st = await state(), started = Date.now();
  const res = { ok: true, at: new Date().toISOString(), trigger, looked: 0, saved: 0, inbox: 0, skipped: 0 };
  let cn;
  try {
    cn = await imap.connect({ host: c.host, port: c.port, secure: c.secure });
    await cn.login(c.user, c.pass);
    const box = await cn.select('INBOX');
    let uids;
    if (st.uidValidity === box.uidValidity && st.last) uids = await cn.search(`UID ${st.last + 1}:*`);
    else { const d = new Date(Date.now() - FIRST_DAYS * 864e5); uids = await cn.search(`SINCE ${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`); }
    uids = uids.filter((u) => !st.last || st.uidValidity !== box.uidValidity || u > st.last);
    let last = st.uidValidity === box.uidValidity ? st.last || 0 : 0;
    const me = c.user.toLowerCase();
    const testAddr = String(((await db.one("select value from settings where key = 'letters'"))?.value || {}).testEmail || '').toLowerCase();
    for (const uid of uids.slice(0, MAX_PER_RUN)) {
      if (Date.now() - started > 80000) break;
      const raw = await cn.fetch(uid); last = uid; res.looked++;
      if (!raw) continue;
      const m = parse(raw);
      const from = comms.emailOf(m.from);
      if (!from || from === me || m.autoReply) { res.skipped++; continue; }
      // 1. a reply to something the ERP sent
      let bookingId = null, by = null, status = 'matched';
      const refs = [m.inReplyTo, ...m.references].filter(Boolean);
      if (refs.length) {
        const o = await db.one("select booking_id from communications where channel = 'email' and direction = 'out' and message_id = any($1) and booking_id is not null order by id desc limit 1", [refs]);
        if (o) { bookingId = o.booking_id; by = 'reply to an ERP email'; }
      }
      // 2. from a buyer's own address
      if (!bookingId) { const f = await comms.findBooking({ email: from, text: m.subject }); if (f && f.by === 'email') { bookingId = f.bookingId; by = f.several ? 'buyer email (has more than one flat: check)' : 'buyer email'; } }
      // 3. names a flat in the subject (or the test address in the test version): to the inbox for CRM to confirm
      if (!bookingId) {
        const unit = comms.unitIn(m.subject);
        if (!unit && from !== testAddr) { res.skipped++; continue; }
        status = 'unmatched'; by = unit ? `flat ${unit} named in the subject` : 'from the test address';
      }
      const fresh = comms.fresh(m.text);
      const label = m.date ? new Date(m.date).toISOString().slice(0, 10) : 'received';
      const attachments = status === 'matched' && m.attachments.length ? await fileAttachments(bookingId, m, label) : m.attachments.map((a) => ({ name: a.filename, mime: a.mime, size: a.content.length, note: 'link the message to file it' }));
      const id = await comms.record({ bookingId, channel: 'email', direction: 'in', from: m.from, to: m.to, subject: m.subject, body: fresh || m.text, messageId: m.messageId || `<imap-${box.uidValidity}-${uid}>`,
        inReplyTo: m.inReplyTo, at: m.date, status, matchedBy: by, attachments });
      if (id) { res.saved++; if (status === 'unmatched') res.inbox++; }
    }
    await save({ uidValidity: box.uidValidity, last, lastRun: res.at, lastError: null, lastResult: res });
  } catch (e) {
    res.ok = false; res.error = /AUTHENTICATIONFAILED|Invalid credentials|LOGIN/i.test(e.message) ? 'The mailbox refused the login: check SMTP_USER / SMTP_PASS (for Gmail, an App password with IMAP on).' : e.message;
    await save({ ...st, lastRun: res.at, lastError: res.error });
  } finally { if (cn) await cn.logout(); }
  return res;
}

module.exports = { sync, configured, state, cfg };
