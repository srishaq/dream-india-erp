// Dream Aspire buyers' contact details from the CRM's collection report ("Collection Report until Comm of sanitary
// fitting…", sheet DATA): for each flat, the buyers' names (joined with "/"), one contact number and email, an address
// and a PAN for each applicant. Savita keeps that sheet up to date (23 Nov 2026).
//   parse(sheets)            → { flats: [{ unit, names, phone, phones, email, addresses, pans }], issues }
//   plan(q, parsed, pid)     → what would change on each booking, and what does not fit
//   commit(t, parsed, opts)  → fills the buyers' details
// Each ERP buyer is matched to the sheet's buyer with the most words of the name in common (else by order). Only empty
// details are filled, and a name only where the sheet gives the same person in full (every word of the ERP's name is in
// the sheet's). A detail the ERP already has that differs from the sheet is listed, not overwritten. A buyer on the
// sheet that the booking does not have is added to the booking as the next applicant.
const audit = require('./audit');
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const blank = (s) => !norm(s) || /^[-–—.]+$|^(na|n\/a|nil|null)$/i.test(norm(s));
const words = (s) => norm(s).toLowerCase().replace(/^(mr|mrs|ms|miss|dr)\.?\s+/, '').replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length > 1);
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Indian mobiles as 10 digits; a number written with + and a country code (abroad) kept as +digits
const phonesOf = (v) => String(v ?? '').split(/[\/,;&]|\s{2,}/).map((x) => {
  const d = x.replace(/\D/g, '');
  if (/^\s*\+/.test(x) && !/^\+?\s*91/.test(x.trim()) && d.length >= 9 && d.length <= 15) return '+' + d;
  const m = d.replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(m) ? m : null;
}).filter(Boolean);
const emailsOf = (v) => String(v ?? '').split(/[;,\/\s]+/).map((x) => x.trim()).filter((x) => EMAIL.test(x));
const overlap = (a, b) => { const B = new Set(words(b)); return words(a).filter((w) => B.has(w)).length; };

function parse(sheets) {
  const sh = sheets.find((s) => /^data$/i.test(String(s.name).trim()));
  if (!sh) throw new Error('No DATA sheet in this workbook.');
  const h = sh.rows.findIndex((r) => r && r.some((c) => /^flat no/i.test(norm(c))) && r.some((c) => /contact/i.test(norm(c))));
  if (h < 0) throw new Error('The DATA sheet has no FLAT NO. / CONTACT NUMBER heading.');
  const H = sh.rows[h].map((c) => norm(c).toLowerCase());
  const col = (re, from = 0) => H.findIndex((c, i) => i >= from && re.test(c));
  const C = { flat: col(/^flat no/), names: col(/^particulars/), phone: col(/^contact/), email: col(/^email/) };
  const addr = [col(/^address for 1/), col(/^address for 2/), col(/^address for 3/)];
  const pan = [col(/^1st applicant\s+pan/), col(/^2nd applicant\s+pan/), col(/^3n?r?d applicant\s+pan/)];
  const flats = [], issues = [];
  for (const r of sh.rows.slice(h + 1)) {
    if (!r) continue;
    const no = norm(r[C.flat]);
    if (!/^\d{3,4}$/.test(no)) continue;
    const unit = `A-${no}`;
    const names = norm(r[C.names]).replace(/\bM\s*\/\s*S\b\.?/gi, 'M/s.').split(/\/(?!s\.)/).map(norm).filter((x) => !blank(x));
    if (!names.length || /^assigned to/i.test(names[0])) continue;
    const phones = phonesOf(r[C.phone]);
    if (!blank(r[C.phone]) && !phones.length) issues.push({ unit, kind: 'phone', note: `Contact number "${norm(r[C.phone])}" is not a 10-digit mobile.` });
    const emails = emailsOf(r[C.email]);
    if (!blank(r[C.email]) && !emails.length) issues.push({ unit, kind: 'email', note: `Email "${norm(r[C.email])}" does not look right.` });
    const pans = pan.map((i) => (i < 0 ? '' : norm(r[i]).toUpperCase().replace(/\s/g, '')));
    pans.forEach((p, i) => { if (p && !blank(p) && !PAN.test(p)) { issues.push({ unit, kind: 'pan', note: `PAN of applicant ${i + 1} "${p}" is not a valid PAN.` }); pans[i] = ''; } else if (blank(p)) pans[i] = ''; });
    flats.push({ unit, names, phone: phones[0] || '', phones, email: emails[0] || '', emails, addresses: addr.map((i) => (i < 0 || blank(r[i]) ? '' : norm(r[i]))), pans });
  }
  return { flats, issues };
}

