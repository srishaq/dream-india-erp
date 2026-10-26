// Accounts: the registers of the Master Accounts sheet, and everything the sheet works out from them
// (the green columns, To Do, Daily Bank Balance, Checks and the report tabs).
const db = require('./db');
const { REGISTERS, LISTS } = require('./acc-schema');
const { today: istToday } = require('./demands');

const BOOK = 'signature';
const n = (v) => (v == null || v === '' ? 0 : Number(v));
const r0 = (x) => Math.round(Number(x) || 0);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const addDays = (iso, k) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const monthStart = (iso) => iso.slice(0, 8) + '01';
const UNIT = /^[A-Z]{1,2}-\d{3,5}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- lists (the dropdowns) ----------
async function lists() {
  const banks = await db.q('select name from acc_banks where book = $1 and active order by name', [BOOK]);
  const daily = await db.q('select name from acc_daily_banks where book = $1 and active order by seq, name', [BOOK]);
  const heads = await db.q('select side, name from acc_heads where book = $1 and active order by name', [BOOK]);
  const payees = await db.q("select payee as name, count(*)::int as n from acc_payments where book = $1 and coalesce(payee, '') <> '' group by payee order by count(*) desc, payee limit 3000", [BOOK]);
  return { ...LISTS, bank: banks.map((x) => x.name), dailyBank: daily.map((x) => x.name), receiptHead: heads.filter((h) => h.side === 'receipt').map((h) => h.name),
    paymentHead2: heads.filter((h) => h.side === 'payment').map((h) => h.name), payee: payees.map((p) => p.name) };
}

// ---------- validating one row ----------
function cleanValue(c, v) {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  switch (c.type) {
    case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(400, `${c.label}: enter a date.`); return s;
    case 'money': case 'num': { const x = Number(s.replace(/[₹,\s]/g, '')); if (!Number.isFinite(x)) throw fail(400, `${c.label}: enter a number.`); return Math.round(x * 100) / 100; }
    case 'pct': { const x = Number(s.replace(/[%\s]/g, '')); if (!Number.isFinite(x)) throw fail(400, `${c.label}: enter a percentage.`); return x > 1 ? x / 100 : x; }
    default: return s.slice(0, c.type === 'long' ? 1000 : 300);
  }
}
async function cleanRow(regKey, data, { partial = false } = {}) {
  const reg = REGISTERS[regKey]; if (!reg) throw fail(400, 'Unknown register.');
  const L = await lists();
  const out = {};
  for (const c of reg.cols) {
    if (c.calc) continue;
    let v = cleanValue(c, data[c.key]);
    if (v === undefined) { if (!partial && c.required) throw fail(400, `${c.label} is required.`); continue; }
    if (v === null && c.required) throw fail(400, `${c.label} is required.`);
    if (v !== null && c.unit) { v = v.toUpperCase().replace(/\s/g, '').replace(/^DI-/, ''); if (!UNIT.test(v)) throw fail(400, `${c.label}: use the Wing-Number format, like A-1001.`); }
    if (v !== null && c.type === 'list' && !c.free) {
      const allowed = L[c.list] || [];
      if (allowed.length && !allowed.includes(v)) throw fail(400, `${c.label}: "${v}" is not on the list. ${['receiptHead', 'paymentHead2', 'bank', 'dailyBank'].includes(c.list) ? 'New heads and banks are set up by Accounts admin.' : ''}`);
    }
    out[c.key] = v;
  }
  return out;
}

async function nextRef(t, reg) {
  if (!reg.prefix) return null;
  const w = reg.idWidth || 5;
  const r = await t.one(`select coalesce(max(nullif(regexp_replace(ref_id, '\\D', '', 'g'), '')::int), 0) as m from ${reg.table} where book = $1 and ref_id like $2`, [BOOK, reg.prefix + '%']);
  return reg.prefix + String(r.m + 1).padStart(w, '0');
}

