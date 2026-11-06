// The AI marketing agent team (/agents): one system for Dream India Realty, used project by project.
// Modelled on the "AI native social media agent team" Rafi Sir sent (6 Nov 2026): signals come in, the Orchestrator
// scores them and briefs a department, the departments draft in the brand's voice from one knowledge layer, and only
// what the owner's approval bar says goes to the owner. Results feed the signals again.
//
// scope = 'company' (Dream India as a whole) or a project id as text. Each project keeps its own owner input, its own
// knowledge files (falling back to the company's), its own funnels, drafts, leads and feed.
//
//   run(scope)        the Orchestrator: collect signals → find what interrupts the loop → brief → draft → owner
//   tick()            the cron (every 10 minutes): comment-to-DM funnels, comment notes, then each switched-on scope
//                     whose last run is 30 minutes old
//   pollFunnels()     Instagram / Facebook comments with a funnel's keyword get a private DM; a number sent back in the
//                     DM becomes a lead (mkt-leads.add), so every lead asked to be contacted (no lists, no scraping)
//   state(scope)      everything the command centre shows
//
// Safety: nothing is published from here. Drafts go to the Content calendar as "Waiting for approval" (or "Approved"
// only when the owner sets the approval bar to routine posts), and approved posts are still posted by the existing
// Marketing flow once a design is attached. A project without a MahaRERA number gets area and brand content only,
// never the project, its prices or bookings (RERA section 3). Funnels DM only test accounts until switched to live.
const db = require('./db');

const brainOn = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.AGENT_MODEL || 'claude-sonnet-5-5';
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const today = () => istNow().toISOString().slice(0, 10);
const pidOf = (scope) => (scope === 'company' ? null : +scope);
const okScope = (s) => s === 'company' || /^\d{1,9}$/.test(String(s));
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// ---------- the team ----------
// dep: what an agent needs to run. A missing one shows as "waiting for …" on the screen, never as running.
const DEPS = {
  erp: 'the ERP', brain: 'Claude (ANTHROPIC_API_KEY)', meta: 'Facebook / Instagram connected', youtube: 'YouTube connected',
  gads: 'Google Ads connected', website: 'the website tracker', ivr: 'Exotel (IVR)', whatsapp: 'Click Connect WhatsApp',
  canva: 'Canva connected', voice: 'ElevenLabs (ELEVENLABS_API_KEY)', gsc: 'Google Search Console', gbp: 'Google Business Profile',
  linkedin: 'LinkedIn', portals: 'portal lead emails',
};
const SIGNALS = [
  { name: 'Instagram insights', dep: 'meta' }, { name: 'Facebook insights', dep: 'meta' }, { name: 'Meta ads', dep: 'meta' },
  { name: 'YouTube analytics', dep: 'youtube' }, { name: 'Google Ads', dep: 'gads' }, { name: 'Website visits', dep: 'website' },
  { name: 'IVR calls', dep: 'ivr' }, { name: 'WhatsApp enquiries', dep: 'whatsapp' }, { name: 'Search Console', dep: 'gsc' }, { name: 'Google reviews', dep: 'gbp' },
];
const RECORD = [
  { name: 'Leads (ERP)', dep: 'erp' }, { name: 'Content calendar', dep: 'erp' }, { name: 'Design library', dep: 'erp' },
  { name: 'Telecalling', dep: 'erp' }, { name: 'Channel partners', dep: 'erp' }, { name: 'Bookings', dep: 'erp' },
];
const BRAIN = [
  { name: 'Claude', dep: 'brain' }, { name: 'Memory (knowledge layer)', dep: 'erp' }, { name: 'Canva visuals', dep: 'canva' }, { name: 'Voice-over', dep: 'voice' },
];
const ORCH = [
  ['collects', 'Collects', 'every signal'], ['scores', 'Scores', 'what matters now'], ['briefs', 'Briefs', 'the right department'],
  ['drafts', 'Drafts', 'in your voice'], ['schedules', 'Schedules', 'every channel'], ['approves', 'Approves', 'or calls the owner'],
];
const DEPTS = [
  { id: 'market-radar', name: 'Market Radar', idle: 'watching competitors and the area', tools: [{ name: 'Competitor ads (Meta Ad Library)', dep: 'meta' }, { name: 'Area news', dep: 'brain' }, { name: 'Audience insights', dep: 'meta' }, { name: 'Trend watch', dep: 'brain' }, { name: 'Mention watch', dep: 'meta' }] },
  { id: 'search', name: 'Search Visibility', idle: 'keeping the keyword map', tools: [{ name: 'Search Console', dep: 'gsc' }, { name: 'Website tracker', dep: 'website' }, { name: 'Keyword map', dep: 'erp' }, { name: 'Page audit', dep: 'brain' }, { name: 'Google Business posts', dep: 'gbp' }] },
  { id: 'content-engine', name: 'Content Engine', idle: 'ready to draft in your voice', tools: [{ name: 'Claude drafts', dep: 'brain' }, { name: 'Hook bank', dep: 'erp' }, { name: 'Area research', dep: 'brain' }, { name: 'RERA check', dep: 'erp' }, { name: 'Content calendar', dep: 'erp' }] },
  { id: 'creative', name: 'Creative Studio', idle: 'visual briefs for each draft', tools: [{ name: 'Canva designs', dep: 'canva' }, { name: 'Design library', dep: 'erp' }, { name: 'Visual briefs', dep: 'brain' }, { name: 'Voice-over', dep: 'voice' }, { name: 'Reel scripts', dep: 'brain' }] },
  { id: 'reviews', name: 'Reviews & Reputation', idle: 'reading every comment', tools: [{ name: 'Google reviews', dep: 'gbp' }, { name: 'Comment watch', dep: 'meta' }, { name: 'Reply drafts', dep: 'brain' }, { name: 'Complaint alert', dep: 'brain' }, { name: 'Reply rules', dep: 'erp' }] },
  { id: 'publishing', name: 'Publishing & Social', idle: 'posting what is approved', tools: [{ name: 'Instagram', dep: 'meta' }, { name: 'Facebook', dep: 'meta' }, { name: 'YouTube', dep: 'youtube' }, { name: 'LinkedIn', dep: 'linkedin' }, { name: 'Scheduler', dep: 'erp' }] },
  { id: 'leads', name: 'Leads & Conversations', idle: 'answering enquiries day and night', tools: [{ name: 'Comment-to-DM', dep: 'meta' }, { name: 'WhatsApp welcome', dep: 'whatsapp' }, { name: 'Meta lead forms', dep: 'meta' }, { name: 'Portal leads', dep: 'erp' }, { name: 'IVR', dep: 'ivr' }, { name: '2-hour call alarm', dep: 'erp' }] },
  { id: 'results', name: 'Results & ROI', idle: 'following rupees to bookings', tools: [{ name: 'Spend tracker', dep: 'erp' }, { name: 'Cost per lead', dep: 'erp' }, { name: 'Lead → visit → booking', dep: 'erp' }, { name: 'Meta conversions', dep: 'meta' }, { name: 'Weekly digest', dep: 'erp' }] },
];
const AGENT_NAMES = { orchestrator: 'Orchestrator', owner: 'Owner', brain: 'The Brain', engage: 'Engage', ...Object.fromEntries(DEPTS.map((d) => [d.id, d.name])) };
// What interrupts the loop: the moments that used to need a marketer at a desk.
const TRIGGERS = [
  { kind: 'funnel', name: 'Someone comments the keyword', dept: 'leads' },
  { kind: 'night_lead', name: 'A lead comes in at night', dept: 'leads' },
  { kind: 'lead_waiting', name: 'A lead not called in 2 hours', dept: 'leads' },
  { kind: 'calendar_thin', name: 'Content calendar looks thin', dept: 'content-engine' },
  { kind: 'post_viral', name: 'A post goes viral', dept: 'publishing' },
  { kind: 'complaint', name: 'A complaint lands in the comments', dept: 'reviews' },
  { kind: 'comments_waiting', name: 'Comments waiting for a reply', dept: 'reviews' },
  { kind: 'cpl_up', name: 'Cost per lead jumps on an ad', dept: 'results' },
  { kind: 'search_spike', name: 'Search demand spikes', dept: 'search', dep: 'gsc' },
  { kind: 'review_low', name: 'A one-star Google review', dept: 'reviews', dep: 'gbp' },
];

