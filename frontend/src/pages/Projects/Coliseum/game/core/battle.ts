import type { Action, Equipment, EquipmentSlot, Fighter, TurnEvent } from './types';
import { createEquipment, type MetalId } from './equipment';
import { pick, type Rng } from './rng';
import { cloneFighter, resolveRound, weakestZone } from './engine';
import { victoryRewards } from './economy';
import { canMeleeAttack, clearZoneWounds, currentHp, destroyedLimbCount, totalHp } from './stats';

export interface BattleSnapshot {
  playerTeam: Fighter[];
  enemyTeam: Fighter[];
  round: number;
  playerWon: boolean;
  enemyWon: boolean;
  events: TurnEvent[];
}

export function startBattle(playerTeam: Fighter[], enemyTeam: Fighter[]): BattleSnapshot {
  return {
    playerTeam: playerTeam.map((f) => clearZoneWounds({ ...cloneFighter(f), startLimbsLost: destroyedLimbCount(f) })),
    enemyTeam: enemyTeam.map((f) => clearZoneWounds({ ...cloneFighter(f), startLimbsLost: destroyedLimbCount(f) })),
    round: 0,
    playerWon: false,
    enemyWon: false,
    events: [],
  };
}

/** Resolves one round for the given player actions; enemies act via built-in AI. */
export function stepBattle(
  snap: BattleSnapshot,
  playerActions: Readonly<Record<string, Action>>,
  rand: Rng = Math.random,
): BattleSnapshot {
  const result = resolveRound(snap.playerTeam, snap.enemyTeam, playerActions, rand);
  return {
    playerTeam: result.playerTeam,
    enemyTeam: result.enemyTeam,
    round: snap.round + 1,
    playerWon: result.playerWon,
    enemyWon: result.enemyWon,
    events: result.events,
  };
}

export type PlayerStrategy = (player: Fighter, enemy: Fighter) => Action;

/** A simple player AI used by auto-battle. */
export function autoStrategy(player: Fighter, enemy: Fighter): Action {
  if ((player.skills.heal ?? 0) > 0 && player.morale >= 10 && currentHp(player) < totalHp(player) * 0.5) {
    return { kind: 'skill', skillId: 'heal' };
  }
  if (!canMeleeAttack(player)) {
    if ((player.skills.throw ?? 0) > 0 && player.morale >= 6) {
      return { kind: 'skill', skillId: 'throw', targetId: enemy.id, targetZone: weakestZone(enemy) };
    }
    if ((player.skills.demoralize ?? 0) > 0 && player.morale >= 12) {
      return { kind: 'skill', skillId: 'demoralize', targetId: enemy.id, targetZone: weakestZone(enemy) };
    }
    return { kind: 'block' };
  }
  return { kind: 'attack', precision: 'medium', targetId: enemy.id, targetZone: weakestZone(enemy) };
}

/** Auto-battle actions for a whole team (each living player attacks a living enemy). */
export function autoTeamActions(
  playerTeam: Fighter[],
  enemyTeam: Fighter[],
  rand: Rng = Math.random,
): Record<string, Action> {
  const actions: Record<string, Action> = {};
  const targets = enemyTeam.filter((f) => f.alive);
  for (const fighter of playerTeam) {
    if (!fighter.alive) continue;
    if ((fighter.skills.heal ?? 0) > 0 && fighter.morale >= 10 && currentHp(fighter) < totalHp(fighter) * 0.5) {
      actions[fighter.id] = { kind: 'skill', skillId: 'heal' };
      continue;
    }
    const target = targets.length > 0 ? pick(targets, rand) : enemyTeam[0];
    if (!canMeleeAttack(fighter)) {
      if ((fighter.skills.throw ?? 0) > 0 && fighter.morale >= 6) {
        actions[fighter.id] = { kind: 'skill', skillId: 'throw', targetId: target.id, targetZone: weakestZone(target) };
      } else {
        actions[fighter.id] = { kind: 'block' };
      }
      continue;
    }
    actions[fighter.id] = {
      kind: 'attack',
      precision: 'medium',
      targetId: target.id,
      targetZone: weakestZone(target),
    };
  }
  return actions;
}

/** Runs a full battle with the built-in player AI (for auto-battle). */
export function autoBattle(
  player: Fighter,
  enemy: Fighter,
  rand: Rng = Math.random,
): { playerWon: boolean; rounds: number } {
  return simulateBattle(player, enemy, autoStrategy, rand);
}

/** Runs a battle to completion with a fixed strategy (for tests/auto-battle). */
export function simulateBattle(
  player: Fighter,
  enemy: Fighter,
  strategy: PlayerStrategy,
  rand: Rng = Math.random,
): { playerWon: boolean; rounds: number } {
  let snap = startBattle([player], [enemy]);
  for (let i = 0; i < 200; i += 1) {
    if (snap.playerWon || snap.enemyWon) break;
    snap = stepBattle(
      snap,
      { [player.id]: strategy(snap.playerTeam[0], snap.enemyTeam[0]) },
      rand,
    );
  }
  return { playerWon: snap.playerWon, rounds: snap.round };
}

export type Verdict = 'mercy' | 'execute';

/**
 * The crowd's wish at match end: the mob always pleads for mercy over a
 * fallen foe (the reference's "THE CROWD ASKS FOR MERCY"). The player may
 * still choose blood (execute) for extra loot instead.
 */
export function crowdWish(): Verdict {
  return 'mercy';
}

export interface BattleRewards {
  gold: number;
  xp: number;
  maxMoraleGain: number;
  metals: Partial<Record<MetalId, number>>;
}

/** Post-battle rewards: mercy favors XP + MP growth, execute favors gold + metal loot. */
export function postBattleRewards(enemyLevel: number, verdict: Verdict, cityTier = 0): BattleRewards {
  const base = victoryRewards(enemyLevel);
  if (verdict === 'mercy') {
    return { gold: base.gold, xp: base.xp + Math.round(base.xp * 0.5), maxMoraleGain: 2, metals: {} };
  }
  // Metal tier follows the CITY (0..9), not the opponent level, so early
  // arenas can't hand out end-game ingots.
  const metal: MetalId =
    cityTier >= 8 ? 'gold' : cityTier >= 5 ? 'silver' : cityTier >= 3 ? 'iron' : 'bronze';
  return {
    gold: base.gold + Math.round(base.gold * 0.6),
    xp: base.xp,
    maxMoraleGain: 0,
    metals: { [metal]: 1 },
  };
}

const LOOT_SLOTS: readonly EquipmentSlot[] = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'legs',
  'mainHand',
  'offHand',
];

/** Equipment dropped by a defeated opponent. Executing yields extra loot.
 *  Drop tier follows the city's gear tier, so an early arena's champion can't
 *  hand out end-game gear. */
export function rollLoot(cityTier: number, verdict: Verdict, rand: Rng = Math.random): Equipment[] {
  const tier = Math.max(0, Math.min(9, cityTier));
  let count = 1 + Math.floor(rand() * 2); // 1–2 base drops
  if (verdict === 'execute') count += 2; // execution: +2 extra loot
  const items: Equipment[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = pick(LOOT_SLOTS, rand);
    // Drops match the city's gear tier (a rung below its shop, never ahead).
    const itemTier = Math.max(0, Math.min(9, tier - 1 + Math.floor(rand() * 2)));
    items.push(createEquipment(slot, itemTier, { rand }));
  }
  return items;
}
