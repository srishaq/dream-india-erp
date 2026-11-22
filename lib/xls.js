// Reads an old Excel 97-2003 workbook (.xls, BIFF8 inside an OLE2 compound file) with no npm packages: the HDFC
// statements Dream Aspire's team download come as .xls. read(buf) → [{ name, rows }], the same shape as lib/xlsx.js:
// numbers as numbers, text as text, cells with a date format as 'YYYY-MM-DD[ HH:MM:SS]'.
const { serialToText } = require('./xlsx');

const isXls = (buf) => buf && buf.length > 512 && buf.readUInt32LE(0) === 0xE011CFD0 && buf.readUInt32LE(4) === 0xE11AB1A1;

// ---- OLE2 compound file: find the Workbook stream ----
function workbookStream(buf) {
  const secShift = buf.readUInt16LE(30), miniShift = buf.readUInt16LE(32);
  const SEC = 1 << secShift, MINI = 1 << miniShift;
  const nFat = buf.readUInt32LE(44), dirStart = buf.readInt32LE(48), miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readInt32LE(60), nMiniFat = buf.readUInt32LE(64);
  let difStart = buf.readInt32LE(68); const nDif = buf.readUInt32LE(72);
  const off = (s) => 512 + s * SEC;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = buf.readInt32LE(76 + i * 4); if (s >= 0) fatSecs.push(s); }
  for (let k = 0; k < nDif && difStart >= 0 && fatSecs.length < nFat; k++) {
    const o = off(difStart), per = SEC / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) { const s = buf.readInt32LE(o + i * 4); if (s >= 0) fatSecs.push(s); }
    difStart = buf.readInt32LE(o + per * 4);
  }
  const fat = [];
  for (const s of fatSecs) { const o = off(s); for (let i = 0; i < SEC / 4; i++) fat.push(buf.readInt32LE(o + i * 4)); }
  const chain = (start) => { const out = []; let s = start, guard = 0; while (s >= 0 && guard++ < 1e6) { out.push(s); s = fat[s]; } return out; };
  const readChain = (start) => Buffer.concat(chain(start).map((s) => buf.subarray(off(s), off(s) + SEC)));
  const dir = readChain(dirStart);
  const entries = [];
  for (let i = 0; i + 128 <= dir.length; i += 128) {
    const nameLen = dir.readUInt16LE(i + 64);
    const name = dir.subarray(i, i + Math.max(0, nameLen - 2)).toString('utf16le');
    entries.push({ name, type: dir[i + 66], start: dir.readInt32LE(i + 116), size: dir.readUInt32LE(i + 120) });
  }
  const wb = entries.find((e) => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
  if (!wb) throw new Error('No workbook inside this .xls file.');
  if (wb.size >= miniCutoff) return readChain(wb.start).subarray(0, wb.size);
  // a small workbook lives in the mini stream
  const root = entries[0];
  const miniStream = readChain(root.start);
  const miniFat = [];
  if (miniFatStart >= 0) { const mf = readChain(miniFatStart); for (let i = 0; i < nMiniFat * SEC / 4; i++) miniFat.push(mf.readInt32LE(i * 4)); }
  const parts = []; let s = wb.start, guard = 0;
  while (s >= 0 && guard++ < 1e6) { parts.push(miniStream.subarray(s * MINI, s * MINI + MINI)); s = miniFat[s]; }
  return Buffer.concat(parts).subarray(0, wb.size);
}

