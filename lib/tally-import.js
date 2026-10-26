// Import from Tally: the Receipt Register and Payment Register exported to Excel (Display → Account Books → Receipt /
// Payment Register, "Detailed"). Each voucher is a dated line (party ledger, Vch Type, Vch No., amount) followed by
// its other ledgers. Every bank line becomes one row in Receipts (money into that bank) or Payments Out (money out),
// so each row lines up with one line on the bank statement.
const xlsx = require('./xlsx');

const BOOK = 'signature';
// Tally bank ledger → ERP bank account, Daily Bank Balance bank and account number (found by the account number in the ledger name).
const BANKS = [
  { key: '092827000000111', ledger: 'Yes 111 / SDR (0111)', daily: 'PRIME 111 SDR', no: '092827000000111', seq: 5 },
  { key: '092872500000700', ledger: 'Yes RERA Collection 100% (0700)', daily: 'PRIME RERA COLLECTION 100%', no: '092872500000700', seq: 7, payHead: 'AV' },
  { key: '146663700000131', ledger: 'Yes GST (0131)', daily: 'PRIME GST', no: '146663700000131', seq: 6, payHead: 'GST' },
  { key: '99907178678650', ledger: 'Prime HDFC (8650)', daily: 'PRIME HDFC', no: '99907178678650', seq: 4 },
  { key: '092872400000501', ledger: 'Yes RERA 30% (0501)', daily: 'PRIME RERA 30%', no: '092872400000501', seq: 2 },
  { key: '092872500000800', ledger: 'Yes RERA Collection 70% (0800)', daily: 'PRIME RERA 70%', no: '092872500000800', seq: 1 },
  { key: '99909949089046', ledger: 'Prime HDFC Misc', daily: 'PRIME HDFC MISC', no: '99909949089046', seq: 8 },
  { key: '146663700000171', ledger: 'Yes Misc (0171)', daily: 'PRIME YES MISC (0171)', no: '146663700000171', seq: 9 },
  { key: '146663700000141', ledger: 'Yes SDR (0141)', daily: 'PRIME YES SDR (0141)', no: '146663700000141', seq: 10 },
  { key: 'Fixed Deposit', ledger: 'Yes Bank Fixed Deposit', daily: 'PRIME FIXED DEPOSIT', no: 'FIXED DEPOSIT', seq: 11 },
];
const CASH = { key: 'Cash', ledger: 'Cash', daily: 'CASH', no: '', seq: 12 };
const bankOf = (name) => { const s = String(name || '').trim(); if (/^cash$/i.test(s)) return CASH; return BANKS.find((b) => s.includes(b.key)) || null; };
const RERA_OPENED = '2026-01-22';
// Ledgers that are not the party: charges and TDS taken off the amount.
const CHARGES = /^(upi\/transaction charges|bank charges|round off|tds on .*|tds receivable.*)$/i;

