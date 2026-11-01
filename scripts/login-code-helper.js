// Shared by the test suites: staff sign-in has two steps (password, then the 6-digit code; lib/staff-otp.js).
// ERP_TEST_OTP fixes the code (and nothing is sent), and every { action: 'login' } posted to /api/session or /api/chat
// that answers { otp: true, token } is finished here with { action: 'login-otp' }, so the suites' own login helpers
// keep working unchanged and still go through both steps. Not loaded by scripts/test-otp.js, which tests the steps.
process.env.ERP_TEST_OTP = process.env.ERP_TEST_OTP || '246810';
const orig = globalThis.fetch;
globalThis.fetch = async function fetchWithLoginCode(url, opts = {}) {
  const r = await orig(url, opts);
  let body = null;
  try { body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch { body = null; }
  if (!body || body.action !== 'login' || !/\/api\/(session|chat)(\?|$)/.test(String(url))) return r;
  const j = await r.clone().json().catch(() => null);
  if (!j || !j.otp || !j.token) return r;
  return orig(url, { ...opts, body: JSON.stringify({ action: 'login-otp', token: j.token, code: process.env.ERP_TEST_OTP }) });
};
