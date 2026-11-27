// Leads from Excel (Marketing → Leads, lib/mkt-import.js): the template, every row checked before any is saved, a
// number already a lead not doubled, the lead given to the sales team without any message sent, and who may upload.
// DATABASE_URL=postgres://... node scripts/test-mkt-import.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
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
const file = (rows) => ({ name: 'leads.xlsx', data: W.write([{ name: 'Leads', rows }]).toString('base64') });

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const q = (sql, p) => db.q(sql, p);
  const imp = (rows, c = api) => c('/api/marketing', { action: 'leads.import', data: { file: file(rows) } });
  const head = ['Name', 'Phone', 'Email', 'Source', 'Project', 'Status', 'Enquiry date', 'Next call date', 'Note'];

  await step('the template has the columns and the project codes to use', async () => {
    const t = await api('/api/marketing?leadsTemplate=1');
    assert.equal(t.status, 200, t.error); assert.equal(t.name, 'leads-template.xlsx');
    const sheets = X.read(Buffer.from(t.data, 'base64'));
    assert.deepEqual(sheets[0].rows[0], head);
    assert.ok(sheets[1].rows.some((r) => /SIGNATURE/.test(r[1] || '')));
  });

  await step('a bad row stops the whole file, in plain words, and nothing is saved', async () => {
    const r = await imp([head, ['A', '98200 12345', '', '99acres', 'SIGNATURE', 'New', '', '', ''], ['B', '12345', '', '', '', '', '', '', ''], ['C', '', '', 'Billboard', '', '', '', '', ''], ['D', '9820012345', '', '', 'Nowhere', '', '', '', ''], ['E', '9820099999', '', '', '', 'Hot', '31-02-2026', '', '']]);
    assert.equal(r.status, 400, r.error); assert.match(r.error, /Nothing was saved/);
    assert.match(r.problems.join('\n'), /fewer than 10 digits/); assert.match(r.problems.join('\n'), /phone number or an email/);
    assert.match(r.problems.join('\n'), /in the file twice/); assert.match(r.problems.join('\n'), /status "Hot"/);
    assert.equal((await q('select count(*)::int as n from mkt_leads'))[0].n, 0);
    assert.equal((await imp([['Phone', 'Name'], ['1', '2']])).status, 400, 'not the template');
  });

  await step('good rows come in with their source, project, status and dates; no message goes out', async () => {
    await api('/api/marketing', { action: 'lead.save', data: { name: 'Already here', phone: '9820000003', source: 'website', welcome: false } });
    const r = await imp([head, ['Asha P', '+91 98200 00001', 'asha@example.com', '99acres', 'SIGNATURE', 'New', '15-11-2026', '', 'Wants 2 BHK'], ['Ravi K', '9820000002', '', 'Walk-in', 'Dream Signature', 'Site visit', '2026-11-16', '20-11-2026', ''], ['', '9820000003', '', 'MagicBricks', '', '', '', '', ''], ['Only email', '', 'mail@example.com', '', '', '', '', '', '']]);
    assert.equal(r.status, 200, r.error); assert.deepEqual(r.imported, { added: 3, merged: 1 });
    const L = await q("select name, phone, source, sources, status, project_id, to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d, to_char(next_date, 'YYYY-MM-DD') as next, visit_at is not null as visit from mkt_leads order by id");
    const a = L.find((x) => x.phone === '9820000001'), v = L.find((x) => x.phone === '9820000002'), m = L.find((x) => x.phone === '9820000003');
    assert.equal(a.source, '99acres'); assert.equal(a.d, '2026-11-15'); assert.ok(a.project_id);
    assert.equal(v.status, 'visit'); assert.equal(v.next, '2026-11-20'); assert.equal(v.visit, true);
    assert.equal(m.name, 'Already here'); assert.equal(String(m.sources), '{website,magicbricks}', 'the source is added, not a second lead');
    assert.equal(L.find((x) => !x.phone).source, 'other');
    const sent = await q("select count(*)::int as n from audit_log where action ilike '%whatsapp%' or action ilike '%email%'").catch(() => [{ n: 0 }]);
    assert.equal(sent[0].n, 0);
    const au = await api('/api/audit?entity=mkt-lead'); assert.ok(au.rows.some((x) => x.action === 'import'));
  });

  await step('a login without Marketing or bookings cannot upload leads', async () => {
    await db.q("insert into users (username, name, role, password_hash, all_projects, must_change) values ('view1', 'Viewer', 'viewer', $1, true, false)", [require('../lib/auth').hashPassword('view-password-1')]);
    const w = client(); await w('/api/session', { action: 'login', username: 'view1', password: 'view-password-1' });
    assert.equal((await imp([head, ['X', '9820000009']], w)).status, 403);
  });

  console.log(`Leads from Excel: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
