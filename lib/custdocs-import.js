// The Signature CRM's flat files (registered agreement, Index II, NOC, KYC...) from the shared Google Drive folder the
// CRM team uploads to, copied into each flat's own folder in Customer documents and listed on that booking.
// The folder is shared with the ERP's service account (Viewer); each file is read with that account and saved again
// in the ERP's documents Drive (lib/gdrive.js), so it opens like any other customer document. A file already brought
// in is never brought in twice (customer_docs.source_id); the CRM can keep adding files and run it again.
// The flat comes from the file name ("DREAM SIGNATURE B 2402.pdf", "B-2402 Index II.pdf") or, failing that, from the
// sub-folder it sits in ("B 2402 - Mr Shah/agreement.pdf").
const db = require('./db');
const gd = require('./gdrive');
const sheets = require('./sheets');

const FOLDER = () => process.env.SIGNATURE_DOCS_FOLDER || '11A3aVB_KgLkDA4i2aZqmSVfELV033DuV';
const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DIR = 'application/vnd.google-apps.folder';
const TYPES = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/heic': 1, 'application/msword': 1,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1, 'application/vnd.ms-excel': 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1 };
const MAX = 40 * 1024 * 1024;
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const NICE = { 'Agreement for sale (registered)': 'Registered agreement for sale', 'Index II / registration receipt': 'Index II', 'KYC: PAN, Aadhaar, photo': 'KYC',
  'Allotment letter (signed)': 'Allotment letter', 'Booking form (signed)': 'Booking form', 'Stamp duty and registration challans': 'Stamp duty challan',
  'Home loan sanction / bank NOC': 'Bank NOC', 'Payment proof': 'Payment proof', 'Cancellation or transfer papers': 'Cancellation or transfer', 'Letter to or from the buyer': 'Letter', Other: 'Document' };

async function get(url, token, binary) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let m = r.status; try { m = (await r.json()).error?.message || m; } catch { /* not json */ }
    throw Object.assign(new Error(r.status === 404 || r.status === 403 ? `The CRM documents folder is not shared with ${sheets.serviceEmail()} (${m}).` : `Google Drive: ${m}`), { status: r.status === 404 || r.status === 403 ? 400 : 502 });
  }
  return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
}

// every file in the folder and up to two levels of sub-folders, with the names of the folders it sits in
async function listFiles(token, id = FOLDER(), path = [], depth = 0) {
  const out = []; let page = '';
  do {
    const q = new URLSearchParams({ q: `'${String(id).replace(/'/g, '')}' in parents and trashed = false`, fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: '500', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(page ? { pageToken: page } : {}) });
    const j = await get(`${API}/files?${q}`, token);
    for (const f of j.files) {
      if (f.mimeType === DIR) { if (depth < 2) out.push(...await listFiles(token, f.id, [...path, f.name], depth + 1)); }
      else out.push({ ...f, size: Number(f.size) || 0, path });
    }
    page = j.nextPageToken || '';
  } while (page);
  return out;
}

