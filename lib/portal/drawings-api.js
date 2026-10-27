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
  if (!pending) pending = drawings.register().then((files) => (cache = { at: Date.now(), files })).finally(() => { pending = null; });
  return pending;
}

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, 'drawings');
  if (!u) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!sheets.configured()) return res.status(503).json({ error: 'The portal\'s Google account is not set up (GOOGLE_SERVICE_ACCOUNT_JSON).', code: 'no_google' });
  try {
    const c = await load(req.query && req.query.refresh === '1');
    res.status(200).json({
      files: c.files, checkedAt: new Date(c.at).toISOString(),
      folder: `https://drive.google.com/drive/folders/${drawings.ROOT}`, serviceEmail: sheets.serviceEmail(),
    });
  } catch (e) {
    const known = e instanceof drawings.DriveError;
    if (!known) console.error('drawings', e);
    res.status(502).json({ error: known ? e.message : 'Could not read the drawings folder from Google Drive. Try again in a moment.', code: e.code || 'error' });
  }
};
