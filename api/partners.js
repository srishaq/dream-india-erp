// Channel partners and brokerage, firm by firm (lib/cp.js): GET ?project=ID&ledger=1 · &cp=ID · &firms=1 (the list for
// the booking form) · &booking=ID (one booking's entries). POST rule (the brokerage rule).
// (The older per-booking list and its amount / bill / payment actions are gone: every entry goes through cp-entry,
// so a payment counts only once someone else has verified it.)
// POST cp-save (a firm's details) · cp-entry (bill, pass back, payment) · cp-verify (a payment, by someone else) · cp-cancel
const db = require('../lib/db');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { has } = require('../lib/roles');
const { needProject, bookingFor } = require('../lib/access');
const { today } = require('../lib/demands');
const { route, fail, str, intOr } = require('../lib/http');
const CP = require('../lib/cp');
const { notOwn } = require('../lib/access');

const n = (v) => Number(v) || 0;
const r2 = (x) => Math.round(x * 100) / 100;
const money = (v) => { const x = Number(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return Number.isFinite(x) && x > 0 ? r2(x) : NaN; };
async function rule() { const r = await db.one("select value from settings where key = 'brokerage_rule'"); return { afterRegistration: true, minReceivedPct: 10, ...(r ? r.value : {}) }; }

module.exports = route({
  GET: async (req, res) => {
    const u = await auth.guard(req, res, 'ledger.view'); if (!u) return;
    const projectId = needProject(u, intOr(req.query.project));
    const can = { bill: has(u, 'brokerage.bill') || has(u, 'accounts.enter'), pay: has(u, 'brokerage.pay'), rule: has(u, 'price.manage'), firm: has(u, 'brokerage.bill') || has(u, 'accounts.manage'), verify: has(u, 'brokerage.pay') || has(u, 'accounts.manage') };
    if (req.query.firms) return res.json({ firms: await db.q('select id, name, default_pct from channel_partners where active order by name') });
    if (req.query.ledger) return res.json({ ...(await CP.ledger(projectId)), can });
    if (req.query.cp) {
      const L = await CP.ledger(projectId, intOr(req.query.cp));
      if (!L.firms.length) throw fail(404, 'That partner firm is not there.');
      return res.json({ firm: L.firms[0], bookings: L.bookings, entries: L.entries, rule: L.rule, can, me: u.id });
    }
    if (req.query.booking) {
      const bk = await bookingFor(u, intOr(req.query.booking));
      return res.json({ entries: await db.q('select e.*, x.name as by_name from brokerage_entries e left join users x on x.id = e.created_by where e.booking_id = $1 order by e.entry_date, e.id', [bk.id]) });
    }
    throw fail(400, 'Ask for ?ledger=1, ?cp=ID, ?firms=1 or ?booking=ID.');
  },
  POST: async (req, res, b) => {
    const u = await auth.guard(req, res); if (!u) return;
    const need = (p) => { if (!has(u, p)) throw fail(403, 'Your role does not allow this.'); };
    if (b.action === 'rule') {
      need('price.manage');
      const before = await rule();
      const v = { afterRegistration: !!b.afterRegistration, minReceivedPct: Math.min(100, Math.max(0, Number(b.minReceivedPct) || 0)) };
      await db.tx(async (t) => {
        await t.q("insert into settings (key, value) values ('brokerage_rule', $1) on conflict (key) do update set value = excluded.value", [v]);
        await audit.record(t.q, { user: u, action: 'update', entity: 'settings', entityId: 'brokerage_rule', before, after: v });
      });
      return res.json({ ok: true });
    }
    if (b.action === 'cp-save') {
      if (!(has(u, 'brokerage.bill') || has(u, 'accounts.manage'))) throw fail(403, 'Your role does not allow this.');
      const name = str(b.name, 120).replace(/\s+/g, ' '); if (!name) throw fail(400, 'Enter the firm name.');
      const k = CP.keyOf(name);
      const v = [name, k, str(b.contactPerson, 80) || null, str(b.phone, 20) || null, str(b.email, 120) || null, str(b.pan, 10).toUpperCase() || null, str(b.gstin, 15).toUpperCase() || null, str(b.reraNo, 40) || null,
        b.defaultPct === '' || b.defaultPct == null ? null : Math.max(0, Math.min(20, Number(b.defaultPct) || 0)), b.active !== false && b.active !== 'false', str(b.note, 300) || null];
      const other = await db.one('select id from channel_partners where name_key = $1 and id <> $2', [k, intOr(b.id) || 0]);
      if (other) throw fail(409, `A firm called ${name} is already on the list.`);
      let id = intOr(b.id);
      if (id) {
        const before = await db.one('select * from channel_partners where id = $1', [id]); if (!before) throw fail(404, 'That firm is not there.');
        await db.q('update channel_partners set name = $2, name_key = $3, contact_person = $4, phone = $5, email = $6, pan = $7, gstin = $8, rera_no = $9, default_pct = $10, active = $11, note = $12 where id = $1', [id, ...v]);
        await db.q('update bookings set cp_name = $2 where cp_id = $1', [id, name]);
        await audit.record(db.q, { user: u, action: 'update', entity: 'channel-partner', entityId: id, before: { name: before.name, pct: before.default_pct, active: before.active }, after: { name, pct: v[8], active: v[9] } });
      } else {
        id = (await db.one('insert into channel_partners (name, name_key, contact_person, phone, email, pan, gstin, rera_no, default_pct, active, note, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id', [...v, u.id])).id;
        await audit.record(db.q, { user: u, action: 'create', entity: 'channel-partner', entityId: id, after: { name } });
      }
      return res.json({ ok: true, id });
    }
    if (b.action === 'cp-entry') {
      const kind = ['bill', 'pass_back', 'payment'].includes(b.kind) ? b.kind : null; if (!kind) throw fail(400, 'Choose bill, pass back or payment.');
      if (kind === 'payment' ? !has(u, 'brokerage.pay') : !(has(u, 'brokerage.bill') || has(u, 'accounts.enter'))) throw fail(403, 'Your role does not allow this.');
      const firm = await db.one('select * from channel_partners where id = $1', [intOr(b.cpId)]); if (!firm) throw fail(404, 'That firm is not there.');
      const amt = money(b.amount); if (!Number.isFinite(amt)) throw fail(400, 'Enter the amount in rupees.');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null; if (!date || date > today()) throw fail(400, 'Enter the date (not in the future).');
      const ref = str(b.reference, 80);
      if (!ref && kind !== 'pass_back') throw fail(400, kind === 'bill' ? "Enter the partner's bill or invoice number." : 'Enter the payment reference (UTR or cheque number).');
      let bookingId = null;
      const L = await CP.ledger(needProject(u, intOr(b.projectId)), firm.id);
      const F = L.firms[0];
      if (b.bookingId) {
        const bk = await bookingFor(u, intOr(b.bookingId)); if (bk.cp_id !== firm.id) throw fail(400, 'That flat was not booked through this firm.');
        bookingId = bk.id;
        const row = L.bookings.find((x) => x.booking_id === bk.id);
        if (kind === 'payment' && row && !row.eligible && !(b.override && has(u, 'cancellation.approve'))) throw fail(409, `Brokerage on ${row.unit_no} is not due yet (${row.why}). Management can pay early by confirming it.`);
        if (kind !== 'bill' && row && amt > Math.max(0, row.balance) - n(row.to_verify) + 1) throw fail(400, `Only ${Math.max(0, row.balance - n(row.to_verify)).toLocaleString('en-IN')} of brokerage is left on ${row.unit_no}.`);
      } else if (kind !== 'bill' && amt > Math.max(0, F.balance - F.toVerify) + 1) throw fail(400, `Only ${Math.max(0, F.balance - F.toVerify).toLocaleString('en-IN')} of brokerage is left for ${firm.name} (after payments waiting to be verified).`);
      const dup = ref ? await db.one('select id from brokerage_entries where cp_id = $1 and kind = $2 and lower(reference) = lower($3) and cancelled_at is null', [firm.id, kind, ref]) : null;
      if (dup) throw fail(409, `${kind === 'bill' ? 'Bill' : 'Reference'} ${ref} is already entered for ${firm.name}.`);
      const e = await db.one('insert into brokerage_entries (booking_id, cp_id, kind, entry_date, amount, reference, note, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [bookingId, firm.id, kind, date, amt, ref || null, str(b.note, 300) || null, u.id]);
      await audit.record(db.q, { user: u, action: 'cp-' + kind, entity: 'channel-partner', entityId: firm.id, after: { entry: e.id, bookingId, amount: amt, date, reference: ref } });
      return res.json({ ok: true, id: e.id, toVerify: kind === 'payment' });
    }
    if (b.action === 'cp-verify' || b.action === 'cp-cancel') {
      const e = await db.one('select * from brokerage_entries where id = $1 and cancelled_at is null', [intOr(b.id)]); if (!e) throw fail(404, 'That entry is not there.');
      if (b.action === 'cp-verify') {
        if (!(has(u, 'brokerage.pay') || has(u, 'accounts.manage'))) throw fail(403, 'Your role does not allow this.');
        if (e.kind !== 'payment' || e.verified_at) throw fail(409, 'Only a payment waiting to be verified can be verified.');
        notOwn(u, e.created_by);
        await db.q('update brokerage_entries set verified_by = $2, verified_at = now() where id = $1', [e.id, u.id]);
      } else {
        if (!(has(u, 'accounts.manage') || has(u, 'brokerage.pay'))) throw fail(403, 'Your role does not allow this.');
        const reason = str(b.reason, 300); if (!reason) throw fail(400, 'Give the reason.');
        await db.q('update brokerage_entries set cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 where id = $1', [e.id, u.id, reason]);
      }
      await audit.record(db.q, { user: u, action: b.action, entity: 'channel-partner', entityId: e.cp_id, after: { entry: e.id, kind: e.kind, amount: e.amount }, note: str(b.reason, 300) || null });
      return res.json({ ok: true });
    }
    throw fail(400, 'Unknown action.');
  },
});
