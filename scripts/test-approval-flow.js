// Approvals step by step (lib/approval-flow.js): the 11-step journey of an open plot with its document checklist,
// owners and due dates, waiting-on, fees per step (Management only), the Approvals role, hand-over and the Monday list.
// Synthetic data only. DATABASE_URL=postgres://... node scripts/test-approval-flow.js   (an empty database)
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
const day = (k) => new Date(Date.now() + 5.5 * 3600e3 + k * 864e5).toISOString().slice(0, 10);

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const db = require('../lib/db');
  const P = (await db.one("insert into projects (code, name, company_id, kind) select 'PLOT9', 'Demo Plot', company_id, 'new' from projects where code = 'SIGNATURE' returning id")).id;
  const mk = async (username, role) => {
    const id = (await db.one("insert into users (username, name, role, password_hash, all_projects, must_change, email) values ($1, $1, $2, $3, true, false, $4) returning id", [username, role, require('../lib/auth').hashPassword('pass-word-1234'), username + '@example.com'])).id;
    const c = client(); await c('/api/session', { action: 'login', username, password: 'pass-word-1234' }); return { id, c };
  };

  await step('a project is put on the step layout: 11 steps from land to completion, each with its document checklist', async () => {
    let r = await api('/api/approvals?project=' + P); assert.equal(r.flow, null);
    r = await api('/api/approvals', { project: P, action: 'flow.start', flow: 'open' }); assert.equal(r.status, 200, r.error);
    assert.equal(r.flow.steps.length, 11); assert.deepEqual(r.flow.steps.map((s) => s.key).slice(0, 3), ['land', 'know', 'reserve']);
    assert.ok(r.flow.steps[3].list.some((x) => /Aadhaar/.test(x.title))); assert.ok(r.flow.steps[4].list.some((x) => /44\/69/.test(x.title)));
    assert.equal(r.flow.at.key, 'land'); assert.ok(r.flow.steps[6].approvals.some((a) => a.key === 'iod'));
    const again = await api('/api/approvals', { project: P, action: 'flow.start', flow: 'open' });
    assert.equal(again.flow.steps[0].list.length, r.flow.steps[0].list.length); // nothing added twice
    const sig = await db.one("select id from projects where code = 'SIGNATURE'");
    assert.equal((await api('/api/approvals?project=' + sig.id)).flow, null); // Signature keeps its plain list
  });

  const ap = await mk('appr1', 'approvals');
  await step('documents move needed → sent → accepted, with an owner and a due date; waiting-on counts them', async () => {
    let r = await api('/api/approvals?project=' + P);
    const pan = r.flow.steps[3].list.find((x) => /PAN/.test(x.title));
    r = await api('/api/approvals', { project: P, action: 'item.save', item: { id: pan.id, status: 'sent', owner_id: ap.id, due_on: day(-1) } }); assert.equal(r.status, 200, r.error);
    let it = r.flow.steps[3].list.find((x) => x.id === pan.id); assert.equal(it.sent_on, day(0)); assert.equal(it.overdue, true); assert.equal(it.owner, 'appr1');
    assert.ok(r.flow.waiting.architect >= 1); assert.equal(r.flow.overdue, 1);
    assert.match((await api('/api/approvals', { project: P, action: 'item.save', item: { id: pan.id, status: 'lost' } })).error, /where the document stands/);
    r = await api('/api/approvals', { project: P, action: 'item.save', item: { step: 'land', title: 'Extra test paper', who: 'advocate' } }); assert.equal(r.status, 200, r.error);
    const land = r.flow.steps[0]; assert.ok(land.list.some((x) => x.title === 'Extra test paper'));
    // the land step is done when its documents and approvals are
    for (const x of land.list) await api('/api/approvals', { project: P, action: 'item.save', item: { id: x.id, status: x.title.startsWith('Collector') ? 'not_needed' : 'accepted' } });
    await api('/api/approvals', { project: P, action: 'save', approval: { key: 'title', status: 'received', received_on: day(0) } });
    await api('/api/approvals', { project: P, action: 'save', approval: { key: 'na', status: 'not_needed' } });
    r = await api('/api/approvals', { project: P, action: 'save', approval: { title: "Architect's area certificate (for conveyance)", status: 'received', received_on: day(0) } });
    assert.equal(r.flow.steps[0].complete, true, JSON.stringify(r.flow.steps[0].approvals.map((a) => [a.title, a.status]))); assert.equal(r.flow.at.key, 'know');
    r = await api('/api/approvals', { project: P, action: 'save', approval: { title: 'Test railway NOC', status: 'not_started', step_key: 'noc' } });
    assert.ok(r.flow.steps.find((s) => s.key === 'noc').approvals.some((a) => a.title === 'Test railway NOC'));
  });

  await step('a step gets an owner and a due date; fees per step are for Management, not the Approvals role', async () => {
    let r = await api('/api/approvals', { project: P, action: 'step.save', step: 'file', owner_id: ap.id, due_on: day(30), note: 'Test' }); assert.equal(r.status, 200, r.error);
    assert.equal(r.flow.steps.find((s) => s.key === 'file').owner, 'appr1');
    r = await api('/api/approvals', { project: P, action: 'money.save', money: { step: 'file', item: 'Test scrutiny fee', expected: '100000', paid: '40000', paid_on: day(0) } }); assert.equal(r.status, 200, r.error);
    assert.equal(r.flow.steps.find((s) => s.key === 'file').money[0].paid, 40000);
    const v = await ap.c('/api/approvals?project=' + P); assert.equal(v.status, 200, v.error); assert.equal(v.canEdit, true); assert.equal(v.canMoney, false);
    assert.equal(v.flow.steps.find((s) => s.key === 'file').money, undefined);
    assert.equal((await ap.c('/api/approvals', { project: P, action: 'money.save', money: { step: 'file', item: 'x', expected: 1 } })).status, 403);
    const pan = v.flow.steps[3].list.find((x) => /PAN/.test(x.title));
    assert.equal((await ap.c('/api/approvals', { project: P, action: 'item.save', item: { id: pan.id, status: 'accepted' } })).status, 200);
    assert.equal((await ap.c('/api/accounts?reg=payments')).status, 403);
    assert.equal((await ap.c('/api/approvals', { project: P, action: 'flow.start', flow: 'open' })).status, 403);
  });

  await step('the Monday list per owner, and handing everything over to a new person', async () => {
    const r0 = await api('/api/approvals?project=' + P);
    const cts = r0.flow.steps[1].list.find((x) => /CTS plan/.test(x.title));
    await api('/api/approvals', { project: P, action: 'item.save', item: { id: cts.id, owner_id: ap.id } });
    const F = require('../lib/approval-flow');
    let mine = (await F.pending()).find((p) => p.id === ap.id); assert.ok(mine.items.some((x) => /CTS plan/.test(x.title))); assert.ok(mine.steps.length >= 1);
    const nw = await mk('appr2', 'approvals');
    const h = await api('/api/approvals', { project: P, action: 'handover', from: ap.id, to: nw.id }); assert.equal(h.status, 200, h.error);
    assert.ok(h.handedOver.documents >= 1 && h.handedOver.steps >= 1);
    mine = (await F.pending()).find((p) => p.id === nw.id); assert.ok(mine.items.some((x) => /CTS plan/.test(x.title)));
    assert.ok(!(await F.pending()).some((p) => p.id === ap.id && p.items.length));
    const m = await F.monday({ force: true }); assert.ok(m.owners && 'summary' in m);
  });

  console.log(`Approval journey: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
