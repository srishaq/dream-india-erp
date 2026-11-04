// Build step (Vercel): bundles the open-source CAD viewer (mlightcad, MIT; LibreDWG reader, GPL) into public/cad/,
// so DWG drawings open on the ERP's own pages and the files never go to an outside site.
const fs = require('fs'), path = require('path');
const R = (...p) => path.join(__dirname, '..', ...p);
const out = R('public', 'cad');
fs.mkdirSync(out, { recursive: true });
const pkg = R('node_modules', '@mlightcad', 'cad-simple-viewer');
for (const f of fs.readdirSync(path.join(pkg, 'dist'))) if (/worker|\.wasm$/.test(f)) fs.copyFileSync(path.join(pkg, 'dist', f), path.join(out, f));
// the DWG reader comes with the viewer (nested in its node_modules, or hoisted)
const conv = [path.join(pkg, 'node_modules', '@mlightcad', 'libredwg-converter'), R('node_modules', '@mlightcad', 'libredwg-converter')].find((p) => fs.existsSync(p));
console.log('dwg converter:', conv || 'not found', conv ? require(path.join(conv, 'package.json')).version : '');
if (conv) {
  for (const f of fs.readdirSync(path.join(conv, 'dist'))) if (/worker|\.wasm$/.test(f)) fs.copyFileSync(path.join(conv, 'dist', f), path.join(out, f));
}
// three.js example modules are imported without ".js"; node-only modules (fs) are never used in the browser
const fixes = { name: 'erp-fixes', setup(b) {
  b.onResolve({ filter: /^three\/examples\/jsm\// }, (a) => (a.path.endsWith('.js') ? undefined : { path: require.resolve(a.path + '.js', { paths: [a.resolveDir] }) }));
  b.onResolve({ filter: /^(fs|path|os|crypto)$/ }, () => ({ path: 'empty', namespace: 'empty' }));
  b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports = {};' }));
} };
require('esbuild').build({ entryPoints: [R('scripts', 'cad-entry.js')], bundle: true, format: 'iife', minify: true, outfile: path.join(out, 'viewer.js'), target: 'es2020', logLevel: 'warning', plugins: [fixes] })
  .then(() => console.log('cad viewer built:', fs.readdirSync(out).join(', ')), (e) => { console.error(e.message); process.exit(1); });
