// Approvals dashboard (lib/approvals.js): a project's permissions in one place, with their letters.
// GET  ?project=ID                         → { project, stages, labels, list, summary, canEdit }
// GET  ?project=ID&excel=1                 → { name, data } the list as Excel (base64), to fill in and upload
// GET  ?project=ID&file=ID                 → { name, type, data } one approval letter
// GET  ?all=1                              → every project the login sees, with its summary (for the dashboards)
// POST { project, action: 'save', approval: { key?, title?, status, authority, ref_no, applied_on, received_on, valid_till, remark } }
// POST { project, action: 'docs.link', key, docIds: [customer_docs ids of this project's documents] }
// GET  ?project=ID&docs=1                 → { docs } the project's documents, to link to an approval
// POST { project, action: 'flow.start', flow: 'open'|'sra' }   the step-by-step journey (lib/approval-flow.js)
// POST { project, action: 'item.save', item: { id?, step, title, who, status, owner_id, due_on, sent_on, note, docIds } } · { action: 'item.remove', id }
// POST { project, action: 'step.save', step, owner_id, due_on, note } · { action: 'money.save', money: { id?, step, item, expected, paid, paid_on, ref } } · { action: 'money.remove', id }
// POST { project, action: 'handover', from, to, all? }
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
// the Approvals & documentation role (approvals.work) sees and updates the steps, documents and approvals, not the money
const PERM = { 'project.view': ['mgmt.view', 'masters.edit', 'accounts.view', 'approvals.work'], 'project.edit': ['mgmt.view', 'masters.edit', 'approvals.work'], money: ['mgmt.view', 'masters.edit', 'accounts.view'], setup: ['mgmt.view', 'masters.edit'] };
const F = require('../lib/approval-flow');
const allowed = (u, perm) => (PERM[perm] || [perm]).some((x) => auth.has(u, x));
async function load(req, res, perm, projectId) {
  const u = await auth.guard(req, res, null); if (!u) return {};
  if (!allowed(u, perm)) throw fail(403, 'Your role does not allow this.');
  if (!auth.inProject(u, projectId)) throw fail(403, 'Your login does not include this project.');
  return { u, p: await A.project(projectId) };
}
const out = async (res, u, p, extra = {}) => {
  const v = await A.view(p), money = allowed(u, 'money');
  return res.json({ ...v, flow: p.approval_flow ? await F.view(p, v.list, { money }) : null, flows: Object.keys(F.FLOWS), canEdit: allowed(u, 'project.edit'), canMoney: money, canSetup: allowed(u, 'setup'), me: u.id, ...extra });
};
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
    if (req.query.docs) return res.json({ docs: await A.projectDocs(p) });
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
    } else if (b.action === 'docs.link') {
      await db.tx(async (t) => {
        const { before, after } = await A.linkDocs(t, u, p, b.key, b.docIds);
        await rec(t, { action: 'update', entityId: after.id, before: { doc_ids: before.doc_ids }, after: { doc_ids: after.doc_ids }, note: `${after.title}: documents linked` });
      });
    } else if (b.action === 'flow.start') {
      if (!allowed(u, 'setup')) throw fail(403, 'Management sets up the approval journey.');
      await db.tx(async (t) => { const n = await F.start(t, p, String(b.flow || ''), u.id); p.approval_flow = String(b.flow); await rec(t, { action: 'update', entityId: p.id, after: { approval_flow: b.flow, checklist: n }, note: `Approval journey: ${b.flow} (${n} documents)` }); });
    } else if (b.action === 'item.save') {
      await db.tx(async (t) => { const { before, after } = await F.saveItem(t, u, p, b.item && typeof b.item === 'object' ? b.item : {}); await audit.record(t.q, { user: u, entity: 'approval-doc', projectId: p.id, action: before ? 'update' : 'create', entityId: after.id, before, after, note: `${after.title}: ${F.STATUS[after.status]}` }); });
    } else if (b.action === 'item.remove') {
      await db.tx(async (t) => { const r = await F.removeItem(t, p, b.id); await audit.record(t.q, { user: u, entity: 'approval-doc', projectId: p.id, action: 'delete', entityId: r.id, before: r, note: `${r.title} removed` }); });
    } else if (b.action === 'step.save') {
      await db.tx(async (t) => { const r = await F.saveStep(t, p, b); await audit.record(t.q, { user: u, entity: 'approval-step', projectId: p.id, action: 'update', after: r, note: `Step ${r.step_key}: owner and due date` }); });
    } else if (b.action === 'money.save' || b.action === 'money.remove') {
      if (!allowed(u, 'money')) throw fail(403, 'Your role does not allow this.');
      await db.tx(async (t) => { const r = b.action === 'money.save' ? await F.saveMoney(t, u, p, b.money || {}) : await F.removeMoney(t, p, b.id); await audit.record(t.q, { user: u, entity: 'approval-money', projectId: p.id, action: b.action === 'money.save' ? 'update' : 'delete', after: r, note: `${r.item}: fee` }); });
    } else if (b.action === 'handover') {
      if (!allowed(u, 'setup')) throw fail(403, 'Management hands over approval work.');
      let r; await db.tx(async (t) => { r = await F.handOver(t, b.from, b.to, b.all ? null : p.id); await audit.record(t.q, { user: u, entity: 'approval-step', projectId: p.id, action: 'handover', after: { from: b.from, to: b.to, ...r }, note: `Approval work handed over: ${r.documents} documents, ${r.steps} steps` }); });
      return out(res, u, p, { handedOver: r });
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
