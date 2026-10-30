// Partner & Telemarketing: the rules shared by the staff pages (api/tm.js) and the partner portal (api/cp-portal.js).
//
// A number belongs to the partner who uploads it first, for the ownership period (settings.tm.ownershipDays, 90 days;
// a site visit booked on a call extends it). An upload checks every row against:
//   existing customers (buyers in the ERP), people who asked not to be called, the partner's own earlier upload for the
//   same launch, another partner's live ownership, and (when historyPolicy is 'reject') numbers from earlier projects.
// Partners never learn which other partner owns a number.
// Calling: staff print call sheets (call-backs due first, then numbers to retry, then fresh ones; a number is never on
// two open sheets), callers write a code 1-8 against each number, and one person types the codes in.
const db = require('./db');

const OUTCOMES = { 1: 'Interested, send details', 2: 'Site visit booked', 3: 'Call back later', 4: 'Not interested',
  5: 'Not reachable', 6: 'Wrong number', 7: 'Bought elsewhere', 8: 'Do not call' };
const OUTCOME_STATUS = { 1: 'interested', 2: 'visit', 3: 'callback', 4: 'not_interested', 5: 'not_reachable', 6: 'wrong_number', 7: 'bought_elsewhere', 8: 'dnc' };
const STATUS = { fresh: 'Not called yet', history: 'From earlier calling, not called again yet', interested: 'Interested', visit: 'Site visit booked', callback: 'Call back',
  not_interested: 'Not interested', not_reachable: 'Not reachable', wrong_number: 'Wrong number', bought_elsewhere: 'Bought elsewhere', dnc: 'Do not call', booked: 'Booked' };
const CONNECTED = [1, 2, 3, 4, 7, 8];
const REASONS = ['Invalid number', 'Repeated in file', 'Already uploaded by you', 'Registered with another partner',
  'In Dream India database', 'Existing customer', 'Asked not to be called'];
const MAX_ROWS = 5000;

const err = (status, message) => Object.assign(new Error(message), { status });
const n = (v) => Number(v) || 0;
const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

// A 10-digit Indian mobile, or ''.
function mobile(v) {
  let x = String(v == null ? '' : v).replace(/\D/g, '');
  if (x.length === 12 && x.startsWith('91')) x = x.slice(2);
  else if (x.length === 11 && x.startsWith('0')) x = x.slice(1);
  return /^[6-9]\d{9}$/.test(x) ? x : '';
}
const mask = (p) => { p = String(p || ''); return p.length === 10 ? p.slice(0, 2) + 'XXXXXX' + p.slice(8) : p ? 'XXXX' + p.slice(-2) : ''; };
// every mobile in a text such as "9820700800/ 9320800900"
const mobilesIn = (t) => (String(t || '').match(/(?:\+?91[\s-]?|0)?[6-9]\d(?:[\s-]?\d){8}/g) || []).map(mobile).filter(Boolean);

async function settings() {
  const r = await db.one("select value from settings where key = 'tm'");
  return { ownershipDays: 90, historyPolicy: 'reject', autoApprove: false, maxAttempts: 3, gapDays: 2, waOtpTemplate: '', waWelcomeTemplate: '', ...(r ? r.value : {}) };
}

// Mobile numbers of every buyer in the ERP (existing customers), as a Set.
async function customerMobiles(q = db.q) {
  const rows = await q("select phone from buyers where coalesce(phone, '') <> ''");
  const s = new Set();
  for (const r of rows) for (const m of mobilesIn(r.phone)) s.add(m);
  return s;
}

// Projects open for upload today.
async function openProjects(q = db.q) {
  return q(`select id, name, location, rera_no, upload_until from tm_projects
     where status = 'open' and not history and (upload_until is null or upload_until >= $1::date) order by id`, [istToday()]);
}

