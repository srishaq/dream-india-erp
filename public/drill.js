// Accounts page click-through: every box and table line opens the sheet rows behind its figure.
// The page registers a builder per clickable element (Drill.reg); the receipts and payments rows
// are fetched once, on the first click, from /api/master?detail=1.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const full = (v) => (v < 0 ? '−' : '') + '₹' + Math.round(Math.abs(v)).toLocaleString('en-IN');
  const rs = (v) => { const a = Math.abs(v || 0); if (!a) return '—'; const s = v < 0 ? '−' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L'; return full(v); };

  // Column sets: [label, value(row), kind] where kind 'amt' = money, 'n' = number, else text.
  const COLS = {
    R: [['Date', (r) => r.d], ['Receipt ID', (r) => r.id], ['Unit', (r) => r.unit], ['Payer', (r) => r.payer], ['Head', (r) => r.ph || r.cfh], ['Bank account', (r) => r.bank], ['Description', (r) => r.desc + (r.rm ? ' · ' + r.rm : ''), 'desc'], ['Cheque', (r) => r.chq], ['Amount', (r) => r.amt, 'amt']],
    P: [['Date', (r) => r.d], ['Payment ID', (r) => r.id], ['Cash flow head', (r) => r.cfh], ['Unit', (r) => r.unit], ['Bank account', (r) => r.bank], ['Description', (r) => r.desc + (r.rm ? ' · ' + r.rm : ''), 'desc'], ['Amount', (r) => r.amt, 'amt']],
    U: [['Unit', (u) => u.u], ['Buyer', (u) => u.n], ['Status', (u) => u.s], ['Registration', (u) => u.reg], ['Booking date', (u) => u.bd], ['Registration date', (u) => u.rd], ['Agreement value', (u) => u.av, 'amt'], ['Received in bank', (u) => u.bk, 'amt'], ['Received as TDS', (u) => u.tx, 'amt'], ['Total received', (u) => u.tot, 'amt'], ['CRM ledger total', (u) => u.crm, 'amt'], ['Difference (Total − CRM)', (u) => u.df, 'amt'], ['AV received', (u) => u.rav, 'amt'], ['AV balance', (u) => u.bav, 'amt'], ['GST received', (u) => u.rg, 'amt'], ['GST balance', (u) => u.bg, 'amt'], ['SDR received', (u) => u.rsd, 'amt'], ['SDR balance', (u) => u.bs, 'amt'], ['CP', (u) => u.cp]],
    RI: [['#', (r) => r.n], ['Date', (r) => r.d], ['Account', (r) => r.acct], ['Side', (r) => r.side], ['Description', (r) => r.desc, 'desc'], ['Age (days)', (r) => r.age, 'n'], ['Category', (r) => r.cat], ['Escalation', (r) => r.esc], ['Suggested action', (r) => r.act, 'desc'], ['Amount', (r) => r.amt, 'amt']],
    BANK: [['Bank', (b) => b.b], ['A/c No.', (b) => b.no], ['Opening', (b) => b.op, 'amt'], ['Receipts', (b) => b.rc, 'amt'], ['Payments', (b) => b.py, 'amt'], ['Closing', (b) => b.cl, 'amt']],
    DAILY: [['Date', (r) => r.d], ['Bank', (r) => r.b], ['Receipts', (r) => r.rc, 'amt'], ['Payments', (r) => r.py, 'amt'], ['Remarks', (r) => r.rm, 'desc'], ['Entered by', (r) => r.by]],
  };

  let builders = [], DET = null, loading = null, view = null, q = '';
  const reg = (fn) => { builders.push(fn); return builders.length - 1; };
  const reset = () => { builders = []; };
  const attrs = (id) => `data-drill="${id}" tabindex="0" role="button" title="Open the entries behind this figure"`;

  async function detail() {
    if (DET) return DET;
    if (!loading) loading = fetch(window.Drill.src || '/api/master?detail=1', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); DET = j; return j; })
      .finally(() => { loading = null; });
    return loading;
  }
  const dropDetail = () => { DET = null; };

  // ---- modal ----
  const css = `
  .dd-scrim{position:fixed;inset:0;background:rgba(20,12,89,.45);z-index:70;display:flex;justify-content:center;align-items:flex-start;padding:4vh 16px}
  .dd{background:var(--card,#fff);color:var(--text,#140C59);border-radius:12px;width:min(1200px,100%);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 18px 60px rgba(20,12,89,.35)}
  .dd-hd{padding:16px 18px 10px;display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid var(--line,#D9DDD6)}
  .dd-hd h3{margin:0;font-size:19px} .dd-hd p{margin:3px 0 0;color:var(--muted,#5E6A72);font-size:13.5px}
  .dd-x{margin-left:auto;font:inherit;font-size:22px;line-height:1;background:none;border:0;color:var(--muted,#5E6A72);cursor:pointer;padding:2px 6px}
  .dd-tools{display:flex;flex-wrap:wrap;gap:8px;padding:10px 18px;border-bottom:1px solid var(--line,#D9DDD6)}
  .dd-tools input{flex:1;min-width:200px}
  .dd-tools button{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line,#D9DDD6);background:var(--card,#fff);color:var(--text,#140C59);border-radius:8px;padding:6px 12px;cursor:pointer}
  .dd-body{overflow:auto;padding:12px 18px 18px;display:flex;flex-direction:column;gap:16px}
  .dd-body h4{margin:0 0 6px;font-size:15px} .dd-body h4 small{font-weight:400;color:var(--muted,#5E6A72);margin-left:6px}
  .dd-body td.desc{white-space:normal;min-width:260px;max-width:420px;color:var(--muted,#5E6A72);font-size:13px}
  .dd-body tfoot td{font-weight:700;background:var(--head,#F7F8F5)}
  .dd-note{font-size:13px;color:var(--muted,#5E6A72);margin:0}
  .dd-note-in{font:inherit;font-size:13px;min-width:180px;padding:5px 8px;border:1px solid var(--line,#D9DDD6);border-radius:6px;background:var(--card,#fff);color:inherit}
  .dd-body input[type=checkbox]{width:18px;height:18px}
  [data-drill]{cursor:pointer}
  .card[data-drill]:hover,.bcard[data-drill]:hover{box-shadow:0 0 0 2px var(--accent,#64C2E6) inset}
  .bcard .row[data-drill]:hover span{text-decoration:underline}
  tr[data-drill]:hover td{background:var(--head,#F7F8F5)}
  rect[data-drill]:hover{opacity:.8}`;
  function mount() {
    if (document.getElementById('dd-style')) return;
    const s = document.createElement('style'); s.id = 'dd-style'; s.textContent = css; document.head.appendChild(s);
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-nodrill]')) return; const el = e.target.closest && e.target.closest('[data-drill]'); if (el) { e.stopPropagation(); open(+el.dataset.drill, el); } }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      const el = e.target.closest && !e.target.closest('[data-nodrill]') && e.target.closest('[data-drill]');
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(+el.dataset.drill, el); }
    });
  }

  let scrim = null, opener = null;
  function close() { if (scrim) { scrim.remove(); scrim = null; document.body.style.overflow = ''; if (opener) opener.focus(); } }
  function shell(title) {
    close();
    scrim = document.createElement('div'); scrim.className = 'dd-scrim';
    scrim.innerHTML = `<div class="dd" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dd-hd"><div><h3>${esc(title)}</h3><p id="ddSub"></p></div><button class="dd-x" aria-label="Close">×</button></div>
      <div class="dd-tools"><input type="search" id="ddQ" placeholder="Search these entries" aria-label="Search these entries"><button id="ddCsv" type="button">Download CSV</button></div><div class="dd-body" id="ddBody"><p class="dd-note">Loading the entries…</p></div></div>`;
    scrim.onclick = (e) => { if (e.target === scrim) close(); };
    scrim.querySelector('.dd-x').onclick = close;
    document.body.appendChild(scrim); document.body.style.overflow = 'hidden';
    scrim.querySelector('.dd-x').focus();
  }

  async function open(id, el) {
    const b = builders[id]; if (!b) return;
    opener = el; q = '';
    shell(b.title);
    try {
      const v = b.fn(b.needs ? await detail() : null);
      if (!scrim) return;
      view = { title: b.title, ...v, shown: {} };
      scrim.querySelector('#ddQ').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
      scrim.querySelector('#ddCsv').onclick = csv;
      // editable cells (team notes on the audit page): the page decides what to do with them
      scrim.querySelector('#ddBody').addEventListener('change', (e) => { const t = e.target.closest('[data-nk]'); if (t && window.Drill.onNote) window.Drill.onNote(t.dataset.nk, t.dataset.nf, t.type === 'checkbox' ? t.checked : t.value, t); });
      draw();
    } catch (e) {
      if (scrim) scrim.querySelector('#ddBody').innerHTML = `<p class="dd-note">Could not load the entries: ${esc(e.message || e)}</p>`;
    }
  }

  const flat = (v) => (Array.isArray(v) ? (v[1] === true ? 'Yes' : v[1] === false ? '' : v[1]) : v);
  const match = (cols, r) => !q || cols.map(([, f]) => flat(f(r))).join(' ').toLowerCase().includes(q);
  const cell = (k, v) => k === 'done' ? `<td><input type="checkbox" data-nk="${esc(v[0])}" data-nf="done" aria-label="Done" ${v[1] ? 'checked' : ''}></td>`
    : k === 'note' ? `<td><input type="text" class="dd-note-in" data-nk="${esc(v[0])}" data-nf="comment" value="${esc(v[1])}" placeholder="Add a comment" aria-label="Team comment"></td>`
    : k === 'link' ? `<td>${/^https?:\/\//i.test(String(v || '')) ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open</a>` : esc(v)}</td>`
    : k === 'amt' ? `<td class="num">${v ? full(v) : '—'}</td>` : k === 'n' ? `<td class="num">${esc(v)}</td>` : k === 'desc' ? `<td class="desc">${esc(v)}</td>` : `<td>${esc(v)}</td>`;
  function draw() {
    if (!scrim || !view) return;
    const secs = view.sections.map((s) => ({ ...s, cols: COLS[s.cols] || s.cols }));
    let total = 0, count = 0;
    const html = secs.map((s, i) => {
      const rows = s.rows.filter((r) => match(s.cols, r));
      const amtCol = s.cols.findIndex((c) => c[2] === 'amt' && c[0] === (s.sumCol || 'Amount'));
      const sum = amtCol >= 0 ? rows.reduce((t, r) => t + (+s.cols[amtCol][1](r) || 0), 0) : null;
      if (s.count !== false) { count += rows.length; if (sum != null) total += (s.sign || 1) * sum; }
      const lim = view.shown[i] ? rows.length : 200;
      const foot = sum != null && rows.length > 1 ? `<tfoot><tr>${s.cols.map((c, j) => j === 0 ? `<td>Total (${rows.length.toLocaleString('en-IN')})</td>` : j === amtCol ? `<td class="num">${full(sum)}</td>` : '<td></td>').join('')}</tr></tfoot>` : '';
      return `<div>${s.h ? `<h4>${esc(s.h)} <small>${rows.length.toLocaleString('en-IN')} ${rows.length === 1 ? 'row' : 'rows'}${sum != null ? ' · ' + full(sum) : ''}</small></h4>` : ''}
        ${s.note ? `<p class="dd-note">${esc(s.note)}</p>` : ''}
        ${rows.length ? `<div class="tbl"><table><thead><tr>${s.cols.map((c) => `<th${c[2] === 'amt' || c[2] === 'n' ? ' class="num"' : ''}>${c[0]}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, lim).map((r) => `<tr>${s.cols.map((c) => cell(c[2], c[1](r))).join('')}</tr>`).join('')}</tbody>${foot}</table></div>
        ${rows.length > lim ? `<button class="more" data-more="${i}" type="button">Show all ${rows.length.toLocaleString('en-IN')} rows</button>` : ''}` : '<p class="dd-note">No entries.</p>'}</div>`;
    }).join('');
    scrim.querySelector('#ddBody').innerHTML = (view.note ? `<p class="dd-note">${esc(view.note)}</p>` : '') + html;
    scrim.querySelector('#ddSub').textContent = view.sub || `${count.toLocaleString('en-IN')} entries · ${full(total)}`;
    scrim.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => { view.shown[b.dataset.more] = true; draw(); });
  }

  function csv() {
    if (!view) return;
    const line = (a) => a.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    const out = [];
    view.sections.forEach((s) => {
      const cols = COLS[s.cols] || s.cols;
      if (s.h) out.push(line([s.h]));
      out.push(line(cols.map((c) => c[0])));
      s.rows.filter((r) => match(cols, r)).forEach((r) => out.push(line(cols.map((c) => flat(c[1](r))))));
      out.push('');
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\n')], { type: 'text/csv' }));
    a.download = view.title.replace(/[^\w ·-]+/g, '').replace(/\s+/g, ' ').trim() + '.csv';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // fn(DET) returns { sub?, note?, sections: [{ h, cols, rows, note?, sign?, count? }] }.
  // needs = true when the view uses the receipts / payments rows (fetched on first use).
  window.Drill = {
    mount, reset, dropDetail, rs, full, redraw: () => draw(), onNote: null,
    reg: (title, fn, needs = true) => attrs(reg({ title, fn, needs })),
  };
})();
