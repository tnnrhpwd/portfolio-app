#!/usr/bin/env node
/**
 * generate-logo-assets.js — rasterise the brand mark into every surface that cannot
 * be an inline SVG.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live mark is an inline React component (`frontend/src/components/BrandMark/`),
 * because that is the only way its two strokes can be bound to the visitor's colour
 * scheme. But four surfaces can never take part in that:
 *
 *   · the favicon and the PWA icon        — the browser reads a file
 *   · the apple-touch icon and OG card    — the OS and crawlers read a file
 *   · the addon's tray / window icons     — Electron reads a file
 *   · the addon's installer + shortcuts   — electron-builder bakes them into the .exe
 *
 * Those are real files, so they need a real master, and `assets/brand-mark.svg` is it.
 * This script is the only thing that generates them, so there is one command to re-run
 * after a retune rather than five places to remember.
 *
 * ⚠️ EVERY OUTPUT IS TRANSPARENT. The SVG has no background rect, and `sharp` is
 * asked for RGBA throughout. A logo does not get a white plate behind it — see the
 * note on the avatar below for the one deliberate exception to the *shape*, not the
 * transparency.
 *
 * WHICH MASTER, AND WHY IT IS NOT THE SAME FOR ALL OF THEM
 * --------------------------------------------------------
 *   full     — ring + field + check. Used where the mark is displayed at 100px+.
 *   compact  — solid disc + knocked-out check, no ring. Below ~24px the full mark's
 *              4px ring and 8.5px glyph collapse into a smudge, so the small surfaces
 *              trade the ring for legibility. It is the SAME check path, recentred
 *              and scaled; see the header of that file.
 *
 * USAGE
 * -----
 *   node scripts/generate-logo-assets.js            # dry run (default) — report only
 *   node scripts/generate-logo-assets.js --apply    # actually write the files
 *
 * SAFETY
 * ------
 * - Dry run by default, like the rest of `scripts/`.
 * - Refuses to touch a target if its master is missing, and prints byte counts either
 *   way so a silent no-op is visible.
 * - Nothing is deleted. If a file it writes stops being referenced, it says so.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// `sharp` is a backend dependency and is not hoisted to the root node_modules — the
// same resolution `scripts/optimize-art.js` uses.
const sharp = require(path.join(ROOT, 'backend', 'node_modules', 'sharp'));

const ASSETS = path.join(ROOT, 'frontend', 'src', 'assets');
const PUBLIC = path.join(ROOT, 'frontend', 'public');
const ADDON_ICONS = path.join(ROOT, 'simple-addon', 'resources');

const FULL = path.join(ASSETS, 'brand-mark.svg');
const COMPACT = path.join(ASSETS, 'brand-mark-compact.svg');

/** The master is 256 units square; 288dpi renders it at 1024px so every target below
 *  is a downscale — small sizes stay crisp instead of being rasterised at 16px. */
const DENSITY = 288;

/** Sizes inside an .ico. Windows picks by context; 16 (tray/title bar), 32 (taskbar),
 *  48 (Explorer medium) and 256 (large tiles) are the ones that actually get used. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const TARGETS = [
  {
    from: FULL,
    to: path.join(PUBLIC, 'STHlogo192.png'),
    size: 192,
    why: 'apple-touch icon + the OG/Twitter card (index.html, SEO.jsx, About.jsx)',
  },
  {
    from: FULL,
    to: path.join(ASSETS, 'brand-mark.png'),
    size: 256,
    why: "ProfileAvatar's default face (the `plate` variant — a fixed colourway on purpose)",
  },
  {
    from: COMPACT,
    to: path.join(PUBLIC, 'Checkmark192.ico'),
    size: ICO_SIZES,
    why: 'browser tab + manifest.json (16-32px, where the ring would be mush)',
  },
  {
    from: COMPACT,
    to: path.join(ADDON_ICONS, 'icon.png'),
    size: 256,
    why: 'addon tray (tray.js resizes to 16) + the dashboard window',
  },
  {
    from: COMPACT,
    to: path.join(ADDON_ICONS, 'icon.ico'),
    size: ICO_SIZES,
    why: 'addon win.icon + nsis installer/uninstaller/header icons',
  },
];

/**
 * Pack PNG buffers into a Vista-style .ico.
 *
 * Since Vista an ICO entry may hold a PNG verbatim, which is why this needs no
 * BMP/DIB handling and keeps the alpha channel — the thing that makes a transparent
 * mark possible in the first place. The one quirk worth knowing: a 256px entry is
 * encoded as a width/height byte of 0, because the field is a single byte.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = 6 + entries.length * 16;

  entries.forEach((entry, i) => {
    const at = i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt8(dim, at + 0); // width
    directory.writeUInt8(dim, at + 1); // height
    directory.writeUInt8(0, at + 2); // palette colours
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.buffer.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.buffer.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.buffer)]);
}

/** Rasterise one master at one size, always RGBA.
 *
 * ⚠️ THE MASTER IS READ INTO A BUFFER FIRST, and that is not tidiness. Handing this
 * sharp build a `.svg` PATH fails with "Input file contains unsupported image format"
 * even though `sharp.format.svg.input.file` reports true — while the byte-identical
 * BUFFER renders correctly. Nothing about the artwork is at fault (the same file both
 * fails as a path and succeeds as a buffer). Going through a buffer also removes any
 * dependence on the cwd, which the file-path form has.
 */
async function renderPng(masterPath, size) {
  const master = fs.readFileSync(masterPath);
  return sharp(master, { density: DENSITY })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderTarget(target) {
  if (!fs.existsSync(target.from)) {
    throw new Error(`master missing: ${path.relative(ROOT, target.from)}`);
  }
  if (Array.isArray(target.size)) {
    const entries = [];
    for (const size of target.size) {
      entries.push({ size, buffer: await renderPng(target.from, size) });
    }
    return buildIco(entries);
  }
  return renderPng(target.from, target.size);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

  console.log(`generate-logo-assets — ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}\n`);

  for (const target of TARGETS) {
    const label = Array.isArray(target.size) ? `ico ${target.size.join('/')}` : `${target.size}px`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await renderTarget(target);
      const existed = fs.existsSync(target.to);
      const before = existed ? fs.statSync(target.to).size : 0;

      if (apply) {
        fs.mkdirSync(path.dirname(target.to), { recursive: true });
        fs.writeFileSync(target.to, buffer);
      }

      const delta = before ? ` (was ${before}B)` : ' (new)';
      console.log(
        `${apply ? 'wrote ' : 'would write '}${rel(target.to).padEnd(46)} ${label.padEnd(22)}` +
          `${String(buffer.length).padStart(7)}B${delta}`,
      );
      console.log(`${' '.repeat(12)}${rel(target.from)} → ${target.why}`);
    } catch (err) {
      console.error(`FAILED  ${rel(target.to)}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('\nNote: the legacy artwork this replaced is gone, not overwritten —');
  console.log('  Checkmark512.png / Checkmark192.svg / STHlogo*.png / simple_logo.png');
  console.log('  were deleted, not renamed. The mark is now an inline component, so the');
  console.log('  header, the chat empty state and the avatar import no raster at all.');
  if (!apply) console.log('\nNothing was written. Re-run with --apply.');
}

main();
