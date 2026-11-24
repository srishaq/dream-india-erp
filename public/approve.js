// One-tap approval of a purchase request, from the link in Management's email or WhatsApp. No login: the signed link
// (valid 3 days) names the approver, and the server checks that login can still approve.
(function () {
  const app = document.getElementById('app');
  const t = new URLSearchParams(location.search).get('t') || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MN[+m - 1]} ${y}`; };
  const q = (n) => (Math.round(+n * 1000) / 1000).toLocaleString('en-IN');
  const inr = (n) => '₹' + Math.round(+n).toLocaleString('en-IN');
  const fail = (msg) => { app.innerHTML = `<div class="done no"><div class="big">!</div><h1>${esc(msg)}</h1><p class="muted"><a href="/purchase">Open the Purchase page</a></p></div>`; };

  async function load() {
    if (!t) return fail('This link is incomplete.');
    let r, j;
    try { r = await fetch('/api/me?purchase=1&t=' + encodeURIComponent(t), { credentials: 'same-origin' }); j = await r.json(); } catch (e) { return fail('No connection. Try again when the signal is back.'); }
    if (!r.ok) return fail(j.error || 'This link does not work.');
    show(j);
  }

  // a bill Accounts entered, to approve for payment (24 Nov 2026)
  function showBill(j) {
    const o = j.order, B = o.bill, R = o.receipt || {}, O = o.order || {};
    const head = `<div><div class="eyebrow">${esc(o.no)} · bill for ${esc(j.approver)}</div><h1>${esc(B.vendor)}: ${inr(B.amount)}</h1></div>`;
    const facts = `<dl><dt>For</dt><dd>${esc(o.material)} ${esc(o.items.map((i) => i.spec).join(', '))}, ${esc(o.building)} · ${esc(o.floor)}</dd>
      <dt>Bill</dt><dd>${esc(B.billNo)} of ${esc(day(B.billDate))}${B.gst != null ? `, GST ${inr(B.gst)}` : ''}</dd>${B.poNo ? `<dt>PO</dt><dd>${esc(B.poNo)}</dd>` : ''}
      <dt>Ordered</dt><dd>${q(O.qty)} ${esc(o.unit)}${O.rate ? ` at ${inr(O.rate)}` : ''}</dd>${R.qty != null ? `<dt>Delivered</dt><dd>${q(R.qty)} ${esc(o.unit)}, challan ${esc(R.challan)}, ${esc(day(R.date))}</dd>` : ''}
      <dt>Entered by</dt><dd>${esc(B.by)} (Accounts)</dd>${B.note ? `<dt>Note</dt><dd>${esc(B.note)}</dd>` : ''}</dl>`;
    const chk = B.over ? ['over', `Above what was delivered: ${inr(B.expect)} at the order rate.`] : ['ok', `Matches the order${B.expect ? ` (${inr(B.expect)})` : ''}.`];
    if (o.status !== 'bill_approval') {
      const a = o.billApproval;
      app.innerHTML = `${head}${facts}<div class="done ${a && a.ok ? 'ok' : 'no'}"><div class="big">${a && a.ok ? '✓' : a ? '✕' : '·'}</div><h1>${a ? `${a.ok ? 'Approved for payment' : 'Sent back'} by ${esc(a.by)}` : 'Not waiting for approval'}</h1></div>`;
      return;
    }
    app.innerHTML = `${head}${facts}<div class="budget ${chk[0]}">${esc(chk[1])}</div>
      <label id="whyL" hidden>Why it goes back to Accounts<textarea id="why" maxlength="300" placeholder="e.g. Rate is above the PO, ask for a revised bill"></textarea></label>
      <div class="err" id="err" role="alert"></div>
      <div class="acts"><button class="no" id="no">Send back</button><button class="yes" id="yes">Approve for payment</button></div>`;
    wire(head, true);
  }
  function wire(head, bill) {
    const err = document.getElementById('err');
    const go = async (ok) => {
      const why = document.getElementById('why');
      if (!ok && document.getElementById('whyL').hidden) { document.getElementById('whyL').hidden = false; why.focus(); document.getElementById('no').textContent = bill ? 'Send back now' : 'Reject now'; return; }
      if (!ok && !why.value.trim()) { err.textContent = `Write the reason, then tap ${bill ? 'Send back' : 'Reject'} now.`; why.focus(); return; }
      err.textContent = '';
      document.querySelectorAll('button').forEach((x) => (x.disabled = true));
      let r, res;
      try { r = await fetch('/api/me?purchase=1', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'link', t, ok, note: ok ? '' : why.value.trim() }) }); res = await r.json(); }
      catch (e) { document.querySelectorAll('button').forEach((x) => (x.disabled = false)); err.textContent = 'No connection. Tap again when the signal is back.'; return; }
      if (!r.ok) { document.querySelectorAll('button').forEach((x) => (x.disabled = false)); err.textContent = res.error || 'Could not save. Try again.'; return; }
      app.innerHTML = `${head}<div class="done ${ok ? 'ok' : 'no'}"><div class="big">${ok ? '✓' : '✕'}</div><h1>${esc(res.no)} ${bill ? (ok ? 'bill approved' : 'bill sent back') : ok ? 'approved' : 'rejected'}</h1><p class="muted">${bill ? (ok ? 'Accounts can now pay it.' : 'Accounts will see your reason.') : ok ? 'Purchase can now order it.' : 'The site will see your reason.'}</p></div>`;
    };
    document.getElementById('yes').onclick = () => go(true);
    document.getElementById('no').onclick = () => go(false);
  }

  function show(j) {
    if (j.order && j.order.bill && (j.order.status === 'bill_approval' || j.order.billApproval)) return showBill(j);
    const o = j.order, b = o.budget || {};
    const bud = b.noBudget || b.budget == null ? ['none', 'No BOQ budget line for this item.'] : b.over ? ['over', `Over budget: ${q(b.balance)} ${o.unit} was left of ${q(b.budget)} on this line. This takes it to ${q(b.after)} ${o.unit}.`] : ['ok', `Within budget: ${q(b.after)} ${o.unit} left on this line after this.`];
    const head = `<div><div class="eyebrow">${esc(o.no)} · for ${esc(j.approver)}</div><h1>${esc(o.material)}: ${q(o.qty)} ${esc(o.unit)}</h1></div>`;
    const items = o.items.length > 1 ? `<table class="items">${o.items.map((i) => `<tr><td>${esc(i.spec)}</td><td>${q(i.qty)} ${esc(o.unit)}</td></tr>`).join('')}</table>` : '';
    const facts = `<dl>${o.items.length === 1 ? `<dt>What</dt><dd>${esc(o.spec)}</dd>` : ''}<dt>For</dt><dd>${esc(o.building)} · ${esc(o.floor)}${o.wing && o.wing !== '—' ? ' · ' + esc(o.wing) : ''}${o.element ? ' (' + esc(o.element) + ')' : ''}</dd>
      <dt>Asked by</dt><dd>${esc(o.requestedBy)}, ${esc(day(o.requestedAt))}</dd>${o.neededBy ? `<dt>Needed by</dt><dd>${esc(day(o.neededBy))}</dd>` : ''}${o.approxValue ? `<dt>About</dt><dd>${inr(o.approxValue)} at the budget rate</dd>` : ''}${o.note ? `<dt>Note</dt><dd>${esc(o.note)}</dd>` : ''}</dl>`;
    if (o.status !== 'pending_approval') {
      const a = o.approval;
      app.innerHTML = `${head}${items}${facts}<div class="done ${a && a.ok ? 'ok' : 'no'}"><div class="big">${a && a.ok ? '✓' : a ? '✕' : '·'}</div><h1>${a ? `${a.ok ? 'Approved' : 'Rejected'} by ${esc(a.by)}` : 'Not waiting for approval'}</h1>${a && a.note ? `<p class="muted">${esc(a.note)}</p>` : ''}<p class="muted">${a ? esc(day(a.at)) : 'It is ' + esc(String(o.status).replace(/_/g, ' ')) + '.'}</p></div>`;
      return;
    }
    app.innerHTML = `${head}${items}${facts}<div class="budget ${bud[0]}">${esc(bud[1])}</div>
      <label id="whyL" hidden>Reason for rejecting (the site sees this)<textarea id="why" maxlength="300" placeholder="e.g. Use the steel already at site first"></textarea></label>
      <div class="err" id="err" role="alert"></div>
      <div class="acts"><button class="no" id="no">Reject</button><button class="yes" id="yes">Approve</button></div>`;
    const err = document.getElementById('err');
    const go = async (ok) => {
      const why = document.getElementById('why');
      if (!ok && document.getElementById('whyL').hidden) { document.getElementById('whyL').hidden = false; why.focus(); document.getElementById('no').textContent = 'Reject now'; return; }
      if (!ok && !why.value.trim()) { err.textContent = 'Write the reason, then tap Reject now.'; why.focus(); return; }
      err.textContent = '';
      document.querySelectorAll('button').forEach((x) => (x.disabled = true));
      let r, res;
      try { r = await fetch('/api/me?purchase=1', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'link', t, ok, note: ok ? '' : why.value.trim() }) }); res = await r.json(); }
      catch (e) { document.querySelectorAll('button').forEach((x) => (x.disabled = false)); err.textContent = 'No connection. Tap again when the signal is back.'; return; }
      if (!r.ok) { document.querySelectorAll('button').forEach((x) => (x.disabled = false)); err.textContent = res.error || 'Could not save. Try again.'; return; }
      app.innerHTML = `${head}<div class="done ${ok ? 'ok' : 'no'}"><div class="big">${ok ? '✓' : '✕'}</div><h1>${esc(res.no)} ${ok ? 'approved' : 'rejected'}</h1><p class="muted">${ok ? 'Purchase can now order it.' : 'The site will see your reason.'}</p></div>`;
    };
    document.getElementById('yes').onclick = () => go(true);
    document.getElementById('no').onclick = () => go(false);
  }
  load();
})();
