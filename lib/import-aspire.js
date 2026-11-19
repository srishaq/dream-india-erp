// Dream Aspire: imports the Aspire CRM workbook ("Master Slab Wise Collection …xlsx" in the CRM folder) as opening
// balances (Rafi Sir, 19 Nov 2026). The actual payments and buyers' contacts come later and replace the opening receipts.
//   "Overall Net Receivables slabwis"  the developer's (DIB) sold flats: buyer, booking date, plan, agreement value,
//                                      TDS, received, and the amount due at each of the 16 stages (less TDS)
//   "Ragistration Status"              every unit: owner (DIB / Contractor / Refuge / Ground Commercial), sold or not,
//                                      the buyer and the registration date
// Units are matched by number (A-201 …), so the 13 flats already in the ERP are updated, not entered twice.
// Developer's sold flats become bookings with their demands raised to date and one opening receipt (plus the TDS);
// contractor's flats and the ground-floor shops are held with the buyer noted; refuge stays refuge; unsold stays available.
const { toDate, toNum } = require('./import-crm');
const audit = require('./audit');
const { addDays } = require('./demands');

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => { const n = toNum(v); return Number.isFinite(n) ? n : 0; };

// The 16 stages, in the sheet's column order. Names match the ERP's Ready-to-move plan where they overlap, so a
// stage recorded once on the building raises the demand for every plan.
const STAGES = [
  ['On booking', false], ['On registration', false], ['Plinth', true],
  ['Slab 3', true], ['Slab 6', true], ['Slab 9', true], ['Slab 12', true], ['Slab 15', true], ['Slab 18', true], ['Slab 21', true], ['Slab 23', true],
  ['Walls, internal plaster, flooring, doors & windows', true],
  ['Commencement of sanitary fittings, staircases, lift walls, lobbies up to the floor of the unit', true],
  ['Commencement of external plumbing and external plaster, elevation, terraces with waterproofing', true],
  ['On completion of lifts, electrical fittings, entrance lobby', true],
  ['Rest: on completion of the project', true],
].map(([name, linked]) => ({ name, linked }));

// From the "Slabwise Expectation" tab: the date each construction stage was demanded. Stages not listed are not demanded yet.
const STAGE_DATES = {
  Plinth: '2024-08-12', 'Slab 3': '2025-01-23', 'Slab 6': '2025-04-18', 'Slab 9': '2025-06-16', 'Slab 12': '2025-09-29',
  'Slab 15': '2025-10-15', 'Slab 18': '2025-12-22', 'Slab 21': '2026-02-07', 'Slab 23': '2026-03-13',
  [STAGES[11].name]: '2026-04-29', [STAGES[12].name]: '2026-09-06',
};

const typology = (sqft) => (sqft >= 600 ? '2BHK' : '1BHK');
const findTab = (tabs, re) => tabs.find((t) => re.test(t.name));

