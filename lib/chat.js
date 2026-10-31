// Dream Chat for the whole company: the rules behind api/chat.js.
//  - Kept simple, like WhatsApp: one-to-one chats, groups anyone can make, a group per department that the ERP keeps in
//    step with each login's role (only that team: Management is not put in the other teams' groups), and
//    Announcements, where only Management posts.
//    Replies quote the message (no threads).
//  - Consultants and the CA are guests: they only see the chats they are added to, and only the people in those.
//  - A switched-off login loses every chat at once (it can no longer sign in), and nothing ever leaves our database.
//  - Deleted messages are hidden from everyone but kept, so the Admin can still review a chat if there is a dispute.
const db = require('./db');

const DEPTS = {
  management: { name: 'Management', roles: ['admin', 'management'] },
  sales: { name: 'Sales', roles: ['sales', 'marketing', 'telecalling'] },
  crm: { name: 'CRM', roles: ['head_crm', 'crm'] },
  accounts: { name: 'Accounts', roles: ['head_accounts', 'accounts'] },
  site: { name: 'Site', roles: ['site_head', 'site_engineer', 'site_team'] },
  purchase: { name: 'Purchase', roles: ['purchase_team'] },
};
const BOSS = ['admin', 'management'];
// who looks after each group the ERP keeps (renames it, adds a guest, pins): the heads, and Management in theirs
const HEADS = ['admin', 'management', 'head_crm', 'head_accounts', 'site_head'];
const GUEST = ['ca', 'consultant'];
const isBoss = (u) => BOSS.includes(u.role);
const isGuest = (u) => GUEST.includes(u.role);
const deptOf = (role) => Object.keys(DEPTS).find((k) => DEPTS[k].roles.includes(role)) || null;

const EDIT_MIN = 15, DELETE_MIN = 120;
const MAX_FILE = 3 * 1024 * 1024;

// ---------- rooms the ERP keeps in step ----------
let lastSync = 0;
async function sync({ force = false } = {}) {
  if (!force && Date.now() - lastSync < 60e3) return;
  lastSync = Date.now();
  const users = await db.q('select id, role, all_projects from users where not disabled');
  const want = []; // [key, kind, name, about, memberIds]
  const staff = users.filter((u) => !GUEST.includes(u.role));
  want.push(['announce', 'announce', 'Announcements', 'News for everyone at Dream India. Only Management posts here.', staff.map((u) => u.id)]);
  for (const [k, d] of Object.entries(DEPTS)) {
    // only that department's own people: Management is not added to the other teams' groups (no micro-management)
    const ids = users.filter((u) => d.roles.includes(u.role)).map((u) => u.id);
    want.push([`dept:${k}`, 'channel', d.name, `The ${d.name} team.`, ids]);
  }
  const roleOf = new Map(users.map((u) => [u.id, u.role]));
  await db.tx(async (t) => {
    await t.q('select pg_advisory_xact_lock(7316043)');
    for (const [key, kind, name, about, ids] of want) {
      const room = await t.one(`insert into chat_rooms (kind, name, about, auto_key) values ($1, $2, $3, $4)
        on conflict (auto_key) do update set name = excluded.name, archived = false returning id`, [kind, name, about, key]);
      const have = await t.q('select user_id, auto from chat_members where room_id = $1', [room.id]);
      const in_ = new Set(have.map((h) => h.user_id)), wanted = new Set(ids);
      for (const id of ids) if (!in_.has(id)) await t.q("insert into chat_members (room_id, user_id, role, auto, last_read, last_delivered) select $1, $2, $3, true, last_msg_id, last_msg_id from chat_rooms where id = $1 on conflict do nothing", [room.id, id, HEADS.includes(roleOf.get(id)) ? 'admin' : 'member']);
      const drop = have.filter((h) => h.auto && !wanted.has(h.user_id)).map((h) => h.user_id);
      if (drop.length) await t.q('delete from chat_members where room_id = $1 and user_id = any($2)', [room.id, drop]);
    }
  });
}

// ---------- access ----------
async function member(u, roomId) {
  return db.one(`select m.*, r.kind, r.auto_key, r.name, r.archived from chat_members m join chat_rooms r on r.id = m.room_id
    where m.room_id = $1 and m.user_id = $2`, [roomId, u.id]);
}
const canPost = (m, u) => !m.archived && (m.kind !== 'announce' || m.role === 'admin' || isBoss(u));
const canManage = (m, u) => m.role === 'admin' || u.role === 'admin';

// People this login may start a chat with: everyone for staff; for guests, only people who share a chat with them.
async function people(u) {
  const rows = await db.q(`select id, name, role, designation, chat_status, chat_status_until, chat_seen from users where not disabled and id <> $1 order by name`, [u.id]);
  if (!isGuest(u)) return rows;
  const near = new Set((await db.q('select distinct b.user_id from chat_members a join chat_members b on b.room_id = a.room_id where a.user_id = $1', [u.id])).map((r) => r.user_id));
  return rows.filter((r) => near.has(r.id));
}

