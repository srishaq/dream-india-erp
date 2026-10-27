// Saleable inventory and the average sale rate, wing by wing (Units & inventory page and the Management dashboard).
//   Saleable flats   every flat except refuge, society and rehab flats
//   Sold             flats booked or registered (an active booking)
//   Held             flats management (or a person named in the sheet) is keeping back: not for sale now
//   Balance to sell  saleable flats open for sale (available, or a booking being entered)
//   Sale value       agreement value of the sold flats (it includes parking) + development charges (amenity and
//                    possession charges, the sheet's "Development C.")
//   Average rate     sale value ÷ carpet area sold (₹ per sq ft carpet)
const db = require('./db');

const NOT_FOR_SALE = ['refuge', 'society', 'rehab'];
const n = (v) => Number(v) || 0;
// Who a held flat is kept for, from the sheet's status ("Management", "Khalid", "Allot - Iqbal Wadiya/Management").
// Management holds are shown under the person's name ("Iqbal Wadiya/Management" → Iqbal Wadiya); Khalid is part of management.
const MANAGEMENT = ['khalid'];
const holder = (st) => {
  const x = String(st || '').replace(/^Sheet status:\s*/i, '').replace(/^allot(ted)?\s*-\s*/i, '').trim();
  const name = x.replace(/\s*\/\s*management$/i, '').trim();
  return { name: name || 'Not named', management: /management/i.test(x) || MANAGEMENT.includes(name.toLowerCase()) };
};

async function build(projectId) {
  const rows = await db.q(`select bl.code as wing, bl.name as wing_name, u.status, u.carpet_sqft, u.sheet_status, u.hold_note, u.floor, b.agreement_value, b.dev_charges
    from units u join buildings bl on bl.id = u.building_id
    left join lateral (select agreement_value, dev_charges from bookings b where b.unit_id = u.id and b.status = 'active' and not b.sample order by b.id desc limit 1) b on true
    where u.project_id = $1 and not u.sample and coalesce(bl.kind, '') <> 'rehab'`, [projectId]);
  const blank = () => ({ saleable: 0, saleableSqft: 0, sold: 0, soldSqft: 0, balance: 0, balanceSqft: 0, held: 0, heldSqft: 0, heldBy: {}, notForSale: 0, av: 0, dev: 0, saleValue: 0, avgRate: 0, soldNoArea: 0, soldNoDev: 0 });
  const W = {}, T = blank();
  for (const r of rows) {
    const w = (W[r.wing] ||= { name: r.wing_name, ...blank() });
    for (const x of [w, T]) {
      if (NOT_FOR_SALE.includes(r.status)) { x.notForSale++; continue; }
      const sq = n(r.carpet_sqft);
      x.saleable++; x.saleableSqft += sq;
      if (['booked', 'registered'].includes(r.status)) {
        x.sold++; x.soldSqft += sq; x.av += n(r.agreement_value); x.dev += n(r.dev_charges);
        if (!sq) x.soldNoArea++;
        if (r.agreement_value != null && !n(r.dev_charges)) x.soldNoDev++;
      } else if (r.status === 'held') {
        x.held++; x.heldSqft += sq;
        const hw = holder(r.sheet_status || r.hold_note), who = hw.name;
        if (hw.management) { x.heldMgmt = (x.heldMgmt || 0) + 1; }
        const h = (x.heldBy[who] ||= { flats: 0, sqft: 0, floors: new Set(), management: hw.management }); h.flats++; h.sqft += sq; if (r.floor != null) h.floors.add(r.floor);
      } else { x.balance++; x.balanceSqft += sq; }
    }
  }
  for (const x of [T, ...Object.values(W)]) {
    x.saleValue = x.av + x.dev;
    x.avgRate = x.soldSqft ? Math.round(x.saleValue / x.soldSqft) : 0;
    for (const k of ['saleableSqft', 'soldSqft', 'balanceSqft', 'heldSqft']) x[k] = Math.round(x[k]);
    x.heldMgmt = x.heldMgmt || 0;
    x.heldBy = Object.entries(x.heldBy).map(([name, h]) => ({ name, flats: h.flats, sqft: Math.round(h.sqft), management: h.management, floors: [...h.floors].sort((a, b) => b - a) })).sort((a, b) => b.flats - a.flats);
  }
  return { total: T, wings: Object.keys(W).sort().map((k) => ({ code: k, ...W[k] })) };
}

module.exports = { build, NOT_FOR_SALE };
