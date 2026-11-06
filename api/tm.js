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

const staff = route({
  GET: async (req, res) => {
    const Q = req.query || {};
    // Reports: the full report of one project (from its loaded telecalling sheet, or from the calls entered in the ERP),
    // and the rows behind any figure (?drill=<figure>&val=…&project=…&q=…&page=…; page=-1 gives every row for a download)
    if (Q.results || Q.drill) {
      const u = await who(req, res, ['tm.view', 'tm.manage', 'mgmt.view']); if (!u) return;
      const R = require('../lib/tm-results');
      const pid = intOr(Q.results || Q.project);
      const p = await db.one('select id, name, location, status, history, project_id from tm_projects where id = $1', [pid]);
      if (!p) throw fail(404, 'Choose the project.');
      if (Q.drill) return res.json(await R.drill(pid, String(Q.drill), str(Q.val, 200), { q: str(Q.q, 80), page: intOr(Q.page, 0), fullNumbers: has(u, 'tm.manage') || has(u, 'mgmt.view') }));
      const sm = await R.summary(pid);
      // Dream Signature's analysis as it was finalised (areas from remarks, re-use tiers): shown until its sheet is loaded
      const fixed = p.history && /signature/i.test(p.name) ? require('../lib/data/ds-telecalling.json') : null;
      return res.json({ project: p, loaded: await R.loaded(pid), report: sm.empty ? null : sm, source: sm.source, fixed, rate: R.DEFAULT_RATE, canLoad: has(u, 'tm.manage') });
    }
    if (Q.campaigns || Q.campaign) {
      const u = await who(req, res, VIEW); if (!u) return;
      const K = require('../lib/tm-campaigns');
      if (Q.campaign) return res.json({ ...(await K.detail(intOr(Q.campaign), has(u, 'tm.manage'))), labels: K.TARGET, canApprove: require('../lib/changes').isApprover(u) });
      return res.json({ rows: await K.list(Q.project), labels: K.TARGET, ready: await K.readiness(), canApprove: require('../lib/changes').isApprover(u), defaults: K.DEFAULT_STATUSES,
        dnc: (await db.one('select count(*)::int as n from tm_dnc')).n, consentText: TM.CONSENT_TEXT });
    }
    if (Q.perf) { // daily performance: per day, per caller and per agency
      const u = await who(req, res, ['tm.view', 'tm.manage', 'mgmt.view']); if (!u) return;
      return res.json(await TM.performance({ from: Q.from, to: Q.to, projectId: Q.project }));
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
      const rows = await db.q(`select c.id, c.cp_code, c.username, c.name, (select count(distinct kind)::int from cp_docs d where d.cp_id = c.id) as docs, c.contact_person, c.designation, c.phone, c.alt_phone, c.email, c.rera_no, c.office_address, c.office_area,
          c.callers_in_team, c.portal_status, c.registered_at, c.reviewed_at, r.name as reviewed_by,
          (select count(*)::int from tm_leads l where l.cp_id = c.id) as leads,
          (select count(*)::int from tm_leads l where l.cp_id = c.id and l.owner_until >= $1::date) as active,
          (select max(u.created_at) from tm_uploads u where u.cp_id = c.id) as last_upload,
          (select count(*)::int from bookings b where b.cp_id = c.id and b.status = 'active') as bookings, c.note
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
    if (Q.settings) { const D2 = require('../lib/cp-docs'); return res.json({ settings: await TM.settings(), agreement: await D2.agreementText(), defaultAgreement: D2.AGREEMENT,
      people: await db.q("select id, name, role from users where not disabled and role in ('admin', 'management', 'sales', 'crm', 'head_crm', 'marketing') order by name") }); }
    if (Q.docs) return res.json({ ...(await require('../lib/cp-docs').status(intOr(Q.docs))), approvers: await require('../lib/cp-docs').approvers() });
    if (Q.cpdoc) {
      const f = await db.one('select file_name, mime, data from cp_docs where id = $1 and data is not null', [intOr(Q.cpdoc)]);
      if (!f) return res.status(404).json({ error: 'No file.' });
      res.setHeader('Content-Type', f.mime); res.setHeader('Content-Disposition', `inline; filename="${String(f.file_name).replace(/[^\w.\- ]+/g, '_')}"`); res.setHeader('Cache-Control', 'private, no-store');
      return res.end(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
    }
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
    if (a === 'sheet-scan') { // read a photo / scan of the filled sheet; nothing is saved until staff press Save
      const u = await who(req, res, ['tm.entry', 'tm.manage']); if (!u) return;
      const s = (await sheetRows('s.id = $1', [intOr(b.sheetId)]))[0];
      if (!s) throw fail(404, 'Call sheet not found.');
      const leads = await db.q('select id, mobile, name from tm_leads where sheet_id = $1 order by id', [s.id]);
      const r = await require('../lib/tm-scan').read({ sheet: { ...s, sheet_date: TM.iso(s.sheet_date) }, leads, files: b.files });
      await audit.record(db.q, { user: u, action: 'tm-sheet-scan', entity: 'tm-sheet', entityId: s.id, after: { read: r.rows.length, pages: (b.files || []).length } });
      return res.json(r);
    }
    const u = await who(req, res, MANAGE); if (!u) return;
    if (a === 'campaign-preview') return res.json(await require('../lib/tm-campaigns').preview({ projectId: intOr(b.projectId), kind: b.kind, filters: b.filters }));
    if (a === 'campaign-save') {
      const r = await require('../lib/tm-campaigns').save(u, { ...b, id: intOr(b.id) });
      await audit.record(db.q, { user: u, action: b.id ? 'tm-campaign-edit' : 'tm-campaign-add', entity: 'tm-campaign', entityId: r.id, after: { kind: b.kind, name: b.name, message: b.message, script: b.script } });
      return res.json(r);
    }
    if (a === 'campaign-approve') {
      const r = await require('../lib/tm-campaigns').approve(u, intOr(b.id));
      await audit.record(db.q, { user: u, action: 'tm-campaign-approve', entity: 'tm-campaign', entityId: intOr(b.id), after: r });
      return res.json(r);
    }
    if (['campaign-start', 'campaign-pause', 'campaign-cancel'].includes(a)) {
      const r = await require('../lib/tm-campaigns').setStatus(u, intOr(b.id), a.slice(9));
      await audit.record(db.q, { user: u, action: 'tm-' + a, entity: 'tm-campaign', entityId: intOr(b.id) });
      return res.json(r);
    }
    if (a === 'campaign-test') return res.json(await require('../lib/tm-campaigns').test(u, intOr(b.id), b.mobile));
    if (a === 'dnc-add') { // numbers that must never be contacted again (SMS, AI calls, telecallers, partner uploads)
      const ms = [...new Set(String(b.numbers || '').split(/[\s,;]+/).map(TM.mobile).filter(Boolean))].slice(0, 5000);
      if (!ms.length) throw fail(400, 'Type or paste 10-digit mobile numbers.');
      const r = await db.q("insert into tm_dnc (mobile, reason) select m, $2 from unnest($1::text[]) m on conflict do nothing returning mobile", [ms, str(b.reason, 120) || 'Added by staff']);
      await db.q("update tm_campaign_targets set status = 'skipped', updated_at = now() where status = 'queued' and mobile = any($1::text[])", [ms]);
      await audit.record(db.q, { user: u, action: 'tm-dnc-add', entity: 'tm-dnc', entityId: null, after: { added: r.length, given: ms.length } });
      return res.json({ added: r.length, already: ms.length - r.length });
    }
    if (a === 'partner-status') {
      const st = ['approved', 'rejected', 'blocked', 'pending'].includes(b.status) ? b.status : null;
      if (!st) throw fail(400, 'Choose a status.');
      const before = await db.one('select id, portal_status, cp_code, name from channel_partners where id = $1 and portal_status is not null', [intOr(b.id)]);
      if (!before) throw fail(404, 'Partner not found.');
      if (st === 'approved') { // only the people named in Partner settings approve, and only once every paper is in
        const D2 = require('../lib/cp-docs'), who2 = await D2.approvers();
        if (who2.length && !who2.includes(u.id)) { const nm = (await db.q('select name from users where id = any($1::int[])', [who2])).map((x) => x.name).join(', '); throw fail(403, `Partners are approved by ${nm}.`); }
        const ds = await D2.status(before.id); if (!ds.complete) throw fail(400, `${before.name} cannot be approved yet: missing ${ds.missing.join(', ')}.`);
      }
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
      const vals = [name, TM.mobile(b.mobile) || null, Number(b.dailyRate) >= 0 ? Number(b.dailyRate) : TM.DEFAULT_RATE, b.active !== false, DATE.test(b.joinedOn || '') ? b.joinedOn : null, str(b.agency, 80) || null];
      const dup = vals[1] ? await db.one('select id, name from tm_callers where mobile = $1 and id <> $2', [vals[1], intOr(b.id) || 0]) : null;
      if (dup) throw fail(409, `${dup.name} already has this mobile number.`);
      const r = b.id
        ? await db.one('update tm_callers set name = $1, mobile = $2, daily_rate = $3, active = $4, joined_on = coalesce($5, joined_on), agency = $6 where id = $7 returning id', [...vals, intOr(b.id)])
        : await db.one('insert into tm_callers (name, mobile, daily_rate, active, joined_on, agency, roster_on) values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, current_date) returning id', vals);
      return res.json({ id: r.id });
    }
    if (a === 'callers-import') { // the agency's list of callers coming to work
      const r = await TM.importCallers({ rows: b.rows, date: b.date, agency: b.agency, dailyRate: b.dailyRate });
      await audit.record(db.q, { user: u, action: 'tm-callers-import', entity: 'tm-callers', entityId: null, after: { added: r.added, updated: r.updated, date: r.date }, note: str(b.fileName, 120) || null });
      return res.json(r);
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
    // A finished campaign's whole telecalling sheet, in parts of 5,000 rows (the first part replaces what was there)
    if (a === 'rows-load') {
      const r = await require('../lib/tm-results').loadRows({ projectId: intOr(b.projectId), rows: b.rows, first: !!b.first, offset: intOr(b.offset, 0) });
      if (b.first) await audit.record(db.q, { user: u, action: 'tm-sheet-load', entity: 'tm-project', entityId: intOr(b.projectId), after: { first: r.loaded }, note: str(b.fileName, 120) || null });
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
    if (a === 'doc-received') { const r = await require('../lib/cp-docs').paperReceived(intOr(b.cpId), u); await audit.record(db.q, { user: u, action: 'partner-agreement-paper', entity: 'channel-partner', entityId: intOr(b.cpId) }); return res.json(r); }
    if (a === 'settings-save') {
      const cur = await TM.settings(), s = b.settings || {};
      const next = {
        ...cur,
        ownershipDays: Math.min(Math.max(intOr(s.ownershipDays, cur.ownershipDays), 7), 365),
        historyPolicy: s.historyPolicy === 'accept' ? 'accept' : 'reject',
        autoApprove: false, // partners are approved by hand once their papers are in
        maxAttempts: Math.min(Math.max(intOr(s.maxAttempts, cur.maxAttempts), 1), 10),
        gapDays: Math.min(Math.max(intOr(s.gapDays, cur.gapDays), 0), 30),
        waOtpTemplate: str(s.waOtpTemplate, 80), waWelcomeTemplate: str(s.waWelcomeTemplate, 80), waInviteTemplate: str(s.waInviteTemplate != null ? s.waInviteTemplate : cur.waInviteTemplate, 80),
        approvers: Array.isArray(s.approvers) ? s.approvers.map(intOr).filter(Boolean).slice(0, 5) : cur.approvers || [],
        agreementText: s.agreementText != null ? (String(s.agreementText).trim().slice(0, 20000) || null) : cur.agreementText || null,
        hookKey: cur.hookKey || require('crypto').randomBytes(16).toString('hex'),
        campaigns: s.campaigns ? (() => { const c = s.campaigns, hr = (v, d) => { const x = parseInt(v, 10); return x >= 0 && x <= 23 ? x : d; };
          const from = hr(c.fromHour, 10), to = Math.max(hr(c.toHour, 19), from + 1);
          if (from < 9 || to > 21) throw fail(400, 'Promotional calls and SMS are allowed only between 9 am and 9 pm.');
          return { smsSender: str(c.smsSender, 11).toUpperCase(), dltEntityId: str(c.dltEntityId, 30), callerId: str(c.callerId, 20).replace(/[^\d+]/g, ''), callAppId: str(c.callAppId, 20).replace(/\D/g, ''), fromHour: from, toHour: to,
            agentId: str(c.agentId, 60).replace(/[^\w-]/g, ''), agentFrom: str(c.agentFrom, 20).replace(/[^\d+]/g, '') }; })() : cur.campaigns || {},
      };
      await db.q("insert into settings (key, value) values ('tm', $1) on conflict (key) do update set value = excluded.value", [next]);
      await audit.record(db.q, { user: u, action: 'tm-settings', entity: 'settings', entityId: 'tm', before: cur, after: next });
      return res.json({ settings: next });
    }
    throw fail(400, 'Unknown request.');
  },
});

// Exotel calls back here (SMS delivery, call status, the digit pressed, the words to say). No staff login: the secret
// hook key in the link (Telemarketing → Settings) is the check. Exotel sends GET (passthru) or POST (form) requests.
module.exports = async (req, res) => {
  const q = req.query || {};
  if (!q.hook) return staff(req, res);
  try {
    let b = req.body; if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') { const t = b.trim(); try { b = t.startsWith('{') ? JSON.parse(t) : Object.fromEntries(new URLSearchParams(t)); } catch { b = {}; } }
    const r = await require('../lib/tm-campaigns').hook(String(q.hook), { ...(b && typeof b === 'object' ? b : {}), ...q });
    res.setHeader('Cache-Control', 'no-store');
    if (r.text != null) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.status(200).end(r.text); }
    res.setHeader('Content-Type', 'application/json'); return res.status(200).end(JSON.stringify(r));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json'); return res.status(e.status || 500).end(JSON.stringify({ error: e.status ? e.message : 'error' }));
  }
};
