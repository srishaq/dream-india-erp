// Shared helpers for API routes. Every write must come from the ERP's own pages:
// JSON body and a same-origin request (blocks forms posted from other sites).
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch { b = {}; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return (req.headers['sec-fetch-site'] || 'same-origin') === 'same-origin';
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
// Wraps a handler: no caching, method and origin checks, readable errors.
function route(handlers) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const h = handlers[req.method];
    if (!h) return res.status(405).json({ error: 'Method not allowed' });
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Request not allowed.' });
    try {
      return await h(req, res, body(req));
    } catch (e) {
      if (e.code === 'NO_DB') return res.status(503).json({ error: 'The database is not connected yet.', setup: 'no-db' });
      if (e.code === '23505') return res.status(409).json({ error: 'That already exists.', detail: e.constraint });
      if (e.code === '23503') return res.status(409).json({ error: 'That is still in use, or refers to something that does not exist.' });
      if (e.code === '23514') return res.status(400).json({ error: 'A value is out of range.', detail: e.constraint });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Something went wrong on the server.' });
    }
  };
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const intOr = (v, d = null) => (v === '' || v == null || !Number.isFinite(+v) ? d : Math.trunc(+v));

module.exports = { route, fail, str, intOr };
