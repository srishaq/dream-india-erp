// CA page data (GST, TDS payable, RERA quarterly, cash flow statement, compliance, customer TDS, non-revenue receipts),
// worked out from the ERP's accounts. ?detail=1 returns the receipts and payments rows behind the figures.
const auth = require('../lib/auth');
const ca = require('../lib/ca-data');
const { route } = require('../lib/http');

let cache = { at: 0, model: null, detail: null };
const TTL_MS = 60 * 1000;

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ca.view'); if (!u) return;
    const q = req.query || {};
    if (q.refresh === '1' || !cache.model || Date.now() - cache.at > TTL_MS) {
      const { summary, detail } = await ca.model();
      cache = { at: Date.now(), model: { ...summary, readAt: new Date().toISOString(), user: { name: u.name, role: u.roleLabel || u.role } }, detail };
    }
    return res.json(q.detail === '1' ? { ...cache.detail, readAt: cache.model.readAt } : cache.model);
  },
});
