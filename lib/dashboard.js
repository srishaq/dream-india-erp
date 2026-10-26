// The collections dashboard, worked out from the ERP's own records. It returns the same shape the live
// staff portal's dashboard reads from the CRM master sheet, so the same screens show the same figures:
// once the ERP is live they move as soon as a receipt or demand is approved, with no sheet in between.
const db = require('./db');
const { today: istToday } = require('./demands');

const n = (v) => (v == null ? 0 : Number(v));
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]/g, '');
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const mask = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '••••••' + d.slice(-4) : ''; };
const LABEL = { available: 'Available', blocked: 'Blocked', booked: 'Allotment', registered: 'Sold', held: 'Held', refuge: 'Refuge', rehab: 'Rehab', society: 'Society' };
const SOLD_LIKE = ['sold', 'allotment', 'salesteam', 'crmteam'];
const TDS_LIMIT = 5000000; // TDS of 1% applies to property of ₹50 lakh and above

async function build(projectId, { now = new Date() } = {}) {
  const today = istToday();
  const rows = await db.q(
    `select u.id as unit_id, u.unit_no, u.floor, u.typology, u.carpet_sqft, u.status as ustatus, u.sheet_status, bd.code as wing,
            bk.id as booking_id, bk.booking_date, bk.agreement_value, bk.gst_rate, bk.registration_date, bk.funding, bk.loan_bank, bk.source, bk.cp_name,
            bk.brokerage, bk.rm_name, bk.crm_status, bk.registration_status, bk.booking_form_date, bk.bank_noc_date, bk.sdr_paid, bk.brokerage_released,
            bk.market_value, bk.agreement_type,
            bb.demanded, bb.demanded_gst, bb.received_av, bb.received_tds, bb.received_gst, bb.received_sdr, bb.last_demand,
            a1.name as applicant, a1.phone, a2.name as co_applicant, dp.pct as due_pct, fu.note as fu_note, fu.created_at as fu_at
       from units u join buildings bd on bd.id = u.building_id
       left join bookings bk on bk.unit_id = u.id and bk.status = 'active'
       left join booking_balances bb on bb.booking_id = bk.id
       left join lateral (select y.name, y.phone from booking_applicants ba join buyers y on y.id = ba.buyer_id where ba.booking_id = bk.id and ba.seq = 1) a1 on true
       left join lateral (select y.name from booking_applicants ba join buyers y on y.id = ba.buyer_id where ba.booking_id = bk.id and ba.seq = 2) a2 on true
       left join lateral (select sum(d.pct) as pct from demands d where d.booking_id = bk.id and d.status = 'raised') dp on true
       left join lateral (select f.note, f.created_at from follow_ups f where f.booking_id = bk.id order by f.created_at desc, f.id desc limit 1) fu on true
      where u.project_id = $1 and bd.kind <> 'rehab'`, [projectId]);

  const units = rows.map((r) => {
    const booked = !!r.booking_id;
    const sheet = r.sheet_status || '';
    // The sheet's own word for the unit (Sold, Allotment, Sales Team, Aslam/Management...) while it still
    // agrees with the ERP; once a unit is booked or freed in the ERP, the ERP's status wins.
    let inventory = sheet && (booked === SOLD_LIKE.includes(key(sheet))) ? sheet : LABEL[r.ustatus] || r.ustatus;
    const av = n(r.agreement_value), demanded = n(r.demanded), recAV = n(r.received_av), recTDS = n(r.received_tds);
    const regStatus = r.registration_status || '';
    const registered = booked && (key(regStatus) === 'done' || (!regStatus && !!r.registration_date));
    if (booked && registered && !SOLD_LIKE.includes(key(inventory))) inventory = 'Sold';
    const balanceDue = booked ? Math.round((demanded - recAV - recTDS) * 100) / 100 : 0;
    const gstDue = booked ? Math.round((n(r.demanded_gst) - n(r.received_gst)) * 100) / 100 : 0;
    const tds = booked && av >= TDS_LIMIT ? Math.round(av) / 100 : 0;
    const tdsOnDemand = av >= TDS_LIMIT ? demanded / 100 : 0;
    // Follow-up status: the CRM team's tag where it still fits the figures, otherwise worked out from them.
    let followStatus = '';
    if (booked) {
      const tag = r.crm_status || '';
      if (balanceDue <= 1000 && gstDue <= 1000) followStatus = 'No Due';
      else if (balanceDue <= 1000) followStatus = 'GST Due';
      else if (balanceDue <= tdsOnDemand - recTDS + 1000) followStatus = 'TDS Due Only';
      else followStatus = tag && !['No Due', 'TDS Due Only'].includes(tag) ? tag : 'Follow Up';
    }
    const remark = (r.fu_note || '').replace(/^Remark from CRM sheet: /, '').slice(0, 600);
    return {
      unit: r.unit_no, wing: r.wing, floor: r.floor, typology: (r.typology || '').toUpperCase().replace(/\s/g, ''), sqft: Math.round(n(r.carpet_sqft)),
      inventory, booked, registered, bookingId: r.booking_id,
      applicant: r.applicant || '', coApplicant: r.co_applicant || '', phone: mask(r.phone),
      agreementValue: av, marketValue: n(r.market_value), agreementType: r.agreement_type || '',
      registrationDate: r.registration_date, registrationStatus: regStatus || (registered ? 'Done' : ''),
      funding: r.funding === 'self' ? 'Self Funding' : r.funding === 'loan' ? `Loan${r.loan_bank ? ' · ' + r.loan_bank : ''}` : '',
      bankNocDate: r.bank_noc_date, source: r.source || '', cpFirm: r.cp_name || '', brokerage: n(r.brokerage), brokerageReleased: !!r.brokerage_released,
      brokerageStatus: r.brokerage ? (r.brokerage_released ? 'Released' : 'Payable') : '', rm: r.rm_name || '',
      allotmentDate: r.booking_date, bookingDate: r.booking_date, bookingFormDate: r.booking_form_date, demandDate: r.last_demand,
      receivedAV: recAV, receivedGST: n(r.received_gst), duePct: n(r.due_pct) / 100, demanded, balanceDue, gstDue,
      tds, tdsPaid: recTDS, tdsDue: Math.max(0, tds - recTDS), sdrReceived: n(r.received_sdr), sdrPaid: n(r.sdr_paid),
      sdrDifference: n(r.received_sdr) - n(r.sdr_paid), followStatus, remark, remarkAt: r.fu_at,
      ageDays: booked && r.booking_form_date && !registered ? days(r.booking_form_date, today) : null,
      demandAgeDays: r.last_demand ? days(r.last_demand, today) : null,
    };
  }).sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));

  const wings = [...new Set(units.map((u) => u.wing))].sort();
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const booked = units.filter((x) => x.booked);
  const kpi = (arr) => ({
    units: arr.length, booked: arr.filter((x) => x.booked).length, registered: arr.filter((x) => x.registered).length,
    available: arr.filter((x) => key(x.inventory) === 'available').length,
    held: arr.filter((x) => !x.booked && !['available', 'refuge', 'society'].includes(key(x.inventory))).length,
    agreementValue: sum(arr, (x) => x.agreementValue), registeredValue: sum(arr.filter((x) => x.registered), (x) => x.agreementValue),
    demanded: sum(arr, (x) => x.demanded), receivedAV: sum(arr, (x) => x.receivedAV), receivedTDS: sum(arr, (x) => x.tdsPaid), receivedGST: sum(arr, (x) => x.receivedGST),
    balanceDue: sum(arr.filter((x) => x.booked), (x) => Math.max(0, x.balanceDue)), gstDue: sum(arr, (x) => Math.max(0, x.gstDue)),
    tdsDue: sum(arr, (x) => x.tdsDue),
    sdrReceived: sum(arr.filter((x) => x.registered), (x) => x.sdrReceived), sdrPaid: sum(arr.filter((x) => x.registered), (x) => x.sdrPaid),
  });
  const totals = kpi(units);
  const byWing = Object.fromEntries(wings.map((w) => [w, kpi(units.filter((x) => x.wing === w))]));
  const groupCount = (arr, f) => {
    const o = {};
    arr.forEach((x) => { const k = f(x) || '—'; o[k] = o[k] || { name: k, units: 0, balance: 0, value: 0 }; o[k].units++; o[k][x.wing] = (o[k][x.wing] || 0) + 1; o[k].balance += Math.max(0, x.balanceDue || 0); o[k].value += x.agreementValue || 0; });
    return Object.values(o).sort((a, b) => b.units - a.units);
  };
  const inventory = groupCount(units, (x) => x.inventory);
  const followUp = groupCount(booked, (x) => x.followStatus).sort((a, b) => b.balance - a.balance);

  // ---- action lists
  const pick = (x) => ({ unit: x.unit, applicant: x.applicant, phone: x.phone, wing: x.wing, balanceDue: x.balanceDue, gstDue: x.gstDue, tdsDue: x.tdsDue,
    followStatus: x.followStatus, demandDate: x.demandDate, demandAgeDays: x.demandAgeDays, remark: x.remark, registrationStatus: x.registrationStatus,
    bookingFormDate: x.bookingFormDate, ageDays: x.ageDays, rm: x.rm, sdrDifference: x.sdrDifference });
  const desc = (k) => (a, b) => (b[k] || 0) - (a[k] || 0);
  const actions = {
    defaulters: booked.filter((x) => x.followStatus === 'Defaulter').sort(desc('balanceDue')).map(pick),
    overdueDemands: booked.filter((x) => x.balanceDue > 1000 && x.demandAgeDays !== null && x.demandAgeDays > 15 && !['No Due', 'TDS Due Only'].includes(x.followStatus)).sort(desc('balanceDue')).map(pick),
    highDues: booked.filter((x) => x.balanceDue >= 500000).sort(desc('balanceDue')).map(pick),
    registrationPending: booked.filter((x) => !x.registered).sort(desc('ageDays')).map(pick),
    tdsPending: booked.filter((x) => x.followStatus === 'TDS Due Only').sort(desc('tdsDue')).map(pick),
    sdrGaps: booked.filter((x) => x.registered && Math.abs(x.sdrDifference) > 100).sort((a, b) => Math.abs(b.sdrDifference) - Math.abs(a.sdrDifference)).map(pick),
    missingDates: booked.filter((x) => !x.bookingFormDate || (x.registered && !x.registrationDate) || (x.balanceDue > 0 && !x.demandDate))
      .map((x) => ({ ...pick(x), missing: [!x.bookingFormDate && 'Booking form date', x.registered && !x.registrationDate && 'Registration date', x.balanceDue > 0 && !x.demandDate && 'Demand date'].filter(Boolean).join(', ') })),
  };

  // ---- important dates
  const in30 = (d) => d && days(today, d) >= 0 && days(today, d) <= 30;
  const last30 = (d) => d && days(d, today) >= 0 && days(d, today) <= 30;
  const ev = (arr, f, event) => arr.filter((x) => f(x)).map((x) => ({ date: f(x), event, unit: x.unit, applicant: x.applicant }));
  const dates = {
    lineups: booked.filter((x) => /line ?up/i.test(x.registrationStatus)).map((x) => ({ unit: x.unit, applicant: x.applicant, status: x.registrationStatus, rm: x.rm, balanceDue: x.balanceDue })),
    upcoming: [...ev(booked, (x) => in30(x.registrationDate) && x.registrationDate, 'Registration'), ...ev(booked, (x) => in30(x.bankNocDate) && x.bankNocDate, 'Bank NOC')].sort((a, b) => a.date.localeCompare(b.date)),
    recent: [...ev(booked, (x) => last30(x.registrationDate) && x.registrationDate, 'Registered'), ...ev(booked, (x) => last30(x.bookingFormDate) && x.bookingFormDate, 'Booking form received'),
      ...ev(booked, (x) => last30(x.demandDate) && x.demandDate, 'Demand raised'), ...ev(booked, (x) => last30(x.allotmentDate) && x.allotmentDate, 'Allotment')].sort((a, b) => b.date.localeCompare(a.date)),
    registrationsByMonth: Object.values(booked.filter((x) => x.registrationDate).reduce((o, x) => { const m = x.registrationDate.slice(0, 7); o[m] = o[m] || { month: m, units: 0, value: 0 }; o[m].units++; o[m].value += x.agreementValue; return o; }, {})).sort((a, b) => a.month.localeCompare(b.month)),
  };

  // ---- channel partners (firm names matched ignoring case and spacing)
  const cpMap = {};
  for (const u of units) {
    const name = (u.cpFirm || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const k = name.toLowerCase().replace(/[.,]+$/, '');
    const c = (cpMap[k] ||= { firm: name, units: 0, booked: 0, registered: 0, agreementValue: 0, received: 0, balanceDue: 0, brokerage: 0, brokerageReleased: 0, releasedCount: 0, lastBooking: '', defaulters: 0 });
    if (name.length > c.firm.length) c.firm = name;
    c.units++; if (u.booked) c.booked++; if (u.registered) c.registered++;
    c.agreementValue += u.agreementValue; c.received += u.receivedAV; c.balanceDue += Math.max(0, u.balanceDue); c.brokerage += u.brokerage;
    if (u.brokerageReleased) { c.releasedCount++; c.brokerageReleased += u.brokerage; }
    if (u.followStatus === 'Defaulter') c.defaulters++;
    if (u.bookingDate && u.bookingDate > c.lastBooking) c.lastBooking = u.bookingDate;
  }
  const cps = Object.values(cpMap).map((c) => ({ ...c, collectedPct: c.agreementValue ? c.received / c.agreementValue : 0 })).sort((a, b) => b.agreementValue - a.agreementValue);
  const cpTotals = {
    firms: cps.length, single: cps.filter((c) => c.units === 1).length, units: units.filter((u) => /channa?el partner/i.test(u.source)).length,
    unitsWithFirm: sum(cps, (c) => c.units), agreementValue: sum(cps, (c) => c.agreementValue), received: sum(cps, (c) => c.received), balanceDue: sum(cps, (c) => c.balanceDue),
    brokerage: sum(cps, (c) => c.brokerage), brokerageReleased: sum(cps, (c) => c.brokerageReleased), releasedCount: sum(cps, (c) => c.releasedCount), top10Value: sum(cps.slice(0, 10), (c) => c.agreementValue),
  };

  // ---- collections, day by day, from the RERA account statement (internal transfers excluded)
  const bank = await db.q("select value_date, kind, amount, unit_no, customer, team, mode, remarks from bank_entries where project_id = $1 and kind in ('receipt', 'return') order by value_date desc, id", [projectId]);
  const dayMap = {};
  for (const t of bank) {
    const d = (dayMap[t.value_date] ||= { date: t.value_date, receipts: 0, count: 0, sales: 0, crm: 0, returns: 0, returnCount: 0, items: [], byWing: {} });
    const amt = n(t.amount), w = (t.unit_no || '').split('-')[0];
    if (t.kind === 'receipt') { d.receipts += amt; d.count++; if (t.team === 'CRM Team') d.crm += amt; else d.sales += amt; d.byWing[w] = (d.byWing[w] || 0) + amt; }
    else { d.returns += amt; d.returnCount++; d.byWing[w] = (d.byWing[w] || 0) - amt; }
    d.items.push({ kind: t.kind, unit: t.unit_no || '', customer: t.customer || '', amount: amt, team: t.team || '', mode: t.mode || '', remarks: t.remarks || '' });
  }
  const daily = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
  daily.forEach((d) => { d.net = d.receipts - d.returns; d.units = new Set(d.items.map((i) => i.unit).filter(Boolean)).size; });
  const mon = {};
  for (const d of daily) { const m = d.date.slice(0, 7); const x = (mon[m] ||= { month: m, receipts: 0, sales: 0, crm: 0, returns: 0, count: 0 }); x.receipts += d.receipts; x.sales += d.sales; x.crm += d.crm; x.returns += d.returns; x.count += d.count; }
  const monthly = Object.values(mon).sort((a, b) => a.month.localeCompare(b.month));
  monthly.forEach((m) => (m.net = m.receipts - m.returns));
  const lastBankDate = daily[0]?.date || '';

  // ---- the daily report block (the same lines as the sheet's Dashboard tab), per wing
  const line = (label, f) => { const o = { label }; let total = 0; wings.forEach((w, i) => { const v = f(units.filter((x) => x.wing === w), w); o[['a', 'b', 'c', 'd'][i] || w] = v; total += v; }); o.total = total; return o; };
  const todayRow = daily.find((d) => d.date === today);
  const dailyReport = {
    reportDate: today,
    rows: [
      line('Units Sold', (a) => a.filter((x) => x.booked).length),
      line('Registered', (a) => a.filter((x) => x.registered).length),
      line('Allotment', (a) => a.filter((x) => x.booked && !x.registered && /^allot/i.test(x.inventory)).length),
      line('Balance Registration', (a) => a.filter((x) => x.booked && !x.registered).length),
      line('Today Collection', (a, w) => (todayRow ? todayRow.byWing[w] || 0 : 0)),
      line('Demand Sent', (a) => sum(a, (x) => x.demanded)),
      line('Received As On Date', (a) => sum(a, (x) => x.receivedAV + x.tdsPaid)),
      line('Balance Collection', (a) => sum(a.filter((x) => x.booked), (x) => Math.max(0, x.balanceDue))),
    ],
  };

  // ---- stage-wise payment schedule for the project: what each stage is worth across all bookings, and
  // how much of it is in, applying each buyer's AV + TDS received to their stages in order.
  const plan = await db.q('select s.seq, s.name, s.pct from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active order by s.seq', [projectId]);
  const gstAv = await db.q("select b.agreement_value, b.gst_rate, coalesce(bb.credit_av, 0) as credit from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id where u.project_id = $1 and b.status = 'active'", [projectId]);
  const stRows = plan.map((s) => ({ stage: s.name, pct: n(s.pct) / 100, due: 0, gst: 0, received: 0, balance: 0 }));
  for (const b of gstAv) {
    let left = n(b.credit);
    plan.forEach((s, i) => {
      const amt = (n(b.agreement_value) * n(s.pct)) / 100;
      stRows[i].due += amt; stRows[i].gst += (amt * n(b.gst_rate)) / 100;
      const got = Math.min(left, amt); stRows[i].received += got; left -= got;
    });
  }
  stRows.forEach((r) => { r.balance = r.due - r.received; });
  const paymentSchedule = { rows: stRows, total: { stage: 'Total', pct: sum(stRows, (r) => r.pct), due: sum(stRows, (r) => r.due), gst: sum(stRows, (r) => r.gst), received: sum(stRows, (r) => r.received), balance: sum(stRows, (r) => r.balance) } };

  // ---- data checks: what the import flagged and the team has not closed yet
  const issues = await db.q("select kind, severity, count(*)::int as n from import_issues where project_id = $1 and status = 'open' group by kind, severity order by count(*) desc", [projectId]);
  const items = await db.q("select unit_no, kind, severity, detail from import_issues where project_id = $1 and status = 'open' order by (severity = 'money') desc, unit_no nulls first, id limit 400", [projectId]);
  const resolved = await db.one("select count(*)::int as n from import_issues where project_id = $1 and status = 'resolved'", [projectId]);

  return {
    meta: { generatedAt: now.toISOString(), source: 'erp', today, lastBankDate, wings, rows: { units: units.length, bookings: booked.length, bank: bank.length },
      bankIssue: bank.length ? null : 'No RERA account entries in the ERP yet. They come in with the import from the CRM sheet, and later from the bank statement upload in Accounts.' },
    totals, byWing, inventory, followUp, daily, monthly, actions, dates, units, cps, cpTotals, dailyReport, paymentSchedule,
    checks: { open: sum(issues, (i) => i.n), money: sum(issues.filter((i) => i.severity === 'money'), (i) => i.n), resolved: resolved.n, byKind: issues, items },
  };
}

module.exports = { build };
