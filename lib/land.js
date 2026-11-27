// Land and title (any project type, first for new development): each land parcel by survey number with its area,
// owners, the deal (purchase, joint development, lease or already owned), the deed, the land cost and every payment
// to the owners, the title papers themselves, and the landowner's share of the flats under a joint development
// agreement (JDA).
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const UNITS = { sqm: ['sq m', 1], sqft: ['sq ft', 0.09290304], sqyd: ['sq yd', 0.83612736], acre: ['acre', 4046.8564224], hectare: ['hectare', 10000], guntha: ['guntha', 101.17141056], cent: ['cent', 40.468564224] };
const DEALS = { purchase: 'Bought (sale deed)', jda: 'Joint development (JDA)', lease: 'Lease', own: 'Already owned' };
const STATUS = { negotiation: 'Under negotiation', agreement: 'Agreement signed', registered: 'Deed registered', mutated: 'Mutation done (7/12 or record updated)' };
const SHARE = { none: 'No landowner share', area: 'Share of flats (area)', revenue: 'Share of sales (revenue)' };
const MODES = { neft: 'NEFT', rtgs: 'RTGS', cheque: 'Cheque', dd: 'Demand draft', cash: 'Cash', upi: 'UPI' };
const FILE_KINDS = { deed: 'Sale deed / JDA / lease', title: 'Title search report', record: '7/12, property card or land record', search: 'Encumbrance / search', poa: 'Power of attorney', map: 'Map or survey plan', other: 'Other' };

async function project(id) {
  const p = await db.one('select id, code, name, kind, state, active from projects where id = $1', [+id || 0]);
  if (!p || !p.active) throw fail(404, 'This project is not in the ERP.');
  return p;
}
const num = (v) => (v == null ? null : +v);
const d10 = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

async function view(p, q = db.q) {
  const parcels = await q('select * from land_parcels where project_id = $1 order by id', [p.id]);
  const ids = parcels.map((x) => x.id);
  const pays = ids.length ? await q('select * from land_payments where parcel_id = any($1::int[]) order by paid_on, id', [ids]) : [];
  const files = ids.length ? await q('select id, parcel_id, kind, name, type, size, created_at from land_files where parcel_id = any($1::int[]) order by id', [ids]) : [];
  const owned = ids.length ? await q('select o.id, o.parcel_id, o.unit_id, o.owner_name, u.unit_no, u.typology, u.carpet_sqft, u.status, b.code as building from land_owner_units o join units u on u.id = o.unit_id join buildings b on b.id = u.building_id where o.parcel_id = any($1::int[]) order by b.code, u.unit_no', [ids]) : [];
  const list = parcels.map((x) => {
    const pp = pays.filter((y) => y.parcel_id === x.id).map((y) => ({ id: y.id, paid_on: d10(y.paid_on), amount: +y.amount, payee: y.payee || '', mode: y.mode, ref: y.ref || '', note: y.note || '' }));
    const paid = pp.reduce((a, y) => a + y.amount, 0);
    const total = (num(x.cost) || 0) + (num(x.stamp_duty) || 0) + (num(x.registration_fee) || 0);
    const sqm = x.area == null ? null : Math.round(+x.area * UNITS[x.area_unit][1] * 100) / 100;
    return { id: x.id, survey_no: x.survey_no, village: x.village || '', taluka: x.taluka || '', district: x.district || '', area: num(x.area), area_unit: x.area_unit, sqm,
      owners: x.owners || '', deal: x.deal, status: x.status, deal_date: d10(x.deal_date), deed_ref: x.deed_ref || '', cost: num(x.cost), stamp_duty: num(x.stamp_duty), registration_fee: num(x.registration_fee),
      share_type: x.share_type, share_pct: num(x.share_pct), title_note: x.title_note || '', remark: x.remark || '',
      total, paid, balance: Math.max(0, (num(x.cost) || 0) - paid), payments: pp,
      files: files.filter((f) => f.parcel_id === x.id).map((f) => ({ id: f.id, kind: f.kind, name: f.name, type: f.type, size: f.size })),
      units: owned.filter((o) => o.parcel_id === x.id).map((o) => ({ id: o.id, unit_id: o.unit_id, unit_no: o.unit_no, building: o.building, typology: o.typology || '', carpet_sqft: num(o.carpet_sqft), status: o.status, owner_name: o.owner_name || '' })),
      missing: [!x.deed_ref && x.deal !== 'own' && 'deed number', !files.some((f) => f.parcel_id === x.id && f.kind === 'title') && 'title search report', !files.some((f) => f.parcel_id === x.id && f.kind === 'record') && '7/12 or land record'].filter(Boolean) };
  });
  const sum = (k) => list.reduce((a, x) => a + (x[k] || 0), 0);
  const free = await q("select u.id, u.unit_no, u.typology, u.carpet_sqft, b.code as building from units u join buildings b on b.id = u.building_id where u.project_id = $1 and u.status = 'available' and not exists (select 1 from land_owner_units o where o.unit_id = u.id) order by b.code, u.unit_no limit 2000", [p.id]);
  return {
    project: { id: p.id, name: p.name, kind: p.kind, state: p.state },
    labels: { units: Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v[0]])), deals: DEALS, status: STATUS, share: SHARE, modes: MODES, files: FILE_KINDS },
    parcels: list,
    free: free.map((u) => ({ id: u.id, unit_no: u.unit_no, building: u.building, typology: u.typology || '', carpet_sqft: num(u.carpet_sqft) })),
    summary: { parcels: list.length, sqm: Math.round(sum('sqm') * 100) / 100, acres: Math.round((sum('sqm') / UNITS.acre[1]) * 1000) / 1000, cost: sum('cost'), total: sum('total'), paid: sum('paid'), balance: sum('balance'),
      registered: list.filter((x) => ['registered', 'mutated'].includes(x.status)).length, jda: list.filter((x) => x.deal === 'jda').length, ownerUnits: owned.length, gaps: list.filter((x) => x.missing.length).length },
  };
}

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
function money(v, label) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw fail(400, `${label} should be an amount in rupees.`);
  return Math.round(n * 100) / 100;
}
function date(v, label) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw fail(400, `${label}: give the date as day, month and year.`);
  if (s > today()) throw fail(400, `${label} cannot be after today.`);
  return s;
}

