// Brokerage bills (tax invoices) sent by approved partners on the portal. The file (PDF, JPG or PNG, up to 5 MB) is
// sent in parts (a request may carry at most 4.5 MB) and kept in the database. Accounts is told (a Dream Chat message
// that needs action, the morning To-Do, and an email to the accounts mailbox), opens the bill from the channel partner
// ledger, and marks it checked (it then becomes a 'bill' entry in the ledger) or rejected with a reason the partner sees.
const db = require('./db');
const audit = require('./audit');

const err = (status, message) => Object.assign(new Error(message), { status });
const MAX = 5 * 1024 * 1024, PART = 1536 * 1024, PER_DAY = 20;
const MIME = { 'application/pdf': (b) => b.slice(0, 5).toString('latin1') === '%PDF-', 'image/png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff };
const STATUS = { submitted: 'With Accounts for checking', checked: 'Checked', rejected: 'Rejected' };
const n = (v) => Number(v) || 0;
const r2 = (x) => Math.round(x * 100) / 100;
const money = (v, zeroOk) => { const x = Number(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return Number.isFinite(x) && (zeroOk ? x >= 0 : x > 0) ? r2(x) : NaN; };
const iso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const inr = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
// an int[] column comes back from the driver as text ("{1,2}")
const ints = (v) => (Array.isArray(v) ? v.map(Number) : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));

// The flats a partner can put on a bill: its own bookings.
const ownFlats = (cpId) => db.q(`select b.id, u.unit_no, p.name as project, b.status from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id
  where b.cp_id = $1 and b.status in ('active', 'cancelled') and not b.sample order by p.name, u.unit_no`, [cpId]);

async function start(cp, { billNo, billDate, amount, gst, bookingIds, file }) {
  const no = String(billNo || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!no) throw err(400, 'Enter your bill (invoice) number.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(billDate || '') ? billDate : null;
  if (!date || date > istToday() || date < '2015-01-01') throw err(400, 'Enter the bill date (not in the future).');
  const amt = money(amount), tax = money(gst == null || gst === '' ? 0 : gst, true);
  if (!Number.isFinite(amt)) throw err(400, 'Enter the taxable amount of the bill in rupees.');
  if (!Number.isFinite(tax)) throw err(400, 'Enter the GST amount in rupees (0 if none).');
  if (tax > amt * 0.3) throw err(400, 'The GST amount looks too high for this taxable amount. Please check.');
  const f = file || {};
  if (!MIME[f.mime]) throw err(400, 'Attach the bill as a PDF, JPG or PNG.');
  const size = Math.trunc(Number(f.size) || 0);
  if (!size || size > MAX) throw err(400, 'The file must be under 5 MB.');
  const ids = [...new Set((Array.isArray(bookingIds) ? bookingIds : []).map(Number).filter(Boolean))].slice(0, 100);
  if (ids.length) {
    const own = new Set((await ownFlats(cp.id)).map((x) => x.id));
    if (ids.some((x) => !own.has(x))) throw err(400, 'Choose only flats booked through your firm.');
  }
  if (await dupOf(cp.id, no)) throw err(409, `Bill ${no} has already been sent. Each bill number can be sent once.`);
  await db.q("delete from cp_bills where status = 'uploading' and created_at < now() - interval '1 day'");
  const today = await db.one("select count(*)::int as c from cp_bills where cp_id = $1 and created_at > now() - interval '1 day'", [cp.id]);
  if (today.c >= PER_DAY) throw err(429, `You can send up to ${PER_DAY} bills a day. Please send the rest tomorrow.`);
  const r = await db.one(`insert into cp_bills (cp_id, bill_no, bill_date, amount, gst, booking_ids, file_name, mime, size) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [cp.id, no, date, amt, tax, ids, String(f.name || 'bill').replace(/[\\/\r\n]+/g, '_').slice(0, 120), f.mime, size]);
  return { id: r.id, part: PART, parts: Math.ceil(size / PART) };
}
const dupOf = async (cpId, no) => (await db.one("select 1 as x from cp_bills where cp_id = $1 and lower(bill_no) = lower($2) and status in ('submitted', 'checked')", [cpId, no]))
  || (await db.one("select 1 as x from brokerage_entries where cp_id = $1 and kind = 'bill' and lower(reference) = lower($2) and cancelled_at is null", [cpId, no]));

async function part(cp, { id, i, data }) {
  const b = await db.one("select id, size from cp_bills where id = $1 and cp_id = $2 and status = 'uploading'", [Number(id) || 0, cp.id]);
  if (!b) throw err(404, 'This upload is not there any more. Please send the bill again.');
  const k = Math.trunc(Number(i)), parts = Math.ceil(b.size / PART);
  if (!(k >= 0 && k < parts)) throw err(400, 'Wrong part.');
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length || buf.length > PART || (k < parts - 1 && buf.length !== PART)) throw err(400, 'Wrong part size.');
  await db.q('insert into cp_bill_parts (bill_id, i, data) values ($1, $2, $3) on conflict (bill_id, i) do update set data = excluded.data', [b.id, k, buf]);
  return { ok: true };
}

async function finish(cp, { id }) {
  const out = await db.tx(async (t) => {
    const b = await t.one("select * from cp_bills where id = $1 and cp_id = $2 and status = 'uploading' for update", [Number(id) || 0, cp.id]);
    if (!b) throw err(404, 'This upload is not there any more. Please send the bill again.');
    const p = await t.one('select count(*)::int as c, coalesce(sum(length(data)), 0)::int as s from cp_bill_parts where bill_id = $1', [b.id]);
    if (p.c !== Math.ceil(b.size / PART) || p.s !== b.size) throw err(400, 'The file did not arrive completely. Please send it again.');
    const head = await t.one('select substring(data from 1 for 8) as h from cp_bill_parts where bill_id = $1 and i = 0', [b.id]);
    if (!MIME[b.mime](Buffer.from(head.h))) { await t.q('delete from cp_bills where id = $1', [b.id]); throw err(400, 'This file is not a real PDF, JPG or PNG. Please attach the bill again.'); }
    if (await t.one("select 1 as x from cp_bills where cp_id = $1 and lower(bill_no) = lower($2) and status in ('submitted', 'checked') and id <> $3", [cp.id, b.bill_no, b.id])) throw err(409, `Bill ${b.bill_no} has already been sent.`);
    await t.q(`update cp_bills set data = (select string_agg(data, ''::bytea order by i) from cp_bill_parts where bill_id = $1), status = 'submitted', submitted_at = now() where id = $1`, [b.id]);
    await t.q('delete from cp_bill_parts where bill_id = $1', [b.id]);
    await audit.record(t.q, { user: null, action: 'partner-bill', entity: 'channel-partner', entityId: cp.id, after: { bill: b.id, billNo: b.bill_no, amount: b.amount, gst: b.gst } });
    return b;
  });
  await notify(cp, out).catch((e) => console.error('cp bill notify', e.message));
  return { ok: true, id: out.id, status: STATUS.submitted };
}

// Accounts hears of a new bill three ways: Dream Chat (needs action), today's To-Do, and the accounts mailbox.
async function notify(cp, b) {
  const T = require('./team');
  const what = `${cp.name} (${cp.cp_code}) sent brokerage bill ${b.bill_no} dated ${iso(b.bill_date)} for ${inr(b.amount)} + GST ${inr(b.gst)} on the partner portal.`;
  await T.system('accounts', `${what} Check it under Channel partner ledger → ${cp.name} → Bills from the partner portal.`, { needsAction: true });
  const open = await db.one("select count(*)::int as c, coalesce(sum(amount), 0) as a from cp_bills where status = 'submitted'");
  const t = istToday();
  await db.q(`insert into daily_tasks (dept, task_date, source, key, title, detail, link, count, priority, since)
      values ('accounts', $1, 'audit', 'cp-bills', $2, $3, '#/partners', $4, 'normal', $1)
      on conflict (dept, task_date, key) where key is not null do update set title = excluded.title, detail = excluded.detail, count = excluded.count, cleared = false`,
  [t, `Partner bills to check: ${open.c} (${inr(open.a)})`, 'Bills partners sent on the partner portal. Open each one in the Channel partner ledger and mark it checked or rejected.', open.c]).catch((e) => console.error('cp bill todo', e.message));
  const mailer = require('./mailer');
  if (!mailer.configured()) return;
  const pdc = require('./pdc-mail'), rc = await pdc.recipients(), live = process.env.ERP_LIVE === '1';
  const to = live ? rc.to : rc.test ? [rc.test] : [];
  if (!to.length) return;
  const c = await mailer.connect();
  try { await c.send({ to, subject: `${live ? '' : '[TEST] '}Partner bill to check: ${cp.name} ${b.bill_no}`, text: `${what}\n\nOpen the ERP → Accounts → Channel partner ledger to check it.`, fromName: 'Dream India ERP' }); }
  finally { await c.close(); }
}
// For the morning To-Do of Accounts (lib/daily-tasks.js).
async function finding() {
  const r = await db.one("select count(*)::int as c, coalesce(sum(amount), 0) as a, min(submitted_at) as since from cp_bills where status = 'submitted'");
  return r.c ? { key: 'cp-bills', title: `Partner bills to check: ${r.c} (${inr(r.a)})`, detail: 'Bills partners sent on the partner portal. Open each one in the Channel partner ledger and mark it checked or rejected.', count: r.c, link: '#/partners', priority: 'normal' } : null;
}

const pub = (b, flats) => ({ id: b.id, billNo: b.bill_no, billDate: iso(b.bill_date), amount: n(b.amount), gst: n(b.gst), total: r2(n(b.amount) + n(b.gst)), fileName: b.file_name,
  flats: ints(b.booking_ids).map((x) => flats[x]).filter(Boolean), status: b.status, statusLabel: STATUS[b.status] || b.status, reason: b.status === 'rejected' ? b.reason : null,
  sentOn: b.submitted_at, checkedOn: b.checked_at });
// The partner's own bills.
async function mine(cpId) {
  const flats = await ownFlats(cpId);
  const F = Object.fromEntries(flats.map((x) => [x.id, `${x.project} ${x.unit_no}`]));
  const rows = await db.q("select id, bill_no, bill_date, amount, gst, booking_ids, file_name, status, reason, submitted_at, checked_at from cp_bills where cp_id = $1 and status <> 'uploading' order by id desc limit 500", [cpId]);
  return { bills: rows.map((b) => pub(b, F)), flats: flats.map((x) => ({ id: x.id, project: x.project, unitNo: x.unit_no, status: x.status })), maxMb: MAX / 1024 / 1024, perDay: PER_DAY, part: PART };
}
// Staff: bills (to check, or of one firm), without the file.
async function list({ cpId = null, status = null } = {}) {
  const rows = await db.q(`select b.id, b.cp_id, b.bill_no, b.bill_date, b.amount, b.gst, b.booking_ids, b.file_name, b.mime, b.size, b.status, b.reason, b.submitted_at, b.checked_at, b.entry_id,
      c.name as firm, c.cp_code, x.name as checked_name,
      (select string_agg(u.unit_no, ', ' order by u.unit_no) from bookings k join units u on u.id = k.unit_id where k.id = any(b.booking_ids)) as flats
    from cp_bills b join channel_partners c on c.id = b.cp_id left join users x on x.id = b.checked_by
    where b.status <> 'uploading' and ($1::int is null or b.cp_id = $1) and ($2::text is null or b.status = $2) order by b.status = 'submitted' desc, b.id desc limit 500`, [cpId, status]);
  return rows.map((b) => ({ ...b, booking_ids: ints(b.booking_ids), bill_date: iso(b.bill_date), amount: n(b.amount), gst: n(b.gst), statusLabel: STATUS[b.status] }));
}
const DL = 2 * 1024 * 1024; // a response may carry at most 4.5 MB: the file comes back in parts
async function filePart(id, k) {
  const b = await db.one("select id, file_name, mime, length(data)::int as size from cp_bills where id = $1 and data is not null and status <> 'uploading'", [id]);
  if (!b) throw err(404, 'No file.');
  const parts = Math.max(1, Math.ceil(b.size / DL)), i = Math.min(Math.max(0, Math.trunc(Number(k) || 0)), parts - 1);
  const d = await db.one('select substring(data from $2 for $3) as d from cp_bills where id = $1', [id, i * DL + 1, DL]);
  return { name: b.file_name, mime: b.mime, size: b.size, parts, part: i, data: Buffer.from(d.d).toString('base64') };
}
async function decide({ id, decision, reason, user }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (!['checked', 'rejected'].includes(decision)) throw err(400, 'Mark the bill checked or rejected.');
  if (decision === 'rejected' && !why) throw err(400, 'Give the reason: the partner sees it.');
  return db.tx(async (t) => {
    const b = await t.one("select * from cp_bills where id = $1 and status = 'submitted' for update", [Number(id) || 0]);
    if (!b) throw err(409, 'Only a bill waiting to be checked can be checked or rejected.');
    b.booking_ids = ints(b.booking_ids);
    let entryId = null;
    if (decision === 'checked') {
      const ex = await t.one("select id from brokerage_entries where cp_id = $1 and kind = 'bill' and lower(reference) = lower($2) and cancelled_at is null", [b.cp_id, b.bill_no]);
      entryId = ex ? ex.id : (await t.one(`insert into brokerage_entries (booking_id, cp_id, kind, entry_date, amount, reference, note, created_by, verified_by, verified_at)
          values ($1, $2, 'bill', $3, $4, $5, $6, $7, $7, now()) returning id`,
        [b.booking_ids.length === 1 ? b.booking_ids[0] : null, b.cp_id, iso(b.bill_date), b.amount, b.bill_no, `From the partner portal (bill #${b.id}); GST ${inr(b.gst)}${b.booking_ids.length > 1 ? `; ${b.booking_ids.length} flats` : ''}${why ? '; ' + why : ''}`.slice(0, 300), user.id])).id;
    }
    await t.q('update cp_bills set status = $2, reason = $3, checked_by = $4, checked_at = now(), entry_id = $5 where id = $1', [b.id, decision, why || null, user.id, entryId]);
    await audit.record(t.q, { user, action: 'cp-bill-' + decision, entity: 'channel-partner', entityId: b.cp_id, after: { bill: b.id, billNo: b.bill_no, entry: entryId }, note: why || null });
    return { ok: true, status: decision, entryId };
  });
}

module.exports = { MAX, PART, PER_DAY, STATUS, start, part, finish, mine, list, filePart, decide, finding };
