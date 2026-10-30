// Partner & Telemarketing → Reports: the full telecalling report of one project, the same for every project.
// A finished campaign run outside the ERP (Dream Signature 2025-26) reads its own telecalling sheet, loaded once here;
// projects called through the ERP read the call results entered from the call sheets. Every box, bar and row opens
// the rows behind it (searchable, downloadable). Mounted by telemarketing.js: window.TcPerf.render(ctx, {host, project}).
(function () {
  let C = null, H = null, R = null, D = null, PID = null, S = { sort: 'leads', dir: -1, q: '', cpSort: 'leads', cpDir: -1, cpQ: '', all: false, cpAll: false };
  const css = `
  .tp{--ink:#10114e;--mut:#667085;--line:#EAECF0;--soft:#F7F7FB;overflow-wrap:anywhere}
  .tp .tp-hero{background:radial-gradient(900px 300px at 90% -40%,#14B8A6 0,transparent 60%),linear-gradient(135deg,#0B3B4A,#140C59);color:#fff;border-radius:20px;padding:22px 24px;margin:0 0 16px}
  .tp .tp-hero h1{color:#fff;margin:2px 0 6px;font-size:24px}.tp .tp-hero p{margin:0;color:#CFF5EF;font-size:14px;max-width:900px;line-height:1.5}.tp .tp-hero b{color:#fff}
  .tp .tp-eye{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#99F6E4;font-weight:700}.tp .tp-done{display:inline-block;background:#ffffff22;border:1px solid #ffffff44;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;margin-left:8px;vertical-align:middle}
  .tp .tp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
  .tp .tp-kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px;text-align:left;font:inherit;color:inherit;cursor:pointer;transition:box-shadow .15s,border-color .15s}
  .tp .tp-kpi{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;width:100%;font-weight:400;color:var(--ink)}.tp .tp-kpi:hover{background:#fff;border-color:#0E8C9B;box-shadow:0 4px 14px #0E8C9B22}.tp .tp-kpi.warn:hover{background:#FFFCF5}.tp .tp-kpi.bad:hover{background:#FFFBFA}.tp .tp-kpi span{display:block;font-size:13px;color:var(--mut)}.tp .tp-kpi b{display:block;font-size:24px;color:var(--ink);margin:4px 0 2px;letter-spacing:-.02em}.tp .tp-kpi small{display:block;font-size:12px;color:var(--mut)}
  .tp .tp-kpi.warn{border-color:#FEC84B;background:#FFFCF5}.tp .tp-kpi.bad{border-color:#FDA29B;background:#FFFBFA}.tp .tp-kpi .go{float:right;color:#0E8C9B;font-size:13px;font-weight:700}
  .tp h2.tp-h{font-size:17px;color:var(--ink);margin:22px 0 4px}.tp p.tp-sub{color:var(--mut);font-size:14px;margin:0 0 12px;max-width:900px;line-height:1.5}
  .tp .tp-g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.tp .tp-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}@media(max-width:900px){.tp .tp-g2,.tp .tp-g3{grid-template-columns:1fr}.tp .tp-hero h1{font-size:20px}}
  .tp .tp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px;min-width:0}.tp .tp-card h3{margin:0 0 4px;font-size:15px;color:var(--ink)}.tp .tp-card .n{font-size:13px;color:var(--mut);margin:0 0 10px;line-height:1.45}
  .tp .hb{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:10px;align-items:center;font-size:13px;padding:4px 6px;margin:2px -6px;border-radius:8px}.tp .hb[data-drill]{cursor:pointer}.tp .hb[data-drill]:hover{background:var(--soft)}
  .tp .hb .t{height:12px;background:var(--soft);border-radius:99px;overflow:hidden}.tp .hb .t i{display:block;height:100%;border-radius:99px}.tp .hb b{font-variant-numeric:tabular-nums;color:var(--ink)}
  .tp .tp-chart{width:100%}.tp .tp-chart text{font-size:11px;fill:#667085}.tp .tp-chart .v{fill:#10114e;font-weight:700}.tp .tp-chart rect[data-drill]{cursor:pointer}.tp .tp-chart rect[data-drill]:hover{fill:#0E8C9B14}
  .tp .tp-scroll{overflow-x:auto}.tp table.tp-t{width:100%;border-collapse:collapse;font-size:13px}.tp table.tp-t th{text-align:left;font-size:12px;color:var(--mut);font-weight:700;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer}.tp table.tp-t td{padding:7px 8px;border-bottom:1px solid var(--line)}.tp table.tp-t .r{text-align:right;font-variant-numeric:tabular-nums}
  .tp table.tp-t tr[data-drill]{cursor:pointer}.tp table.tp-t tr[data-drill]:hover td{background:var(--soft)}
  .tp .tp-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.tp .tp-tools input{max-width:240px;margin:0}
  .tp .tp-lesson{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:14px;line-height:1.5}.tp .tp-lesson:first-of-type{border-top:0}.tp .tp-lesson span{width:24px;height:24px;border-radius:50%;background:#0E8C9B;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center}
  .tp .tp-note{background:#F0FDFA;border:1px solid #99F6E4;border-radius:12px;padding:10px 14px;font-size:13px;margin:0 0 14px}
  .tp-tip{position:fixed;pointer-events:none;background:#10114e;color:#fff;font-size:12px;padding:6px 8px;border-radius:8px;z-index:70;white-space:nowrap}
  .tp-dl{position:fixed;inset:0;background:#10114e66;z-index:80;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}
  .tp-dl .box{background:#fff;border-radius:18px;width:min(1200px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;box-shadow:0 20px 60px #10182855}
  .tp-dl .hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid #EAECF0}.tp-dl .hd h2{margin:0;font-size:17px;color:#10114e;flex:1;min-width:200px}.tp-dl .hd input{max-width:220px;margin:0}
  .tp-dl .bd{overflow:auto;padding:0 18px 12px}.tp-dl table{width:100%;border-collapse:collapse;font-size:13px}.tp-dl th{position:sticky;top:0;background:#fff;text-align:left;font-size:12px;color:#667085;padding:8px;border-bottom:1px solid #EAECF0;white-space:nowrap}.tp-dl td{padding:7px 8px;border-bottom:1px solid #F2F4F7;vertical-align:top}.tp-dl td.r{text-align:right;white-space:nowrap}
  .tp-dl .ft{padding:10px 18px;border-top:1px solid #EAECF0;display:flex;gap:10px;align-items:center;font-size:13px;color:#667085}
  `;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => (n == null || n === '' ? '–' : Math.round(n).toLocaleString('en-IN'));
  const cr = (n) => (n == null ? '–' : n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(1) + ' L' : '₹' + nf(n));
  const pc = (x, d = 0) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%');
  const dmy = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const MON = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const COL = { a: '#0E8C9B', b: '#7A5AF8', hot: '#E1306C', warm: '#E8A200', cold: '#2E90FA', lost: '#98A2B3', bad: '#D92D20' };
  const dr = (k, v) => `data-drill="${esc(k)}"${v != null ? ` data-val="${esc(v)}"` : ''}`;

  // horizontal bars: rows [{label, value, color, note, tip, drill:[key, val]}]
  const hbars = (rows, fmt = nf) => { const mx = Math.max(1, ...rows.map((r) => +r.value || 0)); return rows.map((r) => `<div class="hb" ${r.drill ? dr(r.drill[0], r.drill[1]) : ''} data-tip="${esc(r.tip || (r.drill ? 'Click to see the rows' : ''))}"><span>${esc(r.label)}</span><div class="t"><i style="width:${Math.max(1, ((+r.value || 0) / mx) * 100)}%;background:${r.color || COL.a}"></i></div><b>${fmt(r.value)}${r.note ? ` <span class="muted" style="font-weight:400">${esc(r.note)}</span>` : ''}</b></div>`).join(''); };
  function vbars(rows, key, color, tipOf, drillOf) {
    if (!rows.length) return '<p class="muted small">No dated rows.</p>';
    const W = 680, Hh = 210, B = 22, T = 18, n = rows.length, mx = Math.max(1, ...rows.map((r) => +r[key] || 0)), slot = W / n, bw = Math.min(26, slot - 6);
    const y = (v) => Hh - B - ((+v || 0) / mx) * (Hh - B - T);
    let g = `<line x1="0" x2="${W}" y1="${Hh - B}" y2="${Hh - B}" stroke="#EAECF0"/>`;
    const im = rows.reduce((a, r, i) => ((+r[key] || 0) > (+rows[a][key] || 0) ? i : a), 0);
    rows.forEach((r, i) => {
      const x = i * slot + (slot - bw) / 2, top = y(r[key]), h = Hh - B - top;
      if (h > 0) g += `<path d="M${x},${Hh - B}V${top + Math.min(4, h)}q0,-4 4,-4h${Math.max(0, bw - 8)}q4,0 4,4V${Hh - B}Z" fill="${color}"/>`;
      g += `<rect x="${i * slot}" y="${T}" width="${slot}" height="${Hh - B - T}" fill="transparent" data-tip="${esc(tipOf(r))}" ${drillOf ? dr(...drillOf(r)) : ''}/>`;
      if (i % Math.ceil(n / 10) === 0) g += `<text x="${i * slot + slot / 2}" y="${Hh - 6}" text-anchor="middle">${MON(r.month)}</text>`;
    });
    g += `<text class="v" x="${im * slot + slot / 2}" y="${y(rows[im][key]) - 5}" text-anchor="middle">${nf(rows[im][key])}</text>`;
    return `<svg class="tp-chart" viewBox="0 0 ${W} ${Hh}" width="100%" role="img">${g}</svg>`;
  }
  let tipEl = null;
  function tips(root) {
    root.addEventListener('mousemove', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t || !t.dataset.tip) { if (tipEl) tipEl.style.display = 'none'; return; } if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tp-tip'; document.body.appendChild(tipEl); } tipEl.textContent = t.dataset.tip; tipEl.style.display = 'block'; tipEl.style.left = Math.min(innerWidth - 220, e.clientX + 12) + 'px'; tipEl.style.top = e.clientY - 34 + 'px'; });
    root.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
  }
  function csv(name, head, rows) {
    const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function render(ctx, opt) {
    C = ctx; H = opt.host; PID = opt.project;
    if (!$('#tp-css')) { const st = document.createElement('style'); st.id = 'tp-css'; st.textContent = css; document.head.appendChild(st); }
    H.innerHTML = '<p class="muted">Putting the report together…</p>';
    R = await C.api('/api/tm?results=' + encodeURIComponent(PID));
    D = R.report || R.fixed;
    paint();
  }

  // ---------- the rows behind a figure ----------
  async function drill(key, val) {
    if (!R.report) return alert(R.canLoad ? 'Load this project\'s telecalling sheet first (button at the top of the report): then every figure opens to the rows behind it.' : 'The rows behind this figure are not loaded yet.');
    const dl = document.createElement('div'); dl.className = 'tp-dl';
    dl.innerHTML = `<div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>Loading…</h2><input type="search" placeholder="Search these rows"><button class="ghost small" data-csv>Download (CSV)</button><button class="ghost small" data-x>Close</button></div><div class="bd"></div><div class="ft"></div></div>`;
    document.body.appendChild(dl);
    const close = () => { dl.remove(); document.removeEventListener('keydown', onKey); }, onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    dl.onclick = (e) => { if (e.target === dl || e.target.closest('[data-x]')) close(); };
    let page = 0, q = '', last = null, tmr = null;
    const fmt = (v, t) => (t === 'n' ? nf(v) : t === 'inr' ? '₹' + nf(v) : t === 'pct' ? pc(+v, 1) : t === 'date' ? dmy(v) : esc(v));
    const url = (p) => `/api/tm?drill=${encodeURIComponent(key)}&project=${encodeURIComponent(PID)}&val=${encodeURIComponent(val ?? '')}&q=${encodeURIComponent(q)}&page=${p}`;
    async function load() {
      const r = (last = await C.api(url(page)));
      $('h2', dl).textContent = r.title;
      $('.bd', dl).innerHTML = r.rows.length ? `<table><tr>${r.columns.map(([, l, t]) => `<th class="${t && t !== 'date' ? 'r' : ''}">${esc(l)}</th>`).join('')}</tr>${r.rows.map((x) => `<tr>${r.columns.map(([k, , t]) => `<td class="${t && t !== 'date' ? 'r' : ''}">${fmt(x[k], t)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted" style="padding:20px 0">No rows.</p>';
      const from = r.page * r.per + 1, to = Math.min(r.total, (r.page + 1) * r.per);
      $('.ft', dl).innerHTML = `<span>${r.total ? `${nf(from)}–${nf(to)} of ${nf(r.total)}` : ''}</span><span style="flex:1"></span>${r.page > 0 ? '<button class="ghost small" data-p="-1">‹ Previous</button>' : ''}${to < r.total ? '<button class="ghost small" data-p="1">Next ›</button>' : ''}`;
      $$('[data-p]', dl).forEach((b) => (b.onclick = () => { page += +b.dataset.p; load(); }));
    }
    $('input', dl).oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { q = e.target.value; page = 0; load(); }, 300); };
    $('[data-csv]', dl).onclick = async () => { const r = await C.api(url(-1)); csv((r.title || 'rows').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv', r.columns.map((c) => c[1]), (r.all || []).map((x) => r.columns.map(([k]) => x[k]))); };
    try { await load(); } catch (e) { $('.bd', dl).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }

  // ---------- loading a finished campaign's telecalling sheet ----------
  const FIELDS = [['day', 'Date', /^date$|call.*date|^dt$/i], ['caller', 'Caller', /caller.*name|telecaller|^caller$/i], ['caller_place', 'Caller location', /caller.*(loc|place|city)/i], ['cp_firm', 'Partner firm', /cp.*firm|firm|partner|cp.*name|broker/i], ['cp_phone', 'Partner phone', /cp.*(contact|mob|phone)/i],
    ['sm', 'Sourcing manager', /sourcing|manager|\bsm\b/i], ['client', 'Client name', /client.*name|customer.*name|lead.*name|^name$/i], ['mobile', 'Client mobile', /client.*(contact|mob|phone|no)|customer.*(mob|phone|contact)|lead.*(mob|phone)/i], ['config', 'Configuration', /config|bhk|requirement/i],
    ['status', 'Hot / Warm / Cold', /status|temperature|lead type|category/i], ['remark', 'Remarks', /remark|comment|feedback/i], ['visit_on', 'Expected visit date', /visit/i]];
  const b64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(file); });
  function loader() {
    const box = $('#tpLoad', H);
    box.innerHTML = `<div class="tp-card"><h3>Load the full telecalling sheet</h3><p class="n">For a campaign run outside the ERP. Every row is kept (date, caller, partner firm, sourcing manager, client, number, configuration, tag, remarks), so every figure in this report opens to its rows and buyers in the CRM are matched. Loading again replaces the rows loaded before.</p><input type="file" accept=".xlsx,.csv,.txt" id="tpF"><div id="tpM"></div></div>`;
    $('#tpF', H).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $('#tpM', H).innerHTML = '<p class="muted">Reading…</p>';
      try {
        const { rows } = await C.api('/api/tm', { action: 'parse', file: await b64(f), name: f.name });
        const h = rows[0].map((x) => String(x || '')), data = rows.slice(1).filter((r) => r.some((v) => v !== '' && v != null));
        const used = new Set();
        const guess = (re, k) => { let i = h.findIndex((x, j) => !used.has(j) && re.test(x) && !(k !== 'cp_phone' && k !== 'cp_firm' && /\bcp\b|partner|firm/i.test(x) && k !== 'sm') && !(k === 'client' && /caller/i.test(x))); if (i >= 0) used.add(i); return i; };
        const pre = Object.fromEntries(FIELDS.map(([k, , re]) => [k, guess(re, k)]));
        const opt = (sel) => '<option value="-1">—</option>' + h.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x || 'Column ' + (i + 1))}</option>`).join('');
        $('#tpM', H).innerHTML = `<p><b>${nf(data.length)}</b> rows in ${esc(f.name)}. Check each box: the client's mobile, not the partner's or the caller's.</p><div class="row" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${FIELDS.map(([k, l]) => `<div><label>${l}</label><select data-f="${k}">${opt(pre[k])}</select></div>`).join('')}</div><div class="actions"><button id="tpGo">Load ${nf(data.length)} rows</button></div><div id="tpR"></div>`;
        $('#tpGo', H).onclick = async (ev) => {
          const map = Object.fromEntries($$('[data-f]', H).map((s) => [s.dataset.f, +s.value]));
          if (map.mobile < 0) return alert('Choose the client mobile column.');
          if (!confirm(`Load ${data.length.toLocaleString('en-IN')} rows into this project's report? Rows loaded before are replaced.`)) return;
          ev.target.disabled = true;
          const recs = data.map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? r[i] : ''])));
          try {
            for (let i = 0; i < recs.length; i += 5000) {
              $('#tpR', H).innerHTML = `<p class="muted">Loading ${nf(Math.min(i + 5000, recs.length))} of ${nf(recs.length)}…</p>`;
              await C.api('/api/tm', { action: 'rows-load', projectId: +PID, rows: recs.slice(i, i + 5000), first: i === 0, offset: i, fileName: f.name });
            }
            render(C, { host: H, project: PID });
          } catch (x) { ev.target.disabled = false; $('#tpR', H).innerHTML = `<div class="err">${esc(x.message)}</div>`; }
        };
      } catch (x) { $('#tpM', H).innerHTML = `<div class="err">${esc(x.message)}</div>`; }
    };
  }

  function paint() {
    const p = R.project;
    if (!D) {
      H.innerHTML = `<div class="tp"><div class="tp-card"><h3>${esc(p.name)}</h3><p class="n">No calls entered for this project yet. The report fills in by itself as call sheets are entered${R.canLoad ? ', or load a finished campaign\'s telecalling sheet below' : ''}.</p></div><div id="tpLoad"></div></div>`;
      if (R.canLoad) loader();
      return;
    }
    const k = D.kpis[0], b = D.bk_kpis[0], cost = k.cost != null ? k.cost : k.caller_days * R.rate, F = R.fixed, live = !!R.report, calls = live && R.source === 'calls';
    const kpi = (label, value, sub, key, val, cls = '') => `<button type="button" class="tp-kpi ${cls}" ${dr(key, val)} title="See the rows behind this figure"><span>${label}<em class="go">›</em></span><b>${value}</b><small>${sub}</small></button>`;
    const lead = calls ? 'calls entered' : 'leads';
    H.innerHTML = `<div class="tp">
      <div class="tp-hero"><span class="tp-eye">Report · ${esc(p.name)}</span><h1>${calls ? 'Telecalling results' : 'Telecalling: final results'}${p.status === 'closed' || p.history ? ' <span class="tp-done">Completed</span>' : ''}</h1>
        <p>${calls ? 'Call results' : 'Telecalling'} logged <b>${nf(k.rows)}</b> ${lead}${k.first_date ? ` from <b>${dmy(k.first_date)}</b> to <b>${dmy(k.last_date)}</b>` : ''}. That is <b>${nf(k.unique_people)}</b> distinct people, <b>${nf(k.unique_full)}</b> with a full mobile number we can message. Of <b>${nf(b.buyers)}</b> buyers in the CRM, <b>${nf(b.before)}</b> were called before they booked.</p></div>
      ${!live ? `<div class="tp-note">These are the figures as finalised for this campaign.${R.canLoad ? ' Load its telecalling sheet once (below) and every box, bar and row opens to the rows behind it.' : ''}</div>` : '<p class="small muted" style="margin:-6px 0 12px">Click any box, bar or row to see the rows behind it.</p>'}
      <div class="tp-kpis">
        ${kpi(calls ? 'Calls entered' : 'Leads logged', nf(k.rows), calls ? 'every call result' : 'every row in the sheet', 'leads')}
        ${kpi('Distinct people', nf(k.unique_people), 'repeats merged', 'people')}
        ${kpi('Messageable numbers', nf(k.unique_full), 'unique full 10-digit mobiles', 'messageable')}
        ${k.masked_rows ? kpi('Masked by partners', nf(k.masked_rows), `${pc(k.masked_rows / k.rows)} of rows, last digits only`, 'masked', null, 'warn') : ''}
        ${kpi('Callers used', nf(k.callers), `peak ${nf(k.peak_callers)} on one day · ${k.avg_callers} on an average day`, 'callers')}
        ${kpi('Caller-days worked', nf(k.caller_days), `over ${nf(k.days_active)} calling days`, 'callerdays')}
        ${kpi(calls ? 'Calls per caller per day' : 'Leads per caller per day', k.leads_per_caller_day, calls ? 'calls entered a day' : 'logged interested leads, not dials', 'perday', null, 'bad')}
        ${kpi('Telecaller cost', cr(cost), calls ? 'days worked × each caller\'s daily rate' : `caller-days × ₹${nf(R.rate)} a day`, 'cost')}
        ${kpi('Buyers called before booking', nf(b.before), `of ${nf(b.buyers)} buyers · ${pc(b.conv, 2)} of people called`, 'buyers')}
        ${kpi('Cost per traced buyer', b.before ? cr(cost / b.before) : '–', `telecaller cost ÷ ${nf(b.before)} buyers`, 'buyers', null, 'warn')}
        ${kpi('Agreement value of those buyers', cr(b.val_before), `${pc(b.val_share)} of all bookings (${cr(b.val_all)})`, 'buyers')}
        ${kpi('Booked through another partner', nf(b.cp_diff), `of ${nf(b.before)}: not the partner who first logged them`, 'buyers_diffcp', null, 'bad')}
      </div>

      <h2 class="tp-h">Calling activity</h2><p class="tp-sub">${calls ? 'Every call result entered from the printed call sheets.' : 'The sheet records interested leads, not every dial, so the true number of calls placed is not in the data.'}</p>
      <div class="tp-g2"><div class="tp-card"><h3>${calls ? 'Calls' : 'Leads logged'} per month</h3><p class="n">Hover for callers active and Hot leads; click a month for its rows.</p>${vbars(D.monthly, 'leads', COL.a, (r) => `${MON(r.month)}: ${nf(r.leads)} · ${nf(r.callers)} callers · ${nf(r.hot)} Hot`, (r) => ['month', r.month])}</div>
        <div class="tp-card"><h3>By day of week</h3><p class="n">Plan callers and WhatsApp sends on the busy days.</p>${hbars(D.dow.map((r) => ({ label: r.day, value: r.leads, color: r.leads < Math.max(...D.dow.map((x) => x.leads)) * 0.25 ? COL.bad : COL.cold, tip: `${r.day}: ${nf(r.leads)}, ${nf(r.hot)} Hot`, drill: ['dow', r.day] })))}</div></div>

      <h2 class="tp-h">Lead quality</h2>
      <div class="tp-g3"><div class="tp-card"><h3>Phone numbers</h3><p class="n">Rows by the kind of number recorded.</p>${hbars(D.phone_quality.map((r, i) => ({ label: r.type, value: r.rows, color: [COL.a, COL.warm, COL.bad][i], note: pc(r.rows / k.rows), drill: ['phone', r.kind || ['full', 'masked', 'invalid'][i]] })))}</div>
        <div class="tp-card"><h3>Lead temperature</h3><p class="n">${calls ? 'Site visit = Hot; interested or call back = Warm; not reachable = Cold; not interested = Lost.' : 'Distinct people by their best tag; the second figure is how many can be messaged.'}</p>${hbars(D.status.map((r) => ({ label: r.status, value: r.people, color: COL[r.status.toLowerCase()] || COL.lost, note: nf(r.contactable) + ' messageable', drill: ['people_status', r.status] })))}</div>
        <div class="tp-card"><h3>What they asked for</h3><p class="n">By configuration.</p>${hbars(D.config.map((r) => ({ label: r.config, value: r.leads, color: COL.b, tip: `${r.config}: ${nf(r.hot)} Hot · ${nf(r.warm)} Warm · ${nf(r.cold)} Cold`, note: pc(r.leads / k.rows), drill: ['config', r.config] })))}</div></div>

      <h2 class="tp-h">Did telecalling sell flats?</h2><p class="tp-sub">Matched against the CRM bookings by phone number (and, for masked numbers, the last 4 digits and the name). ${nf(b.matched)} of ${nf(b.buyers)} buyers appear (${nf(b.confirmed)} by number, ${nf(b.probable)} by last digits and name); ${nf(b.before)} were logged before they booked${b.days_median != null ? `, typically ${nf(b.days_median)} days before` : ''}. ${nf(b.not_found)} buyers never appear.</p>
      <div class="tp-g3"><div class="tp-card"><h3>Buyers and the telecalling</h3>${hbars([{ label: 'Called before booking', value: b.before, color: COL.a, drill: ['buyers'] }, { label: 'Logged after booking', value: b.after, color: COL.warm, drill: ['buyers_after'] }, { label: 'Matched by last digits and name', value: b.probable != null ? b.probable : b.name_only, color: COL.lost, drill: ['buyers_name'] }, { label: 'Not in the telecalling', value: b.not_found, color: COL.bad, drill: ['buyers_none'] }])}</div>
        <div class="tp-card"><h3>Booking rate by lead tag</h3><p class="n">Buyers per 1,000 people with that tag.</p>${hbars(D.bk_status.map((r) => ({ label: r.status, value: r.rate * 1000, color: COL[r.status.toLowerCase()] || COL.lost, note: `${nf(r.buyers)} of ${nf(r.people)}`, drill: ['buyers_tag', r.status] })), (v) => v.toFixed(1))}</div>
        <div class="tp-card"><h3>Booking rate by configuration</h3><p class="n">Buyers per 1,000 people asking for it.</p>${hbars(D.bk_config.map((r) => ({ label: r.config, value: r.rate * 1000, color: COL.b, note: `${nf(r.buyers)} of ${nf(r.people)}`, drill: ['buyers_config', r.config] })), (v) => v.toFixed(1))}</div></div>

      <h2 class="tp-h">Callers</h2><p class="tp-sub">${nf(k.callers)} callers: the top fifth produced ${pc(k.top20_share)} of the ${lead}, and ${nf(D.tenure.slice(0, 2).reduce((a, r) => a + r.callers, 0))} worked 15 days or less. Of ${nf(k.callers_50plus)} regular callers, ${nf(k.caller_hot_low)} tagged almost nobody Hot while ${nf(k.caller_hot_high)} tagged most leads Hot.</p>
      <div class="tp-g3"><div class="tp-card"><h3>How long callers stayed</h3>${hbars(D.tenure.map((r) => ({ label: r.bucket.replace('<=', 'up to '), value: r.callers, color: COL.cold, drill: ['tenure', r.bucket.replace('<=', 'up to ').replace('-', '–')] })))}</div>
        <div class="tp-card"><h3>Hot-tagging by caller</h3><p class="n">Callers with 50+ ${lead}, by the share they tagged Hot.</p>${hbars(D.caller_hot_bands.map((r) => ({ label: r.bucket, value: r.callers, color: COL.hot, drill: ['hotband', r.bucket] })))}</div>
        <div class="tp-card"><h3>Callers whose leads booked</h3><p class="n">${nf(b.callers_with_buyer)} callers had at least one lead who later booked.</p>${hbars(D.bk_callers.slice(0, 8).map((r) => ({ label: r.caller, value: r.buyers, color: COL.a, note: `of ${nf(r.leads)}`, drill: ['buyers_caller', r.caller] })))}</div></div>
      <div class="tp-card"><div class="tp-tools"><h3 style="margin:0;flex:1">Caller scorecard</h3><input id="tpQ" placeholder="Find a caller" value="${esc(S.q)}"><button class="ghost small" id="tpCsv">Download (CSV)</button></div><p class="n" style="margin:0 0 6px">Click a caller for every lead they logged.</p><div id="tpCallers"></div></div>

      <h2 class="tp-h">Channel partners${D.sms.length ? ' and sourcing managers' : ''}</h2><p class="tp-sub">${nf(k.cps)} partner firms${D.sms.length ? ` through ${nf(k.sms)} sourcing managers` : ''}. <a href="#" ${dr('repeat')}>${nf(k.phones_multi_cp)} numbers</a> were logged under two or more firms, the start of brokerage disputes.</p>
      <div class="tp-card"><div class="tp-tools"><h3 style="margin:0;flex:1">Partner firm scorecard</h3><input id="tpCQ" placeholder="Find a firm" value="${esc(S.cpQ)}"><button class="ghost small" id="tpCCsv">Download (CSV)</button></div><div id="tpCps"></div></div>
      ${D.sms.length ? `<div class="tp-card"><h3>Sourcing managers</h3><div class="tp-scroll"><table class="tp-t"><tr><th>Sourcing manager</th><th class="r">Leads</th><th class="r">Partner firms</th><th class="r">Hot</th><th class="r">Hot %</th></tr>${D.sms.map((r) => `<tr ${dr('sm', r.sm)}><td>${esc(r.sm)}</td><td class="r">${nf(r.leads)}</td><td class="r">${nf(r.cps)}</td><td class="r">${nf(r.hot)}</td><td class="r">${pc(r.hot_share, 1)}</td></tr>`).join('')}</table></div></div>` : ''}

      ${F ? `<h2 class="tp-h">Where leads and buyers live</h2><p class="tp-sub">The sheet has no address column, so areas come from the remarks: only ${nf(F.kpis[0].loc_tagged)} leads mention one. Buyer areas come from the CRM.</p>
      <div class="tp-g2"><div class="tp-card"><h3>Lead areas (from remarks)</h3>${hbars(F.zones.map((r) => ({ label: r.zone, value: r.mentions, color: COL.cold, tip: `${r.zone}: ${pc(r.hot_share)} Hot · ${pc(r.bhk2plus_share)} want 2 BHK or larger` })))}</div>
        <div class="tp-card"><h3>Buyer areas (CRM)</h3>${hbars(F.bk_zone.map((r) => ({ label: r.area, value: r.buyers, color: COL.a })))}</div></div>
      <h2 class="tp-h">Re-using the pool for the next launch</h2>
      <div class="tp-g2"><div class="tp-card"><h3>Priority tiers</h3><p class="n">Distinct people by tier; messageable now vs reachable only through the partner.</p><div class="tp-scroll"><table class="tp-t"><tr><th>Tier</th><th class="r">People</th><th class="r">Messageable</th><th class="r">Masked / invalid</th></tr>${F.tiers.map((r) => `<tr><td>${esc(r.tier)}</td><td class="r">${nf(r.people)}</td><td class="r">${nf(r.contactable)}</td><td class="r">${nf(r.masked_or_invalid)}</td></tr>`).join('')}</table></div></div>
        <div class="tp-card"><h3>What we learnt</h3>
          <div class="tp-lesson"><span>1</span><div>Message first, call second: one WhatsApp to the ${nf(k.unique_full)} numbers costs about ${cr(k.unique_full * k.wa_rate)} before GST; call only those who reply.</div></div>
          <div class="tp-lesson"><span>2</span><div>Partners upload full numbers through the partner portal; nobody else sees them, so there is no reason to mask.</div></div>
          <div class="tp-lesson"><span>3</span><div>First upload owns the client for a fixed period: double claims settle themselves.</div></div>
          <div class="tp-lesson"><span>4</span><div>A small core team ranked on site visits, not 100+ callers paid by the day.</div></div>
          <div class="tp-lesson"><span>5</span><div>Locality, budget and purpose compulsory, one written meaning of Hot / Warm / Cold, and no "." as a remark (${pc(k.junk_remarks / k.rows)} of remarks were blank).</div></div></div></div>` : ''}
      <div id="tpLoad"></div>
      <p class="small muted">${calls ? 'From the call results entered in the ERP.' : live ? `From the telecalling sheet loaded into the ERP (${nf(R.loaded)} rows), matched against the CRM bookings.` : 'Source: Dream India TC leads till date.xlsx, matched against the Developer\'s Bookings sheet; figures as finalised.'} Cost uses ${calls ? 'each caller\'s daily rate (₹' + nf(R.rate) + ' where none is set)' : '₹' + nf(R.rate) + ' per caller per day'}.</p></div>`;
    callersTable(); cpsTable(); tips($('.tp', H));
    H.querySelector('.tp').addEventListener('click', (e) => { const t = e.target.closest('[data-drill]'); if (!t) return; e.preventDefault(); drill(t.dataset.drill, t.dataset.val); });
    $('#tpQ', H).oninput = (e) => { S.q = e.target.value; callersTable(); };
    $('#tpCQ', H).oninput = (e) => { S.cpQ = e.target.value; cpsTable(); };
    $('#tpCsv', H).onclick = () => csv('callers.csv', ['Caller', 'Leads', 'Days', 'Leads per day', 'Hot %', 'Blank remark %', 'Full number %', 'Partner firms', 'First day', 'Last day', 'Cost (₹)'], D.callers.map((r) => [r.caller, r.leads, r.days, r.per_day, (r.hot_share * 100).toFixed(1), (r.junk_share * 100).toFixed(1), (r.full_share * 100).toFixed(1), r.cps, r.first, r.last, r.cost != null ? r.cost : r.days * R.rate]));
    $('#tpCCsv', H).onclick = () => csv('partner-firms.csv', ['Partner firm', 'Leads', 'Hot', 'Hot %', 'Masked %', 'Callers'], D.cps.map((r) => [r.cp, r.leads, r.hot, (r.hot_share * 100).toFixed(1), (r.masked_share * 100).toFixed(1), r.callers]));
    if (R.canLoad && !calls) loader();
  }

  function table(host, rows, cols, sortKey, dir, onSort, all, onAll, drillKey, keyCol) {
    const sorted = [...rows].sort((a, b) => (typeof a[sortKey] === 'string' ? String(a[sortKey]).localeCompare(String(b[sortKey])) : (+a[sortKey] || 0) - (+b[sortKey] || 0)) * dir);
    const show = all ? sorted : sorted.slice(0, 25);
    host.innerHTML = `<div class="tp-scroll"><table class="tp-t"><tr>${cols.map(([k, l, r]) => `<th data-s="${k}" class="${r ? 'r' : ''}">${l}${sortKey === k ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>${show.map((x) => `<tr ${dr(drillKey, x[keyCol])}>${cols.map(([k, , r, f]) => `<td class="${r ? 'r' : ''}">${f ? f(x[k], x) : esc(x[k])}</td>`).join('')}</tr>`).join('')}</table></div>
      ${rows.length > 25 ? `<p class="small" style="margin:8px 0 0"><a href="#" data-all>${all ? 'Show the top 25' : `Show all ${nf(rows.length)}`}</a></p>` : ''}`;
    $$('[data-s]', host).forEach((th) => (th.onclick = (e) => { e.stopPropagation(); onSort(th.dataset.s); }));
    const a = $('[data-all]', host); if (a) a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAll(); };
  }
  function callersTable() {
    const q = S.q.trim().toLowerCase(), rows = D.callers.filter((r) => !q || r.caller.toLowerCase().includes(q)).map((r) => ({ ...r, cost: r.cost != null ? r.cost : r.days * R.rate }));
    table($('#tpCallers', H), rows, [['caller', 'Caller'], ['leads', 'Leads', 1, nf], ['days', 'Days', 1, nf], ['per_day', 'Leads/day', 1, (v) => v], ['hot_share', 'Hot %', 1, (v) => pc(v, 1)], ['junk_share', 'Blank remarks', 1, (v) => pc(v, 1)], ['full_share', 'Full number %', 1, (v) => pc(v, 1)], ['cps', 'Firms', 1, nf], ['first', 'First day', 0, dmy], ['last', 'Last day', 0, dmy], ['cost', 'Cost', 1, (v) => '₹' + nf(v)]],
      S.sort, S.dir, (k) => { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } callersTable(); }, S.all || !!q, () => { S.all = !S.all; callersTable(); }, 'caller', 'caller');
  }
  function cpsTable() {
    const q = S.cpQ.trim().toLowerCase(), rows = D.cps.filter((r) => !q || r.cp.toLowerCase().includes(q));
    table($('#tpCps', H), rows, [['cp', 'Partner firm'], ['leads', 'Leads', 1, nf], ['hot', 'Hot', 1, nf], ['hot_share', 'Hot %', 1, (v) => pc(v, 1)], ['masked_share', 'Masked numbers', 1, (v) => pc(v)], ['callers', 'Callers', 1, nf]],
      S.cpSort, S.cpDir, (k) => { if (S.cpSort === k) S.cpDir = -S.cpDir; else { S.cpSort = k; S.cpDir = -1; } cpsTable(); }, S.cpAll || !!q, () => { S.cpAll = !S.cpAll; cpsTable(); }, 'cp', 'cp');
  }

  window.TcPerf = { render };
})();
