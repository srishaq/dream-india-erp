// Changes waiting for approval (lib/changes.js). GET ?status=pending|approved|rejected|all → the list (approvers see all,
// others their own). POST {action:'receipt', id, amount, date, splits, reason} asks; {action:'decide', id, approve, note} decides.
const db = require('../lib/db');
const auth = require('../lib/auth');
const C = require('../lib/changes');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

const canAsk = (u) => ['booking.approve', 'receipt.approve', 'accounts.manage'].some((p) => has(u, p));

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    const st = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = await C.list(u, { status: st });
    const n = (await db.one("select count(*)::int as n from change_requests where status = 'pending'")).n;
    return res.json({ rows, approver: C.isApprover(u), canAsk: canAsk(u), pending: n });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (b.action === 'decide') return res.json(await C.decide(u, intOr(b.id), b.approve === true, str(b.note, 300)));
    if (b.action === 'receipt') {
      if (!canAsk(u)) throw fail(403, 'Your role does not allow this.');
      const r = await db.one('select r.*, u.unit_no from receipts r join bookings bk on bk.id = r.booking_id join units u on u.id = bk.unit_id where r.id = $1', [intOr(b.id)]);
      if (!r) throw fail(404, 'Receipt not found.');
      needProject(u, r.project_id);
      if (['rejected', 'reversed'].includes(r.status)) throw fail(409, `This receipt is ${r.status}.`);
      const ch = await C.receiptChange(u, r, b);
      const out = await C.create({ user: u, kind: 'receipt', entityId: r.id, projectId: r.project_id, bookingId: r.booking_id, title: `the receipt of ${r.unit_no} dated ${String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10)}`, summary: ch.summary, before: ch.before, after: ch.after, reason: str(b.reason, 300) });
      return res.json({ ok: true, pending: true, id: out.id, notified: out.notified });
    }
    throw fail(400, 'Unknown action.');
  },
});
