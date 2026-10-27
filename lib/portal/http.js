// Shared helpers for the portal sections' API routes.
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
const noStore = (res) => res.setHeader('Cache-Control', 'private, no-store');
// Writes must come from the ERP's own pages.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return (req.headers['sec-fetch-site'] || 'same-origin') === 'same-origin';
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
module.exports = { body, noStore, sameOrigin };
