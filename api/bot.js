// The website chat assistant's public door (public/bot.js on dreamindiarealty.com talks to this). No login: visitors.
// GET ?chats=1 / ?chat=<id> are for staff (Sales & Marketing).
const { route, fail } = require('../lib/http');
const auth = require('../lib/auth');
const roles = require('../lib/roles');
const B = require('../lib/web-bot');

const ALLOWED = (process.env.BOT_ORIGINS || 'https://dreamindiarealty.com,https://www.dreamindiarealty.com,https://dreamindiagroup.com,https://www.dreamindiagroup.com').split(',').map((x) => x.trim()).filter(Boolean);
function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = ALLOWED.includes(o) || (process.env.VERCEL !== '1' && /^http:\/\/localhost(:\d+)?$/.test(o)) || o === (process.env.ERP_URL || 'https://erp.dreamindiarealty.com');
  if (ok) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
  return ok || !o;
}
const staff = route({
  async POST(req, res) {
    const u = await auth.session(req); if (!u) throw fail(401, 'Sign in.');
    if (!(roles.has(u, 'marketing.edit') || u.role === 'admin')) throw fail(403, 'Only the marketing team changes this.');
    const b = req.body || {};
    if (b.action !== 'onoff') throw fail(400, 'Unknown action.');
    const r = await B.setOn(!!b.on);
    await require('../lib/audit').record(require('../lib/db').q, { user: u, action: b.on ? 'website-chat-on' : 'website-chat-off', entity: 'settings', entityId: 'bot' });
    return res.json(r);
  },
  async GET(req, res) {
    const u = await auth.session(req); if (!u) throw fail(401, 'Sign in.');
    if (!roles.has(u, 'marketing.view')) throw fail(403, 'Not allowed.');
    if (req.query.chat) return res.json(await B.one(String(req.query.chat)));
    return res.json({ rows: await B.list({ projectId: parseInt(req.query.project, 10) || null }), on: B.configured(), live: (await B.cfg()).on });
  },
});
module.exports = async (req, res) => {
  // the website asks whether to show the chat (no login; says only on or off)
  if (req.method === 'GET' && req.query && req.query.cfg) {
    cors(req, res); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, max-age=60');
    try { return res.status(200).end(JSON.stringify({ on: (await B.cfg()).on && B.configured() })); } catch { return res.status(200).end('{"on":false}'); }
  }
  if (req.method === 'GET') return staff(req, res);
  // staff switching it on or off (same-origin, signed in)
  if (req.method === 'POST' && req.body && typeof req.body === 'object' && req.body.action === 'onoff') return staff(req, res);
  const okOrigin = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !okOrigin) return res.status(403).end(JSON.stringify({ error: 'Not allowed.' }));
  try {
    let b = req.body; if (typeof b === 'string') b = JSON.parse(b || '{}'); if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8') || '{}');
    return res.status(200).end(JSON.stringify(await B.chat(req, b || {})));
  } catch (e) { return res.status(e.status || 500).end(JSON.stringify({ error: e.status ? e.message : 'Sorry, something went wrong. Please try again.' })); }
};
