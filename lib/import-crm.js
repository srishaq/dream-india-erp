// Reads the Dream Signature CRM master sheet and turns it into ERP records, flagging everything that
// does not add up so the CRM and Accounts teams can verify it inside the ERP.
//
// Sources (tabs of the CRM master sheet):
//   Developer's Bookings  unit master, buyers, agreement value, registration, CP, funding
//   CRM Follow up         Due % (stages demanded), demand date, totals received, latest remark
//   Ledger                every receipt per flat, under AV / TDS / GST / SDR, with date, bank, instrument
//   Rera Bank Stat.       bank entries tagged to flats (only used to cross-check the Ledger)
//
// parse() is pure (no database): it returns { units, bookings, issues, stageDates, summary }.

const loose = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9%]/g, '');
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const blank = (s) => { const t = clean(s).toUpperCase(); return !t || ['NA', 'NM', '-', 'N/A', '#N/A', '#REF!', '#ERROR!'].includes(t); };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => (y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

// Dates arrive as sheet serial numbers (API, unformatted) or as text in many shapes:
// 14-Mar-2026, 8-May-26, 10/08/2025 (day first), 15-July-26, "Wednesday, June 04, 2025", 24/8/2026.
function toDate(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : null;
  const t = clean(v).replace(/^[A-Za-z]+,\s*/, '');
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]+(\d{2,4})$/);
  if (m) { const mo = MON[m[2].toLowerCase().slice(0, 4)] || MON[m[2].toLowerCase().slice(0, 3)]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, mo, +m[1]); }
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, +m[2], +m[1]); }
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) return iso(+m[3], MON[m[1].toLowerCase().slice(0, 3)], +m[2]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}
// Amounts: 9715000, "₹ 9,715,000", "  24,288.00 ", "2,30,000", "  -   " (zero), "-4,858.00".
function toNum(v) {
  if (typeof v === 'number') return v;
  const t = clean(v);
  if (!t || /^[-–]$/.test(t) || /^[-–]\s*$/.test(t)) return 0;
  const s = t.replace(/[₹,\s]|Rs\.?/gi, '');
  if (/%$/.test(s)) return parseFloat(s) / 100;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
const pct = (v) => { const n = toNum(v); return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : NaN; };
const r2 = (x) => Math.round(x * 100) / 100;
const unitKey = (s) => clean(s).toUpperCase().replace(/\s/g, '');
const mobile = (p) => { for (const part of String(p || '').split(/[\/,]/)) { const d = part.replace(/\D/g, '').slice(-10); if (/^[6-9]\d{9}$/.test(d)) return d; } return null; };
const emailsIn = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));

// Turns a tab (array of rows, header first) into objects keyed by loose header names.
function table(rows) {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(loose);
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    // a repeated heading (CRM Follow up has two "Status" columns) is kept as status__2, status__3 ...
    const seenH = {};
    head.forEach((h, j) => { if (!h) return; seenH[h] = (seenH[h] || 0) + 1; o[seenH[h] === 1 ? h : `${h}__${seenH[h]}`] = r[j]; });
    return o;
  });
}
const pick = (o, ...names) => { for (const n of names) { const k = loose(n); if (o[k] !== undefined && o[k] !== '') return o[k]; } return undefined; };

// The Ledger tab: one block per flat, receipts listed under AV / TDS / GST / SDR, each closed by a "Total" row.
function parseLedger(rows) {
  const flats = new Map();
  let cur = null, pending = [];
  const HEAD = { av: 'av', tds: 'tds', gst: 'gst', sdr: 'sdr' };
  for (const r of rows || []) {
    const a = clean(r[0]);
    if (/^flat no\.?$/i.test(a)) {
      if (cur && pending.length) cur.unassigned.push(...pending);
      cur = { unit: unitKey(r[1]), lines: [], totals: {}, unassigned: [] }; pending = [];
      if (cur.unit) flats.set(cur.unit, cur);
      continue;
    }
    if (!cur) continue;
    const tot = a.match(/^total received against\s+([a-z]+)/i);
    if (tot) {
      const head = HEAD[tot[1].toLowerCase()];
      if (head) { cur.totals[head] = toNum(r[3]) || 0; for (const l of pending) cur.lines.push({ ...l, head }); }
      pending = [];
      continue;
    }
    const date = toDate(r[0]);
    const amt = toNum(r[3]);
    if (date && Number.isFinite(amt) && amt !== 0) pending.push({ date, bank: clean(r[1]), instrument: clean(r[2]), amount: r2(amt) });
  }
  if (cur && pending.length) cur.unassigned.push(...pending);
  return flats;
}

