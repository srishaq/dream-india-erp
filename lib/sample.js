// Sample data for the TEST version only: Dream Signature A and B Wing laid out like the real towers
// (floors 10 to 45, 8 units a floor), with made-up buyers named "Sample Buyer …", bookings, demands up to
// the stages the real project has reached (B Wing: plinth demanded; A Wing: excavation demanded), and receipts.
// Every row is flagged sample = true (bookings, units) and can be removed with clear().

// Small seeded random generator so the sample is the same every time.
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }
const LAYOUT = [['2BHK', 532], ['1BHK', 411], ['1BHK', 411], ['2BHK', 625], ['1BHK', 411], ['1BHK', 411], ['2BHK', 625], ['2BHK', 532]];
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = (x) => Math.round(x * 100) / 100;

async function load(t, projectId, userId) {
  const existing = await t.one('select count(*)::int as n from units where project_id = $1', [projectId]);
  if (existing.n > 0) throw Object.assign(new Error('This project already has units, so sample data was not added.'), { status: 409 });
  const plan = await t.one('select id from payment_plans where project_id = $1 and active order by id limit 1', [projectId]);
  const stages = await t.q('select name, pct, seq from plan_stages where plan_id = $1 order by seq', [plan.id]);
  const st = (seq) => stages.find((s) => s.seq === seq);
  const blds = await t.q("select id, code from buildings where project_id = $1 and code in ('A', 'B') order by code", [projectId]);
  if (blds.length !== 2) throw Object.assign(new Error('Sample data needs buildings A and B.'), { status: 400 });
  const rand = rng(20261026);

  // Units
  const units = [];
  for (const b of blds) for (let f = 10; f <= 45; f++) LAYOUT.forEach(([typ, sqft], i) => {
    const no = `${b.code}-${f}${String(i + 1).padStart(2, '0')}`;
    const refuge = (f === 24) || (f === 38 && i < 3);
    units.push({ building_id: b.id, unit_no: no, floor: f, typology: typ, carpet_sqft: sqft, carpet_sqm: r2(sqft / 10.7639), status: refuge ? 'refuge' : 'available', wing: b.code });
  });
  const ins = await t.q(
    `insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, carpet_sqm, status, sample)
     select $1, x.building_id, x.unit_no, x.floor, x.typology, x.carpet_sqft, x.carpet_sqm, x.status, true
       from json_to_recordset($2::json) as x(building_id int, unit_no text, floor int, typology text, carpet_sqft numeric, carpet_sqm numeric, status text)
     returning id, unit_no`, [projectId, JSON.stringify(units)]);
  const unitId = Object.fromEntries(ins.map((r) => [r.unit_no, r.id]));

  // Bookings: about 88% of saleable units, a few held for management, 5 waiting for approval.
  const bookings = [], held = [];
  for (const u of units.filter((x) => x.status === 'available')) {
    const p = rand();
    if (p < 0.03) { held.push(u.unit_no); continue; }
    if (p > 0.91) continue;
    const av = Math.round(u.carpet_sqft * (18000 + u.floor * 60) / 1000) * 1000;
    const month = Math.floor(rand() * 14); // booked Aug 2025 .. Sep 2026
    const bookingDate = addDays('2025-08-01', month * 30 + Math.floor(rand() * 25));
    const registered = rand() < 0.82;
    bookings.push({ ...u, av, bookingDate, registered, registrationDate: registered ? addDays(bookingDate, 20 + Math.floor(rand() * 60)) : null, pay: rand(), loan: rand() < 0.55 });
  }
  const pendingKeys = new Set(bookings.slice(-5).map((b) => b.unit_no));
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  for (const b of bookings) if (b.registrationDate && b.registrationDate > today) { b.registrationDate = null; b.registered = false; }

  await t.q(`update units set status = 'held', hold_note = 'Sample: held for management' where project_id = $1 and unit_no = any($2::text[])`, [projectId, held]);
  const bk = await t.q(
    `insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, agreement_date, registration_date, stamp_duty, registration_fee, funding, loan_bank, source, status, legacy_ref, sample, created_by, approved_at)
     select x.unit_id, $1, x.booking_date, x.av, 5, x.registration_date, x.registration_date, case when x.registration_date is null then null else round(x.av * 0.06) end,
            case when x.registration_date is null then null else 30000 end, x.funding, x.loan_bank, 'Sample', x.status, x.unit_no, true, null, case when x.status = 'active' then now() end
       from json_to_recordset($2::json) as x(unit_id int, booking_date date, av numeric, registration_date date, funding text, loan_bank text, status text, unit_no text)
     returning id, legacy_ref`,
    [plan.id, JSON.stringify(bookings.map((b) => ({ unit_id: unitId[b.unit_no], booking_date: b.bookingDate, av: b.av, registration_date: pendingKeys.has(b.unit_no) ? null : b.registrationDate, funding: b.loan ? 'loan' : 'self', loan_bank: b.loan ? ['HDFC Bank', 'SBI', 'ICICI Bank', 'Axis Bank'][Math.floor(rand() * 4)] : null, status: pendingKeys.has(b.unit_no) ? 'pending' : 'active', unit_no: b.unit_no })))]);
  const bookingId = Object.fromEntries(bk.map((r) => [r.legacy_ref, r.id]));
  const buyers = await t.q(
    `insert into buyers (name, phone) select x.name, x.phone from json_to_recordset($1::json) as x(name text, phone text) returning id, name`,
    [JSON.stringify(bookings.map((b) => ({ name: `Sample Buyer ${b.unit_no}`, phone: '90000' + String(10000 + Math.floor(rand() * 89999)) })))]);
  await t.q(
    `insert into booking_applicants (booking_id, seq, buyer_id) select x.booking_id, 1, x.buyer_id from json_to_recordset($1::json) as x(booking_id int, buyer_id int)`,
    [JSON.stringify(buyers.map((y) => ({ booking_id: bookingId[y.name.replace('Sample Buyer ', '')], buyer_id: y.id })))]);
  await t.q(`update units u set status = case when b.status = 'pending' then 'blocked' when b.registration_date is not null then 'registered' else 'booked' end
               from bookings b where b.unit_id = u.id and u.project_id = $1 and b.sample`, [projectId]);

  // Construction stages done: both wings excavated; B Wing plinth done and demanded. A Wing plinth is next.
  const A = blds.find((b) => b.code === 'A').id, B = blds.find((b) => b.code === 'B').id;
  await t.q(`insert into stage_completions (building_id, stage_name, completed_on, certified_by, recorded_by) values
             ($1, $3, '2026-05-10', 'Sample: site engineer', $5), ($2, $3, '2026-05-10', 'Sample: site engineer', $5), ($2, $4, '2026-08-05', 'Sample: site engineer', $5)`,
    [A, B, st(3).name, st(4).name, userId]);
  const runs = await t.q(`insert into demand_runs (project_id, building_id, stage_name, demand_date, due_date, status, approved_at) values
             ($1, $2, $4, '2026-05-15', '2026-05-30', 'approved', now()), ($1, $3, $4, '2026-05-15', '2026-05-30', 'approved', now()), ($1, $3, $5, '2026-08-10', '2026-08-25', 'approved', now())
             returning id, building_id, stage_name`, [projectId, A, B, st(3).name, st(4).name]);

  // Demands for active bookings: booking, registration (if registered), then the construction stages reached.
  const demands = [];
  for (const b of bookings) {
    if (pendingKeys.has(b.unit_no)) continue;
    const add = (s, date, runId = null) => demands.push({ booking_id: bookingId[b.unit_no], run_id: runId, stage: s.name, pct: s.pct, date, due: addDays(date, 15), amount: r2(b.av * s.pct / 100) });
    add(st(1), b.bookingDate);
    if (b.registrationDate) add(st(2), b.registrationDate);
    const stagesDone = b.wing === 'B' ? [3, 4] : [3];
    for (const seq of stagesDone) {
      const run = runs.find((r) => r.stage_name === st(seq).name && r.building_id === (b.wing === 'A' ? A : B));
      const runDate = seq === 3 ? '2026-05-15' : '2026-08-10';
      add(st(seq), b.bookingDate > runDate ? b.bookingDate : runDate, b.bookingDate > runDate ? null : run.id);
    }
  }
  await t.q(
    `insert into demands (booking_id, run_id, stage_name, pct, demand_date, due_date, amount, gst)
     select x.booking_id, x.run_id, x.stage, x.pct, x.date, x.due, x.amount, round(x.amount * 0.05, 2)
       from json_to_recordset($1::json) as x(booking_id int, run_id int, stage text, pct numeric, date date, due date, amount numeric)`, [JSON.stringify(demands)]);

  // Receipts: most buyers pay in full, some part, some only the booking amount. TDS is 1% of the AV paid.
  const receipts = [];
  const byBooking = new Map();
  for (const d of demands) { if (!byBooking.has(d.booking_id)) byBooking.set(d.booking_id, []); byBooking.get(d.booking_id).push(d); }
  for (const b of bookings) {
    const ds = byBooking.get(bookingId[b.unit_no]) || [];
    ds.forEach((d, i) => {
      let share = 1;
      if (b.pay < 0.12 && i > 0) share = 0;                 // paid only the booking amount
      else if (b.pay < 0.30 && i === ds.length - 1) share = 0.5; // half of the latest demand
      else if (b.pay < 0.36 && i === ds.length - 1) share = 0;   // nothing on the latest demand yet
      if (!share || d.due > today) return;
      const av = r2(d.amount * share * 0.99), tds = r2(d.amount * share * 0.01), gst = r2(d.amount * share * 0.05);
      const on = addDays(d.date, 3 + Math.floor(rand() * 20));
      if (on > today) return;
      receipts.push({ booking_id: d.booking_id, on, av, tds, gst, bank: b.loan && i > 1 ? b.loanBankName || 'Home loan disbursement' : ['ICICI Bank', 'HDFC Bank', 'SBI', 'Kotak'][Math.floor(rand() * 4)], instrument: 'SMP' + String(100000 + receipts.length), pending: false });
    });
  }
  for (const r of receipts.slice(-6)) r.pending = true; // a few waiting for Head Accounts
  const rc = await t.q(
    `insert into receipts (project_id, booking_id, received_on, amount, mode, bank, instrument_no, status, approved_at, note)
     select $1, x.booking_id, x."on", x.av + x.tds + x.gst, 'bank', x.bank, x.instrument, case when x.pending then 'pending' else 'approved' end,
            case when x.pending then null else now() end, 'Sample receipt'
       from json_to_recordset($2::json) as x(booking_id int, "on" date, av numeric, tds numeric, gst numeric, bank text, instrument text, pending boolean)
     returning id, instrument_no`, [projectId, JSON.stringify(receipts)]);
  const rid = Object.fromEntries(rc.map((r) => [r.instrument_no, r.id]));
  const splits = receipts.flatMap((r) => [['av', r.av], ['tds', r.tds], ['gst', r.gst]].map(([head, amount]) => ({ receipt_id: rid[r.instrument], head, amount })));
  await t.q(`insert into receipt_splits (receipt_id, head, amount) select x.receipt_id, x.head, x.amount from json_to_recordset($1::json) as x(receipt_id int, head text, amount numeric)`, [JSON.stringify(splits)]);

  return { units: units.length, bookings: bookings.length, pending: pendingKeys.size, demands: demands.length, receipts: receipts.length };
}

