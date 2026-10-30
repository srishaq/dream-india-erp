// Construction, second set: a payment-stage slab cast tells Head CRM, the pour log and cube tests (failures on the
// Management dashboard), the 6 pm daily-report reminder, and contractor work orders with RA bills.
// DATABASE_URL=postgres://... (EMPTY database) node scripts/test-construction.js
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
const server = require('./dev-server');
const net = require('net');
const mails = [];
const smtp = net.createServer((sock) => {
  sock.setEncoding('utf8'); let data = false, buf = '', authStep = 0, cur = { to: [] };
  sock.write('220 test\r\n');
  sock.on('data', (d) => {
    buf += d;
    if (data) { const i = buf.indexOf('\r\n.\r\n'); if (i >= 0) { mails.push(cur); cur = { to: [] }; data = false; buf = buf.slice(i + 5); sock.write('250 ok\r\n'); } return; }
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
}).listen(2546);
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2546', SMTP_TLS: '0', SMTP_USER: 'erp@test.local', SMTP_PASS: 'x' });
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
let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addD = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Rafi', username: 'admin', password: 'admin-password-1' });
  const m = await admin('/api/masters'), sig = m.projects.find((p) => p.code === 'SIGNATURE');
  const people = {};
  for (const [username, role, email] of [['sitehead', 'site_head', 'site@test.local'], ['sameer', 'management', 'sameer@test.local'], ['buyer1', 'purchase_team', ''], ['acc', 'head_accounts', ''], ['headcrm', 'head_crm', 'crm@test.local']]) {
    const r = await admin('/api/users', { action: 'create', name: username, username, role, email, projects: [sig.id] });
    const c = client();
    await c('/api/session', { action: 'login', username, password: r.tempPassword });
    await c('/api/session', { action: 'password', current: r.tempPassword, next: `${username}-password-1` });
    people[username] = c;
  }
  const { sitehead, sameer, buyer1, acc, headcrm } = people;
  { const ls = await headcrm('/api/letters', { action: 'settings', testEmail: 'test@test.local' }); assert.equal(ls.ok, true, JSON.stringify(ls)); }
  const db = require('../lib/db'), kv = require('../lib/portal/kv');
  const site = await sitehead('/api/site'); // seeds the slab schedule
  const A = site.towers.a, slab = (n) => A.slabs.find((s) => s.name === n);
  const cast = (id, date) => sitehead('/api/site', { op: 'set', col: 'progress', id, data: { status: 'cast', stage: 'cast', actualStart: date, actualEnd: date } });

  await step('A payment-stage slab cast (5th Slab) gives Head CRM a high-priority To-Do and an email; an ordinary slab, a repeat and the Rehab tower do not', async () => {
    const before = mails.length;
    assert.equal((await cast(slab('4th Slab').id, today)).status, 200);
    assert.equal((await db.one("select count(*)::int as n from daily_tasks where key like 'slab-stage:%'")).n, 0);
    await cast(slab('5th Slab').id, today);
    const t = await db.one("select * from daily_tasks where key like 'slab-stage:%'");
    assert.ok(t); assert.equal(t.dept, 'crm'); assert.equal(t.priority, 'high'); assert.match(t.title, /5th Slab cast/); assert.match(t.title, /On Completion of 5th Slab/);
    assert.equal(t.assigned_to, (await db.one("select id from users where username = 'headcrm'")).id);
    assert.equal(mails.length, before + 1); assert.deepEqual(mails.at(-1).to, ['test@test.local']);
    await cast(slab('5th Slab').id, today); // saved again: already cast, nothing new
    const R = site.towers.rehab; await cast(R.slabs.find((s) => /^5th/.test(s.name)).id, today);
    assert.equal((await db.one("select count(*)::int as n from daily_tasks where key like 'slab-stage:%'")).n, 1);
    const S = require('../lib/slab-stage');
    assert.equal(S.stageFor(A, A.slabs[0]), 'On Completion of Plinth');
    assert.equal(S.stageFor(A, [...A.slabs].sort((a, b) => a.seq - b.seq).at(-1)), 'On Completion of Top Slab');
  });

  let pour;
  await step('Pour log: cube results are stamped with who entered them; a failed 28-day result and a late test reach the Management dashboard', async () => {
    const r = await sitehead('/api/site', { op: 'add', col: 'pours', data: { date: addD(today, -30), grade: 'M40', tower: 'a', slab: slab('4th Slab').id, element: 'Slab & beams', qty: 210, sets: 2, cubes: { d7: { due: addD(today, -23) }, d28: { due: addD(today, -2) } } } });
    assert.equal(r.status, 200, r.error); pour = r.id; assert.equal(r.doc.createdBy, 'sitehead');
    let mg = await sameer('/api/mgmt');
    const cubes = mg.sections.find((s) => s.key === 'site').tiles.find((t) => t.key === 'cubes');
    assert.equal(cubes.raw.overdue.length, 2);
    assert.ok(mg.daily.attention.some((a) => /cube test results? not entered/.test(a.text)));
    const u = await sitehead('/api/site', { op: 'update', col: 'pours', id: pour, data: { cubes: { d7: { mpa: 30 }, d28: { mpa: 36.5 } } } });
    assert.equal(u.doc.cubes.d28.by, 'sitehead');
    mg = await sameer('/api/mgmt');
    assert.ok(mg.daily.attention.some((a) => /below the pass mark: .*28-day 36.5/.test(a.text)), JSON.stringify(mg.daily.attention));
    assert.ok(!mg.daily.attention.some((a) => /7-day/.test(a.text))); // 30 ≥ 65% of 40
    const s = await require('../lib/staff-alerts').buildSummary();
    assert.match(s.text, /below the pass mark/);
  });

  await step('6 pm reminder: emailed to the site team when no daily report is in, once; not when the report is in. No report yesterday shows on the dashboard', async () => {
    const SA = require('../lib/staff-alerts');
    const before = mails.length;
    const r = await SA.dprReminder(); assert.equal(r.sent, true); assert.deepEqual(r.to, ['test@test.local']);
    assert.match((await SA.dprReminder()).skipped, /Already/);
    assert.equal(mails.length, before + 1);
    await sitehead('/api/site', { op: 'set', col: 'dpr', id: addD(today, -3), data: { date: addD(today, -3), total: 40 } });
    let mg = await sameer('/api/mgmt'); assert.ok(mg.daily.attention.some((a) => /No daily progress report from site yesterday/.test(a.text)));
    await sitehead('/api/site', { op: 'set', col: 'dpr', id: today, data: { date: today, total: 52 } });
    assert.match((await SA.dprReminder({ force: true })).skipped, /in/);
    assert.equal((await sitehead('/api/site', { op: 'translate', text: 'aaj slab ka shuttering hua' })).status, 409); // no AI key here
  });

  let wo;
  await step('Work orders: site has no access; one entered by Purchase waits for Management; the maker cannot approve their own', async () => {
    assert.equal((await sitehead('/api/me?contracts=1')).status, 403);
    const r = await buyer1('/api/me?contracts=1', { op: 'wo_save', data: { contractor: 'Mandal Constructions', company: 'Prime Realtors', scope: 'RCC structure, A Wing, labour only', retentionPct: 5, tdsPct: 1, advance: 500000, advanceRecoveryPct: 10, towers: ['a'],
      wastage: { rmcPct: 2, steelPct: 3, rmcRate: 7758, steelRate: 62000 },
      items: [{ desc: 'RCC slab labour incl. shuttering', unit: 'sqm', rate: 480, qty: 40000, link: { tower: 'a' }, perSlab: 850 }, { desc: 'Blockwork labour', unit: 'sqm', rate: 95, qty: 30000 }] } });
    assert.equal(r.status, 200, r.error); wo = r.wo; assert.equal(wo.status, 'pending_approval'); assert.equal(wo.no, 'WO-001');
    assert.equal((await buyer1('/api/me?contracts=1', { op: 'bill_save', data: { woId: wo.id, from: today, to: today, lines: [{ itemId: wo.items[1].id, qty: 10 }] } })).status, 409);
    assert.equal((await buyer1('/api/me?contracts=1', { op: 'wo_approve', id: wo.id })).status, 403);
    assert.equal((await sameer('/api/me?contracts=1', { op: 'wo_approve', id: wo.id })).wo.status, 'active');
  });

  let b1;
  await step('RA bill 1: slab quantity suggested from slabs cast (× 850 sqm), material recovery from excess RMC; totals worked out; Management approves; Accounts pay', async () => {
    // site logged RMC used above the design quantity for A Wing in the period
    await kv.hset('site:materials', today, { date: today, items: { x1: { type: 'used', material: 'rmc', qty: 220, theo: 200, tower: 'a' }, x2: { type: 'used', material: 'steel', qty: 10, theo: 10, tower: 'a' }, x3: { type: 'used', material: 'rmc', qty: 99, theo: 10, tower: 'b' } } });
    const g = await buyer1(`/api/me?contracts=1&suggest=${wo.id}&from=${addD(today, -40)}&to=${today}`);
    const slabsCast = g.cast.a.slabs.length; assert.equal(slabsCast, 2); // 4th and 5th
    assert.equal(g.suggestion.qty[wo.items[0].id], slabsCast * 850);
    assert.equal(g.suggestion.material, Math.round((220 - 204) * 7758 * 100) / 100); // 2% allowed on 200 m³; B Wing not this contractor's
    const r = await buyer1('/api/me?contracts=1', { op: 'bill_save', data: { woId: wo.id, from: addD(today, -40), to: today, billNo: 'MC/07', lines: [{ itemId: wo.items[0].id, qty: 1700 }, { itemId: wo.items[1].id, qty: 400 }], materialRecovery: g.suggestion.material, otherDeduction: 2500 } });
    assert.equal(r.status, 200, r.error); b1 = r.bill;
    const t = b1.totals, gross = 1700 * 480 + 400 * 95;
    assert.equal(t.gross, gross); assert.equal(t.retention, gross * 0.05); assert.equal(t.tds, gross * 0.01); assert.equal(t.advance, gross * 0.10);
    assert.equal(t.net, Math.round((gross * 0.84 - g.suggestion.material - 2500) * 100) / 100);
    assert.equal(b1.no, 'WO-001/RA-01');
    assert.equal((await buyer1('/api/me?contracts=1', { op: 'bill_submit', id: b1.id })).bill.status, 'pending_approval');
    assert.equal((await acc('/api/me?contracts=1', { op: 'bill_paid', id: b1.id, data: { amount: 1, ref: 'x', date: today } })).status, 409);
    assert.equal((await sameer('/api/me?contracts=1', { op: 'bill_reject', id: b1.id, data: {} })).status, 400);
    const mg = await sameer('/api/mgmt'); assert.ok(mg.daily.top.find((x) => x.key === 'approvals').sub.includes('contractor bill'));
    assert.equal((await sameer('/api/me?contracts=1', { op: 'bill_approve', id: b1.id })).bill.status, 'approved');
    assert.match((await require('../lib/staff-alerts').buildSummary()).text, /contractor RA bills to pay: ₹/);
    const p = await acc('/api/me?contracts=1', { op: 'bill_paid', id: b1.id, data: { amount: t.net, ref: 'UTR123', date: today } });
    assert.equal(p.bill.status, 'paid');
  });

  await step('RA bill 2: previous quantities carried, advance recovery stops at the advance, an item beyond the contract needs a note', async () => {
    const r = await buyer1('/api/me?contracts=1', { op: 'bill_save', data: { woId: wo.id, from: addD(today, 1), to: addD(today, 1), lines: [{ itemId: wo.items[0].id, qty: 39000 }] } });
    const l = r.bill.lines.find((x) => x.itemId === wo.items[0].id);
    assert.equal(l.before, 1700); assert.equal(l.cum, 40700); assert.equal(l.over, true);
    assert.equal(r.bill.totals.advance, Math.round((500000 - b1.totals.advance) * 100) / 100); // only what is left of the advance
    assert.equal((await buyer1('/api/me?contracts=1', { op: 'bill_submit', id: r.bill.id })).status, 400);
    assert.equal((await buyer1('/api/me?contracts=1', { op: 'bill_submit', id: r.bill.id, data: { note: 'Extra slab area per revised drawing' } })).bill.status, 'pending_approval');
    // an item already billed cannot be dropped from the work order
    const w2 = { ...wo, items: [wo.items[1]] };
    assert.equal((await sameer('/api/me?contracts=1', { op: 'wo_save', id: wo.id, data: w2 })).status, 409);
  });

  console.log(`\nAll ${passed} construction checks passed.`);
  server.close(); smtp.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
