// Printable sales documents on the Dream Signature letterhead: cost sheet, allotment letter, booking form,
// and the welcome email. Pages are plain HTML made for printing (Cmd+P → Save as PDF).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dt = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };

// Rupees in words, Indian style: 1,23,45,678 → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const three = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ');
function words(amount) {
  let n = Math.round(Math.abs(Number(amount) || 0));
  if (!n) return 'Zero';
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${cr >= 100 ? words(cr) : two(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}
const inWords = (n) => `Rupees ${words(n)} Only`;

const CSS = `
  *{box-sizing:border-box} body{margin:0;background:#eef0f3;font:14px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#15162a}
  .sheet{background:#fff;width:210mm;min-height:297mm;margin:16px auto;padding:10mm 16mm 12mm;display:flex;flex-direction:column;box-shadow:0 4px 18px rgba(0,0,0,.12)}
  .lh img{width:100%;display:block} .ft{margin-top:auto;padding-top:10mm} .ft img{width:100%;display:block}
  h1{font-size:18px;text-align:center;letter-spacing:.06em;text-transform:uppercase;margin:6mm 0 4mm}
  h2{font-size:14px;margin:6mm 0 2mm;text-transform:uppercase;letter-spacing:.04em;color:#140C59}
  table{width:100%;border-collapse:collapse;margin:2mm 0} th,td{border:1px solid #c9ccd4;padding:5px 8px;text-align:left;vertical-align:top}
  th{background:#f3f4f8;font-weight:600} td.n,th.n{text-align:right;white-space:nowrap} tr.tot td{font-weight:700;background:#f7f8fb}
  .kv td:first-child{width:38%;color:#4a4e5f} .muted{color:#5e6273;font-size:12.5px} .small{font-size:12px}
  .row{display:flex;justify-content:space-between;gap:12mm} .sign{margin-top:14mm;display:flex;justify-content:space-between;gap:10mm}
  .sign div{flex:1;border-top:1px solid #15162a;padding-top:4px;font-size:12.5px}
  .bar{max-width:210mm;margin:12px auto 0;font-size:13px;color:#4a4e5f}
  .draft{background:#FFF4DC;color:#6B4A07;border-radius:6px;padding:6px 10px;font-size:12.5px;margin:2mm 0}
  @media print{body{background:#fff}.sheet{margin:0;box-shadow:none;width:auto;min-height:auto;page-break-after:always}.bar{display:none}}
  @page{size:A4;margin:0}`;

function page(title, sheets, { draft = true } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar">Print or save as PDF with <b>Cmd+P</b> (Windows: Ctrl+P). ${draft ? 'Test version: check the wording with your legal team before sending this to a buyer.' : ''}</div>
${sheets.map((s) => `<div class="sheet"><div class="lh"><img src="/letterhead/header.jpg" alt="Dream India Realty · Dream Signature"></div>${s}<div class="ft"><img src="/letterhead/footer.jpg" alt=""></div></div>`).join('')}
</body></html>`;
}

const who = (ap) => ap.map((a) => esc(a.name)).join(' &amp; ');
const unitLine = (u) => `Flat No. <b>${esc(u.unit_no)}</b>, ${u.floor != null ? `${esc(u.floor)}${ord(u.floor)} floor, ` : ''}${esc(u.building || '')}${u.typology ? `, ${esc(u.typology)}` : ''}`;
const ord = (n) => { const v = Number(n) % 100; return v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'; };
const area = (u) => (u.carpet_sqft ? `${Number(u.carpet_sqft).toLocaleString('en-IN')} sq ft${u.carpet_sqm ? ` (${Number(u.carpet_sqm)} sq m)` : ''} RERA carpet area` : '');

function costSheetHtml(cs, ctx) {
  const u = { ...ctx.unit, ...cs.unit };
  return `<h1>Cost sheet</h1>
  <div class="row"><div>${esc(ctx.project)}${ctx.rera ? ` · MahaRERA ${esc(ctx.rera)}` : ''}<br><span class="muted">${unitLine(u)}${area(u) ? ' · ' + area(u) : ''}</span></div>
    <div style="text-align:right">Date: ${dt(ctx.date)}${ctx.buyer ? `<br>For: ${esc(ctx.buyer)}` : ''}</div></div>
  ${cs.priceList ? `<p class="muted">Price list: ${esc(cs.priceList.name)}, from ${dt(cs.priceList.effective_from)}. Prices can change without notice until the booking is confirmed.</p>` : ''}
  <table><tr><th>Particular</th><th class="n">Amount</th></tr>
    ${cs.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${l.amount < 0 ? '−' : ''}${rs(Math.abs(l.amount))}</td></tr>`).join('')}
    <tr class="tot"><td>Agreement value</td><td class="n">${rs(cs.agreementValue)}</td></tr>
    <tr><td>GST at ${cs.gstRate}% on the agreement value</td><td class="n">${rs(cs.gst)}</td></tr>
    <tr><td>Stamp duty${cs.booking ? '' : ` at ${cs.stampDutyPct}%${cs.woman ? ' (woman buyer)' : ''}`}</td><td class="n">${rs(cs.stampDuty)}</td></tr>
    <tr><td>Registration fee</td><td class="n">${rs(cs.registration)}</td></tr>
    ${cs.others.map((c) => `<tr><td>${esc(c.name)}</td><td class="n">${rs(c.amount)}</td></tr>`).join('')}
    <tr class="tot"><td>Total cost to the buyer</td><td class="n">${rs(cs.total)}</td></tr></table>
  <p class="small">${inWords(cs.agreementValue)} (agreement value).${cs.tds ? ` The buyer deducts 1% TDS (${rs(cs.tds)}) under section 194-IA from each payment and deposits it with the Income Tax department; it counts towards the agreement value.` : ''} Stamp duty is charged on the higher of the agreement value and the ready reckoner value.</p>
  ${cs.schedule.length ? `<h2>Payment schedule</h2><table><tr><th>#</th><th>Stage</th><th class="n">%</th><th class="n">Amount</th><th class="n">GST</th><th class="n">Total</th></tr>
    ${cs.schedule.map((s) => `<tr><td>${s.seq}</td><td>${esc(s.stage)}</td><td class="n">${s.pct}%</td><td class="n">${rs(s.amount)}</td><td class="n">${rs(s.gst)}</td><td class="n">${rs(s.total)}</td></tr>`).join('')}
    <tr class="tot"><td></td><td>Total</td><td class="n">${cs.schedule.reduce((a, s) => a + s.pct, 0)}%</td><td class="n">${rs(cs.schedule.reduce((a, s) => a + s.amount, 0))}</td><td class="n">${rs(cs.schedule.reduce((a, s) => a + s.gst, 0))}</td><td class="n">${rs(cs.schedule.reduce((a, s) => a + s.total, 0))}</td></tr></table>
    <p class="muted">Construction-linked stages are demanded when the stage is complete. Stamp duty and registration are paid before the agreement is registered.</p>` : ''}`;
}

function allotmentHtml(d) {
  const cs = d.cost;
  return `<p style="text-align:right">Date: ${dt(d.date)}</p>
  <p>To,<br><b>${who(d.applicants)}</b><br>${esc(d.applicants[0]?.address || '').replace(/\n/g, '<br>')}</p>
  <p><b>Subject: Allotment of ${unitLine(d.unit)} in "${esc(d.project)}"${d.rera ? `, MahaRERA registration no. ${esc(d.rera)}` : ''}</b></p>
  <p>Dear ${d.applicants.length > 1 ? 'Sir / Madam' : 'Sir / Madam'},</p>
  <p>Thank you for choosing ${esc(d.project)}. With reference to your application dated ${dt(d.booking.booking_date)}, we are pleased to allot you the following flat, on the terms set out below.</p>
  <table class="kv"><tr><td>Flat</td><td>${unitLine(d.unit)}</td></tr>
    <tr><td>RERA carpet area</td><td>${area(d.unit) || '—'}</td></tr>
    <tr><td>Car parking</td><td>${d.booking.parking ? `${d.booking.parking} space${d.booking.parking > 1 ? 's' : ''}` : 'None'}</td></tr>
    <tr><td>Agreement value</td><td><b>${rs(cs.agreementValue)}</b><br><span class="small">${inWords(cs.agreementValue)}</span></td></tr>
    <tr><td>GST</td><td>${rs(cs.gst)} at ${cs.gstRate}% (payable with each instalment)</td></tr>
    <tr><td>Stamp duty and registration</td><td>As applicable at the time of registration, payable by you</td></tr>
    <tr><td>Received so far</td><td>${rs(d.received)} (subject to realisation)</td></tr></table>
  <h2>Payment schedule</h2>
  <table><tr><th>#</th><th>Stage</th><th class="n">%</th><th class="n">Amount</th><th class="n">GST</th></tr>
    ${cs.schedule.map((s) => `<tr><td>${s.seq}</td><td>${esc(s.stage)}</td><td class="n">${s.pct}%</td><td class="n">${rs(s.amount)}</td><td class="n">${rs(s.gst)}</td></tr>`).join('')}</table>
  <h2>Terms</h2>
  <ol class="small" style="padding-left:18px;margin:0">
    <li>This allotment is subject to payment of each instalment on time as per the schedule above, against our demand letters.</li>
    <li>The agreement for sale shall be executed and registered as required under the Real Estate (Regulation and Development) Act, 2016. Stamp duty, registration fee and related charges are payable by you.</li>
    <li>The terms of the registered agreement for sale will prevail over this letter.</li>
    <li>Any cancellation will be governed by the terms of the agreement for sale and applicable law.</li>
    <li>Please quote your flat number on every payment and in all correspondence with us.</li>
  </ol>
  <div class="sign"><div>For ${esc(d.signedFor)}<br>Authorised Signatory</div><div>Accepted by the allottee(s)<br>${who(d.applicants)}</div></div>`;
}

function bookingFormHtml(d) {
  const ap = (a, i) => `<h2>Applicant ${i + 1}</h2><table class="kv">
    <tr><td>Full name</td><td>${esc(a.name)}</td></tr><tr><td>PAN</td><td>${esc(a.pan || '')}</td></tr><tr><td>Aadhaar</td><td>${esc(a.aadhaar || '')}</td></tr>
    <tr><td>Mobile</td><td>${esc(a.phone || '')}</td></tr><tr><td>Email</td><td>${esc(a.email || '')}</td></tr><tr><td>Address</td><td>${esc(a.address || '').replace(/\n/g, '<br>')}</td></tr></table>`;
  const b = d.booking;
  return `<h1>Booking application form</h1>
  <div class="row"><div>${esc(d.project)}${d.rera ? ` · MahaRERA ${esc(d.rera)}` : ''}</div><div>Booking date: ${dt(b.booking_date)}</div></div>
  <h2>Flat</h2><table class="kv"><tr><td>Flat</td><td>${unitLine(d.unit)}</td></tr><tr><td>RERA carpet area</td><td>${area(d.unit) || '—'}</td></tr>
    <tr><td>Car parking</td><td>${b.parking || 0}</td></tr><tr><td>Agreement value</td><td>${rs(b.agreement_value)} · ${inWords(b.agreement_value)}</td></tr>
    <tr><td>GST</td><td>${Number(b.gst_rate)}%</td></tr><tr><td>Funding</td><td>${b.funding === 'loan' ? `Home loan${b.loan_bank ? ' · ' + esc(b.loan_bank) : ''}` : b.funding === 'self' ? 'Self funding' : ''}</td></tr></table>
  ${d.applicants.map(ap).join('')}
  <h2>Booking amount</h2><table class="kv"><tr><td>Received so far</td><td>${rs(d.received)} (subject to realisation)</td></tr>
    ${d.receipts.slice(0, 6).map((r) => `<tr><td>${dt(r.received_on)}</td><td>${rs(r.amount)} · ${esc([r.bank, r.instrument_no].filter(Boolean).join(' · ') || r.mode || '')}</td></tr>`).join('')}</table>
  <h2>Source</h2><table class="kv"><tr><td>Source</td><td>${esc(b.source || '')}</td></tr><tr><td>Channel partner</td><td>${esc(b.cp_name || '')}</td></tr><tr><td>Relationship manager</td><td>${esc(b.rm_name || '')}</td></tr></table>
  <h2>Declaration</h2>
  <p class="small">I/We have read and understood the cost sheet and payment schedule, and confirm that the details above are correct. I/We agree to pay the instalments on time against the demand letters, and to execute and register the agreement for sale when called upon.</p>
  <div class="sign">${d.applicants.map((a) => `<div>${esc(a.name)}</div>`).join('')}<div>For ${esc(d.signedFor)}</div></div>`;
}

function welcomeEmail(d) {
  const first = d.applicants.map((a) => a.name).join(' & ');
  const cs = d.cost;
  const next = cs.schedule.find((s, i) => i >= d.demandedCount) || null;
  return {
    subject: `Welcome to ${d.project} – your flat ${d.unit.unit_no}`,
    text: `Dear ${first},

Welcome to the ${d.project} family, and thank you for choosing us.

Your booking details:
  Flat: ${d.unit.unit_no}${d.unit.floor != null ? `, ${d.unit.floor}${ord(d.unit.floor)} floor` : ''}, ${d.unit.building || ''}${d.unit.typology ? ', ' + d.unit.typology : ''}
  RERA carpet area: ${d.unit.carpet_sqft ? Number(d.unit.carpet_sqft).toLocaleString('en-IN') + ' sq ft' : '—'}
  Agreement value: ${rs(cs.agreementValue)} plus GST at ${cs.gstRate}%
  Booking date: ${dt(d.booking.booking_date)}
  Received so far: ${rs(d.received)}
${next ? `\nYour next instalment is "${next.stage}" (${next.pct}% of the agreement value, ${rs(next.amount)} plus GST ${rs(next.gst)}). We will send you a demand letter when it falls due.\n` : ''}
Please quote your flat number on every payment. Our CRM team will be your point of contact for documents, payments and registration.${d.rmName ? `\nYour relationship manager: ${d.rmName}.` : ''}

Warm regards,
CRM Team
${d.signedFor}${d.project ? '\n' + d.project : ''}`,
  };
}

module.exports = { page, costSheetHtml, allotmentHtml, bookingFormHtml, welcomeEmail, words, inWords };
