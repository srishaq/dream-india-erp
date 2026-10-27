// Management dashboard: the key figures of every department on one screen. Admin and Management only.
// GET ?project=ID (default: Dream Signature)
const auth = require('../lib/auth');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, intOr } = require('../lib/http');
const mgmt = require('../lib/mgmt');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'mgmt.view')) throw fail(403, 'The Management dashboard is for Admin and Management logins.');
    const p = intOr(req.query.project);
    const projectId = p ? needProject(u, p) : undefined;
    return res.json(await mgmt.build({ projectId }));
  },
});
