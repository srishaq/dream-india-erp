// A channel partner's papers, needed before approval: PAN, GST, MahaRERA certificate, and the partner agreement.
// The agreement is accepted online (the partner types their name and accepts, signed in on their verified account:
// name, time, account and a fingerprint of the exact text are kept), uploaded as a signed scan, or brought to the
// office signed (the office marks it received). Only the people named in Partner settings (Mubin) approve partners.
const crypto = require('crypto');
const db = require('./db');

const err = (status, message) => Object.assign(new Error(message), { status });
const KINDS = { pan: 'PAN card', gst: 'GST certificate', rera: 'MahaRERA agent certificate', agreement: 'Partner agreement' };
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/, GST = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MIME = /^(application\/pdf|image\/(png|jpeg|webp))$/;

// The standard agreement (the office can replace the text in Partner settings; each version has its own fingerprint).
const AGREEMENT = `CHANNEL PARTNER AGREEMENT — DREAM INDIA REALTY

1. Registration. The Partner is registered with Dream India Realty ("Dream India") under the Channel Partner ID shown on the portal, holds a valid MahaRERA agent registration, and keeps it valid throughout.
2. Clients. The Partner registers its clients on the Dream India Partner Portal, project by project. A client the Partner registers is credited to the Partner when the Partner brings that client to the site for a visit. A client who visits the site on their own, or who is already in Dream India's records, is Dream India's client.
3. Brokerage. Brokerage is paid only on bookings credited to the Partner, at the rate agreed for the project, on the agreement value, after the agreement is registered and the share of the payment set by Dream India has been received from the buyer. Cancelled bookings earn no brokerage; any brokerage paid on them is recoverable. GST is payable on brokerage as per law against the Partner's tax invoice.
4. No pass-back or offers without approval. The Partner will not offer any discount, pass-back, scheme or price other than Dream India's approved price sheet without Dream India's written approval.
5. Advertising. Any advertisement by the Partner for a Dream India project must carry the project's MahaRERA registration number and QR code and be approved by Dream India before it is published.
6. Data. Client data shared through the portal is used only for the project it is registered for and kept confidential by both sides. The Partner has the client's consent to share it.
7. Conduct. The Partner will deal with buyers honestly, will not misrepresent any project detail, and will follow the Real Estate (Regulation and Development) Act, 2016 and MahaRERA rules.
8. Ending. Either side may end this arrangement with written notice. Brokerage already earned on bookings made before the notice remains payable as per clause 3.
9. Jurisdiction. Courts in Mumbai have jurisdiction.`;

async function agreementText() { const r = await db.one("select value from settings where key = 'tm'"); return (r && r.value && r.value.agreementText) || AGREEMENT; }
const fingerprint = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16);

async function status(cpId) {
  const rows = await db.q('select distinct on (kind) id, kind, number, file_name, mime, how, signed_name, signed_at, agreement_hash, uploaded_at from cp_docs where cp_id = $1 order by kind, id desc', [cpId]);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  const list = Object.entries(KINDS).map(([k, label]) => { const d = by[k];
    return { kind: k, label, done: !!d, id: d && d.id, number: d && d.number, file: !!(d && d.file_name), fileName: d && d.file_name, how: d && d.how, signedName: d && d.signed_name, at: d && (d.signed_at || d.uploaded_at) }; });
  return { docs: list, complete: list.every((d) => d.done), missing: list.filter((d) => !d.done).map((d) => d.label) };
}

async function upload(cp, { kind, number, file }) {
  if (!KINDS[kind] || kind === 'agreement' && !file) throw err(400, 'Which document?');
  let num = String(number || '').toUpperCase().replace(/\s/g, '') || null;
  if (kind === 'pan' && !PAN.test(num || '')) throw err(400, 'A PAN looks like ABCDE1234F.');
  if (kind === 'gst' && !GST.test(num || '')) throw err(400, 'A GSTIN has 15 characters, e.g. 27ABCDE1234F1Z5.');
  if (kind === 'rera') num = cp.rera_no || num;
  if (!file || !file.data) throw err(400, 'Attach the document (PDF or a clear photo).');
  const buf = Buffer.from(String(file.data), 'base64');
  if (!MIME.test(String(file.mime || ''))) throw err(400, 'Attach a PDF, JPG or PNG.');
  if (!buf.length || buf.length > 3 * 1024 * 1024) throw err(400, 'The file must be under 3 MB.');
  await db.q('insert into cp_docs (cp_id, kind, number, file_name, mime, data, how) values ($1, $2, $3, $4, $5, $6, $7)', [cp.id, kind, num, String(file.name || kind).slice(0, 120), file.mime, buf, kind === 'agreement' ? 'uploaded signed copy' : 'uploaded']);
  if (kind === 'pan') await db.q('update channel_partners set pan = $2 where id = $1', [cp.id, num]);
  if (kind === 'gst') await db.q('update channel_partners set gstin = $2 where id = $1', [cp.id, num]);
  return status(cp.id);
}

// Accepted online: the partner, signed in on its own verified account, types the signatory's name and accepts.
async function signOnline(cp, { name, agree, ip }) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!agree) throw err(400, 'Tick that you have read and accept the agreement.');
  if (n.length < 3) throw err(400, 'Type the full name of the person signing for the firm.');
  const text = await agreementText();
  await db.q("insert into cp_docs (cp_id, kind, how, signed_name, signed_at, signed_from, agreement_hash) values ($1, 'agreement', 'accepted online', $2, now(), $3, $4)",
    [cp.id, n.slice(0, 120), crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 16), fingerprint(text)]);
  return status(cp.id);
}

// The office got the agreement signed on paper.
async function paperReceived(cpId, user) {
  await db.q("insert into cp_docs (cp_id, kind, how, signed_at, received_by) values ($1, 'agreement', 'signed copy received at the office', now(), $2)", [cpId, user.id]);
  return status(cpId);
}

// Who may approve partners (Partner settings → "Partners approved by"); nobody named: anyone who manages partners.
async function approvers() {
  const r = await db.one("select value from settings where key = 'tm'"); const set = ((r && r.value && r.value.approvers) || []).map(Number).filter(Boolean);
  if (set.length) return set;
  // nobody chosen yet: Mubeen, who approves partners, by his login name
  return (await db.q("select id from users where not disabled and (lower(username) like '%mube%n%' or lower(name) like '%mube%n%' or lower(name) like '%mubin%')")).map((x) => x.id);
}

module.exports = { KINDS, AGREEMENT, agreementText, fingerprint, status, upload, signOnline, paperReceived, approvers };
