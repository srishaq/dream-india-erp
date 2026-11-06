// Partner portal (/partner): channel partner firms register (username, password, firm details, mobile verified by OTP),
// get a CP ID, upload client lists for the launches that are open, and see only their own clients, masked.
// GET  ?me=1 · ?invite=TOKEN · ?home=1 · ?leads=1[&project=ID&q=…] · ?issues=UPLOAD_ID · ?docs=1 · ?bookings=1 · ?bills=1
// POST {action}: register-start · register-verify · invite-start · invite-verify · login · logout · forgot-start · forgot-verify ·
//      parse · upload · doc-upload · agreement-sign · bill-start · bill-part · bill-finish · profile · password
// Every signed-in request is scoped to the signed-in firm (c.id). Bookings & brokerage and bills: approved firms only,
// and never anything about a buyer (lib/cp.js firmView keeps buyer fields out at the source).
const db = require('../lib/db');
const audit = require('../lib/audit');
const { parseFile } = require('../lib/sheetfile');
const TM = require('../lib/tm');
const CA = require('../lib/cp-auth');
const CF = require('../lib/cp-firms');
const CB = require('../lib/cp-bills');
const RL = require('../lib/mkt-rate');
const { route, fail, str, intOr } = require('../lib/http');

const AREAS = ['Jogeshwari West', 'Jogeshwari East', 'Andheri West', 'Oshiwara', 'Lokhandwala', 'Versova', 'Andheri East', 'Goregaon West', 'Goregaon East',
  'Malad West', 'Malad East', 'Kandivali', 'Borivali', 'Bandra', 'Santacruz', 'Vile Parle', 'Mira Road', 'Kurla', 'South Mumbai', 'Thane', 'Navi Mumbai', 'Other'];
const keyOf = (name) => String(name || '').replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '').toLowerCase();
const statusLabel = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', blocked: 'Blocked' };
const partnerStatus = (s) => ({ fresh: 'Not yet called', history: 'Not yet called', interested: 'In discussion', callback: 'In discussion', visit: 'Site visit booked', booked: 'Booked', not_reachable: 'Not reachable yet' })[s] || 'Not interested / closed';

function profile(c) {
  return { cpId: c.id, cpCode: c.cp_code, username: c.username, firm: c.name, address: c.office_address, area: c.office_area, contact: c.contact_person,
    designation: c.designation, mobile: TM.mask(c.phone), alt: c.alt_phone, email: CA.maskEmail(c.email), rera: c.rera_no, callers: c.callers_in_team,
    status: statusLabel[c.portal_status] || 'Pending review', approved: c.portal_status === 'approved', registeredOn: TM.iso(c.registered_at) };
}
async function need(req) { const c = await CA.session(req); if (!c) throw fail(401, 'Please sign in.'); return c; }
const approved = (c) => { if (c.portal_status !== 'approved') throw fail(403, 'This opens once Dream India has approved your account.'); };
const goneInvite = () => fail(404, 'This invitation link has expired or was already used. Please ask the Dream India office for a new one.');
// The firm's details the invited partner confirms (the rest is already in the ERP).
function inviteFields(b, f) {
  const x = { username: str(b.username, 40).toLowerCase(), contact: str(b.contact, 80) || f.contact_person || '', designation: str(b.designation, 60), address: str(b.address, 250) || f.office_address || '',
    area: str(b.area, 60) || f.office_area || '', callers: intOr(b.callers), rera: (str(b.rera, 30) || f.rera_no || '').toUpperCase().replace(/\s/g, ''), alt: str(b.alt, 20) };
  if (!/^[a-z0-9._]{4,30}$/.test(x.username)) throw fail(400, 'Username must be 4 to 30 letters, numbers, dots or underscores.');
  const pp = CA.passwordProblem(b.password); if (pp) throw fail(400, 'Password: ' + pp);
  for (const [k, l] of [['contact', 'the point of contact'], ['address', 'the office address'], ['area', 'the office area']]) if (!x[k]) throw fail(400, `Please fill in ${l}.`);
  if (!/^A\d{11}$/.test(x.rera)) throw fail(400, 'MahaRERA agent registration numbers look like A51800012345. Please check the number.');
  if (!b.agree) throw fail(400, 'Please accept the partner terms.');
  return x;
}
const findBy = (who) => {
  const w = str(who, 80).toLowerCase(), m = TM.mobile(w);
  return db.one(`select * from channel_partners where username is not null and (lower(username) = $1 or lower(cp_code) = $1 or ($2 <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || $2)) order by id limit 1`, [w, m]);
};

