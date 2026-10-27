// Saves a parsed CRM-sheet import into the ERP in one transaction. Only allowed into a project that has no
// real units yet (sample data is removed first). Every booking, demand and receipt is marked as imported /
// opening, and every flagged item becomes a "to verify" entry.
const sample = require('./sample');
const audit = require('./audit');
const { addDays } = require('./demands');

const KEY = (b, i) => `${b.unit_no}#${i}`;

async function commit(t, parsed, { projectId, user, source, daysToPay }) {
  const real = await t.one('select count(*)::int as n from units where project_id = $1 and not sample', [projectId]);
  if (real.n) throw Object.assign(new Error('This project already has real units in the ERP, so the import was not run again. Fix items on the "Data to verify" page instead.'), { status: 409 });
  const smp = await t.one('select count(*)::int as n from units where project_id = $1 and sample', [projectId]);
  if (smp.n) await sample.clear(t, projectId);

  const missing = Object.entries(parsed.stageDates).filter(([, d]) => !d).map(([k]) => k.replace('|', ' wing: '));
  if (missing.length) throw Object.assign(new Error(`Enter the date these stages were demanded: ${missing.join('; ')}.`), { status: 400 });

  const blds = Object.fromEntries((await t.q('select code, id from buildings where project_id = $1', [projectId])).map((b) => [b.code, b.id]));
  const plan = await t.one('select id from payment_plans where project_id = $1 and active order by id limit 1', [projectId]);

  // units
  const urows = parsed.units.map((u) => ({ building_id: blds[u.wing], unit_no: u.unit_no, floor: u.floor, typology: u.typology, carpet_sqft: u.carpet_sqft, carpet_sqm: u.carpet_sqm, status: u.status, hold_note: u.hold_note, sheet_status: u.sheet_status || null }));
  const ins = await t.q(
    `insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, carpet_sqm, status, hold_note, sheet_status, imported)
     select $1, x.building_id, x.unit_no, x.floor, x.typology, x.carpet_sqft, x.carpet_sqm, x.status, x.hold_note, x.sheet_status, true
       from json_to_recordset($2::json) as x(building_id int, unit_no text, floor int, typology text, carpet_sqft numeric, carpet_sqm numeric, status text, hold_note text, sheet_status text)
     returning id, unit_no`, [projectId, JSON.stringify(urows)]);
  const unitId = Object.fromEntries(ins.map((r) => [r.unit_no, r.id]));

  // bookings (already approved: they were approved in the old process)
  const brows = parsed.bookings.map((b) => ({ ...b, unit_id: unitId[b.unit_no], applicants: undefined, demands: undefined, receipts: undefined, remark: undefined }));
  const bk = await t.q(
    `insert into bookings (unit_id, plan_id, booking_date, agreement_value, gst_rate, stamp_duty, registration_fee, agreement_date, registration_date, parking, funding, loan_bank, source, cp_name, brokerage, rm_name, status, legacy_ref, imported, approved_at,
                           crm_status, registration_status, booking_form_date, bank_noc_date, sdr_paid, brokerage_released, market_value, agreement_type, dev_charges)
     select x.unit_id, $1, x.booking_date, x.agreement_value, x.gst_rate, x.stamp_duty, x.registration_fee, x.agreement_date, x.registration_date, x.parking, x.funding, x.loan_bank, x.source, x.cp_name, x.brokerage, x.rm_name, 'active', x.unit_no, true, now(),
            x.crm_status, x.registration_status, x.booking_form_date, x.bank_noc_date, x.sdr_paid, coalesce(x.brokerage_released, false), x.market_value, x.agreement_type, x.dev_charges
       from json_to_recordset($2::json) as x(unit_id int, booking_date date, agreement_value numeric, gst_rate numeric, stamp_duty numeric, registration_fee numeric, agreement_date date, registration_date date,
            parking int, funding text, loan_bank text, source text, cp_name text, brokerage numeric, rm_name text, unit_no text,
            crm_status text, registration_status text, booking_form_date date, bank_noc_date date, sdr_paid numeric, brokerage_released boolean, market_value numeric, agreement_type text, dev_charges numeric)
     returning id, legacy_ref`, [plan.id, JSON.stringify(brows)]);
  const bookingId = Object.fromEntries(bk.map((r) => [r.legacy_ref, r.id]));

  // buyers and applicants
  const people = parsed.bookings.flatMap((b) => b.applicants.map((a, i) => ({ ...a, k: KEY(b, i) })));
  const by = await t.q(
    `insert into buyers (name, pan, aadhaar, phone, email, address, import_key)
     select x.name, x.pan, x.aadhaar, x.phone, x.email, x.address, x.k from json_to_recordset($1::json) as x(name text, pan text, aadhaar text, phone text, email text, address text, k text)
     returning id, import_key`, [JSON.stringify(people)]);
  const buyerId = Object.fromEntries(by.map((r) => [r.import_key, r.id]));
  const links = parsed.bookings.flatMap((b) => b.applicants.map((a, i) => ({ booking_id: bookingId[b.unit_no], seq: i + 1, buyer_id: buyerId[KEY(b, i)] })));
  await t.q('insert into booking_applicants (booking_id, seq, buyer_id) select x.booking_id, x.seq, x.buyer_id from json_to_recordset($1::json) as x(booking_id int, seq int, buyer_id int)', [JSON.stringify(links)]);

  // demands
  const drows = parsed.bookings.flatMap((b) => b.demands.map((d) => ({ booking_id: bookingId[b.unit_no], stage: d.stage_name, pct: d.pct, date: d.demand_date, due: addDays(d.demand_date, daysToPay) })));
  await t.q(
    `insert into demands (booking_id, stage_name, pct, demand_date, due_date, amount, gst, opening)
     select x.booking_id, x.stage, x.pct, x.date, x.due, round(b.agreement_value * x.pct / 100, 2), round(round(b.agreement_value * x.pct / 100, 2) * b.gst_rate / 100, 2), true
       from json_to_recordset($1::json) as x(booking_id int, stage text, pct numeric, date date, due date) join bookings b on b.id = x.booking_id`, [JSON.stringify(drows)]);

  // receipts and their splits (approved: the money is already in the bank)
  const rrows = parsed.bookings.flatMap((b) => b.receipts.map((r, i) => ({ booking_id: bookingId[b.unit_no], on: r.received_on, amount: r.amount, mode: r.mode, bank: r.bank, inst: r.instrument_no, k: KEY(b, i) })));
  const rc = await t.q(
    `insert into receipts (project_id, booking_id, received_on, amount, mode, bank, instrument_no, status, approved_at, opening, note, import_key)
     select $1, x.booking_id, x."on", x.amount, x.mode, x.bank, x.inst, 'approved', now(), true, 'Imported from CRM sheet (Ledger tab)', x.k
       from json_to_recordset($2::json) as x(booking_id int, "on" date, amount numeric, mode text, bank text, inst text, k text)
     returning id, import_key`, [projectId, JSON.stringify(rrows)]);
  const receiptId = Object.fromEntries(rc.map((r) => [r.import_key, r.id]));
  const srows = parsed.bookings.flatMap((b) => b.receipts.flatMap((r, i) => Object.entries(r.splits).filter(([, v]) => v > 0).map(([head, amount]) => ({ receipt_id: receiptId[KEY(b, i)], head, amount }))));
  await t.q('insert into receipt_splits (receipt_id, head, amount) select x.receipt_id, x.head, x.amount from json_to_recordset($1::json) as x(receipt_id int, head text, amount numeric)', [JSON.stringify(srows)]);

  // construction stages already demanded, so new bookings are charged them on approval
  const stages = Object.entries(parsed.stageDates).map(([k, date]) => { const [wing, stage] = k.split('|'); return { building_id: blds[wing], stage, date }; }).filter((s) => s.building_id);
  await t.q(`insert into stage_completions (building_id, stage_name, completed_on, certified_by, recorded_by)
             select x.building_id, x.stage, x.date, 'Imported from CRM sheet (demand date)', $2 from json_to_recordset($1::json) as x(building_id int, stage text, date date)
             on conflict (building_id, stage_name) do nothing`, [JSON.stringify(stages), user.id]);

  // the CRM team's latest remark per buyer, as a follow-up note
  const notes = parsed.bookings.filter((b) => b.remark).map((b) => ({ booking_id: bookingId[b.unit_no], note: b.remark.slice(0, 1000) }));
  await t.q("insert into follow_ups (booking_id, kind, outcome, note) select x.booking_id, 'Note', 'Other', 'Remark from CRM sheet: ' || x.note from json_to_recordset($1::json) as x(booking_id int, note text)", [JSON.stringify(notes)]);

  // the RERA collection account statement, for the daily and monthly collection reports
  await t.q(`insert into bank_entries (project_id, value_date, kind, amount, unit_no, customer, team, mode, description, remarks, imported)
             select $1, x.value_date, x.kind, x.amount, x.unit_no, x.customer, x.team, x.mode, x.description, x.remarks, true
               from json_to_recordset($2::json) as x(value_date date, kind text, amount numeric, unit_no text, customer text, team text, mode text, description text, remarks text)`,
  [projectId, JSON.stringify(parsed.bankEntries || [])]);

  // the run and its issues
  const run = await t.one('insert into import_runs (project_id, source, summary, created_by) values ($1, $2, $3, $4) returning id', [projectId, source, parsed.summary, user.id]);
  const irows = parsed.issues.map((i) => ({ unit: i.unit, booking_id: i.unit ? bookingId[i.unit] || null : null, kind: i.kind, severity: i.severity, detail: i.detail }));
  await t.q(`insert into import_issues (run_id, project_id, unit_no, booking_id, kind, severity, detail)
             select $1, $2, x.unit, x.booking_id, x.kind, x.severity, x.detail from json_to_recordset($3::json) as x(unit text, booking_id int, kind text, severity text, detail text)`, [run.id, projectId, JSON.stringify(irows)]);
  await audit.record(t.q, { user, action: 'import', entity: 'project', entityId: projectId, projectId, after: { run: run.id, ...parsed.summary }, note: `Imported from ${source}` });
  return { run: run.id, units: ins.length, bookings: bk.length, receipts: rc.length, demands: drows.length, issues: irows.length };
}

module.exports = { commit };
