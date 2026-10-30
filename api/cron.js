// Scheduled jobs (vercel.json "crons", times in UTC):
//   /api/cron?job=bank  09:40 UTC = 3:10 pm IST  bank statements from the Drive folder (uploads by 3 pm)
//   /api/cron?job=morning 03:30 UTC = 9:00 am IST  payment reminders to buyers, the CA's monthly pack (from the 5th), the Accounts audit
//                                                  and the CRM list → Daily To-Do (Accounts audit emailed)
//   /api/cron?job=pdc   03:50 UTC = 9:20 am IST  PDC reminder emails
//   /api/cron?job=dpr   12:30 UTC = 6:00 pm IST  the site team is emailed if today's daily progress report is not in
//   /api/cron?job=summary 04:30 UTC = 10:00 am IST the 10 am summary to Admin and Management (lib/staff-alerts.js)
//   /api/cron?job=evening 14:30 UTC = 8:00 pm IST  the day reports to Head CRM, Head Accounts and Management (lib/day-report.js)
//   /api/cron?job=mail  every 5 minutes           buyers' email replies into their Communication record; automatic demand letters still to email;
//                                                  purchase requests to Management for approval, and those waiting 24 hours up to the Admin
// Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set; then nothing else may run these.
// Without CRON_SECRET a job runs only in its own hour (IST) and only once that day, so a stray call does nothing.
const ba = require('../lib/bank-auto');
const pdc = require('../lib/pdc-mail');
const dt = require('../lib/daily-tasks');
const { migrate, status } = require('../lib/migrate');
const { route, fail } = require('../lib/http');

const istHour = () => new Date(Date.now() + 5.5 * 3600000).getUTCHours();

module.exports = route({
  GET: async (req, res) => {
    const job = (req.query || {}).job;
    const secret = process.env.CRON_SECRET;
    if (secret) { if (req.headers.authorization !== `Bearer ${secret}`) throw fail(401, 'Not allowed.'); }
    else if (job !== 'mail' && !(job === 'bank' && istHour() === 15) && !((job === 'pdc' || job === 'morning') && istHour() === 9) && !(job === 'summary' && istHour() === 10) && !(job === 'evening' && istHour() === 20) && !(job === 'dpr' && istHour() === 18)) throw fail(403, 'Not the time for this job.');
    const st = await status();
    if (st.pending.length && st.applied.length) await migrate(); // a new release deployed overnight: its tables first
    if (job === 'bank') {
      if (!secret && await ba.ranToday('schedule')) return res.json({ ok: true, skipped: 'Already ran today.' });
      const r = await ba.runFromDrive({ trigger: 'schedule' });
      return res.json({ ok: true, id: r.id, added: r.added, updated: r.updated, differences: r.differences.length });
    }
    if (job === 'morning') {
      const out = {};
      out.reminders = await require('../lib/letters').reminders().catch((e) => ({ error: e.message }));
      out.caPack = await require('../lib/ca-pack').morning().catch((e) => ({ error: e.message }));
      out.cheques = await require('../lib/cheque-match').run({ trigger: 'morning' }).catch((e) => ({ error: e.message }));
      out.social = await require('../lib/social').sync({}).catch((e) => ({ error: e.message })); // yesterday's Instagram, Facebook, Meta Ads and YouTube figures
      for (const dept of ['accounts', 'crm']) {
        if (!secret && await dt.ranToday(dept)) { out[dept] = 'already ran'; continue; }
        const r = await dt.run(dept, { trigger: 'schedule' });
        out[dept] = { found: r.found.length, error: r.run.error, mail: r.run.mail };
      }
      return res.json({ ok: true, ...out });
    }
    if (job === 'dpr') return res.json({ ok: true, ...(await require('../lib/staff-alerts').dprReminder()) });
    if (job === 'summary') return res.json({ ok: true, ...(await require('../lib/staff-alerts').sendSummary({ trigger: 'schedule' })) });
    if (job === 'evening') return res.json({ ok: true, ...(await require('../lib/day-report').send({})) });
    if (job === 'pdc') {
      const r = await pdc.send({});
      return res.json({ ok: true, due: r.due.length, sent: r.sent.length, reason: r.reason || null });
    }
    if (job === 'mail') {
      const r = await require('../lib/mail-sync').sync({ trigger: 'schedule' });
      r.autoLetters = await require('../lib/letters').sendPendingAuto().catch((e) => ({ error: e.message }));
      r.approvals = await require('../lib/staff-alerts').runApprovals().catch((e) => ({ error: e.message }));
      // Click Connect: once the key is in Vercel, point its webhook at the ERP by itself (once; again if the key changes)
      r.whatsappHook = await (async () => {
        const wa = require('../lib/whatsapp'); if (!wa.ccm()) return null;
        const db = require('../lib/db'), key = 'ccm-webhook:' + wa.hookKey().slice(0, 8);
        if (await db.one('select 1 as x from job_marks where key = $1', [key])) return 'connected';
        const c = await wa.connectWebhook();
        await db.q('insert into job_marks (key, info) values ($1, $2) on conflict do nothing', [key, { at: new Date().toISOString() }]);
        await db.q("delete from job_marks where key = 'ccm-webhook-error'");
        console.log('Click Connect webhook connected');
        return c.ok ? 'connected now' : 'failed';
      })().catch(async (e) => { console.error('Click Connect webhook:', e.message);
        await require('../lib/db').q("insert into job_marks (key, info) values ('ccm-webhook-error', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [{ error: e.message }]).catch(() => {});
        return { error: e.message }; });
      return res.json(r);
    }
    throw fail(400, 'Unknown job.');
  },
});
