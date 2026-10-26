// Bank Auto Check: the daily bank statement check (3:10 pm from the Drive folder, or a statement uploaded by hand),
// its runs and differences, and the PDC reminder emails.
// GET ?view=runs | ?run=ID | ?view=pdc
// POST {action:'upload', files:[{name, data(base64)}]} · {action:'drive'} · {action:'settings', ...} · {action:'pdc-send'}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const sheets = require('../lib/sheets');
const mailer = require('../lib/mailer');
const ba = require('../lib/bank-auto');
const pdc = require('../lib/pdc-mail');
const { has } = require('../lib/roles');
const { route, fail, str, intOr } = require('../lib/http');

const KEYS = ['statement_start', 'statement_folders', 'pdc_to', 'pdc_cc'];
const settings = async () => Object.fromEntries((await db.q('select key, value from acc_settings where book = $1 and key = any($2)', ['signature', KEYS])).map((r) => [r.key, r.value]));

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const q = req.query || {};
    const can = { enter: has(u, 'accounts.enter'), manage: has(u, 'accounts.manage') };
    if (q.run) { const r = await ba.runById(intOr(q.run)); if (!r) throw fail(404, 'Run not found.'); return res.json({ run: r, can }); }
    if (q.view === 'pdc') return res.json({ ...(await pdc.send({ dryRun: true })), mail: mailer.configured(), can });
    return res.json({
      runs: await ba.runs(30), last: await ba.lastOk(), settings: await settings(), can,
      google: sheets.configured(), serviceEmail: sheets.serviceEmail() || null, mail: mailer.configured(), live: process.env.ERP_LIVE === '1',
    });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };
    if (b.action === 'upload') {
      need('accounts.enter');
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 10).map((f) => ({ name: str(f.name, 200), buffer: Buffer.from(String(f.data || ''), 'base64') }));
      if (!files.length || files.some((f) => !f.buffer.length)) throw fail(400, 'Choose the statement files (.xlsx) to upload.');
      if (files.some((f) => !/\.xlsx$/i.test(f.name))) throw fail(400, 'Statements must be Excel .xlsx files.');
      const compareFrom = b.compare ? (/^\d{4}-\d{2}-\d{2}$/.test(b.from || '') ? b.from : '2024-01-01') : null;
      return res.json(await ba.runFiles(files, { trigger: 'upload', user: u, apply: b.dryRun !== true, compareFrom }));
    }
    if (b.action === 'drive' || b.action === 'compare') {
      need('accounts.enter');
      const compareFrom = b.action === 'compare' ? (/^\d{4}-\d{2}-\d{2}$/.test(b.from || '') ? b.from : '2024-01-01') : null;
      if (process.env.STMT_FIXTURE_DIR && process.env.VERCEL !== '1') { // local tests only
        const fs = require('fs'), dir = process.env.STMT_FIXTURE_DIR;
        return res.json(await ba.runFiles(fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx')).map((f) => ({ name: f, buffer: fs.readFileSync(dir + '/' + f) })), { trigger: 'drive', user: u, compareFrom }));
      }
      return res.json(await ba.runFromDrive({ trigger: 'drive', user: u, compareFrom }));
    }
    if (b.action === 'settings') {
      need('accounts.manage');
      const v = {};
      if (b.statement_start != null) { if (!/^\d{4}-\d{2}-\d{2}$/.test(b.statement_start)) throw fail(400, 'Enter the date lines are checked from.'); v.statement_start = b.statement_start; }
      if (b.statement_folders != null) v.statement_folders = String(b.statement_folders).split(/[\s,]+/).map((x) => (x.match(/folders\/([\w-]{10,})/) || [null, x])[1]).filter((x) => /^[\w-]{10,}$/.test(x)).join(',');
      for (const k of ['pdc_to', 'pdc_cc']) if (b[k] != null) v[k] = String(b[k]).split(/[\s,;]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)).join(', ');
      await db.tx(async (t) => {
        for (const [k, val] of Object.entries(v)) await t.q('insert into acc_settings (book, key, value) values ($1, $2, $3) on conflict (book, key) do update set value = excluded.value', ['signature', k, val]);
        await audit.record(t.q, { user: u, action: 'settings', entity: 'bank-auto', entityId: 'signature', after: v });
      });
      return res.json({ ok: true, settings: await settings() });
    }
    if (b.action === 'pdc-send') {
      need('accounts.manage');
      return res.json(await pdc.send({ user: u }));
    }
    throw fail(400, 'Unknown action.');
  },
});