module.exports = route({
  GET: async (req, res) => {
    const Q = req.query || {};
    if (Q.me) { const c = await CA.session(req); return res.json(c ? { signedIn: true, profile: profile(c) } : { signedIn: false, areas: AREAS }); }
    if (Q.invite) {
      if (!(await RL.allow('invite-ip', CA.ipOf(req), 60))) throw fail(429, 'Too many tries. Please wait an hour.');
      const f = await CF.inviteByToken(Q.invite); if (!f) throw goneInvite();
      return res.json({ firm: f.name, contact: f.contact_person, mobile: TM.mask(TM.mobile(f.phone || '')), email: CA.maskEmail(f.email), rera: f.rera_no, address: f.office_address, area: f.office_area, expires: f.expires_at, areas: AREAS });
    }
    const c = await need(req);
    if (Q.home) {
      const st = await db.q('select status, count(*)::int as n, count(*) filter (where owner_until >= $2::date)::int as active from tm_leads where cp_id = $1 group by status', [c.id, TM.istToday()]);
      const status = {}; let leads = 0, active = 0;
      for (const r of st) { const k = partnerStatus(r.status); status[k] = (status[k] || 0) + r.n; leads += r.n; active += r.active; }
      const uploads = await db.q(`select u.id, u.created_at, u.file_name, u.received, u.accepted, p.name as project from tm_uploads u join tm_projects p on p.id = u.tm_project_id
        where u.cp_id = $1 order by u.id desc limit 50`, [c.id]);
      const bk = await db.one("select count(*)::int as c from bookings where cp_id = $1 and status = 'active'", [c.id]);
      const projects = (await TM.openProjects()).map((p) => ({ id: p.id, name: p.name, location: p.location, rera: p.rera_no, until: TM.iso(p.upload_until) }));
      const docs = await require('../lib/cp-docs').status(c.id);
      return res.json({ docs, profile: profile(c), projects, stats: { leads, active, uploads: uploads.length, bookings: bk.c, status },
        uploads: uploads.map((u) => ({ id: u.id, at: u.created_at, file: u.file_name, received: u.received, accepted: u.accepted, project: u.project })), areas: AREAS, consent: { text: TM.CONSENT_TEXT, version: TM.CONSENT_VERSION }, maxRows: Math.min(TM.MAX_ROWS, +(await TM.settings()).partnerDailyRows || TM.PARTNER_DAILY_ROWS) });
    }
    if (Q.docs) { const D2 = require('../lib/cp-docs'); const text = await D2.agreementText(); return res.json({ ...(await D2.status(c.id)), agreement: text, fingerprint: D2.fingerprint(text), rera: c.rera_no, pan: c.pan, gstin: c.gstin }); }
    if (Q.bookings) { approved(c); return res.json(await require('../lib/cp').firmView(c.id)); }
    if (Q.bills) { approved(c); return res.json(await CB.mine(c.id)); }
    if (Q.leads) {
      const q = str(Q.q, 40).toLowerCase(), pid = intOr(Q.project);
      const rows = await db.q(`select l.id, l.name, l.mobile, l.config, l.locality, l.uploaded_on, l.owner_until, l.status, p.name as project
        from tm_leads l join tm_projects p on p.id = l.tm_project_id where l.cp_id = $1 and ($2::int is null or l.tm_project_id = $2)
          and ($3 = '' or lower(coalesce(l.name, '')) like '%' || $3 || '%' or right(l.mobile, 4) = $3) order by l.id desc limit 2000`, [c.id, pid, q]);
      return res.json({ rows: rows.map((r) => ({ id: r.id, name: r.name, mobile: TM.mask(r.mobile), config: r.config, locality: r.locality, project: r.project,
        uploadedOn: TM.iso(r.uploaded_on), ownerUntil: TM.iso(r.owner_until), status: partnerStatus(r.status) })) });
    }
    if (Q.issues) {
      const rows = await db.q(`select i.row_no, i.name, i.mobile, i.reason from tm_upload_issues i join tm_uploads u on u.id = i.upload_id where u.id = $1 and u.cp_id = $2 order by i.row_no`, [intOr(Q.issues), c.id]);
      return res.json({ rows: rows.map((r) => ({ row: r.row_no, name: r.name, mobile: TM.mask(r.mobile), reason: TM.partnerReason(r.reason) })) });
    }
    throw fail(400, 'Unknown request.');
  },

  POST: async (req, res, b) => {
    const a = b.action;
    if (a === 'register-start') {
      const f = {
        username: str(b.username, 40).toLowerCase(), firm: str(b.firm, 120), rera: str(b.rera, 30).toUpperCase().replace(/\s/g, ''), address: str(b.address, 250),
        area: str(b.area, 60), callers: intOr(b.callers), contact: str(b.contact, 80), designation: str(b.designation, 60), mobile: TM.mobile(b.mobile),
        alt: str(b.alt, 20), email: str(b.email, 120).toLowerCase(),
      };
      if (!/^[a-z0-9._]{4,30}$/.test(f.username)) throw fail(400, 'Username must be 4 to 30 letters, numbers, dots or underscores.');
      const pp = CA.passwordProblem(b.password); if (pp) throw fail(400, 'Password: ' + pp);
      for (const [k, l] of [['firm', 'the firm name'], ['address', 'the office address'], ['area', 'the office area'], ['contact', 'the point of contact']]) if (!f[k]) throw fail(400, `Please fill in ${l}.`);
      if (!/^A\d{11}$/.test(f.rera)) throw fail(400, 'MahaRERA agent registration numbers look like A51800012345. Please check the number.');
      if (!f.mobile) throw fail(400, 'Enter a valid 10-digit mobile number.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw fail(400, 'Enter a valid email address.');
      if (!b.agree) throw fail(400, 'Please accept the partner terms.');
      if (await db.one('select 1 from channel_partners where lower(username) = $1', [f.username])) throw fail(409, 'This username is taken. Please choose another.');
      if (await db.one("select 1 from channel_partners where username is not null and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || $1", [f.mobile])) throw fail(409, 'This mobile number is already registered. Please sign in or reset your password.');
      if (await db.one('select 1 from channel_partners where username is not null and upper(rera_no) = $1', [f.rera])) throw fail(409, 'This MahaRERA number is already registered. Please sign in or contact the Dream India office.');
      const ex = await db.one('select username from channel_partners where name_key = $1', [keyOf(f.firm)]);
      if (ex && ex.username) throw fail(409, 'A firm with this name is already registered. Please sign in or contact the Dream India office.');
      const r = await CA.newCode({ purpose: 'register', mobile: f.mobile, email: f.email, ip: CA.ipOf(req), payload: { ...f, pwHash: CA.hash(b.password) } });
      return res.json(r);
    }
    if (a === 'register-verify') {
      const code = await CA.checkCode(b.token, 'register', b.otp);
      const f = code.payload;
      const S = await TM.settings();
      const status = 'pending'; // approved by hand once PAN, GST, MahaRERA certificate and the agreement are in
      const cp = await db.tx(async (t) => {
        if (await t.one('select 1 from channel_partners where lower(username) = $1', [f.username])) throw fail(409, 'This account already exists. Please sign in.');
        const k = keyOf(f.firm);
        const ex = (await t.one('select id, name, username from channel_partners where name_key = $1 for update', [k]))
          || (await t.one('select c.id, c.name, null as username from cp_name_aliases a join channel_partners c on c.id = a.cp_id where a.name_key = $1', [k]));
        if (ex && ex.username) throw fail(409, 'A firm with this name is already registered.');
        // always a new firm of its own, pending: a firm already in the ERP under the same name (from bookings or brokerage)
        // is never taken over by whoever registers that name; staff see the possible match and decide
        const note = ex ? `Possible match: "${ex.name}" (partner #${ex.id}) is already in the ERP. Check that it is the same firm before approving; the two are not joined.` : null;
        const row = await t.one(`insert into channel_partners (name, name_key, note, username, pw_hash, office_address, office_area, contact_person, designation, phone, alt_phone, email,
            rera_no, callers_in_team, portal_status, mobile_verified_at, registered_at, cp_code)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now(), 'DI-CP-' || lpad(nextval('cp_code_seq')::text, 4, '0')) returning *`,
        [f.firm, ex ? `${k} [portal ${f.username}]` : k, note, f.username, f.pwHash, f.address, f.area, f.contact, f.designation, f.mobile, f.alt || null, f.email, f.rera, f.callers, status]);
        await audit.record(t.q, { user: null, action: 'partner-register', entity: 'channel-partner', entityId: row.id, after: { cp_code: row.cp_code, firm: row.name, possible_match: ex ? ex.id : null } });
        return row;
      });
      let sentTo = '';
      try { sentTo = await CA.send({ mobile: cp.phone, email: cp.email }, 'welcome', { name: cp.contact_person, cpCode: cp.cp_code }); } catch { sentTo = ''; }
      await CA.issue(req, res, cp.id);
      return res.json({ cpCode: cp.cp_code, status: statusLabel[cp.portal_status], approved: cp.portal_status === 'approved', sentTo: sentTo === 'test' ? '' : sentTo });
    }
    if (a === 'invite-start') {
      const f = await CF.inviteByToken(b.invite); if (!f) throw goneInvite();
      const x = inviteFields(b, f);
      if (await db.one('select 1 from channel_partners where lower(username) = $1', [x.username])) throw fail(409, 'This username is taken. Please choose another.');
      if (await db.one('select 1 from channel_partners where username is not null and upper(rera_no) = $1 and id <> $2', [x.rera, f.id])) throw fail(409, 'This MahaRERA number is already registered by another firm. Please contact the Dream India office.');
      const mobile = TM.mobile(f.phone || '');
      if (!mobile && !f.email) throw fail(409, 'We have no mobile or email for your firm. Please contact the Dream India office.');
      // the code goes to the firm's mobile and email on our records (staff confirmed them when inviting)
      return res.json(await CA.newCode({ purpose: 'invite', mobile: mobile || null, email: f.email, ip: CA.ipOf(req), staff: true, payload: { inviteId: f.invite_id, cpId: f.id, ...x, pwHash: CA.hash(b.password) } }));
    }
    if (a === 'invite-verify') {
      const code = await CA.checkCode(b.token, 'invite', b.otp);
      const x = code.payload;
      const cp = await db.tx(async (t) => {
        const inv = await t.one('select * from cp_invites where id = $1 for update', [x.inviteId]);
        if (!inv || inv.used_at || inv.revoked_at || new Date(inv.expires_at) < new Date() || inv.cp_id !== x.cpId) throw goneInvite();
        const f = await t.one('select * from channel_partners where id = $1 for update', [x.cpId]);
        if (!f || f.username || f.merged_into || f.is_reference) throw goneInvite();
        if (await t.one('select 1 from channel_partners where lower(username) = $1', [x.username])) throw fail(409, 'This username is taken. Please start again with another.');
        const row = await t.one(`update channel_partners set username = $2, pw_hash = $3, contact_person = $4, designation = $5, office_address = $6, office_area = $7, callers_in_team = $8,
            rera_no = $9, alt_phone = coalesce($10, alt_phone), portal_status = 'pending', mobile_verified_at = now(), registered_at = now(), failed_logins = 0, locked_until = null,
            cp_code = coalesce(cp_code, 'DI-CP-' || lpad(nextval('cp_code_seq')::text, 4, '0')) where id = $1 returning *`,
        [f.id, x.username, x.pwHash, x.contact, x.designation || null, x.address, x.area, x.callers, x.rera, x.alt || null]);
        await t.q('update cp_invites set used_at = now() where id = $1', [inv.id]);
        await t.q('update cp_invites set revoked_at = now() where cp_id = $1 and id <> $2 and used_at is null and revoked_at is null', [f.id, inv.id]);
        await audit.record(t.q, { user: null, action: 'partner-invite-accepted', entity: 'channel-partner', entityId: f.id, after: { cp_code: row.cp_code, username: x.username, invite: inv.id } });
        return row;
      });
      let sentTo = '';
      try { sentTo = await CA.send({ mobile: TM.mobile(cp.phone || '') || null, email: cp.email }, 'welcome', { name: cp.contact_person, cpCode: cp.cp_code }, { staff: true }); } catch { sentTo = ''; }
      await CA.issue(req, res, cp.id);
      return res.json({ cpCode: cp.cp_code, status: statusLabel[cp.portal_status], approved: false, sentTo: sentTo === 'test' ? '' : sentTo });
    }
    if (a === 'login') {
      const c = await findBy(b.username);
      if (c && c.locked_until && new Date(c.locked_until) > new Date()) throw fail(429, 'Too many wrong passwords. Please wait 15 minutes or reset your password.');
      if (!c || !CA.verify(b.password, c.pw_hash)) {
        if (c) await db.q("update channel_partners set failed_logins = failed_logins + 1, locked_until = case when failed_logins + 1 >= 8 then now() + interval '15 minutes' else locked_until end where id = $1", [c.id]);
        throw fail(401, 'Username or password is incorrect.');
      }
      if (c.portal_status === 'blocked' || c.portal_status === 'rejected') throw fail(403, 'This account is not active. Please contact the Dream India office.');
      await db.q('update channel_partners set failed_logins = 0, locked_until = null where id = $1', [c.id]);
      await CA.issue(req, res, c.id);
      return res.json({ ok: true });
    }
    if (a === 'logout') { await CA.clear(req, res); return res.json({ ok: true }); }
    if (a === 'forgot-start') {
      const c = await findBy(b.username);
      if (!c) return res.json({ token: 'none', sentTo: 'your registered mobile or email' });
      return res.json(await CA.newCode({ purpose: 'reset', mobile: TM.mobile(c.phone), email: c.email, ip: CA.ipOf(req), payload: { cpId: c.id } }));
    }
    if (a === 'forgot-verify') {
      const pp = CA.passwordProblem(b.password); if (pp) throw fail(400, 'Password: ' + pp);
      const code = await CA.checkCode(b.token, 'reset', b.otp);
      await db.q('update channel_partners set pw_hash = $2, failed_logins = 0, locked_until = null where id = $1', [code.payload.cpId, CA.hash(b.password)]);
      await CA.endAll(code.payload.cpId);
      await CA.issue(req, res, code.payload.cpId);
      return res.json({ ok: true });
    }
    const c = await need(req);
    if (a === 'parse') return res.json({ rows: parseFile(b.file, b.name, TM.MAX_ROWS) });
    if (a === 'upload') {
      if (c.portal_status !== 'approved') throw fail(403, 'Your account is waiting for approval by Dream India. You can upload once it is approved.');
      const cs = b.consent && typeof b.consent === 'object' ? b.consent : {};
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      const r = await TM.upload({ cpId: c.id, projectId: intOr(b.projectId), rows: b.rows, fileName: b.fileName,
        consent: { agreed: cs.agreed === true && cs.version === TM.CONSENT_VERSION, name: cs.name, ip, device: req.headers['user-agent'] } });
      await audit.record(db.q, { user: null, action: 'partner-upload-consent', entity: 'channel-partner', entityId: c.id, after: { uploadId: r.uploadId, rows: r.received, name: String(cs.name || '').slice(0, 80) }, note: TM.CONSENT_TEXT });
      return res.json(r); // the partner's view: "Not registered" for numbers that are ours or another partner's
    }
    if (a === 'doc-upload') { const r = await require('../lib/cp-docs').upload(c, { kind: b.kind, number: b.number, file: b.file }); await audit.record(db.q, { user: null, action: 'partner-doc', entity: 'channel-partner', entityId: c.id, after: { kind: b.kind } }); return res.json(r); }
    if (a === 'agreement-sign') { const r = await require('../lib/cp-docs').signOnline(c, { name: b.name, agree: !!b.agree, ip: String(req.headers['x-forwarded-for'] || '').split(',')[0] }); await audit.record(db.q, { user: null, action: 'partner-agreement-online', entity: 'channel-partner', entityId: c.id, after: { name: str(b.name, 120) } }); return res.json(r); }
    if (a === 'bill-start') { approved(c); return res.json(await CB.start(c, { billNo: b.billNo, billDate: b.billDate, amount: b.amount, gst: b.gst, bookingIds: b.bookingIds, file: b.file })); }
    if (a === 'bill-part') { approved(c); return res.json(await CB.part(c, { id: b.id, i: b.i, data: b.data })); }
    if (a === 'bill-finish') { approved(c); return res.json(await CB.finish(c, { id: b.id })); }
    if (a === 'profile') {
      const r = await db.one(`update channel_partners set office_address = coalesce(nullif($2, ''), office_address), office_area = coalesce(nullif($3, ''), office_area),
          contact_person = coalesce(nullif($4, ''), contact_person), designation = $5, alt_phone = $6, callers_in_team = $7 where id = $1 returning *`,
      [c.id, str(b.address, 250), str(b.area, 60), str(b.contact, 80), str(b.designation, 60) || null, str(b.alt, 20) || null, intOr(b.callers)]);
      return res.json({ profile: profile(r) });
    }
    if (a === 'password') {
      if (!CA.verify(b.current, c.pw_hash)) throw fail(400, 'Your current password is not correct.');
      const pp = CA.passwordProblem(b.next); if (pp) throw fail(400, 'Password: ' + pp);
      await db.q('update channel_partners set pw_hash = $2 where id = $1', [c.id, CA.hash(b.next)]);
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown request.');
  },
});
