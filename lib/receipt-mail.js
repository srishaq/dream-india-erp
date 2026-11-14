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
async function receiptFigures(u, id) {
  const r = await db.one('select * from receipts where id = $1', [id]);
  if (!r) throw fail(404, 'Receipt not found.');
  if (u) needProject(u, r.project_id);
  if (!['pending', 'approved'].includes(r.status)) throw fail(409, `This receipt is ${r.status}, so no receipt can be given for it.`);
  // payments brought in from the old CRM sheet (opening) get their receipt too when the CRM sends it (14 Nov 2026);
  // the ERP never sends those by itself (see sendReceipt)
  const bk = await db.one(`select b.id, u.unit_no, p.name as project from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id where b.id = $1`, [r.booking_id]);
  const ap = await db.q('select y.name, y.address, y.email from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [r.booking_id]);
  const splits = await db.q('select head, amount from receipt_splits where receipt_id = $1 and amount > 0', [id]);
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
      splits: splits.sort((a, b) => order.indexOf(a.head) - order.indexOf(b.head)).map((x) => [HEAD_LABEL[x.head] || x.head, Number(x.amount)]),
      cleared: r.status === 'approved' || r.bank_status === 'cleared', signedFor: set.signedFor, signatory: set.signatory, signatoryTitle: set.signatoryTitle,
    },
  };
}


// Email the receipt (PDF attached) to the buyer. user: who sends it (null = sent by the ERP itself: the signature is
// the CRM person who entered the payment). auto: 'provisional' | 'final' when sent by itself (each only once).
async function sendReceipt(id, { user = null, auto = null } = {}) {
  const mailer = require('./mailer');
  if (!mailer.configured()) throw fail(409, 'Email is not set up yet, so the receipt could not be sent.');
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
  await require('./comms').logSent({ bookingId: f.bk.id, to, subject, body: text, sent, kind: provisional ? 'receipt-provisional' : 'receipt', userId: user ? user.id : null, test: !live });
  await audit.record(db.q, { user, action: 'receipt-email', entity: 'receipt', entityId: f.r.id, projectId: f.r.project_id, after: { receiptNo: f.doc.receiptNo, to: live ? to : ['test'], auto } });
  return { to, receiptNo: f.doc.receiptNo, test: !live, provisional };
}
// Sent by itself; a mail problem never stops the receipt being saved or approved.
const autoSend = (id, auto, user = null) => sendReceipt(id, { user, auto }).catch((e) => ({ error: e.message }));

module.exports = { issueNo, receiptFigures, sendReceipt, autoSend, HEAD_LABEL };
