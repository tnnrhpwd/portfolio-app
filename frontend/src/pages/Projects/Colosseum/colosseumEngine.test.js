import {
  CLASSES,
  CLASS_KEYS,
  MAX_ROSTER,
  START_GOLD,
  makeGladiator,
  effectiveStats,
  isAlive,
  isTeamDefeated,
  addXp,
  xpToNext,
  computeDamage,
  resolveRound,
  rollEnemyTeam,
  victoryRewards,
  trainCost,
  healCost,
  weaponAtk,
  armorDef,
} from './colosseumEngine';

const mid = () => 0.5; // fixed RNG for deterministic tests

describe('makeGladiator', () => {
  it('builds a valid gladiator from a class', () => {
    const g = makeGladiator('Marcus', 'murmillo', { id: 'g1' });
    expect(g.id).toBe('g1');
    expect(g.classKey).toBe('murmillo');
    expect(g.level).toBe(1);
    expect(g.hp).toBe(CLASSES.murmillo.base.maxHp);
    expect(g.skillCd).toBe(0);
    expect(g.status).toEqual({ stun: 0, slow: 0, defending: false, counter: false });
  });

  it('defaults unknown class keys to murmillo', () => {
    const g = makeGladiator('X', 'not-a-class', { id: 'g2' });
    expect(g.classKey).toBe('murmillo');
  });
});

describe('effectiveStats', () => {
  it('reflects class base + level + equipment + training', () => {
    const g = makeGladiator('Test', 'murmillo', {
      id: 'g3',
      level: 3,
      weaponId: 'w2',
      armorId: 'a2',
      training: { hp: 1, atk: 2, def: 3 },
    });
    const s = effectiveStats(g);
    const base = CLASSES.murmillo.base;
    // level 3 => 2 level-ups: +16 maxHp, +4 atk/def, +1 spd
    expect(s.maxHp).toBe(base.maxHp + 16 + 1 * 3);
    expect(s.atk).toBe(base.atk + 4 + 2 + weaponAtk(g));
    expect(s.def).toBe(base.def + 4 + 3 + armorDef(g));
    expect(s.spd).toBeCloseTo(base.spd + 1);
  });
});

describe('combat helpers', () => {
  it('computeDamage is deterministic with fixed RNG and respects defense', () => {
    const heavy = makeGladiator('A', 'thraex', { id: 'a' });
    const light = makeGladiator('B', 'retiarius', { id: 'b' });
    const tank = makeGladiator('C', 'hoplomachus', { id: 'c' });

    const vsLight = computeDamage(heavy, light, 1.0, 1.0, mid);
    const vsTank = computeDamage(heavy, tank, 1.0, 1.0, mid);
    expect(vsLight.hit).toBe(true);
    expect(vsLight.damage).toBeGreaterThan(0);
    // tank has much higher defense -> less damage
    expect(vsTank.damage).toBeLessThan(vsLight.damage);
  });

  it('computeDamage misses when accuracy roll fails', () => {
    const a = makeGladiator('A', 'thraex', { id: 'a' });
    const b = makeGladiator('B', 'retiarius', { id: 'b' });
    // rand() always returns 0.99 > 0.75 accuracy
    const result = computeDamage(a, b, 1.55, 0.75, () => 0.99);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });
});

