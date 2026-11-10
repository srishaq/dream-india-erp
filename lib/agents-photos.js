// Real photos for the designs: our own renders from dreamindiarealty.com (the towers, homes, lobby, amenities),
// copied once into the Canva library and picked per post by what the post is about (pool, kitchen, tower…),
// least-used first so the feed does not repeat the same picture. Rupali can add more with photos.add.
const db = require('./db');

const SITE = 'https://dreamindiarealty.com/img/';
// [project code, file, what it shows]
const SEED = [
  ['ASPIRE', 'dream-aspire/aspire_hero_1.webp', 'tower exterior building skyline dusk elevation'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery5.webp', 'tower facade building exterior elevation handover'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery1.webp', 'lobby entrance reception arrival'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery2.webp', 'living room home interior apartment flat bhk'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery3.webp', 'kitchen home interior'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery4.webp', 'balcony deck view morning'],
  ['ASPIRE', 'dream-aspire/dream-aspire-gallery6.webp', 'gym fitness clubhouse amenities'],
  ['ASPIRE', 'dream-aspire/aspire-pool.webp', 'pool swimming amenities rooftop'],
  ['ASPIRE', 'dream-aspire/aspire-garden.webp', 'garden terrace greenery amenities view'],
  ['ASPIRE', 'dream-aspire/aspire-library.webp', 'library reading lounge amenities'],
  ['ASPIRE', 'dream-aspire/aspire-gym.webp', 'gym fitness amenities'],
  ['ASPIRE', 'dream-aspire/aspire-meditation.webp', 'meditation yoga wellness amenities'],
  ['ASPIRE', 'dream-aspire/aspire-indoor-game.webp', 'indoor games kids family amenities'],
  ['SIGNATURE', 'dream-signature/slide1.webp', 'tower exterior towers building skyline elevation night iconic'],
  ['SIGNATURE', 'dream-signature/d-sign-1-new.webp', 'pool deck amenities rooftop swimming'],
  ['SIGNATURE', 'dream-signature/d-sign-1.webp', 'living room home interior apartment flat bhk'],
  ['SIGNATURE', 'dream-signature/d-sign-2.webp', 'living dining home interior family'],
  ['SIGNATURE', 'dream-signature/d-sign-3.webp', 'kitchen home interior'],
  ['SIGNATURE', 'dream-signature/d-sign-4.webp', 'bedroom home interior'],
  ['SIGNATURE', 'dream-signature/d-sign-5.webp', 'bedroom master home interior'],
  ['SIGNATURE', 'dream-signature/d-sign-6.webp', 'terrace dining sky lounge evening amenities'],
  ['SIGNATURE', 'dream-signature/dream-garden.webp', 'garden terrace greenery amenities view'],
  ['SIGNATURE', 'dream-signature/dream-cafe.webp', 'cafe terrace lounge amenities'],
  ['SIGNATURE', 'dream-signature/theater.webp', 'theatre lounge entertainment amenities'],
  ['SIGNATURE', 'dream-signature/dream-gym.webp', 'gym fitness amenities'],
  ['SIGNATURE', 'dream-signature/dream-yoga.webp', 'yoga wellness meditation amenities'],
  ['SIGNATURE', 'dream-signature/dream-library.webp', 'library reading amenities'],
  ['SIGNATURE', 'dream-signature/kids-play.webp', 'kids play children family school amenities'],
  ['SIGNATURE', 'dream-signature/dream-joging.webp', 'jogging track walk fitness amenities'],
  ['BRAND', 'mumbai.webp', 'mumbai skyline city life brand'],
];

async function seed() {
  const projects = await db.q('select id, code from projects');
  const pid = (code) => (code === 'BRAND' ? null : (projects.find((p) => p.code === code) || {}).id);
  for (const [code, file, tags] of SEED) {
    const id = pid(code);
    if (code !== 'BRAND' && !id) continue;
    await db.q(`insert into ag_photos (project_id, url, tags) select $1, $2, $3 where not exists (select 1 from ag_photos where url = $2)`, [id || null, SITE + file, tags]);
  }
}

// Copy photos that are not in Canva yet (a few per call).
async function sync({ max = 6, budgetMs = 60000 } = {}) {
  const T = require('./mkt-tools');
  await seed();
  const rows = await db.q("select id, url, tags from ag_photos where asset_id is null and tries < 3 order by id limit $1", [max]);
  const t0 = Date.now(), out = { copied: 0, failed: [] };
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const res = await fetch(r.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const id = await T.canvaUpload(buf, 'Photo ' + r.url.split('/').pop().replace(/\.\w+$/, ''));
      await db.q('update ag_photos set asset_id = $2, error = null, tries = tries + 1 where id = $1', [r.id, id]);
      out.copied++;
    } catch (e) {
      await db.q('update ag_photos set error = $2, tries = tries + 1 where id = $1', [r.id, String(e.message).slice(0, 300)]);
      out.failed.push(r.url.split('/').pop() + ': ' + e.message);
    }
  }
  const left = await db.one('select count(*)::int as n from ag_photos where asset_id is null and tries < 3');
  out.left = left.n;
  return out;
}

