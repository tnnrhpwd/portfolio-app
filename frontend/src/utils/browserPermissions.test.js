import {
  GEOLOCATION,
  MICROPHONE,
  hasPermission,
  isPermissionEnabled,
  queryPermissionState,
  readPermissionPrefs,
  setPermissionEnabled,
} from './browserPermissions';

describe('browserPermissions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults every permission to off', () => {
    expect(readPermissionPrefs()).toEqual({});
    expect(isPermissionEnabled(MICROPHONE)).toBe(false);
    expect(isPermissionEnabled(GEOLOCATION)).toBe(false);
  });

  it('remembers an opt-in per permission', () => {
    setPermissionEnabled(MICROPHONE, true);
    expect(isPermissionEnabled(MICROPHONE)).toBe(true);
    expect(isPermissionEnabled(GEOLOCATION)).toBe(false);

    setPermissionEnabled(MICROPHONE, false);
    expect(isPermissionEnabled(MICROPHONE)).toBe(false);
  });

  it('reads as unset when storage holds junk', () => {
    localStorage.setItem('csimple_permission_prefs', 'not json');
    expect(readPermissionPrefs()).toEqual({});
    expect(isPermissionEnabled(MICROPHONE)).toBe(false);
  });

  describe('queryPermissionState', () => {
    const original = navigator.permissions;

    afterEach(() => {
      Object.defineProperty(navigator, 'permissions', {
        value: original,
        configurable: true,
      });
    });

    it('reports the browser state without prompting', async () => {
      const query = jest.fn().mockResolvedValue({ state: 'granted' });
      Object.defineProperty(navigator, 'permissions', {
        value: { query },
        configurable: true,
      });

      await expect(queryPermissionState(MICROPHONE)).resolves.toBe('granted');
      expect(query).toHaveBeenCalledWith({ name: MICROPHONE });
      await expect(hasPermission(MICROPHONE)).resolves.toBe(true);
    });

    it('treats a rejected descriptor as unsupported', async () => {
      const query = jest.fn().mockRejectedValue(new Error('unsupported'));
      Object.defineProperty(navigator, 'permissions', {
        value: { query },
        configurable: true,
      });

      await expect(queryPermissionState(MICROPHONE)).resolves.toBe('unsupported');
    });

    it('treats a missing Permissions API as unsupported', async () => {
      Object.defineProperty(navigator, 'permissions', {
        value: undefined,
        configurable: true,
      });

      await expect(queryPermissionState(GEOLOCATION)).resolves.toBe('unsupported');
    });
  });
});
