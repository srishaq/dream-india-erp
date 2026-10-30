// Reports for Partner & Telemarketing: the same full report for every project.
// Where the rows come from:
//   - a finished campaign run outside the ERP (Dream Signature 2025-26): its own telecalling sheet, loaded once into
//     tm_sheet_rows (one row per logged lead: date, caller, partner firm, sourcing manager, client, number, BHK, Hot/Warm…)
//   - every project called through the ERP: the call results entered from the printed sheets (tm_outcomes), one row per call
// From those rows: the headline figures, month and weekday activity, number quality, lead temperature, configuration,
// callers, partner firms, sourcing managers and the buyers in the CRM who were called before they booked. Every figure
// can be opened (drill) to the rows behind it.
const db = require('./db');
const TM = require('./tm');

const DEFAULT_RATE = 1000; // ₹ a caller-day where no rate is recorded (what was paid for Dream Signature)
const WA_RATE = 0.8631;    // ₹ per WhatsApp marketing message in India (Meta, 2026), for the "message first" estimate
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RANK = { Hot: 4, Warm: 3, Cold: 2, Lost: 1 };
const OUT_TEMP = { 2: 'Hot', 1: 'Warm', 3: 'Warm', 4: 'Lost', 7: 'Lost', 8: 'Lost', 5: 'Cold', 6: 'Cold' };
const n0 = (v) => Number(v) || 0;
const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const low = (s) => String(s || '').trim().toLowerCase();
const firm = (s) => low(s).replace(/[^a-z0-9]+/g, ' ').trim();
const junk = (s) => !String(s || '').replace(/[.\-\s,]/g, '');
const tempOf = (s) => { const t = low(s); return /hot/.test(t) ? 'Hot' : /warm/.test(t) ? 'Warm' : /cold/.test(t) ? 'Cold' : /lost|dead|not int|junk|no/.test(t) ? 'Lost' : t ? 'Warm' : 'Cold'; };
const dowOf = (d) => DOW[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7];
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ---------- loading a finished campaign's sheet ----------
function dateOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10) : null;
}
function phone(v) {
  const raw = String(v == null ? '' : v), m = TM.mobile(raw);
  if (m) return { mobile: m, last4: m.slice(-4), kind: 'full' };
  const d = raw.replace(/\D/g, '');
  if (d.length >= 3 && (/[x*]/i.test(raw) || d.length <= 6)) return { mobile: null, last4: d.slice(-4), kind: 'masked' };
  return { mobile: null, last4: null, kind: 'invalid' };
}
const clean = (v, max = 200) => { const s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
// rows: [{day, caller, caller_place, cp_firm, cp_phone, sm, client, mobile, config, status, remark, visit_on}], first = start again
async function loadRows({ projectId, rows, first, offset = 0 }) {
  if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('The file has no rows.'), { status: 400 });
  if (rows.length > 5000) throw Object.assign(new Error('At most 5,000 rows at a time.'), { status: 400 });
  return db.tx(async (t) => {
    const p = await t.one('select id from tm_projects where id = $1', [projectId]);
    if (!p) throw Object.assign(new Error('Choose the project.'), { status: 400 });
    if (first) await t.q('delete from tm_sheet_rows where tm_project_id = $1', [projectId]);
    const cols = { row_no: [], day: [], caller: [], caller_place: [], cp_firm: [], cp_phone: [], sm: [], client: [], mobile: [], last4: [], phone_kind: [], config: [], status: [], remark: [], visit_on: [] };
    rows.forEach((r, i) => {
      const ph = phone(r.mobile);
      const v = { row_no: offset + i + 1, day: dateOf(r.day), caller: clean(r.caller, 80), caller_place: clean(r.caller_place, 80), cp_firm: clean(r.cp_firm, 120), cp_phone: clean(r.cp_phone, 40), sm: clean(r.sm, 80),
        client: clean(r.client, 120), mobile: ph.mobile, last4: ph.last4, phone_kind: ph.kind, config: clean(r.config, 30), status: r.status ? tempOf(r.status) : null, remark: clean(r.remark, 400), visit_on: dateOf(r.visit_on) };
      for (const k in cols) cols[k].push(v[k]);
    });
    await t.q(`insert into tm_sheet_rows (tm_project_id, row_no, day, caller, caller_place, cp_firm, cp_phone, sm, client, mobile, last4, phone_kind, config, status, remark, visit_on)
      select $1, * from unnest($2::int[], $3::date[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::date[])`,
    [projectId, ...Object.values(cols)]);
    const c = await t.one('select count(*)::int as n from tm_sheet_rows where tm_project_id = $1', [projectId]);
    return { loaded: rows.length, total: c.n };
  });
}

