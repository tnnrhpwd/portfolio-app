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

/**
 * Raster UI chrome — the ornate red/gold plates.
 *
 * These come from the AI "poster" pipeline (see
 * `docs/guides/STATIC_ASSETS_AND_IMAGE_GENERATION.md`): a generated sheet of many
 * plaques, sliced into named PNGs in `frontend/public/coliseum/` by
 * `scripts/rocket/extract-sprites.js`. They are fetched by URL, so they stay out
 * of the JS bundle.
 *
 * The insets below are MEASURED, never guessed — `node
 * scripts/coliseum/nineslice-insets.js <file.png>` reports the cap width and the
 * border thickness. Guessing smears the gold trim the moment a plate is
 * stretched.
 */
export const CHROME_BUTTON_KEY = 'coliseum-chrome-button';
export const CHROME_PANEL_KEY = 'coliseum-chrome-panel';

const CHROME_URLS: Record<string, string> = {
  // chrome-bar-7 (167x67) — the most symmetric of the eight bars.
  //
  // A purpose-built "flat plate, no ornament" brief was generated to fix the smear
  // below, but the model answered with a POSTER of ~24 plaques (it will not draw
  // just one), so `ui-button-plate.png` was taken from it and tried here. It DID
  // stretch cleanly, but that plaque has a horizontal seam at its mid-height, and
  // on a 48px button the seam runs straight through the label ("★ Londinium").
  // Unreadable text is worse than a cosmetic smear, so bar-7 stays until a plate
  // exists with a flat interior AND no internal seams.
  [CHROME_BUTTON_KEY]: '/coliseum/chrome-bar-7.png',
  // chrome-panel-2 (209x163) — a clean rectangular plate for menus and stat blocks.
  [CHROME_PANEL_KEY]: '/coliseum/chrome-panel-2.png',
};

/**
 * Measured cap / border thickness, in the source PNG's own pixels.
 *
 * These are HAND-SET, not taken from `nineslice-insets.js`, and that is the point:
 * that tool measures the sprite's SILHOUETTE (where it reaches full height), which
 * is the right answer for a plate with angled ends and the wrong one for a
 * rectangle — rivets and emblems sit inside a full-height silhouette and never
 * register. For ui-button-plate the rivets are ~45px in from each end, so the caps
 * are set to contain them; the tool would have said 5/3/2/0 and smeared them
 * across every button.
 */
const CHROME_INSETS: Record<string, { left: number; right: number; top: number; bottom: number }> = {
  [CHROME_BUTTON_KEY]: { left: 23, right: 23, top: 16, bottom: 22 },
  [CHROME_PANEL_KEY]: { left: 16, right: 14, top: 16, bottom: 11 },
};

/** Loads the chrome plates once; resolves when ready (or after a timeout). */
export function loadChromeTextures(scene: Phaser.Scene, timeoutMs = 5000): Promise<void> {
  const pending = Object.entries(CHROME_URLS).filter(([key]) => !scene.textures.exists(key));
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    pending.forEach(([key, url]) => scene.load.image(key, url));
    scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    scene.time.delayedCall(timeoutMs, finish); // fail soft: chrome is decorative
    scene.load.start();
  });
}

/**
 * Insets that leave at least `MIN_MIDDLE` px of stretchable middle.
 *
 * These plates carry a thick ornate border — chrome-bar-7 is 67px tall with a 38px
 * border — so at a small button size the caps alone can exceed the target and the
 * middle has nothing left to stretch, which renders as a squashed mess. Scaling
 * the border down keeps the plate usable at every size the UI uses.
 */
export function chromeInsets(
  key: string,
  width: number,
  height: number,
): { left: number; right: number; top: number; bottom: number } {
  const natural = CHROME_INSETS[key];
  if (!natural) return { left: 8, right: 8, top: 8, bottom: 8 };
  const MIN_MIDDLE = 8;
  const scale = Math.min(
    1,
    width / (natural.left + natural.right + MIN_MIDDLE),
    height / (natural.top + natural.bottom + MIN_MIDDLE),
  );
  return {
    left: Math.max(1, Math.round(natural.left * scale)),
    right: Math.max(1, Math.round(natural.right * scale)),
    top: Math.max(1, Math.round(natural.top * scale)),
    bottom: Math.max(1, Math.round(natural.bottom * scale)),
  };
}

/**
 * A nine-slice chrome plate at (x, y), or `null` when the raster is not loaded.
 *
 * Callers fall back to the old drawn rectangle, so a missing or slow PNG degrades
 * to the previous look rather than to Phaser's green `__MISSING` placeholder.
 *
 * NOTE: `NineSlice` implements Alpha but NOT Tint, so a plate cannot be
 * recoloured — callers that need hover/disabled states layer a translucent
 * rectangle over it instead of calling `setFillStyle`.
 */
