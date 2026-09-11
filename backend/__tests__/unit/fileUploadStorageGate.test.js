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

// The controller reaches DynamoDB through the doc-client's `send`. Routing that
// to a module-scope mock lets the tests below assert *which* command was issued
// and, more importantly, with what `Key` — the composite-key bug they guard
// against was invisible to a mock that accepted any arguments.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
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
    generatePresignedUploadUrl: (...args) => mockGeneratePresignedUploadUrl(...args),
    generateCloudFrontUrl: (...args) => mockGenerateCloudFrontUrl(...args),
    checkFileExists: (...args) => mockCheckFileExists(...args),
    deleteFile: (...args) => mockDeleteFile(...args),
    getFileMetadata: (...args) => mockGetFileMetadata(...args),
}));

const { requestUploadUrl, confirmUpload, deleteUploadedFile, getUploadConfig } = require('../../controllers/fileUploadController');

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

describe('confirmUpload — attaching to an existing record', () => {
    const OWNED_ROW = {
        id: 'd1',
        createdAt: '2026-01-01T00:00:00.000Z',
        text: 'Creator:u1|hello',
        files: [],
    };
    const body = {
        s3Key: 'users/u1/general/x.png',
        dataId: 'd1',
        filename: 'x.png',
        contentType: 'image/png',
        fileSize: 1024,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockSend.mockReset();
        mockCheckFileExists.mockResolvedValue(true);
        mockGenerateCloudFrontUrl.mockReturnValue('https://cdn.example.com/key');
        mockGetFileMetadata.mockResolvedValue({ size: 1024, contentType: 'image/png' });
        mockCheckStorageCapacity.mockResolvedValue(WITHIN_LIMIT);
    });

    test('looks the row up by partition key, then updates it with the composite key', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [OWNED_ROW] })
            .mockResolvedValueOnce({ Attributes: OWNED_ROW });
        const res = mockRes();

        await confirmUpload({ user: { id: 'u1' }, body: { ...body } }, res);

        const [lookup, update] = mockSend.mock.calls.map((call) => call[0]);
        expect(lookup.kind).toBe('query');
        expect(lookup.input.KeyConditionExpression).toBe('id = :id');
        expect(update.kind).toBe('update');
        // `{ id }` alone throws ValidationException against this table.
        expect(update.input.Key).toEqual({ id: 'd1', createdAt: '2026-01-01T00:00:00.000Z' });
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('404s when the target record does not exist', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });
        const res = mockRes();

        await confirmUpload({ user: { id: 'u1' }, body: { ...body } }, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(mockSend).toHaveBeenCalledTimes(1); // no write attempted
    });

    test("refuses to attach a file to another user's record", async () => {
        mockSend.mockResolvedValueOnce({ Items: [{ ...OWNED_ROW, text: 'Creator:someone-else|hi' }] });
        const res = mockRes();

        await confirmUpload({ user: { id: 'u1' }, body: { ...body } }, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('refuses a record with no creator tag instead of allowing it', async () => {
        mockSend.mockResolvedValueOnce({ Items: [{ ...OWNED_ROW, text: 'no creator tag here' }] });
        const res = mockRes();

        await confirmUpload({ user: { id: 'u1' }, body: { ...body } }, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('recognises a 32-character crypto id (the old check sliced a fixed 24)', async () => {
        const longId = 'a'.repeat(32);
        mockSend
            .mockResolvedValueOnce({ Items: [{ ...OWNED_ROW, text: `Creator:${longId}|hi` }] })
            .mockResolvedValueOnce({ Attributes: {} });
        const res = mockRes();

        await confirmUpload({ user: { id: longId }, body: { ...body } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('a confirm with no dataId writes nothing and just hands back the file data', async () => {
        const res = mockRes();

        await confirmUpload({
            user: { id: 'u1' },
            body: { s3Key: 'users/u1/general/x.png', filename: 'x.png', contentType: 'image/png', fileSize: 1024 },
        }, res);

        expect(mockSend).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });
});

describe('deleteUploadedFile — detaching from an existing record', () => {
    const OWNED_ROW = {
        id: 'd1',
        createdAt: '2026-01-01T00:00:00.000Z',
        text: 'Creator:u1|hello',
        files: [
            { s3Key: 'users/u1/general/x.png' },
            { s3Key: 'users/u1/general/y.png' },
        ],
    };
    const req = (dataId) => ({
        user: { id: 'u1' },
        params: { s3Key: 'users/u1/general/x.png' },
        body: dataId ? { dataId } : {},
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockSend.mockReset();
        mockDeleteFile.mockResolvedValue(true);
    });

    test('removes only the matching entry, keyed on id + createdAt', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [OWNED_ROW] })
            .mockResolvedValueOnce({});
        const res = mockRes();

        await deleteUploadedFile(req('d1'), res);

        const update = mockSend.mock.calls[1][0];
        expect(update.kind).toBe('update');
        expect(update.input.Key).toEqual({ id: 'd1', createdAt: '2026-01-01T00:00:00.000Z' });
        expect(update.input.ExpressionAttributeValues[':files']).toEqual([
            { s3Key: 'users/u1/general/y.png' },
        ]);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test("refuses to detach from another user's record", async () => {
        mockSend.mockResolvedValueOnce({ Items: [{ ...OWNED_ROW, text: 'Creator:someone-else|hi' }] });
        const res = mockRes();

        await deleteUploadedFile(req('d1'), res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockSend).toHaveBeenCalledTimes(1); // no write
    });

    test('deletes the object but skips the DB write when no dataId is supplied', async () => {
        const res = mockRes();

        await deleteUploadedFile(req(null), res);

        expect(mockDeleteFile).toHaveBeenCalledWith('users/u1/general/x.png');
        expect(mockSend).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
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
