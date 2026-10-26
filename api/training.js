// Training videos. GET → the modules, which ones I have watched, and (for Admin / Management) who has watched what.
// POST {action:'watched', module} → marks a video as watched by me.
const db = require('../lib/db');
const auth = require('../lib/auth');
const { has } = require('../lib/roles');
const { MODULES } = require('../lib/training');
const { route, fail } = require('../lib/http');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    const mine = await db.q('select module, watched_at from training_progress where user_id = $1', [u.id]);
    let team = null;
    if (has(u, 'users.manage') || has(u, 'audit.view')) {
      const users = await db.q('select id, name, role from users where not disabled order by name');
      const all = await db.q('select user_id, module, watched_at from training_progress');
      team = users.map((x) => ({ name: x.name, role: x.role, watched: Object.fromEntries(all.filter((p) => p.user_id === x.id).map((p) => [p.module, p.watched_at])) }));
    }
    return res.json({ modules: MODULES, watched: Object.fromEntries(mine.map((m) => [m.module, m.watched_at])), team });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (b.action !== 'watched' || !MODULES.some((m) => m.id === b.module)) throw fail(400, 'Unknown video.');
    await db.q('insert into training_progress (user_id, module) values ($1, $2) on conflict do nothing', [u.id, b.module]);
    return res.json({ ok: true });
  },
});
