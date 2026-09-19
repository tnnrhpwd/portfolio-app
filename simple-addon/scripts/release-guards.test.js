/**
 * release-guards.test.js — the gate that decides what gets published.
 *
 * Run: node scripts/release-guards.test.js
 *
 * The flow this protects: `npm run build:local` builds and installs the next rev
 * on this machine; `npm run publish:rev` then tags that rev so CI builds it for
 * everyone. The gate exists so a rev can't go out that was never built here —
 * and so requiring this module can never publish anything by accident.
 */

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}

// Requiring release.js must be inert: it is shelled out to and required by tests,
// and a stray main() here would tag and push a release to every installed addon.
const logged = [];
const originalLog = console.log;
console.log = (...args) => logged.push(args.join(' '));
let release;
try {
  release = require('../release');
} finally {
  console.log = originalLog;
}

console.log('release-guards.test: publish gate');

test('requiring release.js does not run the release', () => {
  const output = logged.join('\n');
  assert.ok(!/Simple Addon Release|Publishing the rev|Creating tag/.test(output),
    `require() printed release output:\n${output}`);
});

test('the guards are exported for testing', () => {
  assert.strictEqual(typeof release.evaluatePublish, 'function');
  assert.strictEqual(typeof release.addonTags, 'function');
  assert.strictEqual(typeof release.readBuildInfo, 'function');
});

const BUILT_AT = '2026-09-19T18:00:00.000Z';
const BUILT_MS = new Date(BUILT_AT).getTime();

test('a matching local build is allowed through', () => {
  const { stop, notes, problems } = release.evaluatePublish('1.0.70',
    { version: '1.0.70', rev: 70, channel: 'local', builtAt: BUILT_AT }, BUILT_MS - 60_000);
  assert.strictEqual(stop, null);
  assert.strictEqual(problems.length, 0);
  assert.ok(notes.some((n) => n.includes('rev 70')), `notes should name the rev: ${JSON.stringify(notes)}`);
});

test('publishing a rev that was built as a DIFFERENT rev is blocked', () => {
  const { stop } = release.evaluatePublish('1.0.71',
    { version: '1.0.70', rev: 70, channel: 'local', builtAt: BUILT_AT }, BUILT_MS - 60_000);
  assert.ok(stop, 'expected a hard stop');
  assert.ok(/rev 70/.test(stop) && /1\.0\.71/.test(stop),
    `stop should name both revs: ${stop}`);
});

test('a missing build-info.json warns but does not block', () => {
  const { stop, notes } = release.evaluatePublish('1.0.70', null, BUILT_MS);
  assert.strictEqual(stop, null);
  assert.ok(notes.some((n) => n.includes('build-info.json')));
});

test('commits newer than the build raise a problem, not a stop', () => {
  const { stop, problems } = release.evaluatePublish('1.0.70',
    { version: '1.0.70', rev: 70, channel: 'local', builtAt: BUILT_AT }, BUILT_MS + 60_000);
  assert.strictEqual(stop, null);
  assert.strictEqual(problems.length, 1);
  assert.ok(/HEAD is newer/.test(problems[0]));
});

test('an unknown HEAD time is not treated as staleness', () => {
  const { stop, problems } = release.evaluatePublish('1.0.70',
    { version: '1.0.70', rev: 70, channel: 'local', builtAt: BUILT_AT }, null);
  assert.strictEqual(stop, null);
  assert.strictEqual(problems.length, 0);
});

test('addonTags returns tag names (empty is fine, a string is not)', () => {
  const tags = release.addonTags();
  assert.ok(Array.isArray(tags), 'addonTags must always return an array');
  for (const tag of tags) assert.strictEqual(typeof tag, 'string');
});

console.log(`\nrelease-guards.test: ${passed}/${passed + failed} PASS`);
process.exit(failed === 0 ? 0 : 1);
