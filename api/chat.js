// Dream Chat for the whole company (the phone app at /chat, and the ERP's chat). See lib/chat.js for the rules.
// GET  ?me=1                    → who is signed in, the notification key, whether the smart extras are on
//      ?rooms=1                 → the chat list (marks everything delivered)
//      ?room=ID[&before=MSG]    → a page of messages (50), newest last
//      ?poll=1&room=ID&after=MSG&since=ISO → new and changed messages, read ticks, and the chat list's stamp
//      ?people=1 | ?info=ROOM | ?receipts=MSG | ?search=TEXT[&room=ID] | ?saved=1 | ?file=ID[&dl=1]
//      ?flat=A-1203             → that flat's summary, for the person asking only (never posted in a chat)
//      ?catchup=ROOM            → a short summary of what this login has not read there
//      ?review=1 | ?review=ROOM → Admin only, every look is in the audit log: all chats, or one chat in full
// POST {action: login | logout | send | edit | delete | react | star | pin | forward | read | vote | group | dm |
//       add | remove | admin | rename | about | leave | pref | status | push | unpush | card}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const C = require('../lib/chat');
const AI = require('../lib/chat-ai');
const { route, fail, str, intOr } = require('../lib/http');

const PAGE = 50;
const SYS = 'Dream India ERP';
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(webm|ogg|mp4|mpeg|aac|x-m4a|wav)|application\/pdf)$/;
const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/(mp4|webm|quicktime|3gpp)|audio\/(webm|ogg|mp4|mpeg|aac|x-m4a|wav|3gpp)|application\/(pdf|zip|x-zip-compressed|msword|vnd\.[\w.+-]+|octet-stream|acad|x-dwg|dxf)|text\/(plain|csv)|image\/vnd\.dwg)$/;
const kindOf = (mime, voice) => (voice && /^audio\//.test(mime) ? 'voice' : /^image\/(jpeg|png|webp|gif)$/.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'voice' : 'file');
// int[] columns come back as Postgres text ('{3,5}')
const intList = (v) => (Array.isArray(v) ? v : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));
const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => intOr(x)).filter((x) => x > 0))].slice(0, 500);

// ---------- reading messages ----------
const MSG_SQL = `select m.id, m.room_id, m.user_id, m.kind, m.body, m.forwarded, m.mentions, m.mention_all, m.card, m.created_at, m.edited_at, m.deleted_at, m.reply_to,
    s.name as user_name, f.id as f_id, f.name as f_name, f.mime as f_mime, f.size as f_size, f.width as f_w, f.height as f_h, f.seconds as f_sec, f.transcript as f_text,
    r.id as r_id, r.kind as r_kind, r.body as r_body, r.deleted_at as r_deleted, rs.name as r_name,
    (select coalesce(json_agg(json_build_object('e', x.emoji, 'u', x.user_id)), '[]') from chat_reactions x where x.message_id = m.id) as reactions,
    exists (select 1 from chat_stars st where st.message_id = m.id and st.user_id = $1) as starred,
    exists (select 1 from chat_pins p where p.message_id = m.id) as pinned,
    case when m.kind = 'poll' then (select coalesce(json_agg(json_build_object('o', v.opt, 'u', v.user_id)), '[]') from chat_votes v where v.message_id = m.id) end as votes
  from chat_messages m left join users s on s.id = m.user_id left join chat_files f on f.id = m.file_id
  left join chat_messages r on r.id = m.reply_to left join users rs on rs.id = r.user_id`;

function shape(m, meId, review = false) {
  const gone = !!m.deleted_at && !review;
  const reacts = {};
  for (const r of m.reactions || []) { reacts[r.e] = reacts[r.e] || { e: r.e, n: 0, mine: false }; reacts[r.e].n++; if (r.u === meId) reacts[r.e].mine = true; }
  let poll = null;
  if (m.kind === 'poll' && m.card) {
    const counts = (m.card.options || []).map(() => 0), mine = [];
    for (const v of m.votes || []) { if (counts[v.o] != null) counts[v.o]++; if (v.u === meId) mine.push(v.o); }
    poll = { q: m.card.question, options: m.card.options, multi: !!m.card.multi, counts, mine, voters: new Set((m.votes || []).map((v) => v.u)).size };
  }
  return {
    id: m.id, room: m.room_id, user: m.user_id, name: m.user_id ? m.user_name : SYS, kind: gone ? 'deleted' : m.kind,
    body: gone ? '' : m.body, at: m.created_at, edited: !!m.edited_at, deleted: !!m.deleted_at, fwd: m.forwarded,
    mentions: intList(m.mentions), all: m.mention_all,
    file: !gone && m.f_id ? { id: m.f_id, name: m.f_name, mime: m.f_mime, size: m.f_size, w: m.f_w, h: m.f_h, sec: m.f_sec == null ? null : Number(m.f_sec), text: m.f_text } : null,
    reply: m.r_id ? { id: m.r_id, name: m.r_name || SYS, kind: m.r_deleted ? 'deleted' : m.r_kind, body: m.r_deleted ? '' : String(m.r_body || '').slice(0, 160) } : null,
    card: !gone && m.kind !== 'poll' ? m.card : null, poll: gone ? null : poll,
    reactions: Object.values(reacts), starred: m.starred, pinned: m.pinned,
  };
}

