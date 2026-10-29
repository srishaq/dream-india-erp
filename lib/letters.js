// Demand letters: the figures for one booking, saving a letter, and emailing saved letters.
// Shared by the Demand letters page, demand-run approval (letters go out automatically) and the morning reminders.
// Safety: until the ERP is live (ERP_LIVE=1), emails go ONLY to the test address in the letter settings.
const db = require('./db');
const audit = require('./audit');
const mailer = require('./mailer');
const { buildLetter } = require('./demand-letter');
const { daysToPay, addDays, today } = require('./demands');
const { toPaise } = require('./money');
const { fail } = require('./http');

const TYPES = ['Demand Letter', 'Reminder I', 'Reminder II', 'Demand Letter with Delay Charges'];
const DEFAULTS = { delayRate: 10.5, signedFor: 'M/s. PRIME REALTORS', cc: '', testEmail: '', minDue: 100 };
// The WhatsApp templates Click Connect approved for Dream India (their template IDs). Letter settings can change them.
// Blanks, in Click Connect's order: demand letters  name, flat, amount, due date
//                                   payment_reminder / payment_received  name, amount, flat, date
//                                   registration_appointment  name, flat, date, time and place
const WA_TEMPLATES = {
  waEmailTemplate: 'demand_letter_emailed_akaz55aw1ius78iv',
  waPdfTemplate: 'demand_letter_pdf_kaj43dtm2mij2hvc',
  waReminderTemplate: 'payment_reminder_6prw9zc5qo0nh4od',
  waReceivedTemplate: 'payment_received_4x8bvz5zkou6bw24',
  waRegTemplate: 'registration_appointment_rdlybalong295uct',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (d) => { const x = String(d instanceof Date ? d.toISOString() : d || '').slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x); return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1]}` : String(d || ''); };
const rs = (v) => 'Rs. ' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const live = () => process.env.ERP_LIVE === '1';
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));
const words = (stage) => String(stage).replace(/^On (Completion of )?(the )?/i, '').replace(/^Receipt of OC$/i, 'Occupation Certificate');

async function settings() {
  const r = await db.one("select value from settings where key = 'letters'");
  const v = { ...DEFAULTS, ...(r ? r.value : {}) };
  for (const [k, id] of Object.entries(WA_TEMPLATES)) if (!v[k]) v[k] = id;
  return v;
}

// One WhatsApp notice to a flat's first buyer with a mobile: 'reminder' | 'received' | 'reg'. Never throws for a
// missing template or number; returns why it was skipped. Until the ERP is live it goes only to the test mobile.
async function waNotice({ bookingId, kind, params, userId = null, set = null }) {
  const wa = require('./whatsapp');
  if (!wa.configured()) return { skipped: 'WhatsApp is not connected yet' };
  set = set || await settings();
  const template = set[{ reminder: 'waReminderTemplate', received: 'waReceivedTemplate', reg: 'waRegTemplate' }[kind]];
  if (!template) return { skipped: 'no template' };
  if (!live() && !set.testMobile) return { skipped: 'no test mobile in Letter settings' };
  const b = await db.one(`select b.sample, (select y.phone from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id and y.phone is not null order by a.seq limit 1) as phone
      from bookings b where b.id = $1`, [bookingId]);
  if (!b) return { skipped: 'no booking' };
  const phone = live() && !b.sample ? b.phone : set.testMobile;
  if (!phone) return { skipped: 'no mobile number' };
  const r = await wa.send({ bookingId, phone, template, params: params.map((x) => String(x == null ? '' : x)), userId, kind });
  return { sent: true, to: r.to };
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

// Save one letter for a booking. Returns { id, unit, total, hasEmail, dueDate }.
async function prepareOne({ bookingId, type, letterDate, set, user, projectId, auto = null }) {
  const d = await letterData(bookingId, type, letterDate || today(), set);
  const row = await db.tx(async (t) => {
    const r = await t.one(`insert into demand_letters (booking_id, letter_type, stage_words, cum_pct, invoice_date, letter_date, due_date, figures, created_by, auto)
                           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [bookingId, type, d.letter.words, d.letter.pct * 100, d.letter.invoiceDate, d.letter.letterDate, d.letter.dueDate, d.letter, user ? user.id : null, auto]);
    await audit.record(t.q, { user, action: 'prepare', entity: 'letter', entityId: r.id, projectId, after: { unit: d.letter.unit, type, total: d.letter.total } });
    return r;
  });
  return { id: row.id, bookingId, unit: d.letter.unit, total: d.letter.total, hasEmail: d.toEmails.length > 0, dueDate: d.letter.dueDate };
}

