// Test version only: load or remove sample data for a project (Admin).
// Refuses to add to a project that has units, and refuses to remove anything that is not sample data.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const sample = require('../lib/sample');
const { needProject } = require('../lib/access');
const { route, fail, intOr } = require('../lib/http');

module.exports = route({
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    if (process.env.ERP_LIVE === '1') throw fail(403, 'Sample data is switched off on the live ERP.');
    const projectId = needProject(u, intOr(b.projectId));
    if (b.action === 'load') {
      const out = await db.tx(async (t) => {
        const r = await sample.load(t, projectId, u.id);
        await audit.record(t.q, { user: u, action: 'sample-load', entity: 'project', entityId: projectId, projectId, after: r });
        return r;
      });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'clear') {
      await db.tx(async (t) => {
        await sample.clear(t, projectId);
        await audit.record(t.q, { user: u, action: 'sample-clear', entity: 'project', entityId: projectId, projectId, note: 'Sample units, bookings, demands and receipts removed' });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
