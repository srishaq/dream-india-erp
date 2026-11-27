// The feasibility report of one option (lib/feasibility.js), as a PDF (A4) and as Excel. Both come from the same
// sections: the call, the area statement (FSI and TDR), revenue, costs, rates to watch, what-if, cash flow and the inputs.
// The report carries the company's own name (from Zuri, 27 Nov 2026).
const { MiniPdf, textWidth } = require('./pdf-mini');
const W = require('./xlsx-write');
const F = require('./feasibility');

const SQFT = F.SQFT;
const inr = (n, d = 0) => (n == null || !Number.isFinite(n) ? '-' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const cr = (v) => (v == null || !Number.isFinite(v) ? '-' : 'Rs. ' + inr(v / 1e7, 2) + ' Cr');
const pc = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(1) + '%');
const rs = (v) => (v == null || !Number.isFinite(v) ? '-' : 'Rs. ' + inr(v));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`; };
const KIND = { sra: 'Slum rehabilitation (SRA)', redevelopment: 'Redevelopment', new: 'New development', plotted: 'Plotted development' };
const fileName = (p, x, ext) => `Feasibility - ${p.name} - ${x.name}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100) + '.' + ext;

// the area statement: [label, sq m, sq ft or note]
function areas(p, R, i) {
  const a = R.assume, rows = [];
  const r = (l, sqm, note) => rows.push([l, sqm == null ? '' : inr(sqm, 2), note != null ? note : sqm == null ? '' : inr(sqm * SQFT)]);
  r('Gross plot area', R.grossPlot);
  if (R.is3311) {
    if (R.deduct) rows.push(['Road set-back, DP reservation, amenity (FSI still counted on the whole plot under 33(11))', inr(R.deduct, 2), inr(R.deduct * SQFT)]);
    r('Plot area for FSI', R.netPlot);
    rows.push(['Scheme', '', 'Reg. 33(11), DCPR 2034']);
    rows.push(['FSI permissible', '', String(R.fsiTotal)]);
  } else {
    if (R.deduct) r('Less: road set-back, DP reservation, amenity plot, retained structures', R.deduct);
    r('Net plot area', R.netPlot);
  }
  if (R.is3311) {
    r('Total built-up area permissible', R.fsiArea);
    r(`Zonal FSI ${R.basicFSI}`, R.basicArea);
    r(`Free sale (${pc(a.freeShare)} of the balance)`, R.freeSale);
    r(`Sale in lieu of PTC tenements${num(i.ptcNos) ? ' (' + inr(num(i.ptcNos)) + ' tenements)' : ''}`, R.ptcArea);
    r(`Fungible (${pc(a.fungPct)})`, R.fungArea);
  } else if (p.kind === 'sra') {
    rows.push(['Eligible tenements (residential + commercial)', '', `${inr(num(i.tenRes))} + ${inr(num(i.tenComm))}`]);
    rows.push([`PAP tenements (density ${inr(a.density)} per net hectare)`, '', inr(R.pap)]);
    rows.push(['Rehab tenements in all', '', inr(R.tenements)]);
    if (R.amenityComp) r(`Amenities (balwadi, welfare centre, society office) × ${a.compFactor}`, R.amenityComp);
    r(`Rehab component (${inr(a.raRes)} sq m per home, ${inr(a.raComm)} per shop, with amenities)`, R.rehabComp);
    r('Rehab built-up counted in the FSI (without amenities)', R.rehabFSI);
    rows.push(['Land rate to construction rate (LR/RC) and incentive ratio', '', `${R.lrrc.toFixed(2)}, ratio ${R.incRatio.toFixed(2)}`]);
    r('Sale incentive area', R.incBUA);
    if (R.cap) { r(`Most the plot can hold (FSI cap ${a.fsiCap})`, R.cap); r('TDR generated (sale incentive over the cap)', R.tdrGen); }
    r('Sale FSI area on the plot', R.saleFSIArea);
    r(`Fungible on the sale area (${pc(a.fungPct)})`, R.fungSale);
  } else {
    const road = (F.MH_ROADS.find((x) => x.key === R.road) || {}).label;
    if (road) rows.push(['Road width (sets the FSI figures)', '', road]);
    r(`Basic FSI ${R.basicFSI} on the net plot`, R.basicArea);
    if (R.premArea) r(`Additional FSI on premium ${R.premiumFSI}`, R.premArea);
    if (R.tdrBuyArea) r(`TDR to buy ${R.tdrFSI}`, R.tdrBuyArea);
    if (R.incentive) r(`Redevelopment incentive (larger of ${pc(a.redevIncPct)} of existing built-up or ${a.redevIncPerTen} sq m per member)`, R.incentive);
    r('FSI area in all', R.fsiArea);
    r(`Fungible (${pc(a.fungPct)})`, R.fungArea);
    if (p.kind === 'redevelopment') { rows.push(['Members\' new carpet area (sq ft)', '', inr(R.newCarpet)]); r('Members\' new flats as built-up area', R.rehabBUA); }
  }
  r('Sale built-up area', R.saleBUA);
  rows.push(['FSI used on the plot (without fungible / with fungible)', '', `${R.fsiAchieved.toFixed(2)} / ${R.fsiWithFung.toFixed(2)}`]);
  rows.push(['Saleable RERA carpet area (sq ft)', '', inr(R.saleable)]);
  if (R.rehabBUA) rows.push(['Sale area to rehab area', '', R.saleRehab.toFixed(2)]);
  return rows;
}
const num = (v) => (v == null || v === '' ? 0 : +v || 0);

