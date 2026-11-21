// MahaRERA filings for Dream Signature (CA / Tax → RERA): each quarter the figures for the quarterly progress report,
// the CA's Form 3 working, the figures for the architect's Form 1 and the engineer's Form 2, and Form 5 for the year,
// in one Excel file; and Word drafts of Forms 1, 2 and 3 that the architect, the engineer and the CA print on their own
// letterhead, check and sign. Laid out as in the CA's Form 3 of 16-Apr-2026 (Tables A to G).
//
// Where the figures come from
//   Estimated cost (Table A), consultants, RR rate ......... settings 'rera_signature' (entered once from the last Form 3)
//   Cost incurred (Table B) ................................ the last certified Form 3 (the baseline) plus the payments
//                                                            register after its date, each Cash Flow Head put on a Form 3 line
//                                                            (settings 'rera_head_map'; heads not yet put on a line are suggested
//                                                            by name and listed for Accounts to confirm)
//   Sold, booked and unsold units (Table C) ................ bookings, CRM receipts (AV and TDS) and the units master
//   RERA bank accounts (Table E, Form 5) ................... the receipts and payments registers on the RERA accounts
//   Construction progress (Form 1) ......................... the slab schedule on the Site page, the stages recorded, and
//                                                            the architect's percentages from the last Form 1 (editable)
const db = require('./db');

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const inr = (v) => n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}-${MN[+m - 1]}-${y}`; };
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const BOOK = 'signature';

// ---- Form 3 lines (Table A and Table B use the same lines) ----
const LINES = [
  { key: 'land_value', sec: 1, label: '(a) Value of the land as ascertained from the Annual Statement of Rates' },
  { key: 'land_premium', sec: 1, label: '(b) Premium to obtain development rights, FSI, additional FSI, fungible area and any other incentive or concession in deficiency under DCR from the Local Authority, State Government or any Statutory Authority' },
  { key: 'land_tdr', sec: 1, label: '(c) Acquisition cost of TDR (if any)' },
  { key: 'land_govt', sec: 1, label: '(d) Amounts paid to State Government / UT Administration or any statutory authority towards stamp duty, transfer charges, registration fees etc.' },
  { key: 'land_lease', sec: 1, label: '(e) Land premium for redevelopment of land owned by public authorities' },
  { key: 'rehab_construction', sec: 1, label: '(f) Under Rehabilitation scheme: (i) construction cost of the rehabilitation building, including site development and infrastructure' },
  { key: 'rehab_clearance', sec: 1, label: '(ii) Clearance of land of all or any encumbrances, including removal of occupants, temporary transit accommodation or rent in lieu of it, overhead cost and amounts payable to slum dwellers and tenants' },
  { key: 'rehab_asr', sec: 1, label: '(iii) ASR linked premium, fees, charges and security deposits or maintenance deposits paid to any authority towards and in project of rehabilitation' },
  { key: 'rehab_interest', sec: 1, label: '(iv) Interest on borrowing done specifically for construction of the rehabilitation component' },
  { key: 'constr', sec: 2, label: '(i) Construction cost of the building, including site development and infrastructure (minimum of the engineer\'s certificate and the books of accounts)' },
  { key: 'constr_extra', sec: 2, label: '(ii) Cost on additional items not included in the estimated cost (as per engineer certificate)' },
  { key: 'dev_other', sec: 2, label: '(iii) Development of the entire project excluding cost of construction as per (i): salaries, consultants\' fees, site overheads, development works, cost of services (water, electricity, sewerage, drainage, layout roads etc.), machinery and equipment including hire and maintenance, consumables etc.' },
  { key: 'taxes', sec: 2, label: '(iv) Taxes, cess, fees, charges, premiums, interest etc. payable to any Statutory Authority' },
  { key: 'interest', sec: 2, label: '(v) Interest payable to financial institutions, scheduled banks, NBFCs or money lenders on construction funding or money borrowed for construction' },
];
const LINE = Object.fromEntries(LINES.map((l) => [l.key, l]));
const SHORT = { land_value: 'Land value (ASR)', land_premium: 'Premium, FSI and approvals', land_tdr: 'TDR', land_govt: 'Stamp duty, transfer, registration', land_lease: 'Land premium (public land)',
  rehab_construction: 'Rehab building construction', rehab_clearance: 'Rehab: clearance, tenants and rent', rehab_asr: 'Rehab: ASR premium and deposits', rehab_interest: 'Rehab: interest',
  constr: 'Construction of the building', constr_extra: 'Additional items', dev_other: 'Other development costs', taxes: 'Taxes and statutory charges', interest: 'Interest on construction funding', exclude: 'Not a project cost (left out)' };

// Form 1 activities (Table A, per building) and common areas (Table B)
const F1A = ['Excavation', 'Basements (if any)', 'Podiums (if any)', 'Plinth', 'Stilt Floor', 'Slabs of Super Structure', 'Internal walls, Internal Plaster, Floorings, Doors and Windows within Flats/Premises',
  'Sanitary Fittings within the Flat/Premises', 'Staircases, Lifts Wells and Lobbies at each Floor level, Overhead and Underground Water Tanks',
  'The external plumbing and external plaster, elevation, completion of terraces with waterproofing of the Building/Wing',
  'Installation of lifts, water pumps, Fire Fighting Fittings and Equipment as per CFO NOC, Electrical fittings, mechanical equipment, Compliance to conditions of environment/CRZ NOC, finishing to entrance lobby/s, plinth protection, paving of areas appurtenant to Building/Wing, Compound Wall and all other requirements as may be required to complete the project as per specifications in the agreement of sale'];
const F1B = ['Internal Roads & Footpaths', 'Water Supply', 'Sewerage (chamber, lines, Septic Tank, STP)', 'Storm Water Drains', 'Landscaping & Tree Planting', 'Street Lighting', 'Community Buildings',
  'Treatment and disposal of sewage and sullage water', 'Solid Waste management & Disposal', 'Water conservation / Rain water harvesting', 'Energy management', 'Fire protection and fire safety requirements', 'Electrical meter room, sub-station, receiving station', 'Others'];

// The defaults are the figures of the CA's Form 3 dated 16-Apr-2026, the architect's Form 1 of 15-Oct-2026 and the
// engineer's Form 2 of 30-Sep-2026 for Dream Signature. Everything can be changed on the RERA page.
const DEFAULTS = {
  regNo: 'PM1180002502097', project: 'Dream Signature', promoter: 'Prime Realtors',
  promoterAddress: 'Office No. 13, Second Floor, Vicino Mall, New Link Road, Andheri West, Mumbai 400102',
  plot: 'Plot bearing CTS No. 446/C-2, Village Oshiwara, Jogeshwari (West), Mumbai Suburban 400102',
  buildingLabel: 'Composite Building - 1 Wing A and Wing B',
  architect: { name: 'Abuzar Ismail Plasterwala', license: 'CA/2018/99003', email: '' },
  engineer: { firm: 'StruBuild Consultants LLP', name: 'Abdul Qayyum A.S. Qureshi', license: 'MCGM License No. STR/Q/04', email: '' },
  ca: { firm: 'S. R. Siddiqui & Co.', name: 'Siddiqui Shafi Ahmed', membership: '154244', frn: '', email: 'ca.shafisiddiqui@gmail.com' },
  designated: { bank: 'Yes RERA Collection 70% (0800)', accountNo: '092872500000800', bankName: 'YES BANK & VIKHROLI', ifsc: 'YESB0000928' },
  collection: ['Yes RERA Collection 100% (0700)'], // where buyers' agreement-value money must come in
  otherRera: ['Yes RERA 30% (0501)'],
  estimate: { land_premium: 464500000, rehab_construction: 1120000000, rehab_clearance: 100000000, constr: 3000000000, dev_other: 500000000 },
  baseline: { date: '2026-04-16', label: 'CA Form 3 dated 16-Apr-2026',
    incurred: { land_premium: 202555583, rehab_clearance: 94452737, constr: 326275800, dev_other: 61356220 }, withdrawn: 0 },
  finance: { ownEstimated: 500000000, securedEstimated: 0, unsecuredEstimated: 0, customerEstimated: 4684500000 },
  engineerEstimate: { building: 3900000000, external: 220000000 },
  rrPerSqm: 270674, depositPct: 70, maxFloor: 33, // the CA's Form 3 counts units up to the floor the CC covers
 ccNote: 'CC is issued up to the 33rd floor; money is also being received for flats on higher floors, so the cost and collection ratios will not match until the CC for the floors above is received.',
  form1: { a: [100, 50, 0, 30, 0, null, 0, 0, 0, 0, 0], b: F1B.map(() => 0), date: '2026-10-15' },
  comments: ['Since this is an SRA project, the old unit numbers of the rehabilitation units are not applicable (NA).',
    'Land cost has been considered as Nil since the project is being developed under the SRA (Slum Rehabilitation Authority) Scheme. Under this scheme, no land is purchased by the promoter; the land is made available by the competent authority for rehabilitation purposes, and the promoter\'s entitlement is derived through development rights/FSI instead of land acquisition. Accordingly, no monetary land acquisition cost is incurred in the project.'],
  letterheadCm: 4.5,
};

async function settings() {
  const r = await db.one("select value from settings where key = 'rera_signature'");
  const v = r ? r.value : {};
  const out = { ...DEFAULTS, ...v };
  for (const k of ['architect', 'engineer', 'ca', 'designated', 'baseline', 'finance', 'engineerEstimate', 'form1']) out[k] = { ...DEFAULTS[k], ...(v[k] || {}) };
  out.estimate = v.estimate || DEFAULTS.estimate;
  out.baseline.incurred = (v.baseline && v.baseline.incurred) || DEFAULTS.baseline.incurred;
  return out;
}
async function saveSettings(v) { await db.q("insert into settings (key, value) values ('rera_signature', $1) on conflict (key) do update set value = excluded.value", [v]); }
async function headMap() { const r = await db.one("select value from settings where key = 'rera_head_map'"); return (r && r.value) || {}; }
async function saveHeadMap(m) { await db.q("insert into settings (key, value) values ('rera_head_map', $1) on conflict (key) do update set value = excluded.value", [m]); }

// A first guess at the Form 3 line for a Cash Flow Head, by its name; Accounts confirms it on the RERA page.
function suggest(head) {
  const h = String(head || '');
  if (!h || /^\(no head\)$/i.test(h)) return null;
  if (/internal transfer|bounce|returned|refund|cancel|investor|current a\/?c|loan|unsecured|drawings|reimburse|car purchase|range rover|\bproject\b|yamunanagar|goreg[ao]+n|dream india|apex|alphadwell|santorini|cloud|events?\b|marketing|advert|brokerage|commission|194 ?h|\bcp\b|-\s*cp|realt(y|ors)|properties|propert|\bsdr\b|stamp duty on flat|gst payable|gst paid|output gst|flat payment|interest on fd|fixed deposit|^\.dc intl/i.test(h)) return 'exclude';
  if (/slum rehabilitation authority|\bsra\b|premium|fungible|\bfsi\b|scrutiny|moef|environment|permission|approval|royalty|\bmcgm\b|\bbmc\b|fire noc|\bcfo\b|development charge|labour cess|infrastructure charge/i.test(h)) return 'land_premium';
  if (/^\d+[\s)-]|tenant|transit|hardship|rent\b|rent compensation|slum dweller|eviction|demolition/i.test(h)) return 'rehab_clearance';
  if (/steel|metco|tmt|rmc|ready mix|cement|concrete|earth ?works?|excavat|infra(structure|con)|construction|contractor|194 ?c|shuttering|formwork|aggregate|\bsand\b|bricks?|blocks?\b|labour|scaffold|piling|waterproof|plumbing|electrical work|fabricat|hardware|machinery|crane|hire|diesel/i.test(h)) return 'constr';
  if (/architect|consultant|engineer|structural|\bmep\b|survey|legal|advocate|solicitor|salary|salaries|wages|staff|electricity|adani|water|site office|security|insurance|stationery|printing|testing|lab\b|soil|tech radiation|software|telephone|internet/i.test(h)) return 'dev_other';
  if (/tds\b|tax|cess|property tax/i.test(h)) return 'taxes';
  if (/interest/i.test(h)) return 'interest';
  return null;
}

async function project() {
  return db.one("select id, name, rera_no from projects where code = 'SIGNATURE'");
}

// ---- quarters ----
function quarterEnds(upTo = today()) {
  const out = []; let y = 2025, q = 0;
  const ends = ['03-31', '06-30', '09-30', '12-31'];
  while (true) { const d = `${y}-${ends[q]}`; if (d > upTo) break; out.push(d); q++; if (q === 4) { q = 0; y++; } }
  return out.reverse();
}
const quarterStart = (qe) => { const [y, m] = qe.split('-').map(Number); return new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10); };
const quarterLabel = (qe) => { const [y, m] = qe.split('-').map(Number); return `${MN[m - 3]}-${MN[m - 1]} ${y}`; };
const fyOf = (d) => { const [y, m] = d.split('-').map(Number); const s = m >= 4 ? y : y - 1; return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` }; };

