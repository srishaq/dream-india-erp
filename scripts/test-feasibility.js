// Feasibility (api/feasibility.js, lib/feasibility.js, lib/feasibility-report.js): the FSI and TDR model for SRA,
// redevelopment and new development, options saved and copied, figures from the project's own screens, the company's
// own starting figures, the PDF and Excel report, the sample options and who may change what.
// DATABASE_URL=postgres://... node scripts/test-feasibility.js   (an empty database)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
const F = require('../lib/feasibility');
const X = require('../lib/xlsx');

function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not about ${b}`);

(async () => {
  // ---- the model on its own ----
  const MH = { assume: F.BASE, roads: F.MH_ROADS, road: '12to18' };
  await step('SRA: rehab component, PAP by density, incentive by LR/RC, no FSI cap by default, TDR only under a cap', async () => {
    const R = F.compute('sra', { grossPlot: 2600, roadSetback: 150, tenRes: 54, tenComm: 6, amenityArea: 120, asrLand: 128000, asrConstr: 30250 }, MH);
    assert.equal(R.netPlot, 2450);
    assert.equal(R.densityUnits, 160); assert.equal(R.pap, 100); assert.equal(R.tenements, 160);
    assert.equal(R.rehabComp, 54 * 50 + 6 * 50 + 100 * 50 + 120 * 1.5);
    near(R.rehabFSI, 160 * 50 / 1.5, 0.01);
    assert.equal(R.incRatio, 0.9, 'LR/RC 4.23 is in the 4 to 6 band');
    assert.equal(R.tdrGen, 0, 'no cap: everything on the plot');
    near(R.saleBUA, R.incBUA * 1.35, 0.01);
    const capped = F.compute('sra', { grossPlot: 2600, roadSetback: 150, tenRes: 54, tenComm: 6, asrLand: 128000, asrConstr: 30250, assume: { fsiCap: 4, raRes: 40 } }, MH);
    near(capped.tdrGen, capped.rehabComp + capped.incBUA - 9800, 0.01);
    assert.ok(capped.warn.some((w) => /no price for that TDR/.test(w)), 'TDR without a price is flagged');
    assert.ok(!F.compute('sra', { grossPlot: 2600, tenRes: 54, asrLand: 128000, asrConstr: 30250, tdrSaleRate: 4000, assume: { fsiCap: 4 } }, MH).warn.some((w) => /no price/.test(w)));
    assert.equal(F.compute('sra', { grossPlot: 10000, tenRes: 54, asrLand: 50000, asrConstr: 30000 }, MH).incRatio, 1.15);
    assert.equal(F.compute('sra', { grossPlot: 2600, tenRes: 54, papOverride: 10, asrLand: 1, asrConstr: 1 }, MH).pap, 10);
  });
  await step('SRA: a real consultant\'s 33(10) report (CTS 446C) is reproduced within a few percent', async () => {
    const R = F.compute('sra', { grossPlot: 5627.45, roadSetback: 1227.77, tenRes: 113, amenityArea: 601.47, asrLand: 56350, asrConstr: 30250, rateRes: 19000, parkNos: 450, parkRate: 500000,
      rateSaleCon: 3200, rateRehabCon: 3200, rentRes: 25000, rentNos: 189, setbackTdr: 3471.9, landscapeArea: 26046.99, landCost: 5e7, osdCost: 1.64e7, stairCost: 0.83e7, legalCost: 0.05e7,
      moefCost: 0.5e7, aviationCost: 0.5e7, annexCost: 1.74e7, cfoCost: 1.29e7, societyCost: 2e7, debtAmt: 35.714e7, assume: { debtYears: 2 } }, MH);
    assert.equal(R.pap, 173); assert.equal(R.incRatio, 1.15);
    near(R.saleBUA, 23683.13, 120); near(R.fsiAchieved, 6.16, 0.05);
    near(R.cSale / 1e7, 146.84, 1); near(R.cRehab / 1e7, 70.94, 1); near(R.prem.fung / 1e7, 17.30, 0.3);
    near(R.revenue / 1e7, 463.43 + 22.5, 3); near(R.total / 1e7, 376.25, 6); near(R.margin, 0.3061, 0.01);
    near(R.revSetback / 1e7, 10.76, 0.01); near(R.rentGst / 1e7, 1.01, 0.05);
  });
  await step('Reg. 33(11): a real consultant\'s report (CTS 620A-1A-4E, Malad East) is reproduced; substructure, PTC and the new charges', async () => {
    const i = { scheme: '3311', grossPlot: 6000, roadSetback: 300, ptcNos: 143, ptcRate: 180000, asrLand: 87450, rateRes: 32000, parkNos: 450, parkRate: 1000000,
      rateSaleCon: 4500, rateSubCon: 2500, landscapeArea: 33745, osdCost: 3.19e7, stairCost: 0.80e7, cfoCost: 0.95e7, moefCost: 2.5e7, aviationCost: 0.5e7, legalCost: 0.05e7,
      unearnedCost: 5.88e7, bgCost: 0.09e7, assessCost: 3.42e7, plumbingCost: 1.39e7, prorataCost: 0.39e7, debtAmt: 150e7, contingency: 2e7,
      assume: { saleLoad: 0.9, effPct: 22293.58 / 24300, landscapeRate: 1000, debtRate: 0.08, debtYears: 4, fungRes: 0.6 } };
    for (const kind of ['new', 'sra']) {
      const R = F.compute(kind, i, MH);
      // the consultant: FSI 3 on the whole 6,000 sq m; 6,000 zonal + 6,000 free sale + 6,000 in lieu of PTC; fungible 6,300; cost 505.23, profit 307.67 (61.1%)
      assert.equal(R.netPlot, 6000); assert.equal(R.fsiArea, 18000); assert.equal(R.freeSale, 6000); assert.equal(R.ptcArea, 6000); assert.equal(R.saleBUA, 24300);
      near(R.prem.ptc / 1e7, 108, 0.01); near(R.prem.fung / 1e7, 33.06, 0.05); near(R.cSub / 1e7, 58.85, 0.05); near(R.cSale / 1e7, 117.70, 0.1);
      near(R.total / 1e7, 505.23, 5); near(R.profit / 1e7, 307.67, 5); near(R.margin, 0.611, 0.01);
      assert.equal(R.rent, 0); assert.equal(R.setbackTdr, 0); assert.equal(R.status, 'GO');
    }
    // the PTC cost is needed; without the scheme nothing changes
    assert.ok(F.compute('new', { ...i, ptcRate: '' }, MH).missing.includes('PTC cost per sq m'));
    const std = F.compute('new', { ...i, scheme: '' }, MH);
    assert.equal(std.ptcArea, 0); assert.ok(std.netPlot < 6000);
    // a blank assessment and bank guarantee are estimated; without a substructure rate the whole building is at one rate
    const e = F.compute('sra', { scheme: '3311', grossPlot: 6000, ptcNos: 100, ptcRate: 1, asrLand: 50000, rateRes: 1, rateSaleCon: 1 }, MH);
    assert.ok(e.lumpIsEst.luc && e.lumpIsEst.bg); assert.equal(e.prem.bg, 100 * 450000 * 0.02); assert.equal(e.cSub, 0);
  });
  await step('blank one-time payments are estimated (premiums, fire, MoEF over 20,000 sq m, Annexure-II, borrowing); a typed figure wins', async () => {
    const i = { grossPlot: 5627.45, roadSetback: 1227.77, tenRes: 113, amenityArea: 601.47, asrLand: 56350, asrConstr: 30250, rateRes: 19000, parkNos: 450, parkRate: 500000, rateSaleCon: 3200, rateRehabCon: 3200, rentRes: 25000, rentNos: 189, setbackTdr: 3471.9, landscapeArea: 26046.99, landCost: 5e7, societyCost: 2e7 };
    const R = F.compute('sra', i, MH);
    // the consultant's report (CTS 446C) had OSD 1.64, staircase 0.83, CFO 1.29, MoEF 0.50, Annexure-II 1.74, legal 0.05, interest 10.00 (₹ Cr)
    near(R.prem.osd / 1e7, 1.64, 0.1); near(R.prem.stair / 1e7, 0.83, 0.1); near(R.prem.cfo / 1e7, 1.29, 0.15); assert.equal(R.prem.moef, 5e6);
    near(R.prem.annex / 1e7, 1.74, 0.1); assert.equal(R.prem.legal, 5e5); assert.ok(R.debtAuto && R.lumpIsEst.osd);
    near(R.margin, 0.3061, 0.03);
    // the project's duration (3, 4 or 5 years, 4 when not chosen) sets the cash flow years, and so the interest and IRR
    assert.equal(R.years, 4); assert.equal(R.cf.length, 4);
    const y3 = F.compute('sra', i, { ...MH, assume: { ...F.BASE, years: 3 } }), y5 = F.compute('sra', i, { ...MH, assume: { ...F.BASE, years: 5 } });
    assert.equal(y3.cf.length, 3); assert.equal(y5.cf.length, 5); assert.ok(y3.finance < R.finance && R.finance < y5.finance, 'longer costs more interest');
    assert.ok(y3.irr > R.irr && R.irr > y5.irr, 'longer lowers the IRR');
    for (const y of [3, 4, 5]) for (const [k, v] of Object.entries(F.PHASES[y])) assert.equal(v.reduce((x, z) => x + z, 0), 100, `${y} years: ${k}`);
    assert.equal(F.compute('sra', { ...i, debtAmt: 1e8 }, MH).finance, 1e8 * 0.14 * 4, 'borrowing entered: for the whole project');
    // TDR for the land handed over: 2 × (road set-back + amenity plot) unless the architect's figure is typed
    const sb = F.compute('sra', { ...i, setbackTdr: undefined, amenityPlot: 100 }, MH);
    assert.ok(sb.setbackTdrAuto); near(sb.setbackTdr, 2 * (1227.77 + 100), 0.01); near(sb.revSetback, sb.setbackTdr * 56350 * 0.55, 1);
    const typed = F.compute('sra', i, MH); assert.ok(!typed.setbackTdrAuto); assert.equal(typed.setbackTdr, 3471.9);
    const own = F.compute('sra', { ...i, osdCost: 0, moefCost: 1e7, debtAmt: 0 }, MH);
    assert.equal(own.prem.osd, 0); assert.equal(own.prem.moef, 1e7); assert.equal(own.finance, 0); assert.ok(!own.lumpIsEst.osd);
    const small = F.compute('new', { grossPlot: 1000, asrLand: 50000, rateRes: 15000, rateSaleCon: 3000 }, MH);
    assert.equal(small.prem.moef || 0, 0, 'no MoEF under 20,000 sq m'); assert.equal(small.prem.osd || 0, 0); assert.equal(small.prem.aviation || 0, 0);
  });
  await step('new development: the road width sets basic + premium + TDR; premium, TDR bought and fungible are charged', async () => {
    const i = { grossPlot: 10000, road: '18to27', asrLand: 50000, tdrBuyRate: 2500, rateRes: 10000, rateSaleCon: 2600 };
    const R = F.compute('new', i, MH);
    near(R.fsiArea, 10000 * 2.4); near(R.premArea, 5000); near(R.tdrBuyArea, 9000);
    near(R.fungArea, 24000 * 0.35); near(R.saleBUA, 24000 * 1.35);
    near(R.prem.premFSI, 5000 * 50000 * 0.5); near(R.prem.tdrBuy, 9000 * F.SQFT * 2500, 1);
    near(R.prem.fung, 24000 * 0.35 * 50000 * 0.5, 1);
    const own = F.compute('new', { ...i, tdrFSI: 0 }, MH); near(own.tdrBuyArea, 0); assert.equal(own.prem.tdrBuy, 0);
    assert.equal(F.compute('new', { ...i, road: 'lt9' }, MH).fsiArea, 10000);
    const ovr = F.compute('new', { ...i, ovr: { fung: 12345 } }, MH); assert.equal(ovr.prem.fung, 12345); assert.equal(ovr.premOwn.fung, true);
  });
  await step('redevelopment: 33(7)(B) incentive, members\' new area against the sale area, rent, corpus and shifting', async () => {
    const R = F.compute('redevelopment', { grossPlot: 2400, roadSetback: 120, road: '12to18', members: 40, shops: 4, existingCarpet: 26400, existingBUA: 3100, extraPct: 30, rentRes: 35000, corpusPer: 300000, shiftPer: 50000 }, MH);
    near(R.incentive, 3100 * 0.15); assert.equal(R.tenements, 44);
    near(R.newCarpet, 26400 * 1.3); near(R.rehabBUA, 26400 * 1.3 / 0.935 / F.SQFT, 0.01);
    near(R.saleBUA, (2280 * 2.2 + 465) * 1.35 - R.rehabBUA, 0.01);
    near(R.memberCorpus, 44 * 300000); near(R.shift, 44 * 50000 * 2, 1);
    assert.ok(R.rent > 44 * 35000 * 24, 'rent rises each year');
    const too = F.compute('redevelopment', { grossPlot: 500, members: 40, existingCarpet: 40000, extraPct: 50 }, MH);
    assert.equal(too.saleBUA, 0); assert.ok(too.warn.length);
  });
  await step('the call: missing figures, go, careful, do not go; break-even and target sale rates', async () => {
    const [, a] = F.SAMPLE.sra[0];
    assert.equal(F.compute('sra', {}, MH).status, 'INCOMPLETE');
    const R = F.compute('sra', a, MH); assert.equal(R.status, 'GO', F.why(R));
    assert.ok(R.irr > 0.18 && R.margin > 0.25);
    const at = (rate) => F.compute('sra', { ...a, rateRes: rate }, MH);
    near(at(R.breakeven).profit / 1e7, 0, 0.01);
    near(at(R.minRate).margin, 0.25, 0.001);
    assert.equal(at(a.rateRes * 0.5).status, 'NO-GO');
    assert.match(F.why(at(a.rateRes * 0.5)), /below/);
  });
  await step('state rules: Maharashtra has the DCPR 2034 road table; another state starts blank for its architect', async () => {
    const mh = await F.rules('Maharashtra', async () => null); assert.equal(mh.roads.length, 5); assert.match(mh.code, /DCPR 2034/);
    const ka = await F.rules('Karnataka', async () => null); assert.equal(ka.roads.length, 0); assert.equal(ka.assume.tdrFSI, 0); assert.match(ka.note, /architect/);
    const tg = await F.rules('Telangana', async () => null); assert.match(tg.note, /no fixed FSI/);
    const own = await F.rules('Karnataka', async () => ({ value: { Karnataka: { basicFSI: 2.25, nonsense: 9 } } })); assert.equal(own.assume.basicFSI, 2.25); assert.deepEqual(own.own, ['basicFSI']);
  });

  // ---- the screen ----
  await new Promise((r) => setTimeout(r, 300));
  const api = client();
  await api('/api/session', { action: 'setup', name: 'Demo Admin', username: 'admin', password: 'admin-password-1' });
  await api('/api/session', { action: 'login', username: 'admin', password: 'admin-password-1' });
  const db = require('../lib/db');
  const mk = async (x) => db.one("insert into projects (code, name, company_id, kind, state) select $1, $2, company_id, $3, $4 from projects where code = 'SIGNATURE' returning id, code, name", [x.code, x.name, x.kind, x.state]);
  const login = async (username, role, projects) => {
    const id = (await db.one("insert into users (username, name, role, password_hash, all_projects, must_change) values ($1, $1, $2, $3, false, false) returning id", [username, role, require('../lib/auth').hashPassword('pass-word-1234')])).id;
    for (const p of projects) await db.q('insert into user_projects (user_id, project_id) values ($1, $2)', [id, p]);
    const c = client(); await c('/api/session', { action: 'login', username, password: 'pass-word-1234' }); return c;
  };
  const sra = await mk({ code: 'SRA1', name: 'Demo Nagar SRA', state: 'Maharashtra', kind: 'sra' });
  const twr = await mk({ code: 'TWR1', name: 'Demo Towers', state: 'Maharashtra', kind: 'new' });
  let opt;
  await step('an option is worked out live, saved, listed with its call, copied and removed', async () => {
    let v = await api('/api/feasibility?project=' + sra.id);
    assert.equal(v.status, 200, v.error); assert.deepEqual(v.list, []); assert.equal(v.canEdit, true); assert.match(v.rules.code, /DCPR/);
    const c = await api('/api/feasibility', { project: sra.id, action: 'calc', inputs: F.SAMPLE.sra[0][1] });
    assert.equal(c.result.status, 'GO'); assert.ok(c.result.sections.some((s) => /Area statement/.test(s.title)));
    assert.match((await api('/api/feasibility', { project: sra.id, action: 'calc', inputs: { grossPlot: 'big' } })).error, /should be a number/);
    assert.match((await api('/api/feasibility', { project: sra.id, action: 'save', name: '', inputs: {} })).error, /name/);
    v = await api('/api/feasibility', { project: sra.id, action: 'save', name: 'Option A', inputs: { ...F.SAMPLE.sra[0][1], bogus: { x: 1 } } });
    assert.equal(v.status, 400, 'a field that is not a number is refused');
    v = await api('/api/feasibility', { project: sra.id, action: 'save', name: 'Option A', inputs: F.SAMPLE.sra[0][1] });
    assert.equal(v.status, 200, v.error); opt = v.saved; assert.equal(v.list[0].status, 'GO');
    const one = await api(`/api/feasibility?project=${sra.id}&id=${opt}`); assert.equal(one.option.name, 'Option A'); assert.equal(one.result.status, 'GO');
    v = await api('/api/feasibility', { project: sra.id, action: 'save', id: opt, name: 'Option A', inputs: { ...F.SAMPLE.sra[0][1], rateRes: 15000 } });
    assert.equal(v.list[0].status, 'NO-GO');
    v = await api('/api/feasibility', { project: sra.id, action: 'copy', id: opt }); assert.equal(v.list.length, 2); assert.equal(v.list[1].name, 'Option A (copy)');
    v = await api('/api/feasibility', { project: sra.id, action: 'delete', id: v.saved }); assert.equal(v.list.length, 1);
    assert.equal((await api(`/api/feasibility?project=${twr.id}&id=${opt}`)).status, 404, 'another project\'s option');
  });
  await step('the report downloads as a PDF and as Excel', async () => {
    const p = await api(`/api/feasibility?project=${sra.id}&id=${opt}&pdf=1`);
    assert.equal(p.status, 200, p.error); assert.match(p.name, /^Feasibility - Demo Nagar SRA - Option A\.pdf$/);
    const buf = Buffer.from(p.data, 'base64'); assert.equal(buf.slice(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 3000);
    const x = await api(`/api/feasibility?project=${sra.id}&id=${opt}&excel=1`);
    const rows = X.read(Buffer.from(x.data, 'base64'))[0].rows.map((r) => r.join(' | '));
    assert.ok(rows.some((r) => /Rehab component/.test(r))); assert.ok(rows.some((r) => /^Cost in all/.test(r)));
  });
  await step('the Admin makes the company\'s own starting figures for the state; a viewer only looks; sales cannot open it', async () => {
    let v = await api('/api/feasibility', { project: twr.id, action: 'rules', assume: { fungPct: 0.3, target: 0.2 } });
    assert.equal(v.status, 200, v.error); assert.equal(v.rules.assume.fungPct, 0.3); assert.deepEqual(v.rules.own.sort(), ['fungPct', 'target']);
    const w = await login('view1', 'viewer', [twr.id, sra.id]);
    const g = await w('/api/feasibility?project=' + sra.id);
    if (g.status === 200) { assert.equal(g.canEdit, false); assert.equal((await w('/api/feasibility', { project: sra.id, action: 'save', name: 'X', inputs: {} })).status, 403); }
    else assert.equal(g.status, 403);
    assert.equal((await w('/api/feasibility', { project: twr.id, action: 'rules', assume: {} })).status, 403);
    const s1 = await login('sales1', 'sales', [twr.id]);
    assert.equal((await s1('/api/feasibility?project=' + twr.id)).status, 403);
    const au = await api('/api/audit?entity=feasibility');
    for (const act of ['create', 'update', 'delete', 'rules']) assert.ok(au.rows.some((x) => x.action === act), act);
  });
  await step('a new opportunity: its own options before any project, compared, reported, then converted into a project', async () => {
    assert.match((await api('/api/feasibility', { action: 'site-save', name: '', kind: 'sra' })).error, /name/);
    assert.match((await api('/api/feasibility', { action: 'site-save', name: 'X', kind: 'sra', state: 'Telangana' })).error, /Maharashtra/);
    let s = await api('/api/feasibility', { action: 'site-save', name: 'Oshiwara CTS 446C', kind: 'sra', state: 'Maharashtra', city: 'Andheri West' });
    assert.equal(s.status, 200, s.error); const sid = s.id;
    let v = await api('/api/feasibility?site=' + sid);
    assert.equal(v.project.site, true); assert.equal(v.list.length, 0); assert.equal(v.rules.code.includes('DCPR'), true);
    v = await api('/api/feasibility', { site: sid, action: 'save', name: 'Option A', inputs: { ...F.SAMPLE.sra[0][1], cts: '446C', village: 'Oshiwara' } });
    assert.equal(v.status, 200, v.error); assert.equal(v.list[0].cts, '446C'); assert.equal(v.list[0].status, 'GO');
    const f = await api(`/api/feasibility?site=${sid}&from=project`); assert.equal(f.inputs.cts, '446C'); assert.equal(f.inputs.grossPlot, F.SAMPLE.sra[0][1].grossPlot);
    await api('/api/feasibility', { site: sid, action: 'save', name: 'Option B', inputs: { ...f.inputs, rateRes: 20000, rateSaleCon: 4200, rateRehabCon: 3000, rentRes: 15000 } });
    const pdf = await api(`/api/feasibility?site=${sid}&id=${v.saved}&pdf=1`); assert.ok(pdf.data && pdf.name.includes('Oshiwara'));
    assert.equal((await api(`/api/feasibility?project=${sra.id}&id=${v.saved}`)).status, 404, 'an opportunity\'s option is not a project\'s');
    let L = await api('/api/feasibility?sites=1'); assert.equal(L.status, 200, L.error); const me = L.sites.find((x) => x.id === sid);
    assert.equal(me.options.length, 2); assert.equal(me.cts, '446C'); assert.ok(L.states.includes('Maharashtra'));
    const np = await mk({ code: 'OSHI', name: 'Oshiwara SRA', kind: 'sra', state: 'Maharashtra' });
    s = await api('/api/feasibility', { action: 'site-link', id: sid, project: np.id }); assert.equal(s.status, 200, s.error);
    assert.equal((await api('/api/feasibility?project=' + np.id)).list.length, 2, 'the options moved to the project');
    assert.equal((await api('/api/feasibility?site=' + sid)).list.length, 0);
    assert.match((await api('/api/feasibility', { action: 'site-link', id: sid, project: np.id })).error, /already a project/);
    L = await api('/api/feasibility?sites=1'); assert.equal(L.sites.find((x) => x.id === sid).project_id, np.id);
    s = await api('/api/feasibility', { action: 'site-save', name: 'Drop me', kind: 'new', state: 'Maharashtra' });
    await api('/api/feasibility', { site: s.id, action: 'save', name: 'A', inputs: { grossPlot: 1000 } });
    assert.equal((await api('/api/feasibility', { action: 'site-delete', id: s.id })).status, 200);
    assert.equal((await api('/api/feasibility?site=' + s.id)).status, 404);
    const au = await api('/api/audit?entity=feas_site'); assert.ok(['create', 'convert', 'delete'].every((a) => au.rows.some((x) => x.action === a)));
  });

  console.log(`Feasibility: ${n} checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
