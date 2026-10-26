// Accounts dashboard data (the portal's Accounts page, 13 tabs), worked out from the ERP's accounts.
// ?detail=1 returns the receipts and payments rows behind the figures (click-through lists).
const auth = require('../lib/auth');
const dash = require('../lib/acc-dashboard');
const { route } = require('../lib/http');

let cache = { at: 0, model: null, detail: null };
const TTL_MS = 60 * 1000;

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const q = req.query || {};
    if (q.refresh === '1' || !cache.model || Date.now() - cache.at > TTL_MS) {
      const { model, detail } = await dash.model();
      cache = { at: Date.now(), model: { ...model, readAt: new Date().toISOString() }, detail };
    }
    return res.json(q.detail === '1' ? { ...cache.detail, readAt: cache.model.readAt } : { ...cache.model, user: { name: u.name } });
  },
});
