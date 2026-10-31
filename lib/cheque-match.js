// Cheques and transfers the CRM enters, followed to the bank by themselves.
//
//   CRM enters the receipt (cheque no., bank, amount, split)  →  "With CRM"
//   CRM gives the cheque to Accounts (optional click)          →  "With Accounts"
//   Accounts deposits it (optional click)                      →  "Deposited"
//   The bank statement shows it (Bank Auto Check, 3:10 pm)     →  "In the bank": the CRM receipt is linked to the
//       bank line. When the cheque number and amount both match, the receipt is approved by the bank statement
//       itself (it then counts in the buyer's ledger); a match on flat and amount alone waits for Head Accounts.
//   The cheque comes back (a return on the statement)          →  "Returned": the receipt is marked bounced, it drops
//       out of the buyer's ledger, and the CRM of that flat gets it on their Daily To-Do.
//   Cleared cheques are told to the flat's CRM the same way (Daily To-Do and a message tagged to the flat).
//
// Runs after every bank statement check, every Tally reload and at 9 am; it can also be run from the Receipts page.
// The bank side is the Accounts Receipts register (acc_receipts), which the statement check fills line by line.
const db = require('./db');
const audit = require('./audit');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const dayDiff = (a, b) => Math.round((Date.parse(iso(a)) - Date.parse(iso(b))) / 864e5);
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const istDate = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmtD = (d) => { const [y, m, dd] = iso(d).split('-'); return `${dd}-${m}-${y}`; };

async function settings() { return { autoApprove: true, ...((await db.one("select value from settings where key = 'receipts'"))?.value || {}) }; }

// Does this bank line carry the cheque / UTR number? (the reference column, or the narration for banks that put it there)
function refMatch(no, line) {
  if (no.length < 4) return false;
  const ref = digits(line.reference);
  if (ref && (ref === no || (no.length >= 6 && (ref.endsWith(no) || (no.endsWith(ref) && ref.length >= 6))))) return true;
  return new RegExp(`(^|\\D)0*${no}(\\D|$)`).test(String(line.description || ''));
}

