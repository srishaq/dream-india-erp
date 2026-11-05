// Buyer receipts. GET ?project=ID[&status=pending]. POST {action}: create, approve, reject, bounce, reverse,
// handed (CRM gave the cheque to Accounts), received (Accounts has it), deposited (one cheque, or ids[] at once with the
// bank account), bankcheck (look for the cheques in the bank now). GET ?todeposit=1 → the count for the top bar.
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

const { issueNo, receiptFigures, sendReceipt } = require('../lib/receipt-mail');
const { ONE_CHEQUE_FROM } = require('../lib/one-cheque');
const fmtCut = () => new Date(ONE_CHEQUE_FROM + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function list(projectId, status) {
  return db.q(
    `select r.id, r.received_on, r.amount, r.mode, r.bank, r.instrument_no, r.status, r.note, r.reverse_reason, r.opening, r.created_by, r.booking_id,
            u.unit_no, c.name as created_by_name, a.name as approved_by_name, r.approved_at, r.approved_note, r.receipt_no, r.receipt_sent_at,
            r.handed_on, r.deposited_on, r.bank_status, r.bank_on, r.bank_ref, r.bank_match, h.name as handed_by_name, dp.name as deposited_by_name, r.acc_received_at, ar.name as acc_received_by_name, r.deposit_bank,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = r.booking_id) as buyers,
            coalesce((select json_object_agg(s.head, s.amount) from receipt_splits s where s.receipt_id = r.id), '{}') as splits
       from receipts r left join bookings b on b.id = r.booking_id left join units u on u.id = b.unit_id
       left join users c on c.id = r.created_by left join users a on a.id = r.approved_by
       left join users h on h.id = r.handed_by left join users dp on dp.id = r.deposited_by left join users ar on ar.id = r.acc_received_by
      where r.project_id = $1 and ($2::text is null or r.status = $2)
      order by (r.status = 'pending') desc, r.received_on desc, r.id desc limit 1000`, [projectId, status]);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!['receipt.enter', 'receipt.approve', 'ledger.view'].some((p) => has(u, p))) return res.status(403).json({ error: 'Your role does not allow this.' });
    if (req.query.todeposit) {
      const c = await db.one(`select count(*)::int as n, coalesce(sum(r.amount), 0) as amt from receipts r join bookings b on b.id = r.booking_id
        where r.mode = 'cheque' and not r.opening and not b.sample and r.status in ('pending', 'approved') and r.bank_status is null and r.deposited_on is null and r.project_id = any($1)`, [u.projects]);
      return res.json(c);
    }
    if (req.query.banks) return res.json({ banks: await db.q("select name from acc_banks where active order by name") });
    if (req.query.pdf) {
      const f = await receiptFigures(u, intOr(req.query.pdf));
      const buf = require('../lib/demand-letter').buildReceipt(f.doc);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Receipt_${f.doc.receiptNo.replace(/[^A-Za-z0-9-]+/g, '_')}_${f.doc.unit}.pdf"`);
      return res.end(buf);
    }
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
      // Rules agreed in the 4 Nov meeting:
      //  - one cheque pays one flat: a cheque dated from ONE_CHEQUE_FROM (go-live) that is already entered on another flat is refused
      //    (separate cheques per flat). Older cheques were sometimes written for two or three flats: those may still be split, with a confirm;
      //  - the same cheque / UTR with the same date and amount on the same flat is a double entry and is refused.
      if (instrument) {
        const norm = "upper(regexp_replace(r.instrument_no, '\\s', '', 'g')) = upper(regexp_replace($2, '\\s', '', 'g'))";
        const twin = await db.one(`select r.id, u.unit_no from receipts r join bookings bb on bb.id = r.booking_id join units u on u.id = bb.unit_id
            where r.booking_id = $1 and ${norm} and r.received_on = $3 and r.amount = $4 and r.status not in ('rejected', 'reversed') limit 1`, [bk.id, instrument, on, rupees(amount)]);
        if (twin) throw Object.assign(fail(409, `This receipt is already entered: ${twin.unit_no}, ${mode === 'cheque' ? 'cheque' : 'UTR'} ${instrument}, same date and amount. It cannot be entered twice.`), { duplicate: twin.id, blocked: true });
        if (mode === 'cheque' && on >= ONE_CHEQUE_FROM) {
          const other = await db.one(`select r.id, u.unit_no from receipts r join bookings bb on bb.id = r.booking_id join units u on u.id = bb.unit_id
              where r.project_id = $1 and r.booking_id <> $3 and r.mode = 'cheque' and ${norm} and r.status not in ('rejected', 'reversed', 'bounced') limit 1`, [bk.project_id, instrument, bk.id]);
          if (other) throw Object.assign(fail(409, `Cheque ${instrument} is already entered on ${other.unit_no}. One cheque can pay only one flat: ask the buyer for a separate cheque for each flat.`), { duplicate: other.id, blocked: true });
        }
      }
      // the same UTR / cheque number already entered elsewhere (another flat's transfer, or the same flat on another date): ask before saving it again
      if (instrument && !b.allowDuplicate) {
        const dup = await db.one(`select r.id, r.amount, r.received_on, u.unit_no from receipts r join bookings bb on bb.id = r.booking_id join units u on u.id = bb.unit_id
            where r.project_id = $1 and upper(regexp_replace(r.instrument_no, '\\s', '', 'g')) = upper(regexp_replace($2, '\\s', '', 'g')) and r.status not in ('rejected') limit 1`, [bk.project_id, instrument]);
        if (dup) throw Object.assign(fail(409, mode === 'cheque'
          ? `Cheque ${instrument} is already entered on ${dup.unit_no} (₹${Number(dup.amount).toLocaleString('en-IN')}). Cheques dated before ${fmtCut()} may pay more than one flat: if this cheque was split across flats, save it and confirm. The bank statement is then matched on the total of the parts.`
          : `UTR / cheque ${instrument} is already entered: ${dup.unit_no}, ₹${Number(dup.amount).toLocaleString('en-IN')}. If it really is one payment split across flats, save it again and confirm.`), { duplicate: dup.id });
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
      // a cheque: Accounts is told straight away, in Dream Chat (with the chime) and on the top bar count
      if (mode === 'cheque') await require('../lib/team').system('accounts', `Cheque to deposit: ${bk.unit_no}, ₹${Math.round(rupees(amount)).toLocaleString('en-IN')}${instrument ? ', cheque ' + instrument : ''}${b.bank ? ' (' + str(b.bank, 80) + ')' : ''}, received ${on}, entered by ${u.name}. Mark it Received when you have it, and Deposited when it goes to the bank.`, { bookingId: bk.id, receiptId: id, needsAction: true });
      // the buyer gets the provisional receipt ("subject to clearance") straight away
      const mail = await require('../lib/receipt-mail').autoSend(id, 'provisional', u);
      return res.json({ ok: true, id, mail });
    }

    // Email the payment receipt (PDF attached) to the buyer; until the ERP is live, to the test address only.
    if (b.action === 'receipt-email') {
      if (!(has(u, 'receipt.enter') || has(u, 'receipt.approve') || has(u, 'demand.raise'))) throw fail(403, 'Your role does not allow this.');
      return res.json({ ok: true, ...(await sendReceipt(intOr(b.id), { user: u })) });
    }
    if (b.action === 'bankcheck') {
      if (!(has(u, 'receipt.approve') || has(u, 'accounts.enter'))) throw fail(403, 'Your role does not allow this.');
      return res.json({ ok: true, ...(await require('../lib/cheque-match').run({ user: u, trigger: 'manual' })) });
    }
    // Several cheques deposited together (one paying-in slip), into one bank account.
    if (b.action === 'deposited' && Array.isArray(b.ids)) {
      if (!(has(u, 'accounts.enter') || has(u, 'receipt.approve'))) throw fail(403, 'Only Accounts marks a cheque deposited.');
      const ids = b.ids.map((x) => intOr(x)).filter(Boolean).slice(0, 300); if (!ids.length) throw fail(400, 'Tick the cheques deposited.');
      const on = /^\d{4}-\d{2}-\d{2}$/.test(b.on || '') ? b.on : today(); if (on > today()) throw fail(400, 'The date cannot be in the future.');
      const bank = str(b.bank, 80) || null;
      const rows = await db.q(`update receipts set deposited_on = $2, deposited_by = $3, deposit_bank = coalesce($4, deposit_bank), handed_on = coalesce(handed_on, $2),
          acc_received_at = coalesce(acc_received_at, now()), acc_received_by = coalesce(acc_received_by, $3)
        where id = any($1) and project_id = any($5) and mode = 'cheque' and bank_status is null and deposited_on is null and received_on <= $2 returning id, project_id`, [ids, on, u.id, bank, u.projects]);
      for (const x of rows) await audit.record(db.q, { user: u, action: 'deposited', entity: 'receipt', entityId: x.id, projectId: x.project_id, after: { on, bank } });
      await db.q("update team_messages set done_at = now(), done_by = $2 where receipt_id = any($1) and kind = 'system' and done_at is null and body like 'Cheque to deposit%'", [rows.map((x) => x.id), u.id]);
      return res.json({ ok: true, count: rows.length, skipped: ids.length - rows.length });
    }
    const r = await db.one('select * from receipts where id = $1', [intOr(b.id)]);
    if (!r) throw fail(404, 'Receipt not found.');
    needProject(u, r.project_id);
    if (b.action === 'received') {
      if (!(has(u, 'accounts.enter') || has(u, 'receipt.approve'))) throw fail(403, 'Only Accounts confirms a cheque received.');
      if (r.mode !== 'cheque' || r.acc_received_at) throw fail(409, r.acc_received_at ? 'Already marked received.' : 'This receipt is not a cheque.');
      await db.q('update receipts set acc_received_at = now(), acc_received_by = $2, handed_on = coalesce(handed_on, $3) where id = $1', [r.id, u.id, today()]);
      await audit.record(db.q, { user: u, action: 'received', entity: 'receipt', entityId: r.id, projectId: r.project_id });
      return res.json({ ok: true });
    }
    if (b.action === 'handed' || b.action === 'deposited') {
      if (b.action === 'handed') need('receipt.enter'); else if (!(has(u, 'accounts.enter') || has(u, 'receipt.approve'))) throw fail(403, 'Only Accounts marks a cheque deposited.');
      if (r.mode !== 'cheque') throw fail(400, 'This receipt is not a cheque.');
      if (r.bank_status) throw fail(409, 'This cheque is already on the bank statement.');
      const on = /^\d{4}-\d{2}-\d{2}$/.test(b.on || '') ? b.on : today();
      if (on > today() || on < String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10)) throw fail(400, 'The date must be between the day the cheque was received and today.');
      if (b.action === 'handed') await db.q('update receipts set handed_on = $2, handed_by = $3 where id = $1', [r.id, on, u.id]);
      else {
        await db.q('update receipts set deposited_on = $2, deposited_by = $3, handed_on = coalesce(handed_on, $2), deposit_bank = coalesce($4, deposit_bank), acc_received_at = coalesce(acc_received_at, now()), acc_received_by = coalesce(acc_received_by, $3) where id = $1', [r.id, on, u.id, str(b.bank, 80) || null]);
        await db.q("update team_messages set done_at = now(), done_by = $2 where receipt_id = $1 and kind = 'system' and done_at is null and body like 'Cheque to deposit%'", [r.id, u.id]);
      }
      await audit.record(db.q, { user: u, action: b.action, entity: 'receipt', entityId: r.id, projectId: r.project_id, after: { on } });
      return res.json({ ok: true });
    }
    need('receipt.approve');

    if (b.action === 'approve' || b.action === 'reject') {
      if (r.status !== 'pending') throw fail(409, 'This receipt is not waiting for approval.');
      notOwn(u, r.created_by);
      const status = b.action === 'approve' ? 'approved' : 'rejected';
      // Decided 5 Nov 2026: cheques and transfers are approved by the bank statement (12 noon and 7 pm runs). Head Accounts
      // approves one by hand only once the statement shows it (a match on flat and amount, which needs a person to confirm),
      // and receipts that never pass through the bank (TDS, other).
      // A receipt dated before the statements are checked from (a missing old one entered while correcting the CRM) can never
      // appear on a run, so Head Accounts approves it by hand against Tally.
      const stStart = await require('../lib/bank-auto').setting('statement_start', '2026-10-01');
      const oldOne = String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10) < String(stStart).replace(/"/g, '').slice(0, 10);
      if (status === 'approved' && ['cheque', 'bank'].includes(r.mode) && !r.bank_acc_id && !r.opening && !oldOne)
        throw fail(409, 'Cheques and transfers are approved by the bank statement (12 noon and 7 pm). This one is not on the statement yet, so it cannot be approved by hand.');
      if (status === 'approved') { const st = await db.one('select status from bookings where id = $1', [r.booking_id]); if (!st || !['active', 'pending'].includes(st.status)) throw fail(409, `This flat's booking is ${st ? st.status : 'gone'}: the receipt cannot be approved on it. Reject it, or record it against the refund in Accounts.`); }
      await db.tx(async (t) => {
        const done = await t.one("update receipts set status = $2, approved_by = $3, approved_at = now(), reverse_reason = $4 where id = $1 and status = 'pending' returning id", [r.id, status, u.id, b.action === 'reject' ? str(b.reason, 300) || null : null]);
        if (!done) throw fail(409, 'Someone else has just dealt with this receipt. Refresh the page.');
        await audit.record(t.q, { user: u, action: b.action, entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: r.status }, after: { status }, note: str(b.reason, 300) || null });
      });
      // the buyer gets a WhatsApp thank-you once the payment is approved (payment_received template)
      let whatsapp = null;
      if (status === 'approved' && !r.opening) {
        const L = require('../lib/letters');
        const k = await db.one(`select u.unit_no, (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as names
            from bookings b join units u on u.id = b.unit_id where b.id = $1`, [r.booking_id]).catch(() => null);
        if (k) whatsapp = await L.waNotice({ bookingId: r.booking_id, kind: 'received', userId: u.id, params: [k.names, L.rs(r.amount), k.unit_no, L.dmy(r.received_on)] }).catch((e) => ({ error: e.message }));
      }
      // the final receipt, with its number, by email
      const mail = status === 'approved' && !r.opening ? await require('../lib/receipt-mail').autoSend(r.id, 'final', u) : null;
      return res.json({ ok: true, whatsapp, mail });
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
    // a cheque marked bounced by mistake (or matched to the wrong return): back to approved, with the reason on record
    if (b.action === 'unbounce') {
      if (r.status !== 'bounced') throw fail(409, 'This receipt is not marked bounced.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Say why the cheque did not bounce.');
      await db.tx(async (t) => {
        // kept by hand: the bank check no longer links or bounces this receipt on its own
        await t.q("update receipts set status = 'approved', reverse_reason = null, bank_status = 'cleared', bank_acc_id = null, bank_match = 'kept by hand' where id = $1", [r.id]);
        await audit.record(t.q, { user: u, action: 'unbounce', entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: 'bounced', reason: r.reverse_reason }, after: { status: 'approved' }, note: reason });
      });
      return res.json({ ok: true });
    }
    // the split of an approved receipt corrected (e.g. part of it was GST): same receipt and number, old and new split kept
    if (b.action === 'resplit') {
      if (r.status !== 'approved') throw fail(409, 'Only an approved receipt can be corrected this way.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Give the reason for the correction.');
      const amount = toPaise(r.amount); const splits = {}; let sum = 0;
      for (const h of HEADS) { const v = b.splits && b.splits[h]; if (v === undefined || v === null || v === '') continue; const p = toPaise(v); if (!(p >= 0)) throw fail(400, `The ${h.replace('_', ' ')} part looks wrong.`); if (p > 0) { splits[h] = p; sum += p; } }
      if (sum !== amount) throw fail(400, `The parts add up to ₹${rupees(sum)}, but the receipt is ₹${rupees(amount)}. They must match.`);
      const before = await db.q('select head, amount from receipt_splits where receipt_id = $1', [r.id]);
      await db.tx(async (t) => {
        await t.q('delete from receipt_splits where receipt_id = $1', [r.id]);
        for (const [h, p] of Object.entries(splits)) await t.q('insert into receipt_splits (receipt_id, head, amount) values ($1, $2, $3)', [r.id, h, rupees(p)]);
        await audit.record(t.q, { user: u, action: 'resplit', entity: 'receipt', entityId: r.id, projectId: r.project_id, before: Object.fromEntries(before.map((x) => [x.head, Number(x.amount)])), after: Object.fromEntries(Object.entries(splits).map(([h, p]) => [h, rupees(p)])), note: reason });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
