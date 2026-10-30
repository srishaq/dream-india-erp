// A spreadsheet the browser sent as base64 (.xlsx, .csv or .txt) to rows of text cells, first sheet only.
const xlsx = require('./xlsx');
const err = (status, message) => Object.assign(new Error(message), { status });

function csv(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] || '';
  const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseFile(b64, name, maxRows = 5000) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (!buf.length) throw err(400, 'The file is empty.');
  if (buf.length > 3 * 1024 * 1024) throw err(400, 'The file is larger than 3 MB. Please split it.');
  let rows;
  if (/\.xlsx$/i.test(name || '') || buf.slice(0, 2).toString() === 'PK') {
    try { rows = (xlsx.read(buf)[0] || { rows: [] }).rows; } catch { throw err(400, 'This Excel file could not be read. Please save it again as .xlsx or .csv.'); }
  } else if (/\.xls$/i.test(name || '')) throw err(400, 'Old .xls files cannot be read. Please save it as .xlsx or .csv.');
  else rows = csv(buf.toString('utf8'));
  rows = (rows || []).map((r) => Array.from(r || [], (v) => (v == null ? "" : String(v)))).filter((r) => r.some((v) => v.trim()));
  if (rows.length > maxRows + 1) throw err(400, `This file has ${rows.length.toLocaleString('en-IN')} rows. Please upload at most ${maxRows.toLocaleString('en-IN')} at a time.`);
  return rows;
}
module.exports = { csv, parseFile };