function sections(p, opt, R, rules) {
  const i = opt.inputs || {}, a = R.assume, S = [];
  S.push({ title: 'The call', cols: ['', ''], rows: [['Result', R.verdict], ['Why', R.why], ['Revenue', cr(R.revenue)], ['Total cost', cr(R.total)], ['Profit', cr(R.profit)],
    ['Margin on cost', pc(R.margin)], ['Margin on revenue', pc(R.marginRev)], ['IRR (standard 7-year spread)', R.irr == null ? '-' : pc(R.irr)], ['NPV at ' + pc(a.disc), cr(R.npv)], ['Peak funding needed', cr(R.peak)]] });
  S.push({ title: 'Area statement: FSI and TDR', cols: ['', 'Sq m', 'Sq ft'], rows: areas(p, R, i) });
  const rev = [['Residential: ' + inr(R.saleableRes) + ' sq ft at ' + rs(num(i.rateRes)), cr(R.revRes)]];
  if (R.revComm) rev.push(['Commercial: ' + inr(R.saleableComm) + ' sq ft at ' + rs(num(i.rateComm)), cr(R.revComm)]);
  if (R.revPark) rev.push([`Parking: ${inr(num(i.parkNos))} at ${rs(num(i.parkRate))}`, cr(R.revPark)]);
  if (R.revTdr) rev.push([`TDR generated sold: ${inr(R.tdrGen * SQFT)} sq ft at ${rs(num(i.tdrSaleRate))}`, cr(R.revTdr)]);
  if (R.revSetback) rev.push([`TDR for road set-back / amenity: ${inr(R.setbackTdr, 2)} sq m${R.setbackTdrAuto ? ` (${a.setbackFactor} × the area handed over)` : ''} × ASR × ${pc(a.tdrRealise)}`, cr(R.revSetback)]);
  rev.push(['Revenue in all', cr(R.revenue)]);
  S.push({ title: 'Revenue', cols: ['', 'Amount'], rows: rev });
  const cost = [[(R.cSub ? 'Superstructure: ' + inr(R.saleConSqft - R.subSqft) : 'Sale building construction: ' + inr(R.saleConSqft)) + ' sq ft', cr(R.cSale)]];
  if (R.cSub) cost.push([`Substructure (basements, podium): ${inr(R.subSqft)} sq ft at ${rs(num(i.rateSubCon))}`, cr(R.cSub)]);
  if (R.cRehab) cost.push([(p.kind === 'sra' ? 'Rehab building construction: ' : 'Members\' flats construction: ') + inr(R.rehabConSqft) + ' sq ft', cr(R.cRehab)]);
  if (R.cLand) cost.push([`Landscaping and surroundings: ${inr(num(i.landscapeArea))} sq ft at ${rs(a.landscapeRate)}`, cr(R.cLand)]);
  const label = Object.fromEntries(F.PREM.map(([k, l]) => [k, l]));
  for (const [k, v] of Object.entries(R.prem)) if (v) cost.push([label[k] + (R.premOwn[k] ? ' (consultant\'s figure)' : R.lumpIsEst && R.lumpIsEst[k] ? ' (estimate)' : ''), cr(v)]);
  if (R.rent) cost.push([`Rent for ${a.rentMonths} months, ${pc(a.rentEsc)} more each year, with brokerage`, cr(R.rent)]);
  if (R.shift) cost.push([`Shifting allowance (${a.shiftTimes} times)`, cr(R.shift)]);
  if (R.rentGst) cost.push([`GST on rent and shifting (${pc(a.rentGst)})`, cr(R.rentGst)]);
  if (R.memberCorpus) cost.push(['Corpus to the members', cr(R.memberCorpus)]);
  if (num(i.societyCost)) cost.push(['Society fund and other payments', cr(num(i.societyCost))]);
  cost.push([`Architect and consultants (${pc(a.archPct)} of construction) with GST`, cr(R.arch + R.archGst)]);
  cost.push([`Marketing and brokerage (${pc(a.mktPct)} of revenue) with GST`, cr(R.mkt)]);
  cost.push([`Overheads and miscellaneous (${pc(a.ohPct + a.miscPct)} of revenue)`, cr(R.oh)]);
  if (R.finance) cost.push([R.debtAuto ? `Interest at ${pc(a.debtRate)} on the money out of pocket each year (about ${cr(R.debt)} on average over ${R.years} years)` : `Interest on ${cr(R.debt)} at ${pc(a.debtRate)} for ${R.debtYears} years`, cr(R.finance)]);
  if (R.cont) cost.push([num(i.contingency) > 0 ? 'Contingency' : `Contingency (${pc(a.contPct)} of the costs above)`, cr(R.cont)]);
  cost.push(['Cost in all', cr(R.total)]);
  S.push({ title: 'Costs', cols: ['', 'Amount'], rows: cost });
  const watch = [['Cost per sq ft of saleable carpet', rs(R.costPsf)], ['Profit per sq ft of saleable carpet', rs(R.profitPsf)], ['Residential sale rate to break even', rs(R.breakeven) + ' per sq ft'],
    [`Residential sale rate for a ${pc(a.target)} margin`, rs(R.minRate) + ' per sq ft'], [`Most the land can cost for a ${pc(a.target)} margin`, cr(R.maxLand)]];
  if (R.tenements && !R.is3311) watch.push(['Rehab cost per tenement (construction, rent, shifting, corpus)', rs(R.rehabPerTen)]);
  S.push({ title: 'Rates to watch', cols: ['', ''], rows: watch });
  S.push({ title: 'What if: margin on cost', cols: ['Construction cost \\ sale rate'].concat(R.sens.sale.map((s) => (s > 0 ? '+' : '') + Math.round(s * 100) + '%')),
    rows: R.sens.grid.map((row, k) => [(R.sens.con[k] > 0 ? '+' : '') + Math.round(R.sens.con[k] * 100) + '%'].concat(row.map(pc))) });
  S.push({ title: 'Cash flow by year', cols: ['Year', 'Money in', 'Money out', 'Net', 'Running total'], rows: R.cf.map((c) => ['Year ' + c.year, cr(c.inflow), cr(c.outflow), cr(c.net), cr(c.cum)]) });
  const IN = [...(i.cts || i.village ? [['Site', [i.cts ? 'CTS ' + i.cts : '', i.village].filter(Boolean).join(', ')]] : []), ['Rules', rules.code], ['ASR open land rate', rs(num(i.asrLand)) + ' per sq m']];
  if (R.is3311) IN.push(['Scheme', 'Reg. 33(11): FSI ' + R.fsiTotal + ', ' + pc(a.freeShare) + ' of the balance free sale'], ['PTC cost', rs(num(i.ptcRate)) + ' per sq m']);
  else if (p.kind === 'sra') IN.push(['ASR construction rate', rs(num(i.asrConstr)) + ' per sq m'], ['Rehab construction rate', rs(num(i.rateRehabCon)) + ' per sq ft'], ['Transit rent per home / shop', `${rs(num(i.rentRes))} / ${rs(num(i.rentComm))} a month`]);
  IN.push(['Sale building construction rate', rs(num(i.rateSaleCon)) + ' per sq ft of construction area']);
  if (R.cSub) IN.push(['Substructure rate', rs(num(i.rateSubCon)) + ' per sq ft']);
  if (p.kind !== 'sra' && !R.is3311) IN.push(['TDR purchase rate', rs(num(i.tdrBuyRate)) + ' per sq ft']);
  if (p.kind === 'redevelopment') IN.push(['Members and shops', `${inr(num(i.members))} + ${inr(num(i.shops))}`], ['Existing carpet area', inr(num(i.existingCarpet)) + ' sq ft'], ['Extra area offered', inr(num(i.extraPct)) + '%'], ['Rent per member', rs(num(i.rentRes)) + ' a month'], ['Corpus per member', rs(num(i.corpusPer))]);
  if (p.kind === 'sra' && !R.is3311) IN.push(['Rehab component per home', inr(a.raRes) + ' sq m'], ['Loading on the rehab building', pc(a.rehabLoad)]);
  IN.push(['Loading on sale area (staircase, lifts, parking, services)', pc(a.saleLoad)], ['RERA carpet to built-up', pc(a.effPct)], ['Fungible FSI', pc(a.fungPct)], ['Fungible premium', pc(a.fungRes) + ' of ASR'], ...(R.is3311 ? [] : [['Premium FSI charge', pc(a.premPct) + ' of ASR']]), ['Target margin on cost / IRR wanted', `${pc(a.target)} / ${pc(a.hurdle)}`]);
  if (i.notes) IN.push(['Notes', i.notes]);
  S.push({ title: 'Inputs used', cols: ['', ''], rows: IN });
  return S;
}