// ---------- the rows of a project ----------
async function rowsOf(pid) {
  const sheet = await db.q(`select row_no, to_char(day, 'YYYY-MM-DD') as day, caller, caller_place, cp_firm, sm, client, mobile, last4, phone_kind, config, status, remark,
      to_char(visit_on, 'YYYY-MM-DD') as visit_on from tm_sheet_rows where tm_project_id = $1 order by row_no`, [pid]);
  if (sheet.length) return { source: 'sheet', rows: sheet.map((r) => ({ ...r, rate: DEFAULT_RATE })) };
  const calls = await db.q(`select o.id as row_no, to_char(o.call_date, 'YYYY-MM-DD') as day, c.name as caller, c.daily_rate, p.name as cp_firm, l.name as client, l.mobile, l.config,
       o.code, o.remark, l.locality as caller_place
     from tm_outcomes o join tm_leads l on l.id = o.lead_id left join tm_callers c on c.id = o.caller_id left join channel_partners p on p.id = coalesce(o.cp_id, l.cp_id)
     where o.tm_project_id = $1 order by o.call_date, o.id`, [pid]);
  return { source: 'calls', rows: calls.map((r) => ({ ...r, sm: null, last4: String(r.mobile || '').slice(-4), phone_kind: TM.mobile(r.mobile) ? 'full' : 'invalid', status: OUT_TEMP[r.code] || 'Cold', outcome: TM.OUTCOMES[r.code], rate: n0(r.daily_rate) || DEFAULT_RATE })) };
}
const keyOf = (r) => r.mobile || (r.last4 ? `m${r.last4}|${low(r.client)}` : `r${r.row_no}`);

// people: one per number (or masked number + name), best tag kept
function peopleOf(rows) {
  const P = new Map();
  for (const r of rows) {
    const k = keyOf(r); let p = P.get(k);
    if (!p) P.set(k, (p = { key: k, client: r.client, mobile: r.mobile, last4: r.last4, kind: r.phone_kind, status: r.status, times: 0, first: r.day, last: r.day, cps: new Set(), callers: new Set(), config: r.config, rows: [] }));
    p.times++; p.rows.push(r);
    if ((RANK[r.status] || 0) > (RANK[p.status] || 0)) p.status = r.status;
    if (r.day && (!p.first || r.day < p.first)) p.first = r.day;
    if (r.day && (!p.last || r.day > p.last)) p.last = r.day;
    if (r.cp_firm) p.cps.add(r.cp_firm); if (r.caller) p.callers.add(r.caller);
    if (!p.client && r.client) p.client = r.client; if (!p.config && r.config) p.config = r.config;
  }
  return [...P.values()];
}

