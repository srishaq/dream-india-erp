// Standard emails to buyers (the Email button on Follow-ups, the booking's Communication panel and replies):
// "Dear Mr. … and Mrs. …," at the top (the salutation is remembered per buyer), a standard subject and text for
// the purpose chosen with the buyer's own figures filled in, and the sender's fixed signature at the bottom
// (name, designation, company, the CRM mailbox). The text in the middle can be edited before sending; the
// greeting and the signature cannot.
const db = require('./db');

const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'M/s.'];
const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (d) => { if (!d) return ''; const s = String(d instanceof Date ? d.toISOString() : d).slice(0, 10); const [y, m, dd] = s.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
const ROLE_TITLE = { crm: 'Customer Relations', head_crm: 'Head – Customer Relations', accounts: 'Accounts', head_accounts: 'Head – Accounts', management: 'Management', admin: 'Management', sales: 'Sales' };

// A salutation already written in the name (Mr Arafat Khan) is used and taken off the name.
function split(name) {
  const m = String(name || '').trim().match(/^(mr|mrs|ms|miss|dr|m\/s)\.?\s+(.*)$/i);
  if (!m) return { salutation: null, name: String(name || '').trim() };
  const s = { mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.', miss: 'Ms.', dr: 'Dr.', 'm/s': 'M/s.' }[m[1].toLowerCase()];
  return { salutation: s, name: m[2].trim() };
}
const greeting = (people) => {
  const names = people.map((p) => `${p.salutation ? p.salutation + ' ' : ''}${p.name}`);
  return `Dear ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || 'Sir / Madam'},`;
};

async function context(bookingId) {
  const b = await db.one(`select b.id, b.agreement_value, b.registration_date, b.registration_status, b.registration_appointment, u.unit_no, p.name as project, c.name as company,
      bb.overdue, bb.outstanding, bb.gst_outstanding, bb.demanded, bb.received_tds, bb.credit_av
    from bookings b join units u on u.id = b.unit_id join projects p on p.id = u.project_id join companies c on c.id = p.company_id join booking_balances bb on bb.booking_id = b.id where b.id = $1`, [bookingId]);
  const ap = await db.q('select y.id, y.name, y.salutation, y.email from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = $1 order by a.seq', [bookingId]);
  const last = await db.one("select stage_name, due_date, demand_date from demands where booking_id = $1 and status = 'raised' order by demand_date desc, id desc limit 1", [bookingId]);
  const av = Number(b.agreement_value) || 0;
  const tdsDue = av >= 5000000 ? Math.max(0, Math.round(Number(b.demanded) / 100 - Number(b.received_tds))) : 0;
  const people = ap.map((a) => { const s = split(a.name); return { id: a.id, name: s.name, salutation: a.salutation || s.salutation, email: a.email }; });
  return { b, people, last, tdsDue, unit: b.unit_no, project: b.project, company: b.company };
}

function templates(x) {
  const { b, last, tdsDue, unit, project } = x;
  const stage = last ? String(last.stage_name).replace(/^On /, 'on ') : '';
  const T = [
    { key: 'payment', label: 'Payment reminder', subject: `Payment reminder: ${project} ${unit}`,
      body: `This is a reminder that ${inr(b.overdue)} is overdue on your flat ${unit} at ${project}${last ? `, against the demand raised ${stage}${last.due_date ? ' (due ' + day(last.due_date) + ')' : ''}` : ''}.${Number(b.gst_outstanding) > 1000 ? ` GST of ${inr(b.gst_outstanding)} is also pending.` : ''}\n\nWe request you to clear the amount at the earliest. If you have already made the payment, please reply to this email with the date, amount and transaction reference so that we can update your account.` },
    { key: 'gst', label: 'GST due', subject: `GST due: ${project} ${unit}`,
      body: `GST of ${inr(b.gst_outstanding)} is pending on your flat ${unit} at ${project}. Please pay it to the GST account mentioned in your demand letter.\n\nIf you have already paid, please reply with the payment details so that we can update your account.` },
    { key: 'tds', label: 'TDS / Form 16B', subject: `TDS and Form 16B: ${project} ${unit}`,
      body: `As per the Income Tax Act (section 194-IA), 1% TDS is deducted on payments for your flat ${unit}.${tdsDue ? ` As per our records, TDS of about ${inr(tdsDue)} is still to be deposited.` : ''}\n\nPlease deposit it using Form 26QB and send us the challan. Once it is processed, please also share the Form 16B certificate so that it is credited to your account.` },
    { key: 'registration', label: 'Registration of agreement', subject: `Registration of your agreement: ${project} ${unit}`,
      body: `We would like to schedule the registration of the agreement for sale for your flat ${unit} at ${project}${b.registration_appointment ? `. The appointment is on ${day(b.registration_appointment)}` : ''}.\n\nPlease bring your original PAN and Aadhaar cards and two passport-size photographs. Stamp duty and registration charges must be paid before the appointment. Please reply to confirm, or let us know a convenient date.` },
    { key: 'documents', label: 'Documents required', subject: `Documents required: ${project} ${unit}`,
      body: `To complete our records for your flat ${unit} at ${project}, we request you to share the following documents:\n\n- \n\nYou can reply to this email with the scanned copies attached.` },
    { key: 'general', label: 'General follow-up', subject: `Follow-up: ${project} ${unit}`, body: `\n\nPlease feel free to reply to this email if you have any questions.` },
  ];
  return T;
}

async function signature(user) {
  const u = await db.one('select name, designation, role, phone from users where id = $1', [user.id]);
  const comp = (await db.one("select c.name from companies c join projects p on p.company_id = c.id where p.code = 'SIGNATURE'"))?.name || 'Prime Realtors';
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  return ['Warm regards,', '', u.name, u.designation || ROLE_TITLE[u.role] || 'Customer Relations', `${comp} · Dream India Group`, 'Dream Signature, Oshiwara, Mumbai', from ? `Email: ${from}` : ''].filter((l, i) => l || i === 1).join('\n');
}

// The finished email: greeting, the (edited) text, the signature.
function compose({ people, body, sig }) { return `${greeting(people)}\n\n${String(body || '').trim()}\n\n${sig}`; }

module.exports = { SALUTATIONS, context, templates, signature, compose, greeting, split };