// ---- cost incurred ----
async function incurred(S, asOf) {
  const map = await headMap();
  const from = S.baseline.date;
  const rows = asOf > from
    ? await db.q(`select id, ref_id, txn_date, bank, description, amount, coalesce(nullif(head, ''), '(no head)') as head, payee from acc_payments
        where book = $1 and txn_date > $2 and txn_date <= $3 and coalesce(amount, 0) <> 0 order by txn_date, id`, [BOOK, from, asOf])
    : [];
  const byHead = new Map();
  for (const r of rows) { const k = r.head; const x = byHead.get(k) || { head: k, n: 0, amount: 0 }; x.n++; x.amount += n(r.amount); byHead.set(k, x); }
  const heads = [...byHead.values()].map((x) => {
    const confirmed = map[x.head]; const sug = confirmed ? null : suggest(x.head);
    return { ...x, amount: r2(x.amount), line: confirmed || sug || null, state: confirmed ? 'confirmed' : sug ? 'suggested' : 'open' };
  }).sort((a, b) => b.amount - a.amount);
  const lineOf = Object.fromEntries(heads.map((h) => [h.head, h.line]));
  const since = Object.fromEntries(LINES.map((l) => [l.key, 0]));
  const detail = [];
  for (const r of rows) {
    const l = lineOf[r.head];
    if (l && l !== 'exclude') { since[l] += n(r.amount); detail.push({ ...r, line: l }); }
  }
  const total = {}; for (const l of LINES) total[l.key] = r2(n(S.baseline.incurred[l.key]) + (asOf >= from ? since[l.key] : 0));
  return { total, since, heads, detail, beforeBaseline: asOf < from, open: heads.filter((h) => h.state === 'open'), suggested: heads.filter((h) => h.state === 'suggested') };
}