// Why emailing can't happen right now, or null when it can.
function cannotEmail(set) {
  if (!mailer.configured()) return 'The sending email account is not connected to the ERP yet.';
  if (!live() && !set.testEmail) return 'This is the test version: set a test email address in Letter settings first. Letters go only there until the ERP is live.';
  return null;
}

// Email saved letters (rows of demand_letters, by id). Returns [{ id, bookingId, unit, to } | { id, unit, error }].
async function emailLetters(ids, { set, user, note, reminder, amountNow } = {}) {
  set = set || await settings();
  const why = cannotEmail(set); if (why) throw fail(400, why);
  const letters = await db.q(
    `select l.*, b.sample, u.project_id, u.unit_no,
            (select string_agg(y.email, ',') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id) as emails
       from demand_letters l join bookings b on b.id = l.booking_id join units u on u.id = b.unit_id where l.id = any($1::int[])`, [ids]);
  const out = [];
  const conn = await mailer.connect();
  try {
    for (const l of letters) {
      const real = emails(l.emails);
      const to = live() && !l.sample ? real : [set.testEmail];
      if (!to.length) { out.push({ id: l.id, bookingId: l.booking_id, unit: l.unit_no, error: 'no email address' }); continue; }
      const f = l.figures;
      try {
        const subj = reminder ? `Reminder: payment for ${f.projectName || 'Dream Signature'} ${f.unit} due on ${f.dueDate}` : `${l.letter_type}: ${f.projectName || 'Dream Signature'} ${f.unit} – payment due ${f.dueDate}`;
        const text = reminder
          ? `Dear ${f.name},\n\nThis is a gentle reminder that Rs. ${amountNow != null ? amountNow : f.total} for unit ${f.unit} is due on ${f.dueDate}. The demand letter is attached again for your reference.\n\nIf you have already paid, please disregard this reminder.\n\nWarm regards,\n${f.signedFor}`
          : `Dear ${f.name},\n\nPlease find attached the ${l.letter_type.toLowerCase()} for unit ${f.unit}. The amount due is Rs. ${f.total}, payable by ${f.dueDate}.\n\nIf you have already paid, please disregard this notice.\n\nWarm regards,\n${f.signedFor}`;
        const sent = await conn.send({
          to, cc: live() && !l.sample ? emails(set.cc) : [],
          subject: subj + (live() ? '' : ' [TEST]'),
          text,
          attachments: [{ filename: `${f.unit}_${l.letter_type}.pdf`, content: buildLetter(f), type: 'application/pdf' }],
        });
        await require('./comms').logSent({ bookingId: l.booking_id, to, subject: subj, body: `${reminder ? 'Reminder of the ' + l.letter_type.toLowerCase() : l.letter_type} for ${f.unit}: Rs. ${f.total} due by ${f.dueDate} (PDF attached).${note ? ' ' + note : ''}`, sent, kind: 'letter', userId: user ? user.id : null, test: !live() });
        if (!reminder) await db.tx(async (t) => {
          await t.q("update demand_letters set sent_via = 'email', sent_to = $2, sent_at = now(), sent_by = $3, send_error = null where id = $1", [l.id, to.join(', '), user ? user.id : null]);
          await audit.record(t.q, { user, action: 'send-email', entity: 'letter', entityId: l.id, projectId: l.project_id, after: { unit: l.unit_no, to: to.join(', '), test: !live() }, note: note || null });
        });
        out.push({ id: l.id, bookingId: l.booking_id, unit: l.unit_no, to: to.join(', ') });
      } catch (e) {
        await db.q('update demand_letters set send_error = $2 where id = $1', [l.id, String(e.message).slice(0, 300)]);
        out.push({ id: l.id, bookingId: l.booking_id, unit: l.unit_no, error: e.message });
      }
    }
  } finally { await conn.close().catch(() => {}); }
  return out;
}

