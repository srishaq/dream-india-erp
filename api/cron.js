// Scheduled jobs (vercel.json "crons", times in UTC):
//   /api/cron?job=bank  06:30 and 13:30 UTC = 12 noon and 7 pm IST  bank statements from the Drive folder (staff upload
//                       the morning statements 11–11:45 am and the end-of-day ones by 6:30 pm; a second run adds only what is new)
//   /api/cron?job=morning 03:30 UTC = 9:00 am IST  payment reminders to buyers, the CA's monthly pack (from the 5th), the Accounts audit
//                                                  and the CRM list → Daily To-Do (Accounts audit emailed)
//   /api/cron?job=pdc   03:50 UTC = 9:20 am IST  PDC reminder emails
//   /api/cron?job=dpr   12:30 UTC = 6:00 pm IST  the site team is emailed if today's daily progress report is not in
//   /api/cron?job=summary 04:30 UTC = 10:00 am IST the 10 am summary to Admin and Management (lib/staff-alerts.js)
//   /api/cron?job=evening 14:30 UTC = 8:00 pm IST  the day reports to Head CRM, Head Accounts and Management (lib/day-report.js)
//   /api/cron?job=agents every 10 minutes          the AI marketing agent team: comment-to-DM funnels, comment notes, the Orchestrator
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

