/* Dream India Realty website chat assistant. Add to any page of dreamindiarealty.com (before </body>):
     <script src="https://erp.dreamindiarealty.com/bot.js" data-project="" defer></script>
   data-project: the project's ERP number or name (leave empty on company pages). Everything is inside a shadow root, so
   the website's own styles are not touched. */
(function () {
  if (window.__diBot) return;
  var me = document.currentScript || document.querySelector('script[src*="/bot.js"]');
  var API = (me && me.src ? new URL(me.src).origin : '') + '/api/bot';
  var PROJECT = (me && me.getAttribute('data-project')) || '';
  var FORCE = me && me.getAttribute('data-force') === '1'; // staff preview: show even while switched off
  // the chat shows only while it is switched on in the ERP (Sales & Marketing -> Website chats)
  if (!FORCE) {
    fetch(API + '?cfg=1&_=' + Date.now()).then(function (r) { return r.json(); }).then(function (j) { if (j && j.on) init(); }).catch(function () {});
  } else init();
  function init() {
    if (window.__diBot) return; window.__diBot = 1; // one chat window, even if the line is on the page twice
  var KEY = 'di_bot_sid_' + PROJECT;
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var sid = get(KEY), busy = false, opened = false;

  var host = document.createElement('div'); host.id = 'di-bot';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML = '<style>' +
    ':host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.mini{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:none;align-items:center;gap:10px;width:300px;max-width:calc(100vw - 28px);background:linear-gradient(135deg,#140C59,#2B1E8F);color:#fff;border:0;border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(20,12,89,.35);cursor:pointer;text-align:left}' +
    '.mini.on{display:flex}.mini .av{width:32px;height:32px;font-size:13px}.mini b{display:block;font-size:14px}.mini small{opacity:.8;font-size:11.5px}' +
    '.mini .up{margin-left:auto;width:9px;height:9px;border-left:2px solid #fff;border-top:2px solid #fff;transform:rotate(45deg) translateY(2px)}' +
    '.mini .dot{position:absolute;left:36px;top:8px;width:9px;height:9px;border-radius:50%;background:#22C55E;border:2px solid #2B1E8F}' +
    '.panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 40px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.on{display:flex}' +
    '.hd{background:linear-gradient(135deg,#140C59,#2B1E8F);color:#fff;padding:16px 16px 14px;display:flex;align-items:center;gap:12px}' +
    '.av{width:40px;height:40px;border-radius:50%;background:#F5A524;color:#140C59;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex:none}' +
    '.hd b{display:block;font-size:15px}.hd small{opacity:.8;font-size:12px}.x{margin-left:auto;background:rgba(255,255,255,.12);border:0;color:#fff;cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}.x:hover{background:rgba(255,255,255,.22)}.x i{display:block;width:13px;height:2px;background:#fff;border-radius:2px}' +
    '.msgs{flex:1;overflow-y:auto;padding:16px;background:#F6F7FB;display:flex;flex-direction:column;gap:10px}' +
    '.m{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.b{background:#fff;color:#1d1d1f;border:1px solid #E6E8F0;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.u{background:#140C59;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
    '.typing{align-self:flex-start;color:#6b6f80;font-size:13px;padding:4px 6px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;background:#F6F7FB}' +
    '.chip{border:1px solid #C9C4F0;background:#fff;color:#140C59;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}' +
    '.chip:hover{background:#EFEDFC}' +
    'form{display:flex;gap:8px;padding:12px;border-top:1px solid #E6E8F0;background:#fff}' +
    'input{flex:1;min-width:0;border:1px solid #D5D8E4;border-radius:12px;padding:11px 12px;font-size:16px;outline:none}input:focus{border-color:#140C59}' +
    'button.mic{flex:none;width:44px;border:1px solid #D5D8E4;background:#fff;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#140C59}button.mic svg{width:20px;height:20px}' +
    'button.mic.rec{background:#E5484D;border-color:#E5484D;color:#fff;animation:pl 1.2s infinite}@keyframes pl{0%{box-shadow:0 0 0 0 rgba(229,72,77,.5)}100%{box-shadow:0 0 0 10px rgba(229,72,77,0)}}' +
    'button.s{background:#F5A524;color:#140C59;border:0;border-radius:12px;padding:0 16px;font-weight:700;font-size:14px;cursor:pointer}button.s:disabled{opacity:.5}' +
    '.ft{font-size:10.5px;color:#8a8ea0;text-align:center;padding:0 12px 8px;background:#fff}' +
    '@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:72vh;max-height:72vh;border-radius:18px 18px 0 0}.mini{right:12px;bottom:12px;width:auto;max-width:calc(100vw - 80px)}}' +
    '</style>' +
    '<button class="mini" type="button" aria-label="Open chat with Dream India Realty"><div class="av">DI</div><span class="dot"></span><div><b>Dream India Realty</b><small>Ask us anything</small></div><span class="up" aria-hidden="true"></span></button>' +
    '<div class="panel" role="dialog" aria-label="Chat with Dream India Realty">' +
    '<div class="hd"><div class="av">DI</div><div><b>Dream India Realty</b><small>Sales team \u00b7 online now</small></div><button class="x" type="button" aria-label="Minimise chat" title="Minimise"><i></i></button></div>' +
    '<div class="msgs" aria-live="polite"></div><div class="chips"></div>' +
    '<form><input type="text" placeholder="Type or tap the mic to speak\u2026" maxlength="600" aria-label="Your message"><button class="mic" type="button" aria-label="Speak your message" title="Speak"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg></button><button class="s" type="submit">Send</button></form>' +
    '<div class="ft">Automated replies. A sales advisor follows up every enquiry.</div></div>';

  var $ = function (s) { return root.querySelector(s); };
  var msgs = $('.msgs'), chips = $('.chips'), input = $('input'), send = $('.s');
  var sget = function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  var sset = function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} };
  var LOG = 'di_bot_log', log = []; try { log = JSON.parse(sget(LOG) || '[]') || []; } catch (e) { log = []; }
  var draw = function (who, text) { var d = document.createElement('div'); d.className = 'm ' + who; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; };
  var add = function (who, text) { draw(who, text); log.push([who, text]); if (log.length > 40) log = log.slice(-40); sset(LOG, JSON.stringify(log)); };
  var setChips = function (list) {
    chips.innerHTML = '';
    (list || []).forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c; b.onclick = function () { ask(c); }; chips.appendChild(b); });
  };
  var open = function (auto) {
    $('.panel').classList.add('on'); $('.mini').classList.remove('on'); sset('di_bot_state', 'open');
    if (!opened) {
      opened = true;
      if (log.length) { log.forEach(function (x) { draw(x[0], x[1]); }); setChips([]); if (auto !== true) setTimeout(function () { input.focus(); }, 50); return; }
      var hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      add('b', hi + '! Welcome to Dream India Realty. ' + (PROJECT || /signature|aspire|dz-city/i.test(location.pathname) ? 'Happy to tell you all about this project, share sizes, or book a site visit for you.' : 'We have homes at Dream Signature (Oshiwara), Dream Aspire (Lokhandwala) and DZ City (Mumbra). What are you looking for?'));
      setChips(PROJECT || /signature|aspire|dz-city/i.test(location.pathname) ? ['Tell me about the project', 'Sizes and prices', 'Book a site visit'] : ['1 or 2 BHK homes', 'Book a site visit', 'Call me back']);
    }
    if (auto !== true) setTimeout(function () { input.focus(); }, 50);
  };
  var minimise = function () { stopMic(); $('.panel').classList.remove('on'); $('.mini').classList.add('on'); sset('di_bot_state', 'min'); };
  function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; send.disabled = true; setChips([]); add('u', text); input.value = '';
    var t = document.createElement('div'); t.className = 'typing'; t.textContent = 'Typing\u2026'; msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight;
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sid, project: PROJECT, message: text, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        t.remove();
        if (!x.ok) { add('b', x.j.error || 'Sorry, please try again.'); return; }
        if (x.j.sid) { sid = x.j.sid; set(KEY, sid); }
        add('b', x.j.reply); setChips(x.j.chips);
      })
      .catch(function () { t.remove(); add('b', 'Sorry, the connection dropped. Please try again.'); })
      .then(function () { busy = false; send.disabled = false; input.focus(); });
  }
  $('.mini').onclick = function () { open(); }; $('.x').onclick = function () { minimise(); };
  // speech to text (Chrome, Edge, Safari, Android, iPhone); the mic hides where the browser cannot do it
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, mic = $('.mic');
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  if (!SR) mic.style.display = 'none';
  else mic.onclick = function () {
    if (rec) { stopMic(); return; }
    var base = input.value ? input.value.replace(/\s+$/, '') + ' ' : '', said = '';
    rec = new SR(); rec.lang = (navigator.language && /^(en|hi)/i.test(navigator.language)) ? navigator.language : 'en-IN';
    rec.interimResults = true; rec.continuous = false;
    rec.onresult = function (e) { said = ''; for (var i = 0; i < e.results.length; i++) said += e.results[i][0].transcript; input.value = base + said; };
    rec.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { input.placeholder = 'Microphone is blocked. Please type your message.'; mic.style.display = 'none'; } };
    rec.onend = function () { rec = null; mic.classList.remove('rec'); mic.setAttribute('aria-label', 'Speak your message'); if (said.trim()) ask(input.value); };
    try { rec.start(); mic.classList.add('rec'); mic.setAttribute('aria-label', 'Stop'); input.placeholder = 'Listening\u2026'; }
    catch (e) { rec = null; }
  };
  // no button: 3 seconds after a visitor lands, the chat opens by itself. Visitors can minimise it (never close it);
  // whatever they chose stays as they go from page to page during the visit.
  var state = sget('di_bot_state');
  if (state === 'open') open(true);
  else if (state === 'min') $('.mini').classList.add('on');
  else setTimeout(function () { if (!sget('di_bot_state')) open(true); }, 3000);
  $('form').onsubmit = function (e) { e.preventDefault(); ask(input.value); };
  (document.body || document.documentElement).appendChild(host);
  // the website's older chat box makes way for this one
  ['#chatToggle', '#chatBox'].forEach(function (q) { var e = document.querySelector(q); if (e) e.style.setProperty('display', 'none', 'important'); });
  }
})();
