// PDC reminders: every morning (about 9:20 am) an email for each post-dated cheque due in 2 days (the 48-hour
// reminder) and in 1 day (the 24-hour reminder), to the accounts mailbox with Mr Mubeen copied. The date each
// reminder went is written on the PDC row (48-hour / 24-hour reminder sent), as on the sheet.
// Test version (ERP_LIVE is not 1): the emails go only to the test address in Letter settings.
const db = require('./db');
const mailer = require('./mailer');
const audit = require('./audit');

const BOOK = 'signature';
const istDate = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtD = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}-${y}`; };
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const live = () => process.env.ERP_LIVE === '1';
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));

// What is due for a reminder today (or on `today`). A 48-hour reminder missed (cheque added late) is not sent once the 24-hour one is due.
async function due(today = istDate()) {
  const rows = await db.q(`select * from acc_pdc where book = $1 and due_date in ($2::date + 1, $2::date + 2) order by due_date, id`, [BOOK, today]);
  const out = [];
  for (const r of rows) {
    const days = Math.round((Date.parse(iso(r.due_date)) - Date.parse(today)) / 86400000);
    if (days === 2 && !r.reminder48_on) out.push({ kind: '48h', row: r });
    if (days === 1 && !r.reminder24_on) out.push({ kind: '24h', row: r });
  }
  return out;
}

async function recipients() {
  const s = Object.fromEntries((await db.q("select key, value from acc_settings where book = $1 and key in ('pdc_to', 'pdc_cc')", [BOOK])).map((r) => [r.key, r.value]));
  const letters = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  return { to: emails(s.pdc_to || 'accounts.prime@dreamindiagroup.com'), cc: emails(s.pdc_cc || 'mohhammadmubeen@gmail.com'), test: letters.testEmail || null };
}

function message(kind, r) {
  const when = kind === '48h' ? 'in 2 days' : 'tomorrow';
  const subject = `PDC due ${when}: ${inr(r.amount)} to ${r.issued_to} on ${fmtD(r.due_date)}`;
  const lines = [['Cheque issued to', r.issued_to], ['Amount', inr(r.amount)], ['Bank', r.bank || '—'], ['Cheque no.', r.cheque_no || '—'], ['Due date', fmtD(r.due_date)], ['Given on', r.issued_on ? fmtD(r.issued_on) : '—']];
  const text = `This post-dated cheque is due ${when}. Keep enough balance in ${r.bank || 'the bank'} so it clears.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${kind === '48h' ? '48-hour' : '24-hour'} reminder from the Dream India ERP (PDC register).`;
  const html = `<p>This post-dated cheque is due <b>${when}</b>. Keep enough balance in ${esc(r.bank || 'the bank')} so it clears.</p>
<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${lines.map(([k, v]) => `<tr><td style="color:#555;border-bottom:1px solid #eee">${esc(k)}</td><td style="border-bottom:1px solid #eee"><b>${esc(v)}</b></td></tr>`).join('')}</table>
<p style="color:#777;font-size:12px">${kind === '48h' ? '48-hour' : '24-hour'} reminder from the Dream India ERP (PDC register).</p>`;
  return { subject, text, html };
}

// Sends today's reminders. Returns { sent:[...], skipped, reason }.
async function send({ user = null, today = istDate(), dryRun = false } = {}) {
  const list = await due(today);
  const rc = await recipients();
  const res = { today, due: list.map((x) => ({ kind: x.kind, id: x.row.id, issued_to: x.row.issued_to, amount: Number(x.row.amount), due_date: iso(x.row.due_date) })), sent: [], test: !live(), to: live() ? rc.to : (rc.test ? [rc.test] : []), cc: live() ? rc.cc : [] };
  if (!list.length || dryRun) return res;
  if (!mailer.configured()) return { ...res, reason: 'Email is not set up yet (SMTP app password), so no reminder was sent.' };
  if (!res.to.length) return { ...res, reason: 'This is the test version: set a test email address in Letter settings (Demand letters page). Reminders go only there until the ERP is live.' };
  const conn = await mailer.connect();
  try {
    for (const x of list) {
      const m = message(x.kind, x.row);
      await conn.send({ to: res.to, cc: res.cc, subject: (live() ? '' : '[TEST] ') + m.subject, text: m.text, html: m.html, fromName: 'Dream India ERP' });
      await db.tx(async (t) => {
        await t.q(`update acc_pdc set ${x.kind === '48h' ? 'reminder48_on' : 'reminder24_on'} = $2 where id = $1`, [x.row.id, today]);
        await t.q('insert into acc_pdc_mail (pdc_id, kind, sent_to, test) values ($1, $2, $3, $4) on conflict (pdc_id, kind) do nothing', [x.row.id, x.kind, [...res.to, ...res.cc].join(', '), !live()]);
        await audit.record(t.q, { user, action: 'pdc-reminder', entity: 'acc-pdc', entityId: x.row.id, after: { kind: x.kind, to: res.to.join(', '), cc: res.cc.join(', '), test: !live() } });
      });
      res.sent.push({ kind: x.kind, id: x.row.id });
    }
  } finally { await conn.close(); }
  return res;
}

module.exports = { due, send, message, recipients, addDays };