// After a demand run is approved: a Demand Letter for every flat charged, emailed straight away (the first 30;
// the rest go with the 5-minute mail job), and a first follow-up on the due date so the flat comes up in Call today.
const NOW_LIMIT = 30;
async function afterRun({ run, bookingIds, user }) {
  const set = await settings();
  const why = cannotEmail(set);
  const made = [], failed = [];
  for (const id of bookingIds) {
    try { made.push(await prepareOne({ bookingId: id, type: 'Demand Letter', letterDate: run.demand_date, set, user, projectId: run.project_id, auto: 'run' })); }
    catch (e) { failed.push({ bookingId: id, error: e.message }); }
  }
  let results = [];
  if (!why && made.length) results = await emailLetters(made.filter((m) => m.hasEmail).slice(0, NOW_LIMIT).map((m) => m.id), { set, user, note: 'Sent automatically when the demand was approved.' }).catch((e) => made.map((m) => ({ id: m.id, error: e.message })));
  const sentIds = new Set(results.filter((r) => !r.error).map((r) => r.id));
  const tried = new Set(results.map((r) => r.id));
  // WhatsApp: for the ones emailed now, and for buyers with no email (they get the PDF on WhatsApp)
  const waIds = made.filter((m) => sentIds.has(m.id) || !m.hasEmail).map((m) => m.id);
  const whatsapp = waIds.length ? await whatsappLetters(waIds, { set, emailed: sentIds, userId: user ? user.id : null }).catch((e) => ({ sent: 0, skipped: e.message })) : { sent: 0 };
  await db.tx(async (t) => {
    for (const m of made) {
      const how = !m.hasEmail ? 'no email on file: send the letter by WhatsApp or courier, and collect an email address on the call'
        : sentIds.has(m.id) ? 'letter emailed' : why ? 'letter ready (not emailed: ' + why.replace(/\.$/, '') + ')' : tried.has(m.id) ? 'the email failed, see Demand letters' : 'letter ready, being emailed';
      await t.q("insert into follow_ups (booking_id, kind, outcome, note, next_date, created_by) values ($1, 'Note', 'Demand raised', $2, $3, $4)",
        [m.bookingId, `Demand for ${run.stage_name} raised (Rs. ${m.total} due by ${m.dueDate}); ${how}. Call on the due date if not paid.`.slice(0, 1000), run.due_date || m.dueDate, user ? user.id : null]);
    }
  });
  const noEmail = made.filter((m) => !m.hasEmail).length;
  return { letters: made.length, emailed: sentIds.size, noEmail, whatsapp: whatsapp.sent, whatsappNote: whatsapp.skipped || null, waiting: why ? 0 : made.filter((m) => m.hasEmail).length - results.length, notEmailed: why, errors: failed.length + results.filter((r) => r.error && r.error !== 'no email address').length };
}

// The 5-minute mail job: automatic letters still waiting to be emailed (made in the last 3 days, never tried).
async function sendPendingAuto(limit = NOW_LIMIT) {
  const set = await settings();
  if (cannotEmail(set)) return { sent: 0 };
  const rows = await db.q("select l.id from demand_letters l where l.auto is not null and l.sent_via is null and l.send_error is null and l.created_at > now() - interval '3 days' and exists (select 1 from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id and y.email like '%@%') order by l.id limit $1", [limit]);
  if (!rows.length) return { sent: 0 };
  const r = await emailLetters(rows.map((x) => x.id), { set, note: 'Sent automatically.' });
  const ok = new Set(r.filter((x) => !x.error).map((x) => x.id));
  if (ok.size) await whatsappLetters([...ok], { set, emailed: ok }).catch(() => null);
  return { sent: r.filter((x) => !x.error).length, failed: r.filter((x) => x.error).length };
}

