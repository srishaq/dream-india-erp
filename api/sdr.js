// Stamp duty and registration (SDR) challans, one register for Accounts. Each flat gets its challan once: a second
// challan for the same flat and the same duty is refused, unless Head Accounts gives the reason (a failed challan,
// a re-registration); the same GRN can never be entered twice. Every change is in the audit log.
// GET ?project=ID → { rows, flats (sold flats with their stamp duty and SDR received from the buyer), dupes }
// POST {action:'add', ...} | {action:'update', id, status, note, ...} | {action:'check', unit, kind} (is there one already?)
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

const KINDS = ['stamp_duty', 'registration', 'both'];
const STATUS = ['generated', 'paid', 'used', 'cancelled', 'refund_claimed'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const overlaps = (k) => (k === 'both' ? KINDS : [k, 'both']);
const unitKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^([A-Z])(\d)/, '$1-$2');

async function existing(projectId, unit, kind, exceptId = 0) {
  return db.q(`select c.id, c.kind, c.grn, c.challan_no, c.challan_date, c.amount, c.status, u.name as by_name from sdr_challans c left join users u on u.id = c.created_by
    where c.project_id = $1 and c.unit_no = $2 and c.kind = any($3) and c.status <> 'cancelled' and c.id <> $4 order by c.id`, [projectId, unit, overlaps(kind), exceptId]);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const pid = needProject(u, intOr(req.query.project));
    const rows = await db.q(`select c.*, x.name as by_name from sdr_challans c left join users x on x.id = c.created_by where c.project_id = $1 order by c.challan_date desc nulls last, c.id desc limit 2000`, [pid]);
    const flats = await db.q(`select un.unit_no, b.id as booking_id, b.stamp_duty, b.registration_fee, b.registration_date, coalesce(bb.received_sdr, 0) as sdr_received,
        (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
      from bookings b join units un on un.id = b.unit_id left join booking_balances bb on bb.booking_id = b.id
      where un.project_id = $1 and b.status = 'active' and not b.sample order by un.unit_no`, [pid]);
    const dupes = await db.q(`select unit_no, count(*)::int as n, sum(amount) as amount from sdr_challans where project_id = $1 and status <> 'cancelled' and kind in ('stamp_duty', 'both')
      group by unit_no having count(*) > 1 order by unit_no`, [pid]);
    return res.json({ rows, flats, dupes, kinds: KINDS, statuses: STATUS, canManage: has(u, 'accounts.manage'), canEnter: has(u, 'accounts.enter') });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'accounts.enter'); if (!u) return;
    const pid = needProject(u, intOr(b.projectId));
    const unit = unitKey(b.unit);
    const kind = KINDS.includes(b.kind) ? b.kind : 'stamp_duty';
    if (b.action === 'check') return res.json({ existing: await existing(pid, unit, kind) });
    if (b.action === 'add') {
      if (!/^[A-Z]-\d{3,5}$/.test(unit)) throw fail(400, 'Enter the flat as A-1001.');
      const amount = Number(String(b.amount || '').replace(/[₹,\s]/g, ''));
      if (!(amount > 0)) throw fail(400, 'Enter the challan amount.');
      const date = DATE.test(b.challanDate || '') ? b.challanDate : null;
      const grn = str(b.grn, 40).toUpperCase() || null;
      if (grn) { const g = await db.one("select id, unit_no from sdr_challans where upper(grn) = $1 and status <> 'cancelled'", [grn]); if (g) throw fail(409, `GRN ${grn} is already entered, for ${g.unit_no}. The same challan cannot be entered twice.`); }
      const ex = await existing(pid, unit, kind);
      const reason = str(b.duplicateReason, 300);
      if (ex.length && !reason) throw Object.assign(fail(409, `${unit} already has ${ex.length === 1 ? 'a' : ex.length} ${kind === 'registration' ? 'registration' : 'stamp duty'} challan${ex.length > 1 ? 's' : ''} (${ex.map((e) => `${e.grn || e.challan_no || 'no GRN'}, ₹${Math.round(e.amount).toLocaleString('en-IN')}, ${e.status}`).join('; ')}). Check before paying again: a second challan is the same duty paid twice.`), { duplicate: ex });
      if (ex.length && !has(u, 'accounts.manage')) throw fail(403, 'A second challan for the same flat needs Head Accounts.');
      const bk = await db.one("select b.id from bookings b join units un on un.id = b.unit_id where un.project_id = $1 and un.unit_no = $2 and b.status = 'active' order by b.id desc limit 1", [pid, unit]);
      const row = await db.one(`insert into sdr_challans (project_id, booking_id, unit_no, kind, challan_no, grn, challan_date, amount, paid_from, status, duplicate_reason, note, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [pid, bk ? bk.id : null, unit, kind, str(b.challanNo, 40) || null, grn, date, amount, str(b.paidFrom, 80) || null, STATUS.includes(b.status) ? b.status : 'generated', ex.length ? reason : null, str(b.note, 300) || null, u.id]);
      await audit.record(db.q, { user: u, action: ex.length ? 'add-second' : 'add', entity: 'sdr-challan', entityId: row.id, projectId: pid, after: { unit, kind, grn, amount, date }, note: ex.length ? `Second challan: ${reason}` : null });
      return res.json({ ok: true, id: row.id, second: !!ex.length });
    }
    if (b.action === 'update') {
      const c = await db.one('select * from sdr_challans where id = $1 and project_id = $2', [intOr(b.id), pid]); if (!c) throw fail(404, 'That challan is not there.');
      const set = {};
      if (STATUS.includes(b.status)) set.status = b.status;
      if (b.note != null) set.note = str(b.note, 300) || null;
      if (b.paidFrom != null) set.paid_from = str(b.paidFrom, 80) || null;
      if (DATE.test(b.challanDate || '')) set.challan_date = b.challanDate;
      const cols = Object.keys(set); if (!cols.length) throw fail(400, 'Nothing to change.');
      await db.q(`update sdr_challans set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_by = $${cols.length + 2}, updated_at = now() where id = $1`, [c.id, ...cols.map((k) => set[k]), u.id]);
      await audit.record(db.q, { user: u, action: 'update', entity: 'sdr-challan', entityId: c.id, projectId: pid, before: Object.fromEntries(cols.map((k) => [k, c[k]])), after: set });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
