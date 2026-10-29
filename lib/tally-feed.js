// The Tally link: Dream India's Tally (TallyPrime on its cloud server) takes the ERP's receipts and payments as vouchers.
// Tally cannot be reached from the internet, so Tally's side fetches them:
//   GET  /api/accounts?tally=feed            (header X-ERP-Key: <key>)  → Tally "Import Data" XML of what is new or changed
//        &format=json                         the same as JSON;  &from=YYYY-MM-DD&to=YYYY-MM-DD&all=1  everything in a period
//   POST /api/accounts  {action:'tally-ack', key, done:[{id:'BL00012', result:'ok'|'error', note}]}  → what Tally imported
// The key is made in the ERP (Accounts → Banks, heads & import → Tally link) by Head Accounts or Admin; only its hash is kept.
// Each voucher carries REMOTEID "DIERP-<Receipt or Payment ID>", so sending it again alters the same voucher in Tally.
const crypto = require('crypto');
const db = require('./db');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const hash = (k) => crypto.createHash('sha256').update('erp-tally:' + k).digest('hex');

async function settings() {
  const r = await db.one("select value from settings where key = 'tally_feed'");
  return { company: 'Prime Realtors', ...(r ? r.value : {}) };
}
async function save(v) { await db.q("insert into settings (key, value) values ('tally_feed', $1) on conflict (key) do update set value = excluded.value", [v]); }

