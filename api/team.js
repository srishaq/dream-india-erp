// Dream Chat (CRM ↔ Accounts messages).
// GET  ?badge=1                      → { n, open } not read yet by this login
// GET  [?booking=ID][&f=all|open|mine] → the conversation (newest last), and marks it read
// POST {action:'post', to, body, bookingId?, receiptId?, needsAction?} | {action:'done', id} | {action:'reopen', id}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const T = require('../lib/team');
const { route, fail, str, intOr } = require('../lib/http');

const see = (u) => has(u, 'ledger.view') || has(u, 'accounts.view') || has(u, 'receipt.enter');

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!see(u)) throw fail(403, 'Your role does not see CRM and Accounts messages.');
    const q = req.query || {};
    if (q.badge) return res.json(await T.unread(u));
    // The chat window: the latest messages (?recent=1), or only those after the last one it has (?after=ID). Not marked read here.
    if (q.recent || q.after != null) {
      const after = intOr(q.after) || 0;
      const rows = await db.q(`select m.id, m.to_team, m.body, m.kind, m.needs_action, m.done_at, m.created_at, m.booking_id, m.from_user,
          s.name as from_name, un.unit_no
        from team_messages m left join users s on s.id = m.from_user left join bookings b on b.id = m.booking_id left join units un on un.id = b.unit_id
        where (m.booking_id is null or un.project_id = any($1)) and m.id > $2 order by m.id desc limit ${q.recent ? 60 : 100}`, [u.projects, after]);
      return res.json({ rows: rows.reverse(), unread: await T.unread(u), team: T.teamOf(u), me: u.id });
    }
    const t = T.teamOf(u), bk = intOr(q.booking);
    const f = ['all', 'open', 'mine'].includes(q.f) ? q.f : 'all';
    const where = ['(m.booking_id is null or un.project_id = any($1))'];
    const args = [u.projects];
    if (bk) { args.push(bk); where.push(`m.booking_id = $${args.length}`); }
    if (f === 'open') where.push('m.needs_action and m.done_at is null');
    if (f === 'mine' && t !== 'both') { args.push(t); where.push(`m.to_team = $${args.length}`); }
    const rows = await db.q(`select m.id, m.to_team, m.body, m.kind, m.needs_action, m.done_at, m.created_at, m.booking_id, m.receipt_id,
        s.name as from_name, s.role as from_role, d.name as done_name, un.unit_no
      from team_messages m left join users s on s.id = m.from_user left join users d on d.id = m.done_by
      left join bookings b on b.id = m.booking_id left join units un on un.id = b.unit_id
      where ${where.join(' and ')} order by m.id desc limit 300`, args);
    const open = await db.one(`select count(*) filter (where to_team = 'crm')::int as crm, count(*) filter (where to_team = 'accounts')::int as accounts
      from team_messages where needs_action and done_at is null`);
    const flat = bk ? await db.one('select b.id, u.unit_no from bookings b join units u on u.id = b.unit_id where b.id = $1', [bk]) : null;
    await T.markRead(u);
    return res.json({ rows: rows.reverse(), team: t, open, flat, me: u.id });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!see(u)) throw fail(403, 'Your role does not see CRM and Accounts messages.');
    if (b.action === 'read') { await T.markRead(u); return res.json({ ok: true }); }
    // Admin / Management: a message from the ERP itself, to hear the incoming chime on one's own screen.
    if (b.action === 'test') {
      if (!(has(u, 'users.manage') || has(u, 'mgmt.view'))) throw fail(403, 'Only the Admin can send a test message.');
      const id = await T.post({ to: 'crm', body: `Test message for ${u.name}: if you heard a chime, the Dream Chat sound is working.`, kind: 'system' });
      return res.json({ ok: true, id });
    }
    if (b.action === 'post') {
      const body = str(b.body, 4000); if (!body) throw fail(400, 'Write the message.');
      const t = T.teamOf(u);
      const to = ['crm', 'accounts'].includes(b.to) ? b.to : t === 'both' ? null : T.other(t);
      if (!to) throw fail(400, 'Choose who it is for: CRM or Accounts.');
      let bookingId = null, receiptId = intOr(b.receiptId) || null;
      if (receiptId) { const r = await db.one('select booking_id, project_id from receipts where id = $1', [receiptId]); if (!r || !u.projects.includes(r.project_id)) throw fail(404, 'That receipt is not there.'); bookingId = r.booking_id; }
      if (b.bookingId) { const k = await db.one('select b.id, u.project_id from bookings b join units u on u.id = b.unit_id where b.id = $1', [intOr(b.bookingId)]); if (!k || !u.projects.includes(k.project_id)) throw fail(404, 'That flat is not there.'); bookingId = k.id; }
      if (b.unit && !bookingId) {
        const k = await db.one("select b.id from bookings b join units u on u.id = b.unit_id where upper(u.unit_no) = upper($1) and u.project_id = any($2) and b.status in ('active', 'pending') order by b.id desc limit 1", [str(b.unit, 20), u.projects]);
        if (!k) throw fail(400, `No live booking for flat ${b.unit}.`); bookingId = k.id;
      }
      const id = await T.post({ to, body, userId: u.id, bookingId, receiptId, needsAction: !!b.needsAction });
      await audit.record(db.q, { user: u, action: 'message', entity: 'team', entityId: id, after: { to, bookingId, needsAction: !!b.needsAction } });
      return res.json({ ok: true, id });
    }
    if (b.action === 'done' || b.action === 'reopen') {
      const m = await db.one('select id, to_team, from_user from team_messages where id = $1', [intOr(b.id)]); if (!m) throw fail(404, 'That message is not there.');
      const t = T.teamOf(u);
      if (t !== 'both' && t !== m.to_team && m.from_user !== u.id) throw fail(403, 'Only the team it was sent to can mark it done.');
      await db.q(b.action === 'done' ? 'update team_messages set done_at = now(), done_by = $2 where id = $1' : 'update team_messages set done_at = null, done_by = null where id = $1', b.action === 'done' ? [m.id, u.id] : [m.id]);
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
