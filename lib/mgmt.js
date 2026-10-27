// Management dashboard: the key figures of every department on one screen, worked out from the ERP's own records
// (CRM, Accounts registers, CA model, Site Office and Purchase). Each tile is worked out on its own, so one that
// cannot be worked out shows a note and the rest still show.
// Tile: { key, title, value, sub, lines: [[label, value, tone?]], link, tone: 'good'|'warn'|'bad'|'' , note? }
const db = require('./db');
const kv = require('./portal/kv');
const { today: istToday } = require('./demands');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(iso(b)) - Date.parse(iso(a))) / 864e5);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (d) => { const s = iso(d); if (!s) return '—'; const [y, m, dd] = s.split('-'); return `${+dd} ${MN[+m - 1]} ${y}`; };
const cr = (v) => { const a = Math.abs(n(v)), s = n(v) < 0 ? '−' : ''; return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${Math.round(a).toLocaleString('en-IN')}`; };
const cnt = (v) => Math.round(n(v)).toLocaleString('en-IN');
const plural = (k, w) => `${cnt(k)} ${w}${k === 1 ? '' : 's'}`;
const ago = (k) => (k <= 0 ? 'today' : k === 1 ? '1 day' : `${k} days`);
const TAX = /\b(gst|gstr|tds|tcs|income.?tax|advance tax|26q|24q|27q|26qb|194|form ?16|professional tax|p\.?t\.?)\b/i;

async function tile(key, f) {
  try { return { key, ...(await f()) }; } catch (e) { console.error('mgmt', key, e.message); return { key, title: key, value: '—', sub: 'Could not be worked out just now.', lines: [], tone: '' }; }
}
const kvAll = async (k) => { try { return await kv.hgetall(k); } catch { return {}; } };

// ---------- Money today ----------
async function cashInBank(t) {
  const bal = await require('./accounts').balances(t);
  const rows = bal.rows.filter((r) => Math.abs(r.closing) > 0.5 || r.perBank != null);
  const total = bal.rows.reduce((a, r) => a + r.closing, 0);
  const last = await db.one('select max(entry_date) as d from acc_daily_entries where book = $1', [BOOK]);
  const off = bal.rows.filter((r) => r.difference != null && Math.abs(r.difference) > 1).length;
  return { title: 'Cash in bank', value: cr(total), sub: `Daily Bank Balance${last && last.d ? ', last entry ' + fmtD(last.d) : ''}`,
    lines: rows.sort((a, b) => b.closing - a.closing).slice(0, 5).map((r) => [r.bank, cr(r.closing)]).concat(off ? [[`Banks not agreeing with the statement`, cnt(off), 'bad']] : []),
    link: '#/balances', tone: off ? 'warn' : '' };
}
async function todayCollections(t) {
  const r = await db.one(`select coalesce(sum(amount), 0) as total, count(*)::int as k,
      coalesce(sum(amount) filter (where coalesce(payment_head, '') <> ''), 0) as cust, count(*) filter (where coalesce(payment_head, '') <> '')::int as kc,
      count(distinct unit_no) filter (where coalesce(unit_no, '') <> '')::int as flats
    from acc_receipts where book = $1 and txn_date = $2 and coalesce(cheque_status, '') <> 'Bounced'`, [BOOK, t]);
  const erp = await db.one("select coalesce(sum(amount), 0) as amt, count(*)::int as k from receipts where received_on = $1 and status in ('pending', 'approved') and not opening", [t]);
  const lines = [['From buyers', `${cr(r.cust)} · ${plural(r.kc, 'receipt')}`], ['Other receipts', cr(n(r.total) - n(r.cust))], ['Flats paid against', cnt(r.flats)]];
  if (erp.k) lines.push(['Entered by CRM today', `${cr(erp.amt)} · ${plural(erp.k, 'receipt')}`]);
  let sub = `${plural(r.k, 'receipt')} in the bank registers`;
  if (!r.k) {
    const last = await db.one(`select txn_date, sum(amount) as amt from acc_receipts where book = $1 and txn_date < $2 and coalesce(cheque_status, '') <> 'Bounced' group by txn_date order by txn_date desc limit 1`, [BOOK, t]);
    sub = last ? `Nothing entered for today yet · last day ${fmtD(last.txn_date)}: ${cr(last.amt)}` : 'Nothing entered for today yet';
  }
  return { title: "Today's collections", value: cr(r.total), sub, lines, link: '#/reg-receipts', tone: r.k ? 'good' : '' };
}
async function monthCollections(t, pid) {
  const m0 = t.slice(0, 8) + '01', pm0 = addDays(m0, -1).slice(0, 8) + '01';
  const q = (a, b) => db.one(`select coalesce(sum(amount), 0) as amt from acc_receipts where book = $1 and txn_date between $2 and $3 and coalesce(payment_head, '') <> '' and coalesce(cheque_status, '') <> 'Bounced'`, [BOOK, a, b]);
  const [cur, prev, prevTo] = await Promise.all([q(m0, t), q(pm0, addDays(m0, -1)), q(pm0, addDays(pm0, days(m0, t)))]);
  const due = await db.one(`select coalesce(sum(d.amount + d.gst), 0) as amt, count(distinct d.booking_id)::int as k from demands d join bookings b on b.id = d.booking_id join units u on u.id = b.unit_id
     where u.project_id = $1 and d.status = 'raised' and b.status = 'active' and d.due_date between $2 and $3`, [pid, m0, addDays(addDays(m0, 32).slice(0, 8) + '01', -1)]);
  const pct = n(due.amt) ? Math.round((n(cur.amt) / n(due.amt)) * 100) : null;
  const vs = n(prevTo.amt) ? Math.round(((n(cur.amt) - n(prevTo.amt)) / n(prevTo.amt)) * 100) : null;
  return { title: 'Collected this month', value: cr(cur.amt), sub: `From buyers, 1 ${MN[+t.slice(5, 7) - 1]} to today`,
    lines: [['Falling due this month', `${cr(due.amt)} · ${plural(due.k, 'buyer')}`], ['Collected against due', pct == null ? '—' : pct + '%', pct != null && pct < 50 ? 'warn' : ''],
      ['Same days last month', `${cr(prevTo.amt)}${vs == null ? '' : ` (${vs >= 0 ? '+' : ''}${vs}%)`}`, vs != null && vs < 0 ? 'warn' : 'good'], ['Whole of last month', cr(prev.amt)]],
    link: '#/reg-receipts', tone: '' };
}
async function overdue(t, pid) {
  const bk = await db.q(`select b.id, u.unit_no, bb.overdue, bb.gst_outstanding, bb.credit_av,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as buyer
    from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
    where u.project_id = $1 and b.status = 'active' and (bb.overdue > 1000 or bb.gst_outstanding > 1000)`, [pid]);
  const dm = bk.length ? await db.q("select booking_id, amount, due_date from demands where status = 'raised' and booking_id = any($1) order by booking_id, due_date, id", [bk.map((b) => b.id)]) : [];
  const D = {}; for (const d of dm) (D[d.booking_id] ||= []).push(d);
  const buckets = { a: 0, b: 0, c: 0, d: 0 };
  let gst = 0;
  for (const b of bk) {
    gst += n(b.gst_outstanding);
    if (n(b.overdue) <= 1000) continue;
    // age from the oldest demand the money received has not covered
    let left = n(b.credit_av), since = null;
    for (const d of D[b.id] || []) { if (left >= n(d.amount) - 1) { left -= n(d.amount); continue; } since = d.due_date; break; }
    const age = since ? days(since, t) : 0;
    buckets[age <= 30 ? 'a' : age <= 60 ? 'b' : age <= 90 ? 'c' : 'd'] += n(b.overdue);
    b.age = age;
  }
  const od = bk.filter((b) => n(b.overdue) > 1000).sort((a, b) => n(b.overdue) - n(a.overdue));
  const total = od.reduce((a, b) => a + n(b.overdue), 0);
  return { title: 'Overdue from buyers', value: cr(total), sub: `${plural(od.length, 'buyer')} past the due date · GST still to collect ${cr(gst)}`,
    lines: [['1 to 30 days', cr(buckets.a)], ['31 to 60 days', cr(buckets.b), buckets.b ? 'warn' : ''], ['61 to 90 days', cr(buckets.c), buckets.c ? 'warn' : ''], ['Over 90 days', cr(buckets.d), buckets.d ? 'bad' : '']],
    list: { h: 'Five largest', rows: od.slice(0, 5).map((b) => [`${b.unit_no}${b.buyer ? ' · ' + b.buyer : ''}`, `${cr(b.overdue)}${b.age ? ' · ' + b.age + 'd' : ''}`]) },
    link: '#/followups', tone: buckets.d ? 'bad' : total ? 'warn' : 'good' };
}
async function pdc(t) {
  const w = await db.one('select count(*)::int as k, coalesce(sum(amount), 0) as amt, min(due_date) as first from acc_pdc where book = $1 and due_date between $2 and $3', [BOOK, t, addDays(t, 7)]);
  const items = await db.q('select issued_to, amount, due_date, bank from acc_pdc where book = $1 and due_date between $2 and $3 order by due_date, id limit 4', [BOOK, t, addDays(t, 7)]);
  const bo = await db.one(`select count(*)::int as k, coalesce(sum(amount), 0) as amt from acc_receipts where book = $1 and cheque_status = 'Bounced' and txn_date >= $2`, [BOOK, t.slice(0, 8) + '01']);
  return { title: 'PDCs due this week', value: `${cnt(w.k)} · ${cr(w.amt)}`, sub: 'Cheques we issued that will be presented in the next 7 days',
    lines: items.map((p) => [`${fmtD(p.due_date)} · ${p.issued_to || '—'}`, cr(p.amount)]).concat([['Buyer cheques bounced this month', `${cnt(bo.k)} · ${cr(bo.amt)}`, bo.k ? 'bad' : 'good']]),
    link: '#/reg-pdc', tone: bo.k ? 'bad' : w.k ? 'warn' : '' };
}

// ---------- Sales and CRM ----------
async function inventory(dash, pid) {
  const T = dash.totals;
  const canc = await db.one("select count(*)::int as k from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'cancelled'", [pid]);
  const reg = await db.one('select count(*)::int as k from acc_cancellations where book = $1', [BOOK]).catch(() => ({ k: 0 }));
  return { title: 'Inventory', value: `${cnt(T.booked)} of ${cnt(T.units)} sold`, sub: `Sale value booked ${cr(T.agreementValue)}`,
    lines: [['Registered', `${cnt(T.registered)} · ${cr(T.registeredValue)}`], ['Booked, not registered', cnt(T.booked - T.registered), T.booked - T.registered ? 'warn' : ''],
      ['Available', cnt(T.available)], ['Held (management, sales team)', cnt(T.held)], ['Cancelled', cnt(Math.max(canc.k, reg.k))]],
    link: '#/units', tone: '' };
}
async function demandsVsReceived(dash, pid) {
  const raised = await db.q(`select d.stage_name, min(d.demand_date) as first from demands d join bookings b on b.id = d.booking_id join units u on u.id = b.unit_id
    where u.project_id = $1 and d.status = 'raised' and b.status = 'active' group by d.stage_name`, [pid]);
  const R = new Set(raised.map((r) => r.stage_name));
  const st = dash.paymentSchedule.rows.filter((r) => R.has(r.stage));
  const T = dash.totals;
  const rec = T.receivedAV + T.receivedTDS, bal = Math.max(0, T.demanded - rec);
  return { title: 'Demands raised vs received', value: `${T.demanded ? Math.round((rec / T.demanded) * 100) : 0}% received`, sub: `${cr(T.demanded)} demanded · ${cr(rec)} received (AV + TDS)`,
    lines: st.slice(-5).map((r) => [r.stage.replace(/^On (Completion of )?/i, '').replace(/^\w/, (c) => c.toUpperCase()), `${r.due ? Math.round((r.received / r.due) * 100) : 0}% of ${cr(r.due)}`, r.balance > 1000 ? 'warn' : 'good']).concat([['Balance on demands raised', cr(bal), bal ? 'warn' : 'good']]),
    link: '#/demands', tone: '' };
}
async function followups(t, pid) {
  const f = await db.one(`select count(*) filter (where f.next_date is null or f.next_date <= $2)::int as due,
        count(*) filter (where f.promise_date < $2 and (bb.last_receipt is null or bb.last_receipt < f.created_at::date))::int as broken,
        count(*) filter (where f.id is null or f.created_at < $3::date)::int as stale,
        count(*) filter (where f.promise_date between $2 and ($2::date + 7))::int as promised_k,
        coalesce(sum(coalesce(f.promise_amount, 0)) filter (where f.promise_date between $2 and ($2::date + 7)), 0) as promised,
        count(*)::int as with_dues
      from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
      left join lateral (select * from follow_ups z where z.booking_id = b.id order by z.created_at desc limit 1) f on true
     where u.project_id = $1 and b.status = 'active' and bb.overdue + bb.gst_outstanding > 1000`, [pid, t, addDays(t, -15)]);
  const calls = await db.one("select count(*)::int as k from follow_ups where created_at >= now() - interval '7 days'");
  return { title: 'Follow-ups', value: `${cnt(f.due)} to call today`, sub: `${plural(f.with_dues, 'buyer')} with dues · ${plural(calls.k, 'call')} logged in the last 7 days`,
    lines: [['Promises broken', cnt(f.broken), f.broken ? 'bad' : 'good'], ['Not contacted in 15 days', cnt(f.stale), f.stale ? 'warn' : 'good'],
      ['Promised in the next 7 days', `${cnt(f.promised_k)} · ${cr(f.promised)}`]],
    link: '#/followups', tone: f.broken ? 'bad' : f.due ? 'warn' : 'good' };
}
async function cancelled() {
  const canc = require('./cancellations');
  const rows = await canc.calc(await db.q('select * from acc_cancellations where book = $1 order by cancel_date nulls last, id', [BOOK]));
  const pend = rows.filter((r) => !canc.refunded(r.refund_status));
  const toRefund = pend.reduce((a, r) => a + n(r.to_refund), 0);
  const paid = await db.one(`select coalesce(sum(amount), 0) as amt from acc_payments where book = $1 and head = 'Flat - Cancelled Refunded'`, [BOOK]);
  const free = rows.filter((r) => /No booking|free to book/.test(r.crm_now)).length;
  const still = rows.filter((r) => /CRM not cancelled/.test(r.crm_now)).length;
  return { title: 'Cancelled flats', value: `${cnt(rows.length)} cancelled`, sub: `Refund still to pay ${cr(toRefund)} on ${plural(pend.length, 'flat')}`,
    lines: [['Refunds paid so far', cr(paid.amt)], ['Not rebooked yet', cnt(free), free ? 'warn' : 'good'], ['Still booked in the CRM', cnt(still), still ? 'bad' : 'good']],
    link: '#/reg-cancellations', tone: still ? 'bad' : toRefund ? 'warn' : '' };
}

// ---------- Construction and purchase ----------
// The slab schedule worked out as the Site Office page does (page-site2.js compute): dates as day numbers.
const dn = (s) => (s ? Math.floor(Date.parse(String(s).slice(0, 10)) / 864e5) : null);
function towerState(tw, progress, t) {
  const T = dn(t);
  let cursor = null;
  const rows = [...(tw.slabs || [])].sort((a, b) => a.seq - b.seq).map((s) => {
    const p = progress[s.id] || {}, status = p.status || 'pending', hol = +p.holidays || 0, dd = s.days || 0, ps = dn(s.planStart), pe = dn(s.planEnd);
    let fs, fe;
    if (status === 'cast') { fe = dn(p.actualEnd) ?? pe; fs = dn(p.actualStart) ?? ps ?? fe; }
    else if (status === 'progress') { fs = dn(p.actualStart) ?? (cursor != null ? cursor + 1 : ps) ?? T; fe = Math.max(fs + dd + hol, T); }
    else { fs = Math.max(cursor != null ? cursor + 1 : (ps ?? T), T); fe = fs + dd + hol; }
    cursor = fe;
    return { name: s.name, status, fe, pe, actualEnd: p.actualEnd };
  });
  const cast = rows.filter((r) => r.status === 'cast');
  const cur = rows.find((r) => r.status !== 'cast') || null, last = rows[rows.length - 1];
  return { name: tw.name || tw.key, order: tw.order || 0, total: rows.length, cast: cast.length, cur, lastCast: cast.map((r) => r.actualEnd).filter(Boolean).sort().pop() || null, delay: last && last.pe != null ? last.fe - last.pe : 0 };
}
async function site(t) {
  let [towers, progress, dpr] = await Promise.all([kvAll('site:towers'), kvAll('site:progress'), kvAll('site:dpr')]);
  if (!Object.keys(towers).length) { const seed = require('./portal/site-seed.json'); towers = seed.towers; progress = { ...(seed.progress || {}), ...progress }; }
  const ts = Object.values(towers).filter((x) => x && Array.isArray(x.slabs)).map((x) => towerState(x, progress, t)).sort((a, b) => a.order - b.order);
  if (!ts.length) return { title: 'Site progress', value: '—', sub: 'The slab schedule is not in the ERP yet.', lines: [], link: '/site', tone: '' };
  const worst = Math.max(...ts.map((x) => x.delay));
  const dates = Object.keys(dpr).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const lastDpr = dates.pop(), todays = dpr[t];
  return { title: 'Site progress', value: `${cnt(ts.reduce((a, x) => a + x.cast, 0))} of ${cnt(ts.reduce((a, x) => a + x.total, 0))} slabs cast`,
    sub: todays ? `Manpower today ${cnt(todays.total || 0)}` : lastDpr ? `No DPR today · last ${fmtD(lastDpr)}` : 'No daily progress reports yet',
    lines: ts.map((x) => [`${x.name}: ${x.cur ? x.cur.name + ' next' : 'structure done'}${x.lastCast ? ' · last cast ' + fmtD(x.lastCast) : ''}`, x.delay > 0 ? `${x.delay}d behind` : x.delay < 0 ? `${-x.delay}d ahead` : 'On time', x.delay > 15 ? 'bad' : x.delay > 0 ? 'warn' : 'good']),
    link: '/site', tone: worst > 15 ? 'bad' : worst > 0 ? 'warn' : 'good' };
}
async function hindrances(t) {
  const all = Object.values(await kvAll('site:hindrances')).filter(Boolean);
  const open = all.filter((h) => h.status !== 'resolved').sort((a, b) => String(a.from || '').localeCompare(String(b.from || '')));
  const lost = open.reduce((a, h) => a + n(h.daysLost), 0);
  const oldest = open[0];
  return { title: 'Hindrances open', value: cnt(open.length), sub: oldest ? `Oldest open ${ago(days(oldest.from, t))}: ${oldest.category || ''}${oldest.tower ? ' · ' + oldest.tower : ''}` : 'Nothing blocking work',
    lines: open.slice(0, 3).map((h) => [`${h.category || 'Hindrance'}${h.tower ? ' · ' + h.tower : ''}: ${String(h.description || '').slice(0, 70)}`, `since ${fmtD(h.from)}`]).concat(open.length ? [['Days lost (as logged)', cnt(lost), lost ? 'warn' : '']] : []),
    link: '/site', tone: open.length ? (oldest && days(oldest.from, t) > 7 ? 'bad' : 'warn') : 'good' };
}
async function purchase(t) {
  const orders = Object.values(await kvAll('po:orders')).filter(Boolean);
  for (const o of orders) if (o.status === 'requested' && !o.approval) o.status = 'pending_approval';
  const by = (s) => orders.filter((o) => o.status === s);
  const pa = by('pending_approval').sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const m0 = t.slice(0, 8) + '01';
  const month = orders.filter((o) => o.order && iso(o.order.at) >= m0 && !['rejected', 'cancelled'].includes(o.status));
  // RMC and steel against the BOQ budget (received, else ordered, else requested quantity), as the Purchase page counts
  const B = require('./portal/purchase-budget.json');
  const lines = [...(B.lines || []), ...(B.extra || [])];
  const qty = (o) => (['rejected', 'cancelled'].includes(o.status) ? 0 : o.receipt ? +o.receipt.qty || 0 : o.order ? +o.order.qty || 0 : +o.qty || 0);
  const use = (m, f) => { const budget = lines.reduce((a, l) => a + n(l[f]), 0); const used = lines.reduce((a, l) => a + n(l.opening && l.opening[f]), 0) + orders.filter((o) => o.material === m).reduce((a, o) => a + qty(o), 0); return budget ? Math.round((used / budget) * 100) : null; };
  const rmc = use('RMC', 'rmc'), steel = use('Steel', 'steel');
  return { title: 'Purchase', value: `${cnt(pa.length)} waiting for approval`, sub: pa.length ? `Oldest waiting ${ago(days(pa[0].requestedAt, t))}` : 'No requests waiting for Management',
    lines: [['Ordered this month', `${cnt(month.length)} · ${cr(month.reduce((a, o) => a + n(o.order.amount), 0))}`], ['Ordered, not received at site', cnt(by('ordered').length), by('ordered').length ? 'warn' : ''],
      ['Received, bill with Accounts', cnt(by('received').length)], ['Approved bills to pay', `${cnt(by('accounts_ok').length)} · ${cr(by('accounts_ok').reduce((a, o) => a + n((o.accounts && o.accounts.payable) || (o.order && o.order.amount)), 0))}`],
      ['Budget used: RMC · steel', `${rmc == null ? '—' : rmc + '%'} · ${steel == null ? '—' : steel + '%'}`]],
    link: '/purchase', tone: pa.length && days(pa[0].requestedAt, t) > 2 ? 'bad' : pa.length ? 'warn' : 'good' };
}

// ---------- Control and compliance ----------
async function approvals(t, pid) {
  const one = (sql, a) => db.one(sql, a);
  const [bk, rc, dr, cn] = await Promise.all([
    one("select count(*)::int as k, min(b.created_at) as since from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'pending' and not b.sample", [pid]),
    one("select count(*)::int as k, min(created_at) as since from receipts where project_id = $1 and status = 'pending'", [pid]),
    one("select count(*)::int as k, min(created_at) as since from demand_runs where project_id = $1 and status = 'draft'", [pid]),
    one("select count(*)::int as k, min(b.cancel_requested_at) as since from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status = 'active' and b.cancel_requested_at is not null", [pid]),
  ]);
  const po = Object.values(await kvAll('po:orders')).filter((o) => o && (o.status === 'pending_approval' || (o.status === 'requested' && !o.approval)));
  const poSince = po.map((o) => o.requestedAt).filter(Boolean).sort()[0] || null;
  const items = [['Bookings', bk.k, bk.since, '#/bookings'], ['Receipts', rc.k, rc.since, '#/receipts'], ['Demand runs', dr.k, dr.since, '#/demands'], ['Cancellations', cn.k, cn.since, '#/bookings'], ['Purchase requests', po.length, poSince, '/purchase']];
  const total = items.reduce((a, x) => a + x[1], 0);
  const oldest = Math.max(0, ...items.filter((x) => x[1] && x[2]).map((x) => days(x[2], t)));
  return { title: 'Waiting for approval', value: cnt(total), sub: !total ? 'Nothing waiting' : oldest ? `Oldest has waited ${ago(oldest)}` : 'All came in today',
    lines: items.map(([l, k, s, href]) => [l, k ? `${cnt(k)} · ${ago(days(s, t))}` : '0', k && days(s, t) > 2 ? 'bad' : k ? 'warn' : 'good', href]),
    link: '#/bookings', tone: oldest > 2 ? 'bad' : total ? 'warn' : 'good' };
}
async function tallyVsCrm(pid) {
  const s = await require('./books-vs-crm').summary(pid);
  const off = s.rows.filter((r) => !['Agrees', 'Nothing received'].includes(r.state));
  const agree = (s.byState.Agrees || { n: 0 }).n;
  const run = await db.one("select run_at from daily_audit_runs where dept = 'accounts' order by run_at desc limit 1").catch(() => null);
  return { title: 'Tally vs CRM', value: cr(s.totals.books - s.totals.crm), sub: `Tally ${cr(s.totals.books)} · CRM ${cr(s.totals.crm)}`,
    lines: [['Flats that agree', cnt(agree), 'good'], ['Flats that differ', cnt(off.length), off.length ? 'warn' : 'good'], ['More in Tally', cnt(off.filter((r) => r.state === 'More in the books').length)], ['More in the CRM', cnt(off.filter((r) => r.state === 'More in the CRM').length)]]
      .concat(run ? [['Last 9 am audit', fmtD(new Date(Date.parse(run.run_at) + 5.5 * 3600000))]] : []),
    link: '#/bookscrm', tone: off.length > 10 ? 'bad' : off.length ? 'warn' : 'good' };
}
async function compliance(t, tax) {
  const rows = await db.q("select compliance, law, period, due_date from acc_compliance where book = $1 and coalesce(status, 'Pending') = 'Pending' and due_date <= $2 order by due_date", [BOOK, addDays(t, 15)]);
  const mine = rows.filter((c) => TAX.test(`${c.compliance} ${c.law}`) === tax);
  const late = mine.filter((c) => iso(c.due_date) < t), soon = mine.filter((c) => iso(c.due_date) >= t);
  return { title: tax ? 'Tax filings due' : 'Compliance due', value: `${cnt(soon.length)} in 15 days`, sub: late.length ? `${plural(late.length, 'item')} overdue` : 'Nothing overdue',
    lines: [...late.slice(0, 3).map((c) => [`${c.compliance}${c.period ? ' (' + c.period + ')' : ''}`, `${days(c.due_date, t)}d late`, 'bad']), ...soon.slice(0, 4).map((c) => [`${c.compliance}${c.period ? ' (' + c.period + ')' : ''}`, fmtD(c.due_date), days(t, c.due_date) <= 3 ? 'warn' : ''])],
    note: tax ? '' : 'RERA, ROC, labour and other filings. Tax filings are in the Taxes row.',
    link: '#/reg-compliance', tone: late.length ? 'bad' : soon.length ? 'warn' : 'good' };
}

// ---------- Taxes (the CA page's figures, this financial year) ----------
function fyOf(t) { const y = +t.slice(0, 4), m = +t.slice(5, 7); const s = m >= 4 ? y : y - 1; return { from: `${s}-04`, to: `${s + 1}-03`, label: `FY ${s}-${String(s + 1).slice(2)}` }; }
async function taxes(t, dash) {
  const M = (await require('./ca-data').model()).summary;
  const fy = fyOf(t), inFy = (k) => k && k !== '-' && k >= fy.from && k <= fy.to;
  const sumM = (o) => Object.entries(o || {}).reduce((a, [k, v]) => a + (inFy(k) ? v : 0), 0);
  const G = M.gst, R = n(M.settings.gstRate) || 0.05;
  const net = sumM(G.av) + sumM(G.avOther) - sumM(G.ref) + sumM(G.tds), gstDue = net * R, gstPaid = sumM(G.gstPaid), gstIn = sumM(G.gstIn);
  const gstTile = { key: 'gst', title: 'GST', value: cr(gstDue - gstPaid), sub: `Due less paid, ${fy.label} (before input credit)`,
    lines: [[`GST at ${Math.round(R * 1000) / 10}% on consideration received`, cr(gstDue)], ['GST paid to government', cr(gstPaid)], ['GST collected from buyers', cr(gstIn)], ['GST still to collect from buyers', cr(dash ? dash.totals.gstDue : 0), dash && dash.totals.gstDue > 1000 ? 'warn' : '']],
    link: '/ca', tone: gstDue - gstPaid > 1000 ? 'warn' : 'good' };
  // TDS on what we pay vendors, contractors, consultants, CPs and landlords
  const MAP = M.map.Payment, sec = (h) => (MAP[h] || {}).tsec || '', rate = (h) => (MAP[h] || {}).trate || 0;
  let exp = 0, paidTds = 0;
  for (const h of Object.keys(M.payBy)) { const s = sec(h); if (!s || s === '192') continue; const a = sumM(M.payBy[h]); paidTds += a; const r = rate(h); exp += r ? (a * r) / (1 - r) : 0; }
  const dep = -sumM(M.lineBy['TDS deposited']);
  const vb = M.vb.filter((b) => inFy(b.ym)), ded = vb.reduce((a, b) => a + n(b.tds), 0);
  const short = Math.max(0, exp - dep);
  const pdcT = await require('./accounts').pdcTdsIssues().catch(() => []);
  const tdsTile = { key: 'tdspay', title: 'TDS on our payments', value: cr(short), sub: `Possible shortfall, ${fy.label}: expected less deposited`,
    lines: [...(pdcT.length ? [['TDS paid before the PDC cleared', cnt(pdcT.length), 'bad']] : []), ['Paid to vendors, contractors, CPs', cr(paidTds)], ['TDS expected at standard rates', cr(exp)], ['TDS deposited with government', cr(dep)], ['TDS deducted on bills entered', vb.length ? cr(ded) : 'No bills entered']],
    link: pdcT.length ? '#/reg-pdc' : '/ca', tone: short > 1000 || pdcT.length ? 'bad' : 'good' };
  // TDS deducted by buyers (section 194-IA)
  const C = M.ctds, f16 = C.entries.filter((e) => !/^y/i.test(e.f16));
  const ctTile = { key: 'tdsbuyers', title: 'TDS by buyers (194-IA)', value: `${cr(C.paid)} of ${cr(C.due)}`, sub: `1% of agreement value on ${plural(C.flats, 'flat')}`,
    lines: [['Still to be paid by buyers', cr(Math.max(0, C.due - C.paid)), C.due - C.paid > 1000 ? 'warn' : 'good'], ['Challans on the TDS Tracker', cnt(C.entries.length)], ['Form 16B not received yet', `${cnt(f16.length)} · ${cr(f16.reduce((a, e) => a + n(e.amt), 0))}`, f16.length ? 'warn' : 'good']],
    link: '#/reg-tds', tone: f16.length ? 'warn' : '' };
  return [gstTile, tdsTile, ctTile];
}

async function build({ projectId, now = new Date() } = {}) {
  const t = istToday();
  const pid = projectId || (await db.one("select id from projects where code = 'SIGNATURE'"))?.id || (await db.one('select id from projects where active order by id limit 1'))?.id;
  if (!pid) return { today: t, sections: [] };
  const project = await db.one('select id, name from projects where id = $1', [pid]);
  const dash = await require('./dashboard').build(pid).catch((e) => { console.error('mgmt dashboard', e.message); return null; });
  const needDash = (f) => () => { if (!dash) throw new Error('collections figures not available'); return f(dash); };
  const [money, crm, site_, control, tax] = await Promise.all([
    Promise.all([tile('cash', () => cashInBank(t)), tile('today', () => todayCollections(t)), tile('month', () => monthCollections(t, pid)), tile('overdue', () => overdue(t, pid)), tile('pdc', () => pdc(t))]),
    Promise.all([tile('inventory', needDash((d) => inventory(d, pid))), tile('demands', needDash((d) => demandsVsReceived(d, pid))), tile('followups', () => followups(t, pid)), tile('cancelled', cancelled)]),
    Promise.all([tile('site', () => site(t)), tile('hindrances', () => hindrances(t)), tile('purchase', () => purchase(t))]),
    Promise.all([tile('approvals', () => approvals(t, pid)), tile('tally', () => tallyVsCrm(pid)), tile('compliance', () => compliance(t, false))]),
    (async () => { let ts; try { ts = await taxes(t, dash); } catch (e) { console.error('mgmt taxes', e.message); ts = [{ key: 'gst', title: 'GST, TDS', value: '—', sub: 'Could not be worked out just now.', lines: [] }]; } return [...ts, await tile('taxdue', () => compliance(t, true))]; })(),
  ]);
  return {
    today: t, generatedAt: now.toISOString(), project,
    sections: [
      { key: 'money', title: 'Money today', tiles: money },
      { key: 'crm', title: 'Sales & CRM', tiles: crm },
      { key: 'site', title: 'Construction & purchase', tiles: site_ },
      { key: 'control', title: 'Control & compliance', tiles: control },
      { key: 'tax', title: 'Taxes', tiles: tax },
    ],
  };
}

module.exports = { build, TAX };
