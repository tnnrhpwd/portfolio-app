/**
 * MP3 encoding via the bundled lamejs package.
 *
 * lamejs@1.2.1 ships a modular CommonJS build (src/js/index.js) whose files
 * reference each other as globals (MPEGMode, Lame, …), so `require('lamejs')`
 * throws at encode time. The package also ships a single-file concatenated
 * bundle (lame.all.js) that defines everything in one scope — we load that
 * in an isolated scope and export the resulting `lamejs` function.
 */

const fs = require('fs');

let _lamejs = null;

function getLamejs() {
  if (_lamejs) return _lamejs;
  const bundlePath = require.resolve('lamejs/lame.all.js');
  const code = fs.readFileSync(bundlePath, 'utf-8');
  const mod = { exports: {} };
  // The bundle ends by invoking `lamejs();`, which attaches Mp3Encoder to the
  // `lamejs` function object. Append an export so we can grab it.
  const run = new Function('module', 'exports', 'require', code + '\nmodule.exports = lamejs;');
  run(mod, mod.exports, require);
  _lamejs = mod.exports;
  return _lamejs;
}

module.exports = { getLamejs };
