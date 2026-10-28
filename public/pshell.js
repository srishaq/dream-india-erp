// Header for the sections brought over from the staff portal (Purchase, Construction, Drawings, HR & Admin), inside the ERP: department tabs, the signed-in user menu, change password,
// and sending people to a section their role allows. Access itself is enforced by the API;
// this only decides what to show.
(function () {
  // Install as an app: Chrome / Edge offer it once the service worker is registered. The header
  // button uses that offer when there is one, otherwise it opens the install instructions page.
  let installEvt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const showInstall = (on) => document.querySelectorAll('.shl-inst').forEach((b) => { b.hidden = !on; });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; showInstall(false); });
  async function install() {
    if (!installEvt) { location.href = '/install'; return; }
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null;
    if (outcome === 'accepted') showInstall(false);
  }

  const MODS = [
    ['crm', 'Sales & CRM', '/#/project/1/crm'],
    ['site', 'Construction', '/site'],
    ['accounts', 'Accounts', '/#/project/1/accounts'],
    ['audit', 'CRM/Accounts Audit', '/#/project/1/audit', 'Audit'],
    ['ca', 'CA / Tax', '/ca'],
    ['purchase', 'Purchase', '/purchase'],
    ['drawings', 'Drawings', '/drawings'],
    ['hr', 'HR & Admin', '/hr', 'HR'],
    ['training', 'Training videos', '/#/training', 'Training'],
  ];
  // Dream India Home: the management landing page with a tile for every project and tool.
  const css = `
  .shl-left{display:flex;align-items:center;gap:8px;min-width:0}
  .shl-home{flex:none;display:inline-flex;align-items:center;gap:6px;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);white-space:nowrap}
  .shl-home[aria-current="page"]{background:#fff;color:#140C59;border-color:#fff}
  .shl-home:hover{background:rgba(255,255,255,.16);border-color:#64C2E6}
  .shl-home svg{width:16px;height:16px}
  @media (max-width:640px){.shl-home .t{display:none}.shl-home{padding:6px 8px}}
  .shl-mods{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:3px;min-width:0}
  .shl-mods::-webkit-scrollbar{display:none}
  .shl-mods a{flex:none;color:#C6CCEB;text-decoration:none;font-weight:600;font-size:13.5px;padding:6px 14px;border-radius:999px;white-space:nowrap}
  .shl-mods a:hover{color:#fff}
  .shl-mods a[aria-current="page"]{background:#fff;color:#140C59}
  /* Phones: Home and the department tabs sit in a grid of four, two lines, so none run off the screen. */
  .shl-mods .s{display:none}
  @media (max-width:640px){
    .shl-left{flex:1 1 100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
    .shl-left .shl-mods{display:contents}
    .shl-left .shl-home,.shl-mods a{justify-content:center;text-align:center;padding:7px 4px;font-size:12.5px;border-radius:999px;margin:0}
    .shl-mods a{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#C6CCEB}
    .shl-left .shl-home .t{display:inline}.shl-left .shl-home svg{width:14px;height:14px}
    .shl-mods .f{display:none}.shl-mods .s{display:inline}
  }
  .shl-user{position:relative;display:flex;align-items:center;gap:8px}
  .shl-inst{display:none!important;align-items:center;gap:6px;background:#64C2E6;color:#140C59;border:0;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
  .shl-inst svg{width:15px;height:15px}
  @media (max-width:640px){.shl-inst .t{display:none}.shl-inst{padding:6px 8px}}
  .shl-btn{display:inline-flex;align-items:center;gap:8px;background:none;border:1px solid rgba(255,255,255,.22);color:#fff;border-radius:999px;padding:4px 12px 4px 4px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
  .shl-av{width:26px;height:26px;border-radius:50%;background:#64C2E6;color:#140C59;display:grid;place-items:center;font-size:11.5px;font-weight:800}
  .shl-role{color:#A9B4E0;font-weight:500}
  .shl-menu{position:absolute;right:0;top:calc(100% + 8px);background:#fff;color:#140C59;border-radius:12px;box-shadow:0 12px 40px rgba(20,12,89,.28);min-width:220px;padding:6px;z-index:50}
  .shl-menu .who{padding:10px 12px;border-bottom:1px solid #EDF0EB;margin-bottom:4px;font-size:13px}
  .shl-menu .who b{display:block;font-size:14px}
  .shl-menu button,.shl-menu a{display:block;width:100%;text-align:left;background:none;border:0;padding:9px 12px;border-radius:8px;font:inherit;font-size:14px;color:#140C59;text-decoration:none;cursor:pointer}
  .shl-menu button:hover,.shl-menu a:hover{background:#F3F4F1}
  .shl-scrim{position:fixed;inset:0;background:rgba(20,12,89,.45);display:grid;place-items:center;z-index:60;padding:16px}
  .shl-card{background:#fff;color:#140C59;border-radius:14px;width:min(400px,100%);padding:22px;display:grid;gap:12px;font-size:14px}
  .shl-card h3{margin:0;font-size:18px}
  .shl-card label{display:grid;gap:4px;font-size:12.5px;font-weight:600;color:#5E6A72}
  .shl-card input{padding:10px 11px;border:1px solid #C3CAC4;border-radius:8px;font:inherit;font-size:15px;color:#140C59}
  .shl-card .row{display:flex;justify-content:flex-end;gap:8px}
  .shl-card .row button{padding:8px 14px;border-radius:8px;border:1px solid #D9DDD6;background:#fff;font:inherit;font-weight:600;cursor:pointer;color:#140C59}
  .shl-card .row button.go{background:#140C59;color:#fff;border-color:#140C59}
  .shl-card .err{color:#B42318;min-height:1em}
  @media (max-width:640px){.shl-role{display:none}.shl-btn{padding:3px}.shl-btn .nm{display:none}}
  `;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

  function mountStyle() {
    if (document.getElementById('shl-style')) return;
    const s = document.createElement('style'); s.id = 'shl-style'; s.textContent = css; document.head.appendChild(s);
  }

  function render(me, module, modsEl, userEl) {
    const mine = MODS.filter(([k]) => me.modules.includes(k));
    // A login with Dream Aspire as well (Admin and Management reach it from Home) gets a link to it.
    if (!me.hub && (me.aspire || []).length) mine.push(['aspire', 'Dream Aspire', '/aspire', 'Aspire']);
    // Home (the tiles page) is for Admin and Management only; everyone else sees just their sections.
    const onHome = false;
    const home = me.role !== 'consultant' ? `<a class="shl-home" href="/#/project/1" ${onHome ? 'aria-current="page"' : ''} title="Dream Signature: all departments" aria-label="Dream Signature"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/></svg><span class="t">Dream Signature</span></a>` : '';
    // Only the Home button: the departments are reached from the ERP's Home and its side menu, not a second bar here.
    const showTabs = false;
    if (modsEl) modsEl.innerHTML = `<div class="shl-left">${home}${showTabs && mine.length > 1 && !onHome
      ? `<nav class="shl-mods" aria-label="Departments">${mine.map(([k, l, href, short]) => `<a href="${href}" ${k === module ? 'aria-current="page"' : ''}>${short ? `<span class="f">${l}</span><span class="s">${short}</span>` : l}</a>`).join('')}</nav>` : ''}</div>`;
    if (!userEl) return;
    userEl.className = 'shl-user';
    userEl.innerHTML = `<button class="shl-inst" type="button" title="Install the portal as an app on this device" ${standalone() ? 'hidden' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span class="t">Install app</span></button><button class="shl-btn" id="shlBtn" aria-haspopup="true" aria-expanded="false"><span class="shl-av">${esc(initials(me.name))}</span><span class="nm">${esc(me.name)}</span> <span class="shl-role">${esc(me.roleLabel)}</span></button>
      <div class="shl-menu" id="shlMenu" hidden><div class="who"><b>${esc(me.name)}</b>${esc(me.roleLabel)} · ${esc(me.username)}</div>
      ${me.users ? '<a href="/#/users">Manage logins</a>' : ''}${me.legacy ? '' : '<button id="shlPw">Change password</button>'}<button id="shlOut">Sign out</button></div>`;
    userEl.querySelector('.shl-inst').onclick = install;
    const btn = userEl.querySelector('#shlBtn'), menu = userEl.querySelector('#shlMenu');
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
    document.addEventListener('click', (e) => { if (!userEl.contains(e.target)) menu.hidden = true; });
    userEl.querySelector('#shlOut').onclick = async () => { await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); location.href = '/'; };
    const pw = userEl.querySelector('#shlPw'); if (pw) pw.onclick = () => { menu.hidden = true; changePassword(); };
  }

  // forced: first sign-in with a temporary password; the dialog cannot be closed until it is changed.
  function changePassword(forced) {
    const w = document.createElement('div'); w.className = 'shl-scrim';
    w.innerHTML = `<form class="shl-card"><h3>${forced ? 'Set your own password' : 'Change password'}</h3>
      ${forced ? '<p style="margin:0">You signed in with a temporary password. Choose your own password to continue. Keep it private.</p>' : ''}
      <label>${forced ? 'Temporary password' : 'Current password'}<input type="password" id="shlCur" autocomplete="current-password" required></label>
      <label>New password (at least 10 characters)<input type="password" id="shlNew" autocomplete="new-password" required minlength="10"></label>
      <label>Type the new password again<input type="password" id="shlNew2" autocomplete="new-password" required minlength="10"></label>
      <div class="err" id="shlErr" role="alert"></div><div class="row">${forced ? '<button type="button" id="shlOut2">Sign out</button>' : '<button type="button" id="shlCancel">Cancel</button>'}<button class="go">${forced ? 'Save and continue' : 'Change password'}</button></div></form>`;
    document.body.appendChild(w);
    w.querySelector('#shlCur').focus();
    if (forced) w.querySelector('#shlOut2').onclick = async () => { await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); location.href = '/'; };
    else w.querySelector('#shlCancel').onclick = () => w.remove();
    w.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      if (w.querySelector('#shlNew').value !== w.querySelector('#shlNew2').value) { w.querySelector('#shlErr').textContent = 'The two new passwords are not the same.'; return; }
      const r = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'password', current: w.querySelector('#shlCur').value, next: w.querySelector('#shlNew').value }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && forced) { location.reload(); return; }
      if (r.ok) { w.querySelector('.shl-card').innerHTML = '<h3>Password changed</h3><p style="margin:0">You stay signed in here. Other devices will need the new password.</p><div class="row"><button class="go" type="button">Done</button></div>'; w.querySelector('.go').onclick = () => w.remove(); }
      else w.querySelector('#shlErr').textContent = j.error || 'Could not change the password.';
    };
  }

  // module: the section this page shows. Returns the user, or null after redirecting.
  async function init({ module, modsEl, userEl }) {
    mountStyle();
    let r;
    try { r = await fetch('/api/me', { credentials: 'same-origin' }); } catch { return null; }
    if (r.status === 401) { location.replace('/'); return null; }
    const me = await r.json();
    // The portal address itself (/) opens the Home page for Admin and Management; /sales is the CRM.
    
    if (module && !me.modules.includes(module)) {
      // A login with no section left (a role with no modules) would otherwise reload forever.
      if (!me.modules.length) document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">This login has no section in the portal. Ask the Admin for access.</p>';
      else location.replace(me.home || '/');
      return null;
    }
    render(me, module, modsEl, userEl);
    window.Shell.me = me;
    // Temporary password: nothing else loads until the person sets their own.
    if (me.mustChange) { changePassword(true); return null; }
    return me;
  }

  window.Shell = { init, me: null, esc };
})();
