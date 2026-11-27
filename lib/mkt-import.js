// Leads from Excel: a builder's existing enquiries (portal downloads, old CRM, the sales team's sheets) brought into
// Marketing → Leads in one go (from Zuri, 27 Nov 2026). Every row is checked first; one bad row stops the file and nothing is saved.
// A number (or email) already a lead is not doubled: the row's source is added to that lead ("came again").
// Imported leads are given to the sales team as usual, but nobody is sent a WhatsApp or an email for them.
const db = require('./db');
const L = require('./mkt-leads');

const fail = (status, message) => Object.assign(new Error(message), { status });
const STATUS = { new: 'New', contacted: 'Contacted', visit: 'Site visit', booked: 'Booked', lost: 'Lost' };
const HEAD = ['Name', 'Phone', 'Email', 'Source', 'Project', 'Status', 'Enquiry date', 'Next call date', 'Note'];
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function template() {
  const projects = await db.q('select code, name from projects where active order by name');
  const p = projects[0] ? projects[0].code || projects[0].name : '';
  return require('./xlsx-write').write([
    { name: 'Leads', rows: [HEAD, ['Lead name', '9820000000', 'name@example.com', '99acres', p, 'New', '15-11-2026', '', 'Wants a 2 BHK, budget 1.2 Cr'], ['', '9820000001', '', 'Walk-in', p, 'Site visit', '16-11-2026', '20-11-2026', '']], widths: [24, 14, 26, 16, 22, 12, 13, 14, 40] },
    { name: 'How to fill', rows: [['Column', 'What to write'], ['Phone or email', 'Each lead needs a phone number or an email. A number already in the ERP is not added twice.'], ['Source', Object.values(L.SRCNAME).join(', ')], ['Project', projects.map((x) => `${x.code || ''}${x.code ? ' (' : ''}${x.name}${x.code ? ')' : ''}`).join(', ') || 'Your project code or name'], ['Status', Object.values(STATUS).join(', ')], ['Dates', 'Day-month-year (15-11-2026) or year-month-day (2026-11-15)'], [], ['', 'Imported leads go to your sales team as usual. Nobody is sent a WhatsApp or email for them.']], widths: [18, 100] },
  ]);
}

const pick = (map, s) => { const t = String(s || '').trim().toLowerCase(); if (!t) return ''; const hit = Object.entries(map).find(([k, l]) => k === t || l.toLowerCase() === t); return hit ? hit[0] : null; };
function date(v, label, row) {
  let s = String(v || '').trim(); if (!s) return null;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) s = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw fail(400, `${row}: the ${label} "${v}" is not a date.`);
  return s;
}

async function importRows(u, rows) {
  if (!rows.length || !/name/i.test(String(rows[0][0] || '')) || !/phone/i.test(String(rows[0][1] || ''))) throw fail(400, 'The first row must be the column names from the template. Download the template from this screen and fill that in.');
  const projects = await db.q('select id, code, name from projects where active');
  const findP = (s) => { const t = String(s || '').trim().toLowerCase(); if (!t) return ''; const p = projects.find((x) => (x.code || '').toLowerCase() === t || x.name.toLowerCase() === t); return p ? p.id : null; };
  const problems = [], list = [], seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = Array.from({ length: HEAD.length }, (_, k) => String((rows[i] || [])[k] == null ? '' : rows[i][k]).trim());
    if (!r.some(Boolean)) continue;
    const row = `Row ${i + 1}${r[0] ? ' (' + r[0] + ')' : ''}`;
    try {
      const digits = r[1].replace(/\D/g, '');
      if (r[1] && digits.length < 10) throw fail(400, `${row}: the phone "${r[1]}" has fewer than 10 digits.`);
      const phone = L.phone10(r[1]), email = r[2] ? r[2].slice(0, 160) : null;
      if (!phone && !email) throw fail(400, `${row}: give a phone number or an email.`);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, `${row}: the email "${email}" does not look right.`);
      const k = phone || email.toLowerCase();
      if (seen.has(k)) throw fail(400, `${row}: ${phone || email} is in the file twice.`); seen.add(k);
      const source = pick(L.SRCNAME, r[3]); if (source === null) throw fail(400, `${row}: source "${r[3]}" is not one of ${Object.values(L.SRCNAME).join(', ')}.`);
      const projectId = findP(r[4]); if (projectId === null) throw fail(400, `${row}: project "${r[4]}" is not in the ERP. Use its code or name.`);
      const status = pick(STATUS, r[5]); if (status === null) throw fail(400, `${row}: status "${r[5]}" is not one of ${Object.values(STATUS).join(', ')}.`);
      const at = date(r[6], 'enquiry date', row); if (at && at > today()) throw fail(400, `${row}: the enquiry date cannot be after today.`);
      list.push({ name: r[0].slice(0, 120) || null, phone, email, source: source || 'other', projectId: projectId || null, status: status || 'new', at, next: date(r[7], 'next call date', row), note: r[8].slice(0, 2000) || null });
    } catch (e) { if (!e.status) throw e; problems.push(e.message); }
  }
  if (problems.length) throw Object.assign(fail(400, `${problems.length} row${problems.length === 1 ? ' has a problem' : 's have problems'}. Nothing was saved. Fix ${problems.length === 1 ? 'it' : 'them'} in Excel and upload again.`), { extra: { problems } });
  if (!list.length) throw fail(400, 'The file has no leads under the column names.');
  if (list.length > 5000) throw fail(400, 'Upload at most 5,000 leads at a time.');
  let added = 0, merged = 0;
  for (const x of list) {
    const dup = x.phone ? await db.one('select id from mkt_leads where phone = $1 limit 1', [x.phone]) : await db.one('select id from mkt_leads where lower(email) = lower($1) limit 1', [x.email]);
    if (dup) { await L.add({ ...x, at: x.at ? x.at + 'T10:00:00+05:30' : null, welcome: false, by: u.id }); merged++; continue; }
    const when = x.at ? new Date(x.at + 'T10:00:00+05:30') : new Date();
    const r = await db.one(`insert into mkt_leads (project_id, name, phone, email, source, sources, status, next_date, note, created_at, created_by, first_contact_at, visit_at)
      values ($1, $2, $3, $4, $5, array[$5], $6, $7, $8, $9, $10, $11, $12) on conflict (phone) where phone is not null do nothing returning id`,
    [x.projectId, x.name, x.phone, x.email, x.source, x.status, x.next, x.note, when, u.id, x.status !== 'new' ? when : null, ['visit', 'booked'].includes(x.status) ? when : null]);
    if (!r) { merged++; continue; }
    added++;
    await L.route(r.id).catch(() => {});
  }
  return { added, merged };
}

module.exports = { HEAD, STATUS, template, importRows };