// ---- units: sold (agreement registered), booked (not yet registered), unsold, rehab ----
async function units(S, asOf, qFrom) {
  const P = await project(); if (!P) return { sold: [], booked: [], unsold: [], rehab: [], buildings: [] };
  const rows = await db.q(`select u.id, u.unit_no, u.floor, u.typology, u.category, u.status, u.carpet_sqm, u.carpet_sqft, b.code as bcode, b.name as bname, b.kind,
      k.id as booking_id, k.booking_date, k.registration_date, k.agreement_value, k.status as bstatus, coalesce(k.sale_type, 'developer') as sale_type,
      (select string_agg(y.name, ', ' order by bb.seq) from booking_applicants bb join buyers y on y.id = bb.buyer_id where bb.booking_id = k.id) as buyer
    from units u join buildings b on b.id = u.building_id
    left join lateral (select * from bookings x where x.unit_id = u.id and x.status = 'active' and x.booking_date <= $2 order by x.booking_date desc, x.id desc limit 1) k on true
    where u.project_id = $1 order by b.code, u.floor nulls last, u.unit_no`, [P.id, asOf]).catch(async () =>
    db.q(`select u.id, u.unit_no, u.floor, u.typology, u.category, u.status, u.carpet_sqm, u.carpet_sqft, b.code as bcode, b.name as bname, b.kind,
      k.id as booking_id, k.booking_date, k.registration_date, k.agreement_value, k.status as bstatus, 'developer' as sale_type, null as buyer
    from units u join buildings b on b.id = u.building_id
    left join lateral (select * from bookings x where x.unit_id = u.id and x.status = 'active' and x.booking_date <= $2 order by x.booking_date desc, x.id desc limit 1) k on true
    where u.project_id = $1 order by b.code, u.floor nulls last, u.unit_no`, [P.id, asOf]));
  const rec = await db.q(`select r.booking_id, sum(s.amount) filter (where r.received_on <= $2) as todate, sum(s.amount) filter (where r.received_on between $3 and $2) as inq
    from receipts r join receipt_splits s on s.receipt_id = r.id
    where r.project_id = $1 and r.status = 'approved' and s.head in ('av', 'tds') group by r.booking_id`, [P.id, asOf, qFrom || '1900-01-01']);
  const R = new Map(rec.map((x) => [x.booking_id, x]));
  const sqm = (u) => r2(u.carpet_sqm != null ? u.carpet_sqm : u.carpet_sqft != null ? n(u.carpet_sqft) / 10.7639 : 0);
  const sold = [], booked = [], unsold = [], rehab = [], above = [];
  const floorOf = (u) => (u.floor != null ? +u.floor : (() => { const m = String(u.unit_no).match(/(\d+)$/); return m && m[1].length >= 3 ? Math.floor(+m[1] / 100) : null; })());
  const maxF = n(S.maxFloor) || null;
  for (const u of rows) {
    const row = { unit: u.unit_no, building: u.bcode, bname: u.bname, floor: floorOf(u), typ: u.typology, sqm: sqm(u), category: u.category };
    if (u.kind === 'rehab' || u.status === 'rehab') { rehab.push(row); continue; }
    if (['society', 'refuge'].includes(u.status) || u.category === 'parking') continue;
    if (maxF && row.floor != null && row.floor > maxF) {
      const x = u.booking_id ? R.get(u.booking_id) || {} : {};
      above.push({ ...row, booked: !!u.booking_id, av: r2(u.agreement_value), received: r2(x.todate), inQuarter: r2(x.inq) }); continue;
    }
    if (u.booking_id) {
      const x = R.get(u.booking_id) || {};
      const b = { ...row, buyer: u.buyer || '', booked: iso(u.booking_date), registered: iso(u.registration_date), av: r2(u.agreement_value), received: r2(x.todate), inQuarter: r2(x.inq), contractor: u.sale_type === 'contractor' };
      b.balance = r2(b.av - b.received);
      (b.registered && b.registered <= asOf ? sold : booked).push(b);
    } else unsold.push({ ...row, value: Math.round(row.sqm * n(S.rrPerSqm)) });
  }
  const blds = [...new Set(rows.filter((u) => u.kind !== 'rehab').map((u) => u.bcode))].map((code) => {
    const f = (a) => a.filter((x) => x.building === code);
    const s = f(sold), b = f(booked), un = f(unsold), all = [...s, ...b];
    return { code, name: (rows.find((u) => u.bcode === code) || {}).bname || code, sold: s.length, booked: b.length, unsold: un.length, total: s.length + b.length + un.length,
      av: r2(all.reduce((a, x) => a + x.av, 0)), received: r2(all.reduce((a, x) => a + x.received, 0)), inQuarter: r2(all.reduce((a, x) => a + x.inQuarter, 0)) };
  });
  const ab = { units: above.length, booked: above.filter((x) => x.booked).length, av: r2(above.reduce((a, x) => a + x.av, 0)), received: r2(above.reduce((a, x) => a + x.received, 0)), inQuarter: r2(above.reduce((a, x) => a + x.inQuarter, 0)) };
  return { sold, booked, unsold, rehab, buildings: blds, above: ab, maxFloor: maxF };
}

// ---- RERA bank accounts, from the receipts and payments registers ----
async function bank(S, from, to) {
  const accts = [S.designated.bank, ...(S.collection || []), ...(S.otherRera || [])].filter(Boolean);
  const out = [];
  for (const a of [...new Set(accts)]) {
    const db0 = await db.one('select bf_balance, bf_date from acc_daily_banks where book = $1 and ledger_bank = $2 order by id limit 1', [BOOK, a]);
    const bf = db0 ? n(db0.bf_balance) : 0, bfDate = db0 && db0.bf_date ? iso(db0.bf_date) : '1900-01-01';
    const inn = await db.q(`select id, ref_id, txn_date, description, reference, amount, head, payment_head, unit_no, payer_name, coalesce(cheque_status, '') as cs from acc_receipts
      where book = $1 and bank = $2 and txn_date > $3 and txn_date <= $4 and coalesce(cheque_status, '') !~* 'bounce|return' order by txn_date, id`, [BOOK, a, bfDate, to]);
    const outp = await db.q(`select id, ref_id, txn_date, description, reference, amount, head, payee from acc_payments where book = $1 and bank = $2 and txn_date > $3 and txn_date <= $4 order by txn_date, id`, [BOOK, a, bfDate, to]);
    const before = (arr) => arr.filter((x) => iso(x.txn_date) < from).reduce((s, x) => s + n(x.amount), 0);
    const during = (arr) => arr.filter((x) => iso(x.txn_date) >= from);
    const opening = r2(bf + before(inn) - before(outp));
    const dep = during(inn), wd = during(outp);
    const deposits = r2(dep.reduce((s, x) => s + n(x.amount), 0)), withdrawals = r2(wd.reduce((s, x) => s + n(x.amount), 0));
    out.push({ account: a, role: a === S.designated.bank ? 'designated' : (S.collection || []).includes(a) ? 'collection' : 'other', opening, deposits, withdrawals, closing: r2(opening + deposits - withdrawals),
      rows: [...dep.map((x) => ({ date: iso(x.txn_date), kind: 'Deposit', ref: x.ref_id, what: x.payer_name || x.description, head: x.payment_head || x.head, unit: x.unit_no, amount: r2(x.amount) })),
        ...wd.map((x) => ({ date: iso(x.txn_date), kind: 'Withdrawal', ref: x.ref_id, what: x.payee || x.description, head: x.head, unit: '', amount: -r2(x.amount) }))].sort((p, q) => p.date.localeCompare(q.date)) });
  }
  // buyers' agreement-value money that came into an account that is not a RERA account
  const rera = new Set(accts);
  const outside = (await db.q(`select ref_id, txn_date, bank, amount, unit_no, payer_name, description from acc_receipts
      where book = $1 and payment_head = 'AV' and txn_date between $2 and $3 and coalesce(cheque_status, '') !~* 'bounce|return' order by txn_date, id`, [BOOK, from, to]))
    .filter((x) => !rera.has(x.bank)).map((x) => ({ date: iso(x.txn_date), bank: x.bank || '(no bank)', unit: x.unit_no, who: x.payer_name || x.description, amount: r2(x.amount), ref: x.ref_id }));
  return { accounts: out, outside };
}

// withdrawn from the designated account from the start to a date (what went out of it)
async function withdrawnTill(S, to) {
  if (to <= S.baseline.date) return r2(S.baseline.withdrawn);
  const r = await db.one('select coalesce(sum(amount), 0) as s from acc_payments where book = $1 and bank = $2 and txn_date > $3 and txn_date <= $4', [BOOK, S.designated.bank, S.baseline.date, to]);
  return r2(n(S.baseline.withdrawn) + n(r.s));
}

// ---- construction progress for Form 1 ----
async function progress(S, asOf) {
  let towers = {}, prog = {};
  try { const kv = require('./portal/kv'); towers = (await kv.hgetall('site:towers')) || {}; prog = (await kv.hgetall('site:progress')) || {}; } catch { /* no site data */ }
  if (!Object.keys(towers).length) { try { const seed = require('./portal/site-seed.json'); towers = seed.towers || {}; prog = { ...(seed.progress || {}), ...prog }; } catch { /* none */ } }
  const ts = Object.values(towers).filter((t) => t && Array.isArray(t.slabs)).sort((a, b) => (a.order || 0) - (b.order || 0)).map((t) => {
    const sl = [...t.slabs].sort((a, b) => a.seq - b.seq);
    const done = (s) => { const p = prog[s.id] || {}; return p.status === 'cast' && (!p.actualEnd || String(p.actualEnd).slice(0, 10) <= asOf); };
    const plinth = sl.find((s) => /plinth/i.test(s.name)), supers = sl.filter((s) => !/plinth/i.test(s.name));
    const cast = supers.filter(done);
    return { key: t.key, name: t.name || t.key, rehab: t.key === 'rehab', plinthCast: plinth ? done(plinth) : false, slabs: supers.length, cast: cast.length, lastCast: cast.length ? cast[cast.length - 1].name : null };
  });
  const P = await project();
  const stages = P ? await db.q(`select b.code, b.name, sc.stage_name, sc.completed_on from stage_completions sc join buildings b on b.id = sc.building_id where b.project_id = $1 and sc.completed_on <= $2 order by sc.completed_on`, [P.id, asOf]) : [];
  const sale = ts.filter((t) => !t.rehab);
  const a = [...(S.form1.a || [])];
  if (sale.length && sale.every((t) => t.plinthCast)) a[3] = 100;
  const slabText = sale.map((t) => `${t.name}: ${t.cast} out of ${t.slabs}`).join('; ');
  return { towers: ts, stages: stages.map((s) => ({ building: s.name, stage: s.stage_name, on: iso(s.completed_on) })), a, b: S.form1.b || [], slabText };
}

