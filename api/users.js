// Admin only. GET lists logins (?security=1: the Login security panel); POST {action}: create, update, reset, disable,
// enable, devices-revoke (sign out all devices), security (Login security settings).
// New logins and resets get a temporary password, shown once, that must be changed at first sign-in.
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { ROLES } = require('../lib/roles');
const OTP = require('../lib/staff-otp');
const { route, fail, str, intOr } = require('../lib/http');

const tempPassword = () => {
  const words = ['Mango', 'Tower', 'River', 'Cedar', 'Pearl', 'Falcon', 'Harbor', 'Lotus', 'Summit', 'Monsoon'];
  return `${words[crypto.randomInt(words.length)]}-${crypto.randomInt(1000, 9999)}-${crypto.randomBytes(3).toString('hex')}`;
};

async function list() {
  const users = await db.q('select id, username, name, role, disabled, must_change, all_projects, phone, designation, email, created_at from users order by disabled, name');
  const links = await db.q('select user_id, project_id from user_projects');
  for (const u of users) u.projects = links.filter((l) => l.user_id === u.id).map((l) => l.project_id);
  const projects = await db.q('select id, name from projects where active order by name');
  return { users, projects, roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, perms: r.perms })) };
}

async function setProjects(t, userId, ids) {
  await t.q('delete from user_projects where user_id = $1', [userId]);
  for (const p of ids) await t.q('insert into user_projects (user_id, project_id) values ($1, $2)', [userId, p]);
}
const cleanIds = (a) => (Array.isArray(a) ? [...new Set(a.map((x) => intOr(x)).filter((x) => x > 0))] : []);

const emailOrNull = (v) => { const e = str(v, 120).toLowerCase(); if (!e) return null; if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) throw fail(400, 'That email address does not look right.'); return e; };

