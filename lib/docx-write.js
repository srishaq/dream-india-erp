// A small Word (.docx) writer with no npm packages, for letters the consultants print on their own letterhead
// (the RERA Forms 1, 2 and 3). write({ blocks, topCm }) → Buffer. topCm leaves room at the top of every page for
// the letterhead. Blocks:
//   { h: 'text' }                                  centred bold heading
//   { p: 'text', b, i, center, right, size }        a paragraph (size in points); '\n' starts a new line
//   { table: { head: [...], rows: [[...]], widths: [cm...], num: [col indexes right-aligned], bold: [row indexes] } }
//   { space: true }   { pagebreak: true }
const { zip } = require('./xlsx-write');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const cm = (v) => Math.round(v * 567); // twips
function runs(text, { b, i, size } = {}) {
  const rp = `<w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${size ? `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>` : ''}</w:rPr>`;
  return String(text == null ? '' : text).split('\n').map((line, k) => `${k ? '<w:r><w:br/></w:r>' : ''}<w:r>${rp}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}
function para(text, o = {}) {
  const jc = o.center ? 'center' : o.right ? 'right' : o.justify ? 'both' : null;
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.after == null ? 120 : o.after}"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${runs(text, o)}</w:p>`;
}
function table({ head = [], rows = [], widths = [], num = [], bold = [], size = 9 }) {
  const nc = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const w = widths.length === nc ? widths : Array.from({ length: nc }, () => 16 / nc);
  const B = '<w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:color="808080"/>';
  const cell = (v, ci, isHead, isBold) => `<w:tc><w:tcPr><w:tcW w:w="${cm(w[ci])}" w:type="dxa"/>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E9EE"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/>${!isHead && num.includes(ci) ? '<w:jc w:val="right"/>' : isHead ? '<w:jc w:val="center"/>' : ''}</w:pPr>${runs(v, { b: isHead || isBold, size })}</w:p></w:tc>`;
  const row = (r, isHead, isBold) => `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${Array.from({ length: nc }, (_, ci) => cell(r[ci], ci, isHead, isBold)).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${cm(w.reduce((a, x) => a + x, 0))}" w:type="dxa"/><w:tblBorders>${B}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${cm(x)}"/>`).join('')}</w:tblGrid>${head.length ? row(head, true) : ''}${rows.map((r, ri) => row(r, false, bold.includes(ri))).join('')}</w:tbl>${para('', { after: 80 })}`;
}
function write({ blocks = [], topCm = 4.5 } = {}) {
  const body = blocks.map((b) => {
    if (b.h != null) return para(b.h, { b: true, center: true, size: b.size || 11, after: b.after == null ? 80 : b.after });
    if (b.table) return table(b.table);
    if (b.pagebreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (b.space) return para('', { after: 0 });
    return para(b.p, b);
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${cm(topCm)}" w:right="${cm(1.8)}" w:bottom="${cm(1.8)}" w:left="${cm(1.8)}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/document.xml', doc], ['word/styles.xml', styles],
  ]);
}
module.exports = { write };
