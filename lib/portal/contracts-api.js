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

function compute(wo, bill, bills) {
  const prev = previous(wo.id, bills, bill.id, bill.seq);
  const fin = !!bill.final;
  const lines = wo.items.map((it) => {
    const l = (bill.lines || []).find((x) => x.itemId === it.id) || { qty: 0 };
    const before = r3(prev[it.id] || 0);
    // a final bill holds the final measured quantity; this bill is the difference from what was billed before
    const finalQty = fin ? r3(l.final != null ? l.final : before + (+l.qty || 0)) : undefined;
    const qty = fin ? r3(finalQty - before) : r3(l.qty), cum = r3(before + qty);
    return { itemId: it.id, desc: it.desc, unit: it.unit, rate: it.rate, contractQty: it.qty, before, qty, cum, ...(fin ? { final: finalQty } : {}), amount: r2(qty * it.rate), over: !fin && it.qty > 0 && cum > it.qty * 1.0001 };
  });
  const gross = r2(lines.reduce((a, l) => a + l.amount, 0));
  const retention = fin ? 0 : r2(gross * (wo.retentionPct || 0) / 100);
  const released = fin ? r2(retentionHeld(wo.id, bills, bill.id)) : 0;
  const tds = r2(gross * (wo.tdsPct || 0) / 100);
  const advLeft = Math.max(0, (wo.advance || 0) - advanceRecovered(wo.id, bills, bill.id));
  const advance = fin ? r2(advLeft) : r2(Math.min(advLeft, Math.max(0, gross) * (wo.advanceRecoveryPct || 0) / 100));
  const material = r2(Math.max(0, +bill.materialRecovery || 0)), other = r2(Math.max(0, +bill.otherDeduction || 0));
  const net = r2(gross - retention - tds - advance - material - other + released);
  return { lines, totals: { gross, retention, released, tds, advance, advanceLeftAfter: r2(advLeft - advance), material, other, net } };
}