// ---------- the green columns ----------
async function headMap() {
  const heads = await db.q('select * from acc_heads where book = $1', [BOOK]);
  return { payment: Object.fromEntries(heads.filter((h) => h.side === 'payment').map((h) => [h.name, h])), receipt: Object.fromEntries(heads.filter((h) => h.side === 'receipt').map((h) => [h.name, h])) };
}
function billNeeds(p, head) {
  if (!head || !head.needs_bill) return '';
  const miss = [];
  if (!p.bill_date) miss.push('Bill date');
  if (!p.vendor_pan) miss.push('PAN');
  if (!p.bill_no) miss.push('Bill no.');
  if (p.taxable_value == null) miss.push('Taxable value');
  if (p.gst_on_bill == null) miss.push('GST on bill (0 if none)');
  if (p.tds_deducted == null) miss.push('TDS deducted (0 if none)');
  if (!p.tds_challan) miss.push('Challan no. (NA if no TDS)');
  if (!p.tds_deposited_on && !/^na$/i.test(p.tds_challan || '') && n(p.tds_deducted) > 0) miss.push('TDS deposit date');
  return miss.length ? 'Add: ' + miss.join(', ') : '';
}
const rentYear = (date, given) => (given ? Number(given) : +date.slice(5, 7) >= 10 ? +date.slice(0, 4) + 1 : +date.slice(0, 4));

async function withCalc(regKey, rows) {
  const t = istToday();
  if (regKey === 'payments') { const H = await headMap(); for (const r of rows) r.needs = billNeeds(r, H.payment[r.head]); }
  if (regKey === 'pdc') for (const r of rows) { r.days = days(t, r.due_date); r.state = r.days < 0 ? 'Past due date' : r.days === 0 ? 'Due today' : r.days <= 7 ? 'Due this week' : 'Upcoming'; }
  if (regKey === 'recon') for (const r of rows) {
    r.age = r.item_date ? days(r.item_date, t) : null;
    r.bucket = r.age == null ? '' : r.age <= 30 ? '0-30 days' : r.age <= 60 ? '31-60 days' : r.age <= 90 ? '61-90 days' : 'Over 90 days';
    const amt = Math.abs(n(r.amount));
    r.escalation = r.status === 'Resolved' ? '' : amt > 500000 || (r.age || 0) > 90 ? 'Management review' : amt > 100000 || (r.age || 0) > 60 ? 'Supervisor review' : '';
  }
  if (regKey === 'compliance') for (const r of rows) r.late = r.status === 'Pending' || !r.status ? Math.max(0, days(r.due_date, t)) || null : r.date_complied && r.date_complied > r.due_date ? days(r.due_date, r.date_complied) : null;
  if (regKey === 'rentLinks' || regKey === 'tenants') {
    const pays = Object.fromEntries((await db.q("select ref_id, txn_date, bank, description, amount from acc_payments where book = $1 and head = 'Tenant Rent'", [BOOK])).map((p) => [p.ref_id, p]));
    const links = regKey === 'rentLinks' ? rows : await db.q('select * from acc_rent_links where book = $1', [BOOK]);
    for (const l of links) {
      const p = pays[l.payment_ref];
      l.p_date = p ? p.txn_date : null; l.p_bank = p ? p.bank : null; l.p_desc = p ? p.description : null;
      l.counted = p ? (l.split_amount != null ? n(l.split_amount) : n(p.amount)) : 0;
      l.year_counted = p ? rentYear(p.txn_date, l.rent_year) : null;
    }
    if (regKey === 'tenants') {
      const year = +t.slice(0, 4);
      for (const r of rows) {
        const inc = n(r.yearly_increase);
        r.rent_2025 = r.rent_2025 != null && r.rent_2025 !== '' ? r0(r.rent_2025) : r0(n(r.monthly_rent) * n(r.months)); r.rent_2026 = r0(r.rent_2025 * (1 + inc)); r.rent_2027 = r0(r.rent_2026 * (1 + inc));
        const mine = links.filter((l) => Number(l.survey_no) === Number(r.survey_no));
        const paidIn = (y) => mine.filter((l) => l.year_counted === y).reduce((a, l) => a + l.counted, 0);
        r.paid_2025 = paidIn(2025); r.paid_2026 = paidIn(2026); r.paid_2027 = paidIn(2027);
        r.paid_total = mine.reduce((a, l) => a + l.counted, 0);
        r.due_to_date = (year >= 2025 ? r.rent_2025 : 0) + (year >= 2026 ? r.rent_2026 : 0) + (year >= 2027 ? r.rent_2027 : 0) + n(r.other_amount);
        r.balance = r0(r.due_to_date - r.paid_total);
        r.position = r.status && r.status !== 'Active' ? r.status : Math.abs(r.balance) <= 1 ? 'Paid in full' : r.balance < 0 ? 'Paid extra' : r.paid_total ? 'Short paid' : 'Not paid';
        r.n_payments = mine.filter((l) => l.counted).length;
      }
    }
  }
  return rows;
}