// Rera Bank Stat.: the heading row is normally row 1, but a title row is sometimes inserted above it.
function bankRows(rows) {
  const at = (rows || []).slice(0, 20).findIndex((r) => (r || []).some((c) => /^(value|txn|transaction|tran)? ?date$/i.test(clean(c))) && (r || []).some((c) => /^inward$/i.test(clean(c))));
  return at > 0 ? rows.slice(at) : rows || [];
}
function payMode(desc) {
  const d = clean(desc).toUpperCase();
  if (d.startsWith('RTGS')) return 'RTGS';
  if (d.startsWith('NEFT')) return 'NEFT';
  if (d.includes('IMPS')) return 'IMPS';
  if (d.includes('UPI')) return 'UPI';
  if (d.includes('CHQ') || d.includes('CLG') || d.includes('CHEQUE')) return 'Cheque';
  if (d.startsWith('FUNDS TRF') || d.startsWith('FT')) return 'Transfer';
  return 'Other';
}
function teamOf(s) {
  const k = loose(s);
  if (!k) return '';
  if (k.includes('return')) return k.includes('crm') ? 'Return - CRM' : 'Return - Sales';
  if (k.includes('crm')) return 'CRM Team';
  if (k.includes('sales')) return 'Sales Team';
  return 'Internal';
}
// Every line of the RERA collection account, classified the same way as the live portal's daily report:
// receipts, returned cheques, and internal 30/70 transfers (which are not collections).
function parseBankEntries(rows) {
  const out = [];
  for (const r of table(bankRows(rows))) {
    const date = toDate(pick(r, 'Value Date', 'Txn Date', 'Transaction Date', 'Tran Date', 'Date'));
    if (!date) continue;
    const dir = clean(pick(r, 'Dr/Cr')).toUpperCase();
    const inflow = toNum(pick(r, 'INWARD')) || 0, outflow = toNum(pick(r, 'OUTWARD')) || 0;
    const team = teamOf(pick(r, 'Collection'));
    const desc = clean(pick(r, 'Description'));
    const internal = team === 'Internal' || /FUNDS TRF TO|DESIGNATED/i.test(desc);
    let kind;
    if (dir === 'C' && inflow > 0 && !internal) kind = 'receipt';
    else if (team.startsWith('Return') || /RETN|RETURN/i.test(desc)) kind = 'return';
    else if (internal) kind = 'transfer';
    else kind = dir === 'C' ? 'receipt' : 'other'; // same rule as the live portal's daily report
    const amount = kind === 'receipt' ? inflow : outflow || inflow;
    if (!(amount > 0)) continue;
    const cust = pick(r, 'Customer Name By Lookup', 'CUSTOMER NAME AS PER TALLY');
    out.push({ value_date: date, kind, amount: r2(amount), unit_no: unitKey(pick(r, 'FLAT NO')) || null, customer: blank(cust) ? null : clean(cust),
      team: team === 'Internal' ? null : team || null, mode: payMode(desc), description: desc.slice(0, 300) || null, remarks: blank(pick(r, 'Remarks')) ? null : clean(pick(r, 'Remarks')).slice(0, 300) });
  }
  return out;
}

// Rera Bank Stat.: net amount per flat tag, and tags that match no unit.
function parseBank(rows) {
  const t = table(bankRows(rows)), byFlat = new Map();
  for (const r of t) {
    const flat = unitKey(pick(r, 'FLAT NO'));
    if (!flat) continue;
    const net = (toNum(pick(r, 'INWARD')) || 0) - (toNum(pick(r, 'OUTWARD')) || 0);
    byFlat.set(flat, r2((byFlat.get(flat) || 0) + net));
  }
  return byFlat;
}

function followStatus(s) {
  const k = loose(s);
  if (!k || blank(s)) return null;
  if (k === 'nodue') return 'No Due';
  if (k.startsWith('khalid')) return "Khalid Sir's Reference";
  if (k.startsWith('partpayment')) return 'Part Payment & PDC';
  if (k.startsWith('tdsdue')) return 'TDS Due Only';
  if (k.startsWith('management')) return 'Management Reference';
  return clean(s);
}

