// Dream Aspire's own accounts books (Dream India Builders), kept apart from Prime Realtors' (Dream Signature).
// DATABASE_URL=postgres://... node scripts/test-aspire-books.js   (an empty database; synthetic data only)
require('./login-code-helper');
const assert = require('assert/strict');
process.env.PORT = process.env.PORT || '3997';
const server = require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body, book) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(book ? { 'X-Book': book } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  try {
    const admin = client();
    await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
    await db.q("insert into projects (code, name, company_id) select 'ASPIRE', 'Dream Aspire', company_id from projects where code = 'SIGNATURE' on conflict do nothing");
    const P = await db.one("select id from projects where code = 'ASPIRE'");
    const S = await db.one("select id from projects where code = 'SIGNATURE'");
    assert.ok(P && S, 'both projects exist');
    await db.q("insert into acc_receipts (book, ref_id, txn_date, bank, amount, source) values ('signature', 'BS90001', '2026-11-02', 'Prime HDFC (8650)', 111111, 'test')");

    await step('each company sees only its own books', async () => {
      const sig = await admin('/api/accounts?reg=receipts&limit=50');
      assert.ok(sig.rows.some((r) => r.ref_id === 'BS90001'));
      const asp = await admin('/api/accounts?reg=receipts&limit=50', null, 'aspire');
      assert.equal(asp.status, 200, JSON.stringify(asp)); assert.equal(asp.rows.length, 0);
      const L = await admin('/api/accounts?view=lists', null, 'aspire');
      assert.equal(L.book.book, 'aspire'); assert.ok(L.banks.some((b) => b.name === 'Aspire HDFC 30% (7044)')); assert.ok(!L.banks.some((b) => b.name === 'Prime HDFC (8650)'));
      assert.equal(L.heads.length, (await db.one("select count(*)::int as n from acc_heads where book = 'signature'")).n, 'the cash flow heads are copied');
    });
    await step('a cash entry in Aspire\'s books stays there', async () => {
      const r = await admin('/api/accounts', { action: 'save', reg: 'payments', data: { txn_date: '2026-11-03', bank: 'Cash', amount: '2500', head: 'Office Expense', payee: 'Tea' } }, 'aspire');
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal((await db.one("select book from acc_payments where id = $1", [r.id])).book, 'aspire');
      assert.ok(!(await admin('/api/accounts?reg=payments&limit=50')).rows.some((x) => x.id === r.id));
    });
    await step('only people on Dream Aspire open its books; Tally stays with Signature', async () => {
      const h = await admin('/api/users', { action: 'create', name: 'Sig Accounts', username: 'sacc', role: 'head_accounts', projects: [S.id] });
      const m = client(); await m('/api/session', { action: 'login', username: 'sacc', password: h.tempPassword }); await m('/api/session', { action: 'password', current: h.tempPassword, next: 'sig-accounts-pw-12' });
      assert.equal((await m('/api/accounts?reg=receipts&limit=5')).status, 200);
      assert.equal((await m('/api/accounts?reg=receipts&limit=5', null, 'aspire')).status, 403);
      const t = await admin('/api/accounts', { action: 'tally-sync-preview' }, 'aspire');
      assert.equal(t.status, 400); assert.match(t.error, /Dream Signature/);
    });
    await step('Aspire\'s statements are kept in full; own-account transfers marked; flat 1404 is A-1404', async () => {
      const { write } = require('../lib/xlsx-write');
      const rows = [['Date', 'Narration', 'Chq./Ref.No.', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance', 'FLAT NO', 'CLIENT NAME'],
        ['02/11/26', 'NEFT CR-TEST BUYER-DREAM INDIA BUILDERS', 'N1', null, 500000, 1500000, 1404, 'Test Buyer'],
        ['03/11/26', '50200091626459 FUND TRF TO DREAM INDIA BUILDERS', '0', 350000, null, 1150000, null, null],
        ['04/11/26', 'NEFT DR-TEST VENDOR', 'D1', 100000, null, 1050000, null, null]];
      const buf = write([{ name: 'Sheet 1', rows }]);
      const bs = require('../lib/bank-statements'); const bk = require('../lib/book');
      const out = await bk.run('aspire', () => db.tx((t) => bs.run(t, [{ name: 'Dream Aspire HDFC 100% - 6462.xlsx', buffer: buf }], { start: '2026-11-01', book: 'aspire', runDate: '2026-11-22' })));
      assert.deepEqual(out.added, { receipts: 1, payments: 2 });
      const r = await db.one("select unit_no, head, payment_head from acc_receipts where book = 'aspire' and amount = 500000");
      assert.equal(r.unit_no, 'A-1404'); assert.equal(r.payment_head, 'AV');
      assert.equal((await db.one("select head from acc_payments where book = 'aspire' and amount = 350000")).head, 'Internal transfer');
      const d = await db.one("select bf_balance, bf_date from acc_daily_banks where book = 'aspire' and name = 'ASPIRE HDFC 100% (6462)'");
      assert.equal(Number(d.bf_balance), 1000000);
      // and nothing went into Prime's books
      assert.equal((await db.one("select count(*)::int as n from acc_receipts where book = 'signature' and amount = 500000")).n, 0);
    });
    console.log(`\nDream Aspire's books: ${n} checks passed`);
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  server.close(); db.reset(); process.exit(process.exitCode || 0);
})();
