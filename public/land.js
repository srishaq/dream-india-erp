// Land and title (staff): land parcels, deeds, land cost and payments, title papers, and the landowner's share
// under a JDA. Data from /api/land (lib/land.js). Mounted by app.js: window.Land.render(ctx, projectId, tab).
(function () {
  let C = null, P = null, D = null, tab = 'land';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
  const rs = (v) => '₹' + nf(Math.round(Number(v) || 0));
  const cr = (v) => (Math.abs(v) >= 1e7 ? '₹' + nf(v / 1e7, 2) + ' Cr' : Math.abs(v) >= 1e5 ? '₹' + nf(v / 1e5, 2) + ' L' : rs(v));
  const dd = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const ST_TONE = { negotiation: 'grey', agreement: 'warn', registered: 'good', mutated: 'good' };
  const TABS = [['land', 'Land and title'], ['share', 'Landowner share']];
  const css = `
  .lnd .lnd-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.lnd .lnd-tabs a{padding:7px 14px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink-2);font-weight:600;font-size:14px;text-decoration:none}
  .lnd .lnd-tabs a.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .lnd .lnd-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:0 0 14px}
  .lnd .lnd-k div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px}.lnd .lnd-k b{display:block;font-size:21px;color:var(--brand)}.lnd .lnd-k span{font-size:12.5px;color:var(--ink-3)}
  .lnd .lnd-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
  .lnd table tr[data-id]{cursor:pointer}.lnd table tr[data-id]:hover td{background:#F6FAF9}
  .lnd td .sm{font-size:12px;color:var(--ink-3);display:block}.lnd td .gap{font-size:12px;color:#B3261E;display:block}
  .lnd .lnd-units{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.lnd .lnd-units span{background:var(--brand-tint);border-radius:8px;padding:4px 8px;font-size:13px}
  .lnd .empty{padding:28px;text-align:center;color:var(--ink-3)}
  .lnd-files{display:grid;gap:6px;margin:6px 0 10px}.lnd-files div{display:flex;gap:8px;align-items:center;font-size:13.5px;flex-wrap:wrap}
  .lnd-pick{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px}
  `;
  let plot = false, FW = 'flats';
  const kind = () => { plot = !!(D && D.project && D.project.kind === 'plotted'); FW = plot ? 'plots' : 'flats'; return D; };
  async function load() { D = await C.api('/api/land?project=' + P); kind(); }
  async function post(body) { D = await C.api('/api/land', { project: P, ...body }); return kind(); }
  const read = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
  const blob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
  // plots: land bought in acres, shown also in sq yd (the unit plots are sold in); otherwise in sq m
  const area = (x) => (x.area == null ? '' : `${nf(x.area, 4)} ${D.labels.units[x.area_unit]}${plot ? (x.area_unit !== 'sqyd' ? `<span class="sm">${nf(x.sqm / 0.83612736, 0)} sq yd</span>` : '') : x.area_unit !== 'sqm' ? `<span class="sm">${nf(x.sqm, 2)} sq m</span>` : ''}`);

  function shell(inner) {
    const p = D.project;
    return `<div class="lnd"><style>${css}</style>
      <div class="page-head"><div><a class="muted small" href="#/project/${p.id}">← ${esc(p.name)}</a><h1>${esc(TABS.find((t) => t[0] === tab)[1])}</h1>
        <p class="muted">${D.summary.parcels} land parcel${D.summary.parcels === 1 ? '' : 's'} · ${plot ? `${nf(D.summary.acres, 3)} acres (${nf(D.summary.sqm / 0.83612736, 0)} sq yd)` : `${nf(D.summary.sqm, 2)} sq m (${nf(D.summary.acres, 3)} acres)`}</p></div></div>
      <nav class="lnd-tabs">${TABS.map(([k, l]) => `<a href="#/land/${p.id}${k === 'land' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>${inner}</div>`;
  }
  const kpis = (list) => `<div class="lnd-k">${list.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>`;

  function landTab() {
    const s = D.summary, L = D.labels;
    return shell(`${kpis([[nf(s.acres, 3), 'Acres in all'], [cr(s.total), 'Land cost with stamp duty and registration'], [cr(s.paid), 'Paid to owners'], [cr(s.balance), 'Still to pay'], [`${s.registered} of ${s.parcels}`, 'Deeds registered'], [s.gaps, 'Parcels missing a paper']])}
      <div class="lnd-tools">${D.canEdit ? '<button id="lAdd">Add land parcel</button><button class="ghost" id="lXl">Download Excel</button><button class="ghost" id="lUp">Upload Excel</button><input type="file" id="lF" accept=".xlsx,.csv" hidden>' : '<button class="ghost" id="lXl">Download Excel</button>'}</div>
      <div class="panel"><div class="table-wrap"><table><tr><th>Survey / CTS</th><th>Area</th><th>Deal</th><th>Status</th><th class="num">Land cost</th><th class="num">Paid</th><th>Papers</th></tr>
      ${D.parcels.map((x) => `<tr data-id="${x.id}"><td><b>${esc(x.survey_no)}</b><span class="sm">${esc([x.village, x.taluka, x.district].filter(Boolean).join(', '))}</span>${x.owners ? `<span class="sm">${esc(x.owners)}</span>` : ''}</td><td>${area(x)}</td>
        <td>${esc(L.deals[x.deal])}${x.share_type !== 'none' ? `<span class="sm">Landowner ${x.share_pct}% ${x.share_type === 'area' ? 'of ' + FW : 'of sales'}</span>` : ''}</td>
        <td><span class="pill ${ST_TONE[x.status]}">${esc(L.status[x.status])}</span>${x.deal_date ? `<span class="sm">${dd(x.deal_date)}${x.deed_ref ? ' · ' + esc(x.deed_ref) : ''}</span>` : ''}</td>
        <td class="num">${x.cost != null ? rs(x.cost) : ''}</td><td class="num">${x.paid ? rs(x.paid) : ''}${x.balance ? `<span class="sm">${rs(x.balance)} to pay</span>` : ''}</td>
        <td style="min-width:150px">${x.files.length ? `📎 ${x.files.length}` : ''}${x.missing.length ? `<span class="gap">No ${esc(x.missing.join(', '))}</span>` : ''}</td></tr>`).join('')}
      </table>${D.parcels.length ? '' : '<div class="empty">No land yet. Add each survey or CTS number with its area, owners and deed, or fill the Excel and upload it.</div>'}</div></div>`);
  }

  function shareTab() {
    const jda = D.parcels.filter((x) => x.share_type !== 'none');
    return shell(`${kpis([[jda.length, 'Parcels under joint development'], [D.summary.ownerUnits, 'Flats set aside for landowners'], [D.free.length, 'Flats still available']])}
      ${jda.length ? jda.map((x) => `<div class="panel"><div class="page-head" style="margin:0 0 8px"><div><h2 style="margin:0">Survey ${esc(x.survey_no)}${x.village ? ', ' + esc(x.village) : ''}</h2>
          <p class="muted small" style="margin:2px 0 0">${esc(x.owners || 'Owners not given')} · ${x.share_pct}% ${x.share_type === 'area' ? 'of the ' + FW : 'of sales revenue'}</p></div>
          ${D.canEdit && x.share_type === 'area' ? `<button data-give="${x.id}">Set aside ${FW}</button>` : ''}</div>
        ${x.share_type === 'revenue' ? '<p class="small muted">A revenue share is paid out of collections. Record each payment to the landowner under Land and title.</p>' : x.units.length ? `<div class="table-wrap"><table><tr><th>Flat</th><th>Type</th><th class="num">Carpet (sq ft)</th><th>For</th><th></th></tr>${x.units.map((u) => `<tr><td><b>${esc(u.unit_no)}</b><span class="sm">Tower ${esc(u.building)}</span></td><td>${esc(u.typology)}</td><td class="num">${u.carpet_sqft ?? ''}</td><td>${esc(u.owner_name)}</td><td class="num">${D.canEdit ? `<button class="ghost small" data-free="${u.id}">Release</button>` : ''}</td></tr>`).join('')}
          <tr><td colspan="2"><b>${x.units.length} ${FW}</b></td><td class="num"><b>${nf(x.units.reduce((a, u) => a + (u.carpet_sqft || 0), 0))}</b></td><td colspan="2"></td></tr></table></div>` : '<p class="small muted">No flats set aside yet. Flats set aside are kept blocked so sales cannot book them.</p>'}</div>`).join('')
      : '<div class="panel empty">No parcel is under joint development. Open a parcel under Land and title, choose "Joint development (JDA)" and give the landowner\'s share.</div>'}`);
  }

  function form(x) {
    const L = D.labels, ed = D.canEdit;
    const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const dl = C.dialog(`<h2>${x ? 'Survey ' + esc(x.survey_no) : 'Add land parcel'}</h2>
      <div class="row"><div><label>Survey / CTS / plot number</label><input name="survey_no" value="${esc(x?.survey_no)}" required maxlength="60" placeholder="112/2A"></div><div><label>Village</label><input name="village" value="${esc(x?.village)}" maxlength="80"></div></div>
      <div class="row"><div><label>Taluka</label><input name="taluka" value="${esc(x?.taluka)}" maxlength="80"></div><div><label>District</label><input name="district" value="${esc(x?.district)}" maxlength="80"></div></div>
      <div class="row"><div><label>Area</label><input name="area" inputmode="decimal" value="${x?.area ?? ''}"></div><div><label>Unit</label><select name="area_unit">${opt(L.units, x?.area_unit || 'acre')}</select></div></div>
      <label>Owners (as on the 7/12 or property card)</label><input name="owners" value="${esc(x?.owners)}" maxlength="500">
      <div class="row"><div><label>Deal</label><select name="deal" id="lDeal">${opt(L.deals, x?.deal || 'purchase')}</select></div><div><label>Status</label><select name="status">${opt(L.status, x?.status || 'negotiation')}</select></div></div>
      <div class="row" id="lShare"><div><label>Landowner's share</label><select name="share_type">${opt(L.share, x?.share_type || 'area')}</select></div><div><label>Share %</label><input name="share_pct" inputmode="decimal" value="${x?.share_pct ?? ''}"></div></div>
      <div class="row"><div><label>Deed date</label><input type="date" name="deal_date" value="${esc(x?.deal_date || '')}"></div><div><label>Deed / document number</label><input name="deed_ref" value="${esc(x?.deed_ref)}" maxlength="120" placeholder="e.g. 4567/2024, sub-registrar office"></div></div>
      <div class="row"><div><label>Land cost (₹)</label><input name="cost" inputmode="numeric" value="${x?.cost ?? ''}"></div><div><label>Stamp duty (₹)</label><input name="stamp_duty" inputmode="numeric" value="${x?.stamp_duty ?? ''}"></div><div><label>Registration fee (₹)</label><input name="registration_fee" inputmode="numeric" value="${x?.registration_fee ?? ''}"></div></div>
      <label>Title note (search report findings, encumbrances, pending mutation)</label><input name="title_note" value="${esc(x?.title_note)}" maxlength="1000">
      <label>Remark</label><input name="remark" value="${esc(x?.remark)}" maxlength="500">
      ${x ? `<h3 style="margin:14px 0 4px">Payments to the owners · ${rs(x.paid)} of ${x.cost != null ? rs(x.cost) : '—'}</h3>
        <div class="lnd-files">${x.payments.map((y) => `<div>${dd(y.paid_on)} · <b>${rs(y.amount)}</b> · ${esc(L.modes[y.mode])} ${esc(y.ref)}${y.payee ? ' · to ' + esc(y.payee) : ''}${ed ? ` <button type="button" class="ghost small danger" data-unpay="${y.id}">Remove</button>` : ''}</div>`).join('') || '<span class="small muted">No payment yet.</span>'}</div>
        ${ed ? '<button type="button" class="ghost small" id="lPay">Add a payment</button>' : ''}
        <h3 style="margin:14px 0 4px">Papers</h3><div class="lnd-files">${x.files.map((f) => `<div><span class="pill grey">${esc(L.files[f.kind])}</span><button type="button" class="ghost small" data-open="${f.id}">${esc(f.name)}</button><span class="small muted">${kb(f.size)}</span>${ed ? `<button type="button" class="ghost small danger" data-rm="${f.id}">Remove</button>` : ''}</div>`).join('') || '<span class="small muted">No paper yet.</span>'}</div>
        ${ed ? `<div class="row" style="align-items:end"><div><label>Paper</label><select id="lKind">${opt(L.files, 'deed')}</select></div><div><button type="button" class="ghost small" id="lFile">Add the file (PDF, JPG or PNG, up to 3 MB)</button><input type="file" id="lFileI" accept="application/pdf,image/jpeg,image/png" hidden></div></div>` : ''}
        ${ed && !x.payments.length && !x.units.length ? '<p class="small" style="margin-top:12px"><button type="button" class="ghost danger" id="lDel">Remove this parcel</button></p>' : ''}` : ''}`,
    async (v) => { if (!ed) return; await post({ action: 'save', parcel: { ...v, id: x?.id } }); C.toast('Saved.'); paint(); });
    const sh = () => { $('#lShare', dl).hidden = $('#lDeal', dl).value !== 'jda'; };
    $('#lDeal', dl).onchange = sh; sh();
    if (!ed) { const s = $('[value=save]', dl); if (s) s.hidden = true; $$('input,select', dl).forEach((i) => (i.disabled = true)); }
    const again = () => { dl.close(); dl.remove(); paint(); form(D.parcels.find((y) => y.id === x.id)); };
    $$('[data-open]', dl).forEach((b) => (b.onclick = async () => {
      try { const f = await C.api(`/api/land?project=${P}&file=${b.dataset.open}`); const u = URL.createObjectURL(blob(f.data, f.type)); const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); } catch (e) { C.toast(e.message); }
    }));
    $$('[data-rm]', dl).forEach((b) => (b.onclick = async () => { if (!(await zConfirm('Remove this paper?'))) return; try { await post({ action: 'file.remove', id: +b.dataset.rm }); again(); } catch (e) { C.toast(e.message); } }));
    $$('[data-unpay]', dl).forEach((b) => (b.onclick = async () => { if (!(await zConfirm('Remove this payment? Do this only for one entered by mistake.'))) return; try { await post({ action: 'unpay', id: +b.dataset.unpay }); again(); } catch (e) { C.toast(e.message); } }));
    const lf = $('#lFile', dl), li = $('#lFileI', dl);
    if (lf) lf.onclick = () => { li.value = ''; li.click(); };
    if (li) li.onchange = async () => {
      const f = li.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { C.toast('The file is larger than 3 MB. Please scan it at a lower resolution.'); return; }
      try { await post({ action: 'file.add', parcel: x.id, file: { name: f.name, kind: $('#lKind', dl).value, data: await read(f) } }); C.toast('Paper added.'); again(); } catch (e) { C.toast(e.message); }
    };
    const lp = $('#lPay', dl); if (lp) lp.onclick = () => { dl.close(); dl.remove(); payForm(x); };
    const del = $('#lDel', dl); if (del) del.onclick = async () => { if (!(await zConfirm(`Remove survey ${x.survey_no}?`))) return; try { await post({ action: 'delete', id: x.id }); dl.close(); dl.remove(); paint(); } catch (e) { C.toast(e.message); } };
  }
  function payForm(x) {
    const opt = Object.entries(D.labels.modes).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    C.dialog(`<h2>Payment for survey ${esc(x.survey_no)}</h2><p class="small muted">Balance ${rs(x.balance)} of ${x.cost != null ? rs(x.cost) : '—'}</p>
      <div class="row"><div><label>Paid on</label><input type="date" name="paid_on" required></div><div><label>Amount (₹)</label><input name="amount" inputmode="numeric" required></div></div>
      <div class="row"><div><label>Paid to</label><input name="payee" value="${esc((x.owners || '').split(',')[0])}" maxlength="120"></div><div><label>Mode</label><select name="mode">${opt}</select></div><div><label>UTR / cheque number</label><input name="ref" maxlength="60"></div></div>
      <label>Note</label><input name="note" maxlength="300">`,
    async (v) => { await post({ action: 'pay', parcel: x.id, ...v }); C.toast('Payment saved.'); paint(); form(D.parcels.find((y) => y.id === x.id)); });
  }
  function giveForm(x) {
    if (!D.free.length) { C.toast('No available flats. Upload the inventory first (Set up your project).'); return; }
    C.dialog(`<h2>Set aside flats for the landowner</h2><p class="small muted">Survey ${esc(x.survey_no)} · ${x.share_pct}% of the flats. The flats you tick are kept blocked so sales cannot book them.</p>
      <label>For (landowner's name)</label><input name="owner" value="${esc(x.owners)}" maxlength="120">
      <div class="lnd-pick">${D.free.map((u) => `<label class="check"><input type="checkbox" name="u" value="${u.id}"> ${esc(u.unit_no)} <span class="small muted">${esc(u.typology)}${u.carpet_sqft ? ' · ' + u.carpet_sqft : ''}</span></label>`).join('')}</div>`,
    async (v, f) => {
      const units = $$('input[name=u]:checked', f).map((i) => +i.value);
      await post({ action: 'share', parcel: x.id, units, owner: v.owner }); C.toast(`${units.length} flat${units.length === 1 ? '' : 's'} set aside.`); paint();
    });
  }

  function paint() {
    $('#page').innerHTML = tab === 'share' ? shareTab() : landTab();
    $$('tr[data-id]').forEach((tr) => (tr.onclick = () => form(D.parcels.find((x) => x.id === +tr.dataset.id))));
    $$('[data-give]').forEach((b) => (b.onclick = () => giveForm(D.parcels.find((x) => x.id === +b.dataset.give))));
    $$('[data-free]').forEach((b) => (b.onclick = async () => { if (!(await zConfirm('Release this flat from the landowner\'s share? It becomes available for sale.'))) return; try { await post({ action: 'unshare', id: +b.dataset.free }); paint(); } catch (e) { C.toast(e.message); } }));
    if ($('#lAdd')) $('#lAdd').onclick = () => form(null);
    if ($('#lXl')) $('#lXl').onclick = async () => { try { const r = await C.api(`/api/land?project=${P}&excel=1`); const a = document.createElement('a'); a.href = URL.createObjectURL(blob(r.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { C.toast(e.message); } };
    const fi = $('#lF');
    if ($('#lUp')) $('#lUp').onclick = () => { fi.value = ''; fi.click(); };
    if (fi) fi.onchange = async () => {
      const f = fi.files[0]; if (!f) return;
      try { const r = await post({ action: 'import', file: { name: f.name, data: await read(f) } }); C.toast(`${r.imported.added} added, ${r.imported.updated} updated.`); paint(); }
      catch (e) { if (e.data && e.data.problems) C.dialog(`<h2>Nothing was saved</h2><p>${esc(e.message)}</p><ul>${e.data.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, async () => {}); else C.toast(e.message); }
    };
  }

  async function render(ctx, projectId, t) {
    C = ctx; P = projectId; tab = t === 'share' ? 'share' : 'land';
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    await load(); paint();
  }
  window.Land = { render };
})();
