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

// The whole database as gzip'd JSON lines: a header line, then one line per table ({t, rows}).
async function build() {
  const list = await tables(), counts = {}, parts = [];
  const mig = (await db.q('select id from schema_migrations order by id').catch(() => [])).map((r) => r.id);
  for (const t of list) {
    const r = await db.one(`select count(*)::int as n, coalesce(json_agg(x), '[]')::text as rows from (select * from "${t.replace(/"/g, '')}") x`);
    counts[t] = r.n; parts.push(`{"t":${JSON.stringify(t)},"rows":${r.rows.replace(/\n/g, '')}}`); // json_agg puts raw line breaks between rows; inside values they are always escaped
  }
  const head = JSON.stringify({ backup: 'dream-india-erp', at: new Date().toISOString(), day: today(), migrations: mig, counts });
  const buf = zlib.gzipSync(Buffer.from([head, ...parts].join('\n') + '\n', 'utf8'), { level: 6 });
  return { buf, counts, tables: list.length, rows: Object.values(counts).reduce((a, b) => a + b, 0) };
}

async function upload(buf, name) {
  const G = require('./gdrive');
  const parent = await G.topFolder(FOLDER_KEY, FOLDER_NAME);
  const url = await G.startUpload({ name, mime: 'application/gzip', size: buf.length, parent });
  const PART = 32 * 256 * 1024; // 8 MB, a multiple of 256 KB
  let at = 0, res = null;
  while (at < buf.length) {
    res = await G.putPart(url, buf.subarray(at, Math.min(at + PART, buf.length)), at, buf.length);
    if (res.done) break;
    at = res.received || at + PART;
  }
  return { id: res && res.id, parent };
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
  try {
    const b = await build();
    const name = `ERP backup ${day} (${kindOf(day)}).json.gz`;
    const up = await upload(b.buf, name);
    const binned = await prune(up.parent).catch((e) => [`(could not tidy old backups: ${e.message})`]);
    const info = { file: name, id: up.id, bytes: b.buf.length, tables: b.tables, rows: b.rows, binned, seconds: Math.round((Date.now() - t0) / 1000), trigger };
    await db.q('insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()', [key, info]);
    await db.q("delete from job_marks where key = 'backup-error'");
    return { ok: true, ...info };
  } catch (e) {
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

module.exports = { build, run, status, prune, kindOf, tables, FOLDER_NAME };
