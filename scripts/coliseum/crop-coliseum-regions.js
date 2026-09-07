const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sharp'));

const base = path.join(__dirname, '..', 'docs', 'images', 'Coliseum');
const srcPng = path.join(base, '00ShopDrag.png');
const jsonPath = path.join(base, '00ShopDrag.json');
const outDir = path.join(base, 'items');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const regions = data.regions;
  for (const region of regions) {
    const left = Math.round(region.x);
    const top = Math.round(region.y);
    const width = Math.round(region.w);
    const height = Math.round(region.h);
    const outFile = path.join(outDir, sanitize(region.name) + '.png');
    await sharp(srcPng)
      .extract({ left, top, width, height })
      .toFile(outFile);
    console.log('wrote', path.basename(outFile), `(${width}x${height})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
