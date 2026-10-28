// Demand letters and reminders, in the CRM team's existing format (same layout as the staff portal).
// GET ?project=ID          → buyers with dues, their last letter, settings and mail status
// GET ?pdf=ID | ?print=1,2 → a saved letter, or several in one PDF for courier
// GET ?preview=BOOKING&type=… → what the letter would look like, nothing saved
// POST {action}: prepare, email, mark, settings
// Safety: until the ERP is live (ERP_LIVE=1), emails go ONLY to the test address in the letter settings.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const mailer = require('../lib/mailer');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { buildLetter, buildMany } = require('../lib/demand-letter');
const { daysToPay, addDays, today } = require('../lib/demands');
const { toPaise } = require('../lib/money');
const { route, fail, str, intOr } = require('../lib/http');

const TYPES = ['Demand Letter', 'Reminder I', 'Reminder II', 'Demand Letter with Delay Charges'];
const DEFAULTS = { delayRate: 10.5, signedFor: 'M/s. PRIME REALTORS', cc: '', testEmail: '', minDue: 100 };
const live = () => process.env.ERP_LIVE === '1';
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const words = (stage) => String(stage).replace(/^On (Completion of )?(the )?/i, '').replace(/^Receipt of OC$/i, 'Occupation Certificate');

async function settings() {
  const r = await db.one("select value from settings where key = 'letters'");
  return { ...DEFAULTS, ...(r ? r.value : {}) };
}

