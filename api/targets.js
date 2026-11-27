// Sales targets (lib/targets.js).
// GET  ?project=ID&fy=2026            → the year's targets beside what was booked, project and salesperson by salesperson
// GET  ?project=ID&fy=2026&excel=1    → { name, data } the same as an Excel file (base64)
// POST { action: 'save', projectId, fy, rows: [{ person, month, units, value }] } → replaces that year's targets
const { route, fail, intOr } = require('../lib/http');
const auth = require('../lib/auth');
const db = require('../lib/db');
const audit = require('../lib/audit');
const T = require('../lib/targets');

const sees = (u) => auth.has(u, 'reports.view') || auth.has(u, 'leads.all') || auth.has(u, 'inventory.view');
const sets = (u) => auth.has(u, 'masters.edit') || ['management', 'head_crm'].includes(u.role);
const year = (v) => { const y = intOr(v, T.thisFy()); if (y < 2015 || y > 2100) throw fail(400, 'Choose a year between 2015 and 2100.'); return y; };

async function project(u, id) {
  if (!auth.inProject(u, id)) throw fail(403, 'Your login does not include this project.');
  const p = await db.one('select id, code, name from projects where id = $1', [intOr(id, 0)]);
  if (!p) throw fail(404, 'This project is not in the ERP.');
  return p;
}

module.exports = route({
  async GET(req, res) {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (!sees(u)) throw fail(403, 'Sales targets need a sales, CRM, management or Admin login.');
    const p = await project(u, req.query.project), fy = year(req.query.fy);
    const v = await T.view(p.id, fy);
    if (req.query.excel) return res.json({ name: `${String(p.code || p.name).replace(/[^A-Za-z0-9]+/g, '-')}-sales-targets-${fy}-${String(fy + 1).slice(2)}.xlsx`, data: T.excel(v, p.name).toString('base64') });
    return res.json({ ...v, projectName: p.name, canEdit: sets(u) });
  },
  async POST(req, res, b) {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (b.action !== 'save') throw fail(400, 'Unknown action.');
    if (!sets(u)) throw fail(403, 'Only the Admin, Management or Head CRM sets the sales targets.');
    const p = await project(u, b.projectId), fy = year(b.fy);
    let n = 0;
    await db.tx(async (t) => {
      n = await T.save(t, u, p.id, fy, b.rows);
      await audit.record(t.q, { user: u, action: 'update', entity: 'sales-targets', entityId: `${p.id}:${fy}`, projectId: p.id, after: { rows: n }, note: `Sales targets for ${T.label(fy)}` });
    });
    return res.json({ ...(await T.view(p.id, fy)), projectName: p.name, canEdit: true, saved: n });
  },
});
