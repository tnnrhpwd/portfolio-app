#!/usr/bin/env node
/* Throwaway: work out whether sharp can rasterise SVG in this install. */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'sharp'));

const A = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets');
const TRIVIAL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>',
);

const CASES = [
  ['trivial buffer', TRIVIAL, {}],
  ['full master buffer', fs.readFileSync(path.join(A, 'brand-mark.svg')), {}],
  ['compact master buffer', fs.readFileSync(path.join(A, 'brand-mark-compact.svg')), {}],
  ['full master buffer + density', fs.readFileSync(path.join(A, 'brand-mark.svg')), { density: 288 }],
];

(async () => {
  for (const [label, input, opts] of CASES) {
    try {
      const buf = await sharp(input, opts).resize(16, 16).png().toBuffer();
      console.log(`OK   ${label} -> ${buf.length}B`);
    } catch (e) {
      console.log(`FAIL ${label} -> ${e.message}`);
    }
  }
})();
