// Exotel call history into Marketing → IVR calls: every inbound call to our ExoPhone(s), with status, duration and
// recording, read from Exotel's Call Details API. The first pull goes back 12 months (in parts, if there are many calls),
// then every night the last 2 days. Live calls also come in through the Passthru link (api/marketing.js ?ivr=).
// Env: EXOTEL_SID (account SID), EXOTEL_API_KEY, EXOTEL_API_TOKEN (Exotel → Settings → API), optional EXOTEL_SUBDOMAIN
// (api.exotel.com for the Singapore cluster, api.in.exotel.com for Mumbai; default api.exotel.com) and EXOTEL_NUMBERS
// (our ExoPhones, comma separated, to keep only calls to them). Tests: EXOTEL_API (a full base URL).
const db = require('./db');

const configured = () => !!(process.env.EXOTEL_SID && process.env.EXOTEL_API_KEY && process.env.EXOTEL_API_TOKEN);
const base = () => (process.env.EXOTEL_API || `https://${process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'}`).replace(/\/+$/, '');
const ten = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; };
const fmt = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); // Exotel times are IST

async function page(url) {
  const r = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`).toString('base64'), Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Exotel ${r.status}: ${(j.RestException && j.RestException.Message) || j.message || 'no answer'}`), { status: r.status });
  return j;
}

// Pull calls from `from` to now; stops after ~80 seconds and remembers where it got to (the next run carries on).
async function sync({ full = false } = {}) {
  if (!configured()) return { skipped: 'Exotel is not connected: add EXOTEL_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN in Vercel.' };
  const mk = require('../api/marketing'), set = await mk.settings();
  const mark = (await db.one("select info from job_marks where key = 'exotel-sync'"))?.info || {};
  const ours = String(process.env.EXOTEL_NUMBERS || '').split(/[,\s]+/).map(ten).filter(Boolean);
  const started = Date.now(), now = new Date();
  const first = full || !mark.backfilled;
  const from = first ? new Date(now.getTime() - 365 * 864e5) : new Date(now.getTime() - 2 * 864e5);
  let url = first && mark.next ? mark.next : `${base()}/v1/Accounts/${encodeURIComponent(process.env.EXOTEL_SID)}/Calls.json?` + new URLSearchParams({ DateCreated: `gte:${fmt(from)};lte:${fmt(now)}`, PageSize: '100', SortBy: 'DateCreated:asc' });
  let n = 0, kept = 0, done = true;
  while (url) {
    if (Date.now() - started > 80000) { done = false; break; }
    const j = await page(url);
    const calls = j.Calls || (j.Call ? [].concat(j.Call) : []);
    for (const c of calls) {
      n++;
      const dir = String(c.Direction || '').toLowerCase();
      if (dir && !/inbound|incoming/.test(dir)) continue;
      const to = ten(c.To || c.PhoneNumber), caller = ten(c.From);
      if (!caller || caller.length !== 10 || (ours.length && !ours.includes(to))) continue;
      const at = new Date(String(c.StartTime || c.DateCreated || '').replace(' ', 'T') + '+05:30');
      await mk.recordIvrCall({ sid: c.Sid, caller, ivrNo: to || null, at: isNaN(at) ? new Date() : at, status: c.Status || null, duration: parseInt(c.Duration, 10) || null, rec: c.RecordingUrl || null, digits: null, raw: c }, set, { backfill: true });
      kept++;
    }
    const nx = j.Metadata && j.Metadata.NextPageUri;
    url = nx ? new URL(nx, base()).href : null;
  }
  const info = { at: new Date().toISOString(), read: n, kept, backfilled: mark.backfilled || (first && done ? new Date().toISOString() : null), next: done ? null : url };
  await db.q("insert into job_marks (key, info) values ('exotel-sync', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [info]);
  return { ...info, more: !done };
}
async function status() { return { configured: configured(), last: (await db.one("select done_at, info from job_marks where key = 'exotel-sync'")) || null }; }

module.exports = { configured, sync, status };
