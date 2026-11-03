// Pre-demand notices: advance word to a building's buyers that the demand for a coming stage (e.g. Plinth, A Wing)
// will be raised in about two weeks, with what it will be, so they arrange funds and their bank's disbursement and pay
// promptly once the demand letter comes. Nothing is charged: the demand itself is still raised by a demand run.
// CRM prepares (demand.raise); Head CRM approves (demand.approve, not their own) and the notices go out: emailed with
// the PDF on the letterhead (the first 30 at once, the rest with the 5-minute mail job), logged on each buyer's
// communications, and a follow-up note on the flat. Buyers with no email are listed to print and courier.
// Until the ERP is live (ERP_LIVE=1) every email goes only to the test address in Letter settings.
const db = require('./db');
const audit = require('./audit');
const mailer = require('./mailer');
const L = require('./letters');
const { buildPreNotice, buildManyPre } = require('./demand-letter');
const { daysToPay, today } = require('./demands');
const { toPaise } = require('./money');
const { fail } = require('./http');

const NOW_LIMIT = 30;
const iso = (d) => String(d instanceof Date ? d.toISOString() : d || '').slice(0, 10);
const rupees = (p) => Math.round(p / 100);

// Active bookings in the building that have not had this stage demanded, with what the demand will be.
async function eligible({ buildingId, stageName }) {
  return db.q(
    `select b.id as booking_id, u.unit_no, b.agreement_value, b.gst_rate, s.pct, bb.outstanding, bb.gst_outstanding,
            (select string_agg(y.name, ' & ' order by ap.seq) from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id) as buyers,
            exists (select 1 from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = b.id and y.email like '%@%') as has_email
       from bookings b join units u on u.id = b.unit_id join plan_stages s on s.plan_id = b.plan_id and s.name = $2
       join booking_balances bb on bb.booking_id = b.id
      where u.building_id = $1 and b.status = 'active' and b.cancel_requested_at is null
        and not exists (select 1 from demands d where d.booking_id = b.id and d.stage_name = $2)
      order by u.unit_no`, [buildingId, stageName]);
}

// The amounts for one row: the coming instalment, its GST, anything already overdue, and the total to keep ready.
function amounts(r, minDue) {
  const inst = Math.round(Number(r.agreement_value) * Number(r.pct)) / 100;
  const gst = Math.round(inst * Number(r.gst_rate || 0)) / 100;
  let arrears = rupees(toPaise(r.outstanding)) + rupees(toPaise(r.gst_outstanding));
  if (arrears <= (Number(minDue) || 0)) arrears = 0; // a few rupees of rounding is not "pending"
  const instalment = Math.round(inst), gstR = Math.round(gst);
  return { instalment, gst: gstR, arrears, total: instalment + gstR + arrears };
}

