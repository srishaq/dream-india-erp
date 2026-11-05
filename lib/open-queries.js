// Open queries: every outstanding correction across the CRM and Accounts, in one list for the CRM/Accounts Audit tab.
// Each section says who fixes it and where. Nothing here changes data; items drop off as they are corrected.
const db = require('./db');
const acc = require('./accounts');
const bvc = require('./books-vs-crm');

const BOOK = acc.BOOK;
const n = (v) => Number(v) || 0;
const r0 = (x) => Math.round(n(x));
const hash = (x) => require('crypto').createHash('sha1').update(String(x)).digest('hex').slice(0, 12);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

async function build(projectId) {
  const S = [];
  const add = (s) => { s.count = s.rows.length; s.amount = r0(s.rows.reduce((a, r) => a + Math.abs(n(r.amount)), 0)); S.push(s); };

  // 1. CRM: items the CRM import flagged
  const iss = await db.q(`select i.id, i.unit_no, i.kind, i.severity, i.detail from import_issues i
    where i.project_id = $1 and i.status = 'open' and i.kind not in ('no-email', 'no-mobile', 'bad-pan') order by (i.severity = 'money') desc, i.unit_no nulls first, i.id`, [projectId]);
  add({ key: 'verify', team: 'CRM', title: 'Data to verify (from the CRM import)', where: '#/verify', fix: 'Check against the booking file and close each item with what was corrected.',
    rows: iss.map((r) => ({ key: 'I' + r.id, unit: r.unit_no || '', item: r.kind + (r.severity === 'money' ? ' (money)' : ''), detail: r.detail || '' })) });

  // 2. CRM: buyer details missing (PAN, email, mobile), one line per flat
  const det = await db.q(`select b.id as booking_id, u.unit_no, string_agg(distinct y.name, ', ') as buyer, max(case when a.seq = 1 then y.name end) as first,
      bool_and(coalesce(trim(y.pan), '') = '') as no_pan, bool_or(coalesce(y.pan, '') <> '' and y.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$') as bad_pan,
      not bool_or(y.email like '%@%') as no_email, max(case when a.seq = 1 then y.phone end) as phone
    from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
   where u.project_id = $1 and b.status = 'active' group by u.unit_no, b.id order by u.unit_no`, [projectId]);
  const miss = det.map((r) => ({ r, m: [r.no_pan && 'PAN', r.bad_pan && 'PAN looks wrong', r.no_email && 'email', !/^[6-9]\d{9}$/.test(String(r.phone || '').replace(/\D/g, '').slice(-10)) && 'mobile'].filter(Boolean) })).filter((x) => x.m.length);
  add({ key: 'kyc', team: 'CRM', title: 'Buyer details missing', where: '#/flats', fix: 'One line per flat: fill what is missing on the booking (PAN is needed for TDS and the agreement; email and mobile for letters and WhatsApp).',
    rows: miss.map(({ r, m }) => ({ key: 'B' + r.booking_id, unit: r.unit_no, item: 'Missing: ' + m.join(', '), detail: r.buyer || '', applicant: r.first || '' })) });

  // 3. CRM pending receipts (cheques and transfers wait for the bank statement)
  const pend = await db.q(`select r.id, u.unit_no, r.received_on, r.amount, r.mode, r.instrument_no, r.created_at from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id
     where r.project_id = $1 and r.status = 'pending' order by r.received_on, r.id`, [projectId]);
  add({ key: 'pending', team: 'CRM', title: 'Receipts waiting for approval', where: '#/receipts', fix: 'Cheques and transfers approve themselves when the bank statement shows them; check any older than 3 days.',
    rows: pend.map((r) => ({ key: 'R' + r.id, unit: r.unit_no, date: iso(r.received_on), item: (r.mode || '') + (r.instrument_no ? ' ' + r.instrument_no : ''), detail: '', amount: n(r.amount) })) });

  // 4. Tally vs CRM, flat by flat
  let tv = { rows: [] };
  try { tv = await bvc.summary(projectId); } catch (e) { tv = { rows: [], error: e.message }; }
  add({ key: 'bookscrm', team: 'CRM + Accounts', title: 'Tally and the CRM do not agree (flat by flat)', where: '#/bookscrm', fix: 'Open the flat in Tally vs CRM: each receipt is paired, the unpaired ones are the correction.',
    rows: tv.rows.filter((r) => !['Agrees', 'Nothing received'].includes(r.state))
      .map((r) => ({ key: `F${r.unit}@${r0(r.diff)}`, unit: r.unit, item: r.state, detail: `${r.buyer || ''} · Tally ₹${r.books.toLocaleString('en-IN')} vs CRM ₹${r.crm.toLocaleString('en-IN')}`, amount: r.diff })) });

  // 4b. CRM receipts on a present booking that were a cancelled buyer's payment
  const old = await bvc.crmOld(projectId).catch(() => ({}));
  add({ key: 'crmold', team: 'CRM', title: "Cancelled buyer's payment on the present booking", where: '#/bookscrm', fix: 'The Developer Tracker shows this payment was made by the buyer whose booking was cancelled: take it off the present booking (reverse the receipt), unless it was moved over on purpose.',
    rows: Object.entries(old).flatMap(([u, x]) => x.list.map((r) => ({ key: 'O' + r.id, unit: u, date: r.date, item: 'Old buyer: ' + (r.name || '?'), detail: [`matched on ${r.by}`, r.ref ? 'CRM ref ' + r.ref : '', r.txn ? 'tracker txn ' + r.txn : '', r.old && r.old !== u ? 'was flat ' + r.old : ''].filter(Boolean).join(' · '), amount: r.amount }))) });

  // 5. Accounts: bank statement against the books (the latest comparison)
  const cmp = await db.one("select id, run_at, differences from acc_stmt_runs where book = $1 and ok and trigger = 'compare' order by run_at desc limit 1", [BOOK]);
  add({ key: 'bank', team: 'Accounts', title: 'Bank statement and the books differ', where: cmp ? '#/bankauto/' + cmp.id : '#/bankauto', fix: 'Enter what is missing, correct the bank or date, or mark it a reconciling item.',
    asOf: cmp ? cmp.run_at : null,
    rows: (cmp ? cmp.differences || [] : []).map((d) => ({ key: 'K' + hash([d.bank, d.date, d.amount, d.what, d.description].join('|')), bank: d.bank || '', date: d.date || '', item: d.what || '', detail: [d.description, d.where, d.todo].filter(Boolean).join(' · '), amount: n(d.amount) })) });

  // 6. Accounts: customer receipts with no flat
  const nounit = await db.q(`select id, ref_id, txn_date, bank, amount, payer_name, payment_head from acc_receipts where book = $1 and coalesce(payment_head, '') <> '' and coalesce(unit_no, '') = '' and ${acc.RECEIVED_SQL} order by txn_date`, [BOOK]);
  add({ key: 'nounit', team: 'Accounts', title: 'Customer receipts with no flat', where: '#/reg-receipts', fix: 'Put the flat number on the receipt (in Tally the flat ledger).',
    rows: nounit.map((r) => ({ key: 'A' + r.id, ref: r.ref_id, date: iso(r.txn_date), bank: r.bank || '', item: r.payment_head, detail: r.payer_name || '', amount: n(r.amount) })) });

  // 7. Accounts: TDS entries (from the portal) with no flat
  const tds = await db.q("select id, ref_id, paid_on, customer, tds_amount, challan_no from acc_tds_entries where book = $1 and coalesce(unit_no, '') = '' order by paid_on", [BOOK]);
  add({ key: 'tds', team: 'Accounts', title: 'TDS entries with no flat', where: '#/reg-tds', fix: 'The PAN on the TDS portal is not on any booking: find the flat and put it on the entry (and the PAN on the booking).',
    rows: tds.map((r) => ({ key: 'T' + r.id, ref: r.ref_id, date: iso(r.paid_on), item: 'Flat missing', detail: [r.customer, r.challan_no && 'challan ' + r.challan_no].filter(Boolean).join(' · '), amount: n(r.tds_amount) })) });

  // 8. Accounts: the standing checks that fail
  const ck = (await acc.checks(projectId).catch(() => [])).filter((c) => c.result === 'Check');
  add({ key: 'checks', team: 'Accounts', title: 'Accounts checks that need attention', where: '#/checks', fix: 'Each check says what is wrong.',
    rows: ck.map((c) => ({ key: 'C' + hash(c.check), item: c.check, detail: c.means || '', amount: null, figure: c.figure })) });

  // items explained in an uploaded sheet (a note, no correction possible here) are kept apart
  const notes = new Map((await db.q('select key, note from query_notes').catch(() => [])).map((x) => [x.key, x.note]));
  let explained = 0;
  for (const sec of S) {
    const keep = sec.rows.filter((r) => !notes.has(r.key));
    explained += sec.rows.length - keep.length; sec.explained = sec.rows.length - keep.length;
    sec.rows = keep; sec.count = keep.length; sec.amount = r0(keep.reduce((a, r) => a + Math.abs(n(r.amount)), 0));
  }
  return { sections: S, total: S.reduce((a, s) => a + s.count, 0), explained, at: new Date().toISOString() };
}

