// Sales & Marketing → Campaigns → AI ad plans: the AI drafts a Meta lead campaign; staff check it and add the design;
// Rafi Sir or Sameer approves; Launch builds it in Meta (paused); Go live starts it. Server: api/adplans.js.
window.AdPlans = (() => {
  const ST = { draft: ['Draft: waiting for approval', 'warn'], approved: ['Approved: ready to build in Meta', 'warn'], launched: ['Built in Meta (paused)', 'grey'], live: ['Live', 'good'], failed: ['Could not build: see the error', 'bad'], rejected: ['Rejected', 'grey'] };
  const CTA = { SIGN_UP: 'Sign up', LEARN_MORE: 'Learn more', GET_QUOTE: 'Get quote', CONTACT_US: 'Contact us', BOOK_NOW: 'Book now' };
  let X;
  async function render(ctx) {
    X = ctx; const { body, esc, inr, S } = X;
    body('<div class="mk-card"><p class="muted">Loading…</p></div>');
    const d = await X.api('/api/adplans' + (S.scope && S.scope !== 'company' ? '?project=' + S.scope : ''));
    const proj = S.scope && S.scope !== 'company' ? (X.D.projects.find((p) => String(p.id) === String(S.scope)) || null) : null;
    body(`<div class="mk-card"><h3>AI ad plans for Meta (Facebook and Instagram)</h3>
        <p class="small muted">Tell the AI what you want; it drafts the whole lead campaign: who to show it to and where, budget and days, three ad texts and the lead form, checked against RERA rules and what past ads of the project cost per lead. Add the design, Rafi Sir or Sameer approves, then Launch builds it in Meta paused for a last look in Ads Manager, and Go live starts it. Leads from its form come straight into Leads.</p>
        <p class="small">${d.meta.connected ? `<span class="pill good">Meta connected</span> ${d.meta.ads.length} ad account${d.meta.ads.length === 1 ? '' : 's'}` : '<span class="pill warn">Meta not connected: Set-up → Connect with Facebook</span>'} ${d.ai ? '' : '<span class="pill warn">AI offline (Claude key)</span>'}</p>
        ${d.canEdit ? `<div class="actions">${proj ? '<button id="apNew">✦ Draft a new ad plan</button>' : '<span class="small muted">Choose a project at the top to draft a plan.</span>'}<button class="ghost" id="apSet">Ad account and links</button></div>` : ''}</div>
      ${d.rows.map((a) => card(a, d)).join('') || '<div class="mk-card"><p class="muted">No ad plans yet.</p></div>'}`);
    const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
    if ($('#apNew')) $('#apNew').onclick = () => X.dialog(`<h2>New ad plan · ${esc(proj.name)}</h2>
      ${proj.rera_no ? '' : '<p class="small" style="color:#B54708">This project has no MahaRERA number yet: the AI will only make a "register your interest" ad, with no price, booking or launch wording.</p>'}
      <label>What do you want from this campaign?</label><textarea name="goal" rows="3" placeholder="e.g. Site visits from families in Andheri and Goregaon looking for 2 BHK, before the launch"></textarea>
      <div class="row"><div><label>Budget per day (₹)</label><input name="dailyBudget" type="number" min="200" placeholder="2000"></div><div><label>For how many days</label><input name="days" type="number" min="1" max="90" placeholder="14"></div></div>
      <label>Areas to target (optional)</label><input name="areas" placeholder="e.g. Andheri, Jogeshwari, Goregaon, Malad">
      <label>Anything else (optional)</label><input name="notes" placeholder="e.g. include NRIs in Dubai; push the Sunday site visit">
      <p class="small muted">Drafting takes up to a minute.</p>`,
      async (x) => { const r = await X.api('/api/adplans', { action: 'generate', projectId: proj.id, brief: x }); X.toast('Ad plan drafted. Check it, add the design, and send it for approval.', 6000); await render(X); const el = document.querySelector(`[data-ap="${r.id}"]`); if (el) el.scrollIntoView({ block: 'start' }); });
    if ($('#apSet')) $('#apSet').onclick = () => X.dialog(`<h2>Ad account and links</h2>
      <label>Meta ad account</label><select name="adAccount">${d.meta.ads.map((a) => `<option value="${esc(a.id)}" ${d.settings.adAccount === a.id ? 'selected' : ''}>${esc(a.name)} (${esc(a.id)})</option>`).join('') || '<option value="">Not connected</option>'}</select>
      <label>Facebook page the ads run from</label><select name="pageId">${d.meta.pages.map((p) => `<option value="${esc(p.id)}" ${d.settings.pageId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">Not connected</option>'}</select>
      <label>Privacy policy link (Meta needs it on lead forms)</label><input name="privacyUrl" value="${esc(d.settings.privacyUrl || 'https://dreamindiarealty.com/privacy-policy')}">
      <label>Website link (after the form)</label><input name="siteUrl" value="${esc(d.settings.siteUrl || 'https://dreamindiarealty.com')}">`,
      async (x) => { await X.api('/api/adplans', { action: 'settings', ...x }); X.toast('Saved.'); });
    $$('[data-apa]').forEach((b) => (b.onclick = () => act(b.dataset.apa, +b.dataset.id, d)));
    $$('[data-apf]').forEach((inp) => (inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
      try { await X.api('/api/adplans', { action: 'file', id: +inp.dataset.apf, name: f.name, data }); X.toast('Design added.'); render(X); } catch (e) { alert(e.message); }
    }));
  }
  function card(a, d) {
    const { esc, inr, day } = X, P = a.plan || {}, A = P.audience || {}, B = P.budget || {}, s = ST[a.status] || [a.status, 'grey'];
    const files = a.files || [];
    return `<div class="mk-card" data-ap="${a.id}"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">${esc(P.campaign_name || 'Ad plan')} <span class="small muted">· ${esc(a.project)}</span></h3>
        <p class="small muted" style="margin:4px 0 0">Drafted by ${esc(a.created_by_name || '')} on ${day(a.created_at)}${a.approved_by_name ? ` · ${a.status === 'rejected' ? 'rejected' : 'approved'} by ${esc(a.approved_by_name)}` : ''}</p></div>
        <span class="pill ${s[1]}">${s[0]}</span></div>
      ${a.error ? `<div class="err" style="margin-top:8px">${esc(a.error)}</div>` : ''}
      <p style="margin:10px 0">${esc(P.why || '')}</p>
      <div class="mk-grid2h">
        <div><b class="small">Who sees it</b><p class="small">${esc((A.areas || []).map((x) => `${x.name} (${x.radius_km} km)`).join(', '))}<br>Age ${A.age_min}–${A.age_max}${(A.interests || []).length ? ' · interested in ' + esc(A.interests.join(', ')) : ''}<br><span class="muted">${esc(A.note || '')}</span></p></div>
        <div><b class="small">Budget</b><p class="small">${inr(B.daily)} a day for ${B.days} days = <b>${inr(B.total)}</b>${P.expected && P.expected.cpl_low ? `<br>Expected: ${inr(P.expected.cpl_low)}–${inr(P.expected.cpl_high)} per lead, about ${P.expected.leads_low}–${P.expected.leads_high} leads` : ''}</p></div>
      </div>
      <b class="small">The ads (${(P.creatives || []).length})</b>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin:6px 0 10px">${(P.creatives || []).map((c) => `<div style="border:1px solid #E6E8F0;border-radius:12px;overflow:hidden;background:#fff">
        ${files[0] ? `<img src="/api/adplans?file=${files[0].id}" alt="" style="width:100%;aspect-ratio:1.91/1;object-fit:cover;display:block">` : `<div style="aspect-ratio:1.91/1;background:#F6F7FB;display:flex;align-items:center;justify-content:center;padding:10px;text-align:center" class="small muted">Design: ${esc(c.design_hint || 'add an image')}</div>`}
        <div style="padding:10px"><p class="small" style="margin:0 0 6px;white-space:pre-wrap">${esc(c.primary_text)}</p><b>${esc(c.headline)}</b><div class="small muted">${esc(c.description)}</div><span class="pill grey" style="margin-top:6px">${CTA[c.cta] || c.cta}</span></div></div>`).join('')}</div>
      <p class="small"><b>Lead form:</b> ${esc((P.lead_form || {}).intro || '')} · Name, Phone${((P.lead_form || {}).questions || []).map((q) => ' · ' + esc(q)).join('')}</p>
      ${(P.checks || []).length ? `<p class="small muted">Checks: ${esc(P.checks.join(' · '))}</p>` : ''}
      <div class="actions">
        ${a.status === 'draft' && d.canEdit ? `<label class="btn ghost" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png" data-apf="${a.id}" hidden>${files.length ? 'Change the design' : 'Add the design (image)'}</label><button class="ghost" data-apa="edit" data-id="${a.id}">Edit the plan</button>` : ''}
        ${a.status === 'draft' && d.canApprove ? `<button data-apa="approve" data-id="${a.id}">Approve</button><button class="ghost" data-apa="reject" data-id="${a.id}">Reject</button>` : ''}
        ${['approved', 'failed'].includes(a.status) && d.canEdit ? `<button data-apa="launch" data-id="${a.id}">${a.status === 'failed' ? 'Try building it again' : 'Build it in Meta (paused)'}</button>` : ''}
        ${a.status === 'launched' && d.canApprove ? `<button data-apa="golive" data-id="${a.id}">Go live</button>` : ''}
        ${a.status === 'live' && d.canApprove ? `<button class="ghost" data-apa="pause" data-id="${a.id}">Pause the ads</button>` : ''}
        ${a.meta && a.meta.campaign ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${esc(String(a.meta.account || '').replace('act_', ''))}&selected_campaign_ids=${esc(a.meta.campaign)}">Open in Ads Manager ↗</a>` : ''}
      </div></div>`;
  }
  async function act(kind, id, d) {
    const a = d.rows.find((x) => x.id === id), { esc } = X;
    try {
      if (kind === 'edit') {
        const P = a.plan;
        return X.dialog(`<h2>Edit the plan</h2>
          <div class="row"><div><label>Budget per day (₹)</label><input name="daily" type="number" value="${P.budget.daily}"></div><div><label>Days</label><input name="days" type="number" value="${P.budget.days}"></div></div>
          <label>Areas (name:km, comma separated)</label><input name="areas" value="${esc(P.audience.areas.map((x) => `${x.name}:${x.radius_km}`).join(', '))}">
          <div class="row"><div><label>Age from</label><input name="amin" type="number" value="${P.audience.age_min}"></div><div><label>Age to</label><input name="amax" type="number" value="${P.audience.age_max}"></div></div>
          <label>Interests (comma separated)</label><input name="ints" value="${esc(P.audience.interests.join(', '))}">
          ${P.creatives.map((c, i) => `<h3 style="margin:12px 0 4px">Ad ${i + 1}</h3><label>Headline</label><input name="h${i}" maxlength="40" value="${esc(c.headline)}"><label>Text</label><textarea name="t${i}" rows="3" maxlength="400">${esc(c.primary_text)}</textarea><label>Description</label><input name="d${i}" maxlength="30" value="${esc(c.description)}">`).join('')}
          <label>Lead form questions (one per line, besides name and phone)</label><textarea name="q" rows="3">${esc(P.lead_form.questions.join('\n'))}</textarea>`,
          async (x) => {
            const plan = { ...P, budget: { daily: +x.daily, days: +x.days }, audience: { ...P.audience, age_min: +x.amin, age_max: +x.amax, interests: x.ints.split(',').map((s) => s.trim()).filter(Boolean),
              areas: x.areas.split(',').map((s) => { const [n, k] = s.split(':'); return { name: (n || '').trim(), radius_km: +k || 8 }; }).filter((y) => y.name) },
              creatives: P.creatives.map((c, i) => ({ ...c, headline: x['h' + i], primary_text: x['t' + i], description: x['d' + i] })), lead_form: { ...P.lead_form, questions: x.q.split('\n').map((s) => s.trim()).filter(Boolean) } };
            await X.api('/api/adplans', { action: 'edit', id, plan }); X.toast('Saved.'); render(X);
          });
      }
      if (kind === 'approve' && !confirm(`Approve this ad plan? It will spend up to ₹${Number(a.plan.budget.total).toLocaleString('en-IN')} once it goes live.`)) return;
      if (kind === 'reject') { const note = prompt('Why? (goes to the team)') || ''; await X.api('/api/adplans', { action: 'decide', id, approve: false, note }); return render(X); }
      if (kind === 'approve') { await X.api('/api/adplans', { action: 'decide', id, approve: true }); X.toast('Approved. Now build it in Meta.'); return render(X); }
      if (kind === 'launch') { X.toast('Building it in Meta… this takes up to a minute.', 8000); await X.api('/api/adplans', { action: 'launch', id }); X.toast('Built in Meta, paused. Check it in Ads Manager, then Go live.', 8000); return render(X); }
      if (kind === 'golive' && !confirm('Start the ads now? Meta starts spending the daily budget.')) return;
      if (kind === 'golive' || kind === 'pause') { await X.api('/api/adplans', { action: kind, id }); X.toast(kind === 'golive' ? 'The ads are live.' : 'Paused.'); return render(X); }
    } catch (e) { alert(e.message); render(X); }
  }
  return { render };
})();