async function plan(q, parsed, projectId) {
  const rows = await q(`select u.unit_no, b.id as booking_id, a.seq, y.id as buyer_id, y.name, y.phone, y.email, y.address, y.pan
      from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id join buyers y on y.id = a.buyer_id
     where u.project_id = $1 and b.status in ('active', 'pending') order by u.unit_no, a.seq`, [projectId]);
  const by = new Map();
  for (const r of rows) (by.get(r.unit_no) || by.set(r.unit_no, []).get(r.unit_no)).push(r);
  const changes = [], issues = [...parsed.issues], differ = [], adds = [];
  for (const f of parsed.flats) {
    const apps = by.get(f.unit);
    if (!apps) { issues.push({ unit: f.unit, kind: 'no-booking', note: `No booking for ${f.unit} in the ERP (sheet: ${f.names.join(' / ')}).` }); continue; }
    // which sheet buyer is which ERP buyer: most name words in common, else the next one in order
    const taken = new Set(), pick = [];
    for (const a of apps) {
      let best = -1, score = 0;
      f.names.forEach((nm, j) => { const o = overlap(a.name, nm); if (!taken.has(j) && o > score) { score = o; best = j; } });
      pick.push(best); if (best >= 0) taken.add(best);
    }
    pick.forEach((j, i) => { if (j < 0) { const k = f.names.findIndex((_, x) => !taken.has(x)); if (k >= 0) { pick[i] = k; taken.add(k); } } });
    // a number or email for each buyer when the sheet gives one per buyer, else the first for the first buyer
    let weak = false;
    const per = (list, j, i) => (list.length > 1 && list.length === f.names.length ? list[j] : i === 0 ? list[0] : '') || '';
    apps.forEach((a, i) => {
      const set = {}, j = pick[i];
      const sheetName = j >= 0 ? f.names[j] : '';
      // the same person: the ERP's name in full in the sheet's, or two words alike; else only the flat's number and
      // email (on the first buyer) are taken, not that person's PAN and address
      const w0 = words(a.name), sw0 = new Set(words(sheetName));
      const same = !!sheetName && (w0.every((x) => sw0.has(x)) || [...sw0].every((x) => w0.includes(x)) || overlap(a.name, sheetName) >= 2);
      if (!same) weak = true;
      if (sheetName && norm(a.name).toLowerCase() !== sheetName.toLowerCase()) {
        const w = words(a.name), sw = new Set(words(sheetName));
        if (w.length && w.every((x) => sw.has(x))) set.name = sheetName;
        else differ.push({ unit: f.unit, applicant: i + 1, what: 'name', erp: a.name, sheet: sheetName });
      }
      const fill = (k, v) => { if (!v) return; if (blank(a[k])) set[k] = v; else if (norm(a[k]).toLowerCase().replace(/\s/g, '') !== v.toLowerCase().replace(/\s/g, '')) differ.push({ unit: f.unit, applicant: i + 1, what: k, erp: a[k], sheet: v }); };
      if (j >= 0 && (same || i === 0)) { fill('phone', per(f.phones, j, i)); fill('email', per(f.emails, j, i)); }
      if (j >= 0 && same) {
        fill('address', j > 0 && /same|as above/i.test(f.addresses[j] || '') ? f.addresses[0] : f.addresses[j]);
        fill('pan', f.pans[j]);
      }
      if (Object.keys(set).length) changes.push({ unit: f.unit, applicant: i + 1, buyerId: a.buyer_id, from: { name: a.name }, set });
    });
    // buyers on the sheet that the booking does not have (not when the sheet's names and the ERP's do not agree: that
    // flat is listed to check)
    if (weak) { const left = f.names.filter((_, j) => !taken.has(j)); if (left.length) issues.push({ unit: f.unit, kind: 'names-differ', note: `The sheet's buyers (${f.names.join(' / ')}) are not the ERP's (${apps.map((a) => a.name).join(' / ')}); nothing added. Check the booking.` }); continue; }
    let seq = Math.max(...apps.map((a) => a.seq));
    f.names.forEach((nm, j) => {
      if (taken.has(j)) return;
      // already inside an ERP buyer's name ("Raminder Kaur Jatinder Singh" holds Raminder Kaur): not added again
      if (apps.some((a) => { const W = new Set(words(a.name)); return words(nm).every((x) => W.has(x)); })) return;
      const d = { name: nm, phone: per(f.phones, j, 99) || null, email: per(f.emails, j, 99) || null, address: (/same|as above/i.test(f.addresses[j] || '') ? f.addresses[0] : f.addresses[j]) || null, pan: f.pans[j] || null };
      adds.push({ unit: f.unit, bookingId: apps[0].booking_id, seq: ++seq, ...d });
    });
  }
  const sheetUnits = new Set(parsed.flats.map((f) => f.unit));
  const notInSheet = [...by.keys()].filter((u) => !sheetUnits.has(u));
  return { changes, adds, differ, issues, notInSheet, bookings: by.size };
}

async function commit(t, parsed, { projectId, user, source }) {
  const p = await plan(t.q, parsed, projectId);
  for (const c of p.changes) {
    const keys = Object.keys(c.set);
    await t.q(`update buyers set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [c.buyerId, ...keys.map((k) => c.set[k])]);
  }
  for (const a of p.adds) {
    const y = await t.one('insert into buyers (name, phone, email, address, pan, import_key) values ($1, $2, $3, $4, $5, $6) returning id', [a.name, a.phone, a.email, a.address, a.pan, `aspire-contacts:${a.unit}:${a.seq}`]);
    await t.q('insert into booking_applicants (booking_id, seq, buyer_id) values ($1, $2, $3)', [a.bookingId, a.seq, y.id]);
  }
  const n = (k) => p.changes.filter((c) => c.set[k]).length;
  const out = { buyers: p.changes.length, added: p.adds.length, names: n('name'), phones: n('phone'), emails: n('email'), addresses: n('address'), pans: n('pan'), differ: p.differ.length, issues: p.issues.length };
  await audit.record(t.q, { user, action: 'aspire-contacts', entity: 'project', entityId: projectId, projectId, after: out, note: `Buyers' contact details from ${source}` });
  return { ...out, plan: p };
}

module.exports = { parse, plan, commit, phonesOf };