// The Excel file: one sheet per list. Columns marked ✎ can be filled in and the file uploaded back (Open queries →
// Upload corrections). Key ties each line to the item; leave it as it is.
const EDIT = {
  kyc: ['✎ PAN', '✎ Email', '✎ Mobile'],
  tds: ['✎ Flat'],
  nounit: ['✎ Flat'],
};
const SHEET = { crmold: 'Old buyer on new booking', verify: 'Data to verify', kyc: 'Buyer details', pending: 'Receipts pending', bookscrm: 'Tally vs CRM', bank: 'Bank vs books', nounit: 'Receipts no flat', tds: 'TDS no flat', checks: 'Accounts checks' };
const NOTE = '✎ Note (what was checked or corrected)';

function sheets(out) {
  const help = [['How to use this file'],
    ['1. Each sheet is one list. Fill only the columns marked ✎. Do not change the Key column.'],
    ['2. Buyer details: type the PAN, email or mobile. It goes on the first applicant.'],
    ['3. TDS no flat and Receipts no flat: type the flat (A-1001).'],
    ['4. Any sheet: a Note closes the item as checked (Data to verify) or explained (Tally vs CRM, Bank vs books and the rest). Leave it blank if it still needs work.'],
    ['5. Fixes made in Tally or in the ERP itself do not need a note: the item drops off the list by itself.'],
    ['6. Upload the file on Open queries → Upload corrections. You see every change before it is saved.'],
    [''], ['Team', 'List', 'Open', 'Amount (₹)', 'How to fix']].concat(out.sections.map((s) => [s.team, SHEET[s.key] || s.title, s.count, s.amount, s.fix]));
  const list = out.sections.map((s) => {
    const ed = EDIT[s.key] || [];
    const head = ['Key', 'Flat', 'Bank', 'Date', 'Ref', 'Item', 'Detail', ...(s.key === 'kyc' ? ['First applicant'] : []), 'Amount (₹)', ...ed, NOTE];
    return { name: SHEET[s.key] || s.key, rows: [head, ...s.rows.map((r) => [r.key, r.unit || '', r.bank || '', r.date || '', r.ref || '', r.item || '', r.detail || '', ...(s.key === 'kyc' ? [r.applicant || ''] : []), r.amount == null ? '' : r0(r.amount), ...ed.map(() => ''), ''])],
      widths: [14, 9, 20, 11, 12, 30, 70, ...(s.key === 'kyc' ? [28] : []), 13, ...ed.map(() => 18), 40] };
  });
  return [{ name: 'Read me', rows: help, widths: [16, 44, 8, 14, 90] }, ...list];
}

