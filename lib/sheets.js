// Copied from the staff portal. Google Sheets access with a service account (no npm deps). Reads use the read-only scope;
// the demand letters' "Update CRM sheet" step writes with the full scope (the sheet must be shared
// with the service account as Editor for that).
// Env: GOOGLE_SERVICE_ACCOUNT_JSON (full JSON key) — or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY
//      SHEET_ID (defaults to the Dream Signature master sheet)
const crypto = require('crypto');

const SHEET_ID = process.env.SHEET_ID || '1epaBDLVEh9Ip6IhH7gtpMcRSVepBg_NnqVv27qQ_IoQ';
const TABS = {
  bookings: process.env.TAB_BOOKINGS || 'Developers Bookings',
  crm: process.env.TAB_CRM || 'CRM Follow up',
  bank: process.env.TAB_BANK || 'Rera Bank Stat.',
  report: process.env.TAB_REPORT || 'Dashboard', // the team's own summary tab (daily report block)
  stages: process.env.TAB_STAGES || 'Stagewise Payment', // project-level payment schedule
};

function creds() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const j = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return { email: j.client_email, key: j.private_key };
  }
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return { email: process.env.GOOGLE_CLIENT_EMAIL, key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  return null;
}
const configured = () => !!creds();

const READ = 'https://www.googleapis.com/auth/spreadsheets.readonly', WRITE = 'https://www.googleapis.com/auth/spreadsheets';
const tokenCache = {};
async function accessToken(scope = READ) {
  const tc = tokenCache[scope];
  if (tc && tc.token && Date.now() < tc.exp - 60000) return tc.token;
  const { email, key } = creds();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${j.error_description || j.error || res.status}`);
  tokenCache[scope] = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function sheetsGet(path, token, sheetId = SHEET_ID) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) {
    const msg = j.error?.message || res.status;
    if (res.status === 403) throw new Error(`Sheet not shared with ${creds().email} (${msg})`);
    throw new Error(`Sheets API: ${msg}`);
  }
  return j;
}

// Tab names drift ("Developers Bookings" vs "Developer’s Bookings", stray spaces), so
// resolve each configured name against the real titles, ignoring case and punctuation.
const loose = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Reads whole tabs from a spreadsheet. tabs maps a key to a tab name; names listed in
// `optional` may be missing (their key comes back as []), any other missing tab is an error.
async function fetchTabs(sheetId, tabs, optional = []) {
  const token = await accessToken();
  const titles = (await sheetsGet('?fields=sheets.properties.title', token, sheetId)).sheets.map((s) => s.properties.title);
  const found = [];
  for (const [k, want] of Object.entries(tabs)) {
    const hit = titles.find((t) => t === want) || titles.find((t) => loose(t) === loose(want));
    if (hit) found.push([k, hit]);
    else if (!optional.includes(k)) throw new Error(`Tab "${want}" not found in the sheet (tabs: ${titles.join(', ')})`);
  }
  const q = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  found.forEach(([, t]) => q.append('ranges', `'${t.replace(/'/g, "''")}'`));
  const j = await sheetsGet(`/values:batchGet?${q}`, token, sheetId);
  const raw = Object.fromEntries(Object.keys(tabs).map((k) => [k, []]));
  j.valueRanges.forEach((vr, i) => (raw[found[i][0]] = vr.values || []));
  return raw;
}

const fetchRaw = () => fetchTabs(SHEET_ID, TABS);

// Like fetchTabs, but each entry may limit columns: { ledger: ['Ledger', 'A:D'] } reads only A to D.
async function fetchRanges(sheetId, tabs) {
  const token = await accessToken();
  const titles = (await sheetsGet('?fields=sheets.properties.title', token, sheetId)).sheets.map((s) => s.properties.title);
  const found = [];
  for (const [k, spec] of Object.entries(tabs)) {
    const [want, cols] = Array.isArray(spec) ? spec : [spec, null];
    const hit = titles.find((t) => t === want) || titles.find((t) => loose(t) === loose(want));
    if (!hit) throw new Error(`Tab "${want}" not found in the sheet (tabs: ${titles.join(', ')})`);
    found.push([k, `'${hit.replace(/'/g, "''")}'${cols ? '!' + cols : ''}`]);
  }
  const q = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  found.forEach(([, r]) => q.append('ranges', r));
  const j = await sheetsGet(`/values:batchGet?${q}`, token, sheetId);
  const out = {};
  j.valueRanges.forEach((vr, i) => (out[found[i][0]] = vr.values || []));
  return out;
}

// Writes single cells: data = [{ range: "'CRM Follow up'!T5", value: 0.3 }, ...]. USER_ENTERED so a date string
// like 12-Oct-2026 becomes a real date in the sheet, as if typed.
async function updateCells(data, sheetId = SHEET_ID) {
  if (!data.length) return { updated: 0 };
  const token = await accessToken(WRITE);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.map((d) => ({ range: d.range, values: [[d.value]] })) }),
  });
  const j = await res.json();
  if (!res.ok) {
    const msg = j.error?.message || res.status;
    if (res.status === 403) throw new Error(`The sheet is shared with ${creds().email} as Viewer only. Share it as Editor so the portal can update Due % and Demand Date. (${msg})`);
    throw new Error(`Sheets API: ${msg}`);
  }
  return { updated: j.totalUpdatedCells || 0 };
}
// Reads one column (e.g. the Unit No. column) to confirm rows have not moved before writing.
async function readColumn(tab, letter, sheetId = SHEET_ID) {
  const token = await accessToken(WRITE);
  const q = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  const j = await sheetsGet(`/values/${encodeURIComponent(`${tab}!${letter}:${letter}`)}?${q}`, token, sheetId);
  return (j.values || []).map((r) => r[0]);
}
// Reads a range with the write scope (used just before writing, so the rows are checked against the latest sheet).
async function readRange(range, sheetId = SHEET_ID) {
  const token = await accessToken(WRITE);
  const q = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  const j = await sheetsGet(`/values/${encodeURIComponent(range)}?${q}`, token, sheetId);
  return j.values || [];
}
const colLetter = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

module.exports = { fetchRaw, fetchTabs, fetchRanges, updateCells, readColumn, readRange, colLetter, configured, serviceEmail: () => creds()?.email, SHEET_ID };