const HELD = /management|khalid|aslam|iqbal|wadiya/i;
function unitStatus(sheetStatus) {
  const s = clean(sheetStatus);
  if (/^sold$/i.test(s)) return 'sold';
  if (/^allot/i.test(s) && !HELD.test(s)) return 'allotment';
  if (/^available$/i.test(s)) return 'available';
  if (/^refuge/i.test(s)) return 'refuge';
  if (/^society/i.test(s)) return 'society';
  if (/^rehab/i.test(s)) return 'rehab';
  return 'held';
}

/**
 * tabs: { bookings, crm, ledger, bank } raw rows. plan: [{ seq, name, pct, construction_linked }] in order.
 * buildings: { A: id, B: id } by code. stageDates: optional { "A|stage name": "YYYY-MM-DD" } chosen by the user.
 */
function parse(tabs, plan, buildingCodes, stageDates = {}) {
  const issues = [];
  const issue = (unit, kind, severity, detail) => issues.push({ unit, kind, severity, detail });
  const crm = new Map(table(tabs.crm).map((r) => [unitKey(pick(r, 'Unit No.')), r]));
  const ledger = parseLedger(tabs.ledger);
  const bank = parseBank(tabs.bank);
  const units = [], bookings = [];
  const seen = new Set();
  // cumulative % after each stage, to turn "Due %" into the list of stages demanded
  let run = 0;
  const cum = plan.map((s) => ({ ...s, cum: r2((run += Number(s.pct))) }));
  const firstLinked = cum.findIndex((s) => s.construction_linked);

  for (const r of table(tabs.bookings)) {
    const no = unitKey(pick(r, 'New Unit No.', 'Unit No.'));
    if (!/^[A-Z]+-\d+$/.test(no)) continue;
    if (seen.has(no)) { issue(no, 'duplicate-unit', 'data', `Unit ${no} appears twice in Developer's Bookings (row ${r._row}); the first row was used.`); continue; }
    seen.add(no);
    const wing = clean(pick(r, 'Wing')).toUpperCase() || no.split('-')[0];
    if (!buildingCodes[wing]) { issue(no, 'unknown-building', 'data', `Wing "${wing}" is not set up as a building in the ERP; unit skipped.`); continue; }
    const status = unitStatus(pick(r, 'Status'));
    const sqm = toNum(pick(r, 'Carpet Area Mtr.')), sqft = toNum(pick(r, 'Carpet Area Sf.ft'));
    const unit = {
      unit_no: no, wing, floor: Number.isFinite(toNum(pick(r, 'Floors'))) ? Math.round(toNum(pick(r, 'Floors'))) : null,
      typology: clean(pick(r, 'Typology')) || null, carpet_sqm: Number.isFinite(sqm) && sqm > 0 ? r2(sqm) : null, carpet_sqft: Number.isFinite(sqft) && sqft > 0 ? r2(sqft) : null,
      status: { sold: 'registered', allotment: 'booked', available: 'available', refuge: 'refuge', society: 'society', rehab: 'rehab', held: 'held' }[status],
      hold_note: status === 'held' ? `Sheet status: ${clean(pick(r, 'Status')) || 'blank'}` : null, sheet_status: clean(pick(r, 'Status')),
    };
    const c = crm.get(no) || {};
    const lg = ledger.get(no);
    const av = toNum(pick(r, 'Agreement Value'));
    const bankNet = bank.get(no) || 0;
    units.push(unit);

    if (status === 'held') issue(no, 'held-unit', 'data', `Marked "${unit.sheet_status}" in the sheet. Confirm whether it is sold, held for management, or available.`);
    if (!['sold', 'allotment'].includes(status)) {
      const ledgerAv = lg ? (lg.totals.av || 0) : 0;
      if (Math.abs(bankNet) > 1 || ledgerAv > 1) issue(no, 'money-on-unsold', 'money', `Unit is "${unit.sheet_status}" but has money against it: bank ₹${bankNet.toLocaleString('en-IN')}, ledger AV ₹${ledgerAv.toLocaleString('en-IN')}.`);
      continue;
    }
    if (!(av > 0)) { unit.status = 'held'; unit.hold_note = 'Sold in sheet but no agreement value'; issue(no, 'no-agreement-value', 'money', 'Marked sold/allotted but has no agreement value; imported as held until fixed.'); continue; }

    // ---- booking
    const reg = toDate(pick(r, 'Registration Date'));
    const bookingDate = toDate(pick(r, 'Allotment Date')) || toDate(pick(c, 'Booking Date'));
    if (!bookingDate) issue(no, 'no-booking-date', 'data', 'No allotment / booking date in the sheet; the registration or first receipt date was used.');
    const fund = clean(pick(r, 'Funding Status'));
    const noc = clean(pick(r, 'Bank NOC Date'));
    const nocDate = toDate(noc);
    const gstAmt = toNum(pick(r, '5% GST'));
    const gstRate = gstAmt > 0 ? Math.round((gstAmt / av) * 1000) / 10 : 5;
    const applicants = [];
    const emails = emailsIn(pick(r, 'Email ID') || pick(c, 'Email Id'));
    const address = [clean(pick(r, 'Address:')), clean(pick(r, 'Address:2'))].filter((x) => x && !blank(x)).join('\n') || null;
    const ap1 = clean(pick(r, 'Applicant 1') || pick(c, 'Primary Applicant'));
    if (!ap1) issue(no, 'no-buyer-name', 'data', 'No applicant name in the sheet.');
    const pan = (v) => { const p = clean(v).toUpperCase(); return blank(p) ? null : p; };
    const aadhaar = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 12 ? d : null; };
    applicants.push({ name: ap1 || `Buyer of ${no}`, pan: pan(pick(r, 'PAN')), aadhaar: aadhaar(pick(r, 'Aadhar No.')), phone: mobile(pick(r, 'Contact No.') || pick(c, 'Contact No.')), email: emails[0] || null, address });
    const ap2 = clean(pick(r, 'Applicant 2'));
    if (ap2 && !blank(ap2)) applicants.push({ name: ap2, pan: pan(pick(r, 'PAN2')), aadhaar: aadhaar(pick(r, 'Aadhar No.2')), phone: null, email: emails[1] || null, address: null });
    for (const a of applicants) if (a.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(a.pan)) issue(no, 'bad-pan', 'data', `PAN "${a.pan}" for ${a.name} does not look valid.`);
    if (!applicants[0].phone) issue(no, 'no-mobile', 'data', 'No valid mobile number for the first applicant.');
    if (!applicants.some((a) => a.email)) issue(no, 'no-email', 'data', 'No email address, so letters cannot be emailed.');

    // ---- receipts from the Ledger, one receipt per (date, instrument) with its parts split by head
    const receipts = new Map();
    if (lg) {
      for (const l of lg.lines) {
        const key = `${l.date}|${l.instrument || l.bank}|${l.head === 'tds' ? 'tds' : 'pay'}`;
        const rec = receipts.get(key) || { received_on: l.date, bank: l.bank || null, instrument_no: l.instrument || null, mode: l.head === 'tds' ? 'tds' : 'bank', splits: {} };
        const head = l.head === 'sdr' ? 'stamp_duty' : l.head;
        rec.splits[head] = r2((rec.splits[head] || 0) + l.amount);
        receipts.set(key, rec);
      }
      for (const [h, t] of Object.entries(lg.totals)) {
        const sum = r2(lg.lines.filter((l) => l.head === h).reduce((a, l) => a + l.amount, 0));
        if (Math.abs(sum - t) > 1) issue(no, 'ledger-total', 'money', `Ledger ${h.toUpperCase()} lines add up to ₹${sum.toLocaleString('en-IN')} but the total row says ₹${t.toLocaleString('en-IN')}.`);
      }
      if (lg.unassigned.length) issue(no, 'ledger-unassigned', 'money', `${lg.unassigned.length} ledger line(s) are not under any total row (₹${r2(lg.unassigned.reduce((a, l) => a + l.amount, 0)).toLocaleString('en-IN')}); not imported.`);
    } else issue(no, 'no-ledger', 'money', 'No block for this flat in the Ledger tab, so no receipts were imported.');
    const recs = [...receipts.values()].map((x) => ({ ...x, amount: r2(Object.values(x.splits).reduce((a, v) => a + v, 0)) })).filter((x) => x.amount > 0);
    const got = (h) => r2(recs.reduce((a, x) => a + (x.splits[h] || 0), 0));

    // ---- cross-checks against the CRM tab and the bank statement
    const checks = [['av', 'Received In AV', 'AV'], ['tds', 'TDS Paid', 'TDS'], ['gst', 'Rece IN GST', 'GST'], ['stamp_duty', 'SDR Received', 'stamp duty / registration']];
    for (const [h, col, label] of checks) {
      const crmVal = toNum(pick(c, col)) || 0, ledVal = got(h);
      if (Math.abs(crmVal - ledVal) > 1) issue(no, 'crm-vs-ledger', 'money', `${label} received: CRM Follow up says ₹${crmVal.toLocaleString('en-IN')}, Ledger lines add up to ₹${ledVal.toLocaleString('en-IN')}.`);
    }
    if (Math.abs(got('av') - bankNet) > 1000) issue(no, 'ledger-vs-bank', 'money', `AV received per Ledger ₹${got('av').toLocaleString('en-IN')}; tagged to this flat in Rera Bank Stat. ₹${bankNet.toLocaleString('en-IN')}.`);

    // ---- stages demanded, from Due %
    const due = pct(pick(c, 'Due %'));
    let demanded = [];
    if (!Number.isFinite(due) || due <= 0) issue(no, 'no-due-pct', 'money', 'No Due % in CRM Follow up; only the booking stage was taken as demanded.');
    const target = Number.isFinite(due) && due > 0 ? r2(due * 100) : cum[0].cum;
    const upto = cum.findIndex((s) => Math.abs(s.cum - target) < 0.01);
    if (upto < 0) issue(no, 'due-pct-mismatch', 'money', `Due % ${target}% does not match a stage of the payment plan; stages up to it were taken as demanded.`);
    demanded = cum.filter((s, i) => (upto >= 0 ? i <= upto : s.cum <= target + 0.001));
    const unitDemand = toDate(pick(c, 'Demand Date'));
    const firstReceipt = recs.map((x) => x.received_on).sort()[0];
    const bDate = bookingDate || reg || firstReceipt || unitDemand;
    const demands = demanded.map((s, i) => {
      let date;
      if (i === 0) date = bDate;
      else if (!s.construction_linked) date = reg || unitDemand || bDate;
      else date = stageDates[`${wing}|${s.name}`] || unitDemand || bDate;
      if (date && bDate && date < bDate) date = bDate; // a late buyer is demanded on booking
      return { stage_name: s.name, pct: Number(s.pct), seq: s.seq, demand_date: date, linked: s.construction_linked };
    });
    if (demands.some((d) => !d.demand_date)) { issue(no, 'no-dates', 'data', 'No booking, registration or demand date anywhere; booking skipped.'); continue; }

    const brokerage = toNum(pick(r, 'Brokerage Status'));
    const remark = clean(pick(c, 'Remark'));
    bookings.push({
      unit_no: no, wing, status, booking_date: bDate, registration_date: reg, agreement_date: reg,
      agreement_value: r2(av), gst_rate: gstRate > 0 && gstRate <= 28 ? gstRate : 5,
      stamp_duty: toNum(pick(r, 'SD')) > 0 ? r2(toNum(pick(r, 'SD'))) : null, registration_fee: toNum(pick(r, 'Reg')) > 0 ? r2(toNum(pick(r, 'Reg'))) : null,
      parking: Math.max(0, Math.round(toNum(pick(r, 'Parking')) || 0)),
      funding: /self/i.test(fund) ? 'self' : fund ? 'loan' : null, loan_bank: /self/i.test(fund) || !fund ? null : (/^loan$/i.test(fund) ? (blank(noc) || nocDate ? null : noc) : fund),
      source: blank(pick(r, 'Source')) ? null : clean(pick(r, 'Source')), cp_name: blank(pick(r, 'CP Firm Name')) ? null : clean(pick(r, 'CP Firm Name')),
      brokerage: brokerage > 0 && brokerage < av ? r2(brokerage) : null, rm_name: blank(pick(r, 'RM')) ? null : clean(pick(r, 'RM')),
      applicants, demands, receipts: recs, remark: remark || null,
      crm_status: followStatus(c.status__2), registration_status: blank(pick(r, 'Registration Status') || pick(c, 'Registration Status')) ? null : clean(pick(r, 'Registration Status') || pick(c, 'Registration Status')),
      booking_form_date: toDate(pick(r, 'Booking Form Received Date')) || toDate(pick(c, 'Booking Form Received Date')), bank_noc_date: nocDate,
      sdr_paid: toNum(pick(c, 'SDR Paid')) > 0 ? r2(toNum(pick(c, 'SDR Paid'))) : null, brokerage_released: /released/i.test(clean(pick(r, 'Bro. Amt. Released'))),
      market_value: toNum(pick(r, 'Market Value')) > 0 ? r2(toNum(pick(r, 'Market Value'))) : null, agreement_type: blank(pick(r, 'Types of Ageement', 'Types of Agreement')) ? null : clean(pick(r, 'Types of Ageement', 'Types of Agreement')),
    });
  }

  // instruments used on more than one flat (one payment split across units, or a typing error)
  const byInst = new Map();
  for (const b of bookings) for (const x of b.receipts) if (x.instrument_no && x.instrument_no.length >= 5 && !/^tds$/i.test(x.instrument_no)) {
    const k = `${x.instrument_no}|${x.received_on}`; if (!byInst.has(k)) byInst.set(k, new Set()); byInst.get(k).add(b.unit_no);
  }
  const shared = new Map();
  for (const [k, set] of byInst) if (set.size > 1) for (const u of set) {
    if (!shared.has(u)) shared.set(u, { others: new Set(), list: [] });
    const e = shared.get(u); e.list.push(k.replace('|', ' on ')); for (const o of set) if (o !== u) e.others.add(o);
  }
  for (const [u, e] of shared) issue(u, 'shared-instrument', 'money', `${e.list.length} payment(s) also appear on ${[...e.others].join(', ')} (${e.list.slice(0, 4).join('; ')}${e.list.length > 4 ? '…' : ''}). Confirm each is one payment split across units, not counted twice.`);
  // bank tags that match no unit at all
  const known = new Set(units.map((u) => u.unit_no));
  for (const [tag, net] of bank) if (!known.has(tag) && Math.abs(net) > 1) issue(null, 'bank-tag', 'money', `Rera Bank Stat. has ₹${net.toLocaleString('en-IN')} tagged "${tag}", which is not a unit (combined, suspense or typing error).`);
  for (const u of ledger.keys()) if (!known.has(u)) issue(u, 'ledger-orphan', 'money', `The Ledger has a block for ${u}, which is not in Developer's Bookings.`);

  // suggested stage dates per wing: the most common Demand Date among buyers at exactly that stage
  const suggested = {};
  for (const wing of Object.keys(buildingCodes)) {
    for (const s of cum.slice(firstLinked)) {
      const at = table(tabs.crm).filter((r) => unitKey(pick(r, 'Unit No.')).startsWith(wing + '-') && Math.abs(r2(pct(pick(r, 'Due %')) * 100) - s.cum) < 0.01).map((r) => toDate(pick(r, 'Demand Date'))).filter(Boolean);
      const reached = table(tabs.crm).some((r) => unitKey(pick(r, 'Unit No.')).startsWith(wing + '-') && r2(pct(pick(r, 'Due %')) * 100) >= s.cum - 0.001);
      if (!reached) continue;
      const counts = {}; for (const d of at) counts[d] = (counts[d] || 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      suggested[`${wing}|${s.name}`] = stageDates[`${wing}|${s.name}`] || (best ? best[0] : null);
    }
  }

  const sum = (f) => r2(bookings.reduce((a, b) => a + f(b), 0));
  const summary = {
    units: units.length, byStatus: units.reduce((o, u) => ((o[u.status] = (o[u.status] || 0) + 1), o), {}),
    bookings: bookings.length, registered: bookings.filter((b) => b.registration_date).length,
    agreementValue: sum((b) => b.agreement_value), receipts: bookings.reduce((a, b) => a + b.receipts.length, 0),
    receivedAv: sum((b) => b.receipts.reduce((a, x) => a + (x.splits.av || 0), 0)), receivedTds: sum((b) => b.receipts.reduce((a, x) => a + (x.splits.tds || 0), 0)),
    receivedGst: sum((b) => b.receipts.reduce((a, x) => a + (x.splits.gst || 0), 0)), receivedSdr: sum((b) => b.receipts.reduce((a, x) => a + (x.splits.stamp_duty || 0), 0)),
    demanded: sum((b) => b.demands.reduce((a, d) => a + r2((b.agreement_value * d.pct) / 100), 0)),
    issues: issues.length, issuesByKind: issues.reduce((o, i) => ((o[i.kind] = (o[i.kind] || 0) + 1), o), {}),
  };
  const bankEntries = parseBankEntries(tabs.bank);
  summary.bankEntries = bankEntries.length;
  return { units, bookings, issues, stageDates: suggested, summary, bankEntries };
}

module.exports = { parse, toDate, toNum, parseLedger, unitStatus, parseBankEntries, followStatus };
