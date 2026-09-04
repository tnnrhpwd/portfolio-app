import type { Attributes, BodyZone, Equipment, Fighter, Loadout, ZoneMap } from './types';
import { ARMOR_COMBAT_MULTIPLIER, BLOCK_CAP, BODY_ZONES, ZONE_HP_SPLIT } from './constants';
import { clamp } from './rng';
import { getSkill } from './skills';

/** HP granted per point of Vitality at a given level.
 *  ~50 at level 1 and ~56 at level 70 (tuning target refined in Phase 3). */
export function hpPerVitality(level: number): number {
  return 50 + 0.1 * (level - 1);
}

/** Attributes with passive skill bonuses applied. */
export function effectiveAttributes(fighter: Fighter): Attributes {
  const out: Attributes = { ...fighter.attributes };
  for (const [id, rank] of Object.entries(fighter.skills)) {
    const node = getSkill(id);
    if (node?.effect.kind === 'passive') out[node.effect.stat] += node.effect.perRank * rank;
  }
  return out;
}

/** Total flat HP granted by Life Boost ranks. */
export function lifeBoostTotal(fighter: Fighter): number {
  let total = 0;
  for (const [id, rank] of Object.entries(fighter.skills)) {
    const node = getSkill(id);
    if (node?.effect.kind === 'lifeBoost') total += node.effect.perRank * rank;
  }
  return total;
}

/** Torso HP mended each turn by Regeneration ranks. */
export function regenTotal(fighter: Fighter): number {
  let total = 0;
  for (const [id, rank] of Object.entries(fighter.skills)) {
    const node = getSkill(id);
    if (node?.effect.kind === 'regen') total += node.effect.perRank * rank;
  }
  return total;
}

/** Total maximum HP, including Vitality scaling and Life Boost. */
export function totalHp(fighter: Fighter, extraLifeBoost = 0): number {
  return (
    Math.floor(effectiveAttributes(fighter).vitality * hpPerVitality(fighter.level)) +
    lifeBoostTotal(fighter) +
    extraLifeBoost
  );
}

/**
 * Morale restored by a single Crowd Appeal, driven by Charisma.
 * The reference balance fits ~2.2 MP restored per point of Charisma,
 * capped at the fighter's maximum MP pool (see the Charisma→MP table:
 * 760 MP needs ~365 Charisma, 440 MP needs ~204, 320 MP needs ~145).
 */
export function crowdAppealRestore(fighter: Fighter): number {
  const charisma = effectiveAttributes(fighter).charisma;
  return Math.min(fighter.maxMorale, Math.max(0, Math.round(charisma * 2.2)));
}

/** Sum of current flesh HP across all zones. */
export function currentHp(fighter: Fighter): number {
  let sum = 0;
  for (const zone of BODY_ZONES) sum += fighter.zones[zone].hp;
  return sum;
}

/**
 * Splits total HP into per-zone maximums using the fixed fractions, then
 * gives any flooring remainder to the torso so the six parts sum exactly to
 * `total`. Without this, a fully-healed fighter sits a few HP below its
 * displayed total and the infirmary keeps charging for the unhealable gap.
 */
export function zoneMaxHp(total: number): Record<BodyZone, number> {
  const out = {} as Record<BodyZone, number>;
  let sum = 0;
  for (const zone of BODY_ZONES) {
    out[zone] = Math.max(1, Math.floor(total * ZONE_HP_SPLIT[zone]));
    sum += out[zone];
  }
  out.torso = Math.max(1, out.torso + (total - sum));
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
  zone.wounded = true; // hit this match — below half HP it starts bleeding
  return { absorbed: effective, toFlesh };
}

/** Applies one turn of wound bleed to a zone (mutates); returns HP drained. */
export function bleedZone(zone: ZoneMap[BodyZone], perTurn: number): number {
  if (zone.wounded && zone.hp > 0 && zone.hp * 2 < zone.maxHp) {
    zone.hp = Math.max(0, zone.hp - perTurn);
    return perTurn;
  }
  return 0;
}

