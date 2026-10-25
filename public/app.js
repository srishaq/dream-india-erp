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
  const PAGES = [
    { key: 'home', label: 'Home', show: () => true },
    { key: 'projects', label: 'Companies & projects', show: () => true },
    { key: 'plans', label: 'Payment plans', show: () => true },
    { key: 'users', label: 'Logins', show: () => can('users.manage') },
    { key: 'audit', label: 'Audit log', show: () => can('audit.view') },
  ];
  const SOON = ['Units & inventory', 'Bookings', 'Demands', 'Receipts', 'Customer ledgers'];

  function shell() {
    const page = (location.hash.replace('#/', '') || 'home');
    const pages = PAGES.filter((p) => p.show());
    const cur = pages.find((p) => p.key === page) || pages[0];
    app.innerHTML = `<div class="shell">
      <nav class="side">
        <div class="logo">${logo}<div><b>Dream India ERP</b><span>Test version</span></div></div>
        ${pages.map((p) => `<a href="#/${p.key}" class="${p === cur ? 'on' : ''}">${esc(p.label)}</a>`).join('')}
        <div class="group">Booking-to-collection</div>
        ${SOON.map((s) => `<a class="soon">${esc(s)} <span class="tag">next</span></a>`).join('')}
      </nav>
      <div class="main">
        <div class="top"><span class="test-banner">Test version: not live, no real data yet</span>
          <div class="who"><span><b>${esc(me.name)}</b> · ${esc(me.roleLabel)}</span>
            <button class="ghost small" id="cpw">Change password</button><button class="ghost small" id="out">Sign out</button></div></div>
        <div class="page" id="page"><p class="muted">Loading…</p></div>
      </div></div>`;
    $('#out').onclick = signOut;
    $('#cpw').onclick = () => changePassword(false);
    ({ home, projects, plans, users, audit })[cur.key]().catch((e) => { $('#page').innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  }
  window.addEventListener('hashchange', () => { if (me) shell(); });

  // ---------- pages ----------
  async function home() {
    const d = await api('/api/masters');
    const total = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Welcome, ${esc(me.name)}</h1>
      <p class="muted">This is the test version of the Dream India ERP. It is separate from the live staff portal.</p></div></div>
      <div class="note" style="margin-bottom:16px">Built so far: logins and roles, companies, projects, buildings, payment plans and the audit log. Next: units, bookings, demands, receipts and customer ledgers (Module 1).</div>
      <div class="grid">${d.projects.map((p) => `<div class="panel">
        <span class="pill grey">${esc(p.company)}</span>
        <h2 style="margin-top:8px">${esc(p.name)}</h2>
        <p class="muted">${esc(p.location || '')}${p.rera_no ? ' · RERA ' + esc(p.rera_no) : ''}</p>
        <div class="kpis"><div class="kpi"><b>${p.buildings.length}</b><span>buildings</span></div>
          <div class="kpi"><b>${total(p.units)}</b><span>units</span></div>
          <div class="kpi"><b>${p.plans.reduce((a, pl) => a + pl.stages.length, 0)}</b><span>payment stages</span></div></div>
      </div>`).join('') || '<p class="muted">No projects yet.</p>'}</div>`;
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

  start();
})();
