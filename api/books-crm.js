// Books against the CRM, flat by flat. GET ?project=ID → every flat; GET ?project=ID&unit=A-1001 → that flat's receipts on both sides.
const auth = require('../lib/auth');
const bvc = require('../lib/books-vs-crm');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (!has(u, 'accounts.view') && !has(u, 'ledger.view')) throw fail(403, 'Your role does not allow this.');
    const q = req.query || {};
    const projectId = needProject(u, intOr(q.project));
    if (q.unit) return res.json(await bvc.detail(projectId, str(q.unit, 20).toUpperCase()));
    return res.json(await bvc.summary(projectId));
  },
});