// Everything a letter needs for one booking, worked out from demands and approved receipts.
async function letterData(bookingId, type, letterDate, set) {
  const b = await db.one(
    `select b.id, b.agreement_value, b.gst_rate, b.sample, u.unit_no, p.name as project, p.code as project_code, bb.*
       from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id join booking_balances bb on bb.booking_id = b.id where b.id = $1`, [bookingId]);
  const ds = await db.q(`select d.stage_name, d.pct, d.demand_date, s.seq from demands d join bookings b on b.id = d.booking_id
                           left join plan_stages s on s.plan_id = b.plan_id and s.name = d.stage_name where d.booking_id = $1 and d.status = 'raised' order by s.seq nulls last, d.demand_date`, [bookingId]);
  if (!ds.length) throw fail(400, `${b.unit_no}: nothing has been demanded yet.`);
  const ap = await db.q('select y.name, y.phone, y.email, y.address from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [bookingId]);
  const latest = ds[ds.length - 1];
  const cumPct = ds.reduce((a, d) => a + Number(d.pct), 0);
  const invoiceDate = latest.demand_date;
  const date = type === 'Demand Letter' ? invoiceDate : letterDate || today();
  const flatDue = Math.round(toPaise(b.outstanding) / 100), gstDue = Math.round(toPaise(b.gst_outstanding) / 100);
  // Delay charges (provisional, as on the portal): yearly rate on flat + GST due, from the invoice date.
  const lateDays = Math.max(0, Math.round((Date.parse(date) - Date.parse(invoiceDate)) / 864e5));
  const delay = type === 'Demand Letter' ? 0 : Math.round(((flatDue + gstDue) * (Number(set.delayRate) / 100) * lateDays) / 365);
  const due = addDays(date, await daysToPay(db));
  return {
    bookingId, sample: b.sample, toEmails: ap.flatMap((a) => emails(a.email)),
    letter: {
      letterType: type, unit: b.unit_no, projectName: b.project, reference: set.reference || undefined,
      name: ap.map((a) => a.name).join(' & '), addressLines: String(ap[0]?.address || '').split(/\n|,\s*(?=\S)/).map((x) => x.trim()).filter(Boolean).slice(0, 4),
      phone: ap[0]?.phone || '', email: ap.flatMap((a) => emails(a.email)).join(' / '),
      words: words(latest.stage_name), pct: cumPct / 100, invoiceDate, letterDate: date, dueDate: due,
      av: Math.round(Number(b.agreement_value)), received: Math.round(toPaise(b.credit_av) / 100), flatDue,
      gstRec: Math.round(toPaise(b.received_gst) / 100), gstDue, delay, total: flatDue + gstDue + delay, signedFor: set.signedFor,
      signatory: set.signatory || null, signatoryTitle: set.signatoryTitle || null, banks: letterBanks(set),
    },
  };
}

// The bank accounts printed on demand letters and receipts (Letter settings); the letter's own defaults until set.
function letterBanks(set) {
  const list = (set.banks || []).filter((x) => x && x.favouring && x.accountNo);
  if (!list.length) return undefined;
  return list.map((x) => ({ particulars: x.particulars || '', favouring: x.favouring, details: [`Bank Name: ${x.bank || ''}`, `A/c No. ${x.accountNo}`, x.ifsc ? `IFSC Code: ${x.ifsc}` : '', x.branch ? `Branch: ${x.branch}` : ''].filter(Boolean).join('\n') }));
}

async function queue(projectId, set) {
  const rows = await db.q(
    `select b.id as booking_id, u.unit_no, b.sample, bb.outstanding, bb.gst_outstanding, bb.overdue,
            (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers,
            (select bool_or(y.email is not null and y.email like '%@%') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as has_email,
            (select coalesce(sum(d.pct), 0) from demands d where d.booking_id = b.id and d.status = 'raised') as cum_pct,
            (select d.stage_name from demands d join plan_stages s on s.plan_id = b.plan_id and s.name = d.stage_name where d.booking_id = b.id and d.status = 'raised' order by s.seq desc limit 1) as stage,
            l.id as letter_id, l.letter_type, l.created_at as letter_at, l.sent_via, l.sent_at
       from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
       left join lateral (select * from demand_letters x where x.booking_id = b.id order by x.created_at desc limit 1) l on true
      where u.project_id = $1 and b.status = 'active' and bb.outstanding + bb.gst_outstanding > $2
      order by bb.overdue desc, u.unit_no`, [projectId, Number(set.minDue) || 0]);
  for (const r of rows) r.stage_words = r.stage ? words(r.stage) : '';
  return rows;
}

function sendPdf(res, buf, name, download) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '_')}"`);
  res.end(buf);
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res); if (!u) return;
    if (!has(u, 'demand.raise') && !has(u, 'ledger.view')) throw fail(403, 'Your role does not allow this.');
    const q = req.query || {};
    const set = await settings();
    if (q.pdf || q.print) {
      const ids = String(q.pdf || q.print).split(',').map((x) => intOr(x)).filter(Boolean).slice(0, 300);
      const rows = await db.q('select l.*, u.project_id, u.unit_no from demand_letters l join bookings b on b.id = l.booking_id join units u on u.id = b.unit_id where l.id = any($1::int[]) order by u.unit_no', [ids]);
      if (!rows.length) throw fail(404, 'Letter not found.');
      for (const r of rows) needProject(u, r.project_id);
      if (rows.length === 1) return sendPdf(res, buildLetter(rows[0].figures), `${rows[0].unit_no}_${rows[0].letter_type}.pdf`);
      return sendPdf(res, buildMany(rows.map((r) => r.figures)), `demand_letters_${today()}.pdf`);
    }
    if (q.preview) {
      await bookingFor(u, intOr(q.preview));
      const type = TYPES.includes(q.type) ? q.type : 'Demand Letter';
      const d = await letterData(intOr(q.preview), type, today(), set);
      return sendPdf(res, buildLetter(d.letter), `preview_${d.letter.unit}.pdf`);
    }
    const projectId = needProject(u, intOr(q.project));
    return res.json({ rows: await queue(projectId, set), settings: { ...set, canEdit: has(u, 'demand.approve') || has(u, 'accounts.manage') }, mail: { configured: mailer.configured(), from: mailer.sender(), live: live() }, types: TYPES });
  },

  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const set = await settings();

    if (b.action === 'settings') {
      if (!has(u, 'demand.approve') && !has(u, 'accounts.manage')) throw fail(403, 'Only Head CRM, Head Accounts or Admin can change letter settings.');
      const v = { ...set };
      if (b.delayRate != null) { const r = Number(b.delayRate); if (!(r >= 0 && r <= 36)) throw fail(400, 'Delay rate: 0 to 36% a year.'); v.delayRate = r; }
      if (b.minDue != null) v.minDue = Math.max(0, Number(b.minDue) || 0);
      if (b.signedFor != null) v.signedFor = str(b.signedFor, 80) || DEFAULTS.signedFor;
      if (b.cc != null) v.cc = emails(b.cc).join(', ');
      if (b.testEmail != null) v.testEmail = emails(b.testEmail).slice(0, 1).join('');
      if (b.signatory != null) v.signatory = str(b.signatory, 80) || null;
      if (b.signatoryTitle != null) v.signatoryTitle = str(b.signatoryTitle, 80) || null;
      if (b.reference != null) v.reference = str(b.reference, 240) || null;
      if (Array.isArray(b.banks)) v.banks = b.banks.slice(0, 4).map((x) => ({ particulars: str(x.particulars, 60), favouring: str(x.favouring, 80), bank: str(x.bank, 60), accountNo: str(x.accountNo, 30).replace(/\s/g, ''), ifsc: str(x.ifsc, 15).toUpperCase(), branch: str(x.branch, 60) }))
        .filter((x) => x.favouring && x.accountNo);
      delete v.canEdit;
      await db.tx(async (t) => {
        await t.q("insert into settings (key, value) values ('letters', $1) on conflict (key) do update set value = excluded.value", [v]);
        await audit.record(t.q, { user: u, action: 'update', entity: 'settings', entityId: 'letters', before: set, after: v });
      });
      return res.json({ ok: true });
    }

    if (!has(u, 'demand.raise')) throw fail(403, 'Your role does not allow this.');
    const projectId = needProject(u, intOr(b.projectId));

    if (b.action === 'prepare') {
      const type = TYPES.includes(b.letterType) ? b.letterType : null;
      if (!type) throw fail(400, 'Choose the letter type.');
      const ids = (Array.isArray(b.bookingIds) ? b.bookingIds : []).map((x) => intOr(x)).filter(Boolean).slice(0, 300);
      if (!ids.length) throw fail(400, 'Tick at least one buyer.');
      const letterDate = /^\d{4}-\d{2}-\d{2}$/.test(b.letterDate || '') ? b.letterDate : today();
      const made = [];
      for (const id of ids) {
        const bk = await bookingFor(u, id);
        if (bk.project_id !== projectId) throw fail(400, 'All buyers must be from the chosen project.');
        const d = await letterData(id, type, letterDate, set);
        const row = await db.tx(async (t) => {
          const r = await t.one(`insert into demand_letters (booking_id, letter_type, stage_words, cum_pct, invoice_date, letter_date, due_date, figures, created_by)
                                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [id, type, d.letter.words, d.letter.pct * 100, d.letter.invoiceDate, d.letter.letterDate, d.letter.dueDate, d.letter, u.id]);
          await audit.record(t.q, { user: u, action: 'prepare', entity: 'letter', entityId: r.id, projectId, after: { unit: d.letter.unit, type, total: d.letter.total } });
          return r;
        });
        made.push({ id: row.id, unit: d.letter.unit, total: d.letter.total, hasEmail: d.toEmails.length > 0 });
      }
      return res.json({ ok: true, letters: made });
    }

    const ids = (Array.isArray(b.letterIds) ? b.letterIds : []).map((x) => intOr(x)).filter(Boolean).slice(0, 25);
    if (!ids.length) throw fail(400, 'No letters chosen.');
    const letters = await db.q(
      `select l.*, b.sample, u.project_id, u.unit_no,
              (select string_agg(y.email, ',') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id) as emails
         from demand_letters l join bookings b on b.id = l.booking_id join units u on u.id = b.unit_id where l.id = any($1::int[])`, [ids]);
    for (const l of letters) if (l.project_id !== projectId) throw fail(400, 'All letters must be from the chosen project.');

    if (b.action === 'mark') {
      const via = ['courier', 'whatsapp'].includes(b.via) ? b.via : null;
      if (!via) throw fail(400, 'Choose courier or WhatsApp.');
      await db.tx(async (t) => {
        for (const l of letters) {
          await t.q('update demand_letters set sent_via = $2, sent_at = now(), sent_by = $3, send_error = null where id = $1', [l.id, via, u.id]);
          await audit.record(t.q, { user: u, action: 'send-' + via, entity: 'letter', entityId: l.id, projectId, after: { unit: l.unit_no } });
        }
      });
      return res.json({ ok: true, marked: letters.length });
    }

    if (b.action === 'email') {
      if (!mailer.configured()) throw fail(400, 'The sending email account is not connected to the ERP yet.');
      if (!live() && !set.testEmail) throw fail(400, 'This is the test version: set a test email address in Letter settings first. Letters go only there until the ERP is live.');
      const out = [];
      const conn = await mailer.connect();
      try {
        for (const l of letters) {
          const real = emails(l.emails);
          const to = live() && !l.sample ? real : [set.testEmail];
          if (!to.length) { out.push({ id: l.id, unit: l.unit_no, error: 'no email address' }); continue; }
          const f = l.figures;
          try {
            const subj = `${l.letter_type}: ${f.projectName || 'Dream Signature'} ${f.unit} – payment due ${f.dueDate}`;
            const sent = await conn.send({
              to, cc: live() && !l.sample ? emails(set.cc) : [],
              subject: `${l.letter_type}: ${f.projectName || 'Dream Signature'} ${f.unit} – payment due ${f.dueDate}${live() ? '' : ' [TEST]'}`,
              text: `Dear ${f.name},\n\nPlease find attached the ${l.letter_type.toLowerCase()} for unit ${f.unit}. The amount due is Rs. ${f.total}, payable by ${f.dueDate}.\n\nIf you have already paid, please disregard this notice.\n\nWarm regards,\n${f.signedFor}`,
              attachments: [{ filename: `${f.unit}_${l.letter_type}.pdf`, content: buildLetter(f), type: 'application/pdf' }],
            });
            await require('../lib/comms').logSent({ bookingId: l.booking_id, to, subject: subj, body: `${l.letter_type} for ${f.unit}: Rs. ${f.total} due by ${f.dueDate} (PDF attached).`, sent, kind: 'letter', userId: u.id, test: !live() });
            await db.tx(async (t) => {
              await t.q("update demand_letters set sent_via = 'email', sent_to = $2, sent_at = now(), sent_by = $3, send_error = null where id = $1", [l.id, to.join(', '), u.id]);
              await audit.record(t.q, { user: u, action: 'send-email', entity: 'letter', entityId: l.id, projectId, after: { unit: l.unit_no, to: to.join(', '), test: !live() } });
            });
            out.push({ id: l.id, unit: l.unit_no, to: to.join(', ') });
          } catch (e) {
            await db.q('update demand_letters set send_error = $2 where id = $1', [l.id, String(e.message).slice(0, 300)]);
            out.push({ id: l.id, unit: l.unit_no, error: e.message });
          }
        }
      } finally { await conn.close(); }
      return res.json({ ok: true, results: out });
    }
    throw fail(400, 'Unknown action.');
  },
});