// Reads an uploaded file back. Returns { changes: [...], errors: [...] }; with apply, saves them (one transaction, audited).
async function upload(projectId, buf, { user, apply = false }) {
  const xlsx = require('./xlsx');
  let book; try { book = xlsx.read(buf); } catch { throw Object.assign(new Error('This Excel file could not be read. Save it as .xlsx and try again.'), { status: 400 }); }
  const recs = [];
  for (const sh of book) {
    const rows = sh.rows || [];
    const hi = rows.findIndex((r) => r && String(r[0] || '').trim() === 'Key');
    if (hi < 0) continue;
    const H = rows[hi].map((x) => String(x || '').trim());
    const col = (name) => H.findIndex((h) => h === name || h.startsWith(name));
    const cKey = 0, cNote = col('✎ Note'), cPan = col('✎ PAN'), cMail = col('✎ Email'), cMob = col('✎ Mobile'), cFlat = col('✎ Flat'), cUnit = col('Flat');
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || []; const key = String(r[cKey] || '').trim(); if (!key) continue;
      const v = (c) => (c >= 0 ? String(r[c] ?? '').trim() : '');
      recs.push({ key, where: `${sh.name} row ${i + 1}${r[cUnit] ? ' (' + r[cUnit] + ')' : ''}`, pan: v(cPan), email: v(cMail), mobile: v(cMob), flat: v(cFlat), note: v(cNote) });
    }
  }
  return save(projectId, recs, { user, apply });
}

