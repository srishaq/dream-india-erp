// Reads the text of a PDF, with where each piece sits on the page: enough for bank statements (HDFC's downloads, 28 Nov
// 2026), with no outside packages. Handles the standard security bank PDFs come with when they open without a password
// (RC4, revisions 2 and 3: "copy not allowed" but readable), Flate-compressed content streams and simple fonts
// (WinAnsi text drawn with Tj / TJ). Not for scanned statements (no text in them) or AES-encrypted files.
const zlib = require('zlib');
const crypto = require('crypto');

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const fail = (m) => Object.assign(new Error(m), { status: 400 });

function rc4(key, data) {
  const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
  return out;
}
const md5 = (...parts) => { const h = crypto.createHash('md5'); for (const p of parts) h.update(p); return h.digest(); };

// the objects of the file: number → { dict (text), stream (Buffer, still encoded) }
function objects(buf) {
  const s = buf.toString('latin1'), out = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const num = +m[1], gen = +m[2], start = m.index + m[0].length;
    const end = s.indexOf('endobj', start); if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      const from = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      const lenM = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      let to = lenM ? from + +lenM[1] : s.lastIndexOf('endstream', end);
      if (!lenM) { while (to > from && (s[to - 1] === '\n' || s[to - 1] === '\r')) to--; }
      out.set(num, { gen, dict, stream: buf.subarray(from, to) });
    } else out.set(num, { gen, dict: body });
    re.lastIndex = end;
  }
  return out;
}
const ref = (dict, key) => { const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(dict); return m ? +m[1] : null; };
const hexOrLit = (v) => { // a PDF string as bytes (<hex> or (literal))
  v = v.trim();
  if (v[0] === '<') return Buffer.from(v.slice(1, -1).replace(/\s+/g, ''), 'hex');
  return literal(v.slice(1, -1));
};
function literal(t) {
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== '\\') { out.push(t.charCodeAt(i) & 255); continue; }
    const n = t[++i];
    if (n === undefined) break;
    if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i]; out.push(parseInt(o, 8) & 255); }
    else if (n === '\r') { if (t[i + 1] === '\n') i++; }
    else if (n === '\n') { /* line continuation */ }
    else out.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[n] ?? (n.charCodeAt(0) & 255));
  }
  return Buffer.from(out);
}

// the key for each object, from the Standard security handler with the empty user password
function decrypter(buf, objs) {
  const tail = buf.toString('latin1', Math.max(0, buf.length - 4096));
  const encNum = ref(tail, 'Encrypt') ?? ref(buf.toString('latin1'), 'Encrypt');
  if (encNum == null) return null;
  const e = objs.get(encNum); if (!e) throw fail('The PDF is protected in a way the ERP cannot read.');
  const d = e.dict, num = (k) => { const m = new RegExp('/' + k + '\\s+(-?\\d+)').exec(d); return m ? +m[1] : null; };
  if (!/\/Filter\s*\/Standard/.test(d) || (num('V') || 0) > 2) throw fail('This PDF uses a protection the ERP cannot open (ask the bank for the statement without a password, or as Excel).');
  const R = num('R') || 2, len = (num('Length') || 40) / 8, P = num('P');
  const O = hexOrLit(/\/O\s*(<[^>]*>|\((?:\\.|[^\\)])*\))/s.exec(d)[1]);
  const idM = /\/ID\s*\[\s*(<[^>]*>|\((?:\\.|[^\\)])*\))/s.exec(buf.toString('latin1'));
  const id0 = idM ? hexOrLit(idM[1]) : Buffer.alloc(0);
  const p = Buffer.alloc(4); p.writeInt32LE(P);
  let key = md5(PAD, O.subarray(0, 32), p, id0).subarray(0, len);
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, len);
  return (n, gen, data) => {
    const k = Buffer.alloc(5); k.writeUIntLE(n, 0, 3); k.writeUIntLE(gen, 3, 2);
    return rc4(md5(key, k).subarray(0, Math.min(len + 5, 16)), data);
  };
}

function streamOf(objs, n, dec) {
  const o = objs.get(n); if (!o || !o.stream) return Buffer.alloc(0);
  let data = dec ? dec(n, o.gen, o.stream) : o.stream;
  if (/\/FlateDecode/.test(o.dict)) { try { data = zlib.inflateSync(data); } catch { try { data = zlib.inflateRawSync(data.subarray(2)); } catch { data = Buffer.alloc(0); } } }
  return data;
}

