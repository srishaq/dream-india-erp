// Dream Aspire's TDS from Accounts' two sheets in "01 – Accounts (Aspire)" on Drive (Dixita, 25 Nov 2026):
//   "TDS Working …xlsx"         one row per TDS deducted: party, PAN, date, section, amount paid, rate, TDS
//   "TDS Challan Summary …xlsx" one row per challan deposited: date, financial year, challan no., amount, interest, late fee
// Each working row is matched to the Payments Out entry that paid it (same party, the amount paid less the TDS, within
// 10 days before to 60 days after the TDS date); its PAN, section, rate and TDS are filled where the ERP has none.
// Every payment of a party in the working gets the party's PAN where it has none. The challans are then laid against
// the payments' TDS in date order, year by year (the earliest unpaid TDS of a year goes on that year's next challan
// dated on or after it, as the books do month by month), which gives each payment its challan number and deposit date. Nothing already filled is changed.
const xlsx = require('./xlsx');
const TB = require('./tally-bills');

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const iso = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = clean(v).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = clean(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
};
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
const fyOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

// the challans: date, year, challan no., amount, interest, late fee, total
function challans(buf) {
  const out = [];
  for (const sh of xlsx.read(buf)) {
    const h = sh.rows.findIndex((r) => r && r.some((c) => /challan\s*no/i.test(clean(c))));
    if (h < 0) continue;
    const H = sh.rows[h].map((c) => clean(c).toLowerCase()); const ci = (re) => H.findIndex((x) => re.test(x));
    const C = { d: ci(/date/), y: ci(/year/), no: ci(/challan\s*no/), amt: ci(/^amount$|tds amount|^tax/), int: ci(/interest/), late: ci(/late/), tot: ci(/challan amount|total/) };
    for (const r of sh.rows.slice(h + 1)) {
      if (!r) continue;
      const date = iso(r[C.d]); const amt = Number(r[C.amt]);
      if (!date || !Number.isFinite(amt) || amt <= 0) continue;
      out.push({ date, fy: clean(r[C.y]) || fyOf(date), no: clean(r[C.no]), amount: r2(amt), interest: r2(Number(r[C.int]) || 0), late: r2(Number(r[C.late]) || 0), total: r2(Number(r[C.tot]) || amt) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// the TDS deducted, financial year by financial year, against the challans: what is short, over, and the interest paid
function summary(work, chal) {
  const by = {};
  const row = (fy) => (by[fy] = by[fy] || { fy, entries: 0, paid: 0, tds: 0, challans: 0, deposited: 0, interest: 0, late: 0 });
  for (const w of work) { if (!w.date) continue; const r = row(fyOf(w.date)); r.entries++; r.paid += w.amt; r.tds += w.tds; }
  for (const c of chal) { const r = row(c.fy || fyOf(c.date)); r.challans++; r.deposited += c.amount; r.interest += c.interest; r.late += c.late; }
  return Object.values(by).sort((a, b) => a.fy.localeCompare(b.fy)).map((r) => ({ ...r, paid: r2(r.paid), tds: r2(r.tds), deposited: r2(r.deposited), interest: r2(r.interest), late: r2(r.late), gap: r2(r.tds - r.deposited) }));
}

// the same party for the PAN: the same name, or one name the start of the other ("Bharat Singh" / "Bharat Singh Chauhan")
function samePan(a, b) { if (!a || !b) return false; if (a === b) return true; const [x, y] = a.length < b.length ? [a, b] : [b, a]; return x.length >= 8 && y.startsWith(x); }
function close(a, b) { if (!a || !b) return false; if (a === b) return true; const n = Math.min(a.length, b.length, 10); return n >= 6 && a.slice(0, n) === b.slice(0, n); }

async function plan(q, { work, chal }, { book = 'aspire' } = {}) {
  const pays = await q(`select id, ref_id, txn_date::text as date, payee, amount, vendor_pan, tds_section, tds_rate, tds_deducted, tds_challan, tds_deposited_on::text as deposited
     from acc_payments where book = $1 and amount > 0 order by txn_date, id`, [book]);
  for (const p of pays) { p.key = TB.norm(p.payee || ''); p.amount = Number(p.amount); }
  const used = new Set(), fills = new Map(), unmatched = [];
  const fill = (p, k, v) => { if (v == null || v === '') return; if (p[k] != null && p[k] !== '') return; const f = fills.get(p.id) || { id: p.id, ref: p.ref_id, date: p.date, payee: p.payee, amount: p.amount, set: {} }; if (f.set[k] == null) f.set[k] = v; fills.set(p.id, f); };
  // 1. each TDS row to the payment that paid it
  for (const w of work) {
    const net = r2(w.amt - w.tds);
    const c = pays.filter((p) => !used.has(p.id) && close(p.key, w.key) && p.date && w.date && days(p.date, w.date) >= -10 && days(p.date, w.date) <= 60
      && (Math.abs(p.amount - net) <= 2 || Math.abs(p.amount - w.amt) <= 2))
      .sort((a, b) => Math.abs(days(a.date, w.date)) - Math.abs(days(b.date, w.date)));
    const p = c[0];
    if (!p) { unmatched.push({ party: w.party, date: w.date, paid: w.amt, tds: w.tds }); continue; }
    used.add(p.id); p.w = w;
    fill(p, 'vendor_pan', w.pan); fill(p, 'tds_section', w.sec); fill(p, 'tds_rate', w.rate || (w.amt ? r2(w.tds / w.amt * 10000) / 10000 : null)); fill(p, 'tds_deducted', w.tds);
  }
  // 2. the party's PAN on its other payments
  const pans = {}; for (const w of work) if (w.pan && PAN.test(w.pan)) pans[w.key] = w.pan;
  const keys = Object.keys(pans);
  for (const p of pays) if (!p.vendor_pan && p.key) { const k = keys.find((x) => samePan(p.key, x)); if (k) fill(p, 'vendor_pan', pans[k]); }
  // 3. the challans, in date order, against the TDS in date order (only TDS not yet shown as deposited)
  const owed = pays.map((p) => { const f = fills.get(p.id); const tds = Number(p.tds_deducted ?? f?.set.tds_deducted ?? 0); return { p, tds, date: p.w ? p.w.date : p.date }; })
    .filter((x) => x.tds > 0 && !x.p.deposited && !(x.p.tds_challan && x.p.tds_challan !== '')).sort((a, b) => a.date.localeCompare(b.date));
  // each financial year's TDS goes on that year's challans (the summary gives the year each challan was paid for)
  const pools = {}; for (const c of chal) (pools[c.fy || fyOf(c.date)] = pools[c.fy || fyOf(c.date)] || []).push({ ...c, left: c.amount });
  let placed = 0, late = 0, notDeposited = 0;
  for (const x of owed) {
    const pool = pools[fyOf(x.date)] || [];
    // the first challan of the year dated on or after the TDS with room left (a challan paid before the TDS was deducted cannot hold it)
    const c = pool.find((k) => k.left >= Math.min(1, x.tds) && k.date >= x.date);
    if (!c) { notDeposited++; continue; }
    c.left = r2(c.left - x.tds);
    fill(x.p, 'tds_challan', c.no); fill(x.p, 'tds_deposited_on', c.date);
    placed++;
    // due on the 7th of the next month (30 April for March)
    const d = new Date(x.date + 'T00:00:00Z'); const due = d.getUTCMonth() === 2 ? `${d.getUTCFullYear()}-04-30` : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 7)).toISOString().slice(0, 10);
    if (c.date > due) late++;
  }
  const list = [...fills.values()];
  return { payments: pays.length, workRows: work.length, matched: used.size, unmatched, fills: list, pans: list.filter((f) => f.set.vendor_pan).length, tds: list.filter((f) => f.set.tds_deducted != null).length,
    challansPlaced: placed, lateDeposits: late, notDeposited, summary: summary(work, chal), challans: chal.length };
}

async function commit(t, data, { book = 'aspire', user = null, source = '' } = {}) {
  const p = await plan(t.q, data, { book });
  const TXT = ['vendor_pan', 'tds_section', 'tds_challan'];
  const COLS = ['vendor_pan', 'tds_section', 'tds_rate', 'tds_deducted', 'tds_challan', 'tds_deposited_on'];
  const sets = COLS.map((k) => (TXT.includes(k) ? `${k} = coalesce(nullif(p.${k}, ''), x.${k})` : `${k} = coalesce(p.${k}, x.${k})`)).join(', ');
  if (p.fills.length) await t.q(`update acc_payments p set ${sets}, updated_by = $2,
      bill_note = concat_ws(' · ', nullif(p.bill_note, ''), 'TDS from the Accounts TDS working and challan summary')
    from json_to_recordset($1::json) as x(id int, vendor_pan text, tds_section text, tds_rate numeric, tds_deducted numeric, tds_challan text, tds_deposited_on date)
    where p.id = x.id`, [JSON.stringify(p.fills.map((f) => ({ id: f.id, ...f.set }))), user ? user.id : null]);
  await require('./audit').record(t.q, { user, action: 'tds-working', entity: 'accounts', entityId: book,
    after: { filled: p.fills.length, pans: p.pans, tds: p.tds, challansPlaced: p.challansPlaced, unmatched: p.unmatched.length }, note: source });
  return p;
}

// read both workbooks: the TDS rows (lib/tally-bills.js workings) and the challans
function parse(files) {
  const work = [], chal = [];
  for (const f of files) {
    if (/challan/i.test(f.name)) chal.push(...challans(f.buf));
    else if (/tds/i.test(f.name)) work.push(...TB.workings(f.buf, f.name).map((w) => ({ ...w, date: w.date || null, amt: r2(w.amount ?? 0), tds: r2(w.tds ?? 0), rate: w.rate != null ? Number(w.rate) : null })));
  }
  return { work: work.filter((w) => w.date && w.tds > 0), chal: chal.sort((a, b) => a.date.localeCompare(b.date)) };
}

module.exports = { parse, challans, summary, plan, commit, fyOf };
