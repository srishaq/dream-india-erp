// Admin only. Imports Dream Signature from the CRM master sheet (read live with the service account).
// GET ?project=ID → connection status and what the project holds now.
// POST {action:'preview', projectId, stageDates?} → reads and checks the sheet, saves nothing.
// POST {action:'commit', projectId, stageDates} → imports (sample data is removed first).
// POST {action:'reset', projectId, confirm:'CLEAR'} → test version only: removes the imported data so it can be imported again.
const db = require('../lib/db');
const auth = require('../lib/auth');
const sheets = require('../lib/sheets');
const { parse } = require('../lib/import-crm');
const { commit } = require('../lib/import-commit');
const { needProject } = require('../lib/access');
const { daysToPay } = require('../lib/demands');
const { route, fail, intOr } = require('../lib/http');
const sample = require('../lib/sample');
const audit = require('../lib/audit');

const SOURCE_TABS = { bookings: ["Developer's Bookings", 'A:AS'], crm: ['CRM Follow up', 'A:AK'], ledger: ['Ledger', 'A:D'], bank: ['Rera Bank Stat.', 'A:P'] };
const sheetId = () => process.env.CRM_SHEET_ID || sheets.SHEET_ID;

// Dream Aspire: the newest "Master Slab Wise Collection" workbook in the Aspire CRM folder on Drive (or an uploaded copy).
const ASPIRE_CRM_FOLDER = () => process.env.ASPIRE_CRM_FOLDER || '1sICMmbJra_Qzn_cSda8W3nJ3tLi38GyQ';
async function readAspire(b) {
  const aspire = require('../lib/import-aspire');
  let buf, name;
  if (b.fileB64) { buf = Buffer.from(String(b.fileB64), 'base64'); name = String(b.fileName || 'uploaded workbook').slice(0, 200); }
  else if (process.env.IMPORT_ASPIRE_FIXTURE && process.env.VERCEL !== '1') { buf = /\.js$/.test(process.env.IMPORT_ASPIRE_FIXTURE) ? null : require('fs').readFileSync(process.env.IMPORT_ASPIRE_FIXTURE); name = 'Master Slab Wise Collection 17 Nov 2026 (fixture)'; }
  else {
    const drive = require('../lib/drive');
    const files = (await drive.statementFiles([ASPIRE_CRM_FOLDER()]).catch((e) => { throw fail(400, `Could not open the Aspire CRM folder on Drive: ${e.message}. Share it with ${sheets.serviceEmail() || 'the ERP'} or upload the workbook.`); }))
      .filter((f) => /slab\s*wise|collection/i.test(f.name));
    if (!files.length) throw fail(400, 'No "Master Slab Wise Collection" workbook in the Aspire CRM folder.');
    buf = await drive.download(files[0]); name = `${files[0].name} (Drive, ${String(files[0].modifiedTime).slice(0, 10)})`;
  }
  let tabs; try { tabs = /\.js$/.test(process.env.IMPORT_ASPIRE_FIXTURE || '') && !b.fileB64 && process.env.VERCEL !== '1' ? require(process.env.IMPORT_ASPIRE_FIXTURE) : require('../lib/xlsx').read(buf); } catch { throw fail(400, 'The workbook could not be read. Save it again as .xlsx.'); }
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(b.asOf || '') ? b.asOf : (() => { const m = name.match(/(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{4})/); const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m?.[2]?.toLowerCase()]; return m && M ? `${m[3]}-${String(M).padStart(2, '0')}-${m[1].padStart(2, '0')}` : new Date().toISOString().slice(0, 10); })();
  return { parsed: aspire.parse(tabs, { asOf }), name };
}

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