// ---------- the knowledge layer ----------
// The brand brain: files every agent reads. A project's own copy wins over the company's.
const KB = [
  { path: '/brand-brain/facts.md', title: 'Facts', note: 'Who we are, or this project: location, homes, amenities, possession, RERA' },
  { path: '/brand-brain/voice-guide.md', title: 'Voice guide', note: 'How we sound' },
  { path: '/compliance/rules.md', title: 'Compliance', note: 'RERA and advertising rules every draft is checked against' },
  { path: '/content/hook-bank.md', title: 'Hook bank', note: 'Opening lines that work' },
  { path: '/social/channel-playbooks.md', title: 'Channel playbooks', note: 'What each channel gets' },
  { path: '/conversation/faq-library.md', title: 'FAQ library', note: 'Answers for DMs and comments' },
  { path: '/signals-seo/keyword-map.md', title: 'Keyword map', note: 'What buyers search for' },
  { path: '/creative/visual-specs.md', title: 'Visual specs', note: 'Look and feel of every design' },
  { path: '/reputation/reply-rules.md', title: 'Reply rules', note: 'How we answer comments and complaints' },
  { path: '/reporting/kpi-model.md', title: 'KPI model', note: 'What we measure' },
];
const KB_DEFAULT = {
  '/brand-brain/facts.md': `# Dream India Realty: facts (check and correct)
- Part of Dream India Group, founded 2009; real estate development in Mumbai and Hyderabad.
- Redevelopment and SRA specialists in Mumbai: we rebuild old buildings and slums into new homes, families first.
- Delivered about 2.26 million sq ft; 13+ projects.
- Projects: Dream Signature (Oshiwara / Jogeshwari West), Dream Aspire (Lokhandwala, Andheri West), DZ City (Mumbra), The Valencia (Banjara Hills, Hyderabad).
- Website: dreamindiarealty.com · Instagram: @dreamindiarealty`,
  '/brand-brain/voice-guide.md': `# Voice guide
- Warm, confident, no hard sell. We sound like a builder who has done this for years, not an advertiser.
- Plain English. Short sentences. A Hindi phrase is fine where a Mumbai family would say it.
- Talk about families, everyday life, the commute, the school run, the view, not "luxurious lifestyles".
- Never: "guaranteed returns", "best investment", "limited period offer" pressure, made-up numbers.
- Every post ends with one clear next step: comment a word, WhatsApp us, or visit.`,
  '/compliance/rules.md': `# Compliance (every draft is checked against this)
- A project may be advertised only after it is registered with MahaRERA (RERA Act, section 3). Before that: no project name in ads, no prices, no units, no bookings, no "register interest" or EOI language. Area and brand content only.
- After registration: every post about the project carries "MahaRERA No.: <number> | maharera.maharashtra.gov.in".
- No promises of returns or appreciation. No "guaranteed". Pictures are "artist's impression".
- Prices only as given in the facts file, with "+ taxes as applicable" where the facts say so.
- Leads come only from people who contact us (comments, DMs, forms, calls). No bought or scraped lists.`,
  '/content/hook-bank.md': `# Hook bank
- "What ₹X actually gets you in [area] today"
- "3 things to check before you book any flat in Mumbai"
- "Why families are moving to [area]"
- "Redevelopment: what happens to the old tenants? (We have done it 13 times)"
- "Metro, schools, hospitals: [area] in 30 seconds"
- "Comment [WORD] and we will send you [the thing]"`,
  '/social/channel-playbooks.md': `# Channel playbooks
- Instagram: reels 15–30 seconds, first 2 seconds carry the hook; carousels for "things to know"; stories for site progress. 4 posts a week.
- Facebook: the same posts, a little longer caption; family and NRI audience.
- YouTube: walkthroughs and area guides, 2–5 minutes; shorts from the reels.
- LinkedIn: company news, deliveries, the Chairman's view, investors.
- WhatsApp: replies only to people who wrote to us or gave their number.`,
  '/conversation/faq-library.md': `# FAQ library (fill in per project)
- Where exactly is it?
- What sizes and prices? (only once registered with MahaRERA)
- Possession date?
- Loans: which banks?
- Site visit timings: daily 10 am–7 pm; WhatsApp us to book.`,
  '/signals-seo/keyword-map.md': `# Keyword map
- flats in [area] · 1 BHK / 2 BHK / 3 BHK in [area] · new projects in [area] · redevelopment [area]
- ready to move flats Mumbai · under construction flats near metro · flats near Western Express Highway`,
  '/creative/visual-specs.md': `# Visual specs
- Brand navy #140C59 with gold accents; clean white space; real photos of the site and area where possible.
- Logo bottom right; RERA line bottom in small print when the project is registered.
- Renders marked "Artist's impression".`,
  '/reputation/reply-rules.md': `# Reply rules
- Reply to every genuine comment within a few hours, by name, in the language they used.
- Price questions: "We have sent you the details in DM" (and send them once the project is registered).
- Complaints: thank them, never argue in public, move it to DM or a call, and tell Management the same day.
- Spam: hide, do not reply.`,
  '/reporting/kpi-model.md': `# KPI model
- Leads by source, cost per lead, % called within 2 hours, site visits, bookings, cost per booking.
- Content: reach, saves, shares, comments with keywords, DMs started.`,
};
const PROJECT_FACTS = (p) => `# ${p.name}: facts (fill in)
- Location: ${p.location || ''}
- MahaRERA No.: ${p.rera_no || 'NOT REGISTERED YET: area and brand content only'}
- Homes: (configurations and carpet areas)
- Amenities:
- Possession:
- Price policy: (only after RERA registration)`;

// ---------- helpers ----------
async function settingsOf(scope) {
  const r = await db.one('select * from ag_scope where scope = $1', [scope]);
  const owner = { voice: '', positioning: '', budgetCap: null, approvalBar: 'all', postsPerWeek: 4, ...(r ? r.owner : {}) };
  return { scope, enabled: r ? r.enabled : scope === 'company', paused: r ? r.paused : false, owner, lastRunAt: r ? r.last_run_at : null };
}
async function killed() { const r = await db.one("select paused from ag_scope where scope = 'all'"); return !!(r && r.paused); }
async function say(scope, agent, to, text, kind = 'say', ref = null) {
  await db.q('insert into ag_events (scope, agent, to_agent, kind, text, ref) values ($1, $2, $3, $4, $5, $6)', [scope, agent, to, kind, clip(text, 600), ref]);
}
const log = (scope, text, ref) => say(scope, 'system', null, text, 'log', ref);

