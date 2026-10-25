// Minimal PostgreSQL client with no dependencies: the wire protocol over TCP or TLS,
// SCRAM-SHA-256 / md5 / password authentication, parameterised queries (extended protocol)
// and plain multi-statement scripts (simple protocol). One connection per warm function;
// calls are queued so a transaction always owns the connection until it ends.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

// ---------- connection string ----------
function parseUrl(str) {
  const u = new URL(str);
  const q = u.searchParams;
  const host = decodeURIComponent(u.hostname);
  const local = ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/');
  const mode = q.get('sslmode') || (local ? 'disable' : 'require');
  return {
    host, port: +(u.port || 5432),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || decodeURIComponent(u.username),
    ssl: mode !== 'disable',
    // verify-full by default for remote hosts; a self-signed local test server uses sslmode=require&sslinsecure=1
    sslInsecure: q.get('sslinsecure') === '1',
    options: q.get('options') || null,
  };
}

// ---------- message building ----------
const cstr = (s) => Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])]);
function msg(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(type, 0, 'latin1');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
const i16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  // JS arrays become Postgres array literals (use with ::int[] or ::text[]); objects become JSON.
  if (Array.isArray(v)) return '{' + v.map((x) => (x === null || x === undefined ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------- value parsing (text format) ----------
const INT = new Set([20, 21, 23, 26]);
const FLOAT = new Set([700, 701]);
function parseValue(oid, s) {
  if (s === null) return null;
  if (INT.has(oid)) { const n = Number(s); return Number.isSafeInteger(n) ? n : s; }
  if (FLOAT.has(oid)) return Number(s);
  if (oid === 16) return s === 't';
  if (oid === 114 || oid === 3802) return JSON.parse(s);
  if (oid === 1184) return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
  if (oid === 1114) return new Date(s.replace(' ', 'T') + 'Z').toISOString();
  return s; // numeric stays a string (exact money), date stays YYYY-MM-DD
}

class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'database error');
    this.code = fields.C; this.detail = fields.D; this.constraint = fields.n; this.severity = fields.S;
  }
}

class Client {
  constructor(url) { this.cfg = parseUrl(url); this.sock = null; this.buf = Buffer.alloc(0); this.waiters = []; this.dead = false; }

  async connect() {
    const c = this.cfg;
    let sock = net.connect({ host: c.host, port: c.port });
    await new Promise((ok, bad) => { sock.once('connect', ok); sock.once('error', bad); });
    sock.setNoDelay(true);
    if (c.ssl) {
      sock.write(Buffer.concat([i32(8), i32(80877103)]));
      const answer = await new Promise((ok, bad) => { sock.once('data', ok); sock.once('error', bad); });
      if (answer.toString('latin1', 0, 1) !== 'S') throw new Error('database server does not accept SSL');
      sock = tls.connect({ socket: sock, servername: net.isIP(c.host) ? undefined : c.host, rejectUnauthorized: !c.sslInsecure });
      await new Promise((ok, bad) => { sock.once('secureConnect', ok); sock.once('error', bad); });
    }
    this.sock = sock;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    const fail = (e) => { this.dead = true; const err = e || new Error('database connection closed'); const w = this.waiters; this.waiters = []; w.forEach((x) => x.bad(err)); };
    sock.on('error', fail);
    sock.on('close', () => fail());

    const params = [cstr('user'), cstr(c.user), cstr('database'), cstr(c.database), cstr('client_encoding'), cstr('UTF8'), cstr('application_name'), cstr('dream-india-erp')];
    if (c.options) params.push(cstr('options'), cstr(c.options));
    const body = Buffer.concat([i32(196608), ...params, Buffer.from([0])]);
    sock.write(Buffer.concat([i32(body.length + 4), body]));
    await this.authenticate();
    // wait for ReadyForQuery
    for (;;) { const m = await this.next(); if (m.type === 'Z') break; if (m.type === 'E') throw new PgError(m.fields); }
  }

