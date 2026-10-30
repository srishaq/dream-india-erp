// Contractor work orders and RA (running account) bills, for Dream Signature.
// Work order: the contractor, the company it is issued in (Prime Realtors), retention, TDS, advance and how fast it is
// recovered, the allowed wastage on the RMC and steel we supply, and the items with unit, rate and contract quantity.
// An item can be tied to a building's slabs ("per slab", optionally × an area per slab); the RA bill then suggests the
// slabs cast since the last bill, from the site's slab schedule.
// RA bill: quantity done this bill per item (previous and cumulative worked out), less retention, TDS, advance recovery,
// recovery for excess RMC and steel (suggested from the site's materials log) and other deductions.
// Steel and cement we supply: with norms per sq ft in the work order (e.g. steel kg/sq ft, cement bags/sq ft), the ERP
// compares everything site issued to the contractor's buildings with the sq ft billed to date × norm × (1 + allowed
// wastage); the excess, less what was recovered on earlier bills, is suggested as the recovery at our purchase rate.
// Final measurement bill: the final measured quantity per item; the difference from what was billed is paid (or
// recovered), the whole retention held is released, and any advance still open is recovered. The work order closes
// when the final bill is paid.
// Payment schedule (e.g. Mandal Infrastructure): the work order holds the construction area (approx.), the rate per
// sq ft and the stages with their % of the contract value (a slab group counts slab by slab). Each RA bill claims the
// stages or slabs completed since the last one; GST is added; retention, TDS, the mobilisation advance (in full on the
// bill with the chosen stage, e.g. plinth) and instalments of costs we paid first (Mivan formwork, safety screens) are
// deducted. The final bill takes the actual constructed area from the area statement (each floor type × its % factor)
// and settles the difference. Retention comes back through release bills (e.g. half at RCC completion, half after the
// defect liability period).
// Flow: Purchase (or Management) enters the bill → submits → Management approves (maker and checker) → Accounts pay.
// A work order entered by the purchase team needs Management's approval before bills can be raised on it.
// Site logins have no access (no money on site screens). Served from /api/me?contracts=1.
const auth = require('./auth');
const kv = require('./kv');
const { body, noStore } = require('./http');

const WO = 'wo:orders', BILLS = 'wo:bills', META = 'wo:meta';
const ID = /^[A-Za-z0-9]{6,40}$/;
const COMPANIES = ['Prime Realtors', 'Dream India Builders', 'Dream India Realty LLP', 'Apex'];
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
const txt = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const r3 = (n) => Math.round((+n || 0) * 1000) / 1000;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function caps(u) {
  if (!auth.can(u, 'purchase')) return null;
  const r = auth.ROLES[u.role] || {};
  const full = u.role === 'admin' || u.role === 'management';
  const team = r.team ? auth.teamAccess(u).purchase : null;
  const purchase = full || team === 'purchase';
  const accounts = full || u.role === 'accounts_head' || team === 'accounts';
  if (!purchase && !accounts) return null;
  return { enter: purchase, approve: full, pay: accounts, admin: u.role === 'admin' };
}

// Slabs cast per building, from the site schedule: [{ id, name, date }] in order.
async function castByTower() {
  const [towers, progress] = await kv.hgetallMany(['site:towers', 'site:progress']);
  const out = {};
  for (const t of Object.values(towers).filter((x) => x && Array.isArray(x.slabs))) {
    out[t.key] = { name: t.name, slabs: [...t.slabs].sort((a, b) => a.seq - b.seq).filter((s) => (progress[s.id] || {}).status === 'cast').map((s) => ({ id: s.id, name: s.name, date: (progress[s.id] || {}).actualEnd || '' })) };
  }
  return out;
}

const live = (b) => !['rejected', 'cancelled'].includes(b.status);
// What has been billed on each item of a work order before this bill (bills on it, other than this one, not rejected).
function previous(woId, bills, skipId, before) {
  const prev = {};
  for (const b of Object.values(bills)) {
    if (!b || b.woId !== woId || b.id === skipId || !live(b)) continue;
    if (before != null && !(b.seq < before)) continue;
    for (const l of b.lines || []) prev[l.itemId] = (prev[l.itemId] || 0) + (+l.qty || 0);
  }
  return prev;
}
// Advance recovered so far by the other bills on this work order.
const advanceRecovered = (woId, bills, skipId) => Object.values(bills).filter((b) => b && b.woId === woId && b.id !== skipId && live(b)).reduce((a, b) => a + (+(b.totals && b.totals.advance) || 0), 0);

// Retention held on the other bills of this work order (released by the final bill).
const retentionHeld = (woId, bills, skipId) => Object.values(bills).filter((b) => b && b.woId === woId && b.id !== skipId && live(b)).reduce((a, b) => a + (+(b.totals && b.totals.retention) || 0), 0);
const isSqft = (unit) => /^(sq\.?\s*ft|sft|sqft|square\s*feet|sq\s*feet)$/i.test(String(unit || '').trim());