async function list(regKey, { q = '', from, to, filter, limit = 200, offset = 0 } = {}) {
  const reg = REGISTERS[regKey]; if (!reg) throw fail(400, 'Unknown register.');
  const where = ['book = $1'], args = [BOOK];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (reg.dateKey && from) add(`${reg.dateKey} >= ?`, from);
  if (reg.dateKey && to) add(`${reg.dateKey} <= ?`, to);
  if (q) { const textCols = reg.cols.filter((c) => !c.calc && ['text', 'long', 'list'].includes(c.type)).map((c) => `coalesce(${c.key}, '')`); if (reg.prefix) textCols.push("coalesce(ref_id, '')"); add(`(${textCols.join(" || ' ' || ")}) ilike ?`, `%${q}%`); }
  const F = {
    noHead: "coalesce(head, '') = ''", noUnit: "coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = ''", bounced: "cheque_status = 'Bounced'", noPayee: "coalesce(payee, '') = ''",
    open: "coalesce(status, 'Open') <> 'Resolved'", pending: "coalesce(status, 'Pending') = 'Pending'", customer: "coalesce(payment_head, '') <> ''",
  };
  if (filter && F[filter]) where.push(F[filter]);
  const order = reg.dateKey ? `${reg.dateKey} desc nulls last, id desc` : regKey === 'tenants' ? 'survey_no, id' : 'id desc';
  const total = await db.one(`select count(*)::int as n${reg.cols.some((c) => c.key === 'amount' && !c.calc) ? ', coalesce(sum(amount), 0) as amount' : ''} from ${reg.table} where ${where.join(' and ')}`, args);
  let rows = await db.q(`select * from ${reg.table} where ${where.join(' and ')} order by ${order} limit ${Math.min(+limit || 200, 2000)} offset ${Math.max(+offset || 0, 0)}`, args);
  rows = await withCalc(regKey, rows);
  if (filter === 'needsBill') rows = rows.filter((r) => r.needs);
  return { rows, total: total.n, amount: total.amount != null ? n(total.amount) : null };
}

// ---------- Daily Bank Balance ----------
async function balances(date) {
  const d = date || istToday();
  const banks = await db.q('select * from acc_daily_banks where book = $1 and active order by seq, id', [BOOK]);
  const ent = await db.q(`select bank, sum(coalesce(receipts, 0)) filter (where entry_date < $2) as r_before, sum(coalesce(payments, 0)) filter (where entry_date < $2) as p_before,
                                 sum(coalesce(receipts, 0)) filter (where entry_date = $2) as r_day, sum(coalesce(payments, 0)) filter (where entry_date = $2) as p_day, min(entry_date) as first
                            from acc_daily_entries e where book = $1 and entry_date <= $2 group by bank`, [BOOK, d]);
  const stated = await db.q('select distinct on (daily_bank_id) daily_bank_id, on_date, balance from acc_bank_stated where on_date <= $1 order by daily_bank_id, on_date desc', [d]);
  const E = Object.fromEntries(ent.map((e) => [e.bank, e])), S = Object.fromEntries(stated.map((s) => [s.daily_bank_id, s]));
  const rows = banks.map((b) => {
    const e = E[b.name] || {};
    // Opening = balance brought forward plus every entry after the brought-forward date and before the report date.
    const opening = n(b.bf_balance) + n(e.r_before) - n(e.p_before);
    const closing = opening + n(e.r_day) - n(e.p_day);
    const s = S[b.id] && S[b.id].on_date === d ? S[b.id] : null;
    return { id: b.id, bank: b.name, account_no: b.account_no, grp: b.grp, opening, receipts: n(e.r_day), payments: n(e.p_day), closing,
      perBank: s ? n(s.balance) : null, difference: s ? Math.round((n(s.balance) - closing) * 100) / 100 : null, bf: n(b.bf_balance), bf_date: b.bf_date, auto: b.auto_from_statement };
  });
  const groups = [...new Set(rows.map((r) => r.grp))].map((g) => {
    const x = rows.filter((r) => r.grp === g), s = (k) => x.reduce((a, r) => a + (r[k] || 0), 0);
    return { grp: g, opening: s('opening'), receipts: s('receipts'), payments: s('payments'), closing: s('closing'), perBank: s('perBank'), bf: s('bf') };
  });
  const entries = await db.q('select * from acc_daily_entries where book = $1 order by entry_date desc, id desc limit 60', [BOOK]);
  return { date: d, rows, groups, entries, bfDate: banks.find((b) => b.bf_date)?.bf_date || null };
}

