// A bank statement PDF as the rows of a sheet, so the statement check reads it like the Excel download (Rafi Sir,
// 28 Nov 2026: converting the PDF to Excel by hand lost entries; the team now drops the bank's PDF in the statements
// folder or uploads it). HDFC's layout: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. |
// Closing Balance, with a narration running on over the lines below. The columns are found from the heading on each
// page; the bank's own summary (Dr / Cr counts and totals, closing balance) is checked against what was read.
const P = require('./pdf-text');

const DATE = /^\d{2}\/\d{2}\/\d{2,4}$/;
const MONEY = /^-?[\d,]+\.\d{2}$/;
const num = (s) => Number(String(s).replace(/,/g, ''));
const HEADS = ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'];

function read(buf) {
  const pages = P.read(buf);
  const rows = [HEADS];
  let account = null, cur = null, summary = null, cols = null;
  for (const items of pages) {
    const ls = P.lines(items);
    const all = ls.map((l) => l.items.map((i) => i.text).join(' '));
    for (const t of all) { const m = /Account\s*No\s*:?\s*(\d{9,18})/i.exec(t); if (m && !account) account = m[1]; }
    // the columns from the heading (on the first page; later pages carry on under the same columns)
    const hi = ls.findIndex((l) => l.items.some((i) => /^Narration$/i.test(i.text.trim())) && l.items.some((i) => /Closing/i.test(i.text)));
    if (hi >= 0) {
      const hx = (re) => { const it = ls[hi].items.find((i) => re.test(i.text)); return it ? it.x : null; };
      cols = { refX: (hx(/Chq|Ref/i) ?? 285) - 20, vdX: (hx(/Value/i) ?? 360) - 6, dateX: hx(/^Date$/i) ?? 40 };
    }
    if (!cols) continue;
    const { refX, vdX, dateX } = cols;
    // the lines under the page's top block (account details, "From … To … Statement of account", the heading)
    let from = hi >= 0 ? hi + 1 : ls.findIndex((l, i) => /Statement of account|^From\s*:/i.test(all[i])) + 1;
    if (from <= 0) from = 0;
    for (let k = from; k < ls.length; k++) {
      const its = ls[k].items, text = all[k];
      if (/Opening Balance/i.test(text) && /Closing/i.test(text)) {
        if (ls[k + 1]) { const v = all[k + 1].trim().split(/\s+/); if (v.length >= 6) summary = { opening: num(v[0]), drCount: +v[1], crCount: +v[2], debits: num(v[3]), credits: num(v[4]), closing: num(v[5]) }; }
        cur = null; break;
      }
      if (/STATEMENT SUMMARY|HDFC BANK LIMITED|Closing balance includes|Contents of this statement|this statement\.|Registered Office|GSTN|GSTIN|computer generated|Page No/i.test(text)) continue;
      // the money at the end of the line (pieces may hold two amounts together)
      const toks = []; for (const it of its) for (const w of it.text.trim().split(/\s+/)) toks.push({ x: it.x, w });
      const first = toks[0];
      const tail = []; for (let i = toks.length - 1; i >= 0 && tail.length < 3 && MONEY.test(toks[i].w); i--) tail.unshift(toks[i]);
      if (first && DATE.test(first.w) && first.x < dateX + 20 && tail.length === 3) {
        const mid = its.filter((i, n) => n > 0 && i.x < vdX);
        const vd = toks.find((t) => t.x >= vdX && DATE.test(t.w));
        const narr = mid.filter((i) => i.x < refX).map((i) => i.text.trim()).join(' ');
        const ref = mid.filter((i) => i.x >= refX).map((i) => i.text.trim()).join(' ').replace(/^0+(?=\d)/, '').replace(/^0$/, '');
        cur = [first.w, narr, ref, vd ? vd.w : first.w, num(tail[0].w), num(tail[1].w), num(tail[2].w)];
        rows.push(cur);
      } else if (cur && its.every((i) => i.x > dateX + 20 && i.x < vdX) && text.trim()) {
        cur[1] = (cur[1] + ' ' + text.trim()).trim(); // the narration running on
      } else if (!/^\s*$/.test(text)) cur = null;
    }
  }
  if (rows.length < 2) throw Object.assign(new Error('No statement lines were found in this PDF (is it the bank\'s own statement, not a scan?).'), { status: 400 });
  // read whole: the bank's own totals at the end agree with the lines
  const lines = rows.slice(1);
  const check = { lines: lines.length, debits: lines.filter((r) => r[4] > 0).length, credits: lines.filter((r) => r[5] > 0).length,
    totalDebits: Math.round(lines.reduce((a, r) => a + r[4], 0) * 100) / 100, totalCredits: Math.round(lines.reduce((a, r) => a + r[5], 0) * 100) / 100, closing: lines[lines.length - 1][6] };
  let ok = null;
  if (summary) ok = summary.drCount === check.debits && summary.crCount === check.credits && Math.abs(summary.debits - check.totalDebits) < 0.01 && Math.abs(summary.credits - check.totalCredits) < 0.01;
  // and the running balance moves by each line's amount
  let breaks = 0; for (let i = 1; i < lines.length; i++) if (Math.abs(lines[i - 1][6] - lines[i][4] + lines[i][5] - lines[i][6]) > 0.01) breaks++;
  return { account, rows, summary, check, ok, breaks };
}

// as lib/xlsx.read gives a workbook: [{ name, rows }] (the sheet named with the account, so its bank is known)
function asSheets(buf) {
  const r = read(buf);
  if (r.ok === false) throw Object.assign(new Error(`The PDF was not read completely: the bank's summary says ${r.summary.drCount} debits and ${r.summary.crCount} credits, ${r.check.debits} and ${r.check.credits} were read. Send this PDF to the ERP team.`), { status: 400 });
  return [{ name: `PDF statement ${r.account || ''}`.trim(), rows: r.rows, pdf: r }];
}

module.exports = { read, asSheets };
