// Large videos (and big pictures) for social posts (Rupali, 27 Nov 2026: reels are 15-100 MB, the 3 MB limit kept them out).
// A post's file is either kept in the database (small designs, as before) or in the ERP's Google Drive (drive_file_id):
//  - uploaded from the browser in pieces of 2.5 MB (start / part), straight into Drive;
//  - or copied in from a Google Drive link ("File or video link"), once, when the link is saved or when the post goes out.
// Instagram and Facebook get a Drive-kept video as an upload (lib/social.js publishMeta: Instagram's resumable upload,
// Facebook's video upload), because a web link can only hand them 4 MB at a time. The approval page and the ERP play it
// from /api/marketing?pub= / ?pfile= in pieces (HTTP ranges), which every browser's video player asks for by itself.
const db = require('./db');
const gd = require('./gdrive');

const PART = 2.5 * 1024 * 1024;
const MAX = 300 * 1024 * 1024; // Instagram reels up to 300 MB through the API
const CHUNK = 4 * 1000 * 1000; // what one answer may carry
const TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const fail = (status, message) => Object.assign(new Error(message), { status });

const parent = () => gd.folder('marketing-posts', 'Marketing - post designs and videos');
const driveName = (postId, name) => `Post ${postId} - ${String(name || 'design').replace(/[\\/:*?"<>|]+/g, '-')}`.slice(0, 200);

async function start(u, postId, { name, mime, size }) {
  const post = await db.one('select id from mkt_posts where id = $1', [+postId || 0]); if (!post) throw fail(404, 'Save the post first.');
  if (!TYPES[mime]) throw fail(400, 'Attach an MP4 or MOV video, or a PNG, JPG, WEBP or PDF design.');
  size = Math.trunc(+size || 0); if (!(size > 0)) throw fail(400, 'That file is empty.');
  if (size > MAX) throw fail(400, 'That video is over 300 MB. Export it at 1080p from Canva or your editor; Instagram takes up to 300 MB.');
  if (!(await gd.status()).connected) throw fail(400, 'Google Drive is not connected to the ERP yet (Admin: Customer documents → Connect).');
  const url = await gd.startUpload({ name: driveName(post.id, name), mime, size, parent: await parent() });
  const r = await db.one('insert into mkt_post_uploads (post_id, name, mime, size, upload_url, created_by) values ($1, $2, $3, $4, $5, $6) returning id',
    [post.id, String(name || 'video').slice(0, 120), mime, size, url, u.id]);
  return { uploadId: r.id, part: PART, parts: Math.ceil(size / PART) };
}

async function part(u, { uploadId, index, data }) {
  const d = await db.one('select * from mkt_post_uploads where id = $1', [+uploadId || 0]);
  if (!d || d.created_by !== u.id) throw fail(404, 'That upload is not yours or has gone. Start again.');
  const i = Math.trunc(+index), from = i * PART;
  if (!(i >= 0) || from !== Number(d.received)) throw fail(409, `Send piece ${Math.floor(Number(d.received) / PART) + 1} next.`);
  const buf = Buffer.from(String(data || ''), 'base64');
  if (buf.length !== Math.min(PART, Number(d.size) - from)) throw fail(400, 'That piece of the file did not arrive whole. Try again.');
  const r = await gd.putPart(d.upload_url, buf, from, Number(d.size));
  if (!r.done) { await db.q('update mkt_post_uploads set received = $2 where id = $1', [d.id, from + buf.length]); return { done: false }; }
  const f = await db.one('insert into mkt_post_files (post_id, name, mime, size, drive_file_id, created_by) values ($1, $2, $3, $4, $5, $6) returning id', [d.post_id, d.name, d.mime, Number(d.size), r.id, u.id]);
  await db.q('delete from mkt_post_uploads where id = $1', [d.id]);
  return { done: true, id: f.id, postId: d.post_id, name: d.name };
}

