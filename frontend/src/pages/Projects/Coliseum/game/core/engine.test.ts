import {
  STAT_CAPS,
  ZONE_HP_SPLIT,
  BODY_ZONES,
  BLOCK_CAP,
  ARMOR_COMBAT_MULTIPLIER,
  LIMB_BLEED_PER_TURN,
  WOUND_BLEED_PER_TURN,
  clampAttribute,
  hpPerVitality,
  totalHp,
  zoneMaxHp,
  displayedArmor,
  combatArmor,
  applyZoneDamage,
  bleedZone,
  blockChance,
  clearZoneWounds,
  isDefeated,
  canMeleeAttack,
  destroyedLimbCount,
  legsCrippled,
  usableMainHand,
  usableOffHandWeapon,
  hitChance,
  initiative,
  sortTurnOrder,
  createFighter,
  createEquipment,
  rollQuality,
  QUALITY_MIN,
  QUALITY_MAX,
  SHOP_AFFIX_CAP,
  CRAFTED_AFFIX_CAP,
  mulberry32,
  xpToNext,
  addXp,
  victoryRewards,
  healCost,
  resolveRound,
  crowdWish,
} from './index';

describe('stat caps', () => {
  it('matches the reference balance targets', () => {
    expect(STAT_CAPS.strength).toBe(521);
    expect(STAT_CAPS.dexterity).toBe(508);
    expect(STAT_CAPS.defense).toBe(516);
    expect(STAT_CAPS.speed).toBe(515);
    expect(STAT_CAPS.vitality).toBe(383);
  });

  it('clamps attributes to their caps', () => {
    expect(clampAttribute('strength', 9999)).toBe(521);
    expect(clampAttribute('vitality', 383)).toBe(383);
    expect(clampAttribute('vitality', 400)).toBe(383);
    expect(clampAttribute('dexterity', -5)).toBe(0);
  });
});

describe('body-part HP split', () => {
  it('sums to 100% with the expected fractions', () => {
    const sum = BODY_ZONES.reduce((acc, z) => acc + ZONE_HP_SPLIT[z], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(ZONE_HP_SPLIT.torso).toBeCloseTo(0.23);
    expect(ZONE_HP_SPLIT.head).toBeCloseTo(0.17);
    expect(ZONE_HP_SPLIT.leftArm).toBeCloseTo(0.15);
    expect(ZONE_HP_SPLIT.rightArm).toBeCloseTo(0.15);
    expect(ZONE_HP_SPLIT.leftLeg).toBeCloseTo(0.15);
    expect(ZONE_HP_SPLIT.rightLeg).toBeCloseTo(0.15);
  });

  it('splits a total across zones so the parts sum exactly to the total', () => {
    const split = zoneMaxHp(1000);
    const sum = BODY_ZONES.reduce((acc, z) => acc + split[z], 0);
    expect(sum).toBe(1000);
    BODY_ZONES.forEach((z) => expect(split[z]).toBeGreaterThan(0));
  });
});

describe('vitality → HP', () => {
  it('grants ~56 HP per point at level 70', () => {
    expect(hpPerVitality(70)).toBeGreaterThanOrEqual(55);
    expect(hpPerVitality(70)).toBeLessThanOrEqual(57);
  });

  it('derives total HP from vitality and level', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributes.vitality = 100;
    fighter.level = 70;
    expect(totalHp(fighter)).toBe(Math.floor(100 * hpPerVitality(70)));
  });
});

describe('armor', () => {
  it('doubles displayed armor in combat', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.loadout.head = createEquipment('head', 3, { crafted: false });
    expect(combatArmor(fighter, 'head')).toBe(displayedArmor(fighter, 'head') * ARMOR_COMBAT_MULTIPLIER);
  });

  it('applies damage to the armor layer before flesh', () => {
    const zone = { armor: 10, hp: 50, maxHp: 50 };
    const result = applyZoneDamage(zone, 15); // effective armor = 20
    expect(result.absorbed).toBe(15);
    expect(result.toFlesh).toBe(0);
    expect(zone.hp).toBe(50);

    // After the first hit, 2 displayed armor remains → 4 effective in combat.
    const second = applyZoneDamage(zone, 30);
    expect(second.absorbed).toBe(4);
    expect(second.toFlesh).toBe(26);
    expect(zone.armor).toBe(0);
    expect(zone.hp).toBe(24);
  });
});

describe('blocking', () => {
  it('clamps shield block chance to the 72% cap', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.loadout.offHand = createEquipment('offHand', 9, { rand: () => 0.5 });
    expect(fighter.loadout.offHand?.blockChance).toBeLessThanOrEqual(BLOCK_CAP);
    expect(blockChance(fighter)).toBeLessThanOrEqual(BLOCK_CAP);
  });
});