// Morning payment reminders, once per demand of each kind, only while the flat still owes money:
//   'before' — a short email 3 days before the due date (the demand letter they already have is attached again);
//   'after'  — Reminder I (with the delay charges) 7 days after the due date.
// Opening balances brought in from the old sheets are left out, so go-live doesn't email old dues to everyone.
async function reminders({ day } = {}) {
  const set = await settings();
  if (set.autoReminders === false) return { skipped: 'Automatic reminders are switched off in Letter settings.' };
  const why = cannotEmail(set);
  if (why) return { skipped: why };
  const d0 = day || today();
  const owing = `(bb.outstanding + bb.gst_outstanding) > ${Number(set.minDue) || 0}`;
  const due = await db.q(`select d.id, d.booking_id, d.due_date, case when d.due_date > $1::date then 'before' else 'after' end as kind
      from demands d join bookings b on b.id = d.booking_id join booking_balances bb on bb.booking_id = b.id
     where d.status = 'raised' and not d.opening and b.status = 'active' and ${owing}
       and ((d.due_date > $1::date and d.due_date <= $1::date + 3) or (d.due_date <= $1::date - 7 and d.due_date > $1::date - 30))
       and not exists (select 1 from demand_reminders r where r.demand_id = d.id and r.kind = case when d.due_date > $1::date then 'before' else 'after' end)
     order by d.due_date limit 60`, [d0]);
  const out = { before: 0, after: 0, noEmail: 0, failed: 0 };
  const done = new Set();
  for (const r of due) {
    const once = r.booking_id + ':' + r.kind; // two demands due together: one reminder for the flat
    let result = 'sent', letterId = null;
    try {
      if (done.has(once)) result = 'covered by another reminder';
      else if (r.kind === 'after') {
        // a Reminder I made on an earlier morning whose email failed is sent again rather than made twice
        const prev = await db.one("select l.id, (select bool_or(y.email like '%@%') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id) as has_email from demand_letters l where l.booking_id = $1 and l.auto = 'after' and l.sent_at is null and l.created_at > now() - interval '10 days' order by l.id desc limit 1", [r.booking_id]);
        const m = prev ? { id: prev.id, hasEmail: !!prev.has_email } : await prepareOne({ bookingId: r.booking_id, type: 'Reminder I', letterDate: d0, set, auto: 'after' });
        letterId = m.id;
        const [x] = m.hasEmail ? await emailLetters([m.id], { set, note: 'Sent automatically 7 days after the due date.' }) : [null];
        await whatsappLetters([m.id], { set, emailed: new Set(x && !x.error ? [m.id] : []) }).catch(() => null);
        if (!m.hasEmail) result = 'no email on file: WhatsApp / print and courier';
        else if (x && x.error) result = 'error: ' + x.error;
      } else {
        const last = await db.one("select id from demand_letters where booking_id = $1 and letter_type = 'Demand Letter' order by created_at desc limit 1", [r.booking_id]);
        if (!last) result = 'no demand letter to remind about';
        else {
          letterId = last.id;
          // what is owed today (after any part payment), not the amount on the letter
          const now = await letterData(r.booking_id, 'Demand Letter', d0, set).catch(() => null);
          const [x] = await emailLetters([last.id], { set, note: 'Reminder sent automatically 3 days before the due date.', reminder: true, amountNow: now ? now.letter.total : null });
          if (x && x.error === 'no email address') result = 'no email on file: WhatsApp only';
          else if (x && x.error) result = 'error: ' + x.error;
          if (now && !result.startsWith('error')) await waNotice({ bookingId: r.booking_id, kind: 'reminder', set, params: [now.letter.name, rs(now.letter.total), now.letter.unit, dmy(r.due_date)] }).catch(() => null);
        }
      }
    } catch (e) { result = 'error: ' + e.message; }
    done.add(once);
    if (result.startsWith('error')) { out.failed++; continue; } // not marked done: tried again the next morning
    await db.q('insert into demand_reminders (demand_id, kind, letter_id, result) values ($1, $2, $3, $4) on conflict do nothing', [r.id, r.kind, letterId, result.slice(0, 300)]);
    if (result === 'sent') out[r.kind]++; else if (result.startsWith('no email')) out.noEmail++;
  }
  return out;
}

// WhatsApp after a letter: a short "please check your email" note when it was emailed; the PDF itself when the buyer
// has no email on file. Business-started WhatsApps must use templates Meta has approved (names in Letter settings):
//   waEmailTemplate  body {{1}} name, {{2}} flat, {{3}} amount, {{4}} due date (with Click Connect: its template ID)
//   waPdfTemplate    the same body, with a document header (the letter PDF, fetched from a signed ERP link)
// Until the ERP is live they go only to the test mobile in Letter settings.
async function whatsappLetters(letterIds, { set, emailed = new Set(), userId = null } = {}) {
  const wa = require('./whatsapp');
  set = set || await settings();
  if (!wa.configured()) return { sent: 0, skipped: 'WhatsApp is not connected yet' };
  if (!live() && !set.testMobile) return { sent: 0, skipped: 'no test mobile in Letter settings' };
  const rows = await db.q(`select l.id, l.booking_id, l.letter_type, l.figures, b.sample,
      (select y.phone from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id and y.phone is not null order by a.seq limit 1) as phone
      from demand_letters l join bookings b on b.id = l.booking_id where l.id = any($1::int[])`, [letterIds]);
  let sent = 0; const errors = [];
  for (const l of rows) {
    const byEmail = emailed.has(l.id);
    const template = byEmail ? set.waEmailTemplate : set.waPdfTemplate;
    if (!template) continue;
    const f = l.figures;
    const phone = live() && !l.sample ? l.phone : set.testMobile;
    if (!phone) { errors.push({ id: l.id, error: 'no mobile number' }); continue; }
    try {
      await wa.send({ bookingId: l.booking_id, phone, template, params: [f.name, f.unit, rs(f.total), dmy(f.dueDate)], userId, kind: 'letter',
        document: byEmail ? null : { content: buildLetter(f), url: wa.fileLink('letter', l.id), filename: `${f.unit}_${l.letter_type}.pdf`.replace(/\s+/g, '_') } });
      if (!byEmail) await db.q("update demand_letters set sent_via = 'whatsapp', sent_to = $2, sent_at = now(), send_error = null where id = $1 and sent_via is null", [l.id, phone]);
      sent++;
    } catch (e) { errors.push({ id: l.id, error: e.message }); }
  }
  return { sent, errors: errors.length };
}

module.exports = { waNotice, dmy, rs, WA_TEMPLATES, whatsappLetters, reminders, afterRun, sendPendingAuto, TYPES, DEFAULTS, live, emails, words, settings, letterData, letterBanks, prepareOne, cannotEmail, emailLetters };
