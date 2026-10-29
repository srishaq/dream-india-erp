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
      const list = TF.mapped(await TF.rows({ from: D.test(q.from || '') ? q.from : null, to: D.test(q.to || '') ? q.to : null, all: q.all === '1' }), (await TF.settings()).ledgerMap);
      await TF.notePull(list.length);
      if (q.format === 'json') return res.json({ company: (await TF.settings()).company, count: list.length, vouchers: TF.json(list) });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.end(TF.xml(list, (await TF.settings()).company));
    }
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
      const out = await db.tx(async (t) => {
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
        await audit.record(t.q, { user: u, action: closedOn ? 'create-closed-month' : 'create', entity: 'acc-' + b.reg, entityId: row.id, after: { ref, ...data }, note: closedOn ? `Books closed to ${closedOn}. Reason: ${str(b.reason, 300)}` : null });
        return { id: row.id, ref_id: ref };
      });
      // paid against an approved purchase bill: the Purchase order is marked Paid with this payment's reference
      if (b.reg === 'payments' && b.poId && !id) {
        try { await acc.markBillPaid(str(b.poId, 60), { amount: data.amount, ref: data.reference, date: data[dk], paymentId: out.ref_id, user: u }); out.billPaid = true; }
        catch (e) { out.billPaid = false; out.billError = e.message; }
      }
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