// rows: [{ name, mobile, config, locality, budget, purpose }]. Returns the result shown to the partner.
async function upload({ cpId, projectId, rows, fileName }) {
  if (!Array.isArray(rows) || !rows.length) throw err(400, 'The file has no rows.');
  if (rows.length > MAX_ROWS) throw err(400, `Please upload at most ${MAX_ROWS.toLocaleString('en-IN')} rows at a time.`);
  const S = await settings();
  const today = istToday(), until = addDays(today, +S.ownershipDays || 90);
  return db.tx(async (t) => {
    const p = await t.one('select id, status, history, upload_until from tm_projects where id = $1', [projectId]);
    if (!p || p.history || p.status !== 'open' || (p.upload_until && iso(p.upload_until) < today)) throw err(400, 'This project is not open for uploads.');
    // one upload at a time per launch, so two partners sending the same number cannot both get it
    await t.q('select pg_advisory_xact_lock(7101, $1)', [projectId]);
    const nums = [...new Set(rows.map((r) => mobile(r && r.mobile)).filter(Boolean))];
    const recs = nums.length ? await t.q(`select mobile, tm_project_id, cp_id, source, owner_until, status from tm_leads where mobile = any($1::text[])`, [nums]) : [];
    const byNum = new Map();
    for (const r of recs) (byNum.get(r.mobile) || byNum.set(r.mobile, []).get(r.mobile)).push(r);
    const dnc = new Set(nums.length ? (await t.q('select mobile from tm_dnc where mobile = any($1::text[])', [nums])).map((r) => r.mobile) : []);
    const customers = await customerMobiles(t.q);
    const counts = Object.fromEntries(REASONS.map((k) => [k, 0]));
    const seen = new Set(), add = [], issues = [];
    rows.forEach((x, i) => {
      x = x || {};
      const m = mobile(x.mobile);
      let reason = '';
      if (!m) reason = 'Invalid number';
      else if (seen.has(m)) reason = 'Repeated in file';
      else {
        const rs = byNum.get(m) || [];
        if (customers.has(m) || rs.some((r) => r.status === 'booked')) reason = 'Existing customer';
        else if (dnc.has(m)) reason = 'Asked not to be called';
        else if (rs.some((r) => r.cp_id === cpId && r.tm_project_id === projectId && iso(r.owner_until) >= today)) reason = 'Already uploaded by you';
        else if (rs.some((r) => r.cp_id && r.cp_id !== cpId && iso(r.owner_until) >= today)) reason = 'Registered with another partner';
        else if (S.historyPolicy !== 'accept' && rs.some((r) => r.source === 'history')) reason = 'In Dream India database';
      }
      if (m) seen.add(m);
      if (reason) { counts[reason]++; issues.push({ row: i + 2, name: clean(x.name, 80), mobile: m || clean(x.mobile, 20), reason }); }
      else add.push([m, clean(x.name, 80), clean(x.config, 30), clean(x.locality, 60), clean(x.budget, 30), clean(x.purpose, 30)]);
    });
    for (let i = 0; i < add.length; i += 1000) {
      const part = add.slice(i, i + 1000);
      await t.q(`insert into tm_leads (mobile, name, config, locality, budget, purpose, tm_project_id, cp_id, source, uploaded_on, owner_until)
        select m, nm, cf, lc, bg, pu, $7, $8, 'partner', $9::date, $10::date
          from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as u(m, nm, cf, lc, bg, pu)`,
      [part.map((r) => r[0]), part.map((r) => r[1]), part.map((r) => r[2]), part.map((r) => r[3]), part.map((r) => r[4]), part.map((r) => r[5]), projectId, cpId, today, until]);
    }
    const up = await t.one(`insert into tm_uploads (cp_id, tm_project_id, file_name, received, accepted, counts) values ($1, $2, $3, $4, $5, $6) returning id`,
      [cpId, projectId, clean(fileName, 120) || null, rows.length, add.length, counts]);
    for (let i = 0; i < issues.length; i += 1000) {
      const part = issues.slice(i, i + 1000);
      await t.q(`insert into tm_upload_issues (upload_id, row_no, name, mobile, reason) select $1, r, nm, m, rs from unnest($2::int[], $3::text[], $4::text[], $5::text[]) as u(r, nm, m, rs)`,
        [up.id, part.map((x) => x.row), part.map((x) => x.name), part.map((x) => x.mobile), part.map((x) => x.reason)]);
    }
    return { uploadId: up.id, received: rows.length, accepted: add.length, ownerUntil: until,
      issues: REASONS.map((k) => ({ reason: k, count: counts[k] })),
      rows: issues.slice(0, 3000).map((x) => ({ row: x.row, name: x.name, mobile: mask(x.mobile), reason: x.reason })) };
  });
}

