// The AI Agent Team's memory of what Dream India has posted:
// 1. importHistory: every Instagram and Facebook post of the last two years, with its figures, into mkt_media.
// 2. analyseHistory: the Brain reads them all and writes /brand-brain/what-worked.md (topics, hooks, formats,
//    timing, per project), which the Content Engine reads before every draft. The cron refreshes it monthly.
const db = require('./db');

const n0 = (v) => (Number.isFinite(+v) ? +v : 0);
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// One score to rank posts: a comment, share or save says more than a like; views count a little.
const SCORE = 'coalesce(likes, 0) + 3 * coalesce(comments, 0) + 4 * coalesce(shares, 0) + 4 * coalesce(saves, 0) + coalesce(views, 0) / 200';

async function upsert(network, account, x) {
  await db.q(`insert into mkt_media (network, ext_id, account, posted_at, kind, caption, permalink, thumb, likes, comments, shares, saves, views, reach)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (network, ext_id) do update set posted_at = excluded.posted_at, kind = excluded.kind, caption = excluded.caption, permalink = excluded.permalink,
        thumb = coalesce(excluded.thumb, mkt_media.thumb), likes = coalesce(excluded.likes, mkt_media.likes), comments = coalesce(excluded.comments, mkt_media.comments),
        shares = coalesce(excluded.shares, mkt_media.shares), saves = coalesce(excluded.saves, mkt_media.saves), views = coalesce(excluded.views, mkt_media.views),
        reach = coalesce(excluded.reach, mkt_media.reach), updated_at = now()`,
  [network, String(x.id), account, x.at || null, x.kind || null, x.caption ? String(x.caption).slice(0, 2000) : null, x.link || null, x.thumb || null,
    x.likes ?? null, x.comments ?? null, x.shares ?? null, x.saves ?? null, x.views ?? null, x.reach ?? null]);
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// Every post since `months` ago on the connected Facebook pages and Instagram accounts.
async function importHistory({ months = 24, insights = true } = {}) {
  const S = require('./social');
  const since = new Date(); since.setMonth(since.getMonth() - months);
  const from = since.toISOString().slice(0, 10);
  const out = { from, facebook: [], instagram: [], errors: [] };
  for (const p of await S.metaPages()) {
    // Facebook page posts
    try {
      const posts = await S.graphAll(`/${p.id}/posts`, { fields: 'id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)', since: Math.floor(since.getTime() / 1000), limit: 100 }, p.token, 3000);
      for (const x of posts) await upsert('facebook', p.name, { id: x.id, at: x.created_time, kind: 'post', caption: x.message, link: x.permalink_url, thumb: x.full_picture,
        likes: x.reactions && x.reactions.summary ? x.reactions.summary.total_count : null, comments: x.comments && x.comments.summary ? x.comments.summary.total_count : null, shares: x.shares ? x.shares.count : 0 });
      out.facebook.push({ page: p.name, posts: posts.length });
    } catch (e) { out.errors.push(`Facebook ${p.name}: ${e.message}`); }
    // Instagram posts, reels and carousels
    if (!p.ig) continue;
    try {
      const media = (await S.graphAll(`/${p.ig.id}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count', limit: 100 }, p.token, 3000))
        .filter((x) => x.timestamp && x.timestamp.slice(0, 10) >= from);
      const rows = media.map((x) => ({ id: x.id, at: x.timestamp, kind: x.media_product_type === 'REELS' ? 'reel' : x.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : x.media_type === 'VIDEO' ? 'video' : 'post',
        caption: x.caption, link: x.permalink, thumb: x.thumbnail_url || (x.media_type !== 'VIDEO' ? x.media_url : null), likes: x.like_count, comments: x.comments_count }));
      if (insights) await pool(rows, 6, async (x) => {
        try { const j = await S.graph(`/${x.id}/insights`, { metric: 'views,reach,saved,shares' }, p.token); for (const m of j.data || []) { const v = n0(m.values && m.values[0] && m.values[0].value); if (m.name === 'views') x.views = v; if (m.name === 'reach') x.reach = v; if (m.name === 'saved') x.saves = v; if (m.name === 'shares') x.shares = v; } }
        catch (e) { if (e.code190) throw e; }
      });
      for (const x of rows) await upsert('instagram', p.ig.username, x);
      out.instagram.push({ account: p.ig.username, posts: rows.length });
    } catch (e) { out.errors.push(`Instagram ${p.ig.username}: ${e.message}`); }
  }
  await db.q("insert into job_marks (key, done_at, info) values ('agents-history', now(), $1) on conflict (key) do update set done_at = now(), info = excluded.info", [out]).catch(() => {});
  return out;
}

// MahaRERA numbers that appear in our own captions, with the project names seen next to them.
async function reraSeen() {
  const rows = await db.q("select caption, posted_at from mkt_media where caption ~* 'P5[0-9]{10}' order by posted_at desc");
  const seen = {};
  for (const r of rows) for (const m of r.caption.matchAll(/P5\d{10}/gi)) {
    const k = m[0].toUpperCase(), s = seen[k] || (seen[k] = { rera: k, count: 0, names: {}, last: r.posted_at });
    s.count++;
    for (const nm of r.caption.match(/Dream\s+[A-Z][a-z]+/g) || []) s.names[nm] = (s.names[nm] || 0) + 1;
  }
  return Object.values(seen).sort((a, b) => b.count - a.count);
}

// accounts: which pages to learn from (the company pages, not personal ones); remembered for the monthly refresh.
async function analyseHistory({ months = 24, accounts = null } = {}) {
  const A = require('./agents');
  if (!A.brainOn()) throw Object.assign(new Error('The Brain needs ANTHROPIC_API_KEY in Vercel.'), { status: 409 });
  const set = await A.settingsOf('company');
  if (Array.isArray(accounts) && accounts.length) {
    await db.q(`insert into ag_scope (scope, enabled, owner, updated_at) values ('company', true, $1, now()) on conflict (scope) do update set owner = excluded.owner, updated_at = now()`, [{ ...set.owner, learnFrom: accounts.map(String).slice(0, 10) }]);
  } else accounts = set.owner.learnFrom || null;
  const all = await db.q(`select network, account, posted_at, kind, caption, likes, comments, shares, saves, views, reach, (${SCORE})::float as score
      from mkt_media where network in ('instagram', 'facebook') and posted_at > now() - ($1 || ' months')::interval and ($2::text[] is null or account = any($2)) order by posted_at`, [String(months), accounts]);
  if (all.length < 5) throw Object.assign(new Error('Fewer than 5 past posts imported: run the import first.'), { status: 409 });
  const ranked = [...all].sort((a, b) => b.score - a.score);
  const line = (x) => `${String(x.posted_at.toISOString ? x.posted_at.toISOString() : x.posted_at).slice(0, 10)} ${new Date(x.posted_at).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })} ${x.network}/${x.kind} score ${Math.round(x.score)} (likes ${n0(x.likes)}, comments ${n0(x.comments)}, shares ${n0(x.shares)}, saves ${n0(x.saves)}, views ${n0(x.views)}): ${clip(x.caption, 220) || '(no caption)'}`;
  const group = (key) => { const g = {}; for (const x of all) { const k = key(x); const v = g[k] || (g[k] = { n: 0, s: 0 }); v.n++; v.s += x.score; } return Object.entries(g).map(([k, v]) => `${k}: ${v.n} posts, average score ${Math.round(v.s / v.n)}`).join('; '); };
  const ist = (x) => new Date(new Date(x.posted_at).getTime() + 5.5 * 3600e3);
  const rera = await reraSeen();
  const prompt = `You are the analyst of Dream India Realty's AI marketing team (Mumbai real estate developer: redevelopment and SRA, projects Dream Signature in Oshiwara and Dream Aspire in Lokhandwala/Andheri West, plus brand content).
Below are ALL ${all.length} posts from our own Instagram and Facebook in the last ${months} months, with their figures. The score = likes + 3×comments + 4×shares + 4×saves + views/200.

Averages by format: ${group((x) => x.network + '/' + x.kind)}
Averages by weekday (IST): ${group((x) => ist(x).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }))}
Averages by hour (IST): ${group((x) => String(ist(x).getUTCHours()).padStart(2, '0') + 'h')}
Averages by month: ${group((x) => ist(x).toISOString().slice(0, 7))}

TOP 40 POSTS
${ranked.slice(0, 40).map(line).join('\n')}

BOTTOM 20 POSTS
${ranked.slice(-20).map(line).join('\n')}

EVERY POST (oldest first, captions cut short)
${all.map((x) => `${String(new Date(x.posted_at).toISOString()).slice(0, 10)} ${x.network}/${x.kind} ${Math.round(x.score)}: ${clip(x.caption, 110)}`).join('\n').slice(0, 60000)}

Write the knowledge file "what worked for Dream India" in Markdown, for the Content Engine that drafts our next posts. Use only what the figures show; say how sure each finding is (how many posts it rests on). Sections:
## Summary (5 bullets)
## Topics that worked, and topics that did not
## Hooks and opening lines that worked (quote the real ones)
## Formats (reel, carousel, post) and which network
## Days and times
## Festivals and special days (what we posted, and how it did)
## Dream Signature posts
## Dream Aspire posts
## Brand posts
## Calls to action and comment keywords that got replies
## Do more of / Stop doing (concrete)
Keep it under 900 words. Answer as JSON only: {"markdown":"..."}`;
  const r = await A.brainCall(prompt, 4000);
  const md = String(r.markdown || '').trim();
  if (md.length < 200) throw Object.assign(new Error('The Brain did not write the analysis.'), { status: 502 });
  const body = `${md}\n\n_Written by the AI Agent Team from ${all.length} posts (${months} months), ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}. Refreshed every month._`;
  await db.q(`insert into ag_knowledge (scope, path, body, updated_at) values ('company', '/brand-brain/what-worked.md', $1, now())
      on conflict (scope, path) do update set body = excluded.body, updated_at = now()`, [body]);
  await A.say('company', 'results', 'content-engine', `Read ${all.length} past posts (${months} months) and wrote /brand-brain/what-worked.md: what to do more of and what to stop.`, 'say');
  return { posts: all.length, rera, words: md.split(/\s+/).length };
}

module.exports = { importHistory, analyseHistory, reraSeen, SCORE };
