// Copied from the staff portal (proven in use). Project name, reference line and bank accounts now come
// from the project's letter settings; Dream Signature's own values are the defaults.
// Demand letter PDF in the CRM team's format (B-1806_DL_28-09-26.pdf and Reminder I):
// Dream India Realty / Dream Signature header, RERA footer, Times 11 pt, amounts table,
// bank table, due date, delayed-payment and TDS notes.
const fs = require('fs');
const path = require('path');
const { MiniPdf } = require('./pdf-mini');

const W = 595.28, H = 841.89;
const LEFT = 36, RIGHT = 561.5, TOP = 128, BOTTOM = 712;
const SIZE = 11, LEAD = 13.2;
const ASSETS = path.join(__dirname, 'demand-assets');
let imgs = null;
const images = () => imgs || (imgs = { header: fs.readFileSync(path.join(ASSETS, 'header.jpg')), footer: fs.readFileSync(path.join(ASSETS, 'footer.jpg')) });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const z = (n) => String(n).padStart(2, '0');
// Dates are ISO strings 'YYYY-MM-DD' (calendar dates, no time zone involved).
const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
const dmy = (iso, sep = '-') => { const p = parts(iso); return `${z(p.d)}${sep}${z(p.m)}${sep}${p.y}`; };
const longDate = (iso) => { const p = parts(iso); return `${DAYS[p.wd]}, ${MONTHS[p.m - 1]} ${z(p.d)}, ${p.y}`; };
const amount = (n) => String(Math.round(+n || 0));

const DEFAULT_BANKS = [
  { particulars: 'Flat Cost', favouring: 'PRIME REALTORS RERA', details: 'Bank Name: YES BANK\nA/c No. 092872500000700\nIFSC Code: YESB0000928\nBranch: Vikhroli' },
  { particulars: 'Goods and Services Tax', favouring: 'PRIME REALTORS AC GST', details: 'Bank Name: YES BANK\nA/c No. 146663700000131\nIFSC Code: YESB0001466\nBranch: Oshiwara' },
];

class Layout {
  constructor(doc) { this.doc = doc; this.newPage(); }
  newPage() {
    this.page = this.doc.addPage(W, H);
    this.page.image('Hdr', 41.1, 55.1, 522.7, 65.8);
    this.page.image('Ftr', 40.5, 723.2, 524.0, 68.6);
    this.y = TOP;
  }
  need(h) { if (this.y + h > BOTTOM) this.newPage(); }
  space(h) { this.y += h; }

