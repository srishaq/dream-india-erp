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

// Sends a code or the welcome message. Returns where it went ("WhatsApp 98XXXXXX73 and email s***k@x.com").
async function send({ mobile, email }, kind, vars) {
  const S = await TM.settings();
  const sent = [];
  const tpl = kind === 'otp' ? S.waOtpTemplate : S.waWelcomeTemplate;
  if (tpl && whatsapp.configured() && mobile) {
    try { await whatsapp.sendStaff({ phone: mobile, template: tpl, params: kind === 'otp' ? [vars.otp] : [vars.name, vars.cpCode] }); sent.push('WhatsApp ' + TM.mask(mobile)); }
    catch (e) { console.error('cp whatsapp', e.message); }
  }
  if (email && mailer.configured()) {
    const portal = (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '') + '/partner';
    const m = kind === 'otp'
      ? { subject: `Your Dream India verification code: ${vars.otp}`,
        text: `Your Dream India Realty verification code is ${vars.otp}. It expires in 10 minutes. Do not share it with anyone.`,
        html: `<p>Your Dream India Realty verification code is</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px">${vars.otp}</p><p>It expires in 10 minutes. Do not share it with anyone.</p>` }
      : { subject: `Your Dream India Channel Partner ID: ${vars.cpCode}`,
        text: `Dear ${vars.name},\n\nWelcome to the Dream India Realty Partner Portal. Your Channel Partner ID is ${vars.cpCode}. Please quote it on every client registration and booking.\n\nPartner portal: ${portal}`,
        html: `<p>Dear ${esc(vars.name)},</p><p>Welcome to the Dream India Realty Partner Portal. Your Channel Partner ID is</p><p style="font-size:24px;font-weight:bold">${esc(vars.cpCode)}</p><p>Please quote it on every client registration and booking.</p><p>Partner portal: <a href="${portal}">${portal}</a></p>` };
    try { const c = await mailer.connect(); try { await c.send({ to: [email], subject: m.subject, text: m.text, html: m.html, fromName: 'Dream India Realty' }); } finally { await c.close(); } sent.push('email ' + maskEmail(email)); }
    catch (e) { console.error('cp mail', e.message); }
  }
  if (!sent.length && process.env.TM_TEST_OTP) sent.push('test');
  if (!sent.length) throw err(503, 'We could not send the message. Please contact the Dream India office.');
  return sent.join(' and ');
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A new code for purpose ('register' | 'reset'), at most 5 an hour per mobile. Returns the code's id.
async function newCode({ purpose, mobile, email, payload }) {
  const recent = await db.one("select count(*)::int as c from cp_otps where mobile = $1 and created_at > now() - interval '1 hour'", [mobile]);
  if (recent.c >= 5) throw err(429, 'Too many codes asked for this mobile. Please wait an hour and try again.');
  const otp = process.env.TM_TEST_OTP || String(crypto.randomInt(100000, 1000000));
  const id = crypto.randomBytes(18).toString('base64url');
  const sentTo = await send({ mobile, email }, 'otp', { otp });
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

module.exports = { issue, clear, session, endAll, send, newCode, checkCode, passwordProblem, maskEmail, hash: auth.hashPassword, verify: auth.verifyPassword };
