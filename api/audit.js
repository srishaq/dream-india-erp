// GET /api/audit?entity=&limit= → the latest changes, newest first (audit.view).
const db = require('../lib/db');
const auth = require('../lib/auth');
const { route, str, intOr } = require('../lib/http');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'audit.view'); if (!u) return;
    const q = req.query || {};
    const entity = str(q.entity, 30) || null;
    const limit = Math.min(Math.max(intOr(q.limit, 200), 1), 1000);
    const rows = await db.q(
      `select a.id, a.at, a.action, a.entity, a.entity_id, a.before, a.after, a.note, u.name as user_name, p.name as project
         from audit_log a left join users u on u.id = a.user_id left join projects p on p.id = a.project_id
        where ($1::text is null or a.entity = $1)
          and (a.project_id is null or a.project_id = any($2::int[]))
        order by a.at desc, a.id desc limit $3`,
      [entity, u.projects, limit],
    );
    return res.json({ rows });
  },
});
