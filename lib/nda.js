// Staff NDA: a confidentiality agreement every staff login accepts once, at sign-in (Admin excepted).
// The person reads it to the end, ticks "I have read and agree" and types their initials; the ERP keeps who, when,
// from which device and address, and a fingerprint of the exact text agreed. A new text is a new version, and
// everyone signs again. Off until the Admin switches it on (settings.nda = { on }).
const crypto = require('crypto');
const db = require('./db');

const TITLE = 'Confidentiality and Non-Disclosure Agreement';
// Draft for the company lawyer to review; the Admin can replace it (a new version) from Logins.
const BODY = `This agreement is between Dream India Realty, together with every entity owned and operated by Dream India Realty (together, "Dream India" or "the Company"), and you, the employee, consultant or other person given a login to the Company's systems ("you").

1. Why this agreement
In your work you will see information that belongs to the Company and to its customers. This agreement sets out how you must protect it. It applies from the moment you accept it and continues after your work with the Company ends.

2. What is confidential
"Confidential Information" means any information you see, receive or create in your work that is not public, in any form (on screen, on paper, by email, WhatsApp, voice or otherwise). It includes:
(a) Customer data: names, phone numbers, email and postal addresses, PAN, Aadhaar and other ID details, bank details, flats booked, agreement values, payments, dues, cheques, loans, letters, documents, call notes and messages;
(b) Company information: prices, price lists, cost sheets, inventory, sales figures, collections, accounts, bank details, budgets, contracts, vendor and contractor terms, channel partner details and brokerage, land and project information, drawings, approvals, plans and strategies;
(c) Staff information: salaries, HR records and personal details of other staff;
(d) Logins and system information: usernames, passwords, sign-in codes, reports, exports and the contents of the ERP, the HR portal, DreamComm and any other Company system.

3. What you must do
(a) Use Confidential Information only to do your job for the Company.
(b) Keep it secure. Do not leave screens, papers or devices open where others can see them.
(c) Share it inside the Company only with people who need it for their work, and outside the Company only when your manager or the Company has authorised it in writing.
(d) Tell your manager or the Admin at once if you think any Confidential Information has been lost, seen by someone who should not see it, or misused, including by mistake.

4. What you must not do
(a) Do not copy, photograph, screenshot, download, print, forward or export Confidential Information except as your work requires.
(b) Do not send it to your personal email, personal WhatsApp, personal cloud storage or any device or account not approved by the Company.
(c) Do not share customer data with anyone outside the Company, including channel partners, brokers, other developers, lenders or family, unless the Company has authorised it.
(d) Do not contact the Company's customers for any purpose other than the Company's work, during or after your work with the Company.
(e) Do not share your login, password or sign-in codes with anyone, or use anyone else's login.

5. When your work ends
When you leave, or when the Company asks, you must return or delete all Confidential Information in your possession, including on personal phones and computers, and keep none of it. Your duties under this agreement continue after you leave, for as long as the information remains confidential.

6. Exceptions
This agreement does not cover information that is already public through no fault of yours, or that you must disclose by law or by an order of a court or authority. In that case, tell the Company first if the law allows it, and disclose only what is required.

7. Monitoring
You understand that the Company's systems record logins, views, changes, downloads and messages, and that the Company may review these records to protect its information and its customers.

8. Breach
A breach of this agreement may lead to disciplinary action, up to and including termination, and the Company may take legal action to stop the breach and recover any loss, in addition to any other remedy available under law, including the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.

9. General
This agreement is governed by the laws of India, and the courts at Mumbai have jurisdiction. It is accepted electronically: by ticking the box and typing your initials after signing in with your own login, you agree to be bound by it, the same as signing it on paper.`;

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
let cache = null; // { at, on, cur }
async function settings() {
  if (cache && Date.now() - cache.at < 30000) return cache;
  const s = await db.one("select value from settings where key = 'nda'");
  let on = false; try { const v = s ? s.value : {}; on = !!(typeof v === 'string' ? JSON.parse(v) : v).on; } catch {}
  let cur = await db.one('select version, title, body, created_at from nda_versions order by version desc limit 1');
  if (!cur) {
    await db.q('insert into nda_versions (version, title, body) values (1, $1, $2) on conflict (version) do nothing', [TITLE, BODY]);
    cur = await db.one('select version, title, body, created_at from nda_versions order by version desc limit 1');
  }
  cache = { at: Date.now(), on, cur };
  return cache;
}
const reset = () => { cache = null; };

