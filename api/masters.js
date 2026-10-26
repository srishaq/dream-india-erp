// Companies, projects, buildings and payment plans.
// GET: what the signed-in user's projects look like. POST (masters.edit): save a company, project or building.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { route, fail, str, intOr } = require('../lib/http');

const CODE = /^[A-Z0-9_-]{2,20}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const KINDS = ['sale', 'rehab', 'commercial', 'other'];

async function overview(u) {
  const all = auth.has(u, 'masters.edit');
  const companies = await db.q('select id, code, name, pan, gstin, active from companies order by name');
  const projects = (await db.q(`select p.id, p.code, p.name, p.company_id, c.name as company, p.location, p.rera_no, p.active
                                 from projects p join companies c on c.id = p.company_id order by p.name`))
    .filter((p) => all || u.projects.includes(p.id));
  const ids = projects.map((p) => p.id);
  const buildings = ids.length ? await db.q('select b.id, b.project_id, b.code, b.name, b.kind, b.floors, (select max(u.floor) from units u where u.building_id = b.id) as top_floor from buildings b where b.project_id = any($1::int[]) order by b.project_id, b.code', [ids]) : [];
  const plans = ids.length ? await db.q('select id, project_id, name, active from payment_plans where project_id = any($1::int[]) order by project_id, name', [ids]) : [];
  const stages = plans.length ? await db.q('select id, plan_id, seq, name, pct, construction_linked from plan_stages where plan_id = any($1::int[]) order by plan_id, seq', [plans.map((p) => p.id)]) : [];
  const units = ids.length ? await db.q('select project_id, status, count(*)::int as n from units where project_id = any($1::int[]) group by project_id, status', [ids]) : [];
  for (const p of projects) {
    p.buildings = buildings.filter((b) => b.project_id === p.id);
    p.plans = plans.filter((pl) => pl.project_id === p.id).map((pl) => ({ ...pl, stages: stages.filter((s) => s.plan_id === pl.id) }));
    p.units = Object.fromEntries(units.filter((x) => x.project_id === p.id).map((x) => [x.status, x.n]));
  }
  return { companies: all ? companies : companies.filter((c) => projects.some((p) => p.company_id === c.id)), projects };
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    return res.json(await overview(u));
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'masters.edit'); if (!u) return;
    const id = intOr(b.id);
    if (b.action === 'company.save') {
      const v = { code: str(b.code, 20).toUpperCase(), name: str(b.name, 120), pan: str(b.pan, 10).toUpperCase() || null, gstin: str(b.gstin, 15).toUpperCase() || null, active: b.active !== false };
      if (!CODE.test(v.code)) throw fail(400, 'Code: 2 to 20 capital letters or numbers, e.g. PRIME.');
      if (!v.name) throw fail(400, 'Enter the company name.');
      if (v.pan && !PAN.test(v.pan)) throw fail(400, 'PAN should look like ABCDE1234F.');
      if (v.gstin && !GSTIN.test(v.gstin)) throw fail(400, 'GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5.');
      await db.tx(async (t) => {
        if (id) {
          const before = await t.one('select code, name, pan, gstin, active from companies where id = $1', [id]);
          if (!before) throw fail(404, 'Company not found.');
          await t.q('update companies set code = $2, name = $3, pan = $4, gstin = $5, active = $6 where id = $1', [id, v.code, v.name, v.pan, v.gstin, v.active]);
          await audit.record(t.q, { user: u, action: 'update', entity: 'company', entityId: id, before, after: v });
        } else {
          const row = await t.one('insert into companies (code, name, pan, gstin, active) values ($1, $2, $3, $4, $5) returning id', [v.code, v.name, v.pan, v.gstin, v.active]);
          await audit.record(t.q, { user: u, action: 'create', entity: 'company', entityId: row.id, after: v });
        }
      });
      return res.json({ ok: true, ...(await overview(u)) });
    }
    if (b.action === 'project.save') {
      const v = { code: str(b.code, 20).toUpperCase(), name: str(b.name, 120), company_id: intOr(b.companyId), location: str(b.location, 160) || null, rera_no: str(b.reraNo, 40) || null, active: b.active !== false };
      if (!CODE.test(v.code)) throw fail(400, 'Code: 2 to 20 capital letters or numbers, e.g. SIGNATURE.');
      if (!v.name) throw fail(400, 'Enter the project name.');
      if (!v.company_id) throw fail(400, 'Choose the company that owns the project.');
      await db.tx(async (t) => {
        if (id) {
          const before = await t.one('select code, name, company_id, location, rera_no, active from projects where id = $1', [id]);
          if (!before) throw fail(404, 'Project not found.');
          await t.q('update projects set code = $2, name = $3, company_id = $4, location = $5, rera_no = $6, active = $7 where id = $1', [id, v.code, v.name, v.company_id, v.location, v.rera_no, v.active]);
          await audit.record(t.q, { user: u, action: 'update', entity: 'project', entityId: id, projectId: id, before, after: v });
        } else {
          const row = await t.one('insert into projects (code, name, company_id, location, rera_no, active) values ($1, $2, $3, $4, $5, $6) returning id', [v.code, v.name, v.company_id, v.location, v.rera_no, v.active]);
          await audit.record(t.q, { user: u, action: 'create', entity: 'project', entityId: row.id, projectId: row.id, after: v });
        }
      });
      return res.json({ ok: true, ...(await overview(u)) });
    }
    if (b.action === 'building.save') {
      const v = { project_id: intOr(b.projectId), code: str(b.code, 20).toUpperCase(), name: str(b.name, 80), kind: KINDS.includes(b.kind) ? b.kind : 'sale', floors: intOr(b.floors) };
      if (!v.project_id) throw fail(400, 'Choose the project.');
      if (!CODE.test(v.code) && !/^[A-Z0-9]{1,20}$/.test(v.code)) throw fail(400, 'Code: letters or numbers, e.g. A or REHAB.');
      if (!v.name) throw fail(400, 'Enter the building or wing name.');
      if (v.floors != null && (v.floors < 0 || v.floors > 150)) throw fail(400, 'Floors should be between 0 and 150.');
      await db.tx(async (t) => {
        if (id) {
          const before = await t.one('select project_id, code, name, kind, floors from buildings where id = $1', [id]);
          if (!before) throw fail(404, 'Building not found.');
          await t.q('update buildings set code = $2, name = $3, kind = $4, floors = $5 where id = $1', [id, v.code, v.name, v.kind, v.floors]);
          await audit.record(t.q, { user: u, action: 'update', entity: 'building', entityId: id, projectId: before.project_id, before, after: v });
        } else {
          const row = await t.one('insert into buildings (project_id, code, name, kind, floors) values ($1, $2, $3, $4, $5) returning id', [v.project_id, v.code, v.name, v.kind, v.floors]);
          await audit.record(t.q, { user: u, action: 'create', entity: 'building', entityId: row.id, projectId: v.project_id, after: v });
        }
      });
      return res.json({ ok: true, ...(await overview(u)) });
    }
    throw fail(400, 'Unknown action.');
  },
});