// Read ticks: the lowest point every other person in the chat has reached (one person in a one-to-one chat).
async function marks(roomId, meId) {
  const r = await db.one(`select coalesce(min(m.last_read), 0)::int as read, coalesce(min(m.last_delivered), 0)::int as delivered, count(*)::int as n
    from chat_members m join users u on u.id = m.user_id where m.room_id = $1 and m.user_id <> $2 and not u.disabled`, [roomId, meId]);
  return r.n ? r : { read: 0, delivered: 0, n: 0 };
}

async function roomList(u) {
  await db.q('update chat_members m set last_delivered = r.last_msg_id from chat_rooms r where r.id = m.room_id and m.user_id = $1 and m.last_delivered < r.last_msg_id', [u.id]);
  const rows = await db.q(`select r.id, r.kind, r.name, r.about, r.auto_key, r.archived, r.last_at, m.role, m.pinned, m.hidden, m.muted_until, m.last_read,
      (select count(*)::int from chat_members x where x.room_id = r.id) as members,
      (select count(*)::int from chat_messages x where x.room_id = r.id and x.id > m.last_read and x.thread_root is null and x.deleted_at is null and (x.user_id is null or x.user_id <> $1)) as unread,
      (select count(*)::int from chat_messages x where x.room_id = r.id and x.id > m.last_read and x.deleted_at is null and (x.mention_all or $1 = any(x.mentions)) and x.user_id <> $1) as mentioned,
      o.id as o_id, o.name as o_name, o.role as o_role, o.chat_status as o_status, o.chat_status_until as o_until, o.chat_seen as o_seen, o.disabled as o_off,
      l.id as l_id, l.kind as l_kind, l.body as l_body, l.user_id as l_user, l.deleted_at as l_del, l.card as l_card, ls.name as l_name
    from chat_members m join chat_rooms r on r.id = m.room_id
    left join lateral (select uu.* from chat_members om join users uu on uu.id = om.user_id where r.kind = 'dm' and om.room_id = r.id and om.user_id <> $1 limit 1) o on true
    left join chat_messages l on l.id = r.last_msg_id left join users ls on ls.id = l.user_id
    where m.user_id = $1 order by m.pinned desc, r.last_at desc`, [u.id]);
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id, kind: r.kind, name: r.kind === 'dm' ? r.o_name || 'Former staff' : r.name, about: r.about, dept: !!r.auto_key, archived: r.archived,
    role: r.role, pinned: r.pinned, hidden: r.hidden, muted: !!(r.muted_until && Date.parse(r.muted_until) > now), members: r.members,
    unread: r.unread, mentioned: r.mentioned, at: r.last_at, canPost: C.canPost({ ...r, kind: r.kind }, u) && !r.o_off,
    other: r.kind === 'dm' && r.o_id ? { id: r.o_id, status: statusOf(r.o_status, r.o_until), seen: r.o_seen, off: r.o_off } : null,
    last: r.l_id ? { id: r.l_id, mine: r.l_user === u.id, name: r.l_user ? r.l_name : SYS, text: r.l_del ? 'This message was deleted' : C.preview(r.l_kind === 'poll' ? 'text' : r.l_kind, r.l_kind === 'poll' ? '📊 ' + ((r.l_card || {}).question || 'Poll') : r.l_body, r.l_kind === 'card' ? r.l_card : null) } : null,
  }));
}
const statusOf = (s, until) => (s && (!until || Date.parse(until) > Date.now()) ? s : null);

async function needMember(u, roomId) {
  const m = await C.member(u, intOr(roomId));
  if (!m) throw fail(404, 'You are not in that chat.');
  return m;
}
async function needMsg(u, id) {
  const m = await db.one('select * from chat_messages where id = $1', [intOr(id)]);
  if (!m) throw fail(404, 'That message is not there.');
  const mem = await needMember(u, m.room_id);
  return { m, mem };
}
const touch = (id) => db.q('update chat_messages set touched_at = now() where id = $1', [id]);

// ---------- a flat's summary (/flat A-1203), for the person asking only ----------
async function flatCard(u, unit) {
  if (!has(u, 'inventory.view') && !has(u, 'ledger.view')) throw fail(403, 'Your login does not see flats.');
  const rows = await db.q(`select un.id, un.unit_no, un.typology, un.carpet_sqft, un.status, bl.name as building, p.name as project,
      b.id as booking_id, b.status as b_status, b.booking_date, b.agreement_value,
      (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers
    from units un join buildings bl on bl.id = un.building_id join projects p on p.id = un.project_id
    left join lateral (select * from bookings k where k.unit_id = un.id and k.status in ('active', 'pending') order by k.id desc limit 1) b on true
    where upper(un.unit_no) = upper($1) and un.project_id = any($2) order by p.id limit 3`, [unit, u.projects]);
  if (!rows.length) throw fail(404, `No flat ${unit} in your projects.`);
  const out = [];
  for (const r of rows) {
    const c = { title: `Flat ${r.unit_no} · ${r.building} · ${r.project}`, lines: [[r.typology, r.carpet_sqft ? `${Number(r.carpet_sqft)} sq ft carpet` : null].filter(Boolean).join(', ') || null] };
    if (!r.booking_id) c.lines.push(`Not booked (${r.status || 'available'})`);
    else {
      c.lines.push(`${r.b_status === 'pending' ? 'Booking waiting for approval' : 'Booked'} on ${String(r.booking_date).slice(0, 10)}${r.buyers ? ' · ' + r.buyers : ''}`);
      if (has(u, 'ledger.view')) {
        const bb = await db.one('select * from booking_balances where booking_id = $1', [r.booking_id]).catch(() => null);
        const inr = (v) => '₹' + Math.round(+v || 0).toLocaleString('en-IN');
        c.lines.push(`Agreement value ${inr(r.agreement_value)}`);
        if (bb) { c.lines.push(`Demanded ${inr(bb.demanded)} · Received ${inr(bb.credit_av)}`); c.lines.push(+bb.overdue > 0 ? `Overdue ${inr(bb.overdue)}` : `Outstanding ${inr(bb.outstanding)}`); c.tone = +bb.overdue > 0 ? 'warn' : 'ok'; }
        c.link = { label: 'Open in ERP', href: `/#/booking/${r.booking_id}` };
      }
    }
    c.lines = c.lines.filter(Boolean);
    out.push(c);
  }
  return out;
}

