// Corrections in Excel (Rafi Sir, 28 Nov 2026: "easier for her to make the changes in the Excel and then upload it"):
// the Receipts and Payments Out rows that still need work, in one workbook. Accounts fills the white columns (head, flat,
// payer, cheque status, bill, remark) and uploads the file: the ERP shows every change first, then saves them with the
// same checks as the edit window, each change in the audit log. Rows are found by their ERP ID; nothing is added or
// deleted, and the bank's own columns (date, bank, amount, description) are never changed from the sheet.
const db = require('./db');
const acc = require('./accounts');
const audit = require('./audit');
const { fail } = require('./http');

const R_EDIT = [['head', 'Cash Flow Head'], ['payment_head', 'Payment Head'], ['unit_no', 'Unit'], ['payer_name', 'Payer Name'], ['payer_type', 'Payer Type'], ['cheque_status', 'Cheque Status'], ['remark', 'Remark']];
const P_EDIT = [['head', 'Cash Flow Head'], ['payee', 'Payee'], ['unit_no', 'Unit'], ['total_bill', 'Total Bill (with GST)'], ['tds_deducted', 'TDS Deducted'], ['remark', 'Remark']];
const SHOW = [['ref_id', 'ERP ID'], ['txn_date', 'Date'], ['bank', 'Bank'], ['amount', 'Amount'], ['description', 'Description (bank)']];
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10);
const T = (v) => (v == null ? '' : String(v).trim());

// why a row is on the sheet (all=false: only the rows that still need something)
function whyR(x) {
  const w = [];
  if (!x.head) w.push('no head');
  if (/^(AV|GST|SDR)$/.test(x.payment_head || '') && !x.unit_no) w.push('customer receipt without a flat');
  if (/Receipts From Customers/i.test(x.head || '') && !x.payment_head) w.push('no payment head (AV / GST / SDR)');
  if (/Bank statement PDF/.test(x.source || '') && (!x.unit_no || !x.payment_head) && !/Internal/i.test(x.head || '')) w.push('from the bank PDF: fill flat and head');
  if (x.cheque_status === 'Not found on statement') w.push('marked not on the statement: confirm');
  return w.join('; ');
}
function whyP(x) {
  const w = [];
  if (!x.head) w.push('no head');
  if (x.needs) w.push('bill details: ' + x.needs);
  return w.join('; ');
}

async function sheet({ all = false } = {}) {
  const get = async (reg) => { const out = []; for (let off = 0; off < 40000; off += 2000) { const L = await acc.list(reg, { limit: 2000, offset: off }); out.push(...L.rows); if (L.rows.length < 2000) break; } return out; };
  const R = (await get('receipts')).map((x) => ({ ...x, why: whyR(x) })).filter((x) => all || x.why);
  const P = (await get('payments')).map((x) => ({ ...x, why: whyP(x) })).filter((x) => all || x.why);
  const big = (a, b) => Number(b.amount) - Number(a.amount);
  R.sort(big); P.sort(big);
  const L = await acc.lists();
  const cell = (x, k) => (k === 'txn_date' ? iso(x[k]) : k === 'amount' || k === 'total_bill' || k === 'tds_deducted' ? (x[k] == null || x[k] === '' ? '' : Number(x[k])) : T(x[k]));
  const rows = (list, edit) => [[...SHOW.map((c) => c[1]), ...edit.map((c) => c[1]), 'Why it is listed'], ...list.map((x) => [...SHOW.map(([k]) => cell(x, k)), ...edit.map(([k]) => cell(x, k)), x.why])];
  const help = [['How to use this sheet'], [],
    ['1. Fill or correct the columns after "Description (bank)": head, flat (A-1001), payer, cheque status, bill, remark.'],
    ['2. Do not change the ERP ID, date, bank, amount or description: those come from the bank statement.'],
    ['3. Leave a cell as it is to keep it. To clear a value, type a single dash: -'],
    ['4. Upload the file in the ERP: Accounts → Receipts (or Payments Out) → Upload corrections. The ERP shows every change before saving.'],
    ['5. Heads, payment heads, payer types and cheque status must be from the lists on the "Lists" sheet.'], [],
    ['Biggest amounts are at the top of each sheet.']];
  const max = Math.max(L.receiptHead.length, L.paymentHead2.length, (L.paymentHead || []).length, (L.payerType || []).length, (L.chequeStatus || []).length);
  const lists = [['Receipt heads', 'Payment heads', 'Payment Head (AV / GST / SDR)', 'Payer Type', 'Cheque Status']];
  for (let i = 0; i < max; i++) lists.push([L.receiptHead[i] || '', L.paymentHead2[i] || '', (L.paymentHead || [])[i] || '', (L.payerType || [])[i] || '', (L.chequeStatus || [])[i] || '']);
  const w = [12, 11, 22, 14, 50];
  return { file: require('./xlsx-write').write([
    { name: 'Receipts', rows: rows(R, R_EDIT), widths: [...w, 24, 14, 10, 24, 18, 18, 30, 34] },
    { name: 'Payments Out', rows: rows(P, P_EDIT), widths: [...w, 24, 24, 10, 14, 12, 30, 34] },
    { name: 'How to use', rows: help, widths: [110] },
    { name: 'Lists', rows: lists, widths: [34, 34, 20, 22, 22] },
  ]), counts: { receipts: R.length, payments: P.length } };
}

