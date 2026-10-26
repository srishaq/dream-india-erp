// Google Drive (read only) with the same service account as the sheets. The folders must be shared with the
// service account as Viewer. Used to fetch the daily bank statement files.
const sheets = require('./sheets');

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET = 'application/vnd.google-apps.spreadsheet';
const FOLDER = 'application/vnd.google-apps.folder';

async function get(url, token, binary) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = res.status; try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* not json */ }
    if (res.status === 404 || res.status === 403) throw Object.assign(new Error(`Google Drive: the folder or file is not shared with ${sheets.serviceEmail()} (${msg}).`), { status: 400 });
    throw Object.assign(new Error(`Google Drive: ${msg}`), { status: 502 });
  }
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function children(folderId, token) {
  const out = []; let page = '';
  do {
    const q = new URLSearchParams({ q: `'${folderId.replace(/'/g, '')}' in parents and trashed = false`, fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(page ? { pageToken: page } : {}) });
    const j = await get(`${API}/files?${q}`, token);
    out.push(...j.files); page = j.nextPageToken || '';
  } while (page);
  return out;
}

// Statement files (.xlsx or Google Sheets) in the folders and one level of sub-folders, newest first.
async function statementFiles(folderIds) {
  const token = await sheets.accessToken(SCOPE);
  const files = [];
  for (const id of folderIds) {
    for (const f of await children(id, token)) {
      if (f.mimeType === FOLDER) { for (const g of await children(f.id, token)) if (g.mimeType === XLSX || g.mimeType === GSHEET) files.push({ ...g, folder: f.name }); }
      else if (f.mimeType === XLSX || f.mimeType === GSHEET || /\.xlsx$/i.test(f.name)) files.push(f);
    }
  }
  return files.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
}

async function download(f) {
  const token = await sheets.accessToken(SCOPE);
  if (f.mimeType === GSHEET) return get(`${API}/files/${f.id}/export?mimeType=${encodeURIComponent(XLSX)}`, token, true);
  return get(`${API}/files/${f.id}?alt=media&supportsAllDrives=true`, token, true);
}

module.exports = { statementFiles, download };