// Every run leaves its result for the watchdog (lib/watchdog.js), which emails the Admin when a job fails or stops.
module.exports = route({
  GET: async (req, res) => {
    const job = (req.query || {}).job, W = require('../lib/watchdog'), t0 = Date.now();
    const send = res.json.bind(res); let body;
    res.json = (b) => { body = b; return res; };
    try { await run(req, res, job); }
    catch (e) { if (e.status !== 401 && e.status !== 403) await W.record(job, false, null, e.message, Date.now() - t0); res.json = send; throw e; }
    res.json = send;
    await W.record(job, true, body, null, Date.now() - t0);
    if (job === 'mail' || job === 'morning') body = { ...body, watchdog: await W.check().catch((e) => ({ error: e.message })) };
    return send(body);
  },
});
async function run(req, res, job) {
  {
    const secret = process.env.CRON_SECRET;
    if (secret) { if (req.headers.authorization !== `Bearer ${secret}`) throw fail(401, 'Not allowed.'); }
    // No CRON_SECRET in Vercel yet: only Vercel's own scheduler, and only at each job's hour (a stopgap; add CRON_SECRET)
    else if (!/^vercel-cron\//.test(String(req.headers['user-agent'] || ''))) throw fail(403, 'Not allowed.');
    else if (job !== 'mail' && job !== 'agents' && !(job === 'mkt' && istHour() === 9) && !(job === 'backup' && istHour() === 2) && !(job === 'bank' && [12, 19].includes(istHour())) && !((job === 'pdc' || job === 'morning') && istHour() === 9) && !(job === 'summary' && istHour() === 10) && !(job === 'evening' && istHour() === 20) && !(job === 'dpr' && istHour() === 18)) throw fail(403, 'Not the time for this job.');
    const st = await status();
    if (st.pending.length && st.applied.length) await migrate(); // a new release deployed overnight: its tables first
    if (job === 'bank') {
      if (await ba.ranWithin('schedule', 120)) return res.json({ ok: true, skipped: 'Already ran in this slot.' }); // noon and 7 pm: once each
      const r = await ba.runFromDrive({ trigger: 'schedule' });
      return res.json({ ok: true, id: r.id, added: r.added, updated: r.updated, differences: r.differences.length });
    }
    if (job === 'morning') {
      const out = {};
      out.reminders = await require('../lib/letters').reminders().catch((e) => ({ error: e.message }));
      out.caPack = await require('../lib/ca-pack').morning().catch((e) => ({ error: e.message }));
      out.cheques = await require('../lib/cheque-match').run({ trigger: 'morning' }).catch((e) => ({ error: e.message }));
      out.autoClear = await (async () => { const db = require('../lib/db'); const sys = await db.one("select * from users where role = 'admin' and not disabled order by id limit 1"); const out2 = {}; for (const p of await db.q("select id from projects where active")) out2[p.id] = (await require('../lib/auto-clear').run({ projectId: p.id, user: sys, dry: false })).closedTotal; return out2; })().catch((e) => ({ error: e.message })); // Data to verify items that need nobody
      for (const dept of ['accounts', 'crm']) {
        if (!secret && await dt.ranToday(dept)) { out[dept] = 'already ran'; continue; }
        const r = await dt.run(dept, { trigger: 'schedule' });
        out[dept] = { found: r.found.length, error: r.run.error, mail: r.run.mail };
      }
      return res.json({ ok: true, ...out });
    }
    if (job === 'mkt') { // the marketing syncs, on their own run so a slow Exotel or Meta day never stops the 9 am To-Do
      const out = {};
      out.exotel = await require('../lib/exotel').sync({}).catch((e) => ({ error: e.message })); // yesterday's IVR calls (and the 12-month history, part by part)
      out.social = await require('../lib/social').sync({}).catch((e) => ({ error: e.message })); // yesterday's Instagram, Facebook, Meta Ads and YouTube figures
      out.gads = await require('../lib/gads').sync({}).catch((e) => ({ error: e.message })); // Google Ads, when connected
      out.website = await require('./marketing').webAggregate().catch((e) => ({ error: e.message })); // website visits into the daily and monthly figures
      out.botSite = await require('../lib/web-bot').siteKnowledge({ refresh: true }).then((p) => ({ pages: Object.keys(p).length })).catch((e) => ({ error: e.message })); // the website's text for the chat assistant
      out.mktAlerts = await require('../lib/mkt-money').alerts({}).catch((e) => ({ error: e.message })); // over budget, cost per lead up, tiring ads
      out.mktDigest = await require('../lib/mkt-money').digest({}).catch((e) => ({ error: e.message })); // Mondays: last week in Marketing
      return res.json({ ok: true, ...out });
    }
    if (job === 'agents') { // every 10 minutes: flats held by sales whose 72 hours ran out are free again; then the AI marketing agent team
      const holds = await require('../lib/mkt-offers').releaseHolds().catch((e) => ({ error: e.message }));
      return res.json({ ok: true, holds, ...(await require('../lib/agents').tick()) });
    }
    if (job === 'backup') return res.json({ ok: true, ...(await require('../lib/backup').run({ trigger: 'schedule' })) }); // the nightly backup to Google Drive
    if (job === 'dpr') return res.json({ ok: true, ...(await require('../lib/staff-alerts').dprReminder()) });
    if (job === 'summary') return res.json({ ok: true, ...(await require('../lib/staff-alerts').sendSummary({ trigger: 'schedule' })) });
    if (job === 'evening') return res.json({ ok: true, ...(await require('../lib/day-report').send({})) });
    if (job === 'pdc') {
      const r = await pdc.send({});
      return res.json({ ok: true, due: r.due.length, sent: r.sent.length, reason: r.reason || null });
    }
    if (job === 'mail') {
      const rot = await require('../lib/auth').rotateSecretOnce('2026-11-12').catch((e) => ({ error: e.message })); // once: backups up to 12 Nov held the old login secret
      const r = await require('../lib/mail-sync').sync({ trigger: 'schedule' });
      if (rot && !rot.skipped) r.secret = rot;
      r.autoLetters = await require('../lib/letters').sendPendingAuto().catch((e) => ({ error: e.message }));
      r.preDemand = await require('../lib/predemand').sendPending().catch((e) => ({ error: e.message })); // pre-demand notices still to email
      r.approvals = await require('../lib/staff-alerts').runApprovals().catch((e) => ({ error: e.message }));
      r.socialPosts = await require('../lib/mkt-flow').publishDue().catch((e) => ({ error: e.message })); // approved posts that are due: Instagram and Facebook
      r.website = await require('./marketing').webAggregate().catch((e) => ({ error: e.message })); // today's website visits into the figures
      r.leadsOverdue = await require('../lib/mkt-leads').overdue({}).catch((e) => ({ error: e.message })); // new leads nobody called for 2 hours
      r.leadStages = await require('../lib/mkt-leads').capi({}).catch((e) => ({ error: e.message })); // lead stages back to Meta
      r.tmCampaigns = await require('../lib/tm-campaigns').tick().catch((e) => ({ error: e.message })); // the next batch of SMS / AI calls (within the hours)
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
  }
}
