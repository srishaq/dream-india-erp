// Reports tab: the reports that are not on another page yet. Each report takes the same filters (from, to, wing, status,
// set where they apply) and returns { cols, rows, note }: a column is { k, l, t } with t = 'm' money, 'n' number, 'd' date,
// '' text; a row may carry _href (tap to open the flat or ledger). The Reports page and the Excel export both use this.
const db = require('./db');
const acc = require('./accounts');

const BOOK = acc.BOOK;
const n = (v) => Math.round(Number(v) || 0);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '');
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const ym = (d) => iso(d).slice(0, 7);
const mlab = (m) => { const [y, mo] = m.split('-'); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1]} ${y}`; };
const inRange = (d, f) => (!f.from || iso(d) >= f.from) && (!f.to || iso(d) <= f.to);
const sumBy = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const totalRow = (rows, cols, label = 'Total') => { const t = { _total: true }; cols.forEach((c, i) => { t[c.k] = i === 0 ? label : c.t === 'm' || (c.t === 'n' && !c.noSum) ? sumBy(rows, c.k) : ''; }); return t; };

// live bookings with wing, buyer and balances (the base of the flat-level reports)
async function flats(projectId, f) {
  const R = await db.q(`select b.id, u.unit_no, bl.code as wing, b.crm_status, b.cp_name, b.source, b.agreement_value, b.booking_date, b.brokerage,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
      bb.credit_av, bb.received_tds, bb.received_gst, bb.received_sdr, bb.demanded, bb.outstanding, bb.overdue, bb.gst_outstanding
    from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id left join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.status = 'active' and not coalesce(b.sample, false) order by u.unit_no`, [projectId]);
  return R.filter((r) => (!f.wing || r.wing === f.wing) && (!f.status || (r.crm_status || 'Not set') === f.status));
}

const REPORTS = {
  // ---------- Sales ----------
  bookings: { section: 'Sales', title: 'Bookings by month', sub: 'Flats booked each month, by wing and source, with agreement value', filters: ['from', 'to', 'wing'],
    async run(p, f) {
      const R = (await db.q(`select b.booking_date, b.status, b.cp_name, b.source, b.agreement_value, bl.code as wing from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
        where u.project_id = $1 and b.status in ('active', 'cancelled', 'transferred') and not coalesce(b.sample, false)`, [p])).filter((r) => inRange(r.booking_date, f) && (!f.wing || r.wing === f.wing));
      const M = {};
      for (const r of R) { const x = (M[ym(r.booking_date)] ||= { month: ym(r.booking_date), n: 0, a: 0, b: 0, cp: 0, direct: 0, av: 0, live: 0, gone: 0 }); x.n++; x[r.wing === 'A' ? 'a' : 'b']++; x[r.cp_name ? 'cp' : 'direct']++; x.av += n(r.agreement_value); x[r.status === 'active' ? 'live' : 'gone']++; }
      const cols = [{ k: 'label', l: 'Month' }, { k: 'n', l: 'Flats booked', t: 'n' }, { k: 'a', l: 'Wing A', t: 'n' }, { k: 'b', l: 'Wing B', t: 'n' }, { k: 'cp', l: 'Through a partner', t: 'n' }, { k: 'direct', l: 'Direct', t: 'n' },
        { k: 'av', l: 'Agreement value', t: 'm' }, { k: 'live', l: 'Still booked', t: 'n' }, { k: 'gone', l: 'Cancelled or moved since', t: 'n' }];
      const rows = Object.values(M).sort((x, y) => y.month.localeCompare(x.month)).map((x) => ({ ...x, label: mlab(x.month) }));
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'By booking date. Bookings cancelled or moved to another flat later are counted in the month they were booked.' };
    } },
  cancellations: { section: 'Sales', title: 'Cancellations & transfers', sub: 'Every cancelled flat and every move to another flat, with what the buyer had paid', filters: ['from', 'to', 'wing'],
    async run(p, f) {
      const C = (await db.q("select cancel_date, unit_no, client, final_av, received, refund_status, cp from acc_cancellations where book = $1", [BOOK])).filter((r) => inRange(r.cancel_date, f) && (!f.wing || String(r.unit_no).startsWith(f.wing + '-')));
      const T = (await db.q(`select b.id, b.cancel_date, b.approved_at, u.unit_no, tu.unit_no as to_unit, b.agreement_value, b.transfer_av,
          (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer
        from bookings b join units u on u.id = b.unit_id left join units tu on tu.id = b.transfer_to_unit_id where u.project_id = $1 and b.status = 'transferred'`, [p])).filter((r) => inRange(r.cancel_date || r.approved_at, f) && (!f.wing || r.unit_no.startsWith(f.wing + '-')));
      const cols = [{ k: 'date', l: 'Date', t: 'd' }, { k: 'kind', l: 'What' }, { k: 'unit', l: 'Flat' }, { k: 'buyer', l: 'Buyer' }, { k: 'av', l: 'Agreement value', t: 'm' }, { k: 'paid', l: 'Paid by buyer', t: 'm' }, { k: 'detail', l: 'Status / moved to' }, { k: 'cp', l: 'Partner' }];
      const rows = [...C.map((r) => ({ date: iso(r.cancel_date), kind: 'Cancelled', unit: r.unit_no, buyer: r.client, av: n(r.final_av), paid: n(r.received), detail: r.refund_status || '', cp: r.cp || '', _href: '#/reg-cancellations' })),
        ...T.map((r) => ({ date: iso(r.cancel_date || r.approved_at), kind: 'Moved to another flat', unit: r.unit_no, buyer: r.buyer, av: n(r.agreement_value), paid: null, detail: r.to_unit ? 'to ' + r.to_unit : '', cp: '', _href: '#/booking/' + r.id }))]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { cols, rows: [...rows, totalRow(rows, cols)] };
    } },
  partners: { section: 'Sales', title: 'Channel partner performance', sub: 'Per partner: flats sold, agreement value, money collected and brokerage', filters: ['wing', 'status'],
    async run(p, f) {
      const F = await flats(p, f), P = {};
      for (const r of F) { const k = r.cp_name ? r.cp_name.trim() : '(Direct / no partner)'; const x = (P[k] ||= { cp: k, n: 0, av: 0, got: 0, due: 0, brok: 0 }); x.n++; x.av += n(r.agreement_value); x.got += n(r.credit_av); x.due += n(r.outstanding); x.brok += n(r.brokerage); }
      const rows = Object.values(P).map((x) => ({ ...x, pct: x.av ? Math.round((x.got / x.av) * 1000) / 10 : 0 })).sort((a, b) => b.av - a.av);
      const cols = [{ k: 'cp', l: 'Channel partner' }, { k: 'n', l: 'Flats (live)', t: 'n' }, { k: 'av', l: 'Agreement value', t: 'm' }, { k: 'got', l: 'AV received', t: 'm' }, { k: 'pct', l: '% of AV received', t: 'n', noSum: true }, { k: 'due', l: 'AV due now', t: 'm' }, { k: 'brok', l: 'Brokerage agreed', t: 'm' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'Live bookings only. Brokerage paid and billed is on Accounts reports → Channel partner accounts.' };
    } },

  // ---------- Collections ----------
  collections: { section: 'Collections', title: 'Collections by month', sub: 'Money received from buyers each month (CRM), by wing and head', filters: ['from', 'to', 'wing'],
    async run(p, f) {
      const R = (await db.q(`select r.received_on, bl.code as wing, s.head, s.amount from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
          join receipt_splits s on s.receipt_id = r.id where u.project_id = $1 and r.status = 'approved'`, [p])).filter((r) => inRange(r.received_on, f) && (!f.wing || r.wing === f.wing));
      const M = {};
      for (const r of R) { const x = (M[ym(r.received_on)] ||= { month: ym(r.received_on), av: 0, gst: 0, sdr: 0, tds: 0, a: 0, b: 0 }); const h = r.head === 'stamp_duty' || r.head === 'registration' ? 'sdr' : r.head; if (x[h] != null) x[h] += n(r.amount); if (h !== 'tds') x[r.wing === 'A' ? 'a' : 'b'] += n(r.amount); }
      const rows = Object.values(M).sort((x, y) => y.month.localeCompare(x.month)).map((x) => ({ ...x, label: mlab(x.month), total: x.av + x.gst + x.sdr }));
      const cols = [{ k: 'label', l: 'Month' }, { k: 'av', l: 'AV', t: 'm' }, { k: 'gst', l: 'GST', t: 'm' }, { k: 'sdr', l: 'Stamp duty & registration', t: 'm' }, { k: 'total', l: 'Total received', t: 'm' }, { k: 'a', l: 'Wing A', t: 'm' }, { k: 'b', l: 'Wing B', t: 'm' }, { k: 'tds', l: 'TDS (by buyers, not in the bank)', t: 'm' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'Approved CRM receipts by the date received.' };
    } },
  ageing: { section: 'Collections', title: 'Ageing of dues', sub: 'What each buyer owes, by how long it has been overdue', filters: ['wing', 'status'],
    async run(p, f) {
      const F = await flats(p, f), ids = F.map((r) => r.id);
      const D = ids.length ? await db.q("select booking_id, due_date, amount from demands where booking_id = any($1) and status = 'raised' order by due_date", [ids]) : [];
      const by = {}; for (const d of D) (by[d.booking_id] ||= []).push(d);
      const t = today(), rows = [];
      for (const r of F) {
        let credit = n(r.credit_av); const x = { unit: r.unit_no, buyer: r.buyer || '', status: r.crm_status || 'Not set', notdue: 0, d30: 0, d60: 0, d90: 0, d90p: 0, _href: '#/booking/' + r.id };
        for (const d of by[r.id] || []) { const take = Math.min(credit, n(d.amount)); credit -= take; const left = n(d.amount) - take; if (left <= 0) continue; const age = dayDiff(t, iso(d.due_date)); x[age <= 0 ? 'notdue' : age <= 30 ? 'd30' : age <= 60 ? 'd60' : age <= 90 ? 'd90' : 'd90p'] += left; }
        x.overdue = x.d30 + x.d60 + x.d90 + x.d90p; x.total = x.overdue + x.notdue;
        if (x.total > 0) rows.push(x);
      }
      rows.sort((a, b) => b.d90p - a.d90p || b.overdue - a.overdue);
      const cols = [{ k: 'unit', l: 'Flat' }, { k: 'buyer', l: 'Buyer' }, { k: 'status', l: 'Follow-up status' }, { k: 'd30', l: '1–30 days', t: 'm' }, { k: 'd60', l: '31–60 days', t: 'm' }, { k: 'd90', l: '61–90 days', t: 'm' }, { k: 'd90p', l: 'Over 90 days', t: 'm' }, { k: 'overdue', l: 'Overdue', t: 'm' }, { k: 'notdue', l: 'Demanded, not due yet', t: 'm' }, { k: 'total', l: 'Total due (AV)', t: 'm' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'AV only (GST is on Dues & actions). Each demand is paid off oldest first; what is left is aged from its due date.' };
    } },
  stages: { section: 'Collections', title: 'Demands raised vs collected', sub: 'Per construction stage: how much was demanded, collected and is still pending', filters: ['wing', 'status'],
    async run(p, f) {
      const F = await flats(p, f), ids = F.map((r) => r.id), cr = Object.fromEntries(F.map((r) => [r.id, n(r.credit_av)]));
      const D = ids.length ? await db.q("select booking_id, stage_name, due_date, amount from demands where booking_id = any($1) and status = 'raised' order by booking_id, due_date", [ids]) : [];
      const S = {}, order = {};
      for (const d of D) { const take = Math.min(cr[d.booking_id] || 0, n(d.amount)); cr[d.booking_id] = (cr[d.booking_id] || 0) - take; const x = (S[d.stage_name] ||= { stage: d.stage_name, flats: 0, demanded: 0, got: 0, pending: 0, open: 0 }); x.flats++; x.demanded += n(d.amount); x.got += take; x.pending += n(d.amount) - take; if (n(d.amount) - take > 1) x.open++; order[d.stage_name] = Math.min(order[d.stage_name] ?? 9e15, Date.parse(iso(d.due_date))); }
      const rows = Object.values(S).sort((a, b) => order[a.stage] - order[b.stage]).map((x) => ({ ...x, pct: x.demanded ? Math.round((x.got / x.demanded) * 1000) / 10 : 0 }));
      const cols = [{ k: 'stage', l: 'Stage' }, { k: 'flats', l: 'Flats demanded', t: 'n' }, { k: 'demanded', l: 'Demanded (AV)', t: 'm' }, { k: 'got', l: 'Collected', t: 'm' }, { k: 'pending', l: 'Pending', t: 'm' }, { k: 'pct', l: '% collected', t: 'n', noSum: true }, { k: 'open', l: 'Flats still owing', t: 'n' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'Money received is set against the earliest demands first.' };
    } },
  cheques: { section: 'Collections', title: 'Cheques & bounces', sub: 'Every cheque from buyers: cleared, waiting or bounced', filters: ['from', 'to', 'wing'],
    async run(p, f) {
      const R = (await db.q(`select r.id, b.id as bid, r.received_on, r.amount, r.instrument_no, r.bank, r.status, r.reverse_reason, u.unit_no, bl.code as wing,
          (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer
        from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id
        where u.project_id = $1 and r.mode = 'cheque'`, [p])).filter((r) => inRange(r.received_on, f) && (!f.wing || r.wing === f.wing));
      const lab = { approved: 'Cleared', pending: 'Waiting for the bank', bounced: 'Bounced', rejected: 'Rejected', reversed: 'Reversed' };
      const rows = R.sort((a, b) => iso(b.received_on).localeCompare(iso(a.received_on))).map((r) => ({ date: iso(r.received_on), unit: r.unit_no, buyer: r.buyer || '', amount: n(r.amount), no: r.instrument_no || '', bank: r.bank || '', status: lab[r.status] || r.status, why: r.reverse_reason || '', _href: '#/booking/' + r.bid }));
      const cols = [{ k: 'date', l: 'Received', t: 'd' }, { k: 'unit', l: 'Flat' }, { k: 'buyer', l: 'Buyer' }, { k: 'amount', l: 'Amount', t: 'm' }, { k: 'no', l: 'Cheque no.' }, { k: 'bank', l: 'Bank' }, { k: 'status', l: 'Status' }, { k: 'why', l: 'Reason' }];
      const b = rows.filter((r) => r.status === 'Bounced');
      return { cols, rows: [...rows, totalRow(rows, cols)], note: `${b.length} bounced (₹${sumBy(b, 'amount').toLocaleString('en-IN')}). Post-dated cheques the company issued are on Accounts → PDC.` };
    } },

  // ---------- Customer ----------
  tds: { section: 'Customer', title: 'TDS by buyers', sub: 'TDS each buyer deducted: in the CRM, on the TDS portal, and what is missing', filters: ['wing', 'status'],
    async run(p, f) {
      const F = await flats(p, f);
      const T = Object.fromEntries((await db.q("select unit_no, sum(tds_amount) as amt, count(*)::int as k from acc_tds_entries where book = $1 group by 1", [BOOK])).map((x) => [x.unit_no, x]));
      const rows = F.map((r) => { const t = T[r.unit_no] || {}; const crm = n(r.received_tds), portal = n(t.amt), due = n(r.agreement_value) >= 5000000 ? Math.round(n(r.credit_av) * 0.01) : 0;
        return { unit: r.unit_no, buyer: r.buyer || '', av: n(r.agreement_value), due, crm, portal, k: t.k || 0, diff: portal - crm, state: !due && !portal && !crm ? 'No TDS (AV under ₹50 lakh)' : Math.abs(portal - crm) <= 100 ? 'Agrees' : portal > crm ? 'More on the portal than in the CRM' : 'In the CRM, not on the portal', _href: '#/booking/' + r.id }; })
        .filter((r) => r.state !== 'No TDS (AV under ₹50 lakh)');
      rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      const cols = [{ k: 'unit', l: 'Flat' }, { k: 'buyer', l: 'Buyer' }, { k: 'av', l: 'Agreement value', t: 'm' }, { k: 'due', l: 'TDS due on AV paid (1%)', t: 'm' }, { k: 'crm', l: 'TDS in the CRM', t: 'm' }, { k: 'portal', l: 'TDS on the portal', t: 'm' }, { k: 'k', l: 'Portal entries', t: 'n' }, { k: 'diff', l: 'Portal less CRM', t: 'm' }, { k: 'state', l: 'Check' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'TDS at 1% applies when the agreement value is ₹50 lakh or more. "On the portal" is the TDS Tracker, loaded from the TDS portal.' };
    } },

  // ---------- Accounts ----------
  cashflow: { section: 'Accounts', title: 'Cash flow by month', sub: 'Money in and out of all bank accounts each month, and the running total', filters: ['from', 'to'],
    async run(p, f) {
      const R = await db.q(`select to_char(txn_date, 'YYYY-MM') as m, sum(amount) as a, sum(amount) filter (where coalesce(payment_head, '') <> '') as c from acc_receipts where book = $1 and coalesce(head, '') <> 'Internal transfer' and ${acc.RECEIVED_SQL} group by 1`, [BOOK]);
      const P = await db.q("select to_char(txn_date, 'YYYY-MM') as m, sum(amount) as a from acc_payments where book = $1 and coalesce(head, '') <> 'Internal transfer' group by 1", [BOOK]);
      const M = {}; for (const r of R) (M[r.m] ||= { month: r.m, inn: 0, cust: 0, out: 0 }).inn = n(r.a), M[r.m].cust = n(r.c); for (const r of P) (M[r.m] ||= { month: r.m, inn: 0, cust: 0, out: 0 }).out = n(r.a);
      let run = 0; const all = Object.values(M).sort((a, b) => a.month.localeCompare(b.month)).map((x) => { run += x.inn - x.out; return { ...x, other: x.inn - x.cust, net: x.inn - x.out, run }; });
      const rows = all.filter((x) => (!f.from || x.month >= f.from.slice(0, 7)) && (!f.to || x.month <= f.to.slice(0, 7))).reverse().map((x) => ({ ...x, label: mlab(x.month) }));
      const cols = [{ k: 'label', l: 'Month' }, { k: 'cust', l: 'From buyers', t: 'm' }, { k: 'other', l: 'Other money in', t: 'm' }, { k: 'inn', l: 'Total in', t: 'm' }, { k: 'out', l: 'Total out', t: 'm' }, { k: 'net', l: 'Net', t: 'm' }, { k: 'run', l: 'Running total since the start', t: 'm', noSum: true }];
      const t = totalRow(rows, cols); t.run = '';
      return { cols, rows: [...rows, t], note: 'Receipts and Payments Out, transfers between your own accounts and bounced cheques left out. "Other money in" is loans, investors and the rest. Tap a month on Payments by head for the heads.' };
    } },
  investors: { section: 'Accounts', title: 'Investors, partners & loans', sub: 'Money in from and out to each investor, partner and lender, and the balance', filters: ['from', 'to'],
    async run(p, f) {
      const RX = "~* '(investor|current a/c|loan|partner|director|capital)'";
      const R = (await db.q(`select txn_date, coalesce(nullif(payer_name, ''), head) as party, amount from acc_receipts where book = $1 and coalesce(head, '') <> 'Internal transfer' and ${acc.RECEIVED_SQL} and (coalesce(head, '') ${RX} or coalesce(payer_name, '') ${RX})`, [BOOK])).filter((r) => inRange(r.txn_date, f));
      const P = (await db.q(`select txn_date, coalesce(nullif(payee, ''), head) as party, amount from acc_payments where book = $1 and coalesce(head, '') <> 'Internal transfer' and (coalesce(head, '') ${RX} or coalesce(payee, '') ${RX})`, [BOOK])).filter((r) => inRange(r.txn_date, f));
      const X = {}; const k = (s) => String(s || '(not named)').trim();
      for (const r of R) { const x = (X[k(r.party)] ||= { party: k(r.party), inn: 0, out: 0, last: '' }); x.inn += n(r.amount); if (iso(r.txn_date) > x.last) x.last = iso(r.txn_date); }
      for (const r of P) { const x = (X[k(r.party)] ||= { party: k(r.party), inn: 0, out: 0, last: '' }); x.out += n(r.amount); if (iso(r.txn_date) > x.last) x.last = iso(r.txn_date); }
      const rows = Object.values(X).map((x) => ({ ...x, bal: x.inn - x.out, _ledger: { reg: 'payments', col: 'payee', v: x.party } })).sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
      const cols = [{ k: 'party', l: 'Investor / partner / lender' }, { k: 'inn', l: 'Received from them', t: 'm' }, { k: 'out', l: 'Paid to them', t: 'm' }, { k: 'bal', l: 'Balance (received less paid)', t: 'm' }, { k: 'last', l: 'Last entry', t: 'd' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: 'Ledgers whose name has Investor, Current A/c, Loan, Partner, Director or Capital, from Receipts and Payments Out.' };
    } },
  rera: { section: 'Tax & compliance', title: 'RERA 70% account', sub: 'Money into and out of the RERA 70% account each month, and what it was spent on', filters: ['from', 'to'],
    async run(p, f) {
      const bank = (await db.one("select name from acc_banks where book = $1 and name ilike '%70\\%%' order by name limit 1", [BOOK]).catch(() => null))?.name || 'Yes RERA Collection 70% (0800)';
      const R = (await db.q(`select txn_date, amount, head from acc_receipts where book = $1 and bank = $2 and ${acc.RECEIVED_SQL}`, [BOOK, bank])).filter((r) => inRange(r.txn_date, f));
      const P = (await db.q('select txn_date, amount, head from acc_payments where book = $1 and bank = $2', [BOOK, bank])).filter((r) => inRange(r.txn_date, f));
      const M = {};
      for (const r of R) { const x = (M[ym(r.txn_date)] ||= { month: ym(r.txn_date), inn: 0, out: 0, heads: {} }); x.inn += n(r.amount); }
      for (const r of P) { const x = (M[ym(r.txn_date)] ||= { month: ym(r.txn_date), inn: 0, out: 0, heads: {} }); x.out += n(r.amount); x.heads[r.head || '(no head)'] = (x.heads[r.head || '(no head)'] || 0) + n(r.amount); }
      const rows = Object.values(M).sort((a, b) => b.month.localeCompare(a.month)).map((x) => ({ label: mlab(x.month), inn: x.inn, out: x.out, net: x.inn - x.out, spent: Object.entries(x.heads).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([h, v]) => `${h} ₹${v.toLocaleString('en-IN')}`).join('; ') }));
      const cols = [{ k: 'label', l: 'Month' }, { k: 'inn', l: 'Into the account', t: 'm' }, { k: 'out', l: 'Withdrawn', t: 'm' }, { k: 'net', l: 'Net', t: 'm' }, { k: 'spent', l: 'Withdrawn for (largest heads)' }];
      return { cols, rows: [...rows, totalRow(rows, cols)], note: `Bank account: ${bank}. Withdrawals must match the engineer, architect and CA certificates for the RERA quarterly return.` };
    } },
};

async function run(key, projectId, f) {
  const R = REPORTS[key]; if (!R) throw Object.assign(new Error('Unknown report.'), { status: 404 });
  const out = await R.run(projectId, f);
  return { key, title: R.title, sub: R.sub, section: R.section, filters: R.filters, ...out };
}
const list = () => Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, sub: r.sub, section: r.section }));

module.exports = { run, list };
