// Channel partner ledger, firm by firm. For each firm:
//   brokerage     what the firm earns on its live bookings (agreement value × brokerage %)
//   billed        the firm's bills received
//   pass back     amounts the firm passed back (to a buyer, or adjusted against its brokerage)
//   paid (RTGS)   payments to the firm, counted once verified by someone other than the person who entered them
//   balance       brokerage − pass back − paid
//   due now       the part of the balance on bookings that meet the brokerage rule (registered, % received)
// Cancelled bookings are listed with the firm but earn no brokerage; anything already paid on them shows as recoverable.
const db = require('./db');

const n = (v) => Number(v) || 0;
const r2 = (x) => Math.round(x * 100) / 100;
const keyOf = (name) => String(name || '').replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '').toLowerCase();

async function rule() { const r = await db.one("select value from settings where key = 'brokerage_rule'"); return { afterRegistration: true, minReceivedPct: 10, ...(r ? r.value : {}) }; }

// The firm for a name typed or picked at booking: an existing firm, or a new one.
async function firmFor(t, { cpId, cpName, userId }) {
  if (cpId) { const f = await t.one('select id, name from channel_partners where id = $1', [cpId]); if (f) return f; }
  const name = String(cpName || '').replace(/\s+/g, ' ').trim();
  if (!name || /^(na|n\/a|-|nil|none)$/i.test(name)) return null;
  const k = keyOf(name);
  const ex = await t.one('select id, name from channel_partners where name_key = $1', [k]);
  if (ex) return ex;
  return t.one('insert into channel_partners (name, name_key, created_by) values ($1, $2, $3) returning id, name', [name, k, userId || null]);
}

// Bookings that name a partner but are not linked to a firm yet (from an import of the CRM sheet): link them,
// making the firm when it is new. Brokerage % is worked out from the brokerage amount where it is missing.
async function linkAll(q = db.q) {
  await q(`insert into channel_partners (name, name_key)
    select distinct on (k) n, k from (select regexp_replace(trim(cp_name), '\\s+', ' ', 'g') as n, lower(regexp_replace(regexp_replace(trim(cp_name), '\\s+', ' ', 'g'), '[.,]+$', '')) as k
      from bookings where cp_id is null and coalesce(trim(cp_name), '') <> '' and lower(trim(cp_name)) not in ('na', 'n/a', '-', 'nil', 'none')) x
    order by k, n on conflict (name_key) do nothing`);
  await q(`update bookings b set cp_id = c.id from channel_partners c
    where b.cp_id is null and coalesce(trim(b.cp_name), '') <> '' and c.name_key = lower(regexp_replace(regexp_replace(trim(b.cp_name), '\\s+', ' ', 'g'), '[.,]+$', ''))`);
  await q('update bookings set brokerage_pct = round(brokerage / agreement_value * 100, 3) where brokerage_pct is null and brokerage > 0 and agreement_value > 0');
  await q('update brokerage_entries e set cp_id = b.cp_id from bookings b where b.id = e.booking_id and e.cp_id is null and b.cp_id is not null');
}

