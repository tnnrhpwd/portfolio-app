/**
 * uiMapperController.test.js — unit tests for the UI Mapper AI auto-map
 * endpoint (backend/controllers/uiMapperController.js).
 *
 * The Bedrock adapter and logger are mocked so the test is fast and has no
 * dependency on real AWS credentials or network access — the same approach
 * as bedrockService.test.js.
 */

const mockCreateBedrockCompletion = jest.fn();
const mockIsBedrockConfigured = jest.fn(() => true);

jest.mock('../../services/bedrockService', () => ({
    createBedrockCompletion: (...args) => mockCreateBedrockCompletion(...args),
    isBedrockConfigured: () => mockIsBedrockConfigured(),
}));

jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { autoMap } = require('../../controllers/uiMapperController');

// Small, valid PNG data URL (base64 chars only, passes the format regex).
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('uiMapperController — autoMap', () => {
    beforeEach(() => {
        mockCreateBedrockCompletion.mockReset();
        mockIsBedrockConfigured.mockReset();
        mockIsBedrockConfigured.mockReturnValue(true);
    });

    it('returns 503 when Bedrock is not configured', async () => {
        mockIsBedrockConfigured.mockReturnValue(false);
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when no image is provided', async () => {
        const res = mockRes();
        await autoMap({ body: {} }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockCreateBedrockCompletion).not.toHaveBeenCalled();
    });

    it('returns 400 when the image is too large', async () => {
        const res = mockRes();
        const oversized = `data:image/png;base64,${'A'.repeat(8_000_001)}`;
        await autoMap({ body: { imageDataUrl: oversized } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for a non-image data URL', async () => {
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: 'data:text/plain;base64,AAAA' } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('parses a fenced JSON response into named regions', async () => {
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: '```json\n[{"name":"login button","x":10,"y":20,"w":100,"h":40}]\n```' } }],
        });
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL, width: 800, height: 600 } }, res, jest.fn());

        expect(mockCreateBedrockCompletion).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            regions: [{ name: 'login button', x: 10, y: 20, w: 100, h: 40 }],
        });
    });

    it('strips prose around the JSON and rounds float coordinates', async () => {
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: 'Here are the boxes: [{"name":"nav","x":1.6,"y":2.4,"w":30.5,"h":20.2}] thanks!' } }],
        });
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL, width: 100, height: 100 } }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({
            success: true,
            regions: [{ name: 'nav', x: 2, y: 2, w: 31, h: 20 }],
        });
    });

    it('drops degenerate boxes and clamps out-of-bounds coordinates', async () => {
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: '[{"name":"tiny","x":0,"y":0,"w":1,"h":2},{"name":"off","x":-5,"y":999,"w":50,"h":30},{"name":"ok","x":0,"y":0,"w":50,"h":30}]' } }],
        });
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL, width: 100, height: 100 } }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({
            success: true,
            regions: [
                { name: 'off', x: 0, y: 99, w: 50, h: 30 },
                { name: 'ok', x: 0, y: 0, w: 50, h: 30 },
            ],
        });
    });

    it('maps Bedrock throttling to 429', async () => {
        const err = new Error('throttled');
        err.code = 'BEDROCK_THROTTLED';
        mockCreateBedrockCompletion.mockRejectedValue(err);
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(429);
    });

    it('maps Bedrock access-denied to 502', async () => {
        const err = new Error('denied');
        err.code = 'BEDROCK_ACCESS_DENIED';
        mockCreateBedrockCompletion.mockRejectedValue(err);
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(502);
    });

    it('returns 502 when the model returns unparseable text', async () => {
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: 'I cannot help with that.' } }],
        });
        const res = mockRes();
        await autoMap({ body: { imageDataUrl: PNG_DATA_URL, width: 100, height: 100 } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(502);
    });
});
