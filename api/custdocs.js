// Customer documents: scanned and signed papers for each flat (agreement, Index II, KYC, signed letters...) and the
// signed agreements of SRA tenants, kept in Google Drive (lib/gdrive.js) and listed here.
// GET  ?status=1                  → is Google Drive connected (and the folder link)
// GET  ?oauth=start               → Admin: off to Google to connect the Drive;  /oauth/google → the way back
// GET  ?project=ID                → every live booking with which documents it has (the checklist)
// GET  ?booking=ID | ?tenant=ID   → that booking's / tenant's documents
// GET  ?tenants=1                 → SRA tenants with their documents
// GET  ?file=ID&part=N            → one piece of the file (pieces of 2.5 MB; ?file=ID&info=1 → name, type, size, pieces)
// POST {action:'start', owner, id, kind, title?, fileName, mime, size} → a new document, ready for its pieces
// POST {action:'part', docId, index, data (base64)}                   → one piece; the last makes it ready
// POST {action:'remove', docId, reason}  · {action:'disconnect'} (Admin)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const gd = require('../lib/gdrive');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

const PART = 10 * 256 * 1024; // 2.5 MB: a multiple of 256 KB, and under Vercel's 4.5 MB request limit once in base64
const MAX = 40 * 1024 * 1024;
const TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/heic': 'HEIC',
  'application/msword': 'DOC', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX' };
const KINDS = {
  booking: ['Booking form (signed)', 'Allotment letter (signed)', 'KYC: PAN, Aadhaar, photo', 'Agreement for sale (registered)', 'Index II / registration receipt',
    'Stamp duty and registration challans', 'Home loan sanction / bank NOC', 'Payment proof', 'Cancellation or transfer papers', 'Letter to or from the buyer', 'Other'],
  tenant: ['Agreement (signed)', 'KYC: PAN, Aadhaar, photo', 'Rent receipt', 'Eligibility / annexure papers', 'Other'],
  cp: ['CP bill / invoice', 'Agreement with the partner', 'PAN / GST / RERA certificate', 'Payment advice', 'Other'],
};
// The papers every flat should have; the checklist shows which are missing.
const CHECK = ['Booking form (signed)', 'Allotment letter (signed)', 'KYC: PAN, Aadhaar, photo', 'Agreement for sale (registered)', 'Index II / registration receipt'];

const canSee = (u, kind) => (kind === 'tenant' ? has(u, 'accounts.view') : kind === 'cp' ? has(u, 'ledger.view') || has(u, 'accounts.view') : has(u, 'buyer.kyc'));
const canAdd = (u, kind) => (kind === 'tenant' ? has(u, 'accounts.enter') : kind === 'cp' ? has(u, 'brokerage.bill') || has(u, 'accounts.enter') : has(u, 'buyer.kyc'));
const canRemove = (u, kind) => has(u, 'users.manage') || (kind === 'tenant' || kind === 'cp' ? has(u, 'accounts.manage') : has(u, 'booking.approve'));
const cols = 'd.id, d.owner_kind, d.booking_id, d.tenant_id, d.cp_id, d.label, d.kind, d.title, d.file_name, d.mime, d.size, d.status, d.created_at, d.ready_at, x.name as by_name';

async function bookingLabel(bookingId) {
  return db.one(`select b.id, u.unit_no, u.project_id, p.name as project, (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
    from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id where b.id = $1`, [bookingId]);
}
async function docFor(u, id) {
  const d = await db.one('select d.*, u2.project_id from customer_docs d left join bookings b on b.id = d.booking_id left join units u2 on u2.id = b.unit_id where d.id = $1', [id]);
  if (!d) throw fail(404, 'That document is not there.');
  if (!canSee(u, d.owner_kind)) throw fail(403, 'Your role does not see these documents.');
  if (d.owner_kind === 'booking') needProject(u, d.project_id);
  return d;
}

