const $ = (q, el = document) => el.querySelector(q), $$ = (q, el = document) => [...el.querySelectorAll(q)], esc = (v) => Shell.esc(v);
let S = null, TAB = 'staff', EDIT = false, SELF = false;
// third value: 1 = HR Edit only, 2 = not for a staff login (own record only), 3 = staff login only
const TABS = [['me', 'My details', 3], ['staff', 'Employees', 2], ['leave', 'Leave'], ['appraisals', 'Appraisals', 1], ['letters', 'Letters & NDAs', 1], ['policies', 'HR policies'], ['settings', 'Settings', 1], ['log', 'Activity log', 1]];
// Self (staff filling in their own record): only My details for now; leave and policies come later.
const tabOk = ([k, , f]) => (SELF ? k === 'me' : f === 1 ? EDIT : f === 3 ? false : true);

// ---------- formatting (India: dd-mm-yyyy, lakh grouping) ----------
const fd = (iso) => iso ? iso.split('-').reverse().join('-') : '';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const inr = (n) => n == null || n === '' ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function words(n) {
  n = Math.round(+n || 0); if (!n) return 'zero';
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x) => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '');
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' and ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const parts = []; const cr = Math.floor(n / 1e7), l = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, r = n % 1000;
  if (cr) parts.push(three(cr) + ' crore'); if (l) parts.push(two(l) + ' lakh'); if (th) parts.push(two(th) + ' thousand'); if (r) parts.push(three(r));
  return 'Rupees ' + parts.join(' ') + ' only';
}
const fy = (iso) => { const [y, m] = (iso || todayIso()).split('-').map(Number); const s = m >= 4 ? y : y - 1; return { start: `${s}-04-01`, end: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` }; };
const mask = (v, keep = 4) => v ? '•'.repeat(Math.max(0, String(v).length - keep)) + String(v).slice(-keep) : '';
const statusTag = (s) => `<span class="tag ${s === 'Left' ? 'left' : s === 'Active' ? 'ok' : 'wait'}">${esc(s || 'Active')}</span>`;
const empById = (id) => S.employees.find((e) => e.id === id);
// what each person should fill in about themselves, and the documents they should upload
const SELF_NEED = [['dob', 'Date of birth'], ['gender', 'Gender'], ['fatherName', "Father's / spouse's name"], ['address', 'Address'], ['emergencyName', 'Emergency contact'], ['emergencyPhone', 'Emergency phone'],
  ['aadhaarNo', 'Aadhaar no.'], ['panNo', 'PAN'], ['bankName', 'Bank'], ['bankAccount', 'Account no.'], ['ifsc', 'IFSC']];
const DOC_NEED = ['Aadhaar', 'PAN', 'Photo', 'Bank / cancelled cheque'];
const missingOf = (e) => [...SELF_NEED.filter(([k]) => !e[k]).map(([, l]) => l), ...DOC_NEED.filter((t) => !(e.docs || []).some((d) => d.type === t)).map((t) => t + ' copy')];

async function api(op, data) {
  const r = await fetch('/api/hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ op, ...data }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
async function load() {
  const r = await fetch('/api/hr', { cache: 'no-store', credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not load HR data.');
  S = j; EDIT = j.level === 'edit'; SELF = j.level === 'self';
}
function say(msg) { $('#err').textContent = msg || ''; }
function tabs() {
  const pend = (S.leave || []).filter((l) => l.status === 'Pending').length;
  $('#tabs').innerHTML = TABS.filter(tabOk).map(([k, l]) => `<button aria-pressed="${k === TAB}" data-t="${k}">${l === 'Employees' && !EDIT ? 'Staff list' : l}${k === 'leave' && pend && EDIT ? `<span class="n">${pend}</span>` : ''}</button>`).join('');
}
$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; try { history.replaceState(null, '', '#' + TAB); } catch {} show(); };
function show() { tabs(); say(''); ({ me: myDetails, staff, leave, appraisals, letters, policies, settings, log: activity })[TAB](); }

// ---------- employees ----------
let FILTER = { q: '', dept: '', status: 'current' };
function staff() {
  const list = S.employees.filter((e) => (FILTER.status === 'current' ? e.status !== 'Left' : FILTER.status === 'all' ? true : e.status === FILTER.status)
    && (!FILTER.dept || e.department === FILTER.dept)
    && (!FILTER.q || [e.name, e.empNo, e.designation, e.department, e.phone, e.email].join(' ').toLowerCase().includes(FILTER.q.toLowerCase())));
  const cur = S.employees.filter((e) => e.status !== 'Left');
  const monthly = cur.reduce((t, e) => t + (+e.gross || 0), 0);
  const missing = EDIT ? cur.filter((e) => !['Aadhaar', 'PAN', 'Offer letter (signed)', 'NDA (signed)'].every((t) => (e.docs || []).some((d) => d.type === t))).length : 0;
  const depts = [...new Set([...S.departments, ...S.employees.map((e) => e.department).filter(Boolean)])];
  $('#view').innerHTML = `<div class="panel">
    <h1>${EDIT ? 'Employees' : 'Staff list'}</h1>
    <p class="sub">${EDIT ? 'Everyone on the payroll, with their job, salary and document copies. Click a name to open their record. Salaries, ID numbers, bank details and documents are seen only by logins with HR Edit access.' : 'Names, roles and contact details of current staff.'}</p>
    ${EDIT ? `<div class="figs" style="margin-top:14px"><div><b>${cur.length}</b><span>Current employees</span></div><div><b>${cur.filter((e) => e.status === 'On probation').length}</b><span>On probation</span></div><div><b>Rs ${inr(Math.round(monthly))}</b><span>Monthly gross salaries</span></div><div><b>${missing}</b><span>Missing Aadhaar, PAN, offer letter or NDA</span></div></div>` : ''}
    <div class="tools"><label class="field grow">Search<input id="q" value="${esc(FILTER.q)}" placeholder="Name, number, designation, phone"></label>
      <label class="field">Department<select id="fdept"><option value="">All</option>${depts.map((d) => `<option ${d === FILTER.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      ${EDIT ? `<label class="field">Status<select id="fst">${[['current', 'Current staff'], ...S.statuses.map((s) => [s, s]), ['all', 'Everyone']].map(([v, l]) => `<option value="${v}" ${v === FILTER.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn go" id="add">Add employee</button></div>
    <div class="bar2" style="margin:-4px 0 14px"><label class="btn">Upload Excel<input type="file" id="xlin" accept=".xlsx" hidden></label><a class="btn" href="/hr-employee-template.xlsx" download="HR employee list - fill in.xlsx">Blank Excel template</a>
      <button class="btn" id="xlout">Download list (Excel)</button><button class="btn" id="bulk">Upload documents in bulk</button><button class="btn" id="csv">CSV</button></div>` : '</div>'}
    ${list.length ? `<div class="tbl"><table><thead><tr><th>No.</th><th>Name</th><th>Designation</th><th>Department</th><th>Start date</th>${EDIT ? '<th class="num">Monthly gross (Rs)</th><th>Documents</th><th>Own details</th><th>Status</th>' : '<th>Phone</th><th>Email</th>'}</tr></thead><tbody>
    ${list.map((e) => `<tr ${EDIT ? `class="click" data-id="${e.id}"` : ''}><td>${esc(e.empNo)}</td><td><b>${esc([e.title, e.name].filter(Boolean).join(' '))}</b></td><td>${esc(e.designation)}</td><td>${esc(e.department)}</td><td>${fd(e.startDate)}</td>
      ${EDIT ? `<td class="num">${inr(e.gross)}</td><td>${(e.docs || []).length || '<span class="muted">None</span>'}</td><td>${(() => { const m = missingOf(e).length; return !e.login ? '<span class="muted">No login</span>' : m ? `<span class="tag wait" title="${esc(missingOf(e).join(', '))}">${m} to fill in</span>` : '<span class="tag ok">Complete</span>'; })()}</td><td>${statusTag(e.status)}</td>` : `<td>${esc(e.phone)}</td><td>${esc(e.email)}</td>`}</tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${S.employees.length ? 'Nobody matches these filters.' : EDIT ? 'No employees yet. Use <b>Add employee</b> to enter the first one.' : 'No staff entered yet.'}</div>`}
  </div>`;
  $('#q').oninput = (e) => { FILTER.q = e.target.value; const pos = e.target.selectionStart; staff(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); };
  $('#fdept').onchange = (e) => { FILTER.dept = e.target.value; staff(); };
  if (!EDIT) return;
  $('#fst').onchange = (e) => { FILTER.status = e.target.value; staff(); };
  $('#add').onclick = () => openEmp(null);
  $('#csv').onclick = downloadCsv;
  $('#xlin').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) hrExcel.importFile(f); };
  $('#xlout').onclick = () => hrExcel.downloadList().catch((x) => say(x.message));
  $('#bulk').onclick = () => hrExcel.bulkDocs();
  $$('tr[data-id]').forEach((tr) => (tr.onclick = () => openEmp(tr.dataset.id)));
}
function downloadCsv() {
  const cols = [['empNo', 'Employee no.'], ['title', 'Title'], ['name', 'Name'], ['designation', 'Designation'], ['department', 'Department'], ['grade', 'Grade'], ['reportingTo', 'Reports to'], ['location', 'Location'],
    ['employmentType', 'Type'], ['status', 'Status'], ['startDate', 'Start date'], ['confirmDate', 'Confirmation date'], ['endDate', 'Last day'], ['phone', 'Phone'], ['email', 'Work email'], ['dob', 'Date of birth'],
    ['ctc', 'Annual CTC'], ['gross', 'Monthly gross'], ['basic', 'Basic'], ['hra', 'HRA'], ['allowances', 'Other allowances'], ['panNo', 'PAN'], ['uan', 'UAN'], ['bankName', 'Bank'], ['ifsc', 'IFSC']];
  const cell = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
  const rows = [cols.map((c) => c[1]), ...S.employees.map((e) => cols.map(([k]) => (/Date$|^dob$/.test(k) ? fd(e[k]) : e[k])))];
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Employees ${fd(todayIso())}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

const F = (k, label, e, o = {}) => {
  const v = e?.[k] ?? '';
  if (o.options) return `<label class="field">${label}<select name="${k}">${o.blank ? '<option value=""></option>' : ''}${o.options.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
  if (o.area) return `<label class="field" style="grid-column:1/-1">${label}<textarea name="${k}" rows="${o.area}">${esc(v)}</textarea></label>`;
  return `<label class="field">${label}<input name="${k}" type="${o.type || 'text'}" value="${esc(v)}" ${o.list ? `list="${o.list}"` : ''} ${o.req ? 'required' : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''}></label>`;
};
function balances(e, year = fy()) {
  const taken = {};
  (S.leave || []).filter((l) => l.empId === e.id && l.status === 'Approved' && l.from >= year.start && l.from <= year.end).forEach((l) => (taken[l.type] = (taken[l.type] || 0) + l.days));
  const start = e.startDate && e.startDate > year.start ? e.startDate : year.start;
  const today = todayIso() < year.end ? todayIso() : year.end;
  const months = Math.max(0, (+today.slice(0, 4) - +start.slice(0, 4)) * 12 + (+today.slice(5, 7) - +start.slice(5, 7)) + (today.slice(8) >= start.slice(8) ? 1 : 0));
  const joinedMid = e.startDate && e.startDate > year.start;
  return S.leaveTypes.filter((t) => balanceType(t) || taken[t.key]).map((t) => {
    let ent = t.accrues ? Math.min(t.days, Math.round(t.days / 12 * months * 4) / 4) : joinedMid && ['SL', 'CL'].includes(t.key) ? Math.round(t.days * (12 - monthsBetween(year.start, e.startDate)) / 12 * 2) / 2 : t.days;
    if (t.key === 'EL') ent += +e.elOpening || 0;
    return { ...t, ent, taken: taken[t.key] || 0, left: ent - (taken[t.key] || 0) };
  });
}
// the leave types whose balance is tracked: annual, sick, casual and any that build up monthly
const balanceType = (t) => t.days > 0 && (t.accrues || ['EL', 'SL', 'CL'].includes(t.key));
const monthsBetween = (a, b) => Math.max(0, (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)));

function openEmp(id) {
  const e = id ? empById(id) : { status: 'On probation', employmentType: 'Probation', startDate: todayIso(), pf: true };
  const w = document.createElement('div'); w.className = 'scrim';
  const dl = `<datalist id="depts">${S.departments.map((d) => `<option>${esc(d)}</option>`).join('')}</datalist><datalist id="people">${S.employees.map((x) => `<option>${esc(x.name)}</option>`).join('')}</datalist>`;
  const docs = e.docs || [];
  const needs = ['Aadhaar', 'PAN', 'Photo', 'Educational certificate', 'Offer letter (signed)', 'NDA (signed)', 'Bank / cancelled cheque'];
  const bal = id ? balances(e) : [];
  w.innerHTML = `<div class="side" role="dialog" aria-modal="true" aria-label="Employee"><div class="hd"><h2>${id ? esc(e.empNo + ' · ' + e.name) : 'Add employee'}</h2><button class="btn small" data-x>Close</button></div>
  <form class="bd" autocomplete="off">${dl}
    <div class="box"><h3>Job</h3><div class="grid tight">
      ${F('empNo', 'Employee no.', e, { ph: 'Given automatically' })}${F('title', 'Title', e, { options: ['Mr', 'Ms', 'Mrs', 'Dr'], blank: true })}${F('name', 'Full name', e, { req: true })}
      ${F('designation', 'Designation', e, { ph: 'e.g. Sales Executive' })}${F('department', 'Department', e, { list: 'depts' })}${F('grade', 'Grade / level', e)}
      ${F('reportingTo', 'Reports to', e, { list: 'people' })}${F('location', 'Place of work', e, { ph: 'Head office / Site' })}${F('employmentType', 'Type', e, { options: S.types })}
      ${F('startDate', 'Start date', e, { type: 'date' })}${F('confirmDate', 'Confirmation date', e, { type: 'date' })}${F('status', 'Status', e, { options: S.statuses })}
      ${F('endDate', 'Last working day', e, { type: 'date' })}
      <label class="field">Portal login (for their own leave requests)<select name="login"><option value=""></option>${(S.logins || []).map((l) => `<option value="${esc(l.username)}" ${l.username === e.login ? 'selected' : ''}>${esc(l.name)} (${esc(l.username)})</option>`).join('')}</select></label>
    </div></div>
    <div class="box"><h3>Personal and contact</h3><div class="grid tight">
      ${F('phone', 'Mobile', e, { type: 'tel' })}${F('email', 'Work email', e, { type: 'email' })}${F('personalEmail', 'Personal email', e, { type: 'email' })}
      ${F('dob', 'Date of birth', e, { type: 'date' })}${F('gender', 'Gender', e, { options: ['Male', 'Female', 'Other'], blank: true })}${F('fatherName', "Father's / spouse's name", e)}
      ${F('qualification', 'Qualification', e)}${F('emergencyName', 'Emergency contact', e)}${F('emergencyPhone', 'Emergency phone', e, { type: 'tel' })}
      ${F('address', 'Address', e, { area: 2 })}
    </div></div>
    <div class="box"><h3>Salary <span class="lock">🔒 HR Edit access only</span></h3><div class="grid tight">
      ${F('ctc', 'Annual CTC (Rs)', e, { type: 'number' })}${F('gross', 'Monthly gross (Rs)', e, { type: 'number' })}${F('basic', 'Basic per month', e, { type: 'number' })}
      ${F('hra', 'HRA per month', e, { type: 'number' })}${F('allowances', 'Other allowances per month', e, { type: 'number' })}
      <div style="display:flex;gap:18px;align-items:end;padding-bottom:10px"><label class="chk"><input type="checkbox" name="pf" ${e.pf ? 'checked' : ''}> PF</label><label class="chk"><input type="checkbox" name="esi" ${e.esi ? 'checked' : ''}> ESI</label></div>
      <label class="field">If the CTC changed: from<input type="date" name="salaryFrom"></label><label class="field">Reason for the change<input name="salaryReason" placeholder="e.g. Appraisal, promotion"></label>
    </div>
    ${(e.salaryHistory || []).length ? `<div class="tbl"><table style="min-width:0"><thead><tr><th>From</th><th class="num">Annual CTC (Rs)</th><th>Reason</th><th>By</th></tr></thead><tbody>${e.salaryHistory.slice().reverse().map((h) => `<tr><td>${fd(h.from)}</td><td class="num">${inr(h.ctc)}</td><td>${esc(h.reason)}</td><td class="muted">${esc(h.by)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="box"><h3>ID numbers and bank <span class="lock">🔒 HR Edit access only</span></h3><div class="grid tight">
      ${F('aadhaarNo', 'Aadhaar no.', e, { ph: '12 digits' })}${F('panNo', 'PAN', e, { ph: 'ABCDE1234F' })}${F('uan', 'PF UAN', e)}${F('esiNo', 'ESI no.', e)}
      ${F('bankName', 'Bank', e)}${F('bankAccount', 'Account no.', e)}${F('ifsc', 'IFSC', e)}
    </div></div>
    <div class="box"><h3>Documents <span class="lock">🔒 HR Edit access only</span></h3>
      ${id ? `<div class="need">${needs.map((t) => `<span class="${docs.some((d) => d.type === t) ? 'have' : ''}">${docs.some((d) => d.type === t) ? '✓ ' : ''}${esc(t)}</span>`).join('')}</div>
      <div class="docs" id="docs">${docs.length ? docs.map((d) => `<div class="doc"><span class="ic">${esc((d.kind || 'file').toUpperCase())}</span><div class="grow"><div class="t">${esc(d.type)}${d.label ? ' · ' + esc(d.label) : ''}</div><div class="m">${esc(d.name)} · ${kb(d.size)} · ${fd((d.at || '').slice(0, 10))}</div></div>
        <a class="btn small" href="/api/hr?file=${d.id}" target="_blank" rel="noopener">Open</a><a class="btn small" href="/api/hr?file=${d.id}&dl=1">Download</a><button type="button" class="btn small warn" data-del="${d.id}">Delete</button></div>`).join('') : '<p class="sub" style="margin:0">No documents yet.</p>'}</div>
      <div class="bar2"><label class="field" style="min-width:200px">Type<select id="dtype">${S.docTypes.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label><label class="field" style="flex:1;min-width:160px">Note (optional)<input id="dlabel" placeholder="e.g. B.Com degree"></label>
        <label class="btn go" style="align-self:end">Upload a file<input type="file" id="dfile" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,image/*,application/pdf" hidden></label></div>
      <div class="bar2" id="dprog" hidden><div class="prog"><i></i></div><span class="sub" id="dmsg"></span></div>
      <p class="sub" style="font-size:12.5px;margin:0">PDF, photo or Word file, up to 4 MB. Phone photos are shrunk before upload. Each time a document is opened it is recorded in the Activity log.</p>`
      : '<p class="sub" style="margin:0">Save the employee first, then upload their Aadhaar, PAN, certificates, offer letter and NDA here.</p>'}
    </div>
    ${id ? `<div class="box"><h3>Leave this year (${fy().label})</h3>
      <div class="tbl"><table style="min-width:0"><thead><tr><th>Type</th><th class="num">Entitled</th><th class="num">Taken</th><th class="num">Left</th></tr></thead><tbody>${bal.map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${b.ent}</td><td class="num">${b.taken}</td><td class="num"><b>${b.left}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="grid tight">${F('elOpening', 'Annual leave carried forward from last year (days)', e, { type: 'number' })}</div></div>
      <div class="box"><h3>Letters</h3><div class="bar2">${(S.templates || []).map((t) => `<button type="button" class="btn small" data-letter="${t.id}">${esc(t.title)}</button>`).join('')}</div>
      <p class="sub" style="font-size:12.5px;margin:0">Opens the letter filled in with this employee's details, ready to check, print and sign. Upload the signed copy above.</p></div>` : ''}
    <div class="box"><h3>Notes</h3>${F('notes', 'Private HR notes', e, { area: 3 })}</div>
    <div class="err" id="ferr" role="alert"></div>
    <div class="bar2"><button class="btn go">${id ? 'Save changes' : 'Add employee'}</button><button type="button" class="btn" data-x>Cancel</button>
      ${id && S.me.role === 'admin' ? '<button type="button" class="btn warn" id="delEmp" style="margin-left:auto">Delete employee</button>' : ''}</div>
  </form></div>`;
  document.body.appendChild(w);
  const close = () => { w.remove(); show(); };
  $$('[data-x]', w).forEach((b) => (b.onclick = close));
  w.addEventListener('click', (ev) => { if (ev.target === w) close(); });
  const form = $('form', w);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { id: id || undefined };
    $$('input[name],select[name],textarea[name]', form).forEach((i) => (data[i.name] = i.type === 'checkbox' ? i.checked : i.value));
    try {
      const r = await api('saveEmployee', { data });
      await load();
      if (!id) { w.remove(); openEmp(r.employee.id); return; }
      close();
    } catch (x) { $('#ferr', w).textContent = x.message; }
  };
  const del = $('#delEmp', w);
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${e.name} and all their documents? This cannot be undone. To keep the record, set the status to Left instead.`)) return;
    try { await api('deleteEmployee', { id }); await load(); close(); } catch (x) { $('#ferr', w).textContent = x.message; }
  };
  $$('[data-del]', w).forEach((b) => (b.onclick = async () => {
    const d = docs.find((x) => x.id === b.dataset.del);
    if (!confirm(`Delete the ${d.type} copy (${d.name})?`)) return;
    try { await api('deleteFile', { empId: id, fileId: d.id }); await load(); w.remove(); openEmp(id); } catch (x) { $('#ferr', w).textContent = x.message; }
  }));
  $$('[data-letter]', w).forEach((b) => (b.onclick = () => { w.remove(); TAB = 'letters'; show(); pickLetter(b.dataset.letter, id); }));
  const fileIn = $('#dfile', w);
  if (fileIn) fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    $('#dprog', w).hidden = false; const bar = $('.prog i', w), msg = $('#dmsg', w);
    try {
      msg.textContent = 'Preparing…';
      const bytes = await shrink(f);
      if (bytes.length > 4 * 1024 * 1024) throw new Error('That file is over 4 MB. Scan at a lower resolution or save the PDF smaller.');
      const st = await api('fileStart', { empId: id, type: $('#dtype', w).value, label: $('#dlabel', w).value, name: f.name, size: bytes.length });
      const n = Math.ceil(bytes.length / st.chunk);
      for (let i = 0; i < n; i++) {
        msg.textContent = `Uploading ${Math.round(i / n * 100)}%`; bar.style.width = (i / n * 100) + '%';
        await api('fileChunk', { fileId: st.fileId, i, data: b64(bytes.subarray(i * st.chunk, (i + 1) * st.chunk)) });
      }
      bar.style.width = '100%'; msg.textContent = 'Checking…';
      await api('fileDone', { fileId: st.fileId });
      await load(); w.remove(); openEmp(id);
    } catch (x) { msg.textContent = x.message; bar.style.width = '0'; }
  };
}
// photos over 600 KB are resized to 2000 px and saved as JPEG; other files are sent as they are
async function shrink(f) {
  const raw = new Uint8Array(await f.arrayBuffer());
  if (!/^image\/(jpeg|png|webp|heic)/.test(f.type) || raw.length < 600 * 1024) return raw;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    const out = new Uint8Array(await blob.arrayBuffer());
    return out.length < raw.length ? out : raw;
  } catch { return raw; }
}
window.hrShrink = (f) => shrink(f); window.hrB64 = (u8) => b64(u8);
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

// ---------- my details (staff login: own record only) ----------
function myDetails() {
  const e = S.employees[0];
  if (!e) { $('#view').innerHTML = '<div class="panel"><h1>My details</h1><div class="draftnote" style="margin-top:14px">Your login is not linked to an employee record yet. Ask HR to link it.</div></div>'; return; }
  const docs = e.docs || [], miss = missingOf(e);
  const ro = (l, v) => `<div><small class="muted" style="display:block;font-size:12.5px">${l}</small><b>${v || '<span class="muted" style="font-weight:400">Not entered</span>'}</b></div>`;
  $('#view').innerHTML = `<form class="panel" id="myf" autocomplete="off"><h1>My details</h1>
    <p class="sub">Your own HR record. Only you and HR can see it. Fill in the blanks, upload copies of your documents, and press Save. HR keeps your job and salary details; tell HR if anything there is wrong.</p>
    ${miss.length ? `<div class="draftnote" style="margin-top:14px"><b>Still to fill in:</b> ${esc(miss.join(', '))}</div>` : '<div class="ok" style="margin-top:14px">Thank you. Your details are complete.</div>'}
    <div class="box" style="margin-top:14px"><h3>Job <span class="lock">🔒 Kept by HR</span></h3><div class="grid tight">
      ${ro('Employee no.', esc(e.empNo))}${ro('Name', esc(e.name))}${ro('Designation', esc(e.designation))}${ro('Department', esc(e.department))}${ro('Place of work', esc(e.location))}${ro('Date of joining', fd(e.startDate))}
      ${ro('Monthly salary (gross)', e.gross ? 'Rs ' + inr(e.gross) : '')}${e.ctc ? ro('Annual CTC', 'Rs ' + inr(e.ctc)) : ''}${ro('Work email', esc(e.email))}</div></div>
    <div class="box"><h3>Personal and contact</h3><div class="grid tight">
      ${F('title', 'Title', e, { options: ['Mr', 'Ms', 'Mrs', 'Dr'], blank: true })}${F('phone', 'Mobile', e, { type: 'tel' })}${F('personalEmail', 'Personal email', e, { type: 'email' })}
      ${F('dob', 'Date of birth', e, { type: 'date' })}${F('gender', 'Gender', e, { options: ['Male', 'Female', 'Other'], blank: true })}${F('fatherName', "Father's / spouse's name", e)}
      ${F('qualification', 'Highest qualification', e)}${F('emergencyName', 'Emergency contact (name and relation)', e)}${F('emergencyPhone', 'Emergency phone', e, { type: 'tel' })}
      ${F('address', 'Home address', e, { area: 2 })}</div></div>
    <div class="box"><h3>ID numbers and bank (for salary)</h3><div class="grid tight">
      ${F('aadhaarNo', 'Aadhaar no.', e, { ph: '12 digits' })}${F('panNo', 'PAN', e, { ph: 'ABCDE1234F' })}${F('uan', 'PF UAN (if you have one)', e)}${F('esiNo', 'ESI no. (if you have one)', e)}
      ${F('bankName', 'Bank name', e)}${F('bankAccount', 'Account no.', e)}${F('ifsc', 'IFSC', e, { ph: 'e.g. HDFC0001234' })}</div></div>
    <div class="err" id="merr" role="alert"></div><div class="ok" id="mok" role="status"></div>
    <div class="bar2"><button class="btn go">Save my details</button></div>
    <div class="box"><h3>My documents</h3>
      <div class="need">${DOC_NEED.map((t) => `<span class="${docs.some((d) => d.type === t) ? 'have' : ''}">${docs.some((d) => d.type === t) ? '✓ ' : ''}${esc(t)}</span>`).join('')}</div>
      <div class="docs">${docs.length ? docs.map((d) => `<div class="doc"><span class="ic">${esc((d.kind || 'file').toUpperCase())}</span><div class="grow"><div class="t">${esc(d.type)}${d.label ? ' · ' + esc(d.label) : ''}</div><div class="m">${esc(d.name)} · ${kb(d.size)} · ${fd((d.at || '').slice(0, 10))}</div></div>
        <a class="btn small" href="/api/hr?file=${d.id}" target="_blank" rel="noopener">Open</a>${d.by === S.me.username ? `<button type="button" class="btn small warn" data-mdel="${d.id}">Delete</button>` : ''}</div>`).join('') : '<p class="sub" style="margin:0">No documents yet.</p>'}</div>
      <div class="bar2"><label class="field" style="min-width:200px">Type<select id="mtype">${(S.selfDocs || []).map((t) => `<option>${esc(t)}</option>`).join('')}</select></label><label class="field" style="flex:1;min-width:160px">Note (optional)<input id="mlabel" placeholder="e.g. B.Com degree"></label>
        <label class="btn go" style="align-self:end">Upload a file<input type="file" id="mfile" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,image/*,application/pdf" hidden></label></div>
      <div class="bar2" id="mprog" hidden><div class="prog"><i></i></div><span class="sub" id="mmsg"></span></div>
      <p class="sub" style="font-size:12.5px;margin:0">A clear phone photo or a PDF, up to 4 MB. Photos are made smaller before upload.</p></div>
  </form>`;
  const form = $('#myf');
  form.onsubmit = async (ev) => {
    ev.preventDefault(); $('#merr').textContent = ''; $('#mok').textContent = '';
    const data = {}; (S.selfFields || []).forEach((k) => { if (form.elements[k]) data[k] = form.elements[k].value; });
    try { await api('saveMyDetails', { id: e.id, data }); await load(); myDetails(); $('#mok').textContent = 'Saved. Thank you.'; } catch (x) { $('#merr').textContent = x.message; }
  };
  $$('[data-mdel]').forEach((b) => (b.onclick = async () => {
    const d = docs.find((x) => x.id === b.dataset.mdel);
    if (!confirm(`Delete the ${d.type} copy (${d.name})?`)) return;
    try { await api('deleteFile', { empId: e.id, fileId: d.id }); await load(); myDetails(); } catch (x) { $('#merr').textContent = x.message; }
  }));
  const fileIn = $('#mfile');
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    $('#mprog').hidden = false; const bar = $('#mprog .prog i'), msg = $('#mmsg');
    try {
      msg.textContent = 'Preparing…';
      const bytes = await shrink(f);
      if (bytes.length > 4 * 1024 * 1024) throw new Error('That file is over 4 MB. Take the photo again or save the PDF smaller.');
      const st = await api('fileStart', { empId: e.id, type: $('#mtype').value, label: $('#mlabel').value, name: f.name, size: bytes.length });
      const n = Math.ceil(bytes.length / st.chunk);
      for (let i = 0; i < n; i++) { msg.textContent = `Uploading ${Math.round(i / n * 100)}%`; bar.style.width = (i / n * 100) + '%'; await api('fileChunk', { fileId: st.fileId, i, data: b64(bytes.subarray(i * st.chunk, (i + 1) * st.chunk)) }); }
      bar.style.width = '100%'; msg.textContent = 'Checking…';
      await api('fileDone', { fileId: st.fileId });
      await load(); myDetails();
    } catch (x) { msg.textContent = x.message; bar.style.width = '0'; }
  };
}

