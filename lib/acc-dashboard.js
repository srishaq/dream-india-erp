// Accounts dashboard: the live portal's Accounts page (13 tabs) runs its own model (lib/master-model.js and
// lib/tenants-model.js, copied unchanged). That model reads the tabs of the Master Accounts sheet; here each tab is
// rebuilt from the ERP's tables with the sheet's own headings, so the page shows the ERP's figures the same way.
const db = require('./db');
const acc = require('./accounts');
const { buildMasterModel } = require('./master-model');
const G = require('./acc-grids');

const BOOK = 'signature';
const n = (v) => Number(v) || 0;
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function tabs() {
  const today = istToday();
  const [receipts, payments] = await Promise.all([G.receipts(), G.payments()]);

  // ---- Bookings (heading on row 3): every sale unit, with its money from the bank registers
  const units = await db.q(`select u.unit_no, bl.code as wing, u.typology, u.status as ustatus, u.sheet_status, b.id as booking_id, b.agreement_value, b.gst_rate, b.stamp_duty, b.registration_fee,
      b.registration_status, b.registration_date, b.booking_date, b.crm_status, b.cp_name,
      (select y.name from booking_applicants a join buyers y on y.id = a.buyer_id where a.booking_id = b.id order by a.seq limit 1) as applicant,
      bb.received_av as crm_av, bb.received_gst as crm_gst, bb.received_sdr as crm_sdr, bb.received_tds as crm_tds
    from units u join buildings bl on bl.id = u.building_id join projects p on p.id = u.project_id
    left join bookings b on b.unit_id = u.id and b.status = 'active' and not b.sample left join booking_balances bb on bb.booking_id = b.id
    where p.code = 'SIGNATURE' and bl.kind <> 'rehab' and not u.sample order by u.unit_no`);
  const M = await acc.unitMoney();
  const HB = ['Unit', 'Wing', 'Typology', 'CRM Status', 'Applicant 1', 'CP Firm (CRM)', 'Allotment Date', 'Registration Status', 'Registration Date', 'Agreement Value', 'GST @5%', 'SDR Payable',
    'Received AV (Bank)', 'Received GST (Bank)', 'Received SDR (Bank)', 'Received Unclassified (Bank)', 'Total Received (Bank)', 'Received from Other / Earlier Buyers', 'Bounced Cheques on Unit',
    'AV Balance', 'GST Balance', 'SDR Balance', 'SDR Paid Out (Challans)', 'Refunds Paid on Unit', 'TDS Received (TDS Tracker)', 'CRM Ledger Total', 'CRM Ledger: TDS'];
  const K = { units: 0, av: 0, rav: 0, rg: 0, gstDue: 0, gstShort: 0, sdrShort: 0 };
  const bookRows = units.map((u) => {
    const m = M[u.unit_no] || {}, av = n(u.agreement_value), ga = Math.round(av * n(u.gst_rate || 5)) / 100, sp = n(u.stamp_duty) + n(u.registration_fee);
    const rav = m.av || 0, rg = m.gst || 0, rsd = m.sdr || 0, un = m.unclassified || 0;
    const reg = u.registration_status || (u.registration_date ? 'Done' : '');
    K.units++;
    if (av) { K.av += av; K.rav += rav; K.rg += rg; const due = rav * ga / av; K.gstDue += due; K.gstShort += Math.max(0, due - rg); }
    // as the sheet's SDR Report status: no SDR amount / challan paid more than received / fully received (within ₹1,000) / registered, SDR short
    const spo = m.sdrPaid || 0;
    if (sp && !(spo > 0 && rsd - spo < -1000) && sp - rsd > 1000 && /^done/i.test(reg)) K.sdrShort++;
    return [u.unit_no, u.wing, u.typology, u.crm_status || u.sheet_status || u.ustatus, u.applicant, u.cp_name, G.D(u.booking_date), reg, G.D(u.registration_date), av || null, ga || null, sp || null,
      rav, rg, rsd, un, rav + rg + rsd + un, m.other || 0, m.bounced || 0, av ? av - rav : 0, ga ? ga - rg : 0, sp ? sp - rsd : 0, m.sdrPaid || 0, m.refunds || 0, m.tds || 0,
      n(u.crm_av) + n(u.crm_gst) + n(u.crm_sdr), n(u.crm_tds)];
  });
  const bookings = [['Bookings (from the ERP)'], [''], HB, ...bookRows];

  // ---- Dashboard key figures (label, value)
  const dashboard = [
    ['Units in CRM', K.units], ['Total Agreement Value', Math.round(K.av)], ['Customer receipts - AV (current buyers)', Math.round(K.rav)],
    ['% of total AV received', K.av ? K.rav / K.av : 0], ['AV balance to collect', Math.round(K.av - K.rav)], ['GST received', Math.round(K.rg)],
    ['GST due on AV already received', Math.round(K.gstDue)], ['GST shortfall on AV received', Math.round(K.gstShort)], ['Units registered but SDR short', K.sdrShort],
  ];

  // ---- Daily Bank Balance: report date, summary with group totals, then the daily entries
  const bal = await acc.balances(today);
  const dbb = [['Daily Bank Balance'], ['Report date', G.D(bal.date)], [], ['Bank', 'A/c No.', 'Opening Balance', 'Receipts', 'Payments', 'Closing Balance']];
  for (const g of bal.groups) {
    for (const r of bal.rows.filter((x) => x.grp === g.grp)) dbb.push([r.bank, r.account_no, r.opening, r.receipts, r.payments, r.closing]);
    dbb.push([`${g.grp} - TOTAL`, '', g.opening, g.receipts, g.payments, g.closing]);
  }
  const s = (k) => bal.groups.reduce((a, g) => a + g[k], 0);
  dbb.push(['GRAND TOTAL', '', s('opening'), s('receipts'), s('payments'), s('closing')], [], ['Date', 'Bank', 'Receipts', 'Payments', 'Remarks', 'Entered by']);
  const ent = await db.q('select * from acc_daily_entries where book = $1 order by entry_date desc, id desc limit 3000', [BOOK]);
  for (const e of ent) dbb.push([G.D(e.entry_date), e.bank, e.receipts == null ? null : n(e.receipts), e.payments == null ? null : n(e.payments), e.remarks, e.entered_by]);

  // ---- Reconciling Items (heading "Item #"), with age, bucket and escalation worked out
  const ri = (await acc.list('recon', { limit: 100000 })).rows;
  const recon = [['Item #', 'Account', 'Side', 'Date', 'Description', 'Amount', 'Age (days)', 'Age Bucket', 'Category', 'What it is', 'Suggested Action', 'Status', 'Owner', 'Resolution Note', 'Escalation', 'Ref'],
    ...ri.map((r, i) => [r.item_no || i + 1, r.bank, r.side, G.D(r.item_date), r.description, n(r.amount), r.age, r.bucket, r.category, r.what, r.action, r.status || 'Open', r.owner, r.resolution, r.escalation, r.ref])];

  // ---- Checks (numbered rows, result in column G)
  const ch = await acc.checks((await db.one("select id from projects where code = 'SIGNATURE'"))?.id || null);
  const checks = ch.map((c, i) => [i + 1, c.check, c.figure, '', '', '', c.result]);

  // ---- PDC (headings on row 4)
  const pd = await db.q('select * from acc_pdc where book = $1 order by due_date, id', [BOOK]);
  const pdc = [['PDC'], [], [], ['Date', 'Cheque issued to', 'Amount', 'Bank', 'PDC due date', 'Cheque No. (optional)', 'Days to due date', 'Status', '48-hour reminder sent', '24-hour reminder sent'],
    ...pd.map((r) => [G.D(r.issued_on), r.issued_to, n(r.amount), r.bank, G.D(r.due_date), r.cheque_no, null, null, G.D(r.reminder48_on), G.D(r.reminder24_on)])];

  // ---- SRA Tenants and Tenant Rent Links (headings on row 4)
  const ten = await db.q('select * from acc_sra_tenants where book = $1 order by survey_no, id', [BOOK]);
  const tenants = [['SRA Tenants'], [], [], ['Survey No', 'Tenant name (rent list)', 'Name on Goodluck master list', 'Area (sq ft)', 'Monthly rent 2025', 'Months per year', 'Rent 2025', 'Yearly increase',
    'Other agreed amount', 'Other agreed amount: what for', 'Status', 'Rent list remark', 'Accounts remark'],
  ...ten.map((t) => [n(t.survey_no), t.name, t.master_name, t.area == null ? null : n(t.area), t.monthly_rent == null ? null : n(t.monthly_rent), t.months == null ? null : n(t.months),
    t.rent_2025 != null ? n(t.rent_2025) : Math.round(n(t.monthly_rent) * n(t.months || 12)), t.yearly_increase == null ? null : n(t.yearly_increase), t.other_amount == null ? null : n(t.other_amount),
    t.other_for, t.status, t.list_remark, t.accounts_remark])];
  const lk = await db.q('select * from acc_rent_links where book = $1 order by id', [BOOK]);
  const links = [['Tenant Rent Links'], [], [], ['Payment ID', 'Survey No', 'Rent year (only if paid early)', 'Split amount (only if one cheque covers 2 survey nos)', 'Status', 'Note / question', 'Checked by / remark'],
    ...lk.map((l) => [l.payment_ref, l.survey_no == null ? null : n(l.survey_no), l.rent_year == null ? null : n(l.rent_year), l.split_amount == null ? null : n(l.split_amount), l.status, l.note, l.checked_by])];

  return { 'Receipts': receipts, 'Payments Out': payments, 'Bookings': bookings, 'Daily Bank Balance': dbb, 'Reconciling Items': recon, 'Checks': checks, 'Dashboard': dashboard,
    'TDS Tracker': await G.tdsTracker(), 'PDC': pdc, 'SRA Tenants': tenants, 'Tenant Rent Links': links };
}

async function model() {
  const { detail, ...rest } = buildMasterModel(await tabs(), new Date(Date.now() + 5.5 * 3600000));
  return { model: rest, detail };
}

module.exports = { tabs, model };