/** Clears per-match wound flags so pre-existing damage doesn't count as fresh. */
export function clearZoneWounds(fighter: Fighter): Fighter {
  const zones = {} as ZoneMap;
  for (const zone of BODY_ZONES) {
    zones[zone] = { ...fighter.zones[zone], wounded: false };
  }
  return { ...fighter, zones };
}

export function isZoneDestroyed(fighter: Fighter, zone: BodyZone): boolean {
  return fighter.zones[zone].hp <= 0;
}

/** The four destroyable limbs (arms + legs). */
export const LIMB_ZONES: readonly BodyZone[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

const TWO_HANDED_KINDS = new Set(['greatsword', 'maul', 'halberd']);

/** How many limbs (arms/legs) have been destroyed. */
export function destroyedLimbCount(fighter: Fighter): number {
  return LIMB_ZONES.filter((zone) => isZoneDestroyed(fighter, zone)).length;
}

/** True when either leg is destroyed — the fighter can no longer move into melee. */
export function legsCrippled(fighter: Fighter): boolean {
  return isZoneDestroyed(fighter, 'leftLeg') || isZoneDestroyed(fighter, 'rightLeg');
}

/** The main-hand weapon is usable only while its arm (and, for two-handers, both arms) is intact. */
export function usableMainHand(fighter: Fighter): Equipment | null {
  const weapon = fighter.loadout.mainHand;
  if (!weapon) return null;
  if (isZoneDestroyed(fighter, 'rightArm')) return null;
  if (TWO_HANDED_KINDS.has(weapon.kind ?? '') && isZoneDestroyed(fighter, 'leftArm')) return null;
  return weapon;
}

/** An off-hand weapon (not a shield) usable while the left arm is intact. */
export function usableOffHandWeapon(fighter: Fighter): Equipment | null {
  const weapon = fighter.loadout.offHand;
  if (!weapon || weapon.minDamage === undefined) return null;
  if (isZoneDestroyed(fighter, 'leftArm')) return null;
  return weapon;
}

/** Whether a fighter can still deliver a melee attack at all. */
export function canMeleeAttack(fighter: Fighter): boolean {
  // Legs gate movement; a destroyed arm only disables that hand's weapon
  // (rollDamageWith falls back to the other hand or an unarmed strike).
  return !legsCrippled(fighter);
}

/** A fighter is defeated when the head or torso is destroyed, or two limbs are lost. */
export function isDefeated(fighter: Fighter): boolean {
  return (
    isZoneDestroyed(fighter, 'head') ||
    isZoneDestroyed(fighter, 'torso') ||
    destroyedLimbCount(fighter) >= 2
  );
}

/** Shield block chance, clamped to the 72% cap. */
export function blockChance(fighter: Fighter): number {
  if (isZoneDestroyed(fighter, 'leftArm')) return 0;
  const shield = fighter.loadout.offHand;
  if (!shield || shield.blockChance === undefined) return 0;
  return clamp(shield.blockChance, 0, BLOCK_CAP);
}

export function blockValue(fighter: Fighter): number {
  if (isZoneDestroyed(fighter, 'leftArm')) return 0;
  const shield = fighter.loadout.offHand;
  return shield?.blockValue ?? 0;
}

/** Rebuilds derived values (max HP and armor) after attribute/gear changes,
 *  preserving each zone's current HP fraction. */
export function recomputeDerived(fighter: Fighter, lifeBoost = 0): Fighter {
  const fresh = buildZones(fighter, lifeBoost);
  const zones = {} as ZoneMap;
  for (const zone of BODY_ZONES) {
    const oldMax = fighter.zones[zone].maxHp || 1;
    const ratio = fighter.zones[zone].hp / oldMax;
    const maxHp = fresh[zone].maxHp;
    zones[zone] = {
      ...fresh[zone],
      hp: Math.max(0, Math.min(maxHp, Math.round(maxHp * ratio))),
    };
  }
  return { ...fighter, zones };
}

/** Fully heals a fighter: max HP and refreshed armor. Returns a new fighter. */
export function restoreFighter(fighter: Fighter): Fighter {
  return { ...fighter, zones: buildZones(fighter) };
}
