/**
 * dreamCovers.test.js — the preset cover catalog and cover resolution.
 *
 * The art import resolves to `frontend/__mocks__/fileMock.js`
 * ("test-image-stub") via package.json's moduleNameMapper, so these assertions
 * are about *which* preset was chosen, never about pixels.
 */

import { DREAM_COVERS, DREAM_COVER_KEYS, getCoverPreset, coverSource } from './dreamCovers';
import { defaultCoverKey } from './plansUtils';

describe('dreamCovers · catalog', () => {
  test('every preset is complete and unique', () => {
    expect(DREAM_COVERS.length).toBeGreaterThanOrEqual(8);

    const keys = DREAM_COVERS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const cover of DREAM_COVERS) {
      // The key is a storage value the backend accepts, so it must be slug-safe.
      expect(cover.key).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(cover.label).toBeTruthy();
      // Art must actually resolve — an undefined src renders an empty tile.
      expect(cover.art).toBeTruthy();
      // A real theme token, never a raw colour (FRONTEND_UI_STANDARD.md §2).
      expect(cover.hue).toMatch(/^var\(--fg-(blue|mint|orange|pink)\)$/);
    }
  });

  test('DREAM_COVER_KEYS mirrors the catalog order', () => {
    expect(DREAM_COVER_KEYS).toEqual(DREAM_COVERS.map((c) => c.key));
  });

  test('getCoverPreset resolves a key and rejects everything else', () => {
    expect(getCoverPreset('home')).toMatchObject({ key: 'home' });
    expect(getCoverPreset(' HOME ')).toBeNull();       // keys are lowercase
    expect(getCoverPreset('nope')).toBeNull();
    expect(getCoverPreset('')).toBeNull();
    expect(getCoverPreset(null)).toBeNull();
    expect(getCoverPreset('https://cdn.test/a.jpg')).toBeNull();
  });
});

describe('dreamCovers · coverSource', () => {
  test('a chosen preset resolves to its own art', () => {
    const { src, preset, isPreset, isCustom } = coverSource('calm');
    expect(isPreset).toBe(true);
    expect(isCustom).toBe(false);
    expect(preset.key).toBe('calm');
    expect(src).toBe(getCoverPreset('calm').art);
  });

  test('a custom image is passed through untouched', () => {
    const url = 'https://cdn.example.com/mine.jpg';
    expect(coverSource(url)).toEqual({ src: url, preset: null, isPreset: false, isCustom: true });
    // A generated cover is previewed as a data URL before it is uploaded.
    const dataUrl = 'data:image/png;base64,AAAA';
    expect(coverSource(dataUrl)).toMatchObject({ src: dataUrl, isCustom: true });
  });

  test('a goal that never chose a cover borrows a stable one', () => {
    const first = coverSource('', 'half-marathon');
    expect(first.isPreset).toBe(false);
    expect(first.isCustom).toBe(false);
    expect(first.preset).not.toBeNull();
    // Same goal, same cover — on every reload and every device.
    expect(coverSource('', 'half-marathon').preset.key).toBe(first.preset.key);
  });

  test('the borrowed preset matches plansUtils.defaultCoverKey', () => {
    // Pins the one rule the two modules must agree on: dreamCovers must not
    // grow its own copy of the hash.
    for (const seed of ['home-save', 'marathon', '', 'x', 'a much longer slug']) {
      const expected = defaultCoverKey(seed, DREAM_COVER_KEYS);
      expect(coverSource('', seed).preset.key).toBe(expected);
    }
  });

  test('an unknown key degrades to a borrowed preset, not an empty tile', () => {
    const resolved = coverSource('deleted-preset', 'my-goal');
    expect(resolved.preset).not.toBeNull();
    expect(resolved.src).toBeTruthy();
    // It is *not* the user's choice, so the picker must still show it as unpicked.
    expect(resolved.isPreset).toBe(false);
  });
});
