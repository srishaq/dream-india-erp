// The ERP's own CAD viewer page: /cad?f=<Drive file id>. The ERP streams the DWG from Drive (15-minute link)
// and the viewer reads it here, in the browser. Nothing is sent to any outside site.
(async () => {
  const $ = (s) => document.querySelector(s);
  const msg = (t, err) => { const m = $('#msg'); m.textContent = t; m.className = err ? 'err' : ''; m.hidden = !t; };
  const id = new URLSearchParams(location.search).get('f');
  if (!id) return msg('No drawing chosen. Go back to Drawings and pick one.', true);
  try {
    const r = await fetch(`/api/portal?drawings=1&cadLink=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/'; return; }
    if (!r.ok || !j.file) throw new Error(j.error || 'Could not open the drawing.');
    const name = decodeURIComponent((j.file.match(/[?&]name=([^&]+)/) || [])[1] || 'Drawing');
    $('#name').textContent = name; document.title = name + ' · Dream India ERP';
    $('#dl').hidden = false; $('#dl').onclick = () => { location.href = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`; };
    window.ERPCad.useDwgWorker('/cad/libredwg-parser-worker.js');
    const mgr = window.ERPCad.AcApDocManager.createInstance({ container: $('#view'), autoResize: true, webworkerFileUrls: { mtextRender: '/cad/mtext-renderer-worker.js', dwgParser: '/cad/libredwg-parser-worker.js' }, builtinOpenFileDialog: false, notificationCenter: false });
    window.ERPCad.useDwgWorker('/cad/libredwg-parser-worker.js'); // again after start-up, in case the viewer registered its own
    const ok = await mgr.openUrl(j.file);
    if (!ok) throw new Error('This drawing could not be read in the browser. Use Download to open it in AutoCAD, or open its PDF.');
    msg('');
    $('#fit').hidden = false; $('#fit').onclick = () => { try { mgr.sendStringToExecute('zoom e\n'); } catch {} };
  } catch (e) { console.error(e); msg(e.message || 'Could not open the drawing.', true); }
})();
