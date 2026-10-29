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
    // an entry in a closed month: Head Accounts gives the reason, and it is kept in the audit log
    if (r.status === 400 && body && !body.reason && /books are closed up to/.test(j.error || '')) {
      const why = prompt(j.error + '\n\nReason:');
      if (why && why.trim()) return api(path, { ...body, reason: why.trim() });
    }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { data: j });
    return j;
  }
  const can = (p) => !!me && me.perms.includes(p);
  function showErr(form, e) { let box = $('.err', form); if (!box) { box = document.createElement('div'); box.className = 'err'; form.appendChild(box); } box.textContent = e.message; }
  const logo = '<img src="/icon.svg" alt="">';
  // sign-in, first setup and password cards: the Dream India Realty logo
  const brand = (sub) => `<div class="brandlogo"><img src="/logo-dark.svg" alt="Dream India Realty" width="230" height="60"><span>ERP${sub ? ' · ' + esc(sub) : ''}</span></div>`;
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
    if (me.role === 'consultant') { location.replace('/drawings'); return; } // consultants see the drawings only
    shell();
  }

  function noDb() {
    app.innerHTML = `<div class="center"><div class="card wide">
      <div class="brandline">${logo}<div><b>Dream India ERP</b></div></div>
      <h1>The database is not connected yet</h1>
      <p class="muted">The ERP is installed, but it has no database to store data in.</p>
      <p>In Vercel, open the <b>dream-india-erp</b> project → <b>Storage</b> → <b>Create Database</b> → <b>Neon</b>, and connect it to all environments. Then reload this page.</p>
    </div></div>`;
  }

  function setup(codeRequired) {
    app.innerHTML = `<div class="center"><form class="card" id="f">
      ${brand('First-time setup')}
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
      ${brand()}
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
      ${brand(me.name)}
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
  async function signOut() { await api('/api/session', { action: 'logout' }).catch(() => {}); chat.unmount(); me = null; location.hash = ''; start(); }

  // ---------- shell ----------
  const anyOf = (...ps) => ps.some(can);
  const sec = (m) => !!me && (me.sections || []).includes(m);
  const PAGES = [
    { key: 'home', label: 'Home', show: () => true },
    { key: 'mgmt', label: 'Management dashboard', show: () => can('mgmt.view') },
    { key: 'training', label: 'Training videos', show: () => true },
    { group: 'CRM' },
    { key: 'crmtodo', label: 'Today', show: () => anyOf('demand.raise', 'booking.create', 'booking.approve', 'ledger.view') },
    { key: 'flats', label: 'Flats & buyers', show: () => anyOf('inventory.view', 'ledger.view') },
    { key: 'units', label: 'Book a flat (inventory)', show: () => can('inventory.view') },
    { key: 'receipts', label: 'Receipts', show: () => anyOf('receipt.enter', 'receipt.approve', 'ledger.view') },
    { key: 'sc-appr', label: 'Bookings & approvals', show: () => anyOf('inventory.view', 'ledger.view'), href: () => '#/flats?f=approval' },
    { key: 'comms', label: 'Inbox', show: () => can('ledger.view') },
    { key: 'team', label: 'Dream Chat', show: () => anyOf('ledger.view', 'receipt.enter') && !(can('accounts.enter') && !can('demand.raise') && !can('booking.create')) },
    { group: 'CRM tools' },
    { key: 'collections', label: 'Collections', show: () => can('ledger.view') },
    { key: 'demands', label: 'Stages & demands', show: () => anyOf('demand.raise', 'demand.approve', 'stage.record', 'ledger.view') },
    { key: 'letters', label: 'Demand letters (many flats)', show: () => anyOf('demand.raise', 'ledger.view') },
    { key: 'prices', label: 'Price list & cost sheet', show: () => can('inventory.view') },
    { key: 'partners', label: 'Channel partner ledger', show: () => can('ledger.view') },
    { key: 'verify', label: 'Data to verify', show: () => anyOf('inventory.view', 'ledger.view') },
    { key: 'custdocs', label: 'Customer documents', show: () => anyOf('buyer.kyc', 'accounts.view') || can('users.manage') },
    // the old lists, now all in Flats & buyers and the flat file; still open from old links
    { key: 'bookings', label: 'Bookings', show: () => false },
    { key: 'ledgers', label: 'Customer ledgers', show: () => false },
    { key: 'followups', label: 'Follow-ups', show: () => false },
    { group: 'Accounts' },
    { key: 'acctodo', label: 'Today', show: () => can('accounts.view') },
    { key: 'acc-bank', label: 'Bank', show: () => can('accounts.view'), href: () => '#/balances' },
    { key: 'acc-money', label: 'Receipts & payments', show: () => can('accounts.view'), href: () => '#/reg-receipts' },
    { key: 'accteam', label: 'Dream Chat', show: () => can('accounts.view') },
    { key: 'acc-tax', label: 'Tax & compliance', show: () => can('accounts.view'), href: () => '#/reg-tds' },
    { key: 'acc-sra', label: 'SRA tenants', show: () => can('accounts.view'), href: () => '#/reg-tenants' },
    { key: 'accdash', label: 'Accounts dashboard', show: () => can('accounts.view') },
    // the pages inside those tiles (reached through the tabs at the top of each)
    { key: 'balances', label: 'Daily Bank Balance', show: () => can('accounts.view'), sub: true },
    { key: 'bankauto', label: 'Bank Auto Check', show: () => can('accounts.view'), sub: true },
    { key: 'reg-recon', label: 'Reconciling Items', show: () => can('accounts.view'), sub: true },
    { key: 'reg-receipts', label: 'Receipts (bank)', show: () => can('accounts.view'), sub: true },
    { key: 'reg-payments', label: 'Payments Out', show: () => can('accounts.view'), sub: true },
    { key: 'reg-pdc', label: 'PDC', show: () => can('accounts.view'), sub: true },
    { key: 'reg-tds', label: 'TDS Tracker', show: () => can('accounts.view'), sub: true },
    { key: 'sdr', label: 'SDR challans', show: () => can('accounts.view'), sub: true },
    { key: 'reg-compliance', label: 'Compliance Calendar', show: () => can('accounts.view'), sub: true },
    { key: 'reg-tenants', label: 'SRA Tenants', show: () => can('accounts.view'), sub: true },
    { key: 'reg-rentLinks', label: 'Tenant Rent Links', show: () => can('accounts.view'), sub: true },
    { key: 'reg-cancellations', label: 'Cancelled flats & refunds', show: () => can('accounts.view') },
    { key: 'cpacc', label: 'Channel partner ledger', show: () => can('accounts.view') && can('ledger.view'), href: () => '#/partners' },
    { key: 'accreports', label: 'Reports & Tally', show: () => can('accounts.view') },
    { key: 'checks', label: 'Checks', show: () => can('accounts.view') },
    { key: 'bookscrm', label: 'Tally vs CRM', show: () => anyOf('accounts.view', 'ledger.view') },
    { key: 'ca', label: 'CA / Tax', show: () => can('ca.view') },
    { key: 'accsetup', label: 'Banks, heads & import', show: () => can('accounts.manage') },
    { group: 'Site & purchase' },
    { key: 'site', label: 'Construction (Site Office)', show: () => sec('site'), href: () => '/site' },
    { key: 'purchase', label: 'Purchase', show: () => sec('purchase'), href: () => '/purchase' },
    { key: 'drawings', label: 'Drawings', show: () => sec('drawings'), href: () => '/drawings' },
    { key: 'hr', label: 'HR & Admin', show: () => sec('hr'), href: () => '/hr' },
    { group: 'Set-up' },
    { key: 'projects', label: 'Companies & projects', show: () => true },
    { key: 'plans', label: 'Payment plans', show: () => true },
    { key: 'import', label: 'Import from CRM sheet', show: () => can('users.manage') },
    { key: 'users', label: 'Logins', show: () => can('users.manage') },
    { key: 'audit', label: 'Audit log', show: () => can('audit.view') },
  ];
  const DETAIL = { booking: 'flats', statement: 'flats', run: 'demands', bankauto: 'bankauto', project: 'home', team: 'team', accteam: 'accteam', cp: 'partners' };
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
      if (p.sub) continue;
      out += `<a href="${p.href ? p.href() : '#/' + p.key}" class="${p === cur || p.key === hubOf(cur.key) ? 'on' : ''}">${esc(p.label)}</a>`;
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

  // Short addresses to share with staff (erp…/crm, /finance …): opened once, then the page carries on as usual.
  const SHORT = { '/crm': '#/project/{p}/crm', '/finance': '#/project/{p}/accounts', '/audit': '#/project/{p}/audit', '/construction': '#/project/{p}/construction', '/training': '#/training', '/home': '#/home', '/management': '#/mgmt' };
  async function shell() {
    if (!projectList) projectList = (await api('/api/masters')).projects.filter((p) => p.active);
    const short = SHORT[location.pathname.replace(/\/$/, '')];
    if (short) { const sig = projectList.find((p) => p.code === 'SIGNATURE') || projectList[0] || { id: 1 }; history.replaceState(null, '', '/' + short.replace('{p}', sig.id)); }
    if (!proj || !projectList.some((p) => p.id === proj)) proj = +(store.get('erp_project') || 0) || null;
    if (!projectList.some((p) => p.id === proj)) proj = (projectList.find((p) => p.code === 'SIGNATURE') || projectList[0] || {}).id || null;
    const [page, arg] = location.hash.replace('#/', '').split('?')[0].split('/');
    const visible = PAGES.filter((p) => p.group || p.show());
    const nav = visible.filter((p, i) => !p.group || (visible[i + 1] && !visible[i + 1].group));
    const curKey = DETAIL[page] || page || 'home';
    const cur = PAGES.find((p) => p.key === curKey && p.show()) || PAGES[0];
    app.innerHTML = `<div class="shell">
      <nav class="side no-print">
        <a class="logo" href="#/home">${wordmark}<div><b>ERP</b></div></a>
        ${navHtml(nav, cur)}
      </nav>
      <div class="main">
        <div class="top no-print"><div class="who">${projectList.length > 1 ? `<select id="proj" class="proj">${projectList.map((p) => `<option value="${p.id}" ${p.id === proj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : `<b>${esc(projectList[0]?.name || '')}</b>`}</div>
          <div class="who"><span><b>${esc(me.name)}</b> · ${esc(me.roleLabel)}</span>
            ${installButton()}<button class="ghost small" id="cpw">Change password</button><button class="ghost small" id="out">Sign out</button></div></div>
        ${(() => { const g = groupOf(DETAIL[page] && arg ? DETAIL[page] : cur.key), dest = { CRM: [`#/project/${proj}/crm`, 'Sales & CRM'], 'CRM tools': [`#/project/${proj}/crm`, 'Sales & CRM'], Accounts: [`#/project/${proj}/accounts`, 'Accounts'], 'Site & purchase': [`#/project/${proj}/construction`, 'Construction'], 'Set-up': ['#/home', 'Home'] }[g];
          return dest && proj && !['home', 'project'].includes(page || 'home') ? `<div class="crumb no-print"><a href="${dest[0]}">← ${esc(dest[1])}</a>${dest[0] === '#/home' ? '' : '<a href="#/home">Home</a>'}</div>` : ''; })()}
        ${hubTabs(cur.key)}<div class="page" id="page"><p class="muted">Loading…</p></div>
      </div></div>`;
    wireNav();
    document.querySelectorAll('[data-hub]').forEach((b) => (b.onclick = () => go('#/' + b.dataset.hub)));
    chat.mount();
    if (anyOf('accounts.enter', 'receipt.approve')) api('/api/receipts?todeposit=1').then((r) => { if (r.n && $('.top .who:last-child')) $('.top .who:last-child').insertAdjacentHTML('afterbegin', `<a class="mbadge dep" href="#/receipts?t=cheques" title="Cheques the CRM has entered that are not deposited yet">🏦 ${r.n} cheque${r.n === 1 ? '' : 's'} to deposit</a>`); }).catch(() => {});
    if (can('ledger.view')) mailWatch.paint();
    $('#out').onclick = signOut;
    wireInstall();
    $('#cpw').onclick = () => changePassword(false);
    if ($('#proj')) $('#proj').onchange = (e) => { proj = +e.target.value; store.set('erp_project', proj); shell(); };
    if (/^reg-/.test(page || '') && can('accounts.view')) { try { await accRegister(page.slice(4)); } catch (e) { $('#page').innerHTML = `<div class="err">${esc(e.message)}</div>`; } return; }
    const fn = { home, mgmt, ca: caPage, accdash, collections, flats, custdocs, comms, team: teamPage, accteam: teamPage, sdr: sdrPage, cp: cpPage, project: projectHome, crmtodo: () => dailyTodo('crm'), acctodo: () => dailyTodo('accounts'), training, projects, plans, users, audit, units, bookings, demands, receipts, ledgers, letters, followups, verify, prices, partners, balances: accBalances, bankauto: bankAuto, bookscrm: booksCrm, accreports: accReports, checks: accChecks, accsetup: accSetup, import: importPage, booking: bookingPage, statement: statementPage, run: runPage };
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
    dashboard: 'Daily collections, dues, tower status, channel partners', collections: 'Today’s and this month’s collections, what is due and coming in, wing by wing', units: 'Every unit, floor by floor, both wings side by side',
    bookings: 'Bookings, applicants, cancellations and transfers', demands: 'Construction stages and the demands raised on them',
    receipts: 'Enter receipts; Head Accounts approves them', ledgers: 'Each buyer’s statement of demands and payments',
    letters: 'Stage demands and reminders, by email or courier', followups: 'Calls, WhatsApps and promises to pay',
    comms: 'Buyers\' email replies and WhatsApps, and messages to link to a flat', team: 'Dream Chat: CRM and Accounts, about a flat or a cheque', accteam: 'Dream Chat: CRM and Accounts, about a flat or a cheque', custdocs: 'Signed and scanned papers for every flat and SRA tenant, kept in Google Drive', verify: 'Items from the import still to check and close', prices: 'Rates, floor rise and the cost sheet', partners: 'Each partner firm: brokerage, bills, pass back, payments and balance',
    site: 'Slab cycle, daily progress reports, hindrances, materials and floor-wise works', purchase: 'Purchase requests from request to payment', drawings: 'The drawing register from Google Drive', hr: 'Staff records, leave, letters and HR policies',
    crmtodo: 'Today’s calls, approvals, letters and what the 9 am check found', flats: 'Every flat and buyer. Open one to see payments, calls, messages and documents in one place',
    'sc-calls': 'Who to call today, broken promises to pay, and buyers never called', 'sc-dues': 'Every buyer with an overdue amount; open one for the full ledger and statement',
    'sc-appr': 'New bookings, cancellations and transfers waiting for approval',
    'acc-bank': 'Daily bank balance, the 3:10 pm statement check and reconciling items', 'acc-money': 'Receipts into the bank, payments out and post-dated cheques',
    'acc-tax': 'TDS challans, SDR challans and the compliance calendar', 'acc-sra': 'SRA tenants, their rent and the rent payment links', acctodo: 'What the 9 am Accounts audit found, plus your own tasks',
    training: 'Short videos on how to use each part of the ERP',
    accdash: 'Bank balances, collections, refunds, TDS, PDC, SRA tenants and reconciliation',
    balances: 'Closing balance of every bank account, day by day', bankauto: 'The 3:10 pm check of bank statements against the books',
    'reg-receipts': 'Every receipt as it came into the bank', 'reg-payments': 'Every payment out, by head', 'reg-pdc': 'Post-dated cheques and their reminders',
    'reg-tds': 'TDS deducted and challans paid', sdr: 'Stamp duty and registration challans, one per flat (a second one is blocked)', 'reg-recon': 'Items the bank and the books do not yet agree on', 'reg-compliance': 'GST, TDS and RERA due dates',
    'reg-tenants': 'SRA tenants and their rent', 'reg-rentLinks': 'Rent payment links for each tenant', 'reg-cancellations': 'Cancelled flats and refunds still to pay',
    accreports: 'Reports and the Tally import', checks: 'Daily checks on the registers', bookscrm: 'Tally receipts flat by flat against the CRM',
    ca: 'GST, TDS payable, RERA quarterly and cash flow, for the CA', accsetup: 'Bank accounts, heads, statement folders and imports', audit: 'Who changed what, and when',
  };
  const PICON = { 'acc-bank': 'rupee', 'acc-money': 'book', 'acc-tax': 'check', 'acc-sra': 'users', collections: 'chart', flats: 'users', 'sc-calls': 'phone', 'sc-dues': 'book', 'sc-appr': 'check', comms: 'mail', team: 'users', accteam: 'users', sdr: 'rupee', custdocs: 'book', site: 'tower', crmtodo: 'check', acctodo: 'check', training: 'book', dashboard: 'chart', units: 'grid', bookings: 'book', demands: 'tower', receipts: 'rupee', ledgers: 'book', letters: 'mail', followups: 'phone', verify: 'check', prices: 'rupee', partners: 'users',
    accdash: 'chart', balances: 'rupee', bankauto: 'check', 'reg-cancellations': 'users', bookscrm: 'check', checks: 'check', audit: 'book', ca: 'chart', accsetup: 'grid' };
  const DEPTS = [
    { key: 'crm', title: 'Sales & CRM', sub: 'Today’s work, every flat and buyer in one place, receipts, collections and the inbox', icon: 'chart', tone: '#2B5C8A', group: 'CRM', more: 'CRM tools',
      sections: [['Every day', ['crmtodo', 'flats', 'receipts', 'comms', 'team']], ['Sales', ['units', 'sc-appr', 'prices', 'partners']],
        ['Collections', ['collections', 'demands', 'letters']], ['Records and checks', ['custdocs', 'verify']]] },
    { key: 'construction', title: 'Construction', sub: 'Site Office: slab cycle, daily progress reports, hindrances, materials and stages', icon: 'hammer', tone: '#B7791F', pages: ['site', 'demands'], later: ['Contractor billing'] },
    { key: 'accounts', title: 'Accounts', sub: 'Bank, receipts, payments, PDC, TDS, SRA rent, GST, SDR and Tally', icon: 'book', tone: '#117A65', group: 'Accounts', skip: ['ca', 'bookscrm', 'checks'],
      sections: [['Every day', ['acctodo', 'acc-bank', 'acc-money', 'accteam']], ['Taxes & compliance', ['acc-tax']], ['Refunds, partners & tenants', ['reg-cancellations', 'cpacc', 'acc-sra']], ['Reports & set-up', ['accdash', 'accreports', 'accsetup']]] },
    { key: 'audit', title: 'CRM/Accounts Audit', sub: 'Tally against the CRM, checks, reconciling items and cancelled flats', icon: 'check', tone: '#0E8C9B', pages: ['bookscrm', 'checks', 'reg-recon', 'reg-cancellations', 'verify', 'audit'] },
    { key: 'cpdept', title: 'Channel Partners', sub: 'Every partner firm: brokerage earned, bills, pass back, payments and what is still owed', icon: 'users', tone: '#0E8C9B', direct: 'partners' },
    { key: 'ca', title: 'CA / Tax', sub: 'GST, TDS payable, RERA quarterly, cash flow and compliance', icon: 'chart', tone: '#7A5C99', direct: 'ca' },
    { key: 'purchase', title: 'Purchase', sub: 'Requests, approvals, orders, receipts at site and payment for RMC, steel, cement and more', icon: 'cart', tone: '#117A65', direct: 'purchase' },
    { key: 'drawings', title: 'Drawings', sub: 'Architect, structural and MEP drawings from the Site Plans folder', icon: 'grid', tone: '#2B5C8A', direct: 'drawings' },
    { key: 'training', title: 'Training videos', sub: 'Short videos on how to use each part of the ERP', icon: 'book', tone: '#B7791F', direct: 'training' },
  ];
  const HUBS = {
    'acc-bank': ['Bank', [['balances', 'Daily Bank Balance'], ['bankauto', 'Bank Auto Check'], ['reg-recon', 'Reconciling Items']]],
    'acc-money': ['Receipts & payments', [['reg-receipts', 'Receipts (bank)'], ['reg-payments', 'Payments Out'], ['reg-pdc', 'PDC']]],
    'acc-tax': ['Tax & compliance', [['reg-tds', 'TDS Tracker'], ['sdr', 'SDR challans'], ['reg-compliance', 'Compliance Calendar']]],
    'acc-sra': ['SRA tenants', [['reg-tenants', 'Tenants'], ['reg-rentLinks', 'Rent links']]],
  };
  const hubOf = (key) => Object.keys(HUBS).find((h) => HUBS[h][1].some(([k]) => k === key));
  const hubTabs = (key) => { const h = hubOf(key); if (!h) return '';
    return `<nav class="ff-tabs hubtabs no-print" role="tablist" aria-label="${esc(HUBS[h][0])}">${HUBS[h][1].map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === key}" data-hub="${k}">${esc(l)}</button>`).join('')}</nav>`; };
  const pagesOf = (d) => {
    let keys = d.pages;
    if (d.group) { keys = []; let g = null; for (const p of PAGES) { if (p.group) g = p.group; else if (g === d.group && !p.sub && !(d.skip || []).includes(p.key)) keys.push(p.key); } }
    return (keys || []).map((k) => PAGES.find((p) => p.key === k)).filter((p) => p && p.show());
  };
  const hrefOf = (p) => (p.href ? p.href() : '#/' + p.key);
  const heroHtml = (eyebrow, title, sub, back) => `<div class="hero"><div class="hero-in">${back ? `<a class="back" href="${esc(back[0])}">← ${esc(back[1])}</a>` : ''}<span class="eyebrow">${esc(eyebrow)}</span>
      <h1>${esc(title)}</h1><p>${esc(sub)}</p></div></div>`;
  const projSub = (p) => {
    const total = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    const floors = Math.max(0, ...p.buildings.map((b) => +b.floors || +b.top_floor || 0));
    const u = p.units || {}, n = total(u) - (u.refuge || 0) - (u.society || 0) - (u.rehab || 0), sold = (u.booked || 0) + (u.registered || 0);
    return [p.location, p.buildings.length ? `${p.buildings.length} tower${p.buildings.length > 1 ? 's' : ''}${floors ? ' of ' + floors + ' floors' : ''}` : '', n ? `${sold} of ${n} saleable flats sold` : 'no units yet'].filter(Boolean).join(' · ');
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
      sec('hr') ? { title: 'HR & Admin', sub: 'Staff records, leave, letters and HR policies', icon: 'users', tone: '#7A5C99', href: '/hr' } : { title: 'HR & Admin', sub: 'Staff records, leave, letters and HR policies', icon: 'users', tone: '#7A5C99', soon: true },
    ];
    const sample = can('users.manage') && cur && (!total(cur.units) || cur.sample) ? `<div class="panel"><h2>Sample data for testing</h2>
      <p class="muted">Loads Dream Signature A and B Wing (floors 10 to 45, 8 units a floor) with made-up "Sample Buyer" bookings, demands up to the stages the real project has reached, and receipts. It never touches real data and can be removed in one click.</p>
      <div class="actions">${total(cur.units) ? '<button class="danger" id="clearSample">Remove sample data</button>' : '<button id="loadSample">Load sample data</button>'}</div></div>` : '';
    $('#page').innerHTML = heroHtml(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
        `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${first ? ', ' + first : ''}`, 'Your projects and tools in one place. Tap a tile to open it.') + `
      <div class="hm">
        ${can('mgmt.view') ? `<section class="hgroup"><h2>Management</h2><div class="tiles">${tile({ title: 'Management dashboard', sub: 'Cash, collections, dues, site, purchase, approvals, compliance and taxes on one screen', icon: 'chart', tone: '#140C59', href: '#/mgmt' })}</div></section>` : ''}
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
      if (dept.sections) {
        const pg = (k) => PAGES.find((x) => x.key === k && !x.group && x.show());
        const secs = dept.sections.map(([h, keys]) => [h, keys.map(pg).filter(Boolean).map((x) => ({ title: x.label, sub: SUB[x.key] || '', icon: PICON[x.key] || dept.icon, tone: dept.tone, href: hrefOf(x) }))]).filter(([, t]) => t.length);
        $('#page').innerHTML = heroHtml(p.name, dept.title, dept.sub, [`#/project/${p.id}`, p.name]) + `<div class="hm">${secs.map(([h, t]) => `<section class="hgroup"><h2>${esc(h)}</h2><div class="tiles five">${t.map(tile).join('')}</div></section>`).join('') || '<p class="muted">Your login has no pages in this section.</p>'}</div>`;
        return;
      }
      const extra = dept.more ? pagesOf({ group: dept.more }).map((pg) => ({ title: pg.label, sub: SUB[pg.key] || '', icon: PICON[pg.key] || dept.icon, tone: '#6B7280', href: hrefOf(pg) })) : [];
      $('#page').innerHTML = heroHtml(p.name, dept.title, dept.sub, [`#/project/${p.id}`, p.name]) + `<div class="hm"><section class="hgroup"><h2>${dept.more ? 'Daily work' : 'Pages'}</h2><div class="tiles five">${tiles.map(tile).join('') || '<p class="muted">Your login has no pages in this section.</p>'}</div></section>
        ${extra.length ? `<section class="hgroup more"><h2>${esc(dept.more)} <span class="muted small" style="font-weight:400">· set-up and work on many flats at once</span></h2><div class="tiles small">${extra.map(tile).join('')}</div></section>` : ''}</div>`;
      return;
    }
    const tiles = DEPTS.map((x) => {
      if (x.soon) return { ...x };
      if (x.direct) { const pg = PAGES.find((q) => q.key === x.direct); return pg && pg.show() ? { ...x, href: hrefOf(pg) } : null; }
      const pgs = pagesOf(x).concat(x.more ? pagesOf({ group: x.more }) : []);
      if (!pgs.length) return x.later ? { ...x, soon: true } : null;
      return { ...x, href: `#/project/${p.id}/${x.key}` };
    }).filter(Boolean);
    $('#page').innerHTML = heroHtml('Project', p.name, projSub(p), ['#/home', 'Home']) + `<div class="hm"><section class="hgroup"><h2>Departments</h2><div class="tiles five">${tiles.map(tile).join('')}</div></section></div>`;
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
      <label>Own email (where this person is told about buyers' replies)</label><input name="email" type="email" value="${esc(u?.email)}" maxlength="120" placeholder="e.g. ayesha@dreamindiagroup.com">
      <label>Designation (shown under the name in emails to buyers)</label><input name="designation" value="${esc(u?.designation)}" maxlength="80" placeholder="e.g. Senior Executive – Customer Relations">
      <label>Projects</label>
      <label class="check"><input type="checkbox" name="allProjects" ${u?.all_projects ? 'checked' : ''}> All projects, including future ones</label>
      ${d.projects.map((p) => `<label class="check"><input type="checkbox" name="p${p.id}" ${u?.projects.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}`;
    const pick = (x) => ({ name: x.name, username: x.username, role: x.role, phone: x.phone, designation: x.designation, email: x.email, allProjects: x.allProjects === 'on', projects: d.projects.filter((p) => x['p' + p.id] === 'on').map((p) => p.id) });
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
    if (me.role === 'admin') portalCopyPanel();
  }
  // Copy from the staff portal: logins (same usernames and passwords), HR & Admin, Purchase and Construction.
  async function portalCopyPanel() {
    const box = document.createElement('div'); box.className = 'panel'; box.innerHTML = '<h2>Copy from the staff portal</h2><p class="muted">Checking the portal\'s database…</p>';
    $('#page').appendChild(box);
    let st; try { st = await api('/api/portal?copy=1'); } catch (e) { box.querySelector('p').textContent = e.message; return; }
    if (!st.connected) { box.querySelector('p').textContent = st.hint; return; }
    if (st.found === false) { box.querySelector('p').textContent = st.error; return; }
    box.innerHTML = `<h2>Copy from the staff portal</h2><p class="muted">The portal's database is connected${st.readOnly ? ' (read only)' : ''}. It has <b>${st.users}</b> logins, and ${Object.entries(st.sections).map(([k, v]) => `${esc(k)} (${v} lists)`).join(', ')}.
      Copying brings every login across with the <b>same username and password</b>, and replaces the ERP's HR, Purchase and Construction records with the portal's. The portal itself is not changed. Run it again on switch-over day for a fresh copy.</p>
      <div class="actions"><button id="pcopy">Copy now</button></div><div id="pres"></div>`;
    if (!box.isConnected) return;
    box.querySelector('#pcopy').onclick = async (e) => {
      if (!confirm('Copy the logins, HR, Purchase and Construction from the portal now?')) return;
      e.target.disabled = true; e.target.textContent = 'Copying… (up to a minute)';
      try {
        const r = await api('/api/portal?copy=1', { go: true });
        box.querySelector('#pres').innerHTML = `<p class="ok">Copied. Logins: ${r.users.added} added, ${r.users.updated} updated${r.users.skipped.length ? `, ${r.users.skipped.length} not copied: ${esc(r.users.skipped.join('; '))}` : ''}. Records: ${Object.entries(r.copied).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}.</p>`;
        e.target.textContent = 'Copy again'; e.target.disabled = false;
      } catch (x) { e.target.disabled = false; e.target.textContent = 'Copy now'; box.querySelector('#pres').innerHTML = `<p class="err">${esc(x.message)}</p>`; }
    };
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
  function toast(msg, ms) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms || 4000); }
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
      const ns = list.filter((u) => ['refuge', 'society', 'rehab'].includes(u.status)).length;
      return `<div class="panel tower">${shown.length > 1 ? `<h2>${esc(b.name)} <span class="muted small">${list.length - ns} saleable flats${ns ? ` (+ ${ns} refuge / society, not for sale)` : ''}</span></h2>` : ''}${legend(list)}
        ${floors.length ? `<div class="floors">${floors.map((f) => `<div class="floor"><span class="fl">${f}</span>${list.filter((u) => u.floor === f).map(cell).join('')}</div>`).join('')}</div>` : '<p class="muted">No units yet in this building.' + (can('users.manage') ? ' For testing, load sample data from the Home page, or import from the CRM sheet.' : '') + '</p>'}</div>`;
    };
    $('#page').innerHTML = `<div class="page-head"><div><h1>Units & inventory</h1><p class="muted">Every unit, floor by floor. A red corner means the buyer has overdue dues.</p></div>
      ${can('inventory.edit') && bld ? '<div class="actions" style="margin:0"><button class="ghost" id="gen">Add units</button></div>' : ''}</div>
      <div class="tabs">${sideBySide.length > 1 ? `<button class="tab ${!one ? 'on' : ''}" data-b="0">All wings</button>` : ''}${blds.map((b) => `<button class="tab ${b === one || (!one && shown.length === 1 && b === shown[0]) ? 'on' : ''}" data-b="${b.id}">${esc(b.name)}</button>`).join('')}</div>
      ${salesStrip(d.summary)}
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
  // ---------- flats & buyers: the one list of every flat and buyer; each row opens the flat file ----------
  async function flats() {
    if (!proj) return noProject();
    const [B, F, DB] = await Promise.all([api(`/api/bookings?project=${proj}`), can('ledger.view') ? api(`/api/followups?project=${proj}`).catch(() => ({ rows: [] })) : { rows: [] },
      can('ledger.view') ? api(`/api/dashboard?project=${proj}`).catch(() => null) : null]);
    const fu = new Map(F.rows.map((r) => [r.booking_id, r]));
    // the same lists the Collections figures count (worked out in lib/dashboard.js), by flat
    const inList = (k) => new Set(((DB && DB.actions && DB.actions[k]) || []).map((x) => String(x.unit).toUpperCase()));
    const L = { def: inList('defaulters'), tds: inList('tdsPending'), reg: inList('registrationPending') };
    const rows = B.rows.map((r) => { const u = String(r.unit_no).toUpperCase(), live = r.status === 'active'; return { ...r, f: fu.get(r.id), def: live && L.def.has(u), tdsOnly: live && L.tds.has(u), regPend: live && L.reg.has(u) }; });
    const req = (r) => r.status === 'active' && (r.cancel_requested_at || r.transfer_requested_at);
    const SETS = [
      ['bookings', 'All bookings', () => true, 'Every booking: active, waiting for approval, cancelled and transferred'],
      ['call', 'Call today', (r) => r.f && r.f.due, 'Buyers with dues whose next call is today or earlier'],
      ['broken', 'Broken promises', (r) => r.f && r.f.broken, 'They promised to pay by a date that has passed'],
      ['never', 'Never called', (r) => r.f && !r.f.count, 'Buyers with dues nobody has called yet'],
      ['overdue', 'Overdue', (r) => r.status === 'active' && toNum(r.overdue) > 0, 'Every buyer with an overdue amount'],
      ['defaulters', 'Defaulters', (r) => r.def, 'Buyers marked Defaulter on their follow-up'],
      ['tds', 'TDS due only', (r) => r.tdsOnly, 'Only the 1% TDS is left to collect'],
      ['regpending', 'Registration pending', (r) => r.regPend, 'Booked, but the agreement is not registered yet'],
      ['approval', 'Waiting for approval', (r) => r.status === 'pending' || req(r), 'New bookings, cancellations and transfers to approve'],
      ['closed', 'Cancelled / transferred', (r) => ['cancelled', 'rejected', 'transferred'].includes(r.status), 'Kept on record'],
    ];
    const qf = (location.hash.split('?')[1] || '').match(/f=(\w+)/);
    // opens on All bookings; a filter is a click away (and the To-Do and dashboard links open one directly)
    let f = (qf && qf[1]) || 'bookings';
    if (f === 'all') f = 'bookings';
    if (!SETS.some(([k]) => k === f)) f = 'bookings';
    const cur = SETS.find(([k]) => k === f);
    // one person's own list (from their Today task): flats given to them, else their wing's flats
    const qw = (location.hash.split('?')[1] || '').match(/who=(\d+)/);
    const T = qw ? await api('/api/comms?status=1').catch(() => null) : null;
    const whoId = qw ? +qw[1] : null, myWings = whoId && T && T.teams ? Object.keys(T.teams).filter((w) => (T.teams[w] || []).map(Number).includes(whoId)) : [];
    const mine = (r) => !whoId || (r.crm_user_id ? r.crm_user_id === whoId : myWings.includes(r.building));
    const list = rows.filter(cur[2]).filter(mine).sort((a, b) => (f === 'bookings' || f === 'closed' || f === 'approval' ? a.unit_no.localeCompare(b.unit_no, 'en', { numeric: true }) : toNum(b.overdue) - toNum(a.overdue)));
    const todo = (r) => r.status === 'pending' ? '<span class="pill">needs approval</span>' : r.cancel_requested_at && r.status === 'active' ? '<span class="pill bad">cancel requested</span>' : r.transfer_requested_at && r.status === 'active' ? '<span class="pill warn">transfer requested</span>'
      : r.status !== 'active' ? `<span class="pill grey">${esc(r.status)}</span>` : f === 'regpending' && r.reg_next ? `<span class="pill warn">next: ${esc(r.reg_next)}</span>` : r.def ? '<span class="pill bad">defaulter</span>' : r.f && r.f.broken ? '<span class="pill bad">promise broken</span>' : r.f && r.f.due ? '<span class="pill warn">call today</span>' : toNum(r.overdue) > 0 ? '<span class="pill warn">overdue</span>' : '<span class="pill good">on track</span>';
    $('#page').innerHTML = `<div class="page-head"><div><h1>Flats &amp; buyers</h1><p class="muted">Every flat and buyer in one list. Open a flat to see and do everything for it: payments, calls, messages, documents and history.</p></div>
      ${can('booking.create') ? '<div class="actions" style="margin:0"><a class="btn" href="#/units">+ Book a flat</a></div>' : ''}</div>
      <div class="chips">${SETS.map(([k, l, fn, hint]) => { const n = rows.filter(fn).filter(mine).length; return `<button type="button" class="chip ${k === f ? 'on' : ''} ${['call', 'broken'].includes(k) && n ? 'hot' : ''}" data-f="${k}" title="${esc(hint)}">${l} <b>${n}</b></button>`; }).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search a flat number, buyer name or phone" autofocus>
      <p class="small muted" style="margin:4px 0 10px">${esc(cur[3])} · ${list.length} flat${list.length === 1 ? '' : 's'}${whoId ? ` · <b>${esc(((T && T.crmUsers) || []).find((x) => x.id === whoId)?.name || 'one person')}'s list</b>${myWings.length ? ' (wing ' + myWings.join(', ') + ')' : ''} · <a href="#/flats?f=${f}">show everyone</a>` : ''}</p>
      <table class="flats"><tr><th>Flat</th><th>Buyer</th><th>Status</th><th class="num">Balance due</th><th class="num">Overdue</th><th>Last contact</th><th>Next call</th><th>Contact</th></tr>
      ${list.map((r) => `<tr class="click" data-b="${r.id}" data-s="${esc((r.unit_no + ' ' + (r.buyers || '') + ' ' + (r.f && r.f.mobile || '')).toLowerCase())}">
        <td><b>${esc(r.unit_no)}</b>${r.sample ? ' <span class="pill grey">sample</span>' : ''}</td><td>${esc(r.buyers || '')}</td><td>${todo(r)}</td>
        <td class="num">${inr(r.outstanding)}</td><td class="num ${toNum(r.overdue) > 0 ? 'bad-t' : ''}">${toNum(r.overdue) > 0 ? inr(r.overdue) : '—'}</td>
        <td class="small">${r.f && r.f.count ? `${fmtD(r.f.last_at.slice(0, 10))} · ${esc(r.f.outcome || r.f.kind || '')}` : r.f ? '<span class="muted">never</span>' : ''}</td>
        <td class="small">${r.f && r.f.next_date ? fmtD(r.f.next_date) : ''}${r.f && r.f.promise_date ? `<br><span class="muted">promised ${fmtD(r.f.promise_date)}</span>` : ''}</td>
        <td class="small" style="white-space:nowrap">${r.f && r.f.mobile && r.f.wa ? `<a href="tel:+91${esc(r.f.mobile)}" data-stop>Call</a> · <a href="${esc(r.f.wa)}" target="_blank" rel="noopener" data-stop>WhatsApp</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.chip[data-f]').forEach((x) => (x.onclick = () => { history.replaceState(null, '', (x.dataset.f === 'bookings' ? '#/flats' : '#/flats?f=' + x.dataset.f) + (whoId ? (x.dataset.f === 'bookings' ? '?' : '&') + 'who=' + whoId : '')); flats(); }));
    document.querySelectorAll('tr[data-b]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-stop]')) return; go(`#/booking/${tr.dataset.b}`); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase().trim(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
  }

  async function bookings() {
    if (!proj) return noProject();
    const d = await api(`/api/bookings?project=${proj}`);
    const tab = store.get('erp_btab') || 'pending';
    const sets = {
      pending: d.rows.filter((r) => r.status === 'pending'),
      cancel: d.rows.filter((r) => r.status === 'active' && (r.cancel_requested_at || r.transfer_requested_at)),
      active: d.rows.filter((r) => r.status === 'active'),
      closed: d.rows.filter((r) => ['cancelled', 'rejected', 'transferred'].includes(r.status)),
    };
    const labels = { pending: 'Waiting for approval', cancel: 'Cancellation / transfer requests', active: 'Active', closed: 'Cancelled / transferred / rejected' };
    const rows = sets[tab] || sets.active;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Bookings</h1><p class="muted">New bookings wait for Head CRM approval; the person who entered one cannot approve it.</p></div>
      ${can('booking.create') ? '<div class="actions" style="margin:0"><button id="new">New booking</button></div>' : ''}</div>
      <div class="tabs">${Object.keys(labels).map((k) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${labels[k]} <span class="count">${sets[k].length}</span></button>`).join('')}</div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table id="tbl"><tr><th>Unit</th><th>Buyer</th><th>Booked</th><th class="num">Agreement value</th><th class="num">Outstanding</th><th class="num">Overdue</th><th>Entered by</th><th></th></tr>
      ${rows.map((r) => `<tr class="click" data-b="${r.id}" data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}"><td><b>${esc(r.unit_no)}</b>${r.sample ? ' <span class="pill grey">sample</span>' : ''}</td><td>${esc(r.buyers || '')}</td><td>${fmtD(r.booking_date)}</td>
        <td class="num">${inr(r.agreement_value)}</td><td class="num">${inr(r.outstanding)}</td><td class="num ${toNum(r.overdue) > 0 ? 'bad-t' : ''}">${inr(r.overdue)}</td><td>${esc(r.created_by_name || 'Import / sample')}</td>
        <td class="num">${r.status === 'pending' ? '<span class="pill">needs approval</span>' : r.cancel_requested_at && r.status === 'active' ? '<span class="pill bad">cancel requested</span>' : r.transfer_requested_at && r.status === 'active' ? '<span class="pill warn">transfer requested</span>' : r.status === 'transferred' ? '<span class="pill grey">transferred</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_btab', t.dataset.t); bookings(); }));
    document.querySelectorAll('tr[data-b]').forEach((tr) => (tr.onclick = () => go(`#/booking/${tr.dataset.b}`)));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    if ($('#new')) $('#new').onclick = () => bookingForm(null);
  }

  // Channel partner firms for the booking form (pick one, or type a new firm's name).
  const cpFields = async (cur = {}) => {
    const L = await api(`/api/partners?project=${proj}&firms=1`).catch(() => ({ firms: [] }));
    return `<div class="row"><div><label>Channel partner firm</label><input name="cpName" list="cpfirms" value="${esc(cur.cp_name || '')}" placeholder="choose, or type a new firm"><datalist id="cpfirms">${L.firms.map((f) => `<option value="${esc(f.name)}" data-pct="${f.default_pct ?? ''}">`).join('')}</datalist></div>
      <div><label>Brokerage % of agreement value</label><input name="brokeragePct" inputmode="decimal" value="${cur.brokerage_pct != null ? toNum(cur.brokerage_pct) : ''}" placeholder="e.g. 2"><span class="small muted" id="brkAmt"></span></div></div>`;
  };
  const wireCp = (dl) => {
    const f = $('form', dl), out = $('#brkAmt', dl); if (!f || !out) return;
    const upd = () => { const av = toNum(f.agreementValue && f.agreementValue.value), p = toNum(f.brokeragePct.value); out.textContent = av && p ? `= ${inr(Math.round(av * p / 100))}` : ''; };
    f.cpName.addEventListener('change', () => { const o = [...dl.querySelectorAll('#cpfirms option')].find((x) => x.value === f.cpName.value); if (o && o.dataset.pct && !f.brokeragePct.value) f.brokeragePct.value = o.dataset.pct; upd(); });
    f.addEventListener('input', upd); upd();
  };

  async function bookingForm(unit) {
    let choices = [];
    const cpHtml = await cpFields();
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
      <div class="row"><div><label>Source</label><select name="source"><option>Walk-in</option><option>Channel Partner</option><option>Reference</option><option>Digital</option><option>Other</option></select></div><div><label>Relationship manager</label><input name="rmName"></div></div>
      ${cpHtml}
      ${applicant(1)}<details><summary>Add a second or third applicant</summary>${applicant(2)}${applicant(3)}</details>`,
    async (x) => {
      const applicants = [1, 2, 3].map((i) => ({ name: x[`a${i}_name`], phone: x[`a${i}_phone`], pan: x[`a${i}_pan`], aadhaar: x[`a${i}_aadhaar`], email: x[`a${i}_email`], address: x[`a${i}_address`] })).filter((a) => a.name && a.name.trim());
      const r = await api('/api/bookings', { action: 'create', unitId: unit ? unit.id : x.unitId, bookingDate: x.bookingDate, agreementValue: x.agreementValue, gstRate: x.gstRate, parking: x.parking, funding: x.funding, loanBank: x.loanBank, source: x.source, cpName: x.cpName, brokeragePct: x.brokeragePct, rmName: x.rmName, applicants });
      toast('Booking saved. It now waits for Head CRM approval.');
      go(`#/booking/${r.id}`);
    });
    dl.classList.add('wide');
    wireCp(dl);
  }

  async function bookingPage(id) {
    const d = await api(`/api/bookings?id=${id}`);
    const b = d.booking, bal = d.balance || {};
    const demanded = new Map(d.demands.filter((x) => x.status === 'raised').map((x) => [x.stage_name, x]));
    // ---------- the flat file: one window for one flat and its buyer ----------
    // Everything about the flat is here: money, payments, calls, messages, documents and history. Other lists only link to it.
    const names = d.applicants.map((a) => a.name).join(' & ');
    const live = b.status === 'active';
    const primary = [], more = [];
    if (b.status === 'pending' && can('booking.approve')) primary.push('<button id="approve">Approve booking</button><button class="danger" id="reject">Reject</button>');
    if (live && b.cancel_requested_at && can('cancellation.approve')) primary.push('<button class="danger" id="cancelOk">Approve cancellation</button><button class="ghost" id="cancelNo">Keep the booking</button>');
    if (live && b.transfer_requested_at && can('booking.approve')) primary.push('<button id="trOk">Approve the transfer</button><button class="ghost" id="trNo">Reject the transfer</button>');
    if (live && can('demand.raise')) primary.push('<button id="logf">📞 Log a call</button>');
    if (live && can('receipt.enter')) primary.push('<button id="receipt">₹ Enter a receipt</button>');
    if (live && can('demand.raise')) primary.push('<button class="ghost" id="ffMail">✉ Email the buyer</button>');
    if (live && can('demand.raise')) primary.push('<button class="ghost" id="ffLetter">Demand letter</button>');
    if (live && can('ledger.view')) more.push(`<a href="#/statement/${b.id}">Statement of account (print)</a>`);
    if (live && !b.registration_date && can('booking.create')) more.push('<button id="register">Record agreement and registration</button>');
    if (['active', 'pending'].includes(b.status) && can('booking.approve')) more.push('<button id="editBk" title="Only Head CRM can change a booking; every change is kept in the audit log">Edit booking or buyer details</button>');
    if (live && !b.cancel_requested_at && !b.transfer_requested_at && can('booking.create')) more.push('<button id="trReq">Transfer to another flat</button>', '<button id="cancelReq" class="bad-t">Request cancellation</button>');
    const statusPill = { pending: '<span class="pill">waiting for approval</span>', active: '<span class="pill good">active</span>', cancelled: '<span class="pill bad">cancelled</span>', rejected: '<span class="pill bad">rejected</span>', transferred: '<span class="pill grey">transferred</span>' }[b.status] || '';
    const tel = (p) => String(p || '').replace(/\D/g, '').slice(-10);
    const contact = (a) => { const m = tel(a.phone), ok = /^[6-9]\d{9}$/.test(m);
      return `<div class="ff-person"><b>${esc(a.name)}</b><span>${ok ? `<a href="tel:+91${m}">📞 ${esc(m)}</a> <a href="https://wa.me/91${m}" target="_blank" rel="noopener">WhatsApp</a>` : a.phone ? esc(a.phone) : '<span class="muted">no mobile</span>'}${a.email ? ` <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}</span></div>`; };
    const TABS = [['overview', 'Overview'], ['payments', 'Payments'], ['calls', 'Calls & follow-ups'], ['messages', 'Messages'], ['documents', 'Documents'], ['history', 'History']];
    const qTab = (location.hash.split('?')[1] || '').match(/tab=(\w+)/);
    let tab = qTab && TABS.some(([k]) => k === qTab[1]) ? qTab[1] : 'overview';
    const docBtns = [`<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=costsheet">Cost sheet</a>`];
    if (can('buyer.kyc')) docBtns.push(`<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=allotment">Allotment letter</a>`, `<a class="btn ghost small" target="_blank" rel="noopener" href="/api/docs?booking=${b.id}&doc=form">Booking form</a>`);
    if (can('ledger.view') && live) docBtns.push(`<a class="btn ghost small" href="#/statement/${b.id}">Statement of account</a>`);
    if (can('buyer.kyc') && live) docBtns.push(`<button class="ghost small" id="welcome">Welcome email${b.welcome_sent_at ? ' (sent ' + fmtD(b.welcome_sent_at.slice(0, 10)) + ')' : ''}</button>`);
    const notes = [
      b.transfer_requested_at && live && d.transfer ? `Transfer to <b>${esc(d.transfer.to_unit)}</b> requested on ${fmtD(String(b.transfer_requested_at).slice(0, 10))}${d.transfer.requested_by ? ' by ' + esc(d.transfer.requested_by) : ''}: new agreement value ${inr(b.transfer_av)}, from ${fmtD(String(b.transfer_date || '').slice(0, 10))}. ${b.transfer_move_receipts ? 'The receipts move to the new flat.' : 'The receipts stay here; Accounts moves them.'} Reason: ${esc(b.transfer_reason || '')}. Waiting for Head CRM.` : '',
      b.status === 'transferred' && d.transfer ? `This booking was transferred to <a href="#/booking/${b.transferred_to}"><b>${esc(d.transfer.to_booking_unit || 'the new flat')}</b></a> on ${fmtD(String(b.cancelled_at || '').slice(0, 10))}. It stays here on record; the receipts are on the new booking.` : '',
      b.transferred_from && d.transfer ? `Transferred from <a href="#/booking/${b.transferred_from}">${esc(d.transfer.from_unit || 'the earlier flat')}</a>. Receipts marked "moved" came across with the buyer.` : '',
      b.cancel_requested_at && live ? `Cancellation requested on ${fmtD(b.cancel_requested_at)}${b.cancel_date ? ', cancelling from ' + fmtD(String(b.cancel_date).slice(0, 10)) : ''}${toNum(b.cancel_charges) ? ', cancellation charges ' + inr(b.cancel_charges) : ''}: ${esc(b.cancel_reason)}. Waiting for Management.` : '',
      b.status === 'pending' ? 'This booking is waiting for Head CRM approval. The person who entered it cannot approve it.' : '',
      d.earlier && d.earlier.length ? `Earlier on this flat: ${d.earlier.map((e) => `<a href="#/booking/${e.id}">${esc(e.buyers || 'buyer')}</a> (cancelled ${fmtD(String(e.cancel_date || e.cancelled_at || '').slice(0, 10))}${e.refund_status ? ', refund ' + esc(e.refund_status) : ''})`).join('; ')}.` : '',
    ].filter(Boolean);
    const cancelBox = b.status === 'cancelled' ? (() => { const c = d.cancellation || {}; const paid = toNum(c.refund_rtgs) + toNum(c.refund_white); const due = c.refund_due != null ? toNum(c.refund_due) : toNum(c.received);
      return `<div class="panel cancel-box"><h2>Cancelled booking · kept on record</h2>
        <p class="muted">This booking was cancelled${c.cancel_date ? ' on ' + fmtD(String(c.cancel_date).slice(0, 10)) : b.cancelled_at ? ' on ' + fmtD(String(b.cancelled_at).slice(0, 10)) : ''}${c.cancelled_by_name ? ', approved by ' + esc(c.cancelled_by_name) : ''}. Reason: ${esc(b.cancel_reason || '—')}. The buyer, their receipts and the refund stay here and in Accounts → Cancelled flats, so the CRM and the books agree.</p>
        <div class="kpis">${kpi(inr(c.received), 'received from this buyer')}${kpi(inr(c.deduction), 'cancellation charges')}${kpi(inr(due), 'refund due')}${kpi(inr(paid), 'refunded so far')}${kpi(esc(c.refund_status || 'Pending'), 'refund status (Accounts)', /^(done|nothing)/i.test(c.refund_status || '') ? '' : 'bad')}</div>
        <p class="small" style="margin-top:10px">${d.current ? `The flat is now booked to <a href="#/booking/${d.current.id}">${esc(d.current.buyers || 'a new buyer')}</a>${d.current.status === 'pending' ? ' (waiting for approval)' : ''}.` : `The flat ${esc(d.unit.unit_no)} is free to book again.${can('booking.create') ? ' <button class="small" id="rebook">Book this flat for a new buyer</button>' : ''}`}</p></div>`; })() : '';
    const nextDue = d.demands.filter((x) => x.status === 'raised' && !x.opening).map((x) => x.due_date).filter(Boolean).sort().pop();
    const ACT = { approve: 'Approved', reject: 'Rejected', create: 'Entered', edit: 'Edited', cancel: 'Cancelled', 'cancel-request': 'Cancellation requested', 'cancel-approve': 'Cancellation approved', register: 'Registration recorded', 'bank-linked': 'Found in the bank', bounce: 'Cheque returned', deposited: 'Deposited', received: 'Received by Accounts', handed: 'Handed to Accounts', 'receipt-email': 'Receipt emailed to the buyer', 'receipt-no': 'Receipt numbered', 'transfer-request': 'Transfer requested', 'transfer-approve': 'Transfer approved', 'transfer-reject': 'Transfer rejected', dates: 'Dates changed', welcome: 'Welcome email sent', raise: 'Raised', update: 'Updated' };
    $('#page').innerHTML = `<p class="crumbs"><a href="#/flats">Flats &amp; buyers</a> › ${esc(d.unit.unit_no)}</p>
      <div class="panel ff-head">
        <div class="ff-id"><h1>${esc(d.unit.unit_no)} <span class="ff-names">${esc(names)}</span> ${statusPill}${b.sample ? ' <span class="pill grey">sample</span>' : ''}</h1>
          <p class="muted">${esc(d.unit.building)} · floor ${d.unit.floor ?? '—'} · ${esc(d.unit.typology || '')} ${d.unit.carpet_sqft ? toNum(d.unit.carpet_sqft) + ' sq ft' : ''} · booked ${fmtD(b.booking_date)}${b.rm_name ? ' · RM ' + esc(b.rm_name) : ''}</p>
          <div class="ff-people">${d.applicants.map(contact).join('')}</div></div>
        <div class="ff-money">${kpi(inr(b.agreement_value), 'agreement value')}${kpi(inr(bal.credit_av), 'received')}${kpi(inr(bal.outstanding), 'balance due')}${kpi(inr(bal.overdue), 'overdue', toNum(bal.overdue) > 0 ? 'bad' : '')}${kpi(inr(bal.gst_outstanding), 'GST due')}${kpi(nextDue ? fmtD(nextDue) : '—', 'last demand due')}</div>
      </div>
      ${notes.map((n) => `<div class="note" style="margin-bottom:12px">${n}</div>`).join('')}
      <div id="ffVerify"></div>
      ${cancelBox}
      ${primary.length || more.length ? `<div class="ff-actions">${primary.join('')}${more.length ? `<details class="ff-more"><summary class="btn ghost">More ▾</summary><div class="ff-menu">${more.join('')}</div></details>` : ''}</div>` : ''}
      <div class="ff-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-ff="${k}" aria-selected="${k === tab}">${l}<span class="ff-n" id="ffn-${k}"></span></button>`).join('')}</div>
      <section class="ff-pane" data-pane="overview">
        <div class="panel" id="ffNext"><h2>Where this buyer stands</h2><p class="muted small">Loading…</p></div>
        ${d.regSteps && b.status === 'active' ? (() => { const nx = d.regSteps.find((x) => !x.done); return `<div class="panel"><h2>Registration ${nx ? `<span class="pill warn" style="margin-left:6px">next: ${esc(nx.label)}</span>` : '<span class="pill good" style="margin-left:6px">registered</span>'}</h2>
          <ol class="regsteps">${d.regSteps.map((x) => `<li class="${x.done ? 'done' : x === nx ? 'next' : ''}"><span class="rs-dot">${x.done ? '✓' : ''}</span><div><b>${esc(x.label)}</b>${x.at && x.key !== 'papers' ? ' · ' + fmtD(String(x.at).slice(0, 10)) : ''}${x.key === 'papers' && x.done && x.at ? `<span class="small muted"> · ticked ${fmtD(String(x.at).slice(0, 10))}${d.regPapersBy ? ' by ' + esc(d.regPapersBy) : ''}</span>` : ''}
            <div class="small muted">${esc(x.how)}</div>${x.manual && live && anyOf('booking.create', 'demand.raise') && !b.registration_date ? `<button class="ghost small" id="regPapers" data-on="${x.done ? 0 : 1}" style="margin-top:4px">${x.done ? 'Untick' : 'Tick: papers are ready'}</button>` : ''}</div></li>`).join('')}</ol></div>`; })() : ''}
        <div class="two">
          <div class="panel"><h2>Booking</h2><table class="kv">
            <tr><th>Booking date</th><td>${fmtD(b.booking_date)}</td></tr><tr><th>Agreement / registration</th><td>${fmtD(b.agreement_date)} / ${fmtD(b.registration_date)}</td></tr>
            <tr><th>GST rate</th><td>${toNum(b.gst_rate)}%</td></tr><tr><th>Stamp duty / registration fee</th><td>${b.stamp_duty ? inr(b.stamp_duty) : '—'} / ${b.registration_fee ? inr(b.registration_fee) : '—'}</td></tr>
            <tr><th>Funding</th><td>${esc(b.funding === 'loan' ? 'Home loan · ' + (b.loan_bank || '') : b.funding === 'self' ? 'Self' : '—')}</td></tr><tr><th>Parking</th><td>${b.parking}</td></tr>
            <tr><th>Source / CP</th><td>${esc(b.source || '')}${b.cp_id ? ` · <a href="#/cp/${b.cp_id}">${esc(b.cp_name || 'partner')}</a>` : b.cp_name ? ' · ' + esc(b.cp_name) : ''}${!b.source && !b.cp_name ? '—' : ''}</td></tr><tr><th>Brokerage</th><td>${b.brokerage ? inr(b.brokerage) + (b.brokerage_pct != null ? ` (${toNum(b.brokerage_pct)}%)` : '') : '—'}</td></tr></table>
            <h2 style="margin-top:16px">Dates &amp; status ${live && anyOf('booking.create', 'demand.raise') ? '<button class="ghost small" id="editDates" style="float:right">Edit</button>' : ''}</h2><table class="kv">
            <tr><th>Booking form received</th><td>${fmtD(b.booking_form_date)}</td></tr><tr><th>Registration status</th><td>${esc(b.registration_status || (b.registration_date ? 'Done' : '—'))}</td></tr>
            <tr><th>Registration appointment</th><td>${fmtD(b.registration_appointment)}</td></tr><tr><th>Bank NOC</th><td>${fmtD(b.bank_noc_date)}</td></tr>
            <tr><th>Possession</th><td>${fmtD(b.possession_date)}</td></tr><tr><th>Follow-up tag</th><td>${esc(b.crm_status || '—')}</td></tr></table></div>
          <div class="panel"><h2>Buyers</h2>${d.applicants.map((a) => `<p><b>${esc(a.name)}</b><br><span class="muted">PAN ${esc(a.pan || '—')} · Aadhaar ${esc(a.aadhaar || '—')}<br>${esc(a.phone || '')} ${esc(a.email || '')}<br>${esc(a.address || '')}</span></p>`).join('')}
            ${can('booking.approve') ? '' : '<p class="small muted">To change a buyer\'s details, ask Head CRM (Edit booking).</p>'}</div>
        </div>
      </section>
      <section class="ff-pane" data-pane="payments" hidden>
        <div class="panel"><h2>Receipts ${live && can('receipt.enter') ? '<button class="small" id="receipt2" style="float:right">Enter a receipt</button>' : ''}</h2><div class="table-wrap"><table><tr><th>Date</th><th>Bank / instrument</th><th class="num">Amount</th><th>Split</th><th>Status</th><th>Cheque</th><th></th></tr>
          ${d.receipts.map((r) => `<tr><td>${fmtD(r.received_on)}</td><td>${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode)}</td><td class="num">${inr(r.amount, 2)}</td>
            <td class="small">${Object.entries(r.splits).map(([h, v]) => `${HEAD[h] || h} ${inr(v, 2)}`).join(' · ')}</td><td>${rStatus(r)}</td><td class="small">${r.opening ? '' : chequeCell(r)}</td>
            <td>${['pending', 'approved'].includes(r.status) && !r.opening ? `<button class="ghost small" data-doc="${r.id}">Receipt</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No receipts yet.</td></tr>'}</table></div></div>
        <div class="panel"><h2>Payment plan</h2><div class="table-wrap"><table><tr><th class="num">#</th><th>Stage</th><th class="num">%</th><th class="num">Amount</th><th>Demanded on</th><th>Due</th></tr>
          ${d.plan.map((s) => { const x = demanded.get(s.name); return `<tr class="${x ? '' : 'dim'}"><td class="num">${s.seq}</td><td>${esc(s.name)}</td><td class="num">${toNum(s.pct)}%</td><td class="num">${inr(toNum(b.agreement_value) * toNum(s.pct) / 100)}</td><td>${x ? fmtD(x.demand_date) : 'not yet'}</td><td>${x ? fmtD(x.due_date) : ''}</td></tr>`; }).join('')}</table></div></div>
        ${can('ledger.view') ? `<div class="panel" id="ffLedger"><h2>Ledger <a class="btn ghost small" style="float:right" href="#/statement/${b.id}">Print statement</a></h2><p class="muted small">Loading…</p></div>` : ''}
      </section>
      <section class="ff-pane" data-pane="calls" hidden><div class="panel" id="ffCalls"><h2>Calls &amp; follow-ups</h2><p class="muted small">${can('ledger.view') ? 'Loading…' : 'Not on your login.'}</p></div></section>
      <section class="ff-pane" data-pane="messages" hidden>
        ${can('ledger.view') ? '<div class="panel" id="ccomm"><h2>Communication</h2><p class="muted small">Loading…</p></div>' : ''}
        <div class="panel" id="ffChat"><h2>Dream Chat about this flat</h2><p class="muted small">Loading…</p></div>
      </section>
      <section class="ff-pane" data-pane="documents" hidden>
        <div class="panel"><h2>Letters and forms from the ERP</h2><div class="actions" style="margin:0">${docBtns.join('')}</div></div>
        ${can('buyer.kyc') ? '<div class="panel" id="cdocs"><h2>Customer documents</h2><p class="muted small">Loading…</p></div>' : ''}
      </section>
      <section class="ff-pane" data-pane="history" hidden><div class="panel"><h2>History</h2><p class="small muted">Every change on this booking, its receipts and demands, newest first.</p><div class="table-wrap"><table><tr><th>When</th><th>What</th><th>Note</th><th>By</th></tr>
        ${(d.history || []).map((h) => `<tr><td class="small">${fmtDate(h.at)}</td><td>${esc((h.entity === 'booking' ? '' : h.entity === 'receipt' ? 'Receipt: ' : 'Demand: ') + (ACT[h.action] || h.action))}</td><td class="small">${esc(h.note || '')}</td><td class="small">${esc(h.user_name || 'ERP')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing recorded yet.</td></tr>'}</table></div></div></section>`;
    const showTab = (k) => { tab = k;
      document.querySelectorAll('[data-ff]').forEach((x) => x.setAttribute('aria-selected', x.dataset.ff === k));
      document.querySelectorAll('.ff-pane').forEach((x) => (x.hidden = x.dataset.pane !== k));
      history.replaceState(null, '', `#/booking/${b.id}${k === 'overview' ? '' : '?tab=' + k}`); };
    document.querySelectorAll('[data-ff]').forEach((x) => (x.onclick = () => showTab(x.dataset.ff)));
    const mm = $('.ff-more'); if (mm) { document.addEventListener('click', (e) => { if (mm.open && !mm.contains(e.target)) mm.open = false; }); mm.querySelectorAll('.ff-menu > *').forEach((x) => x.addEventListener('click', () => (mm.open = false))); }
    showTab(tab);
    const count = (k, n, hot) => { const el = $('#ffn-' + k); if (el && n) { el.textContent = n; el.classList.toggle('hot', !!hot); } };
    count('payments', d.receipts.length);
    count('history', (d.history || []).length);
    document.querySelectorAll('[data-doc]').forEach((x) => (x.onclick = () => receiptDocDialog(+x.dataset.doc)));
    if ($('#receipt2')) $('#receipt2').onclick = () => $('#receipt').click();
    const reload = (k) => () => go(`#/booking/${b.id}${k ? '?tab=' + k : ''}`);
    if ($('#cdocs')) docsPanel('booking', b.id, $('#cdocs'), `${d.unit.unit_no} · ${names}`).then(() => count('documents', $('#cdocs').querySelectorAll('[data-open]').length)).catch(() => {});
    if ($('#ccomm')) commPanel(b.id, d.unit.unit_no, $('#ccomm')).then(() => count('messages', $('#ccomm').querySelectorAll('.msg').length)).catch(() => {});
    if ($('#ffMail')) $('#ffMail').onclick = () => followupEmail(b.id, d.unit.unit_no, reload('messages'));
    if ($('#ffLetter')) $('#ffLetter').onclick = async () => {
      const L = await api(`/api/letters?project=${proj}`).catch((e) => ({ error: e.message }));
      if (L.error) return alert(L.error);
      const m = L.mail || {};
      const dl = dialog(`<h2>Demand letter · ${esc(d.unit.unit_no)}</h2><p class="muted small">${!m.configured ? 'Email is not set up, so the letter can be printed or marked as sent on WhatsApp or by courier.' : m.live ? 'The email goes to the buyer.' : 'Test version: the email goes only to the test address in Letter settings.'}</p>
        <div class="row"><div><label>Letter type</label><select name="type">${L.types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div><div><label>Letter date</label><input type="date" name="date" value="${todayIso()}" max="${todayIso()}"></div></div>
        <label>Send</label><select name="via">${m.configured ? '<option value="email">By email</option>' : ''}<option value="print">Print only (open the PDF)</option><option value="whatsapp">Mark sent on WhatsApp</option><option value="courier">Mark sent by courier</option></select>
        <p class="small"><a href="#" id="ffPrev">Preview the letter</a></p>`,
      async (x) => {
        const r = await api('/api/letters', { action: 'prepare', projectId: proj, bookingIds: [b.id], letterType: x.type, letterDate: x.date });
        const id = r.letters[0] && r.letters[0].id; if (!id) throw new Error('No letter was prepared: this buyer may owe less than the minimum in Letter settings.');
        if (x.via === 'email') { const e = await api('/api/letters', { action: 'email', projectId: proj, letterIds: [id] }); const res = e.results[0] || {}; if (res.error) throw new Error(res.error); toast('Letter emailed.'); }
        else if (x.via === 'print') window.open(`/api/letters?pdf=${id}`, '_blank', 'noopener');
        else { await api('/api/letters', { action: 'mark', projectId: proj, letterIds: [id], via: x.via }); toast(`Marked as sent by ${x.via}.`); }
        reload('history')();
      });
      $('[value=save]', dl).textContent = 'Prepare';
      $('#ffPrev', dl).onclick = (e) => { e.preventDefault(); window.open(`/api/letters?preview=${b.id}&type=${encodeURIComponent(dl.querySelector('[name=type]').value)}`, '_blank', 'noopener'); };
    };
    api(`/api/verify?booking=${b.id}`).then((iv) => { const open = iv.rows.filter((x) => x.status === 'open');
      if (open.length) $('#ffVerify').innerHTML = `<div class="note" style="margin-bottom:12px"><b>${open.length} item${open.length === 1 ? '' : 's'} to verify from the import:</b><ul class="small" style="margin:6px 0 0 18px;padding:0">${open.map((x) => `<li>${esc(x.detail)}</li>`).join('')}</ul><a href="#/verify">Open Data to verify</a></div>`; }).catch(() => {});
    // Dream Chat with Accounts about this flat
    (async () => { const el = $('#ffChat');
      try {
        const t = await api(`/api/team?booking=${b.id}`);
        count('messages', ($('#ccomm') ? $('#ccomm').querySelectorAll('.msg').length : 0) + t.rows.length);
        el.innerHTML = `<h2>Dream Chat about this flat <span class="muted small">CRM ↔ Accounts</span></h2>
          <div class="ff-chat">${t.rows.map((m) => `<div class="ff-cm ${m.kind === 'system' ? 'sys' : ''}"><div class="small muted">${esc(m.kind === 'system' ? 'ERP' : m.from_name || '')} → ${m.to_team === 'crm' ? 'CRM' : 'Accounts'} · ${fmtDate(m.created_at)}${m.needs_action ? (m.done_at ? ' · done' : ' · <b>needs an answer</b>') : ''}</div><div>${esc(m.body)}</div></div>`).join('') || '<p class="muted small">No messages about this flat yet.</p>'}</div>
          ${t.team ? `<form id="ffChatF" class="row" style="grid-template-columns:1fr auto;align-items:end;margin-top:10px"><div><label>Message to ${t.team === 'crm' ? 'Accounts' : t.team === 'accounts' ? 'CRM' : 'the other team'}</label><input name="body" required maxlength="2000" placeholder="e.g. Please confirm the cheque for this flat is deposited"></div><div><button>Send</button></div></form>` : ''}`;
        if ($('#ffChatF')) $('#ffChatF').onsubmit = async (e) => { e.preventDefault(); const x = Object.fromEntries(new FormData(e.target));
          try { await api('/api/team', { action: 'post', bookingId: b.id, to: t.team === 'crm' ? 'accounts' : t.team === 'accounts' ? 'crm' : 'accounts', body: x.body }); toast('Sent.'); reload('messages')(); } catch (er) { alert(er.message); } };
      } catch { el.innerHTML = '<h2>Dream Chat about this flat</h2><p class="muted small">Not on your login.</p>'; }
    })();
    if (can('ledger.view')) {
      api(`/api/ledger?booking=${b.id}`).then((L) => { $('#ffLedger').innerHTML = `<h2>Ledger <a class="btn ghost small" style="float:right" href="#/statement/${b.id}">Print statement</a></h2>
        <div class="table-wrap"><table><tr><th>Date</th><th>Particulars</th><th class="num">Demanded</th><th class="num">Received</th><th class="num">Balance</th><th class="num">GST balance</th></tr>
        ${L.lines.map((l) => `<tr><td>${fmtD(l.date)}</td><td>${esc(l.text)}${l.due ? `<br><span class="small muted">due ${fmtD(l.due)}</span>` : ''}</td><td class="num">${l.debit ? inr(l.debit, 2) : ''}</td><td class="num">${l.credit && toNum(l.credit) ? inr(l.credit, 2) : ''}</td><td class="num"><b>${inr(l.balance, 2)}</b></td><td class="num">${inr(l.gstBalance, 2)}</td></tr>`).join('')}</table></div>
        ${L.oldest ? `<p class="small">Oldest unpaid demand: ${esc(L.oldest.stage)}, due ${fmtD(L.oldest.since)} (${L.oldest.days} days ago).</p>` : ''}`;
        }).catch((e) => { $('#ffLedger').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
      const f = await api(`/api/followups?booking=${b.id}`);
      const last = f.rows[0];
      const today = todayIso();
      const late = last && last.promise_date && last.promise_date < today && !d.receipts.some((r) => r.received_on >= last.created_at.slice(0, 10) && ['pending', 'approved'].includes(r.status));
      count('calls', f.rows.length, last && last.next_date && last.next_date <= today && toNum(bal.overdue) > 0);
      $('#ffNext').innerHTML = `<h2>Where this buyer stands</h2><div class="ff-next">
        <div><span class="muted small">Overdue</span><b class="${toNum(bal.overdue) > 0 ? 'bad-t' : 'good-t'}">${toNum(bal.overdue) > 0 ? inr(bal.overdue) : 'Nothing overdue'}</b></div>
        <div><span class="muted small">Last contact</span><b>${last ? `${fmtD(last.created_at.slice(0, 10))} · ${esc(last.kind)}` : 'Never'}</b>${last ? `<span class="small">${esc(last.outcome)}${last.note ? ' · ' + esc(last.note.slice(0, 80)) : ''}${last.by_name ? ' · ' + esc(last.by_name) : ''}</span>` : ''}</div>
        <div><span class="muted small">Promise to pay</span><b class="${late ? 'bad-t' : ''}">${last && last.promise_date ? `${fmtD(last.promise_date)}${last.promise_amount ? ' · ' + inr(last.promise_amount) : ''}${late ? ' (broken)' : ''}` : '—'}</b></div>
        <div><span class="muted small">Next call</span><b class="${last && last.next_date && last.next_date <= today && toNum(bal.overdue) > 0 ? 'bad-t' : ''}">${last && last.next_date ? fmtD(last.next_date) + (last.next_date <= today ? ' (due)' : '') : toNum(bal.overdue) > 0 ? 'Call today' : '—'}</b></div>
        <div><span class="muted small">Last receipt</span><b>${(() => { const r = d.receipts.filter((x) => ['pending', 'approved'].includes(x.status)).sort((x, y) => String(y.received_on).localeCompare(String(x.received_on)))[0]; return r ? `${fmtD(r.received_on)} · ${inr(r.amount)}` : 'None'; })()}</b></div>
      </div>`;
      $('#ffCalls').innerHTML = `<h2>Calls &amp; follow-ups ${$('#logf') ? '<button class="small" id="logf2" style="float:right">Log a call</button>' : ''}</h2><div class="table-wrap"><table><tr><th>When</th><th>How</th><th>Outcome</th><th>Note</th><th>Promise</th><th>Next</th><th>By</th></tr>
        ${f.rows.map((x) => `<tr><td>${fmtD(x.created_at.slice(0, 10))}</td><td>${esc(x.kind)}</td><td>${esc(x.outcome)}</td><td class="small">${esc(x.note || '')}</td><td class="small">${x.promise_date ? fmtD(x.promise_date) + (x.promise_amount ? ' · ' + inr(x.promise_amount) : '') : ''}</td><td class="small">${x.next_date ? fmtD(x.next_date) : ''}</td><td>${esc(x.by_name || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No calls logged yet.</td></tr>'}</table></div>`;
      if ($('#logf')) $('#logf').onclick = () => followupForm(b.id, d.unit.unit_no, f, reload('calls'));
      if ($('#logf2')) $('#logf2').onclick = () => $('#logf').click();
    } else $('#ffNext').hidden = true;
    const act = async (body, msg) => { try { await api('/api/bookings', { id: b.id, ...body }); if (msg) toast(msg); bookingPage(id); } catch (e) { alert(e.message); } };
    if ($('#regPapers')) $('#regPapers').onclick = async (e) => { try { await api('/api/bookings', { action: 'reg.papers', id: b.id, ready: e.target.dataset.on === '1' }); toast(e.target.dataset.on === '1' ? 'Papers marked ready.' : 'Unticked.'); bookingPage(id); } catch (x) { alert(x.message); } };
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
    if ($('#receipt')) $('#receipt').onclick = () => receiptForm({ id: b.id, label: `${d.unit.unit_no} · ${names}`, gstRate: toNum(b.gst_rate) }, reload('payments'));
    if ($('#cancelReq')) $('#cancelReq').onclick = () => dialog(`<h2>Request cancellation · ${esc(d.unit.unit_no)}</h2>
      <p class="muted">The booking is not deleted. Once Management approves, it stays on record as Cancelled with the buyer and every receipt, Accounts gets it on the Cancelled flats list for the refund, and the flat becomes free to book again.</p>
      <label>Reason</label><textarea name="reason" rows="2" required></textarea>
      <div class="row"><div><label>Cancellation date</label><input type="date" name="cancelDate" value="${todayIso()}" max="${todayIso()}"></div>
        <div><label>Cancellation charges (₹), if any</label><input name="charges" inputmode="decimal" placeholder="0"></div></div>
      <p class="small muted">Received so far from this buyer: <b>${inr(d.receipts.filter((r) => r.status === 'approved').reduce((a, r) => a + toNum(r.amount), 0))}</b>. Refund due = received − charges.</p>`,
      async (x) => { await api('/api/bookings', { action: 'cancel-request', id: b.id, reason: x.reason, cancelDate: x.cancelDate, charges: x.charges }); toast('Cancellation sent to Management for approval.'); bookingPage(b.id); });
    if ($('#rebook')) $('#rebook').onclick = () => bookingForm({ id: d.unit.id, unit_no: d.unit.unit_no });
    if ($('#trReq')) $('#trReq').onclick = async () => {
      const U = await api(`/api/units?project=${proj}`);
      const free = U.units.filter((x) => ['available', 'blocked'].includes(x.status) && !x.booking_id && x.id !== d.unit.id);
      dialog(`<h2>Transfer ${esc(d.unit.unit_no)} to another flat</h2>
        <p class="muted">The same buyers move to the new flat. Once Head CRM approves, this booking stays on record as Transferred, a new booking is made on the new flat, and (if ticked) the receipts move across. For a different buyer, cancel this booking and make a new one instead.</p>
        <label>New flat</label><select name="toUnitId" required><option value="">Choose an available flat</option>${free.map((x) => `<option value="${x.id}">${esc(x.unit_no)} · ${esc(x.typology || '')} ${x.carpet_sqft ? toNum(x.carpet_sqft) + ' sq ft' : ''}</option>`).join('')}</select>
        <div class="row"><div><label>Agreement value of the new flat (₹)</label><input name="agreementValue" inputmode="decimal" required value="${toNum(b.agreement_value)}"></div><div><label>Transfer date</label><input type="date" name="transferDate" max="${todayIso()}" value="${todayIso()}"></div></div>
        <label class="check"><input type="checkbox" name="moveReceipts" checked> Move this booking's receipts to the new flat</label>
        <label>Reason</label><input name="reason" required>`,
      async (x) => { await api('/api/bookings', { action: 'transfer-request', id: b.id, toUnitId: x.toUnitId, agreementValue: x.agreementValue, transferDate: x.transferDate, moveReceipts: x.moveReceipts === 'on', reason: x.reason }); toast('Transfer sent to Head CRM for approval.'); bookingPage(id); });
    };
    if ($('#trOk')) $('#trOk').onclick = async () => { if (!confirm('Approve the transfer? This booking becomes Transferred, a new booking is made on the new flat with the same buyers, and the demands are raised there.')) return;
      try { const r = await api('/api/bookings', { action: 'transfer-approve', id: b.id }); toast(`Transferred. ${r.receiptsMoved} receipt(s) moved; Accounts has been told in Dream Chat.`); go(`#/booking/${r.newBooking}`); } catch (e) { alert(e.message); } };
    if ($('#trNo')) $('#trNo').onclick = () => { const r = prompt('Reason for rejecting the transfer:'); if (r !== null) act({ action: 'transfer-reject', reason: r }, 'Transfer rejected.'); };
    if ($('#editBk')) $('#editBk').onclick = async () => {
      const kyc = can('buyer.kyc');
      const cpHtml = await cpFields(b);
      const ap = (i) => { const a = d.applicants[i - 1] || {}; return `<fieldset class="appl"><legend>Applicant ${i}${i > 1 ? ' (optional)' : ''}</legend>
        <div class="row"><div><label>Full name</label><input name="a${i}_name" value="${esc(a.name || '')}" ${i === 1 ? 'required' : ''}></div><div><label>Mobile</label><input name="a${i}_phone" value="${esc(a.phone || '')}"></div></div>
        <div class="row"><div><label>PAN</label><input name="a${i}_pan" value="${esc(a.pan || '')}"></div><div><label>Aadhaar</label><input name="a${i}_aadhaar" value="${esc(a.aadhaar || '')}"></div></div>
        <div class="row"><div><label>Email</label><input name="a${i}_email" value="${esc(a.email || '')}"></div><div><label>Address</label><input name="a${i}_address" value="${esc(a.address || '')}"></div></div></fieldset>`; };
      const dl = dialog(`<h2>Edit booking · ${esc(d.unit.unit_no)}</h2>
        <p class="muted small">Only Head CRM can change a booking. Every change is kept in the audit log with the old and new value and your reason. A new agreement value or GST rate re-works the demands already raised.</p>
        <div class="row"><div><label>Booking date</label><input name="bookingDate" type="date" max="${todayIso()}" value="${esc(String(b.booking_date || '').slice(0, 10))}"></div><div><label>Agreement value (₹, incl. parking)</label><input name="agreementValue" inputmode="decimal" value="${toNum(b.agreement_value)}"></div></div>
        <div class="row"><div><label>GST rate %</label><input name="gstRate" value="${toNum(b.gst_rate)}"></div><div><label>Parking</label><input name="parking" type="number" min="0" value="${b.parking || 0}"></div></div>
        <div class="row"><div><label>Development charges (amenity & possession, ₹)</label><input name="devCharges" inputmode="decimal" value="${b.dev_charges != null ? toNum(b.dev_charges) : ''}"></div><div><label>Relationship manager</label><input name="rmName" value="${esc(b.rm_name || '')}"></div></div>
        <div class="row"><div><label>Funding</label><select name="funding"><option value="self" ${b.funding === 'self' ? 'selected' : ''}>Self funding</option><option value="loan" ${b.funding === 'loan' ? 'selected' : ''}>Home loan</option></select></div><div><label>Loan bank</label><input name="loanBank" value="${esc(b.loan_bank || '')}"></div></div>
        <div class="row"><div><label>Source</label><input name="source" list="srcl" value="${esc(b.source || '')}"><datalist id="srcl"><option>Walk-in</option><option>Channel Partner</option><option>Reference</option><option>Digital</option></datalist></div><div><label>Brokerage (₹, if not a %)</label><input name="brokerage" inputmode="decimal" value="${b.brokerage != null ? toNum(b.brokerage) : ''}"></div></div>
        ${cpHtml}
        ${kyc ? `<details><summary>Applicants</summary>${ap(1)}${ap(2)}${ap(3)}</details>` : ''}
        <label>Reason for the change</label><input name="reason" required placeholder="e.g. agreement value corrected after registration">`,
      async (x) => {
        const body = { action: 'edit', id: b.id, reason: x.reason, bookingDate: x.bookingDate, agreementValue: x.agreementValue, gstRate: x.gstRate, parking: x.parking, devCharges: x.devCharges, rmName: x.rmName, funding: x.funding, loanBank: x.loanBank, source: x.source, cpName: x.cpName, brokerage: x.brokerage, brokeragePct: x.brokeragePct };
        // send only what was changed, so an untouched % does not re-work the brokerage
        const was = { bookingDate: String(b.booking_date || '').slice(0, 10), agreementValue: String(toNum(b.agreement_value)), gstRate: String(toNum(b.gst_rate)), parking: String(b.parking || 0), devCharges: b.dev_charges != null ? String(toNum(b.dev_charges)) : '',
          rmName: b.rm_name || '', funding: b.funding || 'self', loanBank: b.loan_bank || '', source: b.source || '', cpName: b.cp_name || '', brokerage: b.brokerage != null ? String(toNum(b.brokerage)) : '', brokeragePct: b.brokerage_pct != null ? String(toNum(b.brokerage_pct)) : '' };
        for (const k of Object.keys(was)) if (String(body[k] ?? '').trim() === was[k]) delete body[k];
        if (kyc) {
          const ap = [1, 2, 3].map((i) => ({ name: x[`a${i}_name`], phone: x[`a${i}_phone`], pan: x[`a${i}_pan`], aadhaar: x[`a${i}_aadhaar`], email: x[`a${i}_email`], address: x[`a${i}_address`] })).filter((a) => a.name && a.name.trim());
          const sig = (a) => [a.name, a.phone, a.pan, a.aadhaar, a.email, a.address].map((v) => String(v || '').trim()).join('|');
          if (ap.map(sig).join('#') !== d.applicants.map(sig).join('#')) body.applicants = ap;
        }
        const r = await api('/api/bookings', body);
        toast(`Saved: ${r.changed.length ? r.changed.length + ' field(s) changed' : 'buyer details updated'}${r.demandsReworked ? `, ${r.demandsReworked} demand(s) re-worked` : ''}.`);
        bookingPage(id);
      });
      dl.classList.add('wide');
      wireCp(dl);
    };
    if ($('#cancelOk')) $('#cancelOk').onclick = () => confirm('Approve the cancellation? The booking stays on record as Cancelled with its receipts, Accounts gets it on the Cancelled flats list for the refund, open demands are cancelled and the flat becomes free to book again.') && act({ action: 'cancel-approve' }, 'Booking cancelled.');
    if ($('#cancelNo')) $('#cancelNo').onclick = () => act({ action: 'cancel-reject' }, 'Cancellation request withdrawn.');
  }
  const HEAD = { av: 'AV', gst: 'GST', tds: 'TDS', stamp_duty: 'Stamp duty', registration: 'Registration', other: 'Other' };
  // Where a cheque is: with CRM → with Accounts → deposited → in the bank / returned.
  const chequeCell = (r) => {
    if (r.bank_status === 'returned') return `<span class="pill bad">returned</span>${r.bank_on ? `<br><span class="small muted">${fmtD(r.bank_on)}</span>` : ''}`;
    if (r.bank_status === 'cleared') return `<span class="pill good">in the bank</span><br><span class="small muted">${fmtD(r.bank_on)}${r.bank_ref ? ' · ' + esc(r.bank_ref) : ''}${r.bank_match === 'flat and amount' ? ' · matched on flat and amount' : ''}</span>`;
    if (r.mode !== 'cheque' && r.mode !== 'bank') return '';
    if (r.mode === 'bank') return '<span class="small muted">not on the statement yet</span>';
    if (r.deposited_on) return `<span class="pill">deposited</span><br><span class="small muted">${fmtD(r.deposited_on)}${r.deposit_bank ? ' · ' + esc(r.deposit_bank) : ''}${r.deposited_by_name ? ' · ' + esc(r.deposited_by_name) : ''}</span>`;
    if (r.acc_received_at) return `<span class="pill">with Accounts</span><br><span class="small muted">received ${fmtD(String(r.acc_received_at).slice(0, 10))}${r.acc_received_by_name ? ' · ' + esc(r.acc_received_by_name) : ''}</span>`;
    if (r.handed_on) return `<span class="pill warn">handed over</span><br><span class="small muted">${fmtD(r.handed_on)}, not yet confirmed by Accounts</span>`;
    return '<span class="pill warn">with CRM</span>';
  };
  const rStatus = (r) => (r.status === 'approved' && r.approved_note ? `<span class="pill good">approved</span><br><span class="small muted">${esc(r.approved_note)}</span>` : '') || ({ pending: '<span class="pill">waiting for approval</span>', approved: '<span class="pill good">approved</span>', rejected: '<span class="pill grey">rejected</span>', bounced: '<span class="pill bad">bounced</span>', reversed: '<span class="pill bad">reversed</span>' }[r.status] || esc(r.status)) + (r.reverse_reason ? `<br><span class="small muted">${esc(r.reverse_reason)}</span>` : '');

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
      const made = await api('/api/receipts', { action: 'create', bookingId, receivedOn: x.receivedOn, amount: x.amount, mode: x.mode, bank: x.bank, instrumentNo: x.instrumentNo, accountNo: x.accountNo, note: x.note, splits });
      toast('Receipt saved. It counts once Head Accounts approves it (or the bank statement matches the cheque).');
      after();
      receiptDocDialog(made.id);
    });
    dl.classList.add('wide');
    const f = $('form', dl);
    const sum = () => { const tot = Object.keys(HEAD).reduce((a, h) => a + toNum(f['s_' + h].value), 0); const amt = toNum(f.amount.value); $('#sumline', dl).textContent = `Parts: ${inr(tot, 2)} of ${inr(amt, 2)}${Math.abs(tot - amt) < 0.005 && amt ? ' ✓' : ''}`; };
    f.addEventListener('input', sum);
    $('#auto', dl).onclick = () => { const amt = toNum(f.amount.value); const rate = (booking && booking.gstRate) || 5; const av = Math.round((amt / (1 + rate / 100)) * 100) / 100; f.s_av.value = av.toFixed(2); f.s_gst.value = (Math.round((amt - av) * 100) / 100).toFixed(2); sum(); };
  }

  // The payment receipt for the buyer: open it as a PDF, or email it (WhatsApp once connected).
  function receiptDocDialog(id) {
    const dl = dialog(`<h2>Payment receipt for the buyer</h2>
      <p class="muted">Opening the receipt gives it its number (DS/2026-27/0001 and so on). A cheque not yet cleared is marked "subject to realisation".</p>
      <div class="actions"><a class="btn" target="_blank" rel="noopener" href="/api/receipts?pdf=${id}">Open the receipt (PDF)</a><button type="button" class="ghost" id="rcEmail">Email it to the buyer</button>
        <button type="button" class="ghost" disabled title="Switches on once WhatsApp is connected">Send on WhatsApp (once connected)</button></div>
      <p class="small muted" id="rcMsg"></p>`, async () => {});
    $('[value=save]', dl).remove(); $('[value=cancel]', dl).textContent = 'Close';
    $('#rcEmail', dl).onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Sending…';
      try { const r = await api('/api/receipts', { action: 'receipt-email', id }); $('#rcMsg', dl).innerHTML = `<b class="good-t">✓ Sent.</b> Receipt ${esc(r.receiptNo)} emailed to ${esc(r.to.join(', '))}${r.test ? ' (test address: the ERP is not live yet)' : ''}.`;
        // shown as sent; it can be sent again after a moment if the buyer asks
        e.target.textContent = '✓ Emailed'; setTimeout(() => { e.target.disabled = false; e.target.textContent = 'Email it again'; }, 4000); }
      catch (err) { $('#rcMsg', dl).textContent = err.message; e.target.disabled = false; e.target.textContent = 'Email it to the buyer'; }
    };
    return dl;
  }

  async function receipts() {
    if (!proj) return noProject();
    if (/[?&]t=cheques/.test(location.hash)) { store.set('erp_rtab', 'cheques'); history.replaceState(null, '', '#/receipts'); }
    const tab = store.get('erp_rtab') || 'pending';
    const d = await api(`/api/receipts?project=${proj}${tab === 'all' || tab === 'cheques' ? '' : '&status=' + tab}`);
    if (tab === 'cheques') d.rows = d.rows.filter((r) => r.mode === 'cheque' && !r.bank_status && ['pending', 'approved'].includes(r.status));
    const labels = { pending: 'Waiting for approval', cheques: 'Cheques not in the bank yet', approved: 'Approved', bounced: 'Bounced', all: 'All' };
    const canDep = anyOf('accounts.enter', 'receipt.approve');
    $('#page').innerHTML = `<div class="page-head"><div><h1>Receipts</h1><p class="muted">The CRM enters each cheque or transfer and how it splits. The bank statement check (3:10 pm) finds it in the bank by itself: when the cheque number and amount match, it is approved and counts towards the buyer's balance; otherwise Head Accounts approves it. A returned cheque is marked bounced and the flat's CRM is told.</p></div>
      <div class="actions" style="margin:0">${canDep ? '<button class="ghost" id="bankNow">Look for the cheques in the bank now</button>' : ''}${can('receipt.enter') ? '<button id="new">Enter a receipt</button>' : ''}</div></div>
      <div class="tabs">${Object.keys(labels).map((k) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${labels[k]}</button>`).join('')}</div>
      ${tab === 'cheques' && canDep ? `<div class="panel depbar"><b>Deposit</b> <span class="small muted">Tick the cheques going to the bank together, choose the account, then click Deposited.</span>
        <div class="row4" style="margin-top:8px"><div><label>Bank account</label><select id="depBank"><option value="">Choose…</option></select></div><div><label>Deposited on</label><input type="date" id="depOn" max="${todayIso()}" value="${todayIso()}"></div>
        <div style="align-self:end"><label class="check"><input type="checkbox" id="depAll"> Tick all</label></div><div style="align-self:end"><button id="depGo" disabled>Deposited (0)</button></div></div></div>` : ''}
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit, buyer or UTR"><table><tr><th>Date</th><th>Unit</th><th>Buyer</th><th>Bank / instrument</th><th class="num">Amount</th><th>Split</th><th>Cheque</th><th>Status</th><th>Entered by</th><th></th></tr>
      ${d.rows.map((r) => `<tr data-s="${esc(((r.unit_no || '') + ' ' + (r.buyers || '') + ' ' + (r.instrument_no || '')).toLowerCase())}"><td>${tab === 'cheques' && canDep && !r.deposited_on ? `<input type="checkbox" class="depck" value="${r.id}" data-amt="${toNum(r.amount)}" aria-label="Deposited"> ` : ''}${fmtD(r.received_on)}</td><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no || '')}</a></td><td>${esc(r.buyers || '')}</td>
        <td>${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode)}</td><td class="num">${inr(r.amount, 2)}</td><td class="small">${Object.entries(r.splits).map(([h, v]) => `${HEAD[h] || h} ${inr(v)}`).join(' · ')}</td>
        <td>${chequeCell(r)}</td><td>${rStatus(r)}</td><td>${esc(r.created_by_name || 'Import / sample')}</td>
        <td class="num row-acts">${r.status === 'pending' && can('receipt.approve') ? `<button class="small" data-ok="${r.id}">Approve</button> <button class="ghost small" data-no="${r.id}">Reject</button>` : ''}
          ${r.status === 'approved' && can('receipt.approve') ? `<button class="danger small" data-bounce="${r.id}">Bounced</button>` : ''}
          ${r.mode === 'cheque' && !r.bank_status && ['pending', 'approved'].includes(r.status) ? `${!r.handed_on && !r.deposited_on && can('receipt.enter') ? `<button class="ghost small" data-hand="${r.id}">Given to Accounts</button>` : ''}${!r.acc_received_at && !r.deposited_on && canDep ? ` <button class="ghost small" data-rcv="${r.id}" title="The cheque has reached Accounts">Received</button>` : ''}${!r.deposited_on && canDep ? ` <button class="ghost small" data-dep="${r.id}">Deposited</button>` : ''}` : ''}
          ${['pending', 'approved'].includes(r.status) && !r.opening ? `<button class="ghost small" data-doc="${r.id}" title="${r.receipt_no ? 'Receipt ' + esc(r.receipt_no) + (r.receipt_sent_at ? ', emailed' : '') : 'Give the buyer a payment receipt'}">${r.receipt_no ? 'Receipt ✓' : 'Receipt'}</button>` : ''}
          <a class="btn link small" href="#/${can('accounts.view') && !can('demand.raise') ? 'accteam' : 'team'}/${r.booking_id}" title="Dream Chat with the other team about this flat">Chat</a></td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_rtab', t.dataset.t); receipts(); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    const act = async (body, msg) => { try { await api('/api/receipts', body); toast(msg); receipts(); } catch (e) { alert(e.message); } };
    document.querySelectorAll('[data-ok]').forEach((x) => (x.onclick = () => act({ action: 'approve', id: +x.dataset.ok }, 'Receipt approved.')));
    document.querySelectorAll('[data-no]').forEach((x) => (x.onclick = () => { const r = prompt('Reason for rejecting:'); if (r !== null) act({ action: 'reject', id: +x.dataset.no, reason: r }, 'Receipt rejected.'); }));
    document.querySelectorAll('[data-doc]').forEach((x) => (x.onclick = () => receiptDocDialog(+x.dataset.doc)));
    document.querySelectorAll('[data-rcv]').forEach((x) => (x.onclick = () => act({ action: 'received', id: +x.dataset.rcv }, 'Marked: the cheque is with Accounts.')));
    if ($('#depGo')) {
      api('/api/receipts?banks=1').then((r) => { $('#depBank').innerHTML = '<option value="">Choose…</option>' + r.banks.map((b) => `<option>${esc(b.name)}</option>`).join(''); }).catch(() => {});
      const upd = () => { const ck = [...document.querySelectorAll('.depck:checked')]; $('#depGo').disabled = !ck.length; $('#depGo').textContent = `Deposited (${ck.length}${ck.length ? ' · ' + inr(ck.reduce((a, c) => a + toNum(c.dataset.amt), 0)) : ''})`; };
      document.querySelectorAll('.depck').forEach((c) => (c.onchange = upd));
      $('#depAll').onchange = (e) => { document.querySelectorAll('.depck').forEach((c) => { if (c.closest('tr').style.display !== 'none') c.checked = e.target.checked; }); upd(); };
      $('#depGo').onclick = async () => {
        const ids = [...document.querySelectorAll('.depck:checked')].map((c) => +c.value);
        if (!$('#depBank').value && !confirm('No bank account chosen. Mark them deposited anyway?')) return;
        try { const r = await api('/api/receipts', { action: 'deposited', ids, on: $('#depOn').value, bank: $('#depBank').value }); toast(`${r.count} cheque(s) marked deposited${r.skipped ? `, ${r.skipped} skipped (already deposited or in the bank)` : ''}. The bank statement check will find them.`); receipts(); } catch (e) { alert(e.message); }
      };
    }
    document.querySelectorAll('[data-hand]').forEach((x) => (x.onclick = () => act({ action: 'handed', id: +x.dataset.hand }, 'Marked as given to Accounts today.')));
    document.querySelectorAll('[data-dep]').forEach((x) => (x.onclick = () => { const on = prompt('Deposited on (YYYY-MM-DD):', todayIso()); if (on) act({ action: 'deposited', id: +x.dataset.dep, on }, 'Marked deposited. The bank statement check will find it.'); }));
    if ($('#bankNow')) $('#bankNow').onclick = async () => { try { const o = await api('/api/receipts', { action: 'bankcheck' }); toast(`Found in the bank: ${o.linked} (${o.approved} approved by the bank statement, ${o.waiting} for Head Accounts). Returned: ${o.bounced}.`); receipts(); } catch (e) { alert(e.message); } };
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
        ${d.stages.map((s) => `<tr><td>${esc(s.name)} <span class="muted">(${toNum(s.pct)}%)</span></td>${d.buildings.map((b) => { const x = done(b.id, s.name); return `<td>${x ? `<span class="pill good" title="${esc([x.certified_by ? 'Certified by ' + x.certified_by : '', x.recorded_by ? 'recorded by ' + x.recorded_by : ''].filter(Boolean).join(', '))}">done ${fmtD(x.completed_on)}</span>${!x.raised && anyOf('stage.record', 'demand.approve') ? ` <button class="link small" data-undo="${x.id}" title="Recorded by mistake? Remove it (only before any demand is raised on it)">Remove</button>` : ''}` : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('')}</table></div>
      ${d.schedule ? `<div class="panel table-wrap"><h2>Payment schedule</h2><p class="muted small">What each stage of the payment plan is worth across all live bookings, and how much of it has come in. Each buyer's AV and TDS received is applied to their stages in order.</p>
        <table><tr><th>Stage</th><th class="num">%</th><th class="num">Due</th><th class="num">GST on it</th><th class="num">Received (AV + TDS)</th><th class="num">Balance</th></tr>
        ${[...d.schedule.rows, d.schedule.total].map((r, i, a) => `<tr class="${i === a.length - 1 ? 'tot' : ''}"><td>${i === a.length - 1 ? '<b>Total</b>' : esc(r.stage)}</td><td class="num">${Math.round(r.pct * 1000) / 10}%</td><td class="num">${inr(r.due)}</td><td class="num">${inr(r.gst)}</td><td class="num">${inr(r.received)}</td><td class="num ${r.balance > 1000 ? 'bad-t' : ''}">${inr(r.balance)}</td></tr>`).join('')}</table></div>` : ''}
      <div class="panel table-wrap"><h2>Demand runs</h2><table><tr><th>Building</th><th>Stage</th><th>Demand date</th><th>Due</th><th class="num">Letters</th><th class="num">Total</th><th>Status</th><th>Prepared by</th><th>Approved by</th></tr>
        ${d.runs.map((r) => `<tr class="click" data-r="${r.id}"><td>${esc(r.building || '')}</td><td>${esc(r.stage_name)}</td><td>${fmtD(r.demand_date)}</td><td>${fmtD(r.due_date)}</td><td class="num">${r.status === 'draft' ? '—' : r.letters}</td><td class="num">${r.status === 'draft' ? '—' : inr(r.total)}</td>
          <td>${r.status === 'draft' ? '<span class="pill">waiting for approval</span>' : r.status === 'approved' ? '<span class="pill good">raised</span>' : '<span class="pill grey">cancelled</span>'}</td><td>${esc(r.created_by_name || 'Sample')}</td><td>${esc(r.approved_by_name || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No demand runs yet.</td></tr>'}</table></div>`;
    document.querySelectorAll('tr[data-r]').forEach((tr) => (tr.onclick = () => go(`#/run/${tr.dataset.r}`)));
    document.querySelectorAll('[data-undo]').forEach((x) => (x.onclick = async () => {
      const reason = prompt('Remove this stage record? Any draft demand run for it is cancelled too. Reason (e.g. recorded by mistake, a test):');
      if (!reason) return;
      try { await api('/api/demands', { action: 'stage.undo', id: +x.dataset.undo, reason }); toast('Stage record removed.'); demands(); } catch (e) { alert(e.message); }
    }));
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
    if ($('#ok')) $('#ok').onclick = async () => { if (!confirm(`Raise ${d.rows.length} demands totalling ${inr(total)} plus GST?`)) return; try { const o = await api('/api/demands', { action: 'run.approve', id: r.id }); const L = o.letters || {}; toast(`${o.raised} demands raised. ` + (L.error ? 'Letters: ' + L.error : L.notEmailed ? `${L.letters} letters ready on the Demand letters page (${L.notEmailed})` : L.letters ? `${L.emailed} letters emailed${L.waiting ? ', ' + L.waiting + ' more within 5 minutes' : ''}${L.whatsapp ? ', ' + L.whatsapp + ' WhatsApps sent' : ''}${L.noEmail ? `. ${L.noEmail} buyer${L.noEmail > 1 ? 's have' : ' has'} no email: see Print and courier on Today` : ''}${L.errors ? ', ' + L.errors + ' could not be sent' : ''}.` : ''), 8000); runPage(id); } catch (e) { alert(e.message); } };
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
    $('#page').innerHTML = `<p class="crumbs no-print"><a href="#/flats">Flats &amp; buyers</a> › <a href="#/booking/${id}">${esc(h.unit_no)}</a> › Statement</p>
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
      ${d.courier && d.courier.length ? `<div class="panel" id="courier" style="margin-top:14px"><h3 style="margin:0 0 4px">Print and courier: ${d.courier.length} letter${d.courier.length > 1 ? 's' : ''}</h3>
        <p class="small muted" style="margin:0 0 8px">These buyers have no email address on file, so the letter could not be emailed. Print them, courier them, and ask for an email address on the next call.</p>
        <p class="small">${d.courier.map((c) => `<a href="/api/letters?pdf=${c.id}" target="_blank" rel="noopener">${esc(c.unit_no)}</a>`).join(' · ')}</p>
        <div class="actions" style="margin:0"><a class="btn" href="/api/letters?print=${d.courier.map((c) => c.id).join(',')}" target="_blank" rel="noopener">Print all (one PDF)</a>
        ${can('demand.raise') ? '<button class="ghost" id="couriered">Mark all as couriered</button>' : ''}</div></div>` : ''}
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
    if ($('#couriered')) $('#couriered').onclick = async () => { if (!confirm(`Mark ${d.courier.length} letters as sent by courier?`)) return; try { await api('/api/letters', { action: 'mark', projectId: proj, letterIds: d.courier.map((c) => c.id), via: 'courier' }); toast('Marked as couriered.'); letters(); } catch (e) { alert(e.message); } };
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
    if ($('#settings')) $('#settings').onclick = () => { dialog(`<h2>Letter settings</h2>
      <div class="row"><div><label>Delay charges (% a year)</label><input name="delayRate" value="${esc(s.delayRate)}"></div><div><label>Leave out buyers owing less than (₹)</label><input name="minDue" value="${esc(s.minDue)}"></div></div>
      <label>Signed for</label><input name="signedFor" value="${esc(s.signedFor)}">
      <label>CC on every email (once live)</label><input name="cc" value="${esc(s.cc)}" placeholder="crm.prime@dreamindiagroup.com">
      <label>Test email address (test version: all letters go here)</label><input name="testEmail" value="${esc(s.testEmail)}">
      <h3 style="margin:14px 0 4px">WhatsApp with each letter</h3><p class="small muted">Works once the WhatsApp number is connected through Click Connect. WhatsApp only lets a business message a buyer first with an approved template: choose the approved Click Connect template IDs here. Each template's text uses {{1}} buyer name, {{2}} flat, {{3}} amount, {{4}} due date.</p>
      <div class="row"><div><label>"Please check your email" template</label><input name="waEmailTemplate" list="waTpl" value="${esc(s.waEmailTemplate || '')}" placeholder="template ID"></div><div><label>Letter PDF template (buyers with no email)</label><input name="waPdfTemplate" list="waTpl" value="${esc(s.waPdfTemplate || '')}" placeholder="template ID"></div></div><datalist id="waTpl"></datalist>
      <label>Test mobile (test version: all WhatsApps go here)</label><input name="testMobile" value="${esc(s.testMobile || '')}" placeholder="98XXXXXXXX">
      <label>Automatic payment reminders</label><select name="autoReminders"><option value="1">On: email 3 days before the due date, and Reminder I 7 days after if unpaid</option><option value="0" ${s.autoReminders === false ? 'selected' : ''}>Off</option></select>
      <div class="row"><div><label>Signatory name (printed under "For …")</label><input name="signatory" value="${esc(s.signatory || '')}" placeholder="leave blank for no name"></div><div><label>Signatory designation</label><input name="signatoryTitle" value="${esc(s.signatoryTitle || '')}" placeholder="Authorised Signatory"></div></div>
      <label>Reference line (property)</label><input name="reference" value="${esc(s.reference || '')}" placeholder="C.T.S. Nos. 446C/2, Relief Road, Near Oshiwara Bridge, Jogeshwari (W), Mumbai - 400102">
      <h3 style="margin:14px 0 4px">Bank accounts printed on demand letters and receipts</h3><p class="small muted">Leave empty to keep the accounts the letters print today (YES Bank RERA account for the flat cost, YES Bank GST account).</p>
      ${[0, 1, 2].map((i) => { const k = (s.banks || [])[i] || {}; return `<fieldset class="appl"><legend>Account ${i + 1}</legend>
        <div class="row"><div><label>For (particulars)</label><input name="b${i}_particulars" value="${esc(k.particulars || '')}" placeholder="${i === 0 ? 'Flat Cost' : i === 1 ? 'Goods and Services Tax' : ''}"></div><div><label>Cheque favouring</label><input name="b${i}_favouring" value="${esc(k.favouring || '')}" placeholder="${i === 0 ? 'PRIME REALTORS RERA' : i === 1 ? 'PRIME REALTORS AC GST' : ''}"></div></div>
        <div class="row4"><div><label>Bank</label><input name="b${i}_bank" value="${esc(k.bank || '')}"></div><div><label>Account no.</label><input name="b${i}_accountNo" value="${esc(k.accountNo || '')}"></div><div><label>IFSC</label><input name="b${i}_ifsc" value="${esc(k.ifsc || '')}"></div><div><label>Branch</label><input name="b${i}_branch" value="${esc(k.branch || '')}"></div></div></fieldset>`; }).join('')}`,
    async (x) => {
      const banks = [0, 1, 2].map((i) => ({ particulars: x[`b${i}_particulars`], favouring: x[`b${i}_favouring`], bank: x[`b${i}_bank`], accountNo: x[`b${i}_accountNo`], ifsc: x[`b${i}_ifsc`], branch: x[`b${i}_branch`] }));
      await api('/api/letters', { action: 'settings', delayRate: x.delayRate, minDue: x.minDue, signedFor: x.signedFor, cc: x.cc, testEmail: x.testEmail, autoReminders: x.autoReminders === '1', testMobile: x.testMobile, waEmailTemplate: x.waEmailTemplate, waPdfTemplate: x.waPdfTemplate, signatory: x.signatory, signatoryTitle: x.signatoryTitle, reference: x.reference, banks });
      letters();
    }).classList.add('wide');
      // the approved WhatsApp templates (Click Connect), as choices for the two template boxes
      api('/api/comms', { action: 'wa-templates' }).then((r) => { const dl = $('#waTpl'); if (dl) dl.innerHTML = (r.templates || []).filter((t) => /approved/i.test(t.status)).map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${t.vars} value${t.vars === 1 ? '' : 's'}</option>`).join(''); }).catch(() => {}); };
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
        <td class="small" style="white-space:nowrap">${r.mobile ? (r.wa ? `<a href="tel:+91${esc(r.mobile)}">Call</a> · <a href="${esc(r.wa)}" target="_blank" rel="noopener">WhatsApp</a>` : esc(r.mobile)) : '<span class="muted">no mobile</span>'}${r.hasEmail && can('demand.raise') ? ` · <a href="#" data-mail="${r.booking_id}" data-u="${esc(r.unit_no)}">Email</a>` : ''}</td>
        <td>${can('demand.raise') ? `<button class="small" data-log="${r.booking_id}" data-u="${esc(r.unit_no)}">Log</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_ftab', t.dataset.t); followups(); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    document.querySelectorAll('[data-log]').forEach((b) => (b.onclick = () => followupForm(+b.dataset.log, b.dataset.u, d, followups)));
    document.querySelectorAll('[data-mail]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); followupEmail(+b.dataset.mail, b.dataset.u, followups); }));
  }
  async function followupEmail(bookingId, unit, after, reply) {
    const p = await api('/api/followups', { action: 'email', bookingId, preview: true });
    const plus = (n) => { const x = new Date(Date.now() + 5.5 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const T = p.templates, first = reply ? T.find((t) => t.key === 'general') : T[0];
    const subj0 = reply ? (/^re:/i.test(reply.subject || '') ? reply.subject : 'Re: ' + (reply.subject || first.subject)) : first.subject;
    const dl = dialog(`<h2>Email · ${esc(unit)}</h2>
      <p class="small muted">To: ${esc(p.to.join(', ') || 'no email on this booking')}. From the CRM mailbox; a copy is kept in this buyer's Communication record and replies come back to it.${p.live ? '' : '<br><b>Test version:</b> the email goes only to the test address in Letter settings, marked [TEST].'}${p.configured ? '' : '<br><span class="bad-t">Email is not set up yet, so it cannot be sent.</span>'}</p>
      <label>Address the buyer${p.people.length > 1 ? 's' : ''} as</label>
      <div class="row">${p.people.map((x) => `<div><select name="sal_${x.id}" required><option value="">Choose…</option>${p.salutations.map((v) => `<option ${x.salutation === v ? 'selected' : ''}>${v}</option>`).join('')}<option value="-" ${x.salutation === null && false ? 'selected' : ''}>(no title)</option></select> <span class="small">${esc(x.name)}</span></div>`).join('')}</div>
      <label>Purpose</label><select name="template">${T.map((t) => `<option value="${t.key}" ${t === first ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      <label>Subject</label><input name="subject" maxlength="200" value="${esc(subj0)}">
      <div class="mail-prev"><div class="small" id="emGreet"></div>
        <textarea name="body" rows="9">${esc(first.body)}</textarea>
        <pre class="mail-sig">${esc(p.signature)}</pre></div>
      <label>Next follow-up</label><input type="date" name="nextDate" min="${todayIso()}" value="${plus(3)}">`,
    async (x) => {
      const salutations = Object.fromEntries(p.people.map((y) => [y.id, x['sal_' + y.id] === '-' ? '' : x['sal_' + y.id]]));
      const r = await api('/api/followups', { action: 'email', bookingId, template: x.template, subject: x.subject, body: x.body, nextDate: x.nextDate, salutations, replyTo: reply ? reply.id : undefined });
      toast(r.test ? `Test email sent to ${r.to.join(', ')}.` : 'Email sent; a copy is in the buyer\'s record.'); after();
    });
    $('[value=save]', dl).textContent = 'Send email';
    const greet = () => { const names = p.people.map((y) => { const v = dl.querySelector(`[name=sal_${y.id}]`).value; return `${v && v !== '-' ? v + ' ' : ''}${y.name}`; });
      $('#emGreet', dl).textContent = `Dear ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || 'Sir / Madam'},`; };
    dl.querySelectorAll('[name^=sal_]').forEach((x) => (x.onchange = greet)); greet();
    dl.querySelector('[name=template]').onchange = (e) => { const t = T.find((z) => z.key === e.target.value); dl.querySelector('[name=subject]').value = reply ? subj0 : t.subject; dl.querySelector('[name=body]').value = t.body; };
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
    if (cur) unsoldList();
  }

  // Every unsold flat with its full cost from the current price list, filterable, printable, downloadable.
  async function unsoldList(parking = 0) {
    let box = $('#unsold');
    if (!box) { $('#page').insertAdjacentHTML('beforeend', '<div class="panel" id="unsold"><h2>All unsold flats</h2><p class="muted small">Working it out…</p></div>'); box = $('#unsold'); }
    const d = await api(`/api/prices?project=${proj}&unsold=1&parking=${parking}`);
    const wings = [...new Set(d.rows.map((r) => r.wing))], types = [...new Set(d.rows.map((r) => r.typology).filter(Boolean))].sort();
    const st = { available: 'available', blocked: 'booking being entered', held: 'held' };
    box.innerHTML = `<h2>All unsold flats (${d.rows.length})</h2><p class="small muted">From the price list "${esc(d.priceList.name)}": carpet area × (base rate + floor rise), ${parking ? parking + ' parking' : 'no parking'}, GST, stamp duty at the normal rate, registration and other charges.</p>
      <div class="row4 no-print"><div><label>Wing</label><select id="uw"><option value="">All</option>${wings.map((w) => `<option>${esc(w)}</option>`).join('')}</select></div><div><label>Type</label><select id="ut"><option value="">All</option>${types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div><label>Show</label><select id="us"><option value="">All unsold</option><option value="available">Available only</option><option value="held">Held only</option></select></div><div><label>Parking spaces</label><input id="up" type="number" min="0" value="${parking}"></div></div>
      <div class="actions no-print"><button class="ghost small" id="uPrint">Print</button><button class="ghost small" id="uCsv">Download (Excel / CSV)</button></div>
      <div class="table-wrap"><table id="utbl"><tr><th>Flat</th><th class="num">Floor</th><th>Type</th><th class="num">Carpet sq ft</th><th class="num">Rate / sq ft</th><th class="num">Agreement value</th><th class="num">GST</th><th class="num">Stamp duty</th><th class="num">Registration</th><th class="num">Other</th><th class="num">Total cost</th><th>Status</th><th></th></tr>
        ${d.rows.map((r) => `<tr data-w="${esc(r.wing)}" data-t="${esc(r.typology || '')}" data-st="${r.status === 'held' ? 'held' : 'available'}"><td><b>${esc(r.unit_no)}</b></td><td class="num">${r.floor ?? ''}</td><td>${esc(r.typology || '')}</td><td class="num">${r.carpet_sqft || ''}</td>
          ${r.error ? `<td colspan="7" class="muted">${esc(r.error)}</td>` : `<td class="num">${inr(r.rate)}</td><td class="num">${inr(r.agreementValue)}</td><td class="num">${inr(r.gst)}</td><td class="num">${inr(r.stampDuty)}</td><td class="num">${inr(r.registration)}</td><td class="num">${r.others ? inr(r.others) : '—'}</td><td class="num"><b>${inr(r.total)}</b></td>`}
          <td class="small">${esc(st[r.status] || r.status)}${r.held_for ? ': ' + esc(r.held_for) : ''}</td><td class="no-print">${r.error ? '' : `<a class="btn link small" target="_blank" rel="noopener" href="/api/prices?unit=${r.id}&parking=${parking}&html=1">Cost sheet</a>`}</td></tr>`).join('')}</table></div>`;
    const filt = () => { const w = $('#uw').value, t = $('#ut').value, x = $('#us').value; document.querySelectorAll('#utbl tr[data-w]').forEach((tr) => { tr.style.display = (!w || tr.dataset.w === w) && (!t || tr.dataset.t === t) && (!x || tr.dataset.st === x) ? '' : 'none'; }); };
    ['uw', 'ut', 'us'].forEach((k) => ($('#' + k).onchange = filt));
    $('#up').onchange = (e) => unsoldList(Math.max(0, parseInt(e.target.value, 10) || 0));
    $('#uPrint').onclick = () => { const w = window.open('', '_blank'); w.document.write(`<html><head><title>Unsold flats</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px}td.num,th.num{text-align:right}.no-print{display:none}</style></head><body><h2>Unsold flats · ${esc(d.priceList.name)}</h2>${$('#utbl').outerHTML.replace(/<tr [^>]*style="display: none;"[^>]*>[\s\S]*?<\/tr>/g, '')}</body></html>`); w.document.close(); w.print(); };
    $('#uCsv').onclick = () => {
      const vis = d.rows.filter((r) => { const w = $('#uw').value, t = $('#ut').value, x = $('#us').value; return (!w || r.wing === w) && (!t || r.typology === t) && (!x || (r.status === 'held' ? 'held' : 'available') === x); });
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [['Flat', 'Floor', 'Type', 'Carpet sq ft', 'Rate per sq ft', 'Agreement value', 'GST', 'Stamp duty', 'Registration', 'Other', 'Total cost', 'Status']].concat(vis.map((r) => [r.unit_no, r.floor, r.typology, r.carpet_sqft, r.rate, r.agreementValue, r.gst, r.stampDuty, r.registration, r.others, r.total, (st[r.status] || r.status) + (r.held_for ? ': ' + r.held_for : '')])).map((l) => l.map(q).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `unsold-flats-${todayIso()}.csv`; a.click();
    };
  }

  // ---------- channel partners and brokerage ----------
  // ---------- channel partner ledger, firm by firm ----------
  const cpForm = (f, after) => dialog(`<h2>${f ? 'Partner firm · ' + esc(f.name) : 'Add a channel partner firm'}</h2>
      <label>Firm name</label><input name="name" required value="${esc(f ? f.name : '')}">
      <div class="row"><div><label>Contact person</label><input name="contactPerson" value="${esc(f?.contact_person || '')}"></div><div><label>Mobile</label><input name="phone" value="${esc(f?.phone || '')}"></div></div>
      <div class="row"><div><label>Email</label><input name="email" value="${esc(f?.email || '')}"></div><div><label>Usual brokerage %</label><input name="defaultPct" inputmode="decimal" value="${f?.default_pct != null ? toNum(f.default_pct) : ''}" placeholder="e.g. 2"></div></div>
      <div class="row4"><div><label>PAN</label><input name="pan" value="${esc(f?.pan || '')}"></div><div><label>GSTIN</label><input name="gstin" value="${esc(f?.gstin || '')}"></div><div><label>MahaRERA agent no.</label><input name="reraNo" value="${esc(f?.rera_no || '')}"></div><div><label>Active</label><select name="active"><option value="true">Yes</option><option value="false" ${f && !f.active ? 'selected' : ''}>No</option></select></div></div>
      <label>Note</label><input name="note" value="${esc(f?.note || '')}">`,
    async (x) => { const r = await api('/api/partners', { action: 'cp-save', id: f ? f.id : null, ...x, active: x.active === 'true' }); toast('Saved.'); after(r.id); });

  async function partners() {
    if (!proj) return noProject();
    const d = await api(`/api/partners?project=${proj}&ledger=1`);
    const F = d.firms, sum = (k) => F.reduce((a, f) => a + toNum(f[k]), 0);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Channel partner ledger</h1><p class="muted">Firm by firm: the brokerage earned on its live bookings, the bills received, pass back, payments (RTGS) and what is still owed. A payment counts once someone else has verified it. Brokerage is due once ${d.rule.afterRegistration ? 'the agreement is registered and ' : ''}${d.rule.minReceivedPct}% of the agreement value has been received.</p></div>
      <div class="actions" style="margin:0">${d.can.firm ? '<button id="cpAdd">Add a firm</button>' : ''}${d.can.rule ? '<button class="ghost" id="rule">Change the rule</button>' : ''}</div></div>
      <div class="panel"><div class="kpis">${kpi(F.filter((f) => f.flats).length, 'firms with live bookings')}${kpi(F.reduce((a, f) => a + f.flats, 0), 'bookings via partners')}${kpi(cr(sum('brokerage')), 'brokerage earned')}${kpi(cr(sum('passBack')), 'pass back')}${kpi(cr(sum('paid') + sum('paidBefore')), 'paid (RTGS)')}${kpi(cr(sum('toVerify')), 'waiting to be verified', sum('toVerify') ? 'bad' : '')}${kpi(cr(sum('balance')), 'still owed')}${kpi(cr(sum('dueNow')), 'due now', sum('dueNow') ? 'bad' : '')}</div></div>
      <div class="panel table-wrap"><input class="search" id="cpq" placeholder="Find a firm"><table id="cpt"><tr><th>Firm</th><th class="num">Flats</th><th class="num">Agreement value</th><th class="num">Collected</th><th class="num">Brokerage</th><th class="num">Billed</th><th class="num">Pass back</th><th class="num">Paid (RTGS)</th><th class="num">To verify</th><th class="num">Balance</th><th class="num">Due now</th></tr>
        ${F.map((f) => `<tr class="click" data-cp="${f.id}" data-s="${esc(f.name.toLowerCase())}"><td><b>${esc(f.name)}</b>${f.active ? '' : ' <span class="pill grey">inactive</span>'}${f.cancelled ? `<br><span class="small muted">${f.cancelled} cancelled${f.recoverable ? ', ' + inr(f.recoverable) + ' to recover' : ''}</span>` : ''}</td><td class="num">${f.flats}</td><td class="num">${cr(f.agreementValue)}</td><td class="num">${cr(f.received)}</td>
          <td class="num">${inr(f.brokerage)}</td><td class="num">${f.billed ? inr(f.billed) : '—'}</td><td class="num">${f.passBack ? inr(f.passBack) : '—'}</td><td class="num">${f.paid + f.paidBefore ? inr(f.paid + f.paidBefore) : '—'}</td><td class="num ${f.toVerify ? 'bad-t' : ''}">${f.toVerify ? inr(f.toVerify) : '—'}</td>
          <td class="num"><b>${inr(f.balance)}</b></td><td class="num ${f.dueNow ? 'bad-t' : ''}">${f.dueNow ? inr(f.dueNow) : '—'}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">No channel partner bookings yet.</td></tr>'}</table></div>`;
    document.querySelectorAll('tr[data-cp]').forEach((tr) => (tr.onclick = () => go(`#/cp/${tr.dataset.cp}`)));
    $('#cpq').oninput = (e) => { const v = e.target.value.trim().toLowerCase(); document.querySelectorAll('#cpt tr[data-s]').forEach((tr) => { tr.style.display = !v || tr.dataset.s.includes(v) ? '' : 'none'; }); };
    if ($('#cpAdd')) $('#cpAdd').onclick = () => cpForm(null, (id) => go(`#/cp/${id}`));
    if ($('#rule')) $('#rule').onclick = () => dialog(`<h2>When brokerage becomes due</h2>
      <label class="check"><input type="checkbox" name="afterRegistration" ${d.rule.afterRegistration ? 'checked' : ''}> Only after the agreement is registered</label>
      <label>And at least this % of the agreement value received</label><input name="minReceivedPct" type="number" min="0" max="100" step="0.5" value="${esc(d.rule.minReceivedPct)}">`,
    async (x) => { await api('/api/partners', { action: 'rule', afterRegistration: x.afterRegistration === 'on', minReceivedPct: x.minReceivedPct }); partners(); });
  }

  async function cpPage(id) {
    const d = await api(`/api/partners?project=${proj}&cp=${id}`);
    const f = d.firm;
    const KIND = { bill: 'Bill received', pass_back: 'Pass back', payment: 'Paid (RTGS)' };
    const live = d.bookings.filter((b) => b.status === 'active'), canc = d.bookings.filter((b) => b.status === 'cancelled');
    $('#page').innerHTML = `<p class="crumbs"><a href="#/partners">Channel partner ledger</a> › ${esc(f.name)}</p>
      <div class="page-head"><div><h1>${esc(f.name)}${f.active ? '' : ' <span class="pill grey">inactive</span>'}</h1><p class="muted">${esc([f.contact_person, f.phone, f.email, f.pan ? 'PAN ' + f.pan : '', f.gstin ? 'GSTIN ' + f.gstin : '', f.rera_no ? 'RERA ' + f.rera_no : '', f.default_pct != null ? 'usual brokerage ' + toNum(f.default_pct) + '%' : ''].filter(Boolean).join(' · ') || 'No contact details yet.')}</p></div>
        <div class="actions" style="margin:0">${d.can.firm ? '<button class="ghost" id="cpEdit">Firm details</button>' : ''}${d.can.bill ? '<button class="ghost" data-k="bill">Record a bill</button><button class="ghost" data-k="pass_back">Pass back</button>' : ''}${d.can.pay ? '<button data-k="payment">Record a payment (RTGS)</button>' : ''}</div></div>
      <div class="panel"><div class="kpis">${kpi(f.flats, 'live bookings')}${kpi(cr(f.agreementValue), 'agreement value')}${kpi(cr(f.received), 'collected')}${kpi(inr(f.brokerage), 'brokerage earned')}${kpi(inr(f.passBack), 'pass back')}${kpi(inr(f.paid + f.paidBefore), 'paid (RTGS)')}${kpi(inr(f.toVerify), 'waiting to be verified', f.toVerify ? 'bad' : '')}${kpi(inr(f.balance), 'balance owed')}${kpi(inr(f.dueNow), 'due now', f.dueNow ? 'bad' : '')}</div>
        <p class="small muted">Balance = brokerage earned − pass back − paid. ${f.billed ? `Bills received: ${inr(f.billed)}.` : 'No bills received yet.'}${f.recoverable ? ` <b class="bad-t">${inr(f.recoverable)} was paid on cancelled bookings: recover or adjust it.</b>` : ''}</p></div>
      <div class="panel table-wrap"><h2>Bookings</h2><table><tr><th>Flat</th><th>Buyer</th><th class="num">Agreement value</th><th class="num">%</th><th class="num">Brokerage</th><th class="num">Received</th><th>Registered</th><th class="num">Pass back</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr>
        ${[...live, ...canc].map((b) => `<tr class="${b.status === 'cancelled' ? 'dim' : ''}"><td><a href="#/booking/${b.booking_id}">${esc(b.unit_no)}</a></td><td>${esc(b.buyers || '')}</td><td class="num">${inr(b.agreement_value)}</td><td class="num">${b.brokerage_pct != null ? toNum(b.brokerage_pct) + '%' : '—'}</td><td class="num">${b.status === 'active' ? inr(b.brokerage) : '—'}</td>
          <td class="num">${toNum(b.received_pct)}%</td><td>${b.registration_date ? fmtD(b.registration_date) : '<span class="muted">no</span>'}</td><td class="num">${b.pass_back ? inr(b.pass_back) : '—'}</td><td class="num">${b.paid + b.paid_before ? inr(b.paid + b.paid_before) : '—'}${b.to_verify ? `<br><span class="small bad-t">${inr(b.to_verify)} to verify</span>` : ''}</td>
          <td class="num">${b.status === 'active' ? inr(b.balance) : '—'}</td><td>${{ Due: '<span class="pill bad">due</span>', 'Not yet due': `<span class="pill grey">not yet due</span><br><span class="small muted">${esc(b.why)}</span>`, Paid: '<span class="pill good">paid</span>', 'No amount': '<span class="pill">no amount</span>', Cancelled: '<span class="pill grey">cancelled</span>', 'Cancelled: recover': '<span class="pill bad">cancelled: recover</span>' }[b.state] || ''}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">No bookings through this firm.</td></tr>'}</table></div>
      <div class="panel table-wrap"><h2>Ledger</h2><table><tr><th>Date</th><th>Entry</th><th>Flat</th><th>Bill / UTR</th><th class="num">Amount</th><th>Status</th><th>By</th><th></th></tr>
        ${d.entries.map((e) => `<tr><td>${fmtD(e.entry_date)}</td><td>${KIND[e.kind] || e.kind}</td><td>${esc(e.unit_no || 'whole firm')}</td><td>${esc(e.reference || '')}${e.note ? `<br><span class="small muted">${esc(e.note)}</span>` : ''}</td><td class="num">${inr(e.amount)}</td>
          <td>${e.kind === 'payment' ? (e.verified_at ? `<span class="pill good">verified</span><br><span class="small muted">${esc(e.verified_name || '')}</span>` : '<span class="pill bad">to verify</span>') : ''}</td><td>${esc(e.by_name || '')}</td>
          <td style="white-space:nowrap">${e.kind === 'payment' && !e.verified_at && d.can.verify && e.created_by !== d.me ? `<button class="small" data-ver="${e.id}">Verify</button>` : ''}${d.can.verify ? ` <button class="link small" data-cx="${e.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No bills, pass back or payments yet.</td></tr>'}</table>
        <p class="small muted">Before verifying a payment, check it against the partner's bill, the bookings above and the bank statement. The person who entered a payment cannot verify it.</p></div>
      <div class="panel" id="cpdocs"><h2>Bills and papers</h2><p class="muted small">Loading…</p></div>`;
    docsPanel('cp', f.id, $('#cpdocs'), f.name);
    if ($('#cpEdit')) $('#cpEdit').onclick = () => cpForm(f, () => cpPage(id));
    document.querySelectorAll('[data-k]').forEach((x) => (x.onclick = () => {
      const k = x.dataset.k;
      dialog(`<h2>${KIND[k]} · ${esc(f.name)}</h2>
        <p class="muted">Balance owed ${inr(f.balance)}${f.toVerify ? `, of which ${inr(f.toVerify)} is already paid and waiting to be verified` : ''}.${k === 'payment' ? ' The payment counts once someone else verifies it.' : ''}</p>
        <label>Flat (or the whole firm)</label><select name="bookingId"><option value="">Whole firm</option>${live.map((b) => `<option value="${b.booking_id}">${esc(b.unit_no)} · balance ${inr(b.balance)}${b.state === 'Not yet due' ? ' · not yet due' : ''}</option>`).join('')}</select>
        <div class="row"><div><label>Date</label><input type="date" name="date" max="${todayIso()}" value="${todayIso()}" required></div><div><label>Amount (₹)</label><input name="amount" inputmode="decimal" required></div></div>
        <div class="row"><div><label>${k === 'bill' ? 'Bill / invoice no.' : k === 'payment' ? 'UTR / cheque no.' : 'Reference (optional)'}</label><input name="reference" ${k === 'pass_back' ? '' : 'required'}></div><div><label>Note</label><input name="note" placeholder="${k === 'pass_back' ? 'e.g. passed back to the buyer of A-1002' : ''}"></div></div>
        ${k === 'payment' && can('cancellation.approve') ? '<label class="check"><input type="checkbox" name="override"> Management approves paying before the brokerage is due</label>' : ''}`,
      async (v) => { const r = await api('/api/partners', { action: 'cp-entry', projectId: proj, cpId: f.id, kind: k, ...v, bookingId: v.bookingId || null, override: v.override === 'on' }); toast(r.toVerify ? 'Payment recorded. It counts once someone else verifies it.' : 'Saved.'); cpPage(id); });
    }));
    document.querySelectorAll('[data-ver]').forEach((x) => (x.onclick = async () => { if (!confirm('Verify this payment? Check it against the bill and the bank statement first.')) return; try { await api('/api/partners', { action: 'cp-verify', id: +x.dataset.ver }); toast('Payment verified.'); cpPage(id); } catch (e) { alert(e.message); } }));
    document.querySelectorAll('[data-cx]').forEach((x) => (x.onclick = async () => { const r = prompt('Cancel this entry? It stays in the audit log. Reason:'); if (!r) return; try { await api('/api/partners', { action: 'cp-cancel', id: +x.dataset.cx, reason: r }); cpPage(id); } catch (e) { alert(e.message); } }));
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
    cancellations: ['cancel_date', 'unit_no', 'client', 'final_av', 'received', 'deduction', 'refund_due', 'refund_rtgs', 'refund_white', 'refund_status', 'crm_now', 'books_received', 'books_refunded', 'to_refund', 'books_check', 'cp'],
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
      async (x) => { if (!d.can.enter) return; const data = {}; for (const c of cols) if (!c.calc && c.key in x) data[c.key] = x[c.key]; const r = await api('/api/accounts', { action: 'save', reg: key, id: row ? row.id : undefined, data, poId: form.poId || undefined }); if (form.poId) toast(r.billPaid ? 'Purchase bill marked Paid.' : 'Saved, but the purchase bill could not be marked Paid: ' + (r.billError || ''), 6000); toast(row ? 'Saved.' : `Added${r.ref_id ? ' as ' + r.ref_id : ''}.`); accRegister(key, { limit: state.limit }); });
      dl.classList.add('wide');
      if (!d.can.enter) $('[value=save]', dl).remove();
      form.poId = null;
      if (key === 'payments' && d.can.enter) payHelp(dl, row);
    };
    // Payments Out: pay an approved purchase bill (fills the row), and TDS from the head's section and rate
    const payHelp = async (dl, row) => {
      const P = await api('/api/accounts?view=bills').catch(() => ({ bills: [], tds: {} }));
      const F = (k) => dl.querySelector(`[name="${k}"]`);
      const setV = (k, v) => { const el = F(k); if (!el || v == null || v === '') return; if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(v))) el.add(new Option(v, v)); el.value = v; };
      const pctIn = (el) => { const x = toNum(String(el.value).replace('%', '')); return x > 1 ? x / 100 : x; };
      const work = () => {
        const T = P.tds[F('head') && F('head').value];
        if (T) { if (F('tds_section') && !F('tds_section').value) F('tds_section').value = T.sec; if (F('tds_rate') && !F('tds_rate').value && T.rate != null) F('tds_rate').value = (T.rate * 100) + '%'; }
        const base = toNum(F('taxable_value') && F('taxable_value').value), rate = F('tds_rate') && F('tds_rate').value ? pctIn(F('tds_rate')) : 0;
        if (base && rate && F('tds_deducted') && !F('tds_deducted').dataset.typed) F('tds_deducted').value = Math.round(base * rate);
        const tot = toNum(F('total_bill') && F('total_bill').value), ded = toNum(F('tds_deducted') && F('tds_deducted').value);
        if (tot && F('net_payable') && !F('net_payable').dataset.typed) F('net_payable').value = Math.round((tot - ded) * 100) / 100;
        if (form.poId && F('net_payable') && toNum(F('net_payable').value) && F('amount')) F('amount').value = toNum(F('net_payable').value); // pay the bill less TDS
      };
      ['head', 'taxable_value', 'tds_rate', 'total_bill', 'tds_deducted'].forEach((k) => F(k) && F(k).addEventListener('change', work));
      ['tds_deducted', 'net_payable'].forEach((k) => F(k) && F(k).addEventListener('input', () => (F(k).dataset.typed = 1)));
      if (row || !P.bills.length) return;
      const box = document.createElement('div'); box.className = 'note'; box.style.margin = '0 0 10px';
      box.innerHTML = `<label style="margin:0 0 4px"><b>Paying an approved purchase bill?</b> (${P.bills.length} approved by Accounts, waiting to be paid)</label><select id="poPick"><option value="">No, an ordinary payment</option>${P.bills.map((b) => `<option value="${esc(b.id)}">${esc(b.vendor || 'Vendor')} · ${esc(b.material || '')}${b.billNo ? ' · bill ' + esc(b.billNo) : ''} · ${inr(b.amount)}</option>`).join('')}</select>
        <p class="small muted" style="margin:4px 0 0">Choosing one fills the payee, head, amount and bill details. When you save, the order is marked Paid on the Purchase page.</p>`;
      const h2 = dl.querySelector('h2'); h2.after(box);
      $('#poPick', dl).onchange = (e) => {
        const b = P.bills.find((x) => x.id === e.target.value); form.poId = b ? b.id : null; if (!b) return;
        setV('payee', b.vendor); setV('head', b.head); setV('amount', b.amount); setV('total_bill', b.amount); setV('bill_no', b.billNo); setV('bill_date', b.billDate); setV('bill_ids', b.poNo || b.id);
        setV('description', `${b.material || 'Purchase'} · ${b.line ? b.line.replace('|', ' ') : ''}`.trim()); setV('remark', 'Against approved purchase bill ' + (b.poNo || b.id));
        const det = dl.querySelector('details'); if (det) det.open = true; work();
      };
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
  // ---------- communication with buyers (email both ways, WhatsApp) ----------
  const chIcon = (c) => (c.channel === 'whatsapp' ? 'WhatsApp' : 'Email') + (c.direction === 'in' ? ' from buyer' : ' sent');
  const tick = (d) => ({ sent: '✓', delivered: '✓✓', read: '✓✓ read', failed: 'failed' }[d] || '');
  function msgHtml(c, opts = {}) {
    const att = (c.attachments || []).map((a) => a.docId ? `<button class="link small" data-doc="${a.docId}" data-n="${esc(a.name)}">📎 ${esc(a.name)}</button>` : `<span class="small muted">📎 ${esc(a.name)}${a.note ? ' (' + esc(a.note) + ')' : ''}</span>`).join(' ');
    const long = (c.body || '').length > 420;
    return `<div class="msg ${c.direction} ${c.read_at || c.direction === 'out' ? '' : 'unread'}" data-id="${c.id}">
      <div class="msg-h"><b>${chIcon(c)}</b>${opts.unit && c.unit_no ? ` · <a href="#/booking/${c.booking_id}">${esc(c.unit_no)}</a>` : ''} · <span class="muted">${fmtDate(c.sent_at)}</span>
        ${c.direction === 'out' ? `<span class="muted small"> · ${esc(c.sent_by_name || 'ERP')}${c.delivery ? ' · ' + tick(c.delivery) : ''}</span>` : `<span class="muted small"> · ${esc(c.from_addr || '')}</span>`}</div>
      ${c.subject ? `<div class="msg-s">${esc(c.subject)}</div>` : ''}
      <div class="msg-b ${long ? 'clip' : ''}">${esc(c.body || '').replace(/\n/g, '<br>')}</div>${long ? '<button class="link small" data-more>Show all</button>' : ''}
      ${att ? `<div class="msg-a">${att}</div>` : ''}
      ${opts.actions || ''}</div>`;
  }
  function wireMsgs(el) {
    el.querySelectorAll('[data-more]').forEach((x) => (x.onclick = () => { x.previousElementSibling.classList.remove('clip'); x.remove(); }));
    el.querySelectorAll('[data-doc]').forEach((x) => (x.onclick = () => openDoc(+x.dataset.doc, x.dataset.n)));
  }
  async function commPanel(bookingId, unit, el) {
    const d = await api(`/api/comms?booking=${bookingId}`);
    const unread = d.rows.filter((c) => c.direction === 'in' && !c.read_at).map((c) => c.id);
    el.innerHTML = `<h2>Communication <span class="muted small">${d.rows.length} message${d.rows.length === 1 ? '' : 's'}</span>
        ${d.canAct ? `<span style="float:right"><button class="ghost small" id="cmMail">Email</button> ${d.whatsapp.configured ? '<button class="ghost small" id="cmWa">WhatsApp</button>' : ''}</span>` : ''}</h2>
      <p class="small">CRM in charge: <b>${esc(d.crm.people.join(', ') || 'nobody yet')}</b> <span class="muted">(${d.crm.by === 'flat' ? 'set for this flat' : d.crm.by === 'wing' ? 'wing team' : 'no wing team yet, so Head CRM'})</span>
        ${d.canTeams ? ` · <select id="cmOwn" class="small"><option value="">Use the wing team</option>${d.crmUsers.map((x) => `<option value="${x.id}" ${x.id === d.crm.own ? 'selected' : ''}>${esc(x.name)} only</option>`).join('')}</select>` : ''}</p>
      ${d.whatsapp.configured ? '' : '<p class="small muted">WhatsApp messages will appear here once the WhatsApp Business number is connected.</p>'}
      <div class="msgs">${d.rows.map((c) => msgHtml(c, { actions: c.direction === 'in' && c.channel === 'email' && d.canAct ? `<div class="msg-x"><button class="link small" data-reply="${c.id}">Reply</button></div>` : '' })).join('') || '<p class="muted">No emails or WhatsApps with this buyer yet. Emails sent from the ERP, and the buyer\'s replies, appear here.</p>'}</div>`;
    wireMsgs(el);
    const again = () => commPanel(bookingId, unit, el);
    if ($('#cmMail', el)) $('#cmMail', el).onclick = () => followupEmail(bookingId, unit, again);
    if ($('#cmOwn', el)) $('#cmOwn', el).onchange = async (e) => { await api('/api/comms', { action: 'allocate', bookingId, userId: e.target.value || null }); toast('CRM in charge updated.'); again(); };
    el.querySelectorAll('[data-reply]').forEach((x) => (x.onclick = () => { const c = d.rows.find((r) => r.id === +x.dataset.reply); followupEmail(bookingId, unit, again, c); }));
    if ($('#cmWa', el)) $('#cmWa', el).onclick = () => {
      const dl = dialog(`<h2>WhatsApp · ${esc(unit)}</h2>${d.whatsapp.window ? '<label>Message</label><textarea name="text" rows="5" required></textarea><p class="small muted">The buyer messaged in the last 24 hours, so a normal message can be sent.</p>'
        : '<p class="small muted">The buyer has not messaged in the last 24 hours. WhatsApp allows only an approved template.</p><label>Template name</label><input name="template" required placeholder="e.g. payment_reminder"><label>Values for {{1}}, {{2}}… (one per line)</label><textarea name="params" rows="3"></textarea>'}`,
      async (x) => { await api('/api/comms', { action: 'whatsapp', bookingId, text: x.text, template: x.template, params: x.params ? x.params.split('\n').map((s) => s.trim()).filter(Boolean) : [] }); toast('WhatsApp sent.'); again(); });
      $('[value=save]', dl).textContent = 'Send';
    };
    if (unread.length && d.canAct) api('/api/comms', { action: 'read', ids: unread }).catch(() => {});
  }
  // ---------- install as an app on the computer ----------
  // Chrome and Edge offer to install the ERP (its own window and a Dream India icon on the desktop / dock).
  let installEv = null;
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch {}
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; const b = $('#instApp'); if (b) b.hidden = false; });
  window.addEventListener('appinstalled', () => { installEv = null; const b = $('#instApp'); if (b) b.hidden = true; });
  const standalone = () => window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  function installButton() {
    if (standalone()) return '';
    return `<button class="ghost small" id="instApp" ${installEv ? '' : 'hidden'} title="Install the ERP on this computer: its own window and a Dream India icon">Install app</button>`;
  }
  function wireInstall() {
    const b = $('#instApp'); if (!b) return;
    b.onclick = async () => { if (!installEv) { alert('Use the install icon at the right end of the Chrome or Edge address bar, or Chrome menu → Cast, save and share → Install page as app.'); return; } installEv.prompt(); await installEv.userChoice.catch(() => {}); installEv = null; b.hidden = true; };
  }

  // ---------- a new version of the ERP ----------
  // The ERP is one page that stays open all day, so a release is not picked up until the page is reloaded. Every few
  // minutes the page checks whether app.js has changed on the server and, if so, offers to reload.
  (() => {
    let first = null, shown = false;
    const tag = async () => { try { const r = await fetch('/app.js', { method: 'HEAD', cache: 'no-store' }); return r.headers.get('etag') || r.headers.get('last-modified'); } catch { return null; } };
    const check = async () => {
      if (shown) return;
      const t = await tag(); if (!t) return;
      if (!first) { first = t; return; }
      if (t !== first) {
        shown = true;
        const b = document.createElement('div'); b.className = 'upd no-print';
        b.innerHTML = '<span>The ERP has been updated.</span><button type="button">Reload now</button>';
        b.querySelector('button').onclick = () => location.reload();
        document.body.appendChild(b);
      }
    };
    check(); setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  })();

  // ---------- Dream Chat: the chat window (CRM ↔ Accounts), on every page ----------
  // A button in the bottom corner; the window opens over the page in use. New messages come in every few seconds
  // (every 30 s while the tab is in the background), with a sound and a pop-up, and a desktop notification when allowed.
  const chat = (() => {
    let el = null, last = 0, seenTop = 0, open = false, timer = null, rows = [], team = null, myId = null, unread = 0, busy = false;
    const allowed = () => !!me && anyOf('ledger.view', 'accounts.view', 'receipt.enter');
    const full = () => `#/${can('accounts.view') && !can('demand.raise') ? 'accteam' : 'team'}`;
    const tName = (t) => (t === 'crm' ? 'CRM' : 'Accounts');
    const time = (x) => { const d = new Date(x), today = new Date().toDateString() === d.toDateString(); return d.toLocaleString('en-IN', today ? { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }); };
    // Sounds: a swoosh when a message goes, a soft two-note chime when one comes in. Browsers keep a page silent
    // until it is clicked or typed in once, so the sound is switched on at the first click or key press.
    let actx = null;
    const audio = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} return actx; };
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, audio, { once: false, passive: true }));
    const soundOn = () => store.get('erp_chat_sound') !== 'off';
    function sound(kind) {
      if (!soundOn()) return;
      const a = audio(); if (!a || a.state !== 'running') return;
      const t0 = a.currentTime;
      if (kind === 'out') {
        // swoosh: a burst of noise swept through a band-pass filter
        const len = 0.32, buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
        src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
        f.frequency.setValueAtTime(500, t0); f.frequency.exponentialRampToValueAtTime(5000, t0 + len);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        src.connect(f).connect(g).connect(a.destination); src.start(t0); src.stop(t0 + len);
      } else if (kind === 'mail') {
        // a buyer's email or WhatsApp: three bright bell notes going up, clearly not the Dream Chat chime
        [[1047, 0], [1319, 0.11], [1568, 0.22]].forEach(([fq, t]) => { const o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = fq; o2.type = 'sine'; o2.frequency.value = fq * 2;
          g.gain.setValueAtTime(0.0001, t0 + t); g.gain.exponentialRampToValueAtTime(0.3, t0 + t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.6);
          o.connect(g); o2.connect(g); g.connect(a.destination); o.start(t0 + t); o2.start(t0 + t); o.stop(t0 + t + 0.65); o2.stop(t0 + t + 0.65); });
      } else {
        [[784, 0], [1175, 0.12]].forEach(([fq, t]) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = fq;
          g.gain.setValueAtTime(0.0001, t0 + t); g.gain.exponentialRampToValueAtTime(0.25, t0 + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.35);
          o.connect(g).connect(a.destination); o.start(t0 + t); o.stop(t0 + t + 0.4); });
      }
    }
    function mount() {
      if (!allowed()) return unmount();
      if (el) return;
      el = document.createElement('div'); el.className = 'chatw no-print';
      el.innerHTML = `<div class="chatpop" hidden></div>
        <div class="chatp" hidden role="dialog" aria-label="Dream Chat">
          <div class="chath"><b>Dream Chat</b> <span class="small" style="opacity:.75">CRM ↔ Accounts</span><span>${anyOf('users.manage', 'mgmt.view') ? '<button type="button" class="chats" id="chTest" title="The ERP sends you a message in 10 seconds, so you can hear the chime">Test sound</button>' : ''}<button type="button" class="chats" id="chSnd"></button><a href="${full()}" class="small" id="chFull">Full page</a><button type="button" class="chatx" aria-label="Close">×</button></span></div>
          <div class="chatl" id="chL"><p class="muted small">Loading…</p></div>
          <form class="chatf" id="chF">
            <div class="chatr"><span id="chTo"></span><input name="unit" placeholder="Flat (optional)" maxlength="12"><label class="check small"><input type="checkbox" name="needsAction" value="1"> Needs an answer</label></div>
            <div class="chatr"><textarea name="body" rows="2" placeholder="Type a message. Enter sends, Shift+Enter for a new line" required></textarea><button>Send</button></div>
          </form>
        </div>
        <button type="button" class="chatb" aria-label="Dream Chat">💬<span class="chatn" hidden></span></button>`;
      document.body.appendChild(el);
      el.querySelector('.chatb').onclick = () => (open ? close() : show());
      el.querySelector('.chatx').onclick = close;
      const snd = el.querySelector('#chSnd');
      const showSnd = () => { snd.textContent = soundOn() ? '🔔 Sound on' : '🔕 Sound off'; snd.title = soundOn() ? 'Sound for Dream Chat and for buyers\' emails. Click to turn it off' : 'Click to turn the sound on (you hear the chat chime, then the email tone)'; };
      snd.onclick = () => { store.set('erp_chat_sound', soundOn() ? 'off' : 'on'); showSnd(); if (soundOn()) { sound('in'); if (can('ledger.view')) setTimeout(() => sound('mail'), 900); } };
      showSnd();
      const tb = el.querySelector('#chTest');
      if (tb) tb.onclick = () => { tb.disabled = true; tb.textContent = 'Coming in 10 s…'; close(); setTimeout(async () => { try { await api('/api/team', { action: 'test' }); await load(); } catch (e) { alert(e.message); } tb.disabled = false; tb.textContent = 'Test sound'; }, 10000); };
      el.querySelector('#chFull').onclick = close;
      el.querySelector('.chatpop').onclick = () => { el.querySelector('.chatpop').hidden = true; show(); };
      const f = el.querySelector('#chF');
      f.body.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
      f.onsubmit = async (e) => {
        e.preventDefault(); if (busy) return;
        const x = Object.fromEntries(new FormData(f)); if (!String(x.body || '').trim()) return;
        busy = true;
        try { await api('/api/team', { action: 'post', to: x.to || (team === 'crm' ? 'accounts' : 'crm'), body: x.body, unit: (x.unit || '').trim() || null, needsAction: !!x.needsAction }); f.body.value = ''; f.needsAction.checked = false; sound('out'); await load(); }
        catch (err) { alert(err.message); } finally { busy = false; }
      };
      load(true); schedule();
    }
    function unmount() { clearTimeout(timer); if (el) el.remove(); el = null; last = 0; seenTop = 0; rows = []; open = false; }
    function schedule() { clearTimeout(timer); timer = setTimeout(async () => { await load(); if (el) schedule(); }, document.hidden ? 30000 : 8000); }
    async function load(initial) {
      if (!el) return;
      try {
        const d = await api(initial ? '/api/team?recent=1' : `/api/team?after=${last}`);
        team = d.team; myId = d.me;
        const fresh = initial ? d.rows : d.rows.filter((m) => m.id > last);
        if (initial) { rows = []; last = 0; }
        if (fresh.length) {
          rows = rows.concat(fresh).slice(-200); last = fresh[fresh.length - 1].id;
          const others = fresh.filter((m) => m.from_user !== myId && m.id > seenTop);
          seenTop = Math.max(seenTop, last);
          if (!initial && others.length) { if (!open || document.hidden) ring(others[others.length - 1], others.length); else sound('in'); }
        }
        unread = d.unread.n;
        if (open && unread && !document.hidden) seen();
        badge(); if (open) render(initial || fresh.length);
      } catch { /* offline for a moment: try again next time */ }
    }
    function badge() { if (!el) return; const b = el.querySelector('.chatn'); b.hidden = !unread; b.textContent = unread > 99 ? '99+' : unread; }
    function seen() { unread = 0; badge(); api('/api/team', { action: 'read' }).catch(() => {}); }
    function render(scroll) {
      const L = el.querySelector('#chL'), atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 40;
      L.innerHTML = rows.map((m) => `<div class="cmsg ${m.kind === 'system' ? 'sys' : m.from_user === myId ? 'me' : ''} ${m.needs_action && !m.done_at ? 'open' : ''}">
          <div class="cmeta"><b>${m.kind === 'system' ? 'ERP' : esc(m.from_name || '')}</b> → ${tName(m.to_team)}${m.unit_no ? ` · <a href="#/booking/${m.booking_id}">${esc(m.unit_no)}</a>` : ''} · <span class="muted">${time(m.created_at)}</span></div>
          <div class="cbody">${esc(m.body).replace(/\n/g, '<br>')}</div>
          ${m.needs_action ? `<div class="cact">${m.done_at ? '<span class="pill good">done</span>' : `<span class="pill warn">needs an answer</span> <button type="button" class="small ghost" data-cd="${m.id}">Mark done</button>`}</div>` : ''}</div>`).join('') || '<p class="muted small">No messages yet. Write to the other team below.</p>';
      L.querySelectorAll('[data-cd]').forEach((b) => (b.onclick = async () => { try { await api('/api/team', { action: 'done', id: +b.dataset.cd }); const m = rows.find((r) => r.id === +b.dataset.cd); if (m) m.done_at = new Date().toISOString(); render(); } catch (e) { alert(e.message); } }));
      if (scroll || atEnd) L.scrollTop = L.scrollHeight;
      el.querySelector('#chTo').innerHTML = team === 'both' ? '<select name="to"><option value="accounts">To Accounts</option><option value="crm">To CRM</option></select>' : `<span class="small muted">To ${tName(team === 'crm' ? 'accounts' : 'crm')}</span>`;
    }
    async function show() {
      open = true; el.querySelector('.chatp').hidden = false; el.querySelector('.chatpop').hidden = true;
      el.classList.add('on');
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
      await load(true); seen(); el.querySelector('#chF').body.focus();
    }
    function close() { open = false; if (el) { el.querySelector('.chatp').hidden = true; el.classList.remove('on'); } }
    function ring(m, k) {
      const who = m.kind === 'system' ? 'ERP' : m.from_name || 'New message';
      const text = `${m.unit_no ? m.unit_no + ': ' : ''}${m.body}`.slice(0, 140);
      const pop = el.querySelector('.chatpop');
      pop.innerHTML = `<b>${esc(who)}</b>${k > 1 ? ` <span class="muted small">+${k - 1} more</span>` : ''}<br>${esc(text)}`;
      pop.hidden = false; clearTimeout(pop._t); pop._t = setTimeout(() => (pop.hidden = true), 9000);
      sound('in');
      try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { const nn = new Notification(`${who} · Dream Chat`, { body: text, tag: 'erp-chat' }); nn.onclick = () => { window.focus(); show(); nn.close(); }; } } catch {}
    }
    document.addEventListener('visibilitychange', () => { if (el && !document.hidden) { load(); schedule(); } });
    return { mount, unmount, seen, sound };
  })();

  // Buyers' emails and WhatsApps: the "✉ N new" badge stays live (checked every minute, every 3 minutes in the
  // background), and every new one plays its own tone (three rising bell notes, not the Dream Chat chime) with a
  // pop-up and, when the tab is in the background, a desktop notification. Uses the same Sound on / off switch.
  const mailWatch = (() => {
    let n = null, lastId = 0, timer = null;
    function draw() {
      const host = $('.top .who'); if (!host) return;
      let a = host.querySelector('.mbadge.mail');
      if (!n) { if (a) a.remove(); return; }
      if (!a) { host.insertAdjacentHTML('beforeend', '<a class="mbadge mail" href="#/comms" title="Buyers\' emails and WhatsApps on your flats, not read yet"></a>'); a = host.querySelector('.mbadge.mail'); }
      a.textContent = `✉ ${n} new`;
    }
    function pop(m) {
      const who = m.buyers || m.from_addr || 'A buyer', text = `${m.unit_no ? m.unit_no + ' · ' : ''}${m.subject || (m.channel === 'whatsapp' ? 'WhatsApp message' : 'Email')}`;
      let el = document.getElementById('mailpop');
      if (!el) { el = document.createElement('a'); el.id = 'mailpop'; el.className = 'mailpop no-print'; document.body.appendChild(el); }
      el.href = m.booking_id ? `#/booking/${m.booking_id}?tab=messages` : '#/comms';
      el.innerHTML = `<b>✉ ${m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} from ${esc(who)}</b><br>${esc(text.slice(0, 140))}`;
      el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 12000);
      el.onclick = () => (el.hidden = true);
      try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { const nn = new Notification(`${m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} from ${who}`, { body: text, tag: 'erp-mail-' + m.id }); nn.onclick = () => { window.focus(); location.hash = el.href.split('#')[1] ? '#' + el.href.split('#')[1] : '#/comms'; nn.close(); }; } } catch {}
    }
    async function check() {
      if (!me || !can('ledger.view')) return;
      try {
        const r = await api('/api/comms?badge=1');
        const id = r.last ? r.last.id : 0;
        if (n !== null && id > lastId && r.last) { chat.sound('mail'); pop(r.last); }
        n = r.mine; lastId = Math.max(lastId, id); draw();
      } catch { /* offline for a moment */ }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(async () => { await check(); schedule(); }, document.hidden ? 180000 : 60000); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && me) { check(); schedule(); } });
    window.__erpMailCheck = check; // the training recorder shows a new email arriving
    return { paint: () => { draw(); check(); schedule(); }, check };
  })();

  // ---------- SDR (stamp duty and registration) challans ----------
  async function sdrPage() {
    if (!proj) return noProject();
    const d = await api(`/api/sdr?project=${proj}`);
    const KL = { stamp_duty: 'Stamp duty', registration: 'Registration', both: 'Stamp duty + registration' };
    const SL = { generated: 'Generated', paid: 'Paid', used: 'Used at registration', cancelled: 'Cancelled', refund_claimed: 'Refund claimed' };
    const has = new Set(d.rows.filter((r) => r.status !== 'cancelled').map((r) => r.unit_no));
    const regNo = d.flats.filter((f) => f.registration_date && !has.has(f.unit_no));
    $('#page').innerHTML = `<div class="page-head"><div><h1>SDR challans</h1><p class="muted">Every stamp duty and registration challan, one per flat. A second challan for the same flat is refused unless Head Accounts gives the reason, and the same GRN can never be entered twice, so the same duty is not paid twice.</p></div>
      ${d.canEnter ? '<div class="actions" style="margin:0"><button id="sdrAdd">Add a challan</button></div>' : ''}</div>
      ${d.dupes.length ? `<div class="err">Flats with more than one stamp duty challan: ${d.dupes.map((x) => `${esc(x.unit_no)} (${x.n}, ${inr(x.amount)})`).join(', ')}. Check each one: claim a refund for a challan that was not used.</div>` : ''}
      <div class="panel"><div class="kpis">${kpi(d.rows.filter((r) => r.status !== 'cancelled').length, 'challans')}${kpi(inr(d.rows.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + toNum(r.amount), 0)), 'total')}${kpi(regNo.length, 'registered flats with no challan here', regNo.length ? 'bad' : '')}${kpi(d.dupes.length, 'flats with two challans', d.dupes.length ? 'bad' : '')}</div></div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search flat or GRN"><table><tr><th>Flat</th><th>For</th><th>GRN / challan no.</th><th>Date</th><th class="num">Amount</th><th>Paid from</th><th>Status</th><th>Entered by</th><th></th></tr>
        ${d.rows.map((r) => `<tr data-s="${esc((r.unit_no + ' ' + (r.grn || '') + ' ' + (r.challan_no || '')).toLowerCase())}" class="${r.status === 'cancelled' ? 'dim' : ''}"><td>${r.booking_id ? `<a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a>` : esc(r.unit_no)}</td><td>${esc(KL[r.kind] || r.kind)}</td>
          <td>${esc([r.grn, r.challan_no].filter(Boolean).join(' · ') || '—')}</td><td>${fmtD(r.challan_date)}</td><td class="num">${inr(r.amount)}</td><td>${esc(r.paid_from || '')}</td>
          <td>${esc(SL[r.status] || r.status)}${r.duplicate_reason ? `<br><span class="small bad-t">second challan: ${esc(r.duplicate_reason)}</span>` : ''}${r.note ? `<br><span class="small muted">${esc(r.note)}</span>` : ''}</td><td>${esc(r.by_name || '')}</td>
          <td>${d.canEnter ? `<button class="ghost small" data-ed="${r.id}">Update</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No challans entered yet.</td></tr>'}</table></div>
      ${regNo.length ? `<div class="panel table-wrap"><h2>Registered flats with no challan here (${regNo.length})</h2><p class="small muted">Registered in the ERP, but their stamp duty challan is not in this register yet. Enter the challan so the register is complete.</p><table><tr><th>Flat</th><th>Buyer</th><th>Registered</th><th class="num">Stamp duty</th><th class="num">SDR received from buyer</th></tr>
        ${regNo.slice(0, 300).map((f) => `<tr><td><a href="#/booking/${f.booking_id}">${esc(f.unit_no)}</a></td><td>${esc(f.buyers || '')}</td><td>${fmtD(f.registration_date)}</td><td class="num">${f.stamp_duty ? inr(f.stamp_duty) : '—'}</td><td class="num">${inr(f.sdr_received)}</td></tr>`).join('')}</table></div>` : ''}`;
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
    const form = (dup) => dialog(`<h2>Add a stamp duty / registration challan</h2>
      <div class="row"><div><label>Flat</label><input name="unit" required placeholder="A-1001" list="sdrfl"><datalist id="sdrfl">${d.flats.map((f) => `<option value="${esc(f.unit_no)}">${esc(f.buyers || '')}</option>`).join('')}</datalist></div>
        <div><label>For</label><select name="kind">${d.kinds.map((k) => `<option value="${k}">${KL[k]}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>GRN</label><input name="grn"></div><div><label>Challan no.</label><input name="challanNo"></div></div>
      <div class="row"><div><label>Challan date</label><input type="date" name="challanDate" max="${todayIso()}" value="${todayIso()}"></div><div><label>Amount (₹)</label><input name="amount" inputmode="decimal" required></div></div>
      <div class="row"><div><label>Paid from (bank)</label><input name="paidFrom"></div><div><label>Status</label><select name="status">${d.statuses.filter((x) => x !== 'cancelled').map((k) => `<option value="${k}">${SL[k]}</option>`).join('')}</select></div></div>
      <label>Note</label><input name="note">
      <div id="sdrWarn"></div>`,
    async (x, f) => {
      const body = { action: 'add', projectId: proj, ...x };
      try { await api('/api/sdr', body); toast('Challan added.'); sdrPage(); }
      catch (e) {
        if (!(e.data && e.data.duplicate)) throw e;
        if (!d.canManage) throw new Error(e.message + ' Ask Head Accounts if a second challan is really needed.');
        const reason = prompt(e.message + '\n\nIf a second challan is really needed (the first failed, a re-registration), type the reason. Otherwise press Cancel.');
        if (!reason) throw new Error('Not added: this flat already has a challan.');
        await api('/api/sdr', { ...body, duplicateReason: reason }); toast('Second challan added, with the reason recorded.'); sdrPage();
      }
    });
    if ($('#sdrAdd')) $('#sdrAdd').onclick = () => form();
    document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { const r = d.rows.find((x) => x.id === +b.dataset.ed);
      dialog(`<h2>Challan · ${esc(r.unit_no)}</h2><div class="row"><div><label>Status</label><select name="status">${d.statuses.map((k) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${SL[k]}</option>`).join('')}</select></div><div><label>Paid from</label><input name="paidFrom" value="${esc(r.paid_from || '')}"></div></div>
        <label>Note</label><input name="note" value="${esc(r.note || '')}">`, async (x) => { await api('/api/sdr', { action: 'update', projectId: proj, id: r.id, ...x }); toast('Saved.'); sdrPage(); }); }));
  }

  // ---------- Dream Chat, full page ----------
  async function teamPage(bookingId) {
    const base = location.hash.split('/')[1] === 'accteam' ? 'accteam' : 'team';
    const f = store.get('erp_tmf') || 'all';
    const d = await api(`/api/team?f=${f}${bookingId ? '&booking=' + bookingId : ''}`);
    const toDefault = d.team === 'crm' ? 'accounts' : d.team === 'accounts' ? 'crm' : 'accounts';
    const who = (m) => (m.kind === 'system' ? 'ERP' : esc(m.from_name || ''));
    const teamName = (t) => (t === 'crm' ? 'CRM' : 'Accounts');
    const time = (x) => new Date(x).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mine = (m) => m.from_name && m.kind !== 'system' && d.team !== 'both' && ((d.team === 'crm' && m.to_team === 'accounts') || (d.team === 'accounts' && m.to_team === 'crm'));
    $('#page').innerHTML = `<div class="page-head"><div><h1>Dream Chat${d.flat ? ' · ' + esc(d.flat.unit_no) : ''}</h1><p class="muted">Dream Chat: one conversation between the CRM team and Accounts. The 💬 button at the bottom of every page opens it too. Tag a flat so the message is kept with it. Tick "needs an answer" when you are asking for something: it stays open until the other team marks it done. The ERP also posts here: cheques found in the bank, and cheques returned.</p></div>
      ${d.flat ? `<div class="actions" style="margin:0"><a class="btn ghost" href="#/${base}">All messages</a><a class="btn ghost" href="#/booking/${d.flat.id}">Open the booking</a></div>` : ''}</div>
      <div class="panel"><div class="kpis">${kpi(d.open.accounts, 'open for Accounts', d.open.accounts ? 'bad' : '')}${kpi(d.open.crm, 'open for CRM', d.open.crm ? 'bad' : '')}</div></div>
      <div class="tabs">${[['all', 'All'], ['open', 'Needs an answer'], ['mine', 'For my team']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="panel chat" id="chat">${d.rows.map((m) => `<div class="cmsg ${m.kind === 'system' ? 'sys' : mine(m) ? 'me' : ''} ${m.needs_action && !m.done_at ? 'open' : ''}">
          <div class="cmeta"><b>${who(m)}</b> → ${teamName(m.to_team)}${m.unit_no ? ` · <a href="#/${base}/${m.booking_id}">${esc(m.unit_no)}</a>` : ''} · <span class="muted">${time(m.created_at)}</span></div>
          <div class="cbody">${esc(m.body).replace(/\n/g, '<br>')}</div>
          ${m.needs_action ? `<div class="cact">${m.done_at ? `<span class="pill good">done</span> <span class="small muted">${esc(m.done_name || '')} ${time(m.done_at)}</span> <button class="link small" data-re="${m.id}">Reopen</button>` : `<span class="pill warn">needs an answer</span> <button class="small" data-done="${m.id}">Mark done</button>`}</div>` : ''}
        </div>`).join('') || '<p class="muted">No messages yet.</p>'}</div>
      <form class="panel" id="tmf"><div class="row4">
        ${d.team === 'both' ? `<div><label>For</label><select name="to"><option value="accounts">Accounts</option><option value="crm">CRM</option></select></div>` : `<div><label>For</label><input value="${teamName(toDefault)}" disabled></div>`}
        <div><label>Flat (optional)</label><input name="unit" placeholder="e.g. A-1001" value="${d.flat ? esc(d.flat.unit_no) : ''}" ${d.flat ? 'readonly' : ''}></div>
        <div style="align-self:end"><label class="check"><input type="checkbox" name="needsAction" value="1"> Needs an answer</label></div><div></div></div>
        <label>Message</label><textarea name="body" rows="3" required placeholder="e.g. Please confirm cheque 004512 of A-1001 is deposited"></textarea>
        <div class="actions"><button>Send</button></div></form>`;
    const c = $('#chat'); c.scrollTop = c.scrollHeight;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_tmf', t.dataset.t); teamPage(bookingId); }));
    const act = async (body) => { try { await api('/api/team', body); teamPage(bookingId); } catch (e) { alert(e.message); } };
    document.querySelectorAll('[data-done]').forEach((x) => (x.onclick = () => act({ action: 'done', id: +x.dataset.done })));
    document.querySelectorAll('[data-re]').forEach((x) => (x.onclick = () => act({ action: 'reopen', id: +x.dataset.re })));
    $('#tmf').onsubmit = async (ev) => {
      ev.preventDefault(); const x = Object.fromEntries(new FormData(ev.target));
      try { await api('/api/team', { action: 'post', to: x.to || toDefault, body: x.body, needsAction: !!x.needsAction, bookingId: d.flat ? d.flat.id : null, unit: d.flat ? null : (x.unit || '').trim() || null }); chat.sound('out'); teamPage(bookingId); } catch (e) { alert(e.message); }
    };
    chat.seen();
  }

  async function comms() {
    if (/[?&]f=waiting/.test(location.hash)) store.set('erp_cmf', 'waiting');
    const f = store.get('erp_cmf') || 'mine';
    const [d, st] = await Promise.all([api(`/api/comms?inbox=1&f=${f}`), api('/api/comms?status=1')]);
    const m = st.mail;
    const mailLine = !m.configured ? '<span class="bad-t">The mailbox is not connected yet (email settings in Vercel), so buyers\' replies are not read.</span>'
      : m.error ? `<span class="bad-t">Last check of ${esc(m.mailbox || 'the mailbox')} failed: ${esc(m.error)}</span>` : `Replies are read from ${esc(m.mailbox || 'the mailbox')} every 5 minutes${m.lastRun ? ' · last checked ' + fmtDate(m.lastRun) : ''}.`;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Communication inbox</h1><p class="muted">Buyers' email replies and WhatsApps. Each one is also kept in the buyer's Communication record on their booking. A message the ERP could not match to a flat waits here until you link it.</p></div>
        <div class="actions" style="margin:0">${st.canSync && m.configured ? '<button class="ghost" id="cmSync">Check the mailbox now</button>' : ''}</div></div>
      <div class="panel"><p class="small">${mailLine}<br>WhatsApp: ${st.whatsapp.configured ? 'connected through ' + esc(st.whatsapp.provider) : 'not connected yet'}.${st.whatsapp.ccm ? (st.whatsapp.hook && st.whatsapp.hook.key !== 'ccm-webhook-error' ? ' Replies and delivery ticks come in (webhook connected ' + fmtDate(st.whatsapp.hook.done_at) + ').' : st.whatsapp.hook ? ` <span class="bad-t">The webhook could not be connected: ${esc(st.whatsapp.hook.info.error)}</span>` : ' The webhook connects by itself within 5 minutes.') : ''}${st.whatsapp.ccm && me.perms.includes('users.manage') ? ' <button class="ghost small" id="waHook">Connect the WhatsApp webhook</button>' : ''}</p>
        <div class="kpis"><button type="button" class="kpi kbtn ${d.counts.new ? 'bad' : ''}" data-goto="new" title="Show the messages nobody has read yet"><b>${esc(d.counts.new)}</b><span>not read yet →</span></button><button type="button" class="kpi kbtn ${d.counts.unmatched ? 'bad' : ''}" data-goto="unmatched" title="Show the messages the ERP could not match to a flat"><b>${esc(d.counts.unmatched)}</b><span>to link to a flat →</span></button></div></div>
      ${st.canTeams ? `<details class="panel cm-teams" ${Object.values(st.teams || {}).some((x) => (x || []).length) ? '' : 'open'}><summary><h2 style="display:inline">CRM teams</h2> <span class="small muted">${['A', 'B'].map((w) => `${w} Wing: ${esc(st.crmUsers.filter((x) => (st.teams[w] || []).map(Number).includes(x.id)).map((x) => x.name).join(', ') || 'nobody yet')}`).join(' · ')} · tap to change</span></summary><p class="small muted">Who is told when a buyer replies. Everyone ticked for a wing gets the reply on their own Daily To-Do, the red badge at the top, and an email to their own address (set on Logins). A flat can also be given to one person on its booking page.</p>
        <div class="two">${['A', 'B'].map((w) => `<div><b>${w} Wing</b>${st.crmUsers.map((x) => `<label class="check"><input type="checkbox" data-w="${w}" value="${x.id}" ${(st.teams[w] || []).map(Number).includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>`).join('')}</div>
        <div class="actions"><button class="ghost small" id="cmTeams">Save the CRM teams</button></div></details>` : ''}
      <div class="tabs">${[['mine', `Mine${d.counts.mine ? ' (' + d.counts.mine + ')' : ''}`], ['waiting', `Waiting for our reply${d.counts.waiting ? ' (' + d.counts.waiting + ')' : ''}`], ['new', 'All not read'], ['unmatched', 'To link'], ['all', 'All received']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="panel msgs" id="cml">${d.rows.map((c) => msgHtml(c, { unit: true, actions: d.canAct ? `<div class="msg-x">${c.status === 'unmatched' ? `<button class="small" data-link="${c.id}">Link to a flat</button> <button class="link small" data-dis="${c.id}">Not about a buyer</button>${c.matched_by ? ` <span class="small muted">(${esc(c.matched_by)})</span>` : ''}` : `${c.waiting ? `<span class="pill ${c.age_hours > 72 ? 'bad' : 'warn'}">waiting ${c.age_hours >= 48 ? Math.round(c.age_hours / 24) + ' days' : c.age_hours + ' hours'} for our reply</span> ` : ''}<a class="small" href="#/booking/${c.booking_id}">Open the booking to reply</a>${!c.read_at ? ` · <button class="link small" data-read="${c.id}">Mark read</button>` : ''}${c.waiting ? ` · <button class="link small" data-nr="${c.id}">No reply needed</button>` : ''}`}</div>` : '' })).join('') || '<p class="muted">Nothing here.</p>'}</div>`;
    wireMsgs($('#cml'));
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_cmf', t.dataset.t); comms(); }));
    document.querySelectorAll('[data-goto]').forEach((t) => (t.onclick = () => { store.set('erp_cmf', t.dataset.goto); comms(); }));
    if ($('#waHook')) $('#waHook').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/api/comms', { action: 'wa-webhook' }); toast('Click Connect will now send WhatsApp replies and delivery ticks to the ERP.', 6000); } catch (x) { alert(x.message); } e.target.disabled = false; };
    if ($('#cmTeams')) $('#cmTeams').onclick = async () => { const teams = { A: [], B: [] }; document.querySelectorAll('[data-w]:checked').forEach((x) => teams[x.dataset.w].push(+x.value)); await api('/api/comms', { action: 'teams', teams }); toast('CRM teams saved.'); };
    if ($('#cmSync')) $('#cmSync').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Checking…'; try { const r = await api('/api/comms', { action: 'sync' }); toast(r.ok ? `Checked ${r.looked} new emails: ${r.saved} saved, ${r.inbox} to link.` : r.error || r.reason); } catch (x) { alert(x.message); } comms(); };
    document.querySelectorAll('[data-read]').forEach((x) => (x.onclick = async () => { await api('/api/comms', { action: 'read', ids: [+x.dataset.read] }); comms(); }));
    document.querySelectorAll('[data-dis]').forEach((x) => (x.onclick = async () => { await api('/api/comms', { action: 'dismiss', id: +x.dataset.dis }); toast('Removed from the inbox.'); comms(); }));
    document.querySelectorAll('[data-nr]').forEach((x) => (x.onclick = async () => { await api('/api/comms', { action: 'noreply', id: +x.dataset.nr }); toast('Marked: no reply needed.'); comms(); }));
    document.querySelectorAll('[data-link]').forEach((x) => (x.onclick = async () => {
      const bk = await api(`/api/bookings?project=${proj}`);
      const list = (bk.rows || bk.bookings || []).filter((r) => r.status === 'active');
      const dl = dialog(`<h2>Link this message to a flat</h2><label>Flat</label><input name="q" list="cmUnits" required placeholder="Type the flat, e.g. A-1203"><datalist id="cmUnits">${list.map((r) => `<option value="${esc(r.unit_no)}">${esc(r.buyers || r.applicants || '')}</option>`).join('')}</datalist>`,
        async (v) => { const r = list.find((b) => b.unit_no.toUpperCase() === String(v.q).trim().toUpperCase()); if (!r) throw new Error('Pick a flat with a live booking.'); await api('/api/comms', { action: 'link', id: +x.dataset.link, bookingId: r.id }); toast(`Linked to ${r.unit_no}.`); comms(); });
      $('[value=save]', dl).textContent = 'Link';
    }));
  }

  // ---------- customer documents (kept in Google Drive) ----------
  let DOCS = null;
  const docsMeta = async () => (DOCS ||= await api('/api/custdocs?status=1'));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  async function openDoc(id, name) {
    const w = window.open('', '_blank');
    if (w) w.document.write('<p style="font:15px system-ui;padding:24px">Opening ' + esc(name || 'the document') + '…</p>');
    try {
      const info = await api(`/api/custdocs?file=${id}&info=1`);
      const parts = [];
      for (let i = 0; i < info.parts; i++) {
        const r = await fetch(`/api/custdocs?file=${id}&part=${i}`, { credentials: 'same-origin' });
        if (!r.ok) { let m = 'Could not open the file.'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
        parts.push(await r.arrayBuffer());
        if (w && info.parts > 1) w.document.body.innerHTML = `<p style="font:15px system-ui;padding:24px">Opening ${esc(info.name)}… ${Math.round(((i + 1) / info.parts) * 100)}%</p>`;
      }
      const url = URL.createObjectURL(new Blob(parts, { type: info.mime }));
      if (w && /^(application\/pdf|image\/)/.test(info.mime)) w.location.href = url;
      else { if (w) w.close(); const a = document.createElement('a'); a.href = url; a.download = info.name; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { if (w) w.close(); alert(e.message); }
  }
  async function uploadDoc(owner, id, label, after) {
    const m = await docsMeta();
    if (!m.connected) { alert(m.canConnect ? 'Connect Google Drive first, on the Customer documents page.' : 'Google Drive is not connected yet. Ask the Admin to connect it on the Customer documents page.'); return; }
    const dl = dialog(`<h2>Add a document · ${esc(label)}</h2>
      <label>What is it?</label><select name="kind">${m.kinds[owner].map((k) => `<option>${esc(k)}</option>`).join('')}</select>
      <label>Note (optional)</label><input name="title" maxlength="160" placeholder="e.g. Registered on 12 Oct, Sub-registrar Andheri 4">
      <label>File (PDF, photo, Word or Excel, up to 40 MB)</label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,application/pdf,image/*">
      <p class="small muted" id="upP">The file goes into Google Drive, in this ${owner === 'tenant' ? 'tenant' : owner === 'cp' ? 'partner' : 'flat'}'s folder.</p>`,
    async (x, f) => {
      const file = f.querySelector('[name=file]').files[0];
      if (!file) throw new Error('Choose the file.');
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const mime = file.type || { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp' }[ext] || '';
      if (!m.types[mime]) throw new Error('Upload a PDF, a photo (JPG, PNG) or a Word or Excel file.');
      if (file.size > m.max) throw new Error('That file is over 40 MB. Scan it at a lower resolution, or in black and white.');
      const btn = f.querySelector('[value=save]'); btn.disabled = true;
      try {
        const st = await api('/api/custdocs', { action: 'start', owner, id, kind: x.kind, title: x.title, fileName: file.name, mime, size: file.size });
        for (let i = 0; i < st.parts; i++) {
          f.querySelector('#upP').textContent = `Uploading… ${Math.round((i / st.parts) * 100)}%`;
          const buf = new Uint8Array(await file.slice(i * st.part, Math.min(file.size, (i + 1) * st.part)).arrayBuffer());
          let bin = ''; for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
          await api('/api/custdocs', { action: 'part', docId: st.docId, index: i, data: btoa(bin) });
        }
      } catch (e) { btn.disabled = false; f.querySelector('#upP').textContent = 'The upload stopped. Choose the file and try again.'; throw e; }
      toast('Document saved to Google Drive.'); after();
    });
    $('[value=save]', dl).textContent = 'Upload';
  }
  async function docsPanel(owner, id, el, label) {
    const [m, d] = await Promise.all([docsMeta(), api(`/api/custdocs?${owner}=${id}`)]);
    const have = new Set(d.rows.map((r) => r.kind));
    const missing = owner === 'booking' ? m.check.filter((k) => !have.has(k)) : [];
    el.innerHTML = `<h2>${owner === 'tenant' ? 'Tenant documents' : owner === 'cp' ? 'Bills and papers (Google Drive)' : 'Customer documents'} ${d.canAdd ? '<button class="small" data-up style="float:right">Add a document</button>' : ''}</h2>
      ${m.connected ? '' : '<p class="small bad-t">Google Drive is not connected yet, so documents cannot be added. ' + (m.canConnect ? '<a href="#/custdocs">Connect it</a>.' : 'Ask the Admin to connect it.') + '</p>'}
      ${missing.length ? `<p class="small muted">Still to upload: ${missing.map(esc).join(' · ')}</p>` : ''}
      <div class="table-wrap"><table><tr><th>Document</th><th>File</th><th>Added</th><th></th></tr>
      ${d.rows.map((r) => `<tr><td><b>${esc(r.kind)}</b>${r.title ? `<br><span class="small muted">${esc(r.title)}</span>` : ''}</td><td class="small">${esc(r.file_name)}<br><span class="muted">${esc(m.types[r.mime] || '')} · ${kb(+r.size)}</span></td>
        <td class="small">${fmtDate(r.ready_at || r.created_at)}<br><span class="muted">${esc(r.by_name || '')}</span></td>
        <td style="white-space:nowrap"><button class="ghost small" data-open="${r.id}" data-n="${esc(r.file_name)}">Open</button>${d.canRemove ? ` <button class="link small" data-rm="${r.id}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No documents yet.</td></tr>'}</table></div>`;
    const again = () => docsPanel(owner, id, el, label);
    el.querySelectorAll('[data-open]').forEach((x) => (x.onclick = () => openDoc(+x.dataset.open, x.dataset.n)));
    if ($('[data-up]', el)) $('[data-up]', el).onclick = () => uploadDoc(owner, id, label, again);
    el.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = () => dialog('<h2>Remove this document?</h2><p class="muted small">It is hidden from the list but stays in Google Drive, and the audit log keeps who removed it and why.</p><label>Why?</label><input name="reason" required maxlength="300" placeholder="e.g. Wrong flat, uploaded again">',
      async (v) => { await api('/api/custdocs', { action: 'remove', docId: +x.dataset.rm, reason: v.reason }); toast('Removed.'); again(); })));
  }
  async function custdocs() {
    const msg = new URLSearchParams(location.search).get('drive');
    if (msg) history.replaceState(null, '', '/' + location.hash);
    DOCS = null;
    const m = await docsMeta();
    const tab = store.get('erp_cdtab') || (can('buyer.kyc') ? 'flats' : 'tenants');
    const conn = m.connected ? `<p class="small">Google Drive connected${m.email ? ' (' + esc(m.email) + ')' : ''}${m.folder ? ` · <a href="${esc(m.folder)}" target="_blank" rel="noopener">Open the folder in Drive ↗</a>` : ''}${m.canConnect ? ' · <button class="link small" id="gdOff">Disconnect</button>' : ''}</p>`
      : m.canConnect ? (m.configured ? `<div class="note"><b>Connect Google Drive.</b> Sign in with the Google account whose Drive will keep the documents (srishaq@gmail.com) and allow the ERP to "see, edit, create and delete only the specific Google Drive files you use with this app". It can never see anything else in that Drive.<div class="actions" style="margin-top:10px"><a class="btn" href="/api/custdocs?oauth=start">Connect Google Drive</a></div></div>`
          : `<div class="note"><b>One-time set-up needed.</b> Google sign-in for the ERP is not set up yet (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel). The redirect address to give Google is <code>${esc(m.redirectUri)}</code>.</div>`)
      : '<p class="small bad-t">Google Drive is not connected yet. Ask the Admin to connect it.</p>';
    $('#page').innerHTML = `<div class="page-head"><div><h1>Customer documents</h1><p class="muted">Signed and scanned papers for every flat and SRA tenant: agreement, Index II, KYC, signed letters. They are kept in Google Drive, one folder per flat, and open here for the logins allowed to see buyer documents.</p></div></div>
      ${msg ? `<div class="${msg === 'connected' ? 'note' : 'err'}" style="margin-bottom:12px">${msg === 'connected' ? 'Google Drive is connected. Documents can now be uploaded.' : esc(msg)}</div>` : ''}
      <div class="panel">${conn}</div>
      <div class="tabs">${[['flats', 'Flats', can('buyer.kyc')], ['tenants', 'SRA tenants', can('accounts.view')]].filter((t) => t[2]).map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="cdl"><div class="panel muted">Loading…</div></div>`;
    document.querySelectorAll('.tab[data-t]').forEach((t) => (t.onclick = () => { store.set('erp_cdtab', t.dataset.t); custdocs(); }));
    if ($('#gdOff')) $('#gdOff').onclick = async () => { if (!confirm('Disconnect Google Drive? Documents already uploaded stay in Drive, but they cannot be opened here until it is connected again.')) return; await api('/api/custdocs', { action: 'disconnect' }); custdocs(); };
    const out = $('#cdl');
    if (tab === 'tenants') {
      const d = await api('/api/custdocs?tenants=1');
      const f = store.get('erp_cdtf') || 'all';
      const rows = d.rows.filter((r) => f === 'all' || !r.agreements);
      out.innerHTML = `<div class="panel"><div class="kpis">${kpi(d.rows.length, 'tenants')}${kpi(d.rows.filter((r) => r.agreements).length, 'with a signed agreement')}${kpi(d.rows.filter((r) => !r.agreements).length, 'agreement still to upload', d.rows.some((r) => !r.agreements) ? 'bad' : '')}</div>
        <div class="tabs" style="margin:12px 0 0">${[['all', 'All'], ['missing', 'Agreement missing']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
        <div class="panel table-wrap"><table><tr><th class="num">Survey no.</th><th>Tenant</th><th>Status</th><th>Agreement</th><th class="num">Documents</th><th></th></tr>
        ${rows.map((r) => `<tr><td class="num">${r.survey_no == null ? '' : +r.survey_no}</td><td>${esc(r.name || '')}</td><td class="small">${esc(r.status || '')}</td><td>${r.agreements ? '<span class="pill good">uploaded</span>' : '<span class="pill bad">missing</span>'}</td><td class="num">${r.docs}</td>
          <td><button class="ghost small" data-ten="${r.id}" data-l="${esc('Survey ' + (r.survey_no == null ? '' : +r.survey_no) + ' · ' + (r.name || ''))}">Documents</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No tenants here.</td></tr>'}</table></div><div class="panel" id="tdocs" hidden></div>`;
      document.querySelectorAll('[data-f]').forEach((t) => (t.onclick = () => { store.set('erp_cdtf', t.dataset.f); custdocs(); }));
      document.querySelectorAll('[data-ten]').forEach((x) => (x.onclick = () => { const el = $('#tdocs'); el.hidden = false; docsPanel('tenant', +x.dataset.ten, el, x.dataset.l); el.scrollIntoView({ behavior: 'smooth' }); }));
      return;
    }
    if (!proj) return noProject();
    const d = await api(`/api/custdocs?project=${proj}`);
    const short = { 'Booking form (signed)': 'Booking form', 'Allotment letter (signed)': 'Allotment', 'KYC: PAN, Aadhaar, photo': 'KYC', 'Agreement for sale (registered)': 'Agreement', 'Index II / registration receipt': 'Index II' };
    const f = store.get('erp_cdf') || 'all';
    const missingOf = (r) => d.check.filter((k) => !r.kinds[k]);
    const rows = d.rows.filter((r) => (f === 'all' ? true : f === 'agreement' ? !r.kinds['Agreement for sale (registered)'] && (r.registration_date || /done/i.test(r.registration_status || '')) : missingOf(r).length));
    const full = d.rows.filter((r) => !missingOf(r).length).length;
    out.innerHTML = `<div class="panel"><div class="kpis">${kpi(d.rows.length, 'live bookings')}${kpi(full, 'with every key paper')}${kpi(d.rows.filter((r) => r.kinds['Agreement for sale (registered)']).length, 'registered agreements uploaded')}${kpi(d.rows.filter((r) => !r.kinds['Agreement for sale (registered)'] && (r.registration_date || /done/i.test(r.registration_status || ''))).length, 'registered, agreement not uploaded', 'bad')}</div>
      <div class="tabs" style="margin:12px 0 0">${[['all', 'All flats'], ['missing', 'Something missing'], ['agreement', 'Registered, agreement missing']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
      <div class="panel table-wrap"><input class="search" id="q" placeholder="Search unit or buyer"><table><tr><th>Unit</th><th>Buyer</th>${d.check.map((k) => `<th>${esc(short[k] || k)}</th>`).join('')}<th class="num">Other</th></tr>
      ${rows.map((r) => { const other = Object.entries(r.kinds).filter(([k]) => !d.check.includes(k)).reduce((a, [, v]) => a + v, 0);
        return `<tr data-s="${esc((r.unit_no + ' ' + (r.buyers || '')).toLowerCase())}"><td><a href="#/booking/${r.booking_id}">${esc(r.unit_no)}</a></td><td class="small">${esc(r.buyers || '')}</td>${d.check.map((k) => `<td>${r.kinds[k] ? '<span class="good-t">✓</span>' : '<span class="muted">—</span>'}</td>`).join('')}<td class="num">${other || ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}</table></div>
      <p class="small muted">Open a flat to upload its papers. Each flat has its own folder in Google Drive.</p>`;
    document.querySelectorAll('[data-f]').forEach((t) => (t.onclick = () => { store.set('erp_cdf', t.dataset.f); custdocs(); }));
    $('#q').oninput = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('tr[data-s]').forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? '' : 'none')); };
  }

  // Management dashboard: the key figures of every department on one screen (Admin and Management).
  // Saleable flats, area sold and the average sale rate (Units & inventory, and the Management dashboard).
  function salesStrip(S, { title = 'Sales summary', link = '' } = {}) {
    if (!S || !S.total) return '';
    const T = S.total, money = T.saleValue != null;
    const sq = (v) => `${Math.round(v).toLocaleString('en-IN')} sq ft`;
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');
    const box = (label, big, sub, cls = '') => `<div class="ss-b ${cls}"><span class="ss-l">${label}</span><b class="ss-v">${big}</b>${sub ? `<span class="ss-s">${sub}</span>` : ''}</div>`;
    const rows = [...S.wings, { ...T, name: 'Total', code: 'T' }];
    const miss = [T.soldNoDev ? `${T.soldNoDev} sold flat${T.soldNoDev > 1 ? 's have' : ' has'} no development charges in the ERP yet` : '', T.soldNoArea ? `${T.soldNoArea} sold flat${T.soldNoArea > 1 ? 's have' : ' has'} no carpet area` : ''].filter(Boolean);
    return `<section class="panel ss">
      <div class="ss-head"><h2>${esc(title)}</h2>${link ? `<a class="small" href="${esc(link)}">Units & inventory →</a>` : ''}</div>
      <div class="ss-grid">
        ${box('Saleable flats', T.saleable.toLocaleString('en-IN'), `${sq(T.saleableSqft)} carpet${T.notForSale ? ` · ${T.notForSale} refuge / society not counted` : ''}`)}
        ${box('Sold', T.sold.toLocaleString('en-IN'), `${sq(T.soldSqft)} · ${pct(T.soldSqft, T.saleableSqft)} of the area`, 'good')}
        ${box('Balance to sell', T.balance.toLocaleString('en-IN'), `${sq(T.balanceSqft)} open for sale`, 'warn')}
        ${T.held ? box(T.heldMgmt === T.held ? 'Held by management' : 'Held back', T.held.toLocaleString('en-IN'), `${sq(T.heldSqft)} · not for sale now`, 'grey') : ''}
        ${money ? box('Sale value of flats sold', cr(T.saleValue), `Agreement value incl. parking ${cr(T.av)} + amenity & possession ${cr(T.dev)}`) : ''}
        ${money ? box('Average sale rate', T.avgRate ? '₹' + T.avgRate.toLocaleString('en-IN') + ' / sq ft' : '—', 'Sale value ÷ carpet area sold', 'brand') : ''}
      </div>
      <div class="table-wrap"><table class="ss-t"><tr><th></th><th class="num">Saleable flats</th><th class="num">Saleable sq ft</th><th class="num">Sold</th><th class="num">Sold sq ft</th><th class="num">Balance to sell</th><th class="num">Balance sq ft</th><th class="num">Held</th><th class="num">Held sq ft</th>${money ? '<th class="num">Sale value</th><th class="num">Avg ₹ / sq ft</th>' : ''}</tr>
        ${rows.map((w) => `<tr class="${w.code === 'T' ? 'tot' : ''}"><td>${w.code === 'T' ? '<b>Total</b>' : esc(w.name)}</td><td class="num">${w.saleable}</td><td class="num">${Math.round(w.saleableSqft).toLocaleString('en-IN')}</td><td class="num">${w.sold}</td><td class="num">${Math.round(w.soldSqft).toLocaleString('en-IN')}</td>
          <td class="num">${w.balance}</td><td class="num">${Math.round(w.balanceSqft).toLocaleString('en-IN')}</td><td class="num">${w.held}</td><td class="num">${Math.round(w.heldSqft).toLocaleString('en-IN')}</td>${money ? `<td class="num">${cr(w.saleValue)}</td><td class="num"><b>${w.avgRate ? '₹' + w.avgRate.toLocaleString('en-IN') : '—'}</b></td>` : ''}</tr>`).join('')}</table></div>
      ${T.held ? `<p class="small"><b>${T.heldMgmt === T.held ? 'Held by management' : 'Held back'}:</b> ${S.wings.filter((w) => w.held).map((w) => `${esc(w.name)}: ${w.heldBy.map((h) => `${esc(h.name)} ${h.flats} (floor${h.floors.length > 1 ? 's' : ''} ${h.floors.join(', ')})${h.management ? '' : ' (not management)'}`).join(' · ')}`).join(' &nbsp;|&nbsp; ')}</p>` : ''}
      ${miss.length ? `<p class="small warn-t">${esc(miss.join(' · '))}.</p>` : ''}
    </section>`;
  }

  // ---------- Collections dashboard (inside the ERP; the figures are the ERP's own, from lib/dashboard.js) ----------
  // Overview: the project's money and sales at a glance. Collections: forecast, day by day, month by month.
  // Lists of buyers are not here: they are in Flats & buyers (tabs) and the 9 am Today list.
  const cInr = (n, exact) => { n = +n || 0; const a = Math.abs(n), sg = n < 0 ? '−' : ''; if (exact || a < 1e5) return sg + '₹' + Math.round(a).toLocaleString('en-IN'); if (a >= 1e7) return sg + '₹' + (a / 1e7).toFixed(a >= 1e9 ? 1 : 2) + ' Cr'; return sg + '₹' + (a / 1e5).toFixed(2) + ' L'; };
  const cCnt = (n) => (+n || 0).toLocaleString('en-IN');
  const cPct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const cDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const cMon = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const cFig = (label, val, tn = '', note = '', link = '') => `<${link ? `a href="${esc(link)}"` : 'div'} class="mfig ${tn}"><span>${esc(label)}</span><b>${esc(val)}</b>${note ? `<small>${esc(note)}</small>` : ''}</${link ? 'a' : 'div'}>`;
  // A bar chart drawn as SVG (stacked when there are several series; negative values go below the line)
  function barSvg(labels, series, { h = 220, count = false } = {}) {
    const lab = (v) => (count ? String(Math.round(v)) : cInr(v));
    const n = labels.length; if (!n || !series.some((x) => x.data.some((v) => +v))) return '<p class="muted small">Nothing to show yet.</p>';
    const W = 900, pl = 64, pr = 8, pt = 10, pb = 26, ih = h - pt - pb, bw = (W - pl - pr) / n;
    const up = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.data[i] || 0), 0)), dn = labels.map((_, i) => series.reduce((a, s) => a + Math.min(0, s.data[i] || 0), 0));
    const max = Math.max(1, ...up), min = Math.min(0, ...dn), span = max - min, y = (v) => pt + ((max - v) / span) * ih;
    const ticks = [max, ...(count && max < 2 ? [] : [max / 2]), 0, ...(min < 0 && y(min) - y(0) > 16 ? [min] : [])];
    let bars = '';
    labels.forEach((l, i) => { let pos = 0, neg = 0; const w = Math.min(bw * 0.7, 56), x = pl + i * bw + (bw - w) / 2;
      for (const s of series) { const v = s.data[i] || 0; if (!v) continue;
        const a = v > 0 ? pos : neg, b = a + v; if (v > 0) pos = b; else neg = b;
        bars += `<rect x="${x.toFixed(1)}" y="${Math.min(y(a), y(b)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, Math.abs(y(a) - y(b))).toFixed(1)}" rx="2" fill="${s.color}"><title>${esc(l)} · ${esc(s.name)}: ${esc(count ? String(v) : cInr(v, true))}</title></rect>`; } });
    const every = Math.ceil(n / 10);
    const xl = labels.map((l, i) => (i % every ? '' : `<text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(l)}</text>`)).join('');
    const yl = ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#E6E8E3"/><text x="${pl - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(lab(v))}</text>`).join('');
    const legend = series.length > 1 ? `<div class="cleg">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return `${legend}<svg class="csvg" viewBox="0 0 ${W} ${h}" role="img" aria-label="bar chart">${yl}${bars}${xl}</svg>`;
  }
  // The ERP's own collections page, built around four questions: how much came in, where the money stands,
  // how old the dues are, and what is coming next. A period switch drives the "came in" figures.
  let collPeriod = 'all';
  async function collections() {
    if (!proj) return noProject();
    $('#page').innerHTML = '<p class="muted">Working out the figures…</p>';
    const M = await api(`/api/dashboard?project=${proj}`);
    const t = M.totals, d = M.daily || [], today = M.meta.today;
    const sum = (a, f) => a.reduce((s, x) => s + (+(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
    const iso = (x) => x.toISOString().slice(0, 10), dt = (s) => new Date(s + 'T00:00:00Z');
    const addD = (s, k) => { const x = dt(s); x.setUTCDate(x.getUTCDate() + k); return iso(x); };
    const fyStart = (s) => { const y = +s.slice(0, 4) - (+s.slice(5, 7) < 4 ? 1 : 0); return `${y}-04-01`; };
    const m0 = today.slice(0, 8) + '01', pm0 = addD(m0, -1).slice(0, 8) + '01';
    const first = (M.monthly && M.monthly[0] ? M.monthly[0].month + '-01' : (d.length ? d[d.length - 1].date : today));
    const P = {
      all: { label: 'Whole project', from: first < '2000' ? today : first, to: today, prev: ['9999-01-01', '9999-01-01'], vs: '' },
      month: { label: 'This month', from: m0, to: today, prev: [pm0, addD(pm0, +today.slice(8, 10) - 1)], vs: 'the same days last month' },
      last: { label: 'Last month', from: pm0, to: addD(m0, -1), prev: [addD(pm0, -1).slice(0, 8) + '01', addD(pm0, -1)], vs: 'the month before' },
      d30: { label: 'Last 30 days', from: addD(today, -29), to: today, prev: [addD(today, -59), addD(today, -30)], vs: 'the 30 days before' },
      fy: { label: 'This financial year', from: fyStart(today), to: today, prev: [addD(fyStart(today), -365), addD(today, -365)], vs: 'the same point last year' },
    };
    const p = P[collPeriod] || P.month;
    const inP = (a, b) => d.filter((x) => x.date >= a && x.date <= b);
    const cur = inP(p.from, p.to), prev = inP(p.prev[0], p.prev[1]);
    const got = sum(cur, 'net'), was = sum(prev, 'net'), chg = was ? Math.round(((got - was) / was) * 100) : null;
    const ret = sum(cur, 'returns'), retK = sum(cur, 'returnCount');
    const whole = collPeriod === 'all';
    const AG = M.ageing || { total: 0, buyers: 0, buckets: [] }, F = M.forecast || { dueNext30: 0, promised: 0, nextStages: [] };
    const demanded = sum(M.units.filter((u) => u.booked), 'demanded'), rec = t.receivedAV, notDue = Math.max(0, t.agreementValue - Math.max(demanded, rec)), unpaid = Math.max(0, demanded - rec);
    const card = (label, value, sub, tn = '', link = '') => `<${link ? `a href="${esc(link)}"` : 'div'} class="cv-card ${tn}"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small>${sub}</small>` : ''}</${link ? 'a' : 'div'}>`;
    // chart: by day for a month or 30 days, by month for the year
    const byMonth = collPeriod === 'fy' || collPeriod === 'all';
    let labels, ser;
    if (byMonth) { const mo = (M.monthly || []).filter((x) => x.month >= p.from.slice(0, 7)); labels = mo.map((x) => cMon(x.month)); ser = [['CRM team', '#117A65', mo.map((x) => x.crm)], ['Sales team', '#7FBFAE', mo.map((x) => x.sales)], ['Returned', '#B42318', mo.map((x) => -x.returns)]]; }
    else { const days = []; for (let k = p.from; k <= p.to; k = addD(k, 1)) days.push(k); const by = Object.fromEntries(cur.map((x) => [x.date, x]));
      labels = days.map((k) => String(+k.slice(8, 10))); ser = [['CRM team', '#117A65', days.map((k) => (by[k] ? by[k].crm : 0))], ['Sales team', '#7FBFAE', days.map((k) => (by[k] ? by[k].sales : 0))], ['Returned', '#B42318', days.map((k) => (by[k] ? -by[k].returns : 0))]]; }
    const chartHtml = barSvg(labels, ser.map(([name, color, data]) => ({ name, color, data })), { h: 240 });
    // wing by wing, for the same period
    const wingOf = (u) => String(u || '').trim().charAt(0).toUpperCase();
    const wings = Object.keys(M.byWing || {}).sort();
    const wingCard = (w) => { const W = M.byWing[w] || {}, items = cur.flatMap((x) => x.items || []).filter((i) => wingOf(i.unit) === w);
      const g = sum(items.filter((i) => i.kind !== 'return'), 'amount') - sum(items.filter((i) => i.kind === 'return'), 'amount');
      return `<div class="cv-wing"><h3>Wing ${esc(w)}</h3><div class="cv-wrow"><span>${esc(p.label)}</span><b>${cInr(g)}</b></div><div class="cv-wrow"><span>Received of agreement value</span><b>${cPct(W.receivedAV, W.agreementValue)}</b></div>
        <div class="cv-bar"><i style="width:${W.agreementValue ? Math.min(100, (W.receivedAV / W.agreementValue) * 100).toFixed(1) : 0}%"></i></div>
        <div class="cv-wrow"><span>Balance due</span><b class="warn-t">${cInr(W.balanceDue)}</b></div><div class="cv-wrow"><span>Flats sold · registered</span><b>${cCnt(W.booked)} · ${cCnt(W.registered)}</b></div></div>`; };
    const maxAge = Math.max(1, ...AG.buckets.map(([, v]) => v));
    const seg = (v, c, l) => (v > 0 ? `<i style="width:${((v / Math.max(1, t.agreementValue)) * 100).toFixed(2)}%;background:${c}" title="${esc(l)}: ${esc(cInr(v))}"></i>` : '');
    $('#page').innerHTML = `<div class="page-head"><div><h1>Collections</h1><p class="muted">${esc((projectList.find((x) => x.id === proj) || {}).name || '')} · live from the ERP${M.meta.lastBankDate ? ', bank entries up to ' + esc(fmtD(M.meta.lastBankDate)) : ''}</p></div>
        <div class="chips" style="margin:0">${Object.entries(P).map(([k, x]) => `<button type="button" class="chip ${k === collPeriod ? 'on' : ''}" data-cp="${k}">${esc(x.label)}</button>`).join('')}</div></div>
      <div class="cv-kpis">
        ${whole ? card('Total collected · whole project', cInr(t.receivedAV + t.receivedGST), `${esc(cInr(t.receivedAV))} towards the flats + ${esc(cInr(t.receivedGST))} GST · <b class="good-t">${cPct(t.receivedAV, t.agreementValue)}</b> of the agreement value of ${esc(cInr(t.agreementValue))}`, 'good', '#/receipts')
          : card(`Collected · ${p.label.toLowerCase()}`, cInr(got), chg == null ? `${cCnt(sum(cur, 'count'))} receipt${sum(cur, 'count') === 1 ? '' : 's'}` : `<b class="${chg >= 0 ? 'good-t' : 'bad-t'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg)}%</b> against ${esc(p.vs)}`, 'good', '#/receipts')}
        ${card('Overdue now', cInr(AG.total), `${cCnt(AG.buyers)} buyer${AG.buyers === 1 ? '' : 's'}${AG.buckets[3] && AG.buckets[3][1] ? ` · <b class="bad-t">${esc(cInr(AG.buckets[3][1]))}</b> over 90 days` : ''}`, AG.total ? 'bad' : 'good', '#/flats?f=overdue')}
        ${card('Coming in · next 30 days', cInr(F.dueNext30 + F.promised), `${esc(cInr(F.dueNext30))} falling due · ${esc(cInr(F.promised))} promised on calls`, 'warn')}
        ${card(`Returned · ${p.label.toLowerCase()}`, cInr(ret), `${cCnt(retK)} cheque${retK === 1 ? '' : 's'} or transfer${retK === 1 ? '' : 's'}`, ret ? 'bad' : '')}
      </div>
      <div class="panel"><div class="cv-h"><h2>How much came in</h2><span class="muted small">${esc(p.label)}${byMonth ? ', month by month' : ', day by day'}${whole && (M.monthly || []).length ? ` · bank receipts since ${esc(cMon(M.monthly[0].month))}` : ''}</span></div>${chartHtml}</div>
      <div class="two">
        <div class="panel"><div class="cv-h"><h2>Where the money stands</h2><span class="muted small">agreement value of flats sold: ${esc(cInr(t.agreementValue))}</span></div>
          <div class="cv-stack">${seg(rec, '#117A65', 'Received')}${seg(unpaid, '#B7791F', 'Demanded, not paid')}${seg(notDue, '#D9DDD6', 'Not demanded yet')}</div>
          <div class="cv-legend">
            <div><i style="background:#117A65"></i><span>Received</span><b>${cInr(rec)}</b><em>${cPct(rec, t.agreementValue)}</em></div>
            <div><i style="background:#B7791F"></i><span>Demanded, not paid</span><b>${cInr(unpaid)}</b><em>${cPct(unpaid, t.agreementValue)}</em></div>
            <div><i style="background:#D9DDD6"></i><span>Not demanded yet</span><b>${cInr(notDue)}</b><em>${cPct(notDue, t.agreementValue)}</em></div>
          </div>
          <p class="small muted" style="margin:10px 0 0">Plus GST: ${esc(cInr(t.receivedGST))} received, ${esc(cInr(t.gstDue))} due. TDS: ${esc(cInr(sum(M.units, 'tdsPaid')))} paid by buyers, ${esc(cInr(sum(M.units, 'tdsDue')))} to come.</p></div>
        <div class="panel"><div class="cv-h"><h2>How old the dues are</h2><a class="small" href="#/flats?f=overdue">See the buyers →</a></div>
          <div class="cv-age">${AG.buckets.map(([l, v], i) => `<a href="#/flats?f=overdue"><span>${esc(l)}</span><div class="cv-bar"><i style="width:${((v / maxAge) * 100).toFixed(1)}%;background:${['#7FBFAE', '#E3B25E', '#D9822B', '#B42318'][i]}"></i></div><b>${cInr(v)}</b></a>`).join('') || '<p class="muted small">Nothing overdue.</p>'}</div>
          ${(AG.top || []).length ? `<h3 class="cv-sub">Largest overdue</h3><div class="cv-top">${AG.top.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}</div>
      </div>
      <div class="panel"><div class="cv-h"><h2>What is coming next</h2><a class="small" href="#/demands">Stages &amp; demands →</a></div>
        <div class="cv-next">${F.nextStages.map((x) => `<div><span>Wing ${esc(x.wing)} · next stage</span><b>${esc(x.stage.replace(/^On (Completion of )?/, ''))}</b><small>${x.pct}% of ${cCnt(x.bookings)} bookings · ${esc(cInr(x.amount + x.gst))} with GST</small></div>`).join('')}
          <div><span>Falling due in 30 days</span><b>${cInr(F.dueNext30)}</b><small>${cCnt(F.dueNext30Count)} buyer${F.dueNext30Count === 1 ? '' : 's'}</small></div>
          <div><span>Promised on calls, 30 days</span><b>${cInr(F.promised)}</b><small>${cCnt(F.promisedCount)} promise${F.promisedCount === 1 ? '' : 's'} · <a href="#/flats?f=call">calls</a></small></div></div></div>
      <div class="panel"><div class="cv-h"><h2>Wing by wing</h2><span class="muted small">${esc(p.label)}</span></div><div class="cv-wings">${wings.map(wingCard).join('')}</div></div>`;
    document.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => { collPeriod = b.dataset.cp; collections(); }));
  }

  // ---------- Accounts dashboard (the ERP's own page; the figures are the accounts model in lib/master-model.js) ----------
  // Cash in the bank, money in and out, collections by head, payments by head, and what needs attention.
  let adPeriod = 'm';
  async function accdash(refresh) {
    $('#page').innerHTML = '<p class="muted">Working out the figures…</p>';
    const r = await api('/api/acc-dashboard' + (refresh === true ? '?refresh=1' : ''));
    const D = r.model || r, C = D.C, PH = D.PH || {}, B = D.banks || [];
    const PL = { m: D.monthLabel, fy: D.fyLabel, td: 'Till date' };
    const card = (label, value, sub, tn = '', link = '') => `<${link ? `a href="${esc(link)}"` : 'div'} class="cv-card ${tn}"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small>${sub}</small>` : ''}</${link ? 'a' : 'div'}>`;
    // bank groups: the rows above "SIGNATURE - TOTAL", then above "ASPIRE - TOTAL", then the grand total
    const iS = B.findIndex((b) => /^SIGNATURE\s*-\s*TOTAL$/i.test(b.b)), iA = B.findIndex((b) => /^ASPIRE\s*-\s*TOTAL$/i.test(b.b));
    const Z = { cl: 0, rc: 0, py: 0 }, G = B.find((b) => /^GRAND TOTAL$/i.test(b.b)) || Z;
    const groups = [['Dream Signature', iS >= 0 ? B.slice(0, iS) : [], B[iS] || Z], ['Dream Aspire', iA >= 0 ? B.slice(iS + 1, iA) : [], B[iA] || Z]].filter(([, rows, t]) => rows.length || t.cl);
    // collections for the period: AV, GST, SDR and unclassified from current buyers, plus TDS paid by buyers, less refunds
    const REF = PH['Flat - Cancelled Refunded'] || { m: 0, fy: 0, td: 0, n: 0 }, TP = (D.tds && D.tds.per) || { m: 0, fy: 0, td: 0, n: 0 };
    const heads = [['Agreement value', C.AV], ['GST', C.GST], ['SDR (stamp duty and registration)', C.SDR], ['Not split by head yet', C.Unclassified]];
    const p = adPeriod, inBank = heads.reduce((s, [, x]) => s + (x[p] || 0), 0), net = inBank + (TP[p] || 0) - (REF[p] || 0);
    const pays = Object.entries(PH).map(([k, x]) => [k, x]).sort((a, b) => (b[1][p] || 0) - (a[1][p] || 0));
    const paidOut = pays.reduce((s, [, x]) => s + (x[p] || 0), 0);
    // what needs attention (from the same checks as the 9 am audit)
    const badChecks = (D.checks || []).filter((c) => c === 'Check').length, openRI = (D.ri || []).filter((x) => x.st === 'Open');
    const K = D.D || {}, att = [
      badChecks ? ['bad', `${badChecks} month-end check${badChecks === 1 ? '' : 's'} not OK`, '#/checks'] : null,
      openRI.length ? ['warn', `${openRI.length} reconciling item${openRI.length === 1 ? '' : 's'} open: ${cInr(openRI.reduce((s, x) => s + (+x.amt || 0), 0))}`, '#/reg-recon'] : null,
      C.nounit && C.nounit.n ? ['warn', `${C.nounit.n} receipt${C.nounit.n === 1 ? '' : 's'} not linked to a flat yet: ${cInr(C.nounit.td)}`, '#/reg-receipts'] : null,
      C.bounced && C.bounced.n ? ['warn', `${C.bounced.n} bounced cheque${C.bounced.n === 1 ? '' : 's'} on record: ${cInr(C.bounced.td)}`, '#/reg-receipts'] : null,
      K['GST shortfall on AV received'] > 1000 ? ['warn', `GST short on agreement value already received: ${cInr(K['GST shortfall on AV received'])}`, '#/accreports'] : null,
      K['Units registered but SDR short'] ? ['warn', `${K['Units registered but SDR short']} flat${K['Units registered but SDR short'] === 1 ? '' : 's'} registered with stamp duty still short`, '#/sdr'] : null,
      (D.pdc && D.pdc.rows || []).filter((x) => x.left != null && x.left <= 7 && x.left >= 0).length ? ['warn', `${(D.pdc.rows || []).filter((x) => x.left <= 7 && x.left >= 0).length} PDC due in the next 7 days: ${cInr((D.pdc.rows || []).filter((x) => x.left <= 7 && x.left >= 0).reduce((s, x) => s + x.amt, 0))}`, '#/reg-pdc'] : null,
    ].filter(Boolean);
    const flow = D.flow12 || [];
    const maxPay = Math.max(1, ...pays.slice(0, 10).map(([, x]) => x[p] || 0));
    $('#page').innerHTML = `<div class="page-head"><div><h1>Accounts dashboard</h1><p class="muted">${esc((projectList.find((x) => x.id === proj) || {}).name || '')} · bank balances as of ${esc(D.asof || '—')}, live from the registers</p></div>
        <div class="chips" style="margin:0">${Object.entries(PL).map(([k, l]) => `<button type="button" class="chip ${k === adPeriod ? 'on' : ''}" data-ap="${k}">${esc(l)}</button>`).join('')}<button type="button" class="chip" id="adRe" title="Read the registers again">Refresh</button></div></div>
      <div class="cv-kpis">
        ${card('Cash in bank · all accounts', cInr(G.cl), `as of ${esc(D.asof || '—')}`, '', '#/balances')}
        ${card(`Net collections · ${p === 'td' ? 'till date' : PL[p]}`, cInr(net), `${esc(cInr(inBank))} into the bank + ${esc(cInr(TP[p] || 0))} TDS paid by buyers − ${esc(cInr(REF[p] || 0))} refunds`, 'good', '#/reg-receipts')}
        ${card(`Paid out · ${p === 'td' ? 'till date' : PL[p]}`, cInr(paidOut), `${cCnt(pays.reduce((s, [, x]) => s + (x.n || 0), 0))} payments in all`, 'warn', '#/reg-payments')}
        ${card('Needs attention', String(att.length), att.length ? 'see the list below' : 'everything checks out', att.length ? 'bad' : 'good', '#/checks')}
      </div>
      <div class="panel"><div class="cv-h"><h2>Cash in the bank</h2><a class="small" href="#/balances">Daily Bank Balance →</a></div>
        <div class="cv-wings">${groups.map(([name, rows, t]) => `<div class="cv-wing"><h3>${esc(name)} <span class="muted small" style="font-weight:400">· ${rows.length} account${rows.length === 1 ? '' : 's'}</span></h3><div class="cv-wrow"><span>Closing balance</span><b>${cInr(t.cl)}</b></div>
          ${rows.map((b) => `<div class="cv-wrow small"><span>${esc(b.b)}</span><b style="font-weight:600">${cInr(b.cl)}</b></div>`).join('')}</div>`).join('') || '<p class="muted small">No bank balances entered yet.</p>'}</div></div>
      <div class="panel"><div class="cv-h"><h2>Money in and out</h2><span class="muted small">last 12 months, from the registers</span></div>
        ${barSvg(flow.map((x) => cMon(x.m)), [{ name: 'Money in', color: '#117A65', data: flow.map((x) => x.in) }, { name: 'Money out', color: '#B42318', data: flow.map((x) => -x.out) }], { h: 240 })}</div>
      <div class="two">
        <div class="panel"><div class="cv-h"><h2>Collections by head</h2><span class="muted small">${esc(PL[p])}</span></div>
          <div class="table-wrap"><table><tr><th>Head</th><th class="num">Receipts</th><th class="num">Amount</th></tr>
          ${heads.map(([l, x]) => `<tr><td>${esc(l)}</td><td class="num">${cCnt(x.n)}</td><td class="num">${cInr(x[p] || 0)}</td></tr>`).join('')}
          <tr><td>TDS paid by buyers (counted as received)</td><td class="num">${cCnt(TP.n)}</td><td class="num">${cInr(TP[p] || 0)}</td></tr>
          <tr><td>Less: refunds on cancelled flats</td><td class="num">${cCnt(REF.n)}</td><td class="num bad-t">−${cInr(REF[p] || 0)}</td></tr>
          <tr class="tot"><td><b>Net collections</b></td><td></td><td class="num"><b>${cInr(net)}</b></td></tr>
          <tr class="dim"><td>From earlier buyers of a flat</td><td class="num">${cCnt(C.other.n)}</td><td class="num">${cInr(C.other[p] || 0)}</td></tr></table></div></div>
        <div class="panel"><div class="cv-h"><h2>Payments by head</h2><a class="small" href="#/reg-payments">Payments Out →</a></div>
          <div class="cv-age">${pays.slice(0, 10).filter(([, x]) => x[p]).map(([k, x]) => `<a href="#/reg-payments"><span title="${esc(k)}">${esc(k)}</span><div class="cv-bar"><i style="width:${(((x[p] || 0) / maxPay) * 100).toFixed(1)}%;background:#B7791F"></i></div><b>${cInr(x[p])}</b></a>`).join('') || '<p class="muted small">No payments in this period.</p>'}</div>
          ${pays.length > 10 ? `<p class="small muted" style="margin:8px 0 0">Top 10 of ${pays.length} heads. All of them are in Reports &amp; Tally.</p>` : ''}</div>
      </div>
      <div class="panel"><div class="cv-h"><h2>Needs attention</h2><a class="small" href="#/acctodo">Today’s list →</a></div>
        ${att.length ? `<ul class="mg-att">${att.map(([tn, text, link]) => `<li class="${tn}"><a href="${esc(link)}"><span class="dot"></span><span>${esc(text)}</span><b>→</b></a></li>`).join('')}</ul>` : '<div class="mg-clear">✓ All clear. The registers check out.</div>'}</div>`;
    document.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => { adPeriod = b.dataset.ap; accdash(); }));
    $('#adRe').onclick = () => accdash(true);
  }

  // ---------- CA / Tax (inside the ERP; the figures and the click-through lists are page-ca.js, unchanged) ----------
  const loadScript = (src) => new Promise((ok, no) => { if (document.querySelector(`script[data-src="${src}"]`)) return ok(); const e = document.createElement('script'); e.src = src; e.dataset.src = src; e.onload = ok; e.onerror = () => no(new Error('Could not load ' + src)); document.head.appendChild(e); });
  async function caPage() {
    const body = await (await fetch('/ca-body.html', { cache: 'no-store' })).text();
    const SECS = [['#gst', 'GST'], ['#tdsp', 'TDS payable'], ['#rera', 'RERA'], ['#cash', 'Cash flow'], ['#comp', 'Compliance'], ['#ctds', 'Customer TDS'], ['#nonrev', 'Non-revenue receipts']];
    $('#page').innerHTML = `<div class="page-head ca-head"><div><h1>CA / Tax</h1><div class="ca-meta"><span class="dot"></span><span id="asof"></span><span id="live">Loading…</span><span id="user" hidden></span></div></div>
        <div class="actions" style="margin:0;align-items:center"><label class="small" style="margin:0;display:flex;gap:6px;align-items:center">Period <select id="per" aria-label="Period" style="width:auto"></select></label><button class="ghost small" id="reload" type="button" hidden>Refresh</button></div></div>
      <div class="ca-scope"><nav class="ca-nav" aria-label="Sections">${SECS.map(([id, l], i) => `<button type="button" data-sec="${id}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</nav>${body}</div>`;
    await loadScript('/drill.js'); await loadScript('/page-ca.js');
    window.CAPage();
  }

  async function mgmt() {
    const pq = proj ? `?project=${proj}` : '';
    $('#page').innerHTML = heroHtml('Management', 'Management dashboard', 'Working out today’s figures…', ['#/home', 'Home']);
    const d = await api('/api/mgmt' + pq);
    const tone = (t) => (t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : t === 'good' ? 'good' : '');
    const href = (h) => esc(h || '#/mgmt');
    const card = (t) => `<article class="mg-card ${tone(t.tone)}">
        <a class="mg-top" href="${href(t.link)}"><span class="mg-t">${esc(t.title)}</span><span class="mg-v">${esc(t.value)}</span>${t.sub ? `<span class="mg-s">${esc(t.sub)}</span>` : ''}</a>
        ${(t.lines || []).length ? `<ul class="mg-l">${t.lines.map(([l, v, tn, h]) => `<li class="${tone(tn)}">${h ? `<a href="${href(h)}">${esc(l)}</a>` : `<span>${esc(l)}</span>`}<b>${esc(v)}</b></li>`).join('')}</ul>` : ''}
        ${t.list && t.list.rows.length ? `<div class="mg-h">${esc(t.list.h)}</div><ul class="mg-l">${t.list.rows.map(([l, v]) => `<li><span>${esc(l)}</span><b>${esc(v)}</b></li>`).join('')}</ul>` : ''}
        ${t.note ? `<p class="mg-n">${esc(t.note)}</p>` : ''}
        <a class="mg-go" href="${href(t.link)}">Open →</a></article>`;
    const at = new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    // Today: six numbers and only what needs attention. Full report: every figure, for the monthly review.
    let view = store.get('erp_mg_view') === 'full' ? 'full' : 'today';
    const D = d.daily || { top: [], attention: [], limits: {} };
    // the same look as the Collections dashboard: a grid of figures, big coloured numbers, a short line under each
    const fig = (x) => `<a class="mfig ${tone(x.tone)}" href="${href(x.link)}"><span>${esc(x.title)}</span><b>${esc(x.value)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</a>`;
    const rfig = (t) => `<a class="mfig ${tone(t.tone)}" href="${href(t.link)}"><span>${esc(t.title)}</span><b>${esc(t.value)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}
        ${(t.lines || []).length ? `<ul>${t.lines.slice(0, 5).map(([l, v, tn]) => `<li class="${tone(tn)}"><i>${esc(l)}</i><em>${esc(v)}</em></li>`).join('')}</ul>` : ''}</a>`;
    const att = D.attention.length
      ? `<ul class="mg-att">${D.attention.map((a) => `<li class="${tone(a.tone)}"><a href="${href(a.link)}"><span class="dot"></span><span>${esc(a.text)}</span><b>→</b></a></li>`).join('')}</ul>`
      : '<div class="mg-clear">✓ All clear. Nothing needs your attention today.</div>';
    $('#page').innerHTML = `<div class="hero mg-hero"><div class="hero-in"><a class="back" href="#/home">← Home</a><span class="eyebrow">${esc(d.project ? d.project.name : '')} · ${esc(fmtD(d.today))}</span>
        <h1>Management dashboard</h1>
        <div class="mg-sync"><span class="dot"></span><span>Figures as of ${at} today, live from the ERP</span><span class="mg-act"><button class="mg-btn" id="mgLim" title="When an item comes on the attention list">Alert limits</button><button class="mg-btn" id="mgRe">Refresh</button></span></div>
        <nav class="mg-tabs2" role="tablist">${[['today', 'Today'], ['full', 'Full report']].map(([k, l]) => `<button type="button" role="tab" data-mv="${k}" aria-selected="${k === view}">${l}</button>`).join('')}</nav></div></div>
      <div class="hm mg">
        <div data-mvp="today" ${view === 'today' ? '' : 'hidden'}>
          <div class="mfigs">${D.top.map(fig).join('')}</div>
          <section class="mpanel"><h2>Needs your attention ${D.attention.length ? `<span class="mg-cnt">${D.attention.length}</span>` : ''}</h2>${att}</section>
        </div>
        <div data-mvp="full" ${view === 'full' ? '' : 'hidden'}>
          ${salesStrip(d.sales, { title: 'Sales: saleable flats, area sold and the average rate', link: '#/units' })}
          ${d.sections.map((s) => `<section class="mpanel"><h2>${esc(s.title)}</h2><div class="mfigs in">${s.tiles.map(rfig).join('')}</div></section>`).join('')}
        </div>
      </div>`;
    document.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => { view = b.dataset.mv; store.set('erp_mg_view', view);
      document.querySelectorAll('[data-mv]').forEach((x) => x.setAttribute('aria-selected', x.dataset.mv === view));
      document.querySelectorAll('[data-mvp]').forEach((x) => (x.hidden = x.dataset.mvp !== view)); }));
    $('#mgRe').onclick = () => mgmt();
    $('#mgLim').onclick = () => { const L = D.limits;
      const f = (k, label, unit) => `<div><label>${label}</label><input name="${k}" inputmode="decimal" value="${esc(L[k] ?? '')}"><span class="small muted">${unit}</span></div>`;
      dialog(`<h2>Alert limits</h2><p class="muted small">An item comes on "Needs your attention" only when it crosses these limits.</p>
        <div class="row">${f('approvalDays', 'Approval waiting more than', 'days')}${f('hindranceDays', 'Site hindrance open more than', 'days')}</div>
        <div class="row">${f('taxDays', 'Tax or compliance filing due within', 'days (overdue ones always show)')}${f('siteDelay', 'Tower behind the slab schedule by more than', 'days')}</div>
        <div class="row">${f('refundDays', 'Refund on a cancelled flat pending more than', 'days')}${f('tallyGap', 'Tally and CRM differ by more than', '₹')}</div>
        <div class="row">${f('brokenAmount', 'Broken promises to pay totalling at least', '₹')}<div></div></div>`,
      async (x) => { await api('/api/mgmt', { action: 'alerts', limits: x }); toast('Saved.'); mgmt(); }); };
  }

  async function dailyTodo(dept, dateArg) {
    const name = dept === 'crm' ? 'Sales & CRM' : 'Accounts';
    const date = dateArg || store.get('erp_todo_date_' + dept) || todayIso();
    const d = await api(`/api/tasks?dept=${dept}&date=${date}`);
    const isToday = d.date === d.today;
    // Team members open on their own list; the heads (who can run the audit) see the whole team's.
    const f = store.get('erp_todo_f_' + dept) || (d.can.run ? 'open' : 'mine');
    const rows = d.rows.filter((r) => (f === 'open' ? !r.done_at : f === 'mine' ? !r.done_at && (r.assigned_to === d.me || !r.assigned_to) : true));
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
        <div class="tabs" style="margin:0">${[['mine', 'Mine (mine + whole team)'], ['open', 'Everyone\'s open'], ['all', 'All, with done']].map(([k, l]) => `<button class="tab ${k === f ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
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
      <div class="panel"><h2>Closing balances for ${fmtD(d.date)}</h2>${d.confirmed ? `<p><span class="pill good">confirmed</span> by ${esc(d.confirmed.by || '')}, ${new Date(d.confirmed.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}${d.confirmed.note ? ' · ' + esc(d.confirmed.note) : ''}</p>` : `<p class="small muted" style="margin:0 0 8px">Receipts and payments for each day are filled in from the bank statements read at 3:10 pm, with the balance each bank shows. Check that Closing agrees with Balance per Bank, then confirm.</p>`}
        ${d.can.enter ? `<div class="row" style="grid-template-columns:1fr auto;align-items:end"><div><label>Note (needed only if a bank does not agree)</label><input id="cfNote" maxlength="300"></div><button id="cfDay" class="${d.confirmed ? 'ghost' : ''}">${d.confirmed ? 'Confirm again' : 'Confirm the closing balances'}</button></div>` : ''}</div>
      <div class="panel"><div class="page-head" style="margin:0 0 8px"><h2 style="margin:0">Daily entries (latest 60)</h2>${d.can.enter ? '<button id="addEntry">Add a day\'s entry</button>' : ''}</div>
        <div class="table-wrap"><table><tr><th>Date</th><th>Bank</th><th class="num">Receipts</th><th class="num">Payments</th><th>Remarks</th><th>Entered by</th></tr>
        ${d.entries.map((e) => `<tr><td>${fmtD(e.entry_date)}</td><td>${esc(e.bank)}</td><td class="num">${e.receipts == null ? '' : inr(e.receipts)}</td><td class="num">${e.payments == null ? '' : inr(e.payments)}</td><td class="small">${esc(e.remarks || '')}</td><td class="small">${esc(e.entered_by || '')}</td></tr>`).join('')}</table></div>
        <div class="actions"><a class="btn ghost" href="#/reg-daily">All daily entries</a></div></div>`;
    $('#bd').onchange = (e) => { store.set('erp_bal_date', e.target.value); accBalances(e.target.value); };
    if ($('#cfDay')) $('#cfDay').onclick = async () => { try { await api('/api/accounts', { action: 'confirm-day', date: d.date, note: $('#cfNote').value }); toast('Closing balances confirmed.'); accBalances(d.date); } catch (e) { alert(e.message); } };
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
    const lastM = (() => { const t = new Date(Date.now() + 5.5 * 3600e3); t.setUTCDate(0); return t.toISOString().slice(0, 7); })();
    const bad = d.rows.filter((x) => x.result === 'Check').length;
    const closeBox = `<div class="panel"><h2>Close the month</h2><p class="small muted" style="margin:0 0 8px">${d.closed ? `The books are closed up to <b>${fmtD(d.closed.date)}</b> (by ${esc(d.closed.by || '')}, ${fmtD(String(d.closed.at).slice(0, 10))}). An entry dated on or before that day can be changed only by Head Accounts, with a reason, and it is marked in the audit log.` : 'No month is closed yet. Once a month is closed, entries dated in it can be changed only by Head Accounts, with a reason.'}</p>
      ${d.can.manage ? `<div class="row" style="grid-template-columns:180px auto auto;align-items:end;justify-content:start"><div><label>Month</label><input type="month" id="clm" value="${lastM}" max="${lastM}"></div><button id="closeM">Close the month</button>${d.closed ? '<button class="ghost" id="reopenM">Reopen to an earlier month</button>' : ''}</div>${bad ? `<p class="small bad-t" style="margin:6px 0 0">${bad} check${bad > 1 ? 's say' : ' says'} Check. Fix ${bad > 1 ? 'them' : 'it'} before closing.</p>` : ''}` : ''}</div>`;
    $('#page').innerHTML = `<div class="page-head"><div><h1>Checks</h1><p class="muted">Month end: every line in the Result column should say OK. If one says Check, fix the entry it points to. "For review" lines are not expected to be zero; they are explained unit by unit on the reports.</p></div></div>
      ${closeBox}
      <div class="panel" id="caPack"><h2>Monthly pack for the CA</h2><p class="muted small">Loading…</p></div>
      <div class="panel"><div class="table-wrap"><table><tr><th>#</th><th>Check</th><th class="num">Figure</th><th>Result</th><th>What it means</th></tr>
        ${d.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.check)}</td><td class="num">${typeof x.figure === 'number' ? x.figure.toLocaleString('en-IN') : esc(x.figure)}</td><td>${x.result === 'OK' ? '<span class="pill good">OK</span>' : x.result === 'Check' ? '<span class="pill bad">Check</span>' : '<span class="pill grey">For review</span>'}</td><td class="small">${esc(x.means || '')}</td></tr>`).join('')}</table></div></div>`;
    (async () => {
      const P = await api('/api/accounts?view=capack').catch(() => null); const box = $('#caPack'); if (!P || !box) return;
      const S = P.settings, lm = (() => { const t = new Date(Date.now() + 5.5 * 3600e3); t.setUTCDate(0); return t.toISOString().slice(0, 7); })();
      box.innerHTML = `<h2>Monthly pack for the CA</h2><p class="small muted" style="margin:0 0 8px">On the ${S.day || 5}th of every month the ERP emails the CA one Excel file for the month before: a summary of GST, TDS and RERA collections, and the month's Receipts, Payments Out, TDS entries, PDCs and Daily Bank Balance entries.${P.live ? '' : ' <b>Test version: it goes only to the test email address in Letter settings.</b>'}</p>
        ${P.last.length ? `<p class="small">Sent: ${P.last.map((x) => `${esc(x.month)} on ${fmtD(String(x.at).slice(0, 10))} to ${esc((x.to || []).join(', '))}${x.test ? ' (test)' : ''}`).join(' · ')}</p>` : '<p class="small muted">Not sent yet.</p>'}
        ${d.can.manage ? `<div class="row" style="grid-template-columns:1fr 1fr 160px;align-items:end"><div><label>CA's email</label><input id="cpTo" value="${esc(S.to || '')}" placeholder="ca@firm.com"></div><div><label>CC</label><input id="cpCc" value="${esc(S.cc || '')}"></div><div><label>Send by itself</label><select id="cpOn"><option value="1">Yes, on the ${S.day || 5}th</option><option value="0" ${S.on === false ? 'selected' : ''}>No</option></select></div></div>
        <div class="actions"><button class="ghost" id="cpSave">Save</button><a class="btn ghost" href="/api/accounts?view=capack&download=${lm}">Download ${lm}</a><button id="cpSend">Send ${lm} now</button></div>` : `<div class="actions"><a class="btn ghost" href="/api/accounts?view=capack&download=${lm}">Download ${lm}</a></div>`}`;
      if ($('#cpSave')) $('#cpSave').onclick = async () => { try { await api('/api/accounts', { action: 'ca-pack', to: $('#cpTo').value, cc: $('#cpCc').value, on: $('#cpOn').value === '1' }); toast('Saved.'); } catch (e) { alert(e.message); } };
      if ($('#cpSend')) $('#cpSend').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/api/accounts', { action: 'ca-pack', send: true, month: lm }); toast('Sent to ' + r.to.join(', ') + (r.test ? ' (test address)' : '')); accChecks(); } catch (x) { e.target.disabled = false; alert(x.message); } };
    })();
    if ($('#closeM')) $('#closeM').onclick = async () => { const m = $('#clm').value; if (bad && !confirm(`${bad} checks still say Check. Close ${m} anyway?`)) return; if (!confirm(`Close the books for ${m}? Entries dated in it can then be changed only by Head Accounts, with a reason.`)) return; try { await api('/api/accounts', { action: 'close-month', month: m }); toast('Month closed.'); accChecks(); } catch (e) { alert(e.message); } };
    if ($('#reopenM')) $('#reopenM').onclick = async () => { const m = prompt('Reopen the books back to the end of which month? (YYYY-MM, before the one closed now)'); if (!m) return; const why = prompt('Why are the books being reopened?'); if (!why) return; try { await api('/api/accounts', { action: 'close-month', month: m.trim(), reopen: true, reason: why }); toast('Books reopened.'); accChecks(); } catch (e) { alert(e.message); } };
  }

  async function accReports() {
    const tab0 = store.get('erp_accrep'), tab = ['byHead', 'units', 'tds', 'bounced'].includes(tab0) || !tab0 ? 'gst' : tab0;
    const T = [['gst', 'GST report'], ['sdr', 'SDR report'], ['payees', 'Payees'], ['partners', 'Channel partner accounts'], ['vendorBills', 'Vendor bills'], ['register', 'Salary & expense register'], ['tally', 'Tally export']];
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
    if (tab === 'gst') out.innerHTML = table([['Unit', (r) => r.unit], ['Applicant', (r) => r.applicant], ['Status', (r) => r.status], ['Agreement value', (r) => r.av, 'm'], ['GST payable', (r) => r.gstPayable, 'm'], ['AV received (bank)', (r) => r.avReceived, 'm'], ['GST due on AV received', (r) => r.gstDueOnReceived, 'm'], ['GST received (bank)', (r) => r.gstReceived, 'm'], ['Shortfall on received', (r) => r.shortfall, 'm'], ['GST outstanding (full)', (r) => r.outstanding, 'm'], ['GST per CRM (ERP)', (r) => r.crm, 'm'], ['Status', (r) => r.state]], d.rows);
    else if (tab === 'sdr') out.innerHTML = table([['Unit', (r) => r.unit], ['Applicant', (r) => r.applicant], ['Status', (r) => r.status], ['Registration', (r) => r.registration], ['Stamp duty', (r) => r.stampDuty, 'm'], ['Registration fee', (r) => r.registrationFee, 'm'], ['SDR payable', (r) => r.payable, 'm'], ['SDR received (bank)', (r) => r.received, 'm'], ['SDR paid out (challans)', (r) => r.paidOut, 'm'], ['Held (received − paid)', (r) => r.held, 'm'], ['To collect', (r) => r.toCollect, 'm'], ['SDR per CRM (ERP)', (r) => r.crm, 'm'], ['Status', (r) => r.state]], d.rows);
    else if (tab === 'partners') {
      const cols = [['CP firm', (r) => r.firm], ['Flats', (r) => r.flats, 'n'], ['Agreement value', (r) => r.av, 'm'], ['Brokerage agreed', (r) => r.agreed, 'm'], ['Billed by CP', (r) => r.billed, 'm'],
        ['Paid as per CRM', (r) => r.paidCrm, 'm'], ['Paid as per books', (r) => r.paidBooks, 'm'], ['TDS deducted (books)', (r) => r.tdsBooks, 'm'], ['Books less CRM', (r) => r.difference, 'm'], ['Check', (r) => r.state],
        ['Balance brokerage', (r) => r.balance, 'm'], ['Due now (rule)', (r) => r.dueNow, 'm'], ['Last paid', (r) => (r.lastPaid ? fmtD(r.lastPaid) : '')], ['Units', (r) => r.units]];
      const sum = (k) => d.rows.reduce((a, r) => a + (r[k] || 0), 0);
      out.innerHTML = `<div class="panel"><p class="muted">One line per channel partner firm. "Paid as per CRM" is the brokerage released or paid on the CRM side; "Paid as per books" is Payments Out under a commission or brokerage head, matched by the partner's flats or the firm's name. Due now follows the brokerage rule (${d.rule && d.rule.afterRegistration ? 'after registration, ' : ''}${d.rule ? d.rule.minReceivedPct : 10}% of agreement value received).</p>
        <div class="kpis">${kpi(d.rows.length, 'CP firms')}${kpi(inr(sum('agreed')), 'brokerage agreed')}${kpi(inr(sum('paidBooks') + sum('tdsBooks')), 'paid in the books (with TDS)')}${kpi(inr(sum('balance')), 'balance brokerage')}${kpi(inr(sum('dueNow')), 'due now')}${kpi(d.rows.filter((r) => r.state !== 'Agrees').length, 'firms where CRM and books differ', d.rows.some((r) => r.state !== 'Agrees') ? 'bad' : '')}</div>
        ${d.unmatched.n ? `<p class="small bad-t">${d.unmatched.n} commission payments (${inr(d.unmatched.amount)}) in the books could not be matched to a partner: give them the unit or the partner's name as payee.</p>` : ''}
        <div class="actions"><button class="ghost small" id="cpCsv">Download for Excel (CSV)</button></div></div>` + table(cols, d.rows);
      $('#cpCsv').onclick = () => {
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [cols.map(([l]) => q(l)).join(','), ...d.rows.map((r) => cols.map(([, f, t]) => (t ? Math.round(+f(r) || 0) : q(f(r)))).join(','))].join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `channel-partner-accounts-${todayIso()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
    }
    else if (tab === 'payees') out.innerHTML = table([['Payee', (r) => r.payee], ['Type', (r) => r.type], ['PAN', (r) => r.pan], ['GSTIN', (r) => r.gstin], ['TDS section', (r) => r.tdsSection], ['Usual cash flow head', (r) => r.usualHead], ['Needs invoice?', (r) => r.needsInvoice], ['No. of payments', (r) => r.n, 'n'], ['Total paid', (r) => r.paid, 'm'], ['Total billed', (r) => r.billed, 'm'], ['TDS on bills', (r) => r.tds, 'm']], d.rows);
    else if (tab === 'vendorBills') out.innerHTML = table([['Payment ID', (r) => r.ref_id], ['Paid on', (r) => fmtD(r.txn_date)], ['Payee', (r) => r.payee], ['Head', (r) => r.head], ['Bill date', (r) => (r.bill_date ? fmtD(r.bill_date) : '')], ['Vendor PAN', (r) => r.vendor_pan], ['Bill no.', (r) => r.bill_no], ['Taxable', (r) => r.taxable_value, 'm'], ['GST', (r) => r.gst_on_bill, 'm'], ['Total bill', (r) => r.total_bill, 'm'], ['TDS section', (r) => r.tds_section || r.tdsSectionUsual], ['TDS deducted', (r) => r.tds_deducted, 'm'], ['Paid', (r) => r.amount, 'm'], ['Challan', (r) => r.tds_challan], ['What staff need to add', (r) => r.needs]], d.rows);
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
    const [d, DB] = await Promise.all([api(`/api/verify?project=${proj}&status=${tab}`), can('ledger.view') ? api(`/api/dashboard?project=${proj}`).catch(() => null) : null]);
    const kinds = [...new Set(d.rows.map((r) => r.kind))];
    // checks worked out from the live figures (they clear by themselves once the entry is corrected)
    const live = DB && DB.actions ? [['sdrGaps', 'SDR received and SDR paid do not agree', (x) => `difference ${inr(x.sdrDifference)}`], ['missingDates', 'Key dates missing', (x) => `missing: ${x.missing || ''}`]].map(([k, h, f]) => [h, DB.actions[k] || [], f]) : [];
    const kf = store.get('erp_vkind') || '';
    const rows = d.rows.filter((r) => !kf || r.kind === kf);
    $('#page').innerHTML = `<div class="page-head"><div><h1>Data to verify</h1><p class="muted">Everything the import found that does not add up. Check each against the documents and the bank, correct it in the ERP if needed, then close it with a note of what was done.</p></div></div>
      <div class="panel"><div class="kpis">${kpi(d.counts.open, 'open')}${kpi(d.counts.money, 'involve money', d.counts.money ? 'bad' : '')}${kpi(d.counts.resolved, 'closed')}</div></div>
      ${live.filter(([, r]) => r.length).map(([h, r, f]) => `<details class="panel"><summary><b>${esc(h)}</b> <span class="pill warn">${r.length}</span> <span class="small muted">from the live figures; clears once the flat is corrected · tap to see</span></summary>
        <div class="table-wrap" style="margin-top:10px"><table><tr><th>Flat</th><th>Buyer</th><th></th></tr>${r.map((x) => `<tr><td><b>${esc(x.unit)}</b></td><td>${esc(x.applicant || '')}</td><td class="small">${esc(f(x))}</td></tr>`).join('')}</table></div></details>`).join('')}
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
