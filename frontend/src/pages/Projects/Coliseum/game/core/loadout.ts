import type { Equipment, EquipmentSlot, Fighter } from './types';
import { BODY_ZONES } from './constants';
import { isTwoHandedWeapon } from './equipment';
import { cloneFighter } from './engine';
import { displayedArmor } from './stats';

function refreshArmor(fighter: Fighter): void {
  for (const zone of BODY_ZONES) fighter.zones[zone].armor = displayedArmor(fighter, zone);
}

/** Equips an item into its slot and refreshes zone armor. Returns a new fighter. */
export function equipItem(fighter: Fighter, item: Equipment): Fighter {
  const next = cloneFighter(fighter);
  next.loadout[item.slot] = item;
  if (isTwoHandedWeapon(item)) {
    // A two-hander fills both hands.
    next.loadout.offHand = null;
  } else if (item.slot === 'offHand' && next.loadout.mainHand && isTwoHandedWeapon(next.loadout.mainHand)) {
    // A two-handed main-hand weapon can't share space with an off-hand item.
    next.loadout.mainHand = null;
  }
  refreshArmor(next);
  return next;
}

/** Items evicted from the loadout when `item` is equipped (return to inventory). */
export function displacedByEquip(fighter: Fighter, item: Equipment): Equipment[] {
  const out: Equipment[] = [];
  const prev = fighter.loadout[item.slot];
  if (prev) out.push(prev);
  if (isTwoHandedWeapon(item)) {
    const off = fighter.loadout.offHand;
    if (off && off.id !== prev?.id) out.push(off);
  } else if (item.slot === 'offHand' && fighter.loadout.mainHand && isTwoHandedWeapon(fighter.loadout.mainHand)) {
    out.push(fighter.loadout.mainHand);
  }
  return out;
}

/** Removes every equipped item and returns them (for return-to-inventory). */
export function unequipAll(fighter: Fighter): { fighter: Fighter; displaced: Equipment[] } {
  const displaced: Equipment[] = [];
  const next = cloneFighter(fighter);
  (Object.keys(next.loadout) as EquipmentSlot[]).forEach((slot) => {
    const item = next.loadout[slot];
    if (item) {
      displaced.push(item);
      next.loadout[slot] = null;
    }
  });
  refreshArmor(next);
  return { fighter: next, displaced };
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
