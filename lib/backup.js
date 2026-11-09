// Backups of the whole ERP database to the owner's Google Drive ("Dream India ERP – Backups", a folder the ERP makes
// itself; the Drive connection can only touch folders the ERP made). Every night at about 2 am IST: one file
// "ERP backup YYYY-MM-DD (daily|weekly|monthly).json.gz" — every table, every row, as JSON lines, compressed.
// Kept: the last 7 daily, the last 5 weekly (Sundays) and the last 12 monthly (the 1st). Older ones go to the Drive bin.
// Restore: scripts/restore-backup.js <file> into a NEW empty database (it builds the tables first, then loads the rows).
const zlib = require('zlib');
const db = require('./db');

const FOLDER_KEY = 'backups-root', FOLDER_NAME = 'Dream India ERP – Backups';
const KEEP = { daily: 7, weekly: 5, monthly: 12 };
// Short-lived rows that need no backup (codes, counters, login attempts).
const SKIP = new Set(['login_failures', 'mkt_rate', 'cp_otps', 'staff_otps']);
const ist = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3);
const today = () => ist().toISOString().slice(0, 10);
function kindOf(day) { const d = new Date(day + 'T00:00:00Z'); return d.getUTCDate() === 1 ? 'monthly' : d.getUTCDay() === 0 ? 'weekly' : 'daily'; }

async function tables() {
  return (await db.q("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"))
    .map((r) => r.t).filter((t) => !SKIP.has(t));
}

