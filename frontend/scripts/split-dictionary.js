#!/usr/bin/env node
/**
 * split-dictionary.js — partition the Wordle word list by word length.
 *
 * WHY
 * ---
 * `Dictionary.txt` is 178,686 words (1.7 MB raw) covering every length from 2 to
 * 15. Both consumers only ever use ONE length at a time:
 *   - WordleSolver hard-caps at `MIN_LEN = 3 / MAX_LEN = 8`, so lengths 9-15 —
 *     ~95,000 words, over half the file — are unreachable from that page.
 *   - Wordle validates a guess by length and defaults to 5.
 * Shipping the whole list meant a 5-letter game downloaded 178,686 words to use
 * 8,938 of them (~5% of the payload).
 *
 * Splitting is safe because nothing needs cross-length lookup: the solver
 * filters `w.length === wordLength` and Wordle checks membership of a guess that
 * is already `wordLength` characters long.
 *
 * The split files become the app's source of truth (`--join` rebuilds a single
 * file if you want to edit the list in bulk, then re-run without `--join`).
 *
 * USAGE
 * -----
 *   node frontend/scripts/split-dictionary.js              # report only (dry run)
 *   node frontend/scripts/split-dictionary.js --apply      # write dictionary/words-<len>.txt
 *   node frontend/scripts/split-dictionary.js --join       # rebuild Dictionary.txt from the parts
 *
 * Sizes are reported raw + gzip + brotli so you can see what actually crosses
 * the wire (Netlify compresses text assets; browsers decode gzip/brotli for free).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HERE = path.join(__dirname, '..', 'src', 'pages', 'Projects', 'WordleSolver');
const SOURCE = path.join(HERE, 'Dictionary.txt');
const OUT_DIR = path.join(HERE, 'dictionary');

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Read the source list, normalised to upper-case trimmed words. */
function readSource() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source not found: ${SOURCE}\nRun with --join first to rebuild it from the parts.`);
    process.exit(1);
  }
  return fs
    .readFileSync(SOURCE, 'utf8')
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** All words of one length, in file order. */
function slice(words, length) {
  return words.filter((w) => w.length === length);
}

function join(words) {
  return words.join('\n') + '\n';
}

function report(label, text) {
  const raw = Buffer.byteLength(text, 'utf8');
  const gz = zlib.gzipSync(text).length;
  let br = 0;
  try {
    br = zlib.brotliCompressSync(text).length;
  } catch {
    br = NaN;
  }
  console.log(
    `  ${label.padEnd(12)} raw=${kb(raw).padStart(8)}  gzip=${kb(gz).padStart(8)}  brotli=${kb(br).padStart(8)}`,
  );
  return { raw, gz, br };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const doJoin = args.includes('--join');

  if (doJoin) {
    if (!fs.existsSync(OUT_DIR)) {
      console.error(`No split files at ${OUT_DIR} to join.`);
      process.exit(1);
    }
    const parts = fs
      .readdirSync(OUT_DIR)
      .filter((f) => /^words-\d+\.txt$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const all = parts.flatMap((f) =>
      fs
        .readFileSync(path.join(OUT_DIR, f), 'utf8')
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean),
    );
    fs.writeFileSync(SOURCE, join(all));
    console.log(`Joined ${parts.length} parts → ${path.relative(process.cwd(), SOURCE)} (${all.length} words)`);
    return;
  }

  const words = readSource();
  const lengths = [...new Set(words.map((w) => w.length))].sort((a, b) => a - b);

  console.log(`\n${apply ? 'SPLITTING' : 'DRY RUN — nothing written'}`);
  console.log(`source: ${path.relative(process.cwd(), SOURCE)}  (${words.length} words)\n`);

  console.log('  --- whole file ---');
  const whole = report(`all (${words.length})`, join(words));

  console.log('\n  --- per length ---');
  const parts = [];
  for (const len of lengths) {
    const subset = slice(words, len);
    const text = join(subset);
    const size = report(`len=${len} (${subset.length})`, text);
    parts.push({ len, subset, text, size });
  }

  // What the two pages actually need.
  const solverLengths = [3, 4, 5, 6, 7, 8]; // WordleSolver MIN_LEN..MAX_LEN
  const solverGz = parts.filter((p) => solverLengths.includes(p.len)).reduce((n, p) => n + p.size.gz, 0);
  const five = parts.find((p) => p.len === 5);

  console.log('\n  --- what actually gets used ---');
  if (five) {
    console.log(
      `  Wordle @ 5 letters:  ${kb(five.size.gz)} gzip vs ${kb(whole.gz)} today  ` +
        `(${Math.round((1 - five.size.gz / whole.gz) * 100)}% smaller)`,
    );
  }
  console.log(
    `  Solver (3-8) worst case if every length is opened: ${kb(solverGz)} gzip total; ` +
      `any single length is far less.`,
  );
  console.log(`  Lengths 9-15 (${parts.filter((p) => p.len > 8).reduce((n, p) => n + p.subset.length, 0)} words) ` +
    `are unreachable from WordleSolver.\n`);

  if (!apply) {
    console.log('  Re-run with --apply to write the split files.\n');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Prune stale parts so a changed length set can't leave orphans behind.
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (/^words-\d+\.txt$/.test(f) && !parts.some((p) => f === `words-${p.len}.txt`)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log(`  pruned stale ${f}`);
    }
  }
  for (const p of parts) {
    fs.writeFileSync(path.join(OUT_DIR, `words-${p.len}.txt`), p.text);
  }
  console.log(`\n  Wrote ${parts.length} files to ${path.relative(process.cwd(), OUT_DIR)}/\n`);
}

main();
