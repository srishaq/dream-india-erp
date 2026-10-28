// Individual logins with roles. Users live in the KV store (hash "users"), passwords are
// scrypt-hashed, and the session is an HMAC-signed httpOnly cookie. Every request re-reads
// the user, so disabling someone or resetting their password takes effect immediately.
const crypto = require('crypto');
const kv = require('./kv');

const COOKIE = 'ds_session';
const TTL = 30 * 24 * 3600;

// Modules: crm (sales & collections), site (construction), accounts, audit (CRM vs Accounts audit), purchase,
// ca (tax and compliance reports for the CA), drawings (architect / structural / MEP drawing register, read from Google Drive), training (training videos; every role has it, listed last so it is never anyone's home).
// hr (HR & Admin: employees, salaries, documents, letters, policies, leave) is company-wide, not per project. Only the Admin has it
// by default; the Admin gives it to any other login from Manage users (none / view / edit). View = staff list, policies and own
// leave requests; Edit = also salaries, ID documents, letters, appraisals and approving leave.
// Self = only their own employee record: they fill in their personal, ID and bank details, upload their
// own documents, see their own salary, ask for leave and read the policies. Staff logins (role "staff",
// created from the HR employee upload) have Self by default and no other department.
// site access: "admin" = edit + delete + planned dates, "write" = add and update entries.
const ROLES = {
  admin:         { label: 'Admin',         modules: ['crm', 'site', 'accounts', 'audit', 'ca', 'purchase', 'drawings', 'hr', 'training'], site: 'admin', users: true },
  management:    { label: 'Management',    modules: ['crm', 'site', 'accounts', 'audit', 'ca', 'purchase', 'drawings', 'training'], site: 'admin' },
  crm_head:      { label: 'Head CRM',      modules: ['crm', 'audit', 'training'] },
  accounts_head: { label: 'Head Accounts', modules: ['accounts', 'audit', 'ca', 'purchase', 'training'] },
  ca:            { label: 'CA',            modules: ['ca', 'accounts', 'training'] },
  site_head:     { label: 'Site Head',     modules: ['site', 'purchase', 'drawings', 'training'], site: 'admin' },
  site_engineer: { label: 'Site Engineer', modules: ['site', 'purchase', 'drawings', 'training'], site: 'write' },
  // architects, structural and MEP consultants: view and download drawings only (they upload in Google Drive)
  consultant:    { label: 'Consultant',    modules: ['drawings'] },
  staff:         { label: 'Staff',         modules: [], hr: 'self' },  // for now: only HR & Admin → My details
  // Team logins: the Admin chooses each department's access per login (stored as user.access);
  // `access` here is only the starting choice on the Add a login form.
  accounts_team: { label: 'Accounts Team', team: true, access: { accounts: 'edit', purchase: 'accounts' } },
  crm_team:      { label: 'CRM Team',      team: true, access: { crm: 'view' } },
  site_team:     { label: 'Site Team',     team: true, access: { site: 'edit', purchase: 'site', drawings: 'view' } },
  purchase_team: { label: 'Purchase Team', team: true, access: { purchase: 'purchase', drawings: 'view' } },
};
// Choices per department for team logins. Sales & CRM and Accounts pages only show the Google Sheets
// (they are corrected in the sheets), so they have View only; Construction and the audit list have
// things to edit on the portal. Purchase: which step of a purchase request the login acts on
// (site = request and confirm receipt, purchase = place order and enter bill, accounts = approve and pay).
const ACCESS_CHOICES = { crm: ['none', 'view'], site: ['none', 'view', 'edit', 'full'], accounts: ['none', 'view', 'edit'], audit: ['none', 'view', 'edit'], ca: ['none', 'view'], purchase: ['none', 'view', 'site', 'purchase', 'accounts'], drawings: ['none', 'view'], hr: ['none', 'self', 'view', 'edit'] };
const MODULE_ORDER = ['crm', 'site', 'accounts', 'audit', 'ca', 'purchase', 'drawings', 'hr', 'training'];
// Company-wide sections: no project check.
const GLOBAL = ['training', 'hr'];
function teamAccess(u) {
  const r = ROLES[u.role] || {}, out = {};
  for (const [m, ok] of Object.entries(ACCESS_CHOICES)) {
    const v = (u.access && u.access[m]) || (r.access && r.access[m]) || 'none';
    out[m] = ok.includes(v) ? v : 'none';
  }
  return out;
}
// Departments the role (or a team login's own choices) gives, before the project check.
function roleModules(u) {
  const r = ROLES[u.role] || {};
  if (!r.team) return MODULE_ORDER.filter((m) => (r.modules || []).includes(m) || (m === 'hr' && hrLevel(u) !== 'none'));
  const a = teamAccess(u);
  return MODULE_ORDER.filter((m) => m === 'training' || (a[m] && a[m] !== 'none'));
}
// HR & Admin level: Admin always edit; a team login from its access choices; any other role from its own "hr" field.
function hrLevel(u) {
  if (!u || u.legacy) return 'none';
  if (u.role === 'admin') return 'edit';
  const r = ROLES[u.role] || {};
  const v = r.team ? (u.access && u.access.hr) : (u.hr ?? r.hr);
  return ACCESS_CHOICES.hr.includes(v) ? v : 'none';
}
// Projects: each login is given one or more projects; its departments apply inside those projects only.
// Dream Aspire has Sales & CRM, Accounts and CA pages. The Admin always has every project.
// Logins saved before projects existed (no "projects" field) keep every project until the Admin sets them.
const PROJECTS = { signature: 'Dream Signature', aspire: 'Dream Aspire' };
const PROJECT_MODULES = { signature: ['crm', 'site', 'accounts', 'audit', 'ca', 'purchase', 'drawings'], aspire: ['crm', 'accounts', 'ca'] };
const cleanProjects = (p) => Object.keys(PROJECTS).filter((k) => Array.isArray(p) && p.includes(k));
function projectsOf(u) {
  if (!u) return [];
  if (u.legacy) return ['signature'];
  if (u.role === 'admin' || !Array.isArray(u.projects)) return Object.keys(PROJECTS);
  return cleanProjects(u.projects);
}
const inProject = (u, module, project) => projectsOf(u).includes(project) && PROJECT_MODULES[project].includes(module);
// Dream Signature departments this login can open (drives the Signature tabs); training needs no project.
const modulesOf = (u) => roleModules(u).filter((m) => GLOBAL.includes(m) || inProject(u, m, 'signature'));
// Dream Aspire sections this login can open.
const aspireOf = (u) => roleModules(u).filter((m) => inProject(u, m, 'aspire'));
const cleanAccess = (a) => Object.fromEntries(Object.entries(ACCESS_CHOICES).map(([m, ok]) => [m, ok.includes(a && a[m]) ? a[m] : 'none']));
const MODULE_PATH = { crm: '/#/project/1/crm', site: '/site', accounts: '/#/project/1/accounts', audit: '/#/project/1/audit', ca: '/ca', purchase: '/purchase', drawings: '/drawings', hr: '/hr', training: '/#/training' };

