// Records the training videos in public/training/ (one .mp4 and a poster .jpg per module in lib/training.js).
// Runs the ERP against an EMPTY database, fills it with made-up sample data (Sample Buyer …, Sample Bank …), then plays
// each lesson in a browser with captions and a pointer, and saves the recording. No real buyer or bank data is used.
//   DATABASE_URL=postgres://…/empty_db node scripts/make-training.js [module ...]
// Needs Playwright (Chromium) and ffmpeg. For the voice: PIPER=/path/to/piper PIPER_VOICE=/path/to/voice.onnx
// (Piper and its voices: github.com/rhasspy/piper releases, e.g. v0.0.2 voice-en-us-lessac-medium).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.PORT = process.env.PORT || '3310';
require('./dev-server');
const { chromium } = require('playwright');
const db = require('../lib/db');
const auth = require('../lib/auth');
const { ALL: MODULES } = require('../lib/training');

const BASE = `http://localhost:${process.env.PORT}`;
const OUT = process.env.TRAINING_OUT || path.join(__dirname, '../public/training'); // TRAINING_OUT: a trial run somewhere else
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'erp-training-'));
const W = 1280, H = 800;
const PW = 'training-pass-1';
const ist = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);

async function api(cookie, p, body) {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${j.error || r.status}`);
  return { j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

// ---------- sample company ----------
async function seed() {
  if ((await db.one("select to_regclass('users') as t")).t && (await db.one('select count(*)::int as n from users')).n) throw new Error('Use an empty database: this one already has logins.');
  await api('', '/api/session', { action: 'setup', name: 'Demo User', username: 'demo', password: PW });
  const login = await api('', '/api/session', { action: 'login', username: 'demo', password: PW });
  const ck = login.cookie;
  const sig = (await api(ck, '/api/masters')).j.projects.find((p) => p.code === 'SIGNATURE');
  await api(ck, '/api/sample', { action: 'load', projectId: sig.id });
  for (const [u, n, r] of [['ayesha', 'Ayesha (CRM)', 'crm'], ['imran', 'Imran (Accounts)', 'accounts'], ['headacc', 'Head Accounts', 'head_accounts'], ['headcrm', 'Head CRM', 'head_crm']]) {
    const x = await db.one('insert into users (username, name, role, password_hash, all_projects) values ($1, $2, $3, $4, true) returning id', [u, n, r, auth.hashPassword(PW)]);
    await db.q('insert into user_projects (user_id, project_id) values ($1, $2) on conflict do nothing', [x.id, sig.id]).catch(() => {});
  }
  const t = ist();
  const banks = [['Sample Bank Collection A/c', 'XXXX1111', 'SIGNATURE', 4500000], ['Sample Bank RERA 70% A/c', 'XXXX2222', 'SIGNATURE', 12500000], ['Sample Bank GST A/c', 'XXXX3333', 'SIGNATURE', 900000]];
  for (const [i, [nm, no, g, bf]] of banks.entries()) {
    await db.q('insert into acc_banks (name, account_no) values ($1, $2)', [nm, no]);
    await db.q('insert into acc_daily_banks (name, account_no, grp, seq, bf_balance, bf_date, ledger_bank) values ($1, $2, $3, $4, $5, $6, $1)', [nm, no, g, i, bf, addDays(t, -10)]);
  }
  for (const [nm] of [['Customer receipt'], ['Internal transfer'], ['Other income']]) await db.q("insert into acc_heads (side, name) values ('receipt', $1) on conflict do nothing", [nm]);
  for (const [nm, bill] of [['Contractor', true], ['Material purchase', true], ['Salary', false], ['Bank charges', false], ['SDR', false], ['Flat - Cancelled Refunded', false]]) await db.q("insert into acc_heads (side, name, needs_bill) values ('payment', $1, $2) on conflict do nothing", [nm, bill]);
  // receipts: the CRM's sample receipts of the last 10 days, as they came into the bank
  const rc = await db.q(`select r.amount, r.received_on, u.unit_no from receipts r join bookings b on b.id = r.booking_id join units u on u.id = b.unit_id where r.status = 'approved' order by r.id desc limit 24`).catch(() => []);
  let k = 1;
  for (const [i, r] of rc.entries()) {
    const d = addDays(t, -1 - (i % 9));
    await db.q(`insert into acc_receipts (ref_id, txn_date, bank, description, amount, head, payment_head, unit_no, payer_name, payer_type, on_statement, cheque_status)
                values ($1, $2, $3, $4, $5, $6, 'AV', $7, $8, 'Buyer', 'Yes', 'Cleared')`,
    [`R-${k++}`, d, banks[i % 2][0], `NEFT ${r.unit_no} SAMPLE BUYER`, r.amount, i % 7 === 3 ? null : 'Customer receipt', i % 5 === 4 ? null : r.unit_no, `Sample Buyer ${r.unit_no}`]);
  }
  k = 1;
  for (const [i, [p, h, a]] of [['Sample Builders Pvt Ltd', 'Contractor', 1850000], ['Sample Cement Traders', 'Material purchase', 642000], ['Staff salary October', 'Salary', 410000], [null, 'Bank charges', 1180], ['Sample Steel Suppliers', 'Material purchase', 925000], [null, null, 35000], ['Sample Electricals', 'Contractor', 212000]].entries()) {
    await db.q('insert into acc_payments (ref_id, txn_date, bank, description, amount, head, payee) values ($1, $2, $3, $4, $5, $6, $7)', [`P-${k++}`, addDays(t, -1 - i), banks[1][0], `RTGS ${p || 'TRANSFER'}`, a, h, p]);
  }
  for (let i = 1; i <= 6; i++) for (const b of banks) await db.q("insert into acc_daily_entries (entry_date, bank, receipts, payments, entered_by) values ($1, $2, $3, $4, 'Imran (Accounts)')", [addDays(t, -i), b[0], 150000 * (i % 3 + 1), 90000 * (i % 2 + 1)]);
  await db.q('insert into acc_pdc (issued_on, issued_to, amount, bank, due_date, cheque_no) values ($1, $2, $3, $4, $5, $6), ($1, $7, $8, $4, $9, $10)', [addDays(t, -20), 'Sample Builders Pvt Ltd', 1500000, banks[1][0], addDays(t, 1), '000123', 'Sample Cement Traders', 480000, addDays(t, 2), '000124']);
  for (const [c, per, due, st] of [['GSTR-3B and GST payment', 'Sep-2026', addDays(t, -3), 'Pending'], ['TDS deposit (deducted by us)', 'Oct-2026', addDays(t, 1), 'Pending'], ['Professional Tax payment and return', 'Sep-2026', addDays(t, -20), 'Complied'], ['RERA quarterly progress update', 'Q2 Jul-Sep 2026', addDays(t, 9), 'Pending']]) await db.q('insert into acc_compliance (compliance, period, due_date, status) values ($1, $2, $3, $4)', [c, per, due, st]);
  for (const [i, [s, d, a]] of [['Credit', 'NEFT UNKNOWN PAYER', 125000], ['Debit', 'CHQ 000119 NOT IN BOOKS', 48000], ['Credit', 'IMPS REF 99812', 50000]].entries()) await db.q("insert into acc_recon_items (item_no, bank, side, item_date, description, amount, status) values ($1, $2, $3, $4, $5, $6, 'Open')", [i + 1, banks[0][0], s, addDays(t, -2 - i), d, a]);
  // cancelled flats: one still booked in the CRM to the same buyer
  const bk = await db.q("select u.unit_no, y.name from bookings b join units u on u.id = b.unit_id join booking_applicants a on a.booking_id = b.id and a.seq = 1 join buyers y on y.id = a.buyer_id where b.status = 'active' order by u.unit_no limit 3");
  for (const [i, r] of bk.entries()) await db.q('insert into acc_cancellations (cancel_date, unit_no, client, final_av, received, refund_status, imported) values ($1, $2, $3, $4, $5, $6, true)', [addDays(t, -40 - i * 30), r.unit_no, i === 0 ? r.name : `Earlier Buyer ${r.unit_no}`, 9500000, 450000 + i * 100000, i === 2 ? 'Done' : 'Pending']);
  for (const dept of ['accounts', 'crm']) await api(ck, '/api/tasks', { action: 'run', dept });
  await api(ck, '/api/tasks', { action: 'add', dept: 'accounts', title: 'Collect the stamped bank statement for September from the branch' });
  // for the full CRM lesson: one booking whose cancellation Ayesha has asked for (Management approves it in the video),
  // and one active booking the video asks to cancel
  const withMoney = await db.q(`select b.id from bookings b join units u on u.id = b.unit_id where b.status = 'active' and exists (select 1 from receipts r where r.booking_id = b.id and r.status = 'approved') order by u.unit_no limit 2`);
  IDS.req = withMoney[0].id; IDS.cancel = withMoney[1].id;
  const ay = (await api('', '/api/session', { action: 'login', username: 'ayesha', password: PW })).cookie;
  await api(ay, '/api/bookings', { action: 'cancel-request', id: IDS.req, reason: 'Buyer could not get the home loan', cancelDate: addDays(t, -1), charges: '50000' });
  IDS.pendingBk = (await db.one("select b.id from bookings b where b.status = 'pending' order by b.id limit 1")).id;
  IDS.flat = (await db.one(`select b.id from bookings b join units u on u.id = b.unit_id join booking_balances bb on bb.booking_id = b.id
    where b.status = 'active' and b.id not in ($1, $2) and exists (select 1 from receipts r where r.booking_id = b.id and r.status = 'approved') order by bb.overdue desc, u.unit_no limit 1`, [IDS.req, IDS.cancel])).id;
  const ayId = (await db.one("select id from users where username = 'ayesha'")).id;
  const wings = Object.fromEntries((await db.q('select code from buildings')).map((x) => [x.code, [ayId]]));
  await db.q("insert into settings (key, value) values ('crm_wings', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(wings)]);
  await db.q("insert into communications (booking_id, channel, direction, from_addr, subject, body, sent_at, status, read_at) values ($1, 'email', 'in', 'sample.buyer@example.com', 'Registration date', 'Dear Sir, can we fix the registration next week? Regards', now() - interval '3 days', 'matched', now())", [IDS.flat]);
  // final-version extras: TDS on the contractor and material heads, an approved purchase bill to pay, last month's TDS
  // not yet deposited, yesterday's bank balances to confirm, a demand letter to courier, and the CRM's own call lists
  await db.q("update acc_heads set tds_section = '194C', tds_rate = 0.01 where name = 'Contractor'");
  await db.q("update acc_heads set tds_section = '194Q', tds_rate = 0.001 where name = 'Material purchase'");
  await db.q("insert into portal_kv (key, field, value) values ('po:orders', 'PO2026001', $1) on conflict (key, field) do update set value = excluded.value",
    [{ id: 'PO2026001', material: 'Material', line: 'A wing|7th slab', status: 'accounts_ok', order: { vendor: 'Sample Cement Traders', amount: 595000, billNo: 'SCT-118', billDate: addDays(t, -6), poNo: 'PO-118' }, accounts: { by: 'headacc', at: new Date().toISOString(), payable: 595000 }, history: [] }]);
  const lm = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 15)).toISOString().slice(0, 10);
  await db.q("insert into acc_payments (ref_id, txn_date, bank, description, amount, head, payee, taxable_value, tds_section, tds_rate, tds_deducted) values ('P-90', $1, $2, 'RTGS SAMPLE BUILDERS RA BILL', 990000, 'Contractor', 'Sample Builders Pvt Ltd', 1000000, '194C', 0.01, 10000)", [lm, banks[1][0]]);
  const dbk = await db.q('select id from acc_daily_banks order by seq');
  for (const [i, x] of dbk.entries()) await db.q('insert into acc_bank_stated (daily_bank_id, on_date, balance) values ($1, $2, $3) on conflict do nothing', [x.id, addDays(t, -1), 4500000 + i * 1000]);
  const noMail = await db.one("select b.id from bookings b where b.status = 'active' and b.id not in ($1, $2, $3) order by b.id desc limit 1", [IDS.req, IDS.cancel, IDS.flat]);
  await db.q("update buyers set email = null where id in (select buyer_id from booking_applicants where booking_id = $1)", [noMail.id]);
  await require('../lib/letters').prepareOne({ bookingId: noMail.id, type: 'Demand Letter', letterDate: t, set: await require('../lib/letters').settings(), user: null, projectId: sig.id }).catch((e) => console.warn('courier letter', e.message));
  await db.q("insert into settings (key, value) values ('letters', $1) on conflict (key) do update set value = settings.value || excluded.value", [{ testEmail: 'training@example.com', testMobile: '9800000000' }]);
  for (const dept of ['accounts', 'crm']) await api(ck, '/api/tasks', { action: 'run', dept });
  await seedSite(sig);
  return { sig };
}

// ---------- Construction and Purchase sample (made-up vendors and contractor) ----------
async function seedSite(sig) {
  for (const [u, n, r] of [['ravi', 'Ravi (Site Engineer)', 'site_engineer'], ['sameer', 'Sameer (Management)', 'management'], ['farhan', 'Farhan (Purchase)', 'purchase_team']]) {
    const x = await db.one('insert into users (username, name, role, password_hash, all_projects, email) values ($1, $2, $3, $4, true, $5) returning id', [u, n, r, auth.hashPassword(PW), u + '@example.com']);
    await db.q('insert into user_projects (user_id, project_id) values ($1, $2) on conflict do nothing', [x.id, sig.id]).catch(() => {});
  }
  const as = async (u) => (await api('', '/api/session', { action: 'login', username: u, password: PW })).cookie;
  const ravi = await as('ravi'), sameer = await as('sameer'), farhan = await as('farhan'), headacc = await as('headacc');
  const t = ist();
  const S = (await api(ravi, '/api/site')).j; // the slab schedule is loaded on first open
  const A = Object.values(S.towers).find((x) => x.key === 'a'), sl = [...A.slabs].sort((x, y) => x.seq - y.seq);
  // A-Wing: plinth and three slabs cast, the 4th in progress (reinforcement)
  for (const [i, s0] of sl.slice(0, 4).entries()) await api(ravi, '/api/site', { op: 'set', col: 'progress', id: s0.id, data: { status: 'cast', stage: 'cast', actualStart: addDays(t, -70 + i * 15), actualEnd: addDays(t, -58 + i * 15) } });
  await api(ravi, '/api/site', { op: 'set', col: 'progress', id: sl[4].id, data: { status: 'progress', stage: 'reinforcement', actualStart: addDays(t, -6) } });
  await db.q("delete from daily_tasks where key like 'slab-stage:%'");
  { const kv = require('../lib/portal/kv'); // entered earlier, not today (so Today's "Done today" list starts empty)
    for (const [i, s0] of sl.slice(0, 5).entries()) { const d = await kv.hget('site:progress', s0.id); await kv.hset('site:progress', s0.id, { ...d, updatedAt: addDays(t, i < 4 ? -58 + i * 15 : -1) + 'T10:00:00.000Z' }); } }
  // a pour seven days ago: its 7-day cube test is due today; the RMC and steel used, with design quantities
  await api(ravi, '/api/site', { op: 'add', col: 'pours', data: { date: addDays(t, -7), grade: 'M40', tower: 'a', slab: sl[3].id, element: 'Slab & beams', qty: 186, supplier: 'Sample Concrete Co.', challans: 'SC-4410, SC-4411', sets: 2, cubes: { d7: { due: t }, d28: { due: addDays(t, 21) } } } });
  await api(ravi, '/api/site', { op: 'set', col: 'materials', id: addDays(t, -7), data: { date: addDays(t, -7), items: { u1: { type: 'used', material: 'rmc', qty: 186, theo: 178, unit: 'm³', spec: 'M40', tower: 'a', slab: sl[3].id }, u2: { type: 'used', material: 'steel', qty: 21.6, theo: 21, unit: 'MT', tower: 'a', slab: sl[3].id } } } });
  // purchase: steel ordered and on its way; cement received with its bill at Accounts; RMC waiting for Sameer
  const P = (ck, b) => api(ck, '/api/me?purchase=1', b);
  const g = (await api(ravi, '/api/me?purchase=1')).j;
  const line = g.budget.lines.find((l) => l.building === 'Sale' && l.steel > 0 && !/Foundation/.test(l.floor)).key;
  const steel = (await P(ravi, { op: 'request', data: { material: 'Steel', items: [{ spec: '12 mm', qty: 6 }, { spec: '16 mm', qty: 9 }], line, wing: 'A wing', neededBy: addDays(t, 3) } })).j.doc;
  await P(sameer, { op: 'approve', id: steel.id, data: {} });
  await P(farhan, { op: 'order', id: steel.id, data: { vendor: 'Sample Steel Suppliers', items: [{ spec: '12 mm', qty: 6, rate: 61500 }, { spec: '16 mm', qty: 9, rate: 60800 }], amount: 916200, billNo: 'SSS-2291', poNo: 'PO-2291' } });
  const cem = (await P(ravi, { op: 'request', data: { material: 'Cement', items: [{ spec: 'OPC 53', qty: 400 }], line: 'Project|Cement', wing: '—' } })).j.doc;
  await P(sameer, { op: 'approve', id: cem.id, data: {} });
  await P(farhan, { op: 'order', id: cem.id, data: { vendor: 'Sample Cement Traders', items: [{ spec: 'OPC 53', qty: 400, rate: 385 }], amount: 154000, billNo: 'SCT-140' } });
  await P(ravi, { op: 'receive', id: cem.id, data: { items: [{ spec: 'OPC 53', qty: 400 }], challan: 'SCT-DC-77', date: addDays(t, -1) } });
  const rmc = (await P(ravi, { op: 'request', data: { material: 'RMC', items: [{ spec: 'M40', qty: 190 }], line, wing: 'A wing', element: '5th slab and beams', neededBy: addDays(t, 2) } })).j.doc;
  IDS.rmc = rmc.id; IDS.steel = steel.id; IDS.cement = cem.id;
  IDS.approveUrl = '/approve?t=' + encodeURIComponent(await require('../lib/staff-alerts').token(rmc.id, 'sameer'));
  // contractor: an approved work order for A-Wing, slab items counted from the slabs cast; one RA bill paid earlier
  const C = (ck, b) => api(ck, '/api/me?contracts=1', b);
  const wo = (await C(sameer, { op: 'wo_save', data: { contractor: 'Sample Builders Pvt Ltd', company: 'Prime Realtors', scope: 'RCC structure, A-Wing, labour only (RMC and steel by us)', retentionPct: 5, tdsPct: 1, advance: 1000000, advanceRecoveryPct: 10, towers: ['a'],
    wastage: { rmcPct: 2, steelPct: 3, rmcRate: 7758, steelRate: 61000 },
    items: [{ desc: 'RCC slab, beams and columns: labour incl. shuttering', unit: 'sqm', rate: 520, qty: 42000, link: { tower: 'a' }, perSlab: 850 }, { desc: 'Blockwork 200 mm: labour', unit: 'sqm', rate: 95, qty: 30000 }, { desc: 'Internal plaster: labour', unit: 'sqm', rate: 70, qty: 60000 }] } })).j.wo;
  const b1 = (await C(farhan, { op: 'bill_save', data: { woId: wo.id, from: addDays(t, -75), to: addDays(t, -31), billNo: 'SB/RA-01', lines: [{ itemId: wo.items[0].id, qty: 1700 }] } })).j.bill;
  await C(farhan, { op: 'bill_submit', id: b1.id, data: {} });
  await C(sameer, { op: 'bill_approve', id: b1.id, data: {} });
  await C(headacc, { op: 'bill_paid', id: b1.id, data: { amount: b1.totals.net, ref: 'UTR SAMPLE 1101', date: addDays(t, -25) } });
}

// ---------- the player ----------
// Captions and a pointer drawn on the page (as popovers, so they stay above open dialogs).
const OVERLAY = `(() => {
  if (window.__tr) return; window.__tr = true;
  const css = document.createElement('style');
  css.textContent = \`#trcap{pointer-events:none;position:fixed;inset:auto 0 26px 0;margin:0 auto;max-width:980px;width:max-content;border:0;padding:14px 22px;border-radius:14px;background:rgba(20,12,89,.94);color:#fff;font:600 21px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center}
  #trptr{position:fixed;inset:auto;left:0;top:0;margin:0;border:0;padding:0;width:26px;height:26px;border-radius:50%;background:rgba(255,166,0,.55);box-shadow:0 0 0 3px rgba(255,166,0,.95);transition:left .7s ease,top .7s ease,transform .15s;pointer-events:none;overflow:visible}
  #trptr.press{transform:scale(.7)}
  #trbox{position:fixed;inset:auto;margin:0;border:3px solid #FFA600;border-radius:10px;padding:0;background:transparent;pointer-events:none;transition:all .35s ease;box-shadow:0 0 0 4000px rgba(20,12,89,.18)}
  #trtitle{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;background:#140C59;background-image:radial-gradient(900px 320px at 80% -120px,rgba(100,194,230,.35),transparent 60%);color:#fff;place-content:center;text-align:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
  #trtitle:popover-open{display:grid}
  #trtitle small{display:block;color:#64C2E6;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:16px;margin-bottom:14px}
  #trtitle b{display:block;font-size:52px;letter-spacing:-.02em}#trtitle span{display:block;color:#C6CCEB;font-size:22px;margin-top:14px;max-width:820px}\`;
  document.head.appendChild(css);
  for (const id of ['trbox', 'trptr', 'trcap', 'trtitle']) { const e = document.createElement('div'); e.id = id; e.popover = 'manual'; document.body.appendChild(e); }
  const top = (e) => { try { e.hidePopover(); } catch {} try { e.showPopover(); } catch {} };
  window.__cap = (t) => { const c = document.getElementById('trcap'); if (!t) { try { c.hidePopover(); } catch {} return; } c.textContent = t; top(c); top(document.getElementById('trptr')); };
  window.__title = (a, b, c) => { const e = document.getElementById('trtitle'); if (!a) { try { e.hidePopover(); } catch {} return; } e.innerHTML = '<div><small>' + a + '</small><b>' + b + '</b><span>' + (c || '') + '</span></div>'; top(e); };
  window.__box = (r) => { const b = document.getElementById('trbox'); if (!r) { try { b.hidePopover(); } catch {} return; } Object.assign(b.style, { left: r.x - 6 + 'px', top: r.y - 6 + 'px', width: r.w + 12 + 'px', height: r.h + 12 + 'px' }); top(b); top(document.getElementById('trcap')); };
  window.__ptr = (x, y, press) => { const p = document.getElementById('trptr'); top(p); p.style.left = x - 13 + 'px'; p.style.top = y - 13 + 'px'; if (press) { p.classList.add('press'); setTimeout(() => p.classList.remove('press'), 180); } };
})();`;

function reading(t) { return Math.max(3200, Math.min(9000, String(t).split(/\s+/).length * 400)); }

// ---------- the voice ----------
// With PIPER (the piper program) and PIPER_VOICE (a .onnx voice) set, every caption and title is also spoken.
// The lesson waits for the voice to finish, and the clips are laid on the video at the moment each caption appeared.
const PIPER = process.env.PIPER, VOICE = process.env.PIPER_VOICE;
const spoken = (t) => String(t)
  .replace(/\b(\d{1,2}(?::\d{2})?) ?am\b/gi, '$1 A M').replace(/\b(\d{1,2}(?::\d{2})?) ?pm\b/gi, '$1 P M')
  .replace(/\bTo-Do\b/g, 'to do').replace(/\bCA \/ Tax\b/g, 'C A and tax').replace(/\bvs\b/g, 'versus')
  .replace(/\b([AB])-(\d{2})(\d{2})\b/g, '$1 $2 $3').replace(/\bPDCs?\b/g, (m) => (m.endsWith('s') ? 'P D Cs' : 'P D C')).replace(/\bTDS\b/g, 'T D S')
  .replace(/\bGST\b/g, 'G S T').replace(/\bKYC\b/g, 'K Y C').replace(/\bRERA\b/g, 'Rera').replace(/\bERP\b/g, 'E R P').replace(/\bCRM\b/g, 'C R M')
  .replace(/[“”]/g, '').replace(/·/g, ',').replace(/’/g, "'");
const wavMs = (f) => { const b = fs.readFileSync(f); return Math.round(((b.length - 44) / b.readUInt32LE(28)) * 1000); };
let clipN = 0, CUR = null, segN = 0;
// SEG_DIR: recorded narration already cut into one clip per caption, SEG_DIR/<module>/00.wav, 01.wav … in caption order
// (made from a voice-over such as ElevenLabs by splitting it at its pauses). Used instead of Piper when present.
const SEG_DIR = process.env.SEG_DIR;
const LINES = {}; // what is spoken, in order, per video (the narration script)
function say(text) {
  if (CUR) (LINES[CUR] = LINES[CUR] || []).push(String(text));
  if (SEG_DIR && CUR && fs.existsSync(path.join(SEG_DIR, CUR))) {
    const f = path.join(SEG_DIR, CUR, String(segN++).padStart(2, '0') + '.wav');
    if (!fs.existsSync(f)) { console.warn('    no narration clip', f); return null; }
    return { f, ms: wavMs(f) };
  }
  if (!PIPER || !VOICE) return null;
  const f = path.join(TMP, `clip-${++clipN}.wav`);
  execFileSync(PIPER, ['-m', VOICE, '-f', f, '--length_scale', '1.12', '--sentence_silence', '0.3'], { input: spoken(text), stdio: ['pipe', 'ignore', 'ignore'] });
  return { f, ms: wavMs(f) };
}
let T0 = 0; const CUES = [];
const TONE = path.join(TMP, 'mail-tone.wav');
(function bell() {
  const sr = 44100, len = Math.floor(sr * 0.95), d = new Float32Array(len);
  for (const [fq, t] of [[1047, 0], [1319, 0.11], [1568, 0.22]]) for (let i = Math.floor(t * sr); i < len; i++) {
    const x = i / sr - t; if (x > 0.65) break;
    const env = x < 0.01 ? x / 0.01 : Math.exp(-(x - 0.01) * 9);
    const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * fq * x));
    d[i] += 0.22 * env * (tri + 0.5 * Math.sin(2 * Math.PI * fq * 2 * x));
  }
  const b = Buffer.alloc(44 + len * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + len * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(d[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(TONE, b);
})();
const IDS = {};
const V = (x) => (typeof x === 'function' ? x() : x);
async function speak(page, text, minMs) {
  const c = say(text);
  if (c) CUES.push({ t: Date.now() - T0, f: c.f });
  await page.waitForTimeout(Math.max(minMs || 0, c ? c.ms + 1600 : reading(text) + 1200)); // a calm pause after each line
}

async function play(page, steps) {
  const ov = () => page.evaluate(OVERLAY).catch(() => {});
  let cap = '';
  const recap = async () => { await ov(); if (cap) await page.evaluate((t) => window.__cap(t), cap).catch(() => {}); };
  const rect = async (sel) => {
    const l = page.locator(sel).first();
    await l.waitFor({ state: 'visible', timeout: 6000 });
    await l.scrollIntoViewIfNeeded().catch(() => {});
    const b = await l.boundingBox();
    return { l, r: { x: b.x, y: b.y, w: b.width, h: b.height } };
  };
  for (const s of steps) {
    const [op, a0, b0, c] = s; const a = V(a0), b = V(b0);
    try {
      if (op === 'title') { await ov(); await page.evaluate(([x, y, z]) => window.__title(x, y, z), [a, b, c]); await speak(page, `${b}. ${c}.`, 3600); await page.evaluate(() => window.__title()); }
      else if (op === 'go') { await page.goto(BASE + a); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); await recap(); }
      else if (op === 'hash') { await page.evaluate((h) => { document.querySelectorAll('dialog[open]').forEach((d) => { d.close(); d.remove(); }); location.hash = h; }, a); await page.waitForTimeout(300); await page.waitForFunction(() => { const p = document.querySelector('#page'); return p && !/^Loading/.test(p.innerText.trim()); }, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1600); await recap(); }
      else if (op === 'fill') { const { l } = await rect(a); await l.fill(b); await page.waitForTimeout(1000); }
      else if (op === 'set') { const { l } = await rect(a); const tag = await l.evaluate((e) => e.tagName); if (tag === 'SELECT') { const v = await l.evaluate((e, t) => { const o = [...e.options].find((x) => x.text === t) || [...e.options].find((x) => x.text.toLowerCase().includes(String(t).toLowerCase().replace(/\s*\(.*$/, ''))); return o ? o.value : null; }, b); if (v == null) throw new Error('no option ' + b); await l.selectOption(v, { timeout: 4000 }); } else { await l.click(); await l.fill(''); await l.pressSequentially(String(b), { delay: 70 }); } await page.waitForTimeout(900); }
      else if (op === 'chapter') { await page.evaluate(() => { window.__cap(); window.__box(); }).catch(() => {}); await ov(); await page.evaluate(([x, y]) => window.__title(x, y, ''), [a, b]); await speak(page, b + '.', 3600); await page.evaluate(() => window.__title()); }
      else if (op === 'pick') { const { l } = await rect(a); await l.selectOption({ index: b || 1 }); await page.waitForTimeout(500); }
      else if (op === 'key') { await page.keyboard.press(a); await page.waitForTimeout(b || 800); }
      else if (op === 'cap') { cap = a; await ov(); await page.evaluate((t) => window.__cap(t), a); await speak(page, a, b); }
      else if (op === 'hl') { const { r } = await rect(a); await page.evaluate((q) => { window.__box(q); window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2); }, r); await page.waitForTimeout(Math.max(b || 0, 2800)); await page.evaluate(() => window.__box()); }
      else if (op === 'click') {
        const { l, r } = await rect(a);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2), r); await page.waitForTimeout(1300);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2, true), r);
        await l.click({ timeout: 8000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(Math.max(b || 0, 2000)); await recap();
      }
      else if (op === 'type') { const { l, r } = await rect(a); await page.evaluate((q) => window.__ptr(q.x + 30, q.y + q.h / 2, true), r); await l.click(); await l.pressSequentially(b, { delay: 90 }); await page.waitForTimeout(1000); }
      else if (op === 'select') { const { l } = await rect(a); await l.selectOption({ label: b }).catch(() => l.selectOption(b)); await page.waitForTimeout(700); }
      else if (op === 'scroll') { await page.mouse.wheel(0, a); await page.waitForTimeout(Math.max(b || 0, 2000)); }
      else if (op === 'top') { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await page.waitForTimeout(800); }
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'file') { await page.setInputFiles(a, b); await page.waitForTimeout(c || 1800); await recap(); }
      else if (op === 'as') { // the same video goes on as another person (e.g. Head CRM approving what the CRM entered)
        const lg = await api('', '/api/session', { action: 'login', username: a, password: PW }); const [name, value] = lg.cookie.split('=');
        await page.context().clearCookies(); await page.context().addCookies([{ name, value, url: BASE }]);
        await page.goto(BASE + '/?as=' + a + '#/home'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); await recap(); // a full reload, so the page signs in again
      }
      else if (op === 'mailnow') {
        await page.evaluate(() => window.__erpMailCheck && window.__erpMailCheck()); await page.waitForTimeout(1500); // the page knows the count first, so the new one pops up
        await db.q("insert into communications (booking_id, channel, direction, from_addr, subject, body, sent_at, status) values ($1, 'email', 'in', 'sample.buyer@example.com', 'When is the next demand due?', 'Dear Sir, please tell me when the next demand is due and the amount. Regards', now(), 'matched')", [IDS.flat]);
        await page.evaluate(() => window.__erpMailCheck && window.__erpMailCheck());
        CUES.push({ t: Date.now() - T0, f: TONE }); await page.waitForTimeout(1600);
        await page.evaluate(() => { const e = document.getElementById('mailpop'); if (e) clearTimeout(e._t); }); // the box stays while it is explained
      }
      else if (op === 'end') { await page.evaluate(() => { window.__cap(); window.__box(); }); await page.evaluate(([x, y, z]) => window.__title(x, y, z), ['Dream India ERP · Training', a, b || 'Next: open the next video on the Training videos page.']); await speak(page, 'That is the end of this course. You can watch any part again from the Training videos page.', 3200); }
    } catch (e) { console.warn(`    step ${op} ${a || ''}: ${e.message.split('\n')[0]}`); }
  }
}

