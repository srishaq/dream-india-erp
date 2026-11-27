// Feasibility of a project (lib/feasibility.js): FSI and TDR, rehab and sale areas, costs, revenue, margin and the call.
// GET  ?project=ID                         → { project, rules, list, canEdit, canRules }
// GET  ?project=ID&id=X                    → { option, result } one option with its figures worked out
// GET  ?project=ID&id=X&pdf=1 | &excel=1   → { name, data } the report (base64)
// GET  ?project=ID&from=project            → { inputs, said } figures taken from the project's own screens
// POST { project, action: 'calc', inputs }               work the figures out, nothing saved
// POST { project, action: 'save', id?, name, inputs }    add an option, or change one
// POST { project, action: 'copy', id } · { action: 'delete', id }
// POST { project, action: 'rules', assume }              the company's own starting figures for the project's state (Admin)
// A new opportunity (no project yet) works the same way with site=ID in place of project=ID, and:
// GET  ?sites=1                                       → { sites, states, canEdit } the opportunities with their options
// POST { action: 'site-save', id?, name, kind, state, city, notes } · { action: 'site-delete', id }
// POST { action: 'site-link', id, project }           "Convert to project": its options move to the new project
const { route, fail } = require('../lib/http');
const auth = require('../lib/auth');
const db = require('../lib/db');
const audit = require('../lib/audit');
const F = require('../lib/feasibility');
const REP = require('../lib/feasibility-report');

