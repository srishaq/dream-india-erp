// Feasibility (any project type): what the land can carry under the development rules (FSI, fungible, premium FSI,
// TDR bought or generated), how that splits into rehab and sale, what it costs (construction, premiums and charges,
// rent, corpus and shifting, fees, marketing, finance) and what it earns, and so the profit, margin, IRR and a
// go / no-go call. A project keeps as many options as it likes (table feasibility), each its own set of inputs.
//
// The SRA model follows the 33(10) feasibility model used in Mumbai (rehab component, PAP by density, incentive by the
// land-rate to construction-rate ratio, fungible on the sale side, on-site FSI cap with the balance as TDR).
// Redevelopment adds the 33(7)(B) incentive and the members' new area; new development is basic + premium + TDR +
// fungible. Every rule is a starting figure from the state's pack (RULES below) that the company can change for its
// state (settings key 'feas_rules') and that each option can change again. Figures are estimates for a decision,
// to be confirmed by the project's architect and liaison consultant.
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const SQFT = 10.7639; // sq ft in a sq m
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) ? 0 : +v);
const has = (v) => !(v === '' || v == null || !Number.isFinite(+v));

// ---- the rules, by state ----
// Maharashtra: DCPR 2034 (Greater Mumbai). Road-width table: regulation 30, Table 12, residential, suburbs and
// extended suburbs: basic FSI, additional FSI on payment of premium, admissible TDR. Fungible (compensatory) FSI
// 35% under regulation 31(3). SRA under 33(10); society redevelopment incentive under 33(7)(B).
const MH_ROADS = [
  { key: 'lt9', label: 'Below 9 m', basic: 1.0, premium: 0, tdr: 0 },
  { key: '9to12', label: '9 m to below 12 m', basic: 1.0, premium: 0.5, tdr: 0.5 },
  { key: '12to18', label: '12 m to below 18 m', basic: 1.0, premium: 0.5, tdr: 0.7 },
  { key: '18to27', label: '18 m to below 27 m', basic: 1.0, premium: 0.5, tdr: 0.9 },
  { key: '27up', label: '27 m and above', basic: 1.0, premium: 0.5, tdr: 1.0 },
];
// the standard figures every option starts from (Maharashtra values; other states change what differs)
const BASE = {
  // FSI and areas
  basicFSI: 1, premiumFSI: 0.5, tdrFSI: 0.7, fungPct: 0.35, commShare: 0, saleLoad: 0.8, rehabLoad: 0.35, effPct: 0.935,
  // SRA 33(10)
  // rehab component per home: 27.88 sq m carpet × 1.2 built-up × 1.5 ≈ 50 sq m (the client picks 40, 45, 48 or 50); amenity
  // built-up area × compFactor; no FSI cap on the plot under DCPR 2034 (0 = no cap; a cap moves the excess off as TDR)
  raRes: 50, raComm: 50, compFactor: 1.5, density: 650, fsiCap: 0, bgVal: 450000, bgPct: 0.02, corpusRate: 40000,
  // redevelopment 33(7)(B): the larger of 15% of the existing built-up area or 10 sq m per tenement
  redevIncPct: 0.15, redevIncPerTen: 10,
  // premiums and charges, as a share of the ASR (ready reckoner) open land rate unless said
  premPct: 0.5, fungRes: 0.5, fungComm: 0.6, infraPct: 0.02, devLandPct: 0.01, devResPct: 0.04, devCommPct: 0.08, cessPct: 0.01,
  waterRate: 385, pcoRate: 33, lucPct: 0.0169, lucYears: 3, landscapeRate: 600, tdrRealise: 0.55,
  // TDR for land handed over free (road set-back, amenity plot): this many times its area (DCPR 2034: 2)
  setbackFactor: 2,
  // Reg. 33(11) (DCPR 2034): FSI on the whole plot; above the zonal FSI, this share is free sale and the rest is earned
  // by PTC (project tenements) built elsewhere or bought from another scheme and handed over
  fsi3311: 3, freeShare: 0.5,
  // rent, shifting, fees and overheads
  rentMonths: 24, rentEsc: 0.1, rentBrok: 0, shiftRate: 20000, shiftTimes: 2, rentGst: 0.08, contPct: 0.05,
  // one-time payments worked out when the box is left blank (starting estimates; the architect's or consultant's figure
  // replaces them): open space deficiency and staircase / lift / lobby premiums as a share of the ASR land rate, the fire
  // (CFO) scrutiny fee per sq m built, environment clearance above 20,000 sq m built, Annexure-II certification per
  // eligible tenement, legal charges, and the average borrowing as a share of the peak funding
  osdPct: 0.05, stairPct: 0.006, cfoRate: 200, moefFee: 5000000, moefMin: 20000, annexRate: 150000, legalFee: 500000,
  archPct: 0.05, archGst: 0.18, mktPct: 0.05, mktGst: 0.18, ohPct: 0.03, miscPct: 0.02, debtRate: 0.14, debtYears: 0, years: 4,
  // the call: margin on cost for "go", the lowest margin worth a careful look, the IRR wanted, the discount rate
  target: 0.25, amber: 0.15, hurdle: 0.18, disc: 0.12,
};
const RULES = {
  Maharashtra: { full: true, code: 'DCPR 2034 (Greater Mumbai)', roads: MH_ROADS, road: '12to18', base: {},
    note: 'Starting figures from DCPR 2034: road-width table (regulation 30, Table 12, suburbs), 35% fungible (31(3)), SRA 33(10), society redevelopment 33(7)(B). Island city, MMR and Pune (UDCPR) plots differ: change the FSI figures to what your architect gives.' },
  Telangana: { code: 'GHMC building rules', base: { basicFSI: 2.5, premiumFSI: 0, tdrFSI: 0, fungPct: 0, premPct: 0, fungRes: 0, fungComm: 0, infraPct: 0, devResPct: 0, devCommPct: 0, lucPct: 0, setbackFactor: 0 },
    note: 'Telangana has no fixed FSI cap: the built-up area follows setbacks and height. Enter the built-up area your architect\'s plan allows as FSI (built-up area ÷ plot area). TDR (from road widening) can be added as TDR FSI.' },
};
const GENERIC = { code: 'Your state\'s building rules', base: { premiumFSI: 0, tdrFSI: 0, fungPct: 0, premPct: 0, fungRes: 0, fungComm: 0, lucPct: 0, setbackFactor: 0 },
  note: 'The ERP does not hold this state\'s FSI rules yet. Enter the basic FSI, any extra FSI on premium and TDR your architect gives, and the charges your authority levies.' };

