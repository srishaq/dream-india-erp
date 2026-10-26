// Bank statements: read the statement files the accounts team keeps (HDFC and Yes Bank layouts), match every line to
// Receipts / Payments Out, add what is missing, write the Daily Bank Balance entries and list the differences.
// This is the sheet's "Bank Auto Check" (run every day at 3:10 pm; uploads by 3 pm), done by the ERP.
const xlsx = require('./xlsx');

// Which bank a statement file belongs to, and what is recorded from it. Tested in this order (file name + tab name).
//  receipts / payments: whether missing credit / debit lines are added to Receipts / Payments Out.
//  hold: lines are not added at all, and the total held back is listed (waiting for a decision).
const BANKS = [
  { key: 'hdfcmisc', test: /misc|9046/i, ledger: 'Prime HDFC Misc', daily: 'PRIME HDFC MISC', receipts: false, payments: false,
    hold: 'Money sent into this account is already booked as SDR / Office Expense. Not added, so nothing is counted twice. Mr Syed to decide how Misc is recorded.' },
  { key: 'hdfc8650', test: /8650/, ledger: 'Prime HDFC (8650)', daily: 'PRIME HDFC', receipts: true, payments: true },
  { key: 'rera501', test: /\b0?501\b|30\s*%/i, ledger: 'Yes RERA 30% (0501)', daily: 'PRIME RERA 30%', receipts: false, payments: true,
    note: 'Payments only. Money swept in from 0700 is not recorded (by design).' },
  { key: 'rera800', test: /\b0?800\b|70\s*%/i, ledger: 'Yes RERA Collection 70% (0800)', daily: 'PRIME RERA 70%', receipts: false, payments: false,
    note: 'Not kept in the master. Sweeps only, shown for information.' },
  { key: 'rera700', test: /\b0?700\b|100\s*%|rera statement|collection/i, ledger: 'Yes RERA Collection 100% (0700)', daily: 'PRIME RERA COLLECTION 100%', receipts: true, payments: true, payHead: 'AV',
    sweeps: /XX0501|XX0800|0+92872400000501|0+92872500000800/ },
  { key: 'gst131', test: /\b0?131\b|gst/i, ledger: 'Yes GST (0131)', daily: 'PRIME GST', receipts: true, payments: true, payHead: 'GST' },
  { key: 'sdr111', test: /\b0?111\b|sdr/i, ledger: 'Yes 111 / SDR (0111)', daily: 'PRIME 111 SDR', receipts: true, payments: true, payHead: 'SDR' },
];
const bankFor = (fileName, sheetName) => BANKS.find((b) => b.test.test(`${fileName || ''} ${sheetName || ''}`)) || null;

