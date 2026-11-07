// Pre-sales & Sales (/leads): a lead comes in and goes to the pre-sales caller; she calls it, notes the call and what
// they want, hands it to sales with a site-visit date; the sales person sees only his leads, records the visit and closes
// it as booked; the roles that may not see leads cannot.
// DATABASE_URL=postgres://... node scripts/test-leads.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
delete process.env.ANTHROPIC_API_KEY;
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await admin('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const mk = async (u, role) => { const r = await db.one('insert into users (username, name, role, password_hash, all_projects) values ($1, $1, $2, $3, true) returning id', [u, role, auth.hashPassword('pass-word-123')]); const c = client(); await c('/api/session', { action: 'login', username: u, password: 'pass-word-123' }); c.id = r.id; return c; };
  const asma = await mk('asma', 'presales'), amaan = await mk('amaan', 'sales'), crm = await mk('crm1', 'crm'), sameer = await mk('sameer', 'management');
  // new leads go to Asma (Sales & Marketing → follow-up settings)
  await db.q("insert into settings (key, value) values ('marketing', $1) on conflict (key) do update set value = settings.value || excluded.value", [{ follow: { people: { company: [asma.id] }, welcome: false, alertHours: 2 } }]);

  let leadId;
  await step('A lead from the IVR lands with the pre-sales caller; the CRM team does not open Pre-sales & Sales', async () => {
    const r = await require('../lib/mkt-leads').add({ phone: '98200 11111', source: 'ivr', welcome: false });
    leadId = r.id;
    assert.equal((await db.one('select assigned_to from mkt_leads where id = $1', [leadId])).assigned_to, asma.id);
    const g = await asma('/api/leads');
    assert.equal(g.status, 200, g.error); assert.ok(g.leads.some((l) => l.id === leadId && l.status === 'new' && !l.first_contact_at));
    assert.ok(g.summary && g.summary.leads >= 1, 'pre-sales sees the figures');
    assert.equal((await crm('/api/leads')).status, 403);
  });

  await step('She calls: no answer moves it to tomorrow; then she speaks to them and notes what they want', async () => {
    const x = await asma('/api/leads', { action: 'log', id: leadId, outcome: 'no_answer' });
    assert.equal(x.ok, true, x.error); assert.equal(x.status, 'new');
    const y = await asma('/api/leads', { action: 'log', id: leadId, outcome: 'spoke', name: 'Ravi Shah', projectId: sig.id, note: 'Wants a 2 BHK near the metro',
      qualify: { bhk: '2 BHK', budget: '1.8 Cr', purpose: 'Own use', timeline: 'Within 3 months', area: 'Andheri West' } });
    assert.equal(y.ok, true, y.error); assert.equal(y.status, 'contacted');
    const l = await db.one('select name, project_id, qualify, first_contact_at, next_date from mkt_leads where id = $1', [leadId]);
    assert.equal(l.name, 'Ravi Shah'); assert.equal(l.project_id, sig.id); assert.equal(l.qualify.bhk, '2 BHK'); assert.ok(l.first_contact_at); assert.ok(l.next_date);
    assert.equal((await asma('/api/leads', { action: 'log', id: leadId })).status, 400, 'how the call went is required');
    assert.equal((await asma('/api/leads', { action: 'log', id: leadId, outcome: 'visit_booked' })).status, 400, 'a visit needs its date');
    const one = await asma('/api/leads?id=' + leadId);
    assert.equal(one.events.filter((e) => e.kind === 'call').length, 2, 'every call is kept');
  });

  await step('She hands it to Amaan with the site-visit date; Amaan sees only his leads', async () => {
    const other = await require('../lib/mkt-leads').add({ phone: '98200 22222', source: 'website', welcome: false });
    assert.equal((await amaan('/api/leads')).leads.length, 0, 'nothing is his yet');
    const visit = new Date(Date.now() + 2 * 864e5 + 5.5 * 3600e3).toISOString().slice(0, 10);
    const h = await asma('/api/leads', { action: 'handover', id: leadId, to: amaan.id, visitDate: visit, note: 'Coming with his wife' });
    assert.equal(h.ok, true, h.error); assert.equal(h.to, 'amaan');
    const g = await amaan('/api/leads');
    assert.deepEqual(g.leads.map((l) => l.id), [leadId]); assert.equal(g.summary, null, 'sales does not see the team figures');
    assert.equal(g.leads[0].qualify.budget, '1.8 Cr', 'with what pre-sales learnt');
    assert.equal((await amaan('/api/leads?id=' + other.id)).status, 404, 'not someone else\'s lead');
    assert.equal((await amaan('/api/leads', { action: 'log', id: other.id, outcome: 'spoke' })).status, 404);
    assert.equal((await amaan('/api/leads', { action: 'assign', id: leadId, to: amaan.id })).status, 403);
  });

  await step('Amaan records the visit and the booking; management sees it in the figures', async () => {
    assert.equal((await amaan('/api/leads', { action: 'log', id: leadId, outcome: 'visit_done', note: 'Liked the 21st floor' })).status, 'visit');
    assert.equal((await amaan('/api/leads', { action: 'log', id: leadId, outcome: 'booked' })).status, 'booked');
    const l = await db.one('select status, visit_at, booked_at, next_date from mkt_leads where id = $1', [leadId]);
    assert.equal(l.status, 'booked'); assert.ok(l.visit_at); assert.ok(l.booked_at); assert.equal(l.next_date, null);
    const s = (await sameer('/api/leads')).summary;
    assert.equal(s.handed, 1); assert.equal(s.visits, 1); assert.equal(s.booked, 1);
    assert.equal((await amaan('/api/leads', { action: 'log', id: leadId, outcome: 'not_interested' })).status, 400, 'lost needs a reason');
  });

  await step('A lead typed in by the caller is hers; the same number twice stays one lead', async () => {
    const a = await asma('/api/leads', { action: 'add', phone: '9820033333', name: 'Walk-in', source: 'walk_in', welcome: false });
    assert.equal(a.ok, true, a.error); assert.equal(a.duplicate, false);
    const b = await asma('/api/leads', { action: 'add', phone: '+91 98200 33333', source: 'ivr', welcome: false });
    assert.equal(b.id, a.id); assert.equal(b.duplicate, true);
  });

  console.log(`\n${n} pre-sales & sales checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
