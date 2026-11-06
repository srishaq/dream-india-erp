// Two-step sign-in for staff (ERP and DreamComm). After the right username and password, the second step is one of:
//  - the sign-in app (authenticator, TOTP: SHA-1, 6 digits, 30 s, one step either side, a step used once only), when
//    the person has set one up; "Email me a code instead" sends an email code;
//  - a 6-digit code sent to the person's own WhatsApp (users.phone, or a username that is a 10-digit mobile) through the
//    Click Connect template in settings.security.waOtpTemplate (empty = WhatsApp codes off), or by email (users.email)
//    when there is no WhatsApp, it fails, or the person asks;
//  - "Add your email": a login with no email and no app types its email, gets a code there, and the email is saved on
//    the login as verified (only while the login has none; never an email another active login has).
// Codes always go to the person's own mobile and email, never to the test addresses. Only hashes are kept (of the
// pending token, the code, the internet address); the app's secret is sealed (AES-256-GCM, key from ERP_TOTP_KEY in
// Vercel, or else the ERP's own session secret). A code lasts 10 minutes and takes 5 tries; at most 5 unused codes
// per login and 30 per internet address in an hour.
// "Remember this device for 30 days": a random cookie (erp_device), only its hash kept in staff_devices; a remembered
// browser skips the second step. Password change or reset, disabling, a new role and the Admin's "Sign out all
// devices" end every remembered device of that login.
// settings.security = { enforce (off until the Admin turns it on), waOtpTemplate }. While enforce is off, a login that
// no code can reach signs in with the password alone (audited); when on, it is refused.
// ERP_TEST_OTP (tests only, ignored on Vercel) fixes the codes and sends nothing.
const crypto = require('crypto');
const db = require('./db');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const audit = require('./audit');
const TM = require('./tm');

const TTL_MIN = 10, RESEND_AFTER = 30, MAX_TRIES = 5, PER_USER_HOUR = 5, PER_IP_HOUR = 30, STEPS_PER_HOUR = 20;
const DEVICE_COOKIE = 'erp_device', DEVICE_DAYS = 30;
// WhatsApp login codes are off until the Admin enters an approved Click Connect template (one body variable: the code).
const DEFAULT_TEMPLATE = '';
const ISSUER = 'Dream India ERP';
const err = (status, message, data) => Object.assign(new Error(message), { status, ...(data ? { extra: data } : {}) });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const testCode = () => (process.env.VERCEL === '1' ? null : process.env.ERP_TEST_OTP || null);
const ipHash = (req) => require('./mkt-rate').hash(require('./mkt-rate').ipOf(req));
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

async function settings() {
  const v = ((await db.one("select value from settings where key = 'security'")) || {}).value || {};
  return { enforce: v.enforce === true, waOtpTemplate: v.waOtpTemplate == null ? DEFAULT_TEMPLATE : String(v.waOtpTemplate) };
}
async function saveSettings(user, b) {
  const before = await settings();
  const after = { enforce: b.enforce === true, waOtpTemplate: String(b.waOtpTemplate || '').trim().slice(0, 120) };
  await db.tx(async (t) => {
    await t.q("insert into settings (key, value) values ('security', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(after)]);
    await audit.record(t.q, { user, action: 'login-security', entity: 'settings', entityId: 'security', before, after, note: `Login security: codes ${after.enforce ? 'required' : 'NOT required when they cannot be sent'}; WhatsApp template ${after.waOtpTemplate || 'none (WhatsApp codes off)'}` });
  });
  return after;
}

// Where a login's codes go: its own mobile (Manage users, or a username that is a mobile) and email.
const USERNAME_MOBILE = /^[6-9]\d{9}$/;
function contacts(u) {
  const phone = TM.mobile(u.phone) || (USERNAME_MOBILE.test(String(u.username || '')) ? String(u.username) : '') || null;
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.email || '')) ? String(u.email).trim().toLowerCase() : null;
  return { phone, email };
}
const maskPhone = (p) => '••••' + String(p).slice(-4);
const maskEmail = (e) => { const [a, d] = String(e).split('@'); return (a ? a[0] : '') + '***@' + (d || ''); };
const contactRow = (id) => db.one('select id, username, name, role, phone, email, disabled, session_version, totp_secret, totp_enabled_at from users where id = $1', [id]);

