import type { AttributeKey, Fighter, StyleKey } from './types';

export type SkillEffect =
  | { kind: 'strike'; multiplier: number }
  | { kind: 'combo'; hits: number; multiplier: number }
  | { kind: 'throw'; multiplier: number; critBonus: number }
  | { kind: 'shieldBash'; multiplier: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'healAll'; amount: number }
  | { kind: 'demoralize'; fraction: number }
  | { kind: 'demoralizeAll'; fraction: number }
  | { kind: 'warCry'; damageBuff: number }
  | { kind: 'net'; slowRounds: number }
  | { kind: 'cleave'; multiplier: number }
  | { kind: 'protect'; rounds: number }
  | { kind: 'passive'; stat: AttributeKey; perRank: number }
  | { kind: 'lifeBoost'; perRank: number }
  | { kind: 'regen'; perRank: number };

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
  demoralizeAll: {
    id: 'demoralizeAll',
    label: 'Demoralize All',
    blurb: 'Strip most of the whole enemy team\u2019s morale in one shout.',
    maxRank: 10,
    mpCost: 20,
    effect: { kind: 'demoralizeAll', fraction: 0.75 },
  },
  healAll: {
    id: 'healAll',
    label: 'Heal All',
    blurb: 'Restore health to your whole team.',
    maxRank: 10,
    mpCost: 18,
    effect: { kind: 'healAll', amount: 60 },
  },
  net: {
    id: 'net',
    label: 'Net',
    blurb: 'Entangle a foe in a weighted net, slowing their turn.',
    maxRank: 10,
    mpCost: 10,
    effect: { kind: 'net', slowRounds: 2 },
  },
  whirlwind: {
    id: 'whirlwind',
    label: 'Whirlwind',
    blurb: 'A wide arc that strikes every enemy within reach.',
    maxRank: 10,
    mpCost: 12,
    effect: { kind: 'cleave', multiplier: 0.9 },
  },
  protect: {
    id: 'protect',
    label: 'Protect',
    blurb: 'Stand guard and intercept blows meant for your teammates.',
    maxRank: 10,
    mpCost: 8,
    effect: { kind: 'protect', rounds: 2 },
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
  armorBreak: {
    id: 'armorBreak',
    label: 'Armor Break',
    blurb: 'A crushing blow that punches through armor.',
    maxRank: 10,
    mpCost: 7,
    effect: { kind: 'strike', multiplier: 1.6 },
  },
  berserk: {
    id: 'berserk',
    label: 'Berserk',
    blurb: 'Enter a frenzy — your next attack hits much harder.',
    maxRank: 5,
    mpCost: 10,
    effect: { kind: 'warCry', damageBuff: 0.3 },
  },
  strikeOfWill: {
    id: 'strikeOfWill',
    label: 'Strike of the Will',
    blurb: 'A mighty blow fueled by sheer determination.',
    maxRank: 10,
    mpCost: 12,
    effect: { kind: 'strike', multiplier: 1.9 },
  },
  counterAttack: {
    id: 'counterAttack',
    label: 'Counter Attack',
    blurb: 'A quick retaliatory strike after blocking.',
    maxRank: 10,
    mpCost: 6,
    effect: { kind: 'strike', multiplier: 0.8 },
  },
  charismaBoost: {
    id: 'charismaBoost',
    label: 'Charisma Boost',
    blurb: 'Passive: +2 Charisma per rank.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'passive', stat: 'charisma', perRank: 2 },
  },
  powerThrow: {
    id: 'powerThrow',
    label: 'Power Throw',
    blurb: 'A heavy ranged throw with a high crit chance.',
    maxRank: 10,
    mpCost: 9,
    effect: { kind: 'throw', multiplier: 1.5, critBonus: 0.15 },
  },
  regeneration: {
    id: 'regeneration',
    label: 'Regeneration',
    blurb: 'Passive: restore torso HP every turn.',
    maxRank: 15,
    mpCost: 0,
    effect: { kind: 'regen', perRank: 3 },
  },
  warChant: {
    id: 'warChant',
    label: 'War Chant',
    blurb: 'A rallying chant that boosts your next attack.',
    maxRank: 10,
    mpCost: 6,
    effect: { kind: 'warCry', damageBuff: 0.25 },
  },
  flurry: {
    id: 'flurry',
    label: 'Flurry',
    blurb: 'A rapid three-hit assault.',
    maxRank: 10,
    mpCost: 12,
    effect: { kind: 'combo', hits: 3, multiplier: 0.6 },
  },
  sweepingBlade: {
    id: 'sweepingBlade',
    label: 'Sweeping Blade',
    blurb: 'A wide arc that cuts every foe in reach.',
    maxRank: 10,
    mpCost: 10,
    effect: { kind: 'cleave', multiplier: 0.8 },
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
  'demoralizeAll',
  'healAll',
  'net',
  'whirlwind',
  'protect',
  'speedBoost',
  'vitalityBoost',
  'strengthBoost',
  'dexterityBoost',
  'defenseBoost',
  'lifeBoost',
  'armorBreak',
  'berserk',
  'strikeOfWill',
  'counterAttack',
  'charismaBoost',
  'powerThrow',
  'regeneration',
  'warChant',
  'flurry',
  'sweepingBlade',
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

// ── Five skill-tree columns (bottom → top unlock progression) ──

/** Column points that must be invested before each higher rung unlocks. */
export const UNLOCK_STEP = 5;

export interface SkillTreeColumn {
  style: StyleKey;
  label: string;
  /** Skill ids ordered bottom (first) → top (last). */
  skills: readonly string[];
}

/** The five weapon-class skill trees, each read bottom-to-top. */
export const SKILL_TREES: readonly SkillTreeColumn[] = [
  { style: 'retiarius', label: 'RETIARIUS', skills: ['throw', 'net', 'powerThrow', 'dexterityBoost', 'speedBoost', 'regeneration'] },
  { style: 'thraex', label: 'THRAEX', skills: ['powerStrike', 'armorBreak', 'berserk', 'strikeOfWill', 'whirlwind', 'strengthBoost'] },
  { style: 'provocator', label: 'PROVOCATORES', skills: ['warCry', 'warChant', 'demoralize', 'demoralizeAll', 'heal', 'healAll', 'charismaBoost'] },
  { style: 'murmillo', label: 'MURMILLO', skills: ['shieldBash', 'protect', 'counterAttack', 'defenseBoost', 'lifeBoost'] },
  { style: 'dimachaerus', label: 'DIMACHAERUS', skills: ['doubleStrike', 'quadCombo', 'flurry', 'sweepingBlade', 'vitalityBoost'] },
];

/** The column a skill belongs to, if any. */
export function skillColumn(skillId: string): SkillTreeColumn | undefined {
  return SKILL_TREES.find((col) => col.skills.includes(skillId));
}

/** Total ranks already invested across a whole column. */
export function columnPoints(fighter: Fighter, column: SkillTreeColumn): number {
  return column.skills.reduce((sum, id) => sum + (fighter.skills[id] ?? 0), 0);
}

/** Column points required before `skillId` unlocks. */
export function skillUnlockCost(skillId: string): number {
  const col = skillColumn(skillId);
  if (!col) return Number.POSITIVE_INFINITY;
  return col.skills.indexOf(skillId) * UNLOCK_STEP;
}

/** Points still needed before `skillId` unlocks (0 once unlocked). */
export function skillUnlockRemaining(fighter: Fighter, skillId: string): number {
  const col = skillColumn(skillId);
  if (!col) return Number.POSITIVE_INFINITY;
  return Math.max(0, skillUnlockCost(skillId) - columnPoints(fighter, col));
}

/** True when `skillId` can be purchased right now (column progress met). */
export function isSkillUnlocked(fighter: Fighter, skillId: string): boolean {
  return skillUnlockRemaining(fighter, skillId) <= 0;
}
