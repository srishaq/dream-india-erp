// Reads one email (RFC 822, as fetched from the mailbox): sender, subject, date, Message-ID and threading headers,
// the plain text (or the HTML turned into text) and the attachments. No npm packages.
const decodeCharset = (buf, cs) => {
  const c = String(cs || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(c === 'us-ascii' || c === 'ascii' ? 'utf-8' : c).decode(buf); } catch { return buf.toString('latin1'); }
};
function qp(s) {
  const bytes = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { bytes.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}
// =?utf-8?B?...?= and =?utf-8?Q?...?= words in headers
const words = (s) => String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
  decodeCharset(/b/i.test(enc) ? Buffer.from(txt, 'base64') : qp(txt.replace(/_/g, ' ')), cs));

function splitHead(buf) {
  let i = buf.indexOf('\r\n\r\n'), sep = 4;
  if (i < 0) { i = buf.indexOf('\n\n'); sep = 2; }
  if (i < 0) return { head: buf.toString('latin1'), body: Buffer.alloc(0) };
  return { head: buf.subarray(0, i).toString('latin1'), body: buf.subarray(i + sep) };
}
function headers(head) {
  const h = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([^:\s]+):\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(); if (!(k in h)) h[k] = m[2];
  }
  return h;
}
const param = (v, name) => { const m = String(v || '').match(new RegExp(`(?:^|;)\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;]*))`, 'i')); return m ? (m[1] ?? m[2] ?? '').trim() : null; };
const htmlText = (h) => String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function walk(buf, out, depth = 0) {
  const { head, body } = splitHead(buf);
  const h = headers(head);
  const ct = h['content-type'] || 'text/plain', type = ct.split(';')[0].trim().toLowerCase();
  const enc = (h['content-transfer-encoding'] || '').trim().toLowerCase();
  if (type.startsWith('multipart/') && depth < 8) {
    const b = param(ct, 'boundary'); if (!b) return;
    const parts = body.toString('latin1').split('--' + b);
    for (const p of parts.slice(1)) { if (p.startsWith('--')) break; walk(Buffer.from(p.replace(/^\r?\n/, ''), 'latin1'), out, depth + 1); }
    return;
  }
  const raw = enc === 'base64' ? Buffer.from(body.toString('latin1').replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qp(body.toString('latin1')) : body;
  const disp = h['content-disposition'] || '';
  const filename = words(param(disp, 'filename') || param(ct, 'name') || '');
  if (type === 'message/rfc822') { out.attachments.push({ filename: filename || 'forwarded-message.eml', mime: 'message/rfc822', content: raw }); return; }
  if (filename || /^attachment/i.test(disp) || !/^text\//.test(type)) {
    if (raw.length) out.attachments.push({ filename: filename || 'attachment', mime: type, content: raw });
    return;
  }
  const text = decodeCharset(raw, param(ct, 'charset'));
  if (type === 'text/html') { if (!out.html) out.html = text; } else if (!out.text) out.text = text;
}

function parse(buf) {
  const { head } = splitHead(buf);
  const h = headers(head);
  const out = { text: '', html: '', attachments: [] };
  walk(buf, out);
  const ids = (v) => (String(v || '').match(/<[^>]+>/g) || []);
  const date = h.date ? new Date(h.date) : null;
  return {
    from: words(h.from || ''), to: words(h.to || ''), cc: words(h.cc || ''), subject: words(h.subject || ''),
    date: date && !isNaN(date) ? date.toISOString() : null,
    messageId: ids(h['message-id'])[0] || null, inReplyTo: ids(h['in-reply-to'])[0] || null, references: ids(h.references),
    autoReply: /auto-(replied|generated)/i.test(h['auto-submitted'] || '') || /^(auto|out of office|automatic reply)/i.test(words(h.subject || '')),
    text: (out.text || htmlText(out.html || '')).replace(/\r\n/g, '\n').trim(),
    attachments: out.attachments,
  };
}

module.exports = { parse, words };