// ---------- leave ----------
let LF = 'Pending';
function leave() {
  const mineIds = S.mine || [];
  const people = EDIT ? S.employees.filter((e) => e.status !== 'Left') : S.employees.filter((e) => mineIds.includes(e.id));
  const list = (S.leave || []).filter((l) => LF === 'All' || l.status === LF);
  const year = fy();
  $('#view').innerHTML = `<div class="panel"><h1>Leave</h1>
    <p class="sub">${EDIT ? 'Enter leave requests, approve or reject them, and see everyone\'s balance for the year. Sundays and the holiday list are not counted.' : 'Ask for leave and see your requests. HR approves them.'}</p>
    ${people.length ? `<form id="lr" class="box" style="margin-top:14px"><h3>${EDIT ? 'New leave request' : 'Ask for leave'}</h3><div class="grid tight">
      <label class="field">Employee<select name="empId">${people.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.empNo)})</option>`).join('')}</select></label>
      <label class="field">Type<select name="type">${S.leaveTypes.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</select></label>
      <label class="field">From<input type="date" name="from" required value="${todayIso()}"></label><label class="field">To<input type="date" name="to" value="${todayIso()}"></label>
      <div style="display:flex;align-items:end;padding-bottom:10px"><label class="chk"><input type="checkbox" name="half"> Half day</label></div>
      <label class="field" style="grid-column:1/-1">Reason<input name="reason" placeholder="Optional"></label></div>
      <div class="err" id="lerr" role="alert"></div><div><button class="btn go">Send request</button></div></form>`
      : !EDIT ? '<div class="draftnote" style="margin-top:14px">Your login is not linked to an employee record yet. Ask HR to link it, then you can ask for leave here.</div>' : ''}
    <div class="tools"><div class="seg" id="lf">${['Pending', 'Approved', 'Rejected', 'Cancelled', 'All'].map((s) => `<button type="button" aria-pressed="${s === LF}" data-s="${s}">${s}</button>`).join('')}</div></div>
    ${list.length ? `<div class="tbl"><table><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((l) => `<tr><td><b>${esc(l.empName)}</b><br><span class="muted" style="font-size:12.5px">asked by ${esc(l.requestedBy)} on ${fd(l.requestedAt.slice(0, 10))}</span></td><td>${esc(l.typeLabel)}</td><td>${fd(l.from)}</td><td>${fd(l.to)}</td><td class="num">${l.days}</td><td style="max-width:240px">${esc(l.reason)}${l.note ? `<br><span class="muted">HR: ${esc(l.note)}</span>` : ''}</td>
        <td>${l.status === 'Approved' ? '<span class="tag ok">Approved</span>' : l.status === 'Pending' ? '<span class="tag wait">Pending</span>' : `<span class="tag left">${esc(l.status)}</span>`}${l.decidedBy ? `<br><span class="muted" style="font-size:12px">${esc(l.decidedBy)}</span>` : ''}</td>
        <td style="white-space:nowrap">${l.status === 'Pending' ? (EDIT ? `<button class="btn small go" data-d="Approved" data-id="${l.id}">Approve</button> <button class="btn small warn" data-d="Rejected" data-id="${l.id}">Reject</button> ` : '') + `<button class="btn small" data-d="Cancelled" data-id="${l.id}">Cancel</button>` : EDIT && l.status === 'Approved' ? `<button class="btn small" data-d="Cancelled" data-id="${l.id}">Cancel</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">No ${LF === 'All' ? '' : LF.toLowerCase() + ' '}leave requests.</div>`}
  </div>
  ${EDIT && S.employees.some((e) => e.status !== 'Left') ? `<div class="panel"><h2>Balances, ${year.label}</h2><p class="sub">Days left after approved leave. Annual leave builds up month by month and includes what was carried forward.</p>
    <div class="tbl" style="margin-top:12px"><table><thead><tr><th>Employee</th>${S.leaveTypes.filter(balanceType).map((t) => `<th class="num">${esc(t.label)}</th>`).join('')}</tr></thead><tbody>
    ${S.employees.filter((e) => e.status !== 'Left').map((e) => { const b = Object.fromEntries(balances(e).map((x) => [x.key, x])); return `<tr><td>${esc(e.name)}</td>${S.leaveTypes.filter(balanceType).map((t) => `<td class="num">${b[t.key] ? `<b style="${b[t.key].left < 0 ? 'color:var(--risk)' : ''}">${b[t.key].left}</b> <span class="muted">of ${b[t.key].ent}</span>` : ''}</td>`).join('')}</tr>`; }).join('')}
    </tbody></table></div></div>` : ''}`;
  $('#lf').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { LF = b.dataset.s; leave(); } };
  const lr = $('#lr');
  if (lr) lr.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(lr)); data.half = !!lr.half.checked;
    try { await api('leaveRequest', { data }); await load(); LF = 'Pending'; leave(); } catch (x) { $('#lerr').textContent = x.message; }
  };
  $$('[data-d]').forEach((b) => (b.onclick = async () => {
    const st = b.dataset.d;
    const note = st === 'Rejected' ? prompt('Reason for rejecting (the employee will see it):', '') : '';
    if (note === null) return;
    try { await api('leaveDecide', { id: b.dataset.id, status: st, note }); await load(); leave(); } catch (x) { say(x.message); }
  }));
}

// ---------- appraisals ----------
function appraisals() {
  const list = S.appraisals || [];
  $('#view').innerHTML = `<div class="panel"><h1>Appraisals</h1><p class="sub">One record per employee per year: goals, self-review, the manager's rating and the salary revision. The steps follow the Performance appraisal policy.</p>
    <div class="tools"><button class="btn go" id="newA">New appraisal</button></div>
    ${list.length ? `<div class="tbl"><table><thead><tr><th>Employee</th><th>Period</th><th>Stage</th><th class="num">Rating</th><th class="num">Increment</th><th class="num">New CTC (Rs)</th><th>Salary updated</th></tr></thead><tbody>
    ${list.map((a) => `<tr class="click" data-id="${a.id}"><td><b>${esc(a.empName)}</b></td><td>${esc(a.period)}</td><td>${esc(a.status)}</td><td class="num">${a.rating ?? ''}</td><td class="num">${a.increment != null ? a.increment + '%' : ''}</td><td class="num">${inr(a.newCtc)}</td><td>${a.appliedAt ? fd(a.appliedAt.slice(0, 10)) : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No appraisals yet.</div>'}</div>`;
  $('#newA').onclick = () => openAppr(null);
  $$('tr[data-id]').forEach((tr) => (tr.onclick = () => openAppr(tr.dataset.id)));
}
function openAppr(id) {
  const a = id ? S.appraisals.find((x) => x.id === id) : { period: fy().label, status: 'Goals set' };
  const w = document.createElement('div'); w.className = 'scrim';
  const emp = a.empId ? empById(a.empId) : null;
  w.innerHTML = `<div class="side" role="dialog" aria-modal="true"><div class="hd"><h2>${id ? esc(a.empName + ' · ' + a.period) : 'New appraisal'}</h2><button class="btn small" data-x>Close</button></div>
  <form class="bd"><div class="box"><div class="grid tight">
    <label class="field">Employee<select name="empId">${S.employees.filter((e) => e.status !== 'Left' || e.id === a.empId).map((e) => `<option value="${e.id}" ${e.id === a.empId ? 'selected' : ''}>${esc(e.name)} (${esc(e.empNo)})</option>`).join('')}</select></label>
    ${F('period', 'Period', a)}${F('reviewer', 'Reviewer', a, { list: 'people2' })}${F('status', 'Stage', a, { options: ['Goals set', 'Self-review', 'Manager review', 'Final'] })}
    <datalist id="people2">${S.employees.map((x) => `<option>${esc(x.name)}</option>`).join('')}</datalist></div></div>
    <div class="box"><div class="grid tight">${F('goals', 'Goals for the year (one per line)', a, { area: 5 })}${F('selfReview', "Employee's self-review", a, { area: 5 })}${F('comments', "Manager's comments", a, { area: 5 })}</div></div>
    <div class="box"><h3>Rating and salary <span class="lock">🔒 HR Edit access only</span></h3><div class="grid tight">
      ${F('rating', 'Overall rating', { rating: a.rating ? String(a.rating) : '' }, { options: ['1', '2', '3', '4', '5'], blank: true })}
      ${F('increment', 'Increment %', a, { type: 'number' })}${F('newCtc', 'New annual CTC (Rs)', a, { type: 'number' })}${F('effectiveFrom', 'Effective from', a, { type: 'date' })}</div>
      <p class="sub" style="margin:0;font-size:13px" id="curCtc"></p>
      ${a.appliedAt ? `<p class="sub" style="margin:0">The new salary was applied to the employee record on ${fd(a.appliedAt.slice(0, 10))}.</p>` : '<label class="chk"><input type="checkbox" name="apply"> When saved as Final, update the employee\'s salary to the new CTC</label>'}
      <p class="sub" style="margin:0;font-size:12.5px">1 Does not meet · 2 Partly meets · 3 Meets · 4 Exceeds · 5 Outstanding</p></div>
    <div class="err" id="aerr" role="alert"></div>
    <div class="bar2"><button class="btn go">Save</button><button type="button" class="btn" data-x>Cancel</button>${id ? '<button type="button" class="btn warn" id="delA" style="margin-left:auto">Delete</button>' : ''}</div>
  </form></div>`;
  document.body.appendChild(w);
  const close = () => { w.remove(); show(); };
  $$('[data-x]', w).forEach((b) => (b.onclick = close));
  const form = $('form', w);
  const cur = () => { const e = empById(form.empId.value); $('#curCtc', w).textContent = e && e.ctc ? `Current annual CTC: Rs ${inr(e.ctc)}` : ''; };
  form.empId.onchange = cur; cur();
  form.increment.oninput = () => { const e = empById(form.empId.value); if (e && e.ctc && form.increment.value !== '') form.newCtc.value = Math.round(e.ctc * (1 + +form.increment.value / 100)); };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form)); data.id = id || undefined; data.apply = !!(form.apply && form.apply.checked);
    try { await api('saveAppraisal', { data }); await load(); close(); } catch (x) { $('#aerr', w).textContent = x.message; }
  };
  const del = $('#delA', w);
  if (del) del.onclick = async () => { if (!confirm('Delete this appraisal record?')) return; try { await api('saveAppraisal', { data: { ...a, deleted: true } }); await load(); close(); } catch (x) { $('#aerr', w).textContent = x.message; } };
}