// ---------- values ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const yr = (y) => (y < 100 ? 2000 + y : y);
// Statement dates come as real dates, Excel serials, '22-01-2026 15:49:39', '27/01/2026 8:00', '02/05/26', '22-OCT-26'.
// Returns { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } or null. Day comes first (Indian banks).
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const t = xlsx.serialToText(v); return parseDate(t);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return ok(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return ok(yr(+m[3]), +m[2], +m[1], m[4], m[5], m[6]);
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})/);
  if (m && MON[m[2].toLowerCase()]) return ok(yr(+m[3]), MON[m[2].toLowerCase()], +m[1]);
  return null;
}
function ok(y, mo, d, h, mi, se) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2015 && y <= 2100)) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: h != null ? `${pad(+h)}:${mi}:${se || '00'}` : '' };
}
const money = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
// Cheque / reference numbers: drop leading zeros; numbers Excel has already mangled (1.00026e+28) are no use.
const refNorm = (v) => {
  if (v == null) return '';
  if (typeof v === 'number') { if (!v || v > 1e15 || !Number.isInteger(v)) return ''; return String(v); }
  const s = String(v).trim().replace(/\.0+$/, '');
  if (/e\+/i.test(s)) return '';
  return s.replace(/^0+(?=.)/, '') === '0' ? '' : s.replace(/^0+(?=.)/, '');
};
const unitNorm = (v) => {
  const m = String(v || '').toUpperCase().replace(/\s+/g, '').match(/^([AB])[-/]?(\d{3,4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
};
const isReturn = (desc) => /\b(RETURN|RTN|RETN|RET|BOUNCE|BOUNCED|REJECT|REVERSAL|REVERSED|INWARD RETURN|CHQ RET)\b/i.test(desc || '');

// ---------- layouts ----------
const H = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]/g, '');
const HEAD = {
  date: ['txndate', 'date', 's', 'transactiondate', 'trandate'],
  valueDate: ['valuedate', 'valuedt'],
  desc: ['description', 'narration', 'particulars'],
  ref: ['chqrefno', 'chequeno', 'chqno', 'refno', 'referenceno'],
  dr: ['withdrawalamt', 'outward', 'debit', 'withdrawal', 'dr'],
  cr: ['depositamt', 'inward', 'credit', 'deposit', 'cr'],
  amount: ['amount'], drcr: ['drcr', 'crdr', 'type'],
  balance: ['closingbalance', 'runningtotal', 'balance'],
  flat: ['flatno', 'flat', 'unit', 'unitno'], name: ['tallyname', 'clientname', 'customername', 'name'], team: ['collectionteam', 'team'],
};
// Finds the heading row (within the first 15 rows) and the column of each field.
function layout(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const hs = (rows[r] || []).map(H);
    const col = {};
    for (const [k, names] of Object.entries(HEAD)) {
      for (const n of names) { const i = hs.indexOf(n); if (i >= 0 && !Object.values(col).includes(i)) { col[k] = i; break; } }
    }
    // The 70% statement's heading for the transaction date is just "s".
    if (col.desc != null && (col.date != null || col.valueDate != null) && ((col.dr != null && col.cr != null) || (col.amount != null && col.drcr != null))) {
      if (col.date == null) col.date = col.valueDate;
      return { header: r, col };
    }
  }
  return null;
}

/**
 * Reads one statement file. Returns { bank, sheet, lines:[{row, date, time, desc, ref, dr, cr, balance, flat, name, team}], from, to, closing:{date:balance} }
 * or { error } when the file cannot be read or the bank is not recognised.
 */
function parseFile(buf, fileName) {
  let sheets;
  try { sheets = xlsx.read(buf); } catch (e) { return { file: fileName, error: e.message }; }
  for (const sh of sheets) {
    const L = layout(sh.rows); if (!L) continue;
    const bank = bankFor(fileName, sh.name);
    if (!bank) return { file: fileName, sheet: sh.name, error: 'Could not tell which bank account this statement is for. Put the account number (for example 8650, 0700, 0131, 0111, 0501, 0800 or Misc) in the file name.' };
    const c = L.col; const lines = [];
    for (let r = L.header + 1; r < sh.rows.length; r++) {
      const row = sh.rows[r] || [];
      const rawD = row[c.date] != null && row[c.date] !== '' ? row[c.date] : (c.valueDate != null ? row[c.valueDate] : null);
      let d = parseDate(rawD);
      // "########" (column too narrow when the file was saved): the date is lost; take it from the description
      // (CHQ DEP UBI 12-OCT-26) or, failing that, from the line above.
      if (!d && rawD != null && /^#+$/.test(String(rawD).trim())) {
        const m = String(row[c.desc] || '').match(/\b(\d{1,2}-[A-Za-z]{3}-\d{2,4})\b/);
        d = (m && parseDate(m[1])) || { date: null, time: '' };
        d.guessed = true;
      }
      if (!d) continue;
      // A date Excel stored as a real date with day 1-12 may have day and month swapped (typed 05/10/26, read as May 10).
      const realCell = typeof rawD === 'number' || /^\d{4}-\d{2}-\d{2}/.test(String(rawD));
      const dd = d.date ? +d.date.slice(8, 10) : 0, mm = d.date ? +d.date.slice(5, 7) : 0;
      d.alt = realCell && d.date && dd <= 12 && dd !== mm ? `${d.date.slice(0, 4)}-${pad(dd)}-${pad(mm)}` : null;
      let dr = 0, cr = 0;
      if (c.dr != null && c.cr != null) { dr = money(row[c.dr]); cr = money(row[c.cr]); }
      if (!dr && !cr && c.amount != null && c.drcr != null) {
        const a = money(row[c.amount]); const t = String(row[c.drcr] || '').trim().toUpperCase();
        if (t.startsWith('D')) dr = a; else if (t.startsWith('C')) cr = a;
      }
      if (!(dr > 0) && !(cr > 0)) continue;
      const desc = String(row[c.desc] ?? '').replace(/\s+/g, ' ').trim();
      lines.push({
        row: r + 1, date: d.date, alt: d.alt, guessed: !!d.guessed, time: d.time, desc, ref: refNorm(row[c.ref]),
        dr: dr > 0 ? dr : 0, cr: dr > 0 ? 0 : cr, balance: c.balance != null && row[c.balance] != null && row[c.balance] !== '' ? money(row[c.balance]) : null,
        flat: c.flat != null ? unitNorm(row[c.flat]) : null, name: c.name != null && row[c.name] != null ? String(row[c.name]).trim() : '',
        team: c.team != null && row[c.team] != null ? String(row[c.team]).trim() : '',
      });
    }
    if (!lines.length) return { file: fileName, sheet: sh.name, bank, error: 'No statement lines found under the headings.' };
    fixSwapped(lines);
    let lastDate = null;
    for (const l of lines) { if (!l.date) l.date = lastDate; lastDate = l.date || lastDate; }
    const undated = lines.filter((l) => l.guessed).length;
    for (let i = lines.length - 1; i >= 0; i--) if (!lines[i].date) lines.splice(i, 1);
    // Closing balance per day: the last line of the day (latest time; same time, later in the file).
    const closing = {};
    const order = lines.map((l, i) => ({ l, i })).sort((a, b) => (a.l.date + a.l.time).localeCompare(b.l.date + b.l.time) || a.i - b.i);
    for (const { l } of order) if (l.balance != null) closing[l.date] = l.balance;
    const dates = lines.map((l) => l.date).sort();
    return { file: fileName, sheet: sh.name, bank, lines, from: dates[0], to: dates[dates.length - 1], closing, undated };
  }
  return { file: fileName, error: 'This file has no bank statement headings (Date, Narration / Description, Withdrawal / Deposit or Amount with Dr/Cr).' };
}

