/**
 * uploadSignatureGate.test.js — the post-upload content check in
 * `confirmUpload` (backend/controllers/fileUploadController.js).
 *
 * The gap being guarded: `/upload-url` validates only what the client *claims*
 * (extension + declared content type), and the bytes go client → S3 directly, so
 * that validation alone can be satisfied by anything. `confirmUpload` now reads
 * the object's leading bytes and refuses content that contradicts its extension.
 *
 * Three properties matter here and each is pinned below:
 *   1. a contradiction is rejected **and the object is deleted** (no orphan
 *      accruing storage charges, and no record pointing at it);
 *   2. a genuine file still confirms (the check must not break real uploads);
 *   3. an *unreadable* head fails **open** — an S3 hiccup must not fail an
 *      otherwise-good upload, so verification only ever fails closed on a
 *      positive contradiction.
 *
 * Mocks the S3 adapter, storage tracker, IP check, logger and the AWS SDK
 * doc-client boundary — the same approach as fileUploadStorageGate.test.js.
 */

const mockCheckStorageCapacity = jest.fn();
const mockGenerateCloudFrontUrl = jest.fn();
const mockCheckFileExists = jest.fn();
const mockDeleteFile = jest.fn();
const mockGetFileMetadata = jest.fn();
const mockGetObjectHead = jest.fn();
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    UpdateCommand: jest.fn().mockImplementation((input) => ({ kind: 'update', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/accessData.js', () => ({
    checkIP: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/storageTracker', () => ({
    checkStorageCapacity: (...args) => mockCheckStorageCapacity(...args),
    invalidateStorageUsage: jest.fn(),
}));
jest.mock('../../services/s3Service.js', () => ({
    generatePresignedUploadUrl: jest.fn(),
    generateCloudFrontUrl: (...args) => mockGenerateCloudFrontUrl(...args),
    checkFileExists: (...args) => mockCheckFileExists(...args),
    deleteFile: (...args) => mockDeleteFile(...args),
    getFileMetadata: (...args) => mockGetFileMetadata(...args),
    getObjectHead: (...args) => mockGetObjectHead(...args),
}));

const { confirmUpload } = require('../../controllers/fileUploadController');

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n', 'binary');
const MZ = Buffer.from('MZ\x90\x00', 'binary');

const WITHIN_LIMIT = { canStore: true, storageLimitFormatted: '50 GB', currentUsageFormatted: '1 GB' };

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** A confirm request as the controller reads it. */
function req(overrides = {}, bodyOverrides = {}) {
    return {
        user: { id: 'u1' },
        body: {
            s3Key: 'users/u1/general/1699_ab12.png',
            filename: 'holiday.png',
            contentType: 'image/png',
            fileSize: 1024,
            ...bodyOverrides,
        },
        ...overrides,
    };
}

describe('confirmUpload — content verification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.UPLOAD_SIGNATURE_CHECK;
        mockCheckFileExists.mockResolvedValue(true);
        mockGenerateCloudFrontUrl.mockReturnValue('https://cdn.example.com/key');
        mockGetFileMetadata.mockResolvedValue({ size: 1024, contentType: 'image/png' });
        mockCheckStorageCapacity.mockResolvedValue(WITHIN_LIMIT);
        mockDeleteFile.mockResolvedValue(true);
        mockGetObjectHead.mockResolvedValue(PNG);
    });

    test('refuses an image whose bytes are actually a PDF, and deletes the object', async () => {
        mockGetObjectHead.mockResolvedValue(PDF);
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: 'Uploaded file content does not match its file type',
            details: expect.stringContaining('pdf'),
        }));
        expect(mockDeleteFile).toHaveBeenCalledWith('users/u1/general/1699_ab12.png');
    });

    test('refuses an image whose bytes are an executable', async () => {
        mockGetObjectHead.mockResolvedValue(MZ);
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockDeleteFile).toHaveBeenCalled();
    });

    test('never records a rejected upload against a data item', async () => {
        mockGetObjectHead.mockResolvedValue(PDF);
        const res = mockRes();

        await confirmUpload(req({}, { dataId: 'd1' }), res);

        // No lookup, no update: rejection happens before any DynamoDB work.
        expect(mockSend).not.toHaveBeenCalled();
    });

    test('still confirms a genuine file', async () => {
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockDeleteFile).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('trusts the s3Key extension over a filename re-declared at confirm time', async () => {
        // The key was minted from the validated name when the URL was issued, so
        // relabelling the upload in the body must not move it out of the check.
        mockGetObjectHead.mockResolvedValue(PDF);
        const res = mockRes();

        await confirmUpload(req({}, { filename: 'innocent.txt' }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockGetObjectHead).toHaveBeenCalledWith('users/u1/general/1699_ab12.png', expect.any(Number));
    });

    test('fails open when the object cannot be read', async () => {
        // Verification is defence-in-depth on top of validation that already
        // passed, so an S3 error must not fail a real upload.
        mockGetObjectHead.mockResolvedValue(null);
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    test('fails open on content it cannot identify, but logs it', async () => {
        mockGetObjectHead.mockResolvedValue(Buffer.from('not really a png', 'utf8'));
        const { logger } = require('../../utils/logger');
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not verify content'));
    });

    test('asks S3 for only a bounded head, not the whole object', async () => {
        const res = mockRes();

        await confirmUpload(req(), res);

        const [, byteCount] = mockGetObjectHead.mock.calls[0];
        expect(byteCount).toBeGreaterThan(12);
        expect(byteCount).toBeLessThan(4096);
    });

    test('still enforces the storage quota (the new check comes first, not instead)', async () => {
        const overLimit = { canStore: false, reason: 'Storage limit exceeded', storageLimitFormatted: '100 MB', currentUsageFormatted: '99 MB' };
        mockCheckStorageCapacity.mockResolvedValue(overLimit);
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(413);
        expect(mockDeleteFile).toHaveBeenCalledWith('users/u1/general/1699_ab12.png');
    });

    test('can be switched off entirely with UPLOAD_SIGNATURE_CHECK=false', async () => {
        process.env.UPLOAD_SIGNATURE_CHECK = 'false';
        mockGetObjectHead.mockResolvedValue(PDF);
        const res = mockRes();

        await confirmUpload(req(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        // Not even read, so a misfiring rule can be neutralised without a deploy.
        expect(mockGetObjectHead).not.toHaveBeenCalled();
    });

    test('a .txt carrying PNG bytes is refused as text', async () => {
        const body = { s3Key: 'users/u1/general/notes.txt', filename: 'notes.txt', contentType: 'text/plain' };
        mockGetObjectHead.mockResolvedValue(PNG);
        mockGetFileMetadata.mockResolvedValue({ size: 12, contentType: 'text/plain' });
        const res = mockRes();

        await confirmUpload(req({}, body), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockDeleteFile).toHaveBeenCalledWith('users/u1/general/notes.txt');
    });
});
