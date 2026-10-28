// Changes asked for in the staff training: booking edit (Head CRM only), payment receipts, SDR challans (no duplicates),
// letter settings, PDCs for six months, CP ledger, unit transfers, unsold cost list, replies waiting, install as an app.
// DATABASE_URL=postgres://... node scripts/test-training.js   (an empty database)
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3993';
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = process.env.SMTP_PORT || '2526'; process.env.SMTP_TLS = '0';
process.env.SMTP_USER = 'crm@test.local'; process.env.SMTP_PASS = 'x';
const net = require('net');
const sent = [];
const smtp = net.createServer((c) => {
  c.write('220 test\r\n'); let data = false, buf = '';
  c.on('data', (d) => {
    buf += d.toString();
    if (data) { if (buf.includes('\r\n.\r\n')) { sent.push(buf); buf = ''; data = false; c.write('250 ok\r\n'); } return; }
    const lines = buf.split('\r\n'); buf = lines.pop();
    for (const l of lines) {
      if (/^EHLO/i.test(l)) c.write('250 ok\r\n');
      else if (/^AUTH LOGIN/i.test(l)) c.write('334 VXNlcm5hbWU6\r\n');
      else if (/^[A-Za-z0-9+/=]+$/.test(l) && !/^(MAIL|RCPT|DATA|QUIT|RSET)/.test(l)) c.write(c.u ? '235 ok\r\n' : (c.u = 1, '334 UGFzc3dvcmQ6\r\n'));
      else if (/^DATA/i.test(l)) { data = true; c.write('354 go\r\n'); }
      else if (/^QUIT/i.test(l)) { c.write('221 bye\r\n'); c.end(); }
      else c.write('250 ok\r\n');
    }
  });
}).listen(+process.env.SMTP_PORT);
const server = require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, raw) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
const day = (k) => new Date(Date.now() + 5.5 * 3600000 + k * 864e5).toISOString().slice(0, 10);
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
  assert.equal((await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } })).ok, true);
  for (const [un, name, role] of [['crm1', 'Neha', 'crm'], ['hcrm', 'Tejaswini', 'head_crm'], ['acc1', 'Ravi', 'accounts'], ['hacc', 'Head Acc', 'head_accounts']])
    await db.q('insert into users (username, name, role, password_hash, all_projects) values ($1, $2, $3, $4, true)', [un, name, role, auth.hashPassword('test-pass-123')]);
  const login = async (un) => { const c = client(); const r = await c('/api/session', { action: 'login', username: un, password: 'test-pass-123' }); assert.equal(r.status, 200, JSON.stringify(r)); return c; };
  const crm = await login('crm1'), hcrm = await login('hcrm'), acc = await login('acc1'), hacc = await login('hacc');
  const bks = (await admin(`/api/bookings?project=${sig.id}`)).rows.filter((r) => r.status === 'active');
  const b1 = bks[0];
  await admin('/api/letters', { action: 'settings', testEmail: 'me@test.local', signatory: 'Syed Rafi Ishaq', signatoryTitle: 'Chairman & MD', banks: [{ particulars: 'Flat Cost', favouring: 'PRIME REALTORS RERA', bank: 'YES BANK', accountNo: '0928 7250 0000 700', ifsc: 'yesb0000928', branch: 'Vikhroli' }] });

  await step('booking edit: only Head CRM, with a reason; a new agreement value re-works the demands', async () => {
    assert.equal((await crm('/api/bookings', { action: 'edit', id: b1.id, agreementValue: 1, reason: 'x' })).status, 403);
    assert.equal((await hcrm('/api/bookings', { action: 'edit', id: b1.id, agreementValue: 9900000 })).status, 400, 'reason needed');
    const before = await db.q("select amount, pct from demands where booking_id = $1 and status = 'raised' and not opening", [b1.id]);
    const r = await hcrm('/api/bookings', { action: 'edit', id: b1.id, agreementValue: 9900000, rmName: 'Neha', reason: 'corrected after registration' });
    assert.equal(r.ok, true, r.error); assert.ok(r.changed.includes('agreement_value'));
    const after = await db.q("select amount, pct from demands where booking_id = $1 and status = 'raised' and not opening order by id", [b1.id]);
    for (const d of after) assert.equal(Number(d.amount), Math.round(9900000 * Number(d.pct)) / 100);
    assert.equal(r.demandsReworked, before.length);
    const log = await db.one("select * from audit_log where entity = 'booking' and action = 'edit' and entity_id = $1", [String(b1.id)]);
    assert.ok(log && /corrected/.test(log.note));
    assert.equal((await hcrm('/api/bookings', { action: 'edit', id: b1.id, agreementValue: 9900000, reason: 'again' })).status, 400, 'nothing changed');
  });
  let rid;
  await step('payment receipt: numbered PDF in order of issue, emailed (test address) with the PDF attached', async () => {
    const c = await crm('/api/receipts', { action: 'create', bookingId: b1.id, receivedOn: day(-1), amount: 105000, mode: 'cheque', bank: 'SBI', instrumentNo: '004512', splits: { av: 100000, gst: 5000 } });
    rid = c.id;
    const p = await crm(`/api/receipts?pdf=${rid}`, null, true);
    assert.equal(p.status, 200); assert.match(p.type, /pdf/); assert.ok(p.buf.length > 5000);
    const no = (await db.one('select receipt_no from receipts where id = $1', [rid])).receipt_no;
    assert.match(no, /^DS\/\d{4}-\d{2}\/0001$/);
    await crm(`/api/receipts?pdf=${rid}`, null, true);
    assert.equal((await db.one('select receipt_no from receipts where id = $1', [rid])).receipt_no, no, 'same number again');
    const c2 = await crm('/api/receipts', { action: 'create', bookingId: b1.id, receivedOn: day(-1), amount: 5000, mode: 'bank', instrumentNo: 'UTR1', splits: { av: 5000 } });
    await crm(`/api/receipts?pdf=${c2.id}`, null, true);
    assert.match((await db.one('select receipt_no from receipts where id = $1', [c2.id])).receipt_no, /0002$/);
    const e = await crm('/api/receipts', { action: 'receipt-email', id: rid });
    assert.equal(e.ok, true, e.error); assert.deepEqual(e.to, ['me@test.local']);
    const m = sent[sent.length - 1]; assert.match(m, /application\/pdf/); assert.match(m, /Receipt_DS/);
    assert.ok(await db.one("select 1 as x from communications where booking_id = $1 and kind = 'receipt'", [b1.id]));
  });
  await step('SDR challans: a second one for the same flat is refused; Head Accounts can add it with a reason; one GRN once', async () => {
    const add = (c, x) => c('/api/sdr', { action: 'add', projectId: sig.id, unit: b1.unit_no, kind: 'stamp_duty', amount: 594000, grn: 'MH0001', challanDate: day(-2), ...x });
    assert.equal((await add(acc)).ok, true);
    const r2 = await add(acc, { grn: 'MH0002' }); assert.equal(r2.status, 409); assert.ok(r2.duplicate);
    assert.equal((await add(acc, { grn: 'MH0002', duplicateReason: 'first failed' })).status, 403, 'needs Head Accounts');
    assert.equal((await add(hacc, { grn: 'MH0001', duplicateReason: 'x' })).status, 409, 'same GRN never twice');
    assert.equal((await add(hacc, { grn: 'MH0002', duplicateReason: 'first challan failed at the bank' })).ok, true);
    assert.equal((await add(acc, { kind: 'registration', amount: 30000, grn: 'MH0003' })).ok, true, 'registration is separate');
    const g = await acc(`/api/sdr?project=${sig.id}`); assert.equal(g.dupes.length, 1);
    const f = await require('../lib/daily-tasks').run('accounts', { mail: false });
    assert.ok(f.found.some((x) => x.key === 'sdr-duplicates'));
  });
  await step('letter settings: signatory and bank details reach the demand letter', async () => {
    const s = (await admin(`/api/letters?project=${sig.id}`)).settings;
    assert.equal(s.signatory, 'Syed Rafi Ishaq'); assert.equal(s.banks[0].accountNo, '092872500000700'); assert.equal(s.banks[0].ifsc, 'YESB0000928');
    assert.equal((await hacc('/api/letters', { action: 'settings', signatoryTitle: 'Chairman & Managing Director' })).ok, true, 'Head Accounts may set them');
  });
  await step('management dashboard: PDCs for the next six months, month by month', async () => {
    await db.q("insert into acc_pdc (book, issued_on, issued_to, amount, bank, due_date) values ('signature', $1, 'RMC Co', 250000, 'HDFC', $2), ('signature', $1, 'Steel Co', 400000, 'HDFC', $3)", [day(0), day(3), day(120)]);
    const m = await admin(`/api/mgmt?project=${sig.id}`);
    const t = m.sections.flatMap((x) => x.tiles).find((x) => /PDC/.test(x.title));
    assert.match(t.title, /6 months/); assert.match(t.value, /^2 ·/);
  });
  if (process.env.TRAINING_PART !== '1') require('./test-training-2')({ admin, crm, hcrm, acc, hacc, sig, bks, db, step, assert, day });
  else { console.log(`\n${n} checks passed`); process.exit(0); }
})().catch((e) => { console.error(e); process.exit(1); });