// "DREAM SIGNATURE B 2402.pdf" → B2402; the project's own name is taken out first so its letters don't get in the way
function flatOf(text) {
  const s = String(text || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/dream\s*sig[a-z]*/ig, ' ').replace(/sig[a-z]*ture/ig, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' '); // a date in the name ("28.03.26") is not the flat
  const m = s.match(/(?:^|[^A-Za-z0-9])(?:wing\s*)?([A-Da-d])\s*(?:wing)?\s*[-_/ .]?\s*(?:flat\s*(?:no\.?)?\s*)?(\d{3,4})(?![0-9])/i);
  return m ? m[1].toUpperCase() + m[2] : null;
}
const key = (unitNo) => String(unitNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const KINDS = [
  [/index/i, 'Index II / registration receipt'],
  [/agreement|\bafs\b|regist|\breg\b|deed/i, 'Agreement for sale (registered)'],
  [/kyc|\bpan\b|aadh?a?ar|photo|passport|voter/i, 'KYC: PAN, Aadhaar, photo'],
  [/allot/i, 'Allotment letter (signed)'],
  [/booking|application/i, 'Booking form (signed)'],
  [/challan|stamp|\bsdr\b|grn/i, 'Stamp duty and registration challans'],
  [/\bnoc\b|sanction|loan|\bbank\b/i, 'Home loan sanction / bank NOC'],
  [/receipt|payment|cheque/i, 'Payment proof'],
  [/cancel|transfer/i, 'Cancellation or transfer papers'],
  [/letter|mail/i, 'Letter to or from the buyer'],
];
// what the paper is, from its name; a file named only by the flat is the CRM's registration set (the registered
// agreement with its challans and Index II, scanned together), so it counts as the registered agreement
function kindOf(name) {
  const base = String(name).replace(/\.[a-z0-9]{2,5}$/i, '');
  for (const [re, k] of KINDS) if (re.test(base)) return k;
  const rest = base.replace(/dream(\s*sig[a-z]*)?/ig, '').replace(/(?:^|[^A-Za-z0-9])[A-Da-d]\s*[-_ ]?\s*\d{3,4}(?![0-9])/g, '').replace(/[^A-Za-z]/g, '');
  return rest.length ? 'Other' : 'Agreement for sale (registered)';
}

// What is in the folder, and where each new file would go. bookings: live bookings of the project by flat.
async function plan(projectId) {
  const token = await sheets.accessToken(SCOPE);
  const files = await listFiles(token);
  const done = new Set((await db.q("select source_id from customer_docs where source_id is not null")).map((r) => r.source_id));
  const live = await db.q(`select b.id as booking_id, u.unit_no, u.project_id, p.name as project,
      (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
    from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id
    where u.project_id = $1 and b.status in ('pending', 'active') order by b.id`, [projectId]);
  const units = new Set((await db.q('select unit_no from units where project_id = $1', [projectId])).map((r) => key(r.unit_no)));
  const byFlat = new Map(live.map((b) => [key(b.unit_no), b]));
  const out = { total: files.length, already: 0, ready: [], noFlat: [], noBooking: [], skipped: [] };
  for (const f of files) {
    if (done.has(f.id)) { out.already++; continue; }
    const where = [...f.path, f.name].join(' / ');
    if (!TYPES[f.mimeType]) { out.skipped.push({ name: where, why: 'not a PDF, photo or Office file' }); continue; }
    if (f.size > MAX) { out.skipped.push({ name: where, why: 'over 40 MB' }); continue; }
    const flat = flatOf(f.name) || [...f.path].reverse().map(flatOf).find(Boolean);
    if (!flat || !units.has(flat)) { out.noFlat.push({ name: where, flat }); continue; }
    const bk = byFlat.get(flat);
    if (!bk) { out.noBooking.push({ name: where, flat }); continue; }
    out.ready.push({ id: f.id, name: f.name, where, mime: f.mimeType, size: f.size, kind: kindOf(f.name), booking: bk });
  }
  return out;
}

// Copy the next files across, until the time is nearly up; run again for the rest.
async function run(projectId, user, budgetMs = 40000) {
  const t0 = Date.now();
  const p = await plan(projectId);
  const token = await sheets.accessToken(SCOPE);
  const done = [], failed = [];
  for (const f of p.ready) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const buf = await get(`${API}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, token, true);
      if (!buf.length) throw new Error('the file is empty');
      const b = f.booking;
      const parent = await gd.folder(`booking:${b.booking_id}`, `${b.unit_no} - ${b.buyers || 'buyer'}`, `project:${b.project_id}`, b.project);
      // one clear name in the ERP whatever the CRM called it ("Reg.Deed. B- 2601 28.03.26.pdf" → "B-2601 - Registered agreement for sale.pdf")
      const ext = (f.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || EXT[f.mime] || 'pdf';
      const fileName = `${b.unit_no} - ${NICE[f.kind] || f.kind}.${ext.toLowerCase()}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 160);
      const url = await gd.startUpload({ name: `${f.kind.replace(/[:/]/g, ' -')} - ${fileName}`.slice(0, 200), mime: f.mime, size: buf.length, parent });
      const r = await gd.putPart(url, buf, 0, buf.length);
      if (!r.done) throw new Error('Google Drive did not finish the copy');
      const row = await db.one(`insert into customer_docs (owner_kind, booking_id, label, kind, title, file_name, mime, size, drive_file_id, received, status, uploaded_by, ready_at, source_id)
          values ('booking', $1, $2, $3, $4, $5, $6, $7, $8, $7, 'ready', $9, now(), $10) on conflict do nothing returning id`,
        [b.booking_id, b.unit_no, f.kind, `From the CRM folder: ${f.name}`.slice(0, 160), fileName, f.mime, buf.length, r.id, user ? user.id : null, f.id]);
      if (row) done.push({ id: row.id, flat: b.unit_no, kind: f.kind, name: f.where });
    } catch (e) { failed.push({ name: f.where, why: e.message }); }
  }
  return { imported: done, failed, left: p.ready.length - done.length - failed.length, noFlat: p.noFlat, noBooking: p.noBooking, skipped: p.skipped, already: p.already + done.length, total: p.total };
}

module.exports = { plan, run, flatOf, kindOf, FOLDER };
