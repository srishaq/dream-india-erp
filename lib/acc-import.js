// Import from the "Dream Signature Master Accounts - FINAL" sheet: every tab the accounts team types into,
// plus the lists (banks, cash flow heads) and the CA Settings head map. parse() is pure; commit() replaces
// everything that came from an earlier import and leaves rows entered in the ERP alone.
const { REGISTERS } = require('./acc-schema');
const { toDate, toNum } = require('./import-crm');

const SHEET_ID = process.env.ACCOUNTS_SHEET_ID || '1lUPGbGAkOukWUwHUcXHUb_j1RTrBj1qfP4qQU1D4AGQ';
const TABS = {
  receipts: ['Receipts', 'A:R'], payments: ['Payments Out', 'A:AB'], daily: ['Daily Bank Balance', 'A:I'], pdc: ['PDC', 'A:J'], tds: ['TDS Tracker', 'M:AA'],
  recon: ['Reconciling Items', 'A:P'], compliance: ['Compliance Calendar', 'A:J'], ca: ['CA Settings', 'A:J'], lists: ['Lists', 'A:I'],
  tenants: ['SRA Tenants', 'A:X'], rentLinks: ['Tenant Rent Links', 'A:M'], cp: ['CP Commissions', 'A:W'],
};

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const loose = (s) => clean(s).toLowerCase().replace(/[^a-z0-9%]/g, '');
const blank = (s) => !clean(s);

// Finds the heading row (the first row containing `first` in some cell) and returns objects keyed by heading.
function rowsAfter(grid, first, { stopAt } = {}) {
  const at = (grid || []).findIndex((r) => (r || []).some((c) => loose(c) === loose(first)));
  if (at < 0) return [];
  const head = grid[at].map(loose);
  const out = [];
  for (let i = at + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    if (stopAt && stopAt(r)) break;
    if (!r.some((c) => !blank(c))) continue;
    const o = { _row: i + 1 }; head.forEach((h, j) => { if (h && !(h in o)) o[h] = r[j]; });
    out.push(o);
  }
  return out;
}