export function addChromePlate(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice | null {
  if (!scene.textures.exists(key)) return null;
  const i = chromeInsets(key, width, height);
  return scene.add.nineslice(x, y, key, undefined, width, height, i.left, i.right, i.top, i.bottom);
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

/**
 * Raster weapon icons — the AI-generated sprites in `frontend/public/coliseum/`,
 * sliced from the weapon sheets by `scripts/rocket/extract-sprites.js` and named
 * by hand in the UIMapper.
 *
 * Every weapon kind the game has is covered. The sword sprites are the exception to
 * the "poster" sheets: briefs that said "gladiator weapons" came back as hammers and
 * maces every time, and naming the object concretely — "Roman gladius short swords"
 * — is what finally produced swords.
 *
 * A kind missing from this map falls through to the original vector icon, so only add
 * an entry when a sprite genuinely matches the kind.
 */
const WEAPON_RASTER_KEY = 'coliseum-weapon-raster-';

export const WEAPON_RASTER_ICONS: Record<string, string> = {
  gladius: 'sword-gladius',
  greatsword: 'sword-greatsword',
  axe: 'axe-bearded',
  mace: 'mace-flanged',
  spear: 'spear-barbed',
  dagger: 'dagger-gold',
  trident: 'trident',
  maul: 'maul-1',
  halberd: 'axe-crescent',
};

/** Loads the raster weapon icons once; resolves when ready (or after a timeout). */
export function loadWeaponRasterIcons(scene: Phaser.Scene, timeoutMs = 5000): Promise<void> {
  const pending = Object.entries(WEAPON_RASTER_ICONS).filter(
    ([kind]) => !scene.textures.exists(WEAPON_RASTER_KEY + kind),
  );
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    pending.forEach(([kind, stem]) =>
      scene.load.image(WEAPON_RASTER_KEY + kind, `/coliseum/${stem}.png`),
    );
    scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    scene.time.delayedCall(timeoutMs, finish); // fail soft: icons fall back to vectors
    scene.load.start();
  });
}

/**
 * Aspect-preserving icon placement.
 *
 * The weapon sprites are tall (a pike is 24x160), so the square
 * `setDisplaySize(size, size)` used for the vector icons would squash them flat.
 */
function fitIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  size: number,
): Phaser.GameObjects.Image {
  const src = scene.textures.get(key).getSourceImage() as { width?: number; height?: number } | null;
  const w = src?.width ?? size;
  const h = src?.height ?? size;
  const scale = Math.min(size / w, size / h);
  return scene.add.image(x, y, key).setDisplaySize(w * scale, h * scale);
}

/**
 * True when the item is a weapon that has an AI sprite.
 *
 * Callers use this to give the icon a taller box. The sprites are tall and thin (a
 * pike is 24x160), and `fitIcon` preserves aspect, so the icon's HEIGHT equals the box
 * size and the cell's width goes unused — more height is the only way to make one
 * bigger in a square cell.
 */
export function hasRasterWeaponIcon(item: Equipment): boolean {
  return item.minDamage !== undefined && Boolean(WEAPON_RASTER_ICONS[item.kind ?? '']);
}

/**
 * Raster armour sprites — AI helmets / cuirasses / greaves from the poster sheets in
 * `frontend/public/coliseum/`, one variant per armour slot per metal group
 * (0 bronze, 1 iron, 2 gold).
 *
 * The model returned almost entirely STEEL art, so the metal is applied at runtime with
 * `setTint` — a multiply, which recolours the bright steel while leaving crests and plumes
 * alone. Without it every "Golden Helmet" would render silver.
 *
 * `leftArm`/`rightArm` are deliberately absent: three separate briefs for arm guards came back
 * as torso plates, dark pods and helmets, so arms keep the vector icon.
 */
const ARMOR_RASTER_KEY = 'coliseum-armor-raster-';

const ARMOR_RASTER_IDS = [
  'head-0',
  'head-1',
  'head-2',
  'torso-0',
  'torso-1',
  'torso-2',
  'legs-0',
  'legs-1',
  'legs-2',
];

/** Metal tints, multiplied over the steel art. Iron is left untouched (white = identity). */
const ARMOR_GROUP_TINT = [0xcf8b45, 0xffffff, 0xffd76a];

/**
 * Where a raster armour piece sits on the fighter, as a fraction of the sprite box, plus how
 * tall it is drawn. The anchors are converted from the vector overlays' `ARMOR_POS` transforms
 * (head 80,30 / torso 80,94 / arms 50|110,96 / legs 80,174 on a 160x240 canvas shown at 120x180)
 * so a raster piece lands exactly where the vector one did; the heights come from the matching
 * body rects in `buildAppearanceSprite`.
 */
const RASTER_ARMOR_FIT: Record<string, { x: number; y: number; height: number }> = {
  head: { x: 0, y: -0.375, height: 0.18 },
  torso: { x: 0, y: -0.108, height: 0.38 },
  leftArm: { x: -0.1875, y: -0.1, height: 0.2 },
  rightArm: { x: 0.1875, y: -0.1, height: 0.2 },
  legs: { x: 0, y: 0.225, height: 0.22 },
};

