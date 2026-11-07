// Sales offers on a flat, for a lead: priced from the project's current price list (the same cost sheet the CRM prints),
// with the discount the sales person gives. Up to the limit (1% of the agreement value) the offer stands at once; above it,
// the offer waits for the approver (Rafi Sir) with every figure he needs: base rate per sq ft, agreement value, other
// charges, parking, the total, what the customer asks for and the discount. He approves in the ERP, by the link in the
// email, or by replying on WhatsApp "APPROVE OF-12" / "REJECT OF-12 reason"; then the sales person can close.
// A flat can be held for the customer for 72 hours, so nobody else sells it; the hold ends by itself.
const db = require('./db');
const costsheet = require('./costsheet');

const DEFAULTS = { limitPct: 1, holdHours: 72, approvers: null, waTemplate: '' };
const host = () => (process.env.ERP_URL || 'https://erp.dreamindiarealty.com').replace(/\/+$/, '');
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const lakh = (n) => { const v = Number(n) || 0; return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(2)} L`; };
const err = (status, message) => Object.assign(new Error(message), { status });
const offerNo = (id) => `OF-${id}`;

async function settings() {
  const r = await db.one("select value from settings where key = 'sales'").catch(() => null);
  return { ...DEFAULTS, ...((r && r.value) || {}) };
}
async function saveSettings(v) {
  const cur = await settings();
  const out = { ...cur, ...v };
  out.limitPct = Math.max(0, Math.min(10, Number(out.limitPct) || 0));
  out.holdHours = Math.max(1, Math.min(240, Math.round(Number(out.holdHours) || 72)));
  out.approvers = Array.isArray(out.approvers) ? out.approvers.map(Number).filter(Boolean) : null;
  out.waTemplate = String(out.waTemplate || '').trim().slice(0, 80);
  await db.q("insert into settings (key, value) values ('sales', $1) on conflict (key) do update set value = excluded.value", [out]);
  return out;
}
// who approves a discount above the limit: the chosen logins, else every Admin
async function approvers() {
  const s = await settings();
  const rows = s.approvers && s.approvers.length
    ? await db.q('select id, username, name, phone, email, role from users where id = any($1) and not disabled', [s.approvers])
    : await db.q("select id, username, name, phone, email, role from users where role = 'admin' and not disabled order by id");
  return rows;
}
const mayApprove = async (u) => (await approvers()).some((a) => a.id === u.id);

// The figures of an offer: the cost sheet from the current price list, with the discount spread per sq ft.
async function price(unitId, { parking = 0, discount = 0 } = {}) {
  const unit = await db.one('select u.*, p.name as project, p.id as pid, bl.code as wing from units u join projects p on p.id = u.project_id join buildings bl on bl.id = u.building_id where u.id = $1', [unitId]);
  if (!unit) throw err(404, 'That flat is not there.');
  const pl = await db.one("select * from price_lists where project_id = $1 and active and effective_from <= (now() + interval '330 minutes')::date order by effective_from desc, id desc limit 1", [unit.project_id]);
  if (!pl) throw err(400, `There is no price list for ${unit.project} yet. Head CRM or Management can add one on the Price list page.`);
  const plan = await db.q('select s.seq, s.name, s.pct from plan_stages s join payment_plans p on p.id = s.plan_id where p.project_id = $1 and p.active order by s.seq', [unit.project_id]);
  const list = costsheet.fromPriceList(pl, unit, { parking }, plan);
  const sqft = Number(unit.carpet_sqft);
  const disc = Math.max(0, Number(discount) || 0);
  if (disc >= list.agreementValue) throw err(400, 'The discount cannot be the whole price.');
  const cs = disc ? costsheet.fromPriceList(pl, unit, { parking, discount: disc / sqft }, plan) : list;
  const floors = Math.max(0, (Number(unit.floor) || 0) - (Number(pl.floor_rise_from) || 0));
  const rate = (costsheet.typeRate(pl.rates, unit.typology) || Number(pl.base_rate)) + Number(pl.floor_rise || 0) * floors;
  const parkingAmt = Math.round(parking * Number(pl.parking_price || 0));
  return {
    unit, pl, sqft, rate, floorRate: costsheet.typeRate(pl.floor_rates, unit.typology) || null, offerRate: r2((cs.agreementValue - parkingAmt) / sqft),
    parking, parkingAmt,
    listAv: list.agreementValue, discount: r2(list.agreementValue - cs.agreementValue), discountPct: r2((100 * (list.agreementValue - cs.agreementValue)) / list.agreementValue),
    av: cs.agreementValue, gst: cs.gst, stampDuty: cs.stampDuty, registration: cs.registration, others: cs.others, otherTotal: cs.otherTotal, total: cs.total, listTotal: list.total,
  };
}

// The message the approver reads (WhatsApp text / email): every figure Rafi Sir asked for.
function describe(o, lead, by) {
  return [
    `Discount approval ${offerNo(o.id)}`,
    `${o.project} · flat ${o.unit_no}${o.wing ? ' (' + o.wing + ' wing)' : ''} · ${Number(o.carpet)} sq ft carpet`,
    `Customer: ${lead.name || lead.phone}${lead.phone && lead.name ? ' (' + lead.phone + ')' : ''}`,
    `Base price: ${inr(o.rate)} per sq ft${o.floor_rate ? ` (lowest selling price ${inr(o.floor_rate)})` : ''}`,
    `Agreement value (list): ${inr(o.list_av)}`,
    `Parking: ${o.parking ? `${o.parking} space${o.parking > 1 ? 's' : ''}, ${inr(o.parking_amt)} (in the agreement value)` : 'none'}`,
    `Other charges: ${inr(o.other_total)}${(o.others || []).length ? ' (' + o.others.map((x) => `${x.name} ${inr(x.amount)}`).join(', ') + ')' : ''}`,
    `GST, stamp duty, registration: ${inr(Number(o.gst) + Number(o.stamp_duty) + Number(o.registration))}`,
    `Total cost to the customer (list): ${inr(o.list_total)}`,
    `Customer is asking: ${o.client_ask || '—'}`,
    `Discount asked: ${inr(o.discount)} (${Number(o.discount_pct).toFixed(2)}% of the agreement value)`,
    `Agreement value after discount: ${inr(o.av)} (${inr((Number(o.av) - Number(o.parking_amt)) / Number(o.carpet))} per sq ft) · total ${inr(o.total)}`,
    `Sales: ${by}${o.note ? ' — ' + o.note : ''}`,
  ];
}

async function offerRow(id) {
  return db.one(`select o.*, u.unit_no, u.floor, u.typology, bl.code as wing, p.name as project, p.id as project_id, c.name as by_name, d.name as decided_name
      from mkt_offers o join units u on u.id = o.unit_id join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id
      left join users c on c.id = o.created_by left join users d on d.id = o.decided_by where o.id = $1`, [id]);
}

// Tell the approvers: WhatsApp (an approved template when set; else a plain message, which WhatsApp delivers only within
// 24 hours of their last message to us), email with the link, and DreamComm.
async function notify(offerId) {
  const o = await offerRow(offerId), lead = await db.one('select * from mkt_leads where id = $1', [o.lead_id]);
  const lines = describe(o, lead, o.by_name || 'Sales');
  const link = `${host()}/leads?offer=${o.id}`;
  const set = await settings(), people = await approvers(), out = { whatsapp: [], email: null };
  const wa = require('./whatsapp');
  for (const p of people) {
    if (!p.phone) { out.whatsapp.push({ to: p.name, sent: false, reason: 'no mobile on the login' }); continue; }
    try {
      if (set.waTemplate) await wa.sendStaff({ phone: p.phone, template: set.waTemplate, params: [offerNo(o.id), `${o.project} ${o.unit_no}`, lead.name || lead.phone, inr(o.rate), inr(o.list_av), inr(o.parking_amt), inr(o.other_total), inr(o.total), o.client_ask || '—', `${inr(o.discount)} (${Number(o.discount_pct).toFixed(2)}%)`, link] });
      else await wa.sendStaff({ phone: p.phone, text: `${lines.join('\n')}\n\nReply APPROVE ${offerNo(o.id)} or REJECT ${offerNo(o.id)} and the reason.\nOr open: ${link}` });
      out.whatsapp.push({ to: p.name, sent: true });
    } catch (e) { out.whatsapp.push({ to: p.name, sent: false, reason: e.message }); }
  }
  const html = `<p>${lines.map((l) => String(l).replace(/[<>&]/g, '')).join('<br>')}</p><p><a href="${link}" style="background:#5B151A;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Approve or reject</a></p><p style="color:#777">Or reply on WhatsApp: APPROVE ${offerNo(o.id)} / REJECT ${offerNo(o.id)} and the reason.</p>`;
  out.email = await require('./staff-alerts').email({ to: people.map((p) => p.email), subject: `Discount approval ${offerNo(o.id)}: ${o.project} ${o.unit_no}, ${Number(o.discount_pct).toFixed(2)}%`, text: lines.join('\n'), html }).catch((e) => ({ sent: false, reason: e.message }));
  try { await require('./chat').system('dept:management', '', { title: `${offerNo(o.id)}: discount to approve`, tone: 'warn', lines: lines.slice(1) }); } catch {}
  await db.q('update mkt_offers set notified = $2 where id = $1', [o.id, out]);
  return out;
}