// heads the ERP has that differ from the sheet's, counted by pair (ERP head → sheet head)
function summarise(differ) {
  const c = new Map();
  for (const d of differ) { const k = `${d.side}|${d.erp}|${d.sheet}`; c.set(k, (c.get(k) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => { const [side, erp, sheet] = k.split('|'); return { side, erp, sheet, n }; });
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    const projectId = needProject(u, intOr(req.query.project));
    const counts = await db.one('select count(*) filter (where sample)::int as sample, count(*) filter (where not sample)::int as real from units where project_id = $1', [projectId]);
    const last = await db.one('select r.id, r.created_at, r.summary, x.name as by_name from import_runs r left join users x on x.id = r.created_by where r.project_id = $1 order by r.id desc limit 1', [projectId]);
    return res.json({ canReset: process.env.ERP_LIVE !== '1', configured: sheets.configured() || !!(process.env.IMPORT_FIXTURE && process.env.VERCEL !== '1'), serviceEmail: sheets.serviceEmail() || null, sheetId: sheetId(), counts, last });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'users.manage'); if (!u) return;
    const projectId = needProject(u, intOr(b.projectId));
    if (b.action === 'aspire-contractor') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const { parsed, name } = await readAspire(b);
      const rate = Number(b.rate) || 22800, contractor = String(b.contractor || 'Buildwell Construction').slice(0, 120);
      const out = await db.tx((t) => require('../lib/import-aspire').contractorCommit(t, parsed, { projectId, user: u, rate, contractor, source: name }));
      return res.json({ ok: true, file: name, ...out });
    }
    // Aspire buyers' actual payments (the CRM's "transaction details" workbook) replace the opening receipts
    if (b.action === 'aspire-receipts-preview' || b.action === 'aspire-receipts-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const R = require('../lib/import-aspire-receipts');
      let buf, name;
      if (b.fileB64) { buf = Buffer.from(String(b.fileB64), 'base64'); name = String(b.fileName || 'uploaded workbook').slice(0, 200); }
      else if (process.env.IMPORT_ASPIRE_TXN_FIXTURE && process.env.VERCEL !== '1') { buf = require('fs').readFileSync(process.env.IMPORT_ASPIRE_TXN_FIXTURE); name = 'transaction details (fixture)'; }
      else {
        const drive = require('../lib/drive');
        const files = (await drive.statementFiles([ASPIRE_CRM_FOLDER()]).catch((e) => { throw fail(400, `Could not open the Aspire CRM folder on Drive: ${e.message}.`); })).filter((f) => /transaction/i.test(f.name));
        if (!files.length) throw fail(400, 'No "transaction details" workbook in the Aspire CRM folder.');
        buf = await drive.download(files[0]); name = `${files[0].name} (Drive, ${String(files[0].modifiedTime).slice(0, 10)})`;
      }
      let parsed; try { parsed = R.parse(require('../lib/xlsx').read(buf)); } catch (e) { throw fail(400, 'The workbook could not be read: ' + e.message); }
      if (b.action === 'aspire-receipts-preview') {
        const { rows, issues } = await R.plan(db.q, parsed, projectId);
        const sum = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0));
        return res.json({ file: name, summary: parsed.summary, flats: rows.length, avBefore: sum('avBefore'), avAfter: sum('avAfter'), gstBefore: sum('gstBefore'), gstAfter: sum('gstAfter'), issues,
          differ: rows.filter((r) => Math.abs(r.avBefore - r.avAfter) > 1).map((r) => ({ unit: r.f.unit, before: r.avBefore, after: r.avAfter, payments: r.f.lines.length })) });
      }
      const out = await db.tx(async (t) => { await t.q("set local statement_timeout = '120s'").catch(() => {}); return R.commit(t, parsed, { projectId, user: u, source: name }); });
      return res.json({ ok: true, file: name, ...out });
    }
    // Aspire buyers' names, numbers, emails, addresses and PANs from the CRM's collection report (sheet DATA)
    // Vendor bills, GST and TDS from Tally (Purchase, Journal and Payment Registers and the TDS workings in the Tally
    // Reports folder on Drive): filled into the Payments Out rows that paid them (Dream Signature's books)
    if (b.action === 'tally-bills-preview' || b.action === 'tally-bills-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      // Dream Signature: Prime Realtors' books; Dream Aspire: Dream India Builders' (each its own Tally Reports folder)
      if (prj?.code !== 'SIGNATURE' && prj?.code !== 'ASPIRE') throw fail(400, 'Tally reports can be read for Dream Signature or Dream Aspire.');
      const tbBook = prj.code === 'ASPIRE' ? 'aspire' : 'signature';
      const tbFolder = tbBook === 'aspire' ? (process.env.ASPIRE_TALLY_FOLDER || '1aW3rnPy-9DbsncoyzdsgeNzPqTpaBUZW') : (process.env.TALLY_BILLS_FOLDER || '1dErcA7AQ-h2fbDFMF0ii2Dh0TLv5Uepy');
      const TB = require('../lib/tally-bills');
      const files = [];
      if (process.env.TALLY_BILLS_FIXTURE_DIR && process.env.VERCEL !== '1') {
        const fs = require('fs'), path = require('path');
        for (const f of fs.readdirSync(process.env.TALLY_BILLS_FIXTURE_DIR)) if (/\.xlsx$/i.test(f)) files.push({ name: f, buf: fs.readFileSync(path.join(process.env.TALLY_BILLS_FIXTURE_DIR, f)) });
      } else {
        const drive = require('../lib/drive');
        const list = await drive.statementFiles([tbFolder]).catch((e) => { throw fail(400, `Could not open the Tally Reports folder on Drive: ${e.message}.`); });
        for (const f of list) files.push({ name: f.name, buf: await drive.download(f) });
      }
      const V = [], W = [], used = [];
      for (const f of files) {
        if (/tds/i.test(f.name) && !/register/i.test(f.name)) { W.push(...TB.workings(f.buf, f.name)); used.push(f.name); continue; }
        if (/purchase|journal|payment/i.test(f.name)) { V.push(...TB.read(f.buf, f.name)); used.push(f.name); }
      }
      if (!V.length) throw fail(400, 'No Purchase, Journal or Payment Register in the Tally Reports folder.');
      const pans = {}; for (const w of W) if (w.pan) pans[w.key] = w.pan;
      const data = { bills: TB.bills(V), pans, tpays: TB.payments(V) };
      if (b.action === 'tally-bills-preview') {
        const p = await TB.plan(db.q, data, { book: tbBook });
        const n = (k) => p.fills.filter((f) => f.set[k] != null).length;
        return res.json({ files: used, bills: p.bills, payments: p.payments, matched: p.matched, filled: p.fills.length, totals: n('total_bill'), tds: n('tds_deducted'), pan: n('vendor_pan'),
          differ: p.differ.slice(0, 100), unmatched: p.unmatched.length, unmatchedTop: p.unmatched.sort((x, y) => y.amount - x.amount).slice(0, 30), openBills: p.openBills, sample: p.fills.slice(0, 15) });
      }
      const out = await db.tx(async (t) => { await t.q("set local statement_timeout = '120s'").catch(() => {}); return TB.commit(t, data, { book: tbBook, user: u, source: used.join(', ') }); });
      return res.json({ ok: true, files: used, bills: out.bills, filled: out.fills.length, differ: out.differ.length, unmatched: out.unmatched.length });
    }
    // Dream Aspire's bank entries: Cash Flow Head, payee and flat from Accounts' "Dream Aspire Cash Flow" workbook
    // (sheets ASPIRE_EXPENSES and ASPIRE_COLLECTION), newest in the "Cash Flow, FD, Loans & Refunds" folder on Drive
    if (b.action === 'aspire-cashflow-preview' || b.action === 'aspire-cashflow-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const CF = require('../lib/aspire-cashflow');
      let buf, name;
      if (b.fileB64) { buf = Buffer.from(String(b.fileB64), 'base64'); name = String(b.fileName || 'uploaded workbook').slice(0, 200); }
      else if (process.env.IMPORT_ASPIRE_CF_FIXTURE && process.env.VERCEL !== '1') { buf = require('fs').readFileSync(process.env.IMPORT_ASPIRE_CF_FIXTURE); name = 'Dream Aspire Cash Flow (fixture)'; }
      else {
        const drive = require('../lib/drive');
        const folder = process.env.ASPIRE_CASHFLOW_FOLDER || '1-swghiYhZnb7vq_O9kdrnEAblQzbcFaY';
        const files = (await drive.statementFiles([folder]).catch((e) => { throw fail(400, `Could not open the "Cash Flow, FD, Loans & Refunds" folder on Drive: ${e.message}. Share it with ${sheets.serviceEmail() || 'the ERP'}.`); }))
          .filter((f) => /cash\s*flow/i.test(f.name));
        if (!files.length) throw fail(400, 'No "Dream Aspire Cash Flow" workbook in the "Cash Flow, FD, Loans & Refunds" folder.');
        buf = await drive.download(files[0]); name = `${files[0].name} (Drive, ${String(files[0].modifiedTime).slice(0, 10)})`;
      }
      let parsed; try { parsed = CF.parse(require('../lib/xlsx').read(buf)); } catch (e) { throw fail(400, 'The workbook could not be read: ' + e.message); }
      if (b.action === 'aspire-cashflow-preview') {
        const p = await CF.plan(db.q, parsed, { book: 'aspire', projectId });
        const n = (side, k) => p.fills.filter((f) => f.side === side && f.set[k]).length;
        return res.json({ file: name, sheet: p.sheet, matched: p.matched, paymentHeads: n('payment', 'head'), payees: n('payment', 'payee'), receiptHeads: n('receipt', 'head'), payers: n('receipt', 'payer_name'), units: n('receipt', 'unit_no'),
          newHeads: p.newHeads, differ: p.differ.length, differTop: summarise(p.differ), notInErp: p.notInErp, erpNoHeadLeft: p.erpNoHeadLeft, issues: p.issues.slice(0, 30),
          sample: p.fills.slice(0, 20).map((f) => ({ ref: f.ref, ...f.set })) });
      }
      const out = await db.tx(async (t) => { await t.q("set local statement_timeout = '120s'").catch(() => {}); return CF.commit(t, parsed, { book: 'aspire', projectId, user: u, source: name }); });
      const { plan: _p, ...rest } = out;
      return res.json({ ok: true, file: name, ...rest });
    }
    // Dream Aspire's TDS: Accounts' "TDS Working" and "TDS Challan Summary" in "01 – Accounts (Aspire)" on Drive
    // (lib/tds-working.js): PAN, section and TDS onto the payments, and each payment's challan and deposit date
    if (b.action === 'aspire-tds-preview' || b.action === 'aspire-tds-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const T = require('../lib/tds-working');
      const files = [];
      if (process.env.TDS_WORKING_FIXTURE_DIR && process.env.VERCEL !== '1') {
        const fs = require('fs'), path = require('path');
        for (const f of fs.readdirSync(process.env.TDS_WORKING_FIXTURE_DIR)) if (/\.xlsx$/i.test(f)) files.push({ name: f, buf: fs.readFileSync(path.join(process.env.TDS_WORKING_FIXTURE_DIR, f)) });
      } else {
        const drive = require('../lib/drive');
        const folder = process.env.ASPIRE_ACCOUNTS_FOLDER || '1RzBRw72hX5HyZEh37ZTNTD651P-v1nng';
        const list = (await drive.statementFiles([folder]).catch((e) => { throw fail(400, `Could not open the "01 – Accounts (Aspire)" folder on Drive: ${e.message}. Share it with ${sheets.serviceEmail() || 'the ERP'}.`); }))
          .filter((f) => /tds/i.test(f.name) && /\.xlsx?$/i.test(f.name)).sort((x, y) => String(y.modifiedTime).localeCompare(String(x.modifiedTime)));
        // the newest working and the newest challan summary
        for (const kind of [(n) => /challan/i.test(n), (n) => !/challan/i.test(n)]) { const f = list.find((x) => kind(x.name)); if (f) files.push({ name: f.name, buf: await drive.download(f) }); }
      }
      const data = T.parse(files);
      if (!data.work.length) throw fail(400, 'No "TDS Working" sheet with TDS rows in "01 – Accounts (Aspire)".');
      const used = files.map((f) => f.name).join(', ');
      if (b.action === 'aspire-tds-preview') {
        const p = await T.plan(db.q, data, { book: 'aspire' });
        return res.json({ files: used, rows: p.workRows, challans: p.challans, matched: p.matched, filled: p.fills.length, pans: p.pans, tds: p.tds, challansPlaced: p.challansPlaced,
          lateDeposits: p.lateDeposits, notDeposited: p.notDeposited, summary: p.summary, unmatched: p.unmatched.length, unmatchedTop: p.unmatched.sort((x, y) => y.tds - x.tds).slice(0, 25), sample: p.fills.slice(0, 15) });
      }
      const out = await db.tx(async (t) => { await t.q("set local statement_timeout = '120s'").catch(() => {}); return T.commit(t, data, { book: 'aspire', user: u, source: used }); });
      return res.json({ ok: true, files: used, filled: out.fills.length, pans: out.pans, tds: out.tds, challansPlaced: out.challansPlaced, lateDeposits: out.lateDeposits, notDeposited: out.notDeposited, summary: out.summary });
    }
    if (b.action === 'aspire-contacts-preview' || b.action === 'aspire-contacts-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const C = require('../lib/import-aspire-contacts');
      let buf, name;
      if (b.fileB64) { buf = Buffer.from(String(b.fileB64), 'base64'); name = String(b.fileName || 'uploaded workbook').slice(0, 200); }
      else if (process.env.IMPORT_ASPIRE_CONTACTS_FIXTURE && process.env.VERCEL !== '1') { buf = require('fs').readFileSync(process.env.IMPORT_ASPIRE_CONTACTS_FIXTURE); name = 'collection report (fixture)'; }
      else {
        const drive = require('../lib/drive');
        const files = (await drive.statementFiles([ASPIRE_CRM_FOLDER()]).catch((e) => { throw fail(400, `Could not open the Aspire CRM folder on Drive: ${e.message}.`); }))
          .filter((f) => /collection report/i.test(f.name)).sort((x, y) => String(y.modifiedTime).localeCompare(String(x.modifiedTime)));
        if (!files.length) throw fail(400, 'No "Collection Report" workbook in the Aspire CRM folder.');
        buf = await drive.download(files[0]); name = `${files[0].name} (Drive, ${String(files[0].modifiedTime).slice(0, 10)})`;
      }
      let parsed; try { parsed = C.parse(require('../lib/xlsx').read(buf)); } catch (e) { throw fail(400, 'The workbook could not be read: ' + e.message); }
      if (b.action === 'aspire-contacts-preview') {
        const p = await C.plan(db.q, parsed, projectId);
        const n = (k) => p.changes.filter((c) => c.set[k]).length;
        return res.json({ file: name, flats: parsed.flats.length, bookings: p.bookings, buyers: p.changes.length, names: n('name'), phones: n('phone'), emails: n('email'), addresses: n('address'), pans: n('pan'),
          added: p.adds.map((a) => ({ unit: a.unit, name: a.name })), differ: p.differ, issues: p.issues, notInSheet: p.notInSheet });
      }
      const out = await db.tx((t) => C.commit(t, parsed, { projectId, user: u, source: name }));
      const { plan: _p, ...rest } = out;
      return res.json({ ok: true, file: name, ...rest });
    }
    if (b.action === 'aspire-preview' || b.action === 'aspire-commit') {
      const prj = await db.one('select code from projects where id = $1', [projectId]);
      if (prj?.code !== 'ASPIRE') throw fail(400, 'This import is for Dream Aspire only.');
      const { parsed, name } = await readAspire(b);
      if (b.action === 'aspire-preview') return res.json({ file: name, summary: parsed.summary, issues: parsed.issues, plans: parsed.plans.map((p) => ({ name: p.name, bookings: p.n, offered: !!p.active })), sample: parsed.bookings.slice(0, 10).map((x) => ({ unit: x.unit_no, buyer: x.applicants.map((a) => a.name).join(' / '), av: x.agreement_value, received: x.received, dueNow: x.dueNow, demanded: x.demands.map((d) => d.stage_name) })) });
      const out = await db.tx(async (t) => { await t.q("set local statement_timeout = '120s'").catch(() => {}); return require('../lib/import-aspire').commit(t, parsed, { projectId, user: u, source: `Aspire CRM workbook: ${name}` }); });
      return res.json({ ok: true, file: name, ...out });
    }
    if (b.action === 'preview') {
      const p = await readAndParse(projectId, b.stageDates);
      const kinds = {};
      for (const i of p.issues) (kinds[i.kind] = kinds[i.kind] || []).length < 5 && kinds[i.kind].push(i);
      return res.json({ summary: p.summary, stageDates: p.stageDates, examples: kinds, sample: p.bookings.slice(0, 8).map((x) => ({ unit: x.unit_no, buyer: x.applicants[0].name, av: x.agreement_value, demanded: x.demands.map((d) => d.stage_name), receipts: x.receipts.length })) });
    }
    // Development charges (amenity and possession) for the flats already in the ERP, from the sheet's "Development C."
    // column. Only that one figure is written; nothing else changes.
    if (b.action === 'dev-charges') {
      const p = await readAndParse(projectId, b.stageDates);
      const rows = p.bookings.filter((x) => x.dev_charges > 0).map((x) => ({ unit_no: x.unit_no, dev: x.dev_charges }));
      const up = await db.q(`update bookings b set dev_charges = x.dev from json_to_recordset($2::json) as x(unit_no text, dev numeric), units u
        where u.id = b.unit_id and u.project_id = $1 and u.unit_no = x.unit_no and b.status in ('active', 'pending') and b.dev_charges is distinct from x.dev returning b.id`, [projectId, JSON.stringify(rows)]);
      await require('../lib/audit').record(db.q, { user: u, action: 'dev-charges', entity: 'bookings', after: { inSheet: rows.length, updated: up.length } });
      return res.json({ ok: true, inSheet: rows.length, updated: up.length });
    }
    if (b.action === 'commit') {
      const p = await readAndParse(projectId, b.stageDates);
      const days = await daysToPay(db);
      const out = await db.tx(async (t) => { const o = await commit(t, p, { projectId, user: u, source: `CRM master sheet ${sheetId()}`, daysToPay: days }); o.relinked = await sample.relink(t, projectId); return o; });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'reset') {
      if (process.env.ERP_LIVE === '1') throw fail(403, 'The ERP is live, so imported data can no longer be cleared.');
      if (b.confirm !== 'CLEAR') throw fail(400, 'Type CLEAR to confirm.');
      const n = await db.tx(async (t) => {
        await t.q("set local statement_timeout = '120s'").catch(() => {});
        const c = await t.one('select count(*)::int as units from units where project_id = $1', [projectId]);
        await sample.wipe(t, projectId);
        await audit.record(t.q, { user: u, action: 'clear-import', entity: 'project', entityId: projectId, projectId, after: c, note: 'Test version: imported data cleared to import again' });
        return c.units;
      }).catch((e) => { if (e.code === '23503') throw fail(409, `Could not clear: ${e.detail || e.message} (${e.constraint || e.table || ''}).`); throw e; });
      return res.json({ ok: true, removedUnits: n });
    }
    throw fail(400, 'Unknown action.');
  },
});
