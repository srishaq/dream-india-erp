// Slum register (staff): every Annexure II tenement of an SRA project, from /api/slums (lib/slums.js).
// Mounted by app.js: window.Slums.render(ctx, projectId, tenantId?) — the register, or one tenement's file.
(function () {
  let C = null, P = null, D = null, F = { q: '', only: '' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dd = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const inr = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const css = `
  .slm .slm-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 0 14px}
  .slm .slm-k button{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:left;cursor:pointer;color:inherit;font:inherit}
  .slm .slm-k button.on{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-tint)}
  .slm .slm-k b{display:block;font-size:22px;color:var(--brand)}.slm .slm-k span{font-size:12.5px;color:var(--ink-3)}.slm .slm-k .bad b{color:#B3261E}
  .slm .slm-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}.slm .slm-tools input{max-width:260px}
  .slm table{min-width:880px}.slm td{vertical-align:top}.slm tr[data-t]{cursor:pointer}.slm tr[data-t]:hover td{background:var(--brand-tint)}
  .slm .ok{color:#117A65}.slm .no{color:#B3261E}.slm .sm{display:block;font-size:12px;color:var(--ink-3)}
  .slm .hut{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.slm .hut .panel{margin:0}
  .slm dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px}.slm dt{color:var(--ink-3)}.slm dd{margin:0}`;

  const ONLY = {
    noAgreement: ['Agreement missing', (x) => !x.papers[0].n, true],
    noKyc: ['KYC missing', (x) => !x.papers[1].n, true],
    noElig: ['Eligibility papers missing', (x) => !x.papers[2].n, true],
    complete: ['All papers in', (x) => !x.missing.length],
    eligUnknown: ['Eligibility to fill in', (x) => !x.eligibility || x.eligibility === 'pending', true],
    closed: ['Closed shops', (x) => x.closed],
  };
  const tick = (n) => (n ? '<span class="ok">✓</span>' : '<span class="no">✗</span>');

  function list() {
    const s = D.summary, L = D.labels;
    const k = (key, v, l, bad) => `<button type="button" data-only="${key}" class="${F.only === key ? 'on' : ''} ${bad && v ? 'bad' : ''}"><b>${v}</b><span>${esc(l)}</span></button>`;
    const q = F.q.toLowerCase();
    const rows = D.list.filter((x) => (!F.only || ONLY[F.only][1](x)) && (!q || String(x.no) === q || (x.holder + ' ' + x.name + ' ' + x.rehab_unit).toLowerCase().includes(q)));
    $('#page').innerHTML = `<div class="slm"><style>${css}</style>
      <div class="page-head"><div><a class="muted small" href="#/project/${D.project.id}">← ${esc(D.project.name)}</a><h1>Slum register</h1>
        <p class="muted">${s.total} tenements on Annexure II (${s.active} active, ${s.closed} closed shops) · ${Math.round(s.area).toLocaleString('en-IN')} sq ft. Tap a tenement for its file: holder, papers, agreement, rent and rehab unit.</p></div></div>
      <div class="slm-k">${k('noAgreement', s.total - s.agreements, 'agreements missing', true)}${k('noKyc', s.total - s.kyc, 'KYC missing', true)}${k('noElig', s.total - s.eligibility_papers, 'eligibility papers missing', true)}${k('complete', s.complete, 'with every paper')}${k('eligUnknown', s.eligibility_unknown, 'eligibility to fill in', true)}${k('closed', s.closed, 'closed shops')}</div>
      ${D.canRent ? `<p class="small muted" style="margin:-4px 0 12px">Rent (from Accounts → SRA tenants): due to date ${inr(s.rent_due)}, paid ${inr(s.rent_paid)}.${s.rent_paid ? '' : ' No rent payment is linked to a tenant yet: Accounts link them on Rent links.'}</p>` : ''}
      <div class="slm-tools"><input id="slQ" placeholder="Search no., name or rehab unit" value="${esc(F.q)}">${F.only ? `<button class="ghost small" id="slAll">Show all (${esc(ONLY[F.only][0])})</button>` : ''}<button class="ghost" id="slXl">Download Excel</button></div>
      <div class="panel" style="padding:0"><div class="table-wrap"><table><tr><th>No.</th><th>Holder</th><th>Area</th><th>Use · eligibility</th>${D.need.map((n) => `<th>${esc(n.label.split(' (')[0])}</th>`).join('')}<th>Agreement</th>${D.canRent ? '<th>Rent</th>' : ''}<th>Rehab unit</th></tr>
      ${rows.map((x) => `<tr data-t="${x.id}"><td><b>${esc(x.no)}</b>${x.closed ? '<span class="sm">Closed</span>' : ''}</td><td>${esc(x.holder)}${x.holder !== x.name && x.name ? `<span class="sm">${esc(x.name)}</span>` : ''}</td>
        <td>${x.area ? esc(x.area) : ''}</td><td>${esc(L.use[x.use] || '—')}<span class="sm">${esc(L.eligibility[x.eligibility] || 'Eligibility not filled')}</span></td>
        ${x.papers.map((p) => `<td>${tick(p.n)}</td>`).join('')}<td>${x.agreement_on ? dd(x.agreement_on) : ''}${x.agreement_reg ? `<span class="sm">${esc(x.agreement_reg)}</span>` : ''}</td>
        ${D.canRent ? `<td>${x.rent ? `${inr(x.rent.paid)}<span class="sm">of ${inr(x.rent.due)} due</span>` : ''}</td>` : ''}<td>${esc(x.rehab_unit)}</td></tr>`).join('') || `<tr><td colspan="9" class="muted">No tenement matches.</td></tr>`}</table></div></div></div>`;
    $$('[data-only]').forEach((b) => (b.onclick = () => { F.only = F.only === b.dataset.only ? '' : b.dataset.only; list(); }));
    if ($('#slAll')) $('#slAll').onclick = () => { F.only = ''; list(); };
    const qi = $('#slQ'); qi.oninput = () => { F.q = qi.value.trim(); clearTimeout(qi._t); qi._t = setTimeout(() => { list(); const n = $('#slQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $$('tr[data-t]').forEach((tr) => (tr.onclick = () => { location.hash = `#/slums/${P}/${tr.dataset.t}`; }));
    $('#slXl').onclick = async () => {
      try { const r = await C.api(`/api/slums?project=${P}&excel=1`); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); }
      catch (e) { C.toast(e.message); }
    };
  }

  async function hut(id) {
    const x = D.list.find((y) => y.id === +id);
    if (!x) { $('#page').innerHTML = `<div class="panel">That tenement is not on this register. <a href="#/slums/${P}">Back to the register</a></div>`; return; }
    const L = D.labels, opt = (map, v) => `<option value="">—</option>${Object.entries(map).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
    let docs = null; try { docs = (await C.api(`/api/custdocs?tenant=${x.id}`)).rows; } catch (e) { docs = null; }
    $('#page').innerHTML = `<div class="slm"><style>${css}</style>
      <div class="page-head"><div><a class="muted small" href="#/slums/${P}">← Slum register</a><h1>Annexure no. ${esc(x.no)} · ${esc(x.holder)}</h1>
        <p class="muted">${x.area ? esc(x.area) + ' sq ft · ' : ''}${esc(x.status)}${x.missing.length ? ` · <span class="no">Missing: ${esc(x.missing.join(', '))}</span>` : ' · every paper is in'}</p></div></div>
      <div class="hut">
        <div class="panel"><h2 style="margin-top:0">The tenement</h2>
          <form id="slF"><div class="row"><div><label>Use</label><select name="use">${opt(L.use, x.use)}</select></div><div><label>Eligibility (Annexure II)</label><select name="eligibility">${opt(L.eligibility, x.eligibility)}</select></div></div>
          <div class="row"><div><label>Consent</label><select name="consent">${opt(L.consent, x.consent)}</select></div><div><label>Vacated on</label><input type="date" name="vacated_on" value="${esc(x.vacated_on || '')}"></div></div>
          <div class="row"><div><label>Agreement date</label><input type="date" name="agreement_on" value="${esc(x.agreement_on || '')}"></div><div><label>Agreement reg. no.</label><input name="agreement_reg" maxlength="80" value="${esc(x.agreement_reg)}"></div></div>
          <div class="row"><div><label>Rehab unit allotted</label><input name="rehab_unit" maxlength="40" value="${esc(x.rehab_unit)}" placeholder="e.g. Shop 12, 1st floor"></div><div><label>Mobile</label><input name="mobile" maxlength="20" value="${esc(x.mobile)}"></div></div>
          <label>Remark</label><input name="remark" maxlength="500" value="${esc(x.remark)}">
          ${D.canEdit ? '<div class="actions"><button>Save</button></div>' : ''}</form></div>
        <div class="panel"><h2 style="margin-top:0">Papers</h2>
          <dl>${x.papers.map((p) => `<dt>${esc(p.label)}</dt><dd>${p.n ? `<span class="ok">✓ ${p.n}</span>` : '<span class="no">Missing</span>'}</dd>`).join('')}</dl>
          <div style="margin-top:12px">${docs == null ? '<p class="small muted">Tenant documents are open to Accounts.</p>' : docs.map((d) => `<div style="margin:4px 0"><button type="button" class="ghost small" data-doc="${d.id}" data-n="${esc(d.file_name)}">📄 ${esc(d.kind)}</button> <span class="small muted">${esc(d.file_name)}</span></div>`).join('') || '<p class="small muted">No papers uploaded yet.</p>'}</div>
          ${docs != null && window.ErpUploadDoc ? '<button type="button" class="ghost small" id="slUp" style="margin-top:8px">Add a paper</button>' : ''}</div>
        <div class="panel"><h2 style="margin-top:0">Rent and holder</h2><dl>
          <dt>Holder (Annexure II)</dt><dd>${esc(x.holder)}</dd><dt>Name in accounts</dt><dd>${esc(x.name)}</dd>
          ${x.monthly_rent ? `<dt>Monthly rent</dt><dd>${inr(x.monthly_rent)}</dd>` : ''}
          ${x.rent ? `<dt>Due to date</dt><dd>${inr(x.rent.due)}</dd><dt>Paid</dt><dd>${inr(x.rent.paid)}</dd><dt>Balance</dt><dd>${inr(x.rent.balance)} <span class="small muted">${esc(x.rent.position)}</span></dd>` : ''}
          </dl>${D.canRent ? '<p class="small muted" style="margin-top:10px">Rent is kept by Accounts (SRA tenants and Rent links).</p>' : ''}</div>
      </div></div>`;
    if (!D.canEdit) $$('#slF input, #slF select').forEach((i) => (i.disabled = true));
    $('#slF').onsubmit = async (e) => {
      e.preventDefault(); if (!D.canEdit) return;
      try { D = await C.api('/api/slums', { project: P, action: 'save', tenantId: x.id, slum: Object.fromEntries(new FormData(e.target)) }); C.toast('Saved.'); hut(x.id); }
      catch (err) { C.toast(err.message); }
    };
    $$('[data-doc]').forEach((b) => (b.onclick = () => window.ErpOpenDoc && window.ErpOpenDoc(+b.dataset.doc, b.dataset.n)));
    if ($('#slUp')) $('#slUp').onclick = () => window.ErpUploadDoc('tenant', x.id, `Annexure no. ${x.no} · ${x.holder}`, async () => { D = await C.api(`/api/slums?project=${P}`); hut(x.id); });
  }

  async function render(ctx, projectId, tenantId) {
    C = ctx; if (P !== projectId) F = { q: '', only: '' };
    P = projectId;
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    if (!D || D.project.id !== +P || !tenantId) D = await C.api(`/api/slums?project=${P}`);
    if (tenantId) await hut(tenantId); else list();
  }
  window.Slums = { render };
})();
