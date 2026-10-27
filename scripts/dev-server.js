// Local run: DATABASE_URL=postgres://... node scripts/dev-server.js → http://localhost:3000
// Behaves like Vercel: /api/<name> runs api/<name>.js, everything else is served from public/.
const http = require('http'), fs = require('fs'), path = require('path');
const routes = {};
for (const f of fs.readdirSync(path.join(__dirname, '../api'))) if (f.endsWith('.js')) routes['/api/' + f.slice(0, -3)] = require('../api/' + f);
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const PORT = +process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  // the rewrites in vercel.json
  if (u.pathname === '/api/me') u.pathname = '/api/portal';
  if (u.pathname === '/api/hr') { u.pathname = '/api/portal'; u.searchParams.set('hr', '1'); }
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (routes[u.pathname]) {
    let body = ''; for await (const c of req) body += c;
    req.body = body; req.query = Object.fromEntries(u.searchParams);
    try { return await routes[u.pathname](req, res); } catch (e) { console.error(e); return res.status(500).json({ error: e.message }); }
  }
  let p = u.pathname === '/' || /^\/(crm|finance|audit|construction|training|home|management)\/?$/.test(u.pathname) ? '/index.html' : u.pathname;
  if (!path.extname(p)) p += '.html';
  const f = path.join(__dirname, '../public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(f, (e, data) => {
    if (e) return res.status(404).end('Not found');
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    res.end(data);
  });
});
server.listen(PORT, () => console.log('http://localhost:' + PORT));
module.exports = server;
