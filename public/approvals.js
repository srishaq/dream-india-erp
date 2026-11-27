// Approvals dashboard (staff): every permission a project needs in one place, from /api/approvals (lib/approvals.js).
// Mounted by app.js: window.Approvals.render(ctx, projectId).
(function () {
  let C = null, P = null, D = null, only = '';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dd = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const TONE = { not_started: 'grey', applied: 'warn', query: 'bad', received: 'good', not_needed: 'grey' };
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const css = `
  .apv .apv-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 0 14px}
  .apv .apv-k button{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:left;cursor:pointer;color:inherit;font:inherit}
  .apv .apv-k button.on{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-tint)}
  .apv .apv-k b{display:block;font-size:22px;color:var(--brand)}.apv .apv-k span{font-size:12.5px;color:var(--ink-3)}
  .apv .apv-k .bad b{color:#B3261E}
  .apv .apv-bar{height:12px;border-radius:99px;background:#EEF2F4;overflow:hidden;margin:6px 0 4px;max-width:520px}.apv .apv-bar i{display:block;height:100%;background:var(--brand)}
  .apv .apv-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
  .apv table{table-layout:fixed;min-width:760px}.apv th:nth-child(1){width:34%}.apv th:nth-child(2){width:13%}.apv th:nth-child(3){width:18%}.apv th:nth-child(4){width:17%}.apv th:nth-child(5){width:12%}.apv th:nth-child(6){width:6%}
  .apv td{overflow-wrap:anywhere}
  .apv h2.st{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:18px 0 8px}
  .apv table tr[data-k]{cursor:pointer}.apv table tr[data-k]:hover td{background:#F6FAF9}
  .apv td .sm{font-size:12px;color:var(--ink-3);display:block}.apv td.nn{opacity:.55}
  .apv .warnline{color:#B3261E;font-weight:600;font-size:12.5px;display:block}
  .apv-files{display:grid;gap:6px;margin:6px 0 10px}.apv-files div{display:flex;gap:8px;align-items:center;font-size:13.5px}
  `;

  async function load() { D = await C.api('/api/approvals?project=' + P); }
  async function post(body) { D = await C.api('/api/approvals', { project: P, ...body }); return D; }
  const read = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
  const blob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

  const match = (x) => !only || (only === 'alert' ? !!x.alert : only === 'open' ? ['applied', 'query'].includes(x.status) : x.status === only);
  function row(x) {
    const when = x.status === 'received' ? `Received ${dd(x.received_on)}` : x.applied_on ? `Applied ${dd(x.applied_on)}` : '';
    return `<tr data-k="${esc(x.key)}"><td class="${x.status === 'not_needed' ? 'nn' : ''}"><b>${esc(x.title)}</b>${x.authority ? `<span class="sm">${esc(x.authority)}</span>` : ''}</td>
      <td><span class="pill ${TONE[x.status]}">${esc(D.labels[x.status])}</span></td><td>${esc(when)}</td><td>${esc(x.ref_no)}</td>
      <td>${x.valid_till ? dd(x.valid_till) : ''}${x.alert === 'expired' ? '<span class="warnline">Expired</span>' : x.alert === 'expiring' ? '<span class="warnline">Renew soon</span>' : ''}</td>
      <td>${x.files.length ? `📎 ${x.files.length}` : ''}</td></tr>`;
  }
  function paint() {
    const p = D.project, s = D.summary, pct = s.total ? Math.round((s.received / s.total) * 100) : 0;
    const k = (key, v, l, bad) => `<button type="button" data-only="${key}" class="${only === key ? 'on' : ''} ${bad && v ? 'bad' : ''}"><b>${v}</b><span>${esc(l)}</span></button>`;
    const groups = D.stages.map(([st, label]) => [label, D.list.filter((x) => x.stage === st && match(x))]).filter(([, l]) => l.length);
    $('#page').innerHTML = `<div class="apv"><style>${css}</style>
      <div class="page-head"><div><a class="muted small" href="#/project/${p.id}">← ${esc(p.name)}</a><h1>Approvals</h1>
        <p class="muted">${s.received} of ${s.total} received${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}. Tap an approval to fill in its dates and keep its letter.</p><div class="apv-bar"><i style="width:${pct}%"></i></div></div></div>
      <div class="apv-k">${k('received', s.received, 'Received')}${k('open', s.applied + s.query, 'Applied, waiting')}${k('query', s.query, 'Query raised', true)}${k('not_started', s.not_started, 'Not applied yet')}${k('alert', s.expiring + s.expired, 'Expired or renew soon', true)}</div>
      <div class="apv-tools">${only ? '<button class="ghost small" id="apvAll">Show all</button>' : ''}${D.canEdit ? '<button id="apvAdd">Add another approval</button><button class="ghost" id="apvXl">Download Excel</button><button class="ghost" id="apvUp">Upload Excel</button><input type="file" id="apvF" accept=".xlsx,.csv" hidden>' : ''}</div>
      ${groups.map(([label, l]) => `<h2 class="st">${esc(label)}</h2><div class="panel" style="padding:0"><div class="table-wrap"><table><tr><th>Approval</th><th>Status</th><th>Date</th><th>Reference</th><th>Valid till</th><th>Files</th></tr>${l.map(row).join('')}</table></div></div>`).join('') || '<div class="panel muted">Nothing matches.</div>'}
    </div>`;
    $$('[data-only]').forEach((b) => (b.onclick = () => { only = only === b.dataset.only ? '' : b.dataset.only; paint(); }));
    if ($('#apvAll')) $('#apvAll').onclick = () => { only = ''; paint(); };
    $$('tr[data-k]').forEach((tr) => (tr.onclick = () => form(D.list.find((x) => x.key === tr.dataset.k))));
    if (!D.canEdit) return;
    $('#apvAdd').onclick = () => form(null);
    $('#apvXl').onclick = async () => { try { const r = await C.api(`/api/approvals?project=${P}&excel=1`); const a = document.createElement('a'); a.href = URL.createObjectURL(blob(r.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { C.toast(e.message); } };
    const fi = $('#apvF');
    $('#apvUp').onclick = () => { fi.value = ''; fi.click(); };
    fi.onchange = async () => {
      const f = fi.files[0]; if (!f) return;
      try { const r = await post({ action: 'import', file: { name: f.name, data: await read(f) } }); C.toast(`${r.imported.saved} approval${r.imported.saved === 1 ? '' : 's'} saved from Excel.`); paint(); }
      catch (e) { if (e.data && e.data.problems) C.dialog(`<h2>Nothing was saved</h2><p>${esc(e.message)}</p><ul>${e.data.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, async () => {}); else C.toast(e.message); }
    };
  }

  function form(x) {
    const ed = D.canEdit, L = D.labels, custom = !x || x.custom;
    const dl = C.dialog(`<h2>${x ? esc(x.title) : 'Add an approval'}</h2>
      ${custom ? `<label>Name of the approval</label><input name="title" value="${esc(x?.title)}" required maxlength="120" placeholder="e.g. MOEF amendment, Railway NOC">
        <label>Section</label><select name="stage">${D.stages.map(([k, l]) => `<option value="${k}" ${(x?.stage || 'other') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
      <div class="row"><div><label>Status</label><select name="status">${Object.entries(L).map(([k, l]) => `<option value="${k}" ${(x?.status || 'not_started') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label>Authority</label><input name="authority" value="${esc(x?.authority)}" maxlength="120"></div></div>
      <div class="row"><div><label>Applied on</label><input type="date" name="applied_on" value="${esc(x?.applied_on || '')}"></div><div><label>Received on</label><input type="date" name="received_on" value="${esc(x?.received_on || '')}"></div>
        <div><label>Valid till${x && x.validity ? '' : ' (if it expires)'}</label><input type="date" name="valid_till" value="${esc(x?.valid_till || '')}"></div></div>
      <label>Reference / outward number</label><input name="ref_no" value="${esc(x?.ref_no)}" maxlength="80">
      <label>Remark (conditions, query raised, next step)</label><input name="remark" value="${esc(x?.remark)}" maxlength="500">
      ${x ? `<h3 style="margin:14px 0 4px">Letters and drawings</h3><div class="apv-files">${x.files.map((f) => `<div><button type="button" class="ghost small" data-open="${f.id}">${esc(f.name)}</button><span class="small muted">${kb(f.size)}</span>${ed ? `<button type="button" class="ghost small danger" data-rm="${f.id}">Remove</button>` : ''}</div>`).join('') || '<span class="small muted">No file yet.</span>'}</div>
        ${ed ? '<button type="button" class="ghost small" id="apvFile">Add a file (PDF, JPG or PNG, up to 3 MB)</button><input type="file" id="apvFileI" accept="application/pdf,image/jpeg,image/png" hidden>' : ''}` : ''}
      ${x && x.custom && ed ? '<p class="small" style="margin-top:12px"><button type="button" class="ghost danger" id="apvDel">Remove this approval</button></p>' : ''}`,
    async (v) => {
      if (!ed) return;
      await post({ action: 'save', approval: { ...v, key: x?.key } });
      C.toast('Saved.'); paint();
    });
    if (!ed) { const s = $('[value=save]', dl); if (s) s.hidden = true; $$('input,select', dl).forEach((i) => (i.disabled = true)); }
    $$('[data-open]', dl).forEach((b) => (b.onclick = async () => {
      try { const f = await C.api(`/api/approvals?project=${P}&file=${b.dataset.open}`); const u = URL.createObjectURL(blob(f.data, f.type)); const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
      catch (e) { C.toast(e.message); }
    }));
    $$('[data-rm]', dl).forEach((b) => (b.onclick = async () => {
      if (!(await zConfirm('Remove this file?'))) return;
      try { await post({ action: 'file.remove', id: +b.dataset.rm }); dl.close(); dl.remove(); paint(); form(D.list.find((y) => y.key === x.key)); } catch (e) { C.toast(e.message); }
    }));
    const af = $('#apvFile', dl), ai = $('#apvFileI', dl);
    if (af) af.onclick = () => { ai.value = ''; ai.click(); };
    if (ai) ai.onchange = async () => {
      const f = ai.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { C.toast('The file is larger than 3 MB. Please scan it at a lower resolution.'); return; }
      af.disabled = true; af.textContent = 'Uploading…';
      try { await post({ action: 'file.add', key: x.key, file: { name: f.name, data: await read(f) } }); dl.close(); dl.remove(); paint(); form(D.list.find((y) => y.key === x.key)); C.toast('File added.'); }
      catch (e) { af.disabled = false; af.textContent = 'Add a file'; C.toast(e.message); }
    };
    const del = $('#apvDel', dl); if (del) del.onclick = async () => {
      if (!(await zConfirm(`Remove "${x.title}" and its files?`))) return;
      try { await post({ action: 'remove', key: x.key }); dl.close(); dl.remove(); paint(); } catch (e) { C.toast(e.message); }
    };
  }

  async function render(ctx, projectId) {
    C = ctx; if (P !== projectId) only = '';
    P = projectId;
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    await load(); paint();
  }
  window.Approvals = { render };
})();
