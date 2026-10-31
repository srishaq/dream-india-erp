// Tools for the marketing team.
//   Canva        "Pick from Canva": the team's Canva designs listed in the ERP; the one chosen is exported by Canva (PNG,
//                PDF or MP4) and kept with the post for approval. Needs a Canva integration (Canva Developer Portal →
//                Your integrations): CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in Vercel, return address <ERP>/oauth/canva,
//                scopes design:meta:read and design:content:read.
//   Captions     caption drafts (English, Hindi, Marathi) written by Claude from the post's title and the project, with
//                the project's MahaRERA number. Needs ANTHROPIC_API_KEY in Vercel (already used for challan reading).
//   RERA check   a post or campaign for a project with a MahaRERA number is not sent for approval or posted unless the
//                number is in the caption or the team ticks that it is on the design.
//   Competitors  links to each competitor's running ads in Meta's public Ad Library.
const crypto = require('crypto');
const db = require('./db');

const err = (status, message) => Object.assign(new Error(message), { status });
const host = (req) => { if (process.env.ERP_URL) return process.env.ERP_URL.replace(/\/+$/, ''); const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]; return `${/^localhost|^127\./.test(req.headers.host || '') ? 'http' : proto}://${req.headers.host}`; };

// ---------- Canva ----------
const CANVA_API = () => (process.env.CANVA_API || 'https://api.canva.com/rest/v1').replace(/\/+$/, '');
const CANVA_AUTH = () => process.env.CANVA_AUTH || 'https://www.canva.com/api/oauth/authorize';
const canvaOn = () => !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
const ckey = () => crypto.createHash('sha256').update('erp-canva:' + (process.env.CANVA_CLIENT_SECRET || '')).digest();
const seal = (t) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', ckey(), iv); const x = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return [iv, c.getAuthTag(), x].map((b) => b.toString('base64url')).join('.'); };
const unseal = (s) => { const [iv, tag, x] = String(s).split('.').map((b) => Buffer.from(b, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', ckey(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(x), d.final()]).toString('utf8'); };
async function cget() { return (await db.one("select value from settings where key = 'canva'"))?.value || {}; }
async function cput(v) { await db.q("insert into settings (key, value) values ('canva', $1) on conflict (key) do update set value = excluded.value", [v]); }
const basic = () => 'Basic ' + Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString('base64');

async function canvaAuthUrl(req, userId) {
  if (!canvaOn()) throw err(409, 'Canva is not set up yet: CANVA_CLIENT_ID and CANVA_CLIENT_SECRET are missing in Vercel (Set-up shows how).');
  const verifier = crypto.randomBytes(48).toString('base64url'), state = crypto.randomBytes(18).toString('base64url');
  const v = await cget(); v.pending = { state, verifier, user: userId, exp: Date.now() + 15 * 60000 }; await cput(v);
  const q = new URLSearchParams({ code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256', scope: 'design:meta:read design:content:read', response_type: 'code', client_id: process.env.CANVA_CLIENT_ID, state, redirect_uri: host(req) + '/oauth/canva' });
  return `${CANVA_AUTH()}?${q}`;
}
async function canvaToken(params) {
  const r = await fetch(CANVA_API() + '/oauth/token', { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw err(502, `Canva: ${j.error_description || j.message || j.error || r.status}`);
  return j;
}
async function canvaCallback(req, userId) {
  const q = req.query || {}, v = await cget(), p = v.pending; delete v.pending;
  if (!p || p.state !== q.state || p.user !== userId || Date.now() > p.exp) { await cput(v); throw err(400, 'The Canva sign-in link has expired. Press "Connect Canva" again.'); }
  if (q.error) { await cput(v); throw err(400, 'Canva was not connected: ' + String(q.error_description || q.error).slice(0, 200)); }
  const j = await canvaToken({ grant_type: 'authorization_code', code: String(q.code || ''), code_verifier: p.verifier, redirect_uri: host(req) + '/oauth/canva' });
  v.refresh = seal(j.refresh_token); v.at = new Date().toISOString(); v.by = userId; v.error = null; v.access = { t: seal(j.access_token), exp: Date.now() + (j.expires_in || 3600) * 1000 };
  const me = await canvaCall('/users/me/profile', {}, j.access_token).catch(() => null);
  v.name = me && me.profile && me.profile.display_name || null;
  await cput(v);
  return { name: v.name };
}
async function canvaAccess() {
  const v = await cget(); if (!v.refresh) throw err(409, 'Canva is not connected (Set-up → Connect Canva).');
  if (v.access && Date.now() < v.access.exp - 60000) return unseal(v.access.t);
  const j = await canvaToken({ grant_type: 'refresh_token', refresh_token: unseal(v.refresh) }).catch(async (x) => { v.error = 'Canva signed the ERP out: press "Connect Canva" again.'; await cput(v); throw x; });
  v.access = { t: seal(j.access_token), exp: Date.now() + (j.expires_in || 3600) * 1000 }; if (j.refresh_token) v.refresh = seal(j.refresh_token); await cput(v);
  return j.access_token;
}
async function canvaCall(path, { method = 'GET', body, query } = {}, token) {
  const u = new URL(CANVA_API() + path); for (const [k, x] of Object.entries(query || {})) if (x != null && x !== '') u.searchParams.set(k, String(x));
  const r = await fetch(u, { method, headers: { Authorization: 'Bearer ' + (token || await canvaAccess()), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status === 401 ? 409 : 502, `Canva: ${j.message || j.code || r.status}`);
  return j;
}
async function canvaDesigns({ query, continuation } = {}) {
  const j = await canvaCall('/designs', { query: { query, continuation, limit: 30, sort_by: 'modified_descending' } });
  return { items: (j.items || []).map((d) => ({ id: d.id, title: d.title || 'Untitled', thumb: d.thumbnail && d.thumbnail.url, edit: d.urls && d.urls.edit_url, view: d.urls && d.urls.view_url, updated: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null, pages: d.page_count })), next: j.continuation || null };
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4' };
// exports a design and returns the files (one per page; Instagram / Facebook take up to 10 pictures)
async function canvaExport(designId, type = 'png') {
  if (!MIME[type]) throw err(400, 'PNG, JPG, PDF or MP4?');
  const start = await canvaCall('/exports', { method: 'POST', body: { design_id: String(designId), format: type === 'mp4' ? { type, quality: 'horizontal_1080p' } : type === 'jpg' ? { type, quality: 90 } : { type } } });
  let job = start.job; const until = Date.now() + 60000;
  while (job && job.status === 'in_progress' && Date.now() < until) { await new Promise((r) => setTimeout(r, 1500)); job = (await canvaCall('/exports/' + job.id)).job; }
  if (!job || job.status !== 'success') throw err(502, job && job.error ? `Canva could not export it: ${job.error.message || job.error.code}` : 'Canva is still exporting: try again in a minute.');
  const files = [];
  for (const [i, u] of (job.urls || []).slice(0, 10).entries()) {
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    files.push({ name: `canva-${designId}${(job.urls || []).length > 1 ? '-' + (i + 1) : ''}.${type}`, mime: MIME[type], data: buf });
  }
  return files;
}
async function canvaStatus() { const v = await cget(); return { configured: canvaOn(), connected: !!v.refresh, name: v.name || null, at: v.at || null, error: v.error || null }; }
async function canvaDisconnect() { const v = await cget(); delete v.refresh; delete v.access; v.name = null; await cput(v); }
const okCanvaImg = (u) => { try { const h = new URL(u); return h.protocol === 'https:' && /(^|\.)canva\.com$|(^|\.)canva-[a-z0-9-]+\.com$|(^|\.)amazonaws\.com$/.test(h.hostname); } catch { return false; } };

// ---------- caption drafts ----------
const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
async function captions({ title, brief, projectId, kind, channels = [], language = 'en' }) {
  if (!aiOn()) throw err(409, 'Caption drafts need ANTHROPIC_API_KEY in Vercel.');
  const p = projectId ? await db.one('select name, location, rera_no from projects where id = $1', [projectId]) : null;
  const lang = { en: 'English', hi: 'Hindi (Devanagari)', mr: 'Marathi (Devanagari)', hinglish: 'Hinglish (Hindi in Latin letters)' }[language] || 'English';
  const prompt = `You write social media captions for Dream India Realty, a Mumbai real estate developer.
Write 3 different caption options in ${lang} for this ${kind || 'post'} on ${channels.join(', ') || 'Instagram and Facebook'}.
Post: ${title || ''}
${brief ? 'Brief: ' + brief : ''}
${p ? `Project: ${p.name}${p.location ? ', ' + p.location : ''}${p.rera_no ? '. MahaRERA registration number: ' + p.rera_no : ''}` : 'Company brand post (no single project).'}
Rules: warm and confident, not pushy; no promises of returns, no "guaranteed", no prices unless the brief gives them; end with a clear call to action (call, WhatsApp or site visit).
${p && p.rera_no ? `Every option must end with the line "MahaRERA No.: ${p.rera_no} | maharera.maharashtra.gov.in".` : ''}
Add 5 to 8 relevant hashtags at the end of each option.
Answer as JSON only: {"options": ["caption 1", "caption 2", "caption 3"]}`;
  const r = await fetch((process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(45000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, `Claude: ${(j.error && j.error.message) || r.status}`);
  const text = (j.content || []).map((c) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  let options = []; try { options = JSON.parse(m ? m[0] : text).options || []; } catch { options = [text.trim()]; }
  return { options: options.map((o) => String(o).slice(0, 2200)).slice(0, 3), rera: p && p.rera_no };
}

// ---------- RERA ----------
const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function reraMissing(post) {
  if (!post || !post.project_id || post.rera_on_design) return null;
  const p = await db.one('select name, rera_no from projects where id = $1', [post.project_id]);
  if (!p || !p.rera_no) return null;
  const nos = String(p.rera_no).split(/[,;/]+/).map(squash).filter((x) => x.length >= 6);
  if (!nos.length || nos.some((x) => squash(post.caption).includes(x))) return null;
  return `The MahaRERA number of ${p.name} (${p.rera_no}) must be in the caption of "${post.title}", or tick "The RERA number is on the design".`;
}
async function reraCampaign(campaignId) {
  const posts = await db.q('select id, title, caption, project_id, rera_on_design from mkt_posts where campaign_id = $1', [campaignId]);
  for (const p of posts) { const m = await reraMissing(p); if (m) return m; }
  return null;
}

// ---------- competitors ----------
const adLibrary = (name) => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&media_type=all&search_type=keyword_unordered&q=${encodeURIComponent(name)}`;

module.exports = { canvaOn, canvaAuthUrl, canvaCallback, canvaDesigns, canvaExport, canvaStatus, canvaDisconnect, okCanvaImg, aiOn, captions, reraMissing, reraCampaign, adLibrary };
