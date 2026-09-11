/**
 * fileUploadStorageGate.test.js — unit tests for the storage-quota gate on the
 * presigned S3 upload path (backend/controllers/fileUploadController.js).
 *
 * Why this matters: /upload-url is the primary upload route, so it is the only
 * thing standing between a user and unlimited paid S3 storage. If this gate
 * regresses, the 50 GB / 100 MB caps in constants/pricing.js stop being
 * enforced on the path real uploads actually take.
 *
 * Mocks the S3 adapter, the storage tracker, the IP check, the logger, and the
 * AWS SDK doc-client boundary — the same approach as workspaceAgentGate.test.js.
 */

const mockCheckStorageCapacity = jest.fn();
const mockGeneratePresignedUploadUrl = jest.fn();
const mockGenerateCloudFrontUrl = jest.fn();
const mockCheckFileExists = jest.fn();
const mockDeleteFile = jest.fn();
const mockGetFileMetadata = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
    GetCommand: jest.fn(),
    UpdateCommand: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/accessData.js', () => ({
    checkIP: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/storageTracker', () => ({
    checkStorageCapacity: (...args) => mockCheckStorageCapacity(...args),
}));
jest.mock('../../services/s3Service.js', () => ({
    generatePresignedUploadUrl: (...args) => mockGeneratePresignedUploadUrl(...args),
    generateCloudFrontUrl: (...args) => mockGenerateCloudFrontUrl(...args),
    checkFileExists: (...args) => mockCheckFileExists(...args),
    deleteFile: (...args) => mockDeleteFile(...args),
    getFileMetadata: (...args) => mockGetFileMetadata(...args),
}));

const { requestUploadUrl, confirmUpload, getUploadConfig } = require('../../controllers/fileUploadController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const OVER_LIMIT = {
    canStore: false,
    reason: 'Storage limit exceeded. Need 5 MB additional space.',
    storageLimitFormatted: '100 MB',
    currentUsageFormatted: '98 MB',
};
const WITHIN_LIMIT = {
    canStore: true,
    reason: 'Within storage limits',
    storageLimitFormatted: '50 GB',
    currentUsageFormatted: '1 GB',
};

describe('requestUploadUrl — storage quota gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGenerateCloudFrontUrl.mockReturnValue('https://cdn.example.com/key');
    });

    test('rejects with 413 before issuing a URL when the plan limit would be exceeded', async () => {
        mockCheckStorageCapacity.mockResolvedValue(OVER_LIMIT);
        const req = { user: { id: 'u1' }, body: { filename: 'a.png', contentType: 'image/png', fileSize: 1024 } };
        const res = mockRes();

        await requestUploadUrl(req, res);

        expect(mockCheckStorageCapacity).toHaveBeenCalledWith('u1', 1024);
        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Storage limit exceeded' }));
        // The cheapest outcome: no bytes ever reach S3.
        expect(mockGeneratePresignedUploadUrl).not.toHaveBeenCalled();
    });

    test('issues a presigned URL when within the plan limit', async () => {
        mockCheckStorageCapacity.mockResolvedValue(WITHIN_LIMIT);
        mockGeneratePresignedUploadUrl.mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            s3Key: 'users/u1/general/x.png',
            expiresIn: 900,
            metadata: {},
        });
        const req = { user: { id: 'u1' }, body: { filename: 'a.png', contentType: 'image/png', fileSize: '2048' } };
        const res = mockRes();

        await requestUploadUrl(req, res);

        expect(mockCheckStorageCapacity).toHaveBeenCalledWith('u1', 2048);
        expect(mockGeneratePresignedUploadUrl).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('rejects a non-numeric fileSize with 400 (closes the quota/size bypass)', async () => {
        const req = { user: { id: 'u1' }, body: { filename: 'a.png', contentType: 'image/png', fileSize: 'not-a-number' } };
        const res = mockRes();
        const next = jest.fn();

        await requestUploadUrl(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).toHaveBeenCalled();
        expect(mockCheckStorageCapacity).not.toHaveBeenCalled();
        expect(mockGeneratePresignedUploadUrl).not.toHaveBeenCalled();
    });
});

describe('confirmUpload — storage quota re-check', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCheckFileExists.mockResolvedValue(true);
        mockGenerateCloudFrontUrl.mockReturnValue('https://cdn.example.com/key');
        mockGetFileMetadata.mockResolvedValue({ size: 1024, contentType: 'image/png' });
    });

    test('deletes the uploaded object and rejects when usage grew since the URL was issued', async () => {
        mockCheckStorageCapacity.mockResolvedValue(OVER_LIMIT);
        mockDeleteFile.mockResolvedValue(true);
        const req = { user: { id: 'u1' }, body: { s3Key: 'users/u1/general/x.png', filename: 'x.png', contentType: 'image/png', fileSize: 1024 } };
        const res = mockRes();

        await confirmUpload(req, res);

        expect(res.status).toHaveBeenCalledWith(413);
        // No orphan left behind accruing storage charges.
        expect(mockDeleteFile).toHaveBeenCalledWith('users/u1/general/x.png');
    });

    test('confirms normally when within the plan limit', async () => {
        mockCheckStorageCapacity.mockResolvedValue(WITHIN_LIMIT);
        const req = { user: { id: 'u1' }, body: { s3Key: 'users/u1/general/x.png', filename: 'x.png', contentType: 'image/png', fileSize: 1024 } };
        const res = mockRes();

        await confirmUpload(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockDeleteFile).not.toHaveBeenCalled();
    });
});

describe('getUploadConfig — client validation contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns the allow-list, size cap, and inline caps the UI must honor', async () => {
        const res = mockRes();

        await getUploadConfig({ user: { id: 'u1' } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(true);
        expect(Array.isArray(body.allowedTypes)).toBe(true);
        expect(body.allowedTypes).toContain('application/pdf');
        expect(body.maxFileBytes).toBeGreaterThan(0);
        expect(body.maxInlineTotalBytes).toBeLessThan(body.maxFileBytes);
    });
});
