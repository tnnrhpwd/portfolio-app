import type { AttributeKey } from './types';

export type SkillEffect =
  | { kind: 'strike'; multiplier: number }
  | { kind: 'combo'; hits: number; multiplier: number }
  | { kind: 'throw'; multiplier: number; critBonus: number }
  | { kind: 'shieldBash'; multiplier: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'demoralize'; fraction: number }
  | { kind: 'warCry'; damageBuff: number }
  | { kind: 'passive'; stat: AttributeKey; perRank: number }
  | { kind: 'lifeBoost'; perRank: number };

export interface SkillNode {
  id: string;
  label: string;
  blurb: string;
  maxRank: number;
  /** MP cost to use; 0 for passives. */
  mpCost: number;
  effect: SkillEffect;
}

export const SKILL_CATALOG: Record<string, SkillNode> = {
  powerStrike: {
    id: 'powerStrike',
    label: 'Power Strike',
    blurb: 'One heavy blow for bonus damage.',
    maxRank: 10,
    mpCost: 5,
    effect: { kind: 'strike', multiplier: 1.5 },
  },
  doubleStrike: {
    id: 'doubleStrike',
    label: 'Double Strike',
    blurb: 'Two quick hits in a single turn.',
    maxRank: 10,
    mpCost: 8,
    effect: { kind: 'combo', hits: 2, multiplier: 0.8 },
  },
  quadCombo: {
    id: 'quadCombo',
    label: 'Quad Combo',
    blurb: 'A four-hit flurry of blades.',
    maxRank: 10,
    mpCost: 14,
    effect: { kind: 'combo', hits: 4, multiplier: 0.55 },
  },
  throw: {
    id: 'throw',
    label: 'Throw',
    blurb: 'A ranged throw with a high crit chance.',
    maxRank: 10,
    mpCost: 6,
    effect: { kind: 'throw', multiplier: 1.3, critBonus: 0.15 },
  },
  shieldBash: {
    id: 'shieldBash',
    label: 'Shield Bash',
    blurb: 'Bash with the shield, then raise your guard.',
    maxRank: 10,
    mpCost: 6,
    effect: { kind: 'shieldBash', multiplier: 1.2 },
  },
  heal: {
    id: 'heal',
    label: 'Heal',
    blurb: 'Restore health to yourself.',
    maxRank: 10,
    mpCost: 10,
    effect: { kind: 'heal', amount: 60 },
  },
  demoralize: {
    id: 'demoralize',
    label: 'Demoralize',
    blurb: 'Strip most of a foe\u2019s morale.',
    maxRank: 10,
    mpCost: 12,
    effect: { kind: 'demoralize', fraction: 0.75 },
  },
  warCry: {
    id: 'warCry',
    label: 'War Cry',
    blurb: 'Rally — your next attack hits harder.',
    maxRank: 10,
    mpCost: 8,
    effect: { kind: 'warCry', damageBuff: 0.2 },
  },
  speedBoost: {
    id: 'speedBoost',
    label: 'Speed Boost',
    blurb: 'Passive: +2 Speed per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'speed', perRank: 2 },
  },
  vitalityBoost: {
    id: 'vitalityBoost',
    label: 'Vitality Boost',
    blurb: 'Passive: +2 Vitality per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'vitality', perRank: 2 },
  },
  strengthBoost: {
    id: 'strengthBoost',
    label: 'Strength Boost',
    blurb: 'Passive: +2 Strength per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'strength', perRank: 2 },
  },
  dexterityBoost: {
    id: 'dexterityBoost',
    label: 'Dexterity Boost',
    blurb: 'Passive: +2 Dexterity per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'dexterity', perRank: 2 },
  },
  defenseBoost: {
    id: 'defenseBoost',
    label: 'Defense Boost',
    blurb: 'Passive: +2 Defense per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'defense', perRank: 2 },
  },
  lifeBoost: {
    id: 'lifeBoost',
    label: 'Life Boost',
    blurb: 'Passive: +100 max HP per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'lifeBoost', perRank: 100 },
  },
};

/** Every learnable skill, in display order (active techniques first, then passives). */
export const ALL_SKILL_IDS: readonly string[] = [
  'powerStrike',
  'doubleStrike',
  'quadCombo',
  'throw',
  'shieldBash',
  'heal',
  'demoralize',
  'warCry',
  'speedBoost',
  'vitalityBoost',
  'strengthBoost',
  'dexterityBoost',
  'defenseBoost',
  'lifeBoost',
];

export function getSkill(id: string): SkillNode | undefined {
  return SKILL_CATALOG[id];
}

/** Every skill in the shared catalog — any fighter can learn any of these. */
export function allSkills(): SkillNode[] {
  return ALL_SKILL_IDS.map((id) => SKILL_CATALOG[id]);
}

/** True when a skill costs MP (i.e. is a usable active, not a passive). */
export function isActiveSkill(id: string): boolean {
  const node = SKILL_CATALOG[id];
  return !!node && node.mpCost > 0;
}
