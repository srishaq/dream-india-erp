// Drawing register: reads the Dream Signature "Site Plans" folder in Google Drive (architect,
// structural and MEP drawings uploaded by the consultants) with the portal's service account,
// and sorts every file by discipline, building and trade so staff can find a sheet quickly.
// The folder must be shared with the service account (Viewer), and the Google Drive API must be
// switched on in the service account's Google Cloud project.
// Env: DRAWINGS_FOLDER_ID (defaults to Dream Signature – All Depts › Site Plans)
const crypto = require('crypto');
const { serviceEmail } = require('./sheets');

// Service-account sign-in with the Drive read-only scope (same key as the Sheets reads).
function creds() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) { const j = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); return { email: j.client_email, key: j.private_key }; }
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) return { email: process.env.GOOGLE_CLIENT_EMAIL, key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  return null;
}
let tok = null;
async function accessToken(scope) {
  if (tok && Date.now() < tok.exp - 60000) return tok.token;
  const { email, key } = creds();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${j.error_description || j.error || res.status}`);
  tok = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tok.token;
}

const ROOT = process.env.DRAWINGS_FOLDER_ID || '1B0dbxMjn9VqiN3LJTnJMsiP3Zma_JNZK';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const MAX_FOLDERS = 400; // guard against a runaway tree

class DriveError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

async function driveList(token, folderId, fetchImpl) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, shortcutDetails, lastModifyingUser(displayName, emailAddress), owners(displayName, emailAddress))',
      pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = j.error?.errors?.[0]?.reason || j.error?.status || '';
      const msg = j.error?.message || String(res.status);
      if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason + ' ' + msg)) {
        throw new DriveError('The Google Drive API is not switched on for the portal\'s Google project. Turn it on once at console.cloud.google.com → APIs & Services → Library → Google Drive API → Enable, then reload this page.', 'drive_api_off');
      }
      if (res.status === 404 || res.status === 403) {
        throw new DriveError(`The Site Plans folder is not shared with the portal. In Google Drive, share it with ${serviceEmail()} as Viewer.`, 'not_shared');
      }
      throw new DriveError(`Google Drive: ${msg}`, 'drive');
    }
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

// Walks the folder tree below ROOT. Returns files with their folder path (names, top first).
async function walk(fetchImpl = fetch, rootId = ROOT) {
  const token = await accessToken(SCOPE);
  const files = [];
  const queue = [{ id: rootId, path: [] }];
  const seen = new Set();
  while (queue.length) {
    if (seen.size > MAX_FOLDERS) break;
    const batch = queue.splice(0, 8); // a few folders at a time
    const lists = await Promise.all(batch.map((f) => { seen.add(f.id); return driveList(token, f.id, fetchImpl).then((items) => ({ f, items })); }));
    for (const { f, items } of lists) {
      for (const it of items) {
        const isFolder = it.mimeType === FOLDER || (it.mimeType === SHORTCUT && it.shortcutDetails?.targetMimeType === FOLDER);
        if (isFolder) {
          const id = it.mimeType === SHORTCUT ? it.shortcutDetails.targetId : it.id;
          if (!seen.has(id)) queue.push({ id, path: [...f.path, it.name] });
        } else files.push({ ...it, path: f.path });
      }
    }
  }
  return files;
}

// ---------- sorting ----------
const up = (s) => String(s || '').toUpperCase();
function discipline(path, name) {
  const top = up(path[0]);
  if (/ARCHITECT/.test(top)) return 'Architect';
  if (/STRUCT/.test(top)) return 'Structure';
  if (/MEP|SERVICE/.test(top)) return 'MEP';
  const n = up(name);
  if (/\bMEP\b|ELV|ELECTRICAL|PLB|HVAC|\bFF\b/.test(n)) return 'MEP';
  if (/FRAMING|STRUCTURAL|\bBBS\b/.test(n)) return 'Structure';
  return 'Other';
}
// Rehab or Sale: the file name first, then the nearest folder that names exactly one building
// (folders like "MEP Layouts for Rehab & Sale Building" name both and are skipped).
function building(path, name) {
  const one = (t) => {
    const u = up(t), r = /REHAB/.test(u), sl = /(^|[^A-Z])SALES?([^A-Z]|$)/.test(u);
    return r && !sl ? 'Rehab' : sl && !r ? 'Sale' : null;
  };
  const hit = one(name) || [...path].reverse().map(one).find(Boolean);
  if (hit) return hit;
  // Podium parking, shop / commercial and amenity floors exist only in the Sale building.
  if (/PODIUM|PARKING|COMMERCIAL|SHOP|AMENITY/.test(up(name))) return 'Sale';
  return 'General';
}
// MEP sheets carry the trade in their name: SALE-PLB_…, SALE-FF_…, SALE-HVAC_…, ELE / ELECTRICAL / ELV, CO-OR.
function trade(disc, path, name) {
  if (disc !== 'MEP') {
    const n = up(name), p = up(path.join(' '));
    if (disc === 'Architect') {
      if (/ELEVATION/.test(n + ' ' + p)) return 'Elevation';
      if (/SECTION|STAIRCASE|STAICASE|MIVAN/.test(n + ' ' + p)) return /STAIR|STAIC/.test(n) ? 'Staircase' : 'Section';
      return 'Floor plan';
    }
    if (disc === 'Structure') return /FRAMING|LAYOUT|PLAN/.test(n) ? 'Framing / layout' : 'Structure';
    return '';
  }
  const n = up(name), p = up(path.join(' '));
  if (/CO-OR|COORD/.test(n)) return 'Coordination';
  if (/HVAC/.test(n)) return 'HVAC';
  if (/[-_ ]FF[-_ ]|^FF[-_ ]|FIRE/.test(n)) return 'Fire fighting';
  if (/PLB|PLUMB|UG TANK|OVERHEAD TANK|OHT/.test(n)) return 'Plumbing';
  if (/ELE|ELECTRICAL|ELV|LIGHTING|CABLE TRAY/.test(n)) return 'Electrical';
  if (/SLEEVE|CUTOUT|DIMENSION/.test(n)) return 'Sleeves & cutouts';
  if (/SECTION/.test(n)) return 'Sections';
  if (/ELECTRICAL/.test(p)) return 'Electrical';
  if (/PLUMBING|FIRE|HVAC/.test(p)) return 'Plumbing, Fire & HVAC';
  return 'Combined MEP';
}
const ext = (name) => (String(name).match(/\.([a-z0-9]{2,5})$/i) || [, ''])[1].toLowerCase();
function kind(f) {
  const e = ext(f.name);
  if (f.mimeType === 'application/pdf' || e === 'pdf') return 'pdf';
  if (['dwg', 'dxf'].includes(e) || /dwg|dxf/i.test(f.mimeType)) return 'cad';
  if (['zip', 'rar', '7z'].includes(e) || /zip|compressed/i.test(f.mimeType)) return 'zip';
  if (/^image\//.test(f.mimeType) || ['jpg', 'jpeg', 'png'].includes(e)) return 'image';
  return 'other';
}
// "2026-10-15_Rehab 2nd Floor Layout.pdf" → "Rehab 2nd Floor Layout"
function title(name) {
  return String(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^(\d{4}-\d{2}-\d{2}|\d{8})[_ -]+/, '').replace(/^\d{8}[_ -]+/, '').replace(/_/g, ' ').replace(/^[\s.-]+/, '').replace(/\s{2,}/g, ' ').trim();
}
// Floor number for ordering: basement first, then ground, 1st … 45th, then terrace.
function floorKey(name) {
  const n = up(name);
  if (/BASEMENT|UG TANK|UNDERGROUND/.test(n)) return -1;
  if (/GROUND|GRND|\bGF\b/.test(n)) return 0;
  const m = n.match(/(\d{1,2})\s*(ST|ND|RD|TH)\b/);
  if (m) return +m[1];
  if (/FIRST/.test(n)) return 1; if (/SECOND/.test(n)) return 2; if (/THIRD/.test(n)) return 3; if (/FOURTH/.test(n)) return 4;
  if (/TYP/.test(n)) return 50;
  if (/REFUGE/.test(n)) return 60;
  if (/AMENITY/.test(n)) return 70;
  if (/TERRACE|OHT|OVERHEAD/.test(n)) return 90;
  return 100;
}

function shape(f) {
  const disc = discipline(f.path, f.name);
  const who = f.lastModifyingUser || (f.owners || [])[0] || {};
  return {
    id: f.id, name: f.name, title: title(f.name), kind: kind(f), discipline: disc,
    building: building(f.path, f.name), trade: trade(disc, f.path, f.name),
    folder: f.path.join(' › '), size: f.size ? +f.size : null,
    uploaded: f.createdTime || null, modified: f.modifiedTime || null,
    by: who.displayName || who.emailAddress || '', url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    floor: floorKey(f.name),
  };
}

async function register(fetchImpl = fetch) {
  const files = await walk(fetchImpl);
  return files.map(shape);
}

module.exports = { register, walk, accessToken, shape, title, discipline, building, trade, kind, floorKey, DriveError, ROOT };
