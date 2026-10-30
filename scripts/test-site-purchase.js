// Site Today page and purchase approvals: site asks for material, Management approves by the one-tap link or a WhatsApp
// reply, Purchase orders, site receives with a photo of the challan (also logged as a site delivery), money stays
// hidden from site logins, a request waiting 24 hours gets a reminder to Management only (not the Admin), and the 10 am summary.
// DATABASE_URL=postgres://... (EMPTY database) node scripts/test-site-purchase.js
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
const server = require('./dev-server');
const net = require('net'), http = require('http');
const mails = [];
const smtp = net.createServer((sock) => {
  sock.setEncoding('utf8'); let data = false, buf = '', authStep = 0, cur = { to: [], body: '' };
  sock.write('220 test\r\n');
  sock.on('data', (d) => {
    buf += d;
    if (data) { const i = buf.indexOf('\r\n.\r\n'); if (i >= 0) { cur.body = buf.slice(0, i); mails.push(cur); cur = { to: [], body: '' }; data = false; buf = buf.slice(i + 5); sock.write('250 ok\r\n'); } return; }
    let i; while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) sock.write('250 hello\r\n');
      else if (/^AUTH LOGIN/i.test(line)) sock.write('334 VXNlcm5hbWU6\r\n');
      else if (/^RCPT TO:<(.+)>/i.test(line)) { cur.to.push(line.match(/<(.+)>/)[1]); sock.write('250 ok\r\n'); }
      else if (/^MAIL FROM/i.test(line) || /^RSET/i.test(line)) sock.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); return sock.emit('data', ''); }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else if (line.length && !/^\s/.test(line)) sock.write(authStep ? '235 ok\r\n' : ((authStep = 1), '334 UGFzc3dvcmQ6\r\n'));
    }
  });
}).listen(2536);
const wa = []; // what the ERP sent to Click Connect
const ccm = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { wa.push({ url: req.url, body: b ? JSON.parse(b) : null }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, results: [{ transaction_id: 'TX' + wa.length }] })); }); }).listen(2537);
const BASE = `http://localhost:${process.env.PORT}`;
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2536', SMTP_TLS: '0', SMTP_USER: 'erp@test.local', SMTP_PASS: 'x', CCM_API_KEY: 'k', CCM_SENDER: '919811100000', CCM_API: 'http://127.0.0.1:2537', ERP_URL: BASE });