// Earlier numbers (Dream Signature telecalling): rows [{ mobile, name, config, locality, remark }].
async function importHistory({ projectId, rows }) {
  if (!Array.isArray(rows) || !rows.length) throw err(400, 'The file has no rows.');
  if (rows.length > MAX_ROWS) throw err(400, `Import at most ${MAX_ROWS.toLocaleString('en-IN')} rows at a time.`);
  return db.tx(async (t) => {
    const p = await t.one('select id, history from tm_projects where id = $1', [projectId]);
    if (!p) throw err(400, 'Choose the project these numbers come from.');
    const have = new Set((await t.q('select mobile from tm_leads where tm_project_id = $1 and source = $2', [projectId, 'history'])).map((r) => r.mobile));
    const add = []; let invalid = 0, dup = 0;
    for (const x of rows) {
      const m = mobile(x && x.mobile);
      if (!m) { invalid++; continue; }
      if (have.has(m)) { dup++; continue; }
      have.add(m);
      add.push([m, clean(x.name, 80), clean(x.config, 30), clean(x.locality, 60), clean(x.remark, 300)]);
    }
    for (let i = 0; i < add.length; i += 1000) {
      const part = add.slice(i, i + 1000);
      await t.q(`insert into tm_leads (mobile, name, config, locality, remarks, tm_project_id, source, status)
        select m, nm, cf, lc, rm, $6, 'history', 'history' from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) as u(m, nm, cf, lc, rm)`,
      [part.map((r) => r[0]), part.map((r) => r[1]), part.map((r) => r[2]), part.map((r) => r[3]), part.map((r) => r[4]), projectId]);
    }
    return { added: add.length, invalid, alreadyThere: dup };
  });
}

