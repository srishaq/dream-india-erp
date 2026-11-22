// Builds lib/portal/boq-structure.json, the live BOQ for Dream Signature's structure, from the structural engineer's
// "Grade and Dia-wise Breakup of Structural Element Quantities" workbook (Bilal, 16 Nov 2026).
//   node scripts/build-boq.js <workbook.xlsx>
// The three wings (Sale A, B and Rehab) are one structure, so the BOQ is one combined structure, floor by floor
// (Rafi Sir, 22 Nov 2026: not split by wing; this replaces the 22 Jun 2026 budget). Each floor line carries concrete by
// grade (m³) and steel by bar size (MT), with wastage (concrete 1.5%, steel 5%, as the old budget). Old request lines
// (Sale / Rehab floor lines of the 22 Jun budget) map onto the new floor lines so their quantities still count.
const fs = require('fs');
const path = require('path');
const xlsx = require('../lib/xlsx');

const file = process.argv[2];
if (!file) { console.error('node scripts/build-boq.js <workbook.xlsx>'); process.exit(1); }
const rows = xlsx.read(fs.readFileSync(file))[0].rows;
const GRADES = ['M60', 'M50', 'M45', 'M40', 'M35', 'M30'];
const DIAS = ['8', '10', '12', '16', '20', '25', '32'];
const WASTE = { rmc: 0.015, steel: 0.05 };
const n = (v) => (v == null || v === '' || !Number.isFinite(+v) ? 0 : +v);
const r3 = (v) => Math.round(v * 1000) / 1000;

// Bilal's row label → the combined floor line
const RAMP = { 'ground to 1st landing': 1, '1st to 2nd landing': 2, '2nd to 3rd landing': 3, '3rd to 4th landing': 4, '5th to 6th floor': 6, '6th to 7th floor': 7, '7th to 8th floor': 8 };
function floorOf(label) {
  const s = String(label).trim(), l = s.toLowerCase().replace(/\s+/g, ' ');
  if (/raft|retaining wall|tank walls|ug tank|basement to ground|^gr$/.test(l)) return 'Foundation and ground floor';
  if (RAMP[l]) return `Floor ${RAMP[l]}`;
  if (/swimming pool/.test(l)) return 'Floor 9';
  if (/^10th sale/.test(l)) return 'Floor 10 (Rehab 12)';
  let m = l.match(/^(\d+) (sale|rehab)/);
  if (m) { const k = +m[1]; if (m[2] === 'rehab' && k >= 10) return `Rehab floor ${k}`; return `Floor ${k}`; }
  m = l.match(/^(\d+)(st|nd|rd|th)$/);
  if (m) return `Floor ${+m[1]}`;
  if (/break pressure/.test(l)) return 'Floor 23';
  if (/^terrace$/.test(l)) return 'Terrace';
  if (/oht|lmr|mumty/.test(l)) return 'Above terrace (OHT, LMR and mumty)';
  return null;
}
const ORDER = ['Foundation and ground floor', ...Array.from({ length: 9 }, (_, i) => `Floor ${i + 1}`), 'Rehab floor 10', 'Rehab floor 11', 'Floor 10 (Rehab 12)',
  ...Array.from({ length: 35 }, (_, i) => `Floor ${i + 11}`), 'Terrace', 'Above terrace (OHT, LMR and mumty)'];

const lines = new Map(ORDER.map((f) => [f, { floor: f, parts: [], elements: {}, grades: {}, dias: {} }]));
let start = rows.findIndex((r) => r && r.includes('M60')) + 1;
const unknown = [];
for (const r of rows.slice(start)) {
  if (!r || !r[0] || typeof r[0] !== 'string') continue;
  if (/total|^\d\.|note|non-structural/i.test(r[0])) break;
  const f = floorOf(r[0]);
  const vals = r.slice(2, 16).map(n);
  if (!vals.some(Boolean)) continue;
  if (!f) { unknown.push(r[0]); continue; }
  const L = lines.get(f);
  if (!L.parts.includes(r[0].trim())) L.parts.push(r[0].trim());
  const el = r[1] ? String(r[1]).trim() : r[0].trim();
  const E = (L.elements[el] = L.elements[el] || { grades: {}, dias: {} });
  GRADES.forEach((g, i) => { if (vals[i]) { E.grades[g] = r3((E.grades[g] || 0) + vals[i]); L.grades[g] = (L.grades[g] || 0) + vals[i]; } });
  DIAS.forEach((d, i) => { const kg = vals[6 + i]; if (kg) { E.dias[d] = r3((E.dias[d] || 0) + kg / 1000); L.dias[d] = (L.dias[d] || 0) + kg / 1000; } });
}
if (unknown.length) { console.error('Rows not placed on a floor:', unknown); process.exit(1); }
const total = (o) => Object.values(o).reduce((a, x) => a + x, 0);
const out = [];
for (const L of lines.values()) {
  if (!L.parts.length) continue;
  const net = { rmc: r3(total(L.grades)), steel: r3(total(L.dias)) };
  out.push({ building: 'Structure', floor: L.floor, parts: L.parts, net,
    grades: Object.fromEntries(Object.entries(L.grades).map(([k, v]) => [k, r3(v * (1 + WASTE.rmc))])),
    dias: Object.fromEntries(Object.entries(L.dias).map(([k, v]) => [k, r3(v * (1 + WASTE.steel))])),
    rmc: r3(net.rmc * (1 + WASTE.rmc)), steel: r3(net.steel * (1 + WASTE.steel)), elements: L.elements });
}
// non-structural walls: whole-project figures Bilal carried from his earlier statement
const ns = rows.findIndex((r) => r && /non-structural wall quantities/i.test(String(r[0] || '')));
const nsC = n((rows.slice(ns).find((r) => /total concrete/i.test(String(r[0] || ''))) || [])[1]);
const nsS = n((rows.slice(ns).find((r) => /total reinforcement/i.test(String(r[0] || ''))) || [])[1]);
if (nsC || nsS) out.push({ building: 'Structure', floor: 'Non-structural walls (whole project)', parts: ['Non-structural walls'], net: { rmc: r3(nsC), steel: r3(nsS) }, grades: {}, dias: {},
  rmc: r3(nsC * (1 + WASTE.rmc)), steel: r3(nsS * (1 + WASTE.steel)), elements: {}, noGradeSplit: true });

