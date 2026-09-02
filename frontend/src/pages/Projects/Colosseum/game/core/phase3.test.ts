import {
  CITIES,
  coliseumOpponentLevels,
  createCampaignStart,
  createFighter,
  effectiveAttributes,
  forge,
  forgeCost,
  getSkill,
  healCost,
  healToFull,
  isActiveSkill,
  isCityUnlocked,
  lifeBoostTotal,
  mulberry32,
  postBattleRewards,
  resolveRound,
  simulateBattle,
  spendSkillPoint,
  stabilize,
  styleSkills,
  totalHp,
  unlockedCities,
} from './index';

describe('skill catalog', () => {
  it('has eight nodes per style tree', () => {
    for (const style of ['provocator', 'murmillo', 'retiarius', 'dimachaerus', 'thraex'] as const) {
      expect(styleSkills(style)).toHaveLength(8);
    }
  });

  it('distinguishes active skills from passives', () => {
    expect(getSkill('shieldBash')?.mpCost).toBe(6);
    expect(isActiveSkill('shieldBash')).toBe(true);
    expect(isActiveSkill('lifeBoost')).toBe(false);
    expect(getSkill('lifeBoost')?.maxRank).toBe(15);
  });
});

describe('skill points', () => {
  it('spends points into the fighter style tree', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.skillPoints = 3;
    const after = spendSkillPoint(fighter, 'shieldBash');
    expect(after.skills.shieldBash).toBe(1);
    expect(after.skillPoints).toBe(2);
  });

  it('rejects unknown, out-of-style, or exhausted spends', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.skillPoints = 1;
    expect(() => spendSkillPoint(fighter, 'quadCombo')).toThrow(); // dimachaerus skill
    const broke = { ...fighter, skillPoints: 0 };
    expect(() => spendSkillPoint(broke, 'shieldBash')).toThrow();
  });
});

describe('passives', () => {
  it('applies passive stat bonuses and life boost to derived stats', () => {
    const fighter = createFighter({ style: 'murmillo' }); // speed 10, vit 12
    fighter.skills = { speedBoost: 5 };
    expect(effectiveAttributes(fighter).speed).toBe(20);
    fighter.skills = { lifeBoost: 3 };
    expect(lifeBoostTotal(fighter)).toBe(300);
    expect(totalHp(fighter)).toBe(900); // 12 * 50 + 300
  });
});

describe('skill combat', () => {
  it('heals and consumes MP', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.defense = 40; // enemy always misses
    player.skills = { heal: 1 };
    player.morale = 40;
    player.zones.torso.hp = 20;
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    const result = resolveRound(
      [player],
      [enemy],
      { [player.id]: { kind: 'skill', skillId: 'heal' } },
      mulberry32(2),
    );
    expect(result.playerTeam[0].zones.torso.hp).toBe(80);
    expect(result.playerTeam[0].morale).toBe(30);
  });

  it('demoralize strips most of the target max MP', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.speed = 20;
    player.skills = { demoralize: 1 };
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    const result = resolveRound(
      [player],
      [enemy],
      { [player.id]: { kind: 'skill', skillId: 'demoralize' } },
      mulberry32(3),
    );
    expect(result.enemyTeam[0].morale).toBe(10);
  });

  it('wins a fight using power strike', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.strength = 300;
    player.attributes.dexterity = 500;
    player.attributes.speed = 30;
    player.skills = { powerStrike: 1 };
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    const run = () =>
      simulateBattle(
        player,
        enemy,
        (_p, e) => ({
          kind: 'skill' as const,
          skillId: 'powerStrike',
          targetId: e.id,
          targetZone: 'head' as const,
        }),
        mulberry32(42),
      );
    const first = run();
    expect(first).toEqual(run());
    expect(first.playerWon).toBe(true);
  });
});

describe('cities campaign', () => {
  it('gates cities by fame rank', () => {
    expect(unlockedCities(0).map((c) => c.id)).toEqual(['londinium']);
    expect(unlockedCities(28)).toHaveLength(10);
    expect(isCityUnlocked(CITIES[1], 1)).toBe(false);
    expect(isCityUnlocked(CITIES[1], 2)).toBe(true);
  });

  it('builds ascending coliseum ladders', () => {
    expect(coliseumOpponentLevels(CITIES[0])).toEqual([1, 2, 3]);
  });
});

describe('blacksmith', () => {
  it('forges crafted gear consuming metal and gold', () => {
    const state = { ...createCampaignStart(mulberry32(1)), metals: { bronze: 2, iron: 0, silver: 0, gold: 0 } };
    const forged = forge(state, 'head', 'bronze', mulberry32(2));
    expect(forged.metals.bronze).toBe(1);
    expect(forged.gold).toBe(state.gold - forgeCost('bronze'));
    expect(forged.inventory).toHaveLength(1);
    const item = forged.inventory[0];
    expect(item.quality).toBeGreaterThanOrEqual(1.3);
    expect(item.quality).toBeLessThanOrEqual(1.6);
    expect(item.affixCount).toBeLessThanOrEqual(6);
  });

  it('rejects forging without the metal', () => {
    const state = { ...createCampaignStart(mulberry32(3)), metals: { bronze: 0, iron: 0, silver: 0, gold: 0 } };
    expect(() => forge(state, 'head', 'bronze', mulberry32(4))).toThrow();
  });
});

describe('infirmary', () => {
  it('heals a wounded fighter and deducts gold', () => {
    const state = createCampaignStart(mulberry32(5));
    const wounded = {
      ...state.roster[0],
      zones: { ...state.roster[0].zones, torso: { ...state.roster[0].zones.torso, hp: 1 } },
    };
    const s2 = { ...state, roster: [wounded] };
    const healed = healToFull(s2);
    expect(healed.roster[0].zones.torso.hp).toBe(healed.roster[0].zones.torso.maxHp);
    expect(healed.gold).toBe(s2.gold - healCost(wounded));
  });

  it('rejects healing without gold', () => {
    const state = createCampaignStart(mulberry32(6));
    expect(() => healToFull({ ...state, gold: 0 })).toThrow();
  });
});

describe('stabilize', () => {
  it('revives destroyed zones to 1 HP', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.zones.head.hp = 0;
    fighter.zones.torso.hp = 0;
    const revived = stabilize(fighter);
    expect(revived.alive).toBe(true);
    expect(revived.zones.head.hp).toBe(1);
    expect(revived.zones.torso.hp).toBe(1);
  });
});

describe('battle rewards', () => {
  it('execute grants metal loot, mercy does not', () => {
    expect(postBattleRewards(5, 'mercy').metals).toEqual({});
    expect(postBattleRewards(5, 'execute').metals.silver).toBe(1);
    expect(postBattleRewards(1, 'execute').metals.bronze).toBe(1);
  });
});