// ---------- the lessons ----------
const L = {
  // ---------- Everyone ----------
  start: { user: null, steps: [
    ['title', 'Training · Everyone', 'Getting started', 'Signing in, the home page and your department'],
    ['go', '/'], ['cap', 'Open the ERP in your browser at erp dot dream india realty dot com, and sign in with the username and password you were given.'],
    ['type', 'input[name=username]', 'ayesha'], ['type', 'input[name=password]', PW], ['click', 'form button'],
    ['cap', 'The first time, the ERP may ask you to choose your own password. Keep it to yourself.'],
    ['cap', 'This is the home page. Your projects are at the top, and tools for everyone are below.'],
    ['hl', '.tile >> nth=0'], ['cap', 'Tap a project to open it.'], ['click', '.tile >> nth=0'],
    ['cap', 'Each project has its departments. You see only the ones your login allows.'],
    ['hl', '.tile >> nth=0', 2200], ['click', '.tile >> nth=0'],
    ['cap', 'Inside a department, Today always comes first. Start your day there.'],
    ['hl', '.side .group-btn.open', 2000], ['cap', 'The same pages are in the menu on the left. Tap a heading to open or close it.'],
    ['hl', '#cpw', 1600], ['cap', 'Change password and Sign out are at the top right. Always sign out on a shared computer.'],
    ['cap', 'On your phone, add the ERP to your home screen, and it opens like an app.'],
    ['end', 'Getting started', 'Next: the Sales and CRM course, or the Accounts course.'],
  ] },

  // ---------- Sales & CRM ----------
  'crm-flats': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Flats and the flat file', 'One flat, one window, with everything about the buyer'],
    ['hash', '#/project/1/crm'], ['cap', 'The CRM is built around one idea: one flat, one window. Your daily work is in the first row: Today, Flats and buyers, Receipts, Inbox and Dream Chat.'],
    ['hash', '#/flats'], ['cap', 'Flats and buyers is the one list of every flat and buyer. It opens on All bookings.'],
    ['hl', '.chips', 2400], ['cap', 'The buttons at the top filter the list: call today, broken promises, never called, overdue, defaulters, TDS due, registration pending, and waiting for approval.'],
    ['type', '#q', 'A-1'], ['cap', 'Or search for any flat number, buyer name or phone number.'], ['fill', '#q', ''],
    ['click', () => `tr[data-b="${IDS.flat}"]`, 2000], ['cap', 'Tap a flat to open its flat file.'],
    ['hl', '.ff-head', 2400], ['cap', 'At the top: the buyer, and the money. Agreement value, received, balance due, overdue and GST.'],
    ['hl', '.ff-icons >> nth=0', 2000], ['cap', 'The three round buttons call the buyer, open WhatsApp, or start an email. Hold the pointer on one to see the number or address.'],
    ['hl', '.ff-actions', 2200], ['cap', 'Below are the everyday buttons: log a call, enter a receipt, email the buyer and send a demand letter. Less common actions are under More.'],
    ['hl', '#ffNext', 2200], ['cap', 'Where this buyer stands: overdue, last contact, promise to pay, next call and last receipt.'],
    ['scroll', 380, 1400], ['hl', '.regsteps', 2600], ['cap', 'The registration checklist shows each step: stamp duty challan, registration fee challan, papers ready, appointment, and registered. The next step is marked.'],
    ['cap', 'The challans come from the stamp duty register. When the agreement draft, ID copies and photos are ready, tick Papers are ready.'],
    ['hl', '.ff-jump', 2200], ['cap', 'Everything about this buyer is on this one page, section under section. These buttons stay at the top and jump to each section.'],
    ['click', '[data-ff=payments]', 1800], ['cap', 'Payments: every receipt with its date, bank, cheque or UTR number, split and status, then the payment plan, and the full ledger with the running balance.'], ['scroll', 700, 1800],
    ['click', '[data-ff=calls]', 1600], ['cap', 'Calls and follow-ups: every call logged for this buyer.'],
    ['click', '[data-ff=messages]', 1600], ['cap', 'Messages: every email and WhatsApp, both ways, and Dream Chat with Accounts about this flat.'],
    ['click', '[data-ff=documents]', 1600], ['cap', 'Documents: the letters the ERP makes, and every signed or scanned paper for this flat.'],
    ['click', '[data-ff=history]', 1600], ['cap', 'History: every change on this flat, who made it and when.'], ['click', '[data-ff=overview]', 1200],
    ['hash', '#/flats?f=regpending'], ['cap', 'Registration pending lists every flat not yet registered, with its next step, so nothing waits unnoticed.'],
    ['end', 'Flats and the flat file', 'Next: Today and follow-up calls.'],
  ] },
  'crm-today': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Today and follow-up calls', 'Your own call list, and how to log each call'],
    ['hash', '#/crmtodo'], ['cap', 'Start every morning with Today. At 9 am the ERP makes the list: calls, approvals, letters, replies waiting, and what Accounts needs the CRM to fix.'],
    ['hl', '.td:has-text("your buyers to call") >> nth=0', 2600], ['cap', 'Your own line comes first: your buyers to call today, for your wing. Each CRM person gets their own list.'],
    ['click', '.td:has-text("your buyers to call") .td-title a >> nth=0', 1800], ['cap', 'Tap it to open just your buyers. The note at the top shows whose list it is.'],
    ['hl', 'table.flats tr.click >> nth=0', 2000], ['cap', 'Call the buyer with the Call or WhatsApp link, then open the flat.'],
    ['click', 'table.flats tr.click >> nth=0', 2000],
    ['click', '#logf'], ['cap', 'After the call, tap Log a call. Choose how you reached the buyer and what they said.'],
    ['select', 'dialog select[name=outcome]', 'Promised to pay'], ['type', 'dialog textarea[name=note]', 'Will pay the plinth demand by Friday'],
    ['fill', 'dialog input[name=promiseDate]', () => addDays(ist(), 4)], ['type', 'dialog input[name=promiseAmount]', '250000'],
    ['click', 'dialog [data-n] >> nth=1'], ['cap', 'If they promise to pay, enter the date and the amount, and pick when to call next.'],
    ['click', 'dialog button[value=save]', 2200], ['cap', 'Saved. Every call stays in Calls and follow-ups, with who made it and when.'],
    ['click', '[data-ff=overview]'], ['hl', '#ffNext', 2200], ['cap', 'The buyer now leaves today’s list until the next call date.'],
    ['hash', '#/flats'], ['click', '.chip[data-f=broken]'], ['cap', 'Broken promises: the promised date passed and nothing came in. Call these first.'],
    ['click', '.chip[data-f=never]'], ['cap', 'Never called: buyers with dues nobody has called yet. Make the first call and log it.'],
    ['end', 'Today and follow-up calls', 'Next: Receipts and cheques.'],
  ] },
  'crm-receipts': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Receipts and cheques', 'From the buyer’s cheque to the bank statement'],
    ['hash', () => `#/booking/${IDS.flat}`], ['cap', 'When a buyer pays, open the flat and tap Enter a receipt.'],
    ['click', '#receipt'], ['fill', 'dialog input[name=receivedOn]', () => ist()], ['set', 'dialog input[name=amount]', '250000'], ['set', 'dialog select[name=mode]', 'Cheque'],
    ['set', 'dialog input[name=bank]', 'Sample Bank'], ['set', 'dialog input[name=instrumentNo]', '000452'],
    ['cap', 'Enter the date, the amount, how it was paid, the bank and the cheque or UTR number. Tap Split as AV plus GST, then save.'],
    ['click', 'dialog #auto', 1200], ['click', 'dialog button[value=save]', 2000],
    ['hl', 'dialog[open]', 1600], ['cap', 'Until Head Accounts approves it, the receipt is provisional, subject to realisation. Its receipt number is given when it is approved.'],
    ['key', 'Escape', 1000], ['cap', 'If the same UTR or cheque number was already entered on any flat, the ERP warns you before saving it twice.'],
    ['cap', 'Accounts is told at once, in Dream Chat, that there is a cheque to deposit.'],
    ['click', '[data-ff=payments]'], ['hl', 'td:has-text("with CRM") >> nth=0', 2200],
    ['cap', 'Each receipt shows where the cheque is: with CRM, with Accounts, deposited, and finally in the bank.'],
    ['cap', 'At 3:10 pm the bank statement is checked, and a cheque that matches is approved by itself.'],
    ['cap', 'If a cheque comes back, the ERP marks it returned, tells you in Dream Chat, and puts the buyer on your Today list to call.'],
    ['hash', '#/receipts'], ['cap', 'The Receipts page lists every receipt for the project, and the cheques still to be deposited.'],
    ['end', 'Receipts and cheques', 'Next: Demands, letters and reminders.'],
  ] },
  'crm-demands': { user: 'demo', steps: [
    ['title', 'Training · Sales & CRM', 'Demands, letters and reminders', 'From a construction stage to the letter in the buyer’s inbox'],
    ['hash', '#/demands'], ['cap', 'When the site completes a stage, it is recorded on Stages and demands, with the date and who certified it.'],
    ['click', '#stage'], ['set', 'dialog select[name=buildingId]', 'A Wing'], ['set', 'dialog select[name=stageName]', 'On Completion of Plinth (10%)'], ['fill', 'dialog input[name=completedOn]', () => addDays(ist(), -1)], ['set', 'dialog input[name=certifiedBy]', 'Site engineer'],
    ['click', 'dialog button[value=save]', 1600],
    ['cap', 'Then prepare the demand run for that wing and stage.'], ['click', '#run'], ['set', 'dialog select[name=pick]', 'Plinth'], ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The run lists every buyer with the amount and GST. Someone other than the person who prepared it approves it.'], ['hl', '#ok', 2200],
    ['cap', 'When Head CRM approves, everything else happens by itself. Each buyer’s demand letter is made and emailed, a WhatsApp tells them to check their email, and a first follow-up is set for the due date.'],
    ['cap', 'Buyers with no email get the letter PDF on WhatsApp. If WhatsApp cannot reach them either, the letter goes on the Print and courier list.'],
    ['hash', '#/letters'], ['hl', '#courier', 2400], ['cap', 'Print and courier is at the top of Demand letters. Print them all as one PDF, courier them, then mark them couriered. And ask the buyer for an email address on the next call.'],
    ['cap', 'Reminders go by themselves too: an email three days before the due date with the amount owed that day, and Reminder One with delay charges seven days after, if it is still unpaid.'],
    ['click', '#settings', 1600], ['hl', 'dialog input[name=testMobile]', 2200], ['cap', 'Letter settings hold the test address and test mobile, the WhatsApp templates, and the switch for automatic reminders. Send a test WhatsApp from here.'],
    ['key', 'Escape'],
    ['cap', 'For one buyer, open the flat and tap Demand letter. For many, tick them here and tap Prepare letters.'], ['hl', '#prepare', 1800],
    ['cap', 'Until the ERP goes live, every email and WhatsApp goes only to the test address and test mobile, never to buyers.'],
    ['end', 'Demands, letters and reminders', 'Next: Buyer messages, Dream Chat and documents.'],
  ] },
  'crm-messages': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Buyer messages, Dream Chat and documents', 'Every email and WhatsApp about a flat, kept with that flat'],
    ['hash', '#/flats'], ['cap', 'Every email or WhatsApp a buyer sends comes into the ERP within a few minutes, filed with that flat by their email or mobile number.'],
    ['mailnow'], ['hl', '#mailpop', 2400], ['cap', 'You hear this bell, a box shows who wrote, and the red badge at the top counts the unread ones. The CRM person for that wing is told first.'],
    ['click', '#mailpop', 2200], ['cap', 'Tapping the box opens the flat at its Messages, with the whole conversation.'],
    ['hl', '#ccomm', 2000],
    ['click', '#ffMail'], ['cap', 'To write to the buyer, tap Email the buyer. Choose the purpose, check the message and send. The reply comes back to this flat.'],
    ['wait', 1200], ['key', 'Escape'],
    ['cap', 'Once a buyer has sent a WhatsApp, you can reply to them in your own words from here for the next twenty four hours. Replies sent from the ERP stay on record; chats on your own phone do not.'],
    ['hl', '#ffChat', 1800], ['type', '#ffChatF input[name=body]', 'Please confirm the cheque for this flat is deposited'],
    ['cap', 'Dream Chat about this flat goes straight to Accounts, and the message stays here with the flat.'],
    ['click', '#ffChatF button', 1600],
    ['hash', '#/comms'], ['cap', 'The Inbox lists every buyer message. A message from a number or address the ERP does not know waits under To link: link it to its flat once.'],
    ['cap', 'If a buyer waits more than a day for a reply, it goes on the Today list at 9 am.'],
    ['hash', () => `#/booking/${IDS.flat}?tab=documents`], ['hl', '#cdocs', 2000], ['cap', 'Documents holds every signed or scanned paper for the flat. Tap Add a document to upload one. The list shows what is still to come.'],
    ['end', 'Buyer messages, Dream Chat and documents', 'Next: Booking, approval and cancellation.'],
  ] },
  'crm-booking': { user: 'demo', steps: [
    ['title', 'Training · Sales & CRM', 'Booking, approval and cancellation', 'Booking a flat, approval, cancelling and rebooking'],
    ['hash', '#/units'], ['cap', 'To book a flat, open Book a flat. Every flat is shown floor by floor. The colour shows sold, available or held.'],
    ['click', 'button.unit.s-available >> nth=3'], ['cap', 'Tap an available flat, then tap Book this unit.'], ['click', '#book'],
    ['fill', 'dialog input[name=bookingDate]', () => ist()], ['set', 'dialog input[name=agreementValue]', '8500000'],
    ['set', 'dialog input[name=a1_name]', 'Training Buyer One'], ['set', 'dialog input[name=a1_phone]', '9800000001'], ['set', 'dialog input[name=a1_pan]', 'ABCDE1234F'],
    ['cap', 'Fill in the booking date, the agreement value and the buyers, with the channel partner and brokerage if there is one. Then save.'],
    ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The booking now waits for Head CRM. The person who enters a booking, or changes it while it waits, can never approve it.'],
    ['hash', '#/flats?f=approval'], ['cap', 'Head CRM opens Flats and buyers, Waiting for approval.'],
    ['click', () => `tr[data-b="${IDS.pendingBk}"]`, 2000], ['hl', '#approve', 1600], ['cap', 'After checking the cost sheet and the KYC, Head CRM taps Approve booking. The booking stage demand is raised at once.'],
    ['click', '#approve', 2000],
    ['click', '.ff-more summary', 900], ['hl', '.ff-menu', 2000], ['cap', 'Under More: the statement, registration, Edit booking for Head CRM, transfer to another flat, and cancellation. Every change is kept in History, with the reason.'],
    ['key', 'Escape'],
    ['hash', () => `#/booking/${IDS.cancel}`], ['cap', 'To cancel, open the flat, then More, then Request cancellation. Write the reason, the date and any cancellation charges.'],
    ['click', '.ff-more summary', 800], ['click', '#cancelReq'], ['set', 'dialog textarea[name=reason]', 'Buyer wants a bigger flat'], ['set', 'dialog input[name=charges]', '25000'],
    ['click', 'dialog button[value=save]', 1800],
    ['cap', 'Management approves it. Here is one Ayesha asked for yesterday.'],
    ['hash', '#/flats?f=approval'], ['click', () => `tr[data-b="${IDS.req}"]`, 2000], ['hl', '#cancelOk', 1400], ['click', '#cancelOk', 2000],
    ['hl', '.cancel-box', 2400], ['cap', 'Nothing is lost. The buyer, every receipt, the charges and the refund due stay on this flat. Accounts gets it on the Cancelled flats list. TDS and stamp duty are shown apart from the refund due.'],
    ['cap', 'The flat is free again. Tap Book this flat for a new buyer.'],
    ['click', '#rebook'], ['fill', 'dialog input[name=bookingDate]', () => ist()], ['set', 'dialog input[name=agreementValue]', '9000000'], ['set', 'dialog input[name=a1_name]', 'Training Buyer Two'],
    ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The new booking goes for approval as usual, and the flat file keeps the earlier cancelled booking, so each flat keeps its full history.'],
    ['end', 'Booking, approval and cancellation', 'That is the whole CRM. Start each morning with Today.'],
  ] },

  // ---------- Accounts ----------
  'acc-today': { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'Today and the 9 am audit', 'What the audit checks, and how to clear it'],
    ['hash', '#/acctodo'], ['cap', 'Every morning at 9 am the ERP audits the books and writes today’s Accounts list. The same list is emailed to the accounts mailbox.'],
    ['cap', 'It checks that entries are up to date, heads, flats and payees are filled, bank balances agree, PDCs and compliance are due, and Tally agrees with the CRM.'],
    ['hl', '.td.hi >> nth=0', 2200], ['cap', 'Urgent lines first, with a red edge: a PDC due tomorrow, a late return, a bank that does not agree.'],
    ['hl', '.td:has-text("TDS") >> nth=0', 2400], ['cap', 'From the first to the seventh of each month, it reminds you of last month’s TDS still to deposit. After the seventh it shows as late.'],
    ['hl', '.td:has-text("Confirm the closing") >> nth=0', 2200], ['cap', 'It asks you to confirm yesterday’s closing bank balances, and lists approved purchase bills still to pay.'],
    ['click', '.td .td-title a >> nth=0'], ['cap', 'Each line opens the page where you fix it.'], ['hash', '#/acctodo'],
    ['type', '.note >> nth=0', 'Done'], ['click', '.tk >> nth=0'], ['cap', 'Tick it when done, with a note if useful. Lines that are fixed clear by themselves at the next audit.'],
    ['end', 'Today and the 9 am audit', 'Next: Receipts, payments and bills.'],
  ] },
  'acc-registers': { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'Receipts, payments and bills', 'The bank registers, purchase bills and TDS'],
    ['hash', '#/reg-receipts'], ['cap', 'Every credit on the bank statement is one row in Receipts. Each customer receipt needs its head and the flat, like A-1203.'],
    ['click', '[data-f=noHead]', 1800], ['cap', 'The filters show what is missing: no head, no flat. Never delete a bounced cheque: set its Cheque Status to Bounced.'],
    ['hash', '#/reg-payments'], ['cap', 'Every debit is one row in Payments Out, with its head, the payee, and the flat when it is for a buyer.'],
    ['click', '#accNew', 1800], ['hl', '#poPick', 2200], ['cap', 'Paying a purchase bill that Accounts has approved? Choose it here. The payee, head, amount and bill details fill in by themselves.'],
    ['pick', '#poPick', 1], ['wait', 1200],
    ['cap', 'The TDS section and rate come from the payment head. Type the taxable value and the ERP works out the TDS and the net payable. A rate of one is always one percent.'],
    ['fill', 'dialog [name=txn_date]', () => ist()], ['pick', 'dialog select[name=bank]', 1], ['set', 'dialog [name=taxable_value]', '595000'], ['key', 'Tab', 1400],
    ['click', 'dialog button[value=save]', 1800], ['cap', 'When you save, the purchase order is marked Paid on the Purchase page, with this payment.'],
    ['key', 'Escape', 600], ['click', '[data-f=needsBill]', 1800], ['cap', 'Needs bill details shows every payment still waiting for its bill.'],
    ['hash', '#/reg-pdc'], ['cap', 'Every post-dated cheque we give goes into PDC on the day it is given. Reminders are emailed forty eight and twenty four hours before it is due.'],
    ['hash', '#/reg-tds'], ['cap', 'The TDS Tracker has one row for each TDS challan or Form 16 B a buyer gives us.'],
    ['end', 'Receipts, payments and bills', 'Next: The bank, every day.'],
  ] },
  'acc-bank': { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'The bank, every day', 'Daily Bank Balance, the 3:10 pm check and reconciling items'],
    ['hash', '#/bankauto'], ['cap', 'Upload the day’s bank statements to the Google Drive folder by 3 pm. At 3:10 the ERP reads them and checks every line against your entries.'],
    ['hl', '#upl'], ['cap', 'Lines missing from the books are added for you, marked Added from bank statement. Fill in their head and payee. Differences are listed here to work through.'],
    ['hash', '#/balances'], ['cap', 'The day’s receipts, payments and the balance each bank shows are filled in from the same statements.'],
    ['hl', 'input.stated >> nth=0', 1800], ['cap', 'Check that Closing agrees with Balance per Bank. The difference must be blank or zero.'],
    ['scroll', 500, 1200], ['hl', '#cfDay', 2000], ['cap', 'Then confirm the closing balances. If a bank does not agree, write a note to say why before you confirm.'],
    ['type', '#cfNote', 'All banks agree'], ['click', '#cfDay', 1800],
    ['hash', '#/reg-recon'], ['cap', 'Anything on the statement you cannot match goes into Reconciling Items. Give it an owner, and update it as it is cleared.'],
    ['hash', '#/reg-compliance'], ['cap', 'The Compliance Calendar lists every return and tax payment with its due date. When one is filed, set it to Complied, with the date and acknowledgement.'],
    ['end', 'The bank, every day', 'Next: Approvals, corrections and refunds.'],
  ] },
  'acc-approvals': { user: 'headacc', steps: [
    ['title', 'Training · Accounts', 'Approvals, corrections and refunds', 'Head Accounts: CRM receipts, bounced cheques and refunds'],
    ['hash', '#/receipts'], ['cap', 'Receipts the CRM enters wait here for Head Accounts. Cheques found in the bank statement are approved by themselves. Approve the rest once the money is in the bank.'],
    ['hl', 'button[data-ok] >> nth=0', 2000], ['cap', 'The person who entered a receipt can never approve it. The receipt number is given on approval.'],
    ['click', '.tab[data-t=approved]', 1800], ['hl', 'button[data-resplit] >> nth=0', 2200], ['cap', 'If an approved receipt was split wrongly, for example part of it was GST, tap Correct split. The receipt and its number stay the same, and the change is kept with the reason.'],
    ['cap', 'If a cheque was marked bounced by mistake, tap Not bounced on it, with the reason. The buyer’s balance is put right at once.'],
    ['hash', '#/reg-cancellations'], ['cap', 'When Management approves a cancellation, the flat appears in Cancelled flats by itself: the buyer, what they paid, the charges and the refund due.'],
    ['click', 'tr[data-id] >> nth=0'], ['cap', 'When you pay the refund, enter the amount paid and set Refund Status to DONE once it is fully paid. The CRM shows the same status.'],
    ['key', 'Escape'],
    ['hash', '#/bookscrm'], ['cap', 'Tally versus CRM compares the money in the books with the CRM for every flat, with returned cheques and cancelled buyers set aside.'],
    ['end', 'Approvals, corrections and refunds', 'Next: Month end, the CA and Tally.'],
  ] },
  'acc-month': { user: 'headacc', steps: [
    ['title', 'Training · Accounts', 'Month end, the CA and Tally', 'Checks, closing the month, the CA’s pack and the Tally link'],
    ['hash', '#/checks'], ['cap', 'At month end, open Checks. Every line should say OK. If one says Check, fix the entry it points to.'],
    ['hl', '#closeM', 2200], ['cap', 'Then Head Accounts closes the month. After that, an entry dated in a closed month can be changed only by Head Accounts, with a reason, kept in the audit log.'],
    ['scroll', 300, 1200], ['hl', '#caPack', 2400], ['cap', 'On the fifth of every month the ERP emails the CA one Excel file for the month before: GST, TDS and RERA, with the month’s registers. You can also download it or send it again here.'],
    ['hash', '#/accsetup'], ['hl', '#tlink', 2600], ['cap', 'The Tally link sends the receipts and payments entered in the ERP to Tally by themselves. Tally’s server collects them, and confirms what it imported.'],
    ['cap', 'Here you see what is waiting, what is in Tally, and anything Tally could not import, with the reason. Match a ledger name under Ledger names in Tally, and it goes again.'],
    ['go', '/#/accdash'], ['cap', 'The Accounts dashboard shows bank balances, collections, expenses and money in and out, live from the registers.'],
    ['hash', '#/ca'], ['cap', 'The CA and Tax page has GST, TDS payable, RERA, cash flow and compliance, for the CA to review.'],
    ['hash', '#/acctodo'], ['cap', 'That is the full Accounts month: enter, check, confirm, close, and clear your Today list.'],
    ['end', 'Month end, the CA and Tally', 'That is the whole Accounts course.'],
  ] },
};

