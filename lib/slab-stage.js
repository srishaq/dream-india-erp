// When site marks a slab as cast and that slab is a stage of the payment plan (Plinth, 5th, 10th … 35th, Top Slab),
// Head CRM is told at once: a Daily To-Do (high priority) and an email to Head CRM and Management, to get the
// architect's certificate, record the stage and raise the demands. The stage itself is still recorded by hand
// (it needs the certificate), on the Demands page.
const db = require('./db');
const kv = require('./portal/kv');

const BUILDING = { a: 'A', b: 'B', rehab: 'REHAB' };
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MN[+m - 1]} ${y}`; };

// The payment stage a slab completes, by its name in the slab schedule; the last slab of a tower is the Top Slab.
function stageFor(tower, slab) {
  const slabs = [...(tower.slabs || [])].sort((a, b) => a.seq - b.seq);
  if (/^plinth/i.test(slab.name)) return 'On Completion of Plinth';
  if (slabs.length && slabs[slabs.length - 1].id === slab.id) return 'On Completion of Top Slab';
  const m = String(slab.name).match(/^(\d+)(st|nd|rd|th)\s+slab/i);
  return m ? `On Completion of ${m[1]}${m[2].toLowerCase()} Slab` : null;
}

async function onCast({ slabId, date, by }) {
  const towers = await kv.hgetall('site:towers');
  const tower = Object.values(towers).find((t) => t && (t.slabs || []).some((s) => s.id === slabId));
  if (!tower) return { skipped: 'slab not in the schedule' };
  const slab = tower.slabs.find((s) => s.id === slabId);
  const want = stageFor(tower, slab);
  if (!want) return { skipped: 'not a payment stage' };
  const code = BUILDING[tower.key] || String(tower.key || '').toUpperCase();
  const bld = await db.one("select b.id, b.name, b.kind, b.project_id from buildings b join projects p on p.id = b.project_id where p.code = 'SIGNATURE' and upper(b.code) = $1", [code]);
  if (!bld) return { skipped: 'building not in the ERP' };
  if (bld.kind === 'rehab') return { skipped: 'rehab tower: no buyers' };
  const stage = await db.one(`select s.name from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active and s.construction_linked and lower(s.name) = lower($2) limit 1`, [bld.project_id, want]);
  if (!stage) return { skipped: 'no such stage in the payment plan' };
  if (await db.one('select 1 as x from stage_completions where building_id = $1 and stage_name = $2', [bld.id, stage.name])) return { skipped: 'stage already recorded' };
  const sold = await db.one("select count(*)::int as n from bookings k join units u on u.id = k.unit_id where u.building_id = $1 and k.status = 'active'", [bld.id]);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const head = await db.one("select id from users where role = 'head_crm' and not disabled order by id limit 1");
  const key = `slab-stage:${bld.id}:${stage.name}`;
  const title = `${bld.name}: ${slab.name} cast on ${fmtD(date)}. Raise the "${stage.name}" demands`;
  const detail = `Site marked ${slab.name} of ${tower.name} as cast. Get the architect's certificate, record the stage on the Demands page and raise the demands for ${sold.n} booked flat${sold.n === 1 ? '' : 's'}.`;
  const t = await db.one(`insert into daily_tasks (dept, task_date, source, key, title, detail, link, priority, since, assigned_to) values ('crm', $1, 'own', $2, $3, $4, '#/demands', 'high', $5, $6)
    on conflict do nothing returning id`, [today, key, title, detail, date, head ? head.id : null]);
  if (!t) return { skipped: 'already told today' };
  // DreamComm: Site sees the milestone, CRM is told to raise the demands
  const chat = require('./chat');
  await chat.system('dept:site', '', { title: `🎉 ${slab.name} cast: ${tower.name}`, tone: 'ok', lines: [`Cast on ${fmtD(date)}${by ? ' · marked by ' + by : ''}`] });
  await chat.system('dept:crm', '', { title, tone: 'warn', lines: [detail], link: { label: 'Open Demands', href: '/#/demands' } });
  // email Head CRM and Management (test version: the test address only)
  const people = await db.q("select email from users where not disabled and role in ('head_crm', 'management', 'admin') and email is not null");
  const mail = await require('./staff-alerts').email({ to: people.map((p) => p.email), subject: title, text: `${detail}\n\nSlab cast by ${by || 'site'}.`, html: `<p style="font-family:Arial,sans-serif;font-size:15px">${detail.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` }).catch((e) => ({ sent: false, reason: e.message }));
  return { stage: stage.name, building: bld.name, task: t.id, mail };
}

module.exports = { onCast, stageFor };
