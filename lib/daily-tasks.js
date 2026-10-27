// Daily To-Do of the CRM and Accounts teams.
// Every morning at 9 am (cron job=morning) the audit looks over the books and the CRM and writes what it finds as
// today's to-do items, one per finding (source 'audit'). People add their own tasks too (source 'own'); an own task
// stays on the list, day after day, until it is ticked. An audit item found again the next morning keeps the date it
// was first found ("open since"), so a line nobody clears shows how long it has waited.
// The Accounts audit is also emailed to the accounts mailbox (test address only until ERP_LIVE=1).
const db = require('./db');
const acc = require('./accounts');
const mailer = require('./mailer');
const { has } = require('./roles');
const { today: istToday } = require('./demands');

const BOOK = 'signature';
const DEPTS = {
  crm: { label: 'Sales & CRM', view: ['demand.raise', 'booking.create', 'booking.approve', 'ledger.view'], edit: ['demand.raise', 'booking.create', 'booking.approve'], run: ['booking.approve', 'users.manage'] },
  accounts: { label: 'Accounts', view: ['accounts.view'], edit: ['accounts.enter', 'accounts.manage'], run: ['accounts.manage', 'users.manage'] },
};
const can = (u, dept, what) => !!DEPTS[dept] && DEPTS[dept][what].some((p) => has(u, p));
const n = (v) => Number(v) || 0;
const inr = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const fmtD = (d) => { const [y, m, dd] = iso(d).split('-'); return y ? `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}-${y}` : ''; };
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const slug = (s) => String(s).toLowerCase().replace(/\(since [^)]*\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const safe = async (f, fallback) => { try { return await f(); } catch (e) { console.error('daily-tasks:', e.message); return fallback; } };

const GO = (g) => (g === 'balances' ? '#/balances' : g === 'checks' ? '#/checks' : g === 'bankauto' ? '#/bankauto' : '#/reg-' + g);
const HIGH = new Set(['balances', 'checks', 'bankauto']);

async function signatureId() { return (await db.one("select id from projects where code = 'SIGNATURE'"))?.id || (await db.one('select id from projects order by id limit 1'))?.id || null; }

// Cancelled flats (refund list) that the CRM still shows as booked to the same buyer, and those not found in the books.
async function cancelledFlags() {
  const canc = require('./cancellations');
  const rows = await canc.calc(await db.q('select * from acc_cancellations where book = $1 order by cancel_date nulls last, id', [BOOK]));
  return { still: rows.filter((r) => /CRM not cancelled/.test(r.crm_now)), notInBooks: rows.filter((r) => /^Not found/.test(r.books_check) && !canc.refunded(r.refund_status)), pending: rows.filter((r) => !canc.refunded(r.refund_status)) };
}
async function tallyGaps(projectId) {
  const s = await require('./books-vs-crm').summary(projectId);
  const off = s.rows.filter((r) => !['Agrees', 'Nothing received'].includes(r.state));
  return { n: off.length, more: off.filter((r) => r.state === 'More in the books').length, less: off.filter((r) => r.state === 'More in the CRM').length };
}
async function bounced(t) {
  return db.q("select id, txn_date, amount, payer_name, unit_no, bank from acc_receipts where book = $1 and cheque_status = 'Bounced' and txn_date >= $2 order by txn_date desc", [BOOK, addDays(t, -7)]);
}

// ---------- the Accounts audit ----------
async function accountsFindings(t) {
  const out = [];
  const td = await acc.todo();
  for (const x of td.items) {
    if (x.ok || x.n == null) continue;
    if (x.go === 'compliance' || x.go === 'pdc') continue; // listed one by one below
    out.push({ key: 'todo-' + slug(x.task), title: `${x.task}: ${x.n.toLocaleString('en-IN')}`, detail: x.what, count: x.n, link: GO(x.go), priority: HIGH.has(x.go) || /overdue/i.test(x.task) ? 'high' : 'normal' });
  }
  for (const p of await db.q('select * from acc_pdc where book = $1 and due_date between $2 and $3 order by due_date, id', [BOOK, t, addDays(t, 2)])) {
    out.push({ key: 'pdc-' + p.id, title: `PDC ${inr(p.amount)} to ${p.issued_to || '—'} is due ${iso(p.due_date) === t ? 'today' : 'on ' + fmtD(p.due_date)}`, detail: `Keep enough balance in ${p.bank || 'the bank'} so ${p.cheque_no ? 'cheque ' + p.cheque_no : 'the cheque'} clears. Deposit the TDS on this payment only after it has cleared.`, link: '#/reg-pdc', priority: 'high' });
  }
  // compliance: one line each for what is due in the next 3 days or late by up to 15 days; older ones as one line
  // (usually filed already and the register not updated)
  const comp = await db.q("select id, compliance, period, due_date from acc_compliance where book = $1 and coalesce(status, 'Pending') = 'Pending' and due_date <= $2 order by due_date", [BOOK, addDays(t, 3)]);
  const lateBy = (c) => Math.round((Date.parse(t) - Date.parse(iso(c.due_date))) / 864e5);
  const old = comp.filter((c) => lateBy(c) > 15);
  if (old.length) out.push({ key: 'comp-old', title: `Compliance items more than 15 days overdue: ${old.length}`, detail: `Oldest: ${old[0].compliance}${old[0].period ? ' (' + old[0].period + ')' : ''}, due ${fmtD(old[0].due_date)}. If filed or paid, set Status to Complied with the date and acknowledgement; if not, file them now.`, count: old.length, link: '#/reg-compliance', priority: 'high' });
  for (const c of comp.filter((c) => lateBy(c) <= 15)) {
    const late = lateBy(c);
    out.push({ key: 'comp-' + c.id, title: `${c.compliance}${c.period ? ' (' + c.period + ')' : ''} ${late > 0 ? `was due ${fmtD(c.due_date)}, ${late} day${late > 1 ? 's' : ''} late` : late === 0 ? 'is due today' : 'is due ' + fmtD(c.due_date)}`, detail: 'File or pay it, then set Status to Complied with the date and acknowledgement.', link: '#/reg-compliance', priority: late >= 0 ? 'high' : 'normal' });
  }
  for (const r of await safe(() => acc.pdcTdsIssues(), [])) {
    out.push({ key: 'pdc-tds-' + r.id, title: `PDC ${inr(r.amount)} to ${r.issued_to || '—'}: ${r.tds_check}`, detail: `TDS of ${inr(r.tds_amount)} was deposited on ${fmtD(r.tds_paid_on)}${r.tds_challan ? ' (challan ' + r.tds_challan + ')' : ''}. Cheque: ${r.cleared}. TDS on a PDC is deposited only after the cheque clears.`, link: '#/reg-pdc', priority: 'high' });
  }
  for (const r of await safe(() => bounced(t), [])) {
    out.push({ key: 'bounced-' + r.id, title: `Cheque returned: ${inr(r.amount)}${r.unit_no ? ' on ' + r.unit_no : ''}${r.payer_name ? ' (' + r.payer_name + ')' : ''}, ${fmtD(r.txn_date)}`, detail: 'Tell the CRM team so they follow up with the buyer, and check the bank charges were entered.', link: '#/reg-receipts', priority: 'high' });
  }
  const pid = await signatureId();
  const g = pid ? await safe(() => tallyGaps(pid), null) : null;
  if (g && g.n) out.push({ key: 'tally-crm', title: `Flats where Tally and the CRM receipts differ: ${g.n}`, detail: `${g.more} with more in Tally, ${g.less} with more in the CRM. Work down the Tally vs CRM page with the CRM team.`, count: g.n, link: '#/bookscrm', priority: 'normal' });
  const cf = await safe(cancelledFlags, null);
  if (cf) {
    if (cf.still.length) out.push({ key: 'canc-still-crm', title: `Cancelled flats still booked in the CRM: ${cf.still.length}`, detail: `${cf.still.slice(0, 8).map((r) => r.unit_no).join(', ')}${cf.still.length > 8 ? '…' : ''}. Ask the CRM team to cancel these bookings.`, count: cf.still.length, link: '#/reg-cancellations', priority: 'normal' });
    if (cf.notInBooks.length) out.push({ key: 'canc-not-books', title: `Pending refunds not found in Tally: ${cf.notInBooks.length}`, detail: 'Check the buyer name on the refund list against the Tally ledger for that flat.', count: cf.notInBooks.length, link: '#/reg-cancellations', priority: 'normal' });
    if (cf.pending.length) out.push({ key: 'canc-pending', title: `Cancelled flats with refund still to pay: ${cf.pending.length} (${inr(cf.pending.reduce((a, r) => a + n(r.to_refund), 0))})`, detail: 'Update the Refund Status as each refund is paid.', count: cf.pending.length, link: '#/reg-cancellations', priority: 'normal' });
  }
  const pend = await safe(() => db.one("select count(*)::int as n from receipts where status = 'pending'"), { n: 0 });
  if (pend.n) out.push({ key: 'receipts-approve', title: `CRM receipts waiting for Head Accounts approval: ${pend.n}`, detail: 'Approve each one after checking it on the bank statement.', count: pend.n, link: '#/receipts', priority: 'normal' });
  return out;
}

// ---------- the CRM list ----------
async function crmFindings(t) {
  const out = [];
  const pid = await signatureId();
  const one = async (sql, a = []) => (await safe(() => db.one(sql, a), { n: 0 })).n || 0;
  if (pid) {
    const fu = await safe(() => db.one(`select count(*) filter (where f.next_date is null or f.next_date <= $2)::int as due,
          count(*) filter (where f.id is null)::int as never,
          count(*) filter (where f.promise_date < $2 and (bb.last_receipt is null or bb.last_receipt < f.created_at::date))::int as broken
        from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
        left join lateral (select * from follow_ups z where z.booking_id = b.id order by z.created_at desc limit 1) f on true
       where u.project_id = $1 and b.status = 'active' and bb.overdue + bb.gst_outstanding > 0`, [pid, t]), { due: 0, never: 0, broken: 0 });
    if (fu.due) out.push({ key: 'fu-due', title: `Buyers to call today: ${fu.due}`, detail: 'Buyers with dues whose next follow-up date is today or earlier. Log every call, WhatsApp or promise.', count: fu.due, link: '#/followups', priority: 'high' });
    if (fu.broken) out.push({ key: 'fu-broken', title: `Promises to pay that were broken: ${fu.broken}`, detail: 'The promised date passed with nothing received. Call these first.', count: fu.broken, link: '#/followups', priority: 'high' });
    if (fu.never) out.push({ key: 'fu-never', title: `Buyers with dues never followed up: ${fu.never}`, detail: 'Make the first call and log it.', count: fu.never, link: '#/followups', priority: 'normal' });
  }
  const rep = await one("select count(*)::int as n from communications where direction = 'in' and status <> 'dismissed' and read_at is null");
  if (rep) out.push({ key: 'comms-new', title: `Messages from buyers not read yet: ${rep}`, detail: 'Email replies and WhatsApps are in each buyer\'s Communication record. Read and answer them, and link any that the ERP could not match.', count: rep, link: '#/comms', priority: 'high' });
  const bk = await one("select count(*)::int as n from bookings where status = 'pending'");
  if (bk) out.push({ key: 'bookings-approve', title: `Bookings waiting for Head CRM approval: ${bk}`, detail: 'Check the cost sheet and KYC, then approve.', count: bk, link: '#/bookings', priority: 'normal' });
  const dr = await one("select count(*)::int as n from demand_runs where status = 'draft'");
  if (dr) out.push({ key: 'demands-approve', title: `Demand runs waiting for approval: ${dr}`, detail: 'Head CRM approves; then the letters can go.', count: dr, link: '#/demands', priority: 'normal' });
  const dl = await one('select count(*)::int as n from demand_letters where sent_at is null');
  if (dl) out.push({ key: 'letters-unsent', title: `Demand letters not sent yet: ${dl}`, detail: 'Send by email or courier and record how it went.', count: dl, link: '#/letters', priority: 'normal' });
  const vi = await one("select count(*)::int as n from import_issues where status = 'open'");
  if (vi) out.push({ key: 'verify-open', title: `Items from the CRM sheet still to verify: ${vi}`, detail: 'Check each one against the file and close it.', count: vi, link: '#/verify', priority: 'normal' });
  const cf = await safe(cancelledFlags, null);
  const who = (s) => String(s || '').replace(/^[AB]\s*[-/]?\s*\d{3,4}\s*[-–]?\s*/i, '').trim();
  for (const r of (cf ? cf.still : []).slice(0, 15)) out.push({ key: 'canc-' + r.id, title: `${r.unit_no}: ${who(r.client) || 'the buyer'} is on the cancelled flats list${r.cancel_date ? ' (cancelled ' + fmtD(r.cancel_date) + ')' : ''} but the CRM still shows the booking`, detail: 'Accounts has it on the cancelled flats list. Cancel the booking in the CRM, or tell Accounts if the cancellation was reversed.', link: '#/bookings', priority: 'high' });
  for (const r of await safe(() => bounced(t), [])) out.push({ key: 'bounced-' + r.id, title: `Cheque returned: ${inr(r.amount)}${r.unit_no ? ' on ' + r.unit_no : ''}${r.payer_name ? ' (' + r.payer_name + ')' : ''}`, detail: 'Call the buyer today for a fresh payment and log the follow-up.', link: '#/followups', priority: 'high' });
  const g = pid ? await safe(() => tallyGaps(pid), null) : null;
  if (g && g.n) out.push({ key: 'tally-crm', title: `Flats where the CRM and Tally receipts differ: ${g.n}`, detail: 'Go through the Tally vs CRM page with Accounts and correct the CRM sheet where it is wrong.', count: g.n, link: '#/bookscrm', priority: 'normal' });
  return out;
}

// Runs the audit for a team and writes today's items. Running it again the same day updates the counts, adds new
// findings and ticks off (as cleared) the ones no longer found; what people ticked stays ticked.
async function run(dept, { trigger = 'manual', user = null, today = istToday(), mail = dept === 'accounts' } = {}) {
  if (!DEPTS[dept]) throw Object.assign(new Error('Unknown team.'), { status: 400 });
  let found = [], error = null;
  try { found = dept === 'accounts' ? await accountsFindings(today) : await crmFindings(today); } catch (e) { error = e.message; console.error(e); }
  const prev = await db.q("select key, since from daily_tasks where dept = $1 and source = 'audit' and task_date = (select max(task_date) from daily_tasks where dept = $1 and source = 'audit' and task_date < $2) and done_at is null", [dept, today]);
  const since = Object.fromEntries(prev.map((r) => [r.key, iso(r.since)]));
  await db.tx(async (t) => {
    for (const f of found) {
      await t.q(`insert into daily_tasks (dept, task_date, source, key, title, detail, link, count, priority, since)
                 values ($1, $2, 'audit', $3, $4, $5, $6, $7, $8, $9)
                 on conflict (dept, task_date, key) where key is not null do update set title = excluded.title, detail = excluded.detail, link = excluded.link, count = excluded.count, priority = excluded.priority,
                   cleared = false, done_at = case when daily_tasks.cleared then null else daily_tasks.done_at end, done_note = case when daily_tasks.cleared then null else daily_tasks.done_note end`,
      [dept, today, f.key, f.title, f.detail || null, f.link || null, f.count ?? null, f.priority || 'normal', since[f.key] || today]);
    }
    if (!error) await t.q("update daily_tasks set cleared = true, done_at = now(), done_note = 'Cleared: the audit no longer finds it' where dept = $1 and task_date = $2 and source = 'audit' and done_at is null and not (key = any($3))", [dept, today, found.map((f) => f.key)]);
  });
  let mailRes = null;
  if (mail && !error) mailRes = await safe(() => email(dept, today, found), { reason: 'The email could not be sent.' });
  const r = await db.one('insert into daily_audit_runs (dept, run_date, trigger, run_by, found, mail, error) values ($1, $2, $3, $4, $5, $6, $7) returning *', [dept, today, trigger, user ? user.id : null, found.length, mailRes ? JSON.stringify(mailRes) : null, error]);
  return { run: r, found };
}
const ranToday = async (dept, today = istToday()) => !!(await db.one('select 1 as x from daily_audit_runs where dept = $1 and run_date = $2 and error is null limit 1', [dept, today]));

// The 9 am email of the Accounts audit.
async function email(dept, today, found) {
  const live = process.env.ERP_LIVE === '1';
  const pdc = require('./pdc-mail');
  const rc = await pdc.recipients();
  const to = live ? rc.to : rc.test ? [rc.test] : [], cc = live ? rc.cc : [];
  if (!mailer.configured()) return { sent: false, reason: 'Email is not set up yet (SMTP app password).' };
  if (!to.length) return { sent: false, reason: 'Test version: set a test email address in Letter settings.' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = [...found].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));
  const subject = `${live ? '' : '[TEST] '}${DEPTS[dept].label} audit ${fmtD(today)}: ${found.length ? found.length + ' to do' : 'nothing to do'}`;
  const text = `${DEPTS[dept].label} audit, ${fmtD(today)}, 9 am.\n\n${list.map((f, i) => `${i + 1}. ${f.priority === 'high' ? '[Urgent] ' : ''}${f.title}\n   ${f.detail || ''}`).join('\n') || 'Nothing found.'}\n\nTick each one off on the Daily To-Do page of the ERP.`;
  const html = `<p>${esc(DEPTS[dept].label)} audit, <b>${esc(fmtD(today))}</b>, 9 am.</p><ol style="font-family:Arial,sans-serif;font-size:14px">${list.map((f) => `<li style="margin-bottom:8px">${f.priority === 'high' ? '<b style="color:#B42318">Urgent</b> ' : ''}<b>${esc(f.title)}</b><br><span style="color:#555">${esc(f.detail || '')}</span></li>`).join('') || '<li>Nothing found.</li>'}</ol><p style="color:#777;font-size:12px">Tick each one off on the Daily To-Do page of the Dream India ERP.</p>`;
  const conn = await mailer.connect();
  try { await conn.send({ to, cc, subject, text, html, fromName: 'Dream India ERP' }); } finally { await conn.close(); }
  return { sent: true, to, cc, test: !live };
}