// the rules for a project's state, with the company's own changes for that state on top
// SRA rules exist only in Maharashtra: an SRA project elsewhere still starts from them
async function rules(state, q = db.one, kind = null) {
  const r = kind === 'sra' && !(RULES[state] || {}).full ? RULES.Maharashtra : RULES[state] || GENERIC;
  let own = {};
  try { const s = await q("select value from settings where key = 'feas_rules'"); own = (s && s.value && s.value[state || '-']) || {}; } catch { own = {}; }
  const assume = { ...BASE, ...r.base, ...clean(own) };
  return { state: state || null, code: r.code, note: r.note, full: !!r.full, roads: r.roads || [], road: r.road || null, assume, base: { ...BASE, ...r.base }, own: Object.keys(clean(own)) };
}
const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => k in BASE && has(v)).map(([k, v]) => [k, +v]));

// ---- the model ----
// how the money is spread over the project's 3, 4 or 5 years (percent of each bucket in each year): land and premiums
// first, rehab and rent early, the sale building and sales later. Used for the cash flow, IRR, NPV, peak funding and interest.
const PHASES = {
  3: { land: [100, 0, 0], prem: [60, 30, 10], reh: [40, 45, 15], rr: [50, 30, 20], sale: [20, 45, 35], prof: [35, 35, 30], fc: [25, 40, 35], rev: [10, 40, 50] },
  4: { land: [100, 0, 0, 0], prem: [55, 25, 15, 5], reh: [35, 50, 15, 0], rr: [40, 35, 25, 0], sale: [10, 30, 35, 25], prof: [30, 25, 25, 20], fc: [15, 25, 30, 30], rev: [5, 25, 35, 35] },
  5: { land: [100, 0, 0, 0, 0], prem: [50, 25, 15, 10, 0], reh: [35, 50, 15, 0, 0], rr: [40, 40, 20, 0, 0], sale: [0, 15, 30, 35, 20], prof: [25, 20, 20, 20, 15], fc: [10, 20, 20, 25, 25], rev: [0, 15, 25, 30, 30] },
};
const yearsOf = (a) => (PHASES[Math.round(a.years)] ? Math.round(a.years) : 4);
const PHASING = PHASES[4];
const BANDS = [[0, 1.15], [2, 1.0], [4, 0.9], [6, 0.8]]; // SRA incentive by LR/RC (up to 2: 1.15, as the consultant's 33(10) report uses)
function irr(cfs) {
  const npv = (r) => cfs.reduce((s, c, i) => s + c / Math.pow(1 + r, i + 1), 0);
  if (!cfs.some((c) => c < 0) || !cfs.some((c) => c > 0)) return null;
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (npv(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// the lines of premiums and charges: key, label, which project types have them
const PREM = [
  ['land', 'Land cost or settlement with the earlier owner', 'all'],
  ['premFSI', 'Premium for the additional FSI', 'new redevelopment'],
  ['tdrBuy', 'TDR bought', 'new redevelopment'],
  ['ptc', 'PTC tenements bought or built elsewhere (33(11))', 'sra new'],
  ['unearned', 'Un-earned charges (33(11))', 'sra new'],
  ['fung', 'Fungible FSI premium', 'all'],
  ['infra', 'Infrastructure charges', 'all'],
  ['devLand', 'Development charges on the land', 'all'],
  ['devRes', 'Development charges on the residential area', 'all'],
  ['devComm', 'Development charges on the commercial area', 'all'],
  ['cess', 'Labour welfare cess', 'all'],
  ['water', 'Water and sewerage charges', 'all'],
  ['pco', 'Pest control (PCO) charges', 'all'],
  ['luc', 'Assessment / land under construction tax', 'all'],
  ['bg', 'Bank guarantee charges', 'all'],
  ['corpus', 'Maintenance corpus for the rehab homes (SRA)', 'sra'],
  ['osd', 'Open space deficiency premium', 'all'],
  ['stair', 'Staircase, lift and lobby premium', 'all'],
  ['cfo', 'CFO (fire) scrutiny fees', 'all'],
  ['moef', 'MoEF (environment) clearance', 'all'],
  ['aviation', 'Civil aviation NOC', 'all'],
  ['annex', 'Annexure-II certification', 'sra'],
  ['plumbing', 'Plumbing and sanitary charges', 'all'],
  ['prorata', 'Pro-rata charges for road set-back', 'all'],
  ['legal', 'Legal charges', 'all'],
  ['approvals', 'Other approvals, NOCs, stamp duty and liaison', 'all'],
];
// lines that are amounts the client enters (in ₹), not worked out: input key for each
const LUMP = { land: 'landCost', osd: 'osdCost', stair: 'stairCost', cfo: 'cfoCost', moef: 'moefCost', aviation: 'aviationCost', annex: 'annexCost', legal: 'legalCost', approvals: 'approvalsCost',
  unearned: 'unearnedCost', plumbing: 'plumbingCost', prorata: 'prorataCost', bg: 'bgCost', luc: 'assessCost' };
const forKind = (kind) => PREM.filter(([, , k]) => k === 'all' || k.split(' ').includes(kind));

// r: the rules (rules() above): their figures, and the road-width table where the state has one
function compute(kind, inp = {}, r = {}) {
  const i = inp || {}, a = { ...BASE, ...(r.assume || {}), ...clean(i.assume) }, o = i.ovr || {};
  const road = (r.roads || []).find((x) => x.key === (i.road || r.road));
  if (road && kind !== 'sra') Object.assign(a, { basicFSI: road.basic, premiumFSI: road.premium, tdrFSI: road.tdr }, clean(i.assume));
  const R = { kind, warn: [] };
  // land
  R.grossPlot = num(i.grossPlot);
  R.deduct = num(i.roadSetback) + num(i.dpRes) + num(i.amenityPlot) + num(i.retained);
  // Reg. 33(11) (Maharashtra): FSI on the whole plot (the road set-back is not taken off), no road-width table
  R.is3311 = i.scheme === '3311' && (kind === 'sra' || kind === 'new');
  R.netPlot = Math.max(0, R.grossPlot - (R.is3311 ? num(i.retained) : R.deduct));
  R.netHa = R.netPlot / 10000;
  const asr = num(i.asrLand);

  // ---- development potential (sq m of built-up area) ----
  R.basicFSI = has(i.basicFSI) ? +i.basicFSI : a.basicFSI;
  R.premiumFSI = has(i.premiumFSI) ? +i.premiumFSI : a.premiumFSI;
  R.tdrFSI = has(i.tdrFSI) ? +i.tdrFSI : a.tdrFSI;
  R.rehabBUA = 0; R.tdrGen = 0; R.tdrBuyArea = 0; R.premArea = 0; R.incentive = 0; R.tenements = 0;
  R.ptcArea = 0; R.freeSale = 0;
  if (R.is3311) {
    R.fsiTotal = has(i.fsiTotal) && +i.fsiTotal > 0 ? +i.fsiTotal : a.fsi3311;
    R.basicFSI = Math.min(has(i.basicFSI) ? +i.basicFSI : 1, R.fsiTotal);
    R.basicArea = R.netPlot * R.basicFSI;
    R.fsiArea = R.netPlot * R.fsiTotal;
    R.freeSale = (R.fsiArea - R.basicArea) * a.freeShare;
    R.ptcArea = R.fsiArea - R.basicArea - R.freeSale;
    R.tenements = num(i.ptcNos);
    R.fungArea = R.fsiArea * a.fungPct; R.fungSale = R.fungArea;
    R.saleBUA = R.fsiArea + R.fungArea;
    if (!(num(i.ptcRate) > 0)) R.warn.push('Enter what the PTC tenements cost you per sq m (bought from another scheme, or built elsewhere).');
  } else if (kind === 'sra') {
    R.tenExisting = num(i.tenRes) + num(i.tenComm);
    R.densityUnits = Math.ceil(R.netHa * a.density - 1e-9);
    R.papCalc = Math.max(0, R.densityUnits - R.tenExisting);
    R.pap = num(i.papOverride) > 0 ? num(i.papOverride) : R.papCalc;
    R.tenements = R.tenExisting + R.pap;
    R.amenityComp = num(i.amenityArea) * a.compFactor;
    R.rehabComp = num(i.tenRes) * a.raRes + num(i.tenComm) * a.raComm + R.pap * a.raRes + R.amenityComp;
    // the rehab building counted in the FSI (amenities are free of FSI): the component without its factor
    R.rehabFSI = a.compFactor ? (R.rehabComp - R.amenityComp) / a.compFactor : R.rehabComp;
    R.lrrc = num(i.asrConstr) ? asr / num(i.asrConstr) : 0;
    let band = BANDS[0][1]; for (const [lo, v] of BANDS) if (R.lrrc >= lo) band = v;
    R.incBand = band;
    R.incRatio = num(i.incManual) > 0 ? num(i.incManual) : band;
    R.incBUA = R.rehabComp * R.incRatio;
    // what the plot can hold; the rest of the sale incentive is given as TDR (slum TDR) to sell
    R.cap = R.netPlot * a.fsiCap;
    R.tdrGen = R.cap > 0 ? Math.max(0, R.rehabComp + R.incBUA - R.cap) : 0;
    if (R.tdrGen > R.incBUA) R.warn.push('The rehab component alone is more than the plot can hold at the FSI cap. Check the cap and the plot area with the architect.');
    if (R.tdrGen > 0 && !(num(i.tdrSaleRate) > 0)) R.warn.push('Part of the sale area goes off the plot as TDR, but no price for that TDR is entered, so it earns nothing here. Enter the TDR price, or set the FSI cap to 0.');
    R.saleFSIArea = Math.max(0, R.incBUA - R.tdrGen);
    R.rehabBUA = R.rehabComp;
    R.fsiArea = R.rehabFSI + R.saleFSIArea;
    R.fungSale = R.saleFSIArea * a.fungPct;
    R.fungArea = R.fungSale;
    R.saleBUA = R.saleFSIArea + R.fungSale;
  } else {
    R.basicArea = R.netPlot * R.basicFSI;
    R.premArea = R.netPlot * R.premiumFSI;
    R.tdrBuyArea = R.netPlot * R.tdrFSI;
    if (kind === 'redevelopment') {
      R.tenements = num(i.members) + num(i.shops);
      R.incentive = Math.max(num(i.existingBUA) * a.redevIncPct, R.tenements * a.redevIncPerTen);
      R.newCarpet = has(i.newCarpet) && +i.newCarpet > 0 ? +i.newCarpet : num(i.existingCarpet) * (1 + num(i.extraPct) / 100);
      R.rehabBUA = a.effPct ? R.newCarpet / a.effPct / SQFT : 0; // the members' new flats, as built-up area
    }
    R.fsiArea = R.basicArea + R.premArea + R.tdrBuyArea + R.incentive;
    R.fungArea = R.fsiArea * a.fungPct;
    const all = R.fsiArea + R.fungArea;
    // fungible on the members' own area is free; the premium is paid on the sale share only
    R.fungSale = all ? R.fungArea * Math.max(0, all - R.rehabBUA) / all : 0;
    R.saleBUA = Math.max(0, all - R.rehabBUA);
    if (R.rehabBUA > all && all > 0) R.warn.push('The members\' new area is more than the plot can carry. Lower the extra area offered or add TDR.');
  }
  R.totalBUA = R.rehabBUA + R.saleBUA;
  R.fsiAchieved = R.netPlot ? R.fsiArea / R.netPlot : 0;
  R.fsiWithFung = R.netPlot ? (R.fsiArea + R.fungArea) / R.netPlot : 0;
  R.saleBUAsqft = R.saleBUA * SQFT;
  R.saleRes = R.saleBUA * (1 - a.commShare);
  R.saleComm = R.saleBUA * a.commShare;
  R.saleable = num(i.saleableOverride) > 0 ? num(i.saleableOverride) : R.saleBUAsqft * a.effPct;
  R.saleableRes = R.saleable * (1 - a.commShare);
  R.saleableComm = R.saleable * a.commShare;
  R.saleRehab = R.rehabBUA ? R.saleBUA / R.rehabBUA : 0;
  // construction areas (built-up plus staircases, lifts, parking and services)
  R.saleConSqft = R.saleBUAsqft * (1 + a.saleLoad);
  R.rehabConSqft = R.rehabBUA * SQFT * (1 + (kind === 'sra' ? a.rehabLoad : a.saleLoad));
  R.grossConSqm = (R.saleConSqft + R.rehabConSqft) / SQFT;

  // ---- revenue (rupees) ----
  R.revRes = R.saleableRes * num(i.rateRes);
  R.revComm = R.saleableComm * num(i.rateComm);
  R.revPark = num(i.parkNos) * num(i.parkRate);
  R.revTdr = R.tdrGen * SQFT * num(i.tdrSaleRate);
  // TDR earned for road set-back or amenity handed over, sold at a share of the ASR land rate
  // TDR for the road set-back and amenity plot handed over: as the architect gives it, else the area × the factor
  R.setbackTdrAuto = !has(i.setbackTdr);
  R.setbackTdr = R.setbackTdrAuto ? (R.is3311 ? 0 : (num(i.roadSetback) + num(i.amenityPlot)) * (a.setbackFactor || 0)) : num(i.setbackTdr);
  R.revSetback = R.setbackTdr * asr * a.tdrRealise;
  R.revenue = R.revRes + R.revComm + R.revPark + R.revTdr + R.revSetback;

  // ---- costs (rupees) ----
  // substructure (basements, podium) at its own rate: on the area entered, else the sale building's loading area
  // (parking, services); the rest of the sale construction area is at the superstructure rate
  R.subSqft = num(i.rateSubCon) > 0 ? Math.min(R.saleConSqft, has(i.subArea) ? num(i.subArea) : R.saleBUAsqft * a.saleLoad) : 0;
  R.cSub = R.subSqft * num(i.rateSubCon);
  R.cSale = (R.saleConSqft - R.subSqft) * num(i.rateSaleCon);
  R.cRehab = R.rehabConSqft * num(kind === 'sra' ? i.rateRehabCon : i.rateSaleCon);
  R.cLand = num(i.landscapeArea) * a.landscapeRate;
  R.civil = R.cSale + R.cRehab + R.cSub + R.cLand;
  const auto = {
    land: num(i.landCost),
    premFSI: R.premArea * asr * a.premPct,
    tdrBuy: R.tdrBuyArea * SQFT * num(i.tdrBuyRate),
    fung: R.fungSale * asr * (a.fungRes * (1 - a.commShare) + a.fungComm * a.commShare),
    infra: Math.max(0, R.fsiArea - R.netPlot * R.basicFSI) * a.infraPct * asr,
    devLand: R.netPlot * a.devLandPct * asr,
    devRes: R.saleRes * a.devResPct * asr,
    devComm: R.saleComm * a.devCommPct * asr,
    cess: R.civil * a.cessPct,
    water: R.grossConSqm * a.waterRate,
    pco: R.grossConSqm * a.pcoRate,
    ptc: R.ptcArea * num(i.ptcRate),
    corpus: kind === 'sra' && !R.is3311 ? R.tenements * a.corpusRate : 0,
  };
  // the one-time payments: as entered, else an estimate where there is a sound basis (land and the airport NOC and
  // other approvals depend on the site, so a blank there stays 0)
  const est = {
    osd: kind === 'new' ? 0 : R.grossPlot * asr * a.osdPct,
    stair: R.saleBUA * asr * a.stairPct,
    cfo: R.grossConSqm * a.cfoRate,
    moef: R.grossConSqm >= a.moefMin ? a.moefFee : 0,
    annex: kind === 'sra' ? (R.tenExisting || 0) * a.annexRate : 0,
    legal: a.legalFee,
    luc: R.netPlot * asr * a.lucPct * a.lucYears,
    bg: kind === 'sra' || R.is3311 ? R.tenements * a.bgVal * a.bgPct : 0,
  };
  R.lumpEst = est; R.lumpIsEst = {};
  for (const [k, key] of Object.entries(LUMP)) { if (has(i[key])) auto[k] = num(i[key]); else { auto[k] = est[k] || 0; if (est[k]) R.lumpIsEst[k] = true; } }
  R.prem = {}; R.premAuto = auto; R.premOwn = {};
  for (const [k] of forKind(kind)) { const own = has(o[k]) && !(k in LUMP); R.prem[k] = own ? +o[k] : auto[k]; if (own) R.premOwn[k] = true; }
  R.premTotal = Object.values(R.prem).reduce((s, v) => s + v, 0);
  // rent for the transit period, rising each year, plus brokerage months; shifting; corpus (redevelopment)
  const F = Math.floor(a.rentMonths / 12), rem = a.rentMonths - 12 * F;
  R.rentMult = 12 * (a.rentEsc === 0 ? F : (Math.pow(1 + a.rentEsc, F) - 1) / a.rentEsc) + rem * Math.pow(1 + a.rentEsc, F) + a.rentBrok;
  if (kind === 'sra' && !R.is3311) {
    // families on rent: as entered (the survey may count more than the eligible), else the eligible homes and shops
    const fam = num(i.rentNos) > 0 ? num(i.rentNos) : num(i.tenRes);
    R.rent = (fam * num(i.rentRes) + num(i.tenComm) * num(i.rentComm)) * R.rentMult;
    R.shift = (fam + num(i.tenComm)) * a.shiftRate * a.shiftTimes;
    R.memberCorpus = 0;
  } else if (kind === 'redevelopment') {
    R.rent = R.tenements * num(i.rentRes) * R.rentMult;
    R.shift = R.tenements * (has(i.shiftPer) ? +i.shiftPer : a.shiftRate) * a.shiftTimes;
    R.memberCorpus = R.tenements * num(i.corpusPer);
  } else { R.rent = 0; R.shift = 0; R.memberCorpus = 0; }
  R.rentGst = (R.rent + R.shift) * a.rentGst;
  R.rehabRel = R.rent + R.shift + R.rentGst + R.memberCorpus + num(i.societyCost);
  // fees, marketing, overheads, finance, contingency
  R.arch = R.civil * a.archPct; R.archGst = R.arch * a.archGst;
  R.mkt = R.revenue * a.mktPct * (1 + a.mktGst);
  R.oh = R.revenue * (a.ohPct + a.miscPct);
  // the average borrowing: as entered, else a share of the peak funding of the cash flow without interest
  // interest: on the borrowing entered, for the borrowing period (blank: the whole project); else worked out year by
  // year on the money out of pocket through the year, from the cash flow without interest
  R.years = yearsOf(a); R.debtYears = a.debtYears > 0 ? a.debtYears : R.years;
  R.debtAuto = !has(i.debtAmt);
  if (R.debtAuto) {
    const b0 = R.civil + R.premTotal + R.rehabRel + R.arch + R.archGst + R.mkt + R.oh;
    const c0 = has(i.contingency) ? num(i.contingency) : b0 * a.contPct;
    // the money owed through each year: the average of the year's opening and closing balance
    const cum = flowCum(R, a, 0, c0), owed = cum.map((c, k) => (Math.max(0, -(k ? cum[k - 1] : 0)) + Math.max(0, -c)) / 2);
    R.finance = owed.reduce((x, v) => x + v, 0) * a.debtRate;
    R.debt = Math.round(owed.reduce((x, v) => x + v, 0) / R.years / 1e5) * 1e5; R.debtYears = R.years;
  } else { R.debt = num(i.debtAmt); R.finance = R.debt * a.debtRate * R.debtYears; }
  const before = R.civil + R.premTotal + R.rehabRel + R.arch + R.archGst + R.mkt + R.oh + R.finance;
  // contingency: the amount entered, else a share of every other cost
  R.contAuto = !has(i.contingency);
  R.cont = R.contAuto ? before * a.contPct : num(i.contingency);
  R.soft = R.arch + R.archGst + R.mkt + R.oh + R.finance + R.cont;
  R.total = R.civil + R.premTotal + R.rehabRel + R.soft;
  R.profit = R.revenue - R.total;
  R.margin = R.total ? R.profit / R.total : 0;
  R.marginRev = R.revenue ? R.profit / R.revenue : 0;
  R.costPsf = R.saleable ? R.total / R.saleable : 0;
  R.profitPsf = R.saleable ? R.profit / R.saleable : 0;
  R.rehabPerTen = R.tenements ? (R.cRehab + R.rehabRel + (R.prem.corpus || 0) + (R.prem.bg || 0)) / R.tenements : 0;
  // the sale rate that breaks even, and the one that gives the target margin; the most the land can cost
  R.revLink = a.mktPct * (1 + a.mktGst) + a.ohPct + a.miscPct;
  // a contingency worked out as a share of the costs grows with the revenue-linked costs too
  const Lk = R.revLink * (R.contAuto ? 1 + a.contPct : 1);
  const fixed = R.total - Lk * R.revenue, other = R.revComm + R.revPark + R.revTdr + R.revSetback, t = a.target;
  R.breakeven = R.saleableRes ? Math.max(0, (fixed / (1 - Lk) - other) / R.saleableRes) : 0;
  const revT = (1 + t) * fixed / (1 - (1 + t) * Lk);
  R.minRate = R.saleableRes ? Math.max(0, (revT - other) / R.saleableRes) : 0;
  // the interest worked out from the cash flow moves with the sale rate too: refine both rates on the full model
  if (R.debtAuto && R.saleableRes && !inp.noSolve) {
    const solve = (x0, f) => {
      let x1 = x0 * 1.05 + 1, f0 = f(x0), f1 = f(x1);
      for (let k = 0; k < 8 && Math.abs(f1) > 1e-6 && f1 !== f0; k++) { const x2 = x1 - f1 * (x1 - x0) / (f1 - f0); x0 = x1; f0 = f1; x1 = Math.max(0, x2); f1 = f(x1); }
      return x1;
    };
    const at = (x) => compute(kind, { ...inp, rateRes: x, noSolve: 1 }, r);
    if (R.breakeven) R.breakeven = solve(R.breakeven, (x) => at(x).profit / 1e7);
    if (R.minRate) R.minRate = solve(R.minRate, (x) => at(x).margin - t);
  }
  R.maxLand = Math.max(0, R.revenue / (1 + t) - (R.total - R.prem.land));
  R.cats = [['Construction', R.civil], ['Land, premiums and charges', R.premTotal], [kind === 'new' ? 'Society and other' : 'Rent, shifting and corpus', R.rehabRel],
    ['Architect and consultants (with GST)', R.arch + R.archGst], ['Marketing and brokerage (with GST)', R.mkt], ['Overheads, finance and contingency', R.oh + R.finance + R.cont]].filter(([, v]) => v);
  // cash flow over the project's years
  const P = PHASES[R.years], landAmt = R.prem.land || 0;
  const buckets = { land: landAmt, prem: R.premTotal - landAmt, reh: R.cRehab, rr: R.rehabRel, sale: R.cSale + R.cSub + R.cLand, prof: R.arch + R.archGst, fc: R.finance + R.cont };
  R.cf = []; let cum = 0; const cums = [];
  for (let y = 0; y < R.years; y++) {
    const rin = R.revenue * P.rev[y] / 100;
    let out = R.revLink * rin;
    for (const k of Object.keys(buckets)) out += buckets[k] * P[k][y] / 100;
    const net = rin - out; cum += net; cums.push(cum);
    R.cf.push({ year: y + 1, inflow: rin, outflow: out, net, cum });
  }
  R.irr = irr(R.cf.map((c) => c.net));
  R.npv = R.cf.reduce((s, c, k) => s + c.net / Math.pow(1 + a.disc, k + 1), 0);
  R.peak = -Math.min(0, ...cums);
  const pb = cums.findIndex((v) => v >= 0); R.payback = pb < 0 ? null : pb + 1;
  // what-if: sale rates and construction costs up or down
  const civLinked = R.civil + (R.premOwn.cess ? 0 : R.prem.cess || 0) + R.arch + R.archGst;
  const fixedOther = R.total - R.revLink * R.revenue - civLinked, revVar = R.revRes + R.revComm;
  const S = [-0.2, -0.1, 0, 0.1, 0.2], C = [-0.1, 0, 0.1, 0.2];
  R.sens = { sale: S, con: C, grid: C.map((c) => S.map((s) => { const rev = revVar * (1 + s) + R.revPark + R.revTdr + R.revSetback; const cost = R.revLink * rev + civLinked * (1 + c) + fixedOther; return cost ? (rev - cost) / cost : 0; })) };
  // the call
  const need = [['grossPlot', 'plot area'], ['asrLand', 'ASR land rate'], ['rateRes', 'sale rate'], ['rateSaleCon', 'construction rate']];
  if (R.is3311) need.push(['ptcRate', 'PTC cost per sq m']);
  else if (kind === 'sra') need.push(['tenRes', 'eligible residential tenements'], ['asrConstr', 'ASR construction rate'], ['rateRehabCon', 'rehab construction rate'], ['rentRes', 'transit rent']);
  if (kind === 'redevelopment') need.push(['members', 'members'], ['existingCarpet', 'members\' existing carpet area'], ['rentRes', 'rent per member']);
  R.missing = need.filter(([k]) => !(num(i[k]) > 0)).map(([, l]) => l);
  R.target = a.target; R.amber = a.amber; R.hurdle = a.hurdle;
  if (R.missing.length) R.status = 'INCOMPLETE';
  else if (R.margin >= a.target && (R.irr == null ? -1 : R.irr) >= a.hurdle) R.status = 'GO';
  else if (R.margin >= a.amber) R.status = 'CAUTION';
  else R.status = 'NO-GO';
  R.assume = a; R.road = road ? road.key : null;
  return R;
}
const VERDICT = { GO: 'Go ahead', CAUTION: 'Go carefully', 'NO-GO': 'Do not go ahead at these figures', INCOMPLETE: 'Fill in the missing figures' };
function why(R) {
  const p = (v) => (v * 100).toFixed(1) + '%';
  if (R.status === 'INCOMPLETE') return 'Still needed: ' + R.missing.join(', ') + '.';
  if (R.status === 'GO') return `Margin ${p(R.margin)} on cost is above the ${p(R.target)} target, and the IRR (${p(R.irr)}) is above ${p(R.hurdle)}.`;
  if (R.status === 'CAUTION') return R.margin >= R.target ? `Margin ${p(R.margin)} meets the target, but the IRR (${R.irr == null ? 'none' : p(R.irr)}) is below ${p(R.hurdle)}: money is tied up too long.` : `Margin ${p(R.margin)} on cost is below the ${p(R.target)} target but above ${p(R.amber)}. Negotiate the land or society terms, or check the sale rate.`;
  return `Margin ${p(R.margin)} on cost is below ${p(R.amber)}. At these figures the project does not pay for its risk.`;
}

// ---- the options of a project ----
// the running total at each year's end of the project's spread, for a given interest and contingency (to work out interest)
function flowCum(R, a, fin, cont) {
  const P = PHASES[yearsOf(a)], landAmt = R.prem.land || 0, revLink = a.mktPct * (1 + a.mktGst) + a.ohPct + a.miscPct;
  const buckets = { land: landAmt, prem: R.premTotal - landAmt, reh: R.cRehab, rr: R.rehabRel, sale: R.cSale + R.cSub + R.cLand, prof: R.arch + R.archGst, fc: fin + cont };
  let cum = 0; const out = [];
  for (let y = 0; y < P.rev.length; y++) {
    const rin = R.revenue * P.rev[y] / 100;
    let o = revLink * rin;
    for (const k of Object.keys(buckets)) o += buckets[k] * P[k][y] / 100;
    cum += rin - o; out.push(cum);
  }
  return out;
}
async function project(id) {
  const p = await db.one('select id, code, name, kind, state, sample, active from projects where id = $1', [+id || 0]);
  if (!p || !p.active) throw fail(404, 'This project is not in the ERP.');
  return p;
}
const MAXIN = 20000;
function cleanInputs(x) {
  const out = {};
  for (const [k, v] of Object.entries(x && typeof x === 'object' ? x : {})) {
    if (!/^[A-Za-z]{1,30}$/.test(k)) continue;
    if (k === 'assume' || k === 'ovr') { out[k] = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([kk, vv]) => /^[A-Za-z]{1,30}$/.test(kk) && has(vv)).map(([kk, vv]) => [kk, +vv])); continue; }
    if (k === 'notes' || k === 'road' || k === 'village' || k === 'cts' || k === 'scheme') { out[k] = String(v == null ? '' : v).slice(0, 2000); continue; }
    if (v === '' || v == null) continue;
    if (!has(v)) throw fail(400, `${k} should be a number.`);
    if (+v < 0 || +v > 1e13) throw fail(400, `${k} is out of range.`);
    out[k] = +v;
  }
  if (JSON.stringify(out).length > MAXIN) throw fail(400, 'Too many figures in one option.');
  return out;
}
const summary = (R) => ({ status: R.status, verdict: VERDICT[R.status], revenue: R.revenue, total: R.total, profit: R.profit, margin: R.margin, irr: R.irr, fsi: R.fsiAchieved, saleable: R.saleable, tdrGen: R.tdrGen, tdrBuy: R.tdrBuyArea });
// an opportunity (a site with no project yet) stands in for a project: same options, same figures
async function site(id, q = db.one) {
  const s = await q('select id, name, kind, state, city, notes, project_id, active from feas_sites where id = $1', [+id || 0]);
  if (!s || !s.active) throw fail(404, 'This opportunity is not in the ERP.');
  return { ...s, site: true, sample: false };
}
const own = (p) => (p.site ? 'site_id' : 'project_id');
async function list(p, q = db.q) {
  const r = await rules(p.state, db.one, p.kind);
  const rows = await q('select f.id, f.name, f.inputs, f.updated_at, u.name as by_name from feasibility f left join users u on u.id = coalesce(f.updated_by, f.created_by) where f.' + own(p) + ' = $1 order by f.id', [p.id]);
  return { rules: r, list: rows.map((x) => ({ id: x.id, name: x.name, updated_at: x.updated_at, by: x.by_name || '', cts: x.inputs.cts || '', plot: x.inputs.grossPlot || null, ...summary(compute(p.kind, x.inputs, r)) })) };
}
async function one(p, id, q = db.one) {
  const x = await q(`select * from feasibility where id = $1 and ${own(p)} = $2`, [+id || 0, p.id]);
  if (!x) throw fail(404, `That option is not in this ${p.site ? 'opportunity' : 'project'}.`);
  return x;
}
async function save(t, u, p, b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw fail(400, 'Give the option a name, for example "Option A: buy TDR".');
  const inputs = cleanInputs(b.inputs);
  if (b.id) {
    const before = await one(p, b.id, t.one);
    const after = await t.one(`update feasibility set name = $3, inputs = $4, updated_by = $5, updated_at = now() where id = $1 and ${own(p)} = $2 returning *`, [before.id, p.id, name, JSON.stringify(inputs), u.id]);
    return { before, after };
  }
  const n = await t.one(`select count(*)::int as n from feasibility where ${own(p)} = $1`, [p.id]);
  if (n.n >= 50) throw fail(400, `${p.site ? 'An opportunity' : 'A project'} keeps at most 50 options. Remove old ones first.`);
  const after = await t.one(`insert into feasibility (${own(p)}, name, inputs, created_by) values ($1, $2, $3, $4) returning *`, [p.id, name, JSON.stringify(inputs), u.id]);
  return { before: null, after };
}

// figures from the project's own screens: the SRA register, the society members, the land parcels
// the company's opportunities, each with its options worked out (for the list and the side-by-side comparison)
async function sites(q = db.q) {
  const rows = await q('select s.id, s.name, s.kind, s.state, s.city, s.notes, s.project_id, p.name as project_name, s.created_at from feas_sites s left join projects p on p.id = s.project_id where s.active order by s.id desc');
  const opts = await q('select id, site_id, name, inputs, updated_at, created_at from feasibility where site_id is not null order by id');
  const out = [];
  for (const s of rows) {
    const r = await rules(s.state, db.one, s.kind);
    const mine = opts.filter((x) => x.site_id === s.id);
    const last = mine.slice().sort((x, y) => new Date(y.updated_at || y.created_at) - new Date(x.updated_at || x.created_at))[0];
    const li = last ? last.inputs : {};
    out.push({ ...s, cts: li.cts || '', village: li.village || '', plot: li.grossPlot || null,
      options: mine.map((x) => ({ id: x.id, name: x.name, ...summary(compute(s.kind, x.inputs, r)) })) });
  }
  return out;
}
const KINDS_OK = ['sra', 'redevelopment', 'new'];
function cleanSite(b) {
  const v = { name: String(b.name || '').trim().slice(0, 120), kind: String(b.kind || 'new'), state: String(b.state || '').trim().slice(0, 40) || null,
    city: String(b.city || '').trim().slice(0, 120) || null, notes: String(b.notes || '').trim().slice(0, 2000) || null };
  if (!v.name) throw fail(400, 'Give the opportunity a name, for example "Oshiwara CTS 446C".');
  if (!KINDS_OK.includes(v.kind)) throw fail(400, 'Choose what it would be: SRA, Redevelopment or New development.');
  if (v.kind === 'sra' && v.state && !/maharashtra/i.test(v.state)) throw fail(400, 'SRA is only in Maharashtra. Choose Redevelopment or New development.');
  return v;
}
// what a new option of an opportunity starts with, from its last option
const CARRY = ['cts', 'village', 'scheme', 'grossPlot', 'roadSetback', 'dpRes', 'amenityPlot', 'retained', 'road', 'asrLand', 'asrConstr', 'tenRes', 'tenComm', 'members', 'shops', 'existingCarpet', 'existingBUA'];
async function fromProject(p, q = db.q) {
  const out = {}, said = [];
  if (p.site) {
    const last = (await q("select inputs from feasibility where site_id = $1 order by updated_at desc nulls last, id desc limit 1", [p.id]))[0];
    if (last) { for (const k of CARRY) if (last.inputs[k] != null && last.inputs[k] !== '') out[k] = last.inputs[k]; if (Object.keys(out).length) said.push('the site details and rates from the last option'); }
    return { inputs: out, said };
  }
  if (p.kind === 'sra') {
    const r = (await q("select count(*) filter (where eligibility in ('free', 'paid') and use in ('residential', 'both'))::int as res, count(*) filter (where eligibility in ('free', 'paid') and use = 'commercial')::int as comm, count(*) filter (where eligibility = 'pending')::int as pending, count(*)::int as n, avg(monthly_rent) filter (where monthly_rent > 0) as rent from sra_dwellers where project_id = $1", [p.id]).catch(() => [{ n: 0 }]))[0];
    if (r.n) { out.tenRes = r.res; out.tenComm = r.comm; if (r.rent) out.rentRes = Math.round(+r.rent); said.push(`${r.res} eligible homes and ${r.comm} shops from the slum dwellers register${r.pending ? ` (${r.pending} still pending, not counted)` : ''}`); }
  } else if (p.kind === 'redevelopment') {
    const r = (await q("select count(*) filter (where use = 'residential')::int as res, count(*) filter (where use = 'commercial')::int as comm, sum(old_carpet_sqft) as old, sum(new_carpet_sqft) as nw, count(new_carpet_sqft)::int as nn, avg(monthly_rent) filter (where monthly_rent > 0) as rent, avg(corpus) filter (where corpus > 0) as corpus from redev_members where project_id = $1", [p.id]).catch(() => [{ res: 0, comm: 0 }]))[0];
    if (r.res + r.comm) {
      Object.assign(out, { members: r.res, shops: r.comm, existingCarpet: Math.round(+r.old || 0) });
      if (r.nn === r.res + r.comm && +r.nw) out.newCarpet = Math.round(+r.nw);
      if (r.rent) out.rentRes = Math.round(+r.rent); if (r.corpus) out.corpusPer = Math.round(+r.corpus);
      said.push(`${r.res} flats and ${r.comm} shops, ${Math.round(+r.old || 0).toLocaleString('en-IN')} sq ft of existing carpet area from the members list`);
    }
  }
  const parcels = await q('select area, area_unit, cost, stamp_duty, registration_fee from land_parcels where project_id = $1', [p.id]).catch(() => []);
  if (parcels.length) {
    const UNITS = { sqm: 1, sqft: 0.09290304, sqyd: 0.83612736, acre: 4046.8564224, hectare: 10000, guntha: 101.17141056, cent: 40.468564224 };
    const sqm = parcels.reduce((s, x) => s + (+x.area || 0) * (UNITS[x.area_unit] || 1), 0);
    const cost = parcels.reduce((s, x) => s + (+x.cost || 0) + (+x.stamp_duty || 0) + (+x.registration_fee || 0), 0);
    if (sqm) { out.grossPlot = Math.round(sqm); said.push(`${Math.round(sqm).toLocaleString('en-IN')} sq m of land from Land and title`); }
    if (cost) { out.landCost = Math.round(cost); said.push(`land cost with stamp duty ₹${(cost / 1e7).toFixed(2)} Cr`); }
  }
  // the CTS number, village and ready reckoner rates already entered in this project's latest option: typed once per project
  const last = (await q("select inputs from feasibility where project_id = $1 order by updated_at desc nulls last, id desc limit 1", [p.id]))[0];
  if (last) { let n = 0; for (const k of ['cts', 'village', 'asrLand', 'asrConstr']) if (last.inputs[k] != null && last.inputs[k] !== '' && out[k] == null) { out[k] = last.inputs[k]; n++; } if (n) said.push('the CTS number, village and ready reckoner rates from the last option'); }
  return { inputs: out, said };
}

// ---- the sample options (Axiom sample projects) ----
const SAMPLE = {
  sra: [['Option A: as per the survey', { grossPlot: 2600, roadSetback: 150, amenityPlot: 0, tenRes: 54, tenComm: 6, amenityArea: 120, asrLand: 128000, asrConstr: 30250,
    rateRes: 26000, rateComm: 32000, parkNos: 40, parkRate: 1000000, rateSaleCon: 4200, rateRehabCon: 3000, rentRes: 15000, rentComm: 18000, tdrSaleRate: 4500,
    approvalsCost: 15000000, contingency: 10000000, landCost: 0, notes: 'Sample: 60 hutments on CTS 446 (sample). Rehab building R1, sale tower A.' }],
  ['Option B: sale rate 15% lower', { grossPlot: 2600, roadSetback: 150, amenityPlot: 0, tenRes: 54, tenComm: 6, amenityArea: 120, asrLand: 128000, asrConstr: 30250,
    rateRes: 22100, rateComm: 27200, parkNos: 40, parkRate: 1000000, rateSaleCon: 4200, rateRehabCon: 3000, rentRes: 15000, rentComm: 18000, tdrSaleRate: 4500,
    approvalsCost: 15000000, contingency: 10000000, notes: 'Sample: what if the market softens.' }]],
  redevelopment: [['Option A: 30% extra area', { grossPlot: 2400, roadSetback: 120, road: '12to18', members: 40, shops: 4, existingCarpet: 26400, existingBUA: 3100, extraPct: 30,
    asrLand: 110000, rateRes: 34000, rateComm: 40000, parkNos: 30, parkRate: 1200000, rateSaleCon: 3600, tdrBuyRate: 4200, rentRes: 35000, corpusPer: 300000, shiftPer: 50000,
    approvalsCost: 12000000, contingency: 8000000, notes: 'Sample: Axiom Heights Co-op Society (sample), 44 members.' }],
  ['Option B: society asks 45% extra area', { grossPlot: 2400, roadSetback: 120, road: '12to18', members: 40, shops: 4, existingCarpet: 26400, existingBUA: 3100, extraPct: 45,
    asrLand: 110000, rateRes: 34000, rateComm: 40000, parkNos: 30, parkRate: 1200000, rateSaleCon: 3600, tdrBuyRate: 4200, rentRes: 40000, corpusPer: 500000, shiftPer: 50000,
    approvalsCost: 12000000, contingency: 8000000, notes: 'Sample: the society\'s counter-offer: more area, higher rent and corpus.' }]],
  new: [['Option A: buy TDR', { grossPlot: 18211, roadSetback: 900, dpRes: 0, road: '18to27', asrLand: 52000, rateRes: 11000, rateComm: 15000, parkNos: 300, parkRate: 500000,
    rateSaleCon: 2600, tdrBuyRate: 2600, landCost: 71130000, approvalsCost: 40000000, contingency: 30000000, notes: 'Sample: survey 112/2A, 112/3 and 113/1 (sample), about 4.5 acres.' }],
  ['Option B: basic and premium FSI only', { grossPlot: 18211, roadSetback: 900, road: '18to27', tdrFSI: 0, asrLand: 52000, rateRes: 11500, rateComm: 15000, parkNos: 220, parkRate: 500000,
    rateSaleCon: 2600, tdrBuyRate: 2600, landCost: 71130000, approvalsCost: 35000000, contingency: 25000000, notes: 'Sample: smaller tower, no TDR bought.' }]],
};
SAMPLE.plotted = [];
async function sample(t, u, p) {
  for (const [name, inputs] of SAMPLE[p.kind] || []) await t.q('insert into feasibility (project_id, name, inputs, created_by) values ($1, $2, $3, $4)', [p.id, name + ' (sample)', JSON.stringify(inputs), u.id]);
}

module.exports = { site, sites, cleanSite, own, CARRY, SQFT, BASE, RULES, MH_ROADS, PREM, LUMP, forKind, PHASING, PHASES, rules, compute, VERDICT, why, project, list, one, save, cleanInputs, summary, fromProject, sample, SAMPLE, fail };
