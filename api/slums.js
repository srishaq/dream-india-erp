// Slum register of an SRA project (lib/slums.js).
// GET  ?project=ID            → { project, list, summary, need, labels, canEdit, canRent }
// GET  ?project=ID&excel=1    → { name, data } the register as Excel (base64)
// POST { project, action: 'save', tenantId, slum: { use, eligibility, consent, agreement_on, agreement_reg, vacated_on, rehab_unit, mobile, remark } }
const { route, fail } = require('../lib/http');
const auth = require('../lib/auth');
const db = require('../lib/db');
const audit = require('../lib/audit');
const book = require('../lib/book');
const S = require('../lib/slums');

// Management, the Admin and Accounts see it; Management, the Admin and Head Accounts change it. Rent shows to Accounts and Management.
const SEE = ['mgmt.view', 'masters.edit', 'accounts.view'], EDIT = ['mgmt.view', 'masters.edit', 'accounts.manage'], RENT = ['mgmt.view', 'accounts.view'];
const any = (u, ps) => ps.some((p) => auth.has(u, p));
async function load(req, res, ps, projectId) {
  const u = await auth.guard(req, res, null); if (!u) return {};
  if (!any(u, ps)) throw fail(403, 'Your role does not allow this.');
  if (!auth.inProject(u, +projectId || 0)) throw fail(403, 'Your login does not include this project.');
  const p = await db.one('select id, code, name, kind, active from projects where id = $1', [+projectId || 0]);
  if (!p || !p.active) throw fail(404, 'This project is not in the ERP.');
  if (p.kind !== 'sra') throw fail(409, `${p.name} is not an SRA scheme, so it has no slum register.`);
  return { u, p, bk: book.bookOfCode(p.code) };
}
async function viewFor(u, p, bk) {
  const canRent = any(u, RENT);
  const rent = canRent ? await book.run(bk, () => require('../lib/accounts').list('tenants', { limit: 2000 })).then((r) => r.rows).catch(() => null) : null;
  return { project: { id: p.id, name: p.name }, ...(await S.view(bk, rent)), canEdit: any(u, EDIT), canRent: !!rent };
}

module.exports = route({
  async GET(req, res) {
    const { u, p, bk } = await load(req, res, SEE, req.query.project); if (!u) return;
    const v = await viewFor(u, p, bk);
    if (req.query.excel) return res.json({ name: `${p.name.replace(/[^A-Za-z0-9]+/g, '-')}-slum-register.xlsx`, data: (await S.sheet(v, p.name)).toString('base64') });
    return res.json(v);
  },
  async POST(req, res, b) {
    const { u, p, bk } = await load(req, res, EDIT, b.project); if (!u) return;
    if (b.action !== 'save') throw fail(400, 'Unknown action.');
    await db.tx(async (t) => {
      const { before, after, tenant } = await S.save(t, u, bk, b.tenantId, b.slum && typeof b.slum === 'object' ? b.slum : {});
      await audit.record(t.q, { user: u, action: before ? 'update' : 'create', entity: 'slum', entityId: tenant.id, projectId: p.id, before, after, note: `Annexure no. ${Number(tenant.survey_no)} · ${tenant.name || ''}` });
    });
    return res.json(await viewFor(u, p, bk));
  },
});
