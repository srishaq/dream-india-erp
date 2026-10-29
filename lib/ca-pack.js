// The CA's monthly pack, emailed on the 5th for the month before: a summary (GST, TDS, RERA) and that month's
// registers, in one Excel file. Sent once a month (job_marks 'ca-pack:YYYY-MM'); Accounts can also send it by hand.
// Safety: until the ERP is live (ERP_LIVE=1), it goes only to the test address in the letter settings.
const db = require('./db');
const mailer = require('./mailer');
const { REGISTERS } = require('./acc-schema');
const { write } = require('./xlsx-write');
const { today } = require('./demands');

const BOOK = 'signature';
const live = () => process.env.ERP_LIVE === '1';
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const monthName = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const prevMonth = (d = today()) => { const x = new Date(d + 'T00:00:00Z'); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); };
const bounds = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]; };

async function settings() {
  const r = await db.one("select value from settings where key = 'ca_pack'");
  return { to: '', cc: '', day: 5, on: true, ...(r ? r.value : {}) };
}
async function saveSettings(v) {
  await db.q("insert into settings (key, value) values ('ca_pack', $1) on conflict (key) do update set value = excluded.value", [v]);
}

// One register's rows for the month, with its own column headings.
async function register(key, from, to) {
  const R = REGISTERS[key];
  const cols = R.cols.filter((c) => !c.calc);
  const rows = await db.q(`select * from ${R.table} where book = $1 and ${R.dateKey} between $2 and $3 order by ${R.dateKey}, id`, [BOOK, from, to]);
  const cell = (c, v) => (v == null ? '' : c.type === 'money' || c.type === 'num' ? n(v) : c.type === 'pct' ? n(v) : v instanceof Date ? v : String(v));
  return { name: R.title.replace(/ – .*/, ''), rows: [[...(R.prefix ? [R.idLabel || 'ID'] : []), ...cols.map((c) => c.label)], ...rows.map((r) => [...(R.prefix ? [r.ref_id || '#' + r.id] : []), ...cols.map((c) => cell(c, r[c.key]))])],
    widths: [...(R.prefix ? [12] : []), ...cols.map((c) => (c.type === 'long' ? 40 : c.type === 'date' ? 12 : 18))], count: rows.length };
}

async function build(ym) {
  const [from, to] = bounds(ym);
  const M = await require('./ca-data').model().catch(() => null);
  const S = M ? M.summary : null, G = S ? S.gst : null, rate = S ? n(S.settings.gstRate) || 0.05 : 0.05;
  const g = (k) => (G && G[k] ? n(G[k][ym]) : 0);
  const consideration = g('av') + g('avOther') - g('ref') + g('tds');
  const pay = await db.one(`select coalesce(sum(tds_deducted), 0) as ded, coalesce(sum(tds_deducted) filter (where tds_deposited_on is not null), 0) as dep,
      count(*) filter (where tds_deducted > 0 and tds_deposited_on is null)::int as open from acc_payments where book = $1 and txn_date between $2 and $3`, [BOOK, from, to]);
  const ctds = await db.one('select coalesce(sum(tds_amount), 0) as amt, count(*)::int as n from acc_tds_entries where book = $1 and paid_on between $2 and $3', [BOOK, from, to]).catch(() => ({ amt: 0, n: 0 }));
  // RERA: agreement-value receipts in the month, and how much went into the RERA collection account
  let avIn = 0, avRera = 0;
  if (S && S.avr) for (const [, t, amt, intoRera] of S.avr) { const d = new Date(t).toISOString().slice(0, 10); if (d >= from && d <= to) { avIn += n(amt); if (intoRera) avRera += n(amt); } }
  const summary = [
    ['Dream Signature: monthly pack for the CA', monthName(ym)],
    ['Period', `${from} to ${to}`],
    [],
    ['GST', 'Amount (Rs.)'],
    ['Consideration received (agreement value + other charges − refunds + buyers\' TDS)', r2(consideration)],
    [`GST at ${Math.round(rate * 1000) / 10}% on that`, r2(consideration * rate)],
    ['GST collected from buyers', r2(g('gstIn'))],
    ['GST paid to the government', r2(g('gstPaid'))],
    [],
    ['TDS on our payments', 'Amount (Rs.)'],
    ['TDS deducted (Payments Out)', r2(pay.ded)],
    ['  of which deposited', r2(pay.dep)],
    ['  payments with TDS not yet deposited', pay.open],
    ['TDS deducted by buyers (194-IA), entries received', r2(ctds.amt)],
    [],
    ['RERA', 'Amount (Rs.)'],
    ['Agreement value received from buyers', r2(avIn)],
    ['  into the RERA collection account', r2(avRera)],
    ['  into other accounts', r2(avIn - avRera)],
  ];
  const regs = await Promise.all(['receipts', 'payments', 'tds', 'pdc', 'daily'].map((k) => register(k, from, to).catch(() => null)));
  const sheets = [{ name: 'Summary', rows: summary, widths: [70, 22] }, ...regs.filter(Boolean)];
  summary.push([], ['Registers in this file', 'Rows'], ...regs.filter(Boolean).map((r) => [r.name, r.count]));
  return { ym, from, to, file: write(sheets), filename: `Dream_Signature_CA_pack_${ym}.xlsx`, lines: summary };
}