// Statements run in date order, so an ambiguous date is read the way that fits between its sure neighbours.
function fixSwapped(lines) {
  const sure = lines.map((l) => (l.alt || l.guessed ? null : l.date));
  const near = (i, step) => { for (let j = i + step; j >= 0 && j < lines.length; j += step) if (sure[j]) return sure[j]; return null; };
  const gap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  lines.forEach((l, i) => {
    if (!l.alt) return;
    const prev = near(i, -1), next = near(i, 1);
    const fits = (x) => (!prev || x >= addDays(prev, -7)) && (!next || x <= addDays(next, 7));
    const a = fits(l.date), b = fits(l.alt);
    if (b && !a) l.date = l.alt;
    else if (a === b && prev && gap(l.alt, prev) < gap(l.date, prev)) l.date = l.alt;
    delete l.alt;
  });
}
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// ---------- matching ----------
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

/**
 * Matches statement lines (one side) to ERP rows. rows: [{id, date, amount, ref}]. Each row is used once.
 * Passes: same amount + same reference within 5 days; same amount within 3 days (nearest first);
 * split entries: several rows with the same date and reference that add up to the line.
 * Returns { pairs: Map(lineIndex -> [rowIds]), unmatchedLines, unmatchedRows }.
 */
function match(lines, rows) {
  const used = new Set(), pairs = new Map();
  const free = () => rows.filter((r) => !used.has(r.id));
  const amt = (l) => l.dr || l.cr;
  // Same reference first (same day, then within 5 days: a cheque presented again keeps its number), then amount alone.
  for (const tol of [0, 5]) lines.forEach((l, i) => {
    if (!l.ref || pairs.has(i)) return;
    const hit = free().filter((r) => r2(r.amount) === amt(l) && r.ref && r.ref === l.ref && Math.abs(dayDiff(r.date, l.date)) <= tol)
      .sort((a, b) => Math.abs(dayDiff(a.date, l.date)) - Math.abs(dayDiff(b.date, l.date)))[0];
    if (hit) { used.add(hit.id); pairs.set(i, [hit.id]); }
  });
  for (const tol of [0, 1, 3]) {
    lines.forEach((l, i) => {
      if (pairs.has(i)) return;
      const hit = free().filter((r) => r2(r.amount) === amt(l) && Math.abs(dayDiff(r.date, l.date)) <= tol)
        .sort((a, b) => Math.abs(dayDiff(a.date, l.date)) - Math.abs(dayDiff(b.date, l.date)) || (b.ref === l.ref) - (a.ref === l.ref))[0];
      if (hit) { used.add(hit.id); pairs.set(i, [hit.id]); }
    });
  }
  // Paise dropped when the entry was typed (7,556.08 entered as 7,556).
  lines.forEach((l, i) => {
    if (pairs.has(i)) return;
    const hit = free().filter((r) => Math.abs(r2(r.amount) - amt(l)) < 1 && Math.abs(dayDiff(r.date, l.date)) <= 1)
      .sort((a, b) => Math.abs(dayDiff(a.date, l.date)) - Math.abs(dayDiff(b.date, l.date)))[0];
    if (hit) { used.add(hit.id); pairs.set(i, [hit.id]); }
  });
  lines.forEach((l, i) => {
    if (pairs.has(i)) return;
    const groups = {};
    for (const r of free()) if (Math.abs(dayDiff(r.date, l.date)) <= 3 && (r.ref ? r.ref === l.ref : false)) (groups[r.date + '|' + r.ref] ||= []).push(r);
    for (const g of Object.values(groups)) {
      if (g.length > 1 && r2(g.reduce((a, r) => a + Number(r.amount), 0)) === amt(l)) { g.forEach((r) => used.add(r.id)); pairs.set(i, g.map((r) => r.id)); break; }
    }
  });
  return { pairs, unmatchedLines: lines.map((l, i) => i).filter((i) => !pairs.has(i)), unmatchedRows: rows.filter((r) => !used.has(r.id)) };
}

