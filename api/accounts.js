// Accounts: the Master Accounts sheet's registers and reports.
// GET ?view=todo | balances&date= | lists | checks&project= | report&name=&project=&fy=&head= | tally&from=&to=&format=xml|csv | import
// GET ?reg=receipts|payments|daily|pdc|tds|recon|compliance|tenants|rentLinks&q=&from=&to=&filter=&limit=&offset=
// POST {action:'save', reg, id?, data} · {action:'delete', reg, id, reason} · {action:'stated', bankId, date, balance}
//      {action:'head', side, name, ...} · {action:'bank', name} · {action:'import-preview'|'import', projectId}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const sheets = require('../lib/sheets');
const acc = require('../lib/accounts');
const accImport = require('../lib/acc-import');
const tally = require('../lib/tally-import');
const cancellations = require('../lib/cancellations');
const { REGISTERS } = require('../lib/acc-schema');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
async function readSheet() {
  if (process.env.ACC_FIXTURE && process.env.VERCEL !== '1') return require(process.env.ACC_FIXTURE); // local tests only
  if (!sheets.configured()) throw fail(400, 'The ERP is not connected to Google Sheets yet.');
  return sheets.fetchRanges(accImport.SHEET_ID, accImport.TABS).catch((e) => { throw fail(400, e.message); });
}

// Month-end close: once Head Accounts closes a month, a row dated on or before that day can be changed only by
// Head Accounts or the Admin, with a reason, and the change is marked in the audit log.
async function closedTo() { return (await db.one("select value from settings where key = 'acc_closed_to'"))?.value || null; }
async function guardClosed(u, reg, dates, reason) {
  const c = await closedTo(); if (!c || !c.date) return null;
  const hit = dates.filter(Boolean).map((d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10)).some((d) => d <= c.date);
  if (!hit) return null;
  if (!has(u, 'accounts.manage') && u.role !== 'admin') throw fail(403, `The books are closed up to ${c.date}. Only Head Accounts can change an entry in a closed month.`);
  if (!str(reason, 300)) throw fail(400, `The books are closed up to ${c.date}. Say why this entry in a closed month is being changed.`);
  return c.date;
}

