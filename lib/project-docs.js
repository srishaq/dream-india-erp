// A project's own papers (Rafi Sir, 27 Nov 2026, for Dream Legacy Goregaon): land and title, DP remarks and survey,
// feasibility, approvals, legal, drawings, investors. Kept like customer documents (table customer_docs, owner_kind
// 'project', the file in the ERP's documents Drive, opened and uploaded in pieces through api/custdocs.js).
// A project may also have a shared Google Drive folder (settings 'project_docs_folders' { projectId: folderId }, the
// folder shared with the ERP's service account as Viewer): its files are copied in by section, once each
// (customer_docs.source_id), from the sub-folder they sit in ("02 DP remarks & survey/…"); a Google Doc is copied as a PDF.
const db = require('./db');
const gd = require('./gdrive');
const sheets = require('./sheets');
const CI = require('./custdocs-import');

const SECTIONS = ['Land & title', 'DP remarks & survey', 'Feasibility', 'Approvals (IOD, CC, RERA, NOCs)', 'Legal & agreements', 'Drawings & consultants', 'Investors & funding', 'Other'];
const TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
const GDOC = 'application/vnd.google-apps.document';
const MAX = 40 * 1024 * 1024;

// the section a file belongs to, from the folder it sits in (then its own name)
function sectionOf(names) {
  const t = names.join(' / ').toLowerCase();
  const by = [[/\b01\b|land|title|deed|7\/12|property card|sale cert/, 0], [/\b02\b|dp remark|survey|demarcation|zone/, 1], [/\b03\b|feasib/, 2], [/\b04\b|approv|iod|\bcc\b|rera|noc|\boc\b/, 3],
    [/\b05\b|legal|agreement|poa|affidavit/, 4], [/\b06\b|drawing|architect|consultant|structural|plan\b/, 5], [/\b07\b|investor|funding|buyback/, 6]];
  const hit = by.find(([re]) => re.test(t));
  return SECTIONS[hit ? hit[1] : 7];
}

async function folders() { const r = await db.one("select value from settings where key = 'project_docs_folders'"); return (r && r.value) || {}; }
async function folderOf(projectId) { return (await folders())[String(projectId)] || null; }
async function linkFolder(projectId, folderId) {
  const all = await folders(); if (folderId) all[String(projectId)] = folderId; else delete all[String(projectId)];
  await db.q("insert into settings (key, value) values ('project_docs_folders', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(all)]);
}

// the project's documents, newest first, with the counts by section
async function list(projectId) {
  const rows = await db.q(`select d.id, d.kind, d.title, d.file_name, d.mime, d.size, d.created_at, d.ready_at, x.name as by_name from customer_docs d left join users x on x.id = d.uploaded_by
    where d.owner_kind = 'project' and d.project_id = $1 and d.status = 'ready' order by d.kind, d.created_at desc`, [projectId]);
  return { rows, sections: SECTIONS, counts: Object.fromEntries(SECTIONS.map((s) => [s, rows.filter((r) => r.kind === s).length])) };
}

// what is in the shared folder and not yet in the ERP
async function plan(projectId) {
  const folder = await folderOf(projectId); if (!folder) return { available: false };
  const token = await sheets.accessToken(CI.SCOPE);
  const files = await CI.listFiles(token, folder);
  const done = new Set((await db.q("select source_id from customer_docs where source_id is not null")).map((r) => r.source_id));
  const out = { available: true, folder, total: files.length, already: 0, ready: [], skipped: [] };
  for (const f of files) {
    const sid = 'pd:' + f.id;
    if (done.has(sid)) { out.already++; continue; }
    const where = [...f.path, f.name].join(' / ');
    if (!TYPES[f.mimeType] && f.mimeType !== GDOC) { out.skipped.push({ name: where, why: 'not a PDF, photo, Office file or Google Doc' }); continue; }
    if (f.size > MAX) { out.skipped.push({ name: where, why: 'over 40 MB' }); continue; }
    out.ready.push({ id: f.id, sid, name: f.name, where, mime: f.mimeType, section: sectionOf([...f.path, f.name]) });
  }
  return out;
}

// copy the new files in, until the time is nearly up; run again for the rest
async function run(projectId, user, budgetMs = 40000) {
  const t0 = Date.now(), p = await plan(projectId); if (!p.available) return { available: false };
  const pj = await db.one('select id, name from projects where id = $1', [projectId]);
  const token = await sheets.accessToken(CI.SCOPE);
  const done = [], failed = [];
  for (const f of p.ready) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const gdoc = f.mime === GDOC;
      const buf = await CI.get(`${CI.API}/files/${encodeURIComponent(f.id)}${gdoc ? '/export?mimeType=application%2Fpdf' : '?alt=media&supportsAllDrives=true'}`, token, true);
      if (!buf.length) throw new Error('the file is empty');
      const mime = gdoc ? 'application/pdf' : f.mime;
      const fileName = (gdoc ? `${f.name}.pdf` : f.name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 160);
      const parent = await gd.folder(`projectdocs:${pj.id}`, `${pj.name} - Project documents`, `project:${pj.id}`, pj.name);
      const url = await gd.startUpload({ name: `${f.section.replace(/[:/]/g, ' -')} - ${fileName}`.slice(0, 200), mime, size: buf.length, parent });
      const r = await gd.putPart(url, buf, 0, buf.length);
      if (!r.done) throw new Error('Google Drive did not finish the copy');
      const row = await db.one(`insert into customer_docs (owner_kind, project_id, label, kind, title, file_name, mime, size, drive_file_id, received, status, uploaded_by, ready_at, source_id)
          values ('project', $1, $2, $3, $4, $5, $6, $7, $8, $7, 'ready', $9, now(), $10) on conflict do nothing returning id`,
        [pj.id, pj.name, f.section, `From the project folder: ${f.where}`.slice(0, 160), fileName, mime, buf.length, r.id, user ? user.id : null, f.sid]);
      if (row) done.push({ id: row.id, section: f.section, name: f.where });
    } catch (e) { failed.push({ name: f.where, why: e.message }); }
  }
  return { available: true, imported: done, failed, left: p.ready.length - done.length - failed.length, already: p.already + done.length, total: p.total, skipped: p.skipped };
}

module.exports = { SECTIONS, sectionOf, list, plan, run, folderOf, linkFolder };
