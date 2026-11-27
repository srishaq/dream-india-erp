// Compliance Calendar → "Add this year's due dates" (lib/compliance-dates.js, api/accounts.js action compliance-year):
// GST, TDS, income tax and RERA dates for the financial year, from today on, never twice, with the state's RERA name.
// DATABASE_URL=postgres://... node scripts/test-compliance-dates.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3993';
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
const C = require('../lib/compliance-dates');
const { today } = require('../lib/demands');
const { thisFy } = require('../lib/targets');

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  await require('../lib/db').q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE' on conflict do nothing");

  await step('the year has the right GST, TDS, income tax and RERA days', async () => {
    const l = C.list(2026), f = (c, p) => l.find((x) => x.compliance.startsWith(c) && x.period === p);
    assert.equal(f('GSTR-3B', 'Apr-2026').due_date, '2026-05-20'); assert.equal(f('GSTR-1', 'Dec-2026').due_date, '2027-01-11');
    assert.equal(f('TDS deposit', 'Nov-2026').due_date, '2026-12-07'); assert.equal(f('TDS deposit', 'Mar-2027').due_date, '2027-04-30', 'March TDS is due on 30 April');
    assert.equal(f('TDS return', 'Q4 Jan-Mar 2027').due_date, '2027-05-31');
    const rq = f('RERA quarterly', 'Q2 Jul-Sep 2026'); assert.equal(rq.due_date, '2026-10-15'); assert.equal(rq.law, 'RERA (MahaRERA)');
    assert.equal(f('GST annual return', 'FY 2026-27').due_date, '2027-12-31');
    assert.equal(l.length, 52);
  });

  await step('one tap adds the dates from today on; a second tap adds nothing', async () => {
    const fy = thisFy(), t = today();
    const want = C.list(fy).filter((x) => x.due_date >= t).length;
    const r = await api('/api/accounts', { action: 'compliance-year' });
    assert.equal(r.status, 200, r.error); assert.equal(r.added, want); assert.equal(r.there, 0);
    const db = require('../lib/db');
    const past = await db.one("select count(*)::int as k from acc_compliance where due_date < $1", [t]); assert.equal(past.k, 0, 'nothing already past is added');
    const again = await api('/api/accounts', { action: 'compliance-year' });
    assert.equal(again.added, 0); assert.equal(again.there, want);
    const reg = await api('/api/accounts?reg=compliance&limit=500');
    assert.equal(reg.status, 200, reg.error); assert.equal(reg.total, want);
  });

  await step('Aspire\'s books get their own calendar; Signature\'s is left alone', async () => {
    const db = require('../lib/db');
    const sig = (await db.one("select count(*)::int as k from acc_compliance where book = 'signature'")).k;
    const cookie = (await (async () => { const r = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ action: 'login', username: 'admin', password: 'admin-password-1' }) }); return r.headers.get('set-cookie').split(';')[0]; })());
    const r = await (await fetch(BASE + '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, 'X-Book': 'aspire' }, body: JSON.stringify({ action: 'compliance-year' }) })).json();
    assert.equal(r.added, sig, JSON.stringify(r));
    assert.equal((await db.one("select count(*)::int as k from acc_compliance where book = 'aspire'")).k, sig);
    assert.equal((await db.one("select count(*)::int as k from acc_compliance where book = 'signature'")).k, sig);
  });

  await step('only Accounts logins add them', async () => {
    const db = require('../lib/db');
    await db.q("insert into users (username, name, role, password_hash, all_projects, must_change) values ('sales1', 'Sales One', 'sales', $1, true, false)", [require('../lib/auth').hashPassword('sales-password-1')]);
    const s = client(); await s('/api/session', { action: 'login', username: 'sales1', password: 'sales-password-1' });
    assert.equal((await s('/api/accounts', { action: 'compliance-year' })).status, 403);
  });

  console.log(`Compliance dates: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