// What earlier bills on this work order deducted for each recovery (Mivan, safety screens …).
function recovered(woId, bills, skipId) {
  const out = {};
  for (const b of Object.values(bills)) if (b && b.woId === woId && b.id !== skipId && live(b)) for (const r of (b.totals && b.totals.recoveries) || []) out[r.id] = (out[r.id] || 0) + (+r.amount || 0);
  return out;
}
const released = (woId, bills, skipId) => Object.values(bills).filter((b) => b && b.woId === woId && b.id !== skipId && live(b)).reduce((a, b) => a + (+(b.totals && b.totals.released) || 0), 0);
const grossBefore = (woId, bills, skipId, before) => Object.values(bills).filter((b) => b && b.woId === woId && b.id !== skipId && live(b) && (before == null || b.seq < before)).reduce((a, b) => a + (+(b.totals && b.totals.gross) || 0), 0);
const contractValue = (wo) => r2((+wo.area || 0) * (+wo.sqftRate || 0));
// the area statement of a final bill: each floor type's measured area × its % factor
const areaOf = (rows) => r3((rows || []).reduce((a, x) => a + (+x.area || 0) * (+x.factor || 0) / 100, 0));

function compute(wo, bill, bills) {
  const prev = previous(wo.id, bills, bill.id, bill.seq);
  const fin = !!bill.final, sched = wo.mode === 'schedule';
  // retention release: only the amount released, nothing else
  if (bill.kind === 'release') {
    const held = retentionHeld(wo.id, bills, bill.id), left = r2(Math.max(0, held - released(wo.id, bills, bill.id)));
    const amt = r2(Math.min(left, Math.max(0, +bill.releaseAmount || 0)));
    return { lines: [], totals: { gross: 0, gst: 0, retention: 0, released: amt, tds: 0, advance: 0, recoveries: [], recovery: 0, material: 0, other: 0, net: amt, retentionLeftAfter: r2(left - amt) } };
  }
  let lines, gross;
  if (sched && fin) {
    const area = areaOf(bill.areaRows), extra = r2((bill.extras || []).reduce((a, x) => a + (+x.amount || 0), 0));
    const finalValue = r2(area * (+wo.sqftRate || 0) + extra), before = r2(grossBefore(wo.id, bills, bill.id, bill.seq));
    lines = [{ itemId: 'final', desc: `Final: ${area.toLocaleString('en-IN')} sq ft × ₹${wo.sqftRate}${extra ? ' + extras' : ''}, less billed before`, unit: 'sq ft', rate: wo.sqftRate, before: 0, qty: area, cum: area, amount: r2(finalValue - before), finalValue, billedBefore: before, extra }];
    gross = lines[0].amount;
  } else {
    lines = wo.items.map((it) => {
      const l = (bill.lines || []).find((x) => x.itemId === it.id) || { qty: 0 };
      const before = r3(prev[it.id] || 0);
      // an item-rate final bill holds the final measured quantity; this bill is the difference from what was billed before
      const finalQty = fin ? r3(l.final != null ? l.final : before + (+l.qty || 0)) : undefined;
      const qty = fin ? r3(finalQty - before) : r3(l.qty), cum = r3(before + qty);
      return { itemId: it.id, desc: it.desc, unit: it.unit, rate: it.rate, contractQty: it.qty, before, qty, cum, ...(fin ? { final: finalQty } : {}), amount: r2(qty * it.rate), over: !fin && it.qty > 0 && cum > it.qty * 1.0001 };
    });
    gross = r2(lines.reduce((a, l) => a + l.amount, 0));
  }
  const gst = r2(gross * (wo.gstPct || 0) / 100);
  // item-rate final bills release all retention; with a payment schedule retention comes back through release bills
  const retention = fin && !sched ? 0 : r2(Math.max(0, gross) * (wo.retentionPct || 0) / 100);
  const rel = fin && !sched ? r2(retentionHeld(wo.id, bills, bill.id)) : 0;
  const tds = r2(gross * (wo.tdsPct || 0) / 100);
  const advLeft = Math.max(0, (wo.advance || 0) - advanceRecovered(wo.id, bills, bill.id));
  let advance;
  if (fin) advance = r2(advLeft);
  else if (wo.advanceAt) { const l = lines.find((x) => x.itemId === wo.advanceAt); advance = l && l.qty > 0 ? r2(advLeft) : 0; } // in full with that stage
  else advance = r2(Math.min(advLeft, Math.max(0, gross) * (wo.advanceRecoveryPct || 0) / 100));
  // instalments of costs we paid first (Mivan, safety screens): the amount on this bill, never more than is left
  const done = recovered(wo.id, bills, bill.id);
  const recoveries = (wo.recoveries || []).map((r) => {
    const x = (bill.recoveries || []).find((y) => y.id === r.id), left = Math.max(0, (+r.total || 0) - (done[r.id] || 0));
    return { id: r.id, name: r.name, amount: r2(Math.min(left, Math.max(0, x ? +x.amount || 0 : 0))), leftAfter: 0, left };
  }).map((r) => ({ ...r, leftAfter: r2(r.left - r.amount) }));
  const recovery = r2(recoveries.reduce((a, r) => a + r.amount, 0));
  const material = r2(Math.max(0, +bill.materialRecovery || 0)), other = r2(Math.max(0, +bill.otherDeduction || 0));
  const net = r2(gross + gst - retention - tds - advance - recovery - material - other + rel);
  return { lines, totals: { gross, gst, invoice: r2(gross + gst), retention, released: rel, tds, advance, advanceLeftAfter: r2(advLeft - advance), recoveries, recovery, material, other, net } };
}

