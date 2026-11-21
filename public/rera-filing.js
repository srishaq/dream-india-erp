// CA / Tax → RERA: the MahaRERA filings panel (lib/rera.js through /api/ca?rera=). Each quarter: the Form 3 working,
// the Excel file for the CA, and Word drafts of Forms 1 (architect), 2 (engineer) and 3 (CA) to print on their letterhead.
window.ReraFiling = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const full = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
  const rs = (v) => { const a = Math.abs(Number(v) || 0), s = v < 0 ? '−' : ''; if (a < 0.5) return '—'; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L'; return s + full(a); };
  const nf = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtD = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MN[+m - 1]} ${y}`; };
  const card = (cls, l, v, n) => `<div class="card ${cls}"><span class="l">${l}</span><span class="v">${v}</span>${n ? `<span class="n">${n}</span>` : ''}</div>`;
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j;
  };
  const toast = (m, bad) => { const t = document.createElement('div'); t.textContent = m; t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:${bad ? '#B42318' : '#140C59'};color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-size:14px;max-width:90vw`; document.body.appendChild(t); setTimeout(() => t.remove(), 4500); };
  let EL = null, Q = '', D = null;

  async function load() {
    EL.innerHTML = '<div class="panel"><p class="sub">Working out the MahaRERA figures…</p></div>';
    try { D = await api('/api/ca?rera=' + encodeURIComponent(Q)); Q = D.qe; draw(); }
    catch (e) { EL.innerHTML = `<div class="panel"><p class="sub" style="color:#B42318">${esc(e.message)}</p></div>`; }
  }

  function draw() {
    const F = D.F3, S = D.settings, U = D.units, des = D.bank.find((a) => a.role === 'designated');
    const file = (f) => `/api/ca?rera=${encodeURIComponent(Q)}&file=${f}`;
    const open = D.heads.filter((h) => h.state !== 'confirmed');
    EL.innerHTML = `<div class="panel">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:flex-end">
        <div><h2>MahaRERA filings <small>${esc(S.regNo)} · ${esc(S.promoter)}</small></h2>
          <p class="sub">Each quarter: the progress report, the Form 3 working, figures for Forms 1 and 2, and Form 5 for the year. The architect, the engineer and the CA print the Word drafts on their own letterhead, check them and sign.</p></div>
        <label class="per2">Quarter <select id="rfQ" aria-label="Quarter">${D.quarters.map((q) => `<option value="${q.end}" ${q.end === Q ? 'selected' : ''}>${esc(q.label)} (to ${fmtD(q.end)})</option>`).join('')}</select></label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
        <a class="btn" style="color:#fff" href="${file('xlsx')}" download>Excel working</a>
        <a class="btn ghost" href="${file('form3')}" download>Form 3 · CA (Word)</a>
        <a class="btn ghost" href="${file('form1')}" download>Form 1 · Architect (Word)</a>
        <a class="btn ghost" href="${file('form2')}" download>Form 2 · Engineer (Word)</a>
        ${D.can.edit ? `<button type="button" class="ghost" id="rfSend">Email the pack to the CA</button><button type="button" class="ghost" id="rfSet">RERA settings</button>` : ''}
      </div>
      <div class="cards">
        ${card('', 'Estimated cost (Table A)', rs(F.estTotal), 'Land ' + rs(F.estLand) + ' · development ' + rs(F.estDev))}
        ${card('in', 'Cost incurred (Table B)', rs(F.incTotal), F.pct + '% of the estimated cost')}
        ${card('', 'Net withdrawable', rs(F.net), 'Withdrawable ' + rs(F.withdrawable) + ' less withdrawn ' + rs(F.withdrawn))}
        ${card('', 'Units', nf(U.sold + U.booked) + ' of ' + nf(U.sold + U.booked + U.unsold), `${nf(U.sold)} sold (registered), ${nf(U.booked)} booked, ${nf(U.unsold)} unsold${U.maxFloor ? ` · up to floor ${U.maxFloor}` : ''}${U.above && U.above.units ? `; ${nf(U.above.units)} more above it` : ''}`)}
        ${card(des && des.closing > 0 ? 'in' : 'out tint', 'Designated RERA account', rs(F.tableE.closing), des ? esc(des.account) : 'not set')}
        ${card(D.outside ? 'out tint' : 'in', 'Buyer money outside RERA accounts', D.outside ? rs(D.outsideAmt) : 'None', D.outside ? `${nf(D.outside)} receipt${D.outside === 1 ? '' : 's'} in the quarter` : 'in the quarter')}
      </div>
      ${D.checks.length ? `<div class="check" style="margin:12px 0"><b>Points to check before filing</b><ul style="margin:6px 0 0 18px;padding:0">${D.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      ${S.ccNote ? `<p class="sub"><b>CA's note:</b> ${esc(S.ccNote)}</p>` : ''}
      <div class="tbl"><table><tr><th>Form 3 line</th><th class="num">Estimated</th><th class="num">Incurred to ${fmtD(Q)}</th><th class="num">of which paid after ${fmtD(S.baseline.date)}</th></tr>
        ${D.lines.filter((l) => D.est[l.key] || D.incurred[l.key]).map((l) => `<tr><td>${esc(D.short[l.key])}</td><td class="num">${rs(D.est[l.key])}</td><td class="num">${rs(D.incurred[l.key])}</td><td class="num">${rs(D.since[l.key])}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="num"><b>${rs(F.estTotal)}</b></td><td class="num"><b>${rs(F.incTotal)}</b></td><td class="num"><b>${rs(Object.values(D.since).reduce((a, x) => a + x, 0))}</b></td></tr></table></div>
      <p class="sub">Cost incurred is the last certified Form 3 (${esc(S.baseline.label)}) plus the Payments Out after it, each cash flow head counted on its Form 3 line. Bills raised but not yet paid are not included.</p>
      <div class="two" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:8px">
        <div><h2 style="font-size:15px">Construction (Form 1)</h2><div class="tbl"><table><tr><th>Building</th><th class="num">Slabs cast</th><th>Plinth</th></tr>
          ${D.progress.towers.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.cast} of ${t.slabs}</td><td>${t.plinthCast ? 'Cast' : 'Not yet'}</td></tr>`).join('') || '<tr><td colspan="3">No slab schedule</td></tr>'}</table></div></div>
        <div><h2 style="font-size:15px">RERA bank accounts, this quarter</h2><div class="tbl"><table><tr><th>Account</th><th class="num">In</th><th class="num">Out</th><th class="num">Closing</th></tr>
          ${D.bank.map((a) => `<tr><td>${esc(a.account)}${a.role === 'designated' ? ' <span class="cnt">designated</span>' : ''}</td><td class="num">${rs(a.deposits)}</td><td class="num">${rs(a.withdrawals)}</td><td class="num">${rs(a.closing)}</td></tr>`).join('')}</table></div></div>
      </div>
      ${D.heads.length ? `<details ${open.some((h) => h.state === 'open') ? 'open' : ''} style="margin-top:12px"><summary><b>Cash flow heads and their Form 3 line</b> <span class="sub">${nf(D.heads.length)} heads paid after ${fmtD(S.baseline.date)}${open.length ? ` · ${nf(open.length)} to confirm` : ' · all confirmed'}</span></summary>
        <div class="tbl" style="max-height:420px;overflow:auto"><table id="rfHeads"><tr><th>Cash flow head</th><th class="num">Paid</th><th>Form 3 line</th><th>Status</th></tr>
          ${[...D.heads].sort((a, b) => (a.state === 'confirmed') - (b.state === 'confirmed') || b.amount - a.amount).map((h) => `<tr><td>${esc(h.head)}</td><td class="num">${rs(h.amount)}</td>
            <td>${D.can.edit ? `<select data-head="${esc(h.head)}" data-was="${esc(h.state === 'confirmed' ? h.line : '')}"><option value="">(not on a line: left out)</option>${[...D.lines.map((l) => l.key), 'exclude'].map((k) => `<option value="${k}" ${h.line === k ? 'selected' : ''}>${esc(D.short[k])}</option>`).join('')}</select>` : esc(h.line ? D.short[h.line] : 'Not on a line')}</td>
            <td class="${h.state === 'confirmed' ? 'g' : 'r'}">${h.state === 'confirmed' ? 'Confirmed' : h.state === 'suggested' ? 'Suggested' : 'Choose'}</td></tr>`).join('')}</table></div>
        ${D.can.edit ? '<p><button type="button" id="rfHeadSave">Confirm these lines</button> <span class="sub">Saves every line shown, including the suggested ones.</span></p>' : ''}</details>` : ''}
      <p class="sub" style="margin-top:10px">${D.sent.length ? 'Last emailed: ' + D.sent.map((s) => `quarter to ${fmtD(s.q)} on ${new Date(s.at).toLocaleDateString('en-IN')} to ${esc((s.to || []).join(', '))}${s.test ? ' (test)' : ''}`).join(' · ') : 'Not emailed yet.'} ${S.autoSend === false ? 'Automatic email is off.' : 'Goes to the CA automatically from the 3rd of the month after each quarter.'}${D.live ? '' : ' Test version: emails go only to the test address.'}</p>
    </div>`;
    EL.querySelector('#rfQ').onchange = (e) => { Q = e.target.value; load(); };
    const send = EL.querySelector('#rfSend');
    if (send) send.onclick = async () => { send.disabled = true; try { const r = await api('/api/ca', { action: 'rera-send', quarter: Q }); toast('Sent to ' + r.to.join(', ') + (r.test ? ' (test address)' : '')); load(); } catch (e) { toast(e.message, true); send.disabled = false; } };
    const hs = EL.querySelector('#rfHeadSave');
    if (hs) hs.onclick = async () => { const heads = {}; EL.querySelectorAll('#rfHeads select').forEach((s) => { if (s.value || s.dataset.was) heads[s.dataset.head] = s.value; });
      hs.disabled = true; try { await api('/api/ca', { action: 'rera-heads', heads }); toast('Saved.'); load(); } catch (e) { toast(e.message, true); hs.disabled = false; } };
    const st = EL.querySelector('#rfSet'); if (st) st.onclick = settings;
  }

  function settings() {
    const S = D.settings, L = D.lines;
    const f = (name, label, val, wide) => `<div ${wide ? 'style="grid-column:1/-1"' : ''}><label>${esc(label)}</label><input name="${name}" value="${esc(val ?? '')}"></div>`;
    const money = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN'));
    const dl = document.createElement('dialog'); dl.style.width = 'min(860px, calc(100vw - 32px))';
    dl.innerHTML = `<form method="dialog" style="max-height:85vh;overflow:auto"><h2>RERA settings</h2>
      <p class="small muted">From the last certified forms. Change them when a form is revised.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${f('regNo', 'MahaRERA registration no.', S.regNo)}${f('promoter', 'Promoter', S.promoter)}${f('project', 'Project', S.project)}
        ${f('promoterAddress', 'Promoter address', S.promoterAddress, 1)}${f('plot', 'Plot (as on the forms)', S.plot, 1)}${f('buildingLabel', 'Building / wing name', S.buildingLabel, 1)}
        ${f('architect.name', 'Architect', S.architect.name)}${f('architect.license', 'Architect licence no.', S.architect.license)}${f('architect.email', 'Architect email', S.architect.email)}
        ${f('engineer.firm', 'Engineer firm', S.engineer.firm)}${f('engineer.name', 'Engineer', S.engineer.name)}${f('engineer.license', 'Engineer licence', S.engineer.license)}
        ${f('ca.firm', 'CA firm', S.ca.firm)}${f('ca.membership', 'CA membership no.', S.ca.membership)}${f('ca.email', 'CA email (the pack goes here)', S.ca.email)}
        ${f('designated.bank', 'Designated account (bank name in the registers)', S.designated.bank)}${f('designated.accountNo', 'Designated account no.', S.designated.accountNo)}${f('designated.bankName', 'Bank & branch', S.designated.bankName)}
        ${f('designated.ifsc', 'IFSC', S.designated.ifsc)}${f('collection', 'Collection account(s), comma separated', (S.collection || []).join(', '))}${f('otherRera', 'Other RERA accounts', (S.otherRera || []).join(', '))}
        ${f('maxFloor', 'Form 3 counts units up to floor (CC)', S.maxFloor)}${f('rrPerSqm', 'Ready reckoner rate per sq m (unsold value)', money(S.rrPerSqm))}${f('depositPct', 'Deposit % when receivables exceed balance cost', S.depositPct)}${f('letterheadCm', 'Space left for the letterhead (cm)', S.letterheadCm)}
      </div>
      <h3 style="margin:16px 0 6px">Table A: estimated cost, and the last certified cost incurred</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${f('baseline.date', 'Last certified Form 3: date (YYYY-MM-DD)', S.baseline.date)}${f('baseline.label', 'Its name', S.baseline.label)}${f('baseline.withdrawn', 'Withdrawn from designated a/c as on that date', money(S.baseline.withdrawn))}
      </div>
      <div class="tbl"><table><tr><th>Line</th><th>Estimated (Rs.)</th><th>Incurred as on the last Form 3 (Rs.)</th></tr>
        ${L.map((l) => `<tr><td>${esc(D.short[l.key])}</td><td><input name="est.${l.key}" value="${esc(money(S.estimate[l.key]))}"></td><td><input name="inc.${l.key}" value="${esc(money(S.baseline.incurred[l.key]))}"></td></tr>`).join('')}</table></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
        ${f('engineerEstimate.building', 'Form 2: estimated cost of the building', money(S.engineerEstimate.building))}${f('engineerEstimate.external', 'Form 2: internal & external works', money(S.engineerEstimate.external))}
        ${f('finance.ownEstimated', 'Table F: own funds (estimated)', money(S.finance.ownEstimated))}${f('finance.customerEstimated', 'Table F: customer receipts (estimated)', money(S.finance.customerEstimated))}
      </div>
      <h3 style="margin:16px 0 6px">Form 1: architect's percentages (as on the last Form 1)</h3>
      <div class="tbl"><table>${D.f1a.map((a, i) => i === 5 ? '' : `<tr><td>${esc(a)}</td><td style="width:90px"><input name="f1a.${i}" value="${esc(S.form1.a[i] ?? '')}"></td></tr>`).join('')}
        ${D.f1b.map((a, i) => `<tr><td>Common area: ${esc(a)}</td><td><input name="f1b.${i}" value="${esc(S.form1.b[i] ?? '')}"></td></tr>`).join('')}</table></div>
      <p class="small muted">Slabs come from the Site page; plinth turns 100% once the plinth slabs are cast.</p>
      <h3 style="margin:16px 0 6px">CA's note and Table G comments</h3>
      <label>Note shown on the progress report</label><textarea name="ccNote" rows="2">${esc(S.ccNote)}</textarea>
      <label>Table G comments (one per line)</label><textarea name="comments" rows="4">${esc((S.comments || []).join('\n'))}</textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" name="autoSend" ${S.autoSend === false ? '' : 'checked'} style="width:auto"> Email the pack to the CA automatically each quarter</label>
      <div class="actions" style="margin-top:14px;display:flex;gap:8px"><button value="save">Save</button><button value="cancel" class="ghost" formnovalidate>Cancel</button></div></form>`;
    document.body.appendChild(dl); dl.showModal();
    dl.addEventListener('close', async () => {
      if (dl.returnValue !== 'save') { dl.remove(); return; }
      const x = Object.fromEntries(new FormData(dl.querySelector('form'))); const v = { estimate: {}, baseline: { incurred: {} }, form1: { a: [...S.form1.a], b: [...S.form1.b], date: S.form1.date } };
      const set = (k, val) => { const p = k.split('.'); let o = v; while (p.length > 1) { const h = p.shift(); o[h] = o[h] || {}; o = o[h]; } o[p[0]] = val; };
      for (const [k, val] of Object.entries(x)) {
        if (k.startsWith('est.')) v.estimate[k.slice(4)] = val; else if (k.startsWith('inc.')) v.baseline.incurred[k.slice(4)] = val;
        else if (k.startsWith('f1a.')) v.form1.a[+k.slice(4)] = val; else if (k.startsWith('f1b.')) v.form1.b[+k.slice(4)] = val;
        else if (k === 'collection' || k === 'otherRera') v[k] = val.split(',').map((s) => s.trim()).filter(Boolean);
        else if (k === 'comments') v.comments = val.split('\n').map((s) => s.trim()).filter(Boolean);
        else if (k !== 'autoSend') set(k, val);
      }
      v.autoSend = x.autoSend === 'on';
      for (const k of ['architect', 'engineer', 'ca', 'designated']) v[k] = { ...S[k], ...(v[k] || {}) };
      v.finance = { ...S.finance, ...(v.finance || {}) };
      dl.remove();
      try { await api('/api/ca', { action: 'rera-settings', settings: v }); toast('Saved.'); load(); } catch (e) { toast(e.message, true); }
    });
  }

  return (el) => { EL = el; if (!EL) return; load(); };
})();
