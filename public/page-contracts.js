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
    const billed = bs.reduce((a, b) => a + ((b.totals && b.totals.gross) || 0), 0), value = w.items.reduce((a, i) => a + i.rate * i.qty, 0);
    return `<div class="wo"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3>${esc(w.no)} · ${esc(w.contractor)}</h3><span class="st ${w.status}">${w.status === 'pending_approval' ? 'Waiting for Management' : LABEL[w.status]}</span></div>
      <div class="meta">${esc(w.scope || '')}${w.scope ? ' · ' : ''}${esc(w.company)} · ${w.items.length} item${w.items.length === 1 ? '' : 's'} · contract value ${inr(value)} · billed ${inr(billed)} · retention ${w.retentionPct}% · TDS ${w.tdsPct}%${w.advance ? ` · advance ${inr(w.advance)}` : ''}</div>
      <div class="acts" style="justify-content:flex-start">${D.can.enter || D.can.approve ? `<button class="btn small" data-editwo="${w.id}">${w.status === 'pending_approval' || D.can.approve ? 'Open / change' : 'Open'}</button>` : ''}${w.status === 'pending_approval' && D.can.approve ? `<button class="btn go small" data-apwo="${w.id}">Approve</button>` : ''}${w.status === 'active' && D.can.enter ? `<button class="btn small" data-billwo="${w.id}">New RA bill</button>` : ''}</div></div>`;
  }).join('') || '<p class="empty">No work orders yet.</p>';
}

