// Bank Auto Check (statements matched to Receipts / Payments Out), PDC reminders, the CA page and the cron guard.
// DATABASE_URL=postgres://... node scripts/test-bankauto.js   (a fresh database)
const assert = require('assert/strict');
const path = require('path');
const zlib = require('zlib');
process.env.PORT = process.env.PORT || '3996';
process.env.ACC_FIXTURE = path.join(__dirname, 'fixtures/accounts-sample.js');
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
delete process.env.CRON_SECRET;
const server = require('./dev-server');
const bs = require('../lib/bank-statements');
const xlsx = require('../lib/xlsx');
const pdc = require('../lib/pdc-mail');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, headers = {}) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}

// A tiny .xlsx writer (stored zip, inline strings) to make statement files like the bank's.
function makeXlsx(sheetName, rows) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v == null ? '' : typeof v === 'number'
    ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  const local = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), nm = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    local.push(h, nm, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, e]);
}
const rera = () => makeXlsx('RERA STATEMENT', [
  ['Txn Date', 'Value Date', 'Description', 'Cheque No', 'Dr/Cr', 'INWARD', 'OUTWARD', 'Running Total', 'FLAT NO', 'TALLY NAME', 'COLLECTION TEAM'],
  ['20-09-2026 10:00:00', '20-09-2026', 'OLD LINE BEFORE THE START', 0, 'C', 1, null, '1.00', '', '', ''],
  ['05-10-2026 11:00:00', '05-10-2026', 'NEFT A-1001 BUYER', 'N1', 'C', 485700, null, '4,85,701.00', 'A-1001', 'Rukhsana Soheb Shaikh', 'CRM Team'],
  ['15-10-2026 12:00:00', '15-10-2026', 'CHQ A-1002', 'C9', 'C', 150000, null, '6,35,701.00', 'A-1002', 'Abdul Ahad', 'CRM Team'],
  ['15-10-2026 18:00:00', '15-10-2026', 'CHQ RETN - FUNDS INSUFFICIENT', 'C9', 'D', null, 150000, '4,85,701.00', 'A-1002', '', ''],
  ['20-10-2026 13:00:00', '20-10-2026', 'RTGS CR-TEST BUYER-PRIME REALTORS RERA', 0, 'C', 300000, null, '7,85,701.00', 'a 1001', 'Rukhsana Soheb Shaikh', 'CRM Team'],
  ['21-10-2026 14:00:00', '21-10-2026', 'IMPS/UNKNOWN PAYER/RRN:1234', 0, 'C', 99000, null, '8,84,701.00', '', '', ''],
  ['22-10-2026 08:00:00', '22-10-2026', 'FUNDS TRF TO XX0501/FT TO 092872400000501 - PRIME REALTORS', 0, 'D', null, 400000, '4,84,701.00', '', '', ''],
  ['23-10-2026 10:00:00', '23-10-2026', 'CHQ DEPOSIT MUM-SBI - 23-OCT-26', '777', 'C', 70000, null, '5,54,701.00', 'B-9999', 'Someone', ''],
  ['23-10-2026 19:00:00', '23-10-2026', 'CHQ RETN - SIGNATURE MISMATCH', '777', 'D', null, 70000, '4,84,701.00', 'B-9999', '', ''],
  ['########', '########', 'CHQ DEP AXIS 24-OCT-26 VIKHROLI', '55', 'C', 12345, null, '4,97,046.00', '', '', ''],
]);
const hdfc = () => makeXlsx('HDFC 8650 Bank Book', [
  [], ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance', 'Remarks'],
  ['25/10/26', 'POS 4038XXXX 25OCT26 SOME EATERY', '0000627517229622', '25/10/26', 7556.08, null, 1000000, ''],
  ['26/10/26', 'UNKNOWN CREDIT', '00000X1', '26/10/26', null, 5000, 1005000, ''],
]);
const b64 = (b) => b.toString('base64');

