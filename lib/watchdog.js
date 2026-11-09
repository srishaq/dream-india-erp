// Watchdog: every scheduled job leaves its last result (cron-last:<job> in job_marks). Every 5 minutes, after the
// mail job, the watchdog looks for a job that failed, a job that partly failed (one of its steps reported an error),
// or a job that has not run when it should have, and emails the Admin (and the test address in Letter settings).
// The same problem is emailed again at most every 6 hours, and once more when it is fixed.
// GET /api/health (public) answers 503 when the database is down or the 5-minute job has stopped, for an outside
// monitor such as UptimeRobot.
const db = require('./db');

const EVERY = { mail: 30, morning: 26 * 60, mkt: 26 * 60, pdc: 26 * 60, summary: 26 * 60, evening: 26 * 60, dpr: 26 * 60, bank: 26 * 60, backup: 26 * 60 }; // minutes before "has not run"
const NAMES = { mail: 'Mailbox, letters and posting (every 5 minutes)', morning: '9 am To-Do, reminders, CA pack and cheque match', mkt: 'Marketing figures (Exotel, Meta, Google)', pdc: 'Post-dated cheque reminders', summary: '10 am approvals summary', evening: '8 pm day reports', dpr: 'Daily progress report reminder', bank: 'Bank Auto Check', backup: 'Nightly backup to Google Drive' };
const REPEAT_H = 6;
// A step that is simply not set up yet (keys not in Vercel, a service not connected) is not a breakdown.
const SETUP = /not (connected|set up|configured)|not in Vercel|is not connected|connect .* (first|again)|test version|no .*template|keys? (are|is) not/i;

// Steps inside a job report their own errors as { error } — find them.
function stepErrors(body, path = '') {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  for (const [k, v] of Object.entries(body)) {
    if (k === 'error' && typeof v === 'string' && path && !SETUP.test(v)) out.push(`${path}: ${v}`);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...stepErrors(v, path ? path + '.' + k : k));
  }
  return out;
}
async function record(job, ok, body, error, ms) {
  if (!EVERY[job]) return;
  const steps = ok ? stepErrors(body) : [];
  await db.q("insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()",
    ['cron-last:' + job, { ok, at: new Date().toISOString(), ms, error: error || null, steps: steps.slice(0, 10), ...(ok && !steps.length ? { lastOk: new Date().toISOString() } : {}) }]).catch(() => {});
  if (ok && !steps.length) await markGood(job);
}
async function markGood(job) {
  await db.q("insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()", ['cron-good:' + job, { at: new Date().toISOString() }]).catch(() => {});
}

async function problems() {
  const rows = await db.q("select key, info, done_at from job_marks where key like 'cron-last:%' or key like 'cron-good:%' or key like 'cron-seen:%' or key in ('backup-error', 'backup-running', 'ccm-webhook-error')");
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  const first = by['cron-seen:watchdog'] ? new Date(by['cron-seen:watchdog'].done_at) : new Date();
  if (!by['cron-seen:watchdog']) await db.q("insert into job_marks (key, info) values ('cron-seen:watchdog', '{}') on conflict do nothing");
  const now = Date.now(), list = [];
  for (const [job, mins] of Object.entries(EVERY)) {
    const last = by['cron-last:' + job], good = by['cron-good:' + job];
    if (last && last.info && last.info.ok === false) list.push({ key: job + ':failed', job, text: `${NAMES[job]} failed: ${last.info.error || 'error'}` });
    else if (last && last.info && (last.info.steps || []).length) list.push({ key: job + ':steps', job, text: `${NAMES[job]} ran, but part of it failed: ${last.info.steps.join('; ')}` });
    const lastGood = good ? new Date(good.done_at).getTime() : null;
    const since = lastGood || first.getTime();
    if (now - since > mins * 60000) list.push({ key: job + ':late', job, text: `${NAMES[job]} has not run properly since ${new Date(since + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} IST.` });
  }
  const br = by['backup-running']; // started but never finished: the function was stopped (time or memory) part-way
  if (br && now - new Date(br.done_at).getTime() > 20 * 60000) list.push({ key: 'backup:stopped', job: 'backup', text: `Backup started (${br.info.day || ''}) but stopped while copying ${br.info.table || 'the first table'} (${Math.round((br.info.bytes || 0) / 1048576)} MB sent).` });
  if (by['backup-error']) list.push({ key: 'backup:error', job: 'backup', text: `Backup failed (${by['backup-error'].info.day || ''}): ${by['backup-error'].info.error}` });
  return list;
}

async function recipients() {
  const admins = (await db.q("select email from users where role = 'admin' and not disabled and email is not null")).map((r) => r.email);
  const set = ((await db.one("select value from settings where key = 'letters'")) || {}).value || {};
  const extra = ((await db.one("select value from settings where key = 'alerts'")) || {}).value?.emails || [];
  return [...new Set([...admins, ...extra, ...(set.testEmail ? [String(set.testEmail).split(/[\/,;\s]+/)[0]] : [])].map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

async function check() {
  const list = await problems();
  const sent = Object.fromEntries((await db.q("select key, done_at from job_marks where key like 'alert-sent:%'")).map((r) => [r.key.slice(11), new Date(r.done_at).getTime()]));
  const due = list.filter((p) => !sent[p.key] || Date.now() - sent[p.key] > REPEAT_H * 3600e3);
  const fixed = Object.keys(sent).filter((k) => !list.some((p) => p.key === k));
  if (!due.length && !fixed.length) return { problems: list.length, emailed: 0 };
  const mailer = require('./mailer');
  const to = await recipients();
  let emailed = 0;
  if (mailer.configured() && to.length) {
    const lines = [...due.map((p) => '• ' + p.text), ...(fixed.length ? ['', 'Working again: ' + fixed.map((k) => NAMES[k.split(':')[0]] || k).join(', ')] : [])];
    const subject = due.length ? `ERP alert: ${due.length === 1 ? due[0].text.slice(0, 90) : due.length + ' problems'}` : 'ERP: working again';
    const c = await mailer.connect();
    try {
      await c.send({ to, fromName: 'Dream India ERP', subject, text: `${lines.join('\n')}\n\nOpen the ERP: https://erp.dreamindiarealty.com`,
        html: `<p>${lines.map((l) => l.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))).join('<br>')}</p><p><a href="https://erp.dreamindiarealty.com">Open the ERP</a></p>` });
      emailed = to.length;
    } finally { await c.close(); }
  }
  for (const p of due) await db.q("insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()", ['alert-sent:' + p.key, { text: p.text, to }]);
  if (fixed.length) await db.q("delete from job_marks where key = any($1)", [fixed.map((k) => 'alert-sent:' + k)]);
  return { problems: list.length, emailed, to };
}

async function health() {
  const t0 = Date.now();
  const r = await db.one("select now() as now, (select done_at from job_marks where key = 'cron-good:mail') as mail, (select done_at from job_marks where key like 'backup:%' order by key desc limit 1) as backup").catch((e) => ({ error: e.message }));
  if (r.error) return { ok: false, status: 503, db: 'down' };
  const mailMins = r.mail ? Math.round((Date.now() - new Date(r.mail).getTime()) / 60000) : null;
  const backupH = r.backup ? Math.round((Date.now() - new Date(r.backup).getTime()) / 3600000) : null;
  const ok = mailMins == null || mailMins <= 30;
  return { ok, status: ok ? 200 : 503, db: 'up', ms: Date.now() - t0, fiveMinuteJobMinutesAgo: mailMins, lastBackupHoursAgo: backupH };
}

module.exports = { record, markGood, problems, check, health, stepErrors, NAMES };