// A new key (shown once). Any earlier key stops working.
async function newKey(user) {
  const key = 'tly_' + crypto.randomBytes(24).toString('base64url');
  const s = await settings();
  await save({ ...s, hash: hash(key), madeBy: user.name, madeAt: new Date().toISOString() });
  return key;
}
async function check(key) {
  const s = await settings();
  if (!s.hash || !key) return false;
  const a = Buffer.from(hash(String(key))), b = Buffer.from(s.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Rows to send: never sent, or changed after Tally took them. With from/to and all=1: every row in that period.
// Only entries made in the ERP (not rows brought in from Tally or the old sheet, which Tally already has), dated on or
// after the start date Head Accounts sets. Nothing goes until that date is set.
async function rows({ from, to, all } = {}) {
  const start = (await settings()).start;
  if (!start) return [];
  const period = from && to ? ' and txn_date between $3 and $4' : '';
  const which = (all && period ? '' : ' and (tally_at is null or coalesce(updated_at, created_at) > tally_at)') + ' and not imported and txn_date >= $2';
  const args = [BOOK, start, ...(period ? [from, to] : [])];
  const r = await db.q(`select 'Receipt' as vtype, id, ref_id, txn_date, bank, coalesce(nullif(head, ''), 'Suspense') as ledger, amount, description, reference, unit_no, payment_head, payer_name as party, tally_at,
      (tally_at is not null) as again from acc_receipts where book = $1 and coalesce(cheque_status, '') not in ('Bounced') and amount > 0${period}${which} order by txn_date, id limit 2000`, args);
  const p = await db.q(`select 'Payment' as vtype, id, ref_id, txn_date, bank, coalesce(nullif(head, ''), 'Suspense') as ledger, amount, description, reference, unit_no, null as payment_head, payee as party, tally_at,
      (tally_at is not null) as again from acc_payments where book = $1 and amount > 0${period}${which} order by txn_date, id limit 2000`, args);
  return [...r, ...p].sort((a, b) => (String(a.txn_date) + a.ref_id).localeCompare(String(b.txn_date) + b.ref_id));
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const narr = (v) => [v.ref_id, v.unit_no, v.payment_head, v.party, v.reference, v.description].filter(Boolean).join(' | ').slice(0, 400);
function json(list) {
  return list.map((v) => ({ id: v.ref_id, remoteId: 'DIERP-' + v.ref_id, type: v.vtype, date: iso(v.txn_date), bankLedger: v.bank, ledger: v.ledger, amount: n(v.amount),
    unit: v.unit_no || null, party: v.party || null, reference: v.reference || null, narration: narr(v), action: v.again ? 'Alter' : 'Create' }));
}
// ERP bank / head name → the ledger's name in Tally (set on the Tally link page); unmapped names go as they are.
function mapped(list, map) {
  const m = map || {};
  return list.map((v) => ({ ...v, bank: m[v.bank] || v.bank, ledger: m[v.ledger] || v.ledger }));
}
async function ledgers() {
  const s = await settings(), m = s.ledgerMap || {};
  const banks = await db.q('select name from acc_banks where book = $1 order by name', [BOOK]);
  const heads = await db.q("select distinct name, side from acc_heads where book = $1 and active is not false order by side, name", [BOOK]);
  return [...banks.map((b) => ({ kind: 'Bank', name: b.name })), ...heads.map((h) => ({ kind: h.side === 'receipt' ? 'Receipt head' : 'Payment head', name: h.name })), { kind: 'For entries with no head', name: 'Suspense' }]
    .map((x) => ({ ...x, tally: m[x.name] || '' }));
}
function xml(list, company) {
  const x = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const one = (e) => {
    const d = iso(e.txn_date).replace(/-/g, ''), amt = n(e.amount).toFixed(2), rec = e.vtype === 'Receipt';
    // In a Receipt the bank is debited (ISDEEMEDPOSITIVE Yes, negative amount) and the head ledger credited; the reverse in a Payment.
    const line = (ledger, debit) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${x(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? '-' : ''}${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="DIERP-${x(e.ref_id)}" VCHTYPE="${e.vtype}" ACTION="${e.again ? 'Alter' : 'Create'}"><DATE>${d}</DATE><EFFECTIVEDATE>${d}</EFFECTIVEDATE>`
      + `<VOUCHERTYPENAME>${e.vtype}</VOUCHERTYPENAME><VOUCHERNUMBER>${x(e.ref_id)}</VOUCHERNUMBER><REFERENCE>${x(e.reference || '')}</REFERENCE><NARRATION>${x(narr(e))}</NARRATION>`
      + (rec ? line(e.bank, true) + line(e.ledger, false) : line(e.ledger, true) + line(e.bank, false)) + '</VOUCHER></TALLYMESSAGE>';
  };
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>`
    + `<STATICVARIABLES><SVCURRENTCOMPANY>${x(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n${list.map(one).join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

// Tally's side reports back what it imported. Unknown IDs are ignored.
async function ack(done) {
  let ok = 0, failed = 0;
  for (const d of (Array.isArray(done) ? done : []).slice(0, 5000)) {
    const id = String(d && d.id || '').slice(0, 40); if (!id) continue;
    const good = String(d.result || 'ok').toLowerCase() === 'ok';
    const note = String(d.note || '').slice(0, 300) || null;
    for (const t of ['acc_receipts', 'acc_payments']) {
      const r = await db.q(`update ${t} set tally_at = ${good ? 'now()' : 'tally_at'}, tally_note = $3 where book = $1 and ref_id = $2 returning id`, [BOOK, id, good ? note : 'Tally could not import: ' + (note || 'no reason given')]);
      if (r.length) { good ? ok++ : failed++; break; }
    }
  }
  await db.q("insert into job_marks (key, info) values ('tally-last-ack', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [{ ok, failed }]);
  return { ok: true, imported: ok, failed };
}

async function status() {
  const s = await settings();
  const c = async (t) => db.one(`select count(*) filter (where tally_at is null and not imported and txn_date >= coalesce($2::date, 'infinity'::date))::int as waiting, count(*) filter (where tally_at is not null and coalesce(updated_at, created_at) > tally_at)::int as changed,
      count(*) filter (where tally_at is not null)::int as done, count(*) filter (where tally_note like 'Tally could not%')::int as errors from ${t} where book = $1`, [BOOK, s.start || null]);
  const pulled = await db.one("select done_at, info from job_marks where key = 'tally-last-pull'");
  const acked = await db.one("select done_at, info from job_marks where key = 'tally-last-ack'");
  const errs = await db.q(`select ref_id, tally_note from (select ref_id, tally_note from acc_receipts where book = $1 and tally_note like 'Tally could not%' union all
      select ref_id, tally_note from acc_payments where book = $1 and tally_note like 'Tally could not%') x order by ref_id limit 30`, [BOOK]);
  return { start: s.start || null, company: s.company, hasKey: !!s.hash, keyMadeBy: s.madeBy || null, keyMadeAt: s.madeAt || null, receipts: await c('acc_receipts'), payments: await c('acc_payments'),
    lastPull: pulled ? { at: pulled.done_at, ...pulled.info } : null, lastAck: acked ? { at: acked.done_at, ...acked.info } : null, errors: errs };
}
async function notePull(count) { await db.q("insert into job_marks (key, info) values ('tally-last-pull', $1) on conflict (key) do update set info = excluded.info, done_at = now()", [{ vouchers: count }]); }

module.exports = { mapped, ledgers, settings, save, newKey, check, rows, json, xml, ack, status, notePull };
