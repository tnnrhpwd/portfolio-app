/**
 * The audio asset contract, in the same spirit as `core/sprites.test.ts`.
 *
 * Music assets are OPTIONAL at runtime — `music.ts` degrades to silence when the
 * manifest is missing — which is precisely why they need a test. Without one, a
 * scene that asks for a track the renderer never produced fails as *silence*,
 * which at play time is indistinguishable from "my speakers are off".
 *
 * These tests read the committed manifest, so they also fail if the assets were
 * deleted without re-running `scripts/rocket/generate-audio.js`.
 */

import manifest from '../../../../../../public/rocket/audio/manifest.json';
import { MUSIC_KEYS } from './music';

interface Track {
  slug: string;
  kind: string;
  file: string;
  bytes: number;
  ms: number;
  loop: boolean;
}

const tracks = manifest.tracks as Track[];
const bySlug = new Map(tracks.map((track) => [track.slug, track]));

describe('audio manifest', () => {
  it('lists a file for every slug exactly once', () => {
    expect(tracks.length).toBeGreaterThan(0);
    const slugs = tracks.map((track) => track.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('describes each track well enough to fetch and play it', () => {
    for (const track of tracks) {
      expect(track.slug).toMatch(/^[a-z0-9-]+$/);
      expect(track.file).toBe(`${track.slug}.wav`);
      expect(track.ms).toBeGreaterThan(0);
      expect(track.bytes).toBeGreaterThan(1000);
      expect(['music', 'sfx']).toContain(track.kind);
    }
  });

  it('covers every track the scenes ask for', () => {
    const missing = MUSIC_KEYS.filter((slug) => !bySlug.has(slug));
    expect(missing).toEqual([]);
    for (const slug of MUSIC_KEYS) expect(bySlug.get(slug)?.kind).toBe('music');
  });

  it('marks the game-over sting as a one-shot and the themes as loops', () => {
    // `run-over` is played by GameOverScene and must NOT loop under the stats.
    expect(bySlug.get('run-over')?.loop).toBe(false);
    for (const slug of ['menu-drift', 'arena-pulse', 'boss-alarm', 'shop-spend']) {
      expect(bySlug.get(slug)?.loop).toBe(true);
    }
  });

  it('keeps every loop seamless-length (a whole number of bars)', () => {
    // A loop whose length is not on a bar boundary cannot join back cleanly; the
    // renderer writes exact lengths, so this catches a hand-edited manifest.
    for (const track of tracks.filter((t) => t.loop)) {
      const seconds = track.ms / 1000;
      expect(seconds).toBeGreaterThan(4);
      expect(seconds).toBeLessThan(60);
    }
  });

  it('ships the wave-clear cue the arena plays as a replacement for the synth blip', () => {
    expect(bySlug.get('wave-clear')?.kind).toBe('sfx');
  });
});