  // Splits rich text [{t, b}] into lines that fit `width`. Returns [[{t,b,w}], ...].
  wrap(segs, width) {
    const words = [];
    for (const s of segs) {
      const parts = String(s.t).split(/(\s+)/);
      for (const p of parts) if (p) words.push({ t: p, b: !!s.b, space: /^\s+$/.test(p) });
    }
    const lines = []; let line = [], lw = 0;
    for (const w of words) {
      if (w.space && w.t.includes('\n')) { while (line.length && line[line.length - 1].t === ' ') line.pop(); lines.push(line); line = []; lw = 0; continue; }
      const ww = this.doc.width(w.space ? ' ' : w.t, w.b ? 'B' : 'R', SIZE);
      if (w.space) { if (line.length) { line.push({ t: ' ', b: w.b, w: ww }); lw += ww; } continue; }
      if (lw + ww > width && line.length) {
        while (line.length && line[line.length - 1].t === ' ') lw -= line.pop().w;
        lines.push(line); line = []; lw = 0;
      }
      line.push({ t: w.t, b: w.b, w: ww }); lw += ww;
    }
    while (line.length && line[line.length - 1].t === ' ') line.pop();
    if (line.length) lines.push(line);
    return lines.length ? lines : [[]];
  }
  drawLine(line, x, y, align, width) {
    const lw = line.reduce((t, s) => t + s.w, 0);
    let cx = align === 'center' ? x + (width - lw) / 2 : align === 'right' ? x + width - lw : x;
    // merge runs of the same weight so the PDF stays small
    let run = null;
    const flush = () => { if (run) { this.page.text(run.x, y, run.t, { font: run.b ? 'B' : 'R', size: SIZE }); run = null; } };
    for (const s of line) {
      if (run && run.b === s.b) run.t += s.t; else { flush(); run = { x: cx, t: s.t, b: s.b }; }
      cx += s.w;
    }
    flush();
  }
  // A paragraph of rich text. opts: { indent, align, after, bullet }
  para(segs, opts = {}) {
    if (typeof segs === 'string') segs = [{ t: segs }];
    const x = LEFT + (opts.indent || 0), width = RIGHT - x;
    const lines = this.wrap(segs, width);
    this.need(lines.length * LEAD);
    lines.forEach((ln, i) => {
      const base = this.y + SIZE * 0.8;
      if (opts.bullet && i === 0) this.page.text(x - 13, base, '•', { size: SIZE });
      this.drawLine(ln, x, base, opts.align, width);
      this.y += LEAD;
    });
    this.y += opts.after == null ? 6 : opts.after;
  }
  // rows: [[cell, cell, ...]], cell = string | {segs, align, bold}; widths in points.
  // opts.boxRows: number of trailing rows whose first two cells are merged (the Total row).
  table(rows, widths, opts = {}) {
    const pad = 3;
    const cellSegs = (c) => (typeof c === 'object' && c !== null ? (c.segs || [{ t: c.t, b: c.b }]) : [{ t: String(c ?? '') }]);
    const x0 = LEFT;
    rows.forEach((row, ri) => {
      const merged = opts.mergeLast && ri === rows.length - 1;
      const cells = merged ? [{ ...row[0], w: widths[0] + widths[1] }, { ...row[2], w: widths[2] }] : row.map((c, i) => ({ ...(typeof c === 'object' ? c : { t: c }), w: widths[i] }));
      const wrapped = cells.map((c) => this.wrap(cellSegs(c), c.w - pad * 2));
      const h = Math.max(...wrapped.map((l) => l.length)) * LEAD + pad * 2;
      this.need(h);
      let cx = x0;
      const total = widths.reduce((a, b) => a + b, 0);
      this.page.line(x0, this.y, x0 + total, this.y);
      cells.forEach((c, ci) => {
        const lines = wrapped[ci];
        const vOff = opts.middle && ri > 0 ? (h - lines.length * LEAD - pad * 2) / 2 : 0;
        lines.forEach((ln, li) => this.drawLine(ln, cx + pad, this.y + pad + vOff + li * LEAD + SIZE * 0.8, c.align, c.w - pad * 2));
        this.page.line(cx, this.y, cx, this.y + h);
        cx += c.w;
      });
      this.page.line(x0 + total, this.y, x0 + total, this.y + h);
      this.y += h;
      this.page.line(x0, this.y, x0 + total, this.y);
    });
  }
}

/**
 * d: { letterType, unit, name, addressLines[], phone, email, words, pct (0.3), invoiceDate, letterDate?, dueDate (ISO),
 *      av, received, flatDue, gstRec, gstDue, delay, total, signedFor }
 */
