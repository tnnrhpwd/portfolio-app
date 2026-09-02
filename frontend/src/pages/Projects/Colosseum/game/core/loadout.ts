import type { Equipment, EquipmentSlot, Fighter } from './types';
import { BODY_ZONES } from './constants';
import { cloneFighter } from './engine';
import { displayedArmor } from './stats';

function refreshArmor(fighter: Fighter): void {
  for (const zone of BODY_ZONES) fighter.zones[zone].armor = displayedArmor(fighter, zone);
}

/** Equips an item into its slot and refreshes zone armor. Returns a new fighter. */
export function equipItem(fighter: Fighter, item: Equipment): Fighter {
  const next = cloneFighter(fighter);
  next.loadout[item.slot] = item;
  refreshArmor(next);
  return next;
}

/** Removes the item in a slot and refreshes zone armor. Returns a new fighter. */
export function unequipItem(fighter: Fighter, slot: EquipmentSlot): Fighter {
  const next = cloneFighter(fighter);
  next.loadout[slot] = null;
  refreshArmor(next);
  return next;
}

/** Recomputes zone armor from currently equipped gear. Returns a new fighter. */
export function refreshZoneArmor(fighter: Fighter): Fighter {
  const next = cloneFighter(fighter);
  refreshArmor(next);
  return next;
}