const U = /^\s*([AB])\s*[-/. ]?\s*(\d{3,4})(?!\d)/i;
const unitOf = (name) => { const m = String(name || '').match(U); return m ? `${m[1].toUpperCase()}-${m[2]}` : null; };
const earlier = (name) => /cancel|eoi/i.test(name || '');
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? 0 : Number(String(v).replace(/[,\s]/g, '')) || 0);
const dateOf = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return xlsx.serialToText(v).slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1; if (mo) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const fyOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}${String(s + 1).slice(2)}`; };

// Reads one register. Returns { kind: 'receipt'|'payment', title, period, vouchers: [{date, no, type, lines:[{ledger, dr, cr}]}] }
function readRegister(buf, fileName) {
  const sheets = xlsx.read(buf);
  for (const sh of sheets) {
    const rows = sh.rows;
    const h = rows.findIndex((r) => r && String(r[0] || '').trim() === 'Date' && /particulars/i.test(String(r[1] || '')) && rows.indexOf(r) < 15);
    if (h < 0) continue;
    const H = rows[h].map((x) => String(x || '').trim().toLowerCase());
    const cT = H.indexOf('vch type'), cN = H.indexOf('vch no.'), cD = H.indexOf('debit'), cC = H.indexOf('credit');
    if (cD < 0 || cC < 0) continue;
    const title = rows.slice(0, h).map((r) => (r || []).find((x) => x)).filter(Boolean);
    const vouchers = []; let cur = null;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = String(r[1] ?? '').replace(/_x000D_/g, '').replace(/\s+/g, ' ').trim();
      if (/^total:?$/i.test(String(r[0] || '').trim())) break;
      const d = dateOf(r[0]);
      if (d) { cur = { date: d, no: String(r[cN] ?? '').trim(), type: String(r[cT] ?? '').trim(), row: i + 1, lines: [] }; vouchers.push(cur); }
      if (cur && name) cur.lines.push({ ledger: name, dr: num(r[cD]), cr: num(r[cC]) });
    }
    const t = title.join(' ');
    const kind = /contra/i.test(t) || vouchers.some((v) => /^contra/i.test(v.type)) ? 'contra' : /payment/i.test(t) || vouchers.some((v) => /^payment/i.test(v.type)) ? 'payment' : 'receipt';
    return { file: fileName, kind, title: title.join(' · '), vouchers };
  }
  throw Object.assign(new Error(`${fileName}: this is not a Tally register export (no "Date / Particulars / Vch Type / Vch No. / Debit / Credit" heading).`), { status: 400 });
}

// Turns both registers into register rows. Returns { receipts:[], payments:[], banks:[...], heads:{receipt:Set, payment:Set}, problems:[] }
function build(registers, today) {
  const receipts = [], payments = [], problems = [];
  const banksUsed = new Map();
  const headsR = new Set(['Receipts From Customers', 'Internal transfer']), headsP = new Set(['Internal transfer']);
  for (const reg of registers) {
    for (const v of reg.vouchers) {
      const bankLines = v.lines.map((l) => ({ ...l, b: bankOf(l.ledger) })).filter((l) => l.b);
      const party = v.lines.filter((l) => !bankOf(l.ledger));
      const main = party.filter((l) => !CHARGES.test(l.ledger));
      const ref = `${{ receipt: 'R', payment: 'P', contra: 'C' }[reg.kind]}${fyOf(v.date)}-${v.no}`;
      if (reg.kind === 'contra' && bankLines.length < 2) { problems.push({ what: 'Contra voucher with only one bank or cash ledger', where: `${reg.file} · ${v.type} ${v.no} of ${v.date}`, detail: v.lines.map((l) => `${l.ledger} ${l.dr || l.cr}`).join('; ') }); continue; }
      if (!bankLines.length) { problems.push({ what: 'Voucher with no bank or cash ledger', where: `${reg.file} · ${v.type} ${v.no} of ${v.date}`, detail: v.lines.map((l) => l.ledger).join('; ') }); continue; }
      if (today && v.date > today) problems.push({ what: 'Voucher dated in the future', where: `${reg.file} · ${v.type} ${v.no}`, detail: `${v.date}: ${main.map((l) => l.ledger).join('; ')} ₹${r2(bankLines.reduce((a, l) => a + l.dr + l.cr, 0)).toLocaleString('en-IN')}` });
      // The party: the largest non-charge ledger. A transfer between two own banks has no party.
      const top = main.slice().sort((a, b) => (b.dr + b.cr) - (a.dr + a.cr))[0] || null;
      const ledgers = [...new Set(main.map((l) => l.ledger))];
      const units = [...new Set(main.map((l) => unitOf(l.ledger)).filter(Boolean))];
      const desc = main.length ? main.map((l) => `${l.ledger}${main.length > 1 ? ` ₹${r2(l.dr || l.cr).toLocaleString('en-IN')}` : ''}`).join('; ') : '';
      const charges = party.filter((l) => CHARGES.test(l.ledger));
      bankLines.forEach((bl, k) => {
        banksUsed.set(bl.b.ledger, bl.b);
        const into = bl.dr > 0, amount = r2(into ? bl.dr : bl.cr);
        if (!amount) return;
        const other = bankLines.filter((x) => x !== bl).map((x) => x.b.ledger);
        const transfer = !main.length && other.length;
        const refId = bankLines.length > 1 ? `${ref}-${k + 1}` : ref;
        const remark = [`Tally ${v.type} ${v.no}`, charges.length ? charges.map((c) => `${c.ledger} ₹${r2(c.dr || c.cr).toLocaleString('en-IN')}`).join(', ') : '', ledgers.length > 1 ? 'several ledgers in one voucher' : ''].filter(Boolean).join(' · ');
        if (into) {
          const unit = units.length === 1 ? units[0] : null;
          const customer = !!unit && !transfer;
          const ph = customer ? (bl.b.payHead || (bl.b.key === '092827000000111' ? (v.date < RERA_OPENED ? 'AV' : 'SDR') : 'Unclassified')) : null;
          const head = transfer ? 'Internal transfer' : customer ? 'Receipts From Customers' : (top ? top.ledger : 'Not given in Tally');
          headsR.add(head);
          receipts.push({ ref_id: refId, txn_date: v.date, bank: bl.b.ledger, description: transfer ? `Transfer from ${other.join(', ')}` : desc, reference: v.no, amount, head, payment_head: ph,
            unit_no: customer ? unit : null, payer_name: top ? top.ledger : null, payer_type: customer ? (earlier(top.ledger) ? 'Other / earlier buyer' : 'Current buyer') : null,
            on_statement: null, cheque_status: 'Cleared', source: 'Tally', remark });
        } else {
          const unit = units.length === 1 ? units[0] : null;
          let head = transfer ? 'Internal transfer' : top ? top.ledger : 'Not given in Tally';
          if (!transfer && unit) head = earlier(top.ledger) ? 'Flat - Cancelled Refunded' : bl.b.key === '092827000000111' ? 'SDR' : 'Flat payment (check)';
          headsP.add(head);
          payments.push({ ref_id: refId, txn_date: v.date, bank: bl.b.ledger, description: transfer ? `Transfer to ${other.join(', ')}` : desc, reference: v.no, amount, head, unit_no: transfer ? null : unit,
            on_statement: null, remark, source: 'Tally', payee: transfer ? null : top ? top.ledger : null });
        }
      });
    }
  }
  return { receipts, payments, banks: [...banksUsed.values()].sort((a, b) => a.seq - b.seq), heads: { receipt: headsR, payment: headsP }, problems };
}

function parse(files, today) {
  const regs = files.map((f) => readRegister(f.buffer, f.name));
  if (!regs.some((r) => r.kind === 'receipt') || !regs.some((r) => r.kind === 'payment')) throw Object.assign(new Error('Upload both the Receipt Register and the Payment Register from Tally (the Contra Register is the third file, for transfers between your own accounts).'), { status: 400 });
  for (const k of ['receipt', 'payment', 'contra']) if (regs.filter((r) => r.kind === k).length > 1) throw Object.assign(new Error(`Two ${k} registers were chosen. Choose each Tally register once.`), { status: 400 });
  const b = build(regs, today);
  const sum = (a) => r2(a.reduce((s, x) => s + x.amount, 0));
  const dates = [...b.receipts, ...b.payments].map((x) => x.txn_date).sort();
  return { ...b, registers: regs.map((r) => ({ file: r.file, kind: r.kind, title: r.title, vouchers: r.vouchers.length })),
    summary: { receipts: b.receipts.length, payments: b.payments.length, receiptsTotal: sum(b.receipts), paymentsTotal: sum(b.payments), from: dates[0], to: dates[dates.length - 1], banks: b.banks.map((x) => x.ledger), problems: b.problems.length } };
}

// Replaces the accounts registers with Tally's (test version). Banks and Daily Bank Balance banks are set up from Tally's
// bank ledgers; the Daily Bank Balance gets one entry per bank and day from Tally (Entered by = Tally), brought forward 0
// on the first day of the books.
async function commit(t, p, { user }) {
  const T = ['acc_pdc_mail', 'acc_receipts', 'acc_payments', 'acc_daily_entries', 'acc_bank_stated', 'acc_stmt_runs'];
  const removed = {};
  for (const tb of T) removed[tb] = (await t.q(`delete from ${tb} returning 1 as x`)).length;
  for (const b of p.banks) {
    await t.q("insert into acc_banks (book, name, account_no) values ($1, $2, $3) on conflict (book, name) do update set account_no = excluded.account_no", [BOOK, b.ledger, b.no || null]);
    await t.q(`insert into acc_daily_banks (book, name, account_no, grp, seq, bf_balance, bf_date, auto_from_statement, ledger_bank) values ($1, $2, $3, 'SIGNATURE', $4, 0, $5, $6, $7)
               on conflict (book, name) do update set account_no = excluded.account_no, ledger_bank = excluded.ledger_bank, bf_balance = 0, bf_date = excluded.bf_date`,
    [BOOK, b.daily, b.no || null, b.seq, p.summary.from, b.key !== 'Cash' && b.key !== 'Fixed Deposit', b.ledger]);
  }
  for (const side of ['receipt', 'payment']) for (const h of p.heads[side]) await t.q("insert into acc_heads (book, side, name, note) values ($1, $2, $3, 'From Tally') on conflict (book, side, name) do nothing", [BOOK, side, h]);
  const ins = async (table, rows, cols) => {
    for (let i = 0; i < rows.length; i += 2000) {
      await t.q(`insert into ${table} (book, imported, created_by, ${cols.join(', ')}) select $1, true, $2, ${cols.map((c) => 'x.' + c).join(', ')}
                 from json_to_recordset($3::json) as x(${cols.map((c) => `${c} ${c === 'txn_date' ? 'date' : c === 'amount' ? 'numeric' : 'text'}`).join(', ')})`, [BOOK, user.id, JSON.stringify(rows.slice(i, i + 2000))]);
    }
  };
  await ins('acc_receipts', p.receipts, ['ref_id', 'txn_date', 'bank', 'description', 'reference', 'amount', 'head', 'payment_head', 'unit_no', 'payer_name', 'payer_type', 'on_statement', 'cheque_status', 'source', 'remark']);
  await ins('acc_payments', p.payments, ['ref_id', 'txn_date', 'bank', 'description', 'reference', 'amount', 'head', 'unit_no', 'on_statement', 'remark', 'source', 'payee']);
  // Daily Bank Balance: Tally's own totals per bank and day
  const day = {};
  const dailyOf = Object.fromEntries(p.banks.map((b) => [b.ledger, b.daily]));
  for (const r of p.receipts) { const k = r.txn_date + '|' + dailyOf[r.bank]; (day[k] ||= { r: 0, p: 0 }).r += r.amount; }
  for (const r of p.payments) { const k = r.txn_date + '|' + dailyOf[r.bank]; (day[k] ||= { r: 0, p: 0 }).p += r.amount; }
  const rows = Object.entries(day).map(([k, v]) => { const [d, b] = k.split('|'); return { entry_date: d, bank: b, receipts: r2(v.r) || null, payments: r2(v.p) || null }; });
  for (let i = 0; i < rows.length; i += 2000) {
    await t.q(`insert into acc_daily_entries (book, imported, created_by, entry_date, bank, receipts, payments, remarks, entered_by)
               select $1, true, $2, x.entry_date, x.bank, x.receipts, x.payments, 'From Tally', 'Tally' from json_to_recordset($3::json) as x(entry_date date, bank text, receipts numeric, payments numeric)`,
    [BOOK, user.id, JSON.stringify(rows.slice(i, i + 2000))]);
  }
  return { removed, daily: rows.length };
}

module.exports = { readRegister, build, parse, commit, bankOf, unitOf, BANKS };
