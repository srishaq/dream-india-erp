// The Reports tab. GET ?list=1 → the reports; GET ?name=&project=&from=&to=&wing=&status= → one report; &export=xlsx → Excel.
const auth = require('../lib/auth');
const R = require('../lib/reports');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { write } = require('../lib/xlsx-write');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, null); if (!u) return;
    const q = req.query || {};
    if (!has(u, 'reports.view')) throw fail(403, 'Reports are open to Management, Head CRM, Head Accounts and the people given access.');
    const ok = () => true; // everyone with Reports sees every report (5 Nov 2026)
    if (q.list) return res.json({ reports: R.list().filter((r) => ok(r.section)) });
    const meta = R.list().find((r) => r.key === q.name);
    if (!meta) throw fail(404, 'Unknown report.');
    if (!ok(meta.section)) throw fail(403, 'Your role does not allow this report.');
    const f = { from: DATE.test(q.from || '') ? q.from : null, to: DATE.test(q.to || '') ? q.to : null, wing: ['A', 'B'].includes(q.wing) ? q.wing : null, status: str(q.status, 80) || null };
    const out = await R.run(q.name, needProject(u, intOr(q.project)), f);
    if (q.export === 'xlsx') {
      const w = str(q.q, 80).toLowerCase();
      const rows = out.rows.filter((r) => r._total || !w || out.cols.some((c) => String(r[c.k] ?? '').toLowerCase().includes(w)));
      const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const head = [[out.title], [[f.from && 'from ' + f.from, f.to && 'to ' + f.to, f.wing && 'Wing ' + f.wing, f.status, w && `search "${w}"`].filter(Boolean).join(', ') || 'All'], [], out.cols.map((c) => c.l)];
      const body = rows.map((r) => out.cols.map((c) => (c.t === 'm' || c.t === 'n' ? (r[c.k] === '' || r[c.k] == null ? '' : Number(r[c.k])) : r[c.k] ?? '')));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${out.title.replace(/[^A-Za-z0-9]+/g, '_')}_${day}.xlsx"`);
      return res.end(write([{ name: out.title.slice(0, 30), rows: [...head, ...body, [], [out.note || '']], widths: out.cols.map((c) => (c.t ? 15 : 26)) }]));
    }
    return res.json(out);
  },
});
