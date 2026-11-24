// One project's data never shows in another's (23 Nov 2026: Dream Aspire's Daily To-Do listed Dream Signature's
// flats). Two projects are set up (Signature from the sample, Aspire from the synthetic Aspire workbook), with people
// on one project only, as on the live ERP (Savita CRM and Dixita accounts on Aspire, Tejaswini Head Accounts on
// Signature). Then every page the ERP opens is read as each of them, for their own project and for the other one,
// and no buyer of the other project may appear anywhere in what comes back.
// DATABASE_URL=postgres://... node scripts/test-project-isolation.js   (an empty database; synthetic data only)
require('./login-code-helper');
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3995';
process.env.IMPORT_ASPIRE_FIXTURE = process.env.IMPORT_ASPIRE_FIXTURE || path.join(__dirname, 'fixtures/aspire-sample.js');
const server = require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, hdr = {}) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...hdr }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

// the pages the ERP's screens read, with {P} for the project and {B} for a booking of that project
const PAGES = [
  '/api/dashboard?project={P}', '/api/bookings?project={P}', '/api/units?project={P}', '/api/units?parking=1&project={P}',
  '/api/ledger?project={P}', '/api/followups?project={P}', '/api/letters?project={P}', '/api/prices?project={P}',
  '/api/prices?project={P}&unsold=1&parking=0', '/api/sdr?project={P}', '/api/verify?project={P}&status=open', '/api/import?project={P}',
  '/api/custdocs?project={P}', '/api/partners?project={P}&firms=1', '/api/partners?project={P}&ledger=1',
  '/api/receipts?project={P}', '/api/receipts?todeposit=1', '/api/receipts?banks=1', '/api/demands?project={P}', '/api/dues?project={P}',
  '/api/comms?inbox=1&f=all', '/api/comms?inbox=1&f=waiting', '/api/comms?badge=1', '/api/reports?list=1',
  '/api/tasks?dept=crm', '/api/tasks?dept=accounts',
  '/api/accounts?reg=receipts&limit=1000', '/api/accounts?reg=payments&limit=1000', '/api/accounts?reg=cancellations&limit=1000&filter=',
  '/api/accounts?view=lists', '/api/accounts?view=report&name=flats&project={P}', '/api/accounts?view=report&name=unitmoney&project={P}',
  '/api/books-crm?project={P}', '/api/leads?project={P}', '/api/masters',
  '/api/bookings?id={B}', '/api/ledger?booking={B}', '/api/followups?booking={B}', '/api/comms?booking={B}', '/api/verify?booking={B}', '/api/team?booking={B}',
  // 24 Nov 2026: screens that showed Signature on Aspire (a shared one-minute cache, books fixed to Signature)
  '/api/mgmt?project={P}', '/api/mgmt', '/api/ca', '/api/ca?detail=1', '/api/acc-dashboard', '/api/acc-dashboard?detail=1', '/api/changes', '/api/changes?status=all',
  '/api/custdocs?tenants=1', '/api/accounts?view=import', '/api/accounts?view=todo', '/api/accounts?view=bills', '/api/accounts?reg=journals&limit=1000',
];

