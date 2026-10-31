// DreamComm (company chat): end-to-end checks against a real, EMPTY Postgres database.
// DATABASE_URL=postgres://... node scripts/test-chat.js
const assert = require('assert/strict');
const crypto = require('crypto');
process.env.PORT = process.env.PORT || '3996';
require('./dev-server');
const db = require('../lib/db');
const webpush = require('../lib/webpush');
const chat = require('../lib/chat');
const BASE = `http://localhost:${process.env.PORT}`;

function client() {
  let cookie = '';
  const c = async (path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    if (headers.raw) return r;
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };
  c.cookie = () => cookie;
  return c;
}
let n = 0;
const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

// the phone's side of Web Push: its keys, and reading what the ERP sent
function phone() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: { endpoint: `https://push.example.test/${crypto.randomBytes(6).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    read(buf) {
      const salt = buf.subarray(0, 16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), body = buf.subarray(21 + idlen);
      const shared = ecdh.computeSecret(asPub);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(body.subarray(body.length - 16));
      const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
    },
  };
}

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Syed Rafi Ishaq', username: 'rafi', password: 'very-long-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const people = {};
  for (const [username, name, role] of [['sameer', 'Syed Sameer', 'management'], ['hcrm', 'Head CRM', 'head_crm'], ['neha', 'Neha CRM', 'crm'], ['asha', 'Asha Accounts', 'accounts'], ['ravi', 'Ravi Site', 'site_engineer'], ['dhanushri', 'Dhanushri MEP', 'consultant']]) {
    const r = await admin('/api/users', { action: 'create', name, username, role, projects: [sig.id] });
    assert.equal(r.ok, true, r.error);
    people[username] = { temp: r.tempPassword, pw: `${username}-own-password-1` };
  }
  const C = {};

  await step('Phone sign-in: a temporary password must be changed in the ERP first; then 30 days, chat only', async () => {
    const c = client();
    const r = await c('/api/chat', { action: 'login', username: 'neha', password: people.neha.temp }); assert.equal(r.status, 403);
    for (const u of Object.keys(people)) {
      const e = client();
      await e('/api/session', { action: 'login', username: u, password: people[u].temp });
      assert.equal((await e('/api/session', { action: 'password', current: people[u].temp, next: people[u].pw })).ok, true);
      C[u] = client();
      const l = await C[u]('/api/chat', { action: 'login', username: u, password: people[u].pw }); assert.equal(l.ok, true, l.error);
      assert.match(C[u].cookie(), /^erp_chat=/);
    }
    assert.equal((await C.neha('/api/masters')).status, 401); // the chat sign-in does not open the ERP
    assert.equal((await C.neha('/api/chat?me=1')).me.name, 'Neha CRM');
    assert.equal((await client()('/api/chat', { action: 'login', username: 'neha', password: 'wrong-password-x' })).status, 401);
    assert.equal((await admin('/api/chat?me=1')).me.admin, true); // the ERP sign-in opens DreamComm too
  });

  let rooms;
  await step('Department groups: each team only its own; Management only in Management; guests in none', async () => {
    chat._resetSync();
    const names = async (c) => (await c('/api/chat?rooms=1')).rooms.map((r) => r.name).sort();
    assert.deepEqual(await names(C.neha), ['Announcements', 'CRM']);
    assert.deepEqual(await names(C.hcrm), ['Announcements', 'CRM']);
    assert.deepEqual(await names(C.asha), ['Accounts', 'Announcements']);
    assert.deepEqual(await names(C.ravi), ['Announcements', 'Site']);
    assert.deepEqual(await names(C.sameer), ['Announcements', 'Management']);
    assert.deepEqual(await names(admin), ['Announcements', 'Management']);
    assert.deepEqual(await names(C.dhanushri), []);
    rooms = Object.fromEntries((await admin('/api/chat?rooms=1')).rooms.map((r) => [r.name, r]));
    const crm = (await C.neha('/api/chat?rooms=1')).rooms.find((r) => r.name === 'CRM');
    const info = await C.hcrm(`/api/chat?info=${crm.id}`);
    assert.equal(info.members.find((m) => m.name === 'Head CRM').admin, true); // the head looks after the group
    assert.equal(info.me.manage, true);
    assert.equal((await C.neha(`/api/chat?info=${rooms.Management.id}`)).status, 404);
  });

  await step('Announcements: only Management posts; everyone on staff gets it', async () => {
    const a = rooms.Announcements.id;
    assert.equal((await C.neha('/api/chat', { action: 'send', room: a, body: 'hi all' })).status, 403);
    assert.equal((await C.sameer('/api/chat', { action: 'send', room: a, body: 'Office closed Monday for Diwali' })).ok, true);
    const r = (await C.ravi('/api/chat?rooms=1')).rooms.find((x) => x.kind === 'announce');
    assert.equal(r.unread, 1); assert.equal(r.canPost, false); assert.match(r.last.text, /Diwali/);
  });

  let dm, m1;
  await step('One-to-one chat: one chat per pair, ticks go grey then blue as it is delivered and read', async () => {
    const people_ = (await C.neha('/api/chat?people=1')).people;
    const asha = people_.find((p) => p.name === 'Asha Accounts');
    assert.ok(!people_.some((p) => p.name === 'Neha CRM'));
    dm = (await C.neha('/api/chat', { action: 'dm', user: asha.id })).room;
    assert.equal((await C.neha('/api/chat', { action: 'dm', user: asha.id })).room, dm);
    const s = await C.neha('/api/chat', { action: 'send', room: dm, body: 'Has the A-1203 cheque cleared?' });
    m1 = s.msg.id;
    let p = await C.neha(`/api/chat?poll=1&room=${dm}&after=0`);
    assert.ok(p.marks.delivered < m1);
    const list = await C.asha('/api/chat?rooms=1'); // opening the app marks it delivered
    assert.equal(list.rooms.find((r) => r.id === dm).unread, 1);
    p = await C.neha(`/api/chat?poll=1&room=${dm}&after=0`);
    assert.ok(p.marks.delivered >= m1); assert.ok(p.marks.read < m1);
    await C.asha('/api/chat', { action: 'read', room: dm, upto: m1 });
    p = await C.neha(`/api/chat?poll=1&room=${dm}&after=0`);
    assert.ok(p.marks.read >= m1);
    assert.equal((await C.ravi(`/api/chat?room=${dm}`)).status, 404); // nobody else can open it
  });

  await step('Reply, react, save, pin, edit; changes reach the open chat', async () => {
    const since = new Date().toISOString();
    const r = await C.asha('/api/chat', { action: 'send', room: dm, body: 'Yes, cleared today', replyTo: m1 });
    assert.equal(r.msg.reply.id, m1);
    assert.equal((await C.neha('/api/chat', { action: 'react', id: r.msg.id, emoji: '👍' })).ok, true);
    assert.equal((await C.neha('/api/chat', { action: 'star', id: r.msg.id })).ok, true);
    assert.equal((await C.asha('/api/chat', { action: 'pin', id: m1 })).ok, true);
    assert.equal((await C.asha('/api/chat', { action: 'edit', id: m1, body: 'mine?' })).status, 403); // only the writer edits
    assert.equal((await C.neha('/api/chat', { action: 'edit', id: m1, body: 'Has the A-1203 cheque of 5 lakh cleared?' })).ok, true);
    const p = await C.neha(`/api/chat?poll=1&room=${dm}&after=${r.msg.id}&since=${encodeURIComponent(since)}`);
    const changed = Object.fromEntries(p.msgs.map((m) => [m.id, m]));
    assert.equal(changed[m1].edited, true); assert.equal(changed[m1].pinned, true);
    assert.equal(p.pins.length, 1);
    const full = await C.neha(`/api/chat?room=${dm}`);
    const reply = full.msgs.find((m) => m.id === r.msg.id);
    assert.deepEqual(reply.reactions, [{ e: '👍', n: 1, mine: true }]); assert.equal(reply.starred, true);
    assert.equal((await C.neha('/api/chat?saved=1')).rows.length, 1);
    assert.equal((await C.asha('/api/chat?saved=1')).rows.length, 0);
    assert.equal((await C.neha('/api/chat?search=cleared')).rows.length, 2);
    assert.equal((await C.ravi('/api/chat?search=cleared')).rows.length, 0);
  });

  await step('Delete for everyone: hidden from all, still there for the Admin\'s review (and that look is in the audit log)', async () => {
    const r = await C.neha('/api/chat', { action: 'send', room: dm, body: 'wrong chat, sorry' });
    assert.equal((await C.asha('/api/chat', { action: 'delete', id: r.msg.id })).status, 403);
    assert.equal((await C.neha('/api/chat', { action: 'delete', id: r.msg.id })).ok, true);
    const seen = (await C.asha(`/api/chat?room=${dm}`)).msgs.find((m) => m.id === r.msg.id);
    assert.equal(seen.kind, 'deleted'); assert.equal(seen.body, '');
    assert.equal((await C.sameer(`/api/chat?review=${dm}`)).status, 403);
    const rev = await admin(`/api/chat?review=${dm}`);
    assert.equal(rev.msgs.find((m) => m.id === r.msg.id).body, 'wrong chat, sorry');
    assert.ok(await db.one("select 1 as x from audit_log where entity = 'chat' and action = 'review'"));
  });

  let img;
  await step('Photos, documents and voice notes: only people in the chat can open them; phones can stream them', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const r = await C.neha('/api/chat', { action: 'send', room: dm, body: 'challan', file: { name: 'challan.png', mime: 'image/png', data: png.toString('base64'), w: 1, h: 1 } });
    assert.equal(r.msg.kind, 'image'); img = r.msg.file.id;
    const got = await C.asha(`/api/chat?file=${img}`, null, { raw: true });
    assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
    const part = await C.asha(`/api/chat?file=${img}`, null, { raw: true, Range: 'bytes=0-3' });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-3/${png.length}`);
    assert.equal((await C.ravi(`/api/chat?file=${img}`, null, { raw: true })).status, 404);
    assert.equal((await C.neha('/api/chat', { action: 'send', room: dm, file: { name: 'x.html', mime: 'text/html', data: 'PGI+' } })).status, 400);
    assert.equal((await C.neha('/api/chat', { action: 'send', room: dm, file: { name: 'big.pdf', mime: 'application/pdf', data: Buffer.alloc(3.2 * 1024 * 1024).toString('base64') } })).status, 413);
    const v = await C.neha('/api/chat', { action: 'send', room: dm, file: { name: 'Voice note', mime: 'audio/webm', data: Buffer.from('voice').toString('base64'), sec: 4.2, voice: true, said: 'kal site pe cement aayega' } });
    assert.equal(v.msg.kind, 'voice'); assert.equal(v.msg.file.text, 'kal site pe cement aayega'); // no Claude key: kept as the phone wrote it
    const html = await C.asha(`/api/chat?file=${img}&dl=1`, null, { raw: true });
    assert.match(html.headers.get('content-disposition'), /^attachment/);
  });

  let grp;
  await step('Groups: anyone makes one; guests see only their groups and those people; department members cannot be removed', async () => {
    const ppl = Object.fromEntries((await C.hcrm('/api/chat?people=1')).people.map((p) => [p.name, p.id]));
    assert.equal((await C.dhanushri('/api/chat', { action: 'group', name: 'X', members: [ppl['Ravi Site']] })).status, 403);
    assert.equal((await C.dhanushri('/api/chat?people=1')).people.length, 0);
    const g = await C.hcrm('/api/chat', { action: 'group', name: 'B Wing MEP', members: [ppl['Ravi Site'], ppl['Dhanushri MEP'], ppl['Neha CRM']] });
    grp = g.room;
    assert.deepEqual((await C.dhanushri('/api/chat?rooms=1')).rooms.map((r) => r.name), ['B Wing MEP']);
    assert.deepEqual((await C.dhanushri('/api/chat?people=1')).people.map((p) => p.name).sort(), ['Head CRM', 'Neha CRM', 'Ravi Site']);
    assert.equal((await C.neha('/api/chat', { action: 'rename', room: grp, value: 'Hack' })).status, 403);
    assert.equal((await C.hcrm('/api/chat', { action: 'rename', room: grp, value: 'B Wing MEP & Site' })).ok, true);
    // forwarding the photo: the group can now open it
    assert.equal((await C.neha('/api/chat', { action: 'forward', id: (await C.neha(`/api/chat?room=${dm}`)).msgs.find((m) => m.kind === 'image').id, rooms: [grp] })).sent, 1);
    assert.equal((await C.ravi(`/api/chat?file=${img}`, null, { raw: true })).status, 200);
    const crm = (await C.hcrm('/api/chat?rooms=1')).rooms.find((r) => r.name === 'CRM');
    assert.equal((await C.hcrm('/api/chat', { action: 'remove', room: crm.id, user: ppl['Neha CRM'] })).status, 400);
    assert.equal((await C.neha('/api/chat', { action: 'leave', room: crm.id })).status, 400);
    assert.equal((await C.dhanushri('/api/chat', { action: 'leave', room: grp })).ok, true);
  });

  await step('Polls: one choice each (or several when allowed); votes can be changed', async () => {
    const p = await C.hcrm('/api/chat', { action: 'send', room: grp, poll: { question: 'Site meeting Saturday?', options: ['11 am', '3 pm'] } });
    assert.equal(p.msg.kind, 'poll');
    await C.neha('/api/chat', { action: 'vote', id: p.msg.id, opt: 0 });
    await C.neha('/api/chat', { action: 'vote', id: p.msg.id, opt: 1 });
    await C.ravi('/api/chat', { action: 'vote', id: p.msg.id, opt: 1 });
    const m = (await C.hcrm(`/api/chat?room=${grp}`)).msgs.find((x) => x.id === p.msg.id);
    assert.deepEqual(m.poll.counts, [0, 2]); assert.equal(m.poll.voters, 2);
    assert.equal((await C.neha('/api/chat', { action: 'vote', id: p.msg.id, opt: 5 })).status, 400);
  });

  await step('Notifications: encrypted for each phone; muted chats stay quiet unless you are named; switched-off phones are forgotten', async () => {
    const sent = [];
    webpush._fetch = async (url, o) => { sent.push({ url, headers: o.headers, body: o.body }); return { ok: !/gone/.test(url), status: /gone/.test(url) ? 410 : 201 }; };
    const ph = phone();
    assert.equal((await C.ravi('/api/chat', { action: 'push', sub: ph.sub, device: 'Android phone (app)' })).ok, true);
    await C.hcrm('/api/chat', { action: 'send', room: grp, body: 'Shaft sizes are final' });
    assert.equal(sent.length, 1);
    const d = ph.read(sent[0].body);
    assert.equal(d.title, 'Head CRM · B Wing MEP & Site'); assert.equal(d.body, 'Shaft sizes are final'); assert.equal(d.room, grp);
    assert.match(sent[0].headers.Authorization, /^vapid t=.+, k=/); assert.equal(sent[0].headers['Content-Encoding'], 'aes128gcm');
    // the VAPID signature checks out against the published key
    const [h, b, s] = sent[0].headers.Authorization.match(/t=([^,]+)/)[1].split('.');
    const pub = Buffer.from((await client()('/api/chat?vapid=1')).key, 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
    assert.equal(JSON.parse(Buffer.from(b, 'base64url')).aud, 'https://push.example.test');
    await C.ravi('/api/chat', { action: 'pref', room: grp, mute: 8 });
    sent.length = 0;
    await C.hcrm('/api/chat', { action: 'send', room: grp, body: 'quiet one' });
    assert.equal(sent.length, 0);
    const ravi = (await C.hcrm(`/api/chat?info=${grp}`)).members.find((m) => m.name === 'Ravi Site');
    await C.hcrm('/api/chat', { action: 'send', room: grp, body: '@Ravi Site please check', mentions: [ravi.id] });
    assert.equal(sent.length, 1);
    assert.equal((await C.ravi('/api/chat?rooms=1')).rooms.find((r) => r.id === grp).mentioned, 1);
    // Do not disturb: nothing at night
    await C.ravi('/api/chat', { action: 'status', text: '🏗️ On site', hours: 4, dnd: { from: '00:00', to: '23:59' } });
    sent.length = 0;
    await C.hcrm('/api/chat', { action: 'send', room: grp, body: '@Ravi Site late', mentions: [ravi.id] });
    assert.equal(sent.length, 0);
    assert.equal((await C.hcrm('/api/chat?people=1')).people.find((p) => p.name === 'Ravi Site').status, '🏗️ On site');
    await C.ravi('/api/chat', { action: 'status', dnd: null });
    await db.q("update chat_push set endpoint = 'https://push.example.test/gone' where endpoint = $1", [ph.sub.endpoint]);
    await C.ravi('/api/chat', { action: 'testpush' });
    assert.equal((await db.one('select count(*)::int as n from chat_push')).n, 0);
    webpush._fetch = null;
  });

  await step('ERP updates land in the right department, with an Approve button only approvers can use', async () => {
    await chat.system('dept:site', '', { title: '🎉 5th Slab cast: A Wing', tone: 'ok', lines: ['Cast on 31 Oct 2026'] });
    const site = (await C.ravi('/api/chat?rooms=1')).rooms.find((r) => r.name === 'Site');
    assert.match(site.last.text, /5th Slab/);
    const id = await chat.system('dept:management', '', { title: 'PR-0012: approve material', lines: ['Cement 100 bags'], act: { type: 'pr', id: 'abc', label: 'Approve or reject' } });
    assert.equal((await C.neha('/api/chat', { action: 'card', id })).status, 404); // not in the Management group
    assert.equal((await admin('/api/chat', { action: 'card', id })).status, 403); // the Admin is not an approver of site purchases
  });

  await step('/flat: only for logins that see flats, never for site', async () => {
    assert.equal((await C.ravi('/api/chat?flat=A-1203')).status, 403);
    assert.equal((await C.neha('/api/chat?flat=Z-9999')).status, 404);
  });

  await step('Catch me up needs the Claude key; without it a clear message', async () => {
    const r = await C.ravi(`/api/chat?catchup=${grp}`); assert.equal(r.status, 400); assert.match(r.error, /not switched on/);
  });

  await step('A login switched off loses DreamComm at once; their chats show they have left', async () => {
    const id = (await admin('/api/users')).users.find((u) => u.username === 'asha').id;
    await admin('/api/users', { action: 'disable', id });
    assert.equal((await C.asha('/api/chat?rooms=1')).status, 401);
    const r = (await C.neha('/api/chat?rooms=1')).rooms.find((x) => x.id === dm);
    assert.equal(r.canPost, false); assert.equal(r.other.off, true);
    assert.equal((await C.neha('/api/chat', { action: 'send', room: dm, body: 'hello?' })).status, 403);
  });

  await step('Files are stored as the real bytes (repair of the old JSON form)', async () => {
    const buf = Buffer.from([0, 1, 2, 250, 255]);
    assert.deepEqual((await db.one('select $1::bytea as d', [buf])).d, buf);
    const page = await fetch(BASE + '/chat'); assert.equal(page.status, 200);
    assert.equal((await fetch(BASE + '/chat.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  });

  console.log(`\nDreamComm: ${n} checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
