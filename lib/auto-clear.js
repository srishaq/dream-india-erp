// Clears the "Data to verify" items that need no one to look at them, and fills missing PANs from the TDS portal.
// run({ projectId, user, dry }) → what was (or would be) closed and filled. Everything is audited.
const db = require('./db');
const audit = require('./audit');

const SHEET = ['ledger-vs-bank', 'bank-tag', 'crm-vs-ledger', 'ledger-total', 'ledger-unassigned', 'ledger-orphan', 'no-ledger'];
const WHY = {
  sheet: 'Closed automatically: this compared tabs of the old Google Sheet (Ledger, CRM Follow up, Rera Bank Stat.). The books are now Tally, and each flat is checked on Open queries → Tally and the CRM.',
  held: 'Closed automatically: kept as held, as the sheet marks it (management or allotment). Change it on the unit if it is sold.',
  date: 'Closed automatically: the registration or first receipt date is used as the booking date.',
  fixed: 'Closed automatically: the buyer\'s details now have it.',
};
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE = /^[6-9]\d{9}$/;
const ALIAS = { MOHD: 'MOHAMMAD', MOHAMMED: 'MOHAMMAD', MOHAMED: 'MOHAMMAD', MOHAMMAD: 'MOHAMMAD', MOHAMAD: 'MOHAMMAD', MOHAMMEDD: 'MOHAMMAD', MD: 'MOHAMMAD', MOHD_: 'MOHAMMAD', SHAIKH: 'SHAIKH', SHEIKH: 'SHAIKH', SAYYED: 'SAYED', SYED: 'SAYED', SAIYED: 'SAYED' };
const toks = (s) => [...new Set(String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1).map((w) => ALIAS[w] || w))];
const score = (a, b) => { const A = toks(a), B = toks(b); const k = A.filter((w) => B.includes(w)).length; return k >= 2 && k >= Math.ceil(0.6 * Math.min(A.length, B.length)) ? k : 0; };
const phoneOk = (p) => PHONE.test(String(p || '').replace(/\D/g, '').slice(-10));

async function run({ projectId, user, dry = true }) {
  const out = { closed: {}, pans: [], tdsUnits: [], skipped: [] };
  await db.tx(async (t) => {
    const close = async (ids, why, kind) => {
      if (!ids.length) return;
      out.closed[kind] = (out.closed[kind] || 0) + ids.length;
      if (!dry) await t.q("update import_issues set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() where id = any($1::int[]) and status = 'open'", [ids, why, user.id]);
    };
    const open = await t.q("select i.id, i.kind, i.booking_id, i.unit_no from import_issues i where i.project_id = $1 and i.status = 'open'", [projectId]);
    const of = (k) => open.filter((x) => (Array.isArray(k) ? k.includes(x.kind) : x.kind === k));
    for (const k of SHEET) await close(of(k).map((x) => x.id), WHY.sheet, k);
    await close(of('held-unit').map((x) => x.id), WHY.held, 'held-unit');
    await close(of('no-booking-date').map((x) => x.id), WHY.date, 'no-booking-date');

    // PANs from the TDS portal: entries whose flat is not known yet, matched on the buyer's name to a booking with no PAN
    const need = await t.q(`select b.id as booking_id, u.unit_no, y.id as buyer_id, y.name, y.pan from bookings b join units u on u.id = b.unit_id
        join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
       where u.project_id = $1 and b.status = 'active' and coalesce(y.pan, '') !~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`, [projectId]);
    const known = new Set((await t.q("select upper(pan) as pan from buyers where pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'")).map((x) => x.pan));
    const tds = await t.q("select id, ref_id, customer, unit_no, remark from acc_tds_entries where book = 'signature' and remark like 'Buyer PAN %'");
    const byPan = {};
    for (const e of tds) { const p = (String(e.remark).match(/Buyer PAN ([A-Z]{5}[0-9]{4}[A-Z])/) || [])[1]; if (p) (byPan[p] ||= []).push(e); }
    const usedBuyer = new Set();
    for (const [pan, es] of Object.entries(byPan)) {
      if (known.has(pan)) continue;
      const name = es[0].customer;
      const hits = need.filter((n) => !usedBuyer.has(n.buyer_id)).map((n) => ({ n, s: score(name, n.name) })).filter((x) => x.s).sort((a, b) => b.s - a.s);
      if (!hits.length || (hits[1] && hits[1].s === hits[0].s && hits[1].n.buyer_id !== hits[0].n.buyer_id)) { out.skipped.push({ pan, name, why: hits.length ? 'more than one buyer matches' : 'no buyer without a PAN matches' }); continue; }
      const h = hits[0].n; usedBuyer.add(h.buyer_id); known.add(pan);
      out.pans.push({ unit: h.unit_no, buyer: h.name, tdsName: name, pan });
      if (!dry) {
        await t.q('update buyers set pan = $2 where id = $1', [h.buyer_id, pan]);
        await audit.record(t.q, { user, action: 'update', entity: 'buyer', entityId: h.buyer_id, projectId, before: { pan: h.pan || null }, after: { pan }, note: `PAN from the TDS portal (Form 26AS, deductor ${name}).` });
      }
      const units = [...new Set(hits.filter((x) => x.n.buyer_id === h.buyer_id).map((x) => x.n.unit_no))];
      if (units.length > 1) { out.skipped.push({ pan, name, why: `PAN filled; the TDS entry left without a flat, as the buyer has ${units.join(' and ')}` }); continue; }
      for (const e of es.filter((x) => !x.unit_no)) {
        out.tdsUnits.push({ ref: e.ref_id, unit: h.unit_no });
        if (!dry) await t.q('update acc_tds_entries set unit_no = $2, updated_by = $3, updated_at = now() where id = $1', [e.id, h.unit_no, user.id]);
      }
    }

    // buyer details now filled in: close the item
    const det = await t.q(`select i.id, i.kind, bool_or(y.email like '%@%') as email,
        max(case when a.seq = 1 then y.phone end) as phone, bool_and(coalesce(y.pan, '') = '' or y.pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') as pans_ok
      from import_issues i join booking_applicants a on a.booking_id = i.booking_id join buyers y on y.id = a.buyer_id
      where i.project_id = $1 and i.status = 'open' and i.kind in ('no-email', 'no-mobile', 'bad-pan') group by i.id, i.kind`, [projectId]);
    if (det) {
      await close(det.filter((d) => d.kind === 'no-email' && d.email).map((d) => d.id), WHY.fixed, 'no-email');
      await close(det.filter((d) => d.kind === 'no-mobile' && phoneOk(d.phone)).map((d) => d.id), WHY.fixed, 'no-mobile');
      await close(det.filter((d) => d.kind === 'bad-pan' && d.pans_ok).map((d) => d.id), WHY.fixed, 'bad-pan');
    }
    if (!dry) await audit.record(t.q, { user, action: 'auto-clear', entity: 'import-issue', projectId, after: { closed: out.closed, pans: out.pans.length, tdsUnits: out.tdsUnits.length }, note: 'Data to verify: items that need no one to check them were closed, and PANs filled from the TDS portal.' });
  });
  out.closedTotal = Object.values(out.closed).reduce((a, b) => a + b, 0);
  return out;
}

module.exports = { run, score };
