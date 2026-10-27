// Collections dashboard: the staff portal's Dream Signature dashboard, reading the ERP's own records.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n, exact) => {
  n = +n || 0; const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (exact || a < 1e5) return s + '₹' + Math.round(a).toLocaleString('en-IN');
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(a >= 1e9 ? 1 : 2) + ' Cr';
  return s + '₹' + (a / 1e5).toFixed(2) + ' L';
};
const cnt = (n) => (+n || 0).toLocaleString('en-IN');
const fmtD = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtM = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const pct = (a, b) => b ? Math.round((a / b) * 100) + '%' : '—';
const fig = (label, val, cls = '', note = '') => `<div class="fig ${cls}"><span>${label}</span><b>${val}</b>${note ? `<small>${note}</small>` : ''}</div>`;
const tagFor = (s) => !s ? '' : `<span class="tag ${s === 'Defaulter' ? 'risk' : s === 'No Due' ? 'ok' : /TDS|Follow|Part|Floor/.test(s) ? 'due' : ''}">${esc(s)}</span>`;

let M = null, charts = {};
if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily; Chart.defaults.color = '#5E6A72'; }

// ---------- load ----------
// The project is the one picked in the ERP (remembered in this browser); ?project=ID overrides it.
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } } };
const PROJ = +(new URLSearchParams(location.search).get('project') || store.get('erp_project') || 0);
async function load() {
  $('#syncText').textContent = 'Updating…';
  let r, j;
  try {
    if (!PROJ) { const m = await fetch('/api/masters', { credentials: 'same-origin' }); if (m.status === 401) { location.replace('/'); return; } const mj = await m.json(); const p = (mj.projects || []).find((x) => x.code === 'SIGNATURE') || (mj.projects || [])[0]; if (!p) throw new Error('No project is set up yet.'); location.replace('/dashboard?project=' + p.id); return; }
    r = await fetch('/api/dashboard?project=' + PROJ, { credentials: 'same-origin', cache: 'no-store' });
    j = await r.json().catch(() => ({}));
  } catch (e) { r = { ok: false }; j = { error: e.message }; }
  if (r.status === 401) { location.replace('/'); return; }
  if (!r.ok) { $('#app').classList.add('hidden'); $('#gate').classList.remove('hidden'); $('#gateMsg').innerHTML = `${esc(j.error || 'The dashboard could not be loaded.')}<br><br><a href="/">Back to the ERP</a>`; return; }
  M = j; $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderAll();
}
$('#logoutBtn').onclick = async () => { await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); location.replace('/'); };
$('#refreshBtn').onclick = () => load();
setInterval(() => { if (!document.hidden && M) load(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && M) load(); });

// ---------- tabs ----------
function go(v) {
  const b = $(`#tabs button[data-v="${v}"]`); if (!b) return;
  $$('#tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  if (v === 'daily') renderDaily();
  window.scrollTo({ top: 0 });
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  go(b.dataset.v);
  try { history.replaceState(null, '', location.pathname + location.search + '#' + b.dataset.v); } catch {}
});