// ---------- letters ----------
let LET = { tpl: 'offer', emp: '' };
function fields(e) {
  const c = S.company, n = (v) => (v == null || v === '' ? '' : inr(v));
  return {
    today: longDate(todayIso()), name: e ? [e.title, e.name].filter(Boolean).join(' ') : '', empNo: e?.empNo, address: e?.address, designation: e?.designation, department: e?.department,
    location: e?.location || c.location, reportingTo: e?.reportingTo, startDate: longDate(e?.startDate), confirmDate: longDate(e?.confirmDate), endDate: longDate(e?.endDate),
    ctc: n(e?.ctc), ctcWords: e?.ctc ? words(e.ctc) : '', gross: n(e?.gross), basic: n(e?.basic), hra: n(e?.hra), allowances: n(e?.allowances),
    offerValidTill: longDate(addDays(todayIso(), 7)), ...c,
  };
}
const fill = (body, f, marks) => body.replace(/\{\{(\w+)\}\}/g, (m, k) => (f[k] ? (marks ? esc(f[k]) : f[k]) : marks ? `<mark>[${esc(k)}]</mark>` : '______________'));
function letters() {
  const t = (S.templates || []).find((x) => x.id === LET.tpl) || S.templates[0];
  LET.tpl = t.id;
  const e = empById(LET.emp);
  $('#view').innerHTML = `<div class="panel"><h1>Letters &amp; NDAs</h1><p class="sub">Pick a letter and an employee. The letter fills in from their record and the company details in Settings. Yellow marks show details still missing. Check it, print it on letterhead (or save as PDF), get it signed, and upload the signed copy to the employee's Documents.</p>
    <div class="tools"><label class="field">Letter<select id="ltpl">${S.templates.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label class="field">Employee<select id="lemp"><option value="">(blank letter)</option>${S.employees.map((x) => `<option value="${x.id}" ${x.id === LET.emp ? 'selected' : ''}>${esc(x.name)} (${esc(x.empNo)})</option>`).join('')}</select></label>
      <button class="btn go" id="lprint">Print or save as PDF</button><button class="btn" id="ledit">Edit this template</button><button class="btn" id="lnew">New template</button></div>
    <div class="letter" id="lbody">${fill(esc(t.body).replace(/\{\{(\w+)\}\}/g, '{{$1}}'), fields(e), true)}</div>
    <p class="sub" style="font-size:12.5px">${t.draft ? 'Standard draft from the portal. Have your lawyer or CA check the NDA and offer letter once before first use, then save your final wording with Edit this template.' : `Last changed by ${esc(t.updatedBy || '')} on ${fd((t.updatedAt || '').slice(0, 10))}.`}</p></div>`;
  $('#ltpl').onchange = (ev) => { LET.tpl = ev.target.value; letters(); };
  $('#lemp').onchange = (ev) => { LET.emp = ev.target.value; letters(); };
  $('#lprint').onclick = () => printDoc(t.title + (e ? ' · ' + e.name : ''), fill(t.body, fields(e), false));
  $('#ledit').onclick = () => editText('template', t);
  $('#lnew').onclick = () => editText('template', { title: '', body: 'Use {{name}}, {{designation}}, {{department}}, {{startDate}}, {{ctc}}, {{company}}, {{signatory}} and other fields in double braces.' });
}
function pickLetter(tpl, emp) { LET = { tpl, emp }; letters(); }
function printDoc(title, text, asPolicy) {
  const w = window.open('', '_blank'); if (!w) { say('Allow pop-ups for the portal to print.'); return; }
  const c = S.company;
  const body = asPolicy ? policyHtml(text) : `<div class="t">${esc(text)}</div>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:A4;margin:18mm 18mm 20mm}body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;margin:0}
    .lh{display:flex;align-items:center;gap:14px;border-bottom:2px solid #140C59;padding-bottom:10px;margin-bottom:22px}.lh img{height:38px}.lh div{font:10pt/1.3 system-ui,sans-serif;color:#444}.lh b{display:block;font-size:12pt;color:#140C59}
    .t{white-space:pre-wrap}h1{font-size:17pt;margin:0 0 12px;color:#140C59}h4{font-size:12.5pt;margin:16px 0 4px}ul{margin:4px 0 8px;padding-left:22px}p{margin:0 0 8px}
    .note{font:9pt system-ui,sans-serif;color:#777;margin-top:30px}@media screen{body{max-width:180mm;margin:20px auto;padding:0 12px}}
  </style></head><body><div class="lh"><img src="${location.origin}/logo.svg" alt=""><div><b>${esc(c.company)}</b>${esc(c.companyAddress)}</div></div>${asPolicy ? `<h1>${esc(title)}</h1>` : ''}${body}
  ${asPolicy ? `<div class="note">Printed from the Dream India Realty portal on ${longDate(todayIso())}.</div>` : ''}<script>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}

// ---------- policies ----------
let POL = '';
function policyHtml(text) {
  let html = '', list = false;
  for (const line of String(text || '').split('\n')) {
    const l = line.trim();
    if (list && !/^[-•]\s/.test(l)) { html += '</ul>'; list = false; }
    if (!l) continue;
    if (l.startsWith('# ')) html += `<h4>${esc(l.slice(2))}</h4>`;
    else if (/^[-•]\s/.test(l)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${esc(l.slice(2))}</li>`; }
    else html += `<p>${esc(l)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
function policies() {
  const list = S.policies;
  const p = list.find((x) => x.id === POL) || list[0];
  if (p) POL = p.id;
  $('#view').innerHTML = `<div class="panel"><h1>HR policies</h1><p class="sub">The rules every employee follows. ${EDIT ? 'Drafts are marked; edit each one to your final wording, then share it with staff.' : 'Ask HR if anything is unclear.'}</p>
    <div class="pols" style="margin-top:16px"><div class="plist">${list.map((x) => `<button data-p="${x.id}" aria-current="${x.id === POL}">${esc(x.title)}<small>${x.draft ? 'First draft, not yet approved' : esc([x.version, x.effectiveFrom && 'from ' + fd(x.effectiveFrom)].filter(Boolean).join(' · '))}</small></button>`).join('')}
      ${EDIT ? '<button id="pnew" style="font-weight:600;color:var(--link)">+ New policy</button>' : ''}</div>
    <div>${p ? `${p.draft && EDIT ? '<div class="draftnote" style="margin-bottom:12px">First draft written for you to review. Leave days, notice periods and statutory items should be checked against your state\'s Shops and Establishments Act and your current practice. Edit and save to make it final.</div>' : ''}
      <div class="bar2" style="margin-bottom:10px"><h2 style="margin:0;flex:1">${esc(p.title)}</h2><button class="btn small" id="pprint">Print</button>${EDIT ? '<button class="btn small" id="pedit">Edit</button>' : ''}</div>
      <div class="doctext">${policyHtml(p.body)}</div>` : '<div class="empty">No policies yet.</div>'}</div></div></div>`;
  $$('[data-p]').forEach((b) => (b.onclick = () => { POL = b.dataset.p; policies(); }));
  if (p) $('#pprint').onclick = () => printDoc(p.title, p.body, true);
  if (EDIT && p) $('#pedit').onclick = () => editText('policy', p);
  if (EDIT) $('#pnew').onclick = () => editText('policy', { title: '', body: '# Purpose\n\n# Who it covers\n\n# The rules\n- ' });
}
function editText(kind, x) {
  const w = document.createElement('div'); w.className = 'scrim';
  w.innerHTML = `<div class="side" role="dialog" aria-modal="true"><div class="hd"><h2>${x.id ? 'Edit ' : 'New '}${kind === 'policy' ? 'policy' : 'letter template'}</h2><button class="btn small" data-x>Close</button></div>
    <form class="bd"><div class="box"><div class="grid tight"><label class="field" style="grid-column:span 2">Title<input name="title" value="${esc(x.title)}" required></label>
      ${kind === 'policy' ? `<label class="field">Version<input name="version" value="${esc(x.draft ? 'Version 1' : x.version || '')}"></label><label class="field">In force from<input type="date" name="effectiveFrom" value="${esc(x.effectiveFrom || '')}"></label>` : ''}</div>
      <label class="field">Text<textarea name="body" rows="24" style="font-family:${kind === 'policy' ? 'inherit' : 'Georgia,serif'}">${esc(x.body)}</textarea></label>
      <p class="sub" style="font-size:12.5px;margin:0">${kind === 'policy' ? 'A line starting with "# " becomes a heading; a line starting with "- " becomes a bullet.' : 'Fields in double braces fill in from the employee and company details: {{name}} {{empNo}} {{designation}} {{department}} {{address}} {{startDate}} {{confirmDate}} {{endDate}} {{location}} {{reportingTo}} {{ctc}} {{ctcWords}} {{gross}} {{basic}} {{hra}} {{allowances}} {{today}} {{offerValidTill}} {{company}} {{companyAddress}} {{signatory}} {{signatoryTitle}} {{probation}} {{notice}} {{noticeProbation}} {{jurisdiction}}.'}</p></div>
    <div class="err" id="xerr" role="alert"></div>
    <div class="bar2"><button class="btn go">Save</button><button type="button" class="btn" data-x>Cancel</button>${x.id ? `<button type="button" class="btn warn" id="xdel" style="margin-left:auto">Delete</button>` : ''}</div></form></div>`;
  document.body.appendChild(w);
  const close = () => { w.remove(); show(); };
  $$('[data-x]', w).forEach((b) => (b.onclick = close));
  const form = $('form', w), op = kind === 'policy' ? 'savePolicy' : 'saveTemplate';
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { ...Object.fromEntries(new FormData(form)), id: x.id, order: x.order };
    try { const r = await api(op, { data }); await load(); if (kind === 'policy') POL = r.id; else LET.tpl = r.id; close(); } catch (er) { $('#xerr', w).textContent = er.message; }
  };
  const del = $('#xdel', w);
  if (del) del.onclick = async () => { if (!confirm(`Delete "${x.title}"?`)) return; try { await api(op, { data: { ...x, deleted: true } }); await load(); POL = ''; close(); } catch (er) { $('#xerr', w).textContent = er.message; } };
}

// ---------- settings ----------
function settings() {
  const c = S.company;
  const cf = [['company', 'Company name (as on letters)'], ['companyAddress', 'Registered office address'], ['signatory', 'Who signs letters'], ['signatoryTitle', 'Their designation'], ['location', 'Default place of work'],
    ['jurisdiction', 'Courts for the NDA (city)'], ['probation', 'Probation (months)'], ['noticeProbation', 'Notice during probation (days)'], ['notice', 'Notice after confirmation (days)']];
  $('#view').innerHTML = `<form class="panel" id="setf"><h1>Settings</h1><p class="sub">Company details used on letters, the types of leave and their days per year, the holiday list and departments.</p>
    <div class="box" style="margin-top:14px"><h3>Company details for letters</h3><div class="grid tight">${cf.map(([k, l]) => `<label class="field">${l}<input name="c_${k}" value="${esc(c[k])}"></label>`).join('')}</div></div>
    <div class="box"><h3>Leave types</h3><div class="tbl"><table style="min-width:560px"><thead><tr><th>Code</th><th>Name</th><th class="num">Days a year</th><th>Builds up monthly</th><th>Note</th></tr></thead><tbody id="lts">
      ${S.leaveTypes.map((t) => ltRow(t)).join('')}</tbody></table></div><div><button type="button" class="btn small" id="ltAdd">Add a leave type</button></div></div>
    <div class="box"><h3>Holidays (${fy().label})</h3><label class="field">One date per line, as dd-mm-yyyy<textarea name="holidays" rows="6">${S.holidays.map(fd).join('\n')}</textarea></label></div>
    <div class="box"><h3>Departments</h3><label class="field">One per line<textarea name="departments" rows="6">${esc(S.departments.join('\n'))}</textarea></label></div>
    <div class="err" id="serr" role="alert"></div><div class="ok" id="sok" role="status"></div><div><button class="btn go">Save settings</button></div></form>`;
  $('#ltAdd').onclick = () => $('#lts').insertAdjacentHTML('beforeend', ltRow({ key: '', label: '', days: 0 }));
  $('#setf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target, company = Object.fromEntries(cf.map(([k]) => [k, f['c_' + k].value]));
    const leaveTypes = $$('#lts tr').map((tr) => ({ key: $('[data-k=key]', tr).value, label: $('[data-k=label]', tr).value, days: $('[data-k=days]', tr).value, accrues: $('[data-k=accrues]', tr).checked, note: $('[data-k=note]', tr).value }));
    const holidays = f.holidays.value.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; });
    if (holidays.includes('')) { $('#serr').textContent = 'Write each holiday as dd-mm-yyyy, one per line.'; return; }
    try { await api('saveConfig', { data: { company, leaveTypes, holidays, departments: f.departments.value.split('\n') } }); await load(); $('#sok').textContent = 'Saved.'; $('#serr').textContent = ''; }
    catch (x) { $('#serr').textContent = x.message; }
  };
}
const ltRow = (t) => `<tr><td><input data-k="key" value="${esc(t.key)}" style="width:70px;padding:6px 8px;border:1px solid #C3CAC4;border-radius:6px"></td><td><input data-k="label" value="${esc(t.label)}" style="width:100%;padding:6px 8px;border:1px solid #C3CAC4;border-radius:6px"></td>
  <td class="num"><input data-k="days" type="number" min="0" step="0.5" value="${t.days}" style="width:80px;padding:6px 8px;border:1px solid #C3CAC4;border-radius:6px;text-align:right"></td><td><input data-k="accrues" type="checkbox" ${t.accrues ? 'checked' : ''}></td>
  <td><input data-k="note" value="${esc(t.note || '')}" style="width:100%;padding:6px 8px;border:1px solid #C3CAC4;border-radius:6px"></td></tr>`;

// ---------- activity log ----------
async function activity() {
  $('#view').innerHTML = '<div class="panel"><h1>Activity log</h1><p class="sub">Every change in HR &amp; Admin, and every time someone opened an employee document.</p><div class="empty">Loading…</div></div>';
  try {
    const r = await fetch('/api/hr?log=1', { cache: 'no-store' }); const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $('#view .empty').outerHTML = j.log.length ? `<div class="tbl" style="margin-top:12px"><table><thead><tr><th>When (IST)</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>${j.log.map((l) => { const t = new Date(Date.parse(l.at) + 330 * 60000).toISOString(); return `<tr><td style="white-space:nowrap">${fd(t.slice(0, 10))} ${t.slice(11, 16)}</td><td>${esc(l.name)}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Nothing yet.</div>';
  } catch (x) { say(x.message); }
}

Shell.init({ module: 'hr', modsEl: $('#mods'), userEl: $('#user') }).then(async (me) => {
  if (!me) return;
  try { await load(); } catch (x) { $('#main').hidden = false; say(x.message); return; }
  $('#main').hidden = false;
  const h = location.hash.slice(1);
  if (SELF) TAB = 'me';
  if (TABS.some((t) => t[0] === h && tabOk(t))) TAB = h;
  show();
});
