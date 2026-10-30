// The 8 pm day reports (cron job=evening, 14:30 UTC):
//   CRM        → Head CRM: what the CRM team did today, person by person
//   Accounts   → Head Accounts: what the Accounts team did today, person by person
//   Management → Management (and any address in the settings): both, with the day's money in and out on top
// Everything comes from what was saved in the ERP today (IST), so a person with nothing saved shows "nothing recorded".
// Safety: until the ERP is live (ERP_LIVE=1), all three go only to the test address in Letter settings.
const db = require('./db');
const mailer = require('./mailer');
const audit = require('./audit');

const live = () => process.env.ERP_LIVE === '1';
const n = (v) => Number(v) || 0;
const inr = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10);
const fmtD = (d) => { const [y, m, dd] = iso(d).split('-'); return y ? `${dd}-${MON[+m - 1]}-${y}` : ''; };
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const plural = (k, w, ws) => `${k} ${k === 1 ? w : ws || w + 's'}`;

const CRM_ROLES = ['crm', 'head_crm', 'sales'];
const ACC_ROLES = ['accounts', 'head_accounts'];

// words for what a person changed, from the audit log
const ENTITY = { booking: ['flat', 'flats'], receipt: ['receipt', 'receipts'], 'follow-up': ['call', 'calls'], letter: ['demand letter', 'demand letters'], 'demand-run': ['demand run', 'demand runs'],
  stage: ['stage', 'stages'], 'daily-task': ['to-do item', 'to-do items'], 'acc-receipts': ['bank receipt', 'bank receipts'], 'acc-payments': ['payment out', 'payments out'],
  'acc-daily': ['daily balance', 'daily balances'], 'acc-pdc': ['PDC', 'PDCs'], 'acc-tds': ['TDS entry', 'TDS entries'], 'acc-recon': ['reconciling item', 'reconciling items'],
  'acc-compliance': ['compliance item', 'compliance items'], 'acc-cancellations': ['cancelled flat', 'cancelled flats'], 'acc-tenants': ['SRA tenant', 'SRA tenants'], 'acc-bank': ['bank', 'banks'],
  'acc-head': ['head', 'heads'], 'customer-doc': ['document', 'documents'], team: ['Dream Chat message', 'Dream Chat messages'], unit: ['flat (inventory)', 'flats (inventory)'] };
const SKIP = ['user', 'settings', 'project', 'portal'];
const what = (acts, id) => acts.filter((a) => a.user_id === id && !SKIP.includes(a.entity)).sort((a, b) => b.n - a.n).slice(0, 4).map((a) => { const w = ENTITY[a.entity] || [a.entity, a.entity]; return `${a.n} ${a.n === 1 ? w[0] : w[1]}`; });

async function settings() {
  const r = await db.one("select value from settings where key = 'day_report'").catch(() => null);
  return { on: true, crm: true, accounts: true, management: true, mgmtTo: '', ...(r ? r.value : {}) };
}
async function saveSettings(v) {
  await db.q("insert into settings (key, value) values ('day_report', $1) on conflict (key) do update set value = excluded.value", [v]);
}

async function team(roles) {
  return db.q('select id, name, role, email from users where not disabled and role = any($1) order by name', [roles]);
}

