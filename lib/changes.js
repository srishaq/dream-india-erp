// Changes that need the Chairman's or Sameer's approval (meeting of 5 Nov 2026): a receipt's amount, date or split
// (AV / GST / TDS / SDR), a booking's agreement value, and a buyer's name. Head CRM and Head Accounts ask; the change is
// made only when Syed Rafi Ishaq (or another Admin) or Syed Sameer Ishaq approves it. Everything is in the audit log.
const db = require('./db');
const audit = require('./audit');

const APPROVER_USERS = ['sameer'];
const isApprover = (u) => !!u && (u.role === 'admin' || APPROVER_USERS.includes(u.username));
const HEADS = ['av', 'gst', 'tds', 'stamp_duty', 'registration', 'other'];
const HEADL = { av: 'AV', gst: 'GST', tds: 'TDS', stamp_duty: 'Stamp duty', registration: 'Registration', other: 'Other' };
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const inr = (v) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const fail = (status, message) => Object.assign(new Error(message), { status });

async function approvers() {
  return db.q("select id, name, username, email, phone from users where not disabled and (role = 'admin' or username = any($1)) and username not in ('admin')", [APPROVER_USERS]);
}

async function notify(cr) {
  const sa = require('./staff-alerts');
  const to = (await approvers()).map((x) => x.email).filter(Boolean);
  const base = process.env.ERP_URL || 'https://erp.dreamindiarealty.com';
  const text = `${cr.requested_by_name} asks to change ${cr.title}.\n\n${cr.summary}\n\nReason: ${cr.reason}\n\nApprove or reject: ${base}/#/changes`;
  return sa.email({ to, subject: `Approval needed: ${cr.title}`, text, html: text.replace(/\n/g, '<br>').replace(/(https:\/\/\S+)/, '<a href="$1">$1</a>') }).catch((e) => ({ sent: false, reason: e.message }));
}

async function create({ user, kind, entityId, projectId, bookingId, title, summary, before, after, reason }) {
  if (!reason) throw fail(400, 'Give the reason for the change.');
  const row = await db.one(`insert into change_requests (kind, entity_id, project_id, booking_id, title, summary, before, after, reason, requested_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`, [kind, entityId, projectId, bookingId, title, summary, JSON.stringify(before), JSON.stringify(after), reason, user.id]);
  await audit.record(db.q, { user, action: 'change-request', entity: kind, entityId, projectId, before, after, note: reason });
  const n = await notify({ ...row, requested_by_name: user.name });
  return { ...row, notified: n };
}

// ---------- the changes ----------
// A receipt: new amount, date and split. The split must add up to the amount.
async function receiptChange(user, r, b) {
  const splitsNow = Object.fromEntries((await db.q('select head, amount from receipt_splits where receipt_id = $1', [r.id])).map((x) => [x.head, Number(x.amount)]));
  const amount = b.amount != null && b.amount !== '' ? r2(String(b.amount).replace(/[,₹\s]/g, '')) : Number(r.amount);
  if (!(amount > 0)) throw fail(400, 'The amount looks wrong.');
  const date = b.date ? String(b.date).slice(0, 10) : iso(r.received_on);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)) throw fail(400, 'The date looks wrong.');
  let splits = splitsNow;
  if (b.splits) { splits = {}; for (const h of HEADS) { const v = b.splits[h]; if (v === undefined || v === null || v === '') continue; const x = r2(String(v).replace(/[,₹\s]/g, '')); if (!(x >= 0)) throw fail(400, `The ${HEADL[h]} part looks wrong.`); if (x > 0) splits[h] = x; } }
  const sum = r2(Object.values(splits).reduce((a, v) => a + v, 0));
  if (Math.abs(sum - amount) > 0.009) throw fail(400, `The parts add up to ${inr(sum)}, but the receipt would be ${inr(amount)}. They must match.`);
  const before = { amount: Number(r.amount), date: iso(r.received_on), splits: splitsNow }, after = { amount, date, splits };
  const lines = [];
  if (before.amount !== after.amount) lines.push(`Amount ${inr(before.amount)} → ${inr(after.amount)}`);
  if (before.date !== after.date) lines.push(`Date ${before.date} → ${after.date}`);
  const sp = (s) => Object.entries(s).map(([h, v]) => `${HEADL[h] || h} ${inr(v)}`).join(', ');
  if (sp(before.splits) !== sp(after.splits)) lines.push(`Split ${sp(before.splits) || '—'} → ${sp(after.splits)}`);
  if (!lines.length) throw fail(400, 'Nothing was changed.');
  return { before, after, summary: lines.join('\n') };
}

