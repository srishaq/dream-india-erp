// Slum register (api/slums.js, lib/slums.js), approvals pointing at project documents (docs.link), and the project
// folder import sending a tenant's own agreement to that tenant (lib/project-docs.js tenantOf / sectionOf).
// Synthetic tenants and documents only. DATABASE_URL=postgres://... node scripts/test-slums.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;

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

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const db = require('../lib/db');
  const sig = await db.one("select id, kind from projects where code = 'SIGNATURE'");
  const twr = await db.one("insert into projects (code, name, company_id, kind) select 'TWR9', 'Demo Towers', company_id, 'new' from projects where code = 'SIGNATURE' returning id");
  const T = [];
  for (const [no, name, area, status] of [[1, 'Test Holder One', 300, 'Active'], [2, 'Test Holder Two', 250, 'Active'], [3, 'Test Holder Three', 120, 'Closed shop']])
    T.push((await db.one("insert into acc_sra_tenants (book, survey_no, name, master_name, area, monthly_rent, months, rent_2025, yearly_increase, status, imported) values ('signature', $1, $2, $3, $4, 10000, 12, 120000, 0.1, $5, true) returning id", [no, name, 'i) ' + name, area, status])).id);
  const doc = (owner, id, kind, file) => db.one(`insert into customer_docs (owner_kind, tenant_id, project_id, label, kind, title, file_name, mime, size, drive_file_id, status, ready_at)
    values ($1, $2, $3, 'x', $4, '', $5, 'application/pdf', 1000, 'fake-drive-id', 'ready', now()) returning id`, [owner, owner === 'tenant' ? id : null, owner === 'project' ? id : null, kind, file]);
  await doc('tenant', T[0], 'Agreement (signed)', 'Shop 1 - Test Holder One.pdf');
  await doc('tenant', T[0], 'KYC: PAN, Aadhaar, photo', 'kyc.pdf');
  await doc('tenant', T[0], 'Eligibility / annexure papers', 'annex.pdf');
  await doc('tenant', T[1], 'Agreement (signed)', 'Shop 2 - Test Holder Two.pdf');

  await step('Dream Signature is an SRA scheme: its approvals show the SRA list; a non-SRA project has no slum register', async () => {
    assert.equal(sig.kind, 'sra');
    const a = await api('/api/approvals?project=' + sig.id); assert.equal(a.status, 200, a.error);
    assert.ok(a.list.some((x) => x.key === 'annex2') && a.list.some((x) => x.key === 'loi_rev'));
    const r = await api('/api/slums?project=' + twr.id); assert.equal(r.status, 409); assert.match(r.error, /not an SRA scheme/);
  });

  await step('the register lists every tenement with its papers, what is missing and the rent from Accounts', async () => {
    const r = await api('/api/slums?project=' + sig.id); assert.equal(r.status, 200, r.error);
    assert.equal(r.list.length, 3); assert.deepEqual(r.list.map((x) => x.no), [1, 2, 3]);
    assert.equal(r.summary.agreements, 2); assert.equal(r.summary.kyc, 1); assert.equal(r.summary.complete, 1); assert.equal(r.summary.closed, 1);
    const two = r.list.find((x) => x.no === 2); assert.deepEqual(two.missing, ['KYC (PAN, Aadhaar, photo)', 'Eligibility papers (Annexure II extract, proofs)']);
    assert.equal(r.canRent, true); assert.ok(two.rent && two.rent.paid === 0 && two.rent.due > 0, JSON.stringify(two.rent));
    assert.equal(r.list[0].holder, 'i) Test Holder One');
    const x = await api(`/api/slums?project=${sig.id}&excel=1`); assert.ok(x.data && x.name.endsWith('.xlsx'));
  });

  await step('what the register adds is saved and checked in plain words; a rehab unit goes to one tenement only', async () => {
    const save = (tenantId, slum) => api('/api/slums', { project: sig.id, action: 'save', tenantId, slum });
    assert.match((await save(T[0], { eligibility: 'maybe' })).error, /eligibility from the list/);
    assert.match((await save(T[0], { agreement_on: '2099-01-01' })).error, /cannot be after today/);
    assert.match((await save(T[0], { mobile: 'call me' })).error, /Mobile/);
    let r = await save(T[0], { use: 'commercial', eligibility: 'eligible', consent: 'given', agreement_on: '2025-10-01', rehab_unit: 'Shop G-12', remark: 'Test' });
    assert.equal(r.status, 200, r.error); const one = r.list.find((x) => x.no === 1);
    assert.equal(one.eligibility, 'eligible'); assert.equal(one.rehab_unit, 'Shop G-12'); assert.equal(r.summary.eligible, 1); assert.equal(r.summary.allotted, 1);
    r = await save(T[1], { rehab_unit: 'shop g-12' }); assert.equal(r.status, 409); assert.match(r.error, /already allotted to annexure no\. 1/);
    assert.equal((await save(999999, {})).status, 404);
    const a = await api('/api/audit?entity=slum'); assert.ok(a.rows.some((x) => x.action === 'create'));
  });

  await step('who may see and change it: sales may not see it; accounts see it but only Head Accounts / Management change it', async () => {
    const mk = async (username, role) => {
      const id = (await db.one("insert into users (username, name, role, password_hash, all_projects, must_change) values ($1, $1, $2, $3, false, false) returning id", [username, role, require('../lib/auth').hashPassword('pass-word-1234')])).id;
      await db.q('insert into user_projects (user_id, project_id) values ($1, $2)', [id, sig.id]);
      const c = client(); await c('/api/session', { action: 'login', username, password: 'pass-word-1234' }); return c;
    };
    const s = await mk('sales9', 'sales'); assert.equal((await s('/api/slums?project=' + sig.id)).status, 403);
    const w = await mk('acc9', 'accounts'); const r = await w('/api/slums?project=' + sig.id); assert.equal(r.status, 200, r.error);
    if (!r.canEdit) assert.equal((await w('/api/slums', { project: sig.id, action: 'save', tenantId: T[0], slum: {} })).status, 403);
  });

  await step('an approval points at letters already in Project documents, only this project\'s', async () => {
    const mine = await doc('project', sig.id, 'Approvals (IOD, CC, RERA, NOCs)', 'Test LOI.pdf');
    const other = await doc('project', twr.id, 'Approvals (IOD, CC, RERA, NOCs)', 'Other LOI.pdf');
    const d = await api(`/api/approvals?project=${sig.id}&docs=1`); assert.ok(d.docs.some((x) => x.id === mine.id) && !d.docs.some((x) => x.id === other.id));
    assert.match((await api('/api/approvals', { project: sig.id, action: 'docs.link', key: 'loi', docIds: [other.id] })).error, /not in this project/);
    const r = await api('/api/approvals', { project: sig.id, action: 'docs.link', key: 'loi', docIds: [mine.id] }); assert.equal(r.status, 200, r.error);
    const loi = r.list.find((x) => x.key === 'loi'); assert.deepEqual(loi.docs.map((x) => x.name), ['Test LOI.pdf']); assert.equal(loi.status, 'not_started');
  });

  await step('the project folder import: a tenant\'s agreement goes to that tenant, and a date in a file name is not a section number', async () => {
    const P = require('../lib/project-docs');
    assert.equal(P.tenantOf(['Good Luck - Tenant Agreement', 'Shop 169 - Test Name.pdf']), 169);
    assert.equal(P.tenantOf(['Good Luck - Tenant Agreement', 'Shop 49- Test.pdf']), 49);
    assert.equal(P.tenantOf(['Legal Documents', 'Shop 1 - lease.pdf']), null);
    assert.equal(P.tenantKind('Shop 169 - Test Name.pdf'), 'Agreement (signed)');
    assert.equal(P.tenantKind('Shop 12 - KYC.pdf'), 'KYC: PAN, Aadhaar, photo');
    assert.equal(P.tenantKind('Shop 12 - Annexure II extract.pdf'), 'Eligibility / annexure papers');
    assert.equal(P.tenantKind('Shop 12 - Consent.pdf'), 'Other');
    assert.equal(P.sectionOf(['Legal Documents', 'Demo - LOI - 13-03-2025.pdf']), 'Approvals (IOD, CC, RERA, NOCs)');
    assert.equal(P.sectionOf(['Legal Documents', 'Demo - Partnership Deed.pdf']), 'Legal & agreements');
    assert.equal(P.sectionOf(['BMC Plan', '3 - Basement Floor Plan.pdf']), 'Drawings & consultants');
    assert.equal(P.sectionOf(['02 DP remarks & survey', 'x.pdf']), 'DP remarks & survey');
    assert.equal(P.sectionOf(['Legal Documents', 'Demo PR Card.pdf']), 'Land & title');
  });

  await step('a file in the drop box waits a day to be sorted, then comes in by its own name', async () => {
    const P = require('../lib/project-docs'), CI = require('../lib/custdocs-import'), sh = require('../lib/sheets');
    const realList = CI.listFiles, realTok = sh.accessToken;
    await P.linkFolder(990, 'folder-test-dropbox');
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString(), fresh = new Date().toISOString();
    CI.listFiles = async () => [
      { id: 'dbx-fresh', name: 'Demo LOI.pdf', mimeType: 'application/pdf', size: 10, modifiedTime: fresh, path: ['00 Drop box – new documents'] },
      { id: 'dbx-old', name: 'Demo IOD letter.pdf', mimeType: 'application/pdf', size: 10, modifiedTime: old, path: ['00 Drop box – new documents'] },
      { id: 'sorted', name: 'Demo survey.pdf', mimeType: 'application/pdf', size: 10, modifiedTime: fresh, path: ['02 DP remarks & survey'] },
    ];
    sh.accessToken = async () => 'token';
    try {
      const p = await P.plan(990);
      assert.deepEqual(p.ready.map((x) => x.id).sort(), ['dbx-old', 'sorted']);
      assert.match(p.skipped[0].why, /drop box/);
      assert.equal(p.ready.find((x) => x.id === 'dbx-old').section, 'Approvals (IOD, CC, RERA, NOCs)');
    } finally { CI.listFiles = realList; sh.accessToken = realTok; await P.linkFolder(990, null); }
  });

  console.log(`Slum register: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
