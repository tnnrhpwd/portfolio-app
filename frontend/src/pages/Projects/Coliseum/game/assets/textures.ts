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
import type { Appearance, Equipment, EquipmentSlot, Gender, StyleKey, ZoneMap } from '../core';
import { appearanceId, BODY_ZONES } from '../core';
import {
  ARENA_BACKGROUND,
  BLOOD_OVERLAYS,
  MENU_BACKGROUND,
  SEVERED_OVERLAYS,
  STYLE_SPRITES,
  WORLD_MAP_BACKGROUND,
  svgDataUri,
  buildAppearanceSprite,
  ARMOR_ICONS,
  ARMOR_OVERLAYS,
  HUMAN_SPRITES,
  HUMAN_VARIANTS,
  MANNEQUIN_FRAME,
  OFFHAND_WEAPON_OVERLAYS,
  SHIELD_ICONS,
  SHIELD_OVERLAYS,
  WEAPON_ICONS,
  WEAPON_OVERLAYS,
  type HumanVariant,
} from './art';

const ARENA_KEY = 'coliseum-arena';
const MENU_KEY = 'coliseum-menu';
const MAP_KEY = 'coliseum-map';
const MAP_RASTER_KEY = 'coliseum-map-raster';
const ARENA_RASTER_KEY = 'coliseum-arena-raster';
const MANNEQUIN_KEY = 'coliseum-mannequin';
const HUMAN_KEY = 'coliseum-human-';
const ARMOR_OVERLAY_KEY = 'coliseum-armor-';
const ARMOR_ICON_KEY = 'coliseum-armor-icon-';
const WEAPON_OVERLAY_KEY = 'coliseum-weapon-';
const WEAPON_ICON_KEY = 'coliseum-weapon-icon-';
const OFFHAND_WEAPON_OVERLAY_KEY = 'coliseum-offhand-weapon-';
const BLOOD_OVERLAY_KEY = 'coliseum-blood-';
const SEVERED_OVERLAY_KEY = 'coliseum-severed-';
const SHIELD_OVERLAY_KEY = 'coliseum-shield-';
const SHIELD_ICON_KEY = 'coliseum-shield-icon-';
const SPRITE_W = 120;
const SPRITE_H = 180;

const registered = new WeakMap<Phaser.Textures.TextureManager, Set<string>>();

function textureKey(style: StyleKey): string {
  return `coliseum-style-${style}`;
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
  const keys = [ARENA_KEY, MENU_KEY, MAP_KEY, MANNEQUIN_KEY];
  (Object.keys(STYLE_SPRITES) as StyleKey[]).forEach((s) => keys.push(textureKey(s)));
  Object.keys(HUMAN_SPRITES).forEach((k) => keys.push(HUMAN_KEY + k));
  Object.keys(ARMOR_OVERLAYS).forEach((k) => keys.push(ARMOR_OVERLAY_KEY + k));
  Object.keys(ARMOR_ICONS).forEach((k) => keys.push(ARMOR_ICON_KEY + k));
  Object.keys(WEAPON_OVERLAYS).forEach((k) => keys.push(WEAPON_OVERLAY_KEY + k));
  Object.keys(WEAPON_ICONS).forEach((k) => keys.push(WEAPON_ICON_KEY + k));
  Object.keys(OFFHAND_WEAPON_OVERLAYS).forEach((k) => keys.push(OFFHAND_WEAPON_OVERLAY_KEY + k));
  Object.keys(BLOOD_OVERLAYS).forEach((k) => keys.push(BLOOD_OVERLAY_KEY + k));
  Object.keys(SEVERED_OVERLAYS).forEach((k) => keys.push(SEVERED_OVERLAY_KEY + k));
  Object.keys(SHIELD_OVERLAYS).forEach((k) => keys.push(SHIELD_OVERLAY_KEY + k));
  Object.keys(SHIELD_ICONS).forEach((k) => keys.push(SHIELD_ICON_KEY + k));
  return keys;
}

