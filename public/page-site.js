// Adapter: gives the Construction page the same small data API it had as a Claude artifact,
// backed by /api/site. Reads come from one GET (refreshed every 45 s and when the tab regains
// focus); writes go to POST /api/site, which checks the role on the server.
(function () {
  const PATHS = { 'data/plan/towers': 'towers', progress: 'progress', dpr: 'dpr', hindrances: 'hindrances', materials: 'materials', works: 'works', pours: 'pours' };
  const Store = { data: null, subs: new Set(), loading: null };
  let me = null;
  async function api(method, payload) {
    let r;
    try { r = await fetch('/api/site', { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined }); }
    catch (e) { throw { code: 'unavailable', message: 'No connection' }; }
    if (r.status === 401) { location.replace('/?next=site'); throw { code: 'unavailable', message: 'Signed out' }; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) { if (method === 'GET') location.replace(j.home || '/'); throw { code: 'invalid_argument', message: j.error || 'Not allowed' }; }
    if (!r.ok) throw { code: r.status >= 500 ? 'unavailable' : 'failed', message: j.error || 'HTTP ' + r.status };
    return j;
  }
  const emit = () => { for (const f of Store.subs) { try { f(); } catch (e) { console.error(e); } } };
  function refresh() {
    if (!Store.loading) Store.loading = api('GET').then((d) => { Store.data = d; Store.loading = null; emit(); return d; }, (e) => { Store.loading = null; throw e; });
    return Store.loading;
  }
  const snap = (col, id) => { const d = Store.data && Store.data[col] && Store.data[col][id]; return { id, exists: !!d, data: () => d, metadata: {} }; };
  function apply(col, id, doc) {
    if (!Store.data) return;
    Store.data[col] = Store.data[col] || {};
    if (doc == null) delete Store.data[col][id]; else Store.data[col][id] = doc;
    emit();
  }
  function docRef(col, id) {
    return {
      id, path: col + '/' + id,
      async get() { if (!Store.data) await refresh(); return snap(col, id); },
      async set(data) { const j = await api('POST', { op: 'set', col, id, data }); apply(col, id, j.doc); },
      async update(data) { const j = await api('POST', { op: 'update', col, id, data }); apply(col, id, j.doc); },
      async delete() { await api('POST', { op: 'delete', col, id }); apply(col, id, null); },
    };
  }
  function query(col, ob, lim) {
    const q = {
      where() { return q; },
      orderBy(f, dir) { return query(col, [f, dir], lim); },
      limit(n) { return query(col, ob, n); },
      docs() {
        let e = Object.keys((Store.data || {})[col] || {}).map((id) => snap(col, id));
        if (ob) e.sort((a, b) => String(a.data()[ob[0]] ?? '').localeCompare(String(b.data()[ob[0]] ?? '')) * (ob[1] === 'desc' ? -1 : 1));
        return lim ? e.slice(0, lim) : e;
      },
      async get() { if (!Store.data) await refresh(); const docs = q.docs(); return { docs, size: docs.length, empty: !docs.length }; },
      onSnapshot(next, err) {
        const f = () => { const docs = q.docs(); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }); };
        Store.subs.add(f);
        if (Store.data) setTimeout(f, 0); else refresh().catch((e) => err && err(e));
        return () => Store.subs.delete(f);
      },
      doc(id) { return docRef(col, id); },
      async add(data) { const j = await api('POST', { op: 'add', col, data }); apply(col, j.id, j.doc); return docRef(col, j.id); },
    };
    return q;
  }
  const db = {
    collection: (p) => query(PATHS[p] || p),
    doc: (p) => { const i = p.lastIndexOf('/'); const c = p.slice(0, i); return docRef(PATHS[c] || c, p.slice(i + 1)); },
  };
  const avatar = (name) => {
    const t = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="15" fill="#E3ECF5"/><text x="15" y="19.5" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="#2B5C8A">${t}</text></svg>`);
  };
  const user = {
    id: async () => me.username,
    isOwner: async () => me.role === 'admin',
    canEdit: async () => me.site === 'admin',
    can: async (n) => (n === 'data.write' ? !!me.site : false),
    profiles: async (ids) => Object.fromEntries([].concat(ids).map((id) => {
      const name = ((Store.data || {}).people || {})[id] || (id === me.username ? me.name : '');
      return [id, { id, name, avatarUrl: avatar(name || id), color: '#2B5C8A', isMe: id === me.username }];
    })),
  };
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: 'saved' };
    },
  };
  let ready = null;
  window.claude = {
    use: async (name) => {
      ready = ready || Shell.init({ module: 'site', modsEl: document.getElementById('shellMods'), userEl: document.getElementById('shellUser') });
      me = await ready;
      if (!me) return null;
      return name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : null;
    },
  };
  // the Today page calls this after a purchase receipt, which the server also writes into the materials log
  window.siteRefresh = () => refresh().catch(() => {});
  setInterval(() => { if (!document.hidden && Store.data) refresh().catch(() => {}); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Store.data) refresh().catch(() => {}); });
})();
