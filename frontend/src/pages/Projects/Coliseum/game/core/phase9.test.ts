import {
  appearanceId,
  DEFAULT_APPEARANCE,
  generateOpponent,
  generateRecruit,
  HAIR_COLORS,
  HAIR_STYLES,
  mulberry32,
  ROBE_OPTIONS,
  SKIN_TONES,
  randomAppearance,
  randomGender,
} from './index';

describe('appearance options', () => {
  it('derives a stable texture id, distinct per gender', () => {
    const male = appearanceId(DEFAULT_APPEARANCE, 'male');
    const female = appearanceId(DEFAULT_APPEARANCE, 'female');
    expect(male).toMatch(/^m_/);
    expect(female).toMatch(/^f_/);
    expect(male).not.toBe(female);
  });

  it('rolls a valid random appearance deterministically', () => {
    const a1 = randomAppearance(mulberry32(4));
    const a2 = randomAppearance(mulberry32(4));
    expect(a1).toEqual(a2);
    expect(SKIN_TONES).toContain(a1.skin);
    expect(HAIR_STYLES).toContain(a1.hairStyle);
    expect(HAIR_COLORS).toContain(a1.hairColor);
    expect(ROBE_OPTIONS).toContainEqual({ robe: a1.robe, robeShade: a1.robeShade });
  });

  it('rolls a valid gender deterministically', () => {
    const g = randomGender(mulberry32(7));
    expect(['male', 'female']).toContain(g);
    expect(randomGender(mulberry32(7))).toBe(g);
  });
});

describe('recruit and opponent appearance', () => {
  it('gives recruits a random gender and appearance', () => {
    const recruit = generateRecruit(2, mulberry32(1));
    expect(['male', 'female']).toContain(recruit.gender);
    expect(recruit.appearance).not.toBeNull();
    expect(SKIN_TONES).toContain(recruit.appearance?.skin);
  });

  it('gives opponents a random gender and appearance', () => {
    const foe = generateOpponent(3, mulberry32(2));
    expect(['male', 'female']).toContain(foe.gender);
    expect(foe.appearance).not.toBeNull();
  });
});
