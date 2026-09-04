import type { Attributes, Equipment, EquipmentSlot } from './types';
import type { Rng } from './rng';
import { pick } from './rng';
import { BLOCK_CAP } from './constants';

export const QUALITY_MIN = 1.3;
export const QUALITY_MAX = 1.6;
export const SHOP_AFFIX_CAP = 4;
export const CRAFTED_AFFIX_CAP = 6;
export const MAX_AFFIX_VALUE = 20;

/** Metals consumed by the blacksmith, in ascending value. */
export const METALS = [
  { id: 'bronze', label: 'Bronze' },
  { id: 'iron', label: 'Iron' },
  { id: 'silver', label: 'Silver' },
  { id: 'gold', label: 'Gold' },
] as const;

export type MetalId = (typeof METALS)[number]['id'];

/** Attribute keys that can appear as item affixes. */
const AFFIX_KEYS: readonly (keyof Attributes)[] = [
  'strength',
  'dexterity',
  'speed',
  'defense',
  'vitality',
  'charisma',
];

export function rollQuality(rand: Rng = Math.random): number {
  return QUALITY_MIN + rand() * (QUALITY_MAX - QUALITY_MIN);
}

export function rollAffixCount(crafted: boolean, rand: Rng = Math.random): number {
  const cap = crafted ? CRAFTED_AFFIX_CAP : SHOP_AFFIX_CAP;
  return Math.floor(rand() * (cap + 1));
}

let equipSeq = 0;
export function nextEquipId(): string {
  equipSeq += 1;
  return `eq_${equipSeq}`;
}

const TIER_NAMES = [
  'Worn', 'Bronze', 'Iron', 'Steel', 'Silver', 'Gold', 'Ornate', 'Masterwork', 'Royal', 'Legendary',
] as const;

function tierName(tier: number): string {
  return TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, tier))];
}

function armorSlotName(slot: EquipmentSlot): string {
  switch (slot) {
    case 'head':
      return 'Helmet';
    case 'torso':
      return 'Cuirass';
    case 'leftArm':
      return 'Pauldron';
    case 'rightArm':
      return 'Gauntlet';
    case 'legs':
      return 'Greaves';
    default:
      return 'Gear';
  }
}

// ── Weapon & shield archetypes (historical gladiator gear) ──

interface WeaponKindDef {
  label: string;
  /** Base minimum damage; max = min + spread, both scaled by tier + quality. */
  min: number;
  spread: number;
  /** Extra critical-hit chance this weapon grants. */
  critBonus: number;
  twoHanded: boolean;
}

const WEAPON_KINDS: Record<string, WeaponKindDef> = {
  gladius: { label: 'Gladius', min: 6, spread: 6, critBonus: 0, twoHanded: false },
  axe: { label: 'Securis', min: 4, spread: 12, critBonus: 0.04, twoHanded: false },
  mace: { label: 'Clava', min: 8, spread: 4, critBonus: 0, twoHanded: false },
  spear: { label: 'Hasta', min: 5, spread: 6, critBonus: 0.06, twoHanded: false },
  dagger: { label: 'Pugio', min: 4, spread: 4, critBonus: 0.03, twoHanded: false },
  trident: { label: 'Trident', min: 6, spread: 6, critBonus: 0.05, twoHanded: false },
  greatsword: { label: 'Spatha', min: 10, spread: 8, critBonus: 0, twoHanded: true },
  maul: { label: 'Maul', min: 12, spread: 6, critBonus: 0, twoHanded: true },
  halberd: { label: 'Halberd', min: 9, spread: 7, critBonus: 0.02, twoHanded: true },
};

const ONE_HAND_WEAPONS = ['gladius', 'axe', 'mace', 'spear', 'dagger', 'trident'] as const;
const OFFHAND_WEAPONS = ['dagger', 'gladius'] as const;
const TWO_HAND_WEAPONS = ['greatsword', 'maul', 'halberd'] as const;

