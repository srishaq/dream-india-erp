// Tells the CRM looking after a flat that the buyer has written (email reply or WhatsApp): a task on their own
// Daily To-Do, and an email to their own address (until the ERP is live: only to the test address in Letter
// settings). A flat with no CRM allocated goes to Head CRM. Each message is notified once.
const db = require('./db');
const mailer = require('./mailer');

const live = () => process.env.ERP_LIVE === '1';
const istDate = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const emails = (s) => String(s || '').split(/[\/,;\s]+/).filter((e) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e));

// CRM teams per wing (settings 'crm_wings': { "A": [user ids], "B": [user ids] }), set by Head CRM on the
// Communication inbox page. A flat can also have its own CRM (bookings.crm_user_id), which comes first.
async function teams() { return (await db.one("select value from settings where key = 'crm_wings'"))?.value || {}; }
async function saveTeams(v) { await db.q("insert into settings (key, value) values ('crm_wings', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(v)]); }
async function whoFor(bookingId) {
  const b = await db.one('select b.crm_user_id, u.unit_no, bl.code as wing from bookings b join units u on u.id = b.unit_id join buildings bl on bl.id = u.building_id where b.id = $1', [bookingId]);
  if (!b) return { unit: null, people: [] };
  if (b.crm_user_id) {
    const x = await db.one('select id, name, email from users where id = $1 and not disabled', [b.crm_user_id]);
    if (x) return { unit: b.unit_no, people: [x], allocated: 'flat' };
  }
  const ids = ((await teams())[b.wing] || []).map(Number).filter(Boolean);
  if (ids.length) {
    const people = await db.q('select id, name, email from users where id = any($1) and not disabled order by name', [ids]);
    if (people.length) return { unit: b.unit_no, people, allocated: 'wing' };
  }
  return { unit: b.unit_no, people: await db.q("select id, name, email from users where role = 'head_crm' and not disabled order by id"), allocated: false };
}
// Wings a login looks after (for "Mine" and the badge).
async function wingsOf(userId) { const t = await teams(); return Object.entries(t).filter(([, ids]) => (ids || []).map(Number).includes(+userId)).map(([w]) => w); }

async function notify(commId) {
  const c = await db.one("select * from communications where id = $1 and direction = 'in' and booking_id is not null and notified_at is null", [commId]);
  if (!c) return null;
  const w = await whoFor(c.booking_id);
  const what = c.channel === 'whatsapp' ? 'WhatsApp' : 'Email reply';
  const who = String(c.from_addr || 'the buyer').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || 'the buyer';
  const title = `${what} from ${who} on ${w.unit}${c.subject ? ': ' + c.subject : ''}`.slice(0, 200);
  const detail = `${String(c.body || '').slice(0, 300)}${w.allocated ? '' : '\n(No CRM team is set for this wing yet, so this came to Head CRM.)'}`;
  for (const p of w.people) {
    await db.q("insert into daily_tasks (dept, task_date, source, key, title, detail, link, priority, since, assigned_to) values ('crm', $1, 'own', $2, $3, $4, $5, 'high', $1, $6) on conflict do nothing",
      [istDate(), `comm-${c.id}-${p.id}`, title, detail, `#/booking/${c.booking_id}`, p.id]);
  }
  await db.q('update communications set notified_at = now(), notified_to = $2 where id = $1', [c.id, w.people[0] ? w.people[0].id : null]);
  // email to the CRM's own address
  if (mailer.configured()) {
    const set = (await db.one("select value from settings where key = 'letters'"))?.value || {};
    const to = live() ? [...new Set(w.people.flatMap((p) => emails(p.email)))] : emails(set.testEmail).slice(0, 1);
    if (to.length) {
      const host = process.env.ERP_URL || 'https://erp.dreamindiarealty.com';
      const text = `${what} from ${who} on flat ${w.unit}.\n\n${c.subject ? 'Subject: ' + c.subject + '\n\n' : ''}${String(c.body || '').slice(0, 1500)}\n\nOpen the buyer's record to reply: ${host}/#/booking/${c.booking_id}\n\nDream India ERP`;
      try { const cn = await mailer.connect(); try { await cn.send({ to, subject: `${live() ? '' : '[TEST] '}${what} on ${w.unit} – ${who}`.slice(0, 180), text, fromName: 'Dream India ERP' }); } finally { await cn.close(); } }
      catch (e) { console.error('comms-notify mail', e.message); }
    }
  }
  return { to: w.people.map((p) => p.name), allocated: w.allocated };
}

module.exports = { notify, whoFor, teams, saveTeams, wingsOf };
