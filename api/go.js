// Tracked links for social posts (lib/post-links.js, from Zuri).
// GET /go/<network>[/<post id>]  (vercel.json rewrites it to /api/go?n=<network>&p=<post id>): counts a tap, then sends
//     the visitor to dreamindiarealty.com tagged utm_source=<network>, utm_medium=social, utm_campaign=post-<id>.
//     Networks: li (LinkedIn), x, fb (Facebook), ig (Instagram), yt (YouTube), wa (WhatsApp). Link previews are not counted.
// Nothing personal is kept: only a count per day, network and post.
const { route, str } = require('../lib/http');
const T = require('../lib/post-links');

// a few counts a minute from one address, so nobody can pump the numbers up
const seen = new Map();
function allowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  const now = Date.now(), t = (seen.get(ip) || []).filter((x) => now - x < 60000);
  if (seen.size > 5000) seen.clear();
  if (t.length >= 10) return false;
  t.push(now); seen.set(ip, t);
  return true;
}

module.exports = route({
  async GET(req, res) {
    const q = req.query || {};
    const p = /^\d{1,9}$/.test(str(q.p, 12)) ? +q.p : null;
    const to = T.target(q.n, p);
    if (to && !T.isBot(req.headers['user-agent']) && allowed(req)) {
      try { await T.count(to.network, to.postId); } catch (e) { console.error('go click', e.message); }
    }
    res.statusCode = 302;
    res.setHeader('Location', to ? to.url : `https://${process.env.WEBSITE_DOMAIN || 'dreamindiarealty.com'}/`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  },
});
