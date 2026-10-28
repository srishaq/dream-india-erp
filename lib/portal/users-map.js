// One set of logins: the ERP's users, seen by the portal code in the portal's shape, and portal-style
// records (from the HR upload, or copied from the portal) saved as ERP logins with the same password.
const db = require('../db');

// ERP role → the portal role it acts as in Purchase, Construction, Drawings and HR (unless a portal role is set)
const FROM_ERP = { admin: 'admin', management: 'management', head_crm: 'crm_head', crm: 'crm_team', sales: 'crm_team', head_accounts: 'accounts_head', accounts: 'accounts_team',
  ca: 'ca', site_head: 'site_head', site_engineer: 'site_engineer', site_team: 'site_team', purchase_team: 'purchase_team', staff: 'staff', consultant: 'consultant', viewer: 'crm_team' };
// portal role → ERP role for a login copied from the portal
const TO_ERP = { admin: 'admin', management: 'management', crm_head: 'head_crm', accounts_head: 'head_accounts', ca: 'ca', site_head: 'site_head', site_engineer: 'site_engineer',
  staff: 'staff', accounts_team: 'accounts', crm_team: 'crm', site_team: 'site_team', purchase_team: 'purchase_team', consultant: 'consultant' };
const KEEP_OUT = new Set(['username', 'name', 'role', 'hash', 'sv', 'access', 'hr', 'projects', 'disabled', 'mustChange']);

function shape(u) {
  return { ...(u.portal_extra || {}), username: u.username, name: u.name, role: u.portal_role || FROM_ERP[u.role] || 'staff', access: u.portal_access || undefined,
    hr: u.portal_hr || undefined, projects: u.portal_projects || undefined, disabled: !!u.disabled, mustChange: !!u.must_change, sv: u.session_version, erpId: u.id, erpRole: u.role };
}
async function allUsers() {
  const rows = await db.q('select id, username, name, role, must_change, disabled, session_version, portal_role, portal_access, portal_hr, portal_projects, portal_extra from users order by id');
  return Object.fromEntries(rows.map((u) => [u.username, shape(u)]));
}
async function saveUser(username, rec) {
  const un = String(username).trim().toLowerCase();
  const extra = Object.fromEntries(Object.entries(rec || {}).filter(([k]) => !KEEP_OUT.has(k) && k !== 'erpId' && k !== 'erpRole'));
  const ex = await db.one('select id, password_hash from users where username = $1', [un]);
  const hash = /^scrypt\$[^$]+\$[^$]+$/.test(rec.hash || '') ? rec.hash : null;
  if (ex) {
    await db.q(`update users set name = coalesce($2, name), portal_role = $3, portal_access = $4, portal_hr = $5, portal_projects = $6, portal_extra = $7, disabled = $8,
                  password_hash = coalesce($9, password_hash), must_change = case when $9::text is not null and $9::text <> password_hash then $10 else must_change end,
                  session_version = case when $9::text is not null and $9::text <> password_hash then session_version + 1 else session_version end where id = $1`,
    [ex.id, rec.name || null, rec.role || null, rec.access ? JSON.stringify(rec.access) : null, rec.hr || null, rec.projects ? JSON.stringify(rec.projects) : null, JSON.stringify(extra), !!rec.disabled, hash, !!rec.mustChange]);
    return;
  }
  if (!hash) throw new Error(`No password for the new login ${un}.`);
  await db.q(`insert into users (username, name, role, password_hash, must_change, disabled, all_projects, portal_role, portal_access, portal_hr, portal_projects, portal_extra)
              values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11)`,
  [un, rec.name || un, TO_ERP[rec.role] || 'staff', hash, !!rec.mustChange, !!rec.disabled, rec.role || null, rec.access ? JSON.stringify(rec.access) : null, rec.hr || null, rec.projects ? JSON.stringify(rec.projects) : null, JSON.stringify(extra)]);
}
module.exports = { allUsers, saveUser, shape, FROM_ERP, TO_ERP };
