// Pre-sales & Sales (/leads): the caller's and the sales person's lists, one lead's calls, and the call form.
// Data: /api/leads. Pre-sales sees every lead; a sales person sees the leads handed to them.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { d: null, tab: null, proj: 'all', q: '' };
  const SRC = { ivr: 'IVR call', website: 'Website', instagram: 'Instagram', facebook: 'Facebook', meta_ads: 'Meta ad form', google_ads: 'Google Ads', whatsapp: 'WhatsApp', '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', walk_in: 'Walk-in', referral: 'Referral', channel_partner: 'Channel partner', telecalling: 'Telecalling', hoarding: 'Hoarding', event: 'Event', youtube: 'YouTube', other: 'Other' };
  const BHK = ['1 BHK', '2 BHK', '3 BHK', '4 BHK or more', 'Shop', 'Office', 'Not sure'];
  const PURPOSE = ['Own use', 'Investment', 'Both'];
  const WHEN = ['Right away', 'Within 3 months', '3 to 6 months', '6 to 12 months', 'Just looking'];
  const day = (x) => (x ? String(x).slice(0, 10) : '');
  const nice = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
  const toast = (m) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); };

  async function api(body, q = '') {
    const r = await fetch('/api/leads' + q, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/?next=/leads'; throw new Error('Please sign in.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.mustChange || j.ndaRequired) location.href = '/'; throw new Error(j.error || 'That did not work.'); }
    return j;
  }

  // ---------- the lists ----------
  const open = (l) => ['new', 'contacted', 'visit'].includes(l.status);
  const fresh = (l) => Date.now() - Date.parse(l.created_at) < 7 * 864e5; // a lead goes cold fast: the last 7 days come first
  // where a lead stands with sales: new from pre-sales → visit booked → visited → offer → won / lost
  const stage = (l) => (l.status === 'booked' ? 'won' : l.status === 'lost' ? 'lost' : l.offer && ['given', 'pending', 'approved'].includes(l.offer.status) ? 'offer' : l.visit_at ? 'visited' : l.visit_date ? 'visit' : 'new');
  function tabs() {
    const t = S.d.today, all = S.d.me.all;
    const T = all ? [
      ['now', 'Call now', (l) => l.status === 'new' && !l.first_contact_at && !l.handed_to && fresh(l)],
      ['today', 'Call today', (l) => open(l) && l.first_contact_at && l.next_date && day(l.next_date) <= t && !(l.visit_date && day(l.visit_date) === t)],
      ['visits', 'Site visits', (l) => open(l) && l.visit_date && day(l.visit_date) >= t],
      ['follow', 'Follow-ups', (l) => open(l) && l.first_contact_at && !l.handed_to && !(l.next_date && day(l.next_date) <= t)],
      ['sales', 'With sales', (l) => open(l) && l.handed_to],
      ['old', 'Older, never called', (l) => l.status === 'new' && !l.first_contact_at && !l.handed_to && !fresh(l)],
      ['closed', 'Booked / lost', (l) => !open(l)],
    ] : [
      // the sales person's pipeline: only the leads handed to him
      ['s_new', 'New from pre-sales', (l) => open(l) && stage(l) === 'new'],
      ['s_visit', 'Site visits', (l) => open(l) && stage(l) === 'visit'],
      ['s_visited', 'Visited', (l) => open(l) && stage(l) === 'visited'],
      ['s_offer', 'Offers', (l) => open(l) && stage(l) === 'offer'],
      ['today', 'Follow-ups due', (l) => open(l) && l.next_date && day(l.next_date) <= t],
      ['won', 'Booked', (l) => l.status === 'booked'],
      ['lost', 'Lost', (l) => l.status === 'lost'],
    ];
    if (S.d.me.approver && S.d.approvals.length) T.unshift(['appr', `Discounts to approve`, (l) => S.d.approvals.some((a) => a.lead_id === l.id)]);
    return T;
  }

  function draw() {
    const d = S.d, T = tabs();
    if (!S.tab || !T.some((x) => x[0] === S.tab)) S.tab = T[0][0];
    $('#proj').innerHTML = `<option value="all">All projects</option>${d.projects.map((p) => `<option value="${p.id}" ${String(S.proj) === String(p.id) ? 'selected' : ''}>${e(p.name)}</option>`).join('')}<option value="none" ${S.proj === 'none' ? 'selected' : ''}>Project not known yet</option>`;
    const q = S.q.toLowerCase().replace(/\s/g, '');
    const base = d.leads.filter((l) => (S.proj === 'all' || (S.proj === 'none' ? !l.project_id : String(l.project_id) === String(S.proj))) && (!q || `${l.name || ''}${l.phone || ''}${l.email || ''}`.toLowerCase().replace(/\s/g, '').includes(q)));
    $('#tabs').innerHTML = T.map(([k, n, f]) => `<button class="btn ${S.tab === k ? 'on' : ''}" data-tab="${k}">${n}<small>${base.filter(f).length}</small></button>`).join('');
    const f = T.find((x) => x[0] === S.tab)[2];
    let rows = base.filter(f);
    if (S.tab === 'visits') rows.sort((a, b) => day(a.visit_date).localeCompare(day(b.visit_date)));
    else if (S.tab === 'today') rows.sort((a, b) => day(a.next_date).localeCompare(day(b.next_date)));
    else if (S.tab === 'now') rows.sort((a, b) => b.created_at.localeCompare(a.created_at)); // newest first: the warmest leads
    $('#list').innerHTML = rows.length ? rows.slice(0, 300).map(row).join('') + (rows.length > 300 ? `<p class="empty">and ${rows.length - 300} more: search or pick a project.</p>` : '') : `<div class="empty">${S.tab === 'now' ? 'Nobody waiting for a call. Well done.' : 'Nothing here.'}</div>`;
    stats();
  }

  function row(l) {
    const q = l.qualify || {};
    const what = [l.project, q.bhk, q.budget].filter(Boolean).join(' · ') || 'Project not known yet';
    const src = (l.sources && l.sources.length ? l.sources : [l.source]).map((s) => SRC[s] || s).join(', ');
    let right = '';
    if (S.tab === 'now' || S.tab === 'old') { const h = (Date.now() - Date.parse(l.created_at)) / 36e5; right = `<span class="chip ${h > 2 ? 'bad' : h > 0.25 ? 'warn' : 'good'}">waiting ${ago(l.created_at)}</span>`; }
    else if (l.status === 'booked') right = '<span class="chip good">Booked</span>';
    else if (l.offer && l.offer.status === 'pending') right = `<span class="chip warn">Discount ${Number(l.offer.discount_pct).toFixed(1)}% waiting</span>`;
    else if (l.offer && ['given', 'approved'].includes(l.offer.status)) right = `<span class="chip good">Offer ${e(l.offer.unit_no)}${l.offer.status === 'approved' ? ' ✓' : ''}</span>${l.hold_unit ? `<div>held till ${when(l.hold_until)}</div>` : ''}`;
    else if (l.status === 'lost') right = `<span class="chip">Lost</span>`;
    else if (l.visit_date && day(l.visit_date) >= S.d.today) right = `<span class="chip good">Visit ${nice(day(l.visit_date))}</span>`;
    else if (l.next_date) right = `<span class="chip ${day(l.next_date) < S.d.today ? 'warn' : ''}">Call ${day(l.next_date) === S.d.today ? 'today' : nice(day(l.next_date))}</span>`;
    const who = S.d.me.all && l.handed_name ? `<div>with ${e(l.handed_name)}</div>` : '';
    return `<div class="row" data-id="${l.id}"><div class="who"><b>${e(l.name || l.phone || l.email)}</b><div class="s">${l.name && l.phone ? e(l.phone) + ' · ' : ''}${e(what)}</div><div class="s">${e(src)} · came in ${when(l.created_at)}${l.calls ? ` · ${l.calls} call${l.calls > 1 ? 's' : ''}` : ''}${l.is_buyer ? ' · <b style="color:var(--good)">Buyer in CRM ✓</b>' : ''}</div>${l.last_note ? `<div class="s">“${e(l.last_note)}”</div>` : ''}</div><div class="right">${right}${who}</div></div>`;
  }

  function stats() {
    const s = S.d.summary;
    if (!s) { $('#stats').innerHTML = ''; return; }
    const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
    // the whole journey, last 30 days: each step with how many of the step before made it
    const steps = [['Leads', s.leads], ['Called', s.called], ['Site visits', s.visits], ['Offers', s.offers], ['Bookings', s.booked]];
    $('#stats').innerHTML = `<div class="stats">${steps.map(([n, v], i) => `<div class="stat"><b>${v}</b><span>${n}${i ? ` · ${pct(v, steps[i - 1][1])} of ${steps[i - 1][0].toLowerCase()}` : ', last 30 days'}</span></div>`).join('')}
      <div class="stat"><b>${pct(s.fast, s.leads)}</b><span>called within 15 min</span></div></div>
      <details style="margin:-4px 0 12px"><summary style="cursor:pointer;color:var(--mut);font-size:13px">By source, by sales person, why we lose</summary>
      ${s.bySource.length ? `<table class="src"><tr><td><b>Source</b></td><td>Leads</td><td>Visits</td><td>Booked</td></tr>${s.bySource.map((x) => `<tr><td>${e(SRC[x.source] || x.source)}</td><td>${x.leads}</td><td>${x.visits}</td><td>${x.booked}</td></tr>`).join('')}</table>` : ''}
      ${s.bySales.length ? `<table class="src" style="margin-top:10px"><tr><td><b>Sales (90 days)</b></td><td>Handed</td><td>Visits</td><td>Offers</td><td>Booked</td><td>Lost</td><td>Overdue</td></tr>${s.bySales.map((x) => `<tr><td>${e(x.name)}</td><td>${x.handed}</td><td>${x.visits}</td><td>${x.offers}</td><td>${x.booked}</td><td>${x.lost}</td><td>${x.overdue ? `<b style="color:var(--bad)">${x.overdue}</b>` : 0}</td></tr>`).join('')}</table>` : ''}
      ${s.lost.length ? `<table class="src" style="margin-top:10px"><tr><td><b>Why lost (90 days)</b></td><td></td></tr>${s.lost.map((x) => `<tr><td>${e(x.reason)}</td><td>${x.n}</td></tr>`).join('')}</table>` : ''}
      </details>`;
  }

  // ---------- one lead ----------
  async function openLead(id) {
    const j = await api(null, '?id=' + id).catch((x) => { toast(x.message); return null; }); if (!j) return;
    const l = j.lead, q = l.qualify || {}, me = S.d.me;
    const sel = (name, opts, v) => `<select name="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${e(o)}</option>`).join('')}${v && !opts.includes(v) ? `<option selected>${e(v)}</option>` : ''}</select>`;
    const sales = S.d.people.filter((p) => p.role === 'sales');
    const evs = j.events.map((x) => `<div class="ev"><div class="t">${when(x.at)} · ${e(x.who || '')}</div><b>${e(x.kind === 'call' ? S.d.outcomes[x.outcome] || x.outcome : x.kind === 'handover' ? 'Handed over to ' + ((x.data && x.data.toName) || 'sales') + (x.data && x.data.visitDate ? ', visit ' + nice(x.data.visitDate) : '') : x.kind === 'assign' ? 'Reassigned' : x.kind === 'offer' ? 'Offer' : x.kind === 'hold' ? 'Flat held' : x.kind === 'booking' ? (x.outcome === 'rejected' ? 'Booking not approved' : 'Booked') : 'Note')}</b>${x.note ? ' — ' + e(x.note) : ''}${x.data && x.data.next ? `<div class="t">Next call ${nice(x.data.next)}</div>` : ''}</div>`).join('');
    const p = document.createElement('div'); p.className = 'panel';
    p.innerHTML = `<div class="sheet">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h2>${e(l.name || l.phone || l.email)}</h2>
        <div style="color:var(--mut);font-size:13px">${e(l.phone || '')}${l.email ? ' · ' + e(l.email) : ''}<br>${e((l.sources && l.sources.length ? l.sources : [l.source]).map((s) => SRC[s] || s).join(', '))} · came in ${when(l.created_at)}${l.first_contact_at ? ` · first called ${when(l.first_contact_at)}` : ' · <b style="color:var(--bad)">not called yet</b>'}${l.handed_name ? `<br>With ${e(l.handed_name)} since ${when(l.handed_at)}` : l.assigned_name ? `<br>${e(l.assigned_name)} calls this lead` : ''}</div></div>
        <button class="btn" data-close>Close</button></div>
      ${l.phone ? `<div style="display:flex;gap:8px;margin:12px 0 0"><a class="btn pri" href="tel:+91${e(l.phone)}" style="flex:1;text-align:center">📞 Call</a><a class="btn" href="https://wa.me/91${e(l.phone)}" target="_blank" rel="noopener" style="flex:1;text-align:center">💬 WhatsApp</a></div>` : ''}
      <form id="call">
      <div class="box"><h3>What they told you</h3><div class="grid2">
        <div><label>Name</label><input name="name" value="${e(l.name || '')}"></div>
        <div><label>Email</label><input name="email" value="${e(l.email || '')}"></div>
        <div><label>Project</label><select name="projectId"><option value="">Not known yet</option>${S.d.projects.map((x) => `<option value="${x.id}" ${l.project_id === x.id ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
        <div><label>Looking for</label>${sel('bhk', BHK, q.bhk)}</div>
        <div><label>Budget</label><input name="budget" value="${e(q.budget || '')}" placeholder="e.g. 1.5 – 2 Cr"></div>
        <div><label>Buying for</label>${sel('purpose', PURPOSE, q.purpose)}</div>
        <div><label>When</label>${sel('timeline', WHEN, q.timeline)}</div>
        <div><label>Lives in (area)</label><input name="area" value="${e(q.area || '')}"></div>
      </div></div>
      <div class="box"><h3>How did the call go?</h3>
        <div class="outs">${Object.entries(S.d.outcomes).filter(([k]) => k !== 'booked').map(([k, v]) => `<button type="button" class="btn" data-out="${k}">${e(v)}</button>`).join('')}</div>
        <div class="f" data-for="visit_booked" hidden><label>Site visit on</label><input type="date" name="visitDate" min="${S.d.today}" value="${day(l.visit_date)}"></div>
        <div class="f" data-for="not_interested" hidden><label>Why not?</label><select name="lostReason"><option value="">Choose</option>${['Budget does not match', 'Location does not suit', 'Bought elsewhere', 'Wanted ready possession', 'Not reachable after many calls', 'Only enquiring', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="f"><label>Notes from the call</label><textarea name="note" rows="3" placeholder="What did they say? What do they want next?"></textarea></div>
        <div class="f" data-next><label>Next call</label><input type="date" name="nextDate" min="${S.d.today}"></div>
        <div class="err" id="err"></div>
        <div style="margin-top:10px"><button class="btn pri" type="submit" style="width:100%">Save the call</button></div>
      </div></form>
      ${(me.all || me.role === 'presales') && sales.length && !l.handed_to && ['new', 'contacted', 'visit'].includes(l.status) ? `<div class="box"><h3>Hand over to sales</h3><div class="grid2">
        <div><label>Sales person</label><select id="hto">${sales.map((x) => `<option value="${x.id}">${e(x.name)}</option>`).join('')}</select></div>
        <div><label>Site visit on</label><input type="date" id="hvisit" min="${S.d.today}" value="${day(l.visit_date)}"></div></div>
        <div class="f"><label>Anything sales should know</label><textarea id="hnote" rows="2"></textarea></div>
        <button class="btn pri" id="hand" style="margin-top:8px;width:100%">Hand over</button><div class="err" id="herr"></div></div>` : ''}
      ${(me.sells || me.all) && l.status !== 'lost' ? salesBox(l, j) : ''}
      <div class="box"><h3>Every call so far</h3>${evs || '<p style="color:var(--mut);margin:0">No calls noted yet.</p>'}
        ${l.note ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--mut);font-size:13px">Earlier notes</summary><pre style="white-space:pre-wrap;font:13px/1.45 inherit;margin:6px 0 0">${e(l.note)}</pre></details>` : ''}
        ${j.ivr.length ? `<details style="margin-top:6px" class="calls"><summary style="cursor:pointer;color:var(--mut);font-size:13px">Their calls to our IVR (${j.ivr.length})</summary>${j.ivr.map((c) => `<div class="t" style="font-size:13px;margin:4px 0">${when(c.called_at)} · ${e(c.status || '')}${c.duration ? ` · ${c.duration}s` : ''}${c.recording_url ? ` · <a href="${e(c.recording_url)}" target="_blank" rel="noopener">recording</a>` : ''}</div>`).join('')}</details>` : ''}
      </div></div>`;
    document.body.appendChild(p);
    const close = () => p.remove();
    p.addEventListener('click', (ev) => { if (ev.target === p || ev.target.closest('[data-close]')) close(); });
    let out = null;
    $$('[data-out]', p).forEach((b) => (b.onclick = () => {
      out = b.dataset.out; $$('[data-out]', p).forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-for]', p).forEach((x) => (x.hidden = x.dataset.for !== out));
      $('[data-next]', p).hidden = out === 'booked' || out === 'not_interested';
    }));
    $('#call', p).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target, err = $('#err', p); err.textContent = '';
      if (!out) { err.textContent = 'Choose how the call went.'; return; }
      const v = Object.fromEntries(new FormData(f));
      try {
        await api({ action: 'log', id: l.id, outcome: out, note: v.note, nextDate: v.nextDate, visitDate: v.visitDate, lostReason: v.lostReason, name: v.name, email: v.email, projectId: v.projectId || null,
          qualify: { bhk: v.bhk, budget: v.budget, purpose: v.purpose, timeline: v.timeline, area: v.area } });
        toast('Saved.'); close(); await load();
      } catch (x) { err.textContent = x.message; }
    };
    wireSales(p, l, j, close);
    if ($('#hand', p)) $('#hand', p).onclick = async () => {
      try { const r = await api({ action: 'handover', id: l.id, to: +$('#hto', p).value, visitDate: $('#hvisit', p).value, note: $('#hnote', p).value }); toast(`Handed over to ${r.to}${r.emailed ? ' (emailed)' : ''}.`); close(); await load(); }
      catch (x) { $('#herr', p).textContent = x.message; }
    };
  }

  // ---------- sales: the offer, the hold, the booking ----------
  const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const OST = { given: ['Offered', 'good'], pending: ['Waiting for approval', 'warn'], approved: ['Discount approved', 'good'], rejected: ['Discount rejected', 'bad'], booked: ['Booked', 'good'], void: ['Replaced', ''] };
  function salesBox(l, j) {
    const me = S.d.me, set = S.d.sales;
    const live = j.offers.find((o) => ['given', 'approved', 'pending'].includes(o.status));
    const offers = j.offers.filter((o) => o.status !== 'void').map((o) => `<div class="ev"><div class="t">${when(o.created_at)} · ${e(o.by_name || '')} · OF-${o.id}</div>
        <b>Flat ${e(o.unit_no)}${o.wing ? ' (' + e(o.wing) + ')' : ''}</b> · ${inr(o.av)} agreement value${Number(o.discount) ? ` · discount ${inr(o.discount)} (${Number(o.discount_pct).toFixed(2)}%)` : ''} · total ${inr(o.total)}
        <div><span class="chip ${OST[o.status][1]}">${OST[o.status][0]}</span>${o.decided_name ? ` <span class="t">by ${e(o.decided_name)}${o.decision_note ? ': ' + e(o.decision_note) : ''}</span>` : ''}${o.client_ask ? `<div class="t">Customer asked: ${e(o.client_ask)}</div>` : ''}</div>
        ${o.status === 'pending' && j.mayApprove ? `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn pri" data-appr="${o.id}">Approve</button><input data-rnote="${o.id}" placeholder="Reason, if rejecting" style="flex:1;min-width:140px"><button class="btn" data-rej="${o.id}">Reject</button></div>` : ''}</div>`).join('');
    const canBook = live && ['given', 'approved'].includes(live.status);
    const projectId = l.project_id || (S.d.projects[0] && S.d.projects[0].id);
    return `<div class="box" id="sales"><h3>Sales: offer, hold and booking</h3>
      ${j.hold ? `<p style="margin:0 0 8px">🔒 Flat <b>${e(j.hold.unit_no)}</b> is held for this customer until <b>${when(l.hold_until)}</b>. <button class="btn" id="release" style="padding:3px 9px;font-size:12px">Let go</button></p>` : ''}
      ${offers || '<p style="color:var(--mut);margin:0 0 6px">No offer yet.</p>'}
      ${canBook ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
          ${!j.hold || j.hold.id !== live.unit_id ? `<button class="btn" id="hold" data-unit="${live.unit_id}">🔒 Hold flat ${e(live.unit_no)} for ${set.holdHours} h</button>` : ''}
          <a class="btn" target="_blank" rel="noopener" href="/api/prices?unit=${live.unit_id}&parking=${live.parking}&discount=${Number(live.carpet) ? (Number(live.discount) / Number(live.carpet)).toFixed(2) : 0}&html=1">🧾 Cost sheet</a>
          ${l.phone ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/91${e(l.phone)}?text=${encodeURIComponent(`Dear ${l.name || 'Sir/Madam'}, as discussed, flat ${live.unit_no} at ${live.project || l.project || ''}: agreement value ${inr(live.av)}, total cost ${inr(live.total)} including GST, stamp duty and registration. Happy to answer any questions.`)}">💬 Send on WhatsApp</a>` : ''}
          <button class="btn pri" id="bookbtn">✅ Book this flat</button></div>` : ''}
      ${live && live.status === 'pending' ? `<p style="color:var(--warn);font-size:13px;margin:6px 0">The discount is above ${set.limitPct}%: it is with the approver. You can close once it is approved.</p>` : ''}
      <details ${live ? '' : 'open'} style="margin-top:6px"><summary style="cursor:pointer;font-weight:600;color:var(--maroon)">${live ? 'Make a new offer' : 'Make an offer'}</summary>
        <div class="grid2" style="margin-top:8px">
          <div><label>Project</label><select id="oproj">${S.d.projects.map((x) => `<option value="${x.id}" ${x.id === projectId ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
          <div><label>Flat (available)</label><select id="ounit"><option value="">Loading…</option></select></div>
          <div><label>Parking spaces</label><select id="opark">${[0, 1, 2, 3].map((n) => `<option>${n}</option>`).join('')}</select></div>
          <div><label>Discount (₹, total)</label><input id="odisc" inputmode="numeric" placeholder="0"></div>
        </div>
        <div class="f"><label>What the customer is asking for</label><input id="oask" placeholder="e.g. Wants 1.60 Cr all inclusive"></div>
        <div class="f"><label>Note</label><input id="onote"></div>
        <div id="oprice" style="margin-top:8px"></div><div class="err" id="oerr"></div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" id="owork" style="flex:1">Work it out</button><button class="btn pri" id="omake" style="flex:1">Make the offer</button></div>
      </details>
      <form id="bookform" hidden style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px"><h3>Book flat ${live ? e(live.unit_no) : ''} at ${live ? inr(live.av) : ''}</h3>
        <p style="color:var(--mut);font-size:13px;margin:0 0 6px">This goes to the CRM for approval, like every booking. The customer then becomes a client there.</p>
        <div class="grid2">
          <div><label>Applicant name</label><input name="a1name" value="${e(l.name || '')}" required></div>
          <div><label>Mobile</label><input name="a1phone" value="${e(l.phone || '')}"></div>
          <div><label>PAN</label><input name="a1pan" maxlength="10" style="text-transform:uppercase"></div>
          <div><label>Aadhaar</label><input name="a1aadhaar" inputmode="numeric" maxlength="14"></div>
          <div><label>Email</label><input name="a1email" value="${e(l.email || '')}"></div>
          <div><label>Address</label><input name="a1address"></div>
          <div><label>Second applicant (optional)</label><input name="a2name"></div>
          <div><label>Their PAN</label><input name="a2pan" maxlength="10" style="text-transform:uppercase"></div>
          <div><label>Booking date</label><input type="date" name="bookingDate" value="${S.d.today}" max="${S.d.today}"></div>
          <div><label>Paying by</label><select name="funding"><option value="self">Own funds</option><option value="loan">Home loan</option></select></div>
          <div><label>Bank (if loan)</label><input name="loanBank"></div>
          <div><label>Channel partner (if any)</label><input name="cpName"></div>
        </div><div class="err" id="berr"></div>
        <button class="btn pri" style="margin-top:10px;width:100%">Book and send to CRM</button></form>
    </div>`;
  }

  function wireSales(p, l, j, close) {
    const box = $('#sales', p); if (!box) return;
    const live = j.offers.find((o) => ['given', 'approved', 'pending'].includes(o.status));
    const err = (m) => { $('#oerr', p).textContent = m || ''; };
    async function units() {
      const pid = $('#oproj', p).value; const sel = $('#ounit', p);
      try {
        const r = await fetch(`/api/prices?project=${pid}&unsold=1`, { credentials: 'same-origin' }).then((x) => x.json());
        const rows = (r.rows || []).filter((u) => u.status === 'available' || (j.hold && j.hold.id === u.id));
        sel.innerHTML = rows.length ? rows.map((u) => `<option value="${u.id}" ${live && live.unit_id === u.id ? 'selected' : ''}>${e(u.unit_no)}${u.wing ? ' · ' + e(u.wing) : ''} · ${e(u.typology || '')} · ${u.carpet_sqft ? Math.round(u.carpet_sqft) + ' sq ft' : ''}${u.floor != null ? ' · floor ' + u.floor : ''}</option>`).join('') : `<option value="">${r.priceList ? 'No flat is available' : 'No price list for this project yet'}</option>`;
      } catch { sel.innerHTML = '<option value="">Could not load the flats</option>'; }
    }
    units(); $('#oproj', p).onchange = units;
    const body = (action) => ({ action, id: l.id, unitId: +$('#ounit', p).value, parking: +$('#opark', p).value, discount: $('#odisc', p).value, clientAsk: $('#oask', p).value, note: $('#onote', p).value });
    $('#owork', p).onclick = async () => {
      err(); if (!+$('#ounit', p).value) return err('Choose the flat.');
      try {
        const r = await api(body('offer.price'));
        $('#oprice', p).innerHTML = `<table class="src">
          <tr><td>Base price</td><td>${inr(r.rate)} / sq ft × ${Math.round(r.sqft)} sq ft</td></tr>
          ${r.parking ? `<tr><td>Parking (${r.parking})</td><td>${inr(r.parkingAmt)}</td></tr>` : ''}
          <tr><td>Agreement value (list)</td><td>${inr(r.listAv)}</td></tr>
          ${r.discount ? `<tr><td>Discount</td><td>− ${inr(r.discount)} (${r.discountPct.toFixed(2)}%)</td></tr><tr><td><b>Agreement value</b></td><td><b>${inr(r.av)}</b></td></tr>` : ''}
          <tr><td>GST</td><td>${inr(r.gst)}</td></tr><tr><td>Stamp duty + registration</td><td>${inr(r.stampDuty + r.registration)}</td></tr>
          ${r.otherTotal ? `<tr><td>Other charges</td><td>${inr(r.otherTotal)}</td></tr>` : ''}
          <tr><td><b>Total to the customer</b></td><td><b>${inr(r.total)}</b></td></tr></table>
          <p style="font-size:13px;margin:6px 0 0;color:${r.needsApproval ? 'var(--warn)' : 'var(--good)'}">${r.needsApproval ? `Above your ${r.limitPct}% limit: this goes to Rafi Sir for approval on WhatsApp. Write what the customer is asking for.` : r.discount ? `Within your ${r.limitPct}% limit: you can give it now.` : 'List price.'}</p>`;
      } catch (x) { err(x.message); }
    };
    $('#omake', p).onclick = async () => {
      err(); if (!+$('#ounit', p).value) return err('Choose the flat.');
      try { const r = await api(body('offer.make')); toast(r.status === 'pending' ? `${r.no} sent to Rafi Sir for approval.` : `${r.no} made.`); close(); await load(); openLead(l.id); }
      catch (x) { err(x.message); }
    };
    $$('[data-appr]', p).forEach((b) => (b.onclick = async () => { try { await api({ action: 'offer.decide', id: l.id, offerId: +b.dataset.appr, approve: true }); toast('Approved. Sales has been told.'); close(); await load(); } catch (x) { toast(x.message); } }));
    $$('[data-rej]', p).forEach((b) => (b.onclick = async () => { try { await api({ action: 'offer.decide', id: l.id, offerId: +b.dataset.rej, approve: false, note: $(`[data-rnote="${b.dataset.rej}"]`, p).value }); toast('Rejected. Sales has been told.'); close(); await load(); } catch (x) { toast(x.message); } }));
    if ($('#hold', p)) $('#hold', p).onclick = async (ev) => { try { const r = await api({ action: 'hold', id: l.id, unitId: +ev.target.dataset.unit }); toast(`Flat ${r.unit} held until ${when(r.until)}.`); close(); await load(); openLead(l.id); } catch (x) { toast(x.message); } };
    if ($('#release', p)) $('#release', p).onclick = async () => { try { await api({ action: 'release', id: l.id }); toast('Hold let go.'); close(); await load(); openLead(l.id); } catch (x) { toast(x.message); } };
    if ($('#bookbtn', p)) $('#bookbtn', p).onclick = () => { const f = $('#bookform', p); f.hidden = !f.hidden; if (!f.hidden) f.scrollIntoView({ behavior: 'smooth' }); };
    if ($('#bookform', p)) $('#bookform', p).onsubmit = async (ev) => {
      ev.preventDefault(); const v = Object.fromEntries(new FormData(ev.target)), be = $('#berr', p); be.textContent = '';
      const applicants = [{ name: v.a1name, phone: v.a1phone, pan: v.a1pan, aadhaar: v.a1aadhaar, email: v.a1email, address: v.a1address }];
      if (v.a2name) applicants.push({ name: v.a2name, pan: v.a2pan });
      const SRCN = SRC[l.source] || l.source;
      try {
        const r = await fetch('/api/bookings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', leadId: l.id, unitId: live.unit_id,
          agreementValue: Number(live.av), parking: live.parking, bookingDate: v.bookingDate, funding: v.funding, loanBank: v.loanBank, cpName: v.cpName, source: SRCN, rmName: S.d.me.name, applicants }) });
        const jj = await r.json().catch(() => ({})); if (!r.ok) throw new Error(jj.error || 'The booking did not go through.');
        toast('Booked: sent to the CRM for approval. 🎉'); close(); await load();
      } catch (x) { be.textContent = x.message; }
    };
  }

  function addLead() {
    const p = document.createElement('div'); p.className = 'panel';
    p.innerHTML = `<div class="sheet"><div style="display:flex;justify-content:space-between"><h2>Add a lead</h2><button class="btn" data-close>Close</button></div>
      <form id="nl"><div class="box"><div class="grid2">
        <div><label>Mobile</label><input name="phone" inputmode="tel" required></div><div><label>Name</label><input name="name"></div>
        <div><label>Project</label><select name="projectId"><option value="">Not known yet</option>${S.d.projects.map((x) => `<option value="${x.id}">${e(x.name)}</option>`).join('')}</select></div>
        <div><label>Came from</label><select name="source">${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${k === 'ivr' ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="f"><label>Note</label><textarea name="note" rows="2"></textarea></div><div class="err" id="nerr"></div>
        <button class="btn pri" style="margin-top:10px;width:100%">Add</button></div></form></div>`;
    document.body.appendChild(p);
    p.addEventListener('click', (ev) => { if (ev.target === p || ev.target.closest('[data-close]')) p.remove(); });
    $('#nl', p).onsubmit = async (ev) => {
      ev.preventDefault(); const v = Object.fromEntries(new FormData(ev.target));
      try { const r = await api({ action: 'add', ...v, projectId: v.projectId || null }); p.remove(); toast(r.duplicate ? 'This number was already a lead: opened it.' : 'Added.'); await load(); openLead(r.id); }
      catch (x) { $('#nerr', p).textContent = x.message; }
    };
  }

  async function load() { S.d = await api(); draw(); }
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; draw(); return; }
    const r = ev.target.closest('.row[data-id]'); if (r) openLead(+r.dataset.id);
  });
  $('#proj').onchange = (ev) => { S.proj = ev.target.value; draw(); };
  $('#q').oninput = (ev) => { S.q = ev.target.value; draw(); };
  $('#add').onclick = addLead;
  const m = location.search.match(/[?&]project=(\d+)/); if (m) S.proj = m[1];
  const of = location.search.match(/[?&]offer=(\d+)/);
  load().then(() => { if (!of) return; const a = (S.d.approvals || []).find((x) => x.id === +of[1]); if (a) { S.tab = 'appr'; draw(); openLead(a.lead_id); } else toast(`OF-${of[1]} is not waiting for approval any more.`); }).catch((x) => { $('#list').innerHTML = `<div class="empty">${e(x.message)}</div>`; });
})();
