// CA (tax and compliance) page model. Reads the master sheet tabs and returns month-by-month totals
// that the page adds up for the period the CA picks (a financial year or till date):
//   GST     customer consideration received (AV, less refunds, plus TDS the buyers deducted), GST at the set rate
//   TDS     payments by TDS section (CA Settings head map), TDS deposited, Vendor Bills tab
//   RERA    one row per booked unit with receipts by date, and whether the AV went into the RERA collection account
//   Cash    cash flow by section and head, and the same totals in the indirect-method layout
//   Compliance Calendar, customer TDS certificates (TDS Tracker), non-revenue receipts by category.
// How each cash flow head is treated comes from the "CA Settings" tab, so the CA can change it in the sheet.

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/,/g, '')) ? +v.replace(/,/g, '') : 0);
const dt = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 0) return new Date(Math.round((v - 25569) * 864e5));
  if (typeof v === 'string' && v.trim()) { const d = new Date(v); return isNaN(d) ? null : d; }
  return null;
};
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const s_ = (v) => (v == null ? '' : String(v).trim());
const ym = (d) => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : '';
const fmtD = (d) => (d && !isNaN(d)) ? d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear() : '';
const pct = (v) => (typeof v === 'number' ? (v > 1 ? v / 100 : v) : (typeof v === 'string' && v.trim() ? num(v.replace('%', '')) / (v.includes('%') ? 100 : 1) : null));

// rows of a tab under the header row whose first cell is `first`, as objects keyed by header text
function table(grid, first, minCols = 2) {
  const h = (grid || []).findIndex((r) => r && s_(r[0]) === first && r.filter((x) => !blank(x)).length >= minCols);
  if (h < 0) return [];
  const head = grid[h].map(s_);
  const out = [];
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i]; if (!r || r.every(blank)) continue;
    const o = {}; head.forEach((k, j) => { if (k) o[k] = r[j] ?? null; }); out.push(o);
  }
  return out;
}

// Line names used by the indirect-method layout (CA Settings, "Indirect Method Line")
const L = {
  ADV: 'Advances received from customers', GSTC: 'GST collected from customers', SDRC: 'SDR collected from customers',
  OTH: 'Other operating receipts', REF: 'Refunds to customers', PROJ: 'Project cost (added to inventory)',
  EXP: 'Indirect expenses (P&L)', GSTP: 'GST paid to government', SDRP: 'SDR paid for customers', TDSP: 'TDS deposited',
};

function settingsFrom(grid) {
  const S = { gstRate: 0.05, reraAcct: 'Yes RERA Collection 100% (0700)', reraStart: new Date(2026, 0, 22).getTime(), refundHead: 'Flat - Cancelled Refunded', tdsRate: 0.01, found: false };
  const map = { Receipt: {}, Payment: {} };
  if (!grid) return { S, map };
  S.found = true;
  const val = (label) => { const r = grid.find((x) => x && s_(x[0]).toLowerCase() === label.toLowerCase()); return r ? r[1] : null; };
  const g = pct(val('GST rate on customer consideration')); if (g != null) S.gstRate = g;
  const t = pct(val('Customer TDS rate')); if (t != null) S.tdsRate = t;
  if (!blank(val('RERA collection account'))) S.reraAcct = s_(val('RERA collection account'));
  const d = dt(val('RERA collection account opened on')); if (d) S.reraStart = d.getTime();
  if (!blank(val('Customer refund head'))) S.refundHead = s_(val('Customer refund head'));
  for (const r of table(grid, 'Side', 3)) {
    const side = s_(r['Side']), head = s_(r['Cash Flow Head']);
    if (!map[side] || !head) continue;
    const rate = pct(r['TDS Rate']);
    map[side][head] = { sec: s_(r['Cash Flow Section']) || 'Operating', line: s_(r['Indirect Method Line']), tsec: s_(r['TDS Section']), trate: rate || 0, cat: s_(r['Non-Revenue Category']), note: s_(r['Note']) };
  }
  return { S, map };
}

