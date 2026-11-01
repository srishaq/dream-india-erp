// Two-step sign-in for staff (ERP and DreamComm): after the right username and password, a 6-digit code goes to the
// person's own WhatsApp (users.phone, or the username when it is a 10-digit mobile) through the Click Connect template
// in settings.security.waOtpTemplate, and by email (users.email) when there is no mobile, when WhatsApp fails, or when
// the person asks for it. Login codes always go to the person's own mobile and email, never to the test addresses.
// Only hashes are kept: of the pending token, of the code, of the internet address. A code lasts 10 minutes and takes
// 5 tries; at most 5 unused codes per login and 30 per internet address in an hour.
// "Remember this device for 30 days": a random cookie (erp_device), only its hash kept in staff_devices; a remembered
// browser skips the code for that login. Password change or reset, disabling, a new role and the Admin's "Sign out
// all devices" end every remembered device of that login.
// settings.security = { enforce (default true), waOtpTemplate }. With nothing able to carry a code to a login
// (no template or WhatsApp, no mailbox or email), sign-in without a code is allowed only while enforce is off.
// ERP_TEST_OTP (tests only, ignored on Vercel) fixes the code and sends nothing.
const crypto = require('crypto');
const db = require('./db');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const audit = require('./audit');
const TM = require('./tm');

const TTL_MIN = 10, RESEND_AFTER = 30, MAX_TRIES = 5, PER_USER_HOUR = 5, PER_IP_HOUR = 30;
const DEVICE_COOKIE = 'erp_device', DEVICE_DAYS = 30;
// Click Connect utility template, one body variable: "Your Dream India ERP login code is {{1}}. It expires in 10 minutes. Do not share it with anyone."
const DEFAULT_TEMPLATE = 'erp_login_code_m4rahd8855pzg1ov';
const err = (status, message, data) => Object.assign(new Error(message), { status, ...(data ? { extra: data } : {}) });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const testCode = () => (process.env.VERCEL === '1' ? null : process.env.ERP_TEST_OTP || null);
const ipHash = (req) => require('./mkt-rate').hash(require('./mkt-rate').ipOf(req));

