// Marketing & social media (company-wide or by project): channels and their figures (from Metricool each night),
// the content calendar with Canva links, leads by source, campaigns and spend, the design library from Google Drive,
// the marketing team's tasks, and set-up. Mounted by app.js: window.Marketing.render(ctx, scope, tab).
(function () {
  const NET = {
    instagram: { n: 'Instagram', c: '#E1306C', g: 'linear-gradient(135deg,#FEDA75,#FA7E1E 30%,#D62976 60%,#962FBF 85%,#4F5BD5)', d: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5.5-1.5h.01' },
    facebook: { n: 'Facebook', c: '#1877F2', g: 'linear-gradient(135deg,#1877F2,#0A4FB3)', d: 'M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H5.5v3.5H8V21h3.5v-7.5H14l.6-3.5h-3.1V7.8c0-.8.5-1.3 1.3-1.3H15Z' },
    youtube: { n: 'YouTube', c: '#FF0000', g: 'linear-gradient(135deg,#FF4E45,#C4000C)', d: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z' },
    linkedin: { n: 'LinkedIn', c: '#0A66C2', g: 'linear-gradient(135deg,#0A66C2,#004182)', d: 'M4 9h3.5v11H4Zm1.8-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM10 9h3.3v1.6c.5-.9 1.7-1.9 3.5-1.9 3.7 0 4.2 2.3 4.2 5.3V20h-3.5v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H10Z' },
    website: { n: 'Website', c: '#0E8C9B', g: 'linear-gradient(135deg,#14B8A6,#0E7490)', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z' },
    whatsapp: { n: 'WhatsApp', c: '#25D366', g: 'linear-gradient(135deg,#25D366,#128C7E)', d: 'M4 20l1.3-4A8 8 0 1 1 8 18.7Zm5-11c0 3.3 2.7 6 6 6l1-1.5-1.8-1-1 .8a4 4 0 0 1-2.5-2.5l.8-1-1-1.8Z' },
    google: { n: 'Google', c: '#EA4335', g: 'linear-gradient(135deg,#4285F4,#34A853 40%,#FBBC05 70%,#EA4335)', d: 'M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5a4.3 4.3 0 0 1-1.9 2.8v2.3h3A9 9 0 0 0 21 12.2ZM12 21c2.4 0 4.5-.8 6-2.2l-3-2.3c-.8.6-1.8.9-3 .9a5.3 5.3 0 0 1-5-3.6H4v2.4A9 9 0 0 0 12 21Z' },
  };
  const SRC = { instagram: 'Instagram', facebook: 'Facebook', meta_ads: 'Meta ads', google_ads: 'Google ads', youtube: 'YouTube', website: 'Website', whatsapp: 'WhatsApp', '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', walk_in: 'Walk-in', referral: 'Referral', channel_partner: 'Channel partner', telecalling: 'Telecalling', hoarding: 'Hoarding', event: 'Event / exhibition', other: 'Other' };
  const ST = { idea: ['Idea', '#98A2B3'], draft: ['Draft', '#667085'], review: ['Waiting for approval', '#DC6803'], approved: ['Approved', '#7A5AF8'], scheduled: ['Scheduled', '#2E90FA'], published: ['Published', '#12B76A'] };
  const LST = { new: ['New', '#2E90FA'], contacted: ['Contacted', '#7A5AF8'], visit: ['Site visit', '#DC6803'], booked: ['Booked', '#12B76A'], lost: ['Lost', '#98A2B3'] };
  const KIND = { post: 'Post', reel: 'Reel', story: 'Story', video: 'Video', carousel: 'Carousel', ad: 'Ad', brochure: 'Brochure', email: 'Email', other: 'Other' };
  const LIB = [['brochure', 'Brochures', /brochure|leaflet|flyer|e-?book|catalog/i], ['floor', 'Floor plans', /floor ?plan|unit ?plan|typical|layout|carpet/i], ['elev', 'Elevations', /elevation|facade|fa[cç]ade/i],
    ['render', '3D renders', /render|3d|view|perspective|aerial|walkthrough|cgi/i], ['amenity', 'Amenities', /amenit|club|pool|gym|garden|lobby|podium|terrace/i], ['drawing', '2D drawings', /2d|drawing|dwg|section|site ?plan|master ?plan|plan/i],
    ['video', 'Videos', /\.(mp4|mov|avi|mkv)$|video|reel/i], ['brand', 'Logos & brand', /logo|brand|font|guideline|letterhead/i], ['social', 'Social media', /insta|post|story|creative|social|facebook|youtube/i]];
  let C = null, D = null, S = { tab: 'overview', month: null, leadF: 'all', leadQ: '', libF: 'all', lib: null, libFor: null };

  const css = `
  .mk{--ink:#10114e;--mut:#667085;--line:#EAECF0;--card:#fff;--soft:#F7F7FB}
  .mk .mk-hero{background:radial-gradient(1200px 400px at 85% -60%,#7A5AF8 0,transparent 60%),radial-gradient(800px 300px at 0% 120%,#E1306C33 0,transparent 60%),linear-gradient(135deg,#140C59,#2A1E7A);color:#fff;border-radius:20px;padding:22px 24px 18px;margin:0 0 16px;position:relative;overflow:hidden}
  .mk .mk-hero h1{color:#fff;margin:2px 0 4px;font-size:26px;letter-spacing:-.01em}.mk .mk-hero p{margin:0;color:#D9D6FE;font-size:14px}
  .mk .mk-eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#BDB4FE;font-weight:700}
  .mk .mk-scope{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.mk .mk-scope button{background:#ffffff1f;color:#fff;border:1px solid #ffffff33;border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer}
  .mk .mk-scope button[aria-pressed=true]{background:#fff;color:#140C59;border-color:#fff}
  .mk .mk-sync{position:absolute;right:20px;top:18px;font-size:12px;color:#D9D6FE;text-align:right}
  .mk .mk-tabs{display:flex;gap:4px;overflow-x:auto;margin:0 0 16px;padding:4px;background:var(--soft);border-radius:12px;scrollbar-width:none}
  .mk .mk-tabs button{border:0;background:none;padding:9px 14px;border-radius:9px;font-weight:600;color:var(--mut);white-space:nowrap;cursor:pointer;font-size:14px}.mk .mk-tabs button[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px #1018281a}
  .mk .mk-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
  .mk .mk-kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}.mk .mk-kpi b{display:block;font-size:24px;color:var(--ink);letter-spacing:-.02em}.mk .mk-kpi span{font-size:13px;color:var(--mut)}
  .mk .mk-up,.mk .mk-kpi .mk-up,.mk .mk-chan .mk-up{color:#079455;font-weight:700;font-size:12px}.mk .mk-down,.mk .mk-kpi .mk-down,.mk .mk-chan .mk-down{color:#D92D20;font-weight:700;font-size:12px}
  .mk .mk-chans{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:16px}
  .mk .mk-chan{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
  .mk .mk-chan .ctop{padding:14px 16px;color:#fff;display:flex;align-items:center;gap:10px}.mk .mk-chan .ctop svg{width:26px;height:26px}.mk .mk-chan .ctop b{font-size:16px}.mk .mk-chan .ctop small{display:block;opacity:.9;font-size:12px}
  .mk .mk-chan .fig{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:14px 16px}.mk .mk-chan .fig div b{display:block;font-size:20px;color:var(--ink)}.mk .mk-chan .fig div span{font-size:12px;color:var(--mut)}
  .mk .mk-chan .spark{padding:0 12px 10px}.mk .mk-chan .foot{border-top:1px solid var(--line);padding:9px 16px;font-size:12px;color:var(--mut);display:flex;justify-content:space-between;gap:8px}
  .mk .mk-grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:14px}@media(max-width:900px){.mk .mk-grid2{grid-template-columns:1fr}.mk .mk-sync{position:static;margin-top:8px;text-align:left}.mk .mk-hero{padding:16px 16px 14px}.mk .mk-hero h1{font-size:21px}.mk .mk-hero p{font-size:13px}.mk .mk-kpi b{font-size:20px}}
  .mk .mk-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px}.mk .mk-card h3{margin:0 0 10px;font-size:15px;color:var(--ink)}
  .mk .mk-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}.mk .mk-row:first-of-type{border-top:0}
  .mk .mk-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--soft);color:var(--ink);white-space:nowrap}
  .mk .mk-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
  .mk-ic{width:18px;height:18px;flex:none;vertical-align:middle}.mk .mk-bar{height:8px;background:var(--soft);border-radius:99px;overflow:hidden}.mk .mk-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#7A5AF8,#E1306C)}
  .mk .mk-funnel{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.mk .mk-funnel div{background:var(--soft);border-radius:12px;padding:10px;text-align:center}.mk .mk-funnel b{display:block;font-size:20px;color:var(--ink)}.mk .mk-funnel span{font-size:12px;color:var(--mut)}
  .mk .mk-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.mk .mk-cal .h{font-size:12px;font-weight:700;color:var(--mut);text-align:center;padding:4px}
  .mk .mk-cal .d{min-height:104px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;display:flex;flex-direction:column;gap:4px;cursor:pointer}.mk .mk-cal .d.o{opacity:.45}.mk .mk-cal .d.t{border-color:#7A5AF8;box-shadow:0 0 0 2px #7A5AF833}
  .mk .mk-cal .d .n{font-size:12px;font-weight:700;color:var(--mut)}.mk .mk-cal .chip{font-size:11px;font-weight:600;border-radius:7px;padding:3px 6px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media(max-width:700px){.mk .mk-cal{grid-template-columns:1fr}.mk .mk-cal .h{display:none}.mk .mk-cal .d{min-height:0}.mk .mk-cal .d.o{display:none}.mk .mk-cal .d.e{display:none}}
  .mk .mk-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.mk .mk-lib a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--ink)}
  .mk .mk-lib .th{aspect-ratio:4/3;background:var(--soft) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px;font-weight:700}.mk .mk-lib .nm{padding:8px 10px;font-size:13px;font-weight:600;line-height:1.3;word-break:break-word}.mk .mk-lib .nm small{display:block;font-weight:400;color:var(--mut);font-size:11px;margin-top:2px}
  .mk .mk-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.mk .mk-chips button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-weight:600;font-size:13px;cursor:pointer;color:var(--ink)}.mk .mk-chips button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
  .mk .mk-camp{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .mk .mk-empty{padding:26px;text-align:center;color:var(--mut);background:var(--soft);border-radius:14px}
  .mk table.mk-t{width:100%;border-collapse:collapse;font-size:14px}.mk table.mk-t th{text-align:left;font-size:12px;color:var(--mut);font-weight:700;padding:8px;border-bottom:1px solid var(--line)}.mk table.mk-t td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  .mk .mk-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
  .mk-dl .mk-ch{display:flex;gap:8px;flex-wrap:wrap}.mk-dl .mk-ch label{display:flex;gap:6px;align-items:center;border:1px solid #EAECF0;border-radius:999px;padding:5px 10px;font-weight:500;margin:0}.mk-dl .mk-ch input{width:auto;margin:0}
  `;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => (n == null ? '–' : Math.round(n) >= 1e7 ? (n / 1e7).toFixed(2) + ' Cr' : Math.round(n) >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : Math.round(n).toLocaleString('en-IN'));
  const inr = (n) => (n == null || n === '' ? '–' : '₹' + nf(+n));
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const delta = (a, b) => { const p = pct(a, b); return p == null ? '' : `<span class="${p >= 0 ? 'mk-up' : 'mk-down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`; };
  const ic = (net, cls = 'mk-ic', color) => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${(NET[net] || NET.website).d}"/></svg>`;
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'No date yet');
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const projName = (id) => (id ? (D.projects.find((p) => p.id === id) || {}).name || '' : 'Company');
  const spark = (vals, color) => {
    if (!vals || vals.length < 2) return '<div style="height:44px"></div>';
    const w = 240, h = 44, mx = Math.max(...vals, 1), mn = Math.min(...vals, 0), sx = w / (vals.length - 1), y = (v) => h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 8);
    const pts = vals.map((v, i) => `${(i * sx).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  };

  async function load() { D = await C.api('/api/marketing?scope=' + encodeURIComponent(S.scope)); }
  async function render(ctx, scope, tab) {
    C = ctx;
    if (!$('#mk-css')) { const st = document.createElement('style'); st.id = 'mk-css'; st.textContent = css; document.head.appendChild(st); }
    if (scope != null) S.scope = scope; if (S.scope == null) S.scope = 'company'; if (tab) S.tab = tab;
    $('#page').innerHTML = '<div class="mk"><p class="muted">Loading…</p></div>';
    await load();
    paint();
  }
  function paint() {
    const sync = D.metricool.lastSync;
    const tabs = [['overview', 'Overview'], ['calendar', 'Content calendar'], ['leads', 'Leads'], ['campaigns', 'Campaigns & spend'], ['library', 'Design library'], ['tasks', 'Tasks'], ['setup', 'Set-up']];
    $('#page').innerHTML = `<div class="mk"><div class="mk-hero"><span class="mk-eyebrow">Company-wide · by project</span><h1>Marketing & Social Media</h1><p>Every channel, post, lead and campaign in one place.</p>
      <div class="mk-sync">${D.metricool.configured ? (sync ? `Figures from Metricool · ${when(sync.at)}` : 'Metricool connected, first pull tonight') : 'Metricool not connected yet'}</div>
      <div class="mk-scope">${[['company', 'Company'], ...D.projects.map((p) => [String(p.id), p.name])].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${String(S.scope) === k}">${esc(l)}</button>`).join('')}</div></div>
      <div class="mk-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
      <div id="mkBody"></div></div>`;
    $$('#page [data-scope]').forEach((b) => (b.onclick = async () => { S.scope = b.dataset.scope; S.lib = null; await load(); paint(); }));
    $$('#page [data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; paint(); }));
    ({ overview, calendar, leads, campaigns, library, tasks, setup }[S.tab] || overview)();
  }
  const body = (h) => ($('#mkBody').innerHTML = h);

  // ---------- overview ----------
  function overview() {
    const ch = D.channels, sum = (k) => ch.reduce((a, c) => a + (+c[k] || 0), 0);
    const d30 = Date.now() - 30 * 864e5, recent = D.leads.filter((l) => Date.parse(l.created_at) > d30), prevL = D.leads.filter((l) => Date.parse(l.created_at) <= d30 && Date.parse(l.created_at) > d30 - 30 * 864e5);
    const spent = D.campaigns.reduce((a, c) => a + (+c.spent || 0), 0), allLeads = D.leads.length;
    const fol = sum('followers'), folB = ch.reduce((a, c) => a + (+c.followersBefore || +c.followers || 0), 0);
    const up = D.posts.filter((p) => p.publish_at && Date.parse(p.publish_at) > Date.now() - 864e5 && p.status !== 'published').slice(0, 6);
    const bySrc = {}; for (const l of D.leads) bySrc[l.source] = (bySrc[l.source] || 0) + 1;
    const srcs = Object.entries(bySrc).sort((a, b) => b[1] - a[1]); const mx = srcs.length ? srcs[0][1] : 1;
    const f = (s) => D.leads.filter((l) => (s === 'contacted' ? ['contacted', 'visit', 'booked'].includes(l.status) : s === 'visit' ? ['visit', 'booked'].includes(l.status) : l.status === s || (s === 'booked' && l.is_buyer))).length;
    body(`<div class="mk-kpis">
        <div class="mk-kpi"><span>Followers, all channels</span><b>${nf(fol)}</b>${delta(fol, folB)} <span>in 30 days</span></div>
        <div class="mk-kpi"><span>Views, last 30 days</span><b>${nf(sum('views'))}</b>${delta(sum('views'), sum('viewsBefore'))}</div>
        <div class="mk-kpi"><span>Reach, last 30 days</span><b>${nf(sum('reach'))}</b>${delta(sum('reach'), sum('reachBefore'))}</div>
        <div class="mk-kpi"><span>Content published, 30 days</span><b>${nf(sum('posts'))}</b>${delta(sum('posts'), sum('postsBefore'))}</div>
        <div class="mk-kpi"><span>Leads, last 30 days</span><b>${nf(recent.length)}</b>${delta(recent.length, prevL.length)}</div>
        <div class="mk-kpi"><span>Cost per lead (campaigns)</span><b>${allLeads && spent ? inr(spent / allLeads) : '–'}</b><span>${inr(spent)} spent</span></div></div>
      <div class="mk-chans">${ch.map(chanCard).join('') || `<div class="mk-empty">No channels yet. Add Instagram, Facebook, YouTube and the website under Set-up.</div>`}</div>
      <div class="mk-grid2"><div class="mk-card"><h3>Coming up</h3>${up.map(postRow).join('') || '<p class="muted small" style="margin:0">Nothing planned for the next days. Plan posts in the Content calendar.</p>'}</div>
        <div class="mk-card"><h3>Leads: from enquiry to booking</h3><div class="mk-funnel"><div><b>${allLeads}</b><span>Leads</span></div><div><b>${f('contacted')}</b><span>Contacted</span></div><div><b>${f('visit')}</b><span>Site visit</span></div><div><b>${f('booked')}</b><span>Booked</span></div></div>
          <h3 style="margin-top:16px">Where leads come from</h3>${srcs.map(([s, n]) => `<div style="margin:0 0 8px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(SRC[s] || s)}</span><b>${n}</b></div><div class="mk-bar"><i style="width:${Math.round((n / mx) * 100)}%"></i></div></div>`).join('') || '<p class="muted small" style="margin:0">No leads yet.</p>'}</div></div>`);
    $$('#mkBody [data-post]').forEach((x) => (x.onclick = () => postForm(D.posts.find((p) => p.id === +x.dataset.post))));
  }
  function chanCard(c) {
    const N = NET[c.network] || NET.website, has = c.followers != null || c.views;
    return `<div class="mk-chan"><div class="ctop" style="background:${N.g}">${ic(c.network, '', '#fff')}<div><b>${N.n}</b><small>${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : c.url || '')}${c.projectId ? ' · ' + esc(projName(c.projectId)) : ''}</small></div></div>
      ${has ? `<div class="fig"><div><b>${nf(c.followers)}</b><span>${c.network === 'youtube' ? 'subscribers' : 'followers'} ${c.followersBefore != null ? delta(c.followers, c.followersBefore) : ''}</span></div><div><b>${nf(c.views || c.reach)}</b><span>${c.views ? 'views' : 'reach'}, 30 days ${delta(c.views || c.reach, c.viewsBefore || c.reachBefore)}</span></div>
        <div><b>${nf(c.posts)}</b><span>posts &amp; reels</span></div><div><b>${nf(c.interactions)}</b><span>interactions</span></div></div><div class="spark">${spark(c.spark, N.c)}</div>`
        : `<div class="fig"><div style="grid-column:1/-1"><span>${D.metricool.configured ? 'Connect this channel in Metricool; figures come in the next night.' : 'Figures come in once Metricool is connected (Set-up).'}</span></div></div>`}
      <div class="foot"><span>${c.updated ? 'Updated ' + day(c.updated) : 'No figures yet'}</span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div></div>`;
  }
  const chanDots = (p) => (p.channels || []).map((n) => `<span title="${esc((NET[n] || {}).n || n)}" style="color:${(NET[n] || NET.website).c}">${ic(n)}</span>`).join('');
  const postRow = (p) => `<div class="mk-row" data-post="${p.id}" style="cursor:pointer"><span class="mk-dot" style="background:${ST[p.status][1]}"></span><div style="flex:1;min-width:0"><b style="font-size:14px">${esc(p.title)}</b><div class="small muted">${when(p.publish_at)} · ${KIND[p.kind] || p.kind}${S.scope === 'company' && p.project_id ? ' · ' + esc(projName(p.project_id)) : ''}</div></div><div style="display:flex;gap:4px">${chanDots(p)}</div><span class="mk-pill" style="color:${ST[p.status][1]}">${ST[p.status][0]}</span></div>`;

  // ---------- calendar ----------
  function calendar() {
    const now = new Date(); if (!S.month) S.month = new Date(now.getFullYear(), now.getMonth(), 1);
    const m = S.month, first = new Date(m), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
    const byDay = {}; for (const p of D.posts) if (p.publish_at) { const k = iso(new Date(p.publish_at)); (byDay[k] = byDay[k] || []).push(p); }
    const undated = D.posts.filter((p) => !p.publish_at);
    const review = D.posts.filter((p) => p.status === 'review');
    body(`<div class="mk-actions">${D.can.edit ? '<button id="newPost">+ Plan a post</button>' : ''}<button class="ghost" id="prevM">‹</button><b style="min-width:150px;text-align:center">${m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b><button class="ghost" id="nextM">›</button><button class="ghost" id="todayM">Today</button>
        <span class="muted small" style="margin-left:auto">${Object.entries(ST).map(([, [l, c]]) => `<span class="mk-pill"><span class="mk-dot" style="background:${c}"></span>${l}</span>`).join(' ')}</span></div>
      ${review.length ? `<div class="mk-card" style="border-color:#FEC84B;background:#FFFCF5"><h3>Waiting for approval (${review.length})</h3>${review.map(postRow).join('')}</div>` : ''}
      <div class="mk-cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="h">${d}</div>`).join('')}
        ${days.map((d) => { const k = iso(d), ps = byDay[k] || []; return `<div class="d ${d.getMonth() !== m.getMonth() ? 'o' : ''} ${k === iso(now) ? 't' : ''} ${ps.length ? '' : 'e'}" data-day="${k}"><span class="n">${d.getDate()} <span class="muted" style="font-weight:400">${d.toLocaleDateString('en-IN', { weekday: 'short' })}</span></span>${ps.map((p) => `<span class="chip" data-post="${p.id}" style="background:${(NET[(p.channels || [])[0]] || { c: ST[p.status][1] }).c};${p.status === 'published' ? '' : 'opacity:.85;outline:2px dashed #fff8;outline-offset:-3px'}" title="${esc(p.title)} · ${ST[p.status][0]}">${esc(p.title)}</span>`).join('')}</div>`; }).join('')}</div>
      ${undated.length ? `<div class="mk-card" style="margin-top:14px"><h3>Ideas and drafts without a date</h3>${undated.map(postRow).join('')}</div>` : ''}`);
    $('#prevM').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); calendar(); };
    $('#nextM').onclick = () => { S.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); calendar(); };
    $('#todayM').onclick = () => { S.month = null; calendar(); };
    if ($('#newPost')) $('#newPost').onclick = () => postForm(null);
    $$('#mkBody [data-post]').forEach((x) => (x.onclick = (e) => { e.stopPropagation(); postForm(D.posts.find((p) => p.id === +x.dataset.post)); }));
    if (D.can.edit) $$('#mkBody [data-day]').forEach((x) => (x.onclick = () => postForm(null, x.dataset.day)));
  }
  function postForm(p, dayIso) {
    const pr = p || { channels: ['instagram'], status: 'draft', kind: 'post', project_id: S.scope === 'company' ? (D.projects.find((x) => /signature/i.test(x.name)) || {}).id : +S.scope };
    const dt = p && p.publish_at ? new Date(p.publish_at) : dayIso ? new Date(dayIso + 'T11:00') : null;
    const local = dt ? new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
    const ro = !D.can.edit;
    const dl = C.dialog(`<div class="mk-dl"><h2>${p ? 'Post' : 'Plan a post'}</h2>
      <label>Title<input name="title" value="${esc(pr.title)}" required placeholder="e.g. Dream Signature amenities reel" ${ro ? 'disabled' : ''}></label>
      <div class="row"><div><label>For</label><select name="projectId"><option value="company">Company (Dream India)</option>${D.projects.map((x) => `<option value="${x.id}" ${pr.project_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div><label>Type</label><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${pr.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label>Channels</label><div class="mk-ch">${['instagram', 'facebook', 'youtube', 'linkedin', 'whatsapp', 'website', 'google'].map((n) => `<label><input type="checkbox" name="ch" value="${n}" ${(pr.channels || []).includes(n) ? 'checked' : ''}>${ic(n, 'mk-ic', NET[n].c)}${NET[n].n}</label>`).join('')}</div>
      <div class="row"><div><label>Goes out on</label><input type="datetime-local" name="publishAt" value="${local}"></div><div><label>Status</label><select name="status">${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${pr.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label>Caption</label><textarea name="caption" rows="4" placeholder="Caption and hashtags">${esc(pr.caption)}</textarea>
      <label>Canva design link</label><div style="display:flex;gap:8px"><input name="canvaUrl" value="${esc(pr.canva_url)}" placeholder="https://www.canva.com/design/…" style="flex:1">${pr.canva_url ? `<a class="button ghost" href="${esc(pr.canva_url)}" target="_blank" rel="noopener">Open in Canva ↗</a>` : '<a class="button ghost" href="https://www.canva.com/" target="_blank" rel="noopener">Canva ↗</a>'}</div>
      <div class="row"><div><label>File or video link (Drive)</label><input name="assetUrl" value="${esc(pr.asset_url)}" placeholder="https://drive.google.com/…"></div><div><label>Link to the published post</label><input name="postUrl" value="${esc(pr.post_url)}" placeholder="https://www.instagram.com/p/…"></div></div>
      <div class="row"><div><label>Campaign</label><select name="campaignId"><option value="">—</option>${D.campaigns.map((c) => `<option value="${c.id}" ${pr.campaign_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div><label>Note</label><input name="note" value="${esc(pr.note)}"></div></div>
      ${p && p.status === 'review' && D.can.approve ? '<p><button type="button" id="apprPost">Approve this post</button></p>' : ''}
      ${p && p.approved_name ? `<p class="small muted">Approved by ${esc(p.approved_name)}.</p>` : ''}${p ? `<p class="small muted">Planned by ${esc(p.created_name || '')}. ${D.can.edit ? '<a href="#" id="delPost" style="color:#B42318">Delete</a>' : ''}</p>` : ''}</div>`,
    async (x) => {
      if (ro) return;
      const r = await C.api('/api/marketing', { action: 'post.save', data: { id: p && p.id, ...x, channels: $$('.mk-dl [name=ch]:checked').map((i) => i.value), publishAt: x.publishAt ? new Date(x.publishAt).toISOString() : null } });
      if (r.status === 'review' && x.status !== 'review') C.toast('Saved. It goes out once Management approves it.'); else C.toast('Saved.');
      await load(); paint();
    });
    const ap = $('#apprPost', dl); if (ap) ap.onclick = async () => { await C.api('/api/marketing', { action: 'post.status', data: { id: p.id, status: 'approved' } }); dl.close(); dl.remove(); C.toast('Approved.'); await load(); paint(); };
    const dp = $('#delPost', dl); if (dp) dp.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this post from the calendar?')) return; await C.api('/api/marketing', { action: 'post.delete', data: { id: p.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- leads ----------
  function leads() {
    const q = S.leadQ.toLowerCase();
    const list = D.leads.filter((l) => (S.leadF === 'all' || l.status === S.leadF || (S.leadF === 'due' && l.next_date && l.next_date.slice(0, 10) <= iso(new Date()))) && (!q || [l.name, l.phone, l.email, l.note].some((v) => String(v || '').toLowerCase().includes(q))));
    const cnt = (s) => D.leads.filter((l) => l.status === s).length;
    body(`<div class="mk-actions"><button id="newLead">+ Add a lead</button><input id="lq" placeholder="Search name, phone, email" value="${esc(S.leadQ)}" style="max-width:260px"></div>
      <div class="mk-chips">${[['all', `All ${D.leads.length}`], ['due', 'Call today'], ...Object.entries(LST).map(([k, [l]]) => [k, `${l} ${cnt(k)}`])].map(([k, l]) => `<button data-lf="${k}" aria-pressed="${S.leadF === k}">${esc(l)}</button>`).join('')}</div>
      <div class="mk-card" style="padding:6px 10px;overflow-x:auto">${list.length ? `<table class="mk-t"><tr><th>Lead</th><th>Source</th><th>For</th><th>Status</th><th>Next call</th><th>With</th><th></th></tr>${list.slice(0, 400).map((l) => `<tr><td><b>${esc(l.name || '—')}</b><div class="small muted">${esc(l.phone || '')}${l.email ? ' · ' + esc(l.email) : ''}</div></td><td><span class="mk-pill">${esc(SRC[l.source] || l.source)}</span>${l.campaign_name ? `<div class="small muted">${esc(l.campaign_name)}</div>` : ''}</td><td class="small">${esc(projName(l.project_id))}</td>
        <td><span class="mk-pill" style="color:${LST[l.status][1]}"><span class="mk-dot" style="background:${LST[l.status][1]}"></span>${LST[l.status][0]}</span>${l.is_buyer ? ' <span class="mk-pill" style="background:#ECFDF3;color:#067647">Buyer in CRM ✓</span>' : ''}</td><td class="small">${l.next_date ? day(l.next_date) : ''}</td><td class="small">${esc(l.assigned_name || '')}</td>
        <td style="white-space:nowrap">${l.phone ? `<a href="tel:+91${esc(l.phone)}" title="Call">📞</a> <a href="https://wa.me/91${esc(l.phone)}" target="_blank" rel="noopener" title="WhatsApp">💬</a> ` : ''}<button class="ghost small" data-lead="${l.id}">Open</button></td></tr>`).join('')}</table>` : '<div class="mk-empty">No leads here yet. Add one, or connect the website form and ad forms under Set-up.</div>'}</div>`);
    $('#newLead').onclick = () => leadForm(null);
    $('#lq').oninput = (e) => { S.leadQ = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { leads(); const i = $('#lq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $$('#mkBody [data-lf]').forEach((b) => (b.onclick = () => { S.leadF = b.dataset.lf; leads(); }));
    $$('#mkBody [data-lead]').forEach((b) => (b.onclick = () => leadForm(D.leads.find((l) => l.id === +b.dataset.lead))));
  }
  function leadForm(l) {
    const x = l || { status: 'new', source: 'instagram', project_id: S.scope === 'company' ? (D.projects.find((p) => /signature/i.test(p.name)) || {}).id : +S.scope };
    const dl = C.dialog(`<div class="mk-dl"><h2>${l ? 'Lead' : 'Add a lead'}</h2>
      <div class="row"><div><label>Name</label><input name="name" value="${esc(x.name)}"></div><div><label>Mobile</label><input name="phone" value="${esc(x.phone)}" inputmode="tel"></div></div>
      <div class="row"><div><label>Email</label><input name="email" value="${esc(x.email)}"></div><div><label>For</label><select name="projectId"><option value="company">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${x.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Came from</label><select name="source">${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${x.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Campaign</label><select name="campaignId"><option value="">—</option>${D.campaigns.map((c) => `<option value="${c.id}" ${x.campaign_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Status</label><select name="status">${Object.entries(LST).map(([k, [v]]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div><label>Next call</label><input type="date" name="nextDate" value="${esc((x.next_date || '').slice(0, 10))}"></div></div>
      <label>Handled by</label><select name="assignedTo"><option value="">—</option>${D.team.map((u) => `<option value="${u.id}" ${x.assigned_to === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <label>Notes</label><textarea name="note" rows="3">${esc(x.note)}</textarea>
      ${l ? `<p class="small muted">Added ${day(l.created_at)}. ${D.can.edit ? '<a href="#" id="delLead" style="color:#B42318">Delete</a>' : ''}</p>` : ''}</div>`,
    async (v) => {
      try { await C.api('/api/marketing', { action: 'lead.save', data: { id: l && l.id, ...v } }); }
      catch (e) { if (e.data && e.data.duplicate && confirm(e.message + ' Add it again anyway?')) await C.api('/api/marketing', { action: 'lead.save', data: { ...v, force: true } }); else throw e; }
      C.toast('Saved.'); await load(); paint();
    });
    const dlb = $('#delLead', dl); if (dlb) dlb.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this lead?')) return; await C.api('/api/marketing', { action: 'lead.delete', data: { id: l.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- campaigns ----------
  function campaigns() {
    body(`<div class="mk-actions">${D.can.edit ? '<button id="newCamp">+ New campaign</button>' : ''}<span class="muted small">Leads are counted from the Leads tab when a lead is tagged with the campaign; bookings when a lead's number books a flat.</span></div>
      <div class="mk-camp">${D.campaigns.map((c) => { const sp = +c.spent || 0, bud = +c.budget || 0, N = NET[c.channel] || null;
        return `<div class="mk-card" style="margin:0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3 style="margin:0">${esc(c.name)}</h3><div class="small muted">${N ? N.n + ' · ' : ''}${c.start_on ? day(c.start_on) : ''}${c.end_on ? ' – ' + day(c.end_on) : ''} · ${esc(projName(c.project_id))}</div></div><span class="mk-pill">${c.status === 'done' ? 'Finished' : c.status === 'planned' ? 'Planned' : 'Running'}</span></div>
          <div style="margin:12px 0 6px;display:flex;justify-content:space-between;font-size:13px"><span>Spent ${inr(sp)}</span><span class="muted">of ${inr(bud)}</span></div><div class="mk-bar"><i style="width:${bud ? Math.min(100, Math.round((sp / bud) * 100)) : 0}%"></i></div>
          <div class="mk-funnel" style="margin-top:12px"><div><b>${c.leads}</b><span>Leads</span></div><div><b>${c.leads && sp ? inr(sp / c.leads) : '–'}</b><span>Per lead</span></div><div><b>${c.visits ?? c.visit_leads ?? 0}</b><span>Site visits</span></div><div><b>${c.booked}</b><span>Booked</span></div></div>
          ${D.can.edit ? `<div class="mk-actions" style="margin:10px 0 0"><button class="ghost small" data-camp="${c.id}">Change</button></div>` : ''}</div>`; }).join('') || '<div class="mk-empty">No campaigns yet. Add each ad or drive with its budget and what was spent, and tag its leads.</div>'}</div>`);
    if ($('#newCamp')) $('#newCamp').onclick = () => campForm(null);
    $$('#mkBody [data-camp]').forEach((b) => (b.onclick = () => campForm(D.campaigns.find((c) => c.id === +b.dataset.camp))));
  }
  function campForm(c) {
    const x = c || { status: 'active', project_id: S.scope === 'company' ? (D.projects.find((p) => /signature/i.test(p.name)) || {}).id : +S.scope };
    const dl = C.dialog(`<div class="mk-dl"><h2>${c ? 'Campaign' : 'New campaign'}</h2><label>Name<input name="name" value="${esc(x.name)}" required placeholder="e.g. Diwali site-visit drive"></label>
      <div class="row"><div><label>For</label><select name="projectId"><option value="company">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${x.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><div><label>Channel</label><select name="channel"><option value="">—</option>${Object.entries(NET).map(([k, v]) => `<option value="${k}" ${x.channel === k ? 'selected' : ''}>${v.n}</option>`).join('')}<option value="print" ${x.channel === 'print' ? 'selected' : ''}>Print / hoarding</option><option value="portal" ${x.channel === 'portal' ? 'selected' : ''}>Property portals</option><option value="event" ${x.channel === 'event' ? 'selected' : ''}>Event</option></select></div></div>
      <div class="row"><div><label>From</label><input type="date" name="startOn" value="${esc((x.start_on || '').slice(0, 10))}"></div><div><label>To</label><input type="date" name="endOn" value="${esc((x.end_on || '').slice(0, 10))}"></div></div>
      <div class="row"><div><label>Budget ₹</label><input name="budget" inputmode="decimal" value="${x.budget ?? ''}"></div><div><label>Spent so far ₹</label><input name="spent" inputmode="decimal" value="${x.spent ?? ''}"></div></div>
      <div class="row"><div><label>Site visits (if not tracked on leads)</label><input name="visits" inputmode="numeric" value="${x.visits ?? ''}"></div><div><label>Status</label><select name="status"><option value="planned" ${x.status === 'planned' ? 'selected' : ''}>Planned</option><option value="active" ${x.status === 'active' ? 'selected' : ''}>Running</option><option value="done" ${x.status === 'done' ? 'selected' : ''}>Finished</option></select></div></div>
      <label>Note</label><textarea name="note" rows="2">${esc(x.note)}</textarea>${c ? '<p class="small"><a href="#" id="delCamp" style="color:#B42318">Delete campaign</a></p>' : ''}</div>`,
    async (v) => { await C.api('/api/marketing', { action: 'campaign.save', data: { id: c && c.id, ...v } }); C.toast('Saved.'); await load(); paint(); });
    const db = $('#delCamp', dl); if (db) db.onclick = async (e) => { e.preventDefault(); if (!confirm('Delete this campaign? Its leads stay.')) return; await C.api('/api/marketing', { action: 'campaign.delete', data: { id: c.id } }); dl.close(); dl.remove(); await load(); paint(); };
  }

  // ---------- design library ----------
  const kindOf = (f) => { const t = `${f.folder} ${f.name}`; for (const [k, , re] of LIB) if (re.test(t)) return k; return /\.pdf$/i.test(f.name) ? 'brochure' : /image\//.test(f.mime) ? 'render' : 'other'; };
  async function library() {
    const key = S.scope;
    body('<p class="muted">Opening the Google Drive folder…</p>');
    if (S.libFor !== key) { S.lib = await C.api('/api/marketing?library=' + encodeURIComponent(key)).catch((e) => ({ files: [], error: e.message })); S.libFor = key; S.libF = 'all'; }
    const L = S.lib;
    if (!L.folder) return body(`<div class="mk-empty">No Google Drive folder is linked for ${esc(key === 'company' ? 'the company' : projName(+key))} yet.<br>Keep brochures, floor plans, elevations, renders and amenity images in one Drive folder (sub-folders are fine), then paste its link under Set-up.</div>`);
    if (L.error) return body(`<div class="mk-empty">The ERP cannot open the Drive folder yet: ${esc(L.error)}<br>Share the folder with <b>${esc(L.share || 'the ERP\'s Google account')}</b> as Viewer.</div>`);
    const files = L.files.map((f) => ({ ...f, k: kindOf(f) }));
    const cnt = {}; for (const f of files) cnt[f.k] = (cnt[f.k] || 0) + 1;
    const cats = [['all', 'Everything'], ...LIB.map(([k, l]) => [k, l]), ['other', 'Other']].filter(([k]) => k === 'all' || cnt[k]);
    const show = files.filter((f) => S.libF === 'all' || f.k === S.libF).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    body(`<div class="mk-actions"><a class="button ghost" href="https://drive.google.com/drive/folders/${esc(L.folder)}" target="_blank" rel="noopener">Open the folder in Drive ↗</a><a class="button ghost" href="https://www.canva.com/" target="_blank" rel="noopener">Canva ↗</a><span class="muted small">${files.length} files. Add or replace files in Drive; they show here straight away.</span></div>
      <div class="mk-chips">${cats.map(([k, l]) => `<button data-lk="${k}" aria-pressed="${S.libF === k}">${esc(l)}${k === 'all' ? ' ' + files.length : ' ' + cnt[k]}</button>`).join('')}</div>
      <div class="mk-lib">${show.slice(0, 300).map((f) => `<a href="${esc(f.link)}" target="_blank" rel="noopener"><div class="th" ${f.thumb ? `data-th="${esc(f.id)}"` : ''}>${f.thumb ? '' : esc((f.name.split('.').pop() || 'file').toUpperCase())}</div><div class="nm">${esc(f.name)}<small>${esc(f.folder || '')}${f.folder ? ' · ' : ''}${day(f.at)}</small></div></a>`).join('') || '<div class="mk-empty">Nothing in this group.</div>'}</div>`);
    $$('#mkBody [data-lk]').forEach((b) => (b.onclick = () => { S.libF = b.dataset.lk; library(); }));
    // previews load as they come into view
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const el = e.target; el.style.backgroundImage = `url(/api/marketing?thumb=${encodeURIComponent(el.dataset.th)})`; io.unobserve(el); } }), { rootMargin: '200px' }) : null;
    $$('#mkBody [data-th]').forEach((el) => (io ? io.observe(el) : (el.style.backgroundImage = `url(/api/marketing?thumb=${encodeURIComponent(el.dataset.th)})`)));
  }

  // ---------- tasks ----------
  function tasks() {
    body(`${D.can.edit ? `<div class="mk-card"><div class="row" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end"><div><label>New task</label><input id="tt" placeholder="e.g. Shoot the sample flat reel"></div><div><label>By</label><input type="date" id="td"></div><div><label>Who</label><select id="tw"><option value="">—</option>${D.team.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div><button id="ta" style="margin-bottom:6px">Add</button></div></div>` : ''}
      <div class="mk-card">${D.tasks.map((t) => `<div class="mk-row"><input type="checkbox" data-task="${t.id}" ${t.done_at ? 'checked' : ''} ${D.can.edit ? '' : 'disabled'} style="width:auto;margin:0"><div style="flex:1;${t.done_at ? 'text-decoration:line-through;color:#98A2B3' : ''}"><b style="font-size:14px">${esc(t.title)}</b><div class="small muted">${t.due ? 'By ' + day(t.due) : ''}${t.assigned_name ? ' · ' + esc(t.assigned_name) : ''}${S.scope === 'company' && t.project_id ? ' · ' + esc(projName(t.project_id)) : ''}</div></div>${t.due && !t.done_at && t.due.slice(0, 10) < iso(new Date()) ? '<span class="mk-pill" style="color:#B42318">Late</span>' : ''}${D.can.edit ? `<button class="ghost small" data-tdel="${t.id}">×</button>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">No tasks. Add the week\'s shoots, designs and posts here.</p>'}</div>`);
    if ($('#ta')) $('#ta').onclick = async () => { const t = $('#tt').value.trim(); if (!t) return; await C.api('/api/marketing', { action: 'task.save', data: { title: t, due: $('#td').value, assignedTo: $('#tw').value, projectId: S.scope } }); await load(); tasks(); };
    $$('#mkBody [data-task]').forEach((x) => (x.onchange = async () => { await C.api('/api/marketing', { action: 'task.done', data: { id: +x.dataset.task, undo: !x.checked } }); await load(); tasks(); }));
    $$('#mkBody [data-tdel]').forEach((x) => (x.onclick = async () => { await C.api('/api/marketing', { action: 'task.delete', data: { id: +x.dataset.tdel } }); await load(); tasks(); }));
  }

  // ---------- set-up ----------
  function setup() {
    const s = D.settings, M = D.metricool;
    const chRow = (c = {}) => `<div class="row chrow" style="grid-template-columns:150px 1fr 1.4fr 170px auto;align-items:end"><div><label>Channel</label><select data-c="network">${Object.entries(NET).map(([k, v]) => `<option value="${k}" ${c.network === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div><div><label>Handle</label><input data-c="handle" value="${esc(c.handle)}" placeholder="dreamindiarealty"></div><div><label>Link</label><input data-c="url" value="${esc(c.url)}" placeholder="https://…"></div><div><label>For</label><select data-c="projectId"><option value="">Company</option>${D.projects.map((p) => `<option value="${p.id}" ${c.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><button type="button" class="ghost small" data-rmch style="margin-bottom:8px">×</button></div>`;
    body(`<div class="mk-card"><h3>Social media figures: Metricool</h3>
        <p class="small" style="margin:0 0 8px">${M.configured ? `Connected. Every night the ERP pulls followers, views, reach, posts and interactions for every channel connected in Metricool.${M.lastSync ? ` Last pull ${when(M.lastSync.at)}: ${esc((M.lastSync.networks || []).join(', ') || 'no channels')}${M.lastSync.error ? ` <b style="color:#B42318">${esc(M.lastSync.error)}</b>` : M.lastSync.errors && M.lastSync.errors.length ? ` <span class="muted">(${M.lastSync.errors.length} figures not available)</span>` : ''}.` : ''}` : 'Not connected yet. In Metricool, connect Facebook, YouTube, LinkedIn and Google Business Profile to the "Dream India Group" brand (Instagram is already there), then copy the API token (Metricool → Account settings → API; it needs Metricool\'s Advanced plan) and add it in Vercel as METRICOOL_TOKEN.'}</p>
        ${M.configured && D.can.edit ? '<button class="ghost" id="syncNow">Pull the figures now</button>' : ''}</div>
      <div class="mk-card"><h3>Channels</h3><div id="chs">${(s.channels || []).map(chRow).join('')}</div>${D.can.edit ? '<button type="button" class="ghost small" id="addCh">+ Add a channel</button>' : ''}</div>
      <div class="mk-card"><h3>Design library: Google Drive folders</h3><p class="small muted" style="margin:0 0 8px">One folder per project (sub-folders like Brochures, Floor plans, Elevations, Renders, Amenities are fine). Share each folder with <b>${esc(s.share || "the ERP's Google account")}</b> as Viewer, then paste its link here.</p>
        ${[['company', 'Company (logos, corporate profile)'], ...D.projects.map((p) => [String(p.id), p.name])].map(([k, l]) => `<label>${esc(l)}<input data-drive="${k}" value="${s.drive[k] ? 'https://drive.google.com/drive/folders/' + esc(s.drive[k]) : ''}" placeholder="Paste the Drive folder link"></label>`).join('')}</div>
      <div class="mk-card"><h3>Approvals</h3><label class="check"><input type="checkbox" id="needAp" ${s.needApproval ? 'checked' : ''}> Posts need Management's approval before they are scheduled or published</label></div>
      ${s.leadUrl ? `<div class="mk-card"><h3>Leads coming in by themselves</h3><p class="small" style="margin:0 0 8px">Give this link to the website developer for the enquiry form, and use it in a Meta lead-ads or portal connector (Zapier, Make). Each enquiry (name, phone, email, source, project, message) arrives in Leads; a number already received in the last 30 days is not added twice.</p><code style="user-select:all;word-break:break-all;display:block;background:#F7F7FB;padding:8px;border-radius:8px">${esc(location.origin + s.leadUrl)}</code></div>` : ''}
      <div class="mk-card"><h3>Type figures by hand</h3><p class="small muted" style="margin:0 0 8px">For a channel Metricool does not cover. One date's figures; leave a box empty if you do not have it.</p>
        <div class="row" style="grid-template-columns:repeat(4,1fr)"><div><label>Channel</label><select id="sn">${Object.entries(NET).map(([k, v]) => `<option value="${k}">${v.n}</option>`).join('')}</select></div><div><label>Date</label><input type="date" id="sd" value="${iso(new Date())}"></div><div><label>Followers</label><input id="sf" inputmode="numeric"></div><div><label>Views</label><input id="sv" inputmode="numeric"></div></div>
        <div class="row" style="grid-template-columns:repeat(4,1fr)"><div><label>Reach</label><input id="sr" inputmode="numeric"></div><div><label>Posts</label><input id="sp" inputmode="numeric"></div><div><label>Interactions</label><input id="si" inputmode="numeric"></div><div style="display:flex;align-items:end"><button class="ghost" id="saveSt">Save figures</button></div></div></div>
      ${D.can.edit ? '<div class="actions"><button id="saveSet">Save set-up</button></div>' : ''}`);
    if ($('#addCh')) $('#addCh').onclick = () => $('#chs').insertAdjacentHTML('beforeend', chRow({ network: 'facebook' }));
    $('#mkBody').addEventListener('click', (e) => { if (e.target.closest('[data-rmch]')) e.target.closest('.chrow').remove(); });
    if ($('#syncNow')) $('#syncNow').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Pulling…'; try { const r = await C.api('/api/marketing', { action: 'sync' }); C.toast(r.error ? 'Metricool: ' + r.error : `Pulled ${r.rows || 0} days of figures.`); await load(); paint(); } catch (x) { alert(x.message); e.target.disabled = false; } };
    $('#saveSt').onclick = async () => { await C.api('/api/marketing', { action: 'stats.save', data: { network: $('#sn').value, day: $('#sd').value, followers: $('#sf').value, views: $('#sv').value, reach: $('#sr').value, posts: $('#sp').value, interactions: $('#si').value } }); C.toast('Figures saved.'); await load(); };
    if ($('#saveSet')) $('#saveSet').onclick = async () => {
      const drive = {}; $$('#mkBody [data-drive]').forEach((i) => { if (i.value.trim()) drive[i.dataset.drive] = i.value.trim(); });
      await C.api('/api/marketing', { action: 'settings', data: { needApproval: $('#needAp').checked, drive, channels: $$('#chs .chrow').map((r) => ({ network: r.querySelector('[data-c=network]').value, handle: r.querySelector('[data-c=handle]').value, url: r.querySelector('[data-c=url]').value, projectId: r.querySelector('[data-c=projectId]').value || null })) } });
      C.toast('Saved.'); S.libFor = null; await load(); paint();
    };
  }

  window.Marketing = { render };
})();
