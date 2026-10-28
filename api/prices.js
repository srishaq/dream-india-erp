// Price lists and cost sheets.
// GET ?project=ID                         → price lists for the project
// GET ?project=ID&unsold=1[&parking=N]    → every unsold flat with its full cost from the current price list
// GET ?unit=ID[&list=ID&parking=&woman=1&discount=][&html=1] → cost sheet for an unsold unit (JSON, or a printable page)
// POST {action:'create', projectId, ...}  → a new price list (older ones stay on record); {action:'deactivate', id}
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const costsheet = require('../lib/costsheet');
const docs = require('../lib/docs');
const { has } = require('../lib/roles');
const { needProject } = require('../lib/access');
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');

const num = (v, min = 0) => { const n = Number(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n >= min ? n : NaN; };

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'inventory.view'); if (!u) return;
    const q = req.query || {};
    if (q.unit) {
      const unit = await db.one(`select u.*, bl.name as building, p.name as project, p.rera_no from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id where u.id = $1`, [intOr(q.unit)]);
      if (!unit) throw fail(404, 'Unit not found.');
      needProject(u, unit.project_id);
      const pl = await db.one(`select * from price_lists where project_id = $1 and active and ($2::int is null or id = $2) order by effective_from desc, id desc limit 1`, [unit.project_id, intOr(q.list)]);
      if (!pl) throw fail(400, 'There is no price list for this project yet. Head CRM or Management can add one on the Price list page.');
      const plan = await db.q('select s.seq, s.name, s.pct from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active order by s.seq', [unit.project_id]);
      const cs = costsheet.fromPriceList(pl, unit, { parking: intOr(q.parking, 0), woman: q.woman === '1', discount: num(q.discount) || 0 }, plan);
      if (q.html !== '1') return res.json(cs);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(docs.page(`Cost sheet ${unit.unit_no}`, [docs.costSheetHtml(cs, { unit, project: unit.project, rera: unit.rera_no, date: today(), buyer: str(q.buyer, 120) })]));
    }
    const projectId = needProject(u, intOr(q.project));
    if (q.unsold) {
      const pl = await db.one('select * from price_lists where project_id = $1 and active order by effective_from desc, id desc limit 1', [projectId]);
      if (!pl) return res.json({ priceList: null, rows: [] });
      const units = await db.q(`select u.id, u.unit_no, u.floor, u.typology, u.carpet_sqft, u.status, u.sheet_status, u.hold_note, bl.code as wing
        from units u join buildings bl on bl.id = u.building_id where u.project_id = $1 and not u.sample and u.status in ('available', 'blocked', 'held') and coalesce(bl.kind, '') <> 'rehab'
          and not exists (select 1 from bookings b where b.unit_id = u.id and b.status in ('pending', 'active')) order by bl.code, u.floor desc nulls last, u.unit_no`, [projectId]);
      const parking = Math.max(0, intOr(q.parking, 0));
      const rows = units.map((x) => {
        if (!(Number(x.carpet_sqft) > 0)) return { ...x, error: 'no carpet area' };
        const cs = costsheet.fromPriceList(pl, x, { parking });
        const rate = Number(pl.base_rate) + Number(pl.floor_rise || 0) * Math.max(0, (Number(x.floor) || 0) - (Number(pl.floor_rise_from) || 0));
        return { id: x.id, unit_no: x.unit_no, wing: x.wing, floor: x.floor, typology: x.typology, carpet_sqft: Number(x.carpet_sqft), status: x.status, held_for: x.status === 'held' ? String(x.sheet_status || x.hold_note || '').replace(/^Sheet status:\s*/i, '') : null,
          rate, agreementValue: cs.agreementValue, gst: cs.gst, stampDuty: cs.stampDuty, registration: cs.registration, others: cs.otherTotal, total: cs.total };
      });
      return res.json({ priceList: { id: pl.id, name: pl.name, effective_from: pl.effective_from, base_rate: pl.base_rate, floor_rise: pl.floor_rise, parking_price: pl.parking_price }, parking, rows });
    }
    const lists = await db.q('select l.*, x.name as created_by_name from price_lists l left join users x on x.id = l.created_by where l.project_id = $1 order by l.active desc, l.effective_from desc, l.id desc', [projectId]);
    return res.json({ lists, canEdit: has(u, 'price.manage') });
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res, 'price.manage'); if (!u) return;
    if (b.action === 'create') {
      const projectId = needProject(u, intOr(b.projectId));
      const v = { name: str(b.name, 80), effective_from: /^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom || '') ? b.effectiveFrom : today(),
        base_rate: num(b.baseRate, 1), floor_rise: num(b.floorRise || 0), floor_rise_from: intOr(b.floorRiseFrom, 0), parking_price: num(b.parkingPrice || 0),
        gst_rate: b.gstRate === '' || b.gstRate == null ? 5 : num(b.gstRate), stamp_duty_pct: b.stampDutyPct === '' || b.stampDutyPct == null ? 6 : num(b.stampDutyPct),
        stamp_duty_women_pct: b.stampDutyWomenPct === '' || b.stampDutyWomenPct == null ? 5 : num(b.stampDutyWomenPct), registration_fee: b.registrationFee === '' || b.registrationFee == null ? 30000 : num(b.registrationFee),
        notes: str(b.notes, 600) || null };
      if (!v.name) throw fail(400, 'Give the price list a name, for example "October 2026".');
      if (!Number.isFinite(v.base_rate)) throw fail(400, 'Enter the base rate per sq ft of carpet area.');
      for (const k of ['floor_rise', 'parking_price', 'gst_rate', 'stamp_duty_pct', 'stamp_duty_women_pct', 'registration_fee']) if (!Number.isFinite(v[k])) throw fail(400, 'One of the amounts looks wrong.');
      if (v.gst_rate > 28 || v.stamp_duty_pct > 15 || v.stamp_duty_women_pct > 15) throw fail(400, 'GST or stamp duty rate looks wrong.');
      const others = (Array.isArray(b.otherCharges) ? b.otherCharges : []).map((c) => ({ name: str(c.name, 80), amount: num(c.amount) })).filter((c) => c.name && c.amount > 0).slice(0, 12);
      const row = await db.tx(async (t) => {
        const r = await t.one(`insert into price_lists (project_id, name, effective_from, base_rate, floor_rise, floor_rise_from, parking_price, other_charges, gst_rate, stamp_duty_pct, stamp_duty_women_pct, registration_fee, notes, created_by)
                               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [projectId, v.name, v.effective_from, v.base_rate, v.floor_rise, v.floor_rise_from, v.parking_price, JSON.stringify(others), v.gst_rate, v.stamp_duty_pct, v.stamp_duty_women_pct, v.registration_fee, v.notes, u.id]);
        await audit.record(t.q, { user: u, action: 'create', entity: 'price-list', entityId: r.id, projectId, after: { ...v, others } });
        return r;
      });
      return res.json({ ok: true, id: row.id });
    }
    if (b.action === 'deactivate') {
      const pl = await db.one('select * from price_lists where id = $1', [intOr(b.id)]);
      if (!pl) throw fail(404, 'Price list not found.');
      needProject(u, pl.project_id);
      await db.tx(async (t) => {
        await t.q('update price_lists set active = false where id = $1', [pl.id]);
        await audit.record(t.q, { user: u, action: 'deactivate', entity: 'price-list', entityId: pl.id, projectId: pl.project_id, before: { active: true } });
      });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