// The best photos for a post: matching what it talks about, its own project first, least used first.
// Returns [{ asset_id, project_id }]: a brand post that shows a project's photo is an ad for that project (MahaRERA),
// so the caller adds that project's RERA number and QR. `projects` limits brand posts to projects that can carry them.
async function pick(post, n = 1, { projects = null } = {}) {
  const words = new Set(String(`${post.title} ${post.caption || ''} ${JSON.stringify(post.design_text || {})}`).toLowerCase().match(/[a-z]+/g) || []);
  let rows = await db.q("select id, project_id, tags, asset_id, used from ag_photos where asset_id is not null and tags not like 'mahareraqr%' order by used, id");
  if (!post.project_id && projects) rows = rows.filter((r) => !r.project_id || projects.includes(r.project_id));
  const own = post.project_id ? rows.filter((r) => r.project_id === post.project_id) : rows;
  const pool = own.length ? own : rows;
  const score = (r) => r.tags.split(' ').filter((t) => words.has(t)).length * 10 - r.used;
  const chosen = [...pool].sort((a, b) => score(b) - score(a) || a.used - b.used || a.id - b.id);
  const out = [];
  for (const r of chosen) { if (out.length >= n) break; out.push(r); }
  while (out.length < n && chosen.length) out.push(chosen[out.length % chosen.length]);
  for (const r of out) await db.q('update ag_photos set used = used + 1 where id = $1', [r.id]);
  return out.map((r) => ({ asset_id: r.asset_id, project_id: r.project_id || null }));
}

// One photo per carousel slide, each matched to that slide's own words ("3. A kitchen two people can use" gets the
// kitchen), never the same photo twice in one carousel; a brand carousel stays with one project where that project has a
// matching photo (each slide carries the RERA number and QR of the project its photo shows).
const ALIAS = { cook: 'kitchen', cooking: 'kitchen', cooks: 'kitchen', kitchens: 'kitchen', modular: 'kitchen', bed: 'bedroom', beds: 'bedroom', sleep: 'bedroom', bedrooms: 'bedroom', wardrobe: 'bedroom',
  hall: 'living', lounge: 'living', sofa: 'living', family: 'family', swim: 'pool', swimming: 'pool', workout: 'gym', fitness: 'gym', children: 'kids', child: 'kids', play: 'kids',
  view: 'view', views: 'view', balconies: 'balcony', sunlight: 'balcony', light: 'balcony', ventilation: 'balcony', breeze: 'balcony', entrance: 'lobby', arrival: 'lobby', reception: 'lobby',
  tower: 'tower', towers: 'tower', building: 'building', elevation: 'elevation', facade: 'facade', skyline: 'skyline', terrace: 'terrace', garden: 'garden', yoga: 'yoga', books: 'library', reading: 'library' };