// what the uploaded sheet changes: [{ reg, id, ref, changes: {col: [from, to]}, data }] and the problems
async function plan(buf) {
  let wb; try { wb = require('./xlsx').read(buf); } catch (e) { throw fail(400, 'That is not an Excel (.xlsx) file: ' + e.message); }
  const out = [], problems = [];
  for (const [name, reg, edit, table] of [['Receipts', 'receipts', R_EDIT, 'acc_receipts'], ['Payments Out', 'payments', P_EDIT, 'acc_payments']]) {
    const sh = wb.find((s) => s.name.trim().toLowerCase() === name.toLowerCase()); if (!sh) continue;
    const head = (sh.rows[0] || []).map(T);
    const col = (label) => head.indexOf(label);
    const ci = col('ERP ID'); if (ci < 0) { problems.push(`${name}: the "ERP ID" column is missing.`); continue; }
    const refs = sh.rows.slice(1).map((r) => T((r || [])[ci])).filter(Boolean);
    const cur = new Map((await db.q(`select * from ${table} where book = $1 and ref_id = any($2::text[])`, [acc.BOOK, refs])).map((x) => [x.ref_id, x]));
    for (let i = 1; i < sh.rows.length; i++) {
      const r = sh.rows[i] || [], ref = T(r[ci]); if (!ref) continue;
      const x = cur.get(ref); if (!x) { problems.push(`${name} row ${i + 1}: ${ref} is not in this project's ${name}.`); continue; }
      const raw = {};
      for (const [k, label] of edit) {
        const j = col(label); if (j < 0) continue;
        let v = r[j]; if (v == null || T(v) === '') continue; // empty: keep
        v = T(v) === '-' ? null : v;
        raw[k] = v;
      }
      if (!Object.keys(raw).length) continue;
      let data;
      try { data = await acc.cleanRow(reg, raw, { partial: true }); } catch (e) { problems.push(`${name} row ${i + 1} (${ref}): ${e.message}`); continue; }
      const same = (a, b) => (a == null || a === '' ? b == null || b === '' : b != null && b !== '' && (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && String(a).trim() !== '' ? Math.abs(Number(a) - Number(b)) < 0.005 : String(a) === String(b)));
      const changes = {};
      for (const k of Object.keys(data)) if (!same(x[k], data[k])) changes[k] = [x[k] ?? null, data[k]];
      if (!Object.keys(changes).length) continue;
      // a payment under a head that needs the vendor's bill is closed only with the bill (as in the edit window)
      if (reg === 'payments' && ('head' in changes || 'total_bill' in changes || 'tds_deducted' in changes)) {
        const H = (await acc.headMap()).payment[data.head ?? x.head];
        const val = (k) => (k in data ? data[k] : x[k]);
        if (H && H.needs_bill && (val('total_bill') == null || val('total_bill') === '' || val('tds_deducted') == null || val('tds_deducted') === '')) {
          problems.push(`${name} row ${i + 1} (${ref}): ${data.head ?? x.head} needs the vendor's bill: fill Total Bill and TDS Deducted (0 if none).`); continue;
        }
      }
      out.push({ reg, table, id: x.id, ref, date: iso(x.txn_date), amount: Number(x.amount), changes, data: Object.fromEntries(Object.keys(changes).map((k) => [k, data[k]])) });
    }
  }
  return { changes: out, problems };
}

async function apply(p, user, closed) {
  let n = 0;
  await db.tx(async (t) => {
    for (const c of p.changes) {
      if (closed && c.date <= closed) continue; // a closed month is changed only one row at a time, with a reason
      const cols = Object.keys(c.data);
      await t.q(`update ${c.table} set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_by = $${cols.length + 2}, updated_at = now() where id = $1 and book = $${cols.length + 3}`, [c.id, ...cols.map((k) => c.data[k]), user.id, acc.BOOK]);
      await audit.record(t.q, { user, action: 'update', entity: 'acc-' + c.reg, entityId: c.id, before: Object.fromEntries(Object.entries(c.changes).map(([k, v]) => [k, v[0]])), after: c.data, note: 'Corrections sheet (Excel upload)' });
      n++;
    }
  });
  return n;
}

module.exports = { sheet, plan, apply };
