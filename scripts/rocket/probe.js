const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'sharp'));
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120">
  <rect width="420" height="120" fill="#222"/>
  <rect x="10" y="10" width="120" height="100" fill="none" stroke="#0f0" stroke-width="3"/>
  <text x="145" y="55" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#fff">crystal-large</text>
  <text x="145" y="95" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#8cf">512 x 384</text>
</svg>`);
sharp(svg).png().toFile(path.join(__dirname, 'probe-text.png'))
  .then(i => console.log('OK svg-text render ->', i.width + 'x' + i.height, i.size + ' bytes'))
  .catch(e => console.log('SVG TEXT FAILED:', e.message));
