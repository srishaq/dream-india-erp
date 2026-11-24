// Purchase requests for Dream Signature, Phase 1: RMC, steel and cement against the floor-wise budget.
// Flow: Site requests -> Management (Sameer) approves every request before anything is bought -> Purchase
// places the order and enters the bill -> Site confirms the quantity received -> Accounts approve the bill -> Accounts
// pay it from Payments Out in the ERP, which marks it Paid. Served from /api/me?purchase=1 (Vercel Hobby allows 12 functions per deployment).
const auth = require('./auth');
const kv = require('./kv');
const { body, noStore } = require('./http');
// The live BOQ: the structural engineer's grade- and bar-size-wise quantities of 16 Nov 2026, one combined structure
// (scripts/build-boq.js). It replaced the 22 Jun 2026 floor budget (purchase-budget.json, kept for reference).
const BUDGET = require('./boq-structure.json');
// Rates per RMC grade and steel bar size: the BOQ's starting rates, changed by Management as the market moves (kept in
// po:meta 'rates' with who changed what and when).
async function getRates() {
  const saved = await kv.hget('po:meta', 'rates').catch(() => null);
  const v = saved && typeof saved === 'object' ? saved : {};
  return { rmc: { ...BUDGET.rates.rmc, ...(v.rmc || {}) }, steel: { ...BUDGET.rates.steel, ...(v.steel || {}) }, nsRmc: v.nsRmc || BUDGET.rates.nsRmc, history: v.history || [] };
}
const specKey = (material, spec) => (material === 'Steel' ? String(spec || '').replace(/\D/g, '') : String(spec || '').trim());
// a line's RMC rate: its grades at today's rates (a line with no grade split takes the non-structural rate)
function lineRmcRate(line, R) {
  const g = line.grades || {}, q = Object.values(g).reduce((a, x) => a + x, 0);
  if (!q) return line.rmcRate || (line.noGradeSplit ? R.nsRmc : null);
  return Math.round(Object.entries(g).reduce((a, [k, x]) => a + x * (R.rmc[k] || 0), 0) / q);
}
function lineSteelRate(line, R) {
  const d = line.dias || {}, q = Object.values(d).reduce((a, x) => a + x, 0);
  const all = Object.values(R.steel); const avg = all.length ? all.reduce((a, x) => a + x, 0) / all.length : 60000;
  return q ? Math.round(Object.entries(d).reduce((a, [k, x]) => a + x * (R.steel[k] || avg), 0) / q) : Math.round(avg);
}