function client() {
  let cookie = '';
  return async (path, body, raw) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return r;
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}
const anon = client();
let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a real (tiny) JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Rafi', username: 'admin', password: 'admin-password-1' });
  const m = await admin('/api/masters'), sig = m.projects.find((p) => p.code === 'SIGNATURE');
  await require('../lib/db').q("update users set email = 'rafi@test.local', phone = '9800000009' where username = 'admin'");
  const people = {};
  for (const [username, role, phone, email] of [['siteeng', 'site_engineer', '9800000001', ''], ['sameer', 'management', '9800000002', 'sameer@test.local'], ['buyer1', 'purchase_team', '', ''], ['acc', 'head_accounts', '', ''], ['headcrm', 'head_crm', '', '']]) {
    const r = await admin('/api/users', { action: 'create', name: username === 'sameer' ? 'Sameer' : username, username, role, phone, email, projects: [sig.id] });
    const c = client();
    await c('/api/session', { action: 'login', username, password: r.tempPassword });
    await c('/api/session', { action: 'password', current: r.tempPassword, next: `${username}-password-1` });
    people[username] = c;
  }
  const { siteeng, sameer, buyer1, acc, headcrm } = people;
  const P = (c, body) => c('/api/me?purchase=1', body);
  { const ls = await headcrm('/api/letters', { action: 'settings', testEmail: 'test@test.local', testMobile: '9800000002' }); assert.equal(ls.ok, true, JSON.stringify(ls)); }
  const sa = require('../lib/staff-alerts'), kv = require('../lib/portal/kv');

  let pr1;
  await step('Site sees quantities and BOQ lines but no rates; asks for steel in two sizes', async () => {
    const g = await P(siteeng);
    assert.equal(g.status, 200, JSON.stringify(g).slice(0,300)); assert.equal(g.can.request, true, JSON.stringify(g).slice(0,400)); assert.equal(g.can.approve, false); assert.equal(g.can.readChallan, false);
    assert.ok(g.budget.lines.length > 5); assert.ok(g.budget.lines.every((l) => l.rmcRate == null && l.cementRate == null)); assert.equal(g.budget.steelRate, undefined);
    const line = g.budget.lines.find((l) => l.steel > 0).key;
    const r = await P(siteeng, { op: 'request', data: { material: 'Steel', items: [{ spec: '12 mm', qty: 4 }, { spec: '16 mm', qty: 6 }], line, wing: g.wings[line.split('|')[0]][0], neededBy: '' } });
    assert.equal(r.status, 200, r.error); pr1 = r.doc; assert.equal(pr1.status, 'pending_approval'); assert.equal(pr1.budgetRate, undefined);
  });

  await step('Management is emailed straight away with a one-tap link (test version: the test address only)', async () => {
    const o = await kv.hget('po:orders', pr1.id);
    assert.ok(o.notifiedAt); assert.equal(o.notified.email, true);
    const mail = mails.find((x) => x.body.includes(pr1.no));
    assert.deepEqual(mail.to, ['test@test.local']);
    const decoded = (mail.body.match(/(?:^|\r\n\r\n)((?:[A-Za-z0-9+/=]{20,}\r\n)+)/g) || []).map((b) => Buffer.from(b.replace(/\s+/g, ''), 'base64').toString('utf8')).join('\n') + mail.body;
    assert.match(decoded, /\/approve\?t=/);
  });

  await step('The link shows the request, refuses a rejection without a reason, approves in one tap, and cannot be reused or forged', async () => {
    const t = await sa.token(pr1.id, 'sameer');
    const v = await anon(`/api/me?purchase=1&t=${encodeURIComponent(t)}`);
    assert.equal(v.status, 200); assert.equal(v.approver, 'Sameer'); assert.equal(v.order.no, pr1.no); assert.equal(v.order.items.length, 2);
    assert.equal((await anon(`/api/me?purchase=1&t=${encodeURIComponent(t.slice(0, -2) + 'xx')}`)).status, 410);
    assert.equal((await anon('/api/me?purchase=1', { op: 'link', t, ok: false, note: '' })).status, 409);
    const ok = await anon('/api/me?purchase=1', { op: 'link', t, ok: true });
    assert.equal(ok.status, 200, ok.error); assert.equal(ok.status === 200 && ok.ok, true);
    const o = await kv.hget('po:orders', pr1.id); assert.equal(o.status, 'requested'); assert.equal(o.approval.by, 'sameer'); assert.match(o.history.at(-1).did, /approval link/);
    assert.equal((await anon('/api/me?purchase=1', { op: 'link', t, ok: true })).status, 409);
    // a site login's link (it cannot approve) does nothing
    const pr = await P(siteeng, { op: 'request', data: { material: 'Cement', items: [{ spec: 'OPC 53', qty: 50 }], line: 'Project|Cement', wing: '—' } });
    const bad = await anon('/api/me?purchase=1', { op: 'link', t: await sa.token(pr.doc.id, 'siteeng'), ok: true });
    assert.equal(bad.status, 409); assert.match(bad.error, /Only Management/);
    await P(sameer, { op: 'reject', id: pr.doc.id, data: { note: 'Use the cement at site first' } });
  });

  let pr2;
  await step('Sameer can also approve by replying on WhatsApp; a message from anyone else is a normal message', async () => {
    const g = await P(siteeng), line = g.budget.lines.find((l) => l.rmc > 0).key;
    pr2 = (await P(siteeng, { op: 'request', data: { material: 'RMC', items: [{ spec: 'M40', qty: 30 }], line, wing: g.wings[line.split('|')[0]][0] } })).doc;
    const W = require('../lib/whatsapp');
    const msg = (from, body, id) => fetch(`${BASE}/api/whatsapp?k=${W.hookKey()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: { messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), text: { body }, type: 'text' }] } }) });
    wa.length = 0;
    await msg('919800000002', `approve ${pr2.no}`, 'w1');
    let o = await kv.hget('po:orders', pr2.id);
    assert.equal(o.status, 'requested'); assert.match(o.history.at(-1).did, /WhatsApp/);
    const reply = wa.find((x) => x.url.includes('agent-reply'));
    assert.ok(reply && /approved/.test(reply.body.reply.message) && reply.body.to === '+919800000002');
    await msg('919800000077', `approve ${pr2.no}`, 'w2'); // not an approver: stays a normal incoming message
    const db = require('../lib/db');
    assert.ok(await db.one("select 1 as x from communications where provider_id = 'w2'"));
    assert.ok(!(await db.one("select 1 as x from communications where provider_id = 'w1'")));
  });

  await step('Purchase orders with rates; site receives with the challan photo; it lands in the site materials log too', async () => {
    const o1 = await P(buyer1, { op: 'order', id: pr1.id, data: { vendor: 'Kamdhenu Steel', items: [{ spec: '12 mm', qty: 4, rate: 60000 }, { spec: '16 mm', qty: 6, rate: 59000 }], amount: 594000, billNo: 'B-77' } });
    assert.equal(o1.status, 200, o1.error);
    const g = await P(siteeng), so = g.orders[pr1.id];
    assert.equal(so.order.vendor, 'Kamdhenu Steel'); assert.equal(so.order.amount, undefined); assert.equal(so.order.rate, undefined); assert.ok(so.order.items.every((i) => i.rate == null));
    assert.ok(so.history.every((h) => !/₹/.test(h.note || '')));
    assert.equal((await P(siteeng, { op: 'receive', id: pr1.id, data: { items: [{ spec: '12 mm', qty: 4 }, { spec: '16 mm', qty: 5.8 }], challan: 'DC-1182', date: '2999-01-01', photo: JPEG } })).status, 400);
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const r = await P(siteeng, { op: 'receive', id: pr1.id, data: { items: [{ spec: '12 mm', qty: 4 }, { spec: '16 mm', qty: 5.8 }], challan: 'DC-1182', date: today, photo: JPEG, vehicle: 'MH04 AB 1234' } });
    assert.equal(r.status, 200, r.error); assert.equal(r.doc.receipt.photo, true); assert.equal(r.doc.order.amount, undefined); assert.equal(r.doc.flags.short, true);
    const ph = await siteeng(`/api/me?purchase=1&photo=${pr1.id}`, null, true);
    assert.equal(ph.headers.get('content-type'), 'image/jpeg');
    const day = await kv.hget('site:materials', today);
    const it = day.items['po' + pr1.id];
    assert.equal(it.type, 'in'); assert.equal(it.material, 'steel'); assert.equal(it.qty, 9.8); assert.equal(it.challan, 'DC-1182'); assert.equal(it.po, pr1.no); assert.equal(it.supplier, 'Kamdhenu Steel');
    const am = await P(acc); assert.equal(am.orders[pr1.id].order.amount, 594000); // Accounts still sees the bill
  });

  await step('A problem report can carry a photo, kept apart from the entry', async () => {
    const r = await siteeng('/api/site', { op: 'add', col: 'hindrances', data: { tower: 'A', category: 'Labour shortage', from: '2026-10-30', description: 'Only 20 men today', status: 'open', photo: JPEG } });
    assert.equal(r.status, 200, r.error); assert.ok(r.doc.photo); assert.ok(!String(JSON.stringify(r.doc)).includes('base64'));
    const ph = await siteeng(`/api/site?photo=${encodeURIComponent(r.doc.photo)}`, null, true);
    assert.equal(ph.headers.get('content-type'), 'image/jpeg');
    assert.equal((await siteeng('/api/site', { op: 'add', col: 'hindrances', data: { description: 'x', photo: 'data:text/html;base64,PGI+' } })).status, 400);
  });

  await step('A request waiting more than 24 hours gets one reminder to Management, and nothing to the Admin', async () => {
    const g = await P(siteeng), line = g.budget.lines.find((l) => l.rmc > 0).key;
    const pr = (await P(siteeng, { op: 'request', data: { material: 'RMC', items: [{ spec: 'M25', qty: 12 }], line, wing: g.wings[line.split('|')[0]][0] } })).doc;
    const o = await kv.hget('po:orders', pr.id); o.requestedAt = new Date(Date.now() - 25 * 3600e3).toISOString(); await kv.hset('po:orders', pr.id, o);
    const before = mails.length;
    const r = await sa.runApprovals();
    assert.equal(r.escalated, 1);
    assert.equal(mails.length, before + 1); // the reminder to Management only
    assert.ok((await kv.hget('po:orders', pr.id)).escalatedAt);
    assert.equal((await sa.runApprovals()).escalated, 0);
  });

  await step('The 10 am summary: attention items, over-budget requests, cash needed in 14 days; once a day unless sent by hand', async () => {
    const s = await sa.buildSummary();
    assert.match(s.text, /NEEDS ATTENTION/); assert.match(s.text, /CASH NEEDED IN THE NEXT 14 DAYS/); assert.match(s.subject, /10 am summary/);
    assert.equal(s.wa.length, 5); assert.ok(s.wa.every((v) => !/\n/.test(v)));
    const before = mails.length;
    const r1 = await sa.sendSummary(); assert.equal(r1.email.sent, true); assert.deepEqual(r1.email.to, ['test@test.local']);
    assert.match((await sa.sendSummary()).skipped, /Already sent/);
    assert.equal(mails.length, before + 1);
    const v = await sameer('/api/mgmt', { action: 'summary' }); assert.equal(v.ok, true); assert.ok(v.approvers.some((p) => p.name === 'Sameer'));
    assert.equal((await sameer('/api/mgmt', { action: 'summary-settings', settings: { summaryTemplate: 'x' } })).status, 403);
    assert.equal((await admin('/api/mgmt', { action: 'summary-settings', settings: { summaryTemplate: 'daily_ab', approvalTemplate: 'appr_cd' } })).settings.approvalTemplate, 'appr_cd');
    wa.length = 0; await sa.sendSummary({ force: true });
    const t = wa.find((x) => x.body && x.body.template_id === 'daily_ab'); assert.ok(t); assert.equal(t.body.to, '919800000002'); assert.equal(t.body.sample.bodyvar.length, 5);
  });

  await step('With the approval template set, the request also goes on WhatsApp with six values', async () => {
    wa.length = 0;
    const g = await P(siteeng), line = g.budget.lines.find((l) => l.steel > 0).key;
    await P(siteeng, { op: 'request', data: { material: 'Steel', items: [{ spec: '8 mm', qty: 2 }], line, wing: g.wings[line.split('|')[0]][0] } });
    const t = wa.find((x) => x.body && x.body.template_id === 'appr_cd');
    assert.ok(t); assert.equal(t.body.sample.bodyvar.length, 6); assert.match(t.body.sample.bodyvar[5], /\/approve\?t=/);
  });

  await step('Contractor per sq ft: steel and cement checked against norms, recovered at our cost; final measurement settles and releases retention', async () => {
    const C = (c, body, qs = '') => c('/api/me?contracts=1' + qs, body);
    const g = await C(buyer1); assert.equal(g.status, 200, g.error);
    // Mandal's signed work order is already entered, waiting for Management (once only)
    const md = Object.values(g.wos).find((x) => /Mandal/.test(x.contractor));
    assert.ok(md); assert.equal(md.status, 'pending_approval'); assert.equal(md.area * md.sqftRate, 884488500); assert.equal(md.items.length, 15); assert.equal(md.advance, 44224425);
    assert.equal(md.advanceAt, md.items[2].id); assert.equal(md.areaFactors.length, 20); assert.equal(md.wastage.steelPct, 3); assert.equal(md.gstPct, 18);
    assert.equal(Object.values((await C(buyer1)).wos).filter((x) => /Mandal/.test(x.contractor)).length, 1);
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
    assert.equal((await C(buyer1, { op: 'wo_file', id: md.id, data: { data: pdf, name: 'Mandal_WO.pdf' } })).status, 200);
    const fr = await buyer1(`/api/me?contracts=1&file=${md.id}`, null, true); assert.equal(fr.headers.get('content-type'), 'application/pdf');
    const tower = Object.keys(g.cast)[0] || 'T1';
    const w = await C(buyer1, { op: 'wo_save', data: { contractor: 'Test Builders', scope: 'RCC labour', retentionPct: 5, tdsPct: 1, towers: [tower],
      norms: { steelKgPerSqft: 4, cementBagsPerSqft: 0.4 }, wastage: { steelPct: 3, steelRate: 60000, cementPct: 2, cementRate: 400 },
      items: [{ desc: 'RCC structure labour', unit: 'sq ft', rate: 300, qty: 10000 }] } });
    assert.equal(w.status, 200, w.error); const wo = w.wo || Object.values((await C(buyer1)).wos).find((x) => x.contractor === 'Test Builders');
    assert.equal((await C(sameer, { op: 'wo_approve', id: wo.id })).status, 200);
    const day = '2026-10-29';
    await kv.hset('site:materials', day, { date: day, items: { a: { type: 'used', material: 'steel', qty: 9, tower }, b: { type: 'used', material: 'cement', qty: 900, tower } } });
    // bill 1: 2,000 sq ft; recovery suggestion from the norms
    const item = wo.items[0].id;
    const sg = (await C(buyer1, null, `&suggest=${wo.id}&from=2026-10-01&to=2026-10-30`)).suggestion;
    assert.ok(sg.normCalc && sg.normCalc.issued.steel === 9 && sg.normCalc.prevArea === 0); // the form works the recovery out from the sq ft typed
    const b1 = await C(buyer1, { op: 'bill_save', data: { woId: wo.id, from: '2026-10-01', to: '2026-10-30', lines: [{ itemId: item, qty: 2000 }], materialRecovery: 0 } });
    assert.equal(b1.status, 200, b1.error); assert.equal(b1.bill.totals.gross, 600000); assert.equal(b1.bill.totals.retention, 30000);
    const sg2 = (await C(buyer1, null, `&suggest=${wo.id}&from=2026-10-01&to=2026-10-30`)).suggestion; // the draft counts as billed area
    assert.equal(sg2.check.steel.allowed, 8.24); assert.equal(sg2.check.steel.excess, 0.76); assert.equal(sg2.check.cement.excess, 84);
    assert.equal(sg2.material, 45600 + 33600);
    await C(buyer1, { op: 'bill_save', id: b1.bill.id, data: { from: '2026-10-01', to: '2026-10-30', lines: [{ itemId: item, qty: 2000 }], materialRecovery: sg2.material } });
    assert.equal((await C(buyer1, { op: 'bill_submit', id: b1.bill.id, data: {} })).status, 200);
    assert.equal((await C(sameer, { op: 'bill_approve', id: b1.bill.id, data: {} })).status, 200);
    // nothing more to recover once it was deducted
    assert.equal((await C(buyer1, null, `&suggest=${wo.id}&from=2026-10-01&to=2026-10-30`)).suggestion.material, 0);
    // final measurement: 2,100 sq ft certified → 100 sq ft more, retention released
    const f = await C(buyer1, { op: 'bill_save', data: { woId: wo.id, final: true, from: '2026-10-31', to: '2026-10-31', lines: [{ itemId: item, final: 2100 }] } });
    assert.equal(f.status, 200, f.error); assert.match(f.bill.no, /FINAL$/);
    assert.equal(f.bill.totals.gross, 30000); assert.equal(f.bill.totals.retention, 0); assert.equal(f.bill.totals.released, 30000); assert.equal(f.bill.totals.net, 30000 - 300 + 30000);
    assert.equal((await C(buyer1, { op: 'bill_save', data: { woId: wo.id, from: '2026-11-01', to: '2026-11-02', lines: [{ itemId: item, qty: 10 }] } })).status, 409);
    await C(buyer1, { op: 'bill_submit', id: f.bill.id, data: {} }); await C(sameer, { op: 'bill_approve', id: f.bill.id, data: {} });
    assert.equal((await C(acc, { op: 'bill_paid', id: f.bill.id, data: { amount: f.bill.totals.net, ref: 'UTR1', date: '2026-10-31' } })).status, 200);
    assert.equal((await C(buyer1)).wos[wo.id].status, 'closed');
  });

  await step('Payment schedule (Mandal): % of contract value by stage and slab, GST, advance in full at plinth, Mivan instalments, final by area statement, retention released', async () => {
    const C = (c, body, qs = '') => c('/api/me?contracts=1' + qs, body);
    const r2 = (n) => Math.round(n * 100) / 100;
    const stages = [['Excavation', 3, 1], ['Foundation completion', 6, 1], ['Plinth completion', 9, 1], ['Completion of 11th to 34th slab', 28.8, 24], ['Everything else', 53.2, 1]];
    const w = await C(buyer1, { op: 'wo_save', data: { mode: 'schedule', contractor: 'Mandal Infrastructure', area: 982765, sqftRate: 900, gstPct: 18, retentionPct: 5, tdsPct: 2, payDays: 15,
      advance: 44224425, advanceAtIndex: 2, recoveries: [{ name: 'Mivan formwork', total: 1000000, perBill: 250000 }], areaFactors: [{ name: 'Residential', factor: 100 }, { name: 'Basement', factor: 150 }],
      items: stages.map(([desc, pct, count]) => ({ desc, pct, count })) } });
    assert.equal(w.status, 200, w.error);
    const wo = w.wo, V = 982765 * 900, id = (i) => wo.items[i].id;
    assert.equal(wo.advanceAt, id(2)); assert.equal(wo.items[3].unit, 'slab'); assert.equal(wo.items[3].rate, r2(V * 28.8 / 100 / 24));
    assert.equal((await C(buyer1, { op: 'wo_save', data: { mode: 'schedule', contractor: 'X', area: 1, sqftRate: 1, items: [{ desc: 'a', pct: 50 }] } })).status, 400); // must add up to 100%
    await C(sameer, { op: 'wo_approve', id: wo.id });
    const bill = async (data) => { const r = await C(buyer1, { op: 'bill_save', data: { woId: wo.id, from: '2026-01-01', to: '2026-01-31', ...data } }); assert.equal(r.status, 200, r.error); await C(buyer1, { op: 'bill_submit', id: r.bill.id, data: {} }); assert.equal((await C(sameer, { op: 'bill_approve', id: r.bill.id, data: {} })).status, 200); return r.bill; };
    // RA 1: excavation
    const b1 = await bill({ lines: [{ itemId: id(0), qty: 1 }], recoveries: [{ id: wo.recoveries[0].id, amount: 250000 }] });
    const g1 = r2(V * 0.03);
    assert.equal(b1.totals.gross, g1); assert.equal(b1.totals.gst, r2(g1 * 0.18)); assert.equal(b1.totals.retention, r2(g1 * 0.05)); assert.equal(b1.totals.tds, r2(g1 * 0.02)); assert.equal(b1.totals.advance, 0);
    assert.equal(b1.totals.recovery, 250000); assert.equal(b1.totals.net, r2(g1 + g1 * 0.18 - g1 * 0.05 - g1 * 0.02 - 250000));
    // RA 2: foundation + plinth + 3 slabs: the advance comes back in full; Mivan suggestion is the next instalment
    const sg = (await C(buyer1, null, `&suggest=${wo.id}&from=2026-02-01&to=2026-02-28`)).suggestion;
    assert.equal(sg.recoveries[0].amount, 250000); assert.equal(sg.recoveries[0].left, 750000);
    const pv = await C(buyer1, { op: 'bill_preview', data: { woId: wo.id, lines: [{ itemId: id(1), qty: 1 }, { itemId: id(2), qty: 1 }, { itemId: id(3), qty: 3 }] } });
    assert.equal(pv.totals.advance, 44224425); assert.equal(pv.totals.gross, r2(r2(V * 0.06) + r2(V * 0.09) + 3 * wo.items[3].rate));
    const b2 = await bill({ lines: [{ itemId: id(1), qty: 1 }, { itemId: id(2), qty: 1 }, { itemId: id(3), qty: 3 }], recoveries: [{ id: wo.recoveries[0].id, amount: 900000 }] });
    assert.equal(b2.totals.advance, 44224425); assert.equal(b2.totals.recovery, 750000); // never more than is left
    // final: area statement 9,00,000 residential + 60,000 basement at 150% = 9,90,000 sq ft
    const before = r2(b1.totals.gross + b2.totals.gross);
    const f = await bill({ final: true, areaRows: [{ name: 'Residential', area: 900000, factor: 100 }, { name: 'Basement', area: 60000, factor: 150 }], extras: [{ name: 'Floor height extra', amount: 100000 }] });
    assert.equal(f.lines[0].qty, 990000); assert.equal(f.totals.gross, r2(990000 * 900 + 100000 - before)); assert.equal(f.totals.retention, r2(f.totals.gross * 0.05)); assert.equal(f.totals.released, 0);
    await C(acc, { op: 'bill_paid', id: f.id, data: { amount: f.totals.net, ref: 'UTR9', date: '2026-03-01' } });
    // retention back in two halves, never more than held
    const held = r2(b1.totals.retention + b2.totals.retention + f.totals.retention);
    const rs = (await C(buyer1, null, `&suggest=${wo.id}`)).suggestion.retention; assert.equal(rs.held, held); assert.equal(rs.left, held);
    const rel1 = await bill({ kind: 'release', releaseAmount: r2(held / 2), releaseNote: 'RCC complete' });
    assert.match(rel1.no, /RET-1$/); assert.equal(rel1.totals.net, r2(held / 2));
    const rel2 = await bill({ kind: 'release', releaseAmount: held });
    assert.equal(rel2.totals.released, r2(held - r2(held / 2)));
  });

  await step('The challan reader\'s answer is cleaned (numbers, dates, lengths); it is off without an API key', async () => {
    const R = require('../lib/challan-read');
    assert.equal(R.configured(), false);
    const p = R.parse('Here: {"challan":"DC 991","date":"2026-10-30","vendor":"Kamdhenu","vehicle":"MH04","items":[{"description":"TMT 12 mm","qty":"4,000","unit":"kg"}],"unclear":""}');
    assert.equal(p.challan, 'DC 991'); assert.equal(p.items[0].qty, 4000); assert.equal(p.date, '2026-10-30');
    assert.equal(R.parse('{"date":"30/10/2026","items":[]}').date, '');
  });

  console.log(`\nAll ${passed} site and purchase checks passed.`);
  server.close(); smtp.close(); ccm.close(); await wait(50); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
