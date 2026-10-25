// Dream India ERP: one-page app. Plain JavaScript, no outside libraries.
(() => {
  const app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  let me = null;

  async function api(path, body) {
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch(path, { credentials: 'same-origin', ...opt });
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 401) { me = null; start(); throw new Error(j.error || 'Please sign in.'); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { data: j });
    return j;
  }
  const can = (p) => !!me && me.perms.includes(p);
  function showErr(form, e) { let box = $('.err', form); if (!box) { box = document.createElement('div'); box.className = 'err'; form.appendChild(box); } box.textContent = e.message; }
  const logo = '<img src="/icon.svg" alt="">';

  // ---------- entry ----------
  async function start() {
    let s;
    try { s = await api('/api/session'); } catch (e) { app.innerHTML = `<div class="center"><div class="card"><p class="err">${esc(e.message)}</p></div></div>`; return; }
    if (s.state === 'no-db') return noDb();
    if (s.state === 'needs-setup') return setup(s.codeRequired);
    if (!s.user) return login();
    me = s.user;
    if (me.mustChange) return changePassword(true);
    shell();
  }

  function noDb() {
    app.innerHTML = `<div class="center"><div class="card wide">
      <div class="brandline">${logo}<div><b>Dream India ERP</b><span>Test version</span></div></div>
      <h1>The database is not connected yet</h1>
      <p class="muted">The ERP is installed, but it has no database to store data in.</p>
      <p>In Vercel, open the <b>dream-india-erp</b> project → <b>Storage</b> → <b>Create Database</b> → <b>Neon</b>, and connect it to all environments. Then reload this page.</p>
    </div></div>`;
  }

  function setup(codeRequired) {
    app.innerHTML = `<div class="center"><form class="card" id="f">
      <div class="brandline">${logo}<div><b>Dream India ERP</b><span>First-time setup</span></div></div>
      <h1>Create the Admin login</h1>
      <p class="muted">This sets up the database and the first login. It can only be done once.</p>
      <label>Your name</label><input name="name" autocomplete="name" required>
      <label>Username</label><input name="username" autocomplete="username" required placeholder="e.g. rafi">
      <label>Password (at least 10 characters)</label><input name="password" type="password" autocomplete="new-password" required>
      <label>Password again</label><input name="password2" type="password" autocomplete="new-password" required>
      ${codeRequired ? '<label>Setup code</label><input name="code" required>' : ''}
      <div class="actions"><button>Set up the ERP</button></div>
    </form></div>`;
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target, d = Object.fromEntries(new FormData(f));
      if (d.password !== d.password2) return showErr(f, new Error('The two passwords do not match.'));
      f.querySelector('button').disabled = true;
      try { await api('/api/session', { action: 'setup', ...d }); start(); } catch (e) { f.querySelector('button').disabled = false; showErr(f, e); }
    };
  }

  function login() {
    app.innerHTML = `<div class="center"><form class="card" id="f">
      <div class="brandline">${logo}<div><b>Dream India ERP</b><span>Test version</span></div></div>
      <h1>Sign in</h1>
      <label>Username</label><input name="username" autocomplete="username" required autofocus>
      <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
      <div class="actions"><button>Sign in</button></div>
    </form></div>`;
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try { await api('/api/session', { action: 'login', ...Object.fromEntries(new FormData(f)) }); start(); } catch (e) { showErr(f, e); }
    };
  }

  function changePassword(forced) {
    const html = `<form class="card" id="pw">
      <div class="brandline">${logo}<div><b>Dream India ERP</b><span>${esc(me.name)}</span></div></div>
      <h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
      ${forced ? '<p class="muted">You signed in with a temporary password. Choose your own before continuing.</p>' : ''}
      <label>Current password</label><input name="current" type="password" autocomplete="current-password" required>
      <label>New password (at least 10 characters)</label><input name="next" type="password" autocomplete="new-password" required>
      <label>New password again</label><input name="next2" type="password" autocomplete="new-password" required>
      <div class="actions"><button>Save password</button>${forced ? '<button type="button" class="ghost" id="out">Sign out</button>' : '<button type="button" class="ghost" id="cancel">Cancel</button>'}</div>
    </form>`;
    app.innerHTML = `<div class="center">${html}</div>`;
    const f = $('#pw');
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (d.next !== d.next2) return showErr(f, new Error('The two new passwords do not match.'));
      try { await api('/api/session', { action: 'password', current: d.current, next: d.next }); start(); } catch (e) { showErr(f, e); }
    };
    if ($('#out')) $('#out').onclick = signOut;
    if ($('#cancel')) $('#cancel').onclick = () => start();
  }
  async function signOut() { await api('/api/session', { action: 'logout' }).catch(() => {}); me = null; location.hash = ''; start(); }

  // ---------- shell ----------
  const anyOf = (...ps) => ps.some(can);
  const PAGES = [
    { key: 'home', label: 'Home', show: () => true },
    { group: 'Booking-to-collection' },
    { key: 'units', label: 'Units & inventory', show: () => can('inventory.view') },
    { key: 'bookings', label: 'Bookings', show: () => anyOf('inventory.view', 'ledger.view') },
    { key: 'demands', label: 'Stages & demands', show: () => anyOf('demand.raise', 'demand.approve', 'stage.record', 'ledger.view') },
    { key: 'receipts', label: 'Receipts', show: () => anyOf('receipt.enter', 'receipt.approve', 'ledger.view') },
    { key: 'ledgers', label: 'Customer ledgers', show: () => can('ledger.view') },
    { key: 'letters', label: 'Demand letters', show: () => anyOf('demand.raise', 'ledger.view') },
    { key: 'followups', label: 'Follow-ups', show: () => can('ledger.view') },
    { group: 'Set-up' },
    { key: 'projects', label: 'Companies & projects', show: () => true },
    { key: 'plans', label: 'Payment plans', show: () => true },
    { key: 'users', label: 'Logins', show: () => can('users.manage') },
    { key: 'audit', label: 'Audit log', show: () => can('audit.view') },
  ];
  const DETAIL = { booking: 'bookings', statement: 'ledgers', run: 'demands' };
  let projectList = null, proj = null;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  async function shell() {
    if (!projectList) projectList = (await api('/api/masters')).projects.filter((p) => p.active);
    if (!proj || !projectList.some((p) => p.id === proj)) proj = +(store.get('erp_project') || 0) || null;
    if (!projectList.some((p) => p.id === proj)) proj = (projectList.find((p) => p.code === 'SIGNATURE') || projectList[0] || {}).id || null;
    const [page, arg] = location.hash.replace('#/', '').split('/');
    const visible = PAGES.filter((p) => p.group || p.show());
    const nav = visible.filter((p, i) => !p.group || (visible[i + 1] && !visible[i + 1].group));
    const curKey = DETAIL[page] || page || 'home';
    const cur = PAGES.find((p) => p.key === curKey && p.show()) || PAGES[0];
    app.innerHTML = `<div class="shell">
      <nav class="side no-print">
        <div class="logo">${logo}<div><b>Dream India ERP</b><span>Test version</span></div></div>
        ${nav.map((p) => (p.group ? `<div class="group">${esc(p.group)}</div>` : `<a href="#/${p.key}" class="${p === cur ? 'on' : ''}">${esc(p.label)}</a>`)).join('')}
      </nav>
      <div class="main">
        <div class="top no-print"><div class="who">${projectList.length > 1 ? `<select id="proj" class="proj">${projectList.map((p) => `<option value="${p.id}" ${p.id === proj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : `<b>${esc(projectList[0]?.name || '')}</b>`}
          <span class="test-banner">Test version: sample data only</span></div>
          <div class="who"><span><b>${esc(me.name)}</b> · ${esc(me.roleLabel)}</span>
            <button class="ghost small" id="cpw">Change password</button><button class="ghost small" id="out">Sign out</button></div></div>
        <div class="page" id="page"><p class="muted">Loading…</p></div>
      </div></div>`;
    $('#out').onclick = signOut;
    $('#cpw').onclick = () => changePassword(false);
    if ($('#proj')) $('#proj').onchange = (e) => { proj = +e.target.value; store.set('erp_project', proj); shell(); };
    const fn = { home, projects, plans, users, audit, units, bookings, demands, receipts, ledgers, letters, followups, booking: bookingPage, statement: statementPage, run: runPage };
    const key = DETAIL[page] && arg ? page : cur.key;
    try { await fn[key](arg ? +arg : undefined); } catch (e) { $('#page').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  const go = (h) => { if (location.hash === h) shell(); else location.hash = h; };
  window.addEventListener('hashchange', () => { if (me) shell(); });

  // ---------- pages ----------
  async function home() {
    const d = await api('/api/masters');
    const total = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    const cur = d.projects.find((p) => p.id === proj);
    let summary = '';
    if (cur && total(cur.units) && can('ledger.view')) {
      const l = await api(`/api/ledger?project=${proj}`);
      summary = `<div class="panel"><h2>${esc(cur.name)}: collections today</h2><div class="kpis">
        ${kpi(l.totals.bookings, 'live bookings')}${kpi(cr(l.totals.demanded), 'demanded')}${kpi(cr(l.totals.received), 'received (AV + TDS)')}
        ${kpi(cr(l.totals.overdue), 'overdue', toNum(l.totals.overdue) > 0 ? 'bad' : '')}${kpi(cr(l.totals.gstOutstanding), 'GST outstanding')}</div>
        <div class="actions"><a class="btn ghost" href="#/ledgers">Open customer ledgers</a></div></div>`;
    }
    const sample = can('users.manage') && cur ? `<div class="panel"><h2>Sample data for testing</h2>
      <p class="muted">Loads Dream Signature A and B Wing (floors 10 to 45, 8 units a floor) with made-up "Sample Buyer" bookings, demands up to the stages the real project has reached, and receipts. It never touches real data and can be removed in one click.</p>
      <div class="actions">${total(cur.units) ? '<button class="danger" id="clearSample">Remove sample data</button>' : '<button id="loadSample">Load sample data</button>'}</div></div>` : '';
    $('#page').innerHTML = `<div class="page-head"><div><h1>Welcome, ${esc(me.name)}</h1>
      <p class="muted">This is the test version of the Dream India ERP. It is separate from the live staff portal.</p></div></div>
      ${summary}
      <div class="grid">${d.projects.map((p) => `<div class="panel">
        <span class="pill grey">${esc(p.company)}</span>
        <h2 style="margin-top:8px">${esc(p.name)}</h2>
        <p class="muted">${esc(p.location || '')}${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}</p>
        <div class="kpis"><div class="kpi"><b>${p.buildings.length}</b><span>buildings</span></div>
          <div class="kpi"><b>${total(p.units)}</b><span>units</span></div>
          <div class="kpi"><b>${p.plans.reduce((a, pl) => a + pl.stages.length, 0)}</b><span>payment stages</span></div></div>
      </div>`).join('') || '<p class="muted">No projects yet.</p>'}</div>${sample}`;
    if ($('#loadSample')) $('#loadSample').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Loading… (about 20 seconds)'; try { const r = await api('/api/sample', { action: 'load', projectId: proj }); toast(`Loaded ${r.units} units, ${r.bookings} bookings, ${r.demands} demands and ${r.receipts} receipts.`); home(); } catch (x) { e.target.disabled = false; e.target.textContent = 'Load sample data'; alert(x.message); } };
    if ($('#clearSample')) $('#clearSample').onclick = async (e) => { if (!confirm('Remove all sample units, bookings, demands and receipts for this project?')) return; e.target.disabled = true; try { await api('/api/sample', { action: 'clear', projectId: proj }); home(); } catch (x) { e.target.disabled = false; alert(x.message); } };
  }

  async function projects(data) {
    const d = data || await api('/api/masters');
    const edit = can('masters.edit');
    $('#page').innerHTML = `<div class="page-head"><div><h1>Companies & projects</h1><p class="muted">Every record in the ERP belongs to a company and a project.</p></div>
      ${edit ? '<div class="actions" style="margin:0"><button class="ghost" id="addCo">Add company</button><button id="addPr">Add project</button></div>' : ''}</div>
      <div class="panel"><h2>Companies</h2><div class="table-wrap"><table><tr><th>Code</th><th>Name</th><th>PAN</th><th>GSTIN</th><th></th></tr>
        ${d.companies.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)} ${c.active ? '' : '<span class="pill grey">inactive</span>'}</td><td>${esc(c.pan || '—')}</td><td>${esc(c.gstin || '—')}</td>
          <td class="num">${edit ? `<button class="ghost small" data-co="${c.id}">Edit</button>` : ''}</td></tr>`).join('')}</table></div></div>
      ${d.projects.map((p) => `<div class="panel"><div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">${esc(p.name)} <span class="pill grey">${esc(p.code)}</span></h2>
        <p class="muted" style="margin:4px 0 0">${esc(p.company)} · ${esc(p.location || 'location not set')} · RERA ${esc(p.rera_no || 'not set')}</p></div>
        ${edit ? `<div class="actions" style="margin:0"><button class="ghost small" data-pr="${p.id}">Edit project</button><button class="ghost small" data-addb="${p.id}">Add building</button></div>` : ''}</div>
        <div class="table-wrap"><table><tr><th>Code</th><th>Building / wing</th><th>Type</th><th class="num">Floors</th><th></th></tr>
        ${p.buildings.map((b) => `<tr><td>${esc(b.code)}</td><td>${esc(b.name)}</td><td>${esc(b.kind)}</td><td class="num">${b.floors ?? '—'}</td>
          <td class="num">${edit ? `<button class="ghost small" data-b="${b.id}" data-bp="${p.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No buildings yet.</td></tr>'}</table></div></div>`).join('')}`;
    if (!edit) return;
    const after = (r) => projects(r);
    $('#addCo').onclick = () => companyForm(null, after);
    $('#addPr').onclick = () => projectForm(null, d, after);
    document.querySelectorAll('[data-co]').forEach((b) => (b.onclick = () => companyForm(d.companies.find((c) => c.id === +b.dataset.co), after)));
    document.querySelectorAll('[data-pr]').forEach((b) => (b.onclick = () => projectForm(d.projects.find((p) => p.id === +b.dataset.pr), d, after)));
    document.querySelectorAll('[data-addb]').forEach((b) => (b.onclick = () => buildingForm(null, +b.dataset.addb, after)));
    document.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => buildingForm(d.projects.find((p) => p.id === +b.dataset.bp).buildings.find((x) => x.id === +b.dataset.b), +b.dataset.bp, after)));
  }

  function dialog(inner, onSubmit) {
    const dl = document.createElement('dialog');
    dl.innerHTML = `<form method="dialog">${inner}<div class="actions"><button value="save">Save</button><button type="button" class="ghost" value="cancel">Cancel</button></div></form>`;
    document.body.appendChild(dl);
    const f = $('form', dl);
    $('[value=cancel]', dl).onclick = () => { dl.close(); dl.remove(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await onSubmit(Object.fromEntries(new FormData(f)), f); dl.close(); dl.remove(); } catch (e) { showErr(f, e); }
    };
    dl.showModal();
    return dl;
  }
  function companyForm(c, after) {
    dialog(`<h2>${c ? 'Edit company' : 'Add company'}</h2>
      <div class="row"><div><label>Code</label><input name="code" value="${esc(c?.code)}" required placeholder="PRIME"></div><div><label>Name</label><input name="name" value="${esc(c?.name)}" required></div></div>
      <div class="row"><div><label>PAN</label><input name="pan" value="${esc(c?.pan)}"></div><div><label>GSTIN</label><input name="gstin" value="${esc(c?.gstin)}"></div></div>
      <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Active</label>`,
    async (d) => after(await api('/api/masters', { action: 'company.save', id: c?.id, ...d, active: d.active === 'on' })));
  }
  function projectForm(p, d, after) {
    dialog(`<h2>${p ? 'Edit project' : 'Add project'}</h2>
      <div class="row"><div><label>Code</label><input name="code" value="${esc(p?.code)}" required placeholder="SIGNATURE"></div><div><label>Name</label><input name="name" value="${esc(p?.name)}" required></div></div>
      <label>Company</label><select name="companyId" required>${d.companies.filter((c) => c.active).map((c) => `<option value="${c.id}" ${p?.company_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="row"><div><label>Location</label><input name="location" value="${esc(p?.location)}"></div><div><label>MahaRERA number</label><input name="reraNo" value="${esc(p?.rera_no)}"></div></div>
      <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Active</label>`,
    async (x) => after(await api('/api/masters', { action: 'project.save', id: p?.id, ...x, active: x.active === 'on' })));
  }
  function buildingForm(b, projectId, after) {
    const kinds = { sale: 'Sale', rehab: 'Rehab', commercial: 'Commercial', other: 'Other' };
    dialog(`<h2>${b ? 'Edit building' : 'Add building'}</h2>
      <div class="row"><div><label>Code</label><input name="code" value="${esc(b?.code)}" required placeholder="A"></div><div><label>Name</label><input name="name" value="${esc(b?.name)}" required placeholder="A Wing"></div></div>
      <div class="row"><div><label>Type</label><select name="kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${b?.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label>Floors</label><input name="floors" type="number" min="0" max="150" value="${esc(b?.floors)}"></div></div>`,
    async (x) => after(await api('/api/masters', { action: 'building.save', id: b?.id, projectId, ...x })));
  }

  async function plans() {
    const d = await api('/api/masters');
    $('#page').innerHTML = `<div class="page-head"><div><h1>Payment plans</h1><p class="muted">The stages each buyer pays against. Demands are raised stage by stage from these.</p></div></div>
      ${d.projects.flatMap((p) => p.plans.map((pl) => {
        const sum = pl.stages.reduce((a, s) => a + Number(s.pct), 0);
        return `<div class="panel"><h2>${esc(p.name)} · ${esc(pl.name)} <span class="pill ${Math.abs(sum - 100) < 0.001 ? 'good' : 'bad'}">${sum}% total</span></h2>
          <div class="table-wrap"><table><tr><th class="num">#</th><th>Stage</th><th class="num">% of agreement value</th><th>Linked to construction</th></tr>
          ${pl.stages.map((s) => `<tr><td class="num">${s.seq}</td><td>${esc(s.name)}</td><td class="num">${Number(s.pct)}%</td><td>${s.construction_linked ? 'Yes' : 'No'}</td></tr>`).join('')}</table></div></div>`;
      })).join('') || '<p class="muted">No payment plans yet.</p>'}`;
  }

  async function users(data) {
    const d = data || await api('/api/users');
    const pname = (id) => d.projects.find((p) => p.id === id)?.name || '';
    const rlabel = (k) => d.roles.find((r) => r.key === k)?.label || k;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Logins</h1><p class="muted">Each person gets their own login. New logins and resets use a temporary password that must be changed at first sign-in.</p></div>
      <div class="actions" style="margin:0"><button id="add">Add login</button></div></div>
      <div class="panel table-wrap"><table><tr><th>Name</th><th>Username</th><th>Role</th><th>Projects</th><th>Status</th><th></th></tr>
      ${d.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(rlabel(u.role))}</td>
        <td>${u.role === 'admin' || u.all_projects ? 'All projects' : esc(u.projects.map(pname).join(', ') || 'None')}</td>
        <td>${u.disabled ? '<span class="pill bad">disabled</span>' : u.must_change ? '<span class="pill grey">awaiting first sign-in</span>' : '<span class="pill good">active</span>'}</td>
        <td class="num" style="white-space:nowrap"><button class="ghost small" data-edit="${u.id}">Edit</button> <button class="ghost small" data-reset="${u.id}">Reset password</button>
          ${u.id === me.id ? '' : `<button class="${u.disabled ? 'ghost' : 'danger'} small" data-toggle="${u.id}">${u.disabled ? 'Enable' : 'Disable'}</button>`}</td></tr>`).join('')}</table></div>`;
    const form = (u) => `<h2>${u ? 'Edit login' : 'Add login'}</h2>
      <div class="row"><div><label>Name</label><input name="name" value="${esc(u?.name)}" required></div>
      <div><label>Username</label><input name="username" value="${esc(u?.username)}" ${u ? 'disabled' : 'required'} placeholder="e.g. firstname.lastname"></div></div>
      <div class="row"><div><label>Role</label><select name="role">${d.roles.map((r) => `<option value="${r.key}" ${u?.role === r.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      <div><label>Mobile (for OTP later)</label><input name="phone" value="${esc(u?.phone)}"></div></div>
      <label>Projects</label>
      <label class="check"><input type="checkbox" name="allProjects" ${u?.all_projects ? 'checked' : ''}> All projects, including future ones</label>
      ${d.projects.map((p) => `<label class="check"><input type="checkbox" name="p${p.id}" ${u?.projects.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}`;
    const pick = (x) => ({ name: x.name, username: x.username, role: x.role, phone: x.phone, allProjects: x.allProjects === 'on', projects: d.projects.filter((p) => x['p' + p.id] === 'on').map((p) => p.id) });
    const showTemp = (r) => {
      const dl = document.createElement('dialog');
      dl.innerHTML = `<form method="dialog"><h2>Temporary password for ${esc(r.username)}</h2><p>Give this to the person. It is shown only once; they must choose their own password when they first sign in.</p>
        <div class="temp">${esc(r.tempPassword)}</div><div class="actions"><button>Done</button></div></form>`;
      document.body.appendChild(dl); dl.addEventListener('close', () => dl.remove()); dl.showModal();
    };
    $('#add').onclick = () => dialog(form(null), async (x) => { const r = await api('/api/users', { action: 'create', ...pick(x) }); users(r); showTemp(r); });
    document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { const u = d.users.find((x) => x.id === +b.dataset.edit); dialog(form(u), async (x) => users(await api('/api/users', { action: 'update', id: u.id, ...pick(x) }))); }));
    document.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => { const u = d.users.find((x) => x.id === +b.dataset.reset); if (!confirm(`Reset the password for ${u.name}? They will be signed out.`)) return; const r = await api('/api/users', { action: 'reset', id: u.id }); users(r); showTemp(r); }));
    document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => { const u = d.users.find((x) => x.id === +b.dataset.toggle); if (!u.disabled && !confirm(`Disable ${u.name}? They will be signed out at once.`)) return; users(await api('/api/users', { action: u.disabled ? 'enable' : 'disable', id: u.id })); }));
  }

  async function audit() {
    const d = await api('/api/audit?limit=300');
    const summary = (r) => {
      if (r.note) return esc(r.note);
      const a = r.after || {}, b = r.before || {};
      const keys = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      return keys.map((k) => `${esc(k)}: ${r.before ? esc(JSON.stringify(b[k] ?? '')) + ' → ' : ''}${esc(JSON.stringify(a[k]))}`).join('<br>');
    };
    $('#page').innerHTML = `<div class="page-head"><div><h1>Audit log</h1><p class="muted">Every change, who made it and when. Entries cannot be edited or deleted.</p></div></div>
      <div class="panel table-wrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Details</th></tr>
      ${d.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(fmtDate(r.at))}</td><td>${esc(r.user_name || 'System')}</td><td>${esc(r.action)}</td>
        <td>${esc(r.entity)}${r.entity_id ? ' #' + esc(r.entity_id) : ''}${r.project ? '<br><span class="muted">' + esc(r.project) + '</span>' : ''}</td><td style="font-size:12.5px">${summary(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</table></div>`;
  }

  // ---------- formatting ----------
  const toNum = (v) => Number(v || 0);
  const inr = (v, dec = 0) => '₹' + toNum(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const cr = (v) => { const n = toNum(v); return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n); };
  const fmtD = (iso) => (iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const todayIso = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const kpi = (v, label, cls = '') => `<div class="kpi ${cls}"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
  const STATUS = { available: 'Available', blocked: 'Booking pending', booked: 'Booked', registered: 'Registered', held: 'Held', refuge: 'Refuge', rehab: 'Rehab', society: 'Society' };
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }
  const noProject = () => { $('#page').innerHTML = '<p class="muted">Choose a project at the top.</p>'; };

  // ---------- units ----------
  async function units() {
    if (!proj) return noProject();
    const d = await api(`/api/units?project=${proj}`);
    const bTab = +(store.get('erp_bld') || 0);
    const blds = d.buildings.filter((b) => d.units.some((u) => u.building_id === b.id) || b.kind !== 'rehab');
    const bld = blds.find((b) => b.id === bTab) || blds[0];
    const list = bld ? d.units.filter((u) => u.building_id === bld.id) : [];
    const counts = {}; for (const u of list) counts[u.status] = (counts[u.status] || 0) + 1;
    const floors = [...new Set(list.map((u) => u.floor))].sort((a, b) => b - a);
    const cell = (u) => `<button class="unit s-${u.status}${toNum(u.overdue) > 0 ? ' overdue' : ''}" data-u="${u.id}" title="${esc(u.unit_no)} · ${esc(STATUS[u.status] || u.status)}${u.buyer ? ' · ' + esc(u.buyer) : ''}">${esc(u.unit_no.split('-').pop())}</button>`;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Units & inventory</h1><p class="muted">Every unit, floor by floor. A red corner means the buyer has overdue dues.</p></div>
      ${can('inventory.edit') && bld ? '<div class="actions" style="margin:0"><button class="ghost" id="gen">Add units</button></div>' : ''}</div>
      <div class="tabs">${blds.map((b) => `<button class="tab ${b === bld ? 'on' : ''}" data-b="${b.id}">${esc(b.name)}</button>`).join('')}</div>
      <div class="panel"><div class="legend">${Object.keys(STATUS).filter((k) => counts[k]).map((k) => `<span><i class="sw s-${k}"></i>${STATUS[k]} <b>${counts[k]}</b></span>`).join('')}
        ${list.some((u) => toNum(u.overdue) > 0) ? `<span><i class="sw overdue-sw"></i>Overdue <b>${list.filter((u) => toNum(u.overdue) > 0).length}</b></span>` : ''}</div>
      ${floors.length ? `<div class="floors">${floors.map((f) => `<div class="floor"><span class="fl">${f}</span>${list.filter((u) => u.floor === f).map(cell).join('')}</div>`).join('')}</div>` : '<p class="muted">No units yet in this building.' + (can('users.manage') ? ' For testing, load sample data from Home.' : '') + '</p>'}</div>`;
    document.querySelectorAll('.tab[data-b]').forEach((t) => (t.onclick = () => { store.set('erp_bld', t.dataset.b); units(); }));
    document.querySelectorAll('[data-u]').forEach((c) => (c.onclick = () => unitDialog(d.units.find((u) => u.id === +c.dataset.u))));
    if ($('#gen')) $('#gen').onclick = () => dialog(`<h2>Add units to ${esc(bld.name)}</h2>
      <p class="muted">Units are numbered ${esc(bld.code)}-1001, ${esc(bld.code)}-1002 … (building, floor, unit). Existing numbers are skipped.</p>
      <div class="row"><div><label>From floor</label><input name="floorFrom" type="number" min="0" required></div><div><label>To floor</label><input name="floorTo" type="number" min="0" required></div></div>
      <div class="row"><div><label>Units per floor</label><input name="perFloor" type="number" min="1" max="40" required value="8"></div><div><label>Typology for all (optional)</label><input name="typ" placeholder="e.g. 2BHK"></div></div>`,
    async (x) => { const per = +x.perFloor; const r = await api('/api/units', { action: 'generate', buildingId: bld.id, floorFrom: x.floorFrom, floorTo: x.floorTo, perFloor: per, typologies: Array(per).fill(x.typ || '') }); toast(`${r.added} units added.`); units(); });
  }
  function unitDialog(u) {
    const dl = document.createElement('dialog');
    const editable = can('inventory.edit');
    dl.innerHTML = `<form method="dialog"><h2>Unit ${esc(u.unit_no)} <span class="pill grey">${esc(STATUS[u.status] || u.status)}</span></h2>
      <p class="muted">Floor ${u.floor ?? '—'} · ${esc(u.typology || 'typology not set')} · ${u.carpet_sqft ? toNum(u.carpet_sqft) + ' sq ft carpet' : 'area not set'}</p>
      ${u.booking_id ? `<div class="panel" style="margin:12px 0"><b>${esc(u.buyer || 'Buyer')}</b><br><span class="muted">Agreement value ${inr(u.agreement_value)} · Outstanding ${inr(u.outstanding)}${toNum(u.overdue) > 0 ? ` · <span class="bad-t">overdue ${inr(u.overdue)}</span>` : ''}</span></div>` : ''}
      ${u.hold_note ? `<p class="note">${esc(u.hold_note)}</p>` : ''}
      ${editable && !u.booking_id ? `<div class="row"><div><label>Status</label><select name="status">${['available', 'blocked', 'held', 'refuge', 'rehab', 'society'].map((s) => `<option value="${s}" ${u.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select></div>
        <div><label>Note (why held)</label><input name="holdNote" value="${esc(u.hold_note)}"></div></div>` : ''}
      ${editable ? `<div class="row"><div><label>Typology</label><input name="typology" value="${esc(u.typology)}"></div><div><label>Carpet area (sq ft)</label><input name="carpetSqft" type="number" step="0.01" value="${esc(u.carpet_sqft)}"></div></div>` : ''}
      <div class="actions">${u.booking_id ? `<button type="button" id="open">Open booking</button>` : ''}
        ${!u.booking_id && ['available', 'blocked'].includes(u.status) && can('booking.create') ? '<button type="button" id="book">New booking</button>' : ''}
        ${editable ? '<button value="save" class="ghost">Save unit</button>' : ''}<button type="button" class="ghost" id="close">Close</button></div></form>`;
    document.body.appendChild(dl);
    const close = () => { dl.close(); dl.remove(); };
    $('#close', dl).onclick = close;
    if ($('#open', dl)) $('#open', dl).onclick = () => { close(); go(`#/booking/${u.booking_id}`); };
    if ($('#book', dl)) $('#book', dl).onclick = () => { close(); bookingForm(u); };
    $('form', dl).onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/api/units', { action: 'update', id: u.id, ...Object.fromEntries(new FormData(ev.target)) }); close(); units(); } catch (e) { showErr(ev.target, e); }
    };
    dl.showModal();
  }

  // ---------- bookings ----------
  async function bookings() {
    if (!proj) return noProject();
    const d = await api(`/api/bookings?project=${proj}`);
    const tab = store.get('erp_btab') || 'pending';
    const sets = {
      pending: d.rows.filter((r) => r.status === 'pending'),
      cancel: d.rows.filter((r) => r.status === 'active' && r.cancel_requested_at),
      active: d.rows.filter((r) => r.status === 'active'),
      closed: d.rows.filter((r) => ['cancelled', 'rejected'].includes(r.status)),
    };
    const labels = { pending: 'Waiting for approval', cancel: 'Cancellation requests', active: 'Active', closed: 'Cancelled / rejected' };
    const rows = sets[tab] || sets.active;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Bookings</h1><p class="muted">New bookings wait for Head CRM approval; the person who entered one cannot approve it.</p></div>
      ${can('booking.create') ? '<div class="actions" style="margin:0"><button id="new">New booking</button></div>' : ''}</div>
      <div class="tabs">${Object.keys(labels).map((k) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${labels[k]} <span class="count">${sets[k].length}</span></button>`).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table id="tbl"><tr><th>Unit</th><th>Buyer</th><th>Booked</th><th class="num">Agreement value</th><th class="num">Outstanding</th><th class="num">Overdue</th><th>Entered by</th><th></th></tr>
      ${rows.map((r) => `<tr class="click" data-b="${r.id}" data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}"><td><b>${esc(r.unit_no)}</b>${r.sample ? ' <span class="pill grey">sample</span>' : ''}</td><td>${esc(r.buyers || '')}</td><td>${fmtD(r.booking_date)}</td>
        <td class="num">${inr(r.agreement_value)}</td><td class="num">${inr(r.outstanding)}</td><td class="num ${toNum(r.overdue) > 0 ? 'bad-t' : ''}">${inr(r.overdue)}</td><td>${esc(r.created_by_name || 'Import / sample')}</td>
        <td class="num">${r.status === 'pending' ? '<span class="pill">needs approval</span>' : r.cancel_requested_at && r.status === 'active' ? '<span class="pill bad">cancel requested</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_btab', t.dataset.t); bookings(); }));
    document.querySelectorAll('tr[data-b]').forEach((tr) => (tr.onclick = () => go(`#/booking/${tr.dataset.b}`)));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    if ($('#new')) $('#new').onclick = () => bookingForm(null);
  }

  async function bookingForm(unit) {
    let choices = [];
    if (!unit) { const d = await api(`/api/units?project=${proj}`); choices = d.units.filter((u) => ['available', 'blocked'].includes(u.status) && !u.booking_id); }
    const applicant = (i) => `<fieldset class="appl"><legend>Applicant ${i}${i > 1 ? ' (optional)' : ''}</legend>
      <div class="row"><div><label>Full name</label><input name="a${i}_name" ${i === 1 ? 'required' : ''}></div><div><label>Mobile</label><input name="a${i}_phone"></div></div>
      <div class="row"><div><label>PAN</label><input name="a${i}_pan" placeholder="ABCDE1234F"></div><div><label>Aadhaar</label><input name="a${i}_aadhaar" placeholder="12 digits"></div></div>
      <div class="row"><div><label>Email</label><input name="a${i}_email" type="email"></div><div><label>Address</label><input name="a${i}_address"></div></div></fieldset>`;
    const dl = dialog(`<h2>New booking${unit ? ' for ' + esc(unit.unit_no) : ''}</h2>
      ${unit ? '' : `<label>Unit</label><select name="unitId" required><option value="">Choose an available unit</option>${choices.map((u) => `<option value="${u.id}">${esc(u.unit_no)} · ${esc(u.typology || '')} ${u.carpet_sqft ? toNum(u.carpet_sqft) + ' sq ft' : ''}</option>`).join('')}</select>`}
      <div class="row"><div><label>Booking date</label><input name="bookingDate" type="date" max="${todayIso()}" value="${todayIso()}" required></div><div><label>Agreement value (₹)</label><input name="agreementValue" inputmode="decimal" required placeholder="e.g. 9715000"></div></div>
      <div class="row"><div><label>GST rate %</label><input name="gstRate" value="5"></div><div><label>Parking</label><input name="parking" type="number" min="0" value="0"></div></div>
      <div class="row"><div><label>Funding</label><select name="funding"><option value="self">Self funding</option><option value="loan">Home loan</option></select></div><div><label>Loan bank</label><input name="loanBank"></div></div>
      <div class="row"><div><label>Source</label><select name="source"><option>Walk-in</option><option>Channel Partner</option><option>Reference</option><option>Digital</option><option>Other</option></select></div><div><label>Channel partner</label><input name="cpName"></div></div>
      <div class="row"><div><label>Brokerage (₹)</label><input name="brokerage" inputmode="decimal"></div><div><label>Relationship manager</label><input name="rmName"></div></div>
      ${applicant(1)}<details><summary>Add a second or third applicant</summary>${applicant(2)}${applicant(3)}</details>`,
    async (x) => {
      const applicants = [1, 2, 3].map((i) => ({ name: x[`a${i}_name`], phone: x[`a${i}_phone`], pan: x[`a${i}_pan`], aadhaar: x[`a${i}_aadhaar`], email: x[`a${i}_email`], address: x[`a${i}_address`] })).filter((a) => a.name && a.name.trim());
      const r = await api('/api/bookings', { action: 'create', unitId: unit ? unit.id : x.unitId, bookingDate: x.bookingDate, agreementValue: x.agreementValue, gstRate: x.gstRate, parking: x.parking, funding: x.funding, loanBank: x.loanBank, source: x.source, cpName: x.cpName, brokerage: x.brokerage, rmName: x.rmName, applicants });
      toast('Booking saved. It now waits for Head CRM approval.');
      go(`#/booking/${r.id}`);
    });
    dl.classList.add('wide');
  }

  async function bookingPage(id) {
    const d = await api(`/api/bookings?id=${id}`);
    const b = d.booking, bal = d.balance || {};
    const demanded = new Map(d.demands.filter((x) => x.status === 'raised').map((x) => [x.stage_name, x]));
    const actions = [];
    if (b.status === 'pending' && can('booking.approve')) actions.push('<button id="approve">Approve booking</button><button class="danger" id="reject">Reject</button>');
    if (b.status === 'active' && !b.registration_date && can('booking.create')) actions.push('<button class="ghost" id="register">Record agreement and registration</button>');
    if (b.status === 'active' && can('receipt.enter')) actions.push('<button class="ghost" id="receipt">Enter a receipt</button>');
    if (b.status === 'active' && can('ledger.view')) actions.push(`<a class="btn ghost" href="#/statement/${b.id}">Statement of account</a>`);
    if (b.status === 'active' && can('demand.raise')) actions.push('<button class="ghost" id="logf">Log a follow-up</button>');
    if (b.status === 'active' && !b.cancel_requested_at && can('booking.create')) actions.push('<button class="danger" id="cancelReq">Request cancellation</button>');
    if (b.status === 'active' && b.cancel_requested_at && can('cancellation.approve')) actions.push('<button class="danger" id="cancelOk">Approve cancellation</button><button class="ghost" id="cancelNo">Keep the booking</button>');
    const statusPill = { pending: '<span class="pill">waiting for approval</span>', active: '<span class="pill good">active</span>', cancelled: '<span class="pill bad">cancelled</span>', rejected: '<span class="pill bad">rejected</span>' }[b.status] || '';
    $('#page').innerHTML = `<p class="crumbs"><a href="#/bookings">Bookings</a> › ${esc(d.unit.unit_no)}</p>
      <div class="page-head"><div><h1>${esc(d.unit.unit_no)} · ${esc(d.applicants.map((a) => a.name).join(' & '))} ${statusPill}${b.sample ? ' <span class="pill grey">sample</span>' : ''}</h1>
        <p class="muted">${esc(d.unit.project)} · ${esc(d.unit.building)} · floor ${d.unit.floor ?? '—'} · ${esc(d.unit.typology || '')} ${d.unit.carpet_sqft ? toNum(d.unit.carpet_sqft) + ' sq ft' : ''} · ${esc(d.unit.company)}</p></div></div>
      ${b.cancel_requested_at && b.status === 'active' ? `<div class="note" style="margin-bottom:14px">Cancellation requested on ${fmtD(b.cancel_requested_at)}: ${esc(b.cancel_reason)}. Waiting for Management.</div>` : ''}
      <div class="actions" style="margin:0 0 16px">${actions.join('')}</div>
      <div class="panel"><div class="kpis">${kpi(inr(b.agreement_value), 'agreement value')}${kpi(inr(bal.demanded), 'demanded')}${kpi(inr(bal.credit_av), 'received (AV + TDS)')}
        ${kpi(inr(bal.outstanding), 'outstanding')}${kpi(inr(bal.overdue), 'overdue', toNum(bal.overdue) > 0 ? 'bad' : '')}${kpi(inr(bal.gst_outstanding), 'GST outstanding')}</div></div>
      <div class="two">
        <div class="panel"><h2>Booking</h2><table class="kv">
          <tr><th>Booking date</th><td>${fmtD(b.booking_date)}</td></tr><tr><th>Agreement / registration</th><td>${fmtD(b.agreement_date)} / ${fmtD(b.registration_date)}</td></tr>
          <tr><th>GST rate</th><td>${toNum(b.gst_rate)}%</td></tr><tr><th>Stamp duty / registration fee</th><td>${b.stamp_duty ? inr(b.stamp_duty) : '—'} / ${b.registration_fee ? inr(b.registration_fee) : '—'}</td></tr>
          <tr><th>Funding</th><td>${esc(b.funding === 'loan' ? 'Home loan · ' + (b.loan_bank || '') : b.funding === 'self' ? 'Self' : '—')}</td></tr><tr><th>Parking</th><td>${b.parking}</td></tr>
          <tr><th>Source / CP</th><td>${esc([b.source, b.cp_name].filter(Boolean).join(' · ') || '—')}</td></tr><tr><th>Brokerage</th><td>${b.brokerage ? inr(b.brokerage) : '—'}</td></tr></table></div>
        <div class="panel"><h2>Applicants</h2>${d.applicants.map((a) => `<p><b>${esc(a.name)}</b><br><span class="muted">PAN ${esc(a.pan || '—')} · Aadhaar ${esc(a.aadhaar || '—')}<br>${esc(a.phone || '')} ${esc(a.email || '')}<br>${esc(a.address || '')}</span></p>`).join('')}</div>
      </div>
      <div class="panel"><h2>Payment plan</h2><div class="table-wrap"><table><tr><th class="num">#</th><th>Stage</th><th class="num">%</th><th class="num">Amount</th><th>Demanded on</th><th>Due</th></tr>
        ${d.plan.map((s) => { const x = demanded.get(s.name); return `<tr class="${x ? '' : 'dim'}"><td class="num">${s.seq}</td><td>${esc(s.name)}</td><td class="num">${toNum(s.pct)}%</td><td class="num">${inr(toNum(b.agreement_value) * toNum(s.pct) / 100)}</td><td>${x ? fmtD(x.demand_date) : 'not yet'}</td><td>${x ? fmtD(x.due_date) : ''}</td></tr>`; }).join('')}</table></div></div>
      <div class="panel"><h2>Receipts</h2><div class="table-wrap"><table><tr><th>Date</th><th>Bank / instrument</th><th class="num">Amount</th><th>Split</th><th>Status</th></tr>
        ${d.receipts.map((r) => `<tr><td>${fmtD(r.received_on)}</td><td>${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode)}</td><td class="num">${inr(r.amount, 2)}</td>
          <td class="small">${Object.entries(r.splits).map(([h, v]) => `${HEAD[h] || h} ${inr(v, 2)}`).join(' · ')}</td><td>${rStatus(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No receipts yet.</td></tr>'}</table></div></div>`;
    if (can('ledger.view')) {
      const f = await api(`/api/followups?booking=${b.id}`);
      $('#page').insertAdjacentHTML('beforeend', `<div class="panel"><h2>Follow-ups</h2><div class="table-wrap"><table><tr><th>When</th><th>How</th><th>Outcome</th><th>Note</th><th>Promise</th><th>Next</th><th>By</th></tr>
        ${f.rows.map((x) => `<tr><td>${fmtD(x.created_at.slice(0, 10))}</td><td>${esc(x.kind)}</td><td>${esc(x.outcome)}</td><td class="small">${esc(x.note || '')}</td><td class="small">${x.promise_date ? fmtD(x.promise_date) + (x.promise_amount ? ' · ' + inr(x.promise_amount) : '') : ''}</td><td class="small">${x.next_date ? fmtD(x.next_date) : ''}</td><td>${esc(x.by_name || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No follow-ups yet.</td></tr>'}</table></div></div>`);
      if ($('#logf')) $('#logf').onclick = () => followupForm(b.id, d.unit.unit_no, f, () => bookingPage(id));
    }
    const act = async (body, msg) => { try { await api('/api/bookings', { id: b.id, ...body }); if (msg) toast(msg); bookingPage(id); } catch (e) { alert(e.message); } };
    if ($('#approve')) $('#approve').onclick = () => confirm('Approve this booking? The booking-stage demand is raised now, plus any construction stages already completed in this building.') && act({ action: 'approve' }, 'Booking approved.');
    if ($('#reject')) $('#reject').onclick = () => { const r = prompt('Reason for rejecting:'); if (r !== null) act({ action: 'reject', reason: r }, 'Booking rejected; the unit is available again.'); };
    if ($('#register')) $('#register').onclick = () => dialog(`<h2>Agreement and registration</h2><p class="muted">Recording the registration raises the registration-stage demand.</p>
      <div class="row"><div><label>Agreement date</label><input type="date" name="agreementDate" max="${todayIso()}"></div><div><label>Registration date</label><input type="date" name="registrationDate" required max="${todayIso()}"></div></div>
      <div class="row"><div><label>Stamp duty (₹)</label><input name="stampDuty" inputmode="decimal"></div><div><label>Registration fee (₹)</label><input name="registrationFee" inputmode="decimal" value="30000"></div></div>`,
    async (x) => { await api('/api/bookings', { action: 'register', id: b.id, ...x }); toast('Registration recorded.'); bookingPage(id); });
    if ($('#receipt')) $('#receipt').onclick = () => receiptForm({ id: b.id, label: `${d.unit.unit_no} · ${d.applicants.map((a) => a.name).join(' & ')}`, gstRate: toNum(b.gst_rate) }, () => bookingPage(id));
    if ($('#cancelReq')) $('#cancelReq').onclick = () => { const r = prompt('Why is this booking being cancelled?'); if (r) act({ action: 'cancel-request', reason: r }, 'Cancellation sent to Management for approval.'); };
    if ($('#cancelOk')) $('#cancelOk').onclick = () => confirm('Cancel this booking? Open demands are cancelled and the unit becomes available. Receipts stay on record for the refund.') && act({ action: 'cancel-approve' }, 'Booking cancelled.');
    if ($('#cancelNo')) $('#cancelNo').onclick = () => act({ action: 'cancel-reject' }, 'Cancellation request withdrawn.');
  }
  const HEAD = { av: 'AV', gst: 'GST', tds: 'TDS', stamp_duty: 'Stamp duty', registration: 'Registration', other: 'Other' };
  const rStatus = (r) => ({ pending: '<span class="pill">waiting for approval</span>', approved: '<span class="pill good">approved</span>', rejected: '<span class="pill grey">rejected</span>', bounced: '<span class="pill bad">bounced</span>', reversed: '<span class="pill bad">reversed</span>' }[r.status] || esc(r.status)) + (r.reverse_reason ? `<br><span class="small muted">${esc(r.reverse_reason)}</span>` : '');

  // ---------- receipts ----------
  function receiptForm(booking, after, choices) {
    const dl = dialog(`<h2>Enter a receipt</h2>
      ${booking ? `<p class="muted">${esc(booking.label)}</p>` : `<label>Booking</label><input name="pick" list="bk-list" required placeholder="Type the unit number"><datalist id="bk-list">${choices.map((c) => `<option value="${esc(c.label)}">`).join('')}</datalist>`}
      <div class="row"><div><label>Date received</label><input type="date" name="receivedOn" max="${todayIso()}" value="${todayIso()}" required></div><div><label>Amount (₹)</label><input name="amount" inputmode="decimal" required></div></div>
      <div class="row"><div><label>Mode</label><select name="mode"><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="loan">Loan disbursement</option><option value="tds">TDS certificate</option><option value="other">Other</option></select></div><div><label>Bank</label><input name="bank"></div></div>
      <div class="row"><div><label>UTR / cheque no.</label><input name="instrumentNo"></div><div><label>Into account (last digits)</label><input name="accountNo"></div></div>
      <label>How it splits <button type="button" class="ghost small" id="auto">Split as AV + GST</button></label>
      <div class="row3">${Object.entries(HEAD).map(([h, l]) => `<div><label class="sub">${l}</label><input name="s_${h}" inputmode="decimal"></div>`).join('')}</div>
      <p class="small muted" id="sumline">The parts must add up to the amount.</p>
      <label>Note</label><input name="note">`,
    async (x) => {
      let bookingId = booking && booking.id;
      if (!bookingId) { const c = choices.find((c) => c.label === x.pick); if (!c) throw new Error('Choose the booking from the list.'); bookingId = c.id; }
      const splits = Object.fromEntries(Object.keys(HEAD).map((h) => [h, x['s_' + h]]));
      await api('/api/receipts', { action: 'create', bookingId, receivedOn: x.receivedOn, amount: x.amount, mode: x.mode, bank: x.bank, instrumentNo: x.instrumentNo, accountNo: x.accountNo, note: x.note, splits });
      toast('Receipt saved. It counts once Head Accounts approves it.');
      after();
    });
    dl.classList.add('wide');
    const f = $('form', dl);
    const sum = () => { const tot = Object.keys(HEAD).reduce((a, h) => a + toNum(f['s_' + h].value), 0); const amt = toNum(f.amount.value); $('#sumline', dl).textContent = `Parts: ${inr(tot, 2)} of ${inr(amt, 2)}${Math.abs(tot - amt) < 0.005 && amt ? ' ✓' : ''}`; };
    f.addEventListener('input', sum);
    $('#auto', dl).onclick = () => { const amt = toNum(f.amount.value); const rate = (booking && booking.gstRate) || 5; const av = Math.round((amt / (1 + rate / 100)) * 100) / 100; f.s_av.value = av.toFixed(2); f.s_gst.value = (Math.round((amt - av) * 100) / 100).toFixed(2); sum(); };
  }

  async function receipts() {
    if (!proj) return noProject();
    const tab = store.get('erp_rtab') || 'pending';
    const d = await api(`/api/receipts?project=${proj}${tab === 'all' ? '' : '&status=' + tab}`);
    const labels = { pending: 'Waiting for approval', approved: 'Approved', bounced: 'Bounced', all: 'All' };
    $('#page').innerHTML = `<div class="page-head"><div><h1>Receipts</h1><p class="muted">Accounts enters each receipt and how it splits; it counts towards the buyer's balance once Head Accounts approves it.</p></div>
      ${can('receipt.enter') ? '<div class="actions" style="margin:0"><button id="new">Enter a receipt</button></div>' : ''}</div>
      <div class="tabs">${Object.keys(labels).map((k) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${labels[k]}</button>`).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit, buyer or UTR"><table><tr><th>Date</th><th>Unit</th><th>Buyer</th><th>Bank / instrument</th><th class="num">Amount</th><th>Split</th><th>Status</th><th>Entered by</th><th></th></tr>
      ${d.rows.map((r) => `<tr data-s="${esc(((r.unit_no || '') + ' ' + (r.buyers || '') + ' ' + (r.instrument_no || '')).toLowerCase())}"><td>${fmtD(r.received_on)}</td><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no || '')}</a></td><td>${esc(r.buyers || '')}</td>
        <td>${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode)}</td><td class="num">${inr(r.amount, 2)}</td><td class="small">${Object.entries(r.splits).map(([h, v]) => `${HEAD[h] || h} ${inr(v)}`).join(' · ')}</td>
        <td>${rStatus(r)}</td><td>${esc(r.created_by_name || 'Import / sample')}</td>
        <td class="num" style="white-space:nowrap">${r.status === 'pending' && can('receipt.approve') ? `<button class="small" data-ok="${r.id}">Approve</button> <button class="ghost small" data-no="${r.id}">Reject</button>` : ''}
          ${r.status === 'approved' && can('receipt.approve') ? `<button class="danger small" data-bounce="${r.id}">Bounced</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_rtab', t.dataset.t); receipts(); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    const act = async (body, msg) => { try { await api('/api/receipts', body); toast(msg); receipts(); } catch (e) { alert(e.message); } };
    document.querySelectorAll('[data-ok]').forEach((x) => (x.onclick = () => act({ action: 'approve', id: +x.dataset.ok }, 'Receipt approved.')));
    document.querySelectorAll('[data-no]').forEach((x) => (x.onclick = () => { const r = prompt('Reason for rejecting:'); if (r !== null) act({ action: 'reject', id: +x.dataset.no, reason: r }, 'Receipt rejected.'); }));
    document.querySelectorAll('[data-bounce]').forEach((x) => (x.onclick = () => { const r = prompt('Mark as bounced. Reason (e.g. cheque returned, insufficient funds):'); if (r) act({ action: 'bounce', id: +x.dataset.bounce, reason: r }, 'Marked as bounced; the buyer\'s balance is updated.'); }));
    if ($('#new')) $('#new').onclick = async () => {
      const b = await api(`/api/bookings?project=${proj}`);
      const choices = b.rows.filter((r) => r.status === 'active').map((r) => ({ id: r.id, label: `${r.unit_no} · ${r.buyers || ''}` }));
      receiptForm(null, receipts, choices);
    };
  }

  // ---------- stages & demands ----------
  async function demands() {
    if (!proj) return noProject();
    const d = await api(`/api/demands?project=${proj}`);
    const done = (bid, s) => d.done.find((x) => x.building_id === bid && x.stage_name === s);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Stages & demands</h1><p class="muted">Site records a stage as complete; CRM prepares the demand run; Head CRM approves it. Buyers pay within ${d.daysToPay} days.</p></div>
      <div class="actions" style="margin:0">${can('stage.record') ? '<button class="ghost" id="stage">Record a completed stage</button>' : ''}${can('demand.raise') ? '<button id="run">Prepare a demand run</button>' : ''}${can('demand.approve') ? '<button class="ghost" id="days">Days to pay</button>' : ''}</div></div>
      <div class="panel table-wrap"><h2>Construction stages</h2><table><tr><th>Stage</th>${d.buildings.map((b) => `<th>${esc(b.name)}</th>`).join('')}</tr>
        ${d.stages.map((s) => `<tr><td>${esc(s.name)} <span class="muted">(${toNum(s.pct)}%)</span></td>${d.buildings.map((b) => { const x = done(b.id, s.name); return `<td>${x ? `<span class="pill good">done ${fmtD(x.completed_on)}</span>` : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('')}</table></div>
      <div class="panel table-wrap"><h2>Demand runs</h2><table><tr><th>Building</th><th>Stage</th><th>Demand date</th><th>Due</th><th class="num">Letters</th><th class="num">Total</th><th>Status</th><th>Prepared by</th><th>Approved by</th></tr>
        ${d.runs.map((r) => `<tr class="click" data-r="${r.id}"><td>${esc(r.building || '')}</td><td>${esc(r.stage_name)}</td><td>${fmtD(r.demand_date)}</td><td>${fmtD(r.due_date)}</td><td class="num">${r.status === 'draft' ? '—' : r.letters}</td><td class="num">${r.status === 'draft' ? '—' : inr(r.total)}</td>
          <td>${r.status === 'draft' ? '<span class="pill">waiting for approval</span>' : r.status === 'approved' ? '<span class="pill good">raised</span>' : '<span class="pill grey">cancelled</span>'}</td><td>${esc(r.created_by_name || 'Sample')}</td><td>${esc(r.approved_by_name || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No demand runs yet.</td></tr>'}</table></div>`;
    document.querySelectorAll('tr[data-r]').forEach((tr) => (tr.onclick = () => go(`#/run/${tr.dataset.r}`)));
    const bOpts = d.buildings.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if ($('#stage')) $('#stage').onclick = () => dialog(`<h2>Record a completed stage</h2>
      <div class="row"><div><label>Building</label><select name="buildingId">${bOpts}</select></div><div><label>Stage</label><select name="stageName">${d.stages.map((s) => `<option>${esc(s.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Completed on</label><input type="date" name="completedOn" max="${todayIso()}" required></div><div><label>Certified by (architect / engineer)</label><input name="certifiedBy"></div></div>`,
    async (x) => { await api('/api/demands', { action: 'stage.complete', ...x }); toast('Stage recorded. CRM can now prepare the demand run.'); demands(); });
    if ($('#run')) $('#run').onclick = () => {
      const ready = d.buildings.flatMap((b) => d.done.filter((x) => x.building_id === b.id).map((x) => ({ b, s: x.stage_name })));
      dialog(`<h2>Prepare a demand run</h2><p class="muted">Only stages site has recorded as complete are listed. Buyers who already have this stage demanded are skipped.</p>
        <label>Building and stage</label><select name="pick">${ready.map((r, i) => `<option value="${i}">${esc(r.b.name)} · ${esc(r.s)}</option>`).join('')}</select>
        <label>Demand date</label><input type="date" name="demandDate" value="${todayIso()}">`,
      async (x) => { const r = ready[+x.pick]; const out = await api('/api/demands', { action: 'run.create', buildingId: r.b.id, stageName: r.s, demandDate: x.demandDate }); go(`#/run/${out.id}`); });
    };
    if ($('#days')) $('#days').onclick = () => dialog(`<h2>Days to pay</h2><label>Days after the demand date</label><input name="daysToPay" type="number" min="1" max="90" value="${d.daysToPay}">`,
      async (x) => { await api('/api/demands', { action: 'settings', ...x }); demands(); });
  }

  async function runPage(id) {
    const d = await api(`/api/demands?run=${id}`);
    const r = d.run;
    const total = d.rows.reduce((a, x) => a + toNum(x.amount), 0), gst = d.rows.reduce((a, x) => a + toNum(x.gst), 0);
    $('#page').innerHTML = `<p class="crumbs"><a href="#/demands">Stages & demands</a> › ${esc(r.building || '')} · ${esc(r.stage_name)}</p>
      <div class="page-head"><div><h1>${esc(r.building || '')} · ${esc(r.stage_name)}</h1><p class="muted">Demand date ${fmtD(r.demand_date)} · due ${fmtD(r.due_date)} · ${r.status === 'draft' ? 'waiting for approval: these buyers will be charged' : r.status === 'approved' ? 'raised' : 'cancelled'}</p></div>
      <div class="actions" style="margin:0">${r.status === 'draft' && can('demand.approve') ? '<button id="ok">Approve and raise demands</button>' : ''}${r.status === 'draft' && anyOf('demand.raise', 'demand.approve') ? '<button class="ghost" id="cancel">Cancel run</button>' : ''}</div></div>
      <div class="panel"><div class="kpis">${kpi(d.rows.length, 'buyers')}${kpi(inr(total), 'demand amount')}${kpi(inr(gst), 'GST')}</div></div>
      <div class="panel table-wrap"><table><tr><th>Unit</th><th>Buyer</th><th class="num">%</th><th class="num">Amount</th><th class="num">GST</th></tr>
        ${d.rows.map((x) => `<tr><td><a href="#/booking/${x.booking_id}">${esc(x.unit_no)}</a></td><td>${esc(x.buyers || '')}</td><td class="num">${toNum(x.pct)}%</td><td class="num">${inr(x.amount, 2)}</td><td class="num">${inr(x.gst, 2)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No buyers to charge.</td></tr>'}</table></div>`;
    if ($('#ok')) $('#ok').onclick = async () => { if (!confirm(`Raise ${d.rows.length} demands totalling ${inr(total)} plus GST?`)) return; try { const o = await api('/api/demands', { action: 'run.approve', id: r.id }); toast(`${o.raised} demands raised.`); runPage(id); } catch (e) { alert(e.message); } };
    if ($('#cancel')) $('#cancel').onclick = async () => { if (!confirm('Cancel this draft run?')) return; try { await api('/api/demands', { action: 'run.cancel', id: r.id }); go('#/demands'); } catch (e) { alert(e.message); } };
  }

  // ---------- ledgers ----------
  async function ledgers() {
    if (!proj) return noProject();
    const d = await api(`/api/ledger?project=${proj}`);
    const t = d.totals, filter = store.get('erp_lf') || 'overdue';
    const rows = d.rows.filter((r) => filter === 'all' || (filter === 'overdue' ? toNum(r.overdue) > 0 : toNum(r.advance) > 0))
      .sort((a, b) => (filter === 'overdue' ? (b.days_overdue || 0) - (a.days_overdue || 0) || toNum(b.overdue) - toNum(a.overdue) : a.unit_no.localeCompare(b.unit_no)));
    const ageMax = Math.max(...Object.values(d.ageing).map(toNum), 1);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Customer ledgers</h1><p class="muted">As of ${fmtD(d.asOf)}. Outstanding = agreement value × stages demanded − (AV + TDS) received, the same as the CRM sheet.</p></div></div>
      <div class="panel"><div class="kpis">${kpi(t.bookings, 'live bookings')}${kpi(cr(t.agreementValue), 'agreement value')}${kpi(cr(t.demanded), 'demanded')}${kpi(cr(t.received), 'received')}
        ${kpi(cr(t.outstanding), 'outstanding')}${kpi(cr(t.overdue), 'overdue', toNum(t.overdue) > 0 ? 'bad' : '')}${kpi(cr(t.gstOutstanding), 'GST outstanding')}${kpi(cr(t.advance), 'paid ahead')}</div>
        <h2 style="margin-top:18px">Overdue by age</h2><div class="ageing">${Object.entries(d.ageing).filter(([k]) => k !== 'current').map(([k, v]) => `<div class="age"><span>${k} days</span><div class="bar"><i style="width:${(toNum(v) / ageMax) * 100}%"></i></div><b>${cr(v)}</b></div>`).join('')}</div></div>
      <div class="tabs">${[['overdue', 'Overdue'], ['advance', 'Paid ahead'], ['all', 'All']].map(([k, l]) => `<button class="tab ${k === filter ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table><tr><th>Unit</th><th>Buyer</th><th class="num">Agreement value</th><th class="num">Demanded</th><th class="num">Received</th><th class="num">Outstanding</th><th class="num">Overdue</th><th class="num">Days</th><th>Oldest unpaid</th><th>Last receipt</th></tr>
      ${rows.map((r) => `<tr class="click" data-b="${r.booking_id}" data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}"><td><b>${esc(r.unit_no)}</b></td><td>${esc(r.buyers || '')}</td><td class="num">${inr(r.agreement_value)}</td><td class="num">${inr(r.demanded)}</td><td class="num">${inr(r.credit_av)}</td>
        <td class="num">${inr(r.outstanding)}</td><td class="num ${toNum(r.overdue) > 0 ? 'bad-t' : ''}">${inr(r.overdue)}</td><td class="num">${r.days_overdue ?? ''}</td><td class="small">${esc(r.oldest_stage || '')}</td><td>${fmtD(r.last_receipt)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((x) => (x.onclick = () => { store.set('erp_lf', x.dataset.t); ledgers(); }));
    document.querySelectorAll('tr[data-b]').forEach((tr) => (tr.onclick = () => go(`#/statement/${tr.dataset.b}`)));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
  }

  async function statementPage(id) {
    const d = await api(`/api/ledger?booking=${id}`);
    const h = d.head, bal = d.balance;
    $('#page').innerHTML = `<p class="crumbs no-print"><a href="#/ledgers">Customer ledgers</a> › ${esc(h.unit_no)}</p>
      <div class="actions no-print" style="margin:0 0 14px"><button id="print">Print / save as PDF</button><a class="btn ghost" href="#/booking/${id}">Open booking</a></div>
      <div class="statement panel">
        <div class="st-head"><div><b>${esc(h.company)}</b><br>${esc(h.project)}${h.rera_no ? ' · MahaRERA ' + esc(h.rera_no) : ''}</div><div class="right"><b>Statement of account</b><br>As of ${fmtD(d.asOf)}</div></div>
        <table class="kv"><tr><th>Buyer</th><td>${esc(h.buyers || '')}</td><th>Unit</th><td>${esc(h.unit_no)} · ${esc(h.building)} · ${esc(h.typology || '')} ${h.carpet_sqft ? toNum(h.carpet_sqft) + ' sq ft' : ''}</td></tr>
          <tr><th>Agreement value</th><td>${inr(d.booking.agreement_value, 2)}</td><th>Booking / registration</th><td>${fmtD(d.booking.booking_date)} / ${fmtD(d.booking.registration_date)}</td></tr></table>
        <table class="lines"><tr><th>Date</th><th>Particulars</th><th class="num">Demanded</th><th class="num">Received (AV + TDS)</th><th class="num">Balance</th><th class="num">GST demanded</th><th class="num">GST received</th><th class="num">GST balance</th></tr>
          ${d.lines.map((l) => `<tr><td>${fmtD(l.date)}</td><td>${esc(l.text)}${l.due ? `<br><span class="small muted">due ${fmtD(l.due)}</span>` : ''}</td><td class="num">${l.debit ? inr(l.debit, 2) : ''}</td><td class="num">${l.credit && toNum(l.credit) ? inr(l.credit, 2) : ''}</td><td class="num"><b>${inr(l.balance, 2)}</b></td>
            <td class="num">${l.gstDebit ? inr(l.gstDebit, 2) : ''}</td><td class="num">${l.gstCredit && toNum(l.gstCredit) ? inr(l.gstCredit, 2) : ''}</td><td class="num">${inr(l.gstBalance, 2)}</td></tr>`).join('')}</table>
        <div class="kpis">${kpi(inr(bal.demanded, 2), 'total demanded')}${kpi(inr(bal.credit_av, 2), 'total received')}${kpi(inr(bal.outstanding, 2), 'balance due')}${kpi(inr(bal.overdue, 2), 'overdue', toNum(bal.overdue) > 0 ? 'bad' : '')}${kpi(inr(bal.gst_outstanding, 2), 'GST due')}</div>
        ${d.oldest ? `<p class="small">Oldest unpaid demand: ${esc(d.oldest.stage)}, due ${fmtD(d.oldest.since)} (${d.oldest.days} days ago).</p>` : ''}
        <p class="small muted">Stamp duty and registration charges are shown on receipts but are not part of the balance. Please report any difference to the CRM team.</p></div>`;
    $('#print').onclick = () => window.print();
  }

  // ---------- demand letters ----------
  async function letters() {
    if (!proj) return noProject();
    const d = await api(`/api/letters?project=${proj}`);
    const s = d.settings, m = d.mail;
    const banner = !m.configured ? '<div class="note">The sending email account is not connected to the ERP yet, so letters can be printed or sent on WhatsApp, but not emailed.</div>'
      : !m.live ? `<div class="note">Test version: emails go <b>only</b> to ${s.testEmail ? esc(s.testEmail) : 'the test address (not set yet: open Letter settings)'}, never to buyers.</div>` : '';
    $('#page').innerHTML = `<div class="page-head"><div><h1>Demand letters</h1><p class="muted">Letters and reminders in the CRM team's format. Amounts come from the ledger: stages demanded minus (AV + TDS) received, plus GST due.</p></div>
      ${s.canEdit ? '<div class="actions" style="margin:0"><button class="ghost" id="settings">Letter settings</button></div>' : ''}</div>
      ${banner}
      <div class="panel" style="margin-top:14px"><div class="row4">
        <div><label>Letter type</label><select id="type">${d.types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div><label>Letter date (reminders)</label><input type="date" id="ldate" value="${todayIso()}" max="${todayIso()}"></div>
        <div><label>Show</label><select id="show"><option value="all">All buyers with dues (${d.rows.length})</option><option value="none">Not sent a letter yet</option><option value="overdue">Overdue only</option></select></div>
        <div style="align-self:end"><button id="prepare" ${can('demand.raise') ? '' : 'disabled'}>Prepare letters for ticked buyers</button></div></div>
        <div id="prepared"></div></div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table><tr><th><input type="checkbox" id="all"></th><th>Unit</th><th>Buyer</th><th>Stage reached</th><th class="num">Flat cost due</th><th class="num">GST due</th><th class="num">Overdue</th><th>Last letter</th><th>Email</th><th></th></tr>
      ${d.rows.map((r) => `<tr data-row="${r.booking_id}" data-sent="${r.letter_id ? 1 : 0}" data-over="${toNum(r.overdue) > 0 ? 1 : 0}" data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}">
        <td><input type="checkbox" class="pick" value="${r.booking_id}"></td><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a></td><td>${esc(r.buyers || '')}</td>
        <td>${esc(r.stage_words)} <span class="muted">(${toNum(r.cum_pct)}%)</span></td><td class="num">${inr(r.outstanding)}</td><td class="num">${inr(r.gst_outstanding)}</td><td class="num ${toNum(r.overdue) > 0 ? 'bad-t' : ''}">${inr(r.overdue)}</td>
        <td class="small">${r.letter_id ? `<a href="/api/letters?pdf=${r.letter_id}" target="_blank" rel="noopener">${esc(r.letter_type)}</a><br>${fmtD((r.sent_at || r.letter_at || '').slice(0, 10))} · ${esc(r.sent_via || 'prepared, not sent')}` : '<span class="muted">none</span>'}</td>
        <td>${r.has_email ? 'Yes' : '<span class="muted">No</span>'}</td><td><a class="small" href="#" data-prev="${r.booking_id}">Preview</a></td></tr>`).join('') || '<tr><td colspan="10" class="muted">No buyer has dues above the minimum.</td></tr>'}</table></div>`;
    const visibleRows = () => [...document.querySelectorAll('tr[data-row]')].filter((tr) => tr.style.display !== 'none');
    const apply = () => {
      const q = $('#q').value.toLowerCase(), show = $('#show').value;
      document.querySelectorAll('tr[data-row]').forEach((tr) => {
        const ok = tr.dataset.s.includes(q) && (show === 'all' || (show === 'none' && tr.dataset.sent === '0') || (show === 'overdue' && tr.dataset.over === '1'));
        tr.style.display = ok ? '' : 'none'; if (!ok) $('.pick', tr).checked = false;
      });
    };
    $('#q').oninput = apply; $('#show').onchange = apply;
    $('#all').onchange = (e) => visibleRows().forEach((tr) => ($('.pick', tr).checked = e.target.checked));
    document.querySelectorAll('[data-prev]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.open(`/api/letters?preview=${a.dataset.prev}&type=${encodeURIComponent($('#type').value)}`, '_blank', 'noopener'); }));
    $('#prepare').onclick = async () => {
      const ids = [...document.querySelectorAll('.pick:checked')].map((c) => +c.value);
      if (!ids.length) return alert('Tick the buyers to prepare letters for.');
      const btn = $('#prepare'); btn.disabled = true; btn.textContent = `Preparing ${ids.length}…`;
      try {
        const r = await api('/api/letters', { action: 'prepare', projectId: proj, bookingIds: ids, letterType: $('#type').value, letterDate: $('#ldate').value });
        preparedPanel(r.letters, m);
      } catch (e) { alert(e.message); }
      btn.disabled = false; btn.textContent = 'Prepare letters for ticked buyers';
    };
    if ($('#settings')) $('#settings').onclick = () => dialog(`<h2>Letter settings</h2>
      <div class="row"><div><label>Delay charges (% a year)</label><input name="delayRate" value="${esc(s.delayRate)}"></div><div><label>Leave out buyers owing less than (₹)</label><input name="minDue" value="${esc(s.minDue)}"></div></div>
      <label>Signed for</label><input name="signedFor" value="${esc(s.signedFor)}">
      <label>CC on every email (once live)</label><input name="cc" value="${esc(s.cc)}" placeholder="crm.prime@dreamindiagroup.com">
      <label>Test email address (test version: all letters go here)</label><input name="testEmail" value="${esc(s.testEmail)}">`,
    async (x) => { await api('/api/letters', { action: 'settings', ...x }); letters(); });
  }
  function preparedPanel(list, m) {
    const ids = list.map((l) => l.id), withEmail = list.filter((l) => l.hasEmail).map((l) => l.id);
    $('#prepared').innerHTML = `<div class="ok">${list.length} letter${list.length === 1 ? '' : 's'} prepared (total due ${inr(list.reduce((a, l) => a + l.total, 0))}). Choose how to send them:</div>
      <div class="actions">${m.configured ? `<button id="em">Email ${m.live ? withEmail.length + ' with an email address' : 'all ' + ids.length + ' to the test address'}</button>` : ''}
        <a class="btn ghost" href="/api/letters?print=${ids.join(',')}" target="_blank" rel="noopener">Open all as one PDF to print</a>
        <button class="ghost" id="courier">Mark all sent by courier</button><button class="ghost" id="wa">Mark all sent on WhatsApp</button></div><div id="sendlog" class="small"></div>`;
    const mark = async (via) => { try { await api('/api/letters', { action: 'mark', projectId: proj, letterIds: ids, via }); toast(`Marked ${ids.length} as sent by ${via}.`); letters(); } catch (e) { alert(e.message); } };
    $('#courier').onclick = () => mark('courier'); $('#wa').onclick = () => mark('whatsapp');
    if ($('#em')) $('#em').onclick = async () => {
      const send = m.live ? withEmail : ids;
      if (!send.length) return alert('None of these buyers has an email address.');
      if (!confirm(`Send ${send.length} email${send.length === 1 ? '' : 's'}${m.live ? ' to buyers' : ' to the test address'}?`)) return;
      $('#em').disabled = true; let ok = 0, bad = [];
      for (let i = 0; i < send.length; i += 20) {
        try { const r = await api('/api/letters', { action: 'email', projectId: proj, letterIds: send.slice(i, i + 20) }); for (const x of r.results) if (x.error) bad.push(`${x.unit}: ${x.error}`); else ok++; } catch (e) { bad.push(e.message); break; }
        $('#sendlog').textContent = `Sent ${ok} of ${send.length}…`;
      }
      $('#sendlog').innerHTML = `Sent ${ok}.${bad.length ? ' Not sent: ' + esc(bad.join('; ')) : ''}`;
    };
  }

  // ---------- follow-ups ----------
  async function followups() {
    if (!proj) return noProject();
    const d = await api(`/api/followups?project=${proj}`);
    const tab = store.get('erp_ftab') || 'due';
    const rows = d.rows.filter((r) => tab === 'all' || (tab === 'due' ? r.due : tab === 'broken' ? r.broken : !r.count));
    $('#page').innerHTML = `<div class="page-head"><div><h1>Follow-ups</h1><p class="muted">One shared list of every buyer with overdue dues. Log each call or WhatsApp with its outcome and the next follow-up date.</p></div></div>
      <div class="panel"><div class="kpis">${kpi(d.summary.total, 'buyers owing')}${kpi(d.summary.due, 'to follow up today')}${kpi(d.summary.broken, 'broken promises', d.summary.broken ? 'bad' : '')}${kpi(d.summary.never, 'never contacted')}</div></div>
      <div class="tabs">${[['due', 'Due today'], ['broken', 'Broken promises'], ['never', 'Never contacted'], ['all', 'All']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table><tr><th>Unit</th><th>Buyer</th><th class="num">Overdue</th><th>Last follow-up</th><th>Promise</th><th>Next</th><th>Contact</th><th></th></tr>
      ${rows.map((r) => `<tr data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}"><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a></td><td>${esc(r.buyers || '')}</td><td class="num bad-t">${inr(r.overdue)}</td>
        <td class="small">${r.count ? `${esc(r.kind)} · ${esc(r.outcome)}<br><span class="muted">${fmtD(r.last_at.slice(0, 10))} by ${esc(r.last_by || '')}${r.note ? ' · ' + esc(r.note.slice(0, 60)) : ''}</span>` : '<span class="muted">never</span>'}</td>
        <td class="small">${r.promise_date ? `${fmtD(r.promise_date)}${r.promise_amount ? ' · ' + inr(r.promise_amount) : ''}${r.broken ? ' <span class="pill bad">broken</span>' : ''}` : ''}</td>
        <td class="small">${r.next_date ? fmtD(r.next_date) : ''}</td>
        <td class="small" style="white-space:nowrap">${r.mobile ? (r.wa ? `<a href="tel:+91${esc(r.mobile)}">Call</a> · <a href="${esc(r.wa)}" target="_blank" rel="noopener">WhatsApp</a>` : esc(r.mobile)) : '<span class="muted">no mobile</span>'}</td>
        <td>${can('demand.raise') ? `<button class="small" data-log="${r.booking_id}" data-u="${esc(r.unit_no)}">Log</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_ftab', t.dataset.t); followups(); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    document.querySelectorAll('[data-log]').forEach((b) => (b.onclick = () => followupForm(+b.dataset.log, b.dataset.u, d, followups)));
  }
  function followupForm(bookingId, unit, d, after) {
    const plus = (n) => { const x = new Date(Date.now() + 5.5 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const dl = dialog(`<h2>Log a follow-up · ${esc(unit)}</h2>
      <div class="row"><div><label>How</label><select name="kind">${d.kinds.map((k) => `<option>${esc(k)}</option>`).join('')}</select></div><div><label>Outcome</label><select name="outcome">${d.outcomes.map((k) => `<option>${esc(k)}</option>`).join('')}</select></div></div>
      <label>Note</label><textarea name="note" rows="2"></textarea>
      <div class="row"><div><label>Promised to pay on</label><input type="date" name="promiseDate" min="${todayIso()}"></div><div><label>Promised amount (₹)</label><input name="promiseAmount" inputmode="decimal"></div></div>
      <label>Next follow-up</label><div class="quick">${[[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'In a week'], [15, 'In 15 days']].map(([n, l]) => `<button type="button" class="ghost small" data-n="${plus(n)}">${l}</button>`).join('')}</div>
      <input type="date" name="nextDate" min="${todayIso()}" value="${plus(3)}">`,
    async (x) => { await api('/api/followups', { action: 'add', bookingId, ...x }); toast('Follow-up saved.'); after(); });
    dl.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { dl.querySelector('[name=nextDate]').value = b.dataset.n; }));
  }

  start();
})();
