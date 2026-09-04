import type { AttackOutcome, AttackPrecision, BodyZone, Equipment, Fighter } from './types';
import type { Rng } from './rng';
import { CRIT_CHANCE, CRIT_MULTIPLIER, PRECISION } from './constants';
import { clamp } from './rng';
import { applyZoneDamage, blockChance, blockValue, effectiveAttributes, usableMainHand, usableOffHandWeapon } from './stats';

/** Effective initiative (Speed + passives), halved while slowed. */
export function initiative(fighter: Fighter): number {
  const base = effectiveAttributes(fighter).speed;
  return fighter.status.slow > 0 ? base * 0.5 : base;
}

/** Returns fighters sorted so the fastest acts first (stable for ties). */
export function sortTurnOrder<T extends Fighter>(fighters: readonly T[]): T[] {
  return [...fighters].sort((a, b) => initiative(b) - initiative(a));
}

/** Base hit chance from DEX vs DEF. Misses happen below half the target's DEF. */
export function hitChance(attackerDex: number, defenderDef: number): number {
  if (defenderDef <= 0) return 1;
  if (attackerDex * 2 < defenderDef) return 0;
  return clamp(attackerDex / defenderDef, 0.5, 1);
}

/** Final hit chance for a precision tier. */
export function precisionHitChance(
  attackerDex: number,
  defenderDef: number,
  precision: AttackPrecision,
): number {
  return hitChance(attackerDex, defenderDef) * PRECISION[precision].hitChance;
}

export interface RawDamage {
  raw: number;
  crit: boolean;
}

/** Rolls raw damage for a specific weapon (or unarmed when null), with multipliers. */
export function rollDamageWithWeapon(
  fighter: Fighter,
  weapon: Equipment | null,
  precision: AttackPrecision,
  rand: Rng = Math.random,
  damageMult = 1,
  critBonus = 0,
): RawDamage {
  const minDamage = weapon?.minDamage ?? 5;
  const maxDamage = weapon?.maxDamage ?? 10;
  const base = minDamage + rand() * (maxDamage - minDamage);
  const variance = 0.85 + rand() * 0.3;
  const crit = rand() < CRIT_CHANCE + critBonus + (weapon?.critBonus ?? 0);
  const warcry = fighter.status.buffed > 0 ? 1.2 : 1;
  const mult = PRECISION[precision].damage * (crit ? CRIT_MULTIPLIER : 1) * damageMult * warcry;
  const raw = (base + effectiveAttributes(fighter).strength) * mult * variance;
  return { raw: Math.max(1, Math.round(raw)), crit };
}

/** Rolls raw damage with the fighter's usable weapon (main hand, then off hand). */
export function rollDamageWith(
  fighter: Fighter,
  precision: AttackPrecision,
  rand: Rng = Math.random,
  damageMult = 1,
  critBonus = 0,
): RawDamage {
  const weapon = usableMainHand(fighter) ?? usableOffHandWeapon(fighter);
  return rollDamageWithWeapon(fighter, weapon, precision, rand, damageMult, critBonus);
}

/** Rolls raw damage for a precision tier (strength-scaled, with variance). */
export function rollDamage(
  fighter: Fighter,
  precision: AttackPrecision,
  rand: Rng = Math.random,
): RawDamage {
  return rollDamageWith(fighter, precision, rand);
}

export interface HitMods {
  damageMult?: number;
  critBonus?: number;
  hitMult?: number;
  /** Force a specific weapon for this hit (dual-wield combos alternate hands). */
  weapon?: Equipment | null;
}

/** Resolves a hit against a zone with optional multipliers (used by skills). */
export function resolveHit(
  attacker: Fighter,
  defender: Fighter,
  precision: AttackPrecision,
  zone: BodyZone,
  rand: Rng = Math.random,
  mods: HitMods = {},
): AttackOutcome {
  const chance =
    precisionHitChance(
      effectiveAttributes(attacker).dexterity,
      effectiveAttributes(defender).defense,
      precision,
    ) * (mods.hitMult ?? 1);
  if (rand() > chance) {
    return { hit: false, blocked: false, crit: false, damage: 0, armorAbsorbed: 0 };
  }

  const weapon =
    mods.weapon !== undefined ? mods.weapon : usableMainHand(attacker) ?? usableOffHandWeapon(attacker);
  let { raw, crit } = rollDamageWithWeapon(
    attacker,
    weapon,
    precision,
    rand,
    mods.damageMult ?? 1,
    mods.critBonus ?? 0,
  );

  let blocked = false;
  const bc = blockChance(defender);
  if (bc > 0 && rand() < bc / 100) {
    blocked = true;
    raw = Math.max(0, raw - blockValue(defender));
  }

  const { toFlesh, absorbed } = applyZoneDamage(defender.zones[zone], raw);
  return { hit: true, blocked, crit, damage: toFlesh, armorAbsorbed: absorbed };
}

/** Resolves a full attack against a single zone, including hit/block/armor. */
export function resolveAttack(
  attacker: Fighter,
  defender: Fighter,
  precision: AttackPrecision,
  zone: BodyZone,
  rand: Rng = Math.random,
): AttackOutcome {
  return resolveHit(attacker, defender, precision, zone, rand);
}
