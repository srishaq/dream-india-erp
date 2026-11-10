// All designs (/designs): every upcoming post with its design, week by week, for the brand and each project.
// Data: /api/marketing (posts with their files). Approve and Send back go through /api/agents (Management only).
(function () {
  const $ = (s) => document.querySelector(s);
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { stream: 'all', state: 'waiting', d: null };
  const STATES = { waiting: ['review'], scheduled: ['approved', 'scheduled'], all: null };
  const ist = (t) => new Date(new Date(t).getTime() + 5.5 * 3600e3);
  const fmt = (t) => new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const monday = (t) => { const d = ist(t); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  async function load() {
    const r = await fetch('/api/marketing', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/?next=/designs'; return; }
    S.d = await r.json();
    draw();
  }

  function streamName(p) { if (!p.project_id) return 'Brand'; const pr = (S.d.projects || []).find((x) => x.id === p.project_id); return pr ? pr.name : 'Project'; }

  function draw() {
    const projects = S.d.projects || [];
    const opts = [['all', 'All'], ['brand', 'Brand'], ...projects.map((p) => [String(p.id), p.name])];
    $('#streams').innerHTML = opts.map(([k, n]) => `<button class="btn ${S.stream === k ? 'on' : ''}" data-stream="${k}">${e(n)}</button>`).join(' ');
    $('#states').innerHTML = [['waiting', 'Waiting for approval'], ['scheduled', 'Approved'], ['all', 'Everything ahead']].map(([k, n]) => `<button class="btn ${S.state === k ? 'on' : ''}" data-state="${k}">${n}</button>`).join(' ');
    const now = Date.now();
    const list = (S.d.posts || []).filter((p) => p.publish_at && Date.parse(p.publish_at) > now - 864e5)
      .filter((p) => !STATES[S.state] || STATES[S.state].includes(p.status))
      .filter((p) => !['draft', 'published', 'failed'].includes(p.status) || S.state === 'all')
      .filter((p) => S.stream === 'all' || (S.stream === 'brand' ? !p.project_id : String(p.project_id) === S.stream))
      .sort((a, b) => a.publish_at.localeCompare(b.publish_at));
    const withDesign = list.filter((p) => (p.files || []).some((f) => /^image\//.test(f.mime))).length;
    $('#sum').textContent = `${list.length} post${list.length === 1 ? '' : 's'} · ${withDesign} with a design`;
    if (!list.length) { $('#main').innerHTML = '<div class="empty">Nothing here.</div>'; return; }
    const can = S.d.can || {};
    const weeks = {};
    for (const p of list) (weeks[monday(p.publish_at)] = weeks[monday(p.publish_at)] || []).push(p);
    $('#main').innerHTML = Object.entries(weeks).map(([wk, ps]) => {
      const d = new Date(wk + 'T00:00:00Z');
      const label = 'Week of ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      return `<div class="week">${label}</div><div class="grid">${ps.map((p) => {
        const im = (p.files || []).filter((f) => /^image\//.test(f.mime));
        const pics = im.length ? `<div class="imgs">${im.map((f, i) => `<a href="/slides?ids=${im.map((y) => y.id).join(',')}&i=${i}" title="${im.length > 1 ? 'Slide ' + (i + 1) : 'Open full size'}"><img src="/api/marketing?pfile=${f.id}" alt="" loading="lazy"></a>`).join('')}</div>` : '<div class="noimg">Design on its way</div>';
        const st = p.status === 'review' ? '<span class="tag">Waiting</span>' : ['approved', 'scheduled'].includes(p.status) ? '<span class="tag ok">Approved</span>' : `<span class="tag">${e(p.status)}</span>`;
        const acts = p.status === 'review' && can.approve ? `<div class="acts"><button class="btn pri" data-approve="${p.id}" ${im.length ? '' : 'disabled'}>Approve</button><button class="btn" data-back="${p.id}">Send back</button></div>` : '';
        const sh = p.design_text && p.design_text.shoot;
        const brief = sh ? `<details class="shoot"><summary>${sh.type === 'founder' ? 'Founder reel: shoot with Rafi Sir' : 'Update reel: shoot on site'}</summary>${sh.who ? `<p><b>On camera:</b> ${e(sh.who)}</p>` : ''}${sh.where ? `<p><b>Where:</b> ${e(sh.where)}</p>` : ''}${sh.script ? `<p><b>Script:</b> ${e(sh.script)}</p>` : ''}${(sh.shots || []).length ? `<p><b>Shots:</b></p><ol>${sh.shots.map((x) => `<li>${e(x)}</li>`).join('')}</ol>` : ''}</details>` : '';
        return `<div class="card">${pics}<div class="meta"><div class="s">${e(fmt(p.publish_at))} · ${e(streamName(p))} · ${e(p.kind)}${im.length > 1 ? ` · ${im.length} slides` : ''}</div><div class="t">${e(p.title)}</div><div>${st}</div>${brief}${acts}</div></div>`;
      }).join('')}</div>`;
    }).join('');
  }

  async function act(action, id, extra) {
    const p = (S.d.posts || []).find((x) => x.id === id);
    const r = await fetch('/api/agents', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: p && p.project_id ? String(p.project_id) : 'company', action, id, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { alert(j.error || 'That did not work.'); return; }
    await load();
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.stream) { S.stream = b.dataset.stream; draw(); }
    if (b.dataset.state) { S.state = b.dataset.state; draw(); }
    if (b.dataset.approve) { b.disabled = true; act('post.approve', +b.dataset.approve); }
    if (b.dataset.back) { const note = prompt('What should change? (goes back to the team)'); if (note != null) act('post.sendback', +b.dataset.back, { note }); }
  });
  load();
})();
