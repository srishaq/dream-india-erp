// Scheduled jobs (vercel.json "crons", times in UTC):
//   /api/cron?job=bank  09:40 UTC = 3:10 pm IST  bank statements from the Drive folder (uploads by 3 pm)
//   /api/cron?job=morning 03:30 UTC = 9:00 am IST  the Accounts audit and the CRM list → Daily To-Do (Accounts audit emailed)
//   /api/cron?job=pdc   03:50 UTC = 9:20 am IST  PDC reminder emails
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
    else if (!(job === 'bank' && istHour() === 15) && !((job === 'pdc' || job === 'morning') && istHour() === 9)) throw fail(403, 'Not the time for this job.');
    const st = await status();
    if (st.pending.length && st.applied.length) await migrate(); // a new release deployed overnight: its tables first
    if (job === 'bank') {
      if (!secret && await ba.ranToday('schedule')) return res.json({ ok: true, skipped: 'Already ran today.' });
      const r = await ba.runFromDrive({ trigger: 'schedule' });
      return res.json({ ok: true, id: r.id, added: r.added, updated: r.updated, differences: r.differences.length });
    }
    if (job === 'morning') {
      const out = {};
      for (const dept of ['accounts', 'crm']) {
        if (!secret && await dt.ranToday(dept)) { out[dept] = 'already ran'; continue; }
        const r = await dt.run(dept, { trigger: 'schedule' });
        out[dept] = { found: r.found.length, error: r.run.error, mail: r.run.mail };
      }
      return res.json({ ok: true, ...out });
    }
    if (job === 'pdc') {
      const r = await pdc.send({});
      return res.json({ ok: true, due: r.due.length, sent: r.sent.length, reason: r.reason || null });
    }
    throw fail(400, 'Unknown job.');
  },
});