// ---------- To Do ----------
async function todo() {
  const t = istToday(), m0 = monthStart(t);
  const one = (sql, a = []) => db.one(sql, [BOOK, ...a]);
  const lastR = await one('select max(txn_date) as d from acc_receipts where book = $1'), lastP = await one('select max(txn_date) as d from acc_payments where book = $1');
  const lastD = await one('select max(entry_date) as d from acc_daily_entries where book = $1');
  const c = async (table, cond, a = []) => (await one(`select count(*)::int as n from ${table} where book = $1 and ${cond}`, a)).n;
  const H = await headMap();
  const pays = await db.q('select * from acc_payments where book = $1', [BOOK]);
  const needBill = pays.map((p) => ({ ...p, needs: billNeeds(p, H.payment[p.head]) })).filter((p) => p.needs).sort((a, b) => (b.txn_date || '').localeCompare(a.txn_date || ''));
  const bal = await balances(t);
  const bankOff = bal.rows.filter((r) => r.difference != null && Math.abs(r.difference) > 1).length;
  const ch = await checks();
  const items = [
    { task: 'Days since the last receipt was entered', n: lastR.d ? days(lastR.d, t) : null, go: 'receipts', what: 'One row for every credit on the bank statement.', good: (x) => x <= 1 },
    { task: 'Days since the last payment was entered', n: lastP.d ? days(lastP.d, t) : null, go: 'payments', what: 'One row for every debit on the bank statement.', good: (x) => x <= 1 },
    { task: 'Days since the last Daily Bank Balance entry', n: lastD.d ? days(lastD.d, t) : null, go: 'balances', what: 'Add one row per bank for each day, then type the bank\'s balance in Balance per Bank.', good: (x) => x <= 1 },
    { task: `Receipts with no Cash Flow Head (since ${m0})`, n: await c('acc_receipts', "txn_date >= $2 and coalesce(head, '') = ''", [m0]), go: 'receipts', filter: 'noHead', what: 'Pick the head from the list.' },
    { task: `Customer receipts with no Unit (since ${m0})`, n: await c('acc_receipts', "txn_date >= $2 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = ''", [m0]), go: 'receipts', filter: 'noUnit', what: 'Type the flat, like A-1001.' },
    { task: `Payments with no Cash Flow Head (since ${m0})`, n: await c('acc_payments', "txn_date >= $2 and coalesce(head, '') = ''", [m0]), go: 'payments', filter: 'noHead', what: 'Pick the head from the list.' },
    { task: `Payments with no Payee (since ${m0})`, n: await c('acc_payments', "txn_date >= $2 and coalesce(payee, '') = ''", [m0]), go: 'payments', filter: 'noPayee', what: 'Pick or type who was paid.' },
    { task: 'Payments still needing bill details', n: needBill.length, go: 'payments', filter: 'needsBill', what: 'Fill the bill columns on that payment.' },
    { task: 'Compliance items overdue', n: await c('acc_compliance', "coalesce(status, 'Pending') = 'Pending' and due_date < $2", [t]), go: 'compliance', filter: 'pending', what: 'If already filed or paid, set Status to Complied with the date and acknowledgement.' },
    { task: 'Compliance items due in the next 7 days', n: await c('acc_compliance', "coalesce(status, 'Pending') = 'Pending' and due_date between $2 and $3", [t, addDays(t, 7)]), go: 'compliance', filter: 'pending', what: 'Make sure these are filed or paid on time.' },
    { task: 'Bank items not yet matched', n: await c('acc_recon_items', "coalesce(status, 'Open') <> 'Resolved'"), go: 'recon', filter: 'open', what: 'Fill Owner, then Status and Resolution Note as each is cleared.' },
    { task: 'Banks whose balance does not agree', n: bankOff, go: 'balances', what: 'Difference must be blank or zero. Find the missing entry for that bank.' },
    { task: 'Checks not OK', n: ch.filter((x) => x.result === 'Check').length, go: 'checks', what: 'Read the line that says Check; fix the entry it points to.' },
    { task: 'PDC cheques due in the next 7 days', n: await c('acc_pdc', 'due_date between $2 and $3', [t, addDays(t, 7)]), go: 'pdc', what: 'Keep enough balance in that bank for each one.' },
  ].map((x) => ({ ...x, ok: x.n == null ? false : x.good ? x.good(x.n) : x.n === 0, good: undefined }));
  const comp = await db.q("select compliance, period, due_date from acc_compliance where book = $1 and coalesce(status, 'Pending') = 'Pending' and due_date <= $2 order by due_date limit 15", [BOOK, addDays(t, 7)]);
  return { today: t, items, compliance: comp.map((x) => ({ ...x, late: Math.max(0, days(x.due_date, t)) })), needBill: needBill.slice(0, 25).map((p) => ({ ref_id: p.ref_id, id: p.id, txn_date: p.txn_date, payee: p.payee, amount: n(p.amount), head: p.head, needs: p.needs })), balances: bal };
}

