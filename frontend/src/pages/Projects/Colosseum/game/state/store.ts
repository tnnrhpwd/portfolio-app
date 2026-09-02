import type { Fighter, GameState } from '../core';
import { createCampaignStart, DEFAULT_TEAM_NAME } from '../core';
import { cloudLoad, cloudSave, isLoggedIn } from './cloudSync';

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
    unlockedAchievements: state.unlockedAchievements ?? [],
    tutorialSeen: state.tutorialSeen ?? true,
    teamName: state.teamName ?? DEFAULT_TEAM_NAME,
    coliseumRanks: state.coliseumRanks ?? {},
    roster: state.roster.map((fighter) => {
      const status = fighter.status ?? {};
      return {
        ...fighter,
        baseAttributes: fighter.baseAttributes ?? { ...fighter.attributes },
        skills: fighter.skills ?? {},
        row: fighter.row ?? 'front',
        auto: fighter.auto ?? false,
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

const persisted = load();
let state: GameState = persisted ?? createCampaignStart();
let hasLocalSave = persisted !== null;

let cloudTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCloudSave(): void {
  if (!isLoggedIn()) return;
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    void cloudSave(state);
  }, 2000);
}

export function getState(): GameState {
  return state;
}

export function setState(next: GameState): void {
  state = next;
  hasLocalSave = true;
  if (storageAvailable()) {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode) — in-memory state still works.
    }
  }
  scheduleCloudSave();
}

export function resetState(): void {
  setState(createCampaignStart());
}

/** Replaces the active fighter (roster[0]) — used to persist battle wounds. */
export function setFighter(fighter: Fighter): void {
  setState({ ...state, roster: [fighter, ...state.roster.slice(1)] });
}

/** Replaces the first N roster fighters (the battle team) with post-battle state. */
export function setFighters(fighters: Fighter[]): void {
  const roster = [...state.roster];
  for (let i = 0; i < fighters.length; i += 1) roster[i] = fighters[i];
  setState({ ...state, roster });
}

/**
 * One-time cloud sync on startup. Offline-first: local progress always wins;
 * the cloud save is only adopted when there is no local save yet.
 */
export async function syncCloud(): Promise<void> {
  if (!isLoggedIn()) return;
  try {
    const remote = await cloudLoad();
    if (!remote) return;
    if (!hasLocalSave) {
      state = migrate(remote);
      hasLocalSave = true;
      if (storageAvailable()) {
        try {
          window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
        } catch {
          // ignore
        }
      }
    } else {
      // Local save wins — push it up so other devices stay in sync.
      scheduleCloudSave();
    }
  } catch {
    // Never let a network failure disrupt local play.
  }
}