function registerMap(
  textures: Phaser.Textures.TextureManager,
  prefix: string,
  map: Record<string, string>,
): void {
  Object.keys(map).forEach((k) => registerOnce(textures, prefix + k, svgDataUri(map[k])));
}

/** Hand the arena backdrop + every style/equipment sprite to the loader exactly once. */
export function ensureTextures(scene: Phaser.Scene): void {
  const t = scene.textures;
  registerOnce(t, ARENA_KEY, svgDataUri(ARENA_BACKGROUND));
  registerOnce(t, MENU_KEY, svgDataUri(MENU_BACKGROUND));
  registerOnce(t, MAP_KEY, svgDataUri(WORLD_MAP_BACKGROUND));
  registerOnce(t, MANNEQUIN_KEY, svgDataUri(MANNEQUIN_FRAME));
  (Object.keys(STYLE_SPRITES) as StyleKey[]).forEach((s) => registerOnce(t, textureKey(s), svgDataUri(STYLE_SPRITES[s])));
  registerMap(t, HUMAN_KEY, HUMAN_SPRITES);
  registerMap(t, ARMOR_OVERLAY_KEY, ARMOR_OVERLAYS);
  registerMap(t, ARMOR_ICON_KEY, ARMOR_ICONS);
  registerMap(t, WEAPON_OVERLAY_KEY, WEAPON_OVERLAYS);
  registerMap(t, WEAPON_ICON_KEY, WEAPON_ICONS);
  registerMap(t, OFFHAND_WEAPON_OVERLAY_KEY, OFFHAND_WEAPON_OVERLAYS);
  registerMap(t, BLOOD_OVERLAY_KEY, BLOOD_OVERLAYS);
  registerMap(t, SEVERED_OVERLAY_KEY, SEVERED_OVERLAYS);
  registerMap(t, SHIELD_OVERLAY_KEY, SHIELD_OVERLAYS);
  registerMap(t, SHIELD_ICON_KEY, SHIELD_ICONS);
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

/** Add the wireframe mannequin (drop-target silhouette). */
export function addMannequinFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  scale = 1,
): Phaser.GameObjects.Image {
  ensureTextures(scene);
  return scene.add
    .image(x, y, MANNEQUIN_KEY)
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

/** Add the dark-red marbled menu backdrop, behind content. */
export function addMenuBackground(scene: Phaser.Scene): Phaser.GameObjects.Image {
  ensureTextures(scene);
  const { width, height } = scene.scale;
  return scene.add
    .image(width / 2, height / 2, MENU_KEY)
    .setDisplaySize(width, height)
    .setDepth(-10);
}

/** Add the parchment world-map backdrop (the hub / travel map). */
export function addMapBackground(scene: Phaser.Scene): Phaser.GameObjects.Image {
  ensureTextures(scene);
  const { width, height } = scene.scale;
  return scene.add
    .image(width / 2, height / 2, MAP_KEY)
    .setDisplaySize(width, height)
    .setDepth(-10);
}

/** URL of the raster map backdrop (served from public/coliseum/). */
export const MAP_RASTER_URL = '/coliseum/map-background.jpg';

/** Loads the raster map backdrop once; resolves when ready (or after a timeout). */
export function loadMapRaster(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve) => {
    if (scene.textures.exists(MAP_RASTER_KEY)) {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    scene.load.image(MAP_RASTER_KEY, MAP_RASTER_URL);
    scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    scene.time.delayedCall(5000, finish); // fail soft: fall back to the SVG map
    scene.load.start();
  });
}

/**
 * Draws the raster Colosseum backdrop with cover-fit (no distortion) plus a
 * light dark veil so the hub's text stays legible. Falls back to the SVG map
 * when the image hasn't loaded.
 */
