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

function slotName(slot: EquipmentSlot): string {
  switch (slot) {
    case 'head':
      return 'Helm';
    case 'torso':
      return 'Cuirass';
    case 'leftArm':
      return 'Arm Guard';
    case 'rightArm':
      return 'Vambrace';
    case 'legs':
      return 'Greaves';
    case 'mainHand':
      return 'Weapon';
    case 'offHand':
      return 'Shield';
  }
}

export interface CreateEquipmentOptions {
  crafted?: boolean;
  rand?: Rng;
  name?: string;
  /** When true, an off-hand item is a second weapon instead of a shield. */
  weapon?: boolean;
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
    name: opts.name ?? `${tierName(tier)} ${isWeapon && slot === 'offHand' ? 'Blade' : slotName(slot)}`,
    tier,
    quality,
    armor,
    bonuses,
    affixCount,
  };

  if (isWeapon) {
    item.minDamage = Math.round((6 + tier * 4) * quality);
    item.maxDamage = Math.round((12 + tier * 6) * quality);
  }
  if (isShield) {
    item.blockChance = Math.min(BLOCK_CAP, 20 + tier * 10);
    item.blockValue = 4 + tier * 3;
  }

  return item;
}