// Suggestions for a new bill: slabs cast since the last bill for slab items, and the recovery for RMC and steel used
// beyond the design quantity plus the allowed wastage (from the site's materials log, where a design quantity was entered).
async function suggest(wo, bills, from, to) {
  const cast = await castByTower();
  const prev = previous(wo.id, bills, null, null);
  const qty = {};
  for (const it of wo.items) if (it.link && it.link.tower && cast[it.link.tower]) {
    const done = cast[it.link.tower].slabs.filter((s) => !to || !s.date || s.date <= to).length;
    if (it.slabFrom) { // a slab group of a payment schedule: slabs from..to of that building (the plinth is not a numbered slab)
      const doneN = cast[it.link.tower].slabs.filter((s) => (!to || !s.date || s.date <= to) && !/^plinth/i.test(s.name)).length;
      const n = Math.max(0, Math.min(doneN, it.slabTo || doneN) - (it.slabFrom - 1));
      qty[it.id] = Math.max(0, r3(Math.min(n, it.qty || n) - (prev[it.id] || 0)));
    } else qty[it.id] = Math.max(0, r3(done * (it.perSlab || 1) - (prev[it.id] || 0)));
  }
  const mats = await kv.hgetall('site:materials');
  const towers = new Set(wo.towers || []);
  const W = wo.wastage || {}, N = wo.norms || {};
  const KEYS = ['rmc', 'steel', 'cement'];
  const use = {}, toDate = {}; for (const k of KEYS) { use[k] = { used: 0, theo: 0 }; toDate[k] = 0; }
  for (const [date, day] of Object.entries(mats)) {
    for (const i of Object.values((day && day.items) || {})) {
      if (!i || i.void || i.type !== 'used' || !KEYS.includes(i.material)) continue;
      if (towers.size && !towers.has(i.tower)) continue;
      if (!to || date <= to) toDate[i.material] += +i.qty || 0;                      // issued to date (for the norms)
      if ((from && date < from) || (to && date > to) || !(+i.theo > 0)) continue;
      use[i.material].used += +i.qty || 0; use[i.material].theo += +i.theo;            // design quantities in this period
    }
  }
  // recovery at our cost: the rate in the work order, else the latest rate we bought at (purchase orders, incl. GST)
  const po = {}; const POM = { RMC: 'rmc', Steel: 'steel', Cement: 'cement' };
  for (const o of Object.values(await kv.hgetall('po:orders')).filter((x) => x && x.order && POM[x.material] && +x.order.rate > 0).sort((a, b) => String(a.order.at).localeCompare(String(b.order.at)))) po[POM[o.material]] = +o.order.rate;
  const rate = { rmc: W.rmcRate || po.rmc || 0, steel: W.steelRate || po.steel || 0, cement: W.cementRate || po.cement || 0 }, pct = { rmc: W.rmcPct || 0, steel: W.steelPct || 0, cement: W.cementPct || 0 };
  const rateFromPo = { rmc: !W.rmcRate && !!po.rmc, steel: !W.steelRate && !!po.steel, cement: !W.cementRate && !!po.cement };
  const unitOf = { rmc: 'm³', steel: 'MT', cement: 'bags' };
  // with norms: everything issued to date against the sq ft billed to date (this bill's suggestion included)
  // sq ft built so far: item-rate work orders count their sq ft items; a payment schedule counts the share of the
  // contract claimed so far × the construction area (each unit of a stage stands for its % of the area)
  const sched = wo.mode === 'schedule';
  const perUnit = {}; for (const it of wo.items) perUnit[it.id] = sched ? (+wo.area || 0) * (it.pct || 0) / 100 / (it.qty || 1) : isSqft(it.unit) ? 1 : 0;
  const sqftItems = wo.items.filter((it) => perUnit[it.id] > 0);
  const area = r3(sqftItems.reduce((a, it) => a + ((prev[it.id] || 0) + (qty[it.id] || 0)) * perUnit[it.id], 0));
  const norm = { steel: (+N.steelKgPerSqft || 0) / 1000, cement: +N.cementBagsPerSqft || 0, rmc: +N.rmcM3PerSqft || 0 };
  const byNorm = sqftItems.length && KEYS.some((k) => norm[k] > 0);
  const notes = [], check = {};
  let due = 0, periodDue = 0;
  for (const k of KEYS) {
    if (byNorm && norm[k] > 0) {
      const allowed = r3(area * norm[k] * (1 + pct[k] / 100)), x = r3(Math.max(0, toDate[k] - allowed));
      check[k] = { issued: r3(toDate[k]), allowed, excess: x, basis: 'norm' };
      due += x * rate[k];
      if (x) notes.push(`${k === 'rmc' ? 'RMC' : k[0].toUpperCase() + k.slice(1)} ${x} ${unitOf[k]} over (issued ${r3(toDate[k])}, allowed ${allowed} for ${area.toLocaleString('en-IN')} sq ft)${rate[k] ? ` at ₹${rate[k].toLocaleString('en-IN')}/${unitOf[k]}${rateFromPo[k] ? ' (latest purchase rate)' : ''}` : ''}`);
    } else if (use[k].theo > 0) {
      const x = r3(Math.max(0, use[k].used - use[k].theo * (1 + pct[k] / 100)));
      check[k] = { issued: r3(use[k].used), allowed: r3(use[k].theo * (1 + pct[k] / 100)), excess: x, basis: 'design' };
      periodDue += x * rate[k]; // period based: each period stands on its own
      if (x) notes.push(`${k === 'rmc' ? 'RMC' : k[0].toUpperCase() + k.slice(1)} ${x} ${unitOf[k]} over the design quantity + allowance this period${rate[k] ? ` at ₹${rate[k].toLocaleString('en-IN')}/${unitOf[k]}${rateFromPo[k] ? ' (latest purchase rate)' : ''}` : ''}`);
    }
  }
  // the norm check is cumulative, so take off what earlier bills already recovered
  const before = byNorm ? Object.values(bills).filter((b) => b && b.woId === wo.id && live(b)).reduce((a, b) => a + (+(b.totals && b.totals.material) || 0), 0) : 0;
  const material = r2(Math.max(0, due - before) + periodDue);
  const missingRate = KEYS.filter((k) => check[k] && check[k].excess > 0 && !rate[k]);
  const materialNote = notes.length ? notes.join('; ') + (before ? `; ₹${Math.round(before).toLocaleString('en-IN')} already recovered on earlier bills` : '') + (missingRate.length ? `. Add the recovery rate for ${missingRate.join(', ')} in the work order.` : '')
    : Object.keys(check).length ? 'Steel and cement within the allowed wastage' : 'No norms in the work order and no design quantities logged by site';
  // for the bill form, which works the norm recovery out again as the quantities are typed
  const normCalc = byNorm ? { rateFromPo, prevArea: r3(sqftItems.reduce((a, it) => a + (prev[it.id] || 0) * perUnit[it.id], 0)), sqftItems: sqftItems.map((it) => it.id), perUnit, issued: toDate, norm, pct, rate, before: r2(before), periodDue: r2(periodDue) } : null;
  // recoveries: the agreed instalment, or what is left if less
  const done = recovered(wo.id, bills, null);
  const recoveries = (wo.recoveries || []).map((r) => ({ id: r.id, name: r.name, amount: r2(Math.min(Math.max(0, (+r.total || 0) - (done[r.id] || 0)), +r.perBill || 0)), left: r2(Math.max(0, (+r.total || 0) - (done[r.id] || 0))) }));
  const held = r2(retentionHeld(wo.id, bills, null)), rel = r2(released(wo.id, bills, null));
  return { qty, material, materialNote, use, check, area, normCalc, recoveries, retention: { held, released: rel, left: r2(held - rel) } };
}

