import type { Fighter, GameState } from '../core';
import { createCampaignStart } from '../core';

const SAVE_KEY = 'colosseum.save.v1';

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function load(): GameState | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || !Array.isArray(parsed.roster) || parsed.roster.length === 0) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

/** Back-fills fields added in later phases so old saves keep working. */
function migrate(state: GameState): GameState {
  return {
    ...state,
    inventory: state.inventory ?? [],
    metals: state.metals ?? { bronze: 0, iron: 0, silver: 0, gold: 0 },
    roster: state.roster.map((fighter) => {
      const status = fighter.status ?? {};
      return {
        ...fighter,
        skills: fighter.skills ?? {},
        status: {
          stun: status.stun ?? 0,
          slow: status.slow ?? 0,
          defending: status.defending ?? false,
          bleeding: status.bleeding ?? 0,
          buffed: status.buffed ?? 0,
        },
      };
    }),
  };
}

let state: GameState = load() ?? createCampaignStart();

export function getState(): GameState {
  return state;
}

export function setState(next: GameState): void {
  state = next;
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode) — in-memory state still works.
  }
}

export function resetState(): void {
  setState(createCampaignStart());
}

/** Replaces the active fighter (roster[0]) — used to persist battle wounds. */
export function setFighter(fighter: Fighter): void {
  setState({ ...state, roster: [fighter, ...state.roster.slice(1)] });
}