// ---------- the figures ----------
async function crmDay(d) {
  const from = `${d} 00:00:00+05:30`, to = `${d} 23:59:59.999+05:30`;
  const people = await team(CRM_ROLES);
  const names = Object.fromEntries((await db.q('select id, name from users')).map((u) => [u.id, u.name]));
  const rc = await db.q(`select r.id, r.amount, r.mode, r.status, r.received_on, r.created_by, u.unit_no,
        (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = r.booking_id) as buyer
      from receipts r left join bookings b on b.id = r.booking_id left join units u on u.id = b.unit_id
     where r.created_at between $1 and $2 and not r.opening and not coalesce(b.sample, false) order by r.created_at`, [from, to]);
  const fu = await db.q(`select f.created_by, f.kind, f.outcome, f.promise_date, f.promise_amount, f.next_date, u.unit_no
      from follow_ups f join bookings b on b.id = f.booking_id join units u on u.id = b.unit_id
     where f.created_at between $1 and $2 and not b.sample order by f.created_at`, [from, to]);
  const bk = await db.q(`select a.action, a.user_id, a.entity_id, u.unit_no from audit_log a left join bookings b on a.entity = 'booking' and b.id::text = a.entity_id left join units u on u.id = b.unit_id
     where a.at between $1 and $2 and a.entity = 'booking' and not coalesce(b.sample, false)`, [from, to]);
  const newBk = await db.q(`select b.id, b.created_by, b.status, b.agreement_value, u.unit_no from bookings b join units u on u.id = b.unit_id where b.created_at between $1 and $2 and not b.sample`, [from, to]);
  const letters = await db.q(`select l.sent_via, count(*)::int as n from demand_letters l join bookings b on b.id = l.booking_id where l.sent_at between $1 and $2 and not b.sample group by 1`, [from, to]);
  const made = await db.one(`select count(*)::int as n from demand_letters l join bookings b on b.id = l.booking_id where l.created_at between $1 and $2 and not b.sample`, [from, to]);
  const runs = await db.q(`select r.status, r.stage_name, bl.name as building, (select count(*)::int from demands d where d.run_id = r.id) as buyers,
        (select coalesce(sum(d.amount), 0) from demands d where d.run_id = r.id) as amount, (r.created_at between $1 and $2) as made_today, (r.approved_at between $1 and $2) as approved_today
      from demand_runs r left join buildings bl on bl.id = r.building_id where r.created_at between $1 and $2 or r.approved_at between $1 and $2`, [from, to]);
  const msgs = await db.one(`select count(*) filter (where direction = 'in')::int as inn, count(*) filter (where direction = 'out' and kind is distinct from 'test')::int as out,
        count(*) filter (where direction = 'in' and channel = 'whatsapp')::int as wa_in from communications where sent_at between $1 and $2`, [from, to]).catch(() => ({ inn: 0, out: 0, wa_in: 0 }));
  const tasks = await db.one(`select count(*)::int as total, count(*) filter (where done_at is not null)::int as done, count(*) filter (where done_at is null and priority = 'high')::int as urgent_open
      from daily_tasks where dept = 'crm' and task_date = $1`, [d]).catch(() => ({ total: 0, done: 0, urgent_open: 0 }));
  const acts = await db.q(`select user_id, entity, count(*)::int as n from audit_log where at between $1 and $2 and user_id = any($3) group by 1, 2`, [from, to, people.map((p) => p.id)]);
  const byPerson = people.map((p) => {
    const r = rc.filter((x) => x.created_by === p.id), f = fu.filter((x) => x.created_by === p.id);
    return { id: p.id, name: p.name, role: p.role, receipts: r.length, receiptAmt: r.reduce((a, x) => a + n(x.amount), 0), calls: f.length,
      promises: f.filter((x) => x.promise_date).length, bookings: newBk.filter((x) => x.created_by === p.id).length,
      changes: acts.filter((a) => a.user_id === p.id && !SKIP.includes(a.entity)).reduce((a, x) => a + x.n, 0), what: what(acts, p.id) };
  });
  const count = (act) => bk.filter((x) => x.action === act);
  return {
    receipts: rc.map((x) => ({ unit: x.unit_no, buyer: x.buyer, amount: n(x.amount), mode: x.mode, status: x.status, on: iso(x.received_on), by: names[x.created_by] || '' })),
    receiptTotal: rc.reduce((a, x) => a + n(x.amount), 0),
    calls: fu.length, reached: fu.filter((x) => !/not reach|no answer|switched off|busy/i.test(x.outcome || '')).length,
    promises: fu.filter((x) => x.promise_date).map((x) => ({ unit: x.unit_no, date: iso(x.promise_date), amount: n(x.promise_amount) })),
    outcomes: Object.entries(fu.reduce((m, x) => ((m[x.outcome] = (m[x.outcome] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
    bookings: { entered: newBk.map((x) => ({ unit: x.unit_no, av: n(x.agreement_value), status: x.status })), approved: count('approve').map((x) => x.unit_no),
      cancelRequested: count('cancel-request').map((x) => x.unit_no), cancelled: count('cancel').map((x) => x.unit_no),
      transferRequested: count('transfer-request').map((x) => x.unit_no), transferred: count('transfer').map((x) => x.unit_no), registered: count('register').map((x) => x.unit_no) },
    letters: { made: made.n, email: (letters.find((x) => x.sent_via === 'email') || {}).n || 0, whatsapp: (letters.find((x) => x.sent_via === 'whatsapp') || {}).n || 0, courier: (letters.find((x) => x.sent_via === 'courier') || {}).n || 0 },
    runs: runs.map((r) => ({ what: `${r.building || ''} · ${r.stage_name}`, buyers: r.buyers, amount: n(r.amount), status: r.status, madeToday: r.made_today, approvedToday: r.approved_today })),
    messages: msgs, tasks, people: byPerson,
  };
}

async function accDay(d) {
  const from = `${d} 00:00:00+05:30`, to = `${d} 23:59:59.999+05:30`;
  const people = await team(ACC_ROLES);
  const appr = await db.q(`select r.status, r.amount, r.approved_by, u.unit_no from receipts r left join bookings b on b.id = r.booking_id left join units u on u.id = b.unit_id
     where r.approved_at between $1 and $2 and not r.opening and not coalesce(b.sample, false)`, [from, to]);
  const waiting = await db.one(`select count(*)::int as n, coalesce(sum(r.amount), 0) as amt from receipts r left join bookings b on b.id = r.booking_id where r.status = 'pending' and not r.opening and not coalesce(b.sample, false)`);
  const br = await db.q(`select created_by, amount, head, unit_no, payer_name, bank from acc_receipts where created_at between $1 and $2 and not imported`, [from, to]);
  const bp = await db.q(`select created_by, amount, head, payee, tds_deducted, bank from acc_payments where created_at between $1 and $2 and not imported order by amount desc nulls last`, [from, to]);
  const ed = await db.one(`select (select count(*)::int from acc_receipts where updated_at between $1 and $2) + (select count(*)::int from acc_payments where updated_at between $1 and $2) as n`, [from, to]);
  const regs = await db.q(`select a.action, a.entity, a.user_id, a.note from audit_log a where a.at between $1 and $2 and (a.entity like 'acc-%' or a.entity in ('receipt', 'accounts'))`, [from, to]);
  const confirmed = await db.q("select key, info from job_marks where key like 'daily-confirm:%' and done_at between $1 and $2", [from, to]).catch(() => []);
  const tasks = await db.one(`select count(*)::int as total, count(*) filter (where done_at is not null)::int as done, count(*) filter (where done_at is null and priority = 'high')::int as urgent_open
      from daily_tasks where dept = 'accounts' and task_date = $1`, [d]).catch(() => ({ total: 0, done: 0, urgent_open: 0 }));
  const acts = await db.q(`select user_id, entity, count(*)::int as n from audit_log where at between $1 and $2 and user_id = any($3) group by 1, 2`, [from, to, people.map((p) => p.id)]);
  const byPerson = people.map((p) => {
    const r = br.filter((x) => x.created_by === p.id), q = bp.filter((x) => x.created_by === p.id);
    return { id: p.id, name: p.name, role: p.role, bankReceipts: r.length, bankReceiptAmt: r.reduce((a, x) => a + n(x.amount), 0), payments: q.length, paymentAmt: q.reduce((a, x) => a + n(x.amount), 0),
      approved: appr.filter((x) => x.approved_by === p.id && x.status !== 'rejected').length,
      changes: acts.filter((a) => a.user_id === p.id && !SKIP.includes(a.entity)).reduce((a, x) => a + x.n, 0), what: what(acts, p.id) };
  });
  const ra = (act, ent = 'receipt') => regs.filter((x) => x.entity === ent && x.action === act).length;
  return {
    approved: appr.filter((x) => x.status !== 'rejected').length, approvedAmt: appr.filter((x) => x.status !== 'rejected').reduce((a, x) => a + n(x.amount), 0),
    rejected: appr.filter((x) => x.status === 'rejected').length, waiting,
    bankReceipts: br.length, bankReceiptAmt: br.reduce((a, x) => a + n(x.amount), 0), noHead: br.filter((x) => !x.head).length,
    payments: bp.length, paymentAmt: bp.reduce((a, x) => a + n(x.amount), 0), tds: bp.reduce((a, x) => a + n(x.tds_deducted), 0),
    topPayments: bp.slice(0, 8).map((x) => ({ payee: x.payee || '—', head: x.head || '—', amount: n(x.amount) })),
    edited: ed.n, deposited: ra('deposited'), bounced: ra('bounce'), autoApproved: regs.filter((x) => x.entity === 'receipt' && x.action === 'approve' && !x.user_id).length,
    statements: regs.filter((x) => x.entity === 'accounts' && x.action === 'bank-statements').length, confirmed: confirmed.map((c) => c.key.slice(14)),
    refunds: regs.filter((x) => x.entity === 'acc-cancellations' && x.action.startsWith('update')).length,
    tasks, people: byPerson,
  };
}

// ---------- the emails ----------
const H = { table: 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin:6px 0 14px', th: 'text-align:left;padding:5px 8px;border-bottom:2px solid #d0d5dd;color:#475467;font-weight:600', td: 'padding:5px 8px;border-bottom:1px solid #eaecf0;vertical-align:top', num: 'padding:5px 8px;border-bottom:1px solid #eaecf0;text-align:right;white-space:nowrap' };
const table = (head, rows, nums = []) => rows.length ? `<table style="${H.table}"><tr>${head.map((h, i) => `<th style="${H.th}${nums.includes(i) ? ';text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="${nums.includes(i) ? H.num : H.td}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '';
const kpis = (items) => `<table style="border-collapse:separate;border-spacing:6px;font-family:Arial,sans-serif;margin:0 -6px 8px"><tr>${items.map(([v, l]) => `<td style="background:#f2f4f7;border-radius:8px;padding:10px 14px;min-width:110px"><div style="font-size:18px;font-weight:700;color:#10114e">${esc(v)}</div><div style="font-size:12px;color:#475467">${esc(l)}</div></td>`).join('')}</tr></table>`;
const h2 = (t) => `<h2 style="font-family:Arial,sans-serif;font-size:16px;color:#10114e;margin:18px 0 4px">${esc(t)}</h2>`;
const p = (t) => `<p style="font-family:Arial,sans-serif;font-size:13px;color:#344054;margin:4px 0">${t}</p>`;
const list = (label, units) => units.length ? `${esc(label)}: ${esc(units.slice(0, 12).join(', '))}${units.length > 12 ? ' …' : ''}` : '';

function crmHtml(c) {
  const b = c.bookings;
  const bookLines = [list('New bookings entered', b.entered.map((x) => x.unit)), list('Approved', b.approved), list('Registered', b.registered), list('Cancellation asked', b.cancelRequested), list('Cancelled', b.cancelled), list('Transfer asked', b.transferRequested), list('Transferred', b.transferred)].filter(Boolean);
  return kpis([[inr(c.receiptTotal), plural(c.receipts.length, 'receipt') + ' entered'], [String(c.calls), 'calls logged'], [String(c.promises.length), 'promises to pay'], [`${c.tasks.done} of ${c.tasks.total}`, 'Today list done']])
    + h2('Receipts entered today') + (c.receipts.length ? table(['Flat', 'Buyer', 'Amount', 'How', 'Status', 'Entered by'], c.receipts.map((r) => [r.unit || '—', r.buyer || '—', inr(r.amount), r.mode || '', r.status === 'pending' ? 'waiting for Accounts' : r.status, r.by]), [2]) : p('No receipts were entered.'))
    + h2('Calls and follow-ups') + (c.calls ? p(`${plural(c.calls, 'call')} logged${c.outcomes.length ? ': ' + esc(c.outcomes.slice(0, 5).map(([o, k]) => `${o} ${k}`).join(', ')) : ''}.`)
      + (c.promises.length ? table(['Flat', 'Promised to pay on', 'Amount'], c.promises.map((x) => [x.unit, fmtD(x.date), x.amount ? inr(x.amount) : '—']), [2]) : '') : p('No calls were logged.'))
    + h2('Bookings, letters and demands') + p(bookLines.length ? bookLines.join('<br>') : 'No booking changes.')
    + p(`Demand letters: ${c.letters.made} prepared, ${c.letters.email} emailed, ${c.letters.whatsapp} sent on WhatsApp, ${c.letters.courier} marked couriered.`)
    + (c.runs.length ? table(['Demand run', 'Buyers', 'Amount', 'Today'], c.runs.map((r) => [r.what, String(r.buyers), inr(r.amount), [r.madeToday ? 'prepared' : '', r.approvedToday ? 'approved' : ''].filter(Boolean).join(' and ')]), [1, 2]) : '')
    + p(`Buyer messages: ${c.messages.inn} received (${c.messages.wa_in} on WhatsApp), ${c.messages.out} sent.${c.tasks.urgent_open ? ` <b style="color:#B42318">${plural(c.tasks.urgent_open, 'urgent item')} on the Today list still open.</b>` : ''}`)
    + h2('Person by person') + table(['Name', 'Receipts', 'Amount', 'Calls', 'Promises', 'Bookings', 'What they saved'], c.people.map((x) => [x.name, String(x.receipts), x.receipts ? inr(x.receiptAmt) : '—', String(x.calls), String(x.promises), String(x.bookings), x.changes ? x.what.join(', ') : 'nothing recorded']), [1, 2, 3, 4, 5]);
}
function accHtml(a) {
  return kpis([[inr(a.approvedAmt), plural(a.approved, 'receipt') + ' approved'], [inr(a.bankReceiptAmt), plural(a.bankReceipts, 'bank receipt') + ' entered'], [inr(a.paymentAmt), plural(a.payments, 'payment') + ' out'], [`${a.tasks.done} of ${a.tasks.total}`, 'Today list done']])
    + h2('Buyer receipts') + p(`${plural(a.approved, 'receipt')} approved (${inr(a.approvedAmt)})${a.autoApproved ? `, of which ${a.autoApproved} matched the bank statement by themselves` : ''}${a.rejected ? `, ${a.rejected} rejected` : ''}. Still waiting for approval: ${a.waiting.n} (${inr(a.waiting.amt)}).`)
      + p(`Cheques marked deposited: ${a.deposited}. Marked bounced: ${a.bounced}.`)
    + h2('Registers') + p(`Bank receipts entered: ${a.bankReceipts} (${inr(a.bankReceiptAmt)})${a.noHead ? `, <b>${a.noHead} without a head</b>` : ''}. Payments out entered: ${a.payments} (${inr(a.paymentAmt)}), TDS deducted ${inr(a.tds)}. Rows corrected: ${a.edited}.`)
      + (a.topPayments.length ? table(['Paid to', 'Head', 'Amount'], a.topPayments.map((x) => [x.payee, x.head, inr(x.amount)]), [2]) : '')
    + h2('Bank') + p(`Bank statements read: ${a.statements ? 'yes' : 'no'}. Closing balances confirmed today: ${a.confirmed.length ? a.confirmed.map(fmtD).join(', ') : '<b>none</b>'}.${a.refunds ? ` Refund lines updated: ${a.refunds}.` : ''}${a.tasks.urgent_open ? ` <b style="color:#B42318">${plural(a.tasks.urgent_open, 'urgent item')} on the Today list still open.</b>` : ''}`)
    + h2('Person by person') + table(['Name', 'Bank receipts', 'Amount', 'Payments', 'Amount', 'Approved', 'What they saved'], a.people.map((x) => [x.name, String(x.bankReceipts), x.bankReceipts ? inr(x.bankReceiptAmt) : '—', String(x.payments), x.payments ? inr(x.paymentAmt) : '—', String(x.approved), x.changes ? x.what.join(', ') : 'nothing recorded']), [1, 2, 3, 4, 5]);
}
const wrap = (title, d, body) => `<div style="max-width:760px"><p style="font-family:Arial,sans-serif;font-size:13px;color:#667085;margin:0">Dream India ERP · ${esc(fmtD(d))} · 8 pm</p><h1 style="font-family:Arial,sans-serif;font-size:20px;color:#10114e;margin:2px 0 10px">${esc(title)}</h1>${body}<p style="font-family:Arial,sans-serif;font-size:12px;color:#98a2b3;margin-top:18px">Counted from what was saved in the ERP today. Open the ERP for the details: erp.dreamindiarealty.com</p></div>`;
const textOf = (html) => html.replace(/<br>/g, '\n').replace(/<\/(p|h1|h2|tr)>/g, '\n').replace(/<\/t[dh]>/g, '  ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();

async function build(d = istToday()) {
  const [c, a] = await Promise.all([crmDay(d), accDay(d)]);
  const crmSub = `CRM day report ${fmtD(d)}: ${inr(c.receiptTotal)} in ${plural(c.receipts.length, 'receipt')}, ${plural(c.calls, 'call')}`;
  const accSub = `Accounts day report ${fmtD(d)}: ${plural(a.approved, 'receipt')} approved, ${plural(a.payments, 'payment')} out`;
  const mgmtBody = kpis([[inr(c.receiptTotal), 'receipts entered by CRM'], [inr(a.approvedAmt), 'receipts approved'], [inr(a.paymentAmt), 'paid out'], [String(c.calls), 'buyer calls']])
    + `<h2 style="font-family:Arial,sans-serif;font-size:18px;color:#10114e;margin:20px 0 0;border-top:3px solid #10114e;padding-top:10px">CRM</h2>` + crmHtml(c)
    + `<h2 style="font-family:Arial,sans-serif;font-size:18px;color:#10114e;margin:24px 0 0;border-top:3px solid #10114e;padding-top:10px">Accounts</h2>` + accHtml(a);
  return {
    date: d, crm: c, accounts: a,
    mails: {
      crm: { subject: crmSub, html: wrap('CRM: the day\'s work', d, crmHtml(c)) },
      accounts: { subject: accSub, html: wrap('Accounts: the day\'s work', d, accHtml(a)) },
      management: { subject: `Day report ${fmtD(d)}: ${inr(c.receiptTotal)} received, ${inr(a.paymentAmt)} paid out`, html: wrap('CRM and Accounts: the day\'s work', d, mgmtBody) },
    },
  };
}

async function recipients(set) {
  const withMail = async (roles) => (await team(roles)).flatMap((u) => emails(u.email));
  return { crm: await withMail(['head_crm']), accounts: await withMail(['head_accounts']), management: [...new Set([...(await withMail(['management'])), ...emails(set.mgmtTo)])] };
}

// Send the day's reports. only: one of 'crm' | 'accounts' | 'management' (a test from the settings page).
async function send({ d = istToday(), only = null, user = null, force = false } = {}) {
  const set = await settings();
  if (!only && set.on === false) return { skipped: 'The 8 pm reports are switched off.' };
  if (!only && !force && await db.one('select 1 as x from job_marks where key = $1', ['day-report:' + d])) return { skipped: 'Already sent today.' };
  if (!mailer.configured()) return { skipped: 'The sending email account is not connected to the ERP yet.' };
  const letters = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  const test = emails(letters.testEmail).slice(0, 1);
  if (!live() && !test.length) return { skipped: 'This is the test version: set a test email address in Letter settings. The reports go only there until the ERP is live.' };
  const R = await build(d), rc = await recipients(set), out = {};
  const conn = await mailer.connect();
  try {
    for (const k of ['crm', 'accounts', 'management']) {
      if (only && only !== k) continue;
      if (!only && set[k] === false) { out[k] = 'off'; continue; }
      const to = live() ? rc[k] : test;
      if (!to.length) { out[k] = k === 'management' ? 'no address: add one in the 8 pm report settings' : `no ${k === 'crm' ? 'Head CRM' : 'Head Accounts'} login with an email address`; continue; }
      const m = R.mails[k], note = live() ? '' : `<p style="font-family:Arial,sans-serif;font-size:12px;color:#B54708">Test version: once the ERP is live this goes to ${esc(rc[k].join(', ') || '(nobody yet: add an email address)')}.</p>`;
      await conn.send({ to, subject: (live() ? '' : '[TEST] ') + m.subject, html: note + m.html, text: textOf(note + m.html), fromName: 'Dream India ERP' });
      out[k] = { to, test: !live() };
    }
  } finally { await conn.close().catch(() => {}); }
  if (!only) await db.q('insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()', ['day-report:' + d, out]);
  await audit.record(db.q, { user, action: only ? 'day-report-test' : 'day-report', entity: 'settings', entityId: d, after: out });
  return { sent: true, ...out };
}

async function status() {
  const set = await settings(); const rc = await recipients(set);
  const last = await db.q("select key, done_at, info from job_marks where key like 'day-report:%' order by done_at desc limit 5");
  return { settings: set, recipients: rc, live: live(), last: last.map((r) => ({ date: r.key.slice(11), at: r.done_at, info: r.info })) };
}

module.exports = { build, send, settings, saveSettings, status, crmDay, accDay };
