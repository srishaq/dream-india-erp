// Partner & Telemarketing (staff). Mounted by app.js: window.Telemarketing.render(ctx).
// Overview · Partners · Projects · Call sheets (make, print, type back outcomes) · Customer lookup · Telecallers · Import · Settings
(function () {
  let C = null, tab = 'overview', proj = '', D = {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (v) => (Number(v) || 0).toLocaleString('en-IN');
  const rs = (v) => '₹' + nf(Math.round(Number(v) || 0));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
  const can = (p) => C.me.perms.includes(p);
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const dd = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const PORTAL = location.origin + '/partner';
  const CODES = { 1: 'Interested', 2: 'Site visit booked', 3: 'Call back', 4: 'Not interested', 5: 'Not reachable', 6: 'Wrong number', 7: 'Bought elsewhere', 8: 'Do not call' };
  const PST = { pending: ['Pending review', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'bad'], blocked: ['Blocked', 'bad'] };

  const css = `
  .tm .tm-hero{background:linear-gradient(135deg,#0B5C66,#0E8C9B 55%,#140C59);color:#fff;border-radius:18px;padding:20px 22px;margin:0 0 14px}
  .tm .tm-hero h1{color:#fff;margin:2px 0 4px;font-size:24px}.tm .tm-hero p{margin:0;color:#CFF3F6;font-size:14px}
  .tm .tm-eb{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#A5E8EE;font-weight:700}
  .tm .tm-link{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:13px}.tm .tm-link code{background:#ffffff22;padding:5px 10px;border-radius:8px;color:#fff}
  .tm .tm-link button{background:#fff;color:#0B5C66;border:0;border-radius:8px;padding:5px 12px;font-weight:700;cursor:pointer}
  .tm .tm-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 0 14px}
  .tm .tm-k div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px}.tm .tm-k b{display:block;font-size:21px;color:#140C59}.tm .tm-k span{font-size:12.5px;color:var(--ink-3)}
  .tm .tm-k small{display:block;color:var(--ink-3);font-size:11.5px;margin-top:2px}
  .tm .tm-g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:900px){.tm .tm-g2{grid-template-columns:1fr}}
  .tm .tm-bar{height:8px;border-radius:9px;background:#EEF2F4;overflow:hidden;min-width:80px}.tm .tm-bar i{display:block;height:100%;background:#0E8C9B}
  .tm .tm-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}.tm .tm-tools select,.tm .tm-tools input{width:auto}
  .tm table td.code input{width:46px;text-align:center;font-weight:700}.tm table td input.rm{min-width:160px}
  .tm tr.done td{background:#F3FBF6}.tm .tm-cd{font-size:12px;color:var(--ink-3);display:block}
  .tm .tm-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--ink-2);margin:0 0 10px}.tm .tm-legend b{color:#140C59}
  .tm .tm-own{border-left:4px solid #0E8C9B;padding:10px 14px;background:#F0FAFB;border-radius:8px;margin:10px 0}
  #tm-print{display:none}
  @media print{body>*:not(#tm-print){display:none!important}#tm-print{display:block;font:11px/1.35 system-ui,sans-serif;color:#000}
   #tm-print h2{font-size:15px;margin:0 0 2px}#tm-print p{margin:0 0 8px}#tm-print table{width:100%;border-collapse:collapse}#tm-print th,#tm-print td{border:1px solid #999;padding:4px 5px;text-align:left;vertical-align:top}
   #tm-print td.w{width:34px}#tm-print td.r{width:190px}#tm-print .pg{page-break-after:always}#tm-print .pg:last-child{page-break-after:auto}}
  `;

  function tabs() {
    const all = [
      ['overview', 'Overview', can('tm.view') || can('tm.manage')], ['reports', 'Reports', can('tm.view') || can('tm.manage') || can('mgmt.view')], ['partners', 'Partners', can('tm.view') || can('tm.manage')],
      ['launches', 'Projects', can('tm.view') || can('tm.manage')], ['sheets', 'Call sheets', true], ['lookup', 'Customer lookup', can('tm.view') || can('tm.manage')],
      ['callers', 'Telecallers', can('tm.view') || can('tm.manage')], ['import', 'Import earlier numbers', can('tm.manage')], ['settings', 'Settings', can('tm.manage')],
    ].filter((t) => t[2]);
    if (!all.some((t) => t[0] === tab)) tab = all[0][0];
    return all;
  }

  // opt (inside Sales & Marketing): { host, erp: ERP project id, tabs: [keys] } — no heading, only those tabs, that project chosen
  let O = {};
  async function render(ctx, opt) {
    C = ctx; O = opt || {}; if (O.tabs && !O.tabs.includes(tab)) tab = O.tabs[0];
    if (!$('#tm-css')) { const st = document.createElement('style'); st.id = 'tm-css'; st.textContent = css; document.head.appendChild(st); }
    if (O.host) {
      if (O.erp !== undefined && O._for !== O.erp) { O._for = O.erp; const pr = (await C.api('/api/tm?projects=1').catch(() => ({ rows: [] }))).rows; const mine = pr.filter((p) => O.erp && p.project_id === O.erp);
        proj = O.erp ? String((mine.find((p) => !p.history) || mine[0] || { id: '' }).id) : ''; rproj = (mine.find((p) => p.history) || mine[0] || pr[0] || {}).id || null; O.linked = mine; }
      const T = tabs().filter((t) => !O.tabs || O.tabs.includes(t[0]));
      O.host.innerHTML = `<div class="tm">${O.erp && !(O.linked || []).length ? '<div class="tm-own">This project has no partner launch yet. Open one under Channel partners → Projects ("Add a project", linked to this ERP project) so partners can upload clients for it.</div>' : ''}
        ${T.length > 1 ? `<div class="mk-chips">${T.map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${k === tab}">${esc(l)}</button>`).join('')}</div>` : ''}
        <div id="tmBody"><p class="muted">Loading…</p></div></div>`;
      $$('[data-t]', O.host).forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(C, O); }));
      try { await ({ overview, reports, partners, launches, sheets, lookup, callers, import: importTab, settings })[tab](); }
      catch (e) { $('#tmBody').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      return;
    }
    const T = tabs();
    $('#page').innerHTML = `<div class="tm">
      <div class="tm-hero"><div class="tm-eb">Management</div><h1>Partner &amp; Telemarketing</h1>
        <p>Channel partners register and upload their clients; numbers are checked for duplicates and owners, called from printed sheets, and every result comes back here.</p>
        ${can('tm.view') || can('tm.manage') ? `<div class="tm-link">Partner portal link: <code>${esc(PORTAL)}</code><button type="button" id="tmCopy">Copy link</button></div>` : ''}</div>
      <nav class="ff-tabs no-print" role="tablist">${T.map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${k === tab}">${esc(l)}</button>`).join('')}</nav>
      <div id="tmBody"><p class="muted">Loading…</p></div></div>`;
    $$('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(C); }));
    if ($('#tmCopy')) $('#tmCopy').onclick = () => { navigator.clipboard.writeText(PORTAL).then(() => C.toast('Link copied.')); };
    try { await ({ overview, reports, partners, launches, sheets, lookup, callers, import: importTab, settings })[tab](); }
    catch (e) { $('#tmBody').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  const body = (h) => { $('#tmBody').innerHTML = h; };
  const projOpts = (list, sel, all) => (all ? `<option value="">${esc(all)}</option>` : '') + list.map((p) => `<option value="${p.id}" ${String(sel) === String(p.id) ? 'selected' : ''}>${esc(p.name)}${p.history ? ' (earlier numbers)' : ''}</option>`).join('');

  // ---------- Overview ----------
  async function overview() {
    const d = await C.api('/api/tm?overview=1' + (proj ? '&project=' + proj : ''));
    const cpv = d.visits ? Math.round(d.spend / d.visits) : null;
    const issues = Object.entries(d.issues).filter(([, v]) => v);
    const maxI = Math.max(1, ...issues.map(([, v]) => v));
    body(`<div class="tm-tools"><label class="small muted">Project</label><select id="tmProj">${projOpts(d.projects, proj, 'All projects')}</select></div>
      <div class="tm-k">
        <div><b>${nf(d.partners.registered)}</b><span>Partners registered</span><small>${nf(d.partners.approved)} approved · ${nf(d.partners.pending)} waiting</small></div>
        <div><b>${nf(d.received)}</b><span>Numbers uploaded</span><small>${nf(d.accepted)} accepted (${pct(d.accepted, d.received)})</small></div>
        <div><b>${nf(d.leads)}</b><span>Numbers in the pool</span><small>partner and earlier numbers</small></div>
        <div><b>${nf(d.calls)}</b><span>Calls made</span><small>${pct(d.connected, d.calls)} connected</small></div>
        <div><b>${nf(d.interested)}</b><span>Interested</span><small>${pct(d.interested, d.connected)} of connected</small></div>
        <div><b>${nf(d.visits)}</b><span>Site visits booked</span><small>${pct(d.visits, d.calls)} of calls</small></div>
        <div><b>${rs(d.spend)}</b><span>Telecaller cost</span><small>${cpv ? rs(cpv) + ' per site visit' : 'days × daily rate'}</small></div>
        <div><b>${nf(d.bookings)}</b><span>Bookings by partners</span><small>${d.bookingValue ? rs(d.bookingValue) : 'in the ERP, by CP ID'}</small></div>
      </div>
      <div class="tm-g2">
        <div class="panel"><h2>Why numbers were not accepted</h2>${issues.length ? `<table>${issues.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="width:45%"><div class="tm-bar"><i style="width:${(v / maxI) * 100}%"></i></div></td><td class="num">${nf(v)}</td></tr>`).join('')}</table>` : '<p class="muted">No uploads yet.</p>'}</div>
        <div class="panel"><h2>Where the numbers stand</h2>${Object.keys(d.status).length ? `<table>${Object.entries(d.status).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${nf(v)}</td></tr>`).join('')}</table>` : '<p class="muted">No numbers yet.</p>'}</div>
      </div>
      <div class="panel"><h2>Telecallers</h2><p class="muted small">Ranked by site visits. Cost is days worked on sheets × the caller's daily rate.</p>
        ${d.callers.length ? `<div class="table-wrap"><table><thead><tr><th>Caller</th><th class="num">Days</th><th class="num">Calls</th><th class="num">Calls a day</th><th class="num">Connected</th><th class="num">Interested</th><th class="num">Site visits</th><th class="num">Cost</th><th class="num">Cost per visit</th></tr></thead><tbody>
        ${d.callers.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.days}</td><td class="num">${nf(c.calls)}</td><td class="num">${c.perDay}</td><td class="num">${Math.round(c.connectRate * 100)}%</td><td class="num">${c.interested}</td><td class="num"><b>${c.visits}</b></td><td class="num">${rs(c.cost)}</td><td class="num">${c.costPerVisit ? rs(c.costPerVisit) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No calls entered yet.</p>'}</div>
      <div class="panel"><h2>Partners</h2><p class="muted small">Numbers each partner sent, how many were theirs to keep, what the calls found and what booked.</p>
        ${d.partnerRows.length ? `<div class="table-wrap"><table><thead><tr><th>CP ID</th><th>Firm</th><th class="num">Uploads</th><th class="num">Sent</th><th class="num">Accepted</th><th class="num">Already with another partner</th><th class="num">Called</th><th class="num">Interested</th><th class="num">Site visits</th><th class="num">Their clients who booked</th><th class="num">Bookings credited</th></tr></thead><tbody>
        ${d.partnerRows.map((p) => `<tr><td>${esc(p.cpCode)}</td><td>${esc(p.firm)}</td><td class="num">${p.uploads}</td><td class="num">${nf(p.received)}</td><td class="num">${nf(p.accepted)}</td><td class="num">${nf(p.otherPartner)}</td><td class="num">${nf(p.called)}</td><td class="num">${p.interested}</td><td class="num">${p.visits}</td><td class="num">${p.leadsBooked}</td><td class="num"><b>${p.bookings}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No partner activity yet.</p>'}</div>
      <div class="panel"><h2>Day by day</h2>${d.days.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Callers</th><th class="num">Calls</th><th class="num">Connected</th><th class="num">Interested</th><th class="num">Site visits</th></tr></thead><tbody>
        ${d.days.slice().reverse().slice(0, 30).map((x) => `<tr><td>${dd(x.date)}</td><td class="num">${x.callers}</td><td class="num">${nf(x.calls)}</td><td class="num">${pct(x.connected, x.calls)}</td><td class="num">${x.interested}</td><td class="num">${x.visits}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing entered yet.</p>'}</div>`);
    $('#tmProj').onchange = (e) => { proj = e.target.value; overview(); };
  }

  // ---------- Partners ----------
  async function partners() {
    const d = await C.api('/api/tm?partners=1');
    D.partners = d.rows;
    const pend = d.rows.filter((r) => r.portal_status === 'pending').length;
    body(`<div class="tm-tools"><input class="search" id="tmQ" placeholder="Search firm, CP ID, contact, mobile, RERA no."><span class="muted small">${nf(d.rows.length)} registered${pend ? ` · <b>${pend} waiting for approval</b>` : ''}</span></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>CP ID</th><th>Firm</th><th>Contact</th><th>Mobile</th><th>MahaRERA</th><th>Area</th><th class="num">Clients</th><th class="num">Active</th><th class="num">Bookings</th><th>Status</th><th></th></tr></thead><tbody id="tmPT"></tbody></table></div></div>`);
    const draw = (q) => {
      q = (q || '').toLowerCase();
      const rows = d.rows.filter((r) => !q || [r.cp_code, r.name, r.contact_person, r.phone, r.rera_no, r.username, r.office_area].join(' ').toLowerCase().includes(q));
      $('#tmPT').innerHTML = rows.map((r) => { const s = PST[r.portal_status] || ['', 'grey'];
        return `<tr><td>${esc(r.cp_code)}</td><td><a href="#" data-pv="${r.id}">${esc(r.name)}</a><span class="tm-cd">@${esc(r.username)}</span></td><td>${esc(r.contact_person)}${r.designation ? `<span class="tm-cd">${esc(r.designation)}</span>` : ''}</td>
          <td>${esc(r.phone)}</td><td>${esc(r.rera_no)}</td><td>${esc(r.office_area)}</td><td class="num">${nf(r.leads)}</td><td class="num">${nf(r.active)}</td><td class="num">${r.bookings}</td>
          <td><span class="pill ${s[1]}">${s[0]}</span>${r.portal_status === 'pending' ? `<span class="tm-cd">${r.docs || 0} of 4 papers</span>` : ''}</td><td class="row-acts">${can('tm.manage') ? (r.portal_status !== 'approved' ? `<button class="small" data-st="approved" data-id="${r.id}">Approve</button> ` : '') + (r.portal_status === 'pending' ? `<button class="small ghost" data-st="rejected" data-id="${r.id}">Reject</button>` : r.portal_status === 'approved' ? `<button class="small danger" data-st="blocked" data-id="${r.id}">Block</button>` : '') : ''}</td></tr>`; }).join('') || '<tr><td colspan="11" class="muted">No partners yet. Share the partner portal link with your channel partners.</td></tr>';
      $$('[data-st]').forEach((b) => (b.onclick = async () => {
        const r = d.rows.find((x) => x.id === +b.dataset.id), st = b.dataset.st;
        if (st !== 'approved' && !confirm(`${st === 'blocked' ? 'Block' : 'Reject'} ${r.name}? They will not be able to sign in.`)) return;
        b.disabled = true;
        try { await C.api('/api/tm', { action: 'partner-status', id: r.id, status: st }); C.toast(`${r.name}: ${PST[st][0]}.`); partners(); } catch (e) { b.disabled = false; alert(e.message); }
      }));
      $$('[data-pv]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showPartner(d.rows.find((x) => x.id === +a.dataset.pv)); }));
    };
    draw('');
    $('#tmQ').oninput = (e) => draw(e.target.value);
  }
  function showPartner(r) {
    const row = (l, v) => (v || v === 0 ? `<tr><th>${l}</th><td>${esc(v)}</td></tr>` : '');
    const dl = C.dialog(`<h2>${esc(r.name)}</h2><p class="muted">${esc(r.cp_code)} · ${(PST[r.portal_status] || [''])[0]}</p><table>
      ${row('Username', r.username)}${row('Point of contact', [r.contact_person, r.designation].filter(Boolean).join(', '))}${row('Mobile (verified)', r.phone)}${row('Other number', r.alt_phone)}
      ${row('Email', r.email)}${row('MahaRERA no.', r.rera_no)}${row('Office', r.office_address)}${row('Area', r.office_area)}${row('Callers in their team', r.callers_in_team)}
      ${row('Registered', dd(r.registered_at))}${row('Reviewed', r.reviewed_at ? dd(r.reviewed_at) + (r.reviewed_by ? ' by ' + r.reviewed_by : '') : '')}${row('Last upload', r.last_upload ? dd(r.last_upload) : 'none yet')}
      ${row('Clients registered', r.leads)}${row('Still theirs (inside the ownership period)', r.active)}${row('Bookings credited', r.bookings)}</table>
      <h3 style="margin-top:14px">Documents for approval</h3><div id="tmDocs"><p class="muted">Loading…</p></div>`, async () => {});
    $('[value=save]', dl).remove();
    const paint = async () => {
      const d = await C.api('/api/tm?docs=' + r.id);
      $('#tmDocs', dl).innerHTML = `<table>${d.docs.map((x) => `<tr><th>${esc(x.label)}</th><td>${x.done ? `<span class="pill good">In</span> ${esc(x.number || '')} ${x.file ? `<a href="/api/tm?cpdoc=${x.id}" target="_blank" rel="noopener">open</a>` : ''}${x.how && x.kind === 'agreement' ? `<span class="tm-cd">${esc(x.how)}${x.signedName ? ' by ' + esc(x.signedName) : ''}${x.at ? ', ' + dd(x.at) : ''}</span>` : ''}` : '<span class="pill warn">Missing</span>'}
        ${x.kind === 'agreement' && !x.done && can('tm.manage') ? ' <button type="button" class="small ghost" id="tmPaper">Signed copy received at the office</button>' : ''}</td></tr>`).join('')}</table>
        <p class="small ${d.complete ? '' : 'muted'}">${d.complete ? 'All papers are in: the partner can be approved.' : 'Approval opens once all four are in.'}</p>`;
      const pb = $('#tmPaper', dl); if (pb) pb.onclick = async () => { await C.api('/api/tm', { action: 'doc-received', cpId: r.id }); paint(); };
    };
    paint().catch((e) => { $('#tmDocs', dl).innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  }

  // ---------- Launches ----------
  async function launches() {
    const d = await C.api('/api/tm?projects=1');
    D.launch = d;
    const ST = { open: ['Open for uploads', 'good'], calling: ['Calling (uploads closed)', 'warn'], closed: ['Closed', 'grey'] };
    body(`<div class="tm-tools">${can('tm.manage') ? '<button id="tmAddL">Add a project</button>' : ''}<span class="muted small">Partners can upload clients only for projects that are open.</span></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Project</th><th>Location</th><th>MahaRERA</th><th>Uploads until</th><th class="num">Numbers</th><th class="num">Not yet called</th><th class="num">Partners</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.rows.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.erp_project ? `<span class="tm-cd">ERP: ${esc(p.erp_project)}</span>` : ''}</td><td>${esc(p.location)}</td><td>${esc(p.rera_no)}</td><td>${p.history ? '–' : p.upload_until ? dd(p.upload_until) : 'no end date'}</td>
        <td class="num">${nf(p.leads)}</td><td class="num">${nf(p.uncalled)}</td><td class="num">${p.partners}</td><td>${p.history ? '<span class="pill grey">Earlier numbers</span>' : `<span class="pill ${ST[p.status][1]}">${ST[p.status][0]}</span>`}</td>
        <td>${can('tm.manage') ? `<button class="small ghost" data-el="${p.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No projects yet.</td></tr>'}</tbody></table></div></div>`);
    if ($('#tmAddL')) $('#tmAddL').onclick = () => launchForm(null);
    $$('[data-el]').forEach((b) => (b.onclick = () => launchForm(d.rows.find((x) => x.id === +b.dataset.el))));
  }
  function launchForm(p) {
    const d = D.launch;
    C.dialog(`<h2>${p ? 'Edit project' : 'Add a project'}</h2>
      <label>Name</label><input name="name" required value="${esc(p?.name)}" placeholder="e.g. Dream Signature, Jogeshwari">
      <div class="row"><div><label>Location</label><input name="location" value="${esc(p?.location)}"></div><div><label>MahaRERA no.</label><input name="rera" value="${esc(p?.rera_no)}"></div></div>
      <label>Project in the ERP (for bookings)</label><select name="projectId"><option value="">Not in the ERP yet</option>${d.erpProjects.map((x) => `<option value="${x.id}" ${p?.project_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      ${p?.history ? '<input type="hidden" name="status" value="closed">' : `<div class="row"><div><label>Status</label><select name="status">${[['open', 'Open for uploads'], ['calling', 'Calling (uploads closed)'], ['closed', 'Closed']].map(([k, l]) => `<option value="${k}" ${(p?.status || 'open') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Partners can upload until</label><input type="date" name="uploadUntil" value="${esc(p?.upload_until || '')}"></div></div>`}
      ${p ? '' : '<label class="check"><input type="checkbox" name="history"> Numbers we already called earlier (not open to partners), e.g. the Dream Signature telecalling</label>'}
      <label>Notes</label><textarea name="notes" rows="2">${esc(p?.notes)}</textarea>`,
    async (x) => { await C.api('/api/tm', { action: 'project-save', id: p?.id, ...x, history: x.history === 'on' }); C.toast('Saved.'); launches(); });
  }

  // ---------- Call sheets ----------
  async function sheets() {
    const [s, cl, pr] = await Promise.all([C.api('/api/tm?sheets=1'), can('tm.manage') ? C.api('/api/tm?callers=1') : null, can('tm.manage') ? C.api('/api/tm?projects=1') : null]);
    const out = s.rows.filter((r) => r.status === 'out'), done = s.rows.filter((r) => r.status !== 'out');
    const row = (r) => `<tr><td>${dd(r.sheet_date)}</td><td>#${r.id}</td><td>${esc(r.caller)}</td><td>${esc(r.project)}</td><td class="num">${r.leads}</td>
      <td>${r.status === 'out' ? '<span class="pill warn">With the caller</span>' : r.status === 'entered' ? `<span class="pill good">Entered · ${r.calls} calls</span>` : '<span class="pill grey">Cancelled</span>'}</td>
      <td class="row-acts"><button class="small ghost" data-pr="${r.id}">Print</button> ${r.status === 'out' ? `<button class="small" data-en="${r.id}">Enter outcomes</button>${can('tm.manage') ? ` <button class="small danger" data-cx="${r.id}">Cancel</button>` : ''}` : r.status === 'entered' ? `<button class="small ghost" data-en="${r.id}">View</button>` : ''}</td></tr>`;
    const head = '<thead><tr><th>Date</th><th>Sheet</th><th>Caller</th><th>Project</th><th class="num">Numbers</th><th>Status</th><th></th></tr></thead>';
    const active = cl ? cl.rows.filter((c) => c.active) : [];
    const projs = pr ? pr.rows.filter((p) => p.status !== 'closed' || p.history) : [];
    body(`${can('tm.manage') ? `<div class="panel"><h2>Make today's call sheets</h2>
      ${active.length && projs.length ? `<form id="tmMk"><div class="row"><div><label>Project</label><select name="projectId">${projOpts(projs, '')}</select></div><div><label>Date</label><input type="date" name="date" value="${today()}"></div></div>
        <label>Callers working today</label><div class="tm-legend">${active.map((c) => `<label class="check" style="margin:0"><input type="checkbox" name="c" value="${c.id}" checked> ${esc(c.name)}</label>`).join('')}</div>
        <div class="row"><div><label>Numbers per caller</label><input type="number" name="per" value="100" min="1" max="300"></div><div></div></div>
        <p class="muted small">Call-backs that are due come first, then numbers not reachable last time (after a gap), then fresh numbers. Numbers on a sheet that is still out, and do-not-call numbers, are never given twice.</p>
        <div class="actions"><button>Make sheets</button></div><div id="tmMkM"></div></form>` : `<p class="muted">${active.length ? 'Add a project first (Projects tab).' : 'Add your telecallers first (Telecallers tab).'}</p>`}</div>` : ''}
      <div class="panel"><h2>With the callers</h2>${out.length ? `<div class="table-wrap"><table>${head}<tbody>${out.map(row).join('')}</tbody></table></div>` : '<p class="muted">No sheets are out.</p>'}</div>
      <div class="panel"><h2>Entered</h2>${done.length ? `<div class="table-wrap"><table>${head}<tbody>${done.slice(0, 100).map(row).join('')}</tbody></table></div>` : '<p class="muted">Nothing entered yet.</p>'}</div>`);
    if ($('#tmMk')) $('#tmMk').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, btn = $('button', f);
      const ids = $$('input[name=c]:checked', f).map((x) => +x.value);
      btn.disabled = true;
      try {
        const r = await C.api('/api/tm', { action: 'sheets-make', projectId: +f.projectId.value, date: f.date.value, perCaller: +f.per.value, callerIds: ids });
        C.toast(`${r.sheets.length} sheet${r.sheets.length === 1 ? '' : 's'} made with ${nf(r.assigned)} numbers. ${nf(r.waiting)} still waiting.`, 6000);
        await printSheets(r.sheets); sheets();
      } catch (x) { btn.disabled = false; $('#tmMkM').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    };
    $$('[data-pr]').forEach((b) => (b.onclick = () => printSheets([+b.dataset.pr])));
    $$('[data-en]').forEach((b) => (b.onclick = () => enter(+b.dataset.en)));
    $$('[data-cx]').forEach((b) => (b.onclick = async () => { if (!confirm('Cancel this sheet? Its numbers go back to the pool.')) return; try { await C.api('/api/tm', { action: 'sheet-cancel', id: +b.dataset.cx }); sheets(); } catch (e) { alert(e.message); } }));
  }
  async function printSheets(ids) {
    const all = await Promise.all(ids.map((id) => C.api('/api/tm?sheet=' + id)));
    let el = $('#tm-print'); if (!el) { el = document.createElement('div'); el.id = 'tm-print'; document.body.appendChild(el); }
    const legend = Object.entries(CODES).map(([k, v]) => `${k} ${v}`).join(' · ');
    el.innerHTML = all.map((d) => `<div class="pg"><h2>Dream India Realty · Call sheet #${d.sheet.id}</h2>
      <p>${esc(d.sheet.project)} · ${esc(d.sheet.caller)} · ${dd(d.sheet.sheet_date)} · ${d.leads.length} numbers</p>
      <p><b>Write the outcome number:</b> ${legend}. For a call back, write the date in Remarks.</p>
      <table><thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Config / area</th><th>Before</th><th>Outcome</th><th>Remarks</th></tr></thead><tbody>
      ${d.leads.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td><b>${esc(l.mobile)}</b></td><td>${esc([l.config, l.locality].filter(Boolean).join(' · '))}</td><td>${esc(l.last || '')}</td><td class="w"></td><td class="r"></td></tr>`).join('')}</tbody></table></div>`).join('');
    setTimeout(() => window.print(), 50);
  }
  async function enter(id) {
    const d = await C.api('/api/tm?sheet=' + id);
    const locked = d.sheet.status !== 'out' || !(can('tm.entry') || can('tm.manage'));
    body(`<p class="crumbs"><a href="#" id="tmBack">← Call sheets</a></p>
      <div class="panel"><h2>Sheet #${d.sheet.id} · ${esc(d.sheet.caller)}</h2><p class="muted">${esc(d.sheet.project)} · ${dd(d.sheet.sheet_date)} · ${d.leads.length} numbers</p>
      <div class="tm-legend">${Object.entries(CODES).map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join('')}<span><b>blank</b> not called</span></div>
      ${locked ? '' : '<p class="muted small">Type the number the caller wrote. Enter moves to the next row. For 3 (call back) you can set the date.</p>'}
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Outcome</th><th>Remarks</th><th>Call back on</th></tr></thead><tbody>
      ${d.leads.map((l, i) => { const e = l.entered; return `<tr data-l="${l.id}" class="${e ? 'done' : ''}"><td>${i + 1}</td><td>${esc(l.name)}<span class="tm-cd">${esc([l.config, l.locality].filter(Boolean).join(' · '))}</span></td><td>${esc(l.mobile)}</td>
        <td class="code"><input inputmode="numeric" maxlength="1" value="${e ? e.code : ''}" ${locked ? 'disabled' : ''}><span class="tm-cd lab">${e ? CODES[e.code] : ''}</span></td>
        <td><input class="rm" value="${esc(e ? e.remark || '' : '')}" maxlength="300" ${locked ? 'disabled' : ''}></td><td><input type="date" class="nx" ${locked ? 'disabled' : ''} style="width:auto"></td></tr>`; }).join('')}</tbody></table></div>
      ${locked ? '' : '<div class="actions"><button id="tmSave">Save outcomes</button><span class="muted small" id="tmCount"></span></div><div id="tmSaveM"></div>'}</div>`);
    $('#tmBack').onclick = (e) => { e.preventDefault(); sheets(); };
    if (locked) return;
    const codes = $$('td.code input');
    const count = () => { const n = codes.filter((x) => x.value).length; $('#tmCount').textContent = `${n} of ${codes.length} filled · blanks are kept as not called`; };
    codes.forEach((inp, i) => {
      inp.oninput = () => { inp.value = inp.value.replace(/[^1-8]/g, ''); $('.lab', inp.parentNode).textContent = CODES[inp.value] || ''; count(); if (inp.value && codes[i + 1]) codes[i + 1].focus(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); (codes[i + 1] || inp).focus(); } };
    });
    count(); if (codes[0]) codes[0].focus();
    $('#tmSave').onclick = async (e) => {
      const entries = $$('tr[data-l]').map((tr) => ({ leadId: tr.dataset.l, code: $('td.code input', tr).value, remark: $('.rm', tr).value, nextCall: $('.nx', tr).value }));
      const n = entries.filter((x) => x.code).length;
      if (!confirm(`Save ${n} outcome${n === 1 ? '' : 's'}${n < entries.length ? ` (${entries.length - n} left blank as not called)` : ''}? The sheet is then closed.`)) return;
      e.target.disabled = true;
      try { const r = await C.api('/api/tm', { action: 'outcomes-save', sheetId: id, entries }); C.toast(`Saved ${r.saved} outcomes.`); sheets(); }
      catch (x) { e.target.disabled = false; $('#tmSaveM').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    };
  }

  // ---------- Lookup ----------
  async function lookup() {
    body(`<div class="panel"><h2>Who registered this customer?</h2><p class="muted">Type a mobile number at a site visit or booking to see which partner owns the client, every record of the number, and any booking.</p>
      <form id="tmLk" class="tm-tools"><input name="m" inputmode="tel" placeholder="10-digit mobile" required style="max-width:220px"><button>Check</button></form><div id="tmLkR"></div></div>`);
    $('#tmLk').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await C.api('/api/tm?lookup=' + encodeURIComponent(e.target.m.value));
        $('#tmLkR').innerHTML = `${r.owner ? `<div class="tm-own"><b>${esc(r.owner.cpCode)} · ${esc(r.owner.firm)}</b> registered this client for ${esc(r.owner.project)} on ${dd(r.owner.since)}. Theirs until ${dd(r.owner.until)}.</div>` : '<div class="tm-own">No partner holds this client right now.</div>'}
          ${r.dnc ? '<p><span class="pill bad">Do not call</span></p>' : ''}
          ${r.bookings.length ? `<h3>Bookings in the ERP</h3><table><tr><th>Project</th><th>Flat</th><th>Date</th><th>Buyer</th><th>Partner on booking</th><th>Status</th></tr>${r.bookings.map((b) => `<tr><td>${esc(b.project)}</td><td><a href="#/booking/${b.bookingId}">${esc(b.unit)}</a></td><td>${dd(b.date)}</td><td>${esc(b.buyer)}</td><td>${esc([b.cpCode, b.firm].filter(Boolean).join(' · ') || 'Direct')}</td><td>${esc(b.status)}</td></tr>`).join('')}</table>` : ''}
          <h3>Records</h3>${r.leads.length ? `<table><tr><th>Project</th><th>Source</th><th>Partner</th><th>Uploaded</th><th>Owner until</th><th>Status</th><th>Last call</th><th>Remarks</th></tr>${r.leads.map((l) => `<tr><td>${esc(l.project)}</td><td>${l.source === 'history' ? 'Earlier calling' : 'Partner'}</td><td>${esc([l.cp_code, l.firm].filter(Boolean).join(' · '))}</td><td>${dd(l.uploaded_on)}</td><td>${dd(l.owner_until)}${l.active ? ' <span class="pill good">active</span>' : ''}</td><td>${esc(l.statusLabel)}</td><td>${esc(l.lastOutcome)}</td><td class="small">${esc(l.remarks || '')}</td></tr>`).join('')}</table>` : '<p class="muted">This number is not in the telecalling pool.</p>'}`;
      } catch (x) { $('#tmLkR').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    };
  }

  // ---------- Telecallers ----------
  async function callers() {
    const d = await C.api('/api/tm?callers=1');
    body(`<div class="tm-tools">${can('tm.manage') ? '<button id="tmAddC">Add a telecaller</button>' : ''}</div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th class="num">Daily rate</th><th>Joined</th><th class="num">Days</th><th class="num">Calls</th><th class="num">Site visits</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.mobile)}</td><td class="num">${rs(c.daily_rate)}</td><td>${dd(c.joined_on)}</td><td class="num">${c.days}</td><td class="num">${nf(c.calls)}</td><td class="num">${c.visits}</td>
        <td>${c.active ? '<span class="pill good">Working</span>' : '<span class="pill grey">Left</span>'}</td><td>${can('tm.manage') ? `<button class="small ghost" data-ec="${c.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No telecallers yet.</td></tr>'}</tbody></table></div></div>`);
    const form = (c) => C.dialog(`<h2>${c ? 'Edit telecaller' : 'Add a telecaller'}</h2><label>Name</label><input name="name" required value="${esc(c?.name)}">
      <div class="row"><div><label>Mobile</label><input name="mobile" value="${esc(c?.mobile)}"></div><div><label>Pay per day (₹)</label><input type="number" name="dailyRate" value="${c ? c.daily_rate : 1000}" min="0"></div></div>
      <div class="row"><div><label>Joined on</label><input type="date" name="joinedOn" value="${esc(c?.joined_on || today())}"></div><div></div></div>
      <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Working now</label>`,
    async (x) => { await C.api('/api/tm', { action: 'caller-save', id: c?.id, ...x, active: x.active === 'on' }); callers(); });
    if ($('#tmAddC')) $('#tmAddC').onclick = () => form(null);
    $$('[data-ec]').forEach((b) => (b.onclick = () => form(d.rows.find((x) => x.id === +b.dataset.ec))));
  }

  // ---------- Reports: the full report of a project, every figure opens to its rows (public/tcperf.js) ----------
  let rproj = null;
  async function reports() {
    const pr = (await C.api('/api/tm?projects=1')).rows;
    if (!pr.some((p) => String(p.id) === String(rproj))) rproj = (pr.find((p) => p.history) || pr[0] || {}).id;
    if (!rproj) return body('<div class="panel"><p class="muted">No projects yet.</p></div>');
    body(`<div class="tm-tools"><label class="small muted">Project</label><select id="tmRP">${projOpts(pr, rproj)}</select></div><div id="tmRep"></div>`);
    $('#tmRP').onchange = (e) => { rproj = e.target.value; reports(); };
    await window.TcPerf.render({ api: C.api, can }, { host: $('#tmRep'), project: rproj });
  }

  // ---------- Import earlier numbers ----------
  const b64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(file); });
  // the client's column first (e.g. "Client Name", not "Caller Name" or "CP Contact No"); partner, caller and manager columns last
  const guess = (h, re) => {
    const ok = h.map((x, i) => [String(x), i]).filter(([x]) => re.test(x));
    const rank = ([x]) => (/client|customer|lead|prospect/i.test(x) ? 0 : /\bcp\b|partner|caller|sourcing|manager|firm|broker/i.test(x) ? 2 : 1);
    ok.sort((a, b) => rank(a) - rank(b) || a[1] - b[1]);
    return ok.length && rank(ok[0]) < 2 ? ok[0][1] : -1; // only a partner / caller column: leave it for a person to choose
  };
  async function importTab() {
    const pr = await C.api('/api/tm?projects=1');
    body(`<div class="panel"><h2>Import numbers we already called</h2>
      <p class="muted">Numbers from earlier telecalling (for example the Dream Signature sheets). They are kept with their remarks; partners uploading the same number are told it is already in the Dream India database, and the numbers can be put on call sheets again.</p>
      <div class="row"><div><label>Put them under</label><select id="tmIP">${projOpts(pr.rows.filter((p) => p.history), '')}${projOpts(pr.rows.filter((p) => !p.history), '')}</select></div><div><label>File (.xlsx or .csv)</label><input type="file" id="tmIF" accept=".xlsx,.csv,.txt"></div></div>
      <div id="tmIM"></div>
      <p class="small muted" style="margin-top:14px">Imported with the wrong columns? <a href="#" id="tmIClear">Remove the earlier numbers of the chosen project</a> (only numbers not yet put on a call sheet), then import again.</p></div>`);
    $('#tmIClear').onclick = async (e) => {
      e.preventDefault();
      const sel = $('#tmIP'), name = sel.options[sel.selectedIndex].text;
      if (!confirm(`Remove the earlier numbers imported under "${name}" that have not been put on a call sheet? You can import the file again after this.`)) return;
      try { const r = await C.api('/api/tm', { action: 'import-clear', projectId: +sel.value }); alert(`Removed ${nf(r.removed)} numbers. ${nf(r.left)} earlier numbers are left under this project.`); }
      catch (x) { alert(x.message); }
    };
    $('#tmIF').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $('#tmIM').innerHTML = '<p class="muted">Reading…</p>';
      try {
        const { rows } = await C.api('/api/tm', { action: 'parse', file: await b64(f), name: f.name });
        if (rows.length < 2) throw new Error('The file has no rows under the header.');
        const h = rows[0], data = rows.slice(1);
        const cols = [['mobile', 'Mobile', /mob|phone|contact|number|cell/i], ['name', 'Name', /name/i], ['config', 'Configuration', /config|bhk|type|requirement/i], ['locality', 'Locality', /local|area|location|address/i], ['remark', 'Remarks', /remark|comment|feedback|note|status/i]];
        const opt = (sel) => '<option value="-1">—</option>' + h.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x || 'Column ' + (i + 1))}</option>`).join('');
        $('#tmIM').innerHTML = `<p><b>${nf(data.length)}</b> rows in ${esc(f.name)}. Match the columns:</p><div class="row">${cols.map(([k, l, re]) => `<div><label>${l}</label><select data-col="${k}">${opt(guess(h, re))}</select></div>`).join('')}</div>
          <div class="actions"><button id="tmIGo">Import ${nf(data.length)} rows</button></div><div id="tmIR"></div>`;
        $('#tmIGo').onclick = async (ev) => {
          const map = Object.fromEntries($$('[data-col]').map((s) => [s.dataset.col, +s.value]));
          if (map.mobile < 0) return alert('Choose the mobile number column.');
          const recs = data.map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? r[i] : ''])));
          ev.target.disabled = true; const tot = { added: 0, invalid: 0, alreadyThere: 0 };
          try {
            for (let i = 0; i < recs.length; i += 5000) {
              $('#tmIR').innerHTML = `<p class="muted">Importing ${nf(Math.min(i + 5000, recs.length))} of ${nf(recs.length)}…</p>`;
              const r = await C.api('/api/tm', { action: 'import', projectId: +$('#tmIP').value, rows: recs.slice(i, i + 5000), fileName: f.name });
              for (const k in tot) tot[k] += r[k];
            }
            $('#tmIR').innerHTML = `<div class="ok">Added ${nf(tot.added)} numbers. ${nf(tot.alreadyThere)} were already there and ${nf(tot.invalid)} were not valid mobile numbers.</div>`;
          } catch (x) { ev.target.disabled = false; $('#tmIR').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
        };
      } catch (x) { $('#tmIM').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    };
  }

  // ---------- Settings ----------
  let PEOPLE = [], AGR = '';
  async function settings() {
    const { settings: s, people, agreement } = await C.api('/api/tm?settings=1'); PEOPLE = people; AGR = agreement;
    body(`<div class="panel"><h2>Rules</h2><form id="tmS">
      <div class="row"><div><label>A partner keeps a client for (days)</label><input type="number" name="ownershipDays" value="${s.ownershipDays}" min="7" max="365"><p class="muted small">A site visit booked on a call starts the period again.</p></div>
      <div><label>Numbers we already called earlier</label><select name="historyPolicy"><option value="reject" ${s.historyPolicy !== 'accept' ? 'selected' : ''}>Stay with Dream India (partner is told)</option><option value="accept" ${s.historyPolicy === 'accept' ? 'selected' : ''}>Go to the partner who uploads them</option></select></div></div>
      <div class="row"><div><label>Tries for a number not reachable</label><input type="number" name="maxAttempts" value="${s.maxAttempts}" min="1" max="10"></div><div><label>Days between tries</label><input type="number" name="gapDays" value="${s.gapDays}" min="0" max="30"></div></div>
      <h3>Who approves partners</h3><p class="muted small">Only these people can approve a new partner, and only once PAN, GST, the MahaRERA certificate and the signed agreement are in.</p>
      <div class="tm-legend">${(PEOPLE || []).map((p) => `<label class="check" style="margin:0"><input type="checkbox" name="approver" value="${p.id}" ${(s.approvers || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
      <h3>Partner agreement</h3><p class="muted small">The text partners accept online or sign on paper. Have it checked by your lawyer before partners sign. Changing it makes a new version; partners who signed earlier stay on theirs.</p>
      <textarea name="agreementText" rows="10" style="font-size:12.5px">${esc(AGR || '')}</textarea>
      <h3>WhatsApp messages to partners</h3><p class="muted small">Approved template names in Click Connect. Until these are set, codes and the CP ID go by email.</p>
      <div class="row"><div><label>Verification code template (1 value: the code)</label><input name="waOtpTemplate" value="${esc(s.waOtpTemplate)}"></div><div><label>Welcome template (2 values: name, CP ID)</label><input name="waWelcomeTemplate" value="${esc(s.waWelcomeTemplate)}"></div></div>
      <div class="actions"><button>Save</button></div><div id="tmSM"></div></form></div>`);
    $('#tmS').onsubmit = async (e) => {
      e.preventDefault(); const x = Object.fromEntries(new FormData(e.target)); x.approvers = $$('[name=approver]:checked', e.target).map((i) => +i.value); delete x.approver;
      try { await C.api('/api/tm', { action: 'settings-save', settings: x }); $('#tmSM').innerHTML = '<div class="ok">Saved.</div>'; }
      catch (er) { $('#tmSM').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
    };
  }

  window.Telemarketing = { render };
})();