let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  await step('reader: xlsx cells, dates in every layout, references, swapped day and month', async () => {
    const s = xlsx.read(rera());
    assert.equal(s[0].name, 'RERA STATEMENT'); assert.equal(s[0].rows[2][2], 'NEFT A-1001 BUYER'); assert.equal(s[0].rows[2][5], 485700);
    assert.deepEqual(bs.parseDate('22-01-2026 15:49:39'), { date: '2026-01-22', time: '15:49:39' });
    assert.equal(bs.parseDate('27/01/2026 8:00').date, '2026-01-27'); assert.equal(bs.parseDate('02/05/26').date, '2026-05-02'); assert.equal(bs.parseDate('22-OCT-26').date, '2026-10-22');
    assert.equal(bs.refNorm('0000000000025023'), '25023'); assert.equal(bs.refNorm(1.00026e28), ''); assert.equal(bs.refNorm(0), '');
    assert.equal(bs.bankFor('HDFC MISC-9046.xlsx').ledger, 'Prime HDFC Misc'); assert.equal(bs.bankFor('Yes Bank 800 - 70%.xlsx').ledger, 'Yes RERA Collection 70% (0800)');
    assert.equal(bs.bankFor('Yes Bank RERA 700 Ac.xlsx').ledger, 'Yes RERA Collection 100% (0700)'); assert.equal(bs.bankFor('Yes Bank 501 - 30%.xlsx').ledger, 'Yes RERA 30% (0501)');
    const p = bs.parseFile(rera(), 'Yes Bank RERA 700 Ac.xlsx');
    assert.equal(p.error, undefined); assert.equal(p.lines.length, 10); assert.equal(p.undated, 1);
    assert.equal(p.lines[9].date, '2026-10-24'); assert.equal(p.lines[4].flat, 'A-1001'); assert.equal(p.to, '2026-10-24');
    // a real date with day and month swapped is read the way that fits between its neighbours
    const q = bs.parseFile(makeXlsx('HDFC 8650 Bank Book', [['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
      ['09/10/26', 'A', '1', '', 10, null, 1], ['2026-11-10', 'B', '2', '', 20, null, 2], ['13/10/26', 'C', '3', '', 30, null, 3]]), 'HDFC Bank 8650.xlsx');
    assert.deepEqual(q.lines.map((l) => l.date), ['2026-10-09', '2026-10-11', '2026-10-13']);
  });

  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
  assert.equal((await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } })).ok, true);
  assert.equal((await admin('/api/accounts', { action: 'import', projectId: sig.id })).ok, true);

  const login = async (username, role, pw) => {
    const c = await admin('/api/users', { action: 'create', name: username, username, role, projects: [sig.id] });
    assert.ok(c.tempPassword, c.error);
    const x = client(); await x('/api/session', { action: 'login', username, password: c.tempPassword }); await x('/api/session', { action: 'password', current: c.tempPassword, next: pw });
    return x;
  };
  let first;
  await step('upload: matched lines are left alone; missing ones are added; returns, sweeps and lines before the start are not', async () => {
    first = await admin('/api/bank-auto', { action: 'upload', files: [{ name: 'Yes Bank RERA 700 Ac.xlsx', data: b64(rera()) }, { name: 'HDFC Bank 8650.xlsx', data: b64(hdfc()) }, { name: 'notes.xlsx', data: b64(makeXlsx('Sheet1', [['hello']])) }] });
    assert.equal(first.status, 200, first.error);
    const add = first.addedRows.map((r) => `${r.side} ${r.bank} ${r.date} ${r.amount}`).sort();
    assert.deepEqual(add, [
      'payment Prime HDFC (8650) 2026-10-25 7556.08',
      'receipt Yes RERA Collection 100% (0700) 2026-10-20 300000',
      'receipt Yes RERA Collection 100% (0700) 2026-10-21 99000',
      'receipt Yes RERA Collection 100% (0700) 2026-10-24 12345',
    ]);
    assert.equal(first.updated, 0); // A-1002's cheque is already Bounced
    assert.ok(first.differences.some((d) => d.what === 'Statement file not read' && d.where === 'notes.xlsx'));
    assert.equal(first.tagging.length, 2); // the two receipts with no flat
    const r = await admin('/api/accounts?reg=receipts&q=RTGS CR-TEST');
    const row = r.rows[0];
    assert.equal(row.ref_id, 'BS00001'); assert.equal(row.unit_no, 'A-1001'); assert.equal(row.head, 'Receipts From Customers'); assert.equal(row.payment_head, 'AV');
    assert.equal(row.payer_type, 'Current buyer'); assert.match(row.source, /^Bank statement auto \d\d-[A-Z][a-z]{2}-\d{4}$/); assert.equal(row.on_statement, 'Yes');
    const u = await admin('/api/accounts?reg=receipts&q=UNKNOWN PAYER');
    assert.equal(u.rows[0].remark, 'Added from bank statement. Fill head and payee.'); assert.equal(u.rows[0].head, null);
  });
  await step('Daily Bank Balance is filled from the statement, with its closing balance as Balance per Bank', async () => {
    const b = await admin('/api/accounts?view=balances&date=2026-10-15');
    const e = b.entries.filter((x) => x.bank === 'PRIME RERA COLLECTION 100%' && x.entered_by === 'Auto from bank statement');
    const d15 = e.find((x) => String(x.entry_date).startsWith('2026-10-15'));
    assert.equal(Number(d15.receipts), 150000); assert.equal(Number(d15.payments), 150000); assert.equal(d15.remarks, 'Yes Bank RERA 700 Ac.xlsx');
    const row = b.rows.find((x) => x.bank === 'PRIME RERA COLLECTION 100%'); assert.equal(row.perBank, 485701);
  });
  await step('running again adds nothing; the run history and Bank Auto Check page have both runs', async () => {
    const again = await admin('/api/bank-auto', { action: 'upload', files: [{ name: 'Yes Bank RERA 700 Ac.xlsx', data: b64(rera()) }, { name: 'HDFC Bank 8650.xlsx', data: b64(hdfc()) }] });
    assert.equal(again.added.receipts + again.added.payments, 0); assert.equal(again.daily, 0);
    const g = await admin('/api/bank-auto');
    assert.equal(g.runs.length, 2); assert.equal(g.last.id, again.id); assert.equal(g.settings.pdc_to, 'accounts.prime@dreamindiagroup.com');
    const one = await admin('/api/bank-auto?run=' + first.id); assert.equal(one.run.added_rows.length, 4);
    const t = await admin('/api/accounts?view=todo'); assert.ok(t.items.find((x) => x.task.startsWith('Bank Auto Check')).n >= 2);
  });
  await step('a receipt entered in the ERP but not on the statement is listed; one under the wrong bank says so', async () => {
    await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { txn_date: '2026-10-22', bank: 'Yes RERA Collection 100% (0700)', amount: '42000', description: 'NOT ON STATEMENT' } });
    await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { txn_date: '2026-10-26', bank: 'Yes RERA Collection 100% (0700)', amount: '5000', description: 'UNKNOWN CREDIT (wrong bank)' } });
    const r = await admin('/api/bank-auto', { action: 'upload', files: [{ name: 'Yes Bank RERA 700 Ac.xlsx', data: b64(rera()) }, { name: 'HDFC Bank 8650.xlsx', data: b64(hdfc()) }] });
    assert.ok(r.differences.some((d) => d.what === 'In the ERP, not on the bank statement' && Number(d.amount) === 42000));
    // 26-Oct is after the 0700 statement ends (24-Oct), so that row is not judged yet
    assert.ok(!r.differences.some((d) => Number(d.amount) === 5000));
  });
  await step('a deposit that bounces on the statement marks its receipt Bounced', async () => {
    await admin('/api/accounts', { action: 'save', reg: 'receipts', data: { txn_date: '2026-10-23', bank: 'Yes RERA Collection 100% (0700)', amount: '70000', reference: '777', description: 'CHQ DEPOSIT MUM-SBI - 23-OCT-26' } });
    const r = await admin('/api/bank-auto', { action: 'upload', files: [{ name: 'Yes Bank RERA 700 Ac.xlsx', data: b64(rera()) }] });
    assert.equal(r.updated, 1);
    const x = await admin('/api/accounts?reg=receipts&q=CHQ DEPOSIT MUM-SBI'); assert.equal(x.rows[0].cheque_status, 'Bounced'); assert.match(x.rows[0].remark, /Bounced: returned on 23-Oct-2026/);
  });
  await step('re-importing the sheet removes untouched rows the check added, so nothing is counted twice', async () => {
    const r = await admin('/api/accounts', { action: 'import', projectId: sig.id });
    assert.equal(r.ok, true); assert.equal(r.autoRemoved.receipts, 3); assert.equal(r.autoRemoved.payments, 1); assert.ok(r.autoRemoved.daily > 0);
  });
  await step('only accounts staff can run it; settings are kept', async () => {
    const s = await login('sales1', 'sales', 'sales-password-1');
    assert.equal((await s('/api/bank-auto')).status, 403);
    const st = await admin('/api/bank-auto', { action: 'settings', statement_start: '2026-10-05', statement_folders: 'https://drive.google.com/drive/folders/1JpF8E-vdU0Av4XoVy5CIqR_DqzcDlVEA, bad', pdc_cc: 'a@b.com, nope' });
    assert.equal(st.settings.statement_start, '2026-10-05'); assert.equal(st.settings.statement_folders, '1JpF8E-vdU0Av4XoVy5CIqR_DqzcDlVEA'); assert.equal(st.settings.pdc_cc, 'a@b.com');
  });
  await step('PDC reminders: 2 days before (48-hour) and 1 day before (24-hour), each once', async () => {
    const today = pdc.addDays(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), 0);
    await admin('/api/accounts', { action: 'save', reg: 'pdc', data: { issued_on: today, issued_to: 'TEST TRADERS', amount: '50000', bank: 'Yes RERA 30% (0501)', due_date: pdc.addDays(today, 2) } });
    await admin('/api/accounts', { action: 'save', reg: 'pdc', data: { issued_on: today, issued_to: 'OTHER CO', amount: '9000', due_date: pdc.addDays(today, 1), reminder24_on: today } });
    const d = await pdc.due(today);
    assert.deepEqual(d.map((x) => `${x.kind} ${x.row.issued_to}`), ['48h TEST TRADERS']);
    assert.deepEqual((await pdc.due(pdc.addDays(today, 1))).map((x) => `${x.kind} ${x.row.issued_to}`), ['24h TEST TRADERS']);
    const m = pdc.message('48h', d[0].row); assert.match(m.subject, /PDC due in 2 days: ₹50,000 to TEST TRADERS/);
    const s = await admin('/api/bank-auto', { action: 'pdc-send' });
    assert.equal(s.sent.length, 0); assert.match(s.reason, /Email is not set up yet/);
    const v = await admin('/api/bank-auto?view=pdc'); assert.equal(v.due.length, 1); assert.equal(v.test, true);
  });
  await step('the scheduled job runs only in its hour (or with the cron secret)', async () => {
    const h = +new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 13);
    const r = await fetch(BASE + '/api/cron?job=' + (h === 15 ? 'pdc' : 'bank'));
    assert.equal(r.status, 403);
    process.env.CRON_SECRET = 'test-cron-secret';
    assert.equal((await fetch(BASE + '/api/cron?job=pdc', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await (await fetch(BASE + '/api/cron?job=pdc', { headers: { Authorization: 'Bearer test-cron-secret' } })).json();
    assert.equal(ok.ok, true);
    delete process.env.CRON_SECRET;
  });
  await step('CA page: GST, TDS, RERA and cash flow from the ERP; the CA login sees it and cannot change accounts', async () => {
    const m = await admin('/api/ca');
    assert.equal(m.status, 200, m.error); assert.ok(m.fys.length); assert.equal(m.settings.reraAcct, 'Yes RERA Collection 100% (0700)');
    assert.ok(m.units.length > 0); assert.ok(Object.keys(m.lineBy).length > 0); assert.ok(m.cc.length > 0);
    const det = await admin('/api/ca?detail=1'); assert.ok(det.R.length > 0 && det.P.length > 0);
    const c = await login('ca1', 'ca', 'ca-password-123');
    assert.equal((await c('/api/ca')).status, 200);
    assert.equal((await c('/api/accounts?view=todo')).status, 200);
    assert.equal((await c('/api/accounts', { action: 'save', reg: 'pdc', data: { issued_on: '2026-10-26', issued_to: 'X', amount: '1', due_date: '2026-10-30' } })).status, 403);
    const s = client(); await s('/api/session', { action: 'login', username: 'sales1', password: 'sales-password-1' });
    assert.equal((await s('/api/ca')).status, 403);
  });
  await step('Accounts dashboard: the portal Accounts page model from the ERP (banks, collections, units, tenants, PDC)', async () => {
    const m = await admin('/api/acc-dashboard');
    assert.equal(m.status, 200, m.error);
    assert.ok(m.banks.some((b) => b.b === 'SIGNATURE - TOTAL') && m.banks.some((b) => b.b === 'GRAND TOTAL'));
    assert.ok(m.units.length > 0); assert.ok(m.C.AV.td > 0); assert.ok(m.tenants && m.tenants.rows.length === 2); assert.ok(m.pdc.rows.length >= 2);
    assert.equal(typeof m.D['Units in CRM'], 'number');
    const det = await admin('/api/acc-dashboard?detail=1'); assert.ok(det.R.length > 0);
    const s = client(); await s('/api/session', { action: 'login', username: 'sales1', password: 'sales-password-1' });
    assert.equal((await s('/api/acc-dashboard')).status, 403);
  });
  await step('clear accounts data (test version): registers emptied, banks and heads kept, CRM untouched', async () => {
    assert.equal((await admin('/api/accounts', { action: 'clear', confirm: 'no' })).status, 400);
    const before = (await admin('/api/ledger?project=' + sig.id)).status;
    const r = await admin('/api/accounts', { action: 'clear', confirm: 'CLEAR' });
    assert.equal(r.ok, true); assert.ok(r.removed.acc_receipts > 0);
    assert.equal((await admin('/api/accounts?reg=receipts')).rows.length, 0);
    const L = await admin('/api/accounts?view=lists'); assert.ok(L.banks.length > 0 && L.heads.length > 0);
    assert.equal((await admin('/api/ledger?project=' + sig.id)).status, before);
  });
  await step('Tally: Receipt and Payment Registers replace the registers; comparing with a statement lists what differs', async () => {
    const reg = (title, kind, vouchers) => makeXlsx('Sheet1', [['M/S. PRIME REALTORS'], ['Maharashtra,India'], [title], ['1-Apr-25 to 31-Mar-27'],
      ['Date', 'Particulars', '', '', 'Vch Type', 'Vch No.', 'Debit', 'Credit'], ['', '', '', '', '', '', 'Amount', 'Amount'], ...vouchers.flat(), ['Total:', null, null, null, null, null, null, 1]]);
    const R = reg('Receipt Register', 'Receipt', [
      [['2026-10-05', 'A-1001 -Rukhsana Soheb Shaikh', '', '', 'Receipt', '1', null, 485700], ['', 'YES Bank MC A/c 092872500000700 - 100%', '', '', '', '', 485700, null]],
      [['2026-10-20', 'B/1002 Somebody(Cancel Flat)', '', '', 'Receipt', '2', null, 100000], ['', 'UPI/Transaction Charges', '', '', '', '', 100, null], ['', 'YES Bank MC A/c 092872500000700 - 100%', '', '', '', '', 99900, null]],
      [['2026-10-21', 'Investor Loan', '', '', 'Receipt', '3', null, 50000], ['', 'Cash', '', '', '', '', 50000, null]],
    ]);
    const P = reg('Payment Register', 'Payment', [
      [['2026-10-15', 'A-1002 Abdul Ahad', '', '', 'Payment', '1', 150000, null], ['', 'YES Bank MC A/c 092872500000700 - 100%', '', '', '', '', null, 150000]],
      [['2026-10-22', 'Skyway RMC', '', '', 'Payment', '2', 400000, null], ['', 'Yes Bank Ltd RERA 092872400000501 - 30%', '', '', '', '', null, 400000]],
    ]);
    const files = [{ name: 'Receipts.xlsx', data: b64(R) }, { name: 'Payments.xlsx', data: b64(P) }];
    const pv = await admin('/api/accounts', { action: 'tally-preview', files });
    assert.equal(pv.status, 200, pv.error); assert.equal(pv.summary.receipts, 3); assert.equal(pv.summary.payments, 2);
    const im = await admin('/api/accounts', { action: 'tally-import', files });
    assert.equal(im.ok, true, im.error);
    const r = (await admin('/api/accounts?reg=receipts')).rows;
    assert.equal(r.length, 3);
    const a = r.find((x) => x.unit_no === 'A-1001'); assert.equal(a.payment_head, 'AV'); assert.equal(a.head, 'Receipts From Customers'); assert.equal(a.bank, 'Yes RERA Collection 100% (0700)');
    const b = r.find((x) => x.unit_no === 'B-1002'); assert.equal(Number(b.amount), 99900); assert.equal(b.payer_type, 'Other / earlier buyer'); assert.match(b.remark, /UPI\/Transaction Charges/);
    const c = await admin('/api/bank-auto', { action: 'upload', compare: true, from: '2026-10-01', files: [{ name: 'Yes Bank RERA 700 Ac.xlsx', data: b64(rera()) }] });
    assert.equal(c.status, 200, c.error);
    const what = (w) => c.differences.filter((d) => d.what === w).map((d) => Number(d.amount)).sort((x, y) => x - y);
    assert.deepEqual(what('On the bank statement, not in the books (money in)'), [12345, 99000, 150000, 300000]);
    assert.deepEqual(what('In the books, not on the bank statement'), [99900]);
    assert.ok(c.differences.some((d) => d.what === 'On the bank statement, not in the books (money out)' && d.where === 'Transfer between own accounts' && Number(d.amount) === 400000));
    assert.equal((await admin('/api/accounts?reg=receipts')).rows.length, 3); // nothing added
    const g = await admin('/api/bank-auto'); assert.equal(g.runs[0].trigger, 'compare'); assert.ok(!g.last || g.last.trigger !== 'compare');
  });
  console.log(`bank auto, PDC and CA: ${n} checks passed`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