function cleanWo(d, cur) {
  const mode = d.mode === 'schedule' ? 'schedule' : 'items';
  const area = Math.max(0, num(d.area) || 0), sqftRate = Math.max(0, num(d.sqftRate) || 0), value = area * sqftRate;
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 80).map((x) => {
    const id = ID.test(String(x && x.id || '')) ? x.id : newId(), link = x && x.link && x.link.tower ? { tower: txt(x.link.tower, 20) } : null;
    if (mode === 'schedule') {
      // a stage of the payment schedule: its % of the contract value, split over its slabs if it is a slab group
      const pct = Math.max(0, num(x && x.pct) || 0), count = Math.max(1, Math.round(num(x && x.count) || 1));
      const slabFrom = link ? Math.max(0, Math.round(num(x.slabFrom) || 0)) : 0;
      return { id, desc: txt(x && x.desc, 160), pct, count, unit: count > 1 ? 'slab' : 'stage', qty: count, rate: r2(value * pct / 100 / count), link, slabFrom: slabFrom || undefined, slabTo: slabFrom ? slabFrom + count - 1 : undefined };
    }
    return { id, desc: txt(x && x.desc, 160), unit: txt(x && x.unit, 20) || 'nos', rate: num(x && x.rate), qty: num(x && x.qty) || 0, link, perSlab: link ? (num(x.perSlab) > 0 ? num(x.perSlab) : 1) : undefined };
  }).filter((x) => x.desc);
  return {
    mode, area: mode === 'schedule' ? area : undefined, sqftRate: mode === 'schedule' ? sqftRate : undefined,
    contractor: txt(d.contractor, 120), company: COMPANIES.includes(d.company) ? d.company : 'Prime Realtors', scope: txt(d.scope, 300), date: isDate(d.date) ? d.date : istToday(),
    pan: txt(d.pan, 12).toUpperCase(), gstin: txt(d.gstin, 15).toUpperCase(), gstPct: Math.min(28, Math.max(0, num(d.gstPct) || 0)), payDays: Math.min(90, Math.max(0, Math.round(num(d.payDays) || 0))) || undefined,
    retentionPct: Math.min(20, Math.max(0, num(d.retentionPct) || 0)), tdsPct: Math.min(10, Math.max(0, num(d.tdsPct) || 0)),
    advance: Math.max(0, num(d.advance) || 0), advanceRecoveryPct: Math.min(100, Math.max(0, num(d.advanceRecoveryPct) || 0)),
    advanceAt: items.some((x) => x.id === d.advanceAt) ? d.advanceAt : (Number.isInteger(d.advanceAtIndex) && items[d.advanceAtIndex] ? items[d.advanceAtIndex].id : undefined),
    recoveries: (Array.isArray(d.recoveries) ? d.recoveries : []).slice(0, 10).map((r) => ({ id: ID.test(String(r && r.id || '')) ? r.id : newId(), name: txt(r && r.name, 80), total: Math.max(0, num(r && r.total) || 0), perBill: Math.max(0, num(r && r.perBill) || 0) })).filter((r) => r.name && r.total > 0),
    areaFactors: (Array.isArray(d.areaFactors) ? d.areaFactors : []).slice(0, 40).map((f) => ({ name: txt(f && f.name, 100), factor: Math.max(0, num(f && f.factor) || 0) })).filter((f) => f.name),
    towers: (Array.isArray(d.towers) ? d.towers : []).map((x) => txt(x, 20)).filter(Boolean).slice(0, 6),
    // allowed wastage on what we supply: 3% unless the work order says otherwise
    wastage: Object.fromEntries(['rmcPct', 'steelPct', 'cementPct', 'rmcRate', 'steelRate', 'cementRate'].map((k) => { const raw = d.wastage && d.wastage[k], v = Math.max(0, num(raw) || 0); return [k, k.endsWith('Pct') && (raw == null || raw === '') ? 3 : v]; })),
    norms: Object.fromEntries(['steelKgPerSqft', 'cementBagsPerSqft', 'rmcM3PerSqft'].map((k) => [k, Math.max(0, num(d.norms && d.norms[k]) || 0)])),
    items, note: txt(d.note, 1000),
  };
}

