// `config/api.js` reads `import.meta.env`, which Jest cannot parse. Mock the
// API base so the slice (and its thunk imports) can be loaded in a test.
jest.mock('../../config/api', () => ({
  getApiBase: () => 'http://localhost/api/data/',
  getApiOrigin: () => 'http://localhost',
}));

import { dataSlice } from './dataSlice.js';

/**
 * The profile-update thunk's fulfilled reducer is what makes an uploaded photo
 * or renamed account show up immediately (and survive a reload), so it is worth
 * pinning down: merge into state.user, keep the token, persist to localStorage.
 */
describe('dataSlice — updateProfile', () => {
  const reducer = dataSlice.reducer;

  const stateWithUser = () => ({
    ...reducer(undefined, { type: '@@INIT' }),
    user: { _id: 'u1', nickname: 'Old Name', email: 'old@example.com', token: 'jwt-token' },
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('merges the saved profile into state.user and persists it', () => {
    const next = reducer(stateWithUser(), {
      type: 'data/updateProfile/fulfilled',
      payload: {
        success: true,
        profile: { nickname: 'New Name', email: 'new@example.com', profilePicture: 'data:image/jpeg;base64,AAA' },
      },
    });

    expect(next.user.nickname).toBe('New Name');
    expect(next.user.email).toBe('new@example.com');
    expect(next.user.profilePicture).toBe('data:image/jpeg;base64,AAA');
    // Auth token must survive a profile edit.
    expect(next.user.token).toBe('jwt-token');

    expect(JSON.parse(localStorage.getItem('user')).nickname).toBe('New Name');
  });

  it('clears the stored picture when the payload has null', () => {
    const next = reducer(stateWithUser(), {
      type: 'data/updateProfile/fulfilled',
      payload: { success: true, profile: { profilePicture: null } },
    });

    expect(next.user.profilePicture).toBeNull();
  });

  it('is a no-op when the payload carries no profile', () => {
    const before = stateWithUser();
    const next = reducer(before, { type: 'data/updateProfile/fulfilled', payload: {} });

    expect(next.user).toEqual(before.user);
  });
});
