// Approvals dashboard (lib/approvals.js): a project's permissions in one place, with their letters.
// GET  ?project=ID                         → { project, stages, labels, list, summary, canEdit }
// GET  ?project=ID&excel=1                 → { name, data } the list as Excel (base64), to fill in and upload
// GET  ?project=ID&file=ID                 → { name, type, data } one approval letter
// GET  ?all=1                              → every project the login sees, with its summary (for the dashboards)
// POST { project, action: 'save', approval: { key?, title?, status, authority, ref_no, applied_on, received_on, valid_till, remark } }
// POST { project, action: 'remove', key }  an approval added by hand (not one of the standard list)
// POST { project, action: 'file.add', key, file: { name, data } } · { project, action: 'file.remove', id }
// POST { project, action: 'import', file: { name, data } }   the Excel back
const { route, fail } = require('../lib/http');
const auth = require('../lib/auth');
const db = require('../lib/db');
const audit = require('../lib/audit');
const A = require('../lib/approvals');
const { parseFile } = require('../lib/sheetfile');

// Dream India ERP (from Zuri, 27 Nov 2026): Management, the Admin and Accounts see it; Management and the Admin change it
const PERM = { 'project.view': ['mgmt.view', 'masters.edit', 'accounts.view'], 'project.edit': ['mgmt.view', 'masters.edit'] };
const allowed = (u, perm) => (PERM[perm] || [perm]).some((x) => auth.has(u, x));
async function load(req, res, perm, projectId) {
  const u = await auth.guard(req, res, null); if (!u) return {};
  if (!allowed(u, perm)) throw fail(403, 'Your role does not allow this.');
  if (!auth.inProject(u, projectId)) throw fail(403, 'Your login does not include this project.');
  return { u, p: await A.project(projectId) };
}
const out = async (res, u, p, extra = {}) => res.json({ ...(await A.view(p)), canEdit: allowed(u, 'project.edit'), ...extra });
const slug = (s) => String(s || 'project').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';

module.exports = route({
  async GET(req, res) {
    if (req.query.all) {
      const u = await auth.guard(req, res, null); if (!u) return; if (!allowed(u, 'project.view')) throw fail(403, 'Your role does not allow this.');
      const ps = await db.q('select id, code, name, kind, state, scheme, rera_no, active from projects where active order by id');
      const list = [];
      for (const p of ps.filter((x) => auth.inProject(u, x.id))) { const v = await A.view(p); list.push({ project: v.project, summary: v.summary, alerts: v.list.filter((x) => x.alert || x.status === 'query').map((x) => ({ title: x.title, alert: x.alert || 'query', valid_till: x.valid_till })) }); }
      return res.json({ projects: list });
    }
    const { u, p } = await load(req, res, 'project.view', req.query.project); if (!u) return;
    if (req.query.excel) return res.json({ name: `${slug(p.code || p.name)}-approvals.xlsx`, data: (await A.sheet(p)).toString('base64') });
    if (req.query.file) {
      const f = await db.one('select f.name, f.type, f.data from project_approval_files f join project_approvals a on a.id = f.approval_id where f.id = $1 and a.project_id = $2', [+req.query.file || 0, p.id]);
      if (!f) throw fail(404, 'That file is not in this project.');
      return res.json(f);
    }
    return out(res, u, p);
  },
  async POST(req, res, b) {
    const { u, p } = await load(req, res, 'project.edit', b.project); if (!u) return;
    const rec = (t, x) => audit.record(t.q, { user: u, entity: 'approval', projectId: p.id, ...x });
    if (b.action === 'save') {
      const x = b.approval && typeof b.approval === 'object' ? b.approval : {};
      await db.tx(async (t) => {
        const { before, after } = await A.save(t, u, p, x);
        await rec(t, { action: before ? 'update' : 'create', entityId: after.id, before, after, note: `${after.title}: ${A.STATUS[after.status]}` });
      });
    } else if (b.action === 'remove') {
      await db.tx(async (t) => {
        const before = await t.one('delete from project_approvals where project_id = $1 and key = $2 and custom returning *', [p.id, String(b.key || '')]);
        if (!before) throw fail(409, 'Only an approval you added yourself can be removed. Mark a standard one "Not needed" instead.');
        await rec(t, { action: 'delete', entityId: before.id, before, note: `${before.title} removed` });
      });
    } else if (b.action === 'file.add') {
      const f = A.file(b.file);
      await db.tx(async (t) => {
        let a = await t.one('select * from project_approvals where project_id = $1 and key = $2', [p.id, String(b.key || '')]);
        if (!a) a = (await A.save(t, u, p, { key: b.key })).after; // a standard approval gets its row with its first letter
        const n = await t.one('select count(*)::int as n from project_approval_files where approval_id = $1', [a.id]);
        if (n.n >= 20) throw fail(400, 'An approval keeps at most 20 files.');
        const r = await t.one('insert into project_approval_files (approval_id, name, type, size, data, created_by) values ($1, $2, $3, $4, $5, $6) returning id', [a.id, f.name, f.type, f.size, f.data, u.id]);
        await rec(t, { action: 'file-added', entityId: a.id, after: { file: r.id, name: f.name, size: f.size }, note: `${a.title}: ${f.name} added` });
      });
    } else if (b.action === 'file.remove') {
      await db.tx(async (t) => {
        const f = await t.one('delete from project_approval_files f using project_approvals a where f.id = $1 and a.id = f.approval_id and a.project_id = $2 returning f.id, f.name, a.id as approval_id, a.title', [+b.id || 0, p.id]);
        if (!f) throw fail(404, 'That file is not in this project.');
        await rec(t, { action: 'file-removed', entityId: f.approval_id, before: { file: f.id, name: f.name }, note: `${f.title}: ${f.name} removed` });
      });
    } else if (b.action === 'import') {
      const f = b.file && typeof b.file === 'object' ? b.file : {};
      const rows = parseFile(f.data, f.name, 500);
      let r;
      await db.tx(async (t) => { r = await A.importRows(t, u, p, rows); await rec(t, { action: 'import', entityId: p.id, after: r, note: `Approvals from Excel: ${r.saved} saved` }); });
      return out(res, u, p, { imported: r });
    } else throw fail(400, 'Unknown action.');
    return out(res, u, p);
  },
});
