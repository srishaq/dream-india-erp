// Accounts dashboard data (the portal's Accounts page, 13 tabs), worked out from the ERP's accounts.
// ?detail=1 returns the receipts and payments rows behind the figures (click-through lists).
const auth = require('../lib/auth');
const dash = require('../lib/acc-dashboard');
const { route } = require('../lib/http');

// one cache per project's books (24 Nov 2026: Aspire showed Signature's figures when both were opened within a minute)
const caches = new Map();
const TTL_MS = 60 * 1000;

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const q = req.query || {};
    const bk = require('../lib/book').code();
    let cache = caches.get(bk) || { at: 0, model: null, detail: null };
    if (q.refresh === '1' || !cache.model || Date.now() - cache.at > TTL_MS) {
      const { model, detail } = await dash.model();
      cache = { at: Date.now(), model: { ...model, readAt: new Date().toISOString() }, detail };
      caches.set(bk, cache);
    }
    return res.json(q.detail === '1' ? { ...cache.detail, readAt: cache.model.readAt } : { ...cache.model, user: { name: u.name } });
  },
});
