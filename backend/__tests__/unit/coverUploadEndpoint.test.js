/**
 * coverUploadEndpoint.test.js — the Dream board's cover upload.
 *
 * `POST /api/data/upload-cover` exists because the presigned browser→S3 path
 * can't be used from the site: the bucket has no CORS rule allowing the app's
 * origin, so the preflight is rejected and the PUT never happens. Posting the
 * bytes to the API has no CORS dependency, and it means the server sees the
 * image it is storing.
 *
 * Three things this pins down, each of which fails loudly in production if it
 * regresses:
 *   1. The storage quota is enforced *before* anything is written — refusing an
 *      over-limit user after uploading would charge them for a file they can't
 *      keep.
 *   2. The bytes are recorded (`files[].size`), or the cover is stored for free
 *      and the free/Pro storage ceiling is quietly not enforced.
 *   3. `DELETE /file/:s3Key` works with NO request body. It used to destructure
 *      `req.body` directly, so a bodyless DELETE — the natural way to call it —
 *      threw a 500 and deleted nothing.
 *
 * AWS and S3 are mocked at the module boundary, as in uploadSignatureGate.test.js.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockSend = jest.fn();
const mockUploadImageBuffer = jest.fn();
const mockDeleteFile = jest.fn();
const mockCheckStorageCapacity = jest.fn();
const mockInvalidateStorageUsage = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ kind: 'update', input })),
    DeleteCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
}));
jest.mock('../../services/s3Service.js', () => ({
    generatePresignedUploadUrl: jest.fn(),
    generateCloudFrontUrl: jest.fn((key) => `https://cdn.test/${key}`),
    checkFileExists: jest.fn(),
    deleteFile: (...args) => mockDeleteFile(...args),
    getFileMetadata: jest.fn(),
    getObjectHead: jest.fn(),
    uploadImageBuffer: (...args) => mockUploadImageBuffer(...args),
}));
jest.mock('../../utils/storageTracker', () => ({
    checkStorageCapacity: (...args) => mockCheckStorageCapacity(...args),
    invalidateStorageUsage: (...args) => mockInvalidateStorageUsage(...args),
}));
jest.mock('../../utils/accessData', () => ({ checkIP: jest.fn() }));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { uploadCoverImage, deleteUploadedFile } = require('../../controllers/fileUploadController');

const USER = 'u1';

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
}

/** The record the upload wrote to DynamoDB, if it wrote one. */
function writtenRecord() {
    const puts = mockSend.mock.calls.map((c) => c[0]).filter((c) => c?.kind === 'put');
    return puts.length ? puts[puts.length - 1].input.Item : null;
}

beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    mockUploadImageBuffer.mockReset();
    mockUploadImageBuffer.mockResolvedValue({
        s3Key: `users/${USER}/generated/1_abcd.jpg`,
        url: 'https://cdn.test/users/u1/generated/1_abcd.jpg',
        bytes: 2048,
        contentType: 'image/jpeg',
    });
    mockDeleteFile.mockReset();
    mockDeleteFile.mockResolvedValue({});
    mockCheckStorageCapacity.mockReset();
    mockCheckStorageCapacity.mockResolvedValue({
        canStore: true,
        reason: null,
        storageLimitFormatted: '100 MB',
        currentUsageFormatted: '1 MB',
    });
    mockInvalidateStorageUsage.mockReset();
});

describe('POST /upload-cover — coverUploadImage controller', () => {
    const uploadReq = () => ({
        user: { id: USER },
        body: {},
        file: {
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
            mimetype: 'image/jpeg',
            originalname: 'dream-play.jpg',
        },
    });

    test('stores the image, counts its bytes, and returns a usable URL', async () => {
        const res = mockRes();
        const next = jest.fn();

        await uploadCoverImage(uploadReq(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);

        const payload = res.json.mock.calls[0][0];
        expect(payload.success).toBe(true);
        expect(payload.url).toBe('https://cdn.test/users/u1/generated/1_abcd.jpg');
        expect(payload.recordId).toMatch(new RegExp(`^dream_cover_${USER}_`));

        // The bytes have to be recorded or the plan's storage ceiling isn't real.
        const record = writtenRecord();
        expect(record).not.toBeNull();
        expect(record.files[0].size).toBe(4);
        expect(record.text).toContain(`Creator:${USER}`);

        // ...and the cached usage figure must not outlive the write.
        expect(mockInvalidateStorageUsage).toHaveBeenCalledWith(USER);
    });

    test('refuses an image the user has no room for, before storing anything', async () => {
        mockCheckStorageCapacity.mockResolvedValue({
            canStore: false,
            reason: 'Storage limit exceeded',
            storageLimitFormatted: '100 MB',
            currentUsageFormatted: '99 MB',
        });
        const res = mockRes();

        await uploadCoverImage(uploadReq(), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, error: 'Storage limit exceeded' });
        expect(mockUploadImageBuffer).not.toHaveBeenCalled();
        expect(writtenRecord()).toBeNull();
    });

    test('rejects a file that is not an image', async () => {
        const req = uploadReq();
        req.file.mimetype = 'application/pdf';
        const res = mockRes();

        await uploadCoverImage(req, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockUploadImageBuffer).not.toHaveBeenCalled();
    });

    test('rejects a request with no file', async () => {
        const req = uploadReq();
        delete req.file;
        const res = mockRes();

        await uploadCoverImage(req, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockUploadImageBuffer).not.toHaveBeenCalled();
    });
});

describe('DELETE /file/:s3Key', () => {
    test('works with no request body (regression: it used to 500)', async () => {
        const res = mockRes();
        const next = jest.fn();
        const key = `users/${USER}/generated/1_abcd.jpg`;

        await deleteUploadedFile(
            { user: { id: USER }, params: { s3Key: key }, body: undefined },
            res,
            next
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockDeleteFile).toHaveBeenCalledWith(key);
    });

    test('refuses a key outside the caller own prefix', async () => {
        const res = mockRes();

        await deleteUploadedFile(
            { user: { id: USER }, params: { s3Key: 'users/someone-else/generated/1.jpg' }, body: {} },
            res,
            jest.fn()
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockDeleteFile).not.toHaveBeenCalled();
    });
});
