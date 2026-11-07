// The website chat assistant (7 Nov 2026): a chat window on dreamindiarealty.com (public/bot.js) that answers visitors
// from the AI team's knowledge files (facts, FAQ, compliance, voice), asks the few questions that matter (homes, budget,
// when, for living or investment), takes the name and mobile once the visitor agrees to be contacted, and books a site
// visit day and time. The number becomes a lead in Sales & Marketing (source: website, "Website chat"), with the answers
// and the visit in the note; the 2-hour call alarm then applies as for every lead.
//
// Rules the assistant keeps: answers only from the knowledge files; no price, offer or possession promise that is not in
// them; quotes the MahaRERA number when the project has one; never says a project is "launching" without a MahaRERA
// number; replies in the visitor's language (English, Hindi, Hinglish, Marathi); a person can always take over.
const db = require('./db');
const crypto = require('crypto');

const configured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_BOT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_TURNS = 40, MAX_LEN = 600;
const CONSENT = 'By sharing your number you agree that Dream India Realty may call, SMS or WhatsApp you about this project.';
const fake = () => process.env.BOT_FAKE === '1' && process.env.VERCEL !== '1'; // tests: a scripted reply, no AI call

// on/off from Sales & Marketing → Website chats (settings 'bot'); the website loads the chat only when it is on
async function cfg() { const r = await db.one("select value from settings where key = 'bot'"); return { on: !!(r && r.value && r.value.on) }; }
async function setOn(on) { await db.q("insert into settings (key, value) values ('bot', $1) on conflict (key) do update set value = settings.value || excluded.value", [{ on: !!on }]); return cfg(); }
// a project page of the website (/dream-signature.php, /dz-city.php) → that project, by its name
async function fromPage(page) {
  const slug = String(page || '').toLowerCase().replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\.(php|html?)$/, '').split('/').filter(Boolean).pop() || '';
  const key = slug.replace(/[^a-z0-9]+/g, '');
  if (key.length < 4) return null;
  const p = await db.one("select id from projects where active and (regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') = $1 or regexp_replace(lower(coalesce(code, '')), '[^a-z0-9]+', '', 'g') = $1) limit 1", [key]);
  return p ? String(p.id) : null;
}
async function scopeFor(projectKey) {
  const k = String(projectKey || '').trim();
  if (!k) return { scope: 'company', project: null };
  const p = /^\d+$/.test(k) ? await db.one('select id, name, location, rera_no from projects where id = $1 and active', [+k])
    : await db.one('select id, name, location, rera_no from projects where active and (lower(code) = lower($1) or lower(name) = lower($1))', [k]);
  return p ? { scope: String(p.id), project: p } : { scope: 'company', project: null };
}

// ---------- what the website itself says (addresses, founders, project pages) ----------
// The ERP reads dreamindiarealty.com once a day and gives the assistant its text, so it can answer what the website
// already tells visitors. The AI team's Facts and FAQ come first when the two differ.
const SITE = () => (process.env.BOT_SITE || 'https://dreamindiarealty.com').replace(/\/+$/, '');
const SITE_PAGES = ['/', '/about.php', '/our-founders.php', '/projects.php', '/dream-signature.php', '/dream-aspire.php', '/dz-city.php', '/contact.php', '/news-events.php', '/career.php'];
function pageText(html) {
  let t = String(html || '')
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-').replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  // the menu at the top and the old chat / enquiry box at the bottom of every page
  t = t.replace(/^(Home|About Us|Our Founders|News & Events?|Projects|Dream Signature|Dream Aspire|DZ City|Careers|Contact)(\s|$)/gm, '');
  const cut = t.search(/×\s*Live Chat|Hello 👋 How can I help you/); if (cut > 0) t = t.slice(0, cut);
  return t.replace(/\n{2,}/g, '\n').trim().slice(0, 6000);
}
let siteMem = null;
// A visitor's chat uses the saved copy; the 9 am marketing run reads the website again (refresh), so a slow website
// never holds up a visitor.
async function siteKnowledge({ refresh = false } = {}) {
  if (!refresh && siteMem && Date.now() - siteMem.got < 3600e3) return siteMem.pages;
  const row = await db.one("select value from settings where key = 'bot_site'");
  const old = row && row.value && row.value.pages ? row.value : null;
  if (!refresh && old) { siteMem = { got: Date.now(), pages: old.pages }; return old.pages; }
  if (process.env.BOT_FAKE === '1' && !process.env.BOT_SITE) return (old && old.pages) || {};
  const pages = {};
  await Promise.all(SITE_PAGES.map(async (p) => {
    try { const r = await fetch(SITE() + p, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'DreamIndiaERP-ChatAssistant' } }); if (r.ok) { const t = pageText(await r.text()); if (t.length > 40) pages[p] = t; } } catch { /* keep the old copy */ }
  }));
  const use = Object.keys(pages).length ? pages : (old && old.pages) || {};
  await db.q("insert into settings (key, value) values ('bot_site', $1) on conflict (key) do update set value = excluded.value", [{ at: new Date().toISOString(), pages: use }]);
  siteMem = { got: Date.now(), pages: use };
  return use;
}

