// Sales/CRM: price list and cost sheet, booking documents, brokerage, important dates and the forecast.
// DATABASE_URL=postgres://... node scripts/test-sales.js
require('./login-code-helper'); // staff sign-in: password, then the code (ERP_TEST_OTP)
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3996';
const server = require('./dev-server');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, raw) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (raw) return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const costsheet = require('../lib/costsheet');
const docs = require('../lib/docs');
(async () => {
  await step('cost sheet arithmetic: floor rise, parking, GST, stamp duty rounded up, registration capped', async () => {
    const pl = { base_rate: 20000, floor_rise: 50, floor_rise_from: 10, parking_price: 500000, gst_rate: 5, stamp_duty_pct: 6, stamp_duty_women_pct: 5, registration_fee: 30000, other_charges: [{ name: 'Society formation', amount: 25000 }] };
    const plan = [{ seq: 1, name: 'On Booking', pct: 10 }, { seq: 2, name: 'On Plinth', pct: 90 }];
    const c = costsheet.fromPriceList(pl, { unit_no: 'A-2001', floor: 20, carpet_sqft: 532 }, { parking: 1 }, plan);
    assert.equal(c.agreementValue, 532 * (20000 + 50 * 10) + 500000); // 1,14,06,000
    assert.equal(c.gst, Math.round(c.agreementValue * 0.05));
    assert.equal(c.stampDuty, Math.ceil(c.agreementValue * 0.06 / 100) * 100);
    assert.equal(c.registration, 30000); assert.equal(c.tds, Math.round(c.agreementValue / 100));
    assert.equal(c.total, c.agreementValue + c.gst + c.stampDuty + 30000 + 25000);
    assert.equal(c.schedule[1].amount, Math.round(c.agreementValue * 0.9));
    const w = costsheet.fromPriceList(pl, { unit_no: 'A-2001', floor: 20, carpet_sqft: 532 }, { parking: 1, woman: true, discount: 500 }, plan);
    assert.equal(w.agreementValue, 532 * (20500 - 500) + 500000); assert.equal(w.stampDuty, Math.ceil(w.agreementValue * 0.05 / 100) * 100);
    assert.equal(costsheet.regFee(2000000, 30000), 20000);
  });
  await step('amounts in words, Indian style', async () => {
    assert.equal(docs.words(11406000), 'One Crore Fourteen Lakh Six Thousand');
    assert.equal(docs.words(9715000), 'Ninety Seven Lakh Fifteen Thousand');
    assert.equal(docs.words(1234567891), 'One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety One');
  });

  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  assert.equal((await admin('/api/sample', { action: 'load', projectId: sig.id })).ok, true);
  const units = (await admin(`/api/units?project=${sig.id}`)).units;
  const free = units.find((u) => u.status === 'available' && !u.booking_id);
  await step('no price list yet: the cost sheet says so', async () => {
    const r = await admin(`/api/prices?unit=${free.id}`); assert.equal(r.status, 400); assert.match(r.error, /no price list/);
  });
  await step('a price list is saved and used for the cost sheet, as JSON and as a printable page', async () => {
    const r = await admin('/api/prices', { action: 'create', projectId: sig.id, name: 'October 2026', baseRate: '21,000', floorRise: 60, floorRiseFrom: 10, parkingPrice: 600000, otherCharges: [{ name: 'Legal charges', amount: 15000 }] });
    assert.equal(r.ok, true, r.error);
    const c = await admin(`/api/prices?unit=${free.id}&parking=1`);
    assert.equal(c.agreementValue, Math.round(Number(free.carpet_sqft) * (21000 + 60 * Math.max(0, free.floor - 10))) + 600000);
    const h = await admin(`/api/prices?unit=${free.id}&parking=1&html=1&buyer=Test%20Buyer`, null, true);
    assert.match(h.type, /text\/html/); assert.match(h.text, /Cost sheet/); assert.match(h.text, /Legal charges/); assert.match(h.text, /Test Buyer/); assert.match(h.text, /letterhead\/header\.jpg/);
    const l = await admin(`/api/prices?project=${sig.id}`); assert.equal(l.lists.length, 1); assert.equal(l.canEdit, true);
  });
  const ledger = (await admin(`/api/ledger?project=${sig.id}`)).rows;
  const bk = ledger.find((r) => Number(r.outstanding) > 0);
  await step('booking documents: cost sheet, allotment letter and booking form', async () => {
    for (const doc of ['costsheet', 'allotment', 'form']) {
      const h = await admin(`/api/docs?booking=${bk.booking_id}&doc=${doc}`, null, true);
      assert.equal(h.status, 200, doc); assert.match(h.type, /text\/html/);
    }
    const a = await admin(`/api/docs?booking=${bk.booking_id}&doc=allotment`, null, true);
    assert.match(a.text, /Subject: Allotment of Flat No\./); assert.match(a.text, /Rupees .* Only/); assert.match(a.text, /On Booking/);
    const w = await admin(`/api/docs?booking=${bk.booking_id}&doc=welcome`); assert.match(w.subject, /^Welcome to Dream Signature/); assert.match(w.text, /Agreement value: ₹/);
  });
  await step('documents with buyer details need KYC access; sales staff get the cost sheet only', async () => {
    const c = await admin('/api/users', { action: 'create', name: 'Sales One', username: 'sales1', role: 'sales', projects: [sig.id] });
    const s = client(); await s('/api/session', { action: 'login', username: 'sales1', password: c.tempPassword }); await s('/api/session', { action: 'password', current: c.tempPassword, next: 'sales-password-1' });
    assert.equal((await s(`/api/docs?booking=${bk.booking_id}&doc=allotment`, null, true)).status, 403);
    assert.equal((await s(`/api/docs?booking=${bk.booking_id}&doc=costsheet`, null, true)).status, 200);
    assert.equal((await s(`/api/prices?unit=${free.id}`)).status, 200);
    assert.equal((await s('/api/prices', { action: 'create', projectId: sig.id, name: 'x', baseRate: 1 })).status, 403);
    assert.equal((await s(`/api/partners?project=${sig.id}`)).status, 403);
  });
  await step('welcome email refuses while no sending account is connected', async () => {
    const r = await admin('/api/docs', { action: 'welcome', bookingId: bk.booking_id }); assert.equal(r.status, 400); assert.match(r.error, /email account/);
  });
  await step('booking dates and status can be set, and show on the dashboard\'s important dates', async () => {
    const d = new Date(Date.now() + 5.5 * 3600e3 + 5 * 864e5).toISOString().slice(0, 10);
    const r = await admin('/api/bookings', { action: 'dates', id: bk.booking_id, registrationAppointment: d, registrationStatus: 'Registration Lineup', crmStatus: 'Defaulter' });
    assert.equal(r.ok, true, r.error); assert.equal(r.booking.registration_appointment, d); assert.equal(r.booking.crm_status, 'Defaulter');
    assert.equal((await admin('/api/bookings', { action: 'dates', id: bk.booking_id, possessionDate: 'tomorrow' })).status, 400);
    const m = await admin(`/api/dashboard?project=${sig.id}`);
    assert.ok(m.dates.upcoming.some((e) => e.event === 'Registration appointment' && e.unit === bk.unit_no));
    assert.ok(m.dates.lineups.some((e) => e.unit === bk.unit_no));
    assert.ok(m.actions.defaulters.some((e) => e.unit === bk.unit_no));
  });
  await step('forecast: due now, next 30 days, and the next stage of each wing', async () => {
    const m = await admin(`/api/dashboard?project=${sig.id}`);
    const F = m.forecast; assert.ok(F.overdue >= 0); assert.equal(F.nextStages.length, 2);
    const a = F.nextStages.find((x) => x.wing === 'A'), b = F.nextStages.find((x) => x.wing === 'B');
    assert.equal(a.stage, 'On Completion of Plinth'); assert.equal(b.stage, 'On Completion of 5th Slab'); // A has excavation demanded, B plinth
    assert.ok(a.amount > 0 && Math.abs(a.gst - a.amount * 0.05) < 2);
  });
  await step('brokerage: bill, not paid before it is due, paid once due and verified; per-firm totals', async () => {
    const db = require('../lib/db');
    const reg = ledger.find((r) => Number(r.outstanding) >= 0 && r.booking_id !== bk.booking_id);
    const det = await admin(`/api/bookings?id=${reg.booking_id}`);
    const f = await db.one("insert into channel_partners (name, name_key) values ('House of Inani', 'house of inani') on conflict (name_key) do update set name = excluded.name returning id");
    await db.q('update bookings set brokerage = 100000, cp_name = $2, cp_id = $3, sample = false where id = $1', [reg.booking_id, 'House of Inani', f.id]); // the ledger leaves sample bookings out
    const e = (x) => admin('/api/partners', { action: 'cp-entry', projectId: sig.id, cpId: f.id, bookingId: reg.booking_id, ...x });
    assert.equal((await e({ kind: 'bill', amount: 100000, date: '2026-10-01', reference: 'INV-7' })).ok, true);
    const page = async () => { const d = await admin(`/api/partners?project=${sig.id}&cp=${f.id}`); return { d, row: d.bookings.find((r) => r.booking_id === reg.booking_id) }; };
    let { row } = await page();
    assert.equal(Number(row.billed), 100000);
    // make the rule strict so it is not due, then relax it
    await admin('/api/partners', { action: 'rule', afterRegistration: true, minReceivedPct: 99 });
    const early = await e({ kind: 'payment', amount: 50000, date: '2026-10-02', reference: 'UTR1' });
    assert.equal(early.status, 409); assert.match(early.error, /not due yet/);
    await admin('/api/partners', { action: 'rule', afterRegistration: false, minReceivedPct: 0 });
    const p1 = await e({ kind: 'payment', amount: 60000, date: '2026-10-02', reference: 'UTR1' }); assert.equal(p1.ok, true); assert.equal(p1.toVerify, true);
    assert.equal((await e({ kind: 'payment', amount: 50000, date: '2026-10-03', reference: 'UTR2' })).status, 400); // only 40,000 left
    assert.equal((await admin('/api/partners', { action: 'cp-verify', id: p1.id })).ok, true);
    let d; ({ d, row } = await page());
    assert.equal(row.balance, 40000); assert.equal(row.state, 'Due'); assert.equal(d.firm.paid, 60000);
    assert.equal((await admin('/api/partners', { action: 'bill', bookingId: reg.booking_id, amount: 1, date: '2026-10-01', reference: 'X' })).status, 400); // the old per-booking actions are gone
    assert.ok(det.booking.id === reg.booking_id);
  });
  console.log(`\nAll ${n} sales checks passed.`);
  server.close(); require('../lib/db').reset(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
