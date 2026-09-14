/**
 * A fully-stocked demo campaign — every weapon kind, every shield kind, every armour
 * slot across all three metal groups, plus a geared roster.
 *
 * This exists so a save can be filled with one call instead of buying gear by hand.
 * The inventory grid, the equipment drag targets and the fighter overlays all need a
 * wide spread of items to be exercised for real, and a fresh campaign has none — which
 * makes the renderer look fine while never having drawn a trident.
 *
 * Deterministic by design: every item's `kind` is passed explicitly to
 * `createEquipment`, so the same seed produces the same items and a screenshot can be
 * compared across runs.
 */
import type { Equipment, Fighter, Loadout, StyleKey } from './types';
import { createEquipment, isTwoHandedKind } from './equipment';
import { createFighter, type GameState } from './engine';
import { STYLES } from './classes';
import { recomputeDerived } from './stats';

/** All nine archetypes, so every raster weapon sprite gets drawn in a cell. */
const WEAPON_KINDS = [
  'gladius',
  'axe',
  'mace',
  'spear',
  'dagger',
  'trident',
  'greatsword',
  'maul',
  'halberd',
];

/** All four, so every shield icon/sprite is exercised. */
const SHIELD_KINDS = ['buckler', 'round', 'tower', 'net'];

/** Tiers across the band, so the shop's bronze/iron/gold price and colour steps all show. */
const TIERS = [1, 3, 5, 7];

/** Fighter count — capped at the styles that actually exist. */
const ROSTER_SIZE = 6;

type ArmorSlots = Pick<Loadout, 'head' | 'torso' | 'leftArm' | 'rightArm' | 'legs'>;

function armorSet(tier: number): ArmorSlots {
  return {
    head: createEquipment('head', tier),
    torso: createEquipment('torso', tier),
    leftArm: createEquipment('leftArm', tier),
    rightArm: createEquipment('rightArm', tier),
    legs: createEquipment('legs', tier),
  };
}

/** The full catalogue, repeated across tiers: weapons, shields, dual-wield off-hands, armour. */
export function demoInventory(): Equipment[] {
  const items: Equipment[] = [];
  for (const tier of TIERS) {
    for (const kind of WEAPON_KINDS) items.push(createEquipment('mainHand', tier, { kind }));
    for (const kind of SHIELD_KINDS) items.push(createEquipment('offHand', tier, { kind }));
    // A dual wielder's off-hand is a second weapon rather than a shield.
    for (const kind of ['dagger', 'gladius']) {
      items.push(createEquipment('offHand', tier, { kind, weapon: true }));
    }
    for (const slot of ['head', 'torso', 'leftArm', 'rightArm', 'legs'] as const) {
      items.push(createEquipment(slot, tier));
    }
  }
  return items;
}

/** A geared roster: one style per fighter, each fully armoured and holding a different weapon. */
export function demoRoster(): Fighter[] {
  const styles = Object.keys(STYLES) as StyleKey[];
  return styles.slice(0, ROSTER_SIZE).map((style, i) => {
    const tier = 1 + i;
    const weapon = WEAPON_KINDS[i % WEAPON_KINDS.length];
    const shield = SHIELD_KINDS[i % SHIELD_KINDS.length];
    const fighter = createFighter({ style, name: `Demo ${i + 1}`, level: 1 + tier });
    return recomputeDerived({
      ...fighter,
      loadout: {
        ...armorSet(tier),
        mainHand: createEquipment('mainHand', tier, { kind: weapon }),
        // A two-handed weapon occupies both hands, so those fighters carry no off-hand.
        offHand: isTwoHandedKind(weapon)
          ? null
          : i % 3 === 2
            ? createEquipment('offHand', tier, { kind: 'dagger', weapon: true })
            : createEquipment('offHand', tier, { kind: shield }),
      },
    });
  });
}

/** The whole demo campaign, ready to hand to `setState`. */
export function createDemoCampaign(): GameState {
  return {
    roster: demoRoster(),
    inventory: demoInventory(),
    metals: { bronze: 999, iron: 999, silver: 999, gold: 999 },
    unlockedAchievements: [],
    tutorialSeen: true,
    gold: 250000,
    fame: 5000,
    teamName: 'Demo Ludus',
    coliseumRanks: {},
  };
}
