// Construction stages and demand runs.
// GET ?project=ID → stages done per building and the runs; GET ?run=ID → who the run will charge and how much.
// POST {action}: stage.complete, run.create, run.approve, run.cancel, settings.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, notOwn } = require('../lib/access');
const { raise, daysToPay, addDays, today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function overview(projectId) {
  const buildings = await db.q("select id, code, name, kind from buildings where project_id = $1 and kind <> 'rehab' order by code", [projectId]);
  const plan = await db.one('select id from payment_plans where project_id = $1 and active order by id limit 1', [projectId]);
  const stages = plan ? await db.q('select seq, name, pct from plan_stages where plan_id = $1 and construction_linked order by seq', [plan.id]) : [];
  const done = await db.q(`select c.id, c.building_id, c.stage_name, c.completed_on, c.certified_by, u.name as recorded_by,
      exists (select 1 from demands d join bookings bk on bk.id = d.booking_id join units un on un.id = bk.unit_id where un.building_id = c.building_id and d.stage_name = c.stage_name) as raised
    from stage_completions c join buildings b on b.id = c.building_id left join users u on u.id = c.recorded_by where b.project_id = $1`, [projectId]);
  const runs = await db.q(
    `select r.id, r.building_id, b.code as building, r.stage_name, r.demand_date, r.due_date, r.status, r.created_by, c.name as created_by_name, a.name as approved_by_name, r.approved_at,
            (select count(*)::int from demands d where d.run_id = r.id) as letters, (select coalesce(sum(d.amount), 0) from demands d where d.run_id = r.id) as total
       from demand_runs r left join buildings b on b.id = r.building_id left join users c on c.id = r.created_by left join users a on a.id = r.approved_by
      where r.project_id = $1 order by r.created_at desc`, [projectId]);
  const days = await daysToPay(db);
  return { buildings, stages, done, runs, daysToPay: days };
}

// Active bookings in the run's building that do not yet have this stage demanded.
async function eligible(run) {
  return db.q(
    `select b.id as booking_id, u.unit_no, b.agreement_value, s.pct,
            round(b.agreement_value * s.pct / 100, 2) as amount, round(round(b.agreement_value * s.pct / 100, 2) * b.gst_rate / 100, 2) as gst,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers
       from bookings b join units u on u.id = b.unit_id join plan_stages s on s.plan_id = b.plan_id and s.name = $2
      where u.building_id = $1 and b.status = 'active'
        and not exists (select 1 from demands d where d.booking_id = b.id and d.stage_name = $2)
      order by u.unit_no`, [run.building_id, run.stage_name]);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!['demand.raise', 'demand.approve', 'stage.record', 'ledger.view'].some((p) => has(u, p))) return res.status(403).json({ error: 'Your role does not allow this.' });
    if (req.query.run) {
      const run = await db.one('select r.*, b.code as building from demand_runs r left join buildings b on b.id = r.building_id where r.id = $1', [intOr(req.query.run)]);
      if (!run) throw fail(404, 'Run not found.');
      needProject(u, run.project_id);
      const rows = run.status === 'draft' ? await eligible(run)
        : await db.q(`select d.booking_id, u.unit_no, d.pct, d.amount, d.gst, (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = d.booking_id) as buyers
                        from demands d join bookings b on b.id = d.booking_id join units u on u.id = b.unit_id where d.run_id = $1 order by u.unit_no`, [run.id]);
      return res.json({ run, rows });
    }
    const pid = needProject(u, intOr(req.query.project));
    const o = await overview(pid);
    if (has(u, 'ledger.view')) o.schedule = await require('../lib/dashboard').schedule(pid);
    return res.json(o);
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };

    if (b.action === 'stage.complete') {
      need('stage.record');
      const bld = await db.one('select id, project_id, code from buildings where id = $1', [intOr(b.buildingId)]);
      if (!bld) throw fail(404, 'Building not found.');
      needProject(u, bld.project_id);
      const stage = await db.one('select s.name from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active and s.construction_linked and s.name = $2 limit 1', [bld.project_id, str(b.stageName, 120)]);
      if (!stage) throw fail(400, 'Choose a construction stage from the payment plan.');
      const on = DATE.test(b.completedOn || '') ? b.completedOn : null;
      if (!on || on > today()) throw fail(400, 'Enter the date the stage was completed (not in the future).');
      await db.tx(async (t) => {
        const row = await t.one('insert into stage_completions (building_id, stage_name, completed_on, certified_by, recorded_by) values ($1, $2, $3, $4, $5) returning id', [bld.id, stage.name, on, str(b.certifiedBy, 120) || null, u.id]);
        await audit.record(t.q, { user: u, action: 'stage-complete', entity: 'stage', entityId: row.id, projectId: bld.project_id, after: { building: bld.code, stage: stage.name, completedOn: on, certifiedBy: str(b.certifiedBy, 120) || null } });
      });
      return res.json({ ok: true, ...(await overview(bld.project_id)) });
    }

    // A stage recorded by mistake: removed only while no demand has been raised on it for that building. Any draft run
    // for it is cancelled. The audit log keeps what was removed and by whom.
    if (b.action === 'stage.undo') {
      if (!has(u, 'stage.record') && !has(u, 'demand.approve')) throw fail(403, 'Your role does not allow this.');
      const sc = await db.one('select c.*, bl.project_id, bl.code from stage_completions c join buildings bl on bl.id = c.building_id where c.id = $1', [intOr(b.id)]);
      if (!sc) throw fail(404, 'That stage record is not there.');
      needProject(u, sc.project_id);
      const raised = await db.one(`select count(*)::int as n from demands d join bookings bk on bk.id = d.booking_id join units un on un.id = bk.unit_id
        where un.building_id = $1 and d.stage_name = $2`, [sc.building_id, sc.stage_name]);
      const approved = await db.one("select count(*)::int as n from demand_runs where building_id = $1 and stage_name = $2 and status = 'approved'", [sc.building_id, sc.stage_name]);
      if (raised.n || approved.n) throw fail(409, `Demands have already been raised on this stage for ${sc.code} Wing (${raised.n}), so it cannot be removed.`);
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Give the reason (e.g. recorded by mistake, a test).');
      await db.tx(async (t) => {
        const runs = await t.q("update demand_runs set status = 'cancelled' where building_id = $1 and stage_name = $2 and status = 'draft' returning id", [sc.building_id, sc.stage_name]);
        await t.q('delete from stage_completions where id = $1', [sc.id]);
        await audit.record(t.q, { user: u, action: 'stage-undo', entity: 'stage', entityId: sc.id, projectId: sc.project_id, before: { building: sc.code, stage: sc.stage_name, completedOn: sc.completed_on, certifiedBy: sc.certified_by }, after: { draftRunsCancelled: runs.map((r) => r.id) }, note: reason });
      });
      return res.json({ ok: true, ...(await overview(sc.project_id)) });
    }

    if (b.action === 'run.create') {
      need('demand.raise');
      const bld = await db.one('select id, project_id, code from buildings where id = $1', [intOr(b.buildingId)]);
      if (!bld) throw fail(404, 'Building not found.');
      needProject(u, bld.project_id);
      const stageName = str(b.stageName, 120);
      const done = await db.one('select completed_on from stage_completions where building_id = $1 and stage_name = $2', [bld.id, stageName]);
      if (!done) throw fail(400, 'Site has not recorded this stage as complete for this building yet.');
      const demandDate = DATE.test(b.demandDate || '') ? b.demandDate : today();
      const due = addDays(demandDate, await daysToPay(db));
      const id = await db.tx(async (t) => {
        const open = await t.one("select id from demand_runs where building_id = $1 and stage_name = $2 and status = 'draft'", [bld.id, stageName]);
        if (open) throw fail(409, 'A draft run for this stage is already waiting for approval.');
        const row = await t.one('insert into demand_runs (project_id, building_id, stage_name, demand_date, due_date, created_by) values ($1, $2, $3, $4, $5, $6) returning id', [bld.project_id, bld.id, stageName, demandDate, due, u.id]);
        await audit.record(t.q, { user: u, action: 'create', entity: 'demand-run', entityId: row.id, projectId: bld.project_id, after: { building: bld.code, stage: stageName, demandDate, dueDate: due } });
        return row.id;
      });
      return res.json({ ok: true, id, ...(await overview(bld.project_id)) });
    }

    if (b.action === 'run.approve' || b.action === 'run.cancel') {
      const run = await db.one('select * from demand_runs where id = $1', [intOr(b.id)]);
      if (!run) throw fail(404, 'Run not found.');
      needProject(u, run.project_id);
      if (run.status !== 'draft') throw fail(409, 'This run is no longer a draft.');
      if (b.action === 'run.cancel') {
        if (!has(u, 'demand.raise') && !has(u, 'demand.approve')) throw fail(403, 'Your role does not allow this.');
        await db.tx(async (t) => {
          await t.q("update demand_runs set status = 'cancelled' where id = $1", [run.id]);
          await audit.record(t.q, { user: u, action: 'cancel', entity: 'demand-run', entityId: run.id, projectId: run.project_id });
        });
        return res.json({ ok: true, ...(await overview(run.project_id)) });
      }
      need('demand.approve');
      notOwn(u, run.created_by);
      let count = 0; const charged = [];
      await db.tx(async (t) => {
        const locked = await t.one("select status from demand_runs where id = $1 for update", [run.id]);
        if (locked.status !== 'draft') throw fail(409, 'This run is no longer a draft.');
        const rows = await t.q(
          `select b.id from bookings b join units u on u.id = b.unit_id where u.building_id = $1 and b.status = 'active'
             and not exists (select 1 from demands d where d.booking_id = b.id and d.stage_name = $2)`, [run.building_id, run.stage_name]);
        for (const r of rows) if (await raise(t, { bookingId: r.id, stageName: run.stage_name, demandDate: run.demand_date, dueDate: run.due_date, runId: run.id })) { count++; charged.push(r.id); }
        await t.q("update demand_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [run.id, u.id]);
        await audit.record(t.q, { user: u, action: 'approve', entity: 'demand-run', entityId: run.id, projectId: run.project_id, after: { demandsRaised: count } });
      });
      // The letters go out by themselves, with a first follow-up on the due date. A problem here never undoes the demands.
      const letters = charged.length ? await require('../lib/letters').afterRun({ run, bookingIds: charged, user: u }).catch((e) => ({ error: e.message })) : null;
      return res.json({ ok: true, raised: count, letters, ...(await overview(run.project_id)) });
    }

    if (b.action === 'settings') {
      need('demand.approve');
      const days = intOr(b.daysToPay);
      if (!(days >= 1 && days <= 90)) throw fail(400, 'Days to pay: 1 to 90.');
      await db.tx(async (t) => {
        await t.q("insert into settings (key, value) values ('days_to_pay', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(days)]);
        await audit.record(t.q, { user: u, action: 'update', entity: 'settings', entityId: 'days_to_pay', after: { daysToPay: days } });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
