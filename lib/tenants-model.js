// SRA tenants (Goodluck SRA, Dream Signature): transit rent due and paid, per survey no.
// Reads two tabs of the master accounts sheet (headers on row 4, like the PDC tab):
//   "SRA Tenants"       one row per survey no.: tenant, area, Rent 2025, Yearly increase, Other agreed amount ...
//   "Tenant Rent Links" one row per payment: Payment ID -> Survey No (+ optional Rent year / Split amount / Status)
// Amounts and dates come from the Payments Out rows themselves (joined on Payment ID), so the figures always
// match the bank entries. A Tenant Rent payment that is not on the Links tab shows up as "not yet linked".
const TENANT_HEAD = 'Tenant Rent';
const YEARS = [2025, 2026, 2027];

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/,/g, '')) ? +v.replace(/,/g, '') : 0);
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const s = (v) => (v == null ? '' : String(v).trim());
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (d) => (d && !isNaN(d) ? d.getUTCDate() + ' ' + MN[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : '');
// Rent year of a payment: the advance for a year is paid from January; Oct-Dec payments are next year's advance.
const rentYear = (d) => (d && !isNaN(d) ? (d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()) : null);
// "Tenent Rent - Annexure No. 63" -> 63 (accounts already write the survey no. this way in the Remark)
const annexure = (t) => { const m = /annex\w*\s*(?:no\.?)?\s*-?\s*(\d{1,3})\b/i.exec(t || ''); return m ? +m[1] : null; };

// Row objects keyed by the header on row 4, each with its sheet row number (r.__row) so the portal can write back to it.
const HEADER_ROW = 4;
function gridRows(grid) {
  const head = (grid[HEADER_ROW - 1] || []).map((h) => s(h));
  const out = [];
  for (let i = HEADER_ROW; i < grid.length; i++) {
    const g = grid[i]; if (!g || g.every((v) => blank(v))) continue;
    const o = { __row: i + 1 }; head.forEach((h, j) => { if (h) o[h] = g[j] == null ? null : g[j]; }); out.push(o);
  }
  return out;
}

// tenGrid / linkGrid: the two tabs as value grids; P: Payments Out rows ({'Payment ID', Date, Amount, ...}); now: real date
function buildTenants(tenGrid, linkGrid, P, now) {
  const tenRows = gridRows(tenGrid), linkRows = gridRows(linkGrid);
  const ist = new Date(now.getTime() + 5.5 * 36e5), cy = ist.getUTCFullYear();
  const byId = new Map(P.filter((p) => !blank(p['Payment ID'])).map((p) => [s(p['Payment ID']), p]));

  const T = tenRows.filter((r) => num(r['Survey No']) > 0).map((r) => {
    const d25 = Math.round(num(r['Rent 2025'])), inc = blank(r['Yearly increase']) ? 0.1 : num(r['Yearly increase']);
    const d26 = Math.round(d25 * (1 + inc)), d27 = Math.round(d26 * (1 + inc));
    return {
      sv: num(r['Survey No']), n: s(r['Tenant name (rent list)']), mn: s(r['Name on Goodluck master list']), area: num(r['Area (sq ft)']) || null,
      rent: Math.round(num(r['Monthly rent 2025'])) || null, mo: num(r['Months per year']) || null, due: { 2025: d25, 2026: d26, 2027: d27 },
      oth: Math.round(num(r['Other agreed amount'])), othn: s(r['Other agreed amount: what for']), st: s(r['Status']) || 'Active',
      rem: s(r['Rent list remark']), ar: s(r['Accounts remark']), paid: { 2025: 0, 2026: 0, 2027: 0 }, np: 0, k: 0, last: 0,
      inc, row: r.__row,
    };
  });
  const bySv = new Map(T.map((t) => [t.sv, t]));

  const linked = new Set(), pays = [], missing = [];
  for (const r of linkRows) {
    const id = s(r['Payment ID']); if (!id) continue;
    linked.add(id);
    const p = byId.get(id), st = s(r['Status']) || 'Linked';
    if (!p) { missing.push({ id, row: r.__row, sv: num(r['Survey No']) || null, note: s(r['Note / question']) }); continue; }
    const split = num(r['Split amount (only if one cheque covers 2 survey nos)']);
    const yr = num(r['Rent year (only if paid early)']) || rentYear(p.Date);
    const sv = num(r['Survey No']) || null;
    const row = { id, row: r.__row, sv, yr, yrSet: num(r['Rent year (only if paid early)']) || null, split: split || null, full: p.Amount, cr: s(r['Checked by / remark']),
      amt: split || p.Amount, st, note: s(r['Note / question']), chk: s(r['Accounts checked (Y/N)']),
      d: fmtD(p.Date), t: p.Date ? p.Date.getTime() : 0, bank: s(p['Bank Account']), desc: s(p['Description']), rm: s(p['Remark']), cfh: s(p['Cash Flow Head']),
      tn: sv && bySv.get(sv) ? bySv.get(sv).n : '' };
    pays.push(row);
    const t = sv && bySv.get(sv);
    if (t && st !== 'Not tenant rent') {
      if (t.paid[yr] != null) t.paid[yr] += row.amt; else t.paid[yr] = row.amt;
      t.np++; if (st === 'To confirm') t.k++; if (row.t > t.last) t.last = row.t;
    }
  }
  // Tenant Rent payments in Payments Out with no row on the Links tab, with a survey no. suggested from the remark
  const unlisted = P.filter((p) => s(p['Cash Flow Head']) === TENANT_HEAD && !linked.has(s(p['Payment ID']))).map((p) => {
    const sug = annexure(p['Remark']) || annexure(p['Description']);
    return { id: s(p['Payment ID']), d: fmtD(p.Date), t: p.Date ? p.Date.getTime() : 0, amt: p.Amount, bank: s(p['Bank Account']), desc: s(p['Description']),
      rm: s(p['Remark']), sug, sugn: sug && bySv.get(sug) ? bySv.get(sug).n : '' };
  }).sort((a, b) => b.t - a.t);

  const dueYears = YEARS.filter((y) => y <= cy);
  for (const t of T) {
    t.dueTD = dueYears.reduce((a, y) => a + t.due[y], 0) + t.oth;
    t.paidTD = Object.values(t.paid).reduce((a, v) => a + v, 0);
    t.bal = Math.round(t.dueTD - t.paidTD);
    t.pos = t.paidTD === 0 ? 'Not paid' : Math.abs(t.bal) <= 1000 ? 'Paid in full' : t.bal > 0 ? 'Short paid' : 'Paid extra';
    t.lastD = t.last ? fmtD(new Date(t.last)) : '';
  }
  const sum = (a, f) => Math.round(a.reduce((x, r) => x + f(r), 0));
  const short = T.filter((t) => t.bal > 1000), extra = T.filter((t) => t.bal < -1000);
  const counted = pays.filter((p) => p.sv && bySv.get(p.sv) && p.st !== 'Not tenant rent');
  const notRent = pays.filter((p) => p.st === 'Not tenant rent'), conf = pays.filter((p) => p.st === 'To confirm');
  const summary = {
    cy, years: YEARS, dueYears, tenants: T.length, active: T.filter((t) => t.st !== 'Closed shop').length,
    due: Object.fromEntries(YEARS.map((y) => [y, sum(T, (t) => t.due[y])])), paid: Object.fromEntries(YEARS.map((y) => [y, sum(T, (t) => t.paid[y] || 0)])),
    oth: sum(T, (t) => t.oth), dueTD: sum(T, (t) => t.dueTD), paidTD: sum(T, (t) => t.paidTD),
    short: { n: short.length, amt: sum(short, (t) => t.bal) }, extra: { n: extra.length, amt: -sum(extra, (t) => t.bal) },
    full: T.filter((t) => t.pos === 'Paid in full').length, none: T.filter((t) => t.pos === 'Not paid').length,
    pays: { n: counted.length, amt: sum(counted, (p) => p.amt) }, conf: { n: conf.length, amt: sum(conf, (p) => p.amt) },
    notRent: { n: notRent.length, amt: sum(notRent, (p) => p.amt) }, unlisted: { n: unlisted.length, amt: sum(unlisted, (p) => p.amt) },
    missing: missing.length, next: cy + 1, nextDue: YEARS.includes(cy + 1) ? sum(T, (t) => t.due[cy + 1]) : null,
  };
  // rows for the page; the payment rows go with the click-through detail
  return { model: { ...summary, rows: T, unl: unlisted, missingIds: missing, pl: pays }, pays };
}

module.exports = { buildTenants, gridRows, rentYear, annexure, TENANT_HEAD, HEADER_ROW };
