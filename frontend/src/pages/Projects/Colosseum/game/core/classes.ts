import type { Attributes, StyleKey } from './types';

export type MainHandKind = 'spear' | 'sword' | 'trident' | 'greatweapon';
export type OffHandKind = 'shield' | 'net' | 'sword' | 'none';

export interface StyleDef {
  key: StyleKey;
  label: string;
  blurb: string;
  /** Base attribute spread for a fresh recruit (before any background bonus). */
  base: Attributes;
  /** Weapon loadout that defines this style. */
  mainHand: MainHandKind;
  offHand: OffHandKind;
}

export const STYLES: Record<StyleKey, StyleDef> = {
  provocator: {
    key: 'provocator',
    label: 'Provocator',
    blurb: 'Spear-and-shield support fighter who controls the flow of morale.',
    base: { strength: 11, dexterity: 10, speed: 13, defense: 10, vitality: 10, charisma: 12 },
    mainHand: 'spear',
    offHand: 'shield',
  },
  murmillo: {
    key: 'murmillo',
    label: 'Murmillo',
    blurb: 'Shield-and-blade protector who stands between allies and harm.',
    base: { strength: 12, dexterity: 10, speed: 10, defense: 13, vitality: 12, charisma: 10 },
    mainHand: 'sword',
    offHand: 'shield',
  },
  retiarius: {
    key: 'retiarius',
    label: 'Retiarius',
    blurb: 'Net-and-trident controller who entangles and hurls from range.',
    base: { strength: 10, dexterity: 12, speed: 13, defense: 9, vitality: 10, charisma: 11 },
    mainHand: 'trident',
    offHand: 'net',
  },
  dimachaerus: {
    key: 'dimachaerus',
    label: 'Dimachaerus',
    blurb: 'Dual-wielding burst attacker who shreds with multi-hit combos.',
    base: { strength: 12, dexterity: 13, speed: 12, defense: 8, vitality: 9, charisma: 10 },
    mainHand: 'sword',
    offHand: 'sword',
  },
  thraex: {
    key: 'thraex',
    label: 'Thraex',
    blurb: 'Two-handed heavy hitter who lands one devastating blow.',
    base: { strength: 14, dexterity: 10, speed: 9, defense: 10, vitality: 12, charisma: 10 },
    mainHand: 'greatweapon',
    offHand: 'none',
  },
};

export const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];

export function isStyleKey(value: string): value is StyleKey {
  return Object.prototype.hasOwnProperty.call(STYLES, value);
}