describe('hit resolution', () => {
  it('always misses below half the target DEF', () => {
    expect(hitChance(257, 516)).toBe(0);
  });

  it('can hit at half the target DEF or above', () => {
    expect(hitChance(258, 516)).toBeGreaterThan(0);
    // ~340 DEX reliably connects against max DEF (516).
    expect(hitChance(340, 516)).toBeGreaterThan(0);
  });

  it('never penalizes against zero defense', () => {
    expect(hitChance(1, 0)).toBe(1);
  });
});

describe('turn order', () => {
  it('orders faster fighters first and slows halve speed', () => {
    const fast = createFighter({ style: 'retiarius', id: 'fast' });
    const slow = createFighter({ style: 'thraex', id: 'slow' });
    fast.attributes.speed = 30;
    slow.attributes.speed = 10;
    expect(sortTurnOrder([slow, fast]).map((f) => f.id)).toEqual(['fast', 'slow']);

    slow.status.slow = 1;
    expect(initiative(slow)).toBe(5);
  });
});

describe('equipment rolls', () => {
  it('keeps crafted quality within 1.3–1.6', () => {
    for (let i = 0; i < 200; i += 1) {
      const q = rollQuality(Math.random);
      expect(q).toBeGreaterThanOrEqual(QUALITY_MIN);
      expect(q).toBeLessThanOrEqual(QUALITY_MAX);
    }
  });

  it('caps affixes at 4 (shop) and 6 (crafted)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(createEquipment('head', 2, { rand: Math.random }).affixCount).toBeLessThanOrEqual(
        SHOP_AFFIX_CAP,
      );
      expect(
        createEquipment('head', 2, { crafted: true, rand: Math.random }).affixCount,
      ).toBeLessThanOrEqual(CRAFTED_AFFIX_CAP);
    }
  });
});

describe('fighter construction', () => {
  it('builds six healthy zones and defaults unknown styles', () => {
    const fighter = createFighter({ style: 'not-a-style', name: 'Test' });
    expect(fighter.style).toBe('murmillo');
    expect(Object.keys(fighter.zones)).toHaveLength(6);
    for (const zone of BODY_ZONES) {
      expect(fighter.zones[zone].hp).toBeGreaterThan(0);
      expect(fighter.zones[zone].hp).toBe(fighter.zones[zone].maxHp);
    }
    expect(fighter.alive).toBe(true);
  });
});

describe('progression & economy', () => {
  it('levels up and grants point pools', () => {
    const fighter = createFighter({ style: 'murmillo' });
    const leveled = addXp(fighter, 1000);
    expect(leveled.level).toBeGreaterThan(1);
    expect(leveled.attributePoints).toBe((leveled.level - 1) * 5);
    expect(leveled.skillPoints).toBe(leveled.level - 1);
  });

  it('computes XP thresholds and victory rewards', () => {
    expect(xpToNext(1)).toBe(50);
    expect(xpToNext(2)).toBe(85);
    const rewards = victoryRewards(5);
    expect(rewards.gold).toBeGreaterThan(0);
    expect(rewards.xp).toBeGreaterThan(0);
  });

  it('heal cost scales with missing HP', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.zones.torso.hp = 1;
    expect(healCost(fighter)).toBeGreaterThanOrEqual(1);
  });
});

describe('RNG', () => {
  it('is deterministic for a fixed seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i += 1) expect(a()).toBe(b());
  });
});

describe('round resolution', () => {
  it('is deterministic and resolves a fatal head strike', () => {
    const player = createFighter({ style: 'murmillo', id: 'p1' });
    player.attributes.strength = 200;
    player.attributes.dexterity = 500;

    const enemy = createFighter({ style: 'thraex', id: 'e1' });
    enemy.attributes.defense = 1;
    enemy.zones.head.hp = 5;
    enemy.zones.head.maxHp = 5;

    const actions = {
      p1: { kind: 'attack' as const, precision: 'strong' as const, targetId: 'e1', targetZone: 'head' as const },
    };

    const seed = 7;
    const first = resolveRound([player], [enemy], actions, mulberry32(seed));
    const second = resolveRound([player], [enemy], actions, mulberry32(seed));

    expect(first).toEqual(second);
    expect(first.playerWon).toBe(true);
    expect(first.enemyTeam[0].alive).toBe(false);
    expect(isDefeated(first.enemyTeam[0])).toBe(true);
  });

  it('does not mutate the input teams', () => {
    const player = createFighter({ style: 'murmillo', id: 'p1' });
    const enemy = createFighter({ style: 'thraex', id: 'e1' });
    const snapshot = JSON.stringify([player, enemy]);
    resolveRound([player], [enemy], {}, mulberry32(3));
    expect(JSON.stringify([player, enemy])).toBe(snapshot);
  });
});