// ---------- Construction (site staff) ----------
L['site-today'] = { user: 'ravi', steps: [
  ['go', '/site'], ['cap', 'Open Construction. Site engineers start on the Today page: four big buttons, and below them whatever is waiting for you.'],
  ['hl', '.four', 2600], ['cap', 'Request material, Material came in, Daily report, and Report a problem. Everything you enter on site starts from here.'],
  ['hl', '.st-hello', 1800], ['cap', 'The line under your name tells you if today’s daily report is still to send. It is due by 6 pm. If it is not in, the site team gets a reminder email at 6.'],
] };
L['site-request'] = { user: 'ravi', steps: [
  ['go', '/site'], ['click', '[data-preq]'], ['cap', 'Need steel, RMC, cement or anything else? Tap Request material.'],
  ['click', '#r-mat [data-m="Steel"]'], ['cap', 'Choose the material. For steel, type the quantity against each bar size you need. Leave the others empty.'],
  ['type', '[data-spec="10 mm"]', '4'], ['type', '[data-spec="20 mm"]', '7'],
  ['hl', '#r-line', 1800], ['cap', 'Choose the floor it is for, and the wing. The ERP shows how much of that floor’s BOQ quantity is left.'],
  ['hl', '#r-bal', 2200], ['fill', '#r-need', () => addDays(ist(), 4)], ['type', '#r-el', 'Columns and shear walls'],
  ['click', '#r-save', 2400], ['cap', 'Tap Send for approval. Sameer gets it straight away by email, and approves it with one tap.'],
  ['scroll', 1400, 1600], ['hl', '.dlist.mine', 2600], ['cap', 'Your requests show at the bottom of Today: waiting for Management, approved, or rejected with the reason.'], ['top'],
] };
L['site-receive'] = { user: 'ravi', steps: [
  ['go', '/site'], ['hl', '.dlist', 2200], ['cap', 'Deliveries that Purchase has ordered show under Deliveries expected. When the truck arrives, tap the one that came.'],
  ['click', '.dlist [data-prcv] >> nth=0'],
  ['hl', '.photobtn', 1800], ['cap', 'First take a photo of the delivery challan. It is kept with the order, so Accounts and Management can see it later.'],
  ['file', '#c-ph', () => IDS.challanImg],
  ['cap', 'Type the challan number, and check the quantity that actually came for each size. If something is short, change the number and add a note.'],
  ['type', '#c-no', 'SSS-DC-5512'], ['set', '[data-rspec="16 mm"]', '8.8'], ['type', '#c-veh', 'MH 04 KX 2291'], ['type', '#c-note', '200 kg short in 16 mm'],
  ['click', '#c-save', 2400], ['cap', 'Tap Save receipt. The bill goes to Accounts, and the delivery is also written in the site materials register, so you never enter it twice.'],
] };
L['site-dpr'] = { user: 'ravi', steps: [
  ['go', '/site'], ['click', '[data-qdpr]'], ['cap', 'Every evening, tap Daily report. Choose the weather, type how many workers were on site, and what work was done.'],
  ['set', '#q-n', '64'], ['hl', '.microw', 2600], ['cap', 'You can also speak instead of typing. Tap Speak in English, or Hindi, and say what was done. Check the text, then send.'],
  ['type', '#q-work', 'A-Wing 5th slab steel binding\nB-Wing column shuttering'],
  ['click', '#q-save', 2200], ['cap', 'Send report. Management sees it the same evening.'],
] };
L['site-slab'] = { user: 'ravi', steps: [
  ['go', '/site'], ['scroll', 600, 1200], ['hl', '.bld >> nth=0', 2200], ['cap', 'Under Slab work, tap the stage each slab has reached today: shuttering, steel fixing, MEP sleeves, checks, concreting, and cast.'],
  ['click', '.bld >> nth=0 >> [data-qstage$=":cast"]'], ['cap', 'When a slab is cast, tap Cast and confirm the date. If that slab is a payment stage, Head CRM is told at once to raise the demands.'],
  ['click', '#qs-save', 2200], ['cap', 'Then the ERP asks for the pour: grade, quantity in cubic metres, the RMC supplier, challan numbers and how many cube samples were taken.'],
  ['set', '#p-qty', '192'], ['type', '#p-sup', 'Sample Concrete Co.'], ['type', '#p-ch', 'SC-4501, SC-4502'],
  ['click', '#p-save', 2400], ['cap', 'The cube tests at 7 and 28 days come up on Today on the day they are due.'],
  ['top'], ['hl', '[data-cube] >> nth=0', 2000], ['cap', 'When the lab gives the result, tap Enter result and type the average strength.'],
  ['click', '[data-cube] >> nth=0'], ['set', '#cb-mpa', '29.4'], ['type', '#cb-lab', 'Sample Testing Lab'],
  ['click', '#cb-save', 2200], ['cap', 'The ERP checks it against the pass mark. A result below the mark goes to Management straight away.'],
] };
L['site-problem'] = { user: 'ravi', steps: [
  ['go', '/site'], ['click', '[data-newh]'], ['cap', 'Anything holding up work: tap Report a problem. Choose the building, the cause and the days lost.'],
  ['set', '#h-cat', 'Labour shortage'], ['set', '#h-days', '1'], ['type', '#h-desc', 'Only 30 men today, steel fixing for the 5th slab moved to tomorrow'],
  ['file', '#h-ph', () => IDS.challanImg, 1400], ['cap', 'Add a photo if it helps, then save. Management sees open problems every morning in the 10 am summary.'],
  ['click', '#h-save', 2200],
  ['go', '/site'], ['hl', '.tlist', 2400], ['cap', 'Done today lists everything you entered today. That is the whole site day: request, receive, report, slabs and problems.'],
] };
// ---------- Purchase (purchase team, Management, Accounts) ----------
L['pur-approve'] = { user: 'sameer', steps: [
  ['go', () => IDS.approveUrl], ['cap', 'When the site asks for material, Sameer gets an email with a button. It opens this page, on the phone, without signing in.'],
  ['hl', '.budget', 2400], ['cap', 'It shows what is asked for, for which floor, the approximate value, and whether it is within that floor’s BOQ budget.'],
  ['click', '#yes', 2200], ['cap', 'One tap approves it. To reject, tap Reject and write the reason: the site sees it.'],
  ['go', '/purchase'], ['cap', 'Everything is also on the Purchase page, where Management can approve from the list. A request waiting more than a day goes up to Rafi Sir.'],
] };
L['pur-order'] = { user: 'farhan', steps: [
  ['go', '/purchase'], ['cap', 'The purchase team opens Purchase. Waiting for me lists the approved requests to order.'],
  ['click', () => `tr[data-id="${IDS.rmc}"]`], ['cap', 'Open the request. Enter the vendor, the quantity and the rate including GST, and the bill details. The ERP checks the rate against the budget rate.'],
  ['type', '#sheet [name=vendor]', 'Sample Concrete Co.'], ['set', '#sheet .box [name=qty]', '190'], ['set', '#sheet [name=rate]', '7650'], ['type', '#sheet [name=billNo]', 'SC-INV-901'],
  ['click', '#sheet [data-op="order"]', 2400], ['cap', 'Save the order. The site now sees it under Deliveries expected, without any rates or amounts. Site logins never see money.'],
  ['go', '/purchase'], ['click', () => `tr[data-id="${IDS.steel}"]`], ['cap', 'When the site receives a delivery, the request shows what came, the challan number, and the photo of the challan.'],
  ['hl', '#sheet a[href*="photo"]', 2200], ['key', 'Escape', 800],
] };
L['pur-accounts'] = { user: 'headacc', steps: [
  ['go', '/purchase'], ['click', () => `tr[data-id="${IDS.cement}"]`], ['cap', 'Accounts checks the bill against what the site received. If less came, the amount payable is worked out for the quantity received.'],
  ['click', '#sheet [data-op="accounts_ok"]', 2200], ['cap', 'Approve it for payment. It then shows in Payments Out, so the payment fills in by itself, and the request is marked Paid.'],
] };
L['pur-contract'] = { user: 'farhan', steps: [
  ['go', '/contracts'], ['cap', 'Contractor bills are on their own page: tap Contractor bills on the Purchase page. Each contractor has a work order with the item rates.'],
  ['click', '[data-tab="wos"]', 1600], ['hl', '.wo >> nth=0', 2600], ['cap', 'The work order has the items and rates, retention, TDS, the advance and how fast it is recovered, and the wastage allowed on our RMC and steel.'],
  ['click', '[data-tab="bills"]', 1000], ['click', '#newBill', 2600], ['cap', 'For a new RA bill, the slab work done since the last bill is filled in from the slabs site marked cast.'],
  ['hl', '#sheet .ltbl', 2600], ['cap', 'It shows previous, this bill and cumulative for each item. Anything beyond the work order quantity is marked in red.'],
  ['hl', '#sheet [name=materialRecovery]', 2400], ['cap', 'Recovery for RMC and steel used beyond the design quantity plus the allowance is suggested from the site’s records.'],
  ['type', '#sheet [name=billNo]', 'SB/RA-02'], ['hl', '#tot', 2800], ['cap', 'Retention, TDS and advance recovery are worked out, and the net payable is at the bottom. Save and submit it to Management.'],
  ['click', '#subBill', 2400],
] };
L['pur-contract-approve'] = { user: 'sameer', steps: [
  ['go', '/contracts'], ['click', 'tr[data-bill] >> nth=0'], ['cap', 'Sameer opens the bill, checks the quantities and deductions, and approves the net amount. The person who entered a bill can never approve it.'],
  ['click', '#sheet [data-op="bill_approve"]', 2200],
  ['as', 'headacc'], ['go', '/contracts'], ['click', 'tr[data-bill] >> nth=0'], ['cap', 'Accounts then pays it and records the UTR. Approved bills to pay are in the 10 am summary under cash needed.'],
  ['type', '#sheet [name=ref]', 'UTR SAMPLE 2207'], ['click', '#sheet [data-op="bill_paid"]', 2200],
] };

