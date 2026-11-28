// The payment receipt given to the buyer: its number, its figures, and the email that carries it.
// 4 Nov 2026 meeting: a provisional receipt ("subject to clearance") is emailed as soon as the CRM enters a payment,
// and the final receipt, with its number, once the payment is approved (by Head Accounts, or by the bank statement).
// Until the ERP is live (ERP_LIVE=1) every email goes only to the test address in Letter settings.
const db = require('./db');
const audit = require('./audit');
const { fail } = require('./http');
const { today } = require('./demands');
const { needProject } = require('./access');

const HEAD_LABEL = { av: 'Agreement value (flat cost)', gst: 'GST', tds: 'TDS (Section 194-IA)', stamp_duty: 'Stamp duty', registration: 'Registration charges', other: 'Other' };
const fyOf = (iso) => { const [y, m] = iso.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
// The receipt number is given once, in order of issue, when the receipt is approved: DS/2026-27/0001 (project initials /
// financial year of the payment / running number). A receipt waiting for approval prints as Provisional, subject to realisation.
async function issueNo(r) {
  if (r.receipt_no) return r.receipt_no;
  return db.tx(async (t) => {
    await t.q('select pg_advisory_xact_lock(7316020)');
    const cur = await t.one('select receipt_no from receipts where id = $1', [r.id]); if (cur.receipt_no) return cur.receipt_no;
    const p = await t.one('select code, name from projects where id = $1', [r.project_id]);
    // the financial year of the payment, not of the day the receipt is printed
    const pre = (p.code === 'SIGNATURE' ? 'DS' : String(p.code || p.name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()) + '/' + fyOf(String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on || today()).slice(0, 10)) + '/';
    const last = await t.one("select max(substring(receipt_no from '[0-9]+$')::int) as n from receipts where receipt_no like $1", [pre + '%']);
    const no = pre + String((last.n || 0) + 1).padStart(4, '0');
    await t.q('update receipts set receipt_no = $2, receipt_issued_at = now() where id = $1', [r.id, no]);
    return no;
  });
}
// The flat-cost part of a receipt is shown against the demand stages it pays (16 Nov 2026, Rafi Sir: not "Agreement
// value (flat cost)" but e.g. "Towards completion of 5th slab"). Earlier receipts (AV + TDS, by date) pay the stages
// oldest first; this receipt's AV then fills the next ones. What is left after every stage raised is an advance.
async function stageLines(r, splits) {
  const av = splits.find((x) => x.head === 'av');
  if (!av) return splits;
  const ds = await db.q(`select d.stage_name, d.amount from demands d join bookings b on b.id = d.booking_id
      left join plan_stages s on s.plan_id = b.plan_id and s.name = d.stage_name
      where d.booking_id = $1 and d.status = 'raised' order by s.seq nulls last, d.demand_date, d.id`, [r.booking_id]);
  const prior = await db.one(`select coalesce(sum(x.amount), 0) as paid from receipts p join receipt_splits x on x.receipt_id = p.id
      where p.booking_id = $1 and p.status in ('pending', 'approved') and x.head in ('av', 'tds') and (p.received_on, p.id) < ($2::date, $3)`, [r.booking_id, r.received_on, r.id]);
  let before = Math.round(Number(prior.paid) * 100), left = Math.round(Number(av.amount) * 100);
  const lines = [];
  for (const d of ds) {
    if (left <= 0) break;
    const amt = Math.round(Number(d.amount) * 100);
    if (before >= amt) { before -= amt; continue; }
    const take = Math.min(left, amt - before); before = 0; left -= take;
    lines.push({ head: 'av', label: `Towards ${String(d.stage_name).replace(/^\s*(on|towards|at)\s+/i, '')}`, amount: take / 100 });
  }
  if (left > 0) lines.push({ head: 'av', label: lines.length || ds.length ? 'Advance towards the next stage' : 'Towards booking / first instalment', amount: left / 100 });
  return [...splits.filter((x) => x.head !== 'av'), ...lines];
}

async function receiptFigures(u, id) {
  // a jodi payment (both flats in one payment) is one receipt: on its first part, with both flats and the whole amount
  id = (await require('./joint-flats').partsOf(id))[0] || id;
  const r = await db.one('select * from receipts where id = $1', [id]);
  if (!r) throw fail(404, 'Receipt not found.');
  if (u) needProject(u, r.project_id);
  if (!['pending', 'approved'].includes(r.status)) throw fail(409, `This receipt is ${r.status}, so no receipt can be given for it.`);
  // payments brought in from the old CRM sheet (opening) get their receipt too when the CRM sends it (14 Nov 2026);
  // the ERP never sends those by itself (see sendReceipt)
  const bk = await db.one(`select b.id, u.unit_no, p.name as project from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id where b.id = $1`, [r.booking_id]);
  const ap = await db.q('select y.name, y.address, y.email from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [r.booking_id]);
  const parts = r.joint_key ? await db.q(`select x.*, u.unit_no from receipts x join bookings b on b.id = x.booking_id join units u on u.id = b.unit_id where x.joint_key = $1 order by x.id`, [r.joint_key]) : null;
  let splits = await db.q('select head, amount from receipt_splits where receipt_id = $1 and amount > 0', [id]);
  let lines = await stageLines(r, splits);
  if (parts && parts.length > 1) {
    // each flat's stages, named with the flat; GST and the other heads added up
    lines = []; const other = {};
    for (const p of parts) {
      const sp = await db.q('select head, amount from receipt_splits where receipt_id = $1 and amount > 0', [p.id]);
      for (const x of await stageLines(p, sp)) {
        if (x.head === 'av') lines.push({ ...x, label: `${x.label} (${p.unit_no})` });
        else other[x.head] = Math.round(((other[x.head] || 0) + Number(x.amount)) * 100) / 100;
      }
    }
    for (const [head, amount] of Object.entries(other)) lines.push({ head, amount });
    r.amount = parts.reduce((a, p) => a + Number(p.amount), 0);
    bk.unit_no = parts.map((p) => p.unit_no).join(' + ');
  }
  const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  // the receipt number is given only once Head Accounts has approved it; until then the receipt is provisional
  const no = r.status === 'approved' ? await issueNo(r) : 'Provisional';
  const iso = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const { words } = require('../lib/docs');
  const order = ['av', 'gst', 'tds', 'stamp_duty', 'registration', 'other'];
  return {
    r: { ...r, receipt_no: no }, bk, emails: ap.flatMap((a) => String(a.email || '').split(/[\/,;\s]+/).filter((e) => /@/.test(e))),
    doc: {
      receiptNo: no, date: iso(r.received_on), unit: bk.unit_no, projectName: bk.project, reference: set.reference || null,
      name: ap.map((a) => a.name).join(' & '), addressLines: String(ap[0]?.address || '').split(/\n|,\s*(?=\S)/).map((x) => x.trim()).filter(Boolean).slice(0, 4),
      amount: Number(r.amount), words: words(r.amount), mode: r.mode, instrument: r.instrument_no, drawnOn: r.bank,
      splits: lines.sort((a, b) => order.indexOf(a.head) - order.indexOf(b.head)).map((x) => [x.label || HEAD_LABEL[x.head] || x.head, Number(x.amount)]),
      cleared: r.status === 'approved' || r.bank_status === 'cleared', signedFor: set.signedFor, signatory: set.signatory, signatoryTitle: set.signatoryTitle,
    },
  };
}


// Email the receipt (PDF attached) to the buyer. user: who sends it (null = sent by the ERP itself: the signature is
// the CRM person who entered the payment). auto: 'provisional' | 'final' when sent by itself (each only once).
async function sendReceipt(id, { user = null, auto = null } = {}) {
  const mailer = require('./mailer');
  if (!mailer.configured()) throw fail(409, 'Email is not set up yet, so the receipt could not be sent.');
  id = (await require('./joint-flats').partsOf(id))[0] || id; // a jodi payment: sent once, as one receipt
  if (auto) { const o = await db.one('select opening from receipts where id = $1', [id]); if (o && o.opening) return { skipped: 'payment from the old sheet' }; }
  const f = await receiptFigures(user, id);
  if (auto === 'provisional' && (f.r.provisional_sent_at || f.r.status !== 'pending')) return { skipped: 'already sent' };
  if (auto === 'final' && (f.r.receipt_sent_at || f.r.status !== 'approved')) return { skipped: 'already sent' };
  const live = process.env.ERP_LIVE === '1';
  const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
  const to = live ? [...new Set(f.emails)] : String(set.testEmail || '').split(/[,;\s]+/).filter((e) => /@/.test(e)).slice(0, 1);
  if (!to.length) { if (auto) return { skipped: live ? 'no email address' : 'no test address' }; throw fail(409, live ? `${f.doc.unit}: no email address on this booking.` : 'Test version: set a test email address in Letter settings first.'); }
  const bm = require('./buyer-mail'), x = await bm.context(f.bk.id);
  const by = user || (f.r.created_by ? { id: f.r.created_by } : null);
  const sig = by ? await bm.signature(by) : 'Warm regards,\n\nCustomer Relations, Dream India Group';
  const provisional = f.doc.receiptNo === 'Provisional';
  const amt = `Rs. ${Math.round(f.doc.amount).toLocaleString('en-IN')}`;
  const subject = provisional ? `Provisional receipt: ${f.doc.projectName} ${f.doc.unit}, ${amt}` : `Payment receipt ${f.doc.receiptNo}: ${f.doc.projectName} ${f.doc.unit}`;
  const body = provisional
    ? `Thank you for your payment of ${amt} towards unit ${f.doc.unit}. Please find the provisional receipt attached.\n\nThis receipt is subject to clearance of the payment${f.doc.mode === 'cheque' ? ' (realisation of the cheque)' : ''}. Once it is credited in our bank, you will receive the final receipt with its receipt number.`
    : `Thank you for your payment of ${amt} towards unit ${f.doc.unit}. The payment has been credited in our bank. Please find your payment receipt ${f.doc.receiptNo} attached.`;
  const text = bm.compose({ people: x.people, sig, body });
  const pdf = require('./demand-letter').buildReceipt(f.doc);
  const cn = await mailer.connect(); let sent;
  try { sent = await cn.send({ to, subject: (live ? '' : '[TEST] ') + subject, text, attachments: [{ filename: `Receipt_${f.doc.receiptNo.replace(/[^A-Za-z0-9-]+/g, '_')}_${f.doc.unit}.pdf`, type: 'application/pdf', content: pdf }] }); } finally { await cn.close().catch(() => {}); }
  await db.q(provisional ? 'update receipts set provisional_sent_at = now() where id = $1' : 'update receipts set receipt_sent_at = now() where id = $1', [f.r.id]);
  await require('./comms').logSent({ bookingId: f.bk.id, to, subject, body: text, sent, kind: provisional ? 'receipt-provisional' : 'receipt', userId: user ? user.id : null, test: !live,
    attachments: [{ name: `Receipt_${f.doc.receiptNo.replace(/[^A-Za-z0-9-]+/g, '_')}_${f.doc.unit}.pdf`, url: `/api/receipts?pdf=${f.r.id}` }] });
  await audit.record(db.q, { user, action: 'receipt-email', entity: 'receipt', entityId: f.r.id, projectId: f.r.project_id, after: { receiptNo: f.doc.receiptNo, to: live ? to : ['test'], auto } });
  return { to, receiptNo: f.doc.receiptNo, test: !live, provisional };
}
// Sent by itself; a mail problem never stops the receipt being saved or approved.
// Never by itself for a contractor's flat: those entries are bill adjustments, not money from the buyer.
const contractorFlat = async (id) => !!(await db.one("select 1 as x from receipts r join bookings b on b.id = r.booking_id where r.id = $1 and b.sale_type = 'contractor'", [id]));
const autoSend = async (id, auto, user = null) => ((await contractorFlat(id).catch(() => false)) ? { skipped: "contractor's flat" } : sendReceipt(id, { user, auto }).catch((e) => ({ error: e.message })));

module.exports = { issueNo, receiptFigures, sendReceipt, autoSend, contractorFlat, HEAD_LABEL };
