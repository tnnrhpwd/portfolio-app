/**
 * OCR Controller Tests
 *
 * Verifies the controller matches the frontend contract (useOcrExtraction.js):
 * image resolution from s3Key / imageUrl / base64 imageData, metering of
 * platform-paid providers against the per-tier AI credit allowance, and the
 * { extractedText } / { updatedItem } response shapes.
 *
 * All heavy dependencies are mocked, so this runs with no live AWS/OpenAI keys.
 */

process.env.OPENAI_KEY = process.env.OPENAI_KEY || 'test-key';

// Mock dependencies before requiring the controller.
jest.mock('../../services/ocrService', () => ({
    processOCR: jest.fn(),
    updateItemWithOCR: jest.fn(),
}));

jest.mock('../../services/s3Service', () => ({
    getFileBuffer: jest.fn(),
}));

jest.mock('../../utils/accessData', () => ({
    checkIP: jest.fn(),
}));

jest.mock('../../utils/apiUsageTracker', () => ({
    canMakeApiCall: jest.fn(),
    trackApiUsage: jest.fn(),
}));

const ocrController = require('../../controllers/ocrController');
const ocrService = require('../../services/ocrService');
const s3Service = require('../../services/s3Service');
const { checkIP } = require('../../utils/accessData');
const { canMakeApiCall, trackApiUsage } = require('../../utils/apiUsageTracker');

const realFetch = global.fetch;

function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

function makeReq(body = {}, params = {}) {
    return { body, params, user: { email: 'test@example.com' } };
}

describe('OCR Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        checkIP.mockResolvedValue({ allowed: true });
        canMakeApiCall.mockResolvedValue({ canMake: true });
        trackApiUsage.mockResolvedValue({});
        ocrService.processOCR.mockResolvedValue({
            extractedText: 'hello world',
            provider: 'openai-vision',
            model: 'gpt-4o',
            confidence: 0.95,
        });
        ocrService.updateItemWithOCR.mockResolvedValue({ id: 'item-1', text: '|Action:hello world' });
        s3Service.getFileBuffer.mockResolvedValue('aGVsbG8=');
    });

    afterEach(() => {
        global.fetch = realFetch;
    });

    it('loads and exposes extractOCR and updateWithOCR', () => {
        expect(ocrController).toBeDefined();
        expect(typeof ocrController.extractOCR).toBe('function');
        expect(typeof ocrController.updateWithOCR).toBe('function');
    });

    it('extracts from base64 imageData and returns extractedText at top level', async () => {
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ imageData: 'aGVsbG8=', method: 'openai-vision', model: 'gpt-4o' }), res);

        expect(ocrService.processOCR).toHaveBeenCalledWith('aGVsbG8=', 'openai-vision', 'gpt-4o');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, extractedText: 'hello world' }));
    });

    it('fetches the image from S3 when only s3Key is provided', async () => {
        s3Service.getFileBuffer.mockResolvedValue('c2hvcA==');
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ s3Key: 'users/x/img.png', method: 'tesseract' }), res);

        expect(s3Service.getFileBuffer).toHaveBeenCalledWith('users/x/img.png');
        expect(ocrService.processOCR).toHaveBeenCalledWith('c2hvcA==', 'tesseract', undefined);
    });

    it('fetches the image from imageUrl when provided', async () => {
        const bytes = Uint8Array.from(Buffer.from('hello'));
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => bytes.buffer,
        });
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ imageUrl: 'https://x/img.png', method: 'tesseract' }), res);

        expect(ocrService.processOCR).toHaveBeenCalledWith(Buffer.from('hello').toString('base64'), 'tesseract', undefined);
    });

    it('returns 400 when no image source is provided', async () => {
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ method: 'tesseract' }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(ocrService.processOCR).not.toHaveBeenCalled();
    });

    it('gates metered providers and returns 402 when credits are exhausted', async () => {
        canMakeApiCall.mockResolvedValue({ canMake: false, reason: 'Monthly AI usage limit reached' });
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ imageData: 'aGVsbG8=', method: 'openai-vision' }), res);

        expect(canMakeApiCall).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(402);
        expect(ocrService.processOCR).not.toHaveBeenCalled();
    });

    it('does not meter the local tesseract provider', async () => {
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ imageData: 'aGVsbG8=', method: 'tesseract' }), res);

        expect(canMakeApiCall).not.toHaveBeenCalled();
        expect(trackApiUsage).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('deducts cost for a metered provider after a successful extraction', async () => {
        const res = makeRes();
        await ocrController.extractOCR(makeReq({ imageData: 'aGVsbG8=', method: 'openai-vision', model: 'gpt-4o' }), res);

        expect(trackApiUsage).toHaveBeenCalledWith(
            'test@example.com',
            'openai',
            expect.objectContaining({ inputTokens: 1500, outputTokens: 500 }),
            'gpt-4o'
        );
    });

    it('updates an item and returns updatedItem', async () => {
        const res = makeRes();
        await ocrController.updateWithOCR(makeReq({ ocrText: 'hello world' }, { id: 'item-1' }), res);

        expect(ocrService.updateItemWithOCR).toHaveBeenCalledWith('item-1', 'test@example.com', 'hello world');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            updatedItem: expect.objectContaining({ text: expect.any(String) }),
        }));
    });

    it('returns 400 for updateWithOCR when ocrText is missing', async () => {
        const res = makeRes();
        await ocrController.updateWithOCR(makeReq({}, { id: 'item-1' }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(ocrService.updateItemWithOCR).not.toHaveBeenCalled();
    });
});