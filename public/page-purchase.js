const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => n == null || n === '' ? '' : '₹' + Math.round(+n).toLocaleString('en-IN');
const q = (n, d = 1) => n == null || n === '' || isNaN(n) ? '–' : (+n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const day = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const when = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const LABEL = { pending_approval: 'Waiting for Management approval', requested: 'To order', ordered: 'Ordered, awaiting delivery', received: 'Received, bill with Accounts', accounts_ok: 'Approved, to pay', paid: 'Paid', rejected: 'Rejected', cancelled: 'Cancelled' };
const OPEN = ['pending_approval', 'requested', 'ordered', 'received', 'accounts_ok'];
let D = null, tab = 'list', tileFilter = null;

async function api(method, payload) {
  const r = await fetch('/api/me?purchase=1', { method, headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}
const who = (u) => esc(D.people[u] || u || '');
// Which open requests are waiting for this login, by status.
function waitingFor(o) {
  const c = D.can;
  return (o.status === 'pending_approval' && c.approve) || (o.status === 'requested' && c.order) || (o.status === 'ordered' && c.receive) || ((o.status === 'received' || o.status === 'accounts_ok') && c.accounts);
}
function flags(o) {
  const f = o.flags || {}, out = [];
  if (o.budgetAtRequest && o.budgetAtRequest.over) out.push('Over budget');
  if (f.rateOver) out.push('Rate above budget');
  if (f.amountMismatch) out.push('Bill ≠ qty × rate');
  if (f.short) out.push('Short delivery');
  if (f.excess) out.push('Excess delivery');
  if (o.hold && o.status === 'received') out.push('On hold');
  return out.map((x) => `<span class="flag">${x}</span>`).join('');
}
const shownQty = (o) => o.receipt ? o.receipt.qty : o.order ? o.order.qty : o.qty;
// Requests can carry several sizes or grades; older ones have one spec and qty.
const itemsOf = (o) => (o.items && o.items.length ? o.items : [{ spec: o.spec, qty: o.qty }]);
const multi = (o) => itemsOf(o).length > 1;
const num = (v) => +String(v ?? '').replace(/,/g, '') || 0;
// Size-by-size table: requested, ordered (with rate) and received for each line.
function itemTable(o) {
  if (!multi(o)) return '';
  const ord = (o.order && o.order.items) || [], rec = (o.receipt && o.receipt.items) || [], f = (a, sp) => a.find((x) => x.spec === sp);
  const head = `<th>${o.material === 'Steel' ? 'Bar size' : 'Grade / type'}</th><th class="n">Requested</th>${o.order ? '<th class="n">Ordered</th><th class="n">Rate ₹</th>' : ''}${o.receipt ? '<th class="n">Received</th>' : ''}`;
  const rows = itemsOf(o).map((it) => { const a = f(ord, it.spec) || {}, r = f(rec, it.spec) || {}; return `<tr><td><b>${esc(it.spec)}</b></td><td class="n">${q(it.qty, 3)}</td>${o.order ? `<td class="n">${q(a.qty, 3)}</td><td class="n">${a.rate ? inr(a.rate) : '–'}</td>` : ''}${o.receipt ? `<td class="n">${q(r.qty, 3)}</td>` : ''}</tr>`; }).join('');
  const tot = `<tr><td><b>Total ${esc(o.unit)}</b></td><td class="n"><b>${q(o.qty, 3)}</b></td>${o.order ? `<td class="n"><b>${q(o.order.qty, 3)}</b></td><td></td>` : ''}${o.receipt ? `<td class="n"><b>${q(o.receipt.qty, 3)}</b></td>` : ''}</tr>`;
  return `<div class="tbl"><table class="itbl"><thead><tr>${head}</tr></thead><tbody>${rows}${tot}</tbody></table></div>`;
}
// Value of what was received at each line's ordered rate.
function receivedValue(o) {
  if (!o.receipt) return 0;
  if (!(o.order.items && o.receipt.items)) return o.receipt.qty * o.order.rate;
  return o.receipt.items.reduce((s, r) => s + r.qty * ((o.order.items.find((x) => x.spec === r.spec) || {}).rate || 0), 0);
}

function renderTiles() {
  const c = D.can, os = Object.values(D.orders), n = (st) => os.filter((o) => o.status === st).length;
  const T = [];
  if (c.approve) T.push(['pending_approval', 'To approve']);
  if (c.order) T.push(['requested', 'To order']);
  if (c.receive) T.push(['ordered', 'Awaiting delivery']);
  if (c.accounts) { T.push(['received', 'Bills to approve']); T.push(['accounts_ok', 'Approved, to pay']); }
  if (!T.length) T.push(['pending_approval', 'With Management'], ['requested', 'To order'], ['ordered', 'Awaiting delivery'], ['received', 'With Accounts']);
  $('#tiles').innerHTML = T.map(([st, l]) => `<button class="tile ${n(st) ? 'hot' : ''}" data-st="${st}" aria-pressed="${tileFilter === st}"><b>${n(st)}</b><span>${l}</span></button>`).join('');
}
function renderList() {
  const st = $('#fStatus').value, m = $('#fMat').value, b = $('#fBld').value, qq = $('#fQ').value.trim().toLowerCase();
  let os = Object.values(D.orders).sort((a, b2) => (b2.requestedAt || '').localeCompare(a.requestedAt || ''));
  os = os.filter((o) => {
    if (tileFilter) { if (o.status !== tileFilter) return false; }
    else if (st === 'open' && !OPEN.includes(o.status)) return false;
    else if (st === 'mine' && !waitingFor(o)) return false;
    else if (st === 'paid' && o.status !== 'paid') return false;
    else if (st === 'closed' && !['rejected', 'cancelled'].includes(o.status)) return false;
    if (m && o.material !== m) return false;
    if (b && o.building !== b) return false;
    if (qq && ![o.no, o.floor, o.element, o.order?.vendor, o.order?.billNo, o.receipt?.challan, o.spec].join(' ').toLowerCase().includes(qq)) return false;
    return true;
  });
  $('#rows').innerHTML = os.length ? os.map((o) => `<tr class="click" data-id="${o.id}" tabindex="0">
    <td><b>${esc(o.no)}</b><br><span class="note">${day(o.requestedAt)} · ${who(o.requestedBy)}</span></td>
    <td>${esc(o.material)} ${esc(o.spec)}</td>
    <td class="n">${q(shownQty(o), 2)} ${esc(o.unit)}</td>
    <td>${esc(o.building)}${o.wing && o.wing !== '—' && o.wing !== 'Rehab' ? ' · ' + esc(o.wing) : ''}<br><span class="note">${esc(o.floor)}${o.element ? ' · ' + esc(o.element) : ''}</span></td>
    <td><span class="st ${o.status}">${LABEL[o.status] || o.status}</span><br>${flags(o)}</td>
    <td class="n">${o.order ? inr(o.order.amount) : ''}</td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">${Object.keys(D.orders).length ? 'No requests match these filters.' : D.can.request ? 'No purchase requests yet. Use New request to raise the first one.' : 'No purchase requests yet. The site team raises them here.'}</td></tr>`;
}
function usedOf(line, mat) {
  let u = (line.opening && +line.opening[mat === 'RMC' ? 'rmc' : 'steel']) || 0;
  for (const o of Object.values(D.orders)) if (o.line === line.key && o.material === mat && !['rejected', 'cancelled'].includes(o.status)) u += +shownQty(o) || 0;
  return u;
}
function cell(budget, used) {
  if (budget == null) return '<td class="n">–</td><td class="n">–</td><td class="n">–</td><td></td>';
  const bal = budget - used, pct = budget ? Math.min(100, (used / budget) * 100) : 0;
  const cls = bal < 0 ? 'neg' : budget && bal / budget < 0.1 && used > 0 ? 'low' : '';
  return `<td class="n">${q(budget)}</td><td class="n">${q(used)}</td><td class="n ${cls}">${q(bal)}</td><td><div class="bar2"><i class="${bal < 0 ? 'o' : ''}" style="width:${pct}%"></i></div></td>`;
}
function renderBudget() {
  const b = $('#bBld').value;
  const ls = D.budget.lines.filter((l) => l.building === b);
  $('#brows').innerHTML = ls.map((l) => {
    if (l.cement != null) {
      let used = 0; for (const o of Object.values(D.orders)) if (o.line === l.key && !['rejected', 'cancelled'].includes(o.status)) used += +shownQty(o) || 0;
      return `<tr><td><b>${esc(l.floor)}</b><br><span class="note">Cement, bags</span></td>${cell(l.cement, used)}<td colspan="4"></td></tr>`;
    }
    if (l.rmc == null && l.steel == null) return `<tr><td><b>${esc(l.floor)}</b></td><td colspan="8" class="note">No budget. Requests here are tracked but not checked.</td></tr>`;
    return `<tr><td><b>${esc(l.floor)}</b>${l.opening ? `<br><span class="note">${esc(l.opening.note)}</span>` : ''}</td>${cell(l.rmc, usedOf(l, 'RMC'))}${cell(l.steel, usedOf(l, 'Steel'))}</tr>`;
  }).join('');
  $('#bSrc').textContent = `Budget: ${D.budget.source}. Used = delivered before the portal (where shown) plus every open or completed request on the portal.`;
  $('#bFoot').textContent = `Delivered before the portal, from the site trackers (${D.budget.trackers.asOf}): steel ${q(D.budget.trackers.steel, 2)} MT, RMC ${q(D.budget.trackers.rmc, 0)} m³. Sale A wing / B wing split is pending from the structural consultant, so Sale budgets are per floor for both wings together.`;
}
function render() {
  renderTiles();
  $('#listView').hidden = tab !== 'list'; $('#budgetView').hidden = tab !== 'budget';
  $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === tab));
  if (tab === 'list') renderList(); else renderBudget();
}

// ---------- dialogs ----------
function open(html) { $('#sheet').innerHTML = html; $('#scrim').hidden = false; const f = $('#sheet input, #sheet select, #sheet textarea'); if (f) f.focus(); }
function close() { $('#scrim').hidden = true; $('#sheet').innerHTML = ''; }
$('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim' || e.target.closest('[data-close]')) close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#scrim').hidden) close(); });
const val = (name) => { const el = $(`#sheet [name="${name}"]`); return el ? el.value : ''; };
async function act(payload, okMsg) {
  const err = $('#sheet .box .err') || $$('#sheet .err').pop(), btns = $$('#sheet button');
  btns.forEach((b) => (b.disabled = true)); if (err) err.textContent = '';
  try {
    const r = await api('POST', payload);
    D.orders[r.doc.id] = r.doc; render(); showOrder(r.doc.id, okMsg);
  } catch (e) { if (err) err.textContent = e.message; btns.forEach((b) => (b.disabled = false)); }
}

function lineOptions(building) {
  return D.budget.lines.filter((l) => l.building === building).map((l) => `<option value="${esc(l.key)}">${esc(l.floor)}</option>`).join('');
}
function newRequest() {
  const mats = Object.keys(D.materials);
  open(`<div class="top"><h3>New purchase request</h3><button class="x" data-close aria-label="Close">×</button></div>
  <div class="form">
    <label class="field">Material<select name="material">${mats.map((m) => `<option>${m}</option>`).join('')}</select></label>
    <label class="field" id="unitF" hidden>Unit<select name="unit"></select></label>
    <label class="field wide" id="specTF" hidden>Item<input name="specText" placeholder="e.g. shuttering plywood 12 mm" autocomplete="off"></label>
    <div class="wide items" id="items"></div>
    <label class="field">Needed by<input name="neededBy" type="date" value="${today()}"></label>
    <label class="field">Building<select name="building"><option>Sale</option><option>Rehab</option><option>Project</option></select></label>
    <label class="field">Floor<select name="line"></select></label>
    <label class="field">Wing<select name="wing"></select></label>
    <label class="field">Element / location<input name="element" placeholder="e.g. columns and shear walls" autocomplete="off"></label>
    <label class="field wide">Note for Purchase<textarea name="note" placeholder="Pour time, pump needed, preferred vendor…"></textarea></label>
  </div>
  <div class="chk" id="chk">Choose the floor and quantity to see the budget balance.</div>
  <p class="err"></p>
  <div class="acts"><button class="btn" data-close>Cancel</button><button class="btn go" id="send">Send for approval</button></div>`);
  // One row per size or grade; "Add another" lets steel 8, 12 and 16 mm go in one request.
  const specLabel = (m) => m === 'RMC' ? 'Grade' : m === 'Steel' ? 'Bar size' : m === 'Excavation' ? 'Type of work' : m === 'Others' ? 'Item' : 'Type';
  const addWord = (m) => m === 'RMC' ? 'grade' : m === 'Steel' ? 'bar size' : m === 'Excavation' ? 'type of work' : 'type';
  const unitNow = () => { const M = D.materials[val('material')]; return M.units ? val('unit') : M.unit; };
  const itemRow = (M, m, pick) => `<div class="irow">${M.specs ? `<label class="field">${specLabel(m)}<select data-k="spec">${M.specs.map((x) => `<option${x === pick ? ' selected' : ''}>${x}</option>`).join('')}</select></label>` : '<span></span>'}<label class="field"><span data-ql>Quantity (${esc(unitNow())})</span><input data-k="qty" inputmode="decimal" autocomplete="off"></label><button type="button" class="x" data-rm aria-label="Remove this line" title="Remove this line">×</button></div>`;
  const rowsBox = () => $('#items');
  const drawRows = (m) => {
    const M = D.materials[m];
    rowsBox().innerHTML = itemRow(M, m) + (M.specs ? `<button type="button" class="addrow" id="addRow">+ Add another ${addWord(m)}</button>` : '');
    tidyRows();
  };
  const tidyRows = () => { const rs = $$('#items .irow'); rs.forEach((r) => { r.querySelector('[data-rm]').style.visibility = rs.length > 1 ? 'visible' : 'hidden'; }); };
  const readItems = () => $$('#items .irow').map((r) => ({ spec: r.querySelector('[data-k=spec]')?.value, qty: r.querySelector('[data-k=qty]').value }));
  // Listeners go on this dialog's own form, so they end when the dialog closes and never stack.
  const form = $('#sheet .form');
  form.addEventListener('click', (e) => {
    if (e.target.id === 'addRow') {
      const m = val('material'), M = D.materials[m], used = readItems().map((x) => x.spec), next = M.specs.find((x) => !used.includes(x)) || M.specs[0];
      e.target.insertAdjacentHTML('beforebegin', itemRow(M, m, next)); tidyRows(); $$('#items .irow').pop().querySelector('[data-k=qty]').focus(); sync();
    } else if (e.target.closest('[data-rm]')) { e.target.closest('.irow').remove(); tidyRows(); sync(); }
  });
  const sync = () => {
    const m = val('material'), M = D.materials[m];
    const us = $('#sheet [name=unit]');
    if (rowsBox().dataset.m !== m) {
      rowsBox().dataset.m = m;
      $('#specTF').hidden = !!M.specs;
      $('#unitF').hidden = !M.units; us.innerHTML = (M.units || []).map((x) => `<option>${x}</option>`).join('');
      drawRows(m);
    }
    $$('#items [data-ql]').forEach((x) => (x.textContent = `Quantity (${unitNow()})`));
    const b = val('building'), ls = $('#sheet [name=line]');
    if (ls.dataset.b !== b) {
      let opts = lineOptions(b);
      if (b === 'Project') opts = D.budget.lines.filter((l) => l.building === b).map((l) => `<option value="${esc(l.key)}">${esc(l.floor)}</option>`).join('');
      ls.innerHTML = opts; ls.dataset.b = b;
      $('#sheet [name=wing]').innerHTML = (D.wings[b] || []).map((w) => `<option>${w}</option>`).join('');
    }
    if (m === 'Cement' && b === 'Project' && ls.dataset.auto !== m) { ls.value = 'Project|Cement'; ls.dataset.auto = m; }
    const line = D.budget.lines.find((l) => l.key === ls.value), qty = readItems().reduce((s, x) => s + num(x.qty), 0);
    const f = m === 'RMC' ? 'rmc' : m === 'Steel' ? 'steel' : m === 'Cement' ? 'cement' : null, chk = $('#chk');
    if (!line || !f || line[f] == null) { chk.className = 'chk'; chk.textContent = line ? `${line.floor} has no ${m === 'Others' ? '' : m + ' '}budget yet. The request is tracked but not checked against a budget.` : ''; return; }
    const used = f === 'cement' ? Object.values(D.orders).filter((o) => o.line === line.key && !['rejected', 'cancelled'].includes(o.status)).reduce((s, o) => s + (+shownQty(o) || 0), 0) : usedOf(line, m);
    const bal = line[f] - used, after = bal - qty, over = used + qty > line[f] * (1 + D.tolerance);
    chk.className = 'chk' + (over ? ' over' : '');
    chk.textContent = `${line.floor}: budget ${q(line[f])} ${M.unit}, used ${q(used)}, balance ${q(bal)}.` + (qty ? ` After this request: ${q(after)}.` : '') + (over ? ' This goes over budget. Management will see that when approving.' : '');
  };
  form.addEventListener('input', sync); form.addEventListener('change', sync); sync();
  $('#send').addEventListener('click', async () => {
    const err = $('#sheet .err'); err.textContent = ''; $('#send').disabled = true;
    try {
      const M = D.materials[val('material')], its = readItems();
      const r = await api('POST', { op: 'request', data: { material: val('material'), items: M.specs ? its : undefined, spec: M.specs ? its[0].spec : val('specText'), qty: its[0].qty, unit: val('unit'), line: val('line'), wing: val('wing'), element: val('element'), neededBy: val('neededBy'), note: val('note') } });
      D.orders[r.doc.id] = r.doc; render(); showOrder(r.doc.id, r.doc.budgetAtRequest && r.doc.budgetAtRequest.over ? 'Sent to Management for approval (over budget).' : 'Sent to Management for approval.');
    } catch (e) { err.textContent = e.message; $('#send').disabled = false; }
  });
}

function actionBox(o) {
  const c = D.can, u = o.unit;
  if (o.status === 'pending_approval' && c.approve) {
    const bk = o.budgetAtRequest || {}, over = bk.over;
    const budgetLine = bk.noBudget || bk.budget == null ? `${esc(o.floor)} has no ${esc(o.material)} budget line, so this request is not checked against a budget.`
      : `${esc(o.floor)} ${esc(o.material)} budget: ${q(bk.budget)} ${u}, used ${q(bk.used)}, balance ${q(bk.balance)}. After this request: ${q(bk.after)} ${u}.`;
    return `<div class="box"><h4>Approve this purchase</h4>
    ${itemTable(o)}
    <p class="note" style="margin:0">${esc(o.material)} ${esc(o.spec)}, ${multi(o) ? 'total ' : ''}${q(o.qty, 2)} ${u} for ${esc(o.building)} · ${esc(o.floor)}${o.element ? ' (' + esc(o.element) + ')' : ''}${o.neededBy ? ', needed by ' + day(o.neededBy) : ''}.${o.budgetRate ? ` At the budget rate this is about ${inr(o.qty * o.budgetRate)}.` : ''}</p>
    <div class="chk${over ? ' over' : ''}">${budgetLine}${over ? ' This is over budget.' : ''}</div>
    <label class="field">Note<textarea name="note" placeholder="Reason, needed for a rejection"></textarea></label><p class="err"></p>
    <div class="acts"><button class="btn warn" data-op="reject">Reject</button><button class="btn go" data-op="approve">Approve</button></div></div>`;
  }
  if (o.status === 'requested' && c.order && multi(o)) return `<div class="box"><h4>Place the order and enter the bill</h4>
    <p class="note" style="margin:0">One order and one bill for all sizes. Enter the quantity and rate for each; put 0 for a size you are not buying now.</p>
    <div class="items">${itemsOf(o).map((it) => `<div class="irow r3" data-spec="${esc(it.spec)}"><b>${esc(it.spec)}<br><span class="note">approved ${q(it.qty, 3)} ${u}</span></b><label class="field">Qty ordered (${u})<input data-k="qty" inputmode="decimal" value="${it.qty}"></label><label class="field">Rate per ${u}, incl. GST (₹)<input data-k="rate" inputmode="decimal" placeholder="${o.budgetRate ? 'Budget ₹' + o.budgetRate.toLocaleString('en-IN') : ''}"></label></div>`).join('')}</div>
    <div class="form"><label class="field">Vendor<input name="vendor" autocomplete="off"></label>
    <label class="field">Bill amount, incl. GST (₹)<input name="amount" inputmode="decimal"></label>
    <label class="field">Bill no.<input name="billNo" autocomplete="off"></label>
    <label class="field">Bill date<input name="billDate" type="date" value="${today()}"></label>
    <label class="field">PO no. (optional)<input name="poNo" autocomplete="off"></label>
    <label class="field wide">Note<textarea name="note"></textarea></label></div><p class="err"></p>
    <div class="acts"><button class="btn go" data-op="order">Save order and bill</button></div></div>`;
  if (o.status === 'requested' && c.order) return `<div class="box"><h4>Place the order and enter the bill</h4>
    <div class="form"><label class="field">Vendor<input name="vendor" autocomplete="off"></label>
    <label class="field">Quantity ordered (${u})<input name="qty" inputmode="decimal" value="${o.qty}"></label>
    <label class="field">Rate per ${u}, incl. GST (₹)<input name="rate" inputmode="decimal" placeholder="${o.budgetRate ? 'Budget ₹' + o.budgetRate.toLocaleString('en-IN') : ''}"></label>
    <label class="field">Bill amount, incl. GST (₹)<input name="amount" inputmode="decimal"></label>
    <label class="field">Bill no.<input name="billNo" autocomplete="off"></label>
    <label class="field">Bill date<input name="billDate" type="date" value="${today()}"></label>
    <label class="field">PO no. (optional)<input name="poNo" autocomplete="off"></label>
    <label class="field wide">Note<textarea name="note"></textarea></label></div><p class="err"></p>
    <div class="acts"><button class="btn go" data-op="order">Save order and bill</button></div></div>`;
  if (o.status === 'ordered' && c.receive && multi(o)) return `<div class="box"><h4>Confirm what arrived at site</h4>
    <div class="items">${(o.order.items || itemsOf(o)).map((it) => `<div class="irow r2" data-spec="${esc(it.spec)}"><b>${esc(it.spec)}<br><span class="note">ordered ${q(it.qty, 3)} ${u}</span></b><label class="field">Received (${u})<input data-k="qty" inputmode="decimal" value="${it.qty}"></label></div>`).join('')}</div>
    <div class="form"><label class="field">Date received<input name="date" type="date" value="${today()}"></label>
    <label class="field wide">Delivery challan no(s).<input name="challan" placeholder="Separate several challans with commas" autocomplete="off"></label>
    <label class="field wide">Note<textarea name="note" placeholder="Quality issues, rejected trucks…"></textarea></label></div><p class="err"></p>
    <div class="acts"><button class="btn go" data-op="receive">Confirm received</button></div></div>`;
  if (o.status === 'ordered' && c.receive) return `<div class="box"><h4>Confirm what arrived at site</h4>
    <div class="form"><label class="field">Quantity received (${u})<input name="qty" inputmode="decimal" value="${o.order.qty}"></label>
    <label class="field">Date received<input name="date" type="date" value="${today()}"></label>
    <label class="field wide">Delivery challan no(s).<input name="challan" placeholder="Separate several challans with commas" autocomplete="off"></label>
    <label class="field wide">Note<textarea name="note" placeholder="Quality issues, rejected trucks…"></textarea></label></div><p class="err"></p>
    <div class="acts"><button class="btn go" data-op="receive">Confirm received</button></div></div>`;
  if (o.status === 'received' && c.accounts) return `<div class="box"><h4>Check the bill</h4>
    ${itemTable(o)}
    <p class="note" style="margin:0">Bill ${o.order.billNo ? esc(o.order.billNo) + ' ' : ''}for ${inr(o.order.amount)} (${q(o.order.qty, 2)} ${u} at ${multi(o) ? 'an average of ' : ''}${inr(o.order.rate)}). Site received ${q(o.receipt.qty, 2)} ${u}${o.receipt.qty !== o.order.qty ? `, so the bill for the quantity received is ${inr(receivedValue(o))}` : ''}.</p>
    <div class="form"><label class="field">Amount payable (₹)<input name="payable" inputmode="decimal" value="${Math.round(o.receipt.qty !== o.order.qty ? receivedValue(o) : o.order.amount)}"></label>
    <label class="field wide">Note<textarea name="note" placeholder="Reason, needed to put on hold"></textarea></label></div><p class="err"></p>
    <div class="acts"><button class="btn warn" data-op="hold">Put on hold</button><button class="btn go" data-op="accounts_ok">Approve for payment</button></div></div>`;
  if (o.status === 'accounts_ok' && c.accounts) return `<div class="box"><h4>Record the payment</h4>
    <div class="form"><label class="field">Amount paid (₹)<input name="amount" inputmode="decimal" value="${Math.round(o.accounts.payable || o.order.amount)}"></label>
    <label class="field">Payment date<input name="date" type="date" value="${today()}"></label>
    <label class="field">UTR / cheque no.<input name="ref" autocomplete="off"></label></div><p class="err"></p>
    <div class="acts"><button class="btn go" data-op="paid">Mark paid</button></div></div>`;
  return '';
}
function showOrder(id, okMsg) {
  const o = D.orders[id]; if (!o) return;
  const c = D.can, canCancel = ['pending_approval', 'requested'].includes(o.status) && (c.cancelAny || (o.requestedBy === D.me.username && c.request));
  const kv = (l, v) => v === '' || v == null ? '' : `<div><small>${l}</small>${v}</div>`;
  open(`<div class="top"><div><h3>${esc(o.no)} · ${esc(o.material)} ${esc(o.spec)}</h3><div style="margin-top:6px"><span class="st ${o.status}">${LABEL[o.status]}</span> ${flags(o)}</div></div><button class="x" data-close aria-label="Close">×</button></div>
  ${okMsg ? `<p class="ok" style="margin:0">${esc(okMsg)}</p>` : ''}
  <div class="kv">${kv('Requested', `${multi(o) ? 'Total ' : ''}${q(o.qty, 2)} ${esc(o.unit)}`)}${kv('For', `${esc(o.building)} · ${esc(o.floor)}`)}${kv('Wing', o.wing && o.wing !== '—' ? esc(o.wing) : '')}${kv('Element', esc(o.element))}${kv('Needed by', o.neededBy ? day(o.neededBy) : '')}${kv('Raised by', `${who(o.requestedBy)}, ${when(o.requestedAt)}`)}
  ${o.budgetAtRequest && !o.budgetAtRequest.noBudget ? kv('Floor balance at request', `${q(o.budgetAtRequest.balance)} ${esc(o.unit)} of ${q(o.budgetAtRequest.budget)}`) : ''}${kv('Budget rate', o.budgetRate ? inr(o.budgetRate) + ' per ' + esc(o.unit) : '')}
  ${o.approval ? kv(o.approval.ok ? 'Approved by' : 'Rejected by', `${who(o.approval.by)}, ${when(o.approval.at)}${o.approval.note ? '<br><span class="note">' + esc(o.approval.note) + '</span>' : ''}`) : ''}
  ${o.order ? kv('Vendor', esc(o.order.vendor)) + kv('Ordered', `${q(o.order.qty, 2)} ${esc(o.unit)} at ${multi(o) ? 'avg. ' : ''}${inr(o.order.rate)}`) + kv('Bill', `${[o.order.billNo ? esc(o.order.billNo) : '', o.order.billDate ? day(o.order.billDate) : ''].filter(Boolean).join(', ')}${o.order.billNo || o.order.billDate ? ': ' : ''}${inr(o.order.amount)}`) + kv('PO no.', esc(o.order.poNo)) : ''}
  ${o.receipt ? kv('Received', `${q(o.receipt.qty, 2)} ${esc(o.unit)} on ${day(o.receipt.date)}`) + kv('Challan', esc(o.receipt.challan) + (o.receipt.photo ? ` · <a href="/api/me?purchase=1&photo=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">See the photo</a>` : '') + (o.receipt.vehicle ? ` · vehicle ${esc(o.receipt.vehicle)}` : '')) : ''}${o.approval && o.approval.via ? kv('Decided', esc(o.approval.via)) : ''}
  ${o.accounts ? kv('Approved for payment', `${inr(o.accounts.payable)} by ${who(o.accounts.by)}`) : ''}${o.payment ? kv('Paid', `${inr(o.payment.amount)} on ${day(o.payment.date)}, ${esc(o.payment.ref)}`) : ''}
  ${kv('Note', esc(o.note))}${o.hold && o.status === 'received' ? kv('On hold', esc(o.hold.note)) : ''}</div>
  ${o.status === 'received' && D.can.accounts || o.status === 'pending_approval' && D.can.approve ? '' : itemTable(o)}
  ${actionBox(o)}
  <div><h4 style="margin:0 0 8px;font-size:15px">History</h4><ol class="tl">${(o.history || []).map((h) => `<li><time>${when(h.at)}</time><span><b>${esc(h.did)}</b> · ${who(h.by)}${h.note ? `<br><span class="note">${esc(h.note)}</span>` : ''}</span></li>`).join('')}</ol></div>
  ${canCancel || D.me.role === 'admin' ? `<div class="acts">${canCancel ? '<button class="btn warn small" data-op="cancel">Cancel this request</button>' : ''}${D.me.role === 'admin' ? '<button class="btn warn small" data-del>Delete (test entries)</button>' : ''}</div>` : ''}<p class="err"></p>`);
  const del = $('#sheet [data-del]');
  if (del) del.addEventListener('click', async () => {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete permanently'; return; }
    try { await api('POST', { op: 'delete', id: o.id }); delete D.orders[o.id]; close(); render(); } catch (e) { const er = $$('#sheet .err').pop(); if (er) er.textContent = e.message; }
  });
  $$('#sheet [data-op]').forEach((b) => b.addEventListener('click', () => {
    const op = b.dataset.op, data = {};
    $$('#sheet .box [name]').forEach((el) => (data[el.name] = el.value));
    const rows = $$('#sheet .box .irow[data-spec]');
    if (rows.length) data.items = rows.map((r) => { const x = { spec: r.dataset.spec }; r.querySelectorAll('[data-k]').forEach((el) => (x[el.dataset.k] = el.value)); return x; });
    if (op === 'order' && data.items && !data.amount) { const v = data.items.reduce((s, x) => s + num(x.qty) * num(x.rate), 0); if (v) data.amount = String(Math.round(v)); }
    if (op === 'order' && !data.amount && data.qty && data.rate) data.amount = String(Math.round(+data.qty.replace(/,/g, '') * +data.rate.replace(/,/g, '')));
    const msg = { approve: 'Approved. It is now with Purchase.', reject: 'Rejected.', order: 'Order and bill saved. The site will confirm delivery.', receive: 'Receipt confirmed. The bill is now with Accounts.', accounts_ok: 'Approved for payment.', hold: 'Put on hold.', paid: 'Payment recorded.', cancel: 'Cancelled.' }[op];
    act({ op, id: o.id, data }, msg);
  }));
  const amt = $('#sheet [name=amount]'), qy = $('#sheet .box [name=qty]'), rt = $('#sheet [name=rate]');
  if (o.status === 'requested' && amt && multi(o)) {
    const rs = $$('#sheet .box .irow[data-spec]'), f = () => { const v = rs.reduce((s, r) => s + num(r.querySelector('[data-k=qty]').value) * num(r.querySelector('[data-k=rate]').value), 0); if (v && !amt.dataset.touched) amt.value = Math.round(v); };
    rs.forEach((r) => r.addEventListener('input', f)); amt.addEventListener('input', () => (amt.dataset.touched = '1'));
  } else if (o.status === 'requested' && amt && rt) { const f = () => { const v = (+qy.value.replace(/,/g, '') || 0) * (+rt.value.replace(/,/g, '') || 0); if (v && !amt.dataset.touched) amt.value = Math.round(v); }; qy.addEventListener('input', f); rt.addEventListener('input', f); amt.addEventListener('input', () => (amt.dataset.touched = '1')); }
}

// ---------- wiring ----------
$('#rows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) showOrder(tr.dataset.id); });
$('#rows').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showOrder(tr.dataset.id); } });
$('#tiles').addEventListener('click', (e) => { const t = e.target.closest('[data-st]'); if (!t) return; tileFilter = tileFilter === t.dataset.st ? null : t.dataset.st; tab = 'list'; render(); });
['#fStatus', '#fMat', '#fBld', '#fQ'].forEach((s) => $(s).addEventListener('input', () => { tileFilter = null; render(); }));
$('#bBld').addEventListener('change', render);
$$('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
$('#newBtn').addEventListener('click', newRequest);

Shell.init({ module: 'purchase', modsEl: document.getElementById('mods'), userEl: document.getElementById('user') }).then(async (me) => {
  if (!me) return;
  $('#main').hidden = false;
  try {
    D = await api('GET');
    $('#fMat').innerHTML += Object.keys(D.materials).map((m) => `<option>${m}</option>`).join('');
    $('#newBtn').hidden = !D.can.request;
    if (Object.values(D.orders).some(waitingFor)) $('#fStatus').value = 'mine';
    render();
  } catch (e) { $('#pageErr').textContent = e.message; }
});