// ---- everything for one quarter ----
async function build(qe) {
  const S = await settings(), qs = quarterStart(qe), fy = fyOf(qe);
  const P = await project();
  const C = await incurred(S, qe), U = await units(S, qe, qs), B = await bank(S, qs, qe), BF = await bank(S, fy.from, qe), G = await progress(S, qe);
  const est = Object.fromEntries(LINES.map((l) => [l.key, n(S.estimate[l.key])]));
  const sum = (o, sec) => r2(LINES.filter((l) => l.sec === sec).reduce((a, l) => a + n(o[l.key]), 0));
  const estLand = sum(est, 1), estDev = sum(est, 2), estTotal = r2(estLand + estDev);
  const incLand = sum(C.total, 1), incDev = sum(C.total, 2), incTotal = r2(incLand + incDev);
  const pct = estTotal ? Math.round((incTotal / estTotal) * 10000) / 100 : 0;
  const withdrawn = await withdrawnTill(S, qe);
  const withdrawable = incTotal; // as on the CA's Form 3: the cost incurred to date
  const all = [...U.sold, ...U.booked];
  const balSold = r2(all.reduce((a, x) => a + x.balance, 0));
  const unsoldArea = r2(U.unsold.reduce((a, x) => a + x.sqm, 0)), unsoldValue = r2(U.unsold.reduce((a, x) => a + x.value, 0));
  const balCost = r2(estTotal - incTotal), estRecv = r2(balSold + unsoldValue);
  const ratio = balCost ? estRecv / balCost : 0;
  const toDeposit = r2((ratio > 1 ? n(S.depositPct) / 100 : 1) * estRecv);
  const des = B.accounts.find((a) => a.role === 'designated') || { opening: 0, deposits: 0, withdrawals: 0, closing: 0, rows: [] };
  const desAll = (await bank(S, '1900-01-02', qe)).accounts.find((a) => a.role === 'designated') || des;
  const custUsed = withdrawn;
  const F3 = {
    estLand, estDev, estTotal, incLand, incDev, incTotal, pct, withdrawable, withdrawn, net: r2(withdrawable - withdrawn),
    tableD: { balCost, balSold, unsoldArea, unsoldValue, estRecv, ratio: Math.round(ratio * 100) / 100, toDeposit },
    tableE: { opening: desAll.opening, deposits: desAll.deposits, withdrawals: desAll.withdrawals, closing: desAll.closing },
    tableF: { own: r2(incTotal - custUsed), customer: custUsed },
  };
  const engIncurred = r2(n(C.total.constr) + n(C.total.constr_extra) + n(C.total.dev_other) + n(C.total.rehab_construction));
  const engEst = n(S.engineerEstimate.building) + n(S.engineerEstimate.external);
  const desF = BF.accounts.find((a) => a.role === 'designated') || { opening: 0, deposits: 0, withdrawals: 0, closing: 0, rows: [] };
  const collF = BF.accounts.filter((a) => a.role === 'collection');
  const fyRec = await (async () => { if (!P) return 0; const r = await db.one(`select coalesce(sum(s.amount), 0) as s from receipts r join receipt_splits s on s.receipt_id = r.id where r.project_id = $1 and r.status = 'approved' and s.head in ('av','tds') and r.received_on between $2 and $3`, [P.id, fy.from, qe]); return r2(r.s); })();
  const useOf = {}; for (const row of desF.rows.filter((x) => x.kind === 'Withdrawal')) { const k = row.head || '(no head)'; useOf[k] = r2((useOf[k] || 0) - row.amount); }
  return {
    qe, qs, label: quarterLabel(qe), fy, settings: S, project: P, lines: LINES, short: SHORT,
    est, cost: C, units: U, bank: B, progress: G, F3,
    F2: { estimate: engEst, building: n(S.engineerEstimate.building), external: n(S.engineerEstimate.external), incurred: engIncurred, pct: engEst ? Math.round((engIncurred / engEst) * 100000) / 1000 : 0, balance: r2(engEst - engIncurred) },
    F5: { fy, collections: fyRec, designated: desF, collection: collF, outside: BF.outside, use: Object.entries(useOf).map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount) },
    checks: [
      ...(C.beforeBaseline ? [`This quarter ends before ${fmtD(S.baseline.date)}, the date of the last certified Form 3, so cost incurred shows the certified figures as they are.`] : []),
      ...(C.open.length ? [`${C.open.length} cash flow head${C.open.length === 1 ? '' : 's'} paid after ${fmtD(S.baseline.date)} (₹${inr(C.open.reduce((a, h) => a + h.amount, 0))}) not yet put on a Form 3 line; they are left out until Accounts chooses.`] : []),
      ...(C.suggested.length ? [`${C.suggested.length} cash flow head${C.suggested.length === 1 ? '' : 's'} put on a Form 3 line by the ERP from the name; Accounts should confirm them.`] : []),
      ...(B.outside.length ? [`${B.outside.length} buyer receipt${B.outside.length === 1 ? '' : 's'} in the quarter (₹${inr(B.outside.reduce((a, x) => a + x.amount, 0))}) went into an account that is not a RERA account.`] : []),
      ...(!desAll.deposits && all.length ? ['No deposits are recorded on the designated RERA account. Check that its bank name in the RERA settings matches the bank in the registers.'] : []),
      ...(U.above.units ? [`${U.above.units} units above the ${U.maxFloor}th floor (not yet covered by the CC) are left out of Table C and D: ${U.above.booked} of them booked, ₹${inr(U.above.received)} received on them to date.`] : []),
      ...(!U.rehab.length ? ['The rehab units are not in the ERP\'s units list, so the Rehab table in Form 3 is empty. Copy them from the last Form 3, or add them to the units list.'] : []),
      ...B.accounts.filter((a) => a.closing < 0).map((a) => `${a.account} shows a negative balance (₹${inr(a.closing)}): its opening balance or some entries are missing in the registers.`),
    ],
  };
}

