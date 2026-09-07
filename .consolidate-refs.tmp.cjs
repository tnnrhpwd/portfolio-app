const fs = require('fs');
const path = require('path');

const roots = ['backend', path.join('simple-addon', 'server')];
const old = 'docs/new/simple-agent-prompt.md';
const neu = 'docs/implementation/simple-agent-prompt.md';
const SKIP = new Set(['node_modules', '.git', 'coverage', 'build', 'dist', 'storage', 'logs', 'uploads']);

let filesChanged = 0;
let total = 0;

function walk(d) {
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); }
  catch (e) { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(p);
    } else if (/\.(js|json|md)$/.test(entry.name)) {
      let t;
      try { t = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
      if (t.includes(old)) {
        const n = t.split(old).join(neu);
        try {
          fs.writeFileSync(p, n, 'utf8');
          const c = t.split(old).length - 1;
          total += c;
          filesChanged++;
          console.log(c + '  ' + p);
        } catch (e) { console.log('WRITE FAIL ' + p + ' : ' + e.message); }
      }
    }
  }
}

roots.forEach(walk);
console.log('files changed: ' + filesChanged + ', total replacements: ' + total);
