// The bank's PDF statement read as statement lines (lib/pdf-text.js, lib/bank-pdf.js, bank-statements.parseFile):
// a synthetic HDFC-layout PDF, protected the way bank downloads are (RC4, no password to open), two pages, a narration
// running on over the page break, and the bank's summary checked. Synthetic data only; no database needed.
// node scripts/test-bank-pdf.js
const assert = require('assert/strict');
const crypto = require('crypto');
const zlib = require('zlib');
const { rc4 } = require('../lib/pdf-text');
const B = require('../lib/bank-pdf');
const bs = require('../lib/bank-statements');
let n = 0; const step = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...p) => { const h = crypto.createHash('md5'); for (const x of p) h.update(x); return h.digest(); };
const esc = (t) => String(t).replace(/([\\()])/g, '\\$1');
const T = (x, y, t) => `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj ET`;

function pdf(pages, { encrypt = true } = {}) {
  const id = crypto.randomBytes(16), P = -60;
  // owner key → O; file key from O, P and the ID (Standard handler, revision 2, 40-bit)
  const O = rc4(md5(Buffer.from('owner-secret-for-test'.padEnd(32, '\0').slice(0, 32), 'latin1')).subarray(0, 5), PAD);
  const p4 = Buffer.alloc(4); p4.writeInt32LE(P);
  const key = md5(PAD, O, p4, id).subarray(0, 5);
  const objKey = (num) => { const k = Buffer.alloc(5); k.writeUIntLE(num, 0, 3); return md5(key, k).subarray(0, 10); };
  const objs = []; const add = (body) => { objs.push(body); return objs.length; };
  const cat = add(null), pagesObj = add(null), font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const kids = [];
  for (const content of pages) {
    let data = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const cn = objs.length + 1; if (encrypt) data = rc4(objKey(cn), data);
    add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from('\nendstream')]));
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 638 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${cn} 0 R >>`)));
  }
  objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  objs[cat - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  const enc = encrypt ? add(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${P} /O <${O.toString('hex')}> /U <${'00'.repeat(32)}> >>`)) : null;
  let out = Buffer.from('%PDF-1.3\n'); const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); });
  out = Buffer.concat([out, Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R ${enc ? `/Encrypt ${enc} 0 R ` : ''}/ID [<${id.toString('hex')}><${id.toString('hex')}>] >>\n%%EOF\n`)]);
  return out;
}

const top = [T(340, 688, 'Account No : 50200000006462 CAGEN'), T(34, 615, 'From : 01/11/2026 To : 20/11/2026'), T(340, 615, 'Statement of account')];
const head = [T(40, 602, 'Date'), T(153, 602, 'Narration'), T(292, 602, 'Chq./Ref.No.'), T(362, 602, 'Value Dt'), T(405, 602, 'Withdrawal Amt.'), T(491, 602, 'Deposit Amt.'), T(564, 602, 'Closing Balance')];
const row = (y, d, narr, ref, w, dep, bal) => [T(34, y, d), T(72, y, narr), T(289, y, ref), T(362, y, d), T(456, y, w), T(512, y, `${dep} ${bal}`)];
const page1 = [T(292, 817, 'Page No .: 1'), ...top, ...head,
  ...row(584, '02/11/26', 'CHQ DEP - CTS CLG1 - MUMBAI', '0000000000123456', '0.00', '500,000.00', '500,000.00'), T(72, 567, 'CLEARING: TEST BUYER ONE :SBI'),
  ...row(550, '03/11/26', '50200000006459 FUND TRF TO DREAM INDIA', '000000000000000', '350,000.00', '0.00', '150,000.00'),
  ...row(533, '05/11/26', 'RTGS CR-TEST0000001-TEST BUYER', 'TESTR5202611050001', '0.00', '1,200,000.00', '1,350,000.00'),
  T(28, 50, 'HDFC BANK LIMITED'), T(28, 3, 'Registered Office Address: HDFC Bank House')].join('\n');
const page2 = [T(292, 817, 'Page No .: 2'), ...top, T(72, 604, 'TWO-DREAM INDIA BUILDERS DREAM ASPIRE'),
  ...row(570, '06/11/26', 'CHQ DEP RET- FUNDS INSUFFICIENT', '0000000000123456', '500,000.00', '0.00', '850,000.00'),
  T(150, 300, 'STATEMENT SUMMARY :-'), T(100, 290, 'Opening Balance Dr Count Cr Count Debits Credits Closing Bal'), T(100, 280, '0.00 2 2 850,000.00 1,700,000.00 850,000.00'),
  T(28, 50, 'HDFC BANK LIMITED')].join('\n');

step('a protected two-page HDFC PDF is read line by line, the narration running on over the page break', () => {
  const r = B.read(pdf([page1, page2]));
  assert.equal(r.account, '50200000006462');
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows[1], ['02/11/26', 'CHQ DEP - CTS CLG1 - MUMBAI CLEARING: TEST BUYER ONE :SBI', '123456', '02/11/26', 0, 500000, 500000]);
  assert.equal(r.rows[2][2], '', 'a reference of all zeros is no reference');
  assert.equal(r.rows[3][1], 'RTGS CR-TEST0000001-TEST BUYER TWO-DREAM INDIA BUILDERS DREAM ASPIRE');
  assert.equal(r.ok, true, 'the bank\'s summary agrees'); assert.equal(r.breaks, 0, 'the running balance moves by each line');
});
step('the same without protection', () => { assert.equal(B.read(pdf([page1, page2], { encrypt: false })).rows.length, 5); });
step('the statement check takes the PDF like the Excel: its account from the PDF, every line with its date and amount', () => {
  const f = bs.parseFile(pdf([page1, page2]), 'statement-download.pdf');
  assert.equal(f.error, undefined, f.error); assert.equal(f.bank.key, 'asp6462');
  assert.equal(f.lines.length, 4); assert.equal(f.lines[0].date, '2026-11-02'); assert.equal(f.lines[0].cr, 500000); assert.equal(f.lines[3].dr, 500000);
  assert.equal(f.closing['2026-11-06'], 850000);
});
step('a PDF the bank\'s summary does not agree with is refused, not half read', () => {
  const bad = page2.replace('0.00 2 2 850,000.00', '0.00 3 2 850,000.00');
  const f = bs.parseFile(pdf([page1, bad]), 'x.pdf');
  assert.match(f.error, /not read completely/);
});
console.log(`Bank PDF: ${n} checks passed.`);
