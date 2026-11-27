// Feasibility (staff): a project's options, each with its land, FSI and TDR, rates and costs, and the figures worked
// out live: area statement, revenue, costs, margin, IRR, what-if and the go / no-go call. Data from /api/feasibility
// (lib/feasibility.js). Mounted by app.js: window.Feasibility.render(ctx, projectId).
(function () {
  let C = null, P = null, S = null, D = null, cur = null, inputs = {}, R = null, dirty = false, timer = null, pane = 'inputs';
  const own = () => (S ? { site: S } : { project: P }), qs = () => (S ? 'site=' + S : 'project=' + P);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
  const cr = (v) => (v == null || !isFinite(v) ? '—' : '₹' + nf(v / 1e7, 2) + ' Cr');
  const pc = (v) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%');
  const blob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
  const KINDL = { sra: 'SRA (slum rehabilitation)', redevelopment: 'Redevelopment', new: 'New development' };
  const TONE = { GO: 'good', CAUTION: 'warn', 'NO-GO': 'bad', INCOMPLETE: 'grey' };
  const css = `
  .fz .fz-opts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
  .fz .fz-opt{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;border:1.5px solid var(--line);color:var(--ink);border-radius:12px;padding:8px 12px;font-weight:600;text-align:left}
  .fz .fz-opt small{font-weight:500;color:var(--ink-3);font-size:12px}.fz .fz-opt.on{border-color:var(--brand);background:var(--brand-tint)}.fz .fz-opt:hover{background:var(--brand-tint)}
  .fz .fz-split{display:grid;grid-template-columns:minmax(0,430px) minmax(0,1fr);gap:18px;align-items:start}
  .fz .fz-res{position:sticky;top:80px;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-content:start;max-height:calc(100vh - 92px);overflow-y:auto;overscroll-behavior:contain;padding-right:4px}
  .fz .fz-seg{display:none;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:0 0 12px}.fz .fz-seg button{flex:1;border:0;border-radius:0;background:#fff;color:var(--ink-2)}.fz .fz-seg button.on{background:var(--brand);color:#fff}
  @media (max-width:980px){.fz .fz-split{grid-template-columns:minmax(0,1fr)}.fz .fz-res{position:static;max-height:none;overflow:visible;padding-right:0}.fz .fz-seg{display:flex}.fz .fz-split[data-pane=inputs] .fz-res,.fz .fz-split[data-pane=results] .fz-in{display:none}}
  .fz details.fz-sec{background:#fff;border:1px solid var(--line);border-radius:14px;margin:0 0 10px}
  .fz details.fz-sec>summary{list-style:none;cursor:pointer;padding:12px 16px;margin:0;display:flex;gap:10px;justify-content:space-between;color:var(--ink);font-size:15px;font-weight:700}
  .fz details.fz-sec>summary::-webkit-details-marker{display:none}.fz details.fz-sec>summary small{font-weight:500;color:var(--ink-3);font-size:12.5px;text-align:right}
  .fz .fz-f{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding:0 16px 16px}
  .fz .fz-f .w{grid-column:1/-1}.fz details.fz-sec,.fz details.fz-sec *{text-transform:none;letter-spacing:0}.fz .fz-f label{font-size:12.5px;font-weight:600;color:var(--ink-2);margin:0 0 3px;display:block;line-height:1.25}.fz .fz-f label i{font-style:normal;font-weight:500;color:var(--ink-3)}
  .fz .fz-f input,.fz .fz-f select,.fz .fz-f textarea{width:100%;margin:0}.fz .fz-f .fz-hint{font-size:12px;color:var(--ink-3);margin-top:2px}
  .fz .fz-f .cl{background:#FFF6CC;border-color:#E5C24A}.fz .fz-f .cl:focus{background:#FFFBE6}.fz .fz-f input.need:placeholder-shown{border-color:#D97706;background:#FFEFC2}
  .fz .fz-req{color:#B3261E}.fz .fz-legend{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 10px;font-size:13.5px;color:var(--ink-2)}
  .fz .fz-how{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:0 0 10px;font-size:13.5px;color:var(--ink-2)}
  .fz .fz-how b.t{display:block;color:var(--ink);font-size:15px;margin:0 0 6px}.fz .fz-how ol{margin:0;padding-left:20px;display:grid;gap:4px}
  .fz .fz-how .sw{display:inline-block;vertical-align:-2px;width:26px;height:14px;border-radius:4px;background:#FFF6CC;border:1px solid #E5C24A;margin-right:4px}
  .fz details.fz-sec>summary .st{display:grid;gap:2px}.fz details.fz-sec>summary .st em{font-style:normal;font-weight:500;font-size:12.5px;color:var(--ink-3)}
  .fz details.fz-sec>summary .n{flex:none;width:24px;height:24px;border-radius:50%;background:var(--brand);color:#fff;font-size:12.5px;display:grid;place-items:center}
  .fz details.fz-sec>summary .l{display:flex;gap:10px;align-items:flex-start}
  .fz .fz-asr{grid-column:1/-1;border:1px dashed #E5C24A;background:#FFFBE6;border-radius:10px;padding:10px 12px;font-size:13px;color:var(--ink-2)}
  .fz .fz-asr summary{cursor:pointer;font-weight:700;color:var(--ink)}.fz .fz-asr ol{margin:6px 0 0;padding-left:20px;display:grid;gap:3px}
  .fz .fz-plain{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 16px;font-size:14px;color:var(--ink-2);line-height:1.5}
  .fz .fz-cmp td:nth-child(2),.fz .fz-cmp th:nth-child(2),.fz .fz-cmp td:nth-child(3),.fz .fz-cmp th:nth-child(3){text-align:left}
  .fz .fz-sites{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin:0 0 14px}
  .fz .fz-site{display:grid;gap:4px;background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:14px 16px;color:var(--ink);text-decoration:none}
  .fz .fz-site:hover{border-color:var(--brand);background:var(--brand-tint)}.fz .fz-site b{font-size:16px}.fz .fz-site small{color:var(--ink-3);font-size:12.5px}.fz .fz-site>span{font-size:13px;color:var(--ink-2);margin-top:4px}
  .fz .fz-sw{flex:none;width:22px;height:16px;border-radius:4px;background:#FFF6CC;border:1px solid #E5C24A}
  .fz .fz-note{grid-column:1/-1;background:var(--brand-tint);border-radius:10px;padding:9px 12px;font-size:13px;color:var(--ink-2)}
  .fz .fz-call{border-radius:14px;padding:14px 18px;border:1px solid var(--line);background:#fff;display:grid;gap:4px}
  .fz .fz-call b{font-size:22px}.fz .fz-call.good{background:var(--good-tint);border-color:#A9DCCB}.fz .fz-call.good b{color:var(--good)}
  .fz .fz-call.warn{background:#FBEFD9;border-color:#EACB86}.fz .fz-call.warn b{color:#8A5A10}.fz .fz-call.bad{background:var(--bad-tint);border-color:#F1B7AE}.fz .fz-call.bad b{color:var(--bad)}.fz .fz-call.grey b{color:var(--ink-3)}
  .fz .fz-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .fz .fz-k div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:11px 14px}.fz .fz-k b{display:block;font-size:20px;color:var(--brand)}.fz .fz-k span{font-size:12.5px;color:var(--ink-2);display:block;font-weight:600}.fz .fz-k span.d{font-weight:400;color:var(--ink-3);font-size:11.5px;margin-top:2px}
  .fz .fz-t{width:100%;border-collapse:collapse;font-size:13.5px}.fz .fz-t td,.fz .fz-t th{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}
  .fz .fz-t td:first-child,.fz .fz-t th:first-child{text-align:left;white-space:normal}.fz .fz-t th{font-size:12px;color:var(--ink-3);font-weight:600;background:#FAFBF9}
  .fz .fz-t tr.tot td{font-weight:700;border-top:2px solid var(--brand);background:var(--brand-tint)}
  .fz .fz-t td.g{background:var(--good-tint);color:var(--good);font-weight:700}.fz .fz-t td.a{background:#FBEFD9;color:#8A5A10;font-weight:700}.fz .fz-t td.r{background:var(--bad-tint);color:var(--bad);font-weight:700}
  .fz .fz-t td.base{outline:2px solid var(--brand);outline-offset:-2px}
  .fz .fz-bars{display:grid;gap:7px}.fz .fz-bar{display:grid;grid-template-columns:minmax(110px,200px) 1fr 90px;gap:10px;align-items:center;font-size:13px}
  .fz .fz-bar u{height:11px;background:#EEF0EC;border-radius:99px;overflow:hidden;display:block}.fz .fz-bar u i{display:block;height:100%;background:var(--brand);border-radius:99px}.fz .fz-bar b{text-align:right}
  .fz .fz-warn{background:var(--bad-tint);color:var(--bad);border-radius:10px;padding:9px 12px;font-size:13.5px;font-weight:600}
  .fz .fz-dirty{font-size:12.5px;font-weight:600;color:#8A5A10}
  .fz .empty{padding:28px;text-align:center;color:var(--ink-3)}
  .fz h2.sm{font-size:15px;margin:0 0 8px}
  `;
  // ---- the input fields ----
  // k: input key (assume.x / ovr.x for the standard figures and consultant's figures); u: unit; cr: entered in crore;
  // pct: entered as a percent; need: needed for the call; kinds: which project types show it
  const ALL = ['sra', 'redevelopment', 'new'];
  const SECS = [
    { id: 'land', t: 'The plot', d: 'Where it is, its area, and any part given up for the road or the city', open: 1, f: [
      { k: 'cts', l: 'CTS / survey number', txt: 1, ph: 'e.g. 446C', hint: 'From the property card or 7/12' }, { k: 'village', l: 'Village and taluka', txt: 1, ph: 'e.g. Oshiwara, Andheri' },
      { k: 'grossPlot', l: 'Plot area', u: 'sq m', need: 1, hint: 'As on the property card or 7/12', w: 1 },
      { k: 'roadSetback', l: 'Road set-back / DP road', u: 'sq m' }, { k: 'dpRes', l: 'DP reservation', u: 'sq m' },
      { k: 'amenityPlot', l: 'Amenity plot handed over', u: 'sq m' }, { k: 'retained', l: 'Under structures that stay', u: 'sq m' },
      { k: 'road', l: 'Road width in front of the plot', sel: 'road', kinds: ['redevelopment', 'new'], when: () => !is3311(), w: 1, hint: 'Sets the basic FSI, premium FSI and TDR allowed' },
      { k: 'setbackTdr', l: 'TDR you get for road set-back or amenity handed over', u: 'sq m', w: 1, est: 'setback', hint: () => (ruleVal('setbackFactor') ? `Blank: ${+ruleVal('setbackFactor')} × (road set-back + amenity plot). Sells at ${pcs('tdrRealise')} of the ASR land rate. Type the architect's figure when you have it` : 'From the architect. Sells at a share of the ASR land rate (Standard figures)') }] },
    { id: 'slum', t: 'Slum survey (Annexure-II)', d: 'How many homes and shops are eligible for rehab', open: 1, kinds: ['sra'], when: () => !is3311(), f: [
      { k: 'tenRes', l: 'Eligible homes', u: 'nos', need: 1 }, { k: 'tenComm', l: 'Eligible shops', u: 'nos' },
      { k: 'papOverride', l: 'PAP tenements fixed by SRA', u: 'nos', ph: 'auto', hint: 'Blank: worked out from the density rule' },
      { k: 'amenityArea', l: 'Amenities built-up (balwadi, welfare centre, society office)', u: 'sq m' },
      { k: 'assume.raRes', l: 'Rehab component per home', u: 'sq m', opts: [[40, '40 sq m'], [45, '45 sq m'], [48, '48 sq m'], [50, '50 sq m (27.88 carpet × 1.2 × 1.5)']], w: 1, hint: 'Ask your architect which applies' }] },
    { id: 'members', t: 'Society members', d: 'The flats today and what they get in the new building', open: 1, kinds: ['redevelopment'], f: [
      { k: 'members', l: 'Flats', u: 'nos', need: 1 }, { k: 'shops', l: 'Shops', u: 'nos' },
      { k: 'existingCarpet', l: 'Existing carpet area of all members', u: 'sq ft', need: 1 }, { k: 'existingBUA', l: 'Existing built-up area', u: 'sq m', hint: 'For the 33(7)(B) incentive' },
      { k: 'extraPct', l: 'Extra carpet area offered', u: '%', hint: 'e.g. 30 = 30% more than today' }, { k: 'newCarpet', l: 'Or: new carpet area of all members', u: 'sq ft', ph: 'auto' }] },
    { id: 'fsi', t: 'Building rights and government rates', d: 'FSI and TDR (how much you can build) and the ready reckoner (ASR) rates', open: 1, f: [
      { k: 'scheme', l: 'Scheme', sel: 'scheme', kinds: ['sra', 'new'], when: () => mh(), w: 1, hint: () => (is3311() ? 'FSI on the whole plot: the zonal FSI, then half the balance as free sale and half earned by PTC tenements (bought from another scheme or built elsewhere) handed over' : 'Pick Reg. 33(11) when the sale area comes from PTC tenements') },
      { k: 'fsiTotal', l: 'FSI permissible', u: 'FSI', when: () => is3311(), rule: 'fsi3311' }, { k: 'assume.freeShare', l: 'Free sale share of the balance', u: '% (rest is earned by PTC)', pct: 1, std: 1, when: () => is3311(), rule: 'freeShare' },
      { k: 'ptcNos', l: 'PTC tenements handed over', u: 'nos', when: () => is3311(), hint: 'For the bank guarantee' }, { k: 'ptcRate', l: 'PTC cost', u: '₹ per sq m of PTC built-up', when: () => is3311(), need: 1, hint: 'Price to buy them from another scheme, or your cost to build them elsewhere' },
      { k: 'basicFSI', l: 'Basic FSI', u: 'FSI', kinds: ['redevelopment', 'new'], when: () => !is3311(), rule: 'basicFSI' }, { k: 'premiumFSI', l: 'Additional FSI on premium', u: 'FSI', kinds: ['redevelopment', 'new'], when: () => !is3311(), rule: 'premiumFSI' },
      { k: 'tdrFSI', l: 'TDR to buy (0 = none)', u: 'FSI', kinds: ['redevelopment', 'new'], when: () => !is3311(), rule: 'tdrFSI' }, { k: 'tdrBuyRate', l: 'TDR price', u: '₹ per sq ft', kinds: ['redevelopment', 'new'], when: () => !is3311() },
      { k: 'assume.fungRes', l: 'Fungible premium', u: 'share of ASR', pct: 1, opts: [[0.5, '50% of ASR'], [0.6, '60% of ASR']], hint: 'Ask your architect which applies to this plot' },
      { k: 'asrLand', l: 'ASR (ready reckoner) open land rate', u: '₹ per sq m', need: 1, hint: 'For the plot\'s village and zone' }, { k: 'asrConstr', l: 'ASR construction rate', u: '₹ per sq m', kinds: ['sra'], when: () => !is3311(), need: 1, hint: 'RCC building rate for the same year' },
      { k: 'incManual', l: 'Incentive ratio from the architect', u: '×', kinds: ['sra'], when: () => !is3311(), ph: 'auto', hint: 'Blank: from the LR/RC band' },
      { k: 'tdrSaleRate', l: 'Price the TDR generated sells at', u: '₹ per sq ft', kinds: ['sra'], when: () => !is3311(), hint: 'When the sale area is more than the plot can hold' }] },
    { id: 'sales', t: 'Sale prices', d: 'What the flats, shops and parking sell for', open: 1, f: [
      { k: 'rateRes', l: 'Residential sale rate', u: '₹ per sq ft carpet', need: 1 }, { k: 'rateComm', l: 'Commercial sale rate', u: '₹ per sq ft', hint: 'Used when there is a commercial share' },
      { k: 'parkNos', l: 'Parking spaces sold', u: 'nos' }, { k: 'parkRate', l: 'Price per parking', u: '₹' },
      { k: 'saleableOverride', l: 'RERA carpet from the architect', u: 'sq ft', ph: 'auto', w: 1, hint: 'Replaces the carpet-to-built-up % below' }] },
    { id: 'build', t: 'Construction', d: 'What it costs to build, per sq ft', open: 1, f: [
      { k: 'rateSaleCon', l: 'Construction rate (sale building)', u: '₹ per sq ft built', need: 1, hint: 'With a substructure rate below, this is the superstructure rate' },
      { k: 'rateRehabCon', l: 'Construction rate (rehab building)', u: '₹ per sq ft built', kinds: ['sra'], when: () => !is3311(), need: 1 },
      { k: 'rateSubCon', l: 'Substructure rate (basements, podium)', u: '₹ per sq ft', hint: 'Optional. Blank: one rate for the whole building' },
      { k: 'subArea', l: 'Substructure area', u: 'sq ft', ph: 'auto', hint: 'Used with the substructure rate. Blank: the loading area (sale built-up × the loading below)' },
      { k: 'assume.saleLoad', l: 'Loading on the sale building', u: 'lifts, lobby, staircase', pct: 1, opts: [40, 50, 60, 70, 80, 90, 100].map((v) => [v / 100, v + '%']) },
      { k: 'assume.rehabLoad', l: 'Loading on the rehab building', u: 'lifts, lobby, staircase', pct: 1, kinds: ['sra'], when: () => !is3311(), opts: [20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100].map((v) => [v / 100, v + '%']) },
      { k: 'assume.years', l: 'Project duration', u: 'from the first payment to the last sale', opts: [[3, '3 years'], [4, '4 years'], [5, '5 years']], w: 1, hint: 'Sets the cash flow, the interest and the IRR' },
      { k: 'landscapeArea', l: 'Landscaping and surroundings', u: 'sq ft', w: 1, hint: 'At ₹600 a sq ft (Standard figures)' }] },
    { id: 'rent', t: 'Rent, shifting and corpus', d: 'What you pay the families while the building goes up', open: 1, kinds: ['sra', 'redevelopment'], when: () => !is3311(), f: [
      { k: 'rentRes', l: 'Rent per family', u: '₹ a month', need: 1 }, { k: 'rentComm', l: 'Rent per shop', u: '₹ a month', kinds: ['sra'] },
      { k: 'rentNos', l: 'Families on rent', u: 'nos', kinds: ['sra'], ph: 'eligible homes', hint: 'Blank: the eligible homes' },
      { k: 'corpusPer', l: 'Corpus per member', u: '₹', kinds: ['redevelopment'] }, { k: 'shiftPer', l: 'Shifting per member', u: '₹', kinds: ['redevelopment'], rule: 'shiftRate' },
      { k: 'societyCost', l: 'Society fund and other payments', u: '₹ Cr', cr: 1, w: 1 }] },
    { id: 'lump', t: 'Land cost and one-time payments', d: 'In ₹ crore. Leave a box blank and the ERP estimates it (shown in grey); type the real figure when you have it', open: 1, f: [
      { k: 'landCost', l: 'Land cost or settlement with the earlier owner', u: '₹ Cr', cr: 1, w: 1, hint: 'Only you know this one. Blank = none' },
      { k: 'osdCost', l: 'Open space deficiency premium', u: '₹ Cr', cr: 1, est: 'osd', hint: () => (D.project.kind === 'new' ? 'Blank = none' : `Blank: ${pcs('osdPct')} of plot area × ASR land rate`) },
      { k: 'stairCost', l: 'Staircase, lift and lobby premium', u: '₹ Cr', cr: 1, est: 'stair', hint: () => `Blank: ${pcs('stairPct')} of ASR land rate on the sale built-up` },
      { k: 'cfoCost', l: 'CFO (fire) scrutiny fees', u: '₹ Cr', cr: 1, est: 'cfo', hint: () => `Blank: ₹${nf(ruleVal('cfoRate'))} per sq m built` },
      { k: 'moefCost', l: 'MoEF (environment) clearance', u: '₹ Cr', cr: 1, est: 'moef', hint: () => `Blank: ${cr(ruleVal('moefFee'))} when more than ${nf(ruleVal('moefMin'))} sq m is built, else none` },
      { k: 'aviationCost', l: 'Civil aviation NOC', u: '₹ Cr', cr: 1, hint: 'Only near the airport (height zone): often about ₹0.50 Cr. Blank = none' },
      { k: 'annexCost', l: 'Annexure-II certification', u: '₹ Cr', cr: 1, kinds: ['sra'], est: 'annex', hint: () => `Blank: ₹${nf(ruleVal('annexRate'))} per eligible home and shop` },
      { k: 'unearnedCost', l: 'Un-earned charges', u: '₹ Cr', cr: 1, when: () => is3311(), hint: 'Usually 40% of the difference in residential ASR rates × the PTC built-up. Blank = none' },
      { k: 'assessCost', l: 'Assessment / land under construction tax', u: '₹ Cr', cr: 1, est: 'luc', hint: () => `Blank: ${pcs('lucPct')} of plot × ASR a year, for ${+ruleVal('lucYears')} years` },
      { k: 'bgCost', l: 'Bank guarantee charges', u: '₹ Cr', cr: 1, est: 'bg', hint: () => (D.project.kind === 'sra' || is3311() ? `Blank: ${pcs('bgPct')} on ₹${nf(ruleVal('bgVal'))} per tenement` : 'Blank = none') },
      { k: 'plumbingCost', l: 'Plumbing and sanitary charges', u: '₹ Cr', cr: 1, hint: 'Your consultant\'s figure. Blank = none' },
      { k: 'prorataCost', l: 'Pro-rata charges for road set-back', u: '₹ Cr', cr: 1, hint: 'Your consultant\'s figure. Blank = none' },
      { k: 'legalCost', l: 'Legal charges', u: '₹ Cr', cr: 1, est: 'legal', hint: () => `Blank: ${cr(ruleVal('legalFee'))}` },
      { k: 'approvalsCost', l: 'Other approvals, stamp duty, liaison', u: '₹ Cr', cr: 1, hint: 'Your own figure. Blank = none' },
      { k: 'debtAmt', l: 'Average borrowing', u: '₹ Cr', cr: 1, est: 'debt', hint: () => `Blank: worked out year by year from the cash flow, at ${pcs('debtRate')} a year` },
      { k: 'contingency', l: 'Contingency', u: '₹ Cr', cr: 1, est: 'cont', hint: () => `Blank: ${pcs('contPct')} of all other costs` }] },
    { id: 'ovr', t: 'Consultant\'s figures', sub: 'Optional', d: 'Only if your consultant gave exact premiums. Blank: the ERP works them out', f: 'ovr' },
    { id: 'assume', t: 'Standard figures', sub: 'Optional', d: 'Rates set by the rules. Change only if your architect or CA advises', f: 'assume' },
    { id: 'notes', t: 'Notes', sub: 'Optional', d: 'Anything to remember about this option', f: [{ k: 'notes', l: 'Notes', area: 1, w: 1 }] },
  ];
  // the standard figures: [key, label, unit, percent?, kinds]
  const STD = [
    ['fungPct', 'Fungible FSI', '%', 1], ['commShare', 'Commercial share of the sale area', '%', 1], ['effPct', 'RERA carpet to built-up', '%', 1],
    ['raComm', 'Rehab component per shop', 'sq m', 0, ['sra']], ['compFactor', 'Factor on the amenities built-up', '×', 0, ['sra']], ['density', 'Minimum density', 'per hectare', 0, ['sra']],
    ['fsiCap', 'Most FSI on the plot (0 = no limit)', 'FSI', 0, ['sra']], ['basicFSI', 'Zonal (basic) FSI', 'FSI', 0, ['sra']], ['bgVal', 'Bank guarantee per tenement', '₹', 0, ['sra', 'new']], ['bgPct', 'Bank guarantee commission', '%', 1, ['sra', 'new']], ['corpusRate', 'Corpus per rehab home', '₹', 0, ['sra']],
    ['redevIncPct', 'Incentive: share of existing built-up', '%', 1, ['redevelopment']], ['redevIncPerTen', 'Incentive: per member', 'sq m', 0, ['redevelopment']],
    ['premPct', 'Premium FSI charge', '% of ASR', 1, ['redevelopment', 'new']], ['fungRes', 'Fungible premium, residential', '% of ASR', 1], ['fungComm', 'Fungible premium, commercial', '% of ASR', 1],
    ['infraPct', 'Infrastructure charges', '% of ASR', 1], ['devLandPct', 'Development charges, land', '% of ASR', 1], ['devResPct', 'Development charges, residential', '% of ASR', 1], ['devCommPct', 'Development charges, commercial', '% of ASR', 1],
    ['cessPct', 'Labour cess', '% of construction', 1], ['waterRate', 'Water and sewerage', '₹ per sq m', 0], ['pcoRate', 'PCO charges', '₹ per sq m', 0], ['lucPct', 'Land under construction tax', '% a year', 1], ['lucYears', 'Years of that tax', 'years', 0],
    ['rentMonths', 'Transit period', 'months', 0, ['sra', 'redevelopment']], ['rentEsc', 'Rent increase each year', '%', 1, ['sra', 'redevelopment']], ['rentBrok', 'Brokerage on rent', 'months', 0, ['sra', 'redevelopment']], ['shiftRate', 'Shifting allowance', '₹ each', 0, ['sra', 'redevelopment']], ['shiftTimes', 'Shiftings (out and back)', 'times', 0, ['sra', 'redevelopment']], ['rentGst', 'GST on rent and shifting', '%', 1, ['sra', 'redevelopment']],
    ['landscapeRate', 'Landscaping rate', '₹ per sq ft', 0], ['setbackFactor', 'TDR for land handed over (road set-back, amenity)', '× the area', 0], ['tdrRealise', 'Set-back TDR sells at', '% of ASR', 1], ['contPct', 'Contingency when not entered', '% of costs', 1],
    ['osdPct', 'Open space deficiency premium (estimate)', '% of plot × ASR', 1, ['sra', 'redevelopment']], ['stairPct', 'Staircase, lift and lobby premium (estimate)', '% of ASR on sale built-up', 1],
    ['cfoRate', 'CFO (fire) scrutiny fee (estimate)', '₹ per sq m built', 0], ['moefFee', 'MoEF clearance (estimate)', '₹', 0], ['moefMin', 'MoEF needed above', 'sq m built', 0],
    ['annexRate', 'Annexure-II certification (estimate)', '₹ per eligible tenement', 0, ['sra']], ['legalFee', 'Legal charges (estimate)', '₹', 0],
    ['archPct', 'Architect and consultants', '% of construction', 1], ['archGst', 'GST on fees', '%', 1], ['mktPct', 'Marketing and brokerage', '% of revenue', 1], ['mktGst', 'GST on marketing', '%', 1],
    ['ohPct', 'Admin and overheads', '% of revenue', 1], ['miscPct', 'Miscellaneous', '% of revenue', 1], ['debtRate', 'Interest rate', '% a year', 1], ['debtYears', 'Borrowing period when you enter the borrowing (0 = the whole project)', 'years', 0],
    ['target', 'Margin on cost for "go ahead"', '%', 1], ['amber', 'Lowest margin worth a careful look', '%', 1], ['hurdle', 'IRR wanted', '%', 1], ['disc', 'Discount rate for NPV', '%', 1],
  ];
  const LUMPK = ['land', 'osd', 'stair', 'cfo', 'moef', 'aviation', 'annex', 'legal', 'approvals', 'unearned', 'plumbing', 'prorata', 'bg', 'luc'];
  const mh = () => /maharashtra/i.test(D.project.state || '') || /DCPR/.test(D.rules.code || '');
  const is3311 = () => inputs.scheme === '3311' && ['sra', 'new'].includes(D.project.kind);
  const num = (v) => (isFinite(+v) ? +v : 0);
  const kindOk = (x) => (!x.kinds || x.kinds.includes(D.project.kind)) && (!x.when || x.when());
  const get = (k) => { const [a, b] = k.split('.'); return b ? (inputs[a] || {})[b] : inputs[a]; };
  const set = (k, v) => { const [a, b] = k.split('.'); if (b) { inputs[a] = { ...(inputs[a] || {}) }; if (v === '' || v == null) delete inputs[a][b]; else inputs[a][b] = v; } else if (v === '' || v == null) delete inputs[a]; else inputs[a] = v; };
  const show = (v, f) => (v == null || v === '' ? '' : f.cr ? +(v / 1e7).toFixed(4) : f.pct ? +(v * 100).toFixed(4) : v);
  const read = (s, f) => { const t = String(s).replace(/[,₹\s]/g, ''); if (t === '') return ''; const n = Number(t); if (!isFinite(n)) return s; return f.cr ? Math.round(n * 1e7) : f.pct ? n / 100 : n; };
  const pcs = (k) => +(ruleVal(k) * 100).toFixed(2) + '%';
  // the estimate shown in a blank one-time payment box (from the last result)
  const estOf = (k) => (!R ? null : k === 'setback' ? (R.setbackTdrAuto ? R.setbackTdr : null) : k === 'debt' ? (R.debtAuto ? R.debt : null) : k === 'cont' ? (R.contAuto ? R.cont : null) : R.lumpEst ? R.lumpEst[k] : null);
  const roadFig = () => { const r = D.rules.roads.find((x) => x.key === (inputs.road || D.rules.road)); return r ? { basicFSI: r.basic, premiumFSI: r.premium, tdrFSI: r.tdr } : {}; };
  const ruleVal = (k) => (k in roadFig() ? roadFig()[k] : D.rules.assume[k]);

  function field(f) {
    const id = 'fz_' + f.k.replace('.', '_'), v = get(f.k);
    const lab = `<label for="${id}">${esc(f.l)}${f.need ? '<b class="fz-req" title="Needed for the result"> *</b>' : ''}${f.u ? ` <i>${esc(f.u)}</i>` : ''}</label>`;
    let el;
    if (f.sel === 'road') el = `<select id="${id}" data-k="road" class="cl">${D.rules.roads.length ? D.rules.roads.map((r) => `<option value="${r.key}" ${(v || D.rules.road) === r.key ? 'selected' : ''}>${esc(r.label)} · FSI ${r.basic} + ${r.premium} premium + ${r.tdr} TDR</option>`).join('') : '<option value="">Not used in this state</option>'}</select>`;
    else if (f.sel === 'scheme') el = `<select id="${id}" data-k="scheme" class="cl" ${D.canEdit ? '' : 'disabled'}><option value="">${D.project.kind === 'sra' ? 'SRA 33(10): rehab on the plot' : 'Standard: FSI by road width'}</option><option value="3311" ${v === '3311' ? 'selected' : ''}>Reg. 33(11): sale in lieu of PTC tenements</option></select>`;
    else if (f.opts) { const cur = v == null || v === '' ? ruleVal(f.k.split('.').pop()) : v; el = `<select id="${id}" data-k="${f.k}" class="cl" ${D.canEdit ? '' : 'disabled'}>${(f.opts.some(([ov]) => Math.abs(ov - cur) < 1e-9) || cur == null ? f.opts : [...f.opts, [+cur, f.pct ? +(cur * 100).toFixed(2) + '%' : String(cur)]].sort((x, y) => x[0] - y[0])).map(([ov, ol]) => `<option value="${ov}" ${Math.abs(+cur - ov) < 1e-9 ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`; }
    else if (f.txt) el = `<input id="${id}" data-k="${f.k}" value="${esc(v || '')}" placeholder="${esc(f.ph || '')}" maxlength="120" class="cl" ${D.canEdit ? '' : 'disabled'}>`;
    else if (f.area) el = `<textarea id="${id}" data-k="${f.k}" rows="3" maxlength="2000">${esc(v || '')}</textarea>`;
    else el = `<input id="${id}" data-k="${f.k}" inputmode="decimal" value="${esc(show(v, f))}" placeholder="${esc(f.est ? estPh(f) : f.ph || (f.rule != null ? show(ruleVal(f.rule), f) : ''))}" class="${f.std || f.rule || f.ph === 'auto' ? '' : 'cl'}${f.need ? ' need' : ''}" ${D.canEdit ? '' : 'disabled'}>`;
    const h = typeof f.hint === 'function' ? f.hint() : f.hint;
    return `<div class="${f.w ? 'w' : ''}">${lab}${el}${h ? `<div class="fz-hint">${esc(h)}</div>` : ''}</div>`;
  }
  const FMAP = {}; // data-k → field (for reading)
  function fieldsOf(s) {
    if (s.f === 'ovr') return D.prem.filter(([k]) => !LUMPK.includes(k) && (is3311() || k !== 'ptc')).map(([k, l]) => ({ k: 'ovr.' + k, l, u: '₹ Cr', cr: 1, std: 1, ph: R && R.premAuto ? nf(R.premAuto[k] / 1e7, 2) : '' }));
    if (s.f === 'assume') return STD.filter((x) => !x[4] || x[4].includes(D.project.kind)).map(([k, l, u, pct]) => ({ k: 'assume.' + k, l, u, pct, std: 1, ph: show(ruleVal(k), { pct }) }));
    return s.f.filter(kindOk);
  }
  function inputsHtml() {
    let step = 0;
    const how = `<div class="fz-how"><b class="t">How to fill this in</b><ol>
      <li>Fill the <span class="sw"></span><b>yellow boxes</b> step by step, top to bottom. Boxes marked <b class="fz-req">*</b> are needed for a result.</li>
      <li>Pick from the drop-downs what your architect advises (rehab area per home, loading). Tap any <b>?</b> to see what a word means.</li>
      <li>The result on the right updates as you type. Press <b>Save</b>, then <b>Download report (PDF)</b> to share it.</li></ol></div>`;
    return how + SECS.filter(kindOk).map((s) => {
      const fs = fieldsOf(s); fs.forEach((f) => (FMAP[f.k] = f));
      const mh = D.project.kind === 'sra' || /maharashtra/i.test(D.project.state || '');
      const asr = mh ? `<details class="fz-asr" ${inputs.asrLand ? "" : "open"}><summary>Where to find the ready reckoner (ASR) rates</summary><ol>
        <li>Open the Maharashtra IGR site: <a href="https://igrmaharashtra.gov.in" target="_blank" rel="noopener">igrmaharashtra.gov.in</a>, and choose <b>eASR</b> (annual statement of rates).</li>
        <li>Pick the <b>year</b> (the current one), then the <b>district</b>, <b>taluka</b> and <b>village</b> of the plot. The village is on the property card or 7/12.</li>
        <li>Pick the <b>zone</b> the plot falls in. Your architect or the CTS number tells you which.</li>
        <li>Copy the <b>open land</b> rate into the first yellow box below, and the <b>construction</b> rate (the RCC one) into the second. Both are in ₹ per sq m.</li></ol>
        <div style="margin-top:6px">The ERP does not fill these in for you because the rates change every year and differ zone by zone. Once entered here, every new option for this project starts with them.</div></details>`
        : `<div class="fz-asr"><b>Government rates:</b> enter your state's guidance value (circle rate) for the plot's area in ₹ per sq m. Your sub-registrar office or the state registration website lists it.</div>`;
      const extra = s.id === 'fsi' ? `<div class="fz-note">${esc(D.rules.code)}. ${esc(D.rules.note)}</div>${asr}` : s.id === 'assume' && D.canRules ? `<div class="w"><button type="button" class="ghost small" id="fzRules">Make these the company's starting figures for ${esc(D.project.state || 'this state')}</button><div class="fz-hint">Every new option in a ${esc(D.project.state || '')} project then starts from them.${D.rules.own.length ? ` ${D.rules.own.length} figure${D.rules.own.length === 1 ? ' is' : 's are'} already the company's own.` : ''}</div></div>` : '';
      return `<details class="fz-sec" data-sec="${s.id}" ${s.open ? 'open' : ''}><summary><span class="l">${s.open ? `<span class="n">${++step}</span>` : ''}<span class="st">${esc(s.t)}${s.d ? `<em>${esc(s.d)}</em>` : ''}</span></span>${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</summary><div class="fz-f">${extra}${fs.map(field).join('')}</div></details>`;
    }).join('');
  }

  // ---- the results ----
  function tableHtml(sec, opts = {}) {
    if (!sec || !sec.rows) return '<p class="small muted" style="margin:0">Not worked out yet.</p>';
    const n = sec.cols.length;
    return `<table class="fz-t">${sec.cols.some(Boolean) ? `<tr>${sec.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>` : ''}${sec.rows.map((r, k) => `<tr class="${/in all$/.test(r[0]) ? 'tot' : ''}">${r.map((c, j) => {
      let cls = '';
      if (opts.sens && j > 0) { const v = R.sens.grid[k][j - 1]; cls = (v >= R.target ? 'g' : v >= R.amber ? 'a' : 'r') + (R.sens.con[k] === 0 && R.sens.sale[j - 1] === 0 ? ' base' : ''); }
      return `<td class="${cls}">${esc(String(c).replace(/Rs\. /g, '₹'))}</td>`; }).join('')}${n > r.length ? '<td></td>'.repeat(n - r.length) : ''}</tr>`).join('')}</table>`;
  }
  function resultsHtml() {
    if (!R) return '<div class="panel muted">Working it out…</div>';
    // by title, and also by the title's first words, so a renamed section never breaks the page
    const S = {}; (R.sections || []).forEach((s) => { S[s.title] = s; S[s.title.split(' (')[0]] = s; });
    const max = Math.max(1, ...R.cats.map((c) => c[1]));
    const T = (t, inner) => `<div class="panel" style="margin:0;min-width:0"><h2 class="sm">${esc(t)}</h2><div style="overflow-x:auto">${inner}</div></div>`;
    return `<div class="fz-call ${TONE[R.status]}"><b>${esc(R.verdict)}</b><span>${esc(R.why)}</span></div>
      ${R.warn.map((w) => `<div class="fz-warn">${esc(w)}</div>`).join('')}
      ${R.status === 'INCOMPLETE' ? '' : `<div class="fz-plain"><b>In plain words:</b> the project earns ${cr(R.revenue)} and costs ${cr(R.total)}, leaving ${cr(R.profit)} of profit, that is ₹${Math.round((R.margin || 0) * 100)} for every ₹100 spent.
        ${R.breakeven ? ` Flats must sell at <b>₹${nf(R.breakeven)}</b> a sq ft (carpet) just to cover the cost, and at <b>₹${nf(R.minRate)}</b> to reach your ${pc(R.target)} target. You have entered ₹${nf(inputs.rateRes)}.` : ''}
        You can sell about ${nf(R.saleable)} sq ft of carpet.</div>`}
      <div class="fz-k">${[[cr(R.revenue), 'Revenue', 'All sales: flats, shops, parking and TDR'], [cr(R.total), 'Total cost', 'Everything you spend, including premiums and rent'], [cr(R.profit), 'Profit', 'Revenue minus total cost'], [pc(R.margin), 'Margin on cost', 'Profit ÷ total cost'], [R.irr == null ? '—' : pc(R.irr), 'IRR (yearly return)', 'The yearly return on the money put in'], [R.fsiAchieved.toFixed(2), 'FSI used (without fungible)', 'Built-up area counted ÷ plot area'],
        [nf(R.saleable), 'Saleable carpet (sq ft)', 'The area you can sell'], ...(R.tdrGen ? [[nf(R.tdrGen * 10.7639), 'TDR generated (sq ft)', 'Building rights left over that you can sell']] : []), ...(R.tdrBuyArea ? [[nf(R.tdrBuyArea * 10.7639), 'TDR to buy (sq ft)', 'Building rights you must buy']] : []), [cr(R.peak), 'Peak funding', 'Most money out of pocket at one time']].map(([v, l, t]) => `<div title="${esc(t)}"><b>${v}</b><span>${esc(l)}</span><span class="d">${esc(t)}</span></div>`).join('')}</div>
      ${T('Area statement: FSI and TDR', tableHtml(S['Area statement: FSI and TDR']))}
      ${T('Where the money goes', `<div class="fz-bars">${R.cats.map(([l, v]) => `<div class="fz-bar"><span>${esc(l)}</span><u><i style="width:${Math.max(1, v / max * 100).toFixed(1)}%"></i></u><b>${cr(v)}</b></div>`).join('')}</div>`)}
      ${T('Revenue', tableHtml(S.Revenue))}
      ${T('Costs', tableHtml(S.Costs))}
      ${T('Rates to watch', tableHtml(S['Rates to watch']))}
      ${T('What if: margin on cost', `<p class="small muted" style="margin:0 0 8px">Sale rate across, construction cost down. Green meets the ${pc(R.target)} target; amber is above ${pc(R.amber)}.</p>${tableHtml(S['What if: margin on cost'], { sens: 1 })}`)}
      ${T('Cash flow by year', `<p class="small muted" style="margin:0 0 8px">Over the ${R.years || 4}-year project duration: land, premiums and rehab first, the sale building and sales later.</p>${tableHtml(S['Cash flow by year'])}`)}`;
  }
  function estPh(f) { const v = estOf(f.est); return v ? 'about ' + (f.cr ? (v / 1e7).toFixed(2) : nf(v, 1)) : v === 0 ? '0' : 'worked out'; }
  function safeResults() {
    try { return resultsHtml(); } catch (e) { return '<div class="err">The result could not be shown. Press Cmd+Shift+R (Ctrl+F5 on Windows) to load the latest version of the ERP.</div>'; }
  }
  function paintResults() {
    const el = $('#fzRes');
    if (el) el.innerHTML = safeResults();
    Object.values(FMAP).filter((f) => f.est).forEach((f) => { const x = $('#fz_' + f.k); if (x) x.placeholder = estPh(f); });
  }
  async function calc() {
    try { R = (await C.api('/api/feasibility', { ...own(), action: 'calc', inputs })).result; paintResults(); }
    catch (e) { const el = $('#fzRes'); if (el) el.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  const later = () => { dirty = true; const m = $('#fzDirty'); if (m) m.hidden = false; clearTimeout(timer); timer = setTimeout(calc, 350); };

  // ---- the page ----
  function head() {
    const p = D.project;
    if (p.site) return `<div class="page-head"><div><a class="muted small" href="#/opportunities">← New opportunities</a><h1>Feasibility: ${esc(p.name)}</h1>
      <p class="muted">A new opportunity: ${esc(KINDL[p.kind] || 'project')}${p.city ? ' in ' + esc(p.city) : ''}${p.state ? ', ' + esc(p.state) : ''}. ${esc(D.rules.code)}.
      ${p.project_id ? '<b>Already converted to a project.</b>' : 'No project is made until you press Convert to project.'}</p></div>
      ${D.canEdit && !p.project_id ? `<div class="actions"><button type="button" class="ghost danger" id="fzSiteDel">Take off the list</button><button type="button" class="ghost" id="fzSiteEdit">Edit details</button>${D.canConvert ? '<button type="button" id="fzConvert">Convert to project</button>' : ''}</div>` : ''}</div>`;
    return `<div class="page-head"><div><a class="muted small" href="#/project/${p.id}">← ${esc(p.name)}</a><h1>Feasibility</h1>
      <p class="muted">What the land can carry (FSI and TDR), what it costs and earns, and whether to go ahead. ${esc(D.rules.code)}.</p></div></div>`;
  }
  function optsBar() {
    return `<div class="fz-opts">${D.list.map((x) => `<button type="button" class="fz-opt ${cur && cur.id === x.id ? 'on' : ''}" data-opt="${x.id}">${esc(x.name)}${x.cts || x.plot ? `<small>${x.cts ? 'CTS ' + esc(x.cts) : ''}${x.cts && x.plot ? ' · ' : ''}${x.plot ? nf(x.plot) + ' sq m' : ''}</small>` : ''}<small><span class="pill ${TONE[x.status]}">${esc(x.verdict)}</span> ${x.status === 'INCOMPLETE' ? '' : `margin ${pc(x.margin)} · ${cr(x.profit)}`}</small></button>`).join('')}
      ${D.canEdit ? '<button type="button" class="ghost" id="fzNew">+ New option</button>' : ''}</div>`;
  }
  function paint() {
    const p = D.project;
    if (!cur) {
      $('#page').innerHTML = `<div class="fz"><style>${css}</style>${head()}${optsBar()}<div class="panel empty">${D.list.length ? 'Pick an option above.' : `<b>No feasibility yet.</b><br>Start an option with the plot area, ${p.kind === 'sra' ? 'the slum survey' : p.kind === 'redevelopment' ? 'the society members' : 'the land'}, the ready reckoner rate, the sale rate and the construction rate. Zuri fills the ${esc(D.rules.code)} rules and works out the rest.${D.canEdit ? '<br><br><button type="button" id="fzNew2">Start the first option</button>' : ''}`}</div></div>`;
      wireTop(); return;
    }
    $('#page').innerHTML = `<div class="fz"><style>${css}</style>${head()}${optsBar()}
      <div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div style="flex:1 1 240px"><label>Option name</label><input id="fzName" value="${esc(cur.name)}" maxlength="80" ${D.canEdit ? '' : 'disabled'} style="margin:0"></div>
        ${D.canEdit ? `<button type="button" id="fzSave">Save</button>${S ? '' : '<button type="button" class="ghost" id="fzFill">Fill from this project</button>'}` : ''}
        <button type="button" class="ghost" id="fzPdf">Download report (PDF)</button><button type="button" class="ghost" id="fzXl">Excel</button>
        ${D.canEdit && cur.id ? '<button type="button" class="ghost" id="fzCopy">Copy</button><button type="button" class="ghost danger" id="fzDel">Remove</button>' : ''}
        <span class="fz-dirty" id="fzDirty" ${dirty ? '' : 'hidden'}>Not saved yet</span>
      </div>
      <div class="fz-seg"><button type="button" data-pane="inputs" class="${pane === 'inputs' ? 'on' : ''}">Figures</button><button type="button" data-pane="results" class="${pane === 'results' ? 'on' : ''}">Results</button></div>
      <div class="fz-split" data-pane="${pane}"><div class="fz-in" id="fzIn">${inputsHtml()}</div><div class="fz-res" id="fzRes">${safeResults()}</div></div></div>`;
    wireTop(); wire();
  }
  function wireTop() {
    $$('[data-opt]').forEach((b) => (b.onclick = async () => { if (dirty && !(await zConfirm('This option has changes that are not saved. Leave them?'))) return; await open(+b.dataset.opt); }));
    const nw = async () => {
      if (dirty && !(await zConfirm('This option has changes that are not saved. Leave them?'))) return;
      cur = { id: null, name: `Option ${String.fromCharCode(65 + Math.min(25, D.list.length))}` }; inputs = {}; dirty = true; R = null;
      try { const f = await C.api(`/api/feasibility?${qs()}&from=project`); inputs = { ...f.inputs }; if (f.said.length) C.toast((S ? 'Carried over: ' : 'Filled from this project: ') + f.said.join('; ') + '.'); } catch {}
      paint(); calc();
    };
    if ($('#fzNew')) $('#fzNew').onclick = nw;
    if ($('#fzSiteEdit')) $('#fzSiteEdit').onclick = () => siteForm(D.project, async () => { D = await C.api('/api/feasibility?' + qs()); paint(); if (cur) calc(); });
    if ($('#fzConvert')) $('#fzConvert').onclick = () => convert(D.project);
    if ($('#fzSiteDel')) $('#fzSiteDel').onclick = async () => {
      if (!(await zConfirm(`Take the opportunity "${D.project.name}" and all its options off the list?`))) return;
      try { await C.api('/api/feasibility', { action: 'site-delete', id: S }); dirty = false; location.hash = '#/opportunities'; } catch (e) { C.toast(e.message); }
    };
    if ($('#fzNew2')) $('#fzNew2').onclick = nw;
  }
  function wire() {
    const box = $('#fzIn');
    box.addEventListener('input', (e) => {
      const el = e.target, k = el.dataset.k; if (!k) return;
      if (k === 'notes' || (FMAP[k] && FMAP[k].txt)) set(k, el.value.trim() ? el.value : '');
      else if (k === 'road' || k === 'scheme') { set(k, el.value); }
      else if (el.tagName === 'SELECT') set(k, +el.value);
      else set(k, read(el.value, FMAP[k] || {}));
      later();
    });
    box.addEventListener('change', (e) => { if (['road', 'scheme'].includes(e.target.dataset.k)) { const keep = $$('details.fz-sec', box).map((d) => d.open); $('#fzIn').innerHTML = inputsHtml(); $$('details.fz-sec', box).forEach((d, k) => (d.open = keep[k])); } });
    $$('.fz-seg button').forEach((b) => (b.onclick = () => { pane = b.dataset.pane; $$('.fz-seg button').forEach((x) => x.classList.toggle('on', x === b)); $('.fz-split').dataset.pane = pane; }));
    const nm = $('#fzName'); if (nm) nm.oninput = () => { cur.name = nm.value; dirty = true; $('#fzDirty').hidden = false; };
    if ($('#fzSave')) $('#fzSave').onclick = save;
    if ($('#fzFill')) $('#fzFill').onclick = async () => {
      try { const f = await C.api(`/api/feasibility?${qs()}&from=project`); if (!f.said.length) { C.toast('This project has no register, members or land recorded yet.'); return; } Object.assign(inputs, f.inputs); dirty = true; paint(); calc(); C.toast('Filled: ' + f.said.join('; ') + '.'); } catch (e) { C.toast(e.message); }
    };
    if ($('#fzCopy')) $('#fzCopy').onclick = async () => { try { D = await C.api('/api/feasibility', { ...own(), action: 'copy', id: cur.id }); dirty = false; await open(D.saved); C.toast('Copied. Change the figures to compare.'); } catch (e) { C.toast(e.message); } };
    if ($('#fzDel')) $('#fzDel').onclick = async () => { if (!(await zConfirm(`Remove "${cur.name}"?`))) return; try { D = await C.api('/api/feasibility', { ...own(), action: 'delete', id: cur.id }); cur = null; dirty = false; paint(); } catch (e) { C.toast(e.message); } };
    const dl = async (what) => {
      if (dirty || !cur.id) { if (!D.canEdit) return; await save(); if (dirty) return; }
      try { const r = await C.api(`/api/feasibility?${qs()}&id=${cur.id}&${what}=1`); const a = document.createElement('a'); a.href = URL.createObjectURL(blob(r.data, what === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { C.toast(e.message); }
    };
    $('#fzPdf').onclick = () => dl('pdf'); $('#fzXl').onclick = () => dl('excel');
    const rb = $('#fzRules');
    if (rb) rb.onclick = async () => {
      if (!(await zConfirm(`Make the standard figures of this option the company's starting figures for ${D.project.state || 'this state'}? Options already saved keep their own figures where they were changed.`))) return;
      try { D = await C.api('/api/feasibility', { ...own(), action: 'rules', assume: inputs.assume || {} }); C.toast('Saved as the company\'s starting figures.'); paint(); calc(); } catch (e) { C.toast(e.message); }
    };
  }
  async function save() {
    try {
      D = await C.api('/api/feasibility', { ...own(), action: 'save', id: cur.id || undefined, name: cur.name, inputs });
      cur.id = D.saved; dirty = false; C.toast('Saved.'); paint(); calc();
    } catch (e) { C.toast(e.message); }
  }
  async function open(id) {
    const r = await C.api(`/api/feasibility?${qs()}&id=${id}`);
    cur = { id: r.option.id, name: r.option.name }; inputs = JSON.parse(JSON.stringify(r.option.inputs || {})); R = r.result; dirty = false;
    try { sessionStorage.setItem('erp_feas_' + (S ? 's' + S : P), id); } catch {}
    paint();
  }

  // ---- new opportunities: feasibility before a project exists ----
  let SD = null; // { sites, states, home, canEdit }
  function siteForm(x, after) {
    const st = (x && x.state) || (SD && SD.home) || '', states = (SD && SD.states) || [st].filter(Boolean);
    const dl = C.dialog(`<h2>${x && x.id ? 'Edit the opportunity' : 'A new opportunity'}</h2>
      <p class="muted" style="margin-top:0">Check a site before you take it on. Nothing is added to your projects until you press Convert to project.</p>
      <label>Name</label><input name="name" required maxlength="120" value="${esc(x && x.name)}" placeholder="e.g. Oshiwara CTS 446C">
      <div class="row"><div><label>What would it be?</label><select name="kind">${Object.entries(KINDL).map(([k, l]) => `<option value="${k}" ${(x && x.kind) === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label>State (its rules apply)</label><select name="state">${states.map((v) => `<option ${v === st ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
      <label>Area or city</label><input name="city" maxlength="120" value="${esc(x && x.city)}" placeholder="e.g. Andheri West, Mumbai">
      <label>Notes</label><textarea name="notes" rows="2" maxlength="2000" placeholder="Who brought it, the owner's or society's ask, anything to remember">${esc(x && x.notes)}</textarea>
      <p class="small muted">Next you fill the CTS number, plot area, rates and costs on the feasibility screen.</p>`,
    async (v) => { const r = await C.api('/api/feasibility', { action: 'site-save', id: x && x.id, ...v }); if (SD) SD.sites = r.sites; after(r); });
    // SRA exists only in Maharashtra: picking it sets the state for the user
    const kSel = dl.querySelector('select[name=kind]'), sSel = dl.querySelector('select[name=state]');
    if (kSel && sSel) kSel.addEventListener('change', () => { if (kSel.value === 'sra' && [...sSel.options].some((o) => o.value === 'Maharashtra')) sSel.value = 'Maharashtra'; });
    return dl;
  }
  function convert(site) {
    if (!window.ErpNewProject) { C.toast('Add the project in the ERP first (Admin), then come back and convert it.'); return; }
    window.ErpNewProject({ name: site.name, kind: site.kind, state: site.state, location: site.city, active: true }, async (np) => {
      if (!np) { C.toast('The project was not added.'); return; }
      try {
        await C.api('/api/feasibility', { action: 'site-link', id: site.id, project: np.id });
        C.toast(`${np.name} is now a project. Its feasibility options moved with it.`);
        location.hash = '#/feasibility/' + np.id;
      } catch (e) { C.toast(e.message); }
    });
  }
  function sitesHtml() {
    const live = SD.sites.filter((x) => !x.project_id), done = SD.sites.filter((x) => x.project_id);
    const rows = [];
    live.forEach((x) => x.options.forEach((o) => rows.push({ x, o })));
    const mg = (o) => (o.status === 'INCOMPLETE' ? -9 : o.margin || 0);
    rows.sort((a, b) => mg(b.o) - mg(a.o));
    const card = (x) => {
      const best = x.options.filter((o) => o.status !== 'INCOMPLETE').sort((a, b) => b.margin - a.margin)[0];
      return `<a class="fz-site" href="#/opportunities/${x.id}"><b>${esc(x.name)}</b>
        <small>${esc(KINDL[x.kind] || '')}${x.city ? ' · ' + esc(x.city) : ''}${x.state ? ', ' + esc(x.state) : ''}</small>
        <small>${x.cts ? 'CTS ' + esc(x.cts) + ' · ' : ''}${x.plot ? nf(x.plot) + ' sq m' : 'plot area not entered yet'}</small>
        <span>${best ? `<span class="pill ${TONE[best.status]}">${esc(best.verdict)}</span> best margin ${pc(best.margin)} · ${cr(best.profit)} profit` : '<span class="pill grey">Not worked out yet</span>'} · ${x.options.length} option${x.options.length === 1 ? '' : 's'}</span></a>`;
    };
    return `<div class="fz"><style>${css}</style>
      <div class="page-head"><div><h1>New opportunities</h1><p class="muted">Check whether a new site is worth taking on, before it becomes a project. Enter the site and its figures, try a few options, compare them, download the report, and convert the good one into a project.</p></div>
        ${SD.canEdit ? '<div class="actions"><button type="button" id="fzSiteNew">+ New opportunity</button></div>' : ''}</div>
      ${live.length ? `<div class="fz-sites">${live.map(card).join('')}</div>` : `<div class="panel empty"><b>No opportunities yet.</b><br>Press <b>+ New opportunity</b>, give the site a name and its type, then fill the yellow boxes.</div>`}
      ${rows.length > 1 ? `<div class="panel"><h2 class="sm">Compare</h2><p class="small muted" style="margin:0 0 8px">Every option of every opportunity, the best margin first.</p><div style="overflow-x:auto"><table class="fz-t fz-cmp">
        <tr><th>Opportunity</th><th>Option</th><th>CTS · plot</th><th>Revenue</th><th>Total cost</th><th>Profit</th><th>Margin on cost</th><th>IRR</th><th>Call</th></tr>
        ${rows.map(({ x, o }) => `<tr><td><a href="#/opportunities/${x.id}">${esc(x.name)}</a></td><td>${esc(o.name)}</td><td>${x.cts ? 'CTS ' + esc(x.cts) : '—'}${x.plot ? ' · ' + nf(x.plot) + ' sq m' : ''}</td>
          <td>${cr(o.revenue)}</td><td>${cr(o.total)}</td><td>${cr(o.profit)}</td><td>${o.status === 'INCOMPLETE' ? '—' : pc(o.margin)}</td><td>${o.irr == null ? '—' : pc(o.irr)}</td><td><span class="pill ${TONE[o.status]}">${esc(o.verdict)}</span></td></tr>`).join('')}</table></div></div>` : ''}
      ${done.length ? `<div class="panel"><h2 class="sm">Already projects</h2>${done.map((x) => `<p style="margin:4px 0"><a href="#/feasibility/${x.project_id}">${esc(x.name)}</a> <span class="muted small">became ${esc(x.project_name || 'a project')}</span></p>`).join('')}</div>` : ''}
    </div>`;
  }
  async function sites(ctx) {
    C = ctx; S = null; P = null;
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    try { SD = await withTime(C.api('/api/feasibility?sites=1')); } catch (e) { return stuck(e, () => sites(ctx)); }
    $('#page').innerHTML = sitesHtml();
    if ($('#fzSiteNew')) $('#fzSiteNew').onclick = () => siteForm(null, (r) => { location.hash = '#/opportunities/' + r.id; });
  }

  async function render(ctx, projectId, siteId) {
    C = ctx; P = projectId || null; S = siteId || null; cur = null; R = null; dirty = false; inputs = {};
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    try { D = await withTime(C.api('/api/feasibility?' + qs())); } catch (e) { return stuck(e, () => render(ctx, projectId, siteId)); }
    let last = null; try { last = +sessionStorage.getItem('erp_feas_' + (S ? 's' + S : P)); } catch {}
    const pick = D.list.find((x) => x.id === last) || D.list[0];
    try { if (pick) await withTime(open(pick.id)); else paint(); } catch (e) {
      // an option that will not open never blocks the screen: show the list without it
      try { sessionStorage.removeItem('erp_feas_' + (S ? 's' + S : P)); } catch {}
      cur = null; R = null; try { paint(); C.toast('That option could not be opened: ' + e.message); } catch (e2) { stuck(e2, () => render(ctx, projectId, siteId)); }
    }
  }
  // never leave "Loading…" on screen: after 25 seconds, or on an error, say so with a Try again button
  function withTime(pr) { return Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('The server took too long to answer.')), 25000))]); }
  function stuck(e, again) {
    $('#page').innerHTML = `<div class="panel"><h2 class="sm">The feasibility screen could not load</h2><p class="muted">${esc((e && e.message) || 'Something went wrong.')}</p><div class="actions"><button type="button" id="fzAgain">Try again</button></div></div>`;
    $('#fzAgain').onclick = again;
  }
  window.Feasibility = { render, sites };
})();
