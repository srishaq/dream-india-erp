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
  const wordmark = '<img class="wordmark" src="/logo.svg" alt="Dream India Realty" width="123" height="32">';

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
    { key: 'training', label: 'Training videos', show: () => true },
    { group: 'CRM' },
    { key: 'crmtodo', label: 'Daily To-Do', show: () => anyOf('demand.raise', 'booking.create', 'booking.approve', 'ledger.view') },
    { key: 'dashboard', label: 'Collections dashboard', show: () => can('ledger.view'), href: () => `/dashboard${proj ? '?project=' + proj : ''}` },
    { key: 'units', label: 'Units & inventory', show: () => can('inventory.view') },
    { key: 'bookings', label: 'Bookings', show: () => anyOf('inventory.view', 'ledger.view') },
    { key: 'demands', label: 'Stages & demands', show: () => anyOf('demand.raise', 'demand.approve', 'stage.record', 'ledger.view') },
    { key: 'receipts', label: 'Receipts', show: () => anyOf('receipt.enter', 'receipt.approve', 'ledger.view') },
    { key: 'ledgers', label: 'Customer ledgers', show: () => can('ledger.view') },
    { key: 'letters', label: 'Demand letters', show: () => anyOf('demand.raise', 'ledger.view') },
    { key: 'followups', label: 'Follow-ups', show: () => can('ledger.view') },
    { key: 'verify', label: 'Data to verify', show: () => anyOf('inventory.view', 'ledger.view') },
    { key: 'prices', label: 'Price list & cost sheet', show: () => can('inventory.view') },
    { key: 'partners', label: 'Channel partners', show: () => can('ledger.view') },
    { group: 'Accounts' },
    { key: 'acctodo', label: 'Daily To-Do', show: () => can('accounts.view') },
    { key: 'accdash', label: 'Accounts dashboard', show: () => can('accounts.view'), href: () => '/accounts' },
    { key: 'acc', label: 'Status today', show: () => can('accounts.view') },
    { key: 'balances', label: 'Daily Bank Balance', show: () => can('accounts.view') },
    { key: 'bankauto', label: 'Bank Auto Check', show: () => can('accounts.view') },
    { key: 'reg-receipts', label: 'Receipts (bank)', show: () => can('accounts.view') },
    { key: 'reg-payments', label: 'Payments Out', show: () => can('accounts.view') },
    { key: 'reg-pdc', label: 'PDC', show: () => can('accounts.view') },
    { key: 'reg-tds', label: 'TDS Tracker', show: () => can('accounts.view') },
    { key: 'reg-recon', label: 'Reconciling Items', show: () => can('accounts.view') },
    { key: 'reg-compliance', label: 'Compliance Calendar', show: () => can('accounts.view') },
    { key: 'reg-tenants', label: 'SRA Tenants', show: () => can('accounts.view') },
    { key: 'reg-rentLinks', label: 'Tenant Rent Links', show: () => can('accounts.view') },
    { key: 'reg-cancellations', label: 'Cancelled flats', show: () => can('accounts.view') },
    { key: 'accreports', label: 'Reports & Tally', show: () => can('accounts.view') },
    { key: 'checks', label: 'Checks', show: () => can('accounts.view') },
    { key: 'bookscrm', label: 'Tally vs CRM', show: () => anyOf('accounts.view', 'ledger.view') },
    { key: 'ca', label: 'CA / Tax', show: () => can('ca.view'), href: () => '/ca' },
    { key: 'accsetup', label: 'Banks, heads & import', show: () => can('accounts.manage') },
    { group: 'Set-up' },
    { key: 'projects', label: 'Companies & projects', show: () => true },
    { key: 'plans', label: 'Payment plans', show: () => true },
    { key: 'import', label: 'Import from CRM sheet', show: () => can('users.manage') },
    { key: 'users', label: 'Logins', show: () => can('users.manage') },
    { key: 'audit', label: 'Audit log', show: () => can('audit.view') },
  ];
  const DETAIL = { booking: 'bookings', statement: 'ledgers', run: 'demands', bankauto: 'bankauto', project: 'home' };
  let projectList = null, proj = null;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // Sidebar: one heading per department (CRM, Accounts, Set-up). Tapping a heading opens its pages and folds the others;
  // the department of the page in use is open.
  const groupOf = (key) => { let g = null; for (const p of PAGES) { if (p.group) g = p.group; else if (p.key === key) return g; } return null; };
  function navHtml(nav, cur) {
    const curG = groupOf(cur.key), want = store.get('erp_nav_open');
    const dg = { crm: 'CRM', accounts: 'Accounts', audit: 'Accounts', construction: 'CRM' }[location.hash.split('/')[3]];
    const open = dg || (cur.key === 'home' ? (want != null ? want : (can('accounts.enter') && !can('demand.raise') ? 'Accounts' : 'CRM')) : curG);
    let out = '', g = null;
    for (const p of nav) {
      if (p.group) { if (g) out += '</div>'; g = p.group; const on = g === open; out += `<button type="button" class="group-btn ${on ? 'open' : ''}" data-g="${esc(g)}" aria-expanded="${on}">${esc(g)}<span class="chev">${on ? '▾' : '▸'}</span></button><div class="grp" data-g="${esc(g)}" ${on ? '' : 'hidden'}>`; continue; }
      out += `<a href="${p.href ? p.href() : '#/' + p.key}" class="${p === cur ? 'on' : ''}">${esc(p.label)}</a>`;
    }
    return out + (g ? '</div>' : '');
  }
  function wireNav() {
    document.querySelectorAll('.side .group-btn').forEach((b) => (b.onclick = () => {
      const opening = b.getAttribute('aria-expanded') !== 'true';
      document.querySelectorAll('.side .group-btn').forEach((x) => { const on = opening && x === b; x.classList.toggle('open', on); x.setAttribute('aria-expanded', on); x.querySelector('.chev').textContent = on ? '▾' : '▸'; });
      document.querySelectorAll('.side .grp').forEach((d) => (d.hidden = !(opening && d.dataset.g === b.dataset.g)));
      store.set('erp_nav_open', opening ? b.dataset.g : '');
    }));
  }

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
        <a class="logo" href="#/home">${wordmark}<div><b>ERP</b><span>Test version</span></div></a>
        ${navHtml(nav, cur)}
      </nav>
      <div class="main">
        <div class="top no-print"><div class="who">${projectList.length > 1 ? `<select id="proj" class="proj">${projectList.map((p) => `<option value="${p.id}" ${p.id === proj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : `<b>${esc(projectList[0]?.name || '')}</b>`}
          <span class="test-banner">Test version: not live yet</span></div>
          <div class="who"><span><b>${esc(me.name)}</b> · ${esc(me.roleLabel)}</span>
            <button class="ghost small" id="cpw">Change password</button><button class="ghost small" id="out">Sign out</button></div></div>
        <div class="page" id="page"><p class="muted">Loading…</p></div>
      </div></div>`;
    wireNav();
    $('#out').onclick = signOut;
    $('#cpw').onclick = () => changePassword(false);
    if ($('#proj')) $('#proj').onchange = (e) => { proj = +e.target.value; store.set('erp_project', proj); shell(); };
    if (/^reg-/.test(page || '') && can('accounts.view')) { try { await accRegister(page.slice(4)); } catch (e) { $('#page').innerHTML = `<div class="err">${esc(e.message)}</div>`; } return; }
    const fn = { home, project: projectHome, crmtodo: () => dailyTodo('crm'), acctodo: () => dailyTodo('accounts'), training, projects, plans, users, audit, units, bookings, demands, receipts, ledgers, letters, followups, verify, prices, partners, acc: accTodo, balances: accBalances, bankauto: bankAuto, bookscrm: booksCrm, accreports: accReports, checks: accChecks, accsetup: accSetup, import: importPage, booking: bookingPage, statement: statementPage, run: runPage };
    const key = DETAIL[page] && arg ? page : cur.key;
    try { await fn[key](arg ? +arg : undefined); } catch (e) { $('#page').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  const go = (h) => { if (location.hash === h) shell(); else location.hash = h; };
  window.addEventListener('hashchange', () => { if (me) shell(); });

  // ---------- pages ----------
  const HP = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const HICON = {
    tower: `<svg ${HP}><path d="M4 21h16M6 21V5l6-3v19M12 21V8l6 3v10"/></svg>`,
    building: `<svg ${HP}><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/></svg>`,
    chart: `<svg ${HP}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
    grid: `<svg ${HP}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    rupee: `<svg ${HP}><path d="M6 4h12M6 9h12M14 20 7 13h2a4 4 0 0 0 0-9"/></svg>`,
    mail: `<svg ${HP}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
    phone: `<svg ${HP}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>`,
    check: `<svg ${HP}><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>`,
    book: `<svg ${HP}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/></svg>`,
    hammer: `<svg ${HP}><path d="M15 12 6 21l-3-3 9-9M14 4l6 6-3 3-6-6z"/></svg>`,
    cart: `<svg ${HP}><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h9.2a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/></svg>`,
    users: `<svg ${HP}><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5"/></svg>`,
  };
  const TONES = ['#140C59', '#0E8C9B', '#2B5C8A', '#7A5C99', '#117A65', '#B7791F'];
  const tile = (t) => {
    const inner = `<span class="ic">${HICON[t.icon] || HICON.building}</span><span><h3>${esc(t.title)}</h3><p>${esc(t.sub || '')}</p></span>
      ${t.soon ? '<span class="status">Coming soon</span>' : `<span class="open">${t.ext ? 'Open ↗' : 'Open →'}</span>`}`;
    return t.soon ? `<div class="tile soon" style="--tone:${t.tone}">${inner}</div>`
      : `<a class="tile" style="--tone:${t.tone}" href="${esc(t.href)}" ${t.ext ? 'target="_blank" rel="noopener"' : ''}>${inner}</a>`;
  };
  // Home → a project → its departments (Sales & CRM, Accounts, …) → the working pages of that department.
  const SUB = {
    dashboard: 'Daily collections, dues, tower status, channel partners', units: 'Every unit, floor by floor, both wings side by side',
    bookings: 'Bookings, applicants, cancellations and transfers', demands: 'Construction stages and the demands raised on them',
    receipts: 'Enter receipts; Head Accounts approves them', ledgers: 'Each buyer’s statement of demands and payments',
    letters: 'Stage demands and reminders, by email or courier', followups: 'Calls, WhatsApps and promises to pay',
    verify: 'Items from the import still to check and close', prices: 'Rates, floor rise and the cost sheet', partners: 'Channel partners and brokerage',
    crmtodo: 'Today’s calls, approvals, letters and what the 9 am check found', acctodo: 'What the 9 am Accounts audit found, plus your own tasks',
    training: 'Short videos on how to use each part of the ERP',
    accdash: 'Bank balances, collections, refunds, TDS, PDC, SRA tenants and reconciliation', acc: 'Live status of the registers: what is missing right now',
    balances: 'Closing balance of every bank account, day by day', bankauto: 'The 3:10 pm check of bank statements against the books',
    'reg-receipts': 'Every receipt as it came into the bank', 'reg-payments': 'Every payment out, by head', 'reg-pdc': 'Post-dated cheques and their reminders',
    'reg-tds': 'TDS deducted and challans paid', 'reg-recon': 'Items the bank and the books do not yet agree on', 'reg-compliance': 'GST, TDS and RERA due dates',
    'reg-tenants': 'SRA tenants and their rent', 'reg-rentLinks': 'Rent payment links for each tenant', 'reg-cancellations': 'Cancelled flats and refunds still to pay',
    accreports: 'Reports and the Tally import', checks: 'Daily checks on the registers', bookscrm: 'Tally receipts flat by flat against the CRM',
    ca: 'GST, TDS payable, RERA quarterly and cash flow, for the CA', accsetup: 'Bank accounts, heads, statement folders and imports', audit: 'Who changed what, and when',
  };
  const PICON = { crmtodo: 'check', acctodo: 'check', training: 'book', dashboard: 'chart', units: 'grid', bookings: 'book', demands: 'tower', receipts: 'rupee', ledgers: 'book', letters: 'mail', followups: 'phone', verify: 'check', prices: 'rupee', partners: 'users',
    accdash: 'chart', acc: 'check', balances: 'rupee', bankauto: 'check', 'reg-cancellations': 'users', bookscrm: 'check', checks: 'check', audit: 'book', ca: 'chart', accsetup: 'grid' };
  const DEPTS = [
    { key: 'crm', title: 'Sales & CRM', sub: 'Collections, units, bookings, demands, receipts and follow-ups', icon: 'chart', tone: '#2B5C8A', group: 'CRM' },
    { key: 'construction', title: 'Construction', sub: 'Construction stages, contractor billing and site progress', icon: 'hammer', tone: '#B7791F', pages: ['demands'], later: ['Contractor billing', 'Site progress'] },
    { key: 'accounts', title: 'Accounts', sub: 'Bank, receipts, payments, PDC, TDS, SRA rent, GST, SDR and Tally', icon: 'book', tone: '#117A65', group: 'Accounts', skip: ['ca', 'bookscrm', 'checks'] },
    { key: 'audit', title: 'CRM/Accounts Audit', sub: 'Tally against the CRM, checks, reconciling items and cancelled flats', icon: 'check', tone: '#0E8C9B', pages: ['bookscrm', 'checks', 'reg-recon', 'reg-cancellations', 'verify', 'audit'] },
    { key: 'ca', title: 'CA / Tax', sub: 'GST, TDS payable, RERA quarterly, cash flow and compliance', icon: 'chart', tone: '#7A5C99', direct: 'ca' },
    { key: 'purchase', title: 'Purchase', sub: 'Indents, purchase orders and site stock', icon: 'cart', tone: '#117A65', soon: true },
    { key: 'drawings', title: 'Drawings', sub: 'Approved plans, working drawings and revisions', icon: 'grid', tone: '#2B5C8A', soon: true },
    { key: 'hr', title: 'HR & Admin', sub: 'Staff records, leave, letters and HR policies', icon: 'users', tone: '#7A5C99', soon: true },
    { key: 'training', title: 'Training videos', sub: 'Short videos on how to use each part of the ERP', icon: 'book', tone: '#B7791F', direct: 'training' },
  ];
  const pagesOf = (d) => {
    let keys = d.pages;
    if (d.group) { keys = []; let g = null; for (const p of PAGES) { if (p.group) g = p.group; else if (g === d.group && !(d.skip || []).includes(p.key)) keys.push(p.key); } }
    return (keys || []).map((k) => PAGES.find((p) => p.key === k)).filter((p) => p && p.show());
  };
  const hrefOf = (p) => (p.href ? p.href() : '#/' + p.key);
  const heroHtml = (eyebrow, title, sub, back) => `<div class="hero"><div class="hero-in">${back ? `<a class="back" href="${esc(back[0])}">← ${esc(back[1])}</a>` : ''}<span class="eyebrow">${esc(eyebrow)}</span>
      <h1>${esc(title)}</h1><p>${esc(sub)}</p></div></div>`;
  const projSub = (p) => {
    const total = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    const floors = Math.max(0, ...p.buildings.map((b) => +b.floors || +b.top_floor || 0));
    const n = total(p.units), sold = (p.units.booked || 0) + (p.units.registered || 0);
    return [p.location, p.buildings.length ? `${p.buildings.length} tower${p.buildings.length > 1 ? 's' : ''}${floors ? ' of ' + floors + ' floors' : ''}` : '', n ? `${sold} of ${n} units sold` : 'no units yet'].filter(Boolean).join(' · ');
  };

  async function home() {
    const d = await api('/api/masters');
    const total = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    const now = new Date(), h = +now.toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' });
    const first = (me.name || '').split(' ')[0];
    const cur = d.projects.find((p) => p.id === proj);
    const act = d.projects.filter((p) => p.active);
    const projTiles = act.map((p, i) => ({ title: p.name, sub: projSub(p), icon: i % 2 ? 'building' : 'tower', tone: TONES[i % TONES.length], proj: p.id, href: `#/project/${p.id}` }));
    if (!act.some((p) => /aspire/i.test(p.name))) projTiles.push({ title: 'Dream Aspire', sub: 'Lokhandwala, Andheri West · commercial · not in the ERP yet', icon: 'building', tone: '#0E8C9B', soon: true });
    const tools = [
      { title: 'New Project Feasibility', sub: 'SRA Feasibility Desk · analyse Reg. 33(10) sites and keep the register', icon: 'chart', tone: '#2B5C8A', href: 'https://claude.ai/artifact/EnCX84ZBXUSRTzQ52qf4D6', ext: true },
      { title: 'HR & Admin', sub: 'Staff records, leave, letters and HR policies', icon: 'users', tone: '#7A5C99', soon: true },
    ];
    const sample = can('users.manage') && cur && (!total(cur.units) || cur.sample) ? `<div class="panel"><h2>Sample data for testing</h2>
      <p class="muted">Loads Dream Signature A and B Wing (floors 10 to 45, 8 units a floor) with made-up "Sample Buyer" bookings, demands up to the stages the real project has reached, and receipts. It never touches real data and can be removed in one click.</p>
      <div class="actions">${total(cur.units) ? '<button class="danger" id="clearSample">Remove sample data</button>' : '<button id="loadSample">Load sample data</button>'}</div></div>` : '';
    $('#page').innerHTML = heroHtml(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
        `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${first ? ', ' + first : ''}`, 'Your projects and tools in one place. Tap a tile to open it.') + `
      <div class="hm">
        <section class="hgroup"><h2>Projects</h2><div class="tiles">${projTiles.map(tile).join('') || '<p class="muted">No projects yet.</p>'}</div></section>
        <section class="hgroup"><h2>Tools</h2><div class="tiles">${tools.map(tile).join('')}</div></section>
        <p class="hnote">Tiles marked ↗ open in a new tab.</p>
        ${sample}
      </div>`;
    if ($('#loadSample')) $('#loadSample').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Loading… (about 20 seconds)'; try { const r = await api('/api/sample', { action: 'load', projectId: proj }); toast(`Loaded ${r.units} units, ${r.bookings} bookings, ${r.demands} demands and ${r.receipts} receipts.`); home(); } catch (x) { e.target.disabled = false; e.target.textContent = 'Load sample data'; alert(x.message); } };
    if ($('#clearSample')) $('#clearSample').onclick = async (e) => { if (!confirm('Remove all sample units, bookings, demands and receipts for this project?')) return; e.target.disabled = true; try { await api('/api/sample', { action: 'clear', projectId: proj }); home(); } catch (x) { e.target.disabled = false; alert(x.message); } };
  }

  // #/project/<id> shows the departments; #/project/<id>/<dept> shows that department's pages.
  async function projectHome(id) {
    const d = await api('/api/masters');
    const p = d.projects.find((x) => x.id === id && x.active);
    if (!p) { $('#page').innerHTML = '<div class="err">This project is not in the ERP.</div>'; return; }
    if (proj !== p.id) { proj = p.id; store.set('erp_project', proj); if ($('#proj')) $('#proj').value = proj; }
    const dept = DEPTS.find((x) => x.key === location.hash.split('/')[3]);
    if (dept && !dept.soon && !dept.direct) {
      const tiles = pagesOf(dept).map((pg) => ({ title: pg.label, sub: SUB[pg.key] || '', icon: PICON[pg.key] || dept.icon, tone: dept.tone, href: hrefOf(pg) }))
        .concat((dept.later || []).map((t) => ({ title: t, sub: '', icon: dept.icon, tone: dept.tone, soon: true })));
      $('#page').innerHTML = heroHtml(p.name, dept.title, dept.sub, [`#/project/${p.id}`, p.name]) + `<div class="hm"><section class="hgroup"><h2>Pages</h2><div class="tiles">${tiles.map(tile).join('') || '<p class="muted">Your login has no pages in this section.</p>'}</div></section></div>`;
      return;
    }
    const tiles = DEPTS.map((x) => {
      if (x.soon) return { ...x };
      if (x.direct) { const pg = PAGES.find((q) => q.key === x.direct); return pg && pg.show() ? { ...x, href: hrefOf(pg) } : null; }
      const pgs = pagesOf(x);
      if (!pgs.length) return x.later ? { ...x, soon: true } : null;
      return { ...x, href: `#/project/${p.id}/${x.key}` };
    }).filter(Boolean);
    $('#page').innerHTML = heroHtml('Project', p.name, projSub(p), ['#/home', 'Home']) + `<div class="hm"><section class="hgroup"><h2>Departments</h2><div class="tiles">${tiles.map(tile).join('')}</div></section></div>`;
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
    // Default: all sale wings side by side. A single building can still be picked from the tabs.
    const sideBySide = blds.filter((b) => b.kind !== 'rehab' && d.units.some((u) => u.building_id === b.id));
    const one = blds.find((b) => b.id === bTab);
    const shown = one ? [one] : sideBySide.length ? sideBySide : blds.slice(0, 1);
    const bld = shown.length === 1 ? shown[0] : null;
    const cell = (u) => `<button class="unit s-${u.status}${toNum(u.overdue) > 0 ? ' overdue' : ''}" data-u="${u.id}" title="${esc(u.unit_no)} · ${esc(STATUS[u.status] || u.status)}${u.buyer ? ' · ' + esc(u.buyer) : ''}">${esc(u.unit_no.split('-').pop())}</button>`;
    const legend = (list) => { const counts = {}; for (const u of list) counts[u.status] = (counts[u.status] || 0) + 1;
      return `<div class="legend">${Object.keys(STATUS).filter((k) => counts[k]).map((k) => `<span><i class="sw s-${k}"></i>${STATUS[k]} <b>${counts[k]}</b></span>`).join('')}
        ${list.some((u) => toNum(u.overdue) > 0) ? `<span><i class="sw overdue-sw"></i>Overdue <b>${list.filter((u) => toNum(u.overdue) > 0).length}</b></span>` : ''}</div>`; };
    const tower = (b) => {
      const list = d.units.filter((u) => u.building_id === b.id);
      const floors = [...new Set(list.map((u) => u.floor))].sort((a, b2) => b2 - a);
      return `<div class="panel tower">${shown.length > 1 ? `<h2>${esc(b.name)} <span class="muted small">${list.length} units</span></h2>` : ''}${legend(list)}
        ${floors.length ? `<div class="floors">${floors.map((f) => `<div class="floor"><span class="fl">${f}</span>${list.filter((u) => u.floor === f).map(cell).join('')}</div>`).join('')}</div>` : '<p class="muted">No units yet in this building.' + (can('users.manage') ? ' For testing, load sample data from the Home page, or import from the CRM sheet.' : '') + '</p>'}</div>`;
    };
    $('#page').innerHTML = `<div class="page-head"><div><h1>Units & inventory</h1><p class="muted">Every unit, floor by floor. A red corner means the buyer has overdue dues.</p></div>
      ${can('inventory.edit') && bld ? '<div class="actions" style="margin:0"><button class="ghost" id="gen">Add units</button></div>' : ''}</div>
      <div class="tabs">${sideBySide.length > 1 ? `<button class="tab ${!one ? 'on' : ''}" data-b="0">All wings</button>` : ''}${blds.map((b) => `<button class="tab ${b === one || (!one && shown.length === 1 && b === shown[0]) ? 'on' : ''}" data-b="${b.id}">${esc(b.name)}</button>`).join('')}</div>
      <div class="towers">${shown.map(tower).join('')}</div>`;
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
        ${!u.booking_id ? `<a class="btn ghost" target="_blank" rel="noopener" href="/api/prices?unit=${u.id}&html=1">Cost sheet</a>` : ''}
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
    const docBtns = [`<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=costsheet">Cost sheet</a>`];
    if (can('buyer.kyc')) docBtns.push(`<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=allotment">Allotment letter</a>`, `<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=form">Booking form</a>`);
    if (can('buyer.kyc') && b.status === 'active') docBtns.push(`<button class="ghost small" id="welcome">Welcome email${b.welcome_sent_at ? ' (sent ' + fmtD(b.welcome_sent_at.slice(0, 10)) + ')' : ''}</button>`);
    if (b.status === 'active' && b.cancel_requested_at && can('cancellation.approve')) actions.push('<button class="danger" id="cancelOk">Approve cancellation</button><button class="ghost" id="cancelNo">Keep the booking</button>');
    const statusPill = { pending: '<span class="pill">waiting for approval</span>', active: '<span class="pill good">active</span>', cancelled: '<span class="pill bad">cancelled</span>', rejected: '<span class="pill bad">rejected</span>' }[b.status] || '';
    $('#page').innerHTML = `<p class="crumbs"><a href="#/bookings">Bookings</a> › ${esc(d.unit.unit_no)}</p>
      <div class="page-head"><div><h1>${esc(d.unit.unit_no)} · ${esc(d.applicants.map((a) => a.name).join(' & '))} ${statusPill}${b.sample ? ' <span class="pill grey">sample</span>' : ''}</h1>
        <p class="muted">${esc(d.unit.project)} · ${esc(d.unit.building)} · floor ${d.unit.floor ?? '—'} · ${esc(d.unit.typology || '')} ${d.unit.carpet_sqft ? toNum(d.unit.carpet_sqft) + ' sq ft' : ''} · ${esc(d.unit.company)}</p></div></div>
      ${b.cancel_requested_at && b.status === 'active' ? `<div class="note" style="margin-bottom:14px">Cancellation requested on ${fmtD(b.cancel_requested_at)}: ${esc(b.cancel_reason)}. Waiting for Management.</div>` : ''}
      <div class="actions" style="margin:0 0 10px">${actions.join('')}</div>
      <div class="actions" style="margin:0 0 16px"><span class="muted small" style="align-self:center">Documents:</span>${docBtns.join('')}</div>
      <div class="panel"><div class="kpis">${kpi(inr(b.agreement_value), 'agreement value')}${kpi(inr(bal.demanded), 'demanded')}${kpi(inr(bal.credit_av), 'received (AV + TDS)')}
        ${kpi(inr(bal.outstanding), 'outstanding')}${kpi(inr(bal.overdue), 'overdue', toNum(bal.overdue) > 0 ? 'bad' : '')}${kpi(inr(bal.gst_outstanding), 'GST outstanding')}</div></div>
      <div class="two">
        <div class="panel"><h2>Booking</h2><table class="kv">
          <tr><th>Booking date</th><td>${fmtD(b.booking_date)}</td></tr><tr><th>Agreement / registration</th><td>${fmtD(b.agreement_date)} / ${fmtD(b.registration_date)}</td></tr>
          <tr><th>GST rate</th><td>${toNum(b.gst_rate)}%</td></tr><tr><th>Stamp duty / registration fee</th><td>${b.stamp_duty ? inr(b.stamp_duty) : '—'} / ${b.registration_fee ? inr(b.registration_fee) : '—'}</td></tr>
          <tr><th>Funding</th><td>${esc(b.funding === 'loan' ? 'Home loan · ' + (b.loan_bank || '') : b.funding === 'self' ? 'Self' : '—')}</td></tr><tr><th>Parking</th><td>${b.parking}</td></tr>
          <tr><th>Source / CP</th><td>${esc([b.source, b.cp_name].filter(Boolean).join(' · ') || '—')}</td></tr><tr><th>Brokerage</th><td>${b.brokerage ? inr(b.brokerage) : '—'}</td></tr></table>
          <h2 style="margin-top:16px">Dates &amp; status ${b.status === 'active' && anyOf('booking.create', 'demand.raise') ? '<button class="ghost small" id="editDates" style="float:right">Edit</button>' : ''}</h2><table class="kv">
          <tr><th>Booking form received</th><td>${fmtD(b.booking_form_date)}</td></tr><tr><th>Registration status</th><td>${esc(b.registration_status || (b.registration_date ? 'Done' : '—'))}</td></tr>
          <tr><th>Registration appointment</th><td>${fmtD(b.registration_appointment)}</td></tr><tr><th>Bank NOC</th><td>${fmtD(b.bank_noc_date)}</td></tr>
          <tr><th>Possession</th><td>${fmtD(b.possession_date)}</td></tr><tr><th>Follow-up tag</th><td>${esc(b.crm_status || '—')}</td></tr></table></div>
        <div class="panel"><h2>Applicants</h2>${d.applicants.map((a) => `<p><b>${esc(a.name)}</b><br><span class="muted">PAN ${esc(a.pan || '—')} · Aadhaar ${esc(a.aadhaar || '—')}<br>${esc(a.phone || '')} ${esc(a.email || '')}<br>${esc(a.address || '')}</span></p>`).join('')}</div>
      </div>
      <div class="panel"><h2>Payment plan</h2><div class="table-wrap"><table><tr><th class="num">#</th><th>Stage</th><th class="num">%</th><th class="num">Amount</th><th>Demanded on</th><th>Due</th></tr>
        ${d.plan.map((s) => { const x = demanded.get(s.name); return `<tr class="${x ? '' : 'dim'}"><td class="num">${s.seq}</td><td>${esc(s.name)}</td><td class="num">${toNum(s.pct)}%</td><td class="num">${inr(toNum(b.agreement_value) * toNum(s.pct) / 100)}</td><td>${x ? fmtD(x.demand_date) : 'not yet'}</td><td>${x ? fmtD(x.due_date) : ''}</td></tr>`; }).join('')}</table></div></div>
      <div class="panel"><h2>Receipts</h2><div class="table-wrap"><table><tr><th>Date</th><th>Bank / instrument</th><th class="num">Amount</th><th>Split</th><th>Status</th></tr>
        ${d.receipts.map((r) => `<tr><td>${fmtD(r.received_on)}</td><td>${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode)}</td><td class="num">${inr(r.amount, 2)}</td>
          <td class="small">${Object.entries(r.splits).map(([h, v]) => `${HEAD[h] || h} ${inr(v, 2)}`).join(' · ')}</td><td>${rStatus(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No receipts yet.</td></tr>'}</table></div></div>`;
    const iv = await api(`/api/verify?booking=${b.id}`).catch(() => ({ rows: [] }));
    const open = iv.rows.filter((x) => x.status === 'open');
    if (open.length) $('.panel', $('#page')).insertAdjacentHTML('beforebegin', `<div class="note" style="margin-bottom:14px"><b>${open.length} item${open.length === 1 ? '' : 's'} to verify from the import:</b><ul class="small" style="margin:6px 0 0 18px;padding:0">${open.map((x) => `<li>${esc(x.detail)}</li>`).join('')}</ul><a href="#/verify">Open Data to verify</a></div>`);
    if (can('ledger.view')) {
      const f = await api(`/api/followups?booking=${b.id}`);
      $('#page').insertAdjacentHTML('beforeend', `<div class="panel"><h2>Follow-ups</h2><div class="table-wrap"><table><tr><th>When</th><th>How</th><th>Outcome</th><th>Note</th><th>Promise</th><th>Next</th><th>By</th></tr>
        ${f.rows.map((x) => `<tr><td>${fmtD(x.created_at.slice(0, 10))}</td><td>${esc(x.kind)}</td><td>${esc(x.outcome)}</td><td class="small">${esc(x.note || '')}</td><td class="small">${x.promise_date ? fmtD(x.promise_date) + (x.promise_amount ? ' · ' + inr(x.promise_amount) : '') : ''}</td><td class="small">${x.next_date ? fmtD(x.next_date) : ''}</td><td>${esc(x.by_name || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No follow-ups yet.</td></tr>'}</table></div></div>`);
      if ($('#logf')) $('#logf').onclick = () => followupForm(b.id, d.unit.unit_no, f, () => bookingPage(id));
    }
    const act = async (body, msg) => { try { await api('/api/bookings', { id: b.id, ...body }); if (msg) toast(msg); bookingPage(id); } catch (e) { alert(e.message); } };
    if ($('#editDates')) $('#editDates').onclick = () => dialog(`<h2>Dates &amp; status · ${esc(d.unit.unit_no)}</h2>
      <div class="row"><div><label>Booking form received</label><input type="date" name="bookingFormDate" value="${esc(b.booking_form_date || '')}"></div><div><label>Registration status</label><input name="registrationStatus" list="regst" value="${esc(b.registration_status || '')}"><datalist id="regst"><option>Done</option><option>Registration Lineup</option><option>Pending</option></datalist></div></div>
      <div class="row"><div><label>Registration appointment</label><input type="date" name="registrationAppointment" value="${esc(b.registration_appointment || '')}"></div><div><label>Bank NOC date</label><input type="date" name="bankNocDate" value="${esc(b.bank_noc_date || '')}"></div></div>
      <div class="row"><div><label>Possession date</label><input type="date" name="possessionDate" value="${esc(b.possession_date || '')}"></div><div><label>Follow-up tag</label><input name="crmStatus" list="crmst" value="${esc(b.crm_status || '')}"><datalist id="crmst"><option>Defaulter</option><option>Follow Up</option><option>Confirmed</option><option>Part Payment & PDC</option><option>Floor Approval Pending</option><option>Management Reference</option><option>Medical Emergency</option></datalist></div></div>
      <p class="small muted">"No Due", "GST Due" and "TDS Due Only" are worked out from the figures on the dashboard; the tag here is the CRM team's own (Defaulter and so on).</p>`,
    async (x) => { await api('/api/bookings', { action: 'dates', id: b.id, ...x }); toast('Saved.'); bookingPage(id); });
    if ($('#welcome')) $('#welcome').onclick = async () => {
      try {
        const w = await api(`/api/docs?booking=${b.id}&doc=welcome`);
        const dl = dialog(`<h2>Welcome email · ${esc(d.unit.unit_no)}</h2><p class="muted">${w.live ? `Goes to ${esc(w.to.join(', ') || 'no email address on file')}.` : 'Test version: this goes only to the test email address in Letter settings, not to the buyer.'}${w.sentAt ? ` Already sent on ${fmtD(w.sentAt.slice(0, 10))}.` : ''}</p>
          <label>Subject</label><input value="${esc(w.subject)}" disabled><label>Message</label><textarea rows="16" disabled>${esc(w.text)}</textarea>`,
        async () => { const r = await api('/api/docs', { action: 'welcome', bookingId: b.id }); toast(`Welcome email sent to ${r.to}.`); bookingPage(id); });
        $('[value=save]', dl).textContent = 'Send email';
      } catch (e) { alert(e.message); }
    };
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

  // ---------- price list and cost sheet ----------
  async function prices() {
    if (!proj) return noProject();
    const [d, u] = await Promise.all([api(`/api/prices?project=${proj}`), api(`/api/units?project=${proj}`)]);
    const live = d.lists.filter((l) => l.active);
    const cur = live[0];
    const free = u.units.filter((x) => ['available', 'blocked', 'held'].includes(x.status) && !x.booking_id).sort((a, b) => a.unit_no.localeCompare(b.unit_no, 'en', { numeric: true }));
    $('#page').innerHTML = `<div class="page-head"><div><h1>Price list &amp; cost sheet</h1><p class="muted">The current price per sq ft of carpet area, and a cost sheet for any unsold unit: agreement value, GST, stamp duty, registration and the stage-wise payment schedule.</p></div>
      ${d.canEdit ? '<div class="actions" style="margin:0"><button id="newPl">New price list</button></div>' : ''}</div>
      <div class="two">
        <div class="panel"><h2>Make a cost sheet</h2>${cur ? `<form id="csf">
          <label>Unit</label><select name="unit" required><option value="">Choose an unsold unit</option>${free.map((x) => `<option value="${x.id}">${esc(x.unit_no)} · floor ${x.floor ?? '—'} · ${esc(x.typology || '')} ${x.carpet_sqft ? toNum(x.carpet_sqft) + ' sq ft' : ''}${x.status !== 'available' ? ' · ' + esc(STATUS[x.status] || x.status) : ''}</option>`).join('')}</select>
          <div class="row"><div><label>Parking spaces</label><input name="parking" type="number" min="0" value="0"></div><div><label>Discount (₹ per sq ft)</label><input name="discount" inputmode="decimal" placeholder="0"></div></div>
          <div class="row"><div><label>For (buyer name, optional)</label><input name="buyer"></div><div><label>&nbsp;</label><label class="check"><input type="checkbox" name="woman"> First buyer is a woman (1% lower stamp duty)</label></div></div>
          <div id="csOut"></div>
          <div class="actions"><button type="button" class="ghost" id="csCalc">Work it out</button><button type="submit">Open printable cost sheet</button></div></form>` : `<p class="muted">There is no price list yet.${d.canEdit ? ' Add one first.' : ' Head CRM or Management adds it.'}</p>`}</div>
        <div class="panel"><h2>Current price list</h2>${cur ? `<table class="kv"><tr><th>Name</th><td>${esc(cur.name)} · from ${fmtD(cur.effective_from)}</td></tr>
          <tr><th>Base rate</th><td>${inr(cur.base_rate)} per sq ft carpet</td></tr><tr><th>Floor rise</th><td>${toNum(cur.floor_rise) ? `${inr(cur.floor_rise)} per sq ft per floor above floor ${cur.floor_rise_from}` : 'None'}</td></tr>
          <tr><th>Parking</th><td>${toNum(cur.parking_price) ? inr(cur.parking_price) + ' per space' : 'Not charged separately'}</td></tr><tr><th>GST</th><td>${toNum(cur.gst_rate)}%</td></tr>
          <tr><th>Stamp duty</th><td>${toNum(cur.stamp_duty_pct)}% (woman buyer ${toNum(cur.stamp_duty_women_pct)}%)</td></tr><tr><th>Registration fee</th><td>1%, up to ${inr(cur.registration_fee)}</td></tr>
          ${(cur.other_charges || []).map((c) => `<tr><th>${esc(c.name)}</th><td>${inr(c.amount)}</td></tr>`).join('')}${cur.notes ? `<tr><th>Notes</th><td>${esc(cur.notes)}</td></tr>` : ''}</table>` : '<p class="muted">None yet.</p>'}</div>
      </div>
      ${d.lists.length ? `<div class="panel"><h2>All price lists</h2><div class="table-wrap"><table><tr><th>Name</th><th>From</th><th class="num">Base rate</th><th class="num">Floor rise</th><th class="num">Parking</th><th>By</th><th></th></tr>
        ${d.lists.map((l) => `<tr class="${l.active ? '' : 'dim'}"><td>${esc(l.name)} ${l.active ? (l === cur ? '<span class="pill good">current</span>' : '') : '<span class="pill grey">withdrawn</span>'}</td><td>${fmtD(l.effective_from)}</td><td class="num">${inr(l.base_rate)}</td><td class="num">${inr(l.floor_rise)}</td><td class="num">${inr(l.parking_price)}</td><td>${esc(l.created_by_name || '')}</td>
          <td class="num">${d.canEdit && l.active ? `<button class="ghost small" data-off="${l.id}">Withdraw</button>` : ''}</td></tr>`).join('')}</table></div></div>` : ''}`;
    const q = (f) => new URLSearchParams({ unit: f.unit.value, parking: f.parking.value || 0, discount: f.discount.value || 0, woman: f.woman.checked ? '1' : '', buyer: f.buyer.value || '' });
    const f = $('#csf');
    if (f) {
      $('#csCalc').onclick = async () => {
        if (!f.unit.value) return alert('Choose a unit.');
        try { const c = await api('/api/prices?' + q(f));
          $('#csOut').innerHTML = `<div class="kpis" style="margin:10px 0">${kpi(inr(c.agreementValue), 'agreement value')}${kpi(inr(c.gst), 'GST')}${kpi(inr(c.stampDuty), 'stamp duty')}${kpi(inr(c.registration), 'registration')}${kpi(inr(c.total), 'total cost')}</div>`;
        } catch (e) { alert(e.message); }
      };
      f.onsubmit = (e) => { e.preventDefault(); if (!f.unit.value) return alert('Choose a unit.'); window.open('/api/prices?' + q(f) + '&html=1', '_blank', 'noopener'); };
    }
    document.querySelectorAll('[data-off]').forEach((x) => (x.onclick = async () => { if (!confirm('Withdraw this price list? It stays on record but is no longer used for new cost sheets.')) return; try { await api('/api/prices', { action: 'deactivate', id: +x.dataset.off }); prices(); } catch (e) { alert(e.message); } }));
    if ($('#newPl')) $('#newPl').onclick = () => {
      const dl = dialog(`<h2>New price list</h2><p class="muted">Cost sheets use the newest price list still in force. Older ones stay on record.</p>
        <div class="row"><div><label>Name</label><input name="name" required placeholder="e.g. Launch price, October 2026" value="${esc(cur ? '' : '')}"></div><div><label>In force from</label><input type="date" name="effectiveFrom" value="${todayIso()}"></div></div>
        <div class="row"><div><label>Base rate (₹ per sq ft carpet)</label><input name="baseRate" inputmode="decimal" required value="${esc(cur ? toNum(cur.base_rate) : '')}"></div><div><label>Parking (₹ per space)</label><input name="parkingPrice" inputmode="decimal" value="${esc(cur ? toNum(cur.parking_price) : 0)}"></div></div>
        <div class="row"><div><label>Floor rise (₹ per sq ft per floor)</label><input name="floorRise" inputmode="decimal" value="${esc(cur ? toNum(cur.floor_rise) : 0)}"></div><div><label>Floor rise starts above floor</label><input name="floorRiseFrom" type="number" min="0" value="${esc(cur ? cur.floor_rise_from : 0)}"></div></div>
        <div class="row3"><div><label>GST %</label><input name="gstRate" value="${esc(cur ? toNum(cur.gst_rate) : 5)}"></div><div><label>Stamp duty %</label><input name="stampDutyPct" value="${esc(cur ? toNum(cur.stamp_duty_pct) : 6)}"></div><div><label>Woman buyer %</label><input name="stampDutyWomenPct" value="${esc(cur ? toNum(cur.stamp_duty_women_pct) : 5)}"></div></div>
        <div class="row"><div><label>Registration fee cap (₹)</label><input name="registrationFee" value="${esc(cur ? toNum(cur.registration_fee) : 30000)}"></div><div></div></div>
        <label>Other charges outside the agreement value (one per line: name, amount)</label><textarea name="others" rows="3" placeholder="Society formation, 25000&#10;Legal charges, 15000">${esc(cur ? (cur.other_charges || []).map((c) => `${c.name}, ${c.amount}`).join('\n') : '')}</textarea>
        <label>Notes</label><input name="notes" value="${esc(cur?.notes || '')}">`,
      async (x) => {
        const otherCharges = String(x.others || '').split('\n').map((l) => { const m = l.match(/^(.*?)[,:\t]\s*([\d,.]+)\s*$/); return m ? { name: m[1].trim(), amount: m[2].replace(/,/g, '') } : null; }).filter(Boolean);
        await api('/api/prices', { action: 'create', projectId: proj, ...x, otherCharges }); toast('Price list saved.'); prices();
      });
      dl.classList.add('wide');
    };
  }

  // ---------- channel partners and brokerage ----------
  async function partners() {
    if (!proj) return noProject();
    const d = await api(`/api/partners?project=${proj}`);
    const tab = store.get('erp_cptab') || 'due';
    const TABS = [['due', 'Due now', (r) => r.state === 'Due'], ['later', 'Not yet due', (r) => r.state === 'Not yet due'], ['paid', 'Paid', (r) => r.state === 'Paid'], ['none', 'No amount set', (r) => r.state === 'No amount'], ['all', 'All', () => true]];
    const sum = (rows, f) => rows.reduce((a, r) => a + toNum(f(r)), 0);
    const rows = d.rows.filter(TABS.find((t) => t[0] === tab)[2]);
    const totalB = sum(d.rows, (r) => r.brokerage), paid = sum(d.rows, (r) => toNum(r.paid) + toNum(r.paid_before)), dueNow = sum(d.rows, (r) => r.payable_now), later = sum(d.rows.filter((r) => r.state === 'Not yet due'), (r) => r.balance);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Channel partners</h1><p class="muted">Brokerage owed to each partner, when it becomes due, and what has been billed and paid. Brokerage is due once ${d.rule.afterRegistration ? 'the agreement is registered and ' : ''}${d.rule.minReceivedPct}% of the agreement value has been received.</p></div>
      ${d.can.rule ? '<div class="actions" style="margin:0"><button class="ghost" id="rule">Change the rule</button></div>' : ''}</div>
      <div class="panel"><div class="kpis">${kpi(d.firms.length, 'partner firms')}${kpi(d.rows.length, 'bookings via partners')}${kpi(cr(totalB), 'total brokerage')}${kpi(cr(paid), 'paid')}${kpi(cr(dueNow), 'due now', dueNow ? 'bad' : '')}${kpi(cr(later), 'not yet due')}</div></div>
      <div class="panel"><h2>By firm</h2><div class="table-wrap" style="max-height:340px"><table><tr><th>Firm</th><th class="num">Units</th><th class="num">Agreement value</th><th class="num">Collected</th><th class="num">Brokerage</th><th class="num">Paid</th><th class="num">Due now</th><th class="num">Not yet due</th></tr>
        ${d.firms.map((f) => `<tr><td>${esc(f.firm)}</td><td class="num">${f.units}</td><td class="num">${cr(f.agreementValue)}</td><td class="num">${cr(f.received)}</td><td class="num">${inr(f.brokerage)}</td><td class="num">${inr(f.paid)}</td><td class="num">${f.payableNow ? `<b>${inr(f.payableNow)}</b>` : '—'}</td><td class="num">${f.notYetDue ? inr(f.notYetDue) : '—'}</td></tr>`).join('')}</table></div></div>
      <div class="tabs">${TABS.map(([k, l, f]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l} (${d.rows.filter(f).length})</button>`).join('')}</div>
      <div class="panel"><input type="search" id="cpq" placeholder="Find a firm, unit or buyer" style="max-width:320px;margin-bottom:10px">
        <div class="table-wrap"><table id="cpt"><tr><th>Unit</th><th>Buyer</th><th>Firm</th><th class="num">Brokerage</th><th class="num">Received</th><th>Registered</th><th class="num">Billed</th><th class="num">Paid</th><th>Status</th><th></th></tr>
        ${rows.map((r) => `<tr data-s="${esc((r.unit_no + ' ' + (r.buyers || '') + ' ' + (r.cp_name || '')).toLowerCase())}"><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a></td><td>${esc(r.buyers || '')}</td><td>${esc(r.cp_name || '—')}</td>
          <td class="num">${toNum(r.brokerage) ? inr(r.brokerage) : '—'}</td><td class="num">${toNum(r.received_pct)}%</td><td>${r.registration_date ? fmtD(r.registration_date) : '<span class="muted">no</span>'}</td>
          <td class="num">${toNum(r.billed) ? inr(r.billed) : '—'}</td><td class="num">${toNum(r.paid) + toNum(r.paid_before) ? inr(toNum(r.paid) + toNum(r.paid_before)) : '—'}${r.paid_before ? '<br><span class="small muted">released per CRM sheet</span>' : ''}</td>
          <td>${{ Due: '<span class="pill bad">due</span>', 'Not yet due': `<span class="pill grey">not yet due</span><br><span class="small muted">${esc(r.why)}</span>`, Paid: '<span class="pill good">paid</span>', 'No amount': '<span class="pill">no amount</span>' }[r.state]}</td>
          <td class="num" style="white-space:nowrap">${d.can.bill ? `<button class="ghost small" data-a="amount" data-b="${r.booking_id}">Amount</button>${toNum(r.brokerage) ? `<button class="ghost small" data-a="bill" data-b="${r.booking_id}">Bill</button>` : ''}` : ''}${d.can.pay && r.balance > 1 && toNum(r.brokerage) ? `<button class="small" data-a="payment" data-b="${r.booking_id}">Pay</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nothing in this list.</td></tr>'}</table></div></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_cptab', t.dataset.t); partners(); }));
    $('#cpq').oninput = (e) => { const v = e.target.value.trim().toLowerCase(); document.querySelectorAll('#cpt tr[data-s]').forEach((tr) => { tr.style.display = !v || tr.dataset.s.includes(v) ? '' : 'none'; }); };
    if ($('#rule')) $('#rule').onclick = () => dialog(`<h2>When brokerage becomes due</h2>
      <label class="check"><input type="checkbox" name="afterRegistration" ${d.rule.afterRegistration ? 'checked' : ''}> Only after the agreement is registered</label>
      <label>And at least this % of the agreement value received</label><input name="minReceivedPct" type="number" min="0" max="100" step="0.5" value="${esc(d.rule.minReceivedPct)}">`,
    async (x) => { await api('/api/partners', { action: 'rule', afterRegistration: x.afterRegistration === 'on', minReceivedPct: x.minReceivedPct }); partners(); });
    document.querySelectorAll('[data-a]').forEach((x) => (x.onclick = () => {
      const r = d.rows.find((y) => y.booking_id === +x.dataset.b), a = x.dataset.a;
      if (a === 'amount') return dialog(`<h2>Brokerage · ${esc(r.unit_no)}</h2><div class="row"><div><label>Channel partner firm</label><input name="cpName" value="${esc(r.cp_name || '')}"></div><div><label>Brokerage amount (₹)</label><input name="amount" inputmode="decimal" required value="${esc(toNum(r.brokerage) || '')}"></div></div>
        <p class="small muted">Agreement value ${inr(r.agreement_value)}.</p>`, async (v) => { await api('/api/partners', { action: 'amount', bookingId: r.booking_id, ...v }); partners(); });
      const pay = a === 'payment';
      dialog(`<h2>${pay ? 'Brokerage paid' : 'Brokerage bill received'} · ${esc(r.unit_no)} · ${esc(r.cp_name || '')}</h2>
        <p class="muted">Brokerage ${inr(r.brokerage)} · paid so far ${inr(toNum(r.paid) + toNum(r.paid_before))} · left ${inr(r.balance)}${pay && !r.eligible ? ` · <b class="bad-t">not due yet (${esc(r.why)})</b>` : ''}</p>
        <div class="row"><div><label>Date</label><input type="date" name="date" max="${todayIso()}" value="${todayIso()}" required></div><div><label>Amount (₹)</label><input name="amount" inputmode="decimal" required value="${esc(r.balance || '')}"></div></div>
        <div class="row"><div><label>${pay ? 'UTR / cheque no.' : 'Bill / invoice no.'}</label><input name="reference" required></div><div><label>Note</label><input name="note"></div></div>
        ${pay && !r.eligible ? '<label class="check"><input type="checkbox" name="override"> Management has approved paying this early</label>' : ''}`,
      async (v) => { await api('/api/partners', { action: a, bookingId: r.booking_id, ...v, override: v.override === 'on' }); toast('Saved.'); partners(); });
    }));
  }

  // ---------- accounts (the Master Accounts sheet, tab for tab) ----------
  const accFmt = (c, v) => {
    if (v == null || v === '') return '';
    if (c.type === 'money') return inr(v, Math.abs(toNum(v)) < 100 && toNum(v) % 1 ? 2 : 0);
    if (c.type === 'date') return fmtD(String(v).slice(0, 10));
    if (c.type === 'pct') return (toNum(v) * 100).toFixed(toNum(v) * 100 % 1 ? 1 : 0) + '%';
    if (c.type === 'num') return String(toNum(v) % 1 ? toNum(v) : Math.round(toNum(v)));
    return esc(v);
  };
  const ACC_FILTERS = {
    receipts: [['', 'All'], ['noHead', 'No head'], ['noUnit', 'Customer, no unit'], ['customer', 'Customer receipts'], ['bounced', 'Bounced']],
    payments: [['', 'All'], ['noHead', 'No head'], ['noPayee', 'No payee'], ['needsBill', 'Needs bill details']],
    recon: [['open', 'Open'], ['', 'All']], compliance: [['pending', 'Pending'], ['', 'All']],
    cancellations: [['notRefunded', 'Not refunded yet'], ['refundedRows', 'Refunded'], ['', 'All']],
  };
  const ACC_SHOW = { // columns shown in the list (all columns are in the form)
    receipts: ['ref_id', 'txn_date', 'bank', 'amount', 'head', 'payment_head', 'unit_no', 'payer_name', 'payer_type', 'cheque_status', 'description', 'remark'],
    payments: ['ref_id', 'txn_date', 'bank', 'amount', 'head', 'unit_no', 'payee', 'remark', 'needs', 'description'],
    cancellations: ['cancel_date', 'unit_no', 'client', 'final_av', 'received', 'refund_rtgs', 'refund_white', 'refund_status', 'crm_now', 'books_received', 'books_refunded', 'to_refund', 'books_check', 'cp'],
  };
  async function accRegister(key, opts = {}) {
    const st = JSON.parse(store.get('erp_acc_' + key) || '{}');
    const f0 = ACC_FILTERS[key] ? ACC_FILTERS[key][0][0] : '';
    const state = { q: st.q || '', from: st.from || '', to: st.to || '', filter: st.filter ?? f0, limit: 200, ...opts };
    const qs = new URLSearchParams({ reg: key, q: state.q, from: state.from, to: state.to, filter: state.filter, limit: state.limit });
    const d = await api('/api/accounts?' + qs);
    const R = d.reg, cols = R.cols, show = ACC_SHOW[key] ? ACC_SHOW[key].map((k) => (k === 'ref_id' ? { key: 'ref_id', label: R.idLabel, type: 'text' } : cols.find((c) => c.key === k))) : [...(R.prefix ? [{ key: 'ref_id', label: R.idLabel, type: 'text' }] : []), ...cols];
    $('#page').innerHTML = `<div class="page-head"><div><h1>${esc(R.title)}</h1><p class="muted">${esc(R.help)}</p></div>
        ${d.can.enter ? `<div class="actions" style="margin:0"><button id="accNew">Add a row</button></div>` : ''}</div>
      <div class="panel"><div class="row" style="align-items:end;gap:10px;grid-template-columns:2fr 1fr 1fr auto">
        <div><label>Search</label><input id="aq" value="${esc(state.q)}" placeholder="Any word, name, unit or reference"></div>
        ${R.cols.some((c) => c.type === 'date') ? `<div><label>From</label><input type="date" id="af" value="${esc(state.from)}"></div><div><label>To</label><input type="date" id="at" value="${esc(state.to)}"></div>` : '<div></div><div></div>'}
        <div><button class="ghost" id="ago">Show</button></div></div>
        ${ACC_FILTERS[key] ? `<div class="tabs" style="margin:12px 0 0">${ACC_FILTERS[key].map(([k, l]) => `<button class="tab ${k === state.filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` : ''}
        <p class="small muted" style="margin:10px 0 0">${d.rows.length < d.total ? `Showing ${d.rows.length} of ` : ''}${d.total.toLocaleString('en-IN')} rows${d.amount != null ? ` · total ${inr(d.amount)}` : ''}. Tap a row to ${d.can.enter ? 'edit' : 'see'} it.</p></div>
      <div class="panel"><div class="table-wrap acc-grid"><table><tr>${show.map((c) => `<th class="${['money', 'num', 'pct'].includes(c.type) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr>
        ${d.rows.map((r) => `<tr data-id="${r.id}" class="${r.cheque_status === 'Bounced' ? 'dim' : ''}">${show.map((c) => `<td class="${['money', 'num', 'pct'].includes(c.type) ? 'num' : c.type === 'long' || c.key === 'needs' ? 'small wrap' : ''}">${c.key === 'needs' && r.needs ? `<span class="bad-t">${esc(r.needs)}</span>` : accFmt(c, r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${show.length}" class="muted">Nothing here.</td></tr>`}</table></div>
        ${d.rows.length < d.total ? '<div class="actions"><button class="ghost" id="amore">Show more</button></div>' : ''}</div>`;
    if (['tenants', 'rentLinks', 'cancellations'].includes(key) && d.rows.length) $('.acc-grid table tr').insertAdjacentHTML('afterend', `<tr class="tot">${show.map((c, i) => `<td class="num"><b>${c.type === 'money' && !['monthly_rent', 'split_amount'].includes(c.key) ? inr(d.rows.reduce((a, r) => a + toNum(r[c.key]), 0)) : i === 0 ? 'Totals' : ''}</b></td>`).join('')}</tr>`);
    const save = () => store.set('erp_acc_' + key, JSON.stringify({ q: state.q, from: state.from, to: state.to, filter: state.filter }));
    const reload = (o = {}) => { Object.assign(state, o); save(); accRegister(key, { limit: state.limit }); };
    $('#ago').onclick = () => reload({ q: $('#aq').value.trim(), from: $('#af') ? $('#af').value : '', to: $('#at') ? $('#at').value : '' });
    $('#aq').onkeydown = (e) => { if (e.key === 'Enter') $('#ago').click(); };
    document.querySelectorAll('.tab[data-f]').forEach((b) => (b.onclick = () => reload({ filter: b.dataset.f })));
    if ($('#amore')) $('#amore').onclick = () => accRegister(key, { limit: state.limit + 400 });
    const form = (row) => {
      const v = (c) => (row ? row[c.key] : c.key === R.cols.find((x) => x.type === 'date')?.key ? todayIso() : '');
      const field = (c) => {
        if (c.calc) return row && row[c.key] != null && row[c.key] !== '' ? `<div><label>${esc(c.label)}</label><input value="${esc(c.type === 'money' ? inr(row[c.key]) : c.type === 'date' ? fmtD(String(row[c.key]).slice(0, 10)) : row[c.key])}" disabled></div>` : '';
        const val = v(c) == null ? '' : v(c), req = c.required ? 'required' : '', dis = d.can.enter ? '' : 'disabled';
        if (c.type === 'list') {
          const L = d.lists[c.list] || [];
          if (c.free || L.length > 40) return `<div><label>${esc(c.label)}</label><input name="${c.key}" list="dl_${c.key}" value="${esc(val)}" ${req} ${dis}><datalist id="dl_${c.key}">${L.slice(0, 3000).map((o) => `<option value="${esc(o)}">`).join('')}</datalist></div>`;
          return `<div><label>${esc(c.label)}</label><select name="${c.key}" ${req} ${dis}><option value=""></option>${L.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}${val && !L.includes(val) ? `<option selected>${esc(val)}</option>` : ''}</select></div>`;
        }
        if (c.type === 'long') return `<div class="wide"><label>${esc(c.label)}</label><textarea name="${c.key}" rows="2" ${req} ${dis}>${esc(val)}</textarea></div>`;
        const t = c.type === 'date' ? 'date' : 'text', shown = c.type === 'pct' && val !== '' ? (toNum(val) * 100).toString() + '%' : c.type === 'date' ? String(val).slice(0, 10) : val;
        return `<div><label>${esc(c.label)}${c.hint ? ` <span class="small muted">(${esc(c.hint)})</span>` : ''}</label><input type="${t}" name="${c.key}" value="${esc(shown)}" ${c.type === 'money' || c.type === 'num' ? 'inputmode="decimal"' : ''} ${c.unit ? 'placeholder="A-1001"' : ''} ${req} ${dis}></div>`;
      };
      const main = cols.filter((c) => !c.bill), bill = cols.filter((c) => c.bill);
      const dl = dialog(`<h2>${row ? esc(R.title) + (row.ref_id ? ' · ' + esc(row.ref_id) : '') : 'New row · ' + esc(R.title)}</h2>
        ${row && row.imported ? '<p class="small muted">Came in from the accounts sheet.</p>' : ''}
        <div class="acc-form">${main.map(field).join('')}</div>
        ${bill.length ? `<details ${row && row.needs ? 'open' : ''}><summary><b>Bill details</b>${row && row.needs ? ` <span class="bad-t small">${esc(row.needs)}</span>` : ''}</summary><div class="acc-form">${bill.map(field).join('')}</div></details>` : ''}`,
      async (x) => { if (!d.can.enter) return; const data = {}; for (const c of cols) if (!c.calc && c.key in x) data[c.key] = x[c.key]; const r = await api('/api/accounts', { action: 'save', reg: key, id: row ? row.id : undefined, data }); toast(row ? 'Saved.' : `Added${r.ref_id ? ' as ' + r.ref_id : ''}.`); accRegister(key, { limit: state.limit }); });
      dl.classList.add('wide');
      if (!d.can.enter) $('[value=save]', dl).remove();
    };
    if ($('#accNew')) $('#accNew').onclick = () => form(null);
    document.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => form(d.rows.find((r) => r.id === +tr.dataset.id))));
  }

  // Training videos: one short screen recording per task; watched ones are ticked, and Admin sees who has watched what.
  async function training() {
    const d = await api('/api/training');
    const teams = [...new Set(d.modules.map((m) => m.team))];
    const done = d.modules.filter((m) => d.watched[m.id]).length;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Training videos</h1><p class="muted">Short videos of the ERP, made on sample data. Watch the ones for your team; each is ticked when you reach the end. You have watched ${done} of ${d.modules.length}.</p></div></div>
      ${teams.map((t) => `<h2 class="sec">${esc(t)}</h2><div class="tr-grid">${d.modules.filter((m) => m.team === t).map((m) => `<div class="tr">
        <video controls preload="metadata" playsinline data-m="${m.id}" src="/training/${m.id}.mp4" poster="/training/${m.id}.jpg"></video>
        <div class="tr-body"><h3>${esc(m.title)}</h3><p class="small muted" style="margin:0">${esc(m.sub)}</p>
          <div class="tr-foot">${d.watched[m.id] ? `<span class="pill good">Watched ${fmtD(String(d.watched[m.id]).slice(0, 10))}</span>` : '<span class="pill grey">Not watched yet</span>'}
            ${d.watched[m.id] ? '' : `<button class="ghost small mk" data-m="${m.id}">Mark as watched</button>`}</div></div></div>`).join('')}</div>`).join('')}
      ${d.team ? `<div class="panel" style="margin-top:22px"><h2>Who has watched what</h2><div class="table-wrap"><table><tr><th>Name</th>${d.modules.map((m) => `<th title="${esc(m.title)}" class="small">${esc(m.title)}</th>`).join('')}<th class="num">Done</th></tr>
        ${d.team.map((x) => `<tr><td>${esc(x.name)}</td>${d.modules.map((m) => `<td>${x.watched[m.id] ? '<span class="good-t">✓</span>' : ''}</td>`).join('')}<td class="num">${Object.keys(x.watched).length} / ${d.modules.length}</td></tr>`).join('')}</table></div></div>` : ''}`;
    const mark = async (m) => { try { await api('/api/training', { action: 'watched', module: m }); training(); } catch (x) { alert(x.message); } };
    document.querySelectorAll('video[data-m]').forEach((v) => { if (!d.watched[v.dataset.m]) v.addEventListener('ended', () => mark(v.dataset.m)); });
    document.querySelectorAll('.mk').forEach((b) => (b.onclick = () => mark(b.dataset.m)));
  }

  // Daily To-Do (CRM or Accounts): the 9 am audit's findings and people's own tasks, ticked off through the day.
  async function dailyTodo(dept, dateArg) {
    const name = dept === 'crm' ? 'Sales & CRM' : 'Accounts';
    const date = dateArg || store.get('erp_todo_date_' + dept) || todayIso();
    const d = await api(`/api/tasks?dept=${dept}&date=${date}`);
    const isToday = d.date === d.today;
    const f = store.get('erp_todo_f_' + dept) || 'open';
    const rows = d.rows.filter((r) => (f === 'open' ? !r.done_at : f === 'mine' ? !r.done_at && (r.assigned_to === d.me || (!r.assigned_to && r.created_by === d.me)) : true));
    const open = d.rows.filter((r) => !r.done_at), urgent = open.filter((r) => r.priority === 'high');
    const run = d.runs[0];
    const ago = (x) => { const k = Math.round((Date.parse(d.date) - Date.parse(x)) / 864e5); return k > 0 ? `open since ${fmtD(x)} (${k} day${k > 1 ? 's' : ''})` : ''; };
    const who = (r) => (d.can.edit && !r.done_at ? `<select class="asg small" data-id="${r.id}"><option value="">Whole team</option>${d.team.map((t) => `<option value="${t.id}" ${t.id === r.assigned_to ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : r.assigned_name ? esc(r.assigned_name) : 'Whole team');
    const line = (r) => `<div class="td ${r.done_at ? 'done' : ''} ${r.priority === 'high' && !r.done_at ? 'hi' : ''}">
        <div class="td-tick">${d.can.edit ? `<input type="checkbox" class="tk" data-id="${r.id}" ${r.done_at ? 'checked' : ''} aria-label="Done">` : r.done_at ? '✓' : ''}</div>
        <div class="td-body"><div class="td-title">${r.link ? `<a href="${esc(r.link)}">${esc(r.title)}</a>` : esc(r.title)} ${r.priority === 'high' && !r.done_at ? '<span class="pill bad">Urgent</span>' : ''}</div>
          ${r.detail ? `<div class="small muted">${esc(r.detail)}</div>` : ''}
          <div class="td-meta small">${r.source === 'audit' ? '<span class="pill grey">9 am audit</span>' : `<span class="pill">Added by ${esc(r.created_name || '—')}${r.task_date !== d.date ? ' on ' + fmtD(r.task_date) : ''}</span>`}
            ${r.done_at ? `<span>${r.cleared ? 'Cleared by the audit' : 'Done by ' + esc(r.done_name || '—')} · ${fmtDate(r.done_at)}${r.done_note && !r.cleared ? ' · “' + esc(r.done_note) + '”' : ''}</span>` : `<span>${ago(r.since || r.task_date)}</span>`}
            ${r.source === 'own' && !r.done_at && d.can.edit && (r.created_by === d.me || d.can.run) ? `<button class="link rm" data-id="${r.id}">Remove</button>` : ''}</div></div>
        <div class="td-who small">${who(r)}${d.can.edit && !r.done_at ? `<input class="note small" data-id="${r.id}" placeholder="Note when ticking (optional)">` : ''}</div></div>`;
    $('#page').innerHTML = `<div class="page-head"><div><h1>${name} · Daily To-Do</h1>
        <p class="muted">${dept === 'accounts' ? 'Every morning at 9 am the ERP audits the books and lists what needs doing; the list is also emailed to the accounts mailbox.' : 'Every morning at 9 am the ERP lists today’s calls, approvals and letters, and what Accounts found that the CRM must fix.'} Tick each line when it is done. Your own tasks stay on the list until ticked; an audit line that is not fixed comes back the next morning.</p></div>
        <div class="actions">${d.can.run && isToday ? '<button class="ghost" id="rerun">Run the audit again</button>' : ''}</div></div>
      <div class="kpis"><div class="kpi"><span>Open</span><b>${open.length}</b></div><div class="kpi"><span>Urgent</span><b class="${urgent.length ? 'bad-t' : ''}">${urgent.length}</b></div><div class="kpi"><span>Done</span><b class="good-t">${d.rows.length - open.length}</b></div>
        <div class="kpi"><span>Audit</span><b style="font-size:14px">${run ? `${new Date(run.run_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · ${run.found} found${run.error ? ' · error' : ''}` : isToday ? 'Runs at 9 am' : 'Did not run'}</b></div></div>
      <div class="panel"><div class="row" style="grid-template-columns:180px 1fr;align-items:end"><div><label>Day</label><input type="date" id="tdd" value="${esc(d.date)}" max="${esc(d.today)}"></div>
        <div class="tabs" style="margin:0">${[['open', 'Open'], ['mine', 'Mine'], ['all', 'All, with done']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
        ${run && run.error ? `<p class="err">The audit could not finish: ${esc(run.error)}</p>` : ''}
        ${run && run.mail && dept === 'accounts' ? `<p class="small muted">Email: ${run.mail.sent ? 'sent to ' + esc((run.mail.to || []).join(', ')) + (run.mail.test ? ' (test address)' : '') : esc(run.mail.reason || 'not sent')}</p>` : ''}
        <div class="tdl">${rows.map(line).join('') || `<p class="muted">${f === 'open' ? 'Nothing open. Well done.' : 'Nothing here.'}</p>`}</div></div>
      ${d.can.edit && isToday ? `<form class="panel" id="addT"><h2>Add a task</h2><div class="row" style="grid-template-columns:2fr 1fr auto;align-items:end"><div><label>Task</label><input name="title" required maxlength="200" placeholder="e.g. Call the bank about the A-1203 cheque"></div>
        <div><label>For</label><select name="assignedTo"><option value="">Whole team</option>${d.team.map((t) => `<option value="${t.id}" ${t.id === d.me ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div><button>Add</button></div></div></form>` : ''}`;
    $('#tdd').onchange = (e) => { store.set('erp_todo_date_' + dept, e.target.value === d.today ? '' : e.target.value); dailyTodo(dept, e.target.value); };
    document.querySelectorAll('.tab[data-f]').forEach((b) => (b.onclick = () => { store.set('erp_todo_f_' + dept, b.dataset.f); dailyTodo(dept, d.date); }));
    const act = async (body) => { try { await api('/api/tasks', body); dailyTodo(dept, d.date); } catch (x) { alert(x.message); } };
    document.querySelectorAll('.tk').forEach((c) => (c.onchange = () => { const note = document.querySelector(`.note[data-id="${c.dataset.id}"]`); act(c.checked ? { action: 'done', id: +c.dataset.id, note: note ? note.value : '' } : { action: 'undo', id: +c.dataset.id }); }));
    document.querySelectorAll('.asg').forEach((s) => (s.onchange = () => act({ action: 'assign', id: +s.dataset.id, userId: s.value || null })));
    document.querySelectorAll('.rm').forEach((b) => (b.onclick = () => act({ action: 'remove', id: +b.dataset.id })));
    if ($('#rerun')) $('#rerun').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Running…'; try { const r = await api('/api/tasks', { action: 'run', dept }); toast(`Audit done: ${r.found} found.`); dailyTodo(dept, d.date); } catch (x) { e.target.disabled = false; alert(x.message); } };
    if ($('#addT')) $('#addT').onsubmit = (e) => { e.preventDefault(); const x = Object.fromEntries(new FormData(e.target)); act({ action: 'add', dept, title: x.title, assignedTo: x.assignedTo || null }); };
  }

  async function accTodo() {
    const d = await api('/api/accounts?view=todo');
    const go2 = (x) => (x.go === 'balances' ? '#/balances' : x.go === 'checks' ? '#/checks' : x.go === 'bankauto' ? '#/bankauto' : '#/reg-' + x.go);
    const B = d.balances;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Accounts · To Do</h1><p class="muted">What is missing today. Work down the list every day: green = done, red = needs you. Tap a line to go there. Updated ${fmtD(d.today)}.</p></div></div>
      <div class="panel"><div class="table-wrap"><table><tr><th>Task</th><th class="num">Number</th><th>What to do</th></tr>
        ${d.items.map((x) => `<tr class="click" data-go="${go2(x)}" data-f="${esc(x.filter || '')}" data-k="${esc(x.go)}"><td>${esc(x.task)}</td><td class="num"><b class="${x.ok ? 'good-t' : 'bad-t'}">${x.n == null ? '—' : x.n.toLocaleString('en-IN')}</b></td><td class="small">${esc(x.what)}</td></tr>`).join('')}</table></div></div>
      <div class="two"><div class="panel"><h2>Bank balances today</h2><div class="table-wrap"><table><tr><th>Group</th><th class="num">Closing</th></tr>${B.groups.map((g) => `<tr><td>${esc(g.grp)}</td><td class="num">${inr(g.closing)}</td></tr>`).join('')}
          <tr><td><b>Grand total</b></td><td class="num"><b>${inr(B.groups.reduce((a, g) => a + g.closing, 0))}</b></td></tr></table></div><div class="actions"><a class="btn ghost" href="#/balances">Open Daily Bank Balance</a></div></div>
        <div class="panel"><h2>Compliance: overdue or due in 7 days</h2><div class="table-wrap"><table><tr><th>Compliance</th><th>Period</th><th>Due</th><th class="num">Days late</th></tr>
          ${d.compliance.map((c) => `<tr><td>${esc(c.compliance)}</td><td>${esc(c.period || '')}</td><td>${fmtD(c.due_date)}</td><td class="num ${c.late ? 'bad-t' : ''}">${c.late || ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing due.</td></tr>'}</table></div></div></div>
      <div class="panel"><h2>Payments needing bill details (newest 25)</h2><div class="table-wrap"><table><tr><th>Payment ID</th><th>Date</th><th>Payee</th><th class="num">Amount</th><th>Head</th><th>What is missing</th></tr>
        ${d.needBill.map((p) => `<tr><td>${esc(p.ref_id || '')}</td><td>${fmtD(p.txn_date)}</td><td>${esc(p.payee || '')}</td><td class="num">${inr(p.amount)}</td><td>${esc(p.head || '')}</td><td class="small">${esc(p.needs)}</td></tr>`).join('')}</table></div></div>`;
    document.querySelectorAll('tr[data-go]').forEach((tr) => (tr.onclick = () => { if (tr.dataset.go.startsWith('#/reg-')) { const k = tr.dataset.k, cur = JSON.parse(store.get('erp_acc_' + k) || '{}'); store.set('erp_acc_' + k, JSON.stringify({ ...cur, filter: tr.dataset.f, q: '', from: '', to: '' })); } go(tr.dataset.go); }));
  }

  async function accBalances(dateArg) {
    const date = dateArg || store.get('erp_bal_date') || todayIso();
    const d = await api('/api/accounts?view=balances&date=' + date);
    const row = (r, bold) => `<tr class="${bold ? 'tot' : ''}"><td>${bold ? `<b>${esc(r.grp)} – total</b>` : esc(r.bank)}</td><td class="small">${bold ? '' : esc(r.account_no || '')}</td><td class="num">${inr(r.opening)}</td><td class="num">${inr(r.receipts)}</td><td class="num">${inr(r.payments)}</td><td class="num"><b>${inr(r.closing)}</b></td>
      <td class="num">${bold ? (r.perBank ? inr(r.perBank) : '') : d.can.enter ? `<input class="stated" data-b="${r.id}" value="${r.perBank == null ? '' : Math.round(r.perBank * 100) / 100}" inputmode="decimal" style="width:130px;text-align:right">` : r.perBank == null ? '' : inr(r.perBank)}</td>
      <td class="num ${!bold && r.difference != null && Math.abs(r.difference) > 1 ? 'bad-t' : ''}">${bold || r.difference == null ? '' : inr(r.difference, 2)}</td><td class="num">${inr(r.bf)}</td></tr>`;
    const groups = [...new Set(d.rows.map((r) => r.grp))];
    $('#page').innerHTML = `<div class="page-head"><div><h1>Daily Bank Balance</h1><p class="muted">Every day, add one row per bank in Daily entries (date, bank, receipts, payments). The summary shows opening, receipts, payments and closing for the report date. Type the balance the bank shows in Balance per Bank: the Difference must be blank or zero. Opening = balance brought forward on ${fmtD(d.bfDate)} plus every entry before the report date.</p></div></div>
      <div class="panel"><div class="row" style="grid-template-columns:200px auto;align-items:end"><div><label>Report date</label><input type="date" id="bd" value="${esc(d.date)}"></div><div></div></div>
        <div class="table-wrap" style="margin-top:12px"><table><tr><th>Bank</th><th>A/c No.</th><th class="num">Opening</th><th class="num">Receipts</th><th class="num">Payments</th><th class="num">Closing</th><th class="num">Balance per Bank</th><th class="num">Difference</th><th class="num">B/F</th></tr>
          ${groups.map((g) => d.rows.filter((r) => r.grp === g).map((r) => row(r)).join('') + row(d.groups.find((x) => x.grp === g), true)).join('')}
          <tr class="tot"><td><b>Grand total</b></td><td></td><td class="num">${inr(d.groups.reduce((a, g) => a + g.opening, 0))}</td><td class="num">${inr(d.groups.reduce((a, g) => a + g.receipts, 0))}</td><td class="num">${inr(d.groups.reduce((a, g) => a + g.payments, 0))}</td><td class="num"><b>${inr(d.groups.reduce((a, g) => a + g.closing, 0))}</b></td><td></td><td></td><td class="num">${inr(d.groups.reduce((a, g) => a + g.bf, 0))}</td></tr></table></div></div>
      <div class="panel"><div class="page-head" style="margin:0 0 8px"><h2 style="margin:0">Daily entries (latest 60)</h2>${d.can.enter ? '<button id="addEntry">Add a day\'s entry</button>' : ''}</div>
        <div class="table-wrap"><table><tr><th>Date</th><th>Bank</th><th class="num">Receipts</th><th class="num">Payments</th><th>Remarks</th><th>Entered by</th></tr>
        ${d.entries.map((e) => `<tr><td>${fmtD(e.entry_date)}</td><td>${esc(e.bank)}</td><td class="num">${e.receipts == null ? '' : inr(e.receipts)}</td><td class="num">${e.payments == null ? '' : inr(e.payments)}</td><td class="small">${esc(e.remarks || '')}</td><td class="small">${esc(e.entered_by || '')}</td></tr>`).join('')}</table></div>
        <div class="actions"><a class="btn ghost" href="#/reg-daily">All daily entries</a></div></div>`;
    $('#bd').onchange = (e) => { store.set('erp_bal_date', e.target.value); accBalances(e.target.value); };
    document.querySelectorAll('input.stated').forEach((i) => (i.onchange = async () => { try { await api('/api/accounts', { action: 'stated', bankId: +i.dataset.b, date: d.date, balance: i.value }); accBalances(d.date); } catch (e) { alert(e.message); } }));
    if ($('#addEntry')) $('#addEntry').onclick = async () => {
      const L = (await api('/api/accounts?view=lists')).lists;
      dialog(`<h2>Daily entry</h2><div class="row"><div><label>Date</label><input type="date" name="entry_date" value="${esc(d.date)}" required></div><div><label>Bank</label><select name="bank" required><option value=""></option>${L.dailyBank.map((b) => `<option>${esc(b)}</option>`).join('')}</select></div></div>
        <div class="row"><div><label>Receipts (₹)</label><input name="receipts" inputmode="decimal"></div><div><label>Payments (₹)</label><input name="payments" inputmode="decimal"></div></div><label>Remarks</label><input name="remarks">`,
      async (x) => { await api('/api/accounts', { action: 'save', reg: 'daily', data: { ...x, entered_by: me.name } }); toast('Entry added.'); accBalances(d.date); });
    };
  }

  async function bankAuto(runId) {
    const [d, pd] = await Promise.all([api('/api/bank-auto'), api('/api/bank-auto?view=pdc')]);
    const run = runId ? (await api('/api/bank-auto?run=' + runId)).run : d.last;
    const S = d.settings || {};
    const ist = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
    const trig = { schedule: '3:10 pm (automatic)', drive: 'Run from Drive', upload: 'Uploaded', compare: 'Comparison' };
    const amt = (v) => (v == null || v === '' ? '' : inr(v));
    const dd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? fmtD(v) : esc(v || ''));
    const list = (rows, empty) => rows && rows.length ? `<div class="table-wrap acc-grid"><table><tr><th>What</th><th>Bank</th><th>Date</th><th class="num">Amount</th><th>Bank description</th><th>Where</th><th>What to do</th></tr>
      ${rows.map((x) => `<tr><td><b>${esc(x.what)}</b></td><td>${esc(x.bank || '')}</td><td>${dd(x.date)}</td><td class="num">${amt(x.amount)}</td><td class="small">${esc(x.description || '')}</td><td class="small">${esc(x.where || '')}</td><td class="small">${esc(x.todo || '')}</td></tr>`).join('')}</table></div>` : `<p class="muted">${empty}</p>`;
    const cmp = run && run.trigger === 'compare';
    const head = run && cmp && run.ok ? `Comparison of the books with the bank statements, ${ist(run.run_at)}${run.by_name ? ' (' + esc(run.by_name) + ')' : ''}, for lines from ${fmtD(run.compare_from)}. Nothing was added or changed. <b>${run.differences.length}</b> differences below: lines on a statement that are not in the books, entries in the books that are not on the statement, and entries under the wrong bank.`
      : run ? (run.ok ? `Run ${ist(run.run_at)} (${esc(trig[run.trigger] || run.trigger)}${run.by_name ? ', ' + esc(run.by_name) : ''}). Added <b>${run.added.receipts || 0}</b> receipts and <b>${run.added.payments || 0}</b> payments (Source = Bank statement auto). ${run.updated ? run.updated + ' marked Bounced. ' : ''}${run.differences.length} differences below. Lines from ${fmtD(S.statement_start || '2026-10-01')} onwards are checked.`
      : `<span class="bad-t">Run ${ist(run.run_at)} failed: ${esc(run.error || '')}</span>`) : 'No run yet.';
    const pdcRows = pd.due || [];
    $('#page').innerHTML = `<div class="page-head"><div><h1>Bank Auto Check</h1><p class="muted">Bank statements matched to Receipts and Payments Out every day at 3:10 pm (upload the statements to the Drive folder "Daily Bank Statements - upload here" by 3 pm). Lines missing from the ERP are added with Source "Bank statement auto" and the remark "Added from bank statement. Fill head and payee."; the Daily Bank Balance is filled from each statement's own totals, and the statement's closing balance goes into Balance per Bank. Nothing is ever deleted.</p></div>
        <div class="actions" style="margin:0">${d.can.enter ? `<label class="small" style="display:flex;align-items:center;gap:6px">from <input type="date" id="cmpFrom" value="2024-01-01"></label><button class="ghost" id="cmpDrive" ${d.google ? '' : 'disabled'} title="Checks every statement line from the date you give against Receipts and Payments Out, both ways. Nothing is added or changed.">Compare books with the statements</button><button id="runDrive" ${d.google ? '' : 'disabled'}>Run now from Drive</button><button class="ghost" id="upl">Upload statements</button><input type="file" id="uplf" accept=".xlsx" multiple hidden>` : ''}</div></div>
      ${runId ? `<p><a href="#/bankauto">← Latest run</a></p>` : ''}
      <div class="panel"><p style="margin:0">${head}</p></div>
      ${run && run.ok ? `<div class="panel"><h2>Statements</h2><div class="table-wrap acc-grid"><table><tr><th>Bank</th><th>File</th><th>Statement from</th><th>Statement up to</th><th class="num">Lines checked</th><th class="num">${cmp ? 'Money in not in books' : 'Receipts added'}</th><th class="num">${cmp ? 'Money out not in books' : 'Payments added'}</th><th class="num">${cmp ? '' : 'Marked bounced'}</th><th class="num">Closing per statement</th><th>Note</th></tr>
          ${run.banks.map((b) => `<tr><td><b>${esc(b.bank)}</b></td><td class="small">${esc(b.file)}</td><td>${fmtD(b.from)}</td><td>${fmtD(b.to)}</td><td class="num">${b.lines}</td><td class="num">${b.receiptsAdded}</td><td class="num">${b.paymentsAdded}</td><td class="num">${b.rowsUpdated || ''}</td><td class="num">${amt(b.closing)}</td><td class="small">${esc(b.note || '')}</td></tr>`).join('')}</table></div>
          ${run.files.filter((f) => f.error || f.skipped || f.undated).map((f) => `<p class="small ${f.error ? 'bad-t' : 'muted'}">${esc(f.file)}: ${esc(f.error || f.skipped || `${f.undated} lines had "########" instead of a date; they were dated from the description or the line above.`)}</p>`).join('')}</div>
        ${run.differences.length > 10 ? (() => { const g = {}; for (const x of run.differences) { const k = x.what + '|' + (x.bank || ''); const o = (g[k] ||= { what: x.what, bank: x.bank || '', n: 0, amt: 0 }); o.n++; o.amt += Number(x.amount) || 0; }
          const rows = Object.values(g).sort((a, b) => a.bank.localeCompare(b.bank) || b.amt - a.amt);
          return `<div class="panel"><h2>Summary by bank</h2><div class="table-wrap"><table><tr><th>Bank</th><th>What</th><th class="num">Lines</th><th class="num">Amount</th></tr>${rows.map((r) => `<tr><td>${esc(r.bank)}</td><td>${esc(r.what)}</td><td class="num">${r.n}</td><td class="num">${inr(r.amt)}</td></tr>`).join('')}</table></div></div>`; })() : ''}
        <div class="panel"><h2>Differences (${run.differences.length})</h2>${list(run.differences, 'None: every statement line from the start date is in the ERP, and every ERP entry is on its statement.')}</div>
        ${cmp ? '' : `<div class="panel"><h2>New bank receipts the team must tag (${run.tagging.length})</h2><p class="small muted">Receipts added from the statement where the flat could not be filled. Open Receipts (bank), find the Receipt ID and fill Cash Flow Head, Payment Head, Unit and Payer.</p>${list(run.tagging, 'Nothing to tag.')}</div>`}
        ${!cmp && run.added_rows && run.added_rows.length ? `<details class="panel"><summary><b>${cmp ? 'Statement lines not in the books' : 'Rows added in this run'} (${run.added_rows.length})</b></summary><div class="table-wrap acc-grid"><table><tr><th>ID</th><th>Register</th><th>Bank</th><th>Date</th><th class="num">Amount</th><th>Unit</th><th>Description</th></tr>
          ${run.added_rows.map((r) => `<tr><td>${esc(r.ref)}</td><td>${r.side === 'receipt' ? 'Receipts' : 'Payments Out'}</td><td>${esc(r.bank)}</td><td>${fmtD(r.date)}</td><td class="num">${inr(r.amount)}</td><td>${esc(r.unit || '')}</td><td class="small">${esc(r.description)}</td></tr>`).join('')}</table></div></details>` : ''}` : ''}
      <div class="two"><div class="panel"><h2>Runs</h2><div class="table-wrap"><table><tr><th>Run (IST)</th><th>How</th><th class="num">Receipts added</th><th class="num">Payments added</th><th class="num">Differences</th></tr>
          ${d.runs.map((r) => `<tr class="click" data-run="${r.id}"><td>${ist(r.run_at)}</td><td class="small">${esc(trig[r.trigger] || r.trigger)}${r.by_name ? ' · ' + esc(r.by_name) : ''}</td>${r.ok ? `<td class="num">${r.added.receipts || 0}</td><td class="num">${r.added.payments || 0}</td><td class="num">${r.n_diff}</td>` : `<td colspan="3" class="bad-t small">${esc(r.error || 'Failed')}</td>`}</tr>`).join('') || '<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}</table></div></div>
        <div class="panel"><h2>PDC reminder emails</h2><p class="small muted">Every morning at about 9:20 am: an email for each cheque due in 2 days (48-hour reminder) and in 1 day (24-hour reminder), to ${esc(S.pdc_to || '')}${S.pdc_cc ? ', copy to ' + esc(S.pdc_cc) : ''}. The date sent is written on the PDC row. ${pd.test ? `<b>Test version: the emails go only to the test address${pd.to.length ? ' (' + esc(pd.to.join(', ')) + ')' : ''}.</b>` : ''}</p>
          ${!pd.mail ? '<p class="bad-t small">Email is not set up yet (SMTP app password), so reminders cannot be sent.</p>' : ''}
          <div class="table-wrap"><table><tr><th>Reminder</th><th>Cheque issued to</th><th class="num">Amount</th><th>Due</th></tr>${pdcRows.map((x) => `<tr><td>${x.kind === '48h' ? '48-hour' : '24-hour'}</td><td>${esc(x.issued_to)}</td><td class="num">${inr(x.amount)}</td><td>${fmtD(x.due_date)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No reminder due today.</td></tr>'}</table></div>
          ${d.can.manage && pdcRows.length && pd.mail ? '<div class="actions"><button class="ghost" id="pdcSend">Send today\'s reminders now</button></div>' : ''}</div></div>
      ${d.can.manage ? `<details class="panel"><summary><b>Settings</b></summary><form id="bas">
        <div class="row"><div><label>Check statement lines from</label><input type="date" name="statement_start" value="${esc(S.statement_start || '')}"></div><div><label>PDC reminders to</label><input name="pdc_to" value="${esc(S.pdc_to || '')}"></div></div>
        <div class="row"><div><label>Drive folders read (links or IDs, comma between)</label><input name="statement_folders" value="${esc(S.statement_folders || '')}"></div><div><label>PDC reminders copy to</label><input name="pdc_cc" value="${esc(S.pdc_cc || '')}"></div></div>
        <p class="small muted">Each folder must be shared with ${esc(d.serviceEmail || 'the ERP\'s Google account')} as Viewer. The newest file for each bank is read (one level of sub-folders too). The bank is told from the file name: 8650, Misc / 9046, 0700 / 100%, 0131 / GST, 0111 / SDR, 0501 / 30%, 0800 / 70%.</p>
        <div class="actions"><button>Save settings</button></div></form></details>` : ''}`;
    document.querySelectorAll('tr[data-run]').forEach((tr) => (tr.onclick = () => go('#/bankauto/' + tr.dataset.run)));
    const busy = (b, on) => { if (b) { b.disabled = on; b.textContent = on ? 'Working…' : b.dataset.l || b.textContent; } };
    const done = (r) => { toast(`Added ${r.added.receipts} receipts and ${r.added.payments} payments; ${r.differences.length} differences.`); go('#/bankauto'); };
    if ($('#cmpDrive')) { const b = $('#cmpDrive'); b.dataset.l = b.textContent; b.onclick = async () => {
      busy(b, true);
      try { const r = await api('/api/bank-auto', { action: 'compare', from: $('#cmpFrom') ? $('#cmpFrom').value : '2024-01-01' }); toast(`Compared: ${r.differences.length} differences.`); go('#/bankauto/' + r.id); } catch (e) { alert(e.message); busy(b, false); } }; }
    if ($('#runDrive')) { const b = $('#runDrive'); b.dataset.l = b.textContent; b.onclick = async () => { busy(b, true); try { done(await api('/api/bank-auto', { action: 'drive' })); } catch (e) { alert(e.message); busy(b, false); } }; }
    if ($('#upl')) {
      const b = $('#upl'); b.dataset.l = b.textContent;
      b.onclick = () => $('#uplf').click();
      $('#uplf').onchange = async (ev) => {
        const fl = [...ev.target.files]; if (!fl.length) return;
        if (fl.reduce((a, f) => a + f.size, 0) > 3e6) return alert('Upload at most 3 MB at a time (upload the statements a few at a time).');
        busy(b, true);
        try {
          const files = await Promise.all(fl.map((f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, data: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(f); })));
          done(await api('/api/bank-auto', { action: 'upload', files }));
        } catch (e) { alert(e.message); busy(b, false); }
      };
    }
    if ($('#pdcSend')) $('#pdcSend').onclick = async () => { try { const r = await api('/api/bank-auto', { action: 'pdc-send' }); toast(r.reason || `Sent ${r.sent.length} reminder${r.sent.length === 1 ? '' : 's'}.`); bankAuto(); } catch (e) { alert(e.message); } };
    if ($('#bas')) $('#bas').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/bank-auto', { action: 'settings', ...Object.fromEntries(new FormData(ev.target)) }); toast('Settings saved.'); bankAuto(); } catch (e) { showErr(ev.target, e); } };
  }

  async function booksCrm() {
    const d = await api(`/api/books-crm?project=${proj || ''}`);
    const T = d.totals, S = d.byState;
    const st = store.get('erp_bc_state') || 'differ', q0 = store.get('erp_bc_q') || '';
    const STATES = ['More in the books', 'More in the CRM', 'Only in the books', 'Only in the CRM', 'No booking in the CRM', 'Agrees', 'Nothing received'];
    const pill = (s) => `<span class="pill ${s === 'Agrees' ? 'good' : s === 'Nothing received' ? 'grey' : 'bad'}">${esc(s)}</span>`;
    const diffN = (v) => `<span class="${Math.abs(v) <= 1000 ? 'good-t' : 'bad-t'}">${v > 0 ? '+' : ''}${inr(v)}</span>`;
    const src = d.source === 'Tally' ? 'Tally' : 'the accounts registers';
    $('#page').innerHTML = `<div class="page-head"><div><h1>Tally vs CRM</h1><p class="muted">Money received from each flat's buyer: in ${esc(src)} (Receipts and Payments Out in the ERP) against the CRM ledger. Bounced cheques are left out on both sides. A flat agrees when the two are within ₹1,000. Tap a flat to see its receipts side by side.</p></div></div>
      <div class="panel"><div class="kpis">${kpi(inr(T.books), 'received per ' + src)}${kpi(inr(T.crm), 'received per the CRM')}${kpi((T.books - T.crm > 0 ? '+' : '') + inr(T.books - T.crm), 'difference (books − CRM)', Math.abs(T.books - T.crm) > 1000 ? 'bad' : '')}${kpi(((S['Agrees'] || {}).n || 0) + ' of ' + d.rows.filter((r) => r.state !== 'Nothing received').length, 'flats that agree')}</div>
        <div class="table-wrap" style="margin-top:12px"><table><tr><th></th><th class="num">Agreement value</th><th class="num">GST</th><th class="num">SDR</th><th class="num">Not split</th><th class="num">Total</th></tr>
          <tr><td>${esc(src === 'Tally' ? 'Tally' : 'Books')}</td><td class="num">${inr(T.booksAv)}</td><td class="num">${inr(T.booksGst)}</td><td class="num">${inr(T.booksSdr)}</td><td class="num">${inr(T.booksUn)}</td><td class="num"><b>${inr(T.books)}</b></td></tr>
          <tr><td>CRM</td><td class="num">${inr(T.crmAv)}</td><td class="num">${inr(T.crmGst)}</td><td class="num">${inr(T.crmSdr)}</td><td class="num">—</td><td class="num"><b>${inr(T.crm)}</b></td></tr>
          <tr class="tot"><td>Difference</td><td class="num">${diffN(T.booksAv - T.crmAv)}</td><td class="num">${diffN(T.booksGst - T.crmGst)}</td><td class="num">${diffN(T.booksSdr - T.crmSdr)}</td><td class="num">${inr(T.booksUn)}</td><td class="num">${diffN(T.books - T.crm)}</td></tr></table></div>
        <p class="small muted">Cheques that came back are left out on both sides: ${T.nReturned} in the books (${inr(T.returned)}), where the deposit and its return are both entered. Money of buyers whose booking was cancelled (Accounts → Cancelled flats) is left out too: ${T.nCancelled} receipts, ${inr(T.cancelled)}. Also in the books: ${inr(T.paidBack)} other payments to flats' ledgers (not a returned cheque), ${inr(T.refund)} refunds on cancelled flats, ${inr(T.other)} from earlier buyers of a flat, and ${d.noUnit.k} customer receipts with no flat (${inr(d.noUnit.amt)}). TDS by customers: ${inr(T.booksTds)} on the TDS Tracker, ${inr(T.crmTds)} in the CRM; it is not in either total. The split into AV, GST and SDR in Tally follows the bank account the money came into.</p></div>
      <div class="panel"><div class="row" style="grid-template-columns:260px 1fr auto;align-items:end;gap:12px"><div><label>Show</label><select id="bcs"><option value="differ">Flats that differ (${d.rows.filter((r) => !['Agrees', 'Nothing received'].includes(r.state)).length})</option><option value="all">All flats (${d.rows.length})</option>${STATES.map((x) => `<option value="${esc(x)}">${esc(x)} (${(S[x] || {}).n || 0})</option>`).join('')}</select></div>
        <div><label>Search flat or buyer</label><input id="bcq" value="${esc(q0)}" placeholder="A-1001 or name"></div><div><button class="ghost" id="bccsv">Download CSV</button></div></div>
        <div class="table-wrap acc-grid" style="margin-top:12px"><table id="bct"></table></div><p class="small muted" id="bcn"></p></div>`;
    $('#bcs').value = st;
    const shown = () => { const s1 = $('#bcs').value, q = $('#bcq').value.trim().toLowerCase(); return d.rows.filter((r) => (s1 === 'all' ? true : s1 === 'differ' ? !['Agrees', 'Nothing received'].includes(r.state) : r.state === s1) && (!q || (r.unit + ' ' + r.buyer).toLowerCase().includes(q))); };
    const draw = () => {
      const rows = shown();
      $('#bct').innerHTML = `<tr><th>Flat</th><th>Buyer</th><th class="num">AV books</th><th class="num">AV CRM</th><th class="num">GST books</th><th class="num">GST CRM</th><th class="num">SDR books</th><th class="num">SDR CRM</th><th class="num">Books total</th><th class="num">CRM total</th><th class="num">Difference</th><th>Result</th><th class="num">Cancelled buyers' money</th><th class="num">Cheques came back</th><th class="num">Other paid to flat</th></tr>`
        + rows.slice(0, 600).map((r) => `<tr class="click" data-u="${esc(r.unit)}"><td><b>${esc(r.unit)}</b></td><td>${esc(r.buyer)}</td><td class="num">${inr(r.booksAv)}</td><td class="num">${inr(r.crmAv)}</td><td class="num">${inr(r.booksGst)}</td><td class="num">${inr(r.crmGst)}</td><td class="num">${inr(r.booksSdr)}</td><td class="num">${inr(r.crmSdr)}</td><td class="num"><b>${inr(r.books)}</b></td><td class="num"><b>${inr(r.crm)}</b></td><td class="num">${diffN(r.diff)}</td><td>${pill(r.state)}</td><td class="num">${r.cancelled ? inr(r.cancelled) : ''}</td><td class="num">${r.returned ? inr(r.returned) : ''}</td><td class="num">${r.paidBack ? inr(r.paidBack) : ''}</td></tr>`).join('');
      $('#bcn').textContent = rows.length > 600 ? `Showing 600 of ${rows.length}; search to narrow.` : `${rows.length} flats, biggest difference first.`;
      document.querySelectorAll('#bct tr[data-u]').forEach((tr) => (tr.onclick = () => flat(tr.dataset.u)));
    };
    $('#bcs').onchange = () => { store.set('erp_bc_state', $('#bcs').value); draw(); };
    $('#bcq').oninput = () => { store.set('erp_bc_q', $('#bcq').value); draw(); };
    $('#bccsv').onclick = () => {
      const H = ['Flat', 'Buyer', 'CRM status', 'Agreement value', 'AV books', 'AV CRM', 'GST books', 'GST CRM', 'SDR books', 'SDR CRM', 'Not split (books)', 'Books total', 'CRM total', 'Difference', 'Result', 'Cancelled buyers money', 'Cheques came back', 'Other paid to flat', 'Refunds', 'From earlier buyers', 'TDS (tracker)', 'TDS (CRM)'];
      const K = ['unit', 'buyer', 'status', 'av', 'booksAv', 'crmAv', 'booksGst', 'crmGst', 'booksSdr', 'crmSdr', 'booksUn', 'books', 'crm', 'diff', 'state', 'cancelled', 'returned', 'paidBack', 'refund', 'other', 'booksTds', 'crmTds'];
      const csv = '﻿' + [H, ...shown().map((r) => K.map((k) => r[k]))].map((r) => r.map((v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? '')).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `tally-vs-crm-${todayIso()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    };
    draw();
    async function flat(unit) {
      const x = await api(`/api/books-crm?project=${proj || ''}&unit=${encodeURIComponent(unit)}`);
      const bk = x.books, cr = x.crm;
      const tag = (r) => r.pair ? (Math.abs(r.days) > 7 ? `<span class="pill grey">matched, ${Math.abs(r.days)} days apart</span>` : '<span class="pill good">matched</span>') : '<span class="pill bad">not on the other side</span>';
      const dl = document.createElement('dialog'); dl.className = 'wide';
      dl.innerHTML = `<form method="dialog"><h2>${esc(unit)} · ${esc(x.booking.buyer || '')}</h2><p class="muted">Agreement value ${inr(x.booking.av)} · ${esc(x.booking.status || '')}. ${x.unmatched.books} receipts in the books and ${x.unmatched.crm} in the CRM have no match on the other side.</p>
        ${x.cancelled && x.cancelled.length ? `<h3>Cancelled bookings on this flat (${x.cancelled.length})</h3><div class="table-wrap acc-grid"><table><tr><th>Cancelled</th><th>Client</th><th class="num">Received (refund list)</th><th>Refund status</th></tr>${x.cancelled.map((c) => `<tr><td>${fmtD(c.cancel_date)}</td><td>${esc(c.client || '')}</td><td class="num">${inr(c.received)}</td><td>${esc(c.refund_status || '')}</td></tr>`).join('')}</table></div>` : ''}
        <h3>In the books (${bk.length})</h3><div class="table-wrap acc-grid"><table><tr><th>Date</th><th>ID</th><th>Bank</th><th>Head</th><th class="num">Amount</th><th>Ledger / payer</th><th></th></tr>
        ${bk.map((r) => `<tr><td>${fmtD(r.date)}</td><td class="small">${esc(r.ref || '')}</td><td class="small">${esc(r.bank)}</td><td>${esc(r.head)}</td><td class="num">${inr(r.amount)}</td><td class="small">${esc(r.payer || r.desc || '')}</td><td>${r.bounced ? '<span class="pill grey">bounced</span>' : r.returnedOn ? `<span class="pill grey">came back ${fmtD(r.returnedOn)}</span>` : r.cancelledBuyer ? '<span class="pill grey">cancelled buyer</span>' : r.other ? '<span class="pill grey">earlier buyer</span>' : tag(r)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None.</td></tr>'}</table></div>
        ${x.paid.length ? `<h3>Paid to this flat's ledger in the books (${x.paid.length})</h3><div class="table-wrap acc-grid"><table><tr><th>Date</th><th>ID</th><th>Bank</th><th>Head</th><th class="num">Amount</th></tr>${x.paid.map((p) => `<tr><td>${fmtD(p.date)}</td><td class="small">${esc(p.ref || '')}</td><td class="small">${esc(p.bank)}</td><td>${esc(p.head)}${p.isReturn ? ' <span class="pill grey">cheque came back</span>' : ''}</td><td class="num">${inr(p.amount)}</td></tr>`).join('')}</table></div>` : ''}
        <h3>In the CRM ledger (${cr.length})</h3><div class="table-wrap acc-grid"><table><tr><th>Date</th><th>Mode</th><th>Bank</th><th>Cheque / UTR</th><th class="num">Amount (without TDS)</th><th>Split</th><th></th></tr>
        ${cr.map((r) => `<tr><td>${fmtD(r.date)}</td><td>${esc(r.mode || '')}</td><td class="small">${esc(r.bank || '')}</td><td class="small">${esc(r.ref || '')}</td><td class="num">${inr(r.amount)}</td><td class="small">${esc(r.split || '')}</td><td>${r.status !== 'approved' ? `<span class="pill grey">${esc(r.status)}</span>` : r.amount > 0 ? tag(r) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None.</td></tr>'}</table></div>
        <div class="actions"><button value="cancel">Close</button></div></form>`;
      document.body.appendChild(dl); dl.addEventListener('close', () => dl.remove()); dl.showModal();
    }
  }

  async function accChecks() {
    const d = await api(`/api/accounts?view=checks&project=${proj || ''}`);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Checks</h1><p class="muted">Month end: every line in the Result column should say OK. If one says Check, fix the entry it points to. "For review" lines are not expected to be zero; they are explained unit by unit on the reports.</p></div></div>
      <div class="panel"><div class="table-wrap"><table><tr><th>#</th><th>Check</th><th class="num">Figure</th><th>Result</th><th>What it means</th></tr>
        ${d.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.check)}</td><td class="num">${typeof x.figure === 'number' ? x.figure.toLocaleString('en-IN') : esc(x.figure)}</td><td>${x.result === 'OK' ? '<span class="pill good">OK</span>' : x.result === 'Check' ? '<span class="pill bad">Check</span>' : '<span class="pill grey">For review</span>'}</td><td class="small">${esc(x.means || '')}</td></tr>`).join('')}</table></div></div>`;
  }

  async function accReports() {
    const tab = store.get('erp_accrep') || 'byHead';
    const T = [['byHead', 'Payments by Head'], ['units', 'Unit receipts'], ['gst', 'GST report'], ['sdr', 'SDR report'], ['tds', 'TDS by customers'], ['payees', 'Payees'], ['vendorBills', 'Vendor bills'], ['register', 'Salary & expense register'], ['bounced', 'Bounced cheques'], ['tally', 'Tally export']];
    $('#page').innerHTML = `<div class="page-head"><div><h1>Accounts reports</h1><p class="muted">The report tabs of the accounts sheet, worked out live from the registers.</p></div></div>
      <div class="tabs">${T.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="rep"><div class="panel muted">Loading…</div></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((b) => (b.onclick = () => { store.set('erp_accrep', b.dataset.t); accReports(); }));
    const out = $('#rep');
    const table = (cols, rows, opts = {}) => `<div class="panel">${opts.head || ''}<div class="table-wrap acc-grid"><table><tr>${cols.map(([l, , t]) => `<th class="${t ? 'num' : ''}">${esc(l)}</th>`).join('')}</tr>
      ${rows.slice(0, opts.limit || 1500).map((r) => `<tr>${cols.map(([, f, t]) => { const v = f(r); return `<td class="${t ? 'num' : ''}">${t === 'm' ? (v ? inr(v) : '—') : t === 'n' ? (v ?? '') : esc(v ?? '')}</td>`; }).join('')}</tr>`).join('')}</table></div>${rows.length > (opts.limit || 1500) ? `<p class="small muted">Showing ${opts.limit || 1500} of ${rows.length}.</p>` : ''}</div>`;
    const P = proj || '';
    if (tab === 'tally') {
      const m0 = todayIso().slice(0, 8) + '01';
      out.innerHTML = `<div class="panel"><h2>Export to Tally</h2><p class="muted">Receipts and Payments Out for a period, as Tally vouchers. Bounced cheques are left out. Each receipt debits the bank ledger and credits its cash flow head; each payment the reverse. The bank and head names must exist as ledgers in Tally (create them once, with the same names), or Tally will report them as missing.</p>
        <div class="row" style="grid-template-columns:1fr 1fr"><div><label>From</label><input type="date" id="tf" value="${m0}"></div><div><label>To</label><input type="date" id="tt" value="${todayIso()}"></div></div>
        <div class="actions"><button id="tx">Download Tally XML (Import Data)</button><button class="ghost" id="tc">Download day book (CSV)</button></div></div>`;
      const dl = (fmt) => { location.href = `/api/accounts?view=tally&from=${$('#tf').value}&to=${$('#tt').value}&format=${fmt}`; };
      $('#tx').onclick = () => dl('xml'); $('#tc').onclick = () => dl('csv');
      return;
    }
    if (tab === 'register') {
      const fy = +(store.get('erp_regfy') || 0) || (todayIso().slice(5, 7) >= '04' ? +todayIso().slice(0, 4) : +todayIso().slice(0, 4) - 1), head = store.get('erp_reghead') || 'Salary';
      const [d, L] = await Promise.all([api(`/api/accounts?view=report&name=register&fy=${fy}&head=${encodeURIComponent(head)}`), api('/api/accounts?view=lists')]);
      const mlab = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      out.innerHTML = `<div class="panel"><div class="row" style="grid-template-columns:1fr 1fr"><div><label>Cash flow head</label><select id="rh">${L.lists.paymentHead2.map((h) => `<option ${h === head ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>
        <div><label>Financial year starting April</label><input id="ry" type="number" value="${fy}"></div></div><p class="small muted">Straight from Payments Out. Salary paid through another person shows under that person; payments with no payee show as "(no payee)". Use this for Form 16 and the 24Q TDS return.</p></div>` +
        table([['Payee', (r) => r.payee], ['PAN', (r) => r.pan], ...d.months.map((m) => [mlab(m), (r) => r[m] || 0, 'm']), ['Total for the year', (r) => r.total, 'm']], [{ payee: 'Total', pan: '', ...Object.fromEntries(d.months.map((m) => [m, d.rows.reduce((a, r) => a + (r[m] || 0), 0)])), total: d.rows.reduce((a, r) => a + r.total, 0) }, ...d.rows]);
      $('#rh').onchange = (e) => { store.set('erp_reghead', e.target.value); accReports(); };
      $('#ry').onchange = (e) => { store.set('erp_regfy', e.target.value); accReports(); };
      return;
    }
    const d = await api(`/api/accounts?view=report&name=${tab}&project=${P}`);
    if (tab === 'byHead') {
      const mlab = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const ms = d.months.slice(-12);
      const t = (rows, h) => table([['Cash Flow Head', (r) => r.head], ...ms.map((m) => [mlab(m), (r) => r[m] || 0, 'm']), ['Total (all months)', (r) => r.total, 'm']], rows, { head: `<h2>${h}</h2>` });
      out.innerHTML = '<p class="small muted">Last 12 months shown; the Total column covers every month. Bounced cheques are left out of receipts.</p>' + t(d.receipts, 'Receipts (money in)') + t(d.payments, 'Payments (money out)');
    } else if (tab === 'units') out.innerHTML = table([['Unit', (r) => r.unit], ['Applicant', (r) => r.applicant], ['Status', (r) => r.status], ['Agreement value', (r) => r.av, 'm'], ['AV received (bank)', (r) => r.avReceived, 'm'], ['% of AV', (r) => r.pct + '%', 'n'], ['GST received', (r) => r.gstReceived, 'm'], ['SDR received', (r) => r.sdrReceived, 'm'], ['Unclassified', (r) => r.unclassified, 'm'], ['From other / earlier buyers', (r) => r.other, 'm'], ['Bounced', (r) => r.bounced, 'm'], ['TDS (tracker)', (r) => r.tds, 'm'], ['SDR paid out', (r) => r.sdrPaid, 'm'], ['Refunds', (r) => r.refunds, 'm'], ['CP brokerage', (r) => r.cp, 'm'], ['CRM AV (ERP ledger)', (r) => r.crmAv, 'm'], ['Bank − CRM', (r) => r.diff, 'm']], d.rows);
    else if (tab === 'gst') out.innerHTML = table([['Unit', (r) => r.unit], ['Applicant', (r) => r.applicant], ['Status', (r) => r.status], ['Agreement value', (r) => r.av, 'm'], ['GST payable', (r) => r.gstPayable, 'm'], ['AV received (bank)', (r) => r.avReceived, 'm'], ['GST due on AV received', (r) => r.gstDueOnReceived, 'm'], ['GST received (bank)', (r) => r.gstReceived, 'm'], ['Shortfall on received', (r) => r.shortfall, 'm'], ['GST outstanding (full)', (r) => r.outstanding, 'm'], ['GST per CRM (ERP)', (r) => r.crm, 'm'], ['Status', (r) => r.state]], d.rows);
    else if (tab === 'sdr') out.innerHTML = table([['Unit', (r) => r.unit], ['Applicant', (r) => r.applicant], ['Status', (r) => r.status], ['Registration', (r) => r.registration], ['Stamp duty', (r) => r.stampDuty, 'm'], ['Registration fee', (r) => r.registrationFee, 'm'], ['SDR payable', (r) => r.payable, 'm'], ['SDR received (bank)', (r) => r.received, 'm'], ['SDR paid out (challans)', (r) => r.paidOut, 'm'], ['Held (received − paid)', (r) => r.held, 'm'], ['To collect', (r) => r.toCollect, 'm'], ['SDR per CRM (ERP)', (r) => r.crm, 'm'], ['Status', (r) => r.state]], d.rows);
    else if (tab === 'tds') out.innerHTML = `<div class="panel"><div class="kpis">${kpi(inr(d.due), 'total TDS due (1% of AV)')}${kpi(inr(d.paid), 'paid by customers')}${kpi(inr(d.due - d.paid), 'still to come')}${kpi(`${d.flats} / ${d.full} / ${d.part} / ${d.none}`, 'flats: with TDS / fully / partly / not paid')}</div></div>` +
      table([['Unit', (r) => r.unit], ['TDS due', (r) => r.due, 'm'], ['TDS paid', (r) => r.paid, 'm'], ['Balance', (r) => r.balance, 'm']], d.rows);
    else if (tab === 'payees') out.innerHTML = table([['Payee', (r) => r.payee], ['Type', (r) => r.type], ['PAN', (r) => r.pan], ['GSTIN', (r) => r.gstin], ['TDS section', (r) => r.tdsSection], ['Usual cash flow head', (r) => r.usualHead], ['Needs invoice?', (r) => r.needsInvoice], ['No. of payments', (r) => r.n, 'n'], ['Total paid', (r) => r.paid, 'm'], ['Total billed', (r) => r.billed, 'm'], ['TDS on bills', (r) => r.tds, 'm']], d.rows);
    else if (tab === 'vendorBills') out.innerHTML = table([['Payment ID', (r) => r.ref_id], ['Paid on', (r) => fmtD(r.txn_date)], ['Payee', (r) => r.payee], ['Head', (r) => r.head], ['Bill date', (r) => (r.bill_date ? fmtD(r.bill_date) : '')], ['Vendor PAN', (r) => r.vendor_pan], ['Bill no.', (r) => r.bill_no], ['Taxable', (r) => r.taxable_value, 'm'], ['GST', (r) => r.gst_on_bill, 'm'], ['Total bill', (r) => r.total_bill, 'm'], ['TDS section', (r) => r.tds_section || r.tdsSectionUsual], ['TDS deducted', (r) => r.tds_deducted, 'm'], ['Paid', (r) => r.amount, 'm'], ['Challan', (r) => r.tds_challan], ['What staff need to add', (r) => r.needs]], d.rows);
    else if (tab === 'bounced') out.innerHTML = table([['Receipt ID', (r) => r.ref_id], ['Date', (r) => fmtD(r.txn_date)], ['Bank', (r) => r.bank], ['Amount', (r) => r.amount, 'm'], ['Unit', (r) => r.unit_no], ['Payer', (r) => r.payer_name], ['Head', (r) => r.payment_head || r.head], ['Description', (r) => r.description], ['Remark', (r) => r.remark]], d.rows);
  }

  async function accSetup() {
    const [d, imp] = await Promise.all([api('/api/accounts?view=lists'), api('/api/accounts?view=import')]);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Banks, heads &amp; import</h1><p class="muted">Cash flow heads and bank accounts are set up here only (on the sheet: "Do not add heads yourself; ask Mr Syed"). The head map decides the cash flow section, TDS section and rate, and whether a payment needs a bill.</p></div></div>
      ${!imp.live ? `<div class="panel"><h2>Import from Tally</h2>
        <p class="muted">Upload the Receipt Register, the Payment Register and the Contra Register exported from Tally to Excel. Every bank line becomes one row in Receipts or Payments Out (flat ledgers such as "B-2401 Name" fill the Unit), the bank accounts are set up from Tally's bank ledgers, and the Daily Bank Balance is worked out from Tally. Everything now in Receipts, Payments Out and the Daily Bank Balance is replaced. Then use Bank Auto Check → "Compare with the bank statements" to see what differs.</p>
        ${imp.lastTally ? `<p class="ok">Last Tally import ${fmtDate(imp.lastTally.created_at)} by ${esc(imp.lastTally.by_name || '')}: ${imp.lastTally.after.receipts} receipts and ${imp.lastTally.after.payments} payments, ${fmtD(imp.lastTally.after.from)} to ${fmtD(imp.lastTally.after.to)}.</p>` : ''}
        <div class="row" style="grid-template-columns:1fr 1fr 1fr"><div><label>Receipt Register (.xlsx)</label><input type="file" id="tr" accept=".xlsx"></div><div><label>Payment Register (.xlsx)</label><input type="file" id="tp" accept=".xlsx"></div><div><label>Contra Register (.xlsx)</label><input type="file" id="tc" accept=".xlsx"></div></div>
        <div class="actions"><button class="ghost" id="tpv">Read the files and check them</button><button id="tim">Import from Tally</button></div><div id="tout"></div></div>` : ''}
      ${!imp.live ? `<div class="panel"><h2>Cancelled flats: the refund list</h2>
        <p class="muted">Upload the accounts team's refund sheet (the "Unit Refund" tab: Cancellation Date, Unit, Refund Status, Client Name, Cleared, RTGS, WHITE). Each row goes into Accounts → Cancelled flats, where it is checked against the CRM and the books. Rows from an earlier upload are replaced; rows typed in the ERP stay.</p>
        ${imp.lastRefunds ? `<p class="ok">Last uploaded ${fmtDate(imp.lastRefunds.created_at)} by ${esc(imp.lastRefunds.by_name || '')}: ${imp.lastRefunds.after.rows} cancellations, ${imp.lastRefunds.after.pending} not refunded yet (${inr(imp.lastRefunds.after.pendingAmount)}).</p>` : ''}
        <div class="row"><div><label>Refund list (.xlsx)</label><input type="file" id="rfl" accept=".xlsx"></div><div></div></div>
        <div class="actions"><button id="rfi">Upload the refund list</button></div></div>` : ''}
      <div class="panel"><h2>Import from the Master Accounts sheet</h2>
        <p class="muted">Reads every tab the accounts team types into (Receipts, Payments Out, Daily Bank Balance, PDC, TDS Tracker, Reconciling Items, Compliance Calendar, SRA Tenants, Tenant Rent Links), the Lists and CA Settings tabs, and CP Commissions (brokerage released). Rows from an earlier import are replaced; rows entered in the ERP stay. The sheet is never changed. ${imp.live ? '<b>The ERP is live, so this is switched off.</b>' : 'Until go-live you can run it as often as you like to bring the ERP up to date with the sheet.'}</p>
        ${imp.last ? `<p class="ok">Last imported ${fmtDate(imp.last.created_at)} by ${esc(imp.last.by_name || '')}: ${imp.last.after.receipts} receipts, ${imp.last.after.payments} payments.</p>` : ''}
        ${!imp.live ? `<div class="actions"><button class="ghost" id="ipv" ${imp.configured ? '' : 'disabled'}>Read the sheet and check it</button><button id="imp" ${imp.configured ? '' : 'disabled'}>Import now</button></div><div id="ipo"></div>
        <div class="panel" style="margin-top:12px;border-color:var(--bad,#b42318)"><h2>Clear accounts data (test version)</h2><p class="muted">Empties every accounts register: Receipts, Payments Out, Daily Bank Balance entries and balances, PDC, TDS Tracker, Reconciling Items, Compliance Calendar, SRA Tenants, Tenant Rent Links and the Bank Auto Check runs. Bank accounts, cash flow heads and settings stay. CRM data (bookings, demands, customer receipts) is not touched. The sheet can be imported again at any time.</p>
        <div class="actions"><input id="clrc" placeholder="Type CLEAR" style="width:140px"><button class="danger" id="clr">Clear accounts data</button></div></div>` : ''}</div>
      <div class="two"><div class="panel"><div class="page-head" style="margin:0 0 8px"><h2 style="margin:0">Bank accounts</h2><button class="ghost small" id="nb">Add</button></div><p class="small muted">As written in the Bank Account column of Receipts and Payments Out.</p><div class="table-wrap"><table>${d.banks.map((b) => `<tr><td>${esc(b.name)}</td><td class="small muted">${esc(b.account_no || '')}</td></tr>`).join('')}</table></div>
        <h2 style="margin-top:16px">Daily Bank Balance banks</h2><div class="table-wrap"><table><tr><th>Bank</th><th>A/c No.</th><th>Group</th><th class="num">B/F</th></tr>${d.dailyBanks.map((b) => `<tr><td>${esc(b.name)}</td><td class="small">${esc(b.account_no || '')}</td><td>${esc(b.grp)}</td><td class="num">${inr(b.bf_balance)}</td></tr>`).join('')}</table></div></div>
      <div class="panel"><div class="page-head" style="margin:0 0 8px"><h2 style="margin:0">Cash flow heads (head map)</h2><button class="ghost small" id="nh">Add</button></div><div class="table-wrap" style="max-height:620px"><table><tr><th>Side</th><th>Head</th><th>Section</th><th>TDS</th><th>Needs bill</th><th>Payee type</th></tr>
        ${d.heads.map((h) => `<tr class="click" data-h="${h.id}"><td>${h.side}</td><td>${esc(h.name)}</td><td class="small">${esc(h.section || '')}</td><td class="small">${esc([h.tds_section, h.tds_rate ? (toNum(h.tds_rate) * 100).toFixed(1) + '%' : ''].filter(Boolean).join(' '))}</td><td>${h.needs_bill ? 'Yes' : ''}</td><td class="small">${esc(h.payee_type || '')}</td></tr>`).join('')}</table></div></div></div>`;
    const headForm = (h) => dialog(`<h2>${h ? 'Cash flow head' : 'New cash flow head'}</h2>
      <div class="row"><div><label>Side</label><select name="side" ${h ? 'disabled' : ''}><option value="payment" ${h?.side === 'payment' ? 'selected' : ''}>Payment</option><option value="receipt" ${h?.side === 'receipt' ? 'selected' : ''}>Receipt</option></select></div><div><label>Name</label><input name="name" value="${esc(h?.name || '')}" ${h ? 'readonly' : 'required'}></div></div>
      <div class="row"><div><label>Cash flow section</label><select name="section">${['Operating', 'Investing', 'Financing', 'Internal transfer'].map((x) => `<option ${h?.section === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div><label>Indirect method line</label><input name="indirectLine" value="${esc(h?.indirect_line || '')}"></div></div>
      <div class="row3"><div><label>TDS section</label><input name="tdsSection" value="${esc(h?.tds_section || '')}" placeholder="194C"></div><div><label>TDS rate %</label><input name="tdsRate" value="${h?.tds_rate ? toNum(h.tds_rate) * 100 : ''}"></div><div><label>Payee type</label><input name="payeeType" value="${esc(h?.payee_type || '')}"></div></div>
      <div class="row"><div><label>Non-revenue category</label><input name="category" value="${esc(h?.category || '')}"></div><div><label class="check"><input type="checkbox" name="needsBill" ${h?.needs_bill ? 'checked' : ''}> Needs a bill (its payments go to Vendor bills)</label></div></div>
      <label>Note</label><input name="note" value="${esc(h?.note || '')}">`,
    async (x) => { await api('/api/accounts', { action: 'head', ...x, side: h ? h.side : x.side, name: h ? h.name : x.name, needsBill: x.needsBill === 'on' }); accSetup(); });
    $('#nh').onclick = () => headForm(null);
    document.querySelectorAll('tr[data-h]').forEach((tr) => (tr.onclick = () => headForm(d.heads.find((h) => h.id === +tr.dataset.h))));
    $('#nb').onclick = () => dialog('<h2>New bank account</h2><label>Name (as it should appear in Receipts and Payments Out)</label><input name="name" required><label>Account no.</label><input name="accountNo">', async (x) => { await api('/api/accounts', { action: 'bank', ...x }); accSetup(); });
    const summ = (s) => `<div class="kpis" style="margin:10px 0">${kpi(s.receipts.toLocaleString('en-IN'), 'receipts')}${kpi(inr(s.receiptsCleared), 'received, bounced left out')}${kpi(s.payments.toLocaleString('en-IN'), 'payments')}${kpi(inr(s.paymentsAmount), 'paid out')}${kpi(s.daily, 'daily entries')}${kpi(s.tds, 'TDS entries')}${kpi(s.recon, 'reconciling items')}${kpi(s.tenants, 'SRA tenants')}${kpi(s.rentLinks, 'rent links')}${kpi(s.heads, 'heads')}${kpi(inr(s.cpReleased), 'CP brokerage released')}</div>
      ${Object.values(s.gaps).some(Boolean) ? `<p class="small muted">Rows with a blank required column (they come in as they are, to fill in the ERP): ${Object.entries(s.gaps).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}.</p>` : ''}`;
    if ($('#ipv')) $('#ipv').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Reading…'; try { const r = await api('/api/accounts', { action: 'import-preview', projectId: proj }); $('#ipo').innerHTML = summ(r.summary); } catch (x) { alert(x.message); } e.target.disabled = false; e.target.textContent = 'Read the sheet and check it'; };
    const tallyFiles = async () => {
      const f = [$('#tr').files[0], $('#tp').files[0], $('#tc').files[0]].filter(Boolean);
      if (!$('#tr').files[0] || !$('#tp').files[0]) throw new Error('Choose the Receipt Register and the Payment Register (and the Contra Register for transfers between your own accounts).');
      return Promise.all(f.map((x) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: x.name, data: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(x); })));
    };
    const tallyShow = (r) => { const s = r.summary; $('#tout').innerHTML = `<p class="ok">${s.receipts.toLocaleString('en-IN')} receipts (${inr(s.receiptsTotal)}) and ${s.payments.toLocaleString('en-IN')} payments (${inr(s.paymentsTotal)}), ${fmtD(s.from)} to ${fmtD(s.to)}. Banks: ${esc(s.banks.join(', '))}.${s.pdcs ? ` ${s.pdcs} post-dated payments (${inr(s.pdcTotal)}) go to the PDC register.` : ''}</p>`
      + (r.problems && r.problems.length ? `<div class="table-wrap"><table><tr><th>To check in Tally</th><th>Voucher</th><th>Detail</th></tr>${r.problems.map((p) => `<tr><td>${esc(p.what)}</td><td class="small">${esc(p.where)}</td><td class="small">${esc(p.detail)}</td></tr>`).join('')}</table></div>` : ''); };
    if ($('#tpv')) $('#tpv').onclick = async (e) => { e.target.disabled = true; try { tallyShow(await api('/api/accounts', { action: 'tally-preview', files: await tallyFiles() })); } catch (x) { alert(x.message); } e.target.disabled = false; };
    if ($('#tim')) $('#tim').onclick = async (e) => { if (!confirm('Replace Receipts, Payments Out and the Daily Bank Balance with the Tally registers?')) return; e.target.disabled = true; e.target.textContent = 'Importing… (up to a minute)'; try { const r = await api('/api/accounts', { action: 'tally-import', files: await tallyFiles() }); toast(`Imported ${r.summary.receipts} receipts and ${r.summary.payments} payments from Tally.`); accSetup(); } catch (x) { alert(x.message); e.target.disabled = false; e.target.textContent = 'Import from Tally'; } };
    if ($('#rfi')) $('#rfi').onclick = async (e) => {
      const f = $('#rfl').files[0]; if (!f) return alert('Choose the refund list first.');
      e.target.disabled = true;
      try {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
        const r = await api('/api/accounts', { action: 'refunds-import', files: [{ name: f.name, data }] });
        toast(`Uploaded ${r.rows} cancellations; ${r.pending} not refunded yet (${inr(r.pendingAmount)}).`); go('#/reg-cancellations');
      } catch (x) { alert(x.message); e.target.disabled = false; }
    };
    if ($('#clr')) $('#clr').onclick = async (e) => { if ($('#clrc').value.trim() !== 'CLEAR') return alert('Type CLEAR in the box first.'); e.target.disabled = true; try { const r = await api('/api/accounts', { action: 'clear', confirm: 'CLEAR' }); toast(`Cleared: ${r.removed.acc_receipts} receipts and ${r.removed.acc_payments} payments removed.`); accSetup(); } catch (x) { alert(x.message); e.target.disabled = false; } };
    if ($('#imp')) $('#imp').onclick = async (e) => { if (!confirm('Import the accounts sheet into the ERP? Rows from the last import are replaced; rows entered in the ERP stay.')) return; e.target.disabled = true; e.target.textContent = 'Importing… (up to a minute)'; try { const r = await api('/api/accounts', { action: 'import', projectId: proj }); toast(`Imported ${r.counts.receipts} receipts and ${r.counts.payments} payments.`); accSetup(); } catch (x) { alert(x.message); e.target.disabled = false; e.target.textContent = 'Import now'; } };
  }

  // ---------- import from the CRM sheet ----------
  const KIND = {
    'crm-vs-ledger': 'CRM Follow up and Ledger differ', 'ledger-vs-bank': 'Ledger and bank statement differ', 'shared-instrument': 'Same payment on two units',
    'ledger-total': 'Ledger lines do not match its total', 'ledger-unassigned': 'Ledger lines outside any total', 'no-ledger': 'No Ledger block', 'held-unit': 'Held / management unit',
    'money-on-unsold': 'Money against an unsold unit', 'no-agreement-value': 'Sold without agreement value', 'bank-tag': 'Bank entry not tagged to a unit', 'ledger-orphan': 'Ledger block for unknown unit',
    'due-pct-mismatch': 'Due % does not match the plan', 'no-due-pct': 'No Due %', 'no-booking-date': 'No booking date', 'no-buyer-name': 'No buyer name', 'bad-pan': 'PAN looks wrong',
    'no-mobile': 'No mobile number', 'no-email': 'No email address', 'duplicate-unit': 'Unit listed twice', 'unknown-building': 'Wing not set up', 'no-dates': 'No dates at all',
  };
  async function importPage() {
    if (!proj) return noProject();
    const s = await api(`/api/import?project=${proj}`);
    const page = $('#page');
    page.innerHTML = `<div class="page-head"><div><h1>Import from the CRM sheet</h1><p class="muted">Reads the Master Dream Signature sheet (Developer's Bookings, CRM Follow up, Ledger and Rera Bank Stat.), shows what it found and everything that does not add up, then imports it. The sheet itself is never changed.</p></div></div>
      ${!s.configured ? `<div class="err">The ERP is not connected to Google Sheets yet. In Vercel, add <b>GOOGLE_SERVICE_ACCOUNT_JSON</b> to the dream-india-erp project (the same value the staff portal uses), then redeploy.</div>` : ''}
      ${s.last ? `<div class="ok">Imported on ${fmtD(s.last.created_at.slice(0, 10))} by ${esc(s.last.by_name || '')}: ${s.last.summary.bookings} bookings, ${s.last.summary.receipts} receipts, ${s.last.summary.issues} items to verify. <a href="#/verify">Open Data to verify</a></div>` : ''}
      ${s.counts.real && s.canReset ? `<div class="panel"><h2>Import again</h2><p class="muted">Test version only. Removes everything imported into this project (units, bookings, buyers, demands, receipts, letters, follow-ups, bank entries and the items to verify) so you can read the sheet and import it again. The CRM sheet is not touched. Once the ERP is live this button disappears.</p>
        <div class="actions"><button id="reset" class="danger">Clear imported data</button></div></div>` : ''}
      ${s.counts.real ? '' : `<div class="panel"><h2>Step 1: read the sheet</h2><p class="muted">Nothing is saved at this step.${s.counts.sample ? ' The sample data currently loaded will be removed when you import.' : ''}</p>
        <div class="actions"><button id="read" ${s.configured ? '' : 'disabled'}>Read the sheet and check it</button></div></div><div id="preview"></div>`}`;
    if ($('#reset')) $('#reset').onclick = async () => {
      const t = prompt('This removes all imported data for this project so it can be imported again. Type CLEAR to confirm.');
      if (t === null) return;
      try { const r = await api('/api/import', { action: 'reset', projectId: proj, confirm: t.trim().toUpperCase() }); toast(`Cleared ${r.removedUnits} units. You can import again now.`); importPage(); } catch (e) { alert(e.message); }
    };
    if (!$('#read')) return;
    let dates = {};
    $('#read').onclick = async () => {
      $('#read').disabled = true; $('#read').textContent = 'Reading… (up to a minute)';
      try { const p = await api('/api/import', { action: 'preview', projectId: proj, stageDates: dates }); dates = p.stageDates; showPreview(p); } catch (e) { alert(e.message); }
      $('#read').disabled = false; $('#read').textContent = 'Read the sheet again';
    };
    function showPreview(p) {
      const s = p.summary;
      const keys = Object.keys(p.stageDates).sort();
      $('#preview').innerHTML = `<div class="panel"><h2>Step 2: what the sheet holds</h2><div class="kpis">${kpi(s.units, 'units')}${kpi(s.bookings, 'bookings')}${kpi(s.registered, 'registered')}${kpi(cr(s.agreementValue), 'agreement value')}${kpi(cr(s.demanded), 'demanded')}
          ${kpi(cr(s.receivedAv + s.receivedTds), 'received AV + TDS')}${kpi(cr(s.receivedGst), 'GST received')}${kpi(s.receipts, 'receipts')}</div>
        <p class="small muted">Units: ${Object.entries(s.byStatus).map(([k, v]) => `${STATUS[k] || k} ${v}`).join(' · ')}</p></div>
        <div class="panel"><h2>Step 3: confirm when each stage was demanded</h2><p class="muted">The sheet records only each buyer's latest demand date. These dates are the most common ones found; correct any that are wrong. A buyer booked after a stage date is demanded on their booking date instead.</p>
          <table>${keys.map((k) => { const [w, st] = k.split('|'); return `<tr><td>${esc(w)} Wing</td><td>${esc(st)}</td><td><input type="date" data-k="${esc(k)}" value="${esc(p.stageDates[k] || '')}"></td></tr>`; }).join('')}</table></div>
        <div class="panel"><h2>Step 4: items the team will verify (${s.issues})</h2><p class="muted">These are imported as they are and listed on the "Data to verify" page, where CRM and Accounts check and close each one.</p>
          <table><tr><th>Type</th><th class="num">Count</th><th>Example</th></tr>${Object.entries(s.issuesByKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(KIND[k] || k)}</td><td class="num">${n}</td><td class="small">${esc((p.examples[k] || [])[0] ? `${p.examples[k][0].unit || ''} ${p.examples[k][0].detail}` : '')}</td></tr>`).join('')}</table></div>
        <div class="panel"><h2>Step 5: import</h2><p class="muted">Imports all units, bookings, buyers, demands and receipts into Dream Signature. Receipts come in as approved (the money is already in the bank) and are marked as imported.</p>
          <div class="actions"><button id="go">Import ${s.bookings} bookings now</button></div><div id="result"></div></div>`;
      document.querySelectorAll('[data-k]').forEach((i) => (i.onchange = () => { dates[i.dataset.k] = i.value; }));
      $('#go').onclick = async () => {
        if (keys.some((k) => !dates[k])) return alert('Enter a date for every stage first.');
        if (!confirm(`Import ${s.bookings} bookings, ${s.receipts} receipts and ${s.issues} items to verify into the ERP?`)) return;
        $('#go').disabled = true; $('#go').textContent = 'Importing…';
        try { const r = await api('/api/import', { action: 'commit', projectId: proj, stageDates: dates }); toast(`Imported ${r.bookings} bookings and ${r.receipts} receipts.`); go('#/verify'); }
        catch (e) { $('#go').disabled = false; $('#go').textContent = `Import ${s.bookings} bookings now`; alert(e.message); }
      };
    }
  }

  // ---------- data to verify ----------
  async function verify() {
    if (!proj) return noProject();
    const tab = store.get('erp_vtab') || 'open';
    const d = await api(`/api/verify?project=${proj}&status=${tab}`);
    const kinds = [...new Set(d.rows.map((r) => r.kind))];
    const kf = store.get('erp_vkind') || '';
    const rows = d.rows.filter((r) => !kf || r.kind === kf);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Data to verify</h1><p class="muted">Everything the import found that does not add up. Check each against the documents and the bank, correct it in the ERP if needed, then close it with a note of what was done.</p></div></div>
      <div class="panel"><div class="kpis">${kpi(d.counts.open, 'open')}${kpi(d.counts.money, 'involve money', d.counts.money ? 'bad' : '')}${kpi(d.counts.resolved, 'closed')}</div></div>
      <div class="tabs">${[['open', 'Open'], ['resolved', 'Closed']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}
        <select id="kind" class="proj" style="margin-left:8px"><option value="">All types</option>${kinds.map((k) => `<option value="${esc(k)}" ${k === kf ? 'selected' : ''}>${esc(KIND[k] || k)}</option>`).join('')}</select></div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or text"><table><tr><th>Unit</th><th>Type</th><th>What was found</th><th>${tab === 'open' ? '' : 'Resolution'}</th></tr>
      ${rows.map((r) => `<tr data-s="${esc(((r.unit_no || '') + ' ' + r.detail).toLowerCase())}"><td style="white-space:nowrap">${r.booking_id ? `<a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a>` : esc(r.unit_no || 'Project')}</td>
        <td class="small">${r.severity === 'money' ? '<span class="pill bad">money</span> ' : '<span class="pill grey">data</span> '}${esc(KIND[r.kind] || r.kind)}</td><td class="small">${esc(r.detail)}</td>
        <td class="small">${tab === 'open' ? (d.canResolve ? `<button class="small" data-fix="${r.id}">Close</button>` : '') : `${esc(r.resolution || '')}<br><span class="muted">${esc(r.resolved_by_name || '')} · ${fmtD((r.resolved_at || '').slice(0, 10))}</span>${d.canResolve ? ` <a href="#" data-re="${r.id}">reopen</a>` : ''}`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_vtab', t.dataset.t); verify(); }));
    $('#kind').onchange = (e) => { store.set('erp_vkind', e.target.value); verify(); };
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    document.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => dialog(`<h2>Close this item</h2><p class="small">${esc(d.rows.find((r) => r.id === +b.dataset.fix).detail)}</p>
      <label>What was checked or corrected</label><textarea name="resolution" rows="3" required placeholder="e.g. Checked bank statement: ₹1,50,000 received on 12 Mar into the collection account; receipt added in the ERP."></textarea>`,
    async (x) => { await api('/api/verify', { action: 'resolve', id: +b.dataset.fix, ...x }); toast('Closed.'); verify(); })));
    document.querySelectorAll('[data-re]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await api('/api/verify', { action: 'reopen', id: +a.dataset.re }); verify(); }));
  }

  start();
})();
