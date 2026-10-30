// Partner portal (/partner): channel partner firms register (username, password, firm details, mobile verified by OTP),
// get a CP ID, upload client lists for the launches that are open, and see only their own clients, masked.
// GET  ?me=1 · ?home=1 · ?leads=1[&project=ID&q=…] · ?issues=UPLOAD_ID
// POST {action}: register-start · register-verify · login · logout · forgot-start · forgot-verify · parse · upload · profile · password
const db = require('../lib/db');
const audit = require('../lib/audit');
const { parseFile } = require('../lib/sheetfile');
const TM = require('../lib/tm');
const CA = require('../lib/cp-auth');
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
const findBy = (who) => {
  const w = str(who, 80).toLowerCase(), m = TM.mobile(w);
  return db.one(`select * from channel_partners where username is not null and (lower(username) = $1 or lower(cp_code) = $1 or ($2 <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || $2)) order by id limit 1`, [w, m]);
};

module.exports = route({
  GET: async (req, res) => {
    const Q = req.query || {};
    if (Q.me) { const c = await CA.session(req); return res.json(c ? { signedIn: true, profile: profile(c) } : { signedIn: false, areas: AREAS }); }
    const c = await need(req);
    if (Q.home) {
      const st = await db.q('select status, count(*)::int as n, count(*) filter (where owner_until >= $2::date)::int as active from tm_leads where cp_id = $1 group by status', [c.id, TM.istToday()]);
      const status = {}; let leads = 0, active = 0;
      for (const r of st) { const k = partnerStatus(r.status); status[k] = (status[k] || 0) + r.n; leads += r.n; active += r.active; }
      const uploads = await db.q(`select u.id, u.created_at, u.file_name, u.received, u.accepted, p.name as project from tm_uploads u join tm_projects p on p.id = u.tm_project_id
        where u.cp_id = $1 order by u.id desc limit 50`, [c.id]);
      const bk = await db.one("select count(*)::int as c from bookings where cp_id = $1 and status = 'active'", [c.id]);
      const projects = (await TM.openProjects()).map((p) => ({ id: p.id, name: p.name, location: p.location, rera: p.rera_no, until: TM.iso(p.upload_until) }));
      return res.json({ profile: profile(c), projects, stats: { leads, active, uploads: uploads.length, bookings: bk.c, status },
        uploads: uploads.map((u) => ({ id: u.id, at: u.created_at, file: u.file_name, received: u.received, accepted: u.accepted, project: u.project })), areas: AREAS, maxRows: TM.MAX_ROWS });
    }
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
      return res.json({ rows: rows.map((r) => ({ row: r.row_no, name: r.name, mobile: TM.mask(r.mobile), reason: r.reason })) });
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
      const r = await CA.newCode({ purpose: 'register', mobile: f.mobile, email: f.email, payload: { ...f, pwHash: CA.hash(b.password) } });
      return res.json(r);
    }
    if (a === 'register-verify') {
      const code = await CA.checkCode(b.token, 'register', b.otp);
      const f = code.payload;
      const S = await TM.settings();
      const status = S.autoApprove ? 'approved' : 'pending';
      const cp = await db.tx(async (t) => {
        if (await t.one('select 1 from channel_partners where lower(username) = $1', [f.username])) throw fail(409, 'This account already exists. Please sign in.');
        const k = keyOf(f.firm);
        const ex = await t.one('select id, username from channel_partners where name_key = $1 for update', [k]);
        if (ex && ex.username) throw fail(409, 'A firm with this name is already registered.');
        const vals = [f.username, f.pwHash, f.address, f.area, f.contact, f.designation, f.mobile, f.alt || null, f.email, f.rera, f.callers, status];
        const sets = `username = $1, pw_hash = $2, office_address = $3, office_area = $4, contact_person = $5, designation = $6, phone = $7, alt_phone = $8, email = $9,
          rera_no = $10, callers_in_team = $11, portal_status = $12, mobile_verified_at = now(), registered_at = now(),
          cp_code = coalesce(cp_code, 'DI-CP-' || lpad(nextval('cp_code_seq')::text, 4, '0'))`;
        const row = ex
          ? await t.one(`update channel_partners set ${sets} where id = $13 returning *`, [...vals, ex.id])
          : await t.one('insert into channel_partners (name, name_key) values ($1, $2) returning id', [f.firm, k]).then((x) => t.one(`update channel_partners set ${sets} where id = $13 returning *`, [...vals, x.id]));
        await audit.record(t.q, { user: null, action: 'partner-register', entity: 'channel-partner', entityId: row.id, after: { cp_code: row.cp_code, firm: row.name, existing_firm: !!ex } });
        return row;
      });
      let sentTo = '';
      try { sentTo = await CA.send({ mobile: cp.phone, email: cp.email }, 'welcome', { name: cp.contact_person, cpCode: cp.cp_code }); } catch { sentTo = ''; }
      await CA.issue(req, res, cp.id);
      return res.json({ cpCode: cp.cp_code, status: statusLabel[cp.portal_status], approved: cp.portal_status === 'approved', sentTo: sentTo === 'test' ? '' : sentTo });
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
      return res.json(await CA.newCode({ purpose: 'reset', mobile: TM.mobile(c.phone), email: c.email, payload: { cpId: c.id } }));
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
      if (!b.consent) throw fail(400, 'Please confirm that your clients agreed to be contacted.');
      const r = await TM.upload({ cpId: c.id, projectId: intOr(b.projectId), rows: b.rows, fileName: b.fileName });
      return res.json(r);
    }
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