  async authenticate() {
    let scram = null;
    for (;;) {
      const m = await this.next();
      if (m.type === 'E') throw new PgError(m.fields);
      if (m.type !== 'R') continue;
      const code = m.body.readInt32BE(0);
      if (code === 0) return;
      if (code === 3) this.sock.write(msg('p', cstr(this.cfg.password)));
      else if (code === 5) {
        const salt = m.body.subarray(4, 8);
        const inner = crypto.createHash('md5').update(this.cfg.password + this.cfg.user).digest('hex');
        const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
        this.sock.write(msg('p', cstr('md5' + outer)));
      } else if (code === 10) {
        const mechs = m.body.subarray(4).toString('utf8').split('\0').filter(Boolean);
        if (!mechs.includes('SCRAM-SHA-256')) throw new Error('unsupported auth: ' + mechs.join(','));
        const nonce = crypto.randomBytes(18).toString('base64');
        const first = `n=*,r=${nonce}`;
        scram = { nonce, first };
        const data = Buffer.from('n,,' + first);
        this.sock.write(msg('p', cstr('SCRAM-SHA-256'), i32(data.length), data));
      } else if (code === 11) {
        const server = m.body.subarray(4).toString('utf8');
        const a = Object.fromEntries(server.split(',').map((p) => [p[0], p.slice(2)]));
        if (!a.r || !a.r.startsWith(scram.nonce)) throw new Error('SCRAM nonce mismatch');
        const salted = crypto.pbkdf2Sync(this.cfg.password, Buffer.from(a.s, 'base64'), +a.i, 32, 'sha256');
        const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
        const clientKey = hmac(salted, 'Client Key');
        const storedKey = crypto.createHash('sha256').update(clientKey).digest();
        const finalNoProof = `c=biws,r=${a.r}`;
        const authMsg = `${scram.first},${server},${finalNoProof}`;
        const sig = hmac(storedKey, authMsg);
        const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
        scram.serverSig = hmac(hmac(salted, 'Server Key'), authMsg).toString('base64');
        this.sock.write(msg('p', Buffer.from(`${finalNoProof},p=${proof.toString('base64')}`)));
      } else if (code === 12) {
        const v = m.body.subarray(4).toString('utf8').replace(/^v=/, '');
        if (!scram || v !== scram.serverSig) throw new Error('SCRAM server signature mismatch');
      } else throw new Error('unsupported auth method ' + code);
    }
  }

  pump() {
    while (this.buf.length >= 5 && this.waiters.length) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const type = this.buf.toString('latin1', 0, 1);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      const m = { type, body };
      if (type === 'E' || type === 'N') {
        m.fields = {};
        let o = 0;
        while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]); const e = body.indexOf(0, o + 1); m.fields[k] = body.toString('utf8', o + 1, e); o = e + 1; }
      }
      if (type === 'N' || type === 'S' || type === 'K' || type === 'A') continue; // notices and status: ignore
      this.waiters.shift().ok(m);
    }
  }
  next() {
    if (this.dead) return Promise.reject(new Error('database connection closed'));
    return new Promise((ok, bad) => { this.waiters.push({ ok, bad }); this.pump(); });
  }

  // Collect results until ReadyForQuery. Returns the LAST statement's rows (and every result for scripts).
  async collect() {
    let fields = null, rows = [], error = null, count = null;
    const results = [];
    for (;;) {
      const m = await this.next();
      switch (m.type) {
        case 'T': {
          const n = m.body.readInt16BE(0); let o = 2; fields = [];
          for (let i = 0; i < n; i++) { const e = m.body.indexOf(0, o); const name = m.body.toString('utf8', o, e); o = e + 1; const oid = m.body.readInt32BE(o + 6); o += 18; fields.push({ name, oid }); }
          rows = []; break;
        }
        case 'D': {
          const n = m.body.readInt16BE(0); let o = 2; const row = {};
          for (let i = 0; i < n; i++) { const len = m.body.readInt32BE(o); o += 4; const s = len < 0 ? null : m.body.toString('utf8', o, o + len); if (len > 0) o += len; row[fields[i].name] = parseValue(fields[i].oid, s); }
          rows.push(row); break;
        }
        case 'C': { const tag = m.body.toString('utf8', 0, m.body.length - 1); count = +(tag.split(' ').pop()) || 0; results.push({ rows, count }); rows = []; fields = null; break; }
        case 'E': error = new PgError(m.fields); break;
        case 'Z': if (error) throw error; return results.length ? { ...results[results.length - 1], results } : { rows: [], count: 0, results };
        default: break; // 1 ParseComplete, 2 BindComplete, n NoData, I EmptyQuery, s PortalSuspended
      }
    }
  }

  async query(text, params = []) {
    const vals = params.map(serialize);
    const bind = [cstr(''), cstr(''), i16(0), i16(vals.length)];
    for (const v of vals) { if (v === null) bind.push(i32(-1)); else { const b = Buffer.from(v, 'utf8'); bind.push(i32(b.length), b); } }
    bind.push(i16(0));
    this.sock.write(Buffer.concat([
      msg('P', cstr(''), cstr(text), i16(0)),
      msg('B', ...bind),
      msg('D', Buffer.from('P'), cstr('')),
      msg('E', cstr(''), i32(0)),
      msg('S'),
    ]));
    return this.collect();
  }
  async script(text) { this.sock.write(msg('Q', cstr(text))); return this.collect(); }
  close() { try { this.sock.write(msg('X')); this.sock.end(); } catch {} this.dead = true; }
}

// ---------- shared connection + queue ----------
let client = null;
let queue = Promise.resolve();
async function conn() {
  if (client && !client.dead) return client;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw Object.assign(new Error('Database not connected'), { code: 'NO_DB' });
  const c = new Client(url);
  await c.connect();
  client = c;
  return c;
}
// Runs fn with the connection held exclusively (queued behind earlier work).
function exclusive(fn) {
  const run = async () => fn(await conn());
  const p = queue.then(run, run);
  queue = p.then(() => {}, () => {});
  return p;
}

module.exports = { Client, PgError, parseUrl, exclusive, conn, reset: () => { if (client) client.close(); client = null; } };
