// Restore an ERP backup into a NEW, EMPTY database:   DATABASE_URL=postgres://… node scripts/restore-backup.js "ERP backup 2026-11-02 (daily).json.gz"
// 1. builds every table with the ERP's own migrations, 2. loads every row (parents before children),
// 3. moves each id counter past the highest id, 4. compares the row counts with the backup's own list.
// It refuses a database that already has bookings or logins in it, so a live database is never overwritten by mistake.
const fs = require('fs');
const zlib = require('zlib');
const db = require('../lib/db');
const { migrate } = require('../lib/migrate');

async function restore(file, { log = console.log } = {}) {
  // read line by line (a backup can be bigger than one text string); a table may be split over many lines
  const rl = require('readline').createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let head = null; const data = {};
  for await (const l of rl) {
    if (!l) continue;
    const j = JSON.parse(l);
    if (!head) { head = j; continue; }
    if (j.end) { head.counts = j.counts; continue; } // the counts actually written
    (data[j.t] = data[j.t] || []).push(...j.rows);
  }
  if (!head) throw new Error('This file is empty.');
  if (head.backup !== 'dream-india-erp') throw new Error('This is not a Dream India ERP backup.');
  log(`Backup of ${head.day} (${head.at}): ${Object.keys(head.counts).length} tables.`);
  await migrate();
  const busy = await db.one('select (select count(*) from users)::int + (select count(*) from bookings)::int as n');
  if (busy.n > 0) throw new Error('This database is not empty (it has logins or bookings). Restore only into a new, empty database.');
  // parents first: order the tables by their foreign keys
  const fks = await db.q(`select tc.table_name as child, ccu.table_name as parent from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`);
  for (const t of Object.keys(head.counts)) data[t] = data[t] || [];
  const names = Object.keys(data), order = [], seen = new Set();
  const visit = (t, path = new Set()) => { if (seen.has(t) || path.has(t)) return; path.add(t); for (const f of fks) if (f.child === t && f.parent !== t && names.includes(f.parent)) visit(f.parent, path); seen.add(t); order.push(t); };
  names.forEach((t) => visit(t));
  // empty what the migrations put in (default settings and the like), children first
  for (const t of [...order].reverse()) await db.q(`delete from "${t}"`);
  for (const t of order) {
    const rows = data[t]; if (!rows.length) continue;
    const self = fks.some((f) => f.child === t && f.parent === t) && rows[0] && 'id' in rows[0];
    if (self) rows.sort((a, b) => a.id - b.id); // a row that points at an earlier row of the same table
    for (let i = 0; i < rows.length; i += 500) {
      await db.q(`insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)`, [JSON.stringify(rows.slice(i, i + 500))]);
    }
  }
  // id counters past the highest id
  const seqs = await db.q(`select c.table_name as t, c.column_name as col, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) as s
    from information_schema.columns c where c.table_schema = 'public' and c.column_default like 'nextval(%'`);
  for (const s of seqs) if (s.s) await db.q(`select setval($1, greatest(coalesce((select max("${s.col}") from "${s.t}"), 0), 1))`, [s.s]);
  const bad = [];
  for (const t of names) { const n = (await db.one(`select count(*)::int as n from "${t}"`)).n; if (n !== head.counts[t]) bad.push(`${t}: ${n} of ${head.counts[t]}`); }
  if (bad.length) throw new Error('Row counts differ after the restore: ' + bad.join(', '));
  log(`Restored ${Object.values(head.counts).reduce((a, b) => a + b, 0)} rows; every table's count matches the backup.`);
  return head;
}
module.exports = { restore };
if (require.main === module) {
  const f = process.argv[2]; if (!f) { console.error('Usage: DATABASE_URL=… node scripts/restore-backup.js <backup file>'); process.exit(1); }
  restore(f).then(() => process.exit(0), (e) => { console.error('Restore failed:', e.message); process.exit(1); });
}