async function knowledge(scope) {
  const rows = await db.q('select scope, path, body, updated_at from ag_knowledge where scope = any($1)', [[scope, 'company']]);
  const p = scope === 'company' ? null : await db.one('select id, name, location, rera_no from projects where id = $1', [+scope]);
  return KB.map((k) => {
    const own = rows.find((r) => r.scope === scope && r.path === k.path), co = rows.find((r) => r.scope === 'company' && r.path === k.path);
    const body = own ? own.body : (p && k.path === '/brand-brain/facts.md' ? PROJECT_FACTS(p) : co ? co.body : KB_DEFAULT[k.path]);
    return { ...k, body, from: own ? 'own' : (p && k.path === '/brand-brain/facts.md' ? 'starter' : co ? 'company' : 'starter'), updatedAt: own ? own.updated_at : co ? co.updated_at : null };
  });
}

async function connections() {
  const c = { erp: true, brain: brainOn(), voice: !!process.env.ELEVENLABS_API_KEY, gsc: false, gbp: false, linkedin: false };
  const t = (fn) => fn().catch(() => null);
  const [soc, gads, canva, web] = await Promise.all([
    t(() => require('./social').status()), t(() => require('./gads').status()), t(() => require('./mkt-tools').canvaStatus()),
    t(() => db.one("select count(*)::int as n from mkt_web_hits where at > now() - interval '30 days'")),
  ]);
  c.meta = !!(soc && soc.meta.connected); c.instagram = !!(soc && soc.meta.pages.some((p) => p.instagram)); c.youtube = !!(soc && soc.youtube.connected);
  c.gads = !!(gads && gads.connected); c.canva = !!(canva && canva.connected); c.website = !!(web && web.n);
  try { c.ivr = require('./exotel').configured(); } catch { c.ivr = false; }
  try { c.whatsapp = !!require('./whatsapp').configured(); } catch { c.whatsapp = false; }
  return c;
}
const toolsWith = (list, c) => list.map((t) => ({ ...t, on: !!c[t.dep], needs: c[t.dep] ? null : DEPS[t.dep] }));