/** Loads the raster armour sprites once; resolves when ready (or after a timeout). */
export function loadArmorRasterTextures(scene: Phaser.Scene, timeoutMs = 5000): Promise<void> {
  const pending = ARMOR_RASTER_IDS.filter((id) => !scene.textures.exists(ARMOR_RASTER_KEY + id));
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    pending.forEach((id) => scene.load.image(ARMOR_RASTER_KEY + id, `/coliseum/${id}.png`));
    scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    scene.time.delayedCall(timeoutMs, finish); // fail soft: icons fall back to vectors
    scene.load.start();
  });
}

/** The raster texture key for an armour item, or '' when it has none (e.g. arms). */
function armorRasterKey(item: Equipment): string {
  if (item.minDamage !== undefined || item.blockChance !== undefined) return '';
  const id = `${item.slot}-${armorGroup(item.tier)}`;
  return ARMOR_RASTER_IDS.includes(id) ? ARMOR_RASTER_KEY + id : '';
}

/** True when this armour slot/metal has a raster sprite. */
export function hasRasterArmorIcon(item: Equipment): boolean {
  return armorRasterKey(item) !== '';
}

/** A raster armour piece on the fighter, or null to use the vector overlay. */
function rasterArmorOverlay(
  scene: Phaser.Scene,
  slot: EquipmentSlot,
  item: Equipment,
  w: number,
  h: number,
): Phaser.GameObjects.Image | null {
  const key = armorRasterKey(item);
  const fit = RASTER_ARMOR_FIT[slot];
  if (!key || !fit || !scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as { width?: number; height?: number } | null;
  const srcW = src?.width ?? 1;
  const srcH = src?.height ?? 1;
  const targetH = h * fit.height;
  const targetW = srcW * (targetH / srcH);
  return scene.add
    .image(fit.x * w, fit.y * h, key)
    .setDisplaySize(targetW, targetH)
    .setTint(ARMOR_GROUP_TINT[armorGroup(item.tier)]);
}

function equipmentIconKey(item: Equipment): string | null {
  if (item.minDamage !== undefined) return WEAPON_ICON_KEY + (item.kind ?? 'gladius');
  if (item.blockChance !== undefined) return SHIELD_ICON_KEY + (item.kind ?? 'round');
  return ARMOR_ICON_KEY + `${item.slot}-${armorGroup(item.tier)}`;
}

/**
 * Where a raster weapon hangs on the fighter, as a fraction of the sprite box, and how
 * tall it is drawn (also a fraction of that box).
 *
 * The anchors are converted from the vector overlays' own transforms — main hand
 * `translate(116,92)` and off hand `translate(44,100)` on a 160x240 canvas displayed at
 * 120x180 — so a raster weapon lands in the same hand the vector one did.
 *
 * Every weapon sprite is drawn grip-down, so the sprite is BOTTOM-anchored at the hand:
 * the blade rises out of it.
 */
const RASTER_WEAPON_ANCHOR: Record<string, { x: number; y: number }> = {
  mainHand: { x: 0.225, y: -0.117 },
  offHand: { x: -0.225, y: -0.083 },
};
const RASTER_WEAPON_HEIGHT = 0.5;

/** A raster weapon sprite in the fighter's hand, or null to use the vector overlay. */
function rasterWeaponOverlay(
  scene: Phaser.Scene,
  slot: EquipmentSlot,
  item: Equipment,
  w: number,
  h: number,
): Phaser.GameObjects.Image | null {
  if (!hasRasterWeaponIcon(item)) return null;
  const anchor = RASTER_WEAPON_ANCHOR[slot];
  if (!anchor) return null;
  const key = WEAPON_RASTER_KEY + (item.kind ?? '');
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as { width?: number; height?: number } | null;
  const srcW = src?.width ?? 1;
  const srcH = src?.height ?? 1;
  const targetH = h * RASTER_WEAPON_HEIGHT;
  const targetW = srcW * (targetH / srcH);
  return scene.add
    .image(anchor.x * w, anchor.y * h, key)
    .setOrigin(0.5, 1)
    .setDisplaySize(targetW, targetH);
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
      const raster =
        rasterWeaponOverlay(scene, slot, item, w, h) ?? rasterArmorOverlay(scene, slot, item, w, h);
      if (raster) {
        parts.push(raster);
        continue;
      }
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
  // Prefer the AI raster sprite where one exists for this weapon kind. The vector
  // icon stays the fallback, so a slow or failed PNG degrades to the old look
  // instead of Phaser's `__MISSING` placeholder.
  const raster = item.minDamage !== undefined ? WEAPON_RASTER_KEY + (item.kind ?? '') : '';
  if (raster && scene.textures.exists(raster)) return fitIcon(scene, x, y, raster, size);
  const armorKey = armorRasterKey(item);
  if (armorKey && scene.textures.exists(armorKey)) {
    return fitIcon(scene, x, y, armorKey, size).setTint(ARMOR_GROUP_TINT[armorGroup(item.tier)]);
  }
  const key = equipmentIconKey(item);
  if (key && scene.textures.exists(key)) {
    return scene.add.image(x, y, key).setDisplaySize(size, size);
  }
  return null;
}
