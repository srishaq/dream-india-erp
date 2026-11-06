// AI Meta ad plans (7 Nov 2026): the AI drafts a lead campaign for a project (who to show it to, where, budget and
// days, three ad texts, the lead form questions) from the knowledge files and what past Meta campaigns of the project
// cost per lead. Staff add the design. Syed Rafi Ishaq or Syed Sameer Ishaq approves (it spends money). "Launch" builds
// it in the connected Meta ad account (campaign, ad set, lead form, image, ad), everything PAUSED, so it can be checked
// in Ads Manager; "Go live" starts it. Leads from its form come into Leads like every Meta lead form.
//
// RERA: a project without a MahaRERA number gets only an "register your interest" ad about the area and the company,
// with no price, booking or launch wording; with a number, every ad text carries "MahaRERA No. …".
const db = require('./db');

const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const fake = () => process.env.ADPLAN_FAKE === '1' && process.env.VERCEL !== '1';
const MODEL = () => process.env.ANTHROPIC_PLAN_MODEL || 'claude-sonnet-5-5';
const CTAS = ['SIGN_UP', 'LEARN_MORE', 'GET_QUOTE', 'CONTACT_US', 'BOOK_NOW'];

async function context(projectId) {
  const p = await db.one('select id, name, location, rera_no from projects where id = $1', [projectId]);
  if (!p) throw err(400, 'Choose the project.');
  const A = require('./agents');
  const kb = await A.knowledge(String(p.id));
  const pick = (path) => (kb.find((k) => k.path === path) || {}).body || '';
  const past = await db.q(`select c.name, coalesce(sum(d.spend), 0)::numeric as spend, coalesce(sum(d.leads), 0)::int as leads
      from mkt_campaigns c join mkt_ads a on a.campaign_id = c.id join mkt_ad_days d on d.ad_id = a.id where c.project_id = $1 group by c.id, c.name order by spend desc limit 12`, [p.id]).catch(() => []);
  return { p, facts: pick('/brand-brain/facts.md'), voice: pick('/brand-brain/voice-guide.md'), rules: pick('/compliance/rules.md'), past };
}

function prompt(c, brief) {
  const reraLine = c.p.rera_no ? `It is registered: MahaRERA No. ${c.p.rera_no}. Every ad text must include "MahaRERA No. ${c.p.rera_no}".`
    : 'It has NO MahaRERA number yet: make only a "register your interest" ad about the area and Dream India Realty. No price, no booking, no "launch", no offer, no possession date.';
  return `You are a senior Meta (Facebook and Instagram) ads strategist for Dream India Realty, a Mumbai real estate developer.
Draft one lead-generation campaign (instant form) for the project "${c.p.name}"${c.p.location ? ` in ${c.p.location}` : ''}. ${reraLine}

What the owner asked: ${JSON.stringify(brief)}
Project facts (use only these; never invent prices, sizes, amenities or dates):
${c.facts}
Voice: ${c.voice}
Compliance rules: ${c.rules}
Past Meta campaigns of this project (spend in rupees, leads): ${c.past.length ? c.past.map((x) => `${x.name}: ₹${Math.round(x.spend)}, ${x.leads} leads`).join('; ') : 'none yet'}

Mumbai buyers: think about who buys here (families upgrading, SRA-area residents, NRIs, investors), where they live now (areas within 5 to 15 km, plus Gulf cities for NRIs only if the brief says so), and what makes them stop scrolling.
Answer with ONE JSON object only:
{"campaign_name": "short name",
 "why": "2-3 sentences: the idea and who it is for",
 "audience": {"areas": [{"name": "Mumbai area or city name as Facebook knows it, e.g. Andheri, Jogeshwari, Goregaon, Mumbai", "radius_km": 3 to 15}], "age_min": 25, "age_max": 60, "interests": ["up to 6 Facebook interests, e.g. Real estate, Property, Home loan, Apartment"], "note": "who exactly"},
 "budget": {"daily": rupees per day, "days": number of days},
 "creatives": [3 items: {"headline": "max 40 characters", "primary_text": "max 300 characters, ends with the call to action and the MahaRERA line if registered", "description": "max 30 characters", "cta": one of ${CTAS.join(', ')}, "design_hint": "what the image should show"}],
 "lead_form": {"intro": "max 60 characters", "questions": ["up to 3 short questions besides name and phone, e.g. Which home are you looking for? / When do you plan to buy?"]},
 "expected": {"cpl_low": rupees, "cpl_high": rupees, "leads_low": n, "leads_high": n},
 "checks": ["short compliance checks you made"]}`;
}

