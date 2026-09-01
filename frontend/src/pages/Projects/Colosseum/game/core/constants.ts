import type { AttributeKey, AttackPrecision, BodyZone } from './types';

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'strength',
  'dexterity',
  'speed',
  'defense',
  'vitality',
  'charisma',
];

export const BODY_ZONES: readonly BodyZone[] = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

/** Hard numeric caps discovered from the reference game's balance. */
export const STAT_CAPS: Record<AttributeKey, number> = {
  strength: 521,
  dexterity: 508,
  speed: 515,
  defense: 516,
  vitality: 383,
  // Charisma cap was not published; mirror Strength until tuned in Phase 3.
  charisma: 521,
};

/** Fraction of total HP carried by each anatomical zone. */
export const ZONE_HP_SPLIT: Record<BodyZone, number> = {
  head: 0.17,
  torso: 0.23,
  leftArm: 0.15,
  rightArm: 0.15,
  leftLeg: 0.15,
  rightLeg: 0.15,
};

export const MAX_ROSTER = 12;
export const START_GOLD = 120;
export const START_FAME = 0;

/** Highest obtainable shield block chance/value. */
export const BLOCK_CAP = 72;

/** Displayed armor value effectively doubles in combat application. */
export const ARMOR_COMBAT_MULTIPLIER = 2;

export const PRECISION: Record<AttackPrecision, { damage: number; hitChance: number }> = {
  weak: { damage: 0.7, hitChance: 1.0 },
  medium: { damage: 1.0, hitChance: 0.9 },
  strong: { damage: 1.45, hitChance: 0.75 },
};

export const CRIT_CHANCE = 0.08;
export const CRIT_MULTIPLIER = 1.6;

/** Attribute points granted per level-up. */
export const ATTRIBUTE_POINTS_PER_LEVEL = 5;
/** Skill points granted per level-up. */
export const SKILL_POINTS_PER_LEVEL = 1;