// Suggestions for a new bill: slabs cast since the last bill for slab items, and the recovery for RMC and steel used
// beyond the design quantity plus the allowed wastage (from the site's materials log, where a design quantity was entered).
async function suggest(wo, bills, from, to) {
  const cast = await castByTower();
  const prev = previous(wo.id, bills, null, null);
  const qty = {};
  for (const it of wo.items) if (it.link && it.link.tower && cast[it.link.tower]) {
    const n = cast[it.link.tower].slabs.filter((s) => !to || !s.date || s.date <= to).length;
    qty[it.id] = Math.max(0, r3(n * (it.perSlab || 1) - (prev[it.id] || 0)));
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
  const rate = { rmc: W.rmcRate || 0, steel: W.steelRate || 0, cement: W.cementRate || 0 }, pct = { rmc: W.rmcPct || 0, steel: W.steelPct || 0, cement: W.cementPct || 0 };
  const unitOf = { rmc: 'm³', steel: 'MT', cement: 'bags' };
  // with norms: everything issued to date against the sq ft billed to date (this bill's suggestion included)
  const sqftItems = wo.items.filter((it) => isSqft(it.unit));
  const area = r3(sqftItems.reduce((a, it) => a + (prev[it.id] || 0) + (qty[it.id] || 0), 0));
  const norm = { steel: (+N.steelKgPerSqft || 0) / 1000, cement: +N.cementBagsPerSqft || 0, rmc: +N.rmcM3PerSqft || 0 };
  const byNorm = sqftItems.length && KEYS.some((k) => norm[k] > 0);
  const notes = [], check = {};
  let due = 0, periodDue = 0;
  for (const k of KEYS) {
    if (byNorm && norm[k] > 0) {
      const allowed = r3(area * norm[k] * (1 + pct[k] / 100)), x = r3(Math.max(0, toDate[k] - allowed));
      check[k] = { issued: r3(toDate[k]), allowed, excess: x, basis: 'norm' };
      due += x * rate[k];
      if (x) notes.push(`${k === 'rmc' ? 'RMC' : k[0].toUpperCase() + k.slice(1)} ${x} ${unitOf[k]} over (issued ${r3(toDate[k])}, allowed ${allowed} for ${area.toLocaleString('en-IN')} sq ft)`);
    } else if (use[k].theo > 0) {
      const x = r3(Math.max(0, use[k].used - use[k].theo * (1 + pct[k] / 100)));
      check[k] = { issued: r3(use[k].used), allowed: r3(use[k].theo * (1 + pct[k] / 100)), excess: x, basis: 'design' };
      periodDue += x * rate[k]; // period based: each period stands on its own
      if (x) notes.push(`${k === 'rmc' ? 'RMC' : k[0].toUpperCase() + k.slice(1)} ${x} ${unitOf[k]} over the design quantity + allowance this period`);
    }
  }
  // the norm check is cumulative, so take off what earlier bills already recovered
  const before = byNorm ? Object.values(bills).filter((b) => b && b.woId === wo.id && live(b)).reduce((a, b) => a + (+(b.totals && b.totals.material) || 0), 0) : 0;
  const material = r2(Math.max(0, due - before) + periodDue);
  const missingRate = KEYS.filter((k) => check[k] && check[k].excess > 0 && !rate[k]);
  const materialNote = notes.length ? notes.join('; ') + (before ? `; ₹${Math.round(before).toLocaleString('en-IN')} already recovered on earlier bills` : '') + (missingRate.length ? `. Add the recovery rate for ${missingRate.join(', ')} in the work order.` : '')
    : Object.keys(check).length ? 'Steel and cement within the allowed wastage' : 'No norms in the work order and no design quantities logged by site';
  // for the bill form, which works the norm recovery out again as the quantities are typed
  const normCalc = byNorm ? { prevArea: r3(sqftItems.reduce((a, it) => a + (prev[it.id] || 0), 0)), sqftItems: sqftItems.map((it) => it.id), issued: toDate, norm, pct, rate, before: r2(before), periodDue: r2(periodDue) } : null;
  return { qty, material, materialNote, use, check, area, normCalc };
}

function cleanWo(d, cur) {
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 80).map((x) => ({
    id: ID.test(String(x && x.id || '')) ? x.id : newId(), desc: txt(x && x.desc, 160), unit: txt(x && x.unit, 20) || 'nos', rate: num(x && x.rate), qty: num(x && x.qty) || 0,
    link: x && x.link && x.link.tower ? { tower: txt(x.link.tower, 20) } : null, perSlab: x && x.link && x.link.tower ? (num(x.perSlab) > 0 ? num(x.perSlab) : 1) : undefined,
  })).filter((x) => x.desc);
  return {
    contractor: txt(d.contractor, 120), company: COMPANIES.includes(d.company) ? d.company : 'Prime Realtors', scope: txt(d.scope, 300), date: isDate(d.date) ? d.date : istToday(),
    pan: txt(d.pan, 12).toUpperCase(), gstin: txt(d.gstin, 15).toUpperCase(),
    retentionPct: Math.min(20, Math.max(0, num(d.retentionPct) || 0)), tdsPct: Math.min(10, Math.max(0, num(d.tdsPct) || 0)),
    advance: Math.max(0, num(d.advance) || 0), advanceRecoveryPct: Math.min(100, Math.max(0, num(d.advanceRecoveryPct) || 0)),
    towers: (Array.isArray(d.towers) ? d.towers : []).map((x) => txt(x, 20)).filter(Boolean).slice(0, 6),
    wastage: Object.fromEntries(['rmcPct', 'steelPct', 'cementPct', 'rmcRate', 'steelRate', 'cementRate'].map((k) => [k, Math.max(0, num(d.wastage && d.wastage[k]) || 0)])),
    norms: Object.fromEntries(['steelKgPerSqft', 'cementBagsPerSqft', 'rmcM3PerSqft'].map((k) => [k, Math.max(0, num(d.norms && d.norms[k]) || 0)])),
    items, ...(cur ? {} : {}),
  };
}

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, 'purchase');
  if (!u) return;
  const can = caps(u);
  if (!can) return res.status(403).json({ error: 'Contractor bills are for Purchase, Accounts and Management.', home: auth.publicUser(u).home });
  const say = (code, error) => res.status(code).json({ error });
  try {
    if (req.method === 'GET') {
      const [wos, bills, users] = await kv.hgetallMany([WO, BILLS, 'users']);
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
      if (!w.items.length) return say(400, 'Add at least one item with its rate.');
      for (const it of w.items) if (!(it.rate >= 0)) return say(400, `Enter the rate for "${it.desc}".`);
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
    if (op === 'wo_approve' || op === 'wo_close') {
      const w = wos[b.id]; if (!w) return say(404, 'That work order no longer exists.');
      if (!can.approve) return say(403, 'Only Management can do this.');
      if (op === 'wo_approve') { if (w.status !== 'pending_approval') return say(409, 'This work order is not waiting for approval.'); if (w.createdBy === u.username && !can.admin) return say(409, 'Someone else in Management has to approve a work order you entered.'); w.status = 'active'; log(w, 'Approved by Management'); }
      else { w.status = w.status === 'closed' ? 'active' : 'closed'; log(w, w.status === 'closed' ? 'Closed' : 'Reopened', txt(d.note)); }
      await kv.hset(WO, w.id, w);
      return res.status(200).json({ ok: true, wo: w });
    }

    // ---------- RA bills ----------
    if (op === 'bill_save') {
      if (!can.enter) return say(403, 'Only Purchase or Management can enter contractor bills.');
      const cur = b.id ? bills[b.id] : null;
      if (b.id && !cur) return say(404, 'That bill no longer exists.');
      if (cur && cur.status !== 'draft') return say(409, 'Only a draft bill can be changed.');
      const w = wos[cur ? cur.woId : d.woId]; if (!w) return say(400, 'Choose the work order.');
      if (w.status !== 'active') return say(409, w.status === 'closed' ? 'This work order is closed.' : 'Management has not approved this work order yet.');
      if (!isDate(d.from) || !isDate(d.to) || d.from > d.to) return say(400, 'Enter the bill period (from and to).');
      const fin = cur ? !!cur.final : !!d.final;
      const finalBill = Object.values(bills).find((x) => x && x.woId === w.id && x.final && live(x) && (!cur || x.id !== cur.id));
      if (finalBill) return say(409, `The final measurement bill ${finalBill.no} is already entered on this work order.`);
      const lines = w.items.map((it) => { const x = (Array.isArray(d.lines) ? d.lines : []).find((l) => l && l.itemId === it.id) || {};
        return fin ? { itemId: it.id, final: Math.max(0, num(x.final) || 0) } : { itemId: it.id, qty: Math.max(0, num(x.qty) || 0) }; });
      if (fin && !lines.some((l) => l.final > 0)) return say(400, 'Enter the final measured quantity for the items done.');
      if (!fin && !lines.some((l) => l.qty > 0)) return say(400, 'Enter the quantity done this bill for at least one item.');
      let doc;
      if (cur) doc = { ...cur };
      else {
        const seq = Object.values(bills).filter((x) => x && x.woId === w.id).reduce((a, x) => Math.max(a, x.seq || 0), 0) + 1;
        doc = { id: newId(), woId: w.id, seq, no: `${w.no}/${fin ? 'FINAL' : 'RA-' + String(seq).padStart(2, '0')}`, final: fin || undefined, status: 'draft', createdBy: u.username, createdAt: now, history: [] };
      }
      Object.assign(doc, { from: d.from, to: d.to, billNo: txt(d.billNo, 60), billDate: isDate(d.billDate) ? d.billDate : '', lines, materialRecovery: Math.max(0, num(d.materialRecovery) || 0), materialNote: txt(d.materialNote, 200), otherDeduction: Math.max(0, num(d.otherDeduction) || 0), otherNote: txt(d.otherNote, 200), note: txt(d.note) });
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
