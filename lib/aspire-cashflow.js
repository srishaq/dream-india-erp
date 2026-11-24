// Dream Aspire's cash flow workbook ("Dream Aspire Cash Flow", kept by Aspire Accounts in Drive: 01 – Accounts (Aspire)
// / Cash Flow, FD, Loans & Refunds). Its ASPIRE_EXPENSES and ASPIRE_COLLECTION sheets carry every debit and credit of
// Aspire's banks since April 2021 with the Cash Flow Head Accounts gave it (Rafi Sir, 24 Nov 2026: "upload this in the
// ERP and the accounts queries should be resolved").
//   parse(sheets)          → { pays: [...], recs: [...], issues }
//   plan(q, parsed, opts)  → which ERP bank rows get which head / payee / flat, and what does not fit
//   commit(t, parsed, opts)
// Each sheet line is matched to one ERP bank row of the same amount: the same date first (and the same bank or the same
// narration when there are several), then up to 3 days apart with the same narration. Only empty fields are filled:
// a head the ERP already has that differs from the sheet's is listed, not changed. New heads are added to the head list.
const audit = require('./audit');

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (v) => { const x = Number(String(v ?? '').replace(/[,\s₹]/g, '')); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };

// dates come as YYYY-MM-DD (date cells), dd/mm/yy or dd/mm/yyyy (typed), or an Excel day number
function dateOf(v) {
  const s = norm(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5).toISOString().slice(0, 10);
  return null;
}
// the sheet's bank column → the account's last digits (as in the ERP's bank names, e.g. "Aspire HDFC 30% (7044)")
function bankOf(v) {
  const s = norm(v).toLowerCase();
  if (!s) return null;
  if (/axis/.test(s)) return '2736';
  if (/gst|2044/.test(s)) return '2044';
  if (/mca|master|6462|100\s*%/.test(s)) return '6462';
  if (/rera|6459|70\s*%/.test(s)) return '6459';
  if (/hdfc|7044|30\s*%/.test(s)) return '7044';
  return null; // a cheque or reference number typed in the column: any bank
}
const digitsOf = (bank) => (String(bank || '').match(/\((\d{4})\)/) || [])[1] || null;

// the sheet's head names → the ERP's where the ERP already has the same head under another spelling
const ALIAS = {
  payment: {
    'internal transfer': 'Internal transfer', 'architect expenses/mep/structure/ca': 'Architect /MEP/Retirement/CA', 'adani sub station expenses': 'ADANI EXPENSES',
    'investment returns': 'Investment Return', gst: 'GST PAID', 'goregaon project': 'Goregoan', 'materail purchase': 'MATERIAL', 'staff walfare': 'Staff Welfare',
  },
  receipt: { 'internal transfer': 'Internal transfer', 'cash receipts from customers': 'Receipts From Customers', 'prime eoi received in aspire': 'EOI Received in Aspire' },
};
// "PARTNERS WITHDRAW" names the partner in the remark: the ERP has a head for each
function partnerHead(remark) {
  const r = norm(remark).toLowerCase();
  if (/rafi/.test(r)) return 'Partner Withdrawal-Rafi Sir';
  if (/sameer/.test(r)) return 'Partner Withdrawal-Sameer Sir';
  if (/anas/.test(r)) return 'Partner Withdrawal-Anas Sir';
  return null;
}
// where a new head sits in the cash flow statement (the sheet's own grouping)
function sectionOf(name) {
  const s = name.toLowerCase();
  if (/internal transfer/.test(s)) return 'Internal transfer';
  if (/fixed deposit|interest received|tds on fd/.test(s)) return 'Investing';
  if (/loan|invest|partner|withdraw|settled|prime|goregaon|goregoan|santorini|pure infra|legacy|imports|azeem|conversion|yamunanagar|cloud staffing|zenith|reverse|refund to/.test(s)) return 'Financing';
  return 'Operating';
}

function sheetRows(sh, need) {
  const h = sh.rows.findIndex((r) => r && r.some((c) => /cash flow head/i.test(norm(c))));
  if (h < 0) throw new Error(`${sh.name} has no "Cash Flow Head" column.`);
  const H = sh.rows[h].map((c) => norm(c).toLowerCase());
  const col = (re) => H.findIndex((c) => re.test(c));
  const C = Object.fromEntries(Object.entries(need).map(([k, re]) => [k, col(re)]));
  return { C, rows: sh.rows.slice(h + 1).map((r, i) => ({ r: r || [], line: h + i + 2 })) };
}

