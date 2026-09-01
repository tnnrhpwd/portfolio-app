import type { BodyZone, Fighter, Loadout, ZoneMap } from './types';
import { ARMOR_COMBAT_MULTIPLIER, BLOCK_CAP, BODY_ZONES, ZONE_HP_SPLIT } from './constants';
import { clamp } from './rng';

/** HP granted per point of Vitality at a given level.
 *  ~50 at level 1 and ~56 at level 70 (tuning target refined in Phase 3). */
export function hpPerVitality(level: number): number {
  return 50 + 0.1 * (level - 1);
}

/** Total maximum HP for a fighter, before any Life Boost skill bonus. */
export function totalHp(fighter: Fighter, lifeBoost = 0): number {
  return Math.floor(fighter.attributes.vitality * hpPerVitality(fighter.level)) + lifeBoost;
}

/** Sum of current flesh HP across all zones. */
export function currentHp(fighter: Fighter): number {
  let sum = 0;
  for (const zone of BODY_ZONES) sum += fighter.zones[zone].hp;
  return sum;
}

/** Splits total HP into per-zone maximums using the fixed fractions. */
export function zoneMaxHp(total: number): Record<BodyZone, number> {
  const out = {} as Record<BodyZone, number>;
  for (const zone of BODY_ZONES) out[zone] = Math.max(1, Math.floor(total * ZONE_HP_SPLIT[zone]));
  return out;
}

const ZONE_TO_SLOT: Record<BodyZone, keyof Loadout> = {
  head: 'head',
  torso: 'torso',
  leftArm: 'leftArm',
  rightArm: 'rightArm',
  leftLeg: 'legs',
  rightLeg: 'legs',
};

/** Displayed armor value on a zone (from the equipped piece). */
export function displayedArmor(fighter: Fighter, zone: BodyZone): number {
  const item = fighter.loadout[ZONE_TO_SLOT[zone]];
  return item ? item.armor : 0;
}

/** Effective armor in combat: displayed value doubles. */
export function combatArmor(fighter: Fighter, zone: BodyZone): number {
  return displayedArmor(fighter, zone) * ARMOR_COMBAT_MULTIPLIER;
}

/** Builds a healthy ZoneMap for a fighter (armor from gear, flesh from VIT). */
export function buildZones(fighter: Fighter, lifeBoost = 0): ZoneMap {
  const split = zoneMaxHp(totalHp(fighter, lifeBoost));
  const zones = {} as ZoneMap;
  for (const zone of BODY_ZONES) {
    zones[zone] = { armor: displayedArmor(fighter, zone), hp: split[zone], maxHp: split[zone] };
  }
  return zones;
}

export interface ZoneDamage {
  /** Damage absorbed by the armor layer. */
  absorbed: number;
  /** Damage that reached flesh. */
  toFlesh: number;
}

/** Applies damage to a zone: armor layer first, then flesh. */
export function applyZoneDamage(zone: ZoneMap[BodyZone], amount: number): ZoneDamage {
  const effective = zone.armor * ARMOR_COMBAT_MULTIPLIER;
  if (amount <= effective) {
    zone.armor = Math.max(0, zone.armor - Math.ceil(amount / ARMOR_COMBAT_MULTIPLIER));
    return { absorbed: amount, toFlesh: 0 };
  }
  const toFlesh = amount - effective;
  zone.armor = 0;
  zone.hp = Math.max(0, zone.hp - toFlesh);
  return { absorbed: effective, toFlesh };
}

export function isZoneDestroyed(fighter: Fighter, zone: BodyZone): boolean {
  return fighter.zones[zone].hp <= 0;
}

/** A fighter is defeated when head or torso is destroyed. */
export function isDefeated(fighter: Fighter): boolean {
  return isZoneDestroyed(fighter, 'head') || isZoneDestroyed(fighter, 'torso');
}

/** Shield block chance, clamped to the 72% cap. */
export function blockChance(fighter: Fighter): number {
  const shield = fighter.loadout.offHand;
  if (!shield || shield.blockChance === undefined) return 0;
  return clamp(shield.blockChance, 0, BLOCK_CAP);
}

export function blockValue(fighter: Fighter): number {
  const shield = fighter.loadout.offHand;
  return shield?.blockValue ?? 0;
}