// The NDA this login still has to sign, or null (off, Admin, or already signed).
async function pending(u) {
  if (!u || u.role === 'admin') return null;
  const S = await settings();
  if (!S.on) return null;
  const done = await db.one('select 1 from nda_signatures where user_id = $1 and version = $2', [u.id, S.cur.version]);
  return done ? null : { version: S.cur.version, title: S.cur.title, body: S.cur.body };
}

const initialsOk = (v) => /^[A-Za-z][A-Za-z. ]{0,10}$/.test(v) && v.replace(/[^A-Za-z]/g, '').length >= 2 && v.replace(/[^A-Za-z]/g, '').length <= 6;
async function sign(u, b, req) {
  const S = await settings();
  if (+b.version !== S.cur.version) throw Object.assign(new Error('The agreement was updated. Please read the new version.'), { status: 409 });
  if (b.agree !== true) throw Object.assign(new Error('Tick "I have read and agree" first.'), { status: 400 });
  if (b.readToEnd !== true) throw Object.assign(new Error('Please read the agreement to the end first.'), { status: 400 });
  const initials = String(b.initials || '').trim().toUpperCase();
  if (!initialsOk(initials)) throw Object.assign(new Error('Type your initials: 2 to 6 letters, for example R K.'), { status: 400 });
  const ip = String((req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]) || '').trim().slice(0, 64) || null;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  await db.q(`insert into nda_signatures (user_id, version, name, username, initials, ip, user_agent, text_sha)
    values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (user_id, version) do nothing`,
  [u.id, S.cur.version, u.name, u.username, initials, ip, ua, sha(S.cur.title + '\n' + S.cur.body)]);
  await require('./audit').record(db.q, { user: u, action: 'nda-sign', entity: 'nda', entityId: String(S.cur.version), note: `Accepted "${S.cur.title}" version ${S.cur.version}, initials ${initials}` });
  return { ok: true };
}

// Admin: the switch, the current text, and who has signed it and who has not.
async function status() {
  const S = await settings();
  const users = await db.q(`select u.id, u.name, u.username, u.role, s.signed_at, s.initials
    from users u left join nda_signatures s on s.user_id = u.id and s.version = $1
    where not u.disabled and u.role <> 'admin' order by s.signed_at is not null, u.name`, [S.cur.version]);
  return { on: S.on, version: S.cur.version, title: S.cur.title, body: S.cur.body, since: S.cur.created_at,
    signed: users.filter((x) => x.signed_at).length, total: users.length, users };
}
async function save(me, b) {
  const S = await settings();
  if (typeof b.on === 'boolean') {
    await db.q("insert into settings (key, value) values ('nda', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ on: b.on })]); reset();
    await require('./audit').record(db.q, { user: me, action: 'nda-switch', entity: 'nda', entityId: String(S.cur.version), note: b.on ? 'NDA at sign-in switched ON' : 'NDA at sign-in switched OFF' });
  }
  const title = String(b.title || '').trim().slice(0, 150), body = String(b.body || '').trim().slice(0, 40000);
  if (body && (body !== S.cur.body || (title && title !== S.cur.title))) {
    if (body.length < 200) throw Object.assign(new Error('The agreement text looks too short.'), { status: 400 });
    await db.q('insert into nda_versions (version, title, body, created_by) values ($1, $2, $3, $4)', [S.cur.version + 1, title || S.cur.title, body, me.id]);
    await require('./audit').record(db.q, { user: me, action: 'nda-version', entity: 'nda', entityId: String(S.cur.version + 1), note: 'New NDA text: everyone signs again' });
  }
  reset();
  return status();
}
// One signed copy, for printing
async function copy(userId, version) {
  const s = await db.one(`select s.*, v.title, v.body from nda_signatures s join nda_versions v on v.version = s.version
    where s.user_id = $1 and ($2::int is null or s.version = $2) order by s.version desc limit 1`, [userId, version || null]);
  return s || null;
}

module.exports = { pending, sign, status, save, copy, reset, TITLE, BODY, sha };
