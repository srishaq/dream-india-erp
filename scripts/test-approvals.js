// Approvals dashboard (api/approvals.js, lib/approvals.js): the standard list per project type, saving status and
// dates, approvals added by hand, letters kept with them, validity alerts, the Excel round trip and who may change it.
// DATABASE_URL=postgres://... node scripts/test-approvals.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
const X = require('../lib/xlsx');
const W = require('../lib/xlsx-write');

function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const day = (k) => new Date(Date.now() + 330 * 60000 + k * 86400000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const db = require('../lib/db');
  const mk = async (x) => db.one("insert into projects (code, name, company_id, kind, state) select $1, $2, company_id, $3, $4 from projects where code = 'SIGNATURE' returning id, code, name", [x.code, x.name, x.kind || 'new', x.state || 'Maharashtra']);
  const loginAs = async (username, role, projects) => {
    const id = (await db.one("insert into users (username, name, role, password_hash, all_projects, must_change) values ($1, $1, $2, $3, false, false) returning id", [username, role, require('../lib/auth').hashPassword('pass-word-1234')])).id;
    for (const p of projects) await db.q('insert into user_projects (user_id, project_id) values ($1, $2)', [id, p]);
    const c = client(); await c('/api/session', { action: 'login', username, password: 'pass-word-1234' }); return c;
  };
  const sra = await mk({ code: 'SRA1', name: 'Demo Nagar SRA', state: 'Maharashtra', kind: 'sra' });
  const twr = await mk({ code: 'TWR1', name: 'Demo Towers', state: 'Maharashtra', kind: 'new' });
  const plots = await mk({ code: 'PLT1', name: 'Demo Plots', state: 'Telangana', kind: 'plotted' });
  const save = (approval, project = sra.id) => api('/api/approvals', { project, action: 'save', approval });
  const find = (r, k) => r.list.find((x) => x.key === k);

  await step('each project type starts with its own list: SRA has Annexure II, LOI and IOA; new development has IOD; plotted has layout approval', async () => {
    const s = await api('/api/approvals?project=' + sra.id);
    assert.equal(s.status, 200, s.error); assert.equal(s.canEdit, true);
    for (const k of ['annex2', 'loi', 'ioa_rehab', 'ioa_sale', 'cc_sale_plinth', 'rera', 'oc_sale']) assert.ok(find(s, k), k);
    assert.ok(s.list.every((x) => x.status === 'not_started' && !x.id)); assert.equal(s.summary.received, 0); assert.equal(s.summary.total, s.list.length);
    const t = await api('/api/approvals?project=' + twr.id); assert.ok(find(t, 'iod') && find(t, 'na') && !find(t, 'loi'));
    const p = await api('/api/approvals?project=' + plots.id); assert.ok(find(p, 'layout') && !find(p, 'cc_full'));
  });

  await step('status and dates are saved and checked in plain words', async () => {
    assert.match((await save({ key: 'loi', status: 'received' })).error, /date the approval was received/);
    assert.match((await save({ key: 'loi', status: 'applied', applied_on: day(5) })).error, /cannot be after today/);
    assert.match((await save({ key: 'loi', status: 'received', applied_on: '2025-06-10', received_on: '2025-05-01' })).error, /cannot be before/);
    assert.equal((await save({ key: 'nope', status: 'applied' })).status, 404);
    let r = await save({ key: 'annex2', status: 'received', applied_on: '2024-01-10', received_on: '2024-08-02', ref_no: 'SRA/ANX/112' });
    assert.equal(r.status, 200, r.error); assert.equal(find(r, 'annex2').status, 'received'); assert.equal(find(r, 'annex2').received_on, '2024-08-02');
    r = await save({ key: 'loi', status: 'query', applied_on: '2025-06-10', remark: 'Society resolution asked for' });
    assert.equal(find(r, 'loi').status, 'query'); assert.equal(r.summary.query, 1); assert.equal(r.summary.received, 1);
    r = await save({ key: 'height', status: 'not_needed' });
    assert.equal(r.summary.total, r.list.length - 1, 'not needed is left out of the count');
  });

  await step('validity: RERA expiring within 60 days and an expired clearance are flagged', async () => {
    let r = await save({ key: 'rera', status: 'received', received_on: '2023-01-15', valid_till: day(30), ref_no: 'P51800012345' });
    assert.equal(find(r, 'rera').alert, 'expiring');
    r = await save({ key: 'ec', status: 'received', received_on: '2020-01-15', valid_till: day(-1) });
    assert.equal(find(r, 'ec').alert, 'expired'); assert.equal(r.summary.expiring, 1); assert.equal(r.summary.expired, 1);
  });

  await step('an approval of your own is added, edited and removed; a standard one cannot be removed', async () => {
    let r = await save({ title: 'Railway NOC', stage: 'noc', status: 'applied', applied_on: '2025-09-01', authority: 'Central Railway' });
    assert.equal(r.status, 200, r.error);
    const c = r.list.find((x) => x.title === 'Railway NOC'); assert.ok(c.custom); assert.equal(c.stage, 'noc');
    r = await save({ key: c.key, title: 'Railway NOC (Western)', status: 'received', received_on: '2025-10-01' });
    assert.equal(find(r, c.key).title, 'Railway NOC (Western)');
    assert.equal((await save({ title: '', status: 'applied' })).status, 400);
    assert.equal((await api('/api/approvals', { project: sra.id, action: 'remove', key: 'loi' })).status, 409);
    r = await api('/api/approvals', { project: sra.id, action: 'remove', key: c.key }); assert.equal(r.status, 200, r.error); assert.equal(find(r, c.key), undefined);
  });

  await step('approval letters: a PDF is kept with the approval and opened again; other files and big files are refused', async () => {
    assert.equal((await api('/api/approvals', { project: sra.id, action: 'file.add', key: 'ioa_sale', file: { name: 'x.txt', data: Buffer.from('hello').toString('base64') } })).status, 400);
    assert.equal((await api('/api/approvals', { project: sra.id, action: 'file.add', key: 'ioa_sale', file: { name: 'big.pdf', data: Buffer.concat([PDF, Buffer.alloc(3.1 * 1024 * 1024)]).toString('base64') } })).status, 400);
    const r = await api('/api/approvals', { project: sra.id, action: 'file.add', key: 'ioa_sale', file: { name: 'IOA sale building.pdf', data: PDF.toString('base64') } });
    assert.equal(r.status, 200, r.error);
    const a = find(r, 'ioa_sale'); assert.ok(a.id, 'the approval got its row with its first letter'); assert.equal(a.files.length, 1); assert.equal(a.files[0].type, 'application/pdf');
    const f = await api(`/api/approvals?project=${sra.id}&file=${a.files[0].id}`);
    assert.equal(f.name, 'IOA sale building.pdf'); assert.ok(Buffer.from(f.data, 'base64').equals(PDF));
    assert.equal((await api(`/api/approvals?project=${twr.id}&file=${a.files[0].id}`)).status, 404, 'not from another project');
    const g = await api('/api/approvals', { project: sra.id, action: 'file.remove', id: a.files[0].id }); assert.equal(find(g, 'ioa_sale').files.length, 0);
  });

  await step('Excel: download the list, fill it in, upload it; a bad row stops the whole file', async () => {
    const x = await api(`/api/approvals?project=${twr.id}&excel=1`);
    const rows = X.read(Buffer.from(x.data, 'base64'))[0].rows;
    assert.deepEqual(rows[0].slice(0, 3), ['Approval', 'Status', 'Authority']);
    const up = rows.map((r) => r.slice());
    up.find((r) => r[0] === 'IOD / building plan approval').splice(1, 6, 'Received', 'Planning authority', 'CHE/WS/1234', '01-02-2025', '15-04-2025', '');
    up.find((r) => r[0] === 'RERA registration').splice(1, 6, 'Applied', 'RERA', '', '2025-10-01', '', '');
    up.push(['Railway NOC', 'Applied', 'Central Railway', '', '10/09/2025', '', '', '']);
    const bad = up.map((r) => r.slice()); bad.find((r) => r[0] === 'Fire NOC')[1] = 'Maybe';
    const b = await api('/api/approvals', { project: twr.id, action: 'import', file: { name: 'a.xlsx', data: W.write([{ name: 'Approvals', rows: bad }]).toString('base64') } });
    assert.equal(b.status, 400); assert.match(b.problems[0], /Fire NOC.*"Maybe"/);
    assert.equal((await api('/api/approvals?project=' + twr.id)).summary.received, 0, 'nothing saved');
    const r = await api('/api/approvals', { project: twr.id, action: 'import', file: { name: 'a.xlsx', data: W.write([{ name: 'Approvals', rows: up }]).toString('base64') } });
    assert.equal(r.status, 200, r.error); assert.equal(r.imported.saved, 3);
    assert.equal(find(r, 'iod').received_on, '2025-04-15'); assert.equal(find(r, 'iod').ref_no, 'CHE/WS/1234'); assert.equal(find(r, 'rera').status, 'applied');
    assert.ok(r.list.some((y) => y.title === 'Railway NOC' && y.custom && y.applied_on === '2025-09-10'));
  });

  await step('every project\'s summary is listed for the dashboards', async () => {
    const all = await api('/api/approvals?all=1');
    const s = all.projects.find((p) => p.project.id === sra.id);
    assert.equal(s.summary.received, 3); assert.deepEqual(s.alerts.map((a) => a.alert).sort(), ['expired', 'expiring', 'query']);
  });

  await step('a sales login may not see approvals; a view-only login sees but cannot change; every change is in the audit log', async () => {
    const s = await loginAs('sales1', 'sales', [sra.id]);
    assert.equal((await s('/api/approvals?project=' + sra.id)).status, 403);
    const w = await loginAs('view1', 'accounts', [sra.id]);
    const r = await w('/api/approvals?project=' + sra.id); assert.equal(r.status, 200, r.error); assert.equal(r.canEdit, false);
    assert.equal((await w('/api/approvals', { project: sra.id, action: 'save', approval: { key: 'oc_sale', status: 'applied' } })).status, 403);
    assert.equal((await w('/api/approvals?project=' + twr.id)).status, 403, 'not in that project');
    const a = await api('/api/audit?entity=approval');
    for (const act of ['create', 'update', 'delete', 'file-added', 'file-removed', 'import']) assert.ok(a.rows.some((x) => x.action === act), act);
  });

  console.log(`Approvals: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
