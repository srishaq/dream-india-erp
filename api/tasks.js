// Daily To-Do. GET ?dept=crm|accounts&date= → that day's list (audit findings + own tasks), the audit runs, the team.
// POST {action:'add', dept, title, detail?, assignedTo?} | {action:'done', id, note?} | {action:'undo', id}
//      | {action:'assign', id, userId} | {action:'remove', id} (own tasks only) | {action:'run', dept} (heads: run the audit now).
// Today's audit runs by itself when the list is first opened after 9 am, in case the 9 am job did not run.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const dt = require('../lib/daily-tasks');
const { has } = require('../lib/roles');
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const istHour = () => new Date(Date.now() + 5.5 * 3600000).getUTCHours();

async function taskFor(u, id) {
  const k = await db.one('select * from daily_tasks where id = $1', [id]);
  if (!k) throw fail(404, 'That task is not there any more.');
  if (!dt.can(u, k.dept, 'edit')) throw fail(403, 'Your role cannot change this list.');
  return k;
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    const dept = req.query.dept;
    if (!dt.can(u, dept, 'view')) throw fail(403, 'Your role does not see this list.');
    const date = DATE.test(req.query.date || '') ? req.query.date : today();
    if (date === today() && istHour() >= 9 && !(await dt.ranToday(dept))) await dt.run(dept, { trigger: 'open', mail: false }).catch((e) => console.error(e));
    const L = await dt.list(dept, date);
    return res.json({ ...L, team: await dt.team(dept), me: u.id, can: { edit: dt.can(u, dept, 'edit'), run: dt.can(u, dept, 'run') } });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (b.action === 'add') {
      if (!dt.can(u, b.dept, 'edit')) throw fail(403, 'Your role cannot add to this list.');
      const title = str(b.title, 200); if (!title) throw fail(400, 'Write the task.');
      const to = b.assignedTo ? intOr(b.assignedTo) : null;
      if (to && !(await dt.team(b.dept)).some((x) => x.id === to)) throw fail(400, 'Pick someone from the team.');
      const r = await db.one("insert into daily_tasks (dept, task_date, source, title, detail, assigned_to, created_by, since) values ($1, $2, 'own', $3, $4, $5, $6, $2) returning id", [b.dept, today(), title, str(b.detail, 1000) || null, to, u.id]);
      await audit.record(db.q, { user: u, action: 'task-add', entity: 'daily-task', entityId: r.id, after: { dept: b.dept, title, assignedTo: to } });
      return res.json({ ok: true, id: r.id });
    }
    if (b.action === 'run') {
      if (!dt.can(u, b.dept, 'run')) throw fail(403, 'Only the head of the team can run the audit.');
      const r = await dt.run(b.dept, { trigger: 'manual', user: u, mail: false });
      return res.json({ ok: true, found: r.found.length, error: r.run.error });
    }
    const k = await taskFor(u, intOr(b.id));
    if (b.action === 'done') {
      if (k.done_at) return res.json({ ok: true });
      await db.q('update daily_tasks set done_at = now(), done_by = $2, done_note = $3, cleared = false where id = $1', [k.id, u.id, str(b.note, 500) || null]);
      await audit.record(db.q, { user: u, action: 'task-done', entity: 'daily-task', entityId: k.id, after: { title: k.title, note: str(b.note, 500) || null } });
      return res.json({ ok: true });
    }
    if (b.action === 'undo') {
      await db.q('update daily_tasks set done_at = null, done_by = null, done_note = null, cleared = false where id = $1', [k.id]);
      await audit.record(db.q, { user: u, action: 'task-undo', entity: 'daily-task', entityId: k.id, after: { title: k.title } });
      return res.json({ ok: true });
    }
    if (b.action === 'assign') {
      const to = b.userId ? intOr(b.userId) : null;
      if (to && !(await dt.team(k.dept)).some((x) => x.id === to)) throw fail(400, 'Pick someone from the team.');
      await db.q('update daily_tasks set assigned_to = $2 where id = $1', [k.id, to]);
      await audit.record(db.q, { user: u, action: 'task-assign', entity: 'daily-task', entityId: k.id, after: { title: k.title, assignedTo: to } });
      return res.json({ ok: true });
    }
    if (b.action === 'remove') {
      if (k.source !== 'own') throw fail(400, 'Audit findings cannot be removed; tick them off with a note instead.');
      if (k.created_by !== u.id && !dt.can(u, k.dept, 'run')) throw fail(403, 'Only the person who added it, or the head of the team, can remove it.');
      await db.q('delete from daily_tasks where id = $1', [k.id]);
      await audit.record(db.q, { user: u, action: 'task-remove', entity: 'daily-task', entityId: k.id, before: { title: k.title } });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
