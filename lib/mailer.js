// Sends email over SMTP (no npm deps). Built for Gmail / Google Workspace with an app password,
// but works with any SMTP server that offers implicit TLS (port 465).
// Env: SMTP_USER, SMTP_PASS (Gmail app password), optional SMTP_HOST (smtp.gmail.com), SMTP_PORT (465),
//      MAIL_FROM (defaults to SMTP_USER), MAIL_FROM_NAME. SMTP_TLS=0 only for local testing.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

const cfg = () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: +process.env.SMTP_PORT || 465,
  user: process.env.SMTP_USER || '',
  pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  fromName: process.env.MAIL_FROM_NAME || 'Dream Signature CRM',
  tls: process.env.SMTP_TLS !== '0',
});
const configured = () => { const c = cfg(); return !!(c.user && c.pass && c.from); };
const sender = () => (configured() ? cfg().from : null);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
// RFC 2047: keep each encoded-word under 75 characters by splitting on whole characters.
function encWord(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = []; let cur = '';
  for (const ch of String(s)) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 42) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
}
const safeName = (f) => String(f).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'letter.pdf';
const addr = (name, email) => (name ? `${encWord(String(name).replace(/["\\]/g, ''))} <${email}>` : `<${email}>`);

function buildMessage({ from, fromName, to, cc = [], subject, text, html, attachments = [] }) {
  const mixed = 'mix_' + crypto.randomBytes(9).toString('hex');
  const alt = 'alt_' + crypto.randomBytes(9).toString('hex');
  const domain = from.split('@')[1] || 'localhost';
  const head = [
    `From: ${addr(fromName, from)}`,
    `To: ${to.map((t) => `<${t}>`).join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.map((t) => `<${t}>`).join(', ')}`] : []),
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const body = [
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text || '')),
    ...(html ? [`--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html))] : []),
    `--${alt}--`, '',
  ];
  for (const a of attachments) {
    const fn = safeName(a.filename);
    body.push(`--${mixed}`, `Content-Type: ${a.type || 'application/octet-stream'}; name="${fn}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn}"`, '', wrap76(a.content.toString('base64')));
  }
  body.push(`--${mixed}--`, '');
  return head.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
}

// One SMTP connection; send several messages, then close().
function connect() {
  const c = cfg();
  return new Promise((resolve, reject) => {
    const sock = c.tls ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
    sock.setEncoding('utf8');
    sock.setTimeout(30000, () => sock.destroy(new Error('SMTP timeout')));
    let buf = '', waiting = null, dead = null;
    const fail = (e) => { dead = dead || e || new Error('SMTP connection closed'); if (waiting) { const w = waiting; waiting = null; w.reject(dead); } };
    sock.on('data', (d) => {
      buf += d;
      // A reply is complete when its last line is "NNN text" (not "NNN-text").
      const lines = buf.split('\r\n');
      const last = lines[lines.length - 2];
      if (last && /^\d{3} /.test(last) && waiting) { const r = buf; buf = ''; const w = waiting; waiting = null; w.resolve({ code: +r.slice(0, 3), text: r.trim() }); }
    });
    sock.on('error', (e) => { fail(e); reject(e); });
    sock.on('close', () => fail(new Error('SMTP connection closed')));
    const reply = () => new Promise((res, rej) => { if (dead || sock.destroyed) return rej(dead || new Error('SMTP connection closed')); waiting = { resolve: res, reject: rej }; });
    const cmd = async (line, ok) => {
      const p = reply();
      if (line != null) sock.write(line + '\r\n');
      const r = await p;
      if (ok && !ok.includes(r.code)) throw new Error(`SMTP ${r.text.replace(/\r?\n/g, ' ').slice(0, 200)}`);
      return r;
    };
    const ready = (async () => {
      await cmd(null, [220]);
      await cmd(`EHLO ${process.env.VERCEL_URL || 'dream-india-erp'}`, [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(c.user), [334]);
      await cmd(b64(c.pass), [235]);
    })();
    ready.then(() => resolve({
      async send(msg) {
        const to = [...msg.to, ...(msg.cc || [])];
        let inData = false;
        try {
          await cmd(`MAIL FROM:<${c.from}>`, [250]);
          for (const t of to) await cmd(`RCPT TO:<${t}>`, [250, 251]);
          await cmd('DATA', [354]); inData = true;
          const data = buildMessage({ ...msg, from: c.from, fromName: msg.fromName || c.fromName }).replace(/^\./gm, '..');
          await cmd(data + '\r\n.', [250]);
        } catch (e) {
          // Reset the transaction so the next message in this batch is not refused ("503 nested MAIL").
          if (!inData && !dead && !sock.destroyed) { try { await cmd('RSET', [250]); } catch { /* connection unusable */ } }
          throw e;
        }
      },
      get alive() { return !dead && !sock.destroyed; },
      async close() {
        if (dead || sock.destroyed) return;
        await Promise.race([cmd('QUIT', [221]).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
        sock.destroy();
      },
    }), (e) => { sock.destroy(); reject(e); });
  });
}

module.exports = { configured, sender, connect, buildMessage };
