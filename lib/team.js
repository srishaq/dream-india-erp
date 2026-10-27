// CRM ↔ Accounts messages: one shared conversation between the two teams, each message optionally about a flat
// (or a receipt). A message can ask for something ("needs action"): it stays open until the other team marks it done.
// The ERP also posts here itself (a cheque returned, the cheques the bank statement cleared).
const db = require('./db');

const CRM = ['crm', 'head_crm', 'sales'], ACC = ['accounts', 'head_accounts'];
// The team a login belongs to (Admin and Management see and write to both).
const teamOf = (u) => (CRM.includes(u.role) ? 'crm' : ACC.includes(u.role) ? 'accounts' : 'both');
const other = (t) => (t === 'crm' ? 'accounts' : 'crm');

async function post({ to, body, userId = null, bookingId = null, receiptId = null, kind = 'msg', needsAction = false }) {
  const r = await db.one(`insert into team_messages (to_team, from_user, booking_id, receipt_id, body, kind, needs_action) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [to, userId, bookingId, receiptId, String(body).slice(0, 4000), kind, !!needsAction]);
  return r.id;
}
// From the ERP itself; never fails the job that posts it.
const system = (to, body, extra = {}) => post({ to, body, kind: 'system', ...extra }).catch((e) => console.error('team post', e.message));

// Messages for this login not read yet (sent to their team, by someone else).
async function unread(u) {
  const t = teamOf(u);
  const last = (await db.one('select last_id from team_reads where user_id = $1', [u.id]))?.last_id || 0;
  const r = await db.one(`select count(*)::int as n, count(*) filter (where needs_action and done_at is null)::int as open from team_messages
    where id > $1 and (from_user is null or from_user <> $2) and ($3 = 'both' or to_team = $3)`, [last, u.id, t]);
  return r;
}
async function markRead(u) {
  await db.q('insert into team_reads (user_id, last_id) values ($1, (select coalesce(max(id), 0) from team_messages)) on conflict (user_id) do update set last_id = excluded.last_id', [u.id]);
}

module.exports = { post, system, unread, markRead, teamOf, other };
