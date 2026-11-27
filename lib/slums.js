// The slum register of an SRA project (Rafi Sir, 27 Nov 2026, Dream Signature / Goodluck SRA CHS): one row per Annexure II
// tenement. It sits on the SRA tenants Accounts already keep (acc_sra_tenants: annexure / survey no., holder, area, rent,
// status), and adds what an SRA file needs for each tenement (table sra_slum): use, eligibility, consent, the individual
// agreement, when the tenement was vacated, the rehab unit allotted, a mobile number and a remark.
// The tenement's papers are its tenant documents (customer_docs owner_kind 'tenant'); the register shows which of the
// papers every tenement must have are there and which are missing. Rent due and paid comes from Accounts
// (lib/accounts.js, register 'tenants'), so the register never keeps a second copy of the rent.
// Modelled on Zuri's SRA register (lib/sra.js, lib/sra-hut.js), cut down to what Dream Signature has today.
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const USE = { residential: 'Residential', commercial: 'Commercial', res_comm: 'Residential + commercial', amenity: 'Amenity', other: 'Other' };
const ELIG = { eligible: 'Eligible', not_eligible: 'Not eligible', provisional: 'Provisional', pending: 'To check' };
const CONSENT = { given: 'Given', not_given: 'Not given', pending: 'Pending' };
// the papers every tenement must have (tenant document kinds, api/custdocs.js), and what each is called on the register
const NEED = [['Agreement (signed)', 'Individual agreement'], ['KYC: PAN, Aadhaar, photo', 'KYC (PAN, Aadhaar, photo)'], ['Eligibility / annexure papers', 'Eligibility papers (Annexure II extract, proofs)']];
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v) => (v == null || v === '' ? null : +v);

// rows: every tenement of the book, with what the register adds, the papers it has and the rent (when given)
async function view(book, rent = null) {
  const rows = await db.q(`select t.id, t.survey_no, t.name, t.master_name, t.area, t.status, t.monthly_rent, t.list_remark,
      s.use, s.eligibility, s.agreement_on, s.agreement_reg, s.consent, s.vacated_on, s.rehab_unit, s.mobile, s.remark, s.updated_at,
      (select coalesce(json_agg(json_build_object('kind', d.kind, 'n', d.n)), '[]') from (select kind, count(*)::int as n from customer_docs where tenant_id = t.id and status = 'ready' group by kind) d) as docs
    from acc_sra_tenants t left join sra_slum s on s.tenant_id = t.id where t.book = $1 order by t.survey_no nulls last, t.id`, [book]);
  const R = rent ? Object.fromEntries(rent.map((r) => [r.id, r])) : null;
  const d = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const list = rows.map((r) => {
    const have = Object.fromEntries((r.docs || []).map((x) => [x.kind, x.n]));
    const papers = NEED.map(([kind, label]) => ({ kind, label, n: have[kind] || 0 }));
    const x = {
      id: r.id, no: r.survey_no == null ? null : Number(r.survey_no), name: r.name || '', holder: r.master_name || r.name || '', area: num(r.area), status: r.status || '',
      closed: /closed/i.test(r.status || ''), monthly_rent: num(r.monthly_rent),
      use: r.use || '', eligibility: r.eligibility || '', consent: r.consent || '', agreement_on: d(r.agreement_on), agreement_reg: r.agreement_reg || '',
      vacated_on: d(r.vacated_on), rehab_unit: r.rehab_unit || '', mobile: r.mobile || '', remark: r.remark || '',
      papers, docs: (r.docs || []).reduce((a, y) => a + y.n, 0), missing: papers.filter((p) => !p.n).map((p) => p.label),
    };
    if (R && R[r.id]) { const t = R[r.id]; x.rent = { due: +t.due_to_date || 0, paid: +t.paid_total || 0, balance: +t.balance || 0, position: t.position || '' }; }
    return x;
  });
  const n = (f) => list.filter(f).length;
  const summary = {
    total: list.length, active: n((x) => !x.closed), closed: n((x) => x.closed),
    agreements: n((x) => x.papers[0].n), kyc: n((x) => x.papers[1].n), eligibility_papers: n((x) => x.papers[2].n),
    complete: n((x) => !x.missing.length),
    eligible: n((x) => x.eligibility === 'eligible'), not_eligible: n((x) => x.eligibility === 'not_eligible'), provisional: n((x) => x.eligibility === 'provisional'),
    eligibility_unknown: n((x) => !x.eligibility || x.eligibility === 'pending'),
    consent: n((x) => x.consent === 'given'), vacated: n((x) => !!x.vacated_on), allotted: n((x) => !!x.rehab_unit),
    area: list.reduce((a, x) => a + (x.area || 0), 0),
  };
  if (R) { summary.rent_due = list.reduce((a, x) => a + (x.rent ? x.rent.due : 0), 0); summary.rent_paid = list.reduce((a, x) => a + (x.rent ? x.rent.paid : 0), 0); }
  return { list, summary, need: NEED.map(([kind, label]) => ({ kind, label })), labels: { use: USE, eligibility: ELIG, consent: CONSENT } };
}

