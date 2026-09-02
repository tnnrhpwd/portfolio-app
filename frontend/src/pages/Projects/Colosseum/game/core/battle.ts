import type { Action, Fighter, TurnEvent } from './types';
import type { MetalId } from './equipment';
import type { Rng } from './rng';
import { cloneFighter, resolveRound } from './engine';
import { victoryRewards } from './economy';

export interface BattleSnapshot {
  player: Fighter;
  enemy: Fighter;
  round: number;
  playerWon: boolean;
  enemyWon: boolean;
  events: TurnEvent[];
}

export function startBattle(player: Fighter, enemy: Fighter): BattleSnapshot {
  return {
    player: cloneFighter(player),
    enemy: cloneFighter(enemy),
    round: 0,
    playerWon: false,
    enemyWon: false,
    events: [],
  };
}

/** Resolves one round using the player's action; the enemy acts via built-in AI. */
export function stepBattle(snap: BattleSnapshot, action: Action, rand: Rng = Math.random): BattleSnapshot {
  const result = resolveRound([snap.player], [snap.enemy], { [snap.player.id]: action }, rand);
  return {
    player: result.playerTeam[0],
    enemy: result.enemyTeam[0],
    round: snap.round + 1,
    playerWon: result.playerWon,
    enemyWon: result.enemyWon,
    events: result.events,
  };
}

export type PlayerStrategy = (player: Fighter, enemy: Fighter) => Action;

/** Runs a battle to completion with a fixed strategy (for tests/auto-battle). */
export function simulateBattle(
  player: Fighter,
  enemy: Fighter,
  strategy: PlayerStrategy,
  rand: Rng = Math.random,
): { playerWon: boolean; rounds: number } {
  let snap = startBattle(player, enemy);
  for (let i = 0; i < 200; i += 1) {
    if (snap.playerWon || snap.enemyWon) break;
    snap = stepBattle(snap, strategy(snap.player, snap.enemy), rand);
  }
  return { playerWon: snap.playerWon, rounds: snap.round };
}

export type Verdict = 'mercy' | 'execute';

export interface BattleRewards {
  gold: number;
  xp: number;
  maxMoraleGain: number;
  metals: Partial<Record<MetalId, number>>;
}

/** Post-battle rewards: mercy favors XP + MP growth, execute favors gold + metal loot. */
export function postBattleRewards(enemyLevel: number, verdict: Verdict): BattleRewards {
  const base = victoryRewards(enemyLevel);
  if (verdict === 'mercy') {
    return { gold: base.gold, xp: base.xp + Math.round(base.xp * 0.5), maxMoraleGain: 2, metals: {} };
  }
  const metal: MetalId =
    enemyLevel >= 8 ? 'gold' : enemyLevel >= 5 ? 'silver' : enemyLevel >= 3 ? 'iron' : 'bronze';
  return {
    gold: base.gold + Math.round(base.gold * 0.6),
    xp: base.xp,
    maxMoraleGain: 0,
    metals: { [metal]: 1 },
  };
}
