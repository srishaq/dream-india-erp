// Partner & Telemarketing (staff side). Partner firms register on /partner and upload client lists; here Dream India
// approves partners, opens launches for upload, makes daily call sheets for the telecallers, types back the outcomes
// written on paper, and sees who is calling, how much it costs and which partner's clients visit and book.
// GET  ?overview=1[&project=ID] · ?partners=1 · ?projects=1 · ?callers=1 · ?sheets=1[&status=out|entered|cancelled] · ?sheet=ID
//      ?lookup=MOBILE · ?settings=1
// POST {action}: partner-status · project-save · caller-save · sheets-make · sheet-cancel · outcomes-save · parse · import · settings-save
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const TM = require('../lib/tm');
const { has } = require('../lib/roles');
const { parseFile } = require('../lib/sheetfile');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
async function who(req, res, perms) {
  const u = await auth.guard(req, res, null);
  if (!u) return null;
  if (!perms.some((p) => has(u, p))) { res.status(403).json({ error: 'Your role does not allow this.' }); return null; }
  return u;
}
const VIEW = ['tm.view', 'tm.manage'], ENTRY = ['tm.entry', 'tm.manage', 'tm.view'], MANAGE = ['tm.manage'];

async function sheetRows(where, params) {
  return db.q(`select s.id, s.sheet_date, s.leads, s.status, s.created_at, s.entered_at, c.name as caller, p.name as project, s.tm_project_id,
      (select count(*)::int from tm_outcomes o where o.sheet_id = s.id) as calls
    from tm_sheets s join tm_callers c on c.id = s.caller_id join tm_projects p on p.id = s.tm_project_id where ${where} order by s.sheet_date desc, s.id desc limit 300`, params);
}

