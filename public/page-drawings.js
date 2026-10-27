const $ = (s) => document.querySelector(s), esc = Shell.esc;
const DISC = ['Architect', 'Structure', 'MEP', 'Other'];
const DISC_LABEL = { Architect: 'Architect', Structure: 'Structural', MEP: 'MEP', Other: 'Other' };
const BLD = ['All', 'Rehab', 'Sale', 'General'];
const NEW_DAYS = 7, DAY = 864e5;
let FILES = [], ST = { disc: 'All', bld: 'All', trade: '', q: '', onlyNew: false, cad: false };
try { Object.assign(ST, JSON.parse(localStorage.getItem('drawings.filters') || '{}'), { q: '' }); } catch {}
const save = () => { try { localStorage.setItem('drawings.filters', JSON.stringify({ ...ST, q: '' })); } catch {} };

const isNew = (f) => f.uploaded && Date.now() - Date.parse(f.uploaded) < NEW_DAYS * DAY;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtSize = (b) => b == null ? '' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const visibleKind = (f) => f.kind === 'pdf' || f.kind === 'image' || (ST.cad && (f.kind === 'cad' || f.kind === 'zip' || f.kind === 'other'));

function base() { return FILES.filter(visibleKind); }
function matches(f, skip = {}) {
  if (!skip.disc && ST.disc !== 'All' && f.discipline !== ST.disc) return false;
  if (!skip.bld && ST.bld !== 'All' && f.building !== ST.bld) return false;
  if (!skip.trade && ST.trade && f.trade !== ST.trade) return false;
  if (ST.onlyNew && !isNew(f)) return false;
  if (ST.q) {
    const hay = `${f.title} ${f.name} ${f.folder} ${f.trade} ${f.building} ${DISC_LABEL[f.discipline]}`.toLowerCase();
    if (!ST.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function renderKpis() {
  const b = base().filter((f) => matches(f, { disc: true, trade: true, bld: true }));
  const cell = (key, label, n, sub, cls = '') => `<button class="kpi ${cls}" data-disc="${key}" aria-pressed="${ST.disc === key}"><small>${label}</small><b>${n}</b><span>${sub}</span></button>`;
  const by = (d) => b.filter((f) => f.discipline === d);
  const subOf = (list) => { const r = list.filter((f) => f.building === 'Rehab').length, s = list.filter((f) => f.building === 'Sale').length; return `Rehab ${r} · Sale ${s}`; };
  const n = b.filter(isNew).length;
  $('#kpis').innerHTML = cell('All', 'All drawings', b.length, `${n} new this week`, 'new')
    + ['Architect', 'Structure', 'MEP'].map((d) => cell(d, DISC_LABEL[d], by(d).length, subOf(by(d)))).join('');
}
function renderControls() {
  const b = base().filter((f) => matches(f, { bld: true, trade: true }));
  const present = BLD.filter((x) => x === 'All' || b.some((f) => f.building === x));
  if (!present.includes(ST.bld)) ST.bld = 'All';
  $('#bld').innerHTML = present.map((x) => `<button type="button" data-bld="${x}" aria-pressed="${ST.bld === x}">${x === 'All' ? 'Both buildings' : x === 'General' ? 'General' : x}</button>`).join('');
  const tb = base().filter((f) => matches(f, { trade: true }));
  const trades = [...new Set(tb.map((f) => f.trade).filter(Boolean))].sort(coll.compare);
  if (ST.trade && !trades.includes(ST.trade)) ST.trade = '';
  $('#trade').innerHTML = `<option value="">All types</option>` + trades.map((t) => `<option ${t === ST.trade ? 'selected' : ''}>${esc(t)}</option>`).join('');
  $('#trade').hidden = trades.length < 2;
  $('#onlyNew').checked = ST.onlyNew; $('#cad').checked = ST.cad;
}
// Folder shown under the name, without the discipline folder and the consultants' "PDF" subfolders.
const shortFolder = (f) => (f.folder || '').split(' › ').slice(1).filter((x) => !/^pdf$/i.test(x.trim())).join(' › ') || 'Site Plans';
function row(f) {
  const tags = `${isNew(f) ? '<span class="tag new">New</span> ' : ''}${f.kind === 'cad' ? '<span class="tag cad">DWG</span> ' : f.kind === 'zip' ? '<span class="tag cad">ZIP</span> ' : ''}`;
  return `<div class="row"><div class="nm"><b>${tags}${esc(f.title)}</b><small>${esc(shortFolder(f))}</small></div>
    <div class="c-tr">${f.trade ? `<span class="tag tr">${esc(f.trade)}</span>` : ''}</div>
    <div class="c-dt muted" title="Uploaded ${esc(fmtDate(f.uploaded))}${f.by ? ' by ' + esc(f.by) : ''}">${esc(fmtDate(f.uploaded))}</div>
    <div class="c-sz muted">${esc(fmtSize(f.size))}</div>
    <a class="btn small go open" href="${esc(f.url)}" target="_blank" rel="noopener">${f.kind === 'pdf' ? 'Open PDF' : 'Open'}</a></div>`;
}
function renderList() {
  const list = base().filter((f) => matches(f));
  $('#count').textContent = `${list.length} drawing${list.length === 1 ? '' : 's'} shown`;
  if (!list.length) { $('#out').innerHTML = `<div class="panel state"><b>No drawings match.</b><span class="sub">Clear the search or pick another building or type.</span></div>`; return; }
  const groups = [];
  for (const d of DISC) for (const b of ['Rehab', 'Sale', 'General']) {
    const g = list.filter((f) => f.discipline === d && f.building === b);
    if (g.length) groups.push([d, b, g.sort((x, y) => coll.compare(x.trade, y.trade) || x.floor - y.floor || coll.compare(x.title, y.title))]);
  }
  $('#out').innerHTML = groups.map(([d, b, g]) => `<section class="group"><div class="ghead"><h2>${DISC_LABEL[d]} · ${b === 'General' ? 'General' : b + ' building'}</h2><span>${g.length}</span></div>
    <div class="list"><div class="row hd"><div>Drawing</div><div>Type</div><div>Uploaded</div><div>Size</div><div></div></div>${g.map(row).join('')}</div></section>`).join('');
}
function render() { renderKpis(); renderControls(); renderList(); save(); }

function showError(j) {
  const admin = Shell.me && (Shell.me.role === 'admin' || Shell.me.role === 'management');
  const msg = j.error || 'Could not load the drawings.';
  $('#kpis').innerHTML = '';
  $('#out').innerHTML = `<div class="panel state err"><b>Drawings could not be loaded</b><span>${esc(msg)}</span>${admin || j.code !== 'not_shared' ? '' : '<span class="sub">Please tell the Admin.</span>'}</div>`;
}
async function load(refresh) {
  $('#refresh').disabled = true;
  try {
    const r = await fetch('/api/me?drawings=1' + (refresh ? '&refresh=1' : ''), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showError(j); return; }
    FILES = j.files || [];
    $('#folder').href = j.folder;
    $('#checked').textContent = 'Checked ' + ago(j.checkedAt);
    $('#checked').dataset.at = j.checkedAt;
    render();
  } catch { showError({ error: 'No connection. Check the internet and press Refresh.' }); }
  finally { $('#refresh').disabled = false; }
}

document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-disc]'); if (k) { ST.disc = k.dataset.disc; ST.trade = ''; render(); return; }
  const b = e.target.closest('[data-bld]'); if (b) { ST.bld = b.dataset.bld; render(); }
});
$('#trade').onchange = (e) => { ST.trade = e.target.value; render(); };
$('#onlyNew').onchange = (e) => { ST.onlyNew = e.target.checked; render(); };
$('#cad').onchange = (e) => { ST.cad = e.target.checked; render(); };
let qt; $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { ST.q = e.target.value.trim(); renderKpis(); renderControls(); renderList(); }, 120); };
$('#refresh').onclick = () => load(true);
setInterval(() => { const at = $('#checked').dataset.at; if (at) $('#checked').textContent = 'Checked ' + ago(at); }, 30000);

Shell.init({ module: 'drawings', modsEl: document.getElementById('mods'), userEl: document.getElementById('user') }).then((me) => {
  if (!me) return;
  $('#main').hidden = false;
  load(false);
});