// Call sheets for the chosen callers. Returns the sheet ids made.
async function makeSheets({ projectId, callerIds, perCaller, date, userId }) {
  const per = Math.min(Math.max(parseInt(perCaller, 10) || 0, 1), 300);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : istToday();
  const ids = [...new Set((callerIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw err(400, 'Choose at least one caller.');
  const S = await settings();
  return db.tx(async (t) => {
    await t.q('select pg_advisory_xact_lock(7102, $1)', [projectId]);
    const callers = await t.q('select id from tm_callers where id = any($1::int[]) and active', [ids]);
    if (callers.length !== ids.length) throw err(400, 'One of the callers is not active.');
    const due = await t.q(`select l.id from tm_leads l left join tm_sheets s on s.id = l.sheet_id
      where l.tm_project_id = $1 and (s.id is null or s.status <> 'out')
        and not exists (select 1 from tm_dnc d where d.mobile = l.mobile)
        and (   (l.status = 'callback' and (l.next_call_on is null or l.next_call_on <= $2::date))
             or (l.status = 'not_reachable' and l.attempts < $3 and (l.last_called_on is null or l.last_called_on <= $2::date - $4::int))
             or l.status in ('fresh', 'history'))
      order by case when l.status = 'callback' then 0 when l.status = 'not_reachable' then 1 else 2 end, l.id
      limit $5`, [projectId, day, +S.maxAttempts || 3, +S.gapDays || 2, per * ids.length]);
    if (!due.length) throw err(400, 'No numbers are due for calling in this project.');
    const made = [];
    for (let i = 0; i < ids.length; i++) {
      const part = due.slice(i * per, (i + 1) * per).map((r) => r.id);
      if (!part.length) break;
      const sh = await t.one('insert into tm_sheets (sheet_date, caller_id, tm_project_id, leads, created_by) values ($1, $2, $3, $4, $5) returning id', [day, ids[i], projectId, part.length, userId]);
      await t.q('update tm_leads set sheet_id = $1, caller_id = $2 where id = any($3::bigint[])', [sh.id, ids[i], part]);
      made.push(sh.id);
    }
    const left = await t.one(`select count(*)::int as c from tm_leads l left join tm_sheets s on s.id = l.sheet_id
      where l.tm_project_id = $1 and (s.id is null or s.status <> 'out') and l.status in ('fresh', 'history', 'callback', 'not_reachable')`, [projectId]);
    return { sheets: made, assigned: Math.min(due.length, per * made.length), waiting: left.c };
  });
}

// entries: [{ leadId, code (1-8 or blank = not called), remark, nextCall }]
async function saveOutcomes({ sheetId, entries, userId }) {
  const S = await settings();
  return db.tx(async (t) => {
    const sh = await t.one('select * from tm_sheets where id = $1 for update', [sheetId]);
    if (!sh) throw err(404, 'Call sheet not found.');
    if (sh.status !== 'out') throw err(409, 'This call sheet has already been entered or was cancelled.');
    const date = iso(sh.sheet_date);
    const leads = new Map((await t.q('select id, mobile, cp_id, owner_until, attempts, remarks from tm_leads where sheet_id = $1', [sheetId])).map((r) => [String(r.id), r]));
    let saved = 0, notCalled = 0;
    for (const e of entries || []) {
      const l = leads.get(String(e.leadId));
      if (!l) continue;
      const code = parseInt(e.code, 10);
      if (!OUTCOMES[code]) { notCalled++; continue; }
      const remark = clean(e.remark, 300);
      const next = code === 3 ? (/^\d{4}-\d{2}-\d{2}$/.test(String(e.nextCall || '')) ? e.nextCall : addDays(date, 2)) : code === 5 ? addDays(date, +S.gapDays || 2) : null;
      let owner = iso(l.owner_until);
      if (code === 2 && l.cp_id) { const ext = addDays(date, +S.ownershipDays || 90); if (!owner || owner < ext) owner = ext; }
      await t.q(`update tm_leads set status = $2, attempts = attempts + 1, last_outcome = $3, last_called_on = $4, next_call_on = $5, owner_until = $6,
          remarks = case when $7::text = '' then remarks else concat_ws(' | ', remarks, $8::text || ': ' || $7::text) end where id = $1`,
        [l.id, OUTCOME_STATUS[code], code, date, next, owner, remark, date]);
      await t.q('insert into tm_outcomes (lead_id, sheet_id, caller_id, tm_project_id, cp_id, call_date, code, remark, entered_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [l.id, sheetId, sh.caller_id, sh.tm_project_id, l.cp_id, date, code, remark || null, userId]);
      if (code === 8) await t.q("insert into tm_dnc (mobile, reason) values ($1, 'Asked on a call') on conflict do nothing", [l.mobile]);
      saved++;
    }
    await t.q("update tm_sheets set status = 'entered', entered_by = $2, entered_at = now() where id = $1", [sheetId, userId]);
    return { saved, notCalled };
  });
}

// Who owns a customer, every record of the number, and any ERP booking of that mobile.
async function lookup(m) {
  const p = mobile(m);
  if (!p) throw err(400, 'Enter a valid 10-digit mobile number.');
  const today = istToday();
  const leads = await db.q(`select l.id, l.name, l.source, l.status, l.uploaded_on, l.owner_until, l.last_outcome, l.remarks, l.cp_id,
      c.cp_code, c.name as firm, tp.name as project
    from tm_leads l join tm_projects tp on tp.id = l.tm_project_id left join channel_partners c on c.id = l.cp_id
    where l.mobile = $1 order by l.uploaded_on, l.id`, [p]);
  for (const l of leads) { l.uploaded_on = iso(l.uploaded_on); l.owner_until = iso(l.owner_until); l.active = !!l.cp_id && l.owner_until >= today; l.statusLabel = STATUS[l.status] || l.status; l.lastOutcome = OUTCOMES[l.last_outcome] || ''; }
  const owner = leads.find((l) => l.active) || null;
  const buyers = await db.q(`select b.id as booking_id, u.unit_no, pr.name as project, b.booking_date, b.status, b.cp_name, c.cp_code, c.name as firm, y.name as buyer, y.phone
      from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id join units u on u.id = b.unit_id
      join projects pr on pr.id = u.project_id left join channel_partners c on c.id = b.cp_id
     where regexp_replace(coalesce(y.phone, ''), '\\D', '', 'g') like '%' || $1 || '%' order by b.booking_date desc`, [p]);
  const bookings = buyers.filter((b) => mobilesIn(b.phone).includes(p)).map((b) => ({ bookingId: b.booking_id, unit: b.unit_no, project: b.project, date: iso(b.booking_date), status: b.status, buyer: b.buyer, cpCode: b.cp_code, firm: b.firm || b.cp_name }));
  const dnc = !!(await db.one('select 1 from tm_dnc where mobile = $1', [p]));
  return { mobile: p, owner: owner && { cpId: owner.cp_id, cpCode: owner.cp_code, firm: owner.firm, since: owner.uploaded_on, until: owner.owner_until, project: owner.project }, leads, bookings, dnc };
}

// Figures for the staff overview: one launch, or all (projectId null).
async function analytics(projectId) {
  const P = projectId ? [projectId] : [];
  const w = (a) => (projectId ? `${a} = $1` : 'true');
  const partners = await db.one(`select count(*) filter (where portal_status is not null)::int as registered,
      count(*) filter (where portal_status = 'approved')::int as approved, count(*) filter (where portal_status = 'pending')::int as pending from channel_partners`);
  const ups = await db.q(`select u.cp_id, c.cp_code, c.name as firm, count(*)::int as uploads, sum(u.received)::int as received, sum(u.accepted)::int as accepted,
      sum((u.counts->>'Registered with another partner')::int)::int as other_partner, jsonb_agg(u.counts) as counts
    from tm_uploads u join channel_partners c on c.id = u.cp_id where ${w('u.tm_project_id')} group by u.cp_id, c.cp_code, c.name`, P);
  const issues = Object.fromEntries(REASONS.map((k) => [k, 0]));
  for (const u of ups) for (const c of u.counts || []) for (const k of REASONS) issues[k] += n(c && c[k]);
  const status = Object.fromEntries((await db.q(`select status, count(*)::int as c from tm_leads where ${w('tm_project_id')} group by status`, P)).map((r) => [r.status, r.c]));
  const out = await db.q(`select o.call_date, o.code, o.caller_id, o.cp_id, o.lead_id, c.name as caller, c.daily_rate
    from tm_outcomes o left join tm_callers c on c.id = o.caller_id where ${w('o.tm_project_id')}`, P);
  const byCaller = {}, byDay = {}, byCp = {}, outcomes = Object.fromEntries(Object.values(OUTCOMES).map((k) => [k, 0]));
  let calls = 0, connected = 0, interested = 0, visits = 0;
  const cpRow = (id) => (byCp[id] ||= { cpId: id, calls: 0, called: new Set(), connected: 0, interested: 0, visits: 0 });
  for (const o of out) {
    const d = iso(o.call_date), con = CONNECTED.includes(o.code);
    calls++; if (con) connected++; if (o.code === 1) interested++; if (o.code === 2) visits++;
    outcomes[OUTCOMES[o.code]]++;
    const c = (byCaller[o.caller_id] ||= { callerId: o.caller_id, name: o.caller || 'Caller ' + o.caller_id, rate: n(o.daily_rate), days: new Set(), calls: 0, connected: 0, interested: 0, visits: 0 });
    c.days.add(d); c.calls++; if (con) c.connected++; if (o.code === 1) c.interested++; if (o.code === 2) c.visits++;
    const day = (byDay[d] ||= { date: d, calls: 0, connected: 0, interested: 0, visits: 0, callers: new Set() });
    day.calls++; if (con) day.connected++; if (o.code === 1) day.interested++; if (o.code === 2) day.visits++; day.callers.add(o.caller_id);
    if (o.cp_id) { const p = cpRow(o.cp_id); p.calls++; p.called.add(o.lead_id); if (con) p.connected++; if (o.code === 1) p.interested++; if (o.code === 2) p.visits++; }
  }
  // Bookings in the ERP credited to a partner firm, and partner leads that went on to book
  const bk = await db.q(`select b.cp_id, count(*)::int as c, sum(b.agreement_value) as value from bookings b
      where b.status = 'active' and b.cp_id is not null and exists (select 1 from channel_partners c where c.id = b.cp_id and c.cp_code is not null) group by b.cp_id`);
  // buyers' mobiles with their earliest live booking date, then the partner leads uploaded on or before it
  const firstBooked = new Map();
  for (const r of await db.q(`select y.phone, min(b.booking_date) as d from buyers y join booking_applicants a on a.buyer_id = y.id join bookings b on b.id = a.booking_id
      where b.status = 'active' and coalesce(y.phone, '') <> '' group by y.phone`)) for (const m of mobilesIn(r.phone)) { const d = iso(r.d); if (!firstBooked.has(m) || d < firstBooked.get(m)) firstBooked.set(m, d); }
  const bl = firstBooked.size ? await db.q(`select id, mobile, cp_id, uploaded_on from tm_leads where source = 'partner' and mobile = any($${P.length + 1}::text[]) and ${w('tm_project_id')}`, [...P, [...firstBooked.keys()]]) : [];
  const blMap = new Map();
  for (const l of bl) if (iso(l.uploaded_on) <= firstBooked.get(l.mobile)) blMap.set(l.cp_id, (blMap.get(l.cp_id) || 0) + 1);
  const bkMap = new Map(bk.map((r) => [r.cp_id, r]));
  let spend = 0;
  const callers = Object.values(byCaller).map((c) => { const days = c.days.size, cost = days * c.rate; spend += cost;
    return { callerId: c.callerId, name: c.name, days, calls: c.calls, perDay: days ? Math.round(c.calls / days) : 0, connectRate: c.calls ? c.connected / c.calls : 0,
      interested: c.interested, visits: c.visits, cost, costPerVisit: c.visits ? Math.round(cost / c.visits) : null }; })
    .sort((a, b) => b.visits - a.visits || b.interested - a.interested);
  const firms = new Map(ups.map((u) => [u.cp_id, u]));
  const ids = new Set([...firms.keys(), ...Object.keys(byCp).map(Number), ...bkMap.keys()]);
  const names = ids.size ? new Map((await db.q('select id, cp_code, name from channel_partners where id = any($1::int[])', [[...ids]])).map((r) => [r.id, r])) : new Map();
  const partnerRows = [...ids].map((id) => { const u = firms.get(id) || {}, c = byCp[id] || { called: new Set() }, f = names.get(id) || {};
    return { cpId: id, cpCode: f.cp_code || '', firm: f.name || '', uploads: u.uploads || 0, received: u.received || 0, accepted: u.accepted || 0, otherPartner: u.other_partner || 0,
      called: c.called.size, calls: c.calls || 0, interested: c.interested || 0, visits: c.visits || 0, leadsBooked: blMap.get(id) || 0, bookings: (bkMap.get(id) || {}).c || 0 }; })
    .sort((a, b) => b.bookings - a.bookings || b.visits - a.visits || b.accepted - a.accepted);
  const days = Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60).map((d) => ({ ...d, callers: d.callers.size }));
  return {
    partners, received: ups.reduce((a, u) => a + n(u.received), 0), accepted: ups.reduce((a, u) => a + n(u.accepted), 0), issues,
    leads: Object.values(status).reduce((a, b) => a + b, 0), status: Object.fromEntries(Object.entries(status).map(([k, v]) => [STATUS[k] || k, v])),
    calls, connected, interested, visits, outcomes, spend, callers, partnerRows, days,
    bookings: bk.reduce((a, r) => a + r.c, 0), bookingValue: bk.reduce((a, r) => a + n(r.value), 0),
  };
}

module.exports = { OUTCOMES, OUTCOME_STATUS, STATUS, REASONS, MAX_ROWS, mobile, mobilesIn, mask, settings, openProjects, upload, importHistory, makeSheets, saveOutcomes, lookup, analytics, istToday, addDays, iso, clean, customerMobiles };