// The two courses: each part's steps one after another, as chapters, in one video (who is signed in changes per part).
function course(title, sub, team, parts, intro) {
  const steps = [['title', 'Training · ' + team, title, sub], ...(intro || [])];
  parts.forEach(([id, name], i) => {
    const P = L[id];
    steps.push(['as', P.user], ['chapter', 'Part ' + (i + 1), name]);
    for (const st of P.steps) if (st[0] !== 'title' && st[0] !== 'end') steps.push(st);
  });
  steps.push(['end', title, { 'Sales & CRM': 'Start each morning with Today.', Construction: 'Start each day on Today, and send the daily report by 6 pm.', Purchase: 'Check Waiting for me every morning.' }[team] || 'Start each morning with Today, and close each month on Checks.']);
  return { user: parts[0] && L[parts[0][0]].user, steps };
}
const SITE_AROUND = [['cap', 'Open the ERP at erp dot dream india realty dot com on your phone and sign in with your own username and password. Add it to your home screen and it opens like an app.']];
const AROUND = [['hash', '#/home'], ['cap', 'Open the ERP at erp dot dream india realty dot com and sign in with your own username and password. Your projects are on the home page.'],
  ['hl', '.tile >> nth=0'], ['click', '.tile >> nth=0'], ['cap', 'Each project has its departments. You see only the ones your login allows. Inside a department, Today always comes first.'],
  ['hl', '#cpw', 1600], ['cap', 'Change password and Sign out are at the top right. On your phone, add the ERP to your home screen and it opens like an app.']];