function value(c, v) {
  if (blank(v)) return null;
  if (c.type === 'date') return toDate(v);
  if (c.type === 'money' || c.type === 'num') { const x = toNum(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
  if (c.type === 'pct') { if (typeof v === 'number') return v > 1 ? v / 100 : v; const x = toNum(v); return Number.isFinite(x) ? (x > 1 ? x / 100 : x) : null; }
  let s = clean(v);
  if (c.unit) s = s.toUpperCase().replace(/\s/g, '').replace(/^DI-/, '');
  return s.slice(0, c.type === 'long' ? 1000 : 300);
}

function register(regKey, objs, refHeading) {
  const reg = REGISTERS[regKey];
  const rows = [], skipped = [];
  for (const o of objs) {
    const r = {};
    for (const c of reg.cols) if (!c.calc) r[c.key] = value(c, o[loose(c.label)]);
    if (reg.prefix) r.ref_id = blank(o[loose(refHeading || reg.idLabel)]) ? null : clean(o[loose(refHeading || reg.idLabel)]);
    // Every row comes in as it is on the sheet; gaps in required columns are listed so the team can fill them in the ERP.
    const missing = reg.cols.filter((c) => c.required && !c.calc && r[c.key] == null).map((c) => c.label);
    if (missing.length) skipped.push({ row: o._row, why: `missing ${missing.join(', ')}` });
    rows.push(r);
  }
  return { rows, skipped };
}

function parse(tabs) {
  const out = { registers: {}, skipped: {}, masters: {} };
  const put = (k, res) => { out.registers[k] = res.rows; out.skipped[k] = res.skipped; };
  put('receipts', register('receipts', rowsAfter(tabs.receipts, 'Receipt ID')));
  put('payments', register('payments', rowsAfter(tabs.payments, 'Payment ID')));
  put('pdc', register('pdc', rowsAfter(tabs.pdc, 'Cheque issued to')));
  put('tds', register('tds', rowsAfter(tabs.tds, 'Entry ID')));
  put('recon', register('recon', rowsAfter(tabs.recon, 'Item #')));
  put('compliance', register('compliance', rowsAfter(tabs.compliance, 'Compliance')));
  put('tenants', register('tenants', rowsAfter(tabs.tenants, 'Survey No').filter((o) => !/total/i.test(clean(o.surveyno)))));
  // Rent 2025 is normally monthly rent × months; keep the sheet's figure only where it was agreed differently.
  for (const r of out.registers.tenants) if (r.rent_2025 != null && Math.abs(r.rent_2025 - Math.round((r.monthly_rent || 0) * (r.months || 0))) <= 1) r.rent_2025 = null;
  put('rentLinks', register('rentLinks', rowsAfter(tabs.rentLinks, 'Payment ID')));
  // Reconciling Items: the sheet calls the bank column "Account"
  // Daily Bank Balance: the summary block (banks, brought-forward balances, groups) and the DAILY ENTRIES block.
  const D = tabs.daily || [];
  const entriesAt = D.findIndex((r) => /daily entries/i.test(clean((r || [])[0])));
  const top = entriesAt > 0 ? D.slice(0, entriesAt) : D;
  const bfNote = D.map((r) => clean((r || []).join(' '))).find((s) => /brought forward on/i.test(s)) || '';
  const bfDate = toDate((bfNote.match(/brought forward on\s+([\d-]+)/i) || [])[1] || '');
  const reportDate = toDate(((D[1] || [])[1]));
  const banks = []; let pending = [];
  for (const o of rowsAfter(top, 'Bank')) {
    const name = clean(o.bank); if (!name) continue;
    const grp = name.match(/^(.*)\s*-\s*total$/i);
    if (grp) { pending.forEach((b) => (b.grp = clean(grp[1]))); pending = []; continue; }
    if (/^grand total$/i.test(name)) break;
    const b = { name, account_no: blank(o.acno) ? null : clean(o.acno), bf_balance: toNum(o.balancebfon) || 0, bf_date: bfDate, grp: 'OTHER', seq: banks.length + 1,
      stated: blank(o.balanceperbank) ? null : toNum(o.balanceperbank), closing: toNum(o.closingbalance) };
    banks.push(b); pending.push(b);
  }
  out.masters.dailyBanks = banks; out.masters.reportDate = reportDate;
  put('daily', register('daily', entriesAt >= 0 ? rowsAfter(D.slice(entriesAt), 'Date') : []));
  // Lists: bank accounts, receipt heads, payment heads
  const L = tabs.lists || [];
  const col = (i) => L.slice(1).map((r) => clean((r || [])[i])).filter(Boolean);
  const Lh = (L[0] || []).map(loose);
  const idx = (name) => Lh.indexOf(loose(name));
  out.masters.banks = idx('Bank Account') >= 0 ? col(idx('Bank Account')) : [];
  const recHeads = idx('Receipt Heads') >= 0 ? col(idx('Receipt Heads')) : [], payHeads = idx('Payment Heads') >= 0 ? col(idx('Payment Heads')) : [];
  // CA Settings HEAD MAP
  const map = rowsAfter(tabs.ca || [], 'Cash Flow Section');
  const heads = {};
  const key = (side, name) => side + '|' + name;
  for (const name of recHeads) heads[key('receipt', name)] = { side: 'receipt', name };
  for (const name of payHeads) heads[key('payment', name)] = { side: 'payment', name };
  for (const o of map) {
    const side = /receipt/i.test(clean(o.side)) ? 'receipt' : /payment/i.test(clean(o.side)) ? 'payment' : null, name = clean(o.cashflowhead);
    if (!side || !name) continue;
    const rate = blank(o.tdsrate) ? null : (typeof o.tdsrate === 'number' ? o.tdsrate : toNum(o.tdsrate));
    heads[key(side, name)] = { side, name, section: clean(o.cashflowsection) || null, indirect_line: clean(o.indirectmethodline) || null, tds_section: clean(o.tdssection) || null,
      tds_rate: rate == null || !Number.isFinite(rate) ? null : rate > 1 ? rate / 100 : rate, category: clean(o.nonrevenuecategory) || null, note: clean(o.note) || null,
      needs_bill: /^yes/i.test(clean(o[Object.keys(o).find((k) => k.startsWith('needsabill')) || 'needsabill'])), payee_type: clean(o[Object.keys(o).find((k) => k.startsWith('payeetype')) || 'payeetype']) || null };
  }
  // heads typed in the registers but missing from the lists still have to exist, or the rows could not be edited
  for (const r of out.registers.receipts) if (r.head && !heads[key('receipt', r.head)]) heads[key('receipt', r.head)] = { side: 'receipt', name: r.head, note: 'Found in Receipts, not on the Lists tab' };
  for (const r of out.registers.payments) if (r.head && !heads[key('payment', r.head)]) heads[key('payment', r.head)] = { side: 'payment', name: r.head, note: 'Found in Payments Out, not on the Lists tab' };
  out.masters.heads = Object.values(heads);
  for (const k of ['receipts', 'payments', 'pdc', 'recon']) for (const r of out.registers[k]) if (r.bank && !out.masters.banks.includes(r.bank)) out.masters.banks.push(r.bank);
  // CP Commissions: brokerage released and the ladder amount per flat
  out.cp = rowsAfter(tabs.cp || [], 'Unit').map((o) => ({ unit: clean(o.unit).toUpperCase(), released: toNum(o.totalreleased) || 0, ladder: toNum(o.brokeragepayableladderamt) || 0, firm: clean(o.cpfirm), ladderPct: clean(o['brokerageladder%']) }))
    .filter((x) => /^[A-Z]-\d+$/.test(x.unit));
  const sum = (a, f) => Math.round(a.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  out.summary = {
    receipts: out.registers.receipts.length, receiptsAmount: sum(out.registers.receipts, (r) => r.amount),
    receiptsCleared: sum(out.registers.receipts.filter((r) => r.cheque_status !== 'Bounced'), (r) => r.amount),
    payments: out.registers.payments.length, paymentsAmount: sum(out.registers.payments, (r) => r.amount),
    daily: out.registers.daily.length, pdc: out.registers.pdc.length, tds: out.registers.tds.length, tdsAmount: sum(out.registers.tds, (r) => r.tds_amount),
    recon: out.registers.recon.length, compliance: out.registers.compliance.length, tenants: out.registers.tenants.length, rentLinks: out.registers.rentLinks.length,
    banks: out.masters.banks.length, dailyBanks: banks.length, heads: out.masters.heads.length, cp: out.cp.length, cpReleased: sum(out.cp, (x) => x.released),
    gaps: Object.fromEntries(Object.entries(out.skipped).map(([k, v]) => [k, v.length])), reportDate,
  };
  return out;
}

async function commit(t, p, { user, projectId }) {
  const BOOK = 'signature';
  for (const name of p.masters.banks) await t.q('insert into acc_banks (book, name) values ($1, $2) on conflict (book, name) do nothing', [BOOK, name]);
  for (const b of p.masters.dailyBanks) {
    await t.q(`insert into acc_daily_banks (book, name, account_no, grp, seq, bf_balance, bf_date, auto_from_statement) values ($1, $2, $3, $4, $5, $6, $7, $8)
               on conflict (book, name) do update set account_no = excluded.account_no, grp = excluded.grp, seq = excluded.seq, bf_balance = excluded.bf_balance, bf_date = excluded.bf_date`,
    [BOOK, b.name, b.account_no, b.grp, b.seq, b.bf_balance, b.bf_date, /^prime/i.test(b.name)]);
  }
  for (const h of p.masters.heads) {
    await t.q(`insert into acc_heads (book, side, name, section, indirect_line, tds_section, tds_rate, category, note, needs_bill, payee_type) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               on conflict (book, side, name) do update set section = coalesce(excluded.section, acc_heads.section), indirect_line = coalesce(excluded.indirect_line, acc_heads.indirect_line),
               tds_section = coalesce(excluded.tds_section, acc_heads.tds_section), tds_rate = coalesce(excluded.tds_rate, acc_heads.tds_rate), category = coalesce(excluded.category, acc_heads.category),
               note = coalesce(excluded.note, acc_heads.note), needs_bill = excluded.needs_bill or acc_heads.needs_bill, payee_type = coalesce(excluded.payee_type, acc_heads.payee_type)`,
    [BOOK, h.side, h.name, h.section || null, h.indirect_line || null, h.tds_section || null, h.tds_rate == null ? null : h.tds_rate, h.category || null, h.note || null, !!h.needs_bill, h.payee_type || null]);
  }
  const counts = {};
  for (const [k, rows] of Object.entries(p.registers)) {
    const reg = REGISTERS[k];
    await t.q(`delete from ${reg.table} where book = $1 and imported`, [BOOK]);
    const cols = reg.cols.filter((c) => !c.calc).map((c) => c.key).concat(reg.prefix ? ['ref_id'] : []);
    const SQLT = { text: 'text', long: 'text', date: 'date', money: 'numeric', num: 'numeric', pct: 'numeric', yesno: 'text', list: 'text' };
    const types = cols.map((c) => (c === 'ref_id' ? 'text' : SQLT[reg.cols.find((x) => x.key === c).type]));
    // a reference already used by a row entered in the ERP keeps the ERP row; the sheet row comes in without it
    if (reg.prefix) {
      const taken = new Set((await t.q(`select ref_id from ${reg.table} where book = $1 and ref_id is not null`, [BOOK])).map((x) => x.ref_id));
      const seen = new Set();
      for (const r of rows) { if (r.ref_id && (taken.has(r.ref_id) || seen.has(r.ref_id))) r.ref_id = null; if (r.ref_id) seen.add(r.ref_id); }
    }
    for (let i = 0; i < rows.length; i += 2000) {
      await t.q(`insert into ${reg.table} (book, imported, created_by, ${cols.join(', ')})
                 select $1, true, $2, ${cols.map((c) => 'x.' + c).join(', ')} from json_to_recordset($3::json) as x(${cols.map((c, j) => `${c} ${types[j]}`).join(', ')})`,
      [BOOK, user.id, JSON.stringify(rows.slice(i, i + 2000))]);
    }
    counts[k] = rows.length;
  }
  if (p.masters.reportDate) {
    for (const b of p.masters.dailyBanks.filter((x) => x.stated != null)) {
      await t.q(`insert into acc_bank_stated (daily_bank_id, on_date, balance, created_by) select id, $3, $4, $5 from acc_daily_banks where book = $1 and name = $2
                 on conflict (daily_bank_id, on_date) do update set balance = excluded.balance`, [BOOK, b.name, p.masters.reportDate, b.stated, user.id]);
    }
  }
  // CP Commissions: what has been released is brokerage paid; the ladder amount is the brokerage payable.
  let cp = 0;
  if (projectId && p.cp.length) {
    await t.q("delete from brokerage_entries where kind = 'payment' and reference = 'CP Commissions tab (accounts sheet)'");
    for (const x of p.cp) {
      const b = await t.one("select b.id, b.brokerage, b.booking_date from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and u.unit_no = $2 and b.status = 'active'", [projectId, x.unit]);
      if (!b) continue;
      if (x.ladder > 0) await t.q('update bookings set brokerage = $2 where id = $1', [b.id, x.ladder]);
      if (x.released > 0) { await t.q("insert into brokerage_entries (booking_id, kind, entry_date, amount, reference, note, created_by) values ($1, 'payment', $2, $3, 'CP Commissions tab (accounts sheet)', $4, $5)", [b.id, '2026-09-30', x.released, `Released per the accounts sheet${x.ladderPct ? '; ladder ' + x.ladderPct : ''}`, user.id]); cp++; }
    }
  }
  return { counts, cp };
}

module.exports = { SHEET_ID, TABS, parse, commit, rowsAfter };
