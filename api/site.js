// Construction (Site Office): slab schedule and progress, DPRs, hindrances, materials, floor-wise works.
// The portal's own code (lib/portal/site-api.js), on the ERP's database and logins.
const { migrateIfNeeded } = require('../lib/portal/boot');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && !require('../lib/portal/http').sameOrigin(req)) return res.status(403).json({ error: 'Request not allowed.' }); await migrateIfNeeded(); return require('../lib/portal/site-api')(req, res); };
