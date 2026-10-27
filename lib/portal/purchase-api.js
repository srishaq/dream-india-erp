// Purchase requests for Dream Signature, Phase 1: RMC, steel and cement against the floor-wise budget.
// Flow: Site requests -> Management (Sameer) approves every request before anything is bought -> Purchase
// places the order and enters the bill -> Site confirms the quantity received -> Accounts approve the bill -> Accounts
// mark it paid. Served from /api/me?purchase=1 (Vercel Hobby allows 12 functions per deployment).
const auth = require('./auth');
const kv = require('./kv');
const { body, noStore } = require('./http');
const BUDGET = require('./purchase-budget.json');

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
const WINGS = { Sale: ['A wing', 'B wing', 'Both wings / common'], Rehab: ['Rehab'], Project: ['—', 'Sale side', 'Rehab side', 'Whole site'] };
// Requests saved before "Whole project" was renamed "Project" keep working.
const fixLine = (k) => String(k || '').replace(/^Whole project\|/, 'Project|');
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
const budgetRate = (line, m) => (m === 'RMC' ? line.rmcRate : m === 'Steel' ? BUDGET.steelRate : m === 'Cement' ? line.cementRate || BUDGET.cement.rate : null);

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
  if (o.building === 'Whole project') o.building = 'Project';
  if (o.status === 'requested' && !o.approval) o.status = 'pending_approval';
}

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
const txt = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// One request can carry several sizes or grades (e.g. steel 8, 12 and 16 mm), each with its own quantity.
// Requests saved before this have a single spec and qty, which reads as one line.
const itemsOf = (o) => (Array.isArray(o.items) && o.items.length ? o.items : [{ spec: o.spec, qty: o.qty }]);
const sum = (a, k) => a.reduce((s, x) => s + (+x[k] || 0), 0);
const round3 = (n) => Math.round(n * 1000) / 1000;
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
  const u = await auth.guard(req, res, 'purchase');
  if (!u) return;
  const can = caps(u);
  try {
    if (req.method === 'GET') {
      const [orders, users] = await kv.hgetallMany([KEY, 'users']);
      for (const o of Object.values(orders)) tidy(o);
      const people = {};
      for (const x of Object.values(users)) people[x.username] = x.name || x.username;
      return res.status(200).json({
        me: auth.publicUser(u), can, people, orders, materials: MATERIALS, wings: WINGS, tolerance: TOLERANCE,
        budget: { version: BUDGET.version, source: BUDGET.source, steelRate: BUDGET.steelRate, trackers: BUDGET.trackers, lines: LINES },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
    const b = body(req);
    const op = b.op, d = b.data && typeof b.data === 'object' ? b.data : {};
    const now = new Date().toISOString();
    const orders = await kv.hgetall(KEY);
    for (const o of Object.values(orders)) tidy(o);
    const say = (code, error) => res.status(code).json({ error });

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
      // Numbers never repeat, even after a test entry is deleted.
      const top = Math.max(0, ...Object.values(orders).map((x) => +String(x.no || '').replace(/\D/g, '') || 0));
      const seq = Math.max(top, +(await kv.hget('po:meta', 'seq')) || 0) + 1;
      await kv.hset('po:meta', 'seq', seq);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const doc = {
        id, no: `PR-${String(seq).padStart(4, '0')}`, material, spec, unit, qty, items, line,
        building: LINE[line].building, floor: LINE[line].floor, wing, element: txt(d.element, 120), neededBy: d.neededBy || '', note: txt(d.note),
        // Every request waits for Management's approval before Purchase can order it.
        status: 'pending_approval', budgetAtRequest: chk, budgetRate: budgetRate(LINE[line], material),
        requestedBy: u.username, requestedAt: now, history: [{ at: now, by: u.username, did: chk.over ? 'Requested (over budget), sent to Management for approval' : 'Requested, sent to Management for approval' }],
      };
      await kv.hset(KEY, id, doc);
      return res.status(200).json({ ok: true, doc });
    }

    const id = String(b.id || '');
    if (!ID.test(id) || !orders[id]) return say(404, 'That request no longer exists.');
    const o = orders[id];
    const log = (did, note) => { o.history = [...(o.history || []), { at: now, by: u.username, did, note: note || undefined }]; };
    const need = (st) => o.status === st;

    if (op === 'approve' || op === 'reject') {
      if (!can.approve) return say(403, 'Only Management can approve purchase requests.');
      if (!need('pending_approval')) return say(409, 'This request is not waiting for approval.');
      const note = txt(d.note);
      if (op === 'reject' && !note) return say(400, 'Give a reason for rejecting.');
      o.approval = { ok: op === 'approve', by: u.username, at: now, note, overBudget: !!(o.budgetAtRequest && o.budgetAtRequest.over) };
      o.status = op === 'approve' ? 'requested' : 'rejected';
      log(op === 'approve' ? (o.approval.overBudget ? 'Approved by Management (over budget)' : 'Approved by Management') : 'Rejected by Management', note);
    } else if (op === 'order') {
      if (!can.order) return say(403, 'Only the purchase team can place the order.');
      if (!need('requested')) return say(409, 'This request is not waiting for an order.');
      const its = itemsOf(o), multi = its.length > 1;
      const ol = lineInput(d, o, ['qty', 'rate']);
      for (const x of ol) {
        if (!(x.qty >= 0) || (!multi && !(x.qty > 0))) return say(400, multi ? `Enter the quantity ordered for ${x.spec} (0 if not ordered).` : 'Enter the quantity ordered.');
        if (x.qty > 0 && !(x.rate > 0)) return say(400, multi ? `Enter the rate per ${o.unit} for ${x.spec}, including GST.` : `Enter the rate per ${o.unit}, including GST.`);
      }
      const qty = round3(sum(ol, 'qty'));
      if (!(qty > 0)) return say(400, 'Enter the quantity ordered.');
      const value = ol.reduce((s, x) => s + x.qty * (x.rate || 0), 0);
      const rate = Math.round((value / qty) * 100) / 100, amount = num(d.amount);
      if (!(amount > 0)) return say(400, 'Enter the bill amount, including GST.');
      const vendor = txt(d.vendor, 120), billNo = txt(d.billNo, 60);
      if (!vendor) return say(400, 'Enter the vendor.');
      if (d.billDate && !isDate(d.billDate)) return say(400, 'Enter the bill date as a date.');
      // Purchase buys what Management approved: more than the approved quantity (beyond the small tolerance) needs a fresh request.
      if (!(o.approval && o.approval.ok)) return say(409, 'Management has not approved this request yet.');
      if (!can.approve) for (const x of ol) {
        const ap = +(its.find((i) => i.spec === x.spec) || {}).qty || 0;
        if (x.qty > ap * (1 + TOLERANCE)) return say(409, `Management approved ${ap} ${o.unit}${multi ? ' of ' + x.spec : ''}. To buy more, the site should raise a new request for the extra.`);
      }
      o.order = { vendor, qty, rate, amount, items: ol, billNo, billDate: d.billDate || '', poNo: txt(d.poNo, 60), note: txt(d.note), by: u.username, at: now };
      o.flags = { rateOver: o.budgetRate ? ol.some((x) => x.qty > 0 && x.rate > o.budgetRate * 1.0001) : false, amountMismatch: Math.abs(value - amount) > Math.max(1, amount * 0.01) };
      o.status = 'ordered';
      const detail = multi ? ol.filter((x) => x.qty > 0).map((x) => `${x.spec} ${x.qty} ${o.unit} at ₹${x.rate}`).join('; ') : `${qty} ${o.unit} at ₹${rate}`;
      log('Ordered and bill entered', `${vendor}, ${detail}, bill ₹${amount}`);
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
      o.receipt = { qty, items: rl, challan, date: d.date, note: txt(d.note), by: u.username, at: now };
      const ordered = o.order.items || [{ spec: rl[0].spec, qty: o.order.qty }];
      const ordOf = (sp) => +(ordered.find((x) => x.spec === sp) || {}).qty || 0;
      o.flags = { ...(o.flags || {}), short: rl.some((x) => x.qty < ordOf(x.spec) * 0.995), excess: rl.some((x) => x.qty > ordOf(x.spec) * 1.005) };
      o.status = 'received';
      log('Received at site', `${multi ? rl.map((x) => `${x.spec} ${x.qty}`).join(', ') + ' ' + o.unit + ' (total ' + qty + ')' : qty + ' ' + o.unit}, challan ${challan}`);
    } else if (op === 'accounts_ok' || op === 'hold') {
      if (!can.accounts) return say(403, 'Only Accounts can approve bills for payment.');
      if (!need('received')) return say(409, 'This bill is not waiting for Accounts.');
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
      if (!can.accounts) return say(403, 'Only Accounts can record a payment.');
      if (!need('accounts_ok')) return say(409, 'This bill is not approved for payment yet.');
      const amount = num(d.amount), ref = txt(d.ref, 80);
      if (!(amount > 0)) return say(400, 'Enter the amount paid.');
      if (!ref) return say(400, 'Enter the payment reference (UTR or cheque number).');
      if (!isDate(d.date)) return say(400, 'Enter the payment date.');
      o.payment = { amount, ref, date: d.date, by: u.username, at: now };
      o.status = 'paid';
      log('Paid', `₹${amount}, ${ref}`);
    } else if (op === 'delete') {
      // Admin only: removes a request entirely (for clearing test entries before go-live).
      if (u.role !== 'admin') return say(403, 'Only the Admin can delete a request.');
      await kv.hdel(KEY, id);
      return res.status(200).json({ ok: true, deleted: id });
    } else if (op === 'cancel') {
      const mine = o.requestedBy === u.username;
      if (!(can.cancelAny || (mine && can.request))) return say(403, 'Only the person who raised it, or Management, can cancel a request.');
      if (!['pending_approval', 'requested'].includes(o.status)) return say(409, 'Only requests not yet ordered can be cancelled.');
      o.status = 'cancelled';
      log('Cancelled', txt(d.note));
    } else return say(400, 'Unknown action.');

    o.updatedAt = now; o.updatedBy = u.username;
    await kv.hset(KEY, id, o);
    res.status(200).json({ ok: true, doc: o });
  } catch (e) {
    res.status(503).json({ error: 'The purchase database is not reachable. Try again in a moment.' });
  }
};
module.exports.STEPS = STEPS;
