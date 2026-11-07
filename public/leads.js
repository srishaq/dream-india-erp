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
  function tabs() {
    const t = S.d.today, all = S.d.me.all;
    const T = all ? [
      ['now', 'Call now', (l) => l.status === 'new' && !l.first_contact_at && !l.handed_to],
      ['today', 'Call today', (l) => open(l) && l.first_contact_at && l.next_date && day(l.next_date) <= t && !(l.visit_date && day(l.visit_date) === t)],
      ['visits', 'Site visits', (l) => open(l) && l.visit_date && day(l.visit_date) >= t],
      ['follow', 'Follow-ups', (l) => open(l) && l.first_contact_at && !l.handed_to && !(l.next_date && day(l.next_date) <= t)],
      ['sales', 'With sales', (l) => open(l) && l.handed_to],
      ['closed', 'Booked / lost', (l) => !open(l)],
    ] : [
      ['visits', 'Site visits', (l) => open(l) && l.visit_date && day(l.visit_date) >= t],
      ['today', 'Call today', (l) => open(l) && l.next_date && day(l.next_date) <= t],
      ['mine', 'All my leads', open],
      ['closed', 'Booked / lost', (l) => !open(l)],
    ];
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
    else if (S.tab === 'now') rows.sort((a, b) => a.created_at.localeCompare(b.created_at)); // longest waiting first
    $('#list').innerHTML = rows.length ? rows.slice(0, 300).map(row).join('') + (rows.length > 300 ? `<p class="empty">and ${rows.length - 300} more: search or pick a project.</p>` : '') : `<div class="empty">${S.tab === 'now' ? 'Nobody waiting for a call. Well done.' : 'Nothing here.'}</div>`;
    stats();
  }

  function row(l) {
    const q = l.qualify || {};
    const what = [l.project, q.bhk, q.budget].filter(Boolean).join(' · ') || 'Project not known yet';
    const src = (l.sources && l.sources.length ? l.sources : [l.source]).map((s) => SRC[s] || s).join(', ');
    let right = '';
    if (S.tab === 'now') { const h = (Date.now() - Date.parse(l.created_at)) / 36e5; right = `<span class="chip ${h > 2 ? 'bad' : h > 0.25 ? 'warn' : 'good'}">waiting ${ago(l.created_at)}</span>`; }
    else if (l.status === 'booked') right = '<span class="chip good">Booked</span>';
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
    $('#stats').innerHTML = `<div class="stats">
      <div class="stat"><b>${s.leads}</b><span>leads, last 30 days</span></div>
      <div class="stat"><b>${pct(s.called, s.leads)}</b><span>called (${s.called})</span></div>
      <div class="stat"><b>${pct(s.fast, s.leads)}</b><span>called within 15 min</span></div>
      <div class="stat"><b>${s.handed}</b><span>handed to sales</span></div>
      <div class="stat"><b>${s.visits}</b><span>site visits</span></div>
      <div class="stat"><b>${s.booked}</b><span>bookings</span></div></div>
      ${s.bySource.length > 1 ? `<details style="margin:-4px 0 12px"><summary style="cursor:pointer;color:var(--mut);font-size:13px">Where the leads came from</summary><table class="src"><tr><td></td><td>Leads</td><td>Visits</td><td>Booked</td></tr>${s.bySource.map((x) => `<tr><td>${e(SRC[x.source] || x.source)}</td><td>${x.leads}</td><td>${x.visits}</td><td>${x.booked}</td></tr>`).join('')}</table></details>` : ''}`;
  }

  // ---------- one lead ----------
  async function openLead(id) {
    const j = await api(null, '?id=' + id).catch((x) => { toast(x.message); return null; }); if (!j) return;
    const l = j.lead, q = l.qualify || {}, me = S.d.me;
    const sel = (name, opts, v) => `<select name="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${e(o)}</option>`).join('')}${v && !opts.includes(v) ? `<option selected>${e(v)}</option>` : ''}</select>`;
    const sales = S.d.people.filter((p) => p.role === 'sales');
    const evs = j.events.map((x) => `<div class="ev"><div class="t">${when(x.at)} · ${e(x.who || '')}</div><b>${e(x.kind === 'call' ? S.d.outcomes[x.outcome] || x.outcome : x.kind === 'handover' ? 'Handed over to ' + ((x.data && x.data.toName) || 'sales') + (x.data && x.data.visitDate ? ', visit ' + nice(x.data.visitDate) : '') : x.kind === 'assign' ? 'Reassigned' : 'Note')}</b>${x.note ? ' — ' + e(x.note) : ''}${x.data && x.data.next ? `<div class="t">Next call ${nice(x.data.next)}</div>` : ''}</div>`).join('');
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
        <div class="outs">${Object.entries(S.d.outcomes).map(([k, v]) => `<button type="button" class="btn" data-out="${k}">${e(v)}</button>`).join('')}</div>
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
    if ($('#hand', p)) $('#hand', p).onclick = async () => {
      try { const r = await api({ action: 'handover', id: l.id, to: +$('#hto', p).value, visitDate: $('#hvisit', p).value, note: $('#hnote', p).value }); toast(`Handed over to ${r.to}${r.emailed ? ' (emailed)' : ''}.`); close(); await load(); }
      catch (x) { $('#herr', p).textContent = x.message; }
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
  load().catch((x) => { $('#list').innerHTML = `<div class="empty">${e(x.message)}</div>`; });
})();
