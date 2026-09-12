/**
 * migrateImagesDryRun.test.js — the no-arguments behaviour of
 * backend/scripts/migrate-images-to-s3.js.
 *
 * That script uploads inline base64 images to S3 and rewrites the DynamoDB
 * `files` arrays. Its dry-run was a hand-edited constant that shipped as
 * `false`, so `node backend/scripts/migrate-images-to-s3.js` mutated live data
 * with no flag, no prompt and no dry-run pass. It is now `--apply`-gated like
 * every sibling script.
 *
 * The property worth pinning is negative and cheap to state: **running it with
 * no arguments issues no writes.** Reads (the scan) are fine — the dry run is
 * meant to be safe to point at production to see what is pending.
 *
 * The AWS SDK, S3 client and the Secrets Manager bootstrap are mocked; the
 * module is imported after they are, so no client is built against the network.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'test-bucket';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...a) => mockDdbSend(...a) })) },
    ScanCommand: jest.fn((input) => ({ kind: 'scan', input })),
    UpdateCommand: jest.fn((input) => ({ kind: 'update', input })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => ({ send: (...a) => mockS3Send(...a) })),
    PutObjectCommand: jest.fn((input) => ({ kind: 'putObject', input })),
}));
jest.mock('../../utils/awsSecrets', () => ({
    loadAllSecrets: jest.fn(async () => {}),
}));

const { migrateImagesToS3 } = require('../../scripts/migrate-images-to-s3');

/** One row carrying an inline base64 image — the shape the migration targets. */
const ROW_WITH_INLINE_IMAGE = {
    id: 'row-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: 'Creator:user-1|a note',
    files: [{
        filename: 'photo.png',
        contentType: 'image/png',
        // 1x1 transparent PNG.
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    }],
};

describe('migrate-images-to-s3 — default (no --apply)', () => {
    let logSpy;

    beforeEach(() => {
        mockDdbSend.mockReset();
        mockS3Send.mockReset();
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('is a dry run when invoked with no arguments', async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [] });

        await migrateImagesToS3();

        const output = logSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Dry Run: YES');
        expect(output).toContain('DRY RUN');
    });

    it('uploads nothing and writes nothing, even when it finds an image', async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [ROW_WITH_INLINE_IMAGE] });

        await migrateImagesToS3();

        // The scan is expected (that is the whole point of the dry run)…
        expect(mockDdbSend.mock.calls.map((c) => c[0].kind)).toEqual(['scan']);
        // …but nothing may reach S3, and no row may be rewritten.
        expect(mockS3Send).not.toHaveBeenCalled();
        expect(mockDdbSend.mock.calls.some((c) => c[0].kind === 'update')).toBe(false);
    });

    it('reports what it would do without claiming it did it', async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [ROW_WITH_INLINE_IMAGE] });

        await migrateImagesToS3();

        const output = logSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Would migrate');
        expect(output).toContain('Images migrated: 0');
        expect(output).toContain('Images that WOULD be migrated: 1');
        expect(output).toContain('nothing was uploaded and nothing was written');
    });

    it('walks every scan page rather than stopping at the first', async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { id: 'cursor' } })
            .mockResolvedValueOnce({ Items: [] });

        await migrateImagesToS3();

        const scans = mockDdbSend.mock.calls.filter((c) => c[0].kind === 'scan');
        expect(scans).toHaveLength(2);
        expect(scans[0][0].input.ExclusiveStartKey).toBeUndefined();
        expect(scans[1][0].input.ExclusiveStartKey).toEqual({ id: 'cursor' });
    });
});
