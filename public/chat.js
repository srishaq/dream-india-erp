// DreamComm: Dream India's own chat (the app at /chat, installable on phones and computers).
// Phone: one screen at a time. Computer: chat list on the left, the open chat on the right (like WhatsApp Web).
// Messages come in every few seconds while a chat is open; when the app is closed, the phone gets a notification.
(() => {
  'use strict';
  const APP = 'DreamComm';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IST = 'Asia/Kolkata';
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // ---------- icons ----------
  const I = {
    back: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
    dots: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
    search: '<svg class="icon" viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>',
    chat: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-3 11H7v-2h10v2zm0-3H7V8h10v2z"/></svg>',
    send: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
    mic: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>',
    clip: '<svg class="icon" viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/></svg>',
    cam: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.2 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.2L15 2H9z"/></svg>',
    x: '<svg class="icon" viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
    down: '<svg class="icon" viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    one: '<svg class="tk" viewBox="0 0 16 11"><path d="M11.1.6 4.9 7.9 2 5 .9 6.1l4 4L12.3 1.6z"/></svg>',
    two: '<svg class="tk" viewBox="0 0 16 11"><path d="M11.1.6 4.9 7.9 2 5 .9 6.1l4 4L12.3 1.6zM15.1.6 8.9 7.9l-.6-.6-1.1 1.2 1.8 1.6L16.3 1.6z"/></svg>',
    clock: '<svg class="tk" viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 1.4a5.1 5.1 0 1 1 0 10.2A5.1 5.1 0 0 1 8 2.9zM7.3 4.5v4l3.2 1.9.7-1.1-2.6-1.6V4.5z"/></svg>',
  };
  const COLORS = ['#2563EB', '#0E7490', '#7C3AED', '#B45309', '#BE185D', '#15803D', '#9333EA', '#C2410C', '#0369A1', '#4D7C0F'];
  const color = (id) => COLORS[Math.abs(+id || 0) % COLORS.length];
  const initials = (n) => String(n || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const ROOM_ICON = { announce: '📣', channel: '👥', group: '👥' };
  function avatar(name, id, cls = '', room = null, online = false) {
    const g = room && room.kind !== 'dm';
    return `<span class="av ${cls}" style="background:${g ? (room.kind === 'announce' ? '#B45309' : '#1E3A8A') : color(id)}">${g ? ROOM_ICON[room.kind] : esc(initials(name))}${online ? '<i class="dot"></i>' : ''}</span>`;
  }

  // ---------- time ----------
  const dkey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: IST });
  const hm = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
  function dayLabel(t) {
    const k = dkey(t), today = dkey(Date.now()), yest = dkey(Date.now() - 864e5);
    if (k === today) return 'Today';
    if (k === yest) return 'Yesterday';
    return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone: IST });
  }
  function listTime(t) {
    if (!t) return '';
    const k = dkey(t);
    if (k === dkey(Date.now())) return hm(t);
    if (k === dkey(Date.now() - 864e5)) return 'Yesterday';
    if (Date.now() - Date.parse(t) < 6 * 864e5) return new Date(t).toLocaleDateString('en-IN', { weekday: 'long', timeZone: IST });
    return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: IST });
  }
  const online = (seen) => seen && Date.now() - Date.parse(seen) < 2.5 * 60e3;
  function lastSeen(p) {
    if (!p) return '';
    if (p.off) return 'Has left Dream India';
    if (p.status) return p.status;
    if (online(p.seen)) return 'online';
    if (!p.seen) return '';
    return `last seen ${dkey(p.seen) === dkey(Date.now()) ? 'today' : dayLabel(p.seen).toLowerCase()} at ${hm(p.seen)}`;
  }
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const secs = (s) => { s = Math.round(+s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- server ----------
  async function api(path, body) {
    const r = await fetch('/api/chat' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401) { showLogin(); throw Object.assign(new Error('Please sign in.'), { quiet: true }); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Check the internet and try again.');
    return j;
  }
  function toast(t, ms = 2600) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
    document.body.appendChild(el); setTimeout(() => el.remove(), ms);
  }
  const fail = (e) => { if (!e.quiet) toast(e.message, 3500); };

  // ---------- state ----------
  const S = { me: null, ai: false, vapid: null, rooms: [], stamp: '', filter: 'all', q: '', room: null, msgs: [], byId: new Map(), more: false, marks: { read: 0, delivered: 0 }, lastRead: 0, pins: [],
    since: null, members: [], reply: null, edit: null, mentions: new Map(), private: null, pending: [], people: null };
  const app = $('#app');
  const mobile = () => !window.matchMedia('(min-width: 820px)').matches;

  // ---------- sign in ----------
  function showLogin(err) {
    stopPolling();
    app.className = '';
    app.innerHTML = `<div class="login">
      <img src="/dreamcomm-512.png?v=1" alt="">
      <h1><span style="color:#1E3A8A">Dream</span><span style="color:#2563EB">Comm</span></h1><p>Dream India's own chat</p>
      <form id="lf">
        <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="err" ${err ? '' : 'hidden'} id="le">${esc(err || '')}</div>
        <button class="btn">Sign in</button>
      </form>
      <p class="muted small" style="margin-top:14px">Use your ERP username and password. You stay signed in on this phone for 30 days.</p>
      ${installHint()}
    </div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), b = e.target.querySelector('button');
      b.disabled = true; b.textContent = 'Signing in…';
      try { await api('', { action: 'login', username: f.get('username'), password: f.get('password') }); await boot(); }
      catch (x) { const el = $('#le'); if (el) { el.hidden = false; el.textContent = x.message; } b.disabled = false; b.textContent = 'Sign in'; }
    };
  }
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; renderList(); });
  function installHint() {
    if (standalone()) return '';
    if (ios()) return `<div class="install"><b>Put ${APP} on your iPhone:</b> tap the Share button <b>⎋</b> at the bottom of Safari, then <b>Add to Home Screen</b>. Open it from there, so notifications work.</div>`;
    return `<div class="install"><b>Install ${APP}:</b> in Chrome, tap the menu <b>⋮</b> and choose <b>Install app</b> (or <b>Add to Home screen</b>).</div>`;
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const r = await api('?me=1');
      S.me = r.me; S.ai = r.ai; S.vapid = r.vapid;
    } catch (e) { if (!e.quiet) app.innerHTML = `<div class="empty-room">${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
    app.innerHTML = `<section class="pane-list" id="pl"></section><section class="pane-room" id="pr"></section>`;
    const pl = $('#pl');
    const roomOf = (e) => { const b = e.target.closest('[data-room]'); return b ? S.rooms.find((r) => r.id === +b.dataset.room) : null; };
    pl.addEventListener('click', (e) => { const r = roomOf(e); if (r && !pl._pressed) go('#r' + r.id); pl._pressed = false; });
    pl.addEventListener('contextmenu', (e) => { const r = roomOf(e); if (r) { e.preventDefault(); roomMenu(r); } });
    let lp = null;
    pl.addEventListener('touchstart', (e) => { const r = roomOf(e); if (!r) return; lp = setTimeout(() => { lp = null; pl._pressed = true; roomMenu(r); }, 520); }, { passive: true });
    ['touchend', 'touchmove'].forEach((ev) => pl.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    layout();
    renderList();
    await loadRooms();
    route();
    startPolling();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => pushState()).catch(() => {});
  }
  function layout() { app.classList.toggle('mobile', mobile()); app.classList.toggle('in-room', !!S.room); }
  window.addEventListener('resize', layout);

  // routes: #r12 a chat · (nothing) the list
  function route() {
    const m = /^#r(\d+)/.exec(location.hash);
    if (m) openRoom(+m[1]);
    else { S.room = null; layout(); renderEmpty(); renderList(); }
  }
  window.addEventListener('hashchange', route);
  const go = (h) => { if (location.hash !== h) location.hash = h; else route(); };
  const back = () => { if (history.length > 1 && mobile()) history.back(); else go(''); };

  // ---------- chat list ----------
  async function loadRooms() {
    const r = await api('?rooms=1');
    S.rooms = r.rooms; S.stamp = r.stamp;
    renderList();
    document.title = (unreadTotal() ? `(${unreadTotal()}) ` : '') + APP;
    try { if (navigator.setAppBadge) unreadTotal() ? navigator.setAppBadge(unreadTotal()) : navigator.clearAppBadge(); } catch {}
  }
  const unreadTotal = () => S.rooms.filter((r) => !r.muted).reduce((a, r) => a + (r.unread || 0), 0);
  function renderList() {
    const el = $('#pl'); if (!el || !S.me) return;
    const scroll = $('.list', el)?.scrollTop || 0;
    const q = S.q.toLowerCase();
    let rooms = S.rooms.filter((r) => (S.filter === 'unread' ? r.unread : S.filter === 'groups' ? r.kind !== 'dm' : S.filter === 'hidden' ? r.hidden : !r.hidden));
    if (q) rooms = S.rooms.filter((r) => r.name.toLowerCase().includes(q));
    const showPush = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied' && store.get('dc_push_later') !== '1';
    const hiddenN = S.rooms.filter((r) => r.hidden).length;
    const html = `
      <div class="bar"><h1>${APP}</h1>
        <button class="ib" id="lSearch" title="Search messages">${I.search}</button>
        <button class="ib" id="lMenu" title="Menu">${I.dots}</button></div>
      <div class="search"><input id="lq" placeholder="Search chats" value="${esc(S.q)}" autocomplete="off"></div>
      <div class="chips">${[['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups']].concat(hiddenN ? [['hidden', `Hidden (${hiddenN})`]] : []).map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      ${showPush ? `<div class="notice">🔔 Get a notification when a message comes.<button id="pushOn">Turn on</button><button class="x" id="pushLater" aria-label="Later">${I.x}</button></div>` : ''}
      ${installEvent && !standalone() ? `<div class="notice">📲 Install ${APP} on this ${mobile() ? 'phone' : 'computer'}.<button id="instOn">Install</button></div>` : ''}
      ${!standalone() && ios() && !store.get('dc_ios_hint') ? `<div class="notice small">📲 Tap Share ⎋ then “Add to Home Screen” to install ${APP} and get notifications.<button class="x" id="iosX">${I.x}</button></div>` : ''}
      <div class="list">
        ${rooms.map((r) => rowHtml(r)).join('') || `<div class="empty-room">${S.filter === 'unread' ? 'No unread messages.' : q ? 'No chat by that name.' : 'No chats yet. Tap the button below to start one.'}</div>`}
        ${S.me.desk && !q && S.filter === 'all' ? `<a class="row" href="/#/team" target="_blank" rel="noopener"><span class="av" style="background:#0E7490">🏠</span><span class="mid"><span class="top"><b>CRM ↔ Accounts desk</b></span><span class="sub"><span>Messages about a flat or a cheque (opens the ERP)</span></span></span></a>` : ''}
        <div style="height:90px"></div>
      </div>
      <button class="fab" id="newChat" title="New chat">${I.chat}</button>`;
    // nothing changed: leave the list as it is (a tap in progress is never lost)
    if (html === el._html) return;
    const typing = document.activeElement && document.activeElement.id === 'lq';
    el._html = html; el.innerHTML = html;
    $('.list', el).scrollTop = scroll;
    if (typing) { const i = $('#lq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    $('#lq', el).oninput = (e) => { S.q = e.target.value; renderList(); };
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; renderList(); }));
    $('#newChat', el).onclick = newChat;
    $('#lMenu', el).onclick = mainMenu;
    $('#lSearch', el).onclick = searchAll;
    if ($('#pushOn', el)) $('#pushOn', el).onclick = pushOn;
    if ($('#pushLater', el)) $('#pushLater', el).onclick = () => { store.set('dc_push_later', '1'); renderList(); };
    if ($('#instOn', el)) $('#instOn', el).onclick = async () => { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; renderList(); };
    if ($('#iosX', el)) $('#iosX', el).onclick = () => { store.set('dc_ios_hint', '1'); renderList(); };
  }
  function rowHtml(r) {
    const on = S.room && S.room.id === r.id;
    const last = r.last ? `${r.last.mine ? (r.last.id <= (r.kind === 'dm' ? 0 : 0) ? '' : '') + 'You: ' : r.kind !== 'dm' && r.last.name ? esc(r.last.name.split(' ')[0]) + ': ' : ''}${esc(r.last.text)}` : `<i>${esc(r.about || '')}</i>`;
    return `<button class="row ${on ? 'on' : ''}" data-room="${r.id}">
      ${avatar(r.name, r.other ? r.other.id : r.id, '', r, r.other && online(r.other.seen))}
      <span class="mid"><span class="top"><b>${esc(r.name)}</b><time class="${r.unread && !r.muted ? 'new' : ''}">${listTime(r.last ? r.at : null)}</time></span>
        <span class="sub"><span>${last}</span><span class="flags">${r.muted ? '🔕' : ''}${r.pinned ? '📌' : ''}${r.mentioned ? '<span class="badge at">@</span>' : ''}${r.unread ? `<span class="badge ${r.muted ? 'mute' : ''}">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</span></span></span></button>`;
  }
  function renderEmpty() {
    const el = $('#pr'); if (!el) return;
    el.innerHTML = `<div class="empty-room"><img src="/dreamcomm-512.png?v=1" alt=""><h2 style="color:var(--brand);margin:12px 0 4px">${APP}</h2><p>Choose a chat on the left, or start a new one.</p><p class="small">Messages stay inside Dream India.</p></div>`;
  }

  // ---------- menus ----------
  function sheet(html, onMount) {
    const s = document.createElement('div'); s.className = 'scrim';
    s.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
    s.onclick = (e) => { if (e.target === s) s.remove(); };
    document.body.appendChild(s);
    const close = () => s.remove();
    if (onMount) onMount($('.sheet', s), close);
    return close;
  }
  const actions = (list) => list.filter(Boolean).map(([ico, label, key, cls]) => `<button class="act ${cls || ''}" data-a="${key}"><span class="ico">${ico}</span>${label}</button>`).join('');
  const bindActions = (el, close, fns) => el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => { close(); try { await fns[b.dataset.a](); } catch (e) { fail(e); } }));

  function mainMenu() {
    sheet(`<h2>${esc(S.me.name)}${S.me.status ? `<div class="small muted">${esc(S.me.status)}</div>` : ''}</h2>${actions([
      ['🙂', 'Set my status', 'status'],
      ['👥', 'New group', 'group'],
      ['⭐', 'Saved messages', 'saved'],
      ['🔔', 'Notifications', 'push'],
      S.me.admin && ['🛡️', 'Review chats (Admin)', 'review'],
      ['📱', `Install ${APP}`, 'install'],
      ['🚪', 'Sign out', 'out', 'danger'],
    ])}`, (el, close) => bindActions(el, close, {
      status: statusSheet, group: () => newGroup(), saved: savedSheet, push: pushSheet, review: reviewSheet,
      install: () => sheet(`<h2>Install ${APP}</h2><div class="body">${installHint() || '<p>It is installed on this device.</p>'}<p class="small muted">Send this link to staff: <b>${esc(location.origin)}/chat</b>. They sign in with their ERP username and password.</p></div>`),
      out: async () => { let ep = null; try { const reg = await navigator.serviceWorker?.getRegistration(); const s = await reg?.pushManager.getSubscription(); ep = s?.endpoint; await s?.unsubscribe(); } catch {} await api('', { action: 'logout', endpoint: ep }).catch(() => {}); location.hash = ''; showLogin(); },
    }));
  }
  function roomMenu(r) {
    if (!r) return;
    sheet(`<h2>${esc(r.name)}</h2>${actions([
      [r.pinned ? '📍' : '📌', r.pinned ? 'Unpin chat' : 'Pin chat to the top', 'pin'],
      [r.muted ? '🔔' : '🔕', r.muted ? 'Unmute' : 'Mute notifications', 'mute'],
      r.unread ? ['✔️', 'Mark as read', 'read'] : null,
      [r.hidden ? '👁️' : '🙈', r.hidden ? 'Show in the list again' : 'Hide chat (comes back when a new message arrives)', 'hide'],
    ])}`, (el, close) => bindActions(el, close, {
      pin: async () => { await api('', { action: 'pref', room: r.id, pinned: !r.pinned }); loadRooms(); },
      mute: () => (r.muted ? api('', { action: 'pref', room: r.id, mute: 0 }).then(loadRooms) : muteSheet(r)),
      read: async () => { await api('', { action: 'read', room: r.id, upto: r.last ? r.last.id : 0 }); loadRooms(); },
      hide: async () => { await api('', { action: 'pref', room: r.id, hidden: !r.hidden }); loadRooms(); },
    }));
  }
  function muteSheet(r) {
    sheet(`<h2>Mute "${esc(r.name)}"</h2><div class="body"><p class="small muted">You will still see the messages, without a notification. If someone mentions you by name, you are still told.</p></div>${actions([['⏱️', '8 hours', '8'], ['📅', '1 week', '168'], ['♾️', 'Always', '-1']])}`,
      (el, close) => bindActions(el, close, Object.fromEntries(['8', '168', '-1'].map((h) => [h, async () => { await api('', { action: 'pref', room: r.id, mute: +h }); loadRooms(); }]))));
  }
  function statusSheet() {
    const presets = ['✅ Available', '🏗️ On site', '🤝 In a meeting', '🚗 Travelling', '🏖️ On leave'];
    const dnd = S.me.dnd || null;
    sheet(`<h2>My status</h2><div class="body">
      ${presets.map((p) => `<button class="chip ${S.me.status === p ? 'on' : ''}" data-p="${esc(p)}" style="margin:3px">${esc(p)}</button>`).join('')}
      <label class="field"><span>Or write your own</span><input id="stT" maxlength="60" value="${esc(S.me.status && !presets.includes(S.me.status) ? S.me.status : '')}" placeholder="e.g. At the bank till 3 pm"></label>
      <label class="field"><span>Clear it after</span><select id="stH"><option value="0">Don't clear</option><option value="1">1 hour</option><option value="4">4 hours</option><option value="10" selected>Today</option><option value="168">This week</option></select></label>
      <label class="field"><span>Do not disturb (no notifications)</span><select id="stD"><option value="">Off</option>${['20:00', '21:00', '22:00', '23:00'].map((f) => `<option value="${f}" ${dnd && dnd.from === f ? 'selected' : ''}>From ${f} to 08:00</option>`).join('')}</select></label>
    </div><div class="foot"><button class="btn ghost" data-x="clear">Clear status</button><button class="btn" data-x="save">Save</button></div>`, (el, close) => {
      let pick = S.me.status;
      el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { pick = b.dataset.p; $('#stT', el).value = ''; el.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); }));
      $('[data-x=clear]', el).onclick = async () => { await api('', { action: 'status', text: '' }); S.me.status = null; close(); toast('Status cleared'); };
      $('[data-x=save]', el).onclick = async () => {
        const text = $('#stT', el).value.trim() || pick || '', from = $('#stD', el).value;
        try { await api('', { action: 'status', text, hours: +$('#stH', el).value, dnd: from ? { from, to: '08:00' } : null }); S.me.status = text || null; S.me.dnd = from ? { from, to: '08:00' } : null; close(); toast('Saved'); } catch (e) { fail(e); }
      };
    });
  }

  // ---------- notifications on this phone ----------
  async function pushState() {
    try {
      if (!('PushManager' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.vapid) });
      await api('', { action: 'push', sub: sub.toJSON(), device: deviceName() });
    } catch {}
  }
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const deviceName = () => (ios() ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android phone' : 'Computer') + (standalone() ? ' (app)' : ' (browser)');
  async function pushOn() {
    if (ios() && !standalone()) return sheet(`<h2>Notifications on iPhone</h2><div class="body"><p>iPhones send notifications only to installed apps. Tap Share ⎋ in Safari, then <b>Add to Home Screen</b>, open ${APP} from your home screen and turn notifications on there.</p></div>`);
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Notifications were not allowed. You can allow them in the phone settings.'); renderList(); return; }
      await pushState(); toast('Notifications are on'); renderList();
    } catch (e) { fail(e); }
  }
  function pushSheet() {
    const st = !('Notification' in window) ? 'This browser cannot show notifications.' : Notification.permission === 'granted' ? 'On for this device.' : Notification.permission === 'denied' ? 'Blocked. Allow notifications for this site in the phone or browser settings.' : 'Off.';
    sheet(`<h2>Notifications</h2><div class="body"><p>${st}</p><p class="small muted">Muted chats and your Do not disturb hours are respected. Someone mentioning you by name still reaches you in a muted chat.</p></div>${actions([
      Notification.permission !== 'granted' && ['🔔', 'Turn on for this device', 'on'],
      Notification.permission === 'granted' && ['🧪', 'Send me a test notification', 'test'],
    ])}`, (el, close) => bindActions(el, close, { on: pushOn, test: async () => { await pushState(); const r = await api('', { action: 'testpush' }); toast(r.sent ? 'Sent. It should appear in a few seconds.' : 'This device is not registered yet. Turn notifications on first.'); } }));
  }

  // ---------- new chat / group ----------
  async function loadPeople() { if (!S.people) S.people = (await api('?people=1')).people; return S.people; }
  const DEPT = { management: 'Management', sales: 'Sales', crm: 'CRM', accounts: 'Accounts', site: 'Site', purchase: 'Purchase' };
  async function newChat() {
    const people = await loadPeople().catch(fail); if (!people) return;
    sheet(`<h2>New chat</h2><div class="search" style="padding:0 18px 8px"><input id="pq" placeholder="Search name" autocomplete="off"></div>
      <button class="pick" data-g="1"><span class="av sm" style="background:#1E3A8A">👥</span><span class="mid"><b>New group</b></span></button>
      <div id="pp"></div>`, (el, close) => {
      const draw = (q = '') => {
        const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
        const groups = {}; for (const p of list) (groups[DEPT[p.dept] || 'Others'] = groups[DEPT[p.dept] || 'Others'] || []).push(p);
        $('#pp', el).innerHTML = Object.entries(groups).map(([g, ps]) => `<div class="sect">${esc(g)}</div>${ps.map((p) => `<button class="pick" data-u="${p.id}">${avatar(p.name, p.id, 'sm', null, online(p.seen))}<span class="mid"><b>${esc(p.name)}</b><span>${esc(p.status || p.designation || p.role)}</span></span></button>`).join('')}`).join('') || '<p class="muted" style="padding:0 18px">Nobody by that name.</p>';
        el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = async () => { close(); try { const r = await api('', { action: 'dm', user: +b.dataset.u }); await loadRooms(); go('#r' + r.room); } catch (e) { fail(e); } }));
      };
      draw(); $('#pq', el).oninput = (e) => draw(e.target.value);
      $('[data-g]', el).onclick = () => { close(); newGroup(); };
    });
  }
  async function newGroup(addTo = null) {
    const people = await loadPeople().catch(fail); if (!people) return;
    const chosen = new Set();
    const skip = new Set(addTo ? S.members.map((m) => m.id) : []);
    sheet(`<h2>${addTo ? 'Add people' : 'New group'}</h2><div class="body">${addTo ? '' : '<label class="field"><span>Group name</span><input id="gn" maxlength="60" placeholder="e.g. Dream Signature B Wing"></label>'}
      <input id="gq" placeholder="Search name" style="width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"></div>
      <div id="gp"></div><div class="foot"><button class="btn" id="gGo">${addTo ? 'Add' : 'Make group'}</button></div>`, (el, close) => {
      const draw = (q = '') => {
        $('#gp', el).innerHTML = people.filter((p) => !skip.has(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).map((p) => `<button class="pick ${chosen.has(p.id) ? 'on' : ''}" data-u="${p.id}">${avatar(p.name, p.id, 'sm')}<span class="mid"><b>${esc(p.name)}</b><span>${esc(DEPT[p.dept] || p.role)}</span></span><span class="tickbox">✓</span></button>`).join('');
        el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => { const id = +b.dataset.u; chosen.has(id) ? chosen.delete(id) : chosen.add(id); b.classList.toggle('on'); }));
      };
      draw(); $('#gq', el).oninput = (e) => draw(e.target.value);
      $('#gGo', el).onclick = async () => {
        try {
          if (addTo) { for (const id of chosen) await api('', { action: 'add', room: addTo, user: id }); close(); toast('Added'); infoSheet(); return; }
          const r = await api('', { action: 'group', name: $('#gn', el).value, members: [...chosen] }); close(); await loadRooms(); go('#r' + r.room);
        } catch (e) { fail(e); }
      };
    });
  }

  // ---------- a chat ----------
  let openSeq = 0;
  async function openRoom(id) {
    const seq = ++openSeq;
    const same = S.room && S.room.id === id;
    if (!same) { S.reply = null; S.edit = null; S.private = null; S.mentions = new Map(); S.members = []; }
    S.room = S.rooms.find((r) => r.id === id) || { id, name: '…', kind: 'dm' };
    layout(); renderList();
    if (!same) renderRoomShell();
    try {
      const r = await api(`?room=${id}`);
      if (seq !== openSeq) return;
      S.room = r.room || S.room; S.msgs = r.msgs; S.byId = new Map(r.msgs.map((m) => [m.id, m])); S.more = r.more; S.marks = r.marks; S.lastRead = r.lastRead; S.pins = r.pins; S.since = r.now;
      renderRoomShell(); renderMsgs(true); markRead();
      api(`?info=${id}`).then((x) => { if (S.room && S.room.id === id) { S.members = x.members; S.info = x; renderHead(); } }).catch(() => {});
    } catch (e) { fail(e); if (!e.quiet) go(''); }
  }
  function headSub() {
    const r = S.room;
    if (r.kind === 'dm') return lastSeen(r.other);
    if (r.kind === 'announce') return 'Only Management posts here';
    const names = S.members.slice(0, 8).map((m) => (m.id === S.me.id ? 'You' : m.name.split(' ')[0]));
    return names.length ? names.join(', ') + (S.members.length > 8 ? '…' : '') : `${r.members || ''} members`;
  }
  function renderHead() {
    const h = $('#rh'); if (!h || !S.room) return;
    const r = S.room;
    h.innerHTML = `${mobile() ? `<button class="ib" id="rBack" aria-label="Back">${I.back}</button>` : ''}
      <button class="who" id="rWho">${avatar(r.name, r.other ? r.other.id : r.id, 'sm', r)}<span class="wt"><b>${esc(r.name)}</b><span>${esc(headSub())}</span></span></button>
      ${S.ai ? '<button class="ib" id="rCatch" title="Catch me up">✨</button>' : ''}
      <button class="ib" id="rMenu" aria-label="Menu">${I.dots}</button>`;
    if ($('#rBack')) $('#rBack').onclick = back;
    $('#rWho').onclick = infoSheet;
    $('#rMenu').onclick = roomActions;
    if ($('#rCatch')) $('#rCatch').onclick = catchUp;
  }
  function renderRoomShell() {
    const el = $('#pr'); if (!el) return;
    const r = S.room;
    el.innerHTML = `<div class="bar" id="rh"></div>
      <button class="pins" id="rPins" hidden></button>
      <div class="msgs" id="ml"><div class="empty-room">Loading…</div></div>
      <button class="jump" id="jump" hidden>${I.down}<span class="badge" id="jumpN" hidden></span></button>
      <div id="rFoot"></div>`;
    renderHead(); renderPins(); renderComposer();
    const ml = $('#ml');
    ml.addEventListener('scroll', () => {
      const atBottom = ml.scrollHeight - ml.scrollTop - ml.clientHeight < 120;
      $('#jump').hidden = atBottom;
      if (atBottom) markRead();
      if (ml.scrollTop < 60 && S.more && !S.loadingOlder) loadOlder();
    }, { passive: true });
    $('#jump').onclick = () => { ml.scrollTop = ml.scrollHeight; };
  }
  function renderPins() {
    const p = $('#rPins'); if (!p) return;
    p.hidden = !S.pins.length;
    if (!S.pins.length) return;
    const top = S.pins[0];
    p.innerHTML = `📌 <span><b>${esc(top.name)}:</b> ${esc(top.text)}</span>${S.pins.length > 1 ? `<span class="muted small" style="margin-left:auto;flex:none">+${S.pins.length - 1}</span>` : ''}`;
    p.onclick = () => (S.pins.length > 1 ? sheet(`<h2>Pinned</h2>${S.pins.map((x) => `<button class="pick" data-id="${x.id}"><span class="mid"><b>${esc(x.name)}</b><span>${esc(x.text)}</span></span></button>`).join('')}`, (el, close) => el.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { close(); jumpTo(+b.dataset.id); }))) : jumpTo(top.id));
  }
  async function loadOlder() {
    S.loadingOlder = true;
    const ml = $('#ml'), h = ml.scrollHeight;
    try {
      const r = await api(`?room=${S.room.id}&before=${S.msgs[0].id}`);
      S.msgs = r.msgs.concat(S.msgs); r.msgs.forEach((m) => S.byId.set(m.id, m)); S.more = r.more;
      renderMsgs(false); ml.scrollTop = ml.scrollHeight - h;
    } catch (e) { fail(e); }
    S.loadingOlder = false;
  }
  async function jumpTo(id) {
    let tries = 0;
    while (!S.byId.has(id) && S.more && tries++ < 20) await loadOlder();
    const el = document.getElementById('m' + id);
    if (!el) return toast('That message is too far back.');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // ---------- messages ----------
  const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g;
  function richText(t, mentions) {
    let h = esc(t).replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    const names = (mentions || []).map((id) => (S.members.find((m) => m.id === id) || {}).name).filter(Boolean);
    for (const n of names.concat('all')) h = h.split('@' + esc(n)).join(`<span class="at">@${esc(n)}</span>`);
    h = h.replace(/\*([^*\n]{1,200})\*/g, '<b>$1</b>');
    return h;
  }
  function ticks(m) {
    if (m.user !== S.me.id || m.deleted || S.room.kind === 'announce' && false) return '';
    if (m.pending) return I.clock;
    if (S.marks.n && S.marks.read >= m.id) return I.two.replace('class="tk"', 'class="tk read"');
    if (S.marks.n && S.marks.delivered >= m.id) return I.two;
    return I.one;
  }
  function fileHtml(m) {
    const f = m.file, src = `/api/chat?file=${f.id}`;
    if (m.kind === 'image') return `<a class="img" href="${src}" data-light="${f.id}"><img src="${src}" alt="" loading="lazy" ${f.w && f.h ? `width="${f.w}" height="${f.h}"` : ''}></a>`;
    if (m.kind === 'video') return `<span class="img"><video src="${src}" controls preload="metadata" playsinline></video></span>`;
    if (m.kind === 'voice') return `<div class="voice">🎤<audio src="${src}" controls preload="none"></audio></div>${f.sec ? `<span class="small muted">${secs(f.sec)}</span>` : ''}${f.text ? `<div class="vtext"><b>Written out</b>${esc(f.text)}</div>` : ''}`;
    const ext = (f.name.split('.').pop() || 'file').slice(0, 4);
    return `<a class="doc" href="${src}&dl=1" ${/pdf/.test(f.mime) ? `data-open="${src}"` : ''}><span class="ext">${esc(ext)}</span><span><b>${esc(f.name)}</b><span>${size(f.size)}${/pdf/.test(f.mime) ? ' · PDF' : ''}</span></span></a>`;
  }
  function cardHtml(c) {
    if (!c) return '';
    return `<div class="card ${c.tone || ''}"><div class="ct">${esc(c.title || '')}</div>${(c.lines || []).map((l) => `<div class="cl">${esc(l)}</div>`).join('')}
      ${c.act || c.link ? `<div class="cb">${c.act ? `<button data-card="1">${esc(c.act.label || 'Open')}</button>` : ''}${c.link ? `<a class="${c.act ? 'ghost' : ''}" href="${esc(c.link.href)}" target="_blank" rel="noopener">${esc(c.link.label || 'Open')}</a>` : ''}</div>` : ''}</div>`;
  }
  function pollHtml(m) {
    const p = m.poll; if (!p) return '';
    const total = p.counts.reduce((a, b) => a + b, 0) || 0;
    return `<div class="poll"><div class="pq">📊 ${esc(p.q)}</div>${p.options.map((o, i) => `<button class="po ${p.mine.includes(i) ? 'mine' : ''}" data-vote="${i}"><i style="width:${total ? Math.round((p.counts[i] / total) * 100) : 0}%"></i><span><span>${esc(o)}</span><b>${p.counts[i]}</b></span></button>`).join('')}
      <div class="pn">${p.voters} voted${p.multi ? ' · choose any' : ' · choose one'}</div></div>`;
  }
  function msgHtml(m, prev) {
    if (m.kind === 'system') return `<div class="sys" id="m${m.id}">${esc(m.body)}</div>`;
    const me = m.user === S.me.id, first = !prev || prev.user !== m.user || prev.kind === 'system' || dkey(prev.at) !== dkey(m.at) || Date.parse(m.at) - Date.parse(prev.at) > 10 * 60e3;
    const showName = first && !me && S.room.kind !== 'dm';
    let inner = '';
    if (m.deleted) inner = `<span class="del">🚫 ${me ? 'You deleted this message' : 'This message was deleted'}</span>`;
    else {
      if (m.fwd) inner += '<div class="fwd">↪ Forwarded</div>';
      if (m.reply) inner += `<button class="q" data-jump="${m.reply.id}"><b>${esc(m.reply.name)}</b><span>${m.reply.kind === 'deleted' ? 'Deleted message' : esc(m.reply.body || { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice note', file: '📄 Document' }[m.reply.kind] || '')}</span></button>`;
      if (m.file) inner += fileHtml(m);
      if (m.kind === 'card') inner += cardHtml(m.card);
      else if (m.kind === 'poll') inner += pollHtml(m);
      else if (m.body) inner += `<span class="tx">${richText(m.body, m.mentions)}</span>`;
    }
    const meta = `<span class="meta">${m.starred ? '<span class="star">⭐</span>' : ''}${m.pinned ? '📌' : ''}${m.edited && !m.deleted ? 'edited ' : ''}${hm(m.at)}${ticks(m)}</span>`;
    const rx = m.reactions && m.reactions.length && !m.deleted ? `<div class="rx">${m.reactions.map((r) => `<button class="${r.mine ? 'mine' : ''}" data-react="${esc(r.e)}">${esc(r.e)}${r.n > 1 ? ' ' + r.n : ''}</button>`).join('')}</div>` : '';
    return `<div class="m ${me ? 'me' : ''} ${first ? 'first' : 'cont'}" id="m${m.id}" data-id="${m.id}"><div class="b">${showName ? `<div class="nm" style="color:${m.user ? color(m.user) : 'var(--warn)'}">${esc(m.name)}</div>` : ''}${inner}${meta}</div>${rx}</div>`;
  }
  function renderMsgs(toBottom) {
    const ml = $('#ml'); if (!ml) return;
    const nearBottom = ml.scrollHeight - ml.scrollTop - ml.clientHeight < 160;
    let html = S.more ? '<button class="older" id="older">Load earlier messages</button>' : '';
    let prev = null, lineDone = false;
    const all = S.msgs.concat(S.pending);
    if (!all.length) html += `<div class="empty-room">${S.room.kind === 'dm' ? 'Say hello 👋' : esc(S.room.about || 'No messages yet.')}<br><br><span class="small">🔒 Messages stay inside Dream India.</span></div>`;
    for (const m of all) {
      if (!prev || dkey(prev.at) !== dkey(m.at)) html += `<div class="day">${dayLabel(m.at)}</div>`;
      if (!lineDone && S.lastRead && m.id > S.lastRead && m.user !== S.me.id && !m.pending && prev) { html += `<div class="unread-line" id="ul">Unread messages</div>`; lineDone = true; }
      html += msgHtml(m, prev); prev = m;
    }
    if (S.private) html += `<div class="private"><div class="pv"><span>🔒 Only you can see this</span><button data-pclose="1">✕</button></div>${S.private.map(cardHtml).join('')}</div>`;
    ml.innerHTML = html;
    if ($('#older')) $('#older').onclick = loadOlder;
    if (toBottom) { const ul = $('#ul'); if (ul) ul.scrollIntoView({ block: 'center' }); else ml.scrollTop = ml.scrollHeight; }
    else if (nearBottom) ml.scrollTop = ml.scrollHeight;
  }
  // one listener for everything inside the messages
  document.addEventListener('click', async (e) => {
    const ml = $('#ml'); if (!ml || !ml.contains(e.target)) return;
    const t = e.target.closest('[data-jump],[data-react],[data-vote],[data-card],[data-light],[data-open],[data-pclose]');
    if (!t) return;
    const mEl = t.closest('.m'), id = mEl ? +mEl.dataset.id : null;
    if (t.dataset.jump) return jumpTo(+t.dataset.jump);
    if (t.dataset.pclose) { S.private = null; renderMsgs(false); return; }
    if (t.dataset.light) { e.preventDefault(); return lightbox(t.getAttribute('href')); }
    if (t.dataset.open && !mobile()) { e.preventDefault(); window.open(t.dataset.open, '_blank', 'noopener'); return; }
    try {
      if (t.dataset.react) { const r = S.byId.get(id).reactions.find((x) => x.e === t.dataset.react); await api('', { action: 'react', id, emoji: r && r.mine ? '' : t.dataset.react }); poll(); }
      if (t.dataset.vote) { await api('', { action: 'vote', id, opt: +t.dataset.vote }); poll(); }
      if (t.dataset.card) { const r = await api('', { action: 'card', id }); window.open(r.url, '_blank', 'noopener'); }
    } catch (x) { fail(x); }
  });
  document.addEventListener('contextmenu', (e) => {
    const mEl = e.target.closest && e.target.closest('#ml .m'); if (!mEl || e.target.closest('a,video,audio')) return;
    e.preventDefault(); msgMenu(+mEl.dataset.id);
  });
  // a long press opens the message menu; a swipe to the right replies
  let press = null;
  document.addEventListener('touchstart', (e) => {
    const mEl = e.target.closest && e.target.closest('#ml .m'); if (!mEl || e.touches.length > 1) return;
    const t0 = e.touches[0];
    press = { el: mEl, x: t0.clientX, y: t0.clientY, dx: 0, timer: setTimeout(() => { press && !press.moved && (navigator.vibrate && navigator.vibrate(15), msgMenu(+mEl.dataset.id)); press = null; }, 480) };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!press) return;
    const t0 = e.touches[0], dx = t0.clientX - press.x, dy = Math.abs(t0.clientY - press.y);
    if (Math.abs(dx) > 8 || dy > 8) { press.moved = true; clearTimeout(press.timer); }
    if (dy < 30 && dx > 0) { press.dx = Math.min(dx, 80); press.el.style.transform = `translateX(${press.dx}px)`; }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!press) return; clearTimeout(press.timer);
    const p = press; press = null; p.el.style.transform = '';
    if (p.dx > 60) { const m = S.byId.get(+p.el.dataset.id); if (m && !m.deleted && S.room.canPost) startReply(m); }
  });

  const QUICK = ['👍', '❤️', '😂', '🙏', '✅', '😮'];
  function msgMenu(id) {
    const m = S.byId.get(id); if (!m || m.pending) return;
    const me = m.user === S.me.id, room = S.room;
    const canEdit = me && m.kind === 'text' && !m.deleted && Date.now() - Date.parse(m.at) < 15 * 60e3;
    const canDel = !m.deleted && ((me && Date.now() - Date.parse(m.at) < 120 * 60e3) || room.role === 'admin' || S.me.admin);
    sheet(`${m.deleted ? '' : `<div class="quick">${QUICK.map((q) => `<button data-q="${q}" class="${(m.reactions.find((r) => r.mine) || {}).e === q ? 'on' : ''}">${q}</button>`).join('')}</div>`}${actions([
      !m.deleted && room.canPost && ['↩️', 'Reply', 'reply'],
      !m.deleted && m.body && m.kind !== 'card' && ['📋', 'Copy', 'copy'],
      !m.deleted && !['system', 'card', 'poll'].includes(m.kind) && ['↪️', 'Forward', 'fwd'],
      !m.deleted && [m.starred ? '✩' : '⭐', m.starred ? 'Remove from saved' : 'Save message', 'star'],
      !m.deleted && (room.kind === 'dm' || room.kind === 'group' || room.role === 'admin') && [m.pinned ? '📍' : '📌', m.pinned ? 'Unpin' : 'Pin in this chat', 'pin'],
      canEdit && ['✏️', 'Edit', 'edit'],
      me && !m.deleted && room.kind !== 'dm' && ['ℹ️', 'Read by', 'info'],
      m.file && !m.deleted && ['⬇️', 'Download', 'dl'],
      canDel && ['🗑️', 'Delete for everyone', 'del', 'danger'],
    ])}`, (el, close) => {
      el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = async () => { close(); const cur = (m.reactions.find((r) => r.mine) || {}).e; try { await api('', { action: 'react', id, emoji: cur === b.dataset.q ? '' : b.dataset.q }); poll(); } catch (e) { fail(e); } }));
      bindActions(el, close, {
        reply: () => startReply(m),
        copy: async () => { try { await navigator.clipboard.writeText(m.body); toast('Copied'); } catch { toast('Could not copy'); } },
        fwd: () => forwardSheet(m),
        star: async () => { await api('', { action: 'star', id, on: !m.starred }); toast(m.starred ? 'Removed from saved' : 'Saved ⭐'); poll(); },
        pin: async () => { await api('', { action: 'pin', id, on: !m.pinned }); poll(); },
        edit: () => { S.edit = m; S.reply = null; renderComposer(); const ta = $('#ta'); ta.value = m.body; autosize(ta); ta.focus(); },
        info: async () => { const r = await api(`?receipts=${id}`); sheet(`<h2>Message info</h2><div class="body"><p><b style="color:var(--tick)">Read by</b><br>${esc(r.read.join(', ') || 'Nobody yet')}</p><p><b>Delivered to</b><br>${esc(r.delivered.join(', ') || '—')}</p>${r.waiting.length ? `<p><b class="muted">Not delivered yet</b><br>${esc(r.waiting.join(', '))}</p>` : ''}</div>`); },
        dl: () => { const a = document.createElement('a'); a.href = `/api/chat?file=${m.file.id}&dl=1`; a.download = m.file.name; document.body.appendChild(a); a.click(); a.remove(); },
        del: async () => { if (!confirm('Delete this message for everyone?')) return; await api('', { action: 'delete', id }); poll(); },
      });
    });
  }
  function forwardSheet(m) {
    const chosen = new Set();
    sheet(`<h2>Forward to</h2>${S.rooms.filter((r) => r.canPost).map((r) => `<button class="pick" data-r="${r.id}">${avatar(r.name, r.other ? r.other.id : r.id, 'sm', r)}<span class="mid"><b>${esc(r.name)}</b></span><span class="tickbox">✓</span></button>`).join('')}<div class="foot"><button class="btn" id="fGo">Send</button></div>`, (el, close) => {
      el.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { const id = +b.dataset.r; chosen.has(id) ? chosen.delete(id) : chosen.size < 10 && chosen.add(id); b.classList.toggle('on', chosen.has(id)); }));
      $('#fGo', el).onclick = async () => { try { const r = await api('', { action: 'forward', id: m.id, rooms: [...chosen] }); close(); toast(`Forwarded to ${r.sent} chat${r.sent === 1 ? '' : 's'}`); loadRooms(); poll(); } catch (e) { fail(e); } };
    });
  }
  function lightbox(src) {
    const el = document.createElement('div'); el.className = 'light';
    el.innerHTML = `<div class="lt"><button id="lbX">✕ Close</button><a href="${src}&dl=1" download>⬇ Save</a></div><img src="${src}" alt="">`;
    document.body.appendChild(el);
    const close = () => { el.remove(); window.removeEventListener('popstate', close); };
    $('#lbX', el).onclick = close; el.onclick = (e) => { if (e.target === el || e.target.tagName === 'IMG') close(); };
  }

  // ---------- room menu & info ----------
  function roomActions() {
    const r = S.room;
    sheet(`<h2>${esc(r.name)}</h2>${actions([
      ['ℹ️', r.kind === 'dm' ? 'Contact info' : 'Group info, media and docs', 'info'],
      ['🔍', 'Search in this chat', 'search'],
      S.ai && ['✨', 'Catch me up', 'catch'],
      [r.muted ? '🔔' : '🔕', r.muted ? 'Unmute' : 'Mute notifications', 'mute'],
      [r.pinned ? '📍' : '📌', r.pinned ? 'Unpin chat' : 'Pin chat to the top', 'pinc'],
      r.kind === 'group' && ['🚪', 'Leave group', 'leave', 'danger'],
    ])}`, (el, close) => bindActions(el, close, {
      info: infoSheet, search: () => searchAll(r.id), catch: catchUp,
      mute: () => (r.muted ? api('', { action: 'pref', room: r.id, mute: 0 }).then(refreshRoomMeta) : muteSheet(r)),
      pinc: async () => { await api('', { action: 'pref', room: r.id, pinned: !r.pinned }); refreshRoomMeta(); },
      leave: async () => { if (!confirm(`Leave "${r.name}"?`)) return; await api('', { action: 'leave', room: r.id }); await loadRooms(); go(''); },
    }));
  }
  async function refreshRoomMeta() { await loadRooms(); const r = S.rooms.find((x) => S.room && x.id === S.room.id); if (r) { S.room = r; renderHead(); renderComposer(); } }
  async function infoSheet() {
    const r = S.room;
    let x; try { x = await api(`?info=${r.id}`); S.members = x.members; } catch (e) { return fail(e); }
    const manage = x.me.manage && r.kind !== 'dm';
    const other = r.kind === 'dm' ? x.members.find((m) => m.id !== S.me.id) : null;
    let tab = 'people';
    sheet(`<div style="text-align:center;padding:10px 18px 6px">${avatar(r.name, other ? other.id : r.id, '', r)}<h2 style="margin:8px 0 2px">${esc(r.name)}</h2>
        <div class="muted small">${other ? esc([other.designation || other.role, lastSeen({ ...other, off: false })].filter(Boolean).join(' · ')) : esc(x.room.about || '')}</div>
        ${x.room.dept ? '<div class="small" style="margin-top:4px;color:var(--brand)">Department group: people join and leave with their role</div>' : ''}</div>
      <div class="tabs">${r.kind !== 'dm' ? '<button class="chip on" data-t="people">People</button>' : ''}<button class="chip ${r.kind === 'dm' ? 'on' : ''}" data-t="media">Media (${x.media.length})</button><button class="chip" data-t="docs">Docs (${x.docs.length})</button></div>
      <div id="infoBody"></div>
      ${manage ? `<div class="foot">${!x.room.dept ? '<button class="btn ghost" id="iRename">Rename</button>' : ''}<button class="btn ghost" id="iAbout">Edit description</button>${r.kind !== 'announce' ? '<button class="btn" id="iAdd">Add people</button>' : ''}</div>` : ''}`, (el, close) => {
      if (r.kind === 'dm') tab = 'media';
      const draw = () => {
        el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
        const body = $('#infoBody', el);
        if (tab === 'people') body.innerHTML = `<div class="sect">${x.members.length} people</div>` + x.members.map((m) => `<button class="pick" data-m="${m.id}">${avatar(m.name, m.id, 'sm', null, online(m.seen))}<span class="mid"><b>${esc(m.id === S.me.id ? 'You' : m.name)}</b><span>${esc(m.status || m.designation || m.role)}</span></span>${m.admin ? '<span class="tag">Group admin</span>' : ''}</button>`).join('');
        if (tab === 'media') body.innerHTML = x.media.length ? `<div class="grid">${x.media.map((f) => `<a href="/api/chat?file=${f.file_id}" ${f.kind === 'image' ? `data-l="1"><img src="/api/chat?file=${f.file_id}" loading="lazy" alt="">` : 'target="_blank" rel="noopener">🎥'}</a>`).join('')}</div>` : '<p class="muted" style="padding:0 18px">No photos or videos yet.</p>';
        if (tab === 'docs') body.innerHTML = x.docs.length ? x.docs.map((f) => `<a class="pick" href="/api/chat?file=${f.file_id}&dl=1" style="text-decoration:none;color:inherit"><span class="av sm" style="background:var(--brand)">📄</span><span class="mid"><b>${esc(f.name)}</b><span>${size(f.size)} · ${esc(f.by || '')} · ${listTime(f.created_at)}</span></span></a>`).join('') : '<p class="muted" style="padding:0 18px">No documents yet.</p>';
        body.querySelectorAll('[data-l]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); lightbox(a.getAttribute('href')); }));
        body.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => personMenu(x.members.find((m) => m.id === +b.dataset.m), manage, close)));
      };
      el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
      draw();
      if ($('#iAdd', el)) $('#iAdd', el).onclick = () => { close(); newGroup(r.id); };
      if ($('#iRename', el)) $('#iRename', el).onclick = async () => { const v = prompt('Group name', r.name); if (!v) return; try { await api('', { action: 'rename', room: r.id, value: v }); close(); refreshRoomMeta(); } catch (e) { fail(e); } };
      if ($('#iAbout', el)) $('#iAbout', el).onclick = async () => { const v = prompt('Description', x.room.about || ''); if (v == null) return; try { await api('', { action: 'about', room: r.id, value: v }); close(); toast('Saved'); } catch (e) { fail(e); } };
    });
  }
  function personMenu(m, manage, closeInfo) {
    if (!m || m.id === S.me.id) return;
    sheet(`<h2>${esc(m.name)}<div class="small muted">${esc(m.designation || m.role)}</div></h2>${actions([
      ['💬', `Message ${esc(m.name.split(' ')[0])}`, 'dm'],
      manage && [m.admin ? '⬇️' : '⭐', m.admin ? 'Remove as group admin' : 'Make group admin', 'admin'],
      manage && !m.auto && ['➖', 'Remove from group', 'rm', 'danger'],
    ])}`, (el, close) => bindActions(el, close, {
      dm: async () => { closeInfo(); const r = await api('', { action: 'dm', user: m.id }); await loadRooms(); go('#r' + r.room); },
      admin: async () => { await api('', { action: 'admin', room: S.room.id, user: m.id, on: !m.admin }); closeInfo(); infoSheet(); },
      rm: async () => { if (!confirm(`Remove ${m.name}?`)) return; await api('', { action: 'remove', room: S.room.id, user: m.id }); closeInfo(); infoSheet(); },
    }));
  }
  async function catchUp() {
    const close = sheet(`<h2>✨ Catch me up</h2><div class="body"><p class="muted">Reading the messages…</p></div>`);
    try {
      const r = await api(`?catchup=${S.room.id}`);
      close();
      sheet(`<h2>✨ Catch me up</h2><div class="body"><p class="small muted">${r.fromRecent ? 'Nothing much unread, so this is the last 3 days.' : `${r.count} unread message${r.count === 1 ? '' : 's'}.`} Written by AI: check anything important in the chat.</p><div class="summary">${esc(r.summary)}</div></div>`);
    } catch (e) { close(); fail(e); }
  }
  async function searchAll(roomId = null) {
    sheet(`<h2>Search ${roomId ? 'in this chat' : 'all chats'}</h2><div class="body"><input id="sq" placeholder="Words, a file name…" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)" autocomplete="off"></div><div id="sr"></div>`, (el, close) => {
      let t = null;
      $('#sq', el).focus();
      $('#sq', el).oninput = (e) => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const v = e.target.value.trim(); if (v.length < 2) { $('#sr', el).innerHTML = ''; return; }
          try { const r = await api(`?search=${encodeURIComponent(v)}${roomId ? '&room=' + roomId : ''}`); $('#sr', el).innerHTML = resultRows(r.rows) || '<p class="muted" style="padding:0 18px">Nothing found.</p>'; bindResults(el, close); } catch (x) { fail(x); }
        }, 300);
      };
    });
  }
  const resultRows = (rows) => rows.map((m) => `<button class="pick" data-rm="${m.room}" data-mid="${m.id}"><span class="mid"><b>${esc(m.roomName || '')} · ${esc(m.name)}</b><span>${esc(m.file ? m.file.name + (m.body ? ': ' + m.body : '') : m.body)}</span></span><span class="muted small">${listTime(m.at)}</span></button>`).join('');
  function bindResults(el, close) {
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      close(); const rid = +b.dataset.rm, mid = +b.dataset.mid;
      if (!S.room || S.room.id !== rid) { go('#r' + rid); setTimeout(() => jumpTo(mid), 700); } else jumpTo(mid);
    }));
  }
  async function savedSheet() {
    try { const r = await api('?saved=1'); sheet(`<h2>⭐ Saved messages</h2><div id="sr">${resultRows(r.rows) || '<p class="muted" style="padding:0 18px">Nothing saved yet. Long-press a message and tap Save.</p>'}</div>`, (el, close) => bindResults(el, close)); } catch (e) { fail(e); }
  }
  async function reviewSheet() {
    try {
      const r = await api('?review=1');
      sheet(`<h2>🛡️ Review chats</h2><div class="body"><p class="small muted">For disputes only. Every chat you open here is recorded in the audit log.</p></div>${r.rooms.map((x) => `<button class="pick" data-v="${x.id}"><span class="mid"><b>${esc(x.name || x.people)}</b><span>${esc(x.people || '')} · ${x.msgs} messages</span></span></button>`).join('')}`, (el, close) =>
        el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
          close();
          try {
            const v = await api(`?review=${b.dataset.v}`);
            sheet(`<h2>${esc(v.room.name || 'One-to-one chat')} <span class="small muted">(review)</span></h2><div class="body">${v.msgs.map((m) => `<p class="small"><span class="muted">${dayLabel(m.at)} ${hm(m.at)}</span> <b>${esc(m.name)}:</b> ${m.deleted ? '<span style="color:var(--bad)">[deleted]</span> ' : ''}${esc(m.body || (m.file ? '[' + m.file.name + ']' : ''))}${m.edited ? ' <i class="muted">(edited)</i>' : ''}</p>`).join('') || '<p class="muted">No messages.</p>'}</div>`);
          } catch (e) { fail(e); }
        })));
    } catch (e) { fail(e); }
  }

  // ---------- composer ----------
  function renderComposer() {
    const f = $('#rFoot'); if (!f || !S.room) return;
    const r = S.room;
    if (!r.canPost) { f.innerHTML = `<div class="readonly">${r.kind === 'announce' ? '📣 Only Management can post in Announcements.' : r.other && r.other.off ? 'This person has left Dream India.' : 'You cannot write in this chat.'}</div>`; return; }
    const quote = S.edit ? { name: 'Editing', body: S.edit.body } : S.reply ? { name: S.reply.user === S.me.id ? 'You' : S.reply.name, body: S.reply.body || { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice note', file: '📄 ' + (S.reply.file ? S.reply.file.name : 'Document') }[S.reply.kind] || '' } : null;
    f.innerHTML = `${quote ? `<div class="replying"><div class="q"><b>${esc(quote.name)}</b><span>${esc(quote.body)}</span></div><button class="ib" id="rqX" style="width:32px;height:32px">${I.x}</button></div>` : ''}
      <div class="compose" id="cmp">
        <div class="box">
          <button class="ib" id="att" title="Attach">${I.clip}</button>
          <textarea id="ta" rows="1" placeholder="Message" title="${S.me.flats ? 'Tip: type /flat A-1203 to see a flat (only you see it)' : ''}" enterkeyhint="send"></textarea>
          <button class="ib" id="cam" title="Camera">${I.cam}</button>
        </div>
        <button class="go" id="go" title="Voice note">${I.mic}</button>
      </div>
      <input type="file" id="fPhoto" accept="image/*,video/*" multiple hidden>
      <input type="file" id="fCam" accept="image/*" capture="environment" hidden>
      <input type="file" id="fDoc" multiple hidden>`;
    const ta = $('#ta'), goBtn = $('#go');
    const draft = store.get('dc_draft_' + r.id);
    if (draft && !S.edit) ta.value = draft;
    const sync = () => { goBtn.innerHTML = ta.value.trim() || S.edit ? I.send : I.mic; goBtn.title = ta.value.trim() ? 'Send' : 'Voice note'; };
    ta.oninput = () => { autosize(ta); sync(); store.set('dc_draft_' + r.id, ta.value); mentionPop(ta); };
    ta.onkeydown = (e) => {
      const pop = $('.mention-pop');
      if (pop && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return mentionKeys(e, pop, ta);
      if (e.key === 'Enter' && !e.shiftKey && !mobile()) { e.preventDefault(); send(); }
      if (e.key === 'Escape' && (S.reply || S.edit)) { S.reply = null; S.edit = null; renderComposer(); }
    };
    autosize(ta); sync();
    goBtn.onclick = () => (ta.value.trim() || S.edit ? send() : record());
    if ($('#rqX')) $('#rqX').onclick = () => { if (S.edit) ta.value = ''; S.reply = null; S.edit = null; renderComposer(); };
    $('#att').onclick = () => sheet(actions([['🖼️', 'Photos and videos', 'photo'], ['📄', 'Document (PDF, Excel, drawing…)', 'doc'], ['📷', 'Camera', 'cam'], ['📊', 'Poll', 'poll']]), (el, close) => bindActions(el, close, { photo: () => $('#fPhoto').click(), doc: () => $('#fDoc').click(), cam: () => $('#fCam').click(), poll: pollSheet }));
    $('#cam').onclick = () => $('#fCam').click();
    ['#fPhoto', '#fCam', '#fDoc'].forEach((s) => ($(s).onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; sendFiles(files, s === '#fDoc'); }));
    if (!mobile()) ta.focus();
  }
  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  function startReply(m) { S.reply = m; S.edit = null; renderComposer(); $('#ta') && $('#ta').focus(); }

  // @mentions: typing @ shows the people in this chat
  function mentionPop(ta) {
    $('.mention-pop')?.remove();
    const before = ta.value.slice(0, ta.selectionStart), m = /(^|\s)@([\w.]{0,20})$/.exec(before);
    if (!m || S.room.kind === 'dm') return;
    const q = m[2].toLowerCase();
    const opts = S.members.filter((p) => p.id !== S.me.id && p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, 8);
    const all = (S.room.kind === 'group' || S.room.role === 'admin' || S.me.boss) && 'all'.startsWith(q);
    if (!opts.length && !all) return;
    const el = document.createElement('div'); el.className = 'mention-pop';
    el.innerHTML = (all ? `<button data-mu="all"><span class="av xs" style="background:var(--brand)">@</span><b>all</b><span>everyone in this chat</span></button>` : '') + opts.map((p) => `<button data-mu="${p.id}">${avatar(p.name, p.id, 'xs')}<b>${esc(p.name)}</b><span>${esc(p.role)}</span></button>`).join('');
    el.firstElementChild.classList.add('on');
    $('#pr').appendChild(el);
    el.querySelectorAll('[data-mu]').forEach((b) => (b.onmousedown = b.ontouchstart = (e) => { e.preventDefault(); pickMention(ta, b.dataset.mu); }));
  }
  function mentionKeys(e, pop, ta) {
    const items = [...pop.querySelectorAll('[data-mu]')], i = items.findIndex((b) => b.classList.contains('on'));
    if (e.key === 'Escape') { pop.remove(); return; }
    e.preventDefault();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { items[i]?.classList.remove('on'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('on'); return; }
    pickMention(ta, items[Math.max(i, 0)].dataset.mu);
  }
  function pickMention(ta, who) {
    const name = who === 'all' ? 'all' : S.members.find((p) => p.id === +who).name;
    if (who !== 'all') S.mentions.set(+who, name);
    const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@([\w.]{0,20})$/, '@' + name + ' ');
    ta.value = before + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = before.length;
    $('.mention-pop')?.remove(); autosize(ta); ta.focus(); ta.dispatchEvent(new Event('input'));
  }

  async function send() {
    const ta = $('#ta'); if (!ta) return;
    const body = ta.value.trim();
    if (!body && !S.edit) return;
    // /flat A-1203: the flat's summary for me only, nothing is posted
    const fm = /^\/flat\s+(\S+)/i.exec(body);
    if (fm) {
      try { const r = await api(`?flat=${encodeURIComponent(fm[1])}`); S.private = r.cards; ta.value = ''; store.set('dc_draft_' + S.room.id, ''); autosize(ta); renderComposer(); renderMsgs(false); $('#ml').scrollTop = $('#ml').scrollHeight; } catch (e) { fail(e); }
      return;
    }
    if (S.edit) {
      const id = S.edit.id;
      try { await api('', { action: 'edit', id, body }); S.edit = null; ta.value = ''; renderComposer(); poll(); } catch (e) { fail(e); }
      return;
    }
    const mentions = [...S.mentions].filter(([, n]) => body.includes('@' + n)).map(([id]) => id);
    const tmp = { id: 'p' + Date.now(), pending: true, user: S.me.id, name: S.me.name, kind: 'text', body, at: new Date().toISOString(), reactions: [], reply: S.reply ? { id: S.reply.id, name: S.reply.name, kind: S.reply.kind, body: S.reply.body } : null, mentions };
    const replyTo = S.reply ? S.reply.id : null;
    S.pending.push(tmp); S.reply = null; S.mentions = new Map();
    ta.value = ''; store.set('dc_draft_' + S.room.id, ''); renderComposer(); renderMsgs(false); $('#ml').scrollTop = $('#ml').scrollHeight;
    try {
      const r = await api('', { action: 'send', room: S.room.id, body, replyTo, mentions, mentionAll: /(^|\s)@all\b/.test(body) });
      S.pending = S.pending.filter((p) => p !== tmp); addMsgs([r.msg]); sound('out');
    } catch (e) { S.pending = S.pending.filter((p) => p !== tmp); renderMsgs(false); fail(e); const t2 = $('#ta'); if (t2 && !t2.value) { t2.value = body; autosize(t2); } }
  }

  // photos are made smaller before sending (like WhatsApp), to stay quick on site mobile data
  const MAX = 3 * 1024 * 1024;
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 350 * 1024 && file.type !== 'image/heic') {
      if (/^image\//.test(file.type)) { const d = await dims(file).catch(() => ({})); return { blob: file, ...d }; }
      return { blob: file };
    }
    const img = await loadImg(file);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return { blob: blob || file, w, h, name: file.name.replace(/\.\w+$/, '') + '.jpg' };
  }
  const loadImg = (file) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const dims = async (file) => { const i = await loadImg(file); const d = { w: i.naturalWidth, h: i.naturalHeight }; URL.revokeObjectURL(i.src); return d; };
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function sendFiles(files, asDoc) {
    if (!files.length) return;
    let caption = '';
    if (!asDoc && files.length === 1 && /^image\//.test(files[0].type)) caption = (prompt('Add a caption (optional)') || '').trim();
    for (const file of files.slice(0, 10)) {
      try {
        const s = asDoc ? { blob: file } : await shrink(file);
        if (s.blob.size > MAX) { toast(`${file.name} is too big (${size(s.blob.size)}). Files can be up to 3 MB${/^video/.test(file.type) ? ': send a shorter clip' : ''}.`, 5000); continue; }
        toast(`Sending ${file.name.slice(0, 30)}…`, 1500);
        const mime = asDoc && /^image\//.test(file.type) ? 'application/octet-stream' : s.blob.type || file.type || 'application/octet-stream';
        const r = await api('', { action: 'send', room: S.room.id, body: caption, replyTo: S.reply ? S.reply.id : null, file: { name: s.name || file.name, mime: asDoc && /^image\//.test(file.type) ? file.type : mime, data: await toB64(s.blob), w: s.w, h: s.h } });
        caption = ''; S.reply = null; addMsgs([r.msg]); renderComposer(); sound('out');
      } catch (e) { fail(e); }
    }
  }
  function pollSheet() {
    sheet(`<h2>📊 New poll</h2><div class="body">
      <label class="field"><span>Question</span><input id="pq" maxlength="300" placeholder="e.g. Site meeting on Saturday at 11?"></label>
      <div id="pos">${[1, 2, 3].map((i) => `<label class="field"><span>Choice ${i}</span><input class="po-in" maxlength="100"></label>`).join('')}</div>
      <button class="chip" id="pAdd">+ Add a choice</button>
      <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pm" style="width:auto"> People can choose more than one</label>
    </div><div class="foot"><button class="btn" id="pGo">Send poll</button></div>`, (el, close) => {
      $('#pAdd', el).onclick = () => { const n = el.querySelectorAll('.po-in').length; if (n >= 10) return; $('#pos', el).insertAdjacentHTML('beforeend', `<label class="field"><span>Choice ${n + 1}</span><input class="po-in" maxlength="100"></label>`); };
      $('#pGo', el).onclick = async () => {
        try { const r = await api('', { action: 'send', room: S.room.id, poll: { question: $('#pq', el).value, options: [...el.querySelectorAll('.po-in')].map((i) => i.value.trim()).filter(Boolean), multi: $('#pm', el).checked } }); close(); addMsgs([r.msg]); } catch (e) { fail(e); }
      };
    });
  }

  // voice notes: recorded on the phone; what is said is also written down by the phone and turned into English
  let rec = null;
  async function record() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('This phone cannot record here. Update the browser.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Allow the microphone to send voice notes.', 4000); }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : {});
    const chunks = []; mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec = { mr, stream, chunks, t0: Date.now(), said: '', cancel: false };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      try {
        const sr = new SR(); sr.lang = 'hi-IN'; sr.continuous = true; sr.interimResults = true;
        let finalText = '';
        sr.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript; } rec && (rec.said = (finalText + interim).trim()); const s = $('#said'); if (s && rec) s.textContent = rec.said; };
        sr.onerror = () => {}; sr.onend = () => { if (rec && rec.mr.state === 'recording') try { sr.start(); } catch {} };
        sr.start(); rec.sr = sr;
      } catch {}
    }
    mr.start(1000);
    const f = $('#cmp');
    f.innerHTML = `<div class="rec"><span class="dotr"></span><b id="rt">0:00</b><span class="said" id="said">${SR ? 'Listening…' : ''}</span><button class="ib" id="rX" title="Cancel" style="color:var(--bad)">${I.bin}</button></div><button class="go" id="rGo" title="Send">${I.send}</button>`;
    rec.tick = setInterval(() => { const s = (Date.now() - rec.t0) / 1000; const el = $('#rt'); if (el) el.textContent = secs(s); if (s >= 300) stopRec(false); }, 500);
    $('#rX').onclick = () => stopRec(true);
    $('#rGo').onclick = () => stopRec(false);
  }
  async function stopRec(cancel) {
    if (!rec) return;
    const r = rec; rec = null; clearInterval(r.tick);
    try { r.sr && r.sr.stop(); } catch {}
    await new Promise((res) => { r.mr.onstop = res; r.mr.stop(); });
    r.stream.getTracks().forEach((t) => t.stop());
    renderComposer();
    if (cancel) return;
    const sec = (Date.now() - r.t0) / 1000;
    if (sec < 1) return toast('Hold on a little longer to record.');
    const blob = new Blob(r.chunks, { type: (r.mr.mimeType || 'audio/webm').split(';')[0] });
    if (blob.size > MAX) return toast('That voice note is too long. Keep it under 5 minutes.');
    try {
      toast('Sending voice note…', 1200);
      const res = await api('', { action: 'send', room: S.room.id, replyTo: S.reply ? S.reply.id : null, file: { name: 'Voice note', mime: blob.type, data: await toB64(blob), sec, voice: true, said: r.said } });
      S.reply = null; addMsgs([res.msg]); renderComposer(); sound('out');
    } catch (e) { fail(e); }
  }

  // ---------- live updates ----------
  function addMsgs(list) {
    let changed = false, fresh = 0;
    for (const m of list) {
      if (S.byId.has(m.id)) { const i = S.msgs.findIndex((x) => x.id === m.id); if (i >= 0) S.msgs[i] = m; }
      else { S.msgs.push(m); if (m.user !== S.me.id) fresh++; }
      S.byId.set(m.id, m); changed = true;
    }
    S.msgs.sort((a, b) => a.id - b.id);
    if (!changed) return 0;
    renderMsgs(false);
    const ml = $('#ml');
    if (fresh && ml && ml.scrollHeight - ml.scrollTop - ml.clientHeight > 200) { const n = $('#jumpN'); n.hidden = false; n.textContent = fresh; }
    return fresh;
  }
  let pollT = null, listT = null, polling = false;
  async function poll() {
    if (polling || !S.me) return; polling = true;
    try {
      const room = S.room && typeof S.room.id === 'number' ? S.room.id : null;
      const after = S.msgs.length ? S.msgs[S.msgs.length - 1].id : 0;
      const r = await api(`?poll=1${room ? `&room=${room}&after=${after}&since=${encodeURIComponent(S.since || '')}` : ''}`);
      if (room && S.room && S.room.id === room && r.msgs) {
        S.since = r.now;
        const fresh = addMsgs(r.msgs);
        const mk = JSON.stringify(r.marks) !== JSON.stringify(S.marks); S.marks = r.marks;
        if (JSON.stringify(r.pins) !== JSON.stringify(S.pins)) { S.pins = r.pins; renderPins(); }
        if (mk && !fresh) renderMsgs(false);
        if (fresh) { if (!document.hidden) markRead(); sound('in'); }
      }
      if (r.stamp !== S.stamp) { const before = unreadTotal(); await loadRooms(); if (!room && unreadTotal() > before) sound('in'); }
    } catch {}
    polling = false;
  }
  function startPolling() {
    stopPolling();
    const tick = () => { poll(); pollT = setTimeout(tick, document.hidden ? 30000 : S.room ? 2500 : 6000); };
    pollT = setTimeout(tick, 2500);
    listT = setInterval(() => { if (!document.hidden) loadRooms().catch(() => {}); }, 60000);
  }
  function stopPolling() { clearTimeout(pollT); clearInterval(listT); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { poll(); markRead(); } });
  let readT = null;
  function markRead() {
    if (!S.room || document.hidden || !S.msgs.length) return;
    const ml = $('#ml'); if (ml && ml.scrollHeight - ml.scrollTop - ml.clientHeight > 200) return;
    const upto = S.msgs[S.msgs.length - 1].id;
    const r = S.rooms.find((x) => x.id === S.room.id);
    if (r && !r.unread && !r.mentioned && S.lastReadSent === upto) return;
    clearTimeout(readT);
    readT = setTimeout(async () => {
      S.lastReadSent = upto;
      try { await api('', { action: 'read', room: S.room.id, upto }); if (r) { r.unread = 0; r.mentioned = 0; renderList(); } $('#jumpN') && ($('#jumpN').hidden = true); } catch {}
    }, 400);
  }
  // the notification in the phone's tray is opened: the service worker tells us which chat
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.open) go('#r' + e.data.open); });

  // sounds: a soft swoosh out, a two-note chime in (only while the app is open)
  let actx = null;
  document.addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }, { passive: true });
  function sound(kind) {
    const a = actx; if (!a || a.state !== 'running' || store.get('dc_sound') === 'off') return;
    const t0 = a.currentTime;
    const notes = kind === 'out' ? [[660, 0, 0.12]] : [[784, 0, 0.3], [1175, 0.12, 0.35]];
    for (const [f, t, d] of notes) { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + t); g.gain.exponentialRampToValueAtTime(kind === 'out' ? 0.08 : 0.2, t0 + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + d); o.connect(g).connect(a.destination); o.start(t0 + t); o.stop(t0 + t + d + 0.05); }
  }

  boot();
})();