async function run({ user = null, trigger = 'auto' } = {}) {
  const out = { trigger, linked: 0, approved: 0, waiting: 0, bounced: 0, relinked: 0 };
  const done = { approved: [], waiting: [] };
  const cfg = await settings();
  const recs = await db.q(`select r.id, r.booking_id, r.project_id, r.received_on, r.amount, r.mode, r.instrument_no, r.status, r.bank_status, r.bank_acc_id, r.created_by,
      u.unit_no, coalesce((select s.amount from receipt_splits s where s.receipt_id = r.id and s.head = 'tds'), 0) as tds,
      (select count(*)::int from receipt_splits s where s.receipt_id = r.id) as n_splits
    from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id
    where r.mode in ('cheque', 'bank') and not r.opening and r.created_by is not null and not b.sample and (r.status in ('pending', 'approved') or (r.status = 'bounced' and r.bank_status = 'returned'))
      and r.received_on >= current_date - 400 order by r.received_on, r.id`);
  if (!recs.length) return out;
  const from = recs.reduce((a, r) => (iso(r.received_on) < a ? iso(r.received_on) : a), '9999');
  const lines = await db.q(`select id, ref_id, txn_date, bank, description, reference, amount, unit_no, cheque_status from acc_receipts
    where book = $1 and txn_date >= $2::date - 5 and coalesce(cheque_status, '') <> 'Not found on statement' order by txn_date, id`, [BOOK, from]);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const used = new Set();
  // Links that still stand (a Tally reload renumbers the register: those are found again below).
  for (const r of recs) if (r.bank_acc_id && byId.has(r.bank_acc_id)) used.add(r.bank_acc_id); else if (r.bank_acc_id) { r.bank_acc_id = null; r.relink = true; }

  for (const r of recs) {
    let line = r.bank_acc_id ? byId.get(r.bank_acc_id) : null, how = null;
    if (!line) {
      const want = Math.round((n(r.amount) - n(r.tds)) * 100) / 100;
      if (want <= 0) continue; // TDS only: never comes through the bank
      const no = digits(r.instrument_no);
      const near = lines.filter((l) => !used.has(l.id) && Math.abs(n(l.amount) - want) < 1 && dayDiff(l.txn_date, r.received_on) >= -3 && dayDiff(l.txn_date, r.received_on) <= 45);
      line = near.find((l) => refMatch(no, l)); how = line ? 'cheque no. and amount' : null;
      if (!line) {
        const flat = near.filter((l) => l.unit_no && l.unit_no === r.unit_no);
        if (flat.length === 1) { line = flat[0]; how = 'flat and amount'; }
      }
      if (!line) continue;
      used.add(line.id);
      await db.q('update receipts set bank_acc_id = $2, bank_ref = $3, bank_on = $4, bank_match = $5, bank_status = coalesce(bank_status, $6) where id = $1',
        [r.id, line.id, line.ref_id, line.txn_date, how, line.cheque_status === 'Bounced' ? 'returned' : 'cleared']);
      if (r.relink) { out.relinked++; } else {
        out.linked++;
        await audit.record(db.q, { user, action: 'bank-linked', entity: 'receipt', entityId: r.id, projectId: r.project_id, after: { unit: r.unit_no, bank: line.bank, line: line.ref_id, date: iso(line.txn_date), matchedBy: how } });
      }
      r.bank_status = r.bank_status || (line.cheque_status === 'Bounced' ? 'returned' : 'cleared'); r.bank_match = how;
      // cleared: the flat's CRM is told, the same way as for a returned cheque
      if (!r.relink && line.cheque_status !== 'Bounced') {
        const what = `Cheque cleared on ${r.unit_no}: ₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ', cheque ' + r.instrument_no : ''}, in ${line.bank || 'the bank'} on ${fmtD(line.txn_date)}`;
        const note = how === 'cheque no. and amount' && r.status === 'pending' && cfg.autoApprove && r.n_splits > 0 ? 'Approved by the bank statement: it now counts in the buyer\'s ledger.' : r.status === 'approved' ? 'It was already approved.' : 'Head Accounts approves it on the Receipts page (matched on flat and amount).';
        await tell(r, `clear-${r.id}`, what, `${note} You can let the buyer know and send the receipt.`, 'normal');
        await require('./team').system('crm', `${what}. ${note}`, { bookingId: r.booking_id, receiptId: r.id });
      }
    } else how = null;

    // returned
    if (line.cheque_status === 'Bounced' && r.status !== 'bounced') {
      const reason = `Cheque returned: bank statement ${fmtD(line.txn_date)} (${line.ref_id || 'bank line'})`;
      await db.q("update receipts set status = 'bounced', bank_status = 'returned', reverse_reason = $2 where id = $1", [r.id, reason]);
      await audit.record(db.q, { user, action: 'bounce', entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: r.status }, after: { status: 'bounced', by: 'bank statement' }, note: reason });
      await tell(r, `bounce-${r.id}`, `Cheque returned on ${r.unit_no}: ₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ', cheque ' + r.instrument_no : ''}`,
        `${reason}. It has been taken out of the buyer's ledger. Call the buyer for a fresh payment and the bank charges.`, 'high');
      await require('./team').system('crm', `Cheque returned on ${r.unit_no}: ₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ', cheque ' + r.instrument_no : ''}. ${reason}. It is out of the buyer's ledger; please call the buyer for a fresh payment.`, { bookingId: r.booking_id, receiptId: r.id, needsAction: true });
      await require('./chat').system('dept:accounts', '', { title: `Cheque returned: ${r.unit_no}`, tone: 'bad', lines: [`₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ', cheque ' + r.instrument_no : ''}`, reason, 'Taken out of the buyer\'s ledger. CRM has been told to call the buyer.'] });
      out.bounced++; continue;
    }
    if (line.cheque_status !== 'Bounced' && r.bank_status !== 'cleared' && r.status !== 'bounced') await db.q("update receipts set bank_status = 'cleared' where id = $1", [r.id]);
    // in the bank: approve when the cheque number matched (not the person who entered it approving their own)
    if (r.status === 'pending') {
      const strong = (how || (await db.one('select bank_match from receipts where id = $1', [r.id])).bank_match) === 'cheque no. and amount';
      if (cfg.autoApprove && strong && r.n_splits > 0) {
        await db.q("update receipts set status = 'approved', approved_by = null, approved_at = now(), approved_note = 'Approved by the bank statement' where id = $1 and status = 'pending'", [r.id]);
        await audit.record(db.q, { user, action: 'approve', entity: 'receipt', entityId: r.id, projectId: r.project_id, before: { status: 'pending' }, after: { status: 'approved', by: 'bank statement', line: line.ref_id } });
        out.approved++; done.approved.push(r);
      } else { out.waiting++; if (how && !r.relink) done.waiting.push(r); }
    }
  }
  const lst = (a) => a.slice(0, 15).map((r) => `${r.unit_no} ₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ' (' + r.instrument_no + ')' : ''}`).join(', ') + (a.length > 15 ? ` and ${a.length - 15} more` : '');
  if (done.waiting.length) await require('./team').system('accounts', `In the bank, waiting for Head Accounts to approve on the Receipts page (matched on flat and amount, or the split is missing): ${lst(done.waiting)}.`, { needsAction: true });
  return out;
}

