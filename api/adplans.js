// AI Meta ad plans (Sales & Marketing → Campaigns → AI ad plans). See lib/ad-plans.js.
const { route, fail, intOr, str } = require('../lib/http');
const db = require('../lib/db');
const auth = require('../lib/auth');
const roles = require('../lib/roles');
const audit = require('../lib/audit');
const P = require('../lib/ad-plans');
const isApprover = (u) => require('../lib/changes').isApprover(u);

async function who(req, perm) {
  const u = await auth.session(req); if (!u) throw fail(401, 'Sign in again.');
  if (perm && !roles.has(u, perm) && !isApprover(u)) throw fail(403, 'Not allowed.');
  return u;
}
module.exports = route({
  async GET(req, res) {
    const u = await who(req, 'marketing.view');
    if (req.query.file) {
      const f = await db.one('select mime, data from ad_plan_files where id = $1', [intOr(req.query.file)]); if (!f) throw fail(404, 'Not found.');
      res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, max-age=3600'); return res.status(200).end(f.data);
    }
    const S = require('../lib/social'), st = await S.status().catch(() => ({ meta: {} }));
    const set = (await db.one("select value from settings where key = 'adplans'"))?.value || {};
    return res.json({ rows: await P.list(req.query.project), canApprove: isApprover(u), canEdit: roles.has(u, 'marketing.edit') || isApprover(u),
      meta: { connected: !!(st.meta && st.meta.connected), ads: (st.meta && st.meta.ads) || [], pages: (st.meta && st.meta.pages) || [] }, settings: set, ai: !!process.env.ANTHROPIC_API_KEY });
  },
  async POST(req, res, b) {
    const a = b.action, id = intOr(b.id);
    if (a === 'generate') { const u = await who(req, 'marketing.edit'); const r = await P.generate(u, { projectId: b.projectId, brief: b.brief || {} }); await audit.record(db.q, { user: u, action: 'adplan-generate', entity: 'ad-plan', entityId: r.id, after: b.brief }); return res.json(r); }
    if (a === 'edit') { const u = await who(req, 'marketing.edit'); await P.edit(u, id, b.plan); await audit.record(db.q, { user: u, action: 'adplan-edit', entity: 'ad-plan', entityId: id }); return res.json({ ok: true }); }
    if (a === 'file') { const u = await who(req, 'marketing.edit'); const r = await P.addFile(id, { name: b.name, data: b.data }); await audit.record(db.q, { user: u, action: 'adplan-design', entity: 'ad-plan', entityId: id }); return res.json(r); }
    if (a === 'decide') { const u = await who(req); const r = await P.decide(u, id, !!b.approve, b.note); await audit.record(db.q, { user: u, action: b.approve ? 'adplan-approve' : 'adplan-reject', entity: 'ad-plan', entityId: id, note: str(b.note, 300) || null }); return res.json(r); }
    if (a === 'launch') { const u = await who(req, 'marketing.edit'); const r = await P.launch(u, id); await audit.record(db.q, { user: u, action: 'adplan-launch', entity: 'ad-plan', entityId: id, after: r.meta }); return res.json(r); }
    if (a === 'golive' || a === 'pause') { const u = await who(req); const r = await P.goLive(u, id, a === 'golive'); await audit.record(db.q, { user: u, action: 'adplan-' + a, entity: 'ad-plan', entityId: id }); return res.json(r); }
    if (a === 'settings') {
      const u = await who(req, 'marketing.edit');
      const v = { adAccount: str(b.adAccount, 40) || null, pageId: str(b.pageId, 40) || null, privacyUrl: str(b.privacyUrl, 300) || null, siteUrl: str(b.siteUrl, 300) || null };
      for (const k of ['privacyUrl', 'siteUrl']) if (v[k] && !/^https:\/\//.test(v[k])) throw fail(400, 'Links must start with https://');
      await db.q("insert into settings (key, value) values ('adplans', $1) on conflict (key) do update set value = excluded.value", [v]);
      await audit.record(db.q, { user: u, action: 'adplan-settings', entity: 'settings', entityId: null, after: v });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
