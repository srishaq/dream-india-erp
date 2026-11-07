// The content calendar, planned ahead and kept full:
// - planWindow: one stream (the brand, or one project) gets its posts for a date window, festivals included.
// - planAhead (cron): any stream with less than 3 weeks planned gets its next week.
// - designPending (cron): drafts without a design are designed in Canva, a few per run.
// Festivals live in the knowledge file /content/festivals.md ("YYYY-MM-DD Name: note" per line), so the team can add more.
const db = require('./db');

const FESTIVALS_DEFAULT = `# Festivals and special days (one per line: YYYY-MM-DD Name: note)
The brand page posts a greeting on the day; project pages may tie in (e.g. Padwa is an auspicious day to book a home).
Add next year's dates here as they are announced.
2026-11-08 Diwali (Lakshmi Puja): festival of lights, new beginnings, the first diya in a new home
2026-11-09 Diwali Padwa / Gujarati New Year (Bestu Varas): auspicious day to buy a home in Maharashtra and Gujarat
2026-11-10 Bhai Dooj: siblings, family
2026-11-15 Chhath Puja: north Indian families in Mumbai, prayers to the sun
2026-11-24 Guru Nanak Jayanti (Gurpurab): service, community, light
2026-11-26 Constitution Day: respectful only (also the 26/11 anniversary in Mumbai: no promotion that day)
2026-12-25 Christmas: joy, family, Mumbai's Christmas lights
2026-12-31 New Year's Eve: a year of building homes, thank you
2027-01-01 New Year 2027: new home, new year
2027-01-14 Lohri / eve of Makar Sankranti: harvest, bonfire, new beginnings
2027-01-15 Makar Sankranti: kites, til-gul ("tilgul ghya, god god bola" in Maharashtra)
2027-01-26 Republic Day: pride in building India's homes`;

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const todayIST = () => ymd(Date.now() + 5.5 * 3600e3);

async function festivals(from, to) {
  const r = await db.one("select body from ag_knowledge where scope = 'company' and path = '/content/festivals.md'");
  const body = r ? r.body : FESTIVALS_DEFAULT;
  return body.split('\n').map((l) => l.match(/^\s*(\d{4}-\d{2}-\d{2})\s+([^:]+?)(?::\s*(.*))?$/)).filter(Boolean)
    .map(([, date, name, note]) => ({ date, name: name.trim(), note: (note || '').trim() })).filter((f) => f.date >= from && f.date <= to);
}

// The streams: the brand (company) and every project whose agents are switched on.
async function streams() {
  const A = require('./agents');
  const rows = await db.q("select scope from ag_scope where enabled and not paused and scope not in ('all', 'company')");
  const out = [{ scope: 'company', set: await A.settingsOf('company') }];
  for (const r of rows) {
    const p = await db.one('select id, name, rera_no, active from projects where id = $1', [+r.scope]);
    if (p && p.active) out.push({ scope: r.scope, project: p, set: await A.settingsOf(r.scope) });
  }
  return out;
}

// One stream's posts for [from, to] (at most ~2 weeks per call, so one Brain call fits the time limit).
async function planWindow(scope, from, to, user = null, { design = false } = {}) {
  const A = require('./agents');
  const set = await A.settingsOf(scope), pid = A.pidOf(scope);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const fest = await festivals(from, to);
  const perWeek = Math.max(1, Math.min(7, Math.round(+set.owner.postsPerWeek || 3)));
  const already = await db.q("select to_char(publish_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d from mkt_posts where project_id is not distinct from $1 and status not in ('draft', 'rejected', 'failed') and publish_at::date between $2 and $3", [pid, from, to]);
  const taken = new Set(already.map((x) => x.d));
  const missingFest = scope === 'company' ? fest.filter((f) => !taken.has(f.date)) : [];
  const n = Math.max(0, Math.min(4, Math.round(perWeek * days / 7) - already.length + missingFest.length));
  if (!n) return { scope, from, to, drafted: 0, note: 'already planned' };
  const angle = scope === 'company'
    ? `The brand calendar for ${from} to ${to}. ${missingFest.length ? `Make a greeting post ON each of these days, warm and respectful, with no selling: ${missingFest.map((f) => f.date + ' ' + f.name).join('; ')}. ` : ''}Include one founder reel this week (Rafi Sir on camera: the business, entrepreneurship, our projects, the product or the vision) unless one is already planned. The other posts build trust in Dream India: our track record since 2009, redevelopment and SRA families, construction quality, Mumbai life, useful home-buying tips. Follow what worked for us. Dates already taken: ${[...taken].join(', ') || 'none'}.`
    : `The project calendar for ${from} to ${to}: include one update reel this week (site progress, a milestone, the sample flat or an amenity walkthrough, shot on site) unless one is already planned; the other posts cover progress on site, the homes and amenities, the location and connectivity, buyer questions answered, and reasons to visit. A festival may be tied in lightly (the brand page posts the greetings). Follow what worked for us. Dates already taken: ${[...taken].join(', ') || 'none'}.`;
  const ids = await A.draftPosts(scope, n, angle, user, { window: { from, to }, festivals: fest, design });
  await A.say(scope, 'content-engine', 'orchestrator', `Planned ${ids.length} post${ids.length === 1 ? '' : 's'} for ${from} to ${to}${missingFest.length ? ', festival greetings included' : ''}. They wait for approval; the Creative Studio designs them.`, 'draft', { posts: ids.map((x) => x.id) });
  return { scope, from, to, drafted: ids.length, posts: ids };
}

