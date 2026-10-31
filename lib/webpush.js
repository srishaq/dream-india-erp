// Phone and computer notifications for Dream Chat (the Web Push standard, the same thing WhatsApp Web uses).
// No outside packages: the message is encrypted for each phone (RFC 8291, aes128gcm) and signed with the ERP's own key
// (VAPID, RFC 8292), both made with Node's crypto. The key pair is created once and kept in settings ('vapid').
// Google, Apple and Mozilla only carry the encrypted message to the phone; they cannot read it.
const crypto = require('crypto');
const db = require('./db');

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

let keysCache = null;
async function keys() {
  if (keysCache) return keysCache;
  let row = await db.one("select value from settings where key = 'vapid'");
  if (!row) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const pub = publicKey.export({ format: 'jwk' });
    const raw = Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)]);
    await db.q("insert into settings (key, value) values ('vapid', $1) on conflict (key) do nothing", [JSON.stringify({ jwk, pub: b64u(raw) })]);
    row = await db.one("select value from settings where key = 'vapid'");
  }
  keysCache = { pub: row.value.pub, key: crypto.createPrivateKey({ key: row.value.jwk, format: 'jwk' }) };
  return keysCache;
}
const publicKey = async () => (await keys()).pub;

// The signed note that says the ERP sent this (valid 12 hours, for that push service only).
async function vapidHeader(endpoint) {
  const k = await keys();
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const sub = process.env.ERP_PUSH_CONTACT || 'mailto:info@dreamindiarealty.com';
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: k.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.pub}`;
}

// RFC 8291: the payload encrypted for one phone's keys (p256dh, auth).
function encrypt(payload, p256dh, auth) {
  const uaPub = unb64u(p256dh), secret = unb64u(auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}

// One notification to one saved phone. Returns 'ok', 'gone' (that phone unsubscribed: forget it) or 'fail'.
async function sendOne(sub, data, { ttl = 3600, urgency = 'high', topic } = {}) {
  const payload = JSON.stringify(data).slice(0, 3000);
  const headers = { TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await vapidHeader(sub.endpoint) };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await (module.exports._fetch || fetch)(sub.endpoint, { method: 'POST', headers, body: encrypt(payload, sub.p256dh, sub.auth), signal: ac.signal });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'fail';
  } catch { return 'fail'; } finally { clearTimeout(t); }
}

// To every phone of these logins. Never throws: a notification failing must not stop the message being sent.
async function toUsers(userIds, data, opts) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return { sent: 0 };
  let subs;
  try { subs = await db.q('select id, endpoint, p256dh, auth from chat_push where user_id = any($1) and fails < 20', [ids]); } catch { return { sent: 0 }; }
  const res = await Promise.all(subs.map(async (s) => [s, await sendOne(s, data, opts).catch(() => 'fail')]));
  let sent = 0;
  for (const [s, r] of res) {
    if (r === 'ok') { sent++; await db.q('update chat_push set last_ok = now(), fails = 0 where id = $1', [s.id]).catch(() => {}); }
    else if (r === 'gone') await db.q('delete from chat_push where id = $1', [s.id]).catch(() => {});
    else await db.q('update chat_push set fails = fails + 1 where id = $1', [s.id]).catch(() => {});
  }
  return { sent, phones: subs.length };
}

module.exports = { publicKey, toUsers, encrypt, sendOne, vapidHeader, _fetch: null };
