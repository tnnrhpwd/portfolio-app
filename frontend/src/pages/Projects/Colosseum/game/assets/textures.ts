/**
 * Phaser texture helpers for the original vector art in `art.ts`.
 *
 * Textures are registered lazily from base64 SVG data URIs, so no external
 * asset downloads are required and the art stays original + license-free.
 *
 * NOTE: `TextureManager.addBase64` is asynchronous — the texture only exists
 * after the underlying Image finishes loading. `textures.exists()` therefore
 * stays false during the same render pass, which would cause duplicate
 * registrations (and "Texture key already in use" errors) if we relied on it.
 * We track handed-out keys per TextureManager in a WeakMap instead.
 */

import Phaser from 'phaser';
import type { StyleKey } from '../core';
import { ARENA_BACKGROUND, STYLE_SPRITES, svgDataUri } from './art';

const ARENA_KEY = 'colosseum-arena';
const SPRITE_W = 120;
const SPRITE_H = 180;

const registered = new WeakMap<Phaser.Textures.TextureManager, Set<string>>();

function textureKey(style: StyleKey): string {
  return `colosseum-style-${style}`;
}

function registerOnce(
  textures: Phaser.Textures.TextureManager,
  key: string,
  dataUri: string,
): void {
  let keys = registered.get(textures);
  if (!keys) {
    keys = new Set<string>();
    registered.set(textures, keys);
  }
  // `textures.exists` guards against re-registering after a hot reload (the
  // WeakMap is module-scoped and resets, but the TextureManager survives).
  if (keys.has(key) || textures.exists(key)) return;
  keys.add(key);
  textures.addBase64(key, dataUri);
}

/** Every texture key the art module can register. */
function allKeys(): string[] {
  return [ARENA_KEY, ...(Object.keys(STYLE_SPRITES) as StyleKey[]).map(textureKey)];
}

/** Hand the arena backdrop + every style sprite to the loader exactly once. */
export function ensureTextures(scene: Phaser.Scene): void {
  registerOnce(scene.textures, ARENA_KEY, svgDataUri(ARENA_BACKGROUND));
  (Object.keys(STYLE_SPRITES) as StyleKey[]).forEach((style) => {
    registerOnce(scene.textures, textureKey(style), svgDataUri(STYLE_SPRITES[style]));
  });
}

/**
 * Resolve once every art texture has finished loading (addBase64 is async).
 * Falls back to resolving after `timeoutMs` so a failed image can never block
 * boot. Call this from the boot scene before routing so scenes never render a
 * frame with Phaser's `__MISSING` placeholder.
 */
export function waitForArtTextures(scene: Phaser.Scene, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    const pending = new Set(allKeys());
    const onLoad = (key: string): void => {
      pending.delete(key);
      if (pending.size === 0) finish();
    };
    scene.textures.on(Phaser.Textures.Events.LOAD, onLoad);
    // Keys that already loaded (e.g. hot reload) are already present.
    pending.forEach((key) => {
      if (scene.textures.exists(key)) pending.delete(key);
    });
    if (pending.size === 0) {
      finish();
      return;
    }
    scene.time.delayedCall(timeoutMs, finish);
  });
}

/** Add a style figure to a scene at (x, y), anchored to its center. */
export function addStyleSprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
  style: StyleKey,
  scale = 1,
): Phaser.GameObjects.Image {
  ensureTextures(scene);
  return scene.add
    .image(x, y, textureKey(style))
    .setDisplaySize(SPRITE_W * scale, SPRITE_H * scale);
}

/** Add the arena backdrop, stretched to cover the scene, behind content. */
export function addArenaBackground(scene: Phaser.Scene): Phaser.GameObjects.Image {
  ensureTextures(scene);
  const { width, height } = scene.scale;
  return scene.add
    .image(width / 2, height / 2, ARENA_KEY)
    .setDisplaySize(width, height)
    .setDepth(-10);
}