// Send the pack for a month (default: last month). force=true sends again even if it went already.
async function send({ ym, force = false, user = null } = {}) {
  ym = ym || prevMonth();
  const key = 'ca-pack:' + ym;
  if (!force && await db.one('select 1 as x from job_marks where key = $1', [key])) return { skipped: `The ${monthName(ym)} pack was sent already.` };
  const set = await settings();
  if (!mailer.configured()) return { skipped: 'The sending email account is not connected to the ERP yet.' };
  const letters = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  const to = live() ? emails(set.to) : emails(letters.testEmail).slice(0, 1);
  if (!to.length) return { skipped: live() ? 'Set the CA\'s email address on the Checks page first.' : 'This is the test version: set a test email address in Letter settings. The pack goes only there until the ERP is live.' };
  const p = await build(ym);
  const text = `Dear Sir,\n\nPlease find attached the accounts pack for Dream Signature for ${monthName(ym)}: a summary of GST, TDS and RERA collections, with the month's receipts, payments, TDS entries, PDCs and daily bank balances.\n\n`
    + p.lines.filter((l) => l.length === 2 && typeof l[1] === 'number').slice(0, 14).map(([a, b]) => `${a.trim()}: ${Number(b).toLocaleString('en-IN')}`).join('\n')
    + `\n\nWarm regards,\nAccounts, Dream India`;
  const conn = await mailer.connect();
  try {
    await conn.send({ to, cc: live() ? emails(set.cc) : [], subject: `Dream Signature accounts pack: ${monthName(ym)}${live() ? '' : ' [TEST]'}`, text,
      attachments: [{ filename: p.filename, content: p.file, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] });
  } finally { await conn.close().catch(() => {}); }
  const info = { to, test: !live(), by: user ? user.name : 'schedule' };
  await db.q('insert into job_marks (key, info) values ($1, $2) on conflict (key) do update set info = excluded.info, done_at = now()', [key, info]);
  await require('./audit').record(db.q, { user, action: 'ca-pack', entity: 'acc-ca-pack', entityId: ym, after: info });
  return { sent: true, ym, ...info };
}

// The morning job: on the chosen day of the month (5th by default) and the days after, until it has gone.
async function morning(d = today()) {
  const set = await settings();
  if (set.on === false) return { skipped: 'off' };
  if (+d.slice(8, 10) < (+set.day || 5)) return { skipped: 'not yet' };
  return send({ ym: prevMonth(d) });
}

async function status() {
  const set = await settings();
  const last = await db.q("select key, done_at, info from job_marks where key like 'ca-pack:%' order by done_at desc limit 6");
  return { settings: set, last: last.map((r) => ({ month: r.key.slice(8), at: r.done_at, ...r.info })), live: live() };
}

module.exports = { build, send, morning, settings, saveSettings, status, prevMonth };