// ---------- work order form ----------
function woForm(w) {
  const t = Object.entries(D.cast);
  const item = (it = {}) => `<div class="irow wi" data-item="${esc(it.id || '')}"><label class="field wide2">Item<input data-k="desc" value="${esc(it.desc)}" placeholder="e.g. RCC slab labour incl. shuttering"></label><label class="field">Unit<input data-k="unit" value="${esc(it.unit || 'sqm')}"></label>
    <label class="field">Rate ₹<input data-k="rate" inputmode="decimal" value="${it.rate ?? ''}"></label><label class="field">Contract qty<input data-k="qty" inputmode="decimal" value="${it.qty ?? ''}"></label>
    <label class="field">Count from slabs of<select data-k="tower"><option value="">— (enter by hand)</option>${t.map(([k, x]) => `<option value="${k}" ${it.link && it.link.tower === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><input data-k="perSlab" inputmode="decimal" value="${it.perSlab ?? ''}" placeholder="qty per slab (e.g. 850)" style="margin-top:4px"></label><button type="button" class="x" data-rm title="Remove">×</button></div>`;
  const locked = w && w.status !== 'pending_approval' && !D.can.approve;
  open(`<div class="top"><h3>${w ? esc(w.no) + ' · work order' : 'New work order'}</h3><button class="x" data-close>×</button></div>
    <div class="form"><label class="field">Contractor<input name="contractor" value="${esc(w && w.contractor)}" maxlength="120"></label><label class="field">Issued by<select name="company">${D.companies.map((c) => `<option ${(w ? w.company : 'Prime Realtors') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field wide">Scope<input name="scope" value="${esc(w && w.scope)}" maxlength="300" placeholder="e.g. RCC structure, Sale towers, labour only (RMC and steel by us)"></label>
      <label class="field">Work order date<input type="date" name="date" value="${esc(w ? w.date : today())}"></label><label class="field">Contractor PAN<input name="pan" value="${esc(w && w.pan)}" maxlength="10"></label>
      <label class="field">Retention %<input name="retentionPct" inputmode="decimal" value="${w ? w.retentionPct : 5}"></label><label class="field">TDS %<input name="tdsPct" inputmode="decimal" value="${w ? w.tdsPct : 1}"></label>
      <label class="field">Advance paid ₹<input name="advance" inputmode="decimal" value="${w ? w.advance || '' : ''}"></label><label class="field">Recover advance at % of each bill<input name="advanceRecoveryPct" inputmode="decimal" value="${w ? w.advanceRecoveryPct || '' : 10}"></label></div>
    <div class="box"><h4>RMC and steel we supply: allowed wastage</h4><div class="form">
      <label class="field">RMC allowed %<input name="w_rmcPct" inputmode="decimal" value="${w ? w.wastage.rmcPct : 2}"></label><label class="field">Recover RMC at ₹/m³<input name="w_rmcRate" inputmode="decimal" value="${w ? w.wastage.rmcRate || '' : ''}"></label>
      <label class="field">Steel allowed %<input name="w_steelPct" inputmode="decimal" value="${w ? w.wastage.steelPct : 3}"></label><label class="field">Recover steel at ₹/MT<input name="w_steelRate" inputmode="decimal" value="${w ? w.wastage.steelRate || '' : ''}"></label>
      <label class="field wide">Buildings this contractor works on<span style="display:flex;gap:14px;flex-wrap:wrap;font-weight:500">${t.map(([k, x]) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="tw" value="${k}" ${w && (w.towers || []).includes(k) ? 'checked' : ''} style="width:auto">${esc(x.name)}</label>`).join('')}</span></label></div>
      <p class="note" style="margin:0">Excess over the design quantity (logged by site with Material used) plus this allowance is suggested as a recovery on each RA bill.</p></div>
    <div class="box"><h4>Items</h4><div class="items" id="witems">${(w ? w.items : [{}]).map(item).join('')}</div><button type="button" class="addrow" id="addItem">+ Add item</button>
      <p class="note" style="margin:0">"Count from slabs" makes the RA bill suggest the slabs cast since the last bill (× the quantity per slab, e.g. 850 sqm).</p></div>
    <p class="err"></p>
    <div class="acts">${w && w.status === 'active' && D.can.approve ? `<button class="btn warn small" data-closewo>${'Close work order'}</button>` : w && w.status === 'closed' && D.can.approve ? '<button class="btn small" data-closewo>Reopen</button>' : ''}<button class="btn" data-close>Cancel</button>${locked ? '' : '<button class="btn go" id="saveWo">Save</button>'}</div>`);
  $('#addItem').onclick = () => $('#witems').insertAdjacentHTML('beforeend', item());
  $('#witems').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.irow').remove(); });
  const cw = $('#sheet [data-closewo]'); if (cw) cw.onclick = async () => { try { await api('POST', { op: 'wo_close', id: w.id }); close(); reload(); } catch (e) { sheetErr(e.message); } };
  const sv = $('#saveWo'); if (sv) sv.onclick = async () => {
    const v = (n) => ($(`#sheet [name=${n}]`) || {}).value;
    const data = { contractor: v('contractor'), company: v('company'), scope: v('scope'), date: v('date'), pan: v('pan'), retentionPct: v('retentionPct'), tdsPct: v('tdsPct'), advance: v('advance'), advanceRecoveryPct: v('advanceRecoveryPct'),
      wastage: { rmcPct: v('w_rmcPct'), rmcRate: v('w_rmcRate'), steelPct: v('w_steelPct'), steelRate: v('w_steelRate') }, towers: $$('#sheet [name=tw]:checked').map((x) => x.value),
      items: $$('#witems .irow').map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.item || undefined, desc: g('desc'), unit: g('unit'), rate: g('rate'), qty: g('qty'), link: g('tower') ? { tower: g('tower') } : null, perSlab: g('perSlab') }; }) };
    sv.disabled = true;
    try { await api('POST', { op: 'wo_save', id: w ? w.id : undefined, data }); close(); tab = 'wos'; reload(); } catch (e) { sv.disabled = false; sheetErr(e.message); }
  };
}