async function settings() {
  const v = ((await db.one("select value from settings where key = 'security'")) || {}).value || {};
  return { enforce: v.enforce !== false, waOtpTemplate: v.waOtpTemplate == null ? DEFAULT_TEMPLATE : String(v.waOtpTemplate) };
}
async function saveSettings(user, b) {
  const before = await settings();
  const after = { enforce: b.enforce !== false, waOtpTemplate: String(b.waOtpTemplate || '').trim().slice(0, 120) };
  await db.tx(async (t) => {
    await t.q("insert into settings (key, value) values ('security', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(after)]);
    await audit.record(t.q, { user, action: 'login-security', entity: 'settings', entityId: 'security', before, after, note: `Login security: codes ${after.enforce ? 'required' : 'NOT required when they cannot be sent'}; WhatsApp template ${after.waOtpTemplate || 'none'}` });
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
const contactRow = (id) => db.one('select id, username, name, role, phone, email, disabled, session_version from users where id = $1', [id]);

// Sends one code. channel: 'auto' (WhatsApp, then email when WhatsApp is not possible or fails) or 'email'.
async function deliver(u, code, channel) {
  const S = await settings(), c = contacts(u), sent = [];
  if (testCode()) {
    if (channel !== 'email' && c.phone) sent.push('WhatsApp ' + maskPhone(c.phone));
    else if (c.email) sent.push('email ' + maskEmail(c.email));
    return { sentTo: (sent[0] || 'the test code') + ' (test)', email: sent[0] ? /^email/.test(sent[0]) : false };
  }
  if (channel !== 'email' && c.phone && S.waOtpTemplate && whatsapp.configured()) {
    try { await whatsapp.send({ phone: c.phone, template: S.waOtpTemplate, params: [code], loginCode: true }); sent.push('WhatsApp ' + maskPhone(c.phone)); }
    catch (e) { console.error('login code whatsapp', e.message); }
  }
  if (!sent.length && c.email && mailer.configured()) {
    try {
      const cn = await mailer.connect();
      try {
        await cn.send({ to: [c.email], fromName: 'Dream India ERP', subject: `${code} is your Dream India ERP sign-in code`,
          text: `${code} is your Dream India ERP sign-in code. It expires in ${TTL_MIN} minutes. Do not share it with anyone: Dream India staff will never ask for it.\n\nIf you did not try to sign in, change your password and tell the Admin.`,
          html: `<p>Your Dream India ERP sign-in code is</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in ${TTL_MIN} minutes. Do not share it with anyone: Dream India staff will never ask for it.</p><p style="color:#555">If you did not try to sign in, change your password and tell the Admin.</p>` });
      } finally { await cn.close(); }
      sent.push('email ' + maskEmail(c.email));
    } catch (e) { console.error('login code mail', e.message); }
  }
  if (!sent.length) return null;
  return { sentTo: sent.join(' and '), email: /^email/.test(sent[0]) };
}

// Can a code reach this login at all, with what is set up now?
async function reachable(u) {
  const S = await settings(), c = contacts(u);
  return { S, c, wa: !!(c.phone && S.waOtpTemplate && whatsapp.configured()), mail: !!(c.email && mailer.configured()) };
}

async function limits(userId, ih) {
  const r = await db.one(`select count(*) filter (where user_id = $1)::int as mine, count(*) filter (where ip_hash = $2)::int as here
    from staff_otps where created_at > now() - interval '1 hour' and used_at is null and (user_id = $1 or ip_hash = $2)`, [userId, ih]);
  if (r.mine >= PER_USER_HOUR) throw err(429, 'Too many sign-in codes asked for this login. Please wait an hour and try again, or ask the Admin.');
  if (r.here >= PER_IP_HOUR) throw err(429, 'Too many sign-in codes asked from this internet connection. Please wait an hour and try again.');
}
async function newCode(u, tokenHash, via, ih, channel) {
  await limits(u.id, ih);
  const code = testCode() || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const d = await deliver(u, code, channel);
  if (!d) throw err(503, channel === 'email' ? 'The code could not be emailed. Try again in a minute, or ask the Admin.' : 'Your sign-in code could not be sent. Try again in a minute, or ask the Admin.');
  await db.q(`insert into staff_otps (token_hash, user_id, via, session_version, code_hash, sent_to, expires_at, ip_hash)
    values ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7), $8)`, [tokenHash, u.id, via, u.session_version, sha(tokenHash + ':' + code), d.sentTo, TTL_MIN, ih]);
  if (Math.random() < 0.02) db.q("delete from staff_otps where created_at < now() - interval '2 days'").catch(() => {});
  return d;
}

// After the right password. Returns { skip: true } (sign in without a code: only while enforce is off and nothing
// can carry a code), or { token, sentTo, ... } for the code screen. via: 'erp' | 'chat'.
async function start(user, req, via) {
  const u = await contactRow(user.id);
  const { S, c, wa, mail } = await reachable(u);
  if (!testCode()) {
    if (!c.phone && !c.email) {
      if (!S.enforce) return { skip: true, why: 'no mobile or email on the login' };
      throw err(403, 'No mobile number on your login — ask the Admin to add it in Manage users.');
    }
    if (!wa && !mail) {
      if (!S.enforce) return { skip: true, why: 'no way to send a code yet' };
      throw err(503, c.phone && !S.waOtpTemplate ? 'Sign-in codes cannot be sent yet: the Admin has not set the WhatsApp login template, and your login has no email. Ask the Admin.'
        : 'Sign-in codes cannot be sent to your login yet. Ask the Admin to add your email in Manage users.');
    }
  }
  const token = crypto.randomBytes(18).toString('base64url');
  const d = await newCode(u, sha(token), via, ipHash(req), 'auto');
  return { otp: true, token, sentTo: d.sentTo, resendAfter: RESEND_AFTER, expiresIn: TTL_MIN * 60, canEmail: !d.email && (!!testCode() ? !!c.email : mail) };
}

const pending = (token, via) => db.one(`select * from staff_otps where token_hash = $1 and via = $2 and used_at is null order by id desc limit 1`, [sha(String(token || '')), via]);
const expired = () => err(400, 'This code has expired. Please sign in again.', { restart: true });

// "Send again" / "Email me the code instead". The old code stops working.
async function resend(token, req, via, channel) {
  const r = await pending(token, via);
  if (!r || new Date(r.expires_at) < new Date()) throw expired();
  const wait = RESEND_AFTER - Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
  if (wait > 0) throw err(429, `Please wait ${wait} seconds before asking again.`);
  const u = await contactRow(r.user_id);
  if (!u || u.disabled || u.session_version !== r.session_version) throw expired();
  const c = contacts(u);
  if (channel === 'email' && !c.email) throw err(400, 'There is no email on your login. Ask the Admin to add it in Manage users.');
  await db.q('update staff_otps set expires_at = least(expires_at, now()) where token_hash = $1 and used_at is null', [r.token_hash]);
  const d = await newCode(u, r.token_hash, via, ipHash(req), channel === 'email' ? 'email' : 'auto');
  return { otp: true, token, sentTo: d.sentTo, resendAfter: RESEND_AFTER, expiresIn: TTL_MIN * 60, canEmail: !d.email && !!c.email };
}

// Checks the code; returns the user id when right. Five wrong tries end the code.
async function verify(token, code, via) {
  const r = await pending(token, via);
  if (!r || new Date(r.expires_at) < new Date()) throw expired();
  const t = await db.one('update staff_otps set attempts = attempts + 1 where id = $1 and attempts < $2 and expires_at > now() and used_at is null returning attempts', [r.id, MAX_TRIES]);
  if (!t) throw err(400, 'Too many wrong codes. Please sign in again.', { restart: true });
  const given = String(code || '').replace(/\D/g, '');
  if (!safeEq(sha(r.token_hash + ':' + given), r.code_hash) || given.length !== 6) {
    if (t.attempts >= MAX_TRIES) { await db.q('update staff_otps set expires_at = now() where id = $1', [r.id]); throw err(400, 'Too many wrong codes. Please sign in again.', { restart: true }); }
    throw err(400, `That code is not right. ${MAX_TRIES - t.attempts} ${MAX_TRIES - t.attempts === 1 ? 'try' : 'tries'} left.`);
  }
  const used = await db.one('update staff_otps set used_at = now() where id = $1 and used_at is null returning user_id, session_version, sent_to', [r.id]);
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
  const u = await auth.loadUser(used.user_id);
  if (!u || String(u.session_version) !== String(used.session_version)) throw expired();
  if (via === 'chat' && u.must_change) throw err(403, 'Set a new password first: open the ERP once and sign in there, then come back.');
  await issueFn(req, res, u);
  if (b.remember) await remember(req, res, u.id);
  await audit.record(db.q, { user: u, action: 'login', entity: 'user', entityId: u.id, note: `Signed in to ${WHERE[via]} with the code sent to ${used.sent_to}${b.remember ? '; this device remembered for 30 days' : ''}` });
  return u;
}

// For the Admin's Login security panel.
async function status() {
  const S = await settings();
  const users = await db.q('select id, username, name, role, phone, email from users where not disabled order by name');
  const counts = Object.fromEntries((await db.q('select user_id, count(*)::int as n from staff_devices where revoked_at is null and expires_at > now() group by user_id')).map((r) => [r.user_id, r.n]));
  const wa = !!(S.waOtpTemplate && whatsapp.configured()), mail = mailer.configured();
  const rows = users.map((u) => { const c = contacts(u); return { id: u.id, name: u.name, username: u.username, role: u.role, mobile: c.phone ? maskPhone(c.phone) : null, email: c.email ? maskEmail(c.email) : null, devices: counts[u.id] || 0, reachable: !!((c.phone && wa) || (c.email && mail)) }; });
  return { settings: S, whatsapp: whatsapp.configured(), mail, noMobile: rows.filter((r) => !r.mobile), unreachable: rows.filter((r) => !r.reachable), devices: counts };
}

module.exports = { afterPassword, afterCode, DEFAULT_TEMPLATE, TTL_MIN, RESEND_AFTER, MAX_TRIES, PER_USER_HOUR, PER_IP_HOUR, DEVICE_COOKIE, settings, saveSettings, contacts, start, resend, verify, remember, rememberedDevice, devices, removeDevice, revokeAll, status, maskPhone, maskEmail };