function layout(doc, d) {
  const L = new Layout(doc);
  const pctTxt = Math.round(d.pct * 100) + '%';
  const reminder = d.letterType !== 'Demand Letter';
  const title = d.letterType === 'Demand Letter' ? '- Demand Letter' : d.letterType === 'Demand Letter with Delay Charges' ? 'Demand Letter with Delay Charges' : `${d.letterType} - Demand Letter`;

  L.para([{ t: title, b: true }], { align: 'center', after: 8 });
  if (reminder && d.letterDate) {
    const right = `Letter Date: ${dmy(d.letterDate, '/')}`;
    L.need(LEAD);
    L.page.text(LEFT, L.y + SIZE * 0.8, `Invoice Date: ${dmy(d.invoiceDate, '/')}`, { size: SIZE });
    L.page.text(RIGHT - doc.width(right, 'R', SIZE), L.y + SIZE * 0.8, right, { size: SIZE });
    L.y += LEAD + 14;
  } else {
    L.para(`Invoice Date: ${dmy(d.invoiceDate)}`, { after: 12 });
  }
  L.para('To,', { after: 0 });
  [d.name, ...(d.addressLines || []), d.phone, d.email].filter((x) => String(x || '').trim()).forEach((x) => L.para(String(x), { after: 0 }));
  L.space(13);
  L.para('Dear Sir/ Madam,');
  L.para([{ t: `Sub: Notice of Milestone Completion & Payment Due: ${d.projectName || 'Dream Signature'} – Unit No. ${d.unit}`, b: true }]);
  L.para([{ t: 'Reference', b: true }, { t: ' - ' + (d.reference || 'C.T.S. Nos. 446C/2, situated at Relief Road, Near Oshiwara Bridge, Jogeshwari (W), MUMBAI - 400102') }]);
  L.para([{ t: 'We are pleased to inform you that the ' }, { t: `${d.words} work`, b: true }, { t: ' for your project has been completed.' }]);
  L.para('According to the payment schedule agreed upon at the time of your registration/booking, this milestone triggers your next instalment.', { after: 12 });
  L.para('Please find the payment details and due date below:');

  const B = (t, align) => ({ t, b: true, align });
  L.table([
    [B('Sr. No.', 'center'), B('Particulars', 'center'), B('Amount', 'center')],
    [B('1'), B('Agreement Value'), B(amount(d.av), 'right')],
    [B('2'), B('Amount Received as of Date'), B(amount(d.received), 'right')],
    [B('3'), B(`Balance Flat Cost due till the completion of the ${d.words} (${pctTxt})`), B(amount(d.flatDue), 'right')],
    [B('4'), B('Amount Received as of Date against GST'), B(amount(d.gstRec), 'right')],
    [B('5'), B(`Balance GST due till the completion of the ${d.words}`), B(amount(d.gstDue), 'right')],
    [B('6'), B('Delay Payment Charges + Tax'), B(amount(d.delay), 'right')],
    [B(`Total Due ${pctTxt} (3+5+6)`, 'center'), '', B(amount(d.total), 'right')],
  ], [59, 384, 82.5], { mergeLast: true });
  L.space(13);
  L.para('Payment through Cheque/RTGS/NEFT as per below details:');
  const C = (t) => ({ t, align: 'center' });
  L.table([
    [B('Particulars', 'center'), B('Cheque Favouring', 'center'), B('Account Details', 'center')],
    ...(d.banks || DEFAULT_BANKS).map((b) => [C(b.particulars), C(b.favouring), { segs: [{ t: b.details }] }]),
  ], [110, 225, 190.5], { middle: true });
  L.space(12);
  L.para([{ t: `Due Date: ${longDate(d.dueDate)}`, b: true }], { after: 10 });
  L.para([{ t: 'Important Terms Regarding Delayed Payments:', b: true }], { after: 4 });
  const bl = (segs) => L.para(segs, { indent: 28, bullet: true, after: 7 });
  bl([{ t: 'Late Fees:', b: true }, { t: ' Delayed payments will attract penalty charges calculated at the highest applicable ' }, { t: 'SBI MCLR rate plus 2%', b: true }, { t: '.' }]);
  bl([{ t: 'Tax on Late Fees: GST', b: true }, { t: ' will be levied as applicable on any delay charges payable.' }]);
  bl([{ t: 'Delay Payment Charges:', b: true }, { t: ' Applicable at the time of audit' }]);
  L.space(4);
  L.para([{ t: 'Important Note on TDS Compliance:', b: true }], { after: 4 });
  bl([{ t: 'Tax Deduction:', b: true }, { t: ' Please ensure ' }, { t: 'TDS @ 1%', b: true }, { t: ' under ' }, { t: 'Section 194-IA', b: true }, { t: ' is deducted and deposited through ' }, { t: 'Form 26QB', b: true }, { t: '. The last date is 30 days from the end of the month in which you make the payment. We request you to deposit it within ' }, { t: '7 days', b: true }, { t: ' so that your payment is credited in full.' }]);
  bl([{ t: 'Challan Submission:', b: true }, { t: ' Kindly share the Form 26QB challan copy with us immediately after deposit to avoid interest or penalties under ' }, { t: 'Section 201(1A)', b: true }, { t: '.' }]);
  bl([{ t: 'Form 16B:', b: true }, { t: ' Please download ' }, { t: 'Form 16B from the TRACES portal', b: true }, { t: ' (available about 10–15 days after the deposit) and share it with us as proof of tax deducted on the property transaction.' }]);
  L.space(2);
  L.para("Kindly arrange for the payment to be cleared on or before the due date to ensure the seamless progress of your unit's construction. You can make the payment via Net Banking, NEFT/RTGS, and Cheque", { after: 10 });
  L.para('If you have already processed this payment, please disregard this notice.', { after: 0 });
  L.para('Thank you for your continued cooperation.');
  L.para('Warm regards,');
  L.para([{ t: `For ${d.signedFor || 'M/s. PRIME REALTORS'}`, b: true }], { indent: 7, after: d.signatory ? 4 : 40 });
  if (d.signatory) { L.para([{ t: d.signatory, b: true }], { indent: 7, after: 0 }); L.para(d.signatoryTitle || 'Authorised Signatory', { indent: 7, after: 30 }); }
  L.para('This is a system-generated Demand and does not require a Signature.', { align: 'center' });
}

