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
    fetch(API + '?cfg=1').then(function (r) { return r.json(); }).then(function (j) { if (j && j.on) init(); }).catch(function () {});
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
    '.fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;background:#140C59;color:#fff;border:0;border-radius:999px;padding:14px 20px;font-size:15px;font-weight:600;box-shadow:0 10px 30px rgba(20,12,89,.35);cursor:pointer}' +
    '.fab .dot{width:10px;height:10px;border-radius:50%;background:#F5A524;box-shadow:0 0 0 4px rgba(245,165,36,.25)}' +
    '.panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 40px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.on{display:flex}' +
    '.hd{background:linear-gradient(135deg,#140C59,#2B1E8F);color:#fff;padding:16px 16px 14px;display:flex;align-items:center;gap:12px}' +
    '.av{width:40px;height:40px;border-radius:50%;background:#F5A524;color:#140C59;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex:none}' +
    '.hd b{display:block;font-size:15px}.hd small{opacity:.8;font-size:12px}.x{margin-left:auto;background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px}' +
    '.msgs{flex:1;overflow-y:auto;padding:16px;background:#F6F7FB;display:flex;flex-direction:column;gap:10px}' +
    '.m{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.b{background:#fff;color:#1d1d1f;border:1px solid #E6E8F0;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.u{background:#140C59;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
    '.typing{align-self:flex-start;color:#6b6f80;font-size:13px;padding:4px 6px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;background:#F6F7FB}' +
    '.chip{border:1px solid #C9C4F0;background:#fff;color:#140C59;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}' +
    '.chip:hover{background:#EFEDFC}' +
    'form{display:flex;gap:8px;padding:12px;border-top:1px solid #E6E8F0;background:#fff}' +
    'input{flex:1;border:1px solid #D5D8E4;border-radius:12px;padding:11px 12px;font-size:16px;outline:none}input:focus{border-color:#140C59}' +
    'button.s{background:#F5A524;color:#140C59;border:0;border-radius:12px;padding:0 16px;font-weight:700;font-size:14px;cursor:pointer}button.s:disabled{opacity:.5}' +
    '.ft{font-size:10.5px;color:#8a8ea0;text-align:center;padding:0 12px 8px;background:#fff}' +
    '@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.fab{right:14px;bottom:14px}}' +
    '</style>' +
    '<button class="fab" type="button" aria-label="Chat with Dream India Realty"><span class="dot"></span>Chat with us</button>' +
    '<div class="panel" role="dialog" aria-label="Chat with Dream India Realty">' +
    '<div class="hd"><div class="av">DI</div><div><b>Dream India Realty</b><small>Ask about homes, prices, site visits</small></div><button class="x" type="button" aria-label="Close">\u00d7</button></div>' +
    '<div class="msgs" aria-live="polite"></div><div class="chips"></div>' +
    '<form><input type="text" placeholder="Type your message\u2026" maxlength="600" aria-label="Your message"><button class="s" type="submit">Send</button></form>' +
    '<div class="ft">An AI assistant. A sales advisor follows up every enquiry.</div></div>';

  var $ = function (s) { return root.querySelector(s); };
  var msgs = $('.msgs'), chips = $('.chips'), input = $('input'), send = $('.s');
  var add = function (who, text) { var d = document.createElement('div'); d.className = 'm ' + who; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; };
  var setChips = function (list) {
    chips.innerHTML = '';
    (list || []).forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c; b.onclick = function () { ask(c); }; chips.appendChild(b); });
  };
  var open = function () {
    $('.panel').classList.add('on'); $('.fab').style.display = 'none';
    if (!opened) {
      opened = true;
      var hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      add('b', hi + '! I am the Dream India Realty assistant. Ask me about our homes, the location, or book a site visit.');
      setChips(['Tell me about the project', 'Sizes and prices', 'Book a site visit']);
    }
    setTimeout(function () { input.focus(); }, 50);
  };
  var close = function () { $('.panel').classList.remove('on'); $('.fab').style.display = ''; };
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
  $('.fab').onclick = open; $('.x').onclick = close;
  $('form').onsubmit = function (e) { e.preventDefault(); ask(input.value); };
  (document.body || document.documentElement).appendChild(host);
  // the website's older chat box makes way for this one
  ['#chatToggle', '#chatBox'].forEach(function (q) { var e = document.querySelector(q); if (e) e.style.setProperty('display', 'none', 'important'); });
  }
})();