const KEY = 'po:orders';
const ID = /^[A-Za-z0-9]{6,40}$/;
const MATERIALS = {
  RMC: { unit: 'm³', specs: ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M60'] },
  Steel: { unit: 'MT', specs: ['8 mm', '10 mm', '12 mm', '16 mm', '20 mm', '25 mm', '32 mm', 'Binding wire'] },
  Cement: { unit: 'bags', specs: ['OPC 53', 'OPC 43', 'PPC'] },
  // Excavation and Others have no BOQ quantity yet, so they are tracked but not budget-checked.
  Excavation: { unit: 'm³', units: ['m³', 'brass', 'trips', 'hours', 'lump sum'], specs: ['Excavation in soil', 'Excavation in hard rock (breaker)', 'Carting away / disposal', 'Dewatering', 'Backfilling'] },
  Others: { unit: 'nos', units: ['nos', 'm³', 'MT', 'kg', 'bags', 'sqm', 'rmt', 'trips', 'lump sum'], specs: null },
};
const WINGS = { Structure: ['A wing', 'B wing', 'Rehab', 'All wings / common'], Sale: ['A wing', 'B wing', 'Both wings / common'], Rehab: ['Rehab'], Project: ['—', 'Sale side', 'Rehab side', 'Whole site'] };
// Requests saved before "Whole project" was renamed "Project" keep working, and requests raised on the 22 Jun budget's
// Sale / Rehab floor lines count on the combined structure's floor line now.
const fixLine = (k) => { const x = String(k || '').replace(/^Whole project\|/, 'Project|'); return BUDGET.oldLines[x] || x; };
// Over the budget by more than this share needs Management's approval.
const TOLERANCE = 0.02;
const STEPS = ['pending_approval', 'requested', 'ordered', 'received', 'accounts_ok', 'paid'];

// Budget lines: one per building and floor (plus whole-project lines), each with RMC m³ and steel MT.
function lines() {
  const out = [...BUDGET.lines, ...BUDGET.extra].map((l) => ({ ...l, key: `${l.building}|${l.floor}` }));
  out.push({ building: 'Project', floor: 'Retaining wall', key: 'Project|Retaining wall' });
  out.push({ building: 'Project', floor: 'Cement for Mandal (blockwork, plaster, waterproofing)', key: 'Project|Cement', cement: BUDGET.cement.bags, cementRate: BUDGET.cement.rate });
  out.push({ building: 'Project', floor: 'Other (no budget line)', key: 'Project|Other' });
  return out;
}
const LINES = lines();
const LINE = Object.fromEntries(LINES.map((l) => [l.key, l]));
const field = (m) => (m === 'RMC' ? 'rmc' : m === 'Steel' ? 'steel' : m === 'Cement' ? 'cement' : null);
const budgetRate = (line, m, R) => (m === 'RMC' ? lineRmcRate(line, R) : m === 'Steel' ? lineSteelRate(line, R) : m === 'Cement' ? line.cementRate || BUDGET.cement.rate : null);
// the rate of each grade / bar size asked for (RMC M45, steel 25 mm), at today's rates
const specRates = (material, items, R) => Object.fromEntries((items || []).map((i) => [i.spec, material === 'RMC' ? R.rmc[specKey(material, i.spec)] || null : material === 'Steel' ? R.steel[specKey(material, i.spec)] || null : null]).filter(([, v]) => v));

// What counts against a budget line: the received quantity once received, else the ordered, else the requested.
function qtyOf(o) {
  if (['rejected', 'cancelled'].includes(o.status)) return 0;
  if (o.receipt) return +o.receipt.qty || 0;
  if (o.order) return +o.order.qty || 0;
  return +o.qty || 0;
}
function usage(orders, skipId) {
  const u = {};
  for (const o of Object.values(orders)) {
    if (o.id === skipId) continue;
    const k = `${fixLine(o.line)}|${o.material}`;
    u[k] = (u[k] || 0) + qtyOf(o);
  }
  return u;
}
function budgetCheck(orders, line, material, qty, skipId) {
  const f = field(material), l = LINE[line];
  const budget = f && l && l[f] != null ? +l[f] : null;
  if (budget == null) return { budget: null, before: null, used: null, balance: null, over: false, noBudget: true };
  const opening = (l.opening && +l.opening[f]) || 0;
  const used = opening + (usage(orders, skipId)[`${line}|${material}`] || 0);
  const balance = budget - used;
  // A floor already done before the portal (opening covers the budget) has no tolerance left.
  const closed = opening >= budget;
  const over = balance - qty < 0 && (closed || used + qty > budget * (1 + TOLERANCE));
  return { budget, opening, used, balance, after: balance - qty, over };
}
// The grade / bar size on the floor's BOQ: e.g. M60 on Floor 3, or 25 mm steel on Floor 30. Quantities ordered before the
// BOQ had grades (opening, old requests with no grade) are not counted here, only on the floor's total.
function specCheck(orders, line, material, items, skipId) {
  const l = LINE[line], src = material === 'RMC' ? l && l.grades : material === 'Steel' ? l && l.dias : null;
  if (!src || !Object.keys(src).length) return [];
  return (items || []).map((it) => {
    const k = specKey(material, it.spec), budget = src[k] != null ? +src[k] : 0;
    let used = 0;
    for (const o of Object.values(orders)) {
      if (o.id === skipId || fixLine(o.line) !== line || o.material !== material || ['rejected', 'cancelled'].includes(o.status)) continue;
      const its = o.items && o.items.length ? o.items : [{ spec: o.spec, qty: o.qty }];
      const total = its.reduce((a, x) => a + (+x.qty || 0), 0) || 1, done = qtyOf(o);
      for (const x of its) if (specKey(material, x.spec) === k) used += done * ((+x.qty || 0) / total);
    }
    const balance = budget - used;
    return { spec: it.spec, budget, used, balance, after: balance - (+it.qty || 0), over: balance - (+it.qty || 0) < -Math.max(0.001, budget * TOLERANCE), notInBoq: !budget };
  });
}

// What this login may do in Purchase.
function caps(u) {
  const r = auth.ROLES[u.role] || {};
  if (!auth.can(u, 'purchase')) return null;
  const full = u.role === 'admin' || u.role === 'management';
  const team = r.team ? auth.teamAccess(u).purchase : null;
  const site = full || ['site_head', 'site_engineer'].includes(u.role) || team === 'site';
  return {
    request: site, receive: site,
    approve: full,
    order: full || team === 'purchase',
    accounts: full || u.role === 'accounts_head' || team === 'accounts',
    cancelAny: full,
  };
}

// Old records: "Whole project" was renamed "Project", and requests raised before every request needed
// Management's approval (still 'requested' with no approval) now wait for it like new ones.
function tidy(o) {
  o.line = fixLine(o.line);
  if (LINE[o.line] && o.building !== LINE[o.line].building) { o.building = LINE[o.line].building; o.floor = LINE[o.line].floor; }
  if (o.building === 'Whole project') o.building = 'Project';
  if (o.status === 'requested' && !o.approval) o.status = 'pending_approval';
}

// Management's decision on a request: from the Purchase page, the one-tap link or a WhatsApp reply. Returns an error or null.
function decide(o, u, ok, note, via) {
  const c = caps(u);
  if (!c || !c.approve) return 'Only Management can approve purchase requests.';
  if (o.status === 'bill_approval') return decideBill(o, u, ok, note, via);
  if (o.status !== 'pending_approval') return `${o.no} is not waiting for approval (it is ${String(o.status).replace(/_/g, ' ')}).`;
  if (o.requestedBy === u.username && u.role !== 'admin') return 'You raised this request, so someone else in Management has to approve it.';
  note = String(note ?? '').trim().slice(0, 300);
  if (!ok && !note) return 'Give a reason for rejecting.';
  const now = new Date().toISOString();
  o.approval = { ok, by: u.username, at: now, note, overBudget: !!(o.budgetAtRequest && o.budgetAtRequest.over), via: via || undefined };
  o.status = ok ? 'requested' : 'rejected';
  const did = ok ? (o.approval.overBudget ? 'Approved by Management (over budget)' : 'Approved by Management') : 'Rejected by Management';
  o.history = [...(o.history || []), { at: now, by: u.username, did: via ? `${did}, ${via}` : did, note: note || undefined }];
  o.updatedAt = now; o.updatedBy = u.username;
  return null;
}
// The bill Accounts entered, approved for payment by Management (24 Nov 2026: "that should trigger a message to Sameer for
// approval; once he approves, they can pay the bill"). Sent back, it returns to Accounts with the reason.
function decideBill(o, u, ok, note, via) {
  note = String(note ?? '').trim().slice(0, 300);
  if (!ok && !note) return 'Give a reason for sending the bill back.';
  const now = new Date().toISOString();
  o.billApproval = { ok, by: u.username, at: now, note, via: via || undefined };
  if (ok) { o.accounts = { by: u.username, at: now, note, payable: (o.bill && o.bill.amount) || (o.order && o.order.amount) }; o.status = 'accounts_ok'; o.hold = null; }
  else o.status = 'with_accounts';
  const did = ok ? 'Bill approved for payment by Management' : 'Bill sent back to Accounts by Management';
  o.history = [...(o.history || []), { at: now, by: u.username, did: via ? `${did}, ${via}` : did, note: note || undefined }];
  o.updatedAt = now; o.updatedBy = u.username;
  return null;
}
// Site logins never see rates, bill amounts or payments.
const MONEY_FREE = (c) => c && !c.order && !c.accounts && !c.approve;
function noMoney(o) {
  const x = { ...o };
  delete x.budgetRate; delete x.budgetRates; delete x.accounts; delete x.payment; delete x.hold; delete x.bill; delete x.billApproval;
  if (x.order) x.order = { vendor: x.order.vendor, qty: x.order.qty, items: (x.order.items || []).map((i) => ({ spec: i.spec, qty: i.qty })), poNo: x.order.poNo, at: x.order.at, by: x.order.by };
  if (x.flags) x.flags = { short: x.flags.short, excess: x.flags.excess };
  if (x.history) x.history = x.history.map((h) => ({ ...h, note: /₹/.test(h.note || '') ? undefined : h.note }));
  return x;
}
// Purchase material → the Construction page's materials log
const SITE_MAT = { RMC: 'rmc', Steel: 'steel', Cement: 'cement' };
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
const txt = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// One request can carry several sizes or grades (e.g. steel 8, 12 and 16 mm), each with its own quantity.
// Requests saved before this have a single spec and qty, which reads as one line.
const itemsOf = (o) => (Array.isArray(o.items) && o.items.length ? o.items : [{ spec: o.spec, qty: o.qty }]);
const sum = (a, k) => a.reduce((s, x) => s + (+x[k] || 0), 0);
const round3 = (n) => Math.round(n * 1000) / 1000;
// What Purchase did not order is kept as its own approved request, to order later (24 Nov 2026: 6 of 18 m³ ordered,
// the other 12 could not be ordered). snap is the request as it was before the order; ordered: [{ spec, qty }].
async function balanceOf(snap, ordered, u, now) {
  const left = itemsOf(snap).map((it) => ({ ...it, qty: round3((+it.qty || 0) - sum(ordered.filter((x) => x.spec === it.spec), 'qty')) }))
    .filter((it) => it.qty > 0.001);
  // a shortfall within the tolerance (17.9 of 18) is not a balance
  const real = left.filter((it) => { const ap = +(itemsOf(snap).find((x) => x.spec === it.spec) || {}).qty || 0; return it.qty > ap * TOLERANCE; });
  if (!real.length) return null;
  const [all] = await kv.hgetallMany([KEY]);
  const used = new Set(Object.values(all || {}).map((x) => x.no));
  const root = String(snap.no).replace(/-[A-Z]$/, '');
  let no = null;
  for (let i = 1; i < 26 && !no; i++) { const c = `${root}-${String.fromCharCode(65 + i)}`; if (!used.has(c) && c !== snap.no) no = c; }
  const doc = JSON.parse(JSON.stringify(snap));
  for (const k of ['order', 'flags', 'receipt', 'accounts', 'payment', 'hold']) delete doc[k];
  doc.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + 'b';
  doc.no = no || `${root}-BAL`;
  doc.items = real; doc.spec = real.map((x) => x.spec).join(', '); doc.qty = round3(sum(real, 'qty'));
  doc.status = 'requested';
  doc.history = [...(snap.history || []), { at: now, by: u.username, did: `Balance of ${snap.no} still to order`, note: real.map((x) => `${x.spec} ${x.qty} ${snap.unit || ''}`.trim()).join('; ') }];
  doc.updatedAt = now; doc.updatedBy = u.username;
  return doc;
}
// the order carries what was ordered (the balance is its own request)
function keepOrdered(doc, ordered) {
  const items = itemsOf(doc).map((it) => ({ ...it, qty: round3(sum(ordered.filter((x) => x.spec === it.spec), 'qty')) })).filter((it) => it.qty > 0);
  if (!items.length) return;
  doc.items = items; doc.spec = items.map((x) => x.spec).join(', '); doc.qty = round3(sum(items, 'qty'));
}
// Lines sent by the page, matched to the request's lines by spec; falls back to the single qty/rate fields.
function lineInput(d, o, keys) {
  const its = itemsOf(o), sent = Array.isArray(d.items) ? d.items : null;
  return its.map((it, i) => {
    const s = sent ? sent.find((x) => x && x.spec === it.spec) || sent[i] || {} : its.length === 1 ? d : {};
    const out = { spec: it.spec };
    for (const k of keys) out[k] = num(s[k]);
    return out;
  });
}

module.exports = async (req, res) => {
  noStore(res);
  const q0 = req.query || {};
  // The one-tap approval link from email or WhatsApp: no session, the signed link names the approver.
  if (req.method === 'GET' && q0.t && q0.scan) return linkScan(req, res, q0.t);
  if (req.method === 'GET' && q0.t) return linkView(req, res, q0.t);
  if (req.method === 'POST' && body(req).op === 'link') return linkDecide(req, res, body(req));
  const u = await auth.guard(req, res, 'purchase');
  if (!u) return;
  const can = caps(u);
  can.readChallan = can.receive && require('../challan-read').configured();
  if (req.method === 'GET' && q0.photo) {
    const ph = ID.test(String(q0.photo)) ? await kv.hget('po:photos', q0.photo) : null;
    if (!ph || !ph.data) return res.status(404).json({ error: 'No photo.' });
    const m = String(ph.data).match(/^data:(image\/[a-z]+|application\/pdf);base64,(.*)$/);
    if (!m) return res.status(404).json({ error: 'No photo.' });
    res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.end(Buffer.from(m[2], 'base64'));
  }
  try {
    if (req.method === 'GET') {
      const [orders, users] = await kv.hgetallMany([KEY, 'users']);
      for (const o of Object.values(orders)) tidy(o);
      // orders still to be placed: each grade / bar size at today's rate (orders raised before per-grade rates had only
      // the line's blended rate, shown on every grade: M35 and M60 both at ₹7,758, 24 Nov 2026)
      if (!MONEY_FREE(can)) {
        const R0 = await getRates();
        for (const o of Object.values(orders)) if (['requested', 'pending_approval'].includes(o.status) && ['RMC', 'Steel'].includes(o.material) && (o.items || []).length) o.budgetRates = { ...specRates(o.material, o.items, R0), ...(o.budgetRates || {}) };
      }
      const people = {};
      for (const x of Object.values(users)) people[x.username] = x.name || x.username;
      if (MONEY_FREE(can)) for (const k of Object.keys(orders)) orders[k] = noMoney(orders[k]);
      return res.status(200).json({
        me: auth.publicUser(u), can, people, orders, materials: MATERIALS, wings: WINGS, tolerance: TOLERANCE,
        budget: MONEY_FREE(can) ? { version: BUDGET.version, source: BUDGET.source, replaces: BUDGET.replaces, trackers: BUDGET.trackers, grades: BUDGET.grades, dias: BUDGET.dias, totals: BUDGET.totals, lines: LINES.map(({ rmcRate, cementRate, ...l }) => l) }
          : await (async () => { const R = await getRates(); return { version: BUDGET.version, source: BUDGET.source, replaces: BUDGET.replaces, trackers: BUDGET.trackers, grades: BUDGET.grades, dias: BUDGET.dias, totals: BUDGET.totals, wastage: BUDGET.wastage, rates: R, steelRate: lineSteelRate({}, R),
            lines: LINES.map((l) => ({ ...l, rmcRate: l.rmc != null ? lineRmcRate(l, R) : undefined, steelRate: l.steel != null ? lineSteelRate(l, R) : undefined })) }; })(),
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
    const b = body(req);
    const op = b.op, d = b.data && typeof b.data === 'object' ? b.data : {};
    const now = new Date().toISOString();
    const orders = await kv.hgetall(KEY);
    for (const o of Object.values(orders)) tidy(o);
    const say = (code, error) => res.status(code).json({ error });

    if (op === 'read_challan') {
      if (!can.receive) return say(403, 'Only the site team can read a delivery challan.');
      const photo = String(d.photo || '');
      if (!PHOTO.test(photo) || photo.length > 6e6) return say(400, 'Take a photo of the challan first.');
      try { return res.status(200).json({ ok: true, read: await require('../challan-read').read(photo) }); }
      catch (e) { return say(e.status || 502, e.message || 'Could not read the challan. Fill it in by hand.'); }
    }

    if (op === 'request') {
      if (!can.request) return say(403, 'Only the site team can raise a purchase request.');
      const material = d.material;
      const M = MATERIALS[material];
      if (!M) return say(400, 'Choose the material.');
      const what = material === 'RMC' ? 'grade' : material === 'Steel' ? 'bar size' : material === 'Excavation' ? 'type of work' : 'cement type';
      const raw = M.specs && Array.isArray(d.items) && d.items.length ? d.items.slice(0, 12) : [{ spec: d.spec, qty: d.qty }];
      const items = [];
      for (const r of raw) {
        const spec = txt(r && r.spec, 80), q = num(r && r.qty);
        if (M.specs ? !M.specs.includes(spec) : !spec) return say(400, material === 'Others' ? 'Describe the item (for example shuttering plywood).' : `Choose the ${what}.`);
        if (!(q > 0) || q > 100000) return say(400, raw.length > 1 ? `Enter the quantity for ${spec}.` : 'Enter the quantity needed.');
        if (items.some((x) => x.spec === spec)) return say(400, `${spec} is entered twice. Put its full quantity on one line.`);
        items.push({ spec, qty: q });
      }
      const spec = items.map((x) => x.spec).join(', ');
      const unit = M.units ? txt(d.unit, 20) : M.unit;
      if (M.units && !M.units.includes(unit)) return say(400, 'Choose the unit.');
      const line = fixLine(txt(d.line, 120));
      if (!LINE[line]) return say(400, 'Choose the building and floor this is for.');
      const qty = round3(sum(items, 'qty'));
      const wing = txt(d.wing, 40);
      if (!(WINGS[LINE[line].building] || []).includes(wing)) return say(400, 'Choose the wing.');
      if (d.neededBy && !isDate(d.neededBy)) return say(400, 'Enter the date needed as a date.');
      const chk = budgetCheck(orders, line, material, qty);
      chk.specs = specCheck(orders, line, material, items);
      if (chk.specs.some((x) => x.over)) chk.over = true; // a grade or bar size past its BOQ quantity on this floor
      const R = await getRates();
      // Numbers never repeat, even after a test entry is deleted.
      const top = Math.max(0, ...Object.values(orders).map((x) => +String(x.no || '').replace(/\D/g, '') || 0));
      const seq = Math.max(top, +(await kv.hget('po:meta', 'seq')) || 0) + 1;
      await kv.hset('po:meta', 'seq', seq);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const doc = {
        id, no: `PR-${String(seq).padStart(4, '0')}`, material, spec, unit, qty, items, line,
        building: LINE[line].building, floor: LINE[line].floor, wing, element: txt(d.element, 120), neededBy: d.neededBy || '', note: txt(d.note),
        // Every request waits for Management's approval before Purchase can order it.
        status: 'pending_approval', budgetAtRequest: chk, budgetRate: budgetRate(LINE[line], material, R), budgetRates: specRates(material, items, R),
        requestedBy: u.username, requestedAt: now, history: [{ at: now, by: u.username, did: chk.over ? 'Requested (over budget), sent to Management for approval' : 'Requested, sent to Management for approval' }],
      };
      await kv.hset(KEY, id, doc);
      // Management hears about it straight away (email, and WhatsApp once connected); the 5-minute job retries a miss.
      try { await require('../staff-alerts').notifyRequest(doc); } catch (e) { console.error('approval notice', e.message); }
      return res.status(200).json({ ok: true, doc: MONEY_FREE(can) ? noMoney(doc) : doc });
    }

    // Management changes the BOQ rates (per RMC grade, per steel bar size) as the market moves; each change is kept
    if (op === 'boq_rates') {
      if (!can.approve) return say(403, 'Only Management can change the BOQ rates.');
      const R = await getRates(), next = { rmc: { ...R.rmc }, steel: { ...R.steel }, nsRmc: R.nsRmc }, changed = [];
      for (const [grp, keys] of [['rmc', Object.keys(R.rmc)], ['steel', Object.keys(R.steel)]]) {
        for (const k of keys) {
          const v = d[grp] && d[grp][k]; if (v == null || v === '') continue;
          const x = num(v); if (!(x > 0) || x > 10000000) return say(400, `Enter a rate for ${grp === 'rmc' ? k : k + ' mm'} as a number.`);
          if (x !== R[grp][k]) { changed.push({ item: grp === 'rmc' ? `RMC ${k}` : `Steel ${k} mm`, from: R[grp][k], to: x }); next[grp][k] = x; }
        }
      }
      if (d.nsRmc != null && d.nsRmc !== '') { const x = num(d.nsRmc); if (x > 0 && x !== R.nsRmc) { changed.push({ item: 'RMC, non-structural walls', from: R.nsRmc, to: x }); next.nsRmc = x; } }
      if (!changed.length) return res.status(200).json({ ok: true, changed: [] });
      next.history = [{ at: now, by: u.username, changes: changed }, ...(R.history || [])].slice(0, 100);
      await kv.hset('po:meta', 'rates', next);
      return res.status(200).json({ ok: true, changed, rates: next });
    }

    const id = String(b.id || '');
    if (!ID.test(id) || !orders[id]) return say(404, 'That request no longer exists.');
    const o = orders[id];
    const log = (did, note) => { o.history = [...(o.history || []), { at: now, by: u.username, did, note: note || undefined }]; };
    const extra = []; // other requests made by this step (the balance still to order)
    const need = (st) => o.status === st;

    if (op === 'approve' || op === 'reject') {
      if (!can.approve) return say(403, 'Only Management can approve purchase requests.');
      if (!need('pending_approval')) return say(409, 'This request is not waiting for approval.');
      const e = decide(o, u, op === 'approve', d.note);
      if (e) return say(400, e);
    } else if (op === 'order') {
      if (!can.order) return say(403, 'Only the purchase team can place the order.');
      if (!need('requested')) return say(409, 'This request is not waiting for an order.');
      const its = itemsOf(o), multi = its.length > 1, snap = JSON.parse(JSON.stringify(o));
      // each grade checked against its own rate (orders raised before per-grade rates kept only the blended one)
      if (['RMC', 'Steel'].includes(o.material) && its.length) o.budgetRates = { ...specRates(o.material, its, await getRates()), ...(o.budgetRates || {}) };
      // One grade split between vendors (24 Nov 2026: 18 m³ of M35 from three plants): the form sends one row per vendor
      // per grade ("parts"). Each vendor's rows become their own order (R-12, R-12-B, R-12-C) with its own bill, so the
      // site confirms and Accounts pays each vendor on its own. Rows of one vendor are merged into one order.
      if (Array.isArray(d.parts) && d.parts.length > 1) {
        let last = txt(d.vendor, 120);
        const parts = d.parts.map((p) => { const v = txt(p && p.vendor, 120) || last; last = v || last; return { spec: txt(p && p.spec, 60), qty: num(p && p.qty), rate: num(p && p.rate), vendor: v, amount: num(p && p.amount), billNo: txt(p && p.billNo, 60), poNo: txt(p && p.poNo, 60) }; });
        for (const p of parts) {
          if (!its.some((i) => i.spec === p.spec)) return say(400, `${p.spec || 'A row'} is not on this request.`);
          if (!(p.qty >= 0)) return say(400, `Enter the quantity for ${p.spec} (0 if not ordered).`);
          if (p.qty > 0 && !(p.rate > 0)) return say(400, `Enter the rate per ${o.unit} for ${p.spec}${p.vendor ? ' from ' + p.vendor : ''}, including GST.`);
          if (p.qty > 0 && !p.vendor) return say(400, `Enter the vendor for ${p.spec}.`);
        }
        const live = parts.filter((p) => p.qty > 0);
        if (!live.length) return say(400, 'Enter the quantity ordered.');
        if (d.billDate && !isDate(d.billDate)) return say(400, 'Enter the bill date as a date.');
        if (!can.approve) for (const it of its) {
          const got = round3(sum(live.filter((p) => p.spec === it.spec), 'qty'));
          if (got > (+it.qty || 0) * (1 + TOLERANCE)) return say(409, `Management approved ${it.qty} ${o.unit} of ${it.spec}; the vendors add up to ${got}. To buy more, the site should raise a new request for the extra.`);
        }
        const groups = [];
        for (const p of live) {
          let g = groups.find((y) => y.vendor.toLowerCase() === p.vendor.toLowerCase());
          if (!g) groups.push(g = { vendor: p.vendor, lines: [], billNo: '', poNo: '', amount: 0 });
          const same = g.lines.find((x) => x.spec === p.spec);
          if (same) { const q = same.qty + p.qty; same.rate = Math.round(((same.qty * same.rate + p.qty * p.rate) / q) * 100) / 100; same.qty = round3(q); } else g.lines.push({ spec: p.spec, qty: p.qty, rate: p.rate });
          g.billNo = g.billNo || p.billNo; g.poNo = g.poNo || p.poNo;
          g.amount += p.amount > 0 ? p.amount : p.qty * p.rate;
        }
        if (groups.length === 1) {
          // one vendor after all: an ordinary order
          const g = groups[0];
          d.items = its.map((it) => { const x = g.lines.find((l) => l.spec === it.spec); return { spec: it.spec, qty: x ? String(x.qty) : '0', rate: x ? String(x.rate) : '' }; });
          if (its.length === 1) { d.qty = d.items[0].qty; d.rate = d.items[0].rate; }
          d.vendor = g.vendor; d.billNo = d.billNo || g.billNo; d.poNo = d.poNo || g.poNo; d.amount = String(Math.round(g.amount * 100) / 100);
        } else {
          if (!(o.approval && o.approval.ok)) return say(409, 'Management has not approved this request yet.');
          const nos = groups.map((_, i) => (i ? `${o.no}-${String.fromCharCode(65 + i)}` : o.no));
          const zero = [];
          const base = JSON.parse(JSON.stringify(o)), docs = [];
          groups.forEach((g, i) => {
            const doc = i === 0 ? o : { ...JSON.parse(JSON.stringify(base)), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + i, no: nos[i], history: [...(base.history || []), { at: now, by: u.username, did: `Split from ${o.no}: ${g.vendor}` }] };
            // each order carries what was ordered from that vendor (grades not bought now stay on the first one)
            const items = [...g.lines.map((l) => ({ ...(its.find((x) => x.spec === l.spec) || {}), spec: l.spec, qty: l.qty })), ...(i === 0 ? zero : [])];
            doc.items = items; doc.spec = items.map((x) => x.spec).join(', '); doc.qty = round3(sum(items, 'qty'));
            const gq = round3(sum(g.lines, 'qty')), gv = g.lines.reduce((a, x) => a + x.qty * x.rate, 0), amount = Math.round(g.amount * 100) / 100;
            doc.order = { vendor: g.vendor, qty: gq, rate: Math.round((gv / gq) * 100) / 100, amount, items: [...g.lines, ...(i === 0 ? zero.map((z) => ({ spec: z.spec, qty: 0, rate: 0 })) : [])], billNo: g.billNo, billDate: d.billDate || '', poNo: g.poNo, note: txt(d.note), by: u.username, at: now };
            doc.flags = { rateOver: doc.budgetRate ? g.lines.some((x) => x.rate > ((doc.budgetRates || {})[x.spec] || doc.budgetRate) * 1.0001) : false, amountMismatch: Math.abs(gv - amount) > Math.max(1, amount * 0.01) };
            doc.status = 'ordered';
            doc.history = [...(doc.history || []), { at: now, by: u.username, did: 'Ordered and bill entered', note: `${g.vendor}, ${g.lines.map((x) => `${x.spec} ${x.qty} ${o.unit} at ₹${x.rate}`).join('; ')}, bill ₹${amount}${g.poNo ? ', PO ' + g.poNo : ''}` }];
            doc.updatedAt = now; doc.updatedBy = u.username;
            docs.push(doc);
          });
          o.history.splice(o.history.length - 1, 0, { at: now, by: u.username, did: `Split between vendors into ${nos.join(', ')}` });
          const bal = await balanceOf(snap, live, u, now);
          for (const doc of docs) await kv.hset(KEY, doc.id, doc);
          if (bal) { await kv.hset(KEY, bal.id, bal); o.history.push({ at: now, by: u.username, did: `Balance to order later: ${bal.no}`, note: bal.items.map((x) => `${x.spec} ${x.qty} ${o.unit}`).join('; ') }); await kv.hset(KEY, o.id, o); }
          return res.status(200).json({ ok: true, doc: o, split: docs.map((x) => (MONEY_FREE(can) ? noMoney(x) : x)), balance: bal ? [bal] : undefined });
        }
      }
      const ol = lineInput(d, o, ['qty', 'rate']);
      for (const x of ol) {
        if (!(x.qty >= 0) || (!multi && !(x.qty > 0))) return say(400, multi ? `Enter the quantity ordered for ${x.spec} (0 if not ordered).` : 'Enter the quantity ordered.');
        if (x.qty > 0 && !(x.rate > 0)) return say(400, multi ? `Enter the rate per ${o.unit} for ${x.spec}, including GST.` : `Enter the rate per ${o.unit}, including GST.`);
      }
      const qty = round3(sum(ol, 'qty'));
      if (!(qty > 0)) return say(400, 'Enter the quantity ordered.');
      if (d.billDate && !isDate(d.billDate)) return say(400, 'Enter the bill date as a date.');
      // Different vendors can supply different sizes or grades (17 Nov 2026): each size may carry its own vendor, bill
      // and PO no. A blank vendor means "same as the line above". Each vendor's lines become their own order.
      const sent = Array.isArray(d.items) ? d.items : [];
      const perLine = (sp, k, max) => txt((sent.find((x) => x && x.spec === sp) || {})[k], max);
      if (multi && sent.some((x) => x && txt(x.vendor))) {
        let last = txt(d.vendor, 120);
        const groups = [];
        for (const x of ol) {
          const v = perLine(x.spec, 'vendor', 120) || last; last = v || last;
          if (!(x.qty > 0)) continue;
          if (!v) return say(400, `Enter the vendor for ${x.spec}.`);
          let g = groups.find((y) => y.vendor.toLowerCase() === v.toLowerCase());
          if (!g) groups.push(g = { vendor: v, lines: [], billNo: '', poNo: '', amount: 0, typed: true });
          g.lines.push(x);
          g.billNo = g.billNo || perLine(x.spec, 'billNo', 60); g.poNo = g.poNo || perLine(x.spec, 'poNo', 60);
          const a = num(perLine(x.spec, 'amount', 30));
          if (a > 0) g.amount += a; else g.typed = false;
          if (!(a > 0)) g.amount += x.qty * x.rate;
        }
        if (groups.length > 1) {
          if (!(o.approval && o.approval.ok)) return say(409, 'Management has not approved this request yet.');
          if (!can.approve) for (const x of ol) {
            const ap = +(its.find((i) => i.spec === x.spec) || {}).qty || 0;
            if (x.qty > ap * (1 + TOLERANCE)) return say(409, `Management approved ${ap} ${o.unit} of ${x.spec}. To buy more, the site should raise a new request for the extra.`);
          }
          const apOf = (sp) => its.find((i) => i.spec === sp);
          const place = (doc, g, extra) => {
            const gq = round3(sum(g.lines, 'qty')), gv = g.lines.reduce((s, x) => s + x.qty * x.rate, 0), amount = Math.round(g.amount * 100) / 100;
            doc.order = { vendor: g.vendor, qty: gq, rate: Math.round((gv / gq) * 100) / 100, amount, items: [...g.lines, ...(extra || [])], billNo: g.billNo, billDate: d.billDate || '', poNo: g.poNo, note: txt(d.note), by: u.username, at: now };
            doc.flags = { rateOver: doc.budgetRate ? g.lines.some((x) => x.rate > ((doc.budgetRates || {})[x.spec] || doc.budgetRate) * 1.0001) : false, amountMismatch: Math.abs(gv - amount) > Math.max(1, amount * 0.01) };
            doc.status = 'ordered';
            doc.history = [...(doc.history || []), { at: now, by: u.username, did: 'Ordered and bill entered', note: `${g.vendor}, ${g.lines.map((x) => `${x.spec} ${x.qty} ${o.unit} at ₹${x.rate}`).join('; ')}, bill ₹${amount}${g.poNo ? ', PO ' + g.poNo : ''}` }];
            doc.updatedAt = now; doc.updatedBy = u.username;
          };
          const docs = [], base = JSON.parse(JSON.stringify(o));
          const nos = groups.map((_, i) => (i ? `${o.no}-${String.fromCharCode(65 + i)}` : o.no));
          // the sizes not bought now (0) stay on the first order, as before
          // sizes not bought now (0) and any quantity short of the approval become the balance request
          const zero = [];
          groups.forEach((g, i) => {
            const specs = new Set(g.lines.map((x) => x.spec)), keepZero = i === 0 ? zero : [];
            const items = [...its.filter((x) => specs.has(x.spec)), ...keepZero.map((x) => apOf(x.spec))].filter(Boolean);
            const doc = i === 0 ? o : { ...JSON.parse(JSON.stringify(base)), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), no: nos[i], history: [...(base.history || []), { at: now, by: u.username, did: `Split from ${o.no}: ${g.vendor} supplies ${[...specs].join(', ')}` }] };
            doc.items = items; doc.spec = items.map((x) => x.spec).join(', '); doc.qty = round3(sum(items, 'qty'));
            place(doc, g, keepZero);
            docs.push(doc);
          });
          o.history.splice(o.history.length - 1, 0, { at: now, by: u.username, did: `Split by vendor into ${nos.join(', ')}` });
          for (const doc of docs) { const g = groups[docs.indexOf(doc)]; keepOrdered(doc, g.lines); }
          const bal = await balanceOf(snap, ol.filter((x) => x.qty > 0), u, now);
          for (const doc of docs) await kv.hset(KEY, doc.id, doc);
          if (bal) { await kv.hset(KEY, bal.id, bal); o.history.push({ at: now, by: u.username, did: `Balance to order later: ${bal.no}`, note: bal.items.map((x) => `${x.spec} ${x.qty} ${o.unit}`).join('; ') }); await kv.hset(KEY, o.id, o); }
          return res.status(200).json({ ok: true, doc: o, split: docs.map((x) => (MONEY_FREE(can) ? noMoney(x) : x)), balance: bal ? [bal] : undefined });
        }
        if (groups.length === 1) { d.vendor = groups[0].vendor; d.billNo = d.billNo || groups[0].billNo; d.poNo = d.poNo || groups[0].poNo; if (!(num(d.amount) > 0)) d.amount = String(Math.round(groups[0].amount * 100) / 100); }
      }
      const value = ol.reduce((s, x) => s + x.qty * (x.rate || 0), 0);
      // the bill comes later, with the material (Accounts enter it): without a bill amount the order value is kept
      const rate = Math.round((value / qty) * 100) / 100, amount = num(d.amount) > 0 ? num(d.amount) : Math.round(value * 100) / 100;
      const vendor = txt(d.vendor, 120), billNo = txt(d.billNo, 60);
      if (!vendor) return say(400, 'Enter the vendor.');
      // Purchase buys what Management approved: more than the approved quantity (beyond the small tolerance) needs a fresh request.
      if (!(o.approval && o.approval.ok)) return say(409, 'Management has not approved this request yet.');
      if (!can.approve) for (const x of ol) {
        const ap = +(its.find((i) => i.spec === x.spec) || {}).qty || 0;
        if (x.qty > ap * (1 + TOLERANCE)) return say(409, `Management approved ${ap} ${o.unit}${multi ? ' of ' + x.spec : ''}. To buy more, the site should raise a new request for the extra.`);
      }
      o.order = { vendor, qty, rate, amount, items: ol, billNo, billDate: d.billDate || '', poNo: txt(d.poNo, 60), note: txt(d.note), by: u.username, at: now };
      o.flags = { rateOver: o.budgetRate ? ol.some((x) => x.qty > 0 && x.rate > ((o.budgetRates || {})[x.spec] || o.budgetRate) * 1.0001) : false, amountMismatch: Math.abs(value - amount) > Math.max(1, amount * 0.01) };
      o.status = 'ordered';
      const detail = multi ? ol.filter((x) => x.qty > 0).map((x) => `${x.spec} ${x.qty} ${o.unit} at ₹${x.rate}`).join('; ') : `${qty} ${o.unit} at ₹${rate}`;
      log('Ordered and bill entered', `${vendor}, ${detail}, bill ₹${amount}`);
      const bal = await balanceOf(snap, ol.filter((x) => x.qty > 0), u, now);
      if (bal) {
        keepOrdered(o, ol.filter((x) => x.qty > 0));
        await kv.hset(KEY, bal.id, bal); extra.push(bal);
        log(`Balance to order later: ${bal.no}`, bal.items.map((x) => `${x.spec} ${x.qty} ${o.unit}`).join('; '));
      }
    } else if (op === 'receive') {
      if (!can.receive) return say(403, 'Only the site team can confirm what was received.');
      if (!need('ordered')) return say(409, 'This order is not waiting for delivery.');
      const multi = itemsOf(o).length > 1;
      const rl = lineInput(d, o, ['qty']);
      for (const x of rl) if (!(x.qty >= 0)) return say(400, multi ? `Enter the quantity received for ${x.spec} (0 if none).` : 'Enter the quantity received.');
      const qty = round3(sum(rl, 'qty'));
      const challan = txt(d.challan, 120);
      if (!challan) return say(400, 'Enter the delivery challan number(s).');
      if (!isDate(d.date)) return say(400, 'Enter the date received.');
      const photo = String(d.photo || '');
      if (photo && (!PHOTO.test(photo) || photo.length > 6e6)) return say(400, 'The challan photo did not come through. Take it again.');
      if (d.date > new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)) return say(400, 'The date received cannot be in the future.');
      if (photo) await kv.hset('po:photos', id, { data: photo, at: now, by: u.username });
      o.receipt = { qty, items: rl, challan, date: d.date, note: txt(d.note), by: u.username, at: now, photo: !!photo, read: d.read && typeof d.read === 'object' ? { challan: txt(d.read.challan, 60), vehicle: txt(d.read.vehicle, 30) } : undefined, vehicle: txt(d.vehicle, 30) || undefined };
      // The same delivery goes into the Construction page's materials log, so site stock is entered once.
      try {
        const day = (await kv.hget('site:materials', d.date)) || { date: d.date, items: {} };
        day.items = day.items || {};
        day.items['po' + id] = { type: 'in', material: SITE_MAT[o.material] || 'other', qty, unit: o.unit, spec: SITE_MAT[o.material] ? o.spec : `${o.material === 'Others' ? '' : o.material + ' '}${o.spec}`.trim(),
          tower: 'site', supplier: o.order.vendor, challan, po: o.no, by: u.username, at: now };
        day.updatedBy = u.username; day.updatedAt = now;
        await kv.hset('site:materials', d.date, day);
      } catch (e) { console.error('site materials from receipt', e.message); }
      const ordered = o.order.items || [{ spec: rl[0].spec, qty: o.order.qty }];
      const ordOf = (sp) => +(ordered.find((x) => x.spec === sp) || {}).qty || 0;
      o.flags = { ...(o.flags || {}), short: rl.some((x) => x.qty < ordOf(x.spec) * 0.995), excess: rl.some((x) => x.qty > ordOf(x.spec) * 1.005) };
      o.status = 'received';
      log('Received at site', `${multi ? rl.map((x) => `${x.spec} ${x.qty}`).join(', ') + ' ' + o.unit + ' (total ' + qty + ')' : qty + ' ' + o.unit}, challan ${challan}`);
    } else if (op === 'bill_check') {
      // the bill came with the material and the site signed it: Purchase checks it against the order, then hands it to Accounts
      if (!can.order) return say(403, 'Only the purchase team checks the bill against the order.');
      if (!need('received')) return say(409, 'This order is not waiting for its bill to be checked.');
      o.billCheck = { by: u.username, at: now, billNo: txt(d.billNo, 60), note: txt(d.note) };
      o.status = 'with_accounts';
      log('Bill checked against the order, handed to Accounts', [o.billCheck.billNo && 'bill ' + o.billCheck.billNo, o.billCheck.note].filter(Boolean).join(', '));
    } else if (op === 'bill_enter') {
      // Accounts enter the bill: vendor, PO no., bill no. and date, amount; Management is asked to approve it for payment
      if (!can.accounts) return say(403, 'Only Accounts enter the bill.');
      if (!need('with_accounts')) return say(409, 'This bill is not with Accounts.');
      const amount = num(d.amount), gst = d.gst === '' || d.gst == null ? null : num(d.gst);
      const vendor = txt(d.vendor, 120) || (o.order && o.order.vendor) || '', billNo = txt(d.billNo, 60), poNo = txt(d.poNo, 60) || (o.order && o.order.poNo) || '';
      if (!vendor) return say(400, 'Enter the vendor.');
      if (!billNo) return say(400, 'Enter the bill number.');
      if (!isDate(d.billDate)) return say(400, 'Enter the bill date.');
      if (!(amount > 0)) return say(400, 'Enter the bill amount, including GST.');
      if (gst != null && !(gst >= 0 && gst < amount)) return say(400, 'The GST must be less than the bill amount.');
      // the scan of the signed bill (24 Nov 2026: Accounts scan the bill and send it for approval): a photo or a PDF
      const scan = String(d.scan || '');
      const hadScan = !!(o.bill && o.bill.scan);
      if (scan && (!(PHOTO.test(scan) || /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(scan)) || scan.length > 6e6)) return say(400, 'The scan of the bill did not come through, or is over 4 MB. Scan it again.');
      if (!scan && !hadScan) return say(400, 'Attach the scan (photo or PDF) of the signed bill.');
      if (scan) await kv.hset('po:photos', id + 'bill', { data: scan, at: now, by: u.username });
      const orderValue = (o.order && o.order.items ? o.order.items : []).reduce((a, x) => a + (+x.qty || 0) * (+x.rate || 0), 0) || (o.order && o.order.amount) || 0;
      // the delivered quantity at the order's rate: a bill above it (beyond 1%) is flagged for Management
      const rcv = o.receipt && o.receipt.qty, rate = o.order && o.order.rate;
      const expect = rcv && rate ? Math.round(rcv * rate * 100) / 100 : orderValue;
      o.bill = { vendor, poNo, billNo, billDate: d.billDate, amount, gst, note: txt(d.note), by: u.username, at: now, expect, over: expect ? amount > expect * 1.01 : false, scan: scan ? (/^data:application\/pdf/.test(scan) ? 'pdf' : 'image') : o.bill.scan };
      o.hold = null;
      o.status = 'bill_approval';
      log('Bill entered by Accounts, sent to Management for approval', `${vendor}, bill ${billNo} of ${d.billDate}, ₹${amount}${poNo ? ', PO ' + poNo : ''}${o.bill.over ? ` (above ₹${Math.round(expect)} for what was delivered)` : ''}`);
      extra.notifyBill = true;
    } else if (op === 'bill_ok' || op === 'bill_back') {
      if (!can.approve) return say(403, 'Only Management approves bills for payment.');
      const e = decideBill(o, u, op === 'bill_ok', d.note);
      if (e) return say(400, e);
    } else if (op === 'accounts_ok' || op === 'hold') {
      if (!can.accounts) return say(403, 'Only Accounts can approve bills for payment.');
      // bills now go to Management for approval (bill_enter); "hold" stays for a bill Accounts cannot enter yet
      if (op === 'accounts_ok') return say(409, 'Enter the bill (vendor, bill no., date and amount): it then goes to Management for approval.');
      if (!need('with_accounts')) return say(409, 'This bill is not with Accounts.');
      const note = txt(d.note);
      if (op === 'hold') {
        if (!note) return say(400, 'Say why the bill is on hold.');
        o.hold = { by: u.username, at: now, note };
        log('Put on hold by Accounts', note);
      } else {
        o.hold = null;
        o.accounts = { by: u.username, at: now, note, payable: num(d.payable) > 0 ? num(d.payable) : o.order.amount };
        o.status = 'accounts_ok';
        log('Approved for payment', note);
      }
    } else if (op === 'paid') {
      // A bill is marked Paid only by its Payments Out row, so every payment is in the books (lib/accounts.js billToPay).
      return say(400, 'Pay this bill from Accounts → Payments Out: add a row and choose this bill under "Paying an approved purchase bill?". Saving the payment marks it Paid here.');
    } else if (op === 'delete') {
      // Admin only: removes a request entirely (for clearing test entries before go-live).
      if (u.role !== 'admin') return say(403, 'Only the Admin can delete a request.');
      await kv.hdel(KEY, id);
      return res.status(200).json({ ok: true, deleted: id });
    } else if (op === 'rest') {
      // "Order the rest": an order placed for less than Management approved (PR-0065: 6 of 18 m³, 24 Nov 2026) leaves
      // the remainder as its own approved request, to be ordered from any vendor (or split between vendors)
      if (!can.order) return say(403, 'Only the purchase team can order the rest.');
      if (!o.order || !(o.approval && o.approval.ok)) return say(409, 'This request has no order yet.');
      if (o.restNo) return say(409, `The rest is already ${o.restNo}.`);
      const ordered = (o.order.items && o.order.items.length ? o.order.items : [{ spec: o.spec, qty: o.order.qty }]).filter((x) => +x.qty > 0);
      const bal = await balanceOf(o, ordered, u, now);
      if (!bal) return say(409, 'Everything approved has been ordered.');
      await kv.hset(KEY, bal.id, bal); extra.push(bal);
      o.restNo = bal.no;
      keepOrdered(o, ordered);
      log(`Rest to order: ${bal.no}`, bal.items.map((x) => `${x.spec} ${x.qty} ${o.unit}`).join('; '));
    } else if (op === 'cancel') {
      const mine = o.requestedBy === u.username;
      if (!(can.cancelAny || (mine && can.request))) return say(403, 'Only the person who raised it, or Management, can cancel a request.');
      if (!['pending_approval', 'requested'].includes(o.status)) return say(409, 'Only requests not yet ordered can be cancelled.');
      o.status = 'cancelled';
      log('Cancelled', txt(d.note));
    } else return say(400, 'Unknown action.');

    o.updatedAt = now; o.updatedBy = u.username;
    await kv.hset(KEY, id, o);
    // a bill entered by Accounts: Management is asked to approve it (WhatsApp, email, DreamComm) with a one-tap link
    if (extra.notifyBill) { try { await require('../staff-alerts').notifyBill(o); } catch (e) { console.error('bill approval notice', e.message); } }
    res.status(200).json({ ok: true, doc: MONEY_FREE(can) ? noMoney(o) : o, balance: extra.length ? extra.map((x) => (MONEY_FREE(can) ? noMoney(x) : x)) : undefined });
  } catch (e) {
    // only a lost or refused database connection is "not reachable"; anything else is a fault to be looked at
    const down = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'NO_DB', '57P01', '57P02', '57P03'].includes(e && e.code)
      || /^08/.test(String((e && e.code) || '')) || /connection (closed|terminated)|database server/i.test(String((e && e.message) || ''));
    console.error('purchase', e);
    if (res.headersSent) return;
    if (down) return res.status(503).json({ error: 'The purchase database is not reachable. Try again in a moment.' });
    res.status(e && e.status >= 400 && e.status < 500 ? e.status : 500).json({ error: e && e.status >= 400 && e.status < 500 ? e.message : 'Something went wrong while saving this. Check the request and try again, or tell the Admin if it keeps happening.' });
  }
};
module.exports.STEPS = STEPS;

// ---------- one-tap approval link ----------
async function orderSummary(o, people) {
  const its = itemsOf(o);
  return { id: o.id, no: o.no, status: o.status, material: o.material, spec: o.spec, unit: o.unit, qty: o.qty, items: its, building: o.building, floor: o.floor, wing: o.wing, element: o.element,
    neededBy: o.neededBy, note: o.note, requestedBy: people[o.requestedBy] || o.requestedBy, requestedAt: o.requestedAt, budget: o.budgetAtRequest || null,
    approxValue: o.budgetRate ? Math.round(o.qty * o.budgetRate) : null, approval: o.approval ? { ok: o.approval.ok, by: people[o.approval.by] || o.approval.by, at: o.approval.at, note: o.approval.note } : null,
    // a bill waiting for (or decided by) Management
    bill: o.bill ? { ...o.bill, by: people[o.bill.by] || o.bill.by } : null, receipt: o.receipt ? { qty: o.receipt.qty, challan: o.receipt.challan, date: o.receipt.date } : null,
    order: o.order ? { vendor: o.order.vendor, qty: o.order.qty, rate: o.order.rate, poNo: o.order.poNo } : null,
    billApproval: o.billApproval ? { ok: o.billApproval.ok, by: people[o.billApproval.by] || o.billApproval.by, at: o.billApproval.at, note: o.billApproval.note } : null };
}
// the scanned bill, for the approver holding the signed link (no login on the phone)
async function linkScan(req, res, t) {
  const tk = await require('../staff-alerts').checkToken(t);
  if (!tk) return res.status(410).json({ error: 'This link has expired.' });
  const ph = await kv.hget('po:photos', tk.id + 'bill');
  const m = ph && String(ph.data || '').match(/^data:(image\/[a-z]+|application\/pdf);base64,(.*)$/);
  if (!m) return res.status(404).json({ error: 'No scan of the bill.' });
  res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'private, no-store');
  return res.end(Buffer.from(m[2], 'base64'));
}
async function linkView(req, res, t) {
  const sa = require('../staff-alerts');
  const tk = await sa.checkToken(t);
  if (!tk) return res.status(410).json({ error: 'This approval link has expired or is not valid. Open the Purchase page in the ERP instead.' });
  const [orders, users] = await kv.hgetallMany([KEY, 'users']);
  const o = orders[tk.id]; if (!o) return res.status(404).json({ error: 'That request no longer exists.' });
  tidy(o);
  const people = {}; for (const x of Object.values(users)) people[x.username] = x.name || x.username;
  return res.status(200).json({ ok: true, approver: people[tk.user] || tk.user, order: await orderSummary(o, people) });
}
async function linkDecide(req, res, b) {
  if (!require('./http').sameOrigin(req)) return res.status(403).json({ error: 'Request not allowed.' });
  const sa = require('../staff-alerts');
  const tk = await sa.checkToken(b.t);
  if (!tk) return res.status(410).json({ error: 'This approval link has expired or is not valid. Open the Purchase page in the ERP instead.' });
  const r = await decideById(tk.id, tk.user, !!b.ok, b.note, 'from the approval link');
  return res.status(r.error ? r.code || 400 : 200).json(r);
}
// Used by the link and by a WhatsApp reply: the approver's login must still be active and allowed to approve.
async function decideById(id, username, ok, note, via) {
  const u = await kv.hget('users', username);
  if (!u || u.disabled || !auth.ROLES[u.role]) return { error: 'This login is no longer active.', code: 403 };
  const orders = await kv.hgetall(KEY), o = orders[id];
  if (!o) return { error: 'That request no longer exists.', code: 404 };
  tidy(o);
  const e = decide(o, u, ok, note, via);
  if (e) return { error: e, code: 409, state: o.status };
  await kv.hset(KEY, id, o);
  return { ok: true, no: o.no, state: o.status };
}
module.exports.decideById = decideById;
module.exports.itemsOf = itemsOf;
module.exports.tidy = tidy;
module.exports.KEY = KEY;
