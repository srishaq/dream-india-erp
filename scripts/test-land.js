// Land and title (api/land.js, lib/land.js): parcels with area in any unit, deeds and status, land cost and payments
// to owners, title papers, the landowner's flats under a JDA, the Excel round trip and who may change it.
// DATABASE_URL=postgres://... node scripts/test-land.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3998';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
const X = require('../lib/xlsx');
const W = require('../lib/xlsx-write');
const db = require('../lib/db');

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
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HEAD = ['Tower / wing code', 'Tower name', 'Unit number', 'Floor', 'Type', 'Carpet area (sq ft)', 'Use', 'Status'];

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
  const twr = await mk({ code: 'TWR1', name: 'Demo Towers', state: 'Maharashtra', kind: 'new' });
  const other = await mk({ code: 'TWR2', name: 'Demo Two', state: 'Maharashtra', kind: 'new' });
  const save = (parcel) => api('/api/land', { project: twr.id, action: 'save', parcel });
  const find = (r, s) => r.parcels.find((x) => x.survey_no === s);

  let a;
  await step('a parcel is added with its area in acres, shown in square metres too; mistakes are refused in plain words', async () => {
    assert.match((await save({ survey_no: '' })).error, /survey/);
    assert.match((await save({ survey_no: '12', area: 'big' })).error, /area should be a number/);
    assert.match((await save({ survey_no: '12', cost: 'lots' })).error, /Land cost should be an amount/);
    assert.match((await save({ survey_no: '12', deal: 'jda', share_type: 'area', share_pct: 140 })).error, /between 0 and 100/);
    const r = await save({ survey_no: '112/2A', village: 'Demo Gaon', area: '2.5', area_unit: 'acre', owners: 'R. Patil, S. Patil', deal: 'purchase', status: 'registered', deal_date: '2024-05-10', deed_ref: '4567/2024', cost: '4,50,00,000', stamp_duty: 2700000, registration_fee: 30000 });
    assert.equal(r.status, 200, r.error); assert.equal(r.canEdit, true);
    a = find(r, '112/2A'); assert.equal(a.sqm, 10117.14); assert.equal(a.cost, 45000000); assert.equal(a.total, 47730000); assert.equal(a.balance, 45000000);
    assert.deepEqual(a.missing, ['title search report', '7/12 or land record']);
    assert.equal(r.summary.acres, 2.5); assert.equal(r.summary.registered, 1);
    assert.equal((await save({ survey_no: '112/2a', village: 'demo gaon' })).status, 409, 'the same survey number twice');
  });

  await step('payments to the owners bring the balance down; a payment needs its UTR or cheque number', async () => {
    assert.match((await api('/api/land', { project: twr.id, action: 'pay', parcel: a.id, paid_on: '2024-05-10', amount: 1000000, mode: 'neft' })).error, /UTR or cheque/);
    assert.match((await api('/api/land', { project: twr.id, action: 'pay', parcel: a.id, paid_on: '2999-01-01', amount: 1, mode: 'cash' })).error, /after today/);
    let r = await api('/api/land', { project: twr.id, action: 'pay', parcel: a.id, paid_on: '2024-05-10', amount: '2,00,00,000', mode: 'rtgs', ref: 'UTR123', payee: 'R. Patil' });
    assert.equal(r.status, 200, r.error);
    r = await api('/api/land', { project: twr.id, action: 'pay', parcel: a.id, paid_on: '2024-08-01', amount: 15000000, mode: 'cheque', ref: '004512' });
    a = find(r, '112/2A'); assert.equal(a.paid, 35000000); assert.equal(a.balance, 10000000); assert.equal(r.summary.paid, 35000000);
    r = await api('/api/land', { project: twr.id, action: 'unpay', id: a.payments[1].id });
    assert.equal(find(r, '112/2A').paid, 20000000);
    assert.equal((await api('/api/land', { project: twr.id, action: 'delete', id: a.id })).status, 409, 'a parcel with payments stays');
  });

  await step('title papers are kept with the parcel and close its gaps', async () => {
    assert.equal((await api('/api/land', { project: twr.id, action: 'file.add', parcel: a.id, file: { name: 'x.txt', data: Buffer.from('hi').toString('base64') } })).status, 400);
    await api('/api/land', { project: twr.id, action: 'file.add', parcel: a.id, file: { name: 'Search report.pdf', kind: 'title', data: PDF.toString('base64') } });
    const r = await api('/api/land', { project: twr.id, action: 'file.add', parcel: a.id, file: { name: '7-12.pdf', kind: 'record', data: PDF.toString('base64') } });
    a = find(r, '112/2A'); assert.equal(a.files.length, 2); assert.deepEqual(a.missing, []); assert.equal(r.summary.gaps, 0);
    const f = await api(`/api/land?project=${twr.id}&file=${a.files[0].id}`); assert.ok(Buffer.from(f.data, 'base64').equals(PDF));
    assert.equal((await api(`/api/land?project=${other.id}&file=${a.files[0].id}`)).status, 404, 'not from another project');
  });

  await step('a JDA parcel: the landowner\'s flats are set aside, kept blocked, and released again', async () => {
    let r = await save({ survey_no: '113', area: 4000, area_unit: 'sqm', owners: 'M. Shaikh', deal: 'jda', status: 'agreement', share_type: 'area', share_pct: 35 });
    const j = find(r, '113'); assert.equal(j.share_pct, 35);
    const bid = (await db.one("insert into buildings (project_id, code, name, kind) values ($1, 'A', 'A Wing', 'sale') returning id", [twr.id])).id;
    for (const [no, t, c] of [['A-101', '2 BHK', 630], ['A-102', '2 BHK', 630], ['A-103', '1 BHK', 410]]) await db.q("insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft) values ($1, $2, $3, 1, $4, $5)", [twr.id, bid, no, t, c]);
    r = await api('/api/land?project=' + twr.id); assert.equal(r.free.length, 3);
    assert.equal((await api('/api/land', { project: twr.id, action: 'share', parcel: a.id, units: [r.free[0].id] })).status, 400, 'not a JDA parcel');
    r = await api('/api/land', { project: twr.id, action: 'share', parcel: j.id, units: r.free.slice(0, 2).map((u) => u.id), owner: 'M. Shaikh' });
    assert.equal(r.status, 200, r.error);
    const jj = find(r, '113'); assert.deepEqual(jj.units.map((u) => u.unit_no), ['A-101', 'A-102']); assert.equal(r.free.length, 1); assert.equal(r.summary.ownerUnits, 2);
    const st = await db.q("select unit_no, status, hold_note from units where unit_no in ('A-101', 'A-102') order by unit_no");
    assert.ok(st.every((u) => u.status === 'blocked' && /Landowner share: M\. Shaikh/.test(u.hold_note)));
    assert.equal((await api('/api/land', { project: twr.id, action: 'share', parcel: j.id, units: [jj.units[0].unit_id] })).status, 409, 'already set aside');
    assert.equal((await save({ id: j.id, survey_no: '113', deal: 'purchase' })).status, 409, 'cannot drop the JDA while flats are set aside');
    r = await api('/api/land', { project: twr.id, action: 'unshare', id: jj.units[1].id });
    assert.equal(find(r, '113').units.length, 1); assert.equal(r.free.length, 2);
    assert.equal((await db.one("select status from units where unit_no = 'A-102'")).status, 'available');
  });

  await step('Excel: download, fill in, upload; rows update by survey number and a bad row stops the file', async () => {
    const x = await api(`/api/land?project=${twr.id}&excel=1`);
    const rows = X.read(Buffer.from(x.data, 'base64'))[0].rows.map((r) => r.slice());
    assert.equal(rows[0][0], 'Survey / CTS number'); assert.equal(rows.length, 3);
    rows.find((r) => r[0] === '112/2A')[2] = 'Demo Taluka';
    rows.push(['115/1', 'Demo Gaon', '', '', '20', 'guntha', 'K. Jadhav', 'Bought (sale deed)', 'Agreement signed', '01-03-2025', '', '9000000', '', '', '', '']);
    const bad = rows.map((r) => r.slice()); bad[3][5] = 'bigha';
    const b = await api('/api/land', { project: twr.id, action: 'import', file: { name: 'l.xlsx', data: W.write([{ name: 'Land', rows: bad }]).toString('base64') } });
    assert.equal(b.status, 400); assert.match(b.problems[0], /area unit "bigha"/);
    const r = await api('/api/land', { project: twr.id, action: 'import', file: { name: 'l.xlsx', data: W.write([{ name: 'Land', rows }]).toString('base64') } });
    assert.equal(r.status, 200, r.error); assert.deepEqual(r.imported, { added: 1, updated: 2 });
    assert.equal(find(r, '112/2A').taluka, 'Demo Taluka'); assert.equal(find(r, '112/2A').paid, 20000000, 'payments kept');
    assert.equal(find(r, '113').units.length, 1, 'landowner flats kept'); assert.equal(find(r, '115/1').deal_date, '2025-03-01'); assert.equal(find(r, '115/1').sqm, 2023.43);
  });

  await step('Head Accounts may record land, a viewer only looks', async () => {
        const ha = await loginAs('hacc', 'head_accounts', [twr.id]);
    const r = await ha('/api/land', { project: twr.id, action: 'pay', parcel: a.id, paid_on: '2025-01-05', amount: 500000, mode: 'neft', ref: 'UTR9' });
    assert.equal(r.status, 200, r.error); assert.equal(r.canEdit, true);
    const w = await loginAs('view1', 'accounts', [twr.id]);
    const g = await w('/api/land?project=' + twr.id); assert.equal(g.status, 200, g.error); assert.equal(g.canEdit, false);
    assert.equal((await w('/api/land', { project: twr.id, action: 'save', parcel: { survey_no: '200' } })).status, 403);
    const s1 = await loginAs('sales1', 'sales', [twr.id]);
    assert.equal((await s1('/api/land?project=' + twr.id)).status, 403);
    const au = await api('/api/audit?entity=land');
    for (const act of ['create', 'paid', 'payment-removed', 'file-added', 'landowner-share', 'landowner-release', 'import']) assert.ok(au.rows.some((x) => x.action === act), act);
  });

  console.log(`Land and title: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
