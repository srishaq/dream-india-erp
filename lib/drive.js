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

// The design library of a project (Marketing): every file in the folder and two levels of sub-folders, with the
// sub-folder it sits in, so brochures, floor plans, elevations and renders can be shown by kind.
async function library(folderId) {
  const token = await sheets.accessToken(SCOPE);
  const list = async (id) => {
    const out = []; let page = '';
    do {
      const q = new URLSearchParams({ q: `'${String(id).replace(/'/g, '')}' in parents and trashed = false`, fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, thumbnailLink, webViewLink, iconLink)', pageSize: '500', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(page ? { pageToken: page } : {}) });
      const j = await get(`${API}/files?${q}`, token); out.push(...j.files); page = j.nextPageToken || '';
    } while (page);
    return out;
  };
  const files = [];
  const walk = async (id, path, depth) => {
    for (const f of await list(id)) {
      if (f.mimeType === FOLDER) { if (depth < 3 && files.length < 1500) await walk(f.id, [...path, f.name], depth + 1); }
      else files.push({ id: f.id, name: f.name, mime: f.mimeType, size: +f.size || 0, at: f.modifiedTime, link: f.webViewLink, thumb: !!f.thumbnailLink, folder: path.join(' › ') });
    }
  };
  await walk(folderId, [], 0);
  return files;
}
// A file's small preview picture from Drive.
async function thumbnail(fileId) {
  const token = await sheets.accessToken(SCOPE);
  const f = await get(`${API}/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`, token);
  if (!f.thumbnailLink) return null;
  const r = await fetch(f.thumbnailLink.replace(/=s\d+$/, '=s400'), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return { type: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()) };
}

module.exports = { statementFiles, download, library, thumbnail };