// ---------- money by unit, from the bank registers (the Bookings / Unit Receipts / GST / SDR tabs) ----------
async function unitMoney() {
  const rec = await db.q(`select unit_no, payment_head, payer_type, cheque_status, sum(amount) as amt, count(*)::int as k from acc_receipts
                           where book = $1 and coalesce(unit_no, '') <> '' and coalesce(payment_head, '') <> '' group by 1, 2, 3, 4`, [BOOK]);
  const pay = await db.q("select unit_no, head, sum(amount) as amt from acc_payments where book = $1 and coalesce(unit_no, '') <> '' group by 1, 2", [BOOK]);
  const tds = await db.q('select unit_no, sum(tds_amount) as amt from acc_tds_entries where book = $1 group by 1', [BOOK]);
  const M = {};
  const u = (k) => (M[k] ||= { av: 0, gst: 0, sdr: 0, unclassified: 0, other: 0, bounced: 0, receipts: 0, sdrPaid: 0, refunds: 0, cp: 0, tds: 0 });
  for (const r of rec) {
    const x = u(r.unit_no);
    if (r.cheque_status === 'Bounced') { x.bounced += n(r.amt); continue; }
    x.receipts += r.k;
    if (r.payer_type === 'Other / earlier buyer') { x.other += n(r.amt); continue; }
    const h = { AV: 'av', GST: 'gst', SDR: 'sdr' }[r.payment_head] || 'unclassified'; x[h] += n(r.amt);
  }
  for (const p of pay) { const x = u(p.unit_no); if (p.head === 'SDR') x.sdrPaid += n(p.amt); else if (p.head === 'Flat - Cancelled Refunded') x.refunds += n(p.amt); else if (/commission/i.test(p.head || '')) x.cp += n(p.amt); }
  for (const t of tds) u(t.unit_no).tds += n(t.amt);
  return M;
}
async function unitsWithBookings(projectId) {
  return db.q(`select u.unit_no, u.sheet_status, u.status as ustatus, b.id as booking_id, b.agreement_value, b.gst_rate, b.stamp_duty, b.registration_fee, b.registration_status, b.registration_date,
                      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id and a.seq = 1) as applicant,
                      bb.received_av as crm_av, bb.received_gst as crm_gst, bb.received_sdr as crm_sdr, bb.received_tds as crm_tds
                 from units u join buildings bl on bl.id = u.building_id left join bookings b on b.unit_id = u.id and b.status = 'active' left join booking_balances bb on bb.booking_id = b.id
                where u.project_id = $1 and bl.kind <> 'rehab' order by u.unit_no`, [projectId]);
}