// Mandal Infrastructure's signed work order (11 Dec 2025), entered once so Purchase only checks it and Sameer approves.
const MANDAL_STAGES = [['Excavation', 3, 1], ['Foundation completion', 6, 1], ['Plinth completion', 9, 1], ['Completion of 1st slab', 3, 1, 1], ['Completion of 2nd to 5th slab', 6, 4, 2],
  ['Completion of 6th to 10th slab', 12, 5, 6], ['Completion of 11th to 34th slab', 28.8, 24, 11], ['Completion of 35th to 46th slab', 9.6, 12, 35], ['Completion of U.G. tank', 1.6, 1], ['Completion of O.H.T. & lift room', 1, 1],
  ['Block work', 5, 1], ['Internal plaster', 7, 1], ['External plaster', 6, 1], ['Waterproofing', 1, 1], ['Compound wall / PCC / misc. works', 1, 1]];
const MANDAL_FACTORS = [['Out to out beam face area', 100], ['Shops, offices, lobbies, stairs, lifts, ramp, residential, canopy, balcony, flower bed', 100], ['Basement floors', 150], ['Basement floors 4.20 m and above height', 200], ['Area above U.G. tanks in basement', 75],
  ['Double height structure', 150], ['Stilt area (parking on ground floor)', 70], ['Podium area (parking on podium floors)', 80], ['Ramp void cover slab', 200], ['Floor height 4.20 m and above', 120], ['Service slabs in duct wider than 600 mm', 100],
  ['Voids in ducts', 0], ['Refuge area', 80], ['Parking tower void', 25], ['Swimming pool', 200], ['Open terrace', 0], ['OHT & LMR', 0], ['U.G. tank', 0], ['Chajja up to 1200 mm', 0], ['Chajja above 1200 mm', 100]];