// Dream India ERP (from Zuri, 27 Nov 2026): Management and the Admin
const STATES = ['Maharashtra', 'Telangana', 'Andhra Pradesh', 'Karnataka', 'Gujarat', 'Goa', 'Tamil Nadu', 'Kerala', 'Delhi', 'Uttar Pradesh', 'Madhya Pradesh', 'Rajasthan', 'West Bengal', 'Haryana', 'Punjab'];
const may = (u) => { if (!['masters.edit', 'mgmt.view'].some((x) => auth.has(u, x))) throw fail(403, 'Your role does not allow this.'); };
async function load(req, res, projectId, siteId) {
  const u = await auth.guard(req, res, null); if (!u) return {};
  may(u);
  if (siteId) return { u, p: await F.site(siteId) };
  if (!auth.inProject(u, projectId)) throw fail(403, 'Your login does not include this project.');
  const p = await F.project(projectId);
  if (p.sample) await sampleTopUp(u, p);
  return { u, p };
}
// a sample project gets its sample options the first time this screen opens (also for samples loaded before it)
async function sampleTopUp(u, p) {
  const k = await db.one("select value from settings where key = 'feas_sample'");
  const done = (k && Array.isArray(k.value) ? k.value : []).map(Number);
  if (done.includes(p.id)) return;
  await db.tx(async (t) => {
    const n = await t.one('select count(*)::int as n from feasibility where project_id = $1', [p.id]);
    if (!n.n) await F.sample(t, u, p);
    await t.q("insert into settings (key, value) values ('feas_sample', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify([...done, p.id])]);
  });
}
const canEdit = (u) => auth.has(u, 'masters.edit') || auth.has(u, 'mgmt.view');
const pub = (p) => ({ id: p.id, name: p.name, code: p.code, kind: p.kind, state: p.state, site: !!p.site, city: p.city || null, project_id: p.project_id || null });
async function out(res, u, p, extra = {}) {
  const { rules, list } = await F.list(p);
  return res.json({ project: pub(p), rules, prem: F.forKind(p.kind).map(([k, l]) => [k, l]), list, canEdit: canEdit(u), canRules: auth.has(u, 'masters.edit'), canConvert: auth.has(u, 'masters.edit'), ...extra });
}
const result = (p, inputs, rules) => {
  const R = F.compute(p.kind, inputs, rules); Object.assign(R, { verdict: F.VERDICT[R.status], why: F.why(R) });
  return { ...R, sections: REP.sections(p, { inputs }, R, rules).slice(1) };
};

module.exports = route({
  async GET(req, res) {
    if (req.query.sites) {
      const u = await auth.guard(req, res, null); if (!u) return; may(u);
      return res.json({ sites: await F.sites(), states: STATES, home: 'Maharashtra', canEdit: canEdit(u) });
    }
    const { u, p } = await load(req, res, req.query.project, req.query.site); if (!u) return;
    if (req.query.from === 'project') return res.json(await F.fromProject(p));
    if (req.query.id) {
      const x = await F.one(p, req.query.id), rules = await F.rules(p.state, db.one, p.kind);
      const R = result(p, x.inputs, rules);
      const by = x.updated_by || x.created_by ? await db.one('select name from users where id = $1', [x.updated_by || x.created_by]) : null;
      const opt = { id: x.id, name: x.name, inputs: x.inputs, updated_at: x.updated_at || x.created_at, by: by ? by.name : '' };
      if (req.query.pdf) {
        const co = await db.one('select name from companies order by id limit 1').catch(() => null);
        const who = { name: co ? co.name : 'Dream India', logo: null };
        return res.json({ name: REP.fileName(p, x, 'pdf'), data: REP.pdf(p, opt, R, rules, who).toString('base64') });
      }
      if (req.query.excel) return res.json({ name: REP.fileName(p, x, 'xlsx'), data: REP.xlsx(p, opt, R, rules).toString('base64') });
      return res.json({ option: opt, result: R });
    }
    return out(res, u, p);
  },
  async POST(req, res, b) {
    if (/^site-/.test(b.action || '')) {
      const u = await auth.guard(req, res, null); if (!u) return; may(u);
      if (!canEdit(u)) throw fail(403, 'Your role can see opportunities but not change them.');
      let id = +b.id || null;
      await db.tx(async (t) => {
        const before = id ? await t.one('select * from feas_sites where id = $1 and active', [id]) : null;
        if (id && !before) throw fail(404, 'This opportunity is not in the ERP.');
        if (b.action === 'site-save') {
          const v = F.cleanSite(b);
          const after = id ? await t.one('update feas_sites set name = $2, kind = $3, state = $4, city = $5, notes = $6, updated_at = now() where id = $1 returning *', [id, v.name, v.kind, v.state, v.city, v.notes])
            : await t.one('insert into feas_sites (name, kind, state, city, notes, created_by) values ($1, $2, $3, $4, $5, $6) returning *', [v.name, v.kind, v.state, v.city, v.notes, u.id]);
          id = after.id;
          await audit.record(t.q, { user: u, entity: 'feas_site', entityId: id, action: before ? 'update' : 'create', before, after, note: `Opportunity "${v.name}" ${before ? 'changed' : 'added'}` });
        } else if (b.action === 'site-delete') {
          if (!before) throw fail(400, 'Choose the opportunity.');
          await t.q('update feas_sites set active = false, updated_at = now() where id = $1', [id]);
          await t.q('delete from feasibility where site_id = $1', [id]);
          await audit.record(t.q, { user: u, entity: 'feas_site', entityId: id, action: 'delete', before, note: `Opportunity "${before.name}" removed` });
        } else if (b.action === 'site-link') {
          if (!before) throw fail(400, 'Choose the opportunity.');
          if (before.project_id) throw fail(400, 'This opportunity is already a project.');
          const pid = +b.project || 0;
          if (!auth.inProject(u, pid)) throw fail(403, 'Your login does not include that project.');
          const pr = await t.one('select id, name, kind from projects where id = $1 and active', [pid]);
          if (!pr) throw fail(404, 'That project is not in the ERP.');
          const moved = await t.q('update feasibility set project_id = $2, site_id = null, updated_at = now() where site_id = $1 returning id', [id, pid]);
          await t.q('update feas_sites set project_id = $2, updated_at = now() where id = $1', [id, pid]);
          await audit.record(t.q, { user: u, entity: 'feas_site', entityId: id, projectId: pid, action: 'convert', before, note: `Opportunity "${before.name}" became the project ${pr.name}: ${moved.length} feasibility option${moved.length === 1 ? '' : 's'} moved` });
        } else throw fail(400, 'Unknown action.');
      });
      return res.json({ ok: true, id, sites: await F.sites() });
    }
    const { u, p } = await load(req, res, b.project, b.site); if (!u) return;
    if (b.action === 'calc') return res.json({ result: result(p, F.cleanInputs(b.inputs), await F.rules(p.state, db.one, p.kind)) });
    if (b.action === 'rules') {
      if (!auth.has(u, 'masters.edit')) throw fail(403, 'Only the Admin changes the company\'s starting figures.');
      const key = p.state || '-';
      await db.tx(async (t) => {
        const s = await t.one("select value from settings where key = 'feas_rules'");
        const all = s && s.value && typeof s.value === 'object' ? { ...s.value } : {};
        const before = all[key] || {};
        const a = F.cleanInputs({ assume: b.assume }).assume || {};
        const keep = Object.fromEntries(Object.entries(a).filter(([k]) => k in F.BASE));
        all[key] = keep;
        await t.q("insert into settings (key, value) values ('feas_rules', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(all)]);
        await audit.record(t.q, { user: u, entity: 'feasibility', projectId: p.site ? null : p.id, action: 'rules', before, after: keep, note: `Feasibility starting figures for ${p.state || 'the company'} changed` });
      });
      return out(res, u, p);
    }
    if (!canEdit(u)) throw fail(403, 'Your role can see the feasibility but not change it.');
    const rec = (t, x) => audit.record(t.q, { user: u, entity: 'feasibility', projectId: p.site ? null : p.id, ...x, note: (p.site ? `Opportunity ${p.name}: ` : '') + (x.note || '') });
    let id = null;
    if (b.action === 'save') {
      await db.tx(async (t) => { const { before, after } = await F.save(t, u, p, b); id = after.id; await rec(t, { action: before ? 'update' : 'create', entityId: after.id, before, after, note: `Feasibility "${after.name}" ${before ? 'changed' : 'added'}` }); });
    } else if (b.action === 'copy') {
      await db.tx(async (t) => {
        const x = await F.one(p, b.id, t.one);
        const { after } = await F.save(t, u, p, { name: (x.name.replace(/ \(copy( \d+)?\)$/, '') + ' (copy)').slice(0, 80), inputs: x.inputs }); id = after.id;
        await rec(t, { action: 'create', entityId: after.id, after, note: `Feasibility "${x.name}" copied` });
      });
    } else if (b.action === 'delete') {
      await db.tx(async (t) => {
        const before = await t.one(`delete from feasibility where id = $1 and ${F.own(p)} = $2 returning *`, [+b.id || 0, p.id]);
        if (!before) throw fail(404, `That option is not in this ${p.site ? 'opportunity' : 'project'}.`);
        await rec(t, { action: 'delete', entityId: before.id, before, note: `Feasibility "${before.name}" removed` });
      });
    } else throw fail(400, 'Unknown action.');
    return out(res, u, p, { saved: id });
  },
});
