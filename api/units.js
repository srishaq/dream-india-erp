// Unit inventory. GET ?project=ID (inventory.view). POST (inventory.edit): generate, update.
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { needProject } = require('../lib/access');
const { route, fail, str, intOr } = require('../lib/http');

// Statuses staff may set by hand. Booked and registered come only from bookings.
const MANUAL = ['available', 'blocked', 'held', 'refuge', 'rehab', 'society'];

async function inventory(projectId) {
  const buildings = await db.q('select id, code, name, kind, floors from buildings where project_id = $1 order by code', [projectId]);
  const units = await db.q(
    `select u.id, u.building_id, u.unit_no, u.floor, u.typology, u.carpet_sqft, u.carpet_sqm, u.status, u.hold_note, u.sample,
            b.id as booking_id, b.status as booking_status, b.agreement_value,
            (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer,
            bb.outstanding, bb.overdue
       from units u
       left join bookings b on b.unit_id = u.id and b.status in ('pending', 'active')
       left join booking_balances bb on bb.booking_id = b.id
      where u.project_id = $1 order by u.building_id, u.floor desc nulls last, u.unit_no`, [projectId]);
  return { buildings, units };
}

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'inventory.view'); if (!u) return;
    const projectId = needProject(u, intOr(req.query.project));
    // Saleable flats and area sold for everyone who sees the inventory; the sale value and average rate only for
    // those who see the ledgers.
    const sum = await require('../lib/sales-summary').build(projectId);
    if (!require('../lib/roles').has(u, 'ledger.view')) for (const x of [sum.total, ...sum.wings]) for (const k of ['av', 'dev', 'saleValue', 'avgRate']) delete x[k];
    return res.json({ ...(await inventory(projectId)), summary: sum });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'inventory.edit'); if (!u) return;
    if (b.action === 'generate') {
      const bld = await db.one('select id, project_id, code from buildings where id = $1', [intOr(b.buildingId)]);
      if (!bld) throw fail(404, 'Building not found.');
      needProject(u, bld.project_id);
      const from = intOr(b.floorFrom), to = intOr(b.floorTo), per = intOr(b.perFloor);
      if (from == null || to == null || from < 0 || to < from || to > 150) throw fail(400, 'Floors: from and to, between 0 and 150.');
      if (!per || per < 1 || per > 40) throw fail(400, 'Units per floor: 1 to 40.');
      const typ = Array.isArray(b.typologies) ? b.typologies.map((x) => str(x, 20)) : [];
      const area = Array.isArray(b.carpetSqft) ? b.carpetSqft.map((x) => (x === '' || x == null ? null : Number(x))) : [];
      let added = 0;
      await db.tx(async (t) => {
        for (let f = from; f <= to; f++) {
          for (let n = 1; n <= per; n++) {
            const no = `${bld.code}-${f}${String(n).padStart(2, '0')}`;
            const sq = area[n - 1];
            const r = await t.q(
              `insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, carpet_sqm)
               values ($1, $2, $3, $4, $5, $6, case when $6::numeric is null then null else round($6::numeric / 10.7639, 2) end)
               on conflict (project_id, unit_no) do nothing returning id`,
              [bld.project_id, bld.id, no, f, typ[n - 1] || null, Number.isFinite(sq) ? sq : null]);
            added += r.length;
          }
        }
        await audit.record(t.q, { user: u, action: 'generate', entity: 'units', entityId: bld.id, projectId: bld.project_id, after: { building: bld.code, floorFrom: from, floorTo: to, perFloor: per, added } });
      });
      return res.json({ ok: true, added, ...(await inventory(bld.project_id)) });
    }
    if (b.action === 'update') {
      const id = intOr(b.id);
      const before = await db.one('select id, project_id, unit_no, typology, carpet_sqft, status, hold_note from units where id = $1', [id]);
      if (!before) throw fail(404, 'Unit not found.');
      needProject(u, before.project_id);
      const live = await db.one("select id from bookings where unit_id = $1 and status in ('pending', 'active')", [id]);
      let status = str(b.status, 20) || before.status;
      if (status !== before.status) {
        if (live) throw fail(400, 'This unit has a booking. Its status follows the booking.');
        if (!MANUAL.includes(status)) throw fail(400, 'Choose a valid status.');
      }
      const v = { typology: str(b.typology, 20) || null, carpet_sqft: b.carpetSqft === '' || b.carpetSqft == null ? null : Number(b.carpetSqft), status, hold_note: str(b.holdNote, 200) || null };
      if (v.carpet_sqft != null && !(v.carpet_sqft > 0 && v.carpet_sqft < 100000)) throw fail(400, 'Carpet area looks wrong.');
      await db.tx(async (t) => {
        await t.q('update units set typology = $2, carpet_sqft = $3, carpet_sqm = case when $3::numeric is null then null else round($3::numeric / 10.7639, 2) end, status = $4, hold_note = $5 where id = $1',
          [id, v.typology, v.carpet_sqft, v.status, v.hold_note]);
        await audit.record(t.q, { user: u, action: 'update', entity: 'unit', entityId: id, projectId: before.project_id, before, after: v });
      });
      return res.json({ ok: true, ...(await inventory(before.project_id)) });
    }
    throw fail(400, 'Unknown action.');
  },
});