/**
 * Payment receipt. r: { receiptNo, date, unit, projectName, reference, name, addressLines[], amount, words, mode, instrument,
 *   instrumentDate, drawnOn, splits: [[label, amount]], cleared (bool), signedFor, signatory, signatoryTitle }
 */
function receiptLayout(doc, r) {
  const L = new Layout(doc);
  L.para([{ t: 'PAYMENT RECEIPT', b: true }], { align: 'center', after: 10 });
  const right = `Date: ${dmy(r.date, '/')}`;
  L.need(LEAD);
  L.page.text(LEFT, L.y + SIZE * 0.8, `Receipt No.: ${r.receiptNo}`, { font: 'B', size: SIZE });
  L.page.text(RIGHT - doc.width(right, 'R', SIZE), L.y + SIZE * 0.8, right, { size: SIZE });
  L.y += LEAD + 12;
  L.para('Received with thanks from:', { after: 2 });
  [r.name, ...(r.addressLines || [])].filter((x) => String(x || '').trim()).forEach((x, i) => L.para([{ t: String(x), b: i === 0 }], { after: 0 }));
  L.space(10);
  L.para([{ t: 'the sum of ' }, { t: `Rs. ${Math.round(r.amount).toLocaleString('en-IN')}/-`, b: true }, { t: ` (Rupees ${r.words} Only)` }]);
  const how = r.mode === 'cheque' ? `by Cheque No. ${r.instrument || '—'}${r.instrumentDate ? ' dated ' + dmy(r.instrumentDate, '/') : ''}${r.drawnOn ? ', drawn on ' + r.drawnOn : ''}`
    : r.mode === 'loan' ? `by disbursement from ${r.drawnOn || 'the lending bank'}${r.instrument ? ' (Ref. ' + r.instrument + ')' : ''}`
    : `by bank transfer${r.instrument ? ' (UTR / Ref. ' + r.instrument + ')' : ''}${r.drawnOn ? ' from ' + r.drawnOn : ''}`;
  L.para(how);
  L.para([{ t: 'towards Unit No. ' }, { t: r.unit, b: true }, { t: ` in ${r.projectName || 'Dream Signature'}` }, { t: r.reference ? ', ' + r.reference : '' }, { t: ', as under:' }], { after: 10 });
  const B = (t, align) => ({ t, b: true, align });
  L.table([
    [B('Sr. No.', 'center'), B('Particulars', 'center'), B('Amount (Rs.)', 'center')],
    ...r.splits.map(([label, amt], i) => [String(i + 1), label, { t: Math.round(amt).toLocaleString('en-IN'), align: 'right' }]),
    [B('Total', 'center'), '', B(Math.round(r.amount).toLocaleString('en-IN'), 'right')],
  ], [59, 384, 82.5], { mergeLast: true });
  L.space(14);
  if (r.mode === 'cheque' && !r.cleared) L.para([{ t: 'Subject to realisation of the cheque.', b: true }], { after: 8 });
  L.para('TDS, where deducted under Section 194-IA, is credited to your account once the Form 16B certificate is received.', { after: 8 });
  L.para('Please keep this receipt for your records. For any query, write to us quoting the receipt number.', { after: 16 });
  L.para([{ t: `For ${r.signedFor || 'M/s. PRIME REALTORS'}`, b: true }], { indent: 7, after: r.signatory ? 4 : 40 });
  if (r.signatory) { L.para([{ t: r.signatory, b: true }], { indent: 7, after: 0 }); L.para(r.signatoryTitle || 'Authorised Signatory', { indent: 7, after: 30 }); }
  L.para('This is a system-generated receipt and does not require a signature.', { align: 'center' });
}
function buildReceipt(r) {
  const doc = newDoc(`Payment receipt ${r.receiptNo} – ${r.unit}`);
  receiptLayout(doc, r);
  return doc.toBuffer();
}

function newDoc(title) {
  const doc = new MiniPdf({ title, author: 'M/s. PRIME REALTORS' });
  const im = images();
  doc.addJpeg('Hdr', im.header); doc.addJpeg('Ftr', im.footer);
  return doc;
}

function buildLetter(d) {
  const doc = newDoc(`${d.letterType} – ${d.projectName || 'Dream Signature'} ${d.unit}`);
  layout(doc, d);
  return doc.toBuffer();
}

// Several letters in one PDF (for printing the courier batch); each letter starts on a new page.
function buildMany(list) {
  const doc = newDoc('Dream Signature – demand letters for courier');
  for (const d of list) layout(doc, d);
  return doc.toBuffer();
}

module.exports = { buildLetter, buildMany, buildReceipt, longDate, dmy };