const secret = () => process.env.SESSION_SECRET || `ds:${process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || ''}`;
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const norm = (u) => String(u || '').trim().toLowerCase();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  return safeEq(crypto.scryptSync(String(pw || ''), salt, 32).toString('base64url'), hash);
}
const passwordProblem = (pw) => (String(pw || '').length < 8 ? 'Use at least 8 characters.' : null);

// Admin and Management see the portal Home page; Admin may edit its tiles.
const isHub = (u) => !!u && !u.legacy && (u.role === 'admin' || u.role === 'management');
// Public shape of a user: never includes the password hash.
function publicUser(u) {
  const r = ROLES[u.role] || {};
  const modules = modulesOf(u);
  return {
    username: u.username, name: u.name || u.username, role: u.role, roleLabel: r.label || u.role,
    modules, site: siteLevel(u), users: !!r.users, auditEdit: canEditAudit(u), tenantsEdit: canEditTenants(u), access: r.team ? teamAccess(u) : null, hr: hrLevel(u), disabled: !!u.disabled,
    projects: projectsOf(u), aspire: aspireOf(u), mustChange: !!u.mustChange,
    home: isHub(u) ? '/#/home' : modules[0] && modules[0] !== 'training' ? MODULE_PATH[modules[0]] : aspireOf(u).length ? '/aspire' : (MODULE_PATH[modules[0]] || '/'), legacy: !!u.legacy,
    // Admin and Management land on the portal Home page (tiles for every project and tool).
    hub: isHub(u),
  };
}

