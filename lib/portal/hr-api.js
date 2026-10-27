// HR & Admin: employees, salaries, ID documents, letters, policies, leave and appraisals.
// Served from /api/hr (rewritten to /api/me?hr=1, because Vercel Hobby allows 12 functions).
// Access (lib/auth.js hrLevel): "self" = only their own record (fill in personal, ID and bank details, upload
// their own documents, own leave); "view" = staff list, policies, own leave requests; "edit" = everything.
// Salaries, ID numbers, bank details and document copies are never sent to a "view" login, and a "self"
// login only ever receives its own record.
// Uploaded files live in the KV store in 512 KB pieces (no Drive or Blob store needed), and are
// only ever served through this route after the login check. Every file view and change is logged.
const crypto = require('crypto');
const auth = require('./auth');
const kv = require('./kv');
const { body, noStore } = require('./http');
const D = require('./hr-defaults');

const K = { emp: 'hr:emp', files: 'hr:files', meta: 'hr:filemeta', pol: 'hr:policies', tpl: 'hr:templates', cfg: 'hr:config', leave: 'hr:leave', appr: 'hr:appraisals', log: 'hr:log' };
const CHUNK = 512 * 1024, MAX_FILE = 4 * 1024 * 1024; // a function response can carry at most 4.5 MB
const ID = /^[A-Za-z0-9_-]{4,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const d = (v) => (DATE.test(String(v || '')) ? String(v) : '');
const num = (v) => { const x = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : null; };
const now = () => new Date().toISOString();

const STATUS = ['Active', 'On probation', 'Notice period', 'Left'];
const TYPES = ['Permanent', 'Probation', 'Contract', 'Intern', 'Consultant'];
// fields a "view" login may see; everything else in the record is edit-only
const OPEN = ['id', 'empNo', 'title', 'name', 'designation', 'department', 'location', 'reportingTo', 'startDate', 'status', 'phone', 'email', 'login'];
const TEXT = { empNo: 20, title: 10, name: 80, designation: 80, department: 60, grade: 30, reportingTo: 80, location: 80, gender: 20, phone: 20, email: 100,
  personalEmail: 100, address: 300, emergencyName: 80, emergencyPhone: 20, login: 32, aadhaarNo: 14, panNo: 10, uan: 20, esiNo: 20, bankName: 60, bankAccount: 30, ifsc: 11, notes: 2000, fatherName: 80, qualification: 120 };
const DATES = ['startDate', 'confirmDate', 'endDate', 'dob'];
const MONEY = ['ctc', 'gross', 'basic', 'hra', 'allowances', 'elOpening'];
// what staff fill in about themselves (everything about the job and salary stays with HR)
const SELF_FIELDS = ['title', 'phone', 'personalEmail', 'dob', 'gender', 'fatherName', 'qualification', 'address', 'emergencyName', 'emergencyPhone', 'aadhaarNo', 'panNo', 'uan', 'esiNo', 'bankName', 'bankAccount', 'ifsc'];
const SELF_DOCS = D.DOC_TYPES.filter((t) => !['Offer letter (signed)', 'NDA (signed)', 'Appraisal'].includes(t));
const selfView = (e) => { const x = { ...e }; delete x.notes; return x; };
// Staff logins made by the Excel upload (Admin only)
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const projectFor = (location) => (/aspire/i.test(location || '') ? ['aspire'] : ['signature']);

async function log(u, action, detail) {
  const at = now();
  await kv.hset(K.log, at + ':' + crypto.randomBytes(3).toString('hex'), { at, by: u.username, name: u.name || u.username, action, detail: s(detail, 300) }).catch(() => {});
}
async function config() {
  const c = await kv.hgetall(K.cfg);
  return { company: { ...D.COMPANY, ...(c.company || {}) }, leaveTypes: c.leaveTypes || D.LEAVE_TYPES, holidays: c.holidays || [], departments: c.departments || D.DEPARTMENTS };
}
// stored policies / templates, or the starting drafts until the Admin saves their own
async function listOrDefault(key, defaults) {
  const saved = await kv.hgetall(key);
  const out = { ...Object.fromEntries(defaults.map((x, i) => [x.id, { ...x, order: i + 1, draft: true }])), ...saved };
  return Object.values(out).filter((x) => !x.deleted).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title));
}
const openView = (e) => Object.fromEntries(OPEN.map((f) => [f, e[f] ?? '']));

