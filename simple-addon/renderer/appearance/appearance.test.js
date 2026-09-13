/**
 * Unit tests for the addon's appearance module (scheme × mode → `data-*` attributes).
 *
 * Run: node renderer/appearance/appearance.test.js
 *
 * Plain node + assert, matching the other addon test files (no Jest here — the
 * renderer has no bundler and the module is a classic script).
 *
 * The last test is the interesting one: it reads the WEBSITE's scheme list and
 * asserts the addon's mirror still agrees with it, ids, labels, hues and order. The
 * two files cannot import each other (an ES module vs. a `file://` classic script),
 * so the drift alarm is a test rather than a shared constant.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appearance = require('./appearance');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

console.log('\nappearance.test: scheme list');

test('isScheme accepts every named scheme plus custom', () => {
  for (const s of appearance.SCHEMES) assert(appearance.isScheme(s.id), s.id);
  assert(appearance.isScheme('custom'));
});

test('isScheme rejects junk, casing and undefined', () => {
  for (const bad of [undefined, null, '', 'Ocean', 'ocean ', 'neon', 42, {}]) {
    assert.strictEqual(appearance.isScheme(bad), false, String(bad));
  }
});

test('schemeById falls back to the default, never to nothing', () => {
  assert.strictEqual(appearance.schemeById('sakura').id, 'sakura');
  assert.strictEqual(appearance.schemeById('nope').id, appearance.DEFAULT_SCHEME);
  assert.strictEqual(appearance.schemeById(undefined).id, appearance.DEFAULT_SCHEME);
});

test('the default scheme leads the list and is the one a picker shows first', () => {
  assert.strictEqual(appearance.SCHEMES[0].id, appearance.DEFAULT_SCHEME);
});

console.log('\nappearance.test: resolveAppearance');

test('an empty/absent stored value resolves to the default scheme in dark', () => {
  for (const raw of [undefined, null, {}, 'nope']) {
    const r = appearance.resolveAppearance(raw);
    assert.strictEqual(r.scheme, appearance.DEFAULT_SCHEME);
    assert.strictEqual(r.mode, 'dark');
    assert.strictEqual(r.choice, 'system');
    assert.strictEqual(r.custom, null);
  }
});

test('mode "system" follows the OS, and the OS answer is passed in', () => {
  assert.strictEqual(appearance.resolveAppearance({ mode: 'system' }, { prefersDark: true }).mode, 'dark');
  assert.strictEqual(appearance.resolveAppearance({ mode: 'system' }, { prefersDark: false }).mode, 'light');
  // Unresolved choice is still reported, so a picker can show "System".
  assert.strictEqual(appearance.resolveAppearance({ mode: 'system' }, { prefersDark: false }).choice, 'system');
});

test('an explicit mode ignores the OS', () => {
  assert.strictEqual(appearance.resolveAppearance({ mode: 'light' }, { prefersDark: true }).mode, 'light');
  assert.strictEqual(appearance.resolveAppearance({ mode: 'dark' }, { prefersDark: false }).mode, 'dark');
});

test('an unknown scheme or mode falls back rather than applying half of it', () => {
  const r = appearance.resolveAppearance({ scheme: 'neon', mode: 'sepia' }, { prefersDark: true });
  assert.strictEqual(r.scheme, appearance.DEFAULT_SCHEME);
  assert.strictEqual(r.mode, 'dark');
});

test('custom only carries a pair when the scheme IS custom', () => {
  const named = appearance.resolveAppearance({ scheme: 'usa', custom: { accent: '#ff0000' } });
  assert.strictEqual(named.custom, null);
  const custom = appearance.resolveAppearance({ scheme: 'custom', custom: { accent: '#AB12cd', primary: '#00ff00' } });
  assert.deepStrictEqual(custom.custom, { accent: '#ab12cd', primary: '#00ff00' });
});

test('normalizeCustom repairs a half-written or non-hex pair', () => {
  const seed = appearance.schemeById(appearance.DEFAULT_SCHEME);
  assert.deepStrictEqual(appearance.normalizeCustom(undefined), { accent: seed.accent, primary: seed.primary });
  assert.deepStrictEqual(appearance.normalizeCustom({ accent: 'red' }), { accent: seed.accent, primary: seed.primary });
  // #abc is a 3-digit shorthand, which a CSS custom property would accept but the
  // colour input never emits — treated as absent rather than as valid.
  assert.deepStrictEqual(appearance.normalizeCustom({ accent: '#abc', primary: '#123456' }), { accent: seed.accent, primary: '#123456' });
});

test('seedCustomFrom takes the pair from the scheme being replaced', () => {
  assert.deepStrictEqual(appearance.seedCustomFrom('sakura'), { accent: '#ec4899', primary: '#a78bfa' });
  // An unknown id falls back like everything else, rather than seeding nothing.
  assert.deepStrictEqual(
    appearance.seedCustomFrom('neon'),
    { accent: appearance.schemeById(appearance.DEFAULT_SCHEME).accent, primary: appearance.schemeById(appearance.DEFAULT_SCHEME).primary },
  );
  // The whole point: seeding from the CURRENT scheme is not the same as seeding from
  // the default, which is what makes picking Custom stop jumping the app to cyan.
  assert.notDeepStrictEqual(appearance.seedCustomFrom('sakura'), appearance.seedCustomFrom(appearance.DEFAULT_SCHEME));
});

console.log('\nappearance.test: stored shape');

test('fromStored maps the settings.json keys onto the resolver keys', () => {
  const stored = { colorScheme: 'forest', colorMode: 'light', customColors: { accent: '#111111', primary: '#222222' } };
  assert.deepStrictEqual(appearance.fromStored(stored), {
    scheme: 'forest',
    mode: 'light',
    custom: { accent: '#111111', primary: '#222222' },
  });
  assert.deepStrictEqual(appearance.fromStored(undefined), { scheme: undefined, mode: undefined, custom: undefined });
});

test('toStored writes only valid values, and never invents a key', () => {
  assert.deepStrictEqual(appearance.toStored({ scheme: 'monokai', mode: 'system' }), {
    colorScheme: 'monokai',
    colorMode: 'system',
  });
  assert.deepStrictEqual(appearance.toStored({}), {});
  assert.deepStrictEqual(appearance.toStored({ scheme: 'neon', mode: 'sepia' }), {});
  // A named scheme must not smuggle a custom pair into settings.json.
  assert.deepStrictEqual(appearance.toStored({ scheme: 'ocean', custom: { accent: '#ff0000', primary: '#00ff00' } }), {
    colorScheme: 'ocean',
    customColors: { accent: '#ff0000', primary: '#00ff00' },
  });
});

console.log('\nappearance.test: query string (first-paint path)');

test('fromSearch reads the appearance main.js put on the URL', () => {
  const parsed = appearance.fromSearch('?port=3001&scheme=sunset&mode=light&accent=%23ff0000&primary=%23001234');
  assert.strictEqual(parsed.scheme, 'sunset');
  assert.strictEqual(parsed.mode, 'light');
  assert.deepStrictEqual(parsed.custom, { accent: '#ff0000', primary: '#001234' });
});

test('fromSearch ignores anything it cannot trust', () => {
  assert.deepStrictEqual(appearance.fromSearch('?scheme=neon&mode=sepia'), {});
  assert.deepStrictEqual(appearance.fromSearch(''), {});
  assert.deepStrictEqual(appearance.fromSearch(undefined), {});
  // Only the port: a window opened without appearance params must not gain a scheme.
  assert.deepStrictEqual(appearance.fromSearch('?port=3001'), {});
});

test('applyToElement writes both attributes and clears them back off', () => {
  const attrs = {};
  const inline = {};
  const el = {
    setAttribute: (k, v) => { attrs[k] = v; },
    style: {
      setProperty: (k, v) => { inline[k] = v; },
      removeProperty: (k) => { delete inline[k]; },
    },
  };

  const named = appearance.applyToElement(el, { scheme: 'emerald', mode: 'light' }, { prefersDark: true });
  assert.strictEqual(attrs['data-scheme'], 'emerald');
  assert.strictEqual(attrs['data-mode'], 'light');
  assert.deepStrictEqual(inline, {}, 'a named scheme must not carry an inline hue pair');
  assert.strictEqual(named.mode, 'light');

  appearance.applyToElement(el, { scheme: 'custom', mode: 'dark', custom: { accent: '#010203', primary: '#040506' } }, { prefersDark: false });
  assert.strictEqual(attrs['data-scheme'], 'custom');
  assert.strictEqual(attrs['data-mode'], 'dark');
  assert.deepStrictEqual(inline, { '--scheme-hue-accent': '#010203', '--scheme-hue-primary': '#040506' });

  // Switching away must REMOVE the inline pair: an inline custom property beats every
  // stylesheet rule, so a stale one would override whatever was picked next.
  appearance.applyToElement(el, { scheme: 'ocean', mode: 'dark' }, { prefersDark: false });
  assert.deepStrictEqual(inline, {});
});

console.log('\nappearance.test: parity with the website');

test('the addon mirror still matches frontend/src/utils/scheme.js', () => {
  const sitePath = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils', 'scheme.js');
  assert(fs.existsSync(sitePath), `cannot find the site's scheme.js at ${sitePath}`);
  const source = fs.readFileSync(sitePath, 'utf-8');

  const entry = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']*)',\s*accent:\s*'(#[0-9a-fA-F]{6})',\s*primary:\s*'(#[0-9a-fA-F]{6})'\s*\}/g;
  const site = [];
  let m;
  while ((m = entry.exec(source)) !== null) {
    site.push({ id: m[1], label: m[2], accent: m[3].toLowerCase(), primary: m[4].toLowerCase() });
  }

  assert.strictEqual(
    site.length,
    appearance.SCHEMES.length,
    `the site lists ${site.length} schemes and the addon ${appearance.SCHEMES.length} — add/remove it in both files`,
  );
  assert.deepStrictEqual(
    site,
    appearance.SCHEMES.map((s) => ({ id: s.id, label: s.label, accent: s.accent.toLowerCase(), primary: s.primary.toLowerCase() })),
    'the two scheme lists have drifted (id, label or hue) — see the mirror note in appearance.js',
  );
});

console.log(`\nappearance.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
