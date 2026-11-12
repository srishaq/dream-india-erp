// Two-step staff sign-in (lib/staff-otp.js): password, then a 6-digit code on WhatsApp (Click Connect) or email,
// remembered devices, limits, the break-glass Admin reset, and the Admin's Login security panel.
// DATABASE_URL=postgres://... (EMPTY database) node scripts/test-otp.js
// Unlike the other suites this one does not load login-code-helper.js: it reads the real codes from a fake Click
// Connect and a fake mail server on this machine.
const assert = require('assert/strict');
const net = require('net'), http = require('http');
process.env.PORT = process.env.PORT || '3997';
delete process.env.ERP_TEST_OTP; delete process.env.ERP_LIVE;
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
const MAIL_PORT = +process.env.PORT + 1100, WA_PORT = +process.env.PORT + 1200;

// fake mail server: keeps who each email went to and its subject (the subject carries the code)
const mails = [];
const smtp = net.createServer((sock) => {
  sock.setEncoding('utf8'); let data = false, buf = '', authStep = 0, to = [];
  sock.write('220 test\r\n');
  sock.on('data', (d) => {
    buf += d;
    if (data) { const e = buf.indexOf('\r\n.\r\n'); if (e >= 0) { mails.push({ to, subject: ((buf.match(/^Subject: (.*)$/m) || [])[1] || '').trim() }); to = []; data = false; buf = ''; sock.write('250 ok\r\n'); } return; }
    let i; while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) sock.write('250 hello\r\n');
      else if (/^AUTH LOGIN/i.test(line)) sock.write('334 VXNlcm5hbWU6\r\n');
      else if (/^RCPT TO:<(.+)>/i.test(line)) { to.push(line.match(/<(.+)>/)[1]); sock.write('250 ok\r\n'); }
      else if (/^MAIL FROM/i.test(line) || /^RSET/i.test(line)) sock.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); return sock.emit('data', ''); }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else if (line.length && !/^\s/.test(line)) sock.write(authStep ? '235 ok\r\n' : ((authStep = 1), '334 UGFzc3dvcmQ6\r\n'));
    }
  });
}).listen(MAIL_PORT);
// fake Click Connect: keeps every template send; mode 'fail' refuses, 'button' wants the code as a button value too
const was = []; let waMode = 'ok';
const wa = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const m = b ? JSON.parse(b) : {}; res.setHeader('Content-Type', 'application/json');
    if (waMode === 'fail') { res.statusCode = 400; return res.end(JSON.stringify({ success: false, message: 'Recipient is not on WhatsApp' })); }
    if (waMode === 'button' && !(m.sample && m.sample.buttonvar)) { res.statusCode = 400; return res.end(JSON.stringify({ success: false, message: 'Button parameter missing for template' })); }
    was.push({ url: req.url, ...m });
    res.end(JSON.stringify({ success: true, results: [{ to: m.to, transaction_id: 'TX' + was.length }] }));
  });
}).listen(WA_PORT);
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(MAIL_PORT), SMTP_TLS: '0', SMTP_USER: 'erp@test.local', SMTP_PASS: 'x',
  CCM_API_KEY: 'test-key', CCM_SENDER: '919811100000', CCM_API: 'http://127.0.0.1:' + WA_PORT });
const db = require('../lib/db');
const OTP = require('../lib/staff-otp');
const TPL = 'erp_login_code_test_tpl'; // a WhatsApp template the Admin has entered
let nocontactPw = null;

// a browser: keeps every cookie (session, chat, remembered device)
function client() {
  const jar = {};
  const c = async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    for (const s of r.headers.getSetCookie()) { const [kv] = s.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v && !/Max-Age=0/.test(s)) jar[k] = v; else delete jar[k]; }
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
  c.jar = jar;
  return c;
}
const lastWaCode = () => was[was.length - 1].sample.bodyvar[0];
const lastMailCode = () => (mails[mails.length - 1].subject.match(/^(\d{6}) /) || [])[1];
const age = (sec = 31) => db.q(`update staff_otps set created_at = created_at - make_interval(secs => $1)`, [sec]);
const fresh = () => db.q('delete from staff_otps');

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

