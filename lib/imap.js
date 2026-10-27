// A small IMAP client (no npm packages): log in over TLS, open the inbox, find new messages by UID and fetch them
// whole without marking them read (BODY.PEEK). Enough for reading buyers' replies; it never deletes or moves mail.
const tls = require('tls');
const net = require('net');

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function connect({ host, port = 993, secure = true, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(timeout, () => sock.destroy(new Error('The mail server did not answer in time.')));
    let buf = Buffer.alloc(0), lit = -1, cur = null, n = 0, dead = null;
    const waiting = []; // { tag, items, resolve, reject }
    const start = () => (cur = { text: '', lits: [] });
    start();
    const fail = (e) => { dead = dead || e; while (waiting.length) waiting.shift().reject(dead); };
    sock.on('error', (e) => { fail(e); reject(e); });
    sock.on('close', () => fail(new Error('The mail server closed the connection.')));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (lit >= 0) {
          if (buf.length < lit) return;
          cur.lits.push(buf.subarray(0, lit)); buf = buf.subarray(lit); lit = -1; continue;
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.subarray(0, i).toString('latin1'); buf = buf.subarray(i + 2);
        cur.text += line;
        const m = line.match(/\{(\d+)\}$/);
        if (m) { lit = +m[1]; cur.text += '\u0000'; continue; }
        const item = cur; start();
        const w = waiting[0];
        if (!w) continue;
        if (w.tag === null) { if (/^\* (OK|PREAUTH)/i.test(item.text)) { waiting.shift(); w.resolve([item]); } else if (/^\* BYE/i.test(item.text)) { waiting.shift(); w.reject(new Error(item.text)); } continue; }
        if (item.text.startsWith(w.tag + ' ')) {
          waiting.shift();
          if (/^\S+ OK/i.test(item.text)) w.resolve(w.items);
          else w.reject(Object.assign(new Error(item.text.replace(/^\S+ (NO|BAD) /i, '').replace(/\[[^\]]*\]\s*/, '')), { imap: true }));
        } else w.items.push(item);
      }
    });
    const cmd = (line) => new Promise((res, rej) => {
      if (dead || sock.destroyed) return rej(dead || new Error('Not connected to the mail server.'));
      const tag = 'a' + ++n; waiting.push({ tag, items: [], resolve: res, reject: rej });
      sock.write(`${tag} ${line}\r\n`);
    });
    new Promise((res, rej) => waiting.push({ tag: null, items: [], resolve: res, reject: rej })).then(() => resolve({
      async login(user, pass) { await cmd(`LOGIN ${q(user)} ${q(pass)}`); },
      async select(box = 'INBOX') {
        const items = await cmd(`SELECT ${q(box)}`);
        const val = (re) => { for (const it of items) { const m = it.text.match(re); if (m) return +m[1]; } return null; };
        return { uidValidity: val(/UIDVALIDITY (\d+)/i), uidNext: val(/UIDNEXT (\d+)/i), exists: val(/^\* (\d+) EXISTS/i) };
      },
      async search(criteria) {
        const items = await cmd(`UID SEARCH ${criteria}`);
        const out = [];
        for (const it of items) { const m = it.text.match(/^\* SEARCH ?(.*)$/i); if (m) out.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number)); }
        return out.sort((a, b) => a - b);
      },
      async fetch(uid) {
        const items = await cmd(`UID FETCH ${uid} (UID RFC822.SIZE BODY.PEEK[])`);
        const it = items.find((x) => /FETCH/i.test(x.text) && x.lits.length);
        return it ? it.lits[it.lits.length - 1] : null;
      },
      async logout() { try { await cmd('LOGOUT'); } catch { /* closing anyway */ } sock.destroy(); },
    }), (e) => { sock.destroy(); reject(e); });
  });
}

module.exports = { connect };
