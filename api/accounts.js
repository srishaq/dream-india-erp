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

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const q = req.query || {};
    const can = { enter: has(u, 'accounts.enter'), manage: has(u, 'accounts.manage') };
    if (q.reg) {
      const reg = REGISTERS[q.reg]; if (!reg) throw fail(400, 'Unknown register.');
      const L = await acc.list(q.reg, { q: str(q.q, 80), from: DATE.test(q.from || '') ? q.from : null, to: DATE.test(q.to || '') ? q.to : null, filter: str(q.filter, 20), limit: intOr(q.limit, 200), offset: intOr(q.offset, 0) });
      return res.json({ ...L, reg: { key: q.reg, title: reg.title, help: reg.help, prefix: reg.prefix || null, idLabel: reg.idLabel || null, cols: reg.cols }, lists: await acc.lists(), can });
    }
    switch (q.view) {
      case 'todo': return res.json({ ...(await acc.todo()), can });
      case 'balances': return res.json({ ...(await acc.balances(DATE.test(q.date || '') ? q.date : today())), can });
      case 'lists': return res.json({ lists: await acc.lists(), heads: await db.q("select * from acc_heads where book = 'signature' order by side, name"), banks: await db.q("select * from acc_banks where book = 'signature' order by name"), dailyBanks: await db.q("select * from acc_daily_banks where book = 'signature' order by seq, id"), can });
      case 'checks': return res.json({ rows: await acc.checks(q.project ? needProject(u, intOr(q.project)) : null), can });
      case 'report': return res.json(await acc.report(str(q.name, 20), { projectId: q.project ? needProject(u, intOr(q.project)) : null, fy: intOr(q.fy), head: str(q.head, 80) }));
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
        return res.json({ configured: sheets.configured() || !!(process.env.ACC_FIXTURE && process.env.VERCEL !== '1'), sheetId: accImport.SHEET_ID, last, lastTally, can, live: process.env.ERP_LIVE === '1' });
      }
      default: throw fail(400, 'Unknown view.');
    }
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'accounts.view'); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };
    if (b.action === 'save') {
      need('accounts.enter');
      const reg = REGISTERS[b.reg]; if (!reg) throw fail(400, 'Unknown register.');
      const id = intOr(b.id);
      const data = await acc.cleanRow(b.reg, b.data || {}, { partial: !!id });
      const out = await db.tx(async (t) => {
        if (id) {
          const before = await t.one(`select * from ${reg.table} where id = $1 and book = $2`, [id, acc.BOOK]);
          if (!before) throw fail(404, 'Row not found.');
          const cols = Object.keys(data); if (!cols.length) throw fail(400, 'Nothing to change.');
          await t.q(`update ${reg.table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${cols.length + 2}, updated_at = now() where id = $1`, [id, ...cols.map((c) => data[c]), u.id]);
          const changed = Object.fromEntries(cols.filter((c) => String(before[c] ?? '') !== String(data[c] ?? '')).map((c) => [c, data[c]]));
          await audit.record(t.q, { user: u, action: 'update', entity: 'acc-' + b.reg, entityId: id, before: Object.fromEntries(Object.keys(changed).map((c) => [c, before[c]])), after: changed });
          return { id, ref_id: before.ref_id };
        }
        const ref = await acc.nextRef(t, reg);
        const cols = Object.keys(data).filter((c) => data[c] !== null);
        const row = await t.one(`insert into ${reg.table} (book, created_by${ref ? ', ref_id' : ''}${cols.map((c) => ', ' + c).join('')}) values ($1, $2${ref ? ', $3' : ''}${cols.map((c, i) => `, $${i + (ref ? 4 : 3)}`).join('')}) returning id`,
          [acc.BOOK, u.id, ...(ref ? [ref] : []), ...cols.map((c) => data[c])]);
        await audit.record(t.q, { user: u, action: 'create', entity: 'acc-' + b.reg, entityId: row.id, after: { ref, ...data } });
        return { id: row.id, ref_id: ref };
      });
      return res.json({ ok: true, ...out });
    }
    if (b.action === 'delete') {
      need('accounts.manage');
      const reg = REGISTERS[b.reg]; if (!reg) throw fail(400, 'Unknown register.');
      if (['receipts', 'payments'].includes(b.reg)) throw fail(400, 'Receipts and payments are never deleted. A bounced cheque is marked Bounced; a wrong entry is corrected.');
      const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Say why this row is being removed.');
      await db.tx(async (t) => {
        const before = await t.one(`delete from ${reg.table} where id = $1 and book = $2 returning *`, [intOr(b.id), acc.BOOK]);
        if (!before) throw fail(404, 'Row not found.');
        await audit.record(t.q, { user: u, action: 'delete', entity: 'acc-' + b.reg, entityId: before.id, before, note: reason });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'stated') {
      need('accounts.enter');
      const bank = await db.one('select * from acc_daily_banks where id = $1', [intOr(b.bankId)]); if (!bank) throw fail(404, 'Bank not found.');
      if (!DATE.test(b.date || '')) throw fail(400, 'Enter the date.');
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
      const rate = b.tdsRate === '' || b.tdsRate == null ? null : Number(String(b.tdsRate).replace('%', '')) / (Number(String(b.tdsRate).replace('%', '')) > 1 ? 100 : 1);
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
      return res.json({ ok: true, summary: p.summary, problems: p.problems, ...r });
    }
    if (b.action === 'clear') {
      // Test version only: empty every accounts register (banks, cash flow heads and settings stay), to start again from another source.
      need('accounts.manage');
      if (process.env.ERP_LIVE === '1') throw fail(403, 'The ERP is live: accounts data is never cleared.');
      if (b.confirm !== 'CLEAR') throw fail(400, 'Type CLEAR to confirm.');
      const T = ['acc_pdc_mail', 'acc_receipts', 'acc_payments', 'acc_daily_entries', 'acc_pdc', 'acc_tds_entries', 'acc_recon_items', 'acc_compliance', 'acc_rent_links', 'acc_sra_tenants', 'acc_bank_stated', 'acc_stmt_runs'];
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
