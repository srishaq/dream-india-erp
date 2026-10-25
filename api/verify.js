// "Data to verify": items the import flagged. GET ?project=ID[&status=open|resolved] or ?booking=ID.
// POST {action:'resolve'|'reopen', id, resolution}. Head CRM, Head Accounts, Management and Admin can resolve.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

const canResolve = (u) => ['booking.approve', 'receipt.approve', 'users.manage'].some((p) => has(u, p));

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'inventory.view') && !has(u, 'ledger.view')) throw fail(403, 'Your role does not allow this.');
    if (req.query.booking) {
      const bk = await bookingFor(u, intOr(req.query.booking));
      return res.json({ rows: await db.q("select id, kind, severity, detail, status, resolution from import_issues where booking_id = $1 order by status, id", [bk.id]), canResolve: canResolve(u) });
    }
    const projectId = needProject(u, intOr(req.query.project));
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    const rows = await db.q(
      `select i.id, i.unit_no, i.booking_id, i.kind, i.severity, i.detail, i.status, i.resolution, i.resolved_at, x.name as resolved_by_name
         from import_issues i left join users x on x.id = i.resolved_by where i.project_id = $1 and i.status = $2
        order by (i.severity = 'money') desc, i.unit_no nulls first, i.id limit 2000`, [projectId, status]);
    const counts = await db.one("select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'open' and severity = 'money')::int as money, count(*) filter (where status = 'resolved')::int as resolved from import_issues where project_id = $1", [projectId]);
    return res.json({ rows, counts, canResolve: canResolve(u) });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!canResolve(u)) throw fail(403, 'Only Head CRM, Head Accounts, Management or Admin can close these.');
    const row = await db.one('select * from import_issues where id = $1', [intOr(b.id)]);
    if (!row) throw fail(404, 'Item not found.');
    needProject(u, row.project_id);
    if (b.action === 'resolve') {
      const note = str(b.resolution, 600);
      if (!note) throw fail(400, 'Say what was checked or corrected.');
      await db.tx(async (t) => {
        await t.q("update import_issues set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() where id = $1", [row.id, note, u.id]);
        await audit.record(t.q, { user: u, action: 'resolve', entity: 'import-issue', entityId: row.id, projectId: row.project_id, after: { unit: row.unit_no, kind: row.kind }, note });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'reopen') {
      await db.tx(async (t) => {
        await t.q("update import_issues set status = 'open' where id = $1", [row.id]);
        await audit.record(t.q, { user: u, action: 'reopen', entity: 'import-issue', entityId: row.id, projectId: row.project_id });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
