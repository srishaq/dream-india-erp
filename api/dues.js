// Dues & actions (the old dashboard's tab): every live booking's balance due, grouped by the CRM follow-up status.
// GET ?project=ID → { rows, statuses }; &export=xlsx (with q, status, wing, due=1) → the same list as Excel.
const db = require('../lib/db');
const auth = require('../lib/auth');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { write } = require('../lib/xlsx-write');
const { route, fail, str, intOr } = require('../lib/http');

const n = (v) => Math.round(Number(v) || 0);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '');

async function rows(projectId) {
  const R = await db.q(`select b.id, u.unit_no, bl.code as wing, u.typology, b.crm_status, b.cp_name, b.agreement_value, b.booking_date, b.registration_status,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
      (select y.phone from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as phone,
      bb.demanded, bb.demanded_gst, bb.credit_av, bb.received_gst, bb.received_sdr, bb.outstanding, bb.overdue, bb.gst_outstanding, bb.last_receipt,
      (select max(d.demand_date) from demands d where d.booking_id = b.id and d.status = 'raised') as last_demand
    from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id left join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.status = 'active' and not coalesce(b.sample, false) order by u.unit_no`, [projectId]);
  return R.map((r) => ({ id: r.id, unit: r.unit_no, wing: r.wing, typology: r.typology || '', status: r.crm_status || 'Not set', buyer: r.buyer || '', phone: r.phone || '', cp: r.cp_name || '',
    av: n(r.agreement_value), demanded: n(r.demanded) + n(r.demanded_gst), received: n(r.credit_av) + n(r.received_gst), avDue: n(r.outstanding), gstDue: n(r.gst_outstanding), due: n(r.outstanding) + n(r.gst_outstanding),
    overdue: n(r.overdue), lastReceipt: iso(r.last_receipt), lastDemand: iso(r.last_demand), booked: iso(r.booking_date), registration: r.registration_status || '' }));
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    if (!has(u, 'ledger.view') && !has(u, 'accounts.view')) throw fail(403, 'Your role does not allow this.');
    const q = req.query || {};
    const all = await rows(needProject(u, intOr(q.project)));
    if (q.export === 'xlsx') {
      const w = str(q.q, 80).toLowerCase(), st = str(q.status, 80), wing = str(q.wing, 4);
      const list = all.filter((r) => (!st || r.status === st) && (!wing || r.wing === wing) && (q.due !== '1' || r.avDue > 0) && (!w || `${r.unit} ${r.buyer} ${r.phone} ${r.cp} ${r.status}`.toLowerCase().includes(w)));
      const head = ['Flat', 'Wing', 'Type', 'Follow-up status', 'Buyer', 'Mobile', 'Channel partner', 'Agreement value', 'Demanded (with GST)', 'Received (with GST)', 'AV due', 'GST due', 'AV + GST due', 'Overdue now', 'Last receipt', 'Last demand', 'Booked on', 'Registration'];
      const body = list.map((r) => [r.unit, r.wing, r.typology, r.status, r.buyer, r.phone, r.cp, r.av, r.demanded, r.received, r.avDue, r.gstDue, r.due, r.overdue, r.lastReceipt, r.lastDemand, r.booked, r.registration]);
      const by = {}; for (const r of list) { if (!r.avDue) continue; const x = (by[r.status] ||= { A: 0, B: 0, n: 0, due: 0, gst: 0 }); x[r.wing] = (x[r.wing] || 0) + 1; x.n++; x.due += r.avDue; x.gst += r.gstDue; }
      const sum = [['Follow-up status', 'Wing A', 'Wing B', 'Units', 'Balance due (AV)', 'GST due'], ...Object.entries(by).sort((a, b) => b[1].due - a[1].due).map(([k, x]) => [k, x.A || 0, x.B || 0, x.n, x.due, x.gst])];
      const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Dues_and_actions_${day}.xlsx"`);
      return res.end(write([{ name: 'By status', rows: sum, widths: [28, 10, 10, 10, 16] }, { name: 'Flats', rows: [head, ...body], widths: [9, 6, 8, 24, 28, 13, 24, 14, 14, 14, 13, 12, 14, 13, 12, 12, 12, 14] }]));
    }
    return res.json({ rows: all });
  },
});