// Removes everything Module 1 holds for the project, only if all of it is sample data.
async function clear(t, projectId) {
  const real = await t.one('select count(*)::int as n from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and not b.sample', [projectId]);
  const realUnits = await t.one('select count(*)::int as n from units where project_id = $1 and not sample', [projectId]);
  if (real.n || realUnits.n) throw Object.assign(new Error('This project has real units or bookings, so nothing was removed.'), { status: 409 });
  const ids = `(select b.id from bookings b join units u on u.id = b.unit_id where u.project_id = ${Number(projectId)})`;
  await t.q(`delete from receipt_splits where receipt_id in (select id from receipts where project_id = $1)`, [projectId]);
  await t.q('delete from receipts where project_id = $1', [projectId]);
  await t.q(`delete from demands where booking_id in ${ids}`);
  await t.q('delete from demand_runs where project_id = $1', [projectId]);
  await t.q('delete from stage_completions where building_id in (select id from buildings where project_id = $1)', [projectId]);
  const buyerIds = (await t.q(`select buyer_id from booking_applicants where booking_id in ${ids}`)).map((r) => r.buyer_id);
  await t.q(`delete from booking_applicants where booking_id in ${ids}`);
  await t.q('delete from buyers where id = any($1::int[])', [buyerIds]);
  await t.q(`delete from bookings where id in ${ids}`);
  await t.q('delete from units where project_id = $1', [projectId]);
}

module.exports = { load, clear };