// ---------- the Brain ----------
async function brain(prompt, max = 2500) {
  if (!brainOn()) throw Object.assign(new Error('The Brain needs ANTHROPIC_API_KEY in Vercel.'), { status: 409 });
  const r = await fetch((process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: max, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Claude: ${(j.error && j.error.message) || r.status}`), { status: 502 });
  const text = (j.content || []).map((x) => x.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { throw Object.assign(new Error('The Brain answered in a form the ERP could not read.'), { status: 502 }); }
}
const kbText = (files, paths) => files.filter((f) => paths.includes(f.path)).map((f) => f.body).join('\n\n');

// Content Engine: n post drafts into the Content calendar, waiting for approval.
async function draftPosts(scope, n, angle, user = null) {
  const pid = pidOf(scope), set = await settingsOf(scope), files = await knowledge(scope);
  const p = pid ? await db.one('select id, name, location, rera_no from projects where id = $1', [pid]) : null;
  const preRera = !!(p && !p.rera_no);
  const planned = await db.q("select title from mkt_posts where project_id is not distinct from $1 and coalesce(publish_at, created_at) > now() - interval '30 days' order by id desc limit 30", [pid]);
  const top = await db.q("select caption, views, likes, comments from mkt_media where posted_at > now() - interval '90 days' and caption is not null order by coalesce(views, 0) desc limit 5");
  const o = set.owner;
  const prompt = `You are the Content Engine of Dream India Realty's AI marketing team (Mumbai real estate developer).
Write ${n} social media post drafts${p ? ` for ${p.name}${p.location ? ' (' + p.location + ')' : ''}` : ' for the Dream India Realty brand'}.
Angle for this brief: ${angle}

${preRera ? `IMPORTANT: this project is NOT registered with MahaRERA yet. Do not name or advertise the project, its homes, prices or bookings, and do not invite people to register interest or book. Write only about the area (${p.location || 'the neighbourhood'}), everyday life there, buying-a-home advice, and Dream India as a developer. The call to action may only be to follow us or to comment a word for area updates and launch news.` : p ? `MahaRERA No.: ${p.rera_no}. Every caption must end with the line "MahaRERA No.: ${p.rera_no} | maharera.maharashtra.gov.in".` : 'This is brand content for the company, not one project.'}

Owner's voice: ${o.voice || '(see the voice guide)'}
Owner's positioning: ${o.positioning || '(see the facts)'}

KNOWLEDGE LAYER
${kbText(files, ['/brand-brain/facts.md', '/brand-brain/voice-guide.md', '/compliance/rules.md', '/content/hook-bank.md', '/social/channel-playbooks.md', '/signals-seo/keyword-map.md', '/creative/visual-specs.md'])}

Already planned or posted recently (do not repeat): ${planned.map((x) => x.title).join(' | ') || 'nothing yet'}
Our best recent posts (learn from what worked): ${top.map((x) => `"${clip(x.caption, 140)}" (${x.views || 0} views)`).join(' | ') || 'no figures yet'}

Mix the kinds (reel, carousel, post). Each caption 60–180 words, ending with one clear call to action and 5–8 hashtags.
Answer as JSON only: {"posts":[{"title":"short internal title","kind":"reel|carousel|post|story","channels":["instagram","facebook"],"hook":"the first line or first 2 seconds","caption":"the full caption","visual":"what the design or video shows, for the Creative Studio","headline":"the big words on the design, at most 8 words","subline":"one supporting line on the design, at most 14 words","cta":"the button-style call to action on the design, at most 5 words","slides":[{"headline":"slide words, at most 8","subline":"at most 18 words"}],"day":0}]} where slides is only for a carousel: 4 to 6 slides that deliver what the caption promises (slide 1 is the cover with the hook, the last slide is the call to action), and day is 0–6 (days from today, spread them out).${preRera ? ' The design words must not name the project either.' : ''}`;
  const out = await brain(prompt, 4000);
  const posts = (Array.isArray(out.posts) ? out.posts : []).slice(0, n);
  const bar = o.approvalBar === 'routine' && !preRera;
  const ids = [];
  for (const [i, x] of posts.entries()) {
    const kind = ['reel', 'carousel', 'post', 'story'].includes(x.kind) ? x.kind : 'post';
    const chans = (Array.isArray(x.channels) ? x.channels : ['instagram', 'facebook']).filter((c) => ['instagram', 'facebook', 'youtube', 'linkedin'].includes(c));
    let caption = clip(x.caption, 2200);
    if (p && p.rera_no && !caption.replace(/\s/g, '').toUpperCase().includes(String(p.rera_no).replace(/\s/g, '').toUpperCase())) caption += `\n\nMahaRERA No.: ${p.rera_no} | maharera.maharashtra.gov.in`;
    const d = istNow(); d.setUTCDate(d.getUTCDate() + Math.min(13, Math.max(1, (+x.day || i) + 1))); const at = new Date(d.toISOString().slice(0, 10) + 'T11:00:00+05:30');
    // routine = no rupee figure and no offer words; anything else still waits for the owner
    const routine = bar && !/₹|rs\.?\s?\d|lakh|crore|offer|discount|price/i.test(caption);
    const r = await db.one(`insert into mkt_posts (project_id, title, kind, channels, publish_at, status, caption, note, agent, created_by, sent_at, approved_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'content-engine', $9, now(), $10) returning id`,
      [pid, clip(x.title || 'Draft', 140), kind, chans.length ? chans : ['instagram', 'facebook'], at, routine ? 'approved' : 'review', caption,
        clip(`Drafted by the Content Engine (AI)${user ? ', brief from ' + user.name : ''}${routine ? ', approved under the routine approval bar' : ''}.\nHook: ${x.hook || ''}\nVisual brief (Creative Studio): ${x.visual || ''}`, 2000), null, routine ? new Date() : null]);
    const dt = { headline: clip(x.headline || x.hook || x.title, 120), subline: clip(x.subline, 200), cta: clip(x.cta, 60) };
    if (kind === 'carousel' && Array.isArray(x.slides)) dt.slides = x.slides.slice(0, 8).map((y) => ({ headline: clip(y && y.headline, 120), subline: clip(y && y.subline, 200) })).filter((y) => y.headline);
    await db.q('update mkt_posts set design_text = $2 where id = $1', [r.id, dt]);
    ids.push({ id: r.id, title: x.title, routine });
  }
  // the Creative Studio designs each draft in Canva when a brand template is chosen for its kind
  for (const x of ids) { const d = await design(x.id).catch((e) => ({ error: e.message })); x.designed = !!(d && d.added); if (d && d.error) x.designError = d.error; }
  return ids;
}

// ---------- Creative Studio: a post's design from the Canva brand template chosen for its kind ----------
// Field names in the template (Canva → Data autofill) are matched loosely: headline/title, subline/body/text, cta/button,
// project, location/area, rera, website, phone. Pre-RERA projects never get the project name or RERA line on the design.
async function design(postId, user = null) {
  const T = require('./mkt-tools');
  const p = await db.one('select p.*, pr.name as pname, pr.location as ploc, pr.rera_no from mkt_posts p left join projects pr on pr.id = p.project_id where p.id = $1', [postId]);
  if (!p) throw Object.assign(new Error('That post is not there any more.'), { status: 404 });
  const scope = p.project_id ? String(p.project_id) : 'company';
  const st = await T.canvaStatus().catch(() => ({}));
  if (!st.connected) return { skipped: 'Canva is not connected (Sales & Marketing → Set-up → Connect Canva).' };
  const set = await settingsOf(scope), co = scope === 'company' ? set : await settingsOf('company');
  const tpl = { ...((co.owner && co.owner.templates) || {}), ...((set.owner && set.owner.templates) || {}) };
  const templateId = tpl[p.kind] || tpl.post || tpl.default;
  if (!templateId) return { skipped: 'No Canva brand template chosen yet (AI Agent Team → Creative Studio → Canva templates).' };
  const pre = !!(p.project_id && !p.rera_no);
  let dt = p.design_text || {};
  // A draft without design words (older drafts, or one typed by hand): the Brain writes them from the caption, once.
  if ((!dt.subline || (p.kind === 'carousel' && !(dt.slides || []).length)) && brainOn() && p.caption) {
    const w = await brain(`You write the words on a social media design for Dream India Realty (Mumbai real estate developer). The post is a ${p.kind}.
Title: ${p.title}
Caption:
${clip(p.caption, 2200)}
${pre ? 'The project is not registered with MahaRERA yet: do not name the project, prices or bookings.' : ''}
Answer as JSON only: {"headline":"the big words, at most 8 words","subline":"one supporting line, at most 14 words","cta":"a call to action, at most 5 words"${p.kind === 'carousel' ? ',"slides":[{"headline":"at most 8 words","subline":"at most 18 words"}]' : ''}}${p.kind === 'carousel' ? '\nslides: 4 to 6 slides that deliver what the caption promises; slide 1 is the cover with the hook, the last slide is the call to action. Use only facts in the caption.' : ''}`, 1500).catch(() => null);
    if (w && w.headline) {
      dt = { headline: clip(w.headline, 120), subline: clip(w.subline, 200), cta: clip(w.cta, 60) };
      if (Array.isArray(w.slides)) dt.slides = w.slides.slice(0, 8).map((y) => ({ headline: clip(y && y.headline, 120), subline: clip(y && y.subline, 200) })).filter((y) => y.headline);
      await db.q('update mkt_posts set design_text = $2 where id = $1', [p.id, dt]);
    }
  }
  // Older drafts with no Brain: the caption's first real sentence (without hashtags) is the supporting line.
  const firstLine = String(p.caption || '').replace(/#\S+/g, '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).find((s) => s && s.length > 20 && s !== p.title && !/^thought for the day/i.test(s)) || '';
  const base = { headline: dt.headline || p.title, subline: dt.subline || firstLine.slice(0, 140), cta: dt.cta || 'Comment to know more', project: pre ? '' : (p.pname || 'Dream India Realty'),
    location: p.ploc || '', rera: !pre && p.rera_no ? `MahaRERA No.: ${p.rera_no} | maharera.maharashtra.gov.in` : '', website: 'dreamindiarealty.com', phone: '' };
  const ds = await T.canvaDataset(templateId);
  const fieldsFor = (val) => { const fields = {};
    for (const k of Object.keys(ds)) {
      const n = k.toLowerCase();
      const v = /rera/.test(n) ? val.rera : /head|title|hook|main/.test(n) ? val.headline : /sub|body|desc|text|line|copy/.test(n) ? val.subline : /cta|button|action/.test(n) ? val.cta
        : /project|name/.test(n) ? val.project : /loc|area|address/.test(n) ? val.location : /web|url|site/.test(n) ? val.website : null;
      // A field with nothing to say is blanked, never left showing the template's dummy text (e.g. a sample RERA number).
      fields[k] = v || ' ';
    }
    return fields; };
  // A carousel is one image per slide (each made from the same template); anything else is one image.
  const pages = p.kind === 'carousel' && (dt.slides || []).length ? dt.slides.map((y) => ({ ...base, headline: y.headline, subline: y.subline || ' ' })) : [base];
  const made = [], images = [];
  for (const [i, val] of pages.entries()) {
    const m = await T.canvaAutofill(templateId, fieldsFor(val), `${p.title}${pages.length > 1 ? ' · slide ' + (i + 1) : ''} (ERP post ${p.id})`);
    made.push(m);
    for (const f of (m.designId ? await T.canvaExport(m.designId, 'png') : []).slice(0, 1)) if (f.data.length <= 3 * 1024 * 1024) images.push(f);
  }
  // A new design replaces the Creative Studio's earlier ones on this post (files it named design-<post>…); uploads by people stay.
  if (images.length) await db.q("delete from mkt_post_files where post_id = $1 and name like $2", [p.id, `design-${p.id}%`]);
  let added = 0;
  for (const f of images) { await db.q('insert into mkt_post_files (post_id, name, mime, size, data, created_by) values ($1, $2, $3, $4, $5, $6)', [p.id, `design-${p.id}${images.length > 1 ? '-' + (added + 1) : ''}.png`, f.mime, f.data.length, f.data, user ? user.id : null]); added++; }
  const editUrl = made[0] && made[0].editUrl;
  if (editUrl) await db.q('update mkt_posts set canva_url = $2, updated_at = now() where id = $1', [p.id, editUrl]);
  await say(scope, 'creative', 'orchestrator', added ? `Designed "${p.title}" in Canva (${pages.length > 1 ? pages.length + ' slides' : made[0].filled.length + ' text fields filled'}); the design is on the post and can be changed in Canva.` : `Made "${p.title}" in Canva but the export was too big to attach; open it in Canva.`, 'draft', { post: p.id });
  return { added, editUrl, slides: pages.length, filled: made[0] && made[0].filled, fields: Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, v.type])) };
}

// ---------- signals and what interrupts the loop ----------
async function collect(scope) {
  const pid = pidOf(scope), proj = pid ? 'project_id = ' + pid : 'true';
  const one = async (sql, args = []) => (await db.one(sql, args)) || {};
  const s = {};
  s.leads24 = (await one(`select count(*)::int as n from mkt_leads where ${proj} and created_at > now() - interval '24 hours'`)).n || 0;
  s.waiting = await db.q(`select l.id, l.name, l.source, l.created_at, u.name as owner from mkt_leads l left join users u on u.id = l.assigned_to
      where ${proj.replace('project_id', 'l.project_id')} and l.status = 'new' and l.first_contact_at is null and l.created_at < now() - interval '2 hours' and l.created_at > now() - interval '3 days' order by l.created_at limit 20`);
  s.night = await db.q(`select id, name, source, created_at, welcomed_at from mkt_leads where ${proj} and created_at > now() - interval '12 hours'
      and extract(hour from created_at at time zone 'Asia/Kolkata') not between 8 and 20 order by created_at desc limit 10`);
  s.upcoming = (await one(`select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and publish_at between now() and now() + interval '7 days' and status in ('review', 'approved', 'scheduled')`, [pid])).n || 0;
  s.agentDrafts = (await one(`select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and agent is not null and status = 'review'`, [pid])).n || 0;
  if (scope === 'company') {
    s.viral = await db.q(`with m as (select percentile_cont(0.5) within group (order by coalesce(views, 0)) as med from mkt_media where posted_at > now() - interval '30 days')
      select x.network, x.ext_id, x.caption, x.views, x.permalink, m.med from mkt_media x, m where x.posted_at > now() - interval '10 days' and coalesce(x.views, 0) >= 500 and coalesce(x.views, 0) > 3 * greatest(m.med, 1) order by x.views desc limit 3`).catch(() => []);
    s.comments = (await one("select count(*)::int as n from mkt_comments where not done and replied_at is null and at > now() - interval '3 days'").catch(() => ({}))).n || 0;
    s.complaints = await db.q("select c.network, c.ext_id, c.author, c.text, c.permalink from ag_comment_notes n join mkt_comments c using (network, ext_id) where n.kind = 'complaint' and n.at > now() - interval '2 days' and c.replied_at is null").catch(() => []);
  }
  s.cpl = await db.q(`select c.id, c.name, a.spend as s1, a.leads as l1, b.spend as s0, b.leads as l0 from mkt_campaigns c
      join mkt_campaign_months a on a.campaign_id = c.id and a.month = date_trunc('month', now() at time zone 'Asia/Kolkata')::date
      join mkt_campaign_months b on b.campaign_id = c.id and b.month = (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date
      where ${pid ? 'c.project_id = ' + pid : 'true'} and a.spend >= 5000 and a.leads > 0 and b.leads > 0 and (a.spend / a.leads) > 1.5 * (b.spend / b.leads)`).catch(() => []);
  s.funnel = await db.q(`select h.id, h.handle, h.network, h.dm_at, h.lead_id, f.keyword from ag_funnel_hits h join ag_funnels f on f.id = h.funnel_id
      where f.scope = $1 and h.created_at > now() - interval '24 hours' order by h.id desc limit 50`, [scope]);
  return s;
}

// Each interrupt is handled once (its key), then the feed says who did what.
async function flag(scope, kind, key, detail) {
  const r = await db.one('insert into ag_interrupts (scope, kind, key, detail) values ($1, $2, $3, $4) on conflict (key) do nothing returning id', [scope, kind, key, detail]);
  return r ? r.id : null;
}
// to the owner: the message just said to the owner is kept with the item, for "Waiting for you"
const settle = (id, status) => db.q(`update ag_interrupts i set status = $2, handled_at = case when $2 = 'handled' then now() else i.handled_at end,
    detail = case when $2 = 'owner' then coalesce(i.detail, '{}'::jsonb) || coalesce((select jsonb_build_object('msg', e.text, 'link', e.ref->>'link') from ag_events e where e.scope = i.scope and e.kind = 'owner' order by e.id desc limit 1), '{}'::jsonb) else i.detail end
    where i.id = $1`, [id, status]);

async function run(scope, { trigger = 'schedule', user = null } = {}) {
  if (!okScope(scope)) throw Object.assign(new Error('Unknown scope.'), { status: 400 });
  const set = await settingsOf(scope), out = { scope, flagged: [], drafts: 0 };
  if (await killed()) { await log(scope, 'kill switch is on: no agent runs'); return { ...out, skipped: 'kill switch' }; }
  if (set.paused) { await log(scope, 'paused by the owner: no agent runs'); return { ...out, skipped: 'paused' }; }
  await db.q("insert into ag_scope (scope, enabled, last_run_at) values ($1, $2, now()) on conflict (scope) do update set last_run_at = now()", [scope, set.enabled]);
  await log(scope, `orchestrator.run({ trigger: '${trigger}' })`);
  const s = await collect(scope), d = today();
  await say(scope, 'orchestrator', null, `Collected every signal: ${s.leads24} new lead${s.leads24 === 1 ? '' : 's'} in 24 hours, ${s.upcoming} post${s.upcoming === 1 ? '' : 's'} planned for the next 7 days${s.funnel.length ? `, ${s.funnel.length} keyword comment${s.funnel.length === 1 ? '' : 's'}` : ''}.`, 'collect');

  // comment-to-DM: who commented the keyword today
  if (s.funnel.length) {
    const id = await flag(scope, 'funnel', `${scope}:funnel:${d}:${s.funnel[0].id}`, { hits: s.funnel.length, leads: s.funnel.filter((x) => x.lead_id).length });
    if (id) { out.flagged.push('funnel'); await say(scope, 'leads', 'orchestrator', `${s.funnel.length} people commented the keyword in the last 24 hours; ${s.funnel.filter((x) => x.dm_at).length} got the DM, ${s.funnel.filter((x) => x.lead_id).length} sent their number and are in Leads.`); await settle(id, 'handled'); }
  }
  // a lead at night: the welcome went at once (mkt-leads), the sales person has it for the morning
  for (const l of s.night) {
    const id = await flag(scope, 'night_lead', `${scope}:night:${l.id}`, { lead: l.id, source: l.source });
    if (!id) continue; out.flagged.push('night_lead');
    const t = new Date(l.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    await say(scope, 'leads', 'orchestrator', `Lead at ${t} from ${l.source}${l.name ? ' (' + l.name + ')' : ''}: handled. ${l.welcomed_at ? 'WhatsApp welcome sent at once' : 'Given to sales'}; first call due in the morning.`);
    await settle(id, 'handled');
  }
  // a lead nobody called in 2 hours: to the owner
  if (s.waiting.length) {
    const id = await flag(scope, 'lead_waiting', `${scope}:waiting:${d}:${s.waiting.map((x) => x.id).join(',').slice(0, 120)}`, { leads: s.waiting.map((x) => x.id) });
    if (id) { out.flagged.push('lead_waiting'); await say(scope, 'leads', 'owner', `${s.waiting.length} lead${s.waiting.length === 1 ? '' : 's'} not called after 2 hours${s.waiting[0].owner ? ` (${[...new Set(s.waiting.map((x) => x.owner).filter(Boolean))].join(', ')})` : ''}. Calling is a human job: please push the team.`, 'owner'); await settle(id, 'owner'); }
  }
  // the content calendar
  const want = Math.max(1, Math.min(7, Math.round(+set.owner.postsPerWeek || 4)));
  if (s.upcoming < Math.ceil(want / 2) && s.agentDrafts < want) {
    const id = await flag(scope, 'calendar_thin', `${scope}:thin:${d}`, { upcoming: s.upcoming, want });
    if (id) {
      out.flagged.push('calendar_thin');
      const n = Math.min(want - s.agentDrafts, 4);
      await say(scope, 'publishing', 'orchestrator', `Content calendar looks thin: ${s.upcoming} post${s.upcoming === 1 ? '' : 's'} in the next 7 days, the plan is ${want} a week.`);
      await say(scope, 'orchestrator', 'content-engine', `Brief: ${n} drafts for the coming week. Content Engine leads, Creative Studio picks up the visuals.`, 'brief');
      if (!brainOn()) { await say(scope, 'content-engine', 'owner', 'Cannot draft: the Brain is offline (ANTHROPIC_API_KEY missing in Vercel).', 'owner'); await settle(id, 'owner'); }
      else {
        try {
          const ids = await draftPosts(scope, n, 'a balanced week: one area or lifestyle story, one trust builder (our track record, construction progress, redevelopment families), one useful tip for home buyers, and one engagement post with a comment keyword', user);
          out.drafts += ids.length;
          await say(scope, 'content-engine', 'orchestrator', `Drafts ready: ${ids.map((x) => '"' + x.title + '"').join(', ')}. RERA check passed.`, 'draft', { posts: ids.map((x) => x.id) });
          await say(scope, 'creative', 'orchestrator', `Visual briefs attached to ${ids.length} draft${ids.length === 1 ? '' : 's'}; designs to be made in Canva.`);
          const waiting = ids.filter((x) => !x.routine).length;
          if (waiting) await say(scope, 'orchestrator', 'owner', `${waiting} draft${waiting === 1 ? '' : 's'} waiting for your check & approve.`, 'owner');
          if (ids.length - waiting) await say(scope, 'orchestrator', 'publishing', `${ids.length - waiting} routine post${ids.length - waiting === 1 ? '' : 's'} approved under your approval bar; they go out once the design is attached.`);
          await settle(id, waiting ? 'owner' : 'handled');
        } catch (e) { await say(scope, 'content-engine', 'owner', 'Drafting failed: ' + e.message, 'owner'); await settle(id, 'owner'); }
      }
    }
  }
  // a post doing three times better than usual: repurpose it; a boost costs money, so the owner decides
  for (const v of s.viral || []) {
    const id = await flag(scope, 'post_viral', `${scope}:viral:${v.network}:${v.ext_id}`, { network: v.network, ext: v.ext_id, views: +v.views });
    if (!id) continue; out.flagged.push('post_viral');
    await say(scope, 'publishing', 'orchestrator', `A post is taking off on ${v.network}: ${Number(v.views).toLocaleString('en-IN')} views, more than 3× our usual.`);
    await say(scope, 'orchestrator', 'content-engine', 'Brief: repurpose it as a carousel and a follow-up reel while it is hot.', 'brief');
    if (brainOn()) {
      try { const ids = await draftPosts(scope, 2, `repurpose this post that is doing very well, keeping what worked: "${clip(v.caption, 600)}"`, user); out.drafts += ids.length; await say(scope, 'content-engine', 'orchestrator', `Repurposed: ${ids.map((x) => '"' + x.title + '"').join(', ')}.`, 'draft', { posts: ids.map((x) => x.id) }); }
      catch (e) { await log(scope, 'repurpose failed: ' + e.message); }
    }
    await say(scope, 'orchestrator', 'owner', `Boosting it would spend money: your call${set.owner.budgetCap ? ` (monthly cap ₹${Number(set.owner.budgetCap).toLocaleString('en-IN')})` : ''}.`, 'owner', { link: v.permalink });
    await settle(id, 'owner');
  }
  // comments
  if ((s.comments || 0) >= 5) {
    const id = await flag(scope, 'comments_waiting', `${scope}:comments:${d}`, { open: s.comments });
    if (id) { out.flagged.push('comments_waiting'); await say(scope, 'reviews', 'owner', `${s.comments} comments in the last 3 days have no reply. Suggested replies are in Marketing → Inbox.`, 'owner'); await settle(id, 'owner'); }
  }
  for (const c of s.complaints || []) {
    const id = await flag(scope, 'complaint', `${scope}:complaint:${c.network}:${c.ext_id}`, { author: c.author });
    if (!id) continue; out.flagged.push('complaint');
    await say(scope, 'reviews', 'owner', `Complaint on ${c.network} from ${c.author || 'someone'}: "${clip(c.text, 160)}". Take it to DM or a call today.`, 'owner', { link: c.permalink });
    await settle(id, 'owner');
  }
  for (const c of s.cpl) {
    const id = await flag(scope, 'cpl_up', `${scope}:cpl:${c.id}:${d.slice(0, 7)}`, { campaign: c.id });
    if (!id) continue; out.flagged.push('cpl_up');
    const now = Math.round(c.s1 / c.l1), was = Math.round(c.s0 / c.l0);
    await say(scope, 'results', 'owner', `Cost per lead on "${c.name}" is ₹${now.toLocaleString('en-IN')} this month (₹${was.toLocaleString('en-IN')} last month): the ad may be tiring. New creative, or pause it?`, 'owner');
    await settle(id, 'owner');
  }
  if (!out.flagged.length) await say(scope, 'orchestrator', null, 'Scored everything: nothing needs a new brief right now. Routine work carries on.', 'score');
  return out;
}

// ---------- comment notes: what each new comment is (lead, question, complaint…) and a suggested reply ----------
async function noteComments() {
  if (!brainOn()) return { skipped: 'brain off' };
  const rows = await db.q(`select c.network, c.ext_id, c.author, c.text from mkt_comments c left join ag_comment_notes n using (network, ext_id)
     where n.ext_id is null and c.at > now() - interval '3 days' and coalesce(c.text, '') <> '' order by c.at desc limit 25`);
  if (!rows.length) return { noted: 0 };
  const files = await knowledge('company');
  const out = await brain(`You read comments on Dream India Realty's Instagram and Facebook posts. For each, say what it is and suggest a short reply following the reply rules.
${kbText(files, ['/reputation/reply-rules.md', '/conversation/faq-library.md', '/compliance/rules.md'])}
Comments:
${rows.map((r, i) => `${i}. ${r.author || 'someone'}: ${clip(r.text, 300)}`).join('\n')}
Answer as JSON only: {"notes":[{"i":0,"kind":"lead|question|complaint|praise|spam|other","reply":"suggested reply, or empty for spam"}]}`, 2500);
  let n = 0;
  for (const x of out.notes || []) { const r = rows[+x.i]; if (!r) continue; await db.q('insert into ag_comment_notes (network, ext_id, kind, suggestion) values ($1, $2, $3, $4) on conflict do nothing', [r.network, r.ext_id, clip(x.kind, 20), clip(x.reply, 600)]); n++; }
  return { noted: n };
}

// ---------- comment-to-DM funnels ----------
const kwMatch = (kw, text) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu').test(String(text || ''));
// an Indian mobile in a DM, however it is written: 98200 12345, +91-98200-12345, 09820012345
function phoneIn(text) {
  for (const m of String(text || '').match(/\+?\d[\d\s().-]{8,18}\d/g) || []) { const d = m.replace(/\D/g, ''); const t = d.slice(-10); if (d.length >= 10 && d.length <= 13 && /^[6-9]/.test(t)) return t; }
  return null;
}
async function pollFunnels() {
  const funnels = await db.q('select f.*, array_to_json(f.test_handles) as test_handles, s.paused from ag_funnels f left join ag_scope s on s.scope = f.scope where f.active');
  if (!funnels.length) return { funnels: 0 };
  if (await killed()) return { skipped: 'kill switch' };
  const social = require('./social');
  if (!social.metaOn()) return { skipped: 'Meta app not set' };
  const pages = await social.metaPages().catch(() => []);
  if (!pages.length) return { skipped: 'Facebook / Instagram not connected' };
  const out = { comments: 0, dms: 0, leads: 0, errors: [] };
  const live = funnels.filter((f) => !f.paused);
  for (const page of pages) {
    const tok = page.token;
    for (const net of ['instagram', 'facebook']) {
      const fs = live.filter((f) => f.network === net); if (!fs.length || (net === 'instagram' && !page.ig)) continue;
      // recent posts, their comments
      let media = [];
      try {
        media = net === 'instagram' ? ((await social.graph(`/${page.ig.id}/media`, { fields: 'id,timestamp,permalink', limit: 12 }, tok)).data || []).map((m) => ({ id: m.id, at: m.timestamp, link: m.permalink }))
          : ((await social.graph(`/${page.id}/posts`, { fields: 'id,created_time,permalink_url', limit: 12 }, tok)).data || []).map((m) => ({ id: m.id, at: m.created_time, link: m.permalink_url }));
      } catch (e) { out.errors.push(`${net} posts: ${e.message}`); continue; }
      for (const m of media.filter((x) => Date.now() - Date.parse(x.at) < 21 * 864e5 || fs.some((f) => f.media_ext === x.id))) {
        let list = [];
        try {
          list = net === 'instagram' ? ((await social.graph(`/${m.id}/comments`, { fields: 'id,text,username,timestamp,from', limit: 50 }, tok)).data || []).map((c) => ({ id: c.id, text: c.text, handle: c.username, user: c.from && c.from.id, at: c.timestamp }))
            : ((await social.graph(`/${m.id}/comments`, { fields: 'id,message,from,created_time', limit: 50 }, tok)).data || []).map((c) => ({ id: c.id, text: c.message, handle: c.from && c.from.name, user: c.from && c.from.id, at: c.created_time }));
        } catch (e) { out.errors.push(`${net} comments: ${e.message}`); continue; }
        for (const c of list) {
          if ((net === 'instagram' && page.ig && c.handle === page.ig.username) || (net === 'facebook' && c.user === page.id)) continue;
          out.comments++;
          await db.q('insert into mkt_comments (network, ext_id, media_ext, permalink, author, text, at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (network, ext_id) do nothing', [net, c.id, m.id, m.link, c.handle || null, c.text || '', c.at || null]).catch(() => {});
          const f = fs.find((x) => (!x.media_ext || x.media_ext === m.id) && kwMatch(x.keyword, c.text) && Date.parse(c.at) >= new Date(x.updated_at || x.created_at).getTime() && Date.now() - Date.parse(c.at) < 7 * 864e5);
          if (!f) continue;
          const test = !f.live && !(f.test_handles || []).map((h) => String(h).replace(/^@/, '').toLowerCase()).includes(String(c.handle || '').toLowerCase());
          const hit = await db.one(`insert into ag_funnel_hits (funnel_id, network, comment_id, media_ext, handle, user_ext, text, at, dm_error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              on conflict (network, comment_id) do nothing returning id`, [f.id, net, c.id, m.id, c.handle || null, c.user || null, clip(c.text, 500), c.at || null, test ? 'Test mode: DM not sent (not a test account)' : null]);
          if (!hit || test) continue;
          try {
            await social.graphPost(`/${page.id}/messages`, { recipient: { comment_id: c.id }, message: { text: f.dm_text } }, tok);
            await db.q('update ag_funnel_hits set dm_at = now() where id = $1', [hit.id]); out.dms++;
            if (f.public_reply) await social.graphPost(net === 'instagram' ? `/${c.id}/replies` : `/${c.id}/comments`, { message: f.public_reply }, tok).catch(() => {});
            await say(f.scope, 'leads', 'orchestrator', `${c.handle ? '@' + c.handle : 'Someone'} commented "${f.keyword}" on ${net}: DM sent within minutes.`, 'say', { hit: hit.id });
          } catch (e) { await db.q('update ag_funnel_hits set dm_error = $2 where id = $1', [hit.id, clip(e.message, 300)]); out.errors.push('DM: ' + e.message); }
        }
      }
      // the replies: a number sent back in the DM becomes a lead
      const open = await db.q(`select h.*, f.scope, f.keyword, f.thanks_text from ag_funnel_hits h join ag_funnels f on f.id = h.funnel_id
          where h.network = $1 and h.dm_at is not null and h.lead_id is null and h.user_ext is not null and h.dm_at > now() - interval '7 days'`, [net]);
      if (!open.length) continue;
      let convs = [];
      try { convs = (await social.graph(`/${page.id}/conversations`, { platform: net === 'instagram' ? 'instagram' : 'messenger', fields: 'participants,messages.limit(8){message,from,created_time}', limit: 40 }, tok)).data || []; }
      catch (e) { out.errors.push(`${net} DMs: ${e.message}`); continue; }
      for (const h of open) {
        const conv = convs.find((cv) => ((cv.participants || {}).data || []).some((p) => p.id === h.user_ext)); if (!conv) continue;
        const msg = ((conv.messages || {}).data || []).find((x) => x.from && x.from.id === h.user_ext && Date.parse(x.created_time) >= new Date(h.dm_at).getTime() - 60e3 && phoneIn(x.message));
        if (!msg) continue;
        const phone = phoneIn(msg.message);
        try {
          const r = await require('./mkt-leads').add({ name: h.handle, phone, source: net, projectId: pidOf(h.scope), note: `Comment-to-DM: commented "${h.keyword}" on ${net}${h.handle ? ' as @' + h.handle : ''}, then sent the number in DM.`, ext: `agdm:${h.id}` });
          await db.q('update ag_funnel_hits set lead_id = $2 where id = $1', [h.id, r.id]); out.leads++;
          await say(h.scope, 'leads', 'orchestrator', `${h.handle ? '@' + h.handle : 'A follower'} sent a number in DM: now a lead${r.duplicate ? ' (already known, note added)' : ', given to sales and welcomed on WhatsApp'}.`, 'say', { lead: r.id });
          if (h.thanks_text) { await social.graphPost(`/${page.id}/messages`, { recipient: { id: h.user_ext }, message: { text: h.thanks_text } }, tok).catch(() => {}); await db.q('update ag_funnel_hits set thanked_at = now() where id = $1', [h.id]); }
        } catch (e) { out.errors.push('lead: ' + e.message); }
      }
    }
  }
  await db.q("insert into job_marks (key, info) values ('agents-funnels', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [out]).catch(() => {});
  return out;
}

// ---------- the cron (every 10 minutes) ----------
async function tick() {
  const out = {};
  out.funnels = await pollFunnels().catch((e) => ({ error: e.message }));
  out.notes = await noteComments().catch((e) => ({ error: e.message }));
  const due = await db.q("select scope from ag_scope where enabled and not paused and scope <> 'all' and (last_run_at is null or last_run_at < now() - interval '30 minutes')");
  if (!(await db.one("select 1 as x from ag_scope where scope = 'company'"))) due.unshift({ scope: 'company' }); // on by default
  out.runs = {};
  for (const r of due.slice(0, 4)) out.runs[r.scope] = await run(r.scope).then((x) => ({ flagged: x.flagged, drafts: x.drafts, skipped: x.skipped })).catch((e) => ({ error: e.message }));
  return out;
}

// ---------- what the command centre shows ----------
async function counters(scope) {
  const pid = pidOf(scope), proj = pid ? 'project_id = ' + pid : 'true';
  const one = async (sql, a = []) => ((await db.one(sql, a)) || {}).n || 0;
  return {
    topics: await one("select count(*)::int as n from ag_interrupts where scope = $1 and at > now() - interval '30 days'", [scope]),
    drafts: await one("select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and agent is not null and created_at > now() - interval '30 days'", [pid]),
    assets: await one("select count(*)::int as n from mkt_post_files f join mkt_posts p on p.id = f.post_id where p.project_id is not distinct from $1 and f.created_at > now() - interval '30 days'", [pid]).catch(() => 0),
    scheduled: await one("select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and status in ('scheduled', 'published') and coalesce(publish_at, updated_at) > now() - interval '30 days'", [pid]),
    leads: await one(`select count(*)::int as n from mkt_leads where ${proj} and created_at > now() - interval '30 days'`),
    visits: await one(`select count(*)::int as n from mkt_leads where ${proj} and visit_at > now() - interval '30 days'`),
    booked: await one(`select count(*)::int as n from mkt_leads where ${proj} and booked_at > now() - interval '30 days'`),
    waiting: await one("select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and status = 'review'", [pid]) + await one("select count(*)::int as n from ag_interrupts where scope = $1 and status = 'owner'", [scope]),
  };
}

async function state(scope) {
  if (!okScope(scope)) throw Object.assign(new Error('Unknown scope.'), { status: 400 });
  const pid = pidOf(scope);
  const c = await connections();
  const set = await settingsOf(scope);
  const project = pid ? await db.one('select id, name, location, rera_no from projects where id = $1', [pid]) : null;
  if (pid && !project) throw Object.assign(new Error('No such project.'), { status: 404 });
  const events = await db.q('select id, at, agent, to_agent, kind, text, ref from ag_events where scope = $1 order by id desc limit 80', [scope]);
  const lastBy = {}; for (const e of events) if (e.kind !== 'log' && !lastBy[e.agent]) lastBy[e.agent] = e;
  const depts = DEPTS.map((d) => { const tools = toolsWith(d.tools, c); const on = tools.filter((t) => t.on).length; return { id: d.id, name: d.name, tools, on, of: tools.length, line: lastBy[d.id] ? lastBy[d.id].text : d.idle, at: lastBy[d.id] ? lastBy[d.id].at : null }; });
  const recent = await db.q("select kind, status, at, detail from ag_interrupts where scope = $1 and at > now() - interval '7 days' order by at desc", [scope]);
  const triggers = TRIGGERS.map((t) => { const hits = recent.filter((r) => r.kind === t.kind); return { ...t, live: !t.dep || !!c[t.dep], needs: t.dep && !c[t.dep] ? DEPS[t.dep] : null, count: hits.length, lastAt: hits[0] ? hits[0].at : null, owner: hits.some((h) => h.status === 'owner') }; });
  const funnels = await db.q(`select f.id, f.network, f.keyword, f.media_ext, f.dm_text, f.public_reply, f.thanks_text, f.active, f.live, array_to_json(f.test_handles) as test_handles, f.created_at,
      count(h.id)::int as hits, count(h.dm_at)::int as dms, count(h.lead_id)::int as leads from ag_funnels f left join ag_funnel_hits h on h.funnel_id = f.id
      where f.scope = $1 group by f.id order by f.id`, [scope]);
  const queue = await db.q(`select p.id, p.title, p.kind, array_to_json(p.channels) as channels, p.publish_at, p.caption, p.note, p.agent, p.status, p.created_at,
      (select coalesce(json_agg(json_build_object('id', f.id, 'mime', f.mime, 'name', f.name) order by f.id), '[]'::json) from mkt_post_files f where f.post_id = p.id) as files
    from mkt_posts p where p.project_id is not distinct from $1 and p.status = 'review' order by p.publish_at nulls last, p.id limit 30`, [pid]);
  const owner = await db.q("select id, kind, at, detail from ag_interrupts where scope = $1 and status = 'owner' order by at desc limit 20", [scope]);
  const ownerMsgs = await db.q("select id, at, agent, text, ref from ag_events where scope = $1 and kind = 'owner' and at > now() - interval '7 days' order by id desc limit 20", [scope]);
  const signals = toolsWith(SIGNALS, c), record = toolsWith(RECORD, c), brainT = toolsWith(BRAIN, c);
  const all = [...signals, ...record, ...brainT, ...depts.flatMap((d) => d.tools)];
  const orchOn = c.brain;
  return {
    scope, project, preRera: !!(project && !project.rera_no), settings: set, killed: await killed(), connections: c, deps: DEPS,
    signals, record, brain: brainT, orchestrator: ORCH.map(([id, name, sub]) => ({ id, name, sub, on: id === 'drafts' ? orchOn : true })),
    departments: depts, triggers, knowledge: await knowledge(scope), funnels, queue, owner, ownerMsgs,
    events: events.reverse(), counters: { ...(await counters(scope)), sources: signals.filter((x) => x.on).length, sourcesOf: signals.length },
    agents: { on: all.filter((x) => x.on).length + ORCH.length, of: all.length + ORCH.length }, names: AGENT_NAMES,
    funnelStatus: (await db.one("select done_at, info from job_marks where key = 'agents-funnels'").catch(() => null)) || null,
  };
}

module.exports = { design, run, tick, state, draftPosts, pollFunnels, noteComments, settingsOf, knowledge, say, okScope, pidOf, KB, KB_DEFAULT, TRIGGERS, DEPTS, kwMatch, phoneIn, brainOn };