const TEAL = '0.059 0.361 0.322', DARK = '0.039 0.247 0.220', BRASS = '0.788 0.592 0.227', TINT = '0.933 0.969 0.961', GREY = '0.4 0.459 0.435', LINE = '0.85 0.88 0.87';
const TONE = { GO: '0.067 0.478 0.396', CAUTION: '0.541 0.353 0.063', 'NO-GO': '0.706 0.137 0.094', INCOMPLETE: GREY };
function wrap(str, font, size, width) {
  const out = [];
  for (const para of String(str == null ? '' : str).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + w : w; if (textWidth(t, font, size) > width && line) { out.push(line); line = w; } else line = t; }
    out.push(line);
  }
  return out;
}
// who: { name, logo: { data (base64) } } the company the report is for
function pdf(p, opt, R, rules, who = {}) {
  const doc = new MiniPdf({ title: `Feasibility - ${p.name}`, author: who.name || 'Feasibility' });
  let pg = doc.addPage();
  const Wd = pg.w, H = pg.h, L = 44, Rt = Wd - 44, BOTTOM = H - 50;
  let y = 0;
  const fill = (x, yy, w, h, rgb) => pg.ops.push(`${rgb} rg ${x} ${H - yy - h} ${w} ${h} re f 0 0 0 rg`);
  const text = (x, yy, s, o = {}) => { if (o.rgb) pg.ops.push(`${o.rgb} rg`); pg.text(x, yy, s, o); if (o.rgb) pg.ops.push('0 0 0 rg'); };
  const right = (x, yy, s, o = {}) => text(x - textWidth(s, o.font || 'R', o.size || 11), yy, s, o);
  const foot = () => { text(L, H - 26, 'An estimate for a decision. FSI, premiums and charges to be confirmed by the project\'s architect and liaison consultant.', { size: 7.5, rgb: GREY }); right(Rt, H - 26, `Page ${doc.pages.length}`, { size: 7.5, rgb: GREY }); };
  const room = (h) => { if (y + h > BOTTOM) { foot(); pg = doc.addPage(); y = 44; } };
  let hasLogo = false;
  if (who.logo && who.logo.data) { try { hasLogo = doc.addImage('logo', Buffer.from(who.logo.data, 'base64')); } catch { hasLogo = false; } }
  fill(0, 0, Wd, 6, TEAL);
  if (hasLogo) { const im = doc.jpegs.logo, h = 40, w = Math.min(150, im.w * h / im.h); pg.image('logo', L, 22, w, h); }
  right(Rt, 40, 'FEASIBILITY REPORT', { font: 'B', size: 16, rgb: DARK });
  right(Rt, 56, dmy(new Date()), { size: 10, rgb: GREY });
  y = 84;
  text(L, y + 18, p.name, { font: 'B', size: 20, rgb: DARK }); y += 28;
  text(L, y + 11, `${KIND[p.kind] || 'Project'} · ${opt.name}${p.state ? ' · ' + p.state : ''} · ${rules.code}`, { size: 10.5, rgb: GREY }); y += 22;
  { const ii = opt.inputs || {}, site = [ii.cts ? 'CTS ' + ii.cts : '', ii.village || '', p.city || '', ii.grossPlot ? inr(ii.grossPlot) + ' sq m plot' : '', p.site ? 'New opportunity' : ''].filter(Boolean).join(' · ');
    if (site) { text(L, y + 10, site, { size: 10.5, rgb: GREY }); y += 18; } }
  if (who.name) { text(L, y + 10, who.name, { size: 10, rgb: GREY }); y += 18; }
  // the call
  const tone = TONE[R.status] || GREY, whyL = wrap(R.why, 'R', 10, Rt - L - 24);
  const bh = 34 + whyL.length * 13;
  fill(L, y, Rt - L, bh, TINT); fill(L, y, 5, bh, tone);
  text(L + 16, y + 22, R.verdict, { font: 'B', size: 15, rgb: tone });
  whyL.forEach((ln, k) => text(L + 16, y + 38 + k * 13, ln, { size: 10 }));
  y += bh + 12;
  // headline figures
  const K = [['Revenue', cr(R.revenue)], ['Total cost', cr(R.total)], ['Profit', cr(R.profit)], ['Margin on cost', pc(R.margin)], ['IRR', R.irr == null ? '-' : pc(R.irr)], ['FSI used', R.fsiAchieved.toFixed(2)]];
  const kw = (Rt - L) / 3;
  K.forEach(([l, v], k) => { const x = L + (k % 3) * kw, yy = y + Math.floor(k / 3) * 42; text(x, yy + 14, v, { font: 'B', size: 14, rgb: DARK }); text(x, yy + 28, l, { size: 9, rgb: GREY }); });
  y += 92;
  const table = (sec) => {
    room(60);
    text(L, y + 13, sec.title, { font: 'B', size: 12.5, rgb: DARK }); fill(L, y + 18, 28, 2, BRASS); y += 28;
    const n = sec.cols.length, first = n === 2 ? 0.62 : n === 3 ? 0.6 : n === 5 ? 0.2 : 0.3, rest = (1 - first) / (n - 1);
    const ws = [first].concat(Array(n - 1).fill(rest)).map((w) => w * (Rt - L)), size = 9, lh = 12, pad = 5;
    const row = (cells, kind, idx) => {
      const font = kind === 'head' || kind === 'total' ? 'B' : 'R';
      const wr = cells.map((c, k) => wrap(c, font, size, ws[k] - pad * 2));
      const h = Math.max(...wr.map((w) => w.length)) * lh + pad * 1.4;
      room(h);
      if (kind === 'head') fill(L, y, Rt - L, h, TEAL); else if (kind === 'total') fill(L, y, Rt - L, h, DARK); else if (idx % 2 === 0) fill(L, y, Rt - L, h, TINT);
      let x = L;
      wr.forEach((ls, k) => { ls.forEach((ln, j) => { const ty = y + pad + size * 0.95 + j * lh, rgb = kind === 'head' || kind === 'total' ? '1 1 1' : undefined; if (k > 0) right(x + ws[k] - pad, ty, ln, { font, size, rgb }); else text(x + pad, ty, ln, { font, size, rgb }); }); x += ws[k]; });
      y += h;
    };
    if (sec.cols.some(Boolean)) row(sec.cols, 'head', -1);
    sec.rows.forEach((r, k) => row(r.map(String), /in all$/.test(r[0]) ? 'total' : 'body', k));
    pg.ops.push(`0.5 w ${LINE} RG ${L} ${H - y} m ${Rt} ${H - y} l S 0 0 0 RG`);
    y += 14;
  };
  sections(p, opt, R, rules).slice(1).forEach(table);
  if (R.warn.length) { room(40); R.warn.forEach((w) => { wrap('Check: ' + w, 'B', 9.5, Rt - L).forEach((ln) => { room(13); text(L, y + 10, ln, { font: 'B', size: 9.5, rgb: TONE['NO-GO'] }); y += 13; }); }); }
  foot();
  return doc.toBuffer();
}

function xlsx(p, opt, R, rules) {
  const S = sections(p, opt, R, rules);
  const rows = [[`Feasibility: ${p.name} · ${opt.name}`], [`${KIND[p.kind] || ''} · ${rules.code} · ${dmy(new Date())}`], []];
  for (const s of S) { rows.push([s.title.toUpperCase()]); if (s.cols.some(Boolean)) rows.push(s.cols); s.rows.forEach((r) => rows.push(r)); rows.push([]); }
  rows.push(['An estimate for a decision. FSI, premiums and charges to be confirmed by the project\'s architect and liaison consultant.']);
  return W.write([{ name: 'Feasibility', rows, widths: [62, 22, 22, 18, 18, 18] }]);
}

module.exports = { sections, pdf, xlsx, fileName };
