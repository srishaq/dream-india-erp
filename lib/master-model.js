// Master accounts dashboard model: turns tab values from the "Dream Signature Master Accounts - FINAL"
// Google Sheet (Sheets API, UNFORMATTED_VALUE + SERIAL_NUMBER dates) into the numbers the page shows.
// buildFromWorkbook is the same calculation the dashboard was verified with; the shim below lets it read
// plain value grids instead of a SheetJS workbook.
const { buildTenants } = require('./tenants-model');
// Builds the dashboard dataset from the master sheet workbook (SheetJS workbook, read with cellDates:true).
function buildFromWorkbook(XLSX, wb, today) {
  const sh = n => { const ws = wb.Sheets[n]; if (!ws) throw new Error('Tab "' + n + '" not found in the sheet'); return ws; };
  const rows = (n, headerRow) => XLSX.utils.sheet_to_json(sh(n), { range: headerRow - 1, defval: null, raw: true });
  const grid = n => XLSX.utils.sheet_to_json(sh(n), { header: 1, defval: null, raw: true });
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/,/g, '')) ? +v.replace(/,/g, '') : 0);
  const dt = v => v instanceof Date ? v : (typeof v === 'number' ? new Date(Math.round((v - 25569) * 864e5)) : (v ? new Date(v) : null));
  const blank = v => v == null || (typeof v === 'string' && v.trim() === '');
  const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

  today = today || new Date();
  const realNow = today; // "today" is moved to the latest sheet entry below; the tenant rent year needs the real date

  const R = rows('Receipts', 1).filter(r => !blank(r['Amount'])).map(r => ({ ...r, Date: dt(r['Date']), Amount: num(r['Amount']) }));
  const P = rows('Payments Out', 1).filter(r => !blank(r['Amount'])).map(r => ({ ...r, Date: dt(r['Date']), Amount: num(r['Amount']) }));

  // "This month" = the month of the latest entry in the sheet (not the calendar month), so a new month shows data only once entries start
  const lastEntry = [...R, ...P].reduce((m, r) => (r.Date && r.Date <= today && r.Date > m ? r.Date : m), new Date(0));
  const ref = lastEntry.getTime() > 0 ? lastEntry : today;
  const MS = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const FY = new Date(ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1, 3, 1);
  today = ref;
  const MN0 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtD = d => (d && !isNaN(d)) ? d.getDate() + ' ' + MN0[d.getMonth()] + ' ' + d.getFullYear() : '';
  const tri = a => ({ m: Math.round(a.filter(r => r.Date && r.Date >= MS).reduce((s, r) => s + r.Amount, 0)), fy: Math.round(a.filter(r => r.Date && r.Date >= FY).reduce((s, r) => s + r.Amount, 0)), td: Math.round(a.reduce((s, r) => s + r.Amount, 0)), n: a.length });
  const group = (a, k) => a.reduce((o, r) => { const key = r[k] == null ? '(blank)' : String(r[k]); (o[key] = o[key] || []).push(r); return o; }, {});

  const ok = R.filter(r => r['Cheque Status'] !== 'Bounced');
  const cust = ok.filter(r => !blank(r['Payment Head']));
  const cb = cust.filter(r => r['Payer Type'] === 'Current buyer' && !blank(r['Unit']));
  const C = {};
  for (const h of ['AV', 'GST', 'SDR', 'Unclassified']) {
    const x = cb.filter(r => r['Payment Head'] === h); C[h] = tri(x);
    C[h].by = {}; for (const [k, g] of Object.entries(group(x, 'Bank Account'))) C[h].by[k] = tri(g);
  }
  C.other = tri(cust.filter(r => r['Payer Type'] === 'Other / earlier buyer' && !blank(r['Unit'])));
  C.nounit = tri(cust.filter(r => blank(r['Unit'])));
  C.bounced = tri(R.filter(r => r['Cheque Status'] === 'Bounced'));
  const PH = {}; for (const [k, g] of Object.entries(group(P, 'Cash Flow Head'))) PH[k] = tri(g);

  // money in / out by month, last 12 months ending this month
  const flow12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1), m = ym(d);
    flow12.push({ m, in: Math.round(ok.filter(r => r.Date && ym(r.Date) === m).reduce((s, r) => s + r.Amount, 0)), out: Math.round(P.filter(r => r.Date && ym(r.Date) === m).reduce((s, r) => s + r.Amount, 0)) });
  }

  // bookings (header on row 3)
  const units = rows('Bookings', 3).filter(r => !blank(r['Unit'])).map(r => ({
    u: String(r['Unit']), w: String(r['Wing'] ?? ''), s: r['CRM Status'] ?? '', n: r['Applicant 1'] ?? '', cp: r['CP Firm (CRM)'] ?? '', t: r['Typology'] ?? '',
    av: Math.round(num(r['Agreement Value'])), rav: Math.round(num(r['Received AV (Bank)'])), bav: Math.round(num(r['AV Balance'])),
    bg: Math.round(num(r['GST Balance'])), bs: Math.round(num(r['SDR Balance'])), bo: Math.round(num(r['Bounced Cheques on Unit'])),
    reg: r['Registration Status'] ?? '', ga: Math.round(num(r['GST @5%'])), rg: Math.round(num(r['Received GST (Bank)'])), rsd: Math.round(num(r['Received SDR (Bank)'])),
    sp: Math.round(num(r['SDR Payable'])), spo: Math.round(num(r['SDR Paid Out (Challans)'])), ref: Math.round(num(r['Refunds Paid on Unit'])),
    // CA's per-unit view: booking and registration dates, money received in the bank, TDS paid by the buyer
    // (TDS Tracker), their total, and the CRM ledger total (incl. TDS) it should match
    ...(() => { const bd = dt(r['Allotment Date']), rd = dt(r['Registration Date']);
      const bk = Math.round(num(r['Total Received (Bank)'])), tx = Math.round(num(r['TDS Received (TDS Tracker)']));
      const crm = Math.round(num(r['CRM Ledger Total']) + num(r['CRM Ledger: TDS']));
      return { bd: fmtD(bd), bdt: bd && !isNaN(bd) ? bd.getTime() : 0, rd: fmtD(rd), rdt: rd && !isNaN(rd) ? rd.getTime() : 0,
        bk, tx, tot: bk + tx, crm, df: bk + tx - crm }; })(),
  }));

  // daily bank balance summary: rows from the header ("Bank") to GRAND TOTAL
  const g = grid('Daily Bank Balance');
  let h = g.findIndex(r => r && r[0] === 'Bank'); const banks = [];
  for (let i = h + 1; i < g.length && h >= 0; i++) {
    const r = g[i]; if (!r || blank(r[0])) continue;
    banks.push({ b: String(r[0]).trim(), no: r[1], op: num(r[2]), rc: num(r[3]), py: num(r[4]), cl: num(r[5]) });
    if (String(r[0]).trim() === 'GRAND TOTAL') break;
  }
  const reportDate = dt(g[1] && g[1][1]);
  // daily entries below the summary (header row "Date", "Bank", "Receipts", ...)
  const de = g.findIndex(r => r && r[0] === 'Date' && r[1] === 'Bank'); const daily = [];
  for (let i = de + 1; i < g.length && de >= 0; i++) {
    const r = g[i]; if (!r || blank(r[1])) continue;
    daily.push({ d: fmtD(dt(r[0])), b: String(r[1]).trim(), rc: num(r[2]), py: num(r[3]), rm: r[4] ?? '', by: r[5] ?? '' });
  }

  // reconciling items (header row contains "Item #")
  const rg = grid('Reconciling Items'); const rh = rg.findIndex(r => r && r[0] === 'Item #'); const ri = [];
  for (let i = rh + 1; i < rg.length && rh >= 0; i++) {
    const r = rg[i]; if (!r || blank(r[0]) || typeof r[5] !== 'number') continue;
    ri.push({ acct: r[1], cat: r[8], amt: Math.abs(r[5]), age: r[6], bk: r[7], st: r[11], esc: r[14],
      n: r[0], side: r[2] ?? '', d: fmtD(dt(r[3])), desc: r[4] ?? '', what: r[9] ?? '', act: r[10] ?? '', own: r[12] ?? '', ref: r[15] ?? '' });
  }

  // checks: numbered rows, status in column G
  const checks = grid('Checks').filter(r => r && typeof r[0] === 'number').map(r => r[6]);

  // CP brokerage paid on cancelled bookings: rows of the CP Cancelled Bookings tab with "For discussion" filled
  const cpc = { rows: [], n: 0, amt: 0, all: 0 };
  if (wb.Sheets['CP Cancelled Bookings']) {
    const all = rows('CP Cancelled Bookings', 1).filter(r => !blank(r['Sr No']) || !blank(r['Old Unit']));
    cpc.all = all.length;
    cpc.rows = all.filter(r => !blank(r['For discussion'])).map(r => ({
      u: String(r['New Unit'] || r['Old Unit'] || ''), ou: String(r['Old Unit'] ?? ''), nu: String(r['Unit (normalised)'] ?? ''), d: fmtD(dt(r['Final Booking Date'])),
      n: r['Name of Applicant 1'] ?? '', t: r['Typology'] ?? '', cp: r['CP Firm Name'] ?? '', av: Math.round(num(r['AV'])), br: num(r['Brokrage released']),
      rm: r['Remark'] ?? '', fd: r['For discussion'] ?? '',
    }));
    cpc.n = cpc.rows.length; cpc.amt = Math.round(cpc.rows.reduce((s, r) => s + r.br, 0));
  }

  // TDS the customers deduct (1% of each demand) and pay to the government: TDS Tracker tab.
  // Left block (from column A) = one row per flat; right block (from "Entry ID") = one row per challan / Form 16B.
  let tds = null;
  if (wb.Sheets['TDS Tracker']) {
    const tg = grid('TDS Tracker');
    const th = tg.findIndex(r => r && r[0] === 'Unit' && String(r[4] || '').startsWith('TDS Due'));
    const ec = th >= 0 ? tg[th].indexOf('Entry ID') : -1;
    tds = { due: 0, paid: 0, flats: [], entries: [] };
    for (let i = th + 1; i < tg.length && th >= 0; i++) {
      const r = tg[i]; if (!r) continue;
      if (!blank(r[0]) && num(r[4]) > 0) tds.flats.push({
        u: String(r[0]), n: r[1] ?? '', s: r[2] ?? '', av: Math.round(num(r[3])), due: Math.round(num(r[4])), paid: Math.round(num(r[5])),
        bal: Math.round(num(r[6])), k: num(r[8]), last: fmtD(dt(r[9])), st: r[10] ?? '',
      });
      if (ec >= 0 && !blank(r[ec + 2]) && !blank(r[ec + 6])) {
        const d = dt(r[ec + 1]);
        tds.entries.push({ id: String(r[ec] ?? ''), d: fmtD(d), t: d ? d.getTime() : 0, unit: String(r[ec + 2]), n: r[ec + 3] ?? '', dem: r[ec + 4] ?? '',
          damt: num(r[ec + 5]), amt: num(r[ec + 6]), ch: String(r[ec + 7] ?? ''), bank: r[ec + 8] ?? '', f16: r[ec + 9] ?? '', src: r[ec + 10] ?? '', rm: r[ec + 11] ?? '' });
      }
    }
    // TDS counts as money received from the customer: period totals for the collections boxes
    for (const e of tds.entries) { e.m = !!(e.t && e.t >= MS.getTime()); e.f = !!(e.t && e.t >= FY.getTime()); }
    const sumE = f => Math.round(tds.entries.filter(f).reduce((s, e) => s + e.amt, 0));
    tds.per = { m: sumE(e => e.m), fy: sumE(e => e.f), td: sumE(() => true), n: tds.entries.length };
    tds.due = tds.flats.reduce((s, f) => s + f.due, 0);
    tds.paid = tds.flats.reduce((s, f) => s + f.paid, 0);
  }

  // PDC: post-dated cheques we have issued (PDC tab, headers on row 4). Days to due date are worked out here
  // from the due date and today's date in India, not taken from the sheet's formula column.
  let pdc = null;
  if (wb.Sheets['PDC']) {
    const pg = grid('PDC');
    const ph = pg.findIndex(r => r && r.some(v => v === 'PDC due date'));
    pdc = { rows: [] };
    if (ph >= 0) {
      const H = pg[ph].map(v => (v == null ? '' : String(v).trim()));
      const col = name => H.findIndex(v => v.toLowerCase().startsWith(name.toLowerCase()));
      const cD = col('Date'), cTo = col('Cheque issued to'), cA = col('Amount'), cB = col('Bank'), cDue = col('PDC due date'),
        cNo = col('Cheque No'), c48 = col('48-hour reminder'), c24 = col('24-hour reminder');
      const at = (r, c) => (c >= 0 ? r[c] : null), s = v => (v == null ? '' : String(v).trim());
      // today in Asia/Kolkata as a day count, and each due date (a sheet serial / date) as the same kind of day count
      const ist = new Date(Date.now() + 5.5 * 36e5), todayN = Math.floor(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 864e5);
      const dayN = v => { if (typeof v === 'number') return Math.floor(v) - 25569; const d = dt(v); return d && !isNaN(d) ? Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) : null; };
      const fmtN = n => (n == null ? '' : (d => d.getUTCDate() + ' ' + MN0[d.getUTCMonth()] + ' ' + d.getUTCFullYear())(new Date(n * 864e5)));
      const sent = v => (blank(v) ? '' : typeof v === 'number' ? fmtN(dayN(v)) : String(v));
      for (let i = ph + 1; i < pg.length; i++) {
        const r = pg[i]; if (!r || blank(at(r, cDue)) || blank(at(r, cA))) continue;
        const due = dayN(at(r, cDue)), given = dayN(at(r, cD)), left = due == null ? null : due - todayN;
        pdc.rows.push({ d: fmtN(given), to: s(at(r, cTo)), amt: Math.round(num(at(r, cA))), bank: s(at(r, cB)), due: fmtN(due), t: due == null ? 0 : due,
          no: s(at(r, cNo)), left, st: left == null ? '' : left < 0 ? 'Past due date' : left === 0 ? 'Due today' : left <= 2 ? 'Due in 48 hours' : 'Upcoming',
          r48: sent(at(r, c48)), r24: sent(at(r, c24)) });
      }
    }
    const tot = a => ({ n: a.length, amt: a.reduce((x, r) => x + r.amt, 0) });
    pdc.d7 = tot(pdc.rows.filter(r => r.left != null && r.left >= 0 && r.left <= 7));
    pdc.d30 = tot(pdc.rows.filter(r => r.left != null && r.left >= 0 && r.left <= 30));
    pdc.up = tot(pdc.rows.filter(r => r.left != null && r.left >= 0));
    pdc.past = tot(pdc.rows.filter(r => r.left != null && r.left < 0));
  }

  // dashboard key figures (label in A, value in B)
  const D = {}; for (const r of grid('Dashboard')) if (r && typeof r[0] === 'string' && typeof r[1] === 'number') D[r[0]] = r[1];

  const latest = [...R.map(r => ({ ...r, T: 'In' })), ...P.map(r => ({ ...r, T: 'Out' }))].filter(r => r.Date).sort((a, b) => b.Date - a.Date).slice(0, 12)
    .map(r => ({ Date: r.Date.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.Date.getMonth()] + ' ' + r.Date.getFullYear(), T: r.T, 'Cash Flow Head': r['Cash Flow Head'], Description: r['Description'], 'Bank Account': r['Bank Account'], Amount: r.Amount, Unit: r['Unit'] }));

  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = d => d ? d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear() : '';
  // Row-level detail behind every figure, for the click-through views. Period flags use the same
  // dates as tri() above, so a list always adds up to the figure it was opened from.
  const per = r => ({ m: !!(r.Date && r.Date >= MS), f: !!(r.Date && r.Date >= FY), ym: r.Date ? ym(r.Date) : '', d: fmtD(r.Date), t: r.Date ? r.Date.getTime() : 0 });
  const s_ = v => (v == null ? '' : String(v));
  const detail = {
    R: R.map(r => ({ id: s_(r['Receipt ID']), ...per(r), bank: s_(r['Bank Account']), desc: s_(r['Description']), ref: s_(r['Reference']), amt: r.Amount,
      cfh: s_(r['Cash Flow Head']), ph: s_(r['Payment Head']), unit: s_(r['Unit']), payer: s_(r['Payer Name']), pt: s_(r['Payer Type']), chq: s_(r['Cheque Status']), rm: s_(r['Remark']) })),
    P: P.map(r => ({ id: s_(r['Payment ID']), ...per(r), bank: s_(r['Bank Account']), desc: s_(r['Description']), ref: s_(r['Reference']), amt: r.Amount,
      cfh: s_(r['Cash Flow Head']), unit: s_(r['Unit']), rm: s_(r['Remark']) })),
  };
  // SRA tenants transit rent (SRA Tenants + Tenant Rent Links tabs), when both tabs exist
  let tenants = null;
  if (wb.Sheets['SRA Tenants'] && wb.Sheets['Tenant Rent Links']) {
    const t = buildTenants(grid('SRA Tenants'), grid('Tenant Rent Links'), P, realNow);
    tenants = t.model;
  }
  return { detail, daily, cpc, tds, pdc, tenants, asof: fmt(reportDate), fyLabel: 'FY ' + FY.getFullYear() + '-' + String(FY.getFullYear() + 1).slice(2), monthLabel: MN[MS.getMonth()] + ' ' + MS.getFullYear(), D, C, PH, units, banks, ri, checks, latest, flow12 };
}

