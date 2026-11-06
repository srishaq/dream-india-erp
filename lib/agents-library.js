// Our past Instagram photos and videos copied into the Canva library (Uploads), a few at a time,
// so the team (and future designs) can reuse real site photos, renders and reel footage.
// Only the accounts the AI Agent Team learns from (Owner settings → learnFrom) are copied.
const db = require('./db');

const MAX_BYTES = 200 * 1024 * 1024;

async function fetchBuf(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('download ' + r.status);
  const len = +r.headers.get('content-length') || 0;
  if (len > MAX_BYTES) throw new Error('too big');
  return Buffer.from(await r.arrayBuffer());
}

// The current download links of an Instagram post (they expire, so they are read fresh), one per photo or video.
async function igFiles(S, token, id) {
  const j = await S.graph(`/${id}`, { fields: 'media_type,media_url,thumbnail_url,timestamp,children{media_type,media_url}' }, token);
  const kids = j.children && j.children.data && j.children.data.length ? j.children.data : [j];
  return kids.filter((k) => k.media_url).map((k) => ({ url: k.media_url, video: k.media_type === 'VIDEO' }));
}

async function copyToCanva({ max = 3, budgetMs = 80000 } = {}) {
  const T = require('./mkt-tools'), S = require('./social'), A = require('./agents');
  const st = await T.canvaStatus().catch(() => ({}));
  if (!st.connected) return { skipped: 'Canva not connected' };
  const learn = (await A.settingsOf('company')).owner.learnFrom || null;
  const pages = await S.metaPages();
  const tokenFor = (acct) => { const p = pages.find((x) => x.ig && x.ig.username === acct); return p ? p.token : null; };
  const rows = await db.q(`select m.ext_id, m.account, m.kind, m.posted_at, m.caption from mkt_media m
      left join ag_canva_assets c on c.network = m.network and c.ext_id = m.ext_id
      where m.network = 'instagram' and ($1::text[] is null or m.account = any($1)) and (c.ext_id is null or (cardinality(c.asset_ids) = 0 and c.tries < 3))
      order by m.posted_at desc limit $2`, [learn, max]);
  const t0 = Date.now(), out = { copied: 0, files: 0, failed: 0 };
  for (const m of rows) {
    if (Date.now() - t0 > budgetMs) break;
    const tok = tokenFor(m.account);
    try {
      if (!tok) throw new Error('no page token for ' + m.account);
      const files = await igFiles(S, tok, m.ext_id), ids = [];
      const day = new Date(m.posted_at).toISOString().slice(0, 10);
      const words = String(m.caption || '').replace(/[#@]\S+/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
      for (const [i, f] of files.entries()) {
        const buf = await fetchBuf(f.url);
        ids.push(await T.canvaUpload(buf, `IG ${day} ${m.kind}${files.length > 1 ? ' ' + (i + 1) : ''} ${words}`.trim()));
        out.files++;
      }
      await db.q(`insert into ag_canva_assets (network, ext_id, asset_ids, tries, error, at) values ('instagram', $1, $2, 1, null, now())
          on conflict (network, ext_id) do update set asset_ids = excluded.asset_ids, tries = ag_canva_assets.tries + 1, error = null, at = now()`, [m.ext_id, ids.filter(Boolean)]);
      out.copied++;
    } catch (e) {
      out.failed++;
      if (/asset:write|scope|403/.test(e.message)) { out.error = 'Canva needs the upload permission: reconnect Canva in Sales & Marketing → Set-up.'; break; }
      await db.q(`insert into ag_canva_assets (network, ext_id, tries, error, at) values ('instagram', $1, 1, $2, now())
          on conflict (network, ext_id) do update set tries = ag_canva_assets.tries + 1, error = excluded.error, at = now()`, [m.ext_id, String(e.message).slice(0, 300)]);
    }
  }
  const left = await db.one(`select count(*)::int as n from mkt_media m left join ag_canva_assets c on c.network = m.network and c.ext_id = m.ext_id
      where m.network = 'instagram' and ($1::text[] is null or m.account = any($1)) and (c.ext_id is null or (cardinality(c.asset_ids) = 0 and c.tries < 3))`, [learn]);
  out.left = left ? left.n : 0;
  if (out.copied) await A.say('company', 'creative', null, `Copied ${out.copied} past Instagram post${out.copied === 1 ? '' : 's'} (${out.files} file${out.files === 1 ? '' : 's'}) into the Canva library; ${out.left} to go.`, 'say');
  return out;
}

module.exports = { copyToCanva };
