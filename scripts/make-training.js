// Records the training videos in public/training/ (one .mp4 and a poster .jpg per module in lib/training.js).
// Runs the ERP against an EMPTY database, fills it with made-up sample data (Sample Buyer …, Sample Bank …), then plays
// each lesson in a browser with captions and a pointer, and saves the recording. No real buyer or bank data is used.
//   DATABASE_URL=postgres://…/empty_db node scripts/make-training.js [module ...]
// Needs Playwright (Chromium) and ffmpeg.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.PORT = process.env.PORT || '3310';
require('./dev-server');
const { chromium } = require('playwright');
const db = require('../lib/db');
const auth = require('../lib/auth');
const { MODULES } = require('../lib/training');

const BASE = `http://localhost:${process.env.PORT}`;
const OUT = path.join(__dirname, '../public/training');
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
  return { sig };
}

// ---------- the player ----------
// Captions and a pointer drawn on the page (as popovers, so they stay above open dialogs).
const OVERLAY = `(() => {
  if (window.__tr) return; window.__tr = true;
  const css = document.createElement('style');
  css.textContent = \`#trcap{position:fixed;inset:auto 0 26px 0;margin:0 auto;max-width:980px;width:max-content;border:0;padding:14px 22px;border-radius:14px;background:rgba(20,12,89,.94);color:#fff;font:600 21px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center}
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

function reading(t) { return Math.max(2600, Math.min(7000, String(t).split(/\s+/).length * 330)); }

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
    const [op, a, b, c] = s;
    try {
      if (op === 'title') { await ov(); await page.evaluate(([x, y, z]) => window.__title(x, y, z), [a, b, c]); await page.waitForTimeout(3600); await page.evaluate(() => window.__title()); }
      else if (op === 'go') { await page.goto(BASE + a); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); await recap(); }
      else if (op === 'hash') { await page.evaluate((h) => { location.hash = h; }, a); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1100); await recap(); }
      else if (op === 'cap') { cap = a; await ov(); await page.evaluate((t) => window.__cap(t), a); await page.waitForTimeout(b || reading(a)); }
      else if (op === 'hl') { const { r } = await rect(a); await page.evaluate((q) => { window.__box(q); window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2); }, r); await page.waitForTimeout(b || 1800); await page.evaluate(() => window.__box()); }
      else if (op === 'click') {
        const { l, r } = await rect(a);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2), r); await page.waitForTimeout(800);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2, true), r);
        await l.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(b || 1200); await recap();
      }
      else if (op === 'type') { const { l, r } = await rect(a); await page.evaluate((q) => window.__ptr(q.x + 30, q.y + q.h / 2, true), r); await l.click(); await l.pressSequentially(b, { delay: 55 }); await page.waitForTimeout(500); }
      else if (op === 'select') { const { l } = await rect(a); await l.selectOption({ label: b }).catch(() => l.selectOption(b)); await page.waitForTimeout(700); }
      else if (op === 'scroll') { await page.mouse.wheel(0, a); await page.waitForTimeout(b || 1200); }
      else if (op === 'top') { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await page.waitForTimeout(800); }
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'end') { await page.evaluate(() => { window.__cap(); window.__box(); }); await page.evaluate(([x, y, z]) => window.__title(x, y, z), ['Dream India ERP · Training', a, b || 'Next: open the next video on the Training videos page.']); await page.waitForTimeout(3200); }
    } catch (e) { console.warn(`    step ${op} ${a || ''}: ${e.message.split('\n')[0]}`); }
  }
}

// ---------- the lessons ----------
const L = {
  start: { user: null, steps: [
    ['title', 'Training · Everyone', 'Getting started', 'Signing in, the home page, a project and its departments'],
    ['go', '/'], ['cap', 'Open the ERP in your browser and sign in with the username and password you were given.'],
    ['type', 'input[name=username]', 'ayesha'], ['type', 'input[name=password]', PW], ['click', 'form button'],
    ['cap', 'The first time, the ERP may ask you to choose your own password. Keep it to yourself.'],
    ['cap', 'This is the home page. Your projects are at the top; tools for everyone are below.'],
    ['hl', '.tile >> nth=0'], ['cap', 'Tap a project to open it.'], ['click', '.tile >> nth=0'],
    ['cap', 'Each project has its departments: Sales & CRM, Accounts, CA / Tax and more. You only see the ones your login is allowed.'],
    ['hl', '.tile >> nth=0', 2200], ['click', '.tile >> nth=0'],
    ['cap', 'Inside a department, every working page is a tile. Daily To-Do is always first: start your day there.'],
    ['hl', '.side .group-btn.open', 2000], ['cap', 'The same pages are in the menu on the left. Tap a heading to open or close it.'],
    ['hl', '#cpw', 1600], ['cap', 'Change password and Sign out are at the top right. Always sign out on a shared computer.'],
    ['end', 'Getting started'],
  ] },
  'crm-todo': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Your Daily To-Do', 'The list the ERP makes for you every morning at 9 am'],
    ['hash', '#/crmtodo'], ['cap', 'Every morning at 9 am the ERP makes today’s list: calls to make, approvals, letters, and what Accounts found that the CRM must fix.'],
    ['hl', '.kpis'], ['cap', 'At the top: how many lines are open, how many are urgent, and how many are done.'],
    ['hl', '.td.hi >> nth=0', 2200], ['cap', 'Urgent lines have a red edge. Do these first.'],
    ['click', '.td .td-title a >> nth=0'], ['cap', 'Tap a line to go straight to the page where you do the work.'], ['hash', '#/crmtodo'],
    ['type', '.note >> nth=0', 'Called 12 buyers, rest tomorrow'], ['cap', 'When a line is done, you can write a short note, then tick it.'],
    ['click', '.tk >> nth=0'], ['cap', 'Ticked lines move off the Open list. Open the All tab to see what was done, by whom and when.'],
    ['click', '.tab[data-f=all]'], ['wait', 1200], ['click', '.tab[data-f=open]'],
    ['hl', '.asg >> nth=0'], ['cap', 'Use the box on the right to give a line to one person. Mine shows only your lines.'],
    ['scroll', 700], ['type', '#addT input[name=title]', 'Send the possession checklist to A-1203'], ['click', '#addT button'],
    ['cap', 'Add your own tasks at the bottom. They stay on the list, day after day, until someone ticks them.'],
    ['cap', 'If a 9 am line is not fixed, it comes back the next morning with the date it was first found.'],
    ['end', 'Your Daily To-Do'],
  ] },
  followups: { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Follow-up calls', 'Who to call today and how to log each call'],
    ['hash', '#/followups'], ['cap', 'Follow-ups is one shared list of every buyer with overdue dues.'],
    ['hl', '.kpis'], ['cap', 'Buyers owing, to follow up today, broken promises and never contacted.'],
    ['click', '.tab[data-t=due]'], ['cap', 'Due today: these buyers must be called today.'],
    ['click', 'button[data-log] >> nth=0'], ['cap', 'After each call, tap Log. Choose how you contacted the buyer and what they said.'],
    ['select', 'dialog select[name=outcome]', 'Promised to pay'], ['type', 'dialog textarea[name=note]', 'Will pay the plinth demand by Friday'],
    ['click', 'dialog [data-n] >> nth=1'], ['cap', 'If they promise to pay, put the date and amount. Pick when to call next.'],
    ['click', 'dialog button[value=save]'], ['cap', 'Saved. The buyer moves off today’s list until the next follow-up date.'],
    ['click', '.tab[data-t=broken]'], ['cap', 'Broken promises: the promised date passed and nothing came in. Call these first.'],
    ['end', 'Follow-up calls'],
  ] },
  bookings: { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Units, bookings and ledgers', 'Finding a flat, its booking and the buyer’s statement'],
    ['hash', '#/units'], ['cap', 'Units & inventory shows every flat, floor by floor. The colour shows sold, available or held.'],
    ['hl', '.tabs'], ['cap', 'Pick a wing at the top.'], ['scroll', 300], ['click', 'button.unit.s-booked >> nth=5'],
    ['cap', 'Tap a flat to see its buyer, agreement value and dues.'], ['wait', 1500],
    ['hash', '#/bookings'], ['cap', 'Bookings lists every booking. New bookings wait here for Head CRM to approve.'],
    ['type', '#q', 'A-12'], ['cap', 'Search by flat or buyer.'],
    ['click', '#tbl a >> nth=0'], ['cap', 'The booking page has the applicants, the payment plan, demands and receipts.'], ['scroll', 500],
    ['hash', '#/ledgers'], ['cap', 'Customer ledgers: the statement of account for each buyer. Print it or save it as a PDF to send.'],
    ['end', 'Units, bookings and ledgers'],
  ] },
  letters: { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Demands and demand letters', 'From a construction stage to the letter in the buyer’s inbox'],
    ['hash', '#/demands'], ['cap', 'When the site completes a stage, it is recorded here. Then a demand run is prepared for that stage.'],
    ['hl', '#run'], ['cap', 'Head CRM checks the run and approves it. Approving raises the demand on every booking in that wing.'],
    ['hash', '#/letters'], ['cap', 'Demand letters: choose the letter type, tick the buyers, and prepare the letters.'],
    ['hl', '#type'], ['hl', '#prepare'], ['cap', 'Send each letter by email or courier, and record how it went. The ERP keeps a copy.'],
    ['cap', 'Until the ERP is live, emails go only to the test address, never to buyers.'],
    ['end', 'Demands and demand letters'],
  ] },
  'acc-todo': { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'The 9 am audit and your Daily To-Do', 'What the audit checks and how to clear it'],
    ['hash', '#/acctodo'], ['cap', 'Every morning at 9 am the ERP audits the books and writes today’s Accounts list. The same list is emailed to the accounts mailbox.'],
    ['cap', 'It checks entries are up to date, heads, units and payees filled, bank balances agree, PDCs due, compliance due, unmatched bank items, Tally against the CRM and cancelled flats.'],
    ['hl', '.td.hi >> nth=0', 2200], ['cap', 'Urgent lines first: a PDC due tomorrow, a late GST return, a bank that does not agree.'],
    ['click', '.td .td-title a >> nth=0'], ['cap', 'Each line opens the register where you fix it.'], ['hash', '#/acctodo'],
    ['type', '.note >> nth=0', 'Balance kept in RERA account'], ['click', '.tk >> nth=0'], ['cap', 'Tick it when done, with a note if useful.'],
    ['cap', 'Head Accounts can run the audit again during the day. Lines that are fixed are cleared by themselves.'],
    ['hl', '#rerun'],
    ['end', 'The 9 am audit'],
  ] },
  bank: { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'Daily Bank Balance and Bank Auto Check', 'Every bank, every day, agreeing with the statement'],
    ['hash', '#/balances'], ['cap', 'Daily Bank Balance: opening, receipts, payments and closing for each bank on the report date.'],
    ['hl', 'input.stated >> nth=0'], ['type', 'input.stated >> nth=0', '4980000'], ['cap', 'Type the balance the bank shows in Balance per Bank. The Difference must be blank or zero.'],
    ['scroll', 500], ['cap', 'Below are the daily entries: one row per bank for each day.'],
    ['hash', '#/bankauto'], ['cap', 'Bank Auto Check: at 3:10 pm the ERP reads the statements from the Google Drive folder and checks every line against the books.'],
    ['cap', 'Upload the day’s statements to the folder by 3 pm. Each difference it finds must be worked through and tagged.'],
    ['end', 'Bank balances'],
  ] },
  registers: { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'Receipts, Payments Out and PDC', 'Working in the registers'],
    ['hash', '#/reg-receipts'], ['cap', 'Receipts (bank): one row for every credit on the bank statement.'],
    ['cap', 'Each customer receipt needs its Cash Flow Head and the flat, like A-1001. The filters show what is missing.'], ['scroll', 400],
    ['hash', '#/reg-payments'], ['cap', 'Payments Out: one row for every debit. Fill the head and the payee; contractor and material payments also need the bill details.'],
    ['hash', '#/reg-pdc'], ['cap', 'PDC: post-dated cheques we have given. Reminders are emailed 48 and 24 hours before each one is due.'],
    ['end', 'The registers'],
  ] },
  audit: { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'Tally vs CRM and cancelled flats', 'Making the books and the CRM agree, flat by flat'],
    ['hash', '#/bookscrm'], ['cap', 'Tally vs CRM puts the money received in the books against the CRM for every flat.'],
    ['cap', 'Returned cheques and the money of cancelled buyers are set aside, so only real differences are left.'], ['scroll', 400],
    ['hash', '#/reg-cancellations'], ['cap', 'Cancelled flats: the refund list. The green columns compare each one with the CRM and the books.'],
    ['cap', 'If a cancelled flat is still booked in the CRM, it goes on the CRM team’s Daily To-Do the next morning.'],
    ['end', 'Tally vs CRM'],
  ] },
};

(async () => {
  const only = process.argv.slice(2);
  await new Promise((r) => setTimeout(r, 800));
  await api('', '/api/session'); // runs the migrations
  await seed();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
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
    if (lesson.user) { await page.goto(BASE + '/#/home'); await page.waitForLoadState('networkidle').catch(() => {}); }
    await play(page, lesson.steps);
    const v = page.video(); await ctx.close();
    const webm = await v.path();
    const mp4 = path.join(OUT, m.id + '.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', path.join(OUT, m.id + '.jpg')]);
    console.log('  saved', mp4, Math.round(fs.statSync(mp4).size / 1024) + ' KB');
  }
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
