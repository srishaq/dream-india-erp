// Management dashboard: the key figures of every department on one screen. Admin and Management only.
// GET ?project=ID (default: Dream Signature)
const auth = require('../lib/auth');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { route, fail, intOr } = require('../lib/http');
const mgmt = require('../lib/mgmt');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'mgmt.view')) throw fail(403, 'The Management dashboard is for Admin and Management logins.');
    const p = intOr(req.query.project);
    const projectId = p ? needProject(u, p) : undefined;
    return res.json(await mgmt.build({ projectId }));
  },
  // the limits for "Needs your attention" (days, amounts)
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'mgmt.view')) throw fail(403, 'The Management dashboard is for Admin and Management logins.');
    const sa = require('../lib/staff-alerts');
    // the 10 am message: see it, change its WhatsApp templates or switch it off, send it now
    if (b.action === 'summary') return res.json({ ok: true, settings: await sa.settings(), summary: await sa.buildSummary(), to: (await sa.bosses()).map((p) => ({ name: p.name, email: p.email || '', phone: p.phone || '' })), approvers: (await sa.approvers()).map((p) => ({ name: p.name, email: p.email || '', phone: p.phone || '' })), live: process.env.ERP_LIVE === '1' });
    if (b.action === 'summary-settings') { if (u.role !== 'admin') throw fail(403, 'Only the Admin can change this.'); return res.json({ ok: true, settings: await sa.saveSettings(b.settings || {}) }); }
    if (b.action === 'summary-send') return res.json({ ok: true, result: await sa.sendSummary({ trigger: 'manual', force: true }) });
    if (b.action !== 'alerts') throw fail(400, 'Unknown action.');
    return res.json({ ok: true, limits: await mgmt.saveAlertLimits(b.limits || {}) });
  },
});