// working days between two dates, leaving out Sundays and the holiday list
function leaveDays(from, to, half, holidays) {
  if (!from || !to || to < from) return 0;
  if (half && from === to) return 0.5;
  let n = 0;
  for (let t = new Date(from + 'T00:00:00Z'); t <= new Date(to + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)) {
    const iso = t.toISOString().slice(0, 10);
    if (t.getUTCDay() !== 0 && !holidays.includes(iso)) n++;
  }
  return n;
}
// what a file really is, from its first bytes (the browser's own type is not trusted)
function sniff(buf) {
  if (buf.slice(0, 4).toString() === '%PDF') return { mime: 'application/pdf', ext: 'pdf', inline: true };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg', inline: true };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', inline: true };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp', inline: true };
  if (buf[0] === 0x50 && buf[1] === 0x4b) return { mime: 'application/octet-stream', ext: 'docx', inline: false }; // Word / Excel (zip)
  return null;
}
async function readFile(meta) {
  const parts = await Promise.all(Array.from({ length: meta.n }, (_, i) => kv.hget(K.files, `${meta.id}:${i}`)));
  if (parts.some((p) => typeof p !== 'string')) return null;
  return Buffer.concat(parts.map((p) => Buffer.from(p, 'base64')));
}
async function dropFile(id, n) {
  for (let i = 0; i < n; i++) await kv.hdel(K.files, `${id}:${i}`);
  await kv.hdel(K.meta, id);
}

function cleanEmployee(b, old, all) {
  const e = { ...(old || {}) };
  for (const [f, n] of Object.entries(TEXT)) if (b[f] !== undefined) e[f] = s(b[f], n);
  for (const f of DATES) if (b[f] !== undefined) e[f] = d(b[f]);
  for (const f of MONEY) if (b[f] !== undefined) e[f] = num(b[f]);
  if (b.pf !== undefined) e.pf = !!b.pf;
  if (b.esi !== undefined) e.esi = !!b.esi;
  if (b.status !== undefined) e.status = STATUS.includes(b.status) ? b.status : 'Active';
  if (b.employmentType !== undefined) e.employmentType = TYPES.includes(b.employmentType) ? b.employmentType : 'Permanent';
  if (e.panNo) e.panNo = e.panNo.toUpperCase();
  if (e.ifsc) e.ifsc = e.ifsc.toUpperCase();
  if (e.aadhaarNo) e.aadhaarNo = e.aadhaarNo.replace(/\D/g, '').slice(0, 12);
  if (e.login) e.login = auth.norm(e.login);
  if (!e.empNo) {
    const top = Math.max(0, ...Object.values(all).map((x) => +(String(x.empNo || '').match(/(\d+)$/) || [0, 0])[1]));
    e.empNo = 'DIR-' + String(top + 1).padStart(3, '0');
  }
  return e;
}

