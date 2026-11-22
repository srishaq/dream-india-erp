// Dream Aspire: the buyers' actual payments, from the CRM's "Aspire transaction details principal and gst …xlsx" (Savita,
// 22 Nov 2026), replace the one opening receipt per flat that the first import made from the slab-wise sheet.
// The sheet has one block per flat:
//   Sr.No. | Flat No. | Party name | Transaction ID | Agreement Value | GST @5% | TDS @1%      ← the flat's header row
//          |          | Recd Dt.18/06/25 | 686619123836 | 51,000 |                          ← a payment towards the agreement value
//          |          | Total Principal …
//          |          | GST Recd from Party
//          |          | Recd dt.14/07/2025 | 01591050028852 |      | 78,221               ← a GST payment
//          |          | Total GST Amount …
// A line with an amount but no date takes the date of the line above it (flagged). Totals and balances are only used to
// check the sum. The opening TDS receipt stays unless the sheet lists TDS for the flat.
const audit = require('./audit');
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const num = (v) => { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? n : 0; };

function dateOf(label) {
  const m = String(label || '').match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m; d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2015 || y > 2035) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); if (d > last) d = last; // 31/11 → 30/11
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
function utrDate(ref) {
  const m = String(ref || '').match(/^[A-Z]{4}[A-Z0-9](\d{2})(\d{3})/);
  if (!m) return null;
  const y = 2000 + +m[1], doy = +m[2]; if (doy < 1 || doy > 366) return null;
  const d = new Date(Date.UTC(y, 0, doy)).toISOString().slice(0, 10);
  return d <= today() ? d : null;
}
const refOf = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v)); return clean(v).slice(0, 60) || null; };

function parse(tabs) {
  const sheet = (tabs || []).find((t) => (t.rows || []).some((r) => /flat\s*no/i.test(String(r[1] || '')))) || (tabs || [])[0];
  if (!sheet) throw new Error('The workbook has no sheet with a "Flat No." column.');
  const flats = [], issues = [];
  let f = null, section = 'principal', lastDate = null;
  const close = () => {
    if (!f) return;
    const sum = (k) => r2(f.lines.filter((l) => l.head === k).reduce((a, l) => a + l.amount, 0));
    f.totals = { av: sum('av'), gst: sum('gst'), tds: sum('tds') };
    if (f.sheetPrincipal != null && Math.abs(f.sheetPrincipal - f.totals.av) > 1) issues.push({ unit: f.unit, kind: 'total-differs', detail: `The payments listed add up to ${f.totals.av.toLocaleString('en-IN')}, but the sheet's "Total Principal" says ${f.sheetPrincipal.toLocaleString('en-IN')}. The payments listed are used.` });
    if (f.sheetGst != null && Math.abs(f.sheetGst - f.totals.gst) > 1) issues.push({ unit: f.unit, kind: 'total-differs', detail: `The GST payments listed add up to ${f.totals.gst.toLocaleString('en-IN')}, but the sheet's "Total GST" says ${f.sheetGst.toLocaleString('en-IN')}.` });
    flats.push(f); f = null;
  };
  for (const row of sheet.rows || []) {
    const [, b, c, d, e, g, h] = row;
    const label = clean(c);
    if (/^sr\.?\s*no/i.test(clean(row[0])) || /flat purchase/i.test(label)) continue; // a repeated header row
    const flatNo = typeof b === 'number' ? b : /^\d{3,4}$/.test(clean(b)) ? +clean(b) : null;
    if (flatNo && label && !/^recd/i.test(label) && !/gst\s*recd|total/i.test(label) && !(f && f.unit === `A-${flatNo}`)) {
      close();
      f = { unit: `A-${flatNo}`, name: label, av: num(e), gstDue: num(g), tdsDue: num(h), lines: [], also: [], sheetPrincipal: null, sheetGst: null };
      section = 'principal'; lastDate = null; continue;
    }
    if (!f) continue;
    if (/total/i.test(label)) {
      if (/principal|recd amount|rece?ie?ve?d/i.test(label) && num(e)) f.sheetPrincipal = num(e);
      if (/gst/i.test(label) && num(g)) f.sheetGst = num(g);
      continue; // totals and balances are not payments
    }
    if (/gst\s*recd/i.test(label)) { section = 'gst'; continue; }
    const amts = [['av', num(e)], ['gst', num(g)], ['tds', num(h)]].filter(([, v]) => v > 0);
    if (!amts.length) { if (label && !/^recd/i.test(label)) f.also.push(label); continue; }
    let date = /^recd/i.test(label) ? dateOf(label) : null;
    if (!date) {
      issues.push({ unit: f.unit, kind: 'no-date', detail: `A payment of ${amts.map(([, v]) => v.toLocaleString('en-IN')).join(' + ')}${refOf(d) ? ` (ref ${refOf(d)})` : ''} has no date${lastDate ? `; dated ${lastDate}, as the line above it` : '; left out'}.` });
      if (!lastDate) continue;
      date = lastDate;
    }
    if (date > today()) {
      // a typo in the month (16/12/26 for 16/02/26): bank UTRs carry the year and the day of the year (CBINH26047… = 16 Feb 2026)
      const u = utrDate(refOf(d));
      issues.push({ unit: f.unit, kind: 'future-date', detail: `A payment of ${amts.map(([, v]) => v.toLocaleString('en-IN')).join(' + ')} is dated ${date}, after today${u ? `; dated ${u} from its bank reference ${refOf(d)}` : '; left out'}.` });
      if (!u) continue;
      date = u;
    }
    lastDate = date;
    for (const [head, amount] of amts) f.lines.push({ date, ref: refOf(d), head, amount: r2(amount), undated: !/^recd/i.test(label) || !dateOf(label) });
  }
  close();
  return { flats, issues, summary: { flats: flats.length, payments: flats.reduce((a, x) => a + x.lines.length, 0), av: r2(flats.reduce((a, x) => a + x.totals.av, 0)), gst: r2(flats.reduce((a, x) => a + x.totals.gst, 0)), tds: r2(flats.reduce((a, x) => a + x.totals.tds, 0)) } };
}