// ---- BIFF8 records ----
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateCode = (code) => { const c = String(code || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); return /[dmyhs]/i.test(c) && !/^[#0.,%\s]*$/.test(c) && !/general/i.test(c); };
function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else { const b = Buffer.alloc(8); b.writeUInt32LE(0, 0); b.writeUInt32LE((v & 0xFFFFFFFC) >>> 0, 4); n = b.readDoubleLE(0); }
  return v & 1 ? n / 100 : n;
}

function read(buf) {
  if (!isXls(buf)) throw Object.assign(new Error('This is not an Excel 97-2003 (.xls) file.'), { status: 400 });
  const w = workbookStream(buf);
  // the records, with CONTINUE records kept apart (the shared strings run across them)
  const recs = [];
  for (let p = 0; p + 4 <= w.length;) {
    const id = w.readUInt16LE(p), len = w.readUInt16LE(p + 2);
    recs.push({ id, pos: p, data: w.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  const formats = {}, xfDate = [], sheets = [], sst = [];
  let date1904 = false;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i], d = r.data;
    if (r.id === 0x0022) date1904 = d.readUInt16LE(0) === 1;
    else if (r.id === 0x041E) { const id = d.readUInt16LE(0); formats[id] = readStr(d, 2, true).s; }
    else if (r.id === 0x00E0) { const fmt = d.readUInt16LE(2); xfDate.push(BUILTIN_DATE.has(fmt) || isDateCode(formats[fmt])); }
    else if (r.id === 0x0085) sheets.push({ pos: d.readUInt32LE(0), hidden: d[4], type: d[5], name: readStr(d, 6, false).s });
    else if (r.id === 0x00FC) {
      // SST: total, unique, then strings; a string may be split across CONTINUE records (each restarting with an option byte)
      const chunks = [d]; let j = i + 1; while (j < recs.length && recs[j].id === 0x003C) chunks.push(recs[j++].data);
      const n = d.readUInt32LE(4); let ci = 0, p = 8;
      for (let k = 0; k < n && ci < chunks.length; k++) {
        if (p >= chunks[ci].length) { ci++; p = 0; if (ci >= chunks.length) break; }
        let c = chunks[ci];
        const len = c.readUInt16LE(p); let opt = c[p + 2]; p += 3;
        let rich = 0, ext = 0;
        if (opt & 0x08) { rich = c.readUInt16LE(p); p += 2; }
        if (opt & 0x04) { ext = c.readInt32LE(p); p += 4; }
        let s = '', left = len;
        while (left > 0) {
          if (p >= c.length) { ci++; c = chunks[ci]; if (!c) break; opt = c[0]; p = 1; }
          const wide = opt & 1, avail = Math.floor((c.length - p) / (wide ? 2 : 1)), take = Math.min(left, avail);
          s += wide ? c.subarray(p, p + take * 2).toString('utf16le') : c.subarray(p, p + take).toString('latin1');
          p += take * (wide ? 2 : 1); left -= take;
        }
        let skip = rich * 4 + ext;
        while (skip > 0 && c) { const can = Math.min(skip, c.length - p); p += can; skip -= can; if (skip > 0) { ci++; c = chunks[ci]; p = 0; } }
        sst.push(s);
      }
      i = j - 1;
    }
  }
  const val = (xf, num) => (xfDate[xf] && Number.isFinite(num) ? serialToText(date1904 ? num + 1462 : num) : num);
  return sheets.filter((s) => s.type === 0).map((sh) => {
    const rows = [];
    const set = (r, c, v) => { (rows[r] = rows[r] || [])[c] = v; };
    let i = recs.findIndex((x) => x.pos === sh.pos);
    if (i < 0) return { name: sh.name, rows: [] };
    let pendingFormula = null;
    for (i++; i < recs.length; i++) {
      const { id, data: d } = recs[i];
      if (id === 0x000A) break; // EOF of the sheet
      if (id === 0x00FD) set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
      else if (id === 0x0203) set(d.readUInt16LE(0), d.readUInt16LE(2), val(d.readUInt16LE(4), d.readDoubleLE(6)));
      else if (id === 0x027E) set(d.readUInt16LE(0), d.readUInt16LE(2), val(d.readUInt16LE(4), rk(d.readInt32LE(6))));
      else if (id === 0x00BD) { const r = d.readUInt16LE(0), c0 = d.readUInt16LE(2), n = (d.length - 6) / 6; for (let k = 0; k < n; k++) set(r, c0 + k, val(d.readUInt16LE(4 + k * 6), rk(d.readInt32LE(6 + k * 6)))); }
      else if (id === 0x0204) set(d.readUInt16LE(0), d.readUInt16LE(2), readStr(d, 6, true).s);
      else if (id === 0x0205) set(d.readUInt16LE(0), d.readUInt16LE(2), d[7] === 0 ? !!d[6] : null);
      else if (id === 0x0006) {
        const r = d.readUInt16LE(0), c = d.readUInt16LE(2), xf = d.readUInt16LE(4);
        if (d.readUInt16LE(12) === 0xFFFF) { const t = d[6]; if (t === 0) pendingFormula = { r, c }; else if (t === 1) set(r, c, !!d[8]); else set(r, c, null); }
        else set(r, c, val(xf, d.readDoubleLE(6)));
      } else if (id === 0x0207 && pendingFormula) { set(pendingFormula.r, pendingFormula.c, readStr(d, 0, true).s); pendingFormula = null; }
    }
    for (let r = 0; r < rows.length; r++) { if (!rows[r]) rows[r] = []; for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === undefined) rows[r][c] = null; }
    return { name: sh.name, rows };
  });
}
// a BIFF8 string at p: length (2 bytes, or 1 for sheet names), option byte, then the characters
function readStr(d, p, long) {
  const len = long ? d.readUInt16LE(p) : d[p]; p += long ? 2 : 1;
  const opt = d[p]; p += 1;
  if (opt & 0x08) p += 2; if (opt & 0x04) p += 4;
  const wide = opt & 1;
  const s = wide ? d.subarray(p, p + len * 2).toString('utf16le') : d.subarray(p, p + len).toString('latin1');
  return { s, end: p + len * (wide ? 2 : 1) };
}

module.exports = { read, isXls };