function clean(o, brief) {
  const a = o.audience || {};
  const daily = Math.max(200, Math.min(200000, Math.round(Number((o.budget || {}).daily) || Number(brief.dailyBudget) || 1000)));
  const days = Math.max(1, Math.min(90, Math.round(Number((o.budget || {}).days) || Number(brief.days) || 14)));
  return {
    campaign_name: clip(o.campaign_name, 80) || 'Lead campaign', why: clip(o.why, 600),
    audience: { areas: (Array.isArray(a.areas) ? a.areas : []).slice(0, 10).map((x) => ({ name: clip(x.name, 60), radius_km: Math.max(1, Math.min(40, Math.round(Number(x.radius_km) || 8))) })).filter((x) => x.name),
      age_min: Math.max(18, Math.min(65, Math.round(Number(a.age_min) || 25))), age_max: Math.max(18, Math.min(65, Math.round(Number(a.age_max) || 60))),
      interests: (Array.isArray(a.interests) ? a.interests : []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 8), note: clip(a.note, 300) },
    budget: { daily, days, total: daily * days },
    creatives: (Array.isArray(o.creatives) ? o.creatives : []).slice(0, 5).map((x) => ({ headline: clip(x.headline, 40), primary_text: clip(x.primary_text, 400), description: clip(x.description, 30),
      cta: CTAS.includes(x.cta) ? x.cta : 'SIGN_UP', design_hint: clip(x.design_hint, 200) })).filter((x) => x.headline && x.primary_text),
    lead_form: { intro: clip((o.lead_form || {}).intro, 60) || 'Get the details', questions: ((o.lead_form || {}).questions || []).map((q) => clip(q, 80)).filter(Boolean).slice(0, 3) },
    expected: o.expected || {}, checks: (Array.isArray(o.checks) ? o.checks : []).map((x) => clip(x, 160)).slice(0, 6),
  };
}

async function generate(user, { projectId, brief = {} }) {
  const c = await context(parseInt(projectId, 10));
  const b = { goal: clip(brief.goal, 300) || 'Site visits from serious buyers', dailyBudget: Number(brief.dailyBudget) || null, days: Number(brief.days) || null, areas: clip(brief.areas, 200), notes: clip(brief.notes, 500) };
  let raw;
  if (fake()) raw = process.env.ADPLAN_FAKE_JSON;
  else {
    if (!process.env.ANTHROPIC_API_KEY) throw err(409, 'The AI is offline (the Claude key is not set in Vercel).');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 3000, messages: [{ role: 'user', content: prompt(c, b) }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(502, 'The AI said: ' + ((j.error && j.error.message) || r.status));
    raw = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  }
  const s = String(raw || ''), i = s.indexOf('{'), k = s.lastIndexOf('}');
  let o; try { o = JSON.parse(s.slice(i, k + 1)); } catch { throw err(502, 'The AI plan could not be read. Try again.'); }
  const plan = clean(o, b);
  if (!plan.creatives.length) throw err(502, 'The AI did not write any ad. Try again.');
  if (c.p.rera_no) for (const cr of plan.creatives) if (!cr.primary_text.includes(c.p.rera_no)) cr.primary_text = clip(`${cr.primary_text} MahaRERA No. ${c.p.rera_no}`, 400);
  const row = await db.one('insert into ad_plans (project_id, brief, plan, created_by) values ($1, $2, $3, $4) returning id', [c.p.id, b, plan, user.id]);
  return { id: row.id };
}

async function list(projectId) {
  return db.q(`select a.*, p.name as project, p.rera_no, cu.name as created_by_name, au.name as approved_by_name,
      (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime) order by f.id), '[]'::json) from ad_plan_files f where f.plan_id = a.id) as files
    from ad_plans a join projects p on p.id = a.project_id left join users cu on cu.id = a.created_by left join users au on au.id = a.approved_by
    where ($1::int is null or a.project_id = $1) order by a.id desc limit 100`, [parseInt(projectId, 10) || null]);
}
async function get(id) { const r = (await list(null)).find((x) => x.id === id) || (await db.q('select a.*, p.name as project, p.rera_no from ad_plans a join projects p on p.id = a.project_id where a.id = $1', [id]))[0]; if (!r) throw err(404, 'Plan not found.'); return r; }

// staff may change the words, budget, areas and form before approval
async function edit(user, id, plan) {
  const a = await get(id);
  if (a.status !== 'draft') throw err(409, 'Only a draft can be changed.');
  const p = clean(plan || {}, {});
  if (a.rera_no) for (const cr of p.creatives) if (!cr.primary_text.includes(a.rera_no)) cr.primary_text = clip(`${cr.primary_text} MahaRERA No. ${a.rera_no}`, 400);
  await db.q('update ad_plans set plan = $2 where id = $1', [id, p]);
  return { ok: true };
}
async function addFile(id, { name, data }) {
  const m = String(data || '').match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!m) throw err(400, 'The design must be a JPG or PNG.');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3.5e6) throw err(400, 'Keep the design under 3.5 MB.');
  const a = await get(id); if (!['draft', 'approved', 'failed'].includes(a.status)) throw err(409, 'The ad is already built.');
  const r = await db.one('insert into ad_plan_files (plan_id, name, mime, data) values ($1, $2, $3, $4) returning id', [id, clip(name, 120) || 'design', m[1], buf]);
  return { id: r.id };
}
async function decide(user, id, approve, note) {
  if (!require('./changes').isApprover(user)) throw err(403, 'Ad plans are approved by Syed Rafi Ishaq or Syed Sameer Ishaq (they spend money).');
  const a = await get(id); if (a.status !== 'draft') throw err(409, `Already ${a.status}.`);
  if (approve && !(a.files || []).length) throw err(409, 'Add the design (image) before approving.');
  await db.q('update ad_plans set status = $2, approved_by = $3, approved_at = now(), decision_note = $4 where id = $1', [id, approve ? 'approved' : 'rejected', user.id, clip(note, 300) || null]);
  return { ok: true };
}

