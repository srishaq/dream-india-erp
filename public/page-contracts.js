// Contractor work orders and RA bills (Purchase enters, Management approves, Accounts pay). Data from /api/me?contracts=1.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => n == null || n === '' ? '' : '₹' + Math.round(+n).toLocaleString('en-IN');
const q = (n, d = 3) => n == null || n === '' || isNaN(n) ? '–' : (+n).toLocaleString('en-IN', { maximumFractionDigits: d });
const day = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const when = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const LABEL = { draft: 'Draft', pending_approval: 'Waiting for Management', approved: 'Approved, to pay', paid: 'Paid', active: 'Active', closed: 'Closed' };
let D = null, tab = 'bills', tileFilter = null;

async function api(method, payload, qs = '') {
  const r = await fetch('/api/me?contracts=1' + qs, { method, headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}
const who = (u) => esc(D.people[u] || u || '');
function open(html) { $('#sheet').innerHTML = html; $('#scrim').hidden = false; }
function close() { $('#scrim').hidden = true; $('#sheet').innerHTML = ''; }
$('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim' || e.target.closest('[data-close]')) close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#scrim').hidden) close(); });
const sheetErr = (m) => { const e = $$('#sheet .err').pop(); if (e) e.textContent = m; };
const hasFinal = (woId) => Object.values(D.bills).some((x) => x.woId === woId && x.final && !['rejected', 'cancelled'].includes(x.status));
const waiting = (b) => (b.status === 'pending_approval' && D.can.approve) || (b.status === 'approved' && D.can.pay) || (b.status === 'draft' && D.can.enter);
async function reload() { const fresh = await api('GET'); Object.assign(D, fresh); render(); }

// ---------- list ----------
function render() {
  const bills = Object.values(D.bills), wos = Object.values(D.wos);
  const sumNet = (s) => bills.filter((b) => b.status === s).reduce((a, b) => a + ((b.totals && b.totals.net) || 0), 0);
  const tiles = [['draft', 'Drafts', bills.filter((b) => b.status === 'draft').length, ''], ['pending_approval', 'Waiting for Management', bills.filter((b) => b.status === 'pending_approval').length, inr(sumNet('pending_approval'))],
    ['approved', 'Approved, to pay', bills.filter((b) => b.status === 'approved').length, inr(sumNet('approved'))], ['wo', 'Work orders waiting', wos.filter((w) => w.status === 'pending_approval').length, '']];
  $('#tiles').innerHTML = tiles.map(([k, l, n, s]) => `<button class="tile ${n && (k === 'pending_approval' && D.can.approve || k === 'approved' && D.can.pay || k === 'wo' && D.can.approve) ? 'hot' : ''}" data-st="${k}" aria-pressed="${tileFilter === k}"><b>${n}</b><span>${l}${s ? ' · ' + s : ''}</span></button>`).join('');
  $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $('#billsView').hidden = tab !== 'bills'; $('#wosView').hidden = tab !== 'wos';
  const f = $('#fSt').value;
  let list = bills.filter((b) => tileFilter ? b.status === tileFilter : f === 'open' ? b.status !== 'paid' : f === 'mine' ? waiting(b) : f === 'paid' ? b.status === 'paid' : true);
  list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('#rows').innerHTML = list.map((b) => { const w = D.wos[b.woId] || {}; return `<tr class="click" tabindex="0" data-bill="${b.id}"><td><b>${esc(b.no)}</b>${b.billNo ? `<br><span class="note">Bill ${esc(b.billNo)}</span>` : ''}</td><td>${esc(w.contractor)}<br><span class="note">${esc(w.scope || '')}</span></td><td>${day(b.from)} – ${day(b.to)}</td><td><span class="st ${b.status}">${LABEL[b.status] || b.status}</span></td><td class="n">${inr(b.totals && b.totals.gross)}</td><td class="n"><b>${inr(b.totals && b.totals.net)}</b></td></tr>`; }).join('') || `<tr><td colspan="6" class="empty">${bills.length ? 'Nothing here.' : 'No RA bills yet. Enter a work order first, then its bills.'}</td></tr>`;
  $('#wos').innerHTML = wos.sort((a, b) => String(a.no).localeCompare(String(b.no))).map((w) => {
    const bs = bills.filter((b) => b.woId === w.id && !['draft'].includes(b.status));
    const billed = bs.reduce((a, b) => a + ((b.totals && b.totals.gross) || 0), 0), value = w.mode === 'schedule' ? w.area * w.sqftRate : w.items.reduce((a, i) => a + i.rate * i.qty, 0);
    const held = bs.reduce((a, b) => a + ((b.totals && b.totals.retention) || 0) - ((b.totals && b.totals.released) || 0), 0);
    return `<div class="wo"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3>${esc(w.no)} · ${esc(w.contractor)}</h3><span class="st ${w.status}">${w.status === 'pending_approval' ? 'Waiting for Management' : LABEL[w.status]}</span></div>
      <div class="meta">${esc(w.scope || '')}${w.scope ? ' · ' : ''}${esc(w.company)} · ${w.mode === 'schedule' ? `${q(w.area, 0)} sq ft × ${inr(w.sqftRate)}` : `${w.items.length} item${w.items.length === 1 ? '' : 's'}`} · contract value ${inr(value)} · billed ${inr(billed)} (${value ? Math.round(billed / value * 1000) / 10 : 0}%) · retention held ${inr(held)}${w.advance ? ` · advance ${inr(w.advance)}` : ''}</div>
      <div class="acts" style="justify-content:flex-start">${w.file ? `<a class="btn small" href="/api/me?contracts=1&file=${w.id}" target="_blank" rel="noopener">Signed copy</a>` : ''}${D.can.enter || D.can.approve ? `<button class="btn small" data-editwo="${w.id}">${w.status === 'pending_approval' || D.can.approve ? 'Open / change' : 'Open'}</button>` : ''}${w.status === 'pending_approval' && D.can.approve ? `<button class="btn go small" data-apwo="${w.id}">Approve</button>` : ''}${w.status === 'active' && D.can.enter && !hasFinal(w.id) ? `<button class="btn small" data-billwo="${w.id}">New RA bill</button>${bills.some((b) => b.woId === w.id && b.status !== 'draft') ? `<button class="btn small" data-finalwo="${w.id}">Final measurement bill</button>` : ''}` : ''}${D.can.enter && held > 1 && ['active', 'closed'].includes(w.status) ? `<button class="btn small" data-relwo="${w.id}">Release retention</button>` : ''}</div></div>`;
  }).join('') || '<p class="empty">No work orders yet.</p>';
}

// ---------- work order form ----------
// The payment schedule and area statement of the Dream Signature RCC contract (Mandal Infrastructure, Dec 2025),
// offered as a starting point for a new payment-schedule work order.
const STD_STAGES = [['Excavation', 3, 1], ['Foundation completion', 6, 1], ['Plinth completion', 9, 1], ['Completion of 1st slab', 3, 1, 1], ['Completion of 2nd to 5th slab', 6, 4, 2],
  ['Completion of 6th to 10th slab', 12, 5, 6], ['Completion of 11th to 34th slab', 28.8, 24, 11], ['Completion of 35th to 46th slab', 9.6, 12, 35], ['Completion of U.G. tank', 1.6, 1], ['Completion of O.H.T. & lift room', 1, 1],
  ['Block work', 5, 1], ['Internal plaster', 7, 1], ['External plaster', 6, 1], ['Waterproofing', 1, 1], ['Compound wall / PCC / misc. works', 1, 1]];
// The rehab building (34 slabs) is billed the same way; the 35th–46th slab stage (9.6%) is paid when the rehab building is completed.
const STD_STAGES_REHAB = STD_STAGES.map((x) => (x[0] === 'Completion of 35th to 46th slab' ? ['Completion of the rehab building', 9.6, 1] : x));
const STD_FACTORS = [['Out to out beam face area', 100], ['Shops, offices, lobbies, stairs, lifts, ramp, residential, canopy, balcony, flower bed', 100], ['Basement floors', 150], ['Basement floors 4.20 m and above height', 200], ['Area above U.G. tanks in basement', 75],
  ['Double height structure', 150], ['Stilt area (parking on ground floor)', 70], ['Podium area (parking on podium floors)', 80], ['Ramp void cover slab', 200], ['Floor height 4.20 m and above', 120], ['Service slabs in duct wider than 600 mm', 100],
  ['Voids in ducts', 0], ['Refuge area', 80], ['Parking tower void', 25], ['Swimming pool', 200], ['Open terrace', 0], ['OHT & LMR', 0], ['U.G. tank', 0], ['Chajja up to 1200 mm', 0], ['Chajja above 1200 mm', 100]];
function woForm(w) {
  const t = Object.entries(D.cast);
  const towerSel = (it) => `<select data-k="tower"><option value="">—</option>${t.map(([k, x]) => `<option value="${k}" ${it.link && it.link.tower === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const item = (it = {}) => `<div class="irow wi" data-item="${esc(it.id || '')}"><label class="field wide2">Item<input data-k="desc" value="${esc(it.desc)}" placeholder="e.g. RCC structure labour, per sq ft of construction area"></label><label class="field">Unit<input data-k="unit" value="${esc(it.unit || 'sq ft')}"></label>
    <label class="field">Rate ₹<input data-k="rate" inputmode="decimal" value="${it.rate ?? ''}"></label><label class="field">Contract qty<input data-k="qty" inputmode="decimal" value="${it.qty ?? ''}"></label>
    <label class="field">Count from slabs of${towerSel(it)}<input data-k="perSlab" inputmode="decimal" value="${it.perSlab ?? ''}" placeholder="sq ft per slab (e.g. 9,150)" style="margin-top:4px"></label><button type="button" class="x" data-rm title="Remove">×</button></div>`;
  const stage = (it = {}) => `<div class="irow wi" data-item="${esc(it.id || '')}"><label class="field wide2">Stage<input data-k="desc" value="${esc(it.desc)}" placeholder="e.g. Plinth completion"></label><label class="field">% of contract<input data-k="pct" inputmode="decimal" value="${it.pct ?? ''}"></label>
    <label class="field">Slabs in it<input data-k="count" inputmode="numeric" value="${it.count ?? 1}"></label><label class="field">Count slabs of${towerSel(it)}<input data-k="slabFrom" inputmode="numeric" value="${it.slabFrom ?? ''}" placeholder="first slab no. (e.g. 11)" style="margin-top:4px"></label><button type="button" class="x" data-rm title="Remove">×</button></div>`;
  const recRow = (r = {}) => `<div class="irow rr" data-rec="${esc(r.id || '')}"><label class="field wide2">What we paid first<input data-k="name" value="${esc(r.name)}" placeholder="e.g. Mivan formwork"></label><label class="field">Total to recover ₹<input data-k="total" inputmode="decimal" value="${r.total ?? ''}"></label><label class="field">Per bill ₹<input data-k="perBill" inputmode="decimal" value="${r.perBill ?? ''}"></label><button type="button" class="x" data-rm title="Remove">×</button></div>`;
  const facRow = (f = {}) => `<div class="irow fr"><label class="field wide2">Floor / area type<input data-k="name" value="${esc(f.name)}"></label><label class="field">Counted at %<input data-k="factor" inputmode="decimal" value="${f.factor ?? 100}"></label><button type="button" class="x" data-rm title="Remove">×</button></div>`;
  let mode = w ? w.mode || 'items' : 'schedule';
  const locked = w && w.status !== 'pending_approval' && !D.can.approve;
  open(`<div class="top"><h3>${w ? esc(w.no) + ' · work order' : 'New work order'}</h3><button class="x" data-close>×</button></div>
    <div class="form"><label class="field">Contractor<input name="contractor" value="${esc(w && w.contractor)}" maxlength="120"></label><label class="field">Issued by<select name="company">${D.companies.map((c) => `<option ${(w ? w.company : 'Prime Realtors') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field wide">Scope<input name="scope" value="${esc(w && w.scope)}" maxlength="300" placeholder="e.g. Civil work: RCC frame, masonry, plaster, waterproofing (part material)"></label>
      <label class="field">Work order date<input type="date" name="date" value="${esc(w ? w.date : today())}"></label><label class="field">Contractor PAN<input name="pan" value="${esc(w && w.pan)}" maxlength="10"></label><label class="field">Contractor GSTIN<input name="gstin" value="${esc(w && w.gstin)}" maxlength="15"></label>
      <label class="field">How is the contractor paid?<select name="mode"><option value="schedule" ${mode === 'schedule' ? 'selected' : ''}>% of contract value, by stage</option><option value="items" ${mode === 'items' ? 'selected' : ''}>Item rates × quantity</option></select></label></div>
    <div class="box" id="schedBox"><h4>Contract value and payment schedule</h4><div class="form">
      <label class="field">Construction area, sq ft (approx.)<input name="area" inputmode="decimal" value="${w && w.area ? w.area : ''}" placeholder="e.g. 982765"></label><label class="field">Rate ₹ per sq ft<input name="sqftRate" inputmode="decimal" value="${w && w.sqftRate ? w.sqftRate : ''}" placeholder="e.g. 900"></label><label class="field">Contract value<input id="cval" disabled></label></div>
      <div class="items" id="wstages">${(w && w.mode === 'schedule' ? w.items : []).map(stage).join('')}</div><button type="button" class="addrow" id="addStage">+ Add stage</button> <button type="button" class="addrow" id="stdStages">Use the standard RCC schedule (sale building, 46 slabs)</button> <button type="button" class="addrow" id="stdRehab">Rehab building (34 slabs)</button>
      <p class="note" style="margin:0" id="stTot"></p><p class="note" style="margin:0">A slab group (e.g. 11th to 34th slab, 24 slabs) is claimed slab by slab. Give the building and its first slab number, and each bill suggests the slabs site marked cast.</p></div>
    <div class="box" id="itemsBox"><h4>Items</h4><div class="items" id="witems">${(w && w.mode !== 'schedule' ? w.items : [{}]).map(item).join('')}</div><button type="button" class="addrow" id="addItem">+ Add item</button>
      <p class="note" style="margin:0">"Count from slabs" makes each RA bill suggest the slabs cast since the last bill × the sq ft per slab. The final measurement bill settles the difference at the end.</p></div>
    <div class="box"><h4>Deductions and GST</h4><div class="form">
      <label class="field">GST on bills %<input name="gstPct" inputmode="decimal" value="${w ? w.gstPct ?? 0 : 18}"></label><label class="field">Retention %<input name="retentionPct" inputmode="decimal" value="${w ? w.retentionPct : 5}"></label><label class="field">TDS %<input name="tdsPct" inputmode="decimal" value="${w ? w.tdsPct : 2}"></label><label class="field">Pay within days of the bill<input name="payDays" inputmode="numeric" value="${w ? w.payDays || '' : 15}"></label>
      <label class="field">Mobilisation advance paid ₹<input name="advance" inputmode="decimal" value="${w ? w.advance || '' : ''}"></label><label class="field">Recover the advance<select name="advanceAt"><option value="">at a % of each bill</option></select></label><label class="field" id="advPctF">% of each bill<input name="advanceRecoveryPct" inputmode="decimal" value="${w ? w.advanceRecoveryPct || '' : 10}"></label></div>
      <h4 style="margin-top:10px">Costs we pay first, recovered in instalments from the bills</h4><div class="items" id="wrec">${((w && w.recoveries) || []).map(recRow).join('')}</div><button type="button" class="addrow" id="addRec">+ Add</button> ${w && (w.recoveries || []).length ? '' : '<button type="button" class="addrow" id="stdRec">Add Mivan formwork and safety screens</button>'}</div>
    <div class="box"><h4>Steel and RMC we supply</h4>
      <p class="note" style="margin:0 0 6px">Norm = how much the work should use per sq ft (steel in kg and RMC in m³, from the structural design). The ERP compares what site issued to this contractor with the sq ft billed × norm + the allowed wastage (3% unless agreed otherwise), and suggests deducting the excess at our cost: the rate typed here, else the latest rate we bought at. Leave a norm blank to use the design quantities site logs.</p>
      <div class="form">
      <label class="field">Steel norm, kg per sq ft<input name="n_steel" inputmode="decimal" value="${w && w.norms ? w.norms.steelKgPerSqft || '' : ''}" placeholder="e.g. 4.5"></label><label class="field">Steel allowed wastage %<input name="w_steelPct" inputmode="decimal" value="${w ? w.wastage.steelPct : 3}"></label><label class="field">Recover steel at ₹/MT<input name="w_steelRate" inputmode="decimal" value="${w ? w.wastage.steelRate || '' : ''}" placeholder="blank = latest purchase rate"></label>
      <label class="field">RMC norm, m³ per sq ft<input name="n_rmc" inputmode="decimal" value="${w && w.norms ? w.norms.rmcM3PerSqft || '' : ''}" placeholder="e.g. 0.04"></label><label class="field">RMC allowed wastage %<input name="w_rmcPct" inputmode="decimal" value="${w ? w.wastage.rmcPct : 3}"></label><label class="field">Recover RMC at ₹/m³<input name="w_rmcRate" inputmode="decimal" value="${w ? w.wastage.rmcRate || '' : ''}" placeholder="blank = latest purchase rate"></label>
      <label class="field wide">Buildings this contractor works on<span style="display:flex;gap:14px;flex-wrap:wrap;font-weight:500">${t.map(([k, x]) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="tw" value="${k}" ${w && (w.towers || []).includes(k) ? 'checked' : ''} style="width:auto">${esc(x.name)}</label>`).join('')}</span></label></div>
      <details style="margin:6px 0"><summary class="note">Only if we also supply cement bags (e.g. for plaster)</summary><div class="form" style="margin-top:6px">
      <label class="field">Cement norm, bags per sq ft<input name="n_cement" inputmode="decimal" value="${w && w.norms ? w.norms.cementBagsPerSqft || '' : ''}" placeholder="e.g. 0.4"></label><label class="field">Cement allowed wastage %<input name="w_cementPct" inputmode="decimal" value="${w ? w.wastage.cementPct ?? 3 : 3}"></label><label class="field">Recover cement at ₹/bag<input name="w_cementRate" inputmode="decimal" value="${w ? w.wastage.cementRate || '' : ''}" placeholder="blank = latest purchase rate"></label>
      </div></details>
      <p class="note" style="margin:0">Site logs what is issued with Material used on the Construction page.</p></div>
    <div class="box" id="facBox"><h4>Area statement for the final bill (how each floor type is counted)</h4><div class="items" id="wfac">${((w && w.areaFactors) || []).map(facRow).join('')}</div><button type="button" class="addrow" id="addFac">+ Add</button> ${w && (w.areaFactors || []).length ? '' : '<button type="button" class="addrow" id="stdFac">Use the standard area statement</button>'}</div>
    ${w ? `<div class="box"><h4>Signed work order</h4><p class="note" style="margin:0 0 6px">${w.file ? `Attached ${day(w.file.at)} by ${who(w.file.by)}. <a href="/api/me?contracts=1&file=${w.id}" target="_blank" rel="noopener">Open the signed copy</a>` : 'Not attached yet. Attach the signed and stamped copy so everyone works from the same terms.'}</p><label class="btn small" style="display:inline-block;cursor:pointer">${w.file ? 'Replace' : 'Attach PDF or photo'}<input type="file" id="woFile" accept="application/pdf,image/*" hidden></label> <span class="note" id="woFileMsg"></span></div>` : ''}
    <label class="field">Other terms (for reference)<textarea name="note" rows="3" maxlength="1000" placeholder="e.g. floor height above 3.05 m paid 10% extra per foot; 24 months after plinth">${esc(w && w.note)}</textarea></label>
    <p class="err"></p>
    <div class="acts">${w && w.status === 'active' && D.can.approve ? `<button class="btn warn small" data-closewo>${'Close work order'}</button>` : w && w.status === 'closed' && D.can.approve ? '<button class="btn small" data-closewo>Reopen</button>' : ''}<button class="btn" data-close>Cancel</button>${locked ? '' : '<button class="btn go" id="saveWo">Save</button>'}</div>`);
  const v = (n) => ($(`#sheet [name=${n}]`) || {}).value;
  const stageRows = () => $$('#wstages .irow');
  const advSel = () => { const sel = $('#sheet [name=advanceAt]'), keep = sel.value || (w && w.advanceAt) || ''; sel.innerHTML = '<option value="">at a % of each bill</option>' + (mode === 'schedule' ? stageRows().map((r, i) => { const d = r.querySelector('[data-k=desc]').value || `Stage ${i + 1}`; const id = r.dataset.item || 'i' + i; return `<option value="${esc(id)}" data-i="${i}" ${keep === id ? 'selected' : ''}>in full on the bill with: ${esc(d)}</option>`; }).join('') : ''); $('#advPctF').hidden = !!sel.value; };
  const sync = () => {
    $('#schedBox').hidden = mode !== 'schedule'; $('#itemsBox').hidden = mode === 'schedule'; $('#facBox').hidden = mode !== 'schedule';
    const val = num(v('area')) * num(v('sqftRate')); $('#cval').value = val ? inr(val) : '';
    const tot = stageRows().reduce((a, r) => a + num(r.querySelector('[data-k=pct]').value), 0); $('#stTot').textContent = stageRows().length ? `Stages add up to ${Math.round(tot * 100) / 100}%${Math.abs(tot - 100) > 0.01 ? ' (must be 100%)' : ''}.` : '';
  };
  $('#sheet [name=mode]').onchange = (e) => { mode = e.target.value; sync(); advSel(); };
  $('#sheet').addEventListener('input', (e) => { if (e.target.closest('#schedBox') || e.target.name === 'area' || e.target.name === 'sqftRate') { sync(); if (e.target.dataset.k === 'desc') advSel(); } });
  $('#sheet [name=advanceAt]').onchange = () => ($('#advPctF').hidden = !!$('#sheet [name=advanceAt]').value);
  $('#addItem').onclick = () => $('#witems').insertAdjacentHTML('beforeend', item());
  $('#addStage').onclick = () => { $('#wstages').insertAdjacentHTML('beforeend', stage()); sync(); advSel(); };
  const fill = (list, re, plinth) => { const tw = (t.find(([, x]) => re.test(x.name)) || t[0] || [''])[0]; $('#wstages').innerHTML = list.map(([desc, pct, count, from]) => stage({ desc, pct, count, slabFrom: from, link: from && tw ? { tower: tw } : null })).join(''); sync(); advSel(); const sel = $('#sheet [name=advanceAt]'); const pl = [...sel.options].find((o) => /plinth/i.test(o.textContent)); if (pl && plinth) { sel.value = pl.value; $('#advPctF').hidden = true; } };
  $('#stdStages').onclick = () => fill(STD_STAGES, /sale/i, true);
  $('#stdRehab').onclick = () => fill(STD_STAGES_REHAB, /rehab/i, false);
  $('#addRec').onclick = () => $('#wrec').insertAdjacentHTML('beforeend', recRow());
  const sr = $('#stdRec'); if (sr) sr.onclick = () => { $('#wrec').insertAdjacentHTML('beforeend', recRow({ name: 'Mivan formwork' }) + recRow({ name: 'Safety masks / screens' })); sr.remove(); };
  $('#addFac').onclick = () => $('#wfac').insertAdjacentHTML('beforeend', facRow());
  const sf = $('#stdFac'); if (sf) sf.onclick = () => { $('#wfac').innerHTML = STD_FACTORS.map(([name, factor]) => facRow({ name, factor })).join(''); sf.remove(); };
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('.irow').remove(); sync(); advSel(); } });
  sync(); advSel();
  const wf = $('#woFile'); if (wf) wf.onchange = () => { const f = wf.files[0]; if (!f) return; if (f.size > 3e6) { $('#woFileMsg').textContent = 'Too big: keep it under 3 MB.'; return; }
    const rd = new FileReader(); rd.onload = async () => { $('#woFileMsg').textContent = 'Uploading…'; try { const r = await api('POST', { op: 'wo_file', id: w.id, data: { data: rd.result, name: f.name } }); D.wos[w.id] = r.wo; $('#woFileMsg').textContent = 'Attached.'; } catch (e) { $('#woFileMsg').textContent = e.message; } }; rd.readAsDataURL(f); };
  const cw = $('#sheet [data-closewo]'); if (cw) cw.onclick = async () => { try { await api('POST', { op: 'wo_close', id: w.id }); close(); reload(); } catch (e) { sheetErr(e.message); } };
  const sv = $('#saveWo'); if (sv) sv.onclick = async () => {
    const g = (r, k) => (r.querySelector(`[data-k=${k}]`) || {}).value;
    const items = mode === 'schedule'
      ? stageRows().map((r) => ({ id: r.dataset.item || undefined, desc: g(r, 'desc'), pct: g(r, 'pct'), count: g(r, 'count'), link: g(r, 'tower') ? { tower: g(r, 'tower') } : null, slabFrom: g(r, 'slabFrom') }))
      : $$('#witems .irow').map((r) => ({ id: r.dataset.item || undefined, desc: g(r, 'desc'), unit: g(r, 'unit'), rate: g(r, 'rate'), qty: g(r, 'qty'), link: g(r, 'tower') ? { tower: g(r, 'tower') } : null, perSlab: g(r, 'perSlab') }));
    const advOpt = $('#sheet [name=advanceAt]').selectedOptions[0];
    const data = { mode, area: v('area'), sqftRate: v('sqftRate'), contractor: v('contractor'), company: v('company'), scope: v('scope'), date: v('date'), pan: v('pan'), gstin: v('gstin'), gstPct: v('gstPct'), payDays: v('payDays'),
      retentionPct: v('retentionPct'), tdsPct: v('tdsPct'), advance: v('advance'), advanceRecoveryPct: v('advanceRecoveryPct'),
      advanceAt: advOpt && advOpt.value && !/^i\d+$/.test(advOpt.value) ? advOpt.value : undefined, advanceAtIndex: advOpt && advOpt.value && /^i\d+$/.test(advOpt.value) ? +advOpt.dataset.i : undefined,
      recoveries: $$('#wrec .irow').map((r) => ({ id: r.dataset.rec || undefined, name: g(r, 'name'), total: g(r, 'total'), perBill: g(r, 'perBill') })),
      areaFactors: $$('#wfac .irow').map((r) => ({ name: g(r, 'name'), factor: g(r, 'factor') })),
      wastage: { rmcPct: v('w_rmcPct'), rmcRate: v('w_rmcRate'), steelPct: v('w_steelPct'), steelRate: v('w_steelRate'), cementPct: v('w_cementPct'), cementRate: v('w_cementRate') },
      norms: { steelKgPerSqft: v('n_steel'), cementBagsPerSqft: v('n_cement'), rmcM3PerSqft: v('n_rmc') }, towers: $$('#sheet [name=tw]:checked').map((x) => x.value), items, note: v('note') };
    sv.disabled = true;
    try { await api('POST', { op: 'wo_save', id: w ? w.id : undefined, data }); close(); tab = 'wos'; reload(); } catch (e) { sv.disabled = false; sheetErr(e.message); }
  };
}

// ---------- bills ----------
function totalsBox(t) {
  const L = [];
  if (t.kind === 'release') return `<div class="sum"><span class="net">Retention released</span><b class="net">${inr(t.released)}</b></div>`;
  L.push([t.final ? 'Gross (final value less billed before)' : 'Gross (work done this bill)', inr(t.gross)]);
  if (t.gst) L.push(['Add GST', '+ ' + inr(t.gst)], ['Invoice value', inr(t.invoice)]);
  L.push(['Less retention', '− ' + inr(t.retention)], ['Less TDS', '− ' + inr(t.tds)], ['Less advance recovery', '− ' + inr(t.advance)]);
  for (const r of t.recoveries || []) if (r.amount) L.push([`Less ${r.name}`, '− ' + inr(r.amount)]);
  L.push(['Less material recovery', '− ' + inr(t.material)], ['Less other deductions', '− ' + inr(t.other)]);
  if (t.released) L.push(['Add retention released', '+ ' + inr(t.released)]);
  return `<div class="sum">${L.map(([a, b]) => `<span>${esc(a)}</span><b>${b}</b>`).join('')}<span class="net">Net payable</span><b class="net">${inr(t.net)}</b></div>`;
}
async function billForm(woId, b, kindNew) {
  const w = D.wos[woId], kind = b ? b.kind || (b.final ? 'final' : 'ra') : kindNew || 'ra', fin = kind === 'final', sched = w.mode === 'schedule';
  const lastTo = Object.values(D.bills).filter((x) => x.woId === woId && x.id !== (b && b.id)).map((x) => x.to).sort().pop();
  const from = b ? b.from : lastTo ? new Date(Date.parse(lastTo) + 864e5).toISOString().slice(0, 10) : w.date, to = b ? b.to : (today() > from ? today() : from);
  let sg = null;
  try { sg = (await api('GET', null, `&suggest=${woId}&from=${from}&to=${to}`)).suggestion; } catch (e) { sg = null; }
  const prev = {}; for (const x of Object.values(D.bills)) if (x.woId === w.id && x.id !== (b && b.id) && !['rejected', 'cancelled'].includes(x.status) && (!b || x.seq < b.seq)) for (const l of x.lines || []) prev[l.itemId] = (prev[l.itemId] || 0) + (+l.qty || 0);
  const lineOf = (it) => b && (b.lines || []).find((x) => x.itemId === it.id);
  const title = b ? esc(b.no) : kind === 'release' ? 'Release retention' : fin ? 'Final measurement bill' : 'New RA bill';
  let body;
  if (kind === 'release') {
    const R = sg ? sg.retention : { held: 0, released: 0, left: 0 };
    body = `<p class="sugg">Retention held so far ${inr(R.held)}, released ${inr(R.released)}, still held ${inr(R.left)}. Under ${esc(w.contractor)}'s work order, half is usually released at RCC completion and the rest after the defect liability period.</p>
      <div class="form"><label class="field">Release ₹<input name="releaseAmount" inputmode="decimal" value="${b ? b.releaseAmount : Math.round(R.left / (R.released ? 1 : 2)) || ''}"></label><label class="field wide">Why now<input name="releaseNote" maxlength="200" value="${esc(b ? b.releaseNote : '')}" placeholder="e.g. RCC work completed on 12 Mar 2027"></label></div>`;
  } else if (fin && sched) {
    const rows = b ? b.areaRows : (w.areaFactors || []).map((f) => ({ name: f.name, area: '', factor: f.factor }));
    body = `<p class="sugg">Enter the actual constructed area of each floor type from the measurement. Each counts at its % in the work order. The final value (${inr(w.sqftRate)} per sq ft) less everything billed before is this bill; retention is held as usual and released through release bills.</p>
      <div class="tbl"><table class="ltbl"><thead><tr><th>Floor / area type</th><th class="n">Measured sq ft</th><th class="n">Counted at %</th><th class="n">Counts as sq ft</th></tr></thead><tbody id="arows">${rows.map((r) => `<tr><td><input data-a="name" value="${esc(r.name)}" style="width:100%"></td><td class="n"><input data-a="area" inputmode="decimal" value="${r.area ?? ''}" style="max-width:120px;text-align:right"></td><td class="n"><input data-a="factor" inputmode="decimal" value="${r.factor}" style="max-width:70px;text-align:right"></td><td class="n" data-eff>–</td></tr>`).join('')}</tbody></table></div>
      <button type="button" class="addrow" id="addArea">+ Add a row</button><p class="note" id="areaTot" style="margin:4px 0"></p>
      <h4 style="margin:10px 0 4px">Extras agreed in the work order (e.g. floor height above the limit)</h4><div class="items" id="xrows">${((b && b.extras) || []).map((x) => `<div class="irow"><label class="field wide2">What<input data-x="name" value="${esc(x.name)}"></label><label class="field">Amount ₹<input data-x="amount" inputmode="decimal" value="${x.amount}"></label><button type="button" class="x" data-rm>×</button></div>`).join('')}</div><button type="button" class="addrow" id="addX">+ Add an extra</button>`;
  } else {
    const qOf = (it) => { const l = lineOf(it); if (fin) return l ? l.final ?? '' : ''; const qv = l ? l.qty || '' : sg && sg.qty[it.id] != null && sg.qty[it.id] > 0 ? sg.qty[it.id] : ''; return sched && it.unit === 'stage' && qv !== '' ? Math.round(qv * 10000) / 100 : qv; };
    body = `${fin ? '<p class="sugg">Enter the final measured quantity of each item. The difference from what was billed before is paid, or recovered if less; the retention held is released and any advance still open is recovered.</p>' : sg && Object.values(sg.qty).some((x) => x > 0) ? '<p class="sugg">Slabs are suggested from what site marked cast. Check them against the site in-charge\'s certificate before saving.</p>' : ''}
    <div class="tbl"><table class="ltbl"><thead><tr><th>${sched ? 'Stage' : 'Item'}</th><th class="n">${sched ? 'Value' : 'Rate'}</th><th class="n">${fin ? 'Billed before' : 'Done before'}</th><th class="n">${fin ? 'Final measured' : sched ? 'This bill' : 'This bill'}</th><th class="n">Amount</th></tr></thead><tbody>
      ${w.items.map((it) => `<tr data-it="${it.id}" data-unit="${it.unit}"><td>${esc(it.desc)} <span class="note">(${sched ? (it.unit === 'slab' ? `${it.qty} slabs × ${Math.round(it.pct / it.qty * 1000) / 1000}%` : `${it.pct}%`) : esc(it.unit)})</span></td><td class="n">${inr(sched ? it.rate * it.qty : it.rate)}</td><td class="n">${sched ? (it.unit === 'slab' ? q(prev[it.id] || 0) + ' of ' + it.qty : Math.round((prev[it.id] || 0) * 10000) / 100 + '%') : q(prev[it.id] || 0)}</td><td class="n"><input data-q inputmode="decimal" value="${qOf(it)}" style="max-width:110px;text-align:right" placeholder="${sched ? (it.unit === 'slab' ? 'slabs' : '% done') : ''}"></td><td class="n" data-amt>–</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  const recs = kind === 'release' ? [] : (w.recoveries || []).map((r) => { const x = b ? (b.recoveries || []).find((y) => y.id === r.id) : sg && sg.recoveries.find((y) => y.id === r.id); const left = sg ? (sg.recoveries.find((y) => y.id === r.id) || {}).left : null; return { r, amount: x ? x.amount : '', left }; });
  open(`<div class="top"><h3>${title} · ${esc(w.contractor)}</h3><button class="x" data-close>×</button></div>
    <p class="note" style="margin:0">${esc(w.no)} · ${esc(w.scope || '')}${sched ? ` · contract ${inr(w.area * w.sqftRate)} (${q(w.area, 0)} sq ft × ${inr(w.sqftRate)})` : ''} · retention ${w.retentionPct}% · TDS ${w.tdsPct}%${w.gstPct ? ` · GST ${w.gstPct}%` : ''}${w.payDays ? ` · pay within ${w.payDays} days` : ''}</p>
    <div class="form"><label class="field">Period from<input type="date" name="from" value="${esc(from)}"></label><label class="field">Period to<input type="date" name="to" value="${esc(to)}"></label>
      <label class="field">Contractor's bill no.<input name="billNo" value="${esc(b && b.billNo)}" maxlength="60"></label><label class="field">Bill date<input type="date" name="billDate" value="${esc(b && b.billDate)}"></label></div>
    ${body}
    ${recs.length ? `<div class="form">${recs.map((x) => `<label class="field">${esc(x.r.name)} ₹${x.left != null ? ` <span class="note">(${inr(x.left)} left)</span>` : ''}<input data-rec="${x.r.id}" inputmode="decimal" value="${x.amount || ''}"></label>`).join('')}</div>` : ''}
    ${kind === 'release' ? '' : `<div class="form"><label class="field">Material recovery ₹<input name="materialRecovery" inputmode="decimal" value="${b ? b.materialRecovery || '' : sg && sg.material ? sg.material : ''}"></label><label class="field wide">Material note<input name="materialNote" maxlength="200" value="${esc(b ? b.materialNote : sg ? sg.materialNote : '')}"></label>
      <label class="field">Other deductions ₹<input name="otherDeduction" inputmode="decimal" value="${b ? b.otherDeduction || '' : ''}"></label><label class="field wide">Other deductions note<input name="otherNote" maxlength="200" value="${esc(b && b.otherNote)}" placeholder="e.g. labour camp electricity"></label></div>`}
    <label class="field">Note for Management${kind === 'ra' ? ' (needed if a stage goes beyond the work order)' : ''}<input name="subNote" maxlength="300"></label>
    <div id="tot"></div><p class="err"></p>
    <div class="acts">${b ? '<button class="btn warn small" data-delbill>Delete draft</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn" id="saveBill">Save draft</button><button class="btn go" id="subBill">Save and submit to Management</button></div>`);
  const nc = sg && sg.normCalc; let matTouched = !!b;
  const mr = $('#sheet [name=materialRecovery]'); if (mr) mr.addEventListener('input', () => (matTouched = true));
  const data = () => {
    const v = (n) => ($(`#sheet [name=${n}]`) || {}).value;
    const d = { woId, kind, final: fin || undefined, from: v('from'), to: v('to'), billNo: v('billNo'), billDate: v('billDate'), materialRecovery: v('materialRecovery'), materialNote: v('materialNote'), otherDeduction: v('otherDeduction'), otherNote: v('otherNote'),
      releaseAmount: v('releaseAmount'), releaseNote: v('releaseNote'), recoveries: $$('#sheet [data-rec]').map((x) => ({ id: x.dataset.rec, amount: x.value })) };
    if (fin && sched) { d.areaRows = $$('#arows tr').map((r) => ({ name: r.querySelector('[data-a=name]').value, area: r.querySelector('[data-a=area]').value, factor: r.querySelector('[data-a=factor]').value })); d.extras = $$('#xrows .irow').map((r) => ({ name: r.querySelector('[data-x=name]').value, amount: r.querySelector('[data-x=amount]').value })); }
    else if (kind !== 'release') d.lines = $$('#sheet tr[data-it]').map((r) => { const raw = num(r.querySelector('[data-q]').value); const qv = sched && r.dataset.unit === 'stage' ? raw / 100 : raw; return fin ? { itemId: r.dataset.it, final: qv } : { itemId: r.dataset.it, qty: qv }; });
    return d;
  };
  let timer = null;
  const upd = () => {
    if (fin && sched) { let tot = 0; $$('#arows tr').forEach((r) => { const e = num(r.querySelector('[data-a=area]').value) * num(r.querySelector('[data-a=factor]').value) / 100; tot += e; r.querySelector('[data-eff]').textContent = e ? q(e, 0) : '–'; }); $('#areaTot').textContent = `Construction area counted: ${q(tot, 0)} sq ft (work order: ${q(w.area, 0)} sq ft approx.)`; }
    if (nc && !matTouched && kind === 'ra' && mr) {
      const lines = {}; $$('#sheet tr[data-it]').forEach((r) => { const raw = num(r.querySelector('[data-q]').value); lines[r.dataset.it] = sched && r.dataset.unit === 'stage' ? raw / 100 : raw; });
      const area = nc.prevArea + nc.sqftItems.reduce((a, id) => a + (lines[id] || 0) * ((nc.perUnit || {})[id] || 1), 0);
      let due = 0; for (const k of Object.keys(nc.norm)) if (nc.norm[k] > 0) due += Math.max(0, (nc.issued[k] || 0) - area * nc.norm[k] * (1 + (nc.pct[k] || 0) / 100)) * (nc.rate[k] || 0);
      mr.value = Math.round(Math.max(0, due - nc.before) + nc.periodDue) || '';
    }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const r = await api('POST', { op: 'bill_preview', id: b ? b.id : undefined, data: data() });
        $$('#sheet tr[data-it]').forEach((tr) => { const l = r.lines.find((x) => x.itemId === tr.dataset.it); tr.querySelector('[data-amt]').textContent = l ? inr(l.amount) : '–'; tr.querySelector('[data-amt]').className = 'n' + (l && l.over ? ' neg' : ''); });
        $('#tot').innerHTML = totalsBox({ ...r.totals, final: fin, kind });
      } catch (e) { /* the totals wait for valid figures */ }
    }, 250);
  };
  $('#sheet').addEventListener('input', upd); upd();
  const aa = $('#addArea'); if (aa) aa.onclick = () => { $('#arows').insertAdjacentHTML('beforeend', '<tr><td><input data-a="name" style="width:100%"></td><td class="n"><input data-a="area" inputmode="decimal" style="max-width:120px;text-align:right"></td><td class="n"><input data-a="factor" inputmode="decimal" value="100" style="max-width:70px;text-align:right"></td><td class="n" data-eff>–</td></tr>'); };
  const ax = $('#addX'); if (ax) ax.onclick = () => $('#xrows').insertAdjacentHTML('beforeend', '<div class="irow"><label class="field wide2">What<input data-x="name"></label><label class="field">Amount ₹<input data-x="amount" inputmode="decimal"></label><button type="button" class="x" data-rm>×</button></div>');
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('#xrows [data-rm]')) { e.target.closest('.irow').remove(); upd(); } });
  const save = async (submit) => {
    $$('#sheet .acts button').forEach((x) => (x.disabled = true));
    try {
      const r = await api('POST', { op: 'bill_save', id: b ? b.id : undefined, data: data() });
      if (submit) await api('POST', { op: 'bill_submit', id: r.bill.id, data: { note: $('#sheet [name=subNote]').value } });
      close(); tab = 'bills'; reload();
    } catch (e) { $$('#sheet .acts button').forEach((x) => (x.disabled = false)); sheetErr(e.message); }
  };
  $('#saveBill').onclick = () => save(false); $('#subBill').onclick = () => save(true);
  const del = $('#sheet [data-delbill]'); if (del) del.onclick = async () => { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; } try { await api('POST', { op: 'bill_delete', id: b.id }); close(); reload(); } catch (e) { sheetErr(e.message); } };
}
function showBill(id) {
  const b = D.bills[id], w = D.wos[b.woId], kind = b.kind || (b.final ? 'final' : 'ra');
  if (b.status === 'draft' && D.can.enter) return billForm(b.woId, b);
  const t = b.totals || {};
  const due = w.payDays && (b.billDate || b.submittedAt) ? new Date(Date.parse((b.billDate || b.submittedAt).slice(0, 10)) + w.payDays * 864e5).toISOString().slice(0, 10) : '';
  const rows = kind === 'release' ? '' : b.final && w.mode === 'schedule'
    ? `<div class="tbl"><table class="ltbl"><thead><tr><th>Floor / area type</th><th class="n">Measured</th><th class="n">%</th><th class="n">Counts as</th></tr></thead><tbody>${(b.areaRows || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${q(r.area, 0)}</td><td class="n">${r.factor}%</td><td class="n">${q(r.area * r.factor / 100, 0)}</td></tr>`).join('')}</tbody></table></div><p class="note" style="margin:0">${esc((b.lines[0] || {}).desc || '')}: final value ${inr((b.lines[0] || {}).finalValue)}, billed before ${inr((b.lines[0] || {}).billedBefore)}</p>`
    : `<div class="tbl"><table class="ltbl"><thead><tr><th>${w.mode === 'schedule' ? 'Stage' : 'Item'}</th><th class="n">${b.final ? 'Billed before' : 'Before'}</th><th class="n">${b.final ? 'Final measured' : 'This bill'}</th><th class="n">${b.final ? 'Difference' : 'Cumulative'}</th><th class="n">Amount</th></tr></thead><tbody>${(b.lines || []).filter((l) => l.qty || l.before).map((l) => { const f = (x) => (w.mode === 'schedule' && l.unit === 'stage' ? Math.round(x * 10000) / 100 + '%' : q(x)); return `<tr><td>${esc(l.desc)} <span class="note">(${esc(l.unit)})</span>${l.over ? ' <span class="flag">beyond work order</span>' : ''}</td><td class="n">${f(l.before)}</td><td class="n"><b>${f(b.final ? l.final : l.qty)}</b></td><td class="n">${f(b.final ? l.qty : l.cum)}</td><td class="n">${inr(l.amount)}</td></tr>`; }).join('')}</tbody></table></div>`;
  open(`<div class="top"><div><h3>${esc(b.no)} · ${esc(w.contractor)}</h3><span class="st ${b.status}">${LABEL[b.status]}</span></div><button class="x" data-close>×</button></div>
    <div class="kv"><div><small>Period</small>${day(b.from)} – ${day(b.to)}</div><div><small>Contractor's bill</small>${esc(b.billNo || '–')}${b.billDate ? ', ' + day(b.billDate) : ''}</div><div><small>Work order</small>${esc(w.no)} · ${esc(w.company)}</div><div><small>Entered by</small>${who(b.createdBy)}</div>${due && b.status !== 'paid' ? `<div><small>To pay by</small>${day(due)}</div>` : ''}</div>
    ${rows}${kind === 'release' && b.releaseNote ? `<p class="note" style="margin:0">${esc(b.releaseNote)}</p>` : ''}
    ${totalsBox({ ...t, final: b.final, kind })}${b.materialNote ? `<p class="note" style="margin:0">Material: ${esc(b.materialNote)}</p>` : ''}${b.otherNote ? `<p class="note" style="margin:0">Other deductions: ${esc(b.otherNote)}</p>` : ''}
    ${b.status === 'pending_approval' && D.can.approve ? `<div class="box"><h4>Management decision</h4><label class="field">Note (needed to send it back)<input name="note" maxlength="300"></label><div class="acts"><button class="btn warn" data-op="bill_reject">Send back</button><button class="btn go" data-op="bill_approve">Approve ${inr(t.net)}</button></div></div>` : ''}
    ${b.status === 'approved' && D.can.pay ? `<div class="box"><h4>Record payment</h4><div class="form"><label class="field">Amount paid ₹<input name="amount" inputmode="decimal" value="${Math.round(t.net)}"></label><label class="field">UTR / cheque no.<input name="ref" maxlength="80"></label><label class="field">Date<input type="date" name="date" value="${today()}"></label></div><div class="acts"><button class="btn go" data-op="bill_paid">Mark paid</button></div></div>` : ''}
    ${b.payment ? `<p class="chk">Paid ${inr(b.payment.amount)} on ${day(b.payment.date)}, ${esc(b.payment.ref)}</p>` : ''}
    <div><h4 style="margin:0 0 8px;font-size:15px">History</h4><ol class="tl">${(b.history || []).map((h) => `<li><time>${when(h.at)}</time><span><b>${esc(h.did)}</b> · ${who(h.by)}${h.note ? `<br><span class="note">${esc(h.note)}</span>` : ''}</span></li>`).join('')}</ol></div><p class="err"></p>`);
  $$('#sheet [data-op]').forEach((x) => (x.onclick = async () => {
    const data = {}; $$('#sheet .box [name]').forEach((el) => (data[el.name] = el.value));
    x.disabled = true;
    try { await api('POST', { op: x.dataset.op, id: b.id, data }); close(); reload(); } catch (e) { x.disabled = false; sheetErr(e.message); }
  }));
}
function pickWo() {
  const act = Object.values(D.wos).filter((w) => w.status === 'active');
  if (!act.length) { open(`<div class="top"><h3>New RA bill</h3><button class="x" data-close>×</button></div><p>${Object.keys(D.wos).length ? 'No approved work order yet. Management approves work orders first.' : 'Enter the contractor\'s work order first: its items and rates.'}</p><div class="acts"><button class="btn" data-close>OK</button></div>`); return; }
  if (act.length === 1) return billForm(act[0].id);
  open(`<div class="top"><h3>New RA bill: which work order?</h3><button class="x" data-close>×</button></div><div class="wos">${act.map((w) => `<button class="tile" data-billwo="${w.id}" style="text-align:left"><b style="font-size:17px">${esc(w.no)} · ${esc(w.contractor)}</b><span>${esc(w.scope || '')}</span></button>`).join('')}</div>`);
}

// ---------- wiring ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-bill],[data-editwo],[data-apwo],[data-billwo],[data-finalwo],[data-relwo],[data-st]'); if (!t) return;
  if (t.dataset.finalwo) return billForm(t.dataset.finalwo, null, 'final');
  if (t.dataset.relwo) return billForm(t.dataset.relwo, null, 'release');
  if (t.dataset.bill) showBill(t.dataset.bill);
  else if (t.dataset.editwo) woForm(D.wos[t.dataset.editwo]);
  else if (t.dataset.billwo) billForm(t.dataset.billwo);
  else if (t.dataset.apwo) api('POST', { op: 'wo_approve', id: t.dataset.apwo }).then(reload, (er) => { $('#pageErr').textContent = er.message; });
  else if (t.dataset.st) { if (t.dataset.st === 'wo') { tab = 'wos'; tileFilter = null; } else { tileFilter = tileFilter === t.dataset.st ? null : t.dataset.st; tab = 'bills'; } render(); }
});
$('#rows').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-bill]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showBill(tr.dataset.bill); } });
$('#fSt').addEventListener('input', () => { tileFilter = null; render(); });
$$('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
$('#newWo').addEventListener('click', () => woForm(null));
$('#newBill').addEventListener('click', pickWo);

Shell.init({ module: 'purchase', modsEl: document.getElementById('mods'), userEl: document.getElementById('user') }).then(async (me) => {
  if (!me) return;
  $('#main').hidden = false;
  try {
    D = await api('GET');
    $('#newWo').hidden = !D.can.enter; $('#newBill').hidden = !D.can.enter;
    if (Object.values(D.bills).some(waiting)) $('#fSt').value = 'mine';
    render();
  } catch (e) { $('#pageErr').textContent = e.message; }
});
