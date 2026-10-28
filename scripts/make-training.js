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
function say(text) {
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
  await page.waitForTimeout(Math.max(minMs || 0, c ? c.ms + 450 : reading(text)));
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
      else if (op === 'hash') { await page.evaluate((h) => { document.querySelectorAll('dialog[open]').forEach((d) => { d.close(); d.remove(); }); location.hash = h; }, a); await page.waitForTimeout(300); await page.waitForFunction(() => { const p = document.querySelector('#page'); return p && !/^Loading/.test(p.innerText.trim()); }, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(900); await recap(); }
      else if (op === 'fill') { const { l } = await rect(a); await l.fill(b); await page.waitForTimeout(600); }
      else if (op === 'set') { const { l } = await rect(a); const tag = await l.evaluate((e) => e.tagName); if (tag === 'SELECT') { const v = await l.evaluate((e, t) => { const o = [...e.options].find((x) => x.text === t) || [...e.options].find((x) => x.text.toLowerCase().includes(String(t).toLowerCase().replace(/\s*\(.*$/, ''))); return o ? o.value : null; }, b); if (v == null) throw new Error('no option ' + b); await l.selectOption(v, { timeout: 4000 }); } else { await l.click(); await l.fill(''); await l.pressSequentially(String(b), { delay: 35 }); } await page.waitForTimeout(450); }
      else if (op === 'chapter') { await page.evaluate(() => { window.__cap(); window.__box(); }).catch(() => {}); await ov(); await page.evaluate(([x, y]) => window.__title(x, y, ''), [a, b]); await speak(page, b + '.', 2200); await page.evaluate(() => window.__title()); }
      else if (op === 'pick') { const { l } = await rect(a); await l.selectOption({ index: b || 1 }); await page.waitForTimeout(500); }
      else if (op === 'key') { await page.keyboard.press(a); await page.waitForTimeout(b || 800); }
      else if (op === 'cap') { cap = a; await ov(); await page.evaluate((t) => window.__cap(t), a); await speak(page, a, b); }
      else if (op === 'hl') { const { r } = await rect(a); await page.evaluate((q) => { window.__box(q); window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2); }, r); await page.waitForTimeout(b || 1800); await page.evaluate(() => window.__box()); }
      else if (op === 'click') {
        const { l, r } = await rect(a);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2), r); await page.waitForTimeout(800);
        await page.evaluate((q) => window.__ptr(q.x + Math.min(q.w / 2, 60), q.y + q.h / 2, true), r);
        await l.click({ timeout: 8000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(b || 1200); await recap();
      }
      else if (op === 'type') { const { l, r } = await rect(a); await page.evaluate((q) => window.__ptr(q.x + 30, q.y + q.h / 2, true), r); await l.click(); await l.pressSequentially(b, { delay: 55 }); await page.waitForTimeout(500); }
      else if (op === 'select') { const { l } = await rect(a); await l.selectOption({ label: b }).catch(() => l.selectOption(b)); await page.waitForTimeout(700); }
      else if (op === 'scroll') { await page.mouse.wheel(0, a); await page.waitForTimeout(b || 1200); }
      else if (op === 'top') { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await page.waitForTimeout(800); }
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'mailnow') {
        await db.q("insert into communications (booking_id, channel, direction, from_addr, subject, body, sent_at, status) values ($1, 'email', 'in', 'sample.buyer@example.com', 'When is the next demand due?', 'Dear Sir, please tell me when the next demand is due and the amount. Regards', now(), 'matched')", [IDS.flat]);
        await page.evaluate(() => window.__erpMailCheck && window.__erpMailCheck());
        CUES.push({ t: Date.now() - T0, f: TONE }); await page.waitForTimeout(1600);
      }
      else if (op === 'end') { await page.evaluate(() => { window.__cap(); window.__box(); }); await page.evaluate(([x, y, z]) => window.__title(x, y, z), ['Dream India ERP · Training', a, b || 'Next: open the next video on the Training videos page.']); await speak(page, 'That is the end of this video. Open the next one on the Training videos page.', 3200); }
    } catch (e) { console.warn(`    step ${op} ${a || ''}: ${e.message.split('\n')[0]}`); }
  }
}