export function addMapBackgroundRaster(scene: Phaser.Scene): Phaser.GameObjects.Image {
  if (!scene.textures.exists(MAP_RASTER_KEY)) return addMapBackground(scene);
  const src = scene.textures.get(MAP_RASTER_KEY).getSourceImage() as { width?: number; height?: number } | null;
  const imgW = src?.width ?? 1;
  const imgH = src?.height ?? 1;
  const { width, height } = scene.scale;
  const scale = Math.max(width / imgW, height / imgH);
  const img = scene.add.image(width / 2, height / 2, MAP_RASTER_KEY).setScale(scale).setDepth(-10);
  scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.42).setDepth(-9);
  return img;
}

/** URL of the raster arena backdrop (served from public/coliseum/). */
export const ARENA_RASTER_URL = '/coliseum/arena-background.jpg';

/** Loads the raster arena backdrop once; resolves when ready (or after a timeout). */
export function loadArenaRaster(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve) => {
    if (scene.textures.exists(ARENA_RASTER_KEY)) {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    scene.load.image(ARENA_RASTER_KEY, ARENA_RASTER_URL);
    scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    scene.time.delayedCall(5000, finish); // fail soft: fall back to the SVG arena
    scene.load.start();
  });
}

/**
 * Draws the raster arena backdrop with cover-fit (no distortion) plus a soft
 * dark veil so battle text stays legible. Falls back to the SVG arena when
 * the image hasn't loaded.
 */
export function addArenaBackgroundRaster(scene: Phaser.Scene): Phaser.GameObjects.Image {
  if (!scene.textures.exists(ARENA_RASTER_KEY)) return addArenaBackground(scene);
  const src = scene.textures.get(ARENA_RASTER_KEY).getSourceImage() as { width?: number; height?: number } | null;
  const imgW = src?.width ?? 1;
  const imgH = src?.height ?? 1;
  const { width, height } = scene.scale;
  const scale = Math.max(width / imgW, height / imgH);
  const img = scene.add.image(width / 2, height / 2, ARENA_RASTER_KEY).setScale(scale).setDepth(-10);
  scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.25).setDepth(-9);
  return img;
}

/** Deterministically pick a base-human appearance: stored look wins, else a hash of the id. */
export function humanVariantFor(fighter: { id: string; appearance?: Appearance | null; gender?: Gender }): HumanVariant {
  if (fighter.appearance) {
    const gender = fighter.gender ?? 'male';
    return { id: appearanceId(fighter.appearance, gender), gender, ...fighter.appearance };
  }
  let h = 0;
  for (let i = 0; i < fighter.id.length; i += 1) h = (h * 31 + fighter.id.charCodeAt(i)) >>> 0;
  return HUMAN_VARIANTS[h % HUMAN_VARIANTS.length];
}

/** Register the base-human texture for an arbitrary appearance on demand. */
export function ensureHumanAppearance(scene: Phaser.Scene, variant: HumanVariant): boolean {
  const key = HUMAN_KEY + variant.id;
  if (scene.textures.exists(key)) return true;
  registerOnce(scene.textures, key, svgDataUri(buildAppearanceSprite(variant, variant.gender ?? 'male')));
  return scene.textures.exists(key);
}

/** The texture key used for a base-human variant. */
export function humanVariantTextureKey(variant: HumanVariant): string {
  return HUMAN_KEY + variant.id;
}

function armorGroup(tier: number): number {
  return tier <= 2 ? 0 : tier <= 5 ? 1 : 2;
}

function equipmentOverlayKey(item: Equipment): string | null {
  if (item.minDamage !== undefined) {
    // A weapon in the off-hand slot renders in the left hand (dual wielding).
    return item.slot === 'offHand'
      ? OFFHAND_WEAPON_OVERLAY_KEY + (item.kind ?? 'gladius')
      : WEAPON_OVERLAY_KEY + (item.kind ?? 'gladius');
  }
  if (item.blockChance !== undefined) return SHIELD_OVERLAY_KEY + (item.kind ?? 'round');
  return ARMOR_OVERLAY_KEY + `${item.slot}-${armorGroup(item.tier)}`;
}