// ---------- building it in Meta (all paused) ----------
async function metaParts() {
  const S = require('./social');
  const st = await S.status(); if (!st.meta || !st.meta.connected) throw err(409, 'Facebook and Meta Ads are not connected (Sales & Marketing → Set-up).');
  const tok = await S.metaToken(), pages = await S.metaPages();
  const set = (await db.one("select value from settings where key = 'adplans'"))?.value || {};
  const acc = set.adAccount || (st.meta.ads[0] && st.meta.ads[0].id); const page = pages.find((p) => p.id === set.pageId) || pages[0];
  if (!acc) throw err(409, 'No Meta ad account is connected.'); if (!page) throw err(409, 'No Facebook page is connected.');
  return { S, tok, act: String(acc).startsWith('act_') ? acc : 'act_' + acc, page, privacy: set.privacyUrl || 'https://dreamindiarealty.com/privacy-policy', site: set.siteUrl || 'https://dreamindiarealty.com' };
}
async function geo(S, tok, areas) {
  const g = { cities: [], neighborhoods: [], regions: [], subcities: [] };
  for (const a of areas) {
    const r = await S.graph('/search', { type: 'adgeolocation', q: a.name, location_types: ['city', 'neighborhood', 'subcity', 'region'], country_code: 'IN', limit: 3 }, tok).catch(() => ({ data: [] }));
    const x = (r.data || [])[0]; if (!x) continue;
    if (x.type === 'city') g.cities.push({ key: x.key, radius: a.radius_km, distance_unit: 'kilometer' });
    else if (x.type === 'neighborhood') g.neighborhoods.push({ key: x.key });
    else if (x.type === 'subcity') g.subcities.push({ key: x.key });
    else if (x.type === 'region') g.regions.push({ key: x.key });
  }
  for (const k of Object.keys(g)) if (!g[k].length) delete g[k];
  if (!Object.keys(g).length) throw err(409, 'Facebook did not recognise any of the areas. Edit the plan with Mumbai area names (e.g. Andheri, Goregaon, Mumbai).');
  return g;
}
async function interests(S, tok, names) {
  const out = [];
  for (const n of names) { const r = await S.graph('/search', { type: 'adinterest', q: n, limit: 1 }, tok).catch(() => ({ data: [] })); const x = (r.data || [])[0]; if (x && !out.some((o) => o.id === x.id)) out.push({ id: x.id, name: x.name }); }
  return out;
}

