// Accounts page · SRA tenants (Goodluck SRA transit rent). Data: D.tenants from /api/master (SRA Tenants +
// Tenant Rent Links tabs of the master sheet), including the payment rows (D.tenants.pl). Editors (Shell.me.tenantsEdit) can change rows; in the ERP the rows are changed in Accounts → SRA Tenants and Tenant Rent Links.
window.renderTenants = function (D, H) {
  const { card, rs, full, esc, DR, $ } = H;
  const T = D.tenants, sec = $('#tenants'), pan = $('#tenTable');
  sec.hidden = !T; pan.hidden = !T; $('#tenLinks').hidden = !T;
  document.querySelectorAll('a[href="#tenants"]').forEach((a) => (a.hidden = !T));
  if (!T) return;
  const R = T.rows, Y = T.years, DY = T.dueYears;
  const byT = (a) => a.slice().sort((x, y) => y.t - x.t);
  const yr = (r, y) => r.due[y], pd = (r, y) => r.paid[y] || 0;

  // column sets for the click-through lists
  const TC = [['Survey No', (r) => r.sv, 'n'], ['Tenant', (r) => r.n], ['Status', (r) => r.st], ['Area (sq ft)', (r) => r.area || '', 'n'], ['Monthly rent', (r) => r.rent, 'amt'],
    ...DY.flatMap((y) => [['Rent ' + y, (r) => yr(r, y), 'amt'], ['Paid ' + y, (r) => pd(r, y), 'amt']]),
    ['Other agreed', (r) => r.oth, 'amt'], ['Due till date', (r) => r.dueTD, 'amt'], ['Paid till date', (r) => r.paidTD, 'amt'], ['Balance', (r) => r.bal, 'amt'], ['Position', (r) => r.pos],
    ['Payments', (r) => r.np, 'n'], ['To confirm', (r) => r.k, 'n'], ['Remark', (r) => [r.rem, r.othn, r.ar].filter(Boolean).join(' · '), 'desc']];
  const PC = [['Date', (p) => p.d], ['Payment ID', (p) => p.id], ['Survey No', (p) => p.sv || '', 'n'], ['Tenant', (p) => p.tn], ['Rent year', (p) => p.yr, 'n'], ['Bank account', (p) => p.bank],
    ['Bank description', (p) => p.desc + (p.rm ? ' · ' + p.rm : ''), 'desc'], ['Status', (p) => p.st], ['Note', (p) => p.note, 'desc'], ['Checked', (p) => p.chk], ['Amount', (p) => p.amt, 'amt']];
  const UC = [['Date', (p) => p.d], ['Payment ID', (p) => p.id], ['Bank account', (p) => p.bank], ['Bank description', (p) => p.desc + (p.rm ? ' · ' + p.rm : ''), 'desc'],
    ['Suggested survey no.', (p) => (p.sug ? p.sug + (p.sugn ? ' · ' + p.sugn : '') : '')], ['Amount', (p) => p.amt, 'amt']];
  const tenD = (t, rows, sumCol, note) => DR.reg(t, () => ({ note, sections: [{ cols: TC, rows, sumCol }] }), false);
  const payD = (t, f, note) => DR.reg(t, () => ({ note, sections: [{ cols: PC, rows: byT((T.pl || []).filter(f)) }] }), false);
  const counted = (p) => p.sv && p.st !== 'Not tenant rent';
  const short = R.filter((r) => r.bal > 1000).sort((a, b) => b.bal - a.bal), extra = R.filter((r) => r.bal < -1000).sort((a, b) => a.bal - b.bal);
  const dueLbl = DY.join(' + ');
  const sgn = (v) => (Math.abs(v) <= 1000 ? '—' : (v < 0 ? '−' : '') + rs(Math.abs(v)));

  $('#cTen').innerHTML = [
    card('nv', 'SRA tenants', T.tenants, T.active + ' active · ' + (T.tenants - T.active) + ' closed shops', tenD('SRA tenants', R, 'Due till date')),
    card('out', 'Rent due till date', rs(T.dueTD), dueLbl + ' rent' + (T.oth ? ' + ' + rs(T.oth) + ' other agreed' : ''),
      tenD('Rent due till date by tenant', R.slice().sort((a, b) => b.dueTD - a.dueTD), 'Due till date', 'Each year is 11 months of rent paid in advance (12 for a few), with 10% more every year, as in the Goodluck rent list. Other agreed = additional rent and shifting charges.')),
    card('out', 'Rent paid till date', rs(T.paidTD), T.pays.n.toLocaleString('en-IN') + ' bank payments linked to a survey no.', payD('Tenant rent paid till date', counted)),
    card('out tint', 'Balance still to pay', rs(T.short.amt), T.short.n + ' tenants short paid', tenD('Tenants still to be paid', short, 'Balance', 'Due till date less paid till date. Includes cheques given as PDC that are not yet cleared in the bank.')),
    card('nv', 'Paid extra', rs(T.extra.amt), T.extra.n + ' tenants paid more than due', tenD('Tenants paid more than due', extra, 'Balance', 'Negative balance: paid more than the rent list says. Check each one: a duplicate, a payment for another survey no., or an advance for next year.')),
    card('nv', 'Payments to confirm', T.conf.n, rs(T.conf.amt) + ' · marked To confirm on the Links tab', payD('Tenant rent payments to confirm', (p) => p.st === 'To confirm', 'Accounts: answer each one in the Tenant Rent Links tab (fix the Survey No, then set Status to Linked).')),
    card(T.unlisted.n ? 'out' : 'in', 'Not yet linked', T.unlisted.n, T.unlisted.n ? rs(T.unlisted.amt) + ' booked as Tenant Rent, no row on the Links tab' : 'Every Tenant Rent payment is linked',
      DR.reg('Tenant Rent payments not yet linked', () => ({ note: 'Add one row per payment on the Tenant Rent Links tab: Payment ID and Survey No. The suggested survey no. is read from "Annexure No." in the remark.', sections: [{ cols: UC, rows: T.unl }] }), false)),
    T.nextDue != null ? card('nv', 'Rent due for ' + T.next, rs(T.nextDue), "next year's advance, 10% more than " + (T.next - 1), tenD('Rent due for ' + T.next + ' by tenant', R.slice().sort((a, b) => b.due[T.next] - a.due[T.next]), 'Rent ' + T.next)) : '',
    T.notRent.n ? card('out', 'Booked as Tenant Rent, not rent', rs(T.notRent.amt), T.notRent.n + ' payments · change the Cash Flow Head', payD('Booked as Tenant Rent but not rent', (p) => p.st === 'Not tenant rent')) : '',
  ].join('');

  // year by year
  const yrow = (y) => { const due = T.due[y], paid = T.paid[y] || 0, on = DY.includes(y);
    return `<tr ${payD('Tenant rent paid for ' + y, (p) => counted(p) && p.yr === y)}><td><b>${y}</b>${on ? '' : ' <span class="cnt">not due yet</span>'}</td><td class="num">${rs(due)}</td><td class="num g">${rs(paid)}</td><td class="num${on && due - paid > 1000 ? ' r' : ''}">${on ? sgn(due - paid) : '—'}</td></tr>`; };
  $('#tTenYr').innerHTML = '<tr><th>Rent year</th><th class="num">Rent due</th><th class="num">Paid</th><th class="num">Balance</th></tr>' + Y.map(yrow).join('') +
    (T.oth ? `<tr class="nokids"><td>Other agreed (additional rent, shifting)</td><td class="num">${rs(T.oth)}</td><td class="num">—</td><td class="num">—</td></tr>` : '');

  // tenant table
  const COLS = [['sv', 'Sv', 1], ['n', 'Tenant'], ['area', 'Sq ft', 1], ['rent', 'Monthly rent', 1], ...DY.flatMap((y) => [['d' + y, 'Rent ' + y, 1], ['p' + y, 'Paid ' + y, 1]]), ['oth', 'Other agreed', 1], ['bal', 'Balance', 1], ['pos', 'Position'], ['np', 'Payments', 1], ['last', 'Last paid', 1]];
  const canEdit = !!(window.Shell && Shell.me && Shell.me.tenantsEdit);
  const val = (r, k) => (k[0] === 'd' && /^\d{4}$/.test(k.slice(1)) ? r.due[k.slice(1)] : k[0] === 'p' && /^\d{4}$/.test(k.slice(1)) ? r.paid[k.slice(1)] || 0 : r[k]);
  const posCls = { 'Short paid': 'r', 'Not paid': 'r', 'Paid extra': 'due', 'Paid in full': 'g' };
  const rowD = {};
  R.forEach((r) => (rowD[r.sv] = DR.reg('Sv ' + r.sv + ' · ' + r.n, () => {
    const ps = byT((T.pl || []).filter((p) => p.sv === r.sv));
    return { sub: 'Due till date ' + full(r.dueTD) + ' · paid ' + full(r.paidTD) + ' · ' + (r.bal > 1000 ? 'still to pay ' + full(r.bal) : r.bal < -1000 ? 'paid extra ' + full(-r.bal) : 'paid in full'),
      sections: [{ h: 'Tenant', cols: TC, rows: [r], sumCol: '-', count: false }, { h: 'Bank payments for this survey no.', cols: PC, rows: ps }] };
  }, false)));
  if (!$('#tenPos').dataset.ready) {
    ['Short paid', 'Paid extra', 'Not paid', 'Paid in full', 'To confirm'].forEach((p) => $('#tenPos').insertAdjacentHTML('beforeend', `<option value="${p}">${p === 'To confirm' ? 'Has payments to confirm' : p}</option>`));
    $('#tenPos').dataset.ready = '1';
  }
  let sk = 'sv', sd = 1, lim = 25;
  function draw() {
    const q = $('#tenQ').value.trim().toLowerCase(), fp = $('#tenPos').value, fs = $('#tenSt').value;
    const rows = R.filter((r) => (!fs || r.st === fs) && (!fp || (fp === 'To confirm' ? r.k > 0 : r.pos === fp)) && (!q || (r.sv + ' ' + r.n + ' ' + r.mn).toLowerCase().includes(q)))
      .sort((a, b) => { const x = val(a, sk), y = val(b, sk); return (typeof x === 'number' || typeof y === 'number' ? (x || 0) - (y || 0) : String(x).localeCompare(String(y))) * sd; });
    const S = rows.reduce((t, r) => ((t.due += r.dueTD), (t.paid += r.paidTD), (t.bal += r.bal), t), { due: 0, paid: 0, bal: 0 });
    $('#tenCount').textContent = `${rows.length} survey nos · due till date ${rs(S.due)} · paid ${rs(S.paid)} · net balance ${rs(S.bal)}`;
    $('#tTen').innerHTML = '<tr>' + COLS.map(([k, l, n]) => `<th class="s${n ? ' num' : ''}" data-k="${k}">${l}${sk === k ? (sd < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('') + (canEdit ? '<th></th>' : '') + '</tr>' +
      rows.slice(0, lim).map((r) => `<tr ${rowD[r.sv]}><td class="num"><b>${r.sv}</b></td><td>${esc(r.n)}${r.st === 'Closed shop' ? ' <span class="cnt">closed shop</span>' : ''}${r.k ? ` <span class="cnt" style="color:var(--due)">${r.k} to confirm</span>` : ''}</td><td class="num">${r.area ? Math.round(r.area) : '—'}</td><td class="num">${r.rent ? full(r.rent) : '—'}</td>` +
        DY.map((y) => `<td class="num">${rs(r.due[y])}</td><td class="num${(r.paid[y] || 0) < r.due[y] - 1000 ? ' r' : ''}">${rs(r.paid[y] || 0)}</td>`).join('') +
        `<td class="num">${r.oth ? rs(r.oth) : '—'}</td><td class="num${r.bal > 1000 ? ' r' : ''}">${sgn(r.bal)}</td><td class="${posCls[r.pos] || ''}" style="${r.pos === 'Paid extra' ? 'color:var(--due);font-weight:600' : ''}">${r.pos}</td><td class="num">${r.np}</td><td class="num" style="white-space:nowrap">${esc(r.lastD)}</td>${canEdit ? `<td data-nodrill><button class="more ten-ed" type="button" data-sv="${r.sv}">Edit</button></td>` : ''}</tr>`).join('');
    const b = $('#tenMore'); b.hidden = rows.length <= 25; b.textContent = lim < rows.length ? `Show all ${rows.length} survey nos` : 'Show fewer';
    document.querySelectorAll('#tTen .ten-ed').forEach((bt) => (bt.onclick = (e) => { e.stopPropagation(); editTenant(R.find((r) => r.sv === +bt.dataset.sv)); }));
    document.querySelectorAll('#tTen th.s').forEach((th) => (th.onclick = () => { const k = th.dataset.k; sd = sk === k ? -sd : (k === 'sv' || k === 'n' ? 1 : -1); sk = k; draw(); }));
  }
  $('#tenMore').onclick = () => { lim = lim === 25 ? 100000 : 25; draw(); };
  ['#tenQ', '#tenPos', '#tenSt'].forEach((s) => ($(s).oninput = () => { lim = 25; draw(); }));
  draw();

  // ---------- editing: every change is written into the master sheet (POST /api/master) ----------
  $('#tenAdd').hidden = !canEdit;
  $('#tenAdd').onclick = () => editTenant(null);
  const TF = [['sv', 'Survey No', 'int'], ['n', 'Tenant name (rent list)'], ['mn', 'Name on Goodluck master list'], ['area', 'Area (sq ft)', 'num'], ['rent', 'Monthly rent 2025', 'num'],
    ['mo', 'Months per year', 'int'], ['d25', 'Rent 2025 (whole year)', 'num'], ['inc', 'Yearly increase (%)', 'pct'], ['oth', 'Other agreed amount', 'num'],
    ['othn', 'Other agreed amount: what for'], ['st', 'Status', 'sel', ['Active', 'Closed shop']], ['rem', 'Rent list remark', 'area'], ['ar', 'Accounts remark', 'area']];
  const LF = [['sv', 'Survey No', 'int'], ['yr', 'Rent year (only if paid early for another year)', 'int'], ['split', 'Split amount (only if one cheque covers 2 survey nos)', 'num'],
    ['st', 'Status', 'sel', ['Linked', 'To confirm', 'Not tenant rent']], ['note', 'Note / question', 'area'], ['chk', 'Accounts checked', 'sel', ['', 'Y', 'N']], ['cr', 'Checked by / remark']];
  function editTenant(r) {
    const v = r ? { ...r, d25: r.due[2025], inc: r.inc != null ? Math.round(r.inc * 1000) / 10 : 10 } : { inc: 10, st: 'Active', mo: 11 };
    form(r ? 'Edit Sv ' + r.sv + ' · ' + r.n : 'Add a survey no.', r ? TF.filter((f) => f[0] !== 'sv') : TF, v,
      r ? 'Saved into the SRA Tenants tab, row ' + r.row + '. Rent 2026 and 2027 follow from Rent 2025 and the yearly increase.' : 'Adds a row at the bottom of the SRA Tenants tab.',
      (f) => ({ kind: 'tenant', op: r ? 'update' : 'add', row: r && r.row, key: r && r.sv, fields: f }));
  }
  function editLink(p) {
    form('Payment ' + p.id + ' · ' + full(p.full || p.amt), LF, { ...p, yr: p.yrSet, split: p.split }, 'Saved into the Tenant Rent Links tab, row ' + p.row + '. ' + p.d + ' · ' + p.bank + ' · ' + p.desc,
      (f) => ({ kind: 'link', op: 'update', row: p.row, key: p.id, origSv: p.sv == null ? '' : p.sv, fields: f }));
  }
  function addLink(u) {
    form('Link payment ' + u.id + ' · ' + full(u.amt), LF.filter((f) => f[0] !== 'chk' && f[0] !== 'cr'), { sv: u.sug || '', st: 'Linked' },
      'Adds a row to the Tenant Rent Links tab. ' + u.d + ' · ' + u.bank + ' · ' + u.desc + (u.rm ? ' · ' + u.rm : ''),
      (f) => ({ kind: 'link', op: 'add', fields: { ...f, id: u.id } }));
  }
  const st = document.getElementById('ten-ed-style') || Object.assign(document.head.appendChild(document.createElement('style')), { id: 'ten-ed-style', textContent: `
    .te-scrim{position:fixed;inset:0;background:rgba(20,12,89,.45);z-index:80;display:flex;justify-content:center;align-items:flex-start;padding:5vh 16px;overflow:auto}
    .te{background:var(--card);color:var(--text);border-radius:12px;width:min(640px,100%);box-shadow:0 18px 60px rgba(20,12,89,.35);display:flex;flex-direction:column}
    .te h3{margin:0;font-size:18px} .te .hd{padding:16px 18px 8px;display:flex;gap:10px;align-items:flex-start} .te .hd p{margin:4px 0 0;font-size:13px;color:var(--muted)}
    .te .x{margin-left:auto;font:inherit;font-size:22px;background:none;border:0;color:var(--muted);cursor:pointer}
    .te form{padding:8px 18px 18px;display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
    .te label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)} .te label.w{grid-column:1/-1}
    .te input,.te select,.te textarea{font:inherit;font-size:14px;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
    .te textarea{min-height:56px;resize:vertical}
    .te .ft{grid-column:1/-1;display:flex;gap:10px;align-items:center;margin-top:4px}
    .te .ft button{font:inherit;font-weight:600;border-radius:8px;padding:8px 16px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--text)}
    .te .ft button.go{background:var(--ink);border-color:var(--ink);color:#fff}
    .te .msg{font-size:13px} .te .msg.err{color:var(--out)}
    .te-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:10px;z-index:90;font-size:14px}
    @media (max-width:560px){.te form{grid-template-columns:1fr}}` });
  void st;
  function form(title, fields, v, note, build) {
    const sc = document.createElement('div'); sc.className = 'te-scrim';
    const val = (k) => (v[k] == null ? '' : v[k]);
    sc.innerHTML = `<div class="te" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hd"><div><h3>${esc(title)}</h3><p>${esc(note)}</p></div><button class="x" type="button" aria-label="Close">×</button></div>
      <form>${fields.map(([k, l, t, opts]) => `<label class="${t === 'area' || k === 'n' || k === 'mn' || k === 'othn' || k === 'cr' ? 'w' : ''}">${esc(l)}${t === 'sel' ? `<select name="${k}">${opts.map((o) => `<option value="${esc(o)}" ${String(val(k)) === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select>`
        : t === 'area' ? `<textarea name="${k}">${esc(val(k))}</textarea>` : `<input name="${k}" value="${esc(val(k))}" ${t ? 'inputmode="decimal"' : ''}>`}</label>`).join('')}
      <div class="ft"><button class="go" type="submit">Save to sheet</button><button type="button" class="cn">Cancel</button><span class="msg"></span></div></form></div>`;
    const close = () => { sc.remove(); document.body.style.overflow = ''; };
    sc.querySelector('.x').onclick = close; sc.querySelector('.cn').onclick = close; sc.onclick = (e) => { if (e.target === sc) close(); };
    sc.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const f = sc.querySelector('form'), msg = sc.querySelector('.msg');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const out = {};
      for (const [k] of fields) { const now = f.elements[k].value.trim(), was = String(val(k)); if (now !== was || !v.row) out[k] = now; }
      if (!Object.keys(out).length) return close();
      msg.className = 'msg'; msg.textContent = 'Saving to the master sheet…'; f.querySelector('.go').disabled = true;
      try {
        const r = await fetch('/api/master', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(build(out)) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status);
        close(); toast('Saved to the ' + j.tab + ' tab, row ' + j.row + '. Updating…');
        if (typeof loadLive === 'function') loadLive(true);
      } catch (err) { msg.className = 'msg err'; msg.textContent = 'Not saved: ' + (err.message || err); f.querySelector('.go').disabled = false; }
    };
    document.body.appendChild(sc); document.body.style.overflow = 'hidden';
    (f.querySelector('input,select,textarea') || sc.querySelector('.x')).focus();
  }
  function toast(t) { const d = document.createElement('div'); d.className = 'te-toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

  // ---------- payment links panel ----------
  const P = T.pl || [], U = T.unl || [];
  let llim = 25;
  function drawLinks() {
    const q = $('#lnkQ').value.trim().toLowerCase(), f = $('#lnkSt').value;
    const all = [...U.map((u) => ({ ...u, unl: true, st: 'Not yet linked', tn: u.sugn ? 'suggested: Sv ' + u.sug + ' · ' + u.sugn : '' })), ...P];
    const rows = all.filter((p) => (!f || (f === 'unl' ? p.unl : f === 'unchk' ? !p.unl && p.st !== 'Not tenant rent' && p.chk !== 'Y' : p.st === f))
      && (!q || [p.id, p.sv, p.tn, p.desc, p.rm, p.note].join(' ').toLowerCase().includes(q))).sort((a, b) => (b.unl - a.unl) || b.t - a.t);
    const chk = P.filter((p) => p.chk === 'Y').length;
    $('#lnkCount').textContent = `${rows.length} payments · ${rs(rows.reduce((a, p) => a + (p.amt || 0), 0))} · ${chk} of ${P.length} checked by accounts`;
    const stc = (s) => (s === 'Not yet linked' || s === 'Not tenant rent' ? 'r' : s === 'To confirm' ? '' : 'g');
    $('#tLnk').innerHTML = '<tr><th>Date</th><th>Payment ID</th><th class="num">Sv</th><th>Tenant</th><th class="num">Rent year</th><th class="num">Amount</th><th>Status</th><th>Note</th><th>Checked</th>' + (canEdit ? '<th></th>' : '') + '</tr>' +
      rows.slice(0, llim).map((p, i) => `<tr><td style="white-space:nowrap">${esc(p.d)}</td><td>${esc(p.id)}</td><td class="num">${p.sv || '—'}</td><td>${esc(p.tn)}</td><td class="num">${p.yr || '—'}</td><td class="num">${full(p.amt)}</td>` +
        `<td class="${stc(p.st)}" style="${p.st === 'To confirm' ? 'color:var(--due);font-weight:600' : ''}">${esc(p.st)}</td><td class="desc">${esc(p.note || (p.unl ? (p.rm || p.desc) : ''))}</td><td>${esc(p.chk || '')}</td>` +
        (canEdit ? `<td><button class="more" type="button" data-i="${i}">${p.unl ? 'Link' : 'Edit'}</button></td>` : '') + '</tr>').join('');
    $('#tLnk').querySelectorAll('button[data-i]').forEach((b) => (b.onclick = () => { const p = rows[+b.dataset.i]; p.unl ? addLink(p) : editLink(p); }));
    const m = $('#lnkMore'); m.hidden = rows.length <= 25; m.textContent = llim < rows.length ? `Show all ${rows.length} payments` : 'Show fewer';
  }
  $('#lnkMore').onclick = () => { llim = llim === 25 ? 100000 : 25; drawLinks(); };
  ['#lnkQ', '#lnkSt'].forEach((x) => ($(x).oninput = () => { llim = 25; drawLinks(); }));
  if (!$('#lnkSt').dataset.ready) { $('#lnkSt').value = U.length ? 'unl' : (T.conf.n ? 'To confirm' : ''); $('#lnkSt').dataset.ready = '1'; }
  drawLinks();
};
