import type { Fighter } from './types';
import type { GameState } from './engine';
import { ATTRIBUTE_POINTS_PER_LEVEL, SKILL_POINTS_PER_LEVEL } from './constants';
import { currentHp, restoreFighter, totalHp } from './stats';

/** XP required to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 50 + (level - 1) * 35;
}

/** Applies XP and returns a NEW fighter, leveling up as many times as earned. */
export function addXp(fighter: Fighter, amount: number): Fighter {
  let xp = fighter.xp + amount;
  let level = fighter.level;
  let attributePoints = fighter.attributePoints;
  let skillPoints = fighter.skillPoints;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    attributePoints += ATTRIBUTE_POINTS_PER_LEVEL;
    skillPoints += SKILL_POINTS_PER_LEVEL;
  }
  return { ...fighter, xp, level, attributePoints, skillPoints };
}

/** Gold cost to fully heal a wounded fighter (scales with missing HP). */
export function healCost(fighter: Fighter): number {
  const missing = Math.max(0, totalHp(fighter) - currentHp(fighter));
  return Math.max(1, Math.ceil(missing * 0.5));
}

/** Heals a fighter to full, deducting the cost. Returns a new state; throws if unaffordable. */
export function healToFull(state: GameState, index = 0): GameState {
  const fighter = state.roster[index];
  const cost = healCost(fighter);
  if (state.gold < cost) throw new Error('Not enough gold');
  const roster = [...state.roster];
  roster[index] = restoreFighter(fighter);
  return { ...state, gold: state.gold - cost, roster };
}

/** Gold cost of the next training point, growing with points already trained. */
export function trainCost(totalTrainedPoints: number): number {
  return Math.round(22 * Math.pow(1.2, totalTrainedPoints));
}

/** Reward for a victory against an opponent of the given level. */
export function victoryRewards(opponentLevel: number): { gold: number; xp: number } {
  return {
    gold: 40 + opponentLevel * 18,
    xp: 35 + opponentLevel * 15,
  };
}
