// Dream India Realty · Partner Portal. Sign in, register (with mobile OTP), upload clients, see own clients (masked).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (v) => (Number(v) || 0).toLocaleString('en-IN');
  const dd = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const app = $('#app');
  const SV = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = {
    lock: `<svg ${SV}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
    shield: `<svg ${SV}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>`,
    upload: `<svg ${SV}><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>`,
    home: `<svg ${SV}><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>`,
    users: `<svg ${SV}><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5"/></svg>`,
    clock: `<svg ${SV}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    office: `<svg ${SV}><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/></svg>`,
    id: `<svg ${SV}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 13h3"/></svg>`,
    out: `<svg ${SV}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/></svg>`,
    menu: `<svg ${SV}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    file: `<svg ${SV}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>`,
  };
  const SECURE = `<div class="secure">${I.shield}<span>Your client data is private to your firm. Other partners can never see it, mobile numbers are shown masked, and Dream India uses it only to call your clients for the project you choose. A client you register stays credited to your CP ID.</span></div>`;

  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401 && path.indexOf('me=1') < 0 && !(body && /^(login|register|forgot)/.test(body.action))) { start(); throw new Error(j.error || 'Please sign in again.'); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  const busy = async (btn, fn) => { const t = btn.innerHTML; btn.disabled = true; btn.textContent = 'Please wait…'; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; } };
  const showErr = (el, e) => { el.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; };

  let ME = null, AREAS = [], view = 'home', H = null;

  async function start() {
    try {
      const r = await api('/api/cp-portal?me=1');
      if (!r.signedIn) { AREAS = r.areas || []; return signIn(); }
      ME = r.profile; portal();
    } catch (e) { app.innerHTML = `<div class="boot"><div class="err">${esc(e.message)}</div></div>`; }
  }

  // ---------- sign in / register ----------
  function authShell(inner) {
    app.innerHTML = `<div class="auth"><aside class="auth-side"><img src="/logo.svg" alt="Dream India Realty">
      <div><h1>The <span class="gold">Partner Portal</span> for Dream India projects</h1>
        <p>Register your firm once, get your Channel Partner ID, and upload your client lists for every project. Your clients stay yours.</p>
        <ul class="auth-points">
          <li><i>${I.id}</i><span>A unique CP ID, sent to your verified mobile, credited on every booking from your clients</span></li>
          <li><i>${I.lock}</i><span>Your data is private: no other partner can see your clients, and numbers are masked even in your own view</span></li>
          <li><i>${I.upload}</i><span>Upload Excel or CSV; see at once which clients are registered to you and which are not, with the reason</span></li>
        </ul></div>
      <div class="foot">© Dream India Realty · Jogeshwari, Mumbai</div></aside>
      <main class="auth-main"><div class="auth-card"><img class="logo-m" src="/logo-dark.svg" alt="Dream India Realty">${inner}</div></main></div>`;
  }
  function signIn(msg) {
    authShell(`<h1>Sign in</h1><p class="muted">Channel partners of Dream India Realty</p>
      <form id="f"><label>Username, CP ID or mobile</label><input name="u" autocomplete="username" required autofocus>
      <label>Password</label><input name="p" type="password" autocomplete="current-password" required>
      <div class="actions"><button class="block">Sign in</button></div>
      <p class="small" style="margin-top:12px"><button type="button" class="link" id="fg">Forgot password?</button></p><div id="m">${msg ? `<div class="ok">${esc(msg)}</div>` : ''}</div></form>
      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <p>New partner? <button type="button" class="link" id="rg">Register your firm</button></p>${SECURE}`);
    $('#f').onsubmit = (e) => { e.preventDefault(); const f = e.target; busy($('button', f), async () => {
      try { await api('/api/cp-portal', { action: 'login', username: f.u.value, password: f.p.value }); start(); } catch (x) { showErr($('#m'), x); } }); };
    $('#rg').onclick = () => register(1, {});
    $('#fg').onclick = forgot;
  }

  function register(step, R) {
    const steps = `<div class="steps">${[1, 2, 3, 4].map((i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>`;
    const v = (k) => esc(R[k] || '');
    const forms = {
      1: `<h2>Create your login</h2><p class="muted small">Step 1 of 4</p>
        <label>Username</label><input name="username" value="${v('username')}" required pattern="[A-Za-z0-9._]{4,30}" autocomplete="username"><div class="hint">4 to 30 letters, numbers, dots or underscores</div>
        <label>Password</label><input name="password" type="password" required minlength="8" autocomplete="new-password"><div class="hint">At least 8 characters with letters and numbers</div>
        <label>Confirm password</label><input name="password2" type="password" required autocomplete="new-password">`,
      2: `<h2>Your firm</h2><p class="muted small">Step 2 of 4</p>
        <label>Firm name</label><input name="firm" value="${v('firm')}" required>
        <label>MahaRERA agent registration no.</label><input name="rera" value="${v('rera')}" required placeholder="A51800012345">
        <label>Office address</label><textarea name="address" rows="2" required>${v('address')}</textarea>
        <div class="row"><div><label>Office area</label><select name="area" required><option value="">Choose…</option>${AREAS.map((a) => `<option ${R.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
        <div><label>Callers in your team</label><input name="callers" type="number" min="0" value="${v('callers')}"></div></div>`,
      3: `<h2>Point of contact</h2><p class="muted small">Step 3 of 4</p>
        <div class="row"><div><label>Name</label><input name="contact" value="${v('contact')}" required></div><div><label>Designation</label><input name="designation" value="${v('designation')}" placeholder="Proprietor, Partner…"></div></div>
        <label>Mobile number (WhatsApp)</label><input name="mobile" inputmode="tel" value="${v('mobile')}" required><div class="hint">We send a verification code to this number and to your email</div>
        <div class="row"><div><label>Other number</label><input name="alt" inputmode="tel" value="${v('alt')}"></div><div><label>Email</label><input name="email" type="email" value="${v('email')}" required></div></div>
        <label class="check" style="margin-top:16px"><input type="checkbox" name="agree" ${R.agree ? 'checked' : ''} required><span>I confirm the details are correct, my clients have agreed to be contacted about Dream India projects, and a client stays credited to my firm for the period Dream India sets.</span></label>`,
    };
    authShell(`${steps}<form id="f">${forms[step]}
      <div class="actions">${step > 1 ? '<button type="button" class="ghost" id="bk">Back</button>' : ''}<button>${step === 3 ? 'Send verification code' : 'Continue'}</button></div><div id="m"></div></form>
      <p class="small" style="margin-top:18px">Already registered? <button type="button" class="link" id="si">Sign in</button></p>`);
    const f = $('#f');
    const take = () => { for (const el of f.elements) if (el.name) R[el.name] = el.type === 'checkbox' ? el.checked : el.value; };
    if ($('#bk')) $('#bk').onclick = () => { take(); register(step - 1, R); };
    $('#si').onclick = () => signIn();
    f.onsubmit = (e) => {
      e.preventDefault(); take();
      if (step === 1) { if (R.password !== R.password2) return showErr($('#m'), 'The passwords do not match.'); if (!/[A-Za-z]/.test(R.password) || !/\d/.test(R.password)) return showErr($('#m'), 'Use letters and numbers in the password.'); return register(2, R); }
      if (step === 2) { R.rera = R.rera.toUpperCase().replace(/\s/g, ''); if (!/^A\d{11}$/.test(R.rera)) return showErr($('#m'), 'MahaRERA agent numbers look like A51800012345.'); return register(3, R); }
      busy($('button:not(.ghost)', f), async () => {
        try { const r = await api('/api/cp-portal', { action: 'register-start', ...R }); R.token = r.token; R.sentTo = r.sentTo; verify(R); } catch (x) { showErr($('#m'), x); }
      });
    };
  }
  function verify(R) {
    authShell(`<div class="steps">${[1, 2, 3, 4].map(() => '<span class="on"></span>').join('')}</div><h2>Verify your mobile</h2>
      <p class="muted">We sent a 6-digit code to ${esc(R.sentTo || 'your mobile')}. It expires in 10 minutes.</p>
      <form id="f"><input name="otp" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required autofocus>
      <div class="actions"><button class="block">Verify and register</button></div><div id="m"></div></form>
      <p class="small" style="margin-top:14px"><button type="button" class="link" id="rs">Send a new code</button> · <button type="button" class="link" id="ed">Change details</button></p>`);
    $('#ed').onclick = () => register(3, R);
    $('#rs').onclick = (e) => busy(e.target, async () => { try { const r = await api('/api/cp-portal', { action: 'register-start', ...R }); R.token = r.token; $('#m').innerHTML = '<div class="ok">A new code has been sent.</div>'; } catch (x) { showErr($('#m'), x); } });
    $('#f').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
      try { const r = await api('/api/cp-portal', { action: 'register-verify', token: R.token, otp: e.target.otp.value }); welcome(r); } catch (x) { showErr($('#m'), x); } }); };
  }
  function welcome(r) {
    authShell(`<h1>Welcome to Dream India</h1><p class="muted">Your firm is registered. Your Channel Partner ID is</p><div class="cpid">${esc(r.cpCode)}</div>
      <p>${r.sentTo ? `We have sent it to ${esc(r.sentTo)}. ` : ''}Please quote it on every client registration and booking.</p>
      ${r.approved ? '' : '<div class="banner warn">Your account is waiting for approval by the Dream India team. You can look around now and upload clients once it is approved.</div>'}
      <div class="actions"><button class="block" id="go">Open the portal</button></div>`);
    $('#go').onclick = start;
  }
  function forgot() {
    authShell(`<h1>Reset password</h1><p class="muted">Enter your username, CP ID or registered mobile. We will send a code to your registered mobile and email.</p>
      <form id="f"><label>Username, CP ID or mobile</label><input name="u" required autofocus><div class="actions"><button class="block">Send code</button></div><div id="m"></div></form>
      <p class="small" style="margin-top:14px"><button type="button" class="link" id="si">Back to sign in</button></p>`);
    $('#si').onclick = () => signIn();
    $('#f').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
      try {
        const r = await api('/api/cp-portal', { action: 'forgot-start', username: e.target.u.value });
        authShell(`<h1>Set a new password</h1><p class="muted">If the account exists, a code has been sent to ${esc(r.sentTo)}.</p>
          <form id="f2"><label>Code</label><input name="otp" class="otp" inputmode="numeric" maxlength="6" required>
          <label>New password</label><input name="p" type="password" minlength="8" required autocomplete="new-password"><div class="hint">At least 8 characters with letters and numbers</div>
          <div class="actions"><button class="block">Save and sign in</button></div><div id="m"></div></form>
          <p class="small" style="margin-top:14px"><button type="button" class="link" id="si">Back to sign in</button></p>`);
        $('#si').onclick = () => signIn();
        $('#f2').onsubmit = (ev) => { ev.preventDefault(); busy($('button', ev.target), async () => {
          try { await api('/api/cp-portal', { action: 'forgot-verify', token: r.token, otp: ev.target.otp.value, password: ev.target.p.value }); start(); } catch (x) { showErr($('#m'), x); } }); };
      } catch (x) { showErr($('#m'), x); }
    }); };
  }

  // ---------- portal ----------
  const NAV = [['home', 'Overview', 'home'], ['docs', 'Documents', 'file'], ['upload', 'Upload clients', 'upload'], ['clients', 'My clients', 'users'], ['history', 'Upload history', 'clock'], ['profile', 'Firm profile', 'office']];
  function portal() {
    const ini = (ME.firm || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    app.innerHTML = `<div class="shell"><aside class="side"><img src="/logo.svg" alt="Dream India Realty"><nav>${NAV.map(([k, l, ic]) => `<button data-v="${k}" aria-current="${k === view}">${I[ic]}${l}</button>`).join('')}
      <button id="so">${I.out}Sign out</button></nav><div class="sfoot">Partner Portal · Dream India Realty</div></aside>
      <div class="main"><header class="top"><div class="who"><button class="ghost menu-b" id="mb" aria-label="Menu">${I.menu}</button><div class="av">${esc(ini)}</div><div style="min-width:0"><b>${esc(ME.firm)}</b><span>${esc(ME.cpCode)} · ${esc(ME.contact)}</span></div></div>
      <span class="pill ${ME.approved ? 'good' : 'warn'}">${esc(ME.status)}</span></header><div class="wrap" id="v"></div></div></div>`;
    $$('[data-v]').forEach((b) => (b.onclick = () => { view = b.dataset.v; $('.shell').classList.remove('open'); $$('[data-v]').forEach((x) => x.setAttribute('aria-current', x === b)); show(); }));
    $('#mb').onclick = () => $('.shell').classList.toggle('open');
    $('#so').onclick = async () => { try { await api('/api/cp-portal', { action: 'logout' }); } catch {} ME = null; view = 'home'; signIn('You have signed out.'); };
    show();
  }
  async function show() {
    const v = $('#v'); v.innerHTML = '<p class="muted">Loading…</p>';
    try {
      H = await api('/api/cp-portal?home=1'); ME = H.profile;
      ({ home, docs, upload, clients, history, profile })[view](v);
      window.scrollTo(0, 0);
    } catch (e) { showErr(v, e); }
  }
  const go = (k) => { view = k; $$('[data-v]').forEach((x) => x.setAttribute('aria-current', x.dataset.v === k)); show(); };
  const pending = () => (ME.approved ? '' : H && H.docs && !H.docs.complete
    ? `<div class="banner warn">To be approved, please send your documents: <b>${esc(H.docs.missing.join(', '))}</b>. <button type="button" class="link" data-godocs>Add them now</button></div>`
    : '<div class="banner warn">Your documents are in. Your account is waiting for approval by the Dream India team; you can upload clients once it is approved.</div>');
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-godocs]')) { e.preventDefault(); go('docs'); } });

  // documents for approval: PAN, GST, MahaRERA certificate, partner agreement (accepted online or a signed copy)
  async function docs(v) {
    const D = await api('/api/cp-portal?docs=1'), by = Object.fromEntries(D.docs.map((d) => [d.kind, d]));
    const tick = (d) => (d.done ? `<span class="pill good">Received${d.at ? ' ' + dd(d.at) : ''}</span>` : '<span class="pill warn">Needed</span>');
    const up = (k, numLabel, val, ph) => `<form class="card" data-doc="${k}"><h2>${esc(by[k].label)} ${tick(by[k])}</h2>
      ${numLabel ? `<label>${numLabel}</label><input name="number" value="${esc(by[k].number || val || '')}" placeholder="${ph}" ${k === 'rera' ? 'readonly' : 'required'}>` : ''}
      ${by[k].file ? `<p class="hint">On file: ${esc(by[k].fileName || '')}. Upload again to replace it.</p>` : ''}
      <label>File (PDF or a clear photo, up to 3 MB)</label><input type="file" name="f" accept="application/pdf,image/png,image/jpeg" required>
      <div class="actions"><button>Send</button></div><div class="m"></div></form>`;
    const ag = by.agreement;
    v.innerHTML = `${ME.approved ? '' : `<div class="banner ${D.complete ? 'good' : 'warn'}">${D.complete ? 'All documents are in. The Dream India team will review and approve your account.' : 'Dream India approves a partner once these four are in.'}</div>`}
      ${up('pan', 'PAN of the firm', D.pan, 'ABCDE1234F')}${up('gst', 'GSTIN', D.gstin, '27ABCDE1234F1Z5')}${up('rera', 'MahaRERA agent registration no.', D.rera, '')}
      <div class="card"><h2>Partner agreement ${tick(ag)}</h2>${ag.done ? `<p>${ag.how === 'accepted online' ? `Accepted online by <b>${esc(ag.signedName)}</b> on ${dd(ag.at)}.` : esc(ag.how) + (ag.at ? ' on ' + dd(ag.at) : '') + '.'}</p>` : ''}
        <div style="white-space:pre-wrap;max-height:300px;overflow:auto;border:1px solid #EAECF0;border-radius:10px;padding:12px;font-size:13px;line-height:1.5;background:#FAFAFC">${esc(D.agreement)}</div>
        <p class="hint">Version ${esc(D.fingerprint)}</p>
        <form id="agOn"><h3>Sign online</h3><label>Full name of the person signing for ${esc(ME.firm)}</label><input name="name" required value="${esc(ME.contact || '')}">
          <label class="check"><input type="checkbox" name="agree" required> I have read this agreement and accept it on behalf of ${esc(ME.firm)} (${esc(ME.cpCode)}).</label>
          <div class="actions"><button>Accept and sign</button></div><div class="m"></div></form>
        <form data-doc="agreement" style="margin-top:14px"><h3>Or upload the signed copy</h3><p class="hint">Print, sign and stamp it, then upload a scan. You can also bring the signed copy to the Dream India office.</p>
          <input type="file" name="f" accept="application/pdf,image/png,image/jpeg" required><div class="actions"><button class="ghost">Upload signed copy</button></div><div class="m"></div></form></div>${SECURE}`;
    const b64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
    $$('[data-doc]', v).forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => {
      try { const file = f.f.files[0]; if (file.size > 3 * 1024 * 1024) throw new Error('The file must be under 3 MB.');
        await api('/api/cp-portal', { action: 'doc-upload', kind: f.dataset.doc, number: f.number ? f.number.value : null, file: { name: file.name, mime: file.type, data: await b64(file) } });
        H = await api('/api/cp-portal?home=1'); docs(v); } catch (x) { showErr($('.m', f), x); } }); }));
    $('#agOn', v).onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
      try { await api('/api/cp-portal', { action: 'agreement-sign', name: e.target.name.value, agree: e.target.agree.checked }); H = await api('/api/cp-portal?home=1'); docs(v); } catch (x) { showErr($('.m', e.target), x); } }); };
  }

  function home(v) {
    const s = H.stats, st = Object.entries(s.status || {});
    v.innerHTML = `${pending()}<div class="hero"><div><div class="eb">Partner Portal</div><h1>Welcome, ${esc((ME.contact || '').split(' ')[0])}</h1><p>${esc(ME.firm)} · ${esc(ME.area || '')}</p></div>
      <div class="idb"><span>Your Channel Partner ID</span><b>${esc(ME.cpCode)}</b></div></div>
      <div class="kpis"><div class="kpi"><b>${nf(s.leads)}</b><span>Clients registered with you</span></div><div class="kpi"><b>${nf(s.active)}</b><span>Still credited to you</span></div>
      <div class="kpi"><b>${nf(s.uploads)}</b><span>Uploads</span></div><div class="kpi"><b>${nf(s.bookings)}</b><span>Bookings under your CP ID</span></div></div>
      <div class="card"><h2>Projects open for upload</h2>${H.projects.length ? `<div class="launches">${H.projects.map((p) => `<div class="launch"><h3>${esc(p.name)}</h3><p>${esc([p.location, p.rera ? 'MahaRERA ' + p.rera : ''].filter(Boolean).join(' · '))}${p.until ? `<br>Uploads open until ${dd(p.until)}` : ''}</p>
        <button data-up="${p.id}" ${ME.approved ? '' : 'disabled'}>${I.upload}Upload clients</button></div>`).join('')}</div>` : '<div class="empty">No project is open for uploads right now. We will message you when a new project opens.</div>'}</div>
      ${st.length ? `<div class="card"><h2>Where your clients stand</h2><table>${st.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num"><b>${nf(n)}</b></td></tr>`).join('')}</table></div>` : ''}
      ${SECURE}`;
    $$('[data-up]').forEach((b) => (b.onclick = () => { U = { projectId: +b.dataset.up }; go('upload'); }));
  }

  // upload: choose launch → file → match columns → confirm → result
  let U = {};
  const COLS = [['mobile', 'Mobile number', true, /mob|phone|contact|number|cell|whats/i], ['name', 'Client name', false, /name/i], ['config', 'Configuration', false, /config|bhk|type|requirement/i],
    ['locality', 'Locality', false, /local|area|location|address/i], ['budget', 'Budget', false, /budget|price|range/i], ['purpose', 'Purpose', false, /purpose|use|invest/i]];
  function upload(v) {
    if (!ME.approved) { v.innerHTML = pending() + SECURE; return; }
    if (!H.projects.length) { v.innerHTML = '<div class="card"><h2>Upload clients</h2><div class="empty">No project is open for uploads right now.</div></div>' + SECURE; return; }
    if (!U.projectId || !H.projects.some((p) => p.id === U.projectId)) U = { projectId: H.projects[0].id };
    const stp = (n) => `<div class="stepper">${['Choose file', 'Match columns', 'Done'].map((l, i) => `<span class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}">${i + 1}. ${l}</span>`).join('')}</div>`;
    const p = H.projects.find((x) => x.id === U.projectId);
    if (U.result) {
      const r = U.result, bad = r.issues.filter((x) => x.count);
      v.innerHTML = `<div class="card">${stp(3)}<h2>Upload received for ${esc(p.name)}</h2>
        <div class="res"><div><b>${nf(r.received)}</b><span>Rows in your file</span></div><div class="g"><b>${nf(r.accepted)}</b><span>Registered to ${esc(ME.cpCode)}</span></div><div><b>${nf(r.received - r.accepted)}</b><span>Not registered</span></div></div>
        ${r.accepted ? `<p>These clients are credited to your firm until <b>${dd(r.ownerUntil)}</b>. A site visit extends it.</p>` : ''}
        ${bad.length ? `<h3>Why some rows were not registered</h3><table>${bad.map((x) => `<tr><td>${esc(x.reason)}</td><td class="num"><b>${nf(x.count)}</b></td></tr>`).join('')}</table>
        <div class="actions"><button class="ghost" id="dl">${I.file}Download the list of rows not registered</button></div>
        <p class="hint">For privacy, a client registered by another partner is not named; you only see that it is already taken.</p>` : ''}
        <div class="actions"><button id="again">${I.upload}Upload another file</button><button class="ghost" id="mc">See my clients</button></div></div>${SECURE}`;
      if ($('#dl')) $('#dl').onclick = () => download(`not-registered-${r.uploadId}.csv`, [['Row', 'Name', 'Mobile', 'Reason'], ...r.rows.map((x) => [x.row, x.name, x.mobile, x.reason])]);
      $('#again').onclick = () => { U = { projectId: U.projectId }; upload(v); };
      $('#mc').onclick = () => go('clients');
      return;
    }
    if (U.rows) {
      const h = U.rows[0], data = U.rows.slice(1);
      const g = (re) => h.findIndex((x) => re.test(String(x)));
      const opt = (sel) => '<option value="-1">— not in my file —</option>' + h.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x || 'Column ' + (i + 1))}</option>`).join('');
      v.innerHTML = `<div class="card">${stp(2)}<h2>Match your columns</h2><p class="muted">${esc(U.fileName)} · ${nf(data.length)} rows · for <b>${esc(p.name)}</b></p>
        <div class="map">${COLS.map(([k, l, req, re]) => `<div><label>${l}${req ? ' *' : ''}</label><select data-c="${k}">${opt(g(re))}</select></div>`).join('')}</div>
        <h3 style="margin-top:18px">First rows</h3><div class="tw"><table><tr>${h.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>${data.slice(0, 4).map((r) => `<tr>${h.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</table></div>
        <label class="check" style="margin-top:18px"><input type="checkbox" id="cs"><span>I confirm these clients have agreed to be contacted about Dream India projects.</span></label>
        <div class="actions"><button class="ghost" id="bk">Choose another file</button><button id="go">Upload ${nf(data.length)} clients</button></div><div id="m"></div></div>${SECURE}`;
      $('#bk').onclick = () => { U = { projectId: U.projectId }; upload(v); };
      $('#go').onclick = (e) => {
        const map = Object.fromEntries($$('[data-c]').map((s) => [s.dataset.c, +s.value]));
        if (map.mobile < 0) return showErr($('#m'), 'Choose the column with mobile numbers.');
        if (!$('#cs').checked) return showErr($('#m'), 'Please confirm your clients agreed to be contacted.');
        const rows = data.map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? r[i] || '' : ''])));
        busy(e.target, async () => { try { U.result = await api('/api/cp-portal', { action: 'upload', projectId: U.projectId, rows, fileName: U.fileName, consent: true }); upload(v); } catch (x) { showErr($('#m'), x); } });
      };
      return;
    }
    v.innerHTML = `<div class="card">${stp(1)}<h2>Upload clients</h2>
      <label>Project</label><select id="pj">${H.projects.map((x) => `<option value="${x.id}" ${x.id === U.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <label style="margin-top:16px">Your file</label><div class="drop" id="dz" tabindex="0" role="button">${I.upload}<b>Choose an Excel or CSV file</b><span class="muted small">or drop it here · up to ${nf(H.maxRows)} rows · one row per client</span></div>
      <input type="file" id="fi" accept=".xlsx,.csv,.txt" hidden>
      <p class="hint" style="margin-top:10px">Only the mobile number is needed. Name, configuration, locality, budget and purpose help our callers. <button type="button" class="link" id="tpl">Download a sample file</button></p><div id="m"></div></div>
      <div class="card"><h3>How it works</h3><ul class="muted" style="margin:0;padding-left:18px">
        <li>Every number is checked against all partners and Dream India's own records.</li>
        <li>If you are the first to register a client, the client is credited to your CP ID for the period Dream India sets; a site visit extends it.</li>
        <li>Numbers already with another partner, existing Dream India customers, or numbers that asked not to be called are not registered, and you see the reason for each.</li></ul></div>${SECURE}`;
    $('#pj').onchange = (e) => { U.projectId = +e.target.value; };
    $('#tpl').onclick = () => download('dream-india-client-upload.csv', [['Mobile', 'Name', 'Configuration', 'Locality', 'Budget', 'Purpose'], ['98XXXXXX10', 'Client name', '2 BHK', 'Andheri West', '1.5 Cr', 'Self use']]);
    const pick = async (f) => {
      if (!f) return;
      if (!/\.(xlsx|csv|txt)$/i.test(f.name)) return showErr($('#m'), 'Please choose an .xlsx or .csv file.');
      if (f.size > 3 * 1024 * 1024) return showErr($('#m'), 'The file is larger than 3 MB. Please split it.');
      $('#m').innerHTML = '<p class="muted">Reading your file…</p>';
      try {
        const b = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
        const { rows } = await api('/api/cp-portal', { action: 'parse', file: b, name: f.name });
        if (rows.length < 2) throw new Error('The file has no rows under the header row.');
        U.rows = rows; U.fileName = f.name; upload(v);
      } catch (x) { showErr($('#m'), x); }
    };
    const dz = $('#dz'), fi = $('#fi');
    dz.onclick = () => fi.click(); dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } };
    fi.onchange = () => pick(fi.files[0]);
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); pick(e.dataTransfer.files[0]); };
  }
  function download(name, rows) {
    const csv = rows.map((r) => r.map((c) => { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function clients(v) {
    v.innerHTML = `<div class="card"><h2>My clients</h2><div class="tools"><input id="q" placeholder="Search name or last 4 digits"><select id="pj"><option value="">All projects</option>${H.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div id="t"><p class="muted">Loading…</p></div></div>${SECURE}`;
    let timer;
    const load = async () => {
      try {
        const r = await api(`/api/cp-portal?leads=1&q=${encodeURIComponent($('#q').value)}&project=${$('#pj').value}`);
        const today = new Date().toISOString().slice(0, 10);
        $('#t').innerHTML = r.rows.length ? `<div class="tw"><table><thead><tr><th>Client</th><th>Mobile</th><th>Project</th><th>Registered</th><th>Credited until</th><th>Status</th></tr></thead><tbody>
          ${r.rows.map((x) => `<tr><td>${esc(x.name || '—')}<div class="hint">${esc([x.config, x.locality].filter(Boolean).join(' · '))}</div></td><td>${esc(x.mobile)}</td><td>${esc(x.project)}</td><td>${dd(x.uploadedOn)}</td>
            <td>${dd(x.ownerUntil)} ${x.ownerUntil && x.ownerUntil < today ? '<span class="pill">ended</span>' : ''}</td><td><span class="pill ${/Booked|visit/.test(x.status) ? 'good' : /discussion/.test(x.status) ? 'navy' : ''}">${esc(x.status)}</span></td></tr>`).join('')}</tbody></table></div>
          ${r.rows.length >= 2000 ? '<p class="hint">Showing the latest 2,000. Search to find others.</p>' : ''}` : '<div class="empty">No clients yet. Upload your client list for an open project.</div>';
      } catch (e) { showErr($('#t'), e); }
    };
    $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    $('#pj').onchange = load;
    load();
  }

  function history(v) {
    v.innerHTML = `<div class="card"><h2>Upload history</h2>${H.uploads.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>File</th><th>Project</th><th class="num">Rows</th><th class="num">Registered</th><th class="num">Not registered</th><th></th></tr></thead><tbody>
      ${H.uploads.map((u) => `<tr><td>${dd(u.at)}</td><td>${esc(u.file || '—')}</td><td>${esc(u.project)}</td><td class="num">${nf(u.received)}</td><td class="num"><b>${nf(u.accepted)}</b></td><td class="num">${nf(u.received - u.accepted)}</td>
        <td>${u.received > u.accepted ? `<button class="ghost" data-is="${u.id}" style="padding:6px 12px;font-size:13px">See reasons</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No uploads yet.</div>'}<div id="is"></div></div>${SECURE}`;
    $$('[data-is]').forEach((b) => (b.onclick = () => busy(b, async () => {
      try {
        const r = await api('/api/cp-portal?issues=' + b.dataset.is);
        $('#is').innerHTML = `<h3 style="margin-top:20px">Rows not registered</h3><div class="actions" style="margin:0 0 10px"><button class="ghost" id="dl">${I.file}Download</button></div><div class="tw"><table><tr><th>Row</th><th>Name</th><th>Mobile</th><th>Reason</th></tr>${r.rows.slice(0, 500).map((x) => `<tr><td>${x.row}</td><td>${esc(x.name)}</td><td>${esc(x.mobile)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</table></div>`;
        $('#dl').onclick = () => download(`not-registered-${b.dataset.is}.csv`, [['Row', 'Name', 'Mobile', 'Reason'], ...r.rows.map((x) => [x.row, x.name, x.mobile, x.reason])]);
      } catch (e) { showErr($('#is'), e); }
    })));
  }

  function profile(v) {
    const p = ME;
    v.innerHTML = `<div class="card"><h2>Firm profile</h2><dl class="prof">
      <dt>Channel Partner ID</dt><dd>${esc(p.cpCode)}</dd><dt>Firm</dt><dd>${esc(p.firm)}</dd><dt>MahaRERA no.</dt><dd>${esc(p.rera)}</dd><dt>Username</dt><dd>${esc(p.username)}</dd>
      <dt>Verified mobile</dt><dd>${esc(p.mobile)}</dd><dt>Email</dt><dd>${esc(p.email)}</dd><dt>Registered on</dt><dd>${dd(p.registeredOn)}</dd><dt>Status</dt><dd>${esc(p.status)}</dd></dl>
      <p class="hint" style="margin-top:12px">To change the firm name, RERA number, mobile or email, please contact the Dream India office.</p></div>
      <div class="card"><h2>Office and contact</h2><form id="pf">
        <label>Office address</label><textarea name="address" rows="2">${esc(p.address)}</textarea>
        <div class="row"><div><label>Office area</label><select name="area">${H.areas.map((a) => `<option ${p.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div><div><label>Callers in your team</label><input name="callers" type="number" min="0" value="${esc(p.callers)}"></div></div>
        <div class="row"><div><label>Point of contact</label><input name="contact" value="${esc(p.contact)}"></div><div><label>Designation</label><input name="designation" value="${esc(p.designation)}"></div></div>
        <label>Other number</label><input name="alt" value="${esc(p.alt)}">
        <div class="actions"><button>Save</button></div><div id="pm"></div></form></div>
      <div class="card"><h2>Change password</h2><form id="pw"><div class="row"><div><label>Current password</label><input name="current" type="password" required autocomplete="current-password"></div>
        <div><label>New password</label><input name="next" type="password" required minlength="8" autocomplete="new-password"></div></div>
        <div class="actions"><button>Change password</button></div><div id="wm"></div></form></div>${SECURE}`;
    $('#pf').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
      try { const r = await api('/api/cp-portal', { action: 'profile', ...Object.fromEntries(new FormData(e.target)) }); ME = r.profile; $('#pm').innerHTML = '<div class="ok">Saved.</div>'; } catch (x) { showErr($('#pm'), x); } }); };
    $('#pw').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
      try { await api('/api/cp-portal', { action: 'password', current: e.target.current.value, next: e.target.next.value }); e.target.reset(); $('#wm').innerHTML = '<div class="ok">Password changed.</div>'; } catch (x) { showErr($('#wm'), x); } }); };
  }

  start();
})();
