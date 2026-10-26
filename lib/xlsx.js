// Minimal .xlsx reader (no npm deps): unzips with zlib and reads cell values from the sheet XML.
// read(buffer) -> [{ name, rows: [[value, ...], ...] }] in workbook order.
// Values: numbers, strings, booleans; cells formatted as dates come back as 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'.
// Formulas give their last saved value. Enough for bank statements; not a general spreadsheet library.
const zlib = require('zlib');

function unzip(buf) {
  // Find the end-of-central-directory record (it sits in the last 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('This is not an Excel (.xlsx) file.'), { status: 400 });
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtra;
    files[name] = { method, data: buf.slice(start, start + csize) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const f = files[name] || files[name.replace(/^\//, '')];
    if (!f) return null;
    if (f.method === 0) return f.data.toString('utf8');
    if (f.method === 8) return zlib.inflateRawSync(f.data).toString('utf8');
    throw new Error(`Unsupported zip compression in ${name}`);
  };
}

const ent = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? ent(m[1]) : null; };
// Text of a shared-string / inline-string item: all <t> runs joined (ignores phonetic runs).
const textOf = (xml) => { let out = ''; xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, t) => { out += ent(t); return m; }); return out; };

const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function dateStyles(stylesXml) {
  if (!stylesXml) return new Set();
  const custom = {};
  stylesXml.replace(/<numFmt\b[^>]*>/g, (t) => { custom[+attr(t, 'numFmtId')] = attr(t, 'formatCode') || ''; return t; });
  const isDateFmt = (id) => {
    if (BUILTIN_DATE.has(id)) return true;
    const code = custom[id]; if (!code) return false;
    const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(c) && !/^[#0.,%\s]*$/.test(c);
  };
  const out = new Set();
  const xfs = (stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
  let i = 0;
  xfs.replace(/<xf\b[^>]*>/g, (t) => { if (isDateFmt(+attr(t, 'numFmtId'))) out.add(i); i++; return t; });
  return out;
}

// Excel serial (1900 system) to 'YYYY-MM-DD[ HH:MM:SS]'.
function serialToText(v) {
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return v;
  const iso = d.toISOString();
  const time = iso.slice(11, 19);
  return time === '00:00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
}

function read(buf) {
  const get = unzip(buf);
  const wb = get('xl/workbook.xml');
  if (!wb) throw Object.assign(new Error('This is not an Excel (.xlsx) file.'), { status: 400 });
  const rels = {};
  (get('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b[^>]*>/g, (t) => { rels[attr(t, 'Id')] = attr(t, 'Target'); return t; });
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) ss.replace(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g, (m, inner) => { shared.push(inner ? textOf(inner) : ''); return m; });
  const dates = dateStyles(get('xl/styles.xml'));
  const date1904 = /date1904="(1|true)"/.test(wb);
  const sheets = [];
  wb.replace(/<sheet\b[^>]*>/g, (t) => { sheets.push({ name: attr(t, 'name'), rid: attr(t, 'r:id') }); return t; });
  return sheets.map(({ name, rid }) => {
    let target = rels[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = get(target) || '';
    const rows = [];
    xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g, (m, rattr, inner, rattr2) => {
      const r = +(attr(`<x ${rattr || rattr2}>`, 'r')) || rows.length + 1;
      const row = [];
      if (inner) inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, cattr, cin) => {
        const tag = `<c ${cattr}>`;
        const ref = attr(tag, 'r'); const t = attr(tag, 't'); const s = +(attr(tag, 's') || 0);
        const ci = ref ? colIndex(ref) : row.length;
        let v = null;
        if (cin) {
          const vm = cin.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          const raw = vm ? ent(vm[1]) : null;
          if (t === 's') v = raw == null ? null : shared[+raw] ?? '';
          else if (t === 'inlineStr') v = textOf(cin);
          else if (t === 'str' || t === 'e') v = raw;
          else if (t === 'b') v = raw === '1';
          else if (raw != null && raw !== '') {
            v = Number(raw);
            if (Number.isFinite(v) && dates.has(s)) v = serialToText(date1904 ? v + 1462 : v);
          }
        }
        row[ci] = v;
        return cm;
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows[r - 1] = row;
      return m;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return { name, rows };
  });
}

module.exports = { read, serialToText };
