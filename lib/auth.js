// Logins: scrypt-hashed passwords, an HMAC-signed httpOnly session cookie, and a fresh read of
// the user on every request so disabling a login or resetting a password takes effect at once.
const crypto = require('crypto');
const db = require('./db');
const { ROLES, has } = require('./roles');

const COOKIE = 'erp_session';
const TTL = 12 * 3600; // a working day; staff sign in again the next day

let secretCache = null;
async function secret() {
  if (secretCache) return secretCache;
  const row = await db.one("select value from settings where key = 'session_secret'");
  if (!row) throw new Error('session secret missing: run setup');
  secretCache = row.value;
  return secretCache;
}
const sign = async (v) => crypto.createHmac('sha256', await secret()).update(v).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const norm = (u) => String(u || '').trim().toLowerCase();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 32).toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) { crypto.scryptSync('x', 'y', 32); return false; }
  return safeEq(crypto.scryptSync(String(pw || ''), salt, 32).toString('base64url'), hash);
}
const passwordProblem = (pw) => (String(pw || '').length < 10 ? 'Use at least 10 characters.' : null);
const USERNAME = /^[a-z0-9._@-]{3,60}$/;

function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
const secure = (req) => (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';

async function issue(req, res, u) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const v = `${u.id}.${u.session_version}.${exp}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${v}.${await sign(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure(req) ? '; Secure' : ''}`);
}
function clear(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
}

async function loadUser(id) {
  const u = await db.one('select id, username, name, role, must_change, disabled, session_version, all_projects from users where id = $1', [id]);
  if (!u || u.disabled || !ROLES[u.role]) return null;
  u.projects = u.all_projects || u.role === 'admin'
    ? (await db.q('select id from projects where active order by id')).map((r) => r.id)
    : (await db.q('select project_id as id from user_projects where user_id = $1 order by project_id', [u.id])).map((r) => r.id);
  return u;
}

// The signed-in user, or null.
async function session(req) {
  const raw = cookies(req)[COOKIE];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [id, sv, exp, sig] = parts;
  if (!safeEq(await sign(`${id}.${sv}.${exp}`), sig) || +exp < Date.now() / 1000) return null;
  const u = await loadUser(+id);
  if (!u || String(u.session_version) !== sv) return null;
  return u;
}

// Ten wrong passwords in 15 minutes locks that username for 15 minutes.
// Admin reset, switched on in Vercel only: ERP_ADMIN_RESET_USER and ERP_ADMIN_RESET_PASSWORD (at least 10 characters).
// Signing in once with exactly those sets that password on that login (or makes it an Admin login if it does not exist),
// asks for a new password straight away, and is then spent: the same value never works a second time.
async function adminReset(name, password) {
  const ru = norm(process.env.ERP_ADMIN_RESET_USER), rp = process.env.ERP_ADMIN_RESET_PASSWORD;
  if (!ru || !rp || rp.length < 10 || name !== ru || password !== rp) return null;
  const seal = crypto.createHash('sha256').update(ru + ':' + rp).digest('hex');
  const used = await db.one("select value from settings where key = 'admin_reset_used'");
  if (used && (used.value || []).includes(seal)) return null;
  const hash = hashPassword(rp);
  let u = await db.one('select id from users where username = $1', [ru]);
  if (u) await db.q("update users set password_hash = $2, must_change = true, disabled = false, role = case when role = 'admin' then role else 'admin' end, session_version = session_version + 1 where id = $1", [u.id, hash]);
  else u = await db.one("insert into users (username, name, role, password_hash, must_change, all_projects) values ($1, 'Syed Rafi Ishaq', 'admin', $2, true, true) returning id", [ru, hash]);
  await db.q("insert into settings (key, value) values ('admin_reset_used', $1) on conflict (key) do update set value = settings.value || excluded.value", [JSON.stringify([seal])]);
  await db.q('delete from login_failures where username = $1', [ru]);
  await db.q("insert into audit_log (user_id, action, entity, entity_id, note) values ($1, 'admin-reset', 'user', $2, 'Admin password reset from the Vercel settings')", [u.id, String(u.id)]);
  return { user: await loadUser(u.id) };
}

async function authenticate(username, password) {
  const name = norm(username);
  const reset = await adminReset(name, String(password || '')).catch((e) => { console.error(e); return null; });
  if (reset) return reset;
  const fails = await db.one("select count(*)::int as n from login_failures where username = $1 and at > now() - interval '15 minutes'", [name]);
  if (fails.n >= 10) return { error: 'Too many wrong attempts. Try again in 15 minutes.' };
  const u = await db.one('select id, password_hash, disabled from users where username = $1', [name]);
  if (!u || u.disabled || !verifyPassword(password, u.password_hash)) {
    await db.q('insert into login_failures (username) values ($1)', [name]);
    return { error: 'Wrong username or password.' };
  }
  await db.q('delete from login_failures where username = $1', [name]);
  return { user: await loadUser(u.id) };
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLES[u.role].label, perms: ROLES[u.role].perms, projects: u.projects, mustChange: u.must_change };
}

// For API routes: returns the user, or sends 401/403 and returns null.
async function guard(req, res, perm) {
  const u = await session(req);
  if (!u) { res.status(401).json({ error: 'Please sign in.' }); return null; }
  if (u.must_change && perm !== 'self') { res.status(403).json({ error: 'Set a new password first.', mustChange: true }); return null; }
  if (perm && perm !== 'self' && !has(u, perm)) { res.status(403).json({ error: 'Your role does not allow this.' }); return null; }
  return u;
}
const inProject = (u, projectId) => u.projects.includes(+projectId);

module.exports = { USERNAME, norm, hashPassword, verifyPassword, passwordProblem, issue, clear, session, authenticate, publicUser, guard, inProject, has };
