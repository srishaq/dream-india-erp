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
  const r = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${String(process.env.EXOTEL_API_KEY).trim()}:${String(process.env.EXOTEL_API_TOKEN).trim()}`).toString('base64'), Accept: 'application/json' } });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    const e0 = j.RestException || (j.response && j.response.error_data) || j, e = Array.isArray(e0) ? e0[0] : e0;
    const msg = (e && [e.Message || e.message, e.Description || e.description].filter(Boolean).join(': ')) || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'no answer';
    throw Object.assign(new Error(`Exotel ${r.status}: ${msg}`), { status: r.status });
  }
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
  // Exotel answers at most 31 days per request, so the range goes in 30-day windows; a run that runs out of time
  // remembers the window (and page) it got to, and the next run carries on from there.
  const WIN = 30 * 864e5;
  let winFrom = first && mark.winFrom ? new Date(mark.winFrom) : from;
  const winUrl = (a) => `${base()}/v1/Accounts/${encodeURIComponent(String(process.env.EXOTEL_SID).trim())}/Calls.json?` + new URLSearchParams({ DateCreated: `gte:${fmt(a)};lte:${fmt(new Date(Math.min(a.getTime() + WIN, now.getTime())))}`, PageSize: '100', SortBy: 'DateCreated:asc' });
  let url = first && mark.next ? mark.next : winUrl(winFrom);
  let n = 0, kept = 0, skipped = 0, done = true;
  while (url) {
    if (Date.now() - started > 80000) { done = false; break; }
    let j;
    try { j = await page(url); } catch (e) {
      // Exotel keeps only a limited history: a window older than that is "out of bounds", so skip on to the next one
      if (!(e.status === 400 && /out of bounds/i.test(e.message))) throw e;
      j = { Calls: [] }; skipped++;
    }
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
    if (nx) { url = new URL(nx, base()).href; continue; }
    winFrom = new Date(winFrom.getTime() + WIN);
    url = winFrom < now ? winUrl(winFrom) : null;
  }
  const info = { at: new Date().toISOString(), read: n, kept, ...(skipped ? { tooOldWindows: skipped } : {}), backfilled: mark.backfilled || (first && done ? new Date().toISOString() : null), next: done ? null : url, winFrom: done ? null : winFrom.toISOString() };
  await db.q("insert into job_marks (key, info) values ('exotel-sync', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [info]);
  return { ...info, more: !done };
}
async function status() { return { configured: configured(), last: (await db.one("select done_at, info from job_marks where key = 'exotel-sync'")) || null }; }

module.exports = { configured, sync, status };
