// "Forgot password?": code to the login's email, new password, signed in; unknown usernames get the same answer.
// DATABASE_URL=postgres://... ERP_TEST_OTP=246810 node scripts/test-forgot.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
require('./dev-server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv).join('; '); }
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  await db.q("insert into users (username, name, role, password_hash, all_projects, email) values ('neha', 'Neha', 'accounts', $1, true, 'neha@example.com')", [auth.hashPassword('old-password-1')]);
  const c = client();
  const nobody = await c('/api/session', { action: 'forgot', username: 'nobody' });
  assert.equal(nobody.otp, true);
  const s = await c('/api/session', { action: 'forgot', username: 'Neha' });
  assert.equal(s.otp, true); assert.ok(s.token);
  const bad = await c('/api/session', { action: 'forgot-finish', token: s.token, code: '000000', password: 'new-password-22' });
  assert.equal(bad.status, 400);
  const ok = await c('/api/session', { action: 'forgot-finish', token: s.token, code: process.env.ERP_TEST_OTP, password: 'new-password-22' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const me = await c('/api/session');
  assert.equal(me.user && me.user.username, 'neha');
  assert.equal((await auth.authenticate('neha', 'old-password-1')).error ? 1 : 0, 1);
  assert.ok(!(await auth.authenticate('neha', 'new-password-22')).error);
  const again = await c('/api/session', { action: 'forgot-finish', token: s.token, code: process.env.ERP_TEST_OTP, password: 'other-password-33' });
  assert.equal(again.status, 400);
  console.log('Forgot password: all checks passed.');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