// ---- Excel ----
function excel(M) {
  const { write } = require('./xlsx-write');
  const S = M.settings, F = M.F3, D = F.tableD;
  const head = [`Dream Signature · MahaRERA ${S.regNo} · quarter ${M.label} (${fmtD(M.qs)} to ${fmtD(M.qe)})`];
  const sheets = [];
  // 1. quarterly progress report
  sheets.push({ name: 'Quarterly progress', widths: [34, 12, 12, 12, 12, 18, 18, 18], rows: [head, [], ['Units by building', 'Total', 'Sold', 'Booked', 'Unsold', 'Agreement value', 'Received in quarter', 'Received to date'],
    ...M.units.buildings.map((b) => [b.name, b.total, b.sold, b.booked, b.unsold, b.av, b.inQuarter, b.received]),
    ['Total', M.units.buildings.reduce((a, b) => a + b.total, 0), M.units.sold.length, M.units.booked.length, M.units.unsold.length, r2(M.units.buildings.reduce((a, b) => a + b.av, 0)), r2(M.units.buildings.reduce((a, b) => a + b.inQuarter, 0)), r2(M.units.buildings.reduce((a, b) => a + b.received, 0))],
    [], ['Construction progress', 'Slabs cast', 'Of', 'Plinth cast', 'Last slab cast'], ...M.progress.towers.map((t) => [t.name, t.cast, t.slabs, t.plinthCast ? 'Yes' : 'No', t.lastCast || '']),
    [], ['Stages completed (recorded with the architect\'s certificate)', 'Building', 'Completed on'], ...M.progress.stages.map((s) => [s.stage, s.building, fmtD(s.on)]),
    ...(M.units.above.units ? [[], [`Units above the ${M.units.maxFloor}th floor (left out of Form 3 until the CC covers them)`, M.units.above.units, '', M.units.above.booked + ' booked', '', M.units.above.av, M.units.above.inQuarter, M.units.above.received]] : []),
    [], ['Rehab units', M.units.rehab.length], ...(S.ccNote ? [[], ['Note: ' + S.ccNote]] : []), ...(M.checks.length ? [[], ['Points to check'], ...M.checks.map((c) => ['• ' + c])] : [])], bold: new Set([2]) });
  // 2. Form 3 working
  const lineRows = (o) => LINES.map((l) => [`${l.sec}. ${l.label}`, o[l.key] ? r2(o[l.key]) : '']);
  sheets.push({ name: 'Form 3 working', widths: [90, 20, 20], rows: [head, [], ['Table A: Estimated cost of the project', 'Estimated cost (Rs.)'], ['1. Land cost'], ...lineRows(M.est).slice(0, 9), ['Sub-total of land cost', F.estLand], ['2. Development cost / cost of construction of building'], ...lineRows(M.est).slice(9), ['Sub-total of development cost', F.estDev], ['Total cost of project (estimated)', F.estTotal], [],
    [`Table B: Actual cost incurred as on ${fmtD(M.qe)}`, 'Amount (Rs.)', `of which paid after ${fmtD(S.baseline.date)}`], ['1. Land cost'], ...LINES.slice(0, 9).map((l) => [l.label, M.cost.total[l.key] || '', M.cost.since[l.key] ? r2(M.cost.since[l.key]) : '']), ['Sub-total of land cost', F.incLand],
    ['2. Development cost'], ...LINES.slice(9).map((l) => [l.label, M.cost.total[l.key] || '', M.cost.since[l.key] ? r2(M.cost.since[l.key]) : '']), ['Sub-total of development cost', F.incDev],
    ['3. Total cost of the project (actual incurred as on date)', F.incTotal], ['4. Proportion of cost incurred on land and construction to the total estimated cost (%)', F.pct], ['5. Amount which can be withdrawn from the designated account', F.withdrawable],
    ['6. Less: amount withdrawn till date from the designated account', F.withdrawn], ['7. Net amount which can be withdrawn from the designated bank account under this certificate', F.net], [],
    ['Table D: Comparison between balance cost and receivables', 'Amount'], ['1. Estimated balance cost to complete the project (total estimated cost less cost incurred)', D.balCost], ['2. Balance amount of receivables from sold apartments (Table C)', D.balSold],
    ['3. (i) Balance unsold area (sq m)', D.unsoldArea], ['4. (ii) Estimated sales proceeds of unsold apartments (RR rate × unsold area)', D.unsoldValue], ['5. Estimated receivables of the ongoing project (2 + 4)', D.estRecv],
    [`6. Amount to be deposited in the designated account (${D.ratio > 1 ? S.depositPct + '%' : '100%'}; receivables ÷ balance cost = ${D.ratio})`, D.toDeposit], [],
    ['Table E: Designated bank account', `A/c ${S.designated.accountNo} · ${S.designated.bankName} · IFSC ${S.designated.ifsc}`], ['1. Opening balance', F.tableE.opening], ['2. Deposits', F.tableE.deposits], ['3. Withdrawals', F.tableE.withdrawals], ['4. Closing balance', F.tableE.closing], [],
    ['Table F: Means of finance', 'Estimated', 'Actual'], ['1. Own funds', n(S.finance.ownEstimated), F.tableF.own], ['2. Borrowed funds (secured)', n(S.finance.securedEstimated), 0], ['3. Borrowed funds (unsecured)', n(S.finance.unsecuredEstimated), 0],
    ['4. Customer receipts used for the project', n(S.finance.customerEstimated), F.tableF.customer], ['5. Total funds for project', r2(n(S.finance.ownEstimated) + n(S.finance.securedEstimated) + n(S.finance.unsecuredEstimated) + n(S.finance.customerEstimated)), F.incTotal], ['6. Total estimated cost (Table A)', F.estTotal, F.estTotal],
  ], bold: new Set([2, 3, 13, 14, 16, 17, 18]) });
  // Table C, flat-wise
  const cRows = (arr) => arr.map((x, i) => [i + 1, x.unit, x.sqm, x.buyer, fmtD(x.booked), fmtD(x.registered), x.av, x.received, x.balance]);
  const tot = (arr) => ['', 'Total', r2(arr.reduce((a, x) => a + x.sqm, 0)), '', '', '', r2(arr.reduce((a, x) => a + x.av, 0)), r2(arr.reduce((a, x) => a + x.received, 0)), r2(arr.reduce((a, x) => a + x.balance, 0))];
  const cHead = ['S. No.', 'Flat No', 'Carpet area (sq m)', 'Buyer', 'Booked on', 'Registered on', 'Unit consideration (agreement)', 'Received amount', 'Balance receivable'];
  sheets.push({ name: 'Table C sold', widths: [7, 12, 12, 34, 13, 13, 18, 18, 18], rows: [[`Sold inventory (agreement registered) as on ${fmtD(M.qe)} · ${S.buildingLabel}`], cHead, ...cRows(M.units.sold), tot(M.units.sold)] });
  sheets.push({ name: 'Table C booked', widths: [7, 12, 12, 34, 13, 13, 18, 18, 18], rows: [[`Booked inventory (agreement not yet registered) as on ${fmtD(M.qe)}`], cHead, ...cRows(M.units.booked), tot(M.units.booked)] });
  sheets.push({ name: 'Table C unsold', widths: [7, 12, 14, 22], rows: [[`Unsold inventory as on ${fmtD(M.qe)} · RR rate Rs. ${inr(S.rrPerSqm)} per sq m`], ['S. No.', 'Flat No', 'Carpet area (sq m)', 'Unit consideration as per RR rate'],
    ...M.units.unsold.map((x, i) => [i + 1, x.unit, x.sqm, x.value]), ['', 'Total', r2(M.units.unsold.reduce((a, x) => a + x.sqm, 0)), r2(M.units.unsold.reduce((a, x) => a + x.value, 0))]] });
  sheets.push({ name: 'Table C rehab', widths: [7, 30, 14, 10, 14], rows: [['Rehab units'], ['S. No.', 'Building', 'New Flat No.', 'Old Flat No.', 'Carpet (sq m)'], ...M.units.rehab.map((x, i) => [i + 1, x.bname, x.unit, 'NA', x.sqm]), ['', 'Total', '', '', r2(M.units.rehab.reduce((a, x) => a + x.sqm, 0))]] });
  // Form 1 and Form 2 figures
  sheets.push({ name: 'Form 1 figures', widths: [90, 22], rows: [[`Form 1 (architect): percentage of work done as on ${fmtD(M.qe)} · ${S.buildingLabel}`], ['Table A: activity', '% of work done'],
    ...F1A.map((a, i) => [`${i + 1}. ${a}`, i === 5 ? M.progress.slabText : M.progress.a[i] == null ? '' : M.progress.a[i]]), [], ['Table B: common areas', '% of work done'], ...F1B.map((a, i) => [`${i + 1}. ${a}`, M.progress.b[i] == null ? '' : M.progress.b[i]]), [],
    ['Percentages other than plinth and slabs are carried from the last Form 1 and are for the architect to confirm on site.']] });
  sheets.push({ name: 'Form 2 figures', widths: [80, 22], rows: [[`Form 2 (engineer): cost of civil, MEP and allied works as on ${fmtD(M.qe)}`], ['Table A: building', 'Amount (Rs.)'], ['1. Total estimated cost of the building', M.F2.building], ['2. Cost incurred as on date (construction, rehab building and other development from Table B)', M.F2.incurred],
    ['3. Work done in percentage of the estimated cost', M.F2.estimate ? Math.round((M.F2.incurred / M.F2.building) * 100000) / 1000 : 0], ['4. Balance cost to be incurred', r2(M.F2.building - M.F2.incurred)], [], ['Table B: internal and external development works', 'Amount (Rs.)'], ['1. Total estimated cost', M.F2.external], [],
    ['Total estimated cost (Table A + B)', M.F2.estimate]] });
  // Form 5
  const F5 = M.F5;
  sheets.push({ name: 'Form 5 year', widths: [60, 20], rows: [[`Form 5 (annual): ${F5.fy.label}, ${fmtD(F5.fy.from)} to ${fmtD(M.qe)}${M.qe < F5.fy.to ? ' (year to date)' : ''}`], ['Particulars', 'Amount (Rs.)'],
    ['Collections from allottees (agreement value, incl. customer TDS)', F5.collections], ...F5.collection.map((a) => [`Deposits into the collection account ${a.account}`, a.deposits]), ['Deposits into the designated account', F5.designated.deposits],
    ['Withdrawals from the designated account', F5.designated.withdrawals], ['Designated account: opening balance', F5.designated.opening], ['Designated account: closing balance', F5.designated.closing], [],
    ['Use of withdrawals (by cash flow head)', 'Amount'], ...F5.use.map((u) => [u.head, u.amount]), [], ['Buyer receipts into an account that is not a RERA account', 'Amount'],
    ...F5.outside.map((x) => [`${fmtD(x.date)} · ${x.unit || ''} · ${x.who || ''} · ${x.bank}`, x.amount])] });
  // RERA bank, every entry
  sheets.push({ name: 'RERA bank entries', widths: [12, 30, 12, 12, 40, 24, 12, 16], rows: [[`Every deposit and withdrawal on the RERA accounts, ${fmtD(M.qs)} to ${fmtD(M.qe)}`], ['Date', 'Account', 'Entry', 'Ref', 'Party / description', 'Head', 'Unit', 'Amount'],
    ...M.bank.accounts.flatMap((a) => [[`${a.account}: opening ${inr(a.opening)}, deposits ${inr(a.deposits)}, withdrawals ${inr(a.withdrawals)}, closing ${inr(a.closing)}`], ...a.rows.map((x) => [fmtD(x.date), a.account, x.kind, x.ref, x.what, x.head, x.unit, x.amount])])] });
  // cost detail and heads
  sheets.push({ name: 'Cost incurred detail', widths: [12, 12, 30, 40, 30, 16], rows: [[`Payments counted in cost incurred, after ${fmtD(S.baseline.date)} (${S.baseline.label}) to ${fmtD(M.qe)}`], ['Date', 'Payment ID', 'Form 3 line', 'Cash flow head', 'Payee', 'Amount'],
    ...M.cost.detail.map((x) => [fmtD(iso(x.txn_date)), x.ref_id, SHORT[x.line], x.head, x.payee || '', r2(x.amount)])] });
  sheets.push({ name: 'Heads to confirm', widths: [50, 8, 18, 34, 12], rows: [['Cash flow heads paid in the period and the Form 3 line each is counted on'], ['Cash flow head', 'Rows', 'Amount', 'Form 3 line', 'Status'],
    ...M.cost.heads.map((h) => [h.head, h.n, h.amount, h.line ? SHORT[h.line] : '(not on a line: left out)', h.state === 'confirmed' ? 'Confirmed' : h.state === 'suggested' ? 'Suggested, confirm' : 'Choose a line'])] });
  return write(sheets);
}

