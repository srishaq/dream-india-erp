// Approvals dashboard: every permission a project needs, in one place (Annexure II, LOI, IOA/IOD, CC, RERA, OC and the
// NOCs), with its status, dates, reference number and the approval letters themselves.
// The list each project starts with comes from its type and state (CATALOG below); a builder adds any other approval
// it needs. Nothing is saved for an approval until someone fills it in.
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
// an int[] column comes back from the driver as text ("{1,2}")
const ints = (v) => (Array.isArray(v) ? v.map(Number) : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const STAGES = [
  ['land', 'Land and title'],
  ['plan', 'Scheme and plans'],
  ['build', 'Building permissions'],
  ['rera', 'RERA'],
  ['noc', 'Environment and NOCs'],
  ['done', 'Completion'],
  ['other', 'Other approvals'],
];
const STATUS = { not_started: 'Not applied', applied: 'Applied', query: 'Query raised', received: 'Received', not_needed: 'Not needed' };

// [key, title, stage, authority, has a validity date]
const COMMON_NOC = [
  ['ec', 'Environment clearance', 'noc', 'SEIAA / MoEF', true],
  ['fire', 'Fire NOC', 'noc', 'Chief Fire Officer'],
  ['tree', 'Tree authority NOC', 'noc', 'Tree authority'],
  ['height', 'Height NOC (civil aviation)', 'noc', 'AAI'],
  ['water', 'Water and drainage NOC', 'noc', 'Municipal hydraulic / sewerage department'],
];
const CATALOG = {
  sra: [
    ['slum_decl', 'Slum declaration', 'land', 'Competent Authority'],
    ['society', 'Slum dwellers\' society registered', 'land', 'Registrar of co-operative societies'],
    ['dev_appoint', 'Developer appointed by the society', 'land', 'Society general body'],
    ['annex2', 'Annexure II (certified eligibility list)', 'plan', 'Competent Authority'],
    ['loi', 'LOI (Letter of Intent)', 'plan', 'Slum Rehabilitation Authority', true],
    ['loi_rev', 'Revised LOI', 'plan', 'Slum Rehabilitation Authority'],
    ['ioa_rehab', 'IOA: rehab building', 'build', 'Slum Rehabilitation Authority'],
    ['ioa_sale', 'IOA: sale building', 'build', 'Slum Rehabilitation Authority'],
    ['cc_rehab_plinth', 'CC: rehab building up to plinth', 'build', 'Slum Rehabilitation Authority'],
    ['cc_rehab_full', 'CC: rehab building, full height', 'build', 'Slum Rehabilitation Authority'],
    ['cc_sale_plinth', 'CC: sale building up to plinth', 'build', 'Slum Rehabilitation Authority'],
    ['cc_sale_full', 'CC: sale building, full height', 'build', 'Slum Rehabilitation Authority'],
    ['rera', 'RERA registration (sale building)', 'rera', 'RERA', true],
    ...COMMON_NOC,
    ['oc_rehab', 'OC: rehab building', 'done', 'Slum Rehabilitation Authority'],
    ['oc_sale', 'OC: sale building', 'done', 'Slum Rehabilitation Authority'],
    ['bcc', 'Building completion certificate', 'done', 'Slum Rehabilitation Authority'],
  ],
  redevelopment: [
    ['gb_resolution', 'Society general body resolution', 'land', 'Society'],
    ['dev_agreement', 'Development agreement registered', 'land', 'Sub-registrar'],
    ['s79a', 'Section 79A order / Deputy Registrar\'s approval', 'land', 'Deputy Registrar'],
    ['iod', 'IOD / IOA (plan approval)', 'build', 'Municipal building proposal department'],
    ['cc_plinth', 'CC up to plinth', 'build', 'Municipal building proposal department'],
    ['cc_full', 'CC, full height', 'build', 'Municipal building proposal department'],
    ['rera', 'RERA registration', 'rera', 'RERA', true],
    ...COMMON_NOC,
    ['oc', 'OC (occupation certificate)', 'done', 'Municipal building proposal department'],
    ['bcc', 'Building completion certificate', 'done', 'Municipal building proposal department'],
  ],
  new: [
    ['title', 'Title search report', 'land', 'Advocate'],
    ['na', 'NA order (land use conversion)', 'land', 'Collector'],
    ['zone', 'Zone certificate', 'land', 'Town planning'],
    ['iod', 'IOD / building plan approval', 'build', 'Planning authority'],
    ['cc_plinth', 'CC up to plinth', 'build', 'Planning authority'],
    ['cc_full', 'CC, full height', 'build', 'Planning authority'],
    ['rera', 'RERA registration', 'rera', 'RERA', true],
    ...COMMON_NOC,
    ['oc', 'OC (occupation certificate)', 'done', 'Planning authority'],
    ['bcc', 'Building completion certificate', 'done', 'Planning authority'],
  ],
  plotted: [
    ['title', 'Title search report', 'land', 'Advocate'],
    ['na', 'NA / land use conversion', 'land', 'Collector'],
    ['layout', 'Layout approval', 'plan', 'Town planning'],
    ['layout_final', 'Final layout / layout release', 'plan', 'Town planning'],
    ['rera', 'RERA registration', 'rera', 'RERA', true],
    ['ec', 'Environment clearance', 'noc', 'SEIAA / MoEF', true],
    ['roads', 'Roads and drainage handed over / NOC', 'noc', 'Local body'],
    ['power', 'Electricity NOC', 'noc', 'Electricity board'],
    ['completion', 'Layout completion certificate', 'done', 'Town planning'],
  ],
};

const catalogFor = (p) => (CATALOG[p.kind] || CATALOG.new).map(([key, title, stage, authority, validity]) => ({ key, title, stage, authority, validity: !!validity }));

async function project(id) {
  const p = await db.one('select id, code, name, kind, state, scheme, rera_no, active, approval_flow from projects where id = $1', [+id || 0]);
  if (!p || !p.active) throw fail(404, 'This project is not in the ERP.');
  return p;
}

// Every approval of the project: the catalog's, each with what has been saved for it, then the ones added by hand.
async function view(p, q = db.q) {
  const rows = await q('select * from project_approvals where project_id = $1 order by id', [p.id]);
  const files = await q('select f.id, f.approval_id, f.name, f.type, f.size, f.created_at from project_approval_files f join project_approvals a on a.id = f.approval_id where a.project_id = $1 order by f.id', [p.id]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  // the letters already in the project's documents (Project documents), linked to an approval
  const ids = [...new Set(rows.flatMap((r) => ints(r.doc_ids)))];
  const docs = ids.length ? await q("select id, title, file_name, size from customer_docs where id = any($1::int[]) and owner_kind = 'project' and project_id = $2 and status = 'ready'", [ids, p.id]) : [];
  const docOf = Object.fromEntries(docs.map((x) => [x.id, { id: x.id, name: x.file_name, size: +x.size || 0 }]));
  const d = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const t = today(), soon = new Date(Date.now() + 330 * 60000 + 60 * 86400000).toISOString().slice(0, 10);
  const one = (c, r) => {
    const x = { key: c.key, title: (r && r.title) || c.title, stage: (r && r.stage) || c.stage, authority: r ? r.authority || '' : c.authority || '', validity: c.validity || !!(r && r.valid_till), custom: !!(r && r.custom),
      id: r ? r.id : null, status: r ? r.status : 'not_started', ref_no: r ? r.ref_no || '' : '', applied_on: d(r && r.applied_on), received_on: d(r && r.received_on), valid_till: d(r && r.valid_till), remark: r ? r.remark || '' : '',
      files: r ? files.filter((f) => f.approval_id === r.id).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })) : [],
      docs: r ? ints(r.doc_ids).map((i) => docOf[i]).filter(Boolean) : [], step_key: r ? r.step_key || null : null };
    x.alert = x.status === 'received' && x.valid_till ? (x.valid_till < t ? 'expired' : x.valid_till <= soon ? 'expiring' : '') : '';
    return x;
  };
  const cat = catalogFor(p);
  const list = cat.map((c) => one(c, byKey[c.key])).concat(rows.filter((r) => !cat.some((c) => c.key === r.key)).map((r) => one({ key: r.key, title: r.title, stage: r.stage, authority: r.authority }, r)));
  const needed = list.filter((x) => x.status !== 'not_needed');
  const n = (s) => needed.filter((x) => x.status === s).length;
  return {
    project: { id: p.id, name: p.name, kind: p.kind, state: p.state, scheme: p.scheme, rera_no: p.rera_no },
    stages: STAGES, labels: STATUS, list,
    summary: { total: needed.length, received: n('received'), applied: n('applied'), query: n('query'), not_started: n('not_started'), expiring: list.filter((x) => x.alert === 'expiring').length, expired: list.filter((x) => x.alert === 'expired').length },
  };
}

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
function date(v, label, notFuture) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw fail(400, `${label}: give the date as day, month and year.`);
  if (notFuture && s > today()) throw fail(400, `${label} cannot be after today.`);
  return s;
}

