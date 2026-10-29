// The collections dashboard (the same screens as the staff portal's Dream Signature dashboard), from ERP records.
// GET ?project=ID
const auth = require('../lib/auth');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, intOr } = require('../lib/http');
const dashboard = require('../lib/dashboard');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'ledger.view')) throw fail(403, 'Your role does not allow the collections dashboard.');
    const projectId = needProject(u, intOr(req.query.project));
    const m = await dashboard.build(projectId);
    // overdue by age, worked out the same way as on the Management dashboard
    m.ageing = await require('../lib/mgmt').overdue(require('../lib/demands').today(), projectId).then((o) => ({ total: o.raw.total, buyers: o.raw.buyers, buckets: o.raw.buckets, top: o.list.rows })).catch(() => null);
    m.me = { name: u.name, canLetters: has(u, 'demand.raise'), canFollowups: has(u, 'ledger.view') };
    return res.json(m);
  },
});