function renderAll() {
  const m = M.meta;
  $('#syncDot').className = 'dot';
  $('#syncText').textContent = 'From the ERP · ' + new Date(m.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + (m.lastBankDate ? ` · bank entries to ${fmtD(m.lastBankDate)}` : '');
  const b = $('#banner');
  b.classList.toggle('hidden', !M.checks.open);
  b.innerHTML = M.checks.open ? `<a href="/#/verify">${cnt(M.checks.open)} items from the import are still to be verified</a>.` : '';
  renderOverview(); renderDaily(); renderCollections(); renderDues(); renderDates();
}

// ---------- overview ----------
function renderCommandCentre() {
  const d = M.daily;
  const cc = $('#ccFigs');
  if (!d.length) {
    const why = M.meta?.bankIssue;
    cc.innerHTML = why ? `<div class="empty" style="text-align:left;color:var(--risk)"><b>Collections could not be read from the sheet.</b><br>${esc(why)}</div>` : '<div class="empty">No collections yet.</div>';
    return;
  }
  const today = M.meta.today;
  const win = (n) => d.filter((x) => (Date.parse(today) - Date.parse(x.date)) / 864e5 < n);
  const mtd = d.filter((x) => x.date.slice(0, 7) === today.slice(0, 7));
  const prevMonth = new Date(Date.parse(today + 'T00:00:00'));
  prevMonth.setUTCDate(1); prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const pm = prevMonth.toISOString().slice(0, 7);
  const pmDays = d.filter((x) => x.date.slice(0, 7) === pm);
  const dayOf = +today.slice(8, 10);
  const pmSame = pmDays.filter((x) => +x.date.slice(8, 10) <= dayOf);
  const mtdNet = sum(mtd, 'net'), pmNet = sum(pmSame, 'net');
  const delta = pmNet ? Math.round(((mtdNet - pmNet) / pmNet) * 100) : null;
  const l7 = win(7), l30 = win(30);
  const latest = d[0];
  // Today's figure comes from the sheet's own Daily Report (Dashboard tab, "Today Collection" total),
  // falling back to the latest bank day if that block is missing.
  const tc = M.dailyReport?.rows?.find((x) => /today collection/i.test(x.label));

  cc.innerHTML = [
    tc ? fig('Today collection', inr(tc.total), 'in', `${fmtD(M.dailyReport.reportDate)} · RERA account`)
      : fig('Latest day', inr(latest.net), 'in', `${fmtDay(latest.date)} · ${latest.count} receipts`),
    // Running totals from the same daily report block (matched by label, e.g. "Demand sent: 10%")
    ...[['demand sent', 'Demand sent', ''], ['received as on date', 'Received as on date', 'in'], ['balance collection', 'Balance collection', 'due']].map(([k, label, cls]) => {
      const x = M.dailyReport?.rows?.find((r) => r.label.toLowerCase().startsWith(k));
      if (!x) return '';
      const pctNote = x.label.match(/\d+%/)?.[0];
      return fig(pctNote ? `${label} (${pctNote})` : label, inr(x.total), cls, `A ${inr(x.a)} · B ${inr(x.b)}`);
    }),
    fig('Last 7 days', inr(sum(l7, 'net')), 'in', `${sum(l7, 'count')} receipts`),
    fig('Last 30 days', inr(sum(l30, 'net')), 'in', `avg ${inr(sum(l30, 'net') / Math.max(l30.length, 1))}/day`),
    fig('Month to date', inr(mtdNet), 'in', delta === null ? `CRM ${inr(sum(mtd, 'crm'))}` : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs ${fmtM(pm)} same point`),
    fig('Returns this month', inr(sum(mtd, 'returns')), sum(mtd, 'returns') ? 'risk' : '', `${sum(mtd, 'returnCount')} cheques/transfers`),
  ].join('');

  const series = d.slice(0, 30).reverse();
  chart('ccChart', 'bar', {
    labels: series.map((x) => fmtDay(x.date)),
    datasets: [{ label: 'Net collected', data: series.map((x) => x.net), backgroundColor: '#117A65' }],
  }, { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { ticks: { callback: (v) => inr(v) } } } });

  $('#ccTbl').innerHTML = '<thead><tr><th>Day</th><th class="n">Receipts</th><th class="n">Net</th></tr></thead><tbody>' +
    d.slice(0, 8).map((x) => `<tr class="click" data-goday="${x.date}"><td>${fmtDay(x.date)}</td><td class="n">${cnt(x.count)}</td><td class="n">${inr(x.net)}</td></tr>`).join('') + '</tbody>';
}
$('#ccMore').addEventListener('click', () => go('daily'));
$('#ccTbl').addEventListener('click', (e) => {
  const r = e.target.closest('[data-goday]'); if (!r) return;
  dayR = 'all'; dayFrom = dayTo = ''; $('#dayFrom').value = ''; $('#dayTo').value = '';
  selDay = r.dataset.goday; go('daily');
});

function renderDailyReport() {
  const r = M.dailyReport;
  $('#drPanel').hidden = !r?.rows?.length;
  if (!r?.rows?.length) return;
  $('#drTitle').textContent = `Daily report · ${fmtD(r.reportDate)}`;
  // Same rows as the sheet's Dashboard tab; counts first, then rupee amounts.
  const money = (x) => [x.a, x.b, x.total].some((v) => Math.abs(v) >= 1000);
  const f = (x, v) => (money(x) ? inr(v, true) : cnt(v));
  $('#drTbl').innerHTML = `<thead><tr><th>Wing</th><th class="n w-A">A</th><th class="n w-B">B</th><th class="n">Total</th></tr></thead><tbody>` +
    r.rows.map((x) => {
      const cls = /today collection/i.test(x.label) ? ' style="color:var(--in)"' : '';
      return `<tr${cls}><td>${esc(x.label.replace(/:$/, ''))}</td><td class="n">${f(x, x.a)}</td><td class="n">${f(x, x.b)}</td><td class="n"><b>${f(x, x.total)}</b></td></tr>`;
    }).join('') + '</tbody>';
}

// TDS boxes: total due = TDS column of CRM Follow up (1% of agreement value); paid = its TDS Paid column.
// Each box opens the unit-wise report (accounts-detail.js modal).
function tdsFigs() {
  if (!window.Drill) return [];
  Drill.mount(); Drill.reset();
  const rows = M.units.filter((u) => u.tds > 0).map((u) => ({ ...u, bal: u.tds - (u.tdsPaid || 0) }));
  const due = rows.reduce((s, u) => s + u.tds, 0), paid = rows.reduce((s, u) => s + (u.tdsPaid || 0), 0);
  const paidRows = rows.filter((u) => u.tdsPaid > 0).sort((a, b) => b.tdsPaid - a.tdsPaid);
  const C = [['Unit', (u) => u.unit], ['Buyer', (u) => u.applicant], ['Status', (u) => u.inventory], ['Agreement value', (u) => u.agreementValue, 'amt'],
    ['TDS due (1%)', (u) => u.tds, 'amt'], ['TDS paid', (u) => u.tdsPaid, 'amt'], ['TDS balance', (u) => u.bal, 'amt'], ['Follow-up status', (u) => u.followStatus]];
  const sub = `${inr(due, true)} due · ${inr(paid, true)} paid · ${inr(due - paid, true)} balance`;
  const dueD = Drill.reg('TDS due by unit', () => ({ sub, sections: [{ cols: C, rows, sumCol: 'TDS due (1%)' }] }), false);
  const paidD = Drill.reg('TDS paid by customers', () => ({ sub: `${inr(paid, true)} paid on ${cnt(paidRows.length)} units`,
    note: 'From the TDS Paid column of the CRM Follow up tab. The challan-by-challan list is on the Accounts tab (TDS Tracker in the master sheet).',
    sections: [{ cols: C, rows: paidRows, sumCol: 'TDS paid' }] }), false);
  return [
    `<div class="fig due" ${dueD}><span>Total TDS due</span><b>${inr(due)}</b><small>1% of AV, ${cnt(rows.length)} units · ${inr(due - paid)} still to come</small></div>`,
    `<div class="fig in" ${paidD}><span>TDS paid</span><b>${inr(paid)}</b><small>${cnt(paidRows.length)} units · ${pct(paid, due)} of TDS due · tap for report</small></div>`,
  ];
}


// Overview boxes: each opens the rows behind its figure (accounts-detail.js modal), like the Accounts page.
function wireFigs() {
  if (!window.Drill) return;
  Drill.mount();
  const today = M.meta.today, d = M.daily || [], booked = M.units.filter((u) => u.booked);
  const UC = [['Unit', (u) => u.unit], ['Buyer', (u) => u.applicant], ['Phone', (u) => u.phone], ['Status', (u) => u.inventory], ['Agreement value', (u) => u.agreementValue, 'amt'],
    ['Received (AV)', (u) => u.receivedAV, 'amt'], ['Balance (AV)', (u) => (u.balanceDue > 0 ? u.balanceDue : 0), 'amt'], ['Follow-up status', (u) => u.followStatus],
    ['Registration', (u) => (u.registered ? fmtD(u.registrationDate) : u.registrationStatus || '')]];
  const units = (rows, sumCol, note) => () => ({ note, sections: [{ cols: UC, rows, sumCol }] });
  const byDesc = (rows, k) => [...rows].sort((a, b) => (b[k] || 0) - (a[k] || 0));
  const EC = [['Date', (e) => fmtD(e.date)], ['Unit', (e) => e.unit], ['Customer', (e) => e.customer], ['Team', (e) => (e.kind === 'return' ? 'Returned' : e.team)], ['Mode', (e) => e.mode], ['Amount', (e) => e.amount, 'amt']];
  const ents = (f, kind) => d.filter(f).flatMap((x) => x.items.filter((i) => i.kind === kind).map((i) => ({ ...i, date: x.date }))).sort((a, b) => b.date.localeCompare(a.date));
  const win = (n) => (x) => (Date.parse(today) - Date.parse(x.date)) / 864e5 < n;
  const mtd = (x) => x.date.slice(0, 7) === today.slice(0, 7);
  const entries = (f, kind = 'receipt') => () => ({ sections: [{ cols: EC, rows: ents(f, kind) }] });
  const rep = M.dailyReport;
  const money = (x) => [x.a, x.b, x.total].some((v) => Math.abs(v) >= 1000);
  const dailyRows = (label) => () => ({ sub: `Daily report · ${fmtD(rep.reportDate)}`, sections: [{ count: false, cols: [['Item', (x) => x.label.replace(/:$/, '')],
    ['A', (x) => (money(x) ? inr(x.a, true) : cnt(x.a))], ['B', (x) => (money(x) ? inr(x.b, true) : cnt(x.b))], ['Total', (x) => (money(x) ? inr(x.total, true) : cnt(x.total))]],
    rows: rep.rows.filter((x) => x.label.toLowerCase().startsWith(label.toLowerCase().replace(/ \(\d+%\)$/, ''))) .concat(rep.rows.filter((x) => !x.label.toLowerCase().startsWith(label.toLowerCase().replace(/ \(\d+%\)$/, '')))) }] });
  const todayDay = rep?.reportDate && d.some((x) => x.date === rep.reportDate) ? rep.reportDate : d[0]?.date;
  const B = {
    'units sold': () => units(booked, null, 'All booked units (sold, allotment and team-held bookings).')(),
    'registered': units(byDesc(booked.filter((u) => u.registered), 'agreementValue'), 'Agreement value'),
    'allotment': units(byDesc(M.units.filter((u) => /^allotment$/i.test(u.inventory || '')), 'agreementValue'), 'Agreement value'),
    'agreement value': units(byDesc(booked, 'agreementValue'), 'Agreement value'),
    'received (av)': units(byDesc(booked.filter((u) => u.receivedAV > 0), 'receivedAV'), 'Received (AV)'),
    'balance due (av)': units(byDesc(booked.filter((u) => u.balanceDue > 0), 'balanceDue'), 'Balance (AV)'),
    'defaulters': units(byDesc(M.units.filter((u) => u.followStatus === 'Defaulter'), 'balanceDue'), 'Balance (AV)', 'Units flagged Defaulter in the CRM follow-up.'),
    'today collection': entries((x) => x.date === todayDay),
    'latest day': entries((x) => x.date === d[0]?.date),
    'last 7 days': entries(win(7)), 'last 30 days': entries(win(30)), 'month to date': entries(mtd),
    'returns this month': entries(mtd, 'return'),
  };
  if (rep?.rows?.length) ['balance registration', 'demand sent', 'received as on date', 'balance collection'].forEach((k) => { B[k] = dailyRows(k); });
  $$('#topFigs .fig, #ccFigs .fig').forEach((el) => {
    if (el.dataset.drill !== undefined) return;
    const label = el.querySelector('span')?.textContent.trim() || '';
    const key = Object.keys(B).find((k) => label.toLowerCase().startsWith(k));
    if (!key) return;
    const tmp = document.createElement('div'); tmp.innerHTML = `<i ${Drill.reg(label, B[key], false)}></i>`;
    [...tmp.firstChild.attributes].forEach((a) => el.setAttribute(a.name, a.value));
    el.classList.add('drillable');
  });
}

function renderOverview() {
  renderCommandCentre();
  renderDailyReport();
  const t = M.totals;
  $('#topFigs').innerHTML = [
    fig('Units sold', `${cnt(t.booked)} / ${cnt(t.units)}`, '', `${cnt(t.available)} available · ${cnt(t.held)} on hold`),
    fig('Registered', cnt(t.registered), '', `${pct(t.registered, t.booked)} of sold`),
    ...['Allotment', 'Balance Registration'].map((name) => {
      const x = M.dailyReport?.rows?.find((r) => r.label.toLowerCase() === name.toLowerCase());
      return x ? fig(name, cnt(x.total), '', `A ${cnt(x.a)} · B ${cnt(x.b)}`) : '';
    }),
    fig('Agreement value', inr(t.agreementValue), '', `${inr(t.registeredValue)} registered`),
    fig('Received (AV)', inr(t.receivedAV), 'in', `+ ${inr(t.receivedGST)} GST`),
    fig('Balance due (AV)', inr(t.balanceDue), 'due', `+ ${inr(t.gstDue)} GST due`),
    ...tdsFigs(),
    fig('Defaulters', cnt(M.actions.defaulters.length), 'risk', inr(M.actions.defaulters.reduce((s, x) => s + x.balanceDue, 0)) + ' owed'),
  ].join('');
  wireFigs();
  drawTower();
  const A = M.byWing.A, B = M.byWing.B;
  const row = (l, a, b, f = cnt) => `<tr><td>${l}</td><td class="n">${f(a)}</td><td class="n">${f(b)}</td><td class="n"><b>${f(a + b)}</b></td></tr>`;
  $('#wingTbl').innerHTML = `<thead><tr><th></th><th class="n w-A">Wing A</th><th class="n w-B">Wing B</th><th class="n">Total</th></tr></thead><tbody>
    ${row('Units', A.units, B.units)}${row('Sold', A.booked, B.booked)}${row('Registered', A.registered, B.registered)}
    ${row('Agreement value', A.agreementValue, B.agreementValue, inr)}${row('Received', A.receivedAV, B.receivedAV, inr)}
    ${row('Balance due', A.balanceDue, B.balanceDue, inr)}${row('SDR received', A.sdrReceived, B.sdrReceived, inr)}</tbody>`;
  $('#invTbl').innerHTML = `<thead><tr><th>Status</th><th class="n">A</th><th class="n">B</th><th class="n">Units</th></tr></thead><tbody>` +
    M.inventory.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.A || 0}</td><td class="n">${r.B || 0}</td><td class="n"><b>${r.units}</b></td></tr>`).join('') + '</tbody>';
}

let towerMode = 'status';
$('#towerMode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  towerMode = b.dataset.m; $$('#towerMode button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawTower();
});
function unitClass(u) {
  const inv = (u.inventory || '').toLowerCase();
  if (inv === 'refuge') return 'ref';
  if (towerMode === 'dues') {
    if (!u.booked) return 'd-na';
    if (u.followStatus === 'Defaulter') return 'd-risk';
    if (u.followStatus === 'TDS Due Only') return 'd-tds';
    if (u.balanceDue > 1000) return 'd-due';
    return 'd-ok';
  }
  if (inv === 'available') return '';
  if (u.registered) return 'reg';
  if (['sold', 'allotment', 'sales team', 'crm team'].includes(inv)) return 'bkd';
  return 'hold';
}
function drawTower() {
  const html = ['A', 'B'].map((w) => {
    const us = M.units.filter((u) => u.wing === w && u.floor);
    const floors = {};
    us.forEach((u) => (floors[u.floor] = floors[u.floor] || []).push(u));
    const keys = Object.keys(floors).map(Number).sort((a, b) => a - b);
    const k = M.byWing[w];
    return `<div class="tower"><h3><span class="w-${w}">Wing ${w}</span><small>${k.registered}/${k.units} registered</small></h3><div class="floors">` +
      keys.map((f) => `<div class="floor"><i>${f}</i>` + floors[f].sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true })).slice(0, 8)
        .map((u) => `<button class="u ${unitClass(u)}" data-u="${esc(u.unit)}" title="${esc(u.unit)} · ${esc(u.inventory)}${u.balanceDue > 0 ? ' · due ' + inr(u.balanceDue) : ''}" aria-label="${esc(u.unit)}"></button>`).join('') + '</div>').join('') +
      '</div></div>';
  }).join('');
  $('#tower').innerHTML = html;
  const L = towerMode === 'status'
    ? [['var(--in)', 'Registered'], ['var(--in2)', 'Booked, not registered'], ['var(--hold)', 'Management / reference hold'], ['#fff;box-shadow:inset 0 0 0 1px #C3CAC4', 'Available'], ['#D9DDD6', 'Refuge']]
    : [['var(--in)', 'No balance'], ['#E8C98C', 'TDS due only'], ['var(--due)', 'Balance outstanding'], ['var(--risk)', 'Defaulter'], ['#EEF0EC', 'Not sold']];
  $('#towerLegend').innerHTML = L.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (b) openUnit(b.dataset.u); });