// The whole database as gzip'd JSON lines: a header line (the tables and their row counts), then the rows table by table in
// pieces ({t, rows} — one table may take many lines), then an end line with the counts actually written. It is built and sent
// to Drive piece by piece, so a big database (design files, scans, reels) never has to fit in memory at once. Until 9 Nov
// the whole database was put together in memory first; once the AI Agent Team's designs were stored the nightly function
// ran out of room and stopped without a word, which is why the backup had not run since 6 Nov.
const PIECE = 4 * 1024 * 1024; // gzip about 4 MB of JSON at a time (each piece is a complete gzip member; gunzip reads them as one file)
async function fileTables() {
  return new Set((await db.q("select distinct table_name as t from information_schema.columns where table_schema = 'public' and data_type = 'bytea'")).map((r) => r.t));
}
async function stream(write, progress = async () => {}) {
  const list = await tables(), files = await fileTables(), counts = {}, written = {};
  const mig = (await db.q('select id from schema_migrations order by id').catch(() => [])).map((r) => r.id);
  for (const t of list) counts[t] = (await db.one(`select count(*)::int as n from "${t.replace(/"/g, '')}"`)).n;
  let raw = JSON.stringify({ backup: 'dream-india-erp', v: 2, at: new Date().toISOString(), day: today(), migrations: mig, counts }) + '\n';
  const flush = async (force) => { if (raw.length && (force || raw.length >= PIECE)) { await write(zlib.gzipSync(Buffer.from(raw, 'utf8'), { level: 6 })); raw = ''; } };
  for (const t of list) {
    const name = t.replace(/"/g, ''), size = files.has(t) ? 4 : 1000; // tables with files: a few rows at a time
    written[t] = 0; let after = '(0,0)';
    await progress(t);
    for (;;) {
      const rows = await db.q(`select ctid::text as c, row_to_json(x)::text as j from "${name}" x where ctid > $1::tid order by ctid limit ${size}`, [after]);
      if (!rows.length) break;
      after = rows[rows.length - 1].c; written[t] += rows.length;
      raw += `{"t":${JSON.stringify(t)},"rows":[${rows.map((r) => r.j.replace(/\n/g, '')).join(',')}]}\n`; // json puts raw line breaks only between values; inside them they are escaped
      await flush(false);
      if (rows.length < size) break;
    }
  }
  raw += JSON.stringify({ end: true, counts: written }) + '\n';
  await flush(true);
  return { counts: written, tables: list.length, rows: Object.values(written).reduce((a, b) => a + b, 0) };
}
// The whole backup in memory (tests and small copies only).
async function build() {
  const parts = []; const r = await stream(async (b) => parts.push(b));
  return { buf: Buffer.concat(parts), ...r };
}

// Sends the pieces to Drive as they come (a resumable upload whose size is known only at the end).
async function uploader(name) {
  const G = require('./gdrive');
  const parent = await G.topFolder(FOLDER_KEY, FOLDER_NAME);
  const url = await G.startUpload({ name, mime: 'application/gzip', size: null, parent });
  const PART = 32 * 256 * 1024; // 8 MB, a multiple of 256 KB
  let pending = [], have = 0, sent = 0, id = null;
  const take = (n) => { const all = Buffer.concat(pending); pending = [all.subarray(n)]; have = all.length - n; return all.subarray(0, n); };
  return {
    parent,
    get bytes() { return sent + have; },
    async write(buf) {
      pending.push(buf); have += buf.length;
      while (have >= PART) { const part = take(PART); const r = await G.putPart(url, part, sent, '*'); sent += part.length; if (r.received && r.received !== sent) throw new Error(`Google Drive received ${r.received} of ${sent} bytes.`); }
    },
    async finish() {
      const last = take(have), total = sent + last.length;
      const r = await G.putPart(url, last, sent, total);
      id = r.id; sent = total; return { id, bytes: total };
    },
  };
}

// Keep 7 daily, 5 weekly, 12 monthly; older backups to the Drive bin.
async function prune(parent) {
  const G = require('./gdrive');
  const files = (await G.listIn(parent)).filter((f) => /^ERP backup \d{4}-\d\d-\d\d \((daily|weekly|monthly)\)/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  const seen = { daily: 0, weekly: 0, monthly: 0 }, binned = [];
  for (const f of files) {
    const k = f.name.match(/\((daily|weekly|monthly)\)/)[1];
    if (++seen[k] > KEEP[k]) { await G.trash(f.id); binned.push(f.name); }
  }
  return binned;
}

async function run({ trigger = 'schedule', force = false } = {}) {
  const day = today(), key = 'backup:' + day;
  if (!force && await db.one('select 1 as x from job_marks where key = $1', [key])) return { skipped: 'Already backed up today.' };
  const t0 = Date.now();
  const mark = (info) => db.q("insert into job_marks (key, info) values ('backup-running', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [info]).catch(() => {});
  try {
    const name = `ERP backup ${day} (${kindOf(day)}).json.gz`;
    const up = await uploader(name);
    const started = new Date().toISOString();
    await mark({ day, started, table: null, bytes: 0, trigger });
    const b = await stream((buf) => up.write(buf), (t) => mark({ day, started, table: t, bytes: up.bytes, trigger }));
    const done = await up.finish();
    const binned = await prune(up.parent).catch((e) => [`(could not tidy old backups: ${e.message})`]);
    const info = { file: name, id: done.id, bytes: done.bytes, tables: b.tables, rows: b.rows, binned, seconds: Math.round((Date.now() - t0) / 1000), trigger };
    await db.q('insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()', [key, info]);
    await db.q("delete from job_marks where key in ('backup-error', 'backup-running')");
    return { ok: true, ...info };
  } catch (e) {
    await db.q("delete from job_marks where key = 'backup-running'").catch(() => {});
    await db.q("insert into job_marks (key, info) values ('backup-error', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [{ day, error: e.message, trigger }]).catch(() => {});
    throw e;
  }
}

// For the Admin: the last backups and any error.
async function status() {
  const rows = await db.q("select key, info, done_at from job_marks where key like 'backup:%' order by key desc limit 10");
  const e = await db.one("select info, done_at from job_marks where key = 'backup-error'");
  const f = await db.one('select drive_id from doc_folders where key = $1', [FOLDER_KEY]).catch(() => null);
  return { last: rows.map((r) => ({ day: r.key.slice(7), ...r.info, at: r.done_at })), error: e ? { ...e.info, at: e.done_at } : null,
    folder: f ? `https://drive.google.com/drive/folders/${f.drive_id}` : null, keep: KEEP };
}

module.exports = { build, stream, run, status, prune, kindOf, tables, FOLDER_NAME };