function clean(x) {
  const v = {
    survey_no: str(x.survey_no, 60), village: str(x.village, 80) || null, taluka: str(x.taluka, 80) || null, district: str(x.district, 80) || null,
    area_unit: UNITS[x.area_unit] ? x.area_unit : 'sqm', owners: str(x.owners, 500) || null,
    deal: DEALS[x.deal] ? x.deal : 'purchase', status: STATUS[x.status] ? x.status : 'negotiation', deal_date: date(x.deal_date, 'Date of the deed'), deed_ref: str(x.deed_ref, 120) || null,
    cost: money(x.cost, 'Land cost'), stamp_duty: money(x.stamp_duty, 'Stamp duty'), registration_fee: money(x.registration_fee, 'Registration fee'),
    share_type: SHARE[x.share_type] ? x.share_type : 'none', share_pct: null, title_note: str(x.title_note, 1000) || null, remark: str(x.remark, 500) || null,
  };
  if (!v.survey_no) throw fail(400, 'Give the survey (or CTS / plot) number.');
  if (x.area != null && x.area !== '') { const a = Number(String(x.area).replace(/[,\s]/g, '')); if (!(a > 0 && a < 1e9)) throw fail(400, 'The area should be a number.'); v.area = a; } else v.area = null;
  if (v.deal !== 'jda') v.share_type = 'none';
  if (v.share_type !== 'none') {
    const s = Number(x.share_pct);
    if (!(s > 0 && s < 100)) throw fail(400, 'The landowner\'s share should be a percentage between 0 and 100.');
    v.share_pct = s;
  }
  return v;
}
const COLS = ['survey_no', 'village', 'taluka', 'district', 'area', 'area_unit', 'owners', 'deal', 'status', 'deal_date', 'deed_ref', 'cost', 'stamp_duty', 'registration_fee', 'share_type', 'share_pct', 'title_note', 'remark'];

async function save(t, u, p, x) {
  const v = clean(x);
  const vals = COLS.map((k) => v[k]);
  if (x.id) {
    const before = await t.one('select * from land_parcels where id = $1 and project_id = $2', [+x.id || 0, p.id]);
    if (!before) throw fail(404, 'That land parcel is not in this project.');
    if (v.share_type === 'none' && before.share_type !== 'none') {
      const n = await t.one('select count(*)::int as n from land_owner_units where parcel_id = $1', [before.id]);
      if (n.n) throw fail(409, `${n.n} flat${n.n === 1 ? ' is' : 's are'} marked as the landowner's share. Release ${n.n === 1 ? 'it' : 'them'} first.`);
    }
    const after = await t.one(`update land_parcels set ${COLS.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() where id = $1 and project_id = $2 returning *`, [before.id, p.id, ...vals]);
    return { before, after };
  }
  const after = await t.one(`insert into land_parcels (project_id, created_by, ${COLS.join(', ')}) values ($1, $2, ${COLS.map((k, i) => `$${i + 3}`).join(', ')}) returning *`, [p.id, u.id, ...vals]);
  return { before: null, after };
}