// ---------- daily ----------
let selDay = null;
const sum = (a, f) => a.reduce((t, x) => t + x[f], 0);
// Day filter: a preset range, or an explicit from/to which overrides it.
let dayR = '30', dayFrom = '', dayTo = '';
function daysIn() {
  const d = M.daily;
  if (dayFrom || dayTo) {
    const a = dayFrom || '0000-01-01', b = dayTo || '9999-12-31';
    return d.filter((x) => x.date >= a && x.date <= b);
  }
  if (dayR === 'all') return d;
  if (dayR === 'mtd') return d.filter((x) => x.date.slice(0, 7) === M.meta.today.slice(0, 7));
  return d.filter((x) => (Date.parse(M.meta.today) - Date.parse(x.date)) / 864e5 < +dayR);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function scopeLabel(w) {
  if (dayFrom || dayTo) return `${plural(w.length, 'day')} · ${dayFrom ? fmtD(dayFrom) : 'start'} to ${dayTo ? fmtD(dayTo) : 'latest'}`;
  if (dayR === 'all') return `All ${plural(w.length, 'day')} with activity`;
  if (dayR === 'mtd') return `${plural(w.length, 'day')} this month`;
  return `Last ${dayR} days · ${w.length} with activity`;
}

function renderDaily() {
  const d = M.daily;
  if (!d.length) { $('#dayList').innerHTML = '<div class="empty">No bank entries yet.</div>'; return; }
  const w = daysIn();
  $('#dayScope').textContent = scopeLabel(w);
  $('#dayClear').hidden = !(dayFrom || dayTo);
  $$('#dayRange button').forEach((b) => b.setAttribute('aria-pressed', !(dayFrom || dayTo) && b.dataset.r === dayR));
  if (!w.length) {
    $('#dailyFigs').innerHTML = '';
    $('#dayList').innerHTML = '<div class="empty">No collections in this range.</div>';
    $('#dayFigs').innerHTML = ''; $('#dayTbl').innerHTML = '';
    charts.dailyChart?.destroy(); delete charts.dailyChart;
    return;
  }
  const latest = w[0];
  $('#dailyFigs').innerHTML = [
    fig('Range net', inr(sum(w, 'net')), 'in', `${sum(w, 'count')} receipts over ${w.length} days`),
    fig('Daily average', inr(sum(w, 'net') / w.length), '', 'across days with activity'),
    fig('Best day', inr(Math.max(...w.map((x) => x.net))), 'in', fmtDay(w.reduce((a, b) => (b.net > a.net ? b : a)).date)),
    fig('CRM vs Sales', inr(sum(w, 'crm')), '', `Sales ${inr(sum(w, 'sales'))}`),
    fig('Returns in range', inr(sum(w, 'returns')), sum(w, 'returns') ? 'risk' : '', `${sum(w, 'returnCount')} cheques/transfers`),
  ].join('');
  $('#dailyChartTitle').textContent = scopeLabel(w);
  const series = w.slice(0, 60).reverse();
  chart('dailyChart', 'bar', {
    labels: series.map((x) => fmtDay(x.date)),
    datasets: [{ label: 'CRM team', data: series.map((x) => x.crm), backgroundColor: '#117A65', stack: 's' },
      { label: 'Sales team', data: series.map((x) => x.sales), backgroundColor: '#7FBFAE', stack: 's' },
      { label: 'Returns', data: series.map((x) => -x.returns), backgroundColor: '#B42318', stack: 's' }],
  }, { scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true } }, y: { stacked: true, ticks: { callback: (v) => inr(v) } } } });
  $('#dayList').innerHTML = w.map((x) => `<button data-day="${x.date}" aria-pressed="false"><span>${fmtDay(x.date)}<br><small>${x.count} receipts${x.returnCount ? ` · ${x.returnCount} returned` : ''}</small></span><span class="amt">${inr(x.net)}</span></button>`).join('');
  showDay(selDay && w.find((x) => x.date === selDay) ? selDay : latest.date);
}
$('#dayRange').addEventListener('click', (e) => {
  const b = e.target.closest('[data-r]'); if (!b) return;
  dayR = b.dataset.r; dayFrom = dayTo = ''; $('#dayFrom').value = ''; $('#dayTo').value = '';
  renderDaily();
});
['#dayFrom', '#dayTo'].forEach((id) => $(id).addEventListener('change', () => {
  dayFrom = $('#dayFrom').value; dayTo = $('#dayTo').value; renderDaily();
}));
$('#dayClear').addEventListener('click', () => {
  dayFrom = dayTo = ''; $('#dayFrom').value = ''; $('#dayTo').value = ''; renderDaily();
});
$('#dayList').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) showDay(b.dataset.day); });
function showDay(date) {
  selDay = date; const x = M.daily.find((d) => d.date === date);
  $$('#dayList button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.day === date));
  $('#dayFigs').innerHTML = [fig(fmtD(date), inr(x.receipts), 'in', `${x.count} receipts · ${x.units} units`), fig('CRM team', inr(x.crm)), fig('Sales team', inr(x.sales)), fig('Returns', inr(x.returns), x.returns ? 'risk' : '')].join('');
  $('#dayTbl').innerHTML = `<thead><tr><th>Unit</th><th>Customer</th><th>Team</th><th>Mode</th><th class="n">Amount</th></tr></thead><tbody>` +
    x.items.sort((a, b) => b.amount - a.amount).map((i) => `<tr ${i.unit ? `class="click" data-u="${esc(i.unit)}"` : ''}><td><b>${esc(i.unit || '—')}</b></td><td>${esc(i.customer)}${i.remarks ? `<div class="rmk">${esc(i.remarks)}</div>` : ''}</td><td>${i.kind === 'return' ? '<span class="tag risk">Returned</span>' : esc(i.team)}</td><td>${esc(i.mode)}</td><td class="n" style="${i.kind === 'return' ? 'color:var(--risk)' : ''}">${i.kind === 'return' ? '−' : ''}${inr(i.amount, true)}</td></tr>`).join('') + '</tbody>';
}

// ---------- collections ----------
function renderCollections() {
  const F = M.forecast;
  if (F) {
    $('#fcFigs').innerHTML = [fig('Due now', inr(F.overdue), F.overdue ? 'risk' : 'in', 'past the due date'), fig('Falls due in 30 days', inr(F.dueNext30), 'due', `${cnt(F.dueNext30Count)} buyers`),
      fig('Promised in 30 days', inr(F.promised), 'in', `${cnt(F.promisedCount)} promises logged in follow-ups`),
      ...F.nextStages.map((x) => fig(`Next stage · Wing ${x.wing}`, inr(x.amount + x.gst), '', `${x.stage.replace(/^On (Completion of )?/, '')} · ${x.pct}% of ${cnt(x.bookings)} bookings, incl. GST`))].join('');
    $('#fcTbl').innerHTML = F.nextStages.length ? '<thead><tr><th>Wing</th><th>Next stage to demand</th><th class="n">%</th><th class="n">Bookings</th><th class="n">Amount</th><th class="n">GST</th><th class="n">Total</th></tr></thead><tbody>' +
      F.nextStages.map((x) => `<tr><td><b class="w-${esc(x.wing)}">${esc(x.wing)}</b></td><td>${esc(x.stage)}</td><td class="n">${x.pct}%</td><td class="n">${cnt(x.bookings)}</td><td class="n">${inr(x.amount, true)}</td><td class="n">${inr(x.gst, true)}</td><td class="n"><b>${inr(x.amount + x.gst, true)}</b></td></tr>`).join('') + '</tbody>' : '';
  }
  const t = M.totals, mo = M.monthly;
  const s = (f) => mo.reduce((a, x) => a + x[f], 0);
  $('#colFigs').innerHTML = [
    fig('Received vs agreement', pct(t.receivedAV, t.agreementValue), 'in', `${inr(t.receivedAV)} of ${inr(t.agreementValue)}`),
    fig('RERA receipts (net)', inr(s('net')), 'in', `${fmtM(mo[0]?.month)} – ${fmtM(mo.at(-1)?.month)}`),
    fig('Returned cheques', inr(s('returns')), 'risk'),
    fig('SDR received', inr(t.sdrReceived), '', `paid ${inr(t.sdrPaid)}`),
    fig('GST received', inr(t.receivedGST), '', `due ${inr(t.gstDue)}`),
  ].join('');
  chart('monthChart', 'bar', {
    labels: mo.map((x) => fmtM(x.month)),
    datasets: [{ label: 'CRM team', data: mo.map((x) => x.crm), backgroundColor: '#117A65', stack: 's' },
      { label: 'Sales team', data: mo.map((x) => x.sales), backgroundColor: '#7FBFAE', stack: 's' },
      { label: 'Returns', data: mo.map((x) => -x.returns), backgroundColor: '#B42318', stack: 's' }],
  }, { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => inr(v) } } } });
  const rg = M.dates.registrationsByMonth.slice(-12);
  chart('regChart', 'bar', { labels: rg.map((x) => fmtM(x.month)), datasets: [{ label: 'Units registered', data: rg.map((x) => x.units), backgroundColor: '#2B5C8A' }] },
    { plugins: { legend: { display: false } } });
  $('#monthTbl').innerHTML = `<thead><tr><th>Month</th><th class="n">Receipts</th><th class="n">CRM team</th><th class="n">Sales team</th><th class="n">Returns</th><th class="n">Net</th></tr></thead><tbody>` +
    mo.slice().reverse().map((x) => `<tr><td>${fmtM(x.month)}</td><td class="n">${x.count}</td><td class="n">${inr(x.crm)}</td><td class="n">${inr(x.sales)}</td><td class="n" style="color:var(--risk)">${inr(x.returns)}</td><td class="n"><b>${inr(x.net)}</b></td></tr>`).join('') + '</tbody>';
}