// Compare with the ERP: which bookings get the payments, and how each differs from its opening receipt.
async function plan(q, parsed, projectId) {
  const bks = await q(`select k.id, u.unit_no, k.agreement_value, coalesce(k.sale_type, 'developer') as sale_type,
      (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = k.id and r.status = 'approved' and s.head = 'av') as av_now,
      (select coalesce(sum(s.amount), 0) from receipts r join receipt_splits s on s.receipt_id = r.id where r.booking_id = k.id and r.status = 'approved' and s.head = 'gst') as gst_now,
      (select count(*) from receipts r where r.booking_id = k.id and r.opening and r.import_key like 'aspire-open:%')::int as openings,
      (select count(*) from receipts r where r.booking_id = k.id and not r.opening and r.status <> 'rejected')::int as entered
    from bookings k join units u on u.id = k.unit_id where u.project_id = $1 and k.status = 'active'`, [projectId]);
  const B = new Map(bks.map((x) => [x.unit_no, x]));
  const rows = [], issues = [...parsed.issues];
  for (const f of parsed.flats) {
    const k = B.get(f.unit);
    if (!k) { issues.push({ unit: f.unit, kind: 'no-booking', detail: `${f.unit} (${f.name}) has no booking in the ERP; its ${f.lines.length} payments are left out.` }); continue; }
    if (!f.lines.length) { issues.push({ unit: f.unit, kind: 'no-payments', detail: `${f.unit} (${f.name}) has no payments listed on the sheet, but ${r2(k.av_now).toLocaleString('en-IN')} received in the ERP; its opening receipt stays until the sheet is filled.` }); continue; }
    if (k.sale_type === 'contractor') { issues.push({ unit: f.unit, kind: 'contractor-flat', detail: `${f.unit} is a contractor's flat in the ERP; its payments are left out.` }); continue; }
    if (Math.abs(n(k.agreement_value) - f.av) > 1 && f.av) issues.push({ unit: f.unit, kind: 'av-differs', detail: `Agreement value: ${n(k.agreement_value).toLocaleString('en-IN')} in the ERP, ${f.av.toLocaleString('en-IN')} on this sheet. The ERP's is kept.` });
    if (Math.abs(r2(k.av_now) - f.totals.av) > 100000) issues.push({ unit: f.unit, kind: 'received-differs', detail: `Received towards the agreement value: ${r2(k.av_now).toLocaleString('en-IN')} by the slab-wise sheet, ${f.totals.av.toLocaleString('en-IN')} by the payments listed on the transaction sheet. The payments listed are used.` });
    rows.push({ f, booking: k, avBefore: r2(k.av_now), gstBefore: r2(k.gst_now), avAfter: f.totals.av, gstAfter: f.totals.gst });
  }
  const covered = new Set(parsed.flats.map((x) => x.unit));
  for (const k of bks) if (k.sale_type === 'developer' && !covered.has(k.unit_no)) issues.push({ unit: k.unit_no, kind: 'not-on-sheet', detail: `${k.unit_no} is a developer booking in the ERP but is not on the transaction sheet; its opening receipt stays.` });
  return { rows, issues };
}
const n = (v) => Number(v) || 0;