// The CRM buyers of the linked project (or all, if the telecalling project has none), matched to the people called:
// by full number, else by the last 4 digits and the first name.
async function buyersOf(pid, people) {
  const tp = await db.one('select project_id from tm_projects where id = $1', [pid]);
  const bk = await db.q(`select b.id, b.booking_date, b.agreement_value, coalesce(cp.name, b.cp_name) as cp, u.unit_no, pr.name as project,
       (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as names,
       (select string_agg(coalesce(y.phone, ''), ' ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as phones
     from bookings b join units u on u.id = b.unit_id join projects pr on pr.id = u.project_id left join channel_partners cp on cp.id = b.cp_id
     where b.status in ('active', 'pending') ${tp && tp.project_id ? 'and u.project_id = ' + Number(tp.project_id) : ''}`);
  const byMob = new Map(), byLast = new Map();
  for (const p of people) {
    if (p.mobile) byMob.set(p.mobile, p);
    else if (p.last4 && p.client) { const k = p.last4 + '|' + low(p.client).split(/\s+/)[0]; if (!byLast.has(k)) byLast.set(k, p); }
  }
  return bk.map((b) => {
    const mobs = TM.mobilesIn(b.phones), first = low(b.names).split(/[\s&]+/)[0];
    let p = null, how = null;
    for (const m of mobs) if (byMob.has(m)) { p = byMob.get(m); how = 'Number'; break; }
    if (!p) for (const m of mobs) { const q = byLast.get(m.slice(-4) + '|' + first); if (q) { p = q; how = 'Last 4 digits and name'; break; } }
    const day = iso(b.booking_date);
    const same = p && b.cp ? [...p.cps].some((c) => firm(c) && (firm(c) === firm(b.cp) || firm(c).includes(firm(b.cp)) || firm(b.cp).includes(firm(c)))) : null;
    return { booking: b.id, flat: b.unit_no, project: b.project, buyer: b.names, booked_on: day, value: n0(b.agreement_value), booking_cp: b.cp || '', person: p, how,
      first_logged: p ? p.first : null, before: p ? !!(p.first && day && p.first <= day) : null, days: p && p.first && day ? Math.round((Date.parse(day) - Date.parse(p.first)) / 864e5) : null,
      sheet_cps: p ? [...p.cps].join(', ') : '', callers: p ? [...p.callers].join(', ') : '', tag: p ? p.status : null, config: p ? p.config : null, same_cp: same };
  });
}