async function pay(t, u, p, x) {
  const parcel = await t.one('select * from land_parcels where id = $1 and project_id = $2', [+x.parcel || 0, p.id]);
  if (!parcel) throw fail(404, 'That land parcel is not in this project.');
  const amount = money(x.amount, 'Amount');
  if (!amount) throw fail(400, 'Give the amount paid.');
  const paid_on = date(x.paid_on, 'Paid on'); if (!paid_on) throw fail(400, 'Give the date it was paid.');
  const mode = MODES[x.mode] ? x.mode : 'neft';
  if (mode !== 'cash' && !str(x.ref, 60)) throw fail(400, 'Give the UTR or cheque number.');
  const r = await t.one('insert into land_payments (parcel_id, paid_on, amount, payee, mode, ref, note, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *',
    [parcel.id, paid_on, amount, str(x.payee, 120) || null, mode, str(x.ref, 60) || null, str(x.note, 300) || null, u.id]);
  return { parcel, payment: r };
}

// The landowner's share under a JDA: available flats set aside for the landowner (kept "blocked" so sales cannot book them).
async function share(t, u, p, parcelId, unitIds, ownerName) {
  const parcel = await t.one('select * from land_parcels where id = $1 and project_id = $2', [+parcelId || 0, p.id]);
  if (!parcel) throw fail(404, 'That land parcel is not in this project.');
  if (parcel.share_type !== 'area') throw fail(400, 'Set this parcel\'s deal to joint development with a share of flats first.');
  const ids = [...new Set((Array.isArray(unitIds) ? unitIds : []).map(Number).filter(Boolean))].slice(0, 2000);
  if (!ids.length) throw fail(400, 'Choose the flats for the landowner.');
  const rows = await t.q("select u.id, u.unit_no from units u where u.project_id = $1 and u.id = any($2::int[]) and u.status = 'available' and not exists (select 1 from land_owner_units o where o.unit_id = u.id)", [p.id, ids]);
  if (rows.length !== ids.length) throw fail(409, 'Only available flats not already given to a landowner can be set aside.');
  for (const r of rows) {
    await t.q('insert into land_owner_units (parcel_id, unit_id, owner_name, created_by) values ($1, $2, $3, $4)', [parcel.id, r.id, str(ownerName, 120) || parcel.owners || null, u.id]);
    await t.q("update units set status = 'blocked', hold_note = $2 where id = $1", [r.id, ('Landowner share: ' + (str(ownerName, 120) || parcel.owners || parcel.survey_no)).slice(0, 200)]);
  }
  return { parcel, units: rows };
}
async function unshare(t, p, id) {
  const r = await t.one('delete from land_owner_units o using land_parcels l, units u where o.id = $1 and l.id = o.parcel_id and l.project_id = $2 and u.id = o.unit_id returning o.unit_id, u.unit_no, l.survey_no', [+id || 0, p.id]);
  if (!r) throw fail(404, 'That flat is not in a landowner\'s share here.');
  await t.q("update units set status = 'available', hold_note = null where id = $1 and status = 'blocked'", [r.unit_id]);
  return r;
}

// A deed, title report or land record: PDF, JPG or PNG up to 3 MB.
function file(f) {
  const buf = Buffer.from(String((f && f.data) || ''), 'base64');
  if (!buf.length) throw fail(400, 'Choose a file.');
  if (buf.length > 3 * 1024 * 1024) throw fail(400, 'The file is larger than 3 MB. Please scan it at a lower resolution or split it.');
  const type = buf.slice(0, 4).toString() === '%PDF' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(1, 4).toString() === 'PNG' ? 'image/png' : null;
  if (!type) throw fail(400, 'Upload a PDF, JPG or PNG.');
  return { name: str(f.name, 120) || 'land-paper', type, size: buf.length, data: buf.toString('base64'), kind: FILE_KINDS[f.kind] ? f.kind : 'other' };
}