function parse(tabs, { asOf, stageDates = STAGE_DATES } = {}) {
  const issues = [];
  const issue = (unit, kind, severity, detail) => issues.push({ unit, kind, severity, detail });
  const regTab = findTab(tabs, /ragistration|registration/i), main = findTab(tabs, /overall/i);
  if (!regTab || !main) throw Object.assign(new Error('The workbook needs the "Overall Net Receivables slabwis" and "Ragistration Status" tabs.'), { status: 400 });

  // every unit, from the registration tab
  const units = [], reg = {};
  for (const r of regTab.rows.slice(1)) {
    const flat = clean(r[1]), owner = clean(r[3]).toLowerCase(), status = clean(r[4]).toLowerCase(), buyer = clean(r[5]);
    if (!flat || !owner) continue;
    const regDate = toDate(r[6]);
    const shop = /commercial/.test(owner);
    const unit_no = shop ? `A-SHOP ${flat.replace(/\s/g, '')}` : `A-${flat}`;
    const sqft = num(r[2]) || null;
    const u = { unit_no, floor: shop ? 0 : Math.floor(Number(flat) / 100), typology: shop ? 'Shop' : sqft ? typology(sqft) : null, carpet_sqft: sqft, carpet_sqm: sqft ? r2(sqft / 10.7639) : null, category: shop ? 'commercial' : 'residential', owner, buyer, regDate };
    if (/flat/i.test(flat)) continue; // a repeated header row
    if (!shop && !/^\d{3,4}$/.test(flat)) { issue(unit_no, 'odd-unit', 'data', `Unit "${flat}" on the registration tab is not a flat number; skipped.`); continue; }
    if (owner === 'refuge' || status === 'refuge') Object.assign(u, { status: 'refuge', hold_note: null });
    else if (status === 'unsold') Object.assign(u, { status: 'available', hold_note: null });
    else if (owner === 'contractor') Object.assign(u, { status: 'held', hold_note: `Contractor's flat${buyer ? `: sold to ${buyer}` : ''}${regDate ? `, registered ${regDate}` : ''}` });
    else if (shop) Object.assign(u, { status: 'held', hold_note: `Ground-floor shop${buyer ? `: sold to ${buyer}` : ''}${regDate ? `, registered ${regDate}` : ''}` });
    else Object.assign(u, { status: 'booked', hold_note: null, dib: true }); // developer's sale: confirmed below from the main tab
    units.push(u);
    reg[unit_no] = { regDate, buyer };
  }
  const unitByNo = Object.fromEntries(units.map((u) => [u.unit_no, u]));

  // the developer's sold flats
  const bookings = [];
  for (const r of main.rows.slice(2)) {
    const flat = Number(r[1]);
    if (!Number.isInteger(flat) || flat < 100 || !clean(r[4])) continue;
    const unit_no = `A-${flat}`;
    const u = unitByNo[unit_no];
    if (!u) { issue(unit_no, 'not-on-registration-tab', 'data', 'On the receivables tab but not on the registration tab; skipped.'); continue; }
    const av = num(r[9]) || num(r[7]) + num(r[8]);
    const avx = num(r[10]), tds = num(r[11]), received = num(r[12]);
    const stageAmt = STAGES.map((_, i) => num(r[15 + i]));
    const totalStages = stageAmt.reduce((a, v) => a + v, 0);
    const bDate = toDate(r[5]);
    const planName = clean(r[6]) || 'Not given';
    if (!(av > 0)) { issue(unit_no, 'no-agreement-value', 'money', `No agreement value ("${clean(r[4])}"); kept as held until fixed.`); Object.assign(u, { status: 'held', hold_note: `${clean(r[4])} (CRM sheet: no agreement value)` }); continue; }
    if (!bDate) { issue(unit_no, 'no-booking-date', 'data', 'No booking date; kept as held until fixed.'); Object.assign(u, { status: 'held', hold_note: 'Sold in the CRM sheet but no booking date' }); continue; }
    if (!(totalStages > 0)) { issue(unit_no, 'no-stage-split', 'money', 'No amounts against the stages, so the plan could not be worked out; kept as held.'); Object.assign(u, { status: 'held', hold_note: 'Sold in the CRM sheet but no stage amounts' }); continue; }
    if (Math.abs(totalStages - avx) > 5) issue(unit_no, 'stage-total', 'money', `The stage amounts add up to ₹${r2(totalStages)} but the agreement value less TDS is ₹${r2(avx)}. The plan was worked out from the stage amounts.`);
    const recvStages = Array.from({ length: 16 }, (_, i) => num(r[32 + i])).reduce((a, v) => a + v, 0);
    if (Math.abs(recvStages - received) > 5) issue(unit_no, 'received-total', 'money', `Received is ₹${r2(received)} but the stage-wise received adds up to ₹${r2(recvStages)}. ₹${r2(received)} was used.`);

    // the plan: each stage's share of the total, to 3 decimals, adding up to exactly 100
    const pcts = stageAmt.map((v) => Math.round((v / totalStages) * 100000) / 1000);
    const diff = Math.round((100 - pcts.reduce((a, v) => a + v, 0)) * 1000) / 1000;
    if (diff) { const big = pcts.indexOf(Math.max(...pcts)); pcts[big] = Math.round((pcts[big] + diff) * 1000) / 1000; }

    const regDate = reg[unit_no]?.regDate || null;
    if (!regDate && pcts[1] > 0) issue(unit_no, 'unregistered', 'data', 'Not registered yet, so the registration instalment is not demanded.');
    const demands = [];
    STAGES.forEach((s, i) => {
      if (!(pcts[i] > 0)) return;
      let date = null;
      if (i === 0) date = bDate;
      else if (i === 1) date = regDate;
      else date = stageDates[s.name] || null;
      if (!date) return;
      if (date < bDate) date = bDate; // a late buyer is demanded on booking
      demands.push({ stage_name: s.name, pct: pcts[i], demand_date: date });
    });
    const demandedLessTds = r2(demands.reduce((a, d) => a + stageAmt[STAGES.findIndex((s) => s.name === d.stage_name)], 0));
    const names = clean(r[4]).split(/\s*[\/&]\s*|\s+and\s+/i).map(clean).filter(Boolean);
    const tdsShare = avx > 0 ? r2(tds * received / avx) : 0;
    // the ERP works each demand out from the plan's percentages, so a few rupees of rounding can be left on a flat
    // that is fully paid in the sheet; those are taken as received rather than chased
    const demandedFull = demands.reduce((a, d) => a + r2(av * d.pct / 100), 0);
    const residue = r2(demandedFull - received - tdsShare);
    const receivedUsed = residue > 0 && residue < 100 ? r2(received + residue) : received;
    bookings.push({
      unit_no, booking_date: bDate, registration_date: regDate, agreement_value: r2(av), parking: num(r[8]) > 0 ? 1 : 0,
      plan_name: planName, pcts, applicants: names.map((name) => ({ name })), demands,
      received: receivedUsed, tds_share: tdsShare, demandedLessTds, dueNow: r2(demandedLessTds - received), sheetBalance: r2(num(r[14])),
      buyerOnRegTab: reg[unit_no]?.buyer || null,
    });
    u.status = regDate ? 'registered' : 'booked';
    u.booked = true;
  }
  // the small "OTHER / AMOUNT" table under the totals: other amounts the sheet counts against some flats
  let inOther = false;
  for (const r of main.rows) {
    if (/^other$/i.test(clean(r[11]))) { inOther = true; continue; }
    if (!inOther) continue;
    if (/total/i.test(clean(r[11]))) break;
    const f = Number(r[11]), amt = num(r[12]);
    if (Number.isInteger(f) && f >= 100 && amt > 0) issue(`A-${f}`, 'other-amount', 'money', `The sheet lists "OTHER" ₹${amt} for this flat under the totals. Check whether it is part of the amount received.`);
  }
  for (const u of units) if (u.dib && !u.booked && u.status === 'booked') {
    issue(u.unit_no, 'sold-not-on-receivables', 'data', `Marked sold to the developer's buyer${u.buyer ? ` (${u.buyer})` : ''} on the registration tab but not on the receivables tab; kept as held.`);
    Object.assign(u, { status: 'held', hold_note: `Sold${u.buyer ? ` to ${u.buyer}` : ''} (registration tab) but not on the receivables tab` });
  }
  issues.push({ unit: null, kind: 'no-contacts', severity: 'data', detail: 'The CRM workbook has no phone numbers, emails, addresses or PANs. Buyers were created by name only; contacts come with the next update.' });
  issues.push({ unit: null, kind: 'opening-receipts', severity: 'money', detail: `Money received is one opening receipt per flat, dated ${asOf}, from the sheet's "RECEIVED" total (less TDS). The TDS share and 5% GST on the amount received are assumed paid in proportion. All of these are replaced by the actual payments when they are imported.` });

  // payment plans: one per distinct split, named after the sheet's plan name
  const plans = new Map();
  for (const b of bookings) {
    const key = b.pcts.join('|');
    if (!plans.has(key)) plans.set(key, { key, pcts: b.pcts, sheetNames: new Map(), n: 0 });
    const p = plans.get(key); p.n++; p.sheetNames.set(b.plan_name.toUpperCase(), (p.sheetNames.get(b.plan_name.toUpperCase()) || 0) + 1);
  }
  // The standard construction-linked plan stays on offer for new bookings; every other split is the buyer's own
  // schedule, kept only for the bookings already on it (not offered for new bookings).
  const STANDARD = [10, 15, 15, 3, 3, 3, 3, 3, 3, 3, 3, 5, 10, 5, 11, 5].join('|');
  for (const b of bookings) b.plan_key = b.pcts.join('|');
  const used = new Set();
  for (const p of plans.values()) {
    const top = clean([...p.sheetNames.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    const label = top === 'CLP' ? 'CLP' : top === 'SPECIAL PLAN' ? 'Special plan' : top;
    const split = p.pcts.filter((v) => v > 0).map((v) => String(+v.toFixed(2))).join('-');
    const units1 = bookings.filter((b) => b.plan_key === p.key).map((b) => b.unit_no);
    p.active = p.key === STANDARD;
    let name = p.active ? 'Construction-linked (CLP)' : `${label}${units1.length <= 2 ? ` for ${units1.join(', ')}` : ''}: ${split}`.slice(0, 120);
    for (let i = 2; used.has(name); i++) name = `${name} (${i})`;
    used.add(name); p.name = name;
  }

  const sum = (f) => r2(bookings.reduce((a, b) => a + f(b), 0));
  const count = (s) => units.filter((u) => u.status === s).length;
  const summary = {
    units: units.length, bookings: bookings.length, booked: count('booked'), registered: count('registered'), held: count('held'), available: count('available'), refuge: count('refuge'),
    contractor: units.filter((u) => u.owner === 'contractor').length, shops: units.filter((u) => u.category === 'commercial').length,
    plans: plans.size, demands: bookings.reduce((a, b) => a + b.demands.length, 0),
    agreementValue: sum((b) => b.agreement_value), received: sum((b) => b.received), tds: sum((b) => b.tds_share), sheetBalance: sum((b) => b.sheetBalance),
    dueNow: sum((b) => Math.max(0, b.dueNow)), advance: sum((b) => Math.max(0, -b.dueNow)), issues: issues.length, asOf,
  };
  return { units, bookings, plans: [...plans.values()], stageDates, issues, summary };
}

async function commit(t, parsed, { projectId, user, source }) {
  const daysToPay = await require('./demands').daysToPay(t);
  const already = await t.one('select count(*)::int as n from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status in (\'active\', \'pending\')', [projectId]);
  if (already.n) throw Object.assign(new Error(`Dream Aspire already has ${already.n} bookings in the ERP, so the import was not run again.`), { status: 409 });
  const bld = await t.one("select id from buildings where project_id = $1 and code = 'A'", [projectId]);
  if (!bld) throw Object.assign(new Error('Dream Aspire has no building A in the ERP.'), { status: 400 });
  const gst = 5;

  // units: update the ones already there (matched by number), add the rest
  const urows = parsed.units.map((u) => ({ unit_no: u.unit_no, floor: u.floor, typology: u.typology, carpet_sqft: u.carpet_sqft, carpet_sqm: u.carpet_sqm, category: u.category, status: u.status, hold_note: u.hold_note }));
  const up = await t.q(`insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, carpet_sqm, category, status, hold_note, imported)
      select $1, $2, x.unit_no, x.floor, x.typology, x.carpet_sqft, x.carpet_sqm, x.category, x.status, x.hold_note, true
        from json_to_recordset($3::json) as x(unit_no text, floor int, typology text, carpet_sqft numeric, carpet_sqm numeric, category text, status text, hold_note text)
      on conflict (project_id, unit_no) do update set status = excluded.status, hold_note = excluded.hold_note,
        typology = coalesce(units.typology, excluded.typology), carpet_sqft = coalesce(excluded.carpet_sqft, units.carpet_sqft), carpet_sqm = coalesce(excluded.carpet_sqm, units.carpet_sqm), imported = true
      returning id, unit_no, (xmax = 0) as inserted`, [projectId, bld.id, JSON.stringify(urows)]);
  const unitId = Object.fromEntries(up.map((r) => [r.unit_no, r.id]));

  // payment plans and their stages
  const planId = {};
  for (const p of parsed.plans) {
    const row = await t.one('insert into payment_plans (project_id, name, active) values ($1, $2, $3) on conflict (project_id, name) do update set active = excluded.active returning id', [projectId, p.name, !!p.active]);
    planId[p.key] = row.id;
    const st = STAGES.map((s, i) => ({ seq: i + 1, name: s.name, pct: p.pcts[i], linked: s.linked })).filter((s) => s.pct > 0);
    await t.q('delete from plan_stages where plan_id = $1 and not exists (select 1 from bookings where plan_id = $1)', [row.id]);
    await t.q(`insert into plan_stages (plan_id, seq, name, pct, construction_linked) select $1, x.seq, x.name, x.pct, x.linked from json_to_recordset($2::json) as x(seq int, name text, pct numeric, linked boolean)
               on conflict (plan_id, seq) do nothing`, [row.id, JSON.stringify(st)]);
  }

  // bookings (already approved in the old process)
  const brows = parsed.bookings.map((b) => ({ unit_id: unitId[b.unit_no], plan_id: planId[b.plan_key], booking_date: b.booking_date, agreement_value: b.agreement_value, registration_date: b.registration_date, parking: b.parking, unit_no: b.unit_no, agreement_type: b.plan_name }));
  const bk = await t.q(`insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, registration_date, agreement_date, parking, status, legacy_ref, imported, approved_at, agreement_type, registration_status)
      select x.unit_id, x.plan_id, x.booking_date, x.agreement_value, $1, x.registration_date, x.registration_date, x.parking, 'active', x.unit_no, true, now(), x.agreement_type, case when x.registration_date is null then null else 'Done' end
        from json_to_recordset($2::json) as x(unit_id int, plan_id int, booking_date date, agreement_value numeric, registration_date date, parking int, unit_no text, agreement_type text)
      returning id, legacy_ref`, [gst, JSON.stringify(brows)]);
  const bookingId = Object.fromEntries(bk.map((r) => [r.legacy_ref, r.id]));

  // buyers (names only for now)
  const KEY = (b, i) => `aspire:${b.unit_no}#${i}`;
  const people = parsed.bookings.flatMap((b) => b.applicants.map((a, i) => ({ name: a.name, k: KEY(b, i) })));
  const by = await t.q('insert into buyers (name, import_key) select x.name, x.k from json_to_recordset($1::json) as x(name text, k text) returning id, import_key', [JSON.stringify(people)]);
  const buyerId = Object.fromEntries(by.map((r) => [r.import_key, r.id]));
  const links = parsed.bookings.flatMap((b) => b.applicants.map((a, i) => ({ booking_id: bookingId[b.unit_no], seq: i + 1, buyer_id: buyerId[KEY(b, i)] })));
  await t.q('insert into booking_applicants (booking_id, seq, buyer_id) select x.booking_id, x.seq, x.buyer_id from json_to_recordset($1::json) as x(booking_id int, seq int, buyer_id int)', [JSON.stringify(links)]);

  // demands raised to date
  const drows = parsed.bookings.flatMap((b) => b.demands.map((d) => ({ booking_id: bookingId[b.unit_no], stage: d.stage_name, pct: d.pct, date: d.demand_date, due: addDays(d.demand_date, daysToPay) })));
  await t.q(`insert into demands (booking_id, stage_name, pct, demand_date, due_date, amount, gst, opening)
      select x.booking_id, x.stage, x.pct, x.date, x.due, round(b.agreement_value * x.pct / 100, 2), round(round(b.agreement_value * x.pct / 100, 2) * b.gst_rate / 100, 2), true
        from json_to_recordset($1::json) as x(booking_id int, stage text, pct numeric, date date, due date) join bookings b on b.id = x.booking_id`, [JSON.stringify(drows)]);

  // opening receipts: the amount received (plus the assumed GST), and the TDS share as its own receipt
  const note = `Opening balance from the Aspire CRM sheet as on ${parsed.summary.asOf}. Replaced by the actual payments when they are imported.`;
  const rrows = parsed.bookings.flatMap((b) => {
    const out = [];
    if (b.received > 0) out.push({ booking_id: bookingId[b.unit_no], amount: r2(b.received * (1 + gst / 100)), mode: 'other', av: b.received, gst: r2(b.received * gst / 100), tds: 0, k: `aspire-open:${b.unit_no}` });
    if (b.tds_share > 0) out.push({ booking_id: bookingId[b.unit_no], amount: b.tds_share, mode: 'tds', av: 0, gst: 0, tds: b.tds_share, k: `aspire-open-tds:${b.unit_no}` });
    return out;
  });
  const rc = await t.q(`insert into receipts (project_id, booking_id, received_on, amount, mode, status, approved_at, opening, note, import_key)
      select $1, x.booking_id, $2, x.amount, x.mode, 'approved', now(), true, $3, x.k from json_to_recordset($4::json) as x(booking_id int, amount numeric, mode text, k text)
      returning id, import_key`, [projectId, parsed.summary.asOf, note, JSON.stringify(rrows)]);
  const rid = Object.fromEntries(rc.map((r) => [r.import_key, r.id]));
  const srows = rrows.flatMap((r) => [['av', r.av], ['gst', r.gst], ['tds', r.tds]].filter(([, v]) => v > 0).map(([head, amount]) => ({ receipt_id: rid[r.k], head, amount })));
  await t.q('insert into receipt_splits (receipt_id, head, amount) select x.receipt_id, x.head, x.amount from json_to_recordset($1::json) as x(receipt_id int, head text, amount numeric)', [JSON.stringify(srows)]);

  // construction stages already demanded, so a new booking is charged them on approval
  const stages = Object.entries(parsed.stageDates).map(([stage, date]) => ({ stage, date }));
  await t.q(`insert into stage_completions (building_id, stage_name, completed_on, certified_by, recorded_by)
      select $1, x.stage, x.date, 'Imported from the Aspire CRM sheet (demand date)', $2 from json_to_recordset($3::json) as x(stage text, date date)
      on conflict (building_id, stage_name) do nothing`, [bld.id, user.id, JSON.stringify(stages)]);

  const run = await t.one('insert into import_runs (project_id, source, summary, created_by) values ($1, $2, $3, $4) returning id', [projectId, source, parsed.summary, user.id]);
  const irows = parsed.issues.map((i) => ({ unit: i.unit, booking_id: i.unit ? bookingId[i.unit] || null : null, kind: i.kind, severity: i.severity, detail: i.detail }));
  await t.q(`insert into import_issues (run_id, project_id, unit_no, booking_id, kind, severity, detail)
      select $1, $2, x.unit, x.booking_id, x.kind, x.severity, x.detail from json_to_recordset($3::json) as x(unit text, booking_id int, kind text, severity text, detail text)`, [run.id, projectId, JSON.stringify(irows)]);
  await audit.record(t.q, { user, action: 'import', entity: 'project', entityId: projectId, projectId, after: { run: run.id, ...parsed.summary }, note: `Imported from ${source}` });
  return { run: run.id, units: up.length, newUnits: up.filter((r) => r.inserted).length, bookings: bk.length, plans: parsed.plans.length, demands: drows.length, receipts: rc.length, issues: irows.length };
}

// The contractor's flats (Rafi Sir, 20 Nov 2026): given to the contractor at a flat rate per sq ft of carpet, and the
// money adjusted against the construction bills. Each becomes a booking marked "contractor", in the name of whoever
// holds it now (the buyer the contractor sold it to, or the contractor), valued at area × rate. No demands are raised
// and nothing is ever asked of the buyer: Accounts enter the bill adjustments against these bookings.
async function contractorCommit(t, parsed, { projectId, user, rate, contractor, source }) {
  if (!(rate > 0)) throw Object.assign(new Error('Give the rate per sq ft.'), { status: 400 });
  const done = await t.one("select count(*)::int as n from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.sale_type = 'contractor' and b.status in ('active', 'pending')", [projectId]);
  if (done.n) throw Object.assign(new Error(`The contractor's flats are already in (${done.n}).`), { status: 409 });
  const flats = parsed.units.filter((u) => u.owner === 'contractor');
  const units = await t.q('select id, unit_no, carpet_sqft from units where project_id = $1 and unit_no = any($2)', [projectId, flats.map((f) => f.unit_no)]);
  const U = Object.fromEntries(units.map((u) => [u.unit_no, u]));
  const live = await t.q("select u.unit_no from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and u.unit_no = any($2) and b.status in ('active', 'pending')", [projectId, flats.map((f) => f.unit_no)]);
  if (live.length) throw Object.assign(new Error(`These flats already have a booking: ${live.map((x) => x.unit_no).join(', ')}.`), { status: 409 });
  const missing = flats.filter((f) => !U[f.unit_no] || !(Number(U[f.unit_no].carpet_sqft || f.carpet_sqft) > 0));
  if (missing.length) throw Object.assign(new Error(`No unit or carpet area for ${missing.map((f) => f.unit_no).join(', ')}.`), { status: 400 });

  const plan = await t.one(`insert into payment_plans (project_id, name, active) values ($1, 'Contractor flats: adjusted against construction bills', false)
      on conflict (project_id, name) do update set active = false returning id`, [projectId]);
  await t.q(`insert into plan_stages (plan_id, seq, name, pct, construction_linked) values ($1, 1, 'Adjusted against construction bills', 100, false) on conflict do nothing`, [plan.id]);

  const rows = flats.map((f) => {
    const sqft = Number(U[f.unit_no].carpet_sqft || f.carpet_sqft);
    const withContractor = !f.buyer || f.buyer.toLowerCase().includes(contractor.toLowerCase().split(' ')[0]);
    return { unit_id: U[f.unit_no].id, unit_no: f.unit_no, av: r2(sqft * rate), reg: f.regDate || null, booking_date: f.regDate || parsed.summary.asOf,
      names: (f.buyer || contractor).split(/\s*[\/&]\s*|\s+and\s+/i).map(clean).filter(Boolean), resold: !withContractor };
  });
  const bk = await t.q(`insert into bookings (unit_id, plan_id, booking_date, agreement_value, registration_date, agreement_date, status, legacy_ref, imported, approved_at, approved_by,
                          sale_type, contractor_name, contractor_rate, agreement_type, registration_status)
      select x.unit_id, $1, x.booking_date, x.av, x.reg, x.reg, 'active', x.unit_no, true, now(), $2, 'contractor', $3, $4,
             case when x.resold then 'Contractor flat, resold by the contractor' else 'Contractor flat, with the contractor' end, case when x.reg is null then null else 'Done' end
        from json_to_recordset($5::json) as x(unit_id int, unit_no text, av numeric, reg date, booking_date date, resold boolean) returning id, legacy_ref`,
  [plan.id, user.id, contractor, rate, JSON.stringify(rows)]);
  const B = Object.fromEntries(bk.map((r) => [r.legacy_ref, r.id]));
  const people = rows.flatMap((r) => r.names.map((name, i) => ({ name, k: `aspire-contractor:${r.unit_no}#${i}`, b: B[r.unit_no], seq: i + 1 })));
  const by = await t.q('insert into buyers (name, import_key) select x.name, x.k from json_to_recordset($1::json) as x(name text, k text) returning id, import_key', [JSON.stringify(people)]);
  const Y = Object.fromEntries(by.map((r) => [r.import_key, r.id]));
  await t.q('insert into booking_applicants (booking_id, seq, buyer_id) select x.b, x.seq, x.y from json_to_recordset($1::json) as x(b int, seq int, y int)', [JSON.stringify(people.map((p) => ({ b: p.b, seq: p.seq, y: Y[p.k] })))]);
  await t.q(`update units set status = case when x.reg is null then 'booked' else 'registered' end, hold_note = null from json_to_recordset($1::json) as x(unit_id int, reg date) where units.id = x.unit_id`, [JSON.stringify(rows)]);
  const total = r2(rows.reduce((a, r) => a + r.av, 0));
  await audit.record(t.q, { user, action: 'contractor-flats', entity: 'project', entityId: projectId, projectId, after: { flats: rows.length, rate, contractor, total, resold: rows.filter((r) => r.resold).length }, note: `Contractor's flats from ${source}` });
  return { flats: rows.length, resold: rows.filter((r) => r.resold).length, withContractor: rows.filter((r) => !r.resold).length, sqft: r2(rows.reduce((a, r) => a + r.av / rate, 0)), total };
}

module.exports = { parse, commit, contractorCommit, STAGES, STAGE_DATES };