// ---------- Checks ----------
async function checks(projectId) {
  const out = [];
  const add = (check, figure, result, means) => out.push({ check, figure, result, means });
  const H = await headMap();
  const usedR = await db.q("select distinct head from acc_receipts where book = $1 and coalesce(head, '') <> ''", [BOOK]);
  const usedP = await db.q("select distinct head from acc_payments where book = $1 and coalesce(head, '') <> ''", [BOOK]);
  const newR = usedR.map((x) => x.head).filter((h) => !H.receipt[h]), newP = usedP.map((x) => x.head).filter((h) => !H.payment[h]);
  add('Every receipt head used is on the head map (CA Settings)', newR.length, newR.length ? 'Check' : 'OK', newR.length ? 'Not on the head map: ' + newR.slice(0, 8).join(', ') : 'All heads are set up.');
  add('Every payment head used is on the head map (CA Settings)', newP.length, newP.length ? 'Check' : 'OK', newP.length ? 'Not on the head map: ' + newP.slice(0, 8).join(', ') : 'All heads are set up.');
  const bad = await db.one(`select count(*)::int as n from acc_receipts where book = $1 and coalesce(unit_no, '') <> '' and unit_no !~ '^[A-Z]{1,2}-[0-9]{3,5}$'`, [BOOK]);
  add('Units are in Wing-Number format (A-1001)', bad.n, bad.n ? 'Check' : 'OK', 'No DI- prefix or spaces.');
  const noUnit = await db.one("select count(*)::int as n, coalesce(sum(amount), 0) as amt from acc_receipts where book = $1 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = '' and coalesce(cheque_status, '') <> 'Bounced'", [BOOK]);
  add('Customer receipts all carry a unit', noUnit.n, noUnit.n ? 'Check' : 'OK', noUnit.n ? `${noUnit.n} receipts (₹${r0(noUnit.amt).toLocaleString('en-IN')}) have a payment head but no unit.` : '');
  if (projectId) {
    const units = new Set((await db.q('select unit_no from units where project_id = $1', [projectId])).map((x) => x.unit_no));
    const notIn = (await db.q("select distinct unit_no from acc_receipts where book = $1 and coalesce(unit_no, '') <> ''", [BOOK])).map((x) => x.unit_no).filter((x) => !units.has(x));
    add('Every unit in Receipts exists in the ERP', notIn.length, notIn.length ? 'Check' : 'OK', notIn.length ? 'Units not in the ERP: ' + notIn.slice(0, 10).join(', ') : '');
    const M = await unitMoney();
    const bk = (await unitsWithBookings(projectId)).filter((x) => x.booking_id);
    const bankAv = bk.reduce((a, x) => a + ((M[x.unit_no] || {}).av || 0), 0), crmAv = bk.reduce((a, x) => a + n(x.crm_av), 0);
    add('CRM AV received (ERP customer ledgers) vs bank AV received from current buyers', Math.round(bankAv - crmAv), 'For review', `Bank ₹${r0(bankAv).toLocaleString('en-IN')} against CRM ₹${r0(crmAv).toLocaleString('en-IN')}. Not expected to be zero; explained unit by unit on the GST and Unit receipts reports.`);
  }
  const bal = await balances(istToday());
  for (const r of bal.rows.filter((x) => x.difference != null)) add(`Daily Bank Balance agrees with the bank: ${r.bank}`, r.difference, Math.abs(r.difference) <= 1 ? 'OK' : 'Check', 'Closing per entries against the balance the bank shows.');
  const dupe = await db.q("select reference, txn_date, amount, count(*)::int as k from acc_receipts where book = $1 and coalesce(reference, '') <> '' and coalesce(payment_head, '') = '' group by 1, 2, 3 having count(*) > 1 limit 20", [BOOK]);
  add('No receipt entered twice (same reference, date and amount, not a split cheque)', dupe.length, dupe.length ? 'Check' : 'OK', dupe.length ? 'For example ' + dupe.slice(0, 3).map((x) => x.reference).join(', ') : '');
  return out;
}

// ---------- reports ----------
const FY = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; };
const monthsOfFy = (y) => Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1, yr = m >= 4 ? y : y + 1; return `${yr}-${String(m).padStart(2, '0')}`; });