function equipmentIconKey(item: Equipment): string | null {
  if (item.minDamage !== undefined) return WEAPON_ICON_KEY + (item.kind ?? 'gladius');
  if (item.blockChance !== undefined) return SHIELD_ICON_KEY + (item.kind ?? 'round');
  return ARMOR_ICON_KEY + `${item.slot}-${armorGroup(item.tier)}`;
}

const LAYER_ORDER: EquipmentSlot[] = ['legs', 'torso', 'leftArm', 'rightArm', 'head', 'offHand', 'mainHand'];

/** Render a fighter as a stack of layered sprites (base human + gear + wounds). */
export function addLayeredFighter(
  scene: Phaser.Scene,
  x: number,
  y: number,
  fighter: {
    id: string;
    appearance?: Appearance | null;
    gender?: Gender;
    loadout: Record<EquipmentSlot, Equipment | null>;
    zones?: ZoneMap;
  },
  scale = 1,
  ghost = false,
): Phaser.GameObjects.Container {
  ensureTextures(scene);
  const w = SPRITE_W * scale;
  const h = SPRITE_H * scale;
  const parts: Phaser.GameObjects.Image[] = [];
  const variant = humanVariantFor(fighter);
  const key = HUMAN_KEY + variant.id;
  const loaded = scene.textures.exists(key);
  if (!loaded) ensureHumanAppearance(scene, variant);
  // A custom texture can still be loading (addBase64 is async); fall back to
  // the fighter's preloaded hash variant so no frame shows `__MISSING`, then
  // swap the real texture in place once it finishes loading.
  const baseKey = loaded ? key : HUMAN_KEY + humanVariantFor({ id: fighter.id }).id;
  const base = scene.add.image(0, 0, baseKey).setDisplaySize(w, h);
  if (!loaded) {
    scene.textures.once(Phaser.Textures.Events.LOAD, (loadedKey: string) => {
      if (loadedKey === key && base.active) base.setTexture(key).setDisplaySize(w, h);
    });
  }
  parts.push(base);
  if (!ghost) {
    for (const slot of LAYER_ORDER) {
      const item = fighter.loadout?.[slot];
      if (!item) continue;
      const key = equipmentOverlayKey(item);
      if (key && scene.textures.exists(key)) {
        parts.push(scene.add.image(0, 0, key).setDisplaySize(w, h));
      }
    }
    // Wound visuals: damaged zones bleed; destroyed limbs are severed.
    for (const zone of BODY_ZONES) {
      const z = fighter.zones?.[zone];
      if (!z) continue;
      if (z.hp <= 0) {
        const severedKey = SEVERED_OVERLAY_KEY + zone;
        if (scene.textures.exists(severedKey)) {
          parts.push(scene.add.image(0, 0, severedKey).setDisplaySize(w, h));
        }
      } else if (z.hp < z.maxHp) {
        const ratio = 1 - z.hp / z.maxHp;
        const bloodKey = BLOOD_OVERLAY_KEY + zone;
        if (scene.textures.exists(bloodKey)) {
          parts.push(
            scene.add
              .image(0, 0, bloodKey)
              .setDisplaySize(w, h)
              .setAlpha(Phaser.Math.Clamp(0.3 + 0.7 * ratio, 0.3, 1)),
          );
        }
      }
    }
  }
  const container = scene.add.container(x, y, parts);
  if (ghost) container.setAlpha(0.2);
  return container;
}

/** Add an equipment item's icon sprite (for shop / inventory / loot cells). */
export function addEquipmentIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  item: Equipment,
  size: number,
): Phaser.GameObjects.Image | null {
  ensureTextures(scene);
  const key = equipmentIconKey(item);
  if (key && scene.textures.exists(key)) {
    return scene.add.image(x, y, key).setDisplaySize(size, size);
  }
  return null;
}
