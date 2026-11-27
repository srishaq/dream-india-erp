// Sales targets (Pre-sales & Sales → Sales targets): what the project means to sell each month, in flats and in
// agreement value, for the whole project and for each salesperson, beside what was actually booked.
// A year runs April to March (the financial year). "Booked" counts bookings entered or approved (not cancelled,
// not sample data), on their booking date. A booking belongs to its salesperson (the booking form's "Sales person
// / RM"), or else to the login that entered it.
const db = require('./db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const MON = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const pad = (n) => String(n).padStart(2, '0');
// fy 2026 = April 2026 to March 2027
const months = (fy) => MON.map((_, i) => `${i < 9 ? fy : fy + 1}-${pad(((i + 3) % 12) + 1)}`);
const fyOf = (iso) => { const [y, m] = String(iso).slice(0, 7).split('-').map(Number); return m >= 4 ? y : y - 1; };
const thisFy = () => fyOf(new Date(Date.now() + 330 * 60000).toISOString());
const label = (fy) => `April ${fy} to March ${fy + 1}`;
const nm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 80);

async function view(projectId, fy) {
  const ms = months(fy), from = ms[0] + '-01', to = `${fy + 1}-04-01`;
  const t = await db.q("select to_char(month, 'YYYY-MM') as m, person, units, value from sales_targets where project_id = $1 and month >= $2 and month < $3 order by person, month", [projectId, from, to]);
  const b = await db.q(`select to_char(b.booking_date, 'YYYY-MM') as m, coalesce(nullif(trim(b.rm_name), ''), us.name, 'Not named') as person,
      count(*)::int as units, coalesce(sum(b.agreement_value), 0)::float as value
    from bookings b join units u on u.id = b.unit_id left join users us on us.id = b.created_by
    where u.project_id = $1 and b.status in ('pending', 'active') and not coalesce(u.sample, false) and b.booking_date >= $2 and b.booking_date < $3
    group by 1, 2`, [projectId, from, to]);
  const blank = () => Object.fromEntries(ms.map((m) => [m, { units: 0, value: 0 }]));
  const project = { target: blank(), actual: blank() };
  const people = {};
  const person = (name) => {
    const k = name.toLowerCase();
    return (people[k] ||= { name, target: blank(), actual: blank() });
  };
  for (const r of t) {
    const x = r.person ? person(r.person).target : project.target;
    x[r.m] = { units: r.units, value: Number(r.value) };
  }
  for (const r of b) {
    project.actual[r.m].units += r.units; project.actual[r.m].value += r.value;
    const p = person(r.person).actual[r.m]; p.units += r.units; p.value += r.value;
  }
  const sum = (o) => Object.values(o).reduce((a, x) => ({ units: a.units + x.units, value: a.value + x.value }), { units: 0, value: 0 });
  const total = (x) => ({ ...x, totalTarget: sum(x.target), totalActual: sum(x.actual) });
  // this month and the months gone: how far ahead or behind
  const now = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  const sofar = ms.filter((m) => m <= now);
  const upTo = (x) => ({ target: sofar.reduce((a, m) => a + x.target[m].units, 0), actual: sofar.reduce((a, m) => a + x.actual[m].units, 0) });
  const P = total(project);
  return {
    fy, label: label(fy), months: ms, monthNames: MON.map((n, i) => `${n} ${ms[i].slice(2, 4)}`), current: ms.includes(now) ? now : null,
    project: { ...P, upToNow: upTo(project) },
    people: Object.values(people).map((x) => ({ ...total(x), upToNow: upTo(x) })).sort((a, z) => z.totalActual.units - a.totalActual.units || a.name.localeCompare(z.name)),
  };
}

// rows: [{ person ('' = the whole project), month 'YYYY-MM', units, value }] for one year; replaces that year's targets
function check(fy, rows) {
  const ms = new Set(months(fy)), out = new Map(), problems = [];
  (rows || []).forEach((r, i) => {
    const person = nm(r.person), m = String(r.month || '');
    if (!ms.has(m)) return problems.push(`Row ${i + 1}: ${m || 'no month'} is not in ${label(fy)}.`);
    const u = r.units === '' || r.units == null ? 0 : Number(r.units), v = r.value === '' || r.value == null ? 0 : Number(r.value);
    if (!Number.isInteger(u) || u < 0 || u > 100000) return problems.push(`${person || 'Project'} ${m}: flats must be a whole number.`);
    if (!Number.isFinite(v) || v < 0 || v > 1e13) return problems.push(`${person || 'Project'} ${m}: the value must be a number in rupees.`);
    const k = person.toLowerCase() + '|' + m;
    if (out.has(k)) return problems.push(`${person || 'Project'} ${m} is there twice.`);
    out.set(k, { person, month: m, units: u, value: Math.round(v * 100) / 100 });
  });
  if (problems.length) throw Object.assign(fail(400, problems.length === 1 ? problems[0] : `${problems.length} problems. Nothing was saved.`), { extra: { problems } });
  return [...out.values()];
}

async function save(t, u, projectId, fy, rows) {
  const ok = check(fy, rows);
  const ms = months(fy);
  await t.q('delete from sales_targets where project_id = $1 and month >= $2 and month < $3', [projectId, ms[0] + '-01', `${fy + 1}-04-01`]);
  for (const r of ok) {
    if (!r.units && !r.value) continue;
    await t.q('insert into sales_targets (project_id, month, person, units, value, updated_by) values ($1, $2, $3, $4, $5, $6)', [projectId, r.month + '-01', r.person, r.units, r.value, u.id]);
  }
  return ok.filter((r) => r.units || r.value).length;
}

// The scoreboard as an Excel file: one row per salesperson, target and booked for each month.
function excel(v, projectName) {
  const head = ['Salesperson', 'What', ...v.monthNames, 'Year'];
  const rows = [head];
  const add = (name, x) => {
    rows.push([name, 'Target flats', ...v.months.map((m) => x.target[m].units), x.totalTarget.units]);
    rows.push(['', 'Booked flats', ...v.months.map((m) => x.actual[m].units), x.totalActual.units]);
    rows.push(['', 'Target value (₹)', ...v.months.map((m) => x.target[m].value), x.totalTarget.value]);
    rows.push(['', 'Booked value (₹)', ...v.months.map((m) => Math.round(x.actual[m].value)), Math.round(x.totalActual.value)]);
  };
  add('Whole project', v.project);
  for (const p of v.people) add(p.name, p);
  return require('./xlsx-write').write([{ name: 'Sales targets', rows: [[`${projectName} · sales targets · ${v.label}`], [], ...rows], widths: [24, 18, ...v.months.map(() => 11), 12] }]);
}

module.exports = { months, fyOf, thisFy, label, view, check, save, excel };