L['crm-full'] = course('The complete CRM course', 'Every part of the CRM, start to finish', 'Sales & CRM',
  [['crm-flats', 'Flats and the flat file'], ['crm-today', 'Today and follow-up calls'], ['crm-receipts', 'Receipts and cheques'], ['crm-demands', 'Demands, letters and reminders'], ['crm-messages', 'Buyer messages, Dream Chat and documents'], ['crm-booking', 'Booking, approval and cancellation']], AROUND);
L['site-full'] = course('The complete Construction course', 'For site engineers: everything you do on site, from your phone', 'Construction',
  [['site-today', 'Your Today page'], ['site-request', 'Request material'], ['site-receive', 'Material came in'], ['site-dpr', 'The daily report'], ['site-slab', 'Slabs, pours and cube tests'], ['site-problem', 'Report a problem']], SITE_AROUND);
L['purchase-full'] = course('The complete Purchase course', 'Approvals, orders, bills and contractor RA bills', 'Purchase',
  [['pur-approve', 'Management approves'], ['pur-order', 'Purchase places the order'], ['pur-accounts', 'Accounts approves the bill'], ['pur-contract', 'Contractor RA bills'], ['pur-contract-approve', 'Approve and pay the RA bill']]);
L['acc-full'] = course('The complete Accounts course', 'Every part of Accounts, start to finish', 'Accounts',
  [['acc-today', 'Today and the 9 am audit'], ['acc-registers', 'Receipts, payments and bills'], ['acc-bank', 'The bank, every day'], ['acc-approvals', 'Approvals, corrections and refunds'], ['acc-month', 'Month end, the CA and Tally']], AROUND);