// ---------- Excel ----------
const HEAD = ['Survey / CTS number', 'Village', 'Taluka', 'District', 'Area', 'Area unit', 'Owners', 'Deal', 'Status', 'Deed date', 'Deed number', 'Land cost (₹)', 'Stamp duty (₹)', 'Registration fee (₹)', 'Landowner share %', 'Title note'];
async function sheet(p) {
  const v = await view(p);
  const U = v.labels.units;
  const rows = v.parcels.map((x) => [x.survey_no, x.village, x.taluka, x.district, x.area ?? '', U[x.area_unit], x.owners, DEALS[x.deal], STATUS[x.status], x.deal_date || '', x.deed_ref, x.cost ?? '', x.stamp_duty ?? '', x.registration_fee ?? '', x.share_pct ?? '', x.title_note]);
  if (!rows.length) rows.push(['112/2A', 'Example village', 'Example taluka', 'Example district', 2.5, 'acre', 'Owner name(s)', DEALS.purchase, STATUS.registered, '2024-05-10', 'Deed 4567/2024', 45000000, 2700000, 30000, '', 'Clear title per search report']);
  return require('./xlsx-write').write([
    { name: 'Land', rows: [HEAD, ...rows], widths: [18, 16, 14, 14, 8, 10, 30, 22, 26, 12, 18, 14, 14, 14, 12, 40] },
    { name: 'How to fill', rows: [['Column', 'What to write'], ['Survey / CTS number', 'One row for each survey, CTS or plot number. A number already in the ERP is updated.'], ['Area unit', Object.values(U).join(', ')], ['Deal', Object.values(DEALS).join(', ')], ['Status', Object.values(STATUS).join(', ')], ['Landowner share %', 'Only for joint development: the landowner\'s share of the flats'], ['Dates', 'Day-month-year (10-05-2024) or year-month-day (2024-05-10)'], [], ['', 'Payments to owners and the papers themselves are added on the screen.']], widths: [22, 90] },
  ]);
}
const pick = (map, s) => { const t = String(s || '').trim().toLowerCase(); if (!t) return ''; const hit = Object.entries(map).find(([k, l]) => k === t || (Array.isArray(l) ? l[0] : l).toLowerCase() === t || (Array.isArray(l) ? l[0] : l).toLowerCase().startsWith(t)); return hit ? hit[0] : null; };
const dateIn = (v) => { const s = String(v || '').trim(); let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return s; };
async function importRows(t, u, p, rows) {
  if (!rows.length || !/survey/i.test(String(rows[0][0] || ''))) throw fail(400, 'The first row must be the column names from the template. Download the Excel from this screen and fill that in.');
  const have = await t.q('select id, lower(survey_no) as s, lower(coalesce(village, \'\')) as v from land_parcels where project_id = $1', [p.id]);
  const problems = []; let added = 0, updated = 0; const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c == null ? '' : c).trim());
    if (!r[0]) continue;
    const k = r[0].toLowerCase() + '|' + r[1].toLowerCase();
    if (seen.has(k)) { problems.push(`Row ${i + 1}: survey ${r[0]} ${r[1]} is in the file twice`); continue; } seen.add(k);
    const unit = r[5] ? pick(UNITS, r[5].replace(/^sq\.?\s*/i, 'sq ')) : 'sqm', deal = r[7] ? pick(DEALS, r[7]) : 'purchase', status = r[8] ? pick(STATUS, r[8]) : 'negotiation';
    if (unit === null) { problems.push(`Row ${i + 1} (${r[0]}): area unit "${r[5]}" is not one of ${Object.values(UNITS).map((x) => x[0]).join(', ')}`); continue; }
    if (deal === null) { problems.push(`Row ${i + 1} (${r[0]}): deal "${r[7]}" is not one of ${Object.values(DEALS).join(', ')}`); continue; }
    if (status === null) { problems.push(`Row ${i + 1} (${r[0]}): status "${r[8]}" is not one of ${Object.values(STATUS).join(', ')}`); continue; }
    const old = have.find((h) => h.s === r[0].toLowerCase() && h.v === r[1].toLowerCase());
    const x = { id: old ? old.id : null, survey_no: r[0], village: r[1], taluka: r[2], district: r[3], area: r[4], area_unit: unit, owners: r[6], deal, status, deal_date: dateIn(r[9]), deed_ref: r[10], cost: r[11], stamp_duty: r[12], registration_fee: r[13], share_type: deal === 'jda' && r[14] ? 'area' : 'none', share_pct: r[14], title_note: r[15] };
    try {
      if (old) { const keep = await t.one('select remark, share_type from land_parcels where id = $1', [old.id]); x.remark = keep.remark; if (keep.share_type !== 'none' && x.share_type !== 'none') x.share_type = keep.share_type; }
      await save(t, u, p, x); old ? updated++ : added++;
    } catch (e) { if (!e.status) throw e; problems.push(`Row ${i + 1} (${r[0]}): ${e.message}`); }
  }
  if (problems.length) throw Object.assign(fail(400, `${problems.length} row${problems.length === 1 ? ' has a problem' : 's have problems'}. Nothing was saved. Fix ${problems.length === 1 ? 'it' : 'them'} in Excel and upload again.`), { extra: { problems } });
  return { added, updated };
}

module.exports = { UNITS, DEALS, STATUS, SHARE, MODES, FILE_KINDS, project, view, save, pay, share, unshare, file, sheet, importRows };
