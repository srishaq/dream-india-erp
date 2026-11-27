// Sales targets (api/targets.js, lib/targets.js): month by month for the project and each sales person, beside the
// flats booked; checked before saving; only the Admin, Management or Head CRM sets them.
// DATABASE_URL=postgres://... node scripts/test-targets.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3995';
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
const T = require('../lib/targets');

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const p = (await api('/api/masters')).projects.find((x) => x.code === 'SIGNATURE');

  await step('a year runs April to March', async () => {
    assert.deepEqual(T.months(2026).slice(0, 2), ['2026-04', '2026-05']); assert.equal(T.months(2026)[11], '2027-03');
    assert.equal(T.fyOf('2027-03-31'), 2026); assert.equal(T.fyOf('2027-04-01'), 2027);
  });

  await step('no targets yet: an empty year, with Set targets for the Admin', async () => {
    const v = await api(`/api/targets?project=${p.id}&fy=2026`);
    assert.equal(v.status, 200, v.error); assert.equal(v.canEdit, true); assert.equal(v.months.length, 12); assert.equal(v.project.totalTarget.units, 0); assert.equal(v.label, 'April 2026 to March 2027');
  });

  await step('every row is checked; nothing saved on a problem', async () => {
    const r = await api('/api/targets', { action: 'save', projectId: p.id, fy: 2026, rows: [{ person: '', month: '2026-04', units: 2.5 }, { person: 'Ravi', month: '2025-04', units: 1 }, { person: '', month: '2026-05', units: 1, value: 'lots' }] });
    assert.equal(r.status, 400); assert.equal(r.problems.length, 3, JSON.stringify(r.problems));
    assert.match(r.problems.join('\n'), /whole number/); assert.match(r.problems.join('\n'), /2025-04 is not in April 2026 to March 2027/); assert.match(r.problems.join('\n'), /value must be a number/);
  });

  await step('targets saved for the project and a sales person; bookings show against them', async () => {
    const r = await api('/api/targets', { action: 'save', projectId: p.id, fy: 2026, rows: [{ person: '', month: '2026-11', units: 4, value: 40000000 }, { person: '', month: '2026-12', units: 5, value: 50000000 }, { person: 'Ravi Kumar', month: '2026-11', units: 2 }] });
    assert.equal(r.status, 200, r.error); assert.equal(r.saved, 3);
    const db = require('../lib/db');
    const b = (await db.one('select id from buildings where project_id = $1 limit 1', [p.id])).id;
    const plan = (await db.one("insert into payment_plans (project_id, name) values ($1, 'Target test plan') returning id", [p.id])).id;
    let i = 0;
    for (const [date, rm, status] of [['2026-11-03', 'Ravi Kumar', 'active'], ['2026-11-09', 'ravi kumar', 'pending'], ['2026-11-12', '', 'active'], ['2026-11-20', 'Ravi Kumar', 'cancelled'], ['2027-04-02', 'Ravi Kumar', 'active']]) {
      const u = (await db.one("insert into units (project_id, building_id, unit_no, floor, status) values ($1, $2, $3, 1, 'booked') returning id", [p.id, b, 'T-90' + ++i])).id;
      await db.q('insert into bookings (unit_id, plan_id, booking_date, agreement_value, status, rm_name, created_by) values ($1, $2, $3, 9000000, $4, $5, 1)', [u, plan, date, status, rm || null]);
    }
    const v = await api(`/api/targets?project=${p.id}&fy=2026`);
    assert.equal(v.project.target['2026-11'].units, 4); assert.equal(v.project.target['2026-12'].value, 50000000);
    assert.equal(v.project.actual['2026-11'].units, 3, 'cancelled and next year left out'); assert.equal(v.project.actual['2026-11'].value, 27000000);
    const ravi = v.people.find((x) => x.name.toLowerCase() === 'ravi kumar');
    assert.equal(ravi.actual['2026-11'].units, 2, 'the same name in any case is one person'); assert.equal(ravi.target['2026-11'].units, 2);
    assert.ok(v.people.some((x) => x.name === 'Demo Admin' && x.actual['2026-11'].units === 1), 'no sales person: the login that entered it');
    const x = await api(`/api/targets?project=${p.id}&fy=2026&excel=1`);
    const rows = require('../lib/sheetfile').parseFile(x.data, x.name);
    assert.match(String(rows[0][0]), /sales targets/); assert.ok(rows.some((r) => r[0] === 'Ravi Kumar' || r[0] === 'ravi kumar'));
    const au = await api('/api/audit?entity=sales-targets'); assert.ok(au.rows.some((r) => /April 2026 to March 2027/.test(r.note)));
  });

  await step('saving again replaces the year', async () => {
    const r = await api('/api/targets', { action: 'save', projectId: p.id, fy: 2026, rows: [{ person: '', month: '2026-11', units: 6 }] });
    assert.equal(r.saved, 1); assert.equal(r.project.totalTarget.units, 6); assert.equal(r.people.find((x) => /ravi/i.test(x.name)).totalTarget.units, 0);
  });

  await step('a sales login sees the targets but cannot set them; another project is closed', async () => {
    const v = await api('/api/users', { action: 'create', name: 'Sales One', username: 'pre1', role: 'sales', projects: [p.id] });
    const w = client(); await w('/api/session', { action: 'login', username: 'pre1', password: v.tempPassword }); await w('/api/session', { action: 'password', current: v.tempPassword, next: 'pre-password-1' });
    const g = await w(`/api/targets?project=${p.id}&fy=2026`);
    if (g.status === 200) assert.equal(g.canEdit, false); else assert.equal(g.status, 403);
    assert.equal((await w('/api/targets', { action: 'save', projectId: p.id, fy: 2026, rows: [] })).status, 403);
    assert.equal((await api('/api/targets?project=99999')).status, 403);
  });

  console.log(`Sales targets: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