describe('resolveRound', () => {
  const team = () => [
    makeGladiator('P1', 'murmillo', { id: 'p1' }),
    makeGladiator('P2', 'thraex', { id: 'p2' }),
  ];
  const foes = () => [makeGladiator('E1', 'retiarius', { id: 'e1' })];

  it('applies damage and never mutates the input teams', () => {
    const players = team();
    const enemies = foes();
    const snapshot = players[0].hp;
    const actions = { p1: { action: 'strike', targetId: 'e1' }, p2: { action: 'defend', targetId: null } };

    const result = resolveRound(players, enemies, actions, 1, mid);

    expect(result.enemyTeam[0].hp).toBeLessThan(enemies[0].hp);
    // inputs untouched
    expect(players[0].hp).toBe(snapshot);
  });

  it('defend halves incoming damage from slower attackers', () => {
    // Player (retiarius, spd 17) is faster than the enemy (secutor, spd 8),
    // so the player raises their guard BEFORE the enemy attacks.
    const guardedPlayer = makeGladiator('Guard', 'retiarius', { id: 'gp', hp: 500 });
    const openPlayer = makeGladiator('Open', 'retiarius', { id: 'go', hp: 500 });
    const enemy = makeGladiator('Hit', 'secutor', { id: 'e' });

    const guarded = resolveRound([guardedPlayer], [enemy], { gp: { action: 'defend', targetId: null } }, 1, mid);
    const open = resolveRound([openPlayer], [enemy], { go: { action: 'strike', targetId: 'e' } }, 1, mid);

    const guardedDmg = 500 - guarded.playerTeam[0].hp;
    const openDmg = 500 - open.playerTeam[0].hp;

    expect(openDmg).toBeGreaterThan(0);
    // With fixed RNG (mid) the raw damage is identical, so defending is exactly half.
    expect(guardedDmg).toBe(Math.round(openDmg / 2));
  });

  it('detects victory when all enemies fall', () => {
    // One very strong player one-shots a weak enemy.
    const boss = makeGladiator('Boss', 'thraex', { id: 'boss', level: 50 });
    const weak = makeGladiator('Weak', 'retiarius', { id: 'weak', hp: 1 });
    const result = resolveRound([boss], [weak], { boss: { action: 'strike', targetId: 'weak' } }, 1, mid);
    expect(result.playerWon).toBe(true);
    expect(result.enemyWon).toBe(false);
  });

  it('ticks skill cooldowns down each round', () => {
    const p = makeGladiator('Sk', 'murmillo', { id: 'sk' });
    const e = makeGladiator('En', 'retiarius', { id: 'en' });
    p.skillCd = 0;
    const first = resolveRound([p], [e], { sk: { action: 'skill', targetId: 'en' } }, 1, mid);
    expect(first.playerTeam[0].skillCd).toBe(CLASSES.murmillo.skill.cooldown - 1);
  });
});

describe('progression & economy', () => {
  it('addXp levels up correctly', () => {
    const g = makeGladiator('L', 'murmillo', { id: 'l' });
    const need = xpToNext(1);
    const leveled = addXp(g, need + 10);
    expect(leveled.level).toBe(2);
    expect(leveled.xp).toBe(10);
  });

  it('victoryRewards scales with arena power', () => {
    const low = victoryRewards(1, mid);
    const high = victoryRewards(10, mid);
    expect(high.gold).toBeGreaterThan(low.gold);
    expect(high.fame).toBeGreaterThan(low.fame);
    expect(high.xp).toBeGreaterThan(low.xp);
  });

  it('trainCost grows with investment', () => {
    expect(trainCost(10)).toBeGreaterThan(trainCost(0));
  });

  it('healCost is 0 when already full health', () => {
    const g = makeGladiator('Full', 'murmillo', { id: 'full' });
    expect(healCost(g)).toBe(1); // floor of 1 when missing 0 -> Math.max(1, 0)
  });
});

describe('world constants & generation', () => {
  it('exposes expected constants', () => {
    expect(MAX_ROSTER).toBe(3);
    expect(START_GOLD).toBeGreaterThan(0);
    expect(CLASS_KEYS).toHaveLength(5);
  });

  it('rollEnemyTeam scales count with power', () => {
    expect(rollEnemyTeam(1, mid).length).toBe(1);
    expect(rollEnemyTeam(4, mid).length).toBe(2);
    expect(rollEnemyTeam(7, mid).length).toBe(3);
  });

  it('isTeamDefeated only when team non-empty and all dead', () => {
    expect(isTeamDefeated([])).toBe(false);
    expect(isTeamDefeated([{ hp: 0 }, { hp: 1 }])).toBe(false);
    expect(isTeamDefeated([{ hp: 0 }])).toBe(true);
  });

  it('isAlive checks hp', () => {
    expect(isAlive({ hp: 1 })).toBe(true);
    expect(isAlive({ hp: 0 })).toBe(false);
  });
});
