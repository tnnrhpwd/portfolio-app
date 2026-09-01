import type { AttackOutcome, AttackPrecision, BodyZone, Fighter } from './types';
import type { Rng } from './rng';
import { CRIT_CHANCE, CRIT_MULTIPLIER, PRECISION } from './constants';
import { clamp } from './rng';
import { applyZoneDamage, blockChance, blockValue } from './stats';

/** Effective initiative, halved while slowed. */
export function initiative(fighter: Fighter): number {
  const base = fighter.attributes.speed;
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

/** Rolls raw damage for a precision tier (strength-scaled, with variance). */
export function rollDamage(
  fighter: Fighter,
  precision: AttackPrecision,
  rand: Rng = Math.random,
): RawDamage {
  const weapon = fighter.loadout.mainHand;
  const minDamage = weapon?.minDamage ?? 5;
  const maxDamage = weapon?.maxDamage ?? 10;
  const base = minDamage + rand() * (maxDamage - minDamage);
  const variance = 0.85 + rand() * 0.3;
  const crit = rand() < CRIT_CHANCE;
  const mult = PRECISION[precision].damage * (crit ? CRIT_MULTIPLIER : 1);
  const raw = (base + fighter.attributes.strength) * mult * variance;
  return { raw: Math.max(1, Math.round(raw)), crit };
}

/** Resolves a full attack against a single zone, including hit/block/armor. */
export function resolveAttack(
  attacker: Fighter,
  defender: Fighter,
  precision: AttackPrecision,
  zone: BodyZone,
  rand: Rng = Math.random,
): AttackOutcome {
  const chance = precisionHitChance(
    attacker.attributes.dexterity,
    defender.attributes.defense,
    precision,
  );
  if (rand() > chance) {
    return { hit: false, blocked: false, crit: false, damage: 0, armorAbsorbed: 0 };
  }

  let { raw, crit } = rollDamage(attacker, precision, rand);

  let blocked = false;
  const bc = blockChance(defender);
  if (bc > 0 && rand() < bc / 100) {
    blocked = true;
    raw = Math.max(0, raw - blockValue(defender));
  }

  const { toFlesh, absorbed } = applyZoneDamage(defender.zones[zone], raw);
  return { hit: true, blocked, crit, damage: toFlesh, armorAbsorbed: absorbed };
}