const fmtD = (d) => { const [y, m, dd] = iso(d).split('-'); return `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}-${y}`; };

/**
 * The whole run, inside a transaction t. files: [{ name, buffer }].
 * opts: { start: 'YYYY-MM-DD' (lines before this are not checked), runDate, user, apply: false for a dry run, book }
 */
async function run(t, files, opts = {}) {
  const book = opts.book || 'signature';
  const start = opts.start || '2026-10-01';
  const runDate = opts.runDate || new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const apply = opts.apply !== false;
  const userId = opts.user?.id || null;
  const source = `Bank statement auto ${fmtD(runDate)}`;

  // Newest file per bank wins when two files are for the same account.
  const parsed = files.map((f) => ({ ...parseFile(f.buffer, f.name), modified: f.modified || null }));
  const byBank = {};
  for (const p of parsed) {
    if (p.error) continue;
    const cur = byBank[p.bank.key];
    if (!cur || (p.to > cur.to) || (p.to === cur.to && String(p.modified || '') > String(cur.modified || ''))) byBank[p.bank.key] = p;
  }
  const skippedFiles = parsed.filter((p) => !p.error && byBank[p.bank.key] !== p).map((p) => ({ file: p.file, reason: `A newer statement for ${p.bank.ledger} (${byBank[p.bank.key].file}) was used.` }));

  const dailyBanks = await t.q('select * from acc_daily_banks where book = $1', [book]);
  const bookings = new Set((await t.q("select u.unit_no from bookings b join units u on u.id = b.unit_id where b.status <> 'cancelled'").catch(() => [])).map((r) => r.unit_no));
  const out = { start, runDate, source, banks: [], differences: [], tagging: [], added: { receipts: 0, payments: 0 }, addedRows: [], updated: 0, daily: 0, files: parsed.map((p) => ({ file: p.file, sheet: p.sheet || null, bank: p.bank?.ledger || null, from: p.from || null, to: p.to || null, lines: p.lines?.length || 0, undated: p.undated || 0, error: p.error || null })), skippedFiles };
  const diff = (d) => out.differences.push(d);
  const pendingWrong = []; // ERP rows not on their own statement, checked against the other statements at the end

  let nextBS = null, nextPO = null;
  const ref = async (table, prefix) => {
    const r = await t.one(`select coalesce(max(nullif(regexp_replace(ref_id, '\\D', '', 'g'), '')::int), 0) as m from ${table} where book = $1 and ref_id like $2`, [book, prefix + '%']);
    return r.m;
  };

  for (const st of Object.values(byBank)) {
    const B = st.bank;
    const lines = st.lines.filter((l) => l.date >= start);
    const info = { bank: B.ledger, daily: B.daily, file: st.file, from: st.from, to: st.to, note: B.note || B.hold || '', lines: lines.length, receiptsAdded: 0, paymentsAdded: 0, rowsUpdated: 0, closing: st.closing[st.to] ?? null };
    out.banks.push(info);
    const credit = lines.filter((l) => l.cr > 0), debit = lines.filter((l) => l.dr > 0);
    const lo = start, hi = st.to;

    // ---- receipts (credits)
    const recRows = (await t.q(`select id, txn_date, amount, reference, description, cheque_status, ref_id from acc_receipts where book = $1 and bank = $2 and txn_date between ($3::date - 5) and ($4::date + 5)`, [book, B.ledger, lo, hi]))
      .map((r) => ({ id: r.id, date: iso(r.txn_date), amount: Number(r.amount), ref: refNorm(r.reference), raw: r }));
    const payRows = (await t.q(`select id, txn_date, amount, reference, description, ref_id from acc_payments where book = $1 and bank = $2 and txn_date between ($3::date - 5) and ($4::date + 5)`, [book, B.ledger, lo, hi]))
      .map((r) => ({ id: r.id, date: iso(r.txn_date), amount: Number(r.amount), ref: refNorm(r.reference), raw: r }));

    // A returned (bounced) cheque shows as a debit. It is matched to the deposit it reverses, not added as a payment.
    const returns = [], realDebits = [];
    for (const l of debit) (isReturn(l.desc) ? returns : realDebits).push(l);
    const sweeps = B.sweeps ? realDebits.filter((l) => B.sweeps.test(l.desc)) : [];
    const debits = realDebits.filter((l) => !sweeps.includes(l));

    const mr = match(credit, B.receipts || recRows.length ? recRows : []);
    const mp = match(debits, payRows);

    // Each return is paired with the deposit it reverses: same amount, deposited up to 15 days before (same flat when
    // both lines carry one), nearest first. The pair nets to zero, so neither is added; the receipt, if entered, is marked Bounced.
    const returnedDeposit = new Set();
    for (const l of returns.slice().sort((x, y) => x.date.localeCompare(y.date))) {
      const dep = credit.map((c, i) => ({ c, i })).filter(({ c, i }) => !returnedDeposit.has(i) && c.cr === l.dr && dayDiff(l.date, c.date) >= 0 && dayDiff(l.date, c.date) <= 15
        && (!l.flat || !c.flat || l.flat === c.flat)).sort((x, y) => dayDiff(l.date, x.c.date) - dayDiff(l.date, y.c.date))[0];
      if (dep) {
        returnedDeposit.add(dep.i);
        for (const id of mr.pairs.get(dep.i) || []) {
          const row = recRows.find((r) => r.id === id);
          if (row && row.raw.cheque_status !== 'Bounced') {
            if (apply) await t.q("update acc_receipts set cheque_status = 'Bounced', remark = concat_ws(' ', nullif(remark, ''), $2::text), updated_by = $3, updated_at = now() where id = $1", [id, `Bounced: returned on ${fmtD(l.date)} (bank statement).`, userId]);
            info.rowsUpdated++; out.updated++;
          }
        }
        continue;
      }
      // The deposit is before the lines checked: find its receipt in the ERP.
      const old = recRows.filter((r) => r2(r.amount) === l.dr && dayDiff(l.date, r.date) >= 0 && dayDiff(l.date, r.date) <= 15 && r.raw.cheque_status === 'Bounced');
      if (old.length) continue;
      diff({ what: 'Cheque return not matched to a deposit', bank: B.ledger, date: l.date, amount: l.dr, description: l.desc, where: `${st.file} row ${l.row}${l.flat ? ' (' + l.flat + ')' : ''}`, todo: 'Find the receipt this return belongs to and set its Cheque Status to Bounced.' });
    }

    const toAddR = mr.unmatchedLines.filter((i) => !returnedDeposit.has(i));
    if (B.receipts) {
      for (const i of toAddR) {
        const l = credit[i];
        if (nextBS == null) nextBS = await ref('acc_receipts', 'BS');
        nextBS++;
        const refId = 'BS' + String(nextBS).padStart(5, '0');
        const unit = l.flat; const known = unit && bookings.has(unit);
        const row = {
          ref_id: refId, txn_date: l.date, bank: B.ledger, description: l.desc, reference: l.ref || null, amount: l.cr,
          head: unit ? 'Receipts From Customers' : null, payment_head: unit ? (B.payHead || null) : null, unit_no: unit,
          payer_name: unit && l.name ? `${unit} ${l.name}` : (l.name || null), payer_type: unit ? (known ? 'Current buyer' : 'Other / earlier buyer') : null,
          on_statement: 'Yes', cheque_status: 'Cleared', source,
          remark: unit ? `Flat ${unit} ${B.payHead || ''} from the bank statement's flat column (filled ${fmtD(runDate)}).`.replace('  ', ' ') : 'Added from bank statement. Fill head and payee.',
        };
        if (apply) await insert(t, 'acc_receipts', { book, ...row, created_by: userId });
        info.receiptsAdded++; out.added.receipts++;
        out.addedRows.push({ side: 'receipt', ref: refId, bank: B.ledger, date: l.date, amount: l.cr, description: l.desc, unit });
        if (unit && !known) diff({ what: 'Flat not booked in the ERP', bank: B.ledger, date: l.date, amount: l.cr, description: l.desc, where: `Receipts ${refId}`, todo: `The statement says ${unit}, but there is no booking for it. Check the flat.` });
      }
    } else if (B.hold) {
      // counted with the payments below
    } else {
      // Not recorded from this account (0501 sweeps in from 0700; 0800 is not kept). Credits that are not sweeps are listed for information.
      for (const i of toAddR) {
        const l = credit[i];
        if (/XX0700|0+92872500000700|FT FROM 0*92872500000700/i.test(l.desc)) continue;
        diff({ what: 'Not kept in the master (no tab for this account)', bank: B.ledger, date: l.date, amount: l.cr, description: l.desc, where: `${st.file} row ${l.row}`, todo: 'For information. Tell Mr Syed if this should be recorded.' });
      }
    }

    // ---- add missing payments
    if (B.payments) {
      for (const i of mp.unmatchedLines) {
        const l = debits[i];
        if (nextPO == null) nextPO = await ref('acc_payments', 'PO');
        nextPO++;
        const refId = 'PO' + String(nextPO).padStart(5, '0');
        const row = { ref_id: refId, txn_date: l.date, bank: B.ledger, description: l.desc, reference: l.ref || null, amount: l.dr, unit_no: l.flat, on_statement: 'Yes', source, remark: 'Added from bank statement. Fill head and payee.' };
        if (apply) await insert(t, 'acc_payments', { book, ...row, created_by: userId });
        info.paymentsAdded++; out.added.payments++;
        out.addedRows.push({ side: 'payment', ref: refId, bank: B.ledger, date: l.date, amount: l.dr, description: l.desc, unit: l.flat });
      }
    }
    if (B.hold) {
      const heldLines = [...toAddR.map((i) => credit[i]), ...mp.unmatchedLines.map((i) => debits[i])];
      if (heldLines.length) diff({ what: 'Held back, waiting for Mr Syed', bank: B.ledger, date: `${fmtD(start)} to ${fmtD(st.to)}`, amount: r2(heldLines.reduce((a, l) => a + l.cr + l.dr, 0)), description: `${heldLines.length} lines not added`, where: st.file, todo: B.hold });
    }

    // ---- ERP rows with no statement line (only rows dated inside what the statement covers)
    if (B.receipts) for (const r of mr.unmatchedRows) if (r.date >= lo && r.date <= hi && r.raw.cheque_status !== 'Bounced' && r.raw.cheque_status !== 'Not found on statement') pendingWrong.push({ side: 'receipt', bank: B, r, file: st.file });
    if (B.payments) for (const r of mp.unmatchedRows) if (r.date >= lo && r.date <= hi) pendingWrong.push({ side: 'payment', bank: B, r, file: st.file });

    // ---- Daily Bank Balance: one auto entry per day, the statement's own totals (sweeps included)
    const db = dailyBanks.find((d) => d.name === B.daily);
    if (db) {
      const days = {};
      for (const l of lines) { const d = (days[l.date] ||= { cr: 0, dr: 0 }); d.cr = r2(d.cr + l.cr); d.dr = r2(d.dr + l.dr); }
      for (const [day, v] of Object.entries(days)) {
        const have = await t.q('select id, receipts, payments, entered_by from acc_daily_entries where book = $1 and bank = $2 and entry_date = $3', [book, B.daily, day]);
        const manual = have.filter((h) => h.entered_by !== 'Auto from bank statement');
        if (manual.length) {
          const mc = r2(manual.reduce((a, h) => a + Number(h.receipts || 0), 0)), md = r2(manual.reduce((a, h) => a + Number(h.payments || 0), 0));
          if (mc !== v.cr || md !== v.dr) diff({ what: 'Daily Bank Balance differs from the statement', bank: B.daily, date: day, amount: r2((v.cr - v.dr) - (mc - md)), description: `Typed: receipts ${mc}, payments ${md}. Statement: receipts ${v.cr}, payments ${v.dr}.`, where: 'Daily Bank Balance', todo: 'Correct the typed entry, or delete it so the ERP fills the day from the statement.' });
          continue;
        }
        const auto = have[0];
        if (auto && r2(auto.receipts || 0) === v.cr && r2(auto.payments || 0) === v.dr) continue;
        if (apply) {
          if (auto) await t.q('update acc_daily_entries set receipts = $2, payments = $3, remarks = $4, updated_by = $5, updated_at = now() where id = $1', [auto.id, v.cr || null, v.dr || null, st.file, userId]);
          else await insert(t, 'acc_daily_entries', { book, entry_date: day, bank: B.daily, receipts: v.cr || null, payments: v.dr || null, remarks: st.file, entered_by: 'Auto from bank statement', imported: false, created_by: userId });
        }
        out.daily++;
      }
      // Balance per bank, as the statement shows it at the end of each day
      for (const [day, bal] of Object.entries(st.closing)) {
        if (day < start) continue;
        if (apply) await t.q('insert into acc_bank_stated (daily_bank_id, on_date, balance, created_by) values ($1, $2, $3, $4) on conflict (daily_bank_id, on_date) do update set balance = excluded.balance', [db.id, day, bal, userId]);
      }
    }
  }

  // ERP rows not on their own bank's statement: on another bank's statement means booked under the wrong bank.
  for (const p of pendingWrong) {
    const other = Object.values(byBank).find((s) => s.bank.key !== p.bank.key && s.lines.some((l) => (p.side === 'receipt' ? l.cr : l.dr) === r2(p.r.amount) && Math.abs(dayDiff(l.date, p.r.date)) <= 3));
    const where = `${p.side === 'receipt' ? 'Receipts' : 'Payments Out'} ${p.r.raw.ref_id || '#' + p.r.id}`;
    if (other) diff({ what: 'Booked under the wrong bank', bank: other.bank.ledger, date: p.r.date, amount: p.r.amount, description: p.r.raw.description || '', where: `${where} says ${p.bank.ledger}`, todo: `Change Bank Account to ${other.bank.ledger}.` });
    else diff({ what: 'In the ERP, not on the bank statement', bank: p.bank.ledger, date: p.r.date, amount: p.r.amount, description: p.r.raw.description || '', where, todo: p.side === 'receipt' ? 'Check the entry. If the money never came, set Cheque Status to "Not found on statement".' : 'Check the entry against the bank.' });
  }
  // Receipts the check added that still have no head (whichever run added them): the team tags these.
  const untagged = await t.q(`select ref_id, txn_date, bank, amount, description from acc_receipts where book = $1 and source like 'Bank statement auto%' and coalesce(head, '') = '' and coalesce(cheque_status, '') <> 'Bounced' and txn_date >= $2 order by txn_date, ref_id`, [book, start]);
  out.tagging = untagged.map((r) => ({ what: 'Flat not found', bank: r.bank, date: iso(r.txn_date), amount: Number(r.amount), description: r.description, where: `Receipts ${r.ref_id}`, todo: 'Find the flat and fill head, flat, payer.' }));
  for (const p of parsed.filter((x) => x.error)) diff({ what: 'Statement file not read', bank: p.bank?.ledger || '', date: '', amount: null, description: p.error, where: p.file, todo: 'Fix the file and upload it again.' });
  return out;
}

async function insert(t, table, row) {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  await t.q(`insert into ${table} (${cols.join(', ')}) values (${cols.map((c, i) => '$' + (i + 1)).join(', ')})`, cols.map((c) => row[c]));
}

module.exports = { BANKS, bankFor, parseFile, parseDate, refNorm, match, run, isReturn };