// ---------- the report ----------
async function summary(pid) {
  const { source, rows } = await rowsOf(pid);
  if (!rows.length) return { source, empty: true };
  const people = peopleOf(rows), dated = rows.filter((r) => r.day);
  const days = [...new Set(dated.map((r) => r.day))].sort();
  const cd = new Map(); for (const r of dated) { if (!r.caller) continue; const k = r.caller + '|' + r.day; if (!cd.has(k)) cd.set(k, r.rate); }
  const callerDays = cd.size, cost = [...cd.values()].reduce((a, v) => a + v, 0);
  const perDay = new Map(); for (const k of cd.keys()) { const d = k.split('|')[1]; perDay.set(d, (perDay.get(d) || 0) + 1); }
  // callers
  const C = new Map();
  for (const r of rows) { if (!r.caller) continue; let c = C.get(r.caller); if (!c) C.set(r.caller, (c = { caller: r.caller, leads: 0, days: new Set(), hot: 0, junk: 0, full: 0, cps: new Set(), first: null, last: null, rate: r.rate })); c.leads++; if (r.day) { c.days.add(r.day); if (!c.first || r.day < c.first) c.first = r.day; if (!c.last || r.day > c.last) c.last = r.day; } if (r.status === 'Hot') c.hot++; if (junk(r.remark)) c.junk++; if (r.phone_kind === 'full') c.full++; if (r.cp_firm) c.cps.add(r.cp_firm); }
  const callers = [...C.values()].map((c) => ({ caller: c.caller, leads: c.leads, days: c.days.size, per_day: c.days.size ? +(c.leads / c.days.size).toFixed(2) : 0, hot_share: c.hot / c.leads, junk_share: c.junk / c.leads, full_share: c.full / c.leads, cps: c.cps.size, first: c.first, last: c.last, cost: c.days.size * c.rate })).sort((a, b) => b.leads - a.leads);
  const top = callers.slice(0, Math.max(1, Math.floor(callers.length * 0.2))), reg = callers.filter((c) => c.leads >= 50);
  // partner firms and sourcing managers
  const F = new Map(); for (const r of rows) { if (!r.cp_firm) continue; let f = F.get(r.cp_firm); if (!f) F.set(r.cp_firm, (f = { cp: r.cp_firm, leads: 0, hot: 0, masked: 0, callers: new Set() })); f.leads++; if (r.status === 'Hot') f.hot++; if (r.phone_kind !== 'full') f.masked++; if (r.caller) f.callers.add(r.caller); }
  const cps = [...F.values()].map((f) => ({ cp: f.cp, leads: f.leads, hot: f.hot, hot_share: f.hot / f.leads, masked_share: f.masked / f.leads, callers: f.callers.size })).sort((a, b) => b.leads - a.leads);
  const M = new Map(); for (const r of rows) { if (!r.sm) continue; let s = M.get(r.sm); if (!s) M.set(r.sm, (s = { sm: r.sm, leads: 0, hot: 0, cps: new Set() })); s.leads++; if (r.status === 'Hot') s.hot++; if (r.cp_firm) s.cps.add(r.cp_firm); }
  const sms = [...M.values()].map((s) => ({ sm: s.sm, leads: s.leads, cps: s.cps.size, hot: s.hot, hot_share: s.hot / s.leads })).sort((a, b) => b.leads - a.leads);
  // months and weekdays
  const mo = new Map(); for (const r of dated) { const m = r.day.slice(0, 7); let x = mo.get(m); if (!x) mo.set(m, (x = { month: m, leads: 0, callers: new Set(), hot: 0 })); x.leads++; if (r.caller) x.callers.add(r.caller); if (r.status === 'Hot') x.hot++; }
  const monthly = [...mo.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => ({ month: x.month, leads: x.leads, callers: x.callers.size, hot: x.hot }));
  const dow = DOW.map((d) => ({ day: d, leads: 0, hot: 0 })); for (const r of dated) { const x = dow[DOW.indexOf(dowOf(r.day))]; x.leads++; if (r.status === 'Hot') x.hot++; }
  // number quality, temperature, configuration
  const kinds = { full: 0, masked: 0, invalid: 0 }; for (const r of rows) kinds[r.phone_kind]++;
  const phone_quality = [{ type: 'Full 10-digit mobile', kind: 'full', rows: kinds.full }, { type: source === 'sheet' ? 'Masked by partner (last digits only)' : 'Masked', kind: 'masked', rows: kinds.masked }, { type: 'Blank or invalid', kind: 'invalid', rows: kinds.invalid }].filter((x) => x.rows || x.kind !== 'masked');
  const status = ['Hot', 'Warm', 'Cold', 'Lost'].map((s) => ({ status: s, rows: rows.filter((r) => r.status === s).length, people: people.filter((p) => p.status === s).length, contactable: people.filter((p) => p.status === s && p.mobile).length })).filter((x) => x.rows);
  const cf = new Map(); for (const r of rows) { const k = r.config || 'Not stated'; let x = cf.get(k); if (!x) cf.set(k, (x = { config: k, hot: 0, warm: 0, cold: 0, lost: 0, leads: 0 })); x.leads++; const t = low(r.status); if (x[t] != null) x[t]++; }
  const config = [...cf.values()].sort((a, b) => b.leads - a.leads).slice(0, 8);
  const tenure = [['up to 3 days', 0, 3], ['4–15 days', 4, 15], ['16–45 days', 16, 45], ['46+ days', 46, 1e9]].map(([bucket, a, b]) => ({ bucket, callers: callers.filter((c) => c.days >= a && c.days <= b).length }));
  const caller_hot_bands = [['0–5% tagged Hot', -1, 0.05], ['5–20%', 0.05, 0.2], ['20–50%', 0.2, 0.5], ['Over 50%', 0.5, 2]].map(([bucket, a, b]) => ({ bucket, callers: reg.filter((c) => c.hot_share > a && c.hot_share <= b).length }));
  // buyers
  const buyers = await buyersOf(pid, people);
  const matched = buyers.filter((b) => b.person), before = matched.filter((b) => b.before);
  const fullPeople = people.filter((p) => p.mobile).length;
  const bk_status = ['Hot', 'Warm', 'Cold', 'Lost'].map((s) => { const n = people.filter((p) => p.status === s).length, b = before.filter((x) => x.tag === s).length; return { status: s, people: n, buyers: b, rate: n ? b / n : 0 }; }).filter((x) => x.people);
  const bcf = new Map(); for (const p of people) { const k = p.config || 'Not stated'; bcf.set(k, { config: k, people: (bcf.get(k) || { people: 0 }).people + 1, buyers: 0 }); } for (const b of before) { const x = bcf.get(b.config || 'Not stated'); if (x) x.buyers++; }
  const bk_config = [...bcf.values()].sort((a, b) => b.people - a.people).slice(0, 5).map((x) => ({ ...x, rate: x.people ? x.buyers / x.people : 0 }));
  const bc = new Map(); for (const b of before) for (const c of String(b.callers).split(', ').filter(Boolean)) bc.set(c, (bc.get(c) || 0) + 1);
  const bk_callers = [...bc.entries()].map(([caller, n]) => ({ caller, buyers: n, leads: (C.get(caller) || { leads: 0 }).leads })).sort((a, b) => b.buyers - a.buyers);
  const valAll = buyers.reduce((a, b) => a + b.value, 0), valBefore = before.reduce((a, b) => a + b.value, 0);
  const multi = people.filter((p) => p.mobile && p.cps.size > 1).length;
  return {
    source, empty: false,
    kpis: [{ rows: rows.length, callers: C.size, cps: F.size, sms: M.size, days_active: days.length, caller_days: callerDays, cost, leads_per_caller_day: callerDays ? +(rows.length / callerDays).toFixed(2) : 0,
      unique_people: people.length, unique_full: fullPeople, masked_rows: kinds.masked, invalid_rows: kinds.invalid, full_rows: kinds.full, phones_multi_cp: multi,
      hot_people: people.filter((p) => p.status === 'Hot').length, peak_callers: Math.max(0, ...perDay.values()), avg_callers: perDay.size ? +(callerDays / perDay.size).toFixed(1) : 0,
      junk_remarks: rows.filter((r) => junk(r.remark)).length, first_date: days[0] || null, last_date: days[days.length - 1] || null,
      caller_hot_low: caller_hot_bands[0].callers, caller_hot_high: caller_hot_bands[3].callers, callers_50plus: reg.length,
      top20_share: rows.length ? top.reduce((a, c) => a + c.leads, 0) / rows.length : 0, wa_rate: WA_RATE }],
    monthly, dow, phone_quality, status, config, callers, cps, sms, tenure, caller_hot_bands,
    bk_kpis: [{ buyers: buyers.length, matched: matched.length, confirmed: matched.filter((b) => b.how === 'Number').length, probable: matched.filter((b) => b.how !== 'Number').length,
      before: before.length, after: matched.length - before.length, not_found: buyers.length - matched.length, conv: people.length ? before.length / people.length : 0,
      days_median: median(before.map((b) => b.days).filter((d) => d != null)), cp_same: before.filter((b) => b.same_cp === true).length, cp_diff: before.filter((b) => b.same_cp === false).length,
      val_before: valBefore, val_all: valAll, val_share: valAll ? valBefore / valAll : 0, callers_with_buyer: bc.size }],
    bk_status, bk_config, bk_callers,
  };
}

