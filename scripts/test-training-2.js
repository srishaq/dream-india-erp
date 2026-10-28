// Second half of test-training.js: CP ledger, unit transfers, unsold cost list, replies waiting, install as an app.
module.exports = async ({ admin, crm, hcrm, acc, hacc, sig, bks, db, step, assert, day }) => {
  let n = 0; const s = async (name, fn) => { await step(name, fn); n++; };
  try {
    // the sample sheet has few free flats: add some for these checks
    const u0 = await db.one('select u.building_id, u.project_id from units u join bookings b on b.unit_id = u.id where b.id = $1', [bks[0].id]);
    for (let i = 1; i <= 4; i++) await db.q("insert into units (project_id, building_id, unit_no, floor, typology, carpet_sqft, status) values ($1, $2, $3, 30, '2BHK', 600, 'available')", [u0.project_id, u0.building_id, 'A-' + (3000 + i)]);
    await s('CP ledger: firms from the bookings; a booking picks a firm and a %, brokerage worked out', async () => {
      const L = await crm(`/api/partners?project=${sig.id}&ledger=1`);
      assert.ok(L.firms.length >= 1);
      const free = (await admin(`/api/units?project=${sig.id}`)).units.find((x) => x.status === 'available' && !x.booking_id);
      const r = await crm('/api/bookings', { action: 'create', unitId: free.id, bookingDate: day(-3), agreementValue: 8000000, gstRate: 5, parking: 0, funding: 'self', source: 'Channel Partner', cpName: 'New Realty Co.', brokeragePct: 2.5, applicants: [{ name: 'Test Buyer' }] });
      assert.equal(r.ok, true, r.error);
      const bk = await db.one('select b.*, c.name as firm from bookings b join channel_partners c on c.id = b.cp_id where b.id = $1', [r.id]);
      assert.equal(bk.firm, 'New Realty Co.'); assert.equal(Number(bk.brokerage), 200000); assert.equal(Number(bk.brokerage_pct), 2.5);
      assert.equal((await hcrm('/api/bookings', { action: 'approve', id: r.id })).ok, true);
      const again = await crm('/api/bookings', { action: 'create', unitId: (await admin(`/api/units?project=${sig.id}`)).units.find((x) => x.status === 'available' && !x.booking_id).id, bookingDate: day(-2), agreementValue: 5000000, cpName: 'new realty co', brokeragePct: 2, applicants: [{ name: 'Second Buyer' }] });
      assert.equal((await db.one('select count(*)::int as n from channel_partners where name_key = $1', ['new realty co'])).n, 1, 'same firm, not a second one');
      await db.q("update bookings set status = 'active' where id = $1", [again.id]);
    });
    await s('CP ledger: bill, pass back, payment waits for verification by someone else, balance', async () => {
      const f = await db.one("select id from channel_partners where name_key = 'new realty co'");
      const bk = await db.one('select b.id from bookings b where b.cp_id = $1 and b.brokerage = 200000', [f.id]);
      await db.q("update bookings set registration_date = $2 where id = $1", [bk.id, day(-1)]);
      await db.q("insert into receipts (project_id, booking_id, received_on, amount, mode, status, approved_at) values ($1, $2, $3, 1000000, 'bank', 'approved', now())", [sig.id, bk.id, day(-1)]);
      await db.q("insert into receipt_splits (receipt_id, head, amount) select id, 'av', 1000000 from receipts where booking_id = $1 and amount = 1000000", [bk.id]);
      const e = (k, x) => k('/api/partners', { action: 'cp-entry', projectId: sig.id, cpId: f.id, bookingId: bk.id, date: day(0), ...x });
      assert.equal((await e(crm, { kind: 'bill', amount: 200000, reference: 'INV-1' })).ok, true);
      assert.equal((await e(crm, { kind: 'bill', amount: 200000, reference: 'INV-1' })).status, 409, 'same bill twice');
      assert.equal((await e(crm, { kind: 'pass_back', amount: 20000, note: 'to the buyer' })).ok, true);
      assert.equal((await e(crm, { kind: 'payment', amount: 50000, reference: 'UTR9' })).status, 403, 'CRM cannot pay');
      const p = await e(hacc, { kind: 'payment', amount: 150000, reference: 'UTR9' }); assert.equal(p.ok, true, p.error); assert.equal(p.toVerify, true);
      assert.equal((await e(hacc, { kind: 'payment', amount: 40000, reference: 'UTR10' })).status, 400, 'more than is left after the one to verify');
      let D = await crm(`/api/partners?project=${sig.id}&cp=${f.id}`);
      assert.equal(D.firm.balance, 180000 + 0 /* second booking */ + Number((await db.one('select coalesce(sum(brokerage),0) as s from bookings where cp_id = $1 and id <> $2', [f.id, bk.id])).s));
      assert.equal(D.firm.toVerify, 150000);
      assert.equal((await hacc('/api/partners', { action: 'cp-verify', id: p.id })).status, 403, 'not the one who entered it');
      await db.q("insert into users (username, name, role, password_hash, all_projects) values ('mgr', 'Manager', 'management', 'x', true)");
      await db.q('update brokerage_entries set created_by = (select id from users where username = $2) where id = $1', [p.id, 'acc1']);
      assert.equal((await hacc('/api/partners', { action: 'cp-verify', id: p.id })).ok, true);
      D = await crm(`/api/partners?project=${sig.id}&cp=${f.id}`);
      assert.equal(D.firm.paid, 150000); assert.equal(D.firm.toVerify, 0); assert.equal(D.firm.passBack, 20000); assert.equal(D.firm.billed, 200000);
      const row = D.bookings.find((x) => x.booking_id === bk.id); assert.equal(row.balance, 30000);
    });
    await s('unit transfer: CRM asks, Head CRM approves; old booking Transferred, same buyers on the new flat, receipts moved, Accounts told', async () => {
      const src = (await admin(`/api/bookings?project=${sig.id}`)).rows.find((r) => r.status === 'active' && !r.sample && r.id !== bks[0].id);
      const before = await db.q("select id from receipts where booking_id = $1 and status in ('pending', 'approved')", [src.id]);
      const to = (await admin(`/api/units?project=${sig.id}`)).units.find((x) => x.status === 'available' && !x.booking_id);
      assert.equal((await crm('/api/bookings', { action: 'transfer-request', id: src.id, toUnitId: to.id, agreementValue: 9000000, reason: 'buyer wants a higher floor' })).ok, true);
      assert.equal((await crm('/api/bookings', { action: 'transfer-approve', id: src.id })).status, 403);
      const r = await hcrm('/api/bookings', { action: 'transfer-approve', id: src.id });
      assert.equal(r.ok, true, r.error); assert.equal(r.receiptsMoved, before.length);
      const old = await db.one('select status, transferred_to from bookings where id = $1', [src.id]);
      assert.equal(old.status, 'transferred'); assert.equal(old.transferred_to, r.newBooking);
      const nb = await db.one('select b.status, b.agreement_value, u.unit_no, u.status as ustatus from bookings b join units u on u.id = b.unit_id where b.id = $1', [r.newBooking]);
      assert.equal(nb.status, 'active'); assert.equal(Number(nb.agreement_value), 9000000); assert.equal(nb.unit_no, to.unit_no); assert.equal(nb.ustatus, 'booked');
      assert.equal((await db.one('select count(*)::int as n from booking_applicants where booking_id = $1', [r.newBooking])).n, (await db.one('select count(*)::int as n from booking_applicants where booking_id = $1', [src.id])).n);
      assert.ok((await db.one("select count(*)::int as n from demands where booking_id = $1 and status = 'raised'", [r.newBooking])).n >= 1);
      assert.ok(await db.one("select 1 as x from team_messages where to_team = 'accounts' and body like 'Flat transfer approved%'"));
    });
    await s('unsold flats: every unsold flat with its full cost from the price list', async () => {
      await db.q("insert into price_lists (project_id, name, effective_from, base_rate, floor_rise, floor_rise_from, parking_price, gst_rate, stamp_duty_pct, stamp_duty_women_pct, registration_fee, active) values ($1, 'Oct 2026', $2, 18000, 50, 5, 500000, 5, 6, 5, 30000, true)", [sig.id, day(-10)]);
      const r = await crm(`/api/prices?project=${sig.id}&unsold=1`);
      assert.ok(r.rows.length > 0); const x = r.rows.find((y) => !y.error);
      assert.equal(x.total, x.agreementValue + x.gst + x.stampDuty + x.registration + x.others);
      assert.ok(!r.rows.some((y) => ['booked', 'registered'].includes(y.status)));
    });
    await s('buyer replies waiting more than a day: in the inbox and on the 9 am CRM list, until answered or closed', async () => {
      const bk = bks[bks.length - 1]; // a flat with nothing sent to it since
      const c = await db.one("insert into communications (booking_id, channel, direction, from_addr, subject, body, sent_at, status) values ($1, 'email', 'in', 'buyer@x.com', 'Query', 'When is possession?', now() - interval '30 hours', 'matched') returning id", [bk.id]);
      let I = await crm('/api/comms?inbox=1&f=waiting'); assert.ok(I.rows.some((m) => m.id === c.id)); assert.ok(I.counts.waiting >= 1);
      const f = await require('../lib/daily-tasks').run('crm', { mail: false }); assert.ok(f.found.some((x) => x.key === 'replies-waiting'));
      assert.equal((await crm('/api/comms', { action: 'noreply', id: c.id })).ok, true);
      I = await crm('/api/comms?inbox=1&f=waiting'); assert.ok(!I.rows.some((m) => m.id === c.id));
    });
    await s('install as an app: manifest, icons and service worker are served', async () => {
      const BASE = `http://localhost:${process.env.PORT}`;
      for (const p of ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/sw.js']) assert.equal((await fetch(BASE + p)).status, 200, p);
      const m = await (await fetch(BASE + '/manifest.webmanifest')).json(); assert.equal(m.display, 'standalone');
    });
    console.log('\nall training checks passed');
    process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
};