// Approve or reject (from the ERP, or a WhatsApp reply). Only an approver; a pending offer only.
async function decide(offerId, user, ok, note, how = 'in the ERP') {
  if (!(await mayApprove(user))) throw err(403, 'Only the discount approver can decide this.');
  const o = await offerRow(offerId); if (!o) throw err(404, `${offerNo(offerId)} was not found.`);
  if (o.status !== 'pending') throw err(409, `${offerNo(o.id)} is already ${o.status}.`);
  if (!ok && !String(note || '').trim()) throw err(400, 'Give the reason for rejecting.');
  await db.q('update mkt_offers set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1', [o.id, ok ? 'approved' : 'rejected', user.id, String(note || '').slice(0, 500) || null]);
  await db.q('insert into mkt_lead_events (lead_id, user_id, kind, outcome, note, data) values ($1, $2, $3, $4, $5, $6)',
    [o.lead_id, user.id, 'offer', ok ? 'approved' : 'rejected', `${offerNo(o.id)} ${ok ? 'approved' : 'rejected'} by ${user.name} ${how}${note ? ': ' + note : ''}`, { offer: o.id }]);
  // the sales person hears at once
  const by = await db.one('select name, phone, email from users where id = $1', [o.created_by]);
  if (by) {
    const msg = `${offerNo(o.id)} (${o.project} ${o.unit_no}, discount ${inr(o.discount)}) was ${ok ? 'APPROVED' : 'REJECTED'} by ${user.name}${note ? ': ' + note : ''}.${ok ? ' You can now close the booking.' : ''}`;
    if (by.phone) await require('./whatsapp').sendStaff({ phone: by.phone, text: msg }).catch(() => {});
    if (by.email) await require('./staff-alerts').email({ to: [by.email], subject: msg.slice(0, 120), text: msg, html: `<p>${msg.replace(/[<>&]/g, '')}</p>` }).catch(() => {});
  }
  return { ok: true, status: ok ? 'approved' : 'rejected' };
}