// ---- Word drafts ----
function docForm1(M) {
  const S = M.settings, G = M.progress;
  const blocks = [{ h: 'FORM 1' }, { h: '(See Regulation 3)', size: 10 }, { h: 'ARCHITECT\'S CERTIFICATE' }, { p: '(To be submitted at the time of Registration of Ongoing Project and for withdrawal of Money from Designated Account)', center: true, size: 9 },
    { p: 'Date: ____________', right: true }, { p: `To,\n${S.promoter},\n${S.promoterAddress}` },
    { p: `Subject: Certificate of Percentage of Completion of Construction Work of ${S.project} having MahaRERA Registration Number ${S.regNo}, ${S.plot}, being developed by ${S.promoter}.`, b: true, justify: true },
    { p: 'Sir,' },
    { p: `I, ${S.architect.name}, have undertaken the assignment as Architect / Licensed Surveyor of certifying the Percentage of Completion of Construction Work of ${S.project} having MahaRERA Registration Number ${S.regNo}, being developed by ${S.promoter}. Based on site inspection, with respect to each of the Building/Wing of the aforesaid Real Estate Project, I certify that as on the date of this certificate the Percentage of Work done for each of the Building/Wing of the Real Estate Project under MahaRERA is as per Table A herein below. The percentage of the work executed with respect to each of the activities of the entire phase is detailed in Table B.`, justify: true },
    { h: 'Table A', size: 10 }, { p: `Layout / Building / Wing: ${S.buildingLabel}`, center: true, size: 9 },
    { table: { head: ['Sr. No.', 'Tasks / Activity', 'Percentage of actual work done (as on the date of certificate)'], widths: [1.5, 10.5, 5], num: [2],
      rows: F1A.map((a, i) => [String(i + 1), a, i === 5 ? G.slabText : G.a[i] == null ? '' : String(G.a[i])]) } },
    { h: 'Table B', size: 10 }, { p: 'Common Areas (Internal & External Development Works) in respect of the Registered Phase / Project', center: true, size: 9 },
    { table: { head: ['Sr. No.', 'Common areas and facilities', 'Proposed (Yes/No)', 'Details', 'Percentage of actual work done'], widths: [1.4, 6.6, 2.6, 3.4, 3], num: [4],
      rows: F1B.map((a, i) => [String(i + 1), a, '', '', G.b[i] == null ? '' : String(G.b[i])]) } },
    { space: true }, { p: `Signature & Name of Architect\n\n\n${S.architect.name}\nLicense No. ${S.architect.license}` }, { space: true }, { p: `Agreed and Accepted by:\n\n\nFor ${S.promoter}` }];
  return require('./docx-write').write({ blocks, topCm: n(S.letterheadCm) || 4.5 });
}
function docForm2(M) {
  const S = M.settings, F = M.F2;
  const blocks = [{ h: 'FORM 2' }, { h: '(See Regulation 3)', size: 10 }, { h: 'ENGINEER\'S CERTIFICATE' }, { p: 'Date: ____________', right: true }, { p: `To,\nM/s. ${S.promoter},\n${S.promoterAddress}` },
    { p: `Subject: Certificate of Cost Incurred for Development of "${S.project}" having MahaRERA Registration Number ${S.regNo}, situated on the proposed slum rehabilitation scheme on ${S.plot}, being developed by M/s. ${S.promoter}.`, b: true, justify: true },
    { p: 'Sir,' },
    { p: `1) We, ${S.engineer.firm}, have undertaken the assignment of certifying the Estimated Cost for "${S.project}" having MahaRERA Registration Number ${S.regNo}, situated on ${S.plot}, being developed by M/s. ${S.promoter}.`, justify: true },
    { p: '2) We have estimated the cost of Civil, MEP and allied works required for completion of the apartments and proportionate completion of internal & external works of the project as per specifications mentioned in the agreement of sale. Our estimated cost calculations are based on the drawings/plans made available to us for the project under reference by the Developer and Consultants, the Schedule of items and quantity required for the entire work, the assumption of the cost of material, labour and other inputs made by the developer, and the site inspection carried out by us to ascertain / confirm the above analysis given to us.', justify: true },
    { p: `3) We estimate the Total Estimated Cost of completion of the aforesaid project under reference at Rs. ${inr(F.estimate)} (Total of Table A and B) at the time of Registration. The estimated Total Cost of the building is Rs. ${inr(F.building)} (as per Table A). The estimated Total Cost of the project is with reference to the Civil, MEP and allied works required for completion of the apartments and proportionate completion of internal & external works, as per specifications mentioned in the agreement of sale, and for the purpose of obtaining the occupation certificate / completion certificate from the Slum Rehabilitation Authority (SRA), under whose jurisdiction the aforesaid project is being implemented.`, justify: true },
    { p: `4) The Cost Incurred till date is calculated at Rs. ${inr(F.incurred)} (Total of Table A and B). The amount of Estimated Cost Incurred is calculated on the basis of input materials / services used and unit cost of these items.`, justify: true },
    { p: `5) The Balance Cost of Completion of the Civil, MEP and allied works for completion of the apartments and proportionate completion of internal & external works, as per specifications mentioned in the agreement of sale, of the Project is estimated at Rs. ${inr(F.estimate - F.incurred)} (Total of Table A and B).`, justify: true },
    { p: '6) I certify that the Cost of the Civil, MEP and allied work for the apartments and proportionate internal & external works, as per specifications mentioned in the agreement of sale, of the aforesaid Project as completed on the date of this certificate is as given in Table A and B below:', justify: true },
    { h: `TABLE A: Building development called "${S.project.toUpperCase()}"`, size: 10 },
    { table: { head: ['Sr. No.', 'Particulars', 'Amount (Rs.)'], widths: [1.5, 11, 4.5], num: [2], rows: [['1', 'Total Estimated Cost of the building as on date of Certificate', inr(F.building)], ['2', 'Cost incurred as on date of certificate', inr(F.incurred)],
      ['3', 'Work done in Percentage (as Percentage of the estimated cost)', (F.building ? Math.round((F.incurred / F.building) * 100000) / 1000 : 0) + '%'], ['4', 'Balance Cost to be Incurred (Based on Estimated Cost)', inr(F.building - F.incurred)], ['5', 'Cost Incurred on Additional/Extra items not included in the Estimated Cost (Table C)', '--']] } },
    { h: 'TABLE B: Internal & External Development Works in respect of the Registered Phase', size: 10 },
    { table: { head: ['Sr. No.', 'Particulars', 'Amount (Rs.)'], widths: [1.5, 11, 4.5], num: [2], rows: [['1', 'Total Estimated Cost of the Internal and External Development Works including amenities and facilities in the layout as on date of certificate', inr(F.external)],
      ['2', 'Cost incurred as on date of certificate', '--'], ['3', 'Work done in Percentage (as Percentage of the estimated cost)', '--'], ['4', 'Balance Cost to be Incurred (Based on Estimated Cost)', '--'], ['5', 'Cost Incurred on Additional/Extra items not included in the Estimated Cost (Table C)', '--']] } },
    { p: `Yours Faithfully,\n\n\nSignature of Engineer\n${S.engineer.name}\n(${S.engineer.license})\nFor ${S.engineer.firm}` }, { p: `Agreed and accepted by:\n\n\nFor M/s. ${S.promoter}` },
    { h: 'Table C: List of Extra/Additional/Deleted Items considered in Cost (which were not part of the original Estimate of Total Cost)', size: 10 },
    { table: { head: ['Sr. No.', 'List of Extra/Additional/Deleted Items', 'Amount (Rs.)'], widths: [1.5, 11, 4.5], rows: [['1', 'Not Applicable', '--']] } }];
  return require('./docx-write').write({ blocks, topCm: n(S.letterheadCm) || 4.5 });
}
function docForm3(M) {
  const S = M.settings, F = M.F3, D = F.tableD, U = M.units;
  const L = (o, from, to) => LINES.slice(from, to).map((l) => ['', l.label, o[l.key] ? inr(o[l.key]) : '']);
  const cT = (arr) => ({ head: ['S. No.', 'Flat No', 'Carpet area (Sq. mts)', 'Unit Consideration as per Agreement/Letter of Allotment*', 'Received Amount', 'Balance Receivables'], widths: [1.3, 2.4, 2.6, 3.8, 3.4, 3.4], num: [2, 3, 4, 5],
    rows: [...arr.map((x, i) => [String(i + 1), x.unit, x.sqm.toFixed(2), inr(x.av), inr(x.received), inr(x.balance)]), ['-', 'Total', r2(arr.reduce((a, x) => a + x.sqm, 0)).toFixed(2), inr(arr.reduce((a, x) => a + x.av, 0)), inr(arr.reduce((a, x) => a + x.received, 0)), inr(arr.reduce((a, x) => a + x.balance, 0))]], bold: [arr.length] });
  const blocks = [{ h: 'FORM-3' }, { h: '(See Regulation 3)', size: 10 }, { h: 'CHARTERED ACCOUNTANT\'S CERTIFICATE' }, { p: '(To be submitted at the time of Registration of Project and for withdrawal of Money from Designated Account)', center: true, size: 9 },
    { p: 'Date: ____________', right: true }, { p: `To,\nThe ${S.promoter.toUpperCase()}\n${S.promoterAddress}` },
    { p: `Subject: Certificate of Financial Progress of Work of ${S.project.toUpperCase()} having MahaRERA Registration Number ${S.regNo} being developed by ${S.promoter.toUpperCase()}`, b: true, justify: true },
    { p: 'Sir,' }, { p: `This certificate is being issued for RERA compliance for the ${S.project.toUpperCase()} having MahaRERA Registration Number ${S.regNo} being developed by ${S.promoter.toUpperCase()} and is based on the records and documents produced before me and explanations provided to me by the management of the Company.`, justify: true },
    { h: 'Table A - Estimated Cost of the Project (at the time of Registration of Project)', size: 10 },
    { table: { head: ['Sr. No.', 'Particulars', 'Estimated Cost (Rs.)'], widths: [1.4, 11.4, 4.2], num: [2], rows: [['1', 'Land Cost', ''], ...L(M.est, 0, 9), ['', 'Sub-Total of Land Cost', inr(F.estLand)], ['2', 'Development Cost / Cost of Construction of Building', ''], ...L(M.est, 9), ['', 'Sub-total of Development Cost', inr(F.estDev)], ['', 'Total Cost of Project (Estimated)', inr(F.estTotal)]], bold: [0, 10, 11, 17, 18] } },
    { p: '*Pass through charges or indirect taxes not included in estimated cost of project.', size: 8 },
    { h: 'Table B - Actual Cost Incurred on the Project (as on Date of Certificate)', size: 10 },
    { table: { head: ['S. No.', 'Particulars', 'Amount (Rs.)'], widths: [1.4, 11.4, 4.2], num: [2], rows: [['1', 'Land Cost', ''], ...L(M.cost.total, 0, 9), ['', 'Sub-Total of Land Cost', inr(F.incLand)], ['2', 'Development Cost', ''], ...L(M.cost.total, 9), ['', 'Sub-total of Development Cost', inr(F.incDev)],
      ['3', 'Total Cost of the Project (Actual incurred as on date of certificate)', inr(F.incTotal)], ['4', 'Proportion of the Cost incurred on Land Cost and Construction Cost to the total Estimated Cost (Table A)', String(F.pct)], ['5', 'Amount which can be withdrawn from the Designated Account', inr(F.withdrawable)],
      ['6', 'Less: Amount withdrawn till date of this certificate from the Designated Account', inr(F.withdrawn)], ['7', 'Net Amount which can be withdrawn from the Designated Bank Account under this certificate', inr(F.net)]], bold: [0, 10, 11, 17, 18, 22] } },
    { h: 'Table C - Statement for calculation of Receivables from the Sales of the Real Estate Project', size: 10 },
    { p: `Sold Inventory · Building Name / Wing Name: ${S.buildingLabel}`, b: true, size: 9 }, { table: cT(U.sold) },
    { p: '*Unit Consideration as per agreement/letter of allotment and amount received does not include pass through charges and indirect taxes.', size: 8 },
    { p: `Unsold Inventory · Building Name / Wing Name: ${S.buildingLabel}`, b: true, size: 9 },
    { table: { head: ['S. No.', 'Flat No', 'Carpet Area (Sq. mts)', 'Unit Consideration as per Ready Reckoner Rate'], widths: [1.5, 4, 4.5, 7], num: [2, 3], rows: [...U.unsold.map((x, i) => [String(i + 1), x.unit, x.sqm.toFixed(2), inr(x.value)]), ['', 'Total', r2(U.unsold.reduce((a, x) => a + x.sqm, 0)).toFixed(2), inr(U.unsold.reduce((a, x) => a + x.value, 0))]], bold: [U.unsold.length] } },
    { p: `Rehab · Building Name / Wing Name: ${S.buildingLabel}`, b: true, size: 9 },
    { table: { head: ['S. No.', 'Building Name', 'New Flat No.', 'Old Flat No.', 'Unit Carpet Area (Sq. mts)', 'Cost of Additional Area', 'Received Amount', 'Balance Receivables'], widths: [1.2, 3.4, 2.2, 1.8, 2.2, 2, 2.1, 2.1], num: [4, 5, 6, 7],
      rows: [...U.rehab.map((x, i) => [String(i + 1), S.buildingLabel, x.unit, 'NA', x.sqm.toFixed(2), '0.00', '0.00', '0.00']), ['', '', '', 'Total', r2(U.rehab.reduce((a, x) => a + x.sqm, 0)).toFixed(2), '0.00', '0.00', '0.00']], bold: [U.rehab.length] } },
    { p: `Booked Inventory · Building Name / Wing Name: ${S.buildingLabel}`, b: true, size: 9 }, { table: cT(U.booked) },
    { h: 'Table D - Comparison between Balance Cost and Receivables', size: 10 },
    { table: { head: ['Sr. No.', 'Particulars', 'Amount'], widths: [1.4, 11.4, 4.2], num: [2], rows: [['1', 'Estimated Balance Cost to Complete the Real Estate Project (Difference of Total Estimated Project cost less Cost incurred)', inr(D.balCost)],
      ['2', 'Balance amount of receivables from sold apartments as per Table C of this certificate (as certified by Chartered Accountant as verified from the records and books of Accounts)', inr(D.balSold)],
      ['3', '(i) Balance Unsold area (to be certified by Management and to be verified by CA from the records and books of accounts)', r2(D.unsoldArea).toFixed(2)],
      ['4', '(ii) Estimated amount of sales proceeds in respect of unsold apartments (calculated as per ASR multiplied to unsold area as on the date of certificate, to be calculated and certified by CA) as per Table C to this certificate', inr(D.unsoldValue)],
      ['5', 'Estimated receivables of ongoing project [Sum of 2 + 3(ii)]', inr(D.estRecv)],
      ['6', '(To be filled for Ongoing Projects only) Amount to be deposited in Designated Account - 70% or 100%. If 4 is greater than 1, then 70% of the balance receivables of ongoing project will be deposited in designated Account; if 4 is lesser than 1, then 100% of the balance receivables of ongoing project will be deposited in designated Account.', inr(D.toDeposit)]] } },
    { h: 'Table E - Designated Bank Account Details', size: 10 },
    { table: { head: ['S. No', 'Particulars', 'Designated Bank Account Details'], widths: [1.4, 6, 9.6], num: [2], rows: [['', '', `Account No: ${S.designated.accountNo}\nBank & Branch Name: ${S.designated.bankName}\nIFSC: ${S.designated.ifsc}\nActual Amount till Date (from start of bank account to till date)`],
      ['1', 'Opening Balance', inr(F.tableE.opening)], ['2', 'Deposits', inr(F.tableE.deposits)], ['3', 'Withdrawals', inr(F.tableE.withdrawals)], ['4', 'Closing balance', inr(F.tableE.closing)]] } },
    { p: 'I hereby certify that required proportion of money, as specified in the act, collected from allottees of the project unit as indicated in Table C has been deposited in Designated RERA Bank Account.', justify: true },
    { p: `I hereby certify that ${S.promoter.toUpperCase()} has utilized the required proportion of money, as specified in the act, collected from allottees for this project only for land and construction of this project.`, justify: true },
    { h: 'Table F - Means of Finance', size: 10 },
    { table: { head: ['S. No', 'Particulars', 'Estimated (at time of Registration) (Rs.)', 'Proposed/Estimated (as on the date of the certificate) (Rs.)', 'Actual (as on the date of certificate) (Rs.)'], widths: [1.2, 5.2, 3.5, 3.6, 3.5], num: [2, 3, 4],
      rows: [['1', 'Own Funds', inr(S.finance.ownEstimated), inr(S.finance.ownEstimated), inr(F.tableF.own)], ['2', 'Total Borrowed funds (Secured) - Drawdown availed till date', inr(S.finance.securedEstimated), inr(S.finance.securedEstimated), '0.00'],
        ['3', 'Total Borrowed Funds (Unsecured) - Drawdown availed till date', inr(S.finance.unsecuredEstimated), inr(S.finance.unsecuredEstimated), '0.00'], ['4', 'Customer Receipts used for project', inr(S.finance.customerEstimated), inr(S.finance.customerEstimated), inr(F.tableF.customer)],
        ['5', 'Total Funds for project', inr(F.estTotal), inr(F.estTotal), inr(F.incTotal)], ['6', 'Total Estimated Cost (as per Table A)', inr(F.estTotal), inr(F.estTotal), inr(F.estTotal)]], bold: [4, 5] } },
    { h: 'Table G - Any Comments/Observations of CA', size: 10 },
    { table: { widths: [1.4, 15.6], rows: (S.comments || []).map((c, i) => [String(i + 1), c]) } },
    { p: 'Yours Faithfully,', right: true }, { p: `\n\nSignature of Chartered Accountant\n(UDIN: ______________ and Membership Number: ${S.ca.membership})\nName: ${S.ca.firm}`, right: true },
    { p: `Agreed and accepted by:\n\n\nSignature of Promoter:\nName: ${S.promoter.toUpperCase()}\nDate: ____________` }];
  return require('./docx-write').write({ blocks, topCm: n(S.letterheadCm) || 4.5 });
}
const FORMS = { 1: { fn: docForm1, file: 'Form 1 Architect' }, 2: { fn: docForm2, file: 'Form 2 Engineer' }, 3: { fn: docForm3, file: 'Form 3 CA' } };
const fileName = (M, what, ext) => `Dream Signature RERA ${what} ${M.qe}.${ext}`;

