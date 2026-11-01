// Backups: the whole database to one file, restored into a new empty database with every row, file and id counter intact.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const db = require('../lib/db');
const { migrate } = require('../lib/migrate');
const B = require('../lib/backup');

(async () => {
  const url = process.env.DATABASE_URL; assert.ok(url, 'DATABASE_URL');
  await migrate();
  await db.q("insert into users (username, name, role, password_hash) values ('bk.user', 'Backup O''Brien', 'admin', 'x') on conflict do nothing");
  const cp = await db.one("insert into channel_partners (name, name_key) values ('Line\nBreak & Co', 'line break co') returning id");
  const file = Buffer.from([0, 1, 2, 255, 10, 13, 92, 120]);
  await db.q("insert into cp_docs (cp_id, kind, number, file_name, mime, data, how) values ($1, 'pan', 'ABCDE1234F', 'pan.pdf', 'application/pdf', $2, 'uploaded')", [cp.id, file]);
  await db.q("insert into settings (key, value) values ('bk-test', $1) on conflict (key) do update set value = excluded.value", [{ text: 'quote " and \\ backslash', n: 1.25 }]);
  const b = await B.build();
  assert.ok(b.tables > 50 && b.rows > 3, 'every table is in the backup');
  assert.equal(B.kindOf('2026-11-01'), 'monthly'); assert.equal(B.kindOf('2026-11-08'), 'weekly'); assert.equal(B.kindOf('2026-11-03'), 'daily');
  const f = path.join(os.tmpdir(), `erp-bk-${process.pid}.json.gz`); fs.writeFileSync(f, b.buf);
  // a second, empty database
  const u = new URL(url); const target = u.pathname.slice(1) + '_rs'; const admin = new URL(url); admin.pathname = '/postgres';
  const sql = (q) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '../lib/db'))}).q(${JSON.stringify(q)}).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)})`], { env: { ...process.env, DATABASE_URL: admin.href }, encoding: 'utf8' });
  sql(`drop database if exists "${target}"`); const c = sql(`create database "${target}"`); assert.equal(c.status, 0, c.stderr);
  const t = new URL(url); t.pathname = '/' + target;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'restore-backup.js'), f], { env: { ...process.env, DATABASE_URL: t.href }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /every table's count matches/);
  // the same file bytes and text back, and the id counters moved on
  const check = spawnSync(process.execPath, ['-e', `const db=require(${JSON.stringify(path.join(__dirname, '../lib/db'))});(async()=>{const d=await db.one("select encode(data,'hex') as h from cp_docs limit 1");const c=await db.one("select name from channel_partners where name_key='line break co'");const s=await db.one("select value from settings where key='bk-test'");const n=await db.one("select nextval(pg_get_serial_sequence('channel_partners','id')) as v");console.log(JSON.stringify({h:d.h,name:c.name,s:s.value,next:n.v}));process.exit(0)})()`], { env: { ...process.env, DATABASE_URL: t.href }, encoding: 'utf8' });
  const o = JSON.parse(check.stdout.trim());
  assert.equal(o.h, file.toString('hex')); assert.equal(o.name, 'Line\nBreak & Co'); assert.equal(o.s.text, 'quote " and \\ backslash'); assert.ok(Number(o.next) > cp.id);
  // refuses a database that is not empty
  const again = spawnSync(process.execPath, [path.join(__dirname, 'restore-backup.js'), f], { env: { ...process.env, DATABASE_URL: t.href }, encoding: 'utf8' });
  assert.notEqual(again.status, 0); assert.match(again.stderr, /not empty/);
  sql(`drop database if exists "${target}"`); fs.unlinkSync(f);
  console.log('Backups: 4 checks passed.'); process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