function buildCaModel(tabs, today) {
  today = today || new Date();
  const { S, map } = settingsFrom(tabs['CA Settings']);
  const rows = (n) => table(tabs[n] || [], n === 'Bookings' ? 'Unit' : (n === 'Receipts' ? 'Receipt ID' : 'Payment ID'));

  // ---- receipts and payments (bounced cheques left out of every total) ----
  const R = rows('Receipts').filter((r) => !blank(r['Amount'])).map((r) => {
    const d = dt(r['Date']);
    return { id: s_(r['Receipt ID']), t: d ? d.getTime() : 0, ym: ym(d), d: fmtD(d), bank: s_(r['Bank Account']), desc: s_(r['Description']), amt: num(r['Amount']),
      cfh: s_(r['Cash Flow Head']), ph: s_(r['Payment Head']), unit: s_(r['Unit']), payer: s_(r['Payer Name']), pt: s_(r['Payer Type']), chq: s_(r['Cheque Status']), rm: s_(r['Remark']) };
  });
  const P = rows('Payments Out').filter((r) => !blank(r['Amount'])).map((r) => {
    const d = dt(r['Date']);
    return { id: s_(r['Payment ID']), t: d ? d.getTime() : 0, ym: ym(d), d: fmtD(d), bank: s_(r['Bank Account']), desc: s_(r['Description']), amt: num(r['Amount']),
      cfh: s_(r['Cash Flow Head']), unit: s_(r['Unit']), rm: s_(r['Remark']) };
  });
  const RC = R.filter((r) => r.chq !== 'Bounced');

  // Classify every row once; the page and the click-through lists use the same tags.
  // k = indirect line / bucket, sec = cash flow section, cat = non-revenue category
  const custLine = { AV: L.ADV, GST: L.GSTC, SDR: L.SDRC, Unclassified: L.ADV };
  for (const r of RC) {
    const m = map.Receipt[r.cfh];
    r.sec = m ? m.sec : 'Not mapped';
    r.k = m ? (m.line || '') : 'Not mapped';
    // customer money: the Payment Head column decides AV / GST / SDR
    if (r.ph && custLine[r.ph] && (!m || m.sec === 'Operating')) { r.k = custLine[r.ph]; r.sec = 'Operating'; }
    r.cat = r.ph ? 'Customer receipts (revenue)' : (m ? (m.cat || '') : 'Not mapped');
    r.cav = r.ph === 'AV' && !!r.unit; // AV from a customer against a flat
  }
  for (const p of P) {
    const m = map.Payment[p.cfh];
    p.sec = m ? m.sec : 'Not mapped';
    p.k = m ? (m.line || '') : 'Not mapped';
    p.tsec = m ? m.tsec : ''; p.trate = m ? m.trate : 0;
    if (p.cfh === S.refundHead) { p.k = L.REF; p.sec = 'Operating'; }
  }

  // ---- month list (financial years Apr-Mar) ----
  const allYm = [...new Set([...RC, ...P].map((r) => r.ym).filter(Boolean))].sort();
  const fyOf = (k) => { const [y, m] = k.split('-').map(Number); const s = m >= 4 ? y : y - 1; return 'FY ' + s + '-' + String(s + 1).slice(2); };
  const fys = [...new Set(allYm.map(fyOf))].sort();

  // sums by key and month: add(obj, key, ym, amt)
  const add = (o, k, m, a) => { const x = (o[k] = o[k] || {}); x[m || '-'] = (x[m || '-'] || 0) + a; };
  const recBy = {}, payBy = {}, lineBy = {}, catBy = {}, secIn = {}, secOut = {};
  for (const r of RC) { add(recBy, r.cfh || '(blank)', r.ym, r.amt); if (r.sec !== 'Operating') add(secIn, r.sec + '|' + (r.cfh || '(blank)'), r.ym, r.amt); else add(lineBy, r.k || 'Not mapped', r.ym, r.amt); if (r.cat !== 'Customer receipts (revenue)') add(catBy, r.cat || 'Not mapped', r.ym, r.amt); }
  for (const p of P) { add(payBy, p.cfh || '(blank)', p.ym, p.amt); if (p.sec !== 'Operating') add(secOut, p.sec + '|' + (p.cfh || '(blank)'), p.ym, p.amt); else add(lineBy, p.k || 'Not mapped', p.ym, -p.amt); }

  // ---- GST module ----
  const gst = { av: {}, avOther: {}, ref: {}, gstIn: {}, gstPaid: {}, tds: {} };
  for (const r of RC) {
    if (r.cav) add(gst, r.pt === 'Current buyer' ? 'av' : 'avOther', r.ym, r.amt);
    if (r.ph === 'GST') add(gst, 'gstIn', r.ym, r.amt);
  }
  for (const p of P) { if (p.cfh === S.refundHead) add(gst, 'ref', p.ym, p.amt); if (p.k === L.GSTP) add(gst, 'gstPaid', p.ym, p.amt); }

  // ---- customer TDS (TDS Tracker: entries block from "Entry ID") ----
  const ctds = { entries: [], due: 0, paid: 0, flats: 0 };
  const tg = tabs['TDS Tracker'] || [];
  const th = tg.findIndex((r) => r && s_(r[0]) === 'Unit' && s_(r[4]).startsWith('TDS Due'));
  if (th >= 0) {
    const hr = tg[th].map(s_), ec = hr.indexOf('Entry ID'), lc = hr.findIndex((x) => x.startsWith('Form 16B Certificate'));
    for (let i = th + 1; i < tg.length; i++) {
      const r = tg[i]; if (!r) continue;
      if (!blank(r[0]) && num(r[4]) > 0) { ctds.due += num(r[4]); ctds.paid += num(r[5]); ctds.flats++; }
      if (ec >= 0 && !blank(r[ec + 2]) && !blank(r[ec + 6])) {
        const d = dt(r[ec + 1]);
        const e = { id: s_(r[ec]), t: d ? d.getTime() : 0, ym: ym(d), d: fmtD(d), unit: s_(r[ec + 2]), n: s_(r[ec + 3]), dem: s_(r[ec + 4]), amt: num(r[ec + 6]),
          ch: s_(r[ec + 7]), bank: s_(r[ec + 8]), f16: s_(r[ec + 9]), src: s_(r[ec + 10]), rm: s_(r[ec + 11]), link: lc >= 0 ? s_(r[lc]) : '' };
        ctds.entries.push(e); add(gst, 'tds', e.ym, e.amt);
      }
    }
  }

  // ---- RERA module: bookings + AV receipts by date ----
  const units = [];
  const idx = {};
  for (const b of rows('Bookings')) {
    const u = s_(b['Unit']); if (!u || idx[u] != null) continue;
    const av = Math.round(num(b['Agreement Value']));
    const al = dt(b['Allotment Date']), rd = dt(b['Registration Date']);
    idx[u] = units.length;
    units.push({ u, w: s_(b['Wing']), typ: s_(b['Typology']), area: num(b['Carpet (sq.ft)']), st: s_(b['CRM Status']), n: s_(b['Applicant 1']), av,
      bd: fmtD(al), bt: al ? al.getTime() : 0, rd: fmtD(rd), rs: s_(b['Registration Status']) });
  }
  // [unit index, time, amount, 1 = into the RERA collection account, 1 = before that account opened]
  const avr = [];
  for (const r of RC) if (r.cav && idx[r.unit] != null) avr.push([idx[r.unit], r.t, r.amt, r.bank === S.reraAcct ? 1 : 0, r.t && r.t < S.reraStart ? 1 : 0]);
  const tdsr = ctds.entries.filter((e) => idx[e.unit] != null).map((e) => [idx[e.unit], e.t, e.amt]);

  // ---- Vendor Bills ----
  const vb = table(tabs['Vendor Bills'] || [], 'Bill ID', 4).filter((r) => !blank(r['Vendor Name']) || num(r['Total Bill']) || num(r['Taxable Value'])).map((r) => {
    const d = dt(r['Bill Date']), dd = dt(r['TDS Deposited On']);
    return { id: s_(r['Bill ID']), t: d ? d.getTime() : 0, ym: ym(d), d: fmtD(d), v: s_(r['Vendor Name']), pan: s_(r['Vendor PAN']), cfh: s_(r['Cash Flow Head']), tsec: s_(r['TDS Section']),
      no: s_(r['Bill No.']), tv: num(r['Taxable Value']), gst: num(r['GST on Bill']), tot: num(r['Total Bill']) || num(r['Taxable Value']) + num(r['GST on Bill']),
      rate: pct(r['TDS Rate']) || 0, tds: num(r['TDS Deducted']), paid: num(r['Paid Amount']), pid: s_(r['Payment ID(s)']), ch: s_(r['TDS Challan No.']), dd: fmtD(dd), rm: s_(r['Remark']) };
  });

  // ---- Compliance Calendar ----
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const cc = table(tabs['Compliance Calendar'] || [], 'Compliance', 4).filter((r) => !blank(r['Compliance'])).map((r) => {
    const d = dt(r['Due Date']), c = dt(r['Date Complied']), st = s_(r['Status']) || 'Pending';
    const open = st !== 'Complied' && st !== 'Not applicable';
    const due = d ? d.getTime() : 0;
    return { c: s_(r['Compliance']), law: s_(r['Law']), per: s_(r['Period']), d: fmtD(d), t: due, st, cd: fmtD(c), ack: s_(r['Acknowledgement / Challan No.']), who: s_(r['Responsible']), rm: s_(r['Remark']),
      state: !open ? st : (due && due < t0 ? 'Overdue' : (due && due <= t0 + 30 * 864e5 ? 'Due in 30 days' : 'Upcoming')),
      late: !open ? (c && d && c > d ? Math.round((c - d) / 864e5) : 0) : (due && due < t0 ? Math.round((t0 - due) / 864e5) : 0) };
  }).sort((a, b) => a.t - b.t);

  // heads seen in the data but missing from the CA Settings head map
  const unmapped = {
    Receipt: [...new Set(RC.filter((r) => !map.Receipt[r.cfh] && !(r.ph && custLine[r.ph])).map((r) => r.cfh || '(blank)'))],
    Payment: [...new Set(P.filter((p) => !map.Payment[p.cfh]).map((p) => p.cfh || '(blank)'))],
  };
  const latest = [...RC, ...P].reduce((m, r) => (r.t > m && r.t <= today.getTime() ? r.t : m), 0);

  return {
    summary: {
      settings: { ...S, reraStartD: fmtD(new Date(S.reraStart)) }, map, unmapped, fys, months: allYm, latest: fmtD(latest ? new Date(latest) : null),
      recBy, payBy, lineBy, catBy, secIn, secOut, gst, units, avr, tdsr,
      ctds: { due: Math.round(ctds.due), paid: Math.round(ctds.paid), flats: ctds.flats, entries: ctds.entries },
      vb, cc, tabs: { settings: !!tabs['CA Settings'], vb: !!tabs['Vendor Bills'], cc: !!tabs['Compliance Calendar'] },
    },
    // rows behind the figures, for the click-through lists
    detail: {
      R: RC.map(({ id, t, ym, d, bank, desc, amt, cfh, ph, unit, payer, pt, chq, rm, sec, k, cat, cav }) => ({ id, t, ym, d, bank, desc, amt, cfh, ph, unit, payer, pt, chq, rm, sec, k, cat, cav })),
      P: P.map(({ id, t, ym, d, bank, desc, amt, cfh, unit, rm, sec, k, tsec, trate }) => ({ id, t, ym, d, bank, desc, amt, cfh, unit, rm, sec, k, tsec, trate })),
    },
  };
}

const CA_TABS = ['Receipts', 'Payments Out', 'Bookings', 'TDS Tracker'];
const CA_OPTIONAL_TABS = ['CA Settings', 'Vendor Bills', 'Compliance Calendar'];
module.exports = { buildCaModel, CA_TABS, CA_OPTIONAL_TABS, L };
