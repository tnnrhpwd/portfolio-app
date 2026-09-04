import {
  createFighter,
  crowdAppealRestore,
  currentHp,
  getSkill,
  isActiveSkill,
  mulberry32,
  resolveRound,
} from './index';

describe('crowd appeal (charisma-scaled morale)', () => {
  it('restores ~2.2 MP per point of charisma', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributes.charisma = 100;
    fighter.maxMorale = 500;
    expect(crowdAppealRestore(fighter)).toBe(220);
  });

  it('caps restoration at the maximum morale pool', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributes.charisma = 500;
    fighter.maxMorale = 200;
    expect(crowdAppealRestore(fighter)).toBe(200);
  });

  it('restores nothing with zero charisma', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributes.charisma = 0;
    expect(crowdAppealRestore(fighter)).toBe(0);
  });
});

describe('morale-war skills', () => {
  it('exposes the whole-team shout and support kit', () => {
    expect(isActiveSkill('demoralizeAll')).toBe(true);
    expect(isActiveSkill('healAll')).toBe(true);
    expect(isActiveSkill('net')).toBe(true);
    expect(isActiveSkill('whirlwind')).toBe(true);
    expect(isActiveSkill('protect')).toBe(true);
    expect(getSkill('demoralizeAll')?.mpCost).toBe(20);
    expect(getSkill('protect')?.maxRank).toBe(10);
  });

  it('demoralize all strips most of the whole enemy team MP', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.speed = 20;
    player.skills = { demoralizeAll: 1 };
    player.morale = 40;
    const e1 = createFighter({ style: 'murmillo', level: 1 });
    const e2 = createFighter({ style: 'murmillo', level: 1 });
    const result = resolveRound(
      [player],
      [e1, e2],
      { [player.id]: { kind: 'skill', skillId: 'demoralizeAll' } },
      mulberry32(3),
    );
    expect(result.enemyTeam[0].morale).toBe(10);
    expect(result.enemyTeam[1].morale).toBe(10);
  });

  it('heal all mends the whole team', () => {
    const a = createFighter({ style: 'murmillo' });
    a.attributes.speed = 30;
    a.attributes.defense = 500;
    a.skills = { healAll: 1 };
    a.morale = 40;
    a.zones.torso.hp = 50;
    const b = createFighter({ style: 'murmillo' });
    b.attributes.speed = 20;
    b.attributes.defense = 500;
    b.zones.torso.hp = 10;
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    const result = resolveRound(
      [a, b],
      [enemy],
      { [a.id]: { kind: 'skill', skillId: 'healAll' }, [b.id]: { kind: 'pass' } },
      mulberry32(4),
    );
    expect(result.playerTeam[0].zones.torso.hp).toBeGreaterThan(50);
    expect(result.playerTeam[1].zones.torso.hp).toBeGreaterThan(10);
  });

  it('whirlwind strikes every enemy in reach', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.strength = 50;
    player.attributes.dexterity = 500;
    player.attributes.speed = 30;
    player.skills = { whirlwind: 1 };
    player.morale = 40;
    const e1 = createFighter({ style: 'murmillo', level: 1 });
    const e2 = createFighter({ style: 'murmillo', level: 1 });
    const start1 = currentHp(e1);
    const start2 = currentHp(e2);
    const result = resolveRound(
      [player],
      [e1, e2],
      { [player.id]: { kind: 'skill', skillId: 'whirlwind' } },
      mulberry32(5),
    );
    expect(currentHp(result.enemyTeam[0])).toBeLessThan(start1);
    expect(currentHp(result.enemyTeam[1])).toBeLessThan(start2);
  });

  it('net always entangles and slows the target', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.dexterity = 0; // would normally miss
    player.attributes.speed = 30;
    player.skills = { net: 1 };
    player.morale = 40;
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    enemy.attributes.defense = 500;
    const start = currentHp(enemy);
    const result = resolveRound(
      [player],
      [enemy],
      { [player.id]: { kind: 'skill', skillId: 'net' } },
      mulberry32(6),
    );
    expect(result.enemyTeam[0].status.slow).toBeGreaterThan(0);
    expect(currentHp(result.enemyTeam[0])).toBe(start);
  });

  it('protect intercepts blows aimed at a teammate', () => {
    const guard = createFighter({ style: 'murmillo' });
    guard.attributes.speed = 500;
    guard.skills = { protect: 1 };
    guard.morale = 40;
    guard.row = 'back';
    const ally = createFighter({ style: 'murmillo' });
    ally.attributes.speed = 499;
    ally.row = 'front';
    const enemy = createFighter({ style: 'murmillo', level: 1 });
    enemy.attributes.speed = 1;
    enemy.attributes.strength = 100;
    enemy.attributes.dexterity = 500;
    const guardStart = currentHp(guard);
    const allyStart = currentHp(ally);
    const result = resolveRound(
      [guard, ally],
      [enemy],
      { [guard.id]: { kind: 'skill', skillId: 'protect' }, [ally.id]: { kind: 'pass' } },
      mulberry32(7),
    );
    expect(result.playerTeam[0].status.guarding).toBeGreaterThan(0);
    expect(currentHp(result.playerTeam[1])).toBe(allyStart);
    expect(currentHp(result.playerTeam[0])).toBeLessThan(guardStart);
  });
});