// Saves one approval (a catalog one by its key, or one added by hand). Returns { before, after }.
async function save(t, u, p, x) {
  const cat = catalogFor(p).find((c) => c.key === x.key);
  const old = x.key ? await t.one('select * from project_approvals where project_id = $1 and key = $2', [p.id, String(x.key)]) : null;
  if (x.key && !cat && !old) throw fail(404, 'That approval is not in this project.');
  const custom = !cat;
  const title = custom ? str(x.title, 120) : cat.title;
  if (!title) throw fail(400, 'Give the approval a name.');
  const status = x.status == null ? (old ? old.status : 'not_started') : String(x.status);
  if (!STATUS[status]) throw fail(400, 'Choose a status.');
  const v = {
    status, title,
    stage: custom ? (STAGES.some((s) => s[0] === x.stage) ? x.stage : (old && old.stage) || 'other') : cat.stage,
    authority: str(x.authority != null ? x.authority : old ? old.authority : cat ? cat.authority : '', 120) || null,
    ref_no: str(x.ref_no, 80) || null,
    applied_on: date(x.applied_on, 'Applied on', true),
    received_on: date(x.received_on, 'Received on', true),
    valid_till: date(x.valid_till, 'Valid till'),
    remark: str(x.remark, 500) || null,
  };
  if (status === 'received' && !v.received_on) throw fail(400, 'Give the date the approval was received.');
  if (v.applied_on && v.received_on && v.received_on < v.applied_on) throw fail(400, 'Received on cannot be before the date it was applied for.');
  if (old) {
    const after = await t.one('update project_approvals set title = $3, stage = $4, authority = $5, status = $6, ref_no = $7, applied_on = $8, received_on = $9, valid_till = $10, remark = $11, updated_by = $12, updated_at = now() where id = $1 and project_id = $2 returning *',
      [old.id, p.id, v.title, v.stage, v.authority, v.status, v.ref_no, v.applied_on, v.received_on, v.valid_till, v.remark, u.id]);
    if (x.step_key) after.step_key = (await t.one('update project_approvals set step_key = $2 where id = $1 returning step_key', [after.id, String(x.step_key).slice(0, 20)])).step_key;
    return { before: old, after };
  }
  const key = custom ? 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : cat.key;
  const after = await t.one('insert into project_approvals (project_id, key, title, stage, authority, status, ref_no, applied_on, received_on, valid_till, remark, custom, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *',
    [p.id, key, v.title, v.stage, v.authority, v.status, v.ref_no, v.applied_on, v.received_on, v.valid_till, v.remark, custom, u.id]);
  if (x.step_key) after.step_key = (await t.one('update project_approvals set step_key = $2 where id = $1 returning step_key', [after.id, String(x.step_key).slice(0, 20)])).step_key;
  return { before: null, after };
}

