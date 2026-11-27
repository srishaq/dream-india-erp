// A very small PDF writer (no npm deps): pages with text in the standard Times fonts, lines,
// rectangles and JPEG images. Enough for the demand letters; text is WinAnsi encoded.
const zlib = require('zlib');
const FONTS = require('./demand-fonts.json');

const FONT_NAMES = { R: 'Times-Roman', B: 'Times-Bold' };
// Unicode characters that WinAnsi keeps in the 0x80–0x9F block.
const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
const TO_ASCII = { 0x20b9: 'Rs.', 0x2212: '-', 0xa0: ' ' };

function winCodes(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (TO_ASCII[c]) { for (const a of TO_ASCII[c]) out.push(a.charCodeAt(0)); continue; }
    if (c >= 32 && c <= 126) out.push(c);
    else if (WIN[c]) out.push(WIN[c]);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else out.push(63); // '?'
  }
  return out;
}

function textWidth(str, font, size) {
  const w = FONTS[font] || FONTS.R;
  return winCodes(str).reduce((t, c) => t + (w[c - FONTS.first] || 0), 0) * size / 1000;
}

function pdfString(str) {
  const bytes = winCodes(str);
  let s = '';
  for (const b of bytes) {
    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return '(' + s + ')';
}

const n2 = (v) => (Math.round(v * 100) / 100).toString();

class Page {
  constructor(w, h) { this.w = w; this.h = h; this.ops = []; this.images = new Set(); }
  // y is measured from the TOP of the page (like a screen); converted here.
  text(x, y, str, { font = 'R', size = 11 } = {}) {
    this.ops.push(`BT /F${font} ${n2(size)} Tf ${n2(x)} ${n2(this.h - y)} Td ${pdfString(str)} Tj ET`);
  }
  line(x1, y1, x2, y2, width = 0.6) {
    this.ops.push(`${n2(width)} w 0 0 0 RG ${n2(x1)} ${n2(this.h - y1)} m ${n2(x2)} ${n2(this.h - y2)} l S`);
  }
  rect(x, y, w, h, width = 0.6) {
    this.ops.push(`${n2(width)} w 0 0 0 RG ${n2(x)} ${n2(this.h - y - h)} ${n2(w)} ${n2(h)} re S`);
  }
  image(name, x, y, w, h) {
    this.images.add(name);
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.h - y - h)} cm /${name} Do Q`);
  }
}

function readPng(buf) {
  try {
    let i = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0, pal = null, trns = null; const idat = [];
    while (i < buf.length) {
      const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
      else if (type === 'PLTE') pal = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
      i += 12 + len;
    }
    const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    if (depth !== 8 || inter || !bpp || !w || !h || w * h > 25e6) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(stride * h);
    for (let y = 0, p = 0; y < h; y++) {
      const f = raw[p++], row = y * stride;
      for (let x = 0; x < stride; x++, p++) {
        const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
        let v = raw[p];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        px[row + x] = v & 255;
      }
    }
    const n = w * h, rgb = Buffer.alloc(n * 3); let alpha = null;
    if (ct === 4 || ct === 6 || (ct === 3 && trns)) alpha = Buffer.alloc(n, 255);
    for (let k = 0; k < n; k++) {
      if (ct === 2 || ct === 6) { rgb[k * 3] = px[k * bpp]; rgb[k * 3 + 1] = px[k * bpp + 1]; rgb[k * 3 + 2] = px[k * bpp + 2]; if (ct === 6) alpha[k] = px[k * 4 + 3]; }
      else if (ct === 0 || ct === 4) { rgb[k * 3] = rgb[k * 3 + 1] = rgb[k * 3 + 2] = px[k * bpp]; if (ct === 4) alpha[k] = px[k * 2 + 1]; }
      else { const j = px[k]; if (!pal || j * 3 + 2 >= pal.length) return null; rgb[k * 3] = pal[j * 3]; rgb[k * 3 + 1] = pal[j * 3 + 1]; rgb[k * 3 + 2] = pal[j * 3 + 2]; if (alpha) alpha[k] = j < trns.length ? trns[j] : 255; }
    }
    return { w, h, rgb, alpha };
  } catch { return null; }
}

class MiniPdf {
  constructor({ title = '', author = '' } = {}) { this.pages = []; this.jpegs = {}; this.title = title; this.author = author; }
  addPage(w = 595.28, h = 841.89) { const p = new Page(w, h); this.pages.push(p); return p; }
  addJpeg(name, buf) {
    // Read width/height from the JPEG SOF marker.
    let i = 2, w = 0, h = 0;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
    this.jpegs[name] = { buf, w, h };
  }
  // PNG (8-bit grey, RGB, palette, with or without transparency): unpacked to RGB plus an alpha mask, both deflated.
  // Returns false for a PNG it cannot read (16-bit, interlaced, other bit depths), so the caller can do without it.
  addPng(name, buf) {
    const im = readPng(buf); if (!im) return false;
    this.jpegs[name] = { png: true, w: im.w, h: im.h, rgb: zlib.deflateSync(im.rgb), alpha: im.alpha ? zlib.deflateSync(im.alpha) : null };
    return true;
  }
  // a JPEG or a PNG, whichever the picture is
  addImage(name, buf) {
    if (!buf || buf.length < 8) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8) { this.addJpeg(name, buf); return !!this.jpegs[name].w; }
    if (buf.readUInt32BE(0) === 0x89504e47) return this.addPng(name, buf);
    return false;
  }
  width(str, font, size) { return textWidth(str, font, size); }

  toBuffer() {
    const objs = []; // index = object number - 1
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesRef = add(null);
    const fontRefs = {};
    for (const [k, name] of Object.entries(FONT_NAMES)) fontRefs[k] = add(Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`));
    const imgRefs = {};
    for (const [name, im] of Object.entries(this.jpegs)) {
      if (im.png) {
        const sm = im.alpha ? add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.alpha.length} >>\nstream\n`), im.alpha, Buffer.from('\nendstream')])) : 0;
        imgRefs[name] = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${sm ? ` /SMask ${sm} 0 R` : ''} /Length ${im.rgb.length} >>\nstream\n`), im.rgb, Buffer.from('\nendstream')]));
        continue;
      }
      imgRefs[name] = add(Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n`),
        im.buf, Buffer.from('\nendstream'),
      ]));
    }
    const fontDict = Object.entries(fontRefs).map(([k, r]) => `/F${k} ${r} 0 R`).join(' ');
    const pageRefs = this.pages.map((p) => {
      const content = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, Buffer.from('\nendstream')]));
      const xo = [...p.images].map((n) => `/${n} ${imgRefs[n]} 0 R`).join(' ');
      return add(Buffer.from(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${n2(p.w)} ${n2(p.h)}] /Resources << /Font << ${fontDict} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${c} 0 R >>`));
    });
    objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
    objs[pagesRef - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
    const info = add(Buffer.from(`<< /Title ${pdfString(this.title)} /Author ${pdfString(this.author)} /Producer (Dream India ERP) >>`));

    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0].length;
    const offsets = [];
    objs.forEach((body, i) => {
      const head = Buffer.from(`${i + 1} 0 obj\n`), tail = Buffer.from('\nendobj\n');
      offsets.push(offset);
      parts.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    });
    const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f '].concat(offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)).join('\n');
    parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}

module.exports = { MiniPdf, textWidth };