async function seedMandal(wos) {
  if (await kv.hget(META, 'mandalSeeded') || Object.values(wos).some((w) => w && /mandal/i.test(w.contractor || ''))) return null;
  const cast = await castByTower(), sale = Object.entries(cast).find(([, t]) => /sale/i.test(t.name)) || Object.entries(cast)[0];
  const tower = sale ? sale[0] : null, area = 982765, rate = 900;
  const w = cleanWo({ mode: 'schedule', contractor: 'Mandal Infrastructure Pvt. Ltd.', company: 'Prime Realtors', date: '2025-12-11',
    scope: 'Civil work (part material + waterproofing): RCC frame sub and super structure, masonry, plastering, waterproofing; sale and rehab buildings, Relief Road, Jogeshwari',
    area, sqftRate: rate, gstPct: 18, retentionPct: 5, tdsPct: 2, payDays: 15, advance: Math.round(area * rate * 0.05), advanceAtIndex: 2,
    items: MANDAL_STAGES.map(([desc, pct, count, from]) => ({ desc, pct, count, slabFrom: from, link: from && tower ? { tower } : null })),
    areaFactors: MANDAL_FACTORS.map(([name, factor]) => ({ name, factor })), towers: tower ? [tower] : [], wastage: {}, norms: {},
    note: 'From the signed work order dated 11 Dec 2025. Rate ₹900 per sq ft (BUA), GST extra; final bill on the actual constructed area. Mobilisation advance 5% of the contract value, recovered from the plinth completion bill (check the amount actually paid). Retention 5%: 2.5% released after RCC completion, 2.5% after 12 months (defect liability). Pay within 15 days of the bill with the site in-charge\'s certificate. Floor height above the limits paid 10% extra per foot. Steel, RMC and cement supplied by us free; 3% wastage allowed, excess recovered at our cost (addendum). Rehab building: the 35th–46th slab share is paid when the rehab building is completed. Mivan formwork and safety screens paid by us first, recovered in instalments as agreed: add them under "Costs we pay first" once the amounts are fixed.' });
  const seq = (+(await kv.hget(META, 'woSeq')) || 0) + 1; await kv.hset(META, 'woSeq', seq);
  const now = new Date().toISOString();
  const doc = { id: newId(), no: `WO-${String(seq).padStart(3, '0')}`, ...w, status: 'pending_approval', createdBy: 'erp', createdAt: now, updatedAt: now, history: [{ at: now, by: 'erp', did: 'Entered from the signed work order; Purchase to check, Management to approve' }] };
  await kv.hset(WO, doc.id, doc); await kv.hset(META, 'mandalSeeded', now);
  return doc;
}

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, 'purchase');
  if (!u) return;
  const can = caps(u);
  if (!can) return res.status(403).json({ error: 'Contractor bills are for Purchase, Accounts and Management.', home: auth.publicUser(u).home });
  const say = (code, error) => res.status(code).json({ error });
  try {
    if (req.method === 'GET' && (req.query || {}).file) {
      const f = ID.test(String(req.query.file)) ? await kv.hget('wo:files', req.query.file) : null;
      const m = f && String(f.data || '').match(/^data:(application\/pdf|image\/[a-z]+);base64,(.*)$/);
      if (!m) return say(404, 'No file attached.');
      res.setHeader('Content-Type', m[1]); res.setHeader('Content-Disposition', `inline; filename="${String(f.name || 'work-order.pdf').replace(/[^\w. -]/g, '')}"`);
      return res.end(Buffer.from(m[2], 'base64'));
    }
    if (req.method === 'GET') {
      let [wos, bills, users] = await kv.hgetallMany([WO, BILLS, 'users']);
      if (can.enter || can.approve) { const sd = await seedMandal(wos).catch((e) => { console.error('mandal seed', e.message); return null; }); if (sd) wos = { ...wos, [sd.id]: sd }; }
      const people = {}; for (const x of Object.values(users)) people[x.username] = x.name || x.username;
      const q = req.query || {};
      let suggestion = null;
      if (q.suggest && wos[q.suggest]) suggestion = await suggest(wos[q.suggest], bills, isDate(q.from) ? q.from : '', isDate(q.to) ? q.to : '');
      return res.status(200).json({ me: auth.publicUser(u), can, people, wos, bills, companies: COMPANIES, cast: await castByTower(), suggestion });
    }
    if (req.method !== 'POST') return say(405, 'GET or POST');
    const b = body(req), op = b.op, d = b.data && typeof b.data === 'object' ? b.data : {};
    const now = new Date().toISOString();
    const [wos, bills] = await kv.hgetallMany([WO, BILLS]);
    const log = (doc, did, note) => { doc.history = [...(doc.history || []), { at: now, by: u.username, did, note: note || undefined }]; doc.updatedAt = now; doc.updatedBy = u.username; };

    // ---------- work orders ----------
    if (op === 'wo_save') {
      if (!can.enter) return say(403, 'Only Purchase or Management can enter work orders.');
      const cur = b.id ? wos[b.id] : null;
      if (b.id && !cur) return say(404, 'That work order no longer exists.');
      if (cur && cur.status !== 'pending_approval' && !can.approve) return say(409, 'This work order is approved; only Management can change it.');
      const w = cleanWo(d);
      if (!w.contractor) return say(400, 'Enter the contractor.');
      if (!w.items.length) return say(400, w.mode === 'schedule' ? 'Add the stages of the payment schedule.' : 'Add at least one item with its rate.');
      if (w.mode === 'schedule') {
        if (!(w.area > 0) || !(w.sqftRate > 0)) return say(400, 'Enter the construction area and the rate per sq ft.');
        const tot = r2(w.items.reduce((a, x) => a + x.pct, 0)); if (Math.abs(tot - 100) > 0.01) return say(400, `The stages add up to ${tot}%, not 100%.`);
      } else for (const it of w.items) if (!(it.rate >= 0)) return say(400, `Enter the rate for "${it.desc}".`);
      let doc;
      if (cur) {
        // an item already billed cannot be removed
        const billed = previous(cur.id, bills, null, null);
        for (const it of cur.items) if (billed[it.id] && !w.items.some((x) => x.id === it.id)) return say(409, `"${it.desc}" has been billed, so it cannot be removed.`);
        doc = { ...cur, ...w };
        log(doc, 'Changed');
      } else {
        const seq = (+(await kv.hget(META, 'woSeq')) || 0) + 1; await kv.hset(META, 'woSeq', seq);
        doc = { id: newId(), no: `WO-${String(seq).padStart(3, '0')}`, ...w, status: can.approve ? 'active' : 'pending_approval', createdBy: u.username, createdAt: now, history: [] };
        log(doc, can.approve ? 'Work order entered and approved' : 'Work order entered, sent to Management for approval');
      }
      await kv.hset(WO, doc.id, doc);
      return res.status(200).json({ ok: true, wo: doc });
    }
    if (op === 'wo_file') {
      if (!can.enter && !can.approve) return say(403, 'Only Purchase or Management can attach the work order.');
      const w = wos[b.id]; if (!w) return say(404, 'That work order no longer exists.');
      const data = String(d.data || '');
      if (!/^data:(application\/pdf|image\/(jpeg|png|webp));base64,/.test(data)) return say(400, 'Attach the signed work order as a PDF or a photo.');
      if (data.length > 4.2e6) return say(400, 'The file is too big. Keep it under 3 MB (scan at a lower resolution).');
      await kv.hset('wo:files', w.id, { data, name: txt(d.name, 120) || 'work-order.pdf', by: u.username, at: now });
      w.file = { name: txt(d.name, 120) || 'work-order.pdf', at: now, by: u.username }; log(w, 'Signed work order attached');
      await kv.hset(WO, w.id, w);
      return res.status(200).json({ ok: true, wo: w });
    }
    if (op === 'wo_approve' || op === 'wo_close') {
      const w = wos[b.id]; if (!w) return say(404, 'That work order no longer exists.');
      if (!can.approve) return say(403, 'Only Management can do this.');
      if (op === 'wo_approve') { if (w.status !== 'pending_approval') return say(409, 'This work order is not waiting for approval.'); if (w.createdBy === u.username && !can.admin) return say(409, 'Someone else in Management has to approve a work order you entered.'); w.status = 'active'; log(w, 'Approved by Management'); }
      else { w.status = w.status === 'closed' ? 'active' : 'closed'; log(w, w.status === 'closed' ? 'Closed' : 'Reopened', txt(d.note)); }
      await kv.hset(WO, w.id, w);
      return res.status(200).json({ ok: true, wo: w });
    }

    // ---------- RA bills ----------
    // the bill form's live totals: the same sums as saving, nothing stored
    if (op === 'bill_preview') {
      const cur = b.id ? bills[b.id] : null, w = wos[cur ? cur.woId : d.woId]; if (!w) return say(400, 'Choose the work order.');
      const kind = cur ? cur.kind || (cur.final ? 'final' : 'ra') : d.kind === 'release' ? 'release' : d.final ? 'final' : 'ra';
      const seq = cur ? cur.seq : Object.values(bills).filter((x) => x && x.woId === w.id).reduce((a, x) => Math.max(a, x.seq || 0), 0) + 1;
      const doc = { id: cur ? cur.id : '_preview', woId: w.id, seq, kind, final: kind === 'final' || undefined,
        lines: (Array.isArray(d.lines) ? d.lines : []).map((l) => ({ itemId: txt(l && l.itemId, 40), qty: Math.max(0, num(l && l.qty) || 0), final: l && l.final != null ? Math.max(0, num(l.final) || 0) : undefined })),
        areaRows: (Array.isArray(d.areaRows) ? d.areaRows : []).map((x) => ({ area: num(x && x.area) || 0, factor: num(x && x.factor) || 0 })), extras: (Array.isArray(d.extras) ? d.extras : []).map((x) => ({ amount: num(x && x.amount) || 0 })),
        recoveries: (Array.isArray(d.recoveries) ? d.recoveries : []).map((r) => ({ id: txt(r && r.id, 40), amount: Math.max(0, num(r && r.amount) || 0) })), releaseAmount: num(d.releaseAmount) || 0,
        materialRecovery: num(d.materialRecovery) || 0, otherDeduction: num(d.otherDeduction) || 0 };
      return res.status(200).json({ ok: true, ...compute(w, doc, bills) });
    }
    if (op === 'bill_save') {
      if (!can.enter) return say(403, 'Only Purchase or Management can enter contractor bills.');
      const cur = b.id ? bills[b.id] : null;
      if (b.id && !cur) return say(404, 'That bill no longer exists.');
      if (cur && cur.status !== 'draft') return say(409, 'Only a draft bill can be changed.');
      const w = wos[cur ? cur.woId : d.woId]; if (!w) return say(400, 'Choose the work order.');
      const isRelease = cur ? cur.kind === 'release' : d.kind === 'release';
      if (w.status !== 'active' && !(isRelease && w.status === 'closed')) return say(409, w.status === 'closed' ? 'This work order is closed.' : 'Management has not approved this work order yet.');
      if (!isDate(d.from) || !isDate(d.to) || d.from > d.to) return say(400, 'Enter the bill period (from and to).');
      const kind = cur ? cur.kind || (cur.final ? 'final' : 'ra') : d.kind === 'release' ? 'release' : d.final ? 'final' : 'ra';
      const fin = kind === 'final';
      const finalBill = Object.values(bills).find((x) => x && x.woId === w.id && x.final && live(x) && (!cur || x.id !== cur.id));
      if (finalBill && kind !== 'release') return say(409, `The final measurement bill ${finalBill.no} is already entered on this work order.`);
      let lines = [], areaRows, extras;
      if (kind === 'release') {
        if (!(num(d.releaseAmount) > 0)) return say(400, 'Enter the retention to release.');
      } else if (fin && w.mode === 'schedule') {
        areaRows = (Array.isArray(d.areaRows) ? d.areaRows : []).slice(0, 60).map((x) => ({ name: txt(x && x.name, 100), area: Math.max(0, num(x && x.area) || 0), factor: Math.max(0, num(x && x.factor) || 0) })).filter((x) => x.name && x.area > 0);
        extras = (Array.isArray(d.extras) ? d.extras : []).slice(0, 20).map((x) => ({ name: txt(x && x.name, 120), amount: num(x && x.amount) || 0 })).filter((x) => x.name && x.amount);
        if (!areaRows.length) return say(400, 'Enter the measured area of each floor type.');
      } else {
        lines = w.items.map((it) => { const x = (Array.isArray(d.lines) ? d.lines : []).find((l) => l && l.itemId === it.id) || {};
          return fin ? { itemId: it.id, final: Math.max(0, num(x.final) || 0) } : { itemId: it.id, qty: Math.max(0, num(x.qty) || 0) }; });
        if (fin && !lines.some((l) => l.final > 0)) return say(400, 'Enter the final measured quantity for the items done.');
        if (!fin && !lines.some((l) => l.qty > 0)) return say(400, w.mode === 'schedule' ? 'Tick at least one stage or slab completed in this bill.' : 'Enter the quantity done this bill for at least one item.');
      }
      const recov = (Array.isArray(d.recoveries) ? d.recoveries : []).map((r) => ({ id: txt(r && r.id, 40), amount: Math.max(0, num(r && r.amount) || 0) }));
      let doc;
      if (cur) doc = { ...cur };
      else {
        const seq = Object.values(bills).filter((x) => x && x.woId === w.id).reduce((a, x) => Math.max(a, x.seq || 0), 0) + 1;
        const relN = Object.values(bills).filter((x) => x && x.woId === w.id && x.kind === 'release').length + 1;
        doc = { id: newId(), woId: w.id, seq, no: `${w.no}/${kind === 'release' ? 'RET-' + relN : fin ? 'FINAL' : 'RA-' + String(seq).padStart(2, '0')}`, kind, final: fin || undefined, status: 'draft', createdBy: u.username, createdAt: now, history: [] };
      }
      Object.assign(doc, { from: d.from, to: d.to, billNo: txt(d.billNo, 60), billDate: isDate(d.billDate) ? d.billDate : '', lines, areaRows, extras, recoveries: recov, releaseAmount: kind === 'release' ? Math.max(0, num(d.releaseAmount) || 0) : undefined, releaseNote: kind === 'release' ? txt(d.releaseNote, 200) : undefined, materialRecovery: Math.max(0, num(d.materialRecovery) || 0), materialNote: txt(d.materialNote, 200), otherDeduction: Math.max(0, num(d.otherDeduction) || 0), otherNote: txt(d.otherNote, 200), note: txt(d.note) });
      Object.assign(doc, compute(w, doc, bills));
      log(doc, cur ? 'Changed' : 'Entered');
      await kv.hset(BILLS, doc.id, doc);
      return res.status(200).json({ ok: true, bill: doc });
    }
    const bill = bills[b.id];
    if (!bill) return say(404, 'That bill no longer exists.');
    const w = wos[bill.woId];
    if (op === 'bill_submit') {
      if (!can.enter) return say(403, 'Only Purchase or Management can submit a bill.');
      if (bill.status !== 'draft') return say(409, 'This bill is not a draft.');
      Object.assign(bill, compute(w, bill, bills));
      if (bill.lines.some((l) => l.over) && !txt(d.note)) return say(400, 'Some items go beyond the work order quantity. Add a note explaining why, then submit.');
      bill.status = 'pending_approval'; bill.submittedAt = now; bill.submittedBy = u.username; log(bill, 'Submitted to Management', txt(d.note));
    } else if (op === 'bill_approve' || op === 'bill_reject') {
      if (!can.approve) return say(403, 'Only Management can approve contractor bills.');
      if (bill.status !== 'pending_approval') return say(409, 'This bill is not waiting for approval.');
      if ((bill.createdBy === u.username || bill.submittedBy === u.username) && !can.admin) return say(409, 'You entered this bill, so someone else in Management has to approve it.');
      if (op === 'bill_reject' && !txt(d.note)) return say(400, 'Give a reason for sending it back.');
      if (op === 'bill_approve') { Object.assign(bill, compute(w, bill, bills)); bill.status = 'approved'; bill.approvedBy = u.username; bill.approvedAt = now; log(bill, 'Approved by Management', txt(d.note)); }
      else { bill.status = 'draft'; log(bill, 'Sent back by Management', txt(d.note)); }
    } else if (op === 'bill_paid') {
      if (!can.pay) return say(403, 'Only Accounts can record a payment.');
      if (bill.status !== 'approved') return say(409, 'This bill is not approved for payment yet.');
      const amount = num(d.amount), ref = txt(d.ref, 80);
      if (!(amount > 0)) return say(400, 'Enter the amount paid.');
      if (!ref) return say(400, 'Enter the payment reference (UTR or cheque number).');
      if (!isDate(d.date)) return say(400, 'Enter the payment date.');
      bill.payment = { amount, ref, date: d.date, by: u.username, at: now }; bill.status = 'paid'; log(bill, 'Paid', `₹${amount}, ${ref}`);
      if (bill.final && w && w.status === 'active') { w.status = 'closed'; log(w, 'Closed: final measurement bill paid'); await kv.hset(WO, w.id, w); }
    } else if (op === 'bill_delete') {
      if (bill.status !== 'draft' || !(bill.createdBy === u.username || can.admin)) return say(403, 'Only a draft can be deleted, by the person who entered it or the Admin.');
      await kv.hdel(BILLS, bill.id);
      return res.status(200).json({ ok: true, deleted: bill.id });
    } else return say(400, 'Unknown action.');
    await kv.hset(BILLS, bill.id, bill);
    return res.status(200).json({ ok: true, bill });
  } catch (e) {
    console.error('contracts', e);
    return say(503, 'The contracts database is not reachable. Try again in a moment.');
  }
};
module.exports.compute = compute;
module.exports.WO = WO;
module.exports.BILLS = BILLS;