// Points an approval at letters already in the project's documents (no copy is made). Returns { before, after }.
async function linkDocs(t, u, p, key, docIds) {
  const want = [...new Set((Array.isArray(docIds) ? docIds : []).map((x) => +x).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 30);
  const ok = want.length ? (await t.q("select id from customer_docs where id = any($1::int[]) and owner_kind = 'project' and project_id = $2 and status = 'ready'", [want, p.id])).map((r) => r.id) : [];
  if (ok.length !== want.length) throw fail(400, 'Some of those documents are not in this project\'s documents.');
  let a = await t.one('select * from project_approvals where project_id = $1 and key = $2', [p.id, String(key || '')]);
  if (!a) a = (await save(t, u, p, { key })).after;
  const after = await t.one('update project_approvals set doc_ids = $2::int[], updated_by = $3, updated_at = now() where id = $1 returning *', [a.id, want, u.id]);
  return { before: a, after };
}
// The project's documents an approval can point to, newest first
async function projectDocs(p) {
  return db.q("select id, kind, title, file_name, size, created_at from customer_docs where owner_kind = 'project' and project_id = $1 and status = 'ready' order by kind, file_name", [p.id]);
}

// An approval letter or drawing: PDF or picture, up to 3 MB (kept with the approval).
const FILE_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' };
function file(f) {
  const data = String((f && f.data) || '');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw fail(400, 'Choose a file.');
  if (buf.length > 3 * 1024 * 1024) throw fail(400, 'The file is larger than 3 MB. Please scan it at a lower resolution or split it.');
  const type = buf.slice(0, 4).toString() === '%PDF' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(1, 4).toString() === 'PNG' ? 'image/png' : null;
  if (!type) throw fail(400, 'Upload a PDF, JPG or PNG.');
  return { name: str(f.name, 120) || 'approval.' + FILE_TYPES[type].toLowerCase(), type, size: buf.length, data: buf.toString('base64') };
}

// ---------- Excel ----------
const HEAD = ['Approval', 'Status', 'Authority', 'Reference number', 'Applied on', 'Received on', 'Valid till', 'Remark'];
async function sheet(p) {
  const v = await view(p);
  const rows = v.list.map((x) => [x.title, STATUS[x.status], x.authority, x.ref_no, x.applied_on || '', x.received_on || '', x.valid_till || '', x.remark]);
  return require('./xlsx-write').write([
    { name: 'Approvals', rows: [HEAD, ...rows], widths: [44, 14, 30, 22, 13, 13, 13, 40] },
    { name: 'How to fill', rows: [['Column', 'What to write'], ['Approval', 'Keep the names as they are. A new name adds an approval of your own.'], ['Status', Object.values(STATUS).join(', ')], ['Dates', 'Day-month-year (20-11-2026) or year-month-day (2026-11-20)'], ['Valid till', 'For approvals that expire, such as RERA registration or environment clearance'], [], ['', 'Upload the file on the Approvals screen. Every row is checked first; approval letters are added on the screen.']], widths: [16, 90] },
  ]);
}
const STATUS_IN = Object.fromEntries(Object.entries(STATUS).flatMap(([k, l]) => [[k, k], [l.toLowerCase(), k]]).concat([['pending', 'not_started'], ['done', 'received'], ['approved', 'received'], ['granted', 'received'], ['na', 'not_needed'], ['n/a', 'not_needed']]));
function dateIn(v) {
  const s = String(v || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s; // left for save() to refuse in words
}
// Checks an uploaded sheet: each row matched to an approval by its name. Throws, with every problem, before saving any.
async function importRows(t, u, p, rows) {
  if (!rows.length || String(rows[0][0] || '').trim().toLowerCase() !== 'approval') throw fail(400, 'The first row must be the column names from the template. Download the Excel from this screen and fill that in.');
  const v = await view(p, t.q); // inside the transaction: its own connection
  const todo = [], problems = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c == null ? '' : c).trim());
    if (!r[0]) continue;
    const st = r[1] ? STATUS_IN[r[1].toLowerCase()] : 'not_started';
    if (!st) { problems.push(`Row ${i + 1} (${r[0]}): status "${r[1]}" is not one of ${Object.values(STATUS).join(', ')}`); continue; }
    const have = v.list.find((x) => x.title.toLowerCase() === r[0].toLowerCase());
    const x = { key: have ? have.key : null, title: r[0], status: st, authority: r[2], ref_no: r[3], applied_on: dateIn(r[4]), received_on: dateIn(r[5]), valid_till: dateIn(r[6]), remark: r[7] };
    if (have && !have.id && st === 'not_started' && !r[3] && !r[4] && !r[5] && !r[6] && !r[7] && (!r[2] || r[2] === have.authority)) continue; // an untouched template row
    todo.push({ row: i + 1, x });
  }
  let saved = 0;
  for (const { row, x } of todo) {
    try { await save(t, u, p, x); saved++; } catch (e) { if (!e.status) throw e; problems.push(`Row ${row} (${x.title}): ${e.message}`); }
  }
  if (problems.length) throw Object.assign(fail(400, `${problems.length} row${problems.length === 1 ? ' has a problem' : 's have problems'}. Nothing was saved. Fix ${problems.length === 1 ? 'it' : 'them'} in Excel and upload again.`), { extra: { problems } });
  return { saved };
}

module.exports = { linkDocs, projectDocs, STAGES, STATUS, CATALOG, catalogFor, project, view, save, file, sheet, importRows };