interface ShieldKindDef {
  label: string;
  blockBase: number;
  blockPerTier: number;
  valueBase: number;
  valuePerTier: number;
}

const SHIELD_KINDS: Record<string, ShieldKindDef> = {
  buckler: { label: 'Buckler', blockBase: 12, blockPerTier: 8, valueBase: 3, valuePerTier: 2 },
  round: { label: 'Round Shield', blockBase: 18, blockPerTier: 9, valueBase: 4, valuePerTier: 3 },
  tower: { label: 'Tower Shield', blockBase:24, blockPerTier: 10, valueBase: 6, valuePerTier: 3 },
  net: { label: 'Net', blockBase: 8, blockPerTier: 4, valueBase: 2, valuePerTier: 1 },
};

export type WeaponKind = keyof typeof WEAPON_KINDS;
export type ShieldKind = keyof typeof SHIELD_KINDS;

export interface CreateEquipmentOptions {
  crafted?: boolean;
  rand?: Rng;
  name?: string;
  /** When true, an off-hand item is a second weapon instead of a shield. */
  weapon?: boolean;
  /** Force a specific weapon/shield archetype (e.g. 'spear', 'tower', 'net'). */
  kind?: string;
}

export function createEquipment(
  slot: EquipmentSlot,
  tier: number,
  opts: CreateEquipmentOptions = {},
): Equipment {
  const rand = opts.rand ?? Math.random;
  const crafted = opts.crafted ?? false;
  const quality = crafted ? rollQuality(rand) : 1;

  const isWeapon = slot === 'mainHand' || (slot === 'offHand' && opts.weapon === true);
  const isShield = slot === 'offHand' && opts.weapon !== true;
  const isHand = isWeapon || isShield;
  const armor = isHand ? 0 : Math.round((10 + tier * 8) * quality);

  const affixCount = rollAffixCount(crafted, rand);
  const bonuses: Partial<Attributes> = {};
  for (let i = 0; i < affixCount; i += 1) {
    const key = pick(AFFIX_KEYS, rand);
    bonuses[key] = (bonuses[key] ?? 0) + 1 + Math.floor(rand() * MAX_AFFIX_VALUE);
  }

  const item: Equipment = {
    id: nextEquipId(),
    slot,
    name: '',
    tier,
    quality,
    armor,
    bonuses,
    affixCount,
  };

  if (isWeapon) {
    const kind = opts.kind ?? pick(slot === 'mainHand' ? ONE_HAND_WEAPONS : OFFHAND_WEAPONS, rand);
    const def = WEAPON_KINDS[kind] ?? WEAPON_KINDS.gladius;
    item.kind = kind;
    item.minDamage = Math.round((def.min + tier * 4) * quality);
    item.maxDamage = Math.round((def.min + def.spread + tier * 6) * quality);
    item.critBonus = def.critBonus;
    item.name = `${tierName(tier)} ${def.label}`;
  } else if (isShield) {
    const kind = opts.kind ?? pick(['buckler', 'round', 'tower'] as const, rand);
    const def = SHIELD_KINDS[kind] ?? SHIELD_KINDS.round;
    item.kind = kind;
    item.blockChance = Math.min(BLOCK_CAP, def.blockBase + tier * def.blockPerTier);
    item.blockValue = def.valueBase + tier * def.valuePerTier;
    item.name = `${tierName(tier)} ${def.label}`;
  } else {
    item.kind = slot;
    item.name = `${tierName(tier)} ${armorSlotName(slot)}`;
  }

  item.name = opts.name ?? item.name;
  return item;
}

/** Picks a two-handed weapon archetype (used by the Thraex style). */
export function randomTwoHandedWeapon(rand: Rng = Math.random): WeaponKind {
  return pick(TWO_HAND_WEAPONS, rand);
}

/** True when the item is a two-handed weapon (occupies both hands). */
export function isTwoHandedWeapon(item: Equipment): boolean {
  return item.minDamage !== undefined && (WEAPON_KINDS[item.kind ?? '']?.twoHanded ?? false);
}
