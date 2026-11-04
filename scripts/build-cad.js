// Build step (Vercel only): lists what the CAD viewer packages contain, so the ERP's own viewer page can be wired up.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'public', 'cad', '_probe');
fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', 'node_modules', '@mlightcad');
const list = [];
const walk = (d, rel = '') => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), r = rel + '/' + n; const s = fs.statSync(p); if (s.isDirectory()) { if (n !== 'node_modules') walk(p, r); } else list.push(r + ' ' + s.size); } };
if (fs.existsSync(root)) walk(root);
fs.writeFileSync(path.join(out, 'files.txt'), list.join('\n'));
for (const pkg of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  for (const f of ['package.json', 'README.md']) { const p = path.join(root, pkg, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(out, `${pkg}__${f}`)); }
}
console.log('cad probe:', list.length, 'files');
