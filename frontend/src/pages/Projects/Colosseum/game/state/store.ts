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
    return parsed;
  } catch {
    return null;
  }
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
