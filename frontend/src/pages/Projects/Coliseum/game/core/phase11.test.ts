import {
  canMeleeAttack,
  createEquipment,
  createFighter,
  generateShopStock,
  mulberry32,
  rollDamageWithWeapon,
  usableMainHand,
  usableOffHandWeapon,
} from './index';

describe('dual wielding', () => {
  it('creates an off-hand weapon (a second single-handed weapon)', () => {
    const weapon = createEquipment('offHand', 2, { weapon: true, rand: mulberry32(1) });
    expect(weapon.minDamage).toBeDefined();
    expect(weapon.blockChance).toBeUndefined();
    expect(weapon.kind === 'dagger' || weapon.kind === 'gladius').toBe(true);
  });

  it('keeps attacking with the other hand when one arm is lost', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.loadout.mainHand = createEquipment('mainHand', 1, { kind: 'gladius' });
    fighter.loadout.offHand = createEquipment('offHand', 1, { weapon: true, kind: 'dagger' });

    // Lose the right arm (the main-hand arm).
    fighter.zones.rightArm.hp = 0;
    expect(usableMainHand(fighter)).toBeNull();
    expect(usableOffHandWeapon(fighter)).not.toBeNull();
    expect(canMeleeAttack(fighter)).toBe(true);
  });

  it('rolls damage from a specific weapon so dual-wield combos use both hands', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributes.strength = 0;
    const main = createEquipment('mainHand', 0, { rand: () => 0.5, kind: 'gladius' }); // 6–12
    const off = createEquipment('offHand', 0, { rand: () => 0.5, weapon: true, kind: 'dagger' }); // 4–8
    expect(rollDamageWithWeapon(fighter, main, 'medium', () => 0.5).raw).toBeGreaterThan(
      rollDamageWithWeapon(fighter, off, 'medium', () => 0.5).raw,
    );
  });

  it('shop stock includes off-hand weapons for dual wielding', () => {
    const stock = generateShopStock(5, 300, mulberry32(1));
    const offhandWeapons = stock.filter((i) => i.slot === 'offHand' && i.minDamage !== undefined);
    expect(offhandWeapons.length).toBeGreaterThan(0);
  });
});
