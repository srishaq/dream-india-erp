// Build step (Vercel): bundles the open-source CAD viewer (mlightcad, MIT; LibreDWG reader, GPL) into public/cad/,
// so DWG drawings open on the ERP's own pages and the files never go to an outside site.
const fs = require('fs'), path = require('path');
const R = (...p) => path.join(__dirname, '..', ...p);
const out = R('public', 'cad');
fs.mkdirSync(path.join(out, '_probe'), { recursive: true });
const pkg = R('node_modules', '@mlightcad', 'cad-simple-viewer');
for (const f of ['libredwg-parser-worker.js', 'mtext-renderer-worker.js']) fs.copyFileSync(path.join(pkg, 'dist', f), path.join(out, f));
for (const f of ['app/AcApDocManager.d.ts', 'app/AcDbOpenDatabaseOptions.d.ts', 'app/AcApFontLoader.js', 'app/AcApDocManager.js']) {
  const p = path.join(pkg, 'lib', f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(out, '_probe', f.replace('/', '__')));
}
require('esbuild').buildSync({ entryPoints: [R('scripts', 'cad-entry.js')], bundle: true, format: 'iife', minify: true, outfile: path.join(out, 'viewer.js'), target: 'es2020', logLevel: 'warning' });
console.log('cad viewer built:', fs.readdirSync(out).join(', '));
