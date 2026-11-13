// Sync with Tally (the ERP is live): brings Receipts, Payments Out and Journals in line with Tally's registers as they
// are now, without wiping the ERP. Upload the Receipt, Payment, Contra and Journal Registers for one period.
//
// For every Tally voucher in that period (rows <ref>, <ref>/1, /2 …, <ref>-1 …):
//   · the ERP already has it with the same date, bank and ledger amounts → left exactly as it is (heads, units, bill
//     details, splits staff made all stay);
//   · the ERP has it but it differs → its rows are replaced by Tally's; head, unit and bill details staff filled are
//     carried over to the new row for the same ledger;
//   · the ERP does not have it → added.
// Rows brought in from Tally earlier whose voucher is no longer in Tally are removed (Tally deleted or renumbered it).
// Entries made in the ERP (Payment ID PO…, Receipt ID BL…) are matched to Tally by their ID in the narration, or by
// bank, amount and a date within 3 days; ones Tally does not have yet are listed, never deleted.
// Journals in the period are replaced by Tally's. Dates after today are left alone (post-dated cheques).
const db = require('./db');
const tally = require('./tally-import');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const VKEY = /^([RPC]\d{4}-\d+)/; // the Tally voucher a row comes from
const vkey = (ref) => { const m = String(ref || '').match(VKEY); return m ? m[1] : null; };
const party = (side, r) => (side === 'payment' ? r.payee : r.payer_name) || r.head || '';
// what must agree for a voucher to count as the same: its date, and the amount per bank and ledger
const print = (side, rows) => {
  const m = {};
  for (const r of rows) { const k = `${iso(r.txn_date)}|${r.bank}|${party(side, r)}`; m[k] = r2((m[k] || 0) + n(r.amount)); }
  return Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}|${v.toFixed(2)}`).sort().join('\n');
};
const SYS = new Set(['id', 'book', 'ref_id', 'txn_date', 'bank', 'description', 'reference', 'amount', 'remark', 'source', 'imported', 'created_by', 'created_at', 'updated_by', 'updated_at',
  'payee', 'payer_name', 'tally_at', 'tally_note', 'tally_pulled_at']);
const TABLE = { receipt: 'acc_receipts', payment: 'acc_payments' };
const PREFIX = { receipt: 'BL', payment: 'PO' };

function periodOf(p, today) {
  const ps = p.registers.map((r) => r.period).filter(Boolean);
  const dates = [...p.receipts, ...p.payments, ...p.journals].map((x) => x.txn_date).sort();
  let from = ps.length ? ps.map((x) => x.from).sort().pop() : dates[0];
  let to = ps.length ? ps.map((x) => x.to).sort()[0] : dates[dates.length - 1];
  if (to > today) to = today; // post-dated payments are PDCs, not Payments Out
  return { from, to, sameForAll: new Set(ps.map((x) => x.from + x.to)).size <= 1 && ps.length === p.registers.length };
}

// Works out what would change. t: a db (or transaction) handle.
async function plan(t, p, today) {
  const per = periodOf(p, today);
  if (!per.from || !per.to || per.from > per.to) throw Object.assign(new Error('The registers have no vouchers in one common period.'), { status: 400 });
  const out = { period: per, sides: {}, journals: {} };
  for (const side of ['receipt', 'payment']) {
    const target = (side === 'receipt' ? p.receipts : p.payments).filter((r) => r.txn_date >= per.from && r.txn_date <= per.to);
    const T = new Map(); for (const r of target) { const k = vkey(r.ref_id); (T.get(k) || T.set(k, []).get(k)).push(r); }
    // the period's rows, and any row of the same Tally vouchers dated outside it (Tally may have changed its date)
    const erp = await t.q(`select * from ${TABLE[side]} where book = $1 and (txn_date between $2 and $3 or substring(ref_id from '^[RPC][0-9]{4}-[0-9]+') = any($4::text[])) order by id`, [BOOK, per.from, per.to, [...T.keys()]]);
    const E = new Map(), mine = [], erpOnly = [];
    for (const r of erp) { const k = vkey(r.ref_id); if (k && (r.imported || r.source === 'Tally' || T.has(k))) (E.get(k) || E.set(k, []).get(k)).push(r); else mine.push(r); }
    // ERP entries Tally already has: by their ID in the narration, else by bank + amount + date (±3 days)
    const linked = new Map(); // voucher key → ERP rows
    const free = [...T.keys()].filter((k) => !E.has(k));
    for (const r of mine) {
      let k = r.ref_id ? free.find((v) => !linked.has(v) && T.get(v).some((x) => new RegExp(`\\b${r.ref_id.replace(/[^A-Za-z0-9]/g, '')}\\b`).test(String(x.description || '')))) : null;
      if (!k) {
        const c = free.filter((v) => !linked.has(v)).filter((v) => { const rows = T.get(v); const sum = r2(rows.filter((x) => x.bank === r.bank).reduce((a, x) => a + n(x.amount), 0));
          return Math.abs(sum - r2(r.amount)) < 0.01 && Math.abs((Date.parse(iso(r.txn_date)) - Date.parse(rows[0].txn_date)) / 864e5) <= 3; });
        if (c.length === 1) k = c[0];
      }
      if (k) linked.set(k, [r]); else erpOnly.push(r);
    }
    const s = { same: 0, replace: [], add: [], remove: [], linkedSame: 0, linkedReplace: [], linked: [], erpOnly };
    for (const [k, rows] of T) {
      const have = E.get(k) || linked.get(k);
      if (!have) { s.add.push({ k, rows }); continue; }
      if (print(side, have) === print(side, rows)) { if (E.has(k)) s.same++; else { s.linkedSame++; s.linked.push({ k, rows, old: have }); } continue; }
      (E.has(k) ? s.replace : s.linkedReplace).push({ k, rows, old: have });
    }
    for (const [k, rows] of E) if (!T.has(k)) s.remove.push({ k, old: rows });
    out.sides[side] = s;
  }
  const jOld = await t.one('select count(*)::int as n, count(distinct ref_id)::int as v from acc_journals where book = $1 and txn_date between $2 and $3', [BOOK, per.from, per.to]);
  const jNew = p.journals.filter((j) => j.txn_date >= per.from && j.txn_date <= per.to);
  out.journals = { old: jOld.v, now: new Set(jNew.map((j) => j.ref_id)).size, lines: jNew.length, rows: jNew };
  return out;
}

const brief = (side, x) => ({ voucher: x.k, date: iso((x.rows || x.old)[0].txn_date), tally: x.rows ? r2(x.rows.reduce((a, r) => a + n(r.amount), 0)) : null, erp: x.old ? r2(x.old.reduce((a, r) => a + n(r.amount), 0)) : null,
  ledgers: [...new Set((x.rows || x.old).map((r) => party(side, r)))].slice(0, 4).join('; '), erpIds: x.old ? x.old.map((r) => r.ref_id).join(', ') : '' });
function summary(pl) {
  const s = {}; for (const side of ['receipt', 'payment']) {
    const x = pl.sides[side];
    s[side] = { same: x.same + x.linkedSame, replace: x.replace.length + x.linkedReplace.length, add: x.add.length, remove: x.remove.length, erpOnly: x.erpOnly.length,
      changes: [...x.replace, ...x.linkedReplace].map((y) => ({ what: 'Different in the ERP: replaced by Tally', ...brief(side, y) }))
        .concat(x.add.map((y) => ({ what: 'In Tally, not in the ERP: added', ...brief(side, y) })))
        .concat(x.remove.map((y) => ({ what: 'Not in Tally any more: removed from the ERP', ...brief(side, y) }))).slice(0, 400),
      erpOnlyRows: x.erpOnly.map((r) => ({ id: r.ref_id, date: iso(r.txn_date), bank: r.bank, amount: n(r.amount), who: party(side, r), source: r.source })).slice(0, 200) };
  }
  return { period: pl.period, receipts: s.receipt, payments: s.payment, journals: { before: pl.journals.old, now: pl.journals.now, lines: pl.journals.lines } };
}

async function apply(t, pl, { user }) {
  const done = { removed: 0, added: 0, replaced: 0, carried: 0 };
  for (const side of ['receipt', 'payment']) {
    const x = pl.sides[side], table = TABLE[side];
    const cols = (await t.q(`select column_name as c from information_schema.columns where table_name = $1`, [table])).map((r) => r.c);
    const ins = async (r) => {
      const clash = await t.one(`select ref_id, txn_date, amount from ${table} where book = $1 and ref_id = $2`, [BOOK, r.ref_id]);
      if (clash) throw Object.assign(new Error(`${side === 'payment' ? 'Payment' : 'Receipt'} ID ${r.ref_id} is already in the ERP (${iso(clash.txn_date)}, ₹${n(clash.amount).toLocaleString('en-IN')}) and is not the same Tally voucher. Nothing was changed. Send this message to the ERP team.`), { status: 409 });
      const keys = Object.keys(r).filter((k) => cols.includes(k) && !['id', 'book', 'imported', 'created_by', 'created_at'].includes(k) && r[k] !== undefined);
      await t.q(`insert into ${table} (book, imported, created_by, ${keys.join(', ')}) values ($1, true, $2, ${keys.map((_, i) => '$' + (i + 3)).join(', ')})`, [BOOK, user.id, ...keys.map((k) => r[k])]);
    };
    const drop = async (rows) => { if (rows.length) await t.q(`delete from ${table} where id = any($1::int[])`, [rows.map((r) => r.id)]); done.removed += rows.length; };
    for (const y of x.remove) await drop(y.old);
    // the ERP's own entries Tally has: Tally's date, bank and amount, the ERP's ID kept; marked as in Tally so the Tally
    // link never sends them again (that would make a second voucher)
    const vno = (y) => `In Tally as ${side === 'payment' ? 'Payment' : 'Receipt'} ${y.k.split('-')[1]}`;
    for (const y of x.linked) await t.q(`update ${table} set tally_at = coalesce(tally_at, now()), tally_note = $2 where id = $1`, [y.old[0].id, vno(y)]);
    for (const y of x.linkedReplace.filter((z) => z.old.length === 1 && z.rows.length === 1)) {
      const r = y.rows[0];
      await t.q(`update ${table} set txn_date = $2, bank = $3, amount = $4, ${side === 'payment' ? 'payee' : 'payer_name'} = $5, tally_at = now(), tally_note = $6, updated_by = $7, updated_at = now() where id = $1`,
        [y.old[0].id, r.txn_date, r.bank, r.amount, side === 'payment' ? r.payee : r.payer_name, vno(y), user.id]);
      done.replaced++;
    }
    for (const y of [...x.replace, ...x.linkedReplace.filter((z) => !(z.old.length === 1 && z.rows.length === 1))]) {
      await drop(y.old); done.removed -= y.old.length;
      const used = new Set();
      for (const r of y.rows) {
        // what staff filled on the old row for the same ledger stays (head, unit, bill and TDS details, cheque status…)
        const o = y.old.find((z) => !used.has(z.id) && party(side, z) === party(side, r));
        const row = { ...r, source: 'Tally' };
        if (o) { used.add(o.id); for (const c of cols) if (!SYS.has(c) && o[c] != null && o[c] !== '') row[c] = o[c]; done.carried++; }
        await ins(row);
      }
      done.replaced++;
    }
    for (const y of x.add) { for (const r of y.rows) await ins({ ...r, source: 'Tally' }); done.added++; }
  }
  // journals in the period: exactly Tally's
  const per = pl.period;
  done.journalsRemoved = (await t.q('delete from acc_journals where book = $1 and txn_date between $2 and $3 returning 1 as x', [BOOK, per.from, per.to])).length;
  await tally.insJournals(t, pl.journals.rows, user);
  done.journalLines = pl.journals.rows.length;
  // heads Tally uses that the ERP does not list yet
  for (const side of ['receipt', 'payment']) {
    const heads = new Set([...pl.sides[side].add, ...pl.sides[side].replace, ...pl.sides[side].linkedReplace].flatMap((y) => y.rows.map((r) => r.head)).filter(Boolean));
    for (const h of heads) await t.q("insert into acc_heads (book, side, name, note) values ($1, $2, $3, 'From Tally') on conflict (book, side, name) do nothing", [BOOK, side, h]);
  }
  return done;
}

// Every ledger: Tally's debit and credit for the period against the ERP's (Payments Out by payee, Receipts by payer,
// Journals by ledger). Bank and cash ledgers are left out (they are the other side of every row).
async function ledgers(t, p, per) {
  const T = {};
  const add = (m, k, dr, cr) => { const x = (m[k] ||= { ledger: k, dr: 0, cr: 0 }); x.dr = r2(x.dr + dr); x.cr = r2(x.cr + cr); };
  for (const r of p.payments) if (r.txn_date >= per.from && r.txn_date <= per.to && r.head !== 'Internal transfer') add(T, r.payee || r.head, n(r.amount) > 0 ? n(r.amount) : 0, n(r.amount) < 0 ? -n(r.amount) : 0);
  for (const r of p.receipts) if (r.txn_date >= per.from && r.txn_date <= per.to && r.head !== 'Internal transfer') add(T, r.payer_name || r.head, n(r.amount) < 0 ? -n(r.amount) : 0, n(r.amount) > 0 ? n(r.amount) : 0);
  for (const j of p.journals) if (j.txn_date >= per.from && j.txn_date <= per.to) add(T, j.ledger, n(j.debit), n(j.credit));
  const E = {};
  for (const r of await t.q(`select coalesce(nullif(payee, ''), head) as k, sum(greatest(amount, 0)) as dr, sum(greatest(-amount, 0)) as cr from acc_payments where book = $1 and txn_date between $2 and $3 and coalesce(head, '') <> 'Internal transfer' group by 1`, [BOOK, per.from, per.to])) add(E, r.k, n(r.dr), n(r.cr));
  for (const r of await t.q(`select coalesce(nullif(payer_name, ''), head) as k, sum(greatest(-amount, 0)) as dr, sum(greatest(amount, 0)) as cr from acc_receipts where book = $1 and txn_date between $2 and $3 and coalesce(head, '') <> 'Internal transfer' group by 1`, [BOOK, per.from, per.to])) add(E, r.k, n(r.dr), n(r.cr));
  for (const r of await t.q('select ledger as k, sum(coalesce(debit, 0)) as dr, sum(coalesce(credit, 0)) as cr from acc_journals where book = $1 and txn_date between $2 and $3 group by 1', [BOOK, per.from, per.to])) add(E, r.k, n(r.dr), n(r.cr));
  const keys = [...new Set([...Object.keys(T), ...Object.keys(E)])].filter(Boolean);
  const rows = keys.map((k) => { const a = T[k] || { dr: 0, cr: 0 }, b = E[k] || { dr: 0, cr: 0 }; return { ledger: k, tallyDr: a.dr, tallyCr: a.cr, erpDr: b.dr, erpCr: b.cr, diff: r2((b.dr - b.cr) - (a.dr - a.cr)) }; })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.ledger.localeCompare(y.ledger));
  return { period: per, ledgers: rows.length, matching: rows.filter((r) => Math.abs(r.diff) < 0.01).length, different: rows.filter((r) => Math.abs(r.diff) >= 0.01) };
}

module.exports = { plan, apply, summary, ledgers, periodOf, vkey, print };