// ---------- RA bill ----------
function totalsBox(t) {
  return `<div class="sum"><span>Gross (work done this bill)</span><b>${inr(t.gross)}</b><span>Less retention</span><b>− ${inr(t.retention)}</b><span>Less TDS</span><b>− ${inr(t.tds)}</b>
    <span>Less advance recovery</span><b>− ${inr(t.advance)}</b><span>Less material recovery</span><b>− ${inr(t.material)}</b><span>Less other deductions</span><b>− ${inr(t.other)}</b><span class="net">Net payable</span><b class="net">${inr(t.net)}</b></div>`;
}
// The same sums as the server, for the live preview while typing.
function preview(w, b, lines, mat, oth) {
  const prev = {}; for (const x of Object.values(D.bills)) if (x.woId === w.id && x.id !== (b && b.id) && !['rejected', 'cancelled'].includes(x.status) && (!b || x.seq < b.seq)) for (const l of x.lines || []) prev[l.itemId] = (prev[l.itemId] || 0) + (+l.qty || 0);
  const gross = w.items.reduce((a, it) => a + Math.round((lines[it.id] || 0) * it.rate * 100) / 100, 0);
  const advDone = Object.values(D.bills).filter((x) => x.woId === w.id && x.id !== (b && b.id) && !['rejected', 'cancelled'].includes(x.status)).reduce((a, x) => a + ((x.totals && x.totals.advance) || 0), 0);
  const advance = Math.min(Math.max(0, (w.advance || 0) - advDone), gross * (w.advanceRecoveryPct || 0) / 100);
  const t = { gross, retention: gross * w.retentionPct / 100, tds: gross * w.tdsPct / 100, advance, material: mat, other: oth };
  t.net = t.gross - t.retention - t.tds - t.advance - t.material - t.other;
  return { prev, t };
}
async function billForm(woId, b) {
  const w = D.wos[woId];
  const lastTo = Object.values(D.bills).filter((x) => x.woId === woId && x.id !== (b && b.id)).map((x) => x.to).sort().pop();
  const from = b ? b.from : lastTo ? new Date(Date.parse(lastTo) + 864e5).toISOString().slice(0, 10) : w.date, to = b ? b.to : (today() > from ? today() : from);
  let sg = null;
  if (!b) { try { sg = (await api('GET', null, `&suggest=${woId}&from=${from}&to=${to}`)).suggestion; } catch (e) { sg = null; } }
  const qOf = (it) => b ? ((b.lines || []).find((l) => l.itemId === it.id) || {}).qty || '' : sg && sg.qty[it.id] != null ? sg.qty[it.id] : '';
  open(`<div class="top"><h3>${b ? esc(b.no) : 'New RA bill'} · ${esc(w.contractor)}</h3><button class="x" data-close>×</button></div>
    <p class="note" style="margin:0">${esc(w.no)} · ${esc(w.scope || '')} · retention ${w.retentionPct}% · TDS ${w.tdsPct}%${w.advance ? ` · advance ${inr(w.advance)} recovered at ${w.advanceRecoveryPct}% of each bill` : ''}</p>
    <div class="form"><label class="field">Period from<input type="date" name="from" value="${esc(from)}"></label><label class="field">Period to<input type="date" name="to" value="${esc(to)}"></label>
      <label class="field">Contractor's bill no.<input name="billNo" value="${esc(b && b.billNo)}" maxlength="60"></label><label class="field">Bill date<input type="date" name="billDate" value="${esc(b && b.billDate)}"></label></div>
    ${sg && Object.keys(sg.qty).length ? '<p class="sugg">Quantities for slab items are suggested from the slabs site marked cast since the last bill. Check them before saving.</p>' : ''}
    <div class="tbl"><table class="ltbl"><thead><tr><th>Item</th><th class="n">Rate</th><th class="n">Contract</th><th class="n">Previous</th><th class="n">This bill</th><th class="n">Cumulative</th><th class="n">Amount</th></tr></thead><tbody>
      ${w.items.map((it) => `<tr data-it="${it.id}"><td>${esc(it.desc)} <span class="note">(${esc(it.unit)})</span></td><td class="n">${inr(it.rate)}</td><td class="n">${q(it.qty)}</td><td class="n" data-prev>–</td><td class="n"><input data-q inputmode="decimal" value="${qOf(it)}" style="max-width:110px;text-align:right"></td><td class="n" data-cum>–</td><td class="n" data-amt>–</td></tr>`).join('')}
    </tbody></table></div>
    <div class="form"><label class="field">Material recovery ₹<input name="materialRecovery" inputmode="decimal" value="${b ? b.materialRecovery || '' : sg && sg.material ? sg.material : ''}"></label><label class="field wide">Material recovery note<input name="materialNote" maxlength="200" value="${esc(b ? b.materialNote : sg ? sg.materialNote : '')}"></label>
      <label class="field">Other deductions ₹<input name="otherDeduction" inputmode="decimal" value="${b ? b.otherDeduction || '' : ''}"></label><label class="field wide">Other deductions note<input name="otherNote" maxlength="200" value="${esc(b && b.otherNote)}" placeholder="e.g. labour camp electricity"></label></div>
    <label class="field">Note for Management (needed if an item goes beyond the work order)<input name="subNote" maxlength="300"></label>
    <div id="tot"></div><p class="err"></p>
    <div class="acts">${b ? '<button class="btn warn small" data-delbill>Delete draft</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn" id="saveBill">Save draft</button><button class="btn go" id="subBill">Save and submit to Management</button></div>`);
  const upd = () => {
    const lines = {}; $$('#sheet tr[data-it]').forEach((r) => (lines[r.dataset.it] = num(r.querySelector('[data-q]').value)));
    const { prev, t } = preview(w, b, lines, num($('#sheet [name=materialRecovery]').value), num($('#sheet [name=otherDeduction]').value));
    $$('#sheet tr[data-it]').forEach((r) => { const it = w.items.find((x) => x.id === r.dataset.it), p = prev[it.id] || 0, c = p + (lines[it.id] || 0);
      r.querySelector('[data-prev]').textContent = q(p); const cu = r.querySelector('[data-cum]'); cu.textContent = q(c); cu.className = 'n' + (it.qty && c > it.qty ? ' neg' : ''); r.querySelector('[data-amt]').textContent = inr((lines[it.id] || 0) * it.rate); });
    $('#tot').innerHTML = totalsBox(t);
  };
  $('#sheet').addEventListener('input', upd); upd();
  const data = () => { const v = (n) => $(`#sheet [name=${n}]`).value; return { woId, from: v('from'), to: v('to'), billNo: v('billNo'), billDate: v('billDate'), materialRecovery: v('materialRecovery'), materialNote: v('materialNote'), otherDeduction: v('otherDeduction'), otherNote: v('otherNote'),
    lines: $$('#sheet tr[data-it]').map((r) => ({ itemId: r.dataset.it, qty: r.querySelector('[data-q]').value })) }; };
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
  const b = D.bills[id], w = D.wos[b.woId];
  if (b.status === 'draft' && D.can.enter) return billForm(b.woId, b);
  const t = b.totals || {};
  open(`<div class="top"><div><h3>${esc(b.no)} · ${esc(w.contractor)}</h3><span class="st ${b.status}">${LABEL[b.status]}</span></div><button class="x" data-close>×</button></div>
    <div class="kv"><div><small>Period</small>${day(b.from)} – ${day(b.to)}</div><div><small>Contractor's bill</small>${esc(b.billNo || '–')}${b.billDate ? ', ' + day(b.billDate) : ''}</div><div><small>Work order</small>${esc(w.no)} · ${esc(w.company)}</div><div><small>Entered by</small>${who(b.createdBy)}</div></div>
    <div class="tbl"><table class="ltbl"><thead><tr><th>Item</th><th class="n">Rate</th><th class="n">Previous</th><th class="n">This bill</th><th class="n">Cumulative</th><th class="n">Amount</th></tr></thead><tbody>${(b.lines || []).filter((l) => l.qty || l.before).map((l) => `<tr><td>${esc(l.desc)} <span class="note">(${esc(l.unit)})</span>${l.over ? ' <span class="flag">beyond work order</span>' : ''}</td><td class="n">${inr(l.rate)}</td><td class="n">${q(l.before)}</td><td class="n"><b>${q(l.qty)}</b></td><td class="n">${q(l.cum)}</td><td class="n">${inr(l.amount)}</td></tr>`).join('')}</tbody></table></div>
    ${totalsBox(t)}${b.materialNote ? `<p class="note" style="margin:0">Material recovery: ${esc(b.materialNote)}</p>` : ''}${b.otherNote ? `<p class="note" style="margin:0">Other deductions: ${esc(b.otherNote)}</p>` : ''}
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
  const t = e.target.closest('[data-bill],[data-editwo],[data-apwo],[data-billwo],[data-st]'); if (!t) return;
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
