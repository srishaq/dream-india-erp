// Google Drive for customer documents, in the company owner's own Google Drive (a personal Gmail Drive, where
// the service account cannot save files). The Admin connects it once with "Connect Google Drive": Google asks the
// owner to allow the ERP, with the drive.file permission only, so the ERP can see and change only the files and
// folders it made itself (one "Dream India ERP – Customer Documents" folder), never anything else in that Drive.
// The long-lived refresh token is kept encrypted in the settings table.
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (a "Web application" OAuth client in Google Cloud, with the
//      redirect URI https://<erp host>/oauth/google). For local tests: GDRIVE_API, GOOGLE_OAUTH_TOKEN_URL, GOOGLE_OAUTH_AUTH_URL.
const crypto = require('crypto');
const db = require('./db');

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const API = () => process.env.GDRIVE_API || 'https://www.googleapis.com';
const TOKEN_URL = () => process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const AUTH_URL = () => process.env.GOOGLE_OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Dream India ERP – Customer Documents';

const configured = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const err = (status, message) => Object.assign(new Error(message), { status });

// ---------- the stored connection ----------
const key = () => crypto.createHash('sha256').update('erp-gdrive:' + (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '')).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function open(sealed) {
  const [iv, tag, enc] = String(sealed).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
async function conn() { return (await db.one("select value from settings where key = 'gdrive'"))?.value || null; }
async function saveConn(v) { await db.q("insert into settings (key, value) values ('gdrive', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(v)]); }
async function status() {
  const c = await conn();
  return { configured: configured(), connected: !!(c && c.refresh), email: c ? c.email : null, connectedAt: c ? c.at : null, rootId: c ? c.root : null, error: c ? c.error || null : null };
}

// ---------- signing in ----------
function redirectUri(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${/^localhost|^127\./.test(req.headers.host || '') ? 'http' : proto}://${req.headers.host}/oauth/google`;
}
async function authUrl(req, userId) {
  if (!configured()) throw err(409, 'Google sign-in is not set up yet: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel.');
  const state = crypto.randomBytes(18).toString('base64url');
  await db.q("insert into settings (key, value) values ('gdrive_state', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ state, user: userId, exp: Date.now() + 10 * 60000 })]);
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'true' });
  return `${AUTH_URL()}?${q}`;
}
async function callback(req, userId) {
  const q = req.query || {};
  const st = (await db.one("select value from settings where key = 'gdrive_state'"))?.value;
  await db.q("delete from settings where key = 'gdrive_state'");
  if (!st || st.state !== q.state || st.user !== userId || Date.now() > st.exp) throw err(400, 'The Google sign-in link has expired. Start again from Customer documents.');
  if (q.error) throw err(400, q.error === 'access_denied' ? 'Google Drive was not connected: permission was not given.' : `Google: ${q.error}`);
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(q.code || ''), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw err(502, `Google did not return a Drive connection (${j.error_description || j.error || r.status}). Try Connect again.`);
  if (!String(j.scope || '').includes('drive.file')) throw err(400, 'The Drive permission box was not ticked. Connect again and allow the ERP to see the files it creates.');
  let email = null;
  try { email = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()).email || null; } catch { /* no id token */ }
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  await saveConn({ refresh: seal(j.refresh_token), email, at: new Date().toISOString(), by: userId, root: null });
  await db.q("delete from doc_folders"); // a newly connected Drive gets its own folders
  await rootFolder();
  return { email };
}
async function disconnect() {
  const c = await conn();
  if (c && c.refresh) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(c.refresh))}`, { method: 'POST' }); } catch { /* best effort */ } }
  await db.q("delete from settings where key = 'gdrive'");
  cache = null;
}

// ---------- calls ----------
let cache = null;
async function token() {
  if (cache && Date.now() < cache.exp - 60000) return cache.token;
  const c = await conn();
  if (!c || !c.refresh) throw err(409, 'Google Drive is not connected yet. The Admin connects it on the Customer documents page.');
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: open(c.refresh), grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') { await saveConn({ ...c, error: 'Google says the connection was removed or has expired. Connect Google Drive again.' }); throw err(409, 'The Google Drive connection has expired or was removed. The Admin must connect it again on the Customer documents page.'); }
    throw err(502, `Google sign-in failed (${j.error || r.status}).`);
  }
  if (c.error) await saveConn({ ...c, error: null });
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}
async function call(path, opts = {}, raw = false) {
  const r = await fetch(path.startsWith('http') ? path : API() + path, { ...opts, redirect: 'manual', headers: { Authorization: `Bearer ${await token()}`, ...(opts.headers || {}) } });
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status === 404 ? 404 : 502, `Google Drive: ${j.error?.message || r.status}`);
  return j;
}

async function makeFolder(name, parent) {
  const j = await call('/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) });
  return j.id;
}
async function rootFolder() {
  const c = await conn();
  if (c && c.root) return c.root;
  const id = await makeFolder(ROOT_NAME, null);
  await saveConn({ ...c, root: id });
  return id;
}
// A folder under the root (or under another folder of ours), made once and remembered.
async function folder(keyName, name, parentKey = null, parentName = null) {
  const have = await db.one('select drive_id from doc_folders where key = $1', [keyName]);
  if (have) return have.drive_id;
  const parent = parentKey ? await folder(parentKey, parentName) : await rootFolder();
  const id = await makeFolder(name.replace(/[\\/]/g, '-').slice(0, 120), parent);
  await db.q('insert into doc_folders (key, drive_id) values ($1, $2) on conflict (key) do nothing', [keyName, id]);
  return (await db.one('select drive_id from doc_folders where key = $1', [keyName])).drive_id;
}

// Resumable upload: start a session, then send the file in pieces (each a multiple of 256 KB but the last).
async function startUpload({ name, mime, size, parent }) {
  const r = await call('/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [parent] }) }, true);
  if (!r.ok || !r.headers.get('location')) { const j = await r.json().catch(() => ({})); throw err(502, `Google Drive did not accept the upload (${j.error?.message || r.status}).`); }
  return r.headers.get('location');
}
async function putPart(sessionUrl, buf, start, total) {
  const end = start + buf.length - 1;
  const r = await call(sessionUrl, { method: 'PUT', headers: { 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${total}` }, body: buf }, true);
  if (r.status === 308) { const range = r.headers.get('range'); return { done: false, received: range ? +range.split('-')[1] + 1 : 0 }; }
  if (r.ok) { const j = await r.json(); return { done: true, received: total, id: j.id }; }
  const j = await r.json().catch(() => ({}));
  throw err(502, `Google Drive stopped the upload (${j.error?.message || r.status}). Try again.`);
}
async function getPart(fileId, start, end) {
  const r = await call(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Range: `bytes=${start}-${end}` } }, true);
  if (r.status !== 206 && r.status !== 200) throw err(r.status === 404 ? 404 : 502, r.status === 404 ? 'That file is no longer in Google Drive.' : `Google Drive: ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  return r.status === 200 && b.length > end - start + 1 ? b.subarray(start, end + 1) : b;
}
const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

module.exports = { configured, status, authUrl, callback, disconnect, folder, rootFolder, startUpload, putPart, getPart, folderLink, redirectUri, ROOT_NAME };