async function report(name, opts = {}) {
  if (name === 'byHead') {
    const months = (await db.q("select distinct to_char(txn_date, 'YYYY-MM') as m from (select txn_date from acc_receipts where book = $1 union all select txn_date from acc_payments where book = $1) x order by 1", [BOOK])).map((x) => x.m);
    const grid = async (table, extra) => {
      const rows = await db.q(`select coalesce(nullif(head, ''), '(no head)') as head, to_char(txn_date, 'YYYY-MM') as m, sum(amount) as amt from ${table} where book = $1 ${extra} group by 1, 2`, [BOOK]);
      const H = {}; for (const r of rows) { (H[r.head] ||= { head: r.head, total: 0 })[r.m] = n(r.amt); H[r.head].total += n(r.amt); }
      return Object.values(H).sort((a, b) => b.total - a.total);
    };
    return { months, receipts: await grid('acc_receipts', "and coalesce(cheque_status, '') <> 'Bounced'"), payments: await grid('acc_payments', '') };
  }
  if (name === 'gst' || name === 'sdr' || name === 'units') {
    const M = await unitMoney();
    const rows = (await unitsWithBookings(opts.projectId)).map((u) => {
      const m = M[u.unit_no] || {}, av = n(u.agreement_value), gstPay = Math.round(av * n(u.gst_rate || 5)) / 100;
      const base = { unit: u.unit_no, applicant: u.applicant || '', status: u.sheet_status || u.ustatus, av };
      if (name === 'gst') {
        const due = av ? (m.av || 0) * gstPay / av : 0, short = (due || 0) - (m.gst || 0);
        return { ...base, gstPayable: gstPay, avReceived: m.av || 0, gstDueOnReceived: Math.round(due), gstReceived: m.gst || 0, shortfall: Math.round(short), outstanding: Math.round(gstPay - (m.gst || 0)), crm: n(u.crm_gst),
          state: !av ? 'No booking value' : short > 100 ? 'GST short on received' : 'OK so far' };
      }
      if (name === 'sdr') {
        const payable = n(u.stamp_duty) + n(u.registration_fee), rec = m.sdr || 0, paid = m.sdrPaid || 0;
        return { ...base, registration: u.registration_status || (u.registration_date ? 'Done' : ''), stampDuty: n(u.stamp_duty), registrationFee: n(u.registration_fee), payable, received: rec, paidOut: paid,
          held: rec - paid, toCollect: payable - rec, crm: n(u.crm_sdr), state: !payable ? 'No SDR amount' : rec >= payable - 10 ? 'SDR fully received' : rec ? 'SDR part received' : 'SDR pending' };
      }
      return { ...base, avReceived: m.av || 0, gstReceived: m.gst || 0, sdrReceived: m.sdr || 0, unclassified: m.unclassified || 0, other: m.other || 0, bounced: m.bounced || 0, receipts: m.receipts || 0,
        pct: av ? Math.round(((m.av || 0) / av) * 1000) / 10 : 0, tds: m.tds || 0, sdrPaid: m.sdrPaid || 0, refunds: m.refunds || 0, cp: m.cp || 0, crmAv: n(u.crm_av), diff: Math.round((m.av || 0) - n(u.crm_av)) };
    });
    return { rows };
  }
  if (name === 'payees') {
    const H = await headMap();
    const pays = await db.q('select payee, head, amount, vendor_pan, vendor_gstin, total_bill, tds_deducted from acc_payments where book = $1', [BOOK]);
    const P = {};
    for (const p of pays) {
      const k = p.payee || '(no payee)', x = (P[k] ||= { payee: k, pan: '', gstin: '', heads: {}, n: 0, paid: 0, billed: 0, tds: 0 });
      x.n++; x.paid += n(p.amount); x.billed += n(p.total_bill); x.tds += n(p.tds_deducted); x.heads[p.head || ''] = (x.heads[p.head || ''] || 0) + 1;
      if (p.vendor_pan) x.pan = p.vendor_pan; if (p.vendor_gstin) x.gstin = p.vendor_gstin;
    }
    return { rows: Object.values(P).map((x) => { const usual = Object.entries(x.heads).sort((a, b) => b[1] - a[1])[0]?.[0] || '', h = H.payment[usual] || {};
      return { payee: x.payee, type: h.payee_type || '', pan: x.pan, gstin: x.gstin, tdsSection: h.tds_section || '', usualHead: usual, needsInvoice: h.needs_bill ? 'Yes' : 'No', n: x.n, paid: x.paid, billed: x.billed, tds: x.tds, balance: x.billed - x.paid - x.tds }; })
      .sort((a, b) => b.paid - a.paid) };
  }
  if (name === 'vendorBills') {
    const H = await headMap();
    const rows = (await db.q('select * from acc_payments where book = $1 order by txn_date desc, id desc', [BOOK])).filter((p) => (H.payment[p.head] || {}).needs_bill)
      .map((p) => ({ ...p, needs: billNeeds(p, H.payment[p.head]), tdsSectionUsual: H.payment[p.head].tds_section, tdsRateUsual: H.payment[p.head].tds_rate }));
    return { rows };
  }
  if (name === 'register') {
    const y = opts.fy ? +opts.fy : FY(istToday()), months = monthsOfFy(y), head = opts.head || 'Salary';
    const rows = await db.q(`select coalesce(nullif(payee, ''), '(no payee)') as payee, max(vendor_pan) as pan, to_char(txn_date, 'YYYY-MM') as m, sum(amount) as amt from acc_payments
                              where book = $1 and head = $2 and txn_date between $3 and $4 group by 1, 3`, [BOOK, head, `${y}-04-01`, `${y + 1}-03-31`]);
    const P = {}; for (const r of rows) { const x = (P[r.payee] ||= { payee: r.payee, pan: r.pan || '', total: 0 }); x[r.m] = n(r.amt); x.total += n(r.amt); }
    return { head, fy: y, months, rows: Object.values(P).sort((a, b) => b.total - a.total) };
  }
  if (name === 'bounced') return { rows: await db.q("select * from acc_receipts where book = $1 and cheque_status = 'Bounced' order by txn_date desc", [BOOK]) };
  if (name === 'tds') {
    const bk = await db.q("select u.unit_no, b.agreement_value from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'active'", [opts.projectId]);
    const paid = Object.fromEntries((await db.q('select unit_no, sum(tds_amount) as amt from acc_tds_entries where book = $1 group by 1', [BOOK])).map((x) => [x.unit_no, n(x.amt)]));
    const rate = 0.01;
    const rows = bk.map((b) => { const due = Math.round(n(b.agreement_value) * rate), p = paid[b.unit_no] || 0; return { unit: b.unit_no, due, paid: p, balance: due - p }; });
    return { rate, due: rows.reduce((a, r) => a + r.due, 0), paid: rows.reduce((a, r) => a + r.paid, 0), flats: rows.length, full: rows.filter((r) => r.balance <= 1).length,
      part: rows.filter((r) => r.paid > 0 && r.balance > 1).length, none: rows.filter((r) => !r.paid).length, rows };
  }
  throw fail(400, 'Unknown report.');
}