module.exports = route({
  GET: async (req, res) => {
    const me = await auth.guard(req, res, 'users.manage'); if (!me) return;
    if (req.query && req.query.security) { if (me.role !== 'admin') throw fail(403, 'Only the Admin sees Login security.'); return res.json(await OTP.status()); }
    return res.json(await list());
  },
  POST: async (req, res, b) => {
    const me = await auth.guard(req, res, 'users.manage'); if (!me) return;
    const role = str(b.role, 30);
    if (b.action === 'security') {
      if (me.role !== 'admin') throw fail(403, 'Only the Admin can change Login security.');
      await OTP.saveSettings(me, { enforce: b.enforce !== false, waOtpTemplate: str(b.waOtpTemplate, 120) });
      return res.json({ ok: true, ...(await OTP.status()) });
    }
    if (b.action === 'create') {
      const username = auth.norm(b.username), name = str(b.name, 80);
      if (!auth.USERNAME.test(username)) throw fail(400, 'Username: 3 to 40 letters, numbers, dots or dashes.');
      if (!name) throw fail(400, 'Enter the person\'s name.');
      if (!ROLES[role]) throw fail(400, 'Choose a role.');
      const temp = tempPassword();
      await db.tx(async (t) => {
        const u = await t.one('insert into users (username, name, role, password_hash, must_change, all_projects, phone, designation, email, created_by) values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9) returning id',
          [username, name, role, auth.hashPassword(temp), !!b.allProjects, str(b.phone, 20) || null, str(b.designation, 80) || null, emailOrNull(b.email), me.id]);
        await setProjects(t, u.id, cleanIds(b.projects));
        await audit.record(t.q, { user: me, action: 'create', entity: 'user', entityId: u.id, after: { username, name, role, allProjects: !!b.allProjects, projects: cleanIds(b.projects) } });
      });
      return res.json({ ok: true, username, tempPassword: temp, ...(await list()) });
    }
    const id = intOr(b.id);
    const before = id && (await db.one('select id, username, name, role, disabled, all_projects, phone, email from users where id = $1', [id]));
    if (!before) throw fail(404, 'Login not found.');
    if (id === me.id && ['disable', 'update'].includes(b.action) && (b.action === 'disable' || role !== 'admin')) throw fail(400, 'You cannot remove your own Admin access.');
    if (b.action === 'update') {
      if (!ROLES[role]) throw fail(400, 'Choose a role.');
      const name = str(b.name, 80) || before.name;
      const phone = str(b.phone, 20) || null, email = emailOrNull(b.email);
      const phoneChanged = (phone || '') !== (before.phone || ''), emailChanged = (email || '') !== (before.email || '');
      // sign-in codes go to this mobile and email: nobody changes their own (another Admin does), except to fill in a blank one
      if (id === me.id && ((phoneChanged && before.phone) || (emailChanged && before.email))) throw fail(403, 'You cannot change your own mobile or email: sign-in codes go there. Another Admin must change it.');
      await db.tx(async (t) => {
        await t.q('update users set name = $2, role = $3, all_projects = $4, phone = $5, designation = $6, email = $7, session_version = session_version + 1, portal_role = case when role = $3 then portal_role end, portal_access = case when role = $3 then portal_access end where id = $1', [id, name, role, !!b.allProjects, phone, str(b.designation, 80) || null, email]);
        await setProjects(t, id, cleanIds(b.projects));
        const { phone: bp, email: be, ...rest } = before;
        await audit.record(t.q, { user: me, action: 'update', entity: 'user', entityId: id, before: rest, after: { name, role, allProjects: !!b.allProjects, projects: cleanIds(b.projects) } });
        if (phoneChanged) await audit.record(t.q, { user: me, action: 'phone', entity: 'user', entityId: id, before: { phone: before.phone }, after: { phone }, note: `Mobile for sign-in codes changed for ${before.username}: ${before.phone || 'none'} → ${phone || 'none'}` });
        if (emailChanged) await audit.record(t.q, { user: me, action: 'email', entity: 'user', entityId: id, before: { email: before.email }, after: { email }, note: `Email for sign-in codes changed for ${before.username}: ${before.email || 'none'} → ${email || 'none'}` });
        if (role !== before.role) { const n = await OTP.revokeAll(t.q, id); if (n) await audit.record(t.q, { user: me, action: 'devices-revoke', entity: 'user', entityId: id, note: `New role: ${n} remembered device(s) of ${before.username} signed out` }); }
      });
      return res.json({ ok: true, ...(await list()) });
    }
    if (b.action === 'reset') {
      const temp = tempPassword();
      await db.tx(async (t) => {
        await t.q('update users set password_hash = $2, must_change = true, session_version = session_version + 1 where id = $1', [id, auth.hashPassword(temp)]);
        const n = await OTP.revokeAll(t.q, id);
        await audit.record(t.q, { user: me, action: 'reset-password', entity: 'user', entityId: id, note: n ? `${n} remembered device(s) signed out` : null });
      });
      return res.json({ ok: true, username: before.username, tempPassword: temp, ...(await list()) });
    }
    if (b.action === 'disable' || b.action === 'enable') {
      const off = b.action === 'disable';
      await db.tx(async (t) => {
        await t.q('update users set disabled = $2, session_version = session_version + 1 where id = $1', [id, off]);
        const n = off ? await OTP.revokeAll(t.q, id) : 0;
        await audit.record(t.q, { user: me, action: b.action, entity: 'user', entityId: id, note: n ? `${n} remembered device(s) signed out` : null });
      });
      return res.json({ ok: true, ...(await list()) });
    }
    if (b.action === 'devices-revoke') { // "Sign out all devices": every session and every remembered device of that login
      if (me.role !== 'admin') throw fail(403, 'Only the Admin can do this.');
      let n = 0;
      await db.tx(async (t) => {
        await t.q('update users set session_version = session_version + 1 where id = $1', [id]);
        n = await OTP.revokeAll(t.q, id);
        await audit.record(t.q, { user: me, action: 'devices-revoke', entity: 'user', entityId: id, note: `Signed out all devices of ${before.username} (${n} remembered device(s))` });
      });
      return res.json({ ok: true, revoked: n, ...(await OTP.status()) });
    }
    throw fail(400, 'Unknown action.');
  },
});