module.exports = route({
  GET: async (req, res) => {
    // The Tally link (lib/tally-feed.js): Tally's server fetches vouchers with its own key, no ERP login.
    if ((req.query || {}).tally === 'feed') {
      const TF = require('../lib/tally-feed'), q = req.query;
      if (!(await TF.check(req.headers['x-erp-key'] || q.key))) throw fail(401, 'Wrong or missing key.');
      const D = /^\d{4}-\d{2}-\d{2}$/;
      const raw = await TF.rows({ from: D.test(q.from || '') ? q.from : null, to: D.test(q.to || '') ? q.to : null, all: q.all === '1' });
      const list = TF.mapped(raw, (await TF.settings()).ledgerMap);
      await TF.notePull(list.length, raw);
      if (q.format === 'json') return res.json({ company: (await TF.settings()).company, count: list.length, vouchers: TF.json(list) });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.end(TF.xml(list, (await TF.settings()).company));
    }
    const u = await auth.guard(req, res, null); if (!u) return;
    const q = req.query || {};
    // Head CRM sees the CRM/Accounts Audit tab (view only): its checks, Reconciling Items and Cancelled flats, not the rest of Accounts.
    if (!has(u, 'accounts.view') && !(has(u, 'audit.tabs') && (q.reg ? ['recon', 'cancellations'].includes(q.reg) : ['checks', 'lists'].includes(q.view)))) throw fail(403, 'Your role does not allow this.');
    const can = { enter: has(u, 'accounts.enter'), manage: has(u, 'accounts.manage') };
    if (q.reg) {
      const reg = REGISTERS[q.reg]; if (!reg) throw fail(400, 'Unknown register.');
      // column filters come as m_<column>=value|value (e.g. m_head=Salary|Rent); by=<column>|month adds totals by it
      const match = {}; for (const c of acc.filterCols(reg)) { const v = q['m_' + c.key]; if (v) match[c.key] = String(v).split('|').map((x) => x.trim()).filter(Boolean).slice(0, 50); }
      const opts = { q: str(q.q, 80), from: DATE.test(q.from || '') ? q.from : null, to: DATE.test(q.to || '') ? q.to : null, filter: str(q.filter, 20), match };
      const by = str(q.by, 30) || null;
      const G = by ? await acc.groups(q.reg, opts, by) : null;
      const fLabel = Object.entries(match).map(([k, v]) => `${reg.cols.find((c) => c.key === k).label}: ${v.join(', ')}`).join(' · ');
      // Excel or print: every row the search finds (not only the first page), the columns on screen, a total row,
      // and a total for each payee / payer so "everything paid to X" is one figure.
      if (q.export === 'xlsx' || q.export === 'rows') {
        const all = []; let total = 0, amount = null;
        for (let off = 0; off < 20000; off += 2000) { const L = await acc.list(q.reg, { ...opts, limit: 2000, offset: off }); all.push(...L.rows); total = L.total; amount = L.amount; if (all.length >= L.total || !L.rows.length) break; }
        const keys = String(q.cols || '').split(',').filter(Boolean);
        const colOf = (k) => (k === 'ref_id' ? { key: 'ref_id', label: reg.idLabel || 'ID', type: 'text' } : reg.cols.find((c) => c.key === k));
        const cols = (keys.length ? keys.map(colOf) : [...(reg.prefix ? [colOf('ref_id')] : []), ...reg.cols]).filter((c) => c && c.key !== 'needs');
        const who = reg.cols.some((c) => c.key === 'payee') ? 'payee' : reg.cols.some((c) => c.key === 'payer_name') ? 'payer_name' : null;
        const amt = reg.cols.some((c) => c.key === 'amount') ? 'amount' : null;
        const byWho = who && amt ? Object.entries(all.reduce((m, r) => { const k = (r[who] || '(no name)').trim(); m[k] = m[k] || { n: 0, amt: 0 }; m[k].n++; m[k].amt += Number(r[amt]) || 0; return m; }, {})).sort((a, b) => b[1].amt - a[1].amt) : [];
        const when = [opts.from, opts.to].some(Boolean) ? `${opts.from || 'start'} to ${opts.to || 'today'}` : 'all dates';
        const head = { title: reg.title, search: opts.q || '', filters: fLabel, when, rows: total, amount };
        if (q.export === 'rows') return res.json({ head, cols, rows: all, groups: G, byWho: byWho.map(([k, v]) => ({ name: k, n: v.n, amount: Math.round(v.amt * 100) / 100 })), whoLabel: who === 'payee' ? 'Payee' : 'Payer' });
        const cell = (c, v) => (v == null || v === '' ? '' : ['money', 'num'].includes(c.type) ? Number(v) : c.type === 'pct' ? Number(v) : c.type === 'date' ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : String(v));
        const sheet = [[`${reg.title}${opts.q ? ' · search: ' + opts.q : ''}${fLabel ? ' · ' + fLabel : ''} · ${when}`], [], cols.map((c) => c.label), ...all.map((r) => cols.map((c) => cell(c, r[c.key])))];
        if (amt) { const i = cols.findIndex((c) => c.key === amt); const t = cols.map(() => ''); t[0] = `Total (${total} rows)`; if (i >= 0) t[i] = Math.round((amount || 0) * 100) / 100; sheet.push([], t); }
        const sheets = [{ name: reg.title, rows: sheet, widths: cols.map((c) => (c.type === 'long' ? 40 : ['payee', 'head', 'payer_name', 'description'].includes(c.key) ? 30 : 14)) }];
        if (G && G.rows.length) {
          const r2 = (v) => Math.round((v || 0) * 100) / 100, td = !!G.tillDate;
          sheets.splice(0, 0, { name: `Total by ${G.label}`.slice(0, 31), rows: [[`${reg.title} · total by ${G.label}${fLabel ? ' · ' + fLabel : ''}`], [],
            [G.label, `Rows (${when})`, `Total (${when})`, 'Share', ...(td ? ['Rows (project till date)', 'Total (project till date)'] : [])],
            ...G.rows.map((g) => [g.name, g.n, g.amount != null ? r2(g.amount) : '', amount ? Math.round((g.amount || 0) / amount * 1000) / 10 + '%' : '', ...(td ? [g.tdN, r2(g.tdAmount)] : [])]), [],
            ['Total', total, r2(amount), '', ...(td ? [G.tillDate.n, r2(G.tillDate.amount)] : [])]], widths: [40, 12, 18, 8, ...(td ? [14, 20] : [])] });
        }
        if (byWho.length && !(G && G.by === who)) sheets.push({ name: `Total by ${who === 'payee' ? 'payee' : 'payer'}`, rows: [[who === 'payee' ? 'Payee' : 'Payer', 'Rows', 'Total'], ...byWho.map(([k, v]) => [k, v.n, Math.round(v.amt * 100) / 100]), [], ['Total', total, Math.round((amount || 0) * 100) / 100]], widths: [40, 8, 16] });
        const name = `${reg.title}${opts.q ? ' - ' + opts.q : ''} ${new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10)}.xlsx`.replace(/[^A-Za-z0-9 ._-]+/g, '');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        return res.end(require('../lib/xlsx-write').write(sheets));
      }
      const L = await acc.list(q.reg, { ...opts, limit: intOr(q.limit, 200), offset: intOr(q.offset, 0) });
      return res.json({ ...L, groups: G, filterCols: acc.filterCols(reg).map((c) => c.key), reg: { key: q.reg, title: reg.title, help: reg.help, prefix: reg.prefix || null, idLabel: reg.idLabel || null, dateKey: reg.dateKey || null, cols: reg.cols }, lists: await acc.lists(), can });
    }
    switch (q.view) {
      case 'todo': return res.json({ ...(await acc.todo()), can });
      case 'tallylink': return res.json({ ...(await require('../lib/tally-feed').status()), ledgers: await require('../lib/tally-feed').ledgers(), can });
      case 'capack': {
        const P = require('../lib/ca-pack');
        if (q.download) { const ym = /^\d{4}-\d{2}$/.test(q.download) ? q.download : P.prevMonth(); const p = await P.build(ym);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${p.filename}"`); return res.end(p.file); }
        return res.json({ ...(await P.status()), can });
      }
      case 'bills': return res.json({ bills: has(u, 'accounts.enter') ? await acc.approvedBills() : [], tds: await acc.headTds(), can });
      case 'balances': { const dd = DATE.test(q.date || '') ? q.date : today(); const cf = await db.one("select done_at, info from job_marks where key = $1", ['daily-confirm:' + dd]); return res.json({ ...(await acc.balances(dd)), confirmed: cf ? { at: cf.done_at, ...cf.info } : null, closed: await closedTo(), can }); }
      case 'lists': return res.json({ lists: await acc.lists(), heads: await db.q("select * from acc_heads where book = 'signature' order by side, name"), banks: await db.q("select * from acc_banks where book = 'signature' order by name"), dailyBanks: await db.q("select * from acc_daily_banks where book = 'signature' order by seq, id"), can });
      case 'checks': return res.json({ rows: await acc.checks(q.project ? needProject(u, intOr(q.project)) : null), closed: await closedTo(), can });
      case 'report': {
        const R = await acc.report(str(q.name, 20), { projectId: q.project ? needProject(u, intOr(q.project)) : null, fy: intOr(q.fy), head: str(q.head, 80), from: str(q.from, 7), to: str(q.to, 7), bank: str(q.bank, 120) });
        if (q.name === 'byHead' && q.export === 'xlsx') { // the same grid as on screen, one sheet
          const ml = (m) => { const [y, mo] = m.split('-'); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1]}-${y.slice(2)}`; };
          const r0 = (v) => Math.round(v || 0);
          const head = ['Cash Flow Head', ...R.months.map(ml), `Total ${ml(R.from)} to ${ml(R.to)}`, 'Project till date'];
          const sec = (title, B) => [[title], head, ...[...B.rows, B.total].map((x) => [x.head, ...R.months.map((m) => r0(x.months[m])), r0(x.total), r0(x.tillDate)]), []];
          const rows = [[`Receipts and payments by cash flow head, by month${R.bank ? ' · ' + R.bank : ''}`], ['Bounced cheques are left out of the receipts figures.'], [],
            ...sec('RECEIPTS (money in, excluding bounced cheques)', R.receipts), ...sec('CUSTOMER RECEIPTS BY PAYMENT HEAD (AV / GST / SDR)', R.customer), ...sec('PAYMENTS (money out)', R.payments)];
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="Payments by Head ${R.from} to ${R.to}.xlsx"`);
          return res.end(require('../lib/xlsx-write').write([{ name: 'Payments by Head', rows, widths: [34, ...R.months.map(() => 12), 16, 16] }]));
        }
        return res.json(R);
      }
      case 'tally': {
        const from = DATE.test(q.from || '') ? q.from : today().slice(0, 8) + '01', to = DATE.test(q.to || '') ? q.to : today();
        const csv = q.format === 'csv';
        const body = await acc.tally(from, to, csv ? 'csv' : 'xml');
        res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="tally_${from}_to_${to}.${csv ? 'csv' : 'xml'}"`);
        return res.end(csv ? '﻿' + body : body);
      }
      case 'import': {
        const last = await db.one("select at as created_at, after, (select name from users where id = audit_log.user_id) as by_name from audit_log where action = 'import-accounts' order by id desc limit 1");
        const lastTally = await db.one("select at as created_at, after, (select name from users where id = audit_log.user_id) as by_name from audit_log where action = 'import-tally' order by id desc limit 1");
        const lastRefunds = await db.one("select at as created_at, after, (select name from users where id = audit_log.user_id) as by_name from audit_log where action = 'import-refund-list' order by id desc limit 1");
        return res.json({ configured: sheets.configured() || !!(process.env.ACC_FIXTURE && process.env.VERCEL !== '1'), sheetId: accImport.SHEET_ID, last, lastTally, lastRefunds, can, live: process.env.ERP_LIVE === '1' });
      }
      default: throw fail(400, 'Unknown view.');
    }
  },
  POST: async (req, res, b) => {
    if (b.action === 'tally-ack') {
      const TF = require('../lib/tally-feed');
      if (!(await TF.check(req.headers['x-erp-key'] || b.key))) throw fail(401, 'Wrong or missing key.');
      return res.json(await TF.ack(b.done));
    }
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };
    if (b.action === 'save') {
      need('accounts.enter');
      const reg = REGISTERS[b.reg]; if (!reg) throw fail(400, 'Unknown register.');
      const id = intOr(b.id);
      const data = await acc.cleanRow(b.reg, b.data || {}, { partial: !!id });
      // Payments Out: the TDS section and rate come from the payment head when not typed; TDS = taxable value × rate.
      if (b.reg === 'payments' && data.head) {
        const T = (await acc.headTds())[data.head];
        if (T) {
          if (data.tds_section == null || data.tds_section === '') data.tds_section = T.sec;
          if ((data.tds_rate == null || data.tds_rate === '') && T.rate != null) data.tds_rate = T.rate;
          if ((data.tds_deducted == null || data.tds_deducted === '') && data.taxable_value != null && data.taxable_value !== '' && data.tds_rate != null) data.tds_deducted = Math.round(Number(data.taxable_value) * Number(data.tds_rate));
        }
      }
      const dk = reg.dateKey;
      const prev = id && dk ? await db.one(`select ${dk} as d from ${reg.table} where id = $1 and book = $2`, [id, acc.BOOK]) : null;
      const closedOn = dk ? await guardClosed(u, b.reg, [data[dk], prev && prev.d], b.reason) : null;
      // paid against an approved purchase bill: checked, saved and the Purchase order marked Paid in one transaction
      const poId = b.reg === 'payments' && b.poId && !id ? str(b.poId, 60) : null;
      const out = await db.tx(async (t) => {
        const bill = poId ? await acc.billToPay(t, poId, { amount: data.amount, tds: data.tds_deducted, user: u }) : null;
        if (id) {
          const before = await t.one(`select * from ${reg.table} where id = $1 and book = $2`, [id, acc.BOOK]);
          if (!before) throw fail(404, 'Row not found.');
          const cols = Object.keys(data); if (!cols.length) throw fail(400, 'Nothing to change.');
          await t.q(`update ${reg.table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${cols.length + 2}, updated_at = now() where id = $1`, [id, ...cols.map((c) => data[c]), u.id]);
          const changed = Object.fromEntries(cols.filter((c) => String(before[c] ?? '') !== String(data[c] ?? '')).map((c) => [c, data[c]]));
          await audit.record(t.q, { user: u, action: closedOn ? 'update-closed-month' : 'update', entity: 'acc-' + b.reg, entityId: id, before: Object.fromEntries(Object.keys(changed).map((c) => [c, before[c]])), after: changed, note: closedOn ? `Books closed to ${closedOn}. Reason: ${str(b.reason, 300)}` : null });
          return { id, ref_id: before.ref_id };
        }
        const ref = await acc.nextRef(t, reg);
        const cols = Object.keys(data).filter((c) => data[c] !== null);
        const row = await t.one(`insert into ${reg.table} (book, created_by${ref ? ', ref_id' : ''}${cols.map((c) => ', ' + c).join('')}) values ($1, $2${ref ? ', $3' : ''}${cols.map((c, i) => `, $${i + (ref ? 4 : 3)}`).join('')}) returning id`,
          [acc.BOOK, u.id, ...(ref ? [ref] : []), ...cols.map((c) => data[c])]);
        await audit.record(t.q, { user: u, action: closedOn ? 'create-closed-month' : 'create', entity: 'acc-' + b.reg, entityId: row.id, after: { ref, ...data, ...(poId ? { purchaseBill: poId } : {}) }, note: closedOn ? `Books closed to ${closedOn}. Reason: ${str(b.reason, 300)}` : null });
        if (bill) await acc.markBillPaid(t, poId, bill, { amount: data.amount, ref: data.reference, date: data[dk], paymentId: ref, user: u });
        return { id: row.id, ref_id: ref, ...(bill ? { billPaid: true } : {}) };
      });
      return res.json({ ok: true, ...out });
    }
    // TDS Tracker from the TDS portal only (26AS / Annual Tax Statement, Part IV: buyers' TDS on flat purchases):
    // every row now in the tracker is replaced by the portal's entries, one per TDS certificate.
    if (b.action === 'tds-portal-replace') {
      need('accounts.manage');
      if (b.confirm !== 'REPLACE') throw fail(400, 'Type REPLACE to confirm.');
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length || rows.length > 5000) throw fail(400, 'No portal rows sent.');
      const D = /^\d{4}-\d{2}-\d{2}$/;
      const clean = rows.map((r, i) => {
        const x = { paid_on: D.test(r.paid_on || '') ? r.paid_on : null, unit_no: str(r.unit_no, 20).toUpperCase() || null, customer: str(r.customer, 160) || null, demand: str(r.demand, 160) || null,
          demand_amount: Number(r.demand_amount) || null, tds_amount: Number(r.tds_amount), challan_no: str(r.challan_no, 60) || null, cert_no: str(r.cert_no, 60) || null,
          source: str(r.source, 120) || 'TDS portal', remark: str(r.remark, 400) || null };
        if (!x.paid_on || !(x.tds_amount > 0)) throw fail(400, `Row ${i + 1}: date or TDS amount missing.`);
        return x;
      });
      const out = await db.tx(async (t) => {
        const before = await t.one('select count(*)::int as n, coalesce(sum(tds_amount), 0) as amt from acc_tds_entries where book = $1', [acc.BOOK]);
        await t.q('delete from acc_tds_entries where book = $1', [acc.BOOK]);
        clean.sort((a, z) => a.paid_on.localeCompare(z.paid_on));
        let k = 0;
        for (const x of clean) {
          k++;
          await t.q(`insert into acc_tds_entries (book, ref_id, paid_on, unit_no, customer, demand, demand_amount, tds_amount, challan_no, cert_no, source, remark, imported, created_by)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)`,
          [acc.BOOK, 'TDS' + String(k).padStart(4, '0'), x.paid_on, x.unit_no, x.customer, x.demand, x.demand_amount, x.tds_amount, x.challan_no, x.cert_no, x.source, x.remark, u.id]);
        }
        const after = { n: clean.length, amt: Math.round(clean.reduce((a, x) => a + x.tds_amount, 0) * 100) / 100, noFlat: clean.filter((x) => !x.unit_no).length };
        await audit.record(t.q, { user: u, action: 'tds-portal-replace', entity: 'acc-tds', entityId: 'signature', before: { rows: before.n, tds: Number(before.amt) }, after, note: 'TDS Tracker replaced with the TDS portal entries' });
        return { before: { rows: before.n, tds: Number(before.amt) }, after };
      });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'delete') {
      need('accounts.manage');
      const reg = REGISTERS[b.reg]; if (!reg) throw fail(400, 'Unknown register.');
      if (['receipts', 'payments'].includes(b.reg)) throw fail(400, 'Receipts and payments are never deleted. A bounced cheque is marked Bounced; a wrong entry is corrected.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Say why this row is being removed.');
      if (reg.dateKey) { const r0 = await db.one(`select ${reg.dateKey} as d from ${reg.table} where id = $1 and book = $2`, [intOr(b.id), acc.BOOK]); if (r0) await guardClosed(u, b.reg, [r0.d], reason); }
      await db.tx(async (t) => {
        const before = await t.one(`delete from ${reg.table} where id = $1 and book = $2 returning *`, [intOr(b.id), acc.BOOK]);
        if (!before) throw fail(404, 'Row not found.');
        await audit.record(t.q, { user: u, action: 'delete', entity: 'acc-' + b.reg, entityId: before.id, before, note: reason });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'tally-link') {
      if (!has(u, 'accounts.manage') && u.role !== 'admin') throw fail(403, 'Only Head Accounts or the Admin sets up the Tally link.');
      const TF = require('../lib/tally-feed');
      if (b.start != null) { if (b.start && !/^\d{4}-\d{2}-\d{2}$/.test(b.start)) throw fail(400, 'Choose the start date.'); await TF.save({ ...(await TF.settings()), start: b.start || null }); }
      if (b.ledgerMap && typeof b.ledgerMap === 'object') { const m = {}; for (const [k, v] of Object.entries(b.ledgerMap).slice(0, 2000)) { const t = str(v, 150); if (t && t !== k) m[str(k, 150)] = t; } await TF.save({ ...(await TF.settings()), ledgerMap: m }); }
      if (b.company != null) { const c = str(b.company, 120); if (!c) throw fail(400, 'Type the company name exactly as it is in Tally.'); await TF.save({ ...(await TF.settings()), company: c }); }
      let key = null;
      if (b.newKey) { key = await TF.newKey(u); await audit.record(db.q, { user: u, action: 'tally-key', entity: 'settings', entityId: 'tally_feed', note: 'New Tally link key made; any earlier key stopped working' }); }
      return res.json({ ok: true, key, status: await TF.status() });
    }
    if (b.action === 'close-month') {
      if (!has(u, 'accounts.manage') && u.role !== 'admin') throw fail(403, 'Only Head Accounts closes the month.');
      const m = String(b.month || ''); if (!/^\d{4}-\d{2}$/.test(m)) throw fail(400, 'Choose the month.');
      const end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
      if (end >= today()) throw fail(400, 'A month can be closed only after it has ended.');
      const before = await closedTo();
      if (before && before.date >= end && !b.reopen) throw fail(409, `The books are already closed up to ${before.date}.`);
      const v = b.reopen ? { date: end, by: u.name, at: new Date().toISOString(), reopenedFrom: before && before.date } : { date: end, by: u.name, at: new Date().toISOString() };
      if (b.reopen) { if (!str(b.reason, 300)) throw fail(400, 'Say why the books are being reopened.'); if (!before || end >= before.date) throw fail(400, 'Reopen to a month before the one closed now.'); }
      await db.tx(async (t) => {
        await t.q("insert into settings (key, value) values ('acc_closed_to', $1) on conflict (key) do update set value = excluded.value", [v]);
        await audit.record(t.q, { user: u, action: b.reopen ? 'reopen-books' : 'close-month', entity: 'settings', entityId: 'acc_closed_to', before, after: v, note: str(b.reason, 300) || null });
      });
      return res.json({ ok: true, closed: v });
    }
    if (b.action === 'ca-pack') {
      if (!has(u, 'accounts.manage') && u.role !== 'admin') throw fail(403, 'Only Head Accounts can change or send the CA pack.');
      const P = require('../lib/ca-pack');
      if (b.send) {
        const r = await P.send({ ym: /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : undefined, force: true, user: u });
        if (r.skipped) throw fail(400, r.skipped);
        return res.json({ ok: true, ...r });
      }
      const cur = await P.settings();
      const em = (x) => String(x || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e)).join(', ');
      const v = { ...cur, to: b.to != null ? em(b.to) : cur.to, cc: b.cc != null ? em(b.cc) : cur.cc, on: b.on != null ? !!b.on : cur.on };
      await P.saveSettings(v);
      await audit.record(db.q, { user: u, action: 'update', entity: 'settings', entityId: 'ca_pack', before: cur, after: v });
      return res.json({ ok: true, settings: v });
    }
    if (b.action === 'confirm-day') {
      need('accounts.enter');
      if (!DATE.test(b.date || '')) throw fail(400, 'Enter the date.');
      // the day is confirmed by someone other than the person who typed its bank balances (the Admin excepted)
      if (u.role !== 'admin') {
        const mine = await db.q('select b.name from acc_bank_stated s join acc_daily_banks b on b.id = s.daily_bank_id where s.on_date = $1 and s.created_by = $2 order by b.seq, b.id', [b.date, u.id]);
        if (mine.length) throw fail(403, `You typed the Balance per Bank for ${mine.map((x) => x.name).join(', ')} on this day, so someone else must confirm it.`);
      }
      const bal = await acc.balances(b.date);
      const off = bal.rows.filter((r) => r.difference != null && Math.abs(r.difference) > 1);
      const missing = bal.rows.filter((r) => r.perBank == null && (r.receipts || r.payments));
      if ((off.length || missing.length) && !str(b.note, 300)) throw fail(400, `${off.length ? off.map((r) => r.bank).join(', ') + ' do not agree with the bank' : ''}${off.length && missing.length ? '; ' : ''}${missing.length ? missing.map((r) => r.bank).join(', ') + ' have no bank balance typed' : ''}. Add a note to confirm anyway.`);
      const info = { by: u.name, userId: u.id, note: str(b.note, 300) || null, closing: bal.groups.reduce((a, g) => a + g.closing, 0) };
      await db.q("insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()", ['daily-confirm:' + b.date, info]);
      await audit.record(db.q, { user: u, action: 'confirm-day', entity: 'acc-daily', entityId: b.date, after: info });
      return res.json({ ok: true });
    }
    if (b.action === 'stated') {
      need('accounts.enter');
      const bank = await db.one('select * from acc_daily_banks where id = $1', [intOr(b.bankId)]); if (!bank) throw fail(404, 'Bank not found.');
      if (!DATE.test(b.date || '')) throw fail(400, 'Enter the date.');
      await guardClosed(u, 'daily', [b.date], b.reason);
      const bal = b.balance === '' || b.balance == null ? null : Number(String(b.balance).replace(/[₹,\s]/g, ''));
      await db.tx(async (t) => {
        if (bal == null) await t.q('delete from acc_bank_stated where daily_bank_id = $1 and on_date = $2', [bank.id, b.date]);
        else { if (!Number.isFinite(bal)) throw fail(400, 'Enter the balance in rupees.'); await t.q('insert into acc_bank_stated (daily_bank_id, on_date, balance, created_by) values ($1, $2, $3, $4) on conflict (daily_bank_id, on_date) do update set balance = excluded.balance, created_by = excluded.created_by', [bank.id, b.date, bal, u.id]); }
        await audit.record(t.q, { user: u, action: 'bank-balance', entity: 'acc-bank', entityId: bank.id, after: { bank: bank.name, date: b.date, balance: bal } });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'head') {
      need('accounts.manage');
      const side = b.side === 'receipt' ? 'receipt' : b.side === 'payment' ? 'payment' : null, name = str(b.name, 120);
      if (!side || !name) throw fail(400, 'Choose receipt or payment and give the head a name.');
      const rate = b.tdsRate === '' || b.tdsRate == null ? null : Number(String(b.tdsRate).replace(/[%\s]/g, '')) / 100; // typed as a percentage: 1 = 1%
      if (rate != null && !(rate >= 0 && rate <= 1)) throw fail(400, 'TDS rate: a percentage, e.g. 1 or 0.1.');
      await db.tx(async (t) => {
        await t.q(`insert into acc_heads (book, side, name, section, indirect_line, tds_section, tds_rate, category, note, needs_bill, payee_type, active) values ('signature', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                   on conflict (book, side, name) do update set section = excluded.section, indirect_line = excluded.indirect_line, tds_section = excluded.tds_section, tds_rate = excluded.tds_rate,
                   category = excluded.category, note = excluded.note, needs_bill = excluded.needs_bill, payee_type = excluded.payee_type, active = excluded.active`,
        [side, name, str(b.section, 60) || null, str(b.indirectLine, 120) || null, str(b.tdsSection, 20) || null, Number.isFinite(rate) ? rate : null, str(b.category, 120) || null, str(b.note, 300) || null, !!b.needsBill, str(b.payeeType, 60) || null, b.active !== false]);
        await audit.record(t.q, { user: u, action: 'head', entity: 'acc-head', entityId: `${side}:${name}`, after: b });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'bank') {
      need('accounts.manage');
      const name = str(b.name, 120); if (!name) throw fail(400, 'Give the bank account name as it should appear in Receipts and Payments Out.');
      await db.tx(async (t) => { await t.q("insert into acc_banks (book, name, account_no) values ('signature', $1, $2) on conflict (book, name) do update set account_no = excluded.account_no", [name, str(b.accountNo, 40) || null]); await audit.record(t.q, { user: u, action: 'bank', entity: 'acc-bank', entityId: name, after: b }); });
      return res.json({ ok: true });
    }
    if (b.action === 'tally-split') {
      // Tally vouchers holding several flats, brought in as one row each: one row per flat (lib/tally-split.js). Safe to run again.
      need('accounts.manage');
      const { split } = require('../lib/tally-split');
      const out = await db.tx(async (t) => {
        const rows = await t.q("select * from acc_receipts where book = $1 and source = 'Tally' and unit_no is null and coalesce(head, '') <> 'Internal transfer' and ref_id not like '%/%' and description like '%;%'", [acc.BOOK]);
        let vouchers = 0, made = 0;
        const C = ['ref_id', 'amount', 'unit_no', 'payer_name', 'head', 'payment_head', 'payer_type', 'remark'];
        for (const r of rows) {
          const ps = split({ ...r, txn_date: r.txn_date instanceof Date ? r.txn_date.toISOString().slice(0, 10) : r.txn_date });
          if (!ps) continue;
          vouchers++;
          const [first, ...rest] = ps;
          await t.q(`update acc_receipts set ${C.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${C.length + 2}, updated_at = now() where id = $1`, [r.id, ...C.map((c) => first[c]), u.id]);
          for (const x of rest) {
            const K = ['book', 'txn_date', 'bank', 'description', 'reference', 'cheque_status', 'source', 'on_statement', ...C];
            await t.q(`insert into acc_receipts (${K.join(', ')}, created_by) values (${K.map((_, i) => '$' + (i + 1)).join(', ')}, $${K.length + 1})`, [...K.map((c) => (c in x ? x[c] : r[c])), u.id]);
            made++;
          }
        }
        await audit.record(t.q, { user: u, action: 'tally-split', entity: 'acc-receipts', after: { vouchers, rowsAdded: made }, note: 'Tally vouchers holding several flats split into one row per flat.' });
        return { vouchers, rowsAdded: made };
      });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'tally-reclassify') {
      // The same Tally files again, read with the corrected rules (a narration line is not a party, a contra is a transfer):
      // only the flat, heads, payer and description of rows already in the ERP are corrected, matched on the Tally ID and
      // amount. Nothing is added or removed, and rows someone else has edited since are left as they are.
      need('accounts.manage');
      let p;
      if (Array.isArray(b.receipts) && Array.isArray(b.payments)) p = { receipts: b.receipts.slice(0, 20000), payments: b.payments.slice(0, 20000) }; // rows already read from the files
      else {
        const files = (Array.isArray(b.files) ? b.files : []).filter((f) => f && f.data).slice(0, 4).map((f) => ({ name: str(f.name, 200), buffer: Buffer.from(String(f.data || ''), 'base64') }));
        if (files.length < 2) throw fail(400, 'Choose the Tally files.');
        p = tally.parse(files, today());
      }
      const out = await db.tx(async (t) => {
        const res2 = { receipts: 0, payments: 0, skipped: 0, examples: [] };
        for (const [table, rows, cols] of [['acc_receipts', p.receipts, ['unit_no', 'head', 'payment_head', 'payer_type', 'payer_name', 'description']], ['acc_payments', p.payments, ['unit_no', 'head', 'payee', 'description']]]) {
          const cur = new Map((await t.q(`select * from ${table} where book = $1 and source = 'Tally'`, [acc.BOOK])).map((r) => [r.ref_id, r]));
          for (const r of rows) {
            const x = cur.get(r.ref_id); if (!x || Math.abs(Number(x.amount) - Number(r.amount)) > 0.01) continue;
            const diff = cols.filter((c) => c in r && String(x[c] ?? '') !== String(r[c] ?? ''));
            if (!diff.length) continue;
            if (x.updated_by && x.updated_by !== u.id) { res2.skipped++; continue; }
            await t.q(`update ${table} set ${diff.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${diff.length + 2}, updated_at = now() where id = $1`, [x.id, ...diff.map((c) => r[c] ?? null), u.id]);
            res2[table === 'acc_receipts' ? 'receipts' : 'payments']++;
            if (diff.includes('unit_no') && res2.examples.length < 20) res2.examples.push(`${r.ref_id}: flat ${x.unit_no || '—'} → ${r.unit_no || '—'} (${r.head})`);
          }
        }
        await audit.record(t.q, { user: u, action: 'tally-reclassify', entity: 'accounts', entityId: 'signature', after: res2, note: 'Tally rows re-read: narration lines are not parties; contra vouchers are transfers.' });
        return res2;
      });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'tally-preview' || b.action === 'tally-import') {
      // Test version: the registers are replaced with the Receipt and Payment Registers exported from Tally.
      need('accounts.manage');
      if (process.env.ERP_LIVE === '1') throw fail(403, 'The ERP is live: the accounts are kept in the ERP now.');
      const files = (Array.isArray(b.files) ? b.files : []).filter((f) => f && f.data).slice(0, 4).map((f) => ({ name: str(f.name, 200), buffer: Buffer.from(String(f.data || ''), 'base64') }));
      if (files.length < 2 || files.some((f) => !f.buffer.length)) throw fail(400, 'Choose both Tally files: the Receipt Register and the Payment Register (.xlsx).');
      const p = tally.parse(files, today());
      if (b.action === 'tally-preview') return res.json({ summary: p.summary, registers: p.registers, problems: p.problems.slice(0, 50) });
      const r = await db.tx(async (t) => {
        const out = await tally.commit(t, p, { user: u });
        await audit.record(t.q, { user: u, action: 'import-tally', entity: 'accounts', entityId: 'signature', after: { ...p.summary, registers: p.registers, ...out } });
        return out;
      });
      r.cheques = await require('../lib/cheque-match').run({ user: u, trigger: 'tally' }).catch((e) => ({ error: e.message }));
      return res.json({ ok: true, summary: p.summary, problems: p.problems, ...r });
    }
    if (b.action === 'refunds-preview' || b.action === 'refunds-import') {
      need('accounts.manage');
      const f = (Array.isArray(b.files) ? b.files : [])[0];
      if (!f || !f.data) throw fail(400, 'Choose the refund list (.xlsx).');
      const p = cancellations.parse(Buffer.from(String(f.data), 'base64'), str(f.name, 200));
      const pend = p.rows.filter((r) => !cancellations.refunded(r.refund_status));
      const info = { file: p.file, sheet: p.sheet, rows: p.rows.length, pending: pend.length, pendingAmount: pend.reduce((a, r) => a + (Number(r.received) || 0), 0), skipped: p.skipped };
      if (b.action === 'refunds-preview') return res.json(info);
      const r = await db.tx(async (t) => {
        const out = await cancellations.commit(t, p, { user: u });
        await audit.record(t.q, { user: u, action: 'import-refund-list', entity: 'accounts', entityId: 'signature', after: { ...info, ...out } });
        return out;
      });
      return res.json({ ok: true, ...info, ...r });
    }
    if (b.action === 'clear') {
      // Test version only: empty every accounts register (banks, cash flow heads and settings stay), to start again from another source.
      need('accounts.manage');
      if (process.env.ERP_LIVE === '1') throw fail(403, 'The ERP is live: accounts data is never cleared.');
      if (b.confirm !== 'CLEAR') throw fail(400, 'Type CLEAR to confirm.');
      const T = ['acc_pdc_mail', 'acc_receipts', 'acc_payments', 'acc_daily_entries', 'acc_pdc', 'acc_tds_entries', 'acc_recon_items', 'acc_compliance', 'acc_rent_links', 'acc_sra_tenants', 'acc_bank_stated', 'acc_stmt_runs', 'acc_cancellations'];
      const out = await db.tx(async (t) => {
        const n = {};
        for (const tb of T) n[tb] = (await t.q(`delete from ${tb} returning 1 as x`)).length;
        n.cpPayments = (await t.q("delete from brokerage_entries where kind = 'payment' and reference = 'CP Commissions tab (accounts sheet)' returning 1 as x")).length;
        await audit.record(t.q, { user: u, action: 'clear-accounts', entity: 'accounts', entityId: 'signature', before: n, note: 'Test version: accounts registers emptied' });
        return n;
      });
      return res.json({ ok: true, removed: out });
    }
    if (b.action === 'import-preview' || b.action === 'import') {
      need('accounts.manage');
      if (process.env.ERP_LIVE === '1') throw fail(403, 'The ERP is live: the accounts are kept in the ERP now, so the sheet is not imported again.');
      const projectId = b.projectId ? needProject(u, intOr(b.projectId)) : null;
      const p = accImport.parse(await readSheet());
      if (b.action === 'import-preview') return res.json({ summary: p.summary, gapExamples: Object.fromEntries(Object.entries(p.skipped).map(([k, v]) => [k, v.slice(0, 5)])) });
      const r = await db.tx(async (t) => {
        const out = await accImport.commit(t, p, { user: u, projectId });
        await audit.record(t.q, { user: u, action: 'import-accounts', entity: 'accounts', entityId: 'signature', after: { ...p.summary, cpPayments: out.cp }, note: `Imported from accounts sheet ${accImport.SHEET_ID}` });
        return out;
      });
      return res.json({ ok: true, summary: p.summary, ...r });
    }
    throw fail(400, 'Unknown action.');
  },
});
