import type { GameState } from './engine';

export interface City {
  id: string;
  name: string;
  /** Base difficulty tier for this city's coliseum opponents. */
  rank: number;
  /** Shop stock tier (0..9; higher = better, pricier gear). */
  shopTier: number;
  /** Number of coliseum opponent teams. */
  opponents: number;
  description: string;
}

/** Ten campaign cities, north to the capital and a mythic finale (original order/names from the historical world). */
export const CITIES: readonly City[] = [
  { id: 'londinium', name: 'Londinium', rank: 0, shopTier: 0, opponents: 3, description: 'A northern trade hub where new gladiators earn their first reputation.' },
  { id: 'eboracum', name: 'Eboracum', rank: 2, shopTier: 1, opponents: 3, description: 'A walled garrison town in the far north.' },
  { id: 'lugdunum', name: 'Lugdunum', rank: 4, shopTier: 2, opponents: 4, description: 'A wealthy city of rivers and roads.' },
  { id: 'massilia', name: 'Massilia', rank: 6, shopTier: 3, opponents: 4, description: 'An old coastal port with a proud fighting tradition.' },
  { id: 'carthago', name: 'Carthago', rank: 9, shopTier: 4, opponents: 5, description: 'A rebuilt African capital with a fierce arena.' },
  { id: 'syracusae', name: 'Syracusae', rank: 12, shopTier: 5, opponents: 5, description: 'A Sicilian city of scholars and spectacles.' },
  { id: 'alexandria', name: 'Alexandria', rank: 15, shopTier: 6, opponents: 6, description: 'A great harbor where knowledge and wealth flow together.' },
  { id: 'antiochia', name: 'Antiochia', rank: 18, shopTier: 7, opponents: 6, description: 'A sprawling eastern capital under the eagles.' },
  { id: 'roma', name: 'Roma', rank: 22, shopTier: 8, opponents: 8, description: 'The heart of the empire and its greatest arena.' },
  { id: 'elysium', name: 'Elysium', rank: 28, shopTier: 9, opponents: 10, description: 'A mythic final proving ground beyond the mortal world.' },
];

export function unlockedCities(state: GameState): City[] {
  return CITIES.filter((c) => isCityUnlocked(state, c.id));
}

/**
 * A city is unlocked when it is the first on the map, or when the previous
 * city's #1 contender (champion) has been defeated.
 */
export function isCityUnlocked(state: GameState, cityId: string): boolean {
  const index = CITIES.findIndex((c) => c.id === cityId);
  if (index < 0) return false;
  if (index === 0) return true;
  return coliseumRank(state, CITIES[index - 1].id) === 1;
}

/** The city whose champion must fall to open the given city (undefined for the first). */
export function cityUnlockRequirement(cityId: string): City | undefined {
  const index = CITIES.findIndex((c) => c.id === cityId);
  return index > 0 ? CITIES[index - 1] : undefined;
}

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}

/** Opponent levels for a city's coliseum ladder (ascending). */
export function coliseumOpponentLevels(city: City): number[] {
  const levels: number[] = [];
  for (let r = 1; r <= COLISEUM_LADDER_SIZE; r += 1) levels.push(coliseumOpponentLevel(city, r));
  return levels.sort((a, b) => a - b);
}

/** Every coliseum has a 16-team ladder (1 = champion, 16 = weakest). */
export const COLISEUM_LADDER_SIZE = 16;

/** The player starts at the bottom of every city's ladder. */
export const START_COLISEUM_RANK = 16;

/** How many ranks above the player's current rank they may challenge. */
export const COLISEUM_RANK_REACH = 2;

/**
 * Opponent level for a given ladder slot in a city. Later cities shift the
 * whole ladder upward, so each arena is progressively harder than the last
 * while the champion (rank 1) is always the strongest team in its city.
 */
export function coliseumOpponentLevel(city: City, ladderRank: number): number {
  return city.rank + (COLISEUM_LADDER_SIZE - ladderRank) + 1;
}

const TEAM_LEADERS = [
  'Iron', 'Crimson', 'Gilded', 'Broken', 'Silent', 'Scarred', 'Golden', 'Vengeful',
  'Feral', 'Burning', 'Sable', 'Storm', 'Crowned', 'Fallen', 'Ragged', 'Thunder',
] as const;

const TEAM_COMPANIES = [
  'Veterans', 'Outcasts', 'Twins', 'Warhounds', 'Lions', 'Vipers', 'Ravens', 'Bulls',
  'Wolves', 'Titans', 'Heralds', 'Wardens', 'Guardians', 'Devourers', 'Stormcallers', 'Roughnecks',
] as const;

/** A stable, original team name for each ladder slot in a city. */
export function coliseumTeamName(city: City, ladderRank: number): string {
  const seed = ((city.id.length * 97 + ladderRank * 31) % 1009) >>> 0;
  const lead = TEAM_LEADERS[seed % TEAM_LEADERS.length];
  const comp = TEAM_COMPANIES[(seed * 7 + ladderRank) % TEAM_COMPANIES.length];
  return `${lead} ${comp}`;
}

/** The player's current rank in a city's ladder (16 = weakest, 1 = champion). */
export function coliseumRank(state: GameState, cityId: string): number {
  return state.coliseumRanks?.[cityId] ?? START_COLISEUM_RANK;
}

/** True when the player may challenge the given ladder slot in a city. */
export function canChallenge(state: GameState, cityId: string, ladderRank: number): boolean {
  return ladderRank >= coliseumRank(state, cityId) - COLISEUM_RANK_REACH;
}

/** Advances the player's rank in a city after beating a team. Returns a new state. */
export function advanceColiseumRank(state: GameState, cityId: string, beatenRank: number): GameState {
  const current = coliseumRank(state, cityId);
  const next = Math.min(current, beatenRank);
  if (next === current) return state;
  return { ...state, coliseumRanks: { ...state.coliseumRanks, [cityId]: next } };
}
