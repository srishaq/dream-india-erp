// Land and title (lib/land.js): a project's land parcels, deeds, land cost, payments to owners, title papers and
// the landowner's share under a JDA.
// GET  ?project=ID                 → { project, labels, parcels, free, summary, canEdit }
// GET  ?project=ID&excel=1         → { name, data } the parcels as Excel (base64), to fill in and upload
// GET  ?project=ID&file=ID         → { name, type, data } one paper
// POST { project, action: 'save', parcel: {...} }   add a parcel, or change one (with its id)
// POST { project, action: 'delete', id }            a parcel added by mistake (no payments, no landowner flats)
// POST { project, action: 'pay', parcel, paid_on, amount, payee, mode, ref, note } · { action: 'unpay', id }
// POST { project, action: 'file.add', parcel, file: { name, data, kind } } · { action: 'file.remove', id }
// POST { project, action: 'share', parcel, units: [ids], owner } · { action: 'unshare', id }   landowner's flats
// POST { project, action: 'import', file: { name, data } }
const { route, fail } = require('../lib/http');
const auth = require('../lib/auth');
const db = require('../lib/db');
const audit = require('../lib/audit');
const L = require('../lib/land');
const { parseFile } = require('../lib/sheetfile');

async function load(req, res, projectId) {
  const u = await auth.guard(req, res, null); if (!u) return {};
  if (!['mgmt.view', 'accounts.view', 'masters.edit'].some((x) => auth.has(u, x))) throw fail(403, 'Your role does not allow this.');
  if (!auth.inProject(u, projectId)) throw fail(403, 'Your login does not include this project.');
  return { u, p: await L.project(projectId) };
}
const out = async (res, u, p, extra = {}) => res.json({ ...(await L.view(p)), canEdit: auth.has(u, 'masters.edit') || auth.has(u, 'accounts.manage'), ...extra });
const slug = (s) => String(s || 'project').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';
const rup = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

module.exports = route({
  async GET(req, res) {
    const { u, p } = await load(req, res, req.query.project); if (!u) return;
    if (req.query.excel) return res.json({ name: `${slug(p.code || p.name)}-land.xlsx`, data: (await L.sheet(p)).toString('base64') });
    if (req.query.file) {
      const f = await db.one('select f.name, f.type, f.data from land_files f join land_parcels l on l.id = f.parcel_id where f.id = $1 and l.project_id = $2', [+req.query.file || 0, p.id]);
      if (!f) throw fail(404, 'That paper is not in this project.');
      return res.json(f);
    }
    return out(res, u, p);
  },
  async POST(req, res, b) {
    const { u, p } = await load(req, res, b.project); if (!u) return;
    // land money and title: the Admin, or Head Accounts
    if (!auth.has(u, 'masters.edit') && !auth.has(u, 'accounts.manage')) throw fail(403, 'Only the Admin or Head Accounts changes land records.');
    const rec = (t, x) => audit.record(t.q, { user: u, entity: 'land', projectId: p.id, ...x });
    if (b.action === 'save') {
      const x = b.parcel && typeof b.parcel === 'object' ? b.parcel : {};
      await db.tx(async (t) => {
        const { before, after } = await L.save(t, u, p, x);
        await rec(t, { action: before ? 'update' : 'create', entityId: after.id, before, after, note: `Survey ${after.survey_no}${after.village ? ', ' + after.village : ''}` });
      });
    } else if (b.action === 'delete') {
      await db.tx(async (t) => {
        const n = await t.one('select (select count(*) from land_payments where parcel_id = $1)::int as pays, (select count(*) from land_owner_units where parcel_id = $1)::int as units', [+b.id || 0]);
        if (n.pays || n.units) throw fail(409, 'This parcel has payments or landowner flats. Remove those first.');
        const before = await t.one('delete from land_parcels where id = $1 and project_id = $2 returning *', [+b.id || 0, p.id]);
        if (!before) throw fail(404, 'That land parcel is not in this project.');
        await rec(t, { action: 'delete', entityId: before.id, before, note: `Survey ${before.survey_no} removed` });
      });
    } else if (b.action === 'pay') {
      await db.tx(async (t) => {
        const { parcel, payment } = await L.pay(t, u, p, b);
        await rec(t, { action: 'paid', entityId: parcel.id, after: payment, note: `${rup(payment.amount)} paid for survey ${parcel.survey_no}${payment.payee ? ' to ' + payment.payee : ''}` });
      });
    } else if (b.action === 'unpay') {
      await db.tx(async (t) => {
        const before = await t.one('delete from land_payments y using land_parcels l where y.id = $1 and l.id = y.parcel_id and l.project_id = $2 returning y.*', [+b.id || 0, p.id]);
        if (!before) throw fail(404, 'That payment is not in this project.');
        await rec(t, { action: 'payment-removed', entityId: before.parcel_id, before, note: `Payment of ${rup(before.amount)} removed` });
      });
    } else if (b.action === 'file.add') {
      const f = L.file(b.file);
      await db.tx(async (t) => {
        const parcel = await t.one('select id, survey_no from land_parcels where id = $1 and project_id = $2', [+b.parcel || 0, p.id]);
        if (!parcel) throw fail(404, 'That land parcel is not in this project.');
        const n = await t.one('select count(*)::int as n from land_files where parcel_id = $1', [parcel.id]);
        if (n.n >= 30) throw fail(400, 'A parcel keeps at most 30 papers.');
        const r = await t.one('insert into land_files (parcel_id, kind, name, type, size, data, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id', [parcel.id, f.kind, f.name, f.type, f.size, f.data, u.id]);
        await rec(t, { action: 'file-added', entityId: parcel.id, after: { file: r.id, kind: f.kind, name: f.name }, note: `Survey ${parcel.survey_no}: ${L.FILE_KINDS[f.kind]} added` });
      });
    } else if (b.action === 'file.remove') {
      await db.tx(async (t) => {
        const f = await t.one('delete from land_files f using land_parcels l where f.id = $1 and l.id = f.parcel_id and l.project_id = $2 returning f.id, f.name, l.id as parcel_id, l.survey_no', [+b.id || 0, p.id]);
        if (!f) throw fail(404, 'That paper is not in this project.');
        await rec(t, { action: 'file-removed', entityId: f.parcel_id, before: { file: f.id, name: f.name }, note: `Survey ${f.survey_no}: ${f.name} removed` });
      });
    } else if (b.action === 'share') {
      await db.tx(async (t) => {
        const r = await L.share(t, u, p, b.parcel, b.units, b.owner);
        await rec(t, { action: 'landowner-share', entityId: r.parcel.id, after: { units: r.units.map((x) => x.unit_no) }, note: `Landowner's share (survey ${r.parcel.survey_no}): ${r.units.map((x) => x.unit_no).join(', ')}` });
      });
    } else if (b.action === 'unshare') {
      await db.tx(async (t) => {
        const r = await L.unshare(t, p, b.id);
        await rec(t, { action: 'landowner-release', entityId: r.unit_id, note: `${r.unit_no} released from the landowner's share (survey ${r.survey_no})` });
      });
    } else if (b.action === 'import') {
      const f = b.file && typeof b.file === 'object' ? b.file : {};
      const rows = parseFile(f.data, f.name, 1000);
      let r;
      await db.tx(async (t) => { r = await L.importRows(t, u, p, rows); await rec(t, { action: 'import', entityId: p.id, after: r, note: `Land from Excel: ${r.added} added, ${r.updated} updated` }); });
      return out(res, u, p, { imported: r });
    } else throw fail(400, 'Unknown action.');
    return out(res, u, p);
  },
});
