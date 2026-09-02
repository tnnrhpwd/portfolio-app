import type { Equipment, Fighter, StyleKey } from './types';
import type { Rng } from './rng';
import { pick } from './rng';
import { ATTRIBUTE_KEYS } from './constants';
import { createFighter } from './engine';
import { createEquipment } from './equipment';
import { equipItem } from './loadout';
import { recomputeDerived } from './stats';

const RECRUIT_NAMES = [
  'Cassius',
  'Felix',
  'Gaius',
  'Lucius',
  'Marcus',
  'Nero',
  'Titus',
  'Varro',
  'Decimus',
  'Aulus',
];

const OPPONENT_NAMES = [
  'Pompey',
  'Crassus',
  'Agrippa',
  'Sulla',
  'Cato',
  'Antonius',
  'Lepidus',
  'Octavius',
];

/** Gold cost to buy a recruit of the given level. */
export function recruitCost(level: number): number {
  return 150 + level * 120;
}

function starterWeapons(style: StyleKey, tier: number, rand: Rng): { main: Equipment; off: Equipment | null } {
  const main = createEquipment('mainHand', tier, { rand });
  let off: Equipment | null = null;
  if (style === 'dimachaerus') off = createEquipment('offHand', tier, { rand, weapon: true });
  else if (style !== 'thraex') off = createEquipment('offHand', tier, { rand });
  return { main, off };
}

/** Rolls a fresh recruit with a random stat spread and starter gear. */
export function generateRecruit(
  level: number,
  rand: Rng = Math.random,
  style: StyleKey = 'murmillo',
): Fighter {
  let fighter = createFighter({ style, level, name: pick(RECRUIT_NAMES, rand) });
  const bonus = 3 + level * 4;
  for (let i = 0; i < bonus; i += 1) {
    fighter.attributes[pick(ATTRIBUTE_KEYS, rand)] += 1;
  }
  const tier = Math.max(0, Math.min(4, Math.floor(level / 2)));
  const { main, off } = starterWeapons(style, tier, rand);
  fighter = equipItem(fighter, main);
  if (off) fighter = equipItem(fighter, off);
  fighter.baseAttributes = { ...fighter.attributes };
  return recomputeDerived(fighter);
}

/** Rolls an opponent scaled by campaign rank (1-based), with trained skills. */
export function generateOpponent(rank: number, rand: Rng = Math.random): Fighter {
  const level = Math.max(1, rank);
  let fighter = createFighter({ style: 'murmillo', level, name: pick(OPPONENT_NAMES, rand) });
  const tier = Math.max(0, Math.min(4, Math.floor(level / 2)));
  fighter = equipItem(fighter, createEquipment('head', tier, { rand }));
  fighter = equipItem(fighter, createEquipment('torso', tier, { rand }));
  fighter = equipItem(fighter, createEquipment('mainHand', tier, { rand }));
  fighter = equipItem(fighter, createEquipment('offHand', tier, { rand }));
  fighter.skills = {
    shieldBash: Math.min(5, 1 + Math.floor(level / 2)),
    powerStrike: Math.min(5, 1 + Math.floor(level / 3)),
  };
  return recomputeDerived(fighter);
}
