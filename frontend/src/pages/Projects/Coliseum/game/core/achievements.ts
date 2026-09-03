import type { GameState } from './engine';

export interface Achievement {
  id: string;
  label: string;
  blurb: string;
  check: (state: GameState) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-blood', label: 'First Blood', blurb: 'Win your first fight.', check: (s) => s.fame >= 1 },
  { id: 'proven', label: 'Proven', blurb: 'Reach 5 fame.', check: (s) => s.fame >= 5 },
  { id: 'champion', label: 'Champion', blurb: 'Defeat a city champion (#1 contender).', check: (s) => Object.values(s.coliseumRanks).some((r) => r === 1) },
  { id: 'fortuna', label: 'Fortuna', blurb: 'Hold 2,000 gold at once.', check: (s) => s.gold >= 2000 },
  { id: 'schooled', label: 'Schooled', blurb: 'Keep 3 gladiators in your roster.', check: (s) => s.roster.length >= 3 },
  { id: 'veteran', label: 'Veteran', blurb: 'Train a gladiator to level 10.', check: (s) => s.roster.some((f) => f.level >= 10) },
];

/** Returns a new state with any newly-met achievements recorded, plus their ids. */
export function evaluateAchievements(state: GameState): { state: GameState; unlocked: string[] } {
  const unlocked = ACHIEVEMENTS.filter(
    (a) => !state.unlockedAchievements.includes(a.id) && a.check(state),
  ).map((a) => a.id);
  if (unlocked.length === 0) return { state, unlocked: [] };
  return {
    state: { ...state, unlockedAchievements: [...state.unlockedAchievements, ...unlocked] },
    unlocked,
  };
}

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
