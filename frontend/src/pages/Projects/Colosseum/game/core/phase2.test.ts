import {
  buyItem,
  createCampaignStart,
  createEquipment,
  createFighter,
  equipItem,
  generateOpponent,
  generateRecruit,
  generateShopStock,
  itemPrice,
  mulberry32,
  postBattleRewards,
  recomputeDerived,
  recruitCost,
  sellItem,
  sellPrice,
  simulateBattle,
  spendAttributePoint,
  totalHp,
  unequipItem,
} from './index';

describe('recruitment', () => {
  it('rolls a murmillo recruit with gear and valid zones', () => {
    const recruit = generateRecruit(2, mulberry32(1));
    expect(recruit.style).toBe('murmillo');
    expect(recruit.level).toBe(2);
    expect(recruit.loadout.mainHand).not.toBeNull();
    expect(recruit.loadout.offHand).not.toBeNull();
    expect(recruit.zones.torso.hp).toBeGreaterThan(0);
  });

  it('charges more for higher-level recruits', () => {
    expect(recruitCost(3)).toBeGreaterThan(recruitCost(1));
  });

  it('rolls an opponent whose level matches the rank', () => {
    const foe = generateOpponent(3, mulberry32(2));
    expect(foe.level).toBe(3);
    expect(foe.loadout.head).not.toBeNull();
  });
});

describe('training', () => {
  it('spends one point and raises the attribute', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributePoints = 3;
    const before = fighter.attributes.strength;
    const after = spendAttributePoint(fighter, 'strength');
    expect(after.attributes.strength).toBe(before + 1);
    expect(after.attributePoints).toBe(2);
  });

  it('rejects when no points remain', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributePoints = 0;
    expect(() => spendAttributePoint(fighter, 'strength')).toThrow();
  });
});

describe('loadout', () => {
  it('equips an item and refreshes zone armor', () => {
    const fighter = createFighter({ style: 'murmillo' });
    const helm = createEquipment('head', 3);
    const next = equipItem(fighter, helm);
    expect(next.loadout.head).toBe(helm);
    expect(next.zones.head.armor).toBe(helm.armor);
  });

  it('unequips a slot', () => {
    const fighter = createFighter({ style: 'murmillo' });
    const equipped = equipItem(fighter, createEquipment('head', 2));
    const removed = unequipItem(equipped, 'head');
    expect(removed.loadout.head).toBeNull();
    expect(removed.zones.head.armor).toBe(0);
  });
});

describe('derived recompute', () => {
  it('raises max HP when vitality increases', () => {
    const fighter = createFighter({ style: 'murmillo' });
    const before = totalHp(fighter);
    fighter.attributes.vitality += 10;
    expect(totalHp(recomputeDerived(fighter))).toBeGreaterThan(before);
  });
});

describe('shop', () => {
  it('generates the requested amount of stock', () => {
    expect(generateShopStock(1, 6, mulberry32(3))).toHaveLength(6);
  });

  it('buys an item and deducts gold', () => {
    const state = createCampaignStart(mulberry32(4));
    const item = generateShopStock(1, 1, mulberry32(5))[0];
    const next = buyItem(state, item);
    expect(next.gold).toBe(state.gold - itemPrice(item));
    expect(next.inventory).toHaveLength(state.inventory.length + 1);
  });

  it('rejects purchases when gold is short', () => {
    const state = { ...createCampaignStart(mulberry32(6)), gold: 0 };
    const item = generateShopStock(4, 1, mulberry32(7))[0];
    expect(() => buyItem(state, item)).toThrow();
  });

  it('scales stock with shop tier — later cities sell better, pricier gear', () => {
    const cheap = generateShopStock(0, 20, mulberry32(11));
    const pricey = generateShopStock(9, 20, mulberry32(11));
    const avg = (items: ReturnType<typeof generateShopStock>) =>
      items.reduce((sum, item) => sum + itemPrice(item), 0) / items.length;
    expect(avg(pricey)).toBeGreaterThan(avg(cheap));
  });

  it('sells inventory items back for half their price', () => {
    const state = createCampaignStart(mulberry32(10));
    const item = generateShopStock(1, 1, mulberry32(12))[0];
    const bought = buyItem(state, item);
    const sold = sellItem(bought, item);
    expect(sold.inventory).toHaveLength(bought.inventory.length - 1);
    expect(sold.gold).toBe(bought.gold + sellPrice(item));
    expect(sellPrice(item)).toBeLessThan(itemPrice(item));
  });
});

describe('equipment archetypes', () => {
  it('gives weapons distinct names, damage and crit bonuses', () => {
    const spear = createEquipment('mainHand', 2, { kind: 'spear', rand: mulberry32(1) });
    const axe = createEquipment('mainHand', 2, { kind: 'axe', rand: mulberry32(1) });
    expect(spear.name).toContain('Spear');
    expect(axe.name).toContain('Axe');
    expect(spear.critBonus).toBeGreaterThan(axe.critBonus ?? 0);
    expect(axe.minDamage).toBeLessThan(axe.maxDamage ?? 0);
  });

  it('tower shields block more than bucklers', () => {
    const tower = createEquipment('offHand', 4, { kind: 'tower', rand: mulberry32(1) });
    const buckler = createEquipment('offHand', 4, { kind: 'buckler', rand: mulberry32(1) });
    expect(tower.name).toContain('Tower');
    expect(tower.blockChance ?? 0).toBeGreaterThan(buckler.blockChance ?? 0);
  });
});

describe('campaign start', () => {
  it('starts with an equipped fighter, points, and gold', () => {
    const state = createCampaignStart(mulberry32(8));
    expect(state.gold).toBeGreaterThan(0);
    expect(state.roster[0].loadout.mainHand).not.toBeNull();
    expect(state.roster[0].loadout.offHand).not.toBeNull();
    expect(state.roster[0].attributePoints).toBeGreaterThan(0);
    expect(state.inventory).toEqual([]);
  });
});

describe('battle loop', () => {
  it('simulates a deterministic winning fight', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.strength = 300;
    player.attributes.dexterity = 500;
    const enemy = generateOpponent(1, mulberry32(9));

    const run = () =>
      simulateBattle(
        player,
        enemy,
        (_p, e) => ({
          kind: 'attack' as const,
          precision: 'strong' as const,
          targetId: e.id,
          targetZone: 'head' as const,
        }),
        mulberry32(42),
      );

    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.playerWon).toBe(true);
    expect(a.rounds).toBeGreaterThan(0);
  });

  it('rewards mercy and execute differently', () => {
    const mercy = postBattleRewards(5, 'mercy');
    const execute = postBattleRewards(5, 'execute');
    expect(mercy.xp).toBeGreaterThan(execute.xp);
    expect(execute.gold).toBeGreaterThan(mercy.gold);
    expect(mercy.maxMoraleGain).toBeGreaterThan(0);
    expect(execute.maxMoraleGain).toBe(0);
  });
});