function parse(sheets) {
  const E = sheets.find((s) => /aspire[_\s]*expenses/i.test(s.name)), R = sheets.find((s) => /aspire[_\s]*collection/i.test(s.name));
  if (!E || !R) throw new Error('This is not the Dream Aspire Cash Flow workbook (no ASPIRE_EXPENSES and ASPIRE_COLLECTION sheets).');
  const issues = [];
  const take = (sh, need, side) => {
    const { C, rows } = sheetRows(sh, need);
    const out = [];
    for (const { r, line } of rows) {
      const amount = money(r[C.amount]); const date = dateOf(r[C.date]);
      if (!amount || !date) continue;
      const head = norm(r[C.head]);
      const x = { side, line, date, amount: Math.abs(amount), bank: bankOf(r[C.bank]), desc: norm(r[C.desc]), remark: C.remark >= 0 ? norm(r[C.remark]) : '', head };
      if (side === 'receipt') { x.flat = C.flat >= 0 ? norm(r[C.flat]) : ''; x.alloc = C.alloc >= 0 ? norm(r[C.alloc]) : ''; }
      if (!head || /^null$/i.test(head)) { issues.push({ sheet: sh.name, line, kind: 'no-head', note: `${date} ${amount}: no Cash Flow Head in the sheet.` }); continue; }
      out.push(x);
    }
    return out;
  };
  const pays = take(E, { date: /^date/, desc: /^particulars/, bank: /^mode/, amount: /^amount/, remark: /^remark/, head: /cash flow head/ }, 'payment');
  const recs = take(R, { date: /^date/, desc: /^particulars/, bank: /^bank/, amount: /deposit/, alloc: /allocation/, flat: /^flat/, remark: /^remark/, head: /cash flow head/ }, 'receipt');
  return { pays, recs, issues };
}

