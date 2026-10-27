// HR & Admin, Employees page: the Excel round trip and bulk document upload.
// - Download blank template (/hr-employee-template.xlsx) or the current list in the same layout.
// - Upload Excel: shows each row (new, update, problem) before anything is saved, then imports.
// - Upload documents in bulk: matches each file to an employee and document type from its name.
// Uses hr.html's globals: S, api, load, show, $, $$, esc, fd, todayIso. ExcelJS is loaded on first use.
(function () {
  // header in the sheet, employee field, kind (same columns as the template)
  const COLS = [['Employee no.', 'empNo', 'text'], ['Title', 'title', 'text'], ['Full name', 'name', 'text'], ['Designation', 'designation', 'text'], ['Department', 'department', 'text'],
    ['Grade / level', 'grade', 'text'], ['Reports to', 'reportingTo', 'text'], ['Place of work', 'location', 'text'], ['Type', 'employmentType', 'text'], ['Status', 'status', 'text'],
    ['Start date', 'startDate', 'date'], ['Confirmation date', 'confirmDate', 'date'], ['Last working day', 'endDate', 'date'], ['Mobile', 'phone', 'text'], ['Work email', 'email', 'text'],
    ['Personal email', 'personalEmail', 'text'], ['Date of birth', 'dob', 'date'], ['Gender', 'gender', 'text'], ["Father's / spouse's name", 'fatherName', 'text'], ['Qualification', 'qualification', 'text'],
    ['Address', 'address', 'text'], ['Emergency contact', 'emergencyName', 'text'], ['Emergency phone', 'emergencyPhone', 'text'], ['Annual CTC (Rs)', 'ctc', 'num'], ['Monthly gross (Rs)', 'gross', 'num'],
    ['Basic per month', 'basic', 'num'], ['HRA per month', 'hra', 'num'], ['Other allowances per month', 'allowances', 'num'], ['PF (Yes/No)', 'pf', 'yes'], ['ESI (Yes/No)', 'esi', 'yes'],
    ['Aadhaar no.', 'aadhaarNo', 'text'], ['PAN', 'panNo', 'text'], ['PF UAN', 'uan', 'text'], ['ESI no.', 'esiNo', 'text'], ['Bank', 'bankName', 'text'], ['Account no.', 'bankAccount', 'text'],
    ['IFSC', 'ifsc', 'text'], ['Annual leave carried forward (days)', 'elOpening', 'num'], ['Notes', 'notes', 'text'],
    // upload only (Admin): makes a Staff login for the person, who must set their own password on first sign-in
    ['Portal username', 'loginUser', 'text', 'in'], ['Temporary password', 'loginPassword', 'text', 'in']];
  const OUT = COLS.filter((c) => c[3] !== 'in');
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
  let lib = null;
  const XL = () => lib || (lib = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.onload = () => ok(window.ExcelJS); s.onerror = () => { lib = null; no(new Error('Could not load the Excel library. Check the internet connection.')); }; document.head.appendChild(s);
  }));

  // ---------- reading cells ----------
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  function plain(v) {
    if (v == null) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((t) => t.text).join('');
      if ('result' in v) return plain(v.result);
      if (v.text != null) return plain(v.text);
      return '';
    }
    return v;
  }
  function toDate(v) {
    if (v === '' || v == null) return { v: '' };
    if (v instanceof Date) return { v: isoOf(v) };
    if (typeof v === 'number' && v > 1000 && v < 80000) return { v: isoOf(new Date(Date.UTC(1899, 11, 30) + v * 86400000)) };
    const m = String(v).trim().match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { v: `${y}-${pad(m[2])}-${pad(m[1])}` }; }
    const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return { v: iso[0] };
    return { v: '', bad: true };
  }
  function cellText(v) {
    if (v instanceof Date) return isoOf(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v ?? '').trim();
  }

  async function readRows(file) {
    const X = await XL();
    const wb = new X.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    let ws = null, headRow = 0, map = {};
    wb.eachSheet((sh) => {
      if (ws) return;
      for (let r = 1; r <= Math.min(10, sh.rowCount); r++) {
        const m = {};
        sh.getRow(r).eachCell((c, col) => { const h = norm(plain(c.value)); const def = COLS.find(([x]) => norm(x) === h); if (def) m[def[1]] = col; });
        if (m.name) { ws = sh; headRow = r; map = m; break; }
      }
    });
    if (!ws) throw new Error('This file has no "Full name" column. Use the HR employee list template.');
    const rows = [];
    for (let r = headRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r), data = {}, problems = [];
      let any = false;
      for (const [label, f, kind] of COLS) {
        if (!map[f]) continue;
        const v = plain(row.getCell(map[f]).value);
        if (v !== '' && v != null) any = true;
        if (kind === 'date') { const d = toDate(v); if (d.bad) problems.push(`${label}: "${cellText(v)}" is not a date`); data[f] = d.v; }
        else if (kind === 'num') { const t = cellText(v).replace(/[,\s]|rs\.?|₹/gi, ''); if (t && !Number.isFinite(+t)) problems.push(`${label}: "${cellText(v)}" is not a number`); data[f] = t && Number.isFinite(+t) ? +t : ''; }
        else if (kind === 'yes') { const t = norm(v); data[f] = t ? ['yes', 'y', 'true', '1'].includes(t) : ''; }
        else data[f] = cellText(v);
      }
      if (!any) continue;
      if (['required', 'leave blank for new staff; the portal gives dir-001, dir-002...'].includes(norm(data.name)) || norm(data.empNo).startsWith('leave blank')) continue; // the hint row
      if (data.aadhaarNo) { data.aadhaarNo = data.aadhaarNo.replace(/\D/g, ''); if (data.aadhaarNo.length !== 12) problems.push('Aadhaar no. should have 12 digits'); }
      if (data.panNo && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(data.panNo)) problems.push('PAN looks wrong (should be like ABCDE1234F)');
      if (data.status && !S.statuses.includes(data.status)) problems.push(`Status "${data.status}" is not one of ${S.statuses.join(', ')}`);
      if (data.employmentType && !S.types.includes(data.employmentType)) problems.push(`Type "${data.employmentType}" is not one of ${S.types.join(', ')}`);
      const key = (x) => norm(x);
      const old = data.empNo ? S.employees.find((e) => key(e.empNo) === key(data.empNo)) : S.employees.find((e) => key(e.name) === key(data.name));
      if (!data.name && !old) problems.push('No name');
      if (data.empNo && !old) problems.push(`No employee ${data.empNo} in the portal yet; it will be added with that number`);
      if (data.loginUser && !S.me.users) { problems.push('Only the Admin can make logins; the username and password columns are ignored'); delete data.loginUser; delete data.loginPassword; }
      if (data.loginUser && String(data.loginPassword || '').length < 8 && !(old && old.login)) problems.push('Temporary password needs at least 8 characters; no login will be made');
      rows.push({ line: r, data, old, problems, block: !data.name && !old });
    }
    return rows;
  }

  // ---------- side panel ----------
  function panel(title, inner) {
    const w = document.createElement('div'); w.className = 'scrim';
    w.innerHTML = `<div class="side" role="dialog" aria-modal="true"><div class="hd"><h2>${esc(title)}</h2><button class="btn small" data-x>Close</button></div><div class="bd">${inner}</div></div>`;
    document.body.appendChild(w);
    const close = () => { w.remove(); show(); };
    w.querySelectorAll('[data-x]').forEach((b) => (b.onclick = close));
    return { w, close };
  }

  async function importFile(file) {
    let rows;
    try { rows = await readRows(file); } catch (x) { alert(x.message); return; }
    if (!rows.length) { alert('No employee rows found in this file (they start on row 3 of the Employees sheet).'); return; }
    const logins = rows.filter((r) => r.data.loginUser && !r.block).length;
    const add = rows.filter((r) => !r.old && !r.block).length, upd = rows.filter((r) => r.old).length, bad = rows.filter((r) => r.problems.length).length;
    const { w, close } = panel('Upload Excel: check before saving', `
      <div class="figs"><div><b>${add}</b><span>New employees</span></div><div><b>${upd}</b><span>Updates to existing records</span></div><div><b>${bad}</b><span>Rows with something to check</span></div></div>
      <p class="sub" style="margin:0">From <b>${esc(file.name)}</b>. Nothing is saved until you press Import. Blank cells keep what is already in the portal. Rows with a problem are still imported, except rows with no name; fix them in the file and upload again, or correct them in the portal afterwards.</p>
      ${logins ? `<p class="sub" style="margin:0"><b>Logins:</b> ${logins} rows have a portal username. Each person gets a Staff login that opens only their own HR record, and must set their own password the first time they sign in. If that username already exists, or a login has exactly the same name, the person is linked to it instead and keeps their current password.</p>` : ''}
      <div class="tbl"><table><thead><tr><th>Row</th><th>Name</th><th>Employee no.</th><th>What happens</th>${logins ? '<th>Login</th>' : ''}<th>To check</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.line}</td><td><b>${esc(r.data.name || r.old?.name || '')}</b><br><span class="muted" style="font-size:12.5px">${esc([r.data.designation, r.data.department].filter(Boolean).join(' · '))}</span></td>
        <td>${esc(r.data.empNo || r.old?.empNo || 'New number')}</td><td>${r.block ? '<span class="tag off">Skipped</span>' : r.old ? '<span class="tag wait">Update</span>' : '<span class="tag ok">Add</span>'}</td>
        ${logins ? `<td data-login="${r.line}">${r.data.loginUser ? esc(r.data.loginUser) : '<span class="muted">None</span>'}</td>` : ''}
        <td style="font-size:13px;max-width:320px">${r.problems.map(esc).join('<br>') || '<span class="muted">OK</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="err" id="ierr" role="alert"></div><div class="ok" id="iok" role="status"></div>
      <div class="bar2"><button class="btn go" id="igo">Import ${add + upd} rows</button><button class="btn" data-x>Cancel</button></div>`);
    w.querySelector('[data-x]:last-of-type').onclick = close;
    w.querySelector('#igo').onclick = async (ev) => {
      ev.target.disabled = true; w.querySelector('#ierr').textContent = '';
      try {
        const sent = rows.filter((x) => !x.block);
        const r = await api('importEmployees', { rows: sent.map((x) => ({ ...x.data })) });
        await load();
        const made = r.results.filter((x) => x.login && x.login.result === 'New login').length;
        w.querySelector('#iok').textContent = `Done: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}${logins ? `. Logins: ${made} new` : ''}.`;
        ev.target.textContent = 'Imported'; w.querySelector('.bar2 .btn:not(.go)').textContent = 'Close';
        if (logins) {
          sent.forEach((x, i) => { const c = w.querySelector(`[data-login="${x.line}"]`), l = r.results[i] && r.results[i].login; if (c && l) c.innerHTML = `${esc(l.username || x.data.loginUser)}<br><span class="tag ${l.result === 'New login' ? 'ok' : l.result === 'Not made' ? 'off' : 'wait'}">${esc(l.result)}</span>${l.why ? `<br><span class="muted" style="font-size:12px">${esc(l.why)}</span>` : ''}`; });
          const b = document.createElement('button'); b.className = 'btn go'; b.textContent = 'Download login list (Excel)';
          b.onclick = () => loginList(sent, r.results).catch((x) => alert(x.message));
          ev.target.after(b);
        }
      } catch (x) { w.querySelector('#ierr').textContent = x.message; ev.target.disabled = false; }
    };
  }

  // ---------- login list to hand out: name, username, temporary password ----------
  async function loginList(sent, results) {
    const X = await XL();
    const wb = new X.Workbook(), ws = wb.addWorksheet('Portal logins');
    ws.addRow(['Dream India Realty portal: staff logins']).font = { bold: true, size: 14 };
    ws.addRow(['Sign in at https://portal.dreamindiarealty.com with the username and temporary password below. The portal then asks each person to set their own password. Open HR & Admin, My details, fill in your details and upload Aadhaar, PAN, photo and a cancelled cheque.']);
    ws.mergeCells('A2:G2'); ws.getRow(2).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(2).height = 46;
    ws.addRow([]);
    const head = ws.addRow(['No.', 'Name', 'Designation', 'Place of work', 'Mobile', 'Username', 'Temporary password', 'Note']);
    head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF140C59' } }; });
    sent.forEach((x, i) => {
      const l = results[i] && results[i].login; if (!l) return;
      const nw = l.result === 'New login';
      ws.addRow([results[i].empNo, results[i].name, x.data.designation || '', x.data.location || '', x.data.phone || '', l.username || x.data.loginUser, nw ? x.data.loginPassword : '',
        nw ? '' : l.result === 'Not made' ? 'No login made: ' + (l.why || '') : 'Uses their existing portal password']);
    });
    [8, 30, 22, 16, 14, 16, 20, 34].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `Portal staff logins ${fd(todayIso())}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- current list as Excel (same layout as the template, so it can be corrected and uploaded again) ----------
  async function downloadList() {
    const X = await XL();
    const wb = new X.Workbook(), ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
    ws.addRow(OUT.map(([h, f]) => (f === 'name' ? h + ' *' : h)));
    ws.addRow(OUT.map(([, f]) => (f === 'empNo' ? 'Keep the number to update this person' : f === 'name' ? 'Required' : '')));
    for (const e of S.employees) ws.addRow(OUT.map(([, f, k]) => (k === 'date' ? (e[f] ? new Date(e[f] + 'T00:00:00Z') : null) : k === 'yes' ? (e[f] ? 'Yes' : 'No') : e[f] ?? '')));
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF140C59' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
    ws.getRow(2).eachCell((c) => { c.font = { italic: true, size: 9, color: { argb: 'FF5E6A72' } }; });
    ws.getRow(1).height = 42;
    OUT.forEach(([h, f, k], i) => { const col = ws.getColumn(i + 1); col.width = Math.max(11, Math.min(34, h.length + 4)); if (k === 'date') col.numFmt = 'dd-mm-yyyy'; if (k === 'num') col.numFmt = '#,##,##0'; });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `HR employee list ${fd(todayIso())}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- documents in bulk ----------
  const TYPE_WORDS = [[/aadh?a+r/i, 'Aadhaar'], [/\bpan\b|pan ?card/i, 'PAN'], [/\bnda\b|non.?disclosure/i, 'NDA (signed)'], [/offer/i, 'Offer letter (signed)'], [/relieving|experience/i, 'Experience / relieving letter'],
    [/cert|degree|marks|diploma|ssc|hsc|graduat|b\.?com|mba/i, 'Educational certificate'], [/cheque|check|passbook|bank/i, 'Bank / cancelled cheque'], [/photo|passport size/i, 'Photo'], [/resume|\bcv\b|biodata/i, 'Resume'], [/apprais/i, 'Appraisal']];
  function guess(fileName) {
    const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ');
    const type = (TYPE_WORDS.find(([re]) => re.test(base)) || [0, 'Other'])[1];
    let emp = null;
    const num = base.match(/([A-Z]{2,4})[- ]?0*(\d{1,4})/i);
    if (num) emp = S.employees.find((e) => { const m = String(e.empNo).match(/([A-Z]{2,4})-?0*(\d+)$/i); return m && m[1].toUpperCase() === num[1].toUpperCase() && +m[2] === +num[2]; });
    if (!emp) {
      const b = ' ' + norm(base).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const hits = S.employees.filter((e) => e.name && b.includes(' ' + norm(e.name) + ' ')).sort((x, y) => y.name.length - x.name.length);
      emp = hits[0] || null;
      if (!emp) { const first = S.employees.filter((e) => e.name && b.includes(' ' + norm(e.name).split(' ')[0] + ' ')); if (first.length === 1) emp = first[0]; }
    }
    return { type, empId: emp ? emp.id : '' };
  }
  async function uploadDoc(empId, type, label, f, progress) {
    const bytes = await window.hrShrink(f);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Over 4 MB');
    const st = await api('fileStart', { empId, type, label, name: f.name, size: bytes.length });
    const n = Math.ceil(bytes.length / st.chunk);
    for (let i = 0; i < n; i++) { progress(Math.round(i / n * 100)); await api('fileChunk', { fileId: st.fileId, i, data: window.hrB64(bytes.subarray(i * st.chunk, (i + 1) * st.chunk)) }); }
    await api('fileDone', { fileId: st.fileId });
  }
  function bulkDocs() {
    const { w } = panel('Upload documents in bulk', `
      <p class="sub" style="margin:0">Choose many files at once. Name each file with the employee no. or name and the document, for example <b>DIR-001 Aadhaar.pdf</b> or <b>Farah Khan PAN.jpg</b>. The portal matches them; check the matches below, fix any that are wrong, then upload. PDF, photo or Word file, up to 4 MB each.</p>
      <div><label class="btn go">Choose files<input type="file" id="bfiles" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,image/*,application/pdf" hidden></label></div>
      <div id="blist"></div>`);
    const people = S.employees.slice().sort((a, b) => a.name.localeCompare(b.name));
    let files = [];
    w.querySelector('#bfiles').onchange = (ev) => {
      files = [...ev.target.files].map((f) => ({ f, ...guess(f.name), state: '' }));
      ev.target.value = '';
      draw();
    };
    function draw() {
      const ready = files.filter((x) => x.empId && x.state !== 'Uploaded').length;
      w.querySelector('#blist').innerHTML = files.length ? `<div class="tbl"><table><thead><tr><th>File</th><th>Employee</th><th>Document</th><th></th></tr></thead><tbody>
        ${files.map((x, i) => `<tr><td style="max-width:220px;overflow-wrap:anywhere"><b>${esc(x.f.name)}</b><br><span class="muted" style="font-size:12.5px">${Math.max(1, Math.round(x.f.size / 1024))} KB</span></td>
          <td><select data-i="${i}" data-k="empId" style="padding:7px;border:1px solid #C3CAC4;border-radius:7px;max-width:220px"><option value="">Pick the employee</option>${people.map((e) => `<option value="${e.id}" ${e.id === x.empId ? 'selected' : ''}>${esc(e.name)} (${esc(e.empNo)})</option>`).join('')}</select></td>
          <td><select data-i="${i}" data-k="type" style="padding:7px;border:1px solid #C3CAC4;border-radius:7px">${S.docTypes.map((t) => `<option ${t === x.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
          <td style="white-space:nowrap">${x.state === 'Uploaded' ? '<span class="tag ok">Uploaded</span>' : x.state ? `<span class="${/^\d/.test(x.state) ? 'muted' : 'tag off'}">${esc(x.state)}</span>` : `<button class="btn small" data-rm="${i}">Remove</button>`}</td></tr>`).join('')}
        </tbody></table></div><div class="bar2" style="margin-top:12px"><button class="btn go" id="bgo" ${ready ? '' : 'disabled'}>Upload ${ready} file${ready === 1 ? '' : 's'}</button><span class="sub" id="bmsg"></span></div>` : '';
      w.querySelectorAll('#blist select').forEach((s) => (s.onchange = () => { files[+s.dataset.i][s.dataset.k] = s.value; draw(); }));
      w.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); draw(); }));
      const go = w.querySelector('#bgo');
      if (go) go.onclick = async () => {
        go.disabled = true;
        for (const x of files.filter((y) => y.empId && y.state !== 'Uploaded')) {
          try { await uploadDoc(x.empId, x.type, '', x.f, (p) => { x.state = p + '%'; draw(); }); x.state = 'Uploaded'; }
          catch (er) { x.state = er.message; }
          draw();
        }
        await load();
        const ok = files.filter((y) => y.state === 'Uploaded').length;
        const m = w.querySelector('#bmsg'); if (m) m.textContent = `${ok} of ${files.length} uploaded.${ok < files.length ? ' Fix the rest and press Upload again.' : ''}`;
      };
    }
  }

  window.hrExcel = { importFile, downloadList, bulkDocs };
})();
