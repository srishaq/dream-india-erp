// Open queries: every outstanding correction across the CRM and Accounts, in one list for the CRM/Accounts Audit tab.
// Each section says who fixes it and where. Nothing here changes data; items drop off as they are corrected.
const db = require('./db');
const acc = require('./accounts');
const bvc = require('./books-vs-crm');

const BOOK = acc.BOOK;
const n = (v) => Number(v) || 0;
const r0 = (x) => Math.round(n(x));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

async function build(projectId) {
  const S = [];
  const add = (s) => { s.count = s.rows.length; s.amount = r0(s.rows.reduce((a, r) => a + Math.abs(n(r.amount)), 0)); S.push(s); };

  // 1. CRM: items the CRM import flagged
  const iss = await db.q(`select i.id, i.unit_no, i.kind, i.severity, i.detail from import_issues i
    where i.project_id = $1 and i.status = 'open' and i.kind not in ('no-email', 'no-mobile', 'bad-pan') order by (i.severity = 'money') desc, i.unit_no nulls first, i.id`, [projectId]);
  add({ key: 'verify', team: 'CRM', title: 'Data to verify (from the CRM import)', where: '#/verify', fix: 'Check against the booking file and close each item with what was corrected.',
    rows: iss.map((r) => ({ unit: r.unit_no || '', item: r.kind + (r.severity === 'money' ? ' (money)' : ''), detail: r.detail || '' })) });

  // 2. CRM: buyer details missing (PAN, email, mobile), one line per flat
  const det = await db.q(`select u.unit_no, string_agg(distinct y.name, ', ') as buyer,
      bool_and(coalesce(trim(y.pan), '') = '') as no_pan, bool_or(coalesce(y.pan, '') <> '' and y.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$') as bad_pan,
      not bool_or(y.email like '%@%') as no_email, max(case when a.seq = 1 then y.phone end) as phone
    from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
   where u.project_id = $1 and b.status = 'active' group by u.unit_no, b.id order by u.unit_no`, [projectId]);
  const miss = det.map((r) => ({ r, m: [r.no_pan && 'PAN', r.bad_pan && 'PAN looks wrong', r.no_email && 'email', !/^[6-9]\d{9}$/.test(String(r.phone || '').replace(/\D/g, '').slice(-10)) && 'mobile'].filter(Boolean) })).filter((x) => x.m.length);
  add({ key: 'kyc', team: 'CRM', title: 'Buyer details missing', where: '#/flats', fix: 'One line per flat: fill what is missing on the booking (PAN is needed for TDS and the agreement; email and mobile for letters and WhatsApp).',
    rows: miss.map(({ r, m }) => ({ unit: r.unit_no, item: 'Missing: ' + m.join(', '), detail: r.buyer || '' })) });

  // 3. CRM pending receipts (cheques and transfers wait for the bank statement)
  const pend = await db.q(`select u.unit_no, r.received_on, r.amount, r.mode, r.instrument_no, r.created_at from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id
     where r.project_id = $1 and r.status = 'pending' order by r.received_on, r.id`, [projectId]);
  add({ key: 'pending', team: 'CRM', title: 'Receipts waiting for approval', where: '#/receipts', fix: 'Cheques and transfers approve themselves when the bank statement shows them; check any older than 3 days.',
    rows: pend.map((r) => ({ unit: r.unit_no, date: iso(r.received_on), item: (r.mode || '') + (r.instrument_no ? ' ' + r.instrument_no : ''), detail: '', amount: n(r.amount) })) });

  // 4. Tally vs CRM, flat by flat
  let tv = { rows: [] };
  try { tv = await bvc.summary(projectId); } catch (e) { tv = { rows: [], error: e.message }; }
  add({ key: 'bookscrm', team: 'CRM + Accounts', title: 'Tally and the CRM do not agree (flat by flat)', where: '#/bookscrm', fix: 'Open the flat in Tally vs CRM: each receipt is paired, the unpaired ones are the correction.',
    rows: tv.rows.filter((r) => !['Agrees', 'Nothing received'].includes(r.state))
      .map((r) => ({ unit: r.unit, item: r.state, detail: `${r.buyer || ''} · Tally ₹${r.books.toLocaleString('en-IN')} vs CRM ₹${r.crm.toLocaleString('en-IN')}`, amount: r.diff })) });

  // 5. Accounts: bank statement against the books (the latest comparison)
  const cmp = await db.one("select id, run_at, differences from acc_stmt_runs where book = $1 and ok and trigger = 'compare' order by run_at desc limit 1", [BOOK]);
  add({ key: 'bank', team: 'Accounts', title: 'Bank statement and the books differ', where: cmp ? '#/bankauto/' + cmp.id : '#/bankauto', fix: 'Enter what is missing, correct the bank or date, or mark it a reconciling item.',
    asOf: cmp ? cmp.run_at : null,
    rows: (cmp ? cmp.differences || [] : []).map((d) => ({ bank: d.bank || '', date: d.date || '', item: d.what || '', detail: [d.description, d.where, d.todo].filter(Boolean).join(' · '), amount: n(d.amount) })) });

  // 6. Accounts: customer receipts with no flat
  const nounit = await db.q(`select ref_id, txn_date, bank, amount, payer_name, payment_head from acc_receipts where book = $1 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = '' and ${acc.RECEIVED_SQL} order by txn_date`, [BOOK]);
  add({ key: 'nounit', team: 'Accounts', title: 'Customer receipts with no flat', where: '#/reg-receipts', fix: 'Put the flat number on the receipt (in Tally the flat ledger).',
    rows: nounit.map((r) => ({ ref: r.ref_id, date: iso(r.txn_date), bank: r.bank || '', item: r.payment_head, detail: r.payer_name || '', amount: n(r.amount) })) });

  // 7. Accounts: TDS entries (from the portal) with no flat
  const tds = await db.q("select ref_id, paid_on, customer, tds_amount, challan_no from acc_tds_entries where book = $1 and coalesce(unit_no, '') = '' order by paid_on", [BOOK]);
  add({ key: 'tds', team: 'Accounts', title: 'TDS entries with no flat', where: '#/reg-tds', fix: 'The PAN on the TDS portal is not on any booking: find the flat and put it on the entry (and the PAN on the booking).',
    rows: tds.map((r) => ({ ref: r.ref_id, date: iso(r.paid_on), item: 'Flat missing', detail: [r.customer, r.challan_no && 'challan ' + r.challan_no].filter(Boolean).join(' · '), amount: n(r.tds_amount) })) });

  // 8. Accounts: the standing checks that fail
  const ck = (await acc.checks(projectId).catch(() => [])).filter((c) => c.result === 'Check');
  add({ key: 'checks', team: 'Accounts', title: 'Accounts checks that need attention', where: '#/checks', fix: 'Each check says what is wrong.',
    rows: ck.map((c) => ({ item: c.check, detail: c.means || '', amount: null, figure: c.figure })) });

  return { sections: S, total: S.reduce((a, s) => a + s.count, 0), at: new Date().toISOString() };
}

function sheets(out) {
  const sum = [['Team', 'Query', 'Open', 'Amount (₹)', 'How to fix']].concat(out.sections.map((s) => [s.team, s.title, s.count, s.amount, s.fix]));
  const list = [['Team', 'Query', 'Flat', 'Bank', 'Date', 'Ref', 'Item', 'Detail', 'Amount (₹)', 'Done (tick)', 'Note']];
  for (const s of out.sections) for (const r of s.rows) list.push([s.team, s.title, r.unit || '', r.bank || '', r.date || '', r.ref || '', r.item || '', r.detail || '', r.amount == null ? '' : r0(r.amount), '', '']);
  return [{ name: 'Summary', rows: sum, widths: [14, 46, 8, 14, 80] }, { name: 'All queries', rows: list, widths: [14, 40, 9, 22, 11, 11, 34, 80, 14, 10, 30] }];
}

module.exports = { build, sheets };