// Today's list (or another day's): the audit items of that day plus own tasks of that day; for today, own tasks
// from earlier days that are still open are brought forward.
async function list(dept, date) {
  const t = istToday(), d = date || t;
  const rows = await db.q(`select k.*, a.name as assigned_name, c.name as created_name, x.name as done_name from daily_tasks k
      left join users a on a.id = k.assigned_to left join users c on c.id = k.created_by left join users x on x.id = k.done_by
     where k.dept = $1 and (k.task_date = $2 or ($2 = $3 and k.source = 'own' and k.task_date < $2 and (k.done_at is null or k.done_at::date >= $2)))
     order by k.done_at is not null, case k.priority when 'high' then 0 else 1 end, k.source, k.since nulls last, k.id`, [dept, d, t]);
  const runs = await db.q('select r.*, u.name as run_by_name from daily_audit_runs r left join users u on u.id = r.run_by where r.dept = $1 and r.run_date = $2 order by r.run_at desc', [dept, d]);
  return { date: d, today: t, rows: rows.map((r) => ({ ...r, task_date: iso(r.task_date), since: r.since ? iso(r.since) : null })), runs };
}

async function team(dept) {
  const us = await db.q('select id, name, role from users where not disabled order by name');
  const { ROLES } = require('./roles');
  return us.filter((x) => (ROLES[x.role]?.perms || []).some((p) => DEPTS[dept].edit.includes(p))).map((x) => ({ id: x.id, name: x.name }));
}

module.exports = { DEPTS, can, run, ranToday, list, team, accountsFindings, crmFindings };