const GENERIC = new Set(['home', 'interior', 'room', 'apartment', 'flat', 'bhk', 'amenities', 'brand', 'family', 'life']); // say nothing about which room
const wordsOf = (t) => { const w = new Set(); for (const x of String(t || '').toLowerCase().match(/[a-z]+/g) || []) { w.add(x); if (ALIAS[x]) w.add(ALIAS[x]); if (x.endsWith('s')) w.add(x.slice(0, -1)); } return w; };
async function pickPages(post, pages, { projects = null } = {}) {
  const general = wordsOf(`${post.title} ${post.caption || ''}`);
  let rows = await db.q("select id, project_id, tags, asset_id, used from ag_photos where asset_id is not null and tags not like 'mahareraqr%' order by used, id");
  if (!post.project_id && projects) rows = rows.filter((r) => !r.project_id || projects.includes(r.project_id));
  const own = post.project_id ? rows.filter((r) => r.project_id === post.project_id) : rows;
  const pool = own.length ? own : rows;
  const taken = new Set(), out = [];
  let keep = post.project_id || null; // a brand carousel: the first slide's project for every slide
  for (const pg of pages) {
    const mine = wordsOf(`${pg.headline || ''} ${pg.subline || ''}`), hint = wordsOf(pg.photoHint || '');
    const score = (r) => { const t = r.tags.split(' ').filter((x) => !GENERIC.has(x)); return t.filter((x) => hint.has(x)).length * 300 + t.filter((x) => mine.has(x)).length * 100 + t.filter((x) => general.has(x)).length * 5 - r.used + (keep && r.project_id === keep ? 30 : 0) + (/exterior/.test(r.tags) ? 8 : 0); }; // nothing fits: the tower
    const cand = pool.filter((r) => !taken.has(r.id)); // the right room first; the same project only breaks ties
    const best = [...(cand.length ? cand : pool)].sort((a, b) => score(b) - score(a) || a.used - b.used || a.id - b.id)[0];
    if (!best) { out.push(null); continue; }
    taken.add(best.id); out.push(best);
    if (!keep && best.project_id) keep = best.project_id;
  }
  for (const r of out) if (r) await db.q('update ag_photos set used = used + 1 where id = $1', [r.id]);
  return out.map((r) => (r ? { asset_id: r.asset_id, project_id: r.project_id || null } : null));
}

// MahaRERA QR codes: the official image per project (MahaRERA requires it on every project ad), and a see-through
// image for brand posts so the QR spot stays empty.
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAABdElEQVR4Xu3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+Bn+3AAHkQjJKAAAAAElFTkSuQmCC', 'base64');
async function qrFor(projectId) {
  const T = require('./mkt-tools');
  if (!projectId) {
    let r = await db.one("select asset_id from ag_photos where url = 'qr:blank' and asset_id is not null");
    if (!r) { const id = await T.canvaUpload(BLANK, 'Blank QR spot'); await db.q("insert into ag_photos (url, tags, asset_id) values ('qr:blank', 'mahareraqr-blank', $1) on conflict (url) do update set asset_id = excluded.asset_id", [id]); r = { asset_id: id }; }
    return { asset_id: r.asset_id };
  }
  const r = await db.one("select asset_id, created_at from ag_photos where project_id = $1 and tags = 'mahareraqr' and asset_id is not null order by id desc limit 1", [projectId]);
  return r ? { asset_id: r.asset_id, at: r.created_at } : null;
}
async function qrUpload(projectId, buf, mime, user) {
  const T = require('./mkt-tools');
  const pr = await db.one('select name from projects where id = $1', [projectId]);
  if (!pr) throw Object.assign(new Error('That project is not there.'), { status: 404 });
  if (!/^image\/(png|jpeg)$/.test(mime) || buf.length < 200 || buf.length > 2 * 1024 * 1024) throw Object.assign(new Error('Upload the QR as a PNG or JPG under 2 MB.'), { status: 400 });
  const id = await T.canvaUpload(buf, 'MahaRERA QR ' + pr.name);
  await db.q("insert into ag_photos (project_id, url, tags, asset_id, data, mime) values ($1, $2, 'mahareraqr', $3, $4, $5)", [projectId, 'qr:' + projectId + ':' + Date.now(), id, buf, mime]);
  return { project: pr.name };
}
async function qrList() {
  return db.q("select distinct on (project_id) project_id, id, created_at from ag_photos where tags = 'mahareraqr' and asset_id is not null order by project_id, id desc");
}

module.exports = { pickPages, sync, pick, seed, SEED, qrFor, qrUpload, qrList };
