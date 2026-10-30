// Dream Signature pre-launch telecalling, completed: the final results (20,683 leads, 26 Feb 2025 – 14 Oct 2026) from the
// telecalling sheet, matched against the CRM bookings. Read-only figures served by /api/tm?dsResults=1.
// Mounted by app.js: window.TcPerf.render(ctx).
(function () {
  const RATE = 1000; // ₹ per caller per day, as paid for Dream Signature telecalling
  let C = null, D = null, S = { sort: 'leads', dir: -1, q: '', cpSort: 'leads', cpDir: -1, cpQ: '', all: false, cpAll: false };
  const css = `
  .tp{--ink:#10114e;--mut:#667085;--line:#EAECF0;--soft:#F7F7FB}
  .tp .tp-hero{background:radial-gradient(900px 300px at 90% -40%,#14B8A6 0,transparent 60%),linear-gradient(135deg,#0B3B4A,#140C59);color:#fff;border-radius:20px;padding:22px 24px;margin:0 0 16px}
  .tp .tp-hero h1{color:#fff;margin:2px 0 6px;font-size:26px}.tp .tp-hero p{margin:0;color:#CFF5EF;font-size:14px;max-width:880px;line-height:1.5}.tp .tp-hero b{color:#fff}
  .tp .tp-eye{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#99F6E4;font-weight:700}.tp .tp-done{display:inline-block;background:#ffffff22;border:1px solid #ffffff44;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;margin-left:8px;vertical-align:middle}
  .tp .tp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
  .tp .tp-kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px}.tp .tp-kpi span{display:block;font-size:13px;color:var(--mut)}.tp .tp-kpi b{display:block;font-size:24px;color:var(--ink);margin:4px 0 2px;letter-spacing:-.02em}.tp .tp-kpi small{font-size:12px;color:var(--mut)}
  .tp .tp-kpi.warn{border-color:#FEC84B;background:#FFFCF5}.tp .tp-kpi.bad{border-color:#FDA29B;background:#FFFBFA}
  .tp h2.tp-h{font-size:17px;color:var(--ink);margin:22px 0 4px}.tp p.tp-sub{color:var(--mut);font-size:14px;margin:0 0 12px;max-width:900px;line-height:1.5}
  .tp .tp-g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.tp .tp-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}@media(max-width:900px){.tp .tp-g2,.tp .tp-g3{grid-template-columns:1fr}.tp .tp-hero h1{font-size:21px}}
  .tp{overflow-wrap:anywhere}.tp .tp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px;min-width:0}.tp .tp-card h3{margin:0 0 4px;font-size:15px;color:var(--ink)}.tp .tp-card .n{font-size:13px;color:var(--mut);margin:0 0 10px;line-height:1.45}
  .tp .hb{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:10px;align-items:center;font-size:13px;margin:6px 0}.tp .hb .t{height:12px;background:var(--soft);border-radius:99px;overflow:hidden}.tp .hb .t i{display:block;height:100%;border-radius:99px}.tp .hb b{font-variant-numeric:tabular-nums;color:var(--ink)}
  .tp .tp-chart{width:100%}.tp .tp-chart text{font-size:11px;fill:#667085}.tp .tp-chart .v{fill:#10114e;font-weight:700}
  .tp .tp-scroll{overflow-x:auto}.tp table.tp-t{width:100%;border-collapse:collapse;font-size:13px}.tp table.tp-t th{text-align:left;font-size:12px;color:var(--mut);font-weight:700;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer}.tp table.tp-t td{padding:7px 8px;border-bottom:1px solid var(--line)}.tp table.tp-t .r{text-align:right;font-variant-numeric:tabular-nums}
  .tp .tp-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.tp .tp-tools input{max-width:240px;margin:0}
  .tp .tp-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin:0 0 6px}.tp .tp-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .tp .tp-lesson{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:14px;line-height:1.5}.tp .tp-lesson:first-of-type{border-top:0}.tp .tp-lesson span{width:24px;height:24px;border-radius:50%;background:#0E8C9B;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center}
  .tp-tip{position:fixed;pointer-events:none;background:#10114e;color:#fff;font-size:12px;padding:6px 8px;border-radius:8px;z-index:70;white-space:nowrap}
  `;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-IN'));
  const cr = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(1) + ' L' : '₹' + nf(n));
  const pc = (x, d = 0) => (x == null ? '–' : (x * 100).toFixed(d) + '%');
  const dmy = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const MON = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const COL = { a: '#0E8C9B', b: '#7A5AF8', hot: '#E1306C', warm: '#E8A200', cold: '#2E90FA', lost: '#98A2B3', bad: '#D92D20' };

  // horizontal bars: rows [{label, value, color?, note?}]
  const hbars = (rows, fmt = nf) => { const mx = Math.max(1, ...rows.map((r) => +r.value || 0)); return rows.map((r) => `<div class="hb" data-tip="${esc(r.tip || '')}"><span>${esc(r.label)}</span><div class="t"><i style="width:${Math.max(1, ((+r.value || 0) / mx) * 100)}%;background:${r.color || COL.a}"></i></div><b>${fmt(r.value)}${r.note ? ` <span class="muted" style="font-weight:400">${esc(r.note)}</span>` : ''}</b></div>`).join(''); };
  // vertical bars over months (one series), with a hover note per bar
  function vbars(rows, key, color, tipOf) {
    const W = 680, H = 210, B = 22, T = 18, n = rows.length, mx = Math.max(1, ...rows.map((r) => +r[key] || 0)), slot = W / n, bw = Math.min(26, slot - 6);
    const y = (v) => H - B - ((+v || 0) / mx) * (H - B - T);
    let g = `<line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="#EAECF0"/>`;
    const im = rows.reduce((a, r, i) => ((+r[key] || 0) > (+rows[a][key] || 0) ? i : a), 0);
    rows.forEach((r, i) => {
      const x = i * slot + (slot - bw) / 2, top = y(r[key]), h = H - B - top, tip = esc(tipOf(r));
      if (h > 0) g += `<path d="M${x},${H - B}V${top + Math.min(4, h)}q0,-4 4,-4h${Math.max(0, bw - 8)}q4,0 4,4V${H - B}Z" fill="${color}"/>`;
      g += `<rect x="${i * slot}" y="${T}" width="${slot}" height="${H - B - T}" fill="transparent" data-tip="${tip}"/>`;
      if (i % Math.ceil(n / 10) === 0) g += `<text x="${i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${MON(r.month)}</text>`;
    });
    g += `<text class="v" x="${im * slot + slot / 2}" y="${y(rows[im][key]) - 5}" text-anchor="middle">${nf(rows[im][key])}</text>`;
    return `<svg class="tp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
  }
  function tips(root) {
    let tip = null;
    root.addEventListener('mousemove', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t || !t.dataset.tip) { if (tip) tip.style.display = 'none'; return; } if (!tip) { tip = document.createElement('div'); tip.className = 'tp-tip'; document.body.appendChild(tip); } tip.textContent = t.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 220, e.clientX + 12) + 'px'; tip.style.top = e.clientY - 34 + 'px'; });
    root.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
  }
  function csv(name, head, rows) {
    const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function render(ctx) {
    C = ctx;
    if (!$('#tp-css')) { const st = document.createElement('style'); st.id = 'tp-css'; st.textContent = css; document.head.appendChild(st); }
    $('#page').innerHTML = '<div class="tp"><p class="muted">Loading…</p></div>';
    D = await C.api('/api/tm?dsResults=1');
    paint();
  }

  function paint() {
    const k = D.kpis[0], b = D.bk_kpis[0], cost = k.caller_days * RATE;
    const st = Object.fromEntries(D.status.map((r) => [r.status, r]));
    $('#page').innerHTML = `<div class="tp">
      <div class="tp-hero"><span class="tp-eye">Dream Signature · Performance</span><h1>Pre-launch telecalling: final results <span class="tp-done">Completed</span></h1>
        <p>Telecalling logged <b>${nf(k.rows)}</b> leads from <b>${dmy(k.first_date)}</b> to <b>${dmy(k.last_date)}</b>. After removing repeats that is <b>${nf(k.unique_people)}</b> distinct people, but only <b>${nf(k.unique_full)}</b> have a full mobile number we can message today. The rest were masked by channel partners or entered wrongly. Of our <b>${nf(b.buyers)}</b> buyers, <b>${nf(b.before)}</b> were in the telecalling sheet before they booked.</p></div>

      <div class="tp-kpis">
        <div class="tp-kpi"><span>Leads logged</span><b>${nf(k.rows)}</b><small>every row in the sheet</small></div>
        <div class="tp-kpi"><span>Distinct people</span><b>${nf(k.unique_people)}</b><small>repeats merged</small></div>
        <div class="tp-kpi"><span>Messageable numbers</span><b>${nf(k.unique_full)}</b><small>unique full 10-digit mobiles</small></div>
        <div class="tp-kpi warn"><span>Masked by partners</span><b>${nf(k.masked_rows)}</b><small>${pc(k.masked_rows / k.rows)} of rows, last 4 digits only</small></div>
        <div class="tp-kpi"><span>Callers used</span><b>${nf(k.callers)}</b><small>peak ${nf(k.peak_callers)} on one day · ${k.avg_callers} on an average day</small></div>
        <div class="tp-kpi"><span>Caller-days worked</span><b>${nf(k.caller_days)}</b><small>over ${nf(k.days_active)} calling days</small></div>
        <div class="tp-kpi bad"><span>Leads per caller per day</span><b>${k.leads_per_caller_day}</b><small>logged interested leads, not dials</small></div>
        <div class="tp-kpi"><span>Telecaller cost</span><b>${cr(cost)}</b><small>caller-days × ₹${nf(RATE)} a day</small></div>
        <div class="tp-kpi"><span>Buyers called before booking</span><b>${nf(b.before)}</b><small>of ${nf(b.buyers)} buyers · ${pc(b.conv, 2)} of people called</small></div>
        <div class="tp-kpi warn"><span>Cost per traced buyer</span><b>${cr(cost / b.before)}</b><small>telecaller cost ÷ ${nf(b.before)} buyers</small></div>
        <div class="tp-kpi"><span>Agreement value of those buyers</span><b>${cr(b.val_before)}</b><small>${pc(b.val_share)} of all bookings (${cr(b.val_all)})</small></div>
        <div class="tp-kpi bad"><span>Booked through another partner</span><b>${nf(b.cp_diff)}</b><small>of ${nf(b.before)}: not the partner who first logged them</small></div>
      </div>

      <h2 class="tp-h">Calling activity</h2><p class="tp-sub">The sheet records interested leads, not every dial, so the true number of calls placed is not in the data. Almost all volume came in April–August 2025, before launch; after that only a small team kept calling.</p>
      <div class="tp-g2"><div class="tp-card"><h3>Leads logged per month</h3><p class="n">Hover a month for the callers active and leads tagged Hot.</p>${vbars(D.monthly, 'leads', COL.a, (r) => `${MON(r.month)}: ${nf(r.leads)} leads · ${nf(r.callers)} callers · ${nf(r.hot)} Hot`)}</div>
        <div class="tp-card"><h3>Leads by day of week</h3><p class="n">Monday is almost empty, which suggests a weekly off at the site. Plan callers and WhatsApp sends Tuesday to Sunday.</p>${hbars(D.dow.map((r) => ({ label: r.day, value: r.leads, color: r.day === 'Monday' ? COL.bad : COL.cold, tip: `${r.day}: ${nf(r.leads)} leads, ${nf(r.hot)} Hot` })))}</div></div>

      <h2 class="tp-h">Lead quality</h2><p class="tp-sub">Half the rows can't be messaged: partners masked the number. Lead temperature tags are not reliable either, because callers tagged very differently.</p>
      <div class="tp-g3"><div class="tp-card"><h3>Phone numbers</h3><p class="n">Rows by the kind of number recorded.</p>${hbars(D.phone_quality.map((r, i) => ({ label: r.type, value: r.rows, color: [COL.a, COL.warm, COL.bad][i], note: pc(r.rows / k.rows) })))}</div>
        <div class="tp-card"><h3>Lead temperature</h3><p class="n">Distinct people by their best tag; the second figure is how many can be messaged.</p>${hbars(D.status.map((r) => ({ label: r.status, value: r.people, color: COL[r.status.toLowerCase()] || COL.lost, note: nf(r.contactable) + ' messageable' })))}</div>
        <div class="tp-card"><h3>What they asked for</h3><p class="n">Leads by configuration.</p>${hbars(D.config.map((r) => ({ label: r.config, value: r.leads, color: COL.b, tip: `${r.config}: ${nf(r.hot)} Hot · ${nf(r.warm)} Warm · ${nf(r.cold)} Cold`, note: pc(r.leads / k.rows) })))}</div></div>

      <h2 class="tp-h">Did telecalling sell flats?</h2><p class="tp-sub">The telecalling sheet matched against the CRM bookings by phone number and name. ${nf(b.matched)} of ${nf(b.buyers)} buyers appear in it (${nf(b.confirmed)} confirmed, ${nf(b.probable)} probable); ${nf(b.before)} were logged before they booked, typically ${nf(b.days_median)} days before. ${nf(b.not_found)} buyers never appear.</p>
      <div class="tp-g3"><div class="tp-card"><h3>Buyers and the telecalling sheet</h3>${hbars([{ label: 'Called before booking', value: b.before, color: COL.a }, { label: 'Logged after booking', value: b.after, color: COL.warm }, { label: 'Name match only', value: b.name_only, color: COL.lost }, { label: 'Not in the sheet', value: b.not_found, color: COL.bad }])}</div>
        <div class="tp-card"><h3>Booking rate by lead tag</h3><p class="n">Buyers per 1,000 people with that tag. Hot leads booked about twice as often as Warm.</p>${hbars(D.bk_status.map((r) => ({ label: r.status, value: r.rate * 1000, color: COL[r.status.toLowerCase()] || COL.lost, note: `${nf(r.buyers)} of ${nf(r.people)}` })), (v) => v.toFixed(1))}</div>
        <div class="tp-card"><h3>Booking rate by configuration</h3><p class="n">Buyers per 1,000 people asking for it. 2 BHK enquiries converted best.</p>${hbars(D.bk_config.map((r) => ({ label: r.config, value: r.rate * 1000, color: COL.b, note: `${nf(r.buyers)} of ${nf(r.people)}` })), (v) => v.toFixed(1))}</div></div>

      <h2 class="tp-h">Callers</h2><p class="tp-sub">${nf(k.callers)} callers: the top fifth produced ${pc(k.top20_share)} of all leads, and ${nf(D.tenure.slice(0, 2).reduce((a, r) => a + r.callers, 0))} lasted 15 days or less. Of ${nf(k.callers_50plus)} regular callers, ${nf(k.caller_hot_low)} tagged almost nobody Hot while ${nf(k.caller_hot_high)} tagged most leads Hot.</p>
      <div class="tp-g3"><div class="tp-card"><h3>How long callers stayed</h3>${hbars(D.tenure.map((r) => ({ label: r.bucket.replace('<=', 'up to '), value: r.callers, color: COL.cold })))}</div>
        <div class="tp-card"><h3>Hot-tagging by caller</h3><p class="n">Callers with 50+ leads, by the share they tagged Hot.</p>${hbars(D.caller_hot_bands.map((r) => ({ label: r.bucket, value: r.callers, color: COL.hot })))}</div>
        <div class="tp-card"><h3>Callers whose leads booked</h3><p class="n">${nf(b.callers_with_buyer)} callers had at least one lead who later booked.</p>${hbars(D.bk_callers.slice(0, 8).map((r) => ({ label: r.caller, value: r.buyers, color: COL.a, note: `of ${nf(r.leads)} leads` })))}</div></div>
      <div class="tp-card"><div class="tp-tools"><h3 style="margin:0;flex:1">Caller scorecard</h3><input id="tpQ" placeholder="Find a caller" value="${esc(S.q)}"><button class="ghost small" id="tpCsv">Download (CSV)</button></div><div id="tpCallers"></div></div>

      <h2 class="tp-h">Channel partners and sourcing managers</h2><p class="tp-sub">${nf(k.cps)} partner firms brought leads through ${nf(k.sms)} sourcing managers. ${nf(k.phones_multi_cp)} numbers were logged under two or more firms, the start of brokerage disputes.</p>
      <div class="tp-card"><div class="tp-tools"><h3 style="margin:0;flex:1">Partner firm scorecard</h3><input id="tpCQ" placeholder="Find a firm" value="${esc(S.cpQ)}"><button class="ghost small" id="tpCCsv">Download (CSV)</button></div><div id="tpCps"></div></div>
      <div class="tp-card"><h3>Sourcing managers</h3><div class="tp-scroll"><table class="tp-t"><tr><th>Sourcing manager</th><th class="r">Leads</th><th class="r">Partner firms</th><th class="r">Hot</th><th class="r">Hot %</th></tr>${D.sms.map((r) => `<tr><td>${esc(r.sm)}</td><td class="r">${nf(r.leads)}</td><td class="r">${nf(r.cps)}</td><td class="r">${nf(r.hot)}</td><td class="r">${pc(r.hot_share, 1)}</td></tr>`).join('')}</table></div></div>

      <h2 class="tp-h">Where leads and buyers live</h2><p class="tp-sub">The sheet has no address column, so areas come from the remarks: only ${nf(k.loc_tagged)} leads mention one. Buyer areas come from the CRM.</p>
      <div class="tp-g2"><div class="tp-card"><h3>Lead areas (from remarks)</h3>${hbars(D.zones.map((r) => ({ label: r.zone, value: r.mentions, color: COL.cold, tip: `${r.zone}: ${pc(r.hot_share)} Hot · ${pc(r.bhk2plus_share)} want 2 BHK or larger` })))}</div>
        <div class="tp-card"><h3>Buyer areas (CRM)</h3>${hbars(D.bk_zone.map((r) => ({ label: r.area, value: r.buyers, color: COL.a })))}</div></div>

      <h2 class="tp-h">Re-using the pool for the next launch</h2>
      <div class="tp-g2"><div class="tp-card"><h3>Priority tiers</h3><p class="n">Distinct people by tier; messageable now vs reachable only through the partner.</p><div class="tp-scroll"><table class="tp-t"><tr><th>Tier</th><th class="r">People</th><th class="r">Messageable</th><th class="r">Masked / invalid</th></tr>${D.tiers.map((r) => `<tr><td>${esc(r.tier)}</td><td class="r">${nf(r.people)}</td><td class="r">${nf(r.contactable)}</td><td class="r">${nf(r.masked_or_invalid)}</td></tr>`).join('')}</table></div></div>
        <div class="tp-card"><h3>What we learnt</h3>
          <div class="tp-lesson"><span>1</span><div>Message first, call second: send one WhatsApp to the ${nf(k.unique_full)} numbers and call only those who reply (about ${cr(k.unique_full * k.wa_rate)} a send, before GST).</div></div>
          <div class="tp-lesson"><span>2</span><div>Partners upload full numbers through the partner portal; nobody else sees them, so there is no reason to mask.</div></div>
          <div class="tp-lesson"><span>3</span><div>First upload owns the client for a fixed period: the ${nf(k.phones_multi_cp)} double claims settle themselves.</div></div>
          <div class="tp-lesson"><span>4</span><div>A small core team ranked on site visits, not 100+ callers paid by the day.</div></div>
          <div class="tp-lesson"><span>5</span><div>Locality, budget and purpose made compulsory, one written meaning of Hot / Warm / Cold, and no "." as a remark (${pc(k.junk_remarks / k.rows)} of remarks were blank).</div></div></div></div>
      <p class="small muted">Source: Dream India TC leads till date.xlsx (${nf(k.rows)} rows), matched against the Developer's Bookings sheet. Figures fixed as at the end of the campaign. Cost uses ₹${nf(RATE)} per caller per day.</p></div>`;
    callersTable(); cpsTable(); tips($('#page .tp'));
    $('#tpQ').oninput = (e) => { S.q = e.target.value; callersTable(); };
    $('#tpCQ').oninput = (e) => { S.cpQ = e.target.value; cpsTable(); };
    $('#tpCsv').onclick = () => csv('dream-signature-callers.csv', ['Caller', 'Leads', 'Days', 'Leads per day', 'Hot %', 'Blank remark %', 'Full number %', 'Partner firms', 'First day', 'Last day', 'Cost (₹)'], D.callers.map((r) => [r.caller, r.leads, r.days, r.per_day, (r.hot_share * 100).toFixed(1), (r.junk_share * 100).toFixed(1), (r.full_share * 100).toFixed(1), r.cps, r.first, r.last, r.days * RATE]));
    $('#tpCCsv').onclick = () => csv('dream-signature-partner-firms.csv', ['Partner firm', 'Leads', 'Hot', 'Hot %', 'Masked %', 'Callers'], D.cps.map((r) => [r.cp, r.leads, r.hot, (r.hot_share * 100).toFixed(1), (r.masked_share * 100).toFixed(1), r.callers]));
  }

  function table(host, rows, cols, sortKey, dir, onSort, all, onAll) {
    const sorted = [...rows].sort((a, b) => (typeof a[sortKey] === 'string' ? String(a[sortKey]).localeCompare(String(b[sortKey])) : (+a[sortKey] || 0) - (+b[sortKey] || 0)) * dir);
    const show = all ? sorted : sorted.slice(0, 25);
    host.innerHTML = `<div class="tp-scroll"><table class="tp-t"><tr>${cols.map(([k, l, r]) => `<th data-s="${k}" class="${r ? 'r' : ''}">${l}${sortKey === k ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>${show.map((x) => `<tr>${cols.map(([k, , r, f]) => `<td class="${r ? 'r' : ''}">${f ? f(x[k], x) : esc(x[k])}</td>`).join('')}</tr>`).join('')}</table></div>
      ${rows.length > 25 ? `<p class="small" style="margin:8px 0 0"><a href="#" data-all>${all ? 'Show the top 25' : `Show all ${nf(rows.length)}`}</a></p>` : ''}`;
    $$('[data-s]', host).forEach((th) => (th.onclick = () => onSort(th.dataset.s)));
    const a = $('[data-all]', host); if (a) a.onclick = (e) => { e.preventDefault(); onAll(); };
  }
  function callersTable() {
    const q = S.q.trim().toLowerCase(), rows = D.callers.filter((r) => !q || r.caller.toLowerCase().includes(q)).map((r) => ({ ...r, cost: r.days * RATE }));
    table($('#tpCallers'), rows, [['caller', 'Caller'], ['leads', 'Leads', 1, nf], ['days', 'Days', 1, nf], ['per_day', 'Leads/day', 1, (v) => v], ['hot_share', 'Hot %', 1, (v) => pc(v, 1)], ['junk_share', 'Blank remarks', 1, (v) => pc(v, 1)], ['full_share', 'Full number %', 1, (v) => pc(v, 1)], ['cps', 'Firms', 1, nf], ['first', 'First day', 0, dmy], ['last', 'Last day', 0, dmy], ['cost', 'Cost', 1, (v) => '₹' + nf(v)]],
      S.sort, S.dir, (k) => { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } callersTable(); }, S.all || !!q, () => { S.all = !S.all; callersTable(); });
  }
  function cpsTable() {
    const q = S.cpQ.trim().toLowerCase(), rows = D.cps.filter((r) => !q || r.cp.toLowerCase().includes(q));
    table($('#tpCps'), rows, [['cp', 'Partner firm'], ['leads', 'Leads', 1, nf], ['hot', 'Hot', 1, nf], ['hot_share', 'Hot %', 1, (v) => pc(v, 1)], ['masked_share', 'Masked numbers', 1, (v) => pc(v)], ['callers', 'Callers', 1, nf]],
      S.cpSort, S.cpDir, (k) => { if (S.cpSort === k) S.cpDir = -S.cpDir; else { S.cpSort = k; S.cpDir = -1; } cpsTable(); }, S.cpAll || !!q, () => { S.cpAll = !S.cpAll; cpsTable(); });
  }

  window.TcPerf = { render };
})();
