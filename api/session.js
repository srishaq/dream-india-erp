// GET  /api/session            → where setup stands, and the signed-in user
// POST /api/session {action}   → setup (first Admin), login (password) → login-otp (the code; login-resend), logout,
//                                login-email-add, password, devices / device-remove (own remembered devices),
//                                app / app-begin / app-confirm / app-email / app-remove (own sign-in app)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const OTP = require('../lib/staff-otp');
const { migrate, status } = require('../lib/migrate');
const { route, fail, str } = require('../lib/http');

async function state(req) {
  if (!db.configured()) return { state: 'no-db' };
  const s = await status();
  const codeRequired = !!process.env.ERP_SETUP_CODE;
  if (s.pending.length && !s.applied.length) return { state: 'needs-setup', codeRequired };
  if (s.pending.length) await migrate(); // a new release with new tables: apply quietly
  const n = await db.one('select count(*)::int as n from users');
  if (n.n === 0) return { state: 'needs-setup', codeRequired };
  const u = await auth.session(req);
  if (!u) return { state: 'ready', user: null };
  // sections brought over from the staff portal (Construction, Purchase, Drawings, HR & Admin) this login may open
  const pu = await require('../lib/portal/auth').session(req).catch(() => null);
  const sections = pu ? require('../lib/portal/auth').publicUser(pu).modules.filter((m) => ['site', 'purchase', 'drawings', 'hr'].includes(m)) : [];
  return { state: 'ready', user: { ...auth.publicUser(u), sections } };
}

module.exports = route({
  GET: async (req, res) => res.json(await state(req)),

  POST: async (req, res, b) => {
    switch (b.action) {
      case 'setup': {
        if (!db.configured()) throw fail(503, 'The database is not connected yet.');
        const code = process.env.ERP_SETUP_CODE;
        if (code && b.code !== code) throw fail(403, 'Wrong setup code.');
        const username = auth.norm(b.username), name = str(b.name, 80), password = String(b.password || '');
        if (!auth.USERNAME.test(username)) throw fail(400, 'Username: 3 to 40 letters, numbers, dots or dashes.');
        if (!name) throw fail(400, 'Enter your name.');
        const p = auth.passwordProblem(password); if (p) throw fail(400, p);
        await migrate();
        const u = await db.tx(async (t) => {
          await t.q('lock table users in exclusive mode');
          const n = await t.one('select count(*)::int as n from users');
          if (n.n > 0) throw fail(409, 'Setup is already done. Please sign in.');
          const row = await t.one("insert into users (username, name, role, password_hash, all_projects) values ($1, $2, 'admin', $3, true) returning id", [username, name, auth.hashPassword(password)]);
          await audit.record(t.q, { user: row, action: 'create', entity: 'user', entityId: row.id, after: { username, name, role: 'admin' }, note: 'First Admin created at setup' });
          return row;
        });
        const user = await db.one('select id, session_version from users where id = $1', [u.id]);
        await auth.issue(req, res, user);
        return res.json({ ok: true });
      }
      case 'login': {
        const r = await auth.authenticate(b.username, b.password, req);
        if (r.error) throw fail(401, r.error);
        // the session starts only after the code (or on a remembered device, or the break-glass Admin reset)
        return res.json(await OTP.afterPassword(req, res, r, 'erp', auth.issue));
      }
      case 'login-otp': {
        const u = await OTP.afterCode(req, res, b, 'erp', auth.issue);
        return res.json({ ok: true, user: auth.publicUser(u) });
      }
      case 'login-resend':
        return res.json(await OTP.resend(b.token, req, 'erp', b.email ? 'email' : 'auto'));
      case 'login-email-add': // no email and no sign-in app yet: the code goes to the email typed, saved once it is right
        return res.json(await OTP.addEmail(b.token, b.email, req, 'erp'));
      // the sign-in app (authenticator): status, set up (QR code and secret), confirm with a code, email code, remove
      case 'app': case 'app-begin': case 'app-confirm': case 'app-email': case 'app-remove': {
        const u = await auth.guard(req, res, 'self'); if (!u) return;
        if (b.action === 'app') return res.json(await OTP.appStatus(u.id));
        if (b.action === 'app-begin') return res.json(await OTP.appBegin(u));
        if (b.action === 'app-confirm') return res.json({ ok: true, ...(await OTP.appConfirm(u, b.code)) });
        if (b.action === 'app-email') return res.json(await OTP.appEmail(u, req));
        return res.json({ ok: true, ...(await OTP.appRemove(u, { token: b.token, code: b.code })) });
      }
      case 'devices': {
        const u = await auth.guard(req, res, 'self'); if (!u) return;
        return res.json({ devices: await OTP.devices(u.id, req) });
      }
      case 'device-remove': {
        const u = await auth.guard(req, res, 'self'); if (!u) return;
        await db.tx(async (t) => {
          if (!(await OTP.removeDevice(t.q, u.id, +b.id || 0))) throw fail(404, 'That device is not remembered.');
          await audit.record(t.q, { user: u, action: 'device-remove', entity: 'user', entityId: u.id, note: 'Removed one of own remembered devices' });
        });
        return res.json({ ok: true, devices: await OTP.devices(u.id, req) });
      }
      case 'logout':
        auth.clear(req, res);
        return res.json({ ok: true });
      case 'password': {
        const u = await auth.guard(req, res, 'self'); if (!u) return;
        const row = await db.one('select password_hash from users where id = $1', [u.id]);
        if (!auth.verifyPassword(b.current, row.password_hash)) throw fail(400, 'Your current password is not right.');
        const p = auth.passwordProblem(b.next); if (p) throw fail(400, p);
        if (b.next === b.current) throw fail(400, 'Choose a password different from the current one.');
        const updated = await db.tx(async (t) => {
          const r = await t.one('update users set password_hash = $2, must_change = false, session_version = session_version + 1 where id = $1 returning id, session_version', [u.id, auth.hashPassword(b.next)]);
          const n = await OTP.revokeAll(t.q, u.id);
          await audit.record(t.q, { user: u, action: 'password', entity: 'user', entityId: u.id, note: 'Changed own password' + (n ? `; ${n} remembered device${n === 1 ? '' : 's'} signed out` : '') });
          return r;
        });
        await auth.issue(req, res, updated);
        return res.json({ ok: true });
      }
      default:
        throw fail(400, 'Unknown action.');
    }
  },
});