async function system(sc) {
  const A = require('./agents');
  const kb = await A.knowledge(sc.scope);
  const pick = (path) => (kb.find((k) => k.path === path) || {}).body || '';
  const p = sc.project;
  const projects = await db.q('select name, location, rera_no from projects where active order by id');
  const site = await siteKnowledge().catch(() => ({}));
  return `You are Dream India Realty's sales advisor, chatting with a visitor on our website. Dream India Realty is a Mumbai real estate developer (SRA and residential projects).
Speak AS the company, directly and in the first person: "we", "our homes", "I can book that for you". Never talk about the company from outside: never say "the company says", "our website says", "according to the website", "the information I have", "my knowledge" or "I don't have that with me". Never call yourself an assistant, a bot or an AI. Only if the visitor asks whether they are talking to a person or a machine, say honestly that this is Dream India Realty's automated sales chat and that one of our sales advisors can call them.
${p ? `The visitor is on the page of the project "${p.name}"${p.location ? ` in ${p.location}` : ''}. ${p.rera_no ? `Its MahaRERA registration number is ${p.rera_no}.` : 'It does not have a MahaRERA registration number yet: talk only about the area and the company, take their interest for updates, never give prices, never call it launched or open for booking.'}` : `Our projects: ${projects.map((x) => `${x.name}${x.location ? ' (' + x.location + ')' : ''}${x.rera_no ? ', MahaRERA ' + x.rera_no : ''}`).join('; ')}.`}

What you know (answer ONLY from this. If something is not here, never guess: say it naturally, e.g. "Let me have our sales team confirm that for you on a quick call" or "I'll get you the exact figure on the call", and offer the call back):
=== Facts ===
${pick('/brand-brain/facts.md')}
=== FAQ ===
${pick('/conversation/faq-library.md')}
=== Compliance rules ===
${pick('/compliance/rules.md')}
=== Voice ===
${pick('/brand-brain/voice-guide.md')}
=== The company website (dreamindiarealty.com), page by page ===
${Object.entries(site).map(([p, t]) => `--- ${p} ---\n${t}`).join('\n')}
(Facts, FAQ and the MahaRERA numbers above come first if the website says something different.)

How to chat:
- Never say "Namaste" or "Namaskar". If you greet, say Good morning, Good afternoon or Good evening by the time in India (it is ${(() => { const h = new Date(Date.now() + 330 * 60000).getUTCHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; })()} now).
- Be warm, short and clear: 1 to 3 short sentences a reply. Reply in the visitor's language (English, Hindi, Hinglish or Marathi).
- Never invent prices, offers, discounts, possession dates, amenities or legal claims. Never promise returns on investment.
- Find out, one question at a time and naturally (not as a form): which home (1/2/3 BHK, shop, office), budget, when they plan to buy, and whether it is to live in or invest.
- When they show interest, offer a site visit or a call back from a sales advisor. Before asking for the number, say: "${CONSENT}" Then ask for their name and 10-digit mobile number.
- For a site visit, agree a day and a time within the visiting hours in the Facts (if the Facts do not say, the website's business hours) and confirm it back.
- Greet only in your very first reply; after that, answer straight away.
- If they ask for a person, say one of our sales advisors will call them shortly and take the number.
- If they say they do not want to be contacted, respect it and stop asking.

Answer with ONE JSON object only, no other text:
{"reply": "your message to the visitor",
 "capture": {"name": "", "mobile": "10 digits or empty", "email": "", "home": "", "budget": "", "timeline": "", "purpose": "", "visit_date": "YYYY-MM-DD or empty", "visit_time": "e.g. 11:00 or empty", "call_back": true or false, "consent": true only if they agreed to be contacted after you said the consent line, "no_contact": true if they asked not to be contacted},
 "chips": ["up to 3 short suggested replies for the visitor"]}
Only fill fields the visitor actually told you. Today is ${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)} (Asia/Kolkata).`;
}

