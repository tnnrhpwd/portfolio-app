/**
 * marketplaceApi.test.js — unit tests for the Simple skill marketplace API
 * helpers (frontend/src/services/marketplaceApi.js).
 */

import {
  searchMarketSkills,
  getMarketSkill,
  installMarketSkill,
  rateMarketSkill,
  flagMarketSkill,
  publishMarketSkill,
} from './marketplaceApi';

jest.mock('../config/api', () => ({
  getApiBase: () => '/api/data/',
}));

const TOKEN = 'token-123';

describe('marketplaceApi', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  const jsonRes = (body, ok = true) => ({
    ok,
    text: async () => JSON.stringify(body),
  });

  describe('searchMarketSkills', () => {
    it('throws when no token is provided', async () => {
      await expect(searchMarketSkills('')).rejects.toThrow('Sign in required');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('GETs with default sort/pagination and returns the full response', async () => {
      const body = { skills: [{ marketId: 'm1', name: 'Sort downloads' }], total: 1, page: 1, perPage: 20 };
      global.fetch.mockResolvedValue(jsonRes(body));

      const out = await searchMarketSkills(TOKEN);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills?sort=trust&page=1&perPage=20',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-123' }) })
      );
      expect(out.skills).toHaveLength(1);
    });

    it('passes q and sort through the query string', async () => {
      global.fetch.mockResolvedValue(jsonRes({ skills: [], total: 0, page: 1, perPage: 10 }));

      await searchMarketSkills(TOKEN, { q: 'organize', sort: 'downloads', page: 2, perPage: 10 });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills?sort=downloads&page=2&perPage=10&q=organize',
        expect.anything()
      );
    });

    it('surfaces the server dataMessage on a non-ok response', async () => {
      global.fetch.mockResolvedValue(jsonRes({ dataMessage: 'Rate limited' }, false));
      await expect(searchMarketSkills(TOKEN)).rejects.toThrow('Rate limited');
    });
  });

  describe('getMarketSkill', () => {
    it('GETs the latest version when no version is given', async () => {
      global.fetch.mockResolvedValue(jsonRes({ marketId: 'm1', name: 'X', steps: [] }));

      await getMarketSkill(TOKEN, 'm1');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-123' }) })
      );
    });

    it('GETs a pinned version', async () => {
      global.fetch.mockResolvedValue(jsonRes({ marketId: 'm1', version: 2, steps: [] }));
      await getMarketSkill(TOKEN, 'm1', 2);
      expect(global.fetch).toHaveBeenCalledWith('/api/data/market/skills/m1/2', expect.anything());
    });
  });

  describe('installMarketSkill', () => {
    it('POSTs to the install endpoint and returns capability data', async () => {
      const body = {
        marketId: 'm1', version: 1,
        skill: { slug: 'sort-downloads', steps: [] },
        lowTrust: true,
        capabilitySummary: { summary: 'Sorts files' },
      };
      global.fetch.mockResolvedValue(jsonRes(body));

      const out = await installMarketSkill(TOKEN, 'm1');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1/install',
        expect.objectContaining({ method: 'POST', body: '{}' })
      );
      expect(out.lowTrust).toBe(true);
    });

    it('passes a requested version', async () => {
      global.fetch.mockResolvedValue(jsonRes({ ok: true }));
      await installMarketSkill(TOKEN, 'm1', 3);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1/install',
        expect.objectContaining({ body: JSON.stringify({ version: 3 }) })
      );
    });
  });

  describe('rateMarketSkill', () => {
    it('POSTs stars + ranAt run evidence', async () => {
      global.fetch.mockResolvedValue(jsonRes({ ok: true, ratingCount: 1, avgRating: 5 }));

      await rateMarketSkill(TOKEN, 'm1', { stars: 5, ranAt: '2026-09-08T00:00:00.000Z' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1/rate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ stars: 5, outcome: undefined, ranAt: '2026-09-08T00:00:00.000Z' }),
        })
      );
    });

    it('surfaces the install-before-rate gate error', async () => {
      global.fetch.mockResolvedValue(
        jsonRes({ dataMessage: 'You must install and run this skill before rating it.' }, false)
      );
      await expect(
        rateMarketSkill(TOKEN, 'm1', { stars: 4, ranAt: new Date().toISOString() })
      ).rejects.toThrow('install and run');
    });
  });

  describe('flagMarketSkill', () => {
    it('POSTs a reason to the flag endpoint', async () => {
      global.fetch.mockResolvedValue(jsonRes({ ok: true, flagCount: 1 }));
      await flagMarketSkill(TOKEN, 'm1', 'malware-ish');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1/flag',
        expect.objectContaining({ body: JSON.stringify({ reason: 'malware-ish' }) })
      );
    });

    it('omits the reason body when empty', async () => {
      global.fetch.mockResolvedValue(jsonRes({ ok: true, flagCount: 1 }));
      await flagMarketSkill(TOKEN, 'm1', '');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills/m1/flag',
        expect.objectContaining({ body: '{}' })
      );
    });
  });

  describe('publishMarketSkill', () => {
    it('POSTs the payload and returns the publish result', async () => {
      const body = { marketId: 'm1', version: 1, isNewSkill: true };
      global.fetch.mockResolvedValue(jsonRes(body));

      const payload = { slug: 'x', name: 'X', steps: [] };
      const out = await publishMarketSkill(TOKEN, payload);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/data/market/skills',
        expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) })
      );
      expect(out.isNewSkill).toBe(true);
    });
  });
});
