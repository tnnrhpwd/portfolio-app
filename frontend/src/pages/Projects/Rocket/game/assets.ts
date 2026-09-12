/**
 * Rocket — texture loading.
 *
 * The 282 sprites live in `frontend/public/rocket/` and are fetched by URL, so
 * they stay out of the JS bundle (see docs/guides/Rocket-Asset-Pipeline.md).
 * The extractor names each file after its asset name, so the manifest name *is*
 * the texture key — no lookup table to keep in sync.
 *
 * Only the sprites the game actually uses are loaded (`requiredSprites()`), so
 * boot pulls a few dozen small PNGs rather than the whole set.
 */

import Phaser from 'phaser';
import { BACKGROUNDS, requiredSprites } from './core/tables';
import { createRng, nextPick } from './core/rng';
import { PALETTE } from './ui/theme';

export const SPRITE_PATH = '/rocket/';

/** Texture key used when a sprite failed to load, so a gap is visible but harmless. */
export const PLACEHOLDER_KEY = '__rocket_placeholder';

/** Texture key for a soft radial glow, generated at runtime. */
export const GLOW_KEY = '__rocket_glow';

/**
 * Queue every sprite the game needs. Call from `preload()`.
 * Names that fail to load are collected rather than thrown, because a missing
 * sprite should degrade one enemy — not brick the whole page.
 */
export function queueGameSprites(scene: Phaser.Scene): string[] {
  const names = requiredSprites();
  for (const name of names) {
    if (scene.textures.exists(name)) continue;
    scene.load.image(name, `${SPRITE_PATH}${name}.png`);
  }
  return names;
}

/** Which of `names` never became a texture (i.e. the file is missing/broken). */
export function missingSprites(scene: Phaser.Scene, names: string[]): string[] {
  return names.filter((name) => !scene.textures.exists(name));
}

/**
 * Create the magenta "missing sprite" texture plus a radial glow, once.
 * `generateTexture` is wrapped because a headless/test environment has no
 * renderer; falling back to Phaser's own `__MISSING` keeps things running.
 */
export function ensureRuntimeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(PLACEHOLDER_KEY)) {
    try {
      const g = scene.add.graphics();
      g.fillStyle(0xff00ff, 1).fillRect(0, 0, 48, 48);
      g.lineStyle(4, 0x000000, 1).strokeRect(0, 0, 48, 48);
      g.generateTexture(PLACEHOLDER_KEY, 48, 48);
      g.destroy();
    } catch {
      /* keep Phaser's built-in placeholder */
    }
  }

  if (!scene.textures.exists(GLOW_KEY)) {
    try {
      const size = 128;
      const g = scene.add.graphics();
      // Concentric discs fading outward make a cheap soft glow.
      for (let i = 12; i > 0; i--) {
        g.fillStyle(0xffffff, 0.045 * (13 - i));
        g.fillCircle(size / 2, size / 2, (size / 2) * (i / 12));
      }
      g.generateTexture(GLOW_KEY, size, size);
      g.destroy();
    } catch {
      /* glow is cosmetic */
    }
  }
}

/** A background that exists, chosen deterministically so it is stable per run. */
export function pickBackground(seed: number, available?: string[]): string {
  const names = available ?? BACKGROUNDS;
  const present = names.length ? names : ['bg-nebula-blue'];
  const rng = createRng(seed);
  return nextPick(rng, present);
}

/** Canvas backdrop color, also used by the React shell for the letterbox bars. */
export const CANVAS_BACKGROUND = PALETTE.bg;
