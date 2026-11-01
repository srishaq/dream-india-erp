// Partner portal sign-in, separate from staff logins: a random session token in an httpOnly cookie (only its hash is
// stored), one-time codes (OTP) for registration and password reset, and the messages that carry them.
// Codes go by WhatsApp when Click Connect is connected and a template is set (settings.tm.waOtpTemplate /
// waWelcomeTemplate), and always by email when the ERP mailbox is set up. TM_TEST_OTP (tests only) fixes the code.
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const TM = require('./tm');

const COOKIE = 'cp_session';
const TTL = 8 * 3600;
const err = (status, message) => Object.assign(new Error(message), { status });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const secure = (req) => (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';
function cookie(req) {
  for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === COOKIE) return decodeURIComponent(p.slice(i + 1).trim()); }
  return null;
}

async function issue(req, res, cpId) {
  const tok = crypto.randomBytes(32).toString('base64url');
  await db.q("delete from cp_sessions where expires_at < now()");
  await db.q("insert into cp_sessions (token_hash, cp_id, expires_at) values ($1, $2, now() + make_interval(secs => $3))", [sha(tok), cpId, TTL]);
  res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure(req) ? '; Secure' : ''}`);
}
async function clear(req, res) {
  const tok = cookie(req);
  if (tok) await db.q('delete from cp_sessions where token_hash = $1', [sha(tok)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
}
// The signed-in partner firm, or null.
async function session(req) {
  const tok = cookie(req);
  if (!tok) return null;
  const r = await db.one(`select c.* from cp_sessions s join channel_partners c on c.id = s.cp_id where s.token_hash = $1 and s.expires_at > now()`, [sha(tok)]);
  if (!r || r.portal_status === 'blocked' || r.portal_status === 'rejected') return null;
  return r;
}
async function endAll(cpId) { await db.q('delete from cp_sessions where cp_id = $1', [cpId]); }

const passwordProblem = (pw) => { pw = String(pw || ''); return pw.length < 8 ? 'Use at least 8 characters.' : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Use letters and numbers.' : null; };
const maskEmail = (e) => { e = String(e || ''); const i = e.indexOf('@'); return i > 1 ? e[0] + '***' + e.slice(i - 1) : e; };

// Sends a code, the welcome message or an invitation. Returns where it went ("WhatsApp 98XXXXXX73 and email s***k@x.com").
// A message the partner asks for (registration, reset: to the mobile and email they typed or have on file) goes to them.
// A message started by staff (opts.staff: an invitation to a firm already in the ERP, and the codes and welcome of that
// invitation, to the mobile and email staff confirmed) follows the ERP's test rule: until the ERP is live
// (ERP_LIVE=1) it goes only to the test mobile and test email in Letter settings, like every other staff-sent message.
const live = () => process.env.ERP_LIVE === '1';
async function route({ mobile, email }, opts = {}) {
  if (!opts.staff || live()) return { mobile, email, test: false };
  const L = ((await db.one("select value from settings where key = 'letters'")) || {}).value || {};
  const tm = TM.mobile(L.testMobile || '') || null, te = String(L.testEmail || '').split(/[\/,;\s]+/).filter(Boolean)[0] || null;
  if (!tm && !te && !process.env.TM_TEST_OTP) throw err(409, 'This is the test version: set a test email (and test mobile) in Letter settings. Partner invitations go only there until the ERP is live.');
  return { mobile: mobile ? tm : null, email: email ? te : null, test: true };
}
async function send(to, kind, vars, opts = {}) {
  const { mobile, email, test } = await route(to, opts);
  const S = await TM.settings();
  const sent = [];
  const tpl = kind === 'otp' ? S.waOtpTemplate : kind === 'invite' ? S.waInviteTemplate : S.waWelcomeTemplate;
  const params = kind === 'otp' ? [vars.otp] : kind === 'invite' ? [vars.name, vars.link] : [vars.name, vars.cpCode];
  if (tpl && whatsapp.configured() && mobile) {
    try { await whatsapp.sendStaff({ phone: mobile, template: tpl, params }); sent.push('WhatsApp ' + TM.mask(mobile)); }
    catch (e) { console.error('cp whatsapp', e.message); }
  }
  if (email && mailer.configured()) {
    const portal = (process.env.PARTNER_URL || 'https://partners.dreamindiarealty.com').replace(/\/+$/, '');
    const m = kind === 'invite'
      ? { subject: `${test ? '[TEST] ' : ''}Dream India Realty invites ${vars.firm} to the Partner Portal`,
        text: `Dear ${vars.name},\n\n${vars.firm} is a channel partner of Dream India Realty. You can now see your bookings and brokerage, send your bills and register clients on the Dream India Partner Portal.\n\nOpen this link to set up your login (it works once and expires on ${vars.expires}):\n${vars.link}\n\nWe will send a verification code to your mobile and email on our records.`,
        html: `<p>Dear ${esc(vars.name)},</p><p><b>${esc(vars.firm)}</b> is a channel partner of Dream India Realty. You can now see your bookings and brokerage, send your bills and register clients on the Dream India Partner Portal.</p><p><a href="${esc(vars.link)}" style="display:inline-block;background:#140C59;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Set up your login</a></p><p style="color:#555">The link works once and expires on ${esc(vars.expires)}. We will send a verification code to your mobile and email on our records.</p>` }
      : kind === 'otp'
      ? { subject: `Your Dream India verification code: ${vars.otp}`,
        text: `Your Dream India Realty verification code is ${vars.otp}. It expires in 10 minutes. Do not share it with anyone.`,
        html: `<p>Your Dream India Realty verification code is</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px">${vars.otp}</p><p>It expires in 10 minutes. Do not share it with anyone.</p>` }
      : { subject: `Your Dream India Channel Partner ID: ${vars.cpCode}`,
        text: `Dear ${vars.name},\n\nWelcome to the Dream India Realty Partner Portal. Your Channel Partner ID is ${vars.cpCode}. Please quote it on every client registration and booking.\n\nPartner portal: ${portal}`,
        html: `<p>Dear ${esc(vars.name)},</p><p>Welcome to the Dream India Realty Partner Portal. Your Channel Partner ID is</p><p style="font-size:24px;font-weight:bold">${esc(vars.cpCode)}</p><p>Please quote it on every client registration and booking.</p><p>Partner portal: <a href="${portal}">${portal}</a></p>` };
    if (test && kind !== 'invite') m.subject = '[TEST] ' + m.subject;
    try { const c = await mailer.connect(); try { await c.send({ to: [email], subject: m.subject, text: m.text, html: m.html, fromName: 'Dream India Realty' }); } finally { await c.close(); } sent.push('email ' + maskEmail(email)); }
    catch (e) { console.error('cp mail', e.message); }
  }
  if (!sent.length && process.env.TM_TEST_OTP) sent.push('test');
  if (!sent.length) throw err(503, 'We could not send the message. Please contact the Dream India office.');
  return sent.join(' and ') + (test && sent[0] !== 'test' ? ' (test address)' : '');
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Codes asked for in an hour: per mobile, per email address, per internet address, and for the whole portal.
const OTP_LIMITS = { mobile: 5, email: 5, ip: 10, all: 200 };
const ipOf = (req) => require('./mkt-rate').ipOf(req);
// A new code for purpose ('register' | 'reset'), within the limits above. Returns the code's id.
async function newCode({ purpose, mobile, email, ip, payload, staff = false }) {
  const recent = await db.one("select count(*)::int as c from cp_otps where mobile = $1 and created_at > now() - interval '1 hour'", [mobile]);
  if (recent.c >= OTP_LIMITS.mobile) throw err(429, 'Too many codes asked for this mobile. Please wait an hour and try again.');
  const RL = require('./mkt-rate');
  if (!(await RL.allow('otp-all', 'portal', OTP_LIMITS.all))) throw err(429, 'The partner portal is busy. Please try again in an hour, or contact the Dream India office.');
  if (ip && !(await RL.allow('otp-ip', ip, OTP_LIMITS.ip))) throw err(429, 'Too many codes asked from this internet connection. Please wait an hour and try again.');
  if (email && !(await RL.allow('otp-email', String(email).toLowerCase(), OTP_LIMITS.email))) throw err(429, 'Too many codes asked for this email address. Please wait an hour and try again.');
  const otp = process.env.TM_TEST_OTP || String(crypto.randomInt(100000, 1000000));
  const id = crypto.randomBytes(18).toString('base64url');
  const sentTo = await send({ mobile, email }, 'otp', { otp }, { staff });
  await db.q("insert into cp_otps (id, purpose, mobile, payload, otp_hash, sent_to, expires_at) values ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')",
    [id, purpose, mobile, payload || {}, sha(id + ':' + otp), sentTo]);
  return { token: id, sentTo };
}
// Checks a code; returns its row (and deletes it) when right. Five wrong tries end it.
async function checkCode(id, purpose, otp) {
  const r = await db.one('select * from cp_otps where id = $1 and purpose = $2 and expires_at > now()', [String(id || ''), purpose]);
  if (!r) throw err(400, 'This code has expired. Please ask for a new one.');
  const want = Buffer.from(r.otp_hash), got = Buffer.from(sha(r.id + ':' + String(otp || '').trim()));
  if (!(want.length === got.length && crypto.timingSafeEqual(want, got))) {
    const t = await db.one('update cp_otps set tries = tries + 1 where id = $1 returning tries', [r.id]);
    if (t.tries >= 5) { await db.q('delete from cp_otps where id = $1', [r.id]); throw err(400, 'Too many wrong codes. Please start again.'); }
    throw err(400, 'That code is not correct.');
  }
  await db.q('delete from cp_otps where id = $1', [r.id]);
  return r;
}

module.exports = { OTP_LIMITS, ipOf, sha, issue, clear, session, endAll, send, newCode, checkCode, passwordProblem, maskEmail, hash: auth.hashPassword, verify: auth.verifyPassword };