// ---- page data (what the RERA filings panel shows) ----
async function status(qe) {
  const list = quarterEnds(); if (!qe || !list.includes(qe)) qe = list[0];
  const M = await build(qe);
  const lastSent = await db.q("select key, done_at, info from job_marks where key like 'rera-pack:%' or key like 'rera-pack-test:%' order by done_at desc limit 4");
  return {
    quarters: list.map((q) => ({ end: q, label: quarterLabel(q) })), qe, label: M.label, settings: M.settings, lines: LINES, short: SHORT, f1a: F1A, f1b: F1B,
    F3: M.F3, F2: M.F2, est: M.est, incurred: M.cost.total, since: M.cost.since, heads: M.cost.heads,
    units: { sold: M.units.sold.length, booked: M.units.booked.length, unsold: M.units.unsold.length, rehab: M.units.rehab.length, buildings: M.units.buildings, above: M.units.above, maxFloor: M.units.maxFloor },
    progress: { towers: M.progress.towers, stages: M.progress.stages, slabText: M.progress.slabText },
    bank: M.bank.accounts.map((a) => ({ account: a.account, role: a.role, opening: a.opening, deposits: a.deposits, withdrawals: a.withdrawals, closing: a.closing })), outside: M.bank.outside.length, outsideAmt: r2(M.bank.outside.reduce((a, x) => a + x.amount, 0)),
    F5: { label: M.F5.fy.label, collections: M.F5.collections, deposits: M.F5.designated.deposits, withdrawals: M.F5.designated.withdrawals, outside: M.F5.outside.length },
    checks: M.checks, sent: lastSent.map((r) => ({ q: r.key.slice(r.key.indexOf(':') + 1), at: r.done_at, ...r.info })),
  };
}