// ---------- the lessons ----------
const L = {
  // ---------- Sales & CRM (the one-window CRM, 29 Oct 2026) ----------
  'crm-new': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'The new CRM in five minutes', 'One window for every flat and its buyer'],
    ['hash', '#/project/1/crm'], ['cap', 'The CRM is built around one idea: one flat, one window. Everything about a buyer is in one place.'],
    ['hl', '.hgroup >> nth=0', 2200], ['cap', 'Your daily work is six tiles: Today, Flats and buyers, Book a flat, Receipts, Inbox and Dream Chat.'],
    ['hl', '.hgroup.more', 2000], ['cap', 'The tools for many flats at once, such as demand runs and the price list, are underneath.'],
    ['hash', '#/flats'], ['cap', 'Flats and buyers is the one list of every flat and buyer. It replaces the old Bookings, Customer ledgers and Follow-ups pages.'],
    ['hl', '.chips', 2200], ['cap', 'The buttons at the top filter the list: who to call today, broken promises, never called, overdue, and bookings waiting for approval.'],
    ['type', '#q', 'A-1'], ['cap', 'Or search for any flat number, buyer name or phone number.'], ['fill', '#q', ''],
    ['click', () => `tr[data-b="${IDS.flat}"]`, 2000], ['cap', 'Tap a flat to open its flat file.'],
    ['hl', '.ff-head', 2400], ['cap', 'At the top are the buyers with their phone, WhatsApp and email, and the money: agreement value, received, balance due, overdue and GST.'],
    ['hl', '.ff-actions', 2200], ['cap', 'Below are the everyday buttons: log a call, enter a receipt, email the buyer and send a demand letter. Less common actions are under More.'],
    ['hl', '#ffNext', 2200], ['cap', 'The Overview tab shows where the buyer stands: overdue, last contact, promise to pay, next call and last receipt.'],
    ['click', '[data-ff=payments]'], ['cap', 'Payments has every receipt and where each cheque is, the payment plan, and the full ledger.'], ['scroll', 700, 1800], ['top'],
    ['click', '[data-ff=calls]'], ['cap', 'Calls and follow-ups lists every call logged for this buyer.'],
    ['click', '[data-ff=messages]'], ['cap', 'Messages has the buyer’s emails and WhatsApps, and Dream Chat with Accounts about this flat.'],
    ['click', '[data-ff=documents]'], ['cap', 'Documents has the cost sheet, allotment letter, booking form and statement, and every signed paper uploaded for this flat.'],
    ['click', '[data-ff=history]'], ['cap', 'History shows every change on this flat, who made it and when.'],
    ['click', '[data-ff=overview]'], ['cap', 'Buyer details are kept only here, and only Head CRM can change them. So there is never a second copy to go wrong.'],
    ['end', 'The new CRM in five minutes', 'Next: Today and follow-up calls.'],
  ] },
  'crm-calls': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Today and follow-up calls', 'Who to call, and how to log each call'],
    ['hash', '#/crmtodo'], ['cap', 'Start every morning with Today. At 9 am the ERP makes your list: calls, approvals, letters, and what Accounts needs the CRM to fix.'],
    ['hl', '.td.hi >> nth=0', 2200], ['cap', 'Urgent lines have a red edge. Do these first. Tap a line to go straight to the work.'],
    ['hash', '#/flats?f=call'], ['cap', 'Call today shows the buyers with dues whose next call is today or earlier.'],
    ['hl', 'table.flats tr.click >> nth=0', 2200], ['cap', 'Tap Call or WhatsApp to reach the buyer from your phone. Then open the flat.'],
    ['click', 'table.flats tr.click >> nth=0', 2000],
    ['click', '#logf'], ['cap', 'After the call, tap Log a call. Choose how you reached the buyer and what they said.'],
    ['select', 'dialog select[name=outcome]', 'Promised to pay'], ['type', 'dialog textarea[name=note]', 'Will pay the plinth demand by Friday'],
    ['fill', 'dialog input[name=promiseDate]', () => addDays(ist(), 4)], ['type', 'dialog input[name=promiseAmount]', '250000'],
    ['click', 'dialog [data-n] >> nth=1'], ['cap', 'If they promise to pay, enter the date and the amount, and pick when to call next.'],
    ['click', 'dialog button[value=save]', 2200], ['cap', 'Saved. Every call stays in Calls and follow-ups, with who made it and when.'],
    ['click', '[data-ff=overview]'], ['hl', '#ffNext', 2200], ['cap', 'The Overview now shows the promise and the next call, and the buyer leaves today’s list until then.'],
    ['hash', '#/flats'], ['click', '.chip[data-f=broken]'], ['cap', 'Broken promises: the promised date passed and nothing came in. Call these first.'],
    ['click', '.chip[data-f=never]'], ['cap', 'Never called: buyers with dues nobody has called yet. Make the first call and log it.'],
    ['end', 'Today and follow-up calls', 'Next: Receipts and cheques.'],
  ] },
  'crm-receipts': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Receipts and cheques', 'From the buyer’s cheque to the bank statement'],
    ['hash', () => `#/booking/${IDS.flat}`], ['cap', 'When a buyer pays, open the flat and tap Enter a receipt.'],
    ['click', '#receipt'], ['fill', 'dialog input[name=receivedOn]', () => ist()], ['set', 'dialog input[name=amount]', '250000'], ['set', 'dialog select[name=mode]', 'Cheque'],
    ['set', 'dialog input[name=bank]', 'Sample Bank'], ['set', 'dialog input[name=instrumentNo]', '000452'],
    ['cap', 'Enter the date, the amount, how it was paid, the bank and the cheque number. Tap Split as AV plus GST, then save.'],
    ['click', 'dialog #auto', 1200], ['click', 'dialog button[value=save]', 2000],
    ['hl', 'dialog[open]', 1600], ['cap', 'The payment receipt is numbered at once. Open it as a PDF, email it to the buyer, or send it on WhatsApp.'],
    ['key', 'Escape', 1000], ['cap', 'Accounts is told at once, in Dream Chat, that there is a cheque to deposit.'],
    ['click', '[data-ff=payments]'], ['hl', 'td:has-text("with CRM") >> nth=0', 2200],
    ['cap', 'Each receipt shows where the cheque is: with CRM, with Accounts, deposited, and finally in the bank.'],
    ['cap', 'Accounts marks it received and deposited. At 3:10 pm the bank statement is checked, and a cheque that matches is approved by itself.'],
    ['cap', 'If a cheque comes back, the ERP marks it returned, tells you in Dream Chat, and puts the buyer on your Today list to call.'],
    ['hl', 'button[data-doc] >> nth=-1', 1800], ['cap', 'The Receipt button opens the payment receipt again at any time.'],
    ['hash', '#/receipts'], ['cap', 'The Receipts page lists every receipt for the project, and the cheques still to be deposited.'],
    ['end', 'Receipts and cheques', 'Next: Buyer emails, Dream Chat and documents.'],
  ] },
  'crm-messages': { user: 'ayesha', steps: [
    ['title', 'Training · Sales & CRM', 'Buyer emails, Dream Chat and documents', 'Every message about a flat, kept with that flat'],
    ['hash', '#/flats'], ['cap', 'Every email or WhatsApp a buyer sends to the CRM mailbox comes into the ERP within a few minutes, filed with that flat.'],
    ['mailnow'], ['cap', 'You hear this bell, a box shows who wrote, and the red badge at the top counts the unread ones.'],
    ['hl', '#mailpop', 1800], ['click', '#mailpop', 2200], ['cap', 'Tap the box to open the flat’s Messages tab, with the whole conversation.'],
    ['hl', '#ccomm', 2000],
    ['click', '#ffMail'], ['cap', 'To write to the buyer, tap Email the buyer. Choose the purpose, check the message and send. The reply comes back to this flat.'],
    ['wait', 1200], ['key', 'Escape'],
    ['hl', '#ffChat', 1800], ['type', '#ffChatF input[name=body]', 'Please confirm the cheque for this flat is deposited'],
    ['cap', 'Dream Chat about this flat goes straight to Accounts. They hear a chime, and the message stays here with the flat.'],
    ['click', '#ffChatF button', 1600],
    ['hash', '#/comms'], ['cap', 'The Inbox lists every buyer message. Messages from addresses the ERP does not know wait to be linked: link each one to its flat once.'],
    ['cap', 'If a buyer waits more than a day for a reply, it goes on the Today list at 9 am.'],
    ['hash', () => `#/booking/${IDS.flat}?tab=documents`], ['cap', 'Documents holds the letters the ERP makes, and every signed or scanned paper for the flat, kept in Google Drive.'],
    ['hl', '#cdocs', 2000], ['cap', 'Tap Add a document to upload one. The list shows what is still to come, like the agreement or Index Two.'],
    ['end', 'Buyer emails, Dream Chat and documents', 'Next: Booking, approval and cancellation.'],
  ] },
  'crm-booking': { user: 'demo', steps: [
    ['title', 'Training · Sales & CRM', 'Booking, approval and cancellation', 'Booking a flat, Head CRM’s approval, cancelling and rebooking'],
    ['hash', '#/units'], ['cap', 'To book a flat, open Book a flat. Every flat is shown floor by floor. The colour shows sold, available or held.'],
    ['click', 'button.unit.s-available >> nth=3'], ['cap', 'Tap an available flat, then tap Book this unit.'], ['click', '#book'],
    ['fill', 'dialog input[name=bookingDate]', () => ist()], ['set', 'dialog input[name=agreementValue]', '8500000'],
    ['set', 'dialog input[name=a1_name]', 'Training Buyer One'], ['set', 'dialog input[name=a1_phone]', '9800000001'], ['set', 'dialog input[name=a1_pan]', 'ABCDE1234F'],
    ['cap', 'Fill in the booking date, the agreement value and the buyers, with the channel partner and brokerage if there is one. Then save.'],
    ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The booking now waits for Head CRM. The person who enters a booking can never approve it.'],
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
    ['hl', '.cancel-box', 2400], ['cap', 'Nothing is lost. The buyer, every receipt, the charges and the refund due stay on this flat, and Accounts gets it on the Cancelled flats list for the refund.'],
    ['cap', 'The flat is free again. Tap Book this flat for a new buyer.'],
    ['click', '#rebook'], ['fill', 'dialog input[name=bookingDate]', () => ist()], ['set', 'dialog input[name=agreementValue]', '9000000'], ['set', 'dialog input[name=a1_name]', 'Training Buyer Two'],
    ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The new booking goes for approval as usual, and the flat file shows the earlier cancelled booking, so each flat keeps its full history.'],
    ['end', 'Booking, approval and cancellation', 'Next: Demands and demand letters.'],
  ] },
  'crm-letters': { user: 'demo', steps: [
    ['title', 'Training · Sales & CRM', 'Demands and demand letters', 'From a construction stage to the letter in the buyer’s inbox'],
    ['hash', '#/demands'], ['cap', 'When the site completes a stage, it is recorded on Stages and demands, in CRM tools, with the date and who certified it.'],
    ['click', '#stage'], ['set', 'dialog select[name=buildingId]', 'A Wing'], ['set', 'dialog select[name=stageName]', 'On Completion of Plinth (10%)'], ['fill', 'dialog input[name=completedOn]', () => addDays(ist(), -1)], ['set', 'dialog input[name=certifiedBy]', 'Site engineer'],
    ['click', 'dialog button[value=save]', 1600],
    ['cap', 'Then prepare the demand run for that wing and stage.'], ['click', '#run'], ['click', 'dialog button[value=save]', 2000],
    ['cap', 'The run lists every buyer with the amount and GST. Head CRM checks it and taps Approve and raise demands.'], ['hl', '#ok', 2200],
    ['hash', () => `#/booking/${IDS.flat}`], ['cap', 'For one buyer, open the flat and tap Demand letter.'],
    ['click', '#ffLetter', 1600], ['cap', 'Choose the letter type and how to send it: email, print, or mark it sent on WhatsApp or by courier. Preview shows the letter first.'],
    ['hl', 'dialog select[name=type]', 1600], ['wait', 1200], ['key', 'Escape'],
    ['hash', '#/letters'], ['cap', 'For many buyers at once, use Demand letters in CRM tools. Tick the buyers and tap Prepare letters.'],
    ['click', '#all', 900], ['hl', '#prepare', 1800],
    ['cap', 'Until the ERP goes live, every email goes only to the test address, never to buyers.'],
    ['end', 'Demands and demand letters', 'That is the whole CRM. Start each morning with Today.'],
  ] },
  'acc-full': { user: 'demo', steps: [
    ['title', 'Training · Accounts', 'The complete Accounts course', 'Daily entries, bank checks, registers, refunds, reports and Tally'],
    ['chapter', 'Part 1', 'Your day starts here'],
    ['hash', '#/acctodo'], ['cap', 'Start every morning with the Daily To-Do. The nine o’clock audit lists what needs doing. Tick each line when it is done.'],
    ['chapter', 'Part 2', 'Entering receipts'],
    ['hash', '#/reg-receipts'], ['cap', 'Every credit on the bank statement is one row in Receipts. Tap Add a row.'],
    ['click', '#accNew'], ['fill', 'dialog [name=txn_date]', () => ist()], ['set', 'dialog [name=bank]', 'Sample Bank Collection A/c'], ['set', 'dialog [name=description]', 'NEFT A-1203 SAMPLE BUYER'], ['set', 'dialog [name=amount]', '350000'],
    ['cap', 'Pick the cash flow head and the payment head, and type the flat as A-1203. If one cheque pays agreement value and GST, enter one row for each, with the same reference.'],
    ['set', 'dialog [name=head]', 'Customer receipt'], ['set', 'dialog [name=payment_head]', 'AV'], ['set', 'dialog [name=unit_no]', 'A-1203'],
    ['click', 'dialog button[value=save]', 1600],
    ['cap', 'Use the filters to find receipts with no head, or customer receipts with no flat. Never delete a bounced cheque: set its Cheque Status to Bounced.'],
    ['click', '[data-f=noHead]', 1800],
    ['chapter', 'Part 3', 'Payments, bills and TDS'],
    ['hash', '#/reg-payments'], ['cap', 'Every debit is one row in Payments Out, with its head, the payee, and the flat when it is for a buyer.'],
    ['click', '#accNew'], ['fill', 'dialog [name=txn_date]', () => ist()], ['set', 'dialog [name=bank]', 'Sample Bank RERA 70% A/c'], ['set', 'dialog [name=description]', 'RTGS SAMPLE BUILDERS'], ['set', 'dialog [name=amount]', '500000'], ['set', 'dialog [name=head]', 'Contractor'], ['set', 'dialog [name=payee]', 'Sample Builders Pvt Ltd'],
    ['cap', 'For contractors and suppliers, open Bill details and fill in the bill number, PAN, taxable value, GST and TDS. The ERP works out the net payable.'],
    ['click', 'dialog details summary', 800], ['set', 'dialog [name=bill_no]', 'INV-204'], ['set', 'dialog [name=vendor_pan]', 'AAACS1234K'], ['set', 'dialog [name=taxable_value]', '476190'],
    ['click', 'dialog button[value=save]', 1600],
    ['cap', 'Needs bill details shows every payment still waiting for its bill.'], ['click', '[data-f=needsBill]', 1800],
    ['chapter', 'Part 4', 'Daily Bank Balance'],
    ['hash', '#/balances'], ['cap', 'Each day, add one entry for each bank, with its receipts and payments.'],
    ['click', '#addEntry'], ['fill', 'dialog [name=entry_date]', () => ist()], ['pick', 'dialog select[name=bank]', 1], ['set', 'dialog [name=receipts]', '350000'], ['set', 'dialog [name=payments]', '500000'],
    ['click', 'dialog button[value=save]', 1600],
    ['cap', 'Then type the balance the bank shows in Balance per Bank. The difference must be blank or zero. If it is not, an entry is missing.'],
    ['set', 'input.stated >> nth=0', '5480000'], ['key', 'Tab', 1400],
    ['chapter', 'Part 5', 'Bank Auto Check'],
    ['hash', '#/bankauto'], ['cap', 'Upload the day’s bank statements to the Google Drive folder by three p m. At three ten, the ERP reads them and checks every line against your entries.'],
    ['hl', '#upl'], ['cap', 'Lines missing from the books are added for you, marked Added from bank statement. Fill in their head and payee. Any differences are listed here to work through.'],
    ['hl', '#cmpDrive'], ['cap', 'Compare books with the statements checks any period both ways, without adding anything.'],
    ['chapter', 'Part 6', 'PDC and TDS'],
    ['hash', '#/reg-pdc'], ['cap', 'Every post-dated cheque we give goes into PDC on the day it is given. Reminders are emailed forty eight hours and twenty four hours before it is due.'],
    ['click', '#accNew'], ['fill', 'dialog [name=issued_on]', () => ist()], ['set', 'dialog [name=issued_to]', 'Sample Steel Suppliers'], ['set', 'dialog [name=amount]', '750000'], ['set', 'dialog [name=bank]', 'Sample Bank RERA 70% A/c'], ['fill', 'dialog [name=due_date]', () => addDays(ist(), 10)], ['set', 'dialog [name=cheque_no]', '000131'],
    ['click', 'dialog button[value=save]', 1600],
    ['hash', '#/reg-tds'], ['cap', 'The TDS Tracker has one row for each TDS challan or Form 16 B a buyer gives us. Over the whole project, the TDS due is one percent of the agreement value.'],
    ['chapter', 'Part 7', 'Reconciling items and compliance'],
    ['hash', '#/reg-recon'], ['cap', 'Anything on the statement you cannot match goes into Reconciling Items. Give it an owner, and update the status and note as it is cleared.'],
    ['click', 'tr[data-id] >> nth=0'], ['set', 'dialog [name=owner]', 'Imran'], ['set', 'dialog [name=resolution]', 'Asked the bank for the payer name'], ['click', 'dialog button[value=save]', 1600],
    ['hash', '#/reg-compliance'], ['cap', 'The Compliance Calendar lists every return and tax payment with its due date. When one is filed, set Status to Complied, with the date and the acknowledgement number.'],
    ['click', 'tr[data-id] >> nth=0'], ['set', 'dialog [name=status]', 'Complied'], ['fill', 'dialog [name=date_complied]', () => ist()], ['set', 'dialog [name=ack]', 'ACK12345'], ['click', 'dialog button[value=save]', 1600],
    ['chapter', 'Part 8', 'Cancelled flats and refunds'],
    ['hash', '#/reg-cancellations'], ['cap', 'When Management approves a cancellation in the CRM, the flat appears here by itself: the old buyer, what they paid, the charges and the refund due.'],
    ['click', 'tr[data-id] >> nth=0'], ['cap', 'When you pay the refund, enter the amount paid by RTGS or WHITE, and set Refund Status to DONE once it is fully paid. The CRM booking shows the same status.'],
    ['set', 'dialog [name=refund_rtgs]', '100000'], ['set', 'dialog [name=refund_status]', 'Part paid'], ['click', 'dialog button[value=save]', 1600],
    ['cap', 'The green columns check every row against the CRM and the books, so nothing is missed at audit.'],
    ['chapter', 'Part 9', 'SRA tenants'],
    ['hash', '#/reg-tenants'], ['cap', 'SRA Tenants holds each survey number, the rent due each year and what has been paid. Link every Tenant Rent payment to its survey number in Tenant Rent Links.'],
    ['chapter', 'Part 10', 'Dashboard and reports'],
    ['go', '/accounts'], ['cap', 'The Accounts dashboard shows bank balances, collections, sales and dues, expenses, payments by head and money in and out, all live from the registers.'],
    ['click', 'text="Collections"', 1800], ['click', 'text="Expenses"', 1800],
    ['go', '/#/accreports'], ['cap', 'Reports gives the GST and SDR reports, payees, channel partner accounts, vendor bills and the salary register. Tally export makes vouchers for any period.'],
    ['click', '[data-t=gst]', 1800], ['click', '[data-t=tally]', 1800],
    ['chapter', 'Part 11', 'Tally, checks and the CA'],
    ['hash', '#/accsetup'], ['cap', 'Head Accounts imports the Receipt, Payment and Contra registers from Tally here. Read the files first: the ERP checks them before anything is imported.'],
    ['hl', '#tpv'],
    ['hash', '#/checks'], ['cap', 'At month end, open Checks. Every line should say OK. If one says Check, fix the entry it points to.'],
    ['hash', '#/bookscrm'], ['cap', 'Tally versus CRM compares the money in the books with the CRM for every flat, with returned cheques and cancelled buyers set aside.'],
    ['go', '/ca'], ['cap', 'The CA page has GST, TDS payable, RERA, cash flow and compliance, for the CA to review.'],
    ['click', 'text="RERA"', 1800],
    ['go', '/#/acctodo'], ['cap', 'That is the full Accounts day: enter, check, reconcile, and clear your Daily To-Do.'],
    ['end', 'The complete Accounts course'],
  ] },

  start: { user: null, steps: [
    ['title', 'Training · Everyone', 'Getting started', 'Signing in, the home page, a project and its departments'],
    ['go', '/'], ['cap', 'Open the ERP in your browser and sign in with the username and password you were given.'],
    ['type', 'input[name=username]', 'ayesha'], ['type', 'input[name=password]', PW], ['click', 'form button'],
    ['cap', 'The first time, the ERP may ask you to choose your own password. Keep it to yourself.'],
    ['cap', 'This is the home page. Your projects are at the top; tools for everyone are below.'],
    ['hl', '.tile >> nth=0'], ['cap', 'Tap a project to open it.'], ['click', '.tile >> nth=0'],
    ['cap', 'Each project has its departments: Sales and CRM, Accounts, Construction and more. You see only the ones your login is allowed.'],
    ['hl', '.tile >> nth=0', 2200], ['click', '.tile >> nth=0'],
    ['cap', 'Inside a department, your daily work comes first, and Today is always the first tile. Start your day there.'],
    ['hl', '.side .group-btn.open', 2000], ['cap', 'The same pages are in the menu on the left. Tap a heading to open or close it.'],
    ['hl', '#cpw', 1600], ['cap', 'Change password and Sign out are at the top right. Always sign out on a shared computer.'],
    ['cap', 'On your phone, add the ERP to your home screen and it opens like an app.'],
    ['end', 'Getting started'],
  ] },
  'acc-todo': { user: 'imran', steps: [
    ['title', 'Training · Accounts', 'The 9 am audit and your Daily To-Do', 'What the audit checks and how to clear it'],
    ['hash', '#/acctodo'], ['cap', 'Every morning at 9 am the ERP audits the books and writes today’s Accounts list. The same list is emailed to the accounts mailbox.'],
    ['cap', 'It checks entries are up to date, heads, units and payees filled, bank balances agree, PDCs due, compliance due, unmatched bank items, Tally against the CRM and cancelled flats.'],
    ['hl', '.td.hi >> nth=0', 2200], ['cap', 'Urgent lines first: a PDC due tomorrow, a late GST return, a bank that does not agree.'],
    ['click', '.td .td-title a >> nth=0'], ['cap', 'Each line opens the register where you fix it.'], ['hash', '#/acctodo'],
    ['type', '.note >> nth=0', 'Balance kept in RERA account'], ['click', '.tk >> nth=0'], ['cap', 'Tick it when done, with a note if useful.'],
    ['cap', 'Head Accounts can run the audit again during the day with “Run the audit again”. Lines that are fixed are cleared by themselves.'],
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
  }
  await browser.close();
  // The complete CRM course is the six CRM videos joined in order (same voice, no second recording).
  const parts = ['crm-new', 'crm-calls', 'crm-receipts', 'crm-messages', 'crm-booking', 'crm-letters'].map((x) => path.join(OUT, x + '.mp4'));
  if ((!only.length || only.includes('crm-full')) && parts.every((f) => fs.existsSync(f))) {
    const list = path.join(TMP, 'crm-full.txt'); fs.writeFileSync(list, parts.map((f) => `file '${f}'`).join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(OUT, 'crm-full.mp4')]);
    fs.copyFileSync(path.join(OUT, 'crm-new.jpg'), path.join(OUT, 'crm-full.jpg'));
    console.log('  saved the complete CRM course');
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
