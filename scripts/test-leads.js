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

  await step('Dream Aspire is ready for sales: 13 unsold flats, the 70% plan, the quoting price list matching the cost sheet', async () => {
    // the live ERP has Dream Aspire; a new test database does not: add it and run its set-up step again
    if (!(await db.one("select id from projects where code = 'ASPIRE'"))) {
      await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE'");
      for (const st of require('../lib/migrations').find((m) => m.id === '072_aspire_inventory').sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await db.q(st);
    }
    const asp = await db.one("select id from projects where code = 'ASPIRE'");
    await db.q('update users set all_projects = true');
    assert.equal((await db.one("select count(*)::int as n from units where project_id = $1 and status = 'available'", [asp.id])).n, 13);
    assert.equal((await db.one('select sum(s.pct)::int as p from plan_stages s join payment_plans pp on pp.id = s.plan_id where pp.project_id = $1', [asp.id])).p, 100);
    const O = require('../lib/mkt-offers');
    const pr = await O.price((await db.one("select id from units where unit_no = 'A-605'")).id, { parking: 1 });
    assert.equal(pr.listAv, 14081500, '459 sq ft × ₹28,500 + ₹10 L parking'); assert.equal(pr.total, 16019994, 'the cost sheet says ₹1,60,19,984 (stamp duty rounds up to ₹100)');
    assert.equal(pr.floorRate, 27500);
  });

  let offerLead;
  await step('Sales offers within 1% at once; above 1% it needs the customer\'s ask and waits for the approver', async () => {
    const r = await require('../lib/mkt-leads').add({ phone: '98200 44444', name: 'Meera Rao', source: 'instagram', welcome: false });
    offerLead = r.id;
    await asma('/api/leads', { action: 'handover', id: offerLead, to: amaan.id });
    const unit = await db.one("select id from units where unit_no = 'A-605'");
    const small = await amaan('/api/leads', { action: 'offer.make', id: offerLead, unitId: unit.id, parking: 1, discount: 140000 });
    assert.equal(small.ok, true, small.error); assert.equal(small.status, 'given', 'just under 1%');
    assert.equal((await amaan('/api/leads', { action: 'offer.make', id: offerLead, unitId: unit.id, parking: 1, discount: 500000 })).status, 400, 'above 1% needs what the customer asks');
    const big = await amaan('/api/leads', { action: 'offer.make', id: offerLead, unitId: unit.id, parking: 1, discount: 500000, clientAsk: 'Wants 1.55 Cr all inclusive' });
    assert.equal(big.status, 'pending');
    assert.equal((await db.one('select status from mkt_offers where id = $1', [small.id])).status, 'void', 'the newer offer replaces the earlier one');
    const o = await db.one('select discount_pct, floor_rate, list_total, total from mkt_offers where id = $1', [big.id]);
    assert.ok(Number(o.discount_pct) > 3.5 && Number(o.discount_pct) < 3.6); assert.equal(Number(o.floor_rate), 27500);
    assert.ok((await admin('/api/leads')).approvals.some((x) => x.id === big.id), 'the approver sees it to approve');
    assert.equal((await amaan('/api/leads', { action: 'offer.decide', id: offerLead, offerId: big.id, approve: true })).status, 403, 'sales cannot approve his own');
    assert.equal((await sameer('/api/leads', { action: 'offer.decide', id: offerLead, offerId: big.id, approve: true })).status, 403, 'only the approver');
    assert.equal((await admin('/api/leads', { action: 'offer.decide', id: offerLead, offerId: big.id, approve: false })).status, 400, 'a rejection needs a reason');
    const ok = await admin('/api/leads', { action: 'offer.decide', id: offerLead, offerId: big.id, approve: true });
    assert.equal(ok.status, 'approved', ok.error);
    // and by WhatsApp reply, from the approver's own mobile
    await db.q("update users set phone = '9876500000' where username = 'admin'");
    const third = await amaan('/api/leads', { action: 'offer.make', id: offerLead, unitId: unit.id, parking: 1, discount: 450000, clientAsk: 'Final: 1.56 Cr' });
    const reply = await require('../lib/mkt-offers').handleReply('919876500000', `APPROVE OF-${third.id}`);
    assert.ok(reply && reply.handled); assert.equal((await db.one('select status from mkt_offers where id = $1', [third.id])).status, 'approved');
    assert.equal(await require('../lib/mkt-offers').handleReply('919999999999', `APPROVE OF-${third.id}`), null, 'not from a stranger\'s mobile');
  });

  await step('Sales holds the flat for 72 hours; nobody else can take it; the hold ends by itself', async () => {
    const unit = await db.one("select id from units where unit_no = 'A-605'");
    const h = await amaan('/api/leads', { action: 'hold', id: offerLead, unitId: unit.id });
    assert.equal(h.ok, true, h.error);
    const u1 = await db.one('select status, held_lead_id, held_until from units where id = $1', [unit.id]);
    assert.equal(u1.status, 'held'); assert.equal(u1.held_lead_id, offerLead);
    assert.ok(Math.abs(new Date(u1.held_until) - Date.now() - 72 * 3600e3) < 120e3, '72 hours');
    const other = await asma('/api/leads', { action: 'add', phone: '9820055555', welcome: false });
    await asma('/api/leads', { action: 'handover', id: other.id, to: amaan.id });
    assert.equal((await amaan('/api/leads', { action: 'hold', id: other.id, unitId: unit.id })).status, 409, 'held for someone else');
    assert.equal((await amaan('/api/leads', { action: 'offer.make', id: other.id, unitId: unit.id })).status, 409);
    const u2 = await db.one("select id from units where unit_no = 'A-606'");
    await amaan('/api/leads', { action: 'hold', id: other.id, unitId: u2.id });
    await db.q("update units set held_until = now() - interval '1 minute' where id = $1", [u2.id]);
    assert.equal((await require('../lib/mkt-offers').releaseHolds()).released, 1);
    assert.equal((await db.one('select status from units where id = $1', [u2.id])).status, 'available');
    assert.equal((await db.one('select status from units where id = $1', [unit.id])).status, 'held', 'the live hold stays');
  });

  await step('Book this flat: the held flat is booked for this customer, goes to the CRM, and the lead closes as booked', async () => {
    const unit = await db.one("select id from units where unit_no = 'A-605'");
    const o = await db.one("select av from mkt_offers where lead_id = $1 and status = 'approved'", [offerLead]);
    const b = await amaan('/api/bookings', { action: 'create', leadId: offerLead, unitId: unit.id, agreementValue: Number(o.av), parking: 1, bookingDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10),
      applicants: [{ name: 'Meera Rao', phone: '9820044444', pan: 'ABCDE1234F' }], source: 'Instagram', rmName: 'amaan' });
    assert.equal(b.ok, true, b.error);
    const l = await db.one('select status, booking_id, hold_unit_id from mkt_leads where id = $1', [offerLead]);
    assert.equal(l.status, 'booked'); assert.equal(l.booking_id, b.id); assert.equal(l.hold_unit_id, null);
    assert.equal((await db.one('select status, held_lead_id from units where id = $1', [unit.id])).status, 'blocked', 'waiting for CRM approval, like every booking');
    assert.equal((await db.one("select count(*)::int as n from mkt_offers where lead_id = $1 and status = 'booked'", [offerLead])).n, 1);
    const s = (await admin('/api/leads')).summary;
    assert.ok(s.offers >= 1 && s.booked >= 2); assert.ok(s.bySales.find((x) => x.name === 'amaan'));
  });

  console.log(`\n${n} pre-sales & sales checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