// the old (22 Jun 2026) lines → the new ones, and their quantities delivered before the portal (opening)
const old = require('../lib/portal/purchase-budget.json');
const map = {};
for (const l of old.lines) {
  const k = `${l.building}|${l.floor}`; let f = null; const m = l.floor.match(/^Floor (\d+)/);
  if (/foundation/i.test(l.floor)) f = 'Foundation and ground floor';
  else if (/^terrace$/i.test(l.floor)) f = 'Terrace';
  else if (/above terrace/i.test(l.floor)) f = 'Above terrace (OHT, LMR and mumty)';
  else if (m) {
    const x = +m[1];
    if (l.building === 'Sale') f = x === 10 ? 'Floor 10 (Rehab 12)' : `Floor ${x}`;
    else f = x <= 9 ? `Floor ${x}` : x === 10 || x === 11 ? `Rehab floor ${x}` : x === 12 ? 'Floor 10 (Rehab 12)' : `Floor ${x - 2}`;
  }
  if (!f || !out.some((o) => o.floor === f)) { console.error('Old line not mapped:', k, f); process.exit(1); }
  map[k] = `Structure|${f}`;
  if (l.opening) {
    const t = out.find((o) => o.floor === f);
    t.opening = { rmc: r3(n(t.opening && t.opening.rmc) + n(l.opening.rmc)), steel: r3(n(t.opening && t.opening.steel) + n(l.opening.steel)), note: [t.opening && t.opening.note, `${l.building}: ${l.opening.note}`].filter(Boolean).join(' ') };
  }
}
map['Project|Retaining wall'] = 'Structure|Foundation and ground floor';

const sum = (k) => r3(out.reduce((a, l) => a + l[k], 0));
const byKey = (k) => { const o = {}; for (const l of out) for (const [g, v] of Object.entries(l[k])) o[g] = r3((o[g] || 0) + v); return o; };
const doc = {
  version: '2026-11-16',
  source: 'Structural engineer (Bilal), Grade and Dia-wise Breakup of Structural Element Quantities, 16 Nov 2026: one combined structure (Sale A, B and Rehab); wastage concrete 1.5%, steel 5%',
  replaces: `${old.version}: ${old.source}`,
  wastage: WASTE, grades: GRADES, dias: DIAS,
  // the rates to start from: the 22 Jun budget had one RMC rate per floor (Rs. 7,386 to 7,758 per m³) and Rs. 60,000 per MT
  // of steel; here one rate per grade and per bar size, which Management changes on the Purchase page as rates move
  rates: { rmc: { M60: 7758, M50: 7600, M45: 7538, M40: 7434, M35: 7390, M30: 7390, M25: 7300, M20: 7200, M15: 6500, M10: 5800 }, steel: Object.fromEntries(DIAS.map((d) => [d, 60000])), nsRmc: 7390 },
  totals: { rmc: sum('rmc'), steel: sum('steel'), grades: byKey('grades'), dias: byKey('dias') },
  lines: out, extra: old.extra, cement: old.cement, trackers: old.trackers, oldLines: map,
};
fs.writeFileSync(path.join(__dirname, '../lib/portal/boq-structure.json'), JSON.stringify(doc, null, 1));
console.log(`${out.length} lines; concrete ${doc.totals.rmc} m³, steel ${doc.totals.steel} MT (with wastage); ${Object.keys(map).length} old lines mapped`);
