// WhatsApp webhook (Click Connect or Meta → ERP). Public: no ERP session. A Click Connect call must carry the secret key
// in its address (?k=…, set by Connect the WhatsApp webhook); a Meta call must carry Meta's signature (lib/whatsapp.js).
// GET  hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → Meta checks the address once, when it is set up
// POST messages and delivery ticks
const wa = require('../lib/whatsapp');
const { migrate, status } = require('../lib/migrate');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q['hub.mode'] === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) { res.statusCode = 200; return res.end(String(q['hub.challenge'] || '')); }
    res.statusCode = 403; return res.end('Not allowed.');
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  // the signature is over the exact bytes Meta sent, so read the request itself (before any body parsing)
  let raw = Buffer.alloc(0);
  try { const parts = []; for await (const c of req) parts.push(Buffer.from(c)); raw = Buffer.concat(parts); } catch { /* already read */ }
  if (!raw.length && req.body) raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const k = String(q.k || ''), want = wa.ccm() ? wa.hookKey() : '';
  const keyOk = want && k.length === want.length && require('crypto').timingSafeEqual(Buffer.from(k), Buffer.from(want));
  if (!keyOk && !wa.signed(req, raw)) { res.statusCode = 401; return res.end('Not allowed.'); }
  try {
    const st = await status(); if (st.pending.length && st.applied.length) await migrate();
    const r = await wa.webhook(JSON.parse(raw.toString('utf8') || '{}'));
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, ...r }));
  } catch (e) { console.error('whatsapp webhook', e); res.statusCode = 200; return res.end('{"ok":false}'); } // 200 so Meta does not retry forever
};