module.exports = route({
  GET: async (req, res) => {
    const Q = req.query || {};
    // Dream Signature's pre-launch telecalling, completed: the final figures (fixed; from the telecalling sheet and the bookings)
    if (Q.dsResults) {
      if (!(await who(req, res, ['tm.view', 'tm.manage', 'mgmt.view']))) return;
      return res.json(require('../lib/data/ds-telecalling.json'));
    }
    if (Q.sheets || Q.sheet) {
      if (!(await who(req, res, ENTRY))) return;
      if (Q.sheet) {
        const s = (await sheetRows('s.id = $1', [intOr(Q.sheet)]))[0];
        if (!s) throw fail(404, 'Call sheet not found.');
        const leads = await db.q(`select id, mobile, name, config, locality, budget, status, attempts, last_outcome, remarks from tm_leads where sheet_id = $1 order by id`, [s.id]);
        const out = new Map((await db.q('select lead_id, code, remark from tm_outcomes where sheet_id = $1', [s.id])).map((r) => [String(r.lead_id), r]));
        return res.json({ sheet: { ...s, sheet_date: TM.iso(s.sheet_date) }, outcomes: TM.OUTCOMES,
          leads: leads.map((l) => ({ id: l.id, mobile: l.mobile, name: l.name, config: l.config, locality: l.locality, budget: l.budget, status: TM.STATUS[l.status] || l.status,
            attempts: l.attempts, last: TM.OUTCOMES[l.last_outcome] || '', remarks: l.remarks ? String(l.remarks).slice(-160) : '', entered: out.get(String(l.id)) || null })) });
      }
      const st = ['out', 'entered', 'cancelled'].includes(Q.status) ? Q.status : null;
      const rows = await sheetRows('($1::text is null or s.status = $1)', [st]);
      return res.json({ rows: rows.map((r) => ({ ...r, sheet_date: TM.iso(r.sheet_date) })) });
    }
    if (!(await who(req, res, VIEW))) return;
    if (Q.overview) {
      const pid = intOr(Q.project);
      const projects = await db.q('select id, name, status, history from tm_projects order by history, id');
      return res.json({ ...(await TM.analytics(pid)), projects, outcomesList: TM.OUTCOMES });
    }
    if (Q.partners) {
      const rows = await db.q(`select c.id, c.cp_code, c.username, c.name, c.contact_person, c.designation, c.phone, c.alt_phone, c.email, c.rera_no, c.office_address, c.office_area,
          c.callers_in_team, c.portal_status, c.registered_at, c.reviewed_at, r.name as reviewed_by,
          (select count(*)::int from tm_leads l where l.cp_id = c.id) as leads,
          (select count(*)::int from tm_leads l where l.cp_id = c.id and l.owner_until >= $1::date) as active,
          (select max(u.created_at) from tm_uploads u where u.cp_id = c.id) as last_upload,
          (select count(*)::int from bookings b where b.cp_id = c.id and b.status = 'active') as bookings
        from channel_partners c left join users r on r.id = c.reviewed_by where c.portal_status is not null
        order by case c.portal_status when 'pending' then 0 when 'approved' then 1 else 2 end, c.registered_at desc`, [TM.istToday()]);
      return res.json({ rows });
    }
    if (Q.projects) {
      const rows = await db.q(`select p.*, pr.name as erp_project,
          (select count(*)::int from tm_leads l where l.tm_project_id = p.id) as leads,
          (select count(*)::int from tm_leads l where l.tm_project_id = p.id and l.status in ('fresh', 'history')) as uncalled,
          (select count(distinct cp_id)::int from tm_leads l where l.tm_project_id = p.id and l.cp_id is not null) as partners
        from tm_projects p left join projects pr on pr.id = p.project_id order by p.history, p.id desc`);
      const erp = await db.q('select id, name from projects order by name');
      return res.json({ rows: rows.map((r) => ({ ...r, upload_until: TM.iso(r.upload_until) })), erpProjects: erp });
    }
    if (Q.callers) {
      const rows = await db.q(`select c.*, (select count(*)::int from tm_outcomes o where o.caller_id = c.id) as calls,
          (select count(distinct call_date)::int from tm_outcomes o where o.caller_id = c.id) as days,
          (select count(*)::int from tm_outcomes o where o.caller_id = c.id and o.code = 2) as visits
        from tm_callers c order by c.active desc, c.name`);
      return res.json({ rows: rows.map((r) => ({ ...r, joined_on: TM.iso(r.joined_on) })) });
    }
    if (Q.lookup) return res.json(await TM.lookup(Q.lookup));
    if (Q.settings) return res.json({ settings: await TM.settings() });
    throw fail(400, 'Unknown request.');
  },

  POST: async (req, res, b) => {
    const a = b.action;
    if (a === 'outcomes-save') {
      const u = await who(req, res, ['tm.entry', 'tm.manage']); if (!u) return;
      const r = await TM.saveOutcomes({ sheetId: intOr(b.sheetId), entries: b.entries, userId: u.id });
      await audit.record(db.q, { user: u, action: 'tm-outcomes', entity: 'tm-sheet', entityId: intOr(b.sheetId), after: r });
      return res.json(r);
    }
    const u = await who(req, res, MANAGE); if (!u) return;
    if (a === 'partner-status') {
      const st = ['approved', 'rejected', 'blocked', 'pending'].includes(b.status) ? b.status : null;
      if (!st) throw fail(400, 'Choose a status.');
      const before = await db.one('select id, portal_status, cp_code, name from channel_partners where id = $1 and portal_status is not null', [intOr(b.id)]);
      if (!before) throw fail(404, 'Partner not found.');
      await db.q('update channel_partners set portal_status = $2, reviewed_by = $3, reviewed_at = now() where id = $1', [before.id, st, u.id]);
      if (st === 'blocked' || st === 'rejected') await db.q('delete from cp_sessions where cp_id = $1', [before.id]);
      await audit.record(db.q, { user: u, action: 'partner-' + st, entity: 'channel-partner', entityId: before.id, before: { status: before.portal_status }, after: { status: st }, note: str(b.note, 200) || null });
      return res.json({ ok: true });
    }
    if (a === 'project-save') {
      const name = str(b.name, 100);
      if (!name) throw fail(400, 'Give the project a name.');
      const st = ['open', 'calling', 'closed'].includes(b.status) ? b.status : 'open';
      const until = DATE.test(b.uploadUntil || '') ? b.uploadUntil : null;
      const vals = [name, str(b.location, 100) || null, str(b.rera, 30) || null, intOr(b.projectId), st, until, str(b.notes, 400) || null];
      const r = b.id
        ? await db.one('update tm_projects set name = $1, location = $2, rera_no = $3, project_id = $4, status = $5, upload_until = $6, notes = $7 where id = $8 returning id', [...vals, intOr(b.id)])
        : await db.one('insert into tm_projects (name, location, rera_no, project_id, status, upload_until, notes, history, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id', [...vals, !!b.history, u.id]);
      if (!r) throw fail(404, 'Project not found.');
      await audit.record(db.q, { user: u, action: b.id ? 'tm-project-edit' : 'tm-project-add', entity: 'tm-project', entityId: r.id, after: { name, status: st, until } });
      return res.json({ id: r.id });
    }
    if (a === 'caller-save') {
      const name = str(b.name, 80);
      if (!name) throw fail(400, 'Enter the caller\'s name.');
      const vals = [name, TM.mobile(b.mobile) || null, Number(b.dailyRate) >= 0 ? Number(b.dailyRate) : 1000, b.active !== false, DATE.test(b.joinedOn || '') ? b.joinedOn : null];
      const r = b.id
        ? await db.one('update tm_callers set name = $1, mobile = $2, daily_rate = $3, active = $4, joined_on = coalesce($5, joined_on) where id = $6 returning id', [...vals, intOr(b.id)])
        : await db.one('insert into tm_callers (name, mobile, daily_rate, active, joined_on) values ($1, $2, $3, $4, coalesce($5::date, current_date)) returning id', vals);
      return res.json({ id: r.id });
    }
    if (a === 'sheets-make') {
      const r = await TM.makeSheets({ projectId: intOr(b.projectId), callerIds: b.callerIds, perCaller: b.perCaller, date: b.date, userId: u.id });
      await audit.record(db.q, { user: u, action: 'tm-sheets', entity: 'tm-project', entityId: intOr(b.projectId), after: r });
      return res.json(r);
    }
    if (a === 'sheet-cancel') {
      const r = await db.one("update tm_sheets set status = 'cancelled' where id = $1 and status = 'out' returning id", [intOr(b.id)]);
      if (!r) throw fail(409, 'Only a sheet that is still out can be cancelled.');
      await db.q('update tm_leads set sheet_id = null, caller_id = null where sheet_id = $1', [r.id]);
      return res.json({ ok: true });
    }
    if (a === 'parse') return res.json({ rows: parseFile(b.file, b.name, 30000) });
    if (a === 'import') {
      const r = await TM.importHistory({ projectId: intOr(b.projectId), rows: b.rows });
      await audit.record(db.q, { user: u, action: 'tm-import', entity: 'tm-project', entityId: intOr(b.projectId), after: r, note: str(b.fileName, 120) || null });
      return res.json(r);
    }
    // An import that went in with the wrong columns: take out the earlier numbers of this project that were never put on a sheet.
    if (a === 'import-clear') {
      const pid = intOr(b.projectId);
      const p = await db.one('select id, name from tm_projects where id = $1', [pid]);
      if (!p) throw fail(400, 'Choose the project.');
      const r = await db.q(`delete from tm_leads l where l.tm_project_id = $1 and l.source = 'history' and l.status = 'history' and l.sheet_id is null and l.attempts = 0
          and not exists (select 1 from tm_outcomes c where c.lead_id = l.id) returning l.id`, [pid]);
      const left = await db.one("select count(*)::int as n from tm_leads where tm_project_id = $1 and source = 'history'", [pid]);
      await audit.record(db.q, { user: u, action: 'tm-import-clear', entity: 'tm-project', entityId: pid, after: { removed: r.length, left: left.n } });
      return res.json({ removed: r.length, left: left.n });
    }
    if (a === 'settings-save') {
      const cur = await TM.settings(), s = b.settings || {};
      const next = {
        ownershipDays: Math.min(Math.max(intOr(s.ownershipDays, cur.ownershipDays), 7), 365),
        historyPolicy: s.historyPolicy === 'accept' ? 'accept' : 'reject',
        autoApprove: !!s.autoApprove,
        maxAttempts: Math.min(Math.max(intOr(s.maxAttempts, cur.maxAttempts), 1), 10),
        gapDays: Math.min(Math.max(intOr(s.gapDays, cur.gapDays), 0), 30),
        waOtpTemplate: str(s.waOtpTemplate, 80), waWelcomeTemplate: str(s.waWelcomeTemplate, 80),
      };
      await db.q("insert into settings (key, value) values ('tm', $1) on conflict (key) do update set value = excluded.value", [next]);
      await audit.record(db.q, { user: u, action: 'tm-settings', entity: 'settings', entityId: 'tm', before: cur, after: next });
      return res.json({ settings: next });
    }
    throw fail(400, 'Unknown request.');
  },
});
