// Leads and visitors from each social post (from Zuri, 27 Nov 2026). Free and first-party: nothing personal is kept.
//
// Every post gets a tracked link per network, erp.dreamindiarealty.com/go/<network>/<post id> (api/go.js). A tap is
// counted (mkt_post_clicks, per day, network and post; link previews are bots and are not counted) and the visitor goes
// on to dreamindiarealty.com tagged utm_source=<network>, utm_medium=social, utm_campaign=post-<id>. The website
// tracker then counts the visit (mkt_web_hits.campaign) and a website enquiry keeps the same tags (mkt_leads.utm), so
// Marketing → Website → Social posts shows, per post: taps, visits, call / WhatsApp clicks and enquiries.
// On Facebook the link goes in the caption in place of "dreamindiarealty.com"; Instagram does not make links in
// captions clickable, so there the bio link (/go/ig) is used.
const SHORT = { li: 'linkedin', x: 'x', fb: 'facebook', ig: 'instagram', yt: 'youtube', wa: 'whatsapp' };
const SHORT_OF = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const NAME = { linkedin: 'LinkedIn', x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', whatsapp: 'WhatsApp' };
const erp = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');
const SITE = () => String(process.env.WEBSITE_DOMAIN || 'dreamindiarealty.com').trim().toLowerCase();

// link previews and crawlers: never counted
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|meta-externalagent|linkedinbot|twitterbot|whatsapp|telegram|slack|discord|skype|embedly|pinterest|vkshare|headless|lighthouse|pingdom|uptime|curl|wget|python|go-http|java\/|okhttp|node-fetch|axios/i;
const isBot = (ua) => !ua || BOT.test(String(ua));

// the tracked link for a post on one network (or, with no post, for the profile / bio)
function link(network, postId) {
  const short = SHORT_OF[network];
  return short ? `${erp()}/go/${short}${postId ? '/' + Math.trunc(+postId) : ''}` : '';
}
// where a tracked link sends the visitor
function target(short, postId) {
  const net = SHORT[String(short || '').toLowerCase().slice(0, 4)];
  if (!net) return null;
  const q = new URLSearchParams({ utm_source: net, utm_medium: 'social', utm_campaign: postId ? 'post-' + postId : 'profile' });
  return { network: net, postId: postId || null, url: `https://${SITE()}/?${q}` };
}
// "Visit dreamindiarealty.com" → "Visit https://erp.dreamindiarealty.com/go/fb/12" in a Facebook caption. Only a caption
// that already names the website changes; Instagram is left alone.
function tagCaption(caption, network, postId) {
  const text = String(caption || ''), l = link(network, postId);
  if (!l || network === 'instagram') return text;
  const re = new RegExp(`(?<![\\w.@/-])(?:https?://)?(?:www\\.)?${SITE().replace(/\./g, '\\.')}/?(?![\\w/.-]*\\w)`, 'i');
  return re.test(text) ? text.replace(re, l) : text;
}
const postOf = (c) => { const m = /^post-(\d{1,9})$/.exec(String(c || '').trim().toLowerCase()); return m ? +m[1] : null; };
const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

async function count(network, postId) {
  const db = require('./db');
  if (!db.configured() || !NAME[network]) return;
  await db.q(`insert into mkt_post_clicks (day, network, post_id, clicks) values ($1, $2, $3, 1)
    on conflict (day, network, post_id) do update set clicks = mkt_post_clicks.clicks + 1`, [istDay(), network, Math.max(0, Math.trunc(+postId || 0))]);
}

// the report: per post and network, the last `days` days
async function report(days = 90, projectId = null) {
  const db = require('./db');
  const since = istDay(Date.now() - days * 864e5);
  const clicks = await db.q('select network, post_id, sum(clicks)::int as clicks from mkt_post_clicks where day >= $1 group by 1, 2', [since]);
  const hits = await db.q(`select lower(source) as network, lower(campaign) as campaign, count(distinct session) filter (where kind = 'view')::int as visits,
      count(*) filter (where kind in ('call', 'whatsapp'))::int as taps, count(*) filter (where kind = 'enquiry')::int as enquiries
    from mkt_web_hits where at >= $1::date and lower(coalesce(medium, '')) = 'social' and campaign ~* '^(post-[0-9]+|profile)$' group by 1, 2`, [since]);
  const leads = await db.q(`select lower(utm->>'utm_source') as network, lower(utm->>'utm_campaign') as campaign, count(*)::int as leads,
      count(*) filter (where status in ('visit', 'booked'))::int as visits_site, count(*) filter (where status = 'booked')::int as booked
    from mkt_leads where created_at >= $1::date and lower(coalesce(utm->>'utm_medium', '')) = 'social' group by 1, 2`, [since]);
  const by = new Map();
  const row = (network, postId) => { const k = network + '|' + (postId || 0); if (!by.has(k)) by.set(k, { network, postId: postId || 0, clicks: 0, visits: 0, taps: 0, enquiries: 0, leads: 0, siteVisits: 0, booked: 0 }); return by.get(k); };
  for (const r of clicks) row(r.network, r.post_id).clicks += r.clicks;
  for (const r of hits) { if (!NAME[r.network]) continue; const x = row(r.network, postOf(r.campaign)); x.visits += r.visits; x.taps += r.taps; x.enquiries += r.enquiries; }
  for (const r of leads) { if (!NAME[r.network]) continue; const x = row(r.network, postOf(r.campaign)); x.leads += r.leads; x.siteVisits += r.visits_site; x.booked += r.booked; }
  const ids = [...new Set([...by.values()].map((x) => x.postId).filter(Boolean))];
  const posts = ids.length ? await db.q('select id, title, project_id, to_char(coalesce(published_at, publish_at) + interval \'330 minutes\', \'YYYY-MM-DD\') as day from mkt_posts where id = any($1)', [ids]) : [];
  const P = Object.fromEntries(posts.map((p) => [p.id, p]));
  return [...by.values()]
    .filter((x) => !projectId || !x.postId || (P[x.postId] && P[x.postId].project_id === +projectId))
    .map((x) => ({ ...x, networkName: NAME[x.network], post: x.postId ? (P[x.postId] ? P[x.postId].title : `Post ${x.postId} (removed)`) : 'Profile / bio link', day: x.postId && P[x.postId] ? P[x.postId].day : null }))
    .sort((a, b) => b.leads - a.leads || b.clicks + b.visits - (a.clicks + a.visits));
}

module.exports = { SHORT, NAME, isBot, link, target, tagCaption, postOf, count, report, istDay };
