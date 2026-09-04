import {
  applyGenderBonus,
  createCampaignStart,
  createFighter,
  deserializeState,
  GENDER_CHARISMA_BONUS,
  GENDER_STRENGTH_BONUS,
  mulberry32,
  serializeState,
} from './index';

describe('character creation', () => {
  it('stores gender and appearance on a fighter', () => {
    const f = createFighter({
      gender: 'female',
      appearance: { skin: 'dark', hairStyle: 'curly', hairColor: '#20120b', robe: '#6b4a8c', robeShade: '#4a3066' },
    });
    expect(f.gender).toBe('female');
    expect(f.appearance?.skin).toBe('dark');
    expect(f.appearance?.hairStyle).toBe('curly');
  });

  it('defaults to male with no appearance', () => {
    const f = createFighter();
    expect(f.gender).toBe('male');
    expect(f.appearance).toBeNull();
  });

  it('grants male gladiators a strength bonus on their base and current stats', () => {
    const f = createFighter({ style: 'murmillo' });
    const before = f.attributes.strength;
    const after = applyGenderBonus(f, 'male');
    expect(after.gender).toBe('male');
    expect(after.attributes.strength).toBe(before + GENDER_STRENGTH_BONUS);
    expect(after.baseAttributes.strength).toBe(before + GENDER_STRENGTH_BONUS);
    expect(after.attributes.charisma).toBe(f.attributes.charisma);
  });

  it('grants female gladiators a charisma bonus', () => {
    const f = createFighter({ style: 'murmillo' });
    const before = f.attributes.charisma;
    const after = applyGenderBonus(f, 'female');
    expect(after.gender).toBe('female');
    expect(after.attributes.charisma).toBe(before + GENDER_CHARISMA_BONUS);
    expect(after.baseAttributes.charisma).toBe(before + GENDER_CHARISMA_BONUS);
  });

  it('round-trips gender and appearance through save serialization', () => {
    const state = createCampaignStart(mulberry32(1));
    state.roster[0].gender = 'female';
    state.roster[0].appearance = { skin: 'tan', hairStyle: 'long', hairColor: '#b0763a', robe: '#3a5a8c', robeShade: '#27406b' };
    const parsed = deserializeState(serializeState(state));
    expect(parsed?.roster[0].gender).toBe('female');
    expect(parsed?.roster[0].appearance?.skin).toBe('tan');
    expect(parsed?.roster[0].appearance?.hairStyle).toBe('long');
  });
});