module.exports = route({
  GET: async (req, res) => {
    const q = req.query || {};
    if (q.vapid) return res.json({ key: await require('../lib/webpush').publicKey() });
    const u = await auth.chatGuard(req, res); if (!u) return;
    await C.sync().catch((e) => console.error('chat sync', e.message));
    if (!u._seen) db.q("update users set chat_seen = now() where id = $1 and (chat_seen is null or chat_seen < now() - interval '45 seconds')", [u.id]).catch(() => {});

    if (q.me) {
      const row = await db.one('select chat_status, chat_status_until, chat_dnd, designation from users where id = $1', [u.id]);
      return res.json({ me: { id: u.id, name: u.name, role: u.role, designation: row.designation, boss: C.isBoss(u), admin: u.role === 'admin', status: statusOf(row.chat_status, row.chat_status_until), dnd: row.chat_dnd, flats: has(u, 'inventory.view') || has(u, 'ledger.view'), desk: has(u, 'ledger.view') || has(u, 'accounts.view') || has(u, 'receipt.enter') }, ai: AI.configured(), vapid: await require('../lib/webpush').publicKey() });
    }
    if (q.rooms) {
      const rooms = await roomList(u);
      return res.json({ rooms, stamp: rooms.reduce((a, r) => (r.at > a ? r.at : a), '') });
    }
    if (q.people) {
      const rows = await C.people(u);
      return res.json({ people: rows.map((p) => ({ id: p.id, name: p.name, role: require('../lib/roles').ROLES[p.role]?.label || p.role, dept: C.deptOf(p.role), designation: p.designation, status: statusOf(p.chat_status, p.chat_status_until), seen: p.chat_seen })) });
    }
    if (q.room && !q.poll) {
      const mem = await needMember(u, q.room);
      const before = intOr(q.before);
      const rows = await db.q(`${MSG_SQL} where m.room_id = $2 and m.thread_root is null ${before ? 'and m.id < $3' : ''} order by m.id desc limit ${PAGE}`, before ? [u.id, mem.room_id, before] : [u.id, mem.room_id]);
      const list = (await roomList(u)).find((r) => r.id === mem.room_id);
      const pins = await db.q(`select p.message_id as id, m.body, m.kind, s.name from chat_pins p join chat_messages m on m.id = p.message_id left join users s on s.id = m.user_id where p.room_id = $1 and m.deleted_at is null order by p.at desc limit 5`, [mem.room_id]);
      return res.json({ room: list, msgs: rows.reverse().map((m) => shape(m, u.id)), more: rows.length === PAGE, marks: await marks(mem.room_id, u.id), lastRead: mem.last_read, pins: pins.map((p) => ({ id: p.id, name: p.name || SYS, text: C.preview(p.kind, p.body) })), now: new Date().toISOString() });
    }
    if (q.poll) {
      const now = new Date().toISOString();
      const out = { now };
      if (q.room) {
        const mem = await needMember(u, q.room);
        const after = intOr(q.after) || 0, since = q.since && !isNaN(Date.parse(q.since)) ? q.since : now;
        const rows = await db.q(`${MSG_SQL} where m.room_id = $2 and m.thread_root is null and (m.id > $3 or (m.touched_at > $4 and m.id <= $3)) order by m.id limit 200`, [u.id, mem.room_id, after, since]);
        out.msgs = rows.map((m) => shape(m, u.id));
        out.marks = await marks(mem.room_id, u.id);
        const pins = await db.q(`select p.message_id as id, m.body, m.kind, s.name from chat_pins p join chat_messages m on m.id = p.message_id left join users s on s.id = m.user_id where p.room_id = $1 and m.deleted_at is null order by p.at desc limit 5`, [mem.room_id]);
        out.pins = pins.map((p) => ({ id: p.id, name: p.name || SYS, text: C.preview(p.kind, p.body) }));
      }
      const t = await db.one(`select coalesce(max(r.last_at), 'epoch')::text as stamp, coalesce(sum((select count(*) from chat_messages x where x.room_id = r.id and x.id > m.last_read and x.thread_root is null and x.deleted_at is null and x.user_id is distinct from $1)), 0)::int as unread
        from chat_members m join chat_rooms r on r.id = m.room_id where m.user_id = $1 and (m.muted_until is null or m.muted_until < now())`, [u.id]);
      out.stamp = t.stamp; out.unread = t.unread;
      return res.json(out);
    }
    if (q.info) {
      const mem = await needMember(u, q.info);
      const room = await db.one('select id, kind, name, about, auto_key, created_at from chat_rooms where id = $1', [mem.room_id]);
      const members = await db.q(`select u.id, u.name, u.role, u.designation, u.chat_status, u.chat_status_until, u.chat_seen, m.role as chat_role, m.auto from chat_members m join users u on u.id = m.user_id
        where m.room_id = $1 and not u.disabled order by (m.role = 'admin') desc, u.name`, [mem.room_id]);
      const files = await db.q(`select m.id, m.kind, m.created_at, f.id as file_id, f.name, f.mime, f.size, s.name as by from chat_messages m join chat_files f on f.id = m.file_id left join users s on s.id = m.user_id
        where m.room_id = $1 and m.deleted_at is null order by m.id desc limit 200`, [mem.room_id]);
      const { ROLES } = require('../lib/roles');
      return res.json({ room: { ...room, dept: !!room.auto_key }, me: { role: mem.role, manage: C.canManage(mem, u) },
        members: members.map((x) => ({ id: x.id, name: x.name, role: ROLES[x.role]?.label || x.role, designation: x.designation, admin: x.chat_role === 'admin', auto: x.auto, status: statusOf(x.chat_status, x.chat_status_until), seen: x.chat_seen })),
        media: files.filter((f) => f.kind === 'image' || f.kind === 'video'), docs: files.filter((f) => f.kind === 'file'), voice: files.filter((f) => f.kind === 'voice').length });
    }
    if (q.receipts) {
      const { m } = await needMsg(u, q.receipts);
      if (m.user_id !== u.id) throw fail(403, 'Only for your own messages.');
      const rows = await db.q(`select u.name, x.last_read >= $2 as read, x.last_delivered >= $2 as delivered from chat_members x join users u on u.id = x.user_id
        where x.room_id = $1 and x.user_id <> $3 and not u.disabled order by u.name`, [m.room_id, m.id, u.id]);
      return res.json({ read: rows.filter((r) => r.read).map((r) => r.name), delivered: rows.filter((r) => !r.read && r.delivered).map((r) => r.name), waiting: rows.filter((r) => !r.delivered).map((r) => r.name) });
    }
    if (q.search != null) {
      const t = str(q.search, 100); if (t.length < 2) return res.json({ rows: [] });
      const room = intOr(q.room);
      const rows = await db.q(`${MSG_SQL} join chat_members me on me.room_id = m.room_id and me.user_id = $1
        where m.deleted_at is null and m.thread_root is null and (m.body ilike $2 or f.name ilike $2 or f.transcript ilike $2) ${room ? 'and m.room_id = $3' : ''} order by m.id desc limit 60`,
        room ? [u.id, `%${t.replace(/[%_\\]/g, '\\$&')}%`, room] : [u.id, `%${t.replace(/[%_\\]/g, '\\$&')}%`]);
      const names = new Map((await roomList(u)).map((r) => [r.id, r.name]));
      return res.json({ rows: rows.map((m) => ({ ...shape(m, u.id), roomName: names.get(m.room_id) })) });
    }
    if (q.saved) {
      const rows = await db.q(`${MSG_SQL} join chat_stars st2 on st2.message_id = m.id and st2.user_id = $1 join chat_members me on me.room_id = m.room_id and me.user_id = $1 where m.deleted_at is null order by st2.at desc limit 200`, [u.id]);
      const names = new Map((await roomList(u)).map((r) => [r.id, r.name]));
      return res.json({ rows: rows.map((m) => ({ ...shape(m, u.id), roomName: names.get(m.room_id) })) });
    }
    if (q.file) {
      // a file may have been forwarded: anyone in a chat where it was sent may open it
      const f = await db.one(`select f.id, f.name, f.mime, f.size, f.data from chat_files f where f.id = $1 and (
          exists (select 1 from chat_messages m join chat_members x on x.room_id = m.room_id where m.file_id = f.id and m.deleted_at is null and x.user_id = $2)
          or (f.user_id = $2 and not exists (select 1 from chat_messages m where m.file_id = f.id)))`, [intOr(q.file), u.id]);
      if (!f) return res.status(404).json({ error: 'That file is not there, or not in your chats.' });
      const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
      const inline = INLINE.test(f.mime) && !q.dl;
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${String(f.name).replace(/[^\w.\- ]+/g, '_')}"`);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // iPhones play audio and video only in pieces (Range requests)
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let a = m[1] ? +m[1] : buf.length - +m[2], b = m[1] && m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
        if (a < 0) a = 0;
        if (a >= buf.length || a > b) { res.setHeader('Content-Range', `bytes */${buf.length}`); return res.status(416).end(); }
        res.setHeader('Content-Range', `bytes ${a}-${b}/${buf.length}`); res.setHeader('Content-Length', String(b - a + 1));
        res.statusCode = 206; return res.end(buf.subarray(a, b + 1));
      }
      res.setHeader('Content-Length', String(buf.length));
      return res.end(buf);
    }
    if (q.flat) return res.json({ cards: await flatCard(u, str(q.flat, 20)) });
    if (q.catchup) {
      const mem = await needMember(u, q.catchup);
      if (!AI.configured()) throw fail(400, 'Catch me up is not switched on yet (it needs the Claude key in Vercel).');
      const rows = await db.q(`select m.kind, m.body, m.created_at, coalesce(s.name, $3) as name, f.name as fname, f.transcript from chat_messages m left join users s on s.id = m.user_id left join chat_files f on f.id = m.file_id
        where m.room_id = $1 and m.id > $2 and m.deleted_at is null and m.thread_root is null order by m.id desc limit 300`, [mem.room_id, mem.last_read, SYS]);
      const all = rows.length < 5 ? await db.q(`select m.kind, m.body, m.created_at, coalesce(s.name, $2) as name, f.name as fname, f.transcript from chat_messages m left join users s on s.id = m.user_id left join chat_files f on f.id = m.file_id
        where m.room_id = $1 and m.deleted_at is null and m.thread_root is null and m.created_at > now() - interval '3 days' order by m.id desc limit 120`, [mem.room_id, SYS]) : rows;
      if (!all.length) return res.json({ summary: 'Nothing new here.', count: 0 });
      const lines = all.reverse().map((m) => `${new Date(Date.parse(m.created_at) + 5.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} ${m.name}: ${m.kind === 'voice' ? '[voice note] ' + (m.transcript || '') : m.kind === 'file' || m.kind === 'image' || m.kind === 'video' ? `[${m.kind} ${m.fname || ''}] ${m.body}` : m.body}`);
      return res.json({ summary: await AI.catchUp(mem.name || 'a chat', lines), count: rows.length, fromRecent: rows.length < 5 });
    }
    if (q.review) {
      if (u.role !== 'admin') throw fail(403, 'Only the Admin can review chats.');
      if (q.review === '1') {
        const rooms = await db.q(`select r.id, r.kind, r.name, r.last_at, (select string_agg(u.name, ', ' order by u.name) from chat_members m join users u on u.id = m.user_id where m.room_id = r.id) as people,
          (select count(*)::int from chat_messages x where x.room_id = r.id) as msgs from chat_rooms r order by r.last_at desc limit 500`);
        return res.json({ rooms });
      }
      const room = await db.one('select id, kind, name from chat_rooms where id = $1', [intOr(q.review)]);
      if (!room) throw fail(404, 'No such chat.');
      await audit.record(db.q, { user: u, action: 'review', entity: 'chat', entityId: room.id, note: `Admin opened the chat "${room.name || 'one-to-one'}" for review` });
      const rows = await db.q(`${MSG_SQL} where m.room_id = $2 order by m.id desc limit 500`, [u.id, room.id]);
      return res.json({ room, msgs: rows.reverse().map((m) => shape(m, u.id, true)) });
    }
    throw fail(400, 'Unknown request.');
  },

  POST: async (req, res, b) => {
    const a = b.action;
    if (a === 'login') {
      const r = await auth.authenticate(b.username, b.password);
      if (r.error) throw fail(401, r.error);
      if (r.user.must_change) throw fail(403, 'Set a new password first: open the ERP once and sign in there, then come back.');
      await auth.issueChat(req, res, r.user);
      return res.json({ ok: true });
    }
    if (a === 'logout') {
      const u = await auth.chatSession(req);
      if (u && b.endpoint) await db.q('delete from chat_push where user_id = $1 and endpoint = $2', [u.id, str(b.endpoint, 1000)]);
      auth.clearChat(req, res);
      return res.json({ ok: true });
    }
    const u = await auth.chatGuard(req, res); if (!u) return;

    if (a === 'send') {
      const mem = await needMember(u, b.room);
      if (!C.canPost(mem, u)) throw fail(403, mem.kind === 'announce' ? 'Only Management posts in Announcements.' : 'You cannot write in this chat.');
      if (mem.kind === 'dm') {
        const o = await db.one('select u.disabled from chat_members m join users u on u.id = m.user_id where m.room_id = $1 and m.user_id <> $2', [mem.room_id, u.id]);
        if (o && o.disabled) throw fail(403, 'This person has left Dream India.');
      }
      let body = str(b.body, 8000), kind = 'text', fileId = null, card = null;
      if (b.poll) {
        const question = str(b.poll.question, 300), options = (Array.isArray(b.poll.options) ? b.poll.options : []).map((o) => str(o, 100)).filter(Boolean).slice(0, 10);
        if (!question || options.length < 2) throw fail(400, 'A poll needs a question and at least two choices.');
        kind = 'poll'; body = question; card = { question, options, multi: !!b.poll.multi };
      } else if (b.file) {
        const f = b.file, mime = str(f.mime, 100).toLowerCase() || 'application/octet-stream';
        if (!ALLOWED.test(mime)) throw fail(400, 'That kind of file cannot be sent. Send photos, videos, voice notes, PDFs, Word, Excel, drawings or zip files.');
        const buf = Buffer.from(String(f.data || ''), 'base64');
        if (!buf.length) throw fail(400, 'The file is empty.');
        if (buf.length > C.MAX_FILE) throw fail(413, 'Files can be up to 3 MB. For a longer video, send a shorter clip.');
        kind = kindOf(mime, !!f.voice);
        const transcript = kind === 'voice' && f.said ? await AI.voiceToEnglish(str(f.said, 4000)) : null;
        const row = await db.one(`insert into chat_files (room_id, user_id, name, mime, size, data, width, height, seconds, transcript) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [mem.room_id, u.id, str(f.name, 150) || (kind === 'voice' ? 'Voice note' : 'file'), mime, buf.length, buf, intOr(f.w), intOr(f.h), f.sec != null && isFinite(+f.sec) ? Math.min(+f.sec, 99999) : null, transcript]);
        fileId = row.id;
      } else if (!body) throw fail(400, 'Write the message.');
      let replyTo = intOr(b.replyTo);
      if (replyTo && !(await db.one('select 1 as x from chat_messages where id = $1 and room_id = $2', [replyTo, mem.room_id]))) replyTo = null;
      const inRoom = new Set((await db.q('select user_id from chat_members where room_id = $1', [mem.room_id])).map((r) => r.user_id));
      const mentions = ids(b.mentions).filter((x) => inRoom.has(x) && x !== u.id);
      const mentionAll = !!b.mentionAll && (C.canManage(mem, u) || C.isBoss(u) || mem.kind === 'group');
      const id = await C.post({ roomId: mem.room_id, user: u, kind, body, fileId, replyTo, mentions, mentionAll, card });
      const rows = await db.q(`${MSG_SQL} where m.id = $2`, [u.id, id]);
      return res.json({ ok: true, msg: shape(rows[0], u.id) });
    }
    if (a === 'edit') {
      const { m } = await needMsg(u, b.id);
      if (m.user_id !== u.id || m.kind !== 'text' || m.deleted_at) throw fail(403, 'You can only edit your own text messages.');
      if (Date.now() - Date.parse(m.created_at) > C.EDIT_MIN * 60e3) throw fail(403, `Messages can be edited for ${C.EDIT_MIN} minutes after sending.`);
      const body = str(b.body, 8000); if (!body) throw fail(400, 'Write the message.');
      await audit.record(db.q, { user: u, action: 'edit', entity: 'chat', entityId: m.id, before: { body: m.body }, after: { body } });
      await db.q('update chat_messages set body = $2, edited_at = now(), touched_at = now() where id = $1', [m.id, body]);
      return res.json({ ok: true });
    }
    if (a === 'delete') {
      const { m, mem } = await needMsg(u, b.id);
      if (m.deleted_at) return res.json({ ok: true });
      const own = m.user_id === u.id;
      if (!(own && Date.now() - Date.parse(m.created_at) <= C.DELETE_MIN * 60e3) && !C.canManage(mem, u)) throw fail(403, own ? 'Messages can be deleted for everyone within 2 hours of sending.' : 'You can only delete your own messages.');
      // kept for the Admin's review, hidden from everyone else
      await audit.record(db.q, { user: u, action: 'delete', entity: 'chat', entityId: m.id, before: { body: m.body, by: m.user_id } });
      await db.q('update chat_messages set deleted_at = now(), deleted_by = $2, touched_at = now() where id = $1', [m.id, u.id]);
      await db.q('delete from chat_pins where message_id = $1', [m.id]);
      return res.json({ ok: true });
    }
    if (a === 'react') {
      const { m } = await needMsg(u, b.id);
      const e = str(b.emoji, 16);
      if (!e) await db.q('delete from chat_reactions where message_id = $1 and user_id = $2', [m.id, u.id]);
      else await db.q('insert into chat_reactions (message_id, user_id, emoji) values ($1, $2, $3) on conflict (message_id, user_id) do update set emoji = excluded.emoji, at = now()', [m.id, u.id, e]);
      await touch(m.id);
      return res.json({ ok: true });
    }
    if (a === 'star') {
      const { m } = await needMsg(u, b.id);
      if (b.on === false) await db.q('delete from chat_stars where user_id = $1 and message_id = $2', [u.id, m.id]);
      else await db.q('insert into chat_stars (user_id, message_id) values ($1, $2) on conflict do nothing', [u.id, m.id]);
      await touch(m.id);
      return res.json({ ok: true });
    }
    if (a === 'pin') {
      const { m, mem } = await needMsg(u, b.id);
      if (mem.kind !== 'dm' && mem.kind !== 'group' && !C.canManage(mem, u)) throw fail(403, 'Only the people who look after this group can pin.');
      if (b.on === false) await db.q('delete from chat_pins where room_id = $1 and message_id = $2', [m.room_id, m.id]);
      else {
        const n = await db.one('select count(*)::int as n from chat_pins where room_id = $1', [m.room_id]);
        if (n.n >= 5) throw fail(400, 'Up to 5 messages can be pinned. Unpin one first.');
        await db.q('insert into chat_pins (room_id, message_id, by_user) values ($1, $2, $3) on conflict do nothing', [m.room_id, m.id, u.id]);
      }
      await touch(m.id);
      return res.json({ ok: true });
    }
    if (a === 'forward') {
      const { m } = await needMsg(u, b.id);
      if (m.deleted_at || m.kind === 'system' || m.kind === 'card' || m.kind === 'poll') throw fail(400, 'This message cannot be forwarded.');
      const rooms = ids(b.rooms).slice(0, 10);
      if (!rooms.length) throw fail(400, 'Choose a chat to forward to.');
      let n = 0;
      for (const r of rooms) {
        const mem = await C.member(u, r);
        if (!mem || !C.canPost(mem, u)) continue;
        await C.post({ roomId: r, user: u, kind: m.kind, body: m.body, fileId: m.file_id, forwarded: true });
        n++;
      }
      return res.json({ ok: true, sent: n });
    }
    if (a === 'read') {
      const mem = await needMember(u, b.room);
      const upto = intOr(b.upto) || 0;
      await db.q('update chat_members set last_read = greatest(last_read, least($3, (select last_msg_id from chat_rooms where id = $1))), last_delivered = greatest(last_delivered, least($3, (select last_msg_id from chat_rooms where id = $1))) where room_id = $1 and user_id = $2', [mem.room_id, u.id, upto]);
      return res.json({ ok: true });
    }
    if (a === 'vote') {
      const { m } = await needMsg(u, b.id);
      if (m.kind !== 'poll' || !m.card || m.deleted_at) throw fail(400, 'That is not a poll.');
      const opt = intOr(b.opt);
      if (opt == null || opt < 0 || opt >= (m.card.options || []).length) throw fail(400, 'Choose one of the options.');
      const had = await db.one('select 1 as x from chat_votes where message_id = $1 and user_id = $2 and opt = $3', [m.id, u.id, opt]);
      if (had) await db.q('delete from chat_votes where message_id = $1 and user_id = $2 and opt = $3', [m.id, u.id, opt]);
      else {
        if (!m.card.multi) await db.q('delete from chat_votes where message_id = $1 and user_id = $2', [m.id, u.id]);
        await db.q('insert into chat_votes (message_id, user_id, opt) values ($1, $2, $3) on conflict do nothing', [m.id, u.id, opt]);
      }
      await touch(m.id);
      return res.json({ ok: true });
    }
    if (a === 'dm') {
      const other = intOr(b.user);
      if (!other || other === u.id) throw fail(400, 'Choose a person.');
      const allowed = (await C.people(u)).some((p) => p.id === other);
      if (!allowed) throw fail(404, 'That person is not there.');
      const key = `dm:${Math.min(u.id, other)}:${Math.max(u.id, other)}`;
      const room = await db.tx(async (t) => {
        let r = await t.one('select id from chat_rooms where dm_key = $1', [key]);
        if (!r) {
          r = await t.one("insert into chat_rooms (kind, dm_key, created_by) values ('dm', $1, $2) on conflict (dm_key) do update set dm_key = excluded.dm_key returning id", [key, u.id]);
          await t.q("insert into chat_members (room_id, user_id) values ($1, $2), ($1, $3) on conflict do nothing", [r.id, u.id, other]);
        }
        return r;
      });
      return res.json({ ok: true, room: room.id });
    }
    if (a === 'group') {
      if (C.isGuest(u)) throw fail(403, 'Guests cannot make groups.');
      const name = str(b.name, 60); if (!name) throw fail(400, 'Give the group a name.');
      const allowed = new Set((await C.people(u)).map((p) => p.id));
      const people = ids(b.members).filter((x) => allowed.has(x));
      if (!people.length) throw fail(400, 'Add at least one person.');
      const id = await db.tx(async (t) => {
        const r = await t.one("insert into chat_rooms (kind, name, about, created_by) values ('group', $1, $2, $3) returning id", [name, str(b.about, 300) || null, u.id]);
        await t.q("insert into chat_members (room_id, user_id, role) values ($1, $2, 'admin')", [r.id, u.id]);
        for (const p of people) await t.q("insert into chat_members (room_id, user_id) values ($1, $2) on conflict do nothing", [r.id, p]);
        return r.id;
      });
      await C.post({ roomId: id, kind: 'system', body: `${u.name} made the group "${name}"` });
      return res.json({ ok: true, room: id });
    }
    if (['add', 'remove', 'admin', 'rename', 'about'].includes(a)) {
      const mem = await needMember(u, b.room);
      if (mem.kind === 'dm') throw fail(400, 'This is a one-to-one chat.');
      if (!C.canManage(mem, u)) throw fail(403, 'Only the people who look after this group can do that.');
      if (a === 'rename' || a === 'about') {
        if (mem.auto_key && a === 'rename') throw fail(400, 'Department groups keep their department name.');
        const v = str(b.value, a === 'rename' ? 60 : 300); if (a === 'rename' && !v) throw fail(400, 'Give the group a name.');
        await db.q(`update chat_rooms set ${a === 'rename' ? 'name' : 'about'} = $2 where id = $1`, [mem.room_id, v || null]);
        if (a === 'rename') await C.post({ roomId: mem.room_id, kind: 'system', body: `${u.name} renamed the group to "${v}"` });
        return res.json({ ok: true });
      }
      const who = intOr(b.user);
      const person = await db.one('select id, name, role from users where id = $1 and not disabled', [who]);
      if (!person) throw fail(404, 'That person is not there.');
      if (a === 'add') {
        if (mem.kind === 'announce') throw fail(400, 'Everyone is in Announcements already.');
        if (!(await C.people(u)).some((p) => p.id === who)) throw fail(404, 'That person is not there.');
        const r = await db.q("insert into chat_members (room_id, user_id, last_read, last_delivered) select $1, $2, 0, 0 on conflict do nothing returning user_id", [mem.room_id, who]);
        if (r.length) await C.post({ roomId: mem.room_id, kind: 'system', body: `${u.name} added ${person.name}${C.isGuest(person) ? ' (guest)' : ''}` });
        return res.json({ ok: true });
      }
      const row = await db.one('select auto from chat_members where room_id = $1 and user_id = $2', [mem.room_id, who]);
      if (!row) throw fail(404, 'That person is not in this group.');
      if (a === 'remove') {
        if (row.auto) throw fail(400, `${person.name} is in this group because of their department. Change their role in Manage users instead.`);
        await db.q('delete from chat_members where room_id = $1 and user_id = $2', [mem.room_id, who]);
        await C.post({ roomId: mem.room_id, kind: 'system', body: `${u.name} removed ${person.name}` });
        return res.json({ ok: true });
      }
      await db.q('update chat_members set role = $3 where room_id = $1 and user_id = $2', [mem.room_id, who, b.on === false ? 'member' : 'admin']);
      return res.json({ ok: true });
    }
    if (a === 'leave') {
      const mem = await needMember(u, b.room);
      if (mem.kind !== 'group') throw fail(400, mem.kind === 'dm' ? 'Use "Hide chat" for a one-to-one chat.' : 'Department groups follow your department; you cannot leave them.');
      await db.q('delete from chat_members where room_id = $1 and user_id = $2', [mem.room_id, u.id]);
      const left = await db.q("select user_id, role from chat_members where room_id = $1", [mem.room_id]);
      if (left.length && !left.some((x) => x.role === 'admin')) await db.q("update chat_members set role = 'admin' where room_id = $1 and user_id = $2", [mem.room_id, left[0].user_id]);
      await C.post({ roomId: mem.room_id, kind: 'system', body: `${u.name} left` });
      return res.json({ ok: true });
    }
    if (a === 'pref') {
      const mem = await needMember(u, b.room);
      if (b.mute !== undefined) {
        const h = Number(b.mute);
        await db.q('update chat_members set muted_until = $3 where room_id = $1 and user_id = $2', [mem.room_id, u.id, h > 0 ? new Date(Date.now() + h * 3600e3).toISOString() : h < 0 ? '9999-12-31T00:00:00Z' : null]);
      }
      if (b.pinned !== undefined) await db.q('update chat_members set pinned = $3 where room_id = $1 and user_id = $2', [mem.room_id, u.id, !!b.pinned]);
      if (b.hidden !== undefined) await db.q('update chat_members set hidden = $3 where room_id = $1 and user_id = $2', [mem.room_id, u.id, !!b.hidden]);
      return res.json({ ok: true });
    }
    if (a === 'status') {
      const text = str(b.text, 60) || null, h = Number(b.hours) || 0;
      let dnd = b.dnd === null ? null : undefined;
      if (b.dnd && /^\d\d:\d\d$/.test(b.dnd.from) && /^\d\d:\d\d$/.test(b.dnd.to)) dnd = { from: b.dnd.from, to: b.dnd.to };
      if (b.text !== undefined) await db.q('update users set chat_status = $2, chat_status_until = $3 where id = $1', [u.id, text, text && h > 0 ? new Date(Date.now() + h * 3600e3).toISOString() : null]);
      if (dnd !== undefined) await db.q('update users set chat_dnd = $2 where id = $1', [u.id, dnd ? JSON.stringify(dnd) : null]);
      return res.json({ ok: true });
    }
    if (a === 'push') {
      const s = b.sub || {}, endpoint = str(s.endpoint, 1000), p256dh = str(s.keys && s.keys.p256dh, 200), au = str(s.keys && s.keys.auth, 100);
      if (!/^https:\/\//.test(endpoint) || !p256dh || !au) throw fail(400, 'This phone did not give a notification address.');
      await db.q(`insert into chat_push (user_id, endpoint, p256dh, auth, device) values ($1, $2, $3, $4, $5)
        on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, fails = 0`, [u.id, endpoint, p256dh, au, str(b.device, 120) || null]);
      return res.json({ ok: true });
    }
    if (a === 'unpush') {
      await db.q('delete from chat_push where user_id = $1 and endpoint = $2', [u.id, str(b.endpoint, 1000)]);
      return res.json({ ok: true });
    }
    if (a === 'testpush') {
      const r = await require('../lib/webpush').toUsers([u.id], { title: 'Dream Chat', body: 'Notifications are working on this phone.', tag: 'test', url: '/chat' });
      return res.json({ ok: true, ...r });
    }
    if (a === 'card') {
      // a button on an ERP message: a purchase request's one-tap approval page, only for the people who approve
      const { m } = await needMsg(u, b.id);
      const act = m.card && m.card.act;
      if (!act || act.type !== 'pr') throw fail(400, 'Nothing to do on this message.');
      const SA = require('../lib/staff-alerts');
      const me = await db.one('select username from users where id = $1', [u.id]);
      const approvers = await SA.approvers().catch(() => []);
      if (!approvers.some((p) => p.username === me.username)) throw fail(403, 'Only the approvers can approve purchase requests.');
      return res.json({ url: `/approve?t=${await SA.token(act.id, me.username)}` });
    }
    throw fail(400, 'Unknown action.');
  },
});
