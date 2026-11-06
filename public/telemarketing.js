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
  const PORTAL = /^erp\.dreamindiarealty\.com$/.test(location.hostname) ? 'https://partners.dreamindiarealty.com' : location.origin + '/partner';
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
      ['launches', 'Projects', can('tm.view') || can('tm.manage')], ['sheets', 'Call sheets', true], ['campaigns', 'SMS & AI calls', can('tm.view') || can('tm.manage')], ['lookup', 'Lookup', can('tm.view') || can('tm.manage')],
      ['callers', 'Telecallers', can('tm.view') || can('tm.manage')], ['import', 'Earlier numbers', can('tm.manage')], ['settings', 'Settings', can('tm.manage')],
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
      try { await ({ overview, reports, partners, launches, sheets, campaigns, lookup, callers, import: importTab, settings })[tab](); }
      catch (e) { $('#tmBody').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      return;
    }
    const T = tabs();
    $('#page').innerHTML = `<div class="tm">
      <div class="tm-hero"><div class="tm-eb">Management</div><h1>Telemarketing</h1>
        <p>Channel partners register and upload their clients; numbers are checked for duplicates and owners, called from printed sheets, and every result comes back here.</p>
        ${can('tm.view') || can('tm.manage') ? `<div class="tm-link">Partner portal link: <code>${esc(PORTAL)}</code><button type="button" id="tmCopy">Copy link</button></div>` : ''}</div>
      <nav class="ff-tabs no-print" role="tablist">${T.map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${k === tab}">${esc(l)}</button>`).join('')}</nav>
      <div id="tmBody"><p class="muted">Loading…</p></div></div>`;
    $$('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(C); }));
    if ($('#tmCopy')) $('#tmCopy').onclick = () => { navigator.clipboard.writeText(PORTAL).then(() => C.toast('Link copied.')); };
    try { await ({ overview, reports, partners, launches, sheets, campaigns, lookup, callers, import: importTab, settings })[tab](); }
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
    body(`<div class="tm-tools"><input class="search" id="tmQ" placeholder="Search firm, CP ID, contact, mobile, RERA no."><span class="muted small">${nf(d.rows.length)} registered${pend ? ` · <b>${pend} waiting for approval</b>` : ''}</span>
      <a class="btn ghost small" href="#/cpportal">Firms not on the portal yet, duplicates and merges</a></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>CP ID</th><th>Firm</th><th>Contact</th><th>Mobile</th><th>MahaRERA</th><th>Area</th><th class="num">Clients</th><th class="num">Active</th><th class="num">Bookings</th><th>Status</th><th></th></tr></thead><tbody id="tmPT"></tbody></table></div></div>`);
    const draw = (q) => {
      q = (q || '').toLowerCase();
      const rows = d.rows.filter((r) => !q || [r.cp_code, r.name, r.contact_person, r.phone, r.rera_no, r.username, r.office_area].join(' ').toLowerCase().includes(q));
      $('#tmPT').innerHTML = rows.map((r) => { const s = PST[r.portal_status] || ['', 'grey'];
        return `<tr><td>${esc(r.cp_code)}</td><td><a href="#" data-pv="${r.id}">${esc(r.name)}</a><span class="tm-cd">@${esc(r.username)}</span>${r.note && /^Possible match/.test(r.note) ? `<span class="tm-cd" style="color:#B54708" title="${esc(r.note)}">Possible match with a firm already in the ERP</span>` : ''}</td><td>${esc(r.contact_person)}${r.designation ? `<span class="tm-cd">${esc(r.designation)}</span>` : ''}</td>
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
        <label>Callers working today ${active.some((c) => String(c.roster_on || '').slice(0, 10) === today()) ? '<span class="muted small">(ticked: on today\'s agency list)</span>' : ''}</label><div class="tm-legend">${(() => { const onList = active.some((c) => String(c.roster_on || '').slice(0, 10) === today()); return active.map((c) => `<label class="check" style="margin:0"><input type="checkbox" name="c" value="${c.id}" ${!onList || String(c.roster_on || '').slice(0, 10) === today() ? 'checked' : ''}> ${esc(c.name)}${c.agency ? ` <span class="muted small">${esc(c.agency)}</span>` : ''}</label>`).join(''); })()}</div>
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
      ${locked ? '' : `<div class="tm-scan" style="border:1px dashed #0E8C9B;border-radius:12px;padding:12px 14px;margin:0 0 12px;background:#F2FBFC">
        <b>Scan the filled sheet</b> <span class="muted small">Take a straight photo of each page (or upload the scan / PDF). The outcomes are read and filled in below for you to check, then press Save.</span>
        <div class="actions" style="margin-top:8px"><label class="btn" style="cursor:pointer"><input type="file" id="tmScanF" accept="image/*,application/pdf" capture="environment" multiple hidden>Photo or scan of the sheet…</label><span class="muted small" id="tmScanM"></span></div></div>
        <p class="muted small">Or type the number the caller wrote. Enter moves to the next row. For 3 (call back) you can set the date.</p>`}
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
    // a photo: made smaller (long side 2000 px) so several pages fit in one request
    const shrink = (file) => new Promise((ok, no) => {
      if (file.type === 'application/pdf') { if (file.size > 3.5e6) return no(new Error('That PDF is too large; scan at a lower resolution or send photos.')); const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Could not read the file.')); return r.readAsDataURL(file); }
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82)); };
      img.onerror = () => no(new Error('That file is not a photo.')); img.src = url;
    });
    $('#tmScanF').onchange = async (e) => {
      const fs = [...e.target.files]; if (!fs.length) return;
      $('#tmScanM').textContent = `Reading ${fs.length} page${fs.length === 1 ? '' : 's'}… this takes up to a minute.`;
      try {
        const files = await Promise.all(fs.map(shrink));
        if (files.reduce((a, f) => a + f.length, 0) > 4.2e6) throw new Error('The pages are too large together. Send fewer pages at a time.');
        const r = await C.api('/api/tm', { action: 'sheet-scan', sheetId: id, files });
        let filled = 0, unsure = 0;
        for (const x of r.rows) {
          const tr = $(`tr[data-l="${x.leadId}"]`); if (!tr) continue;
          const ci = $('td.code input', tr);
          if (x.code) { ci.value = String(x.code); $('.lab', ci.parentNode).textContent = CODES[x.code] || ''; filled++; }
          if (x.remark) $('.rm', tr).value = x.remark;
          if (x.callback) $('.nx', tr).value = x.callback;
          tr.style.background = x.sure ? '#EAF7EE' : '#FFF4D6'; if (!x.sure) unsure++;
        }
        count();
        $('#tmScanM').innerHTML = `<b>${filled}</b> outcomes read and filled in.${unsure ? ` <b>${unsure}</b> rows in yellow were not clear: check them against the paper.` : ''} ${r.unclear ? esc(r.unclear) : ''} Check, correct, then press Save.`;
      } catch (x) { $('#tmScanM').innerHTML = `<span class="bad-t">${esc(x.message)}</span>`; }
      e.target.value = '';
    };
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
    const td = today(), ags = [...new Set(d.rows.map((c) => c.agency).filter(Boolean))].sort();
    let F = { q: '', show: 'working' };
    body(`<div class="tm-tools">${can('tm.manage') ? '<button id="tmUpC">Upload the agency\'s list</button><button class="ghost" id="tmAddC">Add one telecaller</button>' : ''}
        <input id="tmCQ" placeholder="Search name, mobile or agency" style="min-width:240px">
        <select id="tmCS"><option value="working">Working</option><option value="today">On today's list</option><option value="all">Everyone</option><option value="left">Left</option></select>
        <span class="muted small" id="tmCN"></span></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th>Agency</th><th class="num">Daily rate</th><th>Last on list</th><th class="num">Days</th><th class="num">Calls</th><th class="num">Site visits</th><th>Status</th><th></th></tr></thead><tbody id="tmCT"></tbody></table></div></div>`);
    const draw = () => {
      const q = F.q.toLowerCase();
      const rows = d.rows.filter((c) => (F.show === 'all' || (F.show === 'working' && c.active) || (F.show === 'left' && !c.active) || (F.show === 'today' && String(c.roster_on || '').slice(0, 10) === td))
        && (!q || [c.name, c.mobile, c.agency].join(' ').toLowerCase().includes(q)));
      $('#tmCN').textContent = `${rows.length} of ${d.rows.length}`;
      $('#tmCT').innerHTML = rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.mobile)}</td><td>${esc(c.agency || '')}</td><td class="num">${rs(c.daily_rate)}</td><td>${c.roster_on ? dd(c.roster_on) : ''}</td><td class="num">${c.days}</td><td class="num">${nf(c.calls)}</td><td class="num">${c.visits}</td>
        <td>${c.active ? '<span class="pill good">Working</span>' : '<span class="pill grey">Left</span>'}</td><td>${can('tm.manage') ? `<button class="small ghost" data-ec="${c.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No telecallers here.</td></tr>';
      $$('[data-ec]').forEach((b) => (b.onclick = () => form(d.rows.find((x) => x.id === +b.dataset.ec))));
    };
    $('#tmCQ').oninput = (e) => { F.q = e.target.value.trim(); draw(); };
    $('#tmCS').onchange = (e) => { F.show = e.target.value; draw(); };
    const form = (c) => C.dialog(`<h2>${c ? 'Edit telecaller' : 'Add a telecaller'}</h2><label>Name</label><input name="name" required value="${esc(c?.name)}">
      <div class="row"><div><label>Mobile</label><input name="mobile" value="${esc(c?.mobile)}"></div><div><label>Pay per day (₹)</label><input type="number" name="dailyRate" value="${c ? c.daily_rate : 1000}" min="0"></div></div>
      <div class="row"><div><label>Agency</label><input name="agency" list="tmAgL" value="${esc(c?.agency || '')}" placeholder="Our own staff, or the agency's name"><datalist id="tmAgL">${ags.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></div><div><label>Joined on</label><input type="date" name="joinedOn" value="${esc(c?.joined_on || today())}"></div></div>
      <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Working now</label>`,
    async (x) => { await C.api('/api/tm', { action: 'caller-save', id: c?.id, ...x, active: x.active === 'on' }); callers(); });
    if ($('#tmAddC')) $('#tmAddC').onclick = () => form(null);
    if ($('#tmUpC')) $('#tmUpC').onclick = () => {
      const dl = C.dialog(`<h2>Upload the agency's list of telecallers</h2>
        <p class="muted small">An Excel or CSV file from the agency, one row per caller: name and mobile (agency and pay per day if they are in the file). Callers already here (same mobile) are updated, not added twice. Everyone on the list is marked as working on the day you choose, and is ticked when you make that day's call sheets.</p>
        <div class="row"><div><label>Working on</label><input type="date" name="date" value="${today()}"></div><div><label>Agency (if not in the file)</label><input name="agency" list="tmAgL2"><datalist id="tmAgL2">${ags.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></div></div>
        <div class="row"><div><label>Pay per day (₹, if not in the file)</label><input type="number" name="rate" min="0" placeholder="1000"></div><div><label>File (.xlsx or .csv)</label><input type="file" id="tmCF" accept=".xlsx,.csv,.txt"></div></div>
        <div id="tmCM"></div>`, async (x, f) => {
        if (!f._recs) throw new Error('Choose the file first.');
        const r = await C.api('/api/tm', { action: 'callers-import', rows: f._recs(), date: x.date, agency: x.agency, dailyRate: x.rate, fileName: f._name });
        C.toast(`${r.added} callers added and ${r.updated} updated for ${dd(r.date)}.${r.skipped.length ? ` ${r.skipped.length} rows skipped (no name or repeated).` : ''}`, 7000);
        callers();
      });
      $('#tmCF', dl).onchange = async (e) => {
        const file = e.target.files[0], f = $('form', dl); if (!file) return;
        $('#tmCM', dl).innerHTML = '<p class="muted">Reading…</p>';
        try {
          const { rows } = await C.api('/api/tm', { action: 'parse', file: await b64(file), name: file.name });
          if (rows.length < 2) throw new Error('The file has no rows under the header.');
          const h = rows[0], data = rows.slice(1).filter((r) => r.some((v) => String(v || '').trim()));
          const cols = [['name', 'Name *', /name/i], ['mobile', 'Mobile', /mob|phone|contact|number|cell/i], ['agency', 'Agency', /agency|company|vendor|firm/i], ['dailyRate', 'Pay per day', /rate|pay|salary|wage|amount/i]];
          const opt = (sel) => '<option value="-1">— not in the file —</option>' + h.map((v, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(v || 'Column ' + (i + 1))}</option>`).join('');
          $('#tmCM', dl).innerHTML = `<p><b>${nf(data.length)}</b> callers in ${esc(file.name)}. Match the columns:</p><div class="row">${cols.map(([k, l, re]) => `<div><label>${l}</label><select data-cc="${k}">${opt(guess(h, re))}</select></div>`).join('')}</div>`;
          f._name = file.name;
          f._recs = () => { const map = Object.fromEntries($$('[data-cc]', dl).map((x) => [x.dataset.cc, +x.value])); if (map.name < 0) throw new Error('Choose the name column.'); return data.map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? r[i] : '']))); };
        } catch (x) { $('#tmCM', dl).innerHTML = `<div class="err">${esc(x.message)}</div>`; }
      };
    };
    draw();
  }

  // ---------- Reports: the full report of a project, every figure opens to its rows (public/tcperf.js) ----------
  let rproj = null;
  let rview = 'daily', P = null;
  async function reports() {
    const pr = (await C.api('/api/tm?projects=1')).rows;
    const sw = `<div class="tm-tools" style="margin:0 0 12px"><button type="button" class="${rview === 'daily' ? '' : 'ghost'}" data-rv="daily">Daily performance</button><button type="button" class="${rview === 'project' ? '' : 'ghost'}" data-rv="project">Project report</button></div>`;
    if (rview === 'daily') { body(sw + '<div id="tmRep"></div>'); hookRv(); return daily(pr); }
    if (!pr.some((p) => String(p.id) === String(rproj))) rproj = (pr.find((p) => p.history) || pr[0] || {}).id;
    if (!rproj) return body(sw + '<div class="panel"><p class="muted">No projects yet.</p></div>');
    body(sw + `<div class="tm-tools"><label class="small muted">Project</label><select id="tmRP">${projOpts(pr, rproj)}</select></div><div id="tmRep"></div>`);
    hookRv();
    $('#tmRP').onchange = (e) => { rproj = e.target.value; reports(); };
    await window.TcPerf.render({ api: C.api, can }, { host: $('#tmRep'), project: rproj });
  }
  const hookRv = () => $$('[data-rv]').forEach((b) => (b.onclick = () => { rview = b.dataset.rv; reports(); }));
  // Daily performance: the whole campaign day by day, every caller and every agency, from the sheets entered
  async function daily(pr) {
    P = P || { from: '', to: '', project: '', caller: '', sort: 'visits' };
    const qs = new URLSearchParams({ perf: 1, from: P.from, to: P.to, project: P.project });
    const d = await C.api('/api/tm?' + qs);
    P.from = d.from; P.to = d.to;
    const T = d.total, pc = (v) => Math.round(v * 100) + '%', money = (v) => (v == null ? '–' : rs(v));
    const COLS = [['calls', 'Calls'], ['connected', 'Connected'], ['interested', 'Interested'], ['visits', 'Site visits'], ['callbacks', 'Call back'], ['not_interested', 'Not interested'], ['not_reachable', 'Not reachable'], ['wrong', 'Wrong no.'], ['dnc', 'Do not call']];
    const nums = (r) => COLS.map(([k]) => `<td class="num">${nf(r[k])}</td>`).join('');
    const rates = (r) => `<td class="num">${pc(r.connectRate)}</td><td class="num">${rs(r.cost)}</td><td class="num">${money(r.perInterested)}</td><td class="num">${money(r.perVisit)}</td>`;
    const head = (first) => `<tr>${first}${COLS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th class="num">Connect %</th><th class="num">Cost</th><th class="num">Per interested</th><th class="num">Per visit</th></tr>`;
    const sortK = P.sort;
    const callers = [...d.callers].sort((a, b) => (sortK === 'name' ? a.name.localeCompare(b.name) : (b[sortK] || 0) - (a[sortK] || 0)));
    const ai = {}; for (const c of d.campaigns || []) { ai[c.kind] = ai[c.kind] || {}; ai[c.kind][c.status] = c.n; }
    const aiCalls = ai.call || {}, sms = ai.sms || {};
    $('#tmRep').innerHTML = `<div class="tm-tools"><label class="small muted">From</label><input type="date" id="pfF" value="${P.from}"><label class="small muted">To</label><input type="date" id="pfT" value="${P.to}">
        <button class="ghost small" data-pd="0">Today</button><button class="ghost small" data-pd="1">Yesterday</button><button class="ghost small" data-pd="7">Last 7 days</button><button class="ghost small" data-pd="30">Last 30 days</button>
        <select id="pfP"><option value="">All projects</option>${projOpts(pr.filter((p) => !p.history), P.project)}</select>
        <button class="ghost small" id="pfX">Download for Excel</button></div>
      <div class="tm-k">
        <div><b>${nf(T.callers)}</b><span>Callers worked</span><small>${nf(T.callerDays)} caller-days</small></div>
        <div><b>${nf(T.calls)}</b><span>Calls made</span><small>${Math.round(T.callsPerDay)} a caller a day${T.given ? ` · ${pc(T.calls / T.given)} of numbers given` : ''}</small></div>
        <div><b>${nf(T.connected)}</b><span>Connected</span><small>${pc(T.connectRate)} of calls</small></div>
        <div><b>${nf(T.interested)}</b><span>Interested</span><small>${pc(T.interestRate)} of connected (with visits)</small></div>
        <div><b>${nf(T.visits)}</b><span>Site visits booked</span><small>${T.callerDays ? (T.visits / T.callerDays).toFixed(2) : 0} a caller a day</small></div>
        <div><b>${rs(T.cost)}</b><span>Telecaller cost</span><small>${money(T.perInterested)} per interested · ${money(T.perVisit)} per visit</small></div>
        ${aiCalls && Object.keys(aiCalls).length ? `<div><b>${nf(aiCalls.pressed1 || 0)}</b><span>Pressed 1 on AI calls</span><small>${nf(Object.values(aiCalls).reduce((a, v) => a + v, 0))} AI calls</small></div>` : ''}
        ${sms && Object.keys(sms).length ? `<div><b>${nf((sms.delivered || 0) + (sms.sent || 0))}</b><span>SMS sent</span><small>${nf(sms.failed || 0)} failed</small></div>` : ''}
      </div>
      <div class="panel"><h2>Day by day</h2>${d.days.length ? `<div class="table-wrap"><table><thead>${head('<th>Day</th><th class="num">Callers</th>')}</thead><tbody>
        ${d.days.map((r) => `<tr class="clickable" data-day="${r.date}"><td>${dd(r.date)}</td><td class="num">${r.callers}</td>${nums(r)}${rates(r)}</tr>`).join('')}
        <tr class="tot"><td>Total</td><td class="num">${nf(T.callers)}</td>${nums(T)}${rates(T)}</tr></tbody></table></div><p class="small muted">Tap a day to see only that day's callers.</p>` : '<p class="muted">No call sheets entered in these days.</p>'}</div>
      <div class="panel"><h2>Each telecaller ${P.from === P.to ? '· ' + dd(P.from) : `· ${dd(P.from)} to ${dd(P.to)}`}</h2>
        <div class="tm-tools"><label class="small muted">Rank by</label><select id="pfS">${[['visits', 'Site visits'], ['interested', 'Interested'], ['connected', 'Connected'], ['calls', 'Calls'], ['connectRate', 'Connect %'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${k === sortK ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="pfQ" placeholder="Search caller or agency"></div>
        ${callers.length ? `<div class="table-wrap"><table><thead>${head('<th>#</th><th>Caller</th><th>Agency</th><th class="num">Days</th>')}</thead><tbody id="pfCB">
        ${callers.map((r, i) => `<tr data-cq="${esc((r.name + ' ' + r.agency).toLowerCase())}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.agency)}</td><td class="num">${r.callerDays}</td>${nums(r)}${rates(r)}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">No calls entered.</p>'}</div>
      ${d.agencies.length > 1 ? `<div class="panel"><h2>Each agency</h2><div class="table-wrap"><table><thead>${head('<th>Agency</th><th class="num">Callers</th>')}</thead><tbody>
        ${d.agencies.map((r) => `<tr><td>${esc(r.agency)}</td><td class="num">${r.callers}</td>${nums(r)}${rates(r)}</tr>`).join('')}</tbody></table></div></div>` : ''}`;
    const go = () => daily(pr);
    $('#pfF').onchange = (e) => { P.from = e.target.value; go(); };
    $('#pfT').onchange = (e) => { P.to = e.target.value; go(); };
    $('#pfP').onchange = (e) => { P.project = e.target.value; go(); };
    $('#pfS').onchange = (e) => { P.sort = e.target.value; go(); };
    if ($('#pfQ')) $('#pfQ').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$('#pfCB tr').forEach((tr) => (tr.hidden = !!q && !tr.dataset.cq.includes(q))); };
    $$('[data-pd]').forEach((b) => (b.onclick = () => { const k = +b.dataset.pd, t = today(); const back = (n) => new Date(Date.parse(t + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
      if (k === 0) { P.from = P.to = t; } else if (k === 1) { P.from = P.to = back(1); } else { P.from = back(k - 1); P.to = t; } go(); }));
    $$('[data-day]').forEach((tr) => (tr.onclick = () => { P.from = P.to = tr.dataset.day; go(); }));
    $('#pfX').onclick = () => {
      const H = ['Day', 'Caller', 'Agency', 'Pay per day', ...COLS.map(([, l]) => l), 'Numbers given'];
      const rows = d.lines.map((l) => [l.call_date, l.name || '', l.agency || '', l.rate, ...COLS.map(([k]) => l[k]), l.given]);
      const csv = [H, ...rows].map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `telecaller-performance-${P.from}-to-${P.to}.csv`; a.click();
    };
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

  // ---------- SMS & AI calls ----------
  const CST = { draft: ['Draft: waiting for approval', 'warn'], approved: ['Approved: not started', 'warn'], running: ['Sending', 'good'], paused: ['Paused', 'grey'], done: ['Finished', 'good'], cancelled: ['Cancelled', 'grey'] };
  let cproj = '';
  async function campaigns() {
    const [K, pr] = await Promise.all([C.api('/api/tm?campaigns=1' + (cproj ? '&project=' + cproj : '')), C.api('/api/tm?projects=1')]);
    const projs = pr.rows.filter((p) => !p.history);
    const R = K.ready, sum = (r, ks) => ks.reduce((a, k) => a + ((r.by_status || {})[k] || 0), 0);
    const miss = (k) => (R[k].length ? `<span class="pill warn">Not ready</span> <span class="small muted">needs ${esc(R[k].join('; '))}</span>` : '<span class="pill good">Ready</span>');
    body(`<div class="panel"><h2>SMS and AI calls to partner numbers</h2>
      <p class="muted">Send an SMS, or an AI voice call that introduces Dream India and the project and asks: <b>press 1</b> if interested, <b>press 2</b> if not. Everyone who presses 1 goes to the top of the next call sheets for the telecallers.</p>
      <p class="small muted">Only numbers a partner uploaded with the consent declaration are used. Never: people on the do-not-contact list (${nf(K.dnc)} numbers), existing customers, or anyone sent the same kind of campaign in the last 30 days. Every campaign is approved by Rafi Sir or Sameer before it starts, and sends only within the hours in Settings.</p>
      <div class="tm-k" style="margin-top:10px"><div><b>SMS</b><span>${miss('sms')}</span></div><div><b>AI calls (press 1 / 2)</b><span>${miss('call')}</span></div><div><b>AI conversation calls</b><span>${miss('agent')}</span></div></div>
      <p class="small muted"><b>AI conversation</b>: an AI voice that talks like a person (English or Hindi), answers basic questions from your briefing, asks what they want, and books the site visit. The ERP reads every call: visits booked, interested and call-backs go to the top of the telecallers' next sheets; "never call me" goes on the do-not-contact list.</p>
      ${can('tm.manage') ? `<div class="actions"><button id="cNewS">New SMS campaign</button><button id="cNewC">New AI call (press 1 / 2)</button><button id="cNewA">New AI conversation campaign</button><button class="ghost" id="cDnc">Add to do-not-contact</button></div>` : ''}</div>
      <div class="tm-tools"><label class="small muted">Project</label><select id="cP"><option value="">All projects</option>${projOpts(projs, cproj)}</select></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Type</th><th>Project</th><th class="num">Numbers</th><th class="num">Sent / called</th><th class="num">Interested / pressed 1</th><th class="num">Not interested</th><th>Status</th><th></th></tr></thead><tbody>
      ${K.rows.map((r) => `<tr class="clickable" data-cv="${r.id}"><td><b>${esc(r.name)}</b><div class="small muted">by ${esc(r.created_by_name || '')} · ${dd(r.created_at)}</div></td><td>${{ sms: 'SMS', call: 'AI call', agent: 'AI conversation' }[r.kind]}</td><td>${esc(r.project)}</td>
        <td class="num">${nf(r.targets)}</td><td class="num">${nf(r.targets - sum(r, ['queued']))}</td><td class="num">${r.kind === 'call' ? nf(sum(r, ['pressed1'])) : r.kind === 'agent' ? nf(sum(r, ['visit_booked', 'interested', 'callback'])) : ''}</td><td class="num">${r.kind === 'call' ? nf(sum(r, ['pressed2'])) : r.kind === 'agent' ? nf(sum(r, ['not_interested', 'dnc'])) : ''}</td>
        <td><span class="pill ${CST[r.status][1]}">${CST[r.status][0]}</span>${r.note ? `<div class="small bad-t">${esc(r.note)}</div>` : ''}</td><td><button class="small ghost" data-cv="${r.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">No campaigns yet.</td></tr>'}</tbody></table></div></div>`);
    $('#cP').onchange = (e) => { cproj = e.target.value; campaigns(); };
    $$('[data-cv]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); campaign(+b.dataset.cv); }));
    if ($('#cNewS')) $('#cNewS').onclick = () => campForm('sms', null, projs);
    if ($('#cNewC')) $('#cNewC').onclick = () => campForm('call', null, projs);
    if ($('#cNewA')) $('#cNewA').onclick = () => campForm('agent', null, projs);
    if ($('#cDnc')) $('#cDnc').onclick = () => C.dialog(`<h2>Add to do-not-contact</h2><p class="muted small">These numbers are never sent an SMS or AI call, never put on a call sheet, and no partner can upload them again.</p>
      <label>Mobile numbers (one per line, or separated by commas)</label><textarea name="numbers" rows="8" required></textarea><label>Reason</label><input name="reason" placeholder="e.g. asked on WhatsApp not to be contacted">`,
      async (x) => { const r = await C.api('/api/tm', { action: 'dnc-add', ...x }); C.toast(`${r.added} added${r.already ? `, ${r.already} were already on the list` : ''}.`); campaigns(); });
  }
  function campForm(kind, c, projs) {
    const p0 = c ? c.tm_project_id : projs[0] && projs[0].id;
    const proj = (id) => projs.find((p) => String(p.id) === String(id)) || {};
    const defBrief = (p) => `Project: ${p.name || ''}${p.location ? ', ' + p.location : ''}.${p.rera_no ? ' MahaRERA No. ' + p.rera_no + '.' : ' Not yet RERA registered: do not give prices or take bookings, only register interest.'}
Say: you are calling from Dream India Realty; they shared their interest in property with our channel partner.
Find out: which home (1, 2 or 3 BHK), budget, when they plan to buy, to live in or invest.
If interested, book a site visit: any day except Monday, 10 am to 7 pm. Confirm the day and time.
Answer only from these facts. For anything else, say a sales advisor will call them. Never promise prices, offers or dates.
If they ask not to be called again, apologise and end the call.`;
    const defScript = (p) => `Namaste. This is a call from Dream India Realty, Mumbai. We are launching our new residential project ${p.name || ''}${p.location ? ' in ' + p.location : ''}. You are receiving this call because you shared your interest in property with our channel partner. If you would like to know more, or visit the site, please press 1. If you are not interested, please press 2. Thank you.`;
    const ST = [['fresh', 'Not called yet'], ['not_reachable', 'Not reachable last time'], ['callback', 'Asked to call back'], ['interested', 'Interested']];
    const f = (c && c.filters) || {}, st = f.statuses || (kind === 'sms' ? ['fresh', 'not_reachable', 'callback', 'interested'] : kind === 'agent' ? ['fresh', 'not_reachable', 'ai_interested'] : ['fresh', 'not_reachable']);
    if (kind === 'agent' && !ST.some((x) => x[0] === 'ai_interested')) ST.push(['ai_interested', 'Pressed 1 on an AI call']);
    const dl = C.dialog(`<h2>${c ? 'Edit' : 'New'} ${{ sms: 'SMS', call: 'AI call', agent: 'AI conversation' }[kind]} campaign</h2>
      <div class="row"><div><label>Project</label><select name="projectId">${projOpts(projs, p0)}</select></div><div><label>Name</label><input name="name" value="${esc(c ? c.name : '')}" placeholder="e.g. Pre-launch intro, week 1"></div></div>
      ${kind === 'sms' ? `<label>SMS text <span class="muted small">(word for word your template approved on DLT; promotional SMS go only to numbers not on DND)</span></label><textarea name="message" rows="4" maxlength="480" required>${esc(c ? c.message : '')}</textarea>
        <div class="row"><div><label>DLT template ID of this text</label><input name="templateId" value="${esc(c ? c.template_id || '' : '')}"></div><div><label>Most a day</label><input type="number" name="dailyCap" value="${c ? c.daily_cap : 2000}" min="50" max="20000"></div></div>`
      : kind === 'agent' ? `<label>Briefing for the AI caller <span class="muted small">(what it says about the project and what it finds out; it answers only from this)</span></label><textarea name="script" rows="9" maxlength="3000" required>${esc(c ? c.script : defBrief(proj(p0)))}</textarea>
        <div class="row"><div><label>Most calls a day</label><input type="number" name="dailyCap" value="${c ? c.daily_cap : 300}" min="50" max="20000"><p class="small muted">Conversation calls cost per minute: start with about 300 a day.</p></div><div></div></div>`
      : `<label>What the AI voice says <span class="muted small">(it must end with press 1 / press 2)</span></label><textarea name="script" rows="6" maxlength="2000" required>${esc(c ? c.script : defScript(proj(p0)))}</textarea>
        <div class="row"><div><label>Most calls a day</label><input type="number" name="dailyCap" value="${c ? c.daily_cap : 500}" min="50" max="20000"><p class="small muted">Start small (about 500) and watch the complaints for a few days before you raise it.</p></div><div></div></div>`}
      <label>Which numbers</label><div class="tm-legend">${ST.map(([k, l]) => `<label class="check" style="margin:0"><input type="checkbox" name="st" value="${k}" ${st.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="legacy" ${f.includeLegacy ? 'checked' : ''}> Also numbers uploaded before 6 Nov 2026 <span class="muted small">(the partner ticked a shorter declaration then)</span></label>
      <div id="cPrev" class="small" style="margin-top:8px"></div>`,
    async (x, form) => {
      const filters = { statuses: $$('[name=st]:checked', form).map((i) => i.value), includeLegacy: !!$('[name=legacy]', form).checked };
      const r = await C.api('/api/tm', { action: 'campaign-save', id: c ? c.id : undefined, kind, projectId: +x.projectId, name: x.name, message: x.message, templateId: x.templateId, script: x.script, dailyCap: +x.dailyCap, filters });
      C.toast('Saved as a draft. Rafi Sir or Sameer approves it before it starts.', 6000); campaign(r.id);
    });
    const prev = async () => {
      const form = $('form', dl), filters = { statuses: $$('[name=st]:checked', form).map((i) => i.value), includeLegacy: !!$('[name=legacy]', form).checked };
      $('#cPrev', dl).textContent = 'Counting…';
      try { const r = await C.api('/api/tm', { action: 'campaign-preview', kind, projectId: +form.projectId.value, filters });
        $('#cPrev', dl).innerHTML = `<b>${nf(r.count)}</b> numbers would get this now, out of ${nf(r.partnerNumbers)} numbers partners uploaded for this project.${r.legacy && !filters.includeLegacy ? ` ${nf(r.legacy)} from before the full declaration are left out.` : ''}${r.customersLeftOut ? ` ${nf(r.customersLeftOut)} existing customers left out.` : ''}`; }
      catch (e) { $('#cPrev', dl).innerHTML = `<span class="bad-t">${esc(e.message)}</span>`; }
    };
    dl.addEventListener('change', (e) => { if (e.target.name === 'projectId' && kind !== 'sms' && !c) { const ta = $('[name=script]', dl); ta.value = (kind === 'agent' ? defBrief : defScript)(proj(e.target.value)); } prev(); });
    prev();
  }
  async function campaign(id) {
    const d = await C.api('/api/tm?campaign=' + id), c = d.campaign, B = d.byStatus || {}, L = d.labels;
    const total = Object.values(B).reduce((a, v) => a + v, 0);
    const sent = total - (B.queued || 0) - (B.sending || 0);
    const acts = [];
    if (c.status === 'draft' && can('tm.manage')) acts.push('<button class="ghost" data-ca="edit">Edit</button>');
    if (c.status === 'draft' && d.canApprove) acts.push('<button data-ca="approve">Approve</button>');
    if (['approved', 'paused'].includes(c.status) && can('tm.manage')) acts.push(`<button data-ca="start">${c.status === 'paused' ? 'Carry on sending' : 'Start sending'}</button>`);
    if (c.status === 'running' && can('tm.manage')) acts.push('<button class="ghost" data-ca="pause">Pause</button>');
    if (!['done', 'cancelled'].includes(c.status) && can('tm.manage')) { acts.push('<button class="ghost" data-ca="test">Send a test to my phone</button>'); acts.push('<button class="danger" data-ca="cancel">Cancel</button>'); }
    body(`<p class="crumbs"><a href="#" id="cBack">← SMS & AI calls</a></p>
      <div class="panel"><h2>${esc(c.name)}</h2><p class="muted">${{ sms: 'SMS', call: 'AI call', agent: 'AI conversation' }[c.kind]} · ${esc(c.project)} · <span class="pill ${CST[c.status][1]}">${CST[c.status][0]}</span> · most ${nf(c.daily_cap)} a day</p>
      ${c.note ? `<div class="err">${esc(c.note)}</div>` : ''}
      <div style="background:#F6F7FB;border-radius:12px;padding:12px 14px;margin:10px 0;white-space:pre-wrap">${esc(c.kind === 'sms' ? c.message : c.script)}</div>
      ${c.kind === 'sms' ? `<p class="small muted">DLT template ID: ${esc(c.template_id || 'not given yet')}</p>` : ''}
      ${c.status === 'draft' ? `<p class="small muted">${d.canApprove ? 'Check the words and the numbers, then approve. The list of numbers is fixed when you approve.' : 'Waiting for Rafi Sir or Sameer to approve.'}</p>` : ''}
      <div class="actions">${acts.join('')}</div><div id="cM"></div></div>
      ${total ? `<div class="tm-k">${[['Numbers', total], ['Sent / called', sent], ...(c.kind === 'call' ? [['Pressed 1', B.pressed1 || 0], ['Pressed 2', B.pressed2 || 0], ['No answer', B.no_answer || 0], ['Answered, no key', B.no_input || 0]] : c.kind === 'agent' ? [['Site visits booked', B.visit_booked || 0], ['Interested', B.interested || 0], ['Call back', B.callback || 0], ['Not interested', B.not_interested || 0], ['Never call', B.dnc || 0], ['No answer', B.no_answer || 0]] : [['Delivered', B.delivered || 0], ['On DND', B.dnd || 0]]), ['Failed', B.failed || 0], ['Waiting', B.queued || 0]]
        .map(([l, v]) => `<div><b>${nf(v)}</b><span>${l}</span></div>`).join('')}</div>
      <div class="panel"><h2>Every status</h2><table>${Object.entries(B).map(([k, v]) => `<tr><td>${esc(L[k] || k)}</td><td class="num"><b>${nf(v)}</b></td></tr>`).join('')}</table></div>` : ''}
      ${d.days.length ? `<div class="panel"><h2>Day by day</h2><table><tr><th>Day</th><th class="num">Sent / called</th>${c.kind === 'call' ? '<th class="num">Pressed 1</th><th class="num">Pressed 2</th>' : ''}<th class="num">Failed / DND</th></tr>
        ${d.days.map((x) => `<tr><td>${dd(x.sent_on)}</td><td class="num">${nf(x.n)}</td>${c.kind === 'call' ? `<td class="num">${nf(x.p1)}</td><td class="num">${nf(x.p2)}</td>` : ''}<td class="num">${nf(x.bad)}</td></tr>`).join('')}</table></div>` : ''}
      ${c.kind !== 'sms' && d.pressed.length ? `<div class="panel"><h2>${c.kind === 'agent' ? 'Site visits, interested and call-backs' : 'Pressed 1: interested'} (${nf(d.pressed.length)})</h2><p class="muted small">They are at the top of the next call sheets. Make today's sheets to give them to the telecallers.</p>
        <div class="table-wrap"><table><tr><th>When</th><th>Name</th><th>Mobile</th><th>Partner</th>${c.kind === 'agent' ? '<th>AI call result</th><th>Site visit</th><th></th>' : ''}<th>Now</th></tr>${d.pressed.map((p) => `<tr><td>${dd(p.updated_at)}</td><td>${esc(p.name || '')}</td><td>${esc(p.mobile)}</td><td>${esc(p.partner || '')}</td>${c.kind === 'agent' ? `<td><b>${esc(p.outcome)}</b><div class="small muted">${esc(p.summary || '')}</div></td><td>${p.visit_date ? `<b>${dd(p.visit_date)}${p.visit_time ? ' ' + esc(p.visit_time) : ''}</b>` : ''}</td><td>${p.recording ? `<a href="${esc(p.recording)}" target="_blank" rel="noopener">Listen</a>` : ''}</td>` : ''}<td>${esc(p.status)}</td></tr>`).join('')}</table></div></div>` : ''}`);
    $('#cBack').onclick = (e) => { e.preventDefault(); campaigns(); };
    $$('[data-ca]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.ca;
      try {
        if (a === 'edit') { const pr = await C.api('/api/tm?projects=1'); return campForm(c.kind, c, pr.rows.filter((p) => !p.history)); }
        if (a === 'test') return C.dialog(`<h2>Send a test</h2><p class="muted small">One ${c.kind === 'sms' ? 'SMS' : 'call'} to a staff phone, to check ${c.kind === 'sms' ? 'the text' : 'how it sounds and that pressing 1 and 2 works'}. Not counted.</p><label>Mobile</label><input name="mobile" required inputmode="numeric">`,
          async (x) => { await C.api('/api/tm', { action: 'campaign-test', id, mobile: x.mobile }); C.toast('Test sent.'); });
        if (a === 'approve' && !confirm(`Approve "${c.name}"? The numbers that qualify now will get this ${c.kind === 'sms' ? 'SMS' : 'call'} once it is started.`)) return;
        if (a === 'start' && !confirm(`Start sending? Up to ${nf(c.daily_cap)} a day, only within the hours in Settings.`)) return;
        if (a === 'cancel' && !confirm('Cancel this campaign? Numbers not yet sent will not get it.')) return;
        const r = await C.api('/api/tm', { action: 'campaign-' + a, id });
        if (a === 'approve') C.toast(`Approved for ${nf(r.targets)} numbers.`);
        campaign(id);
      } catch (x) { $('#cM').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    }));
  }

  // ---------- Settings ----------
  let PEOPLE = [], AGR = '';
  async function settings() {
    const [{ settings: s, people, agreement }, K] = await Promise.all([C.api('/api/tm?settings=1'), C.api('/api/tm?campaigns=1').catch(() => ({}))]); PEOPLE = people; AGR = agreement;
    const sc = s.campaigns || {}, hooks = K.ready && K.ready.hooks;
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
      <div class="row"><div><label>Invitation template (2 values: name, link)</label><input name="waInviteTemplate" value="${esc(s.waInviteTemplate || '')}"></div><div></div></div>
      <h3>SMS and AI calls (Exotel)</h3><p class="muted small">The Exotel keys go in Vercel (EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN). The rest comes from your DLT registration and Exotel. Campaigns send only between these hours (the law allows 9 am to 9 pm).</p>
      <div class="row"><div><label>SMS sender name (DLT header, 6 letters)</label><input name="c_smsSender" value="${esc(sc.smsSender || '')}" maxlength="11" placeholder="DREAMI"></div><div><label>DLT entity ID (Dream India Realty)</label><input name="c_dltEntityId" value="${esc(sc.dltEntityId || '')}"></div></div>
      <div class="row"><div><label>Calls go out from (140-series number, declared to the operator)</label><input name="c_callerId" value="${esc(sc.callerId || '')}" placeholder="140xxxxxxx"></div><div><label>Exotel call flow (app) ID</label><input name="c_callAppId" value="${esc(sc.callAppId || '')}" placeholder="the number in the flow's link"></div></div>
      <div class="row"><div><label>Send from (hour, 24h)</label><input type="number" name="c_fromHour" value="${sc.fromHour ?? 10}" min="9" max="20"></div><div><label>Stop at (hour, 24h)</label><input type="number" name="c_toHour" value="${sc.toHour ?? 19}" min="10" max="21"></div></div>
      <h3>AI conversation calls (Bolna)</h3><p class="muted small">Bolna is the AI voice service that talks to people in English or Hindi and calls through our Exotel number. Put the Bolna key in Vercel (BOLNA_API_KEY). In Bolna, make one agent with Exotel as the call provider, paste the prompt below, and set its webhook to the link below.</p>
      <div class="row"><div><label>Bolna agent ID</label><input name="c_agentId" value="${esc(sc.agentId || '')}" placeholder="the agent's ID in Bolna"></div><div><label>Call from (our Exotel number in Bolna, +91…)</label><input name="c_agentFrom" value="${esc(sc.agentFrom || '')}" placeholder="+91140xxxxxxx"></div></div>
      ${hooks ? `<details><summary class="small"><b>Bolna: prompt and webhook</b></summary><div class="small" style="margin-top:6px;line-height:1.6">Webhook (in the agent's analytics / webhook setting): <code>${esc(hooks.agent)}</code><br>Agent prompt (Bolna fills the {words} for each call):
        <textarea readonly rows="12" style="width:100%;font-size:12px">You are Priya, a friendly sales assistant calling from Dream India Realty, a Mumbai real estate developer. You are calling {name} about our project {project} in {location}.
Speak in the language the person uses (English or Hindi), warmly and briefly, one question at a time, like a real person. Keep the call under 3 minutes.
Follow this briefing exactly and answer only from it:
{briefing}
If they are interested, agree a site visit day and time and repeat it back to confirm. If they are busy, ask when to call back.
Never invent prices, offers, possession dates or anything not in the briefing; say a sales advisor will call with those details.
If they say they do not want calls, apologise, say you will not call again, and end the call politely.</textarea></div></details>` : ''}
      ${hooks ? `<details><summary class="small"><b>Links to put in the Exotel call flow</b></summary><div class="small" style="margin-top:6px;line-height:1.7">
        Greeting (text to speech from a URL): <code>${esc(hooks.say)}</code><br>Gather (press 1 / press 2) passthru: <code>${esc(hooks.digits)}</code><br>
        Call status callback and SMS status callback are sent by the ERP with each call or SMS. Keep these links private.</div></details>` : ''}
      <div class="actions"><button>Save</button></div><div id="tmSM"></div></form></div>`);
    $('#tmS').onsubmit = async (e) => {
      e.preventDefault(); const x = Object.fromEntries(new FormData(e.target)); x.approvers = $$('[name=approver]:checked', e.target).map((i) => +i.value); delete x.approver;
      x.campaigns = {}; for (const k of Object.keys(x)) if (k.startsWith('c_')) { x.campaigns[k.slice(2)] = x[k]; delete x[k]; }
      try { await C.api('/api/tm', { action: 'settings-save', settings: x }); $('#tmSM').innerHTML = '<div class="ok">Saved.</div>'; }
      catch (er) { $('#tmSM').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
    };
  }

  window.Telemarketing = { render };
})();
