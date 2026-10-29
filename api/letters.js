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
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');
const { TYPES, DEFAULTS, live, emails, words, settings, letterData, prepareOne, emailLetters } = require('../lib/letters');


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

// Letters made but not sent to buyers with no email address on file: to print and courier (or WhatsApp by hand).
async function courier(projectId) {
  return db.q(`select l.id, l.booking_id, l.letter_type, l.created_at, u.unit_no, l.figures->>'name' as name, l.figures->>'total' as total
       from demand_letters l join bookings b on b.id = l.booking_id join units u on u.id = b.unit_id
      where u.project_id = $1 and b.status = 'active' and l.sent_at is null and l.created_at > now() - interval '60 days'
        and l.id = (select max(x.id) from demand_letters x where x.booking_id = l.booking_id)
        and not exists (select 1 from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = l.booking_id and y.email like '%@%')
      order by u.unit_no`, [projectId]);
}

function sendPdf(res, buf, name, download) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '_')}"`);
  res.end(buf);
}

module.exports = route({
  GET: async (req, res) => {
    // a letter PDF for WhatsApp to fetch: no login, only a signed link that expires (lib/whatsapp.js fileLink)
    if ((req.query || {}).wa) {
      const t = require('../lib/whatsapp').checkLink(req.query.wa);
      if (!t || t.kind !== 'letter') throw fail(404, 'This link has expired.');
      const l = await db.one('select l.figures, l.letter_type, u.unit_no from demand_letters l join bookings b on b.id = l.booking_id join units u on u.id = b.unit_id where l.id = $1', [t.id]);
      if (!l) throw fail(404, 'Letter not found.');
      return sendPdf(res, buildLetter(l.figures), `${l.unit_no}_${l.letter_type}.pdf`);
    }
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
    return res.json({ courier: await courier(projectId), rows: await queue(projectId, set), settings: { ...set, canEdit: has(u, 'demand.approve') || has(u, 'accounts.manage') }, mail: { configured: mailer.configured(), from: mailer.sender(), live: live() }, types: TYPES });
  },

  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const set = await settings();

    // a test WhatsApp with sample values, to the test mobile (or, once live, to the mobile typed here)
    if (b.action === 'wa-test') {
      if (!has(u, 'demand.approve') && !has(u, 'accounts.manage') && !has(u, 'users.manage')) throw fail(403, 'Only Head CRM, Head Accounts or Admin can send a test WhatsApp.');
      const wa = require('../lib/whatsapp');
      const template = str(b.template, 100).replace(/[^A-Za-z0-9_-]/g, '') || set.waEmailTemplate;
      if (!template) throw fail(400, 'Choose the template to test.');
      const phone = live() ? str(b.mobile, 20) || set.testMobile : set.testMobile;
      if (!phone) throw fail(400, 'Set a test mobile in Letter settings first.');
      const r = await wa.send({ bookingId: null, phone, template, params: /^payment_/.test(template) ? ['Rahul Sharma', 'Rs. 4,85,000', 'A-1001', '05-Nov-2026'] : /^registration_/.test(template) ? ['Rahul Sharma', 'A-1001', '12-Nov-2026', '11:00 am at the Andheri registrar office'] : ['Rahul Sharma', 'A-1001', 'Rs. 4,85,000', '05-Nov-2026'], userId: u.id, kind: 'test', status: 'dismissed',
        document: b.withPdf ? { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', filename: 'Test_letter.pdf' } : null });
      await audit.record(db.q, { user: u, action: 'whatsapp-test', entity: 'settings', after: { template, to: r.to } });
      return res.json({ ok: true, to: r.to, id: r.id });
    }
    if (b.action === 'settings') {
      if (!has(u, 'demand.approve') && !has(u, 'accounts.manage')) throw fail(403, 'Only Head CRM, Head Accounts or Admin can change letter settings.');
      const v = { ...set };
      if (b.delayRate != null) { const r = Number(b.delayRate); if (!(r >= 0 && r <= 36)) throw fail(400, 'Delay rate: 0 to 36% a year.'); v.delayRate = r; }
      if (b.minDue != null) v.minDue = Math.max(0, Number(b.minDue) || 0);
      if (b.signedFor != null) v.signedFor = str(b.signedFor, 80) || DEFAULTS.signedFor;
      if (b.cc != null) v.cc = emails(b.cc).join(', ');
      if (b.testEmail != null) v.testEmail = emails(b.testEmail).slice(0, 1).join('');
      if (b.testMobile != null) { const m = require('../lib/comms').mobile(b.testMobile); if (b.testMobile && !m) throw fail(400, 'Test mobile: a 10-digit Indian mobile number.'); v.testMobile = m || ''; }
      if (b.waEmailTemplate != null) v.waEmailTemplate = str(b.waEmailTemplate, 100).replace(/[^A-Za-z0-9_-]/g, '') || null;
      for (const k of ['waPdfTemplate', 'waReminderTemplate', 'waReceivedTemplate', 'waRegTemplate']) if (b[k] != null) v[k] = str(b[k], 100).replace(/[^A-Za-z0-9_-]/g, '') || null;
      if (b.autoReminders != null) v.autoReminders = !!b.autoReminders;
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
        made.push(await prepareOne({ bookingId: id, type, letterDate, set, user: u, projectId }));
      }
      return res.json({ ok: true, letters: made });
    }

    const ids = (Array.isArray(b.letterIds) ? b.letterIds : []).map((x) => intOr(x)).filter(Boolean).slice(0, b.action === 'mark' ? 300 : 25);
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

    if (b.action === 'email') return res.json({ ok: true, results: await emailLetters(letters.map((l) => l.id), { set, user: u }) });
    throw fail(400, 'Unknown action.');
  },
});