(async () => {
  const only = process.argv.slice(2);
  await new Promise((r) => setTimeout(r, 800));
  await api('', '/api/session'); // runs the migrations
  await seed();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  { // a made-up delivery challan for the "photo of the challan" steps
    const pg = await browser.newPage({ viewport: { width: 900, height: 640 } });
    await pg.setContent(`<body style="margin:0;background:#e9e4d8;font-family:Georgia,serif"><div style="margin:24px;background:#fffdf6;padding:26px 30px;border:2px solid #333;transform:rotate(-1.2deg)"><div style="display:flex;justify-content:space-between"><b style="font-size:26px">SAMPLE STEEL SUPPLIERS</b><span style="font-size:20px">DELIVERY CHALLAN</span></div><p style="margin:6px 0 16px">Plot 9, Sample Industrial Estate · GSTIN 27XXXXX0000X1ZX</p><p>Challan No: <b>SSS-DC-5512</b> &nbsp;&nbsp; Date: ${ist()} &nbsp;&nbsp; Vehicle: MH 04 KX 2291</p><p>To: Dream Signature site, Jogeshwari</p><table style="width:100%;border-collapse:collapse;font-size:18px;margin-top:10px" border="1" cellpadding="8"><tr><th>Item</th><th>Qty</th></tr><tr><td>TMT Fe550D 12 mm</td><td>6.000 MT</td></tr><tr><td>TMT Fe550D 16 mm</td><td>8.800 MT</td></tr></table><p style="margin-top:30px">Received by: ____________</p></div></body>`);
    IDS.challanImg = path.join(TMP, 'challan.jpg'); await pg.screenshot({ path: IDS.challanImg, type: 'jpeg', quality: 80 }); await pg.close();
  }
  for (const m of MODULES) {
    if (only.length && !only.includes(m.id)) continue;
    const lesson = L[m.id]; if (!lesson) { console.warn('no lesson for', m.id); continue; }
    console.log('recording', m.id);
    const dir = path.join(TMP, m.id); fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
    if (lesson.user) {
      const lg = await api('', '/api/session', { action: 'login', username: lesson.user, password: PW });
      const [name, value] = lg.cookie.split('=');
      await ctx.addCookies([{ name, value, url: BASE }]);
    }
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    T0 = Date.now(); CUES.length = 0; CUR = m.id; segN = 0;
    if (lesson.user) { await page.goto(BASE + '/#/home'); await page.waitForLoadState('networkidle').catch(() => {}); }
    await play(page, lesson.steps);
    const v = page.video(); await ctx.close();
    const webm = await v.path();
    const mp4 = path.join(OUT, m.id + '.mp4');
    const vin = ['-i', webm], aud = [];
    if (CUES.length) {
      const fc = CUES.map((c, i) => `[${i + 1}:a]adelay=${Math.max(0, c.t)}|${Math.max(0, c.t)}[a${i}]`).join(';') + ';' + CUES.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${CUES.length}:normalize=0,loudnorm=I=-16:TP=-1.5,aresample=48000[aout]`;
      aud.push(...CUES.flatMap((c) => ['-i', c.f]), '-filter_complex', fc, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2');
    } else aud.push('-an');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...vin, ...aud, '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0', '-r', '25', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', path.join(OUT, m.id + '.jpg')]);
    console.log('  saved', mp4, Math.round(fs.statSync(mp4).size / 1024) + ' KB');
    if (process.env.LINES_OUT) fs.writeFileSync(path.join(process.env.LINES_OUT, m.id + '.json'), JSON.stringify(LINES[m.id] || [], null, 1));
  }
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