// Everything the letter needs for one booking.
async function figures({ bookingId, stageName, expectedDate, building, set, days, note }) {
  const b = await db.one(`select b.id, b.agreement_value, b.gst_rate, u.unit_no, p.name as project, s.pct, bb.outstanding, bb.gst_outstanding
      from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id join booking_balances bb on bb.booking_id = b.id
      join plan_stages s on s.plan_id = b.plan_id and s.name = $2 where b.id = $1`, [bookingId, stageName]);
  if (!b) throw fail(400, 'That flat is not on this payment plan stage.');
  const ap = await db.q('select y.name, y.phone, y.email, y.address from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [bookingId]);
  const a = amounts(b, set.minDue);
  return {
    letterType: 'Pre-Demand Notice', unit: b.unit_no, projectName: b.project, reference: set.reference || undefined,
    name: ap.map((x) => x.name).join(' & '), addressLines: String(ap[0]?.address || '').split(/\n|,\s*(?=\S)/).map((x) => x.trim()).filter(Boolean).slice(0, 4),
    phone: ap[0]?.phone || '', email: ap.flatMap((x) => L.emails(x.email)).join(' / '),
    words: L.words(stageName), building, pct: Number(b.pct) / 100, letterDate: today(), expectedDate: iso(expectedDate), daysToPay: days,
    av: Math.round(Number(b.agreement_value)), ...a, note: note || null,
    signedFor: set.signedFor, signatory: set.signatory || null, signatoryTitle: set.signatoryTitle || null, banks: L.letterBanks(set),
  };
}

async function overview(projectId) {
  return db.q(`select n.id, n.building_id, bl.code as building, bl.name as building_name, n.stage_name, n.expected_date, n.status, n.created_at,
      c.name as created_by_name, a.name as approved_by_name, n.approved_at,
      (select count(*)::int from predemand_items i where i.notice_id = n.id) as items,
      (select count(*)::int from predemand_items i where i.notice_id = n.id and i.sent_at is not null) as sent
    from predemand_notices n join buildings bl on bl.id = n.building_id left join users c on c.id = n.created_by left join users a on a.id = n.approved_by
    where n.project_id = $1 order by n.created_at desc`, [projectId]);
}

async function create({ user, buildingId, stageName, expectedDate, note }) {
  const bld = await db.one('select id, project_id, code, name from buildings where id = $1', [buildingId]);
  if (!bld) throw fail(404, 'Building not found.');
  const stage = await db.one('select s.name from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active and s.construction_linked and s.name = $2 limit 1', [bld.project_id, stageName]);
  if (!stage) throw fail(400, 'Choose a construction stage from the payment plan.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate || '') || expectedDate <= today()) throw fail(400, 'Enter the date the demand is expected (a date after today).');
  const raised = await db.one("select 1 as x from demand_runs where building_id = $1 and stage_name = $2 and status = 'approved'", [bld.id, stage.name]);
  if (raised) throw fail(409, `The ${stage.name} demand has already been raised for ${bld.name}; a pre-demand notice is no longer needed.`);
  const rows = await eligible({ buildingId: bld.id, stageName: stage.name });
  if (!rows.length) throw fail(400, 'No active buyers in this building are waiting for this stage.');
  return db.tx(async (t) => {
    const open = await t.one("select id from predemand_notices where building_id = $1 and stage_name = $2 and status = 'draft'", [bld.id, stage.name]);
    if (open) throw fail(409, 'A pre-demand notice for this stage is already waiting for approval.');
    const r = await t.one('insert into predemand_notices (project_id, building_id, stage_name, expected_date, note, created_by) values ($1, $2, $3, $4, $5, $6) returning id',
      [bld.project_id, bld.id, stage.name, expectedDate, note || null, user.id]);
    await audit.record(t.q, { user, action: 'create', entity: 'predemand', entityId: r.id, projectId: bld.project_id, after: { building: bld.code, stage: stage.name, expectedDate, buyers: rows.length } });
    return { id: r.id, projectId: bld.project_id };
  });
}

// One notice with its rows: while a draft, worked out live; once approved, the letters as they were sent.
async function detail(id) {
  const n = await db.one(`select n.*, bl.code as building, bl.name as building_name, c.name as created_by_name, a.name as approved_by_name
      from predemand_notices n join buildings bl on bl.id = n.building_id left join users c on c.id = n.created_by left join users a on a.id = n.approved_by where n.id = $1`, [id]);
  if (!n) throw fail(404, 'Pre-demand notice not found.');
  const set = await L.settings();
  if (n.status === 'draft') {
    const rows = (await eligible({ buildingId: n.building_id, stageName: n.stage_name })).map((r) => ({ booking_id: r.booking_id, unit_no: r.unit_no, buyers: r.buyers, has_email: r.has_email, pct: Number(r.pct), ...amounts(r, set.minDue) }));
    return { notice: n, rows };
  }
  const rows = await db.q(`select i.id, i.booking_id, u.unit_no, i.figures, i.sent_via, i.sent_to, i.sent_at, i.send_error,
      exists (select 1 from booking_applicants ap join buyers y on y.id = ap.buyer_id where ap.booking_id = i.booking_id and y.email like '%@%') as has_email
      from predemand_items i join bookings b on b.id = i.booking_id join units u on u.id = b.unit_id where i.notice_id = $1 order by u.unit_no`, [id]);
  return { notice: n, rows: rows.map((r) => ({ id: r.id, booking_id: r.booking_id, unit_no: r.unit_no, buyers: r.figures.name, has_email: r.has_email, pct: r.figures.pct * 100, instalment: r.figures.instalment, gst: r.figures.gst, arrears: r.figures.arrears, total: r.figures.total, sent_via: r.sent_via, sent_to: r.sent_to, sent_at: r.sent_at, send_error: r.send_error })) };
}

// Email saved notices (predemand_items ids). Returns [{ id, unit, to } | { id, unit, error }].
async function emailItems(ids, { set, user } = {}) {
  set = set || await L.settings();
  const why = L.cannotEmail(set); if (why) throw fail(400, why);
  const items = await db.q(`select i.*, b.sample, u.unit_no, u.project_id,
      (select string_agg(y.email, ',') from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = i.booking_id) as emails
      from predemand_items i join bookings b on b.id = i.booking_id join units u on u.id = b.unit_id where i.id = any($1::int[]) and b.status = 'active'`, [ids]);
  const out = [];
  const conn = await mailer.connect();
  try {
    for (const it of items) {
      const real = L.emails(it.emails);
      const to = L.live() && !it.sample ? real : [set.testEmail];
      if (!to.length) { out.push({ id: it.id, unit: it.unit_no, error: 'no email address' }); continue; }
      const f = it.figures;
      const subj = `Advance notice: ${f.words} demand for ${f.projectName || 'Dream Signature'} ${f.unit} expected around ${L.dmy(f.expectedDate)}`;
      const text = `Dear ${f.name},\n\nWe are pleased to share that the ${f.words} work of ${f.building} is progressing well, and we expect to raise the demand for it around ${L.dmy(f.expectedDate)}.\n\n`
        + `As per your payment schedule, the instalment on this milestone is ${Math.round(f.pct * 100)}% of the agreement value: ${L.rs(f.instalment)} plus GST of ${L.rs(f.gst)}.`
        + (f.arrears ? ` An earlier balance of ${L.rs(f.arrears)} is also pending on your account.` : '')
        + ` We request you to keep ${L.rs(f.total)} ready${f.arrears ? ', and to clear the pending balance now' : ''}.\n\n`
        + `The formal demand letter will follow on completion, and payment will then be due within ${f.daysToPay} days. If your flat is on a home loan, please share the attached notice with your bank now so the disbursement is ready in time.\n\n`
        + `Your prompt payment helps us keep construction on schedule. This is advance information only; no payment is due until the demand letter is issued.${f.note ? '\n\n' + f.note : ''}\n\nWarm regards,\n${f.signedFor}`;
      try {
        const sent = await conn.send({
          to, cc: L.live() && !it.sample ? L.emails(set.cc) : [], subject: subj + (L.live() ? '' : ' [TEST]'), text,
          attachments: [{ filename: `${f.unit}_Pre-Demand_Notice.pdf`, content: buildPreNotice(f), type: 'application/pdf' }],
        });
        await require('./comms').logSent({ bookingId: it.booking_id, to, subject: subj, body: `Pre-demand notice for ${f.unit}: ${f.words} demand expected around ${L.dmy(f.expectedDate)}; keep ${L.rs(f.total)} ready (PDF attached).`, sent, kind: 'predemand', userId: user ? user.id : null, test: !L.live() });
        await db.q("update predemand_items set sent_via = 'email', sent_to = $2, sent_at = now(), send_error = null where id = $1", [it.id, to.join(', ')]);
        out.push({ id: it.id, unit: it.unit_no, to: to.join(', ') });
      } catch (e) {
        await db.q('update predemand_items set send_error = $2 where id = $1', [it.id, String(e.message).slice(0, 300)]);
        out.push({ id: it.id, unit: it.unit_no, error: e.message });
      }
    }
  } finally { await conn.close().catch(() => {}); }
  return out;
}

// Head CRM approves: a letter saved for every buyer, the first 30 emailed now, a follow-up note on each flat.
async function approve({ user, id }) {
  const n = await db.one('select n.*, bl.name as building_name from predemand_notices n join buildings bl on bl.id = n.building_id where n.id = $1', [id]);
  if (!n) throw fail(404, 'Pre-demand notice not found.');
  if (n.status !== 'draft') throw fail(409, 'This notice is no longer a draft.');
  if (n.created_by === user.id) throw fail(403, 'Someone else must approve what you prepared.');
  if (iso(n.expected_date) <= today()) throw fail(400, 'The expected demand date has passed. Cancel this notice and prepare a new one with a new date.');
  const set = await L.settings();
  const days = await daysToPay(db);
  const rows = await eligible({ buildingId: n.building_id, stageName: n.stage_name });
  const made = [];
  // worked out before the transaction: it reads with its own connection
  const figs = [];
  for (const r of rows) figs.push(await figures({ bookingId: r.booking_id, stageName: n.stage_name, expectedDate: n.expected_date, building: n.building_name, set, days, note: n.note }));
  await db.tx(async (t) => {
    const locked = await t.one('select status from predemand_notices where id = $1 for update', [n.id]);
    if (locked.status !== 'draft') throw fail(409, 'This notice is no longer a draft.');
    for (const [i, r] of rows.entries()) {
      const f = figs[i];
      const it = await t.one('insert into predemand_items (notice_id, booking_id, figures) values ($1, $2, $3) on conflict do nothing returning id', [n.id, r.booking_id, f]);
      if (it) made.push({ id: it.id, bookingId: r.booking_id, hasEmail: r.has_email, total: f.total });
      await t.q("insert into follow_ups (booking_id, kind, outcome, note, next_date, created_by) values ($1, 'Note', 'Pre-demand notice', $2, $3, $4)",
        [r.booking_id, `Pre-demand notice: ${n.stage_name} demand expected around ${L.dmy(n.expected_date)}; asked to keep ${L.rs(f.total)} ready${f.arrears ? ' (includes ' + L.rs(f.arrears) + ' already pending)' : ''}.${r.has_email ? '' : ' No email on file: print and courier, or call.'}`.slice(0, 1000), iso(n.expected_date), user.id]);
    }
    await t.q("update predemand_notices set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [n.id, user.id]);
    await audit.record(t.q, { user, action: 'approve', entity: 'predemand', entityId: n.id, projectId: n.project_id, after: { notices: made.length } });
  });
  const why = L.cannotEmail(set);
  let results = [];
  if (!why) results = await emailItems(made.filter((m) => m.hasEmail).slice(0, NOW_LIMIT).map((m) => m.id), { set, user }).catch((e) => made.map((m) => ({ id: m.id, error: e.message })));
  const ok = results.filter((r) => !r.error).length;
  return { notices: made.length, emailed: ok, waiting: why ? 0 : made.filter((m) => m.hasEmail).length - results.length, noEmail: made.filter((m) => !m.hasEmail).length, notEmailed: why, errors: results.filter((r) => r.error).length };
}

async function cancel({ user, id }) {
  const n = await db.one('select * from predemand_notices where id = $1', [id]);
  if (!n) throw fail(404, 'Pre-demand notice not found.');
  if (n.status !== 'draft') throw fail(409, 'Only a draft can be cancelled; this one has been sent.');
  await db.tx(async (t) => {
    await t.q("update predemand_notices set status = 'cancelled' where id = $1", [n.id]);
    await audit.record(t.q, { user, action: 'cancel', entity: 'predemand', entityId: n.id, projectId: n.project_id });
  });
  return { ok: true, projectId: n.project_id };
}

// The 5-minute mail job: approved notices from the last 3 days still waiting to be emailed (never tried).
async function sendPending(limit = NOW_LIMIT) {
  const set = await L.settings();
  if (L.cannotEmail(set)) return { sent: 0 };
  const rows = await db.q(`select i.id from predemand_items i join predemand_notices n on n.id = i.notice_id join bookings b on b.id = i.booking_id
      where n.status = 'approved' and n.approved_at > now() - interval '3 days' and i.sent_at is null and i.send_error is null and b.status = 'active'
        and exists (select 1 from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = i.booking_id and y.email like '%@%')
      order by i.id limit $1`, [limit]);
  if (!rows.length) return { sent: 0 };
  const r = await emailItems(rows.map((x) => x.id), { set });
  return { sent: r.filter((x) => !x.error).length, failed: r.filter((x) => x.error).length };
}

// PDFs: one saved notice, a batch (printing for courier), or a preview of one flat on a draft.
async function pdfFor({ itemIds, preview }) {
  if (preview) {
    const n = await db.one('select n.*, bl.name as building_name from predemand_notices n join buildings bl on bl.id = n.building_id where n.id = $1', [preview.noticeId]);
    if (!n) throw fail(404, 'Pre-demand notice not found.');
    const f = await figures({ bookingId: preview.bookingId, stageName: n.stage_name, expectedDate: n.expected_date, building: n.building_name, set: await L.settings(), days: await daysToPay(db), note: n.note });
    return { buf: buildPreNotice(f), name: `preview_${f.unit}_Pre-Demand_Notice.pdf`, projectId: n.project_id };
  }
  const rows = await db.q('select i.figures, u.unit_no, u.project_id from predemand_items i join bookings b on b.id = i.booking_id join units u on u.id = b.unit_id where i.id = any($1::int[]) order by u.unit_no', [itemIds]);
  if (!rows.length) throw fail(404, 'Notice not found.');
  return rows.length === 1 ? { buf: buildPreNotice(rows[0].figures), name: `${rows[0].unit_no}_Pre-Demand_Notice.pdf`, projectId: rows[0].project_id }
    : { buf: buildManyPre(rows.map((r) => r.figures)), name: `pre-demand_notices_${today()}.pdf`, projectId: rows[0].project_id };
}

// Courier list after sending: saved notices for buyers with no email, marked as couriered by hand.
async function markCouriered({ user, id }) {
  const n = await db.one('select project_id from predemand_notices where id = $1', [id]);
  if (!n) throw fail(404, 'Pre-demand notice not found.');
  const r = await db.q(`update predemand_items i set sent_via = 'courier', sent_at = now() where i.notice_id = $1 and i.sent_at is null
      and not exists (select 1 from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = i.booking_id and y.email like '%@%') returning id`, [id]);
  await audit.record(db.q, { user, action: 'courier', entity: 'predemand', entityId: id, projectId: n.project_id, after: { couriered: r.length } });
  return { couriered: r.length };
}

module.exports = { eligible, amounts, overview, create, detail, approve, cancel, sendPending, pdfFor, emailItems, markCouriered };
