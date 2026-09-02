export interface City {
  id: string;
  name: string;
  /** Fame rank required to unlock this city. */
  rank: number;
  /** Shop stock tier (0..4). */
  shopTier: number;
  /** Number of coliseum opponent teams. */
  opponents: number;
  description: string;
}

/** Ten campaign cities, north to the capital and a mythic finale (original order/names from the historical world). */
export const CITIES: readonly City[] = [
  { id: 'londinium', name: 'Londinium', rank: 0, shopTier: 0, opponents: 3, description: 'A northern trade hub where new gladiators earn their first reputation.' },
  { id: 'eboracum', name: 'Eboracum', rank: 2, shopTier: 0, opponents: 3, description: 'A walled garrison town in the far north.' },
  { id: 'lugdunum', name: 'Lugdunum', rank: 4, shopTier: 1, opponents: 4, description: 'A wealthy city of rivers and roads.' },
  { id: 'massilia', name: 'Massilia', rank: 6, shopTier: 1, opponents: 4, description: 'An old coastal port with a proud fighting tradition.' },
  { id: 'carthago', name: 'Carthago', rank: 9, shopTier: 2, opponents: 5, description: 'A rebuilt African capital with a fierce arena.' },
  { id: 'syracusae', name: 'Syracusae', rank: 12, shopTier: 2, opponents: 5, description: 'A Sicilian city of scholars and spectacles.' },
  { id: 'alexandria', name: 'Alexandria', rank: 15, shopTier: 3, opponents: 6, description: 'A great harbor where knowledge and wealth flow together.' },
  { id: 'antiochia', name: 'Antiochia', rank: 18, shopTier: 3, opponents: 6, description: 'A sprawling eastern capital under the eagles.' },
  { id: 'roma', name: 'Roma', rank: 22, shopTier: 4, opponents: 8, description: 'The heart of the empire and its greatest arena.' },
  { id: 'elysium', name: 'Elysium', rank: 28, shopTier: 4, opponents: 10, description: 'A mythic final proving ground beyond the mortal world.' },
];

export function unlockedCities(fame: number): City[] {
  return CITIES.filter((c) => c.rank <= fame);
}

export function isCityUnlocked(city: City, fame: number): boolean {
  return city.rank <= fame;
}

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}

/** Opponent levels for a city's coliseum ladder (ascending). */
export function coliseumOpponentLevels(city: City): number[] {
  const levels: number[] = [];
  for (let i = 0; i < city.opponents; i += 1) levels.push(city.rank + i + 1);
  return levels;
}
