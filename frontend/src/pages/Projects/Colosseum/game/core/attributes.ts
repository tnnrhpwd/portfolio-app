import type { AttributeKey, Attributes } from './types';
import { ATTRIBUTE_KEYS, STAT_CAPS } from './constants';
import { clamp } from './rng';

export interface AttributeDef {
  key: AttributeKey;
  label: string;
  blurb: string;
  cap: number;
}

export const ATTRIBUTE_DEFS: Record<AttributeKey, AttributeDef> = {
  strength: {
    key: 'strength',
    label: 'Strength',
    blurb: 'Adds flat damage to melee attacks and physical skills.',
    cap: STAT_CAPS.strength,
  },
  dexterity: {
    key: 'dexterity',
    label: 'Dexterity',
    blurb: 'Governs hit accuracy and critical-hit frequency.',
    cap: STAT_CAPS.dexterity,
  },
  speed: {
    key: 'speed',
    label: 'Speed',
    blurb: 'Determines initiative — faster fighters act first.',
    cap: STAT_CAPS.speed,
  },
  defense: {
    key: 'defense',
    label: 'Defense',
    blurb: 'Reduces enemy hit chance and softens unblocked hits.',
    cap: STAT_CAPS.defense,
  },
  vitality: {
    key: 'vitality',
    label: 'Vitality',
    blurb: 'Raises maximum health across every body zone.',
    cap: STAT_CAPS.vitality,
  },
  charisma: {
    key: 'charisma',
    label: 'Charisma',
    blurb: 'Powers morale abilities and crowd skills.',
    cap: STAT_CAPS.charisma,
  },
};

export function clampAttribute(key: AttributeKey, value: number): number {
  return clamp(value, 0, STAT_CAPS[key]);
}

export function clampAttributes(attributes: Attributes): Attributes {
  const out = { ...attributes };
  for (const key of ATTRIBUTE_KEYS) out[key] = clampAttribute(key, out[key]);
  return out;
}
