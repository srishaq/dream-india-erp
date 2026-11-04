// Drawings register (served from /api/me?drawings=1, because the Hobby plan allows only 12 functions): lists every drawing in the Dream Signature Site Plans folder (Google Drive),
// sorted by discipline, building and trade. Read-only; files open in Google Drive.
// GET /api/me?drawings=1           → { files, folder, checkedAt }
// GET /api/me?drawings=1&refresh=1 → reads Drive again instead of the short cache
const auth = require('./auth');
const sheets = require('./sheets');
const drawings = require('./drawings');
const { noStore } = require('./http');

const TTL = 3 * 60 * 1000, MIN_REFRESH = 20 * 1000;
let cache = null; // { at, files }
let pending = null;

async function load(force) {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && (age < TTL) && !(force && age > MIN_REFRESH)) return cache;
  if (!pending) pending = drawings.register().then((files) => (cache = { at: Date.now(), files, uploadFolders: files.uploadFolders || [] })).finally(() => { pending = null; });
  return pending;
}

// CAD files open in the browser: the free mlightcad viewer page reads the DWG straight from the ERP in the viewer's own
// browser (nothing is uploaded to them). The ERP hands out a link that works for 15 minutes for one file, and streams
// the file from Drive with the service account, so the Drive folder never has to be public.
const crypto = require('crypto');
const VIEWER = 'https://mlightcad.com/embed.html';
const secret = () => { try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').private_key || process.env.GOOGLE_PRIVATE_KEY || ''; } catch { return ''; } };
const sign = (id, exp) => crypto.createHmac('sha256', 'erp-cad:' + secret()).update(`${id}.${exp}`).digest('hex').slice(0, 32);
function cadToken(id) { const exp = Math.floor(Date.now() / 1000) + 15 * 60; return `${id}.${exp}.${sign(id, exp)}`; }
function checkCad(tok) {
  const [id, exp, sig] = String(tok || '').split('.');
  if (!id || !exp || !sig || +exp < Date.now() / 1000 || !secret()) return null;
  const want = sign(id, exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}
async function streamCad(req, res, id) {
  const c = await load(false);
  const f = c.files.find((x) => x.id === id && x.kind === 'cad');
  if (!f) return res.status(404).json({ error: 'That drawing is not in the drawings folder.' });
  const token = await drawings.accessToken('https://www.googleapis.com/auth/drive.readonly');
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok || !r.body) return res.status(502).json({ error: 'Could not read the drawing from Google Drive.' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^A-Za-z0-9._ -]+/g, '_')}"`);
  if (r.headers.get('content-length')) res.setHeader('Content-Length', r.headers.get('content-length'));
  for await (const chunk of r.body) res.write(chunk); // streamed, so larger drawings are not cut off
  res.end();
}

module.exports = async (req, res) => {
  noStore(res);
  const q = req.query || {};
  if (q.cad) { // no login: the 15-minute link itself is the permission
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); return res.status(204).end(); }
    const id = checkCad(q.cad);
    if (!id) return res.status(403).json({ error: 'This link has expired. Open the drawing again from the Drawings page.' });
    try { return await streamCad(req, res, id); } catch (e) { console.error('cad', e); if (!res.headersSent) return res.status(502).json({ error: 'Could not open the drawing.' }); return res.end(); }
  }
  const u = await auth.guard(req, res, 'drawings');
  if (!u) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (q.cadLink) {
    const c = await load(false);
    const f = c.files.find((x) => x.id === String(q.cadLink) && x.kind === 'cad');
    if (!f) return res.status(404).json({ error: 'That drawing is not in the drawings folder.' });
    const host = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const file = `${host}/api/portal?drawings=1&cad=${cadToken(f.id)}&name=${encodeURIComponent(f.name)}`;
    return res.json({ viewer: `${VIEWER}?url=${encodeURIComponent(file)}&mode=review&toolbar=1`, file });
  }
  if (!sheets.configured()) return res.status(503).json({ error: 'The portal\'s Google account is not set up (GOOGLE_SERVICE_ACCOUNT_JSON).', code: 'no_google' });
  try {
    const c = await load(req.query && req.query.refresh === '1');
    res.status(200).json({
      files: c.files, uploadFolders: c.uploadFolders || [], checkedAt: new Date(c.at).toISOString(),
      folder: `https://drive.google.com/drive/folders/${drawings.ROOT}`, serviceEmail: sheets.serviceEmail(),
    });
  } catch (e) {
    const known = e instanceof drawings.DriveError;
    if (!known) console.error('drawings', e);
    res.status(502).json({ error: known ? e.message : 'Could not read the drawings folder from Google Drive. Try again in a moment.', code: e.code || 'error' });
  }
};