// A WhatsApp message from an approver: "APPROVE OF-12", "ok of12", "REJECT OF-12 too much". Null when it is not one.
async function handleReply(from, text) {
  const m = String(text || '').trim().match(/^(approve[ds]?|ok|yes|reject(?:ed)?|no)\b[\s:,-]*of[\s-]*(\d{1,7})\b[\s:,.-]*(.*)$/i);
  if (!m) return null;
  const ph = String(from || '').replace(/\D/g, '').slice(-10); if (!ph) return null;
  const who = (await approvers()).find((u) => String(u.phone || '').replace(/\D/g, '').slice(-10) === ph);
  if (!who) return null;
  const ok = /^(approve|ok|yes)/i.test(m[1]);
  let reply;
  try { await decide(+m[2], who, ok, m[3], 'by WhatsApp reply'); reply = `${offerNo(+m[2])} ${ok ? 'approved. Sales has been told and can close.' : 'rejected. Sales has been told.'}`; }
  catch (e) { reply = `${offerNo(+m[2])}: ${e.message}${!ok && /reason/i.test(e.message) ? ` Send: REJECT ${offerNo(+m[2])} and the reason.` : ''}`; }
  await require('./whatsapp').sendStaff({ phone: from, text: reply }).catch(() => {});
  return { handled: true, reply };
}

// Holds that ran out: the flat is free again (only holds made here; a hold from the CRM sheet stays).
async function releaseHolds() {
  const rows = await db.q(`update units set status = 'available', hold_note = null, held_until = null, held_lead_id = null
      where status = 'held' and held_lead_id is not null and held_until < now() returning id, held_lead_id`);
  for (const r of rows) await db.q('update mkt_leads set hold_unit_id = null, hold_until = null where hold_unit_id = $1', [r.id]);
  return { released: rows.length };
}

module.exports = { settings, saveSettings, approvers, mayApprove, price, describe, offerRow, notify, decide, handleReply, releaseHolds, offerNo, inr, lakh };
