// Channel partners and brokerage. GET ?project=ID → every booking with a channel partner, what brokerage is
// owed, whether it is due under the brokerage rule, and what has been billed and paid; also totals per firm.
// POST {action}: amount (set a booking's brokerage), bill, payment, rule.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');

const n = (v) => Number(v) || 0;
const r2 = (x) => Math.round(x * 100) / 100;
const money = (v) => { const x = Number(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return Number.isFinite(x) && x > 0 ? r2(x) : NaN; };
async function rule() { const r = await db.one("select value from settings where key = 'brokerage_rule'"); return { afterRegistration: true, minReceivedPct: 10, ...(r ? r.value : {}) }; }

async function list(projectId) {
  const R = await rule();
  const rows = await db.q(
    `select b.id as booking_id, u.unit_no, b.cp_name, b.source, b.brokerage, b.brokerage_released, b.agreement_value, b.booking_date, b.registration_date, b.rm_name,
            coalesce(bb.credit_av, 0) as received,
            (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers,
            coalesce((select sum(amount) from brokerage_entries e where e.booking_id = b.id and e.kind = 'bill'), 0) as billed,
            coalesce((select sum(amount) from brokerage_entries e where e.booking_id = b.id and e.kind = 'payment'), 0) as paid,
            (select max(entry_date) from brokerage_entries e where e.booking_id = b.id and e.kind = 'payment') as last_paid
       from bookings b join units u on u.id = b.unit_id left join booking_balances bb on bb.booking_id = b.id
      where u.project_id = $1 and b.status = 'active' and (b.cp_name is not null or b.brokerage is not null)
      order by lower(coalesce(b.cp_name, '')), u.unit_no`, [projectId]);
  for (const r of rows) {
    const amt = n(r.brokerage), av = n(r.agreement_value);
    const pctIn = av ? (n(r.received) / av) * 100 : 0;
    r.received_pct = Math.round(pctIn * 10) / 10;
    // Brokerage marked "released" in the CRM sheet counts as paid in full.
    if (r.brokerage_released && n(r.paid) < amt) r.paid_before = r2(amt - n(r.paid));
    const paid = n(r.paid) + n(r.paid_before);
    r.eligible = (!R.afterRegistration || !!r.registration_date) && pctIn + 1e-9 >= Number(R.minReceivedPct || 0);
    r.balance = r2(Math.max(0, amt - paid));
    r.payable_now = r.eligible ? r.balance : 0;
    r.state = !amt ? 'No amount' : r.balance <= 1 ? 'Paid' : r.eligible ? 'Due' : 'Not yet due';
    r.why = r.state === 'Not yet due' ? [R.afterRegistration && !r.registration_date ? 'not registered' : '', pctIn < R.minReceivedPct ? `${r.received_pct}% received of ${R.minReceivedPct}% needed` : ''].filter(Boolean).join(', ') : '';
  }
  const firms = {};
  for (const r of rows) {
    const name = (r.cp_name || 'No firm named').replace(/\s+/g, ' ').trim(), k = name.toLowerCase().replace(/[.,]+$/, '');
    const f = (firms[k] ||= { firm: name, units: 0, agreementValue: 0, received: 0, brokerage: 0, paid: 0, payableNow: 0, notYetDue: 0, billed: 0 });
    if (name.length > f.firm.length) f.firm = name;
    f.units++; f.agreementValue += n(r.agreement_value); f.received += n(r.received); f.brokerage += n(r.brokerage); f.paid += n(r.paid) + n(r.paid_before);
    f.payableNow += r.payable_now; f.billed += n(r.billed); if (r.state === 'Not yet due') f.notYetDue += r.balance;
  }
  return { rule: R, rows, firms: Object.values(firms).sort((a, b) => b.brokerage - a.brokerage) };
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ledger.view'); if (!u) return;
    const projectId = needProject(u, intOr(req.query.project));
    if (req.query.booking) {
      const bk = await bookingFor(u, intOr(req.query.booking));
      return res.json({ entries: await db.q('select e.*, x.name as by_name from brokerage_entries e left join users x on x.id = e.created_by where e.booking_id = $1 order by e.entry_date, e.id', [bk.id]) });
    }
    return res.json({ ...(await list(projectId)), can: { bill: has(u, 'brokerage.bill'), pay: has(u, 'brokerage.pay'), rule: has(u, 'price.manage') } });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };
    if (b.action === 'rule') {
      need('price.manage');
      const before = await rule();
      const v = { afterRegistration: !!b.afterRegistration, minReceivedPct: Math.min(100, Math.max(0, Number(b.minReceivedPct) || 0)) };
      await db.tx(async (t) => {
        await t.q("insert into settings (key, value) values ('brokerage_rule', $1) on conflict (key) do update set value = excluded.value", [v]);
        await audit.record(t.q, { user: u, action: 'update', entity: 'settings', entityId: 'brokerage_rule', before, after: v });
      });
      return res.json({ ok: true });
    }
    const bk = await bookingFor(u, intOr(b.bookingId));
    if (bk.status !== 'active') throw fail(409, 'This booking is not active.');
    if (b.action === 'amount') {
      need('brokerage.bill');
      const amt = money(b.amount); if (!Number.isFinite(amt)) throw fail(400, 'Enter the brokerage amount in rupees.');
      if (amt >= n(bk.agreement_value)) throw fail(400, 'Brokerage cannot be more than the agreement value.');
      const cp = str(b.cpName, 120) || bk.cp_name;
      await db.tx(async (t) => {
        await t.q('update bookings set brokerage = $2, cp_name = $3 where id = $1', [bk.id, amt, cp]);
        await audit.record(t.q, { user: u, action: 'brokerage-amount', entity: 'booking', entityId: bk.id, projectId: bk.project_id, before: { brokerage: bk.brokerage, cp: bk.cp_name }, after: { brokerage: amt, cp } });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'bill' || b.action === 'payment') {
      need(b.action === 'bill' ? 'brokerage.bill' : 'brokerage.pay');
      const amt = money(b.amount); if (!Number.isFinite(amt)) throw fail(400, 'Enter the amount in rupees.');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null; if (!date) throw fail(400, 'Enter the date.');
      if (date > today()) throw fail(400, 'The date cannot be in the future.');
      const ref = str(b.reference, 80);
      if (!ref) throw fail(400, b.action === 'bill' ? 'Enter the partner\'s bill or invoice number.' : 'Enter the payment reference (UTR or cheque number).');
      const L = await list(bk.project_id);
      const row = L.rows.find((r) => r.booking_id === bk.id);
      if (!row || !n(row.brokerage)) throw fail(400, 'Set the brokerage amount for this booking first.');
      if (b.action === 'payment') {
        if (!row.eligible && !(b.override && has(u, 'cancellation.approve'))) throw fail(409, `Brokerage is not due yet (${row.why}). Management can pay early by confirming it.`);
        if (amt > row.balance + 1) throw fail(400, `Only ${row.balance.toLocaleString('en-IN')} of brokerage is left to pay on this booking.`);
      }
      await db.tx(async (t) => {
        const e = await t.one('insert into brokerage_entries (booking_id, kind, entry_date, amount, reference, note, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id', [bk.id, b.action, date, amt, ref, str(b.note, 300) || null, u.id]);
        await audit.record(t.q, { user: u, action: 'brokerage-' + b.action, entity: 'booking', entityId: bk.id, projectId: bk.project_id, after: { entry: e.id, amount: amt, date, reference: ref, early: !!(b.action === 'payment' && !row.eligible) } });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