// ---- send the quarter's pack to the CA (the Excel file and the three Word drafts) ----
const live = () => process.env.ERP_LIVE === '1';
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
async function send({ qe, force = false, user = null } = {}) {
  qe = qe || quarterEnds()[0];
  const key = (live() ? 'rera-pack:' : 'rera-pack-test:') + qe;
  if (!force && await db.one('select 1 as x from job_marks where key = $1', [key])) return { skipped: `The RERA pack for the quarter ending ${fmtD(qe)} was sent already.` };
  const mailer = require('./mailer');
  if (!mailer.configured()) return { skipped: 'The sending email account is not connected to the ERP yet.' };
  const M = await build(qe), S = M.settings;
  const pack = (await db.one("select value from settings where key = 'ca_pack'"))?.value || {};
  const letters = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  const to = live() ? emails(S.ca.email || pack.to || 'ca.shafisiddiqui@gmail.com') : emails(letters.testEmail).slice(0, 1);
  if (!to.length) return { skipped: live() ? 'Set the CA\'s email address in the RERA settings first.' : 'This is the test version: set a test email address in Letter settings. The pack goes only there until the ERP is live.' };
  const F = M.F3;
  const text = `Dear Sir,\n\nPlease find attached the MahaRERA figures for Dream Signature (${S.regNo}) for the quarter ${M.label}, ending ${fmtD(qe)}:\n\n`
    + `1. The Excel working: quarterly progress report, Form 3 working (Tables A to F), Table C flat-wise, Form 1 and Form 2 figures, Form 5 for ${M.F5.fy.label} to date, every entry on the RERA accounts, and the payments counted in cost incurred.\n`
    + `2. Word drafts of Form 3 (for your letterhead), Form 1 (for the architect) and Form 2 (for the engineer).\n\n`
    + `Estimated cost: Rs. ${inr(F.estTotal)}\nCost incurred to date: Rs. ${inr(F.incTotal)} (${F.pct}%)\nWithdrawn from the designated account to date: Rs. ${inr(F.withdrawn)}\nUnits sold ${M.units.sold.length}, booked ${M.units.booked.length}, unsold ${M.units.unsold.length}\n`
    + (M.checks.length ? `\nPoints to check:\n${M.checks.map((c) => '- ' + c).join('\n')}\n` : '') + `\nPlease check and let us know of any changes.\n\nWarm regards,\nAccounts, Dream India`;
  const X = 'application/vnd.openxmlformats-officedocument.', conn = await mailer.connect();
  try {
    await conn.send({ to, cc: live() ? emails(pack.cc) : [], subject: `Dream Signature MahaRERA figures: quarter ending ${fmtD(qe)}${live() ? '' : ' [TEST]'}`, text,
      attachments: [{ filename: fileName(M, 'working', 'xlsx'), content: excel(M), type: X + 'spreadsheetml.sheet' },
        ...[3, 1, 2].map((k) => ({ filename: fileName(M, FORMS[k].file, 'docx'), content: FORMS[k].fn(M), type: X + 'wordprocessingml.document' }))] });
  } finally { await conn.close().catch(() => {}); }
  const info = { to, test: !live(), by: user ? user.name : 'schedule' };
  await db.q('insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()', [key, info]);
  await require('./audit').record(db.q, { user, action: 'rera-pack', entity: 'rera', entityId: qe, after: info });
  return { sent: true, qe, ...info };
}
// the morning job: from the 3rd of the month after a quarter ends, until it has gone
async function morning(d = today()) {
  const m = +d.slice(5, 7), day = +d.slice(8, 10);
  if (![1, 4, 7, 10].includes(m) || day < 3) return { skipped: 'not a quarter month' };
  const S = await settings(); if (S.autoSend === false) return { skipped: 'off' };
  return send({ qe: quarterEnds(d)[0] });
}

module.exports = { build, status, excel, docForm1, docForm2, docForm3, FORMS, fileName, settings, saveSettings, headMap, saveHeadMap, suggest, send, morning, quarterEnds, LINES, SHORT, DEFAULTS };
