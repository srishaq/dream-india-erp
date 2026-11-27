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
// CAD drawings: Drive reports DWG / DXF under several types (or none); taken by the file name
const CAD = /\.(dwg|dxf)$/i;
const isDropBox = (n) => /drop ?box/i.test(String(n || ''));
const HOLD = 20 * 3600 * 1000;
const MAX = 90 * 1024 * 1024; // approved plan sheets and a scanned Annexure II run to 50-60 MB

// the section a file belongs to, from the folder it sits in (then its own name)
function sectionOf(names) {
  // a numbered folder ("02 DP remarks & survey") decides first; the number only counts at the start of a folder name, so a
  // date in a file name ("LOI - 13-03-2025") is not read as section 03
  const lead = names.slice(0, -1).map((n) => /^0([1-7])\b/.exec(String(n).trim())).find(Boolean);
  if (lead) return SECTIONS[+lead[1] - 1];
  const t = names.join(' / ').toLowerCase(), f = String(names[names.length - 1] || '').toLowerCase();
  const by = [[/dp remark|survey|demarcation|\bzone\b|swd remark|nalla remark/, 1], [/feasib/, 2],
    [/approv|\biod\b|\bioa\b|\bcc\b|rera|\bnoc\b|_noc|\boc\b|\bloi\b|annex|anx|\bec\b|environment|aviation|fire plan|fire_noc|registration ?certificate/, 3],
    [/title|sale deed|conveyance deed|7\/12|property card|pr card|sale cert/, 0], [/legal|agreement|poa|affidavit|partnership/, 4],
    [/drawing|architect|consultant|structural|plan\b|floor|area calc|carpet|buildup|terrace|parking|section/, 5], [/investor|funding|buyback/, 6]];
  const hit = by.find(([re]) => re.test(f)) || by.find(([re]) => re.test(t));
  return SECTIONS[hit ? hit[1] : 7];
}
// "Good Luck - Tenant Agreement / Shop 169 - Mohd Akram Chaudhary.pdf" → SRA tenant (annexure / survey no.) 169: a slum
// dweller's own agreement goes on that tenant's documents (the slum register), not in the project's papers
// which tenant paper a file is, from its name ("Shop 12 - KYC.pdf", "Shop 12 - Annexure II proof.pdf"); else the agreement
function tenantKind(name) {
  const t = String(name || '').toLowerCase();
  if (/kyc|pan\b|aadha|adhar|photo|voter|ration|passport/.test(t)) return 'KYC: PAN, Aadhaar, photo';
  if (/annex|eligib|proof|electric|bill|survey|photo pass|gumasta|licen/.test(t)) return 'Eligibility / annexure papers';
  if (/rent|receipt|cheque/.test(t)) return 'Rent receipt';
  if (/consent|affidavit|undertaking|noc\b/.test(t)) return 'Other';
  return 'Agreement (signed)';
}
function tenantOf(names) {
  if (!names.slice(0, -1).some((n) => /tenant|slum|dweller|hut/i.test(n))) return null;
  const m = /^(?:shop|hut|survey|annex\w*|sr\.?\s*no\.?)\s*(?:no\.?)?\s*-?\s*(\d{1,4})\b/i.exec(String(names[names.length - 1] || '').trim());
  return m ? +m[1] : null;
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
    // the team's drop box ("00 Drop box …", Rafi Sir 28 Nov 2026): a new file waits there to be sorted into its numbered
    // folder each morning, and comes in from there; one left unsorted for a day comes in by its own name
    if (f.path.some(isDropBox) && Date.now() - Date.parse(f.modifiedTime || 0) < HOLD) { out.skipped.push({ name: where, why: 'in the drop box, waiting to be sorted into its folder' }); continue; }
    if (!TYPES[f.mimeType] && f.mimeType !== GDOC && !CAD.test(f.name)) { out.skipped.push({ name: where, why: 'not a PDF, photo, Office file, CAD drawing or Google Doc' }); continue; }
    if (f.size > MAX) { out.skipped.push({ name: where, why: 'over 40 MB' }); continue; }
    out.ready.push({ id: f.id, sid, name: f.name, where, mime: f.mimeType, section: sectionOf([...f.path, f.name]), survey: tenantOf([...f.path, f.name]) });
  }
  return out;
}

// copy the new files in, until the time is nearly up; run again for the rest
async function run(projectId, user, budgetMs = 40000) {
  const t0 = Date.now(), p = await plan(projectId); if (!p.available) return { available: false };
  const pj = await db.one('select id, name, code from projects where id = $1', [projectId]);
  const book = require('./book').bookOfCode(pj.code);
  const tenants = new Map((await db.q('select id, survey_no, name from acc_sra_tenants where book = $1 and survey_no is not null', [book])).map((t) => [Number(t.survey_no), t]));
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
      const t = f.survey != null ? tenants.get(f.survey) : null;
      if (t) { // the tenant's own agreement: in "SRA Tenants / <no> - <name>", as the upload screen keeps it
        const parent = await gd.folder(`tenant:${t.id}`, `${Number(t.survey_no)} - ${t.name || 'tenant'}`, 'tenants', 'SRA Tenants');
        const kind = tenantKind(f.name);
        const url = await gd.startUpload({ name: `${kind.replace(/[:/]/g, ' -')} - ${fileName}`.slice(0, 200), mime, size: buf.length, parent });
        const r = await gd.putPart(url, buf, 0, buf.length);
        if (!r.done) throw new Error('Google Drive did not finish the copy');
        const row = await db.one(`insert into customer_docs (owner_kind, tenant_id, label, kind, title, file_name, mime, size, drive_file_id, received, status, uploaded_by, ready_at, source_id)
            values ('tenant', $1, $2, $10, $3, $4, $5, $6, $7, $6, 'ready', $8, now(), $9) on conflict do nothing returning id`,
          [t.id, `Survey ${Number(t.survey_no)} · ${t.name || ''}`.trim(), `From the project folder: ${f.where}`.slice(0, 160), fileName, mime, buf.length, r.id, user ? user.id : null, f.sid, kind]);
        if (row) done.push({ id: row.id, section: 'Slum register', tenant: Number(t.survey_no), name: f.where });
        continue;
      }
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

module.exports = { isDropBox, HOLD, SECTIONS, sectionOf, tenantOf, tenantKind, list, plan, run, folderOf, linkFolder };