async function apply(t, cr, approver) {
  const a = cr.after;
  if (cr.kind === 'receipt') {
    const r = await t.one('select * from receipts where id = $1 for update', [cr.entity_id]);
    if (!r) throw fail(404, 'The receipt is no longer there.');
    if (['rejected', 'reversed'].includes(r.status)) throw fail(409, `The receipt is ${r.status} now; the change cannot be made.`);
    await t.q('update receipts set amount = $2, received_on = $3 where id = $1', [r.id, a.amount, a.date]);
    await t.q('delete from receipt_splits where receipt_id = $1', [r.id]);
    for (const [h, v] of Object.entries(a.splits)) await t.q('insert into receipt_splits (receipt_id, head, amount) values ($1, $2, $3)', [r.id, h, v]);
  } else if (cr.kind === 'booking-av') {
    await t.q('update bookings set agreement_value = $2, brokerage = case when brokerage_pct is not null then round($2 * brokerage_pct / 100, 2) else brokerage end where id = $1', [cr.entity_id, a.agreement_value]);
    await t.q(`update demands d set amount = round(b.agreement_value * d.pct / 100, 2), gst = round(round(b.agreement_value * d.pct / 100, 2) * b.gst_rate / 100, 2)
      from bookings b where b.id = d.booking_id and d.booking_id = $1 and d.status = 'raised' and not d.opening`, [cr.entity_id]);
  } else if (cr.kind === 'buyer-name') {
    for (const x of a.names || []) await t.q('update buyers set name = $2 where id = $1', [x.buyer_id, x.name]);
  } else throw fail(400, 'Unknown change.');
  await audit.record(t.q, { user: approver, action: 'change-approved', entity: cr.kind, entityId: cr.entity_id, projectId: cr.project_id, before: cr.before, after: cr.after, note: `Asked by user ${cr.requested_by}: ${cr.reason}` });
}

async function decide(user, id, approve, note) {
  if (!isApprover(user)) throw fail(403, 'Only Syed Rafi Ishaq or Syed Sameer Ishaq can approve these changes.');
  return db.tx(async (t) => {
    const cr = await t.one('select * from change_requests where id = $1 for update', [id]);
    if (!cr) throw fail(404, 'Request not found.');
    if (cr.status !== 'pending') throw fail(409, `Already ${cr.status}.`);
    if (approve) await apply(t, cr, user);
    await t.q("update change_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1", [id, approve ? 'approved' : 'rejected', user.id, note || null]);
    if (!approve) await audit.record(t.q, { user, action: 'change-rejected', entity: cr.kind, entityId: cr.entity_id, projectId: cr.project_id, note: note || null });
    return { ok: true, status: approve ? 'approved' : 'rejected' };
  });
}

async function list(user, { status = 'pending' } = {}) {
  const mine = isApprover(user) ? '' : 'and c.requested_by = $2';
  return db.q(`select c.*, ru.name as requested_by_name, du.name as decided_by_name, u.unit_no from change_requests c left join users ru on ru.id = c.requested_by
      left join users du on du.id = c.decided_by left join bookings b on b.id = c.booking_id left join units u on u.id = b.unit_id
     where (c.status = $1 or $1 = 'all') ${mine} order by c.requested_at desc limit 300`, isApprover(user) ? [status] : [status, user.id]);
}

module.exports = { isApprover, create, decide, list, receiptChange, approvers, HEADS };