// ---------- the rows behind a figure ----------
const mask = (m, full) => (full ? m : TM.mask(m));
async function drill(pid, key, val, { q = '', page = 0, fullNumbers = false } = {}) {
  const { source, rows } = await rowsOf(pid);
  const P = () => peopleOf(rows);
  const num = (r) => (r.mobile ? mask(r.mobile, fullNumbers) : r.last4 ? 'XXXXXX' + r.last4 : '');
  const RC = [['day', 'Date', 'date'], ['caller', 'Caller'], ['cp_firm', 'Partner firm'], ['client', 'Client'], ['number', 'Number'], ['config', 'BHK'], ['status', 'Tag'], ['remark', 'Remarks']];
  if (source === 'sheet') RC.splice(3, 0, ['sm', 'Sourcing manager']); else RC.splice(7, 0, ['outcome', 'Result']);
  const rowList = (f) => rows.filter(f).map((r) => ({ ...r, number: num(r) }));
  const PC = [['client', 'Client'], ['number', 'Number'], ['status', 'Best tag'], ['times', 'Times logged', 'n'], ['config', 'BHK'], ['cps', 'Partner firm(s)'], ['callers', 'Caller(s)'], ['first', 'First logged', 'date'], ['last', 'Last logged', 'date']];
  const pList = (f) => P().filter(f).map((p) => ({ ...p, number: p.mobile ? mask(p.mobile, fullNumbers) : p.last4 ? 'XXXXXX' + p.last4 : '', cps: [...p.cps].join(', '), callers: [...p.callers].join(', ') }));
  let title, cols, list;
  const S = key === 'callers' || key === 'callerdays' || key === 'cost' || key === 'perday' || key === 'tenure' || key === 'hotband' || key === 'callers50' ? (await summary(pid)) : null;
  const CC = [['caller', 'Caller'], ['leads', 'Leads', 'n'], ['days', 'Days worked', 'n'], ['per_day', 'Leads a day', 'n'], ['hot_share', 'Hot %', 'pct'], ['full_share', 'Full number %', 'pct'], ['cps', 'Partner firms', 'n'], ['first', 'First day', 'date'], ['last', 'Last day', 'date'], ['cost', 'Cost', 'inr']];
  const BC = [['buyer', 'Buyer'], ['flat', 'Flat'], ['booked_on', 'Booked on', 'date'], ['value', 'Agreement value', 'inr'], ['first_logged', 'First called', 'date'], ['days', 'Days before booking', 'n'], ['tag', 'Tag'], ['booking_cp', 'Booked through'], ['sheet_cps', 'Partner firm(s) in the sheet'], ['callers', 'Caller(s)'], ['how', 'Matched by']];
  const B = async (f) => (await buyersOf(pid, P())).filter(f);
  switch (key) {
    case 'leads': title = 'Every lead logged'; cols = RC; list = rowList(() => true); break;
    case 'people': title = 'Distinct people (repeats merged)'; cols = PC; list = pList(() => true); break;
    case 'messageable': title = 'People with a full mobile number'; cols = PC; list = pList((p) => p.mobile); break;
    case 'repeat': title = 'Numbers logged under two or more partner firms'; cols = PC; list = pList((p) => p.mobile && p.cps.size > 1); break;
    case 'phone': title = { full: 'Rows with a full mobile number', masked: 'Rows with the number masked', invalid: 'Rows with a blank or invalid number' }[val] || 'Rows'; cols = RC; list = rowList((r) => r.phone_kind === val); break;
    case 'masked': title = 'Rows with the number masked'; cols = RC; list = rowList((r) => r.phone_kind === 'masked'); break;
    case 'junk': title = 'Rows with a blank remark'; cols = RC; list = rowList((r) => junk(r.remark)); break;
    case 'month': title = `Leads logged in ${val}`; cols = RC; list = rowList((r) => r.day && r.day.startsWith(val)); break;
    case 'dow': title = `Leads logged on ${val}s`; cols = RC; list = rowList((r) => r.day && dowOf(r.day) === val); break;
    case 'status': title = `Leads tagged ${val}`; cols = RC; list = rowList((r) => r.status === val); break;
    case 'people_status': title = `People whose best tag is ${val}`; cols = PC; list = pList((p) => p.status === val); break;
    case 'config': title = `Leads asking for ${val}`; cols = RC; list = rowList((r) => (r.config || 'Not stated') === val); break;
    case 'caller': title = `Leads logged by ${val}`; cols = RC; list = rowList((r) => r.caller === val); break;
    case 'cp': title = `Leads from ${val}`; cols = RC; list = rowList((r) => r.cp_firm === val); break;
    case 'sm': title = `Leads through ${val}`; cols = RC; list = rowList((r) => r.sm === val); break;
    case 'callers': case 'perday': case 'cost': case 'callers50':
      title = { callers: 'Every caller', perday: 'Leads a day, by caller', cost: 'Telecaller cost, by caller', callers50: 'Callers with 50 or more leads' }[key]; cols = CC;
      list = S.callers.filter((c) => key !== 'callers50' || c.leads >= 50).sort((a, b) => (key === 'cost' ? b.cost - a.cost : key === 'perday' ? b.per_day - a.per_day : b.leads - a.leads)); break;
    case 'tenure': { const r = { 'up to 3 days': [0, 3], '4–15 days': [4, 15], '16–45 days': [16, 45], '46+ days': [46, 1e9] }[val] || [0, 1e9]; title = `Callers who worked ${val}`; cols = CC; list = S.callers.filter((c) => c.days >= r[0] && c.days <= r[1]); break; }
    case 'hotband': { const r = { '0–5% tagged Hot': [-1, 0.05], '5–20%': [0.05, 0.2], '20–50%': [0.2, 0.5], 'Over 50%': [0.5, 2] }[val] || [-1, 2]; title = `Callers (50+ leads) who tagged ${val.replace(' tagged Hot', '')} of their leads Hot`; cols = CC; list = S.callers.filter((c) => c.leads >= 50 && c.hot_share > r[0] && c.hot_share <= r[1]); break; }
    case 'callerdays': { title = 'Caller-days worked'; cols = [['caller', 'Caller'], ['day', 'Date', 'date'], ['leads', 'Leads that day', 'n'], ['cost', 'Cost', 'inr']]; const m = new Map(); for (const r of rows) { if (!r.caller || !r.day) continue; const k = r.caller + '|' + r.day; const x = m.get(k) || { caller: r.caller, day: r.day, leads: 0, cost: r.rate }; x.leads++; m.set(k, x); } list = [...m.values()].sort((a, b) => b.day.localeCompare(a.day) || a.caller.localeCompare(b.caller)); break; }
    case 'cps': title = 'Every partner firm'; cols = [['cp', 'Partner firm'], ['leads', 'Leads', 'n'], ['hot', 'Hot', 'n'], ['hot_share', 'Hot %', 'pct'], ['masked_share', 'Masked numbers', 'pct'], ['callers', 'Callers', 'n']]; list = (await summary(pid)).cps; break;
    case 'sms': title = 'Every sourcing manager'; cols = [['sm', 'Sourcing manager'], ['leads', 'Leads', 'n'], ['cps', 'Partner firms', 'n'], ['hot', 'Hot', 'n'], ['hot_share', 'Hot %', 'pct']]; list = (await summary(pid)).sms; break;
    case 'buyers_all': title = 'Every buyer and whether telecalling reached them'; cols = BC; list = await B(() => true); break;
    case 'buyers': title = 'Buyers called before they booked'; cols = BC; list = (await B((b) => b.before)).sort((a, b) => b.value - a.value); break;
    case 'buyers_after': title = 'Buyers logged only after they booked'; cols = BC; list = await B((b) => b.person && !b.before); break;
    case 'buyers_none': title = 'Buyers not in the telecalling'; cols = BC.filter(([k]) => ['buyer', 'flat', 'booked_on', 'value', 'booking_cp'].includes(k)); list = await B((b) => !b.person); break;
    case 'buyers_name': title = 'Buyers matched by the last 4 digits and name'; cols = BC; list = await B((b) => b.person && b.how !== 'Number'); break;
    case 'buyers_diffcp': title = 'Buyers called before booking who booked through another partner'; cols = BC; list = await B((b) => b.before && b.same_cp === false); break;
    case 'buyers_tag': title = `Buyers called before booking, tagged ${val}`; cols = BC; list = await B((b) => b.before && b.tag === val); break;
    case 'buyers_config': title = `Buyers called before booking, asking for ${val}`; cols = BC; list = await B((b) => b.before && (b.config || 'Not stated') === val); break;
    case 'buyers_caller': title = `Buyers called by ${val} before they booked`; cols = BC; list = await B((b) => b.before && String(b.callers).split(', ').includes(val)); break;
    default: throw Object.assign(new Error('Unknown figure.'), { status: 400 });
  }
  list = list.map((r) => { const o = {}; for (const [k] of cols) o[k] = r[k] instanceof Set ? [...r[k]].join(', ') : r[k] ?? ''; return o; });
  const qq = low(q); if (qq) list = list.filter((r) => Object.values(r).some((v) => low(v).includes(qq)));
  const total = list.length, per = 200;
  return { title, columns: cols, total, page, per, rows: list.slice(page * per, page * per + per), all: page < 0 ? list : undefined };
}

async function loaded(pid) { return (await db.one('select count(*)::int as n from tm_sheet_rows where tm_project_id = $1', [pid])).n; }

module.exports = { loadRows, summary, drill, loaded, DEFAULT_RATE };
