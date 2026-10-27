// Purchase, Drawings and HR & Admin (brought over from the staff portal), and /api/me: who is signed in and which of
// those sections they may open, in the portal's shape. /api/me and /api/hr are rewritten here (vercel.json).
// The section code is the portal's own (lib/portal/), running on the ERP's database and logins.
const auth = require('../lib/portal/auth');
const { noStore } = require('../lib/portal/http');
const { migrateIfNeeded } = require('../lib/portal/boot');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && !require('../lib/portal/http').sameOrigin(req)) return res.status(403).json({ error: 'Request not allowed.' });
  await migrateIfNeeded();
  const q = req.query || {};
  if (q.drawings === '1') return require('../lib/portal/drawings-api')(req, res);
  if (q.hr === '1') return require('../lib/portal/hr-api')(req, res);
  if (q.purchase === '1') return require('../lib/portal/purchase-api')(req, res);
  if (q.copy === '1') return require('../lib/portal/copy')(req, res);
  noStore(res);
  const u = await auth.session(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'login required' });
  res.status(200).json(auth.publicUser(u));
};
