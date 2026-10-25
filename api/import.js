// Admin only. Imports Dream Signature from the CRM master sheet (read live with the service account).
// GET ?project=ID → connection status and what the project holds now.
// POST {action:'preview', projectId, stageDates?} → reads and checks the sheet, saves nothing.
// POST {action:'commit', projectId, stageDates} → imports (sample data is removed first).
const db = require('../lib/db');
const auth = require('../lib/auth');
const sheets = require('../lib/sheets');
const { parse } = require('../lib/import-crm');
const { commit } = require('../lib/import-commit');
const { needProject } = require('../lib/access');
const { daysToPay } = require('../lib/demands');
const { route, fail, intOr } = require('../lib/http');

const SOURCE_TABS = { bookings: ["Developer's Bookings", 'A:AS'], crm: ['CRM Follow up', 'A:AK'], ledger: ['Ledger', 'A:D'], bank: ['Rera Bank Stat.', 'A:P'] };
const sheetId = () => process.env.CRM_SHEET_ID || sheets.SHEET_ID;

async function readAndParse(projectId, stageDates) {
  let tabs;
  if (process.env.IMPORT_FIXTURE && process.env.VERCEL !== '1') tabs = require(process.env.IMPORT_FIXTURE); // local tests only
  else {
    if (!sheets.configured()) throw fail(400, 'The ERP is not connected to Google Sheets yet. Add GOOGLE_SERVICE_ACCOUNT_JSON in the ERP\'s Vercel settings.');
    tabs = await sheets.fetchRanges(sheetId(), SOURCE_TABS).catch((e) => { throw fail(400, e.message); });
  }
  const plan = await db.q('select s.seq, s.name, s.pct, s.construction_linked from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active order by s.seq', [projectId]);
  const blds = Object.fromEntries((await db.q("select code, id from buildings where project_id = $1 and kind <> 'rehab'", [projectId])).map((b) => [b.code, b.id]));
  const clean = Object.fromEntries(Object.entries(stageDates || {}).filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')));
  return parse(tabs, plan, blds, clean);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    const projectId = needProject(u, intOr(req.query.project));
    const counts = await db.one('select count(*) filter (where sample)::int as sample, count(*) filter (where not sample)::int as real from units where project_id = $1', [projectId]);
    const last = await db.one('select r.id, r.created_at, r.summary, x.name as by_name from import_runs r left join users x on x.id = r.created_by where r.project_id = $1 order by r.id desc limit 1', [projectId]);
    return res.json({ configured: sheets.configured() || !!(process.env.IMPORT_FIXTURE && process.env.VERCEL !== '1'), serviceEmail: sheets.serviceEmail() || null, sheetId: sheetId(), counts, last });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    const projectId = needProject(u, intOr(b.projectId));
    if (b.action === 'preview') {
      const p = await readAndParse(projectId, b.stageDates);
      const kinds = {};
      for (const i of p.issues) (kinds[i.kind] = kinds[i.kind] || []).length < 5 && kinds[i.kind].push(i);
      return res.json({ summary: p.summary, stageDates: p.stageDates, examples: kinds, sample: p.bookings.slice(0, 8).map((x) => ({ unit: x.unit_no, buyer: x.applicants[0].name, av: x.agreement_value, demanded: x.demands.map((d) => d.stage_name), receipts: x.receipts.length })) });
    }
    if (b.action === 'commit') {
      const p = await readAndParse(projectId, b.stageDates);
      const days = await daysToPay(db);
      const out = await db.tx((t) => commit(t, p, { projectId, user: u, source: `CRM master sheet ${sheetId()}`, daysToPay: days }));
      return res.json({ ok: true, ...out });
    }
    throw fail(400, 'Unknown action.');
  },
});
