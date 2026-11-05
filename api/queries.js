// Open queries for the CRM/Accounts Audit tab. GET ?project=ID → every outstanding correction; &export=xlsx → Excel.
const auth = require('../lib/auth');
const oq = require('../lib/open-queries');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { write } = require('../lib/xlsx-write');
const { route, fail, intOr } = require('../lib/http');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (!has(u, 'accounts.view') && !has(u, 'ledger.view')) throw fail(403, 'Your role does not allow this.');
    const q = req.query || {};
    const out = await oq.build(needProject(u, intOr(q.project)));
    if (q.export === 'xlsx') {
      const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Open_queries_CRM_Accounts_${day}.xlsx"`);
      return res.end(write(oq.sheets(out)));
    }
    return res.json(out);
  },
});
