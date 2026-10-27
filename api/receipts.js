// Buyer receipts. GET ?project=ID[&status=pending]. POST {action}: create, approve, reject, bounce, reverse,
// handed (cheque given to Accounts), deposited (Accounts deposited it), bankcheck (look for the cheques in the bank now).
// Each cheque is then found on the bank statement by itself (lib/cheque-match.js).
// A receipt counts towards a buyer's balance only once Head Accounts (not the person who entered it) approves it.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor, notOwn } = require('../lib/access');
const { today } = require('../lib/demands');
const { toPaise, rupees } = require('../lib/money');
const { route, fail, str, intOr } = require('../lib/http');

const HEADS = ['av', 'gst', 'tds', 'stamp_duty', 'registration', 'other'];
const MODES = ['bank', 'cheque', 'loan', 'tds', 'other'];

async function list(projectId, status) {
  return db.q(
    `select r.id, r.received_on, r.amount, r.mode, r.bank, r.instrument_no, r.status, r.note, r.reverse_reason, r.opening, r.created_by, r.booking_id,
            u.unit_no, c.name as created_by_name, a.name as approved_by_name, r.approved_at, r.approved_note,
            r.handed_on, r.deposited_on, r.bank_status, r.bank_on, r.bank_ref, r.bank_match, h.name as handed_by_name, dp.name as deposited_by_name,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = r.booking_id) as buyers,
            coalesce((select json_object_agg(s.head, s.amount) from receipt_splits s where s.receipt_id = r.id), '{}') as splits
       from receipts r left join bookings b on b.id = r.booking_id left join units u on u.id = b.unit_id
       left join users c on c.id = r.created_by left join users a on a.id = r.approved_by
       left join users h on h.id = r.handed_by left join users dp on dp.id = r.deposited_by
      where r.project_id = $1 and ($2::text is null or r.status = $2)
      order by (r.status = 'pending') desc, r.received_on desc, r.id desc limit 1000`, [projectId, status]);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!['receipt.enter', 'receipt.approve', 'ledger.view'].some((p) => has(u, p))) return res.status(403).json({ error: 'Your role does not allow this.' });
    const status = ['pending', 'approved', 'rejected', 'bounced', 'reversed'].includes(req.query.status) ? req.query.status : null;
    return res.json({ rows: await list(needProject(u, intOr(req.query.project)), status) });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };

    if (b.action === 'create') {
      need('receipt.enter');
      const bk = await bookingFor(u, intOr(b.bookingId));
      if (!['active', 'pending'].includes(bk.status)) throw fail(409, 'This booking is not active.');
      const amount = toPaise(b.amount);
      if (!(amount > 0)) throw fail(400, 'Enter the amount received.');
      const on = /^\d{4}-\d{2}-\d{2}$/.test(b.receivedOn || '') ? b.receivedOn : null;
      if (!on || on > today()) throw fail(400, 'Enter the date received (not in the future).');
      const splits = {};
      let sum = 0;
      for (const h of HEADS) {
        const v = b.splits && b.splits[h];
        if (v === undefined || v === null || v === '') continue;
        const p = toPaise(v);
        if (!(p >= 0)) throw fail(400, `The ${h.replace('_', ' ')} part looks wrong.`);
        if (p > 0) { splits[h] = p; sum += p; }
      }
      if (sum !== amount) throw fail(400, `The parts add up to ₹${rupees(sum)}, but the receipt is ₹${rupees(amount)}. They must match.`);
      const mode = MODES.includes(b.mode) ? b.mode : 'bank';
      const instrument = str(b.instrumentNo, 60) || null;
      if (instrument && !b.allowDuplicate) {
        const dup = await db.one("select id from receipts where booking_id = $1 and instrument_no = $2 and amount = $3 and status not in ('rejected')", [bk.id, instrument, rupees(amount)]);
        if (dup) throw Object.assign(fail(409, `Receipt #${dup.id} already has this instrument number and amount for this booking.`), { duplicate: dup.id });
      }
      const id = await db.tx(async (t) => {
        const row = await t.one(
          `insert into receipts (project_id, booking_id, received_on, amount, mode, bank, instrument_no, account_no, note, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [bk.project_id, bk.id, on, rupees(amount), mode, str(b.bank, 80) || null, instrument, str(b.accountNo, 30) || null, str(b.note, 300) || null, u.id]);
        for (const [h, p] of Object.entries(splits)) await t.q('insert into receipt_splits (receipt_id, head, amount) values ($1, $2, $3)', [row.id, h, rupees(p)]);
        await audit.record(t.q, { user: u, action: 'create', entity: 'receipt', entityId: row.id, projectId: bk.project_id, after: { unit: bk.unit_no, receivedOn: on, amount: rupees(amount), mode, instrument, splits: Object.fromEntries(Object.entries(splits).map(([h, p]) => [h, rupees(p)])) } });
        return row.id;
      });
      return res.json({ ok: true, id });
    }

    if (b.action === 'bankcheck') {
      if (!(has(u, 'receipt.approve') || has(u, 'accounts.enter'))) throw fail(403, 'Your role does not allow this.');
      return res.json({ ok: true, ...(await require('../lib/cheque-match').run({ user: u, trigger: 'manual' })) });
    }
    const r = await db.one('select * from receipts where id = $1', [intOr(b.id)]);
    if (!r) throw fail(404, 'Receipt not found.');
    needProject(u, r.project_id);
    if (b.action === 'handed' || b.action === 'deposited') {
      if (b.action === 'handed') need('receipt.enter'); else if (!(has(u, 'accounts.enter') || has(u, 'receipt.approve'))) throw fail(403, 'Only Accounts marks a cheque deposited.');
      if (r.mode !== 'cheque') throw fail(400, 'This receipt is not a cheque.');
      if (r.bank_status) throw fail(409, 'This cheque is already on the bank statement.');
      const on = /^\d{4}-\d{2}-\d{2}$/.test(b.on || '') ? b.on : today();
      if (on > today() || on < String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10)) throw fail(400, 'The date must be between the day the cheque was received and today.');
      if (b.action === 'handed') await db.q('update receipts set handed_on = $2, handed_by = $3 where id = $1', [r.id, on, u.id]);
      else await db.q('update receipts set deposited_on = $2, deposited_by = $3, handed_on = coalesce(handed_on, $2) where id = $1', [r.id, on, u.id]);
      await audit.record(db.q, { user: u, action: b.action, entity: 'receipt', entityId: r.id, projectId: r.project_id, after: { on } });
      return res.json({ ok: true });
    }
    need('receipt.approve');

    if (b.action === 'approve' || b.action === 'reject') {
      if (r.status !== 'pending') throw fail(409, 'This receipt is not waiting for approval.');
      notOwn(u, r.created_by);
      const status = b.action === 'approve' ? 'approved' : 'rejected';
      await db.tx(async (t) => {
        await t.q('update receipts set status = $2, approved_by = $3, approved_at = now(), reverse_reason = $4 where id = $1', [r.id, status, u.id, b.action === 'reject' ? str(b.reason, 300) || null : null]);
        await audit.record(t.q, { user: u, action: b.action, entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: r.status }, after: { status }, note: str(b.reason, 300) || null });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'bounce' || b.action === 'reverse') {
      if (r.status !== 'approved') throw fail(409, 'Only an approved receipt can be marked bounced or reversed.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Give the reason.');
      const status = b.action === 'bounce' ? 'bounced' : 'reversed';
      await db.tx(async (t) => {
        await t.q('update receipts set status = $2, reverse_reason = $3 where id = $1', [r.id, status, reason]);
        await audit.record(t.q, { user: u, action: b.action, entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: r.status }, after: { status }, note: reason });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