// ---------- Tally: receipts and payments as Tally vouchers (XML for Import Data, and a CSV day book) ----------
async function tally(from, to, format) {
  const r = await db.q("select 'Receipt' as vtype, ref_id, txn_date, bank, coalesce(nullif(head, ''), 'Suspense') as ledger, amount, description, reference, unit_no, payment_head from acc_receipts where book = $1 and txn_date between $2 and $3 and coalesce(cheque_status, '') <> 'Bounced'", [BOOK, from, to]);
  const p = await db.q("select 'Payment' as vtype, ref_id, txn_date, bank, coalesce(nullif(head, ''), 'Suspense') as ledger, amount, description, reference, unit_no, payee from acc_payments where book = $1 and txn_date between $2 and $3", [BOOK, from, to]);
  const all = [...r, ...p].sort((a, b) => (a.txn_date + a.ref_id).localeCompare(b.txn_date + b.ref_id));
  const narr = (v) => [v.unit_no, v.payment_head, v.payee, v.reference, v.description].filter(Boolean).join(' | ').slice(0, 400);
  if (format === 'csv') {
    const q = (s) => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return ['Date,Voucher Type,Voucher No,Ledger,Bank Ledger,Amount,Narration', ...all.map((v) => [v.txn_date, v.vtype, v.ref_id || '', v.ledger, v.bank, n(v.amount).toFixed(2), narr(v)].map(q).join(','))].join('\n');
  }
  const x = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const v = (e) => {
    const d = e.txn_date.replace(/-/g, ''), amt = n(e.amount).toFixed(2), rec = e.vtype === 'Receipt';
    // Tally: in a Receipt the bank is debited (negative amount, ISDEEMEDPOSITIVE Yes) and the party/head ledger credited; the reverse for a Payment.
    const line = (ledger, debit) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${x(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? '-' : ''}${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${e.vtype}" ACTION="Create"><DATE>${d}</DATE><VOUCHERTYPENAME>${e.vtype}</VOUCHERTYPENAME><VOUCHERNUMBER>${x(e.ref_id || '')}</VOUCHERNUMBER><NARRATION>${x(narr(e))}</NARRATION>${rec ? line(e.bank, true) + line(e.ledger, false) : line(e.ledger, true) + line(e.bank, false)}</VOUCHER></TALLYMESSAGE>`;
  };
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>\n${all.map(v).join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

module.exports = { BOOK, lists, cleanRow, nextRef, list, withCalc, balances, todo, checks, report, tally, billNeeds, rentYear, headMap };