async function commit(t, parsed, { projectId, user, source }) {
  const { rows, issues } = await plan(t.q, parsed, projectId);
  let removed = 0, added = 0;
  for (const { f, booking } of rows) {
    const old = await t.q(`select r.*, (select json_agg(json_build_object('head', s.head, 'amount', s.amount)) from receipt_splits s where s.receipt_id = r.id) as splits
        from receipts r where r.booking_id = $1 and r.opening and (r.import_key like 'aspire-open:%' or r.import_key like 'aspire-txn:%'${f.totals.tds ? " or r.import_key like 'aspire-open-tds:%'" : ''})`, [booking.id]);
    for (const o of old) await audit.record(t.q, { user, action: 'replace', entity: 'receipt', entityId: o.id, before: o, note: `Opening receipt replaced by the actual payments from ${source}` });
    if (old.length) { await t.q('delete from receipt_splits where receipt_id = any($1::int[])', [old.map((o) => o.id)]); await t.q('delete from receipts where id = any($1::int[])', [old.map((o) => o.id)]); removed += old.length; }
    const lines = f.lines.map((l, i) => ({ ...l, k: `aspire-txn:${f.unit}:${i + 1}` }));
    if (!lines.length) continue;
    const ins = await t.q(`insert into receipts (project_id, booking_id, received_on, amount, mode, instrument_no, status, approved_at, opening, note, import_key)
        select $1, $2, x.date, x.amount, case when x.head = 'tds' then 'tds' else 'bank' end, x.ref, 'approved', now(), true, $3, x.k
          from json_to_recordset($4::json) as x(date date, amount numeric, head text, ref text, k text) returning id, import_key`,
      [projectId, booking.id, `From the Aspire CRM transaction sheet (${source}).`, JSON.stringify(lines)]);
    const id = Object.fromEntries(ins.map((r) => [r.import_key, r.id]));
    await t.q('insert into receipt_splits (receipt_id, head, amount) select x.id, x.head, x.amount from json_to_recordset($1::json) as x(id int, head text, amount numeric)',
      [JSON.stringify(lines.map((l) => ({ id: id[l.k], head: l.head, amount: l.amount })))]);
    added += lines.length;
  }
  const run = await t.one('insert into import_runs (project_id, source, summary, created_by) values ($1, $2, $3, $4) returning id', [projectId, source, { ...parsed.summary, removed, added, kind: 'aspire-receipts' }, user.id]);
  if (issues.length) await t.q(`insert into import_issues (run_id, project_id, unit_no, kind, severity, detail) select $1, $2, x.unit, x.kind, 'money', x.detail from json_to_recordset($3::json) as x(unit text, kind text, detail text)`, [run.id, projectId, JSON.stringify(issues)]);
  await audit.record(t.q, { user, action: 'import', entity: 'aspire-receipts', entityId: run.id, after: { removed, added, flats: rows.length } });
  return { flats: rows.length, removed, added, issues: issues.length };
}

module.exports = { parse, plan, commit, dateOf };
