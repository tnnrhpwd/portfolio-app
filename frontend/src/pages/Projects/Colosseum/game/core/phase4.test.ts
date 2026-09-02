import {
  autoBattle,
  createCampaignStart,
  createFighter,
  evaluateAchievements,
  generateOpponent,
  mulberry32,
  resetAttributes,
  resetSkills,
  spendAttributePoint,
  spendSkillPoint,
} from './index';

describe('attribute/skill reset (undo)', () => {
  it('refunds attribute points and restores the baseline', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.attributePoints = 3;
    const trained = spendAttributePoint(
      spendAttributePoint(spendAttributePoint(fighter, 'strength'), 'strength'),
      'strength',
    );
    expect(trained.attributes.strength).toBe(fighter.baseAttributes.strength + 3);
    expect(trained.attributePoints).toBe(0);
    const reset = resetAttributes(trained);
    expect(reset.attributes.strength).toBe(fighter.baseAttributes.strength);
    expect(reset.attributePoints).toBe(3);
  });

  it('refunds skill points and clears ranks', () => {
    const fighter = createFighter({ style: 'murmillo' });
    fighter.skillPoints = 3;
    const a = spendSkillPoint(fighter, 'shieldBash');
    const b = spendSkillPoint(a, 'shieldBash');
    expect(b.skills.shieldBash).toBe(2);
    expect(b.skillPoints).toBe(1);
    const reset = resetSkills(b);
    expect(reset.skills).toEqual({});
    expect(reset.skillPoints).toBe(3);
  });
});

describe('achievements', () => {
  it('unlocks first blood at 1 fame and never duplicates', () => {
    const base = createCampaignStart(mulberry32(1));
    const first = evaluateAchievements({ ...base, fame: 1 });
    expect(first.unlocked).toContain('first-blood');
    expect(first.state.unlockedAchievements).toContain('first-blood');
    const again = evaluateAchievements(first.state);
    expect(again.unlocked).toHaveLength(0);
  });

  it('unlocks champion after defeating a city champion', () => {
    const base = createCampaignStart(mulberry32(2));
    expect(evaluateAchievements({ ...base, coliseumRanks: { londinium: 2 } }).unlocked).not.toContain('champion');
    expect(evaluateAchievements({ ...base, coliseumRanks: { londinium: 1 } }).unlocked).toContain('champion');
  });

  it('unlocks schooled at 3 roster members', () => {
    const base = createCampaignStart(mulberry32(3));
    const fighter = base.roster[0];
    const roster = [fighter, { ...fighter, id: 'b' }, { ...fighter, id: 'c' }];
    expect(evaluateAchievements({ ...base, roster }).unlocked).toContain('schooled');
  });
});

describe('auto-battle', () => {
  it('runs a deterministic winning battle with the built-in AI', () => {
    const player = createFighter({ style: 'murmillo' });
    player.attributes.strength = 300;
    player.attributes.dexterity = 500;
    player.attributes.speed = 30;
    const enemy = generateOpponent(1, mulberry32(4));
    const a = autoBattle(player, enemy, mulberry32(42));
    const b = autoBattle(player, enemy, mulberry32(42));
    expect(a).toEqual(b);
    expect(a.playerWon).toBe(true);
    expect(a.rounds).toBeGreaterThan(0);
  });
});
