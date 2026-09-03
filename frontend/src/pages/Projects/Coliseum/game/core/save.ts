import type { GameState } from './engine';

/** Serializes the game state to a compact JSON string for cloud/local storage. */
export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

/** Parses and minimally validates a saved state. Returns null when invalid. */
export function deserializeState(json: string): GameState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as GameState;
    if (!parsed || !Array.isArray(parsed.roster) || parsed.roster.length === 0) return null;
    if (typeof parsed.gold !== 'number' || typeof parsed.fame !== 'number') return null;
    if (!parsed.coliseumRanks || typeof parsed.coliseumRanks !== 'object') parsed.coliseumRanks = {};
    return parsed;
  } catch {
    return null;
  }
}