// ---------- a Google Drive link ----------
function driveId(url) {
  const s = String(url || '').trim();
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{20,})/.exec(s) || /docs\.google\.com\/[^/]+\/d\/([\w-]{20,})/.exec(s) || /[?&]id=([\w-]{20,})/.exec(s);
  if (!m || !/google\.com/.test(s)) return null;
  const rk = /[?&]resourcekey=([\w-]+)/i.exec(s);
  return { id: m[1], resourceKey: rk ? rk[1] : null };
}
// what the link points at, and its bytes: first as the ERP's service account (a file shared with it, or with anyone who
// has the link), then as anyone with the link
async function fetchLinked(link) {
  const sheets = require('./sheets');
  const API = 'https://www.googleapis.com/drive/v3';
  const head = link.resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${link.id}/${link.resourceKey}` } : {};
  let token = null; try { token = await sheets.accessToken('https://www.googleapis.com/auth/drive.readonly'); } catch {}
  if (token) {
    const r = await fetch(`${API}/files/${link.id}?fields=id,name,mimeType,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}`, ...head } });
    if (r.ok) {
      const m = await r.json();
      if (m.mimeType === 'application/vnd.google-apps.folder') throw fail(400, 'That link is a folder. Put the link of the video file itself.');
      if (+m.size > MAX) throw fail(400, 'That video is over 300 MB. Export it at 1080p; Instagram takes up to 300 MB.');
      const b = await fetch(`${API}/files/${link.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}`, ...head } });
      if (b.ok) return { name: m.name, mime: m.mimeType, buf: Buffer.from(await b.arrayBuffer()) };
    }
  }
  const p = await fetch(`https://drive.usercontent.google.com/download?id=${link.id}&export=download&confirm=t${link.resourceKey ? '&resourcekey=' + link.resourceKey : ''}`, { redirect: 'follow' });
  const type = (p.headers.get('content-type') || '').split(';')[0];
  if (!p.ok || /text\/html/.test(type)) throw fail(400, 'The ERP cannot open that Drive file. In Drive: Share → General access → "Anyone with the link" (Viewer), then save again.');
  const cd = p.headers.get('content-disposition') || '';
  const nm = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  const buf = Buffer.from(await p.arrayBuffer());
  if (buf.length > MAX) throw fail(400, 'That video is over 300 MB.');
  return { name: nm ? decodeURIComponent(nm[1]) : 'video.mp4', mime: type, buf };
}
// copies the file behind a post's Drive link into the post's files (once: a file already copied from that link is kept)
async function fromLink(postId, url, userId = null) {
  const link = driveId(url); if (!link) return null;
  const tag = `drive:${link.id}`;
  const had = await db.one('select id, name from mkt_post_files where post_id = $1 and source = $2', [postId, tag]);
  if (had) return { id: had.id, name: had.name, already: true };
  if (!(await gd.status()).connected) throw fail(400, 'Google Drive is not connected to the ERP yet (Admin: Customer documents → Connect).');
  const got = await fetchLinked(link);
  const mime = TYPES[got.mime] ? got.mime : /\.mov$/i.test(got.name) ? 'video/quicktime' : /\.mp4$/i.test(got.name) ? 'video/mp4' : null;
  if (!mime) throw fail(400, `That Drive file is ${got.mime || 'not a video'}. Link an MP4 or MOV video, or a PNG, JPG or PDF design.`);
  if (!got.buf.length) throw fail(400, 'That Drive file is empty.');
  const up = await gd.startUpload({ name: driveName(postId, got.name), mime, size: got.buf.length, parent: await parent() });
  const r = await gd.putPart(up, got.buf, 0, got.buf.length);
  if (!r.done) throw fail(502, 'Google Drive did not finish the copy. Try again.');
  const f = await db.one('insert into mkt_post_files (post_id, name, mime, size, drive_file_id, source, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id', [postId, String(got.name).slice(0, 120), mime, got.buf.length, r.id, tag, userId]);
  return { id: f.id, name: got.name, size: got.buf.length };
}

// ---------- reading a file kept in Drive ----------
async function load(f) {
  const size = Number(f.size), out = [];
  for (let s = 0; s < size; s += 50 * 1024 * 1024) out.push(await gd.getPart(f.drive_file_id, s, Math.min(size, s + 50 * 1024 * 1024) - 1));
  return Buffer.concat(out);
}
// one answer to a browser's video player: the piece it asked for, at most 4 MB
async function serve(req, res, f, { disposition = null, cache = 'private, max-age=86400' } = {}) {
  const size = Number(f.size);
  const m = /bytes=(\d*)-(\d*)/.exec(String((req.headers || {}).range || ''));
  let from = 0, to = Math.min(size, CHUNK) - 1, part = false;
  if (m) { part = true; from = m[1] === '' ? Math.max(0, size - (+m[2] || 0)) : +m[1]; to = Math.min(size - 1, m[2] === '' || m[1] === '' ? from + CHUNK - 1 : +m[2], from + CHUNK - 1); }
  if (from >= size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); return res.end(); }
  if (!part && size > CHUNK) part = true; // too big for one answer: send the first piece, the player asks for the rest
  const buf = await gd.getPart(f.drive_file_id, from, to);
  res.setHeader('Content-Type', f.mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', cache);
  if (disposition) res.setHeader('Content-Disposition', disposition);
  if (part) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${from}-${from + buf.length - 1}/${size}`); }
  res.setHeader('Content-Length', String(buf.length));
  return res.end(buf);
}

module.exports = { PART, MAX, TYPES, start, part, driveId, fromLink, load, serve };