function date(v, label) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw fail(400, `${label}: give the date as day, month and year.`);
  if (s > today()) throw fail(400, `${label} cannot be after today.`);
  return s;
}
// Saves what the register adds about one tenement. Returns { before, after, tenant }.
async function save(t, u, book, tenantId, x) {
  const ten = await t.one('select id, survey_no, name from acc_sra_tenants where id = $1 and book = $2', [+tenantId || 0, book]);
  if (!ten) throw fail(404, 'That tenement is not on this project\'s register.');
  const pick = (v, map, label) => { const s = str(v, 20); if (!s) return null; if (!map[s]) throw fail(400, `Choose the ${label} from the list.`); return s; };
  const v = {
    use: pick(x.use, USE, 'use'), eligibility: pick(x.eligibility, ELIG, 'eligibility'), consent: pick(x.consent, CONSENT, 'consent'),
    agreement_on: date(x.agreement_on, 'Agreement date'), agreement_reg: str(x.agreement_reg, 80) || null, vacated_on: date(x.vacated_on, 'Vacated on'),
    rehab_unit: str(x.rehab_unit, 40) || null, mobile: str(x.mobile, 20) || null, remark: str(x.remark, 500) || null,
  };
  if (v.mobile && !/^[+\d][\d\s-]{6,19}$/.test(v.mobile)) throw fail(400, 'Mobile: digits only, like 98200 12345.');
  if (v.rehab_unit) {
    const dup = await t.one(`select t.survey_no from sra_slum s join acc_sra_tenants t on t.id = s.tenant_id where t.book = $1 and lower(s.rehab_unit) = lower($2) and s.tenant_id <> $3`, [book, v.rehab_unit, ten.id]);
    if (dup) throw fail(409, `Rehab unit ${v.rehab_unit} is already allotted to annexure no. ${Number(dup.survey_no)}.`);
  }
  const before = await t.one('select * from sra_slum where tenant_id = $1', [ten.id]);
  const after = await t.one(`insert into sra_slum (tenant_id, use, eligibility, agreement_on, agreement_reg, consent, vacated_on, rehab_unit, mobile, remark, updated_by, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    on conflict (tenant_id) do update set use = excluded.use, eligibility = excluded.eligibility, agreement_on = excluded.agreement_on, agreement_reg = excluded.agreement_reg,
      consent = excluded.consent, vacated_on = excluded.vacated_on, rehab_unit = excluded.rehab_unit, mobile = excluded.mobile, remark = excluded.remark,
      updated_by = excluded.updated_by, updated_at = now() returning *`,
    [ten.id, v.use, v.eligibility, v.agreement_on, v.agreement_reg, v.consent, v.vacated_on, v.rehab_unit, v.mobile, v.remark, u.id]);
  return { before, after, tenant: ten };
}

// ---------- Excel ----------
async function sheet(v, projectName) {
  const L = v.labels, money = (x) => (x == null ? '' : Math.round(x));
  const head = ['Annexure no.', 'Holder (as in Annexure II)', 'Name in accounts', 'Area (sq ft)', 'Status', 'Use', 'Eligibility', 'Consent', 'Agreement date', 'Agreement reg. no.', 'Vacated on', 'Rehab unit',
    ...v.need.map((n) => n.label), 'Papers missing', 'Rent due to date', 'Rent paid', 'Mobile', 'Remark'];
  const rows = v.list.map((x) => [x.no, x.holder, x.name, x.area, x.status, L.use[x.use] || '', L.eligibility[x.eligibility] || '', L.consent[x.consent] || '', x.agreement_on || '', x.agreement_reg, x.vacated_on || '', x.rehab_unit,
    ...x.papers.map((p) => (p.n ? 'Yes' : 'Missing')), x.missing.join(', '), x.rent ? money(x.rent.due) : '', x.rent ? money(x.rent.paid) : '', x.mobile, x.remark]);
  return require('./xlsx-write').write([{ name: 'Slum register', rows: [[`${projectName} · slum register · ${today()}`], head, ...rows], widths: [11, 40, 24, 11, 12, 14, 13, 11, 13, 18, 12, 12, 14, 14, 18, 34, 14, 12, 14, 40] }]);
}

module.exports = { USE, ELIG, CONSENT, NEED, view, save, sheet };