describe('limb mechanics', () => {
  it('dies when two limbs are destroyed', () => {
    const f = createFighter({ style: 'murmillo' });
    f.zones.leftArm.hp = 0;
    expect(isDefeated(f)).toBe(false);
    f.zones.rightLeg.hp = 0;
    expect(destroyedLimbCount(f)).toBe(2);
    expect(isDefeated(f)).toBe(true);
  });

  it('cannot melee when a leg is destroyed, but an arm wound still allows fists', () => {
    const f = createFighter({ style: 'murmillo' });
    expect(canMeleeAttack(f)).toBe(true);
    f.zones.leftLeg.hp = 0;
    expect(legsCrippled(f)).toBe(true);
    expect(canMeleeAttack(f)).toBe(false);
    const g = createFighter({ style: 'murmillo' });
    g.zones.rightArm.hp = 0;
    expect(canMeleeAttack(g)).toBe(true);
  });

  it('disables the weapon in the destroyed hand', () => {
    const f = createFighter({ style: 'dimachaerus' });
    f.loadout.mainHand = createEquipment('mainHand', 1, { rand: mulberry32(1), kind: 'gladius' });
    f.loadout.offHand = createEquipment('offHand', 1, { rand: mulberry32(1), weapon: true, kind: 'dagger' });
    expect(usableMainHand(f)).not.toBeNull();
    expect(usableOffHandWeapon(f)).not.toBeNull();
    f.zones.rightArm.hp = 0;
    expect(usableMainHand(f)).toBeNull();
    expect(usableOffHandWeapon(f)).not.toBeNull();
    f.zones.leftArm.hp = 0;
    expect(usableOffHandWeapon(f)).toBeNull();
  });

  it('drops block when the shield arm is destroyed', () => {
    const f = createFighter({ style: 'murmillo' });
    f.loadout.offHand = createEquipment('offHand', 1, { rand: mulberry32(1), kind: 'tower' });
    expect(blockChance(f)).toBeGreaterThan(0);
    f.zones.leftArm.hp = 0;
    expect(blockChance(f)).toBe(0);
  });

  it('does not bleed for a limb lost before the match', () => {
    const player = createFighter({ style: 'murmillo', id: 'p1' });
    player.attributes.defense = 40; // enemy always misses
    player.zones.leftArm.hp = 0; // lost BEFORE the match
    const before = player.zones.torso.hp;
    const enemy = createFighter({ style: 'murmillo', id: 'e1' });
    const result = resolveRound([player], [enemy], { p1: { kind: 'block' } }, mulberry32(4));
    expect(result.playerTeam[0].zones.torso.hp).toBe(before);
  });

  it('bleeds the torso after losing a limb during the match', () => {
    const player = createFighter({ style: 'murmillo', id: 'p1' });
    player.attributes.defense = 0; // enemy always hits
    player.zones.leftArm.hp = 1; // on the verge of being severed
    const before = player.zones.torso.hp;
    const enemy = createFighter({ style: 'murmillo', id: 'e1' });
    const result = resolveRound([player], [enemy], { p1: { kind: 'block' } }, () => 0);
    const after = result.playerTeam[0];
    expect(after.zones.leftArm.hp).toBe(0); // severed during the round
    expect(after.zones.torso.hp).toBe(before - LIMB_BLEED_PER_TURN);
  });
});

describe('wound bleed', () => {
  it('marks a zone wounded only when flesh is damaged', () => {
    const armored = { armor: 10, hp: 50, maxHp: 100, wounded: false };
    applyZoneDamage(armored, 5); // fully absorbed by armor
    expect(armored.wounded).toBe(false);

    const flesh = { armor: 0, hp: 50, maxHp: 100, wounded: false };
    applyZoneDamage(flesh, 5);
    expect(flesh.wounded).toBe(true);
  });

  it('bleeds a wounded zone only while below half HP', () => {
    const belowHalf = { armor: 0, hp: 49, maxHp: 100, wounded: true };
    expect(bleedZone(belowHalf, WOUND_BLEED_PER_TURN)).toBe(WOUND_BLEED_PER_TURN);
    expect(belowHalf.hp).toBe(49 - WOUND_BLEED_PER_TURN);

    const aboveHalf = { armor: 0, hp: 51, maxHp: 100, wounded: true };
    expect(bleedZone(aboveHalf, WOUND_BLEED_PER_TURN)).toBe(0);
    expect(aboveHalf.hp).toBe(51);

    const notWounded = { armor: 0, hp: 40, maxHp: 100 };
    expect(bleedZone(notWounded, WOUND_BLEED_PER_TURN)).toBe(0);
    expect(notWounded.hp).toBe(40);
  });

  it('clears wound flags at the start of a new battle', () => {
    const f = createFighter({ style: 'murmillo' });
    f.zones.torso.wounded = true;
    const cleared = clearZoneWounds(f);
    expect(cleared.zones.torso.wounded).toBe(false);
    expect(cleared.zones.head.wounded).toBe(false);
  });
});

describe('crowd wish', () => {
  it('always pleads for mercy over a fallen foe', () => {
    expect(crowdWish()).toBe('mercy');
  });
});