// The CRM of that flat (or the wing team, or Head CRM) gets it on their own Daily To-Do.
async function tell(r, key, title, detail, priority) {
  try {
    const w = await require('./comms-notify').whoFor(r.booking_id);
    for (const p of w.people) {
      await db.q("insert into daily_tasks (dept, task_date, source, key, title, detail, link, priority, since, assigned_to) values ('crm', $1, 'own', $2, $3, $4, $5, $6, $1, $7) on conflict do nothing",
        [istDate(), `${key}-${p.id}`, title.slice(0, 200), detail, `#/booking/${r.booking_id}`, priority, p.id]);
    }
  } catch (e) { console.error('cheque-match tell', e.message); }
}

// Where each cheque is (for the Receipts page).
function stage(r) {
  if (r.bank_status === 'returned') return 'returned';
  if (r.bank_status === 'cleared') return 'bank';
  if (r.deposited_on) return 'deposited';
  if (r.handed_on) return 'accounts';
  return 'crm';
}

// For the 9 am Accounts list.
async function findings(today) {
  const out = [];
  const old = await db.q(`select r.id, r.received_on, r.amount, r.instrument_no, r.handed_on, r.deposited_on, u.unit_no from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id
    where r.mode = 'cheque' and not r.opening and r.created_by is not null and not b.sample and r.status in ('pending', 'approved') and r.bank_status is null and r.received_on >= current_date - 120 order by r.received_on`);
  const notDep = old.filter((r) => !r.deposited_on && dayDiff(today, r.received_on) >= 2);
  const toDep = old.filter((r) => !r.deposited_on && dayDiff(today, r.received_on) === 1);
  const notSeen = old.filter((r) => r.deposited_on && dayDiff(today, r.deposited_on) >= 3);
  const list = (a) => a.slice(0, 6).map((r) => `${r.unit_no} ₹${Math.round(n(r.amount)).toLocaleString('en-IN')}${r.instrument_no ? ' chq ' + r.instrument_no : ''} (${fmtD(r.received_on)})`).join('; ') + (a.length > 6 ? `; and ${a.length - 6} more` : '');
  const sum = (a) => '₹' + Math.round(a.reduce((s, r) => s + n(r.amount), 0)).toLocaleString('en-IN');
  if (notDep.length) out.push({ key: 'cheques-not-banked', title: `Cheques received 2+ days ago and not yet in the bank: ${notDep.length} (${sum(notDep)})`, detail: `Deposit them and mark them Deposited on the Receipts page. ${list(notDep)}`, count: notDep.length, link: '#/receipts', priority: 'high' });
  if (toDep.length) out.push({ key: 'cheques-to-deposit', title: `Cheques received yesterday, to deposit today: ${toDep.length} (${sum(toDep)})`, detail: `On Receipts → Cheques not in the bank yet, tick them and click Deposited today. ${list(toDep)}`, count: toDep.length, link: '#/receipts?t=cheques', priority: 'normal' });
  if (notSeen.length) out.push({ key: 'cheques-not-on-statement', title: `Cheques deposited 3+ days ago but not on the bank statement: ${notSeen.length} (${sum(notSeen)})`, detail: `Check with the bank, and that the latest statement has been uploaded. ${list(notSeen)}`, count: notSeen.length, link: '#/receipts', priority: 'high' });
  return out;
}

module.exports = { run, stage, findings, settings, refMatch, digits };