// Minimal stand-in for XLSX.utils.sheet_to_json over a grid (array of row arrays).
const GRID_XLSX = {
  utils: {
    sheet_to_json(grid, opts) {
      const width = grid.reduce((m, r) => Math.max(m, (r || []).length), 0);
      const pad = r => Array.from({ length: width }, (_, i) => (r && r[i] !== undefined && r[i] !== '' ? r[i] : null));
      if (opts.header === 1) return grid.map(pad);
      const start = opts.range || 0;
      const head = pad(grid[start]).map((h, i) => (h == null ? '__EMPTY' + (i ? '_' + i : '') : String(h)));
      const out = [];
      for (let i = start + 1; i < grid.length; i++) {
        const r = pad(grid[i]);
        if (r.every(v => v == null)) continue;
        const o = {}; head.forEach((h, j) => { o[h] = r[j]; }); out.push(o);
      }
      return out;
    },
  },
};

// tabs: { 'Receipts': [[...], ...], ... }
function buildMasterModel(tabs, today) {
  return buildFromWorkbook(GRID_XLSX, { Sheets: tabs }, today);
}

const MASTER_TABS = ['Receipts', 'Payments Out', 'Bookings', 'Daily Bank Balance', 'Reconciling Items', 'Checks', 'Dashboard'];
const OPTIONAL_TABS = ['CP Cancelled Bookings', 'TDS Tracker', 'PDC', 'SRA Tenants', 'Tenant Rent Links'];
module.exports = { buildMasterModel, MASTER_TABS, OPTIONAL_TABS };
