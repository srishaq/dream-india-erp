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
      <td>${x.files.length + x.docs.length ? `📎 ${x.files.length + x.docs.length}` : ''}</td></tr>`;
  }
  function paint() {
    if (D.flow) return paintFlow();
    const p = D.project, s = D.summary, pct = s.total ? Math.round((s.received / s.total) * 100) : 0;
    const k = (key, v, l, bad) => `<button type="button" data-only="${key}" class="${only === key ? 'on' : ''} ${bad && v ? 'bad' : ''}"><b>${v}</b><span>${esc(l)}</span></button>`;
    const groups = D.stages.map(([st, label]) => [label, D.list.filter((x) => x.stage === st && match(x))]).filter(([, l]) => l.length);
    $('#page').innerHTML = `<div class="apv"><style>${css}</style>
      <div class="page-head"><div><a class="muted small" href="#/project/${p.id}">← ${esc(p.name)}</a><h1>Approvals</h1>
        <p class="muted">${s.received} of ${s.total} received${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}. Tap an approval to fill in its dates and keep its letter.</p><div class="apv-bar"><i style="width:${pct}%"></i></div></div></div>
      <div class="apv-k">${k('received', s.received, 'Received')}${k('open', s.applied + s.query, 'Applied, waiting')}${k('query', s.query, 'Query raised', true)}${k('not_started', s.not_started, 'Not applied yet')}${k('alert', s.expiring + s.expired, 'Expired or renew soon', true)}</div>
      <div class="apv-tools">${only ? '<button class="ghost small" id="apvAll">Show all</button>' : ''}${D.canSetup && p.kind !== 'sra' ? '<button id="apvFlow">Show as steps (with document checklist)</button>' : ''}${D.canEdit ? '<button id="apvAdd">Add another approval</button><button class="ghost" id="apvXl">Download Excel</button><button class="ghost" id="apvUp">Upload Excel</button><input type="file" id="apvF" accept=".xlsx,.csv" hidden>' : ''}</div>
      ${groups.map(([label, l]) => `<h2 class="st">${esc(label)}</h2><div class="panel" style="padding:0"><div class="table-wrap"><table><tr><th>Approval</th><th>Status</th><th>Date</th><th>Reference</th><th>Valid till</th><th>Files</th></tr>${l.map(row).join('')}</table></div></div>`).join('') || '<div class="panel muted">Nothing matches.</div>'}
    </div>`;
    $$('[data-only]').forEach((b) => (b.onclick = () => { only = only === b.dataset.only ? '' : b.dataset.only; paint(); }));
    if ($('#apvAll')) $('#apvAll').onclick = () => { only = ''; paint(); };
    $$('tr[data-k]').forEach((tr) => (tr.onclick = () => form(D.list.find((x) => x.key === tr.dataset.k))));
    if ($('#apvFlow')) $('#apvFlow').onclick = async () => { if (!confirm('Lay this project\'s approvals out step by step, from land and title to OC, with a document checklist in each step?')) return; try { await post({ action: 'flow.start', flow: 'open' }); C.toast('Approvals are now step by step.'); paint(); } catch (e) { C.toast(e.message); } };
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
        ${x.docs.length ? `<div class="apv-files">${x.docs.map((f) => `<div><button type="button" class="ghost small" data-doc="${f.id}" data-n="${esc(f.name)}">📄 ${esc(f.name)}</button><span class="small muted">${kb(f.size)} · in Project documents</span></div>`).join('')}</div>` : ''}
        ${ed ? '<button type="button" class="ghost small" id="apvLink">Link from Project documents</button>' : ''}
        ${ed ? '<button type="button" class="ghost small" id="apvFile">Add a file (PDF, JPG or PNG, up to 3 MB)</button><input type="file" id="apvFileI" accept="application/pdf,image/jpeg,image/png" hidden>' : ''}` : ''}
      ${x && x.custom && ed ? '<p class="small" style="margin-top:12px"><button type="button" class="ghost danger" id="apvDel">Remove this approval</button></p>' : ''}`,
    async (v) => {
      if (!ed) return;
      await post({ action: 'save', approval: { ...v, key: x?.key, step_key: !x && form.step ? form.step : undefined } });
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
    $$('[data-doc]', dl).forEach((b) => (b.onclick = () => (window.ErpOpenDoc ? window.ErpOpenDoc(+b.dataset.doc, b.dataset.n) : C.toast('Open it from Project documents.'))));
    const lk = $('#apvLink', dl);
    if (lk) lk.onclick = async () => {
      let r; try { r = await C.api(`/api/approvals?project=${P}&docs=1`); } catch (e) { C.toast(e.message); return; }
      if (!r.docs.length) { C.toast('There are no project documents yet. Upload the letter in Project documents first.'); return; }
      const on = new Set(x.docs.map((d) => d.id));
      const pk = C.dialog(`<h2>Link letters · ${esc(x.title)}</h2><p class="small muted">Tick the letters for this approval. They stay in Project documents; nothing is copied.</p>
        <input id="apvQ" placeholder="Search" style="margin-bottom:8px"><div id="apvL" style="max-height:52vh;overflow:auto">${r.docs.map((d) => `<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:4px 0" data-s="${esc((d.file_name + ' ' + d.kind).toLowerCase())}"><input type="checkbox" value="${d.id}" ${on.has(d.id) ? 'checked' : ''} style="width:auto;margin-top:3px"><span>${esc(d.file_name)} <span class="muted">· ${esc(d.kind)}</span></span></label>`).join('')}</div>`,
      async () => {
        const ids = $$('#apvL input:checked', pk).map((i) => +i.value);
        await post({ action: 'docs.link', key: x.key, docIds: ids });
        C.toast('Linked.'); dl.close(); dl.remove(); paint(); form(D.list.find((y) => y.key === x.key));
      });
      $('#apvQ', pk).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('#apvL label', pk).forEach((l) => (l.hidden = q && !l.dataset.s.includes(q))); };
    };
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

  // ---------- step by step (lib/approval-flow.js) ----------
  let open = null, wait = '';
  const css2 = `
  .apv .fl-steps{display:flex;gap:6px;overflow-x:auto;padding:4px 0 10px;margin:0 0 6px}
  .apv .fl-steps button{flex:0 0 auto;border:1px solid var(--line);background:#fff;border-radius:12px;padding:8px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:inherit;text-align:left;min-width:96px}
  .apv .fl-steps button b{display:block;font-size:11px;color:var(--ink-3);font-weight:600}
  .apv .fl-steps .done{background:#E8F5EE;border-color:#B7E0C8}.apv .fl-steps .now{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-tint)}.apv .fl-steps .sel{outline:2px solid var(--brand)}
  .apv .fl-step{border:1px solid var(--line);border-radius:14px;background:#fff;margin:0 0 10px;overflow:hidden}
  .apv .fl-head{display:flex;gap:12px;align-items:center;padding:12px 14px;cursor:pointer;flex-wrap:wrap}
  .apv .fl-head .n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#EEF2F4;font-weight:700;flex:0 0 auto}
  .apv .fl-step.done .n{background:#117A65;color:#fff}.apv .fl-step.now .n{background:var(--brand);color:#fff}
  .apv .fl-head h3{margin:0;font-size:15.5px;flex:1 1 220px}.apv .fl-head .meta{font-size:12.5px;color:var(--ink-3)}
  .apv .fl-body{padding:0 14px 14px;border-top:1px solid var(--line)}
  .apv .fl-body h4{margin:14px 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
  .apv .fl-body table{min-width:720px}.apv .fl-body select{padding:4px 6px;font-size:13px;min-width:0}
  .apv .fl-wait{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}.apv .fl-wait button{border:1px solid var(--line);background:#fff;border-radius:99px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;color:inherit}
  .apv .fl-wait button.on{background:var(--brand);color:#fff;border-color:var(--brand)}.apv .od{color:#B3261E;font-weight:600}
  .apv table.docs{table-layout:auto}.apv table.docs th:nth-child(1){width:44%}.apv table.docs th:nth-child(2){width:14%}.apv table.docs th:nth-child(3){width:18%}.apv table.docs th:nth-child(4){width:18%}.apv table.docs th:nth-child(5){width:6%}
  .apv tr[data-i]{cursor:pointer}.apv tr[data-i]:hover td{background:#F6FAF9}`;
  const STONE = { needed: 'grey', ready: 'warn', sent: 'warn', accepted: 'good', not_needed: 'grey' };
  const inr = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  function itemRow(x, F) {
    const sel = D.canEdit ? `<select data-st="${x.id}" onclick="event.stopPropagation()">${Object.entries(F.labels).map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : `<span class="pill ${STONE[x.status]}">${esc(F.labels[x.status])}</span>`;
    return `<tr data-i="${x.id}"><td class="${x.status === 'not_needed' ? 'nn' : ''}"><b>${esc(x.title)}</b>${x.note ? `<span class="sm">${esc(x.note)}</span>` : ''}</td><td>${esc(F.who[x.who] || x.who)}</td><td>${sel}${x.sent_on && x.status === 'sent' ? `<span class="sm">Sent ${dd(x.sent_on)}</span>` : ''}</td>
      <td>${esc(x.owner)}${x.due_on ? `<span class="sm ${x.overdue ? 'od' : ''}">${x.overdue ? 'Overdue · ' : 'Due '}${dd(x.due_on)}</span>` : ''}</td><td>${x.docs.length ? `📎 ${x.docs.length}` : ''}</td></tr>`;
  }
  function paintFlow() {
    const p = D.project, F = D.flow, S = F.steps, at = F.at;
    const all = S.reduce((a, s) => a + s.total, 0), done = S.reduce((a, s) => a + s.done, 0), pct = all ? Math.round((done / all) * 100) : 0;
    if (open == null) open = at ? at.key : S[S.length - 1].key;
    const stepCls = (s) => (s.complete ? 'done' : at && s.key === at.key ? 'now' : '');
    const WAIT = Object.entries(F.who).map(([k, l]) => [k, l.replace(' (owner)', ''), F.waiting[k] || 0]).filter(([, , n]) => n);
    const mine = S.flatMap((s) => s.list.filter((x) => x.owner_id === D.me && !['accepted', 'not_needed'].includes(x.status))).length;
    let body;
    if (wait) {
      const pick = (x) => !['accepted', 'not_needed'].includes(x.status) && (wait === 'mine' ? x.owner_id === D.me : wait === 'overdue' ? x.overdue : (x.status === 'sent' ? 'architect' : x.who) === wait);
      const groups = S.map((s) => [s, s.list.filter(pick)]).filter(([, l]) => l.length);
      body = groups.map(([s, l]) => `<h2 class="st">Step ${s.n}: ${esc(s.title)}</h2><div class="panel" style="padding:0"><div class="table-wrap"><table class="docs"><tr><th>Document</th><th>Who gives it</th><th>Where it stands</th><th>Owner · due</th><th></th></tr>${l.map((x) => itemRow(x, F)).join('')}</table></div></div>`).join('') || '<p class="muted">Nothing pending here.</p>';
    } else body = S.map((s) => {
      const isOpen = open === s.key, mon = s.money;
      const mExp = mon ? mon.reduce((a, m) => a + m.expected, 0) : 0, mPaid = mon ? mon.reduce((a, m) => a + m.paid, 0) : 0;
      return `<div class="fl-step ${stepCls(s)}" id="st-${s.key}"><div class="fl-head" data-open="${s.key}"><span class="n">${s.complete ? '✓' : s.n}</span><h3>${esc(s.title)}</h3>
        <span class="meta">${s.total ? `${s.done} of ${s.total} done` : 'Nothing listed yet'}${s.owner ? ` · ${esc(s.owner)}` : ''}${s.due_on ? ` · <span class="${s.overdue ? 'od' : ''}">${s.overdue ? 'overdue ' : 'due '}${dd(s.due_on)}</span>` : ''}</span><span class="meta">${isOpen ? '▾' : '▸'}</span></div>
        ${isOpen ? `<div class="fl-body"><p class="small muted" style="margin:10px 0 0">${esc(s.what)}</p>
          ${D.canEdit ? `<p style="margin:8px 0 0"><button type="button" class="ghost small" data-own="${s.key}">${s.owner ? 'Owner: ' + esc(s.owner) : 'Choose the owner'}${s.due_on ? ' · due ' + dd(s.due_on) : ''}</button></p>` : ''}
          ${s.approvals.length || D.canEdit ? `<h4>Approvals</h4>${s.approvals.length ? `<div class="table-wrap"><table><tr><th>Approval</th><th>Status</th><th>Date</th><th>Reference</th><th>Valid till</th><th>Files</th></tr>${s.approvals.map(row).join('')}</table></div>` : ''}${D.canEdit ? `<button type="button" class="ghost small" data-addap="${s.key}" style="margin-top:6px">Add an approval to this step</button>` : ''}` : ''}
          <h4>Documents</h4>${s.list.length ? `<div class="table-wrap"><table class="docs"><tr><th>Document</th><th>Who gives it</th><th>Where it stands</th><th>Owner · due</th><th></th></tr>${s.list.map((x) => itemRow(x, F)).join('')}</table></div>` : '<p class="small muted">No documents listed for this step.</p>'}
          ${D.canEdit ? `<button type="button" class="ghost small" data-additem="${s.key}" style="margin-top:6px">Add a document</button>` : ''}
          ${mon ? `<h4>Fees and premiums</h4>${mon.length ? `<div class="table-wrap"><table><tr><th>Fee / premium</th><th class="num">Expected</th><th class="num">Paid</th><th>Paid on · ref</th></tr>${mon.map((m) => `<tr data-m="${m.id}" style="cursor:pointer"><td>${esc(m.item)}</td><td class="num">${inr(m.expected)}</td><td class="num">${inr(m.paid)}</td><td>${m.paid_on ? dd(m.paid_on) : ''}${m.ref ? ' · ' + esc(m.ref) : ''}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="num"><b>${inr(mExp)}</b></td><td class="num"><b>${inr(mPaid)}</b></td><td>${mExp > mPaid ? `${inr(mExp - mPaid)} still to pay` : ''}</td></tr></table></div>` : '<p class="small muted">No fees entered for this step.</p>'}<button type="button" class="ghost small" data-addm="${s.key}" style="margin-top:6px">Add a fee or premium</button>` : ''}
        </div>` : ''}</div>`;
    }).join('');
    $('#page').innerHTML = `<div class="apv"><style>${css}${css2}</style>
      <div class="page-head"><div><a class="muted small" href="#/project/${p.id}">← ${esc(p.name)}</a><h1>Approvals</h1>
        <p class="muted">${at ? `Step ${at.n} of ${S.length}: <b>${esc(at.title)}</b> · ${at.done} of ${at.total} done` : 'Every step is done.'} · ${pct}% of the whole journey${F.overdue ? ` · <span class="od">${F.overdue} overdue</span>` : ''}</p><div class="apv-bar"><i style="width:${pct}%"></i></div></div></div>
      <div class="fl-steps">${S.map((s) => `<button type="button" data-jump="${s.key}" class="${stepCls(s)} ${open === s.key && !wait ? 'sel' : ''}"><b>${s.complete ? '✓ ' : ''}Step ${s.n}</b>${esc(s.title)}</button>`).join('')}</div>
      <div class="fl-wait"><span class="small muted" style="align-self:center">Waiting on:</span>${WAIT.map(([k, l, n]) => `<button type="button" data-wait="${k}" class="${wait === k ? 'on' : ''}">${esc(l)} · ${n}</button>`).join('')}${mine ? `<button type="button" data-wait="mine" class="${wait === 'mine' ? 'on' : ''}">Mine · ${mine}</button>` : ''}${F.overdue ? `<button type="button" data-wait="overdue" class="${wait === 'overdue' ? 'on' : ''}">Overdue · ${F.overdue}</button>` : ''}${wait ? '<button type="button" data-wait="">Show the steps</button>' : ''}</div>
      ${body}
      <div class="apv-tools" style="margin-top:14px"><button class="ghost" id="apvXl">Download Excel</button>${D.canSetup ? '<button class="ghost" id="apvHand">Hand over to someone else</button>' : ''}</div></div>`;
    $$('[data-open]').forEach((h) => (h.onclick = () => { open = open === h.dataset.open ? '' : h.dataset.open; paintFlow(); }));
    $$('[data-jump]').forEach((b) => (b.onclick = () => { wait = ''; open = b.dataset.jump; paintFlow(); const el = $('#st-' + open); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $$('[data-wait]').forEach((b) => (b.onclick = () => { wait = b.dataset.wait; paintFlow(); }));
    $$('tr[data-k]').forEach((tr) => (tr.onclick = () => form(D.list.find((x) => x.key === tr.dataset.k))));
    $$('tr[data-i]').forEach((tr) => (tr.onclick = () => itemForm(S.flatMap((s) => s.list).find((x) => x.id === +tr.dataset.i))));
    $$('[data-st]').forEach((sl) => (sl.onchange = async () => { try { await post({ action: 'item.save', item: { id: +sl.dataset.st, status: sl.value } }); paintFlow(); } catch (e) { C.toast(e.message); paintFlow(); } }));
    $$('[data-additem]').forEach((b) => (b.onclick = () => itemForm(null, b.dataset.additem)));
    $$('[data-addap]').forEach((b) => (b.onclick = () => { form.step = b.dataset.addap; form(null); form.step = null; }));
    $$('[data-own]').forEach((b) => (b.onclick = () => ownForm(S.find((s) => s.key === b.dataset.own))));
    $$('[data-addm]').forEach((b) => (b.onclick = () => moneyForm(null, b.dataset.addm)));
    $$('tr[data-m]').forEach((tr) => (tr.onclick = () => moneyForm(S.flatMap((s) => s.money || []).find((m) => m.id === +tr.dataset.m))));
    $('#apvXl').onclick = async () => { try { const r = await C.api(`/api/approvals?project=${P}&excel=1`); const a = document.createElement('a'); a.href = URL.createObjectURL(blob(r.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { C.toast(e.message); } };
    if ($('#apvHand')) $('#apvHand').onclick = handForm;
  }
  const people = (sel) => `<option value="">—</option>${D.flow.people.map((u) => `<option value="${u.id}" ${+sel === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
  function itemForm(x, step) {
    const F = D.flow, ed = D.canEdit;
    const dl = C.dialog(`<h2>${x ? esc(x.title) : 'Add a document'}</h2>
      <label>Document</label><input name="title" value="${esc(x?.title)}" maxlength="200" required>
      <div class="row"><div><label>Who gives it</label><select name="who">${Object.entries(F.who).map(([k, l]) => `<option value="${k}" ${(x?.who || 'us') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label>Where it stands</label><select name="status">${Object.entries(F.labels).map(([k, l]) => `<option value="${k}" ${(x?.status || 'needed') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Owner (who chases it)</label><select name="owner_id">${people(x?.owner_id)}</select></div><div><label>Due date</label><input type="date" name="due_on" value="${esc(x?.due_on || '')}"></div>
        <div><label>Sent to architect on</label><input type="date" name="sent_on" value="${esc(x?.sent_on || '')}"></div></div>
      <label>Note</label><input name="note" value="${esc(x?.note)}" maxlength="500">
      ${x ? `<h3 style="margin:14px 0 4px">File</h3>${x.docs.length ? `<div class="apv-files">${x.docs.map((f) => `<div><button type="button" class="ghost small" data-doc="${f.id}" data-n="${esc(f.name)}">📄 ${esc(f.name)}</button></div>`).join('')}</div>` : '<p class="small muted">No file yet. Upload it in Project documents (or put it in the project\'s Drive folder), then link it here.</p>'}
        ${ed ? '<button type="button" class="ghost small" id="itLink">Link from Project documents</button>' : ''}
        ${ed ? '<p class="small" style="margin-top:12px"><button type="button" class="ghost danger" id="itDel">Remove from the checklist</button></p>' : ''}` : ''}`,
    async (v) => { if (!ed) return; await post({ action: 'item.save', item: { ...v, id: x?.id, step: x ? undefined : step } }); C.toast('Saved.'); paintFlow(); });
    if (!ed) { const s = $('[value=save]', dl); if (s) s.hidden = true; $$('input,select', dl).forEach((i) => (i.disabled = true)); }
    $$('[data-doc]', dl).forEach((b) => (b.onclick = () => window.ErpOpenDoc && window.ErpOpenDoc(+b.dataset.doc, b.dataset.n)));
    const lk = $('#itLink', dl);
    if (lk) lk.onclick = async () => {
      let r; try { r = await C.api(`/api/approvals?project=${P}&docs=1`); } catch (e) { C.toast(e.message); return; }
      if (!r.docs.length) { C.toast('There are no project documents yet. Upload the file in Project documents first.'); return; }
      const on = new Set(x.docs.map((d) => d.id));
      const pk = C.dialog(`<h2>Link the file · ${esc(x.title)}</h2><input id="itQ" placeholder="Search" style="margin-bottom:8px"><div id="itL" style="max-height:52vh;overflow:auto">${r.docs.map((d) => `<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:4px 0" data-s="${esc((d.file_name + ' ' + d.kind).toLowerCase())}"><input type="checkbox" value="${d.id}" ${on.has(d.id) ? 'checked' : ''} style="width:auto;margin-top:3px"><span>${esc(d.file_name)} <span class="muted">· ${esc(d.kind)}</span></span></label>`).join('')}</div>`,
        async () => { const ids = $$('#itL input:checked', pk).map((i) => +i.value); await post({ action: 'item.save', item: { id: x.id, docIds: ids, ...(ids.length && x.status === 'needed' ? { status: 'ready' } : {}) } }); C.toast('Linked.'); dl.close(); dl.remove(); paintFlow(); });
      $('#itQ', pk).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('#itL label', pk).forEach((l) => (l.hidden = q && !l.dataset.s.includes(q))); };
    };
    const del = $('#itDel', dl); if (del) del.onclick = async () => { if (!confirm(`Remove "${x.title}" from the checklist?`)) return; try { await post({ action: 'item.remove', id: x.id }); dl.close(); dl.remove(); paintFlow(); } catch (e) { C.toast(e.message); } };
  }
  function ownForm(s) {
    C.dialog(`<h2>Step ${s.n}: ${esc(s.title)}</h2><p class="small muted">Who is responsible for getting this step done, and by when. They get the Monday email of what is pending.</p>
      <div class="row"><div><label>Owner</label><select name="owner_id">${people(s.owner_id)}</select></div><div><label>Due date</label><input type="date" name="due_on" value="${esc(s.due_on || '')}"></div></div>
      <label>Note</label><input name="note" value="${esc(s.note)}" maxlength="500">`, async (v) => { await post({ action: 'step.save', step: s.key, ...v }); C.toast('Saved.'); paintFlow(); });
  }
  function moneyForm(m, step) {
    const dl = C.dialog(`<h2>${m ? esc(m.item) : 'Add a fee or premium'}</h2><label>Fee / premium</label><input name="item" value="${esc(m?.item)}" maxlength="120" required placeholder="e.g. Scrutiny fee, Fungible FSI premium">
      <div class="row"><div><label>Expected (₹)</label><input name="expected" inputmode="decimal" value="${m ? m.expected : ''}"></div><div><label>Paid (₹)</label><input name="paid" inputmode="decimal" value="${m ? m.paid : ''}"></div></div>
      <div class="row"><div><label>Paid on</label><input type="date" name="paid_on" value="${esc(m?.paid_on || '')}"></div><div><label>Challan / payment ref</label><input name="ref" value="${esc(m?.ref)}" maxlength="80"></div></div>
      ${m ? '<p class="small"><button type="button" class="ghost danger" id="mDel">Remove</button></p>' : ''}`,
    async (v) => { await post({ action: 'money.save', money: { ...v, id: m?.id, step } }); C.toast('Saved.'); paintFlow(); });
    const del = $('#mDel', dl); if (del) del.onclick = async () => { if (!confirm('Remove this fee?')) return; await post({ action: 'money.remove', id: m.id }); dl.close(); dl.remove(); paintFlow(); };
  }
  function handForm() {
    C.dialog(`<h2>Hand over approval work</h2><p class="small muted">Every open document and step owned by one person moves to another, for example when someone leaves or a new person takes over the process.</p>
      <div class="row"><div><label>From</label><select name="from" required>${people('')}</select></div><div><label>To</label><select name="to" required>${people('')}</select></div></div>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="all" value="1" style="width:auto"> On every project, not only this one</label>`,
    async (v) => { const r = await post({ action: 'handover', from: +v.from, to: +v.to, all: !!v.all }); C.toast(`Handed over: ${r.handedOver.documents} documents and ${r.handedOver.steps} steps.`); paintFlow(); });
  }

  async function render(ctx, projectId) {
    C = ctx; if (P !== projectId) { only = ''; open = null; wait = ''; }
    P = projectId;
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    await load(); paint();
  }
  window.Approvals = { render };
})();
