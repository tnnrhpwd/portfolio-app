/**
 * dreamCovers.js — the Dream board's preset cover catalog.
 *
 * A goal's `cover` is one string: either a key from this list or an image URL.
 * These keys are the storage values, so they must match the `key` fields in
 * backend/scripts/generate-dream-art.js — that script is what produced the
 * `dream-*.jpg` files imported below. Renaming a key here without regenerating
 * there leaves a goal pointing at art that no longer exists (and the tile falls
 * back to the gradient), so treat the two lists as one.
 *
 * Art is imported rather than referenced by URL so Vite fingerprints and bundles
 * it: a preset tile costs one local image, never a network round-trip, and works
 * offline.
 *
 * Why presets matter: most people will never upload a photo, so these are the
 * images that actually carry the feature. They also have to be *photographs of
 * something* — FRONTEND_UI_STANDARD.md §5 says "Imagery over emoji", which rules
 * out a wall of icon tiles.
 */

import { defaultCoverKey } from './plansUtils';
import homeArt from '../../../assets/art/dream-home.jpg';
import workArt from '../../../assets/art/dream-work.jpg';
import moneyArt from '../../../assets/art/dream-money.jpg';
import healthArt from '../../../assets/art/dream-health.jpg';
import travelArt from '../../../assets/art/dream-travel.jpg';
import learningArt from '../../../assets/art/dream-learning.jpg';
import peopleArt from '../../../assets/art/dream-people.jpg';
import creativeArt from '../../../assets/art/dream-creative.jpg';
import playArt from '../../../assets/art/dream-play.jpg';
import calmArt from '../../../assets/art/dream-calm.jpg';
import adventureArt from '../../../assets/art/dream-adventure.jpg';
import milestoneArt from '../../../assets/art/dream-milestone.jpg';

/**
 * Preset covers, in the order the picker shows them.
 *
 * `hue` is the tailwind-free token used for the tile's caption plane and for the
 * fallback background when an image is missing or still loading — art is bright
 * and varied, and every tile needs to sit on *something* on-brand if the picture
 * isn't there yet.
 *
 * @type {Array<{key: string, label: string, hue: string, art: string}>}
 */
export const DREAM_COVERS = [
  { key: 'home',      label: 'Home',      hue: 'var(--fg-mint)',   art: homeArt },
  { key: 'work',      label: 'Work',      hue: 'var(--fg-blue)',   art: workArt },
  { key: 'money',     label: 'Money',     hue: 'var(--fg-orange)', art: moneyArt },
  { key: 'health',    label: 'Health',    hue: 'var(--fg-mint)',   art: healthArt },
  { key: 'travel',    label: 'Travel',    hue: 'var(--fg-blue)',   art: travelArt },
  { key: 'learning',  label: 'Learning',  hue: 'var(--fg-pink)',   art: learningArt },
  { key: 'people',    label: 'People',    hue: 'var(--fg-pink)',   art: peopleArt },
  { key: 'creative',  label: 'Creative',  hue: 'var(--fg-orange)', art: creativeArt },
  { key: 'play',      label: 'Play',      hue: 'var(--fg-blue)',   art: playArt },
  { key: 'calm',      label: 'Calm',      hue: 'var(--fg-mint)',   art: calmArt },
  { key: 'adventure', label: 'Adventure', hue: 'var(--fg-orange)', art: adventureArt },
  { key: 'milestone', label: 'Milestone', hue: 'var(--fg-pink)',   art: milestoneArt },
];

/** Every preset key, in picker order — the list `defaultCoverKey` picks from. */
export const DREAM_COVER_KEYS = DREAM_COVERS.map((c) => c.key);

/** Look up a preset by key. Returns null for an unknown key or an image URL. */
export function getCoverPreset(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  return DREAM_COVERS.find((c) => c.key === k) || null;
}

/**
 * Resolve the actual `<img src>` and hue for a tile.
 *
 * Handles every way a cover can arrive — a chosen preset, an uploaded or
 * generated URL, a `data:` URL still being previewed, and nothing at all — so the
 * tile component never branches on it.
 *
 * With no cover (or a stale key pointing at art that no longer exists) the goal
 * borrows a *stable* preset derived from the seed, usually its slug: a board of
 * grey placeholders reads as broken, and asking someone to pick a picture before
 * they can see their board is the wrong order.
 *
 * @param {string} cover - Preset key or image URL
 * @param {string} [seed] - Stable per-goal value, used only when cover is empty
 * @returns {{src: string|null, preset: object|null, isPreset: boolean, isCustom: boolean}}
 *   `isPreset` is true only when the stored value *is* a recognized preset, so
 *   the picker can tell "they chose this" from "they never chose".
 */
export function coverSource(cover, seed = '') {
  const value = String(cover || '').trim();

  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
    return { src: value, preset: null, isPreset: false, isCustom: true };
  }

  const chosen = getCoverPreset(value);
  const preset = chosen || getCoverPreset(defaultCoverKey(seed, DREAM_COVER_KEYS));
  return {
    src: preset ? preset.art : null,
    preset,
    isPreset: Boolean(chosen),
    isCustom: false,
  };
}