// Cron: the stream with the shortest plan gets its next 2 weeks, once it has less than 3 weeks ahead.
async function planAhead() {
  const A = require('./agents');
  if (!A.brainOn()) return { skipped: 'brain offline' };
  const today = todayIST(), list = [];
  for (const s of await streams()) {
    const r = await db.one("select max(publish_at) as h from mkt_posts where project_id is not distinct from $1 and publish_at > now() and status in ('review', 'approved', 'scheduled')", [A.pidOf(s.scope)]);
    const h = r && r.h ? ymd(new Date(r.h).getTime() + 5.5 * 3600e3) : today;
    if (h < addDays(today, 21)) list.push({ scope: s.scope, from: addDays(h > today ? h : today, 1) });
  }
  if (!list.length) return { planned: 0 };
  list.sort((a, b) => a.from.localeCompare(b.from));
  const x = list[0];
  return planWindow(x.scope, x.from, addDays(x.from, 6));
}

// Cron: design drafts that have no design yet (a carousel is several Canva designs, so only a few per run).
async function designPending(max = 2) {
  const A = require('./agents');
  // no design yet, or only a Creative Studio design made before the company's templates last changed (a person's upload or a hand-picked Canva design stays)
  const since = (await A.settingsOf('company')).owner.templatesAt || null;
  const rows = await db.q(`select p.id from mkt_posts p where p.agent is not null and p.status in ('review', 'approved') and (p.publish_at is null or p.publish_at > now())
      and not exists (select 1 from mkt_post_files f where f.post_id = p.id and (f.name not like 'design-%' or $2::timestamptz is null or f.created_at >= $2::timestamptz or f.created_by is not null))
      order by p.publish_at nulls last limit $1`, [max, since]);
  const out = [];
  for (const r of rows) out.push(await A.design(r.id).then((d) => ({ id: r.id, added: d.added, skipped: d.skipped })).catch((e) => ({ id: r.id, error: e.message })));
  return out;
}

// Rafi Sir's reel plan for one stream and window: founder reels on the brand page, update reels on project pages,
// about one a week, each with a shoot brief and a task for Rupali. Unapproved AI reels in the window that have no
// shoot brief (the earlier, generic ones) go back to drafts so the two kinds take their place.
async function planReels(scope, from, to, user = null) {
  const A = require('./agents');
  const pid = A.pidOf(scope), type = scope === 'company' ? 'founder' : 'update';
  const replaced = await db.q(`update mkt_posts set status = 'draft', review_note = 'Replaced by the reel plan (founder and update reels with a shoot brief).', updated_at = now()
      where project_id is not distinct from $1 and agent is not null and kind = 'reel' and status = 'review' and coalesce(design_text->>'shoot', '') = ''
        and (publish_at at time zone 'Asia/Kolkata')::date between $2 and $3 returning id`, [pid, from, to]);
  const have = await db.one(`select count(*)::int as n from mkt_posts where project_id is not distinct from $1 and kind = 'reel' and status in ('review', 'approved', 'scheduled')
      and design_text->'shoot'->>'type' = $4 and (publish_at at time zone 'Asia/Kolkata')::date between $2 and $3`, [pid, from, to, type]);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const n = Math.max(0, Math.min(3, Math.round(days / 7) - have.n));
  if (!n) return { scope, from, to, drafted: 0, replaced: replaced.length };
  const angle = type === 'founder'
    ? `Founder reels for ${from} to ${to}, about one a week: Rafi Sir speaking to camera. Topics to choose from: why we build in Mumbai, lessons from 15+ years of building, redevelopment and SRA (families first), how we choose a site, what makes a home well designed, the 2 million sq ft journey, the vision for Dream India, advice to young entrepreneurs, what our partners mean to us. Do not repeat a topic already planned.`
    : `Update reels for ${from} to ${to}, about one a week: what changed on site, a milestone, the sample flat, an amenity walkthrough. Real, unpolished, shot on the phone is fine.`;
  const ids = await A.draftPosts(scope, n, angle, user, { window: { from, to }, only: 'reel', reelType: type, design: false });
  await A.say(scope, 'content-engine', 'orchestrator', `Planned ${ids.length} ${type} reel${ids.length === 1 ? '' : 's'} for ${from} to ${to}, each with a shoot brief; Rupali has a task to book each shoot.`, 'draft', { posts: ids.map((x) => x.id) });
  return { scope, from, to, drafted: ids.length, replaced: replaced.length, posts: ids };
}

module.exports = { planReels, planWindow, planAhead, designPending, festivals, streams, FESTIVALS_DEFAULT, addDays, todayIST };