// ---------- the sign-in app (TOTP, RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(v << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const out = []; let bits = 0, v = 0;
  for (const ch of String(s).toUpperCase().replace(/[\s=-]/g, '')) { const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32'); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30000);
// the 30-second step a code belongs to (now, or one either side), or null
function matchStep(secretB32, code) {
  const key = b32decode(secretB32), now = stepNow(); code = String(code || '').replace(/\D/g, '');
  let hit = null;
  for (const s of [now - 1, now, now + 1]) if (safeEq(hotp(key, s), code) && code.length === 6) hit = hit == null ? s : hit; // check all three: same time either way
  return hit;
}
// the secret sealed at rest: "k1." with ERP_TOTP_KEY (Vercel), "s1." with the ERP's own session secret
async function keyFor(kind) {
  if (kind === 'k') { if (!process.env.ERP_TOTP_KEY) throw err(500, 'ERP_TOTP_KEY is missing in Vercel: the sign-in apps cannot be read.'); return crypto.createHash('sha256').update('erp-totp:' + process.env.ERP_TOTP_KEY).digest(); }
  const r = await db.one("select value from settings where key = 'session_secret'");
  return crypto.createHash('sha256').update('erp-totp:' + String(r && r.value)).digest();
}
async function seal(text) {
  const kind = process.env.ERP_TOTP_KEY ? 'k' : 's';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', await keyFor(kind), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return kind + '1.' + [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
async function open(sealed) {
  const [v, ...rest] = String(sealed || '').split('.');
  const [iv, tag, enc] = rest.map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', await keyFor(v[0]), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
// A code from the app, used once: claims the step (a later code must have a later step). Returns true or throws.
async function useAppCode(userId, code) {
  const u = await db.one('select totp_secret from users where id = $1', [userId]);
  if (!u || !u.totp_secret) return false;
  const s = matchStep(await open(u.totp_secret), code);
  if (s == null) return false;
  const ok = await db.one('update users set totp_last_step = $2 where id = $1 and coalesce(totp_last_step, -1) < $2 returning id', [userId, s]);
  if (!ok) throw err(400, 'That code was used already. Wait for the next code in your app.');
  return true;
}
const otpauth = (username, secret) => `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`;

// ---------- sending codes ----------
// channel: 'auto' (WhatsApp, then email when WhatsApp is not possible or fails) or 'email'. toEmail: an address being added.
async function deliver(u, code, channel, toEmail) {
  const S = await settings(), c = contacts(u), sent = [];
  const email = toEmail || c.email;
  if (testCode()) {
    if (!toEmail && channel !== 'email' && c.phone && S.waOtpTemplate) sent.push('WhatsApp ' + maskPhone(c.phone));
    else if (email) sent.push('email ' + maskEmail(email));
    return { sentTo: (sent[0] || 'the test code') + ' (test)', email: sent[0] ? /^email/.test(sent[0]) : false };
  }
  if (!toEmail && channel !== 'email' && c.phone && S.waOtpTemplate && whatsapp.configured()) {
    try { await whatsapp.send({ phone: c.phone, template: S.waOtpTemplate, params: [code], loginCode: true }); sent.push('WhatsApp ' + maskPhone(c.phone)); }
    catch (e) { console.error('login code whatsapp', e.message); }
  }
  if (!sent.length && email && mailer.configured()) {
    try {
      const cn = await mailer.connect();
      try {
        await cn.send({ to: [email], fromName: 'Dream India ERP', subject: `${code} is your Dream India ERP sign-in code`,
          text: `${code} is your Dream India ERP sign-in code. It expires in ${TTL_MIN} minutes. Do not share it with anyone: Dream India staff will never ask for it.\n\nIf you did not try to sign in, change your password and tell the Admin.`,
          html: `<p>Your Dream India ERP sign-in code is</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in ${TTL_MIN} minutes. Do not share it with anyone: Dream India staff will never ask for it.</p><p style="color:#555">If you did not try to sign in, change your password and tell the Admin.</p>` });
      } finally { await cn.close(); }
      sent.push('email ' + maskEmail(email));
    } catch (e) { console.error('login code mail', e.message); }
  }
  if (!sent.length) return null;
  return { sentTo: sent.join(' and '), email: /^email/.test(sent[0]) };
}

async function reachable(u) {
  const S = await settings(), c = contacts(u);
  return { S, c, wa: !!(c.phone && S.waOtpTemplate && whatsapp.configured()), mail: !!(c.email && mailer.configured()) };
}

// codes sent and not used; and sign-in steps of any kind started and not finished
async function limits(userId, ih, codes) {
  const r = await db.one(`select count(*) filter (where user_id = $1 and code_hash is not null)::int as mine, count(*) filter (where ip_hash = $2 and code_hash is not null)::int as here,
      count(*) filter (where user_id = $1)::int as steps
    from staff_otps where created_at > now() - interval '1 hour' and used_at is null and (user_id = $1 or ip_hash = $2)`, [userId, ih]);
  if (r.steps >= STEPS_PER_HOUR || (codes && r.mine >= PER_USER_HOUR)) throw err(429, 'Too many sign-in codes asked for this login. Please wait an hour and try again, or ask the Admin.');
  if (codes && r.here >= PER_IP_HOUR) throw err(429, 'Too many sign-in codes asked from this internet connection. Please wait an hour and try again.');
}
const insertStep = (tokenHash, u, via, method, ih, codeHash = null, sentTo = null, email = null) => db.q(
  `insert into staff_otps (token_hash, user_id, via, session_version, code_hash, sent_to, expires_at, ip_hash, method, email)
   values ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7), $8, $9, $10)`, [tokenHash, u.id, via, u.session_version, codeHash, sentTo, TTL_MIN, ih, method, email]);
async function newCode(u, tokenHash, via, ih, channel, toEmail = null) {
  await limits(u.id, ih, true);
  if (toEmail && !testCode()) {
    const RL = require('./mkt-rate');
    if (!(await RL.allow('staff-add-email', toEmail, PER_USER_HOUR))) throw err(429, 'Too many codes sent to this email. Please wait an hour and try again.');
  }
  const code = testCode() || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const d = await deliver(u, code, channel, toEmail);
  if (!d) throw err(503, channel === 'email' ? 'The code could not be emailed. Try again in a minute, or ask the Admin.' : 'Your sign-in code could not be sent. Try again in a minute, or ask the Admin.');
  await insertStep(tokenHash, u, via, 'code', ih, sha(tokenHash + ':' + code), d.sentTo, toEmail);
  if (Math.random() < 0.02) db.q("delete from staff_otps where created_at < now() - interval '2 days'").catch(() => {});
  return d;
}
const codeReply = (token, d, canEmail, adding = false) => ({ otp: true, method: 'code', token, sentTo: d.sentTo, resendAfter: RESEND_AFTER, expiresIn: TTL_MIN * 60, canEmail, adding });

// After the right password. Returns { skip: true } (sign in without a code: only while enforce is off and nothing
// can carry a code), or what the second step screen needs. via: 'erp' | 'chat'.
async function start(user, req, via) {
  const u = await contactRow(user.id);
  const { S, c, wa, mail } = await reachable(u);
  const token = crypto.randomBytes(18).toString('base64url'), th = sha(token), ih = ipHash(req);
  if (u.totp_secret) { // the sign-in app: nothing is sent
    await limits(u.id, ih, false);
    await insertStep(th, u, via, 'app', ih);
    return { otp: true, method: 'app', token, expiresIn: TTL_MIN * 60, canEmail: !!c.email && (mail || !!testCode()) };
  }
  if (!testCode() && !c.email && !wa) { // no email, no app, no WhatsApp: the person adds their email (even while codes are required)
    if (mailer.configured()) { await limits(u.id, ih, false); await insertStep(th, u, via, 'add-email', ih); return { otp: true, method: 'add-email', token, expiresIn: TTL_MIN * 60 }; }
    if (!S.enforce) return { skip: true, why: 'no email or sign-in app on the login, and the ERP mailbox is not set up' };
    throw err(403, 'No email on your login — ask the Admin to add it in Manage users.');
  }
  if (!testCode() && !wa && !mail) {
    if (!S.enforce) return { skip: true, why: 'no way to send a code yet' };
    throw err(503, 'Sign-in codes cannot be sent yet: the ERP mailbox is not set up. Ask the Admin.');
  }
  let d;
  try { d = await newCode(u, th, via, ih, 'auto'); }
  catch (e) { // WhatsApp and email both failed: only while the code is not required
    if (!S.enforce && !testCode() && !(e.status === 429)) return { skip: true, why: 'the code could not be sent: ' + e.message };
    throw e;
  }
  return codeReply(token, d, !d.email && (!!testCode() ? !!c.email : mail));
}

const pending = (token, via) => db.one(`select * from staff_otps where token_hash = $1 and via = $2 and used_at is null order by id desc limit 1`, [sha(String(token || '')), via]);
const expired = () => err(400, 'This sign-in has expired. Please sign in again.', { restart: true });
const live = (r) => r && new Date(r.expires_at) > new Date();

// "Add your email": the address the person types gets the code; it is saved on the login once the code is right.
async function addEmail(token, email, req, via) {
  const r = await pending(token, via);
  if (!live(r) || r.method !== 'add-email') throw expired();
  const e = String(email || '').trim().toLowerCase().slice(0, 120);
  if (!EMAIL.test(e)) throw err(400, 'That email address does not look right.');
  const u = await contactRow(r.user_id);
  if (!u || u.disabled || u.session_version !== r.session_version) throw expired();
  if (u.email) throw err(409, 'Your login already has an email. Only the Admin can change it.', { restart: true });
  if (await db.one('select 1 from users where lower(email) = $1 and not disabled and id <> $2', [e, u.id])) throw err(409, 'That email is on another login. Use your own email, or ask the Admin.');
  const d = await newCode(u, r.token_hash, via, ipHash(req), 'email', e);
  return codeReply(token, d, false, true);
}

// "Send again" / "Email me the code instead". The old code stops working.
async function resend(token, req, via, channel) {
  const r = await pending(token, via);
  if (!live(r)) throw expired();
  if (r.method === 'add-email') throw err(400, 'Type your email first.');
  if (r.method !== 'app') {
    const wait = RESEND_AFTER - Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
    if (wait > 0) throw err(429, `Please wait ${wait} seconds before asking again.`);
  }
  const u = await contactRow(r.user_id);
  if (!u || u.disabled || u.session_version !== r.session_version) throw expired();
  const c = contacts(u), adding = r.email || null;
  if ((channel === 'email' || r.method === 'app') && !adding && !c.email) throw err(400, 'There is no email on your login. Ask the Admin to add it in Manage users.');
  const d = await newCode(u, r.token_hash, via, ipHash(req), adding || r.method === 'app' ? 'email' : channel, adding);
  await db.q('update staff_otps set expires_at = least(expires_at, now()) where token_hash = $1 and used_at is null and id < (select max(id) from staff_otps where token_hash = $1)', [r.token_hash]);
  return codeReply(token, d, !d.email && !!c.email && !adding, !!adding);
}

// Checks the second step; returns the row when right. Five wrong tries end it.
async function verify(token, code, via) {
  const r = await pending(token, via);
  if (!live(r)) throw expired();
  if (r.method === 'add-email') throw err(400, 'Type your email first.');
  const t = await db.one('update staff_otps set attempts = attempts + 1 where id = $1 and attempts < $2 and expires_at > now() and used_at is null returning attempts', [r.id, MAX_TRIES]);
  if (!t) throw err(400, 'Too many wrong codes. Please sign in again.', { restart: true });
  const given = String(code || '').replace(/\D/g, '');
  const right = r.method === 'app' ? await useAppCode(r.user_id, given) : given.length === 6 && safeEq(sha(r.token_hash + ':' + given), r.code_hash);
  if (!right) {
    if (t.attempts >= MAX_TRIES) { await db.q('update staff_otps set expires_at = now() where id = $1', [r.id]); throw err(400, 'Too many wrong codes. Please sign in again.', { restart: true }); }
    throw err(400, `That code is not right. ${MAX_TRIES - t.attempts} ${MAX_TRIES - t.attempts === 1 ? 'try' : 'tries'} left.`);
  }
  const used = await db.one('update staff_otps set used_at = now() where id = $1 and used_at is null returning user_id, session_version, sent_to, method, email', [r.id]);
  if (!used) throw expired();
  await db.q('update staff_otps set expires_at = least(expires_at, now()) where token_hash = $1 and used_at is null', [r.token_hash]);
  return used;
}

// ---------- remembered devices ----------
function cookieOf(req, name) {
  for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim()); }
  return null;
}
const secure = (req) => (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';
function addCookie(res, c) {
  const cur = res.getHeader ? res.getHeader('Set-Cookie') : null;
  res.setHeader('Set-Cookie', [...(cur ? (Array.isArray(cur) ? cur : [cur]) : []), c]);
}
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Unknown device';
  const br = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : '';
  return (br ? br + ' on ' : '') + os;
}
async function remember(req, res, userId) {
  const tok = crypto.randomBytes(32).toString('base64url');
  await db.q(`insert into staff_devices (user_id, token_hash, label, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`, [userId, sha(tok), deviceLabel(req).slice(0, 80), DEVICE_DAYS]);
  addCookie(res, `${DEVICE_COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_DAYS * 86400}${secure(req) ? '; Secure' : ''}`);
}
// The remembered device of this browser for this login, or null (used to skip the code).
async function rememberedDevice(req, userId) {
  const tok = cookieOf(req, DEVICE_COOKIE);
  if (!tok) return null;
  return db.one(`update staff_devices set last_used_at = now() where token_hash = $1 and user_id = $2 and revoked_at is null and expires_at > now() returning id, label`, [sha(tok), userId]);
}
async function devices(userId, req) {
  const tok = req ? cookieOf(req, DEVICE_COOKIE) : null, mine = tok ? sha(tok) : null;
  const rows = await db.q(`select id, label, created_at, last_used_at, expires_at, token_hash from staff_devices where user_id = $1 and revoked_at is null and expires_at > now() order by coalesce(last_used_at, created_at) desc`, [userId]);
  return rows.map(({ token_hash, ...r }) => ({ ...r, current: token_hash === mine }));
}
async function removeDevice(q, userId, id) {
  return (await q('update staff_devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id', [id, userId])).length;
}
// Ends every remembered device of a login (inside the caller's transaction when q is a transaction's).
async function revokeAll(q, userId) {
  return (await q('update staff_devices set revoked_at = now() where user_id = $1 and revoked_at is null returning id', [userId])).length;
}

// ---------- the two steps, shared by the ERP (api/session.js) and DreamComm (api/chat.js) ----------
// issueFn sets that site's session cookie. r is what auth.authenticate returned for the right password.
const WHERE = { erp: 'the ERP', chat: 'DreamComm' };
async function afterPassword(req, res, r, via, issueFn) {
  const auth = require('./auth');
  if (r.reset) { await issueFn(req, res, r.user); return { ok: true, user: auth.publicUser(r.user) }; } // break-glass (audited in auth.js)
  const dev = await rememberedDevice(req, r.user.id);
  if (dev) {
    await issueFn(req, res, r.user);
    await audit.record(db.q, { user: r.user, action: 'login', entity: 'user', entityId: r.user.id, note: `Signed in to ${WHERE[via]} on a remembered device (${dev.label || 'device'}), no code asked` });
    return { ok: true, user: auth.publicUser(r.user) };
  }
  const o = await start(r.user, req, via);
  if (o.skip) {
    await issueFn(req, res, r.user);
    await audit.record(db.q, { user: r.user, action: 'login-no-code', entity: 'user', entityId: r.user.id, note: `Signed in to ${WHERE[via]} WITHOUT a sign-in code (${o.why}; Login security "require codes" is off)` });
    return { ok: true, user: auth.publicUser(r.user) };
  }
  return o;
}
async function afterCode(req, res, b, via, issueFn) {
  const auth = require('./auth');
  const used = await verify(b.token, b.code, via);
  let u = await auth.loadUser(used.user_id);
  if (!u || String(u.session_version) !== String(used.session_version)) throw expired();
  if (used.email) { // "Add your email": saved on the login, verified by the code just typed
    await db.tx(async (t) => {
      if ((await t.q('select 1 from users where lower(email) = $1 and not disabled and id <> $2', [used.email, u.id])).length) throw err(409, 'That email is on another login. Use your own email, or ask the Admin.', { restart: true });
      const ok = await t.one('update users set email = $2, email_verified_at = now() where id = $1 and email is null returning id', [u.id, used.email]);
      if (!ok) throw err(409, 'Your login already has an email. Only the Admin can change it.', { restart: true });
      await audit.record(t.q, { user: u, action: 'email-add', entity: 'user', entityId: u.id, after: { email: used.email }, note: `Email added at sign-in: ${used.email} (verified with a code)` });
    });
  } else if (used.method === 'code' && /^email/.test(used.sent_to || '')) await db.q('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [u.id]);
  if (via === 'chat' && u.must_change) throw err(403, 'Set a new password first: open the ERP once and sign in there, then come back.');
  await issueFn(req, res, u);
  if (b.remember) await remember(req, res, u.id);
  await audit.record(db.q, { user: u, action: 'login', entity: 'user', entityId: u.id, note: `Signed in to ${WHERE[via]} with ${used.method === 'app' ? 'the code from the sign-in app' : 'the code sent to ' + used.sent_to}${b.remember ? '; this device remembered for 30 days' : ''}` });
  return u;
}

// ---------- setting up the sign-in app (signed in, from the Change password page or right after sign-in) ----------
async function appStatus(userId) {
  const u = await db.one('select email, totp_enabled_at, email_verified_at from users where id = $1', [userId]);
  return { hasApp: !!u.totp_enabled_at, since: u.totp_enabled_at, email: u.email ? maskEmail(u.email) : null, canEmail: !!u.email && (mailer.configured() || !!testCode()) };
}
async function appBegin(user) {
  const u = await db.one('select username, totp_secret from users where id = $1', [user.id]);
  if (u.totp_secret) throw err(409, 'A sign-in app is already set up. Remove it first to set up a new one.');
  const secret = b32encode(crypto.randomBytes(20));
  await db.q('update users set totp_pending = $2 where id = $1', [user.id, await seal(secret)]);
  const uri = otpauth(u.username, secret);
  return { secret: secret.match(/.{1,4}/g).join(' '), uri, qr: 'data:image/svg+xml;base64,' + Buffer.from(require('./qr').svg(uri, 5)).toString('base64'), issuer: ISSUER, account: u.username };
}
async function appConfirm(user, code) {
  const u = await db.one('select totp_pending from users where id = $1', [user.id]);
  if (!u.totp_pending) throw err(400, 'Start the set-up again.');
  const s = matchStep(await open(u.totp_pending), code);
  if (s == null) throw err(400, 'That code is not right. Check the time on your phone, and type the code the app shows now.');
  await db.tx(async (t) => {
    const ok = await t.one('update users set totp_secret = totp_pending, totp_pending = null, totp_enabled_at = now(), totp_last_step = $2 where id = $1 and totp_pending is not null returning id', [user.id, s]);
    if (!ok) throw err(400, 'Start the set-up again.');
    await audit.record(t.q, { user, action: 'app-set', entity: 'user', entityId: user.id, note: 'Set up a sign-in app' });
  });
  return appStatus(user.id);
}
// an email code to prove it is the person (to remove the app without it)
async function appEmail(user, req) {
  const u = await contactRow(user.id);
  if (!contacts(u).email) throw err(400, 'There is no email on your login. Ask the Admin.');
  const token = crypto.randomBytes(18).toString('base64url');
  const d = await newCode(u, sha(token), 'self', ipHash(req), 'email');
  return { token, sentTo: d.sentTo };
}
async function appRemove(user, b) {
  if (b.token) { const used = await verify(b.token, b.code, 'self'); if (used.user_id !== user.id) throw expired(); }
  else if (!(await useAppCode(user.id, b.code))) throw err(400, 'That code is not right. Type the code your app shows now, or ask for an email code.');
  await db.tx(async (t) => {
    await t.q('update users set totp_secret = null, totp_pending = null, totp_enabled_at = null, totp_last_step = null where id = $1', [user.id]);
    await audit.record(t.q, { user, action: 'app-remove', entity: 'user', entityId: user.id, note: `Removed own sign-in app (checked with ${b.token ? 'an email code' : 'a code from the app'})` });
  });
  return appStatus(user.id);
}
// the Admin's "Reset sign-in app": the person signs in with an email code until they set one up again
async function appReset(admin, q, id, username) {
  const n = (await q('update users set totp_secret = null, totp_pending = null, totp_enabled_at = null, totp_last_step = null where id = $1 and (totp_secret is not null or totp_pending is not null) returning id', [id])).length;
  await audit.record(q, { user: admin, action: 'app-reset', entity: 'user', entityId: id, note: n ? `Reset the sign-in app of ${username}` : `Reset the sign-in app of ${username} (none was set up)` });
  return n;
}

// For the Admin's Login security panel: every active login, with what can carry its code.
async function status() {
  const S = await settings();
  const users = await db.q('select id, username, name, role, phone, email, email_verified_at, totp_enabled_at from users where not disabled order by name');
  const counts = Object.fromEntries((await db.q('select user_id, count(*)::int as n from staff_devices where revoked_at is null and expires_at > now() group by user_id')).map((r) => [r.user_id, r.n]));
  const wa = !!(S.waOtpTemplate && whatsapp.configured()), mail = mailer.configured();
  const rows = users.map((u) => {
    const c = contacts(u);
    return { id: u.id, name: u.name, username: u.username, role: u.role, mobile: c.phone ? maskPhone(c.phone) : null, email: c.email ? maskEmail(c.email) : null,
      emailVerified: !!u.email_verified_at, app: !!u.totp_enabled_at, devices: counts[u.id] || 0, reachable: !!(u.totp_enabled_at || (c.phone && wa) || (c.email && mail)) };
  });
  return { settings: S, whatsapp: whatsapp.configured(), mail, logins: rows, neither: rows.filter((r) => !r.app && !r.email), noApp: rows.filter((r) => !r.app),
    noMobile: rows.filter((r) => !r.mobile), unreachable: rows.filter((r) => !r.reachable), devices: counts };
}

// ---------- "Forgot password?" (6 Nov 2026) ----------
// The person types their username; a 6-digit code goes to the email on their login. With the right code they set a new
// password and are signed in. The answer is the same whether or not the username exists, so nobody can test usernames.
async function forgotStart(username, req) {
  const name = String(username || '').trim().toLowerCase();
  if (!name) throw err(400, 'Type your username.');
  const token = crypto.randomBytes(18).toString('base64url'), th = sha(token), ih = ipHash(req);
  const same = { otp: true, method: 'code', token, sentTo: 'the email on your login', resendAfter: RESEND_AFTER, expiresIn: TTL_MIN * 60 };
  const row = await db.one('select id from users where lower(username) = $1 and not disabled', [name]);
  const u = row && (await contactRow(row.id));
  if (!u || !contacts(u).email) { await new Promise((r) => setTimeout(r, 400)); return same; }
  if (!testCode() && !mailer.configured()) throw err(503, 'The ERP mailbox is not set up. Ask the Admin to reset your password.');
  const d = await newCode(u, th, 'reset', ih, 'email');
  await audit.record(db.q, { user: u, action: 'password-forgot', entity: 'user', entityId: u.id, note: `Reset code sent to ${d.sentTo}` });
  return { ...same, sentTo: d.sentTo };
}
async function forgotFinish(req, res, b, issueFn) {
  const auth = require('./auth');
  const p = auth.passwordProblem(b.password); if (p) throw err(400, p);
  const used = await verify(b.token, b.code, 'reset');
  const u0 = await contactRow(used.user_id);
  if (!u0 || u0.disabled || u0.session_version !== used.session_version) throw expired();
  await db.tx(async (t) => {
    await t.q('update users set password_hash = $2, must_change = false, session_version = session_version + 1 where id = $1', [u0.id, auth.hashPassword(b.password)]);
    await revokeAll(t.q, u0.id);
    await audit.record(t.q, { user: u0, action: 'password-reset-self', entity: 'user', entityId: u0.id, note: `New password set with a code sent to ${used.sent_to}` });
  });
  const u = await auth.loadUser(u0.id);
  await issueFn(req, res, u);
  return u;
}

module.exports = { forgotStart, forgotFinish, afterPassword, afterCode, addEmail, DEFAULT_TEMPLATE, TTL_MIN, RESEND_AFTER, MAX_TRIES, PER_USER_HOUR, PER_IP_HOUR, DEVICE_COOKIE,
  settings, saveSettings, contacts, start, resend, verify, remember, rememberedDevice, devices, removeDevice, revokeAll, status, maskPhone, maskEmail,
  appStatus, appBegin, appConfirm, appEmail, appRemove, appReset, hotp, b32decode, b32encode, open, otpauth };
