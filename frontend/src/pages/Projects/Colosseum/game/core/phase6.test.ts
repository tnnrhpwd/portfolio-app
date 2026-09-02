import {
  createCampaignStart,
  deserializeState,
  mulberry32,
  serializeState,
} from './index';

describe('save serialization', () => {
  it('round-trips the game state', () => {
    const state = createCampaignStart(mulberry32(1));
    state.gold = 777;
    state.fame = 3;
    const parsed = deserializeState(serializeState(state));
    expect(parsed).not.toBeNull();
    expect(parsed?.gold).toBe(777);
    expect(parsed?.fame).toBe(3);
    expect(parsed?.roster).toHaveLength(1);
    expect(parsed?.roster[0].name).toBe(state.roster[0].name);
  });

  it('rejects invalid JSON', () => {
    expect(deserializeState('not-json')).toBeNull();
  });

  it('rejects an empty roster', () => {
    expect(deserializeState(JSON.stringify({ roster: [], gold: 0, fame: 0 }))).toBeNull();
  });
});