// the page objects in reading order
function pages(objs, buf) {
  const s = buf.toString('latin1');
  const root = ref(s.slice(Math.max(0, s.length - 4096)), 'Root') ?? ref(s, 'Root');
  const out = [];
  const walk = (n, depth = 0) => {
    const o = objs.get(n); if (!o || depth > 30) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) { out.push(n); return; }
    const k = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
    if (k) for (const m of k[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(+m[1], depth + 1);
  };
  const cat = root != null && objs.get(root);
  const top = cat ? ref(cat.dict, 'Pages') : null;
  if (top != null) walk(top);
  if (!out.length) for (const [n, o] of objs) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) out.push(n);
  return out;
}

// pieces of text on one page: [{ x, y, size, text }] (PDF units, y upwards)
function pageText(content) {
  const s = content.toString('latin1'), out = [];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], tl = 0, size = 10;
  const ops = []; // operands
  const emit = (bytes) => {
    const m = mul(tm, ctm);
    const text = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : bytes;
    if (text.trim()) out.push({ x: m[4], y: m[5], size: size * Math.hypot(m[2], m[3]) || size, text });
  };
  const re = /\s*(\((?:\\[\s\S]|[^\\)]|\((?:\\[\s\S]|[^\\)])*\))*\)|<[0-9A-Fa-f\s]*>|\[(?:\((?:\\[\s\S]|[^\\)])*\)|<[^>]*>|[^\]])*\]|\/[^\s/\[\]()<>]+|-?\d*\.?\d+|[A-Za-z'"*]+\d?\*?|<<|>>|%[^\n]*)/y;
  let m;
  while ((m = re.exec(s))) {
    const t = m[1];
    if (t[0] === '%') continue;
    if (/^[-\d.]/.test(t) || t[0] === '/' || t[0] === '(' || t[0] === '<' || t[0] === '[') { ops.push(t); continue; }
    const n = (i) => +ops[ops.length - i];
    switch (t) {
      case 'q': stack.push(ctm.slice()); break;
      case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case 'cm': ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': size = n(1); break;
      case 'TL': tl = n(1); break;
      case 'Tm': tm = [n(6), n(5), n(4), n(3), n(2), n(1)]; tlm = tm.slice(); break;
      case 'Td': tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); tm = tlm.slice(); break;
      case 'TD': tl = -n(1); tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); tm = tlm.slice(); break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); break;
      case 'Tj': emit(hexOrLit(ops[ops.length - 1] || '()')); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); emit(hexOrLit(ops[ops.length - 1] || '()')); break;
      case '"': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); emit(hexOrLit(ops[ops.length - 1] || '()')); break;
      case 'TJ': {
        const arr = ops[ops.length - 1] || '[]';
        const parts = []; for (const p of arr.slice(1, -1).matchAll(/\((?:\\[\s\S]|[^\\)])*\)|<[^>]*>|-?\d*\.?\d+/g)) {
          if (p[0][0] === '(' || p[0][0] === '<') parts.push(hexOrLit(p[0]).toString('latin1'));
          else if (+p[0] < -200) parts.push(' '); // a wide gap inside one run is a space
        }
        emit(parts.join(''));
        break;
      }
      default: break;
    }
    ops.length = 0;
  }
  return out;
}

// every page's text pieces: [[{ x, y, size, text }]...]
function read(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString() !== '%PDF-') throw fail('That is not a PDF file.');
  const objs = objects(buf), dec = decrypter(buf, objs);
  return pages(objs, buf).map((pn) => {
    const p = objs.get(pn);
    const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
    const refs = c ? [...c[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => +x[1]) : [];
    return pageText(Buffer.concat(refs.map((r) => streamOf(objs, r, dec))));
  });
}

// the page as lines of text: pieces on the same baseline (within 2 units), left to right
function lines(items, tol = 2) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x), out = [];
  for (const it of sorted) {
    const l = out.find((x) => Math.abs(x.y - it.y) <= tol);
    if (l) l.items.push(it); else out.push({ y: it.y, items: [it] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out.sort((a, b) => b.y - a.y);
}

module.exports = { read, lines, rc4 };
