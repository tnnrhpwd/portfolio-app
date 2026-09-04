/**
 * uiMapperApi.test.js — unit tests for the UIMapper frontend API helper
 * (frontend/src/services/uiMapperApi.js).
 */

import { autoMapImage } from './uiMapperApi';

jest.mock('../config/api', () => ({
    getApiBase: () => '/api/data/',
}));

describe('uiMapperApi — autoMapImage', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    it('throws immediately when no token is provided', async () => {
        await expect(autoMapImage('data:image/png;base64,x', 10, 10, '')).rejects.toThrow(
            'Sign in required'
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('POSTs the image to the automap endpoint and returns regions', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, regions: [{ name: 'login', x: 1, y: 2, w: 3, h: 4 }] }),
        });

        const regions = await autoMapImage('data:image/png;base64,x', 10, 10, 'token-123');

        expect(global.fetch).toHaveBeenCalledWith(
            '/api/data/uimapper/automap',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
                body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,x', width: 10, height: 10 }),
            })
        );
        expect(regions).toEqual([{ name: 'login', x: 1, y: 2, w: 3, h: 4 }]);
    });

    it('surfaces the server error message on a non-ok response', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'AI auto-mapping failed.' }),
        });

        await expect(autoMapImage('data:image/png;base64,x', 10, 10, 'token')).rejects.toThrow(
            'AI auto-mapping failed.'
        );
    });

    it('falls back to a generic message when the response is not JSON', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            json: async () => {
                throw new Error('not json');
            },
        });

        await expect(autoMapImage('data:image/png;base64,x', 10, 10, 'token')).rejects.toThrow(
            'AI auto-mapping failed. Please try again.'
        );
    });
});
