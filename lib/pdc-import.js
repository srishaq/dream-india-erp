// PDC Excel in the accounts team's format (Mrunali, 27 Nov 2026: "PRIME REALTORS PDC Cheque details"): three sheets,
//  - purchase PDC: Particulars, Invoice Dt., Invoice No., Amount including TDS, CGST, SGST, TDS amount, TDS section,
//    Paid amount after deducting TDS, Cheque Dt., Cheque No., Description;
//  - SRA PDC: Particulars, PDC date, Cheque number, Amount, Bank name;
//  - upcoming PDC (invoices whose cheque is still to be given): Particulars, Invoice Dt., PDC, Invoice No., Invoice Amt, Description.
// Each sheet is found by its headings, not its name. A row already in the register (same party, invoice / cheque and
// amount) is not added twice. Bank names like "HDFC 8650" are matched to the ERP's banks by their last digits.
const db = require('./db');
const books_ = require('./book');

const N = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[₹,\s]/g, '')); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const D = (v) => { const s = String(v ?? '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const T = (v) => (v == null ? '' : String(v).trim());
const norm = (s) => T(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim();

function purposeOf(text, type) {
  const t = String(text || '').toLowerCase();
  if (type === 'SRA') return 'SRA charges and premiums';
  if (/pump/.test(t)) return 'Pumping charges';
  if (/rmc|ready ?mix|\bm ?-? ?\d{2}\b|concrete/.test(t)) return 'RMC (ready-mix concrete)';
  if (/tmt|steel|\bbars?\b|rebar/.test(t)) return 'Steel / TMT bars';
  if (/cement|sand|aggregate|grit/.test(t)) return 'Cement, sand and aggregates';
  if (/block|brick/.test(t)) return 'Blocks and bricks';
  if (/shutter|formwork|mivan/.test(t)) return 'Shuttering / formwork';
  return 'Other';
}
function sectionOf(s) {
  const t = String(s || '').toUpperCase().replace(/\s/g, '');
  if (!t) return null;
  if (t.startsWith('194Q')) return '194Q 0.1% (goods: RMC, steel)';
  if (t.startsWith('194C')) return /\(1%|\b1%/.test(t) ? '194C 1% (contract: individual / HUF)' : '194C 2% (contract: company / firm)';
  if (t.startsWith('194J')) return /2%/.test(t) ? '194J 2% (technical services)' : '194J 10% (professional fees)';
  if (t.startsWith('194IA')) return '194IA 1% (property)';
  if (t.startsWith('194I')) return /2%/.test(t) ? '194I 2% (rent of machinery)' : '194I 10% (rent of building)';
  return String(s).trim().slice(0, 40);
}
// the GST rate and type behind the CGST / SGST / IGST on a row
function gstOf(x) {
  const base = +x.invoice_amount || 0, g = (+x.cgst || 0) + (+x.sgst || 0), i = +x.igst || 0;
  if (!base || !(g + i)) return;
  const pct = Math.round(((g + i) / base) * 100);
  if ([5, 12, 18, 28].includes(pct)) { x.gst_rate = pct + '%'; x.gst_type = i ? 'IGST (other state)' : 'CGST + SGST (Maharashtra)'; }
}

// the rows of one workbook (lib/xlsx.read output): [{ type, row }...] and what could not be read
function parse(sheets) {
  const out = [], problems = [];
  for (const sh of sheets) {
    const hi = sh.rows.findIndex((r) => (r || []).some((c) => /^particulars$/i.test(T(c))));
    if (hi < 0) continue;
    const H = sh.rows[hi].map(norm), col = (...names) => H.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const c = {
      party: col('particulars'), invDate: col('invoice dt', 'invoice date'), invNo: col('invoice no'), base: col('amount including tds'), cgst: col('cgst'), sgst: col('sgst'), igst: col('igst'),
      tds: col('tds amount'), sec: col('tds section'), paid: col('paid amount'), chqDate: col('cheque dt', 'cheque date', 'pdc date'), chqNo: col('cheque no', 'cheque number'),
      desc: col('description'), amt: col('amount'), bank: col('bank name', 'bank'), pdc: H.findIndex((h) => h === 'pdc'), invAmt: col('invoice amt', 'invoice amount'),
    };
    const kind = c.paid >= 0 ? 'purchase' : c.invAmt >= 0 && c.pdc >= 0 ? 'upcoming' : c.bank >= 0 && c.amt >= 0 ? 'sra' : null;
    if (!kind) { problems.push(`${sh.name}: headings not recognised`); continue; }
    for (let i = hi + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i] || [], g = (k) => (c[k] >= 0 ? r[c[k]] : null);
      const party = T(g('party')); if (!party || /^particulars$/i.test(party)) continue; // a blank row, or the headings again for a second table
      const at = `${sh.name} row ${i + 1}`;
      let x;
      if (kind === 'purchase') x = { pdc_type: 'Purchase', issued_to: party, invoice_date: D(g('invDate')), invoice_no: T(g('invNo')) || null, invoice_amount: N(g('base')), cgst: N(g('cgst')), sgst: N(g('sgst')), igst: N(g('igst')),
        tds_amount: N(g('tds')), tds_section: sectionOf(g('sec')), amount: N(g('paid')), due_date: D(g('chqDate')), cheque_no: T(g('chqNo')) || null, description: T(g('desc')) || null, cheque_status: 'Issued' };
      else if (kind === 'sra') x = { pdc_type: /sra/i.test(party) || /sra/i.test(sh.name) ? 'SRA' : 'Other', issued_to: party, amount: N(g('amt')), due_date: D(g('chqDate')), cheque_no: T(g('chqNo')) || null, bankText: T(g('bank')), description: null, cheque_status: 'Issued' };
      else x = { pdc_type: 'Purchase', issued_to: party, invoice_date: D(g('invDate')), invoice_no: T(g('invNo')) || null, amount: N(g('invAmt')), invoice_amount: null, due_date: D(g('pdc')), description: T(g('desc')) || null, cheque_status: 'Not issued yet' };
      if (x.cheque_no && /^\d+(\.0+)?$/.test(x.cheque_no)) x.cheque_no = x.cheque_no.replace(/\.0+$/, '').padStart(6, '0');
      x.purpose = purposeOf(`${x.description || ''} ${party}`, x.pdc_type);
      gstOf(x);
      if (x.pdc_type === 'SRA' && /sra/i.test(party)) x.issued_to = 'Slum Rehabilitation Authority (SRA charges)';
      if (!(x.amount > 0)) { problems.push(`${at}: ${party} has no amount`); continue; }
      if (!x.due_date) { problems.push(`${at}: ${party} has no cheque / PDC date`); continue; }
      out.push({ ...x, at });
    }
  }
  return { rows: out, problems };
}

// the ERP bank for "HDFC 8650" / "YES BANK-111": same last digits (3 or more), else the same bank name
async function bankFor(text, banks) {
  const t = T(text); if (!t) return null;
  const dig = (/(\d{3,})\D*$/.exec(t) || [])[1];
  if (dig) { const b = banks.filter((x) => String(x.name).replace(/\D/g, '').endsWith(dig)); if (b.length === 1) return b[0].name; }
  const w = t.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2)[0];
  const b = w ? banks.filter((x) => String(x.name).toLowerCase().includes(w)) : [];
  return b.length === 1 ? b[0].name : null;
}

async function plan(sheets) {
  const { rows, problems } = parse(sheets);
  const banks = await db.q('select name from acc_banks where book = $1', [books_.cur()]);
  const have = await db.q('select issued_to, invoice_no, cheque_no, amount, due_date from acc_pdc where book = $1', [books_.cur()]);
  const key = (r) => [String(r.issued_to || '').toLowerCase(), String(r.invoice_no || '').toLowerCase(), String(r.cheque_no || '').replace(/^0+/, ''), Math.round(+r.amount || 0), String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date || '').slice(0, 10)].join('|');
  const seen = new Set(have.map(key));
  const add = [], already = [];
  for (const r of rows) {
    if (r.bankText !== undefined) { r.bank = await bankFor(r.bankText, banks); if (!r.bank && r.bankText) r.description = `Bank on the sheet: ${r.bankText}`; delete r.bankText; }
    const k = key(r); if (seen.has(k)) { already.push(r.at); continue; }
    seen.add(k); add.push(r);
  }
  const sum = (l) => l.reduce((s, r) => s + (+r.amount || 0), 0);
  const by = (t, st) => add.filter((r) => r.pdc_type === t && (!st || r.cheque_status === st));
  return { add, already: already.length, problems,
    summary: { rows: add.length, amount: sum(add), purchase: by('Purchase', 'Issued').length, purchaseAmount: sum(by('Purchase', 'Issued')), sra: by('SRA').length, sraAmount: sum(by('SRA')),
      notIssued: add.filter((r) => r.cheque_status === 'Not issued yet').length, notIssuedAmount: sum(add.filter((r) => r.cheque_status === 'Not issued yet')),
      cheques: new Set(add.filter((r) => r.cheque_no).map((r) => r.cheque_no.replace(/^0+/, ''))).size } };
}

const COLS = ['pdc_type', 'issued_to', 'purpose', 'description', 'invoice_date', 'invoice_no', 'invoice_amount', 'gst_rate', 'gst_type', 'cgst', 'sgst', 'igst', 'tds_amount', 'tds_section', 'amount', 'bank', 'due_date', 'cheque_no', 'cheque_status'];
async function run(t, userId, p) {
  for (const r of p.add) await t.q(`insert into acc_pdc (book, imported, created_by, ${COLS.join(', ')}) values ($1, true, $2, ${COLS.map((_, i) => '$' + (i + 3)).join(', ')})`, [books_.cur(), userId, ...COLS.map((k) => r[k] ?? null)]);
  return p.add.length;
}

// the empty sheet to fill, in the same format
function template() {
  return require('./xlsx-write').write([
    { name: 'Purchase PDC', rows: [['PURCHASE PDC'], ['SR. No.', 'Particulars', 'Invoice Dt.', 'Invoice No.', 'AMOUNT INCLUDING TDS', 'CGST', 'SGST', 'TDS AMOUNT', 'TDS SECTION', 'PAID AMOUNT AFTER DEDUCTING TDS', 'Cheque Dt.', 'Cheque No.', 'DESCRIPTION']], widths: [8, 34, 12, 20, 16, 12, 12, 12, 14, 18, 12, 12, 26] },
    { name: 'SRA PDC', rows: [['SR.NO.', 'PARTICULARS', 'PDC DATE', 'CHEQUE NUMBER', 'AMOUNT', 'BANK NAME']], widths: [8, 30, 12, 16, 16, 18] },
    { name: 'Upcoming PDC', rows: [['UPCOMING PDC (cheque not given yet)'], ['SR. No.', 'Particulars', 'Invoice Dt.', 'PDC', 'Invoice No.', 'Invoice Amt', 'Description']], widths: [8, 34, 12, 12, 20, 16, 26] },
  ]);
}

module.exports = { parse, plan, run, template, purposeOf, bankFor };
