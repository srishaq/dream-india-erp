/* Dream India ERP: website visits and enquiries.
   On the website, one line before </body>:  <script src="https://erp.dreamindiarealty.com/t.js?k=KEY" async></script>
   It sends each page view, each click on a phone number or WhatsApp link, and each enquiry form sent (with a mobile
   number or email) to the ERP, with where the visitor came from (Google, Instagram, an ad's utm tags…).
   No cookie and no IP address: a random visitor id kept in this browser only. */
(function () {
  try {
    var me = document.currentScript || [].slice.call(document.getElementsByTagName('script')).filter(function (s) { return /\/t\.js\?/.test(s.src); })[0];
    if (!me) return;
    var src = new URL(me.src), base = src.origin, key = src.searchParams.get('k');
    if (!key || navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(navigator.userAgent)) return;
    var store = function (s, k, mk) { try { var v = s.getItem(k); if (!v) { v = mk(); s.setItem(k, v); } return v; } catch (e) { return mk(); } };
    var rid = function () { return Math.random().toString(36).slice(2) + Date.now().toString(36); };
    var vid = store(localStorage, 'di_vid', rid), sid = store(sessionStorage, 'di_sid', rid);
    var q = new URLSearchParams(location.search);
    // the first page of the visit keeps where it came from for the whole visit
    var keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
    var from = {}; try { from = JSON.parse(sessionStorage.getItem('di_from') || 'null') || {}; } catch (e) { from = {}; }
    if (!from.set) { keep.forEach(function (k) { if (q.get(k)) from[k] = q.get(k).slice(0, 150); }); from.referrer = document.referrer && document.referrer.indexOf(location.host) < 0 ? document.referrer.slice(0, 300) : ''; from.set = 1; try { sessionStorage.setItem('di_from', JSON.stringify(from)); } catch (e) {} }
    var send = function (kind, extra) {
      var d = { k: kind, v: vid, s: sid, h: location.host, p: location.pathname + (location.hash && location.hash.length < 40 ? location.hash : ''), t: document.title.slice(0, 150), w: screen.width };
      for (var x in from) if (x !== 'set') d[x] = from[x];
      for (var y in extra || {}) d[y] = extra[y];
      var body = JSON.stringify(d), url = base + '/api/marketing?hit=' + encodeURIComponent(key);
      if (navigator.sendBeacon) navigator.sendBeacon(url, body); else fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true });
    };
    send('view');
    // clicks on call / WhatsApp
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      var h = a.getAttribute('href') || '';
      if (/^tel:/i.test(h)) send('call', { l: h.slice(4, 30) });
      else if (/wa\.me|whatsapp\.com|whatsapp:/i.test(h)) send('whatsapp', { l: h.slice(0, 120) });
      else if (/\.pdf($|\?)/i.test(h) || /brochure/i.test(h + a.textContent)) send('brochure', { l: (a.textContent || h).trim().slice(0, 80) });
    }, true);
    // any enquiry form on the site: name / mobile / email / message go to the ERP's Leads as well
    document.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.elements) return;
      var o = {}, pick = function (el) { return ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase(); };
      [].slice.call(f.elements).forEach(function (el) {
        if (!el.value || el.type === 'password' || el.type === 'hidden' && !/project/i.test(el.name || '')) return;
        var n = pick(el), v = String(el.value).slice(0, 500);
        if (el.type === 'tel' || /phone|mobile|contact|tel|whatsapp/.test(n)) o.phone = o.phone || v;
        else if (el.type === 'email' || /mail/.test(n)) o.email = o.email || v;
        else if (/project|property/.test(n)) o.project = v;
        else if (/name/.test(n) && !/company/.test(n)) o.name = o.name ? o.name + ' ' + v : v;
        else if (/message|query|comment|requirement|remark/.test(n) || el.tagName === 'TEXTAREA') o.message = v;
      });
      if (!o.phone && !o.email) return;
      var b = new URLSearchParams(); for (var k in o) b.set(k, o[k]);
      for (var x in from) if (x !== 'set' && from[x]) b.set(x, from[x]);
      b.set('source', 'website'); b.set('vid', vid); b.set('page', location.href.slice(0, 300)); if (!o.project) b.set('project', document.title.slice(0, 120));
      var url = base + '/api/marketing?lead=' + encodeURIComponent(key);
      if (navigator.sendBeacon) navigator.sendBeacon(url, b); else fetch(url, { method: 'POST', body: b, mode: 'no-cors', keepalive: true });
      send('enquiry');
    }, true);
  } catch (e) { /* never break the website */ }
})();
