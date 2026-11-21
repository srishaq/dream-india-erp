// CA page data (GST, TDS payable, RERA quarterly, cash flow statement, compliance, customer TDS, non-revenue receipts),
// worked out from the ERP's accounts. ?detail=1 returns the receipts and payments rows behind the figures.
// ?rera=<quarter end> is the MahaRERA filings panel (lib/rera.js); &file=xlsx|form1|form2|form3 downloads the Excel
// working or a Word draft. POST {action:'rera-settings'|'rera-heads'|'rera-send'} needs Head Accounts or Admin.
const auth = require('../lib/auth');
const ca = require('../lib/ca-data');
const audit = require('../lib/audit');
const db = require('../lib/db');
const { route, fail } = require('../lib/http');
const { has } = require('../lib/roles');

let cache = { at: 0, model: null, detail: null };
const TTL_MS = 60 * 1000;
const QE = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
const canEdit = (u) => has(u, 'accounts.manage') || u.role === 'admin';

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ca.view'); if (!u) return;
    const q = req.query || {};
    if (q.rera != null) {
      const R = require('../lib/rera');
      const qe = QE.test(q.rera) ? q.rera : R.quarterEnds()[0];
      if (q.file) {
        const M = await R.build(qe);
        const X = 'application/vnd.openxmlformats-officedocument.';
        if (q.file === 'xlsx') { res.setHeader('Content-Type', X + 'spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${R.fileName(M, 'working', 'xlsx')}"`); return res.end(R.excel(M)); }
        const F = R.FORMS[String(q.file).replace('form', '')];
        if (!F) throw fail(400, 'Unknown file.');
        res.setHeader('Content-Type', X + 'wordprocessingml.document'); res.setHeader('Content-Disposition', `attachment; filename="${R.fileName(M, F.file, 'docx')}"`);
        return res.end(F.fn(M));
      }
      return res.json({ ...(await R.status(qe)), can: { edit: canEdit(u) }, live: process.env.ERP_LIVE === '1' });
    }
    if (q.refresh === '1' || !cache.model || Date.now() - cache.at > TTL_MS) {
      const { summary, detail } = await ca.model();
      cache = { at: Date.now(), model: { ...summary, readAt: new Date().toISOString() }, detail };
    }
    // the model is shared for a minute; who is looking is added to each response, never kept in the cache
    return res.json(q.detail === '1' ? { ...cache.detail, readAt: cache.model.readAt } : { ...cache.model, user: { name: u.name, role: u.roleLabel || u.role } });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'ca.view'); if (!u) return;
    if (!canEdit(u)) throw fail(403, 'Only Head Accounts or Admin can change the RERA settings or send the pack.');
    const R = require('../lib/rera');
    if (b.action === 'rera-settings') {
      const cur = await R.settings(), v = b.settings && typeof b.settings === 'object' ? b.settings : {};
      const num = (x) => { const s = String(x == null ? '' : x).replace(/[,₹\s]/g, ''); return s === '' ? null : Number.isFinite(+s) ? +s : null; };
      const txt = (x, max = 400) => String(x == null ? '' : x).trim().slice(0, max);
      const obj = (src, keys) => Object.fromEntries(keys.map((k) => [k, txt(src && src[k])]));
      const next = { ...cur };
      for (const k of ['regNo', 'project', 'promoter', 'promoterAddress', 'plot', 'buildingLabel', 'ccNote']) if (v[k] != null) next[k] = txt(v[k], 1000);
      if (v.architect) next.architect = obj(v.architect, ['name', 'license', 'email']);
      if (v.engineer) next.engineer = obj(v.engineer, ['firm', 'name', 'license', 'email']);
      if (v.ca) next.ca = obj(v.ca, ['firm', 'name', 'membership', 'frn', 'email']);
      if (v.designated) next.designated = obj(v.designated, ['bank', 'accountNo', 'bankName', 'ifsc']);
      if (Array.isArray(v.collection)) next.collection = v.collection.map((x) => txt(x, 120)).filter(Boolean);
      if (Array.isArray(v.otherRera)) next.otherRera = v.otherRera.map((x) => txt(x, 120)).filter(Boolean);
      if (v.estimate) next.estimate = Object.fromEntries(R.LINES.map((l) => [l.key, num(v.estimate[l.key])]).filter(([, x]) => x));
      if (v.baseline) {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(v.baseline.date || '') ? v.baseline.date : cur.baseline.date;
        next.baseline = { date: d, label: txt(v.baseline.label || cur.baseline.label, 120), withdrawn: num(v.baseline.withdrawn) || 0,
          incurred: v.baseline.incurred ? Object.fromEntries(R.LINES.map((l) => [l.key, num(v.baseline.incurred[l.key])]).filter(([, x]) => x)) : cur.baseline.incurred };
      }
      if (v.finance) next.finance = Object.fromEntries(['ownEstimated', 'securedEstimated', 'unsecuredEstimated', 'customerEstimated'].map((k) => [k, num(v.finance[k]) || 0]));
      if (v.engineerEstimate) next.engineerEstimate = { building: num(v.engineerEstimate.building) || 0, external: num(v.engineerEstimate.external) || 0 };
      for (const k of ['rrPerSqm', 'depositPct', 'letterheadCm']) if (v[k] != null && num(v[k]) != null) next[k] = num(v[k]);
      if (v.form1) next.form1 = { date: txt(v.form1.date, 10), a: (v.form1.a || []).slice(0, 11).map(num), b: (v.form1.b || []).slice(0, 14).map(num) };
      if (Array.isArray(v.comments)) next.comments = v.comments.map((x) => txt(x, 2000)).filter(Boolean);
      if (v.autoSend != null) next.autoSend = !!v.autoSend;
      await R.saveSettings(next);
      await audit.record(db.q, { user: u, action: 'update', entity: 'settings', entityId: 'rera_signature', before: cur, after: next });
      return res.json({ ok: true });
    }
    if (b.action === 'rera-heads') {
      // { heads: { 'Cash flow head': 'constr' | 'exclude' | '' } } puts heads on a Form 3 line ('' takes the choice off)
      const cur = await R.headMap(), next = { ...cur }, ok = new Set([...R.LINES.map((l) => l.key), 'exclude']);
      for (const [h, line] of Object.entries(b.heads || {})) { const k = String(h).slice(0, 300); if (!line) delete next[k]; else if (ok.has(line)) next[k] = line; }
      await R.saveHeadMap(next);
      await audit.record(db.q, { user: u, action: 'update', entity: 'settings', entityId: 'rera_head_map', before: null, after: b.heads || {} });
      return res.json({ ok: true, count: Object.keys(next).length });
    }
    if (b.action === 'rera-send') {
      const r = await R.send({ qe: QE.test(b.quarter || '') ? b.quarter : undefined, force: true, user: u });
      if (r.skipped) throw fail(400, r.skipped);
      return res.json({ ok: true, ...r });
    }
    throw fail(400, 'Unknown action.');
  },
});
