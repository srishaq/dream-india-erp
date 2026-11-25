// The Signature CRM's shared Drive folder of flat files, copied onto the flats in Customer documents.
// DATABASE_URL=postgres://... node scripts/test-custdocs-import.js   (an empty database; Google Drive is faked)
require('./login-code-helper');
const assert = require('assert/strict');
const path = require('path');
process.env.PORT = process.env.PORT || '3996';
process.env.IMPORT_FIXTURE = path.join(__dirname, 'fixtures/crm-sample.js');
require('./dev-server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
function client() {
  let cookie = '';
  return async (p, body) => {
    const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
}
let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

// ---- a fake Google: the service account's view of the CRM folder, and the ERP's own documents Drive ----
const sheets = require('../lib/sheets'); sheets.accessToken = async () => 'sa-token'; sheets.serviceEmail = () => 'erp@test.iam';
const gd = require('../lib/gdrive');
const saved = [];
gd.status = async () => ({ connected: true });
gd.folder = async (k) => 'folder-' + k;
gd.startUpload = async ({ name, parent }) => `session:${parent}:${name}`;
gd.putPart = async (url, buf) => { saved.push({ url, size: buf.length }); return { done: true, id: 'erp-file-' + saved.length }; };
const FILES = { root: [], sub: [] };
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://www.googleapis.com/drive/v3/files')) return realFetch(url, opts);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('alt=media')) { const id = decodeURIComponent(u.split('/files/')[1].split('?')[0]); if (id === 'broken') return new Response('{"error":{"message":"gone"}}', { status: 500 }); return new Response(Buffer.from('PDF-' + id)); }
  const q = new URL(u).searchParams.get('q');
  if (q.includes("'crm-root'")) return json({ files: FILES.root });
  if (q.includes("'sub-b'")) return json({ files: FILES.sub });
  return json({ files: [] });
};
process.env.SIGNATURE_DOCS_FOLDER = 'crm-root';

(async () => {
  const admin = client();
  await admin('/api/session', { action: 'setup', name: 'Admin', username: 'admin', password: 'admin-password-1' });
  const sig = (await admin('/api/masters')).projects.find((p) => p.code === 'SIGNATURE');
  const pv = await admin('/api/import', { action: 'preview', projectId: sig.id });
  const cm = await admin('/api/import', { action: 'commit', projectId: sig.id, stageDates: { ...pv.stageDates, 'B|On Completion of Excavation': '2026-05-15' } }); assert.equal(cm.ok, true, JSON.stringify(cm).slice(0, 300));
  const bks = await db.q(`select b.id, u.unit_no from bookings b join units u on u.id = b.unit_id where u.project_id = $1 and b.status in ('pending', 'active') order by b.id`, [sig.id]);
  const [b1, b2] = bks;
  const free = await db.one(`select unit_no from units u where project_id = $1 and not exists (select 1 from bookings b where b.unit_id = u.id and b.status in ('pending', 'active')) limit 1`, [sig.id]);
  const spaced = (unit) => unit.replace(/^([A-Z])-?(\d+)$/, '$1 $2');
  FILES.root = [
    { id: 'f1', name: `DREAM SIGNATURE ${spaced(b1.unit_no)}.pdf`, mimeType: 'application/pdf', size: '9' },
    { id: 'f2', name: `${b1.unit_no} Index II.pdf`, mimeType: 'application/pdf', size: '9' },
    { id: 'f3', name: `DREAM SIGNATURE ${spaced(free.unit_no)}.pdf`, mimeType: 'application/pdf', size: '9' },
    { id: 'f4', name: 'scan 0001.pdf', mimeType: 'application/pdf', size: '9' },
    { id: 'f5', name: 'notes.zip', mimeType: 'application/zip', size: '9' },
    { id: 'sub-b', name: `${spaced(b2.unit_no)} - buyer papers`, mimeType: 'application/vnd.google-apps.folder' },
  ];
  FILES.sub = [{ id: 'f6', name: 'PAN card.jpg', mimeType: 'image/jpeg', size: '9' }];

  await step('The flat and the kind of paper are read from the file name', async () => {
    const I = require('../lib/custdocs-import');
    assert.equal(I.flatOf('DREAM SIGNATURE B 2402.pdf'), 'B2402');
    assert.equal(I.flatOf('A-1001 agreement.pdf'), 'A1001');
    assert.equal(I.flatOf('scan 0001.pdf'), null);
    assert.equal(I.kindOf('DREAM SIGNATURE B 2402.pdf'), 'Agreement for sale (registered)', 'the registration set');
    assert.equal(I.kindOf('B 2402 Index II.pdf'), 'Index II / registration receipt');
    assert.equal(I.kindOf('PAN card.jpg'), 'KYC: PAN, Aadhaar, photo');
    assert.equal(I.kindOf('B 2402 bank NOC.pdf'), 'Home loan sanction / bank NOC');
    assert.equal(I.kindOf('B 2402 misc.pdf'), 'Other');
  });

  await step('The page shows what is new and what needs a look', async () => {
    const c = await admin(`/api/custdocs?crmfolder=${sig.id}`);
    assert.equal(c.available, true, c.error);
    assert.equal(c.total, 6); assert.equal(c.ready, 3, 'two for one flat, one in the flat sub-folder');
    assert.equal(c.noBooking.length, 1); assert.equal(c.noFlat.length, 1); assert.equal(c.skipped.length, 1);
    assert.equal(c.kinds['Agreement for sale (registered)'], 1);
  });

  await step('Bringing them in puts each file on its flat, once', async () => {
    const r = await admin('/api/custdocs', { action: 'crmfolder', projectId: sig.id });
    assert.equal(r.ok, true, r.error); assert.equal(r.imported, 3); assert.equal(r.left, 0);
    const docs = await db.q('select booking_id, kind, file_name, title, status, size, source_id from customer_docs order by id');
    assert.equal(docs.length, 3);
    assert.ok(docs.every((d) => d.status === 'ready' && d.title === 'From the CRM folder'));
    assert.equal(docs.filter((d) => d.booking_id === b1.id).length, 2);
    assert.equal(docs.find((d) => d.source_id === 'f6').booking_id, b2.id, 'flat read from the sub-folder name');
    assert.equal(docs.find((d) => d.source_id === 'f6').kind, 'KYC: PAN, Aadhaar, photo');
    assert.ok(saved[0].url.includes(`folder-booking:${b1.id}`), 'saved in the flat\'s own folder');
    const list = await admin(`/api/custdocs?booking=${b1.id}`);
    assert.equal(list.rows.length, 2, 'listed on the booking');
    const again = await admin('/api/custdocs', { action: 'crmfolder', projectId: sig.id });
    assert.equal(again.imported, 0); assert.equal(saved.length, 3, 'nothing copied twice');
    assert.equal((await admin(`/api/custdocs?crmfolder=${sig.id}`)).already, 3);
  });

  await step('A file Drive cannot give is reported and tried again next time; removed files are not brought back', async () => {
    FILES.root.push({ id: 'broken', name: `${b2.unit_no} allotment.pdf`, mimeType: 'application/pdf', size: '9' });
    const r = await admin('/api/custdocs', { action: 'crmfolder', projectId: sig.id });
    assert.equal(r.imported, 0); assert.equal(r.failed.length, 1);
    await db.q("update customer_docs set status = 'removed' where source_id = 'f2'");
    assert.equal((await admin(`/api/custdocs?crmfolder=${sig.id}`)).ready, 1, 'only the broken one is still new');
  });

  await step('Only Dream Signature, and only logins that add buyer documents', async () => {
    await db.q("insert into users (username, name, role, password_hash, all_projects, must_change) values ('site', 'Site', 'site_engineer', $1, true, false)", [require('../lib/auth').hashPassword('pass-word-123')]);
    const site = client(); await site('/api/session', { action: 'login', username: 'site', password: 'pass-word-123' });
    assert.equal((await site(`/api/custdocs?crmfolder=${sig.id}`)).status, 403);
    const other = await db.one("insert into projects (code, name, company_id) select 'OTHER', 'Other', company_id from projects where code = 'SIGNATURE' returning id");
    await db.q('update users set all_projects = true where username = $1', ['admin']);
    assert.equal((await admin(`/api/custdocs?crmfolder=${other.id}`)).available, false);
  });

  console.log(`\n${n} checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
