/**
 * Unit tests for the site → addon scheme sync.
 *
 * The addon API is injected, so nothing here touches a real addon (or a network).
 */

import { pushSchemeToAddon, syncSchemeToAddon, toAddonAppearance } from './schemeSync.js';

describe('toAddonAppearance', () => {
  it('maps a named scheme to the addon key', () => {
    expect(toAddonAppearance({ scheme: 'sakura' })).toEqual({ colorScheme: 'sakura' });
  });

  it('carries no custom pair for a named scheme', () => {
    const stored = toAddonAppearance({ scheme: 'ocean', custom: { primary: '#ff0000', secondary: '#00ff00' } });
    expect(stored).toEqual({ colorScheme: 'ocean' });
  });

  it('translates the custom pair across the vocabulary boundary', () => {
    // The site's "primary" is the DOMINANT hue = the addon's `accent`. Getting this
    // backwards inverts every custom scheme, so it is pinned here.
    expect(toAddonAppearance({ scheme: 'custom', custom: { primary: '#22cc88', secondary: '#3b82f6' } }))
      .toEqual({ colorScheme: 'custom', customColors: { accent: '#22cc88', primary: '#3b82f6' } });
  });

  it('repairs a half-written or malformed custom pair rather than sending it', () => {
    expect(toAddonAppearance({ scheme: 'custom', custom: { primary: '#ABCDEF' } }))
      .toEqual({ colorScheme: 'custom', customColors: { accent: '#abcdef', primary: '#3b82f6' } });
    expect(toAddonAppearance({ scheme: 'custom', custom: { primary: 'red', secondary: '#abc' } }))
      .toEqual({ colorScheme: 'custom', customColors: { accent: '#06b6d4', primary: '#3b82f6' } });
  });

  it('returns null for anything that is not one of our schemes', () => {
    for (const bad of [undefined, null, {}, { scheme: 'neon' }, { scheme: 'Ocean' }]) {
      expect(toAddonAppearance(bad)).toBeNull();
    }
  });
});

describe('pushSchemeToAddon', () => {
  const makeApi = (initial = { theme: 'dark', agents: [{ id: 'default' }] }) => {
    const saved = [];
    return {
      saved,
      getAddonSettings: jest.fn().mockResolvedValue(initial),
      saveAddonSettings: jest.fn().mockImplementation(async (s) => { saved.push(s); return { status: 'ok' }; }),
    };
  };

  it('merges onto the settings it read, because PUT replaces the whole block', async () => {
    const api = makeApi();
    const result = await pushSchemeToAddon({ scheme: 'forest' }, { getAddonApi: async () => api });
    expect(result).toEqual({ ok: true, sent: { colorScheme: 'forest' } });
    // The chat settings that live beside the appearance keys must survive the write.
    expect(api.saved[0]).toEqual({ theme: 'dark', agents: [{ id: 'default' }], colorScheme: 'forest' });
  });

  it('does nothing at all for an unknown scheme', async () => {
    const api = makeApi();
    const result = await pushSchemeToAddon({ scheme: 'neon' }, { getAddonApi: async () => api });
    expect(result).toEqual({ ok: false, reason: 'unknown-scheme' });
    expect(api.getAddonSettings).not.toHaveBeenCalled();
    expect(api.saveAddonSettings).not.toHaveBeenCalled();
  });

  it('reports an offline addon without throwing', async () => {
    const offline = {
      getAddonSettings: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      saveAddonSettings: jest.fn(),
    };
    await expect(pushSchemeToAddon({ scheme: 'ocean' }, { getAddonApi: async () => offline }))
      .resolves.toEqual({ ok: false, reason: 'addon-offline' });
    expect(offline.saveAddonSettings).not.toHaveBeenCalled();
  });

  it('reports a failing write without throwing', async () => {
    const api = {
      getAddonSettings: jest.fn().mockResolvedValue({ theme: 'dark' }),
      saveAddonSettings: jest.fn().mockRejectedValue(new Error('500')),
    };
    await expect(pushSchemeToAddon({ scheme: 'ocean' }, { getAddonApi: async () => api }))
      .resolves.toEqual({ ok: false, reason: 'addon-offline' });
  });

  it('treats an unreadable settings payload as offline rather than writing garbage', async () => {
    const api = {
      getAddonSettings: jest.fn().mockResolvedValue(null),
      saveAddonSettings: jest.fn(),
    };
    const result = await pushSchemeToAddon({ scheme: 'ocean' }, { getAddonApi: async () => api });
    expect(result.ok).toBe(false);
    expect(api.saveAddonSettings).not.toHaveBeenCalled();
  });

  it('survives a module that does not expose the addon API at all', async () => {
    await expect(pushSchemeToAddon({ scheme: 'ocean' }, { getAddonApi: async () => ({}) }))
      .resolves.toEqual({ ok: false, reason: 'no-api' });
  });
});

describe('syncSchemeToAddon', () => {
  it('never rejects, so a picker cannot be broken by a missing addon', () => {
    // Deliberately not awaited by callers; a rejection here would be an unhandled one.
    expect(() => syncSchemeToAddon({ scheme: 'ocean' }, { getAddonApi: async () => { throw new Error('nope'); } }))
      .not.toThrow();
  });
});