(async () => {
  await step('TOTP matches the RFC 6238 test values (SHA-1), and base32 round-trips', async () => {
    const key = Buffer.from('12345678901234567890');
    assert.equal(OTP.hotp(key, Math.floor(59 / 30)), '287082'); assert.equal(OTP.hotp(key, Math.floor(1111111109 / 30)), '081804');
    assert.equal(OTP.hotp(key, Math.floor(1234567890 / 30)), '005924'); assert.equal(OTP.hotp(key, Math.floor(2000000000 / 30)), '279037');
    assert.equal(OTP.b32encode(key), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); assert.deepEqual(OTP.b32decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), key);
  });
  const admin = client();
  let temp, neha = client();
  await step('setup; the Admin adds a login with a mobile and an email', async () => {
    assert.equal((await admin('/api/session', { action: 'setup', name: 'Syed Rafi Ishaq', username: 'rafi', password: 'very-long-password-1' })).ok, true);
    const r = await admin('/api/users', { action: 'create', name: 'Neha CRM', username: 'neha', role: 'crm', phone: '+91 98200 11122', email: 'Neha@Example.com' });
    assert.equal(r.ok, true); temp = r.tempPassword;
    const sec = await admin('/api/users?security=1');
    assert.equal(sec.settings.enforce, true); assert.equal(sec.settings.waOtpTemplate, ''); // required from migration 076 (12 Nov 2026); WhatsApp codes off until a template is set
    assert.equal((await admin('/api/users', { action: 'security', enforce: true, waOtpTemplate: TPL })).ok, true);
    assert.ok(sec.noMobile.some((u) => u.username === 'rafi')); assert.ok(!sec.noMobile.some((u) => u.username === 'neha'));
  });
  let first;
  await step('the right password alone gives no session: the code goes to the person\'s own WhatsApp (not the test mobile)', async () => {
    first = await neha('/api/session', { action: 'login', username: 'neha', password: temp });
    assert.equal(first.otp, true, JSON.stringify(first)); assert.ok(first.token); assert.equal(first.resendAfter, 30);
    assert.match(first.sentTo, /^WhatsApp ••••1122$/); assert.equal(first.canEmail, true);
    assert.ok(!neha.jar.erp_session); assert.equal((await neha('/api/session')).user, null);
    const m = was[was.length - 1];
    assert.equal(m.to, '919820011122'); assert.equal(m.template_id, TPL); assert.equal(m.message_type, 'template');
    assert.deepEqual(Object.keys(m.sample), ['bodyvar']); assert.match(m.sample.bodyvar[0], /^\d{6}$/);
    const row = await db.one('select code_hash, token_hash from staff_otps order by id desc limit 1');
    assert.ok(!row.code_hash.includes(m.sample.bodyvar[0]) && row.token_hash !== first.token); // only hashes kept
    assert.equal((await db.q("select 1 from communications where body like $1", ['%' + m.sample.bodyvar[0] + '%'])).length, 0);
  });
  await step('a wrong code is refused with the tries left; the code from the chat cannot open the ERP', async () => {
    const w = await neha('/api/session', { action: 'login-otp', token: first.token, code: lastWaCode() === '000000' ? '111111' : '000000' });
    assert.equal(w.status, 400); assert.match(w.error, /4 tries left/);
    assert.equal((await neha('/api/chat', { action: 'login-otp', token: first.token, code: lastWaCode() })).status, 400);
  });
  await step('the right code signs in (then the forced password change, as before); this device is remembered', async () => {
    const r = await neha('/api/session', { action: 'login-otp', token: first.token, code: lastWaCode(), remember: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.user.mustChange, true); assert.ok(neha.jar.erp_session && neha.jar.erp_device);
    assert.equal((await neha('/api/session', { action: 'login-otp', token: first.token, code: lastWaCode() })).status, 400); // used once only
    const a = await db.one("select note from audit_log where action = 'login' order by id desc limit 1"); assert.match(a.note, /WhatsApp ••••1122; this device remembered/);
    assert.equal((await neha('/api/session', { action: 'devices' })).devices.length, 1);
    assert.equal((await neha('/api/session', { action: 'password', current: temp, next: 'neha-password-1' })).ok, true);
    assert.equal((await db.one('select count(*)::int as n from staff_devices where revoked_at is null')).n, 0); // the password change ended it
  });
  await step('Remember this device: the next sign-in skips the code; a password change ends that', async () => {
    let r = await neha('/api/session', { action: 'login', username: 'neha', password: 'neha-password-1' }); assert.equal(r.otp, true);
    r = await neha('/api/session', { action: 'login-otp', token: r.token, code: lastWaCode(), remember: true }); assert.equal(r.ok, true);
    await neha('/api/session', { action: 'logout' }); assert.ok(neha.jar.erp_device && !neha.jar.erp_session);
    const before = was.length;
    r = await neha('/api/session', { action: 'login', username: 'neha', password: 'neha-password-1' });
    assert.equal(r.ok, true); assert.ok(!r.otp); assert.equal(was.length, before); assert.ok(neha.jar.erp_session);
    assert.equal((await neha('/api/session', { action: 'login', username: 'neha', password: 'wrong-password-9' })).status, 401); // the password is still needed
    const d = await neha('/api/session', { action: 'devices' }); assert.equal(d.devices.length, 1); assert.equal(d.devices[0].current, true);
    assert.equal((await neha('/api/session', { action: 'password', current: 'neha-password-1', next: 'neha-password-2' })).ok, true);
    await neha('/api/session', { action: 'logout' });
    r = await neha('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal(r.otp, true);
  });
  await step('Send again waits 30 s; "Email me the code instead" emails it and the old code stops working', async () => {
    await fresh();
    const r = await neha('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); const waCode = lastWaCode();
    assert.equal((await neha('/api/session', { action: 'login-resend', token: r.token, email: true })).status, 429);
    await age();
    const m = await neha('/api/session', { action: 'login-resend', token: r.token, email: true });
    assert.equal(m.otp, true); assert.equal(m.sentTo, 'email n***@example.com'); assert.equal(m.canEmail, false);
    assert.deepEqual(mails[mails.length - 1].to, ['neha@example.com']); const code = lastMailCode(); assert.match(code, /^\d{6}$/);
    if (waCode !== code) assert.equal((await neha('/api/session', { action: 'login-otp', token: r.token, code: waCode })).status, 400);
    assert.equal((await neha('/api/session', { action: 'login-otp', token: r.token, code })).ok, true);
  });
  await step('WhatsApp failing sends the code by email; a template that wants a button value gets the code there too', async () => {
    await fresh(); waMode = 'fail';
    let r = await client()('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    assert.equal(r.sentTo, 'email n***@example.com'); assert.match(lastMailCode(), /^\d{6}$/);
    waMode = 'button';
    r = await client()('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    assert.match(r.sentTo, /^WhatsApp/); assert.deepEqual(was[was.length - 1].sample.buttonvar, was[was.length - 1].sample.bodyvar);
    waMode = 'ok';
  });
  await step('five wrong codes end the code; five unused codes in an hour stop more', async () => {
    await fresh();
    const c = client(); const r = await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    const bad = lastWaCode() === '999999' ? '888888' : '999999';
    for (let i = 0; i < 4; i++) assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: bad })).status, 400);
    const last = await c('/api/session', { action: 'login-otp', token: r.token, code: bad }); assert.equal(last.restart, true); assert.match(last.error, /Too many wrong codes/);
    assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: lastWaCode() })).status, 400); // even the right one now
    for (let i = 0; i < 4; i++) assert.equal((await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' })).otp, true);
    const lim = await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal(lim.status, 429, JSON.stringify(lim));
    await fresh();
  });
  await step('DreamComm asks for the code too, and gives only the chat cookie', async () => {
    await fresh();
    const c = client(); const r = await c('/api/chat', { action: 'login', username: 'neha', password: 'neha-password-2' });
    assert.equal(r.otp, true); assert.ok(!c.jar.erp_chat);
    assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: lastWaCode() })).status, 400); // a chat code cannot open the ERP
    assert.equal((await c('/api/chat', { action: 'login-otp', token: r.token, code: lastWaCode() })).ok, true);
    assert.ok(c.jar.erp_chat && !c.jar.erp_session);
  });
  await step('mobile changes are audited; nobody changes their own mobile', async () => {
    const id = (await db.one("select id from users where username = 'neha'")).id;
    assert.equal((await admin('/api/users', { action: 'update', id, name: 'Neha CRM', role: 'crm', phone: '9820099999', email: 'neha@example.com' })).ok, true);
    const a = await db.one("select note from audit_log where action = 'phone' order by id desc limit 1"); assert.match(a.note, /98200 11122|9820099999/);
    const me = (await db.one("select id from users where username = 'rafi'")).id;
    assert.equal((await admin('/api/users', { action: 'update', id: me, name: 'Syed Rafi Ishaq', role: 'admin', allProjects: true, phone: '9820012345' })).ok, true); // filling a blank one is allowed
    // an edited login is signed out: the Admin signs in again, now with a code on that mobile
    await fresh();
    const l = await admin('/api/session', { action: 'login', username: 'rafi', password: 'very-long-password-1' }); assert.equal(l.sentTo, 'WhatsApp ••••2345');
    assert.equal((await admin('/api/session', { action: 'login-otp', token: l.token, code: lastWaCode() })).ok, true);
    const r = await admin('/api/users', { action: 'update', id: me, name: 'Syed Rafi Ishaq', role: 'admin', allProjects: true, phone: '9000000000' });
    assert.equal(r.status, 403); assert.match(r.error, /cannot change your own mobile/);
  });
  await step('a username that is a mobile gets the code there; no email and no app, with no mailbox, is refused', async () => {
    let r = await admin('/api/users', { action: 'create', name: 'Imran Staff', username: '9876543210', role: 'staff' }); const t1 = r.tempPassword;
    r = await client()('/api/session', { action: 'login', username: '9876543210', password: t1 });
    assert.equal(r.sentTo, 'WhatsApp ••••3210'); assert.equal(was[was.length - 1].to, '919876543210'); assert.equal(r.canEmail, false);
    r = await admin('/api/users', { action: 'create', name: 'No Contact', username: 'nocontact', role: 'staff' }); nocontactPw = r.tempPassword;
    const smtpUser = process.env.SMTP_USER; delete process.env.SMTP_USER; // no ERP mailbox: an email cannot be added either
    r = await client()('/api/session', { action: 'login', username: 'nocontact', password: nocontactPw });
    assert.equal(r.status, 403); assert.equal(r.error, 'No email on your login — ask the Admin to add it in Manage users.');
    assert.equal((await client()('/api/chat', { action: 'login', username: 'nocontact', password: nocontactPw })).status, 403);
    const sec = await admin('/api/users?security=1'); assert.ok(sec.unreachable.some((u) => u.username === 'nocontact')); assert.ok(sec.neither.some((u) => u.username === 'nocontact'));
    // only while "Require the code" is off does such a login sign in without one (audited)
    assert.equal((await admin('/api/users', { action: 'security', enforce: false, waOtpTemplate: TPL })).ok, true);
    const c = client(); r = await c('/api/session', { action: 'login', username: 'nocontact', password: nocontactPw });
    assert.equal(r.ok, true); assert.ok(c.jar.erp_session);
    assert.ok(await db.one("select 1 from audit_log where action = 'login-no-code'"));
    assert.ok(await db.one("select 1 from audit_log where action = 'login-security'"));
    assert.equal((await client()('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' })).otp, true); // a login with a mobile still gets a code
    await admin('/api/users', { action: 'security', enforce: true, waOtpTemplate: TPL });
    process.env.SMTP_USER = smtpUser;
  });
  await step('"Add your email": no email and no app → the email typed takes a code, is saved as verified (even while codes are required)', async () => {
    await fresh();
    const c = client(); let r = await c('/api/session', { action: 'login', username: 'nocontact', password: nocontactPw });
    assert.equal(r.otp, true); assert.equal(r.method, 'add-email'); assert.ok(!c.jar.erp_session);
    assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: '123456' })).status, 400); // the email first
    assert.equal((await c('/api/session', { action: 'login-email-add', token: r.token, email: 'not-an-email' })).status, 400);
    const taken = await c('/api/session', { action: 'login-email-add', token: r.token, email: 'NEHA@example.com' });
    assert.equal(taken.status, 409); assert.match(taken.error, /another login/);
    const before = mails.length;
    const m = await c('/api/session', { action: 'login-email-add', token: r.token, email: 'No.Contact@Example.com' });
    assert.equal(m.method, 'code'); assert.equal(m.adding, true); assert.equal(m.sentTo, 'email n***@example.com');
    assert.equal(mails.length, before + 1); assert.deepEqual(mails[mails.length - 1].to, ['no.contact@example.com']);
    assert.equal((await db.one("select email from users where username = 'nocontact'")).email, null); // not saved before the code
    r = await c('/api/session', { action: 'login-otp', token: r.token, code: lastMailCode(), remember: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.user.hasApp, false); assert.ok(c.jar.erp_session && c.jar.erp_device);
    const u = await db.one("select email, email_verified_at from users where username = 'nocontact'");
    assert.equal(u.email, 'no.contact@example.com'); assert.ok(u.email_verified_at);
    assert.match((await db.one("select note from audit_log where action = 'email-add' order by id desc limit 1")).note, /Email added at sign-in: no\.contact@example\.com/);
    // next time: an ordinary email code (no "Add your email" again)
    r = await client()('/api/session', { action: 'login', username: 'nocontact', password: nocontactPw });
    assert.equal(r.method, 'code'); assert.equal(r.sentTo, 'email n***@example.com');
    const sec = await admin('/api/users?security=1'); const row = sec.logins.find((x) => x.username === 'nocontact');
    assert.equal(row.emailVerified, true); assert.equal(row.app, false);
  });
  let nehaApp = null;
  const signedIn = async () => { await fresh(); const c = client(); const r = await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: r.method === 'app' ? appCode() : lastWaCode() })).ok, true); return c; };
  const appCode = (d = 0) => OTP.hotp(OTP.b32decode(nehaApp), Math.floor(Date.now() / 30000) + d);
  await step('sign-in app: the QR code and the key, confirmed with a code from the app; the secret is sealed', async () => {
    await db.q("update users set totp_last_step = null"); await fresh(); waMode = 'ok';
    const c = await signedIn();
    assert.equal((await c('/api/session', { action: 'app' })).hasApp, false);
    const b = await c('/api/session', { action: 'app-begin' });
    assert.match(b.secret, /^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/); nehaApp = b.secret.replace(/ /g, '');
    assert.equal(b.uri, `otpauth://totp/Dream%20India%20ERP:neha?secret=${nehaApp}&issuer=Dream%20India%20ERP`);
    assert.match(b.qr, /^data:image\/svg\+xml;base64,/); assert.match(Buffer.from(b.qr.split(',')[1], 'base64').toString(), /^<svg [^>]*><rect/);
    assert.equal((await c('/api/session', { action: 'app-confirm', code: appCode(-5) })).status, 400);
    const ok = await c('/api/session', { action: 'app-confirm', code: appCode() }); assert.equal(ok.ok, true); assert.equal(ok.hasApp, true);
    const row = await db.one("select totp_secret, totp_pending from users where username = 'neha'");
    assert.ok(/^[ks]1\./.test(row.totp_secret) && !row.totp_secret.includes(nehaApp) && !row.totp_pending);
    assert.equal(await OTP.open(row.totp_secret), nehaApp); // read back from the database with the same key
    assert.equal((await c('/api/session', { action: 'app-begin' })).status, 409); // remove it first
    assert.ok(await db.one("select 1 from audit_log where action = 'app-set'"));
    await db.q("update users set totp_last_step = null where username = 'neha'");
  });
  await step('sign-in with the app: nothing is sent; an old step is refused; a code works once; "Email me a code instead"', async () => {
    await fresh();
    const sent = was.length + mails.length;
    const c = client(); let r = await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    assert.equal(r.method, 'app'); assert.equal(r.canEmail, true); assert.ok(!r.sentTo); assert.equal(was.length + mails.length, sent);
    assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: appCode(-3) })).status, 400); // 90 s old
    const code = appCode();
    r = await c('/api/session', { action: 'login-otp', token: r.token, code, remember: false }); assert.equal(r.ok, true); assert.equal(r.user.hasApp, true);
    assert.match((await db.one("select note from audit_log where action = 'login' order by id desc limit 1")).note, /sign-in app/);
    const c2 = client(); r = await c2('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    const again = await c2('/api/session', { action: 'login-otp', token: r.token, code });
    assert.equal(again.status, 400); assert.match(again.error, /used already/);
    assert.equal((await c2('/api/session', { action: 'login-otp', token: r.token, code: appCode(1) })).ok, true); // the next step is fine
    // "Email me a code instead"
    const c3 = client(); r = await c3('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' });
    const m = await c3('/api/session', { action: 'login-resend', token: r.token, email: true });
    assert.equal(m.method, 'code'); assert.equal(m.sentTo, 'email n***@example.com'); assert.deepEqual(mails[mails.length - 1].to, ['neha@example.com']);
    assert.equal((await c3('/api/session', { action: 'login-otp', token: r.token, code: lastMailCode(), remember: true })).ok, true);
    // a remembered device skips the app too
    await c3('/api/session', { action: 'logout' });
    r = await c3('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal(r.ok, true); assert.ok(!r.otp);
    // DreamComm asks for the app's code as well
    await db.q("update users set totp_last_step = null where username = 'neha'");
    const ch = client(); r = await ch('/api/chat', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal(r.method, 'app');
    assert.equal((await ch('/api/chat', { action: 'login-otp', token: r.token, code: appCode() })).ok, true);
  });
  await step('the person removes their app with an email code; the Admin can reset it (audited)', async () => {
    await db.q("update users set totp_last_step = null where username = 'neha'");
    const c = await signedIn();
    assert.equal((await c('/api/session', { action: 'app-remove', code: '000000' })).status, 400);
    const e = await c('/api/session', { action: 'app-email' }); assert.equal(e.sentTo, 'email n***@example.com');
    let r = await c('/api/session', { action: 'app-remove', token: e.token, code: lastMailCode() }); assert.equal(r.ok, true); assert.equal(r.hasApp, false);
    assert.ok(await db.one("select 1 from audit_log where action = 'app-remove'"));
    const b = await c('/api/session', { action: 'app-begin' }); nehaApp = b.secret.replace(/ /g, '');
    assert.equal((await c('/api/session', { action: 'app-confirm', code: appCode() })).ok, true);
    const id = (await db.one("select id from users where username = 'neha'")).id;
    let sec = await admin('/api/users?security=1'); assert.equal(sec.logins.find((x) => x.id === id).app, true);
    r = await admin('/api/users', { action: 'app-reset', id }); assert.equal(r.ok, true); assert.equal(r.reset, 1);
    assert.equal(r.logins.find((x) => x.id === id).app, false);
    assert.match((await db.one("select note from audit_log where action = 'app-reset' order by id desc limit 1")).note, /Reset the sign-in app of neha/);
    await fresh();
    r = await client()('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal(r.method, 'code'); // back to codes
    await db.q('update staff_devices set revoked_at = now() where revoked_at is null'); // a clean start for the next step
  });
  await step('Sign out all devices, a role change, a reset and disabling all end remembered devices', async () => {
    const id = (await db.one("select id from users where username = 'neha'")).id;
    const remembered = async () => { await fresh(); const c = client(); const r = await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' }); assert.equal((await c('/api/session', { action: 'login-otp', token: r.token, code: lastWaCode(), remember: true })).ok, true); return c; };
    const live = () => db.one('select count(*)::int as n from staff_devices where user_id = $1 and revoked_at is null', [id]).then((x) => x.n);
    let c = await remembered(); assert.equal(await live(), 1);
    const s = await admin('/api/users', { action: 'devices-revoke', id }); assert.equal(s.revoked, 1); assert.equal(await live(), 0);
    assert.equal((await c('/api/session')).user, null); // the session ended too
    assert.equal((await c('/api/session', { action: 'login', username: 'neha', password: 'neha-password-2' })).otp, true);
    c = await remembered();
    await admin('/api/users', { action: 'update', id, name: 'Neha CRM', role: 'head_crm', phone: '9820099999', email: 'neha@example.com' }); assert.equal(await live(), 0);
    c = await remembered(); const own = await c('/api/session', { action: 'devices' }); assert.equal(own.devices.length, 1);
    assert.equal((await c('/api/session', { action: 'device-remove', id: own.devices[0].id })).devices.length, 0); // the person removes it
    c = await remembered(); await admin('/api/users', { action: 'disable', id }); assert.equal(await live(), 0);
    await admin('/api/users', { action: 'enable', id });
    c = await remembered(); await admin('/api/users', { action: 'reset', id }); assert.equal(await live(), 0);
    assert.ok(await db.one("select 1 from audit_log where action = 'devices-revoke'"));
  });
  await step('the break-glass Admin reset in Vercel still signs in without a code (audited)', async () => {
    Object.assign(process.env, { ERP_ADMIN_RESET_USER: 'rafi', ERP_ADMIN_RESET_PASSWORD: 'break-glass-password-1' });
    const c = client(); const r = await c('/api/session', { action: 'login', username: 'rafi', password: 'break-glass-password-1' });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(!r.otp); assert.equal(r.user.mustChange, true); assert.ok(c.jar.erp_session);
    assert.match((await db.one("select note from audit_log where action = 'admin-reset' order by id desc limit 1")).note, /without a sign-in code/);
    delete process.env.ERP_ADMIN_RESET_USER; delete process.env.ERP_ADMIN_RESET_PASSWORD;
  });

  console.log(`\nTwo-step sign-in: ${passed} checks passed.`);
  server.close(); smtp.close(); wa.close(); await db.end?.(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
