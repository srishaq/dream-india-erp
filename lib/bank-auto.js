// Runs the bank statement check (lib/bank-statements.js) on files from Google Drive or uploaded by hand,
// and keeps a record of every run (acc_stmt_runs) for the Bank Auto Check page.
const db = require('./db');
const drive = require('./drive');
const sheets = require('./sheets');
const audit = require('./audit');
const bs = require('./bank-statements');

const BOOK = 'signature';
const istDate = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function setting(key, dflt) {
  const r = await db.one('select value from acc_settings where book = $1 and key = $2', [BOOK, key]);
  return r && r.value != null && r.value !== '' ? r.value : dflt;
}

// files: [{ name, buffer, modified }]. trigger: schedule | drive | upload.
async function runFiles(files, { trigger, user = null, apply = true, compareFrom = null } = {}) {
  const compare = !!compareFrom;
  const start = compare ? compareFrom : await setting('statement_start', '2026-10-01');
  const runDate = istDate();
  try {
    const res = await db.tx(async (t) => {
      // One run at a time (the 3:10 pm job and a hand upload together would add the same lines twice).
      await t.q('select pg_advisory_xact_lock(7316010)');
      const out = await bs.run(t, files, { start, runDate, user, apply, compare });
      if (!apply && !compare) return { ...out, dryRun: true };
      const row = await t.one(`insert into acc_stmt_runs (book, run_date, trigger, user_id, files, banks, added, added_rows, updated, daily, differences, tagging, compare_from)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, run_at`,
      [BOOK, runDate, compare ? 'compare' : trigger, user?.id || null, JSON.stringify(out.files.concat(out.skippedFiles.map((s) => ({ file: s.file, skipped: s.reason })))), JSON.stringify(out.banks), JSON.stringify(out.added),
        JSON.stringify(out.addedRows), out.updated, out.daily, JSON.stringify(out.differences), JSON.stringify(compare ? [] : out.tagging), compare ? compareFrom : null]);
      await audit.record(t.q, { user, action: 'bank-statements', entity: 'accounts', entityId: String(row.id), after: { trigger, added: out.added, updated: out.updated, daily: out.daily, differences: out.differences.length } });
      return { id: row.id, run_at: row.run_at, ...out };
    });
    // The CRM's cheque receipts found on the statement (or returned): linked, approved or bounced.
    if (apply && !compare) res.cheques = await require('./cheque-match').run({ user, trigger: 'bank statement' }).catch((e) => ({ error: e.message }));
    return res;
  } catch (e) {
    if (apply) await db.q('insert into acc_stmt_runs (book, run_date, trigger, user_id, ok, error) values ($1, $2, $3, $4, false, $5)', [BOOK, runDate, trigger, user?.id || null, String(e.message).slice(0, 500)]).catch(() => {});
    throw e;
  }
}

async function runFromDrive({ trigger = 'drive', user = null, compareFrom = null } = {}) {
  if (!sheets.configured()) throw Object.assign(new Error('The ERP is not connected to Google yet.'), { status: 400 });
  const folders = (await setting('statement_folders', '')).split(/[\s,]+/).filter(Boolean);
  if (!folders.length) throw Object.assign(new Error('No statement folder is set.'), { status: 400 });
  const list = await drive.statementFiles(folders);
  // newest file per bank only (older copies in the bank folders are left alone)
  const pick = {}; const unknown = [];
  for (const f of list) { const b = bs.bankFor(f.name, ''); if (!b) { unknown.push(f); continue; } if (!pick[b.key]) pick[b.key] = f; }
  const files = [];
  for (const f of [...Object.values(pick), ...unknown.slice(0, 5)]) files.push({ name: f.name, modified: f.modifiedTime, buffer: await drive.download(f) });
  if (!files.length) throw Object.assign(new Error('No statement files were found in the Drive folder.'), { status: 400 });
  return runFiles(files, { trigger, user, compareFrom });
}

async function runs(limit = 30) {
  return db.q(`select r.id, r.run_at, r.run_date, r.trigger, r.compare_from, r.ok, r.error, r.added, r.updated, r.daily, jsonb_array_length(r.differences) as n_diff, jsonb_array_length(r.tagging) as n_tag,
    u.name as by_name from acc_stmt_runs r left join users u on u.id = r.user_id where r.book = $1 order by r.run_at desc limit $2`, [BOOK, limit]);
}
const runById = (id) => db.one('select r.*, u.name as by_name from acc_stmt_runs r left join users u on u.id = r.user_id where r.id = $1 and r.book = $2', [id, BOOK]);
const lastOk = () => db.one('select r.*, u.name as by_name from acc_stmt_runs r left join users u on u.id = r.user_id where r.book = $1 and r.ok and r.trigger <> $2 order by r.run_at desc limit 1', [BOOK, 'compare']);
const ranToday = async (trigger) => !!(await db.one('select 1 as x from acc_stmt_runs where book = $1 and trigger = $2 and run_date = $3 and ok limit 1', [BOOK, trigger, istDate()]));

module.exports = { runFiles, runFromDrive, runs, runById, lastOk, ranToday, setting, istDate };