// The first Admin is created on first sign-in from ADMIN_USERNAME / ADMIN_PASSWORD, only while
// no users exist. The old shared CRM login (DASHBOARD_USERNAME / DASHBOARD_PASSWORD) keeps
// working as Head CRM until those variables are removed, so nobody is locked out on day one.
//
// Admin recovery: putting a NEW value in ADMIN_PASSWORD (and redeploying) lets the Admin sign in
// with it once, which becomes their password. Each value works for recovery only once (a hash of
// it is kept as envSeal), so an old ADMIN_PASSWORD is not a permanent second password.
async function authenticate() { return null; }
function issue() {}
function clear() {}

// Returns the signed-in user, in the portal's shape, from the ERP's own session (one login for the whole ERP).
async function session(req) {
  const erp = await require('../auth').session(req);
  if (!erp) return null;
  const u = await kv.hget('users', erp.username);
  if (!u || u.disabled || !ROLES[u.role]) return null;
  return u;
}

// project: which project's data the request is for (Dream Signature unless said otherwise).
const can = (u, module, project = 'signature') => !!u && (GLOBAL.includes(module) ? roleModules(u).includes(module) : roleModules(u).includes(module) && inProject(u, module, project));
function siteLevel(u) {
  if (!u) return null;
  const r = ROLES[u.role] || {};
  if (!inProject(u, 'site', 'signature')) return null;
  if (!r.team) return r.site || null;
  const s = teamAccess(u).site;
  return s === 'full' ? 'admin' : s === 'edit' ? 'write' : null;
}
// Ticking items done / commenting on the audit list
const canEditAudit = (u) => !!u && can(u, 'audit') && (!ROLES[u.role]?.team || teamAccess(u).audit === 'edit');

// SRA tenants rent (Accounts page): edits go straight into the master accounts sheet. Admin, Management,
// Head Accounts and every Accounts Team login with Accounts access can edit; any other team login when the
// Admin gives it Accounts "edit". (CA and view-only roles cannot.)
const TENANT_EDITORS = ['admin', 'management', 'accounts_head', 'accounts_team'];
const canEditTenants = (u) => !!u && !u.legacy && can(u, 'accounts') && (TENANT_EDITORS.includes(u.role) || (!!ROLES[u.role]?.team && teamAccess(u).accounts === 'edit'));

// Guard for API routes: responds 401/403 and returns null when access is refused.
async function guard(req, res, module, project = 'signature') {
  const u = await session(req);
  if (!u) { res.status(401).json({ error: 'login required' }); return null; }
  // A login with a temporary password must change it before opening any section.
  if (module && u.mustChange) { res.status(403).json({ error: 'Change your temporary password first.', mustChange: true, home: publicUser(u).home }); return null; }
  if (module && !can(u, module, project)) { res.status(403).json({ error: 'Your role does not have access to this section.', home: publicUser(u).home }); return null; }
  return u;
}

module.exports = { canEditTenants, hrLevel, isHub, ROLES, PROJECTS, cleanProjects, projectsOf, ACCESS_CHOICES, cleanAccess, teamAccess, canEditAudit, MODULE_PATH, authenticate, issue, clear, session, can, siteLevel, guard, publicUser, hashPassword, verifyPassword, passwordProblem, norm };
