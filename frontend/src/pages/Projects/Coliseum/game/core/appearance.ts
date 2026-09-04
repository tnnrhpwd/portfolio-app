import type { Appearance, Gender, HairStyle, SkinTone } from './types';
import { pick, type Rng } from './rng';

/** Selectable skin tones (lightest → darkest). */
export const SKIN_TONES: readonly SkinTone[] = ['light', 'tan', 'brown', 'dark'];

/** Selectable hair styles. */
export const HAIR_STYLES: readonly HairStyle[] = ['short', 'long', 'tied', 'curly', 'bald'];

/** Selectable hair colors. */
export const HAIR_COLORS: readonly string[] = ['#3a2416', '#b0763a', '#d9a066', '#6b4a2f', '#20120b'];

/** Selectable starting-cloth (tunic) colors. */
export const ROBE_OPTIONS: readonly { robe: string; robeShade: string }[] = [
  { robe: '#8c1f28', robeShade: '#5d121a' },
  { robe: '#3a5a8c', robeShade: '#27406b' },
  { robe: '#3a7d44', robeShade: '#28592f' },
  { robe: '#6b4a8c', robeShade: '#4a3066' },
  { robe: '#8c6a1f', robeShade: '#665014' },
  { robe: '#8c3a1f', robeShade: '#662a14' },
  { robe: '#2b6b6b', robeShade: '#1e4a4a' },
  { robe: '#4a3a2b', robeShade: '#332818' },
];

/** The default new-gladiator look, shown before any customization. */
export const DEFAULT_APPEARANCE: Appearance = {
  skin: 'light',
  hairStyle: 'short',
  hairColor: '#3a2416',
  robe: '#8c1f28',
  robeShade: '#5d121a',
};

/** A stable, texture-safe id derived from an appearance and gender. */
export function appearanceId(a: Appearance, gender: Gender = 'male'): string {
  return [gender[0], a.skin, a.hairStyle, a.hairColor.slice(1), a.robe.slice(1), a.robeShade.slice(1)].join('_');
}

/** Rolls a random base-human appearance (used by recruits and opponents). */
export function randomAppearance(rand: Rng = Math.random): Appearance {
  return {
    skin: pick(SKIN_TONES, rand),
    hairStyle: pick(HAIR_STYLES, rand),
    hairColor: pick(HAIR_COLORS, rand),
    ...pick(ROBE_OPTIONS, rand),
  };
}

/** Rolls a random gladiator gender. */
export function randomGender(rand: Rng = Math.random): Gender {
  return rand() < 0.5 ? 'female' : 'male';
}