async function claude(sys, msgs) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 1200, system: sys, messages: msgs }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, (j.error && j.error.message) || 'The assistant is busy.');
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function parse(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  try { const o = JSON.parse(s.slice(a, b + 1)); return { reply: clip(o.reply, 1200) || 'Sorry, could you say that again?', capture: o.capture && typeof o.capture === 'object' ? o.capture : {}, chips: (Array.isArray(o.chips) ? o.chips : []).map((c) => clip(c, 40)).filter(Boolean).slice(0, 3) }; }
  catch {
    // a reply cut off half way: take the message part, never show the code to the visitor
    const m = s.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) { let r; try { r = JSON.parse('"' + m[1] + '"'); } catch { r = m[1]; } return { reply: clip(r, 1200), capture: {}, chips: [] }; }
    if (a >= 0) return { reply: 'Sorry, could you say that again?', capture: {}, chips: [] };
    return { reply: clip(s, 1200) || 'Sorry, could you say that again?', capture: {}, chips: [] };
  }
}

const phone10 = (v) => { const d = String(v || '').replace(/\D/g, ''); const m = d.length > 10 ? d.slice(-10) : d; return /^[6-9]\d{9}$/.test(m) ? m : ''; };
const ipHash = (req) => crypto.createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() + (process.env.SESSION_SECRET || 'bot')).digest('hex').slice(0, 24);

