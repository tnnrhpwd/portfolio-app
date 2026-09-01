/**
 * storageTracker.test.js — unit tests for the pure storage-size helpers
 * (backend/utils/storageTracker.js).
 *
 * The module instantiates a DynamoDB client at load, and @aws-sdk packages
 * ship ESM builds this repo's Jest config can't parse (same issue as
 * back.test.js / bedrockService.test.js), so the SDK is mocked here to keep
 * the test fast and offline. calculateFilesSize() itself is pure — no DB.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
    ScanCommand: jest.fn(),
    PutCommand: jest.fn(),
}));

const { calculateFilesSize } = require('../../utils/storageTracker');

describe('storageTracker.calculateFilesSize', () => {
    test('counts explicit file.size for S3-stored generated images', () => {
        const files = [
            { filename: 'image-123.png', contentType: 'image/png', size: 1500000 },
        ];
        const size = calculateFilesSize(files);
        // size + filename + contentType metadata
        expect(size).toBeGreaterThanOrEqual(1500000);
    });

    test('falls back to base64 data when no explicit size is present', () => {
        const data = Buffer.alloc(1024).toString('base64');
        const files = [{ filename: 'x.png', contentType: 'image/png', data }];
        expect(calculateFilesSize(files)).toBeGreaterThan(0);
    });

    test('returns 0 for empty or non-array files', () => {
        expect(calculateFilesSize(null)).toBe(0);
        expect(calculateFilesSize([])).toBe(0);
        expect(calculateFilesSize('nope')).toBe(0);
    });
});