async function ledger(projectId, cpId = null) {
  if (!cpId) await linkAll();
  const R = await rule();
  const bookings = await db.q(`select b.id as booking_id, b.cp_id, b.status, u.unit_no, b.agreement_value, b.brokerage, b.brokerage_pct, b.brokerage_released, b.registration_date, b.booking_date,
      b.cancelled_at, coalesce(bb.credit_av, 0) as received,
      (select string_agg(y.name, ' & ' order by a.seq) from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id) as buyers
    from bookings b join units u on u.id = b.unit_id left join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.cp_id is not null and b.status in ('active', 'cancelled') and not b.sample ${cpId ? 'and b.cp_id = $2' : ''}
    order by u.unit_no`, cpId ? [projectId, cpId] : [projectId]);
  const entries = await db.q(`select e.*, x.name as by_name, v.name as verified_name, u.unit_no from brokerage_entries e
      left join users x on x.id = e.created_by left join users v on v.id = e.verified_by left join bookings b on b.id = e.booking_id left join units u on u.id = b.unit_id
    where e.cancelled_at is null and e.cp_id is not null ${cpId ? 'and e.cp_id = $1' : ''} order by e.entry_date, e.id`, cpId ? [cpId] : []);
  const firms = await db.q(`select * from channel_partners ${cpId ? 'where id = $1' : 'order by name'}`, cpId ? [cpId] : []);
  const F = Object.fromEntries(firms.map((f) => [f.id, { ...f, flats: 0, cancelled: 0, agreementValue: 0, received: 0, brokerage: 0, billed: 0, passBack: 0, paid: 0, toVerify: 0, paidBefore: 0, dueNow: 0, notYetDue: 0, recoverable: 0, balance: 0 }]));
  const perBooking = {};
  for (const e of entries) {
    const f = F[e.cp_id]; if (!f) continue;
    const a = n(e.amount);
    if (e.kind === 'bill') f.billed += a;
    else if (e.kind === 'pass_back') f.passBack += a;
    else if (e.verified_at) f.paid += a; else f.toVerify += a;
    if (e.booking_id) { const p = (perBooking[e.booking_id] ||= { billed: 0, passBack: 0, paid: 0, toVerify: 0 }); if (e.kind === 'bill') p.billed += a; else if (e.kind === 'pass_back') p.passBack += a; else if (e.verified_at) p.paid += a; else p.toVerify += a; }
  }
  for (const b of bookings) {
    const f = F[b.cp_id]; if (!f) continue;
    const p = perBooking[b.booking_id] || { billed: 0, passBack: 0, paid: 0, toVerify: 0 };
    const av = n(b.agreement_value), amt = b.status === 'active' ? n(b.brokerage) : 0;
    const pctIn = av ? (n(b.received) / av) * 100 : 0;
    b.received_pct = Math.round(pctIn * 10) / 10;
    b.billed = p.billed; b.pass_back = p.passBack; b.paid = p.paid; b.to_verify = p.toVerify;
    b.paid_before = b.brokerage_released && p.paid < n(b.brokerage) ? r2(n(b.brokerage) - p.paid) : 0;
    b.eligible = b.status === 'active' && (!R.afterRegistration || !!b.registration_date) && pctIn + 1e-9 >= Number(R.minReceivedPct || 0);
    b.balance = r2(amt - p.passBack - p.paid - b.paid_before);
    b.state = b.status === 'cancelled' ? (p.paid + b.paid_before > 0 ? 'Cancelled: recover' : 'Cancelled') : !amt ? 'No amount' : b.balance <= 1 ? 'Paid' : b.eligible ? 'Due' : 'Not yet due';
    b.why = b.state === 'Not yet due' ? [R.afterRegistration && !b.registration_date ? 'not registered' : '', pctIn < R.minReceivedPct ? `${b.received_pct}% received of ${R.minReceivedPct}% needed` : ''].filter(Boolean).join(', ') : '';
    if (b.status === 'cancelled') { f.cancelled++; f.recoverable += p.paid + b.paid_before; continue; }
    f.flats++; f.agreementValue += av; f.received += n(b.received); f.brokerage += amt; f.paidBefore += b.paid_before;
    if (b.state === 'Due') f.dueNow += Math.max(0, b.balance); else if (b.state === 'Not yet due') f.notYetDue += Math.max(0, b.balance);
  }
  for (const f of Object.values(F)) {
    // firm-level entries (not tied to one flat) reduce the balance too
    f.balance = r2(f.brokerage - f.passBack - f.paid - f.paidBefore);
    for (const k of ['agreementValue', 'received', 'brokerage', 'billed', 'passBack', 'paid', 'toVerify', 'paidBefore', 'dueNow', 'notYetDue', 'recoverable']) f[k] = r2(f[k]);
  }
  const list = Object.values(F).filter((f) => cpId || f.flats || f.cancelled || f.billed || f.paid || f.toVerify).sort((a, b) => b.brokerage - a.brokerage || a.name.localeCompare(b.name));
  return { rule: R, firms: list, bookings, entries };
}

module.exports = { ledger, firmFor, keyOf, rule, linkAll };