// who was paid, from the bank's narration (HDFC and Axis formats), else from the sheet's remark when it reads as a name
const NOT_NAME = /charges?|expenses?|salary|rent|refund|withdraw|transfer|investment|loan|gst|tds|commission|marketing|for the|period|purchase|payment|reimburse|bonus|welfare|misc|deposit|return|cancel|^\d|bank|office|site|travel|tenant|tenent|electric|permission|security|sdr|stamp|legal|charity|interest|tax|issued|towards|^dd |^null$/i;
function clean(n) { n = norm(n).replace(/\s*(pvt|private)?\s*$/i, (m) => m).replace(/[*]+/g, '').trim(); return n.length >= 3 && /[a-z]/i.test(n) ? n.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()) : null; }
function payeeOf(desc, remark, head, bank) {
  const d = norm(desc);
  let m;
  if (/^bank charges$/i.test(norm(head)) || (/charges?|chgs|markup|consolidated|gst @|sms|card fee|annual fee|cash handling/i.test(d) && !head)) return /axis|2736/i.test(bank || '') ? 'Axis Bank' : 'HDFC Bank';
  if (/^(?:TDS RECOVERED|CBDT)/i.test(d)) return 'Income Tax Department';
  if ((m = d.match(/^(?:POS|ECOM PUR)\/([^/]+)\//i))) return clean(m[1].replace(/^[A-Z]{2,5}\*/i, ''));
  if ((m = d.match(/^(?:ME DC SI|POS|ATW|NWD)[- ]?\d{6}X+\d{4} (.+?)(?: SI)?$/i))) return clean(m[1]);
  if ((m = d.match(/^DD ISSUED\/[A-Z]+\/([^/]+)\//i))) return clean(m[1]);
  if ((m = d.match(/CHQ PAID TO ([^/]+)\//i))) return clean(m[1]);
  if ((m = d.match(/^([A-Z][A-Z .]{3,}?)\s*\/[A-Z .]*BANK/i))) return clean(m[1]);
  if ((m = d.match(/^CHQ PAID-[A-Z0-9 ]*?-[A-Z]{2,5}-(.+)$/i))) return clean(m[1]);
  if ((m = d.match(/^MC ISSUED\b.*-\s*-\s*(.+)$/i))) return clean(m[1]);
  if ((m = d.match(/^UPI-([^-]+)-/i))) return clean(m[1]);
  if ((m = d.match(/^(?:NEFT|RTGS) DR-[A-Z0-9]{11}-([^-]+)-/i))) return clean(m[1]);
  if ((m = d.match(/^IMPS-\d+-([^-]+)-/i))) return clean(m[1]);
  if ((m = d.match(/^FT\s*-\s*DR\s*-\s*\d+\s*-\s*(.+)$/i))) return clean(m[1]);
  if ((m = d.match(/^(?:TRF|NEFT|RTGS|IMPS)\/(?:[A-Z0-9]+\/)*?([A-Z][A-Z .&]{2,})\//i))) return clean(m[1]);
  if ((m = d.match(/^UPI\/P2[AM]\/\d+\/([^/]+)\//i))) return clean(m[1]);
  const r = norm(remark);
  if (r && !NOT_NAME.test(r) && r.split(' ').length <= 6) return clean(r);
  return null;
}

async function plan(q, parsed, { book = 'aspire', projectId } = {}) {
  const P = await q('select id, ref_id, txn_date::text as d, bank, amount, description, head, payee from acc_payments where book = $1', [book]);
  const R = await q('select id, ref_id, txn_date::text as d, bank, amount, description, head, payer_name, unit_no, payment_head from acc_receipts where book = $1', [book]);
  const heads = await q('select side, name from acc_heads where book = $1', [book]);
  const units = projectId ? new Set((await q('select unit_no from units where project_id = $1', [projectId])).map((u) => u.unit_no)) : new Set();
  const known = { payment: new Map(), receipt: new Map() };
  for (const h of heads) known[h.side].set(h.name.toLowerCase().trim(), h.name);
  const newHeads = new Map();
  const headFor = (side, x) => {
    if (side === 'payment' && /^partners?\s*withdraw/i.test(x.head)) { const p = partnerHead(x.remark); if (p) return p; }
    const k = x.head.toLowerCase().trim();
    const a = ALIAS[side][k];
    if (a && known[side].has(a.toLowerCase())) return known[side].get(a.toLowerCase());
    if (known[side].has(k)) return known[side].get(k);
    const name = x.head.trim();
    newHeads.set(side + '|' + name, { side, name, section: sectionOf(name) });
    known[side].set(k, name);
    return name;
  };
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const same = (a, b) => { const A = key(a).slice(0, 24), B = key(b).slice(0, 24); return A.length >= 8 && B.length >= 8 && (A === B || A.startsWith(B.slice(0, 16)) || B.startsWith(A.slice(0, 16))); };
  const match = (lines, rows) => {
    const byAmt = new Map();
    for (const r of rows) { const a = Math.abs(Number(r.amount)).toFixed(2); (byAmt.get(a) || byAmt.set(a, []).get(a)).push(r); }
    const used = new Set(), pairs = [], left = [];
    const pick = (x, near) => {
      const c = (byAmt.get(x.amount.toFixed(2)) || []).filter((r) => !used.has(r.id) && (near ? days(r.d, x.date) <= 3 : r.d === x.date));
      if (!c.length) return null;
      const score = (r) => (r.d === x.date ? 4 : 0) + (x.bank && digitsOf(r.bank) === x.bank ? 3 : 0) + (same(r.description, x.desc) ? 5 : 0) - days(r.d, x.date) * 0.1;
      c.sort((a, b) => score(b) - score(a));
      const r = c[0];
      if (near && !same(r.description, x.desc)) return null; // a date apart: only with the same narration
      if (!near && x.bank && digitsOf(r.bank) && digitsOf(r.bank) !== x.bank && !same(r.description, x.desc)) return null;
      return r;
    };
    for (const pass of [false, true]) {
      for (const x of pass ? left.splice(0) : lines) {
        const r = pick(x, pass);
        if (r) { used.add(r.id); pairs.push([x, r]); } else if (!pass) left.push(x); else left.push(x);
      }
    }
    return { pairs, left };
  };
  const fills = [], differ = [];
  const sameHead = (a, b) => key(a) === key(b);
  const mp = match(parsed.pays, P);
  for (const [x, r] of mp.pairs) {
    const set = {}; const h = headFor('payment', x);
    if (!r.head) set.head = h; else if (!sameHead(r.head, h)) differ.push({ side: 'payment', id: r.id, ref: r.ref_id, date: r.d, amount: Number(r.amount), erp: r.head, sheet: h });
    if (!r.payee) { const p = payeeOf(r.description || x.desc, x.remark, h, r.bank); if (p) set.payee = p; }
    if (Object.keys(set).length) fills.push({ side: 'payment', id: r.id, ref: r.ref_id, set });
  }
  const mr = match(parsed.recs, R);
  for (const [x, r] of mr.pairs) {
    const set = {}; const h = headFor('receipt', x);
    if (!r.head) set.head = h; else if (!sameHead(r.head, h)) differ.push({ side: 'receipt', id: r.id, ref: r.ref_id, date: r.d, amount: Number(r.amount), erp: r.head, sheet: h });
    if (!r.payer_name && x.remark && !/^null$/i.test(x.remark)) set.payer_name = x.remark.slice(0, 120);
    // a buyer's money: the flat from the sheet when the ERP has none (the flat must exist in Dream Aspire)
    const fno = (x.flat.match(/^(?:A[-\s]?)?(\d{3,4})$/i) || [])[1];
    const customer = /receipts from customers|^flat/i.test(h) && !/cancel|contractor/i.test(h);
    if (customer && fno && !r.unit_no && units.has(`A-${fno}`)) {
      set.unit_no = `A-${fno}`;
      if (!r.payment_head) set.payment_head = /gst/i.test(h + ' ' + x.alloc) || digitsOf(r.bank) === '2044' ? 'GST' : /sdr/i.test(h + ' ' + x.alloc) ? 'SDR' : /legal/i.test(h) ? 'Legal' : 'AV';
    }
    if (Object.keys(set).length) fills.push({ side: 'receipt', id: r.id, ref: r.ref_id, set });
  }
  const sum = (a) => Math.round(a.reduce((s, x) => s + x.amount, 0));
  const matchedP = new Set(mp.pairs.map(([, r]) => r.id)), matchedR = new Set(mr.pairs.map(([, r]) => r.id));
  return {
    // a new head is added only when an entry gets it (not when it only shows as a difference)
    fills, differ, newHeads: [...newHeads.values()].filter((h) => fills.some((f) => f.side === h.side && f.set.head === h.name)),
    sheet: { payments: parsed.pays.length, receipts: parsed.recs.length },
    matched: { payments: mp.pairs.length, receipts: mr.pairs.length },
    notInErp: { payments: mp.left.length, paymentAmt: sum(mp.left), receipts: mr.left.length, receiptAmt: sum(mr.left), sample: [...mp.left, ...mr.left].sort((a, b) => b.amount - a.amount).slice(0, 25).map((x) => ({ side: x.side, date: x.date, amount: x.amount, desc: x.desc.slice(0, 70), head: x.head, line: x.line })) },
    erpNoHeadLeft: { payments: P.filter((r) => !r.head && !matchedP.has(r.id)).length, receipts: R.filter((r) => !r.head && !matchedR.has(r.id)).length },
    issues: parsed.issues,
  };
}

async function commit(t, parsed, { book = 'aspire', projectId, user, source }) {
  const p = await plan(t.q, parsed, { book, projectId });
  for (const h of p.newHeads) await t.q("insert into acc_heads (book, side, name, section, note) values ($1, $2, $3, $4, 'From the Dream Aspire Cash Flow sheet') on conflict (book, side, name) do nothing", [book, h.side, h.name, h.section]);
  // the rows are filled in one statement per column set; updated_at is left alone so the rows are not sent to Tally again
  const groups = new Map();
  for (const f of p.fills) { const k = f.side + '|' + Object.keys(f.set).sort().join(','); (groups.get(k) || groups.set(k, []).get(k)).push(f); }
  for (const [k, list] of groups) {
    const [side, cols] = k.split('|'); const C = cols.split(',');
    const table = side === 'payment' ? 'acc_payments' : 'acc_receipts';
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500);
      await t.q(`update ${table} x set ${C.map((c) => `${c} = coalesce(nullif(x.${c}, ''), v.${c})`).join(', ')}
        from jsonb_to_recordset($1::jsonb) as v(id int, ${C.map((c) => `${c} text`).join(', ')}) where x.id = v.id and x.book = $2`,
      [JSON.stringify(part.map((f) => ({ id: f.id, ...f.set }))), book]);
    }
  }
  const n = (side, k) => p.fills.filter((f) => f.side === side && f.set[k]).length;
  const out = { paymentsMatched: p.matched.payments, receiptsMatched: p.matched.receipts, paymentHeads: n('payment', 'head'), payees: n('payment', 'payee'), receiptHeads: n('receipt', 'head'), payers: n('receipt', 'payer_name'), units: n('receipt', 'unit_no'), newHeads: p.newHeads.length, differ: p.differ.length, notInErp: p.notInErp.payments + p.notInErp.receipts };
  await audit.record(t.q, { user, action: 'aspire-cashflow', entity: 'book', entityId: null, projectId, after: out, note: `Heads, payees and flats from ${source}` });
  return { ...out, plan: p };
}

module.exports = { parse, plan, commit, payeeOf, dateOf, bankOf };
