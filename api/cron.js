// Scheduled jobs (vercel.json "crons", times in UTC):
//   /api/cron?job=bank  08:30 and 13:30 UTC = 2 pm and 7 pm IST (2 pm from 16 Nov 2026: statements arrive ~12:30)  bank statements from the Drive folder (staff upload
//                       the morning statements by 1:45 pm and the end-of-day ones by 6:30 pm; a second run adds only what is new)
//   /api/cron?job=morning 03:30 UTC = 9:00 am IST  payment reminders to buyers, the CA's monthly pack (from the 5th), the Accounts audit
//                                                  and the CRM list → Daily To-Do (Accounts audit emailed)
//   /api/cron?job=pdc   03:50 UTC = 9:20 am IST  PDC reminder emails
//   /api/cron?job=dpr   12:30 UTC = 6:00 pm IST  the site team is emailed if today's daily progress report is not in
//   /api/cron?job=summary 04:30 UTC = 10:00 am IST the 10 am summary to Admin and Management (lib/staff-alerts.js)
//   (morning also copies new files from the Signature CRM's Drive folder onto their flats: lib/custdocs-import.js)
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
    else if (job !== 'mail' && job !== 'agents' && !(job === 'mkt' && istHour() === 9) && !(job === 'backup' && istHour() === 2) && !(job === 'bank' && [14, 19].includes(istHour())) && !((job === 'pdc' || job === 'morning') && istHour() === 9) && !(job === 'summary' && istHour() === 10) && !(job === 'evening' && istHour() === 20) && !(job === 'dpr' && istHour() === 18)) throw fail(403, 'Not the time for this job.');
    const st = await status();
    if (st.pending.length && st.applied.length) await migrate(); // a new release deployed overnight: its tables first
    if (job === 'bank') {
      if (await ba.ranWithin('schedule', 120)) return res.json({ ok: true, skipped: 'Already ran in this slot.' }); // 2 pm and 7 pm: once each
      const r = await ba.runFromDrive({ trigger: 'schedule' });
      // Dream Aspire's own books, from its statements (Dream India Builders)
      const a = await require('../lib/book').run('aspire', () => ba.runFromDrive({ trigger: 'schedule' })).catch((e) => ({ error: e.message }));
      return res.json({ ok: true, id: r.id, added: r.added, updated: r.updated, differences: r.differences.length, aspire: a.error ? { error: a.error } : { id: a.id, added: a.added, tagged: a.tagged } });
    }
    if (job === 'morning') {
      const out = {};
      out.reminders = await require('../lib/letters').reminders().catch((e) => ({ error: e.message }));
      out.caPack = await require('../lib/ca-pack').morning().catch((e) => ({ error: e.message }));
      out.reraPack = await require('../lib/rera').morning().catch((e) => ({ error: e.message })); // the quarter's MahaRERA figures to the CA, from the 3rd
      out.cheques = await require('../lib/cheque-match').run({ trigger: 'morning' }).catch((e) => ({ error: e.message }));
      // new flat files each project's CRM put in its shared Drive folder (Signature, Aspire), onto their flats in Customer documents
      out.crmDocs = await (async () => {
        const db = require('../lib/db');
        if (!(await require('../lib/gdrive').status()).connected) return { skipped: 'Drive not connected' };
        const I = require('../lib/custdocs-import'), o = {};
        for (const p of await db.q('select id, code from projects where active and code = any($1)', [Object.keys(I.FOLDERS())])) {
          const r = await I.run(p.id, null, 45000);
          o[p.code] = { imported: r.imported.length, failed: r.failed.length, left: r.left, noFlat: r.noFlat.length, noBooking: r.noBooking.length };
        }
        return o;
      })().catch((e) => ({ error: e.message }));
      out.autoClear = await (async () => { const db = require('../lib/db'); const sys = await db.one("select * from users where role = 'admin' and not disabled order by id limit 1"); const out2 = {}; for (const p of await db.q("select id from projects where active")) out2[p.id] = (await require('../lib/auto-clear').run({ projectId: p.id, user: sys, dry: false })).closedTotal; return out2; })().catch((e) => ({ error: e.message })); // Data to verify items that need nobody
      // each project's own lists (Dream Signature and Dream Aspire apart)
      for (const p of await dt.projects()) for (const dept of ['accounts', 'crm']) {
        const k = `${dept}:${p.code}`;
        if (!secret && await dt.ranToday(dept, undefined, p.id)) { out[k] = 'already ran'; continue; }
        const r = await dt.run(dept, { trigger: 'schedule', projectId: p.id }).catch((e) => ({ run: { error: e.message }, found: [] }));
        out[k] = { found: r.found.length, error: r.run.error, mail: r.run.mail };
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
      await require('../lib/accounts').pdcSettle().catch(() => null); // a cheque already debited is cleared: no reminder for it
      const r = await pdc.send({});
      return res.json({ ok: true, due: r.due.length, sent: r.sent.length, reason: r.reason || null });
    }
    if (job === 'mail') {
      const rot = await require('../lib/auth').rotateSecretOnce('2026-11-12').catch((e) => ({ error: e.message })); // once: backups up to 12 Nov held the old login secret
      const r = await require('../lib/mail-sync').sync({ trigger: 'schedule' });
      if (rot && !rot.skipped) r.secret = rot;
      r.bounces = await require('../lib/tally-bounce').run().then((x) => x.paired).catch((e) => ({ error: e.message })); // Tally cheque returns paired with their receipts
      r.autoLetters = await require('../lib/letters').sendPendingAuto().catch((e) => ({ error: e.message }));
      r.preDemand = await require('../lib/predemand').sendPending().catch((e) => ({ error: e.message })); // pre-demand notices still to email
      r.approvals = await require('../lib/staff-alerts').runApprovals().catch((e) => ({ error: e.message }));
      r.postApprovals = await require('../lib/mkt-flow').approvalsDue().catch((e) => ({ error: e.message })); // posts in review: one-tap approval to Management
      r.socialPosts = await require('../lib/mkt-flow').publishDue().catch((e) => ({ error: e.message })); // approved posts that are due: Instagram and Facebook
      r.website = await require('./marketing').webAggregate().catch((e) => ({ error: e.message })); // today's website visits into the figures
      r.leadsOverdue = await require('../lib/mkt-leads').overdue({}).catch((e) => ({ error: e.message })); // new leads nobody called for 2 hours
      r.leadStages = await require('../lib/mkt-leads').capi({}).catch((e) => ({ error: e.message })); // lead stages back to Meta
      r.tmCampaigns = await require('../lib/tm-campaigns').tick().catch((e) => ({ error: e.message })); // the next batch of SMS / AI calls (within the hours)
      // the 8 pm day reports, when their own 8 pm run did not happen (Vercel skipped it or cut it short, as on 20 Nov):
      // yesterday's is sent by the next 5-minute run, today's from 8:15 pm; once each (a lock stops two runs sending together)
      r.dayReport = await (async () => {
        const db = require('../lib/db'), ist = new Date(Date.now() + 5.5 * 3600000);
        const today = ist.toISOString().slice(0, 10), yest = new Date(ist.getTime() - 86400000).toISOString().slice(0, 10);
        const due = [yest];
        if (ist.getUTCHours() > 20 || (ist.getUTCHours() === 20 && ist.getUTCMinutes() >= 15)) due.push(today);
        for (const d of due) {
          if (d < '2026-11-20') continue; // nothing older than the first miss
          if (await db.one('select 1 as x from job_marks where key = $1', ['day-report:' + d])) continue;
          const lock = await db.one("insert into job_marks (key, info) values ($1, '{}') on conflict do nothing returning key", ['day-report-lock:' + d]);
          if (!lock) continue;
          const t0 = Date.now();
          try {
            const out = await require('../lib/day-report').send({ d });
            if (!out.skipped) await require('../lib/watchdog').record('evening', true, { ok: true, catchUp: d, ...out }, null, Date.now() - t0);
            return { catchUp: d, ...out };
          } catch (e) { await db.q('delete from job_marks where key = $1', ['day-report-lock:' + d]); return { error: e.message }; }
        }
        return null;
      })().catch((e) => ({ error: e.message }));
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