// ---------- dues ----------
const QUEUES = [
  ['defaulters', 'Defaulters', 'Marked defaulter in CRM'],
  ['overdueDemands', 'Overdue demands', 'Demand older than 15 days, balance unpaid'],
  ['highDues', 'High dues', 'Balance of ₹5 L or more'],
  ['tdsPending', 'TDS due only', 'Only TDS left to collect'],
  ['registrationPending', 'Registration pending', 'Booking form in, not registered'],
  ['sdrGaps', 'SDR gaps', 'SDR received ≠ SDR paid'],
  ['missingDates', 'Missing dates', 'Key dates blank in the sheet'],
];
let selQ = 'defaulters';
function renderDues() {
  $('#followTbl').innerHTML = `<thead><tr><th>Status</th><th class="n">Wing A</th><th class="n">Wing B</th><th class="n">Units</th><th class="n">Balance due</th></tr></thead><tbody>` +
    M.followUp.map((r) => `<tr><td>${tagFor(r.name)}</td><td class="n">${r.A || 0}</td><td class="n">${r.B || 0}</td><td class="n">${r.units}</td><td class="n"><b>${inr(r.balance)}</b></td></tr>`).join('') +
    `<tr><td><b>Total</b></td><td></td><td></td><td class="n"><b>${M.followUp.reduce((s, r) => s + r.units, 0)}</b></td><td class="n"><b>${inr(M.followUp.reduce((s, r) => s + r.balance, 0))}</b></td></tr></tbody>`;
  $('#qList').innerHTML = QUEUES.map(([k, l, d]) => `<button data-q="${k}" aria-pressed="${k === selQ}"><span>${l}<small>${d}</small></span><b>${M.actions[k].length}</b></button>`).join('');
  drawQueue();
}
$('#qList').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; selQ = b.dataset.q; $$('#qList button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawQueue(); });
$('#qSearch').addEventListener('input', drawQueue);
function drawQueue() {
  const q = $('#qSearch').value.toLowerCase();
  const rows = M.actions[selQ].filter((x) => !q || [x.unit, x.applicant, x.remark].join(' ').toLowerCase().includes(q));
  const extra = { registrationPending: ['Days waiting', (x) => x.ageDays ?? '—'], overdueDemands: ['Demand age', (x) => x.demandAgeDays + ' d'],
    tdsPending: ['TDS due', (x) => inr(x.tdsDue)], sdrGaps: ['SDR gap', (x) => inr(x.sdrDifference)], missingDates: ['Missing', (x) => esc(x.missing)] }[selQ] || ['Demand date', (x) => fmtD(x.demandDate)];
  $('#qTbl').innerHTML = rows.length ? `<thead><tr><th>Unit</th><th>Applicant</th><th>Phone</th><th class="n">Balance</th><th>${extra[0]}</th><th>Status</th><th>Latest remark</th></tr></thead><tbody>` +
    rows.map((x) => `<tr class="click" data-u="${esc(x.unit)}"><td><b class="w-${x.wing}">${esc(x.unit)}</b></td><td>${esc(x.applicant)}</td><td style="white-space:nowrap">${esc(x.phone)}</td><td class="n">${inr(x.balanceDue)}</td><td>${extra[1](x)}</td><td>${tagFor(x.followStatus)}</td><td class="rmk">${esc((x.remark || '').slice(0, 160))}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">Nothing in this list.</td></tr></tbody>';
}

// ---------- dates ----------
function renderDates() {
  const D = M.dates;
  const ev = (rows) => rows.length ? `<thead><tr><th>Date</th><th>Event</th><th>Unit</th><th>Applicant</th></tr></thead><tbody>` +
    rows.map((x) => `<tr class="click" data-u="${esc(x.unit)}"><td style="white-space:nowrap">${fmtD(x.date)}</td><td>${esc(x.event)}</td><td><b>${esc(x.unit)}</b></td><td>${esc(x.applicant)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">No dated events in this window.</td></tr></tbody>';
  $('#upTbl').innerHTML = ev(D.upcoming);
  $('#recentTbl').innerHTML = ev(D.recent);
  $('#lineTbl').innerHTML = D.lineups.length ? `<thead><tr><th>Unit</th><th>Applicant</th><th>Line-up</th><th>RM</th><th class="n">Balance</th></tr></thead><tbody>` +
    D.lineups.map((x) => `<tr class="click" data-u="${esc(x.unit)}"><td><b>${esc(x.unit)}</b></td><td>${esc(x.applicant)}</td><td>${esc(x.status)}</td><td>${esc(x.rm)}</td><td class="n">${inr(x.balanceDue)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">No units marked for line-up.</td></tr></tbody>';
}

// ---------- units ----------
let uLimit = 60;
function openUnit(id) {
  const u = M.units.find((x) => x.unit === id); if (!u) return;
  const paid = u.agreementValue ? Math.min(100, (u.receivedAV / u.agreementValue) * 100) : 0;
  const dl = (pairs) => '<dl>' + pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
  const pays = M.daily.flatMap((d) => d.items.filter((i) => i.unit === u.unit).map((i) => ({ ...i, date: d.date })));
  $('#dBody').innerHTML = `<button class="close" type="button">Close</button>${u.bookingId ? `<a class="btn" style="float:right;margin-right:8px" href="/#/booking/${u.bookingId}">Open in ERP</a>` : ''}
    <h2 id="dTitle" class="w-${u.wing}">${esc(u.unit)}</h2>
    <p class="sub">${esc(u.typology)} · ${cnt(u.sqft)} sq ft · Floor ${u.floor ?? '—'} · ${esc(u.inventory)} ${tagFor(u.followStatus)}</p>
    ${u.agreementValue ? `<div class="meter"><i style="width:${paid}%"></i></div><small>${paid.toFixed(0)}% of agreement value received</small>` : ''}
    <h3 style="margin-top:20px">Buyer</h3>${dl([['Applicant', esc(u.applicant)], ['Co-applicant', esc(u.coApplicant)], ['Phone', esc(u.phone)], ['RM', esc(u.rm)], ['Source', esc(u.source)], ['CP firm', esc(u.cpFirm)], ['Funding', esc(u.funding)]])}
    <h3 style="margin-top:20px">Money</h3>${dl([['Agreement value', inr(u.agreementValue, true)], ['Market value', u.marketValue ? inr(u.marketValue, true) : ''], ['Received (AV)', inr(u.receivedAV, true)],
      ['Balance due', inr(u.balanceDue, true)], ['GST received / due', `${inr(u.receivedGST, true)} / ${inr(u.gstDue, true)}`], ['TDS / paid / due', `${inr(u.tds, true)} / ${inr(u.tdsPaid, true)} / ${inr(u.tdsDue, true)}`],
      ['SDR received / paid', `${inr(u.sdrReceived, true)} / ${inr(u.sdrPaid, true)}`], ['Brokerage', u.brokerageStatus ? `${esc(u.brokerageStatus)} ${u.brokerageReleased ? inr(u.brokerageReleased, true) : ''}` : '']])}
    <h3 style="margin-top:20px">Dates &amp; workflow</h3>${dl([['Booking', fmtD(u.bookingDate)], ['Allotment', fmtD(u.allotmentDate)], ['Booking form received', fmtD(u.bookingFormDate)],
      ['Demand raised', fmtD(u.demandDate)], ['Registration', u.registered ? fmtD(u.registrationDate) : esc(u.registrationStatus || 'Not registered')], ['Bank NOC', fmtD(u.bankNocDate)],
      ['Agreement type', esc(u.agreementType)]])}
    ${u.remark ? `<h3 style="margin-top:20px">Latest follow-up note</h3><p class="rmk" style="max-width:none">${esc(u.remark)}</p>` : ''}
    ${pays.length ? `<h3 style="margin-top:20px">RERA account entries</h3><div class="tbl"><table><tbody>${pays.map((p) => `<tr><td>${fmtD(p.date)}</td><td>${p.kind === 'return' ? '<span class="tag risk">Returned</span>' : esc(p.team)}</td><td>${esc(p.mode)}</td><td class="n">${inr(p.amount, true)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#drawer .close').onclick = closeUnit;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#drawer .close').focus();
}
function closeUnit() { $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); }
$('#drawer .scrim').onclick = closeUnit;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUnit(); });

// ---------- audit ----------
let cpLimit = 40;
function chart(id, type, data, opts = {}) {
  if (!window.Chart) return;
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), { type, data, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } },
    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${type === 'bar' && id !== 'regChart' ? inr(Math.abs(c.raw), true) : c.raw}` } } }, ...opts } });
}

load().then(() => { const v = location.hash.slice(1); if (v && M) go(v); });

