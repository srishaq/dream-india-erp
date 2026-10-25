// End-to-end test against a real, EMPTY Postgres database.
// DATABASE_URL=postgres://... node scripts/test.js
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3999';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;

function client() {
  let cookie = '';
  return async (path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

(async () => {
  const admin = client();
  await step('fresh database asks for setup', async () => {
    const s = await admin('/api/session'); assert.equal(s.state, 'needs-setup');
  });
  await step('setup rejects a short password', async () => {
    const r = await admin('/api/session', { action: 'setup', name: 'Rafi', username: 'rafi', password: 'short' }); assert.equal(r.status, 400);
  });
  await step('setup creates the first Admin and signs in', async () => {
    const r = await admin('/api/session', { action: 'setup', name: 'Syed Rafi Ishaq', username: 'Rafi', password: 'very-long-password-1' }); assert.equal(r.ok, true);
    const s = await admin('/api/session'); assert.equal(s.state, 'ready'); assert.equal(s.user.username, 'rafi'); assert.equal(s.user.role, 'admin');
  });
  await step('setup cannot run twice', async () => {
    const r = await client()('/api/session', { action: 'setup', name: 'X', username: 'intruder', password: 'very-long-password-2' }); assert.equal(r.status, 409);
  });
  let sig;
  await step('Dream Signature is seeded with 3 buildings and a 100% plan', async () => {
    const m = await admin('/api/masters');
    assert.equal(m.companies.length, 4);
    sig = m.projects.find((p) => p.code === 'SIGNATURE');
    assert.equal(sig.company, 'Prime Realtors');
    assert.deepEqual(sig.buildings.map((b) => b.code).sort(), ['A', 'B', 'REHAB']);
    const stages = sig.plans[0].stages;
    assert.equal(stages.length, 15);
    assert.equal(stages.reduce((a, s) => a + Number(s.pct), 0), 100);
  });
  let jog;
  await step('Admin adds a company, project and building', async () => {
    let r = await admin('/api/masters', { action: 'company.save', code: 'DIRLLP2', name: 'Test Co', pan: 'bad' }); assert.equal(r.status, 400);
    r = await admin('/api/masters', { action: 'company.save', code: 'TESTCO', name: 'Test Co', pan: 'abcde1234f' }); assert.equal(r.ok, true);
    const co = r.companies.find((c) => c.code === 'TESTCO'); assert.equal(co.pan, 'ABCDE1234F');
    r = await admin('/api/masters', { action: 'project.save', code: 'JOGESHWARI1', name: 'Jogeshwari SRA 1', companyId: co.id }); assert.equal(r.ok, true);
    jog = r.projects.find((p) => p.code === 'JOGESHWARI1');
    r = await admin('/api/masters', { action: 'building.save', projectId: jog.id, code: 'A', name: 'Sale Tower', kind: 'sale', floors: 40 }); assert.equal(r.ok, true);
    r = await admin('/api/masters', { action: 'project.save', code: 'SIGNATURE', name: 'Duplicate', companyId: co.id }); assert.equal(r.status, 409);
  });
  await step('writes from another website are refused', async () => {
    const r = await admin('/api/masters', { action: 'company.save', code: 'EVIL', name: 'Evil' }, { Origin: 'https://evil.example' }); assert.equal(r.status, 403);
  });
  let temp;
  await step('Admin creates a CRM login for Dream Signature only', async () => {
    const r = await admin('/api/users', { action: 'create', name: 'Neha CRM', username: 'neha', role: 'crm', projects: [sig.id] });
    assert.equal(r.ok, true); temp = r.tempPassword; assert.ok(temp.length >= 10);
  });
  const neha = client();
  await step('new login must change the temporary password first', async () => {
    const r = await neha('/api/session', { action: 'login', username: 'neha', password: temp }); assert.equal(r.ok, true); assert.equal(r.user.mustChange, true);
    const m = await neha('/api/masters'); assert.equal(m.status, 403);
    const p = await neha('/api/session', { action: 'password', current: temp, next: 'neha-own-password-1' }); assert.equal(p.ok, true);
  });
  await step('CRM sees only its project and cannot edit masters, logins or audit', async () => {
    const m = await neha('/api/masters'); assert.deepEqual(m.projects.map((p) => p.code), ['SIGNATURE']);
    assert.equal((await neha('/api/masters', { action: 'company.save', code: 'X1', name: 'X' })).status, 403);
    assert.equal((await neha('/api/users')).status, 403);
    assert.equal((await neha('/api/audit')).status, 403);
  });
  await step('password reset signs the person out everywhere', async () => {
    const list = await admin('/api/users'); const id = list.users.find((u) => u.username === 'neha').id;
    const r = await admin('/api/users', { action: 'reset', id }); assert.ok(r.tempPassword);
    assert.equal((await neha('/api/masters')).status, 401);
  });
  await step('disabled login cannot sign in', async () => {
    const list = await admin('/api/users'); const id = list.users.find((u) => u.username === 'neha').id;
    await admin('/api/users', { action: 'disable', id });
    const r = await client()('/api/session', { action: 'login', username: 'neha', password: 'neha-own-password-1' }); assert.equal(r.status, 401);
  });
  await step('Admin cannot disable themselves', async () => {
    const list = await admin('/api/users'); const id = list.users.find((u) => u.username === 'rafi').id;
    assert.equal((await admin('/api/users', { action: 'disable', id })).status, 400);
  });
  await step('ten wrong passwords lock the username', async () => {
    const c = client();
    for (let i = 0; i < 10; i++) await c('/api/session', { action: 'login', username: 'rafi', password: 'wrong-' + i });
    const r = await c('/api/session', { action: 'login', username: 'rafi', password: 'very-long-password-1' });
    assert.equal(r.status, 401); assert.match(r.error, /Too many/);
  });
  await step('every change is in the audit log', async () => {
    const a = await admin('/api/audit');
    const kinds = a.rows.map((r) => `${r.action}:${r.entity}`);
    for (const k of ['create:user', 'create:company', 'create:project', 'create:building', 'reset-password:user', 'disable:user', 'password:user']) assert.ok(kinds.includes(k), k);
  });
  await step('the ERP pages are served', async () => {
    const r = await fetch(BASE + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /Dream India ERP/);
  });
  console.log(`\nAll ${passed} checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
