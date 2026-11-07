// Cost sheet: what a unit costs the buyer, from the project's price list (or from a booking's own figures),
// with the stage-wise payment schedule. All amounts are whole rupees.

const r0 = (x) => Math.round(Number(x) || 0);
const up100 = (x) => Math.ceil((Number(x) || 0) / 100) * 100; // Maharashtra stamp duty is rounded up to the next ₹100

// Registration fee in Maharashtra: 1% of the agreement value, capped at ₹30,000.
const regFee = (av, cap) => Math.min(r0(av * 0.01), r0(cap || 30000));

/**
 * From a price list. unit: { unit_no, floor, carpet_sqft, typology }.
 * opts: { parking (spaces), woman (first buyer is a woman), discount (₹ per sq ft) }.
 */
function fromPriceList(pl, unit, opts = {}, plan = []) {
  const sqft = Number(unit.carpet_sqft) || 0;
  if (!(sqft > 0)) throw Object.assign(new Error(`Unit ${unit.unit_no} has no carpet area, so no cost sheet can be made.`), { status: 400 });
  const floors = Math.max(0, (Number(unit.floor) || 0) - (Number(pl.floor_rise_from) || 0));
  const base = typeRate(pl.rates, unit.typology) || Number(pl.base_rate);
  const rate = base + Number(pl.floor_rise || 0) * floors;
  const discount = Math.max(0, Number(opts.discount) || 0);
  const parking = Math.max(0, Math.round(Number(opts.parking) || 0));
  const flat = r0(sqft * (rate - discount));
  const parkingAmt = r0(parking * Number(pl.parking_price || 0));
  const av = flat + parkingAmt;
  return build({
    unit, av, gstRate: Number(pl.gst_rate), sdPct: Number(opts.woman ? pl.stamp_duty_women_pct : pl.stamp_duty_pct), regCap: Number(pl.registration_fee),
    others: otherCharges(pl, sqft),
    lines: [
      { label: `Carpet area ${sqft} sq ft × ₹${fmt(rate)}${floors && pl.floor_rise ? ` (base ₹${fmt(base)} + floor rise ₹${fmt(pl.floor_rise)} × ${floors})` : ''}`, amount: r0(sqft * rate) },
      ...(discount ? [{ label: `Discount ₹${fmt(discount)} per sq ft`, amount: -r0(sqft * discount) }] : []),
      ...(parking ? [{ label: `Parking: ${parking} × ₹${fmt(pl.parking_price)}`, amount: parkingAmt }] : []),
    ],
    priceList: { id: pl.id, name: pl.name, effective_from: pl.effective_from }, woman: !!opts.woman, plan,
  });
}

// A rate for the flat's type ("1BHK", "1 BHK" and "1bhk" are the same type); 0 when the list has none for it.
const typeKey = (t) => String(t || '').replace(/\s+/g, '').toUpperCase();
function typeRate(rates, typology) {
  if (!rates || !typology) return 0;
  const k = typeKey(typology), hit = Object.entries(rates).find(([t]) => typeKey(t) === k);
  return hit ? Number(hit[1]) || 0 : 0;
}
// Other charges: a fixed amount or so much per sq ft; GST on them (other_gst_pct) unless an item says gst: false.
function otherCharges(pl, sqft) {
  const list = (pl.other_charges || []).filter((c) => c && c.name && (Number(c.amount) > 0 || Number(c.per_sqft) > 0))
    .map((c) => ({ name: String(c.name), amount: r0(Number(c.per_sqft) > 0 ? sqft * Number(c.per_sqft) : c.amount), gst: c.gst !== false }));
  const pct = Number(pl.other_gst_pct) || 0;
  const taxable = list.filter((c) => c.gst).reduce((a, c) => a + c.amount, 0);
  const out = list.map(({ name, amount }) => ({ name, amount }));
  if (pct > 0 && taxable > 0) out.push({ name: `GST ${pct}% on other charges`, amount: r0((taxable * pct) / 100) });
  return out;
}

// From a booking's own figures (agreement value, GST rate, actual stamp duty and registration fee when known).
function fromBooking(b, unit, plan = []) {
  const av = r0(b.agreement_value);
  return build({ unit, av, gstRate: Number(b.gst_rate), sdPct: 6, regCap: 30000, others: [], lines: [{ label: 'Agreement value', amount: av }],
    stampDuty: b.stamp_duty != null ? r0(b.stamp_duty) : null, registration: b.registration_fee != null ? r0(b.registration_fee) : null, plan, booking: true });
}

function build({ unit, av, gstRate, sdPct, regCap, others, lines, stampDuty = null, registration = null, plan, priceList = null, woman = false, booking = false }) {
  const gst = r0((av * gstRate) / 100);
  const sd = stampDuty != null ? stampDuty : up100((av * sdPct) / 100);
  const reg = registration != null ? registration : regFee(av, regCap);
  const otherTotal = others.reduce((a, c) => a + c.amount, 0);
  const tds = av >= 5000000 ? r0(av / 100) : 0;
  // Each stage rounded to the rupee; when the plan adds up to 100%, the last stage takes the rounding
  // difference so the schedule totals exactly the agreement value and the GST.
  let cum = 0, amtSum = 0, gstSum = 0;
  const full = Math.abs(plan.reduce((a, s) => a + Number(s.pct), 0) - 100) < 0.001;
  const schedule = plan.map((s, i) => {
    let amt = r0((av * Number(s.pct)) / 100), g = r0((amt * gstRate) / 100);
    if (full && i === plan.length - 1) { amt = av - amtSum; g = gst - gstSum; }
    amtSum += amt; gstSum += g; cum += Number(s.pct);
    return { seq: s.seq, stage: s.name, pct: Number(s.pct), amount: amt, gst: g, total: amt + g, cumPct: cum };
  });
  return {
    unit: { unit_no: unit.unit_no, floor: unit.floor, typology: unit.typology, carpet_sqft: Number(unit.carpet_sqft) || null },
    lines, agreementValue: av, gstRate, gst, stampDutyPct: sdPct, stampDuty: sd, registration: reg, others, otherTotal,
    total: av + gst + sd + reg + otherTotal, tds, schedule, priceList, woman, booking,
  };
}

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

module.exports = { fromPriceList, fromBooking, regFee, up100, typeRate };
