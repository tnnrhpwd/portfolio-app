/**
 * rev-version.test.js — rev arithmetic shared by build-local.js and release.js.
 *
 * Run: node scripts/rev-version.test.js
 *
 * The prefix case below is the one that actually bit: `isPublished` used to be
 * a substring test, so '1.0.6' looked published whenever 'addon-v1.0.69' existed.
 */

'use strict';

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getRev, incrementRev, versionOf, maxRev, isPublished, readVersion, bumpVersionFiles } = require('./rev-version');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}

console.log('rev-version.test: rev numbering');

test('getRev reads the third semver component', () => {
  assert.strictEqual(getRev('1.0.69'), 69);
  assert.strictEqual(getRev('1.0.0'), 0);
  assert.strictEqual(getRev('2.3.14'), 14);
});

test('getRev tolerates junk without throwing', () => {
  assert.strictEqual(getRev(''), 0);
  assert.strictEqual(getRev(undefined), 0);
  assert.strictEqual(getRev('1.0'), 0);
});

test('incrementRev moves only the rev, carrying across 9 → 10', () => {
  assert.strictEqual(incrementRev('1.0.69'), '1.0.70');
  assert.strictEqual(incrementRev('1.0.9'), '1.0.10');
  assert.strictEqual(incrementRev('1.0.0'), '1.0.1');
});

test('versionOf pulls x.y.z out of a tag name', () => {
  assert.strictEqual(versionOf('addon-v1.0.69'), '1.0.69');
  assert.strictEqual(versionOf('1.0.69'), '1.0.69');
  assert.strictEqual(versionOf('addon-v1.0.7'), '1.0.7');
  assert.strictEqual(versionOf('nonsense'), null);
  assert.strictEqual(versionOf(''), null);
});

test('maxRev compares numerically, not as strings', () => {
  assert.strictEqual(maxRev(['addon-v1.0.7', 'addon-v1.0.69']), 69);
  assert.strictEqual(maxRev(['addon-v1.0.9', 'addon-v1.0.10']), 10);
  assert.strictEqual(maxRev([]), 0);
  assert.strictEqual(maxRev(['unrelated-tag']), 0);
});

test('isPublished matches the whole version, never a prefix', () => {
  const tags = ['addon-v1.0.69', 'addon-v1.0.7'];
  assert.strictEqual(isPublished('1.0.69', tags), true);
  assert.strictEqual(isPublished('1.0.7', tags), true);
  // The trap: '1.0.6' is a string-prefix of '1.0.69' but is its own version.
  assert.strictEqual(isPublished('1.0.6', tags), false);
  assert.strictEqual(isPublished('1.0.70', tags), false);
  assert.strictEqual(isPublished('1.0.69', []), false);
});

test('isPublished is exact about trailing digits', () => {
  assert.strictEqual(isPublished('1.0.7', ['addon-v1.0.70']), false);
  assert.strictEqual(isPublished('1.0.70', ['addon-v1.0.7']), false);
});

test('bumpVersionFiles moves package.json and the lock together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-version-'));
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', version: '1.0.69' }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'),
    JSON.stringify({ name: 'x', version: '1.0.69', packages: { '': { name: 'x', version: '1.0.69' } } }, null, 2) + '\n');

  const written = bumpVersionFiles('1.0.70', dir);

  assert.strictEqual(written.length, 2);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf-8'));
  assert.strictEqual(pkg.version, '1.0.70');
  assert.strictEqual(pkg.name, 'x', 'other package.json fields must survive');
  assert.strictEqual(lock.version, '1.0.70');
  assert.strictEqual(lock.packages[''].version, '1.0.70');
  assert.strictEqual(readVersion(dir), '1.0.70');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bumpVersionFiles tolerates a missing lock file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-version-nolock-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.1' }) + '\n');
  const written = bumpVersionFiles('1.0.2', dir);
  assert.strictEqual(written.length, 1);
  assert.strictEqual(readVersion(dir), '1.0.2');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\nrev-version.test: ${passed}/${passed + failed} PASS`);
process.exit(failed === 0 ? 0 : 1);