// ---------- sending ----------
// Posts a message and notifies the room (in the app, and on phones). Returns the message id.
async function post({ roomId, user = null, kind = 'text', body = '', fileId = null, replyTo = null, threadRoot = null, forwarded = false, mentions = [], mentionAll = false, card = null }) {
  const m = await db.tx(async (t) => {
    const row = await t.one(`insert into chat_messages (room_id, user_id, kind, body, file_id, reply_to, thread_root, forwarded, mentions, mention_all, card)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, created_at`,
      [roomId, user ? user.id : null, kind, String(body || '').slice(0, 8000), fileId, replyTo, threadRoot, !!forwarded, mentions, !!mentionAll, card ? JSON.stringify(card) : null]);
    if (!threadRoot) await t.q('update chat_rooms set last_msg_id = $2, last_at = $3 where id = $1', [roomId, row.id, row.created_at]);
    else await t.q('update chat_messages set touched_at = now() where id = $1', [threadRoot]);
    if (user) await t.q('update chat_members set last_read = greatest(last_read, $3), last_delivered = greatest(last_delivered, $3), hidden = false where room_id = $1 and user_id = $2', [roomId, user.id, threadRoot ? 0 : row.id]);
    await t.q('update chat_members set hidden = false where room_id = $1 and hidden', [roomId]);
    return row;
  });
  await notify({ roomId, msgId: m.id, user, kind, body, mentions, mentionAll, threadRoot, card }).catch((e) => console.error('chat push', e.message));
  return m.id;
}

const PREVIEW = { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice note', file: '📄 Document' };
const preview = (kind, body, card) => (card && card.title ? card.title : PREVIEW[kind] ? PREVIEW[kind] + (body ? ': ' + body : '') : String(body || '')).replace(/\s+/g, ' ').slice(0, 140);

// Do Not Disturb hours, in India time: {from: '22:00', to: '08:00'}.
function inDnd(dnd, now = Date.now()) {
  if (!dnd || !dnd.from || !dnd.to) return false;
  const ist = new Date(now + 5.5 * 3600e3), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const m = (s) => { const [h, mm] = String(s).split(':').map(Number); return h * 60 + (mm || 0); };
  const a = m(dnd.from), b = m(dnd.to);
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}

async function notify({ roomId, msgId, user, kind, body, mentions, mentionAll, threadRoot, card }) {
  const room = await db.one('select id, kind, name from chat_rooms where id = $1', [roomId]);
  let members = await db.q(`select m.user_id, m.muted_until, u.chat_dnd from chat_members m join users u on u.id = m.user_id
    where m.room_id = $1 and not u.disabled and ($2::int is null or m.user_id <> $2)`, [roomId, user ? user.id : null]);
  if (threadRoot) {
    // a thread reply: only the people in that thread (who wrote the first message or replied) and anyone named
    const inThread = new Set((await db.q('select distinct user_id from chat_messages where (id = $1 or thread_root = $1) and user_id is not null', [threadRoot])).map((r) => r.user_id));
    members = members.filter((x) => inThread.has(x.user_id) || mentions.includes(x.user_id));
  }
  const now = Date.now();
  const to = members.filter((x) => {
    const named = mentionAll || mentions.includes(x.user_id);
    if (inDnd(x.chat_dnd, now)) return false;
    if (x.muted_until && Date.parse(x.muted_until) > now && !named) return false;
    return true;
  }).map((x) => x.user_id);
  if (!to.length) return;
  const who = user ? user.name : 'Dream India ERP';
  const title = room.kind === 'dm' ? who : `${who} · ${room.name}`;
  await require('./webpush').toUsers(to, { title, body: (threadRoot ? '↳ ' : '') + preview(kind, body, card), room: roomId, msg: msgId, tag: `room-${roomId}`, url: `/chat#r${roomId}` }, { urgency: user ? 'high' : 'normal' });
}

// From the ERP itself into a department group ('dept:site', 'dept:accounts'). Never fails the job that posts it.
async function system(autoKey, body, card = null) {
  try {
    let r = await db.one('select id from chat_rooms where auto_key = $1', [autoKey]);
    if (!r) { await sync({ force: true }); r = await db.one('select id from chat_rooms where auto_key = $1', [autoKey]); }
    if (!r) return null;
    return await post({ roomId: r.id, kind: card ? 'card' : 'system', body, card });
  } catch (e) { console.error('chat system post', e.message); return null; }
}

module.exports = { DEPTS, BOSS, GUEST, isBoss, isGuest, deptOf, sync, member, canPost, canManage, people, post, system, preview, inDnd, EDIT_MIN, DELETE_MIN, MAX_FILE, _resetSync: () => { lastSync = 0; } };