// One set of corrections, from the uploaded file or typed on the Open queries page: [{key, where, pan, email, mobile, flat, note}].
async function save(projectId, recs, { user, apply = false }) {
  const audit = require('./audit');
  const changes = [], errors = [];
  const units = new Set((await db.q('select unit_no from units where project_id = $1', [projectId])).map((x) => x.unit_no));
  const flatOf = (v) => { const m = String(v || '').trim().toUpperCase().match(/^([AB])\s*[-/ ]?\s*(\d{3,4})$/); return m ? `${m[1]}-${m[2]}` : null; };
  for (const x of recs) {
    const key = String(x.key || '').trim(), where = String(x.where || key), t = (k) => String(x[k] ?? '').trim();
    if (!/^[IBRFKATCO]/.test(key)) continue;
    if (key[0] === 'B') {
      const pan = t('pan').toUpperCase().replace(/\s/g, ''), mail = t('email').toLowerCase(), mobD = t('mobile').replace(/\D/g, ''), mob = mobD.slice(-10);
      if (pan) { if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) changes.push({ key, where, what: 'PAN', value: pan }); else errors.push(`${where}: PAN "${pan}" does not look right (5 letters, 4 digits, 1 letter).`); }
      if (mail) { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) changes.push({ key, where, what: 'Email', value: mail }); else errors.push(`${where}: "${mail}" is not an email address.`); }
      if (mobD) { if (/^[6-9]\d{9}$/.test(mob)) changes.push({ key, where, what: 'Mobile', value: mob }); else errors.push(`${where}: "${t('mobile')}" is not a 10-digit mobile number.`); }
    }
    if ((key[0] === 'T' || key[0] === 'A') && t('flat')) {
      const f = flatOf(t('flat'));
      if (f && units.has(f)) changes.push({ key, where, what: 'Flat', value: f }); else errors.push(`${where}: flat "${t('flat')}" is not a flat of this project.`);
    }
    if (t('note')) changes.push({ key, where, what: key[0] === 'I' ? 'Checked' : 'Explained', value: t('note').slice(0, 600) });
  }
  if (!apply || errors.length) return { changes, errors, applied: false };
  await db.tx(async (t) => {
    for (const c of changes) {
      const id = Number(c.key.slice(1));
      if (c.what === 'PAN' || c.what === 'Email' || c.what === 'Mobile') {
        const y = await t.one(`select y.id, y.pan, y.email, y.phone from booking_applicants a join buyers y on y.id = a.buyer_id join bookings b on b.id = a.booking_id join units u on u.id = b.unit_id
          where a.booking_id = $1 and u.project_id = $2 order by a.seq limit 1`, [id, projectId]);
        if (!y) continue;
        const colName = { PAN: 'pan', Email: 'email', Mobile: 'phone' }[c.what];
        await t.q(`update buyers set ${colName} = $2 where id = $1`, [y.id, c.value]);
        await audit.record(t.q, { user, action: 'update', entity: 'buyer', entityId: y.id, projectId, before: { [colName]: y[colName] || null }, after: { [colName]: c.value }, note: 'Open queries: uploaded corrections.' });
        await t.q(`update import_issues set status = 'resolved', resolution = $3, resolved_by = $4, resolved_at = now() where booking_id = $1 and status = 'open' and kind = $2`,
          [id, { PAN: 'bad-pan', Email: 'no-email', Mobile: 'no-mobile' }[c.what], `${c.what} filled from the uploaded Open queries sheet.`, user.id]);
      } else if (c.what === 'Flat' && c.key[0] === 'T') {
        await t.q('update acc_tds_entries set unit_no = $2, updated_by = $3, updated_at = now() where id = $1', [id, c.value, user.id]);
        await audit.record(t.q, { user, action: 'update', entity: 'acc-tds', entityId: id, after: { unit_no: c.value }, note: 'Open queries: uploaded corrections.' });
      } else if (c.what === 'Flat' && c.key[0] === 'A') {
        await t.q("update acc_receipts set unit_no = $2, payer_type = coalesce(payer_type, 'Current buyer'), updated_by = $3, updated_at = now() where id = $1", [id, c.value, user.id]);
        await audit.record(t.q, { user, action: 'update', entity: 'acc-receipts', entityId: id, after: { unit_no: c.value }, note: 'Open queries: uploaded corrections.' });
      } else if (c.what === 'Checked') {
        await t.q("update import_issues set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() where id = $1 and status = 'open'", [id, c.value, user.id]);
        await audit.record(t.q, { user, action: 'resolve', entity: 'import-issue', entityId: id, projectId, note: c.value });
      } else {
        await t.q('insert into query_notes (key, note, user_id) values ($1, $2, $3) on conflict (key) do update set note = excluded.note, user_id = excluded.user_id, at = now()', [c.key, c.value, user.id]);
        await audit.record(t.q, { user, action: 'explain', entity: 'open-query', projectId, after: { key: c.key, where: c.where }, note: c.value });
      }
    }
  });
  return { changes, errors, applied: true };
}

module.exports = { build, sheets, upload, save };
