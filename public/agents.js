// The AI marketing agent team: the command centre (/agents). One system for Dream India Realty; the drop-down at the
// start chooses the company or a project, and everything on the screen (owner input, knowledge, drafts, funnels, feed)
// belongs to that choice. Data: /api/agents (lib/agents.js).
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { scope: null, d: null, focus: null, timer: null, busy: false };
  try { S.scope = localStorage.getItem('erp_agents_scope') || null; } catch { /* private window */ }
  if (/^#\/?(company|\d+)$/.test(location.hash)) S.scope = location.hash.replace(/^#\/?/, '');
  S.scope = S.scope || 'company';

  async function api(body) {
    const r = await fetch('/api/agents' + (body ? '' : `?scope=${encodeURIComponent(S.scope)}`), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: S.scope, ...body }) } : {});
    if (r.status === 401) { location.href = '/?next=/agents'; throw new Error('Please sign in.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.mustChange || j.ndaRequired) location.href = '/'; throw new Error(j.error || 'Something went wrong.'); }
    return j;
  }
  function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3200); }

  // ---------- little icons for every tool ----------
  const ICON = [
    [/instagram/i, 'IG', '#E1306C'], [/facebook/i, 'FB', '#1877F2'], [/meta ads|meta lead|meta conv/i, 'META', '#0866FF'], [/youtube/i, 'YT', '#FF0000'],
    [/google ads/i, 'GAds', '#34A853'], [/website|page audit/i, 'WEB', '#0E8C9B'], [/ivr/i, 'IVR', '#7A5AF8'], [/whatsapp/i, 'WA', '#25D366'],
    [/search console/i, 'GSC', '#4285F4'], [/google review|google business/i, 'GBP', '#E8A400'], [/linkedin/i, 'in', '#0A66C2'], [/claude|drafts$/i, 'AI', '#D97757'],
    [/memory|knowledge/i, 'MEM', '#64748B'], [/canva/i, 'CV', '#00A3AD'], [/voice/i, 'VO', '#374151'], [/^leads|lead →|cost per lead/i, 'LD', '#D97706'],
    [/calendar|scheduler/i, 'CAL', '#8B7CF6'], [/design library|visual/i, 'LIB', '#0EA5E9'], [/telecall/i, 'TC', '#14B8A6'], [/partner/i, 'CP', '#F97316'],
    [/booking/i, 'BK', '#16A34A'], [/competitor/i, 'ADL', '#475569'], [/news|trend|research/i, 'NEWS', '#9333EA'], [/mention|comment/i, '@', '#DB2777'],
    [/keyword/i, 'KW', '#2563EB'], [/hook/i, 'HK', '#EA580C'], [/rera/i, 'RERA', '#B45309'], [/reply|complaint/i, 'RE', '#BE185D'], [/script/i, 'SCR', '#7C3AED'],
    [/comment-to-dm/i, 'DM', '#C026D3'], [/portal/i, '99', '#E11D48'], [/alarm/i, '2H', '#DC2626'], [/spend/i, '₹', '#059669'], [/digest/i, 'WK', '#4F46E5'], [/audience/i, 'AUD', '#0891B2'],
  ];
  const icon = (name) => { const m = ICON.find(([re]) => re.test(name)); return m ? [m[1], m[2]] : [name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(), '#475569']; };
  const tile = (t) => { const [a, c] = icon(t.name); return `<div class="tile${t.on ? '' : ' off'}" title="${e(t.on ? t.name + ': running' : t.name + ': waiting for ' + t.needs)}"><div class="ic" style="background:${c}">${e(a)}</div>${e(t.name)}</div>`; };
  const AG = { orchestrator: ['OR', '#F5A524'], owner: ['YOU', '#8B7CF6'], brain: ['AI', '#D97757'], system: ['SYS', '#3F4654'], 'market-radar': ['MR', '#9333EA'], search: ['SV', '#2563EB'], 'content-engine': ['CE', '#EA580C'], creative: ['CS', '#0EA5E9'], reviews: ['RR', '#DB2777'], publishing: ['PS', '#16A34A'], leads: ['LC', '#C026D3'], results: ['ROI', '#059669'], engage: ['EN', '#14B8A6'] };
  const agName = (id) => (S.d && S.d.names[id]) || (id === 'system' ? 'System' : id);
  const ago = (t) => { if (!t) return ''; const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const hm = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

  // ---------- the screen ----------
  function render() {
    const d = S.d, me = d.me, sc = d.settings, o = sc.owner;
    const scopeName = d.project ? d.project.name : 'Dream India Realty (company)';
    const off = d.killed || sc.paused || !sc.enabled;
    const lastKinds = d.events.filter((x) => x.kind !== 'log').slice(-6).map((x) => x.kind);
    const hot = { collect: 'collects', score: 'scores', brief: 'briefs', draft: 'drafts', owner: 'approves' };
    const hotStep = hot[lastKinds[lastKinds.length - 1]] || null;
    const ownerOpen = d.owner.length, queue = d.queue.length;
    const feed = d.events.filter((x) => x.kind !== 'log' && (!S.focus || x.agent === S.focus || x.to_agent === S.focus)).slice(-40).reverse();
    const focusDept = S.focus && d.departments.find((x) => x.id === S.focus);

    $('#app').innerHTML = `
    <header class="top">
      <div class="pick"><label for="scope">Project</label>
        <select id="scope"><option value="company"${S.scope === 'company' ? ' selected' : ''}>Dream India Realty · whole company</option>
          ${d.projects.map((p) => `<option value="${p.id}"${String(p.id) === S.scope ? ' selected' : ''}>${e(p.name)}${p.rera_no ? '' : ' · pre-RERA'}${p.enabled ? ' ●' : ''}</option>`).join('')}</select></div>
      <div class="title">AI Native <b>Marketing Agent Team</b></div>
      <span class="live${off ? ' off' : ''}"><i></i>${d.killed ? 'Kill switch on' : !sc.enabled ? 'Agents off here' : sc.paused ? 'Paused' : `Live · ${d.agents.on} of ${d.agents.of} agents running`}</span>
      <span class="clock" id="clock"></span>
      ${me.edit ? `<button class="btn pri" id="runNow"${off ? ' disabled' : ''}>Run now</button>` : ''}
      ${d.queue.length ? `<button class="btn pri" id="toDrafts">Drafts to approve (${d.queue.length})</button>` : ''}
      <a class="btn" href="/designs" style="text-decoration:none">All designs</a>
      ${d.project && d.project.rera_no ? `<button class="btn ${d.reraQr ? '' : 'pri'}" id="reraQr" title="MahaRERA requires the project's official QR code on every ad">${d.reraQr ? 'MahaRERA QR ✓' : 'Upload MahaRERA QR'}</button><input type="file" id="reraQrFile" accept="image/png,image/jpeg" hidden>` : ''}
      <a class="btn" href="/" style="text-decoration:none">⌂ ERP Home</a>
      <a class="back" href="/#/marketing${d.project ? '/' + d.project.id : ''}">← Sales &amp; Marketing</a>
    </header>
    ${d.killed ? `<div class="banner red">The kill switch is on: every agent in every project is stopped. ${me.own ? 'Switch it off under Knowledge layer → Kill switch.' : ''}</div>` : ''}
    ${!sc.enabled ? `<div class="banner">The agents are off for ${e(scopeName)}. ${me.own ? '<button class="btn sm" id="enableHere">Switch the agents on for this project</button>' : 'Management switches them on.'}</div>` : ''}
    ${d.preRera ? `<div class="banner"><b>Pre-RERA mode.</b> ${e(d.project.name)} has no MahaRERA number yet, so the agents make area and brand content only: no project name in ads, no prices, no bookings, no “register interest”. Add the number in Projects once it is registered and they switch to project marketing.</div>` : ''}
    ${!d.connections.brain ? '<div class="banner">The Brain is offline: add ANTHROPIC_API_KEY in Vercel so the Content Engine can draft and the comments can be read.</div>' : ''}

    <main class="board">
      <div class="col">
        <section class="p"><div class="ph"><span class="n">01</span><h3>Signals</h3><span class="st ${d.counters.sources ? 'ok' : 'no'}">${d.counters.sources}/${d.counters.sourcesOf} live</span></div>
          <p class="sub">where every market and brand signal comes from</p><div class="tiles">${d.signals.map(tile).join('')}</div></section>
        <section class="p"><div class="ph"><span class="n">02</span><h3>System of record</h3><span class="st ok">Running</span></div>
          <p class="sub">the customer spine: one ERP, one lead list</p><div class="tiles">${d.record.map(tile).join('')}</div></section>
        <section class="p"><div class="ph"><h3>Owner input</h3><span class="st">Human-led</span></div>
          <p class="sub">what the one human sets</p>
          <div class="owner">
            <div class="kv"><span>Brand voice</span><b title="${e(o.voice)}">${e(o.voice || 'from the voice guide')}</b></div>
            <div class="kv"><span>Positioning</span><b title="${e(o.positioning)}">${e(o.positioning || 'from the facts')}</b></div>
            <div class="kv"><span>Budget cap</span><b>${o.budgetCap ? inr(o.budgetCap) + ' / month' : 'not set'}</b></div>
            <div class="kv"><span>Approval bar</span><b>${o.approvalBar === 'routine' ? 'Routine posts ship without me' : 'Everything comes to me'}</b></div>
            <div class="kv"><span>Posts a week</span><b>${e(o.postsPerWeek)}</b></div>
          </div>
          ${me.own ? '<button class="btn sm" id="ownerEdit" style="margin-top:9px">Change owner input</button>' : ''}</section>
        <section class="p"><div class="ph"><span class="n">03</span><h3>The Brain</h3><span class="st ${d.connections.brain ? 'ok' : 'no'}">${d.connections.brain ? 'Running' : 'Offline'}</span></div>
          <p class="sub">Claude reasons against the playbook; the knowledge layer is its memory</p><div class="tiles">${d.brain.map(tile).join('')}</div></section>
      </div>

      <div class="col">
        <section class="p"><div class="ph"><span class="n">04</span><h3>Orchestrator</h3><span class="st ${off ? 'no' : 'ok'}">${off ? 'Stopped' : 'Running'}</span></div>
          <p class="sub">every event enters here first; nothing publishes on its own</p>
          <div class="steps">${d.orchestrator.map((x) => `<div class="step${x.on ? '' : ' off'}${hotStep === x.id ? ' hot' : ''}"><b>${e(x.name)}</b><span>${e(x.sub)}</span></div>`).join('')}</div>
          <p class="note">Routine work runs end to end. Only budget, edge cases and ${o.approvalBar === 'routine' ? 'non-routine posts' : 'every post'} reach the owner. Last run: ${sc.lastRunAt ? ago(sc.lastRunAt) : 'not yet'} · every 30 minutes.</p></section>
        <section class="p dash"><div class="ph"><span class="n">05</span><h3>Knowledge layer + access</h3><span class="st ok">Running</span></div>
          <p class="sub">the brand brain, one shared workspace${d.project ? '; gold = this project’s own copy' : ''}</p>
          <div class="files">${d.knowledge.map((k) => `<button class="file${k.from === 'own' ? ' own' : ''}" data-kb="${e(k.path)}" title="${e(k.note)}"><b>${e(k.path)}</b><span>${e(k.title)} · ${k.from === 'own' ? 'this ' + (d.project ? 'project' : 'company') : k.from === 'company' ? 'company copy' : 'starter, edit me'}</span></button>`).join('')}</div>
          <div class="access">
            <button class="acc" id="aOwner">Owner input</button>
            <button class="acc" id="aQueue">Approval queue${queue ? `<em>${queue}</em>` : ''}</button>
            <button class="acc" id="aFeed">Activity log</button>
            <button class="acc" id="aPerm">Permissions</button>
            <button class="acc" id="aAlerts">Alerts${ownerOpen ? `<em>${ownerOpen}</em>` : ''}</button>
            ${me.own ? `<button class="acc kill" id="aKill">${d.killed ? 'Kill switch: ON' : 'Kill switch'}</button>` : '<span></span>'}
          </div></section>
      </div>

      <div class="col">
        <section class="p"><div class="ph"><span class="n">06</span><h3>Departments</h3><span class="st ${off ? 'no' : 'ok'}">${off ? 'Stopped' : 'Running'}</span></div>
          <p class="sub">eight departments an owner recognises; the orchestrator hands each one its work${me.edit ? ' · <a href="#" id="brief">give the Content Engine a brief</a> · <a href="#" id="funnels">comment-to-DM funnels</a> · <a href="#" id="templates">Canva templates</a>' : ''}</p>
          <div class="depts">${d.departments.map((x, i) => `<div class="dept" data-dept="${x.id}" aria-pressed="${S.focus === x.id}">
            <div class="ph"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${e(x.name)}</h3><span class="st ${x.on === x.of ? 'ok' : x.on ? '' : 'no'}">${x.on}/${x.of}</span></div>
            <div class="tiles">${x.tools.map(tile).join('')}</div>
            <div class="line">${e(x.line)}</div>
            <div class="bar"><i style="width:${Math.round((100 * x.on) / x.of)}%"></i></div></div>`).join('')}</div></section>
      </div>

      <div class="col">
        <section class="p"><div class="ph"><span class="n">07</span><h3>Engage</h3><span class="st ${d.connections.meta ? 'ok' : 'no'}">${d.connections.meta ? 'Running' : 'Waiting'}</span></div>
          <p class="sub">approved content goes out from one brain</p>
          <div class="tiles">${[{ name: 'Instagram', on: d.connections.instagram, needs: 'Instagram connected' }, { name: 'Facebook', on: d.connections.meta, needs: 'Facebook connected' }, { name: 'YouTube', on: d.connections.youtube, needs: 'YouTube connected' }, { name: 'LinkedIn', on: false, needs: 'LinkedIn' }, { name: 'WhatsApp', on: d.connections.whatsapp, needs: 'Click Connect' }, { name: 'Website', on: d.connections.website, needs: 'the website tracker' }].map(tile).join('')}</div>
          <p class="note">Audience: followers, buyers, channel partners, reviewers.</p></section>
        <section class="p"><div class="ph"><h3>What interrupts the loop</h3><span class="st ok">Watching</span></div>
          <p class="sub">moments that used to need a marketer at a desk, handled as they happen</p>
          <div class="trig">${d.triggers.map((t) => `<div class="tr${!t.live ? ' na' : t.owner ? ' owner' : t.count ? ' hot' : ' on'}" title="${e(t.needs ? 'Needs ' + t.needs : t.count ? t.count + ' in the last 7 days' : 'Watching')}"><i></i>${e(t.name)}<small>${!t.live ? 'needs ' + e(t.needs.split(' ')[0] + ' ' + (t.needs.split(' ')[1] || '')) : t.count ? (t.owner ? 'to you · ' : '') + ago(t.lastAt) : 'watching'}</small></div>`).join('')}</div></section>
      </div>
    </main>

    <section class="lower">
      <div class="p focus" id="focus"><div class="ph"><span class="n">AGENT IN FOCUS</span><h3>${focusDept ? e(focusDept.name) : 'The whole team'}</h3>${S.focus ? '<button class="btn sm" id="unfocus" style="margin-left:auto">Show everyone</button>' : `<span class="st">Topic · ${e(d.project ? d.project.name : 'Dream India brand')}</span>`}</div>
        <p class="sub">${focusDept ? e(focusDept.tools.map((t) => t.name).join(' · ')) : 'Who briefed whom, what was drafted, what came to you. Tap a department to follow it.'}</p>
        ${focusDept && focusDept.id === 'results' ? `<p class="sub"><a href="/#/marketing${d.project ? '/' + d.project.id : ''}">The full figures (spend, cost per lead, visits and bookings) are in Sales &amp; Marketing → Results ↗</a>. This team only watches them and tells you when something changes.</p>` : ''}
        ${focusDept && /telecall|partner/i.test(focusDept.tools.map((t) => t.name).join(' ')) ? '<p class="sub"><a href="/#/telemarketing">Telecalling and partner uploads are run in Telemarketing ↗</a></p>' : ''}
        <div class="voice">Voice: ${e(o.voice || 'warm, confident, no hard sell')}. ${o.approvalBar === 'routine' ? 'Routine posts can ship without me.' : 'Every post comes to me first.'}</div>
        <div class="feed">${feed.length ? feed.map((x) => { const [a, c] = AG[x.agent] || ['·', '#3F4654']; return `<div class="ev ${e(x.kind)}"><div class="h"><span class="dot" style="background:${c}">${a}</span><b>${e(agName(x.agent))}</b>${x.to_agent ? '→ ' + e(agName(x.to_agent)) : ''}<time>${hm(x.at)}</time></div><p>${e(x.text)}</p></div>`; }).join('') : '<div class="empty">Nothing yet. Press “Run now”, or wait for the next run (every 30 minutes).</div>'}</div></div>
      <div class="term" id="term"><div class="hd"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i>&nbsp;agents · live terminal</div>${d.events.slice(-60).map((x) => x.kind === 'log' ? `<span class="d">${hm(x.at)}</span> <span class="w">$</span> ${e(x.text)}` : `<span class="d">${hm(x.at)}</span> <span class="k">${e(String(x.agent).replace(/-/g, '_'))}</span>${x.to_agent ? ' → ' + e(String(x.to_agent).replace(/-/g, '_')) : ''}.${e(x.kind)}("${e(x.text.slice(0, 120))}${x.text.length > 120 ? '…' : ''}")`).join('\n') || '<span class="d">waiting for the first run…</span>'}</div>
      <div class="p" id="you"><div class="ph"><h3>Waiting for you</h3><span class="st">${queue + ownerOpen}</span></div>
        <p class="sub">All you have to do is check &amp; approve.</p>
        <div class="queue">
          ${d.queue.length ? `<div class="sub" style="margin:2px 0 0;font-weight:600;color:var(--ink,#101828)">Drafts to approve (${d.queue.length})</div>` : ''}
          ${d.queue.map((p) => `<div class="q">${(() => { const im = (p.files || []).filter((x) => /^image\//.test(x.mime)), f = im[im.length - 1];
              if (p.kind === 'carousel' && im.length > 1) return `<div style="display:flex;gap:6px;overflow-x:auto;margin:0 0 6px">${im.map((x, i) => `<a href="/api/marketing?pfile=${x.id}" target="_blank" rel="noopener" title="Slide ${i + 1}"><img src="/api/marketing?pfile=${x.id}" alt="Slide ${i + 1}" loading="lazy" style="height:200px;border-radius:8px;display:block"></a>`).join('')}</div>`;
              return f ? `<a href="/api/marketing?pfile=${f.id}" target="_blank" rel="noopener"><img src="/api/marketing?pfile=${f.id}" alt="" loading="lazy" style="width:100%;border-radius:8px;margin:0 0 6px;display:block"></a>` : (p.files || []).length ? '' : '<div style="font-size:11.5px;color:#B54708;margin:0 0 4px">No design attached yet</div>'; })()}<h4>${e(p.title)}</h4><div class="meta">${e(p.kind)} · ${e((p.channels || []).join(', '))}${p.publish_at ? ' · ' + new Date(p.publish_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}${p.agent ? ' · <span class="tag">AI draft</span>' : ''}</div><p>${e(p.caption || '')}</p>
            <div class="acts">${me.own ? `<button class="btn sm pri" data-approve="${p.id}">Approve</button><button class="btn sm" data-back="${p.id}">Send back</button>` : ''}${me.edit ? `<button class="btn sm" data-design="${p.id}">${(p.files || []).length ? 'Redo the design' : 'Design in Canva'}</button>` : ''}<button class="btn sm" data-view="${p.id}">Read all</button></div></div>`).join('')}
          ${d.owner.length ? `<div class="sub" style="margin:6px 0 0;font-weight:600;color:var(--ink,#101828)">Alerts (${d.owner.length})</div>` : ''}
          ${d.owner.map((x) => { const m = x.detail || {}; return `<div class="om"><b>${e(x.kind.replace(/_/g, ' '))}</b> · <span style="color:var(--mut)">${ago(x.at)}</span><div>${e(m.msg || '')}</div>${m.link ? `<a href="${e(m.link)}" target="_blank" rel="noopener">Open the post</a>` : ''}${me.own ? `<div class="acts"><button class="btn sm" data-done="${x.id}">Dealt with</button></div>` : ''}</div>`; }).join('')}
          ${!d.queue.length && !d.owner.length ? '<div class="empty">Nothing waiting. The team is on routine work.</div>' : ''}
        </div></div>
    </section>

    <section class="counters">
      <div class="ct"><b>${d.counters.sources}</b><span>Signal sources</span></div>
      <div class="ct"><b>${d.counters.topics}</b><span>Topics flagged · 30d</span></div>
      <div class="ct"><b>${d.counters.drafts}</b><span>Drafts written · 30d</span></div>
      <div class="ct"><b>${d.counters.assets}</b><span>Assets built · 30d</span></div>
      <div class="ct"><b>${d.counters.scheduled}</b><span>Posts scheduled · 30d</span></div>
      <div class="ct"><b>${d.counters.leads}</b><span>Leads · 30d</span></div>
      <div class="ct"><b>${d.counters.visits} / ${d.counters.booked}</b><span>Site visits / bookings</span></div>
      <div class="ct hl"><b>${d.counters.waiting}</b><span>Waiting for you</span></div>
    </section>
    <div class="loop">Results feed signals again ↺</div>`;
    bind();
    const t = $('#term'); if (t) t.scrollTop = t.scrollHeight;
    tickClock();
  }

  function tickClock() { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST'; }
  setInterval(tickClock, 1000);

  function bind() {
    const d = S.d;
    $('#scope').addEventListener('change', (ev) => { S.scope = ev.target.value; S.focus = null; try { localStorage.setItem('erp_agents_scope', S.scope); } catch { /* */ } history.replaceState(null, '', '#' + S.scope); load(); });
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', (ev) => { ev.preventDefault(); fn(ev); }); };
    on('runNow', async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Running…'; try { const r = await api({ action: 'run' }); toast(r.skipped ? 'Skipped: ' + r.skipped : r.flagged.length ? `Handled: ${r.flagged.join(', ').replace(/_/g, ' ')}${r.drafts ? ` · ${r.drafts} drafts written` : ''}` : 'Nothing new needs a brief right now.'); } catch (x) { toast(x.message, true); } load(); });
    on('enableHere', () => saveScope({ enabled: true, paused: false }));
    on('ownerEdit', ownerDlg); on('aOwner', () => (d.me.own ? ownerDlg() : toast('Management sets the owner input.')));
    on('aQueue', () => $('#you').scrollIntoView({ behavior: 'smooth' })); on('toDrafts', () => $('#you').scrollIntoView({ behavior: 'smooth' })); on('reraQr', () => $('#reraQrFile').click());
    const qf = $('#reraQrFile'); if (qf) qf.onchange = () => { const f = qf.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = async () => { try { await api({ action: 'qr.upload', projectId: d.project.id, data: rd.result }); await load(); toast('MahaRERA QR saved. Every new design of this project carries it.'); } catch (e) { toast(e.message, true); } }; rd.readAsDataURL(f); }; on('aAlerts', () => $('#you').scrollIntoView({ behavior: 'smooth' }));
    on('aFeed', () => { S.focus = null; render(); $('#focus').scrollIntoView({ behavior: 'smooth' }); });
    on('aPerm', permDlg); on('aKill', killDlg); on('brief', briefDlg); on('funnels', funnelsDlg);
    on('templates', templatesDlg);
    $$('[data-design]').forEach((el) => el.addEventListener('click', async () => { el.disabled = true; el.textContent = 'Designing…'; try { const r = await api({ action: 'post.design', id: +el.dataset.design }); toast(r.added ? 'Designed in Canva and attached.' : 'Made in Canva; open it there to export.'); } catch (x) { toast(x.message, true); } load(); }));
    on('unfocus', () => { S.focus = null; render(); });
    $$('.dept').forEach((el) => el.addEventListener('click', () => { S.focus = S.focus === el.dataset.dept ? null : el.dataset.dept; render(); if (S.focus) $('#focus').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }));
    $$('[data-kb]').forEach((el) => el.addEventListener('click', () => kbDlg(el.dataset.kb)));
    $$('[data-approve]').forEach((el) => el.addEventListener('click', async () => { el.disabled = true; try { await api({ action: 'post.approve', id: +el.dataset.approve }); toast('Approved. It goes out once the design is attached and it is scheduled.'); } catch (x) { toast(x.message, true); } load(); }));
    $$('[data-back]').forEach((el) => el.addEventListener('click', () => sendBackDlg(+el.dataset.back)));
    $$('[data-view]').forEach((el) => el.addEventListener('click', () => viewDlg(+el.dataset.view)));
    $$('[data-done]').forEach((el) => el.addEventListener('click', async () => { el.disabled = true; try { await api({ action: 'owner.done', id: +el.dataset.done }); } catch (x) { toast(x.message, true); } load(); }));
  }

  // ---------- dialogs ----------
  function dialog(title, body, actions) {
    const dl = document.createElement('dialog');
    dl.innerHTML = `<div class="dh"><h2>${e(title)}</h2><button class="btn sm" data-x>Close</button></div><div class="db">${body}</div>${actions ? `<div class="df">${actions}</div>` : ''}`;
    document.body.appendChild(dl); dl.showModal();
    dl.addEventListener('close', () => dl.remove());
    $('[data-x]', dl).addEventListener('click', () => dl.close());
    return dl;
  }
  async function saveScope(x) { try { await api({ action: 'scope.save', ...x }); toast('Saved.'); } catch (er) { toast(er.message, true); } load(); }

  function ownerDlg() {
    const sc = S.d.settings, o = sc.owner;
    const dl = dialog('Owner input · ' + (S.d.project ? S.d.project.name : 'Company'), `
      <div class="fld"><label>Brand voice</label><textarea id="oVoice" placeholder="Warm, confident, no hard sell…">${e(o.voice)}</textarea><small>How every draft should sound. The voice guide in the knowledge layer has the detail.</small></div>
      <div class="fld"><label>Positioning</label><textarea id="oPos" placeholder="e.g. Family homes near the metro, by the redevelopment specialists of Mumbai">${e(o.positioning)}</textarea></div>
      <div class="row2"><div class="fld"><label>Monthly ad budget cap (₹)</label><input id="oCap" inputmode="numeric" value="${e(o.budgetCap || '')}" placeholder="not set"><small>Spending money always comes to you.</small></div>
        <div class="fld"><label>Posts a week</label><input id="oPpw" type="number" min="1" max="14" value="${e(o.postsPerWeek)}"><small>Below half of this in the next 7 days, the Content Engine drafts more.</small></div></div>
      <div class="fld"><label>Approval bar</label><div class="seg"><button class="btn" data-bar="all" aria-pressed="${o.approvalBar !== 'routine'}">Everything comes to me</button><button class="btn" data-bar="routine" aria-pressed="${o.approvalBar === 'routine'}">Routine posts ship without me</button></div>
        <small>Routine = no price, offer or rupee figure. Pre-RERA projects always come to you. Start with “Everything comes to me” for the first weeks.</small></div>
      <div class="row2"><div class="fld"><label>Agents for this ${S.d.project ? 'project' : 'company'}</label><div class="seg"><button class="btn" data-en="1" aria-pressed="${sc.enabled}">On</button><button class="btn" data-en="0" aria-pressed="${!sc.enabled}">Off</button></div></div>
        <div class="fld"><label>Pause</label><div class="seg"><button class="btn" data-pa="0" aria-pressed="${!sc.paused}">Running</button><button class="btn" data-pa="1" aria-pressed="${sc.paused}">Paused</button></div></div></div>`,
      '<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Save</button>');
    const seg = (attr) => $$(`[${attr}]`, dl).forEach((b) => b.addEventListener('click', () => $$(`[${attr}]`, dl).forEach((x) => x.setAttribute('aria-pressed', String(x === b)))));
    seg('data-bar'); seg('data-en'); seg('data-pa');
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => {
      await saveScope({ enabled: $('[data-en="1"]', dl).getAttribute('aria-pressed') === 'true', paused: $('[data-pa="1"]', dl).getAttribute('aria-pressed') === 'true',
        owner: { voice: $('#oVoice', dl).value, positioning: $('#oPos', dl).value, budgetCap: $('#oCap', dl).value, postsPerWeek: $('#oPpw', dl).value, approvalBar: $('[data-bar="routine"]', dl).getAttribute('aria-pressed') === 'true' ? 'routine' : 'all' } });
      dl.close();
    });
  }

  function kbDlg(path) {
    const k = S.d.knowledge.find((x) => x.path === path), me = S.d.me;
    const from = k.from === 'own' ? `This ${S.d.project ? 'project' : 'company'}’s own copy` : k.from === 'company' ? 'Using the company’s copy: saving makes a copy for this project' : 'Starter text: correct it and save';
    const dl = dialog(path, `<div class="fld"><label>${e(k.title)}: ${e(k.note)}</label><small>${e(from)}${k.updatedAt ? ' · updated ' + ago(k.updatedAt) : ''}</small>
      <textarea id="kbBody" class="big"${me.edit ? '' : ' readonly'}>${e(k.body)}</textarea></div>`,
      me.edit ? `${k.from === 'own' && S.d.project ? '<button class="btn" data-reset>Use the company copy</button>' : ''}<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Save</button>` : '');
    if (!me.edit) return;
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => { try { await api({ action: 'kb.save', path, body: $('#kbBody', dl).value }); toast('Saved. Every agent reads it from now on.'); dl.close(); load(); } catch (x) { toast(x.message, true); } });
    const r = $('[data-reset]', dl); if (r) r.addEventListener('click', async () => { try { await api({ action: 'kb.reset', path }); dl.close(); load(); } catch (x) { toast(x.message, true); } });
  }

  function briefDlg() {
    const dl = dialog('Brief the Content Engine', `
      <div class="fld"><label>What should the drafts be about?</label><textarea id="bAngle" placeholder="e.g. Goregaon East: the metro, schools and Film City road; why families are moving there"></textarea>
        <small>${S.d.preRera ? 'Pre-RERA: the drafts will be about the area and Dream India only.' : 'Drafts land in “Waiting for you” and in the Content calendar.'}</small></div>
      <div class="fld"><label>How many</label><input id="bN" type="number" min="1" max="5" value="3"></div>`,
      '<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Draft them</button>');
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async (ev) => { ev.target.disabled = true; ev.target.textContent = 'The Content Engine is writing…'; try { const r = await api({ action: 'draft', angle: $('#bAngle', dl).value, n: +$('#bN', dl).value }); toast(`${r.posts.length} drafts ready for you.`); dl.close(); load(); } catch (x) { toast(x.message, true); ev.target.disabled = false; ev.target.textContent = 'Draft them'; } });
  }

  function viewDlg(id) {
    const p = S.d.queue.find((x) => x.id === id); if (!p) return;
    const dl = dialog(p.title, `<div class="meta" style="font:12px var(--mono);color:var(--mut)">${e(p.kind)} · ${e((p.channels || []).join(', '))}${p.publish_at ? ' · planned ' + new Date(p.publish_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : ''}</div>
      ${(p.files || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${p.files.map((f) => /^image\//.test(f.mime) ? `<a href="/api/marketing?pfile=${f.id}" target="_blank" rel="noopener"><img src="/api/marketing?pfile=${f.id}" alt="" style="max-width:100%;max-height:420px;border-radius:10px;border:1px solid var(--line)"></a>` : `<a class="btn sm" href="/api/marketing?pfile=${f.id}" target="_blank" rel="noopener">Open ${/video/.test(f.mime) ? 'the video' : 'the PDF'} ↗</a>`).join('')}</div>` : '<div style="color:#B54708;font-size:12.5px">No design attached yet: it will not be posted until one is.</div>'}
      <div style="white-space:pre-wrap;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px">${e(p.caption)}</div>
      <div style="white-space:pre-wrap;color:var(--mut);font-size:12.5px">${e(p.note || '')}</div>
      <small style="color:var(--mut)">Change the words, attach the design or schedule it in <a href="/#/marketing${S.d.project ? '/' + S.d.project.id : ''}">Sales &amp; Marketing → Content calendar</a>.</small>`,
      S.d.me.own ? `<button class="btn" data-back2>Send back</button><button class="btn pri" data-ok>Approve</button>` : '');
    if (!S.d.me.own) return;
    $('[data-ok]', dl).addEventListener('click', async () => { try { await api({ action: 'post.approve', id }); toast('Approved.'); dl.close(); load(); } catch (x) { toast(x.message, true); } });
    $('[data-back2]', dl).addEventListener('click', () => { dl.close(); sendBackDlg(id); });
  }
  function sendBackDlg(id) {
    const dl = dialog('Send it back', '<div class="fld"><label>What should change?</label><textarea id="sbNote"></textarea></div>', '<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Send back</button>');
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => { try { await api({ action: 'post.sendback', id, note: $('#sbNote', dl).value }); toast('Sent back to the team.'); dl.close(); load(); } catch (x) { toast(x.message, true); } });
  }

  function permDlg() {
    dialog('Permissions', `<div style="display:grid;gap:8px;font-size:13.5px">
      <div><b>Management (the owner)</b>: owner input, approval bar, budget cap, approve or send back drafts, switch funnels to live, the kill switch.</div>
      <div><b>Marketing team (Rupali)</b>: knowledge files, briefs to the Content Engine, comment-to-DM funnels (test accounts), Run now.</div>
      <div><b>Everyone with Sales &amp; Marketing</b>: sees this screen for their own projects.</div>
      <div><b>The agents</b>: draft, read, score, DM people who commented a keyword, and add leads. They never publish, spend money or message anyone who did not contact us first.</div>
      <div style="color:var(--mut)">Every change here is in the ERP’s audit log.</div></div>`);
  }
  function killDlg() {
    const on = !S.d.killed;
    const dl = dialog(on ? 'Stop every agent?' : 'Switch the kill switch off?', `<p style="margin:0">${on ? 'Every agent in every project stops at once: no runs, no drafts, no DMs. Leads already in the ERP are not touched.' : 'The agents go back to work on their next run.'}</p>`,
      `<button class="btn" data-x2>Cancel</button><button class="btn ${on ? 'danger' : 'pri'}" aria-pressed="${on}" data-save>${on ? 'Stop everything' : 'Start again'}</button>`);
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => { try { await api({ action: 'kill', on }); dl.close(); load(); } catch (x) { toast(x.message, true); } });
  }

  // ---------- comment-to-DM funnels ----------
  function dmDefault() {
    const p = S.d.project;
    if (S.d.preRera) return `Hi! Thanks for your comment 🙂 We'll send you ${p && p.location ? p.location + ' ' : ''}area updates and Dream India's launch news first. If you'd like a call from our team, just reply with your mobile number. (By sharing it you agree Dream India Realty may call or WhatsApp you about its homes.)`;
    if (p) return `Hi! Thanks for asking about ${p.name} 🙂 Reply with your mobile number and our team will call you with the floor plans and prices. (By sharing it you agree Dream India Realty may call or WhatsApp you about its homes.)`;
    return `Hi! Thanks for your comment 🙂 Reply with your mobile number and our team will call you with details of our homes. (By sharing it you agree Dream India Realty may call or WhatsApp you about its homes.)`;
  }
  // ---------- Creative Studio: which Canva brand template each kind of post is designed from ----------
  async function templatesDlg() {
    let r; try { r = await api({ action: 'canva.templates' }); } catch (x) { toast(x.message, true); return; }
    const kinds = [['default', 'Any post (default)'], ['post', 'Single image post'], ['carousel', 'Carousel'], ['reel', 'Reel cover'], ['story', 'Story']];
    const opt = (k) => `<option value="">${k === 'default' ? 'none' : 'use the default'}</option>` + r.templates.map((t) => `<option value="${e(t.id)}"${r.chosen[k] === t.id ? ' selected' : ''}>${e(t.title)}</option>`).join('');
    const dl = dialog('Canva templates · ' + (S.d.project ? S.d.project.name : 'Company'), `
      <p style="margin:0;color:var(--mut);font-size:13px">The Creative Studio fills the chosen Canva brand template with each draft's headline, line and call to action, then attaches the design to the post. ${r.templates.length ? '' : '<b style="color:#B54708">No brand templates with data fields yet: in Canva, make a design, name its text boxes in Apps → Data autofill (e.g. headline, subline, cta, rera), then publish it as a brand template.</b>'}${S.d.project ? ' A project without its own choice uses the company’s.' : ''}</p>
      ${kinds.map(([k, l]) => `<div class="fld"><label>${l}</label><select data-k="${k}">${opt(k)}</select></div>`).join('')}`,
      '<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Save</button>');
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => { const templates = {}; $$('[data-k]', dl).forEach((s2) => { if (s2.value) templates[s2.dataset.k] = s2.value; }); try { await api({ action: 'templates.save', templates }); toast('Saved. New drafts are designed from these.'); dl.close(); load(); } catch (x) { toast(x.message, true); } });
  }

  function funnelsDlg() {
    const d = S.d, fs = d.funnels;
    const fst = d.funnelStatus && d.funnelStatus.info;
    const dl = dialog('Comment-to-DM funnels', `
      <p style="margin:0;color:var(--mut);font-size:13px">A post says “Comment <b>WORD</b> for the details”. Everyone who comments the word gets a private DM within about 10 minutes; whoever replies with a mobile number becomes a lead, goes to sales and gets the WhatsApp welcome. Only people who asked are contacted.
      A new funnel DMs your test accounts only, until Management switches it to live.${!d.connections.meta ? '<br><b style="color:#B26B00">Connect Facebook / Instagram in Sales &amp; Marketing → Set-up first.</b>' : ''}${fst && fst.errors && fst.errors.length ? `<br><b style="color:var(--red)">Last check: ${e(fst.errors[0])}</b>` : ''}</p>
      ${fs.map((f) => `<div class="fn"><div class="t"><b>${e(f.keyword)}</b><span class="pill">${e(f.network)}</span><span class="pill${f.active ? ' on' : ''}">${f.active ? 'On' : 'Off'}</span><span class="pill${f.live ? ' live' : ''}">${f.live ? 'Live: everyone' : 'Test accounts only'}</span>
          <span style="margin-left:auto;font:12px var(--mono);color:var(--mut)">${f.hits} comments · ${f.dms} DMs · ${f.leads} leads</span></div>
        <div style="font-size:12.5px;color:#3B414C;white-space:pre-wrap">${e(f.dm_text)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${d.me.edit ? `<button class="btn sm" data-ft="${f.id}" data-on="${f.active ? 0 : 1}">${f.active ? 'Switch off' : 'Switch on'}</button><button class="btn sm" data-fe="${f.id}">Edit</button>` : ''}
          ${d.me.own ? `<button class="btn sm${f.live ? '' : ' pri'}" data-fl="${f.id}" data-on="${f.live ? 0 : 1}">${f.live ? 'Back to test accounts' : 'Go live'}</button>` : ''}${d.me.edit ? `<button class="btn sm danger" data-fd="${f.id}">Delete</button>` : ''}</div></div>`).join('') || '<div class="empty">No funnels yet.</div>'}
      ${d.me.edit ? '<button class="btn pri" data-new>New funnel</button>' : ''}`);
    const act = (sel, fn) => $$(sel, dl).forEach((b) => b.addEventListener('click', async () => { try { await fn(b); dl.close(); await load(); funnelsDlg(); } catch (x) { toast(x.message, true); } }));
    act('[data-ft]', (b) => api({ action: 'funnel.toggle', id: +b.dataset.ft, on: b.dataset.on === '1' }));
    act('[data-fl]', (b) => api({ action: 'funnel.live', id: +b.dataset.fl, on: b.dataset.on === '1' }));
    act('[data-fd]', (b) => (confirm('Delete this funnel?') ? api({ action: 'funnel.delete', id: +b.dataset.fd }) : Promise.reject(new Error('Not deleted.'))));
    $$('[data-fe]', dl).forEach((b) => b.addEventListener('click', () => { dl.close(); funnelEdit(fs.find((x) => x.id === +b.dataset.fe)); }));
    const n = $('[data-new]', dl); if (n) n.addEventListener('click', () => { dl.close(); funnelEdit(null); });
  }
  function funnelEdit(f) {
    const dl = dialog(f ? 'Edit funnel ' + f.keyword : 'New comment-to-DM funnel', `
      <div class="row2"><div class="fld"><label>Keyword</label><input id="fK" value="${e(f ? f.keyword : '')}" placeholder="${S.d.preRera ? 'UPDATES' : 'PRICE'}"><small>One word. The post says “Comment ${e(f ? f.keyword : 'WORD')} …”.</small></div>
        <div class="fld"><label>Network</label><select id="fN"><option value="instagram"${!f || f.network === 'instagram' ? ' selected' : ''}>Instagram</option><option value="facebook"${f && f.network === 'facebook' ? ' selected' : ''}>Facebook</option></select></div></div>
      <div class="fld"><label>The DM they get</label><textarea id="fD">${e(f ? f.dm_text : dmDefault())}</textarea><small>Keep the consent line. ${S.d.preRera ? 'Pre-RERA: no prices, units or booking.' : ''}</small></div>
      <div class="fld"><label>Public reply under the comment (optional)</label><input id="fP" value="${e(f ? f.public_reply || '' : 'Sent you a DM 📩')}"></div>
      <div class="fld"><label>Thank-you once they send a number (optional)</label><input id="fT" value="${e(f ? f.thanks_text || '' : 'Thank you! Our team will call you shortly. 🙏')}"></div>
      <div class="row2"><div class="fld"><label>Only on one post (optional)</label><input id="fM" value="${e(f ? f.media_ext || '' : '')}" placeholder="post id; empty = every recent post"></div>
        <div class="fld"><label>Test accounts</label><input id="fH" value="${e(f ? (f.test_handles || []).join(', ') : '')}" placeholder="@rupali, @yourhandle"><small>Until it goes live, only these get the DM.</small></div></div>`,
      '<button class="btn" data-x2>Cancel</button><button class="btn pri" data-save>Save</button>');
    $('[data-x2]', dl).addEventListener('click', () => dl.close());
    $('[data-save]', dl).addEventListener('click', async () => {
      try { await api({ action: 'funnel.save', id: f ? f.id : null, keyword: $('#fK', dl).value, network: $('#fN', dl).value, dmText: $('#fD', dl).value, publicReply: $('#fP', dl).value, thanksText: $('#fT', dl).value, mediaExt: $('#fM', dl).value, testHandles: $('#fH', dl).value }); dl.close(); await load(); funnelsDlg(); }
      catch (x) { toast(x.message, true); }
    });
  }

  async function load() {
    if (S.busy) return; S.busy = true;
    try { S.d = await api(); if (!document.querySelector('dialog[open]')) render(); }
    catch (x) { if (!S.d) $('#app').innerHTML = `<div class="boot">${e(x.message)}<br><br><a href="/">Back to the ERP</a></div>`; else toast(x.message, true); }
    finally { S.busy = false; }
  }
  load();
  S.timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20000);
})();