module.exports = async (req, res) => {
  noStore(res);
  const u = await auth.guard(req, res, 'hr');
  if (!u) return;
  const level = auth.hrLevel(u), edit = level === 'edit';
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.file) {
        const meta = ID.test(q.file) && (await kv.hget(K.meta, q.file));
        if (!edit) {
          const own = meta && (await kv.hget(K.emp, meta.empId));
          if (!own || own.login !== u.username) return res.status(403).json({ error: 'Only HR (Edit access) can open documents.' });
        }
        if (!meta || !meta.done) return res.status(404).json({ error: 'That document is not there.' });
        const buf = await readFile(meta);
        if (!buf) return res.status(500).json({ error: 'The document could not be read. Upload it again.' });
        const t = sniff(buf) || { mime: 'application/octet-stream', ext: 'bin', inline: false };
        const name = (meta.name || 'document').replace(/[^\w .()-]/g, '_');
        await log(u, 'Opened document', `${meta.empName || ''} · ${meta.type} · ${name}`);
        res.setHeader('Content-Type', t.mime);
        res.setHeader('Content-Disposition', `${t.inline && q.dl !== '1' ? 'inline' : 'attachment'}; filename="${name}"`);
        if (t.mime.startsWith('image/')) res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
        return res.status(200).send(buf);
      }
      if (q.log) {
        if (!edit) return res.status(403).json({ error: 'Edit access only.' });
        const all = Object.values(await kv.hgetall(K.log)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
        return res.status(200).json({ log: all });
      }
      const [emp, leave, cfg, policies] = await Promise.all([kv.hgetall(K.emp), kv.hgetall(K.leave), config(), listOrDefault(K.pol, D.POLICIES)]);
      const employees = Object.values(emp).sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true }));
      const mine = employees.filter((e) => e.login && e.login === u.username).map((e) => e.id);
      const out = {
        me: auth.publicUser(u), level, mine, ...cfg, docTypes: D.DOC_TYPES, statuses: STATUS, types: TYPES, policies: level === 'self' ? [] : policies,
        employees: edit ? employees : level === 'self' ? employees.filter((e) => mine.includes(e.id)).map(selfView) : employees.filter((e) => e.status !== 'Left').map(openView),
        selfFields: SELF_FIELDS, selfDocs: SELF_DOCS,
        leave: Object.values(leave).filter((l) => edit || mine.includes(l.empId)).sort((a, b) => b.from.localeCompare(a.from)),
      };
      if (edit) {
        const [templates, appr, users] = await Promise.all([listOrDefault(K.tpl, D.TEMPLATES), kv.hgetall(K.appr), kv.hgetall('users')]);
        out.templates = templates;
        out.appraisals = Object.values(appr).sort((a, b) => String(b.period).localeCompare(String(a.period)));
        out.logins = Object.values(users).filter((x) => !x.disabled).map((x) => ({ username: x.username, name: x.name || x.username })).sort((a, b) => a.name.localeCompare(b.name));
        out.mine = mine;
      } else {
        // a view login gets its own leave balance inputs only
        out.myBalance = Object.fromEntries(employees.filter((e) => mine.includes(e.id)).map((e) => [e.id, { elOpening: e.elOpening || 0, startDate: e.startDate || '' }]));
      }
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
    const b = body(req);
    const op = b.op;
    const need = () => { if (!edit) { res.status(403).json({ error: level === 'self' ? 'HR keeps this part of your record.' : 'Your HR access is View only.' }); return false; } return true; };

    // ---------- staff filling in their own record ----------
    if (op === 'saveMyDetails') {
      const e = await kv.hget(K.emp, s(b.id, 40));
      if (!e || e.login !== u.username) return res.status(403).json({ error: 'You can only fill in your own record.' });
      const x = b.data || {}, only = {};
      for (const f of SELF_FIELDS) if (x[f] !== undefined) only[f] = x[f];
      const n = cleanEmployee(only, e, {});
      if (n.panNo && !/^[A-Z]{5}\d{4}[A-Z]$/.test(n.panNo)) return res.status(400).json({ error: 'PAN should look like ABCDE1234F.' });
      if (n.aadhaarNo && n.aadhaarNo.length !== 12) return res.status(400).json({ error: 'Aadhaar number should have 12 digits.' });
      if (n.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(n.ifsc)) return res.status(400).json({ error: 'IFSC should look like HDFC0001234 (11 characters).' });
      n.selfUpdatedAt = now(); n.updatedAt = now(); n.updatedBy = u.username;
      await kv.hset(K.emp, n.id, n);
      await log(u, 'Filled in own details', `${n.empNo} ${n.name}`);
      return res.status(200).json({ ok: true, employee: selfView(n) });
    }

    // ---------- employees ----------
    if (op === 'saveEmployee') {
      if (!need()) return;
      const data = b.data || {};
      const all = await kv.hgetall(K.emp);
      const old = data.id ? all[data.id] : null;
      if (data.id && !old) return res.status(404).json({ error: 'No such employee.' });
      if (!s(data.name ?? old?.name)) return res.status(400).json({ error: 'Enter the name.' });
      const e = cleanEmployee(data, old, all);
      if (Object.values(all).some((x) => x.id !== e.id && x.empNo === e.empNo)) return res.status(400).json({ error: `Employee no. ${e.empNo} is already used.` });
      if (!old) { e.id = newId(); e.docs = []; e.salaryHistory = []; e.createdAt = now(); e.createdBy = u.username; }
      if ((old?.ctc ?? null) !== e.ctc && e.ctc != null) {
        e.salaryHistory = [...(e.salaryHistory || []), { from: d(data.salaryFrom) || e.startDate || now().slice(0, 10), ctc: e.ctc, gross: e.gross, reason: s(data.salaryReason, 120) || (old ? 'Revised' : 'On joining'), by: u.username, at: now() }];
      }
      e.updatedAt = now(); e.updatedBy = u.username;
      await kv.hset(K.emp, e.id, e);
      await log(u, old ? 'Updated employee' : 'Added employee', `${e.empNo} ${e.name}${(old?.ctc ?? null) !== e.ctc ? ' (salary changed)' : ''}`);
      return res.status(200).json({ ok: true, employee: e });
    }
    // Excel upload (HR employee list): each row adds a new employee or updates the one with the same
    // employee no. (or, with no number, the same name). Blank cells keep what is already saved.
    if (op === 'importEmployees') {
      if (!need()) return;
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
      if (!rows.length) return res.status(400).json({ error: 'The file has no employee rows.' });
      const all = await kv.hgetall(K.emp);
      const key = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const results = [], changed = [];
      // Logins for the staff (Admin only): a row with a portal username gets a Staff login with that
      // username and its temporary password, linked to the employee. If that username already exists,
      // or an existing login has exactly the same name, the employee is linked to it and its password is
      // left alone. The person must set their own password when they first sign in.
      const makeLogins = !!auth.ROLES[u.role]?.users && rows.some((r) => r && r.loginUser);
      const users = makeLogins ? await kv.hgetall('users') : {};
      const linked = new Set(Object.values(all).map((x) => x.login).filter(Boolean));
      const newUsers = [];
      for (const raw of rows) {
        const loginUser = auth.norm(raw && raw.loginUser), loginPassword = String((raw && raw.loginPassword) || '');
        if (raw) { delete raw.loginUser; delete raw.loginPassword; }
        const data = Object.fromEntries(Object.entries(raw || {}).filter(([, v]) => v !== '' && v != null));
        const name = s(data.name, 80);
        const old = data.empNo ? Object.values(all).find((x) => key(x.empNo) === key(data.empNo)) : Object.values(all).find((x) => key(x.name) === key(name));
        if (!name && !old) { results.push({ result: 'Skipped', why: 'No name' }); continue; }
        if (data.empNo && !old && Object.values(all).some((x) => key(x.empNo) === key(data.empNo))) { results.push({ result: 'Skipped', why: 'Employee no. used twice' }); continue; }
        const e = cleanEmployee(data, old, all);
        if (!old) { e.id = newId(); e.docs = []; e.salaryHistory = []; e.createdAt = now(); e.createdBy = u.username; if (!e.status) e.status = 'Active'; if (!e.employmentType) e.employmentType = 'Permanent'; }
        if ((old?.ctc ?? null) !== e.ctc && e.ctc != null) e.salaryHistory = [...(e.salaryHistory || []), { from: old ? now().slice(0, 10) : e.startDate || now().slice(0, 10), ctc: e.ctc, gross: e.gross, reason: old ? 'Changed by Excel upload' : 'On joining (Excel upload)', by: u.username, at: now() }];
        e.updatedAt = now(); e.updatedBy = u.username;
        let login = null;
        if (makeLogins && loginUser) {
          const sameName = Object.values(users).find((x) => !x.disabled && x.role !== 'admin' && key(x.name) === key(e.name) && !linked.has(x.username));
          if (e.login && users[e.login]) login = { result: 'Already linked', username: e.login };
          else if (!USERNAME.test(loginUser)) login = { result: 'Not made', why: 'Username must be 3 to 32 letters, numbers, dot, dash or underscore' };
          else if (users[loginUser] && linked.has(loginUser)) login = { result: 'Not made', why: `Username ${loginUser} is already linked to someone else` };
          else if (users[loginUser] || sameName) {
            const x = users[loginUser] || sameName, r = auth.ROLES[x.role] || {};
            const rec = { ...x };
            if (r.team) { if (!rec.access || !rec.access.hr || rec.access.hr === 'none') rec.access = { ...(rec.access || {}), hr: 'self' }; }
            else if (!rec.hr || rec.hr === 'none') { if (!r.hr) rec.hr = 'self'; }
            users[x.username] = rec; newUsers.push([x.username, rec]);
            e.login = x.username; linked.add(x.username);
            login = { result: 'Linked to existing login', username: x.username };
          } else if (auth.passwordProblem(loginPassword)) login = { result: 'Not made', why: 'Temporary password needs at least 8 characters' };
          else {
            const rec = { username: loginUser, name: s(e.name, 60), role: 'staff', projects: projectFor(e.location), hash: auth.hashPassword(loginPassword), sv: 1, mustChange: true, createdAt: now(), createdBy: u.username };
            users[loginUser] = rec; newUsers.push([loginUser, rec]);
            e.login = loginUser; linked.add(loginUser);
            login = { result: 'New login', username: loginUser };
          }
        }
        all[e.id] = e; changed.push([e.id, e]);
        results.push({ result: old ? 'Updated' : 'Added', empNo: e.empNo, name: e.name, login });
      }
      await kv.hsetMany(K.emp, changed);
      if (newUsers.length) await kv.hsetMany('users', newUsers);
      const n = (r) => results.filter((x) => x.result === r).length;
      const nl = results.filter((x) => x.login && x.login.result === 'New login').length;
      await log(u, 'Excel upload of employees', `${n('Added')} added, ${n('Updated')} updated, ${n('Skipped')} skipped${makeLogins ? `, ${nl} staff logins made` : ''}`);
      return res.status(200).json({ ok: true, results, added: n('Added'), updated: n('Updated'), skipped: n('Skipped') });
    }
    if (op === 'deleteEmployee') {
      if (u.role !== 'admin') return res.status(403).json({ error: 'Only the Admin can delete an employee. Others can set the status to Left.' });
      const e = await kv.hget(K.emp, s(b.id, 40));
      if (!e) return res.status(404).json({ error: 'No such employee.' });
      for (const doc of e.docs || []) await dropFile(doc.id, doc.n || 0);
      await kv.hdel(K.emp, e.id);
      await log(u, 'Deleted employee', `${e.empNo} ${e.name} and ${(e.docs || []).length} documents`);
      return res.status(200).json({ ok: true });
    }

    // ---------- documents: start, send pieces, finish ----------
    if (op === 'fileStart') {
      const e = await kv.hget(K.emp, s(b.empId, 40));
      if (!e) return res.status(404).json({ error: 'No such employee.' });
      if (!edit && !(e.login === u.username && SELF_DOCS.includes(b.type))) { need(); return; }
      const size = Math.floor(+b.size || 0), n = Math.ceil(size / CHUNK);
      if (!size || size > MAX_FILE) return res.status(400).json({ error: 'Files can be up to 4 MB. Scan at a lower resolution or save the PDF smaller.' });
      const meta = { id: newId(), empId: e.id, empName: e.name, type: D.DOC_TYPES.includes(b.type) ? b.type : 'Other', label: s(b.label, 80), name: s(b.name, 120) || 'document', size, n, done: false, by: u.username, at: now() };
      await kv.hset(K.meta, meta.id, meta);
      return res.status(200).json({ ok: true, fileId: meta.id, chunk: CHUNK });
    }
    if (op === 'fileChunk') {
      const meta = ID.test(String(b.fileId || '')) && (await kv.hget(K.meta, b.fileId));
      if (!edit && !(meta && meta.by === u.username)) { need(); return; }
      const i = Math.floor(+b.i);
      if (!meta || meta.done || !(i >= 0 && i < meta.n) || typeof b.data !== 'string' || b.data.length > Math.ceil(CHUNK / 3) * 4 + 4) return res.status(400).json({ error: 'Upload interrupted. Try again.' });
      await kv.hset(K.files, `${meta.id}:${i}`, b.data);
      return res.status(200).json({ ok: true });
    }
    if (op === 'fileDone') {
      const meta = ID.test(String(b.fileId || '')) && (await kv.hget(K.meta, b.fileId));
      if (!edit && !(meta && meta.by === u.username)) { need(); return; }
      if (!meta) return res.status(400).json({ error: 'Upload interrupted. Try again.' });
      const buf = await readFile(meta);
      const t = buf && sniff(buf);
      if (!buf || buf.length !== meta.size || !t) {
        await dropFile(meta.id, meta.n);
        return res.status(400).json({ error: !buf || buf.length !== meta.size ? 'Upload interrupted. Try again.' : 'Upload a PDF, a photo (JPG, PNG) or a Word / Excel file.' });
      }
      const e = await kv.hget(K.emp, meta.empId);
      if (!e) { await dropFile(meta.id, meta.n); return res.status(404).json({ error: 'No such employee.' }); }
      if (meta.done) return res.status(400).json({ error: 'That upload is already finished.' });
      meta.done = true; meta.kind = t.ext;
      await kv.hset(K.meta, meta.id, meta);
      e.docs = [...(e.docs || []), { id: meta.id, type: meta.type, label: meta.label, name: meta.name, size: meta.size, n: meta.n, kind: t.ext, by: u.username, at: meta.at }];
      await kv.hset(K.emp, e.id, e);
      await log(u, 'Uploaded document', `${e.empNo} ${e.name} · ${meta.type} · ${meta.name}`);
      return res.status(200).json({ ok: true, employee: edit ? e : selfView(e) });
    }
    if (op === 'deleteFile') {
      const e = await kv.hget(K.emp, s(b.empId, 40));
      const doc = e && (e.docs || []).find((x) => x.id === b.fileId);
      if (!doc) return res.status(404).json({ error: 'That document is not there.' });
      if (!edit && !(e.login === u.username && doc.by === u.username)) return res.status(403).json({ error: 'You can delete only the documents you uploaded yourself.' });
      await dropFile(doc.id, doc.n || 0);
      e.docs = e.docs.filter((x) => x.id !== doc.id);
      await kv.hset(K.emp, e.id, e);
      await log(u, 'Deleted document', `${e.empNo} ${e.name} · ${doc.type} · ${doc.name}`);
      return res.status(200).json({ ok: true, employee: edit ? e : selfView(e) });
    }

    // ---------- policies, letter templates, company details, leave types ----------
    if (op === 'savePolicy' || op === 'saveTemplate') {
      if (!need()) return;
      const x = b.data || {}, key = op === 'savePolicy' ? K.pol : K.tpl;
      const id = ID.test(String(x.id || '')) || /^[a-z-]{2,20}$/.test(String(x.id || '')) ? x.id : newId();
      if (!s(x.title)) return res.status(400).json({ error: 'Give it a title.' });
      const doc = { id, title: s(x.title, 120), body: String(x.body || '').slice(0, 60000), version: s(x.version, 40), effectiveFrom: d(x.effectiveFrom), order: Number.isFinite(+x.order) ? +x.order : 99, updatedAt: now(), updatedBy: u.name || u.username };
      if (x.deleted) doc.deleted = true;
      await kv.hset(key, id, doc);
      await log(u, `${x.deleted ? 'Deleted' : 'Saved'} ${op === 'savePolicy' ? 'policy' : 'letter template'}`, doc.title);
      return res.status(200).json({ ok: true, id });
    }
    if (op === 'saveConfig') {
      if (!need()) return;
      const c = b.data || {};
      if (c.company) await kv.hset(K.cfg, 'company', Object.fromEntries(Object.keys(D.COMPANY).map((f) => [f, s(c.company[f], 300)])));
      if (Array.isArray(c.leaveTypes)) {
        const lt = c.leaveTypes.slice(0, 20).map((t) => ({ key: s(t.key, 8).toUpperCase(), label: s(t.label, 60), days: num(t.days) ?? 0, accrues: !!t.accrues, note: s(t.note, 160) })).filter((t) => t.key && t.label);
        await kv.hset(K.cfg, 'leaveTypes', lt);
      }
      if (Array.isArray(c.holidays)) await kv.hset(K.cfg, 'holidays', [...new Set(c.holidays.map(d).filter(Boolean))].sort());
      if (Array.isArray(c.departments)) await kv.hset(K.cfg, 'departments', c.departments.map((x) => s(x, 60)).filter(Boolean).slice(0, 40));
      await log(u, 'Changed HR settings', Object.keys(c).join(', '));
      return res.status(200).json({ ok: true });
    }

    // ---------- leave ----------
    if (op === 'leaveRequest') {
      const x = b.data || {};
      const all = await kv.hgetall(K.emp);
      const e = all[s(x.empId, 40)];
      if (!e) return res.status(400).json({ error: 'Pick the employee.' });
      if (!edit && e.login !== u.username) return res.status(403).json({ error: 'You can request leave only for yourself. Ask HR to link your login to your employee record.' });
      const cfg = await config();
      const type = cfg.leaveTypes.find((t) => t.key === x.type);
      if (!type) return res.status(400).json({ error: 'Pick the type of leave.' });
      const from = d(x.from), to = d(x.to) || from;
      if (!from || to < from) return res.status(400).json({ error: 'Check the dates.' });
      const days = leaveDays(from, to, !!x.half, cfg.holidays);
      if (!days) return res.status(400).json({ error: 'Those dates are all Sundays or holidays.' });
      const l = { id: newId(), empId: e.id, empNo: e.empNo, empName: e.name, type: type.key, typeLabel: type.label, from, to, half: !!x.half && from === to, days, reason: s(x.reason, 500),
        status: 'Pending', requestedBy: u.name || u.username, requestedAt: now() };
      await kv.hset(K.leave, l.id, l);
      await log(u, 'Leave requested', `${e.name} · ${type.label} · ${from} to ${to} (${days} d)`);
      return res.status(200).json({ ok: true, leave: l });
    }
    if (op === 'leaveDecide') {
      const l = await kv.hget(K.leave, s(b.id, 40));
      if (!l) return res.status(404).json({ error: 'No such request.' });
      const st = b.status;
      if (!['Approved', 'Rejected', 'Cancelled'].includes(st)) return res.status(400).json({ error: 'Unknown choice.' });
      if (!edit) {
        const e = await kv.hget(K.emp, l.empId);
        if (st !== 'Cancelled' || !e || e.login !== u.username || l.status !== 'Pending') return res.status(403).json({ error: 'Only HR can approve or reject leave.' });
      }
      Object.assign(l, { status: st, decidedBy: u.name || u.username, decidedAt: now(), note: s(b.note, 300) });
      await kv.hset(K.leave, l.id, l);
      await log(u, `Leave ${st.toLowerCase()}`, `${l.empName} · ${l.typeLabel} · ${l.from} to ${l.to}`);
      return res.status(200).json({ ok: true, leave: l });
    }

    // ---------- appraisals ----------
    if (op === 'saveAppraisal') {
      if (!need()) return;
      const x = b.data || {};
      const e = await kv.hget(K.emp, s(x.empId, 40));
      if (!e) return res.status(400).json({ error: 'Pick the employee.' });
      const old = x.id ? await kv.hget(K.appr, s(x.id, 40)) : null;
      const a = { ...(old || {}), id: old?.id || newId(), empId: e.id, empNo: e.empNo, empName: e.name, period: s(x.period, 30), reviewer: s(x.reviewer, 80), goals: String(x.goals || '').slice(0, 8000),
        selfReview: String(x.selfReview || '').slice(0, 8000), comments: String(x.comments || '').slice(0, 8000), rating: [1, 2, 3, 4, 5].includes(+x.rating) ? +x.rating : null,
        increment: num(x.increment), newCtc: num(x.newCtc), effectiveFrom: d(x.effectiveFrom), status: ['Goals set', 'Self-review', 'Manager review', 'Final'].includes(x.status) ? x.status : 'Goals set',
        updatedAt: now(), updatedBy: u.name || u.username };
      if (x.deleted) { await kv.hdel(K.appr, a.id); await log(u, 'Deleted appraisal', `${e.name} ${a.period}`); return res.status(200).json({ ok: true }); }
      await kv.hset(K.appr, a.id, a);
      // "Apply the new salary": final appraisal with a new CTC updates the employee's salary and history
      if (x.apply && a.status === 'Final' && a.newCtc != null && !a.appliedAt) {
        e.salaryHistory = [...(e.salaryHistory || []), { from: a.effectiveFrom || now().slice(0, 10), ctc: a.newCtc, gross: e.gross, reason: `Appraisal ${a.period}${a.increment != null ? ` (+${a.increment}%)` : ''}`, by: u.username, at: now() }];
        e.ctc = a.newCtc; e.updatedAt = now(); e.updatedBy = u.username;
        await kv.hset(K.emp, e.id, e);
        a.appliedAt = now(); await kv.hset(K.appr, a.id, a);
        await log(u, 'Applied appraisal salary', `${e.empNo} ${e.name} · ${a.period}`);
      } else await log(u, 'Saved appraisal', `${e.name} ${a.period}`);
      return res.status(200).json({ ok: true, appraisal: a });
    }
    return res.status(400).json({ error: 'Unknown request.' });
  } catch (x) {
    return res.status(500).json({ error: x.message || 'Something went wrong.' });
  }
};
module.exports.leaveDays = leaveDays;