// One message from a visitor → the assistant's reply. Creates the lead the moment a number is given with consent.
async function chat(req, b) {
  const text = clip(b.message, MAX_LEN);
  if (!text) throw err(400, 'Type a message.');
  const ih = ipHash(req);
  const recent = (await db.one("select count(*)::int as n from bot_sessions where ip_hash = $1 and updated_at > now() - interval '1 hour'", [ih])).n;
  let sid = /^[a-zA-Z0-9_-]{16,64}$/.test(String(b.sid || '')) ? b.sid : null;
  let s = sid ? await db.one('select * from bot_sessions where id = $1', [sid]) : null;
  if (!s) {
    if (recent >= 20) throw err(429, 'Too many chats from here. Please call us instead.');
    sid = crypto.randomBytes(18).toString('base64url');
    const sc = await scopeFor(b.project || (await fromPage(b.page)));
    s = await db.one('insert into bot_sessions (id, project_id, ip_hash, page, messages, captured) values ($1, $2, $3, $4, $5, $6) returning *',
      [sid, sc.project ? sc.project.id : null, ih, clip(b.page, 300) || null, JSON.stringify([]), JSON.stringify({})]);
  }
  const msgs = Array.isArray(s.messages) ? s.messages : [];
  if (msgs.filter((m) => m.role === 'user').length >= MAX_TURNS) return { sid, reply: 'Thank you for chatting. A sales advisor will take it from here: please call us or leave your number.', chips: [] };
  msgs.push({ role: 'user', content: text, at: new Date().toISOString() });
  const sc = s.project_id ? await scopeFor(String(s.project_id)) : { scope: 'company', project: null };
  let out;
  if (fake()) out = parse(process.env.BOT_FAKE_REPLY || '{"reply":"Thank you! Shall I book a site visit?","capture":{},"chips":["Book a site visit"]}');
  else if (!configured()) out = { reply: 'Thank you for your message. Our assistant is offline right now: please leave your name and mobile number and a sales advisor will call you.', capture: {}, chips: [] };
  else out = parse(await claude(await system(sc), msgs.map((m) => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ reply: m.content }) : m.content }))));
  // a number typed straight into the chat counts too
  const cap = { ...(s.captured || {}) };
  for (const [k, v] of Object.entries(out.capture || {})) if (v !== '' && v != null && v !== false) cap[k] = typeof v === 'string' ? clip(v, 120) : v;
  if (!cap.mobile) { const m = phone10((text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/) || [])[0]); if (m) cap.mobile = m; }
  cap.mobile = phone10(cap.mobile);
  msgs.push({ role: 'assistant', content: out.reply, at: new Date().toISOString() });
  let leadId = s.lead_id;
  if (cap.mobile && !cap.no_contact && (cap.consent || msgs.some((m) => m.role === 'assistant' && m.content.includes('agree that Dream India Realty may')))) {
    const note = [
      'Website chat' + (s.page ? ` (${s.page})` : ''),
      cap.home && `Looking for: ${cap.home}`, cap.budget && `Budget: ${cap.budget}`, cap.timeline && `When: ${cap.timeline}`, cap.purpose && `For: ${cap.purpose}`,
      cap.visit_date && `SITE VISIT BOOKED: ${cap.visit_date}${cap.visit_time ? ' at ' + cap.visit_time : ''}`, cap.call_back && 'Asked for a call back',
      `Agreed to be contacted in the chat: "${CONSENT}"`,
    ].filter(Boolean).join('\n');
    const L = require('./mkt-leads');
    if (!leadId) {
      const r = await L.add({ name: cap.name || null, phone: cap.mobile, email: cap.email || null, source: 'website', projectId: s.project_id, note, ext: 'webchat:' + sid, welcome: true });
      leadId = r.id;
    } else await db.q("update mkt_leads set name = coalesce(name, $2), note = $3, updated_at = now() where id = $1", [leadId, cap.name || null, note]);
    if (cap.visit_date && /^\d{4}-\d{2}-\d{2}$/.test(cap.visit_date)) await db.q('update mkt_leads set next_date = $2 where id = $1', [leadId, cap.visit_date]);
  }
  await db.q('update bot_sessions set messages = $2, captured = $3, lead_id = $4, updated_at = now() where id = $1', [sid, JSON.stringify(msgs), JSON.stringify(cap), leadId || null]);
  return { sid, reply: out.reply, chips: out.chips, lead: !!leadId };
}

async function list({ projectId, limit = 200 } = {}) {
  const rows = await db.q(`select s.id, s.project_id, p.name as project, s.page, s.captured, s.lead_id, s.created_at, s.updated_at, jsonb_array_length(s.messages) as n,
      (select m->>'content' from jsonb_array_elements(s.messages) m where m->>'role' = 'user' limit 1) as first
    from bot_sessions s left join projects p on p.id = s.project_id where ($1::int is null or s.project_id = $1) order by s.updated_at desc limit $2`, [projectId || null, limit]);
  return rows;
}
async function one(id) {
  const s = await db.one('select s.*, p.name as project from bot_sessions s left join projects p on p.id = s.project_id where s.id = $1', [id]);
  if (!s) throw err(404, 'Chat not found.');
  return { ...s, ip_hash: undefined };
}

module.exports = { siteKnowledge, pageText, chat, list, one, parse, configured, cfg, setOn, fromPage, CONSENT };