module.exports = route({
  GET: async (req, res) => {
    const q = req.query || {};
    const u = await auth.guard(req, res); if (!u) return;
    if (q.oauth === 'start') {
      if (!has(u, 'users.manage')) throw fail(403, 'Only the Admin can connect Google Drive.');
      res.statusCode = 302; res.setHeader('Location', await gd.authUrl(req, u.id)); return res.end();
    }
    if (q.oauth === 'callback' && String(q.state || '').startsWith('yt.')) { // the same Google sign-in, for YouTube on the Marketing page
      if (!has(u, 'marketing.edit') && u.role !== 'admin') throw fail(403, 'Only the marketing team connects YouTube.');
      let back;
      const social = require('../lib/social');
      try { const r = await social.ytCallback(req, u.id); await audit.record(db.q, { user: u, action: 'connect', entity: 'youtube', after: r }); back = `/?social=${encodeURIComponent(`YouTube connected: ${r.channel}. Pulling the last 12 months…`)}#/marketing`; }
      catch (e) { back = '/?social=' + encodeURIComponent(e.message) + '#/marketing'; }
      res.statusCode = 302; res.setHeader('Location', back); return res.end();
    }
    if (q.oauth === 'callback') {
      if (!has(u, 'users.manage')) throw fail(403, 'Only the Admin can connect Google Drive.');
      let back = '/?drive=connected#/custdocs';
      try { const r = await gd.callback(req, u.id); await audit.record(db.q, { user: u, action: 'connect', entity: 'google-drive', after: { email: r.email } }); }
      catch (e) { back = '/?drive=' + encodeURIComponent(e.message) + '#/custdocs'; }
      res.statusCode = 302; res.setHeader('Location', back); return res.end();
    }
    if (q.status) {
      const s = await gd.status();
      return res.json({ ...s, folder: s.rootId ? gd.folderLink(s.rootId) : null, redirectUri: gd.redirectUri(req), canConnect: has(u, 'users.manage'), kinds: KINDS, check: CHECK, part: PART, max: MAX, types: TYPES });
    }
    if (q.file) {
      const d = await docFor(u, intOr(q.file));
      if (d.status !== 'ready') throw fail(409, 'This document is not ready to open.');
      const parts = Math.ceil(Number(d.size) / PART);
      if (q.info) return res.json({ id: d.id, name: d.file_name, mime: d.mime, size: Number(d.size), parts, part: PART });
      const i = intOr(q.part, 0); if (i < 0 || i >= parts) throw fail(400, 'No such piece.');
      const start = i * PART, end = Math.min(Number(d.size), start + PART) - 1;
      const buf = await gd.getPart(d.drive_file_id, start, end);
      if (i === 0) await audit.record(db.q, { user: u, action: 'view', entity: 'customer-doc', entityId: d.id, projectId: d.project_id || null, after: { label: d.label, kind: d.kind } });
      res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    }
    if (q.booking) {
      if (!has(u, 'buyer.kyc')) throw fail(403, 'Your role does not see buyer documents.');
      await bookingFor(u, intOr(q.booking));
      const rows = await db.q(`select ${cols} from customer_docs d left join users x on x.id = d.uploaded_by where d.booking_id = $1 and d.status = 'ready' order by d.created_at desc`, [intOr(q.booking)]);
      return res.json({ rows, canAdd: canAdd(u, 'booking'), canRemove: canRemove(u, 'booking') });
    }
    if (q.tenant) {
      if (!has(u, 'accounts.view')) throw fail(403, 'Your role does not see tenant documents.');
      const rows = await db.q(`select ${cols} from customer_docs d left join users x on x.id = d.uploaded_by where d.tenant_id = $1 and d.status = 'ready' order by d.created_at desc`, [intOr(q.tenant)]);
      return res.json({ rows, canAdd: canAdd(u, 'tenant'), canRemove: canRemove(u, 'tenant') });
    }
    if (q.cp) {
      if (!canSee(u, 'cp')) throw fail(403, 'Your role does not see partner documents.');
      const rows = await db.q(`select ${cols} from customer_docs d left join users x on x.id = d.uploaded_by where d.cp_id = $1 and d.status = 'ready' order by d.created_at desc`, [intOr(q.cp)]);
      return res.json({ rows, canAdd: canAdd(u, 'cp'), canRemove: canRemove(u, 'cp') });
    }
    if (q.tenants) {
      if (!has(u, 'accounts.view')) throw fail(403, 'Your role does not see tenant documents.');
      const rows = await db.q(`select t.id, t.survey_no, t.name, t.area, t.status,
          (select count(*)::int from customer_docs d where d.tenant_id = t.id and d.status = 'ready') as docs,
          (select count(*)::int from customer_docs d where d.tenant_id = t.id and d.status = 'ready' and d.kind = 'Agreement (signed)') as agreements
        from acc_sra_tenants t where t.book = 'signature' order by t.survey_no nulls last, t.id`);
      return res.json({ rows, canAdd: canAdd(u, 'tenant') });
    }
    if (q.project) {
      if (!has(u, 'buyer.kyc')) throw fail(403, 'Your role does not see buyer documents.');
      const pid = needProject(u, intOr(q.project));
      const rows = await db.q(`select b.id as booking_id, u.unit_no, b.registration_date, b.registration_status,
          (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers,
          coalesce((select jsonb_object_agg(k.kind, k.n) from (select d.kind, count(*)::int as n from customer_docs d where d.booking_id = b.id and d.status = 'ready' group by d.kind) k), '{}') as kinds
        from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'active' order by u.unit_no`, [pid]);
      return res.json({ rows, check: CHECK });
    }
    throw fail(400, 'Nothing asked for.');
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (b.action === 'disconnect') {
      if (!has(u, 'users.manage')) throw fail(403, 'Only the Admin can disconnect Google Drive.');
      await gd.disconnect();
      await audit.record(db.q, { user: u, action: 'disconnect', entity: 'google-drive' });
      return res.json({ ok: true });
    }
    if (b.action === 'start') {
      const owner = b.owner === 'tenant' ? 'tenant' : b.owner === 'cp' ? 'cp' : 'booking';
      if (!canAdd(u, owner)) throw fail(403, 'Your role cannot add these documents.');
      const kind = KINDS[owner].includes(b.kind) ? b.kind : null; if (!kind) throw fail(400, 'Choose what the document is.');
      const mime = TYPES[b.mime] ? b.mime : null; if (!mime) throw fail(400, 'Upload a PDF, a photo (JPG, PNG) or a Word or Excel file.');
      const size = intOr(b.size); if (!(size > 0)) throw fail(400, 'That file is empty.'); if (size > MAX) throw fail(400, 'That file is over 40 MB. Scan it at a lower resolution, or in black and white.');
      const fileName = str(b.fileName, 160).replace(/[\\/:*?"<>|]+/g, '-') || 'document';
      let label, parent, bookingId = null, tenantId = null, cpId = null, projectId = null;
      if (owner === 'cp') {
        const f = await db.one('select id, name from channel_partners where id = $1', [intOr(b.id)]); if (!f) throw fail(404, 'Partner firm not found.');
        cpId = f.id; label = f.name;
        parent = await gd.folder(`cp:${f.id}`, f.name, 'channel-partners', 'Channel Partners');
      } else if (owner === 'booking') {
        const bk = await bookingFor(u, intOr(b.id)); const L = await bookingLabel(bk.id);
        bookingId = bk.id; projectId = L.project_id; label = L.unit_no;
        parent = await gd.folder(`booking:${bk.id}`, `${L.unit_no} - ${L.buyers || 'buyer'}`, `project:${L.project_id}`, L.project);
      } else {
        const t = await db.one('select id, survey_no, name from acc_sra_tenants where id = $1', [intOr(b.id)]); if (!t) throw fail(404, 'Tenant not found.');
        tenantId = t.id; label = `Survey ${t.survey_no == null ? '—' : Number(t.survey_no)} · ${t.name || ''}`.trim();
        parent = await gd.folder(`tenant:${t.id}`, `${t.survey_no == null ? '' : Number(t.survey_no) + ' - '}${t.name || 'tenant'}`, 'tenants', 'SRA Tenants');
      }
      const title = str(b.title, 160) || null;
      const driveName = `${kind.replace(/[:/]/g, ' -')}${title ? ' - ' + title : ''} - ${fileName}`.slice(0, 200);
      const url = await gd.startUpload({ name: driveName, mime, size, parent });
      const r = await db.one(`insert into customer_docs (owner_kind, booking_id, tenant_id, cp_id, label, kind, title, file_name, mime, size, upload_url, uploaded_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`, [owner, bookingId, tenantId, cpId, label, kind, title, fileName, mime, size, url, u.id]);
      return res.json({ docId: r.id, part: PART, parts: Math.ceil(size / PART), projectId });
    }
    if (b.action === 'part') {
      const d = await db.one('select * from customer_docs where id = $1', [intOr(b.docId)]);
      if (!d || d.uploaded_by !== u.id) throw fail(404, 'That upload is not yours or has gone.');
      if (d.status !== 'uploading') throw fail(409, 'That upload is already finished.');
      const i = intOr(b.index, -1), start = i * PART;
      if (i < 0 || start !== Number(d.received)) throw fail(409, `Send piece ${Math.floor(Number(d.received) / PART) + 1} next.`);
      const buf = Buffer.from(String(b.data || ''), 'base64');
      const want = Math.min(PART, Number(d.size) - start);
      if (buf.length !== want) throw fail(400, 'That piece of the file did not arrive whole. Try again.');
      let r;
      try { r = await gd.putPart(d.upload_url, buf, start, Number(d.size)); }
      catch (e) { await db.q("update customer_docs set status = 'failed' where id = $1", [d.id]); throw e; }
      if (!r.done) { await db.q('update customer_docs set received = $2 where id = $1', [d.id, start + buf.length]); return res.json({ ok: true, done: false }); }
      await db.q("update customer_docs set status = 'ready', received = size, drive_file_id = $2, upload_url = null, ready_at = now() where id = $1", [d.id, r.id]);
      const pj = d.booking_id ? (await db.one('select u.project_id from bookings b join units u on u.id = b.unit_id where b.id = $1', [d.booking_id])).project_id : null;
      await audit.record(db.q, { user: u, action: 'upload', entity: 'customer-doc', entityId: d.id, projectId: pj, after: { label: d.label, kind: d.kind, file: d.file_name, size: Number(d.size) } });
      return res.json({ ok: true, done: true, id: d.id });
    }
    if (b.action === 'remove') {
      const d = await docFor(u, intOr(b.docId));
      if (!canRemove(u, d.owner_kind)) throw fail(403, d.owner_kind === 'tenant' ? 'Only Head Accounts or the Admin can remove a tenant document.' : 'Only Head CRM or the Admin can remove a buyer document.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Say why it is being removed.');
      await db.q("update customer_docs set status = 'removed', removed_by = $2, removed_at = now(), remove_reason = $3 where id = $1", [d.id, u.id, reason]);
      await audit.record(db.q, { user: u, action: 'remove', entity: 'customer-doc', entityId: d.id, projectId: d.project_id || null, after: { label: d.label, kind: d.kind, reason } });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
