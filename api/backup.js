// GET /api/backup → the last backups (Admin). POST {action:'run'} → back up now.
const auth = require('../lib/auth');
const B = require('../lib/backup');
const audit = require('../lib/audit');
const db = require('../lib/db');
const { route, fail } = require('../lib/http');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    return res.json({ ...(await B.status()), folderName: B.FOLDER_NAME });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    if (b.action !== 'run') throw fail(400, 'Unknown action.');
    const r = await B.run({ trigger: 'manual', force: true });
    await audit.record(db.q, { user: u, action: 'backup', entity: 'settings', after: { file: r.file, bytes: r.bytes } });
    return res.json(r);
  },
});
