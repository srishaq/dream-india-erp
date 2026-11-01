// Channel partner firms that are in the ERP already (from the accounts sheet and the bookings) but not on the partner
// portal yet: the list for Accounts, possible duplicates, invitations to the portal, and merging duplicates.
//   duplicates   the same firm written differently: "Tohfa Property" / "Tohfa Properties", "S.K Realtors" / "S K Realtors",
//                "Ajay Verma(Prop Anchor)" / "Ajay Verma (Prop Anchor)", "Arsh Rehmani (Just Deal Properties)" / "Just Deal"
//   invite       Accounts confirms the firm's mobile and email; a one-time link (14 days, only its hash kept) goes to the
//                firm; the firm verifies a code sent to that mobile and email, picks a username and password, and is
//                then a pending partner like any other (papers, then approval by the partner approvers)
//   merge        asked for by Accounts (which firms are one, which name to keep), approved by the partner approvers
//                (Mubeen; never the person who asked, except the Admin); only then is anything moved, in one transaction
const crypto = require('crypto');
const db = require('./db');
const audit = require('./audit');
const TM = require('./tm');
const CA = require('./cp-auth');
const { keyOf } = require('./cp');

const err = (status, message) => Object.assign(new Error(message), { status });
const INVITE_DAYS = 14;
// an int[] column comes back from the driver as text ("{1,2}")
const ints = (v) => (Array.isArray(v) ? v.map(Number) : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));
const portalUrl = () => (process.env.PARTNER_URL || 'https://partners.dreamindiarealty.com').replace(/\/+$/, '');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------- possible duplicates ----------
// Words that do not tell two firms apart, and simple plurals ("properties" = "property").
const STOP = new Set(['realty', 'realties', 'realtor', 'property', 'pvt', 'private', 'ltd', 'limited', 'llp', 'and', 'the', 'associate', 'consultant', 'co', 'company', 'firm', 'enterprise']);
const sing = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => String(s || '').toLowerCase().replace(/^\s*m\s*\/\s*s\.?\s+/, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(sing);
function core(s) { const w = words(s); const k = w.filter((x) => !STOP.has(x)).join(''); return k.length >= 2 ? k : w.join(''); }
// The keys a name is matched on: the whole name, and for "Person (Firm)" the firm in brackets and the part outside.
function matchKeys(name) {
  const keys = [{ k: core(name), why: 'same name apart from spacing, punctuation and words like Realty / Properties / Pvt Ltd' }];
  const inner = [...String(name || '').matchAll(/\(([^)]*)\)?/g)].map((m) => m[1]).filter((x) => x && x.trim());
  if (inner.length) {
    for (const x of inner) keys.push({ k: core(x), why: 'the firm in brackets is the same' });
    keys.push({ k: core(String(name).replace(/\([^)]*\)?/g, ' ')), why: 'the name outside the brackets is the same' });
  }
  return keys.filter((x, i) => x.k && x.k.length >= (i === 0 ? 2 : 3)); // "S K Realtors" is "sk"
}
function lev1(a, b) { // true when a and b differ by at most one letter
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
// Groups of firms that are probably the same: [{ ids, why: [...] }]
function duplicateGroups(firms) {
  const parent = new Map(firms.map((f) => [f.id, f.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const edges = [];
  const join = (a, b, w) => { edges.push([a, w]); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const byKey = new Map();
  for (const f of firms) for (const { k, why: w } of matchKeys(f.name)) { const s = byKey.get(k); if (s) { if (s !== f.id) join(s, f.id, w); } else byKey.set(k, f.id); }
  const full = firms.map((f) => ({ id: f.id, k: core(f.name) })).filter((x) => x.k.length >= 8);
  for (let i = 0; i < full.length; i++) for (let j = i + 1; j < full.length; j++) if (full[i].k !== full[j].k && lev1(full[i].k, full[j].k)) join(full[i].id, full[j].id, 'the names differ by one letter');
  const groups = new Map();
  for (const f of firms) { const r = find(f.id); (groups.get(r) || groups.set(r, []).get(r)).push(f.id); }
  const whyOf = (ids) => [...new Set(edges.filter(([a]) => ids.includes(a)).map(([, w]) => w))];
  return [...groups.values()].filter((g) => g.length > 1).map((ids) => ({ ids, why: whyOf(ids) }));
}

// ---------- the list for Accounts ----------
async function firmsList() {
  const firms = await db.q(`select c.id, c.name, c.cp_code, c.username, c.portal_status, c.contact_person, c.phone, c.email, c.rera_no, c.active,
      (select count(*)::int from bookings b where b.cp_id = c.id and b.status = 'active' and not b.sample) as bookings,
      (select count(*)::int from bookings b where b.cp_id = c.id and b.status = 'cancelled' and not b.sample) as cancelled,
      (select string_agg(distinct p.name, ', ') from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id where b.cp_id = c.id and not b.sample) as projects,
      (select json_build_object('at', i.created_at, 'expires', i.expires_at, 'sentTo', i.sent_to, 'used', i.used_at is not null, 'live', i.used_at is null and i.revoked_at is null and i.expires_at > now())
         from cp_invites i where i.cp_id = c.id order by i.id desc limit 1) as invite,
      (select r.id from cp_merge_requests r where r.status = 'pending' and (r.into_id = c.id or c.id = any(r.from_ids)) limit 1) as merge_request
    from channel_partners c where c.merged_into is null and not c.is_reference order by c.name`);
  const groups = duplicateGroups(firms);
  const byId = Object.fromEntries(firms.map((f) => [f.id, f]));
  const brief = (f) => ({ id: f.id, name: f.name, bookings: f.bookings, cancelled: f.cancelled, onPortal: !!f.username, cpCode: f.cp_code, status: f.portal_status, mergeRequest: f.merge_request });
  const hint = {};
  for (const g of groups) for (const id of g.ids) hint[id] = g.ids.filter((x) => x !== id).map((x) => brief(byId[x]));
  return {
    notOnPortal: firms.filter((f) => !f.username).map((f) => ({ ...f, duplicates: hint[f.id] || [] })).sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name)),
    duplicates: groups.map((g) => ({ why: g.why, firms: g.ids.map((x) => brief(byId[x])).sort((a, b) => Number(b.onPortal) - Number(a.onPortal) || b.bookings - a.bookings) }))
      .sort((a, b) => b.firms.reduce((s, f) => s + f.bookings, 0) - a.firms.reduce((s, f) => s + f.bookings, 0)),
    portalCount: firms.filter((f) => f.username).length,
  };
}
const openMerge = (q, ids) => q('select id from cp_merge_requests where status = $1 and (into_id = any($2::int[]) or from_ids && $2::int[]) limit 1', ['pending', ids]);

// ---------- invitations ----------
async function invite({ id, mobile, email, user }) {
  const m = mobile ? TM.mobile(mobile) : '', e = String(email || '').trim().toLowerCase().slice(0, 120);
  if (mobile && !m) throw err(400, 'Enter a valid 10-digit mobile number.');
  if (e && !EMAIL.test(e)) throw err(400, 'Enter a valid email address.');
  if (!m && !e) throw err(400, "Enter the firm's mobile and email: the invitation and the verification code go there.");
  const tok = crypto.randomBytes(24).toString('base64url');
  const r = await db.tx(async (t) => {
    const f = await t.one('select * from channel_partners where id = $1 for update', [id]);
    if (!f || f.merged_into) throw err(404, 'That firm is not there (it may have been merged into another).');
    if (f.username) throw err(409, `${f.name} is already on the partner portal (${f.cp_code}).`);
    if (f.is_reference) throw err(409, `${f.name} is marked as a reference (direct sale), not a channel partner, so it is not invited.`);
    if ((await openMerge(t.q, [f.id])).length) throw err(409, `${f.name} has a merge waiting for approval. Invite the firm once the merge is approved or rejected.`);
    if (m && await t.one("select 1 from channel_partners where username is not null and id <> $2 and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || $1", [m, f.id])) throw err(409, 'Another firm on the portal already signs in with this mobile number. Check the number.');
    if (m !== TM.mobile(f.phone || '') && m || e && e !== String(f.email || '').toLowerCase()) {
      await t.q('update channel_partners set phone = coalesce(nullif($2, \'\'), phone), email = coalesce(nullif($3, \'\'), email) where id = $1', [f.id, m, e]);
    }
    await t.q('update cp_invites set revoked_at = now() where cp_id = $1 and used_at is null and revoked_at is null', [f.id]);
    const row = await t.one(`insert into cp_invites (cp_id, token_hash, mobile, email, expires_at, created_by) values ($1, $2, $3, $4, now() + interval '${INVITE_DAYS} days', $5) returning id, expires_at`,
      [f.id, CA.sha(tok), m || null, e || null, user.id]);
    await audit.record(t.q, { user, action: 'partner-invite', entity: 'channel-partner', entityId: f.id, before: { phone: f.phone, email: f.email }, after: { phone: m || f.phone, email: e || f.email, invite: row.id } });
    return { f, row };
  });
  const link = `${portalUrl()}/?invite=${tok}`;
  const expires = new Date(r.row.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  let sentTo = '', warning = null;
  try { sentTo = await CA.send({ mobile: m || null, email: e || null }, 'invite', { name: r.f.contact_person || r.f.name, firm: r.f.name, link, expires }, { staff: true }); }
  catch (x) { warning = x.message; }
  if (sentTo === 'test') sentTo = '';
  await db.q('update cp_invites set sent_to = $2 where id = $1', [r.row.id, sentTo || null]);
  return { ok: true, link, expiresAt: r.row.expires_at, sentTo, warning: warning || (sentTo ? null : 'Nothing could be sent (no email or WhatsApp set up). Copy the link and send it to the firm yourself.') };
}
// A live invitation by its token, with its firm (for the portal).
async function inviteByToken(token, q = db.one) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(String(token || ''))) return null;
  return q(`select i.id as invite_id, i.expires_at, c.* from cp_invites i join channel_partners c on c.id = i.cp_id
    where i.token_hash = $1 and i.used_at is null and i.revoked_at is null and i.expires_at > now() and c.username is null and c.merged_into is null`, [CA.sha(token)]);
}

// ---------- merges: asked for by Accounts, approved by the partner approvers ----------
async function mergeApprovers() { return require('./cp-docs').approvers(); }
async function checkGroup(q, intoId, fromIds) {
  const all = [intoId, ...fromIds];
  const rows = await q('select id, name, name_key, username, merged_into, is_reference from channel_partners where id = any($1::int[]) order by id', [all]);
  if (rows.length !== all.length || rows.some((r) => r.merged_into)) throw err(404, 'One of these firms is not there or was already merged.');
  const into = rows.find((r) => r.id === intoId), from = rows.filter((r) => r.id !== intoId);
  const logins = rows.filter((r) => r.username);
  if (logins.length > 1) throw err(409, `${logins.map((r) => r.name).join(' and ')} each have their own portal login, so they cannot be merged. Block the one that should not be used instead.`);
  if (from.some((r) => r.username)) throw err(409, `${from.find((r) => r.username).name} has a portal login: choose it as the firm to keep.`);
  return { into, from, rows };
}
// Contacts from the clean-up sheet (or the merge form): only valid values are kept.
const GST = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function cleanContacts(c = {}) {
  const out = {}, bad = [];
  if (c.contact) out.contact = String(c.contact).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (c.mobile) { const m = TM.mobile(c.mobile); if (m) out.mobile = m; else bad.push(`mobile "${c.mobile}" is not a 10-digit mobile`); }
  if (c.email) { const e = String(c.email).trim().toLowerCase().slice(0, 120); if (EMAIL.test(e)) out.email = e; else bad.push(`email "${c.email}" is not valid`); }
  if (c.rera) { const r = String(c.rera).toUpperCase().replace(/\s/g, ''); if (/^A\d{11}$/.test(r)) out.rera = r; else bad.push(`RERA no. "${c.rera}" does not look like A51800012345`); }
  if (c.gstin) { const g = String(c.gstin).toUpperCase().replace(/\s/g, ''); if (GST.test(g)) out.gstin = g; else bad.push(`GSTIN "${c.gstin}" does not look like 27ABCDE1234F1Z5`); }
  return { contacts: out, bad };
}
// Checks a merge (or, with no fromIds, a rename, contact correction or "this is a reference, not a partner") and
// returns what would be stored.
async function prepare(q, { intoId, fromIds, keepName, contacts, setReference }) {
  intoId = Number(intoId) || 0;
  fromIds = [...new Set((Array.isArray(fromIds) ? fromIds : fromIds ? [fromIds] : []).map(Number).filter((x) => x && x !== intoId))];
  if (!intoId) throw err(400, 'Choose the firm to keep.');
  if (fromIds.length > 25) throw err(400, 'Merge at most 25 firms into one at a time.');
  if (setReference && fromIds.length) throw err(400, 'A reference (direct sale) is never merged.');
  const { into, from, rows } = await checkGroup(q, intoId, fromIds);
  if (rows.some((r) => r.is_reference) && fromIds.length) throw err(409, `${rows.find((r) => r.is_reference).name} is marked as a reference (direct sale), not a channel partner, so it is never merged.`);
  if (setReference && into.username) throw err(409, `${into.name} is on the partner portal, so it cannot be marked as a reference.`);
  const name = setReference ? into.name : String(keepName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw err(400, 'Enter the name to keep.');
  const { contacts: c } = setReference ? { contacts: {} } : cleanContacts(contacts);
  if (!setReference && !fromIds.length && name === into.name && !Object.keys(c).length) throw err(400, 'Nothing to change: choose firms to merge, a new name or new contacts.');
  if ((await openMerge(q, [intoId, ...fromIds])).length) throw err(409, `${[into, ...from].map((f) => f.name).join(' / ')}: already in a request waiting for approval.`);
  const clash = (await q('select id, name from channel_partners where name_key = $1 and not (id = any($2::int[]))', [keyOf(name), [intoId, ...fromIds]]))[0];
  if (clash) throw err(409, `Another firm, ${clash.name} (#${clash.id}), already has the name ${name}. Merge it too, or keep a different name.`);
  return { intoId, fromIds, name, contacts: c, into, from, setReference: !!setReference };
}
async function requestMerge({ intoId, fromIds, keepName, contacts, setReference, note, user, batch = null }) {
  const P = await prepare(db.q, { intoId, fromIds, keepName, contacts, setReference });
  const r = await db.one('insert into cp_merge_requests (into_id, from_ids, keep_name, contacts, set_reference, batch, note, requested_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
    [P.intoId, P.fromIds, P.name, P.contacts, P.setReference, batch, String(note || '').slice(0, 300) || null, user.id]);
  await audit.record(db.q, { user, action: 'partner-merge-request', entity: 'channel-partner', entityId: P.intoId,
    after: { request: r.id, batch, keep: { id: P.intoId, name: P.into.name }, merge: P.from.map((f) => ({ id: f.id, name: f.name })), keepName: P.name, contacts: P.contacts, reference: P.setReference } });
  return { ok: true, id: r.id };
}

// ---------- the clean-up sheet: Accounts corrects the names in Excel and uploads it back ----------
// The layout Accounts already uses (sheets "How to clean", "Clean-up", "Summary"); columns are found by their header.
const SHEET_COLS = ['ERP ID', 'Name in ERP', 'Flats', 'Agreement value (Rs)', 'Brokerage earned (Rs)', 'Paid so far (Rs)', 'Duplicate group', 'Suggested correct name', 'Check this',
  'Correct firm name', 'Keep separate (Y)', 'Contact person', 'Mobile', 'Email', 'RERA no', 'GSTIN', 'Notes'];
const HOW = [['How to clean the channel partner names'],
  ['1. Each row of the Clean-up sheet is one firm as it is in the ERP (ERP ID). Do not change the ERP ID.'],
  ['2. Write the same "Correct firm name" on every row that is the same firm: those rows are merged into one firm with that name (the firm with the most flats is kept, or the one already on the partner portal).'],
  ['3. Leave "Correct firm name" empty to leave a row as it is. Write REFERENCE if it is a reference or direct sale, not a channel partner.'],
  ['4. Put Y in "Keep separate (Y)" for a firm that must never be merged, even if its name looks like another.'],
  ['5. Contact person, Mobile (10 digits), Email, RERA no and GSTIN fill the kept firm\'s details.'],
  ['6. Upload the sheet on the ERP (Accounts > Partner portal). You see what will happen first; the merges then go to Mubeen for approval.']];
async function cleanupSheet() {
  const CP = require('./cp');
  await CP.linkAll();
  const money = {};
  for (const p of await db.q('select distinct u.project_id as id from bookings b join units u on u.id = b.unit_id where b.cp_id is not null and not b.sample')) {
    const L = await CP.ledger(p.id);
    for (const f of L.firms) { const m = (money[f.id] ||= { av: 0, brokerage: 0, paid: 0 }); m.av += f.agreementValue; m.brokerage += f.brokerage; m.paid += f.paid + f.paidBefore; }
  }
  const firms = await db.q(`select c.id, c.name, c.contact_person, c.phone, c.email, c.rera_no, c.gstin, c.username, c.cp_code, c.is_reference,
      (select count(*)::int from bookings b where b.cp_id = c.id and b.status in ('active', 'cancelled') and not b.sample) as flats
    from channel_partners c where c.merged_into is null order by c.name`);
  const groups = duplicateGroups(firms.filter((f) => !f.is_reference));
  const G = {};
  groups.forEach((g, i) => {
    const mem = g.ids.map((id) => firms.find((f) => f.id === id)), top = [...mem].sort((a, b) => Number(!!b.username) - Number(!!a.username) || b.flats - a.flats || a.id - b.id)[0];
    for (const f of mem) G[f.id] = { label: `G${String(i + 1).padStart(3, '0')}`, suggest: top.name.replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ') ').replace(/\s+/g, ' ').trim(), why: g.why.join('; ') };
  });
  const rows = firms.map((f) => { const m = money[f.id] || {}, g = G[f.id];
    return [f.id, f.name, f.flats, Math.round(m.av || 0), Math.round(m.brokerage || 0), Math.round(m.paid || 0), g ? g.label : '', g ? g.suggest : '',
      f.is_reference ? 'Marked as a reference (direct sale)' : g ? 'Possible duplicate: ' + g.why : '', f.is_reference ? 'REFERENCE' : '', '', f.contact_person || '', f.phone || '', f.email || '', f.rera_no || '', f.gstin || '', f.username ? `On the partner portal (${f.cp_code})` : '']; });
  rows.sort((a, b) => (a[6] && b[6] ? a[6].localeCompare(b[6]) : a[6] ? -1 : b[6] ? 1 : 0) || b[2] - a[2] || String(a[1]).localeCompare(String(b[1])));
  const sum = (i) => rows.reduce((s, r) => s + (Number(r[i]) || 0), 0);
  const all = [SHEET_COLS, ...rows, ['', 'Totals', sum(2), sum(3), sum(4), sum(5)]];
  const summary = [['Summary', ''], ['Firms in the ERP', firms.length], ['Possible duplicate groups', groups.length], ['Firms in those groups', groups.reduce((s, g) => s + g.ids.length, 0)], ['Firms on the partner portal', firms.filter((f) => f.username).length], ['Marked as reference', firms.filter((f) => f.is_reference).length]];
  return { sheets: [{ name: 'How to clean', rows: HOW, widths: [140] }, { name: 'Clean-up', rows: all, widths: [8, 36, 7, 16, 16, 14, 10, 32, 40, 32, 10, 22, 13, 26, 15, 17, 30] }, { name: 'Summary', rows: summary, widths: [30, 12] }],
    firms: firms.length, groups: groups.length };
}
// The rows of an uploaded clean-up sheet: the "Clean-up" sheet, else the first sheet with an "ERP ID" header.
function readCleanup(b64, fileName) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (!buf.length) throw err(400, 'The file is empty.');
  if (buf.length > 3 * 1024 * 1024) throw err(400, 'The file is larger than 3 MB.');
  let sheets;
  if (/\.xlsx$/i.test(fileName || '') || buf.slice(0, 2).toString() === 'PK') {
    try { sheets = require('./xlsx').read(buf); } catch { throw err(400, 'This Excel file could not be read. Please save it again as .xlsx.'); }
  } else sheets = [{ name: 'csv', rows: require('./sheetfile').csv(buf.toString('utf8')) }];
  const norm = (rows) => (rows || []).map((r) => Array.from(r || [], (v) => (v == null ? '' : String(v))));
  const hasId = (r) => r.some((v) => /^erp (firm )?id$/i.test(String(v).trim()));
  const pick = sheets.find((s) => /^clean[\s-]*up$/i.test(String(s.name || '').trim()) && norm(s.rows).slice(0, 10).some(hasId)) || sheets.find((s) => norm(s.rows).slice(0, 10).some(hasId));
  if (!pick) throw err(400, 'This is not the clean-up sheet: no sheet has an "ERP ID" column. Download the sheet from the ERP and fill it in.');
  const rows = norm(pick.rows), at = rows.findIndex(hasId);
  return rows.slice(at).filter((r) => r.some((v) => String(v).trim()));
}
// What an uploaded clean-up sheet would do: merges (rows with the same "Correct firm name"), renames, contact
// corrections, references, and what is refused. Nothing is changed here.
async function cleanupPreview(sheet) {
  if (!Array.isArray(sheet) || sheet.length < 2) throw err(400, 'The sheet has no rows under the header row.');
  const h = sheet[0].map((x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '));
  const at = (...names) => { for (const nm of names) { const i = h.indexOf(nm.toLowerCase()); if (i >= 0) return i; } return -1; };
  const ci = { id: at('ERP ID', 'ERP firm ID'), name: at('Correct firm name'), sep: at('Keep separate (Y)', 'Keep separate'), contact: at('Contact person'), mobile: at('Mobile', 'New mobile'),
    email: at('Email', 'New email'), rera: at('RERA no', 'RERA no.', 'New RERA no'), gstin: at('GSTIN') };
  if (ci.id < 0 || ci.name < 0) throw err(400, 'This is not the clean-up sheet: the columns "ERP ID" and "Correct firm name" are needed.');
  const cell = (r, k) => (ci[k] >= 0 ? String(r[ci[k]] == null ? '' : r[ci[k]]).replace(/\s+/g, ' ').trim() : '');
  const isId = (v) => /^\d+(\.0+)?$/.test(v);
  const ids = sheet.slice(1).map((r) => cell(r, 'id')).filter(isId).map(Number);
  const F = Object.fromEntries((await db.q(`select c.id, c.name, c.name_key, c.username, c.cp_code, c.merged_into, c.is_reference, c.contact_person, c.phone, c.email, c.rera_no, c.gstin,
      (select count(*)::int from bookings b where b.cp_id = c.id and b.status in ('active', 'cancelled') and not b.sample) as flats,
      (select r.id from cp_merge_requests r where r.status = 'pending' and (r.into_id = c.id or c.id = any(r.from_ids)) limit 1) as open_request
    from channel_partners c where c.id = any($1::int[])`, [ids])).map((f) => [f.id, f]));
  const refused = [], seen = new Set(), items = [], references = [];
  sheet.slice(1).forEach((r, i) => {
    const rowNo = i + 2, raw = cell(r, 'id');
    if (!isId(raw)) return; // the Totals row, notes, blank rows
    const id = Number(raw), f = F[id];
    if (!f) { refused.push({ row: rowNo, id: raw, reason: 'No firm with this ERP ID.' }); return; }
    if (f.merged_into) { refused.push({ row: rowNo, id, name: f.name, reason: `Already merged into firm #${f.merged_into}.` }); return; }
    if (seen.has(id)) { refused.push({ row: rowNo, id, name: f.name, reason: 'This firm is on the sheet twice; only the first row is used.' }); return; }
    seen.add(id);
    const name = cell(r, 'name').slice(0, 120);
    if (!name) return; // empty "Correct firm name": the row stays as it is
    if (/^reference$/i.test(name)) {
      if (f.is_reference) return;
      if (f.username) { refused.push({ row: rowNo, id, name: f.name, reason: 'This firm is on the partner portal, so it cannot be a reference.' }); return; }
      if (f.open_request) { refused.push({ row: rowNo, id, name: f.name, reason: `Already in request #${f.open_request}, waiting for approval.` }); return; }
      references.push({ row: rowNo, id, name: f.name, flats: f.flats }); return;
    }
    if (f.is_reference) { refused.push({ row: rowNo, id, name: f.name, reason: 'Marked as a reference (direct sale) in the ERP, so it is never merged or renamed here.' }); return; }
    const { contacts, bad } = cleanContacts({ contact: cell(r, 'contact'), mobile: cell(r, 'mobile'), email: cell(r, 'email'), rera: cell(r, 'rera'), gstin: cell(r, 'gstin') });
    for (const b of bad) refused.push({ row: rowNo, id, name: f.name, reason: `Not used: ${b}.` });
    items.push({ row: rowNo, f, name, sep: /^y/i.test(cell(r, 'sep')), contacts });
  });
  // groups: the same correct name (as the ERP compares names) merge; "keep separate" rows never do
  const groups = new Map();
  // the same name typed with other spacing, dots or capitals ("S K Realtors" / "s.k. realtors") is the same correct name
  const loose = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  for (const it of items) { const key = it.sep ? 'f:' + it.f.id : 'n:' + loose(it.name); (groups.get(key) || groups.set(key, []).get(key)).push(it); }
  const plan = [];
  for (const g of groups.values()) {
    const logins = g.filter((x) => x.f.username);
    if (logins.length > 1) { refused.push({ row: g.map((x) => x.row).join(', '), name: g.map((x) => x.f.name).join(' / '), reason: `${logins.map((x) => x.f.name).join(' and ')} each have a portal login, so they cannot be merged. Mark one "Keep separate".` }); continue; }
    const keep = logins[0] || [...g].sort((a, b) => b.f.flats - a.f.flats || a.f.id - b.f.id)[0];
    const others = g.filter((x) => x !== keep);
    const name = keep.name;
    const cur = { contact: keep.f.contact_person || '', mobile: TM.mobile(keep.f.phone || ''), email: String(keep.f.email || '').toLowerCase(), rera: keep.f.rera_no || '', gstin: keep.f.gstin || '' };
    const contacts = {};
    for (const k of Object.keys(cur)) { const v = [keep, ...others].map((x) => x.contacts[k]).find(Boolean); if (v && v !== cur[k]) contacts[k] = v; }
    if (!others.length && name === keep.f.name && !Object.keys(contacts).length) continue; // nothing to change
    const busy = g.find((x) => x.f.open_request);
    if (busy) { refused.push({ row: g.map((x) => x.row).join(', '), name: busy.f.name, reason: `Already in request #${busy.f.open_request}, waiting for approval.` }); continue; }
    plan.push({ rows: g.map((x) => x.row), keep: { id: keep.f.id, name: keep.f.name, flats: keep.f.flats, onPortal: !!keep.f.username }, merge: others.map((x) => ({ id: x.f.id, name: x.f.name, flats: x.f.flats })),
      keepName: name, rename: name !== keep.f.name, contacts });
  }
  // a kept name that another firm (not in the group) already has
  const ok = [], keys = new Set();
  for (const p of plan) {
    const k = keyOf(p.keepName), mine = [p.keep.id, ...p.merge.map((x) => x.id)];
    if (keys.has(k)) { refused.push({ row: p.rows.join(', '), name: p.keepName, reason: `Two groups on the sheet get the name ${p.keepName} (one is marked "Keep separate"). Use different names, or let them merge.` }); continue; }
    const clash = await db.one('select id, name from channel_partners where name_key = $1 and not (id = any($2::int[]))', [k, mine]);
    if (clash) { refused.push({ row: p.rows.join(', '), name: p.keepName, reason: `Another firm, ${clash.name} (#${clash.id}), already has this name. Put it on the sheet with the same correct name to merge it, or use a different name.` }); continue; }
    keys.add(k); ok.push(p);
  }
  return { plan: ok, references, refused, merges: ok.filter((p) => p.merge.length).length, merged: ok.reduce((s, p) => s + p.merge.length, 0), renames: ok.filter((p) => p.rename).length,
    contactFixes: ok.filter((p) => Object.keys(p.contacts).length).length, rows: seen.size };
}
async function cleanupSubmit(sheet, user, fileName) {
  const pv = await cleanupPreview(sheet);
  if (!pv.plan.length && !pv.references.length) throw err(400, 'Nothing to send: the sheet asks for no merges, renames, contact changes or references.');
  const batch = 'S' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  const made = [], failed = [], note = (p) => `Clean-up sheet ${fileName || ''} row${p.length > 1 ? 's' : ''} ${p.join(', ')}`.replace(/\s+/g, ' ');
  for (const p of pv.plan) {
    try { made.push((await requestMerge({ intoId: p.keep.id, fromIds: p.merge.map((x) => x.id), keepName: p.keepName, contacts: p.contacts, note: note(p.rows), user, batch })).id); }
    catch (e) { failed.push({ name: p.keepName, reason: e.message }); }
  }
  for (const r of pv.references) {
    try { made.push((await requestMerge({ intoId: r.id, setReference: true, note: note([r.row]), user, batch })).id); }
    catch (e) { failed.push({ name: r.name, reason: e.message }); }
  }
  await audit.record(db.q, { user, action: 'partner-cleanup-sheet', entity: 'channel-partner', entityId: batch, after: { requests: made, failed, refused: pv.refused.length }, note: fileName || null });
  return { batch, requests: made, failed, refused: pv.refused };
}
// The approver decides a whole batch at once (each request in its own transaction, so one that no longer fits does
// not stop the others).
async function decideBatch({ batch, approve, reason, user }) {
  const ids = (await db.q("select id from cp_merge_requests where batch = $1 and status = 'pending' order by id", [String(batch || '')])).map((r) => r.id);
  if (!ids.length) throw err(404, 'Nothing in this batch is waiting for approval.');
  const done = [], failed = [];
  for (const id of ids) { try { await decideMerge({ id, approve, reason, user }); done.push(id); } catch (e) { if (e.status === 403) throw e; failed.push({ id, reason: e.message }); } }
  return { ok: true, done, failed };
}
async function merges(status) {
  const rows = await db.q(`select r.*, a.name as requested_name, d.name as decided_name from cp_merge_requests r left join users a on a.id = r.requested_by left join users d on d.id = r.decided_by
    where ($1::text is null or r.status = $1) order by r.status = 'pending' desc, r.id desc limit 200`, [status || null]);
  for (const r of rows) r.from_ids = ints(r.from_ids);
  const ids = [...new Set(rows.flatMap((r) => [r.into_id, ...r.from_ids]))];
  const F = Object.fromEntries((await db.q(`select c.id, c.name, c.cp_code, c.username is not null as on_portal,
      (select count(*)::int from bookings b where b.cp_id = c.id and not b.sample) as bookings,
      (select count(*)::int from brokerage_entries e where e.cp_id = c.id and e.cancelled_at is null) as entries from channel_partners c where c.id = any($1::int[])`, [ids])).map((f) => [f.id, f]));
  return rows.map((r) => ({ id: r.id, status: r.status, keepName: r.keep_name, contacts: r.contacts, reference: r.set_reference, batch: r.batch, note: r.note, into: F[r.into_id], from: r.from_ids.map((x) => F[x]), requestedBy: r.requested_by, requestedName: r.requested_name, requestedAt: r.requested_at,
    decidedName: r.decided_name, decidedAt: r.decided_at, reason: r.reason, result: r.result }));
}
async function canApproveMerge(user, req) {
  if (user.role === 'admin') return true;
  if (req && req.requested_by === user.id) throw err(403, 'You asked for this merge, so someone else approves it.');
  const who = await mergeApprovers();
  if (!who.includes(user.id)) { const nm = (await db.q('select name from users where id = any($1::int[])', [who])).map((x) => x.name).join(', '); throw err(403, `Merges are approved by ${nm || 'the partner approvers in Partner settings'}.`); }
  return true;
}
async function decideMerge({ id, approve, reason, user }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (!approve && !why) throw err(400, 'Give the reason for rejecting the merge.');
  // who may decide, checked first: the database connection is not free again until the transaction ends
  const first = await db.one('select * from cp_merge_requests where id = $1', [id]);
  if (!first) throw err(404, 'That merge request is not there.');
  if (first.status !== 'pending') throw err(409, 'This merge request was already decided.');
  await canApproveMerge(user, first);
  return db.tx(async (t) => {
    const req = await t.one('select * from cp_merge_requests where id = $1 for update', [id]);
    if (!req || req.status !== 'pending') throw err(409, 'This merge request was already decided.');
    if (!approve) {
      await t.q("update cp_merge_requests set status = 'rejected', decided_by = $2, decided_at = now(), reason = $3 where id = $1", [id, user.id, why]);
      await audit.record(t.q, { user, action: 'partner-merge-rejected', entity: 'channel-partner', entityId: req.into_id, after: { request: id }, note: why });
      return { ok: true, status: 'rejected' };
    }
    const result = await applyMerge(t, req, user);
    await t.q("update cp_merge_requests set status = 'approved', decided_by = $2, decided_at = now(), reason = $3, result = $4 where id = $1", [id, user.id, why || null, result]);
    return { ok: true, status: 'approved', result };
  });
}
async function cancelMerge({ id, user }) {
  const r = await db.one("update cp_merge_requests set status = 'cancelled', decided_by = $2, decided_at = now() where id = $1 and status = 'pending' and (requested_by = $2 or $3) returning id, into_id", [id, user.id, user.role === 'admin']);
  if (!r) throw err(409, 'Only a pending request can be withdrawn, by the person who asked for it.');
  await audit.record(db.q, { user, action: 'partner-merge-cancelled', entity: 'channel-partner', entityId: r.into_id, after: { request: id } });
  return { ok: true };
}
// The merge itself, inside the approving transaction: every row that points at a merged firm (bookings, brokerage
// entries, documents, telecalling data, bills, invitations…) is pointed at the kept firm; the merged firms stay as
// inactive rows with merged_into, and their spellings become aliases of the kept firm.
async function applyMerge(t, req, user) {
  const intoId = req.into_id, fromIds = ints(req.from_ids);
  await t.q('select id from channel_partners where id = any($1::int[]) order by id for update', [[intoId, ...fromIds]]);
  const { into, from } = await checkGroup(t.q, intoId, fromIds);
  const before = await t.q('select * from channel_partners where id = any($1::int[])', [[intoId, ...fromIds]]);
  const moved = {};
  await t.q('update cp_invites set revoked_at = now() where cp_id = any($1::int[]) and used_at is null and revoked_at is null', [fromIds]);
  await t.q('delete from cp_sessions where cp_id = any($1::int[])', [fromIds]);
  const fks = await t.q(`select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'channel_partners'::regclass and c.conrelid not in ('channel_partners'::regclass, 'cp_merge_requests'::regclass) order by 1, 2`);
  for (const { tbl, col } of fks) {
    if (!/^[a-z_][a-z0-9_.]*$/.test(tbl) || !/^[a-z_][a-z0-9_]*$/.test(col)) continue;
    const r = await t.q(`update ${tbl} set ${col} = $1 where ${col} = any($2::int[]) returning 1`, [intoId, fromIds]);
    if (r.length) moved[`${tbl}.${col}`] = r.length;
  }
  const name = req.keep_name, k = keyOf(name);
  // the merged firms: kept as inactive rows pointing at the kept firm; their spellings map to it from now on
  for (const f of from) {
    await t.q('insert into cp_name_aliases (name_key, cp_id) values ($1, $2) on conflict (name_key) do update set cp_id = excluded.cp_id', [f.name_key, intoId]);
    await t.q(`update channel_partners set name_key = $2, active = false, merged_into = $3, merged_at = now(), merged_by = $4,
      note = concat_ws(E'\\n', note, $5::text) where id = $1`, [f.id, `${f.name_key} [merged into #${intoId}]`, intoId, user.id, `Merged into ${name} (#${intoId}), request #${req.id}.`]);
  }
  await t.q('update channel_partners set merged_into = $1 where merged_into = any($2::int[])', [intoId, fromIds]);
  // details the kept firm lacks, from the merged ones
  for (const c of ['contact_person', 'phone', 'email', 'pan', 'gstin', 'rera_no', 'default_pct']) {
    await t.q(`update channel_partners k set ${c} = (select f.${c} from channel_partners f where f.id = any($2::int[]) and f.${c} is not null order by f.id limit 1) where k.id = $1 and k.${c} is null`, [intoId, fromIds]);
  }
  if (k !== into.name_key) {
    const clash = await t.one('select id, name from channel_partners where name_key = $1 and id <> $2', [k, intoId]);
    if (clash) throw err(409, `Another firm, ${clash.name}, already has the name ${name}.`);
    await t.q('insert into cp_name_aliases (name_key, cp_id) values ($1, $2) on conflict (name_key) do update set cp_id = excluded.cp_id', [into.name_key, intoId]);
  }
  await t.q('delete from cp_name_aliases where name_key = $1', [k]);
  const c = req.contacts || {};
  await t.q(`update channel_partners set name = $2, name_key = $3, phone = coalesce($4, phone), email = coalesce($5, email), rera_no = coalesce($6, rera_no),
      contact_person = coalesce($7, contact_person), gstin = coalesce($8, gstin), is_reference = is_reference or $9 where id = $1`,
    [intoId, name, k, c.mobile || null, c.email || null, c.rera || null, c.contact || null, c.gstin || null, !!req.set_reference]);
  if (req.set_reference) await t.q('update cp_invites set revoked_at = now() where cp_id = $1 and used_at is null and revoked_at is null', [intoId]);
  await t.q('update bookings set cp_name = $2 where cp_id = $1', [intoId, name]);
  const result = { kept: { id: intoId, name, was: into.name }, merged: from.map((f) => ({ id: f.id, name: f.name })), moved, contacts: c, reference: !!req.set_reference };
  await audit.record(t.q, { user, action: 'partner-merge', entity: 'channel-partner', entityId: intoId,
    before: { firms: before.map(({ pw_hash, ...r }) => r) }, after: { request: req.id, requestedBy: req.requested_by, ...result } });
  return result;
}

module.exports = { INVITE_DAYS, SHEET_COLS, core, matchKeys, duplicateGroups, firmsList, invite, inviteByToken, requestMerge, merges, decideMerge, decideBatch, cancelMerge, canApproveMerge, mergeApprovers, cleanupSheet, readCleanup, cleanupPreview, cleanupSubmit, portalUrl };