async function launch(user, id) {
  if (!require('./changes').isApprover(user) && !require('./roles').has(user, 'marketing.edit')) throw err(403, 'Not allowed.');
  const a = await get(id);
  if (!['approved', 'failed'].includes(a.status) || !a.approved_by) throw err(409, a.status === 'draft' ? 'The plan must be approved first.' : `It is ${a.status}.`);
  const P = a.plan, M = { ...(a.meta || {}) }, save = () => db.q('update ad_plans set meta = $2 where id = $1', [id, M]);
  try {
    const { S, tok, act, page, privacy, site } = await metaParts();
    const start = new Date(Date.now() + 3600e3), end = new Date(start.getTime() + P.budget.days * 864e5);
    if (!M.campaign) { M.campaign = (await S.graphPost(`/${act}/campaigns`, { name: `${a.project} · ${P.campaign_name}`, objective: 'OUTCOME_LEADS', status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION', is_adset_budget_sharing_enabled: false }, tok)).id; await save(); }
    if (!M.form) {
      const qs = [{ type: 'FULL_NAME' }, { type: 'PHONE' }, ...P.lead_form.questions.map((q, i) => ({ type: 'CUSTOM', key: 'q' + (i + 1), label: q }))];
      M.form = (await S.graphPost(`/${page.id}/leadgen_forms`, { name: `${a.project} · ${P.campaign_name} · ${new Date().toISOString().slice(0, 10)}`, questions: qs, locale: 'en_US',
        privacy_policy: { url: privacy, link_text: 'Privacy policy' }, follow_up_action_url: site, context_card: { title: P.lead_form.intro, style: 'PARAGRAPH_STYLE', content: [P.why.slice(0, 80) || 'Get the details on call.'] } }, page.token)).id; await save();
    }
    if (!M.adset) {
      const targeting = { geo_locations: await geo(S, tok, P.audience.areas), age_min: P.audience.age_min, age_max: P.audience.age_max, targeting_automation: { advantage_audience: 0 } };
      const ints = await interests(S, tok, P.audience.interests); if (ints.length) targeting.flexible_spec = [{ interests: ints }];
      M.adset = (await S.graphPost(`/${act}/adsets`, { name: `${P.campaign_name} · audience`, campaign_id: M.campaign, daily_budget: Math.round(P.budget.daily * 100), billing_event: 'IMPRESSIONS', optimization_goal: 'LEAD_GENERATION',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', destination_type: 'ON_AD', promoted_object: { page_id: page.id }, targeting, start_time: start.toISOString(), end_time: end.toISOString(), status: 'PAUSED' }, tok)).id; await save();
    }
    if (!M.image) {
      const f = await db.one('select data from ad_plan_files where plan_id = $1 order by id limit 1', [id]);
      const r = await S.graphPost(`/${act}/adimages`, { bytes: f.data.toString('base64') }, tok);
      M.image = Object.values(r.images || {})[0]?.hash; if (!M.image) throw err(502, 'Facebook did not take the image.'); await save();
    }
    M.ads = M.ads || [];
    for (const [i, cr] of P.creatives.entries()) {
      if (M.ads[i]) continue;
      const creative = (await S.graphPost(`/${act}/adcreatives`, { name: `${P.campaign_name} · ${i + 1}`, object_story_spec: { page_id: page.id, ...(page.ig ? { instagram_user_id: page.ig.id } : {}),
        link_data: { image_hash: M.image, link: site, message: cr.primary_text, name: cr.headline, description: cr.description, call_to_action: { type: cr.cta, value: { lead_gen_form_id: M.form } } } } }, tok)).id;
      M.ads[i] = (await S.graphPost(`/${act}/ads`, { name: `${P.campaign_name} · ad ${i + 1}`, adset_id: M.adset, creative: { creative_id: creative }, status: 'PAUSED' }, tok)).id; await save();
    }
    M.account = act; M.page = page.id;
    await db.q("update ad_plans set status = 'launched', meta = $2, error = null, launched_at = now() where id = $1", [id, M]);
    return { ok: true, meta: M, manager: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace('act_', '')}&selected_campaign_ids=${M.campaign}` };
  } catch (e) {
    await db.q("update ad_plans set status = 'failed', meta = $2, error = $3 where id = $1", [id, M, String(e.message).slice(0, 500)]);
    throw e;
  }
}

async function goLive(user, id, on = true) {
  if (!require('./changes').isApprover(user)) throw err(403, 'Only Syed Rafi Ishaq or Syed Sameer Ishaq can start the ads.');
  const a = await get(id); if (!['launched', 'live'].includes(a.status)) throw err(409, 'Build it in Meta first (Launch).');
  const { S, tok } = await metaParts();
  const st = on ? 'ACTIVE' : 'PAUSED';
  for (const x of [a.meta.campaign, a.meta.adset, ...(a.meta.ads || [])].filter(Boolean)) await S.graphPost(`/${x}`, { status: st }, tok);
  await db.q('update ad_plans set status = $2 where id = $1', [id, on ? 'live' : 'launched']);
  return { ok: true };
}

module.exports = { generate, list, get, edit, addFile, decide, launch, goLive, clean, CTAS };
