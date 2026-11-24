// Sourcing tab of /leads: the sourcing team's visits to channel partner offices (data: /api/sourcing).
// Log a visit at the partner's office: the phone's location proves it (first visit saves the office, later visits are
// checked within 150 m), a photo of the office board or a visiting card on the first visit, the person met, why, notes
// and the next follow-up. Managers also see each person's days, unverified visits and what each partner brings in.
(function () {
  let H = null, S = null, busy = false;
  const day = (x) => (x ? String(x).slice(0, 10) : '');
  const ist = (t) => new Date(Date.parse(t) + 5.5 * 3600e3).toISOString().slice(0, 10);
  const daysAgo = (t) => Math.floor((Date.now() - Date.parse(t)) / 864e5);
  async function call(body, q = '') {
    const r = await fetch('/api/sourcing' + q, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/?next=/leads?tab=sourcing'; throw new Error('Please sign in.'); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  }
  async function reload() { S.src = await call(); H && draw(S, H); }

  function tabsList(d) {
    const t = d.today;
    const T = [
      ['mine', 'My visits', d.visits.length],
      ['follow', 'Follow-ups', d.partners.filter((p) => p.next_date).length],
      ['cold', 'Not visited in 30 days', d.partners.filter((p) => !p.last_visit || daysAgo(p.last_visit) > 30).length],
    ];
    if (d.me.all) T.push(['team', 'Team', null], ['unver', 'Unverified', d.unverified.length], ['partners', 'Partners', null]);
    return T;
  }

  function vrow(v, showWho) {
    const tag = v.first_visit ? '<span class="chip">first visit</span>' : v.verified ? `<span class="chip good">✓ at office${v.distance_m != null ? ' · ' + v.distance_m + ' m' : ''}</span>`
      : `<span class="chip bad">${v.distance_m != null ? v.distance_m + ' m away' : 'not verified'}</span>`;
    return `<div class="row" data-visit="${v.id}"><div class="who"><b>${H.e(v.partner)}</b>
      <div class="s">${H.e(v.person_name || '')}${v.person_role ? ' (' + H.e(v.person_role) + ')' : ''} · ${H.e(S.src.purposes[v.purpose] || v.purpose)}${v.project ? ' · ' + H.e(v.project) : ''}</div>
      <div class="s">${showWho ? H.e(v.who) + ' · ' : ''}${H.when(v.at)}${v.notes ? ' · ' + H.e(v.notes) : ''}</div></div>
      <div class="right">${tag}${v.next_date ? `<div>next ${H.nice(day(v.next_date))}</div>` : ''}</div></div>`;
  }

  function draw(s, h) {
    S = s; H = h;
    if (!S.src) { h.$('#stats').innerHTML = ''; h.$('#tabs').innerHTML = ''; h.$('#list').innerHTML = '<div class="empty">Loading…</div>'; if (!busy) { busy = true; reload().catch((x) => { h.$('#list').innerHTML = `<div class="empty">${h.e(x.message)}</div>`; }).finally(() => { busy = false; }); } return; }
    const d = S.src; d.today = S.d.today;
    const T = tabsList(d);
    if (!S.stab || !T.some((x) => x[0] === S.stab)) S.stab = T[0][0];
    const q = (S.q || '').toLowerCase().trim();
    const hit = (...xs) => !q || xs.join(' ').toLowerCase().includes(q);
    // my day: visits today against the day's target
    const today = d.visits.filter((v) => ist(v.at) === d.today), ok = today.filter((v) => v.verified || v.first_visit).length, tg = d.settings.target;
    const teamToday = d.me.all ? (d.team || []).filter((x) => x.day === d.today) : [];
    h.$('#stats').innerHTML = `<div class="stats"><div class="stat"><b>${today.length} / ${tg}</b><span>my visits today</span><div class="meter"><i style="width:${Math.min(100, (100 * today.length) / tg)}%"></i></div></div>
      <div class="stat"><b>${ok}</b><span>verified at the office</span></div>
      <div class="stat"><b>${d.visits.length}</b><span>my visits, 30 days</span></div>
      ${d.me.all ? `<div class="stat"><b>${teamToday.reduce((a, x) => a + x.visits, 0)}</b><span>team visits today (${teamToday.length} people)</span></div><div class="stat"><b>${d.unverified.length}</b><span>unverified, 30 days</span></div>` : ''}</div>`;
    h.$('#tabs').innerHTML = T.map(([k, n, c]) => `<button class="btn ${S.stab === k ? 'on' : ''}" data-stab="${k}">${n}${c == null ? '' : `<small>${c}</small>`}</button>`).join('');
    let html = '';
    if (S.stab === 'mine') {
      const rows = d.visits.filter((v) => hit(v.partner, v.person_name, v.notes));
      html = rows.length ? rows.map((v) => vrow(v)).join('') : '<div class="empty">No visits yet. At a partner\'s office, tap “+ Log a visit”.</div>';
    } else if (S.stab === 'follow') {
      const rows = d.partners.filter((p) => p.next_date && hit(p.name, p.contact_person)).sort((a, b) => day(a.next_date).localeCompare(day(b.next_date)));
      html = rows.length ? rows.map((p) => prow(p, `<span class="chip ${day(p.next_date) <= d.today ? 'warn' : ''}">${day(p.next_date) === d.today ? 'today' : H.nice(day(p.next_date))}</span>`)).join('') : '<div class="empty">No follow-ups planned.</div>';
    } else if (S.stab === 'cold') {
      const rows = d.partners.filter((p) => (!p.last_visit || daysAgo(p.last_visit) > 30) && hit(p.name, p.contact_person))
        .sort((a, b) => (a.last_visit ? Date.parse(a.last_visit) : 0) - (b.last_visit ? Date.parse(b.last_visit) : 0) || a.name.localeCompare(b.name));
      html = rows.length ? rows.slice(0, 300).map((p) => prow(p, `<span class="chip ${p.last_visit ? 'warn' : ''}">${p.last_visit ? daysAgo(p.last_visit) + ' days ago' : 'never visited'}</span>`)).join('') + (rows.length > 300 ? `<p class="empty">and ${rows.length - 300} more: search.</p>` : '')
        : '<div class="empty">Every partner was visited in the last 30 days.</div>';
    } else if (S.stab === 'team') {
      const days = [...new Set(d.team.map((x) => x.day))];
      html = days.length ? days.map((dd) => `<div class="box"><h3>${H.nice(dd)}</h3><table class="src"><tr><td><b>Person</b></td><td>Visits</td><td>Verified</td><td>Partners</td></tr>
        ${d.team.filter((x) => x.day === dd).map((x) => `<tr><td>${H.e(x.name)}</td><td>${x.visits}${x.visits >= tg ? ' ✓' : ''}</td><td>${x.verified}</td><td>${x.partners}</td></tr>`).join('')}</table></div>`).join('')
        + `<div class="box"><h3>Visits in the last 7 days</h3>${d.recent.filter((v) => hit(v.partner, v.who, v.person_name)).map((v) => vrow(v, true)).join('') || '<p class="empty">None.</p>'}</div>`
        : '<div class="empty">No sourcing visits in the last 14 days.</div>';
    } else if (S.stab === 'unver') {
      const rows = d.unverified.filter((v) => hit(v.partner, v.who, v.person_name));
      html = `<p style="color:var(--mut);font-size:13px;margin:0 0 8px">Logged more than ${d.settings.radius} m from the partner's saved office. Open one to see where it was logged; if the partner has moved office, reset it.</p>`
        + (rows.length ? rows.map((v) => vrow(v, true)).join('') : '<div class="empty">Nothing unverified.</div>');
    } else if (S.stab === 'partners') {
      const rows = (d.byPartner || []).filter((p) => hit(p.name));
      html = `<p style="color:var(--mut);font-size:13px;margin:0 0 8px">Last 90 days: our visits, the leads each partner registered, their site visits and bookings.</p><div class="box" style="overflow-x:auto"><table class="src">
        <tr><td><b>Partner</b></td><td>Visits</td><td>Last visit</td><td>Leads</td><td>Site visits</td><td>Bookings</td></tr>
        ${rows.slice(0, 400).map((p) => `<tr><td>${H.e(p.name)}</td><td>${p.visits}</td><td>${p.last_visit ? daysAgo(p.last_visit) + ' d ago' : '—'}</td><td>${p.leads}</td><td>${p.site_visits}</td><td>${p.bookings}</td></tr>`).join('')}</table></div>`;
    }
    h.$('#list').innerHTML = html;
  }

  function prow(p, right) {
    return `<div class="row" data-cp="${p.id}"><div class="who"><b>${H.e(p.name)}</b><div class="s">${H.e([p.contact_person, p.phone].filter(Boolean).join(' · ') || ' ')}</div>
      <div class="s">${p.office_saved ? 'Office location saved' : 'Office not saved yet: first visit saves it'}${p.my_last_visit ? ' · you went ' + daysAgo(p.my_last_visit) + ' d ago' : ''}</div></div><div class="right">${right}<div style="margin-top:4px"><span class="chip good">Log a visit</span></div></div></div>`;
  }

  function showVisit(id) {
    const d = S.src, v = [...d.visits, ...(d.recent || []), ...(d.unverified || [])].find((x) => x.id === id); if (!v) return;
    const p = document.createElement('div'); p.className = 'panel';
    p.innerHTML = `<div class="sheet"><div style="display:flex;justify-content:space-between;gap:10px"><div><h2>${H.e(v.partner)}</h2><div style="color:var(--mut);font-size:13px">${H.e(v.who)} · ${H.when(v.at)}</div></div><button class="btn" data-close>Close</button></div>
      <div class="box"><h3>Who and why</h3><p style="margin:0">${H.e(v.person_name || '')}${v.person_role ? ' (' + H.e(v.person_role) + ')' : ''}${v.person_phone ? ' · <a href="tel:' + H.e(v.person_phone) + '">' + H.e(v.person_phone) + '</a>' : ''}</p>
        <p style="margin:6px 0 0">${H.e(d.purposes[v.purpose] || v.purpose)}${v.project ? ' · ' + H.e(v.project) : ''}</p>${v.notes ? `<p style="margin:6px 0 0;white-space:pre-wrap">${H.e(v.notes)}</p>` : ''}${v.next_date ? `<p style="margin:6px 0 0">Next follow-up: <b>${H.nice(day(v.next_date))}</b></p>` : ''}</div>
      <div class="box"><h3>Where</h3><p style="margin:0">${v.first_visit ? 'First visit: this saved the office location.' : v.verified ? `At the office (${v.distance_m} m from the saved spot).` : v.distance_m != null ? `<b style="color:var(--bad)">${v.distance_m} m</b> from the saved office.` : 'Not verified.'}${v.accuracy ? ` Phone accuracy ±${v.accuracy} m.` : ''}</p>
        ${v.lat ? `<a class="btn" style="margin-top:8px;display:inline-block" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${v.lat},${v.lng}">Open in Maps</a>` : ''}
        ${d.me.all && !v.verified && !v.first_visit ? `<button class="btn" id="reset" style="margin-top:8px">The partner moved: reset their office</button>` : ''}</div>
      ${v.has_photo ? `<div class="box"><h3>Photo</h3><img class="thumb" src="/api/sourcing?photo=${v.id}" alt="Office board or visiting card"></div>` : ''}</div>`;
    document.body.appendChild(p);
    p.addEventListener('click', (ev) => { if (ev.target === p || ev.target.closest('[data-close]')) p.remove(); });
    if (p.querySelector('#reset')) p.querySelector('#reset').onclick = async () => {
      try { await call({ action: 'office.reset', cpId: v.cp_id }); H.toast('Office reset: the next visit saves the new location.'); p.remove(); await reload(); } catch (x) { H.toast(x.message); }
    };
  }

  // a photo, made small on the phone before it is sent
  function shrink(file) {
    return new Promise((ok, bad) => {
      // read as a data URL (the page's security rules allow data: images, not blob:)
      const img = new Image(), fr = new FileReader();
      img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.7)); };
      img.onerror = () => bad(new Error('That photo could not be read.'));
      fr.onload = () => { img.src = fr.result; }; fr.onerror = () => bad(new Error('That photo could not be read.')); fr.readAsDataURL(file);
    });
  }

  function add(cpId) {
    if (!S || !S.src) return;
    const d = S.src, pre = cpId ? d.partners.find((x) => x.id === cpId) : null;
    const p = document.createElement('div'); p.className = 'panel';
    p.innerHTML = `<div class="sheet"><div style="display:flex;justify-content:space-between"><h2>Log a visit</h2><button class="btn" data-close>Close</button></div>
      <div class="box"><div class="loc" id="loc">Finding where you are…</div><button class="btn" type="button" id="relocate">Try the location again</button></div>
      <form id="vf"><div class="box"><h3>Partner</h3>
        <input id="cpn" list="cplist" placeholder="Type the firm name" value="${pre ? H.e(pre.name) : ''}" style="width:100%" autocomplete="off">
        <datalist id="cplist">${d.partners.map((x) => `<option value="${H.e(x.name)}">`).join('')}</datalist>
        <div id="cpnote" style="font-size:12.5px;color:var(--mut);margin-top:4px"></div>
        <div class="f" id="photobox"><label id="photolabel">Photo of the office board or a visiting card</label><input type="file" id="photo" accept="image/*" capture="environment"><img id="prev" class="thumb" hidden alt=""></div>
      </div>
      <div class="box"><h3>Who you met</h3><div class="grid2">
        <div><label>Name</label><input name="personName" required></div><div><label>Mobile</label><input name="personPhone" inputmode="tel"></div>
        <div><label>Designation</label><input name="personRole" placeholder="Owner, partner, manager…"></div>
        <div><label>Why you went</label><select name="purpose" required><option value="">Choose</option>${Object.entries(d.purposes).map(([k, v]) => `<option value="${k}">${H.e(v)}</option>`).join('')}</select></div>
        <div><label>Project discussed</label><select name="projectId"><option value="">Both / none</option>${(S.d.projects.length ? S.d.projects : []).map((x) => `<option value="${x.id}">${H.e(x.name)}</option>`).join('')}</select></div>
        <div><label>Next follow-up</label><input type="date" name="nextDate" min="${S.d.today}"></div></div>
        <div class="f"><label>Notes</label><textarea name="notes" rows="3" placeholder="What was discussed, clients they have, what they need from us"></textarea></div>
        <div class="err" id="verr"></div><button class="btn pri" id="vsave" style="margin-top:10px;width:100%">Save the visit</button></div></form></div>`;
    document.body.appendChild(p);
    const $ = (x) => p.querySelector(x);
    p.addEventListener('click', (ev) => { if (ev.target === p || ev.target.closest('[data-close]')) p.remove(); });
    let pos = null, photo = null;
    const byName = (n) => d.partners.find((x) => x.name.toLowerCase() === String(n || '').trim().toLowerCase());
    function partnerNote() {
      const n = $('#cpn').value.trim(), cp = byName(n);
      const first = !cp || !cp.last_visit;
      $('#cpnote').textContent = !n ? '' : cp ? (cp.office_saved ? 'Office location saved: you must be within 150 m of it.' : 'First visit: your location now becomes the office location.') : 'New partner: it will be added to the partner list.';
      $('#photolabel').textContent = first ? 'Photo of the office board or a visiting card (needed: first visit)' : 'Photo (optional)';
    }
    $('#cpn').oninput = partnerNote; partnerNote();
    function locate() {
      const el = $('#loc'); el.className = 'loc'; el.textContent = 'Finding where you are…';
      if (!navigator.geolocation) { el.className = 'loc bad'; el.textContent = 'This phone does not share its location. Use the phone\'s browser with location on.'; return; }
      navigator.geolocation.getCurrentPosition((g) => {
        pos = { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: Math.round(g.coords.accuracy) };
        el.className = pos.accuracy <= 150 ? 'loc good' : 'loc'; el.textContent = pos.accuracy <= 150 ? `📍 Location found (±${pos.accuracy} m).` : `📍 Location is rough (±${pos.accuracy} m). Step near a window or outside and try again.`;
      }, (x) => { pos = null; el.className = 'loc bad'; el.textContent = x.code === 1 ? 'Location is blocked. Allow location for erp.dreamindiarealty.com in the phone\'s settings, then try again.' : 'Could not find your location. Try again.'; },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }
    $('#relocate').onclick = locate; locate();
    $('#photo').onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try { photo = await shrink(f); $('#prev').src = photo; $('#prev').hidden = false; } catch (x) { $('#verr').textContent = x.message; }
    };
    $('#vf').onsubmit = async (ev) => {
      ev.preventDefault(); const err = $('#verr'); err.textContent = '';
      if (!pos) { err.textContent = 'Your location is needed to log a visit. Tap “Try the location again”.'; return; }
      const n = $('#cpn').value.trim(); if (!n) { err.textContent = 'Type the partner\'s firm name.'; return; }
      const cp = byName(n), v = Object.fromEntries(new FormData(ev.target));
      $('#vsave').disabled = true;
      try {
        const r = await call({ action: 'visit', cpId: cp ? cp.id : null, newName: cp ? null : n, ...pos, photo, personName: v.personName, personPhone: v.personPhone, personRole: v.personRole,
          purpose: v.purpose, notes: v.notes, nextDate: v.nextDate, projectId: v.projectId || null });
        p.remove();
        H.toast(r.savedOffice ? `Saved. ${r.partner}'s office location is now set.` : r.verified ? `✓ Verified at ${r.partner}'s office (${r.distance} m).` : `Saved, but you were ${r.distance} m from ${r.partner}'s saved office: marked unverified.`);
        S.stab = 'mine'; await reload();
      } catch (x) { err.textContent = x.message; $('#vsave').disabled = false; }
    };
  }

  document.addEventListener('click', (ev) => {
    if (!S || S.main !== 'sourcing') return;
    const t = ev.target.closest('[data-stab]'); if (t) { S.stab = t.dataset.stab; draw(S, H); return; }
    const v = ev.target.closest('[data-visit]'); if (v) { showVisit(+v.dataset.visit); return; }
    const c = ev.target.closest('[data-cp]'); if (c) add(+c.dataset.cp);
  });
  window.Sourcing = { draw, add: () => add(), reload };
})();