(async () => {
  try {
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
    // Signature: the sample; Aspire: its building and the synthetic workbook
    const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
    assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
    await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE'");
    const m = require('../lib/migrations').find((x) => x.id === '072_aspire_inventory');
    for (const st of m.sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await db.q(st);
    const asp = (await admin('/api/masters')).projects.find((p) => p.code === 'ASPIRE');
    const imp = await admin('/api/import', { action: 'aspire-commit', projectId: asp.id });
    assert.equal(imp.status, 200, imp.error);
    // follow-ups due on both, so both call lists have flats
    await db.q("update bookings set crm_user_id = null");

    // the buyers of each project are the markers: none may show in the other's pages
    const buyers = async (pid) => (await db.q(`select distinct y.name from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id join units u on u.id = b.unit_id
        where u.project_id = $1 and length(y.name) >= 8`, [pid])).map((r) => r.name);
    const M = { [sig.id]: await buyers(sig.id), [asp.id]: await buyers(asp.id) };
    assert.ok(M[sig.id].length >= 3 && M[asp.id].length >= 3, 'both projects have buyers');
    assert.ok(!M[sig.id].some((x) => M[asp.id].includes(x)), 'no buyer on both');
    const oneBooking = async (pid) => (await db.one("select b.id from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'active' order by b.id limit 1", [pid])).id;
    const B = { [sig.id]: await oneBooking(sig.id), [asp.id]: await oneBooking(asp.id) };

    // the people, each on one project only
    const person = async (username, name, role, pid) => {
      const h = await admin('/api/users', { action: 'create', name, username, role, projects: [pid] });
      assert.ok(h.tempPassword, JSON.stringify(h));
      const c = client(); await c('/api/session', { action: 'login', username, password: h.tempPassword });
      await c('/api/session', { action: 'password', current: h.tempPassword, next: `${username}-pass-word-12` });
      return c;
    };
    const people = [
      { who: 'Savita (CRM, Aspire)', c: await person('savita', 'Savita', 'head_crm', asp.id), pid: asp.id, other: sig.id, book: 'aspire' },
      { who: 'Dixita (Accounts, Aspire)', c: await person('dixita', 'Dixita', 'head_accounts', asp.id), pid: asp.id, other: sig.id, book: 'aspire' },
      { who: 'Tejaswini (Head Accounts, Signature)', c: await person('tejaswini', 'Tejaswini', 'head_accounts', sig.id), pid: sig.id, other: asp.id, book: 'signature' },
    ];
    // a CRM on both projects with wing A and B of each (as Mubeen): his own call list names the flats
    const mub = await admin('/api/users', { action: 'create', name: 'Mubeen', username: 'mubeen', role: 'crm', projects: [sig.id, asp.id] });
    const mubId = (await db.one("select id from users where username = 'mubeen'")).id; assert.ok(mub.tempPassword);
    await db.q("insert into settings (key, value) values ('crm_wings', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ A: [mubId], B: [mubId] })]);
    // the 9 am audit, for both projects
    for (const p of [sig.id, asp.id]) for (const dept of ['crm', 'accounts']) await require('../lib/daily-tasks').run(dept, { trigger: 'schedule', projectId: p, mail: false });

    const leaks = [];
    const read = async (label, c, url, hdr, foreign) => {
      const r = await c(url, null, hdr);
      const hit = foreign.filter((x) => r.text.includes(x));
      if (r.status === 200 && hit.length) leaks.push(`${label}: ${url} [${JSON.stringify(hdr)}] shows ${hit.slice(0, 3).join(', ')}`);
      return r;
    };
    await step('each person, on their own project, sees nothing of the other project', async () => {
      for (const p of people) {
        const hdr = { 'X-Project': String(p.pid), 'X-Book': p.book };
        for (const u of PAGES) await read(p.who, p.c, u.replace('{P}', p.pid).replace('{B}', B[p.pid]), hdr, M[p.other]);
      }
      assert.deepEqual(leaks, []);
    });
    await step('asking for the other project (in the address or the header) is refused or shows nothing of it', async () => {
      for (const p of people) {
        for (const hdr of [{ 'X-Project': String(p.other) }, { 'X-Project': String(p.pid), 'X-Book': p.book }, {}]) {
          for (const u of PAGES) await read(p.who + ' (other project)', p.c, u.replace('{P}', p.other).replace('{B}', B[p.other]), hdr, M[p.other]);
        }
      }
      assert.deepEqual(leaks, []);
    });
    await step('Admin (all projects), on each project in turn, sees nothing of the other one', async () => {
      for (const [pid, other, book] of [[sig.id, asp.id, 'signature'], [asp.id, sig.id, 'aspire']]) {
        for (const u of PAGES) await read('Admin on ' + book, admin, u.replace('{P}', pid).replace('{B}', B[pid]), { 'X-Project': String(pid), 'X-Book': book }, M[other]);
      }
      assert.deepEqual(leaks, []);
    });
    await step('Admin, on each project in turn, sees only that project\'s flats on the Daily To-Do', async () => {
      for (const [pid, other] of [[sig.id, asp.id], [asp.id, sig.id]]) {
        const L = await admin('/api/tasks?dept=crm', null, { 'X-Project': String(pid), 'X-Book': pid === asp.id ? 'aspire' : 'signature' });
        assert.equal(L.status, 200, L.error); assert.equal(L.projectId, pid);
        const units = (await db.q('select unit_no from units where project_id = $1', [other])).map((x) => x.unit_no);
        const mine = new Set((await db.q('select unit_no from units where project_id = $1', [pid])).map((x) => x.unit_no));
        const foreign = units.filter((x) => !mine.has(x) && x.length >= 5);
        const shown = L.rows.map((x) => `${x.title} ${x.detail || ''}`).join('\n');
        assert.ok(L.rows.some((x) => x.assigned_to === mubId), 'Mubeen has his own call list');
        assert.ok(!foreign.some((x) => new RegExp(`\\b${x.replace(/[-]/g, '\\-')}\\b`).test(shown)), `the other project's flats on the list:\n${shown}`);
      }
    });
    await step('a task of one project cannot be ticked from a login on the other', async () => {
      const k = await db.one('select id from daily_tasks where project_id = $1 order by id limit 1', [sig.id]);
      assert.ok(k, 'Signature has tasks');
      const r = await people[1].c('/api/tasks', { action: 'done', id: k.id }, { 'X-Project': String(asp.id) });
      assert.equal(r.status, 404);
    });
    console.log(`\nProject isolation: ${n} checks passed`);
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  server.close(); db.reset(); process.exit(process.exitCode || 0);
})();
